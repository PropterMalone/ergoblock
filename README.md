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

## Managing Active Temp Blocks/Mutes

Click the extension icon in Chrome's toolbar to see:
- All active temporary blocks with time remaining.
- All active temporary mutes with time remaining.
- Option to manually check expirations.

## How It Works

- **Source**: All code is written in TypeScript in the `src/` directory.
- **Bundling**: `esbuild` bundles the source into single-file entry points in `dist/`.
- **API**: Uses the Bluesky AT Protocol.
- **Storage**: Expiration times are stored in `chrome.storage.sync`.
- **Background**: A service worker (`background.ts`) checks every minute for expired entries and handles unblocking.

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
- Open the extension popup and click "Check Expirations Now".
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
