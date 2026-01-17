/**
 * Post context capture utility for ErgoBlock
 * Extracts AT Protocol post URIs from the DOM when blocking/muting
 */

import type { PostContext, NotificationReason } from './types.js';
import { addPostContext, getOptions } from './storage.js';
import { generateId } from './utils.js';

// Selectors for finding post containers and URIs
const POST_SELECTORS = [
  '[data-testid*="feedItem"]',
  '[data-testid*="postThreadItem"]',
  '[data-testid*="notification"]', // Notification items
  'article',
  '[data-testid*="post"]',
];

/**
 * Find the post container element from a clicked element
 */
export function findPostContainer(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;

  for (const selector of POST_SELECTORS) {
    const container = element.closest(selector);
    if (container) {
      return container as HTMLElement;
    }
  }

  return null;
}

/**
 * Extract AT Protocol post URI from a post container
 * Looks for links containing /post/ pattern and converts to at:// URI
 */
function extractPostUri(postContainer: HTMLElement): string | null {
  // Look for post links (e.g., /profile/handle/post/rkey)
  const postLinks = postContainer.querySelectorAll('a[href*="/post/"]');

  for (const link of postLinks) {
    const href = (link as HTMLAnchorElement).href;
    // Match pattern: /profile/{handle}/post/{rkey}
    const match = href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (match) {
      const [, handle, rkey] = match;
      return `at://${handle}/app.bsky.feed.post/${rkey}`;
    }
  }

  // If no /post/ links found, try profile links that might include post paths
  const profileLinks = postContainer.querySelectorAll('a[href*="/profile/"]');
  for (const link of profileLinks) {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (match) {
      const [, handle, rkey] = match;
      return `at://${handle}/app.bsky.feed.post/${rkey}`;
    }
  }

  // Check parent elements for notification items
  let parent = postContainer.parentElement;
  let attempts = 0;
  while (parent && attempts < 5) {
    const parentLinks = parent.querySelectorAll('a[href*="/post/"]');
    if (parentLinks.length > 0) {
      for (const link of parentLinks) {
        const href = (link as HTMLAnchorElement).href;
        const match = href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
        if (match) {
          const [, handle, rkey] = match;
          return `at://${handle}/app.bsky.feed.post/${rkey}`;
        }
      }
    }
    parent = parent.parentElement;
    attempts++;
  }

  // Last resort: check if we're currently on a post page
  const currentUrl = window.location.href;
  const urlMatch = currentUrl.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
  if (urlMatch) {
    const [, handle, rkey] = urlMatch;
    return `at://${handle}/app.bsky.feed.post/${rkey}`;
  }

  return null;
}

/**
 * Extract post text from a post container
 */
function extractPostText(postContainer: HTMLElement): string | undefined {
  const textSelectors = ['[data-testid*="postText"]', '[data-testid="postContent"]', '.post-text'];

  for (const selector of textSelectors) {
    const el = postContainer.querySelector(selector);
    if (el?.textContent?.trim()) {
      return el.textContent.trim().slice(0, 500); // Limit to 500 chars
    }
  }

  return undefined;
}

/**
 * Extract post author handle from a post container
 */
function extractPostAuthorHandle(postContainer: HTMLElement): string | undefined {
  // Look for profile link in the post header
  const profileLink = postContainer.querySelector('a[href^="/profile/"]');
  if (profileLink) {
    const href = (profileLink as HTMLAnchorElement).href;
    const match = href.match(/\/profile\/([^/?#]+)/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Generate a unique context ID
 */
function generateContextId(): string {
  return generateId('ctx');
}

/**
 * Engagement context from liked-by/reposted-by pages
 */
export interface EngagementContext {
  type: 'like' | 'repost';
  postUri: string;
  sourceUrl: string;
}

/**
 * Notification context when blocking from notifications page
 */
export interface NotificationContext {
  notificationType: NotificationReason;
  subjectUri?: string; // The post/content that generated the notification
  sourceUrl: string;
}

/**
 * Capture post context when blocking/muting from a post
 */
export async function capturePostContext(
  postContainer: HTMLElement | null,
  targetHandle: string,
  targetDid: string,
  actionType: 'block' | 'mute',
  permanent: boolean,
  engagementContext?: EngagementContext | null,
  notificationContext?: NotificationContext | null
): Promise<PostContext | null> {
  const options = await getOptions();

  if (!options.savePostContext) {
    return null;
  }

  try {
    // Try to extract post info if we have a container
    let postUri: string | null = null;
    let postText: string | undefined;
    let postAuthorHandle: string | undefined;
    let postAuthorDid = '';

    if (postContainer) {
      postUri = extractPostUri(postContainer);
      postText = extractPostText(postContainer);
      postAuthorHandle = extractPostAuthorHandle(postContainer);

      if (postUri) {
        // Extract DID from URI if possible (it might be a handle)
        const uriParts = postUri.split('/');
        postAuthorDid = uriParts[2] || '';
      }
    }

    // Always save context, even without a post URI
    // This happens when blocking from a profile page or when URI extraction fails
    const context: PostContext = {
      id: generateContextId(),
      postUri: postUri || '', // Empty string if no URI found
      postAuthorDid,
      postAuthorHandle,
      postText,
      targetHandle,
      targetDid,
      actionType,
      permanent,
      timestamp: Date.now(),
      // Add engagement context if blocking from liked-by/reposted-by page
      engagementType: engagementContext?.type,
      engagedPostUri: engagementContext?.postUri,
      // Add notification context if blocking from notifications page
      notificationType: notificationContext?.notificationType,
      notificationSubjectUri: notificationContext?.subjectUri,
    };

    await addPostContext(context);
    return context;
  } catch (error) {
    console.error('[ErgoBlock] Failed to capture post context:', error);
    return null;
  }
}
