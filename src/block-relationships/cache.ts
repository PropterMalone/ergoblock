/**
 * Block Relationship Cache Management
 * Stores followed users' block lists in chrome.storage.local
 */

import browser from '../browser.js';
import type {
  BlockRelationshipCache,
  BlockRelationshipCacheV2,
  FollowBlockCache,
  FollowBlockCacheV2,
  FollowedUser,
  BlockRelationshipSyncStatus,
  GlobalBlocklistCache,
  CachedBlocklist,
} from '../types.js';

// Storage keys for block relationship data
export const BLOCK_REL_STORAGE_KEYS = {
  CACHE: 'blockRelationshipCache',
  CACHE_V2: 'blockRelationshipCacheV2',
  GLOBAL_BLOCKLISTS: 'globalBlocklistCache',
  SYNC_STATUS: 'blockRelationshipSyncStatus',
};

// Default empty cache
const EMPTY_CACHE: BlockRelationshipCache = {
  follows: [],
  followBlockLists: {},
  lastFullSync: 0,
  syncInProgress: false,
  syncErrors: [],
  totalFollows: 0,
  syncedFollows: 0,
};

// Default sync status
const EMPTY_SYNC_STATUS: BlockRelationshipSyncStatus = {
  lastSync: 0,
  isRunning: false,
  totalFollows: 0,
  syncedFollows: 0,
  errors: [],
};

/**
 * Get the block relationship cache from local storage
 */
export async function getBlockRelationshipCache(): Promise<BlockRelationshipCache> {
  try {
    const result = await browser.storage.local.get(BLOCK_REL_STORAGE_KEYS.CACHE);
    return (result[BLOCK_REL_STORAGE_KEYS.CACHE] as BlockRelationshipCache) || EMPTY_CACHE;
  } catch (error) {
    console.error('[ErgoBlock] Error getting block relationship cache:', error);
    return EMPTY_CACHE;
  }
}

/**
 * Set the entire block relationship cache
 */
export async function setBlockRelationshipCache(cache: BlockRelationshipCache): Promise<void> {
  try {
    await browser.storage.local.set({ [BLOCK_REL_STORAGE_KEYS.CACHE]: cache });
  } catch (error) {
    console.error('[ErgoBlock] Error setting block relationship cache:', error);
    throw error;
  }
}

/**
 * Update the follows list in the cache
 */
export async function updateFollows(follows: FollowedUser[]): Promise<void> {
  const cache = await getBlockRelationshipCache();
  cache.follows = follows;
  cache.totalFollows = follows.length;
  await setBlockRelationshipCache(cache);
}

// Target cache size threshold for auto-pruning (4MB to leave headroom)
const AUTO_PRUNE_THRESHOLD = 4 * 1024 * 1024;

/**
 * Update a single follow's block list in the cache
 * Includes auto-pruning if cache is getting too large
 *
 * @param did - User's DID
 * @param blocks - Block list
 * @param userInfo - Optional user info to store
 * @param repoRev - Optional AT Protocol repo revision for incremental sync
 */
export async function updateFollowBlockList(
  did: string,
  blocks: string[],
  userInfo?: Partial<FollowedUser>,
  repoRev?: string
): Promise<void> {
  const cache = await getBlockRelationshipCache();

  const existingEntry = cache.followBlockLists[did];

  cache.followBlockLists[did] = {
    did,
    handle: userInfo?.handle || existingEntry?.handle || '',
    displayName: userInfo?.displayName || existingEntry?.displayName,
    avatar: userInfo?.avatar || existingEntry?.avatar,
    pdsUrl: userInfo?.pdsUrl || existingEntry?.pdsUrl,
    blocks,
    lastSync: Date.now(),
    repoRev: repoRev || existingEntry?.repoRev,
  };

  // Update synced count
  cache.syncedFollows = Object.keys(cache.followBlockLists).length;

  // Check size and prune if needed before saving
  const estimatedSize = new Blob([JSON.stringify(cache)]).size;
  if (estimatedSize > AUTO_PRUNE_THRESHOLD) {
    // Prune oldest entries (excluding the one we just added)
    const entries = Object.entries(cache.followBlockLists)
      .filter(([d]) => d !== did)
      .sort(([, a], [, b]) => a.lastSync - b.lastSync);

    let currentSize = estimatedSize;
    let pruned = 0;

    for (const [oldDid] of entries) {
      if (currentSize <= AUTO_PRUNE_THRESHOLD * 0.8) break;
      delete cache.followBlockLists[oldDid];
      currentSize = new Blob([JSON.stringify(cache)]).size;
      pruned++;
    }

    if (pruned > 0) {
      cache.syncedFollows = Object.keys(cache.followBlockLists).length;
      console.log(`[ErgoBlock] Auto-pruned ${pruned} entries to stay under quota`);
    }
  }

  await setBlockRelationshipCache(cache);
}

