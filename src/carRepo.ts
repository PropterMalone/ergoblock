import { fromUint8Array as repoFromUint8Array } from '@atcute/repo';
import { decode } from '@atcute/cbor';

const BSKY_RELAY = 'https://bsky.network';

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
 */
async function downloadCarFile(
  did: string,
  pdsUrl: string | null,
  onProgress?: CarProgressCallback
): Promise<Uint8Array> {
  onProgress?.('Downloading repository...');

  // Try user's PDS first
  if (pdsUrl) {
    try {
      const response = await fetch(
        `${pdsUrl}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}`
      );
      if (response.ok) {
        return await streamResponseToUint8Array(response, onProgress);
      }
      console.warn(`[ErgoBlock CAR] PDS fetch failed: ${response.status}, trying relay`);
    } catch (error) {
      console.warn(`[ErgoBlock CAR] PDS fetch error, trying relay:`, error);
    }
  }

  // Fallback to public relay
  const relayResponse = await fetch(
    `${BSKY_RELAY}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}`
  );
  if (!relayResponse.ok) {
    throw new Error(`Failed to download repo: ${relayResponse.status}`);
  }

  return await streamResponseToUint8Array(relayResponse, onProgress);
}

/**
 * Stream response body to Uint8Array with progress reporting
 */
async function streamResponseToUint8Array(
  response: Response,
  onProgress?: CarProgressCallback
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : null;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
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
