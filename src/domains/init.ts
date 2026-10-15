/** Background service worker initialization. */
import { getSyncState, updateSyncState } from '../platform/storage.js';
import { createLogger } from '../platform/utils.js';
const log = createLogger('bg:init');
const MAX_SYNC_DURATION_MS = 10 * 60 * 1000;

export async function clearStaleSyncState(): Promise<void> {
  const state = await getSyncState();
  if (state.syncInProgress) {
    const syncStartTime = state.lastBlockSync || state.lastMuteSync || 0;
    const syncAge = Date.now() - syncStartTime;
    if (syncAge > MAX_SYNC_DURATION_MS || syncStartTime === 0) {
      log.info(`Clearing stale syncInProgress flag (age: ${Math.round(syncAge / 1000)}s)`);
      await updateSyncState({
        syncInProgress: false,
        lastError: 'Sync was interrupted (service worker restart)',
      });
    }
  }
}
