import browser from './browser.js';
import { executeApiRequest } from './api.js';
import {
  getTempBlocks,
  getTempMutes,
  removeTempBlock,
  removeTempMute,
  getOptions,
  addHistoryEntry,
  cleanupExpiredPostContexts,
  getPermanentBlocks,
  setPermanentBlocks,
  getPermanentMutes,
  setPermanentMutes,
  getSyncState,
  updateSyncState,
  getPostContexts,
  addPostContext,
  updateBlocklistAuditState,
  setSubscribedBlocklists,
  setSocialGraph,
  setBlocklistConflicts,
  getDismissedConflicts,
} from './storage.js';
import {
  ListRecordsResponse,
  GetBlocksResponse,
  GetMutesResponse,
  ProfileView,
  ProfileWithViewer,
  ProfileViewerState,
  BlockRecord,
  ListBlockRecordsResponse,
  FeedPost,
  DidDocument,
  RawPostRecord,
  ListPostRecordsResponse,
  SearchPostsResponse,
  SearchPostView,
  GetFollowsResponse,
  GetFollowersResponse,
  GetListBlocksResponse,
  GetListMutesResponse,
  GetListResponse,
  ListView,
  SubscribedBlocklist,
  FollowRelation,
  BlocklistConflictGroup,
  BlocklistConflict,
  PostContext,
} from './types.js';

const ALARM_NAME = 'checkExpirations';
const SYNC_ALARM_NAME = 'syncWithBluesky';
const SYNC_INTERVAL_MINUTES = 60; // Sync every 60 minutes (was 15)
const PAGINATION_DELAY = 100; // ms between paginated requests (was 500ms)

// In-memory sync locks (atomic, no race window)
let syncLockActive = false;
let blocklistAuditLockActive = false;

interface AuthData {
  accessJwt: string;
  did: string;
  pdsUrl: string;
}

async function getAuthToken(): Promise<AuthData | null> {
  const result = await browser.storage.local.get('authToken');
  return (result.authToken as AuthData) || null;
}

/**
 * Wrapper for API requests that handles auth status updates
 */
async function bgApiRequest<T>(
  endpoint: string,
  method: string,
  body: unknown,
  token: string,
  pdsUrl: string
): Promise<T | null> {
  try {
    // Background operations should always use the PDS to ensure consistent writes to the user's repo.
    const result = await executeApiRequest<T>(
      endpoint,
      method,
      body,
      { accessJwt: token, pdsUrl },
      pdsUrl // Force PDS for background operations to ensure write consistency
    );

    // If request was successful, ensure status is valid
    await browser.storage.local.set({ authStatus: 'valid' });
    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('401') || error.message.includes('Auth error'))
    ) {
      console.error('[ErgoBlock BG] Auth failed (401), marking session invalid');
      await browser.storage.local.set({ authStatus: 'invalid' });
    }
    throw error;
  }
}

export async function unblockUser(
  did: string,
  token: string,
  ownerDid: string,
  pdsUrl: string,
  rkey?: string
): Promise<boolean> {
  // If we have the rkey, delete directly (O(1))
  if (rkey) {
    console.log('[ErgoBlock BG] Unblocking using direct rkey:', rkey);
    await bgApiRequest(
      'com.atproto.repo.deleteRecord',
      'POST',
      {
        repo: ownerDid,
        collection: 'app.bsky.graph.block',
        rkey,
      },
      token,
      pdsUrl
    );
    return true;
  }

  // Fallback: find the block record (legacy method, O(N))
  console.log('[ErgoBlock BG] Unblocking using list scan (legacy)...');
  const blocks = await bgApiRequest<ListRecordsResponse>(
    `com.atproto.repo.listRecords?repo=${ownerDid}&collection=app.bsky.graph.block&limit=100`,
    'GET',
    null,
    token,
    pdsUrl
  );

  const blockRecord = blocks?.records?.find((r) => r.value.subject === did);
  if (!blockRecord) {
    console.log('[ErgoBlock BG] No block record found for', did);
    return false;
  }

  const foundRkey = blockRecord.uri.split('/').pop();
  if (!foundRkey) {
    console.log('[ErgoBlock BG] Could not determine rkey from block URI', blockRecord.uri);
    return false;
  }

  await bgApiRequest(
    'com.atproto.repo.deleteRecord',
    'POST',
    {
      repo: ownerDid,
      collection: 'app.bsky.graph.block',
      rkey: foundRkey,
    },
    token,
    pdsUrl
  );

  return true;
}

export async function unmuteUser(did: string, token: string, pdsUrl: string): Promise<boolean> {
  await bgApiRequest('app.bsky.graph.unmuteActor', 'POST', { actor: did }, token, pdsUrl);
  return true;
}

/**
 * Block a user (used for re-blocking after temp unblock)
 */
export async function blockUser(
  did: string,
  token: string,
  ownerDid: string,
  pdsUrl: string
): Promise<{ uri: string; cid: string } | null> {
  const record = {
    $type: 'app.bsky.graph.block',
    subject: did,
    createdAt: new Date().toISOString(),
  };

  return bgApiRequest<{ uri: string; cid: string }>(
    'com.atproto.repo.createRecord',
    'POST',
    {
      repo: ownerDid,
      collection: 'app.bsky.graph.block',
      record,
    },
    token,
    pdsUrl
  );
}

export async function updateBadge(): Promise<void> {
  const options = await getOptions();
  if (!options.showBadgeCount) {
    await browser.action.setBadgeText({ text: '' });
    return;
  }

  const blocks = await getTempBlocks();
  const mutes = await getTempMutes();
  const count = Object.keys(blocks).length + Object.keys(mutes).length;

  await browser.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
  await browser.action.setBadgeBackgroundColor({ color: '#1185fe' });
}

export async function sendNotification(
  type: 'expired_success' | 'expired_failure',
  handle: string,
  action: 'block' | 'mute',
  error?: string
): Promise<void> {
  const options = await getOptions();
  if (!options.notificationsEnabled) {
    return;
  }

  let title: string;
  let message: string;

  if (type === 'expired_success') {
    title = '✅ Temporary action expired';
    message = `Your temporary ${action} of @${handle} has been lifted`;
  } else {
    title = '⚠️ Action failed';
    message = `Failed to ${action} @${handle}: ${error || 'Unknown error'}`;
  }

  // Cast needed because 'silent' is Chrome-specific, not in webextension-polyfill types
  await browser.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    silent: !options.notificationSound,
  } as browser.Notifications.CreateNotificationOptions & { silent?: boolean });
}

// ============================================================================
// Sync Engine - Two-way sync with Bluesky
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all blocks from Bluesky with pagination (profile data)
 */
async function fetchAllBlocks(auth: AuthData): Promise<ProfileView[]> {
  const allBlocks: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = 'app.bsky.graph.getBlocks?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetBlocksResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.blocks) {
      allBlocks.push(...response.blocks);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allBlocks;
}

/**
 * Fetch all block records from repo (createdAt timestamps + rkey)
 */
