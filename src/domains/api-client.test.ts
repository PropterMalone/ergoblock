// pattern: imperative shell (auth refresh orchestration over tabs + direct refreshSession)
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// browser is the extension API boundary; storage.getOptions is unused on these paths.
// We mock browser.tabs (tab-first refresh) and browser.storage.local (auth persistence),
// plus global fetch (the direct refreshSession network call).

vi.mock('../platform/browser.js', () => ({
  default: {
    tabs: {
      query: vi.fn(),
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

vi.mock('../platform/storage.js', () => ({
  getOptions: vi.fn().mockResolvedValue({}),
}));

import browser from '../platform/browser.js';
import { refreshSession, refreshViaRefreshToken } from './api-client.js';

const mockTabsQuery = vi.mocked(browser.tabs.query);
const mockTabsSendMessage = vi.mocked(browser.tabs.sendMessage);
const mockStorageSet = vi.mocked(browser.storage.local.set);

const AUTH = {
  accessJwt: 'old-access',
  refreshJwt: 'refresh-token',
  did: 'did:plc:owner',
  pdsUrl: 'https://pds.example',
};

describe('refreshSession — tab-first, direct fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('prefers an open Bluesky tab and does NOT call the direct refreshSession', async () => {
    const tabAuth = { ...AUTH, accessJwt: 'fresh-from-tab' };
    mockTabsQuery.mockResolvedValue([{ id: 1 }] as never);
    mockTabsSendMessage.mockResolvedValue({ auth: tabAuth } as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await refreshSession(AUTH);

    expect(result).toEqual(tabAuth);
    // No direct network refresh when a tab supplied fresh auth.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to a direct refreshSession when no Bluesky tab is open', async () => {
    mockTabsQuery.mockResolvedValue([] as never);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessJwt: 'new-access', refreshJwt: 'new-refresh', did: AUTH.did }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await refreshSession(AUTH);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result?.accessJwt).toBe('new-access');
    expect(result?.did).toBe(AUTH.did);
  });
});

describe('refreshViaRefreshToken — DID cross-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null with no refresh token', async () => {
    const result = await refreshViaRefreshToken({ ...AUTH, refreshJwt: '' });
    expect(result).toBeNull();
  });

  it('rejects (returns null) when the refreshed DID differs from the stored DID', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accessJwt: 'new-access',
        refreshJwt: 'new-refresh',
        did: 'did:plc:ATTACKER',
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await refreshViaRefreshToken(AUTH);

    expect(result).toBeNull();
    // Must NOT persist the substituted auth.
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('stores and returns new auth when the DID matches', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessJwt: 'new-access', refreshJwt: 'new-refresh', did: AUTH.did }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await refreshViaRefreshToken(AUTH);

    expect(result?.accessJwt).toBe('new-access');
    expect(result?.did).toBe(AUTH.did);
    expect(mockStorageSet).toHaveBeenCalledWith(expect.objectContaining({ authStatus: 'valid' }));
  });

  it('returns null on a non-ok response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await refreshViaRefreshToken(AUTH);
    expect(result).toBeNull();
  });
});
