# QT Peek Implementation Plan - Phase 2

**Goal:** Add concealed quote detection — detect whether a post container contains a blocked/detached quote embed placeholder

**Architecture:** Create a utility module `src/qt-peek.ts` with detection functions that examine DOM elements for concealed quote placeholders. Uses multiple signals (text content, structural patterns, absence of post links) for resilience against Bluesky UI changes.

**Tech Stack:** TypeScript (strict mode)

**Scope:** Phase 2 of 6 phases from design plan `docs/design-plans/2026-02-07-qt-peek.md`

**Codebase verified:** 2026-02-07

---

## Phase Overview

Bluesky renders concealed quote embeds as placeholder elements with text like "Blocked post", "Post not found", or "Post has been detached". Normal quote embeds contain a clickable link to `/profile/{handle}/post/{rkey}`. This phase adds detection logic that:

1. Finds the quote embed area within a post container
2. Checks for placeholder text patterns
3. Confirms the absence of a clickable post link (which normal embeds have)
4. Returns a reference to the placeholder element for later replacement

---

<!-- START_TASK_1 -->
### Task 1: Create qt-peek.ts Module with Detection Functions

**Files:**
- Create: `src/qt-peek.ts`

**Step 1: Create the qt-peek module**

Create `src/qt-peek.ts` with the following content:

```typescript
/**
 * QT Peek — utility module for detecting and resolving concealed quote embeds
 *
 * Bluesky hides quoted posts when:
 * - The quoted author has blocked the viewer (viewBlocked)
 * - The quoted author has detached the quote (viewDetached)
 * - The quoted post was deleted (viewNotFound)
 *
 * This module detects these concealed placeholders in the DOM and provides
 * functions to resolve them via the public API.
 */

/**
 * Result of scanning a post container for concealed quote embeds
 */
export interface ConcealedQuoteInfo {
  /** The placeholder element in the DOM (for replacement) */
  placeholderElement: HTMLElement;
  /** Type of concealment detected from placeholder text */
  type: 'blocked' | 'detached' | 'not-found' | 'unknown';
}

/**
 * Placeholder text patterns that indicate a concealed quote embed.
 * Uses lowercase matching. Multiple patterns per type for resilience
 * against Bluesky wording changes.
 */
const CONCEALED_PATTERNS: Array<{ pattern: string; type: ConcealedQuoteInfo['type'] }> = [
  { pattern: 'blocked post', type: 'blocked' },
  { pattern: 'blocked', type: 'blocked' },
  { pattern: 'post has been detached', type: 'detached' },
  { pattern: 'detached', type: 'detached' },
  { pattern: 'post not found', type: 'not-found' },
  { pattern: 'not found', type: 'not-found' },
];

/**
 * Detect whether a post container contains a concealed quote embed.
 *
 * Detection strategy:
 * 1. Find elements that look like quote embed containers (border + padding pattern)
 * 2. Check if text content matches known placeholder patterns
 * 3. Confirm there is NO clickable /post/ link inside (normal quotes have one)
 *
 * @param postContainer - The post's DOM element (e.g., feedItem, postThreadItem)
 * @returns ConcealedQuoteInfo if a concealed quote is found, null otherwise
 */
export function detectConcealedQuote(postContainer: HTMLElement): ConcealedQuoteInfo | null {
  // Strategy 1: Look for elements with concealment text inside the post
  // These are typically divs with border styling that contain short placeholder text
  const allElements = postContainer.querySelectorAll('*');

  for (const el of allElements) {
    const htmlEl = el as HTMLElement;
    const text = htmlEl.textContent?.trim().toLowerCase() || '';

    // Skip elements that are too long (real post content, not placeholders)
    if (text.length > 100) continue;

    // Skip elements that are too short (single words that might be part of regular text)
    if (text.length < 5) continue;

    // Check against known placeholder patterns
    for (const { pattern, type } of CONCEALED_PATTERNS) {
      if (text.includes(pattern)) {
        // Verify this looks like a quote embed container (not just text mentioning "blocked")
        if (isQuoteEmbedContainer(htmlEl, postContainer)) {
          return { placeholderElement: htmlEl, type };
        }
      }
    }
  }

  return null;
}

/**
 * Check if an element looks like a quote embed container rather than regular post text.
 *
 * Quote embed containers typically:
 * - Have border styling (border or borderRadius)
 * - Do NOT contain a link to /profile/.../post/... (concealed embeds lack this)
 * - Are not the post's main text content
 * - Are a relatively small, self-contained element
 *
 * @param element - The element with placeholder text
 * @param postContainer - The parent post container
 */
function isQuoteEmbedContainer(element: HTMLElement, postContainer: HTMLElement): boolean {
  // Walk up from the element to find the actual embed container
  // (the text might be in a nested span/div)
  let candidate: HTMLElement | null = element;
  let embedContainer: HTMLElement | null = null;

  for (let i = 0; i < 5 && candidate && candidate !== postContainer; i++) {
    const style = window.getComputedStyle(candidate);

    // Look for border or borderRadius — typical of quote embed containers
    const hasBorder =
      (style.borderWidth && style.borderWidth !== '0px' && style.borderStyle !== 'none') ||
      (style.borderTopWidth && style.borderTopWidth !== '0px') ||
      (style.borderRadius && style.borderRadius !== '0px');

    if (hasBorder) {
      embedContainer = candidate;
      break;
    }

    candidate = candidate.parentElement;
  }

  // If no bordered container found, check if element itself is the container
  if (!embedContainer) {
    embedContainer = element;
  }

  // Key signal: concealed embeds do NOT have a post link inside
  const hasPostLink = embedContainer.querySelector('a[href*="/post/"]');
  if (hasPostLink) {
    // This is a normal (visible) quote embed, not concealed
    return false;
  }

  // Additional signal: the embed container should be distinct from the post's main text
  const postTextEl = postContainer.querySelector('[data-testid*="postText"]');
  if (postTextEl && postTextEl.contains(embedContainer)) {
    // The "placeholder" text is inside the post's text content, not a separate embed
    return false;
  }

  return true;
}
```

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 3: Commit**

