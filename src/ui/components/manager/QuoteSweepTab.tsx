import type { JSX } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import type { PostAudience } from '../../../types.js';
import {
  Search,
  Ban,
  VolumeX,
  CheckSquare,
  Square,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Check,
} from 'lucide-preact';
import { createLogger } from '../../../platform/utils.js';
import { send } from '../../../platform/messages.js';
import {
  quotePostRef,
  quoteAudience,
  quoteSubject,
  quoteQuoters,
  quoteSelected,
  quoteActionType,
  quoteDuration,
  quoteLoading,
  quoteExecuting,
  quoteError,
  quoteViewerStateUnavailable,
  quoteTruncated,
  quoteAutoFetch,
  resetQuoteSweepState,
  toggleQuoteSelection,
  selectAllQuoters,
  clearQuoteSelection,
  type QuotePoster,
} from '../../signals/manager.js';
import { Toast } from '../shared/Toast.js';
import browser from '../../../platform/browser.js';
import { PostBatchOutcomes, usePostBatches } from './PostBatchOutcomes.js';

const log = createLogger('quote-sweep-tab');

interface DurationOpt {
  label: string;
  ms: number; // -1 = permanent
}

const DURATIONS: DurationOpt[] = [
  { label: '1 hour', ms: 1 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'Permanent', ms: -1 },
];

/** Map a duration (ms; -1 = permanent) to its human label for the confirm dialog. */
function durationLabel(ms: number): string {
  return DURATIONS.find((d) => d.ms === ms)?.label ?? `${ms} ms`;
}

/**
 * Turn an at-uri (at://<did>/app.bsky.feed.post/<rkey>) into a bsky.app web URL so the
 * subject shown to the user is clickable, not a raw at-uri. Returns the input unchanged
 * if it doesn't match the expected post at-uri shape.
 */
function subjectToWebUrl(subject: string): string {
  const match = subject.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/);
  if (!match) return subject;
  const [, did, rkey] = match;
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}

interface QuoteSweepTabProps {
  onReload: () => Promise<void>;
}

/**
 * Fetch the quoters of a post and let the human bulk block/mute a selected subset.
 * Selection lives in a DEDICATED signal (quoteSelected), never the shared selectedItems.
 */
