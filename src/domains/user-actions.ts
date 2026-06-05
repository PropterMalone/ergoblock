/**
 * User Actions - Handle user-initiated block/unblock/mute/unmute operations
 */

import { getAuthToken } from './api-client.js';
import { unblockUser, unmuteUser, blockUser, muteUser } from './graph-ops.js';
import {
  getTempBlocks,
  getPermanentBlocks,
  setPermanentBlocks,
  getPermanentMutes,
  setPermanentMutes,
  addTempBlock,
  addTempMute,
  addHistoryEntry,
  setHasCreatedAction,
} from '../platform/storage.js';
import { createLogger } from '../platform/utils.js';

const log = createLogger('bg:user-actions');

/**
 * Handle unblock request from popup
 */
export async function handleUnblockRequest(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the rkey from storage if available (check both temp and permanent blocks)
    const [tempBlocks, permanentBlocks] = await Promise.all([
      getTempBlocks(),
      getPermanentBlocks(),
    ]);
    const rkey = tempBlocks[did]?.rkey || permanentBlocks[did]?.rkey;

    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, rkey);
    return { success: true };
  } catch (error) {
    log.error('Unblock failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle unmute request from popup
 */
export async function handleUnmuteRequest(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
    return { success: true };
  } catch (error) {
    log.error('Unmute failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle temp unblock for viewing a post context
 * This unblocks without removing from storage - we'll reblock shortly
 */
export async function handleTempUnblockForView(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the rkey from permanent blocks storage
    const permanentBlocks = await getPermanentBlocks();
    const blockData = permanentBlocks[did];
    const rkey = blockData?.rkey;
    log.info(
      'Permanent block data for',
      did,
      ':',
      blockData ? { rkey: blockData.rkey, handle: blockData.handle } : 'not found'
    );

    // Also check temp blocks
    const tempBlocks = await getTempBlocks();
    const tempBlockData = tempBlocks[did];
    const tempRkey = tempBlockData?.rkey;
    log.info(
      'Temp block data for',
      did,
      ':',
      tempBlockData ? { rkey: tempBlockData.rkey, handle: tempBlockData.handle } : 'not found'
    );

    const rkeyToUse = rkey || tempRkey;
    log.info('Using rkey:', rkeyToUse || '(none - will scan)');

    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, rkeyToUse);
    log.info('Temp unblocked for viewing:', did);
    return { success: true };
  } catch (error) {
    log.error('Temp unblock for view failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle reblock after temp unblock for viewing
 */
export async function handleReblockUser(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = await blockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
    log.info('Re-blocked user:', did, 'result:', result);

    // Update the rkey in permanent storage if this was a permanent block
    if (result) {
      const rkey = result.uri.split('/').pop();
      if (rkey) {
        const permanentBlocks = await getPermanentBlocks();
        if (permanentBlocks[did]) {
          permanentBlocks[did].rkey = rkey;
          await setPermanentBlocks(permanentBlocks);
        }
      }
    }

    return { success: true };
  } catch (error) {
    log.error('Reblock failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle creating a block or mute from the popup (action-surface).
 * Uses the cached background auth, so the user must have already
 * synced auth from a Bluesky tab at least once.
 */
export async function handleCreateTempAction(
  did: string,
  handle: string,
  durationMs: number,
  isMute: boolean,
  isPermanent: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated. Open Bluesky in a tab to connect.' };
    }

    const now = Date.now();

    if (isMute) {
      await muteUser(did, auth.accessJwt, auth.pdsUrl);

      if (isPermanent) {
        const permanentMutes = await getPermanentMutes();
        permanentMutes[did] = { did, handle, createdAt: now, syncedAt: now };
        await setPermanentMutes(permanentMutes);
        await setHasCreatedAction();
      } else {
        await addTempMute(did, handle, durationMs);
      }
    } else {
      const result = await blockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
      const rkey = result?.uri ? result.uri.split('/').pop() : undefined;

      if (isPermanent) {
        const permanentBlocks = await getPermanentBlocks();
        permanentBlocks[did] = { did, handle, createdAt: now, syncedAt: now, rkey };
        await setPermanentBlocks(permanentBlocks);
        await setHasCreatedAction();
      } else {
        await addTempBlock(did, handle, durationMs, rkey);
      }
    }

    await addHistoryEntry({
      did,
      handle,
      action: isMute ? 'muted' : 'blocked',
      timestamp: Date.now(),
      trigger: 'manual',
      success: true,
      duration: isPermanent ? undefined : durationMs,
    });

    return { success: true };
  } catch (error) {
    log.error('Create temp action failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
