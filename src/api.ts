import { BskySession, BskyAccount, StorageStructure, Profile } from './types.js';

// AT Protocol API helpers for Bluesky
// Handles block/mute/unblock/unmute operations

// Public Bluesky API endpoint (AppView) - use this for most operations
const BSKY_PUBLIC_API = 'https://public.api.bsky.app';
// User's PDS for repo operations
const BSKY_PDS_DEFAULT = 'https://bsky.social';

// Helper to safely access localStorage
const getLocalStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
};

/**
 * Get the current session from Bluesky's localStorage
 * @returns {Object|null} Session object with accessJwt and did
 */
export function getSession(): BskySession | null {
  try {
    const localStorageProxy = getLocalStorage();
    if (!localStorageProxy) return null;

    // Try multiple possible storage key patterns
    const possibleKeys = Object.keys(localStorageProxy).filter(
      (k) => k.includes('BSKY') || k.includes('bsky') || k.includes('session')
    );

    console.log('[TempBlock] Found storage keys:', possibleKeys);

    for (const storageKey of possibleKeys) {
      try {
        const raw = localStorageProxy.getItem(storageKey);
        if (!raw) continue;

        const parsed = JSON.parse(raw) as StorageStructure;
        console.log('[TempBlock] Checking storage key:', storageKey);

        // Try different possible structures
        let account: BskyAccount | null = null;

        // Structure 1: { session: { currentAccount: {...}, accounts: [...] } }
        if (parsed?.session?.currentAccount) {
          const currentDid = parsed.session.currentAccount.did;
          account = parsed.session.accounts?.find((a) => a.did === currentDid) || null;
        }

        // Structure 2: { currentAccount: {...}, accounts: [...] }
        if (!account && parsed?.currentAccount) {
          const currentDid = parsed.currentAccount.did;
          account = parsed.accounts?.find((a) => a.did === currentDid) || null;
        }

        // Structure 3: Direct account object
        if (!account && parsed?.accessJwt && parsed?.did) {
          account = parsed as unknown as BskyAccount;
        }

        if (account && account.accessJwt && account.did) {
          console.log('[TempBlock] Found session for:', account.handle || account.did);
          // Normalize the PDS URL
          let pdsUrl = account.pdsUrl || account.service || BSKY_PDS_DEFAULT;
          // Remove trailing slashes
          pdsUrl = pdsUrl.replace(/\/+$/, '');
          // Ensure https:// prefix
          if (!pdsUrl.startsWith('http://') && !pdsUrl.startsWith('https://')) {
            pdsUrl = 'https://' + pdsUrl;
          }
          console.log('[TempBlock] Using PDS URL:', pdsUrl);

          return {
            accessJwt: account.accessJwt,
            refreshJwt: account.refreshJwt,
            did: account.did,
            handle: account.handle || '',
            pdsUrl,
          };
        }
      } catch (_e) {
        // Continue to next key
      }
    }

    console.error('[TempBlock] No valid session found in localStorage');
    return null;
  } catch (e) {
    console.error('[TempBlock] Failed to get session:', e);
    return null;
  }
}

/**
 * Execute an authenticated API request
 * Shared logic for both content script (localStorage) and background (chrome.storage)
 */
export async function executeApiRequest<T>(
  endpoint: string,
  method: string,
  body: unknown,
  auth: { accessJwt: string; pdsUrl: string },
  targetBaseUrl?: string
): Promise<T | null> {
  // Determine correct base URL:
  // - com.atproto.repo.* endpoints go to user's PDS
  // - app.bsky.* endpoints go to public API (AppView) unless overridden
  let base = targetBaseUrl;

  if (!base) {
    if (endpoint.startsWith('com.atproto.repo.')) {
      base = auth.pdsUrl;
    } else {
      base = BSKY_PUBLIC_API;
    }
  }

  if (!base) {
    throw new Error('Could not determine base URL for API request');
  }

  // Normalize base URL - remove trailing slashes
  base = base.replace(/\/+$/, '');

  const url = `${base}/xrpc/${endpoint}`;
  console.log('[TempBlock] API request:', method, url);

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessJwt}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    console.error('[TempBlock] API error:', response.status, error);

    // Throw specific error for 401 to help background worker detect auth failure
    if (response.status === 401) {
      throw new Error(`Auth error: ${response.status} ${error.message || ''}`);
    }

    throw new Error(error.message || `API error: ${response.status}`);
  }

  // Some endpoints return empty responses
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