async function fetchAllBlockRecords(auth: AuthData): Promise<BlockRecord[]> {
  const allRecords: BlockRecord[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.block&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<ListBlockRecordsResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.records) {
      allRecords.push(...response.records);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allRecords;
}

/**
 * Fetch all mutes from Bluesky with pagination
 */
async function fetchAllMutes(auth: AuthData): Promise<ProfileView[]> {
  const allMutes: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = 'app.bsky.graph.getMutes?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetMutesResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.mutes) {
      allMutes.push(...response.mutes);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allMutes;
}

/**
 * Response from app.bsky.actor.getProfiles
 */
interface GetProfilesResponse {
  profiles: ProfileWithViewer[];
}

/**
 * Fetch profiles with viewer state in batches (max 25 per request)
 * Returns a Map of DID -> ProfileViewerState
 */
async function fetchViewerStates(
  auth: AuthData,
  dids: string[]
): Promise<Map<string, ProfileViewerState>> {
  const result = new Map<string, ProfileViewerState>();
  const batchSize = 25;

  for (let i = 0; i < dids.length; i += batchSize) {
    const batch = dids.slice(i, i + batchSize);
    const params = batch.map((d) => `actors=${encodeURIComponent(d)}`).join('&');

    try {
      const response = await bgApiRequest<GetProfilesResponse>(
        `app.bsky.actor.getProfiles?${params}`,
        'GET',
        null,
        auth.accessJwt,
        auth.pdsUrl
      );

      if (response?.profiles) {
        for (const profile of response.profiles) {
          if (profile.viewer) {
            result.set(profile.did, profile.viewer);
          }
        }
      }
    } catch (error) {
      console.error('[ErgoBlock BG] Error fetching viewer states:', error);
    }

    // Rate limit between batches
    if (i + batchSize < dids.length) {
      await sleep(200);
    }
  }

  return result;
}

/**
 * Sync blocks from Bluesky
 * - Fetches both profile data (getBlocks) and records (listRecords) to get createdAt
 * - Adds new blocks found in Bluesky to permanent storage
 * - Removes temp blocks that no longer exist in Bluesky (user unblocked externally)
 */
async function syncBlocks(
  auth: AuthData
): Promise<{ added: number; removed: number; newBlocks: Array<{ did: string; handle: string }> }> {
  const now = Date.now();
  let added = 0;
  let removed = 0;
  const newBlocks: Array<{ did: string; handle: string }> = [];

  // Fetch both profile data and block records in parallel
  const [bskyBlocks, blockRecords] = await Promise.all([
    fetchAllBlocks(auth),
    fetchAllBlockRecords(auth),
  ]);

  const bskyBlockDids = new Set(bskyBlocks.map((b) => b.did));

  // Build lookup map from records: DID -> { createdAt, rkey }
  const recordMap = new Map<string, { createdAt: number; rkey: string }>();
  for (const record of blockRecords) {
    const rkey = record.uri.split('/').pop();
    if (rkey) {
      recordMap.set(record.value.subject, {
        createdAt: new Date(record.value.createdAt).getTime(),
        rkey,
      });
    }
  }

  // Get current storage first to identify NEW blocks
  const [tempBlocks, permanentBlocks] = await Promise.all([getTempBlocks(), getPermanentBlocks()]);

  // Only fetch viewer states for NEW blocks (not already in permanent storage)
  // This dramatically reduces API calls for users with large block lists
  const newBlockDids = bskyBlocks
    .filter((b) => !permanentBlocks[b.did] && !tempBlocks[b.did])
    .map((b) => b.did);
  console.log(
    `[ErgoBlock BG] Fetching viewer states for ${newBlockDids.length} new blocks (skipping ${bskyBlocks.length - newBlockDids.length} existing)`
  );
  const viewerStates =
    newBlockDids.length > 0 ? await fetchViewerStates(auth, newBlockDids) : new Map();

  // Build new permanent blocks map
  const newPermanentBlocks: Record<
    string,
    {
      did: string;
      handle: string;
      displayName?: string;
      avatar?: string;
      createdAt?: number;
      syncedAt: number;
      rkey?: string;
      viewer?: ProfileViewerState;
    }
  > = {};

  for (const block of bskyBlocks) {
    // Skip if it's a temp block (we track those separately)
    if (tempBlocks[block.did]) {
      continue;
    }

    const recordData = recordMap.get(block.did);
    // Use new viewer state if available, otherwise preserve existing
    const viewer = viewerStates.get(block.did) || permanentBlocks[block.did]?.viewer;

    // Add to permanent blocks
    // IMPORTANT: Preserve existing createdAt if we have it - the Bluesky record's createdAt
    // will be newer if we've done a temp unblock/reblock for context detection
    newPermanentBlocks[block.did] = {
      did: block.did,
      handle: block.handle,
      displayName: block.displayName,
      avatar: block.avatar,
      createdAt: permanentBlocks[block.did]?.createdAt || recordData?.createdAt,
      syncedAt: permanentBlocks[block.did]?.syncedAt || now,
      rkey: recordData?.rkey || permanentBlocks[block.did]?.rkey,
      viewer,
    };

    if (!permanentBlocks[block.did]) {
      added++;
      newBlocks.push({ did: block.did, handle: block.handle });
    }
  }

  // Check for temp blocks that no longer exist in Bluesky (user unblocked externally)
  for (const did of Object.keys(tempBlocks)) {
    if (!bskyBlockDids.has(did)) {
      console.log('[ErgoBlock BG] Temp block removed externally:', tempBlocks[did].handle);
      await removeTempBlock(did);
      await addHistoryEntry({
        did,
        handle: tempBlocks[did].handle,
        action: 'unblocked',
        timestamp: now,
        trigger: 'removed', // User removed externally
        success: true,
      });
      removed++;
    }
  }

  await setPermanentBlocks(newPermanentBlocks);
  return { added, removed, newBlocks };
}

/**
 * Sync mutes from Bluesky
 * - Adds new mutes found in Bluesky to permanent storage
 * - Removes temp mutes that no longer exist in Bluesky (user unmuted externally)
 * - Fetches viewer state (relationship info) for all muted users
 */
async function syncMutes(auth: AuthData): Promise<{ added: number; removed: number }> {
  const now = Date.now();
  let added = 0;
  let removed = 0;

  // Fetch current mutes from Bluesky
  const bskyMutes = await fetchAllMutes(auth);
  const bskyMuteDids = new Set(bskyMutes.map((m) => m.did));

  // Get current storage first to identify NEW mutes
  const [tempMutes, permanentMutes] = await Promise.all([getTempMutes(), getPermanentMutes()]);

  // Only fetch viewer states for NEW mutes (not already in permanent storage)
  // This dramatically reduces API calls for users with large mute lists
  const newMuteDids = bskyMutes
    .filter((m) => !permanentMutes[m.did] && !tempMutes[m.did])
    .map((m) => m.did);
  console.log(
    `[ErgoBlock BG] Fetching viewer states for ${newMuteDids.length} new mutes (skipping ${bskyMutes.length - newMuteDids.length} existing)`
  );
  const viewerStates =
    newMuteDids.length > 0 ? await fetchViewerStates(auth, newMuteDids) : new Map();

  // Build new permanent mutes map
  const newPermanentMutes: Record<
    string,
    {
      did: string;
      handle: string;
      displayName?: string;
      avatar?: string;
      syncedAt: number;
      viewer?: ProfileViewerState;
    }
  > = {};

  for (const mute of bskyMutes) {
    // Skip if it's a temp mute (we track those separately)
    if (tempMutes[mute.did]) {
      continue;
    }

    // Use new viewer state if available, otherwise preserve existing
    const viewer = viewerStates.get(mute.did) || permanentMutes[mute.did]?.viewer;

    // Add to permanent mutes
    newPermanentMutes[mute.did] = {
      did: mute.did,
      handle: mute.handle,
      displayName: mute.displayName,
      avatar: mute.avatar,
      syncedAt: permanentMutes[mute.did]?.syncedAt || now,
      viewer,
    };

    if (!permanentMutes[mute.did]) {
      added++;
    }
  }

  // Check for temp mutes that no longer exist in Bluesky (user unmuted externally)
  for (const did of Object.keys(tempMutes)) {
    if (!bskyMuteDids.has(did)) {
      console.log('[ErgoBlock BG] Temp mute removed externally:', tempMutes[did].handle);
      await removeTempMute(did);
      await addHistoryEntry({
        did,
        handle: tempMutes[did].handle,
        action: 'unmuted',
        timestamp: now,
        trigger: 'removed', // User removed externally
        success: true,
      });
      removed++;
    }
  }

  await setPermanentMutes(newPermanentMutes);
  return { added, removed };
}

// Rate limiting for guessed context lookups
const GUESSED_CONTEXT_DELAY = 500; // ms between requests

// PLC directory URL for resolving DIDs
const PLC_DIRECTORY = 'https://plc.directory';

// Cache for resolved PDS URLs (DID -> PDS URL)
const pdsCache = new Map<string, string>();

/**
 * Resolve a DID to its PDS URL by looking up the DID document
 * @see https://atproto.com/guides/identity
 */
async function resolvePdsUrl(did: string): Promise<string | null> {
  // Check cache first
  const cached = pdsCache.get(did);
  if (cached) {
    return cached;
  }

  try {
    // Resolve DID document from PLC directory
    const response = await fetch(`${PLC_DIRECTORY}/${did}`);
    if (!response.ok) {
      console.error(`[ErgoBlock BG] Failed to resolve DID ${did}: ${response.status}`);
      return null;
    }

    const didDoc = (await response.json()) as DidDocument;

    // Find the atproto PDS service endpoint
    const pdsService = didDoc.service?.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
    );

    if (!pdsService?.serviceEndpoint) {
      console.error(`[ErgoBlock BG] No PDS service found for ${did}`);
      return null;
    }

    // Cache the result
    pdsCache.set(did, pdsService.serviceEndpoint);
    return pdsService.serviceEndpoint;
  } catch (error) {
    console.error(`[ErgoBlock BG] Error resolving PDS for ${did}:`, error);
    return null;
  }
}

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
 * Result of searching for interaction with a user
 */
