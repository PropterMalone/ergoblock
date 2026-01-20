/**
 * CAR Service - Unified CAR file management with smart caching
 *
 * Provides a single interface for all CAR operations:
 * - Checks cache before downloading
 * - Supports incremental sync when possible
 * - Reports progress to UI via storage
 * - Handles download size estimation
 */

import {
  getCarCacheMetadata,
  getCachedCarData,
  saveCarData,
  type CachedCarData,
  type CarCacheMetadata,
} from './carCache.js';
import {
  getLatestCommit,
  parseCarForAllGraphOperations,
  parseCarForPosts,
  parseCarForLists,
  type ParsedPost,
  type ParsedListData,
} from './carRepo.js';
import type { GraphOperation } from './types.js';
import { RequestCoalescer } from './utils.js';

const BSKY_RELAY = 'https://bsky.network';
const CAR_DOWNLOAD_TIMEOUT_MS = 120000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// MEDIUM FIX #13: Request deduplication to prevent concurrent downloads of the same DID
const carFetchCoalescer = new RequestCoalescer<string, CarFetchResult>();

/**
 * Progress state for CAR downloads
 * Stored in chrome.storage.local for UI access
 */
export interface CarDownloadProgress {
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
 * Options for smart CAR data fetching
 */
export interface CarFetchOptions {
  did: string;
  pdsUrl: string | null;
  forceRefresh?: boolean;
  /** If true, use cached data even if stale (skip freshness check). Good for historical analysis. */
  preferCache?: boolean;
  onProgress?: (progress: CarDownloadProgress) => void;
}

/**
 * Result of a smart CAR fetch
 */
export interface CarFetchResult {
  data: CachedCarData;
  wasIncremental: boolean;
  wasCached: boolean;
  downloadSize: number;
}

/**
 * Cache status check result
 */
export interface CarCacheStatus {
  hasCached: boolean;
  isStale: boolean;
  cachedRev?: string;
  latestRev?: string;
  cachedAt?: number;
  cachedSize?: number;
  recordCounts?: CarCacheMetadata['collections'];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createProgress(
  did: string,
  stage: CarDownloadProgress['stage'],
  message: string,
  options?: {
    bytesDownloaded?: number;
    bytesTotal?: number | null;
    isIncremental?: boolean;
    error?: string;
  }
): CarDownloadProgress {
  const bytesDownloaded = options?.bytesDownloaded || 0;
  const bytesTotal = options?.bytesTotal ?? null;
  const percentComplete =
    bytesTotal && bytesTotal > 0 ? Math.round((bytesDownloaded / bytesTotal) * 100) : null;

  return {
    did,
    stage,
    bytesDownloaded,
    bytesTotal,
    percentComplete,
    message,
    isIncremental: options?.isIncremental || false,
    startedAt: Date.now(),
    error: options?.error,
  };
}

/**
 * Estimate the download size of a CAR file using HEAD request
 */
export async function estimateCarDownloadSize(
  did: string,
  pdsUrl: string | null
): Promise<number | null> {
  const endpoints = [
    pdsUrl ? `${pdsUrl}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}` : null,
    `${BSKY_RELAY}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}`,
  ].filter(Boolean) as string[];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          return parseInt(contentLength, 10);
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  return null;
}

/**
 * Check cache status for a DID
 */
export async function checkCarCacheStatus(
  did: string,
  pdsUrl: string | null
): Promise<CarCacheStatus> {
  const cached = await getCarCacheMetadata(did);
  const latestCommit = await getLatestCommit(did, pdsUrl);

  if (!cached) {
    return {
      hasCached: false,
      isStale: true,
      latestRev: latestCommit?.rev,
    };
  }

  const cacheAge = Date.now() - cached.downloadedAt;
  const isExpired = cacheAge > CACHE_TTL_MS;

  return {
    hasCached: true,
    isStale: isExpired, // Only stale if older than 24 hours
    cachedRev: cached.rev,
    latestRev: latestCommit?.rev,
    cachedAt: cached.downloadedAt,
    cachedSize: cached.sizeBytes,
    recordCounts: cached.collections,
  };
}

/**
 * Download CAR file with progress streaming
 */
async function downloadCarWithProgress(
  did: string,
  pdsUrl: string | null,
  since: string | null,
  onProgress: (progress: CarDownloadProgress) => void
): Promise<{ data: Uint8Array; sizeBytes: number }> {
  const isIncremental = !!since;
  const sinceParam = since ? `&since=${encodeURIComponent(since)}` : '';

  onProgress(
    createProgress(
      did,
      'downloading',
      isIncremental ? 'Downloading changes...' : 'Downloading repository...',
      { isIncremental }
    )
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CAR_DOWNLOAD_TIMEOUT_MS);

  try {
    // Try PDS first
    let response: Response | null = null;

    if (pdsUrl) {
      try {
        const url = `${pdsUrl}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}${sinceParam}`;
        const pdsResponse = await fetch(url, { signal: controller.signal });

        if (pdsResponse.ok) {
          response = pdsResponse;
        } else if (pdsResponse.status === 400 && since) {
          // PDS doesn't support incremental sync
          console.warn('[CarService] PDS does not support incremental sync');
          throw new Error('Incremental not supported');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Incremental not supported') {
          throw error;
        }
        console.warn('[CarService] PDS fetch failed, trying relay');
      }
    }

    // Fallback to relay
    if (!response) {
      const url = `${BSKY_RELAY}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}${sinceParam}`;
      const relayResponse = await fetch(url, { signal: controller.signal });

      if (!relayResponse.ok) {
        if (relayResponse.status === 400 && since) {
          throw new Error('Incremental not supported');
        }
        throw new Error(`Failed to download repo: ${relayResponse.status}`);
      }
      response = relayResponse;
    }

    // Stream response with progress
    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : null;

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    try {
      while (true) {
        if (controller.signal.aborted) {
          reader.cancel();
          throw new Error('Download aborted');
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        const message = totalBytes
          ? `Downloading... ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`
          : `Downloading... ${formatBytes(receivedBytes)}`;

        onProgress(
          createProgress(did, 'downloading', message, {
            bytesDownloaded: receivedBytes,
            bytesTotal: totalBytes,
            isIncremental,
          })
        );
      }
    } catch (error) {
      reader.cancel();
      throw error;
    }

    // Combine chunks
    const result = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return { data: result, sizeBytes: receivedBytes };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse CAR data and extract all collections
 */
function parseCarData(
  carData: Uint8Array,
  did: string,
  onProgress: (progress: CarDownloadProgress) => void
): {
  posts: ParsedPost[];
  blocks: GraphOperation[];
  follows: GraphOperation[];
  listitems: GraphOperation[];
  lists: ParsedListData[];
} {
  onProgress(createProgress(did, 'parsing', 'Parsing posts...'));
  const postsResult = parseCarForPosts(carData, did);

  onProgress(createProgress(did, 'parsing', 'Parsing graph operations...'));
  const graphOps = parseCarForAllGraphOperations(carData, did);

  onProgress(createProgress(did, 'parsing', 'Parsing lists...'));
  const listsResult = parseCarForLists(carData, did);
  const lists = Object.values(listsResult.lists);

  return {
    posts: postsResult.posts,
    blocks: graphOps.blocks,
    follows: graphOps.follows,
    listitems: graphOps.listitems,
    lists,
  };
}

/**
 * Smart CAR data fetching with caching and incremental sync
 *
 * Logic:
 * 1. Check if cached data exists
 * 2. Get latest commit revision from PDS
 * 3. If revision matches cache -> return cached
 * 4. If have cache but revision differs -> try incremental sync
 * 5. If no cache or incremental fails -> full download
 * 6. Save to cache and return
 *
 * MEDIUM FIX #13: Uses request coalescing to prevent duplicate concurrent downloads
 */
export async function getCarDataSmart(options: CarFetchOptions): Promise<CarFetchResult> {
  const { did } = options;

  // MEDIUM FIX #13: Deduplicate concurrent requests for the same DID
  // If a download is already in progress for this DID, wait for it instead of starting another
  return carFetchCoalescer.execute(did, async () => {
    return getCarDataSmartInternal(options);
  });
}

/**
 * Internal implementation of getCarDataSmart (called via coalescer)
 */
async function getCarDataSmartInternal(options: CarFetchOptions): Promise<CarFetchResult> {
  const { did, pdsUrl, forceRefresh = false, preferCache = false, onProgress } = options;

  const reportProgress = onProgress || (() => {});

  // Step 1: Check cache
  reportProgress(createProgress(did, 'checking', 'Checking cache...'));

  const cached = forceRefresh ? null : await getCachedCarData(did);
  const cachedMeta = forceRefresh ? null : await getCarCacheMetadata(did);

  // Step 2: If we have cached data within TTL (24 hours), use it without checking revision
  if (cached && cachedMeta) {
    const cacheAge = Date.now() - cachedMeta.downloadedAt;
    const isFresh = cacheAge <= CACHE_TTL_MS;

    if (isFresh || preferCache) {
      const reason = isFresh ? 'within 24h TTL' : 'preferCache=true';
      console.log(
        `[CarService] Using cached data for ${did} (${reason}, rev: ${cachedMeta.rev.slice(0, 8)}...)`
      );
      reportProgress(createProgress(did, 'complete', 'Using cached data'));
      return {
        data: cached,
        wasIncremental: false,
        wasCached: true,
        downloadSize: 0,
      };
    }
  }

  // Step 3: Cache is expired, get latest revision
  reportProgress(createProgress(did, 'checking', 'Checking repository version...'));
  const latestCommit = await getLatestCommit(did, pdsUrl);

  // Step 4: If cache matches latest revision, update timestamp and return cached
  if (cached && cachedMeta && latestCommit && cachedMeta.rev === latestCommit.rev) {
    console.log(`[CarService] Cache rev matches latest for ${did}, refreshing timestamp`);
    // Re-save to update downloadedAt timestamp
    await saveCarData(did, cachedMeta.rev, cachedMeta.sizeBytes, {
      posts: cached.posts,
      blocks: cached.blocks,
      follows: cached.follows,
      listitems: cached.listitems,
      lists: cached.lists,
    });
    reportProgress(createProgress(did, 'complete', 'Using cached data'));
    return {
      data: cached,
      wasIncremental: false,
      wasCached: true,
      downloadSize: 0,
    };
  }

  // Step 4: Try incremental sync if we have cache
  let downloadResult: { data: Uint8Array; sizeBytes: number } | null = null;
  let wasIncremental = false;

  if (cachedMeta && latestCommit) {
    try {
      console.log(`[CarService] Attempting incremental sync from ${cachedMeta.rev.slice(0, 8)}...`);
      downloadResult = await downloadCarWithProgress(did, pdsUrl, cachedMeta.rev, reportProgress);
      wasIncremental = true;
    } catch (error) {
      if (error instanceof Error && error.message === 'Incremental not supported') {
        console.log('[CarService] Incremental sync not supported, doing full download');
      } else {
        console.warn('[CarService] Incremental sync failed:', error);
      }
    }
  }

  // Step 5: Full download if needed
  if (!downloadResult) {
    downloadResult = await downloadCarWithProgress(did, pdsUrl, null, reportProgress);
    wasIncremental = false;
  }

  // Step 6: Parse the CAR data
  // Note: Incremental CAR files may have incomplete block maps (missing CIDs that exist
  // in the base repo but not in the delta). If parsing fails with a CID error, fall back
  // to a full download.
  let parsedData: ReturnType<typeof parseCarData>;
  try {
    parsedData = parseCarData(downloadResult.data, did, reportProgress);
  } catch (parseError) {
    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    // Check for CID-related errors from @atcute/repo (incomplete block map)
    if (
      wasIncremental &&
      (errorMessage.includes('cid not found') ||
        errorMessage.includes('blockmap') ||
        errorMessage.includes('block not found'))
    ) {
      console.warn(
        '[CarService] Incremental CAR has incomplete block map, falling back to full download'
      );
      downloadResult = await downloadCarWithProgress(did, pdsUrl, null, reportProgress);
      wasIncremental = false;
      parsedData = parseCarData(downloadResult.data, did, reportProgress);
    } else {
      throw parseError;
    }
  }

  // Step 7: Save to cache
  reportProgress(createProgress(did, 'saving', 'Saving to cache...'));

  const rev = latestCommit?.rev || `unknown-${Date.now()}`;
  await saveCarData(did, rev, downloadResult.sizeBytes, parsedData);

  // Step 8: Return result
  reportProgress(createProgress(did, 'complete', 'Complete'));

  return {
    data: {
      did,
      rev,
      ...parsedData,
    },
    wasIncremental,
    wasCached: false,
    downloadSize: downloadResult.sizeBytes,
  };
}

/**
 * Get only graph operations (blocks, follows, listitems) with smart caching
 * Used by Mass Ops scanning
 */
export async function getGraphOperationsSmart(options: CarFetchOptions): Promise<{
  blocks: GraphOperation[];
  follows: GraphOperation[];
  listitems: GraphOperation[];
  wasCached: boolean;
  wasIncremental: boolean;
}> {
  const result = await getCarDataSmart(options);
  return {
    blocks: result.data.blocks,
    follows: result.data.follows,
    listitems: result.data.listitems,
    wasCached: result.wasCached,
    wasIncremental: result.wasIncremental,
  };
}

/**
 * Get only posts with smart caching
 * Used by context search
 */
export async function getPostsSmart(options: CarFetchOptions): Promise<{
  posts: ParsedPost[];
  wasCached: boolean;
}> {
  const result = await getCarDataSmart(options);
  return {
    posts: result.data.posts,
    wasCached: result.wasCached,
  };
}

/**
 * Get only lists with smart caching
 * Used by list audit
 */
export async function getListsSmart(options: CarFetchOptions): Promise<{
  lists: ParsedListData[];
  wasCached: boolean;
}> {
  const result = await getCarDataSmart(options);
  return {
    lists: result.data.lists,
    wasCached: result.wasCached,
  };
}
