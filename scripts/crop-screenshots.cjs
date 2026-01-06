const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const screenshotsDir = 'C:\\Users\\karls\\OneDrive\\Pictures\\Screenshots';
const outputDir = 'C:\\Users\\karls\\ergoblock\\screenshots';

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const screenshots = [
  {
    input: path.join(screenshotsDir, 'Screenshot 2026-01-04 160347.png'),
    output: path.join(outputDir, 'screenshot-1-menu.png'),
    name: 'Menu with Temp Block/Mute options'
  },
  {
    input: path.join(screenshotsDir, 'Screenshot 2026-01-04 160421.png'),
    output: path.join(outputDir, 'screenshot-2-duration.png'),
    name: 'Duration picker dialog'
  },
  {
    input: path.join(screenshotsDir, 'Screenshot 2026-01-04 160503.png'),
    output: path.join(outputDir, 'screenshot-3-popup.png'),
    name: 'Extension popup'
  }
];

async function cropScreenshots() {
  for (const screenshot of screenshots) {
    try {
      console.log(`Processing: ${screenshot.name}`);

      // Get image metadata
      const metadata = await sharp(screenshot.input).metadata();
      console.log(`  Original size: ${metadata.width}x${metadata.height}`);

      // Calculate crop region (center crop to 1280x800 aspect ratio, then resize)
      const targetWidth = 1280;
      const targetHeight = 800;
      const targetAspect = targetWidth / targetHeight;
      const sourceAspect = metadata.width / metadata.height;

      let cropWidth, cropHeight, cropLeft, cropTop;

      if (sourceAspect > targetAspect) {
        // Source is wider - crop width
        cropHeight = metadata.height;
        cropWidth = Math.round(cropHeight * targetAspect);
        cropTop = 0;
        cropLeft = Math.round((metadata.width - cropWidth) / 2);
      } else {
        // Source is taller - crop height
        cropWidth = metadata.width;
        cropHeight = Math.round(cropWidth / targetAspect);
        cropLeft = 0;
        cropTop = Math.round((metadata.height - cropHeight) / 2);
      }

      console.log(`  Cropping to: ${cropWidth}x${cropHeight} at (${cropLeft}, ${cropTop})`);

      await sharp(screenshot.input)
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .resize(targetWidth, targetHeight)
        .toFile(screenshot.output);

      console.log(`  Saved: ${screenshot.output}`);
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  console.log('\nDone! Screenshots saved to:', outputDir);
}

cropScreenshots();
