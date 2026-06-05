# ErgoBlock UX Legibility Audit - Phase 1: Tooltip Infrastructure

**Goal:** Create reusable Tooltip component and apply to highest-impact jargon (Temp/Perm badges, tab names, popup buttons, stats)

**Architecture:** Add a shared Tooltip component using CSS-only hover/focus approach with aria-describedby for accessibility. Apply tooltips to Badge component variants, TabNav tabs, popup buttons, and stats.

**Tech Stack:** Preact, CSS, TypeScript

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-01-22

---

## Phase Overview

This phase creates the tooltip infrastructure and applies it to the most confusing elements:
- Temp/Perm badge explanations
- Tab name descriptions
- "Check Now" and "Sync" button purposes
- "Expiring 24h" stat meaning

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create Tooltip Component

**Files:**
- Create: `src/components/shared/Tooltip.tsx`
- Modify: `src/styles/manager.css` (append tooltip styles)

**Step 1: Create the Tooltip component**

Create `src/components/shared/Tooltip.tsx`:

```typescript
import { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

export interface TooltipProps {
  /** The tooltip text to display */
  text: string;
  /** Position of tooltip relative to children */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** The element that triggers the tooltip */
  children: ComponentChildren;
  /** Additional CSS class for the wrapper */
  class?: string;
}

/**
 * Tooltip component that shows explanatory text on hover/focus.
 * Uses CSS-only approach for performance. Accessible via aria-describedby.
 */
export function Tooltip({
  text,
  position = 'top',
  children,
  class: className,
}: TooltipProps): JSX.Element {
  const tooltipId = useId();

  return (
    <span
      class={`tooltip-wrapper ${className ?? ''}`}
      data-tooltip-position={position}
    >
      <span class="tooltip-trigger" aria-describedby={tooltipId}>
        {children}
      </span>
      <span id={tooltipId} class="tooltip-content" role="tooltip">
        {text}
      </span>
    </span>
  );
}
```

**Step 2: Add tooltip CSS styles**

Append to `src/styles/manager.css`:

```css
/* Tooltip Component */
.tooltip-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.tooltip-trigger {
  display: inline-flex;
  align-items: center;
}

.tooltip-content {
  position: absolute;
  z-index: 1000;
  padding: var(--space-xs) var(--space-sm);
  background: var(--gray-9);
  color: var(--gray-0);
  font-size: var(--font-size-00);
  font-weight: var(--font-weight-4);
  line-height: 1.4;
  border-radius: var(--radius-md);
  white-space: nowrap;
  max-width: 280px;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease-in-out, visibility 0.15s ease-in-out;
}

/* Position variants */
.tooltip-wrapper[data-tooltip-position="top"] .tooltip-content {
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.tooltip-wrapper[data-tooltip-position="bottom"] .tooltip-content {
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.tooltip-wrapper[data-tooltip-position="left"] .tooltip-content {
  right: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}

.tooltip-wrapper[data-tooltip-position="right"] .tooltip-content {
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}

/* Show on hover and focus */
.tooltip-wrapper:hover .tooltip-content,
.tooltip-wrapper:focus-within .tooltip-content {
  opacity: 1;
  visibility: visible;
}

/* Arrow indicator */
.tooltip-content::before {
  content: '';
  position: absolute;
  border: 5px solid transparent;
}

.tooltip-wrapper[data-tooltip-position="top"] .tooltip-content::before {
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-top-color: var(--gray-9);
}

.tooltip-wrapper[data-tooltip-position="bottom"] .tooltip-content::before {
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-bottom-color: var(--gray-9);
}

.tooltip-wrapper[data-tooltip-position="left"] .tooltip-content::before {
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  border-left-color: var(--gray-9);
}

.tooltip-wrapper[data-tooltip-position="right"] .tooltip-content::before {
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
  border-right-color: var(--gray-9);
}
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/components/shared/Tooltip.tsx src/styles/manager.css
git commit -m "feat: add Tooltip component with CSS-only hover/focus

- Create Tooltip component with position variants (top/bottom/left/right)
- Add aria-describedby for accessibility
- Use CSS transitions for smooth show/hide"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add Tooltips to Badge Component

**Files:**
- Modify: `src/components/shared/Badge.tsx`

**Step 1: Read current Badge component**

First, read the file to understand current structure.

**Step 2: Add tooltip support to Badge**

The Badge component needs optional tooltip text. When provided, wrap the badge in a Tooltip.

Modify `src/components/shared/Badge.tsx`:

```typescript
import { ComponentChildren } from 'preact';
import { Tooltip } from './Tooltip';

export type BadgeVariant =
  | 'temp'
  | 'permanent'
  | 'expiring'
  | 'guessed'
  | 'mute'
  | 'block'
  | 'mutual'
  | 'following'
  | 'follower'
  | 'info'
  | 'warning'
  | 'error'
  | 'success';

/** Tooltip text for badge variants that need explanation */
const BADGE_TOOLTIPS: Partial<Record<BadgeVariant, string>> = {
  temp: 'Temporary - will automatically expire at the scheduled time',
  permanent: 'Permanent - will not expire unless manually removed',
  expiring: 'Expiring soon - scheduled to be removed within 24 hours',
};

export interface BadgeProps {
  variant: BadgeVariant;
  class?: string;
  children: ComponentChildren;
  /** Override default tooltip text, or false to disable */
  tooltip?: string | false;
}

