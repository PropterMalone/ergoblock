/**
 * Delayed Block - Last Word feature
 * Allows users to schedule blocks after a delay (e.g., mute first, block later)
 */

import browser from '../platform/browser.js';
import { getAuthToken } from './api-client.js';
import { blockUser, unmuteUser } from './graph-ops.js';
import {
  addPendingDelayedBlock,
  getPendingDelayedBlock,
  removePendingDelayedBlock,
  addTempBlock,
  addHistoryEntry,
  getOptions,
} from '../platform/storage.js';
import { DelayedBlockEntry } from '../types.js';
import { createLogger } from '../platform/utils.js';

const log = createLogger('bg:delayed-block');

// Prefix for delayed block alarms
export const DELAYED_BLOCK_ALARM_PREFIX = 'delayed_block_';

/**
 * Handle scheduling a delayed block (Last Word feature)
 * Creates an alarm and stores the pending block
 */
export async function handleScheduleDelayedBlock(
  did: string,
  handle: string,
  blockDurationMs: number,
  permanent: boolean,
  delaySeconds: number,
  mutedFirst: boolean
): Promise<{ success: boolean; error?: string; delaySeconds?: number }> {
  try {
    // Validate delay is within bounds (10 seconds to 1 hour)
    const clampedDelay = Math.max(10, Math.min(3600, delaySeconds));

    // Store the pending block entry
    const entry: DelayedBlockEntry = {
      did,
      handle,
      blockDurationMs,
      executeAt: Date.now() + clampedDelay * 1000,
      permanent,
      mutedFirst,
    };
    await addPendingDelayedBlock(entry);

    // Create an alarm to execute the block
    const alarmName = `${DELAYED_BLOCK_ALARM_PREFIX}${did}`;
    await browser.alarms.create(alarmName, {
      when: entry.executeAt,
    });

    log.info(
      `Scheduled delayed block for @${handle} in ${clampedDelay}s (permanent: ${permanent})`
    );
    return { success: true, delaySeconds: clampedDelay };
  } catch (error) {
    log.error('Failed to schedule delayed block:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Execute a delayed block when the alarm fires
 */
export async function executeDelayedBlock(did: string): Promise<void> {
  try {
    const entry = await getPendingDelayedBlock(did);
    if (!entry) {
      log.info('No pending delayed block found for:', did);
      return;
    }

    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      log.error('Not authenticated for delayed block execution');
      // Keep the pending entry for retry later
      return;
    }

    // Get options to check if we should unmute first
    const options = await getOptions();

    // If user was muted first, unmute them before blocking
    if (entry.mutedFirst && options.lastWordMuteEnabled) {
      try {
        await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
        log.info('Last Word: Unmuted user before block:', entry.handle);
      } catch (unmuteErr) {
        log.error('Failed to unmute before block:', unmuteErr);
        // Continue with blocking anyway
      }
    }

    // Execute the block
    const blockResult = await blockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
    log.info('Last Word: Blocked user:', entry.handle, 'result:', blockResult);

    // If it's a temp block, store it in temp blocks storage
    if (!entry.permanent && entry.blockDurationMs > 0) {
      let rkey: string | undefined;
      if (blockResult?.uri) {
        const parts = blockResult.uri.split('/');
        rkey = parts[parts.length - 1];
      }
      await addTempBlock(did, entry.handle, entry.blockDurationMs, rkey);
      log.info('Last Word: Added temp block for', entry.handle, 'duration:', entry.blockDurationMs);
    }

    // Add to history
    await addHistoryEntry({
      did,
      handle: entry.handle,
      action: 'blocked',
      timestamp: Date.now(),
      trigger: 'manual', // It was initiated manually, just delayed
      success: true,
      duration: entry.permanent ? undefined : entry.blockDurationMs,
    });

    // Remove from pending storage
    await removePendingDelayedBlock(did);
    log.info('Last Word: Block executed successfully for:', entry.handle);
  } catch (error) {
    log.error('Failed to execute delayed block:', error);
    // Remove from pending to prevent retries on permanent failures
    await removePendingDelayedBlock(did);
  }
}
