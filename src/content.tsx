// Content script for Bluesky Temp Block & Mute
// Injects menu options into Bluesky's dropdown menus
// Uses Preact components rendered in Shadow DOM for UI isolation

import { render } from 'preact';
import browser from './browser.js';
import { getSession, getProfile, blockUser, muteUser, unblockUser, unmuteUser } from './api.js';
import {
  addTempBlock,
  addTempMute,
  isRepostFiltered,
  addRepostFilteredUser,
  removeRepostFilteredUser,
  isHandleFollowed,
  preCheckStorageQuota,
  StorageQuotaError,
} from './storage.js';
import type { RepostFilteredUser } from './types.js';
import {
  capturePostContext,
  findPostContainer,
  type EngagementContext,
  type NotificationContext,
} from './post-context.js';
import type { NotificationReason } from './types.js';
import { DurationPicker, type DurationOption } from './components/content/DurationPicker.js';
import { ContentToast } from './components/content/ContentToast.js';
import { NotificationMenu } from './components/content/NotificationMenu.js';
import { initFeedFilter } from './feed-filter.js';

// Configuration for DOM selectors and magic strings
const CONFIG = {
  SELECTORS: {
    MENU: '[role="menu"]',
    MENU_ITEM: '[role="menuitem"]',
    PROFILE_LINK: 'a[href*="/profile/"]',
    POST_CONTAINER:
      '[data-testid*="feedItem"], [data-testid*="postThreadItem"], article, [data-testid*="post"]',
    MENU_CONTAINER: '[data-testid]',
    RADIX_MENU: '[data-radix-menu-content]',
    // Notification-specific selectors
    NOTIFICATION_CONTAINER: '[data-testid*="notification"]',
  },
  REGEX: {
    PROFILE_PATH: /\/profile\/([^/]+)/,
    // Match /profile/{handle}/post/{rkey}/liked-by or /reposted-by
    LIKED_BY: /\/profile\/([^/]+)\/post\/([^/]+)\/liked-by/,
    REPOSTED_BY: /\/profile\/([^/]+)\/post\/([^/]+)\/reposted-by/,
    // Notifications page
    NOTIFICATIONS_PAGE: /\/notifications\/?$/,
    // Post URL pattern for extracting subject URIs
    POST_URL: /\/profile\/([^/]+)\/post\/([^/?#]+)/,
  },
  ATTRIBUTES: {
    INJECTED: 'data-temp-block-injected',
  },
};

// Duration options
const DURATION_OPTIONS: DurationOption[] = [
  { label: '1 hour', ms: 1 * 60 * 60 * 1000 },
  { label: '12 hours', ms: 12 * 60 * 60 * 1000 },
  { label: '72 hours', ms: 72 * 60 * 60 * 1000 },
  { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '1 month', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '6 months', ms: 180 * 24 * 60 * 60 * 1000 },
  { label: 'Permanent', ms: -1 },
];

let currentObserver: MutationObserver | null = null;

// DOM element references - these are cleared periodically to prevent memory leaks
// since they may hold references to removed DOM nodes
let lastClickedElement: HTMLElement | null = null;
let capturedPostContainer: HTMLElement | null = null;
let lastClickedPostContainer: HTMLElement | null = null;

// Timestamp when DOM references were last captured (for staleness checking)
let lastDomRefTimestamp = 0;
const DOM_REF_MAX_AGE_MS = 30000; // Clear DOM refs after 30 seconds of inactivity

// Shadow DOM containers for isolated UI
let pickerHost: HTMLElement | null = null;
let toastHost: HTMLElement | null = null;

// Engagement context tracking (liked-by/reposted-by pages)
let currentEngagementContext: EngagementContext | null = null;

// Captured notification info when clicking block/mute in a notification menu
let capturedNotificationInfo: {
  notificationType: NotificationReason | null;
  subjectUri: string | null;
} | null = null;

/**
 * Clear stale DOM references to prevent memory leaks
 * Called periodically and after operations complete
 */
function clearStaleDomRefs(): void {
  const now = Date.now();
  if (lastDomRefTimestamp > 0 && now - lastDomRefTimestamp > DOM_REF_MAX_AGE_MS) {
    // Clear old references that may point to removed DOM nodes
    if (lastClickedElement && !document.body.contains(lastClickedElement)) {
      lastClickedElement = null;
    }
    if (capturedPostContainer && !document.body.contains(capturedPostContainer)) {
      capturedPostContainer = null;
    }
    if (lastClickedPostContainer && !document.body.contains(lastClickedPostContainer)) {
      lastClickedPostContainer = null;
    }
    console.debug('[ErgoBlock] Cleared stale DOM references');
  }
}

/**
 * Force clear all DOM references immediately
 * Called after actions complete to prevent memory leaks
 */
function clearAllDomRefs(): void {
  lastClickedElement = null;
  capturedPostContainer = null;
  lastClickedPostContainer = null;
  capturedNotificationInfo = null;
  lastDomRefTimestamp = 0;
}

/**
 * Update DOM reference timestamp (call when capturing new refs)
 */
function touchDomRefs(): void {
  lastDomRefTimestamp = Date.now();
}

/**
 * Extract engagement context from URL (liked-by or reposted-by pages)
 */
function getEngagementContextFromUrl(url: string): EngagementContext | null {
  const likedMatch = url.match(CONFIG.REGEX.LIKED_BY);
  if (likedMatch) {
    const [, handle, rkey] = likedMatch;
    return {
      type: 'like',
      postUri: `at://${handle}/app.bsky.feed.post/${rkey}`,
      sourceUrl: url,
    };
  }

  const repostedMatch = url.match(CONFIG.REGEX.REPOSTED_BY);
  if (repostedMatch) {
    const [, handle, rkey] = repostedMatch;
    return {
      type: 'repost',
      postUri: `at://${handle}/app.bsky.feed.post/${rkey}`,
      sourceUrl: url,
    };
  }

  return null;
}

/**
 * Check if current URL should preserve engagement context
 * Context is preserved on: engagement pages, profile pages, and the original post
 */
function shouldPreserveEngagementContext(url: string, context: EngagementContext | null): boolean {
  if (!context) return false;

  // Still on the same engagement page
  if (url === context.sourceUrl) return true;

  // On the original engagement page type (liked-by or reposted-by)
  if (url.match(CONFIG.REGEX.LIKED_BY) || url.match(CONFIG.REGEX.REPOSTED_BY)) {
    // Check if it's for the same post
    const newContext = getEngagementContextFromUrl(url);
    if (newContext && newContext.postUri === context.postUri) return true;
    // Different engagement page - will get new context
    return false;
  }

  // On a profile page - preserve context (user clicked through to view profile)
  if (url.match(/\/profile\/[^/]+$/) || url.match(/\/profile\/[^/]+\/?$/)) {
    return true;
  }

  // On the original post page - preserve context
  if (context.postUri) {
    const postMatch = context.postUri.match(/at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)/);
    if (postMatch) {
      const [, handle, rkey] = postMatch;
      if (url.includes(`/profile/${handle}/post/${rkey}`)) return true;
    }
  }

  // Any other page - clear context
  return false;
}

/**
 * Update engagement context based on current URL
 */
function updateEngagementContext(): void {
  const url = window.location.href;

  // Check if we're on an engagement page
  const newContext = getEngagementContextFromUrl(url);
  if (newContext) {
    currentEngagementContext = newContext;
    console.log('[ErgoBlock] Engagement context set:', newContext.type, newContext.postUri);
    return;
  }

  // Check if we should preserve existing context
  if (currentEngagementContext && !shouldPreserveEngagementContext(url, currentEngagementContext)) {
    console.log('[ErgoBlock] Engagement context cleared (navigated away)');
    currentEngagementContext = null;
  }
}

/**
 * Check if we're on the notifications page
 */
function isNotificationsPage(): boolean {
  return CONFIG.REGEX.NOTIFICATIONS_PAGE.test(window.location.pathname);
}

/**
 * Detect notification type from a notification item's text content
 */
function detectNotificationType(notificationItem: Element): NotificationReason | null {
  const text = notificationItem.textContent?.toLowerCase() || '';

  // Check for keywords that indicate notification type
  if (text.includes('liked your') || text.includes('liked this')) return 'like';
  if (text.includes('reposted your') || text.includes('reposted this')) return 'repost';
  if (text.includes('followed you') || text.includes('started following')) return 'follow';
  if (text.includes('mentioned you')) return 'mention';
  if (text.includes('replied to') || text.includes('replied:')) return 'reply';
  if (text.includes('quoted your') || text.includes('quoted this')) return 'quote';

  return null;
}

/**
 * Extract the subject URI (post that was liked/reposted/replied to) from a notification item
 */
function extractNotificationSubjectUri(notificationItem: Element): string | null {
  // Look for post links within the notification
  const postLinks = notificationItem.querySelectorAll('a[href*="/post/"]');

  for (const link of postLinks) {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(CONFIG.REGEX.POST_URL);
    if (match) {
      const [, handle, rkey] = match;
      return `at://${handle}/app.bsky.feed.post/${rkey}`;
    }
  }

  return null;
}

/**
 * Extract user info specifically from notification context
 */
function extractUserFromNotification(
  menuElement: Element,
  triggerElement: HTMLElement | null
): {
  handle: string;
  notificationType: NotificationReason | null;
  subjectUri: string | null;
} | null {
  // Find notification container
  const notificationItem =
    menuElement.closest(CONFIG.SELECTORS.NOTIFICATION_CONTAINER) ||
    triggerElement?.closest(CONFIG.SELECTORS.NOTIFICATION_CONTAINER);

  if (!notificationItem) return null;

  // Find the first profile link - this is typically the notification actor
  const profileLink = notificationItem.querySelector(
    CONFIG.SELECTORS.PROFILE_LINK
  ) as HTMLAnchorElement;
  if (!profileLink) return null;

  const handleMatch = profileLink.href.match(CONFIG.REGEX.PROFILE_PATH);
  if (!handleMatch) return null;

  return {
    handle: handleMatch[1],
    notificationType: detectNotificationType(notificationItem),
    subjectUri: extractNotificationSubjectUri(notificationItem),
  };
}

/**
 * Create a Shadow DOM container for isolated rendering
 */
function createShadowContainer(id: string): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'position: fixed; z-index: 2147483647; top: 0; left: 0;';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.body.appendChild(host);
  return { host, shadow };
}

