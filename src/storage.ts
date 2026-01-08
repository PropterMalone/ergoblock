/**
 * Storage management for extension data
 * Handles options, action history, and temporary blocks/mutes
 */

import browser from './browser.js';
import {
  DEFAULT_OPTIONS,
  type ExtensionOptions,
  type HistoryEntry,
  type PostContext,
  type PermanentBlockMute,
  type ManagedEntry,
  type SyncState,
  type AmnestyReview,
  type SubscribedBlocklist,
  type FollowRelation,
  type BlocklistConflictGroup,
  type BlocklistAuditState,
} from './types.js';

// Storage quota constants (Chrome sync storage limits)
const SYNC_STORAGE_QUOTA_BYTES = 102400; // 100KB total for sync storage
const SYNC_STORAGE_ITEM_QUOTA_BYTES = 8192; // 8KB per item
const QUOTA_WARNING_THRESHOLD = 0.8; // Warn at 80% usage

export interface StorageQuotaInfo {
  bytesUsed: number;
  bytesTotal: number;
  percentUsed: number;
  isNearLimit: boolean;
  isAtLimit: boolean;
}

/**
 * Check current storage quota usage
 */
export async function checkStorageQuota(): Promise<StorageQuotaInfo> {
  try {
    // Get all sync storage data to measure size
    const allData = await browser.storage.sync.get(null);
    const bytesUsed = new Blob([JSON.stringify(allData)]).size;
    const percentUsed = bytesUsed / SYNC_STORAGE_QUOTA_BYTES;

    return {
      bytesUsed,
      bytesTotal: SYNC_STORAGE_QUOTA_BYTES,
      percentUsed,
      isNearLimit: percentUsed >= QUOTA_WARNING_THRESHOLD,
      isAtLimit: percentUsed >= 0.95,
    };
  } catch (error) {
    console.error('[ErgoBlock] Error checking storage quota:', error);
    return {
      bytesUsed: 0,
      bytesTotal: SYNC_STORAGE_QUOTA_BYTES,
      percentUsed: 0,
      isNearLimit: false,
      isAtLimit: false,
    };
  }
}

/**
 * Safely write to sync storage with quota checking
 * Throws on quota exceeded for caller to handle
 */
async function safeSyncStorageWrite(key: string, value: unknown): Promise<void> {
  const dataSize = new Blob([JSON.stringify(value)]).size;

  // Check per-item limit for sync storage
  if (dataSize > SYNC_STORAGE_ITEM_QUOTA_BYTES) {
    throw new Error(
      `Storage item too large: ${dataSize} bytes exceeds ${SYNC_STORAGE_ITEM_QUOTA_BYTES} byte limit`
    );
  }

  // Check total quota
  const quota = await checkStorageQuota();
  if (quota.isAtLimit) {
    throw new Error(
      `Storage quota exceeded: ${Math.round(quota.percentUsed * 100)}% used. ` +
        `Please remove some temp blocks/mutes.`
    );
  }

  if (quota.isNearLimit) {
    console.warn(`[ErgoBlock] Storage quota warning: ${Math.round(quota.percentUsed * 100)}% used`);
  }

  await browser.storage.sync.set({ [key]: value });
}

export const STORAGE_KEYS = {
  TEMP_BLOCKS: 'tempBlocks',
  TEMP_MUTES: 'tempMutes',
  OPTIONS: 'extensionOptions',
  ACTION_HISTORY: 'actionHistory',
  LAST_TAB: 'lastActiveTab',
  POST_CONTEXTS: 'postContexts',
  // New keys for full manager
  PERMANENT_BLOCKS: 'permanentBlocks',
  PERMANENT_MUTES: 'permanentMutes',
  SYNC_STATE: 'syncState',
  // Amnesty feature
  AMNESTY_REVIEWS: 'amnestyReviews',
  // Blocklist audit feature
  BLOCKLIST_AUDIT_STATE: 'blocklistAuditState',
  SUBSCRIBED_BLOCKLISTS: 'subscribedBlocklists',
  SOCIAL_GRAPH: 'socialGraph',
  BLOCKLIST_CONFLICTS: 'blocklistConflicts',
  DISMISSED_CONFLICTS: 'dismissedConflicts',
};

