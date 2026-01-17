/**
 * Tests for Block Relationship Cache Module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock browser before importing the module
vi.mock('../../browser.js', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
  },
}));

import browser from '../../browser.js';
import {
  getBlockRelationshipCache,
  setBlockRelationshipCache,
  updateFollows,
  updateFollowBlockList,
  removeFollowFromCache,
  startSync,
  finishSync,
  pruneCache,
  clearBlockRelationshipCache,
  getFollowBlockList,
  isBlockListStale,
  BLOCK_REL_STORAGE_KEYS,
} from '../../block-relationships/cache.js';
import type { BlockRelationshipCache, FollowedUser } from '../../types.js';

const mockGet = browser.storage.local.get as ReturnType<typeof vi.fn>;
const mockSet = browser.storage.local.set as ReturnType<typeof vi.fn>;
const mockRemove = browser.storage.local.remove as ReturnType<typeof vi.fn>;

describe('Block Relationship Cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBlockRelationshipCache', () => {
    it('should return empty cache when storage is empty', async () => {
      mockGet.mockResolvedValue({});

      const cache = await getBlockRelationshipCache();

      expect(cache).toEqual({
        follows: [],
        followBlockLists: {},
        lastFullSync: 0,
        syncInProgress: false,
        syncErrors: [],
        totalFollows: 0,
        syncedFollows: 0,
      });
    });

    it('should return cached data when present', async () => {
      const storedCache: BlockRelationshipCache = {
        follows: [{ did: 'did:plc:test', handle: 'test.bsky.social' }],
        followBlockLists: {},
        lastFullSync: 123456789,
        syncInProgress: false,
        syncErrors: [],
        totalFollows: 1,
        syncedFollows: 0,
      };
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: storedCache });

      const cache = await getBlockRelationshipCache();

      expect(cache).toEqual(storedCache);
    });
  });

  describe('setBlockRelationshipCache', () => {
    it('should store cache in local storage', async () => {
      mockSet.mockResolvedValue(undefined);

      const cache: BlockRelationshipCache = {
        follows: [],
        followBlockLists: {},
        lastFullSync: 0,
        syncInProgress: false,
        syncErrors: [],
        totalFollows: 0,
        syncedFollows: 0,
      };

      await setBlockRelationshipCache(cache);

      expect(mockSet).toHaveBeenCalledWith({
        [BLOCK_REL_STORAGE_KEYS.CACHE]: cache,
      });
    });
  });

  describe('updateFollows', () => {
    it('should update follows list and totalFollows count', async () => {
      mockGet.mockResolvedValue({});
      mockSet.mockResolvedValue(undefined);

      const follows: FollowedUser[] = [
        { did: 'did:plc:1', handle: 'user1.bsky.social' },
        { did: 'did:plc:2', handle: 'user2.bsky.social' },
      ];

      await updateFollows(follows);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          [BLOCK_REL_STORAGE_KEYS.CACHE]: expect.objectContaining({
            follows,
            totalFollows: 2,
          }),
        })
      );
    });
  });

  describe('updateFollowBlockList', () => {
    it('should add new follow block list entry', async () => {
      mockGet.mockResolvedValue({});
      mockSet.mockResolvedValue(undefined);

      await updateFollowBlockList('did:plc:test', ['did:plc:blocked1', 'did:plc:blocked2'], {
        handle: 'test.bsky.social',
        displayName: 'Test User',
      });

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          [BLOCK_REL_STORAGE_KEYS.CACHE]: expect.objectContaining({
            followBlockLists: expect.objectContaining({
              'did:plc:test': expect.objectContaining({
                did: 'did:plc:test',
                handle: 'test.bsky.social',
                displayName: 'Test User',
                blocks: ['did:plc:blocked1', 'did:plc:blocked2'],
              }),
            }),
            syncedFollows: 1,
          }),
        })
      );
    });
  });

  describe('removeFollowFromCache', () => {
    it('should remove follow and their block list from cache', async () => {
      const existingCache: BlockRelationshipCache = {
        follows: [
          { did: 'did:plc:1', handle: 'user1' },
          { did: 'did:plc:2', handle: 'user2' },
        ],
        followBlockLists: {
          'did:plc:1': { did: 'did:plc:1', handle: 'user1', blocks: [], lastSync: 0 },
          'did:plc:2': { did: 'did:plc:2', handle: 'user2', blocks: [], lastSync: 0 },
        },
        lastFullSync: 0,
        syncInProgress: false,
        syncErrors: [],
        totalFollows: 2,
        syncedFollows: 2,
      };
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: existingCache });
      mockSet.mockResolvedValue(undefined);

      await removeFollowFromCache('did:plc:1');

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          [BLOCK_REL_STORAGE_KEYS.CACHE]: expect.objectContaining({
            follows: [{ did: 'did:plc:2', handle: 'user2' }],
            totalFollows: 1,
            syncedFollows: 1,
          }),
        })
      );
    });
  });

  describe('startSync and finishSync', () => {
    it('should set sync in progress with total follows count', async () => {
      mockGet.mockResolvedValue({});
      mockSet.mockResolvedValue(undefined);

      await startSync(100);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          [BLOCK_REL_STORAGE_KEYS.SYNC_STATUS]: expect.objectContaining({
            isRunning: true,
            totalFollows: 100,
            syncedFollows: 0,
            errors: [],
          }),
        })
      );
    });

    it('should complete sync and record timestamp', async () => {
      mockGet.mockResolvedValue({});
      mockSet.mockResolvedValue(undefined);

      const beforeTime = Date.now();
      await finishSync(['error1']);
      const afterTime = Date.now();

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          [BLOCK_REL_STORAGE_KEYS.CACHE]: expect.objectContaining({
            syncInProgress: false,
            syncErrors: ['error1'],
            lastFullSync: expect.any(Number),
          }),
        })
      );

      // Verify timestamp is reasonable
      const call = mockSet.mock.calls.find((c) => c[0][BLOCK_REL_STORAGE_KEYS.CACHE]?.lastFullSync);
      const timestamp = call?.[0][BLOCK_REL_STORAGE_KEYS.CACHE].lastFullSync;
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('getFollowBlockList', () => {
    it('should return null for non-existent follow', async () => {
      mockGet.mockResolvedValue({});

      const result = await getFollowBlockList('did:plc:nonexistent');

      expect(result).toBeNull();
    });

    it('should return block list entry when exists', async () => {
      const blockEntry = {
        did: 'did:plc:test',
        handle: 'test',
        blocks: ['did:plc:blocked'],
        lastSync: 123456789,
      };
      mockGet.mockResolvedValue({
        [BLOCK_REL_STORAGE_KEYS.CACHE]: {
          follows: [],
          followBlockLists: { 'did:plc:test': blockEntry },
          lastFullSync: 0,
          syncInProgress: false,
          syncErrors: [],
          totalFollows: 0,
          syncedFollows: 1,
        },
      });

      const result = await getFollowBlockList('did:plc:test');

      expect(result).toEqual(blockEntry);
    });
  });

  describe('isBlockListStale', () => {
    it('should return true for non-existent entry', async () => {
      mockGet.mockResolvedValue({});

      const isStale = await isBlockListStale('did:plc:nonexistent', 60000);

      expect(isStale).toBe(true);
    });

    it('should return true if entry is older than maxAge', async () => {
      const oldTimestamp = Date.now() - 120000; // 2 minutes ago
      mockGet.mockResolvedValue({
        [BLOCK_REL_STORAGE_KEYS.CACHE]: {
          follows: [],
          followBlockLists: {
            'did:plc:test': {
              did: 'did:plc:test',
              handle: 'test',
              blocks: [],
              lastSync: oldTimestamp,
            },
          },
          lastFullSync: 0,
          syncInProgress: false,
          syncErrors: [],
          totalFollows: 0,
          syncedFollows: 1,
        },
      });

      const isStale = await isBlockListStale('did:plc:test', 60000); // 1 minute max age

      expect(isStale).toBe(true);
    });

    it('should return false if entry is fresh', async () => {
      const recentTimestamp = Date.now() - 30000; // 30 seconds ago
      mockGet.mockResolvedValue({
        [BLOCK_REL_STORAGE_KEYS.CACHE]: {
          follows: [],
          followBlockLists: {
            'did:plc:test': {
              did: 'did:plc:test',
              handle: 'test',
              blocks: [],
              lastSync: recentTimestamp,
            },
          },
          lastFullSync: 0,
          syncInProgress: false,
          syncErrors: [],
          totalFollows: 0,
          syncedFollows: 1,
        },
      });

      const isStale = await isBlockListStale('did:plc:test', 60000); // 1 minute max age

      expect(isStale).toBe(false);
    });
  });

  describe('clearBlockRelationshipCache', () => {
    it('should remove cache and sync status from storage', async () => {
      mockRemove.mockResolvedValue(undefined);

      await clearBlockRelationshipCache();

      expect(mockRemove).toHaveBeenCalledWith([
        BLOCK_REL_STORAGE_KEYS.CACHE,
        BLOCK_REL_STORAGE_KEYS.SYNC_STATUS,
      ]);
    });
  });

  describe('pruneCache', () => {
    it('should not prune if under size limit', async () => {
      const smallCache: BlockRelationshipCache = {
        follows: [],
        followBlockLists: {
          'did:plc:1': { did: 'did:plc:1', handle: 'user1', blocks: [], lastSync: 100 },
        },
        lastFullSync: 0,
        syncInProgress: false,
        syncErrors: [],
        totalFollows: 1,
        syncedFollows: 1,
      };
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: smallCache });

      const prunedCount = await pruneCache(8 * 1024 * 1024); // 8MB limit

      expect(prunedCount).toBe(0);
    });

    it('should prune oldest entries when over size limit', async () => {
      // Create a large cache that would exceed size limit
      const largeBlockList = Array.from({ length: 10000 }, (_, i) => `did:plc:blocked${i}`);
      const largeCache: BlockRelationshipCache = {
        follows: [],
        followBlockLists: {
          'did:plc:old': {
            did: 'did:plc:old',
            handle: 'old',
            blocks: largeBlockList,
            lastSync: 100, // Oldest
          },
          'did:plc:new': {
            did: 'did:plc:new',
            handle: 'new',
            blocks: largeBlockList,
            lastSync: 200, // Newer
          },
        },
        lastFullSync: 0,
        syncInProgress: false,
        syncErrors: [],
        totalFollows: 2,
        syncedFollows: 2,
      };
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: largeCache });
      mockSet.mockResolvedValue(undefined);

      // Set a very low limit to force pruning
      const prunedCount = await pruneCache(1000);

      // Should have pruned at least the oldest entry
      expect(prunedCount).toBeGreaterThan(0);
    });
  });
});
