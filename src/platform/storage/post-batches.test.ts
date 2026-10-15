import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../browser.js', () => ({
  default: { storage: { local: { get: vi.fn(), set: vi.fn(), getBytesInUse: vi.fn() } } },
}));
import browser from '../browser.js';
import { postBatchStore, POST_BATCH_KEY } from './post-batches.js';
import type { BatchRun } from '../../domains/post-batch.js';
const run: BatchRun = {
  id: 'run',
  owner: 'did:plc:owner',
  sourcePost: 'at://did:plc:author/app.bsky.feed.post/key',
  audience: 'quotes',
  action: 'block',
  durationMs: -1,
  confirmedAt: 1,
  updatedAt: 1,
  state: 'running',
  items: [{ did: 'did:plc:target', handle: 'target.test', status: 'pending' }],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  vi.mocked(browser.storage.local.getBytesInUse).mockResolvedValue(0);
});
describe('local operation journal', () => {
  it('reloads saved operations', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [POST_BATCH_KEY]: [run] });
    expect(await postBatchStore.load()).toEqual([run]);
  });
  it('reserves receipt space before starting a large selection', async () => {
    const oversized = { ...run, items: Array.from({ length: 5000 }, () => run.items[0]) };
    await expect(postBatchStore.save([oversized])).rejects.toThrow('history is full');
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
  it('rejects local quota exhaustion before saving', async () => {
    vi.mocked(browser.storage.local.getBytesInUse).mockImplementation(async (key) =>
      key === null ? 4 * 1024 * 1024 : 0
    );
    await expect(postBatchStore.save([run])).rejects.toThrow('Local storage is full');
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
  it('surfaces journal write failures', async () => {
    vi.mocked(browser.storage.local.set).mockRejectedValue(new Error('storage unavailable'));
    await expect(postBatchStore.save([run])).rejects.toThrow('storage unavailable');
  });
});
