/**
 * Block Relationship Sync Service
 * Handles background sync of followed users' block lists
 */

import type { BskySession, FollowedUser, ProfileView } from '../types.js';
import {
  getBlockRelationshipCache,
  getBlockRelationshipCacheV2,
  updateFollows,
  updateFollowsV2,
  updateFollowBlockList,
  updateFollowBlockListV2,
  startSync,
  finishSync,
  updateSyncProgress,
  updateBlockRelSyncStatus,
  addSyncError,
  pruneCache,
  getBlockRelationshipSyncStatus,
  getFollowBlockList,
  pruneOrphanedBlocklists,
  updateBlocklist,
  getGlobalBlocklistCache,
} from './cache.js';
import { getOptions } from '../storage.js';
import {
  fetchBlocksFromCar,
  fetchBlocksFromCarIncremental,
  getLatestCommit,
  fetchListsFromCar,
} from '../carRepo.js';
import { sleep } from '../utils.js';

// PLC directory for DID resolution
const PLC_DIRECTORY = 'https://plc.directory';
// Default PDS
const BSKY_PDS_DEFAULT = 'https://bsky.social';
// Public API for getting follows
const BSKY_PUBLIC_API = 'https://public.api.bsky.app';

// Rate limiting constants
const MAX_CONCURRENT_REQUESTS = 5;
const BATCH_DELAY_MS = 500;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const FETCH_TIMEOUT_MS = 10000; // 10 second timeout per request
// If a user has more than this many blocks via API, switch to CAR
const API_BLOCK_THRESHOLD = 500;
// Absolute cap for any source (to avoid storing massive lists)
const MAX_BLOCKS_PER_USER = 10000;

// In-memory PDS cache to avoid repeated lookups
const pdsCache = new Map<string, string>();

/**
 * Populate PDS cache from stored data
 */
export function populatePdsCache(entries: Array<{ did: string; pdsUrl?: string }>): void {
  for (const entry of entries) {
    if (entry.pdsUrl) {
      pdsCache.set(entry.did, entry.pdsUrl);
    }
  }
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch with retry and exponential backoff
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
  backoff = INITIAL_BACKOFF_MS
): Promise<Response> {
  try {
    const response = await fetchWithTimeout(url, options);
    if (response.status === 429 && retries > 0) {
      console.log(`[ErgoBlock] Rate limited, retrying in ${backoff}ms...`);
      await sleep(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`[ErgoBlock] Fetch failed (${errorMsg}), retrying in ${backoff}ms...`);
      await sleep(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
}

/**
 * Resolve a DID to its PDS URL via PLC directory
 */
export async function resolvePds(did: string): Promise<string | null> {
  try {
    if (!did.startsWith('did:plc:')) {
      return null;
    }

    // Check cache first
    const cached = pdsCache.get(did);
    if (cached) {
      return cached;
    }

    const response = await fetchWithRetry(`${PLC_DIRECTORY}/${did}`);
    if (!response.ok) return null;

    const doc = (await response.json()) as {
      service?: Array<{ id: string; serviceEndpoint: string }>;
    };
    const pds = doc.service?.find((s) => s.id === '#atproto_pds');
    const pdsUrl = pds?.serviceEndpoint || null;

    // Cache the result
    if (pdsUrl) {
      pdsCache.set(did, pdsUrl);
    }

    return pdsUrl;
  } catch {
    return null;
  }
}

/**
 * Get block list via API (fast for small lists)
 * Returns null if list exceeds threshold, signaling to use CAR instead
 */
async function getUserBlocksViaApi(did: string, pds: string): Promise<string[] | null> {
  const blocks: string[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: did,
      collection: 'app.bsky.graph.block',
      limit: '100',
    });
    if (cursor) params.set('cursor', cursor);

    const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      // User may have blocks hidden, PDS issue, or no blocks - return what we have
      return blocks;
    }

    const data = (await response.json()) as {
      records?: Array<{ value?: { subject?: string } }>;
      cursor?: string;
    };

    for (const record of data.records || []) {
      if (record.value?.subject) {
        blocks.push(record.value.subject);
      }
    }

    // If exceeds threshold, signal to use CAR instead
    if (blocks.length >= API_BLOCK_THRESHOLD && data.cursor) {
      console.log(`[ErgoBlock] ${did} has ${blocks.length}+ blocks, switching to CAR`);
      return null;
    }

    cursor = data.cursor;
  } while (cursor);

  return blocks;
}

