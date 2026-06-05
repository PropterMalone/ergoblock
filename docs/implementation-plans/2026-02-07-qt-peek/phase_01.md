# QT Peek Implementation Plan - Phase 1

**Goal:** Add getPosts API wrapper and background message handler for fetching posts via the public API

**Architecture:** Extend existing `api.ts` with a `getPostsPublic()` function that calls `app.bsky.feed.getPosts` on `public.api.bsky.app` without auth headers. Add corresponding message type to `background.ts` so the content script can request post fetches via messaging (required for CORS).

**Tech Stack:** TypeScript (strict mode)

**Scope:** Phase 1 of 6 phases from design plan `docs/design-plans/2026-02-07-qt-peek.md`

**Codebase verified:** 2026-02-07

---

## Phase Overview

This phase creates the data fetching layer. The content script cannot call `public.api.bsky.app` directly due to CORS restrictions, so we route through the background service worker using the established messaging pattern. We add:

1. TypeScript types for the `getPosts` response and embed view types
2. A `getPostsPublic()` function in `api.ts`
3. A `FETCH_POSTS_PUBLIC` message handler in `background.ts`

---

<!-- START_TASK_1 -->
### Task 1: Add Embed View Types to types.ts

**Files:**
- Modify: `src/types.ts` (append after line 778, after `RepostFilteredUser` interface)

**Step 1: Add embed view types and GetPostsResponse**

Open `src/types.ts` and append the following types after the `RepostFilteredUser` interface (end of file, around line 778):

```typescript
// ============================================================================
// QT Peek Types (getPosts response and embed views)
// ============================================================================

/**
 * Post view from app.bsky.feed.getPosts
 * Contains full post data including embeds
 */
export interface PostView {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  record: {
    $type: 'app.bsky.feed.post';
    text: string;
    createdAt: string;
    reply?: { parent: { uri: string }; root?: { uri: string } };
    embed?: PostRecordEmbed;
  };
  embed?: PostViewEmbed;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  indexedAt: string;
}

/**
 * Embed in the post record (what the author wrote)
 */
export interface PostRecordEmbed {
  $type: string;
  record?: {
    uri: string;
    cid: string;
  };
}

/**
 * Resolved embed view in the post response (what the API returns)
 * The $type discriminates between different embed states
 */
export type PostViewEmbed =
  | PostViewEmbedRecord
  | PostViewEmbedRecordWithMedia
  | PostViewEmbedImages
  | PostViewEmbedExternal
  | PostViewEmbedUnknown;

export interface PostViewEmbedRecord {
  $type: 'app.bsky.embed.record#view';
  record: EmbedRecordView;
}

export interface PostViewEmbedRecordWithMedia {
  $type: 'app.bsky.embed.recordWithMedia#view';
  record: { record: EmbedRecordView };
  media: unknown;
}

export interface PostViewEmbedImages {
  $type: 'app.bsky.embed.images#view';
  images: unknown[];
}

export interface PostViewEmbedExternal {
  $type: 'app.bsky.embed.external#view';
  external: unknown;
}

export interface PostViewEmbedUnknown {
  $type: string;
  [key: string]: unknown;
}

/**
 * Discriminated union for embed record view states
 * The $type field indicates whether the quoted post is visible, blocked, detached, or deleted
 */
export type EmbedRecordView =
  | EmbedRecordViewRecord
  | EmbedRecordViewBlocked
  | EmbedRecordViewDetached
  | EmbedRecordViewNotFound;

export interface EmbedRecordViewRecord {
  $type: 'app.bsky.embed.record#viewRecord';
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  value: {
    $type: 'app.bsky.feed.post';
    text: string;
    createdAt: string;
  };
  indexedAt: string;
}

export interface EmbedRecordViewBlocked {
  $type: 'app.bsky.embed.record#viewBlocked';
  uri: string;
  blocked: boolean;
  author: { did: string };
}

export interface EmbedRecordViewDetached {
  $type: 'app.bsky.embed.record#viewDetached';
  uri: string;
  detached: boolean;
}

export interface EmbedRecordViewNotFound {
  $type: 'app.bsky.embed.record#viewNotFound';
  uri: string;
  notFound: boolean;
}

/**
 * Response from app.bsky.feed.getPosts
 */
export interface GetPostsResponse {
  posts: PostView[];
}
```

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add QT Peek types for getPosts response and embed views

