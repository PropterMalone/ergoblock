import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock all dependencies from storage.js before importing background.ts
vi.mock('../storage.js', () => ({
  getTempBlocks: vi.fn().mockResolvedValue({}),
  getTempMutes: vi.fn().mockResolvedValue({}),
  removeTempBlock: vi.fn().mockResolvedValue(undefined),
  removeTempMute: vi.fn().mockResolvedValue(undefined),
  getOptions: vi
    .fn()
    .mockResolvedValue({ showBadgeCount: true, notificationsEnabled: true, checkInterval: 1 }),
  addHistoryEntry: vi.fn().mockResolvedValue(undefined),
  cleanupExpiredScreenshots: vi.fn().mockResolvedValue(undefined),
}));

describe('Background Service Worker', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Mock chrome API
    const chromeMock = {
      storage: {
        local: {
          get: vi
            .fn()
            .mockResolvedValue({ authToken: { accessJwt: 'test', did: 'test', pdsUrl: 'test' } }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: {
          addListener: vi.fn(),
        },
      },
      runtime: {
        onMessage: {
          addListener: vi.fn(),
        },
        onInstalled: {
          addListener: vi.fn(),
        },
        onStartup: {
          addListener: vi.fn(),
        },
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
      notifications: {
        create: vi.fn(),
      },
    };

    vi.stubGlobal('chrome', chromeMock);
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

  it('should setup alarm correctly', async () => {
    const { setupAlarm } = await import('../background.js');
    await setupAlarm();

    expect(chrome.alarms.clear).toHaveBeenCalledWith('checkExpirations');
    expect(chrome.alarms.create).toHaveBeenCalledWith('checkExpirations', expect.any(Object));
  });

  it('should update badge correctly', async () => {
    const { updateBadge } = await import('../background.js');
    await updateBadge();

    expect(chrome.action.setBadgeText).toHaveBeenCalled();
  });

  it('should check expirations and unblock/unmute expired users', async () => {
    const { checkExpirations } = await import('../background.js');
    const storage = await import('../storage.js');

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

  it('should mark auth invalid when no token is available during check', async () => {
    const { checkExpirations } = await import('../background.js');

    // Mock no auth token
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await checkExpirations();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ authStatus: 'invalid' })
    );
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
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ authToken: { accessJwt: 'new' } })
    );
  });
});
