# Review Queue for External Blocks/Mutes Design

## Summary

The Review Queue feature addresses a gap in ErgoBlock's current workflow: when users block or mute accounts through Bluesky's native interface (mobile app, web outside the extension), those blocks lack the expiration metadata that ErgoBlock typically manages. This creates "orphaned" blocks that fall outside the extension's temporal blocking system.

The solution extends the existing sync mechanism to detect these external blocks during the 60-second background sync cycle. When the extension finds a block on the Bluesky server that doesn't exist in its own storage, it adds it to permanent storage with a `needsReview: true` flag. A new "Review Queue" tab in the manager UI surfaces these unreviewed items, allowing users to retroactively assign durations (converting them to temporary blocks with expiration), explicitly mark them as permanent (removing them from the queue), or dismiss them (leaving them in the queue for later review). The implementation follows ErgoBlock's established patterns: extending the `PermanentBlockMute` interface with optional review fields, using Preact signals for reactive state management, and offering both card-based (one-at-a-time) and table-based (bulk management) views.

## Definition of Done

**Primary deliverable:** New "Review Queue" tab in the manager UI that displays blocks and mutes created outside the extension (e.g., via Bluesky mobile app) and allows users to retroactively assign durations or mark them as permanent.

**Success criteria:**
- Review queue automatically populates with external blocks/mutes (detected via sync comparing Bluesky server state to extension records)
- Detection runs both on manager page load and periodically in background (every 60s via existing sync mechanism)
- Users can take three actions on unreviewed items:
  1. **Assign duration** → Creates temp block/mute entry with expiration, marks item as reviewed (keeps server-side block intact until expiration)
  2. **Mark as permanent** → Marks item as reviewed, keeps in permanent blocks/mutes storage
  3. **Dismiss** → No state change, item returns to queue on next visit
- Data model extends `PermanentBlockMute` interface with `needsReview?: boolean` and `source?: 'ergoblock' | 'external'` fields
- Review queue shows items where `needsReview === true`

**Key exclusions:**
- No changes to how temp blocks/mutes currently work
- No deletion of server-side blocks until temp duration expires (extension tracks expiration separately)
- No new storage buckets (uses existing `permanentBlocks`/`permanentMutes` with new fields)

## Glossary

- **AT Protocol**: The authenticated transfer protocol underlying Bluesky's decentralized social network, defining how clients interact with Personal Data Servers (PDS)
- **Background worker**: Chrome extension service worker that runs independently of web pages to handle periodic tasks like expiration checks and API synchronization
- **Bluesky**: Decentralized social network where ErgoBlock operates; users can block/mute via native app or third-party clients
- **CAR file**: Content Addressable aRchive format used by Bluesky to export user repository data (mentioned in existing codebase patterns)
- **Chrome local storage**: Persistent browser storage with no practical size limit, used for permanent blocks/mutes (distinct from sync storage)
- **Chrome sync storage**: Browser storage that synchronizes across devices where user is signed in, used for temporary blocks/mutes
- **Computed signal**: Preact reactive value derived from other signals that automatically updates when dependencies change
- **Content script**: JavaScript injected into Bluesky web pages to add ErgoBlock's UI elements (menu items, duration picker)
- **DID**: Decentralized Identifier, the unique user ID format in AT Protocol (e.g., `did:plc:xyz123`)
- **Grandfathered data**: Records created before a feature was implemented, preserved with undefined values rather than migrated
- **Manager UI**: Full-page extension interface (manager.html) for viewing and managing all blocks, mutes, and history
- **Manifest V3**: Chrome extension architecture requiring service workers instead of background pages
- **Open Props**: CSS design token system providing standardized variables for spacing, colors, typography
- **PDS**: Personal Data Server, the user's home server in Bluesky's decentralized architecture where blocks are stored
- **Preact**: Lightweight React alternative (3KB) used for ErgoBlock's UI components
- **Preact signals**: Fine-grained reactive state management library for Preact (imported from `@preact/signals`)
- **Sync cycle**: The 60-second interval when background worker fetches current blocks/mutes from Bluesky API to detect changes
- **Temporary block/mute**: ErgoBlock's core feature: blocks/mutes with configurable expiration times, stored separately from permanent ones

## Architecture

The Review Queue feature extends the existing sync and manager UI to support reviewing blocks/mutes created outside the extension (e.g., via Bluesky mobile app) and retroactively assigning durations.