/**
 * Get block list for any user (PUBLIC - no auth required)
 * Uses hybrid approach: API for small lists, CAR for heavy blockers
 */
export async function getUserBlocks(did: string, pdsUrl?: string): Promise<string[]> {
  // Resolve PDS if not provided
  let pds: string | null | undefined = pdsUrl;
  if (!pds) {
    pds = await resolvePds(did);
  }
  if (!pds) {
    pds = BSKY_PDS_DEFAULT;
  }

  // Normalize PDS URL
  pds = pds.replace(/\/+$/, '');

  // Try API first (fast for most users)
  const apiBlocks = await getUserBlocksViaApi(did, pds);

  if (apiBlocks !== null) {
    return apiBlocks;
  }

  // Heavy blocker - use CAR for complete list
  try {
    const carBlocks = await fetchBlocksFromCar(did, pds);
    // Apply absolute cap
    if (carBlocks.length > MAX_BLOCKS_PER_USER) {
      console.log(`[ErgoBlock] CAR block list capped at ${MAX_BLOCKS_PER_USER} for ${did}`);
      return carBlocks.slice(0, MAX_BLOCKS_PER_USER);
    }
    return carBlocks;
  } catch (error) {
    console.warn(`[ErgoBlock] CAR fetch failed for ${did}, using partial API data:`, error);
    // Fall back to re-fetching via API with a higher limit
    const fallbackBlocks: string[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        repo: did,
        collection: 'app.bsky.graph.block',
        limit: '100',
      });
      if (cursor) params.set('cursor', cursor);

      const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;
      const response = await fetchWithRetry(url);
      if (!response.ok) break;

      const data = (await response.json()) as {
        records?: Array<{ value?: { subject?: string } }>;
        cursor?: string;
      };

      for (const record of data.records || []) {
        if (record.value?.subject) {
          fallbackBlocks.push(record.value.subject);
        }
      }

      if (fallbackBlocks.length >= MAX_BLOCKS_PER_USER) break;
      cursor = data.cursor;
    } while (cursor);

    return fallbackBlocks;
  }
}

/**
 * Result of incremental block sync
 */
export interface IncrementalSyncResult {
  blocks: string[];
  rev?: string;
  skipped: boolean; // true if we skipped download (repo unchanged)
  usedCar: boolean; // true if CAR download was used (needs longer timeout)
}

/**
 * Get block list with incremental sync support
 * Checks repo revision before downloading to save bandwidth
 *
 * @param did - User's DID
 * @param pdsUrl - User's PDS URL (optional)
 * @returns Block list, new revision (if available), and whether download was skipped
 */