/**
 * Remove a follow from the cache (when user unfollows someone)
 */
export async function removeFollowFromCache(did: string): Promise<void> {
  const cache = await getBlockRelationshipCache();

  // Remove from follows list
  cache.follows = cache.follows.filter((f) => f.did !== did);
  cache.totalFollows = cache.follows.length;

  // Remove their block list
  delete cache.followBlockLists[did];
  cache.syncedFollows = Object.keys(cache.followBlockLists).length;

  await setBlockRelationshipCache(cache);
}

/**
 * Get the current sync status
 */
export async function getBlockRelationshipSyncStatus(): Promise<BlockRelationshipSyncStatus> {
  try {
    const result = await browser.storage.local.get(BLOCK_REL_STORAGE_KEYS.SYNC_STATUS);
    return (
      (result[BLOCK_REL_STORAGE_KEYS.SYNC_STATUS] as BlockRelationshipSyncStatus) ||
      EMPTY_SYNC_STATUS
    );
  } catch (error) {
    console.error('[ErgoBlock] Error getting sync status:', error);
    return EMPTY_SYNC_STATUS;
  }
}

/**
 * Update sync status
 */
export async function updateBlockRelSyncStatus(
  update: Partial<BlockRelationshipSyncStatus>
): Promise<void> {
  try {
    const current = await getBlockRelationshipSyncStatus();
    await browser.storage.local.set({
      [BLOCK_REL_STORAGE_KEYS.SYNC_STATUS]: { ...current, ...update },
    });
  } catch (error) {
    console.error('[ErgoBlock] Error updating sync status:', error);
  }
}

/**
 * Set sync as started
 */
export async function startSync(totalFollows: number): Promise<void> {
  await updateBlockRelSyncStatus({
    isRunning: true,
    totalFollows,
    syncedFollows: 0,
    errors: [],
    currentUser: undefined,
  });

  const cache = await getBlockRelationshipCache();
  cache.syncInProgress = true;
  cache.totalFollows = totalFollows;
  cache.syncErrors = [];
  await setBlockRelationshipCache(cache);
}

/**
 * Set sync as completed
 */
export async function finishSync(errors: string[] = []): Promise<void> {
  const cache = await getBlockRelationshipCache();
  cache.syncInProgress = false;
  cache.lastFullSync = Date.now();
  cache.syncErrors = errors;
  await setBlockRelationshipCache(cache);

  await updateBlockRelSyncStatus({
    isRunning: false,
    lastSync: Date.now(),
    errors,
    currentUser: undefined,
  });
}

/**
 * Update sync progress
 */
export async function updateSyncProgress(syncedCount: number, currentUser?: string): Promise<void> {
  const cache = await getBlockRelationshipCache();
  cache.syncedFollows = syncedCount;
  await setBlockRelationshipCache(cache);

  await updateBlockRelSyncStatus({
    syncedFollows: syncedCount,
    currentUser,
  });
}

/**
 * Add an error to the sync errors
 */
export async function addSyncError(error: string): Promise<void> {
  const cache = await getBlockRelationshipCache();
  cache.syncErrors.push(error);
  await setBlockRelationshipCache(cache);

  const status = await getBlockRelationshipSyncStatus();
  await updateBlockRelSyncStatus({
    errors: [...status.errors, error],
  });
}

/**
 * Get estimated cache size in bytes
 */
export async function getCacheSize(): Promise<number> {
  const cache = await getBlockRelationshipCache();
  return new Blob([JSON.stringify(cache)]).size;
}

/**
 * Prune the cache to fit within size limit using LRU strategy
 * Removes the oldest-synced entries first
 */
export async function pruneCache(maxSizeBytes: number): Promise<number> {
  const cache = await getBlockRelationshipCache();
  let currentSize = new Blob([JSON.stringify(cache)]).size;

  if (currentSize <= maxSizeBytes) {
    return 0; // No pruning needed
  }

  // Get all block lists sorted by lastSync (oldest first)
  const entries = Object.entries(cache.followBlockLists).sort(
    ([, a], [, b]) => a.lastSync - b.lastSync
  );

  let prunedCount = 0;

  // Remove oldest entries until we're under the limit
  for (const [did] of entries) {
    if (currentSize <= maxSizeBytes * 0.9) {
      // Target 90% of max to avoid frequent pruning
      break;
    }

    delete cache.followBlockLists[did];
    prunedCount++;

    // Recalculate size
    currentSize = new Blob([JSON.stringify(cache)]).size;
  }

  if (prunedCount > 0) {
    cache.syncedFollows = Object.keys(cache.followBlockLists).length;
    await setBlockRelationshipCache(cache);
    console.log(`[ErgoBlock] Pruned ${prunedCount} entries from block relationship cache`);
  }

  return prunedCount;
}

