# ErgoBlock UX Legibility Audit - Phase 4: Table Column Configuration

**Goal:** Add column visibility settings to reduce overwhelming data table, allowing users to show/hide columns

**Architecture:** Add column visibility preferences to storage, create settings UI for column selection, apply visibility to ActionsTable. Default shows essential columns, advanced users can enable more.

**Tech Stack:** Preact, TypeScript

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-01-22

---

## Phase Overview

The ActionsTable currently shows 10 columns which can be overwhelming. This phase:
1. Defines which columns are visible by default vs advanced
2. Adds column visibility settings to storage
3. Creates UI in Settings tab to toggle column visibility
4. Applies column visibility to ActionsTable

**Default visible:** User, Type, Expires, Source, Date, Actions
**Advanced (hidden by default):** Context, Status (block relationship), Amnesty status

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add Column Visibility Types

**Files:**
- Modify: `src/types.ts`

**Step 1: Add column visibility type definition**

Add to `src/types.ts`:

```typescript
/** Available columns in the Blocks & Mutes table */
export type TableColumn =
  | 'user'
  | 'type'
  | 'context'
  | 'source'
  | 'status'
  | 'amnesty'
  | 'expires'
  | 'date'
  | 'actions';

/** Column visibility configuration */
export interface ColumnVisibility {
  /** User column - always visible, cannot be hidden */
  user: true;
  /** Block/Mute type column */
  type: boolean;
  /** Post context that triggered the block/mute */
  context: boolean;
  /** Source: ErgoBlock temp, permanent, or native Bluesky */
  source: boolean;
  /** Block relationship status (mutual, they block you, etc.) */
  status: boolean;
  /** Amnesty review status */
  amnesty: boolean;
  /** Expiration date/time */
  expires: boolean;
  /** Creation date */
  date: boolean;
  /** Actions column - always visible, cannot be hidden */
  actions: true;
}

/** Default column visibility - essential columns only */
export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  user: true,
  type: true,
  context: false,
  source: true,
  status: false,
  amnesty: false,
  expires: true,
  date: true,
  actions: true,
};

/** Column metadata for settings UI */
export const COLUMN_METADATA: Record<TableColumn, { label: string; description: string; alwaysVisible?: boolean }> = {
  user: { label: 'User', description: 'Account name and avatar', alwaysVisible: true },
  type: { label: 'Type', description: 'Block or Mute' },
  context: { label: 'Context', description: 'The post or situation that triggered this block/mute' },
  source: { label: 'Source', description: 'Where this came from - ErgoBlock or native Bluesky' },
  status: { label: 'Status', description: 'Block relationship (mutual, they block you, etc.)' },
  amnesty: { label: 'Amnesty', description: 'Review status for amnesty consideration' },
  expires: { label: 'Expires', description: 'When the block/mute will be automatically removed' },
  date: { label: 'Date', description: 'When the block/mute was created' },
  actions: { label: 'Actions', description: 'Unblock, unmute, and other actions', alwaysVisible: true },
};
```

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add column visibility types for table configuration

- Define TableColumn type for all available columns
- Create ColumnVisibility interface with defaults
- Add COLUMN_METADATA for settings UI labels and descriptions"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add Column Visibility to Storage

**Files:**
- Modify: `src/storage.ts`

**Step 1: Add storage key**

Add to STORAGE_KEYS in `src/storage.ts`:

```typescript
COLUMN_VISIBILITY: 'columnVisibility',
```

**Step 2: Add getter and setter functions**

Add to `src/storage.ts`:

