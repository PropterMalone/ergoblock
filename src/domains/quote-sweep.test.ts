import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// quote-sweep's two handlers orchestrate the public API (bgApiRequestPublic), auth,
// profile hydration (graph-ops), storage membership, and the unified create primitive.
// All are mocked so the tests assert the handler contract only.

vi.mock('./api-client.js', () => ({
  getAuthToken: vi.fn(),
  bgApiRequestPublic: vi.fn(),
}));

vi.mock('./graph-ops.js', () => ({
  fetchProfiles: vi.fn(),
}));

vi.mock('./user-actions.js', () => ({
  handleCreateTempAction: vi.fn(),
}));

vi.mock('../platform/storage.js', () => ({
  getTempBlocks: vi.fn().mockResolvedValue({}),
  getPermanentBlocks: vi.fn().mockResolvedValue({}),
  getTempMutes: vi.fn().mockResolvedValue({}),
  getPermanentMutes: vi.fn().mockResolvedValue({}),
}));

// sleep is real but the rate-limit delay would slow the suite; stub it to resolve instantly.
vi.mock('../platform/utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/utils.js')>();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

import { parsePostRef, handleFetchQuotePosters, handleBulkTempAction } from './quote-sweep.js';
import { getAuthToken, bgApiRequestPublic } from './api-client.js';
import { fetchProfiles } from './graph-ops.js';
import { handleCreateTempAction } from './user-actions.js';
import {
  getTempBlocks,
  getPermanentBlocks,
  getTempMutes,
  getPermanentMutes,
} from '../platform/storage.js';

const mockGetAuthToken = vi.mocked(getAuthToken);
const mockBgApiRequestPublic = vi.mocked(bgApiRequestPublic);
const mockFetchProfiles = vi.mocked(fetchProfiles);
const mockHandleCreateTempAction = vi.mocked(handleCreateTempAction);
const mockGetTempBlocks = vi.mocked(getTempBlocks);
const mockGetPermanentBlocks = vi.mocked(getPermanentBlocks);
const mockGetTempMutes = vi.mocked(getTempMutes);
const mockGetPermanentMutes = vi.mocked(getPermanentMutes);

const AUTH = {
  accessJwt: 'jwt',
  refreshJwt: 'refresh',
  did: 'did:plc:owner',
  pdsUrl: 'https://pds.example',
};
const AT_URI = 'at://did:plc:author/app.bsky.feed.post/3kxyz';

/** Build a getQuotes page response with the given quoter DIDs. */
function quotesPage(dids: string[], cursor?: string) {
  return {
    posts: dids.map((did) => ({ author: { did, handle: `${did}.handle` } })),
    cursor,
  };
}

describe('parsePostRef', () => {
  it('passes through a well-formed at-uri', () => {
    const ref = 'at://did:plc:abc123/app.bsky.feed.post/3kxyz';
    const result = parsePostRef(ref);
    expect(result).toEqual({
      author: 'did:plc:abc123',
      authorIsDid: true,
      rkey: '3kxyz',
      atUri: ref,
    });
  });

  it('parses a bsky.app post URL with a handle author', () => {
    const result = parsePostRef('https://bsky.app/profile/alice.bsky.social/post/3kxyz');
    expect(result).toEqual({
      author: 'alice.bsky.social',
      authorIsDid: false,
      rkey: '3kxyz',
      atUri: null,
    });
  });

  it('parses a bsky.app post URL with a DID author (builds at-uri directly)', () => {
    const result = parsePostRef('https://bsky.app/profile/did:plc:abc123/post/3kxyz');
    expect(result).toEqual({
      author: 'did:plc:abc123',
      authorIsDid: true,
      rkey: '3kxyz',
      atUri: 'at://did:plc:abc123/app.bsky.feed.post/3kxyz',
    });
  });

  it('strips a trailing query string and hash from a bsky.app URL', () => {
    const result = parsePostRef(
      'https://bsky.app/profile/alice.bsky.social/post/3kxyz?ref=foo#bar'
    );
    expect(result).toEqual({
      author: 'alice.bsky.social',
      authorIsDid: false,
      rkey: '3kxyz',
      atUri: null,
    });
  });

  it('tolerates a trailing slash on the post URL', () => {
    const result = parsePostRef('https://bsky.app/profile/alice.bsky.social/post/3kxyz/');
    expect(result).not.toBeNull();
    expect(result?.rkey).toBe('3kxyz');
    expect(result?.author).toBe('alice.bsky.social');
  });

  it('accepts a trailing query string on an at-uri', () => {
    const result = parsePostRef('at://did:plc:abc123/app.bsky.feed.post/3kxyz?foo=bar');
    expect(result).toEqual({
      author: 'did:plc:abc123',
      authorIsDid: true,
      rkey: '3kxyz',
      atUri: 'at://did:plc:abc123/app.bsky.feed.post/3kxyz',
    });
  });

  it('returns null for an empty or whitespace input', () => {
    expect(parsePostRef('')).toBeNull();
    expect(parsePostRef('   ')).toBeNull();
  });

  it('returns null for a non-post bsky.app URL', () => {
    expect(parsePostRef('https://bsky.app/profile/alice.bsky.social')).toBeNull();
  });

  it('returns null for arbitrary junk', () => {
    expect(parsePostRef('not a url at all')).toBeNull();
    expect(parsePostRef('https://example.com/foo/bar')).toBeNull();
  });

  it('returns null for an at-uri with the wrong collection', () => {
    expect(parsePostRef('at://did:plc:abc123/app.bsky.feed.like/3kxyz')).toBeNull();
  });
});

