import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectConcealedQuote, resolveQuoteEmbed } from '../domains/qt-peek';

/**
 * Helper to create a mock post container with a concealed quote embed
 */
function createPostWithConcealedQuote(placeholderText: string): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-testid', 'feedItem-abc');

  // Post author area
  const authorLink = document.createElement('a');
  authorLink.href = '/profile/parent.bsky.social';
  container.appendChild(authorLink);

  // Post text
  const postText = document.createElement('div');
  postText.setAttribute('data-testid', 'postText');
  postText.textContent = 'Check out this quote:';
  container.appendChild(postText);

  // Post link (to the parent post itself)
  const postLink = document.createElement('a');
  postLink.href = '/profile/parent.bsky.social/post/abc123';
  container.appendChild(postLink);

  // Quote embed container (concealed — has border but NO /post/ link inside)
  const embedContainer = document.createElement('div');
  embedContainer.style.borderWidth = '1px';
  embedContainer.style.borderStyle = 'solid';
  embedContainer.style.borderRadius = '8px';
  embedContainer.style.padding = '12px';

  const placeholderEl = document.createElement('div');
  placeholderEl.textContent = placeholderText;
  embedContainer.appendChild(placeholderEl);

  container.appendChild(embedContainer);

  return container;
}

/**
 * Helper to create a post with a normal (visible) quote embed
 */
function createPostWithNormalQuote(): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-testid', 'feedItem-abc');

  // Post text
  const postText = document.createElement('div');
  postText.setAttribute('data-testid', 'postText');
  postText.textContent = 'Look at this:';
  container.appendChild(postText);

  // Post link (to parent post)
  const postLink = document.createElement('a');
  postLink.href = '/profile/parent.bsky.social/post/abc123';
  container.appendChild(postLink);

  // Quote embed container (normal — has a post link inside)
  const embedContainer = document.createElement('div');
  embedContainer.style.borderWidth = '1px';
  embedContainer.style.borderStyle = 'solid';
  embedContainer.style.borderRadius = '8px';

  const quotedPostLink = document.createElement('a');
  quotedPostLink.href = '/profile/quoted.bsky.social/post/xyz789';
  quotedPostLink.textContent = 'Quoted post content here...';
  embedContainer.appendChild(quotedPostLink);

  container.appendChild(embedContainer);

  return container;
}

/**
 * Helper to create a post with no quote embed at all
 */
function createPostWithoutQuote(): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-testid', 'feedItem-abc');

  const postText = document.createElement('div');
  postText.setAttribute('data-testid', 'postText');
  postText.textContent = 'Just a regular post with no quote embed.';
  container.appendChild(postText);

  return container;
}

describe('detectConcealedQuote', () => {
  // Mock window.getComputedStyle since jsdom/happy-dom may not compute styles from inline
  let originalGetComputedStyle: typeof window.getComputedStyle;

  beforeEach(() => {
    originalGetComputedStyle = window.getComputedStyle;
    // Override getComputedStyle to return inline styles
    window.getComputedStyle = vi.fn((el: Element) => {
      const htmlEl = el as HTMLElement;
      return {
        borderWidth: htmlEl.style.borderWidth || '0px',
        borderTopWidth: htmlEl.style.borderTopWidth || '0px',
        borderStyle: htmlEl.style.borderStyle || 'none',
        borderRadius: htmlEl.style.borderRadius || '0px',
      } as CSSStyleDeclaration;
    });
  });

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
  });

  it('should detect blocked post placeholder', () => {
    const container = createPostWithConcealedQuote('Blocked post');
    const result = detectConcealedQuote(container);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('blocked');
    expect(result!.placeholderElement).toBeInstanceOf(HTMLElement);
  });

  it('should detect detached post placeholder', () => {
    const container = createPostWithConcealedQuote('Post has been detached');
    const result = detectConcealedQuote(container);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('detached');
  });

  it('should detect not-found post placeholder', () => {
    const container = createPostWithConcealedQuote('Post not found');
    const result = detectConcealedQuote(container);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('not-found');
  });

  it('should return null for normal quote embed (has post link)', () => {
    const container = createPostWithNormalQuote();
    const result = detectConcealedQuote(container);

    expect(result).toBeNull();
  });

  it('should return null for post without any quote embed', () => {
    const container = createPostWithoutQuote();
    const result = detectConcealedQuote(container);

    expect(result).toBeNull();
  });

  it('should be case-insensitive', () => {
    const container = createPostWithConcealedQuote('BLOCKED POST');
    const result = detectConcealedQuote(container);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('blocked');
  });

  it('should not match very long text (regular post content)', () => {
    // Create a post where the post text itself contains "blocked" but isn't a placeholder
    const container = document.createElement('div');
    container.setAttribute('data-testid', 'feedItem-abc');

    const postText = document.createElement('div');
    postText.setAttribute('data-testid', 'postText');
    postText.textContent =
      'I saw a blocked post the other day and it was really frustrating because I wanted to see what it said but could not.';
    container.appendChild(postText);

    const result = detectConcealedQuote(container);
    expect(result).toBeNull();
  });
});

