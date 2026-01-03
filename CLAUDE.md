# ErgoBlock for Bluesky - Developer Guide

## Project Overview

Chrome extension that adds temporary block and temporary mute functionality to Bluesky's web interface (bsky.app). Users can block/mute someone for a chosen duration, and the extension automatically unblocks/unmutes when the time expires.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  content.js     │────▶│  background.js   │────▶│  Bluesky API    │
│  (menu inject)  │     │  (expiration)    │     │  (AT Protocol)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐
│  api.js         │     │  chrome.storage  │
│  (API helpers)  │     │  (sync + local)  │
└─────────────────┘     └──────────────────┘
```

## File Structure

- **manifest.json** - Extension manifest (Manifest V3)
- **content.js** - Injected into bsky.app, handles menu injection and UI
- **background.js** - Service worker for alarm-based expiration checking
- **api.js** - AT Protocol API helpers (block, mute, unblock, unmute, getProfile)
- **storage.js** - Chrome storage helpers for temp blocks/mutes
- **popup.html/popup.js** - Extension popup showing active temp blocks/mutes
- **icons/** - Extension icons (16, 48, 128px)

## Key Technical Details

### AT Protocol API Endpoints

- **Repo operations** (blocks) go to user's PDS: `com.atproto.repo.*`
- **Graph operations** (mutes) go to user's PDS: `app.bsky.graph.*`
- **Profile lookups** go to public API: `https://public.api.bsky.app`

Users may be on different PDS servers (not just bsky.social). The PDS URL is extracted from the user's session in localStorage.

### Session Extraction

Bluesky stores session data in localStorage under keys containing "BSKY". The session structure varies, so api.js tries multiple patterns:
1. `storage.session.currentAccount` + `storage.session.accounts[]`
2. `storage.currentAccount` + `storage.accounts[]`
3. Direct `storage.accessJwt` + `storage.did`

### Menu Injection

content.js uses MutationObserver to detect when menus open (`[role="menu"]`). For post menus (rendered in portals), it tracks `lastClickedElement` to find the post container and extract the author's handle.

### Expiration Handling

- background.js sets a Chrome alarm that fires every minute
- On each alarm, it checks for expired temp blocks/mutes
- Auth token is synced from content.js to background via `chrome.runtime.sendMessage`
- Background worker makes API calls to unblock/unmute expired entries

### Storage

- **chrome.storage.sync** - Temp blocks/mutes data (syncs across devices)
- **chrome.storage.local** - Auth token for background worker

## Common Issues

### API 404 Errors
- Usually caused by wrong base URL or double slashes
- Ensure PDS URL is normalized (no trailing slashes, has https://)

### Menu Items Not Appearing
- Check if `extractUserFromMenu()` is finding the user handle
- For post menus, ensure `lastClickedElement` tracking is working

### Auto-expiration Not Working
- Verify auth is synced to background (`syncAuthToBackground()`)
- Check background worker console for errors
- Ensure `pdsUrl` is included in auth sync

## Testing

1. Load unpacked extension from `chrome://extensions/`
2. Enable Developer mode
3. Go to bsky.app and log in
4. Open any profile or post menu
5. Test temp block/mute with short durations (1 hour)
6. Check extension popup for active entries
7. Use "Check Expirations Now" to manually trigger expiration check

## Building for Distribution

```powershell
Compress-Archive -Path manifest.json, background.js, content.js, storage.js, api.js, popup.html, popup.js, icons, README.md -DestinationPath ergoblock.zip -Force
```

Do not include: resize-icons.ps1, CLAUDE.md, or any files with local paths.