const HISTORY_MAX_ENTRIES = 100;
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours default

// ============================================================================
// Core temp blocks/mutes functions - imported from existing storage.js logic
// ============================================================================

interface TempBlockData {
  handle: string;
  expiresAt: number;
  createdAt: number;
  rkey?: string;
}

interface TempBlocksMap {
  [did: string]: TempBlockData;
}

/**
 * Get all temp blocks from storage
 */
export async function getTempBlocks(): Promise<TempBlocksMap> {
  const result = await browser.storage.sync.get(STORAGE_KEYS.TEMP_BLOCKS);
  return (result[STORAGE_KEYS.TEMP_BLOCKS] as TempBlocksMap) || {};
}

/**
 * Get all temp mutes from storage
 */
export async function getTempMutes(): Promise<TempBlocksMap> {
  const result = await browser.storage.sync.get(STORAGE_KEYS.TEMP_MUTES);
  return (result[STORAGE_KEYS.TEMP_MUTES] as TempBlocksMap) || {};
}

/**
 * Add a temp block
 * @param did - User's DID
 * @param handle - User's handle
 * @param durationMs - Duration in milliseconds (default 24h)
 * @param rkey - Optional record key (rkey) for direct unblocking
 */
export async function addTempBlock(
  did: string,
  handle: string,
  durationMs: number = DEFAULT_DURATION_MS,
  rkey?: string
): Promise<void> {
  const blocks = await getTempBlocks();
  blocks[did] = {
    handle,
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now(),
    rkey,
  };
  // Use safe write with quota checking
  await safeSyncStorageWrite(STORAGE_KEYS.TEMP_BLOCKS, blocks);
  // Notify background to set alarm
  browser.runtime
    .sendMessage({
      type: 'TEMP_BLOCK_ADDED',
      did,
      expiresAt: blocks[did].expiresAt,
    })
    .catch(() => {
      // Background may be inactive in MV3 - alarm will be set on next wake
    });
}

/**
 * Remove a temp block
 * @param did - User's DID
 */
export async function removeTempBlock(did: string): Promise<void> {
  const blocks = await getTempBlocks();
  delete blocks[did];
  await browser.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
}

/**
 * Add a temp mute
 * @param did - User's DID
 * @param handle - User's handle
 * @param durationMs - Duration in milliseconds (default 24h)
 */
export async function addTempMute(
  did: string,
  handle: string,
  durationMs: number = DEFAULT_DURATION_MS
): Promise<void> {
  const mutes = await getTempMutes();
  mutes[did] = {
    handle,
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now(),
  };
  // Use safe write with quota checking
  await safeSyncStorageWrite(STORAGE_KEYS.TEMP_MUTES, mutes);
  // Notify background to set alarm
  browser.runtime
    .sendMessage({
      type: 'TEMP_MUTE_ADDED',
      did,
      expiresAt: mutes[did].expiresAt,
    })
    .catch(() => {
      // Background may be inactive in MV3 - alarm will be set on next wake
    });
}

/**
 * Remove a temp mute
 * @param did - User's DID
 */
export async function removeTempMute(did: string): Promise<void> {
  const mutes = await getTempMutes();
  delete mutes[did];
  await browser.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
}

// ============================================================================
// Options management
// ============================================================================

/**
 * Get extension options from local storage
 */
export async function getOptions(): Promise<ExtensionOptions> {
  const result = await browser.storage.local.get(STORAGE_KEYS.OPTIONS);
  return (result[STORAGE_KEYS.OPTIONS] as ExtensionOptions) || DEFAULT_OPTIONS;
}

/**
 * Set extension options in local storage
 */
