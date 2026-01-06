import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DEFAULT_OPTIONS, type ExtensionOptions, type HistoryEntry } from '../types';

/**
 * Integration tests for the ErgoBlock extension workflow
 * These tests verify the end-to-end behavior of the extension components working together
 */

// Declare global for Node.js environment
declare const globalThis: {
  chrome: typeof chrome;
  fetch: typeof fetch;
};

// Types
interface AuthData {
  accessJwt: string;
  did: string;
  pdsUrl: string;
}

// Shared mock storage
let mockSyncStorage: Record<string, unknown> = {};
let mockLocalStorage: Record<string, unknown> = {};

// Message handlers for simulating inter-component communication
type MessageHandler = (
  message: Record<string, unknown>,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean | void;
let messageHandlers: MessageHandler[] = [];

// Mock Chrome APIs
const createMockChrome = () => ({
  storage: {
    sync: {
      get: vi.fn((key: string) => {
        if (typeof key === 'string') {
          return Promise.resolve({ [key]: mockSyncStorage[key] });
        }
        return Promise.resolve(mockSyncStorage);
      }),
      set: vi.fn((data: Record<string, unknown>) => {
        Object.assign(mockSyncStorage, data);
        return Promise.resolve();
      }),
    },
    local: {
      get: vi.fn((key: string) => {
        if (typeof key === 'string') {
          return Promise.resolve({ [key]: mockLocalStorage[key] });
        }
        return Promise.resolve(mockLocalStorage);
      }),
      set: vi.fn((data: Record<string, unknown>) => {
        Object.assign(mockLocalStorage, data);
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn((message: Record<string, unknown>) => {
      // Simulate message passing to background
      for (const handler of messageHandlers) {
        handler(message, {}, () => {});
      }
      return Promise.resolve();
    }),
    onMessage: {
      addListener: vi.fn((handler: MessageHandler) => {
        messageHandlers.push(handler);
      }),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
    onStartup: {
      addListener: vi.fn(),
    },
  },
  alarms: {
    create: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    onAlarm: {
      addListener: vi.fn(),
    },
  },
  action: {
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  },
  notifications: {
    create: vi.fn().mockResolvedValue('notification-id'),
  },
});

const mockFetch = vi.fn();

describe('Integration Tests', () => {
  let mockChrome: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    // Reset all state
    mockSyncStorage = {};
    mockLocalStorage = {};
    messageHandlers = [];

    vi.clearAllMocks();
    vi.resetModules();

    mockChrome = createMockChrome();
    globalThis.chrome = mockChrome as unknown as typeof chrome;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    // Set up default options
    mockLocalStorage['extensionOptions'] = DEFAULT_OPTIONS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Complete temp block workflow', () => {
    it('should add a temp block and notify background', async () => {
      const { addTempBlock, getTempBlocks } = await import('../storage');

      const did = 'did:plc:testuser';
      const handle = 'testuser.bsky.social';
      const duration = 3600000; // 1 hour

      // Add temp block
      await addTempBlock(did, handle, duration);

      // Verify block was stored
      const blocks = await getTempBlocks();
      expect(blocks[did]).toBeDefined();
      expect(blocks[did].handle).toBe(handle);
      expect(blocks[did].expiresAt).toBeGreaterThan(Date.now());

      // Verify message was sent to background
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEMP_BLOCK_ADDED',
          did,
        })
      );
    });

    it('should add a temp mute and notify background', async () => {
      const { addTempMute, getTempMutes } = await import('../storage');

      const did = 'did:plc:testuser';
      const handle = 'testuser.bsky.social';
      const duration = 21600000; // 6 hours

      await addTempMute(did, handle, duration);

      const mutes = await getTempMutes();
      expect(mutes[did]).toBeDefined();
      expect(mutes[did].handle).toBe(handle);

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEMP_MUTE_ADDED',
          did,
        })
      );
    });

    it('should track multiple blocks and mutes', async () => {
      const { addTempBlock, addTempMute, getTempBlocks, getTempMutes } = await import('../storage');

      // Add multiple blocks
      await addTempBlock('did:plc:user1', 'user1.bsky.social', 3600000);
      await addTempBlock('did:plc:user2', 'user2.bsky.social', 7200000);

      // Add multiple mutes
      await addTempMute('did:plc:user3', 'user3.bsky.social', 3600000);
      await addTempMute('did:plc:user4', 'user4.bsky.social', 86400000);

      const blocks = await getTempBlocks();
      const mutes = await getTempMutes();

      expect(Object.keys(blocks)).toHaveLength(2);
      expect(Object.keys(mutes)).toHaveLength(2);
    });
  });

  describe('Expiration workflow', () => {
    it('should identify expired entries', async () => {
      const { removeAllExpiredBlocks, getTempBlocks } = await import('../storage');

      const now = Date.now();

      // Set up mixed expired and active blocks
      mockSyncStorage['tempBlocks'] = {
        'did:plc:expired1': {
          handle: 'expired1.bsky.social',
          expiresAt: now - 1000,
          createdAt: now - 10000,
        },
        'did:plc:expired2': {
          handle: 'expired2.bsky.social',
          expiresAt: now - 500,
          createdAt: now - 5000,
        },
        'did:plc:active': {
          handle: 'active.bsky.social',
          expiresAt: now + 3600000,
          createdAt: now,
        },
      };

      await removeAllExpiredBlocks();

      const blocks = await getTempBlocks();
      expect(Object.keys(blocks)).toHaveLength(1);
      expect(blocks['did:plc:active']).toBeDefined();
      expect(blocks['did:plc:expired1']).toBeUndefined();
      expect(blocks['did:plc:expired2']).toBeUndefined();
    });

    it('should clean up expired mutes', async () => {
      const { removeAllExpiredMutes, getTempMutes } = await import('../storage');

      const now = Date.now();

      mockSyncStorage['tempMutes'] = {
        'did:plc:expired': {
          handle: 'expired.bsky.social',
          expiresAt: now - 1000,
          createdAt: now - 10000,
        },
        'did:plc:active': {
          handle: 'active.bsky.social',
          expiresAt: now + 3600000,
          createdAt: now,
        },
      };

      await removeAllExpiredMutes();

      const mutes = await getTempMutes();
      expect(Object.keys(mutes)).toHaveLength(1);
      expect(mutes['did:plc:active']).toBeDefined();
    });
  });

  describe('History tracking workflow', () => {
    it('should record block action in history', async () => {
      const { addHistoryEntry, getActionHistory } = await import('../storage');

      const entry: HistoryEntry = {
        did: 'did:plc:user1',
        handle: 'user1.bsky.social',
        action: 'blocked',
        timestamp: Date.now(),
        trigger: 'manual',
        success: true,
      };

      await addHistoryEntry(entry);

      const history = await getActionHistory();
      expect(history).toHaveLength(1);
      expect(history[0].action).toBe('blocked');
      expect(history[0].handle).toBe('user1.bsky.social');
    });

    it('should record expiration in history', async () => {
      const { addHistoryEntry, getActionHistory } = await import('../storage');

      const blockEntry: HistoryEntry = {
        did: 'did:plc:user1',
        handle: 'user1.bsky.social',
        action: 'blocked',
        timestamp: Date.now() - 3600000,
        trigger: 'manual',
        success: true,
      };

      const unblockEntry: HistoryEntry = {
        did: 'did:plc:user1',
        handle: 'user1.bsky.social',
        action: 'unblocked',
        timestamp: Date.now(),
        trigger: 'auto_expire',
        success: true,
        duration: 3600000,
      };

      await addHistoryEntry(blockEntry);
      await addHistoryEntry(unblockEntry);

      const history = await getActionHistory();
      expect(history).toHaveLength(2);
      // Newest first
      expect(history[0].action).toBe('unblocked');
      expect(history[0].trigger).toBe('auto_expire');
      expect(history[1].action).toBe('blocked');
    });

    it('should record failed operations', async () => {
      const { addHistoryEntry, getActionHistory } = await import('../storage');

      const failedEntry: HistoryEntry = {
        did: 'did:plc:user1',
        handle: 'user1.bsky.social',
        action: 'unblocked',
        timestamp: Date.now(),
        trigger: 'auto_expire',
        success: false,
        error: 'API request failed: 401 Unauthorized',
      };

      await addHistoryEntry(failedEntry);

      const history = await getActionHistory();
      expect(history[0].success).toBe(false);
      expect(history[0].error).toContain('401');
    });
  });

  describe('Options persistence workflow', () => {
    it('should persist and retrieve options', async () => {
      const { getOptions, setOptions } = await import('../storage');

      const customOptions: ExtensionOptions = {
        defaultDuration: 3600000,
        quickBlockDuration: 1800000,
        notificationsEnabled: false,
        notificationSound: true,
        checkInterval: 5,
        showBadgeCount: false,
        theme: 'dark',
        savePostContext: true,
        postContextRetentionDays: 90,
      };

      await setOptions(customOptions);

      // Simulate retrieving options
      mockLocalStorage['extensionOptions'] = customOptions;
      const retrieved = await getOptions();

      expect(retrieved.defaultDuration).toBe(3600000);
      expect(retrieved.theme).toBe('dark');
      expect(retrieved.notificationsEnabled).toBe(false);
    });

    it('should use default options when none stored', async () => {
      const { getOptions } = await import('../storage');

      mockLocalStorage['extensionOptions'] = undefined;

      const options = await getOptions();
      expect(options).toEqual(DEFAULT_OPTIONS);
    });
  });

  describe('Auth token workflow', () => {
    it('should store and retrieve auth token', async () => {
      const authData: AuthData = {
        accessJwt: 'eyJ0eXAiOiJhdCtqd3QiLCJhbGciOiJFUzI1NksifQ...',
        did: 'did:plc:testowner',
        pdsUrl: 'https://bsky.social',
      };

      // Simulate storing auth from content script
      await mockChrome.storage.local.set({ authToken: authData });

      expect(mockLocalStorage['authToken']).toEqual(authData);
    });

    it('should handle auth token update', async () => {
      const oldAuth: AuthData = {
        accessJwt: 'old-token',
        did: 'did:plc:testowner',
        pdsUrl: 'https://bsky.social',
      };

      const newAuth: AuthData = {
        accessJwt: 'new-refreshed-token',
        did: 'did:plc:testowner',
        pdsUrl: 'https://bsky.social',
      };

      await mockChrome.storage.local.set({ authToken: oldAuth });
      await mockChrome.storage.local.set({ authToken: newAuth });

      expect(mockLocalStorage['authToken']).toEqual(newAuth);
    });
  });

  describe('Full lifecycle test', () => {
    it('should handle complete block-expire-unblock cycle', async () => {
      const { addTempBlock, getTempBlocks, removeTempBlock, addHistoryEntry, getActionHistory } =
        await import('../storage');

      const did = 'did:plc:lifecycle-test';
      const handle = 'lifecycle.bsky.social';

      // Step 1: Block user
      await addTempBlock(did, handle, 3600000);
      await addHistoryEntry({
        did,
        handle,
        action: 'blocked',
        timestamp: Date.now(),
        trigger: 'manual',
        success: true,
      });

      let blocks = await getTempBlocks();
      expect(blocks[did]).toBeDefined();

      // Step 2: Simulate expiration check (block expired)
      // In real scenario, background would call unblock API
      await removeTempBlock(did);
      await addHistoryEntry({
        did,
        handle,
        action: 'unblocked',
        timestamp: Date.now(),
        trigger: 'auto_expire',
        success: true,
        duration: 3600000,
      });

      blocks = await getTempBlocks();
      expect(blocks[did]).toBeUndefined();

      // Step 3: Verify history
      const history = await getActionHistory();
      expect(history).toHaveLength(2);
      expect(history[0].action).toBe('unblocked');
      expect(history[1].action).toBe('blocked');
    });

    it('should handle sequential blocks and mutes', async () => {
      const { addTempBlock, addTempMute, getTempBlocks, getTempMutes } = await import('../storage');

      // Add blocks and mutes sequentially to avoid race conditions with mock storage
      await addTempBlock('did:plc:block1', 'block1.bsky.social', 3600000);
      await addTempBlock('did:plc:block2', 'block2.bsky.social', 7200000);
      await addTempMute('did:plc:mute1', 'mute1.bsky.social', 3600000);
      await addTempMute('did:plc:mute2', 'mute2.bsky.social', 86400000);

      const blocks = await getTempBlocks();
      const mutes = await getTempMutes();

      expect(Object.keys(blocks)).toHaveLength(2);
      expect(Object.keys(mutes)).toHaveLength(2);
    });
  });

  describe('Edge cases', () => {
    it('should handle re-blocking same user', async () => {
      const { addTempBlock, getTempBlocks } = await import('../storage');

      const did = 'did:plc:reblock-test';
      const handle = 'reblock.bsky.social';

      // First block - 1 hour
      await addTempBlock(did, handle, 3600000);
      const firstBlocks = await getTempBlocks();
      const firstExpiry = firstBlocks[did].expiresAt;

      // Re-block with longer duration - 24 hours
      await addTempBlock(did, handle, 86400000);
      const secondBlocks = await getTempBlocks();
      const secondExpiry = secondBlocks[did].expiresAt;

      // Should have updated expiry
      expect(secondExpiry).toBeGreaterThan(firstExpiry);
      expect(Object.keys(secondBlocks)).toHaveLength(1);
    });

    it('should handle removing non-existent block', async () => {
      const { removeTempBlock, getTempBlocks } = await import('../storage');

      mockSyncStorage['tempBlocks'] = {
        'did:plc:exists': {
          handle: 'exists.bsky.social',
          expiresAt: Date.now() + 3600000,
          createdAt: Date.now(),
        },
      };

      // Remove non-existent
      await removeTempBlock('did:plc:nonexistent');

      const blocks = await getTempBlocks();
      expect(Object.keys(blocks)).toHaveLength(1);
      expect(blocks['did:plc:exists']).toBeDefined();
    });

    it('should handle empty storage gracefully', async () => {
      const { getTempBlocks, getTempMutes, getActionHistory, getOptions } =
        await import('../storage');

      mockSyncStorage = {};
      mockLocalStorage = {};

      const blocks = await getTempBlocks();
      const mutes = await getTempMutes();
      const history = await getActionHistory();
      const options = await getOptions();

      expect(blocks).toEqual({});
      expect(mutes).toEqual({});
      expect(history).toEqual([]);
      expect(options).toEqual(DEFAULT_OPTIONS);
    });
  });
});