export async function getUserBlocksIncremental(
  did: string,
  pdsUrl?: string
): Promise<IncrementalSyncResult> {
  // Resolve PDS if not provided
  let pds: string | null | undefined = pdsUrl;
  if (!pds) {
    pds = await resolvePds(did);
  }
  if (!pds) {
    pds = BSKY_PDS_DEFAULT;
  }

  // Normalize PDS URL
  pds = pds.replace(/\/+$/, '');

  // Get cached data for this user (if any)
  const cachedEntry = await getFollowBlockList(did);
  const cachedRev = cachedEntry?.repoRev;
  const cachedBlocks = cachedEntry?.blocks;

  // Step 1: Quick check if repo has changed (very lightweight)
  if (cachedRev && cachedBlocks) {
    const latestCommit = await getLatestCommit(did, pds);
    if (latestCommit && latestCommit.rev === cachedRev) {
      // Repo hasn't changed - skip download entirely
      console.log(`[ErgoBlock] Repo unchanged for ${did}, skipping sync`);
      return { blocks: cachedBlocks, rev: cachedRev, skipped: true, usedCar: false };
    }
  }

  // Step 2: Try API first (fast for most users with small block lists)
  const apiBlocks = await getUserBlocksViaApi(did, pds);

  if (apiBlocks !== null) {
    // API worked - we don't track rev for API-based syncs since they're cheap anyway
    return { blocks: apiBlocks, skipped: false, usedCar: false };
  }

  // Step 3: Heavy blocker - use incremental CAR sync
  try {
    const result = await fetchBlocksFromCarIncremental(did, pds, cachedRev, cachedBlocks);

    // Apply absolute cap
    let blocks = result.blocks;
    if (blocks.length > MAX_BLOCKS_PER_USER) {
      console.log(`[ErgoBlock] CAR block list capped at ${MAX_BLOCKS_PER_USER} for ${did}`);
      blocks = blocks.slice(0, MAX_BLOCKS_PER_USER);
    }

    return {
      blocks,
      rev: result.rev,
      skipped: result.wasIncremental && result.blocks === cachedBlocks,
      usedCar: true,
    };
  } catch (error) {
    console.warn(
      `[ErgoBlock] Incremental CAR fetch failed for ${did}, falling back to API:`,
      error
    );
    // Fall back to full API fetch
    const fallbackBlocks: string[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        repo: did,
        collection: 'app.bsky.graph.block',
        limit: '100',
      });
      if (cursor) params.set('cursor', cursor);

      const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;
      const response = await fetchWithRetry(url);
      if (!response.ok) break;

      const data = (await response.json()) as {
        records?: Array<{ value?: { subject?: string } }>;
        cursor?: string;
      };

      for (const record of data.records || []) {
        if (record.value?.subject) {
          fallbackBlocks.push(record.value.subject);
        }
      }

      if (fallbackBlocks.length >= MAX_BLOCKS_PER_USER) break;
      cursor = data.cursor;
    } while (cursor);

    return { blocks: fallbackBlocks, skipped: false, usedCar: false };
  }
}

/**
 * Fetch all follows for a user via public API
 */
async function fetchAllFollows(
  did: string,
  onProgress?: (page: number, fetched: number) => void
): Promise<FollowedUser[]> {
  const allFollows: FollowedUser[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const params = new URLSearchParams({
      actor: did,
      limit: '100',
    });
    if (cursor) params.set('cursor', cursor);

    const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.graph.getFollows?${params}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(`Failed to get follows: ${response.status}`);
    }

    const data = (await response.json()) as {
      follows: ProfileView[];
      cursor?: string;
    };

    for (const f of data.follows) {
      allFollows.push({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName,
        avatar: f.avatar,
      });
    }

    cursor = data.cursor;

    // Report progress
    if (onProgress) {
      onProgress(page, allFollows.length);
    }
  } while (cursor);

  return allFollows;
}

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

// Timeout for API-based syncs (users with <500 blocks)
const API_SYNC_TIMEOUT_MS = 30000;
// Timeout for CAR-based syncs (users with 500+ blocks, larger downloads)
const CAR_SYNC_TIMEOUT_MS = 90000;

/**
 * Sync statistics for reporting
 */
interface BatchStats {
  errors: string[];
  skipped: number;
  synced: number;
}

/**
 * Determine if a user is likely a heavy blocker based on cached data
 * Heavy blockers (500+ blocks) use CAR downloads which need longer timeouts
 */
async function isLikelyHeavyBlocker(did: string): Promise<boolean> {
  const cached = await getFollowBlockList(did);
  // If they have 500+ blocks cached, they'll likely use CAR again
  return cached !== null && cached.blocks.length >= API_BLOCK_THRESHOLD;
}

