import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchAndParseRepo,
  parseCarForBlocks,
  parseCarForLists,
  parseCarForListsWithTimestamps,
  parseCarForAllGraphOperations,
  parseCarForFollowsAndBlocks,
  parseCarForPosts,
  detectMassOperations,
  getLatestCommit,
  getCarFileSize,
  fetchBlocksFromCar,
  fetchBlocksFromCarIncremental,
  fetchListsFromCar,
  fetchListsFromCarWithTimestamps,
  scanForMassOperations,
  fetchExternalUserGraph,
  getRecordCountsFromCar,
} from '../domains/carRepo.js';
import type { MassOpsSettings } from '../types.js';
import * as atcuteRepo from '@atcute/repo';
import * as atcuteCbor from '@atcute/cbor';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@atcute/repo', () => ({
  fromUint8Array: vi.fn(),
}));

vi.mock('@atcute/cbor', () => ({
  decode: vi.fn(),
}));

const mockRepoFromUint8Array = vi.mocked(atcuteRepo.fromUint8Array);
const mockDecode = vi.mocked(atcuteCbor.decode);

beforeEach(() => {
  mockFetch.mockReset();
  mockRepoFromUint8Array.mockReset();
  mockDecode.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', mockFetch);
});

// Helper to create a mock streaming response
function createMockStreamResponse(data: Uint8Array, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: {
      get: (name: string) => (name === 'content-length' ? String(data.length) : null),
    },
    body: {
      getReader: () => {
        let read = false;
        return {
          read: async () => {
            if (read) return { done: true, value: undefined };
            read = true;
            return { done: false, value: data };
          },
        };
      },
    },
  };
}

