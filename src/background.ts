/**
 * Background service worker entrypoint.
 * Routes messages to domain handlers and manages alarms/initialization.
 * All business logic lives in src/bg/ modules.
 */

import browser from './platform/browser.js';
import { createLogger, Mutex } from './platform/utils.js';
import { hasQueuedItems, processBlockedByQueue } from './domains/clearskyService.js';
import { createHandlerMap, dispatchMessage } from './platform/messages.js';
import { getAuthToken } from './domains/api-client.js';
import { handleGetProfilesBatched } from './domains/graph-ops.js';
import { syncFollowsOnly, setupFollowsSyncAlarm } from './domains/social-graph.js';
import { performFullSync, setupSyncAlarm } from './domains/sync.js';
import { checkExpirations, setupAlarm } from './domains/expiration.js';
import {
  handleUnblockRequest,
  handleUnmuteRequest,
  handleTempUnblockForView,
  handleReblockUser,
  handleCreateTempAction,
} from './domains/user-actions.js';
import {
  handleFindContext,
  handleFetchAllInteractions,
  handleFindInteractionsBefore,
} from './domains/context-search.js';
import {
  handleScheduleDelayedBlock,
  executeDelayedBlock,
  DELAYED_BLOCK_ALARM_PREFIX,
} from './domains/delayed-block.js';
import {
  performBlocklistAuditSync,
  handleUnsubscribeFromBlocklist,
  handleCopyBlocklistAsIndividualBlocks,
} from './domains/blocklist-audit.js';
import {
  handleFetchOwnedLists,
  handleFetchListMembersWithTimestamps,
  handleRemoveFromList,
} from './domains/list-audit.js';
import {
  rectifyFailedAmnestyUnblocks,
  handleGetFollowRelationships,
  handleGetFollowsWhoFollowThem,
  handleGetFollowersWhoFollowThem,
  handleGetFollowsTheyBlock,
  handleGetFollowsWhoBlockThem,
  handleGetFollowsWhoBlockThemCached,
  handlePrewarmClearskyCache,
} from './domains/amnesty.js';
import {
  handleScanMassOps,
  handleUndoMassOperations,
  handleGetMassOpsSettings,
  handleSetMassOpsSettings,
  handleDismissMassOpsCluster,
  handleGetDismissedMassOpsClusters,
  handleRestoreMassOpsCluster,
} from './domains/mass-ops.js';
import {
  handleFetchCopyUserData,
  handleExecuteCopyUserFollows,
  handleExecuteCopyUserBlocks,
} from './domains/copy-user.js';
import {
  handleScanDuplicateFollows,
  handleGetPdsRecordCounts,
  handleDebugFindOrphanBlocks,
} from './domains/pds-tools.js';
import { handleResolveHandle, handleFetchPostsPublic } from './domains/public-api.js';
import { handleFetchQuotePosters, handleBulkTempAction } from './domains/quote-sweep.js';
import { handleImportData } from './domains/import-export.js';
import {
  handleClearClearskyCache,
  handlePrefetchClearskyLookahead,
} from './domains/clearsky-handlers.js';
import {
  handleCheckCarCacheStatus,
  handleEstimateCarSize,
  handleInvalidateCarCache,
} from './domains/car-handlers.js';
import {
  clearStaleSyncState,
  clearBloatedStorageData,
  migrateBlockedByCache,
} from './domains/init.js';
import {
  handleAssignDurationToPermanent,
  handleMarkPermanentReviewed,
  handleDismissReview,
  handleBackfillReviewQueue,
} from './domains/review-queue.js';

const log = createLogger('background');

// Re-exports for test compatibility
export { sendNotification } from './domains/api-client.js';
export { unblockUser, unmuteUser, blockUser } from './domains/graph-ops.js';
export { isSearchPostInteraction } from './domains/context-search.js';
export { performFullSync, setupSyncAlarm } from './domains/sync.js';
export { checkExpirations, setupAlarm } from './domains/expiration.js';
export { performBlocklistAuditSync } from './domains/blocklist-audit.js';