export async function setOptions(options: ExtensionOptions): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.OPTIONS]: options });
}

// ============================================================================
// Action history management
// ============================================================================

/**
 * Get action history from local storage
 * Returns entries in reverse chronological order (newest first)
 */
export async function getActionHistory(): Promise<HistoryEntry[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.ACTION_HISTORY);
  const history = result[STORAGE_KEYS.ACTION_HISTORY] || [];
  return history as HistoryEntry[];
}

/**
 * Add an entry to action history
 * Maintains a maximum of HISTORY_MAX_ENTRIES
 */
export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  // Generate ID if not provided
  const entryWithId = {
    ...entry,
    id: entry.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };

  const history = await getActionHistory();
  history.unshift(entryWithId); // Add to beginning (newest first)

  // Keep only the last HISTORY_MAX_ENTRIES
  const trimmed = history.slice(0, HISTORY_MAX_ENTRIES);

  await browser.storage.local.set({ [STORAGE_KEYS.ACTION_HISTORY]: trimmed });
}

// ============================================================================
// Cleanup functions for expired entries
// ============================================================================

/**
 * Remove all expired temp blocks
 */
export async function removeAllExpiredBlocks(): Promise<void> {
  const blocks = await getTempBlocks();
  const now = Date.now();
  const updated: TempBlocksMap = {};

  for (const [did, data] of Object.entries(blocks)) {
    if (data.expiresAt > now) {
      updated[did] = data;
    }
  }

  await browser.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: updated });
}

/**
 * Remove all expired temp mutes
 */
export async function removeAllExpiredMutes(): Promise<void> {
  const mutes = await getTempMutes();
  const now = Date.now();
  const updated: TempBlocksMap = {};

  for (const [did, data] of Object.entries(mutes)) {
    if (data.expiresAt > now) {
      updated[did] = data;
    }
  }

  await browser.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: updated });
}

// ============================================================================
// Post context storage management
// ============================================================================

const MAX_POST_CONTEXTS = 500; // Keep last 500 post contexts

/**
 * Get all stored post contexts
 */
export async function getPostContexts(): Promise<PostContext[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.POST_CONTEXTS);
  return (result[STORAGE_KEYS.POST_CONTEXTS] as PostContext[]) || [];
}

/**
 * Add a post context to storage
 */
export async function addPostContext(context: PostContext): Promise<void> {
  const contexts = await getPostContexts();
  contexts.unshift(context); // Add to beginning (newest first)

  // Trim to max entries
  const trimmed = contexts.slice(0, MAX_POST_CONTEXTS);

  await browser.storage.local.set({ [STORAGE_KEYS.POST_CONTEXTS]: trimmed });
}

/**
 * Delete a post context by ID
 */
export async function deletePostContext(id: string): Promise<void> {
  const contexts = await getPostContexts();
  const filtered = contexts.filter((c) => c.id !== id);
  await browser.storage.local.set({ [STORAGE_KEYS.POST_CONTEXTS]: filtered });
}

/**
 * Clean up expired post contexts based on retention policy
 */
export async function cleanupExpiredPostContexts(): Promise<void> {
  const options = await getOptions();
  if (options.postContextRetentionDays <= 0) return; // 0 = never delete

  const contexts = await getPostContexts();
  const cutoff = Date.now() - options.postContextRetentionDays * 24 * 60 * 60 * 1000;

  const filtered = contexts.filter((c) => c.timestamp > cutoff);
  if (filtered.length !== contexts.length) {
    await browser.storage.local.set({ [STORAGE_KEYS.POST_CONTEXTS]: filtered });
    console.log(
      `[ErgoBlock] Cleaned up ${contexts.length - filtered.length} expired post contexts`
    );
  }
}

// ============================================================================
// Permanent blocks/mutes storage (synced from Bluesky)
// ============================================================================

interface PermanentBlocksMutesMap {
  [did: string]: PermanentBlockMute;
}

/**
 * Get permanent blocks from local storage (blocks synced from Bluesky)
 */
