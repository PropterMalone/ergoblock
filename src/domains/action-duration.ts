/** Add expiration tracking to a block or mute that already exists on Bluesky. */
import { createLogger } from '../platform/utils.js';
import {
  getPermanentBlocks,
  getPermanentMutes,
  addTempBlock,
  addTempMute,
} from '../platform/storage.js';
import { getAuthToken, withAuthSession, captureAuthGeneration } from './api-client.js';
import { withTrackingLock } from '../platform/storage/tracking.js';
const log = createLogger('bg:action-duration');

export async function handleAssignDurationToPermanent(
  did: string,
  actionType: 'block' | 'mute',
  duration: number
): Promise<{ success: boolean; error?: string }> {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { success: false, error: 'Duration must be a positive number' };
  }
  if (actionType !== 'block' && actionType !== 'mute') {
    return { success: false, error: 'Invalid action type' };
  }
  try {
    const generation = captureAuthGeneration();
    const auth = await getAuthToken();
    if (!auth) return { success: false, error: 'Not authenticated' };
    return await withAuthSession(
      auth,
      () =>
        withTrackingLock(async (lock) => {
          const entry =
            actionType === 'block'
              ? (await getPermanentBlocks())[did]
              : (await getPermanentMutes())[did];
          if (!entry)
            return {
              success: false,
              error: actionType === 'block' ? 'Block not found' : 'Mute not found',
            };
          if (entry.ownerDid && entry.ownerDid !== auth.did)
            return { success: false, error: 'Tracking belongs to another account' };
          const options = { lock, ownerDid: auth.did };
          if (actionType === 'block')
            await addTempBlock(did, entry.handle, duration, entry.rkey, options);
          else await addTempMute(did, entry.handle, duration, options);
          return { success: true };
        }),
      generation
    );
  } catch (error) {
    log.error('Failed to assign duration:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
