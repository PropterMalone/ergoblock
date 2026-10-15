import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import browser from '../browser.js';
import { addTempBlock, getTempBlocks, removeTempBlock } from './temp-actions.js';
import {
  getPermanentBlocks,
  removePermanentBlock,
  setPermanentBlocks,
  updatePermanentBlocks,
} from './permanent.js';
import { reconcileTracking } from './reconcile-tracking.js';
import { withTrackingLock } from './tracking.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
describe('serialized tracking mutations', () => {
  it('uses the extension-origin Web Lock and allows explicit nested mutation calls', async () => {
    const request = vi.fn(async (_name: string, work: () => Promise<unknown>) => work());
    vi.stubGlobal('navigator', { locks: { request } });
    await withTrackingLock(async (lock) => {
      await updatePermanentBlocks(
        (map) => {
          map['did:plc:new'] = { did: 'did:plc:new', handle: 'new.test', syncedAt: 1 };
        },
        { lock }
      );
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe('ergoblock-tracking');
    expect((await getPermanentBlocks())['did:plc:new']).toBeDefined();
  });
  it('preserves an unrelated add queued during a deferred removal write', async () => {
    await addTempBlock('did:plc:old', 'old.test', 1000);
    const started = deferred<void>();
    const release = deferred<void>();
    const write = vi.mocked(browser.storage.sync.set).getMockImplementation()!;
    vi.mocked(browser.storage.sync.set).mockImplementationOnce(async (data) => {
      started.resolve();
      await release.promise;
      return write(data);
    });
    const removing = removeTempBlock('did:plc:old');
    await started.promise;
    const adding = addTempBlock('did:plc:new', 'new.test', 1000);
    release.resolve();
    await Promise.all([removing, adding]);
    expect(await getTempBlocks()).toMatchObject({ 'did:plc:new': { handle: 'new.test' } });
    expect((await getTempBlocks())['did:plc:old']).toBeUndefined();
  });
  it('reads a queued add only after the earlier deferred storage read finishes', async () => {
    await addTempBlock('did:plc:old', 'old.test', 1000);
    const started = deferred<void>();
    const release = deferred<Record<string, unknown>>();
    const snapshot = structuredClone(await browser.storage.sync.get('tempBlocks'));
    vi.mocked(browser.storage.sync.get).mockImplementationOnce(async () => {
      started.resolve();
      return release.promise;
    });
    const removing = removeTempBlock('did:plc:old');
    await started.promise;
    const adding = addTempBlock('did:plc:new', 'new.test', 1000);
    release.resolve(snapshot);
    await Promise.all([removing, adding]);
    expect(Object.keys(await getTempBlocks())).toEqual(['did:plc:new']);
  });
  it('does not conditionally remove a same-DID replacement or a legacy backing entry', async () => {
    const expected = await addTempBlock('did:plc:target', 'target.test', 1000, 'key', {
      ownerDid: 'did:plc:owner',
    });
    const replacement = await addTempBlock('did:plc:target', 'target.test', 1000, 'key', {
      ownerDid: 'did:plc:owner',
    });
    expect(await removeTempBlock('did:plc:target', expected)).toBe(false);
    expect((await getTempBlocks())['did:plc:target']).toEqual(replacement);
    await setPermanentBlocks({
      'did:plc:target': { did: 'did:plc:target', handle: 'target.test', syncedAt: 1, rkey: 'key' },
    });
    expect(await removePermanentBlock('did:plc:target', expected)).toBe(false);
    expect((await getPermanentBlocks())['did:plc:target']).toBeDefined();
  });
  it('serializes permanent closure updates and removal without losing unrelated entries', async () => {
    const entry = { did: 'did:plc:old', handle: 'old.test', syncedAt: 1, createdAt: 1 };
    await setPermanentBlocks({ [entry.did]: entry });
    await Promise.all([
      removePermanentBlock(entry.did, entry),
      updatePermanentBlocks((map) => {
        map['did:plc:new'] = { ...entry, did: 'did:plc:new' };
      }),
    ]);
    expect(Object.keys(await getPermanentBlocks())).toEqual(['did:plc:new']);
  });
  it('preserves concurrent renewals/adds/removals when applying a remote snapshot', () => {
    const old = { did: 'did:plc:old', handle: 'old.test', syncedAt: 1, rkey: 'old' };
    const removed = { ...old, did: 'did:plc:removed' };
    const baseline = { [old.did]: old, [removed.did]: removed };
    const replacement = { ...old, trackingId: 'renewed' };
    const added = { ...old, did: 'did:plc:new' };
    const current = { [old.did]: replacement, [added.did]: added };
    reconcileTracking(current, baseline, baseline, 'did:plc:owner', Date.now());
    expect(current).toEqual({ [old.did]: replacement, [added.did]: added });
  });
});
