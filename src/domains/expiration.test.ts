// pattern: imperative shell (auto-expire temp actions + process pending rollbacks)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// expiration orchestrates auth, graph un-actions, storage, and (for rollbacks) the raw
// executeApiRequest. All boundaries are mocked; we assert the expiry boundary condition
// (strict `<`) and the rollback delete using repo = owner DID.

vi.mock('../platform/browser.js', () => ({
  default: {
    storage: {
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
    },
    alarms: { create: vi.fn(), clear: vi.fn() },
  },
}));

vi.mock('./api-client.js', () => ({
  getAuthToken: vi.fn(),
  requestFreshAuth: vi.fn().mockResolvedValue(null),
  sendNotification: vi.fn().mockResolvedValue(undefined),
  withAuthSession: vi.fn(async (_auth: unknown, operation: () => Promise<unknown>) => operation()),
  pinnedApiRequest: vi.fn().mockResolvedValue({}),
  AuthSessionChangedError: class extends Error {},
  isExpiredTokenError: vi.fn().mockReturnValue(false),
  captureAuthGeneration: vi.fn().mockReturnValue(0),
  refreshedAuthGeneration: vi.fn().mockReturnValue(0),
}));

vi.mock('./graph-ops.js', () => ({
  unblockUser: vi.fn().mockResolvedValue(true),
  unmuteUser: vi.fn().mockResolvedValue(true),
}));

vi.mock('../platform/api.js', () => ({
  executeApiRequest: vi.fn().mockResolvedValue({}),
}));

vi.mock('../platform/storage.js', () => ({
  withTrackingLock: vi.fn(async (work: () => Promise<unknown>) => work()),
  trackingMatches: vi.fn(() => true),
  getTempBlocks: vi.fn().mockResolvedValue({}),
  getTempMutes: vi.fn().mockResolvedValue({}),
  removeTempBlock: vi.fn().mockResolvedValue(undefined),
  removeTempMute: vi.fn().mockResolvedValue(undefined),
  addHistoryEntry: vi.fn().mockResolvedValue(undefined),
  cleanupExpiredPostContexts: vi.fn().mockResolvedValue(undefined),
  getOptions: vi.fn().mockResolvedValue({ notificationsEnabled: false }),
  getProcessableRollbacks: vi.fn().mockResolvedValue([]),
  getPendingRollbacks: vi.fn().mockResolvedValue([]),
  updatePendingRollback: vi.fn().mockResolvedValue(undefined),
  removePendingRollback: vi.fn().mockResolvedValue(undefined),
  cleanupOldRollbacks: vi.fn().mockResolvedValue(0),
}));

import { checkExpirations } from './expiration.js';
import {
  getAuthToken,
  requestFreshAuth,
  sendNotification,
  pinnedApiRequest,
  withAuthSession,
} from './api-client.js';
import browser from '../platform/browser.js';
import { unblockUser } from './graph-ops.js';
import {
  getTempBlocks,
  getTempMutes,
  removeTempBlock,
  getProcessableRollbacks,
  getPendingRollbacks,
  removePendingRollback,
  withTrackingLock,
  trackingMatches,
} from '../platform/storage.js';

const mockGetAuthToken = vi.mocked(getAuthToken);
const mockUnblockUser = vi.mocked(unblockUser);
const mockExecuteApiRequest = vi.mocked(pinnedApiRequest);
const mockGetTempBlocks = vi.mocked(getTempBlocks);
const mockGetTempMutes = vi.mocked(getTempMutes);
const mockRemoveTempBlock = vi.mocked(removeTempBlock);
const mockGetProcessableRollbacks = vi.mocked(getProcessableRollbacks);
const mockRemovePendingRollback = vi.mocked(removePendingRollback);

const AUTH = {
  accessJwt: 'jwt',
  refreshJwt: 'refresh',
  did: 'did:plc:owner',
  pdsUrl: 'https://pds.example',
};
const NOW = 1_700_000_000_000;