/**
 * Clear the entire block relationship cache
 */
export async function clearBlockRelationshipCache(): Promise<void> {
  await browser.storage.local.remove([
    BLOCK_REL_STORAGE_KEYS.CACHE,
    BLOCK_REL_STORAGE_KEYS.SYNC_STATUS,
  ]);
  console.log('[ErgoBlock] Block relationship cache cleared');
}

/**
 * Get a specific follow's cached block list
 */
export async function getFollowBlockList(did: string): Promise<FollowBlockCache | null> {
  const cache = await getBlockRelationshipCache();
  return cache.followBlockLists[did] || null;
}

/**
 * Check if a follow's block list is stale (needs re-sync)
 * @param did - DID of the followed user
 * @param maxAgeMs - Maximum age in milliseconds before considered stale
 */
export async function isBlockListStale(did: string, maxAgeMs: number): Promise<boolean> {
  const entry = await getFollowBlockList(did);
  if (!entry) return true;
  return Date.now() - entry.lastSync > maxAgeMs;
}

// ============================================================================
// V2 Cache Functions (with blocklist deduplication)
// ============================================================================

// Default empty V2 cache
const EMPTY_CACHE_V2: BlockRelationshipCacheV2 = {
  version: 2,
  follows: [],
  followBlockLists: {},
  lastFullSync: 0,
  syncInProgress: false,
  syncErrors: [],
  totalFollows: 0,
  syncedFollows: 0,
};

// Default empty global blocklist cache
const EMPTY_GLOBAL_BLOCKLIST_CACHE: GlobalBlocklistCache = {
  lists: {},
  lastPruned: 0,
};

/**
 * Get the V2 block relationship cache from local storage
 */
export async function getBlockRelationshipCacheV2(): Promise<BlockRelationshipCacheV2> {
  try {
    const result = await browser.storage.local.get(BLOCK_REL_STORAGE_KEYS.CACHE_V2);
    return (result[BLOCK_REL_STORAGE_KEYS.CACHE_V2] as BlockRelationshipCacheV2) || EMPTY_CACHE_V2;
  } catch (error) {
    console.error('[ErgoBlock] Error getting V2 block relationship cache:', error);
    return EMPTY_CACHE_V2;
  }
}

/**
 * Set the entire V2 block relationship cache
 */
export async function setBlockRelationshipCacheV2(cache: BlockRelationshipCacheV2): Promise<void> {
  try {
    await browser.storage.local.set({ [BLOCK_REL_STORAGE_KEYS.CACHE_V2]: cache });
  } catch (error) {
    console.error('[ErgoBlock] Error setting V2 block relationship cache:', error);
    throw error;
  }
}

/**
 * Update the follows list in the V2 cache
 */
export async function updateFollowsV2(follows: FollowedUser[]): Promise<void> {
  const cache = await getBlockRelationshipCacheV2();
  cache.follows = follows;
  cache.totalFollows = follows.length;
  await setBlockRelationshipCacheV2(cache);
}

/**
 * Update a single follow's block data in the V2 cache
 * Separates direct blocks from list subscriptions
 *
 * @param did - User's DID
 * @param directBlocks - DIDs explicitly blocked by this user
 * @param subscribedLists - List URIs this user subscribes to
 * @param userInfo - Optional user info to store
 * @param repoRev - Optional AT Protocol repo revision for incremental sync
 */
