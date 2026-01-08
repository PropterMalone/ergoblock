import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { ThumbsUp, ThumbsDown, Play, ExternalLink, Loader2 } from 'lucide-preact';
import type { ManagedEntry, AmnestyReview } from '../../types.js';
import {
  blocks,
  mutes,
  options,
  amnestyReviewedDids,
  amnestyCandidate,
  amnestySearching,
  amnestySearchedNoContext,
  contextMap,
  contexts,
} from '../../signals/manager.js';
import {
  FORGIVENESS_OPTIONS,
  getAmnestyCandidates,
  selectRandomCandidate,
  postUriToUrl,
} from './utils.js';
import { setOptions, getPostContexts, addAmnestyReview, getAmnestyStats } from '../../storage.js';
import browser from '../../browser.js';

interface AmnestyTabProps {
  onUnblock: (did: string) => Promise<void>;
  onUnmute: (did: string) => Promise<void>;
  onTempUnblockAndView: (did: string, handle: string, url: string) => Promise<void>;
  onReload: () => Promise<void>;
}

interface AmnestyStats {
  totalReviewed: number;
  unblocked: number;
  keptBlocked: number;
  unmuted: number;
  keptMuted: number;
}

export function AmnestyTab({
  onUnblock,
  onUnmute,
  onTempUnblockAndView,
  onReload,
}: AmnestyTabProps): JSX.Element {
  const [stats, setStats] = useState<AmnestyStats>({
    totalReviewed: 0,
    unblocked: 0,
    keptBlocked: 0,
    unmuted: 0,
    keptMuted: 0,
  });
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    getAmnestyStats().then(setStats);
  }, []);

  const currentPeriod = options.value?.forgivenessPeriodDays || 90;
  const currentPeriodLabel =
    FORGIVENESS_OPTIONS.find((o) => o.value === currentPeriod)?.label || `${currentPeriod} days`;
  const candidates = getAmnestyCandidates(
    blocks.value,
    mutes.value,
    currentPeriod,
    amnestyReviewedDids.value
  );

  const handlePeriodChange = async (e: Event) => {
    const newPeriod = parseInt((e.target as HTMLSelectElement).value, 10);
    if (options.value) {
      const updated = { ...options.value, forgivenessPeriodDays: newPeriod };
      await setOptions(updated);
      options.value = updated;
    }
  };

  const startReview = async () => {
    // Recompute candidates with latest reviewed DIDs
    const currentCandidates = getAmnestyCandidates(
      blocks.value,
      mutes.value,
      options.value?.forgivenessPeriodDays || 90,
      amnestyReviewedDids.value
    );
    const candidate = selectRandomCandidate(currentCandidates);
    if (!candidate) return;

    amnestyCandidate.value = candidate;

    // Search for context if we don't have it and haven't already searched
    const ctx = contextMap.value.get(candidate.did);
    const alreadySearchedNoResult = amnestySearchedNoContext.value.has(candidate.did);

    if (!ctx && !alreadySearchedNoResult) {
      amnestySearching.value = true;

      try {
        const response = (await browser.runtime.sendMessage({
          type: 'FIND_CONTEXT',
          did: candidate.did,
          handle: candidate.handle,
        })) as { success: boolean; found?: boolean };

        if (response.found) {
          const newContexts = await getPostContexts();
          contexts.value = newContexts;
        } else {
          // Remember that we searched and found nothing
          const newSet = new Set(amnestySearchedNoContext.value);
          newSet.add(candidate.did);
          amnestySearchedNoContext.value = newSet;
        }
      } catch (error) {
        console.error('[AmnestyTab] Failed to find context:', error);
      } finally {
        amnestySearching.value = false;
      }
    }
  };

  const handleDecision = async (decision: 'unblocked' | 'unmuted' | 'kept_blocked' | 'kept_muted') => {
    const candidate = amnestyCandidate.value;
    if (!candidate) return;

    setProcessing(true);

    try {
      const isBlock = candidate.type === 'block';
      const review: AmnestyReview = {
        did: candidate.did,
        handle: candidate.handle,
        reviewedAt: Date.now(),
        type: isBlock ? 'block' : 'mute',
        decision,
      };

      await addAmnestyReview(review);

      // Update reviewed DIDs set
      const newReviewedDids = new Set(amnestyReviewedDids.value);
      newReviewedDids.add(candidate.did);
      amnestyReviewedDids.value = newReviewedDids;

      if (decision === 'unblocked') {
        await onUnblock(candidate.did);
      } else if (decision === 'unmuted') {
        await onUnmute(candidate.did);
      }

      amnestyCandidate.value = null;
      await onReload();

      const newStats = await getAmnestyStats();
      setStats(newStats);

      // Start next review
      startReview();
    } catch (error) {
      console.error('[AmnestyTab] Decision failed:', error);
      alert('Failed to process decision');
    } finally {
      setProcessing(false);
    }
  };

  // Show candidate card if active
  if (amnestyCandidate.value) {
    return (
      <AmnestyCard
        candidate={amnestyCandidate.value}
        stats={stats}
        candidates={candidates}
        processing={processing}
        onDecision={handleDecision}
        onViewPost={onTempUnblockAndView}
      />
    );
  }

  // Show intro screen
  const blockCount = candidates.filter((c) => c.type === 'block').length;
  const muteCount = candidates.filter((c) => c.type === 'mute').length;
  const freedCount = stats.unblocked + stats.unmuted;

  return (
    <div class="amnesty-container">
      <div class="amnesty-intro">
        <h3>Amnesty</h3>
        <p>Review old blocks and mutes to decide if they still deserve it.</p>
      </div>

      <div class="amnesty-forgiveness">
        <label class="amnesty-forgiveness-label">How long does it take you to forgive?</label>
        <select
          class="amnesty-forgiveness-select"
          value={currentPeriod}
          onChange={handlePeriodChange}
        >
          {FORGIVENESS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p class="amnesty-forgiveness-hint">
          Only actions older than this will appear. Blocks from users blocking you back are
          excluded.
        </p>
      </div>

      <div class="amnesty-stats">
        <div class="amnesty-stat amnesty-stat-primary">
          <div class="amnesty-stat-value">{candidates.length}</div>
          <div class="amnesty-stat-label">Ready for Review</div>
          {candidates.length > 0 && (
            <div class="amnesty-stat-detail">
              {blockCount} blocks, {muteCount} mutes
            </div>
          )}
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">{stats.totalReviewed}</div>
          <div class="amnesty-stat-label">Reviewed</div>
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">{freedCount}</div>
          <div class="amnesty-stat-label">Freed</div>
        </div>
      </div>

      {candidates.length > 0 ? (
        <button class="amnesty-start-btn" onClick={startReview}>
          <Play size={20} /> Start Review
        </button>
      ) : (
        <div class="amnesty-empty">
          <h3>No candidates available</h3>
          <p>
            All eligible entries have been reviewed, or you don't have any blocks/mutes older than{' '}
            {currentPeriodLabel}.
          </p>
        </div>
      )}
    </div>
  );
}

