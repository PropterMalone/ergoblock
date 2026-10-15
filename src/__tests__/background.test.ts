import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import browser from '../platform/browser';

// Get the mocked browser
const mockedBrowser = vi.mocked(browser);

// Mock all dependencies from storage.js before importing background.ts
vi.mock('../platform/storage.js', () => ({
  withTrackingLock: vi.fn(async (work: () => Promise<unknown>) => work()),
  trackingMatches: vi.fn(() => true),
  getTempBlocks: vi.fn().mockResolvedValue({}),
  getTempMutes: vi.fn().mockResolvedValue({}),
  removeTempBlock: vi.fn().mockResolvedValue(undefined),
  removeTempMute: vi.fn().mockResolvedValue(undefined),
  getOptions: vi.fn().mockResolvedValue({ notificationsEnabled: true, checkInterval: 1 }),
  addHistoryEntry: vi.fn().mockResolvedValue(undefined),
  cleanupExpiredPostContexts: vi.fn().mockResolvedValue(undefined),
  getSyncState: vi
    .fn()
    .mockResolvedValue({ syncInProgress: false, lastBlockSync: 0, lastMuteSync: 0 }),
  updateSyncState: vi.fn().mockResolvedValue(undefined),
  getPostContexts: vi.fn().mockResolvedValue([]),
  getBlocklistAuditState: vi.fn().mockResolvedValue({ syncInProgress: false, lastSyncAt: 0 }),
  updateBlocklistAuditState: vi.fn().mockResolvedValue(undefined),
  // Pending rollback queue functions
  getProcessableRollbacks: vi.fn().mockResolvedValue([]),
  getPendingRollbacks: vi.fn().mockResolvedValue([]),
  updatePendingRollback: vi.fn().mockResolvedValue(undefined),
  removePendingRollback: vi.fn().mockResolvedValue(undefined),
  cleanupOldRollbacks: vi.fn().mockResolvedValue(0),
}));

