/**
 * Storage management for extension data
 * Handles options, action history, and temporary blocks/mutes
 */

import { DEFAULT_OPTIONS, type ExtensionOptions, type HistoryEntry } from './types.js';

const STORAGE_KEYS = {
  TEMP_BLOCKS: 'tempBlocks',
  TEMP_MUTES: 'tempMutes',
  OPTIONS: 'extensionOptions',
  ACTION_HISTORY: 'actionHistory',
};

const HISTORY_MAX_ENTRIES = 100;
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours default

// ============================================================================
// Core temp blocks/mutes functions - imported from existing storage.js logic
// ============================================================================

interface TempBlockData {
  handle: string;
  expiresAt: number;
  createdAt: number;
}

interface TempBlocksMap {
  [did: string]: TempBlockData;
}

/**
 * Get all temp blocks from storage
 */
export async function getTempBlocks(): Promise<TempBlocksMap> {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_BLOCKS);
  return (result[STORAGE_KEYS.TEMP_BLOCKS] as TempBlocksMap) || {};
}

/**
 * Get all temp mutes from storage
 */
export async function getTempMutes(): Promise<TempBlocksMap> {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_MUTES);
  return (result[STORAGE_KEYS.TEMP_MUTES] as TempBlocksMap) || {};
}

/**
 * Add a temp block
 * @param did - User's DID
 * @param handle - User's handle
 * @param durationMs - Duration in milliseconds (default 24h)
 */
export async function addTempBlock(
  did: string,
  handle: string,
  durationMs: number = DEFAULT_DURATION_MS
): Promise<void> {
  const blocks = await getTempBlocks();
  blocks[did] = {
    handle,
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now(),
  };
  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
  // Notify background to set alarm
  chrome.runtime.sendMessage({
    type: 'TEMP_BLOCK_ADDED',
    did,
    expiresAt: blocks[did].expiresAt,
  });
}

/**
 * Remove a temp block
 * @param did - User's DID
 */
export async function removeTempBlock(did: string): Promise<void> {
  const blocks = await getTempBlocks();
  delete blocks[did];
  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
}

/**
 * Add a temp mute
 * @param did - User's DID
 * @param handle - User's handle
 * @param durationMs - Duration in milliseconds (default 24h)
 */
export async function addTempMute(
  did: string,
  handle: string,
  durationMs: number = DEFAULT_DURATION_MS
): Promise<void> {
  const mutes = await getTempMutes();
  mutes[did] = {
    handle,
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now(),
  };
  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
  // Notify background to set alarm
  chrome.runtime.sendMessage({
    type: 'TEMP_MUTE_ADDED',
    did,
    expiresAt: mutes[did].expiresAt,
  });
}

/**
 * Remove a temp mute
 * @param did - User's DID
 */
export async function removeTempMute(did: string): Promise<void> {
  const mutes = await getTempMutes();
  delete mutes[did];
  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
}

// ============================================================================
// Options management
// ============================================================================

/**
 * Get extension options from local storage
 */
export async function getOptions(): Promise<ExtensionOptions> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS);
  return (result[STORAGE_KEYS.OPTIONS] as ExtensionOptions) || DEFAULT_OPTIONS;
}

/**
 * Set extension options in local storage
 */
export async function setOptions(options: ExtensionOptions): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS]: options });
}

// ============================================================================
// Action history management
// ============================================================================

/**
 * Get action history from local storage
 * Returns entries in reverse chronological order (newest first)
 */
export async function getActionHistory(): Promise<HistoryEntry[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.ACTION_HISTORY);
  const history = result[STORAGE_KEYS.ACTION_HISTORY] || [];
  return history as HistoryEntry[];
}

/**
 * Add an entry to action history
 * Maintains a maximum of HISTORY_MAX_ENTRIES
 */
export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  // Generate ID if not provided
  const entryWithId = {
    ...entry,
    id: entry.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };

  const history = await getActionHistory();
  history.unshift(entryWithId); // Add to beginning (newest first)

  // Keep only the last HISTORY_MAX_ENTRIES
  const trimmed = history.slice(0, HISTORY_MAX_ENTRIES);

  await chrome.storage.local.set({ [STORAGE_KEYS.ACTION_HISTORY]: trimmed });
}

// ============================================================================
// Cleanup functions for expired entries
// ============================================================================

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

  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: updated });
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

  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: updated });
}
