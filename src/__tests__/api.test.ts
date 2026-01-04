import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getSession, getProfile, blockUser, unblockUser, muteUser, unmuteUser } from '../api.js';

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
});