/**
 * Remove a Shadow DOM container
 */
function removeShadowContainer(host: HTMLElement | null): void {
  if (host && host.parentNode) {
    host.parentNode.removeChild(host);
  }
}

// Track the last clicked element to help identify menu context
document.addEventListener(
  'click',
  (e) => {
    // Clear any stale DOM refs before capturing new ones
    clearStaleDomRefs();

    lastClickedElement = e.target as HTMLElement;
    touchDomRefs(); // Mark timestamp for staleness tracking

    const target = e.target as HTMLElement;

    // Don't update post container if clicking on menu items or our own UI
    const isMenuItem = target.closest('[role="menuitem"]');
    const isMenu = target.closest('[role="menu"]');
    const isOurPicker = target.closest('.ergo-duration-picker');

    if (isMenuItem || isMenu || isOurPicker) {
      return;
    }

    // Try to find post container from the clicked element
    const container = findPostContainer(lastClickedElement);
    if (container) {
      const testid = container.dataset?.testid || '';
      const isRealPost =
        testid.startsWith('feedItem-') ||
        testid.startsWith('postThreadItem-') ||
        testid.includes('notification') ||
        container.tagName === 'ARTICLE';

      if (isRealPost) {
        lastClickedPostContainer = container;
        touchDomRefs();
      }
    }
  },
  true
);