```typescript
import { ColumnVisibility, DEFAULT_COLUMN_VISIBILITY } from './types';

/**
 * Get column visibility settings.
 * Returns default visibility if not set.
 */
export async function getColumnVisibility(): Promise<ColumnVisibility> {
  const result = await browser.storage.local.get(STORAGE_KEYS.COLUMN_VISIBILITY);
  const stored = result[STORAGE_KEYS.COLUMN_VISIBILITY];

  if (!stored) {
    return DEFAULT_COLUMN_VISIBILITY;
  }

  // Merge with defaults in case new columns were added
  return { ...DEFAULT_COLUMN_VISIBILITY, ...stored };
}

/**
 * Update column visibility settings.
 * Only updates the columns that are toggleable (not user or actions).
 */
export async function setColumnVisibility(visibility: Partial<ColumnVisibility>): Promise<void> {
  const current = await getColumnVisibility();
  const updated: ColumnVisibility = {
    ...current,
    ...visibility,
    // Enforce always-visible columns
    user: true,
    actions: true,
  };
  await browser.storage.local.set({ [STORAGE_KEYS.COLUMN_VISIBILITY]: updated });
}
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/storage.ts
git commit -m "feat: add column visibility storage functions

- Add COLUMN_VISIBILITY storage key
- Add getColumnVisibility() with defaults fallback
- Add setColumnVisibility() that enforces always-visible columns"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Add Column Visibility Settings UI

**Files:**
- Modify: `src/components/manager/SettingsTab.tsx`

**Step 1: Read current SettingsTab structure**

First, read `src/components/manager/SettingsTab.tsx` to understand where to add the new section.

**Step 2: Import required types and functions**

Add imports at top:

```typescript
import { useState, useEffect } from 'preact/hooks';
import { ColumnVisibility, TableColumn, COLUMN_METADATA, DEFAULT_COLUMN_VISIBILITY } from '../../types';
import { getColumnVisibility, setColumnVisibility } from '../../storage';
```

**Step 3: Add state for column visibility**

Inside the SettingsTab component, add:

```typescript
const [columnVisibility, setColumnVisibilityState] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);

useEffect(() => {
  getColumnVisibility().then(setColumnVisibilityState);
}, []);

