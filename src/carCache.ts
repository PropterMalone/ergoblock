/**
 * CAR File Cache using IndexedDB
 *
 * Provides persistent storage for parsed CAR data to avoid redundant downloads.
 * Stores parsed data (not raw CAR files) since parsing is cheap but download is expensive.
 */

import type {
  GraphOperation,
} from './types.js';
import type { ParsedPost, ParsedListData } from './carRepo.js';

const DB_NAME = 'ergoblock-car-cache';
const DB_VERSION = 1;

// Object store names
const STORES = {
  METADATA: 'metadata',
  POSTS: 'posts',
  GRAPH_OPS: 'graphOps',
  LISTS: 'lists',
} as const;

/**
 * Metadata about a cached CAR file
 */
export interface CarCacheMetadata {
  did: string;
  rev: string;
  downloadedAt: number;
  sizeBytes: number;
  collections: {
    posts: number;
    blocks: number;
    follows: number;
    listitems: number;
    lists: number;
  };
}

/**
 * Graph operations stored in cache
 */
export interface CachedGraphOps {
  did: string;
  blocks: GraphOperation[];
  follows: GraphOperation[];
  listitems: GraphOperation[];
}

/**
 * Complete cached CAR data
 */
export interface CachedCarData {
  did: string;
  rev: string;
  posts: ParsedPost[];
  blocks: GraphOperation[];
  follows: GraphOperation[];
  listitems: GraphOperation[];
  lists: ParsedListData[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open the IndexedDB database, creating stores if needed
 */
function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[CarCache] Failed to open database:', request.error);
      dbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains(STORES.METADATA)) {
        db.createObjectStore(STORES.METADATA, { keyPath: 'did' });
      }
      if (!db.objectStoreNames.contains(STORES.POSTS)) {
        db.createObjectStore(STORES.POSTS, { keyPath: 'did' });
      }
      if (!db.objectStoreNames.contains(STORES.GRAPH_OPS)) {
        db.createObjectStore(STORES.GRAPH_OPS, { keyPath: 'did' });
      }
      if (!db.objectStoreNames.contains(STORES.LISTS)) {
        db.createObjectStore(STORES.LISTS, { keyPath: 'did' });
      }
    };
  });

  return dbPromise;
}

/**
 * Perform a transaction on the database
 */
async function withTransaction<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  callback: (transaction: IDBTransaction) => Promise<T>
): Promise<T> {
  const db = await openDatabase();
  const transaction = db.transaction(storeNames, mode);
  return callback(transaction);
}

/**
 * Get cached metadata for a DID
 */
export async function getCarCacheMetadata(did: string): Promise<CarCacheMetadata | null> {
  try {
    return await withTransaction(STORES.METADATA, 'readonly', (tx) => {
      return new Promise((resolve, reject) => {
        const store = tx.objectStore(STORES.METADATA);
        const request = store.get(did);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    });
  } catch (error) {
    console.error('[CarCache] Failed to get metadata:', error);
    return null;
  }
}

/**
 * Get all cached CAR data for a DID
 */
export async function getCachedCarData(did: string): Promise<CachedCarData | null> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(
      [STORES.METADATA, STORES.POSTS, STORES.GRAPH_OPS, STORES.LISTS],
      'readonly'
    );

    const [metadata, postsData, graphOpsData, listsData] = await Promise.all([
      new Promise<CarCacheMetadata | null>((resolve, reject) => {
        const request = tx.objectStore(STORES.METADATA).get(did);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      }),
      new Promise<{ did: string; posts: ParsedPost[] } | null>((resolve, reject) => {
        const request = tx.objectStore(STORES.POSTS).get(did);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      }),
      new Promise<CachedGraphOps | null>((resolve, reject) => {
        const request = tx.objectStore(STORES.GRAPH_OPS).get(did);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      }),
      new Promise<{ did: string; lists: ParsedListData[] } | null>((resolve, reject) => {
        const request = tx.objectStore(STORES.LISTS).get(did);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      }),
    ]);

    if (!metadata) {
      return null;
    }

    return {
      did,
      rev: metadata.rev,
      posts: postsData?.posts || [],
      blocks: graphOpsData?.blocks || [],
      follows: graphOpsData?.follows || [],
      listitems: graphOpsData?.listitems || [],
      lists: listsData?.lists || [],
    };
  } catch (error) {
    console.error('[CarCache] Failed to get cached data:', error);
    return null;
  }
}

/**
 * Save parsed CAR data to cache
 */
export async function saveCarData(
  did: string,
  rev: string,
  sizeBytes: number,
  data: {
    posts: ParsedPost[];
    blocks: GraphOperation[];
    follows: GraphOperation[];
    listitems: GraphOperation[];
    lists: ParsedListData[];
  }
): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(
      [STORES.METADATA, STORES.POSTS, STORES.GRAPH_OPS, STORES.LISTS],
      'readwrite'
    );

    const metadata: CarCacheMetadata = {
      did,
      rev,
      downloadedAt: Date.now(),
      sizeBytes,
      collections: {
        posts: data.posts.length,
        blocks: data.blocks.length,
        follows: data.follows.length,
        listitems: data.listitems.length,
        lists: data.lists.length,
      },
    };

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.METADATA).put(metadata);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.POSTS).put({ did, posts: data.posts });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.GRAPH_OPS).put({
          did,
          blocks: data.blocks,
          follows: data.follows,
          listitems: data.listitems,
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.LISTS).put({ did, lists: data.lists });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
    ]);

    console.log(`[CarCache] Saved cache for ${did} (rev: ${rev.slice(0, 8)}...)`);
  } catch (error) {
    console.error('[CarCache] Failed to save data:', error);
    throw error;
  }
}

/**
 * Invalidate (delete) cached data for a DID
 */
export async function invalidateCarCache(did: string): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(
      [STORES.METADATA, STORES.POSTS, STORES.GRAPH_OPS, STORES.LISTS],
      'readwrite'
    );

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.METADATA).delete(did);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.POSTS).delete(did);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.GRAPH_OPS).delete(did);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.LISTS).delete(did);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
    ]);

    console.log(`[CarCache] Invalidated cache for ${did}`);
  } catch (error) {
    console.error('[CarCache] Failed to invalidate cache:', error);
    throw error;
  }
}

/**
 * Clear all cached CAR data
 */
export async function clearCarCache(): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(
      [STORES.METADATA, STORES.POSTS, STORES.GRAPH_OPS, STORES.LISTS],
      'readwrite'
    );

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.METADATA).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.POSTS).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.GRAPH_OPS).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(STORES.LISTS).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
    ]);

    console.log('[CarCache] Cleared all cache');
  } catch (error) {
    console.error('[CarCache] Failed to clear cache:', error);
    throw error;
  }
}

/**
 * Get total size of all cached data (approximate)
 */
export async function getCarCacheTotalSize(): Promise<number> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORES.METADATA], 'readonly');

    return new Promise((resolve, reject) => {
      const store = tx.objectStore(STORES.METADATA);
      const request = store.getAll();
      request.onsuccess = () => {
        const metadataList = request.result as CarCacheMetadata[];
        const totalSize = metadataList.reduce((sum, m) => sum + m.sizeBytes, 0);
        resolve(totalSize);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[CarCache] Failed to get cache size:', error);
    return 0;
  }
}

/**
 * Get list of all cached DIDs with their metadata
 */
export async function getAllCachedDids(): Promise<CarCacheMetadata[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORES.METADATA], 'readonly');

    return new Promise((resolve, reject) => {
      const store = tx.objectStore(STORES.METADATA);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[CarCache] Failed to get all cached DIDs:', error);
    return [];
  }
}
