import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getBlockedByCache,
  saveBlockedByCache,
  invalidateBlockedByCache,
  getAllBlockedByCache,
  clearAllBlockedByCache,
  queueForFetch,
  getQueueEntry,
  getPendingQueue,
  updateQueueStatus,
  removeFromQueue,
  clearCompletedQueue,
  clearClearskyCache,
  getClearskyStats,
} from '../platform/clearskyCache.js';

// The global IndexedDB mock from vitest.setup.ts auto-resolves with null/[]

describe('clearskyCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Blocked-By Cache ─────────────────────────────────────────────────────

  describe('getBlockedByCache', () => {
    it('should return null when no cached data exists', async () => {
      const result = await getBlockedByCache('did:plc:target');
      expect(result).toBeNull();
    });
  });

  describe('saveBlockedByCache', () => {
    it('should save blocked-by data without throwing', async () => {
      await expect(
        saveBlockedByCache({
          targetDid: 'did:plc:target',
          blockerDids: ['did:plc:blocker1', 'did:plc:blocker2'],
          totalCount: 2,
          fetchedAt: Date.now(),
          complete: true,
        })
      ).resolves.not.toThrow();
    });
  });

  describe('invalidateBlockedByCache', () => {
    it('should invalidate cache without throwing', async () => {
      await expect(invalidateBlockedByCache('did:plc:target')).resolves.not.toThrow();
    });
  });

  describe('getAllBlockedByCache', () => {
    it('should return empty array when no cached data exists', async () => {
      const result = await getAllBlockedByCache();
      expect(result).toEqual([]);
    });
  });

  describe('clearAllBlockedByCache', () => {
    it('should clear all blocked-by cache without throwing', async () => {
      await expect(clearAllBlockedByCache()).resolves.not.toThrow();
    });
  });

  // ── Fetch Queue ──────────────────────────────────────────────────────────

  describe('queueForFetch', () => {
    it('should queue a target for fetch without throwing', async () => {
      await expect(queueForFetch('did:plc:target', 5)).resolves.not.toThrow();
    });

    it('should use default priority when not specified', async () => {
      await expect(queueForFetch('did:plc:target')).resolves.not.toThrow();
    });
  });

  describe('getQueueEntry', () => {
    it('should return null when entry does not exist', async () => {
      const result = await getQueueEntry('did:plc:nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getPendingQueue', () => {
    it('should return empty array when no pending entries', async () => {
      const result = await getPendingQueue();
      expect(result).toEqual([]);
    });
  });

  describe('updateQueueStatus', () => {
    it('should handle update when entry does not exist', async () => {
      // getQueueEntry returns null, so update should be a no-op
      await expect(updateQueueStatus('did:plc:nonexistent', 'completed')).resolves.not.toThrow();
    });

    it('should handle failed status with error message', async () => {
      await expect(
        updateQueueStatus('did:plc:target', 'failed', 'Rate limited')
      ).resolves.not.toThrow();
    });
  });

  describe('removeFromQueue', () => {
    it('should remove entry without throwing', async () => {
      await expect(removeFromQueue('did:plc:target')).resolves.not.toThrow();
    });
  });

  describe('clearCompletedQueue', () => {
    it('should clear completed/failed entries without throwing', async () => {
      await expect(clearCompletedQueue()).resolves.not.toThrow();
    });
  });

  // ── Cache Management ─────────────────────────────────────────────────────

  describe('clearClearskyCache', () => {
    it('should clear all cache data without throwing', async () => {
      await expect(clearClearskyCache()).resolves.not.toThrow();
    });
  });

  describe('getClearskyStats', () => {
    it('should return zero stats when cache is empty', async () => {
      const stats = await getClearskyStats();
      expect(stats).toEqual({
        cachedTargets: 0,
        totalBlockers: 0,
        queuedPending: 0,
        queuedFailed: 0,
      });
    });
  });
});
