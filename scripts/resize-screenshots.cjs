/**
 * Resize screenshots for Chrome Web Store
 * Screenshots: 1280x800
 * Promo tile: 440x280
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const screenshotsDir = path.join(__dirname, '..', 'screenshots');
const sourceDir = 'C:/Users/karls/OneDrive/Pictures/Screenshots';

// Source files (newest first based on timestamps)
const sources = [
  { src: 'Screenshot 2026-01-06 134106.png', dest: 'screenshot-1-thread.png', width: 1280, height: 800 },
  { src: 'Screenshot 2026-01-06 134120.png', dest: 'screenshot-2-picker.png', width: 1280, height: 800 },
  { src: 'Screenshot 2026-01-06 134139.png', dest: 'screenshot-3-popup-mutes.png', width: 1280, height: 800 },
  { src: 'Screenshot 2026-01-06 134206.png', dest: 'screenshot-4-popup-history.png', width: 1280, height: 800 },
  { src: 'Screenshot 2026-01-06 134422.png', dest: 'promo-tile-440x280.png', width: 440, height: 280 },
];

async function resize() {
  for (const { src, dest, width, height } of sources) {
    const srcPath = path.join(sourceDir, src);
    const destPath = path.join(screenshotsDir, dest);

    console.log(`Resizing ${src} -> ${dest} (${width}x${height})`);

    await sharp(srcPath)
      .resize(width, height, { fit: 'cover', position: 'center' })
      .png()
      .toFile(destPath);
  }

  console.log('\nDone! New screenshots:');
  fs.readdirSync(screenshotsDir).forEach(f => {
    const stat = fs.statSync(path.join(screenshotsDir, f));
    console.log(`  ${f} (${Math.round(stat.size / 1024)}KB)`);
  });
}

resize().catch(console.error);
