/**
 * Extension state - options, sync state, and first-run detection
 */

import browser from '../browser.js';
import {
  DEFAULT_OPTIONS,
  DEFAULT_COLUMN_VISIBILITY,
  DEFAULT_USAGE_STATS,
  type ExtensionOptions,
  type SyncState,
  type ColumnVisibility,
  type UsageStats,
  type ExportData,
} from '../../types.js';
import { STORAGE_KEYS } from './keys.js';

// ── Options ──────────────────────────────────────────────────────────────────

/**
 * Get extension options from local storage
 * Merges with defaults to handle new settings for existing users
 */
export async function getOptions(): Promise<ExtensionOptions> {
  const result = await browser.storage.local.get(STORAGE_KEYS.OPTIONS);
  const stored = result[STORAGE_KEYS.OPTIONS] as Partial<ExtensionOptions> | undefined;
  if (!stored) {
    return DEFAULT_OPTIONS;
  }
  // Merge stored options with defaults to ensure new fields have values
  return {
    ...DEFAULT_OPTIONS,
    ...stored,
  };
}

/**
 * Set extension options in local storage
 */
export async function setOptions(options: ExtensionOptions): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.OPTIONS]: options });
}

// ── Sync State ───────────────────────────────────────────────────────────────

const DEFAULT_SYNC_STATE: SyncState = {
  lastBlockSync: 0,
  lastMuteSync: 0,
  syncInProgress: false,
};

/**
 * Get sync state from local storage
 */
export async function getSyncState(): Promise<SyncState> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SYNC_STATE);
  return (result[STORAGE_KEYS.SYNC_STATE] as SyncState) || DEFAULT_SYNC_STATE;
}

/**
 * Set sync state in local storage
 */
export async function setSyncState(state: SyncState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.SYNC_STATE]: state });
}

/**
 * Update sync state partially
 */
export async function updateSyncState(update: Partial<SyncState>): Promise<void> {
  const current = await getSyncState();
  await setSyncState({ ...current, ...update });
}

// ── First-Run Detection ──────────────────────────────────────────────────────

/**
 * Check if user has ever created a block or mute.
 * Used for first-run onboarding experience.
 */
export async function getHasCreatedAction(): Promise<boolean> {
  const result = await browser.storage.local.get(STORAGE_KEYS.HAS_CREATED_ACTION);
  return result[STORAGE_KEYS.HAS_CREATED_ACTION] === true;
}

/**
 * Mark that user has created their first block or mute.
 * Called when user creates a block/mute for the first time.
 */
export async function setHasCreatedAction(): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.HAS_CREATED_ACTION]: true });
}

// ── Column Visibility ────────────────────────────────────────────────────────

/**
 * Get column visibility settings.
 * Returns default visibility if not set.
 */
export async function getColumnVisibility(): Promise<ColumnVisibility> {
  const result = await browser.storage.local.get(STORAGE_KEYS.COLUMN_VISIBILITY);
  const stored = result[STORAGE_KEYS.COLUMN_VISIBILITY];

  if (!stored) {
    return DEFAULT_COLUMN_VISIBILITY;
  }

  // Merge with defaults in case new columns were added
  return { ...DEFAULT_COLUMN_VISIBILITY, ...stored };
}

/**
 * Update column visibility settings.
 * Only updates the columns that are toggleable (not user or actions).
 */
export async function setColumnVisibility(visibility: Partial<ColumnVisibility>): Promise<void> {
  const current = await getColumnVisibility();
  const updated: ColumnVisibility = {
    ...current,
    ...visibility,
    // Enforce always-visible columns
    user: true,
    actions: true,
  };
  await browser.storage.local.set({ [STORAGE_KEYS.COLUMN_VISIBILITY]: updated });
}

// ── Usage Statistics ─────────────────────────────────────────────────────────

/**
 * Get usage statistics from storage
 */
export async function getUsageStats(): Promise<UsageStats> {
  const result = await browser.storage.local.get(STORAGE_KEYS.USAGE_STATS);
  const stored = result[STORAGE_KEYS.USAGE_STATS] as UsageStats | undefined;
  return stored ? { ...DEFAULT_USAGE_STATS, ...stored } : { ...DEFAULT_USAGE_STATS };
}

/**
 * Reset usage statistics to defaults
 */
export async function resetUsageStats(): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEYS.USAGE_STATS]: { ...DEFAULT_USAGE_STATS, statsResetAt: Date.now() },
  });
}

// ── Import/Export Validation ─────────────────────────────────────────────────

/**
 * Validate that data matches the ExportData format
 */
export function validateExportData(data: unknown): data is ExportData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (typeof d.version !== 'string') return false;
  if (typeof d.exportedAt !== 'number') return false;
  if (!Array.isArray(d.blocks)) return false;
  if (!Array.isArray(d.mutes)) return false;
  return true;
}
