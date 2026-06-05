/**
 * Copy User - Copy follows/blocks from another user
 */

import { getAuthToken, bgApiRequest, bgApiRequestPublic, resolvePdsUrl } from './api-client.js';
import { invalidateFollowsCache, fetchAllFollows } from './social-graph.js';
import { fetchExternalUserGraph } from './carRepo.js';
import { addHistoryEntry } from '../platform/storage.js';
import type { ProfileWithViewer } from '../types.js';
import { createLogger, sleep } from '../platform/utils.js';

const log = createLogger('bg:copy-user');

/**
 * Fetch another user's follows and blocks from their CAR file
 */
export async function handleFetchCopyUserData(handle: string) {
  log.info(`Fetching Copy User data for: ${handle}`);

  try {
    // Step 1: Resolve handle to profile (includes DID)
    const profile = await bgApiRequestPublic<ProfileWithViewer>(
      `app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`
    );

    if (!profile) {
      return { success: false, error: `User not found: ${handle}` };
    }

    const targetDid = profile.did;
    log.info(`Resolved ${handle} to DID: ${targetDid}`);

    // Step 2: Get target user's PDS URL
    const pdsUrl = await resolvePdsUrl(targetDid);
    log.info(`Target PDS: ${pdsUrl || 'using relay'}`);

    // Step 3: Fetch and parse their CAR file for follows/blocks
    const graphData = await fetchExternalUserGraph(targetDid, pdsUrl, (message) => {
      log.info(`Copy User progress: ${message}`);
    });

    log.info(`Found ${graphData.follows.length} follows, ${graphData.blocks.length} blocks`);

    return {
      success: true,
      did: targetDid,
      profile,
      follows: graphData.follows,
      blocks: graphData.blocks,
    };
  } catch (error) {
    log.error('Failed to fetch Copy User data:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Execute batch follow operations for Copy User
 * Checks existing follows from PDS to avoid duplicate follow notifications
 */
export async function handleExecuteCopyUserFollows(dids: string[]) {
  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    return { success: false, error: 'Not authenticated' };
  }

  log.info(`Executing Copy User follows for ${dids.length} users`);

  // Fetch existing follows from PDS to avoid re-following (which sends notifications)
  log.info('Fetching existing follows to avoid duplicates...');
  const existingFollows = await fetchAllFollows(auth);
  const existingFollowDids = new Set(existingFollows.map((f) => f.did));
  log.info(`Found ${existingFollowDids.size} existing follows`);

  // Filter out DIDs we already follow
  const didsToFollow = dids.filter((did) => !existingFollowDids.has(did));
  const alreadyFollowing = dids.length - didsToFollow.length;

  if (alreadyFollowing > 0) {
    log.info(`Skipping ${alreadyFollowing} users already followed`);
  }

  if (didsToFollow.length === 0) {
    log.info('All selected users are already followed');
    return { success: true, succeeded: 0, failed: 0, errors: [], skipped: alreadyFollowing };
  }

  log.info(`Will follow ${didsToFollow.length} new users`);

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const did of didsToFollow) {
    try {
      const record = {
        $type: 'app.bsky.graph.follow',
        subject: did,
        createdAt: new Date().toISOString(),
      };

      log.info(`Following ${did} (${succeeded + failed + 1}/${didsToFollow.length})...`);

      const response = await bgApiRequest<{ uri: string; cid: string }>(
        'com.atproto.repo.createRecord',
        'POST',
        {
          repo: auth.did,
          collection: 'app.bsky.graph.follow',
          record,
        },
        auth.accessJwt,
        auth.pdsUrl
      );

      if (response) {
        succeeded++;
        log.info(`Followed ${did} successfully: ${response.uri}`);
      } else {
        failed++;
        log.error(`Follow returned null for ${did}`);
        errors.push(`Failed to follow ${did}`);
      }

      // Small delay between operations to avoid overwhelming the server
      await sleep(100);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${did}: ${errorMsg}`);
      log.error(`Failed to follow ${did}:`, error);
    }
  }

  // Invalidate the follows cache since we just modified it
  invalidateFollowsCache();

  log.info(
    `Copy User follows complete: ${succeeded} succeeded, ${failed} failed, ${alreadyFollowing} skipped (already following)`
  );

  return { success: failed === 0, succeeded, failed, errors, skipped: alreadyFollowing };
}

/**
 * Execute batch block operations for Copy User
 */
export async function handleExecuteCopyUserBlocks(dids: string[]) {
  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    return { success: false, error: 'Not authenticated' };
  }

  log.info(`Executing Copy User blocks for ${dids.length} users`);

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const did of dids) {
    try {
      const record = {
        $type: 'app.bsky.graph.block',
        subject: did,
        createdAt: new Date().toISOString(),
      };

      log.info(`Blocking ${did} (${succeeded + failed + 1}/${dids.length})...`);

      const response = await bgApiRequest<{ uri: string; cid: string }>(
        'com.atproto.repo.createRecord',
        'POST',
        {
          repo: auth.did,
          collection: 'app.bsky.graph.block',
          record,
        },
        auth.accessJwt,
        auth.pdsUrl
      );

      if (response) {
        succeeded++;
        log.info(`Blocked ${did} successfully: ${response.uri}`);

        // Add history entry for the block
        await addHistoryEntry({
          did,
          handle: did, // We don't have handle here, use DID
          action: 'blocked',
          timestamp: Date.now(),
          trigger: 'manual',
          success: true,
        });
      } else {
        failed++;
        log.error(`Block returned null for ${did}`);
        errors.push(`Failed to block ${did}`);
      }

      // Small delay between operations to avoid overwhelming the server
      await sleep(100);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${did}: ${errorMsg}`);
      log.error(`Failed to block ${did}:`, error);
    }
  }

  log.info(`Copy User blocks complete: ${succeeded} succeeded, ${failed} failed`);

  return { success: failed === 0, succeeded, failed, errors };
}
