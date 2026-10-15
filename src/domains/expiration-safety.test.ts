import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from '../platform/browser.js';
import { saveAuthToken } from './api-client.js';
import { checkExpirations } from './expiration.js';
import { addTempBlock, addTempMute, getTempBlocks, getTempMutes } from '../platform/storage.js';

const AUTH = { did: 'did:plc:owner', accessJwt: 'token', pdsUrl: 'https://pds.example' };
const TARGET = 'did:plc:target';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const ok = (data: unknown = {}) => new Response(JSON.stringify(data), { status: 200 });
async function expired(
  kind: 'block' | 'mute',
  ownerDid: string,
  rkey?: string,
  trackingId = 'old'
) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 2000);
  try {
    if (kind === 'block')
      await addTempBlock(TARGET, 'target.test', 1000, rkey, { ownerDid, trackingId });
    else await addTempMute(TARGET, 'target.test', 1000, { ownerDid, trackingId });
  } finally {
    clock.mockRestore();
  }
}
let http: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async () => {
  vi.clearAllMocks();
  await saveAuthToken(AUTH);
  await browser.storage.local.set({ expirationHealth: { lastSuccessAt: 123 } });
  http = vi.fn<typeof fetch>().mockResolvedValue(ok());
  vi.stubGlobal('fetch', http);
});
const originalSyncGet = vi.mocked(browser.storage.sync.get).getMockImplementation()!;
const originalLocalGet = vi.mocked(browser.storage.local.get).getMockImplementation()!;
afterEach(() => {
  vi.mocked(browser.storage.sync.get).mockImplementation(originalSyncGet);
  vi.mocked(browser.storage.local.get).mockImplementation(originalLocalGet);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('expiration mutation and final-success boundaries', () => {
  it.each(['block', 'mute'] as const)(
    'rejects a %s owned by another account before HTTP and preserves tracking',
    async (kind) => {
      const options = { ownerDid: 'did:plc:intended', trackingId: 'owned' };
      await expired(
        kind,
        options.ownerDid,
        kind === 'block' ? 'key' : undefined,
        options.trackingId
      );
      const outcome = await checkExpirations();
      expect(http).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({
        status: 'failed',
        authNeedsAttention: true,
        lastSuccessAt: 123,
      });
      expect(outcome.reason).toContain('did:plc:intended');
      expect(
        (kind === 'block' ? await getTempBlocks() : await getTempMutes())[TARGET]
      ).toMatchObject(options);
    }
  );

  it('does not mutate an expired snapshot renewed before its final tracking check', async () => {
    await expired('block', AUTH.did, 'old-key');
    const read = originalSyncGet;
    let renewed = false;
    vi.mocked(browser.storage.sync.get).mockImplementation(async (key) => {
      const result = structuredClone(await read(key));
      if (key === 'tempMutes' && !renewed) {
        renewed = true;
        await addTempBlock(TARGET, 'target.test', 60000, 'new-key', {
          ownerDid: AUTH.did,
          trackingId: 'renewed',
        });
      }
      return result;
    });
    const outcome = await checkExpirations();
    expect(http).not.toHaveBeenCalled();
    expect(outcome.lastSuccessAt).toBe(123);
    expect((await getTempBlocks())[TARGET]).toMatchObject({
      rkey: 'new-key',
      trackingId: 'renewed',
    });
  });

  it('serializes a renewal behind a held legacy list scan and keeps the renewed entry', async () => {
    await expired('block', AUTH.did);
    const held = deferred<Response>();
    const started = deferred<void>();
    let renewalFinished = false;
    http
      .mockImplementationOnce(() => {
        started.resolve();
        return held.promise;
      })
      .mockImplementationOnce(async () => {
        expect(renewalFinished).toBe(false);
        return ok();
      });
    const check = checkExpirations();
    await started.promise;
    const renewal = addTempBlock(TARGET, 'target.test', 60000, 'new-key', {
      ownerDid: AUTH.did,
      trackingId: 'renewed',
    }).then(() => {
      renewalFinished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(renewalFinished).toBe(false);
    held.resolve(
      ok({
        records: [
          { uri: `at://${AUTH.did}/app.bsky.graph.block/old-key`, value: { subject: TARGET } },
        ],
      })
    );
    await Promise.all([check, renewal]);
    expect(http).toHaveBeenCalledTimes(2);
    expect((await getTempBlocks())[TARGET]).toMatchObject({
      rkey: 'new-key',
      trackingId: 'renewed',
    });
  });

  it('does not DELETE after A to B to identical A while the legacy scan is held', async () => {
    await expired('block', AUTH.did);
    const held = deferred<Response>();
    const started = deferred<void>();
    http.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const pending = checkExpirations();
    await started.promise;
    await saveAuthToken({ ...AUTH, did: 'did:plc:other' });
    await saveAuthToken({ ...AUTH });
    held.resolve(
      ok({
        records: [
          { uri: `at://${AUTH.did}/app.bsky.graph.block/old-key`, value: { subject: TARGET } },
        ],
      })
    );
    const outcome = await pending;
    expect(http).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ authNeedsAttention: true, lastSuccessAt: 123 });
    expect((await getTempBlocks())[TARGET]).toBeDefined();
  });

  it('does not advance last success after A to B to identical A during final recovery read', async () => {
    await expired('mute', AUTH.did);
    const read = originalLocalGet;
    let queueReads = 0;
    vi.mocked(browser.storage.local.get).mockImplementation(async (key) => {
      const result = await read(key);
      if (key === 'pendingRollbacks' && ++queueReads === 2) {
        await saveAuthToken({ ...AUTH, did: 'did:plc:other' });
        await saveAuthToken({ ...AUTH });
      }
      return result;
    });
    const outcome = await checkExpirations();
    expect(outcome).toMatchObject({
      status: 'partial',
      completedCount: 1,
      authNeedsAttention: true,
      lastSuccessAt: 123,
    });
    expect(outcome.reason).toMatch(/account|session/i);
    expect((await browser.storage.local.get('expirationHealth')).expirationHealth).toMatchObject({
      lastSuccessAt: 123,
      status: 'partial',
    });
  });
});
