import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  PostView,
  GetPostsResponse,
  EmbedRecordView,
  EmbedRecordViewRecord,
  EmbedRecordViewBlocked,
  EmbedRecordViewDetached,
  EmbedRecordViewNotFound,
  PostViewEmbedRecord,
} from '../types';

describe('QT Peek Types', () => {
  describe('EmbedRecordView discriminated union', () => {
    it('should type-check viewRecord', () => {
      const view: EmbedRecordViewRecord = {
        $type: 'app.bsky.embed.record#viewRecord',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        cid: 'bafyabc',
        author: { did: 'did:plc:abc', handle: 'user.bsky.social' },
        value: {
          $type: 'app.bsky.feed.post',
          text: 'Hello world',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        indexedAt: '2026-01-01T00:00:00.000Z',
      };
      expect(view.$type).toBe('app.bsky.embed.record#viewRecord');
      expect(view.value.text).toBe('Hello world');
    });

    it('should type-check viewBlocked', () => {
      const view: EmbedRecordViewBlocked = {
        $type: 'app.bsky.embed.record#viewBlocked',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        blocked: true,
        author: { did: 'did:plc:abc' },
      };
      expect(view.$type).toBe('app.bsky.embed.record#viewBlocked');
      expect(view.blocked).toBe(true);
    });

    it('should type-check viewDetached', () => {
      const view: EmbedRecordViewDetached = {
        $type: 'app.bsky.embed.record#viewDetached',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        detached: true,
      };
      expect(view.$type).toBe('app.bsky.embed.record#viewDetached');
    });

    it('should type-check viewNotFound', () => {
      const view: EmbedRecordViewNotFound = {
        $type: 'app.bsky.embed.record#viewNotFound',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        notFound: true,
      };
      expect(view.$type).toBe('app.bsky.embed.record#viewNotFound');
    });

    it('should discriminate union by $type', () => {
      const view: EmbedRecordView = {
        $type: 'app.bsky.embed.record#viewRecord',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        cid: 'bafyabc',
        author: { did: 'did:plc:abc', handle: 'user.bsky.social' },
        value: {
          $type: 'app.bsky.feed.post',
          text: 'Test',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        indexedAt: '2026-01-01T00:00:00.000Z',
      };

      if (view.$type === 'app.bsky.embed.record#viewRecord') {
        expect(view.value.text).toBe('Test');
      }
    });
  });

  describe('PostView with embed', () => {
    it('should accept a post with a record embed', () => {
      const post: PostView = {
        uri: 'at://did:plc:parent/app.bsky.feed.post/456',
        cid: 'bafyparent',
        author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'Check this out',
          createdAt: '2026-01-01T00:00:00.000Z',
          embed: {
            $type: 'app.bsky.embed.record',
            record: {
              uri: 'at://did:plc:quoted/app.bsky.feed.post/789',
              cid: 'bafyquoted',
            },
          },
        },
        embed: {
          $type: 'app.bsky.embed.record#view',
          record: {
            $type: 'app.bsky.embed.record#viewBlocked',
            uri: 'at://did:plc:quoted/app.bsky.feed.post/789',
            blocked: true,
            author: { did: 'did:plc:quoted' },
          },
        },
        indexedAt: '2026-01-01T00:00:00.000Z',
      };

      expect(post.embed?.$type).toBe('app.bsky.embed.record#view');
      const embedRecord = post.embed as PostViewEmbedRecord;
      expect(embedRecord.record.$type).toBe('app.bsky.embed.record#viewBlocked');
    });
  });

  describe('GetPostsResponse', () => {
    it('should accept empty posts array', () => {
      const response: GetPostsResponse = { posts: [] };
      expect(response.posts).toHaveLength(0);
    });

    it('should accept posts array with PostView objects', () => {
      const response: GetPostsResponse = {
        posts: [
          {
            uri: 'at://did:plc:test/app.bsky.feed.post/123',
            cid: 'bafytest',
            author: { did: 'did:plc:test', handle: 'test.bsky.social' },
            record: {
              $type: 'app.bsky.feed.post',
              text: 'Test post',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            indexedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
      expect(response.posts).toHaveLength(1);
    });
  });
});

describe('getPostsPublic', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty array for empty input', async () => {
    const { getPostsPublic } = await import('../platform/api');
    const result = await getPostsPublic([]);
    expect(result.posts).toHaveLength(0);
  });

  it('should throw for more than 25 URIs', async () => {
    const { getPostsPublic } = await import('../platform/api');
    const uris = Array.from({ length: 26 }, (_, i) => `at://did:plc:test/app.bsky.feed.post/${i}`);
    await expect(getPostsPublic(uris)).rejects.toThrow('max 25');
  });

  it('should call public API without auth header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ posts: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getPostsPublic } = await import('../platform/api');
    await getPostsPublic(['at://did:plc:test/app.bsky.feed.post/123']);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('public.api.bsky.app');
    expect(url).toContain('app.bsky.feed.getPosts');
    // Verify no Authorization header
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('should throw on API error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'Bad Request' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getPostsPublic } = await import('../platform/api');
    await expect(getPostsPublic(['at://did:plc:test/app.bsky.feed.post/123'])).rejects.toThrow(
      'Bad Request'
    );
  });
});
