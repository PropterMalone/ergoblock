/**
 * Feature-specific storage: repost filter, list audit, mass ops,
 * CAR progress, delayed blocks, and rollback queue
 */

import browser from '../browser.js';
import {
  DEFAULT_MASS_OPS_SETTINGS,
  type RepostFilteredUser,
  type ListAuditReview,
  type MassOpsScanResult,
  type MassOpsSettings,
  type DelayedBlockEntry,
  type PendingRollback,
} from '../../types.js';
import { generateId } from '../utils.js';
import { STORAGE_KEYS } from './keys.js';

// ============================================================================
// Repost Filtering
// ============================================================================

interface RepostFilteredUsersMap {
  [did: string]: RepostFilteredUser;
}

/**
 * Get all repost-filtered users from local storage
 */
export async function getRepostFilteredUsers(): Promise<RepostFilteredUsersMap> {
  const result = await browser.storage.local.get(STORAGE_KEYS.REPOST_FILTERED_USERS);
  return (result[STORAGE_KEYS.REPOST_FILTERED_USERS] as RepostFilteredUsersMap) || {};
}

/**
 * Add a user to the repost filter list
 */
export async function addRepostFilteredUser(user: RepostFilteredUser): Promise<void> {
  const users = await getRepostFilteredUsers();
  users[user.did] = user;
  await browser.storage.local.set({ [STORAGE_KEYS.REPOST_FILTERED_USERS]: users });
}

/**
 * Remove a user from the repost filter list
 */
export async function removeRepostFilteredUser(did: string): Promise<void> {
  const users = await getRepostFilteredUsers();
  delete users[did];
  await browser.storage.local.set({ [STORAGE_KEYS.REPOST_FILTERED_USERS]: users });
}

/**
 * Check if a user is in the repost filter list
 */
export async function isRepostFiltered(did: string): Promise<boolean> {
  const users = await getRepostFilteredUsers();
  return did in users;
}

/**
 * Check if a handle is in the repost filter list (for DOM matching)
 */
export async function isHandleRepostFiltered(handle: string): Promise<boolean> {
  const users = await getRepostFilteredUsers();
  const normalizedHandle = handle.toLowerCase();
  return Object.values(users).some((user) => user.handle.toLowerCase() === normalizedHandle);
}

/**
 * Get repost filtered users as an array (for UI display)
 */
export async function getRepostFilteredUsersArray(): Promise<RepostFilteredUser[]> {
  const users = await getRepostFilteredUsers();
  return Object.values(users).sort((a, b) => b.addedAt - a.addedAt);
}

// ============================================================================
// List Audit
// ============================================================================

/**
 * Get all list audit reviews from storage
 */
export async function getListAuditReviews(): Promise<ListAuditReview[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.LIST_AUDIT_REVIEWS);
  return (result[STORAGE_KEYS.LIST_AUDIT_REVIEWS] as ListAuditReview[]) || [];
}

/**
 * Add a list audit review
 * Updates existing review for the same DID+listUri combination
 */
export async function addListAuditReview(review: ListAuditReview): Promise<void> {
  const reviews = await getListAuditReviews();
  // Remove any existing review for the same DID+list combination
  const filtered = reviews.filter((r) => !(r.did === review.did && r.listUri === review.listUri));
  filtered.push(review);
  await browser.storage.local.set({ [STORAGE_KEYS.LIST_AUDIT_REVIEWS]: filtered });
}

/**
 * Get set of DIDs that have been reviewed for a specific list
 */
export async function getListAuditReviewedDids(listUri: string): Promise<Set<string>> {
  const reviews = await getListAuditReviews();
  const dids = reviews.filter((r) => r.listUri === listUri).map((r) => r.did);
  return new Set(dids);
}

/**
 * Get stats for a specific list's audit reviews
 */
export async function getListAuditStats(
  listUri: string
): Promise<{ reviewed: number; removed: number; kept: number }> {
  const reviews = await getListAuditReviews();
  const listReviews = reviews.filter((r) => r.listUri === listUri);

  return {
    reviewed: listReviews.length,
    removed: listReviews.filter((r) => r.decision === 'removed').length,
    kept: listReviews.filter((r) => r.decision === 'kept').length,
  };
}

/**
 * Clear all reviews for a specific list
 * Useful when user wants to re-audit a list from scratch
 */
export async function clearListAuditReviews(listUri: string): Promise<void> {
  const reviews = await getListAuditReviews();
  const filtered = reviews.filter((r) => r.listUri !== listUri);
  await browser.storage.local.set({ [STORAGE_KEYS.LIST_AUDIT_REVIEWS]: filtered });
}

// ============================================================================
// Mass Operations Detection
// ============================================================================

/**
 * Get mass ops scan result from local storage
 * Uses local storage because results can be large
 */
