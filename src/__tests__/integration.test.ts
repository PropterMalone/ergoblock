import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DEFAULT_OPTIONS, type ExtensionOptions, type HistoryEntry } from '../types';
import browser from '../browser';

/**
 * Integration tests for the ErgoBlock extension workflow
 * These tests verify the end-to-end behavior of the extension components working together
 */

// Get the mocked browser for assertions
const mockedBrowser = vi.mocked(browser);

// Types
interface AuthData {
  accessJwt: string;
  did: string;
  pdsUrl: string;
}

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(mockedBrowser.runtime.sendMessage).toHaveBeenCalledWith(
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

      expect(mockedBrowser.runtime.sendMessage).toHaveBeenCalledWith(
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
      await mockedBrowser.storage.sync.set({
        tempBlocks: {
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
        },
      });

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

      await mockedBrowser.storage.sync.set({
        tempMutes: {
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
        },
      });

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
        theme: 'dark',
        savePostContext: true,
        postContextRetentionDays: 90,
        forgivenessPeriodDays: 90,
        lastWordMuteEnabled: true,
        lastWordDelaySeconds: 60,
      };

      await setOptions(customOptions);

      const retrieved = await getOptions();

      expect(retrieved.defaultDuration).toBe(3600000);
      expect(retrieved.theme).toBe('dark');
      expect(retrieved.notificationsEnabled).toBe(false);
    });

    it('should use default options when none stored', async () => {
      const { getOptions } = await import('../storage');

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
      await mockedBrowser.storage.local.set({ authToken: authData });

      const result = await mockedBrowser.storage.local.get('authToken');
      expect(result.authToken).toEqual(authData);
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

      await mockedBrowser.storage.local.set({ authToken: oldAuth });
      await mockedBrowser.storage.local.set({ authToken: newAuth });

      const result = await mockedBrowser.storage.local.get('authToken');
      expect(result.authToken).toEqual(newAuth);
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

      await mockedBrowser.storage.sync.set({
        tempBlocks: {
          'did:plc:exists': {
            handle: 'exists.bsky.social',
            expiresAt: Date.now() + 3600000,
            createdAt: Date.now(),
          },
        },
      });

      // Remove non-existent
      await removeTempBlock('did:plc:nonexistent');

      const blocks = await getTempBlocks();
      expect(Object.keys(blocks)).toHaveLength(1);
      expect(blocks['did:plc:exists']).toBeDefined();
    });

    it('should handle empty storage gracefully', async () => {
      const { getTempBlocks, getTempMutes, getActionHistory, getOptions } =
        await import('../storage');

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
