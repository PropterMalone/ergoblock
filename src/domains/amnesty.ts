/**
 * Amnesty - Review and unblock old blocks, analyze relationships
 * Provides follow relationship analysis and Clearsky integration for amnesty decisions
 */

import browser from '../platform/browser.js';
import { getAuthToken, bgApiRequest } from './api-client.js';
import {
  fetchAllFollows,
  fetchAllFollowers,
  fetchCandidateFollowers,
  fetchCandidateBlocks,
} from './social-graph.js';
import {
  getFollowsWhoBlock,
  getFollowsWhoBlockCached,
  prewarmBlockedByCache,
  processBlockedByQueue,
} from './clearskyService.js';
import {
  getOptions,
  getAmnestyReviews,
  removeTempBlock,
  removePermanentBlock,
} from '../platform/storage.js';
import { RelationshipUser, ListRecordsResponse } from '../types.js';
import { createLogger } from '../platform/utils.js';

const log = createLogger('bg:amnesty');

/**
 * Rectify amnesty unblocks that failed silently
 * Checks if users marked as "unblocked" in amnesty reviews are still blocked
 * and fixes them
 */
export async function rectifyFailedAmnestyUnblocks(): Promise<{
  success: boolean;
  checked: number;
  fixed: number;
  failed: number;
  fixedHandles: string[];
}> {
  const result = { success: true, checked: 0, fixed: 0, failed: 0, fixedHandles: [] as string[] };

  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      log.info('Rectify: Not authenticated, skipping');
      return result;
    }

    // Get amnesty reviews marked as 'unblocked' for blocks
    const reviews = await getAmnestyReviews();
    const unblockedReviews = reviews.filter(
      (r) => r.decision === 'unblocked' && r.type === 'block'
    );

    if (unblockedReviews.length === 0) {
      log.info('Rectify: No unblocked reviews to check');
      return result;
    }

    log.info(`Rectify: Checking ${unblockedReviews.length} amnesty unblocks...`);

    // Fetch all block records from Bluesky (paginated)
    const blockedDids = new Set<string>();
    const blockRkeys = new Map<string, string>();
    let cursor: string | undefined;

    do {
      const url = cursor
        ? `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.block&limit=100&cursor=${cursor}`
        : `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.block&limit=100`;

      const blocks = await bgApiRequest<ListRecordsResponse>(
        url,
        'GET',
        null,
        auth.accessJwt,
        auth.pdsUrl
      );

      for (const record of blocks?.records || []) {
        const did = record.value.subject;
        const rkey = record.uri.split('/').pop();
        blockedDids.add(did);
        if (rkey) {
          blockRkeys.set(did, rkey);
        }
      }

      cursor = blocks?.cursor;
    } while (cursor);

    // Find reviews marked as unblocked but user is still blocked
    const failedUnblocks = unblockedReviews.filter((r) => blockedDids.has(r.did));
    result.checked = unblockedReviews.length;

    if (failedUnblocks.length === 0) {
      log.info('Rectify: All amnesty unblocks were successful');
      return result;
    }

    log.info(`Rectify: Found ${failedUnblocks.length} failed unblocks, fixing...`);

    // Actually unblock them
    for (const review of failedUnblocks) {
      const rkey = blockRkeys.get(review.did);
      if (!rkey) {
        log.info(`Rectify: No rkey for @${review.handle}, skipping`);
        result.failed++;
        continue;
      }

      try {
        await bgApiRequest(
          'com.atproto.repo.deleteRecord',
          'POST',
          {
            repo: auth.did,
            collection: 'app.bsky.graph.block',
            rkey,
          },
          auth.accessJwt,
          auth.pdsUrl
        );

        // Clean up storage
        await Promise.all([removeTempBlock(review.did), removePermanentBlock(review.did)]);

        log.info(`Rectify: Unblocked @${review.handle}`);
        result.fixed++;
        result.fixedHandles.push(review.handle);
      } catch (error) {
        log.error(`Rectify: Failed to unblock @${review.handle}:`, error);
        result.failed++;
      }

      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Show notification if we fixed any
    if (result.fixed > 0) {
      const options = await getOptions();
      if (options.notificationSound !== undefined) {
        const handleList = result.fixedHandles
          .slice(0, 3)
          .map((h) => `@${h}`)
          .join(', ');
        const suffix = result.fixed > 3 ? ` and ${result.fixed - 3} more` : '';
        await browser.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '✓ Amnesty unblocks fixed',
          message: `Successfully unblocked ${handleList}${suffix}`,
          silent: !options.notificationSound,
        } as browser.Notifications.CreateNotificationOptions & { silent?: boolean });
      }
    }

    log.info(`Rectify complete: ${result.fixed} fixed, ${result.failed} failed`);
    return result;
  } catch (error) {
    log.error('Rectify error:', error);
    return result;
  }
}

/**
 * Get follow relationships for amnesty review
 * Returns:
 * - followsWhoFollowThem: people you follow who also follow the candidate
 * - followersWhoFollowThem: your followers who also follow the candidate
 * - followsTheyBlock: people you follow who the candidate blocks
 */
