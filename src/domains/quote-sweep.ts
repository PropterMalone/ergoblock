/**
 * Quote Sweep — fetch everyone who quote-posted a given Bluesky post, then bulk
 * temp-block/mute a human-selected subset.
 *
 * Two seams behind the GET_QUOTE_POSTERS / BULK_TEMP_ACTION messages:
 *   1. handleFetchQuotePosters — resolve a post ref → at-uri, page getQuotes,
 *      dedupe quoters by DID, hydrate display + viewer state.
 *   2. handleBulkTempAction — loop the human's selection through the UNIFIED
 *      create primitive (handleCreateTempAction), never the raw graph ops, so we
 *      don't re-introduce the create-path divergence Phase 1 removed.
 */

// pattern: Functional Core (parsePostRef) + Imperative Shell (handlers)

import { getAuthToken, bgApiRequestPublic } from './api-client.js';
import { fetchProfiles } from './graph-ops.js';
import { handleCreateTempAction } from './user-actions.js';
import {
  getTempBlocks,
  getPermanentBlocks,
  getTempMutes,
  getPermanentMutes,
} from '../platform/storage.js';
import { createLogger, sleep } from '../platform/utils.js';
import type { PostView, QuotePoster } from '../types.js';

const log = createLogger('bg:quote-sweep');

const API_DELAY_MS = 200; // Rate limit between bulk create calls (mirrors import-export)
const QUOTES_PAGE_LIMIT = 100; // getQuotes max page size
const MAX_QUOTES_PAGES = 50; // Bound pagination (≤5000 quoters)

const POST_COLLECTION = 'app.bsky.feed.post';

/** Parsed post reference. `atUri` is non-null once it can be built without a network resolve. */
export interface ParsedPostRef {
  /** The author segment — a DID or a handle. */
  author: string;
  /** True when `author` is already a DID (no resolve needed). */
  authorIsDid: boolean;
  /** Post record key. */
  rkey: string;
  /** The full at-uri, present when the author is a DID; null when a handle resolve is still required. */
  atUri: string | null;
}

function isDid(value: string): boolean {
  return value.startsWith('did:');
}

/**
 * Parse a post reference into its parts. Accepts either:
 *   - an at-uri:   at://<did>/app.bsky.feed.post/<rkey>   (optional trailing query)
 *   - a bsky URL:  https://bsky.app/profile/<handleOrDid>/post/<rkey>
 *
 * Pure. Returns null for anything that is not a recognizable post reference, or an
 * at-uri whose collection is not app.bsky.feed.post.
 */
export function parsePostRef(ref: string): ParsedPostRef | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  // at-uri form: at://<author>/<collection>/<rkey>
  if (trimmed.startsWith('at://')) {
    // Drop a trailing query string / fragment if present.
    const clean = trimmed.split(/[?#]/)[0];
    const rest = clean.slice('at://'.length);
    const parts = rest.split('/');
    if (parts.length !== 3) return null;
    const [author, collection, rkey] = parts;
    if (!author || collection !== POST_COLLECTION || !rkey) return null;
    return {
      author,
      authorIsDid: isDid(author),
      rkey,
      atUri: `at://${author}/${POST_COLLECTION}/${rkey}`,
    };
  }

  // bsky.app URL form.
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!url.hostname.endsWith('bsky.app')) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  // Expect: ['profile', <handleOrDid>, 'post', <rkey>]
  if (segments.length < 4 || segments[0] !== 'profile' || segments[2] !== 'post') return null;
  const author = segments[1];
  const rkey = segments[3];
  if (!author || !rkey) return null;

  const authorIsDid = isDid(author);
  return {
    author,
    authorIsDid,
    rkey,
    // Only a DID author lets us build the at-uri without a network resolve.
    atUri: authorIsDid ? `at://${author}/${POST_COLLECTION}/${rkey}` : null,
  };
}

interface ResolveHandleResponse {
  did?: string;
}

interface GetQuotesResponse {
  posts?: PostView[];
  cursor?: string;
}

export interface FetchQuotePostersResult {
  success: boolean;
  subject?: string;
  quoters?: QuotePoster[];
  /**
   * True when viewer state could not be resolved (no auth, or fetchProfiles returned
   * empty / fewer profiles than DIDs requested). In that case alreadyBlocked/alreadyMuted
   * are unreliable — the tab surfaces a warning and does NOT default-select-all.
   */
  viewerStateUnavailable?: boolean;
  /** True when pagination hit MAX_QUOTES_PAGES (quoter list is incomplete). */
  truncated?: boolean;
  error?: string;
}

/**
 * Resolve a post ref to its at-uri, building it via a handle→DID resolve when needed.
 */
async function resolveAtUri(parsed: ParsedPostRef): Promise<string | null> {
  if (parsed.atUri) return parsed.atUri;
  // Author is a handle — resolve to a DID via the public AppView.
  const cleanHandle = parsed.author.replace(/^@/, '');
  const resolved = await bgApiRequestPublic<ResolveHandleResponse>(
    `com.atproto.identity.resolveHandle?handle=${encodeURIComponent(cleanHandle)}`
  );
  if (!resolved?.did) return null;
  return `at://${resolved.did}/${POST_COLLECTION}/${parsed.rkey}`;
}

