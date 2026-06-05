/**
 * QT Peek — utility module for detecting and resolving concealed quote embeds
 *
 * Bluesky hides quoted posts when:
 * - The quoted author has blocked the viewer (viewBlocked)
 * - The quoted author has detached the quote (viewDetached)
 * - The quoted post was deleted (viewNotFound)
 *
 * This module detects these concealed placeholders in the DOM and provides
 * functions to resolve them via the public API.
 */

/**
 * Result of scanning a post container for concealed quote embeds
 */
export interface ConcealedQuoteInfo {
  /** The placeholder element in the DOM (for replacement) */
  placeholderElement: HTMLElement;
  /** Type of concealment detected from placeholder text */
  type: 'blocked' | 'detached' | 'not-found' | 'unknown';
}

/**
 * Resolved content from a peeked quote
 */
export interface PeekedQuoteContent {
  /** AT URI of the quoted post */
  uri: string;
  /** Author display name */
  authorDisplayName?: string;
  /** Author handle (e.g., user.bsky.social) */
  authorHandle: string;
  /** Author DID */
  authorDid: string;
  /** Post text content */
  text: string;
  /** Post creation timestamp (ISO string) */
  createdAt: string;
  /** Original concealment type that was resolved */
  concealmentType: ConcealedQuoteInfo['type'];
}

/**
 * Placeholder text patterns that indicate a concealed quote embed.
 * Uses lowercase matching. Multiple patterns per type for resilience
 * against Bluesky wording changes.
 */
const CONCEALED_PATTERNS: Array<{ pattern: string; type: ConcealedQuoteInfo['type'] }> = [
  { pattern: 'blocked post', type: 'blocked' },
  { pattern: 'blocked', type: 'blocked' },
  { pattern: 'post has been detached', type: 'detached' },
  { pattern: 'detached', type: 'detached' },
  { pattern: 'post not found', type: 'not-found' },
  { pattern: 'not found', type: 'not-found' },
];

/**
 * Detect whether a post container contains a concealed quote embed.
 *
 * Detection strategy:
 * 1. Find elements that look like quote embed containers (border + padding pattern)
 * 2. Check if text content matches known placeholder patterns
 * 3. Confirm there is NO clickable /post/ link inside (normal quotes have one)
 *
 * @param postContainer - The post's DOM element (e.g., feedItem, postThreadItem)
 * @returns ConcealedQuoteInfo if a concealed quote is found, null otherwise
 */
export function detectConcealedQuote(postContainer: HTMLElement): ConcealedQuoteInfo | null {
  // Strategy 1: Look for elements with concealment text inside the post
  // These are typically divs with border styling that contain short placeholder text
  const allElements = postContainer.querySelectorAll('*');

  for (const el of allElements) {
    const htmlEl = el as HTMLElement;
    const text = htmlEl.textContent?.trim().toLowerCase() || '';

    // Skip elements that are too long (real post content, not placeholders)
    if (text.length > 100) continue;

    // Skip elements that are too short (single words that might be part of regular text)
    if (text.length < 5) continue;

    // Check against known placeholder patterns
    for (const { pattern, type } of CONCEALED_PATTERNS) {
      if (text.includes(pattern)) {
        // Verify this looks like a quote embed container (not just text mentioning "blocked")
        if (isQuoteEmbedContainer(htmlEl, postContainer)) {
          return { placeholderElement: htmlEl, type };
        }
      }
    }
  }

  return null;
}

/**
 * Check if an element looks like a quote embed container rather than regular post text.
 *
 * Quote embed containers typically:
 * - Have border styling (border or borderRadius)
 * - Do NOT contain a link to /profile/.../post/... (concealed embeds lack this)
 * - Are not the post's main text content
 * - Are a relatively small, self-contained element
 *
 * @param element - The element with placeholder text
 * @param postContainer - The parent post container
 */
function isQuoteEmbedContainer(element: HTMLElement, postContainer: HTMLElement): boolean {
  // Walk up from the element to find the actual embed container
  // (the text might be in a nested span/div)
  let candidate: HTMLElement | null = element;
  let embedContainer: HTMLElement | null = null;

  for (let i = 0; i < 5 && candidate && candidate !== postContainer; i++) {
    const style = window.getComputedStyle(candidate);

    // Look for border or borderRadius — typical of quote embed containers
    const hasBorder =
      (style.borderWidth && style.borderWidth !== '0px' && style.borderStyle !== 'none') ||
      (style.borderTopWidth && style.borderTopWidth !== '0px') ||
      (style.borderRadius && style.borderRadius !== '0px');

    if (hasBorder) {
      embedContainer = candidate;
      break;
    }

    candidate = candidate.parentElement;
  }

  // If no bordered container found, check if element itself is the container
  if (!embedContainer) {
    embedContainer = element;
  }

  // Key signal: concealed embeds do NOT have a post link inside
  const hasPostLink = embedContainer.querySelector('a[href*="/post/"]');
  if (hasPostLink) {
    // This is a normal (visible) quote embed, not concealed
    return false;
  }

  // Additional signal: the embed container should be distinct from the post's main text
  const postTextEl = postContainer.querySelector('[data-testid*="postText"]');
  if (postTextEl && postTextEl.contains(embedContainer)) {
    // The "placeholder" text is inside the post's text content, not a separate embed
    return false;
  }

  return true;
}