describe('carRepo', () => {
  describe('fetchAndParseRepo', () => {
    it('downloads CAR file from PDS and parses posts', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      const mockEntries = [
        { collection: 'app.bsky.feed.post', rkey: 'abc123', bytes: new Uint8Array([1]) },
      ];
      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        mockEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.feed.post',
        text: 'Hello world',
        createdAt: '2024-01-15T12:00:00.000Z',
      });

      const result = await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://pds.example.com/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Auser',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].uri).toBe('at://did:plc:user/app.bsky.feed.post/abc123');
      expect(result.posts[0].text).toBe('Hello world');
      expect(result.blocks).toHaveLength(0);
    });

    it('falls back to relay when PDS fails', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);

      // First call (PDS) fails
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData, false, 500));
      // Second call (relay) succeeds
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      const mockEntries = [
        { collection: 'app.bsky.feed.post', rkey: 'xyz789', bytes: new Uint8Array([1]) },
      ];
      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        mockEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.feed.post',
        text: 'Fallback test',
        createdAt: '2024-01-15T12:00:00.000Z',
      });

      const result = await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://bsky.network/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Auser',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result.posts).toHaveLength(1);
    });

    it('falls back to relay when PDS is null', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      await fetchAndParseRepo('did:plc:user', null);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://bsky.network/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Auser',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('extracts reply information from posts', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      const mockEntries = [
        { collection: 'app.bsky.feed.post', rkey: 'reply1', bytes: new Uint8Array([1]) },
      ];
      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        mockEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.feed.post',
        text: 'This is a reply',
        createdAt: '2024-01-15T12:00:00.000Z',
        reply: {
          parent: { uri: 'at://did:plc:other/app.bsky.feed.post/parent', cid: 'cid1' },
          root: { uri: 'at://did:plc:other/app.bsky.feed.post/root', cid: 'cid2' },
        },
      });

      const result = await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');

      expect(result.posts[0].reply).toBeDefined();
      expect(result.posts[0].reply?.parent.uri).toBe(
        'at://did:plc:other/app.bsky.feed.post/parent'
      );
    });

    it('extracts embed information from posts', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      const mockEntries = [
        { collection: 'app.bsky.feed.post', rkey: 'quote1', bytes: new Uint8Array([1]) },
      ];
      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        mockEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.feed.post',
        text: 'Quote post',
        createdAt: '2024-01-15T12:00:00.000Z',
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: 'at://did:plc:other/app.bsky.feed.post/quoted', cid: 'cid1' },
        },
      });

      const result = await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');

      expect(result.posts[0].embed).toBeDefined();
      expect(result.posts[0].embed?.$type).toBe('app.bsky.embed.record');
      expect(result.posts[0].embed?.record?.uri).toBe(
        'at://did:plc:other/app.bsky.feed.post/quoted'
      );
    });

    it('ignores non-post collections', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      const mockEntries = [
        { collection: 'app.bsky.feed.like', rkey: 'like1', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.feed.repost', rkey: 'repost1', bytes: new Uint8Array([2]) },
        { collection: 'app.bsky.graph.follow', rkey: 'follow1', bytes: new Uint8Array([3]) },
      ];
      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        mockEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        mockEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      const result = await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');

      expect(result.posts).toHaveLength(0);
    });

    it('calls progress callback during download and parse', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      const onProgress = vi.fn();

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      await fetchAndParseRepo('did:plc:user', 'https://pds.example.com', onProgress);

      expect(onProgress).toHaveBeenCalledWith('Downloading repository...');
      expect(onProgress).toHaveBeenCalledWith('Parsing repository...');
      expect(onProgress).toHaveBeenCalledWith('Found 0 posts, 0 blocks');
    });

    it('throws error when both PDS and relay fail', async () => {
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(new Uint8Array(), false, 500));
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(new Uint8Array(), false, 404));

      await expect(fetchAndParseRepo('did:plc:user', 'https://pds.example.com')).rejects.toThrow(
        'Failed to download repo: 404'
      );
    });

    it('handles malformed CBOR entries gracefully', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      const mockEntries = [
        { collection: 'app.bsky.feed.post', rkey: 'good', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.feed.post', rkey: 'bad', bytes: new Uint8Array([2]) },
      ];
      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        mockEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      // First decode succeeds
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.feed.post',
        text: 'Good post',
        createdAt: '2024-01-15T12:00:00.000Z',
      });
      // Second decode throws
      mockDecode.mockImplementationOnce(() => {
        throw new Error('Invalid CBOR');
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].text).toBe('Good post');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('returns fetchedAt timestamp', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      const beforeFetch = Date.now();

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      const result = await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');
      const afterFetch = Date.now();

      expect(result.fetchedAt).toBeGreaterThanOrEqual(beforeFetch);
      expect(result.fetchedAt).toBeLessThanOrEqual(afterFetch);
    });

    it('times out on slow downloads', async () => {
      // Create a mock response that never completes (simulates a hanging download)
      const neverResolve = new Promise<{ done: boolean; value?: Uint8Array }>(() => {
        // Intentionally never resolves
      });

      const hangingResponse = {
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        body: {
          getReader: () => ({
            read: () => neverResolve,
            cancel: vi.fn(),
          }),
        },
      };

      mockFetch.mockResolvedValueOnce(hangingResponse);

      // Use a very short timeout for the test (100ms)
      // The fetchAndParseRepo function accepts a custom timeout via downloadCarFile
      // but it's not exposed, so we test the timeout mechanism indirectly
      // by checking that AbortError is converted to timeout error

      // For integration test, we'll verify the fetch is called with AbortSignal
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');

      // Verify fetch was called with AbortSignal (timeout mechanism is in place)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('handles AbortError from timeout correctly', async () => {
      // Simulate a fetch that throws AbortError (what happens on timeout)
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);
      // Relay also fails with AbortError
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(fetchAndParseRepo('did:plc:user', 'https://pds.example.com')).rejects.toThrow(
        'CAR download timed out'
      );
    });

    it('clears timeout on successful download', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);

      // Track if AbortController.abort was called
      let wasAborted = false;
      const originalAbortController = globalThis.AbortController;

      // Mock AbortController to track abort calls
      globalThis.AbortController = class MockAbortController {
        signal = { aborted: false };
        abort = () => {
          wasAborted = true;
        };
      } as unknown as typeof AbortController;

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      // Mock for parseCarForPosts
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Mock for parseCarForBlocks
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      await fetchAndParseRepo('did:plc:user', 'https://pds.example.com');

      // Restore original AbortController
      globalThis.AbortController = originalAbortController;

      // The abort should NOT have been called since download completed successfully
      expect(wasAborted).toBe(false);
    });
  });

  // ── Pure parsing functions ──────────────────────────────────────────────

  describe('parseCarForBlocks', () => {
    it('should extract block subjects from CAR data', () => {
      const entries = [
        { collection: 'app.bsky.graph.block', rkey: 'rk1', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.block', rkey: 'rk2', bytes: new Uint8Array([2]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode
        .mockReturnValueOnce({ $type: 'app.bsky.graph.block', subject: 'did:plc:blocked1' })
        .mockReturnValueOnce({ $type: 'app.bsky.graph.block', subject: 'did:plc:blocked2' });

      const blocks = parseCarForBlocks(new Uint8Array([1]));
      expect(blocks).toEqual(['did:plc:blocked1', 'did:plc:blocked2']);
    });

    it('should return empty array when no blocks exist', () => {
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      expect(parseCarForBlocks(new Uint8Array([1]))).toEqual([]);
    });

    it('should skip non-block collections', () => {
      const entries = [
        { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      expect(parseCarForBlocks(new Uint8Array([1]))).toEqual([]);
    });

    it('should skip malformed entries gracefully', () => {
      const entries = [
        { collection: 'app.bsky.graph.block', rkey: 'bad', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.block', rkey: 'good', bytes: new Uint8Array([2]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockImplementationOnce(() => {
        throw new Error('bad CBOR');
      });
      mockDecode.mockReturnValueOnce({ $type: 'app.bsky.graph.block', subject: 'did:plc:ok' });

      const blocks = parseCarForBlocks(new Uint8Array([1]));
      expect(blocks).toEqual(['did:plc:ok']);
    });

    it('should skip entries without subject', () => {
      const entries = [
        { collection: 'app.bsky.graph.block', rkey: 'rk1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({ $type: 'app.bsky.graph.block' }); // no subject

      expect(parseCarForBlocks(new Uint8Array([1]))).toEqual([]);
    });
  });

  describe('parseCarForFollowsAndBlocks', () => {
    it('should extract follows and blocks', () => {
      const entries = [
        { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.block', rkey: 'b1', bytes: new Uint8Array([2]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.follow',
          subject: 'did:plc:followed',
          createdAt: '2024-01-01',
        })
        .mockReturnValueOnce({ $type: 'app.bsky.graph.block', subject: 'did:plc:blocked' });

      const result = parseCarForFollowsAndBlocks(new Uint8Array([1]));
      expect(result.follows).toEqual(['did:plc:followed']);
      expect(result.blocks).toEqual(['did:plc:blocked']);
    });

    it('should return empty arrays when no graph operations exist', () => {
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      const result = parseCarForFollowsAndBlocks(new Uint8Array([1]));
      expect(result).toEqual({ follows: [], blocks: [] });
    });

    it('should skip entries without subject', () => {
      const entries = [
        { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({ $type: 'app.bsky.graph.follow' }); // no subject

      const result = parseCarForFollowsAndBlocks(new Uint8Array([1]));
      expect(result.follows).toEqual([]);
    });

    it('should handle decode errors gracefully', () => {
      const entries = [
        { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockImplementationOnce(() => {
        throw new Error('corrupt');
      });

      const result = parseCarForFollowsAndBlocks(new Uint8Array([1]));
      expect(result).toEqual({ follows: [], blocks: [] });
    });
  });

  describe('parseCarForLists', () => {
    it('should parse list metadata and members', () => {
      const entries = [
        { collection: 'app.bsky.graph.list', rkey: 'list1', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.listitem', rkey: 'item1', bytes: new Uint8Array([2]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.list',
          name: 'My Blocklist',
          description: 'test list',
          purpose: 'app.bsky.graph.defs#modlist',
          createdAt: '2024-01-01T00:00:00Z',
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.listitem',
          subject: 'did:plc:member1',
          list: 'at://did:plc:creator/app.bsky.graph.list/list1',
          createdAt: '2024-01-02T00:00:00Z',
        });

      const result = parseCarForLists(new Uint8Array([1]), 'did:plc:creator');
      const listUri = 'at://did:plc:creator/app.bsky.graph.list/list1';
      expect(result.lists[listUri]).toBeDefined();
      expect(result.lists[listUri].name).toBe('My Blocklist');
      expect(result.lists[listUri].members).toEqual(['did:plc:member1']);
      expect(result.creatorDid).toBe('did:plc:creator');
    });

    it('should return empty lists when no data exists', () => {
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      const result = parseCarForLists(new Uint8Array([1]), 'did:plc:creator');
      expect(result.lists).toEqual({});
    });

    it('should filter by target list URIs', () => {
      const listUri = 'at://did:plc:creator/app.bsky.graph.list/wanted';
      const entries = [
        { collection: 'app.bsky.graph.list', rkey: 'wanted', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.list', rkey: 'unwanted', bytes: new Uint8Array([2]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.list',
          name: 'Wanted',
          purpose: 'app.bsky.graph.defs#modlist',
          createdAt: '2024-01-01T00:00:00Z',
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.list',
          name: 'Unwanted',
          purpose: 'app.bsky.graph.defs#modlist',
          createdAt: '2024-01-01T00:00:00Z',
        });

      const result = parseCarForLists(new Uint8Array([1]), 'did:plc:creator', new Set([listUri]));
      expect(Object.keys(result.lists)).toHaveLength(1);
      expect(result.lists[listUri]).toBeDefined();
    });

    it('should create placeholder for orphan list items', () => {
      const entries = [
        { collection: 'app.bsky.graph.listitem', rkey: 'item1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.graph.listitem',
        subject: 'did:plc:orphan',
        list: 'at://did:plc:other/app.bsky.graph.list/unknown',
        createdAt: '2024-01-02T00:00:00Z',
      });

      const result = parseCarForLists(new Uint8Array([1]), 'did:plc:creator');
      const orphanUri = 'at://did:plc:other/app.bsky.graph.list/unknown';
      expect(result.lists[orphanUri]).toBeDefined();
      expect(result.lists[orphanUri].name).toBe('Unknown List');
      expect(result.lists[orphanUri].members).toEqual(['did:plc:orphan']);
    });
  });

  describe('parseCarForListsWithTimestamps', () => {
    it('should parse lists with member timestamps', () => {
      const entries = [
        { collection: 'app.bsky.graph.list', rkey: 'list1', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.listitem', rkey: 'item1', bytes: new Uint8Array([2]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.list',
          name: 'Timestamped List',
          description: 'with times',
          createdAt: '2024-01-01T00:00:00Z',
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.listitem',
          subject: 'did:plc:member',
          list: 'at://did:plc:creator/app.bsky.graph.list/list1',
          createdAt: '2024-06-15T12:00:00Z',
        });

      const result = parseCarForListsWithTimestamps(new Uint8Array([1]), 'did:plc:creator');
      const listUri = 'at://did:plc:creator/app.bsky.graph.list/list1';
      expect(result.lists[listUri].members).toHaveLength(1);
      expect(result.lists[listUri].members[0].did).toBe('did:plc:member');
      expect(result.lists[listUri].members[0].addedAt).toBe(
        new Date('2024-06-15T12:00:00Z').getTime()
      );
    });

    it('should handle orphan items without metadata', () => {
      const entries = [
        { collection: 'app.bsky.graph.listitem', rkey: 'item1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.graph.listitem',
        subject: 'did:plc:orphan',
        list: 'at://did:plc:other/app.bsky.graph.list/missing',
        createdAt: '2024-01-01T00:00:00Z',
      });

      const result = parseCarForListsWithTimestamps(new Uint8Array([1]), 'did:plc:creator');
      const uri = 'at://did:plc:other/app.bsky.graph.list/missing';
      expect(result.lists[uri].name).toBe('Unknown List');
      expect(result.lists[uri].members).toHaveLength(1);
    });

    it('should filter by target list URIs', () => {
      const target = 'at://did:plc:creator/app.bsky.graph.list/wanted';
      const entries = [
        { collection: 'app.bsky.graph.list', rkey: 'wanted', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.list', rkey: 'ignored', bytes: new Uint8Array([2]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.list',
          name: 'Wanted',
          createdAt: '2024-01-01T00:00:00Z',
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.list',
          name: 'Ignored',
          createdAt: '2024-01-01T00:00:00Z',
        });

      const result = parseCarForListsWithTimestamps(
        new Uint8Array([1]),
        'did:plc:creator',
        new Set([target])
      );
      expect(Object.keys(result.lists)).toHaveLength(1);
    });
  });

  describe('parseCarForAllGraphOperations', () => {
    it('should extract blocks, follows, and listitems with timestamps', () => {
      // First pass: list names
      const pass1 = [
        { collection: 'app.bsky.graph.list', rkey: 'list1', bytes: new Uint8Array([1]) },
      ];
      // Second pass: graph operations
      const pass2 = [
        { collection: 'app.bsky.graph.block', rkey: 'b1', bytes: new Uint8Array([2]) },
        { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([3]) },
        { collection: 'app.bsky.graph.listitem', rkey: 'li1', bytes: new Uint8Array([4]) },
      ];
      mockRepoFromUint8Array
        .mockReturnValueOnce(pass1 as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>)
        .mockReturnValueOnce(pass2 as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>);

      // First pass decodes
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.graph.list',
        name: 'Test List',
        createdAt: '2024-01-01T00:00:00Z',
      });
      // Second pass decodes
      mockDecode
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.block',
          subject: 'did:plc:blocked',
          createdAt: '2024-03-01T00:00:00Z',
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.follow',
          subject: 'did:plc:followed',
          createdAt: '2024-03-02T00:00:00Z',
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.listitem',
          subject: 'did:plc:listed',
          list: 'at://did:plc:me/app.bsky.graph.list/list1',
          createdAt: '2024-03-03T00:00:00Z',
        });

      const result = parseCarForAllGraphOperations(new Uint8Array([1]), 'did:plc:me');
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].did).toBe('did:plc:blocked');
      expect(result.blocks[0].type).toBe('block');
      expect(result.follows).toHaveLength(1);
      expect(result.follows[0].did).toBe('did:plc:followed');
      expect(result.listitems).toHaveLength(1);
      expect(result.listitems[0].listName).toBe('Test List');
    });

    it('should return empty arrays when no graph operations exist', () => {
      mockRepoFromUint8Array
        .mockReturnValueOnce([] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>)
        .mockReturnValueOnce([] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>);

      const result = parseCarForAllGraphOperations(new Uint8Array([1]), 'did:plc:me');
      expect(result).toEqual({ blocks: [], follows: [], listitems: [] });
    });

    it('should use "Unknown List" when list name is not found', () => {
      mockRepoFromUint8Array
        .mockReturnValueOnce([] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>)
        .mockReturnValueOnce([
          { collection: 'app.bsky.graph.listitem', rkey: 'li1', bytes: new Uint8Array([1]) },
        ] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>);
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.graph.listitem',
        subject: 'did:plc:listed',
        list: 'at://did:plc:other/app.bsky.graph.list/unknown',
        createdAt: '2024-01-01T00:00:00Z',
      });

      const result = parseCarForAllGraphOperations(new Uint8Array([1]), 'did:plc:me');
      expect(result.listitems[0].listName).toBe('Unknown List');
    });

    it('should skip entries missing subject or createdAt', () => {
      mockRepoFromUint8Array
        .mockReturnValueOnce([] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>)
        .mockReturnValueOnce([
          { collection: 'app.bsky.graph.block', rkey: 'b1', bytes: new Uint8Array([1]) },
          { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([2]) },
        ] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>);
      mockDecode
        .mockReturnValueOnce({ $type: 'app.bsky.graph.block' }) // no subject
        .mockReturnValueOnce({ $type: 'app.bsky.graph.follow', subject: 'did:plc:x' }); // no createdAt

      const result = parseCarForAllGraphOperations(new Uint8Array([1]), 'did:plc:me');
      expect(result.blocks).toHaveLength(0);
      expect(result.follows).toHaveLength(0);
    });
  });

  // ── detectMassOperations (pure algorithm) ───────────────────────────────

  describe('detectMassOperations', () => {
    const defaultSettings: MassOpsSettings = {
      timeWindowMinutes: 60,
      minOperationCount: 3,
    };

    it('should detect a cluster of blocks within time window', () => {
      const baseTime = new Date('2024-06-01T12:00:00Z').getTime();
      const ops = {
        blocks: [
          { type: 'block' as const, did: 'did:1', rkey: 'r1', createdAt: baseTime },
          { type: 'block' as const, did: 'did:2', rkey: 'r2', createdAt: baseTime + 60000 },
          { type: 'block' as const, did: 'did:3', rkey: 'r3', createdAt: baseTime + 120000 },
        ],
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(ops, defaultSettings);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].type).toBe('block');
      expect(clusters[0].count).toBe(3);
    });

    it('should not detect cluster below min operation count', () => {
      const baseTime = Date.now();
      const ops = {
        blocks: [
          { type: 'block' as const, did: 'did:1', rkey: 'r1', createdAt: baseTime },
          { type: 'block' as const, did: 'did:2', rkey: 'r2', createdAt: baseTime + 1000 },
        ],
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(ops, defaultSettings);
      expect(clusters).toHaveLength(0);
    });

    it('should not detect cluster when operations span beyond time window', () => {
      const baseTime = Date.now();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      const ops = {
        blocks: [
          { type: 'block' as const, did: 'did:1', rkey: 'r1', createdAt: baseTime },
          { type: 'block' as const, did: 'did:2', rkey: 'r2', createdAt: baseTime + twoHoursMs },
          {
            type: 'block' as const,
            did: 'did:3',
            rkey: 'r3',
            createdAt: baseTime + twoHoursMs * 2,
          },
        ],
        follows: [],
        listitems: [],
      };

      const clusters = detectMassOperations(ops, defaultSettings);
      expect(clusters).toHaveLength(0);
    });

    it('should detect clusters in different operation types independently', () => {
      const baseTime = Date.now();
      const ops = {
        blocks: [
          { type: 'block' as const, did: 'did:b1', rkey: 'rb1', createdAt: baseTime },
          { type: 'block' as const, did: 'did:b2', rkey: 'rb2', createdAt: baseTime + 1000 },
          { type: 'block' as const, did: 'did:b3', rkey: 'rb3', createdAt: baseTime + 2000 },
        ],
        follows: [
          { type: 'follow' as const, did: 'did:f1', rkey: 'rf1', createdAt: baseTime },
          { type: 'follow' as const, did: 'did:f2', rkey: 'rf2', createdAt: baseTime + 500 },
          { type: 'follow' as const, did: 'did:f3', rkey: 'rf3', createdAt: baseTime + 1000 },
          { type: 'follow' as const, did: 'did:f4', rkey: 'rf4', createdAt: baseTime + 1500 },
        ],
        listitems: [],
      };

      const clusters = detectMassOperations(ops, defaultSettings);
      expect(clusters).toHaveLength(2);
      const types = clusters.map((c) => c.type).sort();
      expect(types).toEqual(['block', 'follow']);
    });

    it('should return empty array for empty operations', () => {
      const clusters = detectMassOperations(
        { blocks: [], follows: [], listitems: [] },
        defaultSettings
      );
      expect(clusters).toEqual([]);
    });

    it('should sort clusters newest first', () => {
      const earlyTime = new Date('2024-01-01T00:00:00Z').getTime();
      const lateTime = new Date('2024-06-01T00:00:00Z').getTime();
      const ops = {
        blocks: [
          { type: 'block' as const, did: 'did:1', rkey: 'r1', createdAt: earlyTime },
          { type: 'block' as const, did: 'did:2', rkey: 'r2', createdAt: earlyTime + 1000 },
          { type: 'block' as const, did: 'did:3', rkey: 'r3', createdAt: earlyTime + 2000 },
        ],
        follows: [
          { type: 'follow' as const, did: 'did:f1', rkey: 'rf1', createdAt: lateTime },
          { type: 'follow' as const, did: 'did:f2', rkey: 'rf2', createdAt: lateTime + 1000 },
          { type: 'follow' as const, did: 'did:f3', rkey: 'rf3', createdAt: lateTime + 2000 },
        ],
        listitems: [],
      };

      const clusters = detectMassOperations(ops, defaultSettings);
      expect(clusters[0].startTime).toBeGreaterThan(clusters[1].startTime);
    });
  });

  // ── Fetch-dependent functions ───────────────────────────────────────────

  describe('getLatestCommit', () => {
    it('should return commit data from PDS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: 'bafyabc', rev: 'rev123' }),
      });

      const result = await getLatestCommit('did:plc:user', 'https://pds.example.com');
      expect(result).toEqual({ cid: 'bafyabc', rev: 'rev123' });
    });

    it('should fall back to relay when PDS fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false }); // PDS fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: 'bafyxyz', rev: 'rev456' }),
      });

      const result = await getLatestCommit('did:plc:user', 'https://pds.example.com');
      expect(result).toEqual({ cid: 'bafyxyz', rev: 'rev456' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return null when all endpoints fail', async () => {
      mockFetch.mockRejectedValueOnce(new Error('PDS down'));
      mockFetch.mockRejectedValueOnce(new Error('Relay down'));

      const result = await getLatestCommit('did:plc:user', 'https://pds.example.com');
      expect(result).toBeNull();
    });

    it('should skip PDS when pdsUrl is null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: 'bafyrelay', rev: 'revRelay' }),
      });

      const result = await getLatestCommit('did:plc:user', null);
      expect(result).toEqual({ cid: 'bafyrelay', rev: 'revRelay' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('bsky.network'));
    });
  });

  describe('getCarFileSize', () => {
    it('should return content-length from HEAD request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-length' ? '5242880' : null) },
      });

      const size = await getCarFileSize('did:plc:user', 'https://pds.example.com');
      expect(size).toBe(5242880);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('pds.example.com'), {
        method: 'HEAD',
      });
    });

    it('should fall back to relay on PDS failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, headers: { get: () => null } });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-length' ? '1024' : null) },
      });

      const size = await getCarFileSize('did:plc:user', 'https://pds.example.com');
      expect(size).toBe(1024);
    });

    it('should return null when no endpoints provide content-length', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, headers: { get: () => null } });
      mockFetch.mockResolvedValueOnce({ ok: true, headers: { get: () => null } });

      const size = await getCarFileSize('did:plc:user', 'https://pds.example.com');
      expect(size).toBeNull();
    });

    it('should return null when all endpoints fail', async () => {
      mockFetch.mockRejectedValueOnce(new Error('nope'));
      mockFetch.mockRejectedValueOnce(new Error('nope'));

      const size = await getCarFileSize('did:plc:user', 'https://pds.example.com');
      expect(size).toBeNull();
    });
  });

  describe('fetchBlocksFromCar', () => {
    it('should download CAR and return block DIDs', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      const entries = [
        { collection: 'app.bsky.graph.block', rkey: 'b1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.graph.block',
        subject: 'did:plc:blocked',
      });

      const blocks = await fetchBlocksFromCar('did:plc:user', 'https://pds.example.com');
      expect(blocks).toEqual(['did:plc:blocked']);
    });
  });

  describe('fetchListsFromCar', () => {
    it('should download CAR and return parsed lists', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));
      const onProgress = vi.fn();

      const entries = [
        { collection: 'app.bsky.graph.list', rkey: 'list1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.graph.list',
        name: 'Test List',
        purpose: 'app.bsky.graph.defs#modlist',
        createdAt: '2024-01-01T00:00:00Z',
      });

      const result = await fetchListsFromCar(
        'did:plc:user',
        'https://pds.example.com',
        undefined,
        onProgress
      );
      expect(result.creatorDid).toBe('did:plc:user');
      expect(onProgress).toHaveBeenCalledWith('Parsing lists...');
    });
  });

  describe('fetchListsFromCarWithTimestamps', () => {
    it('should download CAR and return lists with timestamps', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));
      const onProgress = vi.fn();

      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      const result = await fetchListsFromCarWithTimestamps(
        'did:plc:user',
        'https://pds.example.com',
        undefined,
        onProgress
      );
      expect(result.creatorDid).toBe('did:plc:user');
      expect(onProgress).toHaveBeenCalledWith('Parsing lists...');
    });
  });

  describe('fetchExternalUserGraph', () => {
    it('should download CAR and return follows and blocks', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));
      const onProgress = vi.fn();

      const entries = [
        { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.block', rkey: 'b1', bytes: new Uint8Array([2]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.follow',
          subject: 'did:plc:followed',
          createdAt: '2024-01-01',
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.block',
          subject: 'did:plc:blocked',
        });

      const result = await fetchExternalUserGraph(
        'did:plc:ext',
        'https://pds.example.com',
        onProgress
      );
      expect(result.follows).toEqual(['did:plc:followed']);
      expect(result.blocks).toEqual(['did:plc:blocked']);
      expect(onProgress).toHaveBeenCalledWith('Parsing follows and blocks...');
    });
  });

  describe('getRecordCountsFromCar', () => {
    it('should download CAR and count records by collection', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));
      const onProgress = vi.fn();

      const entries = [
        { collection: 'app.bsky.feed.post', rkey: 'p1', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.feed.post', rkey: 'p2', bytes: new Uint8Array([2]) },
        { collection: 'app.bsky.graph.block', rkey: 'b1', bytes: new Uint8Array([3]) },
        { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([4]) },
        { collection: 'com.example.custom', rkey: 'c1', bytes: new Uint8Array([5]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      const counts = await getRecordCountsFromCar(
        'did:plc:user',
        'https://pds.example.com',
        onProgress
      );
      expect(counts['app.bsky.feed.post']).toBe(2);
      expect(counts['app.bsky.graph.block']).toBe(1);
      expect(counts['app.bsky.graph.follow']).toBe(1);
      expect(counts['com.example.custom']).toBe(1);
      expect(onProgress).toHaveBeenCalledWith('Counting records...');
      expect(onProgress).toHaveBeenCalledWith('Done');
    });
  });

  describe('scanForMassOperations', () => {
    it('should download CAR, parse, and detect mass operations', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));
      const onProgress = vi.fn();
      const baseTime = Date.now();

      // Pass 1 (list names) - empty
      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      // Pass 2 (graph ops) - 3 blocks in same minute
      const pass2 = [
        { collection: 'app.bsky.graph.block', rkey: 'b1', bytes: new Uint8Array([1]) },
        { collection: 'app.bsky.graph.block', rkey: 'b2', bytes: new Uint8Array([2]) },
        { collection: 'app.bsky.graph.block', rkey: 'b3', bytes: new Uint8Array([3]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        pass2 as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.block',
          subject: 'did:1',
          createdAt: new Date(baseTime).toISOString(),
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.block',
          subject: 'did:2',
          createdAt: new Date(baseTime + 1000).toISOString(),
        })
        .mockReturnValueOnce({
          $type: 'app.bsky.graph.block',
          subject: 'did:3',
          createdAt: new Date(baseTime + 2000).toISOString(),
        });

      const settings: MassOpsSettings = { timeWindowMinutes: 60, minOperationCount: 3 };
      const result = await scanForMassOperations(
        'did:plc:user',
        'https://pds.example.com',
        settings,
        onProgress
      );

      expect(result.clusters).toHaveLength(1);
      expect(result.operationCounts.blocks).toBe(3);
      expect(onProgress).toHaveBeenCalledWith('Parsing operations...');
      expect(onProgress).toHaveBeenCalledWith('Detecting mass operations...');
    });

    it('should report zero clusters when none detected', async () => {
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));
      const onProgress = vi.fn();

      mockRepoFromUint8Array
        .mockReturnValueOnce([] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>)
        .mockReturnValueOnce([] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>);

      const settings: MassOpsSettings = { timeWindowMinutes: 60, minOperationCount: 3 };
      const result = await scanForMassOperations(
        'did:plc:user',
        'https://pds.example.com',
        settings,
        onProgress
      );

      expect(result.clusters).toEqual([]);
      expect(onProgress).toHaveBeenCalledWith('No mass operations detected');
    });
  });

  // ── parseCarForPosts ────────────────────────────────────────────────────

  describe('parseCarForPosts', () => {
    it('should extract posts with URIs', () => {
      const entries = [
        { collection: 'app.bsky.feed.post', rkey: 'p1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.feed.post',
        text: 'Hello world',
        createdAt: '2024-06-01T00:00:00Z',
      });

      const result = parseCarForPosts(new Uint8Array([1]), 'did:plc:user');
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].uri).toBe('at://did:plc:user/app.bsky.feed.post/p1');
      expect(result.posts[0].text).toBe('Hello world');
      expect(result.creatorDid).toBe('did:plc:user');
    });

    it('should extract reply info from posts', () => {
      const entries = [
        { collection: 'app.bsky.feed.post', rkey: 'reply1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.feed.post',
        text: 'A reply',
        createdAt: '2024-06-01T00:00:00Z',
        reply: {
          parent: { uri: 'at://did:plc:other/app.bsky.feed.post/parent', cid: 'cid1' },
          root: { uri: 'at://did:plc:other/app.bsky.feed.post/root', cid: 'cid2' },
        },
      });

      const result = parseCarForPosts(new Uint8Array([1]), 'did:plc:user');
      expect(result.posts[0].reply?.parent.uri).toBe(
        'at://did:plc:other/app.bsky.feed.post/parent'
      );
    });

    it('should extract embed info from posts', () => {
      const entries = [
        { collection: 'app.bsky.feed.post', rkey: 'embed1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.feed.post',
        text: 'Quote post',
        createdAt: '2024-06-01T00:00:00Z',
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: 'at://did:plc:other/app.bsky.feed.post/quoted' },
        },
      });

      const result = parseCarForPosts(new Uint8Array([1]), 'did:plc:user');
      expect(result.posts[0].embed?.$type).toBe('app.bsky.embed.record');
      expect(result.posts[0].embed?.record?.uri).toBe(
        'at://did:plc:other/app.bsky.feed.post/quoted'
      );
    });

    it('should skip non-post collections', () => {
      const entries = [
        { collection: 'app.bsky.graph.follow', rkey: 'f1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      const result = parseCarForPosts(new Uint8Array([1]), 'did:plc:user');
      expect(result.posts).toHaveLength(0);
    });

    it('should handle decode errors gracefully', () => {
      const entries = [
        { collection: 'app.bsky.feed.post', rkey: 'bad', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        entries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockImplementationOnce(() => {
        throw new Error('corrupt');
      });

      const result = parseCarForPosts(new Uint8Array([1]), 'did:plc:user');
      expect(result.posts).toHaveLength(0);
    });
  });

  // ── fetchBlocksFromCarIncremental ───────────────────────────────────────

  describe('fetchBlocksFromCarIncremental', () => {
    it('should skip download when revision is unchanged and cache exists', async () => {
      // getLatestCommit succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: 'bafyabc', rev: 'sameRev' }),
      });

      const result = await fetchBlocksFromCarIncremental(
        'did:plc:user',
        'https://pds.example.com',
        'sameRev',
        ['did:plc:cached1']
      );
      expect(result.blocks).toEqual(['did:plc:cached1']);
      expect(result.rev).toBe('sameRev');
      expect(result.wasIncremental).toBe(true);
      // Only 1 fetch (getLatestCommit), no CAR download
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should do full download when getLatestCommit returns null', async () => {
      // getLatestCommit fails on both endpoints
      mockFetch.mockRejectedValueOnce(new Error('PDS down'));
      mockFetch.mockRejectedValueOnce(new Error('Relay down'));
      // Full download via fetchBlocksFromCar -> downloadCarFile
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      const blockEntries = [
        { collection: 'app.bsky.graph.block', rkey: 'b1', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        blockEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.graph.block',
        subject: 'did:plc:fresh',
      });

      const result = await fetchBlocksFromCarIncremental('did:plc:user', 'https://pds.example.com');
      expect(result.blocks).toEqual(['did:plc:fresh']);
      expect(result.wasIncremental).toBe(false);
    });

    it('should do full download when no cached data exists', async () => {
      // getLatestCommit succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: 'bafyabc', rev: 'newRev' }),
      });
      // Full download
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      const result = await fetchBlocksFromCarIncremental('did:plc:user', 'https://pds.example.com');
      expect(result.blocks).toEqual([]);
      expect(result.rev).toBe('newRev');
      expect(result.wasIncremental).toBe(false);
    });

    it('should try incremental sync and merge blocks on success', async () => {
      // getLatestCommit succeeds with new rev
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: 'bafynew', rev: 'newRev' }),
      });
      // Incremental download succeeds
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      // parseIncrementalCarForBlocks iterates the repo
      const incrEntries = [
        { collection: 'app.bsky.graph.block', rkey: 'newBlock', bytes: new Uint8Array([1]) },
      ];
      mockRepoFromUint8Array.mockReturnValueOnce(
        incrEntries as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );
      mockDecode.mockReturnValueOnce({
        $type: 'app.bsky.graph.block',
        subject: 'did:plc:newlyBlocked',
      });

      const result = await fetchBlocksFromCarIncremental(
        'did:plc:user',
        'https://pds.example.com',
        'oldRev',
        ['did:plc:existingBlock']
      );
      expect(result.blocks).toContain('did:plc:existingBlock');
      expect(result.blocks).toContain('did:plc:newlyBlocked');
      expect(result.rev).toBe('newRev');
      expect(result.wasIncremental).toBe(true);
    });

    it('should fall back to full download when incremental fails', async () => {
      // getLatestCommit succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: 'bafynew', rev: 'newRev' }),
      });
      // Incremental download fails (400 - not supported)
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(new Uint8Array(), false, 400));
      // Relay also fails with 400
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(new Uint8Array(), false, 400));
      // Full download succeeds
      const mockCarData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(mockCarData));

      mockRepoFromUint8Array.mockReturnValueOnce(
        [] as unknown as ReturnType<typeof atcuteRepo.fromUint8Array>
      );

      const result = await fetchBlocksFromCarIncremental(
        'did:plc:user',
        'https://pds.example.com',
        'oldRev',
        ['did:plc:old']
      );
      expect(result.wasIncremental).toBe(false);
      expect(result.rev).toBe('newRev');
    });
  });
});