const handleColumnToggle = async (column: TableColumn) => {
  if (COLUMN_METADATA[column].alwaysVisible) return;

  const newValue = !columnVisibility[column];
  const updated = { ...columnVisibility, [column]: newValue };
  setColumnVisibilityState(updated);
  await setColumnVisibility(updated);
};
```

**Step 4: Add Column Visibility section to settings UI**

Add a new section in the settings render (after an appropriate existing section like Appearance):

```typescript
<section class="settings-section">
  <h3>Table Columns</h3>
  <p class="settings-description">
    Choose which columns to show in the Blocks & Mutes table.
    Hiding columns can make the table easier to read.
  </p>
  <div class="column-visibility-options">
    {(Object.keys(COLUMN_METADATA) as Array<TableColumn>).map((column) => {
      const meta = COLUMN_METADATA[column];
      const isChecked = columnVisibility[column];
      const isDisabled = meta.alwaysVisible === true;

      return (
        <label key={column} class={`column-toggle ${isDisabled ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            checked={isChecked}
            disabled={isDisabled}
            onChange={() => handleColumnToggle(column)}
          />
          <span class="column-label">{meta.label}</span>
          <span class="column-description">{meta.description}</span>
        </label>
      );
    })}
  </div>
</section>
```

**Step 5: Add styles for column visibility settings**

Append to `src/styles/manager.css`:

```css
/* Column Visibility Settings */
.column-visibility-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.column-toggle {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  gap: var(--space-xxs) var(--space-sm);
  align-items: start;
  padding: var(--space-sm);
  background: var(--gray-1);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.column-toggle:hover {
  background: var(--gray-2);
}

.column-toggle.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.column-toggle input[type="checkbox"] {
  grid-row: span 2;
  margin-top: var(--space-xxs);
}

.column-label {
  font-weight: var(--font-weight-5);
  color: var(--gray-9);
}

.column-description {
  grid-column: 2;
  font-size: var(--font-size-00);
  color: var(--gray-5);
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .column-toggle {
    background: var(--gray-8);
  }

  .column-toggle:hover {
    background: var(--gray-7);
  }

  .column-label {
    color: var(--gray-1);
  }

  .column-description {
    color: var(--gray-4);
  }
}
```

**Step 6: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 7: Commit**

```bash
git add src/components/manager/SettingsTab.tsx src/styles/manager.css
git commit -m "feat: add column visibility settings UI

- Add Table Columns section to Settings tab
- Allow toggling visibility for each column
- Show description explaining each column's purpose
- Disable toggle for always-visible columns (user, actions)"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Apply Column Visibility to ActionsTable

**Files:**
- Modify: `src/components/manager/ActionsTable.tsx`

**Step 1: Read current ActionsTable structure**

First, read `src/components/manager/ActionsTable.tsx` to understand the table structure.

**Step 2: Import column visibility functions**

Add imports:

```typescript
import { useState, useEffect } from 'preact/hooks';
import { ColumnVisibility, DEFAULT_COLUMN_VISIBILITY } from '../../types';
import { getColumnVisibility } from '../../storage';
```

**Step 3: Add column visibility state**

Inside the ActionsTable component:

```typescript
const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);

useEffect(() => {
  getColumnVisibility().then(setColumnVisibility);

  // Listen for storage changes to update when settings change
  const handleStorageChange = (changes: browser.Storage.StorageChange) => {
    if (changes.columnVisibility) {
      setColumnVisibility(changes.columnVisibility.newValue);
    }
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  return () => browser.storage.onChanged.removeListener(handleStorageChange);
}, []);
```

**Step 4: Apply visibility to table headers**

In the table header row, conditionally render each column:

```typescript
<thead>
  <tr>
    <th class="col-checkbox">
      <input type="checkbox" ... />
    </th>
    <th class="col-user">User</th>
    {columnVisibility.type && <th class="col-type">Type</th>}
    {columnVisibility.context && <th class="col-context">Context</th>}
    {columnVisibility.source && <th class="col-source">Source</th>}
    {columnVisibility.status && <th class="col-status">Status</th>}
    {columnVisibility.amnesty && <th class="col-amnesty">Amnesty</th>}
    {columnVisibility.expires && <th class="col-expires">Expires</th>}
    {columnVisibility.date && <th class="col-date">Date</th>}
    <th class="col-actions">Actions</th>
  </tr>
</thead>
```

**Step 5: Apply visibility to table body rows**

In each table row, conditionally render cells:

```typescript
<tr key={entry.did}>
  <td class="col-checkbox">
    <input type="checkbox" ... />
  </td>
  <td class="col-user">
    {/* User cell content */}
  </td>
  {columnVisibility.type && (
    <td class="col-type">
      {/* Type badge */}
    </td>
  )}
  {columnVisibility.context && (
    <td class="col-context">
      {/* Context content */}
    </td>
  )}
  {columnVisibility.source && (
    <td class="col-source">
      {/* Source badge */}
    </td>
  )}
  {columnVisibility.status && (
    <td class="col-status">
      {/* Status content */}
    </td>
  )}
  {columnVisibility.amnesty && (
    <td class="col-amnesty">
      {/* Amnesty status */}
    </td>
  )}
  {columnVisibility.expires && (
    <td class="col-expires">
      {/* Expiration date */}
    </td>
  )}
  {columnVisibility.date && (
    <td class="col-date">
      {/* Creation date */}
    </td>
  )}
  <td class="col-actions">
    {/* Action buttons */}
  </td>
</tr>
```

**Step 6: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 7: Commit**

```bash
git add src/components/manager/ActionsTable.tsx
git commit -m "feat: apply column visibility to ActionsTable

- Load column visibility from storage
- Listen for storage changes to update in real-time
- Conditionally render columns based on visibility settings"
```
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

---

<!-- START_TASK_5 -->
### Task 5: Run Full Validation

**Files:**
- No file changes - verification only

**Step 1: Run build**

Run: `npm run build`
Expected: Build completes without errors

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Run full validation**

Run: `npm run validate`
Expected: Lint, type check, format check, and tests all pass

**Step 4: Manual verification**

- [ ] Open Settings tab, verify "Table Columns" section appears
- [ ] Toggle column visibility, verify immediate effect on table
- [ ] Refresh page, verify settings persist
- [ ] Verify user and actions columns cannot be unchecked
<!-- END_TASK_5 -->

---

## Phase Completion Checklist

- [ ] ColumnVisibility type defined with defaults
- [ ] COLUMN_METADATA provides labels and descriptions
- [ ] Storage functions for column visibility
- [ ] Settings UI for toggling columns
- [ ] ActionsTable respects visibility settings
- [ ] Real-time update when settings change
- [ ] All builds pass
- [ ] All tests pass
- [ ] All changes committed

**Done when:** Build succeeds, column visibility settings work end-to-end.
