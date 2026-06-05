# QT Peek Implementation Plan - Phase 4

**Goal:** Implement the full peek execution flow — extract parent post URI, fetch from public API, resolve concealed embed, return quoted post content

**Architecture:** Replace the `executePeek` stub from Phase 3 with the complete flow. Uses `extractPostUri` from `post-context.ts` to get the parent post's AT URI, sends a `FETCH_POSTS_PUBLIC` message to the background worker (Phase 1), parses the response to find the resolved embed, and handles the two-step fallback for detached quotes.

**Tech Stack:** TypeScript (strict mode)

**Scope:** Phase 4 of 6 phases from design plan `docs/design-plans/2026-02-07-qt-peek.md`

**Codebase verified:** 2026-02-07

---

## Phase Overview

The peek flow has these steps:
1. Extract the parent post's AT URI from the DOM (using existing `extractPostUri` pattern)
2. Send `FETCH_POSTS_PUBLIC` message to background worker with the parent URI
3. Parse the response to find the embed view
4. If `viewRecord` → extract quoted post content directly
5. If `viewDetached` → extract the quoted post URI, make a second fetch for that post directly
6. If `viewBlocked` → same as viewDetached (should resolve on public API, but fallback)
7. Return the resolved post data for UI rendering (Phase 5)

---

<!-- START_TASK_1 -->
### Task 1: Add Peek Resolution Logic to qt-peek.ts

**Files:**
- Modify: `src/qt-peek.ts`

**Step 1: Add the resolved peek content type**

Add the following type at the top of `src/qt-peek.ts`, after the `ConcealedQuoteInfo` interface:

```typescript
/**
 * Resolved content from a peeked quote
 */
export interface PeekedQuoteContent {
  /** AT URI of the quoted post */
  uri: string;
  /** Author display name */
  authorDisplayName?: string;
  /** Author handle (e.g., user.bsky.social) */
  authorHandle: string;
  /** Author DID */
  authorDid: string;
  /** Post text content */
  text: string;
  /** Post creation timestamp (ISO string) */
  createdAt: string;
  /** Original concealment type that was resolved */
  concealmentType: ConcealedQuoteInfo['type'];
}
```

**Step 2: Add the resolveQuoteEmbed function**

Add the following function to `src/qt-peek.ts`:

```typescript
import type {
  PostView,
  PostViewEmbedRecord,
  PostViewEmbedRecordWithMedia,
  EmbedRecordViewRecord,
} from './types.js';
import browser from './browser.js';

/**
 * Fetch posts from the public API via the background worker.
 * Routes through the background to avoid CORS restrictions.
 *
 * @param uris - Array of AT Protocol post URIs
 * @returns Array of PostView objects
 */
async function fetchPostsViaBackground(uris: string[]): Promise<PostView[]> {
  const response = (await browser.runtime.sendMessage({
    type: 'FETCH_POSTS_PUBLIC',
    uris,
  })) as { success: boolean; posts?: PostView[]; error?: string };

  if (!response?.success) {
    throw new Error(response?.error || 'Failed to fetch posts from public API');
  }

  return response.posts || [];
}

/**
 * Extract the embed record view from a post's embed field.
 * Handles both plain record embeds and recordWithMedia embeds.
 */
function extractEmbedRecord(
  post: PostView
): { $type: string; uri?: string; [key: string]: unknown } | null {
  if (!post.embed) return null;

  if (post.embed.$type === 'app.bsky.embed.record#view') {
    return (post.embed as PostViewEmbedRecord).record;
  }

  if (post.embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    return (post.embed as PostViewEmbedRecordWithMedia).record.record;
  }

  return null;
}

/**
 * Resolve a concealed quote embed by fetching from the public API.
 *
 * Flow:
 * 1. Fetch the parent post from public API
 * 2. Check the embed view type
 * 3. If viewRecord → return content directly
 * 4. If viewBlocked/viewDetached → extract URI, fetch quoted post directly
 * 5. If viewNotFound → return error (post was deleted)
 *
 * @param parentPostUri - AT URI of the parent post (the one containing the quote)
 * @param concealmentType - The type of concealment detected in the DOM
 * @returns Resolved quote content, or null if unresolvable
 */
export async function resolveQuoteEmbed(
  parentPostUri: string,
  concealmentType: ConcealedQuoteInfo['type']
): Promise<PeekedQuoteContent | null> {
  // Step 1: Fetch the parent post from public API
  const parentPosts = await fetchPostsViaBackground([parentPostUri]);
  if (parentPosts.length === 0) {
    console.warn('[ErgoBlock QT Peek] Parent post not found on public API:', parentPostUri);
    return null;
  }

  const parentPost = parentPosts[0];

  // Step 2: Extract the embed record
  const embedRecord = extractEmbedRecord(parentPost);
  if (!embedRecord) {
    console.warn('[ErgoBlock QT Peek] Parent post has no embed record:', parentPostUri);
    return null;
  }

  console.log('[ErgoBlock QT Peek] Embed record type:', embedRecord.$type);

  // Step 3: Handle based on embed view type
  if (embedRecord.$type === 'app.bsky.embed.record#viewRecord') {
    // The public API resolved it — content is available directly
    const viewRecord = embedRecord as unknown as EmbedRecordViewRecord;
    return {
      uri: viewRecord.uri,
      authorDisplayName: viewRecord.author.displayName,
      authorHandle: viewRecord.author.handle,
      authorDid: viewRecord.author.did,
      text: viewRecord.value.text,
      createdAt: viewRecord.value.createdAt,
      concealmentType,
    };
  }

  // Step 4: For blocked/detached/notFound — try fetching the quoted post directly
  if (
    embedRecord.$type === 'app.bsky.embed.record#viewBlocked' ||
    embedRecord.$type === 'app.bsky.embed.record#viewDetached'
  ) {
    const quotedUri = embedRecord.uri as string;
    if (!quotedUri) {
      console.warn('[ErgoBlock QT Peek] No URI in blocked/detached embed');
      return null;
    }

    console.log('[ErgoBlock QT Peek] Fetching quoted post directly:', quotedUri);
    const quotedPosts = await fetchPostsViaBackground([quotedUri]);

    if (quotedPosts.length === 0) {
      console.warn('[ErgoBlock QT Peek] Quoted post not found on public API:', quotedUri);
      return null;
    }

    const quotedPost = quotedPosts[0];
    return {
      uri: quotedPost.uri,
      authorDisplayName: quotedPost.author.displayName,
      authorHandle: quotedPost.author.handle,
      authorDid: quotedPost.author.did,
      text: quotedPost.record.text,
      createdAt: quotedPost.record.createdAt,
      concealmentType,
    };
  }

  if (embedRecord.$type === 'app.bsky.embed.record#viewNotFound') {
    // Post was deleted — can't recover
    console.log('[ErgoBlock QT Peek] Quoted post was deleted (viewNotFound)');
    return null;
  }

  console.warn('[ErgoBlock QT Peek] Unknown embed type:', embedRecord.$type);
  return null;
}
```

**Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 4: Commit**

```bash
git add src/qt-peek.ts
git commit -m "feat: add quote embed resolution via public API for QT Peek

Add resolveQuoteEmbed() that fetches the parent post from the public API,
checks the embed view type, and extracts quoted post content. Handles
viewRecord (direct), viewBlocked/viewDetached (two-step fallback), and
viewNotFound (deleted, unresolvable).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
### Task 2: Replace executePeek Stub in content.tsx

**Files:**
- Modify: `src/content.tsx`

**Step 1: Update the import from qt-peek**

Update the qt-peek import (added in Phase 3) to also import `resolveQuoteEmbed` and `PeekedQuoteContent`:

```typescript
import {
  detectConcealedQuote,
  resolveQuoteEmbed,
  type ConcealedQuoteInfo,
  type PeekedQuoteContent,
} from './qt-peek.js';
```

**Step 2: Add extractParentPostUri helper function**

Add this function near the other utility functions in content.tsx (before `executePeek`):

```typescript
/**
 * Extract the parent post's AT URI from a post container.
 * Looks for /profile/{handle}/post/{rkey} links and converts to AT URI format.
 * Uses the same pattern as post-context.ts extractPostUri but adapted for
 * finding the parent post (not the quoted post).
 */
function extractParentPostUri(postContainer: HTMLElement): string | null {
  // Look for post links in the container
  const postLinks = postContainer.querySelectorAll('a[href*="/post/"]');

  for (const link of postLinks) {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (match) {
      const [, handle, rkey] = match;
      return `at://${handle}/app.bsky.feed.post/${rkey}`;
    }
  }

  // Fallback: check current URL if we're on a post page
  const urlMatch = window.location.href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
  if (urlMatch) {
    const [, handle, rkey] = urlMatch;
    return `at://${handle}/app.bsky.feed.post/${rkey}`;
  }

  return null;
}
```

**Step 3: Replace the executePeek stub**

Replace the stub `executePeek` function with the full implementation:

```typescript
/**
 * Execute the QT Peek flow:
 * 1. Extract parent post AT URI from DOM
 * 2. Fetch parent post from public API via background worker
 * 3. Resolve the concealed embed
 * 4. Replace the placeholder with peeked content (Phase 5)
 */
