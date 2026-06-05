# ErgoBlock Context Document

## Project Overview
Chrome/Firefox extension for temporary blocking/muting on Bluesky with automatic expiration.

## Tech Stack
- TypeScript (strict mode)
- esbuild bundler
- Vitest for testing
- Chrome Extension Manifest V3
- Bluesky AT Protocol API

## Key Files

### Core Logic
- `src/background.ts` - Service worker: handles alarms, API calls, expiration checks, sync
- `src/content.ts` - Content script: injects UI into bsky.app, intercepts block/mute actions
- `src/storage.ts` - Chrome storage helpers for blocks, mutes, history, contexts
- `src/api.ts` - Bluesky API wrapper (block, unblock, mute, unmute, getProfile)
- `src/types.ts` - TypeScript interfaces and constants

### UI
- `src/manager.ts` + `src/manager.html` - Full-page manager UI (blocks/mutes tables, history, export)
- `src/popup.ts` + `src/popup.html` - Extension popup (stats, expiring soon, recent activity)
- `src/options.ts` + `src/options.html` - Settings page

### Supporting
- `src/browser.ts` - Browser API compatibility layer (chrome vs browser)
- `src/post-context.ts` - Post context capture utilities

## Data Structures

### Storage Keys (chrome.storage.sync)
- `tempBlocks` - `Record<did, {handle, expiresAt, createdAt, rkey?}>`
- `tempMutes` - `Record<did, {handle, expiresAt, createdAt}>`
- `permanentBlocks` - `Record<did, {handle, displayName?, avatar?, syncedAt, rkey?}>`
- `permanentMutes` - `Record<did, {handle, displayName?, avatar?, syncedAt}>`
- `actionHistory` - `HistoryEntry[]` (last 100 actions)
- `postContexts` - `PostContext[]` (post that triggered block/mute)
- `options` - `ExtensionOptions`

### Key Types (src/types.ts)
```typescript
interface ManagedEntry {
  did: string; handle: string; displayName?: string; avatar?: string;
  source: 'ergoblock_temp' | 'ergoblock_permanent' | 'bluesky';
  type: 'block' | 'mute';
  expiresAt?: number; createdAt?: number; syncedAt?: number;
  rkey?: string; viewer?: ProfileViewerState;
}

interface PostContext {
  id: string; postUri: string; postAuthorDid: string;
  postText?: string; targetHandle: string; targetDid: string;
  actionType: 'block' | 'mute'; permanent: boolean;
  timestamp: number; guessed?: boolean;
}

interface HistoryEntry {
  did: string; handle: string;
  action: 'blocked' | 'unblocked' | 'muted' | 'unmuted';
  timestamp: number; trigger: 'manual' | 'auto_expire' | 'removed';
  success: boolean; error?: string;
}
```

## Manager UI Structure (manager.ts)

### State
- `allBlocks`, `allMutes`, `history`, `contexts` - Data arrays
- `currentTab` - 'blocks' | 'mutes' | 'history' | 'amnesty'
- `amnestyReviewedDids` - Set<did> of reviewed blocks
- `amnestyCandidate` - Current block being reviewed
- `sortColumn` - 'user' | 'source' | 'status' | 'expires' | 'date'
- `sortDirection` - 'asc' | 'desc'
- `selectedItems` - Set<did> for bulk operations
- `contextMap` - Map<did, PostContext> for inline context display

### Key Functions
- `loadData()` - Fetch all data from storage
- `renderCurrentTab()` - Render blocks/mutes/history table
- `renderBlocksTable()` / `renderMutesTable()` - Table with sortable headers
- `renderContextCell()` - Inline post context with Find/View buttons
- `getStatusIndicators()` - Text labels for viewer state (Blocking you, Following, etc.)
- `toggleSort()` / `getSortArrow()` - Column sorting
- `handleTempUnblockAndView()` - 60s temp unblock to view blocked user's post
- `handleFindContext()` - Search for interaction post (exhaustive search)

### Table Columns (Blocks/Mutes)
1. Checkbox (bulk select)
2. User (avatar, handle, display name) - sortable
3. Context (post text, Find/View buttons)
4. Source (Temp/Perm badge) - sortable
5. Status (text labels: Blocking you, Following, etc.)
6. Expires (time remaining) - sortable
7. Date (created/synced) - sortable
8. Actions (Unblock/Unmute button)

## Content Script Features (content.ts)

### Duration Picker
- Intercepts native block/mute menu clicks
- Shows duration options: 1h, 6h, 12h, 24h, 3d, 1w, Permanent
- Captures post context when blocking from a post

### Auth Sync
- Extracts session from Bluesky's localStorage
- Syncs to background for API calls

## Background Service Worker (background.ts)

### Message Handlers
- `BLOCK_USER`, `UNBLOCK_USER`, `MUTE_USER`, `UNMUTE_USER`
- `CHECK_NOW` - Run expiration check
- `SYNC_NOW` - Sync with Bluesky API
- `FIND_CONTEXT` - Search for block context post (exhaustive)
- `TEMP_UNBLOCK_FOR_VIEW`, `REBLOCK_USER` - Temp unblock flow

### Key Functions
- `checkExpirations()` - Process expired temp blocks/mutes
- `syncWithBluesky()` - Fetch current blocks/mutes from API
- `findBlockContextPost()` - Search user's posts via PDS for interactions

## Build Commands
```bash
npm run build          # Build for Chrome
npm run build:firefox  # Build for Firefox
npm run test           # Run tests
npm run lint           # ESLint
```

## Amnesty Feature (manager.ts)

### Purpose
Review old blocks and decide if they still deserve to be blocked. Presents random candidates one at a time for Tinder-style swipe decisions.

### Eligibility Criteria
- Block at least 3 months old (90 days)
- Target not blocking you back
- Not previously reviewed by Amnesty

### Key Functions
- `getAmnestyCandidates()` - Filter eligible blocks
- `selectRandomCandidate()` - Pick random candidate
- `renderAmnestyTab()` - Show intro or card
- `startAmnestyReview()` - Begin review, auto-search for context
- `handleAmnestyDecision()` - Process 👍 (unblock) or 👎 (keep)

### Storage
- `amnestyReviews` - `AmnestyReview[]` tracking decisions
- `AmnestyReview` type: `{did, handle, reviewedAt, decision: 'unblocked' | 'kept_blocked'}`

## Recent Changes (as of session)
- Merged Post Contexts into Blocks/Mutes tables (removed separate tab)
- Status column shows text labels instead of icons
- Added sortable column headers with Wikipedia-style arrows (↑↓⇅)
- Exhaustive search for Find Context (up to 100k posts)
- Container widened to 1400px
- Added Amnesty tab for reviewing old blocks
