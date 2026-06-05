/**
 * Context Search - Find interactions between users
 * Uses CAR file downloads for efficient comprehensive searches
 */

import { getAuthToken, bgApiRequest, resolvePdsUrl } from './api-client.js';
import { fetchProfiles } from './graph-ops.js';
import { getPostContexts, addPostContext } from '../platform/storage.js';
import { fetchAndParseRepo, ParsedPost } from './carRepo.js';
import { FeedPost, RawPostRecord, SearchPostView, Interaction, AuthData } from '../types.js';
import { generateId, createLogger, textContainsMention } from '../platform/utils.js';
import browser from '../platform/browser.js';

const log = createLogger('bg:context-search');

/**
 * Convert a raw post record to FeedPost format for compatibility
 */
function rawRecordToFeedPost(record: RawPostRecord, targetDid: string): FeedPost {
  return {
    uri: record.uri,
    cid: record.cid,
    author: { did: targetDid, handle: '' }, // Handle not available from raw records
    record: {
      text: record.value.text,
      createdAt: record.value.createdAt,
      reply: record.value.reply,
      embed: record.value.embed,
    },
  };
}

/**
 * Convert a ParsedPost from CAR file to RawPostRecord format
 * for compatibility with existing isInteractionWithUser logic
 */
function parsedPostToRawRecord(post: ParsedPost, _authorDid: string): RawPostRecord {
  return {
    uri: post.uri,
    cid: post.cid,
    value: {
      $type: 'app.bsky.feed.post',
      text: post.text,
      createdAt: post.createdAt,
      reply: post.reply,
      embed: post.embed,
    },
  };
}

/**
 * Result of searching for interaction with a user
 */
interface InteractionResult {
  post: FeedPost | null;
  blockedBy: boolean;
}

/**
 * Decide whether a parsed-post createdAt falls within an optional upper bound.
 * Used to skip posts authored after a block was created, since they cannot be
 * what prompted it. Missing or unparseable timestamps fall through (kept) to
 * preserve current behavior on malformed data.
 */
export function isWithinTimeBound(
  createdAt: string | undefined,
  beforeTimestamp: number | undefined
): boolean {
  if (beforeTimestamp === undefined) return true;
  if (!createdAt) return true;
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return ts <= beforeTimestamp;
}

/**
 * Check if a post is an interaction with the logged-in user:
 * - Reply to the user
 * - Quote of the user's post
 * - Mentions the user directly (contains their DID or handle in text)
 *
 * HIGH FIX #7: Use textContainsMention for secure handle matching
 * (prevents false positives like @alice.bsky.social matching @alice.bsky.social-fake)
 */
function isInteractionWithUser(
  record: RawPostRecord,
  loggedInDid: string,
  loggedInHandle?: string
): boolean {
  const value = record.value;

  // Check if reply to logged-in user
  if (value.reply?.parent?.uri?.includes(loggedInDid)) {
    return true;
  }

  // Check if quote of logged-in user's post
  if (
    value.embed?.$type === 'app.bsky.embed.record' &&
    value.embed.record?.uri?.includes(loggedInDid)
  ) {
    return true;
  }

  // HIGH FIX #7: Use secure mention matching with word boundaries
  if (loggedInHandle && textContainsMention(value.text, loggedInHandle)) {
    return true;
  }

  return false;
}

/**
 * Check if a SearchPostView is an interaction with the logged-in user
 * (quote post or reply that the text search might have caught)
 *
 * HIGH FIX #7: Use textContainsMention for secure handle matching
 */
export function isSearchPostInteraction(
  post: SearchPostView,
  loggedInDid: string,
  loggedInHandle?: string
): boolean {
  const record = post.record;

  // Check if reply to logged-in user
  if (record.reply?.parent?.uri?.includes(loggedInDid)) {
    return true;
  }

  // Check if quote of logged-in user's post
  if (
    record.embed?.$type === 'app.bsky.embed.record' &&
    record.embed.record?.uri?.includes(loggedInDid)
  ) {
    return true;
  }

  // HIGH FIX #7: Use secure mention matching with word boundaries
  if (loggedInHandle && textContainsMention(record.text, loggedInHandle)) {
    return true;
  }

  return false;
}

