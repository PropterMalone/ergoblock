# ErgoBlock for Bluesky - Developer Guide

## Build Commands
- `npm install`: Install dependencies (uses `npm ci` in CI).
- `npm run build`: Bundle TS files to `dist/` (Manifest V3).
- `npm run dev`: Build and watch for changes.
- `npm test`: Run Vitest suite (smoke tests + storage logic).
- `npm run lint`: ESLint v9 checks for `src/` and `scripts/`.
- `npm run format`: Prettier formatting for `src/`, `scripts/`, root files, and workflows.
- `npm run format:check`: Verify formatting without writing changes (used in CI).
- `npm run validate`: Run all checks (lint, type-check, format:check, tests). Use this before pushing.

## Quality Standards & Anti-Laziness Policy

- **Validation Required**: Agents MUST run `npm run validate` before declaring any task complete. This ensures linting, type-checking, formatting, and tests all pass.
- **No Error Suppression**: Never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or similar directives to hide warnings or errors. If a tool reports an issue, FIX the underlying cause.
- **Strict Typing**: Avoid using the `any` type. Define proper interfaces or types for all data structures. If an external API is unpredictable, use `unknown` and proper type guards.
- **No Silent Failures**: Ensure all errors are properly handled and logged. No empty `catch` blocks or suppressed exceptions.
- **Robust Automation**: Ensure all scripts in `scripts/` are robust, handle edge cases, and run without errors.
- **Clean Tests**: Tests should be reliable and properly mocked. Avoid flaky tests or tests that depend on global state without cleanup.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  src/content.tsx │────▶│  src/background  │────▶│  Bluesky API    │
│  (menu inject)   │     │  (expiration)    │     │  (AT Protocol)  │
└──────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│ platform/api.ts  │     │  chrome.storage  │
│  (API helpers)   │     │  (sync + local)  │
└──────────────────┘     └──────────────────┘
```

## Project Structure

- **src/**: Entry points (background.ts, content.tsx, manager.tsx, popup.tsx, options.tsx) + types.ts
- **src/domains/**: Business logic (bg handlers, CAR parsing, QT Peek, feed filtering)
- **src/platform/**: Browser/protocol abstractions (API, storage, caching, messages, utils)
- **src/ui/**: Preact components, hooks, signals, constants
- **src/__tests__/**: Test files
- **dist/**: Compiled extension (entry points: background.js, content.js, popup.js, options.js).
- **manifest.json**: Source manifest (bundled and modified into `dist/` during build).
- **scripts/**: Build and asset copy scripts.
- **.github/workflows/**: CI/CD (PR checks, Version enforcement, Auto-release).

## Key Technical Details

### AT Protocol API Endpoints

- **Repo operations** (blocks) go to user's PDS: `com.atproto.repo.*`
- **Graph operations** (mutes) go to user's PDS: `app.bsky.graph.*`
- **Profile lookups** go to public API: `https://public.api.bsky.app`
- **Post fetching** (QT Peek) goes to public API: `app.bsky.feed.getPosts` (no auth, max 25 URIs)

### Session Extraction (src/platform/api.ts)

Extracts Bluesky JWT from `localStorage`. Supports multiple storage patterns used by the Bluesky web app.

### Menu Injection (src/content.tsx)

Uses `MutationObserver` to detect when menus open (`[role="menu"]`). Tracks `lastClickedElement` to extract author handles from post containers. Also injects "Peek at quote" option when a concealed quote embed is detected (gated by `qtPeekEnabled` option).

### QT Peek (src/domains/qt-peek.ts)

Detects and resolves concealed (blocked/detached/deleted) quote embeds. Detection scans for placeholder text patterns in bordered containers. Resolution fetches the parent post via `FETCH_POSTS_PUBLIC` background message (routed to public API to bypass CORS), extracts the embed record, and fetches the quoted post if still hidden. Renders results via `PeekedQuote` component in a Shadow DOM for style isolation.

### Expiration Handling (src/background.ts)

- Sets a Chrome alarm (1 min interval).
- Checks `chrome.storage.sync` for expired timestamps.
- Syncs auth tokens from content scripts via `chrome.runtime.sendMessage`.
- Handles `FETCH_POSTS_PUBLIC` messages from content script to proxy public API calls (avoids CORS).

## CI/CD Pipeline

- **Checks**: Lint (ESLint), Format Check (`npm run format:check`), Type Check, and Tests (Vitest) must pass on every PR.
- **Coverage**: Test coverage results are posted directly to the GitHub Action **Step Summary** for each run.
- **Version Bump**: PRs are blocked unless `package.json` version is incremented.

## Versioning & Manifest Sync

- **Source of Truth**: The `version` in `package.json` is the authoritative version for the project.
- **Automation**: 
  - A `pre-commit` hook runs `npm run sync-version` (via `scripts/sync-version.js`) to keep the root `manifest.json` in sync with `package.json`.
  - The build script (`scripts/copy-assets.js`) also synchronizes the version into the `dist/manifest.json` during the build process.
- **Manual Action**: Only update the version in `package.json`. The rest is handled automatically on commit and build.

## Common Issues

### API 404 Errors
- Usually caused by wrong base URL or double slashes.
- Ensure PDS URL is normalized in `src/platform/api.ts` (no trailing slashes, has https://).

### Menu Items Not Appearing
- Check if `extractUserFromMenu()` in `src/content.tsx` is finding the user handle.
- For post menus, ensure `lastClickedElement` tracking is working.

### Auto-expiration Not Working
- Verify auth is synced to background via `syncAuthToBackground()`.
- Check background worker console (from `chrome://extensions`) for errors.

## Testing

1. Run `npm run build` to generate the `dist/` folder.
2. Load unpacked extension from `dist/` via `chrome://extensions/`.
3. Go to bsky.app and log in.
4. Open any profile or post menu.
5. Test temp block/mute with short durations (1 hour).
6. Check extension popup for active entries.
7. Use "Check Expirations Now" to manually trigger expiration check.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
