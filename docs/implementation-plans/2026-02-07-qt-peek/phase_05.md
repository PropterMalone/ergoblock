# QT Peek Implementation Plan - Phase 5

**Goal:** Create PeekedQuote Preact component rendered in Shadow DOM for style-isolated inline replacement of the concealed placeholder

**Architecture:** Create a Preact component `PeekedQuote` in `src/components/content/PeekedQuote.tsx` that renders the quoted post content (author, text, timestamp). Replace the temporary inline rendering from Phase 4 with Shadow DOM injection using the existing `createShadowContainer` pattern adapted for inline placement.

**Tech Stack:** TypeScript (strict mode), Preact

**Scope:** Phase 5 of 6 phases from design plan `docs/design-plans/2026-02-07-qt-peek.md`

**Codebase verified:** 2026-02-07

---

## Phase Overview

The Phase 4 temporary rendering used plain DOM elements. This phase replaces it with:

1. A `PeekedQuote` Preact component with self-contained CSS
2. Shadow DOM wrapping for style isolation from Bluesky's UI
3. Proper inline placement (replaces placeholder in-flow, not fixed-position)

The component shows:
- Author display name and handle
- Post text (with whitespace preservation)
- Timestamp
- A subtle "peeked via ErgoBlock" label and dashed border to distinguish from native embeds

---

<!-- START_TASK_1 -->
### Task 1: Create PeekedQuote Preact Component

**Files:**
- Create: `src/components/content/PeekedQuote.tsx`

**Step 1: Create the component**

```tsx
import type { PeekedQuoteContent } from '../../qt-peek.js';

interface PeekedQuoteProps {
  content: PeekedQuoteContent;
}

/**
 * Renders a peeked (revealed) quoted post inline.
 * Designed to be rendered inside a Shadow DOM for style isolation.
 */
export function PeekedQuote({ content }: PeekedQuoteProps) {
  const date = new Date(content.createdAt);
  const dateStr = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const concealLabel =
    content.concealmentType === 'blocked'
      ? 'blocked'
      : content.concealmentType === 'detached'
        ? 'detached'
        : content.concealmentType === 'not-found'
          ? 'deleted'
          : 'hidden';

  return (
    <div>
      <style>{`
        .peek-container {
          padding: 12px 16px;
          border: 1px dashed rgba(128, 128, 128, 0.4);
          border-radius: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          line-height: 1.4;
          color: inherit;
          background: transparent;
          max-width: 100%;
          box-sizing: border-box;
        }
        .peek-author {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin-bottom: 4px;
          flex-wrap: wrap;
        }
        .peek-author-name {
          font-weight: 600;
          color: inherit;
        }
        .peek-author-handle {
          color: rgba(128, 128, 128, 0.8);
          font-size: 13px;
        }
        .peek-text {
          white-space: pre-wrap;
          word-break: break-word;
          color: inherit;
          margin: 4px 0;
        }
        .peek-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          font-size: 12px;
          color: rgba(128, 128, 128, 0.7);
        }
        .peek-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(128, 128, 128, 0.1);
          font-size: 11px;
          color: rgba(128, 128, 128, 0.7);
        }
      `}</style>
      <div class="peek-container">
        <div class="peek-author">
          <span class="peek-author-name">
            {content.authorDisplayName || content.authorHandle}
          </span>
          <span class="peek-author-handle">@{content.authorHandle}</span>
        </div>
        <div class="peek-text">{content.text}</div>
        <div class="peek-meta">
          <span>{dateStr}</span>
          <span class="peek-badge">
            peeked · was {concealLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 3: Commit**

```bash
git add src/components/content/PeekedQuote.tsx
git commit -m "feat: add PeekedQuote Preact component for QT Peek

Create component that renders revealed quoted post content with author,
text, timestamp, and concealment badge. Uses self-contained CSS for
Shadow DOM isolation.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
### Task 2: Replace Temporary Rendering with Shadow DOM + PeekedQuote Component

**Files:**
- Modify: `src/content.tsx`

**Step 1: Add PeekedQuote import**

Add the import at the top of `src/content.tsx` alongside other component imports (around line 24-27):

```typescript
import { PeekedQuote } from './components/content/PeekedQuote.js';
```

**Step 2: Replace renderPeekedQuote implementation**

Replace the temporary `renderPeekedQuote` function (from Phase 4) with the Shadow DOM version:

```typescript
/**
 * Replace the concealed placeholder with peeked quote content.
 * Renders a PeekedQuote Preact component inside a Shadow DOM for style isolation.
 *
 * Unlike createShadowContainer (which creates fixed-position overlays), this creates
 * an inline Shadow DOM host that replaces the placeholder in the document flow.
 */
function renderPeekedQuote(placeholderElement: HTMLElement, content: PeekedQuoteContent): void {
  // Create an inline Shadow DOM host (not fixed-position like overlays)
  const host = document.createElement('div');
  host.setAttribute('data-ergoblock-peeked-quote', 'true');
  host.style.cssText = 'display: block; width: 100%;';
  const shadow = host.attachShadow({ mode: 'closed' });

  // Create render container inside shadow
  const container = document.createElement('div');
  shadow.appendChild(container);

  // Render the Preact component
  render(<PeekedQuote content={content} />, container);

  // Replace the placeholder element with our shadow host
  const parent = placeholderElement.parentElement;
  if (parent) {
    parent.replaceChild(host, placeholderElement);
  }
}
```

**Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 4: Verify build**

Run: `npm run build`

Expected output: Build succeeds

**Step 5: Commit**

```bash
git add src/content.tsx
git commit -m "feat: render peeked quotes with Shadow DOM for style isolation

Replace temporary inline rendering with PeekedQuote Preact component
rendered inside a closed Shadow DOM. Uses inline placement (not fixed
position) to replace the placeholder in document flow.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

---

## Phase 5 Complete

**Deliverables:**
- ✅ `PeekedQuote` Preact component with self-contained CSS
- ✅ Shadow DOM wrapping for style isolation from Bluesky's UI
- ✅ Inline placement replacing the concealed placeholder in document flow
- ✅ Shows author, text, timestamp, and concealment badge
- ✅ Dashed border visual indicator to distinguish from native embeds
- ✅ Build succeeds

**Next Phase:** Phase 6 will add an enable/disable option in the settings page, handle edge cases (network errors, rate limiting, missing URIs), and ensure graceful degradation.
