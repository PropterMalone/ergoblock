import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthData, PendingRollback } from '../types.js';

const state = vi.hoisted(() => ({ local: {} as Record<string, unknown> }));
vi.mock('../platform/browser.js', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: state.local[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(state.local, values);
        }),
      },
    },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn() },
  },
}));
vi.mock('../platform/storage.js', () => ({
  getOptions: vi.fn(async () => ({})),
  withTrackingLock: vi.fn(async (work: () => Promise<unknown>) => work()),
  trackingMatches: vi.fn(() => true),
  getTempBlocks: vi.fn(async () => ({})),
  getTempMutes: vi.fn(async () => ({})),
  removeTempBlock: vi.fn(async () => undefined),
  removeTempMute: vi.fn(async () => true),
  addHistoryEntry: vi.fn(async () => undefined),
  getProcessableRollbacks: vi.fn(async () => []),
  getPendingRollbacks: vi.fn(async () => []),
  updatePendingRollback: vi.fn(async () => undefined),
  removePendingRollback: vi.fn(async () => undefined),
}));
import browser from '../platform/browser.js';
import {
  bgApiRequest,
  refreshSession,
  refreshViaRefreshToken,
  pinnedApiRequest,
  saveAuthToken,
  captureAuthGeneration,
  withAuthSession,
} from './api-client.js';
import { checkExpirations } from './expiration.js';
import { getTempMutes, removeTempMute, getPendingRollbacks } from '../platform/storage.js';

const AUTH: AuthData = {
  did: 'did:plc:a',
  accessJwt: 'access-a',
  refreshJwt: 'refresh-a',
  pdsUrl: 'https://pds.example',
};
const OTHER: AuthData = { ...AUTH, did: 'did:plc:b', accessJwt: 'access-b' };
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Promise not initialized');
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const ok = (data: unknown = {}) => new Response(JSON.stringify(data), { status: 200 });
const expired = () => new Response(JSON.stringify({ error: 'ExpiredToken' }), { status: 401 });
const TAB = { id: 1, index: 0, highlighted: false, active: true, pinned: false, incognito: false };

