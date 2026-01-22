import type { JSX } from 'preact';
import { Fragment } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  allEntries,
  searchQuery,
  filterSource,
  filterType,
  sortColumn,
  sortDirection,
  selectedItems,
  selectAll,
  clearSelection,
  toggleSelection,
  amnestyStatusMap,
  expandedRows,
  expandedInteractions,
  toggleExpanded,
} from '../../signals/manager.js';
import { filterAndSort, formatTimeRemaining, formatDate } from './utils.js';
import { SortableHeader } from './SortableHeader.js';
import { UserCell } from './UserCell.js';
import { ContextCell } from './ContextCell.js';
import { StatusIndicators } from './StatusIndicators.js';
import { InteractionsList } from './InteractionsList.js';
import { getHasCreatedAction, getColumnVisibility } from '../../storage.js';
import { DEFAULT_COLUMN_VISIBILITY, type ColumnVisibility } from '../../types.js';
import { FirstRunEmptyState } from '../shared/FirstRunEmptyState.js';
import browser from '../../browser.js';

interface ActionsTableProps {
  onUnblock: (did: string, handle: string) => void;
  onUnmute: (did: string, handle: string) => void;
  onFindContext: (did: string, handle: string) => void;
  onViewPost: (did: string, handle: string, url: string) => void;
  onFetchInteractions: (did: string, handle: string) => Promise<void>;
}