export async function getPermanentBlocks(): Promise<PermanentBlocksMutesMap> {
  const result = await browser.storage.local.get(STORAGE_KEYS.PERMANENT_BLOCKS);
  return (result[STORAGE_KEYS.PERMANENT_BLOCKS] as PermanentBlocksMutesMap) || {};
}

/**
 * Set permanent blocks in local storage
 */
export async function setPermanentBlocks(blocks: PermanentBlocksMutesMap): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.PERMANENT_BLOCKS]: blocks });
}

/**
 * Get permanent mutes from local storage (mutes synced from Bluesky)
 */
export async function getPermanentMutes(): Promise<PermanentBlocksMutesMap> {
  const result = await browser.storage.local.get(STORAGE_KEYS.PERMANENT_MUTES);
  return (result[STORAGE_KEYS.PERMANENT_MUTES] as PermanentBlocksMutesMap) || {};
}

/**
 * Set permanent mutes in local storage
 */
export async function setPermanentMutes(mutes: PermanentBlocksMutesMap): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.PERMANENT_MUTES]: mutes });
}

// ============================================================================
// Sync state management
// ============================================================================

const DEFAULT_SYNC_STATE: SyncState = {
  lastBlockSync: 0,
  lastMuteSync: 0,
  syncInProgress: false,
};

/**
 * Get sync state from local storage
 */
export async function getSyncState(): Promise<SyncState> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SYNC_STATE);
  return (result[STORAGE_KEYS.SYNC_STATE] as SyncState) || DEFAULT_SYNC_STATE;
}

/**
 * Set sync state in local storage
 */
export async function setSyncState(state: SyncState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.SYNC_STATE]: state });
}

/**
 * Update sync state partially
 */
export async function updateSyncState(update: Partial<SyncState>): Promise<void> {
  const current = await getSyncState();
  await setSyncState({ ...current, ...update });
}

// ============================================================================
// Merged views for manager UI
// ============================================================================

/**
 * Get all managed blocks (temp + permanent) as a unified list
 * Returns entries sorted by creation/sync date (newest first)
 */
export async function getAllManagedBlocks(): Promise<ManagedEntry[]> {
  const [tempBlocks, permanentBlocks] = await Promise.all([getTempBlocks(), getPermanentBlocks()]);

  const entries: ManagedEntry[] = [];

  // Add temp blocks
  for (const [did, data] of Object.entries(tempBlocks)) {
    entries.push({
      did,
      handle: data.handle,
      source: 'ergoblock_temp',
      type: 'block',
      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
      rkey: data.rkey,
    });
  }

  // Add permanent blocks (only those not already tracked as temp)
  for (const [did, data] of Object.entries(permanentBlocks)) {
    if (!tempBlocks[did]) {
      entries.push({
        did,
        handle: data.handle,
        displayName: data.displayName,
        avatar: data.avatar,
        source: 'bluesky',
        type: 'block',
        syncedAt: data.syncedAt,
        createdAt: data.createdAt,
        rkey: data.rkey,
        mutualBlock: data.mutualBlock,
        viewer: data.viewer,
      });
    }
  }

  // Sort by date (newest first)
  entries.sort((a, b) => {
    const dateA = a.createdAt || a.syncedAt || 0;
    const dateB = b.createdAt || b.syncedAt || 0;
    return dateB - dateA;
  });

  return entries;
}

/**
 * Get all managed mutes (temp + permanent) as a unified list
 * Returns entries sorted by creation/sync date (newest first)
 */
