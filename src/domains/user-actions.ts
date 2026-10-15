/**
 * User Actions - Handle user-initiated block/unblock/mute/unmute operations
 */

import {
  getAuthToken,
  withAuthSession,
  AuthSessionChangedError,
  captureAuthGeneration,
} from './api-client.js';
import { unblockUser, unmuteUser, blockUser, muteUser } from './graph-ops.js';
import type { AuthData } from '../types.js';
import {
  getTempBlocks,
  getTempMutes,
  getPermanentBlocks,
  updatePermanentBlocks,
  updatePermanentMutes,
  addTempBlock,
  addTempMute,
  addHistoryEntry,
  setHasCreatedAction,
  addPendingRollback,
  preCheckStorageQuota,
  calculateEntrySize,
  StorageQuotaError,
} from '../platform/storage.js';
import { createLogger } from '../platform/utils.js';
import { pinnedAuth, pinnedRequest } from './post-batch-actions.js';

const log = createLogger('bg:user-actions');

/**
 * Handle unblock request from popup
 */
export async function handleUnblockRequest(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the rkey from storage if available (check both temp and permanent blocks)
    const [tempBlocks, permanentBlocks] = await Promise.all([
      getTempBlocks(),
      getPermanentBlocks(),
    ]);
    const rkey = tempBlocks[did]?.rkey || permanentBlocks[did]?.rkey;

    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, rkey);
    return { success: true };
  } catch (error) {
    log.error('Unblock failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle unmute request from popup
 */
export async function handleUnmuteRequest(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
    return { success: true };
  } catch (error) {
    log.error('Unmute failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle temp unblock for viewing a post context
 * This unblocks without removing from storage - we'll reblock shortly
 */
export async function handleTempUnblockForView(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the rkey from permanent blocks storage
    const permanentBlocks = await getPermanentBlocks();
    const blockData = permanentBlocks[did];
    const rkey = blockData?.rkey;
    log.info(
      'Permanent block data for',
      did,
      ':',
      blockData ? { rkey: blockData.rkey, handle: blockData.handle } : 'not found'
    );

    // Also check temp blocks
    const tempBlocks = await getTempBlocks();
    const tempBlockData = tempBlocks[did];
    const tempRkey = tempBlockData?.rkey;
    log.info(
      'Temp block data for',
      did,
      ':',
      tempBlockData ? { rkey: tempBlockData.rkey, handle: tempBlockData.handle } : 'not found'
    );

    const rkeyToUse = rkey || tempRkey;
    log.info('Using rkey:', rkeyToUse || '(none - will scan)');

    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, rkeyToUse);
    log.info('Temp unblocked for viewing:', did);
    return { success: true };
  } catch (error) {
    log.error('Temp unblock for view failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle reblock after temp unblock for viewing
 */
export async function handleReblockUser(
  did: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const generation = captureAuthGeneration();
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = await blockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
    log.info('Re-blocked user:', did, 'result:', result);

    // Update the rkey in permanent storage if this was a permanent block
    if (result) {
      const rkey = result.uri.split('/').pop();
      if (rkey) {
        await withAuthSession(
          auth,
          () =>
            updatePermanentBlocks((blocks) => {
              if (blocks[did] && (!blocks[did].ownerDid || blocks[did].ownerDid === auth.did)) {
                blocks[did] = {
                  ...blocks[did],
                  rkey,
                  ownerDid: auth.did,
                  trackingId: crypto.randomUUID(),
                };
              }
            }),
          generation
        );
      }
    }

    return { success: true };
  } catch (error) {
    log.error('Reblock failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Unified create primitive for block/mute — the single seam behind CREATE_TEMP_ACTION.
 *
 * This encapsulates the only correct ordering for a create, previously duplicated
 * (and partly wrong) across content.tsx, popup, and this handler:
 *
 *   1. Resolve auth; bail with an actionable error if missing.
 *   2. Quota pre-check BEFORE the API call (temp only) so a block can't succeed on
 *      Bluesky while local storage has no room — the historical desync.
 *   3. Call the graph API; if a block returns null/falsy, THROW (never write storage
 *      or report success on a soft API failure).
 *   4. Write storage WITH rollback: on storage failure undo the API action; if the
 *      undo also fails, queue a pendingRollback (repo = owner did) for retry.
 *   5. Read-back verification: re-read storage and confirm the entry landed before
 *      reporting success.
 *
 * `isPermanent` is the sole gate for routing: permanent → permanent storage (LOCAL),
 * temp → temp storage (SYNC). A permanent action never flows through a 0/-1 duration.
 *
 * DID resolution stays in the content script (the background has no page session), so
 * callers pass a resolved `did`. An optional expected owner pins automated callers to
 * the account whose selection the user confirmed.
 */
export async function handleCreateTempAction(
  did: string,
  handle: string,
  durationMs: number,
  isMute: boolean,
  isPermanent: boolean,
  expectedOwner?: string
): Promise<{
  success: boolean;
  error?: string;
  receipt?: { owner: string; did: string; rkey?: string; cid?: string };
  uncertain?: boolean;
}> {
  try {
    // Permanent normalization: callers historically passed 0 (popup/content) or -1
    // (quote-sweep) for "permanent". Collapse to a single convention so a stray -1 can
    // never reach addTempBlock/addTempMute as a duration. Permanent ignores durationMs.
    if (isPermanent) durationMs = 0;

    let generation = captureAuthGeneration();
    const auth = await getAuthToken();
    let commitAuth = auth;
    const sessionOptions = () => ({
      expectedGeneration: generation,
      onSuccessSession: (used: AuthData, usedGeneration: number) => {
        commitAuth = used;
        generation = usedGeneration;
      },
    });
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      // Actionable, pre-formatted error STRING (no auth → no API call).
      return { success: false, error: 'Not authenticated. Open Bluesky in a tab to connect.' };
    }

    if (expectedOwner && auth.did !== expectedOwner) {
      return { success: false, error: 'Account changed. Review and confirm again.' };
    }

    // Quota pre-check BEFORE the API call (temp writes go to bounded sync storage).
    // Permanent writes go to local storage, which is not quota-constrained here.
    if (!isPermanent) {
      const quotaError = await checkQuotaForTempEntry(did, handle, durationMs);
      if (quotaError) {
        // Return a plain pre-formatted error string — StorageQuotaError is a class and
        // must not cross the message boundary.
        return { success: false, error: quotaError };
      }
    }

    const now = Date.now();

    if (expectedOwner) await pinnedAuth(expectedOwner);
    if (isMute) {
      if (expectedOwner)
        await pinnedRequest(
          expectedOwner,
          'app.bsky.graph.muteActor',
          { actor: did },
          false,
          undefined,
          true,
          sessionOptions()
        );
      else await muteUser(did, auth.accessJwt, auth.pdsUrl);

      try {
        await withAuthSession(
          commitAuth ?? auth,
          async () => {
            if (isPermanent) {
              await updatePermanentMutes((mutes) => {
                mutes[did] = {
                  did,
                  handle,
                  createdAt: now,
                  syncedAt: now,
                  ownerDid: auth.did,
                  trackingId: crypto.randomUUID(),
                };
              });
              await setHasCreatedAction();
            } else {
              await addTempMute(did, handle, durationMs, { ownerDid: auth.did });
              if (!(await getTempMutes())[did])
                throw new Error('Storage verification failed: mute not found after write');
            }
          },
          generation
        );
      } catch (storageError) {
        if (
          storageError instanceof AuthSessionChangedError ||
          (await getAuthToken())?.did !== auth.did ||
          expectedOwner
        )
          return {
            success: false,
            uncertain: true,
            receipt: { owner: auth.did, did },
            error:
              'Bluesky accepted the mute but tracking is uncertain. Check the original account manually.',
          };
        return rollbackMute(did, handle, auth, storageError);
      }
    } else {
      const result = expectedOwner
        ? await pinnedRequest<{ uri: string; cid: string }>(
            expectedOwner,
            'com.atproto.repo.createRecord',
            {
              repo: expectedOwner,
              collection: 'app.bsky.graph.block',
              record: {
                $type: 'app.bsky.graph.block',
                subject: did,
                createdAt: new Date().toISOString(),
              },
            },
            false,
            undefined,
            true,
            sessionOptions()
          )
        : await blockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
      // A null/falsy result is a soft (non-throwing) API failure — do NOT write storage
      // or report success. Throwing here surfaces the failure to the caller.
      if (!result) {
        throw new Error('Block API call did not return a record (block may not have taken)');
      }
      const rkey = result.uri ? result.uri.split('/').pop() || undefined : undefined;

      try {
        await withAuthSession(
          commitAuth ?? auth,
          async () => {
            if (isPermanent) {
              await updatePermanentBlocks((blocks) => {
                blocks[did] = {
                  did,
                  handle,
                  createdAt: now,
                  syncedAt: now,
                  rkey,
                  ownerDid: auth.did,
                  trackingId: crypto.randomUUID(),
                };
              });
              await setHasCreatedAction();
            } else {
              await addTempBlock(did, handle, durationMs, rkey, { ownerDid: auth.did });
              if (!(await getTempBlocks())[did])
                throw new Error('Storage verification failed: block not found after write');
            }
          },
          generation
        );
      } catch (storageError) {
        if (
          storageError instanceof AuthSessionChangedError ||
          (await getAuthToken())?.did !== auth.did ||
          expectedOwner
        )
          return {
            success: false,
            uncertain: true,
            receipt: { owner: auth.did, did, rkey, cid: result.cid },
            error: `Bluesky accepted the block (${rkey ?? 'unknown record'}) but tracking is uncertain. Check the original account manually.`,
          };
        return rollbackBlock(did, handle, rkey, auth, storageError);
      }
    }

    await addHistoryEntry({
      did,
      handle,
      action: isMute ? 'muted' : 'blocked',
      timestamp: Date.now(),
      trigger: 'manual',
      success: true,
      duration: isPermanent ? undefined : durationMs,
    });

    return { success: true };
  } catch (error) {
    log.error('Create temp action failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Pre-check quota for a temp entry. Returns a pre-formatted error STRING when the
 * write would exceed quota (so it can cross the message boundary), or null when OK.
 */
async function checkQuotaForTempEntry(
  did: string,
  handle: string,
  durationMs: number
): Promise<string | null> {
  try {
    const estimatedSize = calculateEntrySize(did, handle, durationMs);
    await preCheckStorageQuota(estimatedSize);
    return null;
  } catch (quotaError) {
    if (quotaError instanceof StorageQuotaError) {
      return (
        `Storage full (${Math.round(quotaError.quotaInfo.percentUsed * 100)}% used). ` +
        `Please remove some temp blocks/mutes first.`
      );
    }
    // Non-quota failures from the pre-check are unexpected; surface their message.
    return quotaError instanceof Error ? quotaError.message : 'Storage pre-check failed';
  }
}

/**
 * Undo a block whose storage write failed. Tries an immediate unblock; if that also
 * fails, queues a pendingRollback (repo = owner did) for the background to retry.
 * Always returns a failure result for the create.
 */
async function rollbackBlock(
  did: string,
  handle: string,
  rkey: string | undefined,
  auth: { accessJwt: string; did: string; pdsUrl: string },
  storageError: unknown
): Promise<{ success: false; error: string }> {
  log.error('Storage failed after block, rolling back:', storageError);
  try {
    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, rkey);
    log.info('Rollback successful - user unblocked');
  } catch (rollbackError) {
    log.error('Immediate unblock rollback failed, queuing for retry:', rollbackError);
    try {
      await addPendingRollback({ type: 'unblock', did, handle, rkey });
    } catch (queueError) {
      log.error('Failed to queue unblock rollback:', queueError);
    }
  }
  return {
    success: false,
    error: storageError instanceof Error ? storageError.message : 'Storage write failed',
  };
}

/**
 * Undo a mute whose storage write failed. Mirrors rollbackBlock for mutes.
 */
async function rollbackMute(
  did: string,
  handle: string,
  auth: { accessJwt: string; pdsUrl: string },
  storageError: unknown
): Promise<{ success: false; error: string }> {
  log.error('Storage failed after mute, rolling back:', storageError);
  try {
    await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
    log.info('Rollback successful - user unmuted');
  } catch (rollbackError) {
    log.error('Immediate unmute rollback failed, queuing for retry:', rollbackError);
    try {
      await addPendingRollback({ type: 'unmute', did, handle });
    } catch (queueError) {
      log.error('Failed to queue unmute rollback:', queueError);
    }
  }
  return {
    success: false,
    error: storageError instanceof Error ? storageError.message : 'Storage write failed',
  };
}
