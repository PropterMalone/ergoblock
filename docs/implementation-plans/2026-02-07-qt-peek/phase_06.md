# QT Peek Implementation Plan - Phase 6

**Goal:** Add enable/disable option in settings, handle edge cases, and polish

**Architecture:** Add a `qtPeekEnabled` boolean to `ExtensionOptions` (default: `true`). Gate the menu injection on this option. Add error handling for network failures, rate limiting, and missing URIs. Ensure graceful degradation (if detection fails, menu item simply doesn't appear).

**Tech Stack:** TypeScript (strict mode), Preact

**Scope:** Phase 6 of 6 phases from design plan `docs/design-plans/2026-02-07-qt-peek.md`

**Codebase verified:** 2026-02-07

---

## Phase Overview

This final phase adds:

1. A `qtPeekEnabled` option to `ExtensionOptions` with a settings UI toggle
2. Option check in the menu injection flow (skip if disabled)
3. Better error handling and user feedback for edge cases
4. Validation and run of the full test suite

---

<!-- START_TASK_1 -->
### Task 1: Add qtPeekEnabled to ExtensionOptions

**Files:**
- Modify: `src/types.ts`

**Step 1: Add the option to ExtensionOptions interface**

In `src/types.ts`, find the `ExtensionOptions` interface (around line 5) and add the new field:

```typescript
export interface ExtensionOptions {
  defaultDuration: number;
  quickBlockDuration: number;
  notificationsEnabled: boolean;
  notificationSound: boolean;
  checkInterval: number;
  theme: 'light' | 'dark' | 'auto';
  // Post context settings
  savePostContext: boolean;
  postContextRetentionDays: number; // 0 = never delete
  // Amnesty settings
  forgivenessPeriodDays: number; // How old a block must be to be eligible for amnesty
  // Block relationships settings (AskBeeves integration)
  blockRelationships: BlockRelationshipSettings;
  // QT Peek settings
  qtPeekEnabled: boolean; // Enable "Peek at quote" for concealed quote embeds
}
```

**Step 2: Add default value**

In `DEFAULT_OPTIONS` (around line 29), add:

```typescript
export const DEFAULT_OPTIONS: ExtensionOptions = {
  defaultDuration: 86400000, // 24 hours
  quickBlockDuration: 3600000, // 1 hour
  notificationsEnabled: true,
  notificationSound: false,
  checkInterval: 1,
  theme: 'auto',
  // Post context defaults
  savePostContext: true,
  postContextRetentionDays: 90,
  // Amnesty defaults
  forgivenessPeriodDays: 90, // 3 months
  // Block relationships defaults
  blockRelationships: DEFAULT_BLOCK_RELATIONSHIP_SETTINGS,
  // QT Peek defaults
  qtPeekEnabled: true,
};
```

**Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add qtPeekEnabled option to ExtensionOptions

Add boolean toggle for QT Peek feature, defaulting to enabled.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
### Task 2: Add Settings UI Toggle for QT Peek

**Files:**
- Modify: `src/options.tsx`
- Modify: `options.html`

**Step 1: Add QT Peek toggle to options.tsx**

In `src/options.tsx`, find the section where options are rendered (look for the existing checkboxes/toggles in the JSX return). Add a new section for QT Peek. Find the area where feature toggles are rendered and add:

```tsx
{/* QT Peek */}
<div class="option-group">
  <h3>QT Peek</h3>
  <div class="option-row">
    <label class="checkbox-label">
      <input
        type="checkbox"
        checked={options.qtPeekEnabled}
        onChange={(e) =>
          updateOption('qtPeekEnabled', (e.target as HTMLInputElement).checked)
        }
      />
      <span>Enable "Peek at quote" for hidden quotes</span>
    </label>
    <p class="option-description">
      Adds a right-click menu option to reveal blocked or detached quoted posts using the public API.
    </p>
  </div>
</div>
```

**Note:** The exact placement depends on the current options page layout. Insert it after the existing feature toggles (like notifications, post context, etc.) but before the save/reset buttons. Look at the existing option rendering pattern and match it.

**Step 2: Verify build**

Run: `npm run build`

Expected output: Build succeeds

**Step 3: Commit**

```bash
git add src/options.tsx options.html
git commit -m "feat: add QT Peek toggle to settings page

Add checkbox to enable/disable 'Peek at quote' menu option for concealed
quote embeds.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
### Task 3: Gate Menu Injection on qtPeekEnabled Option

**Files:**
- Modify: `src/content.tsx`

**Step 1: Add option check to injectPeekOption**

Modify `injectPeekOption` in `src/content.tsx` to check the `qtPeekEnabled` option before injecting. Add the `getOptions` import if not already present (it's imported via storage.ts):

At the top of `src/content.tsx`, ensure `getOptions` is imported. It may need to be added to the storage import:

```typescript
import {
  addTempBlock,
  addTempMute,
  isRepostFiltered,
  addRepostFilteredUser,
  removeRepostFilteredUser,
  isHandleFollowed,
  getOptions,
} from './storage.js';
```

Then modify `injectPeekOption` to check the option:

```typescript
async function injectPeekOption(menu: Element): Promise<void> {
  // Don't inject if already present
  if (menu.querySelector('[data-ergoblock-peek-quote]')) return;

  // Check if feature is enabled
  try {
    const options = await getOptions();
    if (!options.qtPeekEnabled) return;
  } catch {
    // If we can't read options, skip (graceful degradation)
    return;
  }

  // ... rest of the function unchanged
```

**Note:** The function signature changes from `function` to `async function` since `getOptions` is async. The call site in `injectMenuItems` doesn't need to await it — fire-and-forget is fine since the injection is async anyway.

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Expected output: No type errors

**Step 3: Commit**

```bash
git add src/content.tsx
git commit -m "feat: gate QT Peek menu injection on qtPeekEnabled option

Check the qtPeekEnabled setting before injecting the 'Peek at quote'
menu item. Gracefully degrades if options can't be read.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_3 -->

---

<!-- START_TASK_4 -->
### Task 4: Improve Error Handling and Edge Cases

**Files:**
- Modify: `src/content.tsx`
- Modify: `src/qt-peek.ts`

**Step 1: Add timeout to peek execution**

In `src/content.tsx`, update `executePeek` to add a timeout wrapper:

```typescript
async function executePeek(
  postContainer: HTMLElement,
  concealedInfo: ConcealedQuoteInfo
): Promise<void> {
  const parentUri = extractParentPostUri(postContainer);
  if (!parentUri) {
    showToast('Could not find post URI', true);
    return;
  }

  console.log('[ErgoBlock QT Peek] Peeking at quote in:', parentUri);

  const originalText = concealedInfo.placeholderElement.textContent;
  concealedInfo.placeholderElement.textContent = 'Peeking...';

  try {
    // Add a 15-second timeout to prevent hanging
    const timeoutMs = 15000;
    const peekedContent = await Promise.race([
      resolveQuoteEmbed(parentUri, concealedInfo.type),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Peek timed out')), timeoutMs)
      ),
    ]);

    if (!peekedContent) {
      concealedInfo.placeholderElement.textContent = originalText || 'Could not peek';
      showToast('Could not resolve quoted post — it may have been deleted', true);
      return;
    }

    renderPeekedQuote(concealedInfo.placeholderElement, peekedContent);
  } catch (error) {
    concealedInfo.placeholderElement.textContent = originalText || 'Error';
    const message =
      error instanceof Error && error.message === 'Peek timed out'
        ? 'Peek timed out — try again later'
        : 'Failed to peek at quote';
    showToast(message, true);
    throw error;
  }
}
```

**Step 2: Add AT URI handle-to-DID resolution note in qt-peek.ts**

In `resolveQuoteEmbed`, the parent URI extracted from the DOM contains a handle (e.g., `at://handle/app.bsky.feed.post/rkey`). The public API `getPosts` accepts handles, so no conversion is needed. Add a clarifying comment:

In `src/qt-peek.ts`, in the `resolveQuoteEmbed` function, add a comment before the first fetch:

```typescript
  // Note: The URI may contain a handle instead of a DID (e.g., at://user.bsky.social/...).
  // The getPosts endpoint accepts both handles and DIDs, so no conversion is needed.
  const parentPosts = await fetchPostsViaBackground([parentPostUri]);
```

**Step 3: Verify TypeScript compilation and build**

Run: `npx tsc --noEmit && npm run build`

Expected output: No errors

**Step 4: Commit**

```bash
git add src/content.tsx src/qt-peek.ts
git commit -m "fix: add timeout and better error messages for QT Peek

Add 15-second timeout to prevent peek from hanging. Improve error
messages for timeout, deleted posts, and general failures.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_4 -->

---

<!-- START_TASK_5 -->
### Task 5: Run Full Validation Suite

**Files:** None (validation only)

**Step 1: Run the full validation suite**

Run: `npm run validate`

This runs format + lint + type-check + tests in sequence.

Expected output: All checks pass

**Step 2: If any failures, fix them**

Common issues to check:
- ESLint warnings about unused imports (clean up any removed imports)
- Formatting issues (run `npm run format` to fix)
- Type errors from interface changes

**Step 3: Verify build output**

Run: `npm run build`

Expected output: Build produces `dist/` with updated `content.js` and `background.js`

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: fix lint/format issues from QT Peek implementation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
<!-- END_TASK_5 -->

---

## Phase 6 Complete

**Deliverables:**
- ✅ `qtPeekEnabled` option in ExtensionOptions (default: true)
- ✅ Settings page toggle for enabling/disabling QT Peek
- ✅ Menu injection gated on option check
- ✅ 15-second timeout for peek execution
- ✅ Improved error messages for timeout, deleted posts, failures
- ✅ Full validation suite passes (format, lint, type-check, tests)
- ✅ Build succeeds

---

## Implementation Complete

**All 6 phases delivered:**

| Phase | Description | Key Files |
|-------|-------------|-----------|
| 1 | API layer — getPosts public wrapper + background handler | `api.ts`, `background.ts`, `types.ts` |
| 2 | Concealed quote detection | `qt-peek.ts` |
| 3 | Menu item injection | `content.tsx` |
| 4 | Fetch and resolve flow | `qt-peek.ts`, `content.tsx` |
| 5 | PeekedQuote Preact component + Shadow DOM | `PeekedQuote.tsx`, `content.tsx` |
| 6 | Settings, error handling, polish | `types.ts`, `options.tsx`, `content.tsx` |

**Feature flow:**
1. User right-clicks post with concealed quote → Bluesky menu appears
2. ErgoBlock detects concealed quote via `detectConcealedQuote()` → injects "Peek at quote"
3. User clicks "Peek at quote" → `executePeek()` extracts parent URI, sends to background
4. Background fetches from public API (no auth) → resolves embed → returns content
5. `PeekedQuote` component renders in Shadow DOM, replacing the placeholder
