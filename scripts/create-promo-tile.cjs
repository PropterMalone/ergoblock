/**
 * Creates a 440x280 promotional tile for Chrome Web Store
 * Run with: node scripts/create-promo-tile.js
 */

const fs = require('fs');
const path = require('path');

// Create an HTML file that can be opened in browser and screenshot
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 440px;
      height: 280px;
      background: linear-gradient(135deg, #0085ff 0%, #0066cc 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: white;
      overflow: hidden;
    }
    .icon-container {
      width: 80px;
      height: 80px;
      background: white;
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    }
    .icon {
      font-size: 48px;
    }
    .title {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .tagline {
      font-size: 16px;
      opacity: 0.95;
      text-align: center;
      max-width: 380px;
      line-height: 1.4;
    }
    .features {
      display: flex;
      gap: 24px;
      margin-top: 20px;
      font-size: 13px;
      opacity: 0.9;
    }
    .feature {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  </style>
</head>
<body>
  <div class="icon-container">
    <span class="icon">⏱️</span>
  </div>
  <div class="title">ErgoBlock</div>
  <div class="tagline">Temporary block & mute for Bluesky</div>
  <div class="features">
    <div class="feature">⏰ Auto-expires</div>
    <div class="feature">🔄 Syncs across devices</div>
    <div class="feature">📋 History tracking</div>
  </div>
</body>
</html>`;

const outputPath = path.join(__dirname, '..', 'screenshots', 'promo-tile-440x280.html');
fs.writeFileSync(outputPath, html);

console.log('Created: ' + outputPath);
console.log('');
console.log('To create the PNG:');
console.log('1. Open the HTML file in Chrome');
console.log('2. Press F12 to open DevTools');
console.log('3. Press Ctrl+Shift+P and type "screenshot"');
console.log('4. Select "Capture full size screenshot"');
console.log('5. Rename the file to promo-tile-440x280.png');
console.log('');
console.log('Or use a headless browser:');
console.log('npx puppeteer screenshot ' + outputPath + ' --viewport 440x280');
