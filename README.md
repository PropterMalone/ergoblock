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
   git clone https://github.com/yourusername/ergoblock.git
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

Pre-built releases will be available on the [Releases page](https://github.com/yourusername/ergoblock/releases) once published to the Chrome Web Store.

## Usage

1. Go to [bsky.app](https://bsky.app) and log in
2. Click the three-dot menu on any post or profile
3. Select **Temp Mute...** or **Temp Block...**
4. Choose your desired duration
5. The user will be automatically unblocked/unmuted when the time expires

## Managing Active Temp Blocks/Mutes

Click the extension icon in Chrome's toolbar to see:
- All active temporary blocks with time remaining
- All active temporary mutes with time remaining
- Option to manually check expirations

## How It Works

- When you temp block/mute someone, the extension creates a normal block/mute via Bluesky's API
- The expiration time is stored in Chrome's sync storage
- A background service worker checks every minute for expired blocks/mutes
- When expired, it automatically calls the unblock/unmute API

## Permissions

- **storage** - To save temp block/mute data
- **alarms** - To schedule expiration checks
- **host_permissions** - To interact with Bluesky's API

## Troubleshooting

**Menu items don't appear:**
- Refresh the Bluesky page
- Make sure you're on bsky.app (not other Bluesky clients)

**Auto-expiration not working:**
- Open the extension popup and click "Check Expirations Now"
- Make sure you're logged into Bluesky in at least one tab

**API errors:**
- Try logging out and back into Bluesky
- The extension reads your session from Bluesky's localStorage

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
