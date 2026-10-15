# ErgoBlock for Bluesky

A Chrome extension that adds temporary block and mute functionality to Bluesky's web interface. Blocks and mutes automatically expire after your chosen duration.

## Features

- **Temp Block** - Block a user for a set duration, then automatically unblock
- **Temp Mute** - Mute a user for a set duration, then automatically unmute
- **Duration options** - 1 hour, 6 hours, 12 hours, 24 hours, 3 days, or 1 week
- **Works everywhere** - Available in profile menus and post dropdown menus
- **Syncs across devices** - Uses Chrome sync storage to persist your temp blocks/mutes
- **Automatic expiration** - Background service worker handles unblocking/unmuting

## Installation

### For Developers (Build from Source)

1. Clone this repository:
   ```bash
   git clone https://github.com/PropterMalone/ergoblock.git
   cd ergoblock
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top right corner)
   - Click **Load unpacked**
   - Select the `dist` folder from this project

### For End Users

Pre-built releases will be available on the [Releases page](https://github.com/PropterMalone/ergoblock/releases) once published to the Chrome Web Store.

## Development

### Requirements

- **Node.js**: >= 22.0.0
- **Version Manager**: [fnm](https://github.com/Schniz/fnm) (recommended) or [nvm](https://github.com/nvm-sh/nvm).
- **Package Manager**: npm

### Setup

1. Install the correct Node version:
   ```bash
   fnm use  # or nvm use
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Scripts

- `npm run build`: Bundles the TypeScript source from `src/` into `dist/`.
- `npm run dev`: Watches for changes and rebuilds automatically.
- `npm test`: Runs the test suite using Vitest.
- `npm run lint`: Runs ESLint for code quality checks.
- `npm run format`: Formats code using Prettier.

## Installation (Development Mode)

1. Run `npm run build` to generate the `dist` folder.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `dist` folder in this repository.

## CI/CD and Releases

This project uses GitHub Actions for automated quality control and releases:
- **PR Checks**: Every Pull Request is checked for linting (ESLint), code formatting (Prettier), and test coverage (Vitest). All checks must pass before merging.
- **Versioning**: Bump `package.json` when preparing a release; trial and maintenance PRs can keep the current version.
- **Auto-Release**: Merging a new version to `main` creates a GitHub Release and submits builds to the Chrome and Firefox stores. Keeping the existing version skips release and submission.

## Usage

1. Go to [bsky.app](https://bsky.app) and log in.
2. Click the three-dot menu on any post or profile.
3. Select **Temp Mute...** or **Temp Block...**.
4. Choose your desired duration.
5. The user will be automatically unblocked/unmuted when the time expires.

## Post actions

Open **Post actions** in the manager, or choose it from a post's three-dot menu. Paste a Bluesky post URL or `at://` URI, explicitly choose **Quote authors**, **Reposters**, or **Likers**, then fetch accounts. Opening this page or fetching accounts never blocks or mutes anyone.

Review the fetched accounts and deselect anyone you want to exclude. Your own account is excluded when signed in; accounts you follow and accounts already blocked or muted for the chosen action are protected. If relationship checks are unavailable, ErgoBlock warns you, starts with nothing selected, and disables Select All. Select accounts individually only after checking them.

Choose block or mute and a duration: 1 hour, 24 hours, 7 days, 30 days, or Permanent. The confirmation names the audience, selected count, post, action and duration. **Permanent mutes and blocks do not expire**; remove them manually. Cancel the confirmation to make no changes.

Fetching is limited to 50 pages of up to 100 entries (at most 5,000 unique accounts). Repeated cursors or interrupted reads also produce an incomplete-list warning. Counts describe fetched accounts, not every account that may have engaged. Cancel fetch stops further reads after any in-flight request finishes and discards late results. Existing `?tab=quote-sweep&postUri=...` links still prefill the post; you must choose an audience before fetching.

Confirmed operations save a local per-account outcome record. **Stop after current request** leaves the remaining accounts untouched; closing the manager does not itself stop an operation. If the background worker restarts or an outcome cannot be saved reliably, the operation pauses for review rather than silently repeating uncertain requests. Account changes also stop further work. The history shows created, skipped, failed, uncertain, and unattempted accounts after you reopen the manager.

**Undo** is available only for unchanged blocks that the operation can identify as its own. Replaced, renewed, expired, or preexisting actions are not removed. Mutes remain recorded but require manual removal: they have no immutable identity that lets ErgoBlock distinguish an operation's mute from a later re-mute. Local storage bounds can limit a selection below 5,000 accounts; unresolved operation records are not silently discarded to make room.

## Manager

The primary sections are **Blocks & Mutes**, **Post actions**, and **Settings**. **Advanced** starts collapsed and contains Mass Ops and Copy User.

Use **Set block expiration** or **Set mute expiration** in Blocks & Mutes to add a timer to an existing permanent action. This tracks the existing action; it does not create a duplicate block or mute. QT Peek and delayed blocking remain available.

ErgoBlock no longer offers Amnesty, Blocklist Audit, Review Queue, repost hiding, automatic post-context capture, or later context/interaction searches. Bluesky provides native repost controls. Existing blocks, mutes, saved settings, and retired-feature data are not purged. Ordinary action history and previously saved post contexts remain exportable.

## Managing Active Temp Blocks/Mutes

Open **Blocks & Mutes** in the manager to see active actions and their expiration times. The **Expiration health** panel shows overdue counts, the last attempt and successful check, and any sign-in or recovery work that needs attention. Use **Check now** to retry.

Expiration is best effort, not a guaranteed wall-clock deadline. The browser must be running, connected, and able to use the intended Bluesky account. Older stored actions lack account ownership metadata, so a successful check does not establish coverage across accounts.

## How It Works

- **Source**: All code is written in TypeScript in the `src/` directory.
- **Bundling**: `esbuild` bundles the source into single-file entry points in `dist/`.
- **API**: Uses the Bluesky AT Protocol.
- **Storage**: Expiration times are stored in `chrome.storage.sync`.
- **Background**: A service worker (`background.ts`) checks for expired entries at the configured 1–10 minute interval and removes them when the browser, network, and session are available.

## Permissions

- **storage**: To save temp block/mute data.
- **alarms**: To schedule expiration checks.
- **notifications**: To notify you when an action expires.
- **host_permissions**: To interact with Bluesky's API (`bsky.app`).

## Troubleshooting

**Menu items don't appear:**
- Refresh the Bluesky page.
- Make sure you're on bsky.app (not other Bluesky clients).

**Auto-expiration not working:**
- Open the manager's Blocks & Mutes section, inspect Expiration health, and choose "Check now".
- Make sure you're logged into Bluesky in at least one tab.

**API errors:**
- Try logging out and back into Bluesky.
- The extension reads your session from Bluesky's localStorage.

## Development

### Running Tests

```bash
npm test              # Run tests once
npm test -- --coverage  # Run with coverage report
```

The project has 97.5% test coverage across all core functionality.

### Building

```bash
npm run build         # Build once
npm run dev          # Build and watch for changes
```

### Linting

```bash
npm run lint         # Check code quality
npm run format       # Format code with Prettier
```

## License

MIT