export function Badge({
  variant,
  class: className,
  children,
  tooltip,
}: BadgeProps): JSX.Element {
  const badgeElement = (
    <span class={`badge badge-${variant} ${className ?? ''}`}>{children}</span>
  );

  // Determine tooltip text: explicit prop > default > none
  const tooltipText = tooltip === false
    ? null
    : tooltip ?? BADGE_TOOLTIPS[variant] ?? null;

  if (tooltipText) {
    return (
      <Tooltip text={tooltipText} position="top">
        {badgeElement}
      </Tooltip>
    );
  }

  return badgeElement;
}
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/components/shared/Badge.tsx
git commit -m "feat: add automatic tooltips to Temp/Perm badges

- Import and use Tooltip component
- Add default tooltip text for temp, permanent, expiring variants
- Allow tooltip override or disable via prop"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Export Tooltip from Shared Components

**Files:**
- Modify: `src/components/shared/index.ts` (if exists) OR verify exports work

**Step 1: Check if index.ts exists**

Check if `src/components/shared/index.ts` exists. If it does, add Tooltip export.

**Step 2: Add export if barrel file exists**

If `src/components/shared/index.ts` exists, add:

```typescript
export { Tooltip } from './Tooltip';
export type { TooltipProps } from './Tooltip';
```

If no barrel file exists, imports will use direct paths which is fine.

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit (if changes made)**

```bash
git add src/components/shared/index.ts
git commit -m "chore: export Tooltip from shared components barrel"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Add Tooltips to Tab Names

**Files:**
- Modify: `src/components/manager/TabNav.tsx`

**Step 1: Read current TabNav component**

First, read the file to understand current structure.

**Step 2: Add tooltip text to tabs**

Modify `src/components/manager/TabNav.tsx` to add tooltips to each tab:

The TABS array needs tooltip text. Update the Tab type and TABS constant:

```typescript
import { Tooltip } from '../shared/Tooltip';

type Tab = {
  id: TabType;
  label: string;
  tooltip: string;
};

const TABS: Tab[] = [
  {
    id: 'actions',
    label: 'Blocks & Mutes',
    tooltip: 'View and manage all your blocked and muted accounts',
  },
  {
    id: 'amnesty',
    label: 'Amnesty',
    tooltip: 'Review old blocks to decide if they should be removed',
  },
  {
    id: 'blocklist-audit',
    label: 'Blocklist Audit',
    tooltip: 'Check for conflicts between your follows and blocklist subscriptions',
  },
  {
    id: 'repost-filters',
    label: 'Repost Filters',
    tooltip: 'Manage accounts whose reposts you\'ve hidden from your feed',
  },
  {
    id: 'mass-ops',
    label: 'Mass Ops',
    tooltip: 'Detect and undo patterns of rapid automated blocking',
  },
  {
    id: 'copy-user',
    label: 'Copy User',
    tooltip: 'Import another user\'s blocks or follows to your account',
  },
  {
    id: 'settings',
    label: 'Settings',
    tooltip: 'Configure ErgoBlock behavior and appearance',
  },
];
```

Then update the render to wrap tab buttons in Tooltip:

In the map function that renders tabs, wrap each tab button:

```typescript
{TABS.map((tab) => (
  <Tooltip key={tab.id} text={tab.tooltip} position="bottom">
    <button
      class={`tab ${activeTab.value === tab.id ? 'active' : ''}`}
      onClick={() => handleTabChange(tab.id)}
    >
      {tab.label}
    </button>
  </Tooltip>
))}
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add src/components/manager/TabNav.tsx
git commit -m "feat: add tooltips to manager tab navigation

- Add tooltip descriptions explaining each tab's purpose
- Helps new users understand what each tab does"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Add Tooltips to Popup Buttons and Stats

**Files:**
- Modify: `src/popup.tsx`

**Step 1: Read current popup structure**

First, read the file to understand current button and stats rendering.

**Step 2: Import Tooltip and add to popup elements**

Add import at top of `src/popup.tsx`:

```typescript
import { Tooltip } from './components/shared/Tooltip';
```

**Step 3: Add tooltip to "Expiring 24h" stat**

Find the stats section (around line 301-309) and wrap the expiring stat:

```typescript
<Tooltip text="Blocks and mutes that will expire in the next 24 hours" position="bottom">
  <div class="stat">
    <span class="stat-value">{expiring24h}</span>
    <span class="stat-label">Expiring 24h</span>
  </div>
</Tooltip>
```

**Step 4: Add tooltips to footer buttons**

Find the footer buttons section (around line 394-404) and add tooltips:

For "Check Now" button:
```typescript
<Tooltip text="Manually check for expired blocks/mutes and remove them" position="top">
  <button onClick={handleCheckNow} disabled={isChecking}>
    {isChecking ? 'Checking...' : 'Check Now'}
  </button>
</Tooltip>
```

For "Sync" button:
```typescript
<Tooltip text="Refresh data from your Bluesky account" position="top">
  <button onClick={handleSync} disabled={isSyncing}>
    {isSyncing ? 'Syncing...' : 'Sync'}
  </button>
</Tooltip>
```

**Step 5: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

**Step 6: Commit**

```bash
git add src/popup.tsx
git commit -m "feat: add tooltips to popup buttons and stats

- Explain 'Expiring 24h' stat meaning
- Describe 'Check Now' button action
- Describe 'Sync' button action"
```
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase Completion Checklist

- [ ] Tooltip component created with all position variants
- [ ] CSS styles added with proper hover/focus behavior
- [ ] Badge component auto-applies tooltips to Temp/Perm variants
- [ ] All 7 tab names have descriptive tooltips
- [ ] Popup "Check Now" and "Sync" buttons have tooltips
- [ ] Popup "Expiring 24h" stat has tooltip
- [ ] All builds pass
- [ ] All changes committed

**Done when:** Build succeeds with tooltip component and all high-priority tooltips applied.
