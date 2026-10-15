import { useEffect, useState } from 'preact/hooks';
import browser from '../../../platform/browser.js';
import { send } from '../../../platform/messages.js';
import {
  getExpirationHealthView,
  type ExpirationHealthView,
  type ExpirationStatus,
} from '../../../platform/expiration-health.js';
import { createLogger } from '../../../platform/utils.js';

const log = createLogger('expiration-health-panel');
const labels: Record<ExpirationStatus, string> = {
  idle: 'Not checked yet',
  running: 'Check running',
  success: 'Last check completed',
  partial: 'Some expiration actions failed',
  failed: 'Expiration check failed',
  needs_auth: 'Sign-in needs attention',
};
const time = (value?: number) => (value ? new Date(value).toLocaleString() : 'Never');

/** Health is local to this browser; overdue counts are read from current action storage. */
export function ExpirationHealth() {
  const [view, setView] = useState<ExpirationHealthView | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [readError, setReadError] = useState('');
  const [retryRunning, setRetryRunning] = useState(false);

  useEffect(() => {
    let mounted = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const next = await getExpirationHealthView();
        if (mounted && request === generation) {
          setView(next);
          setReadError('');
          // A terminated browser worker may leave a running snapshot. Permit recovery,
          // but do not call a completed check successful based on elapsed time alone.
          setRetryRunning(
            next.health.status === 'running' &&
              !!next.health.lastAttemptAt &&
              Date.now() - next.health.lastAttemptAt > 10 * 60_000
          );
        }
      } catch {
        log.error('Could not read expiration health or overdue actions.');
        if (mounted && request === generation)
          setReadError('Health or overdue counts unavailable. Check local storage and retry.');
      }
    };
    const changed = () => {
      void refresh();
    };
    browser.storage.onChanged.addListener(changed);
    const timer = setInterval(changed, 15_000);
    void refresh();
    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(changed);
      clearInterval(timer);
    };
  }, []);

  const checkNow = async () => {
    setChecking(true);
    setMessage('');
    try {
      const response = await send('CHECK_NOW');
      setMessage(
        response.error ||
          response.outcome?.reason ||
          (response.success
            ? 'Expiration check completed for the connected account.'
            : 'Check did not complete. Open Bluesky, check your connection, and retry.')
      );
      try {
        setView(await getExpirationHealthView());
        setReadError('');
      } catch {
        log.error('Could not refresh expiration health after manual check.');
        setReadError(
          'Check returned, but saved health or overdue counts are unavailable. Retry reading after checking local storage.'
        );
      }
    } catch {
      log.error('Could not reach the background expiration check.');
      setMessage('Could not reach the expiration checker. Reload the extension and try again.');
    } finally {
      setChecking(false);
    }
  };
  const health = view?.health;
  const running = checking || (health?.status === 'running' && !retryRunning);
  return (
    <section className="card expiration-health" aria-label="Expiration health">
      <h2>Expiration health</h2>
      <p role="status" aria-live="polite">
        {checking ? 'Check running' : health ? labels[health.status] : 'Loading expiration health…'}
      </p>
      <p>Last successful check: {time(health?.lastSuccessAt)}</p>
      <p>Last attempt: {time(health?.lastAttemptAt)}</p>
      {view && !readError && (
        <p>
          {view.overdueBlocks} overdue blocks · {view.overdueMutes} overdue mutes
        </p>
      )}
      {!!health?.failedCount && <p>{health.failedCount} failed actions in the last check.</p>}
      {!!health?.pendingRecoveryCount && (
        <p>
          {health.pendingRecoveryCount} pending recovery actions · {health.exhaustedRecoveryCount}{' '}
          exhausted automatic retries.
        </p>
      )}
      {health?.authNeedsAttention && (
        <p>
          Sign-in needs attention. Open Bluesky in this browser, sign in to the intended account,
          then check again.
        </p>
      )}
      {health?.reason && <p>{health.reason}</p>}
      {retryRunning && (
        <p>
          The previous check may have been interrupted. You can retry; checks run one at a time.
        </p>
      )}
      {(message || readError) && (
        <p role="alert">{[message, readError].filter(Boolean).join(' ')}</p>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={running}
        onClick={() => {
          void checkNow();
        }}
      >
        Check now
      </button>
      <details className="expiration-health-about">
        <summary>About expiration checks</summary>
        <p>
          Checks use the connected Bluesky account only. ErgoBlock cannot verify which account
          created older stored actions; a completed check does not confirm coverage across accounts.
        </p>
        <p>
          Automatic expiration is best effort. Checks cannot run while the browser is closed or
          offline; overdue actions are retried when the browser, connection, and sign-in are
          available.
        </p>
      </details>
    </section>
  );
}