async function executePeek(
  postContainer: HTMLElement,
  concealedInfo: ConcealedQuoteInfo
): Promise<void> {
  // Step 1: Extract the parent post URI
  const parentUri = extractParentPostUri(postContainer);
  if (!parentUri) {
    showToast('Could not find post URI', true);
    return;
  }

  console.log('[ErgoBlock QT Peek] Peeking at quote in:', parentUri);

  // Show loading state on placeholder
  const originalText = concealedInfo.placeholderElement.textContent;
  concealedInfo.placeholderElement.textContent = 'Loading...';

  try {
    // Step 2-3: Resolve the concealed quote embed
    const peekedContent = await resolveQuoteEmbed(parentUri, concealedInfo.type);

    if (!peekedContent) {
      concealedInfo.placeholderElement.textContent = originalText || 'Could not peek at quote';
      showToast('Could not resolve quoted post', true);
      return;
    }

    // Step 4: Replace placeholder with peeked content (Phase 5 will use a Preact component)
    renderPeekedQuote(concealedInfo.placeholderElement, peekedContent);
  } catch (error) {
    // Restore original placeholder on error
    concealedInfo.placeholderElement.textContent = originalText || 'Error';
    throw error;
  }
}
```

**Step 4: Add renderPeekedQuote stub**

Add a stub for the render function (will be fully implemented in Phase 5):

```typescript
/**
 * Replace the concealed placeholder with peeked quote content.
 * Uses a Preact component in Shadow DOM for style isolation.
 *
 * Full implementation in Phase 5.
 */
function renderPeekedQuote(placeholderElement: HTMLElement, content: PeekedQuoteContent): void {
  // Temporary inline rendering until Phase 5 adds the proper Preact component
  const container = document.createElement('div');
  container.style.cssText =
    'padding: 12px; border: 1px dashed rgba(128,128,128,0.5); border-radius: 8px; font-size: 14px;';

  const authorLine = document.createElement('div');
  authorLine.style.cssText = 'font-weight: 600; margin-bottom: 4px; color: inherit;';
  authorLine.textContent = `${content.authorDisplayName || content.authorHandle} @${content.authorHandle}`;

  const textLine = document.createElement('div');
  textLine.style.cssText = 'white-space: pre-wrap; color: inherit;';
  textLine.textContent = content.text;

  const metaLine = document.createElement('div');
  metaLine.style.cssText =
    'font-size: 12px; color: rgba(128,128,128,0.8); margin-top: 8px;';
  metaLine.textContent = `Peeked via ErgoBlock · ${new Date(content.createdAt).toLocaleDateString()}`;

  container.appendChild(authorLine);
  container.appendChild(textLine);
  container.appendChild(metaLine);

  // Replace the placeholder
  const parent = placeholderElement.parentElement;
  if (parent) {
    parent.replaceChild(container, placeholderElement);
  }
}
```

**Step 5: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 6: Commit**

```bash
git add src/content.tsx src/qt-peek.ts
git commit -m "feat: implement full QT Peek execution flow

Replace executePeek stub with complete flow: extract parent post URI from DOM,
resolve concealed embed via public API (handleing viewRecord, viewBlocked,
viewDetached), and render peeked content inline. Temporary inline rendering
pending Phase 5 Preact component.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
### Task 3: Add Tests for Peek Resolution Logic

**Files:**
- Modify: `src/__tests__/qt-peek.test.ts`

**Step 1: Add tests for resolveQuoteEmbed**

Append the following test suite to the existing `src/__tests__/qt-peek.test.ts` file:

