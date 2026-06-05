/**
 * Storage key constants and shared defaults
 */

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
  // Repost filtering feature
  REPOST_FILTERED_USERS: 'repostFilteredUsers',
  // Lightweight follows list (just handles, for repost filter feature)
  FOLLOWS_HANDLES: 'followsHandles',
  // List audit feature
  LIST_AUDIT_REVIEWS: 'listAuditReviews',
  // Mass operations detection feature
  MASS_OPS_SCAN_RESULT: 'massOpsScanResult',
  MASS_OPS_SETTINGS: 'massOpsSettings',
  MASS_OPS_DISMISSED_CLUSTERS: 'massOpsDismissedClusters',
  // CAR download progress (for UI updates)
  CAR_DOWNLOAD_PROGRESS: 'carDownloadProgress',
  // Pending delayed blocks (Last Word feature)
  PENDING_DELAYED_BLOCKS: 'pendingDelayedBlocks',
  // First-run detection (UX Legibility Audit)
  HAS_CREATED_ACTION: 'hasCreatedAction',
  // Column visibility (table configuration)
  COLUMN_VISIBILITY: 'columnVisibility',
  // Usage statistics
  USAGE_STATS: 'usageStats',
};

export const HISTORY_MAX_ENTRIES = 100;
export const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours default
