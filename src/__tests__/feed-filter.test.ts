import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { initFeedFilter, refreshFiltering, getFilterStats } from '../domains/feed-filter.js';

// Mock storage module
vi.mock('../platform/storage.js', () => ({
  getRepostFilteredUsers: vi.fn().mockResolvedValue({}),
  STORAGE_KEYS: { REPOST_FILTERED_USERS: 'repostFilteredUsers' },
}));

// Helper to create a feed item with a repost indicator
function createRepostFeedItem(reposterHandle: string): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-testid', 'feedItem-123');

  const repostIndicator = document.createElement('div');
  repostIndicator.setAttribute('data-testid', 'repostedBy');

  const link = document.createElement('a');
  link.href = `https://bsky.app/profile/${reposterHandle}`;
  repostIndicator.appendChild(link);

  item.appendChild(repostIndicator);
  return item;
}

// Helper to create a regular (non-repost) feed item
function createRegularFeedItem(): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-testid', 'feedItem-456');
  const text = document.createElement('p');
  text.textContent = 'Regular post content';
  item.appendChild(text);
  return item;
}

describe('Feed Filter Module', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // Reset location to home page for isFilterableFeedPage
    Object.defineProperty(window, 'location', {
      value: { pathname: '/', href: 'https://bsky.app/' },
      writable: true,
    });
  });

  afterEach(() => {
    // Clean up any observers by refreshing with empty filters
    vi.clearAllMocks();
  });

  describe('getFilterStats', () => {
    it('should return zero counts when no filters are active', () => {
      const stats = getFilterStats();
      expect(stats.filteredHandles).toBe(0);
      expect(stats.hiddenItems).toBe(0);
    });

    it('should count hidden items in the DOM', async () => {
      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:spammer': {
          did: 'did:plc:spammer',
          handle: 'spammer.bsky.social',
          addedAt: Date.now(),
        },
      });

      // Create feed items
      const container = document.createElement('main');
      const repostItem = createRepostFeedItem('spammer.bsky.social');
      const regularItem = createRegularFeedItem();
      container.appendChild(repostItem);
      container.appendChild(regularItem);
      document.body.appendChild(container);

      await refreshFiltering();

      const stats = getFilterStats();
      expect(stats.filteredHandles).toBe(1);
      expect(stats.hiddenItems).toBe(1);
    });
  });

  describe('refreshFiltering', () => {
    it('should hide reposts from filtered users', async () => {
      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:spam': {
          did: 'did:plc:spam',
          handle: 'SpamUser.bsky.social',
          addedAt: Date.now(),
        },
      });

      // Set up DOM
      const container = document.createElement('main');
      const repostItem = createRepostFeedItem('spamuser.bsky.social'); // lowercase match
      container.appendChild(repostItem);
      document.body.appendChild(container);

      await refreshFiltering();

      expect(repostItem.style.display).toBe('none');
      expect(repostItem.getAttribute('data-ergoblock-filtered')).toBe('repost');
    });

    it('should not hide reposts from non-filtered users', async () => {
      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:spam': { did: 'did:plc:spam', handle: 'spammer.bsky.social', addedAt: Date.now() },
      });

      const container = document.createElement('main');
      const repostItem = createRepostFeedItem('gooduser.bsky.social');
      container.appendChild(repostItem);
      document.body.appendChild(container);

      await refreshFiltering();

      expect(repostItem.style.display).not.toBe('none');
      expect(repostItem.getAttribute('data-ergoblock-filtered')).toBeNull();
    });

    it('should not hide regular (non-repost) feed items', async () => {
      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:spam': { did: 'did:plc:spam', handle: 'spammer.bsky.social', addedAt: Date.now() },
      });

      const container = document.createElement('main');
      const regularItem = createRegularFeedItem();
      container.appendChild(regularItem);
      document.body.appendChild(container);

      await refreshFiltering();

      expect(regularItem.style.display).not.toBe('none');
    });

    it('should unhide items when filters are cleared', async () => {
      const storage = await import('../platform/storage.js');
      // First, set up a filter and hide items
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:spam': { did: 'did:plc:spam', handle: 'spammer.bsky.social', addedAt: Date.now() },
      });

      const container = document.createElement('main');
      const repostItem = createRepostFeedItem('spammer.bsky.social');
      container.appendChild(repostItem);
      document.body.appendChild(container);

      await refreshFiltering();
      expect(repostItem.style.display).toBe('none');

      // Now clear filters
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({});
      await refreshFiltering();

      expect(repostItem.style.display).toBe('');
      expect(repostItem.getAttribute('data-ergoblock-filtered')).toBeNull();
    });

    it('should handle case-insensitive handle matching', async () => {
      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:user': {
          did: 'did:plc:user',
          handle: 'MixedCase.BSky.Social',
          addedAt: Date.now(),
        },
      });

      const container = document.createElement('main');
      const repostItem = createRepostFeedItem('mixedcase.bsky.social');
      container.appendChild(repostItem);
      document.body.appendChild(container);

      await refreshFiltering();

      expect(repostItem.style.display).toBe('none');
    });

    it('should do nothing when not on a filterable page', async () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/profile/someone', href: 'https://bsky.app/profile/someone' },
        writable: true,
      });

      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:spam': { did: 'did:plc:spam', handle: 'spam.bsky.social', addedAt: Date.now() },
      });

      const container = document.createElement('main');
      const repostItem = createRepostFeedItem('spam.bsky.social');
      container.appendChild(repostItem);
      document.body.appendChild(container);

      await refreshFiltering();

      // Item should NOT be hidden because we're not on a filterable page
      // (refreshFiltering still scans when filters exist, but startObserving checks)
      // Actually refreshFiltering checks isFilterableFeedPage for the re-scan
      expect(repostItem.style.display).not.toBe('none');
    });
  });

  describe('initFeedFilter', () => {
    it('should do nothing when no filters configured', async () => {
      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await initFeedFilter();

      // No observer set up, stats should show 0
      const stats = getFilterStats();
      expect(stats.filteredHandles).toBe(0);
    });

    it('should start filtering when filters exist on a feed page', async () => {
      // Add missing onChanged mock that initFeedFilter requires
      if (!chrome.storage.onChanged) {
        Object.assign(chrome.storage, { onChanged: { addListener: vi.fn() } });
      }

      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:spam': { did: 'did:plc:spam', handle: 'spammer.bsky.social', addedAt: Date.now() },
      });

      // Create a feed container with a repost
      const container = document.createElement('main');
      const repostItem = createRepostFeedItem('spammer.bsky.social');
      container.appendChild(repostItem);
      document.body.appendChild(container);

      await initFeedFilter();

      const stats = getFilterStats();
      expect(stats.filteredHandles).toBe(1);
    });
  });

  describe('extractReposterHandle (via filterFeedItem)', () => {
    it('should extract handle from repost indicator link', async () => {
      const storage = await import('../platform/storage.js');
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:u': { did: 'did:plc:u', handle: 'linkuser.bsky.social', addedAt: Date.now() },
      });

      const container = document.createElement('main');
      const repostItem = createRepostFeedItem('linkuser.bsky.social');
      container.appendChild(repostItem);
      document.body.appendChild(container);

      await refreshFiltering();
      expect(repostItem.style.display).toBe('none');
    });

    it('should extract handle from repost indicator text fallback', async () => {
      const storage = await import('../platform/storage.js');
      // The text fallback regex matches the first word-like token, so use a
      // handle-only text node (no "Reposted by" prefix) to exercise the path.
      (storage.getRepostFilteredUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
        'did:plc:t': { did: 'did:plc:t', handle: 'textuser.test', addedAt: Date.now() },
      });

      // Create item with text-only repost indicator (no link)
      const item = document.createElement('div');
      item.setAttribute('data-testid', 'feedItem-789');
      const indicator = document.createElement('div');
      indicator.setAttribute('data-testid', 'repostedBy');
      indicator.textContent = '@textuser.test';
      item.appendChild(indicator);

      const container = document.createElement('main');
      container.appendChild(item);
      document.body.appendChild(container);

      await refreshFiltering();
      expect(item.style.display).toBe('none');
    });
  });
});
