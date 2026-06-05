# ErgoBlock UX Legibility Audit - Phase 5: Remaining Tooltips

**Goal:** Add tooltips to all remaining jargon terms across settings, duration picker, and manager tabs

**Architecture:** Apply Tooltip component to all undefined terms listed in the design plan. Centralize tooltip text definitions for consistency.

**Tech Stack:** Preact, TypeScript

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-01-22

---

## Phase Overview

This phase adds tooltips to remaining jargon terms:
- Settings page labels (Last Word, PDS, etc.)
- Duration picker explanations
- Manager tab-specific terms (Amnesty column, Context column, etc.)
- Options page labels

**Terms to add tooltips (from design):**
| Term | Tooltip Text |
|------|--------------|
| Amnesty | Review old blocks to decide if they should be removed |
| Blocklist | A shared list of blocked accounts you can subscribe to |
| Mass Ops | Detect patterns of rapid automated blocking |
| Last Word | Block after a delay so you can send a final reply first |
| PDS | Personal Data Server - where your Bluesky data is stored |
| CAR | Content Addressable Repository - a data export format |
| Context | The post or situation that triggered this block/mute |
| Source | Where this block/mute came from - ErgoBlock (temporary) or native Bluesky (permanent) |

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create Centralized Tooltip Definitions

**Files:**
- Create: `src/constants/tooltips.ts`

**Step 1: Create tooltips constants file**

Create `src/constants/tooltips.ts`:

```typescript
/**
 * Centralized tooltip text definitions for consistent messaging across the UI.
 * These explain jargon and domain-specific terms to new users.
 */

/** Badge-related tooltips (also used in Phase 1) */
export const BADGE_TOOLTIPS = {
  temp: 'Temporary - will automatically expire at the scheduled time',
  permanent: 'Permanent - will not expire unless manually removed',
  expiring: 'Expiring soon - scheduled to be removed within 24 hours',
} as const;

/** Tab name tooltips (also used in Phase 1) */
export const TAB_TOOLTIPS = {
  actions: 'View and manage all your blocked and muted accounts',
  amnesty: 'Review old blocks to decide if they should be removed',
  blocklistAudit: 'Check for conflicts between your follows and blocklist subscriptions',
  repostFilters: "Manage accounts whose reposts you've hidden from your feed",
  massOps: 'Detect and undo patterns of rapid automated blocking',
  copyUser: "Import another user's blocks or follows to your account",
  settings: 'Configure ErgoBlock behavior and appearance',
} as const;

/** Column header tooltips */
export const COLUMN_TOOLTIPS = {
  context: 'The post or situation that triggered this block/mute',
  source: 'Where this block/mute came from - ErgoBlock (temporary) or native Bluesky (permanent)',
  status: 'Block relationship with this account (mutual block, they block you, etc.)',
  amnesty: 'Review status for possible block removal',
  expires: 'When this temporary block/mute will be automatically removed',
} as const;

/** Settings page tooltips */
export const SETTINGS_TOOLTIPS = {
  lastWord: 'Block after a delay so you can send a final reply first',
  lastWordDelay: 'How long to wait before the block takes effect',
  pds: 'Personal Data Server - where your Bluesky data is stored',
  car: 'Content Addressable Repository - a data export format',
  checkInterval: 'How often ErgoBlock checks for expired blocks/mutes',
  forgivenessPeriod: 'How long before a block becomes eligible for amnesty review',
  postContextRetention: 'How long to keep the context of what triggered each block/mute',
} as const;

/** Popup tooltips */
export const POPUP_TOOLTIPS = {
  expiring24h: 'Blocks and mutes that will expire in the next 24 hours',
  checkNow: 'Manually check for expired blocks/mutes and remove them',
  sync: 'Refresh data from your Bluesky account',
  openManager: 'Open the full ErgoBlock manager to view and manage all blocks/mutes',
} as const;

/** Duration picker tooltips */
export const DURATION_TOOLTIPS = {
  permanent: 'This block/mute will not expire unless you manually remove it',
  lastWordOption: 'Send a final reply before the block takes effect',
} as const;

/** General term tooltips */
export const TERM_TOOLTIPS = {
  blocklist: 'A shared list of blocked accounts you can subscribe to',
  massOps: 'Detect patterns of rapid automated blocking',
} as const;
```

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add src/constants/tooltips.ts
git commit -m "feat: create centralized tooltip definitions

- Add tooltip text for badges, tabs, columns, settings
- Enables consistent messaging across all UI surfaces
- Single source of truth for all explanatory text"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update Badge Component to Use Centralized Tooltips

**Files:**
- Modify: `src/components/shared/Badge.tsx`