/**
 * Sync a single follow with appropriate timeout handling
 * First-time heavy blockers get a retry with extended timeout
 */
async function syncFollowWithTimeout(follow: FollowedUser): Promise<IncrementalSyncResult> {
  // Check if this is a known heavy blocker
  const isHeavyBlocker = await isLikelyHeavyBlocker(follow.did);

  if (isHeavyBlocker) {
    // Known heavy blocker - use CAR timeout directly
    return withTimeout(
      getUserBlocksIncremental(follow.did, follow.pdsUrl),
      CAR_SYNC_TIMEOUT_MS,
      follow.handle
    );
  }

  // Unknown user - try with API timeout first
  try {
    return await withTimeout(
      getUserBlocksIncremental(follow.did, follow.pdsUrl),
      API_SYNC_TIMEOUT_MS,
      follow.handle
    );
  } catch (error) {
    // If it timed out, retry with longer CAR timeout (might be first-time heavy blocker)
    const isTimeout = error instanceof Error && error.message.includes('Timeout');
    if (isTimeout) {
      console.log(
        `[ErgoBlock] ${follow.handle} timed out with API timeout, retrying with CAR timeout`
      );
      return withTimeout(
        getUserBlocksIncremental(follow.did, follow.pdsUrl),
        CAR_SYNC_TIMEOUT_MS,
        follow.handle
      );
    }
    throw error;
  }
}

/**
 * Process a batch of follows, fetching their block lists concurrently
 * Uses incremental sync to minimize bandwidth usage
 */
async function processBatch(
  follows: FollowedUser[],
  startIndex: number,
  onProgress: (syncedCount: number, currentUser?: string) => void
): Promise<BatchStats> {
  const stats: BatchStats = { errors: [], skipped: 0, synced: 0 };

  await Promise.all(
    follows.map(async (follow, i) => {
      try {
        onProgress(startIndex + i, follow.handle);

        const result = await syncFollowWithTimeout(follow);

        if (result.skipped) {
          stats.skipped++;
          // Still update lastSync timestamp to show the user was checked
          await updateFollowBlockList(
            follow.did,
            result.blocks,
            {
              handle: follow.handle,
              displayName: follow.displayName,
              avatar: follow.avatar,
              pdsUrl: pdsCache.get(follow.did),
            },
            result.rev
          );
        } else {
          stats.synced++;
          await updateFollowBlockList(
            follow.did,
            result.blocks,
            {
              handle: follow.handle,
              displayName: follow.displayName,
              avatar: follow.avatar,
              pdsUrl: pdsCache.get(follow.did),
            },
            result.rev
          );
        }
      } catch (error) {
        const message = `Failed to sync ${follow.handle}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[ErgoBlock] ${message}`);
        stats.errors.push(message);
      }
    })
  );

  return stats;
}

/**
 * Split array into chunks
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Main sync function - syncs all followed users' block lists
 * Returns true if sync ran, false if skipped (already in progress)
 */