export function ActionsTable({
  onUnblock,
  onUnmute,
  onFindContext,
  onViewPost,
  onFetchInteractions,
}: ActionsTableProps): JSX.Element {
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(
    DEFAULT_COLUMN_VISIBILITY
  );

  useEffect(() => {
    let mounted = true;
    getHasCreatedAction().then((hasCreated) => {
      if (mounted) {
        setIsFirstRun(!hasCreated);
      }
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;

    // Load initial column visibility
    getColumnVisibility().then((visibility) => {
      if (mounted) {
        setColumnVisibility(visibility);
      }
    });

    // Listen for storage changes to update when settings change
    const handleStorageChange = (changes: Record<string, browser.Storage.StorageChange>) => {
      if (changes.columnVisibility && mounted) {
        setColumnVisibility(changes.columnVisibility.newValue);
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const filtered = filterAndSort(
    allEntries.value,
    searchQuery.value,
    filterSource.value,
    sortColumn.value,
    sortDirection.value,
    amnestyStatusMap.value,
    filterType.value
  );

  if (filtered.length === 0) {
    // Still loading first-run status
    if (isFirstRun === null) {
      return <div class="empty-state">Loading...</div>;
    }

    // First-run: show onboarding
    if (isFirstRun) {
      return <FirstRunEmptyState surface="manager" />;
    }

    // Standard empty state with action hint
    return (
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 2h12c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2zm0 2v12h12V4H4zm2 2h3v2H6V6zm5 0h3v2h-3V6zm-5 3h3v2H6V9zm5 0h3v2h-3V9z" />
        </svg>
        <p class="empty-message">No blocks or mutes yet</p>
        <p class="empty-hint">
          To block or mute someone, go to their profile on Bluesky and click the ... menu.
        </p>
      </div>
    );
  }

  const allDids = filtered.map((entry) => entry.did);
  const allSelected = allDids.every((did) => selectedItems.value.has(did));

  const handleSelectAll = (e: Event) => {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) {
      selectAll(allDids);
    } else {
      clearSelection();
    }
  };

  return (
    <table>
      <thead>
        <tr>
          <th>
            <input type="checkbox" checked={allSelected} onChange={handleSelectAll} />
          </th>
          <SortableHeader column="user" label="User" />
          {columnVisibility.type && <SortableHeader column="type" label="Type" />}
          {columnVisibility.context && <th>Context</th>}
          {columnVisibility.source && <SortableHeader column="source" label="Source" />}
          {columnVisibility.status && <th>Status</th>}
          {columnVisibility.amnesty && <SortableHeader column="amnesty" label="Amnesty" />}
          {columnVisibility.expires && <SortableHeader column="expires" label="Expires" />}
          {columnVisibility.date && <SortableHeader column="date" label="Date" />}
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((entry) => {
          const isBlock = entry.type === 'block';
          const isBoth = entry.type === 'both';
          const isTemp = entry.source === 'ergoblock_temp';
          const isExpiringSoon =
            isTemp && entry.expiresAt && entry.expiresAt - Date.now() < 24 * 60 * 60 * 1000;

          // Row styling based on relationship
          const theyBlockUs = !!entry.viewer?.blockedBy;
          const rowClass = theyBlockUs ? 'mutual-block' : '';

          const isSelected = selectedItems.value.has(entry.did);
          const amnestyStatus = amnestyStatusMap.value.get(entry.did);
          const isExpanded = expandedRows.value.has(entry.did);
          const hasInteractions = (expandedInteractions.value.get(entry.did)?.length ?? 0) > 0;

          return (
            <Fragment key={entry.did}>
              <tr class={`${rowClass} ${isExpanded ? 'row-expanded' : ''}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(entry.did)}
                  />
                </td>
                <UserCell
                  handle={entry.handle}
                  displayName={entry.displayName}
                  avatar={entry.avatar}
                />
                {columnVisibility.type && (
                  <td>
                    {isBoth ? (
                      <div class="badge-group">
                        <span class="badge badge-block">Block</span>
                        <span class="badge badge-mute">Mute</span>
                      </div>
                    ) : (
                      <span class={`badge ${isBlock ? 'badge-block' : 'badge-mute'}`}>
                        {isBlock ? 'Block' : 'Mute'}
                      </span>
                    )}
                  </td>
                )}
                {columnVisibility.context && (
                  <ContextCell
                    did={entry.did}
                    handle={entry.handle}
                    isBlocked={isBlock || isBoth}
                    isExpanded={isExpanded}
                    onFindContext={onFindContext}
                    onViewPost={onViewPost}
                    onToggleExpand={() => toggleExpanded(entry.did)}
                    showExpandButton={hasInteractions}
                  />
                )}
                {columnVisibility.source && (
                  <td>
                    <span class={`badge ${isTemp ? 'badge-temp' : 'badge-permanent'}`}>
                      {isTemp ? 'Temp' : 'Perm'}
                    </span>
                  </td>
                )}
                {columnVisibility.status && <StatusIndicators viewer={entry.viewer} isBlocksTab={isBlock || isBoth} />}
                {columnVisibility.amnesty && (
                  <td>
                    <span
                      class={`badge ${amnestyStatus === 'denied' ? 'badge-denied' : 'badge-unreviewed'}`}
                    >
                      {amnestyStatus === 'denied' ? 'Denied' : 'Unreviewed'}
                    </span>
                  </td>
                )}
                {columnVisibility.expires && (
                  <td>
                    {isTemp && entry.expiresAt ? (
                      <span class={`badge ${isExpiringSoon ? 'badge-expiring' : ''}`}>
                        {formatTimeRemaining(entry.expiresAt)}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                )}
                {columnVisibility.date && (
                  <td>
                    {entry.createdAt
                      ? formatDate(entry.createdAt)
                      : entry.syncedAt
                        ? formatDate(entry.syncedAt)
                        : '-'}
                  </td>
                )}
                <td>
                  {isBoth ? (
                    <div class="action-group">
                      <button
                        class="action-btn danger unblock-btn"
                        onClick={() => onUnblock(entry.did, entry.handle)}
                      >
                        Unblock
                      </button>
                      <button
                        class="action-btn danger unmute-btn"
                        onClick={() => onUnmute(entry.did, entry.handle)}
                      >
                        Unmute
                      </button>
                    </div>
                  ) : (
                    <button
                      class={`action-btn danger ${isBlock ? 'unblock-btn' : 'unmute-btn'}`}
                      onClick={() =>
                        isBlock
                          ? onUnblock(entry.did, entry.handle)
                          : onUnmute(entry.did, entry.handle)
                      }
                    >
                      {isBlock ? 'Unblock' : 'Unmute'}
                    </button>
                  )}
                </td>
              </tr>
              {isExpanded && (
                <tr class="expanded-row">
                  <td colSpan={10}>
                    <InteractionsList
                      did={entry.did}
                      handle={entry.handle}
                      isBlocked={isBlock || isBoth}
                      onFetchInteractions={onFetchInteractions}
                      onViewPost={onViewPost}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
