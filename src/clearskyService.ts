/**
 * Clearsky Service
 *
 * Fetches "blocked-by" data from Clearsky API with caching.
 * Provides efficient lookup of "how many of my follows block person X".
 */

import {
  getBlockedByCache,
  saveBlockedByCache,
  queueForFetch,
  getPendingQueue,
  updateQueueStatus,
  type BlockedByData,
} from './clearskyCache.js';
import { sleep } from './utils.js';

const CLEARSKY_API_BASE = 'https://public.api.clearsky.services';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_DELAY_MS = 250; // Stay well under 5 req/sec limit
const MAX_RETRIES = 3;
const MAX_PAGES = 100; // Safety limit to avoid infinite loops

/**
 * Response from Clearsky blocklist endpoint
 */
interface ClearskyBlocklistResponse {
  data: {
    blocklist: Array<{
      did: string;
      blocked_date: string;
    }>;
    cursor?: string;
  };
  identity: string;
  status: boolean;
}

/**
 * Result of getFollowsWhoBlock
 */
export interface FollowsWhoBlockResult {
  /** Number of follows who block the target */
  count: number;
  /** DIDs of follows who block the target */
  dids: string[];
  /** Total number of accounts that block the target (from Clearsky) */
  totalBlockers: number;
  /** Whether this result came from cache */
  cached: boolean;
  /** When the data was fetched */
  fetchedAt: number;
}

// ============================================================================
// Core API Functions
// ============================================================================

/**
 * Fetch all accounts that block a target from Clearsky API
 * Handles pagination automatically
 */
export async function fetchBlockedByFromClearsky(
  targetDidOrHandle: string,
  onProgress?: (fetched: number) => void
): Promise<{ blockerDids: string[]; complete: boolean }> {
  const blockerDids: string[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  try {
    do {
      const url = cursor
        ? `${CLEARSKY_API_BASE}/api/v1/anon/blocklist?identifier=${encodeURIComponent(targetDidOrHandle)}&cursor=${encodeURIComponent(cursor)}`
        : `${CLEARSKY_API_BASE}/api/v1/anon/blocklist?identifier=${encodeURIComponent(targetDidOrHandle)}`;

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          // User not found in Clearsky - return empty
          console.log(`[Clearsky] User not found: ${targetDidOrHandle}`);
          return { blockerDids: [], complete: true };
        }
        if (response.status === 429) {
          // Rate limited - wait and retry once
          console.warn('[Clearsky] Rate limited, waiting 2s...');
          await sleep(2000);
          continue;
        }
        throw new Error(`Clearsky API error: ${response.status}`);
      }

      const data: ClearskyBlocklistResponse = await response.json();

      if (data.data?.blocklist) {
        for (const entry of data.data.blocklist) {
          blockerDids.push(entry.did);
        }
        onProgress?.(blockerDids.length);
      }

      cursor = data.data?.cursor;
      pageCount++;

      if (cursor) {
        await sleep(REQUEST_DELAY_MS);
      }
    } while (cursor && pageCount < MAX_PAGES);

    const complete = !cursor; // Complete if we didn't hit page limit
    console.log(
      `[Clearsky] Fetched ${blockerDids.length} blockers for ${targetDidOrHandle} (${pageCount} pages, complete: ${complete})`
    );

    return { blockerDids, complete };
  } catch (error) {
    console.error('[Clearsky] Failed to fetch blocked-by:', error);
    throw error;
  }
}

/**
 * Get cached blocked-by data, checking freshness
 */
async function getCachedBlockedBy(targetDid: string): Promise<BlockedByData | null> {
  const cached = await getBlockedByCache(targetDid);
  if (!cached) return null;

  // Check if cache is still fresh
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
    console.log(`[Clearsky] Cache expired for ${targetDid}`);
    return null;
  }

  return cached;
}

// ============================================================================
// Main Entry Points
// ============================================================================

/**
 * Get follows who block a target - cache-first with on-demand fallback
 *
 * @param targetDid - DID of the person to check
 * @param myFollowDids - Set of DIDs I follow (for intersection)
 * @param forceRefresh - Skip cache and fetch fresh data
 */
