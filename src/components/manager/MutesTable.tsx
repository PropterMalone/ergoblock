import type { JSX } from 'preact';
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
} from '../../signals/manager.js';
import { filterAndSort, formatTimeRemaining, formatDate } from './utils.js';
import { SortableHeader } from './SortableHeader.js';
import { UserCell } from './UserCell.js';
import { ContextCell } from './ContextCell.js';
import { StatusIndicators } from './StatusIndicators.js';

interface MutesTableProps {
  onUnmute: (did: string, handle: string) => void;
  onFindContext: (did: string, handle: string) => void;
  onViewPost: (did: string, handle: string, url: string) => void;
}

export function MutesTable({
  onUnmute,
  onFindContext,
  onViewPost,
}: MutesTableProps): JSX.Element {
  const filtered = filterAndSort(
    mutes.value,
    searchQuery.value,
    filterSource.value,
    sortColumn.value,
    sortDirection.value
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
          <th>Amnesty</th>
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

          return (
            <tr key={mute.did} class={rowClass}>
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
                onFindContext={onFindContext}
                onViewPost={onViewPost}
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
          );
        })}
      </tbody>
    </table>
  );
}
