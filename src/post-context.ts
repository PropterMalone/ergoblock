/**
 * Post context capture utility for ErgoBlock
 * Extracts AT Protocol post URIs from the DOM when blocking/muting
 */

import type { PostContext } from './types.js';
import { addPostContext, getOptions } from './storage.js';

// Selectors for finding post containers and URIs
const POST_SELECTORS = [
  '[data-testid*="feedItem"]',
  '[data-testid*="postThreadItem"]',
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
    if (container) return container as HTMLElement;
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
      // We need to resolve the handle to a DID, but for now store the handle
      // The URI format is at://did/app.bsky.feed.post/rkey
      // We'll use handle as placeholder and resolve later if needed
      return `at://${handle}/app.bsky.feed.post/${rkey}`;
    }
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
  return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Capture post context when blocking/muting from a post
 */
export async function capturePostContext(
  postContainer: HTMLElement | null,
  targetHandle: string,
  targetDid: string,
  actionType: 'block' | 'mute',
  permanent: boolean
): Promise<PostContext | null> {
  const options = await getOptions();

  if (!options.savePostContext) {
    console.log('[ErgoBlock] Post context saving disabled');
    return null;
  }

  if (!postContainer) {
    console.log('[ErgoBlock] No post container provided');
    return null;
  }

  try {
    const postUri = extractPostUri(postContainer);

    if (!postUri) {
      console.log('[ErgoBlock] Could not extract post URI');
      return null;
    }

    const postText = extractPostText(postContainer);
    const postAuthorHandle = extractPostAuthorHandle(postContainer);

    // Extract DID from URI if possible (it might be a handle)
    const uriParts = postUri.split('/');
    const postAuthorDid = uriParts[2] || '';

    const context: PostContext = {
      id: generateContextId(),
      postUri,
      postAuthorDid,
      postAuthorHandle,
      postText,
      targetHandle,
      targetDid,
      actionType,
      permanent,
      timestamp: Date.now(),
    };

    await addPostContext(context);
    console.log('[ErgoBlock] Post context saved:', context.id, postUri);

    return context;
  } catch (error) {
    console.error('[ErgoBlock] Failed to capture post context:', error);
    return null;
  }
}