/**
 * Extract user info from the current page context
 */
function extractUserFromPage(): {
  handle: string;
  notificationInfo?: { notificationType: NotificationReason | null; subjectUri: string | null };
} | null {
  const profileMatch = window.location.pathname.match(CONFIG.REGEX.PROFILE_PATH);
  if (profileMatch) {
    return { handle: profileMatch[1] };
  }
  return null;
}

/**
 * Extract user info from a dropdown menu context
 * Returns handle and optionally notification context if on notifications page
 */
function extractUserFromMenu(menuElement: Element): {
  handle: string;
  notificationInfo?: { notificationType: NotificationReason | null; subjectUri: string | null };
} | null {
  // Try notification-specific extraction first if on notifications page
  if (isNotificationsPage()) {
    const notificationInfo = extractUserFromNotification(menuElement, lastClickedElement);
    if (notificationInfo) {
      console.log(
        '[ErgoBlock] Found user from notification context:',
        notificationInfo.handle,
        notificationInfo.notificationType
      );
      return {
        handle: notificationInfo.handle,
        notificationInfo: {
          notificationType: notificationInfo.notificationType,
          subjectUri: notificationInfo.subjectUri,
        },
      };
    }
  }

  const profileLink = menuElement.querySelector(CONFIG.SELECTORS.PROFILE_LINK) as HTMLAnchorElement;
  if (profileLink) {
    const match = profileLink.href.match(CONFIG.REGEX.PROFILE_PATH);
    if (match) return { handle: match[1] };
  }

  const parent = menuElement.closest(CONFIG.SELECTORS.MENU_CONTAINER);
  if (parent) {
    const handleEl = parent.querySelector(CONFIG.SELECTORS.PROFILE_LINK) as HTMLAnchorElement;
    if (handleEl) {
      const match = handleEl.href.match(CONFIG.REGEX.PROFILE_PATH);
      if (match) return { handle: match[1] };
    }
  }

  if (lastClickedElement) {
    const postContainer = lastClickedElement.closest(CONFIG.SELECTORS.POST_CONTAINER);
    if (postContainer) {
      const authorLink = postContainer.querySelector(
        CONFIG.SELECTORS.PROFILE_LINK
      ) as HTMLAnchorElement;
      if (authorLink) {
        const match = authorLink.href.match(CONFIG.REGEX.PROFILE_PATH);
        if (match) {
          console.log('[TempBlock] Found user from post context:', match[1]);
          return { handle: match[1] };
        }
      }
    }

    let el: HTMLElement | null = lastClickedElement;
    for (let i = 0; i < 10 && el; i++) {
      const links = el.querySelectorAll ? el.querySelectorAll(CONFIG.SELECTORS.PROFILE_LINK) : [];
      for (const link of links) {
        const anchor = link as HTMLAnchorElement;
        const match = anchor.href.match(CONFIG.REGEX.PROFILE_PATH);
        if (match) {
          console.log('[TempBlock] Found user from click context:', match[1]);
          return { handle: match[1] };
        }
      }
      el = el.parentElement;
    }
  }

  return null;
}

/**
 * Show duration picker using Preact component in Shadow DOM
 */
function showDurationPicker(actionType: 'block' | 'mute', handle: string): void {
  // Remove any existing picker
  if (pickerHost) {
    removeShadowContainer(pickerHost);
    pickerHost = null;
  }

  const { host, shadow } = createShadowContainer('ergoblock-duration-picker');
  pickerHost = host;

  const container = document.createElement('div');
  shadow.appendChild(container);

  const handleSelect = async (durationMs: number, label: string) => {
    removeShadowContainer(pickerHost);
    pickerHost = null;

    if (durationMs === -1) {
      await handlePermanentAction(actionType, handle);
    } else if (actionType === 'block') {
      await handleTempBlock(handle, durationMs, label);
    } else {
      await handleTempMute(handle, durationMs, label);
    }
  };

  const handleCancel = () => {
    removeShadowContainer(pickerHost);
    pickerHost = null;
  };

  // Render immediately without DID (stats will show loading state)
  const renderPicker = (did?: string) => {
    render(
      <DurationPicker
        actionType={actionType}
        handle={handle}
        did={did}
        options={DURATION_OPTIONS}
        onSelect={handleSelect}
        onCancel={handleCancel}
      />,
      container
    );
  };

  renderPicker();

  // Resolve DID in background and re-render with stats
  getProfile(handle)
    .then((profile) => {
      if (profile?.did && pickerHost) {
        renderPicker(profile.did);
      }
    })
    .catch((err) => {
      // Profile resolution failed, stats will show as unavailable
      console.debug('[ErgoBlock] Profile resolution failed for stats:', err?.message || err);
    });
}

