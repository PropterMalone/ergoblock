import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getSession,
  getProfile,
  blockUser,
  unblockUser,
  muteUser,
  unmuteUser,
  getBlocks,
  getMutes,
  getAllBlocks,
  getAllMutes,
  executeApiRequest,
  getBlockRecords,
  getAllBlockRecords,
  getAuthorFeed,
  findRecentInteraction,
} from '../api.js';

describe('API Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create a robust Storage mock
    const store: Record<string, string> = {};
    const localStorageMock = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value.toString();
      }),
      clear: vi.fn(() => {
        for (const key in store) delete store[key];
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      key: vi.fn((index: number) => Object.keys(store)[index] || null),
      get length() {
        return Object.keys(store).length;
      },
    };

    // This makes Object.keys(localStorage) work
    Object.setPrototypeOf(localStorageMock, Object.prototype);

    // We need to proxy it so that Object.keys(localStorage) returns the keys in the store
    const proxy = new Proxy(localStorageMock, {
      get(target, prop, _receiver) {
        if (prop in target) return target[prop as keyof typeof target];
        if (typeof prop === 'string' && prop in store) return store[prop];
        return undefined;
      },
      ownKeys(_target) {
        return Object.keys(store);
      },
      getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === 'string' && prop in store) {
          return {
            enumerable: true,
            configurable: true,
          };
        }
        return undefined;
      },
    });

    vi.stubGlobal('localStorage', proxy);
    vi.stubGlobal('window', { localStorage: proxy, location: { pathname: '/' } });

    // Mock fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getSession', () => {
    it('should return null when no session is found', () => {
      const session = getSession();
      expect(session).toBeNull();
    });

    it('should extract session from direct account object structure', () => {
      const mockSession = {
        accessJwt: 'test-jwt',
        did: 'did:test:123',
        handle: 'test.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));

      const session = getSession();
      expect(session).not.toBeNull();
      expect(session?.accessJwt).toBe('test-jwt');
      expect(session?.did).toBe('did:test:123');
      expect(session?.pdsUrl).toBe('https://pds.test.com');
    });

    it('should extract session from structure with currentAccount', () => {
      const mockStorage = {
        currentAccount: { did: 'did:test:123' },
        accounts: [{ did: 'did:test:123', accessJwt: 'test-jwt', handle: 'test.bsky.social' }],
      };

      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockStorage));

      const session = getSession();
      expect(session?.accessJwt).toBe('test-jwt');
      expect(session?.did).toBe('did:test:123');
    });

    it('should extract session from nested session structure', () => {
      const mockStorage = {
        session: {
          currentAccount: { did: 'did:test:123' },
          accounts: [{ did: 'did:test:123', accessJwt: 'test-jwt', handle: 'test.bsky.social' }],
        },
      };

      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockStorage));

      const session = getSession();
      expect(session?.accessJwt).toBe('test-jwt');
    });

    it('should normalize PDS URL (remove trailing slashes, add https)', () => {
      const mockSession = {
        accessJwt: 'test-jwt',
        did: 'did:test:123',
        service: 'pds.test.com/',
      };

      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));

      const session = getSession();
      expect(session?.pdsUrl).toBe('https://pds.test.com');
    });
  });

  describe('getProfile', () => {
    it('should fetch profile successfully', async () => {
      // Setup session
      const mockSession = {
        accessJwt: 'test-jwt',
        did: 'did:test:123',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));

      // Setup fetch mock
      const mockProfile = { did: 'did:test:456', handle: 'target.bsky.social' };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockProfile)),
      });

      const profile = await getProfile('target.bsky.social');

      expect(profile).toEqual(mockProfile);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('app.bsky.actor.getProfile'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-jwt',
          }),
        })
      );
    });

    it('should throw error when not logged in', async () => {
      await expect(getProfile('target.bsky.social')).rejects.toThrow('Not logged in to Bluesky');
    });
  });

  describe('API Operations', () => {
    beforeEach(() => {
      const mockSession = {
        accessJwt: 'test-jwt',
        did: 'did:test:123',
        pdsUrl: 'https://pds.test.com',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));
    });

    it('should block a user', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
      });

      await blockUser('did:target:456');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('com.atproto.repo.createRecord'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('did:target:456'),
        })
      );
    });

    it('should unblock a user', async () => {
      // First call to listRecords
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              records: [
                {
                  uri: 'at://did:test:123/app.bsky.graph.block/rkey123',
                  value: { subject: 'did:target:456' },
                },
              ],
            })
          ),
      });
      // Second call to deleteRecord
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await unblockUser('did:target:456');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('deleteRecord'),
        expect.any(Object)
      );
    });

    it('should unblock a user directly when rkey is provided', async () => {
      // Should call deleteRecord directly without listing records
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await unblockUser('did:target:456', 'known-rkey-123');

      // Check that listRecords was NOT called
      expect(fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('listRecords'),
        expect.any(Object)
      );

      // Check that deleteRecord WAS called with the correct rkey
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('deleteRecord'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('known-rkey-123'),
        })
      );
    });

    it('should mute a user', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await muteUser('did:target:456');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('app.bsky.graph.muteActor'),
        expect.any(Object)
      );
    });

    it('should unmute a user', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await unmuteUser('did:target:456');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('app.bsky.graph.unmuteActor'),
        expect.any(Object)
      );
    });
  });

  describe('Paginated Block/Mute Lists', () => {
    beforeEach(() => {
      const mockSession = {
        accessJwt: 'test-jwt',
        did: 'did:test:123',
        pdsUrl: 'https://pds.test.com',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));
    });

    it('should fetch a page of blocks', async () => {
      const mockResponse = {
        blocks: [
          { did: 'did:block:1', handle: 'blocked1.bsky.social' },
          { did: 'did:block:2', handle: 'blocked2.bsky.social' },
        ],
        cursor: 'next-cursor-123',
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await getBlocks();

      expect(result.blocks.length).toBe(2);
      expect(result.cursor).toBe('next-cursor-123');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('app.bsky.graph.getBlocks'),
        expect.any(Object)
      );
    });

    it('should fetch blocks with cursor', async () => {
      const mockResponse = {
        blocks: [{ did: 'did:block:3', handle: 'blocked3.bsky.social' }],
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await getBlocks('prev-cursor-456');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('cursor=prev-cursor-456'),
        expect.any(Object)
      );
    });

    it('should fetch a page of mutes', async () => {
      const mockResponse = {
        mutes: [
          { did: 'did:mute:1', handle: 'muted1.bsky.social' },
          { did: 'did:mute:2', handle: 'muted2.bsky.social' },
        ],
        cursor: 'mute-cursor-123',
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await getMutes();

      expect(result.mutes.length).toBe(2);
      expect(result.cursor).toBe('mute-cursor-123');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('app.bsky.graph.getMutes'),
        expect.any(Object)
      );
    });

    it('should fetch all blocks with pagination', async () => {
      // First page
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              blocks: [{ did: 'did:block:1', handle: 'blocked1.bsky.social' }],
              cursor: 'page2',
            })
          ),
      });
      // Second page (no cursor = last page)
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              blocks: [{ did: 'did:block:2', handle: 'blocked2.bsky.social' }],
            })
          ),
      });

      const progressCallback = vi.fn();
      const allBlocks = await getAllBlocks(progressCallback);

      expect(allBlocks.length).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenCalled();
    });

    it('should fetch all mutes with pagination', async () => {
      // First page
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              mutes: [{ did: 'did:mute:1', handle: 'muted1.bsky.social' }],
              cursor: 'page2',
            })
          ),
      });
      // Second page (no cursor = last page)
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              mutes: [{ did: 'did:mute:2', handle: 'muted2.bsky.social' }],
            })
          ),
      });

      const allMutes = await getAllMutes();

      expect(allMutes.length).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should return empty blocks when no session', async () => {
      localStorage.clear();

      await expect(getBlocks()).rejects.toThrow('Not logged in');
    });

    it('should return empty mutes when no session', async () => {
      localStorage.clear();

      await expect(getMutes()).rejects.toThrow('Not logged in');
    });
  });

  describe('executeApiRequest', () => {
    it('should route repo endpoints to PDS', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{}'),
      });

      await executeApiRequest(
        'com.atproto.repo.createRecord',
        'POST',
        { test: true },
        { accessJwt: 'test-jwt', pdsUrl: 'https://my-pds.com' }
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://my-pds.com/xrpc/com.atproto.repo.createRecord',
        expect.any(Object)
      );
    });

    it('should route app.bsky endpoints to public API', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{}'),
      });

      await executeApiRequest('app.bsky.actor.getProfile?actor=test', 'GET', null, {
        accessJwt: 'test-jwt',
        pdsUrl: 'https://my-pds.com',
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=test',
        expect.any(Object)
      );
    });

    it('should throw auth error on 401', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Invalid token' }),
      });

      await expect(
        executeApiRequest(
          'com.atproto.repo.createRecord',
          'POST',
          {},
          {
            accessJwt: 'bad-jwt',
            pdsUrl: 'https://pds.com',
          }
        )
      ).rejects.toThrow('Auth error');
    });

    it('should throw generic error on non-401 failures', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Server error' }),
      });

      await expect(
        executeApiRequest(
          'com.atproto.repo.createRecord',
          'POST',
          {},
          {
            accessJwt: 'jwt',
            pdsUrl: 'https://pds.com',
          }
        )
      ).rejects.toThrow('Server error');
    });

    it('should handle empty responses', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const result = await executeApiRequest(
        'app.bsky.graph.muteActor',
        'POST',
        { actor: 'did:test' },
        { accessJwt: 'jwt', pdsUrl: 'https://pds.com' }
      );

      expect(result).toBeNull();
    });
  });

  describe('Block Records API', () => {
    beforeEach(() => {
      const mockSession = {
        accessJwt: 'test-jwt',
        did: 'did:test:123',
        pdsUrl: 'https://pds.test.com',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));
    });

    it('should fetch a page of block records with createdAt', async () => {
      const mockResponse = {
        records: [
          {
            uri: 'at://did:test:123/app.bsky.graph.block/abc123',
            cid: 'cid123',
            value: {
              $type: 'app.bsky.graph.block',
              subject: 'did:blocked:456',
              createdAt: '2024-01-15T10:30:00.000Z',
            },
          },
        ],
        cursor: 'next-cursor',
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await getBlockRecords();

      expect(result.records.length).toBe(1);
      expect(result.records[0].value.subject).toBe('did:blocked:456');
      expect(result.records[0].value.createdAt).toBe('2024-01-15T10:30:00.000Z');
      expect(result.cursor).toBe('next-cursor');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('com.atproto.repo.listRecords'),
        expect.any(Object)
      );
    });

    it('should fetch all block records with pagination', async () => {
      // First page
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              records: [
                {
                  uri: 'at://did:test:123/app.bsky.graph.block/abc1',
                  cid: 'cid1',
                  value: {
                    $type: 'app.bsky.graph.block',
                    subject: 'did:blocked:1',
                    createdAt: '2024-01-15T10:00:00.000Z',
                  },
                },
              ],
              cursor: 'page2',
            })
          ),
      });
      // Second page (no cursor = last page)
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              records: [
                {
                  uri: 'at://did:test:123/app.bsky.graph.block/abc2',
                  cid: 'cid2',
                  value: {
                    $type: 'app.bsky.graph.block',
                    subject: 'did:blocked:2',
                    createdAt: '2024-01-15T11:00:00.000Z',
                  },
                },
              ],
            })
          ),
      });

      const allRecords = await getAllBlockRecords();

      expect(allRecords.length).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw when not logged in', async () => {
      localStorage.clear();
      await expect(getBlockRecords()).rejects.toThrow('Not logged in');
    });
  });

  describe('Author Feed API', () => {
    beforeEach(() => {
      const mockSession = {
        accessJwt: 'test-jwt',
        did: 'did:test:123',
        pdsUrl: 'https://pds.test.com',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));
    });

    it('should fetch author feed', async () => {
      const mockResponse = {
        feed: [
          {
            post: {
              uri: 'at://did:author:456/app.bsky.feed.post/post1',
              cid: 'cid1',
              author: { did: 'did:author:456', handle: 'author.bsky.social' },
              record: {
                text: 'Test post',
                createdAt: '2024-01-15T10:00:00.000Z',
              },
            },
          },
        ],
        cursor: 'feed-cursor',
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await getAuthorFeed('did:author:456');

      expect(result.feed.length).toBe(1);
      expect(result.feed[0].post.record.text).toBe('Test post');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('app.bsky.feed.getAuthorFeed'),
        expect.any(Object)
      );
    });
  });

  describe('findRecentInteraction', () => {
    beforeEach(() => {
      const mockSession = {
        accessJwt: 'test-jwt',
        did: 'did:test:123',
        pdsUrl: 'https://pds.test.com',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));
    });

    it('should find reply to logged-in user', async () => {
      const mockResponse = {
        feed: [
          {
            post: {
              uri: 'at://did:blocker:456/app.bsky.feed.post/reply1',
              cid: 'cid1',
              author: { did: 'did:blocker:456', handle: 'blocker.bsky.social' },
              record: {
                text: 'This is a reply',
                createdAt: '2024-01-15T10:00:00.000Z',
                reply: {
                  parent: { uri: 'at://did:test:123/app.bsky.feed.post/original' },
                },
              },
            },
          },
        ],
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await findRecentInteraction('did:blocker:456', 'did:test:123');

      expect(result).not.toBeNull();
      expect(result?.record.text).toBe('This is a reply');
    });

    it('should find quote of logged-in user post', async () => {
      const mockResponse = {
        feed: [
          {
            post: {
              uri: 'at://did:blocker:456/app.bsky.feed.post/quote1',
              cid: 'cid1',
              author: { did: 'did:blocker:456', handle: 'blocker.bsky.social' },
              record: {
                text: 'Quote tweeting you',
                createdAt: '2024-01-15T10:00:00.000Z',
                embed: {
                  $type: 'app.bsky.embed.record',
                  record: { uri: 'at://did:test:123/app.bsky.feed.post/quoted' },
                },
              },
            },
          },
        ],
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await findRecentInteraction('did:blocker:456', 'did:test:123');

      expect(result).not.toBeNull();
      expect(result?.record.text).toBe('Quote tweeting you');
    });

    it('should return null if no interactions found', async () => {
      const mockResponse = {
        feed: [
          {
            post: {
              uri: 'at://did:blocker:456/app.bsky.feed.post/random',
              cid: 'cid1',
              author: { did: 'did:blocker:456', handle: 'blocker.bsky.social' },
              record: {
                text: 'Unrelated post',
                createdAt: '2024-01-15T10:00:00.000Z',
              },
            },
          },
        ],
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await findRecentInteraction('did:blocker:456', 'did:test:123');

      expect(result).toBeNull();
    });

    it('should handle fetch errors gracefully', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const result = await findRecentInteraction('did:blocker:456', 'did:test:123');

      expect(result).toBeNull();
    }, 15000); // Extended timeout to account for retry delays
  });
});
