import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  Search,
  UserPlus,
  Ban,
  CheckSquare,
  Square,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-preact';
import type { ProfileWithViewer } from '../../types.js';
import {
  copyUserTargetHandle,
  copyUserTargetDid,
  copyUserTargetProfile,
  copyUserLoading,
  copyUserProgress,
  copyUserError,
  copyUserFollows,
  copyUserBlocks,
  copyUserSelectedFollows,
  copyUserSelectedBlocks,
  copyUserProfiles,
  copyUserProfilesError,
  copyUserProfilesLoaded,
  copyUserExecuting,
  copyUserExecuteProgress,
  resetCopyUserState,
  toggleCopyUserFollow,
  toggleCopyUserBlock,
  selectAllCopyUserFollows,
  deselectAllCopyUserFollows,
  selectAllCopyUserBlocks,
  deselectAllCopyUserBlocks,
} from '../../signals/manager.js';
import browser from '../../browser.js';

/**
 * Fetch profiles via background worker (has access to auth)
 */
async function fetchProfilesViaBackground(
  dids: string[]
): Promise<Map<string, ProfileWithViewer>> {
  const response = (await browser.runtime.sendMessage({
    type: 'GET_PROFILES_BATCHED',
    dids,
  })) as { success: boolean; profiles?: Record<string, ProfileWithViewer>; error?: string };

  if (!response.success) {
    throw new Error(response.error || 'Failed to fetch profiles');
  }

  // Convert object back to Map
  const map = new Map<string, ProfileWithViewer>();
  if (response.profiles) {
    for (const [did, profile] of Object.entries(response.profiles)) {
      map.set(did, profile);
    }
  }
  return map;
}

interface CopyUserTabProps {
  onReload: () => Promise<void>;
}