export async function getAllManagedMutes(): Promise<ManagedEntry[]> {
  const [tempMutes, permanentMutes] = await Promise.all([getTempMutes(), getPermanentMutes()]);

  const entries: ManagedEntry[] = [];

  // Add temp mutes
  for (const [did, data] of Object.entries(tempMutes)) {
    entries.push({
      did,
      handle: data.handle,
      source: 'ergoblock_temp',
      type: 'mute',
      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
    });
  }

  // Add permanent mutes (only those not already tracked as temp)
  for (const [did, data] of Object.entries(permanentMutes)) {
    if (!tempMutes[did]) {
      entries.push({
        did,
        handle: data.handle,
        displayName: data.displayName,
        avatar: data.avatar,
        source: 'bluesky',
        type: 'mute',
        syncedAt: data.syncedAt,
        viewer: data.viewer,
      });
    }
  }

  // Sort by date (newest first)
  entries.sort((a, b) => {
    const dateA = a.createdAt || a.syncedAt || 0;
    const dateB = b.createdAt || b.syncedAt || 0;
    return dateB - dateA;
  });

  return entries;
}

// ============================================================================
// Amnesty Feature Storage
// ============================================================================

/**
 * Get all amnesty reviews from storage
 * Note: Uses local storage to avoid sync quota limits (8KB per item)
 */
export async function getAmnestyReviews(): Promise<AmnestyReview[]> {
  // Try local first, fall back to sync for migration
  const localResult = await browser.storage.local.get(STORAGE_KEYS.AMNESTY_REVIEWS);
  if (localResult[STORAGE_KEYS.AMNESTY_REVIEWS]) {
    return localResult[STORAGE_KEYS.AMNESTY_REVIEWS] as AmnestyReview[];
  }
  // Check sync for existing data and migrate if found
  const syncResult = await browser.storage.sync.get(STORAGE_KEYS.AMNESTY_REVIEWS);
  const syncReviews = (syncResult[STORAGE_KEYS.AMNESTY_REVIEWS] as AmnestyReview[]) || [];
  if (syncReviews.length > 0) {
    // Migrate to local storage
    await browser.storage.local.set({ [STORAGE_KEYS.AMNESTY_REVIEWS]: syncReviews });
    // Clean up sync storage
    await browser.storage.sync.remove(STORAGE_KEYS.AMNESTY_REVIEWS);
  }
  return syncReviews;
}

/**
 * Get set of DIDs that have been reviewed by amnesty
 */
export async function getAmnestyReviewedDids(): Promise<Set<string>> {
  const reviews = await getAmnestyReviews();
  return new Set(reviews.map((r) => r.did));
}

/**
 * Add an amnesty review record
 * Note: Uses local storage to avoid sync quota limits
 */
export async function addAmnestyReview(review: AmnestyReview): Promise<void> {
  const reviews = await getAmnestyReviews();
  // Remove any existing review for this DID (in case of re-review)
  const filtered = reviews.filter((r) => r.did !== review.did);
  filtered.push(review);
  await browser.storage.local.set({ [STORAGE_KEYS.AMNESTY_REVIEWS]: filtered });
}

/**
 * Get amnesty statistics
 */
export async function getAmnestyStats(): Promise<{
  totalReviewed: number;
  unblocked: number;
  keptBlocked: number;
  unmuted: number;
  keptMuted: number;
}> {
  const reviews = await getAmnestyReviews();
  return {
    totalReviewed: reviews.length,
    unblocked: reviews.filter((r) => r.decision === 'unblocked').length,
    keptBlocked: reviews.filter((r) => r.decision === 'kept_blocked').length,
    unmuted: reviews.filter((r) => r.decision === 'unmuted').length,
    keptMuted: reviews.filter((r) => r.decision === 'kept_muted').length,
  };
}

// ============================================================================
// Blocklist Audit Storage
// ============================================================================

const DEFAULT_AUDIT_STATE: BlocklistAuditState = {
  lastSyncAt: 0,
  syncInProgress: false,
  followCount: 0,
  followerCount: 0,
  blocklistCount: 0,
  conflictCount: 0,
};

/**
 * Get blocklist audit state
 */
export async function getBlocklistAuditState(): Promise<BlocklistAuditState> {
  const result = await browser.storage.local.get(STORAGE_KEYS.BLOCKLIST_AUDIT_STATE);
  return (result[STORAGE_KEYS.BLOCKLIST_AUDIT_STATE] as BlocklistAuditState) || DEFAULT_AUDIT_STATE;
}