/**
 * Show a toast notification using Preact component in Shadow DOM
 */
function showToast(message: string, isError = false): void {
  // Remove any existing toast
  if (toastHost) {
    removeShadowContainer(toastHost);
    toastHost = null;
  }

  const { host, shadow } = createShadowContainer('ergoblock-toast');
  toastHost = host;

  const container = document.createElement('div');
  shadow.appendChild(container);

  const handleClose = () => {
    removeShadowContainer(toastHost);
    toastHost = null;
  };

  render(<ContentToast message={message} isError={isError} onClose={handleClose} />, container);
}

/**
 * Close any open dropdown menus
 */
function closeMenus(): void {
  document.body.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/**
 * Handle temp block action
 */
async function handleTempBlock(
  handle: string,
  durationMs: number,
  durationLabel: string
): Promise<void> {
  try {
    const postContainer = capturedPostContainer;

    const profile = await getProfile(handle);
    if (!profile?.did) {
      throw new Error('Could not get user profile');
    }

    // Pre-check storage quota BEFORE making API call to avoid desync
    // where block succeeds on Bluesky but fails to save locally
    try {
      await preCheckStorageQuota();
    } catch (quotaError) {
      if (quotaError instanceof StorageQuotaError) {
        throw new Error(
          `Storage full (${Math.round(quotaError.quotaInfo.percentUsed * 100)}% used). ` +
            `Please remove some temp blocks/mutes first.`
        );
      }
      throw quotaError;
    }

    const blockResult = await blockUser(profile.did);

    let rkey: string | undefined;
    if (blockResult && blockResult.uri) {
      const parts = blockResult.uri.split('/');
      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        rkey = lastPart;
      }
    }

    // Try to save to storage - if this fails, we need to rollback the API call
    try {
      await addTempBlock(profile.did, profile.handle || handle, durationMs, rkey);
    } catch (storageError) {
      // Storage failed after API succeeded - rollback by unblocking
      console.error('[ErgoBlock] Storage failed after block, rolling back:', storageError);
      try {
        await unblockUser(profile.did, rkey);
        console.log('[ErgoBlock] Rollback successful - user unblocked');
      } catch (rollbackError) {
        // Rollback failed - user is blocked on Bluesky but not tracked
        console.error('[ErgoBlock] Rollback failed - desync occurred:', rollbackError);
        throw new Error(
          `Block saved to Bluesky but local storage failed. ` +
            `The user is blocked but not tracked by ErgoBlock. ` +
            `Original error: ${(storageError as Error).message}`
        );
      }
      throw storageError;
    }

    // Build notification context if we have notification info
    const notifContext: NotificationContext | null = capturedNotificationInfo?.notificationType
      ? {
          notificationType: capturedNotificationInfo.notificationType,
          subjectUri: capturedNotificationInfo.subjectUri || undefined,
          sourceUrl: window.location.href,
        }
      : null;

    capturePostContext(
      postContainer,
      handle,
      profile.did,
      'block',
      false,
      currentEngagementContext,
      notifContext
    ).catch((e) => console.warn('[ErgoBlock] Post context capture failed:', e));

    // Clear captured notification info after use
    capturedNotificationInfo = null;
    // Clear captured post container to prevent memory leak
    capturedPostContainer = null;

    closeMenus();
    showToast(`Temporarily blocked @${profile.handle || handle} for ${durationLabel}`);
  } catch (error) {
    console.error('[ErgoBlock] Failed to temp block:', error);
    showToast(`Failed to block: ${(error as Error).message}`, true);
  } finally {
    // Always clear DOM refs after action completes to prevent memory leaks
    clearAllDomRefs();
  }
}

/**
 * Handle temp mute action
 */
