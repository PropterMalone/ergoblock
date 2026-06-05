# QT Peek Implementation Plan - Phase 3

**Goal:** Inject "Peek at quote" menu item into Bluesky's dropdown menus when a concealed quote embed is detected

**Architecture:** Extend the existing `injectMenuItems()` flow in `content.tsx` to detect concealed quotes via Phase 2's `detectConcealedQuote()`, then inject an additional menu item using the established clone-and-modify pattern. Wire up the click handler to trigger the peek flow (Phase 4).

**Tech Stack:** TypeScript (strict mode), Preact

**Scope:** Phase 3 of 6 phases from design plan `docs/design-plans/2026-02-07-qt-peek.md`

**Codebase verified:** 2026-02-07

---

## Phase Overview

This phase connects the detection logic (Phase 2) to the UI by injecting a "Peek at quote" menu item. The injection follows the same pattern as the existing "Disable Reposts" option (`injectRepostFilterOption`):

1. After normal menu injection, check if the post has a concealed quote
2. Clone an existing menu item for style matching
3. Update the text and wire up the click handler
4. Insert into the menu

The click handler will store the necessary context (post container, placeholder element) and trigger the peek flow implemented in Phase 4.

---

<!-- START_TASK_1 -->
### Task 1: Add Peek at Quote Menu Injection to content.tsx

**Files:**
- Modify: `src/content.tsx`

**Step 1: Add imports**

At the top of `src/content.tsx`, add the import for `detectConcealedQuote` from the qt-peek module. Find the existing import block (around lines 17-27) and add:

```typescript
import { detectConcealedQuote, type ConcealedQuoteInfo } from './qt-peek.js';
```

**Step 2: Add module-level state for peek context**

After the existing module-level state variables (around line 84, after `capturedNotificationInfo`), add:

```typescript
// QT Peek tracking
let pendingPeekContext: {
  postContainer: HTMLElement;
  concealedInfo: ConcealedQuoteInfo;
} | null = null;
```

**Step 3: Add the injectPeekOption function**

Add the following function after `injectRepostFilterOption` (around line 849, before the notification menu code):

```typescript
/**
 * Inject "Peek at quote" option into post menus when a concealed quote embed is detected.
 * Follows the same clone-and-modify pattern as injectRepostFilterOption.
 */
function injectPeekOption(menu: Element): void {
  // Don't inject if already present
  if (menu.querySelector('[data-ergoblock-peek-quote]')) return;

  // Find the post container from the menu context
  // Use lastClickedPostContainer (set on click) or walk up from lastClickedElement
  const postContainer =
    lastClickedPostContainer ||
    (lastClickedElement ? findPostContainer(lastClickedElement) : null);

  if (!postContainer) return;

  // Check if this post has a concealed quote embed
  const concealedInfo = detectConcealedQuote(postContainer);
  if (!concealedInfo) return;

  // Find an existing menu item to clone for style matching
  const existingMenuItem = menu.querySelector(CONFIG.SELECTORS.MENU_ITEM);
  if (!existingMenuItem) return;

  // Deep clone to preserve inner structure and styling
  const peekMenuItem = existingMenuItem.cloneNode(true) as HTMLElement;
  peekMenuItem.setAttribute('role', 'menuitem');
  peekMenuItem.setAttribute('data-ergoblock-peek-quote', 'true');
  peekMenuItem.setAttribute('tabindex', '0');

  // Update the text content
  const textLabel = 'Peek at quote';

  const updateText = (el: Element): boolean => {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        child.textContent = textLabel;
        return true;
      }
    }
    for (const child of el.children) {
      if (updateText(child)) return true;
    }
    return false;
  };

  if (!updateText(peekMenuItem)) {
    peekMenuItem.textContent = textLabel;
  }

  // Remove any SVG icons from the clone
  const svg = peekMenuItem.querySelector('svg');
  if (svg) {
    svg.remove();
  }

  // Handle click — store context and trigger peek flow
  peekMenuItem.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    pendingPeekContext = { postContainer, concealedInfo };
    closeMenus();

    // Trigger the peek flow (implemented in Phase 4)
    try {
      await executePeek(postContainer, concealedInfo);
    } catch (error) {
      console.error('[ErgoBlock] Peek failed:', error);
      showToast('Failed to peek at quote', true);
    } finally {
      pendingPeekContext = null;
    }
  });

  // Append at the end of the menu
  const menuContainer = menu.querySelector(CONFIG.SELECTORS.MENU) || menu;
  menuContainer.appendChild(peekMenuItem);
}
```

**Step 4: Add stub executePeek function**

Add a stub for the peek execution (will be fully implemented in Phase 4). Place it right after `injectPeekOption`:

```typescript
/**
 * Execute the QT Peek flow:
 * 1. Extract parent post AT URI from DOM
 * 2. Fetch parent post from public API via background worker
 * 3. Resolve the concealed embed
 * 4. Replace the placeholder with peeked content
 *
 * Full implementation in Phase 4.
 */
async function executePeek(
  _postContainer: HTMLElement,
  _concealedInfo: ConcealedQuoteInfo
): Promise<void> {
  // Stub — will be implemented in Phase 4
  showToast('QT Peek coming soon...');
}
```

**Step 5: Wire injectPeekOption into injectMenuItems**

In the existing `injectMenuItems` function (around line 719, after the `injectRepostFilterOption(menu, handle);` call), add:

```typescript
  // Try to inject QT Peek option (only if post has a concealed quote embed)
  injectPeekOption(menu);
```

The end of `injectMenuItems` should now look like:

```typescript
  // Try to inject repost filter option (only on profile menus for followed users)
  injectRepostFilterOption(menu, handle);

  // Try to inject QT Peek option (only if post has a concealed quote embed)
  injectPeekOption(menu);
}
```

**Step 6: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 7: Commit**

```bash
git add src/content.tsx
git commit -m "feat: inject 'Peek at quote' menu item for concealed quote embeds

Add injectPeekOption() that detects concealed quotes in the post container
and injects a 'Peek at quote' menu item using the established clone-and-modify
pattern. Wired into injectMenuItems flow. Peek execution is stubbed for Phase 4.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

---

## Phase 3 Complete

**Deliverables:**
- ✅ `injectPeekOption()` function added to content.tsx
- ✅ Menu item injection follows established clone-and-modify pattern
- ✅ Concealed quote detection integrated (from Phase 2)
- ✅ Click handler stores context and triggers peek flow (stub for Phase 4)
- ✅ Wired into existing `injectMenuItems()` flow
- ✅ TypeScript compilation succeeds

**Next Phase:** Phase 4 will implement the full peek execution flow — extracting the parent post URI, fetching from the public API, resolving the concealed embed, and returning the quoted post content.
