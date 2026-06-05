import browser from '../platform/browser.js';
import type { ProfileView, GetFollowsResponse, GetFollowersResponse, AuthData } from '../types.js';
import { getSocialGraph, setFollowsHandles, getFollowsHandles } from '../platform/storage.js';
import { fetchAndParseRepo } from './carRepo.js';
import { sleep, createLogger, Mutex } from '../platform/utils.js';
import { getAuthToken, bgApiRequest, resolvePdsUrl, PAGINATION_DELAY } from './api-client.js';

const log = createLogger('bg:social-graph');

// In-memory cache for follows/followers (used by amnesty review)
const followsCache: {
  data: ProfileView[] | null;
  fetchedAt: number;
} = { data: null, fetchedAt: 0 };

const followersCache: {
  data: ProfileView[] | null;
  fetchedAt: number;
} = { data: null, fetchedAt: 0 };

const FOLLOW_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const followsSyncMutex = new Mutex();

/**
 * Invalidate the follows cache (e.g. after copy-user or duplicate-follows cleanup)
 */
export function invalidateFollowsCache(): void {
  followsCache.data = null;
  followsCache.fetchedAt = 0;
}

/**
 * Fetch all follows for a user (with caching)
 */
export async function fetchAllFollows(auth: AuthData): Promise<ProfileView[]> {
  // Check cache first
  if (followsCache.data && Date.now() - followsCache.fetchedAt < FOLLOW_CACHE_TTL_MS) {
    log.info(`Using cached follows (${followsCache.data.length} entries)`);
    return followsCache.data;
  }
  const allFollows: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    // Re-read auth on each iteration to pick up any refreshed tokens
    const currentAuth = (await getAuthToken()) || auth;

    let endpoint = `app.bsky.graph.getFollows?actor=${encodeURIComponent(auth.did)}&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetFollowsResponse>(
      endpoint,
      'GET',
      null,
      currentAuth.accessJwt,
      currentAuth.pdsUrl
    );

    if (response?.follows) {
      allFollows.push(...response.follows);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  // Update cache
  followsCache.data = allFollows;
  followsCache.fetchedAt = Date.now();
  log.info(`Cached ${allFollows.length} follows`);

  return allFollows;
}

/**
 * Fetch all followers for a user (with caching)
 */
export async function fetchAllFollowers(auth: AuthData): Promise<ProfileView[]> {
  // Check cache first
  if (followersCache.data && Date.now() - followersCache.fetchedAt < FOLLOW_CACHE_TTL_MS) {
    log.info(`Using cached followers (${followersCache.data.length} entries)`);
    return followersCache.data;
  }

  const allFollowers: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    // Re-read auth on each iteration to pick up any refreshed tokens
    const currentAuth = (await getAuthToken()) || auth;

    let endpoint = `app.bsky.graph.getFollowers?actor=${encodeURIComponent(auth.did)}&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetFollowersResponse>(
      endpoint,
      'GET',
      null,
      currentAuth.accessJwt,
      currentAuth.pdsUrl
    );

    if (response?.followers) {
      allFollowers.push(...response.followers);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  // Update cache
  followersCache.data = allFollowers;
  followersCache.fetchedAt = Date.now();
  log.info(`Cached ${allFollowers.length} followers`);

  return allFollowers;
}

/**
 * Sync follows only (lightweight sync for repost filter feature)
 * This runs on startup and periodically to keep the follows list fresh
 * Uses lightweight storage (just handles) to avoid quota issues
 * CRITICAL FIX #1: Uses Mutex for true mutual exclusion
 */
export async function syncFollowsOnly(): Promise<void> {
  // Check if already locked without waiting (for quick rejection)
  if (followsSyncMutex.isLocked) {
    log.info('Follows sync already in progress');
    return;
  }

  await followsSyncMutex.runExclusive(async () => {
    try {
      const auth = await getAuthToken();
      if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
        log.info('Not authenticated, skipping follows sync');
        return;
      }

      // Check if we already have recent follows data (within last hour)
      const existingData = await getFollowsHandles();
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      if (existingData.syncedAt > oneHourAgo && existingData.handles.length > 0) {
        log.info('Follows data is fresh, skipping sync');
        return;
      }

      // Proactively clear old bloated socialGraph data to free up space
      // The full socialGraph (with avatars) was used by blocklist audit but is too large
      // We now use lightweight followsHandles instead
      const existingGraph = await getSocialGraph();
      if (existingGraph.follows.length > 0 || existingGraph.followers.length > 0) {
        log.info('Clearing old socialGraph to free storage space...');
        await browser.storage.local.remove('socialGraph');
      }

      log.info('Syncing follows for repost filter...');
      const follows = await fetchAllFollows(auth);
      log.info(`Fetched ${follows.length} follows`);

      // Store just the handles (lightweight - avoids quota issues)
      const handles = follows.map((f) => f.handle);
      await setFollowsHandles(handles, Date.now());
      log.info('Follows sync complete');
    } catch (error) {
      log.error('Follows sync failed:', error);
    }
  });
}

/**
 * Set up follows sync alarm
 */
export function setupFollowsSyncAlarm(alarmName: string, intervalMinutes: number): void {
  browser.alarms.create(alarmName, {
    delayInMinutes: 1, // First sync after 1 minute (give time for auth)
    periodInMinutes: intervalMinutes,
  });
}

/**
 * Fetch candidate's followers using public API (works even if blocked)
 */
export async function fetchCandidateFollowers(candidateDid: string): Promise<Set<string>> {
  const followerDids = new Set<string>();
  let cursor: string | undefined;

  do {
    let url = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollowers?actor=${encodeURIComponent(candidateDid)}&limit=100`;
    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) break;

      const data = (await response.json()) as { followers?: ProfileView[]; cursor?: string };
      if (data.followers) {
        for (const f of data.followers) {
          followerDids.add(f.did);
        }
      }
      cursor = data.cursor;

      if (cursor) {
        await sleep(PAGINATION_DELAY);
      }
    } catch {
      break;
    }
  } while (cursor);

  return followerDids;
}

/**
 * Fetch candidate's blocks from their CAR file
 */
export async function fetchCandidateBlocks(candidateDid: string): Promise<Set<string>> {
  try {
    const pdsUrl = await resolvePdsUrl(candidateDid);
    log.info(`Fetching CAR for ${candidateDid} to get their blocks...`);
    const repoData = await fetchAndParseRepo(candidateDid, pdsUrl);
    log.info(
      `Candidate ${candidateDid} blocks ${repoData.blocks.length} people:`,
      repoData.blocks.slice(0, 5)
    );
    return new Set(repoData.blocks);
  } catch (error) {
    log.error(`Failed to fetch candidate blocks:`, error);
    return new Set();
  }
}
