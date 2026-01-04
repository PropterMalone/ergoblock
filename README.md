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

1. Download and extract the extension files to a folder
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right corner)
4. Click **Load unpacked**
5. Select the extracted folder containing the extension files

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
- **PR Checks**: Every Pull Request is checked for linting, formatting, and test coverage.
- **Version Enforcement**: PRs must include a version bump in `package.json` to be merged.
- **Auto-Release**: Merging to `main` automatically creates a GitHub Release and attaches the extension zip if the version is new.

## Usage

1. Go to [bsky.app](https://bsky.app) and log in.
2. Click the three-dot menu on any post or profile.
3. Select **Temp Mute...** or **Temp Block...**.
4. Choose your desired duration.
5. The user will be automatically unblocked/unmuted when the time expires.

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

## License

MIT