export async function getMassOpsScanResult(): Promise<MassOpsScanResult | null> {
  const result = await browser.storage.local.get(STORAGE_KEYS.MASS_OPS_SCAN_RESULT);
  return (result[STORAGE_KEYS.MASS_OPS_SCAN_RESULT] as MassOpsScanResult) || null;
}

/**
 * Save mass ops scan result to local storage
 */
export async function saveMassOpsScanResult(scanResult: MassOpsScanResult): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.MASS_OPS_SCAN_RESULT]: scanResult });
}

/**
 * Clear mass ops scan result
 */
export async function clearMassOpsScanResult(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEYS.MASS_OPS_SCAN_RESULT);
}

/**
 * Get mass ops settings from sync storage (small, cross-device)
 */
export async function getMassOpsSettings(): Promise<MassOpsSettings> {
  const result = await browser.storage.sync.get(STORAGE_KEYS.MASS_OPS_SETTINGS);
  const stored = result[STORAGE_KEYS.MASS_OPS_SETTINGS] as MassOpsSettings | undefined;
  return stored || DEFAULT_MASS_OPS_SETTINGS;
}

/**
 * Set mass ops settings in sync storage
 */
export async function setMassOpsSettings(settings: MassOpsSettings): Promise<void> {
  await browser.storage.sync.set({ [STORAGE_KEYS.MASS_OPS_SETTINGS]: settings });
}

/**
 * Dismissed cluster - stores enough info to identify and filter out clusters
 * We store the type, start time, end time, and count to match clusters across scans
 */
export interface DismissedCluster {
  type: 'block' | 'follow' | 'listitem';
  startTime: number;
  endTime: number;
  count: number;
  dismissedAt: number;
}

/**
 * Get dismissed mass ops clusters
 */
export async function getDismissedMassOpsClusters(): Promise<DismissedCluster[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.MASS_OPS_DISMISSED_CLUSTERS);
  return (result[STORAGE_KEYS.MASS_OPS_DISMISSED_CLUSTERS] as DismissedCluster[]) || [];
}

/**
 * Dismiss a mass ops cluster (won't show in future scans)
 */
export async function dismissMassOpsCluster(cluster: DismissedCluster): Promise<void> {
  const dismissed = await getDismissedMassOpsClusters();
  dismissed.push(cluster);
  await browser.storage.local.set({ [STORAGE_KEYS.MASS_OPS_DISMISSED_CLUSTERS]: dismissed });
}

/**
 * Check if a cluster matches a dismissed cluster
 * Matches by type, start time, end time, and count
 */
export function isClusterDismissed(
  cluster: { type: string; startTime: number; endTime: number; count: number },
  dismissedClusters: DismissedCluster[]
): boolean {
  return dismissedClusters.some(
    (d) =>
      d.type === cluster.type &&
      d.startTime === cluster.startTime &&
      d.endTime === cluster.endTime &&
      d.count === cluster.count
  );
}

/**
 * Clear all dismissed clusters (for testing/reset)
 */
export async function clearDismissedMassOpsClusters(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEYS.MASS_OPS_DISMISSED_CLUSTERS);
}

// ============================================================================
// CAR Download Progress
// ============================================================================

/**
 * Progress state for CAR downloads
 * Stored in local storage for UI access via storage.onChanged
 */
export interface CarDownloadProgressState {
  did: string;
  stage: 'checking' | 'downloading' | 'parsing' | 'saving' | 'complete' | 'error';
  bytesDownloaded: number;
  bytesTotal: number | null;
  percentComplete: number | null;
  message: string;
  isIncremental: boolean;
  startedAt: number;
  error?: string;
}

/**
 * Get current CAR download progress
 */
export async function getCarDownloadProgress(): Promise<CarDownloadProgressState | null> {
  const result = await browser.storage.local.get(STORAGE_KEYS.CAR_DOWNLOAD_PROGRESS);
  return (result[STORAGE_KEYS.CAR_DOWNLOAD_PROGRESS] as CarDownloadProgressState) || null;
}

/**
 * Set CAR download progress (for UI updates)
 * UI can listen to storage.onChanged for real-time updates
 */
export async function setCarDownloadProgress(
  progress: CarDownloadProgressState | null
): Promise<void> {
  if (progress === null) {
    await browser.storage.local.remove(STORAGE_KEYS.CAR_DOWNLOAD_PROGRESS);
  } else {
    await browser.storage.local.set({ [STORAGE_KEYS.CAR_DOWNLOAD_PROGRESS]: progress });
  }
}

/**
 * Clear CAR download progress
 */
export async function clearCarDownloadProgress(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEYS.CAR_DOWNLOAD_PROGRESS);
}

// ============================================================================
// Pending Delayed Blocks (Last Word Feature)
// ============================================================================

interface PendingDelayedBlocksMap {
  [did: string]: DelayedBlockEntry;
}

/**
 * Get all pending delayed blocks from local storage
 */
