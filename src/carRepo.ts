import { fromUint8Array as repoFromUint8Array } from '@atcute/repo';
import { decode } from '@atcute/cbor';

const BSKY_RELAY = 'https://bsky.network';

// Timeout for CAR file downloads (2 minutes - large repos can be 100MB+)
const CAR_DOWNLOAD_TIMEOUT_MS = 120000;

/**
 * Response from com.atproto.sync.getLatestCommit
 */
export interface LatestCommitResponse {
  cid: string;
  rev: string;
}

/**
 * Result of an incremental block sync
 */
export interface IncrementalBlockSyncResult {
  blocks: string[];
  rev: string;
  wasIncremental: boolean; // true if we used incremental sync, false if full download
}

/**
 * Parsed post from a CAR file repository
 */
export interface ParsedPost {
  uri: string;
  cid: string;
  text: string;
  createdAt: string;
  reply?: { parent: { uri: string }; root?: { uri: string } };
  embed?: { $type: string; record?: { uri: string } };
}

/**
 * Result of fetching and parsing a repository
 */
export interface ParsedRepoData {
  posts: ParsedPost[];
  fetchedAt: number;
}

/**
 * Progress callback for download/parse stages
 */
export type CarProgressCallback = (stage: string) => void;

/**
 * Post record structure in the CAR file
 */
interface PostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  reply?: {
    parent: { uri: string; cid: string };
    root: { uri: string; cid: string };
  };
  embed?: {
    $type: string;
    record?: { uri: string; cid?: string };
  };
}

/**
 * Repository entry from @atcute/repo
 */