/**
 * Find post context for a block using direct PDS fetch.
 * This is the fallback method when search doesn't find anything.
 *
 * For blocks: Just find their most recent interaction (reply, quote, @mention)
 * to us. Since they can't interact after being blocked, we don't need time filtering.
 *
 * This uses direct PDS fetch to bypass block restrictions.
 *
 * @param targetDid - DID of the blocked user
 * @param loggedInDid - DID of the logged-in user
 * @param loggedInHandle - Handle of logged-in user (for @mention detection)
 * @param exhaustive - If true, search through ALL posts (no page limit)
 */
async function findBlockContextPost(
  targetDid: string,
  targetHandle: string | undefined,
  loggedInDid: string,
  loggedInHandle: string | undefined,
  _exhaustive = false, // No longer needed - CAR downloads entire repo
  beforeTimestamp?: number
): Promise<InteractionResult> {
  // Search their posts using CAR file download
  const searchTheirPosts = async (): Promise<FeedPost | null> => {
    const pdsUrl = await resolvePdsUrl(targetDid);

    try {
      log.info(`Fetching CAR for ${targetDid}...`);
      const repoData = await fetchAndParseRepo(targetDid, pdsUrl);
      log.info(`Searching ${repoData.posts.length} posts for ${targetDid}`);

      for (const post of repoData.posts) {
        if (!isWithinTimeBound(post.createdAt, beforeTimestamp)) continue;
        const record = parsedPostToRawRecord(post, targetDid);
        if (isInteractionWithUser(record, loggedInDid, loggedInHandle)) {
          log.info(`Found context (their post) for ${targetDid}: ${post.uri}`);
          return rawRecordToFeedPost(record, targetDid);
        }
      }

      log.info(`No interactions in their posts for ${targetDid}`);
      return null;
    } catch (error) {
      log.error(`CAR fetch failed for ${targetDid}:`, error);
      return null;
    }
  };

  // Search my posts (using cached CAR data)
  const searchMyPosts = async (): Promise<FeedPost | null> => {
    try {
      const myPosts = await getMyPosts(loggedInDid);

      for (const record of myPosts) {
        if (!isWithinTimeBound(record.value.createdAt, beforeTimestamp)) continue;
        if (isInteractionWithUser(record, targetDid, targetHandle)) {
          log.info(`Found context (my post) for ${targetDid}: ${record.uri}`);
          return rawRecordToFeedPost(record, loggedInDid);
        }
      }

      log.info(`No interactions in my posts for ${targetDid}`);
      return null;
    } catch (error) {
      log.error(`Error searching my posts:`, error);
      return null;
    }
  };

  // Search both directions in parallel
  const [theirPost, myPost] = await Promise.all([searchTheirPosts(), searchMyPosts()]);

  // Return the most recent interaction
  if (theirPost !== null && myPost !== null) {
    const theirTime = new Date(theirPost.record.createdAt).getTime();
    const myTime = new Date(myPost.record.createdAt).getTime();
    if (theirTime >= myTime) {
      return { post: theirPost, blockedBy: false };
    } else {
      return { post: myPost, blockedBy: false };
    }
  }

  return { post: theirPost ?? myPost, blockedBy: false };
}

/**
 * Find context for a blocked user using CAR file download.
 * Searches entire post history for interactions.
 */
async function findContextWithFallback(
  targetDid: string,
  targetHandle: string,
  loggedInDid: string,
  loggedInHandle: string | undefined,
  _exhaustive = false, // No longer needed - CAR is always comprehensive
  beforeTimestamp?: number
): Promise<InteractionResult> {
  return findBlockContextPost(
    targetDid,
    targetHandle,
    loggedInDid,
    loggedInHandle,
    false,
    beforeTimestamp
  );
}

/**
 * Get the logged-in user's handle for @mention detection
 */
async function getLoggedInHandle(auth: AuthData): Promise<string | undefined> {
  try {
    // Try to get from stored session first
    const result = await browser.storage.local.get('authToken');
    const storedAuth = result.authToken as AuthData & { handle?: string };
    if (storedAuth?.handle) {
      return storedAuth.handle;
    }

    // Fall back to fetching profile
    const response = await bgApiRequest<{ handle: string }>(
      `app.bsky.actor.getProfile?actor=${encodeURIComponent(auth.did)}`,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );
    return response?.handle;
  } catch {
    return undefined;
  }
}

/**
 * Classify interaction type from a raw post record
 */
