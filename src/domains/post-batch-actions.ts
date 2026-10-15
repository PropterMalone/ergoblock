import {
  getAuthToken,
  pinnedApiRequest,
  withAuthSession,
  captureAuthGeneration,
  type PinnedRequestOptions,
} from './api-client.js';
import {
  getTempBlocks,
  getTempMutes,
  getPermanentBlocks,
  getPermanentMutes,
  updatePermanentBlocks,
  updatePermanentMutes,
  removePermanentBlock,
  withTrackingLock,
  trackingMatches,
  addTempBlock,
  addTempMute,
  removeTempBlock,
  preCheckStorageQuota,
  calculateEntrySize,
} from '../platform/storage.js';
import type { AuthData, ProfileWithViewer } from '../types.js';
import type { BatchAdapter, BatchRun, BatchItem, BatchReceipt } from './post-batch.js';

export async function pinnedAuth(owner: string): Promise<AuthData> {
  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth.pdsUrl || auth.did !== owner)
    throw new Error('Account changed or disconnected. No request sent.');
  return auth;
}

/** Mutations have no automatic network retry. Only an explicit authentication rejection permits one refresh. */
export async function pinnedRequest<T>(
  owner: string,
  endpoint: string,
  body?: unknown,
  _publicRead = false,
  beforeRequest?: () => Promise<void>,
  allowRefresh = true,
  sessionOptions: Pick<PinnedRequestOptions, 'expectedGeneration' | 'onSuccessSession'> = {}
): Promise<T> {
  const auth = await pinnedAuth(owner);
  const result = await pinnedApiRequest<T>(
    endpoint,
    body === undefined ? 'GET' : 'POST',
    body ?? null,
    auth,
    {
      beforeRequest,
      refresh: allowRefresh,
      ...sessionOptions,
    }
  );
  if (result === null) throw new Error('Bluesky returned no response');
  return result;
}

async function tracked(run: BatchRun, did: string) {
  return run.action === 'mute'
    ? { temp: (await getTempMutes())[did], permanent: (await getPermanentMutes())[did] }
    : { temp: (await getTempBlocks())[did], permanent: (await getPermanentBlocks())[did] };
}