async function handleTempMute(
  handle: string,
  durationMs: number,
  durationLabel: string
): Promise<void> {
  try {
    const postContainer = capturedPostContainer;

    const profile = await getProfile(handle);
    if (!profile?.did) {
      throw new Error('Could not get user profile');
    }

    // Pre-check storage quota BEFORE making API call to avoid desync
    // where mute succeeds on Bluesky but fails to save locally
    try {
      await preCheckStorageQuota();
    } catch (quotaError) {
      if (quotaError instanceof StorageQuotaError) {
        throw new Error(
          `Storage full (${Math.round(quotaError.quotaInfo.percentUsed * 100)}% used). ` +
            `Please remove some temp blocks/mutes first.`
        );
      }
      throw quotaError;
    }

    await muteUser(profile.did);

    // Try to save to storage - if this fails, we need to rollback the API call
    try {
      await addTempMute(profile.did, profile.handle || handle, durationMs);
    } catch (storageError) {
      // Storage failed after API succeeded - rollback by unmuting
      console.error('[ErgoBlock] Storage failed after mute, rolling back:', storageError);
      try {
        await unmuteUser(profile.did);
        console.log('[ErgoBlock] Rollback successful - user unmuted');
      } catch (rollbackError) {
        // Rollback failed - user is muted on Bluesky but not tracked
        console.error('[ErgoBlock] Rollback failed - desync occurred:', rollbackError);
        throw new Error(
          `Mute saved to Bluesky but local storage failed. ` +
            `The user is muted but not tracked by ErgoBlock. ` +
            `Original error: ${(storageError as Error).message}`
        );
      }
      throw storageError;
    }

    // Build notification context if we have notification info
    const notifContext: NotificationContext | null = capturedNotificationInfo?.notificationType
      ? {
          notificationType: capturedNotificationInfo.notificationType,
          subjectUri: capturedNotificationInfo.subjectUri || undefined,
          sourceUrl: window.location.href,
        }
      : null;

    capturePostContext(
      postContainer,
      handle,
      profile.did,
      'mute',
      false,
      currentEngagementContext,
      notifContext
    ).catch((e) => console.warn('[ErgoBlock] Post context capture failed:', e));

    // Clear captured notification info after use
    capturedNotificationInfo = null;
    // Clear captured post container to prevent memory leak
    capturedPostContainer = null;

    closeMenus();
    showToast(`Temporarily muted @${profile.handle || handle} for ${durationLabel}`);
  } catch (error) {
    console.error('[ErgoBlock] Failed to temp mute:', error);
    showToast(`Failed to mute: ${(error as Error).message}`, true);
  } finally {
    // Always clear DOM refs after action completes to prevent memory leaks
    clearAllDomRefs();
  }
}

/**
 * Handle permanent block/mute action
 */
async function handlePermanentAction(actionType: 'block' | 'mute', handle: string): Promise<void> {
  try {
    const postContainer = capturedPostContainer;

    const profile = await getProfile(handle);
    if (!profile?.did) {
      throw new Error('Could not get user profile');
    }

    if (actionType === 'block') {
      await blockUser(profile.did);
    } else {
      await muteUser(profile.did);
    }

    // Build notification context if we have notification info
    const notifContext: NotificationContext | null = capturedNotificationInfo?.notificationType
      ? {
          notificationType: capturedNotificationInfo.notificationType,
          subjectUri: capturedNotificationInfo.subjectUri || undefined,
          sourceUrl: window.location.href,
        }
      : null;

    capturePostContext(
      postContainer,
      handle,
      profile.did,
      actionType,
      true,
      currentEngagementContext,
      notifContext
    ).catch((e) => console.warn('[ErgoBlock] Post context capture failed:', e));

    // Clear captured notification info after use
    capturedNotificationInfo = null;

    closeMenus();
    showToast(
      `Permanently ${actionType === 'block' ? 'blocked' : 'muted'} @${profile.handle || handle}`
    );
  } catch (error) {
    console.error('[ErgoBlock] Failed to permanent', actionType, ':', error);
    showToast(`Failed to ${actionType}: ${(error as Error).message}`, true);
  } finally {
    // Always clear DOM refs after action completes to prevent memory leaks
    clearAllDomRefs();
  }
}

/**
 * Intercept a native menu item to show duration picker instead
 */
function interceptMenuItem(
  item: HTMLElement,
  actionType: 'block' | 'mute',
  handle: string,
  notificationInfo?: { notificationType: NotificationReason | null; subjectUri: string | null }
): void {
  const clone = item.cloneNode(true) as HTMLElement;

  clone.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      capturedPostContainer = lastClickedPostContainer;
      // Capture notification info for later use in the action handlers
      capturedNotificationInfo = notificationInfo || null;

      closeMenus();
      showDurationPicker(actionType, handle);
    },
    true
  );

  clone.setAttribute(CONFIG.ATTRIBUTES.INJECTED, 'true');
  item.parentNode?.replaceChild(clone, item);
}

/**
 * Inject menu items to intercept native Block/Mute
 */
function injectMenuItems(menu: Element): void {
  if (menu.querySelector(`[${CONFIG.ATTRIBUTES.INJECTED}]`)) {
    return;
  }

  const menuItems = menu.querySelector(CONFIG.SELECTORS.MENU) || menu;

  let userInfo = extractUserFromMenu(menu);
  if (!userInfo) {
    userInfo = extractUserFromPage();
  }

  if (!userInfo?.handle) {
    return;
  }

  const handle = userInfo.handle;
  // Extract notification info if available (from notification context)
  const notificationInfo = userInfo.notificationInfo;
  const menuItemsList = menuItems.querySelectorAll(CONFIG.SELECTORS.MENU_ITEM);

  for (const item of menuItemsList) {
    const text = item.textContent?.toLowerCase() || '';

    if (text.includes('block') && !text.includes('unblock')) {
      interceptMenuItem(item as HTMLElement, 'block', handle, notificationInfo);
    }

    if (
      text.includes('mute') &&
      !text.includes('unmute') &&
      !text.includes('thread') &&
      !text.includes('word')
    ) {
      interceptMenuItem(item as HTMLElement, 'mute', handle, notificationInfo);
    }
  }

  // Try to inject repost filter option (only on profile menus for followed users)
  injectRepostFilterOption(menu, handle);
}

/**
 * Check if we're on a profile page
 */
function isProfilePage(): boolean {
  return /\/profile\/[^/]+\/?$/.test(window.location.pathname);
}

/**
 * Check if a user is in our follows list
 */
async function isFollowedUser(handle: string): Promise<boolean> {
  try {
    return await isHandleFollowed(handle);
  } catch {
    return false;
  }
}