interface AmnestyCardProps {
  candidate: ManagedEntry;
  stats: AmnestyStats;
  candidates: ManagedEntry[];
  processing: boolean;
  onDecision: (decision: 'unblocked' | 'unmuted' | 'kept_blocked' | 'kept_muted') => Promise<void>;
  onViewPost: (did: string, handle: string, url: string) => Promise<void>;
}

function AmnestyCard({
  candidate,
  stats,
  candidates,
  processing,
  onDecision,
  onViewPost,
}: AmnestyCardProps): JSX.Element {
  const ctx = contextMap.value.get(candidate.did);
  const actionDate = candidate.createdAt || candidate.syncedAt;
  const actionDateStr = actionDate ? new Date(actionDate).toLocaleDateString() : 'Unknown';
  const isBlock = candidate.type === 'block';
  const actionVerb = isBlock ? 'Blocked' : 'Muted';
  const actionVerbLower = isBlock ? 'block' : 'mute';
  const freedCount = stats.unblocked + stats.unmuted;

  const postUrl = ctx?.postUri ? postUriToUrl(ctx.postUri) : '';

  return (
    <div class="amnesty-container">
      <div class="amnesty-stats">
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">{candidates.length}</div>
          <div class="amnesty-stat-label">Remaining</div>
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">{stats.totalReviewed}</div>
          <div class="amnesty-stat-label">Reviewed</div>
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">{freedCount}</div>
          <div class="amnesty-stat-label">Freed</div>
        </div>
      </div>

      <div class={`amnesty-card ${isBlock ? 'amnesty-card-block' : 'amnesty-card-mute'}`}>
        <div class="amnesty-card-header">
          {candidate.avatar ? (
            <img src={candidate.avatar} class="amnesty-avatar" alt="" />
          ) : (
            <div class="amnesty-avatar" />
          )}
          <div class="amnesty-user-info">
            <div class="amnesty-handle">@{candidate.handle}</div>
            {candidate.displayName && (
              <div class="amnesty-display-name">{candidate.displayName}</div>
            )}
            <div class="amnesty-blocked-date">
              <span class={`amnesty-type-badge ${isBlock ? 'badge-block' : 'badge-mute'}`}>
                {actionVerb}
              </span>
              on {actionDateStr}
            </div>
          </div>
        </div>

        <div class="amnesty-card-context">
          <div class="amnesty-context-label">Why did you {actionVerbLower} them?</div>
          {amnestySearching.value ? (
            <div class="amnesty-searching">
              <Loader2 size={16} class="spinner" />
              Searching for interaction...
            </div>
          ) : ctx ? (
            <>
              <div class="amnesty-context-text">{ctx.postText || 'No post text available'}</div>
              {postUrl && (
                <div class="amnesty-context-link">
                  {isBlock ? (
                    <button
                      class="context-btn amnesty-view-btn"
                      onClick={() => onViewPost(candidate.did, candidate.handle, postUrl)}
                    >
                      <ExternalLink size={12} /> View Post
                    </button>
                  ) : (
                    <a href={postUrl} target="_blank" rel="noopener" class="context-btn">
                      <ExternalLink size={12} /> View Post
                    </a>
                  )}
                </div>
              )}
            </>
          ) : (
            <div class="amnesty-no-context">No context found for this {actionVerbLower}</div>
          )}
        </div>

        <div class="amnesty-card-actions">
          <button
            class={`amnesty-btn ${isBlock ? 'amnesty-btn-unblock' : 'amnesty-btn-unmute'}`}
            onClick={() => {
              onDecision(isBlock ? 'unblocked' : 'unmuted').catch((err) => {
                console.error('[AmnestyCard] Decision error:', err);
              });
            }}
            disabled={processing}
          >
            <ThumbsUp size={18} /> {isBlock ? 'Unblock' : 'Unmute'}
          </button>
          <button
            class="amnesty-btn amnesty-btn-keep"
            onClick={() => {
              onDecision(isBlock ? 'kept_blocked' : 'kept_muted').catch((err) => {
                console.error('[AmnestyCard] Decision error:', err);
              });
            }}
            disabled={processing}
          >
            <ThumbsDown size={18} /> Keep {actionVerb}
          </button>
        </div>
      </div>
    </div>
  );
}