export async function updateFollowBlockListV2(
  did: string,
  directBlocks: string[],
  subscribedLists: string[],
  userInfo?: Partial<FollowedUser>,
  repoRev?: string
): Promise<void> {
  const cache = await getBlockRelationshipCacheV2();

  const existingEntry = cache.followBlockLists[did];

  cache.followBlockLists[did] = {
    did,
    handle: userInfo?.handle || existingEntry?.handle || '',
    displayName: userInfo?.displayName || existingEntry?.displayName,
    avatar: userInfo?.avatar || existingEntry?.avatar,
    pdsUrl: userInfo?.pdsUrl || existingEntry?.pdsUrl,
    directBlocks,
    subscribedLists,
    lastSync: Date.now(),
    repoRev: repoRev || existingEntry?.repoRev,
  };

  // Update synced count
  cache.syncedFollows = Object.keys(cache.followBlockLists).length;

  // Check size and prune if needed before saving
  const estimatedSize = new Blob([JSON.stringify(cache)]).size;
  if (estimatedSize > AUTO_PRUNE_THRESHOLD) {
    // Prune oldest entries (excluding the one we just added)
    const entries = Object.entries(cache.followBlockLists)
      .filter(([d]) => d !== did)
      .sort(([, a], [, b]) => a.lastSync - b.lastSync);

    let currentSize = estimatedSize;
    let pruned = 0;

    for (const [oldDid] of entries) {
      if (currentSize <= AUTO_PRUNE_THRESHOLD * 0.8) break;
      delete cache.followBlockLists[oldDid];
      currentSize = new Blob([JSON.stringify(cache)]).size;
      pruned++;
    }

    if (pruned > 0) {
      cache.syncedFollows = Object.keys(cache.followBlockLists).length;
      console.log(`[ErgoBlock] Auto-pruned ${pruned} V2 entries to stay under quota`);
    }
  }

  await setBlockRelationshipCacheV2(cache);
}

/**
 * Get a specific follow's V2 cached block data
 */
export async function getFollowBlockListV2(did: string): Promise<FollowBlockCacheV2 | null> {
  const cache = await getBlockRelationshipCacheV2();
  return cache.followBlockLists[did] || null;
}

// ============================================================================
// Global Blocklist Cache Functions
// ============================================================================

/**
 * Get the global blocklist cache from local storage
 */
export async function getGlobalBlocklistCache(): Promise<GlobalBlocklistCache> {
  try {
    const result = await browser.storage.local.get(BLOCK_REL_STORAGE_KEYS.GLOBAL_BLOCKLISTS);
    return (
      (result[BLOCK_REL_STORAGE_KEYS.GLOBAL_BLOCKLISTS] as GlobalBlocklistCache) ||
      EMPTY_GLOBAL_BLOCKLIST_CACHE
    );
  } catch (error) {
    console.error('[ErgoBlock] Error getting global blocklist cache:', error);
    return EMPTY_GLOBAL_BLOCKLIST_CACHE;
  }
}

/**
 * Set the entire global blocklist cache
 */
export async function setGlobalBlocklistCache(cache: GlobalBlocklistCache): Promise<void> {
  try {
    await browser.storage.local.set({ [BLOCK_REL_STORAGE_KEYS.GLOBAL_BLOCKLISTS]: cache });
  } catch (error) {
    console.error('[ErgoBlock] Error setting global blocklist cache:', error);
    throw error;
  }
}

/**
 * Get a specific blocklist from the global cache
 */
export async function getBlocklist(uri: string): Promise<CachedBlocklist | null> {
  const cache = await getGlobalBlocklistCache();
  return cache.lists[uri] || null;
}

/**
 * Update a blocklist in the global cache
 */
export async function updateBlocklist(uri: string, data: CachedBlocklist): Promise<void> {
  const cache = await getGlobalBlocklistCache();
  cache.lists[uri] = data;
  await setGlobalBlocklistCache(cache);
}

/**
 * Check if a blocklist is stale (needs re-sync)
 */
export async function isBlocklistStale(uri: string, maxAgeMs: number): Promise<boolean> {
  const list = await getBlocklist(uri);
  if (!list) return true;
  return Date.now() - list.lastSync > maxAgeMs;
}

/**
 * Get multiple blocklists from the global cache
 */
export async function getBlocklists(uris: string[]): Promise<Record<string, CachedBlocklist>> {
  const cache = await getGlobalBlocklistCache();
  const result: Record<string, CachedBlocklist> = {};
  for (const uri of uris) {
    if (cache.lists[uri]) {
      result[uri] = cache.lists[uri];
    }
  }
  return result;
}

/**
 * Prune orphaned blocklists not referenced by any follow
 */
