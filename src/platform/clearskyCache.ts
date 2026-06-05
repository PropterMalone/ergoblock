/**
 * Clearsky Cache using IndexedDB
 *
 * Provides persistent storage for "blocked-by" data fetched from Clearsky API.
 * Caches which accounts block a given target DID to avoid repeated API calls.
 */

import { createLogger } from './utils.js';
import { promisifyRequest, createDatabaseOpener, ensureStore } from './idb-helpers.js';

const log = createLogger('clearsky-cache');

const DB_NAME = 'ergoblock-clearsky-cache';
const DB_VERSION = 1;

const STORES = {
  BLOCKED_BY: 'blockedBy',
  QUEUE: 'fetchQueue',
} as const;

/**
 * Cached "blocked-by" data for a target DID
 */
export interface BlockedByData {
  targetDid: string;
  blockerDids: string[]; // All DIDs that block this target
  totalCount: number; // Total blockers (may differ if we hit limits)
  fetchedAt: number;
  complete: boolean; // True if we fetched all pages
}

/**
 * Queue entry for background fetching
 */
export interface FetchQueueEntry {
  targetDid: string;
  priority: number; // Lower = higher priority
  queuedAt: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastError?: string;
  retryCount: number;
}

const openDb = createDatabaseOpener(DB_NAME, DB_VERSION, (db) => {
  ensureStore(db, STORES.BLOCKED_BY, { keyPath: 'targetDid' });
  const queueStore = ensureStore(db, STORES.QUEUE, { keyPath: 'targetDid' });
  if (queueStore) {
    queueStore.createIndex('status', 'status', { unique: false });
    queueStore.createIndex('priority', 'priority', { unique: false });
  }
});

// ============================================================================
// Blocked-By Cache Operations
// ============================================================================

/**
 * Get cached blocked-by data for a target DID
 */
export async function getBlockedByCache(targetDid: string): Promise<BlockedByData | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.BLOCKED_BY, 'readonly');
    return (await promisifyRequest(tx.objectStore(STORES.BLOCKED_BY).get(targetDid))) || null;
  } catch (error) {
    log.error('Failed to get blocked-by cache:', error);
    return null;
  }
}

/**
 * Save blocked-by data to cache
 */
export async function saveBlockedByCache(data: BlockedByData): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.BLOCKED_BY, 'readwrite');
    await promisifyRequest(tx.objectStore(STORES.BLOCKED_BY).put(data));
  } catch (error) {
    log.error('Failed to save blocked-by cache:', error);
    throw error;
  }
}

/**
 * Invalidate cached blocked-by data for a target
 */
export async function invalidateBlockedByCache(targetDid: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.BLOCKED_BY, 'readwrite');
    await promisifyRequest(tx.objectStore(STORES.BLOCKED_BY).delete(targetDid));
  } catch (error) {
    log.error('Failed to invalidate cache:', error);
    throw error;
  }
}

/**
 * Get all cached blocked-by entries
 */
export async function getAllBlockedByCache(): Promise<BlockedByData[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.BLOCKED_BY, 'readonly');
    return (await promisifyRequest(tx.objectStore(STORES.BLOCKED_BY).getAll())) || [];
  } catch (error) {
    log.error('Failed to get all blocked-by cache:', error);
    return [];
  }
}

/**
 * Clear all cached blocked-by entries
 * Used for cache invalidation when the data source changes
 */
export async function clearAllBlockedByCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.BLOCKED_BY, 'readwrite');
    await promisifyRequest(tx.objectStore(STORES.BLOCKED_BY).clear());
    log.info('Cleared all blocked-by cache');
  } catch (error) {
    log.error('Failed to clear blocked-by cache:', error);
    throw error;
  }
}

// ============================================================================
// Fetch Queue Operations
// ============================================================================

/**
 * Add a target to the fetch queue
 */
export async function queueForFetch(targetDid: string, priority: number = 10): Promise<void> {
  try {
    const db = await openDb();
    const existing = await getQueueEntry(targetDid);

    // Don't re-queue if already pending or in progress
    if (existing && (existing.status === 'pending' || existing.status === 'in_progress')) {
      return;
    }

    const entry: FetchQueueEntry = {
      targetDid,
      priority,
      queuedAt: Date.now(),
      status: 'pending',
      retryCount: existing?.retryCount || 0,
    };

    const tx = db.transaction(STORES.QUEUE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORES.QUEUE).put(entry));
  } catch (error) {
    log.error('Failed to queue for fetch:', error);
    throw error;
  }
}

