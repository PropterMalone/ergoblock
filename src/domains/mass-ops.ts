/**
 * Mass Operations - Detect and undo mass follows/blocks
 */

import { getAuthToken, bgApiRequest } from './api-client.js';
import { invalidateFollowsCache } from './social-graph.js';
import {
  saveMassOpsScanResult,
  getDismissedMassOpsClusters,
  isClusterDismissed,
  setCarDownloadProgress,
  clearCarDownloadProgress,
  addHistoryEntry,
  getMassOpsSettings,
  setMassOpsSettings,
  dismissMassOpsCluster,
  type DismissedCluster,
} from '../platform/storage.js';
import { invalidateCarCache } from '../platform/carCache.js';
import { detectMassOperations } from './carRepo.js';
import { getGraphOperationsSmart, type CarDownloadProgress } from './carService.js';
import { MassOpsSettings, GraphOperation } from '../types.js';
import { sleep, createLogger } from '../platform/utils.js';
import browser from '../platform/browser.js';

const log = createLogger('bg:mass-ops');

/**
 * Scan user's CAR file for mass operations
 * Uses smart caching to avoid redundant downloads
 */
export async function handleScanMassOps(settings: MassOpsSettings, forceRefresh = false) {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    log.info('Starting mass ops scan with settings:', settings);

    // Use the smart service with progress reporting
    // When not forcing refresh, prefer cached data (even if stale) for historical analysis
    const result = await getGraphOperationsSmart({
      did: auth.did,
      pdsUrl: auth.pdsUrl,
      forceRefresh,
      preferCache: !forceRefresh,
      onProgress: async (progress: CarDownloadProgress) => {
        log.info(`Mass ops scan: ${progress.message}`);
        // Update storage so UI can read progress
        await setCarDownloadProgress({
          did: progress.did,
          stage: progress.stage,
          bytesDownloaded: progress.bytesDownloaded,
          bytesTotal: progress.bytesTotal,
          percentComplete: progress.percentComplete,
          message: progress.message,
          isIncremental: progress.isIncremental,
          startedAt: progress.startedAt,
          error: progress.error,
        });
      },
    });

    // Detect mass operations from the cached/downloaded data
    const allClusters = detectMassOperations(
      {
        blocks: result.blocks,
        follows: result.follows,
        listitems: result.listitems,
      },
      settings
    );

    // Filter out dismissed clusters
    const dismissedClusters = await getDismissedMassOpsClusters();
    const clusters = allClusters.filter(
      (cluster) => !isClusterDismissed(cluster, dismissedClusters)
    );

    // Save the scan result
    await saveMassOpsScanResult({
      clusters,
      scannedAt: Date.now(),
      operationCounts: {
        blocks: result.blocks.length,
        follows: result.follows.length,
        listitems: result.listitems.length,
      },
    });

    // Clear progress
    await clearCarDownloadProgress();

    log.info(
      `Mass ops scan complete: ${clusters.length} clusters found, ` +
        `${result.blocks.length} blocks, ${result.follows.length} follows, ` +
        `${result.listitems.length} list items ` +
        `(cached: ${result.wasCached}, incremental: ${result.wasIncremental})`
    );

    return { success: true };
  } catch (error) {
    log.error('Mass ops scan failed:', error);
    // Clear progress on error
    await clearCarDownloadProgress();
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Undo (delete) selected mass operations
 * Rate-limited to avoid API throttling
 */
export async function handleUndoMassOperations(operations: GraphOperation[]) {
  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    return { success: false, undone: 0, failed: operations.length, errors: ['Not authenticated'] };
  }

  let undone = 0;
  let failed = 0;
  const errors: string[] = [];

  log.info(`Undoing ${operations.length} mass operations`);

  for (const op of operations) {
    try {
      // Determine the collection based on operation type
      const collection =
        op.type === 'block'
          ? 'app.bsky.graph.block'
          : op.type === 'follow'
            ? 'app.bsky.graph.follow'
            : 'app.bsky.graph.listitem';

      const response = await bgApiRequest<{ success?: boolean }>(
        'com.atproto.repo.deleteRecord',
        'POST',
        {
          repo: auth.did,
          collection,
          rkey: op.rkey,
        },
        auth.accessJwt,
        auth.pdsUrl
      );

      if (response) {
        undone++;

        // Add history entry for blocks/follows (not list items - too noisy)
        if (op.type === 'block' || op.type === 'follow') {
          await addHistoryEntry({
            did: op.did,
            handle: op.did, // We don't have handle here, use DID
            action: op.type === 'block' ? 'unblocked' : 'unblocked', // Use unblocked for follows too
            timestamp: Date.now(),
            trigger: 'manual',
            success: true,
          });
        }
      } else {
        failed++;
        errors.push(`Failed to delete ${op.type} for ${op.did}`);
      }

      // Rate limit: 350ms between operations
      await sleep(350);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${op.type} ${op.did}: ${errorMsg}`);
      log.error(`Failed to undo ${op.type} for ${op.did}:`, error);
    }
  }

  // Invalidate follows cache if we deleted follows
  if (operations.some((op) => op.type === 'follow')) {
    invalidateFollowsCache();
  }

  // Invalidate CAR cache to force re-download on next scan
  await invalidateCarCache(auth.did);

  log.info(`Mass ops undo complete: ${undone} undone, ${failed} failed`);

  return { success: failed === 0, undone, failed, errors };
}

export async function handleGetMassOpsSettings(): Promise<{
  success: boolean;
  settings: MassOpsSettings;
}> {
  const settings = await getMassOpsSettings();
  return { success: true, settings };
}

export async function handleSetMassOpsSettings(
  settings: MassOpsSettings
): Promise<{ success: boolean }> {
  await setMassOpsSettings(settings);
  return { success: true };
}

export async function handleDismissMassOpsCluster(cluster: {
  type: 'block' | 'follow' | 'listitem';
  startTime: number;
  endTime: number;
  count: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await dismissMassOpsCluster({
      type: cluster.type,
      startTime: cluster.startTime,
      endTime: cluster.endTime,
      count: cluster.count,
      dismissedAt: Date.now(),
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleGetDismissedMassOpsClusters(): Promise<{
  success: boolean;
  dismissed?: DismissedCluster[];
  error?: string;
}> {
  try {
    const dismissed = await getDismissedMassOpsClusters();
    return { success: true, dismissed };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleRestoreMassOpsCluster(cluster: {
  type: 'block' | 'follow' | 'listitem';
  startTime: number;
  endTime: number;
  count: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const dismissed = await getDismissedMassOpsClusters();
    const filtered = dismissed.filter(
      (d) =>
        !(
          d.type === cluster.type &&
          d.startTime === cluster.startTime &&
          d.endTime === cluster.endTime &&
          d.count === cluster.count
        )
    );
    await browser.storage.local.set({ massOpsDismissedClusters: filtered });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
