/**
 * Background service worker entrypoint.
 * Routes messages to domain handlers and manages alarms/initialization.
 * All business logic lives in src/bg/ modules.
 */

import browser from './platform/browser.js';
import {
  POST_BATCH_ALARM,
  initializePostBatches,
  wakePostBatches,
  startPostBatch,
  getPostBatches,
  stopPostBatch,
  undoPostBatch,
} from './domains/post-batch-service.js';
import { createLogger } from './platform/utils.js';
import { createHandlerMap, dispatchMessage } from './platform/messages.js';
import { getAuthToken, saveAuthToken } from './domains/api-client.js';
import { handleGetProfilesBatched } from './domains/graph-ops.js';
import { performFullSync, setupSyncAlarm } from './domains/sync.js';
import { checkExpirations, setupAlarm } from './domains/expiration.js';
import { expirationCheckResponse } from './platform/expiration-health.js';
import { registerExpirationSettingsListener } from './domains/expiration-settings.js';
import {
  handleUnblockRequest,
  handleUnmuteRequest,
  handleTempUnblockForView,
  handleReblockUser,
  handleCreateTempAction,
} from './domains/user-actions.js';
import {
  handleScheduleDelayedBlock,
  executeDelayedBlock,
  DELAYED_BLOCK_ALARM_PREFIX,
} from './domains/delayed-block.js';
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
import {
  handleFetchQuotePosters,
  handleBulkTempAction,
  cancelPostAudienceFetch,
} from './domains/quote-sweep.js';
import { handleImportData } from './domains/import-export.js';
import {
  handleCheckCarCacheStatus,
  handleEstimateCarSize,
  handleInvalidateCarCache,
} from './domains/car-handlers.js';
import { clearStaleSyncState } from './domains/init.js';
import { handleAssignDurationToPermanent } from './domains/action-duration.js';

const log = createLogger('background');

// Re-exports for test compatibility
export { sendNotification } from './domains/api-client.js';
export { unblockUser, unmuteUser, blockUser } from './domains/graph-ops.js';
export { performFullSync, setupSyncAlarm } from './domains/sync.js';
export { checkExpirations, setupAlarm } from './domains/expiration.js';

// ============================================================================
// Alarm Listener
// ============================================================================

const ALARM_NAME = 'checkExpirations';
const SYNC_ALARM_NAME = 'syncWithBluesky';

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POST_BATCH_ALARM) return wakePostBatches();
  if (alarm.name === ALARM_NAME) return checkExpirations();
  if (alarm.name === SYNC_ALARM_NAME) return performFullSync();
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
    await saveAuthToken(auth);
    return { success: true };
  },
  GET_AUTH_STATUS: async () => {
    const auth = await getAuthToken();
    return { success: true, isAuthenticated: !!auth };
  },

  // ── Expiration & sync ──────────────────────────────────────────────────
  CHECK_NOW: async () => expirationCheckResponse(await checkExpirations()),
  SYNC_NOW: async () => performFullSync(),

  // ── Block/mute operations ──────────────────────────────────────────────
  CREATE_TEMP_ACTION: async ({ did, handle, durationMs, isMute, isPermanent, expectedOwner }) =>
    handleCreateTempAction(did, handle, durationMs, isMute, isPermanent, expectedOwner),
  UNBLOCK_USER: async ({ did }) => handleUnblockRequest(did),
  UNMUTE_USER: async ({ did }) => handleUnmuteRequest(did),
  TEMP_UNBLOCK_FOR_VIEW: async ({ did }) => handleTempUnblockForView(did),
  REBLOCK_USER: async ({ did }) => handleReblockUser(did),

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
  GET_PDS_RECORD_COUNTS: async () => handleGetPdsRecordCounts(),

  // ── Misc ───────────────────────────────────────────────────────────────
  RESOLVE_HANDLE: async ({ handle }) => handleResolveHandle(handle),
  DEBUG_FIND_ORPHAN_BLOCKS: async () => handleDebugFindOrphanBlocks(),
  FETCH_POSTS_PUBLIC: async ({ uris }) => handleFetchPostsPublic(uris),
  IMPORT_DATA: async ({ data, options }) => handleImportData(data, options),

  // ── Quote Sweep ────────────────────────────────────────────────────────
  GET_QUOTE_POSTERS: async ({ postRef, audience, requestId }) =>
    handleFetchQuotePosters(postRef, audience, requestId),
  CANCEL_POST_AUDIENCE_FETCH: ({ requestId }) => {
    cancelPostAudienceFetch(requestId);
    return { success: true };
  },
  START_POST_BATCH: (input) => startPostBatch(input),
  GET_POST_BATCHES: () => getPostBatches(),
  STOP_POST_BATCH: ({ id }) => stopPostBatch(id),
  UNDO_POST_BATCH: ({ id, confirmed }) => undoPostBatch(id, confirmed),
  BULK_TEMP_ACTION: async ({ dids, handles, isMute, durationMs, isPermanent }) =>
    handleBulkTempAction(dids, handles, isMute, durationMs, isPermanent),

  // Add expiration tracking without creating another server action.
  ASSIGN_DURATION_TO_PERMANENT: async ({ did, actionType, duration }) =>
    handleAssignDurationToPermanent(did, actionType, duration),
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
  await clearStaleSyncState();
  // Cancel obsolete periodic work without changing its stored data.
  await browser.alarms.clear('followsSync');
  await browser.alarms.clear('clearskyQueue');
  setupAlarm();
  setupSyncAlarm();
  browser.action.setBadgeText({ text: '' });
}

registerExpirationSettingsListener();
browser.runtime.onInstalled.addListener(() => initialize('installed'));
browser.runtime.onStartup.addListener(() => initialize('started'));
initialize('script-load');
initializePostBatches().catch((error: unknown) =>
  log.error('Could not recover post operations:', error)
);