**Step 1: Import centralized tooltips**

Update the Badge component to use centralized definitions:

```typescript
import { BADGE_TOOLTIPS } from '../../constants/tooltips';

// Remove the local BADGE_TOOLTIPS definition and use the import instead
```

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add src/components/shared/Badge.tsx
git commit -m "refactor: use centralized tooltip definitions in Badge"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Add Tooltips to Settings Page Labels

**Files:**
- Modify: `src/components/manager/SettingsTab.tsx`

**Step 1: Import Tooltip and centralized definitions**

Add imports:

```typescript
import { Tooltip } from '../shared/Tooltip';
import { SETTINGS_TOOLTIPS } from '../../constants/tooltips';
```

**Step 2: Add tooltips to settings labels**

Find each settings label that needs a tooltip and wrap it:

**Last Word setting:**
```typescript
<Tooltip text={SETTINGS_TOOLTIPS.lastWord} position="right">
  <label>Last Word Mode</label>
</Tooltip>
```

**Last Word Delay:**
```typescript
<Tooltip text={SETTINGS_TOOLTIPS.lastWordDelay} position="right">
  <label>Last Word Delay</label>
</Tooltip>
```

**PDS setting:**
```typescript
<Tooltip text={SETTINGS_TOOLTIPS.pds} position="right">
  <label>PDS URL</label>
</Tooltip>
```

**Check Interval:**
```typescript
<Tooltip text={SETTINGS_TOOLTIPS.checkInterval} position="right">
  <label>Check Interval</label>
</Tooltip>
```

**Forgiveness Period:**
```typescript
<Tooltip text={SETTINGS_TOOLTIPS.forgivenessPeriod} position="right">
  <label>Forgiveness Period</label>
</Tooltip>
```

**Post Context Retention:**
```typescript
<Tooltip text={SETTINGS_TOOLTIPS.postContextRetention} position="right">
  <label>Post Context Retention</label>
</Tooltip>
```

**CAR cache status (if displayed):**
```typescript
<Tooltip text={SETTINGS_TOOLTIPS.car} position="right">
  <span>CAR Cache</span>
</Tooltip>
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/components/manager/SettingsTab.tsx
git commit -m "feat: add tooltips to settings page labels

- Last Word Mode and Delay explained
- PDS URL explained
- Check Interval, Forgiveness Period, Post Context Retention explained"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Add Tooltips to Duration Picker

**Files:**
- Modify: `src/components/content/DurationPicker.tsx`

**Step 1: Import Tooltip and centralized definitions**

Add imports at top of `src/components/content/DurationPicker.tsx`:

```typescript
import { Tooltip } from '../shared/Tooltip';
import { DURATION_TOOLTIPS } from '../../constants/tooltips';
```

**Step 2: Add tooltip to permanent option**

Find where the "Permanent" duration option is rendered and add tooltip:

```typescript
{option.label === 'Permanent' ? (
  <Tooltip text={DURATION_TOOLTIPS.permanent} position="left">
    <span>{option.label}</span>
  </Tooltip>
) : (
  <span>{option.label}</span>
)}
```

**Step 3: Add tooltip to Last Word option**

If there's a Last Word toggle/option, add tooltip:

```typescript
<Tooltip text={DURATION_TOOLTIPS.lastWordOption} position="left">
  <label class="last-word-option">
    <input type="checkbox" ... />
    <span>Enable Last Word</span>
  </label>
</Tooltip>
```

**Step 4: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 5: Commit**

```bash
git add src/components/content/DurationPicker.tsx
git commit -m "feat: add tooltips to duration picker options

- Explain permanent duration meaning
- Explain Last Word option purpose"
```
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

---

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->

<!-- START_TASK_5 -->
### Task 5: Add Tooltips to Table Column Headers

**Files:**
- Modify: `src/components/manager/ActionsTable.tsx`

**Step 1: Import Tooltip and centralized definitions**

Add imports:

```typescript
import { Tooltip } from '../shared/Tooltip';
import { COLUMN_TOOLTIPS } from '../../constants/tooltips';
```

**Step 2: Add tooltips to column headers**

Update the table header to wrap columns with tooltips:

```typescript
<thead>
  <tr>
    <th class="col-checkbox">
      <input type="checkbox" ... />
    </th>
    <th class="col-user">User</th>
    {columnVisibility.type && <th class="col-type">Type</th>}
    {columnVisibility.context && (
      <th class="col-context">
        <Tooltip text={COLUMN_TOOLTIPS.context} position="bottom">
          <span>Context</span>
        </Tooltip>
      </th>
    )}
    {columnVisibility.source && (
      <th class="col-source">
        <Tooltip text={COLUMN_TOOLTIPS.source} position="bottom">
          <span>Source</span>
        </Tooltip>
      </th>
    )}
    {columnVisibility.status && (
      <th class="col-status">
        <Tooltip text={COLUMN_TOOLTIPS.status} position="bottom">
          <span>Status</span>
        </Tooltip>
      </th>
    )}
    {columnVisibility.amnesty && (
      <th class="col-amnesty">
        <Tooltip text={COLUMN_TOOLTIPS.amnesty} position="bottom">
          <span>Amnesty</span>
        </Tooltip>
      </th>
    )}
    {columnVisibility.expires && (
      <th class="col-expires">
        <Tooltip text={COLUMN_TOOLTIPS.expires} position="bottom">
          <span>Expires</span>
        </Tooltip>
      </th>
    )}
    {columnVisibility.date && <th class="col-date">Date</th>}
    <th class="col-actions">Actions</th>
  </tr>