// ============================================================================
// Clearsky Queue Processing
// ============================================================================

const CLEARSKY_QUEUE_ALARM_NAME = 'clearskyQueue';
const CLEARSKY_QUEUE_INTERVAL_MINUTES = 2;
const clearskyQueueMutex = new Mutex();

async function processClearskyQueue(): Promise<void> {
  if (clearskyQueueMutex.isLocked) {
    log.debug('Clearsky queue processing already in progress');
    return;
  }
  const hasItems = await hasQueuedItems();
  if (!hasItems) return;

  await clearskyQueueMutex.runExclusive(async () => {
    try {
      log.info('Processing Clearsky blocked-by queue...');
      const processed = await processBlockedByQueue(3);
      if (processed > 0) {
        log.info(`Processed ${processed} Clearsky queue items`);
      }
    } catch (error) {
      log.error('Clearsky queue processing failed:', error);
    }
  });
}

function setupClearskyQueueAlarm(): void {
  browser.alarms.create(CLEARSKY_QUEUE_ALARM_NAME, {
    delayInMinutes: 2,
    periodInMinutes: CLEARSKY_QUEUE_INTERVAL_MINUTES,
  });
}

// ============================================================================
// Alarm Listener
// ============================================================================

const ALARM_NAME = 'checkExpirations';
const SYNC_ALARM_NAME = 'syncWithBluesky';
const FOLLOWS_SYNC_ALARM_NAME = 'followsSync';
const FOLLOWS_SYNC_INTERVAL_MINUTES = 120;

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) return checkExpirations();
  if (alarm.name === SYNC_ALARM_NAME) return performFullSync();
  if (alarm.name === FOLLOWS_SYNC_ALARM_NAME) return syncFollowsOnly();
  if (alarm.name === CLEARSKY_QUEUE_ALARM_NAME) return processClearskyQueue();
  if (alarm.name.startsWith(DELAYED_BLOCK_ALARM_PREFIX)) {
    return executeDelayedBlock(alarm.name.slice(DELAYED_BLOCK_ALARM_PREFIX.length));
  }
});

// ============================================================================
// Message Handler Map — every handler is a one-liner delegate to src/bg/
// ============================================================================

