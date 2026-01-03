// Content script for Bluesky Temp Block & Mute
// Injects menu options into Bluesky's dropdown menus

(function() {
  'use strict';

  const MENU_ITEM_SELECTOR = '[data-testid="profileHeaderDropdownBtn"]';
  const POST_MENU_SELECTOR = '[data-testid="postDropdownBtn"]';

  let currentObserver = null;

  /**
   * Extract user info from the current page context
   */
  function extractUserFromPage() {
    // Try to get from profile page URL
    const profileMatch = window.location.pathname.match(/\/profile\/([^/]+)/);
    if (profileMatch) {
      return { handle: profileMatch[1] };
    }
    return null;
  }

  // Track the last clicked element to help identify menu context
  let lastClickedElement = null;
  document.addEventListener('click', (e) => {
    lastClickedElement = e.target;
  }, true);

  /**
   * Extract user info from a dropdown menu context
   */
  function extractUserFromMenu(menuElement) {
    // Look for the profile link in the menu or nearby elements
    const profileLink = menuElement.querySelector('a[href*="/profile/"]');
    if (profileLink) {
      const match = profileLink.href.match(/\/profile\/([^/]+)/);
      if (match) return { handle: match[1] };
    }

    // Try to find handle from the menu's parent context
    const parent = menuElement.closest('[data-testid]');
    if (parent) {
      const handleEl = parent.querySelector('a[href*="/profile/"]');
      if (handleEl) {
        const match = handleEl.href.match(/\/profile\/([^/]+)/);
        if (match) return { handle: match[1] };
      }
    }

    // For post menus: look at the element that was clicked to open the menu
    // and find the post container, then get the author from there
    if (lastClickedElement) {
      // Find the post container (usually has data-testid="feedItem" or similar)
      const postContainer = lastClickedElement.closest('[data-testid*="feedItem"], [data-testid*="postThreadItem"], article, [data-testid*="post"]');
      if (postContainer) {
        // Find the author's profile link in the post
        const authorLink = postContainer.querySelector('a[href*="/profile/"]');
        if (authorLink) {
          const match = authorLink.href.match(/\/profile\/([^/]+)/);
          if (match) {
            console.log('[TempBlock] Found user from post context:', match[1]);
            return { handle: match[1] };
          }
        }
      }

      // Also try looking at nearby elements from where the click happened
      let el = lastClickedElement;
      for (let i = 0; i < 10 && el; i++) {
        const links = el.querySelectorAll ? el.querySelectorAll('a[href*="/profile/"]') : [];
        for (const link of links) {
          const match = link.href.match(/\/profile\/([^/]+)/);
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
   * Create a menu item element matching Bluesky's style
   */
  function createMenuItem(text, icon, onClick) {
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      cursor: pointer;
      color: inherit;
      font-size: 14px;
    `;

    item.innerHTML = `
      <span style="font-size: 16px;">${icon}</span>
      <span>${text}</span>
    `;

    item.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await onClick();
    });

    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
    });

    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = 'transparent';
    });

    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    });

    return item;
  }

  /**
   * Create a separator element
   */
  function createSeparator() {
    const sep = document.createElement('div');
    sep.style.cssText = `
      height: 1px;
      background-color: rgba(0, 0, 0, 0.1);
      margin: 4px 0;
    `;
    return sep;
  }

  /**
   * Duration options in milliseconds
   */
  const DURATION_OPTIONS = [
    { label: '1 hour', ms: 1 * 60 * 60 * 1000 },
    { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
    { label: '12 hours', ms: 12 * 60 * 60 * 1000 },
    { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
    { label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
    { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  ];

  /**
   * Show duration picker dialog
   */
  function showDurationPicker(actionType, handle) {
    // Remove any existing picker
    const existing = document.getElementById('temp-block-duration-picker');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'temp-block-duration-picker';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 20px;
      min-width: 280px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const title = document.createElement('h3');
    title.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
    `;
    title.textContent = `Temp ${actionType === 'block' ? 'Block' : 'Mute'} @${handle}`;

    const subtitle = document.createElement('p');
    subtitle.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 14px;
      color: #666;
    `;
    subtitle.textContent = 'Select duration:';

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    `;

    DURATION_OPTIONS.forEach(option => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        padding: 10px 16px;
        border: 1px solid #ddd;
        border-radius: 8px;
        background: #f5f5f5;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        color: #1a1a1a;
        transition: all 0.2s;
      `;
      btn.textContent = option.label;

      btn.addEventListener('mouseenter', () => {
        btn.style.background = '#0085ff';
        btn.style.color = 'white';
        btn.style.borderColor = '#0085ff';
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.background = '#f5f5f5';
        btn.style.color = '#1a1a1a';
        btn.style.borderColor = '#ddd';
      });

      btn.addEventListener('click', async () => {
        overlay.remove();
        if (actionType === 'block') {
          await handleTempBlock(handle, option.ms, option.label);
        } else {
          await handleTempMute(handle, option.ms, option.label);
        }
      });

      buttonContainer.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = `
      margin-top: 12px;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      color: #666;
      width: 100%;
    `;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    dialog.appendChild(title);
    dialog.appendChild(subtitle);
    dialog.appendChild(buttonContainer);
    dialog.appendChild(cancelBtn);
    overlay.appendChild(dialog);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Close on escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
  }

  /**
   * Show a toast notification
   */
  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${isError ? '#dc2626' : '#0085ff'};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: slideUp 0.3s ease;
    `;
    toast.textContent = message;

    // Add animation keyframes
    if (!document.getElementById('temp-block-toast-styles')) {
      const style = document.createElement('style');
      style.id = 'temp-block-toast-styles';
      style.textContent = `
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  /**
   * Close any open dropdown menus
   */
  function closeMenus() {
    // Simulate clicking outside to close menus
    document.body.click();
  }

  /**
   * Handle temp block action
   */
  async function handleTempBlock(handle, durationMs, durationLabel) {
    console.log('[TempBlock] handleTempBlock called for:', handle, 'duration:', durationLabel);
    try {
      // Get the user's DID from their profile
      console.log('[TempBlock] Getting profile...');
      const profile = await window.BlueskyAPI.getProfile(handle);
      console.log('[TempBlock] Got profile:', profile);
      if (!profile?.did) {
        throw new Error('Could not get user profile');
      }

      // Block the user via API
      console.log('[TempBlock] Blocking user with DID:', profile.did);
      const blockResult = await window.BlueskyAPI.blockUser(profile.did);
      console.log('[TempBlock] Block result:', blockResult);

      // Store in temp blocks with custom duration
      console.log('[TempBlock] Storing temp block...');
      await window.TempBlockStorage.addTempBlock(profile.did, profile.handle, durationMs);
      console.log('[TempBlock] Stored temp block');

      closeMenus();
      console.log('[TempBlock] Showing success toast');
      showToast(`Temporarily blocked @${profile.handle} for ${durationLabel}`);

    } catch (error) {
      console.error('[TempBlock] Failed to temp block:', error);
      showToast(`Failed to block: ${error.message}`, true);
    }
  }

  /**
   * Handle temp mute action
   */
  async function handleTempMute(handle, durationMs, durationLabel) {
    console.log('[TempBlock] handleTempMute called for:', handle, 'duration:', durationLabel);
    try {
      // Get the user's DID from their profile
      const profile = await window.BlueskyAPI.getProfile(handle);
      if (!profile?.did) {
        throw new Error('Could not get user profile');
      }

      // Mute the user via API
      await window.BlueskyAPI.muteUser(profile.did);

      // Store in temp mutes with custom duration
      await window.TempBlockStorage.addTempMute(profile.did, profile.handle, durationMs);

      closeMenus();
      showToast(`Temporarily muted @${profile.handle} for ${durationLabel}`);

    } catch (error) {
      console.error('[TempBlock] Failed to temp mute:', error);
      showToast(`Failed to mute: ${error.message}`, true);
    }
  }

  /**
   * Inject menu items into a dropdown menu
   */
  function injectMenuItems(menu) {
    // Check if we've already injected
    if (menu.querySelector('[data-temp-block-injected]')) {
      return;
    }

    // Find the menu items container
    const menuItems = menu.querySelector('[role="menu"]') || menu;

    // Try to extract user info
    let userInfo = extractUserFromMenu(menu);

    // If not found in menu, try from page
    if (!userInfo) {
      userInfo = extractUserFromPage();
    }

    if (!userInfo?.handle) {
      console.log('[TempBlock] Could not determine user for menu');
      return;
    }

    // Find where to insert (after Block Account if present, or at the end)
    const menuItemsList = menuItems.querySelectorAll('[role="menuitem"]');
    let insertAfter = null;

    for (const item of menuItemsList) {
      const text = item.textContent?.toLowerCase() || '';
      if (text.includes('block')) {
        insertAfter = item;
        break;
      }
    }

    // Create our menu items
    const separator = createSeparator();
    separator.setAttribute('data-temp-block-injected', 'true');

    const tempMuteItem = createMenuItem('Temp Mute...', '⏱️', () => {
      closeMenus();
      showDurationPicker('mute', userInfo.handle);
    });
    tempMuteItem.setAttribute('data-temp-block-injected', 'true');

    const tempBlockItem = createMenuItem('Temp Block...', '⏱️', () => {
      closeMenus();
      showDurationPicker('block', userInfo.handle);
    });
    tempBlockItem.setAttribute('data-temp-block-injected', 'true');

    // Insert items
    if (insertAfter && insertAfter.nextSibling) {
      insertAfter.parentNode.insertBefore(separator, insertAfter.nextSibling);
      insertAfter.parentNode.insertBefore(tempMuteItem, separator.nextSibling);
      insertAfter.parentNode.insertBefore(tempBlockItem, tempMuteItem.nextSibling);
    } else {
      // Append at the end
      menuItems.appendChild(separator);
      menuItems.appendChild(tempMuteItem);
      menuItems.appendChild(tempBlockItem);
    }

    console.log('[TempBlock] Injected menu items for', userInfo.handle);
  }

  /**
   * Observe for dropdown menus appearing
   */
  function observeMenus() {
    if (currentObserver) {
      currentObserver.disconnect();
    }

    currentObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Look for dropdown menus
          // Bluesky uses various portal/menu containers
          const menus = node.querySelectorAll ?
            [node, ...node.querySelectorAll('[role="menu"], [data-radix-menu-content]')] :
            [node];

          for (const menu of menus) {
            if (menu.getAttribute?.('role') === 'menu' ||
                menu.hasAttribute?.('data-radix-menu-content') ||
                menu.querySelector?.('[role="menuitem"]')) {

              // Check if this menu has block/mute options (indicating it's a user menu)
              const hasBlockOption = Array.from(menu.querySelectorAll('[role="menuitem"]'))
                .some(item => {
                  const text = item.textContent?.toLowerCase() || '';
                  return text.includes('block') || text.includes('mute');
                });

              if (hasBlockOption) {
                // Small delay to ensure menu is fully rendered
                setTimeout(() => injectMenuItems(menu), 50);
              }
            }
          }
        }
      }
    });

    currentObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[TempBlock] Menu observer started');
  }

  /**
   * Send auth token to background worker for expiration handling
   */
  function syncAuthToBackground() {
    const session = window.BlueskyAPI?.getSession?.();
    if (session?.accessJwt && session?.did && session?.pdsUrl) {
      chrome.runtime.sendMessage({
        type: 'SET_AUTH_TOKEN',
        auth: {
          accessJwt: session.accessJwt,
          did: session.did,
          pdsUrl: session.pdsUrl
        }
      });
      console.log('[TempBlock] Auth synced to background (PDS:', session.pdsUrl, ')');
    }
  }

  // Initialize
  function init() {
    // Wait for page to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        observeMenus();
        // Sync auth after a delay to ensure Bluesky has loaded
        setTimeout(syncAuthToBackground, 2000);
      });
    } else {
      observeMenus();
      setTimeout(syncAuthToBackground, 2000);
    }

    // Periodically sync auth in case of token refresh
    setInterval(syncAuthToBackground, 5 * 60 * 1000); // Every 5 minutes

    console.log('[TempBlock] Extension initialized');
  }

  init();
})();
