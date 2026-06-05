import browser from '../platform/browser.js';
import { executeApiRequest } from '../platform/api.js';
import { getOptions } from '../platform/storage.js';
import type { AuthData, DidDocument } from '../types.js';
import { createLogger, LRUCache } from '../platform/utils.js';

const log = createLogger('bg:api-client');

export const PLC_DIRECTORY = 'https://plc.directory';
export const PAGINATION_DELAY = 100; // ms between paginated requests (was 500ms)

export async function getAuthToken(): Promise<AuthData | null> {
  const result = await browser.storage.local.get('authToken');
  return (result.authToken as AuthData) || null;
}

/**
 * Request fresh auth from content scripts
 * Sends a message to all tabs with bsky.app to trigger auth sync
 * Returns fresh auth if available, or null
 */
export async function requestFreshAuth(): Promise<AuthData | null> {
  try {
    // Query all tabs that might have Bluesky open
    const tabs = await browser.tabs.query({ url: '*://*.bsky.app/*' });

    if (tabs.length === 0) {
      log.info('No Bluesky tabs found for auth refresh');
      return null;
    }

    // Request auth from the first available tab
    for (const tab of tabs) {
      if (tab.id) {
        try {
          const response = (await browser.tabs.sendMessage(tab.id, { type: 'REQUEST_AUTH' })) as
            | { auth: AuthData | null }
            | undefined;
          if (response?.auth) {
            // Store the fresh auth
            await browser.storage.local.set({ authToken: response.auth, authStatus: 'valid' });
            log.info('Got fresh auth from tab', tab.id);
            return response.auth;
          }
        } catch {
          // Tab might not have content script loaded, try next
          continue;
        }
      }
    }

    log.info('Could not get fresh auth from any tab');
    return null;
  } catch (error) {
    log.error('Error requesting fresh auth:', error);
    return null;
  }
}

/**
 * Check if an error indicates an expired token
 */
export function isExpiredTokenError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('expiredtoken') ||
    message.includes('token has expired') ||
    message.includes('expired token')
  );
}

/**
 * Get fresh auth tokens when the current access token is expired.
 * Always delegates to requestFreshAuth() to get tokens from the Bluesky webapp.
 *
 * IMPORTANT: We intentionally do NOT call com.atproto.server.refreshSession directly,
 * because that rotates the refresh token server-side, which would invalidate the
 * webapp's copy of the refresh token and log the user out of Bluesky.
 */
export async function refreshSession(_auth: AuthData): Promise<AuthData | null> {
  log.info('Access token expired, requesting fresh auth from tab');
  return requestFreshAuth();
}

/**
 * Wrapper for API requests that handles auth status updates and token refresh
 */
export async function bgApiRequest<T>(
  endpoint: string,
  method: string,
  body: unknown,
  token: string,
  pdsUrl: string
): Promise<T | null> {
  const doRequest = async (accessJwt: string): Promise<T | null> => {
    const result = await executeApiRequest<T>(
      endpoint,
      method,
      body,
      { accessJwt, pdsUrl },
      pdsUrl // Force PDS for background operations to ensure write consistency
    );
    return result;
  };

  try {
    // Background operations should always use the PDS to ensure consistent writes to the user's repo.
    const result = await doRequest(token);

    // If request was successful, ensure status is valid
    await browser.storage.local.set({ authStatus: 'valid' });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      // Check for expired token error (400 with ExpiredToken)
      if (isExpiredTokenError(error)) {
        log.info('Token expired, attempting refresh...');

        // Get current auth to access refresh token
        const auth = await getAuthToken();
        if (!auth) {
          log.error('No auth available for refresh');
          await browser.storage.local.set({ authStatus: 'invalid' });
          throw error;
        }

        // Try to refresh the token
        const newAuth = await refreshSession(auth);
        if (newAuth) {
          // Retry the request with the new token
          log.info('Retrying request with refreshed token...');
          try {
            const result = await doRequest(newAuth.accessJwt);
            await browser.storage.local.set({ authStatus: 'valid' });
            return result;
          } catch (retryError) {
            log.error('Retry after refresh failed:', retryError);
            throw retryError;
          }
        } else {
          log.error('Token refresh failed, marking session invalid');
          await browser.storage.local.set({ authStatus: 'invalid' });
          throw error;
        }
      }

      // Check for 401 auth errors
      if (error.message.includes('401') || error.message.includes('Auth error')) {
        log.error('Auth failed (401), marking session invalid');
        await browser.storage.local.set({ authStatus: 'invalid' });
      }
    }
    throw error;
  }
}

// CRITICAL FIX #2: Use LRU cache with TTL to prevent unbounded memory growth
// Max 1000 entries, 4 hour TTL (PDS URLs rarely change but can migrate)
const pdsCache = new LRUCache<string, string>(1000, 4 * 60 * 60 * 1000);

/**
 * Resolve a DID to its PDS URL by looking up the DID document
 * @see https://atproto.com/guides/identity
 */
export async function resolvePdsUrl(did: string): Promise<string | null> {
  // Check cache first (LRU cache handles TTL automatically)
  const cached = pdsCache.get(did);
  if (cached) {
    return cached;
  }

  try {
    // Resolve DID document from PLC directory
    const response = await fetch(`${PLC_DIRECTORY}/${did}`);
    if (!response.ok) {
      log.error(`Failed to resolve DID ${did}: ${response.status}`);
      return null;
    }

    const didDoc = (await response.json()) as DidDocument;

    // Find the atproto PDS service endpoint
    const pdsService = didDoc.service?.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
    );

    if (!pdsService?.serviceEndpoint) {
      log.error(`No PDS service found for ${did}`);
      return null;
    }

    // Cache the result (LRU cache handles eviction automatically)
    pdsCache.set(did, pdsService.serviceEndpoint);
    return pdsService.serviceEndpoint;
  } catch (error) {
    log.error(`Error resolving PDS for ${did}:`, error);
    return null;
  }
}

export async function sendNotification(
  type: 'expired_success' | 'expired_failure',
  handle: string,
  action: 'block' | 'mute',
  error?: string
): Promise<void> {
  const options = await getOptions();
  if (!options.notificationsEnabled) {
    return;
  }

  let title: string;
  let message: string;

  if (type === 'expired_success') {
    title = '✅ Temporary action expired';
    message = `Your temporary ${action} of @${handle} has been lifted`;
  } else {
    title = '⚠️ Action failed';
    message = `Failed to ${action} @${handle}: ${error || 'Unknown error'}`;
  }

  // Cast needed because 'silent' is Chrome-specific, not in webextension-polyfill types
  await browser.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    silent: !options.notificationSound,
  } as browser.Notifications.CreateNotificationOptions & { silent?: boolean });
}

/**
 * Make a public API request (no auth needed) to the Bluesky public API
 */
export async function bgApiRequestPublic<T>(endpoint: string): Promise<T | null> {
  const BSKY_PUBLIC_API = 'https://public.api.bsky.app';
  try {
    const response = await fetch(`${BSKY_PUBLIC_API}/xrpc/${endpoint}`);
    if (!response.ok) {
      log.error(`Public API request failed: ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    log.error('Public API request error:', error);
    return null;
  }
}
