# ErgoBlock UX Legibility Audit - Phase 3: Actionable Empty States

**Goal:** Update empty state messages to guide users to action, with first-run detection for enhanced onboarding

**Architecture:** Add first-run flag to storage, update EmptyState component usage to include action hints, create first-run specific empty states for popup and manager.

**Tech Stack:** Preact, TypeScript

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-01-22

---

## Phase Overview

This phase improves empty states to be actionable:
1. Track whether user has ever created a block/mute (first-run detection)
2. Show enhanced onboarding empty state for first-time users
3. Update standard empty states with action hints

**Key insight from codebase investigation:**
- EmptyState component is at `src/components/shared/EmptyState.tsx` (not manager/)
- ActionsTable uses inline empty state (lines 52-58) instead of shared EmptyState
- EmptyState already supports `action` prop with label and onClick

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add First-Run Detection to Storage

**Files:**
- Modify: `src/storage.ts`
- Modify: `src/types.ts`

**Step 1: Add storage key for first-run flag**

In `src/storage.ts`, add to STORAGE_KEYS object (around line 172-209):

```typescript
// Add to STORAGE_KEYS object:
HAS_CREATED_ACTION: 'hasCreatedAction',
```

**Step 2: Add getter and setter functions**

Add these functions to `src/storage.ts`:

```typescript
/**
 * Check if user has ever created a block or mute.
 * Used for first-run onboarding experience.
 */
export async function getHasCreatedAction(): Promise<boolean> {
  const result = await browser.storage.local.get(STORAGE_KEYS.HAS_CREATED_ACTION);
  return result[STORAGE_KEYS.HAS_CREATED_ACTION] === true;
}

/**
 * Mark that user has created their first block or mute.
 * Called when user creates a block/mute for the first time.
 */
export async function setHasCreatedAction(): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.HAS_CREATED_ACTION]: true });
}
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/storage.ts
git commit -m "feat: add first-run detection storage functions

- Add HAS_CREATED_ACTION storage key
- Add getHasCreatedAction() and setHasCreatedAction() functions
- Used for onboarding empty states"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Call setHasCreatedAction When User Creates Block/Mute

**Files:**
- Modify: `src/storage.ts` (in existing block/mute creation functions)

**Step 1: Find block/mute creation functions**

Look at `src/storage.ts` for functions that create blocks/mutes. These are likely:
- `setTempBlock` / `addTempBlock`
- `setTempMute` / `addTempMute`

**Step 2: Add setHasCreatedAction call**

In each function that creates a new block or mute, add:

```typescript
// At the end of the function, after the block/mute is saved:
await setHasCreatedAction();
```

Note: This is idempotent - calling it multiple times is fine.

For example, if there's a `setTempBlock` function:

```typescript
export async function setTempBlock(did: string, data: TempBlockData): Promise<void> {
  const blocks = await getTempBlocks();
  blocks[did] = data;
  await browser.storage.local.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
  await setHasCreatedAction(); // Mark that user has created an action
}
```

Do the same for mute functions.

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/storage.ts
git commit -m "feat: track first action creation for onboarding

- Call setHasCreatedAction() when creating blocks/mutes
- Enables first-run empty state detection"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Create First-Run Empty State Content

**Files:**
- Create: `src/components/shared/FirstRunEmptyState.tsx`

**Step 1: Create the first-run empty state component**

Create `src/components/shared/FirstRunEmptyState.tsx`:

```typescript
export interface FirstRunEmptyStateProps {
  /** Which surface this is displayed on */
  surface: 'popup' | 'manager';
}

/**
 * Enhanced empty state for first-time users.
 * Explains what ErgoBlock does and how to get started.
 */
