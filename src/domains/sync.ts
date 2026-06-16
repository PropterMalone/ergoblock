/**
 * Sync Engine - Two-way sync with Bluesky
 * Syncs blocks and mutes between local storage and Bluesky
 */

import browser from '../platform/browser.js';
import { getAuthToken, bgApiRequest, PAGINATION_DELAY } from './api-client.js';
import { fetchViewerStates } from './graph-ops.js';
import {
  getTempBlocks,
  removeTempBlock,
  getPermanentBlocks,
  setPermanentBlocks,
  getTempMutes,
  removeTempMute,
  getPermanentMutes,
  setPermanentMutes,
  addHistoryEntry,
  updateSyncState,
} from '../platform/storage.js';
import {
  ProfileView,
  BlockRecord,
  GetBlocksResponse,
  ListBlockRecordsResponse,
  GetMutesResponse,
  AuthData,
} from '../types.js';
import { sleep, createLogger, Mutex } from '../platform/utils.js';

const log = createLogger('bg:sync');

export const syncMutex = new Mutex();

/**
 * Propagation grace window. A block/mute just created (e.g. seconds ago) may not yet be
 * reflected in the AppView's getBlocks/getMutes due to eventual consistency. We must NOT
 * treat such an entry's absence from a remote fetch as "externally removed" and delete it,
 * or freshly-created temp actions vanish ("blocks then vanishes" bug). Entries younger than
 * this are skipped during reconciliation-delete.
 */
const SYNC_PROPAGATION_GRACE_MS = 5 * 60 * 1000;

/**
 * Fetch all blocks from Bluesky with pagination (profile data).
 * Throws on a null/undefined page response so a partial/failed fetch fails the whole sync
 * rather than silently contributing zero rows (which would trigger spurious deletions).
 */
async function fetchAllBlocks(auth: AuthData): Promise<ProfileView[]> {
  const allBlocks: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = 'app.bsky.graph.getBlocks?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetBlocksResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (!response) {
      throw new Error('getBlocks returned no response (incomplete fetch); aborting sync');
    }
    if (response.blocks) {
      allBlocks.push(...response.blocks);
    }
    cursor = response.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allBlocks;
}

/**
 * Fetch all block records from repo (createdAt timestamps + rkey)
 */
