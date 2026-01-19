import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkCarCacheStatus, getCarDataSmart } from '../carService.js';
import * as carCache from '../carCache.js';
import * as carRepo from '../carRepo.js';

vi.mock('../carCache.js');
vi.mock('../carRepo.js');

const mockGetCarCacheMetadata = vi.mocked(carCache.getCarCacheMetadata);
const mockGetCachedCarData = vi.mocked(carCache.getCachedCarData);
const mockSaveCarData = vi.mocked(carCache.saveCarData);
const mockGetLatestCommit = vi.mocked(carRepo.getLatestCommit);
const mockParseCarForPosts = vi.mocked(carRepo.parseCarForPosts);
const mockParseCarForAllGraphOperations = vi.mocked(carRepo.parseCarForAllGraphOperations);
const mockParseCarForLists = vi.mocked(carRepo.parseCarForLists);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', mockFetch);
});

describe('carService', () => {
  describe('checkCarCacheStatus', () => {
    it('returns isStale=true when no cache exists', async () => {
      mockGetCarCacheMetadata.mockResolvedValue(null);
      mockGetLatestCommit.mockResolvedValue({ rev: 'abc123', cid: 'cid123' });

      const status = await checkCarCacheStatus('did:plc:user', 'https://pds.example.com');

      expect(status.hasCached).toBe(false);
      expect(status.isStale).toBe(true);
    });

    it('returns isStale=false when cache is within 24 hours', async () => {
      const recentDownload = Date.now() - (12 * 60 * 60 * 1000); // 12 hours ago
      mockGetCarCacheMetadata.mockResolvedValue({
        did: 'did:plc:user',
        rev: 'abc123',
        downloadedAt: recentDownload,
        sizeBytes: 1000,
        collections: { posts: 10, blocks: 5, follows: 20, listitems: 0, lists: 0 },
      });
      mockGetLatestCommit.mockResolvedValue({ rev: 'xyz789', cid: 'cid789' }); // Different rev

      const status = await checkCarCacheStatus('did:plc:user', 'https://pds.example.com');

      expect(status.hasCached).toBe(true);
      expect(status.isStale).toBe(false); // Not stale because within 24h TTL
    });

    it('returns isStale=true when cache is older than 24 hours', async () => {
      const oldDownload = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      mockGetCarCacheMetadata.mockResolvedValue({
        did: 'did:plc:user',
        rev: 'abc123',
        downloadedAt: oldDownload,
        sizeBytes: 1000,
        collections: { posts: 10, blocks: 5, follows: 20, listitems: 0, lists: 0 },
      });
      mockGetLatestCommit.mockResolvedValue({ rev: 'abc123', cid: 'cid123' }); // Same rev

      const status = await checkCarCacheStatus('did:plc:user', 'https://pds.example.com');

      expect(status.hasCached).toBe(true);
      expect(status.isStale).toBe(true); // Stale because older than 24h
    });

    it('returns isStale=false when cache is exactly at 24 hour boundary', async () => {
      const exactlyAtTTL = Date.now() - CACHE_TTL_MS;
      mockGetCarCacheMetadata.mockResolvedValue({
        did: 'did:plc:user',
        rev: 'abc123',
        downloadedAt: exactlyAtTTL,
        sizeBytes: 1000,
        collections: { posts: 10, blocks: 5, follows: 20, listitems: 0, lists: 0 },
      });
      mockGetLatestCommit.mockResolvedValue({ rev: 'xyz789', cid: 'cid789' });

      const status = await checkCarCacheStatus('did:plc:user', 'https://pds.example.com');

      expect(status.hasCached).toBe(true);
      expect(status.isStale).toBe(false); // At boundary, not past it
    });
  });

  describe('getCarDataSmart', () => {
    const mockCachedData = {
      did: 'did:plc:user',
      rev: 'abc123',
      posts: [],
      blocks: [],
      follows: [],
      listitems: [],
      lists: [],
    };

    const mockCacheMeta = {
      did: 'did:plc:user',
      rev: 'abc123',
      downloadedAt: Date.now() - (12 * 60 * 60 * 1000), // 12 hours ago
      sizeBytes: 1000,
      collections: { posts: 0, blocks: 0, follows: 0, listitems: 0, lists: 0 },
    };

    it('returns cached data without network call when within 24h TTL', async () => {
      mockGetCachedCarData.mockResolvedValue(mockCachedData);
      mockGetCarCacheMetadata.mockResolvedValue(mockCacheMeta);

      const result = await getCarDataSmart({
        did: 'did:plc:user',
        pdsUrl: 'https://pds.example.com',
      });

      expect(result.wasCached).toBe(true);
      expect(result.data).toEqual(mockCachedData);
      expect(mockGetLatestCommit).not.toHaveBeenCalled(); // No network call
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('checks revision and downloads when cache is expired (>24h)', async () => {
      const expiredMeta = {
        ...mockCacheMeta,
        downloadedAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
      };
      mockGetCachedCarData.mockResolvedValue(mockCachedData);
      mockGetCarCacheMetadata.mockResolvedValue(expiredMeta);
      mockGetLatestCommit.mockResolvedValue({ rev: 'newrev456', cid: 'cid456' });

      // Mock download
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => '3' },
        body: {
          getReader: () => {
            let read = false;
            return {
              read: async () => {
                if (read) return { done: true, value: undefined };
                read = true;
                return { done: false, value: mockCarData };
              },
            };
          },
        },
      });

      mockParseCarForPosts.mockReturnValue({ posts: [], fetchedAt: Date.now() });
      mockParseCarForAllGraphOperations.mockReturnValue({ blocks: [], follows: [], listitems: [] });
      mockParseCarForLists.mockReturnValue({ lists: {} });
      mockSaveCarData.mockResolvedValue();

      const result = await getCarDataSmart({
        did: 'did:plc:user',
        pdsUrl: 'https://pds.example.com',
      });

      expect(mockGetLatestCommit).toHaveBeenCalled(); // Network call made
      expect(result.wasCached).toBe(false);
    });

    it('refreshes timestamp when expired cache matches current revision', async () => {
      const expiredMeta = {
        ...mockCacheMeta,
        downloadedAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
      };
      mockGetCachedCarData.mockResolvedValue(mockCachedData);
      mockGetCarCacheMetadata.mockResolvedValue(expiredMeta);
      mockGetLatestCommit.mockResolvedValue({ rev: 'abc123', cid: 'cid123' }); // Same rev
      mockSaveCarData.mockResolvedValue();

      const result = await getCarDataSmart({
        did: 'did:plc:user',
        pdsUrl: 'https://pds.example.com',
      });

      expect(result.wasCached).toBe(true);
      expect(mockSaveCarData).toHaveBeenCalled(); // Timestamp refreshed
    });

    it('bypasses cache when forceRefresh=true', async () => {
      mockGetCachedCarData.mockResolvedValue(mockCachedData);
      mockGetCarCacheMetadata.mockResolvedValue(mockCacheMeta);
      mockGetLatestCommit.mockResolvedValue({ rev: 'abc123', cid: 'cid123' });

      // Mock download
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => '3' },
        body: {
          getReader: () => {
            let read = false;
            return {
              read: async () => {
                if (read) return { done: true, value: undefined };
                read = true;
                return { done: false, value: mockCarData };
              },
            };
          },
        },
      });

      mockParseCarForPosts.mockReturnValue({ posts: [], fetchedAt: Date.now() });
      mockParseCarForAllGraphOperations.mockReturnValue({ blocks: [], follows: [], listitems: [] });
      mockParseCarForLists.mockReturnValue({ lists: {} });
      mockSaveCarData.mockResolvedValue();

      const result = await getCarDataSmart({
        did: 'did:plc:user',
        pdsUrl: 'https://pds.example.com',
        forceRefresh: true,
      });

      expect(result.wasCached).toBe(false);
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
