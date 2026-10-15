import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAuthToken,
  saveAuthToken,
  captureAuthGeneration,
  withAuthSession,
} from './api-client.js';
import {
  getTempBlocks,
  addTempBlock,
  getPermanentBlocks,
  getPermanentMutes,
  setPermanentBlocks,
} from '../platform/storage.js';
import { pinnedRequest, postBatchAdapter } from './post-batch-actions.js';
import { handleAssignDurationToPermanent } from './action-duration.js';
import { handleCreateTempAction } from './user-actions.js';
import type { BatchRun, BatchItem } from './post-batch.js';
const owner = 'did:plc:owner';
const auth = { did: owner, accessJwt: 'jwt', pdsUrl: 'https://pds.example' };
const receipt = {
  owner,
  runId: 'run',
  createdAt: 1,
  rkey: 'key',
  cid: 'original',
  recordCreatedAt: 'date',
};
const item: BatchItem = {
  did: 'did:plc:target',
  handle: 'target.test',
  status: 'created',
  receipt,
};
const run: BatchRun = {
  id: 'run',
  owner,
  sourcePost: 'at://did:plc:post/app.bsky.feed.post/key',
  audience: 'quotes',
  action: 'block',
  durationMs: -1,
  confirmedAt: 1,
  updatedAt: 1,
  state: 'completed',
  items: [item],
};
const gate = async () => undefined;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function tracked() {
  await setPermanentBlocks({
    [item.did]: {
      did: item.did,
      handle: item.handle,
      createdAt: 1,
      syncedAt: 1,
      rkey: 'key',
      ownerDid: owner,
      trackingId: 'run',
    },
  });
}
let http: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async () => {
  vi.clearAllMocks();
  await saveAuthToken(auth);
  http = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', http);
});
afterEach(() => vi.unstubAllGlobals());
describe('owner-pinned batch API and safe undo', () => {
  it('rejects local commit after A switches to B and back to identical A credentials', async () => {
    const generation = captureAuthGeneration();
    await saveAuthToken({ ...auth, did: 'did:plc:other' });
    await saveAuthToken({ ...auth });
    const commit = vi.fn(async () => undefined);
    await expect(withAuthSession(auth, commit, generation)).rejects.toThrow('session changed');
    expect(commit).not.toHaveBeenCalled();
  });
  it('does not invalidate a captured generation for identical content auth sync', async () => {
    const generation = captureAuthGeneration();
    await saveAuthToken({ ...auth });
    expect(captureAuthGeneration()).toBe(generation);
    await expect(withAuthSession(auth, async () => 'committed', generation)).resolves.toBe(
      'committed'
    );
  });
  it('does not clean tracking after undo HTTP when account switches A to B to identical A', async () => {
    await tracked();
    const held = deferred<Response>();
    const started = deferred<void>();
    http
      .mockResolvedValueOnce(
        response({ cid: 'original', value: { subject: item.did, createdAt: 'date' } })
      )
      .mockImplementationOnce(() => {
        started.resolve();
        return held.promise;
      });
    const pending = postBatchAdapter.undo(run, item, gate);
    await started.promise;
    await saveAuthToken({ ...auth, did: 'did:plc:other' });
    await saveAuthToken({ ...auth });
    held.resolve(response({}));
    expect((await pending).status).toBe('uncertain');
    expect((await getPermanentBlocks())[item.did]).toBeDefined();
  });
  it('does not track a create after HTTP when account switches A to B to identical A', async () => {
    const held = deferred<Response>();
    const started = deferred<void>();
    http.mockResolvedValueOnce(response({ viewer: {} })).mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const pending = postBatchAdapter.create({ ...run, action: 'mute' }, item, gate);
    await started.promise;
    await saveAuthToken({ ...auth, did: 'did:plc:other' });
    await saveAuthToken({ ...auth });
    held.resolve(response({}));
    expect((await pending).status).toBe('uncertain');
    expect((await getPermanentMutes())[item.did]).toBeUndefined();
  });
  it('does not locally track a user action after A to B to identical A', async () => {
    const held = deferred<Response>();
    const started = deferred<void>();
    http.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const pending = handleCreateTempAction(item.did, item.handle, 0, false, true, owner);
    await started.promise;
    await saveAuthToken({ ...auth, did: 'did:plc:other' });
    await saveAuthToken({ ...auth });
    held.resolve(response({ uri: `at://${owner}/app.bsky.graph.block/key`, cid: 'cid' }));
    expect(await pending).toMatchObject({ success: false, uncertain: true });
    expect((await getPermanentBlocks())[item.did]).toBeUndefined();
  });
  it('does not send a mutation after A to B to identical A during preflight', async () => {
    const held = deferred<Response>();
    const started = deferred<void>();
    http.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const pending = postBatchAdapter.create({ ...run, action: 'mute' }, item, gate);
    const rejected = expect(pending).rejects.toThrow('session changed');
    await started.promise;
    await saveAuthToken({ ...auth, did: 'did:plc:other' });
    await saveAuthToken({ ...auth });
    held.resolve(response({ viewer: {} }));
    await rejected;
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('does not send when the current account differs', async () => {
    await saveAuthToken({ ...auth, did: 'did:plc:other' });
    await expect(pinnedRequest(owner, 'app.bsky.graph.muteActor', {})).rejects.toThrow(
      'Account changed'
    );
    expect(http).not.toHaveBeenCalled();
  });
  it('never retries ambiguous network failures', async () => {
    http.mockRejectedValue(new Error('connection lost'));
    await expect(pinnedRequest(owner, 'app.bsky.graph.muteActor', {})).rejects.toThrow(
      'connection lost'
    );
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('skips legacy entries without attributing them to the active owner', async () => {
    await setPermanentBlocks({
      [item.did]: { did: item.did, handle: item.handle, createdAt: 1, syncedAt: 1, rkey: 'key' },
    });
    expect((await postBatchAdapter.undo(run, item, gate)).status).toBe('skipped');
    expect(http).not.toHaveBeenCalled();
  });
  it('skips changed server blocks', async () => {
    await tracked();
    http.mockResolvedValue(
      response({ cid: 'replacement', value: { subject: item.did, createdAt: 'date' } })
    );
    expect((await postBatchAdapter.undo(run, item, gate)).status).toBe('skipped');
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('conditionally deletes only an exact receipt and records cleanup', async () => {
    await tracked();
    http
      .mockResolvedValueOnce(
        response({ cid: 'original', value: { subject: item.did, createdAt: 'date' } })
      )
      .mockResolvedValueOnce(response({}));
    expect((await postBatchAdapter.undo(run, item, gate)).status).toBe('undone');
    expect(JSON.parse(String(http.mock.calls[1][1]?.body))).toMatchObject({
      repo: owner,
      rkey: 'key',
      swapRecord: 'original',
    });
    expect(await getPermanentBlocks()).toEqual({});
  });
  it('does not DELETE after Set expiration renews while getRecord is held', async () => {
    const entry = await addTempBlock(item.did, item.handle, 10000, 'key', {
      ownerDid: owner,
      trackingId: run.id,
    });
    const tempItem = {
      ...item,
      receipt: { ...receipt, createdAt: entry.createdAt, expiresAt: entry.expiresAt },
    };
    const held = deferred<Response>();
    const started = deferred<void>();
    http.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const undo = postBatchAdapter.undo({ ...run, durationMs: 10000 }, tempItem, gate);
    await started.promise;
    await addTempBlock(item.did, item.handle, 20000, 'key', { ownerDid: owner });
    held.resolve(response({ cid: 'original', value: { subject: item.did, createdAt: 'date' } }));
    expect((await undo).status).toBe('skipped');
    expect(http).toHaveBeenCalledTimes(1);
    expect((await getTempBlocks())[item.did].trackingId).not.toBe(run.id);
  });
  it('does not DELETE a permanent block given expiration while getRecord is held', async () => {
    await tracked();
    const held = deferred<Response>();
    const started = deferred<void>();
    http.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const undo = postBatchAdapter.undo(run, item, gate);
    await started.promise;
    expect(await handleAssignDurationToPermanent(item.did, 'block', 20000)).toEqual({
      success: true,
    });
    held.resolve(response({ cid: 'original', value: { subject: item.did, createdAt: 'date' } }));
    expect((await undo).status).toBe('skipped');
    expect(http).toHaveBeenCalledTimes(1);
  });
  it.each(['block', 'mute'] as const)(
    'retains the %s receipt as uncertain after account change during create',
    async (action) => {
      const held = deferred<Response>();
      const started = deferred<void>();
      http.mockResolvedValueOnce(response({ viewer: {} }));
      if (action === 'block') http.mockResolvedValueOnce(response({ records: [] }));
      http.mockImplementationOnce(() => {
        started.resolve();
        return held.promise;
      });
      const creating = postBatchAdapter.create({ ...run, action }, item, gate);
      await started.promise;
      await saveAuthToken({ ...auth, did: 'did:plc:other', accessJwt: 'other' });
      const otherEntry = {
        did: 'did:plc:other-target',
        handle: 'other.test',
        syncedAt: 1,
        ownerDid: 'did:plc:other',
      };
      await setPermanentBlocks({ [otherEntry.did]: otherEntry });
      held.resolve(
        response(
          action === 'block'
            ? { uri: `at://${owner}/app.bsky.graph.block/key`, cid: 'created' }
            : {}
        )
      );
      const result = await creating;
      expect(result.status).toBe('uncertain');
      expect(result.receipt?.owner).toBe(owner);
      if (action === 'block') expect(result.receipt?.cid).toBe('created');
      expect(await getPermanentBlocks()).toEqual({ [otherEntry.did]: otherEntry });
      expect(await getTempBlocks()).toEqual({});
    }
  );
  it('preserves the server receipt for expected-owner user actions after account change', async () => {
    const held = deferred<Response>();
    const started = deferred<void>();
    http.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const creating = handleCreateTempAction(item.did, item.handle, 10000, false, false, owner);
    await started.promise;
    await saveAuthToken({ ...auth, did: 'did:plc:other', accessJwt: 'other' });
    held.resolve(response({ uri: `at://${owner}/app.bsky.graph.block/key`, cid: 'created' }));
    expect(await creating).toMatchObject({
      success: false,
      uncertain: true,
      receipt: { owner, rkey: 'key', cid: 'created' },
    });
    expect(await getTempBlocks()).toEqual({});
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('does not clean up the new owner after account change during delete', async () => {
    await tracked();
    const held = deferred<Response>();
    const started = deferred<void>();
    http.mockResolvedValueOnce(
      response({ cid: 'original', value: { subject: item.did, createdAt: 'date' } })
    );
    http.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const undo = postBatchAdapter.undo(run, item, gate);
    await started.promise;
    await saveAuthToken({ ...auth, did: 'did:plc:other', accessJwt: 'other' });
    held.resolve(response({}));
    expect((await undo).status).toBe('uncertain');
    expect((await getPermanentBlocks())[item.did]).toBeDefined();
    expect((await getAuthToken())?.did).toBe('did:plc:other');
  });
  it('abstains from automatic mute undo', async () => {
    expect((await postBatchAdapter.undo({ ...run, action: 'mute' }, item, gate)).status).toBe(
      'skipped'
    );
    expect(http).not.toHaveBeenCalled();
  });
  it('honors stop before the next HTTP request', async () => {
    await expect(
      pinnedRequest(owner, 'app.bsky.graph.muteActor', {}, false, async () => {
        throw new Error('Stopped');
      })
    ).rejects.toThrow('Stopped');
    expect(http).not.toHaveBeenCalled();
  });
});
