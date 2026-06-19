# ErgoBlock for Bluesky - Project Summary

Last verified: 2026-05-06

## GitHub
All `gh` CLI operations use the **PropterMalone** account. Run `gh auth switch --user PropterMalone` before any public-facing `gh` command.

> **Maintainer Note**: Keep this file updated when adding features, changing architecture, or modifying key files. This reduces context loading for AI assistants. For detailed developer docs, see [AGENTS.md](AGENTS.md).

## Quick Reference

| Item | Value |
|------|-------|
| Version | 1.18.0 |
| Type | Chrome/Firefox Extension (Manifest V3) |
| Stack | TypeScript, Preact, esbuild |
| Node | >= 22.0.0 |

## What It Does

Temporary blocking and muting for Bluesky. Users can block/mute accounts for configurable durations (1h, 6h, 12h, 24h, 3d, 1w, or permanent), with automatic expiration handled by a background service worker.

### Key Features
- **Temp Block/Mute**: Configurable durations with auto-expiration
- **Quote Sweep (v1.18+)**: Fetch everyone who quote-posted a Bluesky post into a selectable grid (manager tab + in-page "Sweep quotes" post-menu item), then bulk temp-block/mute the selected accounts. Already-blocked accounts are marked and skipped; the bulk action is idempotent.
- **Unified create path (v1.18)**: All block/mute creation (popup, content script, Quote Sweep) routes through one hardened background primitive (quota pre-check → API → storage with rollback → read-back verification). Fixes intermittent "fails to take" failures, chiefly by adding session-token refresh (tab-first, then a direct `com.atproto.server.refreshSession` fallback when no Bluesky tab is open).
- **Popup as action-surface (v1.17+)**: Click extension on a Bluesky profile → block/mute with duration grid directly from popup
- **Post Context**: Captures which post triggered the action
- **Engagement Context**: Tracks when blocks originate from liked-by/reposted-by pages
- **Amnesty Tab**: Review old blocks (3+ months) to decide if they should continue
- **Blocklist Audit**: Find interactions between you and blocked users via CAR file parsing
- **Manager UI**: Full-page interface at manager.html for managing all blocks, mutes, and history
- **QT Peek**: Reveal concealed (blocked/detached) quoted posts via public API, rendered inline with Shadow DOM
- **Cross-Device Sync**: Uses Chrome sync storage
- **Column Configuration**: Table columns can be shown/hidden per user preference
- **First-Run Onboarding**: Actionable empty states for new users
- **Tip Jar (v1.18+)**: "Support ErgoBlock" Ko-fi link in the options + manager footers (`src/ui/constants/support.ts` centralizes the URL); `.github/FUNDING.yml` adds the repo Sponsor button

## Project Structure

```
ergoblock/
├── src/
│   ├── background.ts          # Entry point: service worker
│   ├── content.tsx            # Entry point: menu injection
│   ├── manager.tsx            # Entry point: full-page management UI
│   ├── popup.tsx              # Entry point: extension popup
│   ├── options.tsx            # Entry point: settings page
│   ├── types.ts               # Universal TypeScript interfaces
│   │
│   ├── domains/               # Business logic
│   │   ├── (bg handlers)      # amnesty, api-client, expiration, graph-ops, etc.
│   │   ├── carRepo.ts         # CAR file parsing
│   │   ├── carService.ts      # CAR download + caching orchestration
│   │   ├── clearskyService.ts # Clearsky API integration
│   │   ├── post-context.ts    # Post context capture
│   │   ├── qt-peek.ts         # QT Peek: concealed quote detection + resolution
│   │   ├── quote-sweep.ts     # Quote Sweep: fetch quoters of a post + bulk action
│   │   └── feed-filter.ts     # Feed filtering logic
│   │
│   ├── platform/              # Browser/protocol abstractions
│   │   ├── api.ts             # Bluesky AT Protocol wrapper
│   │   ├── browser.ts         # Chrome extension APIs
│   │   ├── messages.ts        # Message passing types + helpers
│   │   ├── storage.ts         # Storage barrel re-export
│   │   ├── storage/           # Storage submodules (keys, state, history, etc.)
│   │   ├── carCache.ts        # CAR file IndexedDB cache
│   │   ├── clearskyCache.ts   # Clearsky IndexedDB cache
│   │   ├── idb-helpers.ts     # IndexedDB utilities
│   │   └── utils.ts           # Shared utilities (retry, logging, formatting)
│   │
│   ├── ui/                    # All Preact/UI code
│   │   ├── components/
│   │   │   ├── shared/        # Button, Badge, Modal, Toast, Tooltip, etc.
│   │   │   ├── content/       # DurationPicker, ContentToast, PeekedQuote
│   │   │   └── manager/       # Tab components, tables, status indicators
│   │   ├── hooks/             # useBlocks, useMutes, useHistory, useOptions
│   │   ├── signals/           # Preact signals for manager state
│   │   └── constants/         # Centralized UI text (tooltips)
│   │
│   └── __tests__/             # test suite, 580 tests (colocated + __tests__)
├── dist/                      # Built extension (load this in browser)
├── scripts/                   # bundle.js, sync-version.js, copy-assets.js
├── manifest.json              # Chrome manifest
├── manifest.firefox.json      # Firefox manifest
└── .github/workflows/         # pr-checks.yml, release.yml
```