// Mock browser.runtime.sendMessage
vi.mock('../browser.js', () => ({
  default: {
    runtime: {
      sendMessage: vi.fn(),
    },
    storage: {
      local: { get: vi.fn(), set: vi.fn() },
      sync: { get: vi.fn(), set: vi.fn() },
    },
  },
}));

describe('resolveQuoteEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve viewRecord directly from parent post', async () => {
    const { default: browser } = await import('../platform/browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Check this out',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          embed: {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewRecord',
              uri: 'at://did:plc:quoted/app.bsky.feed.post/quoted789',
              cid: 'bafyquoted',
              author: {
                did: 'did:plc:quoted',
                handle: 'quoted.bsky.social',
                displayName: 'Quoted User',
              },
              value: {
                $type: 'app.bsky.feed.post',
                text: 'This is the hidden quoted post!',
                createdAt: '2025-12-31T00:00:00.000Z',
              },
              indexedAt: '2025-12-31T00:00:00.000Z',
            },
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'blocked'
    );

    expect(result).not.toBeNull();
    expect(result!.text).toBe('This is the hidden quoted post!');
    expect(result!.authorHandle).toBe('quoted.bsky.social');
    expect(result!.authorDisplayName).toBe('Quoted User');
    expect(result!.concealmentType).toBe('blocked');
  });

  it('should do two-step fetch for viewBlocked embed', async () => {
    const { default: browser } = await import('../platform/browser');
    const sendMessage = vi.mocked(browser.runtime.sendMessage);

    // First call: parent post with viewBlocked embed
    sendMessage.mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Look at this',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          embed: {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewBlocked',
              uri: 'at://did:plc:blocked/app.bsky.feed.post/blocked456',
              blocked: true,
              author: { did: 'did:plc:blocked' },
            },
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    // Second call: direct fetch of blocked post
    sendMessage.mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:blocked/app.bsky.feed.post/blocked456',
          cid: 'bafyblocked',
          author: {
            did: 'did:plc:blocked',
            handle: 'blocked.bsky.social',
            displayName: 'Blocked Person',
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'The blocked post content',
            createdAt: '2025-12-15T00:00:00.000Z',
          },
          indexedAt: '2025-12-15T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'blocked'
    );

    expect(result).not.toBeNull();
    expect(result!.text).toBe('The blocked post content');
    expect(result!.authorHandle).toBe('blocked.bsky.social');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('should do two-step fetch for viewDetached embed', async () => {
    const { default: browser } = await import('../platform/browser');
    const sendMessage = vi.mocked(browser.runtime.sendMessage);

    sendMessage.mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Quoting this',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          embed: {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewDetached',
              uri: 'at://did:plc:detached/app.bsky.feed.post/detached789',
              detached: true,
            },
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    sendMessage.mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:detached/app.bsky.feed.post/detached789',
          cid: 'bafydetached',
          author: { did: 'did:plc:detached', handle: 'detached.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'The detached post content',
            createdAt: '2025-11-01T00:00:00.000Z',
          },
          indexedAt: '2025-11-01T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'detached'
    );

    expect(result).not.toBeNull();
    expect(result!.text).toBe('The detached post content');
    expect(result!.concealmentType).toBe('detached');
  });

  it('should return null for viewNotFound (deleted post)', async () => {
    const { default: browser } = await import('../platform/browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Old quote',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          embed: {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewNotFound',
              uri: 'at://did:plc:gone/app.bsky.feed.post/gone000',
              notFound: true,
            },
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'not-found'
    );

    expect(result).toBeNull();
  });

  it('should return null when parent post has no embed', async () => {
    const { default: browser } = await import('../platform/browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'No embed here',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'blocked'
    );

    expect(result).toBeNull();
  });

  it('should return null when parent post not found', async () => {
    const { default: browser } = await import('../platform/browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      posts: [],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:missing/app.bsky.feed.post/missing123',
      'blocked'
    );

    expect(result).toBeNull();
  });

  it('should throw when background returns error', async () => {
    const { default: browser } = await import('../platform/browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: false,
      error: 'Network error',
    });

    await expect(
      resolveQuoteEmbed('at://did:plc:parent/app.bsky.feed.post/parent123', 'blocked')
    ).rejects.toThrow('Network error');
  });
});
