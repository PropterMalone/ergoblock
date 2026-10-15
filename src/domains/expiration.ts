import browser from '../platform/browser.js';
import { normalizeCheckInterval } from '../platform/check-interval.js';
import {
  getAuthToken,
  requestFreshAuth,
  withAuthSession,
  pinnedApiRequest,
  AuthSessionChangedError,
  isExpiredTokenError,
  captureAuthGeneration,
  refreshedAuthGeneration,
} from './api-client.js';
import { unblockUser, unmuteUser } from './graph-ops.js';
import {
  getTempBlocks,
  getTempMutes,
  removeTempBlock,
  removeTempMute,
  addHistoryEntry,
  getOptions,
  getProcessableRollbacks,
  getPendingRollbacks,
  updatePendingRollback,
  removePendingRollback,
  withTrackingLock,
  trackingMatches,
} from '../platform/storage.js';
import type { TrackingIdentity } from '../platform/storage/tracking.js';
import {
  emptyExpirationHealth,
  getExpirationHealth,
  saveExpirationHealth,
  type ExpirationHealth,
  type ExpirationOutcome,
} from '../platform/expiration-health.js';
import type { AuthData } from '../types.js';
import { createLogger, Mutex } from '../platform/utils.js';

const log = createLogger('bg:expiration');
const alarmSetupMutex = new Mutex();
const expirationMutex = new Mutex();
interface ItemResult {
  success: boolean;
  authError: boolean;
  reason?: string;
}
interface ExpiringItem extends TrackingIdentity {
  handle: string;
  expiresAt: number;
  createdAt?: number;
  rkey?: string;
}
function validAuth(auth: AuthData | null | undefined): auth is AuthData {
  return !!(auth?.accessJwt && auth.did && auth.pdsUrl);
}

async function processExpiredItem(
  kind: 'block' | 'mute',
  did: string,
  data: ExpiringItem,
  auth: AuthData,
  generation: number
): Promise<ItemResult> {
  if (data.ownerDid && data.ownerDid !== auth.did)
    return {
      success: false,
      authError: true,
      reason: `This expiration belongs to ${data.ownerDid}. Connect that account to expire it; tracking was preserved.`,
    };
  let backendSucceeded = false;
  try {
    const succeeded = await withTrackingLock(async () => {
      const checkTracking = async () => {
        const current = (kind === 'block' ? await getTempBlocks() : await getTempMutes())[did];
        if (!trackingMatches(current, data) || !current || current.expiresAt >= Date.now())
          throw new Error('Expiration tracking was renewed or changed.');
        if (current.ownerDid && current.ownerDid !== auth.did) throw new AuthSessionChangedError();
      };
      await checkTracking();
      const options = { expectedGeneration: generation, beforeRequest: checkTracking };
      // No auth lock or automatic refresh while holding the shared tracking mutation lock.
      return kind === 'block'
        ? unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, data.rkey, auth, options)
        : unmuteUser(did, auth.accessJwt, auth.pdsUrl, auth, options);
    });
    if (!succeeded) throw new Error('Expiration action did not complete');
    backendSucceeded = true;
    await withAuthSession(
      auth,
      async () => {
        const removed =
          kind === 'block' ? await removeTempBlock(did, data) : await removeTempMute(did, data);
        if (!removed) throw new Error('Tracking changed during expiration.');
        await addHistoryEntry({
          did,
          handle: data.handle,
          action: kind === 'block' ? 'unblocked' : 'unmuted',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: true,
          duration: data.createdAt ? Date.now() - data.createdAt : undefined,
        });
      },
      generation
    );
    return { success: true, authError: false };
  } catch (error) {
    const authError =
      !backendSucceeded &&
      error instanceof Error &&
      (error instanceof AuthSessionChangedError ||
        isExpiredTokenError(error) ||
        error.message.includes('401') ||
        error.message.includes('Auth error'));
    const reason = backendSucceeded
      ? 'Bluesky action succeeded, but local tracking or history could not be updated. Check the account on Bluesky before retrying.'
      : authError
        ? 'Open Bluesky, sign in to the same account, then retry.'
        : 'An expiration action failed. Check your connection, then retry.';
    log.error(reason);
    return { success: false, authError, reason };
  }
}