async function fetchAllBlockRecords(auth: AuthData): Promise<BlockRecord[]> {
  const allRecords: BlockRecord[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.block&limit=100`;
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<ListBlockRecordsResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (!response) {
      throw new Error('listRecords(blocks) returned no response (incomplete fetch); aborting sync');
    }
    if (response.records) {
      allRecords.push(...response.records);
    }
    cursor = response.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allRecords;
}

/**
 * Fetch all mutes from Bluesky with pagination
 */
async function fetchAllMutes(auth: AuthData): Promise<ProfileView[]> {
  const allMutes: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = 'app.bsky.graph.getMutes?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetMutesResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (!response) {
      throw new Error('getMutes returned no response (incomplete fetch); aborting sync');
    }
    if (response.mutes) {
      allMutes.push(...response.mutes);
    }
    cursor = response.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allMutes;
}

/**
 * Sync blocks from Bluesky
 * - Fetches both profile data (getBlocks) and records (listRecords) to get createdAt
 * - Adds new blocks found in Bluesky to permanent storage
 * - Removes temp blocks that no longer exist in Bluesky (user unblocked externally)
 */
async function syncBlocks(
  auth: AuthData
): Promise<{ added: number; removed: number; newBlocks: Array<{ did: string; handle: string }> }> {
  const now = Date.now();
  let added = 0;
  let removed = 0;
  const newBlocks: Array<{ did: string; handle: string }> = [];

  // Fetch both profile data and block records in parallel
  const [bskyBlocks, blockRecords] = await Promise.all([
    fetchAllBlocks(auth),
    fetchAllBlockRecords(auth),
  ]);

  const bskyBlockDids = new Set(bskyBlocks.map((b) => b.did));

  // Build lookup map from records: DID -> { createdAt, rkey }
  const recordMap = new Map<string, { createdAt: number; rkey: string }>();
  for (const record of blockRecords) {
    const rkey = record.uri.split('/').pop();
    if (rkey) {
      recordMap.set(record.value.subject, {
        createdAt: new Date(record.value.createdAt).getTime(),
        rkey,
      });
    }
  }

  // Get current storage first to identify NEW blocks
  const [tempBlocks, permanentBlocks] = await Promise.all([getTempBlocks(), getPermanentBlocks()]);

  // Only fetch viewer states for NEW blocks (not already in permanent storage)
  // This dramatically reduces API calls for users with large block lists
  const newBlockDids = bskyBlocks
    .filter((b) => !permanentBlocks[b.did] && !tempBlocks[b.did])
    .map((b) => b.did);
  log.info(
    `Fetching viewer states for ${newBlockDids.length} new blocks (skipping ${bskyBlocks.length - newBlockDids.length} existing)`
  );
  const viewerStates =
    newBlockDids.length > 0 ? await fetchViewerStates(auth, newBlockDids) : new Map();

  // Build new permanent blocks map
  const newPermanentBlocks: Record<
    string,
    {
      did: string;
      handle: string;
      displayName?: string;
      avatar?: string;
      createdAt?: number;
      syncedAt: number;
      rkey?: string;
      viewer?: import('../types.js').ProfileViewerState;
      needsReview?: boolean;
      source?: 'ergoblock' | 'external';
    }
  > = {};

  for (const block of bskyBlocks) {
    // Skip if it's a temp block (we track those separately)
    if (tempBlocks[block.did]) {
      continue;
    }

    const recordData = recordMap.get(block.did);
    // Use new viewer state if available, otherwise preserve existing
    const viewer = viewerStates.get(block.did) || permanentBlocks[block.did]?.viewer;

    const isNewBlock = !permanentBlocks[block.did];

    // Add to permanent blocks
    // IMPORTANT: Preserve existing createdAt if we have it - the Bluesky record's createdAt
    // will be newer if we've done a temp unblock/reblock for context detection
    newPermanentBlocks[block.did] = {
      did: block.did,
      handle: block.handle,
      displayName: block.displayName,
      avatar: block.avatar,
      createdAt: permanentBlocks[block.did]?.createdAt || recordData?.createdAt,
      syncedAt: permanentBlocks[block.did]?.syncedAt || now,
      rkey: recordData?.rkey || permanentBlocks[block.did]?.rkey,
      viewer,
      // Review queue: new blocks are external until reviewed, existing blocks preserve their state
      ...(isNewBlock
        ? { needsReview: true, source: 'external' as const }
        : {
            needsReview: permanentBlocks[block.did]?.needsReview,
            source: permanentBlocks[block.did]?.source,
          }),
    };

    if (isNewBlock) {
      added++;
      newBlocks.push({ did: block.did, handle: block.handle });
    }
  }

  // Check for temp blocks that no longer exist in Bluesky (user unblocked externally).
  // The fetch is provably complete here — fetchAllBlocks throws on any null page, so we
  // only reach this point with every page fetched and the cursor exhausted. Still, skip
  // entries within the propagation grace window: a just-created block may not yet appear
  // in the AppView, and deleting it would erase a valid action ("blocks then vanishes").
  for (const did of Object.keys(tempBlocks)) {
    if (!bskyBlockDids.has(did)) {
      const createdAt = tempBlocks[did].createdAt;
      if (createdAt && now - createdAt < SYNC_PROPAGATION_GRACE_MS) {
        log.info(
          'Skipping reconciliation-delete for recently-created block:',
          tempBlocks[did].handle
        );
        continue;
      }
      log.info('Temp block removed externally:', tempBlocks[did].handle);
      await removeTempBlock(did);
      await addHistoryEntry({
        did,
        handle: tempBlocks[did].handle,
        action: 'unblocked',
        timestamp: now,
        trigger: 'removed', // User removed externally
        success: true,
      });
      removed++;
    }
  }

  await setPermanentBlocks(newPermanentBlocks);
  return { added, removed, newBlocks };
}

/**
 * Sync mutes from Bluesky
 * - Adds new mutes found in Bluesky to permanent storage
 * - Removes temp mutes that no longer exist in Bluesky (user unmuted externally)
 * - Fetches viewer state (relationship info) for all muted users
 */
async function syncMutes(auth: AuthData): Promise<{ added: number; removed: number }> {
  const now = Date.now();
  let added = 0;
  let removed = 0;

  // Fetch current mutes from Bluesky
  const bskyMutes = await fetchAllMutes(auth);
  const bskyMuteDids = new Set(bskyMutes.map((m) => m.did));

  // Get current storage first to identify NEW mutes
  const [tempMutes, permanentMutes] = await Promise.all([getTempMutes(), getPermanentMutes()]);

  // Only fetch viewer states for NEW mutes (not already in permanent storage)
  // This dramatically reduces API calls for users with large mute lists
  const newMuteDids = bskyMutes
    .filter((m) => !permanentMutes[m.did] && !tempMutes[m.did])
    .map((m) => m.did);
  log.info(
    `Fetching viewer states for ${newMuteDids.length} new mutes (skipping ${bskyMutes.length - newMuteDids.length} existing)`
  );
  const viewerStates =
    newMuteDids.length > 0 ? await fetchViewerStates(auth, newMuteDids) : new Map();

  // Build new permanent mutes map
  const newPermanentMutes: Record<
    string,
    {
      did: string;
      handle: string;
      displayName?: string;
      avatar?: string;
      syncedAt: number;
      viewer?: import('../types.js').ProfileViewerState;
      needsReview?: boolean;
      source?: 'ergoblock' | 'external';
    }
  > = {};

  for (const mute of bskyMutes) {
    // Skip if it's a temp mute (we track those separately)
    if (tempMutes[mute.did]) {
      continue;
    }

    // Use new viewer state if available, otherwise preserve existing
    const viewer = viewerStates.get(mute.did) || permanentMutes[mute.did]?.viewer;

    const isNewMute = !permanentMutes[mute.did];

    // Add to permanent mutes
    newPermanentMutes[mute.did] = {
      did: mute.did,
      handle: mute.handle,
      displayName: mute.displayName,
      avatar: mute.avatar,
      syncedAt: permanentMutes[mute.did]?.syncedAt || now,
      viewer,
      // Review queue: new mutes are external until reviewed, existing mutes preserve their state
      ...(isNewMute
        ? { needsReview: true, source: 'external' as const }
        : {
            needsReview: permanentMutes[mute.did]?.needsReview,
            source: permanentMutes[mute.did]?.source,
          }),
    };

    if (isNewMute) {
      added++;
    }
  }

  // Check for temp mutes that no longer exist in Bluesky (user unmuted externally).
  // Same reasoning as syncBlocks: fetch is provably complete (fetchAllMutes throws on a
  // null page), and we skip entries within the propagation grace window.
  for (const did of Object.keys(tempMutes)) {
    if (!bskyMuteDids.has(did)) {
      const createdAt = tempMutes[did].createdAt;
      if (createdAt && now - createdAt < SYNC_PROPAGATION_GRACE_MS) {
        log.info(
          'Skipping reconciliation-delete for recently-created mute:',
          tempMutes[did].handle
        );
        continue;
      }
      log.info('Temp mute removed externally:', tempMutes[did].handle);
      await removeTempMute(did);
      await addHistoryEntry({
        did,
        handle: tempMutes[did].handle,
        action: 'unmuted',
        timestamp: now,
        trigger: 'removed', // User removed externally
        success: true,
      });
      removed++;
    }
  }

  await setPermanentMutes(newPermanentMutes);
  return { added, removed };
}

/**
 * Perform full sync with Bluesky
 * CRITICAL FIX #1: Uses Mutex for true mutual exclusion instead of boolean flags
 */
export async function performFullSync(): Promise<{
  success: boolean;
  error?: string;
  blocks?: { added: number; removed: number };
  mutes?: { added: number; removed: number };
}> {
  // Check if already locked without waiting (for quick rejection)
  if (syncMutex.isLocked) {
    log.info('Sync already in progress, skipping');
    return { success: false, error: 'Sync already in progress' };
  }

  // Use mutex.runExclusive for true mutual exclusion
  return syncMutex.runExclusive(async () => {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      log.info('No auth token available, skipping sync');
      return { success: false, error: 'Not authenticated' };
    }

    log.info('Starting full sync with Bluesky...');
    await updateSyncState({ syncInProgress: true, lastError: undefined });

    try {
      // Use Promise.allSettled to handle partial failures gracefully
      const results = await Promise.allSettled([syncBlocks(auth), syncMutes(auth)]);

      const blockSettled = results[0];
      const muteSettled = results[1];

      const blockResult =
        blockSettled.status === 'fulfilled'
          ? blockSettled.value
          : { added: 0, removed: 0, newBlocks: [] };
      const muteResult =
        muteSettled.status === 'fulfilled' ? muteSettled.value : { added: 0, removed: 0 };

      // Log any partial failures
      if (blockSettled.status === 'rejected') {
        log.error('Block sync failed:', blockSettled.reason);
      }
      if (muteSettled.status === 'rejected') {
        log.error('Mute sync failed:', muteSettled.reason);
      }

      // NOTE: Context searching is now on-demand only.
      // Users can search for context via the "Find" button in All Blocks or through Amnesty.
      // This keeps sync fast - we only fetch block/mute lists, not search for interactions.

      await updateSyncState({
        syncInProgress: false,
        lastBlockSync: Date.now(),
        lastMuteSync: Date.now(),
        lastError:
          blockSettled.status === 'rejected' || muteSettled.status === 'rejected'
            ? 'Partial sync failure'
            : undefined,
      });

      log.info('Sync complete:', {
        blocks: { added: blockResult.added, removed: blockResult.removed },
        mutes: muteResult,
      });

      return {
        success: blockSettled.status === 'fulfilled' && muteSettled.status === 'fulfilled',
        blocks: { added: blockResult.added, removed: blockResult.removed },
        mutes: muteResult,
        error:
          blockSettled.status === 'rejected' || muteSettled.status === 'rejected'
            ? 'Partial sync failure - check console for details'
            : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Sync failed:', errorMessage);

      await updateSyncState({
        syncInProgress: false,
        lastError: errorMessage,
      });

      return { success: false, error: errorMessage };
    }
  });
}

/**
 * Set up sync alarm
 * @param alarmName - Name for the alarm (default: 'syncWithBluesky')
 * @param intervalMinutes - Interval in minutes (default: 60)
 */
export async function setupSyncAlarm(
  alarmName = 'syncWithBluesky',
  intervalMinutes = 60
): Promise<void> {
  await browser.alarms.clear(alarmName);
  await browser.alarms.create(alarmName, {
    periodInMinutes: intervalMinutes,
    delayInMinutes: 1, // First sync 1 minute after startup
  });
  log.info('Sync alarm set up with interval:', intervalMinutes, 'minutes');
}
