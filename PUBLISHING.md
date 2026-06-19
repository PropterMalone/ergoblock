# Publishing ErgoBlock to Browser Stores

## Chrome Web Store — Automated Publishing

The release workflow (`.github/workflows/release.yml`) automatically builds both Chrome and Firefox, creates a GitHub release with both zips, and uploads to both stores. Chrome is configured for **full auto-publish** (`publish:chrome` — uploads and submits for review). Change it back to `publish:chrome:upload` if you ever want a manual review gate before submission.

### One-Time OAuth Setup

You need a Google OAuth refresh token with Chrome Web Store API access.

1. **Enable the API**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project
   - Enable **Chrome Web Store API** under APIs & Services → Library

2. **Configure OAuth Consent Screen**
   - APIs & Services → OAuth consent screen
   - User type: **External**
   - Add your Google account email as a test user

3. **Create OAuth Credentials**
   - APIs & Services → Credentials → Create Credentials → **OAuth client ID**
   - Application type: **Web application**
   - Add authorized redirect URI: `https://developers.google.com/oauthplayground`
   - Save the **Client ID** and **Client Secret**

4. **Get a Refresh Token**
   - Go to [OAuth Playground](https://developers.google.com/oauthplayground)
   - Click the gear icon → check "Use your own OAuth credentials"
   - Enter your Client ID and Client Secret
   - In Step 1, enter scope: `https://www.googleapis.com/auth/chromewebstore`
   - Click "Authorize APIs" and grant access
   - In Step 2, click "Exchange authorization code for tokens"
   - Copy the **Refresh Token**

5. **Find Your Extension ID**
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Your extension ID is in the URL or listed on the extension detail page

> **⚠️ Publish the consent screen or the token expires every 7 days.** While
> the OAuth consent screen is in **Testing**, Google expires refresh tokens
> after 7 days — the publish step then fails with
> `Invalid grant: The authentication keys are probably invalid or expired`.
> Fix: [Google Auth Platform](https://console.cloud.google.com/apis/credentials/consent)
> → **Audience** → **Publish app** (Testing → In production) in the
> `ergoblock CWS` project, then mint a fresh refresh token via the OAuth
> Playground (step 4 above). In production, tokens don't expire. (In the newer
> "Google Auth Platform" UI the publish control lives under **Audience**, not a
> standalone consent-screen page.)

6. **Store the Credentials**

   For CI (GitHub Actions):
   - Go to your repo → Settings → Secrets and variables → Actions
   - Add these repository secrets:
     - `CWS_CLIENT_ID`
     - `CWS_CLIENT_SECRET`
     - `CWS_REFRESH_TOKEN`
     - `CWS_EXTENSION_ID`

   For local usage:
   - Copy `.env.example` to `.env` and fill in the values
   - `.env` is gitignored and will not be committed

### Manual CLI Usage

```bash
# Upload only (for review-first workflow)
npm run publish:chrome:upload

# Upload + publish immediately
npm run publish:chrome

# Specify a specific zip file
npm run publish:chrome -- packages/ergoblock-v1.15.0-chrome.zip
```

Without arguments, the script picks up the most recent `packages/ergoblock-v*-chrome.zip`.

### CI Behavior

The release workflow runs `publish:chrome` after creating the GitHub release — it uploads the new version to CWS **and submits it for review** (hands-off). Switch to `publish:chrome:upload` if you want to gate submission manually in the dashboard.

The publish step is conditional on `CWS_CLIENT_ID` being set, so it won't break builds if secrets aren't configured yet. Secrets are mapped at **job level** in the workflow — step-level env is invisible to a step's own `if` guard, so job-level is required for the conditional to fire.

---

## Chrome Web Store — Manual Update

### If you already have the extension listed:

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click on **ErgoBlock for Bluesky**
3. Click **Package** tab → **Upload new package**
4. Upload the chrome zip from `packages/`
5. Go to **Store listing** tab and update:
   - Copy **Short Description** from `STORE_LISTING.md`
   - Copy **Detailed Description** from `STORE_LISTING.md`
   - (Optional) Add new screenshots showing Manager/Amnesty features
6. Click **Submit for review**

Review typically takes 1-3 business days.

---

## Firefox Add-ons (AMO) — Automated Publishing

The release workflow automatically uploads new versions to AMO after creating a GitHub release. Listed submissions go into the review queue — AMO publishes automatically once approved.

### One-Time API Key Setup

AMO uses JWT auth (simpler than Chrome's OAuth) — just two static secrets.

1. Go to [AMO API Key page](https://addons.mozilla.org/en-US/developers/addon/api/key/)
2. Generate API credentials — you get a **JWT Issuer** and **JWT Secret**
3. **Store the Credentials**

   For CI (GitHub Actions):
   - Go to your repo → Settings → Secrets and variables → Actions
   - Add these repository secrets:
     - `AMO_JWT_ISSUER`
     - `AMO_JWT_SECRET`

   For local usage:
   - Copy `.env.example` to `.env` and fill in the values
   - `.env` is gitignored and will not be committed

### Manual CLI Usage

```bash
# Upload latest firefox zip from packages/
npm run publish:firefox

# Specify a specific zip file
npm run publish:firefox -- packages/ergoblock-v1.15.0-firefox.zip
```

Without arguments, the script picks up the most recent `packages/ergoblock-v*-firefox.zip`.

### CI Behavior

The release workflow runs `publish:firefox` after creating the GitHub release. This uploads the new version and creates a version entry on AMO, which enters the review queue.

The publish step is conditional on `AMO_JWT_ISSUER` being set, so it won't break builds if secrets aren't configured yet.

---

## Firefox Add-ons (AMO) — Manual Fallback

If automated publishing isn't set up, publish manually through the [AMO Developer Hub](https://addons.mozilla.org/developers/).

### First-time setup:

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Sign in with your Firefox account (or create one)
3. Click **Submit a New Add-on**

### Submission steps:

1. **Upload**: Select the firefox zip from `packages/`
2. **Compatibility**: Firefox Desktop (142.0+)
3. **Listing information**:
   - **Name**: ErgoBlock for Bluesky
   - **Summary**: Copy from `STORE_LISTING.md` → Firefox section (250 char max)
   - **Description**: Copy the Detailed Description from `STORE_LISTING.md`
   - **Categories**: Social & Communication
   - **Tags**: bluesky, block, mute, temporary, moderation
   - **License**: MIT
   - **Support email**: (your email)
   - **Support site**: https://github.com/PropterMalone/ergoblock
   - **Homepage**: https://github.com/PropterMalone/ergoblock
4. **Screenshots**: Upload from `screenshots/` folder (at least 2 required)
5. **Icon**: Will be pulled from manifest (128x128 in `dist/icons/`)
6. Click **Submit Version**

Firefox reviews are typically faster (often same day for updates).

---

## Screenshots

Located in `screenshots/` folder:

| File | Dimensions | Purpose |
|------|------------|---------|
| `promo-tile-440x280.png` | 440×280 | Chrome promotional tile |
| `screenshot-1-thread.png` | 1280×800 | Blocking from thread |
| `screenshot-2-picker.png` | 1280×800 | Duration picker |
| `screenshot-3-popup-mutes.png` | 1280×800 | Popup showing mutes |
| `screenshot-4-popup-history.png` | 1280×800 | Popup history view |
| `store-icon-128.png` | 128×128 | Store icon |

**Note**: Screenshots don't show features added since v1.13.0 (Review Queue, QT Peek, column config, tooltips). Consider adding new screenshots to showcase the Review Queue and updated Manager UI.

---

## Privacy Policy

Both stores require a privacy policy URL. Use:
```
https://github.com/PropterMalone/ergoblock/blob/main/PRIVACY.md
```

---

## Quick Checklist

### Chrome Update (Automated)
- [ ] Complete one-time OAuth setup (see above)
- [ ] Add secrets to GitHub repo
- [ ] Push version bump to main — CI handles the rest

### Chrome Update (Manual Fallback)
- [ ] Upload chrome zip from `packages/`
- [ ] Update short description
- [ ] Update detailed description
- [ ] Submit for review

### Firefox Update (Automated)
- [ ] Complete one-time API key setup (see above)
- [ ] Add secrets to GitHub repo
- [ ] Push version bump to main — CI handles the rest

### Firefox Update (Manual Fallback)
- [ ] Upload firefox zip from `packages/`
- [ ] Fill in listing details from `STORE_LISTING.md`
- [ ] Upload at least 2 screenshots
- [ ] Set privacy policy URL
- [ ] Submit for review

---

## Future Updates

When releasing new versions:

1. Bump version in `package.json` (auto-syncs to manifests)
2. Commit and push to main
3. CI builds, tests, tags, creates GitHub release, and uploads to CWS + AMO
4. Approve the CWS submission in the developer dashboard (or switch to auto-publish)
5. AMO submission enters review queue automatically