/**
 * Inject "Disable/Enable Reposts" option into profile menus for followed users
 */
async function injectRepostFilterOption(menu: Element, handle: string): Promise<void> {
  // Only inject on profile pages for followed users
  if (!isProfilePage()) return;

  // Check if we already injected
  if (menu.querySelector('[data-ergoblock-repost-filter]')) return;

  // Check if user is followed
  const isFollowed = await isFollowedUser(handle);
  if (!isFollowed) return;

  // Get profile info (API returns full profile with displayName/avatar)
  const profile = (await getProfile(handle)) as {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  } | null;
  if (!profile?.did) return;

  // Check if already filtered
  const isFiltered = await isRepostFiltered(profile.did);

  // Find a menu item to clone the style from (prefer mute item for similar styling)
  const muteMenuItem = Array.from(menu.querySelectorAll(CONFIG.SELECTORS.MENU_ITEM)).find(
    (item) => {
      const text = item.textContent?.toLowerCase() || '';
      return text.includes('mute') && !text.includes('unmute') && !text.includes('thread');
    }
  );
  const existingMenuItem = muteMenuItem || menu.querySelector(CONFIG.SELECTORS.MENU_ITEM);
  if (!existingMenuItem) return;

  // Deep clone to preserve inner structure and styling
  const repostMenuItem = existingMenuItem.cloneNode(true) as HTMLElement;
  repostMenuItem.setAttribute('role', 'menuitem');
  repostMenuItem.setAttribute('data-ergoblock-repost-filter', 'true');
  repostMenuItem.setAttribute('tabindex', '0');

  // Find and update the text content (may be in nested elements)
  const textLabel = isFiltered ? 'Enable Reposts' : 'Disable Reposts';

  // Try to find a text node or the innermost div with text
  const updateText = (el: Element): boolean => {
    // Check direct text nodes
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        child.textContent = textLabel;
        return true;
      }
    }
    // Recurse into child elements
    for (const child of el.children) {
      if (updateText(child)) return true;
    }
    return false;
  };

  if (!updateText(repostMenuItem)) {
    // Fallback: just set textContent if no text node found
    repostMenuItem.textContent = textLabel;
  }

  // Remove any SVG icons (we don't have a matching icon)
  const svg = repostMenuItem.querySelector('svg');
  if (svg) {
    svg.remove();
  }

  // Handle click
  repostMenuItem.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      if (isFiltered) {
        // Remove from filter list
        await removeRepostFilteredUser(profile.did);
        showToast(`Enabled reposts from @${handle}`);
      } else {
        // Add to filter list
        const user: RepostFilteredUser = {
          did: profile.did,
          handle: profile.handle || handle,
          displayName: profile.displayName,
          avatar: profile.avatar,
          addedAt: Date.now(),
        };
        await addRepostFilteredUser(user);
        showToast(`Disabled reposts from @${handle}`);
      }
      closeMenus();
    } catch (error) {
      console.error('[ErgoBlock] Repost filter toggle failed:', error);
      showToast('Failed to update repost filter', true);
    }
  });

  // Insert after mute option or at the end
  if (muteMenuItem && muteMenuItem.parentNode) {
    muteMenuItem.parentNode.insertBefore(repostMenuItem, muteMenuItem.nextSibling);
  } else {
    // Append to menu
    const menuContainer = menu.querySelector(CONFIG.SELECTORS.MENU) || menu;
    menuContainer.appendChild(repostMenuItem);
  }
}

// Track notification menu hosts for cleanup
const notificationMenuHosts = new WeakMap<Element, HTMLElement>();

/**
 * Inject notification action menu into a notification item
 */
