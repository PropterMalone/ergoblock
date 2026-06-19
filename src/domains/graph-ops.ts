import { executeApiRequest } from '../platform/api.js';
import type {
  ListRecordsResponse,
  ProfileWithViewer,
  ProfileViewerState,
  AuthData,
} from '../types.js';
import { sleep, createLogger } from '../platform/utils.js';
import { bgApiRequest, getAuthToken } from './api-client.js';

const log = createLogger('bg:graph-ops');

/**
 * Response from app.bsky.actor.getProfiles
 */
interface GetProfilesResponse {
  profiles: ProfileWithViewer[];
}

export async function unblockUser(
  did: string,
  token: string,
  ownerDid: string,
  pdsUrl: string,
  rkey?: string
): Promise<boolean> {
  // If we have the rkey, delete directly (O(1))
  if (rkey) {
    log.info('Unblocking using direct rkey:', rkey);
    await bgApiRequest(
      'com.atproto.repo.deleteRecord',
      'POST',
      {
        repo: ownerDid,
        collection: 'app.bsky.graph.block',
        rkey,
      },
      token,
      pdsUrl
    );
    return true;
  }

  // Fallback: find the block record by paginating through all blocks (legacy method, O(N))
  log.info('Unblocking using list scan (legacy)...');
  let cursor: string | undefined;
  let foundRkey: string | undefined;

  while (!foundRkey) {
    const url = cursor
      ? `com.atproto.repo.listRecords?repo=${ownerDid}&collection=app.bsky.graph.block&limit=100&cursor=${cursor}`
      : `com.atproto.repo.listRecords?repo=${ownerDid}&collection=app.bsky.graph.block&limit=100`;

    const blocks = await bgApiRequest<ListRecordsResponse>(url, 'GET', null, token, pdsUrl);

    const blockRecord = blocks?.records?.find((r) => r.value.subject === did);
    if (blockRecord) {
      const rkeyPart = blockRecord.uri.split('/').pop();
      // Guard against an empty trailing segment (malformed uri) — treat as not found
      // so we keep scanning / ultimately throw rather than delete with an empty rkey.
      if (rkeyPart) {
        foundRkey = rkeyPart;
        break;
      }
    }

    // Check if there are more pages
    if (!blocks?.cursor) {
      // Scan is provably complete (cursor exhausted) and we found no usable rkey.
      // THROW rather than return false: the caller (expiration) must preserve the local
      // record and retry instead of deleting it and orphaning the block on Bluesky.
      log.info('No block record found for', did, 'after complete scan');
      throw new Error(`No block record found for ${did} (unblock rkey unresolved)`);
    }
    cursor = blocks.cursor;
  }

  await bgApiRequest(
    'com.atproto.repo.deleteRecord',
    'POST',
    {
      repo: ownerDid,
      collection: 'app.bsky.graph.block',
      rkey: foundRkey,
    },
    token,
    pdsUrl
  );

  return true;
}

export async function unmuteUser(did: string, token: string, pdsUrl: string): Promise<boolean> {
  await bgApiRequest('app.bsky.graph.unmuteActor', 'POST', { actor: did }, token, pdsUrl);
  return true;
}

export async function muteUser(did: string, token: string, pdsUrl: string): Promise<boolean> {
  await bgApiRequest('app.bsky.graph.muteActor', 'POST', { actor: did }, token, pdsUrl);
  return true;
}

/**
 * Block a user (used for re-blocking after temp unblock)
 */
export async function blockUser(
  did: string,
  token: string,
  ownerDid: string,
  pdsUrl: string
): Promise<{ uri: string; cid: string } | null> {
  const record = {
    $type: 'app.bsky.graph.block',
    subject: did,
    createdAt: new Date().toISOString(),
  };

  return bgApiRequest<{ uri: string; cid: string }>(
    'com.atproto.repo.createRecord',
    'POST',
    {
      repo: ownerDid,
      collection: 'app.bsky.graph.block',
      record,
    },
    token,
    pdsUrl
  );
}

/**
 * Fetch profiles in batches (max 25 per request)
 * Returns array of ProfileWithViewer
 * Uses public API (AppView) for getProfiles endpoint
 */
export async function fetchProfiles(
  dids: string[],
  accessJwt: string,
  pdsUrl: string = 'https://bsky.social'
): Promise<ProfileWithViewer[]> {
  const result: ProfileWithViewer[] = [];
  const batchSize = 25;
  const publicApi = 'https://public.api.bsky.app';

  for (let i = 0; i < dids.length; i += batchSize) {
    const batch = dids.slice(i, i + batchSize);
    const params = batch.map((d) => `actors=${encodeURIComponent(d)}`).join('&');

    try {
      // Use public API for getProfiles (not PDS)
      const response = await executeApiRequest<GetProfilesResponse>(
        `app.bsky.actor.getProfiles?${params}`,
        'GET',
        null,
        { accessJwt, pdsUrl },
        publicApi
      );

      if (response?.profiles) {
        result.push(...response.profiles);
      }
    } catch (error) {
      log.error('Error fetching profiles:', error);
    }

    // Rate limit between batches
    if (i + batchSize < dids.length) {
      await sleep(200);
    }
  }

  return result;
}

/**
 * Fetch profiles with viewer state in batches (max 25 per request)
 * Returns a Map of DID -> ProfileViewerState
 */
export async function fetchViewerStates(
  auth: AuthData,
  dids: string[]
): Promise<Map<string, ProfileViewerState>> {
  const result = new Map<string, ProfileViewerState>();
  const batchSize = 25;

  for (let i = 0; i < dids.length; i += batchSize) {
    const batch = dids.slice(i, i + batchSize);
    const params = batch.map((d) => `actors=${encodeURIComponent(d)}`).join('&');

    try {
      const response = await bgApiRequest<GetProfilesResponse>(
        `app.bsky.actor.getProfiles?${params}`,
        'GET',
        null,
        auth.accessJwt,
        auth.pdsUrl
      );

      if (response?.profiles) {
        for (const profile of response.profiles) {
          if (profile.viewer) {
            result.set(profile.did, profile.viewer);
          }
        }
      }
    } catch (error) {
      log.error('Error fetching viewer states:', error);
    }

    // Rate limit between batches
    if (i + batchSize < dids.length) {
      await sleep(200);
    }
  }

  return result;
}

/**
 * Handle GET_PROFILES_BATCHED message - fetch profiles with auth
 */
export async function handleGetProfilesBatched(dids: string[]): Promise<{
  success: boolean;
  profiles?: Record<string, ProfileWithViewer>;
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth) {
      return { success: false, error: 'Not authenticated' };
    }
    const profiles = await fetchProfiles(dids, auth.accessJwt, auth.pdsUrl);
    const profileMap: Record<string, ProfileWithViewer> = {};
    for (const profile of profiles) {
      profileMap[profile.did] = profile;
    }
    return { success: true, profiles: profileMap };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