interface RepoEntry {
  collection: string;
  rkey: string;
  bytes: Uint8Array;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Download a CAR file from the user's PDS or fallback relay
 * Includes timeout to prevent hanging on large repos
 */
async function downloadCarFile(
  did: string,
  pdsUrl: string | null,
  onProgress?: CarProgressCallback,
  timeoutMs: number = CAR_DOWNLOAD_TIMEOUT_MS
): Promise<Uint8Array> {
  onProgress?.('Downloading repository...');

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    onProgress?.('Download timed out');
  }, timeoutMs);

  try {
    // Try user's PDS first
    if (pdsUrl) {
      try {
        const response = await fetch(
          `${pdsUrl}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}`,
          { signal: controller.signal }
        );
        if (response.ok) {
          return await streamResponseToUint8Array(response, onProgress, controller.signal);
        }
        console.warn(`[ErgoBlock CAR] PDS fetch failed: ${response.status}, trying relay`);
      } catch (error) {
        // Check if this was an abort (timeout)
        // Note: DOMException may not extend Error in all environments
        if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') {
          throw new Error(`CAR download timed out after ${timeoutMs}ms`);
        }
        console.warn(`[ErgoBlock CAR] PDS fetch error, trying relay:`, error);
      }
    }

    // Fallback to public relay
    const relayResponse = await fetch(
      `${BSKY_RELAY}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}`,
      { signal: controller.signal }
    );
    if (!relayResponse.ok) {
      throw new Error(`Failed to download repo: ${relayResponse.status}`);
    }

    return await streamResponseToUint8Array(relayResponse, onProgress, controller.signal);
  } catch (error) {
    // Convert abort to timeout error
    // Note: DOMException may not extend Error in all environments
    if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') {
      throw new Error(`CAR download timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Stream response body to Uint8Array with progress reporting
 * Supports abort signal for timeout handling
 */
async function streamResponseToUint8Array(
  response: Response,
  onProgress?: CarProgressCallback,
  abortSignal?: AbortSignal
): Promise<Uint8Array> {
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
      // Check if aborted before each read
      if (abortSignal?.aborted) {
        reader.cancel();
        throw new Error('Download aborted');
      }

      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedBytes += value.length;

      if (totalBytes) {
        const percent = Math.round((receivedBytes / totalBytes) * 100);
        onProgress?.(
          `Downloading... ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)} (${percent}%)`
        );
      } else {
        onProgress?.(`Downloading... ${formatBytes(receivedBytes)}`);
      }
    }
  } catch (error) {
    reader.cancel();
    throw error;
  }

  // Combine chunks into single Uint8Array
  const result = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Block record structure in the CAR file
 */
interface BlockRecord {
  $type: 'app.bsky.graph.block';
  subject: string;
  createdAt: string;
}

/**
 * List record structure in the CAR file
 */
interface ListRecord {
  $type: 'app.bsky.graph.list';
  name: string;
  purpose: string;
  description?: string;
  createdAt: string;
}

/**
 * List item record structure in the CAR file
 */
interface ListItemRecord {
  $type: 'app.bsky.graph.listitem';
  subject: string; // DID of the user on this list
  list: string; // at:// URI of the list this item belongs to
  createdAt: string;
}

/**
 * Parsed list data from a CAR file
 */
export interface ParsedListData {
  uri: string;
  name: string;
  description?: string;
  members: string[];
}

/**
 * Result of parsing lists from a CAR file
 */
export interface ParsedListsResult {
  lists: Record<string, ParsedListData>; // keyed by list URI
  creatorDid: string;
}

/**
 * Parse a CAR file and extract all blocks (DIDs that this user has blocked)
 */
export function parseCarForBlocks(carData: Uint8Array): string[] {
  const repo = repoFromUint8Array(carData);
  const blocks: string[] = [];

  for (const entry of repo as Iterable<RepoEntry>) {
    if (entry.collection !== 'app.bsky.graph.block') {
      continue;
    }

    try {
      const record = decode(entry.bytes) as { $type?: string };

      if (record.$type === 'app.bsky.graph.block') {
        const block = record as BlockRecord;
        if (block.subject) {
          blocks.push(block.subject);
        }
      }
    } catch (error) {
      // Skip malformed entries
      console.warn('[ErgoBlock CAR] Failed to decode block entry:', error);
    }
  }

  return blocks;
}

/**
 * Fetch a user's CAR file and extract their block list
 */
export async function fetchBlocksFromCar(did: string, pdsUrl: string | null): Promise<string[]> {
  const carData = await downloadCarFile(did, pdsUrl);
  return parseCarForBlocks(carData);
}

/**
 * Parse a CAR file and extract all lists and their members
 * Used for deep sync of blocklist members
 *
 * @param carData - Raw CAR file data
 * @param creatorDid - DID of the list creator (for building URIs)
 * @param targetListUris - Optional set of list URIs to filter (only parse these lists)
 * @returns Lists with their members
 */
export function parseCarForLists(
  carData: Uint8Array,
  creatorDid: string,
  targetListUris?: Set<string>
): ParsedListsResult {
  const repo = repoFromUint8Array(carData);

  // First pass: collect list metadata
  const listMetadata: Record<string, { name: string; description?: string; rkey: string }> = {};
  // Second pass data: list items grouped by list URI
  const listItems: Record<string, string[]> = {};

  for (const entry of repo as Iterable<RepoEntry>) {
    try {
      if (entry.collection === 'app.bsky.graph.list') {
        const record = decode(entry.bytes) as { $type?: string };
        if (record.$type === 'app.bsky.graph.list') {
          const list = record as ListRecord;
          const listUri = `at://${creatorDid}/app.bsky.graph.list/${entry.rkey}`;

          // Skip if we have a target filter and this list isn't in it
          if (targetListUris && !targetListUris.has(listUri)) {
            continue;
          }

          listMetadata[listUri] = {
            name: list.name,
            description: list.description,
            rkey: entry.rkey,
          };
          listItems[listUri] = [];
        }
      } else if (entry.collection === 'app.bsky.graph.listitem') {
        const record = decode(entry.bytes) as { $type?: string };
        if (record.$type === 'app.bsky.graph.listitem') {
          const item = record as ListItemRecord;

          // Skip if we have a target filter and this item's list isn't in it
          if (targetListUris && !targetListUris.has(item.list)) {
            continue;
          }

          if (!listItems[item.list]) {
            listItems[item.list] = [];
          }
          listItems[item.list].push(item.subject);
        }
      }
    } catch (error) {
      // Skip malformed entries
      console.warn('[ErgoBlock CAR] Failed to decode list entry:', error);
    }
  }

  // Combine metadata and items
  const lists: Record<string, ParsedListData> = {};
  for (const [uri, metadata] of Object.entries(listMetadata)) {
    lists[uri] = {
      uri,
      name: metadata.name,
      description: metadata.description,
      members: listItems[uri] || [],
    };
  }

  // Also include lists we found items for but no metadata (shouldn't happen but be safe)
  for (const [uri, members] of Object.entries(listItems)) {
    if (!lists[uri] && members.length > 0) {
      lists[uri] = {
        uri,
        name: 'Unknown List',
        members,
      };
    }
  }

  return { lists, creatorDid };
}

/**
 * Fetch a user's CAR file and extract their lists with members
 *
 * @param did - DID of the list creator
 * @param pdsUrl - Optional PDS URL
 * @param targetListUris - Optional set of list URIs to filter
 * @param onProgress - Optional progress callback
 * @returns Parsed lists with members
 */