export const postBatchAdapter: BatchAdapter = {
  async owner() {
    return (await getAuthToken())?.did;
  },
  async create(run, item, beforeRequest) {
    let generation = captureAuthGeneration();
    let session = await pinnedAuth(run.owner);
    const request = <T>(endpoint: string, body?: unknown, publicRead = false) =>
      pinnedRequest<T>(run.owner, endpoint, body, publicRead, beforeRequest, true, {
        expectedGeneration: generation,
        onSuccessSession: (used, usedGeneration) => {
          session = used;
          generation = usedGeneration;
        },
      });
    // Read failures are safe to pause, not permission to assume an account is unblocked.
    if (item.did === run.owner) return { status: 'skipped', detail: 'Your own account' };
    const existing = await tracked(run, item.did);
    if (existing.temp || existing.permanent)
      return { status: 'skipped', detail: 'Already tracked; not changed' };
    const profile = await request<ProfileWithViewer>(
      `app.bsky.actor.getProfile?actor=${encodeURIComponent(item.did)}`,
      undefined,
      true
    );
    if (!profile.viewer) throw new Error('Could not verify current block/mute state');
    if (
      profile.viewer.following ||
      (run.action === 'mute' ? profile.viewer.muted : profile.viewer.blocking)
    )
      return { status: 'skipped', detail: 'Already active or followed; not changed' };
    // Check repository directly as well: AppView viewer state can lag recent block writes.
    if (run.action === 'block') {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page: { records: Array<{ value: { subject?: string } }>; cursor?: string } =
          await request(
            `com.atproto.repo.listRecords?repo=${encodeURIComponent(run.owner)}&collection=app.bsky.graph.block&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
          );
        if (!Array.isArray(page.records)) throw new Error('Could not verify existing blocks');
        if (page.records.some((r) => r.value.subject === item.did))
          return { status: 'skipped', detail: 'Block already exists on Bluesky' };
        cursor = page.cursor;
        if (cursor && cursors.has(cursor))
          throw new Error('Could not finish checking existing blocks');
        if (cursor) cursors.add(cursor);
        if (cursors.size >= 50)
          throw new Error(
            'Block list too large to verify safely in this operation; no block was created'
          );
      } while (cursor);
    }
    if (run.durationMs !== -1)
      await preCheckStorageQuota(calculateEntrySize(item.did, item.handle, run.durationMs));
    const receipt: BatchReceipt = { owner: run.owner, runId: run.id, createdAt: Date.now() };
    await pinnedAuth(run.owner);
    if (run.action === 'block') {
      receipt.recordCreatedAt = new Date().toISOString();
      const result = await request<{ uri: string; cid: string }>('com.atproto.repo.createRecord', {
        repo: run.owner,
        collection: 'app.bsky.graph.block',
        record: {
          $type: 'app.bsky.graph.block',
          subject: item.did,
          createdAt: receipt.recordCreatedAt,
        },
      });
      if (!result.uri?.startsWith(`at://${run.owner}/app.bsky.graph.block/`) || !result.cid)
        throw new Error('Missing block receipt; check Bluesky manually');
      receipt.rkey = result.uri.split('/').pop();
      receipt.cid = result.cid;
    } else await request('app.bsky.graph.muteActor', { actor: item.did });
    // Any failure from here is uncertain, never an automatic rollback of potentially replaced actions.
    try {
      await withAuthSession(
        session,
        () =>
          withTrackingLock(async (lock) => {
            const current = await tracked(run, item.did);
            if (current.temp || current.permanent)
              throw new Error('Tracking changed while the request was pending');
            const metadata = { ownerDid: run.owner, trackingId: run.id };
            if (run.durationMs === -1) {
              const update = run.action === 'block' ? updatePermanentBlocks : updatePermanentMutes;
              await update(
                (maps) => {
                  maps[item.did] = {
                    did: item.did,
                    handle: item.handle,
                    createdAt: receipt.createdAt,
                    syncedAt: receipt.createdAt,
                    ...metadata,
                    ...(receipt.rkey ? { rkey: receipt.rkey } : {}),
                  };
                },
                { lock }
              );
            } else {
              const options = { ...metadata, lock };
              const entry =
                run.action === 'block'
                  ? await addTempBlock(item.did, item.handle, run.durationMs, receipt.rkey, options)
                  : await addTempMute(item.did, item.handle, run.durationMs, options);
              receipt.createdAt = entry.createdAt;
              receipt.expiresAt = entry.expiresAt;
            }
          }),
        generation
      );
    } catch (error) {
      return {
        status: 'uncertain',
        receipt,
        detail: `Bluesky accepted the request but tracking failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { status: 'created', receipt };
  },
  async undo(run: BatchRun, item: BatchItem, beforeRequest) {
    let generation = captureAuthGeneration();
    let session = await pinnedAuth(run.owner);
    const sessionOptions = () => ({
      expectedGeneration: generation,
      onSuccessSession: (used: AuthData, usedGeneration: number) => {
        session = used;
        generation = usedGeneration;
      },
    });
    const receipt = item.receipt;
    if (!receipt || receipt.runId !== run.id || receipt.owner !== run.owner)
      return { status: 'skipped', detail: 'No receipt for this operation' };
    if (run.action === 'mute')
      return {
        status: 'skipped',
        detail:
          'Mute identity cannot be verified after an external re-mute. Remove manually on Bluesky if wanted.',
      };
    if (!receipt.rkey || !receipt.cid || !receipt.recordCreatedAt)
      return { status: 'skipped', detail: 'Incomplete block identity' };
    if (receipt.expiresAt && receipt.expiresAt <= Date.now())
      return { status: 'skipped', detail: 'Already expired' };
    const expected = {
      ownerDid: receipt.owner,
      trackingId: receipt.runId,
      rkey: receipt.rkey,
      createdAt: receipt.createdAt,
      expiresAt: receipt.expiresAt,
    };
    const matches = async () => {
      const entries = await tracked(run, item.did);
      if (run.durationMs === -1 && entries.temp) return false;
      return trackingMatches(run.durationMs === -1 ? entries.permanent : entries.temp, expected);
    };
    const gate = async () => {
      await beforeRequest();
      if (!(await matches())) throw new Error('Tracking was removed or changed');
    };
    if (!(await matches())) return { status: 'skipped', detail: 'Tracking was removed or changed' };
    const server = await pinnedRequest<{
      cid: string;
      value: { subject?: string; createdAt?: string };
    }>(
      run.owner,
      `com.atproto.repo.getRecord?repo=${encodeURIComponent(run.owner)}&collection=app.bsky.graph.block&rkey=${encodeURIComponent(receipt.rkey)}`,
      undefined,
      false,
      gate,
      true,
      sessionOptions()
    );
    if (
      server.cid !== receipt.cid ||
      server.value.subject !== item.did ||
      server.value.createdAt !== receipt.recordCreatedAt
    )
      return { status: 'skipped', detail: 'Block was changed or replaced on Bluesky' };
    const deleted = await withTrackingLock(async () => {
      // Renewals may finish while getRecord is pending. Check again under the mutation boundary.
      if (!(await matches())) return false;
      await pinnedRequest(
        run.owner,
        'com.atproto.repo.deleteRecord',
        {
          repo: run.owner,
          collection: 'app.bsky.graph.block',
          rkey: receipt.rkey,
          swapRecord: receipt.cid,
        },
        false,
        gate,
        // Never acquire the auth mutation lock from inside the tracking lock.
        false,
        sessionOptions()
      );
      return true;
    });
    if (!deleted) return { status: 'skipped', detail: 'Tracking was removed or changed' };
    try {
      await withAuthSession(
        session,
        () =>
          withTrackingLock(async (lock) => {
            if (run.durationMs === -1) await removePermanentBlock(item.did, expected, { lock });
            else {
              await removeTempBlock(item.did, expected, { lock });
              // A preexisting permanent backing entry is not this operation's receipt.
              await removePermanentBlock(item.did, expected, { lock });
            }
          }),
        generation
      );
    } catch (error) {
      return {
        status: 'uncertain',
        receipt,
        detail: `Block deleted on the original account; tracking cleanup was not applied: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { status: 'undone' };
  },
};
