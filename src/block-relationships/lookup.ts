/**
 * Block Relationship Lookup
 * Query functions for finding block relationships between follows and profiles
 */

import type {
  BlockRelationshipCache,
  BlockRelationshipCacheV2,
  FollowedUser,
  ProfileBlockRelationships,
  GlobalBlocklistCache,
} from '../types.js';
import {
  getBlockRelationshipCache,
  getBlockRelationshipCacheV2,
  getGlobalBlocklistCache,
} from './cache.js';
import { getUserBlocks } from './sync.js';

/**
 * Get block relationships for a specific profile
 * Returns which of your follows block this profile, and which are blocked by this profile
 *
 * @param profileDid - DID of the profile to check
 * @param cache - Optional pre-fetched cache (to avoid redundant storage reads)
 */
export async function getBlockRelationshipsForProfile(
  profileDid: string,
  cache?: BlockRelationshipCache
): Promise<ProfileBlockRelationships> {
  const blockCache = cache || (await getBlockRelationshipCache());

  const blockedBy: FollowedUser[] = [];
  const blocking: FollowedUser[] = [];

  // Check each followed user's block list
  for (const [did, followData] of Object.entries(blockCache.followBlockLists)) {
    // Use Set for O(1) lookup on large block lists
    const blockSet = followData.blocks.length > 20 ? new Set(followData.blocks) : null;

    const isBlocking = blockSet ? blockSet.has(profileDid) : followData.blocks.includes(profileDid);

    if (isBlocking) {
      blockedBy.push({
        did,
        handle: followData.handle,
        displayName: followData.displayName,
        avatar: followData.avatar,
        pdsUrl: followData.pdsUrl,
        lastBlockSync: followData.lastSync,
      });
    }
  }

  // To find who the profile blocks among your follows, we would need to fetch
  // the profile's block list. This is done separately if needed.
  // For now, we only return "blockedBy" from cached data.

  return {
    blockedBy,
    blocking, // Empty for now - requires fetching the profile's block list
    lastChecked: Date.now(),
  };
}

/**
 * Get all follows who block a specific profile (from cache)
 * This is a convenience wrapper around getBlockRelationshipsForProfile
 */
export async function getBlockersAmongFollows(
  profileDid: string,
  cache?: BlockRelationshipCache
): Promise<FollowedUser[]> {
  const relationships = await getBlockRelationshipsForProfile(profileDid, cache);
  return relationships.blockedBy;
}

/**
 * Check if any of your follows block a specific profile
 */
export async function isBlockedByAnyFollow(
  profileDid: string,
  cache?: BlockRelationshipCache
): Promise<boolean> {
  const blockers = await getBlockersAmongFollows(profileDid, cache);
  return blockers.length > 0;
}

/**
 * Get count of follows who block a specific profile
 */
export async function getBlockerCount(
  profileDid: string,
  cache?: BlockRelationshipCache
): Promise<number> {
  const blockers = await getBlockersAmongFollows(profileDid, cache);
  return blockers.length;
}

/**
 * Get all profiles that a specific follow blocks (from cache)
 *
 * @param followDid - DID of the followed user
 * @returns Array of DIDs that the follow has blocked
 */
export async function getBlockedByFollow(
  followDid: string,
  cache?: BlockRelationshipCache
): Promise<string[]> {
  const blockCache = cache || (await getBlockRelationshipCache());
  const followData = blockCache.followBlockLists[followDid];
  return followData?.blocks || [];
}

/**
 * Find common blockers among multiple profiles
 * Useful for identifying patterns in blocking behavior
 *
 * @param profileDids - Array of profile DIDs to check
 * @returns Array of follows who block ALL of the specified profiles
 */
export async function findCommonBlockers(
  profileDids: string[],
  cache?: BlockRelationshipCache
): Promise<FollowedUser[]> {
  if (profileDids.length === 0) return [];

  const blockCache = cache || (await getBlockRelationshipCache());

  // Get blockers for each profile
  const blockerSets = await Promise.all(
    profileDids.map(async (did) => {
      const blockers = await getBlockersAmongFollows(did, blockCache);
      return new Set(blockers.map((b) => b.did));
    })
  );

  // Find intersection of all blocker sets
  const commonBlockerDids = blockerSets.reduce((intersection, currentSet) => {
    return new Set([...intersection].filter((did) => currentSet.has(did)));
  });

  // Return full FollowedUser objects for the common blockers
  const results: FollowedUser[] = [];
  for (const did of commonBlockerDids) {
    const followData = blockCache.followBlockLists[did];
    if (followData) {
      results.push({
        did,
        handle: followData.handle,
        displayName: followData.displayName,
        avatar: followData.avatar,
        pdsUrl: followData.pdsUrl,
        lastBlockSync: followData.lastSync,
      });
    }
  }
  return results;
}

