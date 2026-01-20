import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { RefreshCw, Eye, EyeOff, UserX, ExternalLink, Copy } from 'lucide-preact';
import type { BlocklistConflictGroup } from '../../types.js';
import { blocklistAuditState, blocklistConflicts } from '../../signals/manager.js';
import { formatDate } from './utils.js';
import { dismissBlocklistConflicts, undismissBlocklistConflicts } from '../../storage.js';
import browser from '../../browser.js';

interface BlocklistAuditTabProps {
  onReload: () => Promise<void>;
}

export function BlocklistAuditTab({ onReload }: BlocklistAuditTabProps): JSX.Element {
  const [syncing, setSyncing] = useState(false);
  const [copyingListUri, setCopyingListUri] = useState<string | null>(null);

  const state = blocklistAuditState.value;
  const conflicts = blocklistConflicts.value;

  const lastSyncText = state?.lastSyncAt
    ? `Last synced: ${formatDate(state.lastSyncAt)}`
    : 'Never synced';

  const activeConflicts = conflicts.filter((g) => !g.dismissed);
  const dismissedConflicts = conflicts.filter((g) => g.dismissed);
  const totalActiveConflicts = activeConflicts.reduce((sum, g) => sum + g.conflicts.length, 0);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = (await browser.runtime.sendMessage({ type: 'BLOCKLIST_AUDIT_SYNC' })) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        await onReload();
      } else {
        alert(`Audit failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[BlocklistAuditTab] Sync failed:', error);
      alert('Failed to run blocklist audit');
    } finally {
      setSyncing(false);
    }
  };

  const handleDismiss = async (listUri: string) => {
    await dismissBlocklistConflicts(listUri);
    await onReload();
  };

  const handleUndismiss = async (listUri: string) => {
    await undismissBlocklistConflicts(listUri);
    await onReload();
  };

  const handleUnsubscribe = async (listUri: string) => {
    const group = conflicts.find((g) => g.list.uri === listUri);
    if (!group) return;

    const confirmed = confirm(
      `Are you sure you want to unsubscribe from "${group.list.name}"?\n\n` +
        `This will remove all blocks/mutes from this list.`
    );

    if (!confirmed) return;

    try {
      const result = (await browser.runtime.sendMessage({
        type: 'UNSUBSCRIBE_BLOCKLIST',
        listUri,
      })) as { success: boolean; error?: string };

      if (result.success) {
        await browser.runtime.sendMessage({ type: 'BLOCKLIST_AUDIT_SYNC' });
        await onReload();
      } else {
        alert(`Failed to unsubscribe: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[BlocklistAuditTab] Unsubscribe failed:', error);
      alert('Failed to unsubscribe from blocklist');
    }
  };

  const handleCopyAsBlocks = async (listUri: string) => {
    const group = conflicts.find((g) => g.list.uri === listUri);
    if (!group) return;

    const confirmed = confirm(
      `Copy "${group.list.name}" as individual blocks?\n\n` +
        `This will block all members of this list as permanent individual blocks, ` +
        `EXCLUDING anyone you follow.\n\n` +
        `This is reversible via Mass Ops (all blocks will appear as a cluster since they happen rapidly).`
    );

    if (!confirmed) return;

    setCopyingListUri(listUri);
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'COPY_BLOCKLIST_AS_INDIVIDUAL_BLOCKS',
        listUri,
      })) as { success: boolean; blocked?: number; skipped?: number; error?: string };

      if (result.success) {
        alert(
          `Successfully blocked ${result.blocked} users.\n` +
            `Skipped ${result.skipped} (already blocked or you follow them).`
        );
        await onReload();
      } else {
        alert(`Failed to copy blocklist: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[BlocklistAuditTab] Copy as blocks failed:', error);
      alert('Failed to copy blocklist as individual blocks');
    } finally {
      setCopyingListUri(null);
    }
  };

  if (conflicts.length === 0) {
    return (
      <div class="blocklist-audit-container">
        <div class="blocklist-audit-empty">
          <h3>{state?.lastSyncAt ? 'No Conflicts Found' : 'Blocklist Audit'}</h3>
          <p>
            {state?.lastSyncAt
              ? 'None of your follows or followers are on any of your subscribed blocklists.'
              : 'Check if any of your follows or followers are on blocklists you subscribe to.'}
          </p>
          <button class="audit-sync-btn" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={16} class={syncing ? 'spinner' : ''} />{' '}
            {syncing ? 'Syncing...' : 'Run Audit'}
          </button>
          <div class="audit-last-sync">{lastSyncText}</div>
        </div>
      </div>
    );
  }

  return (
    <div class="blocklist-audit-container">
      <div class="blocklist-audit-header">
        <div class="blocklist-audit-stats">
          <div class="audit-stat">
            <div class="audit-stat-value">{state?.followCount || 0}</div>
            <div class="audit-stat-label">Following</div>
          </div>
          <div class="audit-stat">
            <div class="audit-stat-value">{state?.followerCount || 0}</div>
            <div class="audit-stat-label">Followers</div>
          </div>
          <div class="audit-stat">
            <div class="audit-stat-value">{state?.blocklistCount || 0}</div>
            <div class="audit-stat-label">Blocklists</div>
          </div>
          <div class="audit-stat">
            <div
              class="audit-stat-value"
              style={{ color: totalActiveConflicts > 0 ? '#dc2626' : '#16a34a' }}
            >
              {totalActiveConflicts}
            </div>
            <div class="audit-stat-label">Conflicts</div>
          </div>
        </div>
        <div class="blocklist-audit-actions">
          <button class="audit-sync-btn" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={16} class={syncing ? 'spinner' : ''} />{' '}
            {syncing ? 'Syncing...' : 'Re-run Audit'}
          </button>
        </div>
      </div>
      <div class="audit-last-sync">{lastSyncText}</div>

      {activeConflicts.map((group) => (
        <BlocklistGroup
          key={group.list.uri}
          group={group}
          onDismiss={handleDismiss}
          onUndismiss={handleUndismiss}
          onUnsubscribe={handleUnsubscribe}
          onCopyAsBlocks={handleCopyAsBlocks}
          copyingListUri={copyingListUri}
        />
      ))}

      {dismissedConflicts.length > 0 && (
        <>
          <h4 style={{ margin: '20px 0 10px', color: '#888' }}>
            Dismissed ({dismissedConflicts.length})
          </h4>
          {dismissedConflicts.map((group) => (
            <BlocklistGroup
              key={group.list.uri}
              group={group}
              onDismiss={handleDismiss}
              onUndismiss={handleUndismiss}
              onUnsubscribe={handleUnsubscribe}
              onCopyAsBlocks={handleCopyAsBlocks}
              copyingListUri={copyingListUri}
            />
          ))}
        </>
      )}
    </div>
  );
}

interface BlocklistGroupProps {
  group: BlocklistConflictGroup;
  onDismiss: (listUri: string) => void;
  onUndismiss: (listUri: string) => void;
  onUnsubscribe: (listUri: string) => void;
  onCopyAsBlocks: (listUri: string) => void;
  copyingListUri: string | null;
}

function BlocklistGroup({
  group,
  onDismiss,
  onUndismiss,
  onUnsubscribe,
  onCopyAsBlocks,
  copyingListUri,
}: BlocklistGroupProps): JSX.Element {
  const isCopying = copyingListUri === group.list.uri;
  const list = group.list;
  const defaultAvatar =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><path d="M3 4h18v16H3V4zm2 2v12h14V6H5z"/></svg>';
  const avatarUrl = list.avatar || defaultAvatar;

  return (
    <div class={`blocklist-group ${group.dismissed ? 'dismissed' : ''}`}>
      <div class="blocklist-group-header">
        <div class="blocklist-info">
          <img class="blocklist-avatar" src={avatarUrl} alt="" loading="lazy" />
          <div class="blocklist-details">
            <span class="blocklist-name">{list.name}</span>
            <span class="blocklist-creator">by @{list.creator.handle}</span>
          </div>
          <span class="blocklist-conflict-count">
            {group.conflicts.length} conflict{group.conflicts.length === 1 ? '' : 's'}
          </span>
        </div>
        <div class="blocklist-actions">
          {group.dismissed ? (
            <button
              class="blocklist-action-btn blocklist-undismiss"
              onClick={() => onUndismiss(list.uri)}
            >
              <Eye size={14} /> Show Again
            </button>
          ) : (
            <button
              class="blocklist-action-btn blocklist-dismiss"
              onClick={() => onDismiss(list.uri)}
            >
              <EyeOff size={14} /> Dismiss
            </button>
          )}
          <button
            class="blocklist-action-btn blocklist-unsubscribe"
            onClick={() => onUnsubscribe(list.uri)}
          >
            <UserX size={14} /> Unsubscribe
          </button>
          <button
            class="blocklist-action-btn blocklist-copy-blocks"
            onClick={() => onCopyAsBlocks(list.uri)}
            disabled={isCopying}
          >
            <Copy size={14} /> {isCopying ? 'Copying...' : 'Copy as Blocks'}
          </button>
        </div>
      </div>
      <div class="blocklist-conflicts">
        {group.conflicts.map((conflict) => {
          const user = conflict.user;
          const defaultUserAvatar =
            'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z"/></svg>';
          const userAvatar = user.avatar || defaultUserAvatar;
          const relationshipText =
            user.relationship === 'mutual'
              ? 'Mutual'
              : user.relationship === 'following'
                ? 'You follow'
                : 'Follows you';

          return (
            <div key={user.did} class="blocklist-conflict-row">
              <img class="conflict-user-avatar" src={userAvatar} alt="" loading="lazy" />
              <div class="conflict-user-info">
                <span class="conflict-user-handle">@{user.handle}</span>
                {user.displayName && <span class="conflict-user-name">{user.displayName}</span>}
              </div>
              <span class={`conflict-relationship ${user.relationship}`}>{relationshipText}</span>
              <a
                class="conflict-view-profile"
                href={`https://bsky.app/profile/${user.handle}`}
                target="_blank"
                rel="noopener"
              >
                <ExternalLink size={12} /> View Profile
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
