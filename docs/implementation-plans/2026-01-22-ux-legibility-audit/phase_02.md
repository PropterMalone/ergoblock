# ErgoBlock UX Legibility Audit - Phase 2: Tab Visual Grouping

**Goal:** Organize tabs into visual groups (Core, Review, Advanced, Config) with subtle separators to show hierarchy

**Architecture:** Add CSS-based visual separators between tab groups. No structural changes to tab behavior - purely visual organization to help users understand which features are commonly used vs specialized.

**Tech Stack:** Preact, CSS

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-01-22

---

## Phase Overview

This phase reorganizes the tab navigation visually:
- **Core:** Blocks & Mutes (main view, used by everyone)
- **Review:** Amnesty, Blocklist Audit (for reconsidering past decisions)
- **Advanced:** Repost Filters, Mass Ops, Copy User (power-user features)
- **Config:** Settings (standalone at end)

Visual separators (increased margin + subtle line) will indicate these groupings without changing functionality.

---

<!-- START_TASK_1 -->
### Task 1: Add Tab Group Data Attributes

**Files:**
- Modify: `src/components/manager/TabNav.tsx`

**Step 1: Read current TabNav to understand structure**

First, read `src/components/manager/TabNav.tsx` to see current implementation.

**Step 2: Add group metadata to TABS**

Update the Tab type and TABS array to include group information:

```typescript
type TabGroup = 'core' | 'review' | 'advanced' | 'config';

type Tab = {
  id: TabType;
  label: string;
  tooltip: string;
  group: TabGroup;
};

const TABS: Tab[] = [
  {
    id: 'actions',
    label: 'Blocks & Mutes',
    tooltip: 'View and manage all your blocked and muted accounts',
    group: 'core',
  },
  {
    id: 'amnesty',
    label: 'Amnesty',
    tooltip: 'Review old blocks to decide if they should be removed',
    group: 'review',
  },
  {
    id: 'blocklist-audit',
    label: 'Blocklist Audit',
    tooltip: 'Check for conflicts between your follows and blocklist subscriptions',
    group: 'review',
  },
  {
    id: 'repost-filters',
    label: 'Repost Filters',
    tooltip: 'Manage accounts whose reposts you\'ve hidden from your feed',
    group: 'advanced',
  },
  {
    id: 'mass-ops',
    label: 'Mass Ops',
    tooltip: 'Detect and undo patterns of rapid automated blocking',
    group: 'advanced',
  },
  {
    id: 'copy-user',
    label: 'Copy User',
    tooltip: 'Import another user\'s blocks or follows to your account',
    group: 'advanced',
  },
  {
    id: 'settings',
    label: 'Settings',
    tooltip: 'Configure ErgoBlock behavior and appearance',
    group: 'config',
  },
];
```

**Step 3: Add data attributes to tab buttons for CSS targeting**

In the render, add data attributes to identify first tab of each group:

```typescript
{TABS.map((tab, index) => {
  const prevTab = TABS[index - 1];
  const isGroupStart = index === 0 || prevTab?.group !== tab.group;

  return (
    <Tooltip key={tab.id} text={tab.tooltip} position="bottom">
      <button
        class={`tab ${activeTab.value === tab.id ? 'active' : ''}`}
        data-group={tab.group}
        data-group-start={isGroupStart ? 'true' : undefined}
        onClick={() => handleTabChange(tab.id)}
      >
        {tab.label}
      </button>
    </Tooltip>
  );
})}
```

**Step 4: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 5: Commit**

```bash
git add src/components/manager/TabNav.tsx
git commit -m "feat: add tab group metadata for visual hierarchy

- Categorize tabs into core/review/advanced/config groups
- Add data attributes for CSS-based group separators"
```
<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
### Task 2: Add CSS Styles for Tab Group Separators

**Files:**
- Modify: `src/styles/manager.css`

**Step 1: Read current tab styles**

First, read the tab styles section in `src/styles/manager.css` to understand current styling.

**Step 2: Add group separator styles**

Append to the tabs section in `src/styles/manager.css`:

```css
/* Tab Group Visual Separators */
.tab[data-group-start="true"]:not(:first-child) {
  margin-left: var(--space-lg);
  position: relative;
}

.tab[data-group-start="true"]:not(:first-child)::before {
  content: '';
  position: absolute;
  left: calc(var(--space-lg) / -2 - 1px);
  top: 20%;
  height: 60%;
  width: 1px;
  background: var(--gray-3);
}

/* Group visual hints - subtle background tint for each group */
.tab[data-group="core"] {
  /* Core tabs have default styling - no change needed */
}

.tab[data-group="review"]:not(.active) {
  /* Review tabs - subtle blue tint when not active */
  background: var(--blue-0, rgba(59, 130, 246, 0.05));
}

.tab[data-group="advanced"]:not(.active) {
  /* Advanced tabs - subtle orange tint when not active */
  background: var(--orange-0, rgba(251, 146, 60, 0.05));
}

.tab[data-group="config"]:not(.active) {
  /* Config tab has default styling */
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
  .tab[data-group-start="true"]:not(:first-child)::before {
    background: var(--gray-6);
  }

  .tab[data-group="review"]:not(.active) {
    background: rgba(59, 130, 246, 0.08);
  }

  .tab[data-group="advanced"]:not(.active) {
    background: rgba(251, 146, 60, 0.08);
  }
}
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/styles/manager.css
git commit -m "feat: add visual separators between tab groups

- Add vertical separator lines before each new group
- Add subtle background tints to review/advanced tabs
- Support dark mode styling"
```
<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
### Task 3: Verify Tab Keyboard Navigation Still Works

**Files:**
- No file changes - verification only

**Step 1: Build and test manually**

Run: `npm run build`
Expected: Build completes without errors

**Step 2: Manual verification checklist**

Load the extension and verify:
- [ ] All 7 tabs are visible
- [ ] Visual separators appear before Amnesty, Repost Filters, and Settings
- [ ] Tab keyboard navigation (Tab key) moves through tabs in order
- [ ] Tab appearance doesn't break on hover/active states
- [ ] Dark mode shows appropriate separator colors

**Step 3: Run existing tests**

Run: `npm test`
Expected: All tests pass (tab visual changes shouldn't affect test behavior)

**Step 4: Commit verification (no file changes)**

No commit needed - this is verification only.
<!-- END_TASK_3 -->

---

## Phase Completion Checklist

- [ ] Tab groups defined (core, review, advanced, config)
- [ ] Data attributes added to tab buttons
- [ ] CSS separators appear between groups
- [ ] Subtle background tints differentiate groups
- [ ] Dark mode works correctly
- [ ] Keyboard navigation still works
- [ ] All builds pass
- [ ] All tests pass
- [ ] All changes committed

**Done when:** Build succeeds with visual tab grouping and all tests pass.