## Commands

```bash
npm run validate     # REQUIRED before pushing: lint + type-check + format + tests
npm run build        # Build for Chrome → dist/
npm run build:firefox
npm run dev          # Build with watch mode
npm test             # Run Vitest
npm run lint         # ESLint
npm run format       # Prettier
npm run sync-version # Sync package.json version to manifests (runs on pre-commit)
```

## Architecture

```
Content Script ──► Background Service Worker ──► Bluesky API (AT Protocol)
(menu inject)      (expiration, sync)            (PDS + public API)
    │                       │
    ▼                       ▼
 api.ts              chrome.storage.sync
```

### AT Protocol Endpoints
- **Repo operations** (blocks): User's PDS via `com.atproto.repo.*`
- **Graph operations** (mutes): User's PDS via `app.bsky.graph.*`
- **Profile lookups**: Public API at `https://public.api.bsky.app`
- **Post fetching** (QT Peek): Public API `app.bsky.feed.getPosts` (no auth, max 25 URIs)

### Key Mechanisms
- **Menu Injection**: MutationObserver detects `[role="menu"]` elements, injects duration picker
- **Expiration**: Chrome alarm fires every 60s, checks storage for expired timestamps
- **Auth Sync**: Content script extracts JWT from Bluesky's localStorage, syncs to background worker
- **Context Search**: Uses @atcute/car to parse user repos for finding interactions
- **QT Peek**: Detects concealed quote placeholders in DOM, resolves via public API through background worker (`FETCH_POSTS_PUBLIC` message), renders inline with Shadow DOM

## Quality Standards

- **Strict TypeScript**: No `any` types; use proper interfaces
- **No Error Suppression**: No `eslint-disable`, `@ts-ignore`, etc.
- **Run validate**: Always run `npm run validate` before completing tasks
- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`

## CI/CD

- **PR Checks**: lint, type-check, format-check, tests must pass
- **Auto-Release**: Merging to main with a bumped package.json version triggers GitHub release + store publish. No bump = no release (silently skipped).

## Versioning

- **Source of truth**: `package.json` version only
- **Auto-sync**: Pre-commit hook syncs to manifest.json via `npm run sync-version`

## Test Coverage

| File | Coverage | Notes |
|------|----------|-------|
| types.ts | 100% | Type guards and utilities |
| domains/carRepo.ts | ~91% | CAR file parsing |
| domains/post-context.ts | ~82% | Context capture |
| platform/storage.ts | ~70% | Storage helpers |
| platform/api.ts | ~47% | API wrapper |
| background.ts | ~15% | Service worker (complex, hard to test) |

## Common Issues

| Issue | Solution |
|-------|----------|
| API 404 errors | Check PDS URL normalization in platform/api.ts (no trailing slashes) |
| Menu items missing | Check extractUserFromMenu() and lastClickedElement tracking in content.tsx |
| Auto-expiration broken | Verify auth synced via syncAuthToBackground(); check background console |
| Version mismatch | Run `npm run sync-version` or commit to trigger pre-commit hook |

---

## Keeping This File Updated

When making changes to ErgoBlock, update this file:

1. **Version bump**: Update version in Quick Reference table
2. **New feature**: Add to "Key Features" list
3. **New key file**: Add to project structure with line count if significant
4. **Architecture change**: Update the architecture diagram
5. **New command**: Add to Commands section
6. **Coverage change**: Update test coverage table after significant test additions

This file should be the first thing read when starting work on ErgoBlock to minimize exploration time.
