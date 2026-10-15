import { describe, it, expect, vi } from 'vitest';
import { BatchRunner, type BatchStore, type BatchRun, type BatchAdapter } from './post-batch.js';

function setup() {
  let runs: BatchRun[] = [];
  const store: BatchStore = {
    load: vi.fn(async () => structuredClone(runs)),
    save: vi.fn(async (next) => {
      runs = structuredClone(next);
    }),
  };
  const adapter: BatchAdapter = {
    owner: vi.fn(async () => 'did:plc:owner'),
    create: vi.fn(async (_run, item) => ({
      status: 'created' as const,
      receipt: {
        runId: _run.id,
        createdAt: 1,
        rkey: item.did,
        cid: 'cid',
        recordCreatedAt: 'date',
      },
    })),
    undo: vi.fn(async () => ({ status: 'undone' as const })),
  };
  const runner = new BatchRunner(store, adapter);
  const input = {
    owner: 'did:plc:owner',
    sourcePost: 'at://did:plc:post/app.bsky.feed.post/key',
    audience: 'quotes' as const,
    action: 'block' as const,
    durationMs: 3600000,
    confirmed: true,
    targets: [
      { did: 'did:plc:a', handle: 'a.test' },
      { did: 'did:plc:b', handle: 'b.test' },
    ],
  };
  return { runner, store, adapter, input };
}

