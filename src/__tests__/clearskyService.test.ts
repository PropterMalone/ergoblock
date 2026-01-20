import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getFollowsWhoBlock,
  getFollowsWhoBlockCached,
  hasValidCache,
  fetchBlockedByFromClearsky,
  queueBlockedByFetch,
  processBlockedByQueue,
  prewarmBlockedByCache,
  getBatchBlockedByCounts,
} from '../clearskyService.js';
import * as clearskyCache from '../clearskyCache.js';

vi.mock('../clearskyCache.js');

const mockGetBlockedByCache = vi.mocked(clearskyCache.getBlockedByCache);
const mockSaveBlockedByCache = vi.mocked(clearskyCache.saveBlockedByCache);
const mockQueueForFetch = vi.mocked(clearskyCache.queueForFetch);
const mockGetPendingQueue = vi.mocked(clearskyCache.getPendingQueue);
const mockUpdateQueueStatus = vi.mocked(clearskyCache.updateQueueStatus);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', mockFetch);
});

describe('clearskyService', () => {
  describe('fetchBlockedByFromClearsky', () => {
    it('fetches blockers from Clearsky API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            blocklist: [
              { did: 'did:plc:blocker1', blocked_date: '2024-01-01T00:00:00Z' },
              { did: 'did:plc:blocker2', blocked_date: '2024-01-02T00:00:00Z' },
            ],
          },
          identity: 'target.bsky.social',
          status: true,
        }),
      });

      const result = await fetchBlockedByFromClearsky('did:plc:target');

      expect(result.blockerDids).toEqual(['did:plc:blocker1', 'did:plc:blocker2']);
      expect(result.complete).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('identifier=did%3Aplc%3Atarget')
      );
    });

    it('handles pagination with cursor', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              blocklist: [{ did: 'did:plc:blocker1', blocked_date: '2024-01-01T00:00:00Z' }],
              cursor: 'page2cursor',
            },
            status: true,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              blocklist: [{ did: 'did:plc:blocker2', blocked_date: '2024-01-02T00:00:00Z' }],
            },
            status: true,
          }),
        });

      const result = await fetchBlockedByFromClearsky('did:plc:target');

      expect(result.blockerDids).toEqual(['did:plc:blocker1', 'did:plc:blocker2']);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns empty array for 404 (user not found)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchBlockedByFromClearsky('did:plc:unknown');

      expect(result.blockerDids).toEqual([]);
      expect(result.complete).toBe(true);
    });

    it('throws on other API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchBlockedByFromClearsky('did:plc:target')).rejects.toThrow(
        'Clearsky API error: 500'
      );
    });

    it('reports progress via callback', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            blocklist: [
              { did: 'did:plc:blocker1', blocked_date: '2024-01-01T00:00:00Z' },
              { did: 'did:plc:blocker2', blocked_date: '2024-01-02T00:00:00Z' },
            ],
          },
          status: true,
        }),
      });

      const onProgress = vi.fn();
      await fetchBlockedByFromClearsky('did:plc:target', onProgress);

      expect(onProgress).toHaveBeenCalledWith(2);
    });
  });

  describe('getFollowsWhoBlock', () => {
    const myFollows = new Set(['did:plc:follow1', 'did:plc:follow2', 'did:plc:follow3']);

    it('returns cached data when fresh', async () => {
      const cached = {
        targetDid: 'did:plc:target',
        blockerDids: ['did:plc:follow1', 'did:plc:other'],
        totalCount: 2,
        fetchedAt: Date.now() - 1000, // 1 second ago
        complete: true,
      };
      mockGetBlockedByCache.mockResolvedValue(cached);

      const result = await getFollowsWhoBlock('did:plc:target', myFollows);

      expect(result.cached).toBe(true);
      expect(result.count).toBe(1); // Only follow1 is in both sets
      expect(result.dids).toEqual(['did:plc:follow1']);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches fresh data when cache is expired', async () => {
      const expiredCache = {
        targetDid: 'did:plc:target',
        blockerDids: ['did:plc:old'],
        totalCount: 1,
        fetchedAt: Date.now() - CACHE_TTL_MS - 1000, // Expired
        complete: true,
      };
      mockGetBlockedByCache.mockResolvedValue(expiredCache);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            blocklist: [
              { did: 'did:plc:follow1', blocked_date: '2024-01-01T00:00:00Z' },
              { did: 'did:plc:follow2', blocked_date: '2024-01-02T00:00:00Z' },
            ],
          },
          status: true,
        }),
      });
      mockSaveBlockedByCache.mockResolvedValue();

      const result = await getFollowsWhoBlock('did:plc:target', myFollows);

      expect(result.cached).toBe(false);
      expect(result.count).toBe(2); // follow1 and follow2
      expect(mockSaveBlockedByCache).toHaveBeenCalled();
    });

    it('fetches fresh data when no cache exists', async () => {
      mockGetBlockedByCache.mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            blocklist: [{ did: 'did:plc:follow3', blocked_date: '2024-01-01T00:00:00Z' }],
          },
          status: true,
        }),
      });
      mockSaveBlockedByCache.mockResolvedValue();

      const result = await getFollowsWhoBlock('did:plc:target', myFollows);

      expect(result.cached).toBe(false);
      expect(result.count).toBe(1);
      expect(result.dids).toEqual(['did:plc:follow3']);
    });

    it('bypasses cache when forceRefresh=true', async () => {
      const freshCache = {
        targetDid: 'did:plc:target',
        blockerDids: ['did:plc:follow1'],
        totalCount: 1,
        fetchedAt: Date.now() - 1000, // Very fresh
        complete: true,
      };
      mockGetBlockedByCache.mockResolvedValue(freshCache);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            blocklist: [
              { did: 'did:plc:follow1', blocked_date: '2024-01-01T00:00:00Z' },
              { did: 'did:plc:follow2', blocked_date: '2024-01-02T00:00:00Z' },
            ],
          },
          status: true,
        }),
      });
      mockSaveBlockedByCache.mockResolvedValue();

      const result = await getFollowsWhoBlock('did:plc:target', myFollows, true);

      expect(result.cached).toBe(false);
      expect(result.count).toBe(2);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('getFollowsWhoBlockCached', () => {
    const myFollows = new Set(['did:plc:follow1', 'did:plc:follow2']);

    it('returns null when no cache exists', async () => {
      mockGetBlockedByCache.mockResolvedValue(null);

      const result = await getFollowsWhoBlockCached('did:plc:target', myFollows);

      expect(result).toBeNull();
    });

    it('returns null when cache is expired', async () => {
      mockGetBlockedByCache.mockResolvedValue({
        targetDid: 'did:plc:target',
        blockerDids: ['did:plc:follow1'],
        totalCount: 1,
        fetchedAt: Date.now() - CACHE_TTL_MS - 1000,
        complete: true,
      });

      const result = await getFollowsWhoBlockCached('did:plc:target', myFollows);

      expect(result).toBeNull();
    });

    it('returns cached result when fresh', async () => {
      mockGetBlockedByCache.mockResolvedValue({
        targetDid: 'did:plc:target',
        blockerDids: ['did:plc:follow1', 'did:plc:other'],
        totalCount: 2,
        fetchedAt: Date.now() - 1000,
        complete: true,
      });

      const result = await getFollowsWhoBlockCached('did:plc:target', myFollows);

      expect(result).not.toBeNull();
      expect(result!.count).toBe(1);
      expect(result!.cached).toBe(true);
    });
  });

  describe('hasValidCache', () => {
    it('returns false when no cache', async () => {
      mockGetBlockedByCache.mockResolvedValue(null);

      const result = await hasValidCache('did:plc:target');

      expect(result).toBe(false);
    });

    it('returns false when cache expired', async () => {
      mockGetBlockedByCache.mockResolvedValue({
        targetDid: 'did:plc:target',
        blockerDids: [],
        totalCount: 0,
        fetchedAt: Date.now() - CACHE_TTL_MS - 1000,
        complete: true,
      });

      const result = await hasValidCache('did:plc:target');

      expect(result).toBe(false);
    });

    it('returns true when cache is fresh', async () => {
      mockGetBlockedByCache.mockResolvedValue({
        targetDid: 'did:plc:target',
        blockerDids: [],
        totalCount: 0,
        fetchedAt: Date.now() - 1000,
        complete: true,
      });

      const result = await hasValidCache('did:plc:target');

      expect(result).toBe(true);
    });
  });

  describe('queueBlockedByFetch', () => {
    it('queues targets that are not cached', async () => {
      mockGetBlockedByCache.mockResolvedValue(null);
      mockQueueForFetch.mockResolvedValue();

      await queueBlockedByFetch(['did:plc:target1', 'did:plc:target2']);

      expect(mockQueueForFetch).toHaveBeenCalledTimes(2);
    });

    it('skips targets that are already cached', async () => {
      mockGetBlockedByCache.mockResolvedValue({
        targetDid: 'did:plc:target',
        blockerDids: [],
        totalCount: 0,
        fetchedAt: Date.now() - 1000,
        complete: true,
      });
      mockQueueForFetch.mockResolvedValue();

      await queueBlockedByFetch(['did:plc:target']);

      expect(mockQueueForFetch).not.toHaveBeenCalled();
    });
  });

  describe('processBlockedByQueue', () => {
    it('processes pending queue items', async () => {
      mockGetPendingQueue.mockResolvedValue([
        {
          targetDid: 'did:plc:target1',
          priority: 10,
          queuedAt: Date.now(),
          status: 'pending',
          retryCount: 0,
        },
      ]);
      mockGetBlockedByCache.mockResolvedValue(null);
      mockUpdateQueueStatus.mockResolvedValue();
      mockSaveBlockedByCache.mockResolvedValue();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            blocklist: [{ did: 'did:plc:blocker', blocked_date: '2024-01-01T00:00:00Z' }],
          },
          status: true,
        }),
      });

      const processed = await processBlockedByQueue(1);

      expect(processed).toBe(1);
      expect(mockUpdateQueueStatus).toHaveBeenCalledWith('did:plc:target1', 'in_progress');
      expect(mockUpdateQueueStatus).toHaveBeenCalledWith('did:plc:target1', 'completed');
    });

    it('returns 0 when queue is empty', async () => {
      mockGetPendingQueue.mockResolvedValue([]);

      const processed = await processBlockedByQueue();

      expect(processed).toBe(0);
    });

    it('skips items that were fetched on-demand', async () => {
      mockGetPendingQueue.mockResolvedValue([
        {
          targetDid: 'did:plc:target1',
          priority: 10,
          queuedAt: Date.now(),
          status: 'pending',
          retryCount: 0,
        },
      ]);
      // Return fresh cache (as if fetched on-demand while queued)
      mockGetBlockedByCache.mockResolvedValue({
        targetDid: 'did:plc:target1',
        blockerDids: [],
        totalCount: 0,
        fetchedAt: Date.now() - 1000,
        complete: true,
      });
      mockUpdateQueueStatus.mockResolvedValue();

      const processed = await processBlockedByQueue(1);

      expect(processed).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled(); // No API call needed
    });
  });

  describe('prewarmBlockedByCache', () => {
    it('queues uncached targets and reports counts', async () => {
      mockGetBlockedByCache
        .mockResolvedValueOnce(null) // First target not cached
        .mockResolvedValueOnce({
          // Second target cached
          targetDid: 'did:plc:target2',
          blockerDids: [],
          totalCount: 0,
          fetchedAt: Date.now() - 1000,
          complete: true,
        });
      mockQueueForFetch.mockResolvedValue();

      const result = await prewarmBlockedByCache(['did:plc:target1', 'did:plc:target2']);

      expect(result.queued).toBe(1);
      expect(result.alreadyCached).toBe(1);
    });
  });

  describe('getBatchBlockedByCounts', () => {
    const myFollows = new Set(['did:plc:follow1', 'did:plc:follow2']);

    it('returns counts from cache', async () => {
      mockGetBlockedByCache
        .mockResolvedValueOnce({
          targetDid: 'did:plc:target1',
          blockerDids: ['did:plc:follow1'],
          totalCount: 1,
          fetchedAt: Date.now() - 1000,
          complete: true,
        })
        .mockResolvedValueOnce(null); // target2 not cached

      const results = await getBatchBlockedByCounts(
        ['did:plc:target1', 'did:plc:target2'],
        myFollows
      );

      expect(results.get('did:plc:target1')).toEqual({ count: 1, cached: true });
      expect(results.get('did:plc:target2')).toEqual({ count: -1, cached: false });
    });
  });
});
