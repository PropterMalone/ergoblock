import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  findPostContainer,
  capturePostContext,
  EngagementContext,
  NotificationContext,
} from '../post-context.js';

// Mock storage module
vi.mock('../storage.js', () => ({
  getOptions: vi.fn().mockResolvedValue({ savePostContext: true }),
  addPostContext: vi.fn().mockResolvedValue(undefined),
}));

describe('Post Context Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('findPostContainer', () => {
    it('should return null for null element', () => {
      expect(findPostContainer(null)).toBeNull();
    });

    it('should find feedItem container', () => {
      document.body.innerHTML =
        '<div data-testid="feedItem-123"><button id="target">Click</button></div>';
      const button = document.getElementById('target') as HTMLElement;
      const container = findPostContainer(button);
      expect(container).not.toBeNull();
      expect(container?.getAttribute('data-testid')).toBe('feedItem-123');
    });

    it('should find postThreadItem container', () => {
      document.body.innerHTML =
        '<div data-testid="postThreadItem-456"><span id="target">Text</span></div>';
      const span = document.getElementById('target') as HTMLElement;
      const container = findPostContainer(span);
      expect(container).not.toBeNull();
    });

    it('should find article container', () => {
      document.body.innerHTML = '<article><p id="target">Post text</p></article>';
      const p = document.getElementById('target') as HTMLElement;
      const container = findPostContainer(p);
      expect(container).not.toBeNull();
      expect(container?.tagName).toBe('ARTICLE');
    });

    it('should find notification container', () => {
      document.body.innerHTML =
        '<div data-testid="notification-789"><div id="target">Notification</div></div>';
      const div = document.getElementById('target') as HTMLElement;
      const container = findPostContainer(div);
      expect(container).not.toBeNull();
    });

    it('should return null when no matching container exists', () => {
      document.body.innerHTML = '<div class="random"><span id="target">No container</span></div>';
      const span = document.getElementById('target') as HTMLElement;
      expect(findPostContainer(span)).toBeNull();
    });
  });

  describe('capturePostContext', () => {
    it('should return null when savePostContext option is disabled', async () => {
      const storage = await import('../storage.js');
      (storage.getOptions as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        savePostContext: false,
      });

      const result = await capturePostContext(
        null,
        'target.bsky.social',
        'did:target:123',
        'block',
        false
      );
      expect(result).toBeNull();
    });

    it('should capture context without post container', async () => {
      const storage = await import('../storage.js');
      const result = await capturePostContext(
        null,
        'target.bsky.social',
        'did:target:123',
        'block',
        false
      );

      expect(result).not.toBeNull();
      expect(result?.targetHandle).toBe('target.bsky.social');
      expect(result?.targetDid).toBe('did:target:123');
      expect(result?.actionType).toBe('block');
      expect(result?.permanent).toBe(false);
      expect(result?.postUri).toBe('');
      expect(storage.addPostContext).toHaveBeenCalled();
    });

    it('should capture context with post container containing links', async () => {
      document.body.innerHTML =
        '<article id="post-container"><a href="https://bsky.app/profile/author.bsky.social/post/abc123">Link</a><div data-testid="postText">This is the post content</div></article>';
      const container = document.getElementById('post-container') as HTMLElement;

      const result = await capturePostContext(
        container,
        'target.bsky.social',
        'did:target:456',
        'mute',
        true
      );

      expect(result).not.toBeNull();
      expect(result?.postUri).toBe('at://author.bsky.social/app.bsky.feed.post/abc123');
      expect(result?.postText).toBe('This is the post content');
      expect(result?.actionType).toBe('mute');
      expect(result?.permanent).toBe(true);
    });

    it('should capture engagement context when provided', async () => {
      const engagementContext: EngagementContext = {
        type: 'like',
        postUri: 'at://did:author/app.bsky.feed.post/liked123',
        sourceUrl: 'https://bsky.app/profile/author/post/liked123/liked-by',
      };

      const result = await capturePostContext(
        null,
        'liker.bsky.social',
        'did:liker:789',
        'block',
        false,
        engagementContext
      );

      expect(result).not.toBeNull();
      expect(result?.engagementType).toBe('like');
      expect(result?.engagedPostUri).toBe('at://did:author/app.bsky.feed.post/liked123');
    });

    it('should extract post author handle from profile link', async () => {
      document.body.innerHTML =
        '<article id="post-container"><a href="/profile/poster.bsky.social">Poster</a><a href="/profile/poster.bsky.social/post/xyz789">Post Link</a></article>';
      const container = document.getElementById('post-container') as HTMLElement;

      const result = await capturePostContext(
        container,
        'target.bsky.social',
        'did:target:111',
        'block',
        false
      );

      expect(result?.postAuthorHandle).toBe('poster.bsky.social');
    });

    it('should generate unique context IDs', async () => {
      const result1 = await capturePostContext(null, 'a', 'did:a', 'block', false);
      const result2 = await capturePostContext(null, 'b', 'did:b', 'mute', false);

      expect(result1?.id).not.toBe(result2?.id);
      expect(result1?.id).toMatch(/^ctx_\d+_[a-z0-9]+$/);
    });

    it('should handle errors gracefully', async () => {
      const storage = await import('../storage.js');
      (storage.addPostContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Storage error')
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await capturePostContext(
        null,
        'target.bsky.social',
        'did:target:err',
        'block',
        false
      );

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should truncate long post text to 500 characters', async () => {
      const longText = 'A'.repeat(600);
      document.body.innerHTML =
        '<article id="post-container"><div data-testid="postText">' + longText + '</div></article>';
      const container = document.getElementById('post-container') as HTMLElement;

      const result = await capturePostContext(
        container,
        'target.bsky.social',
        'did:target:222',
        'block',
        false
      );

      expect(result?.postText?.length).toBe(500);
    });

    it('should capture notification context when provided', async () => {
      const notificationContext: NotificationContext = {
        notificationType: 'like',
        subjectUri: 'at://did:mypost/app.bsky.feed.post/liked123',
        sourceUrl: 'https://bsky.app/notifications',
      };

      const result = await capturePostContext(
        null,
        'liker.bsky.social',
        'did:liker:789',
        'block',
        false,
        null,
        notificationContext
      );

      expect(result).not.toBeNull();
      expect(result?.notificationType).toBe('like');
      expect(result?.notificationSubjectUri).toBe('at://did:mypost/app.bsky.feed.post/liked123');
    });

    it('should capture notification context with reply type', async () => {
      const notificationContext: NotificationContext = {
        notificationType: 'reply',
        subjectUri: 'at://did:mypost/app.bsky.feed.post/replied123',
        sourceUrl: 'https://bsky.app/notifications',
      };

      const result = await capturePostContext(
        null,
        'replier.bsky.social',
        'did:replier:111',
        'mute',
        false,
        null,
        notificationContext
      );

      expect(result).not.toBeNull();
      expect(result?.notificationType).toBe('reply');
      expect(result?.actionType).toBe('mute');
    });

    it('should handle follow notification without subject URI', async () => {
      const notificationContext: NotificationContext = {
        notificationType: 'follow',
        sourceUrl: 'https://bsky.app/notifications',
      };

      const result = await capturePostContext(
        null,
        'follower.bsky.social',
        'did:follower:222',
        'block',
        true,
        null,
        notificationContext
      );

      expect(result).not.toBeNull();
      expect(result?.notificationType).toBe('follow');
      expect(result?.notificationSubjectUri).toBeUndefined();
      expect(result?.permanent).toBe(true);
    });

    it('should capture both engagement and notification context', async () => {
      const engagementContext: EngagementContext = {
        type: 'repost',
        postUri: 'at://did:post/app.bsky.feed.post/eng123',
        sourceUrl: 'https://bsky.app/profile/author/post/eng123/reposted-by',
      };

      const notificationContext: NotificationContext = {
        notificationType: 'repost',
        subjectUri: 'at://did:post/app.bsky.feed.post/notif123',
        sourceUrl: 'https://bsky.app/notifications',
      };

      const result = await capturePostContext(
        null,
        'reposter.bsky.social',
        'did:reposter:333',
        'block',
        false,
        engagementContext,
        notificationContext
      );

      expect(result).not.toBeNull();
      // Both contexts should be captured
      expect(result?.engagementType).toBe('repost');
      expect(result?.engagedPostUri).toBe('at://did:post/app.bsky.feed.post/eng123');
      expect(result?.notificationType).toBe('repost');
      expect(result?.notificationSubjectUri).toBe('at://did:post/app.bsky.feed.post/notif123');
    });
  });
});
