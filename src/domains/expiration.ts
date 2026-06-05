/**
 * Expiration Engine - Auto-expire temporary blocks and mutes
 * Processes expired items and handles rollbacks from failed storage operations
 */

import browser from '../platform/browser.js';
import { getAuthToken, requestFreshAuth, sendNotification } from './api-client.js';
import { unblockUser, unmuteUser } from './graph-ops.js';
import {
  getTempBlocks,
  getTempMutes,
  removeTempBlock,
  removeTempMute,
  addHistoryEntry,
  cleanupExpiredPostContexts,
  getOptions,
  getProcessableRollbacks,
  updatePendingRollback,
  removePendingRollback,
  cleanupOldRollbacks,
} from '../platform/storage.js';
import { AuthData } from '../types.js';
import { executeApiRequest } from '../platform/api.js';
import { createLogger } from '../platform/utils.js';

const log = createLogger('bg:expiration');

// Maximum concurrent expiration operations (prevents overwhelming the API)
const MAX_CONCURRENT_EXPIRATIONS = 5;

/**
 * Process a single expired block
 */
async function processExpiredBlock(
  did: string,
  data: { handle: string; expiresAt: number; createdAt?: number; rkey?: string },
  auth: AuthData
): Promise<{ success: boolean; authError: boolean }> {
  log.info('Unblocking expired:', data.handle);
  try {
    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, data.rkey);
    await removeTempBlock(did);
    await addHistoryEntry({
      did,
      handle: data.handle,
      action: 'unblocked',
      timestamp: Date.now(),
      trigger: 'auto_expire',
      success: true,
      duration: data.createdAt ? Date.now() - data.createdAt : undefined,
    });
    log.info('Successfully unblocked:', data.handle);
    await sendNotification('expired_success', data.handle, 'block');
    return { success: true, authError: false };
  } catch (error) {
    log.error('Failed to unblock:', data.handle, error);

    const isAuthError =
      error instanceof Error &&
      (error.message.includes('401') || error.message.includes('Auth error'));

    if (!isAuthError) {
      // Only log non-auth failures (auth failures will be retried on next check)
      await addHistoryEntry({
        did,
        handle: data.handle,
        action: 'unblocked',
        timestamp: Date.now(),
        trigger: 'auto_expire',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await sendNotification(
        'expired_failure',
        data.handle,
        'block',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    return { success: false, authError: isAuthError };
  }
}

/**
 * Process a single expired mute
 */
async function processExpiredMute(
  did: string,
  data: { handle: string; expiresAt: number; createdAt?: number },
  auth: AuthData
): Promise<{ success: boolean; authError: boolean }> {
  log.info('Unmuting expired:', data.handle);
  try {
    await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
    await removeTempMute(did);
    await addHistoryEntry({
      did,
      handle: data.handle,
      action: 'unmuted',
      timestamp: Date.now(),
      trigger: 'auto_expire',
      success: true,
      duration: data.createdAt ? Date.now() - data.createdAt : undefined,
    });
    log.info('Successfully unmuted:', data.handle);
    await sendNotification('expired_success', data.handle, 'mute');
    return { success: true, authError: false };
  } catch (error) {
    log.error('Failed to unmute:', data.handle, error);

    const isAuthError =
      error instanceof Error &&
      (error.message.includes('401') || error.message.includes('Auth error'));

    if (!isAuthError) {
      // Only log non-auth failures (auth failures will be retried on next check)
      await addHistoryEntry({
        did,
        handle: data.handle,
        action: 'unmuted',
        timestamp: Date.now(),
        trigger: 'auto_expire',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await sendNotification(
        'expired_failure',
        data.handle,
        'mute',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    return { success: false, authError: isAuthError };
  }
}

/**
 * Process items in batches with concurrency limit
 */
async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  maxConcurrent: number
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += maxConcurrent) {
    const batch = items.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

export async function checkExpirations(): Promise<void> {
  log.info('Checking expirations...');

  // Clean up expired screenshots based on retention policy
  await cleanupExpiredPostContexts();

  let auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    log.info('No auth token available, trying to get fresh auth...');
    auth = await requestFreshAuth();
    if (!auth) {
      log.info('Could not get auth, skipping check');
      await browser.storage.local.set({ authStatus: 'invalid' });
      return;
    }
  }

  log.info('Using PDS:', auth.pdsUrl);
  const now = Date.now();

  // Collect expired blocks and mutes
  const blocks = await getTempBlocks();
  const mutes = await getTempMutes();

  const expiredBlocks = Object.entries(blocks)
    .filter(([, data]) => data.expiresAt <= now)
    .map(([did, data]) => ({ did, data }));

  const expiredMutes = Object.entries(mutes)
    .filter(([, data]) => data.expiresAt <= now)
    .map(([did, data]) => ({ did, data }));

  log.info(`Found ${expiredBlocks.length} expired blocks, ${expiredMutes.length} expired mutes`);

  // At this point auth is guaranteed non-null (we return early above if null)
  let currentAuth: AuthData = auth;

  // Process expired blocks in parallel batches
  if (expiredBlocks.length > 0) {
    let blockResults = await processBatch(
      expiredBlocks,
      ({ did, data }) => processExpiredBlock(did, data, currentAuth),
      MAX_CONCURRENT_EXPIRATIONS
    );

    // If auth errors occurred, try to get fresh auth and retry failed blocks
    if (blockResults.some((r) => r.authError)) {
      log.info('Auth error during block expiration, requesting fresh auth...');
      const freshAuth = await requestFreshAuth();
      if (freshAuth) {
        currentAuth = freshAuth;
        // Find blocks that failed due to auth and retry them
        const failedBlocks = expiredBlocks.filter((_, i) => blockResults[i].authError);
        if (failedBlocks.length > 0) {
          log.info(`Retrying ${failedBlocks.length} blocks with fresh auth`);
          const retryResults = await processBatch(
            failedBlocks,
            ({ did, data }) => processExpiredBlock(did, data, currentAuth),
            MAX_CONCURRENT_EXPIRATIONS
          );
          // Update results for logging
          blockResults = retryResults;
        }
      }
    }

    // Log final result
    const stillFailed = blockResults.filter((r) => r.authError).length;
    if (stillFailed > 0) {
      log.info(`${stillFailed} blocks still failed after retry - will try again on next check`);
    }
  }

  // Process expired mutes in parallel batches
  if (expiredMutes.length > 0) {
    let muteResults = await processBatch(
      expiredMutes,
      ({ did, data }) => processExpiredMute(did, data, currentAuth),
      MAX_CONCURRENT_EXPIRATIONS
    );

    // If auth errors occurred, try to get fresh auth and retry failed mutes
    if (muteResults.some((r) => r.authError)) {
      log.info('Auth error during mute expiration, requesting fresh auth...');
      const freshAuth = await requestFreshAuth();
      if (freshAuth) {
        currentAuth = freshAuth;
        // Find mutes that failed due to auth and retry them
        const failedMutes = expiredMutes.filter((_, i) => muteResults[i].authError);
        if (failedMutes.length > 0) {
          log.info(`Retrying ${failedMutes.length} mutes with fresh auth`);
          const retryResults = await processBatch(
            failedMutes,
            ({ did, data }) => processExpiredMute(did, data, currentAuth),
            MAX_CONCURRENT_EXPIRATIONS
          );
          // Update results for logging
          muteResults = retryResults;
        }
      }
    }

    // Log final result
    const stillFailed = muteResults.filter((r) => r.authError).length;
    if (stillFailed > 0) {
      log.info(`${stillFailed} mutes still failed after retry - will try again on next check`);
    }
  }

  log.info('Expiration check complete');

  // Also process any pending rollbacks (from failed storage operations)
  await processPendingRollbacks();
}

/**
 * Process pending rollbacks from the queue
 * These are unblock/unmute operations that failed after a block/mute API call succeeded
 * but local storage failed, requiring the API action to be undone
 */
async function processPendingRollbacks(): Promise<void> {
  const rollbacks = await getProcessableRollbacks();
  if (rollbacks.length === 0) return;

  log.info(`Processing ${rollbacks.length} pending rollbacks`);

  // Get auth for API calls
  const authResult = await browser.storage.local.get(['authToken']);
  const auth = authResult.authToken as { accessJwt: string; pdsUrl: string } | undefined;

  if (!auth?.accessJwt) {
    log.warn('No auth token available for rollback processing');
    return;
  }

  for (const rollback of rollbacks) {
    try {
      log.info(`Processing rollback: ${rollback.type} for ${rollback.handle}`);

      if (rollback.type === 'unblock') {
        // Unblock the user
        await executeApiRequest(
          `com.atproto.repo.deleteRecord`,
          'POST',
          {
            repo: auth.pdsUrl ? undefined : rollback.did, // Will be set by executeApiRequest
            collection: 'app.bsky.graph.block',
            rkey: rollback.rkey,
          },
          auth
        );
      } else if (rollback.type === 'unmute') {
        // Unmute the user
        await executeApiRequest(
          'app.bsky.graph.unmuteActor',
          'POST',
          { actor: rollback.did },
          auth
        );
      }

      // Success - remove from queue
      await removePendingRollback(rollback.id);
      log.info(`Rollback successful for ${rollback.handle}`);
    } catch (error) {
      // Update attempt count
      await updatePendingRollback(rollback.id, {
        attempts: rollback.attempts + 1,
        lastAttempt: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      log.error(`Rollback failed for ${rollback.handle}:`, error);
    }
  }

  // Periodically clean up old rollbacks that have exceeded max attempts
  const cleaned = await cleanupOldRollbacks();
  if (cleaned > 0) {
    log.info(`Cleaned up ${cleaned} old rollbacks`);
  }
}

/**
 * Set up expiration check alarm
 * @param alarmName - Name for the alarm (default: 'checkExpirations')
 * @param options - Alarm options (periodInMinutes from user settings)
 */
export async function setupAlarm(
  alarmName = 'checkExpirations',
  options?: { periodInMinutes?: number }
): Promise<void> {
  const userOptions = await getOptions();
  const intervalMinutes =
    options?.periodInMinutes ?? Math.max(1, Math.min(10, userOptions.checkInterval));

  await browser.alarms.clear(alarmName);
  await browser.alarms.create(alarmName, {
    periodInMinutes: intervalMinutes,
  });
  log.info('Alarm set up with interval:', intervalMinutes, 'minutes');
}
