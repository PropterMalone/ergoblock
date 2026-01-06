import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getTempBlocks,
  addTempBlock,
  removeTempBlock,
  getTempMutes,
  addTempMute,
  removeTempMute,
  getOptions,
  setOptions,
  getActionHistory,
  addHistoryEntry,
  removeAllExpiredBlocks,
  removeAllExpiredMutes,
} from '../storage.js';
import { DEFAULT_OPTIONS, HistoryEntry } from '../types.js';
import browser from '../browser.js';

// Get the mocked browser for assertions
const mockedBrowser = vi.mocked(browser);

describe('Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Temp Blocks', () => {
    it('should add and get a temp block', async () => {
      await addTempBlock('did:test:123', 'test.bsky.social', 3600000);

      const blocks = await getTempBlocks();
      expect(blocks['did:test:123']).toBeDefined();
      expect(blocks['did:test:123'].handle).toBe('test.bsky.social');
      expect(mockedBrowser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEMP_BLOCK_ADDED',
          did: 'did:test:123',
        })
      );
    });

    it('should remove a temp block', async () => {
      await addTempBlock('did:test:123', 'test.bsky.social');
      await removeTempBlock('did:test:123');

      const blocks = await getTempBlocks();
      expect(blocks['did:test:123']).toBeUndefined();
    });
  });

  describe('Temp Mutes', () => {
    it('should add and get a temp mute', async () => {
      await addTempMute('did:test:456', 'mute.bsky.social', 3600000);

      const mutes = await getTempMutes();
      expect(mutes['did:test:456']).toBeDefined();
      expect(mutes['did:test:456'].handle).toBe('mute.bsky.social');
      expect(mockedBrowser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEMP_MUTE_ADDED',
          did: 'did:test:456',
        })
      );
    });

    it('should remove a temp mute', async () => {
      await addTempMute('did:test:456', 'mute.bsky.social');
      await removeTempMute('did:test:456');

      const mutes = await getTempMutes();
      expect(mutes['did:test:456']).toBeUndefined();
    });
  });

  describe('Options', () => {
    it('should get default options when none are set', async () => {
      const options = await getOptions();
      expect(options).toEqual(DEFAULT_OPTIONS);
    });

    it('should set and get custom options', async () => {
      const customOptions = { ...DEFAULT_OPTIONS, theme: 'dark' as const };
      await setOptions(customOptions);

      const options = await getOptions();
      expect(options.theme).toBe('dark');
    });
  });

  describe('History', () => {
    it('should add and get history entries', async () => {
      const entry: HistoryEntry = {
        did: 'did:test:789',
        handle: 'history.bsky.social',
        action: 'blocked',
        timestamp: Date.now(),
        trigger: 'manual',
        success: true,
      };

      await addHistoryEntry(entry);

      const history = await getActionHistory();
      expect(history.length).toBe(1);
      expect(history[0].handle).toBe('history.bsky.social');
    });

    it('should limit history entries to HISTORY_MAX_ENTRIES (100)', async () => {
      for (let i = 0; i < 110; i++) {
        await addHistoryEntry({
          did: `did:test:${i}`,
          handle: `user${i}.bsky.social`,
          action: 'blocked',
          timestamp: Date.now(),
          trigger: 'manual',
          success: true,
        });
      }

      const history = await getActionHistory();
      expect(history.length).toBe(100);
      expect(history[0].handle).toBe('user109.bsky.social');
    });
  });

  describe('Cleanup', () => {
    it('should remove expired blocks', async () => {
      const now = Date.now();
      const blocks = {
        'did:expired': { handle: 'old', expiresAt: now - 1000, createdAt: now - 2000 },
        'did:active': { handle: 'new', expiresAt: now + 1000, createdAt: now },
      };
      await mockedBrowser.storage.sync.set({ tempBlocks: blocks });

      await removeAllExpiredBlocks();

      const updated = await getTempBlocks();
      expect(updated['did:expired']).toBeUndefined();
      expect(updated['did:active']).toBeDefined();
    });

    it('should remove expired mutes', async () => {
      const now = Date.now();
      const mutes = {
        'did:expired': { handle: 'old', expiresAt: now - 1000, createdAt: now - 2000 },
        'did:active': { handle: 'new', expiresAt: now + 1000, createdAt: now },
      };
      await mockedBrowser.storage.sync.set({ tempMutes: mutes });

      await removeAllExpiredMutes();

      const updated = await getTempMutes();
      expect(updated['did:expired']).toBeUndefined();
      expect(updated['did:active']).toBeDefined();
    });
  });
});