export async function getFollowsWhoBlock(
  targetDid: string,
  myFollowDids: Set<string>,
  forceRefresh = false
): Promise<FollowsWhoBlockResult> {
  // Try cache first (unless forcing refresh)
  if (!forceRefresh) {
    const cached = await getCachedBlockedBy(targetDid);
    if (cached) {
      const blockerSet = new Set(cached.blockerDids);
      const followsWhoBlock = [...myFollowDids].filter((did) => blockerSet.has(did));

      return {
        count: followsWhoBlock.length,
        dids: followsWhoBlock,
        totalBlockers: cached.totalCount,
        cached: true,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  // Cache miss or force refresh - fetch from Clearsky
  const { blockerDids, complete } = await fetchBlockedByFromClearsky(targetDid);

  // Save to cache
  const cacheEntry: BlockedByData = {
    targetDid,
    blockerDids,
    totalCount: blockerDids.length,
    fetchedAt: Date.now(),
    complete,
  };
  await saveBlockedByCache(cacheEntry);

  // Compute intersection with follows
  const blockerSet = new Set(blockerDids);
  const followsWhoBlock = [...myFollowDids].filter((did) => blockerSet.has(did));

  return {
    count: followsWhoBlock.length,
    dids: followsWhoBlock,
    totalBlockers: blockerDids.length,
    cached: false,
    fetchedAt: cacheEntry.fetchedAt,
  };
}

/**
 * Check if we have fresh cached data for a target
 */
export async function hasValidCache(targetDid: string): Promise<boolean> {
  const cached = await getCachedBlockedBy(targetDid);
  return cached !== null;
}

/**
 * Get cached result without fetching (returns null if no valid cache)
 */
export async function getFollowsWhoBlockCached(
  targetDid: string,
  myFollowDids: Set<string>
): Promise<FollowsWhoBlockResult | null> {
  const cached = await getCachedBlockedBy(targetDid);
  if (!cached) return null;

  const blockerSet = new Set(cached.blockerDids);
  const followsWhoBlock = [...myFollowDids].filter((did) => blockerSet.has(did));

  return {
    count: followsWhoBlock.length,
    dids: followsWhoBlock,
    totalBlockers: cached.totalCount,
    cached: true,
    fetchedAt: cached.fetchedAt,
  };
}

// ============================================================================
// Background Queue Processing
// ============================================================================

/**
 * Queue targets for background fetching
 * Higher priority = fetched sooner (lower number)
 */
export async function queueBlockedByFetch(
  targetDids: string[],
  priority = 10
): Promise<void> {
  for (const did of targetDids) {
    // Skip if we already have fresh cache
    const cached = await getCachedBlockedBy(did);
    if (cached) continue;

    await queueForFetch(did, priority);
  }
  console.log(`[Clearsky] Queued ${targetDids.length} targets for background fetch`);
}

/**
 * Process the background fetch queue
 * Call this periodically from background worker
 *
 * @param maxItems - Maximum items to process in this batch
 * @returns Number of items processed
 */
export async function processBlockedByQueue(maxItems = 5): Promise<number> {
  const pending = await getPendingQueue();
  const toProcess = pending.slice(0, maxItems);

  if (toProcess.length === 0) {
    return 0;
  }

  console.log(`[Clearsky] Processing ${toProcess.length} queued fetches`);
  let processed = 0;

  for (const entry of toProcess) {
    try {
      await updateQueueStatus(entry.targetDid, 'in_progress');

      // Check if we already have fresh cache (might have been fetched on-demand)
      const cached = await getCachedBlockedBy(entry.targetDid);
      if (cached) {
        await updateQueueStatus(entry.targetDid, 'completed');
        processed++;
        continue;
      }

      // Fetch from Clearsky
      const { blockerDids, complete } = await fetchBlockedByFromClearsky(entry.targetDid);

      // Save to cache
      await saveBlockedByCache({
        targetDid: entry.targetDid,
        blockerDids,
        totalCount: blockerDids.length,
        fetchedAt: Date.now(),
        complete,
      });

      await updateQueueStatus(entry.targetDid, 'completed');
      processed++;

      // Delay between fetches
      await sleep(REQUEST_DELAY_MS * 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Clearsky] Failed to fetch ${entry.targetDid}:`, errorMessage);

      if (entry.retryCount >= MAX_RETRIES) {
        await updateQueueStatus(entry.targetDid, 'failed', errorMessage);
      } else {
        await updateQueueStatus(entry.targetDid, 'pending', errorMessage);
      }
    }
  }

  return processed;
}

/**
 * Check if there are pending items in the queue
 */
export async function hasQueuedItems(): Promise<boolean> {
  const pending = await getPendingQueue();
  return pending.length > 0;
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Pre-warm cache for a list of targets (e.g., amnesty candidates)
 * Queues them for background fetch with appropriate priority
 */
export async function prewarmBlockedByCache(
  targetDids: string[],
  highPriority = false
): Promise<{ queued: number; alreadyCached: number }> {
  let queued = 0;
  let alreadyCached = 0;

  for (const did of targetDids) {
    const cached = await getCachedBlockedBy(did);
    if (cached) {
      alreadyCached++;
    } else {
      await queueForFetch(did, highPriority ? 1 : 10);
      queued++;
    }
  }

  console.log(
    `[Clearsky] Prewarm: ${queued} queued, ${alreadyCached} already cached`
  );

  return { queued, alreadyCached };
}

/**
 * Get blocked-by counts for multiple targets (using cache only)
 * Useful for displaying counts in a list without triggering API calls
 */
export async function getBatchBlockedByCounts(
  targetDids: string[],
  myFollowDids: Set<string>
): Promise<Map<string, { count: number; cached: boolean }>> {
  const results = new Map<string, { count: number; cached: boolean }>();

  for (const did of targetDids) {
    const cached = await getCachedBlockedBy(did);
    if (cached) {
      const blockerSet = new Set(cached.blockerDids);
      const count = [...myFollowDids].filter((d) => blockerSet.has(d)).length;
      results.set(did, { count, cached: true });
    } else {
      results.set(did, { count: -1, cached: false }); // -1 indicates no data
    }
  }

  return results;
}