interface InteractionResult {
  post: FeedPost | null;
  blockedBy: boolean;
}

/**
 * Check if a post is an interaction with the logged-in user:
 * - Reply to the user
 * - Quote of the user's post
 * - Mentions the user directly (contains their DID or handle in text)
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

  // Check if text mentions the user (by handle)
  if (loggedInHandle && value.text.toLowerCase().includes(`@${loggedInHandle.toLowerCase()}`)) {
    return true;
  }

  return false;
}

/**
 * Convert SearchPostView to FeedPost format
 */
function searchPostToFeedPost(post: SearchPostView): FeedPost {
  return {
    uri: post.uri,
    cid: post.cid,
    author: { did: post.author.did, handle: post.author.handle },
    record: {
      text: post.record.text,
      createdAt: post.record.createdAt,
      reply: post.record.reply,
      embed: post.record.embed,
    },
  };
}

/**
 * Check if a SearchPostView is an interaction with the logged-in user
 * (quote post or reply that the text search might have caught)
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

  // Check if text mentions the user (by handle)
  if (loggedInHandle && record.text.toLowerCase().includes(`@${loggedInHandle.toLowerCase()}`)) {
    return true;
  }

  return false;
}

/**
 * Fast context search using public Bluesky search API.
 * Uses unauthenticated requests to bypass block filtering.
 *
 * Searches for posts by the target user that mention the logged-in user.
 * Note: Quote posts don't use mentions, so we also do a text search and
 * filter results to find actual QTs.
 *
 * Runs all searches in parallel and returns the most recent result.
 */
