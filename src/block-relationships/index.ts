/**
 * Block Relationships Module
 * Integrates AskBeeves functionality into ErgoBlock
 */

// Cache management
export {
  BLOCK_REL_STORAGE_KEYS,
  getBlockRelationshipCache,
  setBlockRelationshipCache,
  updateFollows,
  updateFollowBlockList,
  removeFollowFromCache,
  getBlockRelationshipSyncStatus,
  updateBlockRelSyncStatus,
  startSync,
  finishSync,
  updateSyncProgress,
  addSyncError,
  getCacheSize,
  pruneCache,
  clearBlockRelationshipCache,
  getFollowBlockList,
  isBlockListStale,
  // V2 cache functions
  getBlockRelationshipCacheV2,
  setBlockRelationshipCacheV2,
  getGlobalBlocklistCache,
  setGlobalBlocklistCache,
  migrateToV2Cache,
  hasV2Cache,
  clearV2Caches,
} from './cache.js';

// Sync service
export {
  populatePdsCache,
  resolvePds,
  getUserBlocks,
  syncFollowBlockLists,
  syncSingleUserBlocks,
  // V2 sync functions
  getUserBlockDataV2,
  syncFollowBlockListsV2,
  syncSingleUserBlocksV2,
  // Deep sync functions
  deepSyncBlocklistMembers,
  getBlocklistSubscriptionStats,
} from './sync.js';

// Lookup functions
export {
  getBlockRelationshipsForProfile,
  getBlockersAmongFollows,
  isBlockedByAnyFollow,
  getBlockerCount,
  getBlockedByFollow,
  findCommonBlockers,
  searchFollows,
  getBlockRelationshipStats,
  // V2 lookup functions
  getEffectiveBlocksForFollow,
  getBlockRelationshipsForProfileV2,
  getBlockersAmongFollowsV2,
  isBlockedByAnyFollowV2,
  getFollowBlockDetailsV2,
  getBlockRelationshipStatsV2,
} from './lookup.js';
