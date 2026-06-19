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
 * Last-resort refresh: call com.atproto.server.refreshSession directly with the stored
 * refreshJwt. This rotates the refresh token server-side, which can log the user out of the
 * Bluesky webapp — so it is used ONLY as a fallback when requestFreshAuth() found no open
 * Bluesky tab. With no tab there is no live webapp session to disrupt, and without this the
 * action silently fails (the historical "block sometimes doesn't take" bug).
 */
export async function refreshViaRefreshToken(auth: AuthData): Promise<AuthData | null> {
  if (!auth.refreshJwt) {
    log.info('No refresh token stored; cannot refresh directly');
    return null;
  }
  try {
    const response = await fetch(`${auth.pdsUrl}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.refreshJwt}` },
    });
    if (!response.ok) {
      log.error(`Direct refreshSession failed: ${response.status}`);
      return null;
    }
    const data = (await response.json()) as {
      accessJwt?: string;
      refreshJwt?: string;
      did?: string;
    };
    if (!data.accessJwt || !data.did) {
      log.error('refreshSession response missing accessJwt/did');
      return null;
    }
    // DID cross-check: reject a refresh that returns a different DID than the stored
    // session. A poisoned/migrated pdsUrl could otherwise hand us another account's
    // tokens, and we'd write them as the user's auth (DID-substitution).
    if (data.did !== auth.did) {
      log.error('refreshSession returned a different DID; rejecting', { expected: auth.did });
      return null;
    }
    const newAuth: AuthData = {
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt ?? auth.refreshJwt,
      did: data.did,
      pdsUrl: auth.pdsUrl,
    };
    await browser.storage.local.set({ authToken: newAuth, authStatus: 'valid' });
    log.info('Refreshed session via stored refresh token');
    return newAuth;
  } catch (error) {
    log.error('Direct refreshSession error:', error);
    return null;
  }
}

/**
 * Get fresh auth tokens when the current access token is expired.
 *
 * Strategy: prefer an open Bluesky tab (requestFreshAuth) — it has a fresh token and does NOT
 * rotate the refresh token, so the webapp stays logged in. Only when no tab is available do we
 * fall back to a direct refreshSession using the stored refreshJwt. This fixes the intermittent
 * "fails to take" failure (no tab open → token expired → action silently dropped) while keeping
 * the no-rotation path primary.
 *
 * NOTE: This tab-first + direct-fallback strategy SUPERSEDES the earlier "do NOT call
 * refreshSession" decision. That rule existed to avoid rotating the refresh token (which logs
 * the webapp out), but its side effect was the "block fails to take when no tab is open" bug:
 * with no live session to disrupt and no tab to source fresh auth from, the action was dropped.
 * The fallback only fires when there is no tab, so nothing the user can see gets logged out.
 */
export async function refreshSession(auth: AuthData): Promise<AuthData | null> {
  log.info('Access token expired, requesting fresh auth from tab');
  const fromTab = await requestFreshAuth();
  if (fromTab) return fromTab;
  log.info('No Bluesky tab available; falling back to direct refreshSession');
  return refreshViaRefreshToken(auth);
}

const BSKY_PUBLIC_API = 'https://public.api.bsky.app';

/**
 * Decide the target base URL for a background API request.
 *
 * Repo operations (com.atproto.repo.*) and most com.atproto.* server calls are writes
 * to / reads from the user's own repo and MUST hit the PDS for write consistency.
 * AppView reads (app.bsky.* GETs such as actor.getProfiles, graph.getBlocks/getMutes)
 * are served by the public AppView, not the user's PDS — forcing them to the PDS 404s
 * on third-party PDSes. Auth headers are still sent, so viewer state still resolves.
 */
function resolveBgBase(endpoint: string, method: string, pdsUrl: string): string {
  if (endpoint.startsWith('app.bsky.') && method === 'GET') {
    return BSKY_PUBLIC_API;
  }
  return pdsUrl;
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
  const base = resolveBgBase(endpoint, method, pdsUrl);
  const doRequest = async (accessJwt: string): Promise<T | null> => {
    const result = await executeApiRequest<T>(endpoint, method, body, { accessJwt, pdsUrl }, base);
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
      // Treat an expired token (400 ExpiredToken) AND a 401/Auth error the same way: both mean
      // the access token is no longer accepted, so attempt a refresh + single retry before
      // declaring the session invalid. (Previously a 401 skipped the refresh path entirely.)
      const isAuthError =
        isExpiredTokenError(error) ||
        error.message.includes('401') ||
        error.message.includes('Auth error');

      if (isAuthError) {
        log.info('Auth/token error, attempting refresh...');

        const auth = await getAuthToken();
        if (!auth) {
          log.error('No auth available for refresh');
          await browser.storage.local.set({ authStatus: 'invalid' });
          throw error;
        }

        const newAuth = await refreshSession(auth);
        if (newAuth) {
          log.info('Retrying request with refreshed token...');
          try {
            const result = await doRequest(newAuth.accessJwt);
            await browser.storage.local.set({ authStatus: 'valid' });
            return result;
          } catch (retryError) {
            log.error('Retry after refresh failed:', retryError);
            await browser.storage.local.set({ authStatus: 'invalid' });
            throw retryError;
          }
        }
        log.error('Token refresh failed, marking session invalid');
        await browser.storage.local.set({ authStatus: 'invalid' });
        throw error;
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