export async function syncFollowBlockLists(auth: BskySession): Promise<boolean> {
  // Check if sync is already in progress
  const status = await getBlockRelationshipSyncStatus();
  if (status.isRunning) {
    console.log('[ErgoBlock] Block relationship sync already in progress');
    return false;
  }

  console.log('[ErgoBlock] Starting block relationship sync...');

  // Mark sync as running early so UI knows we're working
  await updateBlockRelSyncStatus({
    isRunning: true,
    syncedFollows: 0,
    errors: [],
    phase: 'fetching-follows',
    fetchingPage: 0,
    fetchedFollows: 0,
  });

  const allErrors: string[] = [];

  try {
    // Get user's follows with progress updates
    console.log('[ErgoBlock] Fetching follows list...');
    const follows = await fetchAllFollows(auth.did, async (page, fetched) => {
      await updateBlockRelSyncStatus({
        phase: 'fetching-follows',
        fetchingPage: page,
        fetchedFollows: fetched,
      });
    });
    console.log(`[ErgoBlock] Found ${follows.length} follows to sync`);

    // Update the follows list in cache
    await updateFollows(follows);

    // Switch to syncing-blocks phase
    await updateBlockRelSyncStatus({
      phase: 'syncing-blocks',
      fetchingPage: undefined,
      fetchedFollows: undefined,
    });

    // Start sync with total count
    await startSync(follows.length);

    // Populate PDS cache from existing data
    const cache = await getBlockRelationshipCache();
    populatePdsCache(
      Object.values(cache.followBlockLists).map((f) => ({
        did: f.did,
        pdsUrl: f.pdsUrl,
      }))
    );

    // Process in batches with rate limiting
    const batches = chunk(follows, MAX_CONCURRENT_REQUESTS);
    let syncedCount = 0;
    let totalSkipped = 0;
    let totalSynced = 0;

    for (const batch of batches) {
      const batchStats = await processBatch(batch, syncedCount, async (count, user) => {
        await updateSyncProgress(count, user);
      });

      allErrors.push(...batchStats.errors);
      totalSkipped += batchStats.skipped;
      totalSynced += batchStats.synced;
      syncedCount += batch.length;

      // Delay between batches
      if (syncedCount < follows.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    // Prune cache if needed
    const options = await getOptions();
    await pruneCache(options.blockRelationships.maxCacheSize);

    // Finish sync
    await finishSync(allErrors);

    console.log(
      `[ErgoBlock] Block relationship sync complete. ${follows.length} follows checked: ${totalSynced} downloaded, ${totalSkipped} skipped (unchanged), ${allErrors.length} errors`
    );
    return true;
  } catch (error) {
    const message = `Sync failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[ErgoBlock] ${message}`);
    await addSyncError(message);
    await finishSync([...allErrors, message]);
    throw error;
  }
}

/**
 * Sync a single user's block list
 * Uses incremental sync to save bandwidth when possible
 */
export async function syncSingleUserBlocks(
  did: string,
  userInfo?: Partial<FollowedUser>
): Promise<string[]> {
  try {
    const result = await getUserBlocksIncremental(did, userInfo?.pdsUrl);
    await updateFollowBlockList(did, result.blocks, userInfo, result.rev);
    return result.blocks;
  } catch (error) {
    console.error(
      `[ErgoBlock] Failed to sync blocks for ${did}:`,
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}

// ============================================================================
// V2 Sync Functions (API-only, no CAR downloads)
// ============================================================================

/**
 * Fetch a user's direct blocks via API (no CAR fallback)
 * Always paginates through all blocks, no threshold switching
 */
async function getUserDirectBlocksViaApi(did: string, pds: string): Promise<string[]> {
  const blocks: string[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: did,
      collection: 'app.bsky.graph.block',
      limit: '100',
    });
    if (cursor) params.set('cursor', cursor);

    const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      // User may have blocks hidden or no blocks
      return blocks;
    }

    const data = (await response.json()) as {
      records?: Array<{ value?: { subject?: string } }>;
      cursor?: string;
    };

    for (const record of data.records || []) {
      if (record.value?.subject) {
        blocks.push(record.value.subject);
      }
    }

    // Apply cap to avoid memory issues
    if (blocks.length >= MAX_BLOCKS_PER_USER) {
      console.log(`[ErgoBlock V2] Direct blocks capped at ${MAX_BLOCKS_PER_USER} for ${did}`);
      break;
    }

    cursor = data.cursor;
  } while (cursor);

  return blocks;
}

/**
 * Fetch a user's subscribed blocklists via API
 * Returns list URIs (not members - those are fetched separately)
 */
async function getUserSubscribedListsViaApi(did: string, pds: string): Promise<string[]> {
  const listUris: string[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: did,
      collection: 'app.bsky.graph.listblock',
      limit: '100',
    });
    if (cursor) params.set('cursor', cursor);

    const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      // User may not have any list subscriptions
      return listUris;
    }

    const data = (await response.json()) as {
      records?: Array<{ value?: { subject?: string } }>;
      cursor?: string;
    };

    for (const record of data.records || []) {
      if (record.value?.subject) {
        listUris.push(record.value.subject);
      }
    }

    cursor = data.cursor;
  } while (cursor);

  return listUris;
}

