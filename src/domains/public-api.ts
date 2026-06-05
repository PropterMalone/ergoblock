/**
 * Public API - Unauthenticated Bluesky API calls
 * Used for QT Peek and handle resolution
 */

import { createLogger } from '../platform/utils.js';

const log = createLogger('bg:public-api');

const PUBLIC_API_URL = 'https://public.api.bsky.app/xrpc';

/**
 * Resolve a handle to DID via public API
 */
export async function handleResolveHandle(handle: string) {
  try {
    const cleanHandle = handle.replace('@', '');
    const url = `${PUBLIC_API_URL}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(cleanHandle)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    log.info(`Resolved @${cleanHandle} to ${data.did}`);
    return { success: true, did: data.did };
  } catch (error) {
    log.error('Resolve handle failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Fetch posts via public API (for QT Peek)
 * Max 25 URIs per request
 */
export async function handleFetchPostsPublic(uris: string[]) {
  try {
    if (uris.length === 0) {
      return { success: true, posts: [] };
    }

    if (uris.length > 25) {
      return { success: false, error: 'Max 25 URIs per request' };
    }

    const params = new URLSearchParams();
    uris.forEach((uri) => params.append('uris', uri));

    const url = `${PUBLIC_API_URL}/app.bsky.feed.getPosts?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    log.info(`Fetched ${data.posts?.length || 0} posts via public API`);
    return { success: true, posts: data.posts || [] };
  } catch (error) {
    log.error('Fetch posts public failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