**Data Model:**
- Extends `PermanentBlockMute` interface in `src/types.ts` with two optional fields:
  - `needsReview?: boolean` - true indicates unreviewed external block/mute
  - `source?: 'ergoblock' | 'external'` - explicit source tracking

**Detection Flow:**
- Background worker's `syncBlocks()` and `syncMutes()` functions in `src/background.ts` already fetch current blocks/mutes from Bluesky API every 60s
- When new blocks/mutes found on server that don't exist in `permanentBlocks`/`permanentMutes` storage → add with `needsReview: true`, `source: 'external'`
- Existing records preserve their `needsReview` and `source` values
- Grandfathered data (pre-feature blocks) have `needsReview: undefined` and don't appear in queue

**UI Architecture:**
- New tab: "Review Queue" in the `'review'` tab group alongside Amnesty and Blocklist Audit
- Component: `ReviewQueueTab.tsx` in `src/components/manager/`
- Hybrid view mode:
  - **Card view (default)**: One-at-a-time review similar to AmnestyTab, shows current index / total count
  - **Table view**: All items in sortable table with bulk selection, follows ActionsTable pattern
  - Toggle button switches between modes

**Action Flow:**
1. **Assign Duration**: Sends message to background worker → adds entry to `tempBlocks`/`tempMutes` with expiration, sets `needsReview: false` in permanent record, keeps server-side block intact
2. **Mark Permanent**: Sends message to background worker → sets `needsReview: false` and `source: 'ergoblock'` in permanent record
3. **Dismiss**: No storage changes, item removed from current view but stays in queue (returns on next visit)

**Message Handlers:**
- Two new message types in background worker: `ASSIGN_DURATION_TO_PERMANENT`, `MARK_PERMANENT_REVIEWED`
- Follow existing pattern from background.ts message listener
- Update storage atomically, broadcast changes to open tabs

## Existing Patterns

Investigation of ErgoBlock codebase revealed clear patterns this design follows:

**Tab Structure (from manager.tsx):**
- Tabs managed via `currentTab` signal from `src/signals/manager.ts`
- Tab content rendered via switch statement in `renderTabContent()`
- Tabs grouped for organization: Review Queue belongs in `'review'` group with Amnesty and Blocklist Audit

**Component Patterns:**
- **Card-based review**: AmnestyTab (`src/components/manager/AmnestyTab.tsx`) provides pattern for one-at-a-time review with action buttons and stats display
- **Table-based management**: ActionsTable (`src/components/manager/ActionsTable.tsx`) provides pattern for sortable tables with bulk selection and action buttons
- **Empty states**: FirstRunEmptyState and standard empty states with helpful hints

**State Management:**
- Preact signals (from `@preact/signals`) for reactive state
- All manager state in `src/signals/manager.ts`
- Computed values for derived state

**Storage Architecture:**
- `permanentBlocks` and `permanentMutes` stored in Chrome local storage as maps keyed by DID
- `tempBlocks` and `tempMutes` stored in Chrome sync storage
- Background sync runs every 60s via `EXPIRY_CHECK` alarm

**Styling:**
- CSS in `src/styles/manager.css`
- Uses Open Props design tokens and CSS variables
- Standard classes: `.action-btn`, `.danger`, `.badge-block`, `.badge-mute`

**No divergence from existing patterns** - this design extends current architecture without introducing new patterns.

## Implementation Phases

### Phase 1: Data Model Extension

**Goal:** Add review queue fields to type definitions and update storage interfaces

**Components:**
- `src/types.ts` - Add `needsReview?: boolean` and `source?: 'ergoblock' | 'external'` to `PermanentBlockMute` interface
- `src/storage.ts` - Update storage helper type signatures if needed
- Unit tests in `src/types.test.ts` - Verify new field handling

**Dependencies:** None (first phase)

**Done when:** TypeScript compilation succeeds, type tests pass for new fields

### Phase 2: Background Sync Detection

**Goal:** Modify sync logic to detect external blocks/mutes and set review flags

**Components:**
- `src/background.ts` - Update `syncBlocks()` and `syncMutes()` functions (lines 618-811) to set `needsReview: true` and `source: 'external'` for newly detected blocks/mutes
- Message handlers for `ASSIGN_DURATION_TO_PERMANENT` and `MARK_PERMANENT_REVIEWED` actions
- Unit tests in `src/background.test.ts` - Verify sync detection logic and message handlers

