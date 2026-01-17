/**
 * Tests for Block Relationship Lookup Module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock browser before importing the module
vi.mock('../../browser.js', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));

import browser from '../../browser.js';
import {
  getBlockRelationshipsForProfile,
  getBlockersAmongFollows,
  isBlockedByAnyFollow,
  getBlockerCount,
  getBlockedByFollow,
  findCommonBlockers,
  searchFollows,
  getBlockRelationshipStats,
} from '../../block-relationships/lookup.js';
import { BLOCK_REL_STORAGE_KEYS } from '../../block-relationships/cache.js';
import type { BlockRelationshipCache } from '../../types.js';

const mockGet = browser.storage.local.get as ReturnType<typeof vi.fn>;

// Helper to create a test cache
function createTestCache(overrides?: Partial<BlockRelationshipCache>): BlockRelationshipCache {
  return {
    follows: [],
    followBlockLists: {},
    lastFullSync: 0,
    syncInProgress: false,
    syncErrors: [],
    totalFollows: 0,
    syncedFollows: 0,
    ...overrides,
  };
}

describe('Block Relationship Lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBlockRelationshipsForProfile', () => {
    it('should return empty arrays when no block relationships exist', async () => {
      const cache = createTestCache();
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const result = await getBlockRelationshipsForProfile('did:plc:target');

      expect(result.blockedBy).toEqual([]);
      expect(result.blocking).toEqual([]);
      expect(result.lastChecked).toBeGreaterThan(0);
    });

    it('should return follows who block the target profile', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice.bsky.social',
            displayName: 'Alice',
            blocks: ['did:plc:target', 'did:plc:other'],
            lastSync: Date.now(),
          },
          'did:plc:bob': {
            did: 'did:plc:bob',
            handle: 'bob.bsky.social',
            blocks: ['did:plc:someone_else'],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const result = await getBlockRelationshipsForProfile('did:plc:target');

      expect(result.blockedBy).toHaveLength(1);
      expect(result.blockedBy[0].did).toBe('did:plc:alice');
      expect(result.blockedBy[0].handle).toBe('alice.bsky.social');
      expect(result.blockedBy[0].displayName).toBe('Alice');
    });

    it('should use provided cache if given', async () => {
      const providedCache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice',
            blocks: ['did:plc:target'],
            lastSync: Date.now(),
          },
        },
      });

      const result = await getBlockRelationshipsForProfile('did:plc:target', providedCache);

      expect(result.blockedBy).toHaveLength(1);
      expect(mockGet).not.toHaveBeenCalled(); // Should use provided cache
    });
  });

  describe('getBlockersAmongFollows', () => {
    it('should return all follows who block the target', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice',
            blocks: ['did:plc:target'],
            lastSync: Date.now(),
          },
          'did:plc:bob': {
            did: 'did:plc:bob',
            handle: 'bob',
            blocks: ['did:plc:target'],
            lastSync: Date.now(),
          },
          'did:plc:carol': {
            did: 'did:plc:carol',
            handle: 'carol',
            blocks: ['did:plc:other'],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const blockers = await getBlockersAmongFollows('did:plc:target');

      expect(blockers).toHaveLength(2);
      expect(blockers.map((b) => b.did)).toContain('did:plc:alice');
      expect(blockers.map((b) => b.did)).toContain('did:plc:bob');
    });
  });

  describe('isBlockedByAnyFollow', () => {
    it('should return false when no follows block the target', async () => {
      const cache = createTestCache();
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const isBlocked = await isBlockedByAnyFollow('did:plc:target');

      expect(isBlocked).toBe(false);
    });

    it('should return true when at least one follow blocks the target', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice',
            blocks: ['did:plc:target'],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const isBlocked = await isBlockedByAnyFollow('did:plc:target');

      expect(isBlocked).toBe(true);
    });
  });

  describe('getBlockerCount', () => {
    it('should return count of follows who block the target', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice',
            blocks: ['did:plc:target'],
            lastSync: Date.now(),
          },
          'did:plc:bob': {
            did: 'did:plc:bob',
            handle: 'bob',
            blocks: ['did:plc:target'],
            lastSync: Date.now(),
          },
          'did:plc:carol': {
            did: 'did:plc:carol',
            handle: 'carol',
            blocks: [],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const count = await getBlockerCount('did:plc:target');

      expect(count).toBe(2);
    });
  });

  describe('getBlockedByFollow', () => {
    it('should return empty array for non-existent follow', async () => {
      const cache = createTestCache();
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const blocks = await getBlockedByFollow('did:plc:nonexistent');

      expect(blocks).toEqual([]);
    });

    it('should return all DIDs blocked by a specific follow', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice',
            blocks: ['did:plc:target1', 'did:plc:target2', 'did:plc:target3'],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const blocks = await getBlockedByFollow('did:plc:alice');

      expect(blocks).toEqual(['did:plc:target1', 'did:plc:target2', 'did:plc:target3']);
    });
  });

  describe('findCommonBlockers', () => {
    it('should return empty array for empty input', async () => {
      const result = await findCommonBlockers([]);

      expect(result).toEqual([]);
    });

    it('should find follows who block all specified profiles', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice',
            blocks: ['did:plc:target1', 'did:plc:target2'], // Blocks both
            lastSync: Date.now(),
          },
          'did:plc:bob': {
            did: 'did:plc:bob',
            handle: 'bob',
            blocks: ['did:plc:target1'], // Only blocks one
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const commonBlockers = await findCommonBlockers(['did:plc:target1', 'did:plc:target2']);

      expect(commonBlockers).toHaveLength(1);
      expect(commonBlockers[0].did).toBe('did:plc:alice');
    });
  });

  describe('searchFollows', () => {
    it('should find follows by handle', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice.bsky.social',
            blocks: ['did:plc:1'],
            lastSync: Date.now(),
          },
          'did:plc:bob': {
            did: 'did:plc:bob',
            handle: 'bob.bsky.social',
            blocks: ['did:plc:1', 'did:plc:2'],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const results = await searchFollows('alice');

      expect(results).toHaveLength(1);
      expect(results[0].handle).toBe('alice.bsky.social');
      expect(results[0].blockCount).toBe(1);
    });

    it('should find follows by display name', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice.bsky.social',
            displayName: 'Alice Wonder',
            blocks: [],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const results = await searchFollows('Wonder');

      expect(results).toHaveLength(1);
      expect(results[0].displayName).toBe('Alice Wonder');
    });

    it('should sort results by block count descending', async () => {
      const cache = createTestCache({
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice',
            blocks: ['did:plc:1'],
            lastSync: Date.now(),
          },
          'did:plc:alice2': {
            did: 'did:plc:alice2',
            handle: 'alice2',
            blocks: ['did:plc:1', 'did:plc:2', 'did:plc:3'],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const results = await searchFollows('alice');

      expect(results).toHaveLength(2);
      expect(results[0].blockCount).toBe(3); // alice2 should be first
      expect(results[1].blockCount).toBe(1);
    });
  });

  describe('getBlockRelationshipStats', () => {
    it('should calculate statistics correctly', async () => {
      const cache = createTestCache({
        totalFollows: 100,
        lastFullSync: 123456789,
        followBlockLists: {
          'did:plc:alice': {
            did: 'did:plc:alice',
            handle: 'alice',
            blocks: ['did:plc:1', 'did:plc:2'],
            lastSync: Date.now(),
          },
          'did:plc:bob': {
            did: 'did:plc:bob',
            handle: 'bob',
            blocks: ['did:plc:3'],
            lastSync: Date.now(),
          },
        },
      });
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const stats = await getBlockRelationshipStats();

      expect(stats.totalFollows).toBe(100);
      expect(stats.syncedFollows).toBe(2);
      expect(stats.totalBlocksTracked).toBe(3); // 2 + 1
      expect(stats.averageBlocksPerFollow).toBe(2); // 3/2 rounded
      expect(stats.lastSync).toBe(123456789);
    });

    it('should handle empty cache', async () => {
      const cache = createTestCache();
      mockGet.mockResolvedValue({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });

      const stats = await getBlockRelationshipStats();

      expect(stats.totalFollows).toBe(0);
      expect(stats.syncedFollows).toBe(0);
      expect(stats.totalBlocksTracked).toBe(0);
      expect(stats.averageBlocksPerFollow).toBe(0);
      expect(stats.lastSync).toBe(0);
    });
  });
});