function classifyRawInteractionType(
  record: RawPostRecord,
  otherDid: string
): 'reply' | 'quote' | 'mention' {
  const value = record.value;

  if (value.reply?.parent?.uri?.includes(otherDid)) {
    return 'reply';
  }

  if (
    value.embed?.$type === 'app.bsky.embed.record' &&
    value.embed.record?.uri?.includes(otherDid)
  ) {
    return 'quote';
  }

  return 'mention';
}

// Cache for logged-in user's posts (cleared on auth change)
let myPostsCache: { did: string; posts: RawPostRecord[]; fetchedAt: number } | null = null;
const MY_POSTS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch and cache the logged-in user's posts using CAR file download.
 * Downloads entire repository in a single request for comprehensive search.
 */
async function getMyPosts(loggedInDid: string): Promise<RawPostRecord[]> {
  // Return cached if valid
  if (
    myPostsCache &&
    myPostsCache.did === loggedInDid &&
    Date.now() - myPostsCache.fetchedAt < MY_POSTS_CACHE_TTL
  ) {
    log.info(`Using cached posts for logged-in user (${myPostsCache.posts.length} posts)`);
    return myPostsCache.posts;
  }

  log.info('Fetching logged-in user posts via CAR...');
  const pdsUrl = await resolvePdsUrl(loggedInDid);

  try {
    const repoData = await fetchAndParseRepo(loggedInDid, pdsUrl);
    const posts = repoData.posts.map((post) => parsedPostToRawRecord(post, loggedInDid));

    log.info(`Cached ${posts.length} posts for logged-in user (via CAR)`);
    myPostsCache = { did: loggedInDid, posts, fetchedAt: repoData.fetchedAt };
    return posts;
  } catch (error) {
    log.error('CAR fetch failed for logged-in user:', error);
    return [];
  }
}

/**
 * Find all interactions between logged-in user and target user.
 * Uses CAR file download to fetch entire post history efficiently.
 * Caches logged-in user's posts for efficiency across multiple lookups.
 */
async function findAllInteractions(
  targetDid: string,
  targetHandle: string,
  loggedInDid: string,
  loggedInHandle: string | undefined,
  beforeTimestamp?: number
): Promise<Interaction[]> {
  log.info(
    `Finding all interactions via CAR: ${targetHandle} <-> ${loggedInHandle || loggedInDid}` +
      (beforeTimestamp ? ` (before ${new Date(beforeTimestamp).toISOString()})` : '')
  );

  const interactions: Interaction[] = [];
  const seenUris = new Set<string>();

  // Fetch target user's posts using CAR file
  const fetchTargetPosts = async (): Promise<void> => {
    const pdsUrl = await resolvePdsUrl(targetDid);

    try {
      log.info(`Fetching CAR for ${targetHandle}...`);
      const repoData = await fetchAndParseRepo(targetDid, pdsUrl);
      let foundCount = 0;

      for (const post of repoData.posts) {
        if (seenUris.has(post.uri)) continue;
        if (!isWithinTimeBound(post.createdAt, beforeTimestamp)) continue;
        const record = parsedPostToRawRecord(post, targetDid);
        if (isInteractionWithUser(record, loggedInDid, loggedInHandle)) {
          seenUris.add(post.uri);
          foundCount++;
          interactions.push({
            uri: post.uri,
            text: post.text.slice(0, 300),
            createdAt: new Date(post.createdAt).getTime(),
            type: classifyRawInteractionType(record, loggedInDid),
            author: 'them',
            authorHandle: targetHandle,
          });
        }
      }

      log.info(
        `${targetHandle}: searched ${repoData.posts.length} posts, found ${foundCount} interactions`
      );
    } catch (error) {
      log.error(`CAR fetch failed for ${targetHandle}:`, error);
    }
  };

  // Search cached logged-in user posts (already using CAR via getMyPosts)
  const searchMyPosts = async (): Promise<void> => {
    const myPosts = await getMyPosts(loggedInDid);
    let foundCount = 0;

    for (const record of myPosts) {
      if (seenUris.has(record.uri)) continue;
      if (!isWithinTimeBound(record.value.createdAt, beforeTimestamp)) continue;
      if (isInteractionWithUser(record, targetDid, targetHandle)) {
        seenUris.add(record.uri);
        foundCount++;
        interactions.push({
          uri: record.uri,
          text: record.value.text.slice(0, 300),
          createdAt: new Date(record.value.createdAt).getTime(),
          type: classifyRawInteractionType(record, targetDid),
          author: 'you',
          authorHandle: loggedInHandle || loggedInDid,
        });
      }
    }

    log.info(
      `${loggedInHandle || 'you'}: searched ${myPosts.length} cached posts, found ${foundCount} interactions`
    );
  };

  try {
    // Fetch target posts and search cached my posts in parallel
    await Promise.all([fetchTargetPosts(), searchMyPosts()]);

    // Sort by createdAt descending (most recent first)
    interactions.sort((a, b) => b.createdAt - a.createdAt);

    log.info(`Found ${interactions.length} total interactions`);
    return interactions;
  } catch (error) {
    log.error('findAllInteractions error:', error);
    return [];
  }
}