export function CopyUserTab({ onReload }: CopyUserTabProps): JSX.Element {
  const [handleInput, setHandleInput] = useState('');
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [showFollowConfirm, setShowFollowConfirm] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  const loading = copyUserLoading.value;
  const progress = copyUserProgress.value;
  const error = copyUserError.value;
  const targetDid = copyUserTargetDid.value;
  const targetProfile = copyUserTargetProfile.value;
  const follows = copyUserFollows.value;
  const blocks = copyUserBlocks.value;
  const profiles = copyUserProfiles.value;
  const profilesError = copyUserProfilesError.value;
  const selectedFollows = copyUserSelectedFollows.value;
  const selectedBlocks = copyUserSelectedBlocks.value;
  const executing = copyUserExecuting.value;
  const executeProgress = copyUserExecuteProgress.value;

  // Load profiles when follows/blocks change
  useEffect(() => {
    if (follows.length === 0 && blocks.length === 0) {
      copyUserProfilesLoaded.value = false;
      return;
    }

    const loadProfiles = async () => {
      // Check if user is logged in before attempting to fetch
      try {
        const authResponse = (await browser.runtime.sendMessage({ type: 'GET_AUTH_STATUS' })) as {
          success: boolean;
          isAuthenticated?: boolean;
        };
        if (!authResponse.success || !authResponse.isAuthenticated) {
          copyUserProfilesError.value = 'Sign in to Bluesky to view profile details';
          copyUserProfilesLoaded.value = true;
          return;
        }
      } catch {
        copyUserProfilesError.value = 'Sign in to Bluesky to view profile details';
        copyUserProfilesLoaded.value = true;
        return;
      }

      setLoadingProfiles(true);
      copyUserProfilesError.value = null;

      try {
        // Combine and dedupe DIDs
        const allDids = [...new Set([...follows, ...blocks])];
        const profileMap = await fetchProfilesViaBackground(allDids);
        copyUserProfiles.value = profileMap;
        copyUserProfilesLoaded.value = true;
      } catch (err) {
        console.error('[CopyUserTab] Failed to load profiles:', err);
        copyUserProfilesError.value = 'Failed to load profile info. Click to retry.';
        copyUserProfilesLoaded.value = true;
      } finally {
        setLoadingProfiles(false);
      }
    };

    loadProfiles();
  }, [follows, blocks]);

  const handleFetch = async () => {
    const handle = handleInput.trim().replace(/^@/, '');
    if (!handle) return;

    // Reset previous state
    resetCopyUserState();
    copyUserTargetHandle.value = handle;
    copyUserLoading.value = true;
    copyUserProgress.value = 'Resolving user...';

    try {
      const result = (await browser.runtime.sendMessage({
        type: 'FETCH_COPY_USER_DATA',
        handle,
      })) as {
        success: boolean;
        error?: string;
        did?: string;
        profile?: ProfileWithViewer;
        follows?: string[];
        blocks?: string[];
      };

      if (!result.success) {
        copyUserError.value = result.error || 'Failed to fetch user data';
        return;
      }

      copyUserTargetDid.value = result.did || null;
      copyUserTargetProfile.value = result.profile || null;
      copyUserFollows.value = result.follows || [];
      copyUserBlocks.value = result.blocks || [];
      copyUserProgress.value = '';
    } catch (err) {
      copyUserError.value = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      copyUserLoading.value = false;
    }
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleFetch();
    }
  };

  const handleRetryProfiles = async () => {
    try {
      const authResponse = (await browser.runtime.sendMessage({ type: 'GET_AUTH_STATUS' })) as {
        success: boolean;
        isAuthenticated?: boolean;
      };
      if (!authResponse.success || !authResponse.isAuthenticated) return;
    } catch {
      return;
    }

    setLoadingProfiles(true);
    copyUserProfilesError.value = null;

    try {
      const allDids = [...new Set([...follows, ...blocks])];
      const profileMap = await fetchProfilesViaBackground(allDids);
      copyUserProfiles.value = profileMap;
      copyUserProfilesLoaded.value = true;
    } catch (err) {
      console.error('[CopyUserTab] Failed to load profiles:', err);
      copyUserProfilesError.value = 'Failed to load profile info. Click to retry.';
    } finally {
      setLoadingProfiles(false);
    }
  };

  // Get selectables (not already following/blocking)
  const getSelectableFollows = (): string[] => {
    return follows.filter((did) => {
      const profile = profiles.get(did);
      return !profile?.viewer?.following;
    });
  };

  const getSelectableBlocks = (): string[] => {
    return blocks.filter((did) => {
      const profile = profiles.get(did);
      return !profile?.viewer?.blocking;
    });
  };

  const handleSelectAllFollows = () => {
    const selectables = getSelectableFollows();
    if (selectedFollows.size === selectables.length) {
      deselectAllCopyUserFollows();
    } else {
      selectAllCopyUserFollows(selectables);
    }
  };

  const handleSelectAllBlocks = () => {
    const selectables = getSelectableBlocks();
    if (selectedBlocks.size === selectables.length) {
      deselectAllCopyUserBlocks();
    } else {
      selectAllCopyUserBlocks(selectables);
    }
  };

  const executeFollows = async () => {
    setShowFollowConfirm(false);
    if (selectedFollows.size === 0) return;

    copyUserExecuting.value = true;
    copyUserExecuteProgress.value = { done: 0, total: selectedFollows.size, type: 'follows' };

    try {
      const dids = Array.from(selectedFollows);
      const result = (await browser.runtime.sendMessage({
        type: 'EXECUTE_COPY_USER_FOLLOWS',
        dids,
      })) as { success: boolean; succeeded?: number; failed?: number; errors?: string[] };

      if (result.succeeded) {
        copyUserExecuteProgress.value = {
          done: result.succeeded,
          total: dids.length,
          type: 'follows',
        };
      }

      // Clear selections and reload profiles to update viewer state
      deselectAllCopyUserFollows();
      const allDids = [...new Set([...follows, ...blocks])];
      const profileMap = await fetchProfilesViaBackground(allDids);
      copyUserProfiles.value = profileMap;

      await onReload();
    } catch (err) {
      console.error('[CopyUserTab] Failed to execute follows:', err);
    } finally {
      copyUserExecuting.value = false;
    }
  };

  const executeBlocks = async () => {
    setShowBlockConfirm(false);
    if (selectedBlocks.size === 0) return;

    copyUserExecuting.value = true;
    copyUserExecuteProgress.value = { done: 0, total: selectedBlocks.size, type: 'blocks' };

    try {
      const dids = Array.from(selectedBlocks);
      const result = (await browser.runtime.sendMessage({
        type: 'EXECUTE_COPY_USER_BLOCKS',
        dids,
      })) as { success: boolean; succeeded?: number; failed?: number; errors?: string[] };

      if (result.succeeded) {
        copyUserExecuteProgress.value = {
          done: result.succeeded,
          total: dids.length,
          type: 'blocks',
        };
      }

      // Clear selections and reload profiles to update viewer state
      deselectAllCopyUserBlocks();
      const allDids = [...new Set([...follows, ...blocks])];
      const profileMap = await fetchProfilesViaBackground(allDids);
      copyUserProfiles.value = profileMap;

      await onReload();
    } catch (err) {
      console.error('[CopyUserTab] Failed to execute blocks:', err);
    } finally {
      copyUserExecuting.value = false;
    }
  };

  // Initial state - no data fetched yet
  if (!targetDid) {
    return (
      <div class="copy-user-container">
        <div class="copy-user-intro">
          <h3>Copy User</h3>
          <p>
            Copy another user's follows and/or blocks to your account. Enter a handle below to
            download their public data and select which accounts to follow or block.
          </p>

          <div class="copy-user-input-row">
            <input
              type="text"
              placeholder="Enter handle (e.g., someone.bsky.social)"
              value={handleInput}
              onInput={(e) => setHandleInput((e.target as HTMLInputElement).value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              class="copy-user-handle-input"
            />
            <button class="copy-user-fetch-btn" onClick={handleFetch} disabled={loading || !handleInput.trim()}>
              <Search size={16} class={loading ? 'spinner' : ''} />
              {loading ? 'Fetching...' : 'Fetch'}
            </button>
          </div>

          {loading && progress && <div class="copy-user-progress">{progress}</div>}

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

  // Data loaded - show results
  const selectableFollows = getSelectableFollows();
  const selectableBlocks = getSelectableBlocks();
  const allFollowsSelected = selectedFollows.size === selectableFollows.length && selectableFollows.length > 0;
  const allBlocksSelected = selectedBlocks.size === selectableBlocks.length && selectableBlocks.length > 0;

  return (
    <div class="copy-user-container">
      {/* Target user profile card */}
      {targetProfile && (
        <div class="copy-user-target-card">
          {targetProfile.avatar && (
            <img src={targetProfile.avatar} alt="" class="copy-user-target-avatar" />
          )}
          <div class="copy-user-target-info">
            <div class="copy-user-target-name">
              {targetProfile.displayName || targetProfile.handle}
            </div>
            <div class="copy-user-target-handle">@{targetProfile.handle}</div>
          </div>
          <button
            class="copy-user-change-btn"
            onClick={() => resetCopyUserState()}
            disabled={executing}
          >
            Change User
          </button>
        </div>
      )}

      {/* Stats */}
      <div class="copy-user-stats">
        <div class="copy-user-stat">
          <div class="stat-value">{follows.length}</div>
          <div class="stat-label">Follows</div>
        </div>
        <div class="copy-user-stat">
          <div class="stat-value">{blocks.length}</div>
          <div class="stat-label">Blocks</div>
        </div>
      </div>

      {loadingProfiles && (
        <div class="copy-user-loading-profiles">
          <Loader2 size={16} class="spinner" />
          Loading profile info...
        </div>
      )}

      {profilesError && !loadingProfiles && (
        <div class="copy-user-profiles-error" onClick={handleRetryProfiles}>
          <AlertCircle size={16} />
          {profilesError}
        </div>
      )}

      {/* Execution progress */}
      {executing && (
        <div class="copy-user-execute-progress">
          <Loader2 size={16} class="spinner" />
          {executeProgress.type === 'follows' ? 'Following' : 'Blocking'}: {executeProgress.done} / {executeProgress.total}
        </div>
      )}

      {/* Two-column lists */}
      <div class="copy-user-lists">
        {/* Follows list */}
        <div class="copy-user-list">
          <div class="copy-user-list-header">
            <h4>Follows ({follows.length})</h4>
            <button
              class="copy-user-select-all-btn"
              onClick={handleSelectAllFollows}
              disabled={selectableFollows.length === 0 || executing}
            >
              {allFollowsSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {allFollowsSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div class="copy-user-list-items">
            {follows.map((did) => (
              <UserRow
                key={did}
                did={did}
                profile={profiles.get(did)}
                selected={selectedFollows.has(did)}
                isAlreadyDone={!!profiles.get(did)?.viewer?.following}
                alreadyLabel="Already following"
                onToggle={() => toggleCopyUserFollow(did)}
                disabled={executing}
              />
            ))}
            {follows.length === 0 && (
              <div class="copy-user-empty">No follows found</div>
            )}
          </div>
          <div class="copy-user-list-actions">
            <button
              class="copy-user-action-btn follow"
              onClick={() => setShowFollowConfirm(true)}
              disabled={selectedFollows.size === 0 || executing}
            >
              <UserPlus size={16} />
              Follow Selected ({selectedFollows.size})
            </button>
          </div>
        </div>

        {/* Blocks list */}
        <div class="copy-user-list">
          <div class="copy-user-list-header">
            <h4>Blocks ({blocks.length})</h4>
            <button
              class="copy-user-select-all-btn"
              onClick={handleSelectAllBlocks}
              disabled={selectableBlocks.length === 0 || executing}
            >
              {allBlocksSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {allBlocksSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div class="copy-user-list-items">
            {blocks.map((did) => (
              <UserRow
                key={did}
                did={did}
                profile={profiles.get(did)}
                selected={selectedBlocks.has(did)}
                isAlreadyDone={!!profiles.get(did)?.viewer?.blocking}
                alreadyLabel="Already blocked"
                onToggle={() => toggleCopyUserBlock(did)}
                disabled={executing}
              />
            ))}
            {blocks.length === 0 && (
              <div class="copy-user-empty">No blocks found</div>
            )}
          </div>
          <div class="copy-user-list-actions">
            <button
              class="copy-user-action-btn block"
              onClick={() => setShowBlockConfirm(true)}
              disabled={selectedBlocks.size === 0 || executing}
            >
              <Ban size={16} />
              Block Selected ({selectedBlocks.size})
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation dialogs */}
      {showFollowConfirm && (
        <div class="copy-user-confirm-overlay">
          <div class="copy-user-confirm-dialog">
            <h4>Confirm Follow</h4>
            <p>Are you sure you want to follow {selectedFollows.size} accounts?</p>
            <div class="copy-user-confirm-actions">
              <button class="copy-user-confirm-yes" onClick={executeFollows}>
                Yes, Follow
              </button>
              <button class="copy-user-confirm-no" onClick={() => setShowFollowConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showBlockConfirm && (
        <div class="copy-user-confirm-overlay">
          <div class="copy-user-confirm-dialog">
            <h4>Confirm Block</h4>
            <p>Are you sure you want to block {selectedBlocks.size} accounts?</p>
            <div class="copy-user-confirm-actions">
              <button class="copy-user-confirm-yes" onClick={executeBlocks}>
                Yes, Block
              </button>
              <button class="copy-user-confirm-no" onClick={() => setShowBlockConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface UserRowProps {
  did: string;
  profile?: ProfileWithViewer;
  selected: boolean;
  isAlreadyDone: boolean;
  alreadyLabel: string;
  onToggle: () => void;
  disabled: boolean;
}

function UserRow({
  did,
  profile,
  selected,
  isAlreadyDone,
  alreadyLabel,
  onToggle,
  disabled,
}: UserRowProps): JSX.Element {
  const displayName = profile?.displayName || profile?.handle;
  const displayIdentifier =
    displayName || (did.length > 40 ? `${did.slice(0, 20)}...${did.slice(-15)}` : did);

  return (
    <div
      class={`copy-user-row ${selected ? 'selected' : ''} ${isAlreadyDone ? 'already-done' : ''}`}
      onClick={() => !isAlreadyDone && !disabled && onToggle()}
    >
      <span class="copy-user-row-checkbox">
        {isAlreadyDone ? (
          <Check size={14} class="already-check" />
        ) : selected ? (
          <CheckSquare size={14} />
        ) : (
          <Square size={14} />
        )}
      </span>
      <a
        class="copy-user-row-link"
        href={`https://bsky.app/profile/${did}`}
        target="_blank"
        rel="noopener"
        onClick={(e) => e.stopPropagation()}
      >
        {profile?.avatar ? (
          <img src={profile.avatar} alt="" class="copy-user-row-avatar" />
        ) : (
          <span class="copy-user-row-avatar-placeholder" />
        )}
        <span class="copy-user-row-identity">
          <span class="copy-user-row-name">{displayIdentifier}</span>
          {displayName && profile?.handle && (
            <span class="copy-user-row-handle">@{profile.handle}</span>
          )}
        </span>
      </a>
      {isAlreadyDone && <span class="copy-user-already-badge">{alreadyLabel}</span>}
    </div>
  );
}