export function FirstRunEmptyState({ surface }: FirstRunEmptyStateProps): JSX.Element {
  return (
    <div class="first-run-empty-state">
      <h2>Welcome to ErgoBlock!</h2>
      <p>
        This extension lets you temporarily block or mute people on Bluesky.
        Blocks and mutes you create will automatically expire after the time you choose.
      </p>
      <div class="first-run-steps">
        <h3>To get started:</h3>
        <ol>
          <li>Go to <a href="https://bsky.app" target="_blank" rel="noopener">bsky.app</a> and find someone's profile</li>
          <li>Click the <strong>...</strong> menu</li>
          <li>Choose <strong>Block</strong> or <strong>Mute</strong> - you'll see duration options</li>
        </ol>
      </div>
      {surface === 'manager' && (
        <p class="first-run-note">
          Once you create your first block or mute, you'll see it listed here.
        </p>
      )}
    </div>
  );
}
```

**Step 2: Add styles for first-run empty state**

Append to `src/styles/manager.css`:

```css
/* First-Run Empty State */
.first-run-empty-state {
  max-width: 480px;
  margin: var(--space-xl) auto;
  padding: var(--space-lg);
  text-align: center;
  background: var(--gray-1);
  border-radius: var(--radius-lg);
}

.first-run-empty-state h2 {
  margin: 0 0 var(--space-md);
  font-size: var(--font-size-3);
  color: var(--gray-9);
}

.first-run-empty-state p {
  margin: 0 0 var(--space-md);
  color: var(--gray-7);
  line-height: 1.5;
}

.first-run-steps {
  text-align: left;
  margin: var(--space-lg) 0;
  padding: var(--space-md);
  background: var(--gray-0);
  border-radius: var(--radius-md);
}

.first-run-steps h3 {
  margin: 0 0 var(--space-sm);
  font-size: var(--font-size-1);
  color: var(--gray-8);
}

.first-run-steps ol {
  margin: 0;
  padding-left: var(--space-lg);
}

.first-run-steps li {
  margin-bottom: var(--space-xs);
  color: var(--gray-7);
}

.first-run-steps a {
  color: var(--brand-primary);
  text-decoration: none;
}

.first-run-steps a:hover {
  text-decoration: underline;
}

.first-run-note {
  font-size: var(--font-size-00);
  color: var(--gray-5);
  font-style: italic;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .first-run-empty-state {
    background: var(--gray-8);
  }

  .first-run-empty-state h2 {
    color: var(--gray-0);
  }

  .first-run-empty-state p {
    color: var(--gray-3);
  }

  .first-run-steps {
    background: var(--gray-9);
  }

  .first-run-steps h3 {
    color: var(--gray-2);
  }

  .first-run-steps li {
    color: var(--gray-3);
  }
}
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/components/shared/FirstRunEmptyState.tsx src/styles/manager.css
git commit -m "feat: add first-run onboarding empty state component

- Create FirstRunEmptyState component with welcome message
- Include step-by-step getting started instructions
- Add responsive styling with dark mode support"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update Manager Empty State to Use First-Run Detection

**Files:**
- Modify: `src/components/manager/ActionsTable.tsx`

**Step 1: Read current ActionsTable to find empty state**

The inline empty state is around lines 52-58. Find the exact location.

**Step 2: Import required functions and components**

Add imports at top of `src/components/manager/ActionsTable.tsx`:

```typescript
import { useState, useEffect } from 'preact/hooks';
import { getHasCreatedAction } from '../../storage';
import { FirstRunEmptyState } from '../shared/FirstRunEmptyState';
```

**Step 3: Add first-run state hook**

Inside the ActionsTable component, add state for first-run detection:

```typescript
const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);

useEffect(() => {
  getHasCreatedAction().then((hasCreated) => {
    setIsFirstRun(!hasCreated);
  });
}, []);
```

**Step 4: Update empty state rendering**

Replace the inline empty state with conditional rendering:

```typescript
// When showing empty state, check if first-run
if (filteredEntries.length === 0) {
  // Still loading first-run status
  if (isFirstRun === null) {
    return <div class="empty-state">Loading...</div>;
  }

  // First-run: show onboarding
  if (isFirstRun) {
    return <FirstRunEmptyState surface="manager" />;
  }

  // Standard empty state with action hint
  return (
    <div class="empty-state">
      <span class="empty-icon">📋</span>
      <p class="empty-message">No blocks or mutes yet</p>
      <p class="empty-hint">
        To block or mute someone, go to their profile on Bluesky and click the ... menu.
      </p>
    </div>
  );
}
```

