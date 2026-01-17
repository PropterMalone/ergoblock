/**
 * Feed filtering for repost control
 * Hides reposts from specific users in the home feed
 */

import browser from './browser.js';
import { getRepostFilteredUsers, STORAGE_KEYS } from './storage.js';

// Selectors for feed elements
const FEED_SELECTORS = {
  // Feed container on home page
  FEED_CONTAINER: '[data-testid="followingFeedPage"], [data-testid="customFeedPage"], main',
  // Individual feed items
  FEED_ITEM: '[data-testid*="feedItem"]',
  // Repost indicator text (contains "Reposted by @handle")
  REPOST_INDICATOR: '[data-testid="repostedBy"]',
};

// Cache for filtered handles (lowercase for comparison)
let filteredHandles: Set<string> = new Set();
let feedObserver: MutationObserver | null = null;
let isObserving = false;

/**
 * Load filtered handles from storage into memory cache
 */
async function loadFilteredHandles(): Promise<void> {
  const users = await getRepostFilteredUsers();
  filteredHandles = new Set(Object.values(users).map((user) => user.handle.toLowerCase()));
}

/**
 * Extract reposter handle from a feed item
 * Returns null if the item is not a repost
 */
function extractReposterHandle(feedItem: Element): string | null {
  // Look for repost indicator
  const repostIndicator = feedItem.querySelector(FEED_SELECTORS.REPOST_INDICATOR);
  if (!repostIndicator) return null;

  // The repost indicator contains a link to the reposter's profile
  const profileLink = repostIndicator.querySelector('a[href*="/profile/"]') as HTMLAnchorElement;
  if (profileLink) {
    const match = profileLink.href.match(/\/profile\/([^/?#]+)/);
    if (match) {
      return match[1];
    }
  }

  // Fallback: try to extract from text content
  const text = repostIndicator.textContent || '';
  // Pattern: "Reposted by @handle" or just the handle
  const textMatch = text.match(/@?([a-zA-Z0-9._-]+(?:\.[a-zA-Z0-9._-]+)*)/);
  if (textMatch) {
    return textMatch[1];
  }

  return null;
}

/**
 * Apply filtering to a single feed item
 */
function filterFeedItem(feedItem: Element): boolean {
  const reposterHandle = extractReposterHandle(feedItem);
  if (!reposterHandle) return false;

  if (filteredHandles.has(reposterHandle.toLowerCase())) {
    (feedItem as HTMLElement).style.display = 'none';
    feedItem.setAttribute('data-ergoblock-filtered', 'repost');
    return true;
  }
  return false;
}

/**
 * Remove filtering from a feed item (for when user removes filter)
 */
function unfilterFeedItem(feedItem: Element): void {
  if (feedItem.getAttribute('data-ergoblock-filtered') === 'repost') {
    (feedItem as HTMLElement).style.display = '';
    feedItem.removeAttribute('data-ergoblock-filtered');
  }
}

/**
 * Scan and filter all visible feed items
 */
function filterAllFeedItems(): number {
  const feedItems = document.querySelectorAll(FEED_SELECTORS.FEED_ITEM);
  let filteredCount = 0;

  for (const item of feedItems) {
    if (filterFeedItem(item)) {
      filteredCount++;
    }
  }

  return filteredCount;
}

/**
 * Unfilter all feed items (re-show hidden items)
 */
function unfilterAllFeedItems(): void {
  const feedItems = document.querySelectorAll(
    `${FEED_SELECTORS.FEED_ITEM}[data-ergoblock-filtered="repost"]`
  );
  for (const item of feedItems) {
    unfilterFeedItem(item);
  }
}

/**
 * Check if we're on a page that should have feed filtering
 */
function isFilterableFeedPage(): boolean {
  const path = window.location.pathname;
  // Home feed, following feed, custom feeds
  return path === '/' || path === '/home' || path.startsWith('/feed/');
}

/**
 * Start observing the feed for new items
 */
function startObserving(): void {
  if (isObserving || !isFilterableFeedPage()) return;

  // Find the feed container
  const feedContainer = document.querySelector(FEED_SELECTORS.FEED_CONTAINER);
  if (!feedContainer) {
    // Retry after a delay if container not found
    setTimeout(startObserving, 1000);
    return;
  }

  // Initial scan
  const initialCount = filterAllFeedItems();
  if (initialCount > 0) {
    console.log(`[ErgoBlock] Filtered ${initialCount} reposts from feed`);
  }

  // Set up mutation observer for new feed items
  feedObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const element = node as Element;

        // Check if this is a feed item
        if (element.matches?.(FEED_SELECTORS.FEED_ITEM)) {
          filterFeedItem(element);
        }

        // Check children for feed items
        const childItems = element.querySelectorAll?.(FEED_SELECTORS.FEED_ITEM);
        if (childItems) {
          for (const item of childItems) {
            filterFeedItem(item);
          }
        }
      }
    }
  });

  feedObserver.observe(feedContainer, {
    childList: true,
    subtree: true,
  });

  isObserving = true;
  console.log('[ErgoBlock] Feed filter observer started');
}

/**
 * Stop observing the feed
 */
function stopObserving(): void {
  if (feedObserver) {
    feedObserver.disconnect();
    feedObserver = null;
  }
  isObserving = false;
}

/**
 * Refresh filtering (call when filter list changes)
 */
export async function refreshFiltering(): Promise<void> {
  await loadFilteredHandles();

  if (filteredHandles.size === 0) {
    // No filters, unhide everything and stop observing
    unfilterAllFeedItems();
    stopObserving();
    return;
  }

  if (isFilterableFeedPage()) {
    // Re-scan all items with new filter list
    unfilterAllFeedItems();
    filterAllFeedItems();

    // Ensure observer is running
    if (!isObserving) {
      startObserving();
    }
  }
}

/**
 * Initialize feed filtering
 */
export async function initFeedFilter(): Promise<void> {
  // Load initial filter list
  await loadFilteredHandles();

  if (filteredHandles.size === 0) {
    console.log('[ErgoBlock] No repost filters configured');
    return;
  }

  // Start observing if on a filterable page
  if (isFilterableFeedPage()) {
    startObserving();
  }

  // Listen for storage changes to update filter list
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.REPOST_FILTERED_USERS]) {
      console.log('[ErgoBlock] Repost filter list changed, refreshing...');
      refreshFiltering();
    }
  });

  // Handle SPA navigation
  let lastPath = window.location.pathname;
  const checkNavigation = () => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;

      if (isFilterableFeedPage()) {
        // Delay to let DOM update
        setTimeout(() => {
          if (!isObserving) {
            startObserving();
          } else {
            filterAllFeedItems();
          }
        }, 500);
      } else {
        stopObserving();
      }
    }
  };

  // Watch for URL changes
  window.addEventListener('popstate', checkNavigation);

  // Also check periodically for client-side navigation
  const navigationObserver = new MutationObserver(checkNavigation);
  navigationObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Get current filter statistics
 */
export function getFilterStats(): { filteredHandles: number; hiddenItems: number } {
  const hiddenItems = document.querySelectorAll(
    `${FEED_SELECTORS.FEED_ITEM}[data-ergoblock-filtered="repost"]`
  ).length;
  return {
    filteredHandles: filteredHandles.size,
    hiddenItems,
  };
}
