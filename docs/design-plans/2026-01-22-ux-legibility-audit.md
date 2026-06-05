# ErgoBlock UX Legibility Audit

## Summary

Analysis of ErgoBlock's user interface from a new user's perspective (familiar with Bluesky, unfamiliar with ErgoBlock). Identifies 5 categories of legibility issues across 10 UI surfaces and proposes improvements using visual grouping and tooltip-based explanations.

## Definition of Done

Produce a written analysis identifying legibility issues for new users across all UI surfaces, plus concrete improvement proposals for each identified issue. No code changes in this phase - analysis and proposals only.

## Glossary

| Term | Definition |
|------|------------|
| Legibility | How easily a new user can understand what UI elements do and how to use them |
| Visual grouping | Organizing related items visually to show relationships |
| Tooltip | Explanatory text that appears on hover/tap |
| Empty state | What the UI shows when there's no data to display |
| Progressive disclosure | Revealing complexity gradually as users need it |

---

## Architecture

### UI Surfaces Analyzed

| Surface | Entry Point | Primary Purpose |
|---------|-------------|-----------------|
| Extension Popup | Click extension icon | Quick status view |
| Duration Picker | Bluesky menu injection | Select block/mute duration |
| Manager: Blocks & Mutes | manager.html | View and manage all blocks/mutes |
| Manager: Amnesty | Tab | Review old blocks for possible removal |
| Manager: Blocklist Audit | Tab | Check for conflicts with list subscriptions |
| Manager: Repost Filters | Tab | Manage users whose reposts are hidden |
| Manager: Mass Ops | Tab | Detect and undo automated block patterns |
| Manager: Copy User | Tab | Import another user's blocks/follows |
| Manager: Settings | Tab | Configure extension behavior |
| Options Page | Browser extension settings | Simplified settings access |

### Design Approach

Based on user preference:
- **Visual grouping**: Keep all features visible but organize into clear categories
- **Tooltips only**: Clean UI, explanations appear on hover/tap (no inline subtitles)

---

## Existing Patterns

### Current UI Patterns in ErgoBlock

| Pattern | Where Used | Evaluation |
|---------|------------|------------|
| Tab navigation | Manager page | Good structure, but all tabs equally prominent |
| Stats bar | Popup, Manager | Good at-a-glance summary |
| Data tables | Blocks & Mutes tab | Comprehensive but overwhelming (10 columns) |
| Card view | Amnesty tab | Better for review workflows |
| Empty states | All surfaces | Present but lack actionable guidance |
| Badges (Temp/Perm) | Tables, popup | Useful but undefined |

### Patterns to Adopt

| Pattern | Purpose | Application |
|---------|---------|-------------|
| Tab grouping | Visual hierarchy | Separate "Core", "Review", "Advanced" tabs |
| Tooltip system | On-demand explanation | Add to all jargon terms |
| First-run state | Onboarding | Different empty state for first-time users |
| Actionable empty states | Guide to action | Tell users HOW to create blocks/mutes |

---

## Legibility Issues Analysis

### Issue 1: No Onboarding Context

**Current state**: Users see empty data interfaces with no explanation of what ErgoBlock does.

**Affected surfaces**:
- Extension Popup (empty state)
- Manager: Blocks & Mutes (empty state)

**Evidence**:
- Popup shows "0 BLOCKS, 0 MUTES, 0 EXPIRING 24H" without explaining what these mean
- Manager shows "No blocks or mutes found" without explaining how to create one
- No indication that blocks/mutes are created on Bluesky, not in the extension

**Impact**: Users don't understand the extension's purpose or how to use it.

**Proposal 1.1**: First-run empty state

When storage is completely empty (first install), show a different empty state:

```
Welcome to ErgoBlock!

This extension lets you temporarily block or mute people on Bluesky.
Blocks and mutes you create will automatically expire after the time you choose.

To get started:
1. Go to bsky.app and find someone's profile
2. Click the ... menu
3. Choose "Block" or "Mute" - you'll see duration options
```

After the first block/mute, switch to the standard empty state.

**Proposal 1.2**: Add tooltip to "Open Full Manager" explaining what the manager shows.

---

### Issue 2: Undefined Jargon

**Current state**: Domain-specific terms used without explanation.

**Terms requiring tooltips**:

