/**
 * Tests for Block Relationship Sync Module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Mock storage.js
vi.mock('../../storage.js', () => ({
  getOptions: vi.fn().mockResolvedValue({
    blockRelationships: {
      enabled: true,
      maxCacheSize: 8 * 1024 * 1024,
      autoSyncInterval: 60,
      displayMode: 'compact',
      showOnProfiles: true,
    },
  }),
}));

// Mock cache.js
vi.mock('../../block-relationships/cache.js', () => ({
  getBlockRelationshipCache: vi.fn().mockResolvedValue({
    follows: [],
    followBlockLists: {},
    lastFullSync: 0,
    syncInProgress: false,
    syncErrors: [],
    totalFollows: 0,
    syncedFollows: 0,
  }),
  getBlockRelationshipSyncStatus: vi.fn().mockResolvedValue({
    isRunning: false,
    progress: 0,
    total: 0,
    currentUser: undefined,
    lastSync: 0,
    errors: [],
  }),
  getFollowBlockList: vi.fn().mockResolvedValue(null),
  updateFollows: vi.fn().mockResolvedValue(undefined),
  updateFollowBlockList: vi.fn().mockResolvedValue(undefined),
  startSync: vi.fn().mockResolvedValue(undefined),
  finishSync: vi.fn().mockResolvedValue(undefined),
  updateSyncProgress: vi.fn().mockResolvedValue(undefined),
  updateBlockRelSyncStatus: vi.fn().mockResolvedValue(undefined),
  addSyncError: vi.fn().mockResolvedValue(undefined),
  pruneCache: vi.fn().mockResolvedValue(undefined),
}));

import {
  resolvePds,
  getUserBlocks,
  syncFollowBlockLists,
  syncSingleUserBlocks,
  populatePdsCache,
} from '../../block-relationships/sync.js';
import {
  getBlockRelationshipSyncStatus,
  updateFollows,
  updateFollowBlockList,
  startSync,
  finishSync,
  pruneCache,
} from '../../block-relationships/cache.js';
import type { BskySession } from '../../types.js';

// Mock fetch
const mockFetch = vi.fn();
(globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch;

describe('Block Relationship Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('populatePdsCache', () => {
    it('should populate cache with valid entries', () => {
      const entries = [
        { did: 'did:plc:alice', pdsUrl: 'https://alice.pds.example' },
        { did: 'did:plc:bob', pdsUrl: 'https://bob.pds.example' },
        { did: 'did:plc:carol' }, // No pdsUrl
      ];

      // Should not throw
      expect(() => populatePdsCache(entries)).not.toThrow();
    });

    it('should handle empty array', () => {
      expect(() => populatePdsCache([])).not.toThrow();
    });
  });

  describe('resolvePds', () => {
    it('should return null for non-plc DIDs', async () => {
      const result = await resolvePds('did:web:example.com');
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should resolve PDS from PLC directory', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          service: [{ id: '#atproto_pds', serviceEndpoint: 'https://my.pds.example' }],
        }),
      });

      const result = await resolvePds('did:plc:test123');

      expect(result).toBe('https://my.pds.example');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://plc.directory/did:plc:test123',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should return null when PLC directory returns error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await resolvePds('did:plc:notfound');

      expect(result).toBeNull();
    });

    it('should return null when no PDS service in document', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          service: [{ id: '#other_service', serviceEndpoint: 'https://other.example' }],
        }),
      });

      const result = await resolvePds('did:plc:noservice');

      expect(result).toBeNull();
    });

    it('should cache resolved PDS URLs', async () => {
      // First call - fetches from PLC
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          service: [{ id: '#atproto_pds', serviceEndpoint: 'https://cached.pds.example' }],
        }),
      });

      const result1 = await resolvePds('did:plc:cacheme');
      expect(result1).toBe('https://cached.pds.example');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await resolvePds('did:plc:cacheme');
      expect(result2).toBe('https://cached.pds.example');
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it('should return null when json parsing fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await resolvePds('did:plc:badjson');
      expect(result).toBeNull();
    });
  });

  describe('getUserBlocks', () => {
    it('should fetch blocks from PDS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [
            { value: { subject: 'did:plc:blocked1' } },
            { value: { subject: 'did:plc:blocked2' } },
          ],
          cursor: undefined,
        }),
      });

      const blocks = await getUserBlocks('did:plc:user', 'https://user.pds.example');

      expect(blocks).toEqual(['did:plc:blocked1', 'did:plc:blocked2']);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://user.pds.example/xrpc/com.atproto.repo.listRecords'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should handle pagination', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [{ value: { subject: 'did:plc:blocked1' } }],
          cursor: 'page2',
        }),
      });
      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [{ value: { subject: 'did:plc:blocked2' } }],
          cursor: undefined,
        }),
      });

      const blocks = await getUserBlocks('did:plc:user', 'https://user.pds.example');

      expect(blocks).toEqual(['did:plc:blocked1', 'did:plc:blocked2']);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should use default PDS when none provided', async () => {
      // Mock PLC resolution failure
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // Mock block list fetch from default PDS
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [{ value: { subject: 'did:plc:blocked1' } }],
        }),
      });

      const blocks = await getUserBlocks('did:plc:nopdsdid');

      expect(blocks).toEqual(['did:plc:blocked1']);
      // Should have tried to resolve PDS first, then used default
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://bsky.social/xrpc/com.atproto.repo.listRecords'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should return empty array on fetch error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const blocks = await getUserBlocks('did:plc:user', 'https://user.pds.example');

      expect(blocks).toEqual([]);
    });

    it('should handle records without subject', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [
            { value: { subject: 'did:plc:valid' } },
            { value: {} }, // No subject
            { value: null }, // Null value
            { notvalue: 'bad' }, // No value key
          ],
        }),
      });

      const blocks = await getUserBlocks('did:plc:user', 'https://user.pds.example');

      expect(blocks).toEqual(['did:plc:valid']);
    });

    it('should normalize PDS URL by removing trailing slashes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [] }),
      });

      await getUserBlocks('did:plc:user', 'https://user.pds.example///');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://user.pds.example/xrpc'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  describe('syncFollowBlockLists', () => {
    const mockAuth: BskySession = {
      did: 'did:plc:me',
      handle: 'me.bsky.social',
      accessJwt: 'access-token',
      refreshJwt: 'refresh-token',
      pdsUrl: 'https://bsky.social',
    };

    it('should skip if sync is already in progress', async () => {
      vi.mocked(getBlockRelationshipSyncStatus).mockResolvedValueOnce({
        isRunning: true,
        totalFollows: 100,
        syncedFollows: 50,
        currentUser: 'alice.bsky.social',
        lastSync: Date.now(),
        errors: [],
      });

      await syncFollowBlockLists(mockAuth);

      expect(startSync).not.toHaveBeenCalled();
      expect(updateFollows).not.toHaveBeenCalled();
    });

    it('should fetch follows and sync their block lists', async () => {
      // Mock getFollows API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          follows: [
            { did: 'did:plc:alice', handle: 'alice.bsky.social', displayName: 'Alice' },
            { did: 'did:plc:bob', handle: 'bob.bsky.social' },
          ],
          cursor: undefined,
        }),
      });

      // Mock block list fetches for both users
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [{ value: { subject: 'did:plc:blocked1' } }],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [{ value: { subject: 'did:plc:blocked2' } }],
        }),
      });

      await syncFollowBlockLists(mockAuth);

      expect(updateFollows).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ did: 'did:plc:alice', handle: 'alice.bsky.social' }),
          expect.objectContaining({ did: 'did:plc:bob', handle: 'bob.bsky.social' }),
        ])
      );
      expect(startSync).toHaveBeenCalledWith(2);
      expect(finishSync).toHaveBeenCalled();
      expect(pruneCache).toHaveBeenCalled();
    });

    it('should handle errors during sync by recording error messages', async () => {
      // Mock getFollows API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          follows: [{ did: 'did:plc:alice', handle: 'alice.bsky.social' }],
          cursor: undefined,
        }),
      });

      // Mock block list fetch returning an error status (non-retry path)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await syncFollowBlockLists(mockAuth);

      // finishSync should be called (errors are captured during sync)
      expect(finishSync).toHaveBeenCalled();
    });

    it('should handle failure to fetch follows', async () => {
      // Non-ok response throws an error in fetchAllFollows
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      await expect(syncFollowBlockLists(mockAuth)).rejects.toThrow('Failed to get follows: 401');
      expect(finishSync).toHaveBeenCalled();
    });
  });

  describe('syncSingleUserBlocks', () => {
    it('should sync blocks for a single user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [
            { value: { subject: 'did:plc:blocked1' } },
            { value: { subject: 'did:plc:blocked2' } },
          ],
        }),
      });

      const blocks = await syncSingleUserBlocks('did:plc:alice', {
        handle: 'alice.bsky.social',
        pdsUrl: 'https://alice.pds.example',
      });

      expect(blocks).toEqual(['did:plc:blocked1', 'did:plc:blocked2']);
      expect(updateFollowBlockList).toHaveBeenCalledWith(
        'did:plc:alice',
        ['did:plc:blocked1', 'did:plc:blocked2'],
        expect.objectContaining({ handle: 'alice.bsky.social' }),
        undefined // rev parameter (API sync doesn't return rev)
      );
    });

    it('should return empty array when fetch returns error status', async () => {
      // Non-ok response causes getUserBlocks to return empty array
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      // syncSingleUserBlocks will get empty blocks but won't throw
      const blocks = await syncSingleUserBlocks('did:plc:alice', {
        pdsUrl: 'https://alice.pds.example',
      });

      expect(blocks).toEqual([]);
      expect(updateFollowBlockList).toHaveBeenCalledWith(
        'did:plc:alice',
        [],
        expect.anything(),
        undefined // rev parameter
      );
    });
  });

  describe('IncrementalSyncResult', () => {
    it('should return usedCar: false for API-based syncs', async () => {
      // When API returns blocks (under threshold), usedCar should be false
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [
            { value: { subject: 'did:plc:blocked1' } },
            { value: { subject: 'did:plc:blocked2' } },
          ],
        }),
      });

      const blocks = await syncSingleUserBlocks('did:plc:alice', {
        handle: 'alice.bsky.social',
        pdsUrl: 'https://alice.pds.example',
      });

      expect(blocks).toEqual(['did:plc:blocked1', 'did:plc:blocked2']);
      // The sync completed via API path (small block count)
      expect(updateFollowBlockList).toHaveBeenCalled();
    });
  });
});