async function findContextViaSearch(
  targetDid: string,
  targetHandle: string,
  loggedInDid: string,
  loggedInHandle: string | undefined
): Promise<FeedPost | null> {
  if (!loggedInHandle) {
    console.log('[ErgoBlock BG] No logged-in handle for search');
    return null;
  }

  const PUBLIC_API = 'https://public.api.bsky.app';

  console.log(
    `[ErgoBlock BG] Searching for context via public API: ${targetHandle} → @${loggedInHandle}`
  );

  try {
    // Run all searches in parallel for speed
    // Search both directions: their posts → you, and your posts → them
    // Each search now returns an array of results for proper sorting
    const [
      mentionsResults,
      repliesResults,
      textResults,
      reverseMentionsResults,
      reverseRepliesResults,
      reverseTextResults,
    ] = await Promise.all([
      // Search 1: Their posts that mention you
      (async (): Promise<SearchPostView[]> => {
        const query = encodeURIComponent(`from:${targetHandle}`);
        const mentions = encodeURIComponent(loggedInHandle);
        const endpoint = `${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=${query}&mentions=${mentions}&limit=10&sort=latest`;

        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            console.debug(
              `[ErgoBlock BG] Mentions search failed: ${response.status} ${response.statusText}`
            );
            return [];
          }

          const data = (await response.json()) as SearchPostsResponse;
          const posts = data.posts || [];
          if (posts.length > 0) {
            console.log(`[ErgoBlock BG] Mentions search found ${posts.length} results`);
          }
          return posts;
        } catch (error) {
          console.debug(`[ErgoBlock BG] Mentions search error:`, error);
          return [];
        }
      })(),

      // Search 2: Their replies to you
      (async (): Promise<SearchPostView[]> => {
        const query = encodeURIComponent(`from:${targetHandle} to:${loggedInHandle}`);
        const endpoint = `${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=${query}&limit=10&sort=latest`;

        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            console.debug(
              `[ErgoBlock BG] Replies search failed: ${response.status} ${response.statusText}`
            );
            return [];
          }

          const data = (await response.json()) as SearchPostsResponse;
          const posts = data.posts || [];
          if (posts.length > 0) {
            console.log(`[ErgoBlock BG] Reply search found ${posts.length} results`);
          }
          return posts;
        } catch (error) {
          console.debug(`[ErgoBlock BG] Replies search error:`, error);
          return [];
        }
      })(),

      // Search 3: Their posts containing your handle (for QTs)
      (async (): Promise<SearchPostView[]> => {
        const query = encodeURIComponent(`from:${targetHandle} ${loggedInHandle}`);
        const endpoint = `${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=${query}&limit=25&sort=latest`;

        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            console.debug(
              `[ErgoBlock BG] Text search failed: ${response.status} ${response.statusText}`
            );
            return [];
          }

          const data = (await response.json()) as SearchPostsResponse;
          // Filter to find actual interactions (QTs, replies, mentions)
          const verified = (data.posts || []).filter((post) =>
            isSearchPostInteraction(post, loggedInDid, loggedInHandle)
          );
          if (verified.length > 0) {
            console.log(
              `[ErgoBlock BG] Text search found ${verified.length} verified interactions`
            );
          }
          return verified;
        } catch (error) {
          console.debug(`[ErgoBlock BG] Text search error:`, error);
          return [];
        }
      })(),

      // Search 4: YOUR posts that mention THEM (reverse direction)
      (async (): Promise<SearchPostView[]> => {
        const query = encodeURIComponent(`from:${loggedInHandle}`);
        const mentions = encodeURIComponent(targetHandle);
        const endpoint = `${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=${query}&mentions=${mentions}&limit=10&sort=latest`;

        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            console.debug(
              `[ErgoBlock BG] Reverse mentions search failed: ${response.status} ${response.statusText}`
            );
            return [];
          }

          const data = (await response.json()) as SearchPostsResponse;
          const posts = data.posts || [];
          if (posts.length > 0) {
            console.log(`[ErgoBlock BG] Reverse mentions search found ${posts.length} results`);
          }
          return posts;
        } catch (error) {
          console.debug(`[ErgoBlock BG] Reverse mentions search error:`, error);
          return [];
        }
      })(),

      // Search 5: YOUR replies to THEM (reverse direction)
      (async (): Promise<SearchPostView[]> => {
        const query = encodeURIComponent(`from:${loggedInHandle} to:${targetHandle}`);
        const endpoint = `${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=${query}&limit=10&sort=latest`;

        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            console.debug(
              `[ErgoBlock BG] Reverse replies search failed: ${response.status} ${response.statusText}`
            );
            return [];
          }

          const data = (await response.json()) as SearchPostsResponse;
          const posts = data.posts || [];
          if (posts.length > 0) {
            console.log(`[ErgoBlock BG] Reverse reply search found ${posts.length} results`);
          }
          return posts;
        } catch (error) {
          console.debug(`[ErgoBlock BG] Reverse replies search error:`, error);
          return [];
        }
      })(),

      // Search 6: YOUR posts containing their handle (reverse QTs)
      (async (): Promise<SearchPostView[]> => {
        const query = encodeURIComponent(`from:${loggedInHandle} ${targetHandle}`);
        const endpoint = `${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=${query}&limit=25&sort=latest`;

        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            console.debug(
              `[ErgoBlock BG] Reverse text search failed: ${response.status} ${response.statusText}`
            );
            return [];
          }

          const data = (await response.json()) as SearchPostsResponse;
          // Filter to find actual interactions (QTs, replies, mentions)
          const verified = (data.posts || []).filter((post) =>
            isSearchPostInteraction(post, targetDid, targetHandle)
          );
          if (verified.length > 0) {
            console.log(
              `[ErgoBlock BG] Reverse text search found ${verified.length} verified interactions`
            );
          }
          return verified;
        } catch (error) {
          console.debug(`[ErgoBlock BG] Reverse text search error:`, error);
          return [];
        }
      })(),
    ]);

    // Collect all found posts from both directions and dedupe by URI
    const seenUris = new Set<string>();
    const candidates: SearchPostView[] = [];

    for (const results of [
      mentionsResults,
      repliesResults,
      textResults,
      reverseMentionsResults,
      reverseRepliesResults,
      reverseTextResults,
    ]) {
      for (const post of results) {
        if (!seenUris.has(post.uri)) {
          seenUris.add(post.uri);
          candidates.push(post);
        }
      }
    }

    if (candidates.length === 0) {
      console.log(`[ErgoBlock BG] No context found via search`);
      return null;
    }

    // Sort by createdAt descending and return the most recent
    candidates.sort((a, b) => {
      const dateA = new Date(a.record.createdAt).getTime();
      const dateB = new Date(b.record.createdAt).getTime();
      return dateB - dateA;
    });

    const mostRecent = candidates[0];
    console.log(
      `[ErgoBlock BG] Found ${candidates.length} candidates, returning most recent: ${mostRecent.uri} (${mostRecent.record.createdAt})`
    );

    return searchPostToFeedPost(mostRecent);
  } catch (error) {
    console.error('[ErgoBlock BG] Search API error:', error);
    return null;
  }
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
  loggedInDid: string,
  loggedInHandle: string | undefined,
  exhaustive = false
): Promise<InteractionResult> {
  // For exhaustive search, we paginate through all posts looking for an interaction
  // For normal search, we limit to 300 posts (3 pages) for performance
  const maxPages = exhaustive ? 1000 : 3; // 3 pages = 300 posts (was 10 = 1000)
  const pageSize = 100;

  // Resolve the user's PDS URL
  const pdsUrl = await resolvePdsUrl(targetDid);
  if (!pdsUrl) {
    console.log(`[ErgoBlock BG] Could not resolve PDS URL for ${targetDid}`);
    return { post: null, blockedBy: false };
  }

  let cursor: string | undefined;
  let pageCount = 0;
  let totalPostsSearched = 0;

  try {
    while (pageCount < maxPages) {
      let endpoint = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(targetDid)}&collection=app.bsky.feed.post&limit=${pageSize}&reverse=true`;
      if (cursor) {
        endpoint += `&cursor=${encodeURIComponent(cursor)}`;
      }

      if (pageCount === 0 || (exhaustive && pageCount % 10 === 0)) {
        console.log(
          `[ErgoBlock BG] Searching posts for ${targetDid}` +
            (exhaustive ? ` (exhaustive, page ${pageCount + 1})` : '')
        );
      }

      const response = await fetch(endpoint);
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ErgoBlock BG] PDS fetch failed: ${response.status} ${errorText}`);
        break;
      }

      const data = (await response.json()) as ListPostRecordsResponse;
      const records = data.records || [];
      pageCount++;
      totalPostsSearched += records.length;

      if (records.length === 0) {
        break;
      }

      // Check each post for interaction
      for (const record of records) {
        if (isInteractionWithUser(record, loggedInDid, loggedInHandle)) {
          console.log(
            `[ErgoBlock BG] Found block context for ${targetDid}: ${record.uri}` +
              ` (searched ${totalPostsSearched} posts)`
          );
          return { post: rawRecordToFeedPost(record, targetDid), blockedBy: false };
        }
      }

      // Get cursor for next page
      cursor = data.cursor;
      if (!cursor) {
        break;
      }

      // Rate limit between pages
      await new Promise((resolve) => setTimeout(resolve, exhaustive ? 100 : 200));
    }

    console.log(
      `[ErgoBlock BG] No interactions found for ${targetDid}` +
        ` (searched ${totalPostsSearched} posts in ${pageCount} pages)`
    );
    return { post: null, blockedBy: false };
  } catch (error) {
    console.error(`[ErgoBlock BG] Error searching posts for ${targetDid}:`, error);
    return { post: null, blockedBy: false };
  }
}