```typescript
import { resolveQuoteEmbed } from '../qt-peek';

// Mock browser.runtime.sendMessage
vi.mock('../browser.js', () => ({
  default: {
    runtime: {
      sendMessage: vi.fn(),
    },
    storage: {
      local: { get: vi.fn(), set: vi.fn() },
      sync: { get: vi.fn(), set: vi.fn() },
    },
  },
}));

describe('resolveQuoteEmbed', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should resolve viewRecord directly from parent post', async () => {
    const { default: browser } = await import('../browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Check this out',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          embed: {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewRecord',
              uri: 'at://did:plc:quoted/app.bsky.feed.post/quoted789',
              cid: 'bafyquoted',
              author: {
                did: 'did:plc:quoted',
                handle: 'quoted.bsky.social',
                displayName: 'Quoted User',
              },
              value: {
                $type: 'app.bsky.feed.post',
                text: 'This is the hidden quoted post!',
                createdAt: '2025-12-31T00:00:00.000Z',
              },
              indexedAt: '2025-12-31T00:00:00.000Z',
            },
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'blocked'
    );

    expect(result).not.toBeNull();
    expect(result!.text).toBe('This is the hidden quoted post!');
    expect(result!.authorHandle).toBe('quoted.bsky.social');
    expect(result!.authorDisplayName).toBe('Quoted User');
    expect(result!.concealmentType).toBe('blocked');
  });

  it('should do two-step fetch for viewBlocked embed', async () => {
    const { default: browser } = await import('../browser');
    const sendMessage = vi.mocked(browser.runtime.sendMessage);

    // First call: parent post with viewBlocked embed
    sendMessage.mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Look at this',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          embed: {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewBlocked',
              uri: 'at://did:plc:blocked/app.bsky.feed.post/blocked456',
              blocked: true,
              author: { did: 'did:plc:blocked' },
            },
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    // Second call: direct fetch of blocked post
    sendMessage.mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:blocked/app.bsky.feed.post/blocked456',
          cid: 'bafyblocked',
          author: {
            did: 'did:plc:blocked',
            handle: 'blocked.bsky.social',
            displayName: 'Blocked Person',
          },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'The blocked post content',
            createdAt: '2025-12-15T00:00:00.000Z',
          },
          indexedAt: '2025-12-15T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'blocked'
    );

    expect(result).not.toBeNull();
    expect(result!.text).toBe('The blocked post content');
    expect(result!.authorHandle).toBe('blocked.bsky.social');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('should do two-step fetch for viewDetached embed', async () => {
    const { default: browser } = await import('../browser');
    const sendMessage = vi.mocked(browser.runtime.sendMessage);

    sendMessage.mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Quoting this',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          embed: {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewDetached',
              uri: 'at://did:plc:detached/app.bsky.feed.post/detached789',
              detached: true,
            },
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    sendMessage.mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:detached/app.bsky.feed.post/detached789',
          cid: 'bafydetached',
          author: { did: 'did:plc:detached', handle: 'detached.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'The detached post content',
            createdAt: '2025-11-01T00:00:00.000Z',
          },
          indexedAt: '2025-11-01T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'detached'
    );

    expect(result).not.toBeNull();
    expect(result!.text).toBe('The detached post content');
    expect(result!.concealmentType).toBe('detached');
  });

  it('should return null for viewNotFound (deleted post)', async () => {
    const { default: browser } = await import('../browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Old quote',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          embed: {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewNotFound',
              uri: 'at://did:plc:gone/app.bsky.feed.post/gone000',
              notFound: true,
            },
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'not-found'
    );

    expect(result).toBeNull();
  });

  it('should return null when parent post has no embed', async () => {
    const { default: browser } = await import('../browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      posts: [
        {
          uri: 'at://did:plc:parent/app.bsky.feed.post/parent123',
          cid: 'bafyparent',
          author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'No embed here',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          indexedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:parent/app.bsky.feed.post/parent123',
      'blocked'
    );

    expect(result).toBeNull();
  });

  it('should return null when parent post not found', async () => {
    const { default: browser } = await import('../browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      posts: [],
    });

    const result = await resolveQuoteEmbed(
      'at://did:plc:missing/app.bsky.feed.post/missing123',
      'blocked'
    );

    expect(result).toBeNull();
  });

  it('should throw when background returns error', async () => {
    const { default: browser } = await import('../browser');
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      success: false,
      error: 'Network error',
    });

    await expect(
      resolveQuoteEmbed('at://did:plc:parent/app.bsky.feed.post/parent123', 'blocked')
    ).rejects.toThrow('Network error');
  });
});
```

**Step 2: Update imports at the top of the test file**

Add `resolveQuoteEmbed` to the imports and ensure `vi` is imported:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectConcealedQuote, resolveQuoteEmbed, type ConcealedQuoteInfo } from '../qt-peek';
```

**Step 3: Run tests**

Run: `npm test -- src/__tests__/qt-peek.test.ts`

Expected output: All tests pass

**Step 4: Commit**

```bash
git add src/__tests__/qt-peek.test.ts
git commit -m "test: add tests for QT Peek embed resolution flow

Test resolveQuoteEmbed with viewRecord (direct), viewBlocked (two-step),
viewDetached (two-step), viewNotFound (null), missing embed, missing
parent post, and background error scenarios.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_3 -->

---

## Phase 4 Complete

**Deliverables:**
- ✅ `resolveQuoteEmbed()` in qt-peek.ts with full resolution logic
- ✅ Handles viewRecord (direct), viewBlocked (two-step), viewDetached (two-step), viewNotFound (null)
- ✅ `executePeek()` in content.tsx replaces stub with full flow
- ✅ Loading state shown on placeholder during fetch
- ✅ Temporary inline rendering until Phase 5 component
- ✅ Comprehensive tests for all resolution paths
- ✅ TypeScript compilation succeeds

**Next Phase:** Phase 5 will create a proper Preact component (`PeekedQuote`) rendered in Shadow DOM for style-isolated inline replacement of the concealed placeholder.