import type {
  PostView,
  PostViewEmbedRecord,
  PostViewEmbedRecordWithMedia,
  EmbedRecordView,
  EmbedRecordViewRecord,
} from '../types.js';
import { send } from '../platform/messages.js';
import { createLogger } from '../platform/utils.js';

const log = createLogger('qt-peek');

/**
 * Fetch posts from the public API via the background worker.
 * Routes through the background to avoid CORS restrictions.
 *
 * @param uris - Array of AT Protocol post URIs
 * @returns Array of PostView objects
 */
async function fetchPostsViaBackground(uris: string[]): Promise<PostView[]> {
  const response = await send('FETCH_POSTS_PUBLIC', { uris });

  if (!response?.success) {
    throw new Error(response?.error || 'Failed to fetch posts from public API');
  }

  return response.posts || [];
}

/**
 * Extract the embed record view from a post's embed field.
 * Handles both plain record embeds and recordWithMedia embeds.
 */
function extractEmbedRecord(post: PostView): EmbedRecordView | null {
  if (!post.embed) return null;

  if (post.embed.$type === 'app.bsky.embed.record#view') {
    return (post.embed as PostViewEmbedRecord).record;
  }

  if (post.embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    return (post.embed as PostViewEmbedRecordWithMedia).record.record;
  }

  return null;
}

/**
 * Resolve a concealed quote embed by fetching from the public API.
 *
 * Flow:
 * 1. Fetch the parent post from public API
 * 2. Check the embed view type
 * 3. If viewRecord → return content directly
 * 4. If viewBlocked/viewDetached → extract URI, fetch quoted post directly
 * 5. If viewNotFound → return error (post was deleted)
 *
 * @param parentPostUri - AT URI of the parent post (the one containing the quote)
 * @param concealmentType - The type of concealment detected in the DOM
 * @returns Resolved quote content, or null if unresolvable
 */
export async function resolveQuoteEmbed(
  parentPostUri: string,
  concealmentType: ConcealedQuoteInfo['type']
): Promise<PeekedQuoteContent | null> {
  // Note: The URI may contain a handle instead of a DID (e.g., at://user.bsky.social/...).
  // The getPosts endpoint accepts both handles and DIDs, so no conversion is needed.
  // Step 1: Fetch the parent post from public API
  const parentPosts = await fetchPostsViaBackground([parentPostUri]);
  if (parentPosts.length === 0) {
    log.warn('Parent post not found on public API:', parentPostUri);
    return null;
  }

  const parentPost = parentPosts[0];

  // Step 2: Extract the embed record
  const embedRecord = extractEmbedRecord(parentPost);
  if (!embedRecord) {
    log.warn('Parent post has no embed record:', parentPostUri);
    return null;
  }

  log.info('Embed record type:', embedRecord.$type);

  // Step 3: Handle based on embed view type
  if (embedRecord.$type === 'app.bsky.embed.record#viewRecord') {
    // The public API resolved it — content is available directly
    const viewRecord = embedRecord as EmbedRecordViewRecord;
    return {
      uri: viewRecord.uri,
      authorDisplayName: viewRecord.author.displayName,
      authorHandle: viewRecord.author.handle,
      authorDid: viewRecord.author.did,
      text: viewRecord.value.text,
      createdAt: viewRecord.value.createdAt,
      concealmentType,
    };
  }

  // Step 4: For blocked/detached/notFound — try fetching the quoted post directly
  if (
    embedRecord.$type === 'app.bsky.embed.record#viewBlocked' ||
    embedRecord.$type === 'app.bsky.embed.record#viewDetached'
  ) {
    const quotedUri = embedRecord.uri as string;
    if (!quotedUri) {
      log.warn('No URI in blocked/detached embed');
      return null;
    }

    log.info('Fetching quoted post directly:', quotedUri);
    const quotedPosts = await fetchPostsViaBackground([quotedUri]);

    if (quotedPosts.length === 0) {
      log.warn('Quoted post not found on public API:', quotedUri);
      return null;
    }

    const quotedPost = quotedPosts[0];
    return {
      uri: quotedPost.uri,
      authorDisplayName: quotedPost.author.displayName,
      authorHandle: quotedPost.author.handle,
      authorDid: quotedPost.author.did,
      text: quotedPost.record.text,
      createdAt: quotedPost.record.createdAt,
      concealmentType,
    };
  }

  if (embedRecord.$type === 'app.bsky.embed.record#viewNotFound') {
    // Post was deleted — can't recover
    log.info('Quoted post was deleted (viewNotFound)');
    return null;
  }

  log.warn('Unknown embed type:', (embedRecord as { $type: string }).$type);
  return null;
}
