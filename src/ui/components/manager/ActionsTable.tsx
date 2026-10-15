import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  allEntries,
  blocks,
  mutes,
  searchQuery,
  filterSource,
  filterType,
  sortColumn,
  sortDirection,
  selectedItems,
  selectAll,
  clearSelection,
  toggleSelection,
} from '../../signals/manager.js';
import { filterAndSort, formatTimeRemaining, formatDate } from './utils.js';
import { SortableHeader } from './SortableHeader.js';
import { UserCell } from './UserCell.js';
import { StatusIndicators } from './StatusIndicators.js';
import { SetExpiration } from './SetExpiration.js';
import { getHasCreatedAction, getColumnVisibility } from '../../../platform/storage.js';
import { DEFAULT_COLUMN_VISIBILITY, type ColumnVisibility } from '../../../types.js';
import { FirstRunEmptyState } from '../shared/FirstRunEmptyState.js';
import browser from '../../../platform/browser.js';

interface ActionsTableProps {
  onUnblock: (did: string, handle: string) => void;
  onUnmute: (did: string, handle: string) => void;
  onReload: () => Promise<void>;
}
export function ActionsTable({ onUnblock, onUnmute, onReload }: ActionsTableProps): JSX.Element {
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  const [columns, setColumns] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  useEffect(() => {
    let mounted = true;
    getHasCreatedAction().then((created) => {
      if (mounted) setIsFirstRun(!created);
    });
    getColumnVisibility().then((visibility) => {
      if (mounted) setColumns(visibility);
    });
    const change = (changes: Record<string, browser.Storage.StorageChange>) => {
      if (mounted && changes.columnVisibility?.newValue)
        setColumns(changes.columnVisibility.newValue as ColumnVisibility);
    };
    browser.storage.onChanged.addListener(change);
    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(change);
    };
  }, []);
  const filtered = filterAndSort(
    allEntries.value,
    searchQuery.value,
    filterSource.value,
    sortColumn.value,
    sortDirection.value,
    filterType.value
  );
  if (!filtered.length) {
    if (isFirstRun === null) return <div class="empty-state">Loading...</div>;
    if (isFirstRun) return <FirstRunEmptyState surface="manager" />;
    return (
      <div class="empty-state">
        <p class="empty-message">No matching blocks or mutes</p>
        <p class="empty-hint">Use a profile or post menu on Bluesky to block or mute someone.</p>
      </div>
    );
  }
  const dids = filtered.map((entry) => entry.did);
  return (
    <table>
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              aria-label="Select all accounts"
              checked={dids.every((did) => selectedItems.value.has(did))}
              onChange={(event) =>
                event.currentTarget.checked ? selectAll(dids) : clearSelection()
              }
            />
          </th>
          <SortableHeader column="user" label="User" />
          {columns.type && <SortableHeader column="type" label="Type" />}
          {columns.source && <SortableHeader column="source" label="Source" />}
          {columns.status && <th>Status</th>}
          {columns.expires && <SortableHeader column="expires" label="Expires" />}
          {columns.date && <SortableHeader column="date" label="Date" />}
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((entry) => {
          const block = blocks.value.find((item) => item.did === entry.did);
          const mute = mutes.value.find((item) => item.did === entry.did);
          const entries = [block, mute].filter((item) => item !== undefined);
          return (
            <tr key={entry.did} class={entry.viewer?.blockedBy ? 'mutual-block' : ''}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select @${entry.handle}`}
                  checked={selectedItems.value.has(entry.did)}
                  onChange={() => toggleSelection(entry.did)}
                />
              </td>
              <UserCell
                handle={entry.handle}
                displayName={entry.displayName}
                avatar={entry.avatar}
              />
              {columns.type && (
                <td>
                  {entries.map((item) => (
                    <span key={item.type} class={`badge badge-${item.type}`}>
                      {item.type === 'block' ? 'Block' : 'Mute'}
                    </span>
                  ))}
                </td>
              )}
              {columns.source && (
                <td>
                  {entries.map((item) => (
                    <div key={item.type}>
                      {entries.length > 1 ? `${item.type}: ` : ''}
                      {item.source === 'ergoblock_temp' ? 'Temp' : 'Perm'}
                    </div>
                  ))}
                </td>
              )}
              {columns.status && <StatusIndicators viewer={entry.viewer} isBlocksTab={!!block} />}
              {columns.expires && (
                <td>
                  {entries.map((item) => (
                    <div key={item.type}>
                      {entries.length > 1 ? `${item.type}: ` : ''}
                      {item.expiresAt ? formatTimeRemaining(item.expiresAt) : 'Permanent'}
                    </div>
                  ))}
                </td>
              )}
              {columns.date && (
                <td>
                  {entry.createdAt || entry.syncedAt
                    ? formatDate(entry.createdAt || entry.syncedAt || 0)
                    : '-'}
                </td>
              )}
              <td>
                <div class="action-group">
                  {block && (
                    <button
                      class="action-btn danger"
                      onClick={() => onUnblock(entry.did, entry.handle)}
                    >
                      Unblock
                    </button>
                  )}
                  {mute && (
                    <button
                      class="action-btn danger"
                      onClick={() => onUnmute(entry.did, entry.handle)}
                    >
                      Unmute
                    </button>
                  )}
                  {block && block.source !== 'ergoblock_temp' && (
                    <SetExpiration did={entry.did} actionType="block" onReload={onReload} />
                  )}
                  {mute && mute.source !== 'ergoblock_temp' && (
                    <SetExpiration did={entry.did} actionType="mute" onReload={onReload} />
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