**Dependencies:** Phase 1 (type definitions exist)

**Done when:** Sync correctly identifies new external blocks/mutes, sets flags appropriately, message handlers update storage correctly, all tests pass

### Phase 3: Manager State and Signals

**Goal:** Add review queue state management to manager signals

**Components:**
- `src/signals/manager.ts` - Add computed signal for unreviewed items (filter `permanentBlocks`/`permanentMutes` where `needsReview === true`)
- View mode signal (`'card' | 'table'`)
- Current index signal (for card view navigation)
- Selection signals (for table view bulk actions)

**Dependencies:** Phase 2 (storage fields exist and populate)

**Done when:** Signals correctly compute unreviewed items, view mode toggles work, state updates reactively

### Phase 4: ReviewQueueTab Component (Card View)

**Goal:** Implement card-based review UI following AmnestyTab pattern

**Components:**
- `src/components/manager/ReviewQueueTab.tsx` - Card view with current item display, action buttons (duration options, "Keep Permanent", "Dismiss"), navigation (Previous/Next), stats display
- Component tests in `src/components/manager/ReviewQueueTab.test.tsx` - Verify card rendering, navigation, action button callbacks

**Dependencies:** Phase 3 (manager signals and state exist)

**Done when:** Card view renders correctly, navigation works, action buttons call handlers with correct params, component tests pass

### Phase 5: ReviewQueueTab Component (Table View)

**Goal:** Add table view with bulk selection following ActionsTable pattern

**Components:**
- `src/components/manager/ReviewQueueTab.tsx` - Table view with sortable columns (User, Type, Detected timestamp, Actions), checkbox selection, bulk action toolbar
- View toggle button in tab header
- Additional component tests - Verify table rendering, sorting, selection, view toggle

**Dependencies:** Phase 4 (card view component exists)

**Done when:** Table view renders all items, sorting works, bulk selection works, toggle preserves state, all component tests pass

### Phase 6: Manager Integration

**Goal:** Add Review Queue tab to manager UI and wire up callbacks

**Components:**
- `src/manager.tsx` - Add `'review-queue'` case to `renderTabContent()`, pass callbacks for actions and reload
- `src/components/manager/TabNav.tsx` - Add Review Queue tab metadata (id, label, tooltip, group)
- `src/styles/manager.css` - Add any Review Queue specific styles (if needed beyond existing classes)

**Dependencies:** Phase 5 (ReviewQueueTab component complete)

**Done when:** Review Queue tab appears in manager, loads data correctly, actions trigger background updates, UI refreshes after actions

### Phase 7: Empty States

**Goal:** Implement empty states for review queue

**Components:**
- `src/components/manager/ReviewQueueTab.tsx` - Add FirstRunEmptyState when no permanent blocks exist, standard empty state when all items reviewed, loading state
- Update `src/components/shared/FirstRunEmptyState.tsx` if needed to support `surface="review-queue"`

**Dependencies:** Phase 6 (tab integrated in manager)

**Done when:** Empty states render appropriately based on data state, helpful messaging guides users

### Phase 8: Integration Tests and Edge Cases

**Goal:** Test end-to-end workflows and edge cases

**Components:**
- Integration tests simulating external block detection and review workflow
- Edge case tests: dismiss and revisit, view mode toggle with state preservation, grandfathered data handling, dual block+mute for same user
- Coverage verification for all new code

**Dependencies:** Phase 7 (all features complete)

**Done when:** All integration tests pass, edge cases handled correctly, >95% test coverage achieved for new code, `npm run validate` passes

## Additional Considerations

**Grandfathered Data:**
Existing blocks/mutes created before this feature have `needsReview: undefined` and `source: undefined`. These will not appear in the review queue. The sync logic preserves undefined values rather than setting them to false, avoiding migration complexity.

**Storage Impact:**
Adding two optional fields to each `PermanentBlockMute` record has minimal storage overhead. Typical user with 100 permanent blocks adds ~400 bytes (2 booleans + 2 short strings per record). Chrome local storage has no practical limit for this scale.

**User Confusion Prevention:**
The "Dismiss" action explicitly does NOT mark items as reviewed - they return to the queue on next visit. This prevents accidental "I'll deal with this later" dismissals from hiding items permanently. Users must make an affirmative decision (assign duration or mark permanent) to remove from queue.
