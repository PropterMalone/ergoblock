/**
 * Background service worker initialization - extracted from background.ts
 */

import browser from '../platform/browser.js';
import { getSyncState, updateSyncState, getSocialGraph } from '../platform/storage.js';
import { clearClearskyCache } from '../platform/clearskyCache.js';
import { createLogger } from '../platform/utils.js';

const log = createLogger('bg:init');

const MAX_SYNC_DURATION_MS = 10 * 60 * 1000;

/**
 * Clear any stale sync state on startup.
 * Handles the case where the extension was closed mid-sync
 * or the service worker was terminated during a sync operation.
 */
export async function clearStaleSyncState(): Promise<void> {
  const state = await getSyncState();
  if (state.syncInProgress) {
    const now = Date.now();
    const syncStartTime = state.lastBlockSync || state.lastMuteSync || 0;
    const syncAge = now - syncStartTime;

    if (syncAge > MAX_SYNC_DURATION_MS || syncStartTime === 0) {
      log.info(`Clearing stale syncInProgress flag (age: ${Math.round(syncAge / 1000)}s)`);
      await updateSyncState({
        syncInProgress: false,
        lastError: 'Sync was interrupted (service worker restart)',
      });
    } else {
      log.info(`Sync in progress flag set (age: ${Math.round(syncAge / 1000)}s) - may be ongoing`);
    }
  }
}

/**
 * Clear old bloated storage data that was causing quota issues.
 * One-time migration to lighter storage format.
 */
export async function clearBloatedStorageData(): Promise<void> {
  try {
    const existingGraph = await getSocialGraph();
    if (existingGraph.follows.length > 0 || existingGraph.followers.length > 0) {
      log.info('Clearing old bloated socialGraph storage...');
      await browser.storage.local.remove('socialGraph');
      log.info('Old socialGraph cleared');
    }
  } catch (error) {
    log.error('Error clearing bloated storage:', error);
  }
}

/**
 * One-time migration to fix Clearsky cache that was using wrong endpoint.
 * The /blocklist endpoint was returning who the user blocks, not who blocks them.
 * This clears the cache so fresh data is fetched from /single-blocklist.
 */
export async function migrateBlockedByCache(): Promise<void> {
  const MIGRATION_KEY = 'clearskyBlockedByMigrationV1';
  const result = await browser.storage.local.get(MIGRATION_KEY);
  if (result[MIGRATION_KEY]) {
    return;
  }

  log.info('Migrating: Clearing Clearsky blocked-by cache (wrong endpoint fix)');
  await clearClearskyCache();
  await browser.storage.local.set({ [MIGRATION_KEY]: true });
  log.info('Migration complete');
}
