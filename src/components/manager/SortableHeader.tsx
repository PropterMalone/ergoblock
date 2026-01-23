import type { JSX } from 'preact';
import { sortColumn, sortDirection, toggleSort, type SortColumn } from '../../signals/manager.js';
import { Tooltip } from '../shared/Tooltip.js';
import { COLUMN_TOOLTIPS } from '../../constants/tooltips.js';

interface SortableHeaderProps {
  column: SortColumn;
  label: string;
  tooltip?: string;
}

export function SortableHeader({ column, label, tooltip }: SortableHeaderProps): JSX.Element {
  const isActive = sortColumn.value === column;
  const arrow = isActive ? (sortDirection.value === 'asc' ? '↑' : '↓') : '⇅';

  const headerContent = (
    <>
      {label}{' '}
      <span class={`sort-arrow ${isActive ? 'sort-active' : 'sort-inactive'}`}>{arrow}</span>
    </>
  );

  const tooltipText = tooltip ?? (COLUMN_TOOLTIPS[column as keyof typeof COLUMN_TOOLTIPS] as string | undefined);

  return (
    <th class="sortable" onClick={() => toggleSort(column)}>
      {tooltipText ? (
        <Tooltip text={tooltipText} position="bottom">
          <span>{headerContent}</span>
        </Tooltip>
      ) : (
        headerContent
      )}
    </th>
  );
}
