/**
 * Storage management barrel - re-exports all storage functions from domain modules.
 *
 * All external imports should continue using:
 *   import { foo } from './storage.js'
 *
 * Domain modules live in src/storage/:
 *   keys.ts        - Storage key constants
 *   quota.ts       - Quota checking and safe writes
 *   temp-actions.ts - Temp blocks/mutes CRUD
 *   state.ts       - Options, sync state, first-run, column visibility, usage stats
 *   history.ts     - Action history and post contexts
 *   permanent.ts   - Permanent blocks/mutes and merged views
 *   amnesty.ts     - Amnesty review decisions
 *   blocklist.ts   - Blocklist audit, social graph, conflicts
 *   features.ts    - Repost filter, list audit, mass ops, CAR progress, delayed blocks, rollbacks
 */

// ── Keys & constants ─────────────────────────────────────────────────────────
export { STORAGE_KEYS } from './storage/keys.js';

// ── Quota ────────────────────────────────────────────────────────────────────
export {
  type StorageQuotaInfo,
  StorageQuotaError,
  checkStorageQuota,
  calculateEntrySize,
  preCheckStorageQuota,
} from './storage/quota.js';

// ── Temp blocks/mutes ────────────────────────────────────────────────────────
export {
  getTempBlocks,
  getTempMutes,
  addTempBlock,
  removeTempBlock,
  addTempMute,
  removeTempMute,
  removeAllExpiredBlocks,
  removeAllExpiredMutes,
} from './storage/temp-actions.js';

// ── State (options, sync, first-run, columns, usage, validation) ─────────────
export {
  getOptions,
  setOptions,
  getSyncState,
  setSyncState,
  updateSyncState,
  getHasCreatedAction,
  setHasCreatedAction,
  getColumnVisibility,
  setColumnVisibility,
  getUsageStats,
  resetUsageStats,
  validateExportData,
} from './storage/state.js';

// ── History & post contexts ──────────────────────────────────────────────────
export {
  getActionHistory,
  addHistoryEntry,
  getPostContexts,
  addPostContext,
  deletePostContext,
  cleanupExpiredPostContexts,
} from './storage/history.js';

// ── Permanent blocks/mutes & merged views ────────────────────────────────────
export {
  getPermanentBlocks,
  setPermanentBlocks,
  removePermanentBlock,
  getPermanentMutes,
  setPermanentMutes,
  removePermanentMute,
  getAllManagedBlocks,
  getAllManagedMutes,
} from './storage/permanent.js';

// ── Amnesty ──────────────────────────────────────────────────────────────────
export {
  getAmnestyReviews,
  getAmnestyReviewedDids,
  addAmnestyReview,
  getAmnestyStats,
} from './storage/amnesty.js';

// ── Blocklist audit ──────────────────────────────────────────────────────────
export {
  getBlocklistAuditState,
  setBlocklistAuditState,
  updateBlocklistAuditState,
  getSubscribedBlocklists,
  setSubscribedBlocklists,
  getSocialGraph,
  setSocialGraph,
  getFollowsHandles,
  setFollowsHandles,
  isHandleFollowed,
  getBlocklistConflicts,
  setBlocklistConflicts,
  getDismissedConflicts,
  dismissBlocklistConflicts,
  undismissBlocklistConflicts,
  clearBlocklistAuditData,
} from './storage/blocklist.js';

// ── Features (repost filter, list audit, mass ops, CAR, delayed blocks, rollbacks) ──
export {
  // Repost filtering
  getRepostFilteredUsers,
  addRepostFilteredUser,
  removeRepostFilteredUser,
  isRepostFiltered,
  isHandleRepostFiltered,
  getRepostFilteredUsersArray,
  // List audit
  getListAuditReviews,
  addListAuditReview,
  getListAuditReviewedDids,
  getListAuditStats,
  clearListAuditReviews,
  // Mass operations
  getMassOpsScanResult,
  saveMassOpsScanResult,
  clearMassOpsScanResult,
  getMassOpsSettings,
  setMassOpsSettings,
  type DismissedCluster,
  getDismissedMassOpsClusters,
  dismissMassOpsCluster,
  isClusterDismissed,
  clearDismissedMassOpsClusters,
  // CAR download progress
  type CarDownloadProgressState,
  getCarDownloadProgress,
  setCarDownloadProgress,
  clearCarDownloadProgress,
  // Delayed blocks
  getPendingDelayedBlocks,
  setPendingDelayedBlocks,
  addPendingDelayedBlock,
  removePendingDelayedBlock,
  getPendingDelayedBlock,
  // Rollback queue
  getPendingRollbacks,
  addPendingRollback,
  updatePendingRollback,
  removePendingRollback,
  getProcessableRollbacks,
  cleanupOldRollbacks,
} from './storage/features.js';