/**
 * Result of V2 sync for a single follow
 */
export interface V2SyncResult {
  directBlocks: string[];
  subscribedLists: string[];
  skipped: boolean;
}

/**
 * Fetch a user's direct blocks and subscribed lists (V2 - API only)
 */
export async function getUserBlockDataV2(did: string, pdsUrl?: string): Promise<V2SyncResult> {
  // Resolve PDS if not provided
  let pds: string | null | undefined = pdsUrl;
  if (!pds) {
    pds = await resolvePds(did);
  }
  if (!pds) {
    pds = BSKY_PDS_DEFAULT;
  }
  pds = pds.replace(/\/+$/, '');

  // Fetch direct blocks and subscribed lists in parallel
  const [directBlocks, subscribedLists] = await Promise.all([
    getUserDirectBlocksViaApi(did, pds),
    getUserSubscribedListsViaApi(did, pds),
  ]);

  return { directBlocks, subscribedLists, skipped: false };
}

/**
 * V2 batch statistics
 */
interface V2BatchStats {
  errors: string[];
  skipped: number;
  synced: number;
  allListUris: Set<string>;
}

/**
 * Process a batch of follows for V2 sync
 */
async function processBatchV2(
  follows: FollowedUser[],
  startIndex: number,
  onProgress: (syncedCount: number, currentUser?: string) => void
): Promise<V2BatchStats> {
  const stats: V2BatchStats = {
    errors: [],
    skipped: 0,
    synced: 0,
    allListUris: new Set(),
  };

  await Promise.all(
    follows.map(async (follow, i) => {
      try {
        onProgress(startIndex + i, follow.handle);

        const result = await withTimeout(
          getUserBlockDataV2(follow.did, follow.pdsUrl),
          API_SYNC_TIMEOUT_MS,
          follow.handle
        );

        // Collect list URIs for phase 2
        for (const uri of result.subscribedLists) {
          stats.allListUris.add(uri);
        }

        // Store the result
        await updateFollowBlockListV2(follow.did, result.directBlocks, result.subscribedLists, {
          handle: follow.handle,
          displayName: follow.displayName,
          avatar: follow.avatar,
          pdsUrl: pdsCache.get(follow.did),
        });

        stats.synced++;
      } catch (error) {
        const message = `Failed to sync ${follow.handle}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[ErgoBlock V2] ${message}`);
        stats.errors.push(message);
      }
    })
  );

  return stats;
}

/**
 * V2 Main sync function - API-only with blocklist deduplication
 * No CAR downloads, separates direct blocks from list subscriptions
 */