/**
 * Get a queue entry by target DID
 */
export async function getQueueEntry(targetDid: string): Promise<FetchQueueEntry | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.QUEUE, 'readonly');
    return (await promisifyRequest(tx.objectStore(STORES.QUEUE).get(targetDid))) || null;
  } catch (error) {
    log.error('Failed to get queue entry:', error);
    return null;
  }
}

/**
 * Get pending queue entries sorted by priority
 */
export async function getPendingQueue(): Promise<FetchQueueEntry[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.QUEUE, 'readonly');
    const index = tx.objectStore(STORES.QUEUE).index('status');
    const entries: FetchQueueEntry[] = (await promisifyRequest(index.getAll('pending'))) || [];
    // Sort by priority (lower first), then by queuedAt (older first)
    entries.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.queuedAt - b.queuedAt;
    });
    return entries;
  } catch (error) {
    log.error('Failed to get pending queue:', error);
    return [];
  }
}

/**
 * Update queue entry status
 */
export async function updateQueueStatus(
  targetDid: string,
  status: FetchQueueEntry['status'],
  error?: string
): Promise<void> {
  try {
    const db = await openDb();
    const existing = await getQueueEntry(targetDid);
    if (!existing) return;

    const updated: FetchQueueEntry = {
      ...existing,
      status,
      lastError: error,
      retryCount: status === 'failed' ? existing.retryCount + 1 : existing.retryCount,
    };

    const tx = db.transaction(STORES.QUEUE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORES.QUEUE).put(updated));
  } catch (error) {
    log.error('Failed to update queue status:', error);
    throw error;
  }
}

/**
 * Remove entry from queue
 */
export async function removeFromQueue(targetDid: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.QUEUE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORES.QUEUE).delete(targetDid));
  } catch (error) {
    log.error('Failed to remove from queue:', error);
    throw error;
  }
}

/**
 * Clear completed/failed entries from queue
 */
export async function clearCompletedQueue(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.QUEUE);
    const all: FetchQueueEntry[] = await promisifyRequest(store.getAll());
    await Promise.all(
      all
        .filter((e) => e.status === 'completed' || e.status === 'failed')
        .map((e) => promisifyRequest(store.delete(e.targetDid)))
    );
  } catch (error) {
    log.error('Failed to clear completed queue:', error);
    throw error;
  }
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear all Clearsky cache data
 */
export async function clearClearskyCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORES.BLOCKED_BY, STORES.QUEUE], 'readwrite');
    await Promise.all([
      promisifyRequest(tx.objectStore(STORES.BLOCKED_BY).clear()),
      promisifyRequest(tx.objectStore(STORES.QUEUE).clear()),
    ]);
    log.info('Cleared all cache');
  } catch (error) {
    log.error('Failed to clear cache:', error);
    throw error;
  }
}

/**
 * Get cache statistics
 */
export async function getClearskyStats(): Promise<{
  cachedTargets: number;
  totalBlockers: number;
  queuedPending: number;
  queuedFailed: number;
}> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORES.BLOCKED_BY, STORES.QUEUE], 'readonly');

    const [blockedByEntries, queueEntries] = await Promise.all([
      promisifyRequest<BlockedByData[]>(tx.objectStore(STORES.BLOCKED_BY).getAll()),
      promisifyRequest<FetchQueueEntry[]>(tx.objectStore(STORES.QUEUE).getAll()),
    ]);

    return {
      cachedTargets: blockedByEntries.length,
      totalBlockers: blockedByEntries.reduce((sum, e) => sum + e.blockerDids.length, 0),
      queuedPending: queueEntries.filter((e) => e.status === 'pending').length,
      queuedFailed: queueEntries.filter((e) => e.status === 'failed').length,
    };
  } catch (error) {
    log.error('Failed to get stats:', error);
    return { cachedTargets: 0, totalBlockers: 0, queuedPending: 0, queuedFailed: 0 };
  }
}
