// Content script for Bluesky Temp Block & Mute
// Injects menu options into Bluesky's dropdown menus
// Uses Preact components rendered in Shadow DOM for UI isolation

import { render } from 'preact';
import browser from './browser.js';
import { getSession, getProfile, blockUser, muteUser } from './api.js';
import { addTempBlock, addTempMute } from './storage.js';
import { capturePostContext, findPostContainer } from './post-context.js';
import { DurationPicker, type DurationOption } from './components/content/DurationPicker.js';
import { ContentToast } from './components/content/ContentToast.js';

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
  },
  REGEX: {
    PROFILE_PATH: /\/profile\/([^/]+)/,
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
let lastClickedElement: HTMLElement | null = null;
let capturedPostContainer: HTMLElement | null = null;
let lastClickedPostContainer: HTMLElement | null = null;

// Shadow DOM containers for isolated UI
let pickerHost: HTMLElement | null = null;
let toastHost: HTMLElement | null = null;

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
    lastClickedElement = e.target as HTMLElement;
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
      }
    }
  },
  true
);

/**
 * Extract user info from the current page context
 */
function extractUserFromPage(): { handle: string } | null {
  const profileMatch = window.location.pathname.match(CONFIG.REGEX.PROFILE_PATH);
  if (profileMatch) {
    return { handle: profileMatch[1] };
  }
  return null;
}

/**
 * Extract user info from a dropdown menu context
 */
function extractUserFromMenu(menuElement: Element): { handle: string } | null {
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

  render(
    <DurationPicker
      actionType={actionType}
      handle={handle}
      options={DURATION_OPTIONS}
      onSelect={handleSelect}
      onCancel={handleCancel}
    />,
    container
  );
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

    const blockResult = await blockUser(profile.did);

    let rkey: string | undefined;
    if (blockResult && blockResult.uri) {
      const parts = blockResult.uri.split('/');
      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        rkey = lastPart;
      }
    }

    await addTempBlock(profile.did, profile.handle || handle, durationMs, rkey);

    capturePostContext(postContainer, handle, profile.did, 'block', false).catch((e) =>
      console.warn('[ErgoBlock] Post context capture failed:', e)
    );

    closeMenus();
    showToast(`Temporarily blocked @${profile.handle || handle} for ${durationLabel}`);
  } catch (error) {
    console.error('[ErgoBlock] Failed to temp block:', error);
    showToast(`Failed to block: ${(error as Error).message}`, true);
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

    await muteUser(profile.did);
    await addTempMute(profile.did, profile.handle || handle, durationMs);

    capturePostContext(postContainer, handle, profile.did, 'mute', false).catch((e) =>
      console.warn('[ErgoBlock] Post context capture failed:', e)
    );

    closeMenus();
    showToast(`Temporarily muted @${profile.handle || handle} for ${durationLabel}`);
  } catch (error) {
    console.error('[ErgoBlock] Failed to temp mute:', error);
    showToast(`Failed to mute: ${(error as Error).message}`, true);
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

    capturePostContext(postContainer, handle, profile.did, actionType, true).catch((e) =>
      console.warn('[ErgoBlock] Post context capture failed:', e)
    );

    closeMenus();
    showToast(
      `Permanently ${actionType === 'block' ? 'blocked' : 'muted'} @${profile.handle || handle}`
    );
  } catch (error) {
    console.error('[ErgoBlock] Failed to permanent', actionType, ':', error);
    showToast(`Failed to ${actionType}: ${(error as Error).message}`, true);
  }
}

/**
 * Intercept a native menu item to show duration picker instead
 */
function interceptMenuItem(item: HTMLElement, actionType: 'block' | 'mute', handle: string): void {
  const clone = item.cloneNode(true) as HTMLElement;

  clone.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      capturedPostContainer = lastClickedPostContainer;

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
  const menuItemsList = menuItems.querySelectorAll(CONFIG.SELECTORS.MENU_ITEM);

  for (const item of menuItemsList) {
    const text = item.textContent?.toLowerCase() || '';

    if (text.includes('block') && !text.includes('unblock')) {
      interceptMenuItem(item as HTMLElement, 'block', handle);
    }

    if (
      text.includes('mute') &&
      !text.includes('unmute') &&
      !text.includes('thread') &&
      !text.includes('word')
    ) {
      interceptMenuItem(item as HTMLElement, 'mute', handle);
    }
  }
}

/**
 * Observe for dropdown menus appearing
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
              setTimeout(() => injectMenuItems(menu), 50);
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
          did: session.did,
          pdsUrl: session.pdsUrl,
        },
      })
      .then(() => {
        browser.storage.local.set({ authStatus: 'valid' });
        console.log('[TempBlock] Auth synced to background (PDS:', session.pdsUrl, ')');
      })
      .catch(() => {
        // Background service worker may be inactive - this is normal in MV3
        console.log('[TempBlock] Background not ready, skipping auth sync');
      });
  }
}

// Initialize
function init(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      observeMenus();
      setTimeout(syncAuthToBackground, 2000);
    });
  } else {
    observeMenus();
    setTimeout(syncAuthToBackground, 2000);
  }

  setInterval(syncAuthToBackground, 5 * 60 * 1000);

  console.log('[TempBlock] Extension initialized');
}

init();
