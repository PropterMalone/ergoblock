/**
 * Storage quota management - checking, validation, and safe writes
 */

import browser from '../browser.js';
import { STORAGE_KEYS } from './keys.js';
import { createLogger } from '../utils.js';

const log = createLogger('storage');

// Storage quota constants (Chrome sync storage limits)
const SYNC_STORAGE_QUOTA_BYTES = 102400; // 100KB total for sync storage
const SYNC_STORAGE_ITEM_QUOTA_BYTES = 8192; // 8KB per item
const QUOTA_WARNING_THRESHOLD = 0.8; // Warn at 80% usage

export interface StorageQuotaInfo {
  bytesUsed: number;
  bytesTotal: number;
  percentUsed: number;
  isNearLimit: boolean;
  isAtLimit: boolean;
}

/**
 * Check current storage quota usage
 */
export async function checkStorageQuota(): Promise<StorageQuotaInfo> {
  try {
    // Get all sync storage data to measure size
    const allData = await browser.storage.sync.get(null);
    const bytesUsed = new Blob([JSON.stringify(allData)]).size;
    const percentUsed = bytesUsed / SYNC_STORAGE_QUOTA_BYTES;

    return {
      bytesUsed,
      bytesTotal: SYNC_STORAGE_QUOTA_BYTES,
      percentUsed,
      isNearLimit: percentUsed >= QUOTA_WARNING_THRESHOLD,
      isAtLimit: percentUsed >= 0.95,
    };
  } catch (error) {
    log.error('Error checking storage quota:', error);
    return {
      bytesUsed: 0,
      bytesTotal: SYNC_STORAGE_QUOTA_BYTES,
      percentUsed: 0,
      isNearLimit: false,
      isAtLimit: false,
    };
  }
}

/**
 * Custom error class for storage quota issues
 */
export class StorageQuotaError extends Error {
  constructor(
    message: string,
    public readonly quotaInfo: StorageQuotaInfo
  ) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

/**
 * Calculate the actual storage size of a temp block/mute entry
 * This gives a more accurate estimate than a fixed value
 */
export function calculateEntrySize(
  did: string,
  handle: string,
  durationMs: number,
  rkey?: string
): number {
  // Create a representative entry to measure actual size
  const entry = {
    did,
    handle,
    blockedAt: Date.now(),
    expiresAt: Date.now() + durationMs,
    ...(rkey ? { rkey } : {}),
  };
  // Use Blob to get accurate byte size including UTF-8 encoding
  return new Blob([JSON.stringify(entry)]).size;
}

/**
 * Pre-check if storage has capacity for a new temp block/mute
 * Call this BEFORE making API calls to avoid desync
 * @param estimatedBytes - Estimated size of the new entry (default ~200 bytes per entry)
 * @throws StorageQuotaError if quota would be exceeded
 */
export async function preCheckStorageQuota(estimatedBytes: number = 200): Promise<void> {
  const quota = await checkStorageQuota();

  // Check if adding the estimated bytes would exceed quota
  const projectedUsage = (quota.bytesUsed + estimatedBytes) / quota.bytesTotal;

  if (projectedUsage >= 0.95) {
    throw new StorageQuotaError(
      `Storage quota would be exceeded: ${Math.round(quota.percentUsed * 100)}% used. ` +
        `Please remove some temp blocks/mutes before adding more.`,
      quota
    );
  }

  if (quota.isNearLimit) {
    log.warn(
      `Storage quota warning: ${Math.round(quota.percentUsed * 100)}% used. ` +
        `Consider removing old temp blocks/mutes.`
    );
  }
}

/**
 * Safely write to sync storage with quota checking
 * Throws on quota exceeded for caller to handle
 */
export async function safeSyncStorageWrite(key: string, value: unknown): Promise<void> {
  const dataSize = new Blob([JSON.stringify(value)]).size;

  // Check per-item limit for sync storage
  if (dataSize > SYNC_STORAGE_ITEM_QUOTA_BYTES) {
    throw new StorageQuotaError(
      `Storage item too large: ${dataSize} bytes exceeds ${SYNC_STORAGE_ITEM_QUOTA_BYTES} byte limit`,
      await checkStorageQuota()
    );
  }

  // Check total quota
  const quota = await checkStorageQuota();
  if (quota.isAtLimit) {
    throw new StorageQuotaError(
      `Storage quota exceeded: ${Math.round(quota.percentUsed * 100)}% used. ` +
        `Please remove some temp blocks/mutes.`,
      quota
    );
  }

  if (quota.isNearLimit) {
    log.warn(`Storage quota warning: ${Math.round(quota.percentUsed * 100)}% used`);
  }

  await browser.storage.sync.set({ [key]: value });
}

// Re-export STORAGE_KEYS for convenience (used by safeSyncStorageWrite callers)
export { STORAGE_KEYS };