export function QuoteSweepTab({ onReload }: QuoteSweepTabProps): JSX.Element {
  const [resultToast, setResultToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const batches = usePostBatches();
  const outcomes = (
    <PostBatchOutcomes
      runs={batches.runs}
      error={batches.error}
      refresh={batches.refresh}
      onError={batches.setError}
    />
  );
  const activeRequest = useRef<string | null>(null);
  const audience = quoteAudience.value;
  const audienceLabel = { quotes: 'Quote authors', reposts: 'Reposters', likes: 'Likers' }[
    audience || 'quotes'
  ];
  const postRef = quotePostRef.value;
  const subject = quoteSubject.value;
  const quoters = quoteQuoters.value;
  const selected = quoteSelected.value;
  const actionType = quoteActionType.value;
  const duration = quoteDuration.value;
  const loading = quoteLoading.value;
  const executing = quoteExecuting.value || batches.busy;
  const error = quoteError.value;
  const viewerStateUnavailable = quoteViewerStateUnavailable.value;
  const truncated = quoteTruncated.value;

  // Selectable = not already in the chosen action's terminal state.
  const isAlreadyDone = (q: QuotePoster): boolean =>
    !!q.followed || (actionType === 'block' ? q.alreadyBlocked : q.alreadyMuted);

  const cancelFetch = () => {
    const requestId = activeRequest.current;
    activeRequest.current = null;
    quoteLoading.value = false;
    if (requestId) {
      send('CANCEL_POST_AUDIENCE_FETCH', { requestId }).catch((err: unknown) =>
        log.warn('Could not cancel background fetch:', err)
      );
    }
  };

  useEffect(() => () => cancelFetch(), []);
  const selectableDids = quoters.filter((q) => !isAlreadyDone(q)).map((q) => q.did);
  const allSelected = selected.size === selectableDids.length && selectableDids.length > 0;

  const handleFetch = async () => {
    const ref = postRef.trim();
    if (!ref || !audience || quoteExecuting.value || quoteLoading.value) return;
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    setResultToast(null);
    quoteLoading.value = true;
    quoteError.value = null;
    quoteSubject.value = null;
    quoteQuoters.value = [];
    quoteViewerStateUnavailable.value = false;
    quoteTruncated.value = false;
    clearQuoteSelection();

    try {
      const result = await send('GET_QUOTE_POSTERS', { postRef: ref, audience, requestId });
      if (activeRequest.current !== requestId) return;
      if (!result.success) {
        quoteError.value = result.error || 'Failed to fetch quote posters';
        return;
      }
      quoteSubject.value = result.subject || null;
      quoteViewerStateUnavailable.value = !!result.viewerStateUnavailable;
      quoteTruncated.value = !!result.truncated;
      const fetched = (result.quoters || []) as QuotePoster[];
      quoteQuoters.value = fetched;
      // When viewer state is unreliable we can't tell who's already blocked — do NOT
      // default-select-all (it would mass-reblock). The user reviews and selects manually.
      if (result.viewerStateUnavailable) {
        clearQuoteSelection();
      } else {
        // Default-select everyone NOT already in the chosen action's terminal state.
        selectAllQuoters(
          fetched
            .filter(
              (q) =>
                !q.followed &&
                (quoteActionType.value === 'block' ? !q.alreadyBlocked : !q.alreadyMuted)
            )
            .map((q) => q.did)
        );
      }
    } catch (err) {
      if (activeRequest.current === requestId)
        quoteError.value = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      if (activeRequest.current === requestId) {
        activeRequest.current = null;
        quoteLoading.value = false;
      }
    }
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) handleFetch();
  };

  // Legacy deep links still prefill the post, but every audience now requires a human choice.
  useEffect(() => {
    quoteAutoFetch.value = false;
  }, []);

  const handleSelectAll = () => {
    if (allSelected) {
      clearQuoteSelection();
    } else if (!viewerStateUnavailable) {
      selectAllQuoters(selectableDids);
    }
  };

  const handleActionTypeChange = (next: 'block' | 'mute') => {
    if (next === quoteActionType.value) return;

    const reviewedSelection = quoteSelected.value;
    quoteActionType.value = next;
    if (viewerStateUnavailable) {
      clearQuoteSelection();
      return;
    }
    selectAllQuoters(
      quoters
        .filter(
          (q) =>
            reviewedSelection.has(q.did) &&
            !q.followed &&
            (next === 'block' ? !q.alreadyBlocked : !q.alreadyMuted)
        )
        .map((q) => q.did)
    );
  };

  const handleExecute = async () => {
    const dids = selectableDids.filter((did) => quoteSelected.value.has(did));
    if (dids.length === 0 || executing || quoteLoading.value || !audience || !subject) return;
    const authData = await browser.storage.local.get('authToken');
    const auth: unknown = authData.authToken;
    const owner =
      auth && typeof auth === 'object' && 'did' in auth && typeof auth.did === 'string'
        ? auth.did
        : null;
    if (!owner) {
      batches.setError('Open Bluesky and connect your account before confirming.');
      return;
    }

    const isMute = actionType === 'mute';
    const isPermanent = duration === -1;
    const verb = isMute ? 'mute' : 'block';

    // Confirm with the full context: how many, which post, for how long, and a loud
    // warning when permanent (a permanent action is not auto-undone on expiry).
    const subjectLine = subject ? `\nPost: ${subjectToWebUrl(subject)}` : '';
    const durationLine = isPermanent
      ? '\nDuration: PERMANENT — cannot be auto-undone'
      : `\nDuration: ${durationLabel(duration)}`;
    const permanentWarning = isPermanent
      ? '\n\n⚠ PERMANENT — these accounts will stay ' +
        (isMute ? 'muted' : 'blocked') +
        ' until you remove them manually.'
      : '';
    const confirmMsg =
      `${verb === 'mute' ? 'Mute' : 'Block'} ${dids.length} account(s) from ${audienceLabel}?` +
      `\nAccount: ${owner}` +
      subjectLine +
      durationLine +
      permanentWarning;
    if (!confirm(confirmMsg)) return;

    const selectedSet = new Set(dids);
    const targets = quoters
      .filter((q) => selectedSet.has(q.did))
      .map(({ did, handle }) => ({ did, handle }));

    quoteExecuting.value = true;
    setResultToast(null);

    try {
      await send('START_POST_BATCH', {
        owner,
        sourcePost: subject,
        audience,
        action: actionType,
        durationMs: duration,
        confirmed: true,
        targets,
      });
      clearQuoteSelection();
      await batches.refresh();
      await onReload();
      setResultToast({
        message: 'Operation saved. Follow progress and account outcomes below.',
        type: 'success',
      });
    } catch (err) {
      log.error('Bulk action failed:', err);
      setResultToast({
        message: err instanceof Error ? err.message : 'Bulk action failed',
        type: 'error',
      });
    } finally {
      quoteExecuting.value = false;
    }
  };

  // ── Initial state — no quoters fetched yet ────────────────────────────────
  if (quoters.length === 0 && !subject) {
    return (
      <div class="copy-user-container">
        {outcomes}
        {resultToast && (
          <Toast
            message={resultToast.message}
            type={resultToast.type}
            // Errors carry the actionable @handle: reason list — keep them up longer to read.
            duration={resultToast.type === 'error' ? 12000 : 3000}
            onClose={() => setResultToast(null)}
          />
        )}
        <div class="copy-user-intro">
          <h3>Post actions</h3>
          <p>
            Choose quote authors, reposters or likers of a Bluesky post. Review the fetched
            accounts, exclude anyone you want to keep, then confirm a block or mute. Your own
            account and accounts you follow are protected when viewer state is available.
          </p>
          <label>
            Audience
            <select
              aria-label="Audience"
              value={audience}
              disabled={loading}
              onChange={(e) => {
                quoteAudience.value = (e.target as HTMLSelectElement).value as PostAudience | '';
                clearQuoteSelection();
              }}
            >
              <option value="">Choose an audience</option>
              <option value="quotes">Quote authors</option>
              <option value="reposts">Reposters</option>
              <option value="likes">Likers</option>
            </select>
          </label>
          <div class="copy-user-input-row">
            <input
              type="text"
              placeholder="https://bsky.app/profile/.../post/... or at://..."
              value={postRef}
              onInput={(e) => (quotePostRef.value = (e.target as HTMLInputElement).value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              class="copy-user-handle-input"
            />
            <button
              class="copy-user-fetch-btn"
              onClick={handleFetch}
              disabled={loading || !postRef.trim() || !audience}
            >
              <Search size={16} class={loading ? 'spinner' : ''} />
              {loading ? 'Fetching...' : 'Fetch accounts'}
            </button>
          </div>

          {loading && (
            <div class="copy-user-progress">
              Fetching {audienceLabel.toLowerCase()}...
              <button onClick={cancelFetch}>Cancel fetch</button>
            </div>
          )}

          {error && (
            <div class="copy-user-error">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Results state ─────────────────────────────────────────────────────────
  return (
    <div class="copy-user-container">
      {outcomes}
      {resultToast && (
        <Toast
          message={resultToast.message}
          type={resultToast.type}
          onClose={() => setResultToast(null)}
        />
      )}

      {/* Subject + new-sweep control */}
      <div class="copy-user-target-card">
        <div class="copy-user-target-info">
          <div class="copy-user-target-name">
            {quoters.length} {audienceLabel.toLowerCase()} fetched
          </div>
          {subject && (
            <a
              class="copy-user-target-handle"
              href={subjectToWebUrl(subject)}
              target="_blank"
              rel="noopener noreferrer"
              referrerpolicy="no-referrer"
            >
              {subjectToWebUrl(subject)}
            </a>
          )}
        </div>
        <button
          class="copy-user-change-btn"
          onClick={() => resetQuoteSweepState()}
          disabled={executing}
        >
          New Sweep
        </button>
      </div>

      {viewerStateUnavailable && (
        <div class="copy-user-warning">
          <AlertTriangle size={16} />
          Couldn't check all account relationships, including your own account, follows, blocks and
          mutes — select accounts individually and review carefully before acting.
        </div>
      )}

      {truncated && (
        <div class="copy-user-warning">
          <AlertTriangle size={16} />
          The fetched {audienceLabel.toLowerCase()} list is incomplete (page limit, repeated cursor
          or interrupted read). Review only the accounts shown below.
        </div>
      )}

      {/* Action controls */}
      <div class="quote-sweep-controls">
        <div class="quote-sweep-action-toggle">
          <button
            class={`quote-sweep-toggle-btn ${actionType === 'block' ? 'active' : ''}`}
            onClick={() => handleActionTypeChange('block')}
            disabled={executing}
          >
            <Ban size={14} /> Block
          </button>
          <button
            class={`quote-sweep-toggle-btn ${actionType === 'mute' ? 'active' : ''}`}
            onClick={() => handleActionTypeChange('mute')}
            disabled={executing}
          >
            <VolumeX size={14} /> Mute
          </button>
        </div>

        <div class="quote-sweep-duration">
          <label class="quote-sweep-duration-label" for="post-action-duration">
            Duration:
          </label>
          <select
            id="post-action-duration"
            class="quote-sweep-duration-select"
            value={String(duration)}
            onChange={(e) => (quoteDuration.value = Number((e.target as HTMLSelectElement).value))}
            disabled={executing}
          >
            {DURATIONS.map((d) => (
              <option key={d.label} value={String(d.ms)}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div class="copy-user-error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {executing && (
        <div class="copy-user-execute-progress">
          <Loader2 size={16} class="spinner" />
          {actionType === 'block' ? 'Blocking' : 'Muting'} {selected.size} account(s)...
        </div>
      )}

      {/* Quoter grid */}
      <div class="copy-user-list">
        <div class="copy-user-list-header">
          <h4>
            {audienceLabel} ({quoters.length} fetched)
          </h4>
          <button
            class="copy-user-select-all-btn"
            onClick={handleSelectAll}
            disabled={selectableDids.length === 0 || executing || viewerStateUnavailable}
          >
            {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        <div class="copy-user-list-items">
          {quoters.map((q) => {
            const alreadyDone = isAlreadyDone(q);
            return (
              <QuoterRow
                key={q.did}
                quoter={q}
                selected={selected.has(q.did)}
                isAlreadyDone={alreadyDone}
                alreadyLabel={
                  q.followed
                    ? 'You follow this account'
                    : actionType === 'block'
                      ? 'Already blocked'
                      : 'Already muted'
                }
                onToggle={() => toggleQuoteSelection(q.did)}
                disabled={executing}
              />
            );
          })}
          {quoters.length === 0 && (
            <div class="copy-user-empty">No {audienceLabel.toLowerCase()} found</div>
          )}
        </div>
        <div class="copy-user-list-actions">
          <button
            class={`copy-user-action-btn ${actionType}`}
            onClick={handleExecute}
            disabled={selected.size === 0 || executing}
          >
            {actionType === 'block' ? <Ban size={16} /> : <VolumeX size={16} />}
            {actionType === 'block' ? 'Block' : 'Mute'} Selected ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}

interface QuoterRowProps {
  quoter: QuotePoster;
  selected: boolean;
  isAlreadyDone: boolean;
  alreadyLabel: string;
  onToggle: () => void;
  disabled: boolean;
}

function QuoterRow({
  quoter,
  selected,
  isAlreadyDone,
  alreadyLabel,
  onToggle,
  disabled,
}: QuoterRowProps): JSX.Element {
  const displayName = quoter.displayName || quoter.handle;
  const displayIdentifier =
    displayName ||
    (quoter.did.length > 40 ? `${quoter.did.slice(0, 20)}...${quoter.did.slice(-15)}` : quoter.did);

  return (
    <div
      class={`copy-user-row ${selected ? 'selected' : ''} ${isAlreadyDone ? 'already-done' : ''}`}
      onClick={() => !isAlreadyDone && !disabled && onToggle()}
    >
      <span class="copy-user-row-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select @${quoter.handle}`}
          checked={selected}
          disabled={disabled || isAlreadyDone}
          onChange={onToggle}
        />
        {isAlreadyDone && <Check size={14} class="already-check" />}
      </span>
      <a
        class="copy-user-row-link"
        href={`https://bsky.app/profile/${quoter.did}`}
        target="_blank"
        rel="noopener noreferrer"
        referrerpolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
      >
        {quoter.avatar ? (
          <img
            src={quoter.avatar}
            alt=""
            class="copy-user-row-avatar"
            loading="lazy"
            referrerpolicy="no-referrer"
          />
        ) : (
          <span class="copy-user-row-avatar-placeholder" />
        )}
        <span class="copy-user-row-identity">
          <span class="copy-user-row-name">{displayIdentifier}</span>
          {displayName && quoter.handle && (
            <span class="copy-user-row-handle">@{quoter.handle}</span>
          )}
        </span>
      </a>
      {isAlreadyDone && <span class="copy-user-already-badge">{alreadyLabel}</span>}
    </div>
  );
}
