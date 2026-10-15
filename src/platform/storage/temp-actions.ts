/**
 * Temp blocks/mutes CRUD and cleanup
 */

import browser from '../browser.js';
import { send } from '../messages.js';
import { isValidDid, isValidDuration, createLogger } from '../utils.js';
import { STORAGE_KEYS, DEFAULT_DURATION_MS } from './keys.js';
import { safeSyncStorageWrite } from './quota.js';
import { setHasCreatedAction } from './state.js';
import {
  withTrackingLock,
  trackingMatches,
  type TrackingIdentity,
  type TrackingEntryOptions,
  type TrackingMutationOptions,
} from './tracking.js';

const log = createLogger('storage');

export interface TempBlockData extends TrackingIdentity {
  handle: string;
  expiresAt: number;
  createdAt: number;
  rkey?: string;
}

export interface TempBlocksMap {
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
 * @throws Error if DID or duration is invalid
 */
export async function addTempBlock(
  did: string,
  handle: string,
  durationMs: number = DEFAULT_DURATION_MS,
  rkey?: string,
  options: TrackingEntryOptions = {}
): Promise<TempBlockData> {
  // Validate inputs
  if (!isValidDid(did)) {
    throw new Error(`Invalid DID format: ${did}`);
  }
  if (!isValidDuration(durationMs)) {
    throw new Error(`Invalid duration: ${durationMs}ms (must be positive and less than 1 year)`);
  }
  if (!handle || typeof handle !== 'string' || handle.length === 0) {
    throw new Error('Handle is required');
  }

  const entry = await withTrackingLock(async () => {
    const blocks = await getTempBlocks();
    const entry: TempBlockData = {
      handle,
      expiresAt: Date.now() + durationMs,
      createdAt: Date.now(),
      rkey,
      ...(options.ownerDid ? { ownerDid: options.ownerDid } : {}),
      trackingId: options.trackingId ?? crypto.randomUUID(),
    };
    blocks[did] = entry;
    await options.beforeWrite?.();
    await safeSyncStorageWrite(STORAGE_KEYS.TEMP_BLOCKS, blocks);
    return entry;
  }, options.lock);

  // Mark that user has created their first action for first-run detection
  await setHasCreatedAction();

  // MEDIUM FIX #10: Notify background with retry mechanism
  // If background is inactive in MV3, retry a few times before giving up
  // The alarm will also be recovered on service worker startup
  const notifyBackground = async (retries = 3): Promise<void> => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await send('TEMP_BLOCK_ADDED', {
          did,
          expiresAt: entry.expiresAt,
        });
        return; // Success
      } catch (err) {
        if (attempt === retries - 1) {
          // Final attempt failed - log warning (alarm will be recovered on SW wake)
          log.warn(
            'Could not notify background after retries, alarm will be set on next wake:',
            err instanceof Error ? err.message : err
          );
        } else {
          // Wait before retry (100ms, 200ms)
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 100));
        }
      }
    }
  };
  notifyBackground().catch((error) => log.warn('Temp block notification failed:', error));
  return entry;
}

/**
 * Remove a temp block
 * @param did - User's DID
 */
export async function removeTempBlock(
  did: string,
  expected?: TrackingIdentity,
  options: TrackingMutationOptions = {}
): Promise<boolean> {
  return withTrackingLock(async () => {
    const blocks = await getTempBlocks();
    if (!blocks[did] || (expected && !trackingMatches(blocks[did], expected))) return false;
    await options.beforeWrite?.();
    delete blocks[did];
    await browser.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
    return true;
  }, options.lock);
}

/**
 * Add a temp mute
 * @param did - User's DID
 * @param handle - User's handle
 * @param durationMs - Duration in milliseconds (default 24h)
 * @throws Error if DID or duration is invalid
 */
export async function addTempMute(
  did: string,
  handle: string,
  durationMs: number = DEFAULT_DURATION_MS,
  options: TrackingEntryOptions = {}
): Promise<TempBlockData> {
  // Validate inputs
  if (!isValidDid(did)) {
    throw new Error(`Invalid DID format: ${did}`);
  }
  if (!isValidDuration(durationMs)) {
    throw new Error(`Invalid duration: ${durationMs}ms (must be positive and less than 1 year)`);
  }
  if (!handle || typeof handle !== 'string' || handle.length === 0) {
    throw new Error('Handle is required');
  }

  const entry = await withTrackingLock(async () => {
    const mutes = await getTempMutes();
    const entry: TempBlockData = {
      handle,
      expiresAt: Date.now() + durationMs,
      createdAt: Date.now(),
      ...(options.ownerDid ? { ownerDid: options.ownerDid } : {}),
      trackingId: options.trackingId ?? crypto.randomUUID(),
    };
    mutes[did] = entry;
    await options.beforeWrite?.();
    await safeSyncStorageWrite(STORAGE_KEYS.TEMP_MUTES, mutes);
    return entry;
  }, options.lock);

  // Mark that user has created their first action for first-run detection
  await setHasCreatedAction();

  // Notify background to set alarm
  send('TEMP_MUTE_ADDED', {
    did,
    expiresAt: entry.expiresAt,
  }).catch((err) => {
    // Background may be inactive in MV3 - alarm will be set on next wake
    log.debug('Background not ready for temp mute notification:', err?.message || err);
  });
  return entry;
}

/**
 * Remove a temp mute
 * @param did - User's DID
 */
export async function removeTempMute(
  did: string,
  expected?: TrackingIdentity,
  options: TrackingMutationOptions = {}
): Promise<boolean> {
  return withTrackingLock(async () => {
    const mutes = await getTempMutes();
    if (!mutes[did] || (expected && !trackingMatches(mutes[did], expected))) return false;
    await options.beforeWrite?.();
    delete mutes[did];
    await browser.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
    return true;
  }, options.lock);
}

/**
 * Remove all expired temp blocks
 */
export async function removeAllExpiredBlocks(): Promise<void> {
  await withTrackingLock(async () => {
    const blocks = await getTempBlocks();
    const now = Date.now();
    for (const [did, data] of Object.entries(blocks)) {
      if (data.expiresAt <= now) delete blocks[did];
    }
    await browser.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
  });
}

/**
 * Remove all expired temp mutes
 */
export async function removeAllExpiredMutes(): Promise<void> {
  await withTrackingLock(async () => {
    const mutes = await getTempMutes();
    const now = Date.now();
    for (const [did, data] of Object.entries(mutes)) {
      if (data.expiresAt <= now) delete mutes[did];
    }
    await browser.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
  });
}
