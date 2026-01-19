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
  getSocialGraph,
  setFollowsHandles,
  getFollowsHandles,
  setBlocklistConflicts,
  getDismissedConflicts,
  getMassOpsSettings,
  setMassOpsSettings,
  saveMassOpsScanResult,
  setCarDownloadProgress,
  clearCarDownloadProgress,
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
  Interaction,
  OwnedList,
  ListMember,
  GraphOperation,
  MassOpsSettings,
} from './types.js';
import {
  fetchAndParseRepo,
  ParsedPost,
  fetchListsFromCarWithTimestamps,
  fetchListsFromCar,
  detectMassOperations,
  getCarFileSize,
  fetchExternalUserGraph,
} from './carRepo.js';
import {
  getGraphOperationsSmart,
  checkCarCacheStatus,
  type CarDownloadProgress,
} from './carService.js';
import { invalidateCarCache } from './carCache.js';
import { sleep, generateId } from './utils.js';
import {
  getFollowsWhoBlock,
  getFollowsWhoBlockCached,
  processBlockedByQueue,
  prewarmBlockedByCache,
  hasQueuedItems,
} from './clearskyService.js';

const ALARM_NAME = 'checkExpirations';
const SYNC_ALARM_NAME = 'syncWithBluesky';
const FOLLOWS_SYNC_ALARM_NAME = 'followsSync';
const CLEARSKY_QUEUE_ALARM_NAME = 'clearskyQueue';
const SYNC_INTERVAL_MINUTES = 60; // Sync every 60 minutes (was 15)
const FOLLOWS_SYNC_INTERVAL_MINUTES = 120; // Sync follows every 2 hours
const CLEARSKY_QUEUE_INTERVAL_MINUTES = 2; // Process Clearsky queue every 2 minutes
const PAGINATION_DELAY = 100; // ms between paginated requests (was 500ms)

// In-memory sync locks (atomic, no race window)
let syncLockActive = false;
let blocklistAuditLockActive = false;
let followsSyncLockActive = false;
let clearskyQueueLockActive = false;

interface AuthData {
  accessJwt: string;
  refreshJwt?: string;
  did: string;
  pdsUrl: string;
}

async function getAuthToken(): Promise<AuthData | null> {
  const result = await browser.storage.local.get('authToken');
  return (result.authToken as AuthData) || null;
}

/**
 * Request fresh auth from content scripts
 * Sends a message to all tabs with bsky.app to trigger auth sync
 * Returns fresh auth if available, or null
 */
async function requestFreshAuth(): Promise<AuthData | null> {
  try {
    // Query all tabs that might have Bluesky open
    const tabs = await browser.tabs.query({ url: '*://*.bsky.app/*' });

    if (tabs.length === 0) {
      console.log('[ErgoBlock BG] No Bluesky tabs found for auth refresh');
      return null;
    }

    // Request auth from the first available tab
    for (const tab of tabs) {
      if (tab.id) {
        try {
          const response = (await browser.tabs.sendMessage(tab.id, { type: 'REQUEST_AUTH' })) as
            | { auth: AuthData | null }
            | undefined;
          if (response?.auth) {
            // Store the fresh auth
            await browser.storage.local.set({ authToken: response.auth, authStatus: 'valid' });
            console.log('[ErgoBlock BG] Got fresh auth from tab', tab.id);
            return response.auth;
          }
        } catch {
          // Tab might not have content script loaded, try next
          continue;
        }
      }
    }

    console.log('[ErgoBlock BG] Could not get fresh auth from any tab');
    return null;
  } catch (error) {
    console.error('[ErgoBlock BG] Error requesting fresh auth:', error);
    return null;
  }
}

/**
 * Check if an error indicates an expired token
 */
function isExpiredTokenError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('expiredtoken') ||
    message.includes('token has expired') ||
    message.includes('expired token')
  );
}

/**
 * Refresh the access token using the refresh token
 * Returns the new auth data if successful, null otherwise
 */
