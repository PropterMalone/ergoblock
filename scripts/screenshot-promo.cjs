/**
 * Generate promo tile PNG using Puppeteer
 * Run with: node scripts/screenshot-promo.cjs
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function run() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 280 });

  const htmlPath = path.join(__dirname, '..', 'screenshots', 'promo-tile-440x280.html');
  await page.goto('file://' + htmlPath);

  const outputPath = path.join(__dirname, '..', 'screenshots', 'promo-tile-440x280.png');
  await page.screenshot({ path: outputPath });

  await browser.close();
  console.log('Created: ' + outputPath);
}

run().catch(console.error);
