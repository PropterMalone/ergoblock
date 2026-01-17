/**
 * Profile Page Injection for Block Relationships
 * Injects blocking relationship info into Bluesky profile pages
 */

import browser from '../browser.js';
import type { BlockRelationshipDisplayMode } from '../types.js';

// Configuration
const CONFIG = {
  PROFILE_URL_PATTERN: /\/profile\/([^/]+)\/?$/,
  INJECTION_CONTAINER_ID: 'ergoblock-block-relationships',
  CHECK_INTERVAL_MS: 500,
  MAX_INJECTION_ATTEMPTS: 20,
};

interface BlockRelationshipsResponse {
  success: boolean;
  error?: string;
  blockedBy?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
  blocking?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
}

interface SettingsResponse {
  blockRelationships?: {
    enabled: boolean;
    displayMode: BlockRelationshipDisplayMode;
    showOnProfiles: boolean;
  };
}

let currentProfileHandle: string | null = null;
let injectionAttempts = 0;
let urlCheckInterval: number | null = null;

/**
 * Get current profile handle from URL
 */
function getProfileHandleFromUrl(): string | null {
  const match = window.location.pathname.match(CONFIG.PROFILE_URL_PATTERN);
  return match ? match[1] : null;
}

/**
 * Resolve handle to DID via public API
 */