Add PostView, EmbedRecordView discriminated union (viewRecord, viewBlocked,
viewDetached, viewNotFound), and GetPostsResponse types for the QT Peek feature.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
### Task 2: Add getPostsPublic() Function to api.ts

**Files:**
- Modify: `src/api.ts` (add new function and import the type)

**Step 1: Import GetPostsResponse type**

At the top of `src/api.ts`, add `GetPostsResponse` to the existing import from `./types.js` (line 1-24):

Find the existing import block and add `GetPostsResponse` to it:

```typescript
import {
  // ... existing imports ...
  GetActorLikesResponse,
  GetPostsResponse,
} from './types.js';
```

**Step 2: Add getPostsPublic function**

Append the following function at the end of `src/api.ts` (after `getActorLikes`, around line 1025):

```typescript
/**
 * Fetch posts by URI from the public API (no authentication)
 * Used by QT Peek to retrieve concealed (blocked/detached) quoted posts.
 * Calls public.api.bsky.app directly without auth headers so block-based
 * content hiding is not enforced.
 *
 * @param uris - Array of AT Protocol post URIs (max 25)
 * @returns Array of PostView objects
 */
export async function getPostsPublic(uris: string[]): Promise<GetPostsResponse> {
  if (uris.length === 0) return { posts: [] };
  if (uris.length > 25) {
    throw new Error('getPostsPublic supports max 25 URIs at once');
  }

  const params = uris.map((u) => `uris=${encodeURIComponent(u)}`).join('&');
  const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.feed.getPosts?${params}`;

  console.log('[ErgoBlock] Public API getPosts:', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    // No Authorization header - this is intentional for public API access
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(error.message || `Public API error: ${response.status}`);
  }

  const data = (await response.json()) as GetPostsResponse;
  return data;
}
```

**Note:** This function deliberately does NOT use `executeApiRequest` because that always adds an `Authorization` header. The public API must be called without auth to bypass viewer-specific block enforcement.

**Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 4: Commit**

```bash
git add src/api.ts
git commit -m "feat: add getPostsPublic() for unauthenticated post fetching

Add function that calls app.bsky.feed.getPosts on public.api.bsky.app
without auth headers. Used by QT Peek to retrieve blocked/detached
quoted posts that are hidden from authenticated views.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
### Task 3: Add FETCH_POSTS_PUBLIC Message Handler to background.ts

**Files:**
- Modify: `src/background.ts` (add message handler and import)

**Step 1: Import GetPostsResponse type**

At the top of `src/background.ts`, add `GetPostsResponse` and `PostView` to the existing types import (around line 39-62):

```typescript
import {
  // ... existing imports ...
  Interaction,
  GetPostsResponse,
  PostView,
} from './types.js';
```

**Step 2: Add the handleFetchPostsPublic function**

Add the following function before the `messageHandler` function (before line 2181):