function injectNotificationMenu(notificationItem: Element): void {
  // Skip if already injected
  if (notificationItem.querySelector('[data-ergoblock-notif-menu]')) {
    return;
  }

  // Skip if notification already has a native Bluesky menu button (e.g., reply notifications)
  // These have their own "..." button that we intercept via the normal menu observer
  const hasNativeMenu =
    notificationItem.querySelector('button[aria-label*="Open"]') ||
    notificationItem.querySelector('[data-testid*="menu"]') ||
    notificationItem.querySelector('button svg circle'); // Native dots icon
  if (hasNativeMenu) {
    console.log('[ErgoBlock] Skipping notification with native menu');
    return;
  }

  // Get all profile links in this notification
  const profileLinks = notificationItem.querySelectorAll(
    CONFIG.SELECTORS.PROFILE_LINK
  ) as NodeListOf<HTMLAnchorElement>;
  if (profileLinks.length === 0) return;

  // Check for multi-user notifications (grouped likes/reposts)
  // These have multiple unique profile links - we skip them since there's no single user to block
  const uniqueHandles = new Set<string>();
  for (const link of profileLinks) {
    const match = link.href.match(CONFIG.REGEX.PROFILE_PATH);
    if (match) {
      uniqueHandles.add(match[1]);
    }
  }

  // Skip multi-user notifications (more than one unique user)
  if (uniqueHandles.size > 1) {
    console.log('[ErgoBlock] Skipping multi-user notification with', uniqueHandles.size, 'users');
    return;
  }

  // Extract user info from notification (use first profile link)
  const profileLink = profileLinks[0];
  const handleMatch = profileLink.href.match(CONFIG.REGEX.PROFILE_PATH);
  if (!handleMatch) return;

  const handle = handleMatch[1];
  const notificationType = detectNotificationType(notificationItem);
  const subjectUri = extractNotificationSubjectUri(notificationItem);

  // Find a suitable container to place the menu button
  // Bluesky places the ⋯ menu in the bottom right, after the action bar
  let menuContainer = notificationItem.querySelector('[data-ergoblock-notif-menu-container]');

  if (!menuContainer) {
    // Create a container for the menu button
    menuContainer = document.createElement('div');
    menuContainer.setAttribute('data-ergoblock-notif-menu-container', 'true');
    (menuContainer as HTMLElement).style.cssText =
      'position: absolute; top: 10px; right: 10px; z-index: 1;';

    // Make the notification item position: relative if it isn't already
    const notifStyle = window.getComputedStyle(notificationItem);
    if (notifStyle.position === 'static') {
      (notificationItem as HTMLElement).style.position = 'relative';
    }

    notificationItem.appendChild(menuContainer);
  }

  // Create Shadow DOM host for isolated styling
  const host = document.createElement('div');
  host.setAttribute('data-ergoblock-notif-menu', 'true');
  host.style.cssText = 'display: inline-flex; align-items: center;';
  const shadow = host.attachShadow({ mode: 'closed' });

  menuContainer.appendChild(host);
  notificationMenuHosts.set(notificationItem, host);

  // Create render container
  const container = document.createElement('div');
  shadow.appendChild(container);

  // Handle block action
  const handleBlock = () => {
    capturedPostContainer = notificationItem as HTMLElement;
    capturedNotificationInfo = { notificationType, subjectUri };
    showDurationPicker('block', handle);
  };

  // Handle mute action
  const handleMute = () => {
    capturedPostContainer = notificationItem as HTMLElement;
    capturedNotificationInfo = { notificationType, subjectUri };
    showDurationPicker('mute', handle);
  };

  // Render the menu component
  render(<NotificationMenu handle={handle} onBlock={handleBlock} onMute={handleMute} />, container);
}

/**
 * Observe notifications page for new notification items
 */
let notificationObserver: MutationObserver | null = null;

function observeNotifications(): void {
  if (!isNotificationsPage()) {
    // Clean up observer if we're not on notifications page
    if (notificationObserver) {
      notificationObserver.disconnect();
      notificationObserver = null;
    }
    return;
  }

  // Always try to inject into existing notifications (even if observer exists)
  // This handles the case where notifications loaded before observer was set up

  // Find the notifications feed container first
  const notifFeed = document.querySelector(CONFIG.SELECTORS.NOTIFICATION_CONTAINER);

  // Debug: log structure to find the right elements
  if (notifFeed) {
    console.log('[ErgoBlock] Found notification feed container');

    // Look for notification items - they typically contain profile links and are clickable rows
    // Try multiple strategies to find individual notification items
    const notificationItems: Element[] = [];

    // Strategy 1: Look for elements with profile links that are direct children of feed items
    const feedItems = notifFeed.querySelectorAll(
      '[data-testid^="feedItem"], [role="link"], [role="button"]'
    );
    feedItems.forEach((item) => {
      if (item.querySelector(CONFIG.SELECTORS.PROFILE_LINK) && !notificationItems.includes(item)) {
        notificationItems.push(item);
      }
    });

    // Strategy 2: Find clickable notification rows by looking for elements with profile links
    // that have a specific structure (usually divs with padding that act as list items)
    if (notificationItems.length === 0) {
      const allProfileLinks = notifFeed.querySelectorAll(CONFIG.SELECTORS.PROFILE_LINK);
      allProfileLinks.forEach((link) => {
        // Walk up to find the notification item container (usually 2-4 levels up)
        let parent = link.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          // Check if this looks like a notification item (has padding, is a direct child of a list)
          const style = window.getComputedStyle(parent);
          const isListItem =
            parent.getAttribute('role') === 'link' ||
            parent.getAttribute('role') === 'button' ||
            (style.paddingTop &&
              parseFloat(style.paddingTop) > 0 &&
              style.paddingBottom &&
              parseFloat(style.paddingBottom) > 0);

          if (isListItem && !notificationItems.includes(parent)) {
            // Verify this container has a profile link (is a real notification item)
            if (parent.querySelector(CONFIG.SELECTORS.PROFILE_LINK)) {
              notificationItems.push(parent);
              break;
            }
          }
          parent = parent.parentElement;
        }
      });
    }

    // Deduplicate - some items might be nested
    const uniqueItems = notificationItems.filter((item, index) => {
      // Remove items that are ancestors of other items
      return !notificationItems.some(
        (other, otherIndex) => otherIndex !== index && item.contains(other)
      );
    });

    console.log('[ErgoBlock] Found', uniqueItems.length, 'notification items to inject menu into');
    uniqueItems.forEach((notif) => injectNotificationMenu(notif));
  } else {
    console.log('[ErgoBlock] No notification feed container found');
  }

  // If already observing, skip setting up new observer
  if (notificationObserver) return;

  // Set up observer for new notifications
  notificationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const element = node as Element;

        // Check if the added element contains profile links (potential notification items)
        const profileLinks = element.querySelectorAll?.(CONFIG.SELECTORS.PROFILE_LINK) || [];
        if (element.querySelector?.(CONFIG.SELECTORS.PROFILE_LINK) || profileLinks.length > 0) {
          // Check if element itself is a notification item
          if (
            element.querySelector(CONFIG.SELECTORS.PROFILE_LINK) &&
            (element.getAttribute('role') === 'link' || element.getAttribute('role') === 'button')
          ) {
            injectNotificationMenu(element);
          }

          // Check children for notification items
          const items = element.querySelectorAll('[role="link"], [role="button"]');
          items.forEach((item) => {
            if (item.querySelector(CONFIG.SELECTORS.PROFILE_LINK)) {
              injectNotificationMenu(item);
            }
          });
        }
      }
    }
  });

  notificationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('[ErgoBlock] Notification menu observer started');
}

