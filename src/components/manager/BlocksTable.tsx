import type { JSX } from 'preact';
import {
  blocks,
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

interface BlocksTableProps {
  onUnblock: (did: string, handle: string) => void;
  onFindContext: (did: string, handle: string) => void;
  onViewPost: (did: string, handle: string, url: string) => void;
}

export function BlocksTable({
  onUnblock,
  onFindContext,
  onViewPost,
}: BlocksTableProps): JSX.Element {
  const filtered = filterAndSort(
    blocks.value,
    searchQuery.value,
    filterSource.value,
    sortColumn.value,
    sortDirection.value,
    amnestyStatusMap.value
  );

  if (filtered.length === 0) {
    return (
      <div class="empty-state">
        <h3>No blocks found</h3>
        <p>You haven't blocked anyone yet, or try adjusting your filters.</p>
      </div>
    );
  }

  const allDids = filtered.map((b) => b.did);
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
        {filtered.map((block) => {
          const isTemp = block.source === 'ergoblock_temp';
          const isExpiringSoon =
            isTemp && block.expiresAt && block.expiresAt - Date.now() < 24 * 60 * 60 * 1000;
          const isMutual = block.viewer?.blockedBy === true;
          const isSelected = selectedItems.value.has(block.did);
          const amnestyStatus = amnestyStatusMap.value.get(block.did);

          return (
            <tr key={block.did} class={isMutual ? 'mutual-block' : ''}>
              <td>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelection(block.did)}
                />
              </td>
              <UserCell
                handle={block.handle}
                displayName={block.displayName}
                avatar={block.avatar}
              />
              <ContextCell
                did={block.did}
                handle={block.handle}
                isBlocked={true}
                onFindContext={onFindContext}
                onViewPost={onViewPost}
              />
              <td>
                <span class={`badge ${isTemp ? 'badge-temp' : 'badge-permanent'}`}>
                  {isTemp ? 'Temp' : 'Perm'}
                </span>
              </td>
              <StatusIndicators viewer={block.viewer} isBlocksTab={true} />
              <td>
                <span class={`badge ${amnestyStatus === 'denied' ? 'badge-denied' : 'badge-unreviewed'}`}>
                  {amnestyStatus === 'denied' ? 'Denied' : 'Unreviewed'}
                </span>
              </td>
              <td>
                {isTemp && block.expiresAt ? (
                  <span class={`badge ${isExpiringSoon ? 'badge-expiring' : ''}`}>
                    {formatTimeRemaining(block.expiresAt)}
                  </span>
                ) : (
                  '-'
                )}
              </td>
              <td>
                {block.createdAt
                  ? formatDate(block.createdAt)
                  : block.syncedAt
                    ? formatDate(block.syncedAt)
                    : '-'}
              </td>
              <td>
                <button
                  class="action-btn danger unblock-btn"
                  onClick={() => onUnblock(block.did, block.handle)}
                >
                  Unblock
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