async function refreshSession(auth: AuthData): Promise<AuthData | null> {
  if (!auth.refreshJwt) {
    console.log('[ErgoBlock BG] No refresh token available, requesting fresh auth from tab');
    return requestFreshAuth();
  }

  try {
    console.log('[ErgoBlock BG] Attempting to refresh access token...');

    const response = await fetch(`${auth.pdsUrl}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.refreshJwt}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ErgoBlock BG] Token refresh failed:', response.status, errorText);
      // Refresh token might also be expired, try getting fresh auth from tab
      return requestFreshAuth();
    }

    const data = (await response.json()) as {
      accessJwt: string;
      refreshJwt: string;
      did: string;
      handle: string;
    };

    const newAuth: AuthData = {
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
      did: data.did,
      pdsUrl: auth.pdsUrl,
    };

    // Store the refreshed tokens
    await browser.storage.local.set({ authToken: newAuth, authStatus: 'valid' });
    console.log('[ErgoBlock BG] Token refreshed successfully');

    return newAuth;
  } catch (error) {
    console.error('[ErgoBlock BG] Error refreshing token:', error);
    // Fall back to requesting fresh auth from tab
    return requestFreshAuth();
  }
}

/**
 * Wrapper for API requests that handles auth status updates and token refresh
 */
async function bgApiRequest<T>(
  endpoint: string,
  method: string,
  body: unknown,
  token: string,
  pdsUrl: string
): Promise<T | null> {
  const doRequest = async (accessJwt: string): Promise<T | null> => {
    const result = await executeApiRequest<T>(
      endpoint,
      method,
      body,
      { accessJwt, pdsUrl },
      pdsUrl // Force PDS for background operations to ensure write consistency
    );
    return result;
  };

  try {
    // Background operations should always use the PDS to ensure consistent writes to the user's repo.
    const result = await doRequest(token);

    // If request was successful, ensure status is valid
    await browser.storage.local.set({ authStatus: 'valid' });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      // Check for expired token error (400 with ExpiredToken)
      if (isExpiredTokenError(error)) {
        console.log('[ErgoBlock BG] Token expired, attempting refresh...');

        // Get current auth to access refresh token
        const auth = await getAuthToken();
        if (!auth) {
          console.error('[ErgoBlock BG] No auth available for refresh');
          await browser.storage.local.set({ authStatus: 'invalid' });
          throw error;
        }

        // Try to refresh the token
        const newAuth = await refreshSession(auth);
        if (newAuth) {
          // Retry the request with the new token
          console.log('[ErgoBlock BG] Retrying request with refreshed token...');
          try {
            const result = await doRequest(newAuth.accessJwt);
            await browser.storage.local.set({ authStatus: 'valid' });
            return result;
          } catch (retryError) {
            console.error('[ErgoBlock BG] Retry after refresh failed:', retryError);
            throw retryError;
          }
        } else {
          console.error('[ErgoBlock BG] Token refresh failed, marking session invalid');
          await browser.storage.local.set({ authStatus: 'invalid' });
          throw error;
        }
      }

      // Check for 401 auth errors
      if (error.message.includes('401') || error.message.includes('Auth error')) {
        console.error('[ErgoBlock BG] Auth failed (401), marking session invalid');
        await browser.storage.local.set({ authStatus: 'invalid' });
      }
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
 * Fetch profiles in batches (max 25 per request)
 * Returns array of ProfileWithViewer
 * Uses public API (AppView) for getProfiles endpoint
 */
async function fetchProfiles(
  dids: string[],
  accessJwt: string,
  pdsUrl: string = 'https://bsky.social'
): Promise<ProfileWithViewer[]> {
  const result: ProfileWithViewer[] = [];
  const batchSize = 25;
  const publicApi = 'https://public.api.bsky.app';

  for (let i = 0; i < dids.length; i += batchSize) {
    const batch = dids.slice(i, i + batchSize);
    const params = batch.map((d) => `actors=${encodeURIComponent(d)}`).join('&');

    try {
      // Use public API for getProfiles (not PDS)
      const response = await executeApiRequest<GetProfilesResponse>(
        `app.bsky.actor.getProfiles?${params}`,
        'GET',
        null,
        { accessJwt, pdsUrl },
        publicApi
      );

      if (response?.profiles) {
        result.push(...response.profiles);
      }
    } catch (error) {
      console.error('[ErgoBlock BG] Error fetching profiles:', error);
    }

    // Rate limit between batches
    if (i + batchSize < dids.length) {
      await sleep(200);
    }
  }

  return result;
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
  _exhaustive = false // No longer needed - CAR downloads entire repo
): Promise<InteractionResult> {
  // Search their posts using CAR file download
  const searchTheirPosts = async (): Promise<FeedPost | null> => {
    const pdsUrl = await resolvePdsUrl(targetDid);

    try {
      console.log(`[ErgoBlock BG] Fetching CAR for ${targetDid}...`);
      const repoData = await fetchAndParseRepo(targetDid, pdsUrl);
      console.log(`[ErgoBlock BG] Searching ${repoData.posts.length} posts for ${targetDid}`);

      for (const post of repoData.posts) {
        const record = parsedPostToRawRecord(post, targetDid);
        if (isInteractionWithUser(record, loggedInDid, loggedInHandle)) {
          console.log(`[ErgoBlock BG] Found context (their post) for ${targetDid}: ${post.uri}`);
          return rawRecordToFeedPost(record, targetDid);
        }
      }

      console.log(`[ErgoBlock BG] No interactions in their posts for ${targetDid}`);
      return null;
    } catch (error) {
      console.error(`[ErgoBlock BG] CAR fetch failed for ${targetDid}:`, error);
      return null;
    }
  };

  // Search my posts (using cached CAR data)
  const searchMyPosts = async (): Promise<FeedPost | null> => {
    try {
      const myPosts = await getMyPosts(loggedInDid);

      for (const record of myPosts) {
        if (isInteractionWithUser(record, targetDid, targetHandle)) {
          console.log(`[ErgoBlock BG] Found context (my post) for ${targetDid}: ${record.uri}`);
          return rawRecordToFeedPost(record, loggedInDid);
        }
      }

      console.log(`[ErgoBlock BG] No interactions in my posts for ${targetDid}`);
      return null;
    } catch (error) {
      console.error(`[ErgoBlock BG] Error searching my posts:`, error);
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
  _exhaustive = false // No longer needed - CAR is always comprehensive
): Promise<InteractionResult> {
  return findBlockContextPost(targetDid, targetHandle, loggedInDid, loggedInHandle);
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

    // NOTE: Context searching is now on-demand only.
    // Users can search for context via the "Find" button in All Blocks or through Amnesty.
    // This keeps sync fast - we only fetch block/mute lists, not search for interactions.

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
    });

    syncLockActive = false;
    return {
      success: blockSettled.status === 'fulfilled' && muteSettled.status === 'fulfilled',
      blocks: { added: blockResult.added, removed: blockResult.removed },
      mutes: muteResult,
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

// In-memory cache for follows/followers (used by amnesty review)
const followsCache: {
  data: ProfileView[] | null;
  fetchedAt: number;
} = { data: null, fetchedAt: 0 };

const followersCache: {
  data: ProfileView[] | null;
  fetchedAt: number;
} = { data: null, fetchedAt: 0 };

const FOLLOW_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch all follows for a user (with caching)
 */
async function fetchAllFollows(auth: AuthData): Promise<ProfileView[]> {
  // Check cache first
  if (followsCache.data && Date.now() - followsCache.fetchedAt < FOLLOW_CACHE_TTL_MS) {
    console.log(`[ErgoBlock BG] Using cached follows (${followsCache.data.length} entries)`);
    return followsCache.data;
  }
  const allFollows: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    // Re-read auth on each iteration to pick up any refreshed tokens
    const currentAuth = (await getAuthToken()) || auth;

    let endpoint = `app.bsky.graph.getFollows?actor=${encodeURIComponent(auth.did)}&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetFollowsResponse>(
      endpoint,
      'GET',
      null,
      currentAuth.accessJwt,
      currentAuth.pdsUrl
    );

    if (response?.follows) {
      allFollows.push(...response.follows);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  // Update cache
  followsCache.data = allFollows;
  followsCache.fetchedAt = Date.now();
  console.log(`[ErgoBlock BG] Cached ${allFollows.length} follows`);

  return allFollows;
}

/**
 * Fetch all followers for a user (with caching)
 */
async function fetchAllFollowers(auth: AuthData): Promise<ProfileView[]> {
  // Check cache first
  if (followersCache.data && Date.now() - followersCache.fetchedAt < FOLLOW_CACHE_TTL_MS) {
    console.log(`[ErgoBlock BG] Using cached followers (${followersCache.data.length} entries)`);
    return followersCache.data;
  }

  const allFollowers: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    // Re-read auth on each iteration to pick up any refreshed tokens
    const currentAuth = (await getAuthToken()) || auth;

    let endpoint = `app.bsky.graph.getFollowers?actor=${encodeURIComponent(auth.did)}&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetFollowersResponse>(
      endpoint,
      'GET',
      null,
      currentAuth.accessJwt,
      currentAuth.pdsUrl
    );

    if (response?.followers) {
      allFollowers.push(...response.followers);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  // Update cache
  followersCache.data = allFollowers;
  followersCache.fetchedAt = Date.now();
  console.log(`[ErgoBlock BG] Cached ${allFollowers.length} followers`);

  return allFollowers;
}

/**
 * Sync follows only (lightweight sync for repost filter feature)
 * This runs on startup and periodically to keep the follows list fresh
 * Uses lightweight storage (just handles) to avoid quota issues
 */
async function syncFollowsOnly(): Promise<void> {
  // Prevent concurrent syncs
  if (followsSyncLockActive) {
    console.log('[ErgoBlock BG] Follows sync already in progress');
    return;
  }
  followsSyncLockActive = true;

  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      console.log('[ErgoBlock BG] Not authenticated, skipping follows sync');
      return;
    }

    // Check if we already have recent follows data (within last hour)
    const existingData = await getFollowsHandles();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (existingData.syncedAt > oneHourAgo && existingData.handles.length > 0) {
      console.log('[ErgoBlock BG] Follows data is fresh, skipping sync');
      return;
    }

    // Proactively clear old bloated socialGraph data to free up space
    // The full socialGraph (with avatars) was used by blocklist audit but is too large
    // We now use lightweight followsHandles instead
    const existingGraph = await getSocialGraph();
    if (existingGraph.follows.length > 0 || existingGraph.followers.length > 0) {
      console.log('[ErgoBlock BG] Clearing old socialGraph to free storage space...');
      await browser.storage.local.remove('socialGraph');
    }

    console.log('[ErgoBlock BG] Syncing follows for repost filter...');
    const follows = await fetchAllFollows(auth);
    console.log(`[ErgoBlock BG] Fetched ${follows.length} follows`);

    // Store just the handles (lightweight - avoids quota issues)
    const handles = follows.map((f) => f.handle);
    await setFollowsHandles(handles, Date.now());
    console.log('[ErgoBlock BG] Follows sync complete');
  } catch (error) {
    console.error('[ErgoBlock BG] Follows sync failed:', error);
  } finally {
    followsSyncLockActive = false;
  }
}

/**
 * Set up follows sync alarm
 */
function setupFollowsSyncAlarm(): void {
  browser.alarms.create(FOLLOWS_SYNC_ALARM_NAME, {
    delayInMinutes: 1, // First sync after 1 minute (give time for auth)
    periodInMinutes: FOLLOWS_SYNC_INTERVAL_MINUTES,
  });
}

// ============================================================================
// Clearsky Queue Processing
// ============================================================================

/**
 * Process the Clearsky blocked-by queue
 * Fetches "who blocks this person" data in the background
 */
async function processClearskyQueue(): Promise<void> {
  if (clearskyQueueLockActive) {
    console.log('[ErgoBlock BG] Clearsky queue processing already in progress');
    return;
  }

  // Check if there's anything to process
  const hasItems = await hasQueuedItems();
  if (!hasItems) {
    return; // Nothing to do, skip silently
  }

  clearskyQueueLockActive = true;
  try {
    console.log('[ErgoBlock BG] Processing Clearsky blocked-by queue...');
    const processed = await processBlockedByQueue(3); // Process 3 items per run
    if (processed > 0) {
      console.log(`[ErgoBlock BG] Processed ${processed} Clearsky queue items`);
    }
  } catch (error) {
    console.error('[ErgoBlock BG] Clearsky queue processing failed:', error);
  } finally {
    clearskyQueueLockActive = false;
  }
}

/**
 * Set up Clearsky queue processing alarm
 */
function setupClearskyQueueAlarm(): void {
  browser.alarms.create(CLEARSKY_QUEUE_ALARM_NAME, {
    delayInMinutes: 2, // First run after 2 minutes
    periodInMinutes: CLEARSKY_QUEUE_INTERVAL_MINUTES,
  });
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

    // Build social graph (in-memory only for conflict detection)
    // We don't persist the full graph - it's too large with avatars
    const followerDids = new Set(followers.map((f) => f.did));

    // Combine into FollowRelation[] (in-memory for conflict detection)
    // Store without avatars to reduce memory usage
    const allRelations: Map<string, FollowRelation> = new Map();

    for (const f of follows) {
      allRelations.set(f.did, {
        did: f.did,
        handle: f.handle,
        displayName: f.displayName,
        // avatar intentionally omitted - fetched on-demand in UI
        relationship: followerDids.has(f.did) ? 'mutual' : 'following',
      });
    }

    for (const f of followers) {
      if (!allRelations.has(f.did)) {
        allRelations.set(f.did, {
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          // avatar intentionally omitted - fetched on-demand in UI
          relationship: 'follower',
        });
      }
    }

    // Save lightweight follows handles (for repost filter feature)
    // This replaces the bloated socialGraph storage
    const followHandles = follows.map((f) => f.handle);
    await setFollowsHandles(followHandles, Date.now());
    console.log(`[ErgoBlock BG] Saved ${followHandles.length} follow handles`);

    // Note: We no longer persist the full socialGraph - it was too large
    // The UI can fetch profile details on-demand when needed

    // Save blocklists (without avatars to reduce storage)
    const storedBlocklists: SubscribedBlocklist[] = blocklists.map((l) => ({
      uri: l.uri,
      name: l.name,
      description: l.description,
      // avatar intentionally omitted - fetched on-demand in UI
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
            // avatar intentionally omitted - fetched on-demand in UI
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

// Maximum concurrent expiration operations (prevents overwhelming the API)
const MAX_CONCURRENT_EXPIRATIONS = 5;

/**
 * Process a single expired block
 */
async function processExpiredBlock(
  did: string,
  data: { handle: string; expiresAt: number; createdAt?: number; rkey?: string },
  auth: AuthData
): Promise<{ success: boolean; authError: boolean }> {
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
    return { success: true, authError: false };
  } catch (error) {
    console.error('[ErgoBlock BG] Failed to unblock:', data.handle, error);

    const isAuthError =
      error instanceof Error &&
      (error.message.includes('401') || error.message.includes('Auth error'));

    if (!isAuthError) {
      // Only log non-auth failures (auth failures will be retried on next check)
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

    return { success: false, authError: isAuthError };
  }
}

/**
 * Process a single expired mute
 */
async function processExpiredMute(
  did: string,
  data: { handle: string; expiresAt: number; createdAt?: number },
  auth: AuthData
): Promise<{ success: boolean; authError: boolean }> {
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
    return { success: true, authError: false };
  } catch (error) {
    console.error('[ErgoBlock BG] Failed to unmute:', data.handle, error);

    const isAuthError =
      error instanceof Error &&
      (error.message.includes('401') || error.message.includes('Auth error'));

    if (!isAuthError) {
      // Only log non-auth failures (auth failures will be retried on next check)
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

    return { success: false, authError: isAuthError };
  }
}

/**
 * Process items in batches with concurrency limit
 */
async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  maxConcurrent: number
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += maxConcurrent) {
    const batch = items.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

export async function checkExpirations(): Promise<void> {
  console.log('[ErgoBlock BG] Checking expirations...');

  // Clean up expired screenshots based on retention policy
  await cleanupExpiredPostContexts();

  let auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    console.log('[ErgoBlock BG] No auth token available, trying to get fresh auth...');
    auth = await requestFreshAuth();
    if (!auth) {
      console.log('[ErgoBlock BG] Could not get auth, skipping check');
      await browser.storage.local.set({ authStatus: 'invalid' });
      return;
    }
  }

  console.log('[ErgoBlock BG] Using PDS:', auth.pdsUrl);
  const now = Date.now();

  // Collect expired blocks and mutes
  const blocks = await getTempBlocks();
  const mutes = await getTempMutes();

  const expiredBlocks = Object.entries(blocks)
    .filter(([, data]) => data.expiresAt <= now)
    .map(([did, data]) => ({ did, data }));

  const expiredMutes = Object.entries(mutes)
    .filter(([, data]) => data.expiresAt <= now)
    .map(([did, data]) => ({ did, data }));

  console.log(
    `[ErgoBlock BG] Found ${expiredBlocks.length} expired blocks, ${expiredMutes.length} expired mutes`
  );

  // At this point auth is guaranteed non-null (we return early above if null)
  let currentAuth: AuthData = auth;

  // Process expired blocks in parallel batches
  if (expiredBlocks.length > 0) {
    let blockResults = await processBatch(
      expiredBlocks,
      ({ did, data }) => processExpiredBlock(did, data, currentAuth),
      MAX_CONCURRENT_EXPIRATIONS
    );

    // If auth errors occurred, try to get fresh auth and retry failed blocks
    if (blockResults.some((r) => r.authError)) {
      console.log('[ErgoBlock BG] Auth error during block expiration, requesting fresh auth...');
      const freshAuth = await requestFreshAuth();
      if (freshAuth) {
        currentAuth = freshAuth;
        // Find blocks that failed due to auth and retry them
        const failedBlocks = expiredBlocks.filter((_, i) => blockResults[i].authError);
        if (failedBlocks.length > 0) {
          console.log(`[ErgoBlock BG] Retrying ${failedBlocks.length} blocks with fresh auth`);
          const retryResults = await processBatch(
            failedBlocks,
            ({ did, data }) => processExpiredBlock(did, data, currentAuth),
            MAX_CONCURRENT_EXPIRATIONS
          );
          // Update results for logging
          blockResults = retryResults;
        }
      }
    }

    // Log final result
    const stillFailed = blockResults.filter((r) => r.authError).length;
    if (stillFailed > 0) {
      console.log(
        `[ErgoBlock BG] ${stillFailed} blocks still failed after retry - will try again on next check`
      );
    }
  }

  // Process expired mutes in parallel batches
  if (expiredMutes.length > 0) {
    let muteResults = await processBatch(
      expiredMutes,
      ({ did, data }) => processExpiredMute(did, data, currentAuth),
      MAX_CONCURRENT_EXPIRATIONS
    );

    // If auth errors occurred, try to get fresh auth and retry failed mutes
    if (muteResults.some((r) => r.authError)) {
      console.log('[ErgoBlock BG] Auth error during mute expiration, requesting fresh auth...');
      const freshAuth = await requestFreshAuth();
      if (freshAuth) {
        currentAuth = freshAuth;
        // Find mutes that failed due to auth and retry them
        const failedMutes = expiredMutes.filter((_, i) => muteResults[i].authError);
        if (failedMutes.length > 0) {
          console.log(`[ErgoBlock BG] Retrying ${failedMutes.length} mutes with fresh auth`);
          const retryResults = await processBatch(
            failedMutes,
            ({ did, data }) => processExpiredMute(did, data, currentAuth),
            MAX_CONCURRENT_EXPIRATIONS
          );
          // Update results for logging
          muteResults = retryResults;
        }
      }
    }

    // Log final result
    const stillFailed = muteResults.filter((r) => r.authError).length;
    if (stillFailed > 0) {
      console.log(
        `[ErgoBlock BG] ${stillFailed} mutes still failed after retry - will try again on next check`
      );
    }
  }

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
// Note: Return promises to keep Service Worker alive during async operations
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    return checkExpirations();
  }
  if (alarm.name === SYNC_ALARM_NAME) {
    return performFullSync();
  }
  if (alarm.name === FOLLOWS_SYNC_ALARM_NAME) {
    return syncFollowsOnly();
  }
  if (alarm.name === CLEARSKY_QUEUE_ALARM_NAME) {
    return processClearskyQueue();
  }
});

// Listen for messages from content script and popup
interface ExtensionMessage {
  type: string;
  auth?: AuthData;
  did?: string;
  handle?: string;
  listUri?: string;
  rkey?: string;
  targetDid?: string;
  targetDids?: string[];
  beforeTimestamp?: number;
}

type MessageResponse = { success: boolean; error?: string; [key: string]: unknown };

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
    console.log(
      `[ErgoBlock BG] Using cached posts for logged-in user (${myPostsCache.posts.length} posts)`
    );
    return myPostsCache.posts;
  }

  console.log('[ErgoBlock BG] Fetching logged-in user posts via CAR...');
  const pdsUrl = await resolvePdsUrl(loggedInDid);

  try {
    const repoData = await fetchAndParseRepo(loggedInDid, pdsUrl);
    const posts = repoData.posts.map((post) => parsedPostToRawRecord(post, loggedInDid));

    console.log(`[ErgoBlock BG] Cached ${posts.length} posts for logged-in user (via CAR)`);
    myPostsCache = { did: loggedInDid, posts, fetchedAt: repoData.fetchedAt };
    return posts;
  } catch (error) {
    console.error('[ErgoBlock BG] CAR fetch failed for logged-in user:', error);
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
  loggedInHandle: string | undefined
): Promise<Interaction[]> {
  console.log(
    `[ErgoBlock BG] Finding all interactions via CAR: ${targetHandle} <-> ${loggedInHandle || loggedInDid}`
  );

  const interactions: Interaction[] = [];
  const seenUris = new Set<string>();

  // Fetch target user's posts using CAR file
  const fetchTargetPosts = async (): Promise<void> => {
    const pdsUrl = await resolvePdsUrl(targetDid);

    try {
      console.log(`[ErgoBlock BG] Fetching CAR for ${targetHandle}...`);
      const repoData = await fetchAndParseRepo(targetDid, pdsUrl);
      let foundCount = 0;

      for (const post of repoData.posts) {
        if (seenUris.has(post.uri)) continue;
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

      console.log(
        `[ErgoBlock BG] ${targetHandle}: searched ${repoData.posts.length} posts, found ${foundCount} interactions`
      );
    } catch (error) {
      console.error(`[ErgoBlock BG] CAR fetch failed for ${targetHandle}:`, error);
    }
  };

  // Search cached logged-in user posts (already using CAR via getMyPosts)
  const searchMyPosts = async (): Promise<void> => {
    const myPosts = await getMyPosts(loggedInDid);
    let foundCount = 0;

    for (const record of myPosts) {
      if (seenUris.has(record.uri)) continue;
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

    console.log(
      `[ErgoBlock BG] ${loggedInHandle || 'you'}: searched ${myPosts.length} cached posts, found ${foundCount} interactions`
    );
  };

  try {
    // Fetch target posts and search cached my posts in parallel
    await Promise.all([fetchTargetPosts(), searchMyPosts()]);

    // Sort by createdAt descending (most recent first)
    interactions.sort((a, b) => b.createdAt - a.createdAt);

    console.log(`[ErgoBlock BG] Found ${interactions.length} total interactions`);
    return interactions;
  } catch (error) {
    console.error('[ErgoBlock BG] findAllInteractions error:', error);
    return [];
  }
}

/**
 * Handle request to fetch all interactions between logged-in user and target
 */
async function handleFetchAllInteractions(
  did: string,
  handle: string
): Promise<{ success: boolean; interactions?: Interaction[]; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      console.log('[ErgoBlock BG] FETCH_ALL_INTERACTIONS: Not authenticated');
      return { success: false, error: 'Not authenticated' };
    }

    const loggedInHandle = await getLoggedInHandle(auth);
    console.log(
      `[ErgoBlock BG] FETCH_ALL_INTERACTIONS: ${handle} (${did}) <-> ${loggedInHandle} (${auth.did})`
    );
    const interactions = await findAllInteractions(did, handle, auth.did, loggedInHandle);
    console.log(
      `[ErgoBlock BG] FETCH_ALL_INTERACTIONS: Returning ${interactions.length} interactions`
    );

    return { success: true, interactions };
  } catch (error) {
    console.error('[ErgoBlock BG] Fetch all interactions failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// List Audit Handlers
// ============================================================================

/**
 * Fetch lists owned by the logged-in user from local CAR
 */
async function handleFetchOwnedLists(): Promise<{
  success: boolean;
  lists?: OwnedList[];
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    console.log('[ErgoBlock BG] Fetching owned lists from CAR...');

    // Fetch and parse lists from CAR file (no API call needed)
    const result = await fetchListsFromCar(auth.did, auth.pdsUrl);

    // Convert ParsedListData to OwnedList
    const ownedLists: OwnedList[] = Object.values(result.lists).map((list) => ({
      uri: list.uri,
      name: list.name,
      purpose: list.purpose === 'app.bsky.graph.defs#modlist' ? 'modlist' : 'curatelist',
      description: list.description,
      listItemCount: list.members.length,
      createdAt: list.createdAt,
    }));

    console.log(`[ErgoBlock BG] Fetched ${ownedLists.length} owned lists from CAR`);
    return { success: true, lists: ownedLists };
  } catch (error) {
    console.error('[ErgoBlock BG] Fetch owned lists failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Fetch list members with timestamps from CAR file
 */
async function handleFetchListMembersWithTimestamps(listUri: string): Promise<{
  success: boolean;
  members?: ListMember[];
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get list name from API first
    const listResponse = await executeApiRequest<{ list: ListView }>(
      `app.bsky.graph.getList?list=${encodeURIComponent(listUri)}&limit=1`,
      'GET',
      null,
      { accessJwt: auth.accessJwt, pdsUrl: auth.pdsUrl }
    );
    const listName = listResponse?.list?.name || 'Unknown List';

    // Fetch user's CAR file and parse for list items
    const targetListUris = new Set([listUri]);
    const parsedLists = await fetchListsFromCarWithTimestamps(
      auth.did,
      auth.pdsUrl,
      targetListUris
    );

    const parsedList = parsedLists.lists[listUri];
    if (!parsedList || parsedList.members.length === 0) {
      return { success: true, members: [] };
    }

    // Hydrate member profiles
    const memberDids = parsedList.members.map((m) => m.did);
    const profiles = await fetchProfiles(memberDids, auth.accessJwt);
    const profileMap = new Map(profiles.map((p) => [p.did, p]));

    // Build ListMember array
    const members: ListMember[] = parsedList.members.map((m) => {
      const profile = profileMap.get(m.did);
      return {
        did: m.did,
        handle: profile?.handle || m.did,
        displayName: profile?.displayName,
        avatar: profile?.avatar,
        listUri,
        listName,
        addedAt: m.addedAt,
        listitemRkey: m.rkey,
      };
    });

    // Sort by addedAt descending (most recent first)
    members.sort((a, b) => b.addedAt - a.addedAt);

    console.log(`[ErgoBlock BG] Fetched ${members.length} members with timestamps for ${listName}`);
    return { success: true, members };
  } catch (error) {
    console.error('[ErgoBlock BG] Fetch list members with timestamps failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Remove a member from a list by deleting the listitem record
 */
async function handleRemoveFromList(rkey: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    await executeApiRequest(
      'com.atproto.repo.deleteRecord',
      'POST',
      {
        repo: auth.did,
        collection: 'app.bsky.graph.listitem',
        rkey,
      },
      { accessJwt: auth.accessJwt, pdsUrl: auth.pdsUrl }
    );

    console.log(`[ErgoBlock BG] Removed list item with rkey: ${rkey}`);
    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Remove from list failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Find interactions with a target user that occurred before a specific timestamp
 * Used for list audit to find interactions before the member was added to the list
 */
async function handleFindInteractionsBefore(
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

    // Use existing findAllInteractions function
    const allInteractions = await findAllInteractions(
      targetDid,
      targetHandle,
      auth.did,
      loggedInHandle
    );

    // Filter to only interactions before the timestamp
    const filteredInteractions = allInteractions.filter((i) => i.createdAt < beforeTimestamp);

    console.log(
      `[ErgoBlock BG] Found ${filteredInteractions.length} interactions before ${new Date(beforeTimestamp).toISOString()}`
    );

    return { success: true, interactions: filteredInteractions };
  } catch (error) {
    console.error('[ErgoBlock BG] Find interactions before failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * User info for relationship display
 */
interface RelationshipUser {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/**
 * Response for follow relationships query
 */
interface FollowRelationshipsResponse {
  success: boolean;
  followsWhoFollowThem?: RelationshipUser[];
  followersWhoFollowThem?: RelationshipUser[];
  followsTheyBlock?: RelationshipUser[];
  error?: string;
}

/**
 * Fetch candidate's followers using public API (works even if blocked)
 */
async function fetchCandidateFollowers(candidateDid: string): Promise<Set<string>> {
  const followerDids = new Set<string>();
  let cursor: string | undefined;

  do {
    let url = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollowers?actor=${encodeURIComponent(candidateDid)}&limit=100`;
    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) break;

      const data = (await response.json()) as { followers?: ProfileView[]; cursor?: string };
      if (data.followers) {
        for (const f of data.followers) {
          followerDids.add(f.did);
        }
      }
      cursor = data.cursor;

      if (cursor) {
        await sleep(PAGINATION_DELAY);
      }
    } catch {
      break;
    }
  } while (cursor);

  return followerDids;
}