describe('handleFetchQuotePosters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthToken.mockResolvedValue(AUTH);
    mockFetchProfiles.mockResolvedValue([]);
  });

  it('returns an actionable error for a non-post ref (no network)', async () => {
    const res = await handleFetchQuotePosters('not a url');
    expect(res.success).toBe(false);
    expect(res.error).toContain('valid Bluesky post');
    expect(mockBgApiRequestPublic).not.toHaveBeenCalled();
  });

  it('a null FIRST page is a hard failure', async () => {
    mockBgApiRequestPublic.mockResolvedValueOnce(null);
    const res = await handleFetchQuotePosters(AT_URI);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Failed to fetch quotes');
  });

  it('a null page on page>0 ends pagination gracefully (keeps page-0 quoters)', async () => {
    mockBgApiRequestPublic
      .mockResolvedValueOnce(quotesPage(['did:plc:a'], 'cursor1'))
      .mockResolvedValueOnce(null);
    mockFetchProfiles.mockResolvedValue([
      { did: 'did:plc:a', handle: 'a.bsky.social', viewer: {} } as never,
    ]);

    const res = await handleFetchQuotePosters(AT_URI);

    expect(res.success).toBe(true);
    expect(res.quoters).toHaveLength(1);
    expect(res.quoters?.[0].did).toBe('did:plc:a');
  });

  it('dedupes the same quoter across pages by DID', async () => {
    mockBgApiRequestPublic
      .mockResolvedValueOnce(quotesPage(['did:plc:a', 'did:plc:b'], 'cursor1'))
      .mockResolvedValueOnce(quotesPage(['did:plc:b', 'did:plc:c'], undefined));
    mockFetchProfiles.mockResolvedValue([
      { did: 'did:plc:a', handle: 'a', viewer: {} } as never,
      { did: 'did:plc:b', handle: 'b', viewer: {} } as never,
      { did: 'did:plc:c', handle: 'c', viewer: {} } as never,
    ]);

    const res = await handleFetchQuotePosters(AT_URI);

    expect(res.success).toBe(true);
    expect(res.quoters?.map((q) => q.did)).toEqual(['did:plc:a', 'did:plc:b', 'did:plc:c']);
  });

  it('sets alreadyBlocked/alreadyMuted from viewer state', async () => {
    mockBgApiRequestPublic.mockResolvedValueOnce(quotesPage(['did:plc:a', 'did:plc:b']));
    mockFetchProfiles.mockResolvedValue([
      { did: 'did:plc:a', handle: 'a', viewer: { blocking: 'at://block/1' } } as never,
      { did: 'did:plc:b', handle: 'b', viewer: { muted: true } } as never,
    ]);

    const res = await handleFetchQuotePosters(AT_URI);

    const a = res.quoters?.find((q) => q.did === 'did:plc:a');
    const b = res.quoters?.find((q) => q.did === 'did:plc:b');
    expect(a?.alreadyBlocked).toBe(true);
    expect(a?.alreadyMuted).toBe(false);
    expect(b?.alreadyMuted).toBe(true);
    expect(b?.alreadyBlocked).toBe(false);
    expect(res.viewerStateUnavailable).toBe(false);
  });

  it('flags viewerStateUnavailable when auth is null (no profile fetch)', async () => {
    mockGetAuthToken.mockResolvedValue(null);
    mockBgApiRequestPublic.mockResolvedValueOnce(quotesPage(['did:plc:a']));

    const res = await handleFetchQuotePosters(AT_URI);

    expect(res.success).toBe(true);
    expect(res.viewerStateUnavailable).toBe(true);
    expect(mockFetchProfiles).not.toHaveBeenCalled();
  });

  it('flags viewerStateUnavailable when fetchProfiles returns fewer than requested', async () => {
    mockBgApiRequestPublic.mockResolvedValueOnce(quotesPage(['did:plc:a', 'did:plc:b']));
    // Only one of two profiles came back.
    mockFetchProfiles.mockResolvedValue([{ did: 'did:plc:a', handle: 'a', viewer: {} } as never]);

    const res = await handleFetchQuotePosters(AT_URI);

    expect(res.viewerStateUnavailable).toBe(true);
  });

  it('sets truncated when pagination hits the page cap', async () => {
    // Always return a cursor so the loop runs until MAX_QUOTES_PAGES (50) and stops with
    // the cursor still set → truncated.
    mockBgApiRequestPublic.mockResolvedValue(quotesPage(['did:plc:a'], 'more'));
    mockFetchProfiles.mockResolvedValue([{ did: 'did:plc:a', handle: 'a', viewer: {} } as never]);

    const res = await handleFetchQuotePosters(AT_URI);

    expect(res.success).toBe(true);
    expect(res.truncated).toBe(true);
    expect(mockBgApiRequestPublic).toHaveBeenCalledTimes(50);
  });

  it('does not set truncated when pagination exhausts the cursor', async () => {
    mockBgApiRequestPublic.mockResolvedValueOnce(quotesPage(['did:plc:a'], undefined));
    mockFetchProfiles.mockResolvedValue([{ did: 'did:plc:a', handle: 'a', viewer: {} } as never]);

    const res = await handleFetchQuotePosters(AT_URI);
    expect(res.truncated).toBe(false);
  });
});

