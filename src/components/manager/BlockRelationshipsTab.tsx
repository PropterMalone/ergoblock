import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { RefreshCw, Search, Trash2, ExternalLink, Users, Shield } from 'lucide-preact';
import type { FollowedUser, BlockRelationshipSyncStatus } from '../../types.js';
import { formatDate } from './utils.js';
import browser from '../../browser.js';

interface BlockRelationshipsTabProps {
  onReload: () => Promise<void>;
}

interface SyncStatusResponse {
  success: boolean;
  status?: BlockRelationshipSyncStatus;
}

interface BlockRelationshipsResponse {
  success: boolean;
  error?: string;
  blockedBy?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
  blocking?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
}

interface SyncResponse {
  success: boolean;
  error?: string;
  alreadyRunning?: boolean;
  stats?: {
    totalFollows: number;
    syncedFollows: number;
    totalBlocksTracked: number;
  };
}

export function BlockRelationshipsTab({ onReload }: BlockRelationshipsTabProps): JSX.Element {
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<BlockRelationshipSyncStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    profileDid: string;
    profileHandle: string;
    blockedBy: FollowedUser[];
    blocking: FollowedUser[];
  } | null>(null);
  const [stats, setStats] = useState<{
    totalFollows: number;
    syncedFollows: number;
    totalBlocksTracked: number;
  } | null>(null);

  const loadStatus = async () => {
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'GET_BLOCK_RELATIONSHIP_STATUS',
      })) as SyncStatusResponse;
      if (result.success && result.status) {
        setStatus(result.status);
        setStats({
          totalFollows: result.status.totalFollows,
          syncedFollows: result.status.syncedFollows,
          totalBlocksTracked: result.status.totalBlocksTracked || 0,
        });
      }
    } catch (error) {
      console.error('[BlockRelationshipsTab] Failed to load status:', error);
    }
  };

  // Load status on mount
  useEffect(() => {
    loadStatus();
  }, []);

  // Poll for progress updates during sync
  useEffect(() => {
    if (!syncing && !status?.isRunning) return;

    // Poll immediately, then every second
    loadStatus();
    const interval = setInterval(loadStatus, 1000);
    return () => clearInterval(interval);
  }, [syncing, status?.isRunning]);

  const handleSync = async () => {
    setSyncing(true);
    let keepSyncing = false;
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'SYNC_BLOCK_RELATIONSHIPS',
      })) as SyncResponse;

      if (result.alreadyRunning) {
        // Sync is already in progress from before - keep syncing state true
        // so progress continues to display
        keepSyncing = true;
        return;
      }

      if (result.success && result.stats) {
        setStats(result.stats);
        await loadStatus();
        await onReload();
      } else if (!result.success) {
        alert(`Sync failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[BlockRelationshipsTab] Sync failed:', error);
      alert('Failed to sync block relationships');
    } finally {
      if (!keepSyncing) {
        setSyncing(false);
      }
    }
  };

  const handleClearCache = async () => {
    const confirmed = confirm(
      'Are you sure you want to clear the block relationship cache?\n\n' +
        'You will need to run a new sync to see block relationships again.'
    );
    if (!confirmed) return;

    try {
      await browser.runtime.sendMessage({ type: 'CLEAR_BLOCK_RELATIONSHIP_CACHE' });
      setStatus(null);
      setStats(null);
      setSearchResults(null);
      await loadStatus();
    } catch (error) {
      console.error('[BlockRelationshipsTab] Clear cache failed:', error);
      alert('Failed to clear cache');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResults(null);

    try {
      // First resolve the handle/DID
      let did = searchQuery.trim();
      let handle = searchQuery.trim();

      // If it's a handle (starts with @ or doesn't start with did:), resolve it
      if (handle.startsWith('@')) {
        handle = handle.slice(1);
      }

      if (!did.startsWith('did:')) {
        // Resolve handle to DID via public API
        const response = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`
        );
        if (!response.ok) {
          alert('Could not find that user. Please check the handle and try again.');
          return;
        }
        const profile = (await response.json()) as { did: string; handle: string };
        did = profile.did;
        handle = profile.handle;
      }

      // Get block relationships for this profile
      const result = (await browser.runtime.sendMessage({
        type: 'GET_BLOCK_RELATIONSHIPS',
        did,
      })) as BlockRelationshipsResponse;

      if (!result.success) {
        alert(`Search failed: ${result.error || 'Unknown error'}`);
        return;
      }

      setSearchResults({
        profileDid: did,
        profileHandle: handle,
        blockedBy: (result.blockedBy || []) as FollowedUser[],
        blocking: (result.blocking || []) as FollowedUser[],
      });
    } catch (error) {
      console.error('[BlockRelationshipsTab] Search failed:', error);
      alert('Failed to search for block relationships');
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const lastSyncText = status?.lastSync
    ? `Last synced: ${formatDate(status.lastSync)}`
    : 'Never synced';

  const defaultAvatar =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z"/></svg>';

  // Show initial state if never synced
  if (!status?.lastSync) {
    return (
      <div class="blocklist-audit-container">
        <div class="blocklist-audit-empty">
          <h3>Block Relationships</h3>
          <p>
            See which of your follows have blocked (or are blocked by) any Bluesky profile.
            <br />
            This feature syncs your follows' public block lists.
          </p>
          <button class="audit-sync-btn" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={16} class={syncing ? 'spinner' : ''} />{' '}
            {syncing ? 'Syncing...' : 'Start Sync'}
          </button>
          {syncing && (
            <>
              <div class="block-rel-sync-progress" style={{ marginTop: '16px' }}>
                <RefreshCw size={14} class="spinner" />
                <span>
                  {status?.phase === 'fetching-follows'
                    ? `Fetching follows (page ${status.fetchingPage || 1}, ${status.fetchedFollows || 0} found)...`
                    : status?.currentUser
                      ? `Syncing: @${status.currentUser} (${status.syncedFollows} / ${status.totalFollows})`
                      : status?.totalFollows
                        ? `Syncing... (${status.syncedFollows} / ${status.totalFollows})`
                        : 'Starting sync...'}
                </span>
              </div>
              <button
                class="blocklist-action-btn"
                onClick={handleClearCache}
                style={{ marginTop: '12px' }}
                title="Reset stuck sync"
              >
                <Trash2 size={14} /> Reset Sync
              </button>
            </>
          )}
          {!syncing && (
            <p
              class="audit-last-sync"
              style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}
            >
              Note: Initial sync may take a few minutes depending on how many people you follow.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class="blocklist-audit-container">
      {/* Stats Header */}
      <div class="blocklist-audit-header">
        <div class="blocklist-audit-stats">
          <div class="audit-stat">
            <div class="audit-stat-value">{stats?.totalFollows || status.totalFollows || 0}</div>
            <div class="audit-stat-label">Following</div>
          </div>
          <div class="audit-stat">
            <div class="audit-stat-value">{stats?.syncedFollows || status.syncedFollows || 0}</div>
            <div class="audit-stat-label">Synced</div>
          </div>
          <div class="audit-stat">
            <div class="audit-stat-value">{stats?.totalBlocksTracked || 0}</div>
            <div class="audit-stat-label">Blocks Tracked</div>
          </div>
          {status.errors.length > 0 && (
            <div class="audit-stat">
              <div class="audit-stat-value" style={{ color: '#dc2626' }}>
                {status.errors.length}
              </div>
              <div class="audit-stat-label">Errors</div>
            </div>
          )}
        </div>
        <div class="blocklist-audit-actions">
          <button
            class="audit-sync-btn"
            onClick={handleSync}
            disabled={syncing || status.isRunning}
          >
            <RefreshCw size={16} class={syncing || status.isRunning ? 'spinner' : ''} />{' '}
            {syncing || status.isRunning ? 'Syncing...' : 'Re-sync'}
          </button>
          <button
            class="blocklist-action-btn"
            onClick={handleClearCache}
            style={{ marginLeft: '8px' }}
          >
            <Trash2 size={14} /> Clear Cache
          </button>
        </div>
      </div>
      <div class="audit-last-sync">{lastSyncText}</div>

      {/* Search Section */}
      <div class="block-rel-search-section">
        <h4>
          <Search size={16} style={{ marginRight: '8px' }} />
          Check Profile
        </h4>
        <p class="block-rel-search-desc">
          Enter a Bluesky handle or DID to see which of your follows block them.
        </p>
        <div class="block-rel-search-input-row">
          <input
            type="text"
            class="block-rel-search-input"
            placeholder="@handle or did:plc:..."
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
          />
          <button
            class="audit-sync-btn"
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
          >
            {searching ? (
              <>
                <RefreshCw size={16} class="spinner" /> Searching...
              </>
            ) : (
              <>
                <Search size={16} /> Check
              </>
            )}
          </button>
        </div>
      </div>

      {/* Search Results */}
      {searchResults && (
        <div class="block-rel-results">
          <div class="block-rel-results-header">
            <h4>
              Results for{' '}
              <a
                href={`https://bsky.app/profile/${searchResults.profileHandle}`}
                target="_blank"
                rel="noopener"
              >
                @{searchResults.profileHandle}
              </a>
            </h4>
          </div>

          {searchResults.blockedBy.length === 0 && searchResults.blocking.length === 0 ? (
            <div class="block-rel-no-results">
              <p>No block relationships found among your follows.</p>
            </div>
          ) : (
            <>
              {/* Blocked By Section */}
              {searchResults.blockedBy.length > 0 && (
                <div class="block-rel-section">
                  <h5>
                    <Shield size={14} style={{ marginRight: '6px', color: '#dc2626' }} />
                    Blocked by {searchResults.blockedBy.length} people you follow
                  </h5>
                  <div class="block-rel-user-list">
                    {searchResults.blockedBy.map((user) => (
                      <div key={user.did} class="block-rel-user-row">
                        <img
                          class="block-rel-user-avatar"
                          src={user.avatar || defaultAvatar}
                          alt=""
                          loading="lazy"
                        />
                        <div class="block-rel-user-info">
                          <span class="block-rel-user-handle">@{user.handle}</span>
                          {user.displayName && (
                            <span class="block-rel-user-name">{user.displayName}</span>
                          )}
                        </div>
                        <a
                          class="conflict-view-profile"
                          href={`https://bsky.app/profile/${user.handle}`}
                          target="_blank"
                          rel="noopener"
                        >
                          <ExternalLink size={12} /> View
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Blocking Section */}
              {searchResults.blocking.length > 0 && (
                <div class="block-rel-section">
                  <h5>
                    <Users size={14} style={{ marginRight: '6px', color: '#f59e0b' }} />
                    Blocking {searchResults.blocking.length} people you follow
                  </h5>
                  <div class="block-rel-user-list">
                    {searchResults.blocking.map((user) => (
                      <div key={user.did} class="block-rel-user-row">
                        <img
                          class="block-rel-user-avatar"
                          src={user.avatar || defaultAvatar}
                          alt=""
                          loading="lazy"
                        />
                        <div class="block-rel-user-info">
                          <span class="block-rel-user-handle">@{user.handle}</span>
                          {user.displayName && (
                            <span class="block-rel-user-name">{user.displayName}</span>
                          )}
                        </div>
                        <a
                          class="conflict-view-profile"
                          href={`https://bsky.app/profile/${user.handle}`}
                          target="_blank"
                          rel="noopener"
                        >
                          <ExternalLink size={12} /> View
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Sync Progress */}
      {status.isRunning && (
        <div class="block-rel-sync-progress">
          <RefreshCw size={14} class="spinner" />
          <span>
            {status.phase === 'fetching-follows'
              ? `Fetching follows (page ${status.fetchingPage || 1}, ${status.fetchedFollows || 0} found)...`
              : status.currentUser
                ? `Syncing: @${status.currentUser} (${status.syncedFollows} / ${status.totalFollows})`
                : `Syncing... (${status.syncedFollows} / ${status.totalFollows})`}
          </span>
        </div>
      )}
    </div>
  );
}
