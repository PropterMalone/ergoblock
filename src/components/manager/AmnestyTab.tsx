import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  ThumbsUp,
  ThumbsDown,
  Play,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronRight,
  Shield,
  Users,
} from 'lucide-preact';
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
  expandedRows,
  toggleExpanded,
} from '../../signals/manager.js';
import {
  FORGIVENESS_OPTIONS,
  getAmnestyCandidates,
  selectRandomCandidate,
  postUriToUrl,
} from './utils.js';
import { setOptions, getPostContexts, addAmnestyReview, getAmnestyStats } from '../../storage.js';
import browser from '../../browser.js';
import { InteractionsList } from './InteractionsList.js';

interface BlockRelationshipsResponse {
  success: boolean;
  blockedBy?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
  blocking?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
}

interface AmnestyTabProps {
  onUnblock: (did: string) => Promise<void>;
  onUnmute: (did: string) => Promise<void>;
  onTempUnblockAndView: (did: string, handle: string, url: string) => Promise<void>;
  onFetchInteractions: (did: string, handle: string) => Promise<void>;
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
  onFetchInteractions,
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

  const handleDecision = async (
    decision: 'unblocked' | 'unmuted' | 'kept_blocked' | 'kept_muted'
  ) => {
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
        onFetchInteractions={onFetchInteractions}
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
  onFetchInteractions: (did: string, handle: string) => Promise<void>;
}

function AmnestyCard({
  candidate,
  stats,
  candidates,
  processing,
  onDecision,
  onViewPost,
  onFetchInteractions,
}: AmnestyCardProps): JSX.Element {
  const ctx = contextMap.value.get(candidate.did);
  const actionDate = candidate.createdAt || candidate.syncedAt;
  const actionDateStr = actionDate ? new Date(actionDate).toLocaleDateString() : 'Unknown';
  const isBlock = candidate.type === 'block';
  const actionVerb = isBlock ? 'Blocked' : 'Muted';
  const actionVerbLower = isBlock ? 'block' : 'mute';
  const freedCount = stats.unblocked + stats.unmuted;
  const isExpanded = expandedRows.value.has(candidate.did);

  const postUrl = ctx?.postUri ? postUriToUrl(ctx.postUri) : '';

  // Block relationship state
  const [blockRelations, setBlockRelations] = useState<{
    blockedBy: Array<{ handle: string; displayName?: string }>;
    blocking: Array<{ handle: string; displayName?: string }>;
    loading: boolean;
  }>({ blockedBy: [], blocking: [], loading: true });
  const [blockedByExpanded, setBlockedByExpanded] = useState(false);
  const [blockingExpanded, setBlockingExpanded] = useState(false);

  // Profile stats state
  const [profileStats, setProfileStats] = useState<{
    followersCount: number;
    followsCount: number;
    postsCount: number;
    loading: boolean;
  }>({ followersCount: 0, followsCount: 0, postsCount: 0, loading: true });

  // Fetch block relationships for this candidate
  useEffect(() => {
    let cancelled = false;
    const fetchRelations = async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'GET_BLOCK_RELATIONSHIPS',
          did: candidate.did,
        })) as BlockRelationshipsResponse;

        if (!cancelled && response.success) {
          setBlockRelations({
            blockedBy: response.blockedBy || [],
            blocking: response.blocking || [],
            loading: false,
          });
        } else if (!cancelled) {
          setBlockRelations((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) {
          setBlockRelations((prev) => ({ ...prev, loading: false }));
        }
      }
    };
    fetchRelations();
    return () => {
      cancelled = true;
    };
  }, [candidate.did]);

  // Fetch profile stats (using public API since user may be blocked)
  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const response = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(candidate.did)}`
        );
        if (response.ok) {
          const profile = (await response.json()) as {
            followersCount?: number;
            followsCount?: number;
            postsCount?: number;
          };
          if (!cancelled) {
            setProfileStats({
              followersCount: profile.followersCount || 0,
              followsCount: profile.followsCount || 0,
              postsCount: profile.postsCount || 0,
              loading: false,
            });
          }
        } else if (!cancelled) {
          setProfileStats((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) {
          setProfileStats((prev) => ({ ...prev, loading: false }));
        }
      }
    };
    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [candidate.did]);

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
            <img src={candidate.avatar} class="amnesty-avatar" alt="" loading="lazy" />
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

        {/* Profile Stats */}
        {!profileStats.loading && (
          <div class="amnesty-profile-stats">
            <span class="amnesty-profile-stat">
              <strong>{profileStats.followersCount.toLocaleString()}</strong> followers
            </span>
            <span class="amnesty-profile-stat">
              <strong>{profileStats.followsCount.toLocaleString()}</strong> following
            </span>
            <span class="amnesty-profile-stat">
              <strong>{profileStats.postsCount.toLocaleString()}</strong> posts
            </span>
          </div>
        )}

        {/* Block Relationships Section */}
        {!blockRelations.loading &&
          (blockRelations.blockedBy.length > 0 || blockRelations.blocking.length > 0) && (
            <div class="amnesty-block-relations">
              {blockRelations.blockedBy.length > 0 && (
                <div class="amnesty-block-rel-section">
                  <button
                    type="button"
                    class="amnesty-block-rel-header amnesty-blocked-by"
                    onClick={() => setBlockedByExpanded(!blockedByExpanded)}
                  >
                    <Shield size={14} />
                    <span>
                      Blocked by {blockRelations.blockedBy.length}{' '}
                      {blockRelations.blockedBy.length === 1 ? 'person' : 'people'} you follow
                    </span>
                    {blockedByExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {blockedByExpanded && (
                    <div class="amnesty-block-rel-list">
                      {blockRelations.blockedBy.map((u) => (
                        <a
                          key={u.handle}
                          href={`https://bsky.app/profile/${u.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="amnesty-block-rel-user"
                        >
                          @{u.handle}
                          {u.displayName && (
                            <span class="amnesty-block-rel-name"> ({u.displayName})</span>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {blockRelations.blocking.length > 0 && (
                <div class="amnesty-block-rel-section">
                  <button
                    type="button"
                    class="amnesty-block-rel-header amnesty-blocking"
                    onClick={() => setBlockingExpanded(!blockingExpanded)}
                  >
                    <Users size={14} />
                    <span>
                      Blocks {blockRelations.blocking.length}{' '}
                      {blockRelations.blocking.length === 1 ? 'person' : 'people'} you follow
                    </span>
                    {blockingExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {blockingExpanded && (
                    <div class="amnesty-block-rel-list">
                      {blockRelations.blocking.map((u) => (
                        <a
                          key={u.handle}
                          href={`https://bsky.app/profile/${u.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="amnesty-block-rel-user"
                        >
                          @{u.handle}
                          {u.displayName && (
                            <span class="amnesty-block-rel-name"> ({u.displayName})</span>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        <div class="amnesty-card-context">
          <div class="amnesty-context-header">
            <div class="amnesty-context-label">Why did you {actionVerbLower} them?</div>
            <button
              class={`context-btn expand-btn ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleExpanded(candidate.did)}
              title={isExpanded ? 'Collapse' : 'Show all interactions'}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {isExpanded ? 'Less' : 'More'}
            </button>
          </div>
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
          {isExpanded && (
            <div class="amnesty-interactions-expanded">
              <InteractionsList
                did={candidate.did}
                handle={candidate.handle}
                isBlocked={isBlock}
                onFetchInteractions={onFetchInteractions}
                onViewPost={onViewPost}
              />
            </div>
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