describe('handleBulkTempAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTempBlocks.mockResolvedValue({});
    mockGetPermanentBlocks.mockResolvedValue({});
    mockGetTempMutes.mockResolvedValue({});
    mockGetPermanentMutes.mockResolvedValue({});
    mockHandleCreateTempAction.mockResolvedValue({ success: true });
  });

  it('creates one entry per DID and accounts created/failed/skipped', async () => {
    const res = await handleBulkTempAction(
      ['did:plc:a', 'did:plc:b'],
      { 'did:plc:a': 'a', 'did:plc:b': 'b' },
      false,
      60_000,
      false
    );
    expect(res).toEqual({ created: 2, failed: 0, skipped: 0, errors: [] });
    expect(mockHandleCreateTempAction).toHaveBeenCalledTimes(2);
  });

  it('isolates a per-account failure and keeps processing the rest', async () => {
    mockHandleCreateTempAction
      .mockResolvedValueOnce({ success: false, error: 'boom' })
      .mockResolvedValueOnce({ success: true });

    const res = await handleBulkTempAction(
      ['did:plc:a', 'did:plc:b'],
      { 'did:plc:a': 'a', 'did:plc:b': 'b' },
      false,
      60_000,
      false
    );

    expect(res.created).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toEqual(['@a: boom']);
  });

  it('treats a thrown primitive error as a failure, not an abort', async () => {
    mockHandleCreateTempAction
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ success: true });

    const res = await handleBulkTempAction(
      ['did:plc:a', 'did:plc:b'],
      { 'did:plc:a': 'a', 'did:plc:b': 'b' },
      false,
      60_000,
      false
    );

    expect(res.created).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors[0]).toContain('network down');
  });

  it('skips a DID already in temp/permanent block storage (idempotent — no duplicate)', async () => {
    mockGetTempBlocks.mockResolvedValue({ 'did:plc:a': { handle: 'a' } as never });
    mockGetPermanentBlocks.mockResolvedValue({ 'did:plc:c': { handle: 'c' } as never });

    const res = await handleBulkTempAction(
      ['did:plc:a', 'did:plc:b', 'did:plc:c'],
      { 'did:plc:a': 'a', 'did:plc:b': 'b', 'did:plc:c': 'c' },
      false,
      60_000,
      false
    );

    expect(res.created).toBe(1);
    expect(res.skipped).toBe(2);
    // Only the un-blocked DID reaches the primitive.
    expect(mockHandleCreateTempAction).toHaveBeenCalledOnce();
    expect(mockHandleCreateTempAction).toHaveBeenCalledWith('did:plc:b', 'b', 60_000, false, false);
  });

  it('uses mute storage for the membership guard when isMute', async () => {
    mockGetTempMutes.mockResolvedValue({ 'did:plc:a': { handle: 'a' } as never });

    const res = await handleBulkTempAction(
      ['did:plc:a', 'did:plc:b'],
      { 'did:plc:a': 'a', 'did:plc:b': 'b' },
      true,
      60_000,
      false
    );

    expect(res.skipped).toBe(1);
    expect(res.created).toBe(1);
    // Block storage must NOT be consulted for a mute action.
    expect(mockGetTempBlocks).not.toHaveBeenCalled();
    expect(mockGetTempMutes).toHaveBeenCalled();
  });
});
