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
  List,
  UserMinus,
} from 'lucide-preact';
import type {
  ManagedEntry,
  AmnestyReview,
  ListMember,
  ListAuditReview,
  Interaction,
} from '../../types.js';
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
  amnestyMode,
  setAmnestyMode,
  ownedLists,
  selectedListUri,
  selectList,
  listMembers,
  listAuditCandidate,
  listAuditReviewedDids,
  setInteractions,
} from '../../signals/manager.js';
import {
  FORGIVENESS_OPTIONS,
  getAmnestyCandidates,
  selectRandomCandidate,
  postUriToUrl,
  getListAuditCandidates,
  selectRandomListMember,
  formatTimeAgo,
} from './utils.js';
import {
  setOptions,
  getPostContexts,
  addAmnestyReview,
  getAmnestyStats,
  addListAuditReview,
  getListAuditReviewedDids,
  getListAuditStats,
} from '../../storage.js';
import browser from '../../browser.js';
import { InteractionsList } from './InteractionsList.js';

interface RelationshipUser {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

interface FollowRelationshipsResponse {
  success: boolean;
  followsWhoFollowThem?: RelationshipUser[];
  followersWhoFollowThem?: RelationshipUser[];
  followsTheyBlock?: RelationshipUser[];
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

  // Mode toggle component
  const ModeToggle = () => (
    <div class="amnesty-mode-toggle">
      <button
        class={`amnesty-mode-btn ${amnestyMode.value === 'blocks_mutes' ? 'active' : ''}`}
        onClick={() => setAmnestyMode('blocks_mutes')}
      >
        <Shield size={16} /> Blocks/Mutes
      </button>
      <button
        class={`amnesty-mode-btn ${amnestyMode.value === 'list_members' ? 'active' : ''}`}
        onClick={() => setAmnestyMode('list_members')}
      >
        <List size={16} /> List Members
      </button>
    </div>
  );

  // Show list audit mode
  if (amnestyMode.value === 'list_members') {
    return (
      <ListAuditMode
        onReload={onReload}
        onFetchInteractions={onFetchInteractions}
        onTempUnblockAndView={onTempUnblockAndView}
        ModeToggle={ModeToggle}
      />
    );
  }