/**
 * Make an authenticated API request (using local session)
 * @param {string} endpoint - API endpoint
 * @param {string} method - HTTP method
 * @param {Object} body - Request body
 * @param {string} baseUrl - Override base URL (for PDS vs AppView)
 */
async function apiRequest<T>(
  endpoint: string,
  method = 'GET',
  body: unknown = null,
  baseUrl: string | null = null
): Promise<T | null> {
  const session = getSession();
  if (!session) {
    throw new Error('Not logged in to Bluesky');
  }

  return executeApiRequest<T>(
    endpoint,
    method,
    body,
    { accessJwt: session.accessJwt, pdsUrl: session.pdsUrl },
    baseUrl || undefined
  );
}

/**
 * Block a user
 * @param {string} did - DID of user to block
 * @returns {Promise<{ uri: string; cid: string } | null>} The created record info
 */
export async function blockUser(did: string): Promise<{ uri: string; cid: string } | null> {
  const session = getSession();
  if (!session) throw new Error('Not logged in');

  const record = {
    $type: 'app.bsky.graph.block',
    subject: did,
    createdAt: new Date().toISOString(),
  };

  return apiRequest<{ uri: string; cid: string }>('com.atproto.repo.createRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.graph.block',
    record,
  });
}

/**
 * Unblock a user
 * @param {string} did - DID of user to unblock
 * @param {string} [rkey] - Optional record key for direct deletion
 */
export async function unblockUser(did: string, rkey?: string): Promise<unknown> {
  const session = getSession();
  if (!session) throw new Error('Not logged in');

  // If we have the rkey, delete directly (O(1))
  if (rkey) {
    console.log('[TempBlock] Unblocking using direct rkey:', rkey);
    return apiRequest('com.atproto.repo.deleteRecord', 'POST', {
      repo: session.did,
      collection: 'app.bsky.graph.block',
      rkey,
    });
  }

  // Fallback: find the block record (legacy method, O(N))
  console.log('[TempBlock] Unblocking using list scan (legacy)...');
  const blocks = await apiRequest<{ records?: Array<{ value: { subject: string }; uri: string }> }>(
    `com.atproto.repo.listRecords?repo=${session.did}&collection=app.bsky.graph.block&limit=100`
  );

  const blockRecord = blocks?.records?.find((r) => r.value.subject === did);
  if (!blockRecord) {
    console.log('[TempBlock] No block record found for', did);
    return null;
  }

  // Delete the block record
  const foundRkey = blockRecord.uri.split('/').pop();
  return apiRequest('com.atproto.repo.deleteRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.graph.block',
    rkey: foundRkey,
  });
}

/**
 * Mute a user
 * @param {string} did - DID of user to mute
 */
export async function muteUser(did: string): Promise<unknown> {
  const session = getSession();
  if (!session) throw new Error('Not logged in');
  // Mute goes to user's PDS
  return apiRequest(
    'app.bsky.graph.muteActor',
    'POST',
    {
      actor: did,
    },
    session.pdsUrl
  );
}

/**
 * Unmute a user
 * @param {string} did - DID of user to unmute
 */
export async function unmuteUser(did: string): Promise<unknown> {
  const session = getSession();
  if (!session) throw new Error('Not logged in');
  // Unmute goes to user's PDS
  return apiRequest(
    'app.bsky.graph.unmuteActor',
    'POST',
    {
      actor: did,
    },
    session.pdsUrl
  );
}

/**
 * Get a user's profile by handle or DID
 * @param {string} actor - Handle or DID
 */
export async function getProfile(actor: string): Promise<Profile | null> {
  return apiRequest<Profile>(`app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
}
