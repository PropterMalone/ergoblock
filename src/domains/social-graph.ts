import type { ProfileView, GetFollowsResponse, AuthData } from '../types.js';
import { sleep, createLogger } from '../platform/utils.js';
import { getAuthToken, bgApiRequest, PAGINATION_DELAY } from './api-client.js';
const log = createLogger('bg:social-graph');
const followsCache: { data: ProfileView[] | null; fetchedAt: number } = {
  data: null,
  fetchedAt: 0,
};
const FOLLOW_CACHE_TTL_MS = 60 * 60 * 1000;

/** Invalidate after Copy User, Mass Ops, or duplicate-follow cleanup. */
export function invalidateFollowsCache(): void {
  followsCache.data = null;
  followsCache.fetchedAt = 0;
}

/** Fetch follows on demand for Copy User. */
export async function fetchAllFollows(auth: AuthData): Promise<ProfileView[]> {
  if (followsCache.data && Date.now() - followsCache.fetchedAt < FOLLOW_CACHE_TTL_MS)
    return followsCache.data;
  const allFollows: ProfileView[] = [];
  let cursor: string | undefined;
  do {
    const currentAuth = (await getAuthToken()) || auth;
    let endpoint = `app.bsky.graph.getFollows?actor=${encodeURIComponent(auth.did)}&limit=100`;
    if (cursor) endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    const response = await bgApiRequest<GetFollowsResponse>(
      endpoint,
      'GET',
      null,
      currentAuth.accessJwt,
      currentAuth.pdsUrl
    );
    if (!response) throw new Error('Failed to fetch follows');
    if (response.follows) allFollows.push(...response.follows);
    cursor = response.cursor;
    if (cursor) await sleep(PAGINATION_DELAY);
  } while (cursor);
  followsCache.data = allFollows;
  followsCache.fetchedAt = Date.now();
  log.info(`Cached ${allFollows.length} follows`);
  return allFollows;
}