| Term | Where Used | Tooltip Text |
|------|------------|--------------|
| Temp | Badges, filters | "Temporary - will automatically expire at the scheduled time" |
| Perm | Badges, filters | "Permanent - will not expire unless manually removed" |
| Amnesty | Tab, column | "Review old blocks to decide if they should be removed" |
| Blocklist | Tab, audit | "A shared list of blocked accounts you can subscribe to" |
| Mass Ops | Tab | "Detect patterns of rapid automated blocking" |
| Last Word | Settings, picker | "Block after a delay so you can send a final reply first" |
| PDS | Settings | "Personal Data Server - where your Bluesky data is stored" |
| CAR | Cache status | "Content Addressable Repository - a data export format" |
| Context | Column | "The post or situation that triggered this block/mute" |
| Source | Column | "Where this block/mute came from - ErgoBlock (temporary) or native Bluesky (permanent)" |
| Expiring 24h | Stats | "Blocks and mutes that will expire in the next 24 hours" |
| Check Now | Button | "Manually check for expired blocks/mutes and remove them" |
| Sync | Button | "Refresh data from your Bluesky account" |

**Proposal 2.1**: Implement tooltip system

Add a reusable `<Tooltip>` component that:
- Shows on hover (desktop) / tap (mobile)
- Has consistent styling across all surfaces
- Uses aria-describedby for accessibility

**Proposal 2.2**: Add tooltips to all jargon terms listed above

---

### Issue 3: Flat Tab Hierarchy

**Current state**: All 7 manager tabs are equally prominent.

**Tab list**: Blocks & Mutes, Amnesty, Blocklist Audit, Repost Filters, Mass Ops, Copy User, Settings

**Problem**:
- New users see advanced features (Mass Ops, Copy User) alongside basic features
- No indication of which tabs are commonly used vs. specialized
- Tab names alone don't explain purpose

**Proposal 3.1**: Visual tab grouping

Organize tabs into visual groups with subtle separators:

```
[Blocks & Mutes] | [Amnesty] [Blocklist Audit] | [Repost Filters] [Mass Ops] [Copy User] | [Settings]
 ↑ Core           ↑ Review                      ↑ Advanced                               ↑ Config
```

Implementation:
- Add visual separator (|, increased margin, or subtle line) between groups
- First tab ("Blocks & Mutes") is the only one in "Core" - emphasizes it's the main view
- "Review" group: features for reconsidering past decisions
- "Advanced" group: power-user features
- "Settings" standalone at the end

**Proposal 3.2**: Add tooltips to tab names

Each tab should have a tooltip explaining its purpose:

| Tab | Tooltip |
|-----|---------|
| Blocks & Mutes | "View and manage all your blocked and muted accounts" |
| Amnesty | "Review old blocks to decide if they should be removed" |
| Blocklist Audit | "Check for conflicts between your follows and blocklist subscriptions" |
| Repost Filters | "Manage accounts whose reposts you've hidden from your feed" |
| Mass Ops | "Detect and undo patterns of rapid automated blocking" |
| Copy User | "Import another user's blocks or follows to your account" |
| Settings | "Configure ErgoBlock behavior and appearance" |

---

### Issue 4: Overwhelming Data Table

**Current state**: Blocks & Mutes table has 10 columns by default.

**Columns**: Checkbox, User, Type, Context, Source, Status, Amnesty, Expires, Date, Actions

**Problems**:
- "Amnesty" column is advanced - shows "Unreviewed", "Denied", "Granted" but most users won't understand
- "Status" column shows block relationship ("They block you", "Mutual") - advanced info
- "Context" column often empty, takes space
- Mobile experience would be poor

**Proposal 4.1**: Reorder columns by importance

Move most-needed columns left:
1. Checkbox
2. User
3. Type (Block/Mute)
4. Expires
5. Source
6. Date
7. Context (if present)
8. Status
9. Amnesty
10. Actions

**Proposal 4.2**: Add column visibility settings

In Settings tab, add "Table Columns" section:
```
Show these columns in the Blocks & Mutes table:
[x] User (always shown)
[x] Type
[x] Expires
[x] Source
[x] Date
[ ] Context (when available)
[ ] Status (block relationship)
[ ] Amnesty status
```

Default: User, Type, Expires, Source, Date, Actions
Advanced users can enable Context, Status, Amnesty