describe('expiration health outcomes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(withTrackingLock).mockImplementation(async (work) => work({ token: Symbol('test') }));
    vi.mocked(trackingMatches).mockReturnValue(true);
    vi.mocked(withAuthSession).mockImplementation(async (_auth, operation) => operation());
    vi.mocked(getPendingRollbacks).mockResolvedValue([]);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    mockGetAuthToken.mockResolvedValue(AUTH);
    vi.mocked(requestFreshAuth).mockResolvedValue(null);
    mockGetTempBlocks.mockResolvedValue({});
    mockGetTempMutes.mockResolvedValue({});
    mockGetProcessableRollbacks.mockResolvedValue([]);
    mockUnblockUser.mockResolvedValue(true);
    mockRemoveTempBlock.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it('persists attempt and success only for a complete authenticated check', async () => {
    const outcome = await checkExpirations();
    expect(outcome).toMatchObject({ status: 'success', failedCount: 0 });
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      expirationHealth: expect.objectContaining({
        lastAttemptAt: NOW,
        lastSuccessAt: NOW,
        status: 'success',
      }),
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('reports missing auth without advancing last success', async () => {
    mockGetAuthToken.mockResolvedValue(null);
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      expirationHealth: { lastSuccessAt: NOW - 1000 },
    });
    expect(await checkExpirations()).toMatchObject({
      status: 'needs_auth',
      authNeedsAttention: true,
    });
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      expirationHealth: expect.objectContaining({ lastSuccessAt: NOW - 1000 }),
    });
  });

  it('counts non-auth failures even when another item is retried successfully', async () => {
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:a': { handle: 'a.test', expiresAt: NOW - 1, createdAt: 1 },
      'did:plc:b': { handle: 'b.test', expiresAt: NOW - 1, createdAt: 1 },
    });
    mockUnblockUser
      .mockRejectedValueOnce(new Error('network secret-token'))
      .mockRejectedValueOnce(new Error('401'))
      .mockResolvedValueOnce(true);
    vi.mocked(requestFreshAuth).mockResolvedValue(AUTH);
    const outcome = await checkExpirations();
    expect(outcome).toMatchObject({ status: 'partial', failedCount: 1, completedCount: 1 });
    expect(JSON.stringify(outcome)).not.toContain('secret-token');
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      expirationHealth: expect.not.objectContaining({ lastSuccessAt: NOW }),
    });
  });

  it('distinguishes backend success from failed local tracking without advancing last success', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      expirationHealth: { lastSuccessAt: NOW - 1000 },
    });
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:a': { handle: 'a.test', expiresAt: NOW - 1, createdAt: 1 },
    });
    mockRemoveTempBlock.mockRejectedValueOnce(new Error('secret-token'));
    expect(await checkExpirations()).toMatchObject({
      status: 'failed',
      lastSuccessAt: NOW - 1000,
      failedCount: 1,
      reason: expect.stringContaining('Bluesky action succeeded'),
    });
  });

  it('reports storage-read failure without exposing error text', async () => {
    mockGetTempBlocks.mockRejectedValueOnce(new Error('secret-token'));
    const outcome = await checkExpirations();
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(outcome)).not.toContain('secret-token');
  });

  it('advances last success only after a later retry completes', async () => {
    mockGetAuthToken.mockResolvedValueOnce(null);
    expect(await checkExpirations()).toMatchObject({ status: 'needs_auth', lastAttemptAt: NOW });
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 2000);
    expect(await checkExpirations()).toMatchObject({
      status: 'success',
      lastAttemptAt: NOW + 2000,
      lastSuccessAt: NOW + 2000,
    });
  });

  it('does not retry an action under a refreshed different account', async () => {
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:a': { handle: 'a.test', expiresAt: NOW - 1, createdAt: 1 },
    });
    mockUnblockUser.mockRejectedValueOnce(new Error('401'));
    vi.mocked(requestFreshAuth).mockResolvedValue({ ...AUTH, did: 'did:plc:different' });
    expect(await checkExpirations()).toMatchObject({
      status: 'failed',
      authNeedsAttention: true,
      failedCount: 1,
    });
    expect(mockUnblockUser).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent checks and their snapshots', async () => {
    let release: (() => void) | undefined;
    mockGetAuthToken.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return AUTH;
    });
    const first = checkExpirations();
    await vi.waitFor(() => expect(mockGetAuthToken).toHaveBeenCalledTimes(1));
    const second = checkExpirations();
    await Promise.resolve();
    expect(mockGetAuthToken).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all([first, second]);
    expect(mockGetAuthToken).toHaveBeenCalledTimes(2);
  });

  it('reports health persistence failure separately after a successful backend check', async () => {
    vi.mocked(browser.storage.local.set).mockRejectedValue(new Error('secret-token'));
    expect(await checkExpirations()).toMatchObject({ status: 'success', healthSaved: false });
  });
});

describe('checkExpirations — expiry boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    mockGetAuthToken.mockResolvedValue(AUTH);
    mockGetTempBlocks.mockResolvedValue({});
    mockGetTempMutes.mockResolvedValue({});
    mockGetProcessableRollbacks.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT expire an entry whose expiresAt === now (strict `<`)', async () => {
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:edge': { handle: 'edge.bsky', expiresAt: NOW, createdAt: NOW - 1000 },
    } as never);

    await checkExpirations();

    expect(mockUnblockUser).not.toHaveBeenCalled();
    expect(mockRemoveTempBlock).not.toHaveBeenCalled();
  });

  it('DOES expire an entry whose expiresAt is strictly before now', async () => {
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:past': {
        handle: 'past.bsky',
        expiresAt: NOW - 1,
        createdAt: NOW - 1000,
        rkey: 'rk',
      },
    } as never);

    await checkExpirations();

    expect(mockUnblockUser).toHaveBeenCalledWith(
      'did:plc:past',
      AUTH.accessJwt,
      AUTH.did,
      AUTH.pdsUrl,
      'rk',
      AUTH,
      expect.objectContaining({ beforeRequest: expect.any(Function) })
    );
    expect(mockRemoveTempBlock).toHaveBeenCalledWith(
      'did:plc:past',
      expect.objectContaining({ rkey: 'rk' })
    );
  });
});

describe('checkExpirations — pending rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    mockGetAuthToken.mockResolvedValue(AUTH);
    mockGetTempBlocks.mockResolvedValue({});
    mockGetTempMutes.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an unblock rollback deletes the block record using repo = OWNER did', async () => {
    mockGetProcessableRollbacks.mockResolvedValue([
      {
        id: 'r1',
        type: 'unblock',
        did: 'did:plc:target',
        handle: 'target.bsky',
        rkey: 'rk1',
        attempts: 0,
      },
    ] as never);

    await checkExpirations();

    expect(mockExecuteApiRequest).toHaveBeenCalledWith(
      'com.atproto.repo.deleteRecord',
      'POST',
      {
        repo: AUTH.did, // owner did, NOT the blocked user's did
        collection: 'app.bsky.graph.block',
        rkey: 'rk1',
      },
      AUTH,
      { refresh: false }
    );
    expect(mockRemovePendingRollback).toHaveBeenCalledWith('r1');
  });
});
