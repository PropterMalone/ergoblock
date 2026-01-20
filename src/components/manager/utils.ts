/**
 * Utility functions for Manager page
 */
import type { ManagedEntry, HistoryEntry, PostContext, ListMember } from '../../types.js';
import type { SortColumn, SortDirection, FilterType } from '../../signals/manager.js';

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function formatTimeRemaining(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getItemHandle(item: ManagedEntry | HistoryEntry | PostContext): string {
  if ('handle' in item) return item.handle;
  if ('targetHandle' in item) return item.targetHandle;
  return '';
}

function getItemDate(item: ManagedEntry | HistoryEntry | PostContext): number {
  if ('source' in item) {
    // ManagedEntry
    return item.createdAt || item.syncedAt || 0;
  } else if ('postCreatedAt' in item) {
    // PostContext
    return item.postCreatedAt || item.timestamp || 0;
  } else if ('timestamp' in item) {
    // HistoryEntry
    return item.timestamp || 0;
  }
  return 0;
}

export function filterAndSort<T extends ManagedEntry | HistoryEntry | PostContext>(
  items: T[],
  search: string,
  sourceFilter: string,
  column: SortColumn,
  direction: SortDirection,
  amnestyMap?: Map<string, 'denied'>,
  typeFilter?: FilterType
): T[] {
  let filtered = items.filter((item) => {
    if (search) {
      const handle = getItemHandle(item);
      if (!handle.toLowerCase().includes(search.toLowerCase())) return false;
    }

    if (sourceFilter !== 'all' && 'source' in item) {
      if ((item as ManagedEntry).source !== sourceFilter) return false;
    }

    // Type filter (block/mute)
    if (typeFilter && typeFilter !== 'all' && 'type' in item) {
      if ((item as ManagedEntry).type !== typeFilter) return false;
    }

    return true;
  });

  const dir = direction === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    let cmp = 0;

    switch (column) {
      case 'user': {
        const handleA = getItemHandle(a);
        const handleB = getItemHandle(b);
        cmp = handleA.localeCompare(handleB);
        break;
      }
      case 'type': {
        const typeA = 'type' in a ? (a as ManagedEntry).type : '';
        const typeB = 'type' in b ? (b as ManagedEntry).type : '';
        cmp = typeA.localeCompare(typeB);
        break;
      }
      case 'source': {
        const sourceA = 'source' in a ? (a as ManagedEntry).source : '';
        const sourceB = 'source' in b ? (b as ManagedEntry).source : '';
        cmp = sourceA.localeCompare(sourceB);
        break;
      }
      case 'amnesty': {
        // Denied sorts before Unreviewed
        const didA = 'did' in a ? (a as ManagedEntry).did : '';
        const didB = 'did' in b ? (b as ManagedEntry).did : '';
        const statusA = amnestyMap?.get(didA) === 'denied' ? 0 : 1;
        const statusB = amnestyMap?.get(didB) === 'denied' ? 0 : 1;
        cmp = statusA - statusB;
        break;
      }
      case 'expires': {
        const expA = 'expiresAt' in a ? (a as ManagedEntry).expiresAt || Infinity : Infinity;
        const expB = 'expiresAt' in b ? (b as ManagedEntry).expiresAt || Infinity : Infinity;
        cmp = expA - expB;
        break;
      }
      case 'date':
      default: {
        const dateA = getItemDate(a);
        const dateB = getItemDate(b);
        cmp = dateA - dateB;
        break;
      }
    }

    return cmp * dir;
  });

  return filtered;
}

// Forgiveness period options
export const FORGIVENESS_OPTIONS = [
  { value: 30, label: '1 month' },
  { value: 60, label: '2 months' },
  { value: 90, label: '3 months' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
];

export function getForgivenessPeriodMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

export function getAmnestyCandidates(
  allBlocks: ManagedEntry[],
  allMutes: ManagedEntry[],
  forgivenessDays: number,
  reviewedDids: Set<string>
): ManagedEntry[] {
  const now = Date.now();
  const cutoff = now - getForgivenessPeriodMs(forgivenessDays);

  const blockCandidates = allBlocks.filter((block) => {
    const blockDate = block.createdAt || block.syncedAt || now;
    if (blockDate > cutoff) return false;
    if (block.viewer?.blockedBy) return false;
    if (reviewedDids.has(block.did)) return false;
    return true;
  });

  const muteCandidates = allMutes.filter((mute) => {
    const muteDate = mute.createdAt || mute.syncedAt || now;
    if (muteDate > cutoff) return false;
    if (reviewedDids.has(mute.did)) return false;
    return true;
  });

  return [...blockCandidates, ...muteCandidates];
}

export function selectRandomCandidate(candidates: ManagedEntry[]): ManagedEntry | null {
  if (candidates.length === 0) return null;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] ?? null;
}

export function postUriToUrl(postUri: string): string {
  return postUri
    .replace('at://', 'https://bsky.app/profile/')
    .replace('/app.bsky.feed.post/', '/post/');
}

// ============================================================================
// List Audit Utilities
// ============================================================================

/**
 * Get list audit candidates - members that haven't been reviewed yet
 */
export function getListAuditCandidates(
  members: ListMember[],
  reviewedDids: Set<string>
): ListMember[] {
  return members.filter((member) => !reviewedDids.has(member.did));
}

/**
 * Select a random candidate from list audit candidates
 */
export function selectRandomListMember(candidates: ListMember[]): ListMember | null {
  if (candidates.length === 0) return null;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] ?? null;
}