```bash
git add src/qt-peek.ts
git commit -m "feat: add concealed quote embed detection for QT Peek

Create qt-peek.ts with detectConcealedQuote() that scans post containers
for blocked/detached/not-found quote placeholders using text matching and
structural analysis (border styling, absence of post links).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
### Task 2: Add Tests for Concealed Quote Detection

**Files:**
- Create: `src/__tests__/qt-peek.test.ts`

**Step 1: Write tests with mock DOM elements**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectConcealedQuote, type ConcealedQuoteInfo } from '../qt-peek';

/**
 * Helper to create a mock post container with a concealed quote embed
 */
function createPostWithConcealedQuote(placeholderText: string): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-testid', 'feedItem-abc');

  // Post author area
  const authorLink = document.createElement('a');
  authorLink.href = '/profile/parent.bsky.social';
  container.appendChild(authorLink);

  // Post text
  const postText = document.createElement('div');
  postText.setAttribute('data-testid', 'postText');
  postText.textContent = 'Check out this quote:';
  container.appendChild(postText);

  // Post link (to the parent post itself)
  const postLink = document.createElement('a');
  postLink.href = '/profile/parent.bsky.social/post/abc123';
  container.appendChild(postLink);

  // Quote embed container (concealed — has border but NO /post/ link inside)
  const embedContainer = document.createElement('div');
  embedContainer.style.borderWidth = '1px';
  embedContainer.style.borderStyle = 'solid';
  embedContainer.style.borderRadius = '8px';
  embedContainer.style.padding = '12px';

  const placeholderEl = document.createElement('div');
  placeholderEl.textContent = placeholderText;
  embedContainer.appendChild(placeholderEl);

  container.appendChild(embedContainer);

  return container;
}

/**
 * Helper to create a post with a normal (visible) quote embed
 */
function createPostWithNormalQuote(): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-testid', 'feedItem-abc');

  // Post text
  const postText = document.createElement('div');
  postText.setAttribute('data-testid', 'postText');
  postText.textContent = 'Look at this:';
  container.appendChild(postText);

  // Post link (to parent post)
  const postLink = document.createElement('a');
  postLink.href = '/profile/parent.bsky.social/post/abc123';
  container.appendChild(postLink);

  // Quote embed container (normal — has a post link inside)
  const embedContainer = document.createElement('div');
  embedContainer.style.borderWidth = '1px';
  embedContainer.style.borderStyle = 'solid';
  embedContainer.style.borderRadius = '8px';

  const quotedPostLink = document.createElement('a');
  quotedPostLink.href = '/profile/quoted.bsky.social/post/xyz789';
  quotedPostLink.textContent = 'Quoted post content here...';
  embedContainer.appendChild(quotedPostLink);

  container.appendChild(embedContainer);

  return container;
}

/**
 * Helper to create a post with no quote embed at all
 */
function createPostWithoutQuote(): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-testid', 'feedItem-abc');

  const postText = document.createElement('div');
  postText.setAttribute('data-testid', 'postText');
  postText.textContent = 'Just a regular post with no quote embed.';
  container.appendChild(postText);

  return container;
}

describe('detectConcealedQuote', () => {
  // Mock window.getComputedStyle since jsdom/happy-dom may not compute styles from inline
  let originalGetComputedStyle: typeof window.getComputedStyle;

  beforeEach(() => {
    originalGetComputedStyle = window.getComputedStyle;
    // Override getComputedStyle to return inline styles
    window.getComputedStyle = vi.fn((el: Element) => {
      const htmlEl = el as HTMLElement;
      return {
        borderWidth: htmlEl.style.borderWidth || '0px',
        borderTopWidth: htmlEl.style.borderTopWidth || '0px',
        borderStyle: htmlEl.style.borderStyle || 'none',
        borderRadius: htmlEl.style.borderRadius || '0px',
      } as CSSStyleDeclaration;
    });
  });

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
  });

  it('should detect blocked post placeholder', () => {
    const container = createPostWithConcealedQuote('Blocked post');
    const result = detectConcealedQuote(container);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('blocked');
    expect(result!.placeholderElement).toBeInstanceOf(HTMLElement);
  });

  it('should detect detached post placeholder', () => {
    const container = createPostWithConcealedQuote('Post has been detached');
    const result = detectConcealedQuote(container);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('detached');
  });

  it('should detect not-found post placeholder', () => {
    const container = createPostWithConcealedQuote('Post not found');
    const result = detectConcealedQuote(container);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('not-found');
  });

  it('should return null for normal quote embed (has post link)', () => {
    const container = createPostWithNormalQuote();
    const result = detectConcealedQuote(container);

    expect(result).toBeNull();
  });

  it('should return null for post without any quote embed', () => {
    const container = createPostWithoutQuote();
    const result = detectConcealedQuote(container);

    expect(result).toBeNull();
  });

  it('should be case-insensitive', () => {
    const container = createPostWithConcealedQuote('BLOCKED POST');
    const result = detectConcealedQuote(container);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('blocked');
  });

  it('should not match very long text (regular post content)', () => {
    // Create a post where the post text itself contains "blocked" but isn't a placeholder
    const container = document.createElement('div');
    container.setAttribute('data-testid', 'feedItem-abc');

    const postText = document.createElement('div');
    postText.setAttribute('data-testid', 'postText');
    postText.textContent =
      'I saw a blocked post the other day and it was really frustrating because I wanted to see what it said but could not.';
    container.appendChild(postText);

    const result = detectConcealedQuote(container);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `npm test -- src/__tests__/qt-peek.test.ts`

Expected output: All tests pass

**Step 3: Commit**

```bash
git add src/__tests__/qt-peek.test.ts
git commit -m "test: add tests for concealed quote detection

Test detectConcealedQuote with blocked, detached, and not-found placeholders,
normal quote embeds (should not detect), posts without quotes, case
insensitivity, and rejection of long text content.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

---

## Phase 2 Complete

**Deliverables:**
- ✅ `src/qt-peek.ts` with `detectConcealedQuote()` function
- ✅ Multi-signal detection (text patterns, border styling, absence of post links)
- ✅ Returns placeholder element reference and concealment type
- ✅ Tests covering blocked, detached, not-found, normal quotes, and edge cases
- ✅ TypeScript compilation succeeds

**Next Phase:** Phase 3 will inject the "Peek at quote" menu item into Bluesky's dropdown menus when a concealed quote is detected.
