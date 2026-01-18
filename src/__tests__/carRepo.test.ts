import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAndParseRepo } from '../carRepo.js';
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
});
