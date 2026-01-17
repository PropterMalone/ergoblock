import type { JSX } from 'preact';
import { sortColumn, sortDirection, toggleSort, type SortColumn } from '../../signals/manager.js';

interface SortableHeaderProps {
  column: SortColumn;
  label: string;
}

export function SortableHeader({ column, label }: SortableHeaderProps): JSX.Element {
  const isActive = sortColumn.value === column;
  const arrow = isActive ? (sortDirection.value === 'asc' ? '↑' : '↓') : '⇅';

  return (
    <th class="sortable" onClick={() => toggleSort(column)}>
      {label}{' '}
      <span class={`sort-arrow ${isActive ? 'sort-active' : 'sort-inactive'}`}>{arrow}</span>
    </th>
  );
}