/**
 * Find context for a blocked user - tries fast search first, then falls back to PDS.
 */
async function findContextWithFallback(
  targetDid: string,
  targetHandle: string,
  loggedInDid: string,
  loggedInHandle: string | undefined,
  exhaustive = false
): Promise<InteractionResult> {
  // Try fast search API first (unauthenticated, bypasses blocks)
  const searchResult = await findContextViaSearch(
    targetDid,
    targetHandle,
    loggedInDid,
    loggedInHandle
  );
  if (searchResult) {
    return { post: searchResult, blockedBy: false };
  }

  // Fall back to PDS pagination if search didn't find anything
  console.log(`[ErgoBlock BG] Search didn't find context, trying PDS for ${targetHandle}`);
  return findBlockContextPost(targetDid, loggedInDid, loggedInHandle, exhaustive);
}

/**
 * Generate context for newly imported blocks during sync.
 * Uses PDS-based fetch to find most recent interaction.
 * Always searches for new context and compares with existing - keeps the newer one.
 */
async function generateContextForNewBlocks(
  newBlocks: Array<{ did: string; handle: string }>,
  loggedInDid: string,
  loggedInHandle: string | undefined
): Promise<number> {
  if (newBlocks.length === 0) return 0;

  const existingContexts = await getPostContexts();
  // Build a map of DID -> most recent context for comparison
  const existingContextMap = new Map<string, PostContext>();
  for (const ctx of existingContexts) {
    const existing = existingContextMap.get(ctx.targetDid);
    if (!existing || (ctx.postCreatedAt || 0) > (existing.postCreatedAt || 0)) {
      existingContextMap.set(ctx.targetDid, ctx);
    }
  }

  let generated = 0;

  for (const block of newBlocks) {
    try {
      const result = await findContextWithFallback(
        block.did,
        block.handle,
        loggedInDid,
        loggedInHandle
      );

      if (result.post) {
        const newPostCreatedAt = new Date(result.post.record.createdAt).getTime();
        const existingContext = existingContextMap.get(block.did);

        // Only add if no existing context OR new interaction is more recent
        if (!existingContext || newPostCreatedAt > (existingContext.postCreatedAt || 0)) {
          await addPostContext({
            id: `guessed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            postUri: result.post.uri,
            postAuthorDid: result.post.author.did,
            postAuthorHandle: result.post.author.handle || block.handle,
            postText: result.post.record.text,
            postCreatedAt: newPostCreatedAt,
            targetHandle: block.handle,
            targetDid: block.did,
            actionType: 'block',
            permanent: true,
            timestamp: Date.now(),
            guessed: true,
          });
          generated++;
          if (existingContext) {
            console.log(
              `[ErgoBlock BG] Updated context for ${block.handle} (newer interaction found)`
            );
          } else {
            console.log(`[ErgoBlock BG] Generated context for new block: ${block.handle}`);
          }
        } else {
          console.log(
            `[ErgoBlock BG] Keeping existing context for ${block.handle} (already have newer)`
          );
        }
      }

      // Rate limit
      await sleep(GUESSED_CONTEXT_DELAY);
    } catch (error) {
      console.debug(`[ErgoBlock BG] Could not find interaction for ${block.handle}:`, error);
    }
  }

  return generated;
}
/**
 * Refresh auto-detected contexts for existing blocks.
 * Checks if there are newer interactions than what we have stored.
 * Only refreshes contexts that were auto-detected (guessed: true), not manually captured.
 */
async function refreshGuessedContexts(
  currentBlocks: Record<string, { did: string; handle: string }>,
  loggedInDid: string,
  loggedInHandle: string | undefined
): Promise<number> {
  const existingContexts = await getPostContexts();

  // Find blocks with guessed contexts that might need refreshing
  const guessedContextMap = new Map<string, PostContext>();
  for (const ctx of existingContexts) {
    if (ctx.guessed) {
      const existing = guessedContextMap.get(ctx.targetDid);
      if (!existing || (ctx.postCreatedAt || 0) > (existing.postCreatedAt || 0)) {
        guessedContextMap.set(ctx.targetDid, ctx);
      }
    }
  }

  // Get blocks that have guessed contexts to refresh
  const blocksToRefresh: Array<{ did: string; handle: string; existingContext: PostContext }> = [];
  for (const [did, block] of Object.entries(currentBlocks)) {
    const guessedCtx = guessedContextMap.get(did);
    if (guessedCtx) {
      blocksToRefresh.push({ did, handle: block.handle, existingContext: guessedCtx });
    }
  }

  if (blocksToRefresh.length === 0) {
    return 0;
  }

  console.log(`[ErgoBlock BG] Refreshing ${blocksToRefresh.length} auto-detected contexts...`);

  let refreshed = 0;

  for (const { did, handle, existingContext } of blocksToRefresh) {
    try {
      const result = await findContextWithFallback(did, handle, loggedInDid, loggedInHandle);

      if (result.post) {
        const newPostCreatedAt = new Date(result.post.record.createdAt).getTime();

        // Only update if new interaction is more recent
        if (newPostCreatedAt > (existingContext.postCreatedAt || 0)) {
          await addPostContext({
            id: `guessed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            postUri: result.post.uri,
            postAuthorDid: result.post.author.did,
            postAuthorHandle: result.post.author.handle || handle,
            postText: result.post.record.text,
            postCreatedAt: newPostCreatedAt,
            targetHandle: handle,
            targetDid: did,
            actionType: 'block',
            permanent: true,
            timestamp: Date.now(),
            guessed: true,
          });
          refreshed++;
          console.log(
            `[ErgoBlock BG] Refreshed context for ${handle} (found newer: ${result.post.record.createdAt})`
          );
        }
      }

      // Rate limit
      await sleep(GUESSED_CONTEXT_DELAY);
    } catch (error) {
      console.debug(`[ErgoBlock BG] Could not refresh context for ${handle}:`, error);
    }
  }

  return refreshed;
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
 * Perform full sync with Bluesky
 */
export async function performFullSync(): Promise<{
  success: boolean;
  error?: string;
  blocks?: { added: number; removed: number };
  mutes?: { added: number; removed: number };
  guessedContexts?: number;
}> {
  // Use atomic in-memory lock to prevent concurrent syncs (no TOCTOU race)
  if (syncLockActive) {
    console.log('[ErgoBlock BG] Sync already in progress, skipping');
    return { success: false, error: 'Sync already in progress' };
  }
  syncLockActive = true;

  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    syncLockActive = false;
    console.log('[ErgoBlock BG] No auth token available, skipping sync');
    return { success: false, error: 'Not authenticated' };
  }

  console.log('[ErgoBlock BG] Starting full sync with Bluesky...');
  await updateSyncState({ syncInProgress: true, lastError: undefined });

  try {
    // Use Promise.allSettled to handle partial failures gracefully
    const results = await Promise.allSettled([syncBlocks(auth), syncMutes(auth)]);

    const blockSettled = results[0];
    const muteSettled = results[1];

    const blockResult =
      blockSettled.status === 'fulfilled'
        ? blockSettled.value
        : { added: 0, removed: 0, newBlocks: [] };
    const muteResult =
      muteSettled.status === 'fulfilled' ? muteSettled.value : { added: 0, removed: 0 };

    // Log any partial failures
    if (blockSettled.status === 'rejected') {
      console.error('[ErgoBlock BG] Block sync failed:', blockSettled.reason);
    }
    if (muteSettled.status === 'rejected') {
      console.error('[ErgoBlock BG] Mute sync failed:', muteSettled.reason);
    }
    // Generate context for newly imported blocks and refresh existing guessed contexts
    let guessedContexts = 0;
    let refreshedContexts = 0;
    const loggedInHandle = await getLoggedInHandle(auth);

    if (blockResult.newBlocks.length > 0) {
      console.log(
        `[ErgoBlock BG] Generating context for ${blockResult.newBlocks.length} new blocks...`
      );
      guessedContexts = await generateContextForNewBlocks(
        blockResult.newBlocks,
        auth.did,
        loggedInHandle
      );
    }

    // Refresh auto-detected contexts for existing blocks (check for newer interactions)
    const currentBlocks = await getPermanentBlocks();
    refreshedContexts = await refreshGuessedContexts(currentBlocks, auth.did, loggedInHandle);

    await updateSyncState({
      syncInProgress: false,
      lastBlockSync: Date.now(),
      lastMuteSync: Date.now(),
      lastError:
        blockSettled.status === 'rejected' || muteSettled.status === 'rejected'
          ? 'Partial sync failure'
          : undefined,
    });

    console.log('[ErgoBlock BG] Sync complete:', {
      blocks: { added: blockResult.added, removed: blockResult.removed },
      mutes: muteResult,
      guessedContexts,
      refreshedContexts,
    });

    await updateBadge();
    syncLockActive = false;
    return {
      success: blockSettled.status === 'fulfilled' && muteSettled.status === 'fulfilled',
      blocks: { added: blockResult.added, removed: blockResult.removed },
      mutes: muteResult,
      guessedContexts,
      error:
        blockSettled.status === 'rejected' || muteSettled.status === 'rejected'
          ? 'Partial sync failure - check console for details'
          : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ErgoBlock BG] Sync failed:', errorMessage);

    await updateSyncState({
      syncInProgress: false,
      lastError: errorMessage,
    });

    syncLockActive = false;
    return { success: false, error: errorMessage };
  }
}