export async function getPendingDelayedBlocks(): Promise<PendingDelayedBlocksMap> {
  const result = await browser.storage.local.get(STORAGE_KEYS.PENDING_DELAYED_BLOCKS);
  return (result[STORAGE_KEYS.PENDING_DELAYED_BLOCKS] as PendingDelayedBlocksMap) || {};
}

/**
 * Set pending delayed blocks in local storage
 */
export async function setPendingDelayedBlocks(blocks: PendingDelayedBlocksMap): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.PENDING_DELAYED_BLOCKS]: blocks });
}

/**
 * Add a pending delayed block
 */
export async function addPendingDelayedBlock(entry: DelayedBlockEntry): Promise<void> {
  const blocks = await getPendingDelayedBlocks();
  blocks[entry.did] = entry;
  await browser.storage.local.set({ [STORAGE_KEYS.PENDING_DELAYED_BLOCKS]: blocks });
}

/**
 * Remove a pending delayed block
 */
export async function removePendingDelayedBlock(did: string): Promise<void> {
  const blocks = await getPendingDelayedBlocks();
  delete blocks[did];
  await browser.storage.local.set({ [STORAGE_KEYS.PENDING_DELAYED_BLOCKS]: blocks });
}

/**
 * Get a specific pending delayed block by DID
 */
export async function getPendingDelayedBlock(did: string): Promise<DelayedBlockEntry | null> {
  const blocks = await getPendingDelayedBlocks();
  return blocks[did] || null;
}

// ============================================================================
// Pending Rollback Queue
// ============================================================================

const PENDING_ROLLBACKS_KEY = 'pendingRollbacks';
const MAX_ROLLBACK_ATTEMPTS = 5;

/**
 * Get all pending rollbacks from local storage
 */
export async function getPendingRollbacks(): Promise<PendingRollback[]> {
  const result = await browser.storage.local.get(PENDING_ROLLBACKS_KEY);
  return (result[PENDING_ROLLBACKS_KEY] as PendingRollback[]) || [];
}

/**
 * Add a pending rollback to the queue
 */
export async function addPendingRollback(
  rollback: Omit<PendingRollback, 'id' | 'createdAt' | 'attempts' | 'lastAttempt'>
): Promise<void> {
  const rollbacks = await getPendingRollbacks();
  const newRollback: PendingRollback = {
    ...rollback,
    id: generateId('rollback'),
    createdAt: Date.now(),
    attempts: 0,
    lastAttempt: 0,
  };
  rollbacks.push(newRollback);
  await browser.storage.local.set({ [PENDING_ROLLBACKS_KEY]: rollbacks });
}

/**
 * Update a pending rollback (increment attempts, update error)
 */
export async function updatePendingRollback(
  id: string,
  update: Partial<Pick<PendingRollback, 'attempts' | 'lastAttempt' | 'error'>>
): Promise<void> {
  const rollbacks = await getPendingRollbacks();
  const index = rollbacks.findIndex((r) => r.id === id);
  if (index !== -1) {
    rollbacks[index] = { ...rollbacks[index], ...update };
    await browser.storage.local.set({ [PENDING_ROLLBACKS_KEY]: rollbacks });
  }
}

/**
 * Remove a pending rollback from the queue
 */
export async function removePendingRollback(id: string): Promise<void> {
  const rollbacks = await getPendingRollbacks();
  const filtered = rollbacks.filter((r) => r.id !== id);
  await browser.storage.local.set({ [PENDING_ROLLBACKS_KEY]: filtered });
}

/**
 * Get rollbacks that need processing (haven't exceeded max attempts)
 */
export async function getProcessableRollbacks(): Promise<PendingRollback[]> {
  const rollbacks = await getPendingRollbacks();
  const now = Date.now();
  const MIN_RETRY_INTERVAL = 60000; // 1 minute between retries

  return rollbacks.filter((r) => {
    // Skip if max attempts exceeded
    if (r.attempts >= MAX_ROLLBACK_ATTEMPTS) return false;

    // Skip if recently attempted (exponential backoff)
    const backoffMs = MIN_RETRY_INTERVAL * Math.pow(2, r.attempts);
    if (now - r.lastAttempt < backoffMs) return false;

    return true;
  });
}

/**
 * Clean up old rollbacks that have exceeded max attempts
 * Called periodically to prevent queue from growing indefinitely
 */
export async function cleanupOldRollbacks(): Promise<number> {
  const rollbacks = await getPendingRollbacks();
  const now = Date.now();
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const toKeep = rollbacks.filter((r) => {
    // Keep if not too old
    if (now - r.createdAt < MAX_AGE_MS) return true;
    // Remove old ones that have exceeded attempts
    return r.attempts < MAX_ROLLBACK_ATTEMPTS;
  });

  const removed = rollbacks.length - toKeep.length;
  if (removed > 0) {
    await browser.storage.local.set({ [PENDING_ROLLBACKS_KEY]: toKeep });
  }
  return removed;
}
