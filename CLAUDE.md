# ErgoBlock for Bluesky - Project Summary

> **Maintainer Note**: Keep this file updated when adding features, changing architecture, or modifying key files. This reduces context loading for AI assistants. For detailed developer docs, see [AGENTS.md](AGENTS.md).

## Quick Reference

| Item | Value |
|------|-------|
| Version | 1.10.0 |
| Type | Chrome/Firefox Extension (Manifest V3) |
| Stack | TypeScript, Preact, esbuild |
| Node | >= 22.0.0 |

## What It Does

Temporary blocking and muting for Bluesky. Users can block/mute accounts for configurable durations (1h, 6h, 12h, 24h, 3d, 1w, or permanent), with automatic expiration handled by a background service worker.

### Key Features
- **Temp Block/Mute**: Configurable durations with auto-expiration
- **Post Context**: Captures which post triggered the action
- **Engagement Context**: Tracks when blocks originate from liked-by/reposted-by pages
- **Amnesty Tab**: Review old blocks (3+ months) to decide if they should continue
- **Blocklist Audit**: Find interactions between you and blocked users via CAR file parsing
- **Manager UI**: Full-page interface at manager.html for managing all blocks, mutes, and history
- **Cross-Device Sync**: Uses Chrome sync storage

## Project Structure

```
ergoblock/
├── src/
│   ├── background.ts      # Service worker: expiration checks, API calls, sync (711 lines)
│   ├── content.tsx        # Menu injection via MutationObserver (largest file)
│   ├── manager.tsx        # Full-page management UI
│   ├── popup.tsx          # Extension popup
│   ├── options.tsx        # Settings page
│   ├── api.ts             # Bluesky AT Protocol wrapper (330 lines)
│   ├── storage.ts         # Chrome storage helpers (165 lines)
│   ├── types.ts           # TypeScript interfaces (605 lines)
│   ├── post-context.ts    # Post context capture utilities
│   ├── carRepo.ts         # CAR file parsing for context search
│   ├── components/
│   │   ├── shared/        # Button, Badge, Modal, Toast, UserCell, EmptyState
│   │   ├── content/       # DurationPicker, ContentToast
│   │   └── manager/       # BlocksTable, MutesTable, HistoryTable, AmnestyTab, BlocklistAuditTab, etc.
│   ├── hooks/             # useBlocks, useMutes, useHistory, useOptions
│   ├── signals/           # Preact signals for manager state
│   └── __tests__/         # 8 test files, ~170 test cases
├── dist/                  # Built extension (load this in browser)
├── scripts/               # bundle.js, sync-version.js, copy-assets.js
├── manifest.json          # Chrome manifest
├── manifest.firefox.json  # Firefox manifest
└── .github/workflows/     # pr-checks.yml, release.yml, check-version.yml
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

### Key Mechanisms
- **Menu Injection**: MutationObserver detects `[role="menu"]` elements, injects duration picker
- **Expiration**: Chrome alarm fires every 60s, checks storage for expired timestamps
- **Auth Sync**: Content script extracts JWT from Bluesky's localStorage, syncs to background worker
- **Context Search**: Uses @atcute/car to parse user repos for finding interactions

## Quality Standards

- **Strict TypeScript**: No `any` types; use proper interfaces
- **No Error Suppression**: No `eslint-disable`, `@ts-ignore`, etc.
- **Run validate**: Always run `npm run validate` before completing tasks
- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`

## CI/CD

- **PR Checks**: lint, type-check, format-check, tests must pass
- **Version Enforcement**: PRs blocked unless package.json version incremented
- **Auto-Release**: Merging to main with new version triggers GitHub release

## Versioning

- **Source of truth**: `package.json` version only
- **Auto-sync**: Pre-commit hook syncs to manifest.json via `npm run sync-version`

## Test Coverage

| File | Coverage | Notes |
|------|----------|-------|
| types.ts | 100% | Type guards and utilities |
| carRepo.ts | ~91% | CAR file parsing |
| post-context.ts | ~82% | Context capture |
| storage.ts | ~70% | Storage helpers |
| api.ts | ~47% | API wrapper |
| background.ts | ~15% | Service worker (complex, hard to test) |

## Common Issues

| Issue | Solution |
|-------|----------|
| API 404 errors | Check PDS URL normalization in api.ts (no trailing slashes) |
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