/**
 * Set up sync alarm
 */
export async function setupSyncAlarm(): Promise<void> {
  await browser.alarms.clear(SYNC_ALARM_NAME);
  await browser.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
    delayInMinutes: 1, // First sync 1 minute after startup
  });
  console.log('[ErgoBlock BG] Sync alarm set up with interval:', SYNC_INTERVAL_MINUTES, 'minutes');
}

// ============================================================================
// Blocklist Audit Sync
// ============================================================================

/**
 * Fetch all follows for a user
 */
async function fetchAllFollows(auth: AuthData): Promise<ProfileView[]> {
  const allFollows: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = `app.bsky.graph.getFollows?actor=${encodeURIComponent(auth.did)}&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetFollowsResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.follows) {
      allFollows.push(...response.follows);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allFollows;
}

/**
 * Fetch all followers for a user
 */
async function fetchAllFollowers(auth: AuthData): Promise<ProfileView[]> {
  const allFollowers: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = `app.bsky.graph.getFollowers?actor=${encodeURIComponent(auth.did)}&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetFollowersResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.followers) {
      allFollowers.push(...response.followers);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allFollowers;
}

/**
 * Fetch all subscribed blocklists
 */
async function fetchSubscribedBlocklists(auth: AuthData): Promise<ListView[]> {
  const allLists: ListView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = 'app.bsky.graph.getListBlocks?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetListBlocksResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.lists) {
      allLists.push(...response.lists);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  // Also fetch subscribed mutelists
  cursor = undefined;
  do {
    let endpoint = 'app.bsky.graph.getListMutes?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetListMutesResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.lists) {
      // Only add modlists (not curate lists)
      const modlists = response.lists.filter((l) => l.purpose === 'app.bsky.graph.defs#modlist');
      allLists.push(...modlists);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allLists;
}

/**
 * Fetch all members of a list
 */
async function fetchListMembers(auth: AuthData, listUri: string): Promise<ProfileView[]> {
  const allMembers: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = `app.bsky.graph.getList?list=${encodeURIComponent(listUri)}&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetListResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.items) {
      for (const item of response.items) {
        allMembers.push(item.subject);
      }
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allMembers;
}

/**
 * Perform blocklist audit sync
 * Finds conflicts between your follows/followers and your subscribed blocklists
 */
export async function performBlocklistAuditSync(): Promise<{
  success: boolean;
  error?: string;
  conflictCount?: number;
}> {
  // Use atomic in-memory lock to prevent concurrent syncs (no TOCTOU race)
  if (blocklistAuditLockActive) {
    console.log('[ErgoBlock BG] Blocklist audit sync already in progress');
    return { success: false, error: 'Sync already in progress' };
  }
  blocklistAuditLockActive = true;

  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    blocklistAuditLockActive = false;
    return { success: false, error: 'Not authenticated' };
  }

  console.log('[ErgoBlock BG] Starting blocklist audit sync...');
  await updateBlocklistAuditState({ syncInProgress: true, lastError: undefined });

  try {
    // Fetch all data in parallel where possible
    console.log('[ErgoBlock BG] Fetching follows, followers, and blocklists...');
    const [follows, followers, blocklists] = await Promise.all([
      fetchAllFollows(auth),
      fetchAllFollowers(auth),
      fetchSubscribedBlocklists(auth),
    ]);

    console.log(
      `[ErgoBlock BG] Found ${follows.length} follows, ${followers.length} followers, ${blocklists.length} blocklists`
    );

    // Build social graph
    const followDids = new Set(follows.map((f) => f.did));
    const followerDids = new Set(followers.map((f) => f.did));

    // Combine into FollowRelation[]
    const allRelations: Map<string, FollowRelation> = new Map();

    for (const f of follows) {
      allRelations.set(f.did, {
        did: f.did,
        handle: f.handle,
        displayName: f.displayName,
        avatar: f.avatar,
        relationship: followerDids.has(f.did) ? 'mutual' : 'following',
      });
    }

    for (const f of followers) {
      if (!allRelations.has(f.did)) {
        allRelations.set(f.did, {
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
          relationship: 'follower',
        });
      }
    }

    // Save social graph
    await setSocialGraph({
      follows: follows.map((f) => ({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName,
        avatar: f.avatar,
        relationship: followerDids.has(f.did) ? 'mutual' : 'following',
      })),
      followers: followers.map((f) => ({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName,
        avatar: f.avatar,
        relationship: followDids.has(f.did) ? 'mutual' : 'follower',
      })),
      syncedAt: Date.now(),
    });

    // Save blocklists
    const storedBlocklists: SubscribedBlocklist[] = blocklists.map((l) => ({
      uri: l.uri,
      name: l.name,
      description: l.description,
      avatar: l.avatar,
      creator: {
        did: l.creator.did,
        handle: l.creator.handle,
        displayName: l.creator.displayName,
      },
      listItemCount: l.listItemCount,
      syncedAt: Date.now(),
    }));
    await setSubscribedBlocklists(storedBlocklists);

    // Now find conflicts: for each blocklist, check if any members are in our social graph
    console.log('[ErgoBlock BG] Checking blocklists for conflicts...');
    const conflictGroups: BlocklistConflictGroup[] = [];
    const dismissedLists = await getDismissedConflicts();

    for (const list of blocklists) {
      console.log(`[ErgoBlock BG] Checking list: ${list.name} (${list.uri})`);
      const members = await fetchListMembers(auth, list.uri);

      const conflicts: BlocklistConflict[] = [];
      for (const member of members) {
        const relation = allRelations.get(member.did);
        if (relation) {
          conflicts.push({
            user: relation,
            listUri: list.uri,
            listName: list.name,
            listCreatorHandle: list.creator.handle,
          });
        }
      }

      if (conflicts.length > 0) {
        conflictGroups.push({
          list: {
            uri: list.uri,
            name: list.name,
            description: list.description,
            avatar: list.avatar,
            creator: {
              did: list.creator.did,
              handle: list.creator.handle,
              displayName: list.creator.displayName,
            },
            listItemCount: list.listItemCount,
            syncedAt: Date.now(),
          },
          conflicts,
          dismissed: dismissedLists.has(list.uri),
        });
        console.log(`[ErgoBlock BG] Found ${conflicts.length} conflicts in ${list.name}`);
      }

      // Rate limit between lists
      await sleep(PAGINATION_DELAY);
    }

    // Save conflicts
    await setBlocklistConflicts(conflictGroups);

    const totalConflicts = conflictGroups.reduce((sum, g) => sum + g.conflicts.length, 0);

    await updateBlocklistAuditState({
      syncInProgress: false,
      lastSyncAt: Date.now(),
      followCount: follows.length,
      followerCount: followers.length,
      blocklistCount: blocklists.length,
      conflictCount: totalConflicts,
    });

    console.log(`[ErgoBlock BG] Blocklist audit complete: ${totalConflicts} conflicts found`);
    blocklistAuditLockActive = false;
    return { success: true, conflictCount: totalConflicts };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ErgoBlock BG] Blocklist audit sync failed:', errorMessage);

    await updateBlocklistAuditState({
      syncInProgress: false,
      lastError: errorMessage,
    });

    blocklistAuditLockActive = false;
    return { success: false, error: errorMessage };
  }
}

/**
 * Unsubscribe from a blocklist
 */
async function handleUnsubscribeFromBlocklist(
  listUri: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Find the listblock record for this list
    const records = await bgApiRequest<{
      records: Array<{ uri: string; value: { subject: string } }>;
    }>(
      `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.listblock&limit=100`,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    const record = records?.records?.find((r) => r.value.subject === listUri);
    if (!record) {
      // Try listmute instead
      const muteRecords = await bgApiRequest<{
        records: Array<{ uri: string; value: { subject: string } }>;
      }>(
        `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.listmute&limit=100`,
        'GET',
        null,
        auth.accessJwt,
        auth.pdsUrl
      );

      const muteRecord = muteRecords?.records?.find((r) => r.value.subject === listUri);
      if (!muteRecord) {
        console.log('[ErgoBlock BG] No subscription record found for', listUri);
        return { success: false, error: 'Subscription not found' };
      }

      // Delete the listmute record
      const rkey = muteRecord.uri.split('/').pop();
      if (rkey) {
        await bgApiRequest(
          'com.atproto.repo.deleteRecord',
          'POST',
          {
            repo: auth.did,
            collection: 'app.bsky.graph.listmute',
            rkey,
          },
          auth.accessJwt,
          auth.pdsUrl
        );
      }
    } else {
      // Delete the listblock record
      const rkey = record.uri.split('/').pop();
      if (rkey) {
        await bgApiRequest(
          'com.atproto.repo.deleteRecord',
          'POST',
          {
            repo: auth.did,
            collection: 'app.bsky.graph.listblock',
            rkey,
          },
          auth.accessJwt,
          auth.pdsUrl
        );
      }
    }

    console.log('[ErgoBlock BG] Unsubscribed from blocklist:', listUri);
    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Unsubscribe failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Expiration checking
// ============================================================================

export async function checkExpirations(): Promise<void> {
  console.log('[ErgoBlock BG] Checking expirations...');

  // Clean up expired screenshots based on retention policy
  await cleanupExpiredPostContexts();

  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    console.log('[ErgoBlock BG] No auth token available, skipping check');
    await browser.storage.local.set({ authStatus: 'invalid' });
    return;
  }

  console.log('[ErgoBlock BG] Using PDS:', auth.pdsUrl);
  const now = Date.now();

  // Check expired blocks
  const blocks = await getTempBlocks();

  for (const [did, data] of Object.entries(blocks)) {
    if (data.expiresAt <= now) {
      console.log('[ErgoBlock BG] Unblocking expired:', data.handle);
      try {
        await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, data.rkey);
        await removeTempBlock(did);
        await addHistoryEntry({
          did,
          handle: data.handle,
          action: 'unblocked',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: true,
          duration: data.createdAt ? Date.now() - data.createdAt : undefined,
        });
        console.log('[ErgoBlock BG] Successfully unblocked:', data.handle);
        await sendNotification('expired_success', data.handle, 'block');
      } catch (error) {
        console.error('[ErgoBlock BG] Failed to unblock:', data.handle, error);

        // If it's an auth error, we stop processing further entries
        if (
          error instanceof Error &&
          (error.message.includes('401') || error.message.includes('Auth error'))
        ) {
          return;
        }

        await addHistoryEntry({
          did,
          handle: data.handle,
          action: 'unblocked',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        await sendNotification(
          'expired_failure',
          data.handle,
          'block',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  // Check expired mutes
  const mutes = await getTempMutes();

  for (const [did, data] of Object.entries(mutes)) {
    if (data.expiresAt <= now) {
      console.log('[ErgoBlock BG] Unmuting expired:', data.handle);
      try {
        await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
        await removeTempMute(did);
        await addHistoryEntry({
          did,
          handle: data.handle,
          action: 'unmuted',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: true,
          duration: data.createdAt ? Date.now() - data.createdAt : undefined,
        });
        console.log('[ErgoBlock BG] Successfully unmuted:', data.handle);
        await sendNotification('expired_success', data.handle, 'mute');
      } catch (error) {
        console.error('[ErgoBlock BG] Failed to unmute:', data.handle, error);

        // If it's an auth error, we stop processing further entries
        if (
          error instanceof Error &&
          (error.message.includes('401') || error.message.includes('Auth error'))
        ) {
          return;
        }

        await addHistoryEntry({
          did,
          handle: data.handle,
          action: 'unmuted',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        await sendNotification(
          'expired_failure',
          data.handle,
          'mute',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  await updateBadge();
  console.log('[ErgoBlock BG] Expiration check complete');
}

export async function setupAlarm(): Promise<void> {
  const options = await getOptions();
  const intervalMinutes = Math.max(1, Math.min(10, options.checkInterval));

  await browser.alarms.clear(ALARM_NAME);
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: intervalMinutes,
  });
  console.log('[ErgoBlock BG] Alarm set up with interval:', intervalMinutes, 'minutes');
}

// Listen for alarm events
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkExpirations();
  }
  if (alarm.name === SYNC_ALARM_NAME) {
    performFullSync();
  }
});

// Listen for messages from content script and popup
interface ExtensionMessage {
  type: string;
  auth?: AuthData;
  did?: string;
  handle?: string;
  listUri?: string;
}

type MessageResponse = { success: boolean; error?: string };

/**
 * Handle unblock request from popup
 */
async function handleUnblockRequest(did: string): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the rkey from storage if available
    const blocks = await getTempBlocks();
    const blockData = blocks[did];
    const rkey = blockData?.rkey;

    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, rkey);
    await updateBadge();
    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Unblock failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle unmute request from popup
 */
async function handleUnmuteRequest(did: string): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
    await updateBadge();
    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Unmute failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle temp unblock for viewing a post context
 * This unblocks without removing from storage - we'll reblock shortly
 */
async function handleTempUnblockForView(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the rkey from permanent blocks storage
    const permanentBlocks = await getPermanentBlocks();
    const blockData = permanentBlocks[did];
    const rkey = blockData?.rkey;
    console.log(
      '[ErgoBlock BG] Permanent block data for',
      did,
      ':',
      blockData ? { rkey: blockData.rkey, handle: blockData.handle } : 'not found'
    );

    // Also check temp blocks
    const tempBlocks = await getTempBlocks();
    const tempBlockData = tempBlocks[did];
    const tempRkey = tempBlockData?.rkey;
    console.log(
      '[ErgoBlock BG] Temp block data for',
      did,
      ':',
      tempBlockData ? { rkey: tempBlockData.rkey, handle: tempBlockData.handle } : 'not found'
    );

    const rkeyToUse = rkey || tempRkey;
    console.log('[ErgoBlock BG] Using rkey:', rkeyToUse || '(none - will scan)');

    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, rkeyToUse);
    console.log('[ErgoBlock BG] Temp unblocked for viewing:', did);
    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Temp unblock for view failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle reblock after temp unblock for viewing
 */
async function handleReblockUser(did: string): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = await blockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
    console.log('[ErgoBlock BG] Re-blocked user:', did, 'result:', result);

    // Update the rkey in permanent storage if this was a permanent block
    if (result) {
      const rkey = result.uri.split('/').pop();
      if (rkey) {
        const permanentBlocks = await getPermanentBlocks();
        if (permanentBlocks[did]) {
          permanentBlocks[did].rkey = rkey;
          await setPermanentBlocks(permanentBlocks);
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Reblock failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle manual request to find context for a blocked user
 */
async function handleFindContext(
  did: string,
  handle: string
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
    const result = await findContextWithFallback(did, handle, auth.did, loggedInHandle, true);

    if (result.post) {
      await addPostContext({
        id: `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
      console.log(`[ErgoBlock BG] Manually found context for: ${handle}`);
      return { success: true, found: true };
    }

    console.log(`[ErgoBlock BG] No context found for: ${handle}`);
    return { success: true, found: false };
  } catch (error) {
    console.error('[ErgoBlock BG] Find context failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Async message handler for communication with content scripts and popup
// Using the async pattern which returns Promise<unknown> per webextension-polyfill types
const messageHandler = async (rawMessage: unknown): Promise<MessageResponse | undefined> => {
  const message = rawMessage as ExtensionMessage;
  console.log('[ErgoBlock BG] Received message:', message.type);

  if (message.type === 'TEMP_BLOCK_ADDED' || message.type === 'TEMP_MUTE_ADDED') {
    setupAlarm();
    updateBadge();
    return undefined;
  }

  if (message.type === 'SET_AUTH_TOKEN' && message.auth) {
    await browser.storage.local.set({ authToken: message.auth });
    return { success: true };
  }

  if (message.type === 'CHECK_NOW') {
    await checkExpirations();
    return { success: true };
  }

  if (message.type === 'SYNC_NOW') {
    return await performFullSync();
  }

  if (message.type === 'UNBLOCK_USER' && message.did) {
    return await handleUnblockRequest(message.did);
  }

  if (message.type === 'UNMUTE_USER' && message.did) {
    return await handleUnmuteRequest(message.did);
  }

  if (message.type === 'TEMP_UNBLOCK_FOR_VIEW' && message.did) {
    return await handleTempUnblockForView(message.did);
  }

  if (message.type === 'REBLOCK_USER' && message.did) {
    return await handleReblockUser(message.did);
  }

  if (message.type === 'FIND_CONTEXT' && message.did && message.handle) {
    return await handleFindContext(message.did, message.handle);
  }

  if (message.type === 'BLOCKLIST_AUDIT_SYNC') {
    return await performBlocklistAuditSync();
  }

  if (message.type === 'UNSUBSCRIBE_BLOCKLIST' && message.listUri) {
    return await handleUnsubscribeFromBlocklist(message.listUri as string);
  }

  return undefined;
};

browser.runtime.onMessage.addListener(messageHandler);

/**
 * Clear any stale sync state on startup
 * This handles the case where the extension was closed mid-sync
 */
async function clearStaleSyncState(): Promise<void> {
  const state = await getSyncState();
  if (state.syncInProgress) {
    console.log('[ErgoBlock BG] Clearing stale syncInProgress flag from previous session');
    await updateSyncState({ syncInProgress: false });
  }
}

// Initialize on install/startup
browser.runtime.onInstalled.addListener(() => {
  console.log('[ErgoBlock BG] Extension installed');
  clearStaleSyncState();
  setupAlarm();
  setupSyncAlarm();
  updateBadge();
});

browser.runtime.onStartup.addListener(() => {
  console.log('[ErgoBlock BG] Extension started');
  clearStaleSyncState();
  setupAlarm();
  setupSyncAlarm();
  updateBadge();
});
