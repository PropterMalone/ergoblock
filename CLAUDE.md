# ErgoBlock for Bluesky - Developer Guide

## Build Commands
- `npm install`: Install dependencies (uses `npm ci` in CI).
- `npm run build`: Bundle TS files to `dist/` (Manifest V3).
- `npm run dev`: Build and watch for changes.
- `npm test`: Run Vitest suite (smoke tests + storage logic).
- `npm run lint`: ESLint v9 checks.
- `npm run format`: Prettier formatting.

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

- **Checks**: Lint, Format, and Tests must pass on every PR.
- **Version Bump**: PRs are blocked unless `package.json` version is incremented.
- **Releases**: Merging to `main` with a new version automatically tags the repo and creates a GitHub Release with a production `.zip`.