  // Show candidate card if active (blocks/mutes mode)
  if (amnestyCandidate.value) {
    return (
      <AmnestyCard
        candidate={amnestyCandidate.value}
        stats={stats}
        candidates={candidates}
        processing={processing}
        onDecision={handleDecision}
        onViewPost={onTempUnblockAndView}
        ModeToggle={ModeToggle}
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
      <ModeToggle />

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
  ModeToggle: () => JSX.Element;
}

function AmnestyCard({
  candidate,
  stats,
  candidates,
  processing,
  onDecision,
  onViewPost,
  onFetchInteractions,
  ModeToggle,
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

  // Follow relationship state
  const [followRelations, setFollowRelations] = useState<{
    followsWhoFollowThem: RelationshipUser[];
    followersWhoFollowThem: RelationshipUser[];
    followsTheyBlock: RelationshipUser[];
    loading: boolean;
  }>({ followsWhoFollowThem: [], followersWhoFollowThem: [], followsTheyBlock: [], loading: true });
  const [followsFollowExpanded, setFollowsFollowExpanded] = useState(false);
  const [followersFollowExpanded, setFollowersFollowExpanded] = useState(false);
  const [followsBlockedExpanded, setFollowsBlockedExpanded] = useState(false);

  // Profile stats state
  const [profileStats, setProfileStats] = useState<{
    followersCount: number;
    followsCount: number;
    postsCount: number;
    loading: boolean;
  }>({ followersCount: 0, followsCount: 0, postsCount: 0, loading: true });

  // Fetch follow relationships for this candidate
  useEffect(() => {
    let cancelled = false;
    const fetchRelations = async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'GET_FOLLOW_RELATIONSHIPS',
          did: candidate.did,
        })) as FollowRelationshipsResponse;

        if (!cancelled && response.success) {
          setFollowRelations({
            followsWhoFollowThem: response.followsWhoFollowThem || [],
            followersWhoFollowThem: response.followersWhoFollowThem || [],
            followsTheyBlock: response.followsTheyBlock || [],
            loading: false,
          });
        } else if (!cancelled) {
          setFollowRelations((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) {
          setFollowRelations((prev) => ({ ...prev, loading: false }));
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
      <ModeToggle />

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

        {/* Follow Relationships Section */}
        <div class="amnesty-block-relations">
          {followRelations.loading ? (
            <div class="amnesty-searching">
              <Loader2 size={16} class="spinner" />
              Checking social connections...
            </div>
          ) : (
            <>
              <div class="amnesty-block-rel-section">
                <button
                  type="button"
                  class="amnesty-block-rel-header amnesty-follows-follow"
                  onClick={() =>
                    followRelations.followsWhoFollowThem.length > 0 &&
                    setFollowsFollowExpanded(!followsFollowExpanded)
                  }
                  disabled={followRelations.followsWhoFollowThem.length === 0}
                >
                  <Users size={14} />
                  <span>
                    <strong>{followRelations.followsWhoFollowThem.length}</strong>{' '}
                    {followRelations.followsWhoFollowThem.length === 1 ? 'person' : 'people'} you
                    follow{' '}
                    {followRelations.followsWhoFollowThem.length === 1 ? 'follows' : 'follow'} them
                  </span>
                  {followRelations.followsWhoFollowThem.length > 0 &&
                    (followsFollowExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    ))}
                </button>
                {followsFollowExpanded && followRelations.followsWhoFollowThem.length > 0 && (
                  <div class="amnesty-block-rel-list">
                    {followRelations.followsWhoFollowThem.map((u) => (
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
              <div class="amnesty-block-rel-section">
                <button
                  type="button"
                  class="amnesty-block-rel-header amnesty-followers-follow"
                  onClick={() =>
                    followRelations.followersWhoFollowThem.length > 0 &&
                    setFollowersFollowExpanded(!followersFollowExpanded)
                  }
                  disabled={followRelations.followersWhoFollowThem.length === 0}
                >
                  <Users size={14} />
                  <span>
                    <strong>{followRelations.followersWhoFollowThem.length}</strong> of your
                    followers{' '}
                    {followRelations.followersWhoFollowThem.length === 1 ? 'follows' : 'follow'}{' '}
                    them
                  </span>
                  {followRelations.followersWhoFollowThem.length > 0 &&
                    (followersFollowExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    ))}
                </button>
                {followersFollowExpanded && followRelations.followersWhoFollowThem.length > 0 && (
                  <div class="amnesty-block-rel-list">
                    {followRelations.followersWhoFollowThem.map((u) => (
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
              <div class="amnesty-block-rel-section">
                <button
                  type="button"
                  class="amnesty-block-rel-header amnesty-blocking"
                  onClick={() =>
                    followRelations.followsTheyBlock.length > 0 &&
                    setFollowsBlockedExpanded(!followsBlockedExpanded)
                  }
                  disabled={followRelations.followsTheyBlock.length === 0}
                >
                  <Shield size={14} />
                  <span>
                    They block <strong>{followRelations.followsTheyBlock.length}</strong>{' '}
                    {followRelations.followsTheyBlock.length === 1 ? 'person' : 'people'} you follow
                  </span>
                  {followRelations.followsTheyBlock.length > 0 &&
                    (followsBlockedExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    ))}
                </button>
                {followsBlockedExpanded && followRelations.followsTheyBlock.length > 0 && (
                  <div class="amnesty-block-rel-list">
                    {followRelations.followsTheyBlock.map((u) => (
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
            </>
          )}
        </div>

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

// ============================================================================
// List Audit Mode Component
// ============================================================================

interface ListAuditModeProps {
  onReload: () => Promise<void>;
  onFetchInteractions: (did: string, handle: string) => Promise<void>;
  onTempUnblockAndView: (did: string, handle: string, url: string) => Promise<void>;
  ModeToggle: () => JSX.Element;
}

function ListAuditMode({
  onReload: _onReload,
  onFetchInteractions,
  onTempUnblockAndView,
  ModeToggle,
}: ListAuditModeProps): JSX.Element {
  const [processing, setProcessing] = useState(false);
  const [stats, setStats] = useState({ reviewed: 0, removed: 0, kept: 0 });
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Fetch owned lists on mount
  useEffect(() => {
    const fetchLists = async () => {
      if (ownedLists.value.length > 0) return; // Already loaded
      setLoadingLists(true);
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'FETCH_OWNED_LISTS',
        })) as { success: boolean; lists?: typeof ownedLists.value; error?: string };

        if (response.success && response.lists) {
          ownedLists.value = response.lists;
        }
      } catch (error) {
        console.error('[ListAuditMode] Failed to fetch owned lists:', error);
      } finally {
        setLoadingLists(false);
      }
    };
    fetchLists();
  }, []);

  // Fetch stats when list is selected
  useEffect(() => {
    if (selectedListUri.value) {
      getListAuditStats(selectedListUri.value).then(setStats);
      getListAuditReviewedDids(selectedListUri.value).then((dids) => {
        listAuditReviewedDids.value = dids;
      });
    }
  }, [selectedListUri.value]);

  const handleListChange = async (e: Event) => {
    const uri = (e.target as HTMLSelectElement).value;
    selectList(uri || null);

    if (uri) {
      setLoadingMembers(true);
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'FETCH_LIST_MEMBERS_WITH_TIMESTAMPS',
          listUri: uri,
        })) as { success: boolean; members?: ListMember[]; error?: string };

        if (response.success && response.members) {
          listMembers.value = response.members;
        }
      } catch (error) {
        console.error('[ListAuditMode] Failed to fetch list members:', error);
      } finally {
        setLoadingMembers(false);
      }
    }
  };

  const startReview = () => {
    const candidates = getListAuditCandidates(listMembers.value, listAuditReviewedDids.value);
    const candidate = selectRandomListMember(candidates);
    if (candidate) {
      listAuditCandidate.value = candidate;
    }
  };

  const handleDecision = async (decision: 'removed' | 'kept') => {
    const candidate = listAuditCandidate.value;
    if (!candidate) return;

    setProcessing(true);
    try {
      // If removing, call the API
      if (decision === 'removed') {
        const response = (await browser.runtime.sendMessage({
          type: 'REMOVE_FROM_LIST',
          rkey: candidate.listitemRkey,
        })) as { success: boolean; error?: string };

        if (!response.success) {
          throw new Error(response.error || 'Failed to remove from list');
        }

        // Remove from local list
        listMembers.value = listMembers.value.filter((m) => m.did !== candidate.did);
      }

      // Record the review
      const review: ListAuditReview = {
        did: candidate.did,
        handle: candidate.handle,
        listUri: candidate.listUri,
        listName: candidate.listName,
        reviewedAt: Date.now(),
        decision,
      };
      await addListAuditReview(review);

      // Update reviewed DIDs
      const newReviewedDids = new Set(listAuditReviewedDids.value);
      newReviewedDids.add(candidate.did);
      listAuditReviewedDids.value = newReviewedDids;

      // Update stats
      const newStats = await getListAuditStats(candidate.listUri);
      setStats(newStats);

      // Clear candidate and start next review
      listAuditCandidate.value = null;
      startReview();
    } catch (error) {
      console.error('[ListAuditMode] Decision failed:', error);
      alert('Failed to process decision');
    } finally {
      setProcessing(false);
    }
  };

  // Show list member audit card if reviewing
  if (listAuditCandidate.value) {
    const candidates = getListAuditCandidates(listMembers.value, listAuditReviewedDids.value);
    return (
      <ListAuditCard
        member={listAuditCandidate.value}
        stats={stats}
        candidatesRemaining={candidates.length}
        processing={processing}
        onDecision={handleDecision}
        onFetchInteractions={onFetchInteractions}
        onViewPost={onTempUnblockAndView}
        ModeToggle={ModeToggle}
      />
    );
  }

  // Show list selection / intro screen
  const candidates = getListAuditCandidates(listMembers.value, listAuditReviewedDids.value);

  return (
    <div class="amnesty-container">
      <ModeToggle />

      <div class="amnesty-intro">
        <h3>List Audit</h3>
        <p>Review members of your lists to see if they still belong there.</p>
      </div>

      <div class="amnesty-forgiveness">
        <label class="amnesty-forgiveness-label">Select a list to audit</label>
        {loadingLists ? (
          <div class="amnesty-loading">
            <Loader2 size={20} class="spin" /> Loading your lists...
          </div>
        ) : (
          <select
            class="amnesty-forgiveness-select"
            value={selectedListUri.value || ''}
            onChange={handleListChange}
          >
            <option value="">Select a list...</option>
            {ownedLists.value.map((list) => (
              <option key={list.uri} value={list.uri}>
                {list.name} ({list.listItemCount} members)
              </option>
            ))}
          </select>
        )}
        {ownedLists.value.length === 0 && !loadingLists && (
          <p class="amnesty-forgiveness-hint">You don't have any lists to audit.</p>
        )}
      </div>

      {loadingMembers && (
        <div class="amnesty-loading">
          <Loader2 size={20} class="spin" /> Loading list members...
        </div>
      )}

      {selectedListUri.value && !loadingMembers && (
        <>
          <div class="amnesty-stats">
            <div class="amnesty-stat amnesty-stat-primary">
              <div class="amnesty-stat-value">{candidates.length}</div>
              <div class="amnesty-stat-label">Ready for Review</div>
              {listMembers.value.length > 0 && (
                <div class="amnesty-stat-detail">{listMembers.value.length} total members</div>
              )}
            </div>
            <div class="amnesty-stat">
              <div class="amnesty-stat-value">{stats.reviewed}</div>
              <div class="amnesty-stat-label">Reviewed</div>
            </div>
            <div class="amnesty-stat">
              <div class="amnesty-stat-value">{stats.removed}</div>
              <div class="amnesty-stat-label">Removed</div>
            </div>
          </div>

          {candidates.length > 0 ? (
            <button class="amnesty-start-btn" onClick={startReview}>
              <Play size={20} /> Start Review
            </button>
          ) : (
            <div class="amnesty-empty">
              <h3>No members to review</h3>
              <p>
                {listMembers.value.length === 0
                  ? 'This list has no members.'
                  : 'All members have been reviewed.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// List Audit Card Component
// ============================================================================

interface ListAuditCardProps {
  member: ListMember;
  stats: { reviewed: number; removed: number; kept: number };
  candidatesRemaining: number;
  processing: boolean;
  onDecision: (decision: 'removed' | 'kept') => Promise<void>;
  onFetchInteractions: (did: string, handle: string) => Promise<void>;
  onViewPost: (did: string, handle: string, url: string) => Promise<void>;
  ModeToggle: () => JSX.Element;
}

function ListAuditCard({
  member,
  stats,
  candidatesRemaining,
  processing,
  onDecision,
  onFetchInteractions: _onFetchInteractions,
  onViewPost: _onViewPost,
  ModeToggle,
}: ListAuditCardProps): JSX.Element {
  const [loadingInteractions, setLoadingInteractions] = useState(false);
  const [interactions, setLocalInteractions] = useState<Interaction[]>([]);
  const [interactionsLoaded, setInteractionsLoaded] = useState(false);
  const isExpanded = expandedRows.value.has(member.did);
  const addedDateStr = new Date(member.addedAt).toLocaleDateString();

  // Fetch interactions before the addedAt timestamp
  useEffect(() => {
    const fetchInteractions = async () => {
      setLoadingInteractions(true);
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'FIND_INTERACTIONS_BEFORE',
          targetDid: member.did,
          beforeTimestamp: member.addedAt,
        })) as { success: boolean; interactions?: Interaction[]; error?: string };

        if (response.success && response.interactions) {
          setLocalInteractions(response.interactions);
          // Also store in global signal for InteractionsList component
          setInteractions(member.did, response.interactions);
        }
      } catch (error) {
        console.error('[ListAuditCard] Failed to fetch interactions:', error);
      } finally {
        setLoadingInteractions(false);
        setInteractionsLoaded(true);
      }
    };
    fetchInteractions();
  }, [member.did, member.addedAt]);

  return (
    <div class="amnesty-container">
      <ModeToggle />

      <div class="amnesty-stats">
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">{candidatesRemaining}</div>
          <div class="amnesty-stat-label">Remaining</div>
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">{stats.reviewed}</div>
          <div class="amnesty-stat-label">Reviewed</div>
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">{stats.removed}</div>
          <div class="amnesty-stat-label">Removed</div>
        </div>
      </div>

      <div class="amnesty-card amnesty-card-list">
        <div class="amnesty-card-header">
          {member.avatar ? (
            <img src={member.avatar} class="amnesty-avatar" alt="" loading="lazy" />
          ) : (
            <div class="amnesty-avatar" />
          )}
          <div class="amnesty-user-info">
            <div class="amnesty-handle">@{member.handle}</div>
            {member.displayName && <div class="amnesty-display-name">{member.displayName}</div>}
            <div class="amnesty-blocked-date">
              <span class="amnesty-type-badge badge-list">
                <List size={12} /> {member.listName}
              </span>
              Added {addedDateStr}
            </div>
          </div>
        </div>

        <div class="amnesty-context-container">
          <div class="amnesty-context-header">
            <button
              class="amnesty-context-toggle"
              onClick={() => toggleExpanded(member.did)}
              disabled={loadingInteractions}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Interactions before adding to list
            </button>
          </div>

          {loadingInteractions && (
            <div class="amnesty-loading">
              <Loader2 size={16} class="spin" /> Finding interactions...
            </div>
          )}

          {interactionsLoaded && !loadingInteractions && (
            <>
              {interactions.length > 0 ? (
                <div class="amnesty-context-summary">
                  Found {interactions.length} interaction{interactions.length !== 1 ? 's' : ''}{' '}
                  before you added them
                </div>
              ) : (
                <div class="amnesty-no-context">
                  No interactions found before you added them to this list
                </div>
              )}
            </>
          )}

          {isExpanded && interactions.length > 0 && (
            <div class="amnesty-interactions-expanded">
              <div class="interactions-list">
                {interactions.slice(0, 10).map((interaction, idx) => (
                  <div key={idx} class="interaction-item">
                    <div class="interaction-header">
                      <span class={`interaction-type ${interaction.type}`}>{interaction.type}</span>
                      <span class="interaction-author">
                        {interaction.author === 'you' ? 'You' : `@${interaction.authorHandle}`}
                      </span>
                      <span class="interaction-date">{formatTimeAgo(interaction.createdAt)}</span>
                    </div>
                    <div class="interaction-text">{interaction.text}</div>
                  </div>
                ))}
                {interactions.length > 10 && (
                  <div class="interaction-more">
                    And {interactions.length - 10} more interactions...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div class="amnesty-card-actions">
          <button
            class="amnesty-btn amnesty-btn-keep"
            onClick={() => {
              onDecision('kept').catch((err) => {
                console.error('[ListAuditCard] Decision error:', err);
              });
            }}
            disabled={processing}
          >
            <ThumbsUp size={18} /> Keep on List
          </button>
          <button
            class="amnesty-btn amnesty-btn-remove"
            onClick={() => {
              onDecision('removed').catch((err) => {
                console.error('[ListAuditCard] Decision error:', err);
              });
            }}
            disabled={processing}
          >
            <UserMinus size={18} /> Remove from List
          </button>
        </div>
      </div>
    </div>
  );
}