```typescript
/**
 * Handle request to fetch posts from the public API (no auth)
 * Used by QT Peek in content script to bypass CORS restrictions
 */
async function handleFetchPostsPublic(
  uris: string[]
): Promise<{ success: boolean; posts?: PostView[]; error?: string }> {
  try {
    if (!uris || uris.length === 0) {
      return { success: false, error: 'No URIs provided' };
    }

    if (uris.length > 25) {
      return { success: false, error: 'Max 25 URIs per request' };
    }

    const params = uris.map((u) => `uris=${encodeURIComponent(u)}`).join('&');
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params}`;

    console.log('[ErgoBlock BG] Public API getPosts:', uris.length, 'URIs');

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      // No auth header - intentional for public API
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(error.message || `Public API error: ${response.status}`);
    }

    const data = (await response.json()) as GetPostsResponse;
    return { success: true, posts: data.posts };
  } catch (error) {
    console.error('[ErgoBlock BG] Public getPosts failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
```

**Step 3: Add message type to ExtensionMessage interface**

Update the `ExtensionMessage` interface (around line 1628) to add the `uris` field:

```typescript
interface ExtensionMessage {
  type: string;
  auth?: AuthData;
  did?: string;
  handle?: string;
  listUri?: string;
  uris?: string[]; // For FETCH_POSTS_PUBLIC
}
```

**Step 4: Add message handler case**

In the `messageHandler` function (around line 2258, before the final `return undefined`), add:

```typescript
  if (message.type === 'FETCH_POSTS_PUBLIC' && message.uris) {
    return await handleFetchPostsPublic(message.uris);
  }
```

**Step 5: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 6: Commit**

```bash
git add src/background.ts
git commit -m "feat: add FETCH_POSTS_PUBLIC message handler for QT Peek

Route public API getPosts calls through background worker to avoid CORS
restrictions in content script. Fetches posts without auth headers to
bypass viewer-specific block enforcement.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_3 -->

---

<!-- START_TASK_4 -->
### Task 4: Add Tests for getPostsPublic and Types

**Files:**
- Create: `src/__tests__/qt-peek-api.test.ts`

**Step 1: Write tests for the new API function and types**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  PostView,
  GetPostsResponse,
  EmbedRecordView,
  EmbedRecordViewRecord,
  EmbedRecordViewBlocked,
  EmbedRecordViewDetached,
  EmbedRecordViewNotFound,
  PostViewEmbedRecord,
} from '../types';

describe('QT Peek Types', () => {
  describe('EmbedRecordView discriminated union', () => {
    it('should type-check viewRecord', () => {
      const view: EmbedRecordViewRecord = {
        $type: 'app.bsky.embed.record#viewRecord',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        cid: 'bafyabc',
        author: { did: 'did:plc:abc', handle: 'user.bsky.social' },
        value: {
          $type: 'app.bsky.feed.post',
          text: 'Hello world',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        indexedAt: '2026-01-01T00:00:00.000Z',
      };
      expect(view.$type).toBe('app.bsky.embed.record#viewRecord');
      expect(view.value.text).toBe('Hello world');
    });

    it('should type-check viewBlocked', () => {
      const view: EmbedRecordViewBlocked = {
        $type: 'app.bsky.embed.record#viewBlocked',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        blocked: true,
        author: { did: 'did:plc:abc' },
      };
      expect(view.$type).toBe('app.bsky.embed.record#viewBlocked');
      expect(view.blocked).toBe(true);
    });

    it('should type-check viewDetached', () => {
      const view: EmbedRecordViewDetached = {
        $type: 'app.bsky.embed.record#viewDetached',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        detached: true,
      };
      expect(view.$type).toBe('app.bsky.embed.record#viewDetached');
    });

    it('should type-check viewNotFound', () => {
      const view: EmbedRecordViewNotFound = {
        $type: 'app.bsky.embed.record#viewNotFound',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        notFound: true,
      };
      expect(view.$type).toBe('app.bsky.embed.record#viewNotFound');
    });

    it('should discriminate union by $type', () => {
      const view: EmbedRecordView = {
        $type: 'app.bsky.embed.record#viewRecord',
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        cid: 'bafyabc',
        author: { did: 'did:plc:abc', handle: 'user.bsky.social' },
        value: {
          $type: 'app.bsky.feed.post',
          text: 'Test',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        indexedAt: '2026-01-01T00:00:00.000Z',
      };

      if (view.$type === 'app.bsky.embed.record#viewRecord') {
        expect(view.value.text).toBe('Test');
      }
    });
  });

  describe('PostView with embed', () => {
    it('should accept a post with a record embed', () => {
      const post: PostView = {
        uri: 'at://did:plc:parent/app.bsky.feed.post/456',
        cid: 'bafyparent',
        author: { did: 'did:plc:parent', handle: 'parent.bsky.social' },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'Check this out',
          createdAt: '2026-01-01T00:00:00.000Z',
          embed: {
            $type: 'app.bsky.embed.record',
            record: {
              uri: 'at://did:plc:quoted/app.bsky.feed.post/789',
              cid: 'bafyquoted',
            },
          },
        },
        embed: {
          $type: 'app.bsky.embed.record#view',
          record: {
            $type: 'app.bsky.embed.record#viewBlocked',
            uri: 'at://did:plc:quoted/app.bsky.feed.post/789',
            blocked: true,
            author: { did: 'did:plc:quoted' },
          },
        },
        indexedAt: '2026-01-01T00:00:00.000Z',
      };

      expect(post.embed?.$type).toBe('app.bsky.embed.record#view');
      const embedRecord = post.embed as PostViewEmbedRecord;
      expect(embedRecord.record.$type).toBe('app.bsky.embed.record#viewBlocked');
    });
  });

  describe('GetPostsResponse', () => {
    it('should accept empty posts array', () => {
      const response: GetPostsResponse = { posts: [] };
      expect(response.posts).toHaveLength(0);
    });

    it('should accept posts array with PostView objects', () => {
      const response: GetPostsResponse = {
        posts: [
          {
            uri: 'at://did:plc:test/app.bsky.feed.post/123',
            cid: 'bafytest',
            author: { did: 'did:plc:test', handle: 'test.bsky.social' },
            record: {
              $type: 'app.bsky.feed.post',
              text: 'Test post',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            indexedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
      expect(response.posts).toHaveLength(1);
    });
  });
});

describe('getPostsPublic', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty array for empty input', async () => {
    const { getPostsPublic } = await import('../api');
    const result = await getPostsPublic([]);
    expect(result.posts).toHaveLength(0);
  });

  it('should throw for more than 25 URIs', async () => {
    const { getPostsPublic } = await import('../api');
    const uris = Array.from({ length: 26 }, (_, i) => `at://did:plc:test/app.bsky.feed.post/${i}`);
    await expect(getPostsPublic(uris)).rejects.toThrow('max 25');
  });

  it('should call public API without auth header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ posts: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getPostsPublic } = await import('../api');
    await getPostsPublic(['at://did:plc:test/app.bsky.feed.post/123']);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('public.api.bsky.app');
    expect(url).toContain('app.bsky.feed.getPosts');
    // Verify no Authorization header
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('should throw on API error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'Bad Request' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getPostsPublic } = await import('../api');
    await expect(
      getPostsPublic(['at://did:plc:test/app.bsky.feed.post/123'])
    ).rejects.toThrow('Bad Request');
  });
});
```

**Step 2: Run tests**

Run: `npm test -- src/__tests__/qt-peek-api.test.ts`

Expected output: All tests pass

**Step 3: Commit**

```bash
git add src/__tests__/qt-peek-api.test.ts
git commit -m "test: add tests for QT Peek API types and getPostsPublic

Verify embed view discriminated union types, PostView with embeds,
GetPostsResponse, and getPostsPublic function behavior including
empty input, max URI limit, public API URL, and error handling.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_4 -->

---

## Phase 1 Complete

**Deliverables:**
- ✅ TypeScript types for PostView, EmbedRecordView union, GetPostsResponse
- ✅ `getPostsPublic()` function in api.ts (no auth headers, uses public API)
- ✅ `FETCH_POSTS_PUBLIC` message handler in background.ts (CORS bypass for content script)
- ✅ Tests for types and API function
- ✅ TypeScript compilation succeeds

**Next Phase:** Phase 2 will add concealed quote detection — a utility function that detects whether a post container in the DOM contains a blocked/detached quote embed placeholder.
