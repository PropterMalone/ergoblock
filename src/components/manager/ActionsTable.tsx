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
import { getHasCreatedAction } from '../../storage.js';
import { FirstRunEmptyState } from '../shared/FirstRunEmptyState.js';

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

  useEffect(() => {
    getHasCreatedAction().then((hasCreated) => {
      setIsFirstRun(!hasCreated);
    });
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
        <span class="empty-icon">📋</span>
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
          <SortableHeader column="type" label="Type" />
          <th>Context</th>
          <SortableHeader column="source" label="Source" />
          <th>Status</th>
          <SortableHeader column="amnesty" label="Amnesty" />
          <SortableHeader column="expires" label="Expires" />
          <SortableHeader column="date" label="Date" />
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
                <td>
                  <span class={`badge ${isTemp ? 'badge-temp' : 'badge-permanent'}`}>
                    {isTemp ? 'Temp' : 'Perm'}
                  </span>
                </td>
                <StatusIndicators viewer={entry.viewer} isBlocksTab={isBlock || isBoth} />
                <td>
                  <span
                    class={`badge ${amnestyStatus === 'denied' ? 'badge-denied' : 'badge-unreviewed'}`}
                  >
                    {amnestyStatus === 'denied' ? 'Denied' : 'Unreviewed'}
                  </span>
                </td>
                <td>
                  {isTemp && entry.expiresAt ? (
                    <span class={`badge ${isExpiringSoon ? 'badge-expiring' : ''}`}>
                      {formatTimeRemaining(entry.expiresAt)}
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  {entry.createdAt
                    ? formatDate(entry.createdAt)
                    : entry.syncedAt
                      ? formatDate(entry.syncedAt)
                      : '-'}
                </td>
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
