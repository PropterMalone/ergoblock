import browser from '../platform/browser.js';
import { createLogger } from '../platform/utils.js';
import { postBatchStore } from '../platform/storage/post-batches.js';
import { BatchRunner, type BatchInput } from './post-batch.js';
import { postBatchAdapter } from './post-batch-actions.js';

const log = createLogger('post-batches');
export const POST_BATCH_ALARM = 'postAudienceBatchWake';
const runner = new BatchRunner(postBatchStore, postBatchAdapter);
let ready: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
export function initializePostBatches(): Promise<void> {
  ready ??= runner.recover();
  return ready;
}
async function schedule(): Promise<void> {
  // Alarm is the durable fallback if a worker is suspended between cooperative steps.
  await browser.alarms.create(POST_BATCH_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  if (!timer)
    timer = setTimeout(() => {
      timer = undefined;
      void wakePostBatches();
    }, 250);
}
export async function wakePostBatches(): Promise<void> {
  try {
    await initializePostBatches();
    if (await runner.step()) await schedule();
    else await browser.alarms.clear(POST_BATCH_ALARM);
  } catch (error) {
    log.error('Operation paused after journal failure:', error);
    await browser.alarms.clear(POST_BATCH_ALARM);
  }
}
export async function startPostBatch(input: BatchInput): Promise<{ id: string }> {
  await initializePostBatches();
  const id = await runner.start(input);
  try {
    await schedule();
  } catch (error) {
    await runner.stop(id);
    throw error;
  }
  return { id };
}
export async function getPostBatches() {
  await initializePostBatches();
  return { runs: await runner.list() };
}
export async function stopPostBatch(id: string) {
  await initializePostBatches();
  await runner.stop(id);
  return { success: true };
}
export async function undoPostBatch(id: string, confirmed: boolean) {
  await initializePostBatches();
  await runner.undo(id, confirmed);
  await schedule();
  return { success: true };
}
