import browser from '../browser.js';
import type { BatchRun, BatchStore } from '../../domains/post-batch.js';

export const POST_BATCH_KEY = 'postAudienceBatchesV1';
// Leave headroom for auth, tracking and a maximum-size receipt update on browsers with 5MB local quota.
const JOURNAL_LIMIT = 3 * 1024 * 1024;
const LOCAL_BUDGET = 4 * 1024 * 1024;
export const postBatchStore: BatchStore = {
  async load() {
    const data = await browser.storage.local.get(POST_BATCH_KEY);
    const runs: unknown = data[POST_BATCH_KEY];
    if (runs === undefined) return [];
    if (!Array.isArray(runs))
      throw new Error('Operation journal is unreadable. No requests will run.');
    return runs as BatchRun[];
  },
  async save(runs) {
    const bytes = new TextEncoder().encode(JSON.stringify(runs)).length;
    // Reserve outcome space before the first write, not only when receipts start growing.
    const reserved = runs.reduce(
      (sum, run) =>
        sum +
        run.items.filter((item) => ['pending', 'in-flight'].includes(item.status)).length * 700,
      0
    );
    if (bytes + reserved > JOURNAL_LIMIT)
      throw new Error(
        'Operation history is full. Use a smaller selection; no new requests were started.'
      );
    const used = await browser.storage.local.getBytesInUse(null);
    const old = await browser.storage.local.getBytesInUse(POST_BATCH_KEY);
    if (used - old + bytes + reserved > LOCAL_BUDGET)
      throw new Error('Local storage is full. No further requests will run.');
    await browser.storage.local.set({ [POST_BATCH_KEY]: runs });
  },
};