/**
 * Fetch candidate's blocks from their CAR file
 */
async function fetchCandidateBlocks(candidateDid: string): Promise<Set<string>> {
  try {
    const pdsUrl = await resolvePdsUrl(candidateDid);
    console.log(`[ErgoBlock BG] Fetching CAR for ${candidateDid} to get blocks...`);
    const repoData = await fetchAndParseRepo(candidateDid, pdsUrl);
    console.log(`[ErgoBlock BG] Candidate has ${repoData.blocks.length} blocks`);
    return new Set(repoData.blocks);
  } catch (error) {
    console.error(`[ErgoBlock BG] Failed to fetch candidate blocks:`, error);
    return new Set();
  }
}

/**
 * Get follow relationships for amnesty review
 * Returns:
 * - followsWhoFollowThem: people you follow who also follow the candidate
 * - followersWhoFollowThem: your followers who also follow the candidate
 * - followsTheyBlock: people you follow who the candidate blocks
 */
async function handleGetFollowRelationships(
  candidateDid: string
): Promise<FollowRelationshipsResponse> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    console.log(`[ErgoBlock BG] Fetching follow relationships for ${candidateDid}`);

    // Fetch all data in parallel
    const [myFollows, myFollowers, candidateFollowers, candidateBlocks] = await Promise.all([
      fetchAllFollows(auth),
      fetchAllFollowers(auth),
      fetchCandidateFollowers(candidateDid),
      fetchCandidateBlocks(candidateDid),
    ]);

    console.log(
      `[ErgoBlock BG] Got ${myFollows.length} follows, ${myFollowers.length} followers, candidate has ${candidateFollowers.size} followers and ${candidateBlocks.size} blocks`
    );

    // Build results for follows/followers who follow the candidate
    const followsWhoFollowThem: RelationshipUser[] = [];
    const followersWhoFollowThem: RelationshipUser[] = [];
    const followsTheyBlock: RelationshipUser[] = [];

    for (const f of myFollows) {
      if (candidateFollowers.has(f.did)) {
        followsWhoFollowThem.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
      // Check if candidate blocks this person you follow
      if (candidateBlocks.has(f.did)) {
        followsTheyBlock.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    for (const f of myFollowers) {
      if (candidateFollowers.has(f.did)) {
        followersWhoFollowThem.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    console.log(
      `[ErgoBlock BG] Follow relationships: ${followsWhoFollowThem.length} follows follow them, ${followersWhoFollowThem.length} followers follow them, ${followsTheyBlock.length} follows they block`
    );

    return {
      success: true,
      followsWhoFollowThem,
      followersWhoFollowThem,
      followsTheyBlock,
    };
  } catch (error) {
    console.error('[ErgoBlock BG] Get follow relationships failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get follows who follow the candidate (incremental loading)
 */
async function handleGetFollowsWhoFollowThem(
  candidateDid: string
): Promise<{ success: boolean; users?: RelationshipUser[]; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const [myFollows, candidateFollowers] = await Promise.all([
      fetchAllFollows(auth),
      fetchCandidateFollowers(candidateDid),
    ]);

    const users: RelationshipUser[] = [];
    for (const f of myFollows) {
      if (candidateFollowers.has(f.did)) {
        users.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    console.log(`[ErgoBlock BG] Follows who follow them: ${users.length}`);
    return { success: true, users };
  } catch (error) {
    console.error('[ErgoBlock BG] Get follows who follow them failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get followers who follow the candidate (incremental loading)
 */
async function handleGetFollowersWhoFollowThem(
  candidateDid: string
): Promise<{ success: boolean; users?: RelationshipUser[]; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const [myFollowers, candidateFollowers] = await Promise.all([
      fetchAllFollowers(auth),
      fetchCandidateFollowers(candidateDid),
    ]);

    const users: RelationshipUser[] = [];
    for (const f of myFollowers) {
      if (candidateFollowers.has(f.did)) {
        users.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    console.log(`[ErgoBlock BG] Followers who follow them: ${users.length}`);
    return { success: true, users };
  } catch (error) {
    console.error('[ErgoBlock BG] Get followers who follow them failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get follows who are blocked by the candidate (incremental loading)
 */
async function handleGetFollowsTheyBlock(
  candidateDid: string
): Promise<{ success: boolean; users?: RelationshipUser[]; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const [myFollows, candidateBlocks] = await Promise.all([
      fetchAllFollows(auth),
      fetchCandidateBlocks(candidateDid),
    ]);

    const users: RelationshipUser[] = [];
    for (const f of myFollows) {
      if (candidateBlocks.has(f.did)) {
        users.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    console.log(`[ErgoBlock BG] Follows they block: ${users.length}`);
    return { success: true, users };
  } catch (error) {
    console.error('[ErgoBlock BG] Get follows they block failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Clearsky "Follows Who Block" Handlers
// ============================================================================

/**
 * Get follows who block the candidate (via Clearsky API)
 * This is the reverse of "follows they block" - shows community consensus
 */
async function handleGetFollowsWhoBlockThem(
  candidateDid: string
): Promise<{ success: boolean; count?: number; users?: RelationshipUser[]; totalBlockers?: number; cached?: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get my follows as a Set
    const myFollows = await fetchAllFollows(auth);
    const myFollowDids = new Set(myFollows.map((f) => f.did));

    // Get follows who block this person from Clearsky
    const result = await getFollowsWhoBlock(candidateDid, myFollowDids);

    // Convert DIDs to user info
    const users: RelationshipUser[] = [];
    for (const did of result.dids) {
      const follow = myFollows.find((f) => f.did === did);
      if (follow) {
        users.push({
          did: follow.did,
          handle: follow.handle,
          displayName: follow.displayName,
          avatar: follow.avatar,
        });
      }
    }

    console.log(`[ErgoBlock BG] Follows who block them: ${result.count} (total blockers: ${result.totalBlockers}, cached: ${result.cached})`);
    return {
      success: true,
      count: result.count,
      users,
      totalBlockers: result.totalBlockers,
      cached: result.cached,
    };
  } catch (error) {
    console.error('[ErgoBlock BG] Get follows who block them failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get cached follows who block count (without triggering a fetch)
 */
async function handleGetFollowsWhoBlockThemCached(
  candidateDid: string
): Promise<{ success: boolean; count?: number; cached: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did) {
      return { success: false, cached: false, error: 'Not authenticated' };
    }

    const myFollows = await fetchAllFollows(auth);
    const myFollowDids = new Set(myFollows.map((f) => f.did));

    const result = await getFollowsWhoBlockCached(candidateDid, myFollowDids);
    if (!result) {
      return { success: true, cached: false };
    }

    return {
      success: true,
      count: result.count,
      cached: true,
    };
  } catch (error) {
    console.error('[ErgoBlock BG] Get cached follows who block failed:', error);
    return { success: false, cached: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Prewarm Clearsky cache for amnesty candidates
 */
async function handlePrewarmClearskyCache(
  targetDids: string[]
): Promise<{ success: boolean; queued?: number; alreadyCached?: number; error?: string }> {
  try {
    const result = await prewarmBlockedByCache(targetDids);
    console.log(`[ErgoBlock BG] Prewarm Clearsky: ${result.queued} queued, ${result.alreadyCached} cached`);

    // Start processing immediately instead of waiting for the 2-minute alarm
    if (result.queued > 0) {
      // Process in background (don't await) so we return quickly
      processBlockedByQueue(3).catch((err) => {
        console.error('[ErgoBlock BG] Immediate queue processing failed:', err);
      });
    }

    return { success: true, ...result };
  } catch (error) {
    console.error('[ErgoBlock BG] Prewarm Clearsky cache failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Mass Operations Detection Handlers
// ============================================================================

interface MassOpsScanResponse {
  success: boolean;
  error?: string;
}

interface MassOpsUndoResponse {
  success: boolean;
  undone: number;
  failed: number;
  errors: string[];
}

/**
 * Scan user's CAR file for mass operations
 * Uses smart caching to avoid redundant downloads
 */
async function handleScanMassOps(
  settings: MassOpsSettings,
  forceRefresh = false
): Promise<MassOpsScanResponse> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    console.log('[ErgoBlock BG] Starting mass ops scan with settings:', settings);

    // Use the smart service with progress reporting
    // When not forcing refresh, prefer cached data (even if stale) for historical analysis
    const result = await getGraphOperationsSmart({
      did: auth.did,
      pdsUrl: auth.pdsUrl,
      forceRefresh,
      preferCache: !forceRefresh,
      onProgress: async (progress: CarDownloadProgress) => {
        console.log(`[ErgoBlock BG] Mass ops scan: ${progress.message}`);
        // Update storage so UI can read progress
        await setCarDownloadProgress({
          did: progress.did,
          stage: progress.stage,
          bytesDownloaded: progress.bytesDownloaded,
          bytesTotal: progress.bytesTotal,
          percentComplete: progress.percentComplete,
          message: progress.message,
          isIncremental: progress.isIncremental,
          startedAt: progress.startedAt,
          error: progress.error,
        });
      },
    });

    // Detect mass operations from the cached/downloaded data
    const clusters = detectMassOperations(
      {
        blocks: result.blocks,
        follows: result.follows,
        listitems: result.listitems,
      },
      settings
    );

    // Save the scan result
    await saveMassOpsScanResult({
      clusters,
      scannedAt: Date.now(),
      operationCounts: {
        blocks: result.blocks.length,
        follows: result.follows.length,
        listitems: result.listitems.length,
      },
    });

    // Clear progress
    await clearCarDownloadProgress();

    console.log(
      `[ErgoBlock BG] Mass ops scan complete: ${clusters.length} clusters found, ` +
        `${result.blocks.length} blocks, ${result.follows.length} follows, ` +
        `${result.listitems.length} list items ` +
        `(cached: ${result.wasCached}, incremental: ${result.wasIncremental})`
    );

    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Mass ops scan failed:', error);
    // Clear progress on error
    await clearCarDownloadProgress();
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Undo (delete) selected mass operations
 * Rate-limited to avoid API throttling
 */
async function handleUndoMassOperations(
  operations: GraphOperation[]
): Promise<MassOpsUndoResponse> {
  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    return { success: false, undone: 0, failed: operations.length, errors: ['Not authenticated'] };
  }

  let undone = 0;
  let failed = 0;
  const errors: string[] = [];

  console.log(`[ErgoBlock BG] Undoing ${operations.length} mass operations`);

  for (const op of operations) {
    try {
      // Determine the collection based on operation type
      const collection =
        op.type === 'block'
          ? 'app.bsky.graph.block'
          : op.type === 'follow'
            ? 'app.bsky.graph.follow'
            : 'app.bsky.graph.listitem';

      const response = await bgApiRequest<{ success?: boolean }>(
        'com.atproto.repo.deleteRecord',
        'POST',
        {
          repo: auth.did,
          collection,
          rkey: op.rkey,
        },
        auth.accessJwt,
        auth.pdsUrl
      );

      if (response) {
        undone++;

        // Add history entry for blocks/follows (not list items - too noisy)
        if (op.type === 'block' || op.type === 'follow') {
          await addHistoryEntry({
            did: op.did,
            handle: op.did, // We don't have handle here, use DID
            action: op.type === 'block' ? 'unblocked' : 'unblocked', // Use unblocked for follows too
            timestamp: Date.now(),
            trigger: 'manual',
            success: true,
          });
        }
      } else {
        failed++;
        errors.push(`Failed to delete ${op.type} for ${op.did}`);
      }

      // Rate limit: 350ms between operations
      await sleep(350);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${op.type} ${op.did}: ${errorMsg}`);
      console.error(`[ErgoBlock BG] Failed to undo ${op.type} for ${op.did}:`, error);
    }
  }

  console.log(`[ErgoBlock BG] Mass ops undo complete: ${undone} undone, ${failed} failed`);

  return { success: failed === 0, undone, failed, errors };
}

// ============================================================================
// Copy User handlers
// ============================================================================

/**
 * Fetch another user's follows and blocks from their CAR file
 */
async function handleFetchCopyUserData(handle: string): Promise<MessageResponse> {
  console.log(`[ErgoBlock BG] Fetching Copy User data for: ${handle}`);

  try {
    // Step 1: Resolve handle to profile (includes DID)
    const profile = await bgApiRequestPublic<ProfileWithViewer>(
      `app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`
    );

    if (!profile) {
      return { success: false, error: `User not found: ${handle}` };
    }

    const targetDid = profile.did;
    console.log(`[ErgoBlock BG] Resolved ${handle} to DID: ${targetDid}`);

    // Step 2: Get target user's PDS URL
    const pdsUrl = await resolvePdsUrl(targetDid);
    console.log(`[ErgoBlock BG] Target PDS: ${pdsUrl || 'using relay'}`);

    // Step 3: Fetch and parse their CAR file for follows/blocks
    const graphData = await fetchExternalUserGraph(targetDid, pdsUrl, (message) => {
      console.log(`[ErgoBlock BG] Copy User progress: ${message}`);
    });

    console.log(
      `[ErgoBlock BG] Found ${graphData.follows.length} follows, ${graphData.blocks.length} blocks`
    );

    return {
      success: true,
      did: targetDid,
      profile,
      follows: graphData.follows,
      blocks: graphData.blocks,
    };
  } catch (error) {
    console.error('[ErgoBlock BG] Failed to fetch Copy User data:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Execute batch follow operations for Copy User
 */
async function handleExecuteCopyUserFollows(dids: string[]): Promise<MessageResponse> {
  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    return { success: false, error: 'Not authenticated' };
  }

  console.log(`[ErgoBlock BG] Executing Copy User follows for ${dids.length} users`);

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const did of dids) {
    try {
      const record = {
        $type: 'app.bsky.graph.follow',
        subject: did,
        createdAt: new Date().toISOString(),
      };

      const response = await bgApiRequest<{ uri: string; cid: string }>(
        'com.atproto.repo.createRecord',
        'POST',
        {
          repo: auth.did,
          collection: 'app.bsky.graph.follow',
          record,
        },
        auth.accessJwt,
        auth.pdsUrl
      );

      if (response) {
        succeeded++;
      } else {
        failed++;
        errors.push(`Failed to follow ${did}`);
      }

      // Rate limit: 350ms between operations
      await sleep(350);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${did}: ${errorMsg}`);
      console.error(`[ErgoBlock BG] Failed to follow ${did}:`, error);
    }
  }

  console.log(`[ErgoBlock BG] Copy User follows complete: ${succeeded} succeeded, ${failed} failed`);

  return { success: failed === 0, succeeded, failed, errors };
}

/**
 * Execute batch block operations for Copy User
 */
async function handleExecuteCopyUserBlocks(dids: string[]): Promise<MessageResponse> {
  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    return { success: false, error: 'Not authenticated' };
  }

  console.log(`[ErgoBlock BG] Executing Copy User blocks for ${dids.length} users`);

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const did of dids) {
    try {
      const record = {
        $type: 'app.bsky.graph.block',
        subject: did,
        createdAt: new Date().toISOString(),
      };

      const response = await bgApiRequest<{ uri: string; cid: string }>(
        'com.atproto.repo.createRecord',
        'POST',
        {
          repo: auth.did,
          collection: 'app.bsky.graph.block',
          record,
        },
        auth.accessJwt,
        auth.pdsUrl
      );

      if (response) {
        succeeded++;

        // Add history entry for the block
        await addHistoryEntry({
          did,
          handle: did, // We don't have handle here, use DID
          action: 'blocked',
          timestamp: Date.now(),
          trigger: 'manual',
          success: true,
        });
      } else {
        failed++;
        errors.push(`Failed to block ${did}`);
      }

      // Rate limit: 350ms between operations
      await sleep(350);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${did}: ${errorMsg}`);
      console.error(`[ErgoBlock BG] Failed to block ${did}:`, error);
    }
  }

  console.log(`[ErgoBlock BG] Copy User blocks complete: ${succeeded} succeeded, ${failed} failed`);

  return { success: failed === 0, succeeded, failed, errors };
}

/**
 * Make a public API request (no auth needed) to the Bluesky public API
 */
async function bgApiRequestPublic<T>(endpoint: string): Promise<T | null> {
  const BSKY_PUBLIC_API = 'https://public.api.bsky.app';
  try {
    const response = await fetch(`${BSKY_PUBLIC_API}/xrpc/${endpoint}`);
    if (!response.ok) {
      console.error(`[ErgoBlock BG] Public API request failed: ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(`[ErgoBlock BG] Public API request error:`, error);
    return null;
  }
}

// Async message handler for communication with content scripts and popup
// Using the async pattern which returns Promise<unknown> per webextension-polyfill types
const messageHandler = async (rawMessage: unknown): Promise<MessageResponse | undefined> => {
  const message = rawMessage as ExtensionMessage;
  console.log('[ErgoBlock BG] Received message:', message.type);

  if (message.type === 'TEMP_BLOCK_ADDED' || message.type === 'TEMP_MUTE_ADDED') {
    setupAlarm();
    return undefined;
  }

  if (message.type === 'SET_AUTH_TOKEN' && message.auth) {
    await browser.storage.local.set({ authToken: message.auth });
    return { success: true };
  }

  if (message.type === 'GET_AUTH_STATUS') {
    const auth = await getAuthToken();
    return { success: true, isAuthenticated: !!auth };
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

  if (message.type === 'FETCH_ALL_INTERACTIONS' && message.did && message.handle) {
    return await handleFetchAllInteractions(message.did, message.handle);
  }

  if (message.type === 'BLOCKLIST_AUDIT_SYNC') {
    return await performBlocklistAuditSync();
  }

  if (message.type === 'UNSUBSCRIBE_BLOCKLIST' && message.listUri) {
    return await handleUnsubscribeFromBlocklist(message.listUri as string);
  }

  // List Audit handlers
  if (message.type === 'FETCH_OWNED_LISTS') {
    return await handleFetchOwnedLists();
  }

  if (message.type === 'FETCH_LIST_MEMBERS_WITH_TIMESTAMPS' && message.listUri) {
    return await handleFetchListMembersWithTimestamps(message.listUri as string);
  }

  if (message.type === 'REMOVE_FROM_LIST' && message.rkey) {
    return await handleRemoveFromList(message.rkey as string);
  }

  if (message.type === 'FIND_INTERACTIONS_BEFORE' && message.targetDid && message.beforeTimestamp) {
    return await handleFindInteractionsBefore(
      message.targetDid as string,
      message.beforeTimestamp as number
    );
  }

  if (message.type === 'GET_FOLLOW_RELATIONSHIPS' && message.did) {
    return await handleGetFollowRelationships(message.did as string);
  }

  // Incremental social connection loading
  if (message.type === 'GET_FOLLOWS_WHO_FOLLOW_THEM' && message.did) {
    return await handleGetFollowsWhoFollowThem(message.did as string);
  }

  if (message.type === 'GET_FOLLOWERS_WHO_FOLLOW_THEM' && message.did) {
    return await handleGetFollowersWhoFollowThem(message.did as string);
  }

  if (message.type === 'GET_FOLLOWS_THEY_BLOCK' && message.did) {
    return await handleGetFollowsTheyBlock(message.did as string);
  }

  // Clearsky "follows who block them" handlers
  if (message.type === 'GET_FOLLOWS_WHO_BLOCK_THEM' && message.did) {
    return await handleGetFollowsWhoBlockThem(message.did as string);
  }

  if (message.type === 'GET_FOLLOWS_WHO_BLOCK_THEM_CACHED' && message.did) {
    return await handleGetFollowsWhoBlockThemCached(message.did as string);
  }

  if (message.type === 'PREWARM_CLEARSKY_CACHE' && message.targetDids) {
    return await handlePrewarmClearskyCache(message.targetDids as string[]);
  }

  // Lookahead prefetch for next amnesty candidates (high priority, immediate processing)
  if (message.type === 'PREFETCH_CLEARSKY_LOOKAHEAD' && message.targetDids) {
    const targetDids = message.targetDids as string[];
    // Queue with high priority (1) so these process before regular prewarm items
    const result = await prewarmBlockedByCache(targetDids, true);
    console.log(`[ErgoBlock BG] Lookahead prefetch: ${result.queued} queued, ${result.alreadyCached} cached`);
    // Process immediately in background
    if (result.queued > 0) {
      processBlockedByQueue(result.queued).catch((err) => {
        console.error('[ErgoBlock BG] Lookahead processing failed:', err);
      });
    }
    return { success: true, ...result };
  }

  // Mass Operations Detection handlers
  if (message.type === 'SCAN_MASS_OPS' && message.settings) {
    const forceRefresh = message.forceRefresh === true;
    return await handleScanMassOps(message.settings as MassOpsSettings, forceRefresh);
  }

  if (message.type === 'UNDO_MASS_OPERATIONS' && message.operations) {
    return await handleUndoMassOperations(message.operations as GraphOperation[]);
  }

  if (message.type === 'GET_MASS_OPS_SETTINGS') {
    const settings = await getMassOpsSettings();
    return { success: true, settings };
  }

  if (message.type === 'SET_MASS_OPS_SETTINGS' && message.settings) {
    await setMassOpsSettings(message.settings as MassOpsSettings);
    return { success: true };
  }

  // CAR cache status and size estimation
  if (message.type === 'CHECK_CAR_CACHE_STATUS') {
    try {
      const auth = await getAuthToken();
      if (!auth?.did || !auth?.pdsUrl) {
        return { success: false, error: 'Not authenticated' };
      }
      const status = await checkCarCacheStatus(auth.did, auth.pdsUrl);
      return { success: true, status };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  if (message.type === 'ESTIMATE_CAR_SIZE') {
    try {
      const auth = await getAuthToken();
      if (!auth?.did || !auth?.pdsUrl) {
        return { success: false, error: 'Not authenticated' };
      }
      const sizeBytes = await getCarFileSize(auth.did, auth.pdsUrl);
      return { success: true, sizeBytes };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  if (message.type === 'INVALIDATE_CAR_CACHE') {
    try {
      const auth = await getAuthToken();
      if (!auth?.did) {
        return { success: false, error: 'Not authenticated' };
      }
      await invalidateCarCache(auth.did);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ============================================================================
  // Profile fetching for UI components
  // ============================================================================

  if (message.type === 'GET_PROFILES_BATCHED' && message.dids) {
    try {
      const auth = await getAuthToken();
      if (!auth) {
        return { success: false, error: 'Not authenticated' };
      }
      const profiles = await fetchProfiles(
        message.dids as string[],
        auth.accessJwt,
        auth.pdsUrl
      );
      // Convert to Map-like object for JSON serialization
      const profileMap: Record<string, ProfileWithViewer> = {};
      for (const profile of profiles) {
        profileMap[profile.did] = profile;
      }
      return { success: true, profiles: profileMap };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ============================================================================
  // Copy User handlers
  // ============================================================================

  if (message.type === 'FETCH_COPY_USER_DATA' && message.handle) {
    return await handleFetchCopyUserData(message.handle as string);
  }

  if (message.type === 'EXECUTE_COPY_USER_FOLLOWS' && message.dids) {
    return await handleExecuteCopyUserFollows(message.dids as string[]);
  }

  if (message.type === 'EXECUTE_COPY_USER_BLOCKS' && message.dids) {
    return await handleExecuteCopyUserBlocks(message.dids as string[]);
  }

  return undefined;
};

browser.runtime.onMessage.addListener(messageHandler);

// Maximum time a sync should take (10 minutes) - if older, it's considered stale
const MAX_SYNC_DURATION_MS = 10 * 60 * 1000;

/**
 * Clear any stale sync state on startup
 * This handles the case where the extension was closed mid-sync
 * or the service worker was terminated during a sync operation
 */
async function clearStaleSyncState(): Promise<void> {
  // Clear in-memory locks (lost on worker restart)
  syncLockActive = false;
  blocklistAuditLockActive = false;
  followsSyncLockActive = false;
  clearskyQueueLockActive = false;

  // Clear main sync state
  const state = await getSyncState();
  if (state.syncInProgress) {
    // Check if the sync has been running too long (stale)
    const now = Date.now();
    const syncStartTime = state.lastBlockSync || state.lastMuteSync || 0;
    const syncAge = now - syncStartTime;

    if (syncAge > MAX_SYNC_DURATION_MS || syncStartTime === 0) {
      console.log(
        `[ErgoBlock BG] Clearing stale syncInProgress flag (age: ${Math.round(syncAge / 1000)}s)`
      );
      await updateSyncState({
        syncInProgress: false,
        lastError: 'Sync was interrupted (service worker restart)',
      });
    } else {
      // Sync might still be running from another context - just log it
      console.log(
        `[ErgoBlock BG] Sync in progress flag set (age: ${Math.round(syncAge / 1000)}s) - may be ongoing`
      );
    }
  }
}

/**
 * Clear old bloated storage data that was causing quota issues
 * This is a one-time migration to the lighter storage format
 */
async function clearBloatedStorageData(): Promise<void> {
  try {
    // Check if socialGraph exists and has data (it's the main culprit)
    const existingGraph = await getSocialGraph();
    if (existingGraph.follows.length > 0 || existingGraph.followers.length > 0) {
      console.log('[ErgoBlock BG] Clearing old bloated socialGraph storage...');
      await browser.storage.local.remove('socialGraph');
      console.log('[ErgoBlock BG] Old socialGraph cleared');
    }
  } catch (error) {
    console.error('[ErgoBlock BG] Error clearing bloated storage:', error);
  }
}

// Clear any stale badge from previous versions
browser.action.setBadgeText({ text: '' });

// Initialize on install/startup
browser.runtime.onInstalled.addListener(async () => {
  console.log('[ErgoBlock BG] Extension installed');
  clearStaleSyncState();
  await clearBloatedStorageData();

  setupAlarm();
  setupSyncAlarm();
  setupFollowsSyncAlarm();
  setupClearskyQueueAlarm();
  browser.action.setBadgeText({ text: '' });

  // Sync follows immediately after a short delay (for repost filter feature)
  setTimeout(() => syncFollowsOnly(), 5000);
});

browser.runtime.onStartup.addListener(async () => {
  console.log('[ErgoBlock BG] Extension started');
  clearStaleSyncState();
  await clearBloatedStorageData();

  setupAlarm();
  setupSyncAlarm();
  setupFollowsSyncAlarm();
  setupClearskyQueueAlarm();
  browser.action.setBadgeText({ text: '' });

  // Sync follows immediately after a short delay (for repost filter feature)
  setTimeout(() => syncFollowsOnly(), 5000);
});

// Also set up on script load (for when background restarts)
clearStaleSyncState();
clearBloatedStorageData();

setupAlarm();
setupSyncAlarm();
setupFollowsSyncAlarm();
setupClearskyQueueAlarm();

// Sync follows on script load after a short delay (for repost filter feature)
setTimeout(() => syncFollowsOnly(), 5000);