/** Serialized separately from user actions so slow checks do not lock out Undo. */
export async function checkExpirations(): Promise<ExpirationOutcome> {
  return expirationMutex.runExclusive(async () => {
    let health: ExpirationHealth = {
      ...emptyExpirationHealth(),
      lastAttemptAt: Date.now(),
      status: 'running',
    };
    let healthSaved = true;
    let finalSession: { auth: AuthData; generation: number } | undefined;
    try {
      const previous = await getExpirationHealth();
      health.lastSuccessAt = previous.lastSuccessAt;
    } catch {
      log.error('Could not read previous expiration health.');
      healthSaved = false;
    }
    healthSaved = (await saveExpirationHealth(health)) && healthSaved;
    try {
      let generation = captureAuthGeneration();
      let auth = await getAuthToken();
      if (!validAuth(auth)) {
        auth = await requestFreshAuth();
        if (auth) generation = refreshedAuthGeneration(auth) ?? generation;
      }
      if (!validAuth(auth)) {
        health.status = 'needs_auth';
        health.authNeedsAttention = true;
        health.reason =
          'Open Bluesky and sign in, then select Check now. No expiration actions were checked.';
        try {
          await browser.storage.local.set({ authStatus: 'invalid' });
        } catch {
          log.error('Could not save sign-in attention status.');
          healthSaved = false;
        }
      } else {
        health.accountDid = auth.did;
        const owner = auth.did;
        const blocks = await getTempBlocks();
        const mutes = await getTempMutes();
        const now = Date.now();
        const items = [
          ...Object.entries(blocks)
            .filter(([, data]) => data.expiresAt < now)
            .map(([did, data]) => ({ kind: 'block' as const, did, data })),
          ...Object.entries(mutes)
            .filter(([, data]) => data.expiresAt < now)
            .map(([did, data]) => ({ kind: 'mute' as const, did, data })),
        ];
        // Sequential processing keeps tracking and history outcomes ordered.
        for (const { kind, did, data } of items) {
          let result = await processExpiredItem(kind, did, data, auth, generation);
          if (result.authError && (!data.ownerDid || data.ownerDid === owner)) {
            const freshAuth = await requestFreshAuth(auth);
            if (validAuth(freshAuth) && freshAuth.did === owner) {
              auth = freshAuth;
              generation = refreshedAuthGeneration(freshAuth) ?? generation;
              result = await processExpiredItem(kind, did, data, auth, generation);
            }
          }
          if (result.success) health.completedCount++;
          else {
            health.failedCount++;
            health.authNeedsAttention ||= result.authError;
            // Prefer actionable local-tracking errors over a generic connectivity message.
            if (!health.reason || result.reason?.startsWith('Bluesky action succeeded'))
              health.reason = result.reason;
          }
        }
        const rollbackFailures = await processPendingRollbacks(auth, generation);
        health.failedCount += rollbackFailures;
        const pendingRecovery = await getPendingRollbacks();
        health.pendingRecoveryCount = pendingRecovery.length;
        health.exhaustedRecoveryCount = pendingRecovery.filter(
          (entry) => entry.attempts >= 5
        ).length;
        if (health.pendingRecoveryCount && !health.reason)
          health.reason = health.exhaustedRecoveryCount
            ? 'Pending recovery has exhausted automatic retries. Check the account on Bluesky; recovery remains queued.'
            : 'Pending recovery is waiting for its next retry. Check again after the retry delay.';
        health.status =
          health.failedCount || health.pendingRecoveryCount
            ? health.completedCount
              ? 'partial'
              : 'failed'
            : 'success';
        finalSession = { auth, generation };
      }
    } catch {
      log.error(
        'Expiration check could not finish. Check your connection and local storage, then retry.'
      );
      health.status = health.completedCount ? 'partial' : 'failed';
      health.failedCount++;
      health.reason =
        'Expiration check could not finish. Check your connection and local storage, then retry.';
    }
    health.finishedAt = Date.now();
    if (finalSession) {
      try {
        await withAuthSession(
          finalSession.auth,
          async () => {
            if (health.status === 'success') health.lastSuccessAt = Date.now();
            healthSaved = (await saveExpirationHealth(health)) && healthSaved;
          },
          finalSession.generation
        );
      } catch {
        health.status = health.completedCount
          ? 'partial'
          : health.failedCount
            ? 'failed'
            : 'needs_auth';
        health.authNeedsAttention = true;
        health.reason ??=
          'The connected account or session changed during this check. Reconnect the intended account and check again.';
        healthSaved = (await saveExpirationHealth(health)) && healthSaved;
      }
    } else healthSaved = (await saveExpirationHealth(health)) && healthSaved;
    return { ...health, healthSaved };
  });
}

async function processPendingRollbacks(auth: AuthData, generation: number): Promise<number> {
  const rollbacks = await getProcessableRollbacks();
  let failures = 0;
  for (const rollback of rollbacks) {
    try {
      if (rollback.type === 'unblock') {
        await pinnedApiRequest(
          'com.atproto.repo.deleteRecord',
          'POST',
          {
            repo: auth.did,
            collection: 'app.bsky.graph.block',
            rkey: rollback.rkey,
          },
          auth,
          { refresh: false, expectedGeneration: generation }
        );
      } else if (rollback.type === 'unmute') {
        await pinnedApiRequest(
          'app.bsky.graph.unmuteActor',
          'POST',
          { actor: rollback.did },
          auth,
          { refresh: false, expectedGeneration: generation }
        );
      }
      await withAuthSession(auth, () => removePendingRollback(rollback.id), generation);
    } catch {
      failures++;
      log.error('Pending recovery action failed; it remains queued for retry.');
      await updatePendingRollback(rollback.id, {
        attempts: rollback.attempts + 1,
        lastAttempt: Date.now(),
        error: 'Recovery action failed. Check connection and authentication.',
      });
    }
  }
  return failures;
}

export async function setupAlarm(
  alarmName = 'checkExpirations',
  options?: { periodInMinutes?: number }
): Promise<void> {
  await alarmSetupMutex.runExclusive(async () => {
    const userOptions = await getOptions();
    const intervalMinutes = normalizeCheckInterval(
      options?.periodInMinutes ?? userOptions.checkInterval
    );
    await browser.alarms.clear(alarmName);
    await browser.alarms.create(alarmName, { periodInMinutes: intervalMinutes });
    log.info('Alarm set up with interval:', intervalMinutes, 'minutes');
  });
}