**Step 5: Add styles for empty hint**

Append to `src/styles/manager.css`:

```css
/* Empty state action hints */
.empty-hint {
  margin-top: var(--space-sm);
  font-size: var(--font-size-00);
  color: var(--gray-5);
}
```

**Step 6: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 7: Commit**

```bash
git add src/components/manager/ActionsTable.tsx src/styles/manager.css
git commit -m "feat: add first-run detection to manager empty state

- Show onboarding for first-time users
- Show action hint for returning users with no data
- Import and use FirstRunEmptyState component"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update Popup Empty State

**Files:**
- Modify: `src/popup.tsx`

**Step 1: Read current popup to find empty states**

Look for empty state sections in the expiring and recent sections.

**Step 2: Import required functions and components**

Add imports at top of `src/popup.tsx`:

```typescript
import { getHasCreatedAction } from './storage';
import { FirstRunEmptyState } from './components/shared/FirstRunEmptyState';
```

**Step 3: Add first-run state**

Add state hook in the popup component:

```typescript
const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);

useEffect(() => {
  getHasCreatedAction().then((hasCreated) => {
    setIsFirstRun(!hasCreated);
  });
}, []);
```

**Step 4: Update empty state in popup**

Find where the popup shows empty state (likely when blocks/mutes are 0) and add first-run check:

```typescript
// If first-run and no data, show compact onboarding
if (isFirstRun && totalBlocks === 0 && totalMutes === 0) {
  return (
    <div class="popup-first-run">
      <p><strong>Welcome to ErgoBlock!</strong></p>
      <p>To get started, go to someone's profile on Bluesky and use the ... menu to block or mute.</p>
    </div>
  );
}
```

**Step 5: Update "Nothing expiring soon" empty state**

Update the ExpiringSection empty state to include action context:

```typescript
// In ExpiringSection, update empty message:
<p>Nothing expiring soon. Your temporary blocks and mutes will appear here when they're about to expire.</p>
```

**Step 6: Add popup-specific styles**

Add to popup styles (or inline if popup has separate styling):

```css
.popup-first-run {
  padding: var(--space-md);
  text-align: center;
  color: var(--gray-7);
}

.popup-first-run p {
  margin: var(--space-xs) 0;
}
```

**Step 7: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 8: Commit**

```bash
git add src/popup.tsx
git commit -m "feat: add first-run detection to popup empty state

- Show compact onboarding for first-time users
- Update expiring section empty message with context"
```
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

<!-- START_TASK_6 -->
### Task 6: Update Other Tab Empty States

**Files:**
- Modify: Components for Blocklist Audit, Repost Filters tabs

**Step 1: Find empty state components/messages**

Search for empty state messages in:
- `src/components/manager/BlocklistAuditTab.tsx` (or similar)
- `src/components/manager/RepostFiltersTab.tsx` (or similar)

**Step 2: Update Blocklist Audit empty state**

Find the empty state and update message:

Old: "You don't subscribe to any blocklists"
New: "You don't subscribe to any blocklists. Blocklists are shared lists of accounts - you can find them in Bluesky's Moderation settings."

**Step 3: Update Repost Filters empty state**

Find the empty state and update message:

Old: "No repost filters active"
New: "No repost filters active. To hide someone's reposts, go to their profile on Bluesky and click the ... menu."

**Step 4: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 5: Commit**

```bash
git add src/components/manager/
git commit -m "feat: update tab empty states with action hints

- Blocklist Audit: explain what blocklists are and where to find them
- Repost Filters: explain how to hide reposts"
```
<!-- END_TASK_6 -->

---

## Phase Completion Checklist

- [ ] First-run storage key added
- [ ] getHasCreatedAction/setHasCreatedAction functions added
- [ ] Block/mute creation calls setHasCreatedAction
- [ ] FirstRunEmptyState component created
- [ ] Manager ActionsTable shows first-run onboarding
- [ ] Popup shows first-run onboarding
- [ ] Blocklist Audit empty state updated
- [ ] Repost Filters empty state updated
- [ ] All builds pass
- [ ] All changes committed

**Done when:** Build succeeds, first-run users see onboarding, returning users see action hints.
