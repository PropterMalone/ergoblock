/**
 * Bluesky AT Protocol API helpers
 * Handles block/mute/unblock/unmute operations
 */

// API endpoints
const BSKY_PUBLIC_API = 'https://public.api.bsky.app';
const BSKY_PDS_DEFAULT = 'https://bsky.social';

// Interfaces
export interface BlueskySession {
  accessJwt: string;
  refreshJwt?: string;
  did: string;
  handle?: string;
  pdsUrl: string;
}

export interface BlueskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
}

interface CreateRecordResponse {
  uri: string;
  cid: string;
}

interface ListRecordsResponse {
  records?: Array<{
    uri: string;
    value: { subject: string };
  }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any, no-undef */
/**
 * Get the current session from Bluesky's localStorage
 */
export function getSession(): BlueskySession | null {
  try {
    // Try multiple possible storage key patterns
    const possibleKeys = Object.keys(localStorage).filter(
      (k) => k.includes('BSKY') || k.includes('bsky') || k.includes('session')
    );

    console.log('[TempBlock] Found storage keys:', possibleKeys);

    for (const storageKey of possibleKeys) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) continue;

        const storage = JSON.parse(raw);
        console.log('[TempBlock] Checking storage key:', storageKey, storage);

        // Try different possible structures
        let session: any = null;

        // Structure 1: { session: { currentAccount: {...}, accounts: [...] } }
        if (storage?.session?.currentAccount) {
          const currentDid = storage.session.currentAccount.did;
          const account = storage.session.accounts?.find((a: any) => a.did === currentDid);
          if (account?.accessJwt) {
            session = account;
          }
        }

        // Structure 2: { currentAccount: {...}, accounts: [...] }
        if (!session && storage?.currentAccount) {
          const currentDid = storage.currentAccount.did;
          const account = storage.accounts?.find((a: any) => a.did === currentDid);
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
            pdsUrl,
          };
        }
      } catch {
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
 */
async function apiRequest<T>(
  endpoint: string,
  method: string = 'GET',
  body: unknown = null,
  baseUrl: string | null = null
): Promise<T | null> {
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

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
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
    throw new Error(error.message || `API error: ${response.status}`);
  }

  // Some endpoints return empty responses
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

/**
 * Block a user
 */
export async function blockUser(did: string): Promise<CreateRecordResponse> {
  const session = getSession();
  if (!session) throw new Error('Not logged in');

  const record = {
    $type: 'app.bsky.graph.block',
    subject: did,
    createdAt: new Date().toISOString(),
  };

  return (await apiRequest<CreateRecordResponse>('com.atproto.repo.createRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.graph.block',
    record,
  })) as CreateRecordResponse;
}

/**
 * Unblock a user
 */
export async function unblockUser(did: string): Promise<void> {
  const session = getSession();
  if (!session) throw new Error('Not logged in');

  // First, find the block record
  const blocks = await apiRequest<ListRecordsResponse>(
    `com.atproto.repo.listRecords?repo=${session.did}&collection=app.bsky.graph.block&limit=100`
  );

  const blockRecord = blocks?.records?.find((r) => r.value.subject === did);
  if (!blockRecord) {
    console.log('[TempBlock] No block record found for', did);
    return;
  }

  // Delete the block record
  const rkey = blockRecord.uri.split('/').pop();
  await apiRequest('com.atproto.repo.deleteRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.graph.block',
    rkey,
  });
}

/**
 * Mute a user
 */
export async function muteUser(did: string): Promise<void> {
  const session = getSession();
  if (!session) throw new Error('Not logged in');
  // Mute goes to user's PDS
  await apiRequest(
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
 */
export async function unmuteUser(did: string): Promise<void> {
  const session = getSession();
  if (!session) throw new Error('Not logged in');
  // Unmute goes to user's PDS
  await apiRequest(
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
 */
export async function getProfile(actor: string): Promise<BlueskyProfile> {
  const result = await apiRequest<BlueskyProfile>(
    `app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`
  );
  if (!result) throw new Error('Profile not found');
  return result;
}
