/**
 * Temp blocks/mutes CRUD and cleanup
 */

import browser from '../browser.js';
import { send } from '../messages.js';
import { isValidDid, isValidDuration, createLogger } from '../utils.js';
import { STORAGE_KEYS, DEFAULT_DURATION_MS } from './keys.js';
import { safeSyncStorageWrite } from './quota.js';
import { setHasCreatedAction } from './state.js';

const log = createLogger('storage');

export interface TempBlockData {
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
  rkey?: string
): Promise<void> {
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

  const blocks = await getTempBlocks();
  blocks[did] = {
    handle,
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now(),
    rkey,
  };
  // Use safe write with quota checking
  await safeSyncStorageWrite(STORAGE_KEYS.TEMP_BLOCKS, blocks);

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
          expiresAt: blocks[did].expiresAt,
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
  notifyBackground().catch(() => {});
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
 * @throws Error if DID or duration is invalid
 */
export async function addTempMute(
  did: string,
  handle: string,
  durationMs: number = DEFAULT_DURATION_MS
): Promise<void> {
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

  const mutes = await getTempMutes();
  mutes[did] = {
    handle,
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now(),
  };
  // Use safe write with quota checking
  await safeSyncStorageWrite(STORAGE_KEYS.TEMP_MUTES, mutes);

  // Mark that user has created their first action for first-run detection
  await setHasCreatedAction();

  // Notify background to set alarm
  send('TEMP_MUTE_ADDED', {
    did,
    expiresAt: mutes[did].expiresAt,
  }).catch((err) => {
    // Background may be inactive in MV3 - alarm will be set on next wake
    log.debug('Background not ready for temp mute notification:', err?.message || err);
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
