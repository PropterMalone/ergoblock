import type { JSX } from 'preact';
import { Fragment } from 'preact';
import {
  mutes,
  searchQuery,
  filterSource,
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

interface MutesTableProps {
  onUnmute: (did: string, handle: string) => void;
  onFindContext: (did: string, handle: string) => void;
  onViewPost: (did: string, handle: string, url: string) => void;
  onFetchInteractions: (did: string, handle: string) => Promise<void>;
}

export function MutesTable({
  onUnmute,
  onFindContext,
  onViewPost,
  onFetchInteractions,
}: MutesTableProps): JSX.Element {
  const filtered = filterAndSort(
    mutes.value,
    searchQuery.value,
    filterSource.value,
    sortColumn.value,
    sortDirection.value,
    amnestyStatusMap.value
  );

  if (filtered.length === 0) {
    return (
      <div class="empty-state">
        <h3>No mutes found</h3>
        <p>You haven't muted anyone yet, or try adjusting your filters.</p>
      </div>
    );
  }

  const allDids = filtered.map((m) => m.did);
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
        {filtered.map((mute) => {
          const isTemp = mute.source === 'ergoblock_temp';
          const isExpiringSoon =
            isTemp && mute.expiresAt && mute.expiresAt - Date.now() < 24 * 60 * 60 * 1000;
          const weBlockThem = !!mute.viewer?.blocking;
          const theyBlockUs = !!mute.viewer?.blockedBy;
          const rowClass =
            weBlockThem && theyBlockUs
              ? 'mutual-block'
              : theyBlockUs
                ? 'blocked-by'
                : weBlockThem
                  ? 'mutual-block'
                  : '';
          const isSelected = selectedItems.value.has(mute.did);
          const amnestyStatus = amnestyStatusMap.value.get(mute.did);
          const isExpanded = expandedRows.value.has(mute.did);
          const hasInteractions = (expandedInteractions.value.get(mute.did)?.length ?? 0) > 0;

          return (
            <Fragment key={mute.did}>
              <tr class={`${rowClass} ${isExpanded ? 'row-expanded' : ''}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(mute.did)}
                  />
                </td>
                <UserCell
                  handle={mute.handle}
                  displayName={mute.displayName}
                  avatar={mute.avatar}
                />
                <ContextCell
                  did={mute.did}
                  handle={mute.handle}
                  isBlocked={false}
                  isExpanded={isExpanded}
                  onFindContext={onFindContext}
                  onViewPost={onViewPost}
                  onToggleExpand={() => toggleExpanded(mute.did)}
                  showExpandButton={hasInteractions}
                />
                <td>
                  <span class={`badge ${isTemp ? 'badge-temp' : 'badge-permanent'}`}>
                    {isTemp ? 'Temp' : 'Perm'}
                  </span>
                </td>
                <StatusIndicators viewer={mute.viewer} isBlocksTab={false} />
                <td>
                  <span class={`badge ${amnestyStatus === 'denied' ? 'badge-denied' : 'badge-unreviewed'}`}>
                    {amnestyStatus === 'denied' ? 'Denied' : 'Unreviewed'}
                  </span>
                </td>
                <td>
                  {isTemp && mute.expiresAt ? (
                    <span class={`badge ${isExpiringSoon ? 'badge-expiring' : ''}`}>
                      {formatTimeRemaining(mute.expiresAt)}
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  {mute.createdAt
                    ? formatDate(mute.createdAt)
                    : mute.syncedAt
                      ? formatDate(mute.syncedAt)
                      : '-'}
                </td>
                <td>
                  <button
                    class="action-btn danger unmute-btn"
                    onClick={() => onUnmute(mute.did, mute.handle)}
                  >
                    Unmute
                  </button>
                </td>
              </tr>
              {isExpanded && (
                <tr class="expanded-row">
                  <td colSpan={9}>
                    <InteractionsList
                      did={mute.did}
                      handle={mute.handle}
                      isBlocked={false}
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
