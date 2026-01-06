/**
 * Screenshot capture utility for ErgoBlock
 * Captures post context when blocking/muting from a post
 */

import html2canvas from 'html2canvas';
import type { ScreenshotData } from './types.js';
import { addScreenshot, getOptions } from './storage.js';

// Selectors for finding post containers
const POST_SELECTORS = [
  '[data-testid*="feedItem"]',
  '[data-testid*="postThreadItem"]',
  'article',
  '[data-testid*="post"]',
];

/**
 * Find the post container element from a clicked element
 */
export function findPostContainer(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;

  for (const selector of POST_SELECTORS) {
    const container = element.closest(selector);
    if (container) return container as HTMLElement;
  }

  return null;
}

/**
 * Find parent thread posts for context (up to 3 parents)
 */
export function findThreadContext(postContainer: HTMLElement): HTMLElement[] {
  const parents: HTMLElement[] = [];

  // Look for parent posts in thread view
  // Thread structure varies, but typically parents are siblings above
  let sibling = postContainer.previousElementSibling;
  while (sibling && parents.length < 3) {
    for (const selector of POST_SELECTORS) {
      if (sibling.matches(selector)) {
        parents.unshift(sibling as HTMLElement);
        break;
      }
    }
    sibling = sibling.previousElementSibling;
  }

  return parents;
}

/**
 * Extract post text from a post container
 */
function extractPostText(postContainer: HTMLElement): string | undefined {
  // Try various selectors for post text
  const textSelectors = [
    '[data-testid*="postText"]',
    '[data-testid="postContent"]',
    '.post-text',
    'p',
  ];

  for (const selector of textSelectors) {
    const el = postContainer.querySelector(selector);
    if (el?.textContent?.trim()) {
      return el.textContent.trim().slice(0, 500); // Limit to 500 chars
    }
  }

  return undefined;
}

/**
 * Extract post URL from a post container
 */
function extractPostUrl(postContainer: HTMLElement): string | undefined {
  // Look for a link to the post itself
  const postLink = postContainer.querySelector('a[href*="/post/"]') as HTMLAnchorElement | null;
  return postLink?.href;
}

/**
 * Generate a unique screenshot ID
 */
function generateScreenshotId(): string {
  return `ss_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Capture a screenshot of the post and optionally its thread context
 */
export async function capturePostScreenshot(
  postContainer: HTMLElement,
  handle: string,
  did: string,
  actionType: 'block' | 'mute',
  permanent: boolean
): Promise<ScreenshotData | null> {
  const options = await getOptions();

  if (!options.screenshotEnabled) {
    console.log('[ErgoBlock] Screenshot capture disabled');
    return null;
  }

  try {
    // Find thread context (parent posts)
    const threadContext = findThreadContext(postContainer);
    const elementsToCapture = [...threadContext, postContainer];

    console.log(`[ErgoBlock] Capturing screenshot with ${elementsToCapture.length} post(s)`);

    // Create a temporary container for capturing
    const tempWrapper = document.createElement('div');
    tempWrapper.style.cssText = `
      position: fixed;
      left: -9999px;
      top: 0;
      background: white;
      padding: 16px;
      max-width: 600px;
    `;

    // Clone elements into temp wrapper
    for (const el of elementsToCapture) {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.marginBottom = '8px';
      // Remove any interactive elements that might cause issues
      clone.querySelectorAll('button, [role="button"]').forEach((btn) => {
        (btn as HTMLElement).style.pointerEvents = 'none';
      });
      tempWrapper.appendChild(clone);
    }

    document.body.appendChild(tempWrapper);

    // Capture with html2canvas
    const canvas = await html2canvas(tempWrapper, {
      useCORS: true,
      allowTaint: true,
      scale: 1, // 1:1 scale to reduce size
      logging: false,
      backgroundColor: '#ffffff',
    });

    // Clean up temp wrapper
    document.body.removeChild(tempWrapper);

    // Convert to JPEG with quality setting
    const imageData = canvas.toDataURL('image/jpeg', options.screenshotQuality);

    // Extract metadata
    const postText = extractPostText(postContainer);
    const postUrl = extractPostUrl(postContainer);

    const screenshot: ScreenshotData = {
      id: generateScreenshotId(),
      imageData,
      handle,
      did,
      actionType,
      permanent,
      timestamp: Date.now(),
      postText,
      postUrl,
    };

    // Store the screenshot
    await addScreenshot(screenshot);

    console.log('[ErgoBlock] Screenshot captured and stored:', screenshot.id);
    return screenshot;
  } catch (error) {
    console.error('[ErgoBlock] Screenshot capture failed:', error);
    return null;
  }
}