</thead>
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/components/manager/ActionsTable.tsx
git commit -m "feat: add tooltips to table column headers

- Context, Source, Status, Amnesty, Expires columns explained
- Helps users understand what each column means"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Add Tooltips to Options Page

**Files:**
- Modify: `src/options.tsx`

**Step 1: Read current options page structure**

First, read `src/options.tsx` to understand what settings are displayed.

**Step 2: Import Tooltip and centralized definitions**

Add imports:

```typescript
import { Tooltip } from './components/shared/Tooltip';
import { SETTINGS_TOOLTIPS } from './constants/tooltips';
```

**Step 3: Add tooltips to options labels**

The options page likely has a subset of settings. Add tooltips to any jargon terms:

```typescript
// For any setting that uses jargon terminology, wrap in Tooltip
<Tooltip text={SETTINGS_TOOLTIPS.lastWord} position="right">
  <label>Last Word Mode</label>
</Tooltip>
```

**Step 4: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 5: Commit**

```bash
git add src/options.tsx
git commit -m "feat: add tooltips to options page labels

- Use same tooltip definitions as settings tab
- Consistent explanation across all surfaces"
```
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_C -->

---

<!-- START_TASK_7 -->
### Task 7: Update Popup to Use Centralized Tooltips

**Files:**
- Modify: `src/popup.tsx`

**Step 1: Import centralized definitions**

Replace or add to existing imports:

```typescript
import { POPUP_TOOLTIPS } from './constants/tooltips';
```

**Step 2: Update popup tooltips to use centralized definitions**

Update the tooltip text to use the centralized constants:

```typescript
// Expiring 24h stat
<Tooltip text={POPUP_TOOLTIPS.expiring24h} position="bottom">
  ...
</Tooltip>

// Check Now button
<Tooltip text={POPUP_TOOLTIPS.checkNow} position="top">
  ...
</Tooltip>

// Sync button
<Tooltip text={POPUP_TOOLTIPS.sync} position="top">
  ...
</Tooltip>

// Open Manager link
<Tooltip text={POPUP_TOOLTIPS.openManager} position="bottom">
  ...
</Tooltip>
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/popup.tsx
git commit -m "refactor: use centralized tooltip definitions in popup"
```
<!-- END_TASK_7 -->

---

<!-- START_TASK_8 -->
### Task 8: Final Validation

**Files:**
- No file changes - verification only

**Step 1: Run full validation**

Run: `npm run validate`
Expected: Lint, type check, format check, and tests all pass

**Step 2: Manual verification checklist**

- [ ] Settings tab: hover over each label, verify tooltip appears
- [ ] Duration picker: hover over Permanent, verify tooltip
- [ ] Duration picker: hover over Last Word option, verify tooltip
- [ ] ActionsTable: hover over column headers (Context, Source, etc.), verify tooltips
- [ ] Options page: verify tooltips match settings tab
- [ ] Popup: verify all tooltips still work

**Step 3: Accessibility verification**

- [ ] Tab through UI elements, verify tooltips appear on focus
- [ ] Screen reader announces tooltip content via aria-describedby
<!-- END_TASK_8 -->

---

## Phase Completion Checklist

- [ ] Centralized tooltip definitions created
- [ ] Badge component uses centralized definitions
- [ ] Settings page labels have tooltips
- [ ] Duration picker options have tooltips
- [ ] Table column headers have tooltips
- [ ] Options page has tooltips
- [ ] Popup uses centralized definitions
- [ ] All builds pass
- [ ] All tests pass
- [ ] Accessibility verified
- [ ] All changes committed

**Done when:** All jargon terms across all UI surfaces have explanatory tooltips.
