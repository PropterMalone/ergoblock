import type { JSX } from 'preact';
import {
  history,
  searchQuery,
  filterSource,
  sortColumn,
  sortDirection,
} from '../../signals/manager.js';
import { filterAndSort, formatDate } from './utils.js';
import { SortableHeader } from './SortableHeader.js';

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  auto_expire: 'Auto-expired',
  removed: 'External',
};

export function HistoryTable(): JSX.Element {
  const filtered = filterAndSort(
    history.value,
    searchQuery.value,
    filterSource.value,
    sortColumn.value,
    sortDirection.value
  );

  if (filtered.length === 0) {
    return (
      <div class="empty-state">
        <h3>No history</h3>
        <p>Your block/mute history will appear here.</p>
      </div>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <SortableHeader column="user" label="User" />
          <th>Action</th>
          <th>Trigger</th>
          <th>Status</th>
          <SortableHeader column="date" label="Date" />
        </tr>
      </thead>
      <tbody>
        {filtered.map((entry, index) => (
          <tr key={`${entry.did}-${entry.timestamp}-${index}`}>
            <td>
              <div class="user-cell">
                <div class="user-info">
                  <span class="user-handle">@{entry.handle}</span>
                </div>
              </div>
            </td>
            <td>
              <span class={`history-action ${entry.action}`}>{entry.action}</span>
            </td>
            <td>
              <span class="history-trigger">{TRIGGER_LABELS[entry.trigger] || entry.trigger}</span>
            </td>
            <td>{entry.success ? '✓' : `✗ ${entry.error || ''}`}</td>
            <td>{formatDate(entry.timestamp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
