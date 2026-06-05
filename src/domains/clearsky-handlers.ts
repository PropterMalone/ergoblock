/**
 * Clearsky cache message handlers - extracted from background.ts
 */

import { clearClearskyCache } from '../platform/clearskyCache.js';
import { processBlockedByQueue, prewarmBlockedByCache } from './clearskyService.js';
import { createLogger } from '../platform/utils.js';

const log = createLogger('bg:clearsky');

export async function handleClearClearskyCache(): Promise<{ success: boolean; error?: string }> {
  try {
    await clearClearskyCache();
    log.info('Clearsky cache cleared');
    return { success: true };
  } catch (error) {
    log.error('Failed to clear Clearsky cache:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handlePrefetchClearskyLookahead(targetDids: string[]): Promise<{
  success: boolean;
  queued?: number;
  alreadyCached?: number;
}> {
  const result = await prewarmBlockedByCache(targetDids, true);
  log.info(`Lookahead prefetch: ${result.queued} queued, ${result.alreadyCached} cached`);
  if (result.queued > 0) {
    processBlockedByQueue(result.queued).catch((err) => {
      log.error('Lookahead processing failed:', err);
    });
  }
  return { success: true, ...result };
}