describe('Background Service Worker', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Set up auth token in storage for tests that need it
    mockedBrowser.storage.local.get = vi
      .fn()
      .mockResolvedValue({ authToken: { accessJwt: 'test', did: 'test', pdsUrl: 'test' } });
    mockedBrowser.storage.local.set = vi.fn().mockResolvedValue(undefined);
    mockedBrowser.storage.local.remove = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should initialize correctly', async () => {
    // Importing background.ts triggers the top-level listeners
    await import('../background.js');

    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalled();
    expect(chrome.runtime.onStartup.addListener).toHaveBeenCalled();
  });

  it('does not schedule retired jobs or mutate legacy feature data at startup', async () => {
    await import('../background.js');
    await vi.waitFor(() => expect(browser.alarms.clear).toHaveBeenCalledWith('clearskyQueue'));
    expect(browser.alarms.clear).toHaveBeenCalledWith('followsSync');
    for (const [name] of vi.mocked(browser.alarms.create).mock.calls) {
      expect(['checkExpirations', 'syncWithBluesky']).toContain(name);
    }
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
  });

  it.each([
    'FIND_CONTEXT',
    'FETCH_ALL_INTERACTIONS',
    'FIND_INTERACTIONS_BEFORE',
    'BACKFILL_REVIEW_QUEUE',
    'DISMISS_REVIEW',
    'MARK_PERMANENT_REVIEWED',
    'BLOCKLIST_AUDIT_SYNC',
    'RECTIFY_AMNESTY_UNBLOCKS',
    'PREWARM_CLEARSKY_CACHE',
  ])('rejects retired message %s', async (type) => {
    await import('../background.js');
    const listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls[0][0];
    const result = await listener({ type }, {}, vi.fn());
    expect(result).toBeUndefined();
  });

  it('should setup alarm correctly', async () => {
    const { setupAlarm } = await import('../background.js');
    await setupAlarm();

    expect(chrome.alarms.clear).toHaveBeenCalledWith('checkExpirations');
    expect(chrome.alarms.create).toHaveBeenCalledWith('checkExpirations', expect.any(Object));
  });

  it('should check expirations and unblock/unmute expired users', async () => {
    const { checkExpirations } = await import('../background.js');
    const storage = await import('../platform/storage.js');

    // Mock fetch for unblocking/unmuting
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            records: [
              {
                uri: 'at://did:test:123/app.bsky.graph.block/rkey123',
                value: { subject: 'did:expired' },
              },
            ],
          })
        ),
      json: () => Promise.resolve({}),
    });

    const now = Date.now();
    (storage.getTempBlocks as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      'did:expired': { handle: 'expired-user', expiresAt: now - 1000 },
    });
    (storage.getTempMutes as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      'did:active': { handle: 'active-user', expiresAt: now + 1000 },
    });

    await checkExpirations();

    // It should try to unblock the expired user
    expect(storage.getTempBlocks).toHaveBeenCalled();
    expect(storage.getTempMutes).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it('CHECK_NOW reports skipped auth and successful checks truthfully', async () => {
    await import('../background.js');
    vi.mocked(mockedBrowser.storage.local.get).mockResolvedValue({});
    const listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls[0][0];
    expect(await listener({ type: 'CHECK_NOW' }, {}, vi.fn())).toMatchObject({
      success: false,
      outcome: { status: 'needs_auth', authNeedsAttention: true },
    });
    vi.mocked(mockedBrowser.storage.local.get).mockResolvedValue({
      authToken: { accessJwt: 'test', did: 'test', pdsUrl: 'test' },
    });
    const storage = await import('../platform/storage.js');
    vi.mocked(storage.getTempBlocks).mockResolvedValue({});
    vi.mocked(storage.getTempMutes).mockResolvedValue({});
    expect(await listener({ type: 'CHECK_NOW' }, {}, vi.fn())).toMatchObject({
      success: true,
      outcome: { status: 'success', healthSaved: true },
    });
  });

  it('reports authentication attention when no token is available during check', async () => {
    const { checkExpirations } = await import('../background.js');

    // Mock no auth token
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const result = await checkExpirations();
    expect(result.status).toBe('needs_auth');
    expect(result.authNeedsAttention).toBe(true);
  });

  it('should unblock user correctly', async () => {
    const { unblockUser } = await import('../background.js');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            records: [
              {
                uri: 'at://did:test:123/app.bsky.graph.block/rkey123',
                value: { subject: 'did:target:456' },
              },
            ],
          })
        ),
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(''),
    });

    await unblockUser('did:target:456', 'token', 'owner', 'https://pds.com');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should unblock user directly when rkey is provided', async () => {
    const { unblockUser } = await import('../background.js');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });

    await unblockUser('did:target:456', 'token', 'owner', 'https://pds.com', 'known-rkey-123');

    // Should only call deleteRecord (1 call), skipping listRecords
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('deleteRecord'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('known-rkey-123'),
      })
    );
  });

  it('should unmute user correctly', async () => {
    const { unmuteUser } = await import('../background.js');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(''),
    });

    await unmuteUser('did:target:456', 'token', 'https://pds.com');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should mark auth invalid on 401 error', async () => {
    mockedBrowser.storage.local.get = vi.fn().mockResolvedValue({
      authToken: { accessJwt: 'token', did: 'owner', pdsUrl: 'https://pds.com' },
    });
    const { unblockUser } = await import('../background.js');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    try {
      await unblockUser('did:target:456', 'token', 'owner', 'https://pds.com');
    } catch (_e) {
      // Expected
    }

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ authStatus: 'invalid' })
    );
  });

  it('should handle messages correctly', async () => {
    // This triggers the runtime.onMessage listener setup in background.ts
    await import('../background.js');

    const onMessageListener = (
      chrome.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    const sendResponse = vi.fn();

    // Test TEMP_BLOCK_ADDED message
    onMessageListener({ type: 'TEMP_BLOCK_ADDED' }, {}, sendResponse);

    // setupAlarm is async and not awaited in the listener, so we need to wait a tick
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chrome.alarms.create).toHaveBeenCalled();

    // Test SET_AUTH_TOKEN message
    onMessageListener({ type: 'SET_AUTH_TOKEN', auth: { accessJwt: 'new' } }, {}, sendResponse);
    await vi.waitFor(() =>
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ authToken: { accessJwt: 'new' } })
      )
    );
  });
});