export async function pruneOrphanedBlocklists(): Promise<number> {
  const [v2Cache, blocklistCache] = await Promise.all([
    getBlockRelationshipCacheV2(),
    getGlobalBlocklistCache(),
  ]);

  // Collect all referenced list URIs
  const referencedUris = new Set<string>();
  for (const follow of Object.values(v2Cache.followBlockLists)) {
    for (const uri of follow.subscribedLists) {
      referencedUris.add(uri);
    }
  }

  // Find orphaned lists
  const orphanedUris = Object.keys(blocklistCache.lists).filter((uri) => !referencedUris.has(uri));

  if (orphanedUris.length === 0) {
    return 0;
  }

  // Remove orphaned lists
  for (const uri of orphanedUris) {
    delete blocklistCache.lists[uri];
  }

  blocklistCache.lastPruned = Date.now();
  await setGlobalBlocklistCache(blocklistCache);

  console.log(`[ErgoBlock] Pruned ${orphanedUris.length} orphaned blocklists`);
  return orphanedUris.length;
}

/**
 * Prune global blocklist cache to fit within size limit
 * Uses LRU strategy - removes oldest-synced lists first
 */
export async function pruneGlobalBlocklistCache(maxSizeBytes: number): Promise<number> {
  const cache = await getGlobalBlocklistCache();
  let currentSize = new Blob([JSON.stringify(cache)]).size;

  if (currentSize <= maxSizeBytes) {
    return 0;
  }

  // Sort by lastSync (oldest first)
  const entries = Object.entries(cache.lists).sort(([, a], [, b]) => a.lastSync - b.lastSync);

  let prunedCount = 0;

  for (const [uri] of entries) {
    if (currentSize <= maxSizeBytes * 0.9) {
      break;
    }

    delete cache.lists[uri];
    prunedCount++;
    currentSize = new Blob([JSON.stringify(cache)]).size;
  }

  if (prunedCount > 0) {
    cache.lastPruned = Date.now();
    await setGlobalBlocklistCache(cache);
    console.log(`[ErgoBlock] Pruned ${prunedCount} blocklists from global cache`);
  }

  return prunedCount;
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Check if cache is V1 (old format) or V2 (new format)
 */
export function getCacheVersion(cache: BlockRelationshipCache | BlockRelationshipCacheV2): 1 | 2 {
  return 'version' in cache && cache.version === 2 ? 2 : 1;
}

/**
 * Check if V2 cache exists and has data
 */
export async function hasV2Cache(): Promise<boolean> {
  const cache = await getBlockRelationshipCacheV2();
  return cache.lastFullSync > 0 || Object.keys(cache.followBlockLists).length > 0;
}

/**
 * Migrate from V1 cache format to V2
 * Converts old blocks[] to directBlocks[], sets subscribedLists to empty
 * (will be populated on next sync)
 */
export async function migrateToV2Cache(): Promise<boolean> {
  // Check if we already have V2 data
  if (await hasV2Cache()) {
    console.log('[ErgoBlock] V2 cache already exists, skipping migration');
    return false;
  }

  const oldCache = await getBlockRelationshipCache();

  // If no V1 data, nothing to migrate
  if (oldCache.lastFullSync === 0 && Object.keys(oldCache.followBlockLists).length === 0) {
    console.log('[ErgoBlock] No V1 cache data to migrate');
    return false;
  }

  console.log('[ErgoBlock] Migrating V1 cache to V2 format...');

  const newCache: BlockRelationshipCacheV2 = {
    version: 2,
    follows: oldCache.follows,
    followBlockLists: {},
    lastFullSync: oldCache.lastFullSync,
    syncInProgress: false,
    syncErrors: [],
    totalFollows: oldCache.totalFollows,
    syncedFollows: 0, // Will need re-sync to properly categorize
  };

  // Convert each follow's block list
  for (const [did, entry] of Object.entries(oldCache.followBlockLists)) {
    newCache.followBlockLists[did] = {
      did: entry.did,
      handle: entry.handle,
      displayName: entry.displayName,
      avatar: entry.avatar,
      pdsUrl: entry.pdsUrl,
      directBlocks: entry.blocks, // Treat all as direct blocks initially
      subscribedLists: [], // Will be populated on next sync
      lastSync: entry.lastSync,
      repoRev: entry.repoRev,
    };
  }

  newCache.syncedFollows = Object.keys(newCache.followBlockLists).length;

  await setBlockRelationshipCacheV2(newCache);
  console.log(
    `[ErgoBlock] Migrated ${newCache.syncedFollows} entries to V2 format. Full re-sync recommended.`
  );

  return true;
}

/**
 * Clear all V2 caches (for testing/reset)
 */
export async function clearV2Caches(): Promise<void> {
  await browser.storage.local.remove([
    BLOCK_REL_STORAGE_KEYS.CACHE_V2,
    BLOCK_REL_STORAGE_KEYS.GLOBAL_BLOCKLISTS,
  ]);
  console.log('[ErgoBlock] V2 caches cleared');
}