export async function fetchListsFromCar(
  did: string,
  pdsUrl: string | null,
  targetListUris?: Set<string>,
  onProgress?: CarProgressCallback
): Promise<ParsedListsResult> {
  const carData = await downloadCarFile(did, pdsUrl, onProgress);
  onProgress?.('Parsing lists...');
  return parseCarForLists(carData, did, targetListUris);
}

/**
 * Get the latest commit revision for a repository
 * This is a lightweight call to check if a repo has changed
 *
 * @param did - User's DID
 * @param pdsUrl - User's PDS URL (optional, will fallback to relay)
 * @returns Latest commit info or null if unavailable
 */
export async function getLatestCommit(
  did: string,
  pdsUrl: string | null
): Promise<LatestCommitResponse | null> {
  const endpoints = [
    pdsUrl
      ? `${pdsUrl}/xrpc/com.atproto.sync.getLatestCommit?did=${encodeURIComponent(did)}`
      : null,
    `${BSKY_RELAY}/xrpc/com.atproto.sync.getLatestCommit?did=${encodeURIComponent(did)}`,
  ].filter(Boolean) as string[];

  for (const url of endpoints) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = (await response.json()) as LatestCommitResponse;
        return data;
      }
    } catch {
      // Try next endpoint
    }
  }

  return null;
}

/**
 * Download a CAR file with optional `since` parameter for incremental sync
 * Includes timeout to prevent hanging on large repos
 */