/**
 * Fetch every account that quote-posted the given post, with display + viewer state.
 */
export async function handleFetchQuotePosters(postRef: string): Promise<FetchQuotePostersResult> {
  try {
    const parsed = parsePostRef(postRef);
    if (!parsed) {
      return { success: false, error: 'Not a valid Bluesky post URL or at:// URI' };
    }

    const atUri = await resolveAtUri(parsed);
    if (!atUri) {
      return { success: false, error: `Could not resolve "${parsed.author}" to a post` };
    }

    // Page through getQuotes, deduping quoters by DID.
    const quoterDids: string[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    let truncated = false;

    do {
      const params = new URLSearchParams({
        uri: atUri,
        limit: String(QUOTES_PAGE_LIMIT),
      });
      if (cursor) params.set('cursor', cursor);

      const page = await bgApiRequestPublic<GetQuotesResponse>(
        `app.bsky.feed.getQuotes?${params.toString()}`
      );
      if (!page) {
        // A null page on the first request is a hard failure; later it just ends pagination.
        if (pages === 0) {
          return { success: false, error: 'Failed to fetch quotes (post may not exist)' };
        }
        break;
      }

      for (const post of page.posts ?? []) {
        const did = post.author?.did;
        if (did && !seen.has(did)) {
          seen.add(did);
          quoterDids.push(did);
        }
      }

      cursor = page.cursor;
      pages += 1;
    } while (cursor && pages < MAX_QUOTES_PAGES);

    // A surviving cursor at the cap means there are more quoters we didn't fetch.
    if (cursor && pages >= MAX_QUOTES_PAGES) {
      truncated = true;
    }

    if (quoterDids.length === 0) {
      return { success: true, subject: atUri, quoters: [], truncated };
    }

    // Hydrate display info + viewer state. Needs auth so viewer.blocking/muted resolve.
    const auth = await getAuthToken();
    const profiles = auth ? await fetchProfiles(quoterDids, auth.accessJwt, auth.pdsUrl) : [];
    const profileByDid = new Map(profiles.map((p) => [p.did, p]));

    // When auth is missing OR the profile fetch came back empty/short, viewer state
    // (alreadyBlocked/alreadyMuted) is unreliable: we can't tell who the user already
    // blocks, so a bulk select-all would mass-reblock. Flag it for the tab.
    const viewerStateUnavailable = !auth || profiles.length < quoterDids.length;

    const quoters: QuotePoster[] = quoterDids.map((did) => {
      const profile = profileByDid.get(did);
      return {
        did,
        handle: profile?.handle || did,
        displayName: profile?.displayName,
        avatar: profile?.avatar,
        alreadyBlocked: !!profile?.viewer?.blocking,
        alreadyMuted: !!profile?.viewer?.muted,
      };
    });

    return { success: true, subject: atUri, quoters, truncated, viewerStateUnavailable };
  } catch (error) {
    log.error('Fetch quote posters failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export interface BulkTempActionResult {
  created: number;
  failed: number;
  /** DIDs already in the relevant block/mute storage; skipped to keep the bulk idempotent. */
  skipped: number;
  errors: string[];
}

/**
 * Bulk temp-block or temp-mute a set of DIDs by looping the UNIFIED create primitive.
 * Each call is rate-limited; failures are collected and skipped (never abort the batch).
 *
 * Idempotency guard: a DID already present in our block (or mute) storage is skipped
 * rather than re-created. Without this, re-running a sweep before the AppView catches up
 * would create a second block record whose new rkey is untracked — an orphaned duplicate.
 */
export async function handleBulkTempAction(
  dids: string[],
  handles: Record<string, string>,
  isMute: boolean,
  durationMs: number,
  isPermanent: boolean
): Promise<BulkTempActionResult> {
  const result: BulkTempActionResult = { created: 0, failed: 0, skipped: 0, errors: [] };

  // Snapshot the relevant storage once so the membership check is cheap per-DID.
  const [tempExisting, permanentExisting] = isMute
    ? await Promise.all([getTempMutes(), getPermanentMutes()])
    : await Promise.all([getTempBlocks(), getPermanentBlocks()]);

  let pending = 0; // count of DIDs we'll actually call the primitive for (for delay spacing)
  for (const did of dids) {
    if (!(did in tempExisting) && !(did in permanentExisting)) pending += 1;
  }

  let processed = 0;
  for (const did of dids) {
    const handle = handles[did] || did;

    // Already in our storage → skip (idempotent; no orphaned duplicate record).
    if (did in tempExisting || did in permanentExisting) {
      result.skipped += 1;
      continue;
    }

    try {
      const res = await handleCreateTempAction(did, handle, durationMs, isMute, isPermanent);
      if (res.success) {
        result.created += 1;
      } else {
        result.failed += 1;
        result.errors.push(`@${handle}: ${res.error || 'failed'}`);
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(`@${handle}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Rate limit between create calls (skip the trailing delay after the last one).
    processed += 1;
    if (processed < pending) {
      await sleep(API_DELAY_MS);
    }
  }

  return result;
}