/**
 * Set blocklist audit state
 */
export async function setBlocklistAuditState(state: BlocklistAuditState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.BLOCKLIST_AUDIT_STATE]: state });
}

/**
 * Update blocklist audit state partially
 */
export async function updateBlocklistAuditState(
  update: Partial<BlocklistAuditState>
): Promise<void> {
  const current = await getBlocklistAuditState();
  await setBlocklistAuditState({ ...current, ...update });
}

/**
 * Get subscribed blocklists
 */
export async function getSubscribedBlocklists(): Promise<SubscribedBlocklist[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SUBSCRIBED_BLOCKLISTS);
  return (result[STORAGE_KEYS.SUBSCRIBED_BLOCKLISTS] as SubscribedBlocklist[]) || [];
}

/**
 * Set subscribed blocklists
 */
export async function setSubscribedBlocklists(lists: SubscribedBlocklist[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.SUBSCRIBED_BLOCKLISTS]: lists });
}

/**
 * Social graph storage (follows + followers combined)
 */
interface SocialGraphData {
  follows: FollowRelation[];
  followers: FollowRelation[];
  syncedAt: number;
}

/**
 * Get social graph (follows + followers)
 */
export async function getSocialGraph(): Promise<SocialGraphData> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SOCIAL_GRAPH);
  return (
    (result[STORAGE_KEYS.SOCIAL_GRAPH] as SocialGraphData) || {
      follows: [],
      followers: [],
      syncedAt: 0,
    }
  );
}

/**
 * Set social graph
 */
export async function setSocialGraph(data: SocialGraphData): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.SOCIAL_GRAPH]: data });
}

/**
 * Get blocklist conflicts grouped by list
 */
export async function getBlocklistConflicts(): Promise<BlocklistConflictGroup[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.BLOCKLIST_CONFLICTS);
  return (result[STORAGE_KEYS.BLOCKLIST_CONFLICTS] as BlocklistConflictGroup[]) || [];
}

/**
 * Set blocklist conflicts
 */
export async function setBlocklistConflicts(conflicts: BlocklistConflictGroup[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.BLOCKLIST_CONFLICTS]: conflicts });
}

/**
 * Get dismissed conflict list URIs
 */
export async function getDismissedConflicts(): Promise<Set<string>> {
  const result = await browser.storage.local.get(STORAGE_KEYS.DISMISSED_CONFLICTS);
  const dismissed = (result[STORAGE_KEYS.DISMISSED_CONFLICTS] as string[]) || [];
  return new Set(dismissed);
}

/**
 * Dismiss conflicts for a blocklist
 */
export async function dismissBlocklistConflicts(listUri: string): Promise<void> {
  const dismissed = await getDismissedConflicts();
  dismissed.add(listUri);
  await browser.storage.local.set({
    [STORAGE_KEYS.DISMISSED_CONFLICTS]: Array.from(dismissed),
  });
}

/**
 * Undismiss conflicts for a blocklist (show again)
 */
export async function undismissBlocklistConflicts(listUri: string): Promise<void> {
  const dismissed = await getDismissedConflicts();
  dismissed.delete(listUri);
  await browser.storage.local.set({
    [STORAGE_KEYS.DISMISSED_CONFLICTS]: Array.from(dismissed),
  });
}

/**
 * Clear all blocklist audit data
 */
export async function clearBlocklistAuditData(): Promise<void> {
  await browser.storage.local.remove([
    STORAGE_KEYS.BLOCKLIST_AUDIT_STATE,
    STORAGE_KEYS.SUBSCRIBED_BLOCKLISTS,
    STORAGE_KEYS.SOCIAL_GRAPH,
    STORAGE_KEYS.BLOCKLIST_CONFLICTS,
    STORAGE_KEYS.DISMISSED_CONFLICTS,
  ]);
}
