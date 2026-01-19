# Publishing ErgoBlock to Browser Stores

## Ready-to-Upload Packages

```
packages/ergoblock-v1.13.0-chrome.zip   → Chrome Web Store
packages/ergoblock-v1.13.0-firefox.zip  → Firefox Add-ons (AMO)
```

To rebuild packages:
```bash
npm run build:chrome   # then zip dist/ folder
npm run build:firefox  # then zip dist/ folder
```

---

## Chrome Web Store Update

### If you already have the extension listed:

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click on **ErgoBlock for Bluesky**
3. Click **Package** tab → **Upload new package**
4. Upload `packages/ergoblock-v1.13.0-chrome.zip`
5. Go to **Store listing** tab and update:
   - Copy **Short Description** from `STORE_LISTING.md`
   - Copy **Detailed Description** from `STORE_LISTING.md`
   - (Optional) Add new screenshots showing Manager/Amnesty features
6. Click **Submit for review**

Review typically takes 1-3 business days.

---

## Firefox Add-ons (AMO) - New Listing

### One-time setup:

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Sign in with your Firefox account (or create one)
3. Click **Submit a New Add-on**

### Submission steps:

1. **Upload**: Select `packages/ergoblock-v1.13.0-firefox.zip`
2. **Compatibility**: Firefox Desktop (109.0+)
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
   - `screenshot-1-thread.png`
   - `screenshot-2-picker.png`
   - `screenshot-3-popup-mutes.png`
   - `screenshot-4-popup-history.png`
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

**Note**: Screenshots don't show the new v1.13.0 features (Manager, Amnesty, Mass Ops). Consider adding new screenshots if you want to showcase these.

---

## Privacy Policy

Both stores require a privacy policy URL. Use:
```
https://github.com/PropterMalone/ergoblock/blob/main/PRIVACY.md
```

Or link directly to the raw file:
```
https://raw.githubusercontent.com/PropterMalone/ergoblock/main/PRIVACY.md
```

---

## Quick Checklist

### Chrome Update
- [ ] Upload `packages/ergoblock-v1.13.0-chrome.zip`
- [ ] Update short description
- [ ] Update detailed description
- [ ] Submit for review

### Firefox New Listing
- [ ] Create AMO developer account
- [ ] Upload `packages/ergoblock-v1.13.0-firefox.zip`
- [ ] Fill in listing details from `STORE_LISTING.md`
- [ ] Upload at least 2 screenshots
- [ ] Set privacy policy URL
- [ ] Submit for review

---

## Future Updates

When releasing new versions:

1. Bump version in `package.json` (auto-syncs to manifests)
2. Commit and push
3. Run `npm run build:all`
4. Zip the `dist/` folder for each target
5. Upload to both stores
