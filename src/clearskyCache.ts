/**
 * Clearsky Cache using IndexedDB
 *
 * Provides persistent storage for "blocked-by" data fetched from Clearsky API.
 * Caches which accounts block a given target DID to avoid repeated API calls.
 */

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

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[ClearskyCache] Failed to open database:', request.error);
      dbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORES.BLOCKED_BY)) {
        db.createObjectStore(STORES.BLOCKED_BY, { keyPath: 'targetDid' });
      }
      if (!db.objectStoreNames.contains(STORES.QUEUE)) {
        const queueStore = db.createObjectStore(STORES.QUEUE, { keyPath: 'targetDid' });
        queueStore.createIndex('status', 'status', { unique: false });
        queueStore.createIndex('priority', 'priority', { unique: false });
      }
    };
  });

  return dbPromise;
}

// ============================================================================
// Blocked-By Cache Operations
// ============================================================================

/**
 * Get cached blocked-by data for a target DID
 */
export async function getBlockedByCache(targetDid: string): Promise<BlockedByData | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.BLOCKED_BY, 'readonly');
      const request = tx.objectStore(STORES.BLOCKED_BY).get(targetDid);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to get blocked-by cache:', error);
    return null;
  }
}

/**
 * Save blocked-by data to cache
 */
export async function saveBlockedByCache(data: BlockedByData): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.BLOCKED_BY, 'readwrite');
      const request = tx.objectStore(STORES.BLOCKED_BY).put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to save blocked-by cache:', error);
    throw error;
  }
}

/**
 * Invalidate cached blocked-by data for a target
 */
export async function invalidateBlockedByCache(targetDid: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.BLOCKED_BY, 'readwrite');
      const request = tx.objectStore(STORES.BLOCKED_BY).delete(targetDid);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to invalidate cache:', error);
    throw error;
  }
}

/**
 * Get all cached blocked-by entries
 */
export async function getAllBlockedByCache(): Promise<BlockedByData[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.BLOCKED_BY, 'readonly');
      const request = tx.objectStore(STORES.BLOCKED_BY).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to get all blocked-by cache:', error);
    return [];
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
    const db = await openDatabase();
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

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.QUEUE, 'readwrite');
      const request = tx.objectStore(STORES.QUEUE).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to queue for fetch:', error);
    throw error;
  }
}

/**
 * Get a queue entry by target DID
 */
export async function getQueueEntry(targetDid: string): Promise<FetchQueueEntry | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.QUEUE, 'readonly');
      const request = tx.objectStore(STORES.QUEUE).get(targetDid);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to get queue entry:', error);
    return null;
  }
}

/**
 * Get pending queue entries sorted by priority
 */
export async function getPendingQueue(): Promise<FetchQueueEntry[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.QUEUE, 'readonly');
      const store = tx.objectStore(STORES.QUEUE);
      const index = store.index('status');
      const request = index.getAll('pending');
      request.onsuccess = () => {
        const entries = request.result || [];
        // Sort by priority (lower first), then by queuedAt (older first)
        entries.sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return a.queuedAt - b.queuedAt;
        });
        resolve(entries);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to get pending queue:', error);
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
    const db = await openDatabase();
    const existing = await getQueueEntry(targetDid);
    if (!existing) return;

    const updated: FetchQueueEntry = {
      ...existing,
      status,
      lastError: error,
      retryCount: status === 'failed' ? existing.retryCount + 1 : existing.retryCount,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.QUEUE, 'readwrite');
      const request = tx.objectStore(STORES.QUEUE).put(updated);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to update queue status:', error);
    throw error;
  }
}

/**
 * Remove entry from queue
 */
export async function removeFromQueue(targetDid: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.QUEUE, 'readwrite');
      const request = tx.objectStore(STORES.QUEUE).delete(targetDid);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to remove from queue:', error);
    throw error;
  }
}

/**
 * Clear completed/failed entries from queue
 */
export async function clearCompletedQueue(): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.QUEUE);

    return new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const entry = cursor.value as FetchQueueEntry;
          if (entry.status === 'completed' || entry.status === 'failed') {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[ClearskyCache] Failed to clear completed queue:', error);
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
    const db = await openDatabase();
    const tx = db.transaction([STORES.BLOCKED_BY, STORES.QUEUE], 'readwrite');

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.BLOCKED_BY).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.QUEUE).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
    ]);

    console.log('[ClearskyCache] Cleared all cache');
  } catch (error) {
    console.error('[ClearskyCache] Failed to clear cache:', error);
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
    const db = await openDatabase();
    const tx = db.transaction([STORES.BLOCKED_BY, STORES.QUEUE], 'readonly');

    const [blockedByEntries, queueEntries] = await Promise.all([
      new Promise<BlockedByData[]>((resolve, reject) => {
        const request = tx.objectStore(STORES.BLOCKED_BY).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      }),
      new Promise<FetchQueueEntry[]>((resolve, reject) => {
        const request = tx.objectStore(STORES.QUEUE).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      }),
    ]);

    return {
      cachedTargets: blockedByEntries.length,
      totalBlockers: blockedByEntries.reduce((sum, e) => sum + e.blockerDids.length, 0),
      queuedPending: queueEntries.filter((e) => e.status === 'pending').length,
      queuedFailed: queueEntries.filter((e) => e.status === 'failed').length,
    };
  } catch (error) {
    console.error('[ClearskyCache] Failed to get stats:', error);
    return { cachedTargets: 0, totalBlockers: 0, queuedPending: 0, queuedFailed: 0 };
  }
}
