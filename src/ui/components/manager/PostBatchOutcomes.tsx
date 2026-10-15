import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { send } from '../../../platform/messages.js';
import type { BatchRun } from '../../../domains/post-batch.js';

export function usePostBatches() {
  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const result = await send('GET_POST_BATCHES', {});
      setRuns(result.runs ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load operation history');
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      if (mounted) await refresh();
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [refresh]);
  return {
    runs,
    error,
    setError,
    refresh,
    busy: runs.some((run) => ['running', 'stopping', 'undoing'].includes(run.state)),
  };
}

export function PostBatchOutcomes({
  runs,
  error,
  refresh,
  onError,
}: {
  runs: BatchRun[];
  error: string | null;
  refresh: () => Promise<void>;
  onError: (error: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const labels: Record<string, string> = {
    running: 'In progress',
    stopping: 'Stopping',
    stopped: 'Stopped',
    completed: 'Finished',
    paused: 'Paused — review needed',
    undoing: 'Undo in progress',
    pending: 'waiting',
    'in-flight': 'request in progress',
    created: 'created',
    skipped: 'skipped',
    failed: 'failed',
    uncertain: 'need checking',
    'not-attempted': 'not attempted',
  };
  const act = async (run: BatchRun, undo: boolean) => {
    if (
      undo &&
      !confirm(
        `Undo only unchanged blocks created by this operation (${run.items.filter((i) => i.status === 'created' && !i.undo).length} eligible)?\n\nAccount: ${run.owner}\nPost: ${run.sourcePost}\nMutes cannot be safely identified after an external re-mute and will not be undone automatically.`
      )
    )
      return;
    try {
      if (undo) await send('UNDO_POST_BATCH', { id: run.id, confirmed: true });
      else await send('STOP_POST_BATCH', { id: run.id });
      await refresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Operation request failed');
    }
  };
  return (
    <section aria-label="Operation history" class="copy-user-summary">
      <h3>Operation history</h3>
      {error && <p role="alert">{error}</p>}
      {runs.length === 0 && <p>No saved operations yet.</p>}
      {[...runs].reverse().map((run) => {
        const counts = new Map<string, number>();
        for (const item of run.items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
        const current = run.items.find(
          (item) => item.status === 'in-flight' || item.undo?.status === 'in-flight'
        );
        const busy = ['running', 'stopping', 'undoing'].includes(run.state);
        return (
          <article key={run.id}>
            <h4>
              {run.action === 'block' ? 'Block' : 'Mute'} ·{' '}
              {{ quotes: 'Quote authors', likes: 'Likers', reposts: 'Reposters' }[run.audience]} ·{' '}
              {labels[run.state]}
            </h4>
            <p>
              {new Date(run.confirmedAt).toLocaleString()} ·{' '}
              {run.durationMs === -1 ? 'Permanent' : `${run.durationMs / 3600000} hours`} ·{' '}
              {run.items.length} {run.items.length === 1 ? 'account' : 'accounts'}
            </p>
            <p>
              Account: {run.owner}
              <br />
              Post: {run.sourcePost}
            </p>
            <p aria-live="polite">
              {[...counts]
                .map(([status, count]) => `${count} ${labels[status] || status}`)
                .join(' · ')}
              {current ? ` · Current: @${current.handle}` : ''}
            </p>
            {run.error && <p role="alert">{run.error}</p>}
            {(busy || run.state === 'paused') && (
              <button onClick={() => void act(run, false)}>Stop after current request</button>
            )}
            {!busy &&
              run.action === 'block' &&
              run.items.some((item) => item.status === 'created' && !item.undo) && (
                <button onClick={() => void act(run, true)}>
                  Undo this operation’s unchanged blocks…
                </button>
              )}
            {run.action === 'mute' && (
              <p>
                Mutes are recorded, but cannot be undone automatically: Bluesky does not expose an
                identity that distinguishes a later re-mute.
              </p>
            )}
            <details
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setExpanded((previous) => ({
                  ...previous,
                  [run.id]: open ? previous[run.id] || 100 : 0,
                }));
              }}
            >
              <summary>Account outcomes and receipts</summary>
              <p>
                Operation: {run.id}. Uncertain requests are never automatically retried. Stop leaves
                remaining accounts untouched.
              </p>
              <ul>
                {run.items.slice(0, expanded[run.id] || 0).map((item) => (
                  <li key={item.did}>
                    @{item.handle} ({item.did}): {item.status}
                    {item.detail ? ` — ${item.detail}` : ''}
                    {item.undo
                      ? ` · Undo: ${item.undo.status}${item.undo.detail ? ` — ${item.undo.detail}` : ''}`
                      : ''}
                    {item.receipt && (
                      <small>
                        {' '}
                        · Receipt: {item.receipt.rkey || 'mute tracking'} ·{' '}
                        {new Date(item.receipt.createdAt).toISOString()}
                        {item.receipt.expiresAt
                          ? ` · expires ${new Date(item.receipt.expiresAt).toISOString()}`
                          : ''}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
              {!!expanded[run.id] && expanded[run.id] < run.items.length && (
                <button
                  onClick={() =>
                    setExpanded((previous) => ({ ...previous, [run.id]: previous[run.id] + 100 }))
                  }
                >
                  Show next 100 account outcomes
                </button>
              )}
            </details>
          </article>
        );
      })}
    </section>
  );
}
