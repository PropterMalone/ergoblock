// AT Protocol API helpers for Bluesky
// Handles block/mute/unblock/unmute operations

// Public Bluesky API endpoint (AppView) - use this for most operations
const BSKY_PUBLIC_API = 'https://public.api.bsky.app';
// User's PDS for repo operations
const BSKY_PDS_DEFAULT = 'https://bsky.social';

/**
 * Get the current session from Bluesky's localStorage
 * @returns {Object|null} Session object with accessJwt and did
 */
function getSession() {
  try {
    // Try multiple possible storage key patterns
    const possibleKeys = Object.keys(localStorage).filter(k =>
      k.includes('BSKY') || k.includes('bsky') || k.includes('session')
    );

    console.log('[TempBlock] Found storage keys:', possibleKeys);

    for (const storageKey of possibleKeys) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) continue;

        const storage = JSON.parse(raw);
        console.log('[TempBlock] Checking storage key:', storageKey, storage);

        // Try different possible structures
        let session = null;

        // Structure 1: { session: { currentAccount: {...}, accounts: [...] } }
        if (storage?.session?.currentAccount) {
          const currentDid = storage.session.currentAccount.did;
          const account = storage.session.accounts?.find(a => a.did === currentDid);
          if (account?.accessJwt) {
            session = account;
          }
        }

        // Structure 2: { currentAccount: {...}, accounts: [...] }
        if (!session && storage?.currentAccount) {
          const currentDid = storage.currentAccount.did;
          const account = storage.accounts?.find(a => a.did === currentDid);
          if (account?.accessJwt) {
            session = account;
          }
        }

        // Structure 3: Direct account object
        if (!session && storage?.accessJwt && storage?.did) {
          session = storage;
        }

        if (session) {
          console.log('[TempBlock] Found session for:', session.handle || session.did);
          // Normalize the PDS URL
          let pdsUrl = session.pdsUrl || session.service || BSKY_PDS_DEFAULT;
          // Remove trailing slashes
          pdsUrl = pdsUrl.replace(/\/+$/, '');
          // Ensure https:// prefix
          if (!pdsUrl.startsWith('http://') && !pdsUrl.startsWith('https://')) {
            pdsUrl = 'https://' + pdsUrl;
          }
          console.log('[TempBlock] Using PDS URL:', pdsUrl);
          return {
            accessJwt: session.accessJwt,
            refreshJwt: session.refreshJwt,
            did: session.did,
            handle: session.handle,
            pdsUrl
          };
        }
      } catch (e) {
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
 * Make an authenticated API request
 * @param {string} endpoint - API endpoint
 * @param {string} method - HTTP method
 * @param {Object} body - Request body
 * @param {string} baseUrl - Override base URL (for PDS vs AppView)
 */
async function apiRequest(endpoint, method = 'GET', body = null, baseUrl = null) {
  const session = getSession();
  if (!session) {
    throw new Error('Not logged in to Bluesky');
  }

  // Determine correct base URL:
  // - com.atproto.repo.* endpoints go to user's PDS
  // - app.bsky.* endpoints go to public API (AppView)
  let base = baseUrl;
  if (!base) {
    if (endpoint.startsWith('com.atproto.repo.')) {
      base = session.pdsUrl;
    } else {
      base = BSKY_PUBLIC_API;
    }
  }

  // Normalize base URL - remove trailing slashes
  base = base.replace(/\/+$/, '');

  const url = `${base}/xrpc/${endpoint}`;
  console.log('[TempBlock] API request:', method, url);

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('[TempBlock] API error:', response.status, error);
    throw new Error(error.message || `API error: ${response.status}`);
  }

  // Some endpoints return empty responses
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Block a user
 * @param {string} did - DID of user to block
 */
async function blockUser(did) {
  const session = getSession();
  if (!session) throw new Error('Not logged in');

  const record = {
    $type: 'app.bsky.graph.block',
    subject: did,
    createdAt: new Date().toISOString()
  };

  return apiRequest('com.atproto.repo.createRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.graph.block',
    record
  });
}

/**
 * Unblock a user
 * @param {string} did - DID of user to unblock
 */
async function unblockUser(did) {
  const session = getSession();
  if (!session) throw new Error('Not logged in');

  // First, find the block record
  const blocks = await apiRequest(
    `com.atproto.repo.listRecords?repo=${session.did}&collection=app.bsky.graph.block&limit=100`
  );

  const blockRecord = blocks.records?.find(r => r.value.subject === did);
  if (!blockRecord) {
    console.log('[TempBlock] No block record found for', did);
    return null;
  }

  // Delete the block record
  const rkey = blockRecord.uri.split('/').pop();
  return apiRequest('com.atproto.repo.deleteRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.graph.block',
    rkey
  });
}

/**
 * Mute a user
 * @param {string} did - DID of user to mute
 */
async function muteUser(did) {
  const session = getSession();
  if (!session) throw new Error('Not logged in');
  // Mute goes to user's PDS
  return apiRequest('app.bsky.graph.muteActor', 'POST', {
    actor: did
  }, session.pdsUrl);
}

/**
 * Unmute a user
 * @param {string} did - DID of user to unmute
 */
async function unmuteUser(did) {
  const session = getSession();
  if (!session) throw new Error('Not logged in');
  // Unmute goes to user's PDS
  return apiRequest('app.bsky.graph.unmuteActor', 'POST', {
    actor: did
  }, session.pdsUrl);
}

/**
 * Get a user's profile by handle or DID
 * @param {string} actor - Handle or DID
 */
async function getProfile(actor) {
  return apiRequest(`app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.BlueskyAPI = {
    getSession,
    blockUser,
    unblockUser,
    muteUser,
    unmuteUser,
    getProfile
  };
}