---

### Issue 5: Non-Actionable Empty States

**Current state**: Empty states describe the state but don't guide users to action.

**Affected surfaces and current messages**:

| Surface | Current Message |
|---------|-----------------|
| Popup: Expiring Soon | "Nothing expiring soon" |
| Popup: Recent Activity | "No recent activity" |
| Manager: Blocks & Mutes | "No blocks or mutes found - You haven't blocked or muted anyone yet, or try adjusting your filters." |
| Manager: Amnesty | "No candidates available" |
| Manager: Blocklist Audit | "You don't subscribe to any blocklists" |
| Manager: Repost Filters | "No repost filters active" |
| Manager: Mass Ops | "No clusters detected" |

**Proposal 5.1**: Add action hints to empty states

| Surface | Improved Message |
|---------|------------------|
| Manager: Blocks & Mutes | "No blocks or mutes yet. To block or mute someone, go to their profile on Bluesky and click the ... menu." |
| Manager: Blocklist Audit | "You don't subscribe to any blocklists. Blocklists are shared lists of accounts - you can find them in Bluesky's Moderation settings." |
| Manager: Repost Filters | "No repost filters active. To hide someone's reposts, go to their profile on Bluesky and click the ... menu." |

**Proposal 5.2**: First-run detection

Track whether user has ever created a block/mute. If not, show enhanced onboarding version of empty states (per Proposal 1.1).

---

## Additional Considerations

### Accessibility

- All tooltips must use `aria-describedby`
- Tab grouping separators must not break keyboard navigation
- Column reordering must maintain logical tab order

### Mobile/Responsive

- Tooltips should work on tap (not just hover)
- Consider touch-friendly tooltip dismiss (tap outside)
- Table column hiding is especially important on mobile

### Internationalization

- Tooltip text will need translation
- Empty state messages will need translation
- Keep tooltip text concise for translation efficiency

### Future Improvements (Out of Scope)

These were considered but are out of scope for this design:

1. **Interactive tutorial**: Step-by-step walkthrough of features
2. **Video onboarding**: Embedded tutorial video
3. **Simplified mode**: Completely different UI for casual users
4. **Help documentation**: Full help pages (could link from tooltips)

---

## Implementation Phases

### Phase 1: Tooltip Infrastructure

Add tooltip component and apply to highest-impact jargon:
- Temp/Perm badges
- Tab names (all 7)
- "Check Now" and "Sync" buttons in popup
- "Expiring 24h" stat

Files affected:
- New: `src/components/shared/Tooltip.tsx`
- Modified: `src/components/manager/TabNav.tsx`
- Modified: `src/popup.tsx`
- Modified: `src/components/shared/Badge.tsx`

### Phase 2: Tab Visual Grouping

Add visual separators between tab groups:
- Core: Blocks & Mutes
- Review: Amnesty, Blocklist Audit
- Advanced: Repost Filters, Mass Ops, Copy User
- Config: Settings

Files affected:
- Modified: `src/components/manager/TabNav.tsx`
- Modified: `src/styles/manager.css` (or equivalent)

### Phase 3: Actionable Empty States

Update empty state messages to guide users to action:
- First-run detection in storage
- Enhanced onboarding empty state
- Standard empty states with action hints

Files affected:
- Modified: `src/storage.ts` (add first-run flag)
- Modified: `src/components/manager/EmptyState.tsx`
- Modified: `src/popup.tsx`
- Modified: `src/components/manager/ActionsTable.tsx`

### Phase 4: Table Column Configuration

Add column visibility settings:
- Settings UI for column selection
- Apply visibility to table
- Persist preference in storage

Files affected:
- Modified: `src/components/manager/SettingsTab.tsx`
- Modified: `src/components/manager/ActionsTable.tsx`
- Modified: `src/storage.ts` (add column visibility setting)
- Modified: `src/types.ts` (add column visibility type)

### Phase 5: Remaining Tooltips

Add tooltips to remaining jargon:
- All terms listed in Issue 2
- Settings page labels
- Duration picker explanations

Files affected:
- Modified: `src/components/content/DurationPicker.tsx`
- Modified: `src/components/manager/SettingsTab.tsx`
- Modified: `src/options.tsx`
- Modified: Various manager tab components