async function resolveHandleToDid(handle: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`
    );
    if (!response.ok) return null;
    const profile = (await response.json()) as { did: string };
    return profile.did;
  } catch {
    return null;
  }
}

/**
 * Get block relationships from background
 */
async function getBlockRelationships(
  profileDid: string
): Promise<BlockRelationshipsResponse | null> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_BLOCK_RELATIONSHIPS',
      did: profileDid,
    })) as BlockRelationshipsResponse;
    return response;
  } catch (error) {
    console.error('[ErgoBlock] Failed to get block relationships:', error);
    return null;
  }
}

/**
 * Get settings from storage
 */
async function getSettings(): Promise<SettingsResponse | null> {
  try {
    const result = await browser.storage.local.get('options');
    return result.options as SettingsResponse | null;
  } catch {
    return null;
  }
}

/**
 * Find the insertion point on the profile page
 * Looks for "Followed by" section or profile stats
 */
function findInsertionPoint(): HTMLElement | null {
  // Look for "Followed by" text (multiple languages)
  const allElements = document.querySelectorAll('div, span');
  for (const el of allElements) {
    const text = el.textContent?.toLowerCase() || '';
    if (
      (text.includes('followed by') || text.includes('follows you')) &&
      el.childNodes.length <= 5
    ) {
      // Find the parent container
      let parent = el.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        if (parent.childNodes.length >= 1) {
          return parent as HTMLElement;
        }
        parent = parent.parentElement;
      }
    }
  }

  // Fallback: look for followers/following stats section
  const statsLinks = document.querySelectorAll('a[href*="/followers"], a[href*="/following"]');
  if (statsLinks.length > 0) {
    const firstLink = statsLinks[0];
    let parent = firstLink.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      if (parent.tagName === 'DIV') {
        return parent as HTMLElement;
      }
      parent = parent.parentElement;
    }
  }

  return null;
}

/**
 * Create compact display element
 */
function createCompactDisplay(blockedByCount: number, blockingCount: number): HTMLElement {
  const container = document.createElement('div');
  container.id = CONFIG.INJECTION_CONTAINER_ID;
  container.style.cssText = `
    margin: 8px 0;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 8px;
    font-size: 13px;
    color: #666;
    display: flex;
    align-items: center;
    gap: 6px;
  `;

  const parts: string[] = [];
  if (blockedByCount > 0) {
    parts.push(
      `Blocked by <strong style="color: #dc2626">${blockedByCount}</strong> ${blockedByCount === 1 ? 'person' : 'people'} you follow`
    );
  }
  if (blockingCount > 0) {
    parts.push(
      `Blocking <strong style="color: #f59e0b">${blockingCount}</strong> ${blockingCount === 1 ? 'person' : 'people'} you follow`
    );
  }

  if (parts.length === 0) {
    container.style.background = 'rgba(34, 197, 94, 0.1)';
    container.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <span style="color: #16a34a">No block relationships among your follows</span>
    `;
  } else {
    container.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
      <span>${parts.join(' · ')}</span>
    `;
  }

  return container;
}

/**
 * Create detailed display element
 */
function createDetailedDisplay(
  blockedBy: Array<{ handle: string; displayName?: string; avatar?: string }>,
  blocking: Array<{ handle: string; displayName?: string; avatar?: string }>
): HTMLElement {
  const container = document.createElement('div');
  container.id = CONFIG.INJECTION_CONTAINER_ID;
  container.style.cssText = `
    margin: 8px 0;
    padding: 10px 12px;
    background: rgba(239, 68, 68, 0.08);
    border-radius: 8px;
    font-size: 13px;
  `;

  const defaultAvatar =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23888"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z"/></svg>';

  const createUserList = (
    users: Array<{ handle: string; displayName?: string; avatar?: string }>,
    maxShow = 3
  ): string => {
    const shown = users.slice(0, maxShow);
    const remaining = users.length - maxShow;

    const avatars = shown
      .map(
        (u) => `
        <a href="https://bsky.app/profile/${u.handle}" target="_blank" rel="noopener"
           style="display: inline-block; margin-right: -6px; border-radius: 50%; border: 2px solid white;">
          <img src="${u.avatar || defaultAvatar}" alt="@${u.handle}"
               loading="lazy"
               style="width: 24px; height: 24px; border-radius: 50%; vertical-align: middle;"
               onerror="this.src='${defaultAvatar}'"/>
        </a>
      `
      )
      .join('');

    const names = shown.map((u) => `@${u.handle}`).join(', ');
    const extra = remaining > 0 ? ` and ${remaining} other${remaining === 1 ? '' : 's'}` : '';

    return `
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="display: flex; padding-left: 6px;">${avatars}</div>
        <span style="color: #666;">${names}${extra}</span>
      </div>
    `;
  };

  let html = '';

  if (blockedBy.length === 0 && blocking.length === 0) {
    container.style.background = 'rgba(34, 197, 94, 0.08)';
    html = `
      <div style="display: flex; align-items: center; gap: 8px; color: #16a34a;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        No block relationships among your follows
      </div>
    `;
  } else {
    if (blockedBy.length > 0) {
      html += `
        <div style="margin-bottom: ${blocking.length > 0 ? '8px' : '0'};">
          <div style="font-weight: 500; color: #dc2626; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Blocked by ${blockedBy.length} ${blockedBy.length === 1 ? 'person' : 'people'} you follow
          </div>
          ${createUserList(blockedBy)}
        </div>
      `;
    }

    if (blocking.length > 0) {
      html += `
        <div>
          <div style="font-weight: 500; color: #f59e0b; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Blocking ${blocking.length} ${blocking.length === 1 ? 'person' : 'people'} you follow
          </div>
          ${createUserList(blocking)}
        </div>
      `;
    }
  }

  container.innerHTML = html;
  return container;
}

/**
 * Inject block relationship info into the profile page
 */
async function injectBlockRelationshipInfo(): Promise<void> {
  const handle = getProfileHandleFromUrl();
  if (!handle) return;

  // Don't re-inject for the same profile
  if (handle === currentProfileHandle) {
    const existing = document.getElementById(CONFIG.INJECTION_CONTAINER_ID);
    if (existing) return;
  }

  currentProfileHandle = handle;
  injectionAttempts = 0;

  // Get settings
  const settings = await getSettings();
  if (!settings?.blockRelationships?.enabled || !settings?.blockRelationships?.showOnProfiles) {
    return;
  }

  const displayMode = settings.blockRelationships.displayMode || 'compact';

  // Resolve handle to DID
  const did = await resolveHandleToDid(handle);
  if (!did) {
    console.log('[ErgoBlock] Could not resolve handle:', handle);
    return;
  }

  // Get block relationships
  const relationships = await getBlockRelationships(did);
  if (!relationships?.success) {
    console.log('[ErgoBlock] Could not get block relationships');
    return;
  }

  const blockedBy = relationships.blockedBy || [];
  const blocking = relationships.blocking || [];

  // Try to find insertion point and inject
  const tryInject = () => {
    injectionAttempts++;

    // Remove any existing injection
    const existing = document.getElementById(CONFIG.INJECTION_CONTAINER_ID);
    if (existing) {
      existing.remove();
    }

    const insertionPoint = findInsertionPoint();
    if (!insertionPoint) {
      if (injectionAttempts < CONFIG.MAX_INJECTION_ATTEMPTS) {
        setTimeout(tryInject, CONFIG.CHECK_INTERVAL_MS);
      }
      return;
    }

    // Create and insert the display
    const display =
      displayMode === 'detailed'
        ? createDetailedDisplay(blockedBy, blocking)
        : createCompactDisplay(blockedBy.length, blocking.length);

    // Insert after the insertion point
    insertionPoint.parentNode?.insertBefore(display, insertionPoint.nextSibling);
    console.log('[ErgoBlock] Injected block relationship info for @' + handle);
  };

  tryInject();
}

/**
 * Handle URL changes (SPA navigation)
 */
function handleUrlChange(): void {
  const handle = getProfileHandleFromUrl();

  if (handle && handle !== currentProfileHandle) {
    // New profile page - inject info
    injectBlockRelationshipInfo();
  } else if (!handle) {
    // No longer on a profile page
    currentProfileHandle = null;
    const existing = document.getElementById(CONFIG.INJECTION_CONTAINER_ID);
    if (existing) {
      existing.remove();
    }
  }
}

/**
 * Start observing for profile page navigation
 */
export function observeProfileNavigation(): void {
  // Initial check
  handleUrlChange();

  // Watch for URL changes (SPA navigation)
  let lastUrl = window.location.href;

  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
  }

  urlCheckInterval = window.setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      handleUrlChange();
    }
  }, CONFIG.CHECK_INTERVAL_MS);

  // Also listen for popstate (back/forward navigation)
  window.addEventListener('popstate', handleUrlChange);

  // Watch for DOM changes that might remove our injection
  const observer = new MutationObserver(() => {
    if (currentProfileHandle && !document.getElementById(CONFIG.INJECTION_CONTAINER_ID)) {
      // Our injection was removed (React re-render), re-inject
      injectBlockRelationshipInfo();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[ErgoBlock] Profile navigation observer started');
}

/**
 * Stop observing (cleanup)
 */
export function stopObserving(): void {
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
    urlCheckInterval = null;
  }
  window.removeEventListener('popstate', handleUrlChange);

  const existing = document.getElementById(CONFIG.INJECTION_CONTAINER_ID);
  if (existing) {
    existing.remove();
  }

  currentProfileHandle = null;
}
