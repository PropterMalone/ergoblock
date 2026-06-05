/**
 * Blocklist Audit - Find conflicts between follows/followers and subscribed blocklists
 */

import { getAuthToken, bgApiRequest, PAGINATION_DELAY } from './api-client.js';
import { fetchAllFollows, fetchAllFollowers } from './social-graph.js';
import {
  updateBlocklistAuditState,
  setSubscribedBlocklists,
  setFollowsHandles,
  setBlocklistConflicts,
  getDismissedConflicts,
  getSocialGraph,
  getPermanentBlocks,
  getTempBlocks,
  addHistoryEntry,
} from '../platform/storage.js';
import {
  AuthData,
  ProfileView,
  ListView,
  GetListBlocksResponse,
  GetListMutesResponse,
  GetListResponse,
  FollowRelation,
  BlocklistConflictGroup,
  BlocklistConflict,
  SubscribedBlocklist,
} from '../types.js';
import { sleep, createLogger, Mutex } from '../platform/utils.js';

const log = createLogger('bg:blocklist-audit');

export const blocklistAuditMutex = new Mutex();

/**
 * Fetch all subscribed blocklists (both blocks and mutes)
 */
async function fetchSubscribedBlocklists(auth: AuthData): Promise<ListView[]> {
  const allLists: ListView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = 'app.bsky.graph.getListBlocks?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetListBlocksResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.lists) {
      allLists.push(...response.lists);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  // Also fetch subscribed mutelists
  cursor = undefined;
  do {
    let endpoint = 'app.bsky.graph.getListMutes?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetListMutesResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.lists) {
      // Only add modlists (not curate lists)
      const modlists = response.lists.filter((l) => l.purpose === 'app.bsky.graph.defs#modlist');
      allLists.push(...modlists);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allLists;
}

/**
 * Fetch all members of a list
 */
async function fetchListMembers(auth: AuthData, listUri: string): Promise<ProfileView[]> {
  const allMembers: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = `app.bsky.graph.getList?list=${encodeURIComponent(listUri)}&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetListResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.items) {
      for (const item of response.items) {
        allMembers.push(item.subject);
      }
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allMembers;
}

/**
 * Perform blocklist audit sync
 * Finds conflicts between your follows/followers and your subscribed blocklists
 */
export async function performBlocklistAuditSync(): Promise<{
  success: boolean;
  error?: string;
  conflictCount?: number;
}> {
  // CRITICAL FIX #1: Check if already locked without waiting (for quick rejection)
  if (blocklistAuditMutex.isLocked) {
    log.info('Blocklist audit sync already in progress');
    return { success: false, error: 'Sync already in progress' };
  }

  // Use mutex.runExclusive for true mutual exclusion
  return blocklistAuditMutex.runExclusive(async () => {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    log.info('Starting blocklist audit sync...');
    await updateBlocklistAuditState({ syncInProgress: true, lastError: undefined });

    try {
      // Fetch all data in parallel where possible
      log.info('Fetching follows, followers, and blocklists...');
      const [follows, followers, blocklists] = await Promise.all([
        fetchAllFollows(auth),
        fetchAllFollowers(auth),
        fetchSubscribedBlocklists(auth),
      ]);

      log.info(
        `Found ${follows.length} follows, ${followers.length} followers, ${blocklists.length} blocklists`
      );

      // Build social graph (in-memory only for conflict detection)
      // We don't persist the full graph - it's too large with avatars
      const followerDids = new Set(followers.map((f) => f.did));

      // Combine into FollowRelation[] (in-memory for conflict detection)
      // Store without avatars to reduce memory usage
      const allRelations: Map<string, FollowRelation> = new Map();

      for (const f of follows) {
        allRelations.set(f.did, {
          did: f.did,
          handle: f.handle,
          displayName: f.displayName,
          // avatar intentionally omitted - fetched on-demand in UI
          relationship: followerDids.has(f.did) ? 'mutual' : 'following',
        });
      }

      for (const f of followers) {
        if (!allRelations.has(f.did)) {
          allRelations.set(f.did, {
            did: f.did,
            handle: f.handle,
            displayName: f.displayName,
            // avatar intentionally omitted - fetched on-demand in UI
            relationship: 'follower',
          });
        }
      }

      // Save lightweight follows handles (for repost filter feature)
      // This replaces the bloated socialGraph storage
      const followHandles = follows.map((f) => f.handle);
      await setFollowsHandles(followHandles, Date.now());
      log.info(`Saved ${followHandles.length} follow handles`);

      // Note: We no longer persist the full socialGraph - it was too large
      // The UI can fetch profile details on-demand when needed

      // Save blocklists (without avatars to reduce storage)
      const storedBlocklists: SubscribedBlocklist[] = blocklists.map((l) => ({
        uri: l.uri,
        name: l.name,
        description: l.description,
        // avatar intentionally omitted - fetched on-demand in UI
        creator: {
          did: l.creator.did,
          handle: l.creator.handle,
          displayName: l.creator.displayName,
        },
        listItemCount: l.listItemCount,
        syncedAt: Date.now(),
      }));
      await setSubscribedBlocklists(storedBlocklists);

      // Now find conflicts: for each blocklist, check if any members are in our social graph
      log.info('Checking blocklists for conflicts...');
      const conflictGroups: BlocklistConflictGroup[] = [];
      const dismissedLists = await getDismissedConflicts();

      for (const list of blocklists) {
        log.debug(`Checking list: ${list.name}`);
        const members = await fetchListMembers(auth, list.uri);

        const conflicts: BlocklistConflict[] = [];
        for (const member of members) {
          const relation = allRelations.get(member.did);
          if (relation) {
            conflicts.push({
              user: relation,
              listUri: list.uri,
              listName: list.name,
              listCreatorHandle: list.creator.handle,
            });
          }
        }

        if (conflicts.length > 0) {
          conflictGroups.push({
            list: {
              uri: list.uri,
              name: list.name,
              description: list.description,
              // avatar intentionally omitted - fetched on-demand in UI
              creator: {
                did: list.creator.did,
                handle: list.creator.handle,
                displayName: list.creator.displayName,
              },
              listItemCount: list.listItemCount,
              syncedAt: Date.now(),
            },
            conflicts,
            dismissed: dismissedLists.has(list.uri),
          });
          log.info(`Found ${conflicts.length} conflicts in ${list.name}`);
        }

        // Rate limit between lists
        await sleep(PAGINATION_DELAY);
      }

      // Save conflicts
      await setBlocklistConflicts(conflictGroups);

      const totalConflicts = conflictGroups.reduce((sum, g) => sum + g.conflicts.length, 0);

      await updateBlocklistAuditState({
        syncInProgress: false,
        lastSyncAt: Date.now(),
        followCount: follows.length,
        followerCount: followers.length,
        blocklistCount: blocklists.length,
        conflictCount: totalConflicts,
      });

      log.info(`Blocklist audit complete: ${totalConflicts} conflicts found`);
      return { success: true, conflictCount: totalConflicts };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Blocklist audit sync failed:', errorMessage);

      await updateBlocklistAuditState({
        syncInProgress: false,
        lastError: errorMessage,
      });

      return { success: false, error: errorMessage };
    }
  });
}

/**
 * Unsubscribe from a blocklist
 */
export async function handleUnsubscribeFromBlocklist(
  listUri: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Find the listblock record for this list
    const records = await bgApiRequest<{
      records: Array<{ uri: string; value: { subject: string } }>;
    }>(
      `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.listblock&limit=100`,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    const record = records?.records?.find((r) => r.value.subject === listUri);
    if (!record) {
      // Try listmute instead
      const muteRecords = await bgApiRequest<{
        records: Array<{ uri: string; value: { subject: string } }>;
      }>(
        `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.listmute&limit=100`,
        'GET',
        null,
        auth.accessJwt,
        auth.pdsUrl
      );

      const muteRecord = muteRecords?.records?.find((r) => r.value.subject === listUri);
      if (!muteRecord) {
        log.info('No subscription record found for', listUri);
        return { success: false, error: 'Subscription not found' };
      }

      // Delete the listmute record
      const rkey = muteRecord.uri.split('/').pop();
      if (rkey) {
        await bgApiRequest(
          'com.atproto.repo.deleteRecord',
          'POST',
          {
            repo: auth.did,
            collection: 'app.bsky.graph.listmute',
            rkey,
          },
          auth.accessJwt,
          auth.pdsUrl
        );
      }
    } else {
      // Delete the listblock record
      const rkey = record.uri.split('/').pop();
      if (rkey) {
        await bgApiRequest(
          'com.atproto.repo.deleteRecord',
          'POST',
          {
            repo: auth.did,
            collection: 'app.bsky.graph.listblock',
            rkey,
          },
          auth.accessJwt,
          auth.pdsUrl
        );
      }
    }

    log.info('Unsubscribed from blocklist:', listUri);
    return { success: true };
  } catch (error) {
    log.error('Unsubscribe failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Copy all members of a blocklist as individual permanent blocks
 * Excludes users the authenticated user follows
 */
export async function handleCopyBlocklistAsIndividualBlocks(
  listUri: string
): Promise<{ success: boolean; blocked?: number; skipped?: number; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    log.info('Copying blocklist as individual blocks:', listUri);

    // Fetch all list members
    const members = await fetchListMembers(auth, listUri);
    log.info(`Found ${members.length} members in blocklist`);

    if (members.length === 0) {
      return { success: true, blocked: 0, skipped: 0 };
    }

    // Get user's follows to filter out
    const socialGraph = await getSocialGraph();
    const followDids = new Set(socialGraph.follows.map((f) => f.did));
    log.info(`User follows ${followDids.size} accounts`);

    // Get existing blocks to avoid duplicates
    const permanentBlocks = await getPermanentBlocks();
    const tempBlocks = await getTempBlocks();
    const existingBlockDids = new Set([
      ...Object.keys(permanentBlocks),
      ...Object.keys(tempBlocks),
    ]);
    log.info(`User has ${existingBlockDids.size} existing blocks`);

    let blocked = 0;
    let skipped = 0;

    for (const member of members) {
      // Skip if user follows this person
      if (followDids.has(member.did)) {
        log.info(`Skipping ${member.handle} (followed)`);
        skipped++;
        continue;
      }

      // Skip if already blocked
      if (existingBlockDids.has(member.did)) {
        log.info(`Skipping ${member.did} (already blocked)`);
        skipped++;
        continue;
      }

      try {
        const record = {
          $type: 'app.bsky.graph.block',
          subject: member.did,
          createdAt: new Date().toISOString(),
        };

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
          blocked++;

          // Add history entry
          await addHistoryEntry({
            did: member.did,
            handle: member.handle || member.did,
            action: 'blocked',
            timestamp: Date.now(),
            trigger: 'manual',
            success: true,
          });
        } else {
          skipped++;
        }

        // Rate limit: 100ms between operations
        await sleep(100);
      } catch (error) {
        log.error(`Failed to block ${member.did}:`, error);
        skipped++;
      }
    }

    log.info(`Copy blocklist complete: ${blocked} blocked, ${skipped} skipped`);

    return { success: true, blocked, skipped };
  } catch (error) {
    log.error('Copy blocklist as blocks failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
