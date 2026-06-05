/**
 * CAR File Cache using IndexedDB
 *
 * Provides persistent storage for parsed CAR data to avoid redundant downloads.
 * Stores parsed data (not raw CAR files) since parsing is cheap but download is expensive.
 */

import type { GraphOperation } from '../types.js';
import type { ParsedPost, ParsedListData } from '../domains/carRepo.js';
import { createLogger } from './utils.js';
import { promisifyRequest, createDatabaseOpener, ensureStore } from './idb-helpers.js';

const log = createLogger('car-cache');

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

const openDb = createDatabaseOpener(DB_NAME, DB_VERSION, (db) => {
  ensureStore(db, STORES.METADATA, { keyPath: 'did' });
  ensureStore(db, STORES.POSTS, { keyPath: 'did' });
  ensureStore(db, STORES.GRAPH_OPS, { keyPath: 'did' });
  ensureStore(db, STORES.LISTS, { keyPath: 'did' });
});

/**
 * Get cached metadata for a DID
 */
export async function getCarCacheMetadata(did: string): Promise<CarCacheMetadata | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.METADATA, 'readonly');
    const result = await promisifyRequest(tx.objectStore(STORES.METADATA).get(did));
    return result || null;
  } catch (error) {
    log.error('Failed to get metadata:', error);
    return null;
  }
}

/**
 * Get all cached CAR data for a DID
 */
export async function getCachedCarData(did: string): Promise<CachedCarData | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(
      [STORES.METADATA, STORES.POSTS, STORES.GRAPH_OPS, STORES.LISTS],
      'readonly'
    );

    const [metadata, postsData, graphOpsData, listsData] = await Promise.all([
      promisifyRequest<CarCacheMetadata>(tx.objectStore(STORES.METADATA).get(did)),
      promisifyRequest<{ did: string; posts: ParsedPost[] }>(tx.objectStore(STORES.POSTS).get(did)),
      promisifyRequest<CachedGraphOps>(tx.objectStore(STORES.GRAPH_OPS).get(did)),
      promisifyRequest<{ did: string; lists: ParsedListData[] }>(
        tx.objectStore(STORES.LISTS).get(did)
      ),
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
    log.error('Failed to get cached data:', error);
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
    const db = await openDb();
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
      promisifyRequest(tx.objectStore(STORES.METADATA).put(metadata)),
      promisifyRequest(tx.objectStore(STORES.POSTS).put({ did, posts: data.posts })),
      promisifyRequest(
        tx.objectStore(STORES.GRAPH_OPS).put({
          did,
          blocks: data.blocks,
          follows: data.follows,
          listitems: data.listitems,
        })
      ),
      promisifyRequest(tx.objectStore(STORES.LISTS).put({ did, lists: data.lists })),
    ]);

    log.info(`Saved cache for ${did} (rev: ${rev.slice(0, 8)}...)`);
  } catch (error) {
    log.error('Failed to save data:', error);
    throw error;
  }
}

/**
 * Invalidate (delete) cached data for a DID
 */
export async function invalidateCarCache(did: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(
      [STORES.METADATA, STORES.POSTS, STORES.GRAPH_OPS, STORES.LISTS],
      'readwrite'
    );

    await Promise.all([
      promisifyRequest(tx.objectStore(STORES.METADATA).delete(did)),
      promisifyRequest(tx.objectStore(STORES.POSTS).delete(did)),
      promisifyRequest(tx.objectStore(STORES.GRAPH_OPS).delete(did)),
      promisifyRequest(tx.objectStore(STORES.LISTS).delete(did)),
    ]);

    log.info(`Invalidated cache for ${did}`);
  } catch (error) {
    log.error('Failed to invalidate cache:', error);
    throw error;
  }
}

/**
 * Clear all cached CAR data
 */
export async function clearCarCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(
      [STORES.METADATA, STORES.POSTS, STORES.GRAPH_OPS, STORES.LISTS],
      'readwrite'
    );

    await Promise.all([
      promisifyRequest(tx.objectStore(STORES.METADATA).clear()),
      promisifyRequest(tx.objectStore(STORES.POSTS).clear()),
      promisifyRequest(tx.objectStore(STORES.GRAPH_OPS).clear()),
      promisifyRequest(tx.objectStore(STORES.LISTS).clear()),
    ]);

    log.info('Cleared all cache');
  } catch (error) {
    log.error('Failed to clear cache:', error);
    throw error;
  }
}

/**
 * Get total size of all cached data (approximate)
 */
export async function getCarCacheTotalSize(): Promise<number> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORES.METADATA], 'readonly');
    const metadataList = await promisifyRequest<CarCacheMetadata[]>(
      tx.objectStore(STORES.METADATA).getAll()
    );
    const totalSize = metadataList.reduce((sum, m) => sum + m.sizeBytes, 0);
    return totalSize;
  } catch (error) {
    log.error('Failed to get cache size:', error);
    return 0;
  }
}

/**
 * Get list of all cached DIDs with their metadata
 */
export async function getAllCachedDids(): Promise<CarCacheMetadata[]> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORES.METADATA], 'readonly');
    const result = await promisifyRequest<CarCacheMetadata[]>(
      tx.objectStore(STORES.METADATA).getAll()
    );
    return result || [];
  } catch (error) {
    log.error('Failed to get all cached DIDs:', error);
    return [];
  }
}