async function downloadCarFileIncremental(
  did: string,
  pdsUrl: string | null,
  since?: string,
  onProgress?: CarProgressCallback,
  timeoutMs: number = CAR_DOWNLOAD_TIMEOUT_MS
): Promise<Uint8Array> {
  const sinceParam = since ? `&since=${encodeURIComponent(since)}` : '';
  onProgress?.(since ? 'Downloading changes...' : 'Downloading repository...');

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    onProgress?.('Download timed out');
  }, timeoutMs);

  try {
    // Try user's PDS first
    if (pdsUrl) {
      try {
        const response = await fetch(
          `${pdsUrl}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}${sinceParam}`,
          { signal: controller.signal }
        );
        if (response.ok) {
          return await streamResponseToUint8Array(response, onProgress, controller.signal);
        }
        // If incremental fails with 400, PDS might not support `since` - fall through to full download
        if (response.status === 400 && since) {
          console.warn(`[ErgoBlock CAR] PDS doesn't support incremental sync, will do full download`);
          throw new Error('Incremental not supported');
        }
        console.warn(`[ErgoBlock CAR] PDS fetch failed: ${response.status}, trying relay`);
      } catch (error) {
        if (error instanceof Error && error.message === 'Incremental not supported') {
          throw error;
        }
        // Note: DOMException may not extend Error in all environments
        if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') {
          throw new Error(`CAR download timed out after ${timeoutMs}ms`);
        }
        console.warn(`[ErgoBlock CAR] PDS fetch error, trying relay:`, error);
      }
    }

    // Fallback to public relay
    const relayResponse = await fetch(
      `${BSKY_RELAY}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}${sinceParam}`,
      { signal: controller.signal }
    );

    if (!relayResponse.ok) {
      if (relayResponse.status === 400 && since) {
        throw new Error('Incremental not supported');
      }
      throw new Error(`Failed to download repo: ${relayResponse.status}`);
    }

    return await streamResponseToUint8Array(relayResponse, onProgress, controller.signal);
  } catch (error) {
    // Note: DOMException may not extend Error in all environments
    if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') {
      throw new Error(`CAR download timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse incremental CAR data and extract block changes
 * Incremental CAR contains only changed records since the `since` revision
 *
 * @param carData - Incremental CAR data
 * @param existingBlocks - Current block list to merge with
 * @returns Updated block list (merged with new blocks, removed unblocks)
 */
function parseIncrementalCarForBlocks(carData: Uint8Array, existingBlocks: string[]): string[] {
  const repo = repoFromUint8Array(carData);
  const newBlocks = new Set(existingBlocks);

  for (const entry of repo as Iterable<RepoEntry>) {
    if (entry.collection !== 'app.bsky.graph.block') {
      continue;
    }

    try {
      // In incremental CAR, we get both adds and deletes
      // A record with bytes means it was added/modified
      // Empty or tombstone means it was deleted
      if (entry.bytes.length === 0) {
        // This block record was deleted (user unblocked someone)
        // We don't have the subject in the tombstone, so we'll need to do a full sync
        // For now, just continue - the block will be removed on next full sync
        continue;
      }

      const record = decode(entry.bytes) as { $type?: string };
      if (record.$type === 'app.bsky.graph.block') {
        const block = record as BlockRecord;
        if (block.subject) {
          newBlocks.add(block.subject);
        }
      }
    } catch (error) {
      console.warn('[ErgoBlock CAR] Failed to decode incremental block entry:', error);
    }
  }

  return Array.from(newBlocks);
}

/**
 * Fetch blocks with incremental sync support
 * Checks if repo has changed before downloading, uses diff if available
 *
 * @param did - User's DID
 * @param pdsUrl - User's PDS URL (optional)
 * @param cachedRev - Previously cached revision (if any)
 * @param cachedBlocks - Previously cached blocks (if any)
 * @returns Block list, new revision, and whether incremental sync was used
 */
export async function fetchBlocksFromCarIncremental(
  did: string,
  pdsUrl: string | null,
  cachedRev?: string,
  cachedBlocks?: string[]
): Promise<IncrementalBlockSyncResult> {
  // Step 1: Check latest commit
  const latestCommit = await getLatestCommit(did, pdsUrl);

  if (!latestCommit) {
    // Can't check revision, do full download
    const blocks = await fetchBlocksFromCar(did, pdsUrl);
    return { blocks, rev: '', wasIncremental: false };
  }

  // Step 2: If revision unchanged and we have cached data, skip download entirely
  if (cachedRev && cachedRev === latestCommit.rev && cachedBlocks) {
    console.log(`[ErgoBlock CAR] Repo unchanged for ${did}, skipping download`);
    return { blocks: cachedBlocks, rev: latestCommit.rev, wasIncremental: true };
  }

  // Step 3: Try incremental download if we have a previous revision
  if (cachedRev && cachedBlocks) {
    try {
      const incrementalData = await downloadCarFileIncremental(did, pdsUrl, cachedRev);

      // Parse incremental changes and merge with existing blocks
      const mergedBlocks = parseIncrementalCarForBlocks(incrementalData, cachedBlocks);

      console.log(
        `[ErgoBlock CAR] Incremental sync for ${did}: ${cachedBlocks.length} -> ${mergedBlocks.length} blocks`
      );

      return { blocks: mergedBlocks, rev: latestCommit.rev, wasIncremental: true };
    } catch (error) {
      // Incremental failed (not supported or error), fall back to full download
      console.warn(
        `[ErgoBlock CAR] Incremental sync failed for ${did}, doing full download:`,
        error
      );
    }
  }

  // Step 4: Full download (no cache or incremental failed)
  const carData = await downloadCarFile(did, pdsUrl);
  const blocks = parseCarForBlocks(carData);

  return { blocks, rev: latestCommit.rev, wasIncremental: false };
}

/**
 * Parse a CAR file and extract all posts
 */
function parseCarForPosts(carData: Uint8Array, did: string): ParsedPost[] {
  const repo = repoFromUint8Array(carData);
  const posts: ParsedPost[] = [];

  for (const entry of repo as Iterable<RepoEntry>) {
    if (entry.collection !== 'app.bsky.feed.post') {
      continue;
    }

    try {
      const record = decode(entry.bytes) as { $type?: string };

      if (record.$type === 'app.bsky.feed.post') {
        const post = record as PostRecord;
        posts.push({
          uri: `at://${did}/app.bsky.feed.post/${entry.rkey}`,
          cid: '', // CID not needed for interaction detection
          text: post.text || '',
          createdAt: post.createdAt,
          reply: post.reply
            ? {
                parent: { uri: post.reply.parent.uri },
                root: post.reply.root ? { uri: post.reply.root.uri } : undefined,
              }
            : undefined,
          embed: post.embed
            ? {
                $type: post.embed.$type,
                record: post.embed.record ? { uri: post.embed.record.uri } : undefined,
              }
            : undefined,
        });
      }
    } catch (error) {
      // Skip malformed entries
      console.warn('[ErgoBlock CAR] Failed to decode entry:', error);
    }
  }

  return posts;
}

/**
 * Fetch and parse a user's repository for posts
 *
 * Downloads the entire repository as a CAR file in a single request,
 * then parses it locally to extract all posts. This is more efficient
 * than paginated API calls for finding historical interactions.
 *
 * @param did - User's DID
 * @param pdsUrl - User's PDS URL (optional, will fallback to relay)
 * @param onProgress - Progress callback for UI feedback
 */
export async function fetchAndParseRepo(
  did: string,
  pdsUrl: string | null,
  onProgress?: CarProgressCallback
): Promise<ParsedRepoData> {
  const carData = await downloadCarFile(did, pdsUrl, onProgress);

  onProgress?.('Parsing repository...');
  const posts = parseCarForPosts(carData, did);

  onProgress?.(`Found ${posts.length} posts`);

  return {
    posts,
    fetchedAt: Date.now(),
  };
}