const handlers = createHandlerMap({
  // ── Alarm triggers ──────────────────────────────────────────────────────
  TEMP_BLOCK_ADDED: async () => {
    setupAlarm();
  },
  TEMP_MUTE_ADDED: async () => {
    setupAlarm();
  },

  // ── Auth ────────────────────────────────────────────────────────────────
  SET_AUTH_TOKEN: async ({ auth }) => {
    await browser.storage.local.set({ authToken: auth });
    return { success: true };
  },
  GET_AUTH_STATUS: async () => {
    const auth = await getAuthToken();
    return { success: true, isAuthenticated: !!auth };
  },

  // ── Expiration & sync ──────────────────────────────────────────────────
  CHECK_NOW: async () => {
    await checkExpirations();
    return { success: true };
  },
  SYNC_NOW: async () => performFullSync(),

  // ── Block/mute operations ──────────────────────────────────────────────
  CREATE_TEMP_ACTION: async ({ did, handle, durationMs, isMute, isPermanent, postContext }) =>
    handleCreateTempAction(did, handle, durationMs, isMute, isPermanent, postContext),
  UNBLOCK_USER: async ({ did }) => handleUnblockRequest(did),
  UNMUTE_USER: async ({ did }) => handleUnmuteRequest(did),
  TEMP_UNBLOCK_FOR_VIEW: async ({ did }) => handleTempUnblockForView(did),
  REBLOCK_USER: async ({ did }) => handleReblockUser(did),

  // ── Context search ─────────────────────────────────────────────────────
  FIND_CONTEXT: async ({ did, handle, beforeTimestamp }) =>
    handleFindContext(did, handle, beforeTimestamp),
  FETCH_ALL_INTERACTIONS: async ({ did, handle, beforeTimestamp }) =>
    handleFetchAllInteractions(did, handle, beforeTimestamp),
  FIND_INTERACTIONS_BEFORE: async ({ targetDid, beforeTimestamp }) =>
    handleFindInteractionsBefore(targetDid, beforeTimestamp),

  // ── Last Word delayed block ────────────────────────────────────────────
  SCHEDULE_DELAYED_BLOCK: async ({
    did,
    handle,
    blockDurationMs,
    permanent,
    delaySeconds,
    mutedFirst,
  }) =>
    handleScheduleDelayedBlock(
      did,
      handle,
      blockDurationMs ?? -1,
      permanent ?? true,
      delaySeconds,
      mutedFirst ?? false
    ),

  // ── Blocklist audit ────────────────────────────────────────────────────
  BLOCKLIST_AUDIT_SYNC: async () => performBlocklistAuditSync(),
  UNSUBSCRIBE_BLOCKLIST: async ({ listUri }) => handleUnsubscribeFromBlocklist(listUri),
  COPY_BLOCKLIST_AS_INDIVIDUAL_BLOCKS: async ({ listUri }) =>
    handleCopyBlocklistAsIndividualBlocks(listUri),

  // ── List audit ─────────────────────────────────────────────────────────
  FETCH_OWNED_LISTS: async () => handleFetchOwnedLists(),
  FETCH_LIST_MEMBERS_WITH_TIMESTAMPS: async ({ listUri }) =>
    handleFetchListMembersWithTimestamps(listUri),
  REMOVE_FROM_LIST: async ({ rkey }) => handleRemoveFromList(rkey),

  // ── Social connections (amnesty) ───────────────────────────────────────
  GET_FOLLOW_RELATIONSHIPS: async ({ did }) => handleGetFollowRelationships(did),
  GET_FOLLOWS_WHO_FOLLOW_THEM: async ({ did }) => handleGetFollowsWhoFollowThem(did),
  GET_FOLLOWERS_WHO_FOLLOW_THEM: async ({ did }) => handleGetFollowersWhoFollowThem(did),
  GET_FOLLOWS_THEY_BLOCK: async ({ did }) => handleGetFollowsTheyBlock(did),
  GET_FOLLOWS_WHO_BLOCK_THEM: async ({ did }) => handleGetFollowsWhoBlockThem(did),
  GET_FOLLOWS_WHO_BLOCK_THEM_CACHED: async ({ did }) => handleGetFollowsWhoBlockThemCached(did),

  // ── Clearsky cache ─────────────────────────────────────────────────────
  PREWARM_CLEARSKY_CACHE: async ({ targetDids }) => handlePrewarmClearskyCache(targetDids),
  CLEAR_CLEARSKY_CACHE: async () => handleClearClearskyCache(),
  PREFETCH_CLEARSKY_LOOKAHEAD: async ({ targetDids }) =>
    handlePrefetchClearskyLookahead(targetDids),

  // ── Mass operations ────────────────────────────────────────────────────
  SCAN_MASS_OPS: async ({ settings, forceRefresh }) =>
    handleScanMassOps(settings, forceRefresh === true),
  UNDO_MASS_OPERATIONS: async ({ operations }) => handleUndoMassOperations(operations),
  GET_MASS_OPS_SETTINGS: async () => handleGetMassOpsSettings(),
  SET_MASS_OPS_SETTINGS: async ({ settings }) => handleSetMassOpsSettings(settings),
  DISMISS_MASS_OPS_CLUSTER: async ({ cluster }) => handleDismissMassOpsCluster(cluster),
  GET_DISMISSED_MASS_OPS_CLUSTERS: async () => handleGetDismissedMassOpsClusters(),
  RESTORE_MASS_OPS_CLUSTER: async ({ cluster }) => handleRestoreMassOpsCluster(cluster),

  // ── CAR cache ──────────────────────────────────────────────────────────
  CHECK_CAR_CACHE_STATUS: async () => handleCheckCarCacheStatus(),
  ESTIMATE_CAR_SIZE: async () => handleEstimateCarSize(),
  INVALIDATE_CAR_CACHE: async () => handleInvalidateCarCache(),

  // ── Profile fetching ───────────────────────────────────────────────────
  GET_PROFILES_BATCHED: async ({ dids }) => handleGetProfilesBatched(dids),

  // ── Copy user ──────────────────────────────────────────────────────────
  FETCH_COPY_USER_DATA: async ({ handle }) => handleFetchCopyUserData(handle),
  EXECUTE_COPY_USER_FOLLOWS: async ({ dids }) => handleExecuteCopyUserFollows(dids),
  EXECUTE_COPY_USER_BLOCKS: async ({ dids }) => handleExecuteCopyUserBlocks(dids),

  // ── PDS maintenance ────────────────────────────────────────────────────
  SCAN_DUPLICATE_FOLLOWS: async ({ deleteDuplicates }) =>
    handleScanDuplicateFollows(deleteDuplicates === true),
  RECTIFY_AMNESTY_UNBLOCKS: async () => rectifyFailedAmnestyUnblocks(),
  GET_PDS_RECORD_COUNTS: async () => handleGetPdsRecordCounts(),

  // ── Misc ───────────────────────────────────────────────────────────────
  RESOLVE_HANDLE: async ({ handle }) => handleResolveHandle(handle),
  DEBUG_FIND_ORPHAN_BLOCKS: async () => handleDebugFindOrphanBlocks(),
  FETCH_POSTS_PUBLIC: async ({ uris }) => handleFetchPostsPublic(uris),
  IMPORT_DATA: async ({ data, options }) => handleImportData(data, options),

  // ── Quote Sweep ────────────────────────────────────────────────────────
  GET_QUOTE_POSTERS: async ({ postRef }) => handleFetchQuotePosters(postRef),
  BULK_TEMP_ACTION: async ({ dids, handles, isMute, durationMs, isPermanent }) =>
    handleBulkTempAction(dids, handles, isMute, durationMs, isPermanent),

  // ── Review Queue ────────────────────────────────────────────────────
  ASSIGN_DURATION_TO_PERMANENT: async ({ did, actionType, duration }) =>
    handleAssignDurationToPermanent(did, actionType, duration),
  MARK_PERMANENT_REVIEWED: async ({ did, actionType }) =>
    handleMarkPermanentReviewed(did, actionType),
  DISMISS_REVIEW: async ({ did, actionType }) => handleDismissReview(did, actionType),
  BACKFILL_REVIEW_QUEUE: async () => handleBackfillReviewQueue(),
});

// ============================================================================
// Message Dispatch
// ============================================================================

browser.runtime.onMessage.addListener(async (rawMessage: unknown): Promise<unknown> => {
  const msg = rawMessage as { type?: string };
  log.info('Received message:', msg.type);
  return dispatchMessage(handlers, rawMessage);
});

// ============================================================================
// Initialization
// ============================================================================

browser.action.setBadgeText({ text: '' });

async function initialize(trigger: 'installed' | 'started' | 'script-load'): Promise<void> {
  log.info(`Extension ${trigger}`);
  clearStaleSyncState();
  await clearBloatedStorageData();
  await migrateBlockedByCache();

  setupAlarm();
  setupSyncAlarm();
  setupFollowsSyncAlarm(FOLLOWS_SYNC_ALARM_NAME, FOLLOWS_SYNC_INTERVAL_MINUTES);
  setupClearskyQueueAlarm();
  browser.action.setBadgeText({ text: '' });

  setTimeout(() => syncFollowsOnly(), 5000);
  setTimeout(() => rectifyFailedAmnestyUnblocks(), 10000);
}

browser.runtime.onInstalled.addListener(() => initialize('installed'));
browser.runtime.onStartup.addListener(() => initialize('started'));
initialize('script-load');