/**
 * Observe for dropdown menus appearing
 * Uses immediate injection with capture-phase click interception to prevent race conditions
 */
function observeMenus(): void {
  if (currentObserver) {
    currentObserver.disconnect();
  }

  currentObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const element = node as Element;
        const menus = element.querySelectorAll
          ? [
              element,
              ...element.querySelectorAll(
                `${CONFIG.SELECTORS.MENU}, ${CONFIG.SELECTORS.RADIX_MENU}`
              ),
            ]
          : [element];

        for (const menu of menus) {
          if (
            menu.getAttribute?.('role') === 'menu' ||
            menu.hasAttribute?.('data-radix-menu-content') ||
            menu.querySelector?.(CONFIG.SELECTORS.MENU_ITEM)
          ) {
            const hasBlockOption = Array.from(
              menu.querySelectorAll(CONFIG.SELECTORS.MENU_ITEM)
            ).some((item) => {
              const text = item.textContent?.toLowerCase() || '';
              return text.includes('block') || text.includes('mute');
            });

            if (hasBlockOption) {
              // Inject immediately - no delay needed since we:
              // 1. Already have the menu element reference
              // 2. Replace native items with clones that intercept clicks
              // 3. Use capture phase in click handlers to prevent native behavior
              //
              // Also verify menu is still in DOM (could have been removed during mutation batch)
              if (document.body.contains(menu)) {
                injectMenuItems(menu);
              }
            }
          }
        }
      }
    }
  });

  currentObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('[TempBlock] Menu observer started');
}

/**
 * Send auth token to background worker
 */
function syncAuthToBackground(): void {
  const session = getSession();
  if (session?.accessJwt && session?.did && session?.pdsUrl) {
    browser.runtime
      .sendMessage({
        type: 'SET_AUTH_TOKEN',
        auth: {
          accessJwt: session.accessJwt,
          refreshJwt: session.refreshJwt,
          did: session.did,
          pdsUrl: session.pdsUrl,
        },
      })
      .then(async () => {
        // Check if we're recovering from an invalid state
        const { authStatus } = await browser.storage.local.get('authStatus');
        if (authStatus === 'invalid') {
          console.log('[TempBlock] Auth recovered from invalid state');
        }
        // Always set to valid when we have a fresh token
        await browser.storage.local.set({ authStatus: 'valid' });
        console.log('[TempBlock] Auth synced to background (PDS:', session.pdsUrl, ')');
      })
      .catch((err) => {
        // Background service worker may be inactive - this is normal in MV3
        console.debug('[ErgoBlock] Background not ready, skipping auth sync:', err?.message || err);
      });
  }
}

/**
 * Get current auth data for on-demand requests from background
 */
function getCurrentAuth(): {
  accessJwt: string;
  refreshJwt?: string;
  did: string;
  pdsUrl: string;
} | null {
  const session = getSession();
  if (session?.accessJwt && session?.did && session?.pdsUrl) {
    return {
      accessJwt: session.accessJwt,
      refreshJwt: session.refreshJwt,
      did: session.did,
      pdsUrl: session.pdsUrl,
    };
  }
  return null;
}

// Listen for messages from background (e.g., auth refresh requests)
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type?: string };
  if (msg.type === 'REQUEST_AUTH') {
    const auth = getCurrentAuth();
    if (auth) {
      // Also sync to storage for background's immediate use
      browser.storage.local.set({ authToken: auth, authStatus: 'valid' }).catch(() => {});
    }
    return Promise.resolve({ auth });
  }
  return undefined;
});

// Initialize
function init(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      observeMenus();
      observeNotifications();
      setTimeout(syncAuthToBackground, 2000);
      // Initialize feed filtering for repost control
      setTimeout(() => initFeedFilter().catch(console.error), 1000);
    });
  } else {
    observeMenus();
    observeNotifications();
    setTimeout(syncAuthToBackground, 2000);
    // Initialize feed filtering for repost control
    setTimeout(() => initFeedFilter().catch(console.error), 1000);
  }

  // Sync auth frequently to keep background tokens fresh
  // Bluesky tokens expire after ~2 hours, so sync every minute
  setInterval(syncAuthToBackground, 60 * 1000);

  // Track URL changes for engagement context (liked-by/reposted-by pages)
  // Check on init and whenever URL changes (SPA navigation)
  updateEngagementContext();

  // Listen for SPA navigation (popstate for back/forward)
  window.addEventListener('popstate', () => {
    updateEngagementContext();
    observeNotifications();
  });

  // Observe URL changes via History API (pushState/replaceState)
  // Bluesky uses client-side routing, so we need to detect these changes
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      updateEngagementContext();
      observeNotifications();
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  console.log('[TempBlock] Extension initialized');
}

init();
