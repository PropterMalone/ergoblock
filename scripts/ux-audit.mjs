/**
 * UX Audit Script - Launches browser with ErgoBlock extension loaded
 * and captures screenshots of all UI surfaces.
 *
 * Usage: node scripts/ux-audit.mjs [--login handle password]
 *
 * Options:
 *   --login handle password  Auto-login to Bluesky
 *   --screenshots-dir path   Directory to save screenshots (default: docs/ux-audit)
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

// Parse args
const args = process.argv.slice(2);
let loginHandle = null;
let loginPassword = null;
let screenshotsDir = path.join(__dirname, '..', 'docs', 'ux-audit');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--login' && args[i + 1] && args[i + 2]) {
    loginHandle = args[i + 1];
    loginPassword = args[i + 2];
    i += 2;
  } else if (args[i] === '--screenshots-dir' && args[i + 1]) {
    screenshotsDir = args[i + 1];
    i++;
  }
}

// Ensure screenshots directory exists
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function screenshot(page, name) {
  const filepath = path.join(screenshotsDir, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`  Screenshot: ${filepath}`);
  return filepath;
}

async function main() {
  console.log('=== ErgoBlock UX Audit ===\n');
  console.log('Extension path:', extensionPath);
  console.log('Screenshots dir:', screenshotsDir);
  console.log('');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 1280, height: 900 },
  });

  // Wait for service worker
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    console.log('Waiting for service worker...');
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  const extensionId = serviceWorker.url().split('/')[2];
  console.log('Extension ID:', extensionId);
  console.log('');

  const page = await context.newPage();

  // ===== 1. EXTENSION POPUP =====
  console.log('1. Capturing Extension Popup (empty state)...');
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('networkidle');
  await screenshot(page, '01-popup-empty');

  // ===== 2. MANAGER PAGE =====
  console.log('2. Capturing Manager Page (empty state)...');
  await page.goto(`chrome-extension://${extensionId}/manager.html`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await screenshot(page, '02-manager-empty');

  // Capture each tab
  const managerTabs = ['Blocks', 'Mutes', 'History', 'Amnesty', 'List Audit'];
  for (let i = 0; i < managerTabs.length; i++) {
    const tabName = managerTabs[i];
    try {
      await page.getByRole('tab', { name: tabName }).click();
      await page.waitForTimeout(300);
      await screenshot(page, `02-manager-tab-${tabName.toLowerCase().replace(' ', '-')}`);
    } catch (e) {
      console.log(`    Could not capture ${tabName} tab: ${e.message}`);
    }
  }

  // ===== 3. OPTIONS PAGE =====
  console.log('3. Capturing Options Page...');
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForLoadState('networkidle');
  await screenshot(page, '03-options');

  // ===== 4. BLUESKY INTEGRATION =====
  if (loginHandle && loginPassword) {
    console.log('4. Logging into Bluesky...');
    await page.goto('https://bsky.app');
    await page.waitForLoadState('networkidle');

    // Handle initial modal if present
    try {
      const signInLink = page.locator('text="Sign in"').first();
      if (await signInLink.isVisible({ timeout: 3000 })) {
        await signInLink.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // Modal might not be present
    }

    // Fill login form
    try {
      await page.fill('input[placeholder*="Username"], input[placeholder*="email"]', loginHandle);
      await page.fill('input[type="password"]', loginPassword);
      await page.click('button:has-text("Next")');
      await page.waitForTimeout(3000);
      console.log('  Logged in successfully');
    } catch (e) {
      console.log('  Login failed:', e.message);
    }

    // ===== 5. PROFILE MENU =====
    console.log('5. Capturing Profile Menu with ErgoBlock...');
    await page.goto('https://bsky.app/profile/bsky.app');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await screenshot(page, '04-profile-page');

    // Click the ... menu button
    try {
      const menuButton = page.locator('button[aria-label*="More options"], button[aria-label*="menu"]').first();
      await menuButton.click();
      await page.waitForTimeout(500);
      await screenshot(page, '05-profile-menu-open');
    } catch (e) {
      console.log('  Could not open profile menu:', e.message);
    }

    // ===== 6. POST MENU =====
    console.log('6. Capturing Post Menu with ErgoBlock...');
    await page.goto('https://bsky.app');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Find a post's menu button
    try {
      const postMenuButton = page.locator('button[aria-label*="Open post options"]').first();
      await postMenuButton.click();
      await page.waitForTimeout(500);
      await screenshot(page, '06-post-menu-open');
    } catch (e) {
      console.log('  Could not open post menu:', e.message);
    }

    // ===== 7. POPUP WITH DATA =====
    console.log('7. Re-capturing Popup (may have data now)...');
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await screenshot(page, '07-popup-with-session');
  } else {
    console.log('4. Skipping Bluesky integration (no login credentials provided)');
    console.log('   Use: node scripts/ux-audit.mjs --login handle password');
  }

  console.log('\n=== Audit Complete ===');
  console.log(`Screenshots saved to: ${screenshotsDir}`);
  console.log('\nBrowser will stay open for manual exploration.');
  console.log('Press Ctrl+C to close.\n');

  // Keep browser open
  await new Promise(() => {});
}

main().catch(console.error);