beforeEach(() => {
  vi.clearAllMocks();
  state.local = { authToken: AUTH, expirationHealth: { lastSuccessAt: 123 } };
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    Object.assign(state.local, values);
  });
  vi.mocked(browser.tabs.query).mockResolvedValue([]);
  vi.mocked(getTempMutes).mockResolvedValue({});
  vi.mocked(getPendingRollbacks).mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe('auth and expiration HTTP boundaries', () => {
  it('provides the exact refreshed HTTP session for a guarded local success commit', async () => {
    const originalGeneration = captureAuthGeneration();
    const fresh = { ...AUTH, accessJwt: 'refreshed' };
    vi.mocked(browser.tabs.query).mockResolvedValue([TAB]);
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ auth: fresh });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(ok({ done: true }));
    vi.stubGlobal('fetch', fetchMock);
    let usedAuth = AUTH;
    let usedGeneration = originalGeneration;
    expect(
      await pinnedApiRequest('app.bsky.graph.muteActor', 'POST', {}, AUTH, {
        expectedGeneration: originalGeneration,
        onSuccessSession: (auth, generation) => {
          usedAuth = auth;
          usedGeneration = generation;
        },
      })
    ).toEqual({ done: true });
    expect(usedAuth).toEqual(fresh);
    expect(usedGeneration).toBeGreaterThan(originalGeneration);
    await expect(withAuthSession(usedAuth, async () => 'committed', usedGeneration)).resolves.toBe(
      'committed'
    );
    await expect(withAuthSession(AUTH, async () => 'stale', originalGeneration)).rejects.toThrow(
      'session changed'
    );
  });
  it('preserves expiration tracking after A switches to B and back to identical A during HTTP', async () => {
    vi.mocked(getTempMutes).mockResolvedValue({
      'did:plc:target': { handle: 'target.test', createdAt: 1, expiresAt: 2 },
    });
    const held = deferred<Response>();
    const started = deferred<void>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        started.resolve();
        return held.promise;
      })
    );
    const pending = checkExpirations();
    await started.promise;
    await saveAuthToken(OTHER);
    await saveAuthToken({ ...AUTH });
    held.resolve(ok());
    expect(await pending).toMatchObject({
      status: 'failed',
      lastSuccessAt: 123,
      reason: expect.stringContaining('Bluesky action succeeded'),
    });
    expect(removeTempMute).not.toHaveBeenCalled();
  });
  it('checks cancellation after deferred tab discovery before any refresh request', async () => {
    const tabs = deferred<Awaited<ReturnType<typeof browser.tabs.query>>>();
    vi.mocked(browser.tabs.query).mockReturnValue(tabs.promise);
    const fetchMock = vi.fn(async () => expired());
    vi.stubGlobal('fetch', fetchMock);
    let stopped = false;
    const pending = pinnedApiRequest('app.bsky.graph.unmuteActor', 'POST', {}, AUTH, {
      beforeRequest: () => {
        if (stopped) throw new Error('Stopped');
      },
    });
    const assertion = expect(pending).rejects.toThrow('Stopped');
    await vi.waitFor(() => expect(browser.tabs.query).toHaveBeenCalledOnce());
    stopped = true;
    tabs.resolve([TAB]);
    await assertion;
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps backend success distinct from a conditional tracking conflict', async () => {
    vi.mocked(getTempMutes).mockResolvedValue({
      'did:plc:target': { handle: 'target.test', createdAt: 1, expiresAt: 2 },
    });
    vi.mocked(removeTempMute).mockResolvedValueOnce(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok())
    );
    expect(await checkExpirations()).toMatchObject({
      status: 'failed',
      lastSuccessAt: 123,
      reason: expect.stringContaining('Bluesky action succeeded'),
    });
  });
  it.each(['direct', 'tab'] as const)(
    'discards a deferred %s refresh after AUTH_SYNC changes account',
    async (path) => {
      const reply = deferred<Response>();
      const tabReply = deferred<{ auth: AuthData }>();
      const fetchMock = vi.fn(() => reply.promise);
      vi.stubGlobal('fetch', fetchMock);
      if (path === 'tab') {
        vi.mocked(browser.tabs.query).mockResolvedValue([TAB]);
        vi.mocked(browser.tabs.sendMessage).mockReturnValue(tabReply.promise);
      }
      const pending = path === 'direct' ? refreshViaRefreshToken(AUTH) : refreshSession(AUTH);
      await vi.waitFor(() =>
        expect(path === 'direct' ? fetchMock : browser.tabs.sendMessage).toHaveBeenCalledOnce()
      );
      await saveAuthToken(OTHER);
      reply.resolve(ok({ ...AUTH, accessJwt: 'late-a' }));
      tabReply.resolve({ auth: { ...AUTH, accessJwt: 'late-a' } });
      expect(await pending).toBeNull();
      expect(state.local.authToken).toEqual(OTHER);
    }
  );

  it('rejects a pinned retry when same-owner token generation changes during refresh', async () => {
    const reply = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(expired())
      .mockImplementationOnce(() => reply.promise);
    vi.stubGlobal('fetch', fetchMock);
    const pending = pinnedApiRequest(
      'app.bsky.graph.unmuteActor',
      'POST',
      { actor: 'did:plc:target' },
      AUTH
    );
    const assertion = expect(pending).rejects.toThrow(/session|account/i);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const newer = { ...AUTH, accessJwt: 'newer-a' };
    await saveAuthToken(newer);
    reply.resolve(ok({ ...AUTH, accessJwt: 'late-a' }));
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.local.authToken).toEqual(newer);
  });

  it('does not unmute under account B or remove A tracking after refresh switches account', async () => {
    vi.mocked(getTempMutes).mockResolvedValue({
      'did:plc:target': { handle: 'target.test', createdAt: 1, expiresAt: 2 },
    });
    vi.mocked(browser.tabs.query).mockResolvedValue([TAB]);
    vi.mocked(browser.tabs.sendMessage).mockImplementation(async () => {
      await saveAuthToken(OTHER);
      return { auth: OTHER };
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await checkExpirations();
    expect(outcome).toMatchObject({ status: 'failed', lastSuccessAt: 123, completedCount: 0 });
    expect(removeTempMute).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(state.local.authToken).toEqual(OTHER);
  });

  it('preserves network success when only authStatus bookkeeping fails', async () => {
    vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
      if ('authStatus' in values) throw new Error('secret-token');
      Object.assign(state.local, values);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ done: true }))
    );
    expect(
      await bgApiRequest('app.bsky.graph.unmuteActor', 'POST', {}, AUTH.accessJwt, AUTH.pdsUrl)
    ).toEqual({ done: true });
    vi.mocked(getTempMutes).mockResolvedValue({
      'did:plc:target': { handle: 'target.test', createdAt: 1, expiresAt: 2 },
    });
    expect(await checkExpirations()).toMatchObject({
      status: 'success',
      completedCount: 1,
      healthSaved: true,
    });
    expect(removeTempMute).toHaveBeenCalledOnce();
  });

  it.each([1, 5])(
    'does not report success while deferred/exhausted recovery remains (attempts %s)',
    async (attempts) => {
      const rollback: PendingRollback = {
        id: 'recovery',
        type: 'unmute',
        did: 'did:plc:target',
        handle: 'target.test',
        createdAt: 1,
        attempts,
        lastAttempt: Date.now(),
        error: 'retry',
      };
      vi.mocked(getPendingRollbacks).mockResolvedValue([rollback]);
      const outcome = await checkExpirations();
      expect(outcome).toMatchObject({
        status: 'failed',
        lastSuccessAt: 123,
        pendingRecoveryCount: 1,
      });
      expect(outcome.reason).toMatch(/recovery/i);
    }
  );
});
