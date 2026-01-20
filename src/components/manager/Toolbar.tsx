import type { JSX } from 'preact';
import {
  searchQuery,
  filterSource,
  filterType,
  selectedItems,
  currentTab,
} from '../../signals/manager.js';

interface ToolbarProps {
  onBulkRemove: () => void;
}

export function Toolbar({ onBulkRemove }: ToolbarProps): JSX.Element {
  const count = selectedItems.value.size;
  const tab = currentTab.value;
  const isHidden = tab === 'amnesty' || tab === 'blocklist-audit';

  if (isHidden) {
    return <></>;
  }

  return (
    <div class="toolbar">
      <input
        type="search"
        placeholder="Search by handle..."
        value={searchQuery.value}
        onInput={(e) => {
          searchQuery.value = (e.target as HTMLInputElement).value;
        }}
      />
      {tab === 'actions' && (
        <select
          value={filterType.value}
          onChange={(e) => {
            filterType.value = (e.target as HTMLSelectElement).value as
              | 'all'
              | 'block'
              | 'mute'
              | 'both';
          }}
        >
          <option value="all">All Types</option>
          <option value="block">Blocks Only</option>
          <option value="mute">Mutes Only</option>
          <option value="both">Both Block & Mute</option>
        </select>
      )}
      <select
        value={filterSource.value}
        onChange={(e) => {
          filterSource.value = (e.target as HTMLSelectElement).value;
        }}
      >
        <option value="all">All Sources</option>
        <option value="ergoblock_temp">Temp (ErgoBlock)</option>
        <option value="bluesky">Permanent (Bluesky)</option>
      </select>
      {count > 0 && (
        <div class="bulk-actions">
          <span>{count} selected</span>
          <button class="danger" onClick={onBulkRemove}>
            Remove Selected
          </button>
        </div>
      )}
    </div>
  );
}
