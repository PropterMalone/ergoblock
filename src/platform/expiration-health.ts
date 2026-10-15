import browser from './browser.js';
import { getTempBlocks, getTempMutes } from './storage.js';
import { createLogger } from './utils.js';

export type ExpirationStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed' | 'needs_auth';
export interface ExpirationHealth {
  status: ExpirationStatus;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  finishedAt?: number;
  accountDid?: string;
  coverage: 'connected_account_only';
  completedCount: number;
  failedCount: number;
  pendingRecoveryCount: number;
  exhaustedRecoveryCount: number;
  authNeedsAttention: boolean;
  reason?: string;
}
export interface ExpirationOutcome extends ExpirationHealth {
  healthSaved: boolean;
}
export interface ExpirationHealthView {
  health: ExpirationHealth;
  overdueBlocks: number;
  overdueMutes: number;
}
const log = createLogger('expiration-health');
export const emptyExpirationHealth = (): ExpirationHealth => ({
  status: 'idle',
  coverage: 'connected_account_only',
  completedCount: 0,
  failedCount: 0,
  pendingRecoveryCount: 0,
  exhaustedRecoveryCount: 0,
  authNeedsAttention: false,
});

export async function getExpirationHealth(): Promise<ExpirationHealth> {
  const stored = await browser.storage.local.get('expirationHealth');
  return {
    ...emptyExpirationHealth(),
    ...(stored.expirationHealth as Partial<ExpirationHealth> | undefined),
  };
}

export async function saveExpirationHealth(health: ExpirationHealth): Promise<boolean> {
  try {
    await browser.storage.local.set({ expirationHealth: health });
    return true;
  } catch {
    // Never log the browser error payload: it may include session data.
    log.error('Could not save expiration health. Retry when local storage is available.');
    return false;
  }
}

export async function getExpirationHealthView(now = Date.now()): Promise<ExpirationHealthView> {
  const [health, blocks, mutes] = await Promise.all([
    getExpirationHealth(),
    getTempBlocks(),
    getTempMutes(),
  ]);
  return {
    health,
    overdueBlocks: Object.values(blocks).filter((entry) => entry.expiresAt < now).length,
    overdueMutes: Object.values(mutes).filter((entry) => entry.expiresAt < now).length,
  };
}

export function expirationCheckResponse(outcome: ExpirationOutcome): {
  success: boolean;
  outcome: ExpirationOutcome;
  error?: string;
} {
  return {
    success: outcome.status === 'success' && outcome.healthSaved,
    outcome,
    error: !outcome.healthSaved
      ? 'Expiration check finished, but its health could not be saved. Check local storage and retry.'
      : outcome.status !== 'success'
        ? outcome.reason
        : undefined,
  };
}