describe('durable post batches', () => {
  it('persists confirmed intent before any mutation and survives reload', async () => {
    const { runner, store, adapter, input } = setup();
    const id = await runner.start(input);
    expect(adapter.create).not.toHaveBeenCalled();
    expect((await new BatchRunner(store, adapter).list())[0].id).toBe(id);
    await runner.step();
    expect((await runner.list())[0].items[0].receipt?.runId).toBe(id);
  });
  it('stops after the current request, preserving its receipt', async () => {
    const { runner, adapter, input } = setup();
    let finish!: () => void;
    vi.mocked(adapter.create).mockImplementation(async (run) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { status: 'created', receipt: { runId: run.id, createdAt: 1 } };
    });
    const id = await runner.start(input);
    const work = runner.step();
    await vi.waitFor(() => expect(finish).toBeDefined());
    await runner.stop(id);
    finish();
    await work;
    expect((await runner.list())[0].items.map((i) => i.status)).toEqual([
      'created',
      'not-attempted',
    ]);
  });
  it('marks interrupted writes uncertain and never resumes after restart', async () => {
    const { runner, store, adapter, input } = setup();
    await runner.start(input);
    const runs = await store.load();
    runs[0].items[0].status = 'in-flight';
    await store.save(runs);
    const restarted = new BatchRunner(store, adapter);
    await restarted.recover();
    await restarted.step();
    const run = (await restarted.list())[0];
    expect(run.state).toBe('paused');
    expect(run.items[0].status).toBe('uncertain');
    expect(adapter.create).not.toHaveBeenCalled();
  });
  it('serializes starts and steps, rejects duplicates and owner switches', async () => {
    const { runner, adapter, input } = setup();
    await runner.start(input);
    await expect(runner.start(input)).rejects.toThrow('unfinished');
    vi.mocked(adapter.owner).mockResolvedValue('did:plc:other');
    await Promise.all([runner.step(), runner.step()]);
    expect(adapter.create).not.toHaveBeenCalled();
    expect((await runner.list())[0].state).toBe('paused');
  });
  it('never writes when journal persistence fails before intent', async () => {
    const { runner, store, adapter, input } = setup();
    await runner.start(input);
    vi.mocked(store.save).mockRejectedValue(new Error('disk full'));
    await expect(runner.step()).rejects.toThrow('Outcome storage failed');
    expect(adapter.create).not.toHaveBeenCalled();
  });
  it('latches an outcome journal read failure and recovers the in-flight item without retry', async () => {
    const { runner, store, adapter, input } = setup();
    await runner.start(input);
    vi.mocked(adapter.create).mockImplementation(async (run, item, beforeRequest) => {
      await beforeRequest();
      return {
        status: 'created',
        receipt: { runId: run.id, createdAt: 1, rkey: item.did, cid: 'cid' },
      };
    });
    const load = vi.mocked(store.load).getMockImplementation()!;
    let reads = 0;
    vi.mocked(store.load).mockImplementation(async () => {
      reads++;
      if (reads === 3) throw new Error('private storage detail');
      return load();
    });
    await expect(runner.step()).rejects.toThrow('Outcome storage failed');
    expect((await runner.list())[0].items[0].status).toBe('created');
    expect((await runner.list())[0].items[0].receipt).toBeDefined();
    expect((await runner.list())[0].error).not.toContain('private storage detail');

    await runner.step();
    expect(adapter.create).toHaveBeenCalledTimes(1);

    const restarted = new BatchRunner(store, adapter);
    await restarted.recover();
    await restarted.step();
    const run = (await restarted.list())[0];
    expect(run.state).toBe('paused');
    expect(run.items[0].status).toBe('uncertain');
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });
  it('keeps durable in-flight intent if receipt persistence fails', async () => {
    const { runner, store, adapter, input } = setup();
    await runner.start(input);
    const save = vi.mocked(store.save).getMockImplementation()!;
    let n = 0;
    vi.mocked(store.save).mockImplementation(async (runs) => {
      n++;
      if (n === 2) throw new Error('disk full');
      return save(runs);
    });
    await expect(runner.step()).rejects.toThrow('Outcome storage failed');
    const restarted = new BatchRunner(store, adapter);
    await restarted.recover();
    expect((await restarted.list())[0].items[0].status).toBe('uncertain');
  });
  it('records mixed outcomes without replaying completed accounts', async () => {
    const { runner, adapter, input } = setup();
    await runner.start(input);
    vi.mocked(adapter.create)
      .mockResolvedValueOnce({ status: 'skipped', detail: 'Already blocked' })
      .mockResolvedValueOnce({ status: 'failed', detail: 'Rejected' });
    await runner.step();
    await runner.step();
    await runner.step();
    expect(adapter.create).toHaveBeenCalledTimes(2);
    expect((await runner.list())[0].items.map((i) => i.status)).toEqual(['skipped', 'failed']);
  });
  it('requires confirmation and selectively undoes only receipts', async () => {
    const { runner, adapter, input } = setup();
    const id = await runner.start(input);
    await runner.step();
    await runner.stop(id);
    await expect(runner.undo(id, false)).rejects.toThrow('Confirm');
    await runner.undo(id, true);
    await runner.step();
    expect(adapter.undo).toHaveBeenCalledTimes(1);
    expect((await runner.list())[0].items[0].undo?.status).toBe('undone');
  });
  it('does not evict unresolved stopped outcomes when retaining ten operations', async () => {
    const { runner, store, input } = setup();
    await runner.start(input);
    const seed = (await store.load())[0];
    seed.state = 'stopped';
    seed.items = seed.items.map((item) => ({ ...item, status: 'uncertain' }));
    await store.save(Array.from({ length: 10 }, (_, index) => ({ ...seed, id: String(index) })));
    await expect(runner.start(input)).rejects.toThrow('unresolved');
    expect(await store.load()).toHaveLength(10);
  });
  it('allows an explicitly new selection after stopping but never retries the uncertain item', async () => {
    const { runner, store, adapter, input } = setup();
    const id = await runner.start(input);
    const runs = await store.load();
    runs[0].state = 'paused';
    runs[0].items[0].status = 'uncertain';
    await store.save(runs);
    await runner.stop(id);
    await runner.start({ ...input, targets: [{ did: 'did:plc:new', handle: 'new.test' }] });
    expect(adapter.create).not.toHaveBeenCalled();
    expect((await runner.list())[0].items[0].status).toBe('uncertain');
  });
  it('rejects unconfirmed, oversized and duplicate targets', async () => {
    const { runner, input } = setup();
    await expect(runner.start({ ...input, confirmed: false })).rejects.toThrow('Confirm');
    await expect(
      runner.start({
        ...input,
        targets: Array.from({ length: 5001 }, (_, i) => ({ did: `did:plc:${i}`, handle: 'a' })),
      })
    ).rejects.toThrow('5000');
    await expect(
      runner.start({ ...input, targets: [input.targets[0], input.targets[0]] })
    ).rejects.toThrow('duplicate');
  });
});