export async function handleGetFollowRelationships(candidateDid: string) {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    log.info(`Fetching follow relationships for ${candidateDid}`);

    // Fetch all data in parallel
    const [myFollows, myFollowers, candidateFollowers, candidateBlocks] = await Promise.all([
      fetchAllFollows(auth),
      fetchAllFollowers(auth),
      fetchCandidateFollowers(candidateDid),
      fetchCandidateBlocks(candidateDid),
    ]);

    log.info(
      `Got ${myFollows.length} follows, ${myFollowers.length} followers, candidate has ${candidateFollowers.size} followers and ${candidateBlocks.size} blocks`
    );

    // Build results for follows/followers who follow the candidate
    const followsWhoFollowThem: RelationshipUser[] = [];
    const followersWhoFollowThem: RelationshipUser[] = [];
    const followsTheyBlock: RelationshipUser[] = [];

    for (const f of myFollows) {
      if (candidateFollowers.has(f.did)) {
        followsWhoFollowThem.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
      // Check if candidate blocks this person you follow
      if (candidateBlocks.has(f.did)) {
        followsTheyBlock.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    for (const f of myFollowers) {
      if (candidateFollowers.has(f.did)) {
        followersWhoFollowThem.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    log.info(
      `Follow relationships: ${followsWhoFollowThem.length} follows follow them, ${followersWhoFollowThem.length} followers follow them, ${followsTheyBlock.length} follows they block`
    );

    return {
      success: true,
      followsWhoFollowThem,
      followersWhoFollowThem,
      followsTheyBlock,
    };
  } catch (error) {
    log.error('Get follow relationships failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get follows who follow the candidate (incremental loading)
 */
export async function handleGetFollowsWhoFollowThem(
  candidateDid: string
): Promise<{ success: boolean; users?: RelationshipUser[]; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const [myFollows, candidateFollowers] = await Promise.all([
      fetchAllFollows(auth),
      fetchCandidateFollowers(candidateDid),
    ]);

    const users: RelationshipUser[] = [];
    for (const f of myFollows) {
      if (candidateFollowers.has(f.did)) {
        users.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    log.info(`Follows who follow them: ${users.length}`);
    return { success: true, users };
  } catch (error) {
    log.error('Get follows who follow them failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get followers who follow the candidate (incremental loading)
 */
export async function handleGetFollowersWhoFollowThem(
  candidateDid: string
): Promise<{ success: boolean; users?: RelationshipUser[]; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const [myFollowers, candidateFollowers] = await Promise.all([
      fetchAllFollowers(auth),
      fetchCandidateFollowers(candidateDid),
    ]);

    const users: RelationshipUser[] = [];
    for (const f of myFollowers) {
      if (candidateFollowers.has(f.did)) {
        users.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    log.info(`Followers who follow them: ${users.length}`);
    return { success: true, users };
  } catch (error) {
    log.error('Get followers who follow them failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get follows who are blocked by the candidate (incremental loading)
 */
export async function handleGetFollowsTheyBlock(
  candidateDid: string
): Promise<{ success: boolean; users?: RelationshipUser[]; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const [myFollows, candidateBlocks] = await Promise.all([
      fetchAllFollows(auth),
      fetchCandidateBlocks(candidateDid),
    ]);

    const users: RelationshipUser[] = [];
    for (const f of myFollows) {
      if (candidateBlocks.has(f.did)) {
        users.push({
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          avatar: f.avatar,
        });
      }
    }

    log.info(
      `Follows they block: ${users.length}`,
      users.map((u) => u.handle)
    );
    return { success: true, users };
  } catch (error) {
    log.error('Get follows they block failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get follows who block the candidate (via Clearsky API)
 * This is the reverse of "follows they block" - shows community consensus
 */
export async function handleGetFollowsWhoBlockThem(candidateDid: string): Promise<{
  success: boolean;
  count?: number;
  users?: RelationshipUser[];
  totalBlockers?: number;
  cached?: boolean;
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get my follows as a Set
    const myFollows = await fetchAllFollows(auth);
    const myFollowDids = new Set(myFollows.map((f) => f.did));

    // Get follows who block this person from Clearsky
    const result = await getFollowsWhoBlock(candidateDid, myFollowDids);

    // Convert DIDs to user info
    const users: RelationshipUser[] = [];
    for (const did of result.dids) {
      const follow = myFollows.find((f) => f.did === did);
      if (follow) {
        users.push({
          did: follow.did,
          handle: follow.handle,
          displayName: follow.displayName,
          avatar: follow.avatar,
        });
      }
    }

    log.info(
      `Follows who block them: ${result.count} (total blockers: ${result.totalBlockers}, cached: ${result.cached})`,
      users.map((u) => u.handle)
    );
    return {
      success: true,
      count: result.count,
      users,
      totalBlockers: result.totalBlockers,
      cached: result.cached,
    };
  } catch (error) {
    log.error('Get follows who block them failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get cached follows who block count (without triggering a fetch)
 */
export async function handleGetFollowsWhoBlockThemCached(
  candidateDid: string
): Promise<{ success: boolean; count?: number; cached: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did) {
      return { success: false, cached: false, error: 'Not authenticated' };
    }

    const myFollows = await fetchAllFollows(auth);
    const myFollowDids = new Set(myFollows.map((f) => f.did));

    const result = await getFollowsWhoBlockCached(candidateDid, myFollowDids);
    if (!result) {
      return { success: true, cached: false };
    }

    return {
      success: true,
      count: result.count,
      cached: true,
    };
  } catch (error) {
    log.error('Get cached follows who block failed:', error);
    return {
      success: false,
      cached: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Prewarm Clearsky cache for amnesty candidates
 */
export async function handlePrewarmClearskyCache(
  targetDids: string[]
): Promise<{ success: boolean; queued?: number; alreadyCached?: number; error?: string }> {
  try {
    const result = await prewarmBlockedByCache(targetDids);
    log.info(`Prewarm Clearsky: ${result.queued} queued, ${result.alreadyCached} cached`);

    // Start processing immediately instead of waiting for the 2-minute alarm
    if (result.queued > 0) {
      // Process in background (don't await) so we return quickly
      processBlockedByQueue(3).catch((err) => {
        log.error('Immediate queue processing failed:', err);
      });
    }

    return { success: true, ...result };
  } catch (error) {
    log.error('Prewarm Clearsky cache failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