/**
 * Search follows by handle or display name
 *
 * @param query - Search query (case-insensitive)
 * @param cache - Optional pre-fetched cache
 * @returns Matching follows with their block counts
 */
export async function searchFollows(
  query: string,
  cache?: BlockRelationshipCache
): Promise<Array<FollowedUser & { blockCount: number }>> {
  const blockCache = cache || (await getBlockRelationshipCache());
  const lowerQuery = query.toLowerCase();

  const results: Array<FollowedUser & { blockCount: number }> = [];

  for (const [did, followData] of Object.entries(blockCache.followBlockLists)) {
    const matchesHandle = followData.handle.toLowerCase().includes(lowerQuery);
    const matchesDisplayName = followData.displayName?.toLowerCase().includes(lowerQuery);

    if (matchesHandle || matchesDisplayName) {
      results.push({
        did,
        handle: followData.handle,
        displayName: followData.displayName,
        avatar: followData.avatar,
        pdsUrl: followData.pdsUrl,
        lastBlockSync: followData.lastSync,
        blockCount: followData.blocks.length,
      });
    }
  }

  // Sort by block count (descending)
  results.sort((a, b) => b.blockCount - a.blockCount);

  return results;
}

/**
 * Get statistics about the block relationship cache
 */
export async function getBlockRelationshipStats(cache?: BlockRelationshipCache): Promise<{
  totalFollows: number;
  syncedFollows: number;
  totalBlocksTracked: number;
  averageBlocksPerFollow: number;
  lastSync: number;
}> {
  const blockCache = cache || (await getBlockRelationshipCache());

  let totalBlocksTracked = 0;
  for (const followData of Object.values(blockCache.followBlockLists)) {
    totalBlocksTracked += followData.blocks.length;
  }

  const syncedCount = Object.keys(blockCache.followBlockLists).length;

  return {
    totalFollows: blockCache.totalFollows,
    syncedFollows: syncedCount,
    totalBlocksTracked,
    averageBlocksPerFollow: syncedCount > 0 ? Math.round(totalBlocksTracked / syncedCount) : 0,
    lastSync: blockCache.lastFullSync,
  };
}

// ============================================================================
// V2 Lookup Functions (with blocklist resolution)
// ============================================================================

/**
 * Get effective blocks for a follow (direct blocks + blocks from subscribed lists)
 * Computed on-demand from cached data
 *
 * @param followDid - DID of the followed user
 * @param v2Cache - Optional pre-fetched V2 cache
 * @param blocklistCache - Optional pre-fetched global blocklist cache
 * @returns All DIDs effectively blocked by this follow
 */
export async function getEffectiveBlocksForFollow(
  followDid: string,
  v2Cache?: BlockRelationshipCacheV2,
  blocklistCache?: GlobalBlocklistCache
): Promise<string[]> {
  const cache = v2Cache || (await getBlockRelationshipCacheV2());
  const globalCache = blocklistCache || (await getGlobalBlocklistCache());

  const followData = cache.followBlockLists[followDid];
  if (!followData) {
    return [];
  }

  // Start with direct blocks
  const effectiveBlocks = new Set(followData.directBlocks);

  // Add blocks from subscribed lists
  for (const listUri of followData.subscribedLists) {
    const list = globalCache.lists[listUri];
    if (list) {
      for (const member of list.members) {
        effectiveBlocks.add(member);
      }
    }
  }

  return Array.from(effectiveBlocks);
}

/**
 * Get block relationships for a profile using V2 cache
 * Returns both directions:
 * - blockedBy: which of your follows block this profile
 * - blocking: which of your follows this profile blocks
 */
export async function getBlockRelationshipsForProfileV2(
  profileDid: string,
  v2Cache?: BlockRelationshipCacheV2,
  _blocklistCache?: GlobalBlocklistCache
): Promise<ProfileBlockRelationships> {
  const cache = v2Cache || (await getBlockRelationshipCacheV2());

  const blockedBy: FollowedUser[] = [];
  const blocking: FollowedUser[] = [];

  // Build a map of follow DIDs to their info for quick lookup
  const followsMap = new Map<string, FollowedUser>();
  for (const [did, followData] of Object.entries(cache.followBlockLists)) {
    followsMap.set(did, {
      did,
      handle: followData.handle,
      displayName: followData.displayName,
      avatar: followData.avatar,
      pdsUrl: followData.pdsUrl,
      lastBlockSync: followData.lastSync,
    });
  }

  // Check each followed user's direct blocks to find who blocks this profile
  for (const [did, followData] of Object.entries(cache.followBlockLists)) {
    const directBlockSet =
      followData.directBlocks.length > 20 ? new Set(followData.directBlocks) : null;

    const isBlocking = directBlockSet
      ? directBlockSet.has(profileDid)
      : followData.directBlocks.includes(profileDid);

    if (isBlocking) {
      blockedBy.push(followsMap.get(did)!);
    }
  }

  // Fetch the profile's block list to find which of our follows they block
  try {
    console.log(`[ErgoBlock] Fetching blocks for profile ${profileDid}...`);
    const profileBlocks = await getUserBlocks(profileDid);
    console.log(`[ErgoBlock] Profile ${profileDid} has ${profileBlocks.length} blocks`);
    const profileBlockSet = new Set(profileBlocks);

    // Find which of our follows are in the profile's block list
    for (const [followDid, followInfo] of followsMap) {
      if (profileBlockSet.has(followDid)) {
        blocking.push(followInfo);
      }
    }
    console.log(`[ErgoBlock] Found ${blocking.length} of our follows blocked by this profile`);
  } catch (error) {
    // If we can't fetch their blocks, just return empty blocking array
    console.warn(
      `[ErgoBlock] Could not fetch blocks for ${profileDid}:`,
      error instanceof Error ? error.message : error
    );
  }

  return {
    blockedBy,
    blocking,
    lastChecked: Date.now(),
  };
}