/**
 * Handle request to find context for a blocked user
 */
export async function handleFindContext(
  did: string,
  handle: string,
  beforeTimestamp?: number
): Promise<{ success: boolean; error?: string; found?: boolean }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check if we already have context for this user
    const existingContexts = await getPostContexts();
    if (existingContexts.some((c) => c.targetDid === did)) {
      return { success: true, found: true }; // Already have context
    }

    // Get logged-in user's handle for @mention detection
    const loggedInHandle = await getLoggedInHandle(auth);

    // Find context using fast search + PDS fallback - exhaustive mode for manual searches
    // beforeTimestamp narrows the search to posts authored before the block was created
    const result = await findContextWithFallback(
      did,
      handle,
      auth.did,
      loggedInHandle,
      true,
      beforeTimestamp
    );

    if (result.post) {
      await addPostContext({
        id: generateId('manual'),
        postUri: result.post.uri,
        postAuthorDid: result.post.author.did,
        postAuthorHandle: result.post.author.handle || handle,
        postText: result.post.record.text,
        postCreatedAt: new Date(result.post.record.createdAt).getTime(),
        targetHandle: handle,
        targetDid: did,
        actionType: 'block',
        permanent: true,
        timestamp: Date.now(),
        guessed: true, // Mark as auto-detected since it was found, not captured during block
      });
      log.info(`Manually found context for: ${handle}`);
      return { success: true, found: true };
    }

    log.info(`No context found for: ${handle}`);
    return { success: true, found: false };
  } catch (error) {
    log.error('Find context failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle request to fetch all interactions between logged-in user and target
 */
export async function handleFetchAllInteractions(
  did: string,
  handle: string,
  beforeTimestamp?: number
): Promise<{ success: boolean; interactions?: Interaction[]; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      log.info('FETCH_ALL_INTERACTIONS: Not authenticated');
      return { success: false, error: 'Not authenticated' };
    }

    const loggedInHandle = await getLoggedInHandle(auth);
    log.info(`FETCH_ALL_INTERACTIONS: ${handle} (${did}) <-> ${loggedInHandle} (${auth.did})`);
    const interactions = await findAllInteractions(
      did,
      handle,
      auth.did,
      loggedInHandle,
      beforeTimestamp
    );
    log.info(`FETCH_ALL_INTERACTIONS: Returning ${interactions.length} interactions`);

    return { success: true, interactions };
  } catch (error) {
    log.error('Fetch all interactions failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Find interactions with a target user that occurred before a specific timestamp
 * Used for list audit to find interactions before the member was added to the list
 */
export async function handleFindInteractionsBefore(
  targetDid: string,
  beforeTimestamp: number
): Promise<{
  success: boolean;
  interactions?: Interaction[];
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get target handle
    const profiles = await fetchProfiles([targetDid], auth.accessJwt);
    const targetHandle = profiles[0]?.handle || targetDid;

    const loggedInHandle = await getLoggedInHandle(auth);

    // Push the upper-bound into the in-loop filter so we don't waste work
    // parsing posts that will be discarded. The post-filter below is kept
    // as a defense for posts whose createdAt was unparseable in the loop.
    const allInteractions = await findAllInteractions(
      targetDid,
      targetHandle,
      auth.did,
      loggedInHandle,
      beforeTimestamp
    );

    // Filter to only interactions before the timestamp (defensive)
    const filteredInteractions = allInteractions.filter((i) => i.createdAt < beforeTimestamp);

    log.info(
      `Found ${filteredInteractions.length} interactions before ${new Date(beforeTimestamp).toISOString()}`
    );

    return { success: true, interactions: filteredInteractions };
  } catch (error) {
    log.error('Find interactions before failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
