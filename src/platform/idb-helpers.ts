/**
 * IndexedDB Helpers
 *
 * Shared utilities for IndexedDB operations to eliminate boilerplate
 * across cache implementations (carCache, clearskyCache).
 */

import { createLogger } from './utils.js';

const log = createLogger('idb');

/**
 * Wrap an IDBRequest in a Promise.
 * Handles the onsuccess/onerror pattern that repeats in every IndexedDB operation.
 */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Create a lazy-initialized, singleton database opener.
 * Returns a function that opens the database once and caches the connection.
 */
export function createDatabaseOpener(
  name: string,
  version: number,
  onUpgrade: (db: IDBDatabase) => void
): () => Promise<IDBDatabase> {
  let cached: Promise<IDBDatabase> | null = null;

  return () => {
    if (cached) return cached;

    cached = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, version);

      request.onerror = () => {
        log.error(`Failed to open database ${name}:`, request.error);
        cached = null;
        reject(request.error);
      };

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        onUpgrade((event.target as IDBOpenDBRequest).result);
      };
    });

    return cached;
  };
}

/**
 * Ensure an object store exists, creating it if needed.
 * Use inside onUpgrade callbacks.
 */
export function ensureStore(
  db: IDBDatabase,
  name: string,
  options?: IDBObjectStoreParameters
): IDBObjectStore | null {
  if (!db.objectStoreNames.contains(name)) {
    return db.createObjectStore(name, options);
  }
  return null;
}
