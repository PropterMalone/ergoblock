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

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  src/content.ts │────▶│  src/background  │────▶│  Bluesky API    │
│  (menu inject)  │     │  (expiration)    │     │  (AT Protocol)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐
│  src/api.ts     │     │  chrome.storage  │
│  (API helpers)  │     │  (sync + local)  │
└─────────────────┘     └──────────────────┘
```

## Project Structure

- **src/**: TypeScript source files.
- **dist/**: Compiled extension (entry points: background.js, content.js, popup.js, options.js).
- **manifest.json**: Source manifest (bundled and modified into `dist/` during build).
- **scripts/**: Build and asset copy scripts.
- **.github/workflows/**: CI/CD (PR checks, Version enforcement, Auto-release).

## Key Technical Details

### AT Protocol API Endpoints

- **Repo operations** (blocks) go to user's PDS: `com.atproto.repo.*`
- **Graph operations** (mutes) go to user's PDS: `app.bsky.graph.*`
- **Profile lookups** go to public API: `https://public.api.bsky.app`

### Session Extraction (src/api.ts)

Extracts Bluesky JWT from `localStorage`. Supports multiple storage patterns used by the Bluesky web app.

### Menu Injection (src/content.ts)

Uses `MutationObserver` to detect when menus open (`[role="menu"]`). Tracks `lastClickedElement` to extract author handles from post containers.

### Expiration Handling (src/background.ts)

- Sets a Chrome alarm (1 min interval).
- Checks `chrome.storage.sync` for expired timestamps.
- Syncs auth tokens from content scripts via `chrome.runtime.sendMessage`.

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
- Ensure PDS URL is normalized in `src/api.ts` (no trailing slashes, has https://).

### Menu Items Not Appearing
- Check if `extractUserFromMenu()` in `src/content.ts` is finding the user handle.
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