/**
 * Get follows who block a profile (V2 - includes list-based blocks)
 */
export async function getBlockersAmongFollowsV2(
  profileDid: string,
  v2Cache?: BlockRelationshipCacheV2,
  blocklistCache?: GlobalBlocklistCache
): Promise<FollowedUser[]> {
  const relationships = await getBlockRelationshipsForProfileV2(
    profileDid,
    v2Cache,
    blocklistCache
  );
  return relationships.blockedBy;
}

/**
 * Check if any follow blocks a profile (V2 - includes list-based blocks)
 */
export async function isBlockedByAnyFollowV2(
  profileDid: string,
  v2Cache?: BlockRelationshipCacheV2,
  blocklistCache?: GlobalBlocklistCache
): Promise<boolean> {
  const blockers = await getBlockersAmongFollowsV2(profileDid, v2Cache, blocklistCache);
  return blockers.length > 0;
}

/**
 * Get detailed block info for a follow (V2)
 * Shows both direct blocks and list subscriptions separately
 */
export async function getFollowBlockDetailsV2(
  followDid: string,
  v2Cache?: BlockRelationshipCacheV2,
  blocklistCache?: GlobalBlocklistCache
): Promise<{
  directBlockCount: number;
  subscribedListCount: number;
  effectiveBlockCount: number;
  subscribedLists: Array<{ uri: string; name: string; memberCount: number }>;
} | null> {
  const cache = v2Cache || (await getBlockRelationshipCacheV2());
  const globalCache = blocklistCache || (await getGlobalBlocklistCache());

  const followData = cache.followBlockLists[followDid];
  if (!followData) {
    return null;
  }

  const effectiveBlocks = await getEffectiveBlocksForFollow(followDid, cache, globalCache);

  const subscribedLists = followData.subscribedLists
    .map((uri) => {
      const list = globalCache.lists[uri];
      return list
        ? { uri, name: list.name, memberCount: list.memberCount }
        : { uri, name: 'Unknown', memberCount: 0 };
    })
    .filter((l) => l.memberCount > 0 || l.name !== 'Unknown');

  return {
    directBlockCount: followData.directBlocks.length,
    subscribedListCount: followData.subscribedLists.length,
    effectiveBlockCount: effectiveBlocks.length,
    subscribedLists,
  };
}

/**
 * Get V2 statistics about the block relationship cache
 */
export async function getBlockRelationshipStatsV2(
  v2Cache?: BlockRelationshipCacheV2,
  blocklistCache?: GlobalBlocklistCache
): Promise<{
  totalFollows: number;
  syncedFollows: number;
  totalDirectBlocks: number;
  totalListSubscriptions: number;
  uniqueBlocklists: number;
  averageDirectBlocksPerFollow: number;
  lastSync: number;
}> {
  const cache = v2Cache || (await getBlockRelationshipCacheV2());
  const globalCache = blocklistCache || (await getGlobalBlocklistCache());

  let totalDirectBlocks = 0;
  let totalListSubscriptions = 0;

  for (const followData of Object.values(cache.followBlockLists)) {
    totalDirectBlocks += followData.directBlocks.length;
    totalListSubscriptions += followData.subscribedLists.length;
  }

  const syncedCount = Object.keys(cache.followBlockLists).length;
  const uniqueBlocklists = Object.keys(globalCache.lists).length;

  return {
    totalFollows: cache.totalFollows,
    syncedFollows: syncedCount,
    totalDirectBlocks,
    totalListSubscriptions,
    uniqueBlocklists,
    averageDirectBlocksPerFollow: syncedCount > 0 ? Math.round(totalDirectBlocks / syncedCount) : 0,
    lastSync: cache.lastFullSync,
  };
}
