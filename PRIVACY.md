# Privacy Policy for ErgoBlock for Bluesky

**Last Updated:** January 4, 2026

## Overview

ErgoBlock for Bluesky is a browser extension that adds temporary block and mute functionality to Bluesky's web interface. This privacy policy explains what data the extension accesses and how it is used.

## Data Collection

**ErgoBlock does NOT collect, transmit, or store any personal data on external servers.** All data remains on your device and in your browser's sync storage.

## Data Storage

The extension stores the following data locally using Chrome's sync storage API:

- **Temporary block records**: Bluesky user handles (DIDs) you have temporarily blocked, along with expiration timestamps
- **Temporary mute records**: Bluesky user handles (DIDs) you have temporarily muted, along with expiration timestamps
- **Extension settings**: Your preferences for notification settings and default durations

This data syncs across your Chrome browsers if you are signed into Chrome, using Google's secure sync infrastructure. The extension developer has no access to this data.

## Bluesky Session Data

To perform block and unblock actions, the extension reads your active Bluesky session from your browser's local storage on bsky.app. This session data:

- Is only read locally from your browser
- Is never transmitted to any external servers
- Is only used to authenticate API calls to Bluesky's official servers (bsky.social)

## Permissions Explained

- **storage**: To save your temporary block/mute data and settings
- **alarms**: To schedule automatic expiration checks
- **host_permissions (bsky.app, bsky.social, bsky.network)**: To interact with Bluesky's website and API

## Third-Party Services

The extension communicates only with Bluesky's official API servers (bsky.social, bsky.network) to perform block, unblock, mute, and unmute actions. No data is sent to any other third parties.

## Data Retention

- Temporary block/mute records are automatically deleted when they expire
- You can clear all data at any time through the extension's options page
- Uninstalling the extension removes all locally stored data

## Children's Privacy

This extension is not directed at children under 13 and does not knowingly collect any information from children.

## Changes to This Policy

Any changes to this privacy policy will be posted on this page with an updated revision date.

## Contact

For questions about this privacy policy or the extension, please open an issue on the GitHub repository:
https://github.com/PropterMalone/ergoblock

## Open Source

ErgoBlock is open source software. You can review the complete source code at:
https://github.com/PropterMalone/ergoblock