export async function syncFollowBlockListsV2(auth: BskySession): Promise<boolean> {
  // Check if sync is already in progress
  const status = await getBlockRelationshipSyncStatus();
  if (status.isRunning) {
    console.log('[ErgoBlock V2] Block relationship sync already in progress');
    return false;
  }

  console.log('[ErgoBlock V2] Starting block relationship sync (API-only mode)...');

  // Mark sync as running
  await updateBlockRelSyncStatus({
    isRunning: true,
    syncedFollows: 0,
    errors: [],
    phase: 'fetching-follows',
    fetchingPage: 0,
    fetchedFollows: 0,
  });

  const allErrors: string[] = [];
  const allListUris = new Set<string>();

  try {
    // Phase 1: Fetch follows list
    console.log('[ErgoBlock V2] Phase 1: Fetching follows list...');
    const follows = await fetchAllFollows(auth.did, async (page, fetched) => {
      await updateBlockRelSyncStatus({
        phase: 'fetching-follows',
        fetchingPage: page,
        fetchedFollows: fetched,
      });
    });
    console.log(`[ErgoBlock V2] Found ${follows.length} follows to sync`);

    // Update follows in V2 cache
    await updateFollowsV2(follows);

    // Switch to syncing-blocks phase
    await updateBlockRelSyncStatus({
      phase: 'syncing-blocks',
      fetchingPage: undefined,
      fetchedFollows: undefined,
    });

    await startSync(follows.length);

    // Populate PDS cache from existing V2 data
    const cache = await getBlockRelationshipCacheV2();
    populatePdsCache(
      Object.values(cache.followBlockLists).map((f) => ({
        did: f.did,
        pdsUrl: f.pdsUrl,
      }))
    );

    // Phase 2: Fetch direct blocks and list subscriptions for each follow
    console.log('[ErgoBlock V2] Phase 2: Fetching direct blocks and list subscriptions...');
    const batches = chunk(follows, MAX_CONCURRENT_REQUESTS);
    let syncedCount = 0;
    for (const batch of batches) {
      const batchStats = await processBatchV2(batch, syncedCount, async (count, user) => {
        await updateSyncProgress(count, user);
      });

      allErrors.push(...batchStats.errors);
      syncedCount += batch.length;

      // Collect list URIs
      for (const uri of batchStats.allListUris) {
        allListUris.add(uri);
      }

      if (syncedCount < follows.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    // Note: We don't fetch blocklist members during sync - only store the URIs.
    // Blocklist members are fetched on-demand during lookups.
    console.log(
      `[ErgoBlock V2] Found ${allListUris.size} unique blocklist subscriptions (will resolve on-demand)`
    );

    // Cleanup orphaned blocklists from previous syncs
    await pruneOrphanedBlocklists();

    // Finish sync
    await finishSync(allErrors);

    console.log(
      `[ErgoBlock V2] Sync complete. ${follows.length} follows, ${allListUris.size} unique blocklists, ${allErrors.length} errors`
    );
    return true;
  } catch (error) {
    const message = `V2 Sync failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[ErgoBlock V2] ${message}`);
    await addSyncError(message);
    await finishSync([...allErrors, message]);
    throw error;
  }
}

/**
 * Sync a single user's block data (V2)
 */
export async function syncSingleUserBlocksV2(
  did: string,
  userInfo?: Partial<FollowedUser>
): Promise<V2SyncResult> {
  try {
    const result = await getUserBlockDataV2(did, userInfo?.pdsUrl);
    await updateFollowBlockListV2(did, result.directBlocks, result.subscribedLists, userInfo);
    return result;
  } catch (error) {
    console.error(
      `[ErgoBlock V2] Failed to sync blocks for ${did}:`,
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}

// ============================================================================
// Deep Sync Functions (CAR-based blocklist member resolution)
// ============================================================================

/**
 * Extract creator DID from a list URI
 * List URI format: at://did:plc:xxx/app.bsky.graph.list/rkey
 */
function getListCreatorDid(listUri: string): string | null {
  const match = listUri.match(/^at:\/\/(did:[^/]+)\//);
  return match ? match[1] : null;
}

/**
 * Deep sync result statistics
 */
export interface DeepSyncResult {
  creatorsProcessed: number;
  listsResolved: number;
  totalMembers: number;
  errors: string[];
}

/**
 * Deep sync blocklist members via CAR downloads
 *
 * This fetches the CAR file for each unique list creator and extracts
 * the list members. More efficient than API calls when:
 * - Multiple lists share the same creator
 * - Lists have many members (CAR is one download vs many paginated API calls)
 *
 * @param onProgress - Optional progress callback (creatorIndex, totalCreators, currentDid)
 * @returns Statistics about the sync
 */
export async function deepSyncBlocklistMembers(
  onProgress?: (creatorIndex: number, totalCreators: number, currentDid?: string) => void
): Promise<DeepSyncResult> {
  const result: DeepSyncResult = {
    creatorsProcessed: 0,
    listsResolved: 0,
    totalMembers: 0,
    errors: [],
  };

  // Get all list URIs from the V2 cache
  const v2Cache = await getBlockRelationshipCacheV2();
  const allListUris = new Set<string>();

  for (const follow of Object.values(v2Cache.followBlockLists)) {
    for (const uri of follow.subscribedLists) {
      allListUris.add(uri);
    }
  }

  if (allListUris.size === 0) {
    console.log('[ErgoBlock DeepSync] No blocklist subscriptions to resolve');
    return result;
  }

  console.log(`[ErgoBlock DeepSync] Found ${allListUris.size} unique blocklist URIs`);

  // Group lists by creator DID
  const listsByCreator = new Map<string, Set<string>>();
  for (const uri of allListUris) {
    const creatorDid = getListCreatorDid(uri);
    if (creatorDid) {
      if (!listsByCreator.has(creatorDid)) {
        listsByCreator.set(creatorDid, new Set());
      }
      listsByCreator.get(creatorDid)!.add(uri);
    }
  }

  console.log(`[ErgoBlock DeepSync] Lists are from ${listsByCreator.size} unique creators`);

  // Process each creator
  const creators = Array.from(listsByCreator.entries());
  for (let i = 0; i < creators.length; i++) {
    const [creatorDid, listUris] = creators[i];

    onProgress?.(i, creators.length, creatorDid);
    console.log(
      `[ErgoBlock DeepSync] Processing creator ${i + 1}/${creators.length}: ${creatorDid} (${listUris.size} lists)`
    );

    try {
      // Resolve PDS for this creator
      const pds = await resolvePds(creatorDid);

      // Download CAR and parse lists
      const { lists } = await fetchListsFromCar(creatorDid, pds, listUris);

      // Store each list in the global cache
      for (const [uri, listData] of Object.entries(lists)) {
        await updateBlocklist(uri, {
          uri,
          name: listData.name,
          description: listData.description,
          creatorDid,
          creatorHandle: '', // We don't have handle from CAR, could resolve later
          members: listData.members,
          memberCount: listData.members.length,
          lastSync: Date.now(),
        });

        result.listsResolved++;
        result.totalMembers += listData.members.length;

        console.log(
          `[ErgoBlock DeepSync] Resolved list: ${listData.name} (${listData.members.length} members)`
        );
      }

      result.creatorsProcessed++;
    } catch (error) {
      const message = `Failed to process creator ${creatorDid}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[ErgoBlock DeepSync] ${message}`);
      result.errors.push(message);
    }

    // Rate limiting between creators
    if (i < creators.length - 1) {
      await sleep(500);
    }
  }

  console.log(
    `[ErgoBlock DeepSync] Complete. ${result.creatorsProcessed} creators, ${result.listsResolved} lists, ${result.totalMembers} total members, ${result.errors.length} errors`
  );

  return result;
}

/**
 * Get statistics about blocklist subscriptions for UI display
 */
export async function getBlocklistSubscriptionStats(): Promise<{
  uniqueLists: number;
  uniqueCreators: number;
  resolvedLists: number;
  unresolvedLists: number;
}> {
  const v2Cache = await getBlockRelationshipCacheV2();
  const globalCache = await getGlobalBlocklistCache();

  // Collect unique list URIs
  const allListUris = new Set<string>();
  const creatorDids = new Set<string>();

  for (const follow of Object.values(v2Cache.followBlockLists)) {
    for (const uri of follow.subscribedLists) {
      allListUris.add(uri);
      const creatorDid = getListCreatorDid(uri);
      if (creatorDid) {
        creatorDids.add(creatorDid);
      }
    }
  }

  // Count resolved vs unresolved
  let resolved = 0;
  for (const uri of allListUris) {
    if (globalCache.lists[uri]) {
      resolved++;
    }
  }

  return {
    uniqueLists: allListUris.size,
    uniqueCreators: creatorDids.size,
    resolvedLists: resolved,
    unresolvedLists: allListUris.size - resolved,
  };
}
