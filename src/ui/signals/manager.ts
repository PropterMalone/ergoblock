/**
 * Signals for Manager page state management
 */
import { signal, computed } from '@preact/signals';
import type {
  ManagedEntry,
  HistoryEntry,
  PostContext,
  SyncState,
  ExtensionOptions,
  MassOpsScanResult,
  MassOpsSettings,
  ProfileWithViewer,
  QuotePoster,
  PostAudience,
} from '../../types.js';
import { DEFAULT_MASS_OPS_SETTINGS } from '../../types.js';

// Core data signals
export const blocks = signal<ManagedEntry[]>([]);
export const mutes = signal<ManagedEntry[]>([]);
export const history = signal<HistoryEntry[]>([]);
export const contexts = signal<PostContext[]>([]);
export const syncState = signal<SyncState | null>(null);
export const options = signal<ExtensionOptions | null>(null);

// UI state
export type TabType = 'actions' | 'mass-ops' | 'copy-user' | 'quote-sweep' | 'settings';
export type SortColumn = 'user' | 'type' | 'source' | 'status' | 'expires' | 'date';
export type SortDirection = 'asc' | 'desc';
export type FilterType = 'all' | 'block' | 'mute' | 'both';

export const currentTab = signal<TabType>('actions');
export const searchQuery = signal('');
export const filterSource = signal('all');
export const filterType = signal<FilterType>('all');
export const sortColumn = signal<SortColumn>('date');
export const sortDirection = signal<SortDirection>('desc');
export const selectedItems = signal<Set<string>>(new Set());
export const loading = signal(true);

// Computed stats
export const stats = computed(() => ({
  totalBlocks: blocks.value.length,
  totalMutes: mutes.value.length,
  tempBlocks: blocks.value.filter((b) => b.source === 'ergoblock_temp').length,
  tempMutes: mutes.value.filter((m) => m.source === 'ergoblock_temp').length,
}));

// Combined blocks and mutes for unified table
// Users who are both blocked and muted will appear once with both actions available
export const allEntries = computed(() => {
  const blockDids = new Set(blocks.value.map((b) => b.did));
  const muteDids = new Set(mutes.value.map((m) => m.did));

  // Find users who are both blocked and muted
  const bothDids = new Set([...blockDids].filter((did) => muteDids.has(did)));

  // For users with both, combine into a single entry with type 'both'
  const combinedEntries: ManagedEntry[] = [];

  for (const block of blocks.value) {
    if (bothDids.has(block.did)) {
      // Create combined entry - use block data but mark as 'both'
      combinedEntries.push({
        ...block,
        type: 'both' as ManagedEntry['type'],
      });
    } else {
      combinedEntries.push(block);
    }
  }

  // Add mutes that are not also blocked
  for (const mute of mutes.value) {
    if (!bothDids.has(mute.did)) {
      combinedEntries.push(mute);
    }
  }

  return combinedEntries;
});

// Sorting toggle helper
export function toggleSort(column: SortColumn): void {
  if (sortColumn.value === column) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn.value = column;
    sortDirection.value = column === 'date' || column === 'expires' ? 'desc' : 'asc';
  }
}

// Selection helpers
export function toggleSelection(did: string): void {
  const newSet = new Set(selectedItems.value);
  if (newSet.has(did)) {
    newSet.delete(did);
  } else {
    newSet.add(did);
  }
  selectedItems.value = newSet;
}

export function selectAll(dids: string[]): void {
  selectedItems.value = new Set(dids);
}

export function clearSelection(): void {
  selectedItems.value = new Set();
}

// ============================================================================
// Mass Operations Detection State
// ============================================================================

export const massOpsLoading = signal(false);
export const massOpsProgress = signal('');
export const massOpsScanResult = signal<MassOpsScanResult | null>(null);
export const massOpsSettings = signal<MassOpsSettings>(DEFAULT_MASS_OPS_SETTINGS);
// Track selected operations per cluster: clusterId -> Set of rkeys
export const massOpsSelectedItems = signal<Map<string, Set<string>>>(new Map());
// Track expanded clusters
export const massOpsExpandedClusters = signal<Set<string>>(new Set());

/**
 * Toggle expansion of a cluster
 */
export function toggleMassOpsClusterExpanded(clusterId: string): void {
  const newSet = new Set(massOpsExpandedClusters.value);
  if (newSet.has(clusterId)) {
    newSet.delete(clusterId);
  } else {
    newSet.add(clusterId);
  }
  massOpsExpandedClusters.value = newSet;
}

/**
 * Initialize selection for a cluster (select all by default)
 */
export function initMassOpsClusterSelection(clusterId: string, rkeys: string[]): void {
  const newMap = new Map(massOpsSelectedItems.value);
  newMap.set(clusterId, new Set(rkeys));
  massOpsSelectedItems.value = newMap;
}

/**
 * Toggle selection of an operation within a cluster
 */
export function toggleMassOpsItemSelection(clusterId: string, rkey: string): void {
  const newMap = new Map(massOpsSelectedItems.value);
  const current = newMap.get(clusterId) || new Set();
  const newSet = new Set(current);
  if (newSet.has(rkey)) {
    newSet.delete(rkey);
  } else {
    newSet.add(rkey);
  }
  newMap.set(clusterId, newSet);
  massOpsSelectedItems.value = newMap;
}

/**
 * Select all operations in a cluster
 */
export function selectAllMassOpsItems(clusterId: string, rkeys: string[]): void {
  const newMap = new Map(massOpsSelectedItems.value);
  newMap.set(clusterId, new Set(rkeys));
  massOpsSelectedItems.value = newMap;
}

/**
 * Deselect all operations in a cluster
 */
export function deselectAllMassOpsItems(clusterId: string): void {
  const newMap = new Map(massOpsSelectedItems.value);
  newMap.set(clusterId, new Set());
  massOpsSelectedItems.value = newMap;
}

/**
 * Get selected rkeys for a cluster
 */
export function getMassOpsSelectedItems(clusterId: string): Set<string> {
  return massOpsSelectedItems.value.get(clusterId) || new Set();
}

// ============================================================================
// CAR Cache Status & Download Progress
// ============================================================================

/**
 * Cache status for the user's CAR file
 */
export interface CarCacheStatusInfo {
  hasCached: boolean;
  isStale: boolean;
  cachedRev?: string;
  latestRev?: string;
  cachedAt?: number;
  cachedSize?: number;
  recordCounts?: {
    posts: number;
    blocks: number;
    follows: number;
    listitems: number;
    lists: number;
  };
}

/**
 * Download progress state
 */
export interface CarProgressInfo {
  did: string;
  stage: 'checking' | 'downloading' | 'parsing' | 'saving' | 'complete' | 'error';
  bytesDownloaded: number;
  bytesTotal: number | null;
  percentComplete: number | null;
  message: string;
  isIncremental: boolean;
  startedAt: number;
  error?: string;
}

export const carCacheStatus = signal<CarCacheStatusInfo | null>(null);
export const carDownloadProgress = signal<CarProgressInfo | null>(null);
export const carEstimatedSize = signal<number | null>(null);

/**
 * Reset CAR-related state
 */
export function resetCarState(): void {
  carCacheStatus.value = null;
  carDownloadProgress.value = null;
  carEstimatedSize.value = null;
}

// ============================================================================
// Copy User State
// ============================================================================

export const copyUserTargetHandle = signal<string>('');
export const copyUserTargetDid = signal<string | null>(null);
export const copyUserTargetProfile = signal<ProfileWithViewer | null>(null);
export const copyUserLoading = signal(false);
export const copyUserProgress = signal('');
export const copyUserError = signal<string | null>(null);
export const copyUserFollows = signal<string[]>([]); // DIDs of people the target follows
export const copyUserBlocks = signal<string[]>([]); // DIDs of people the target blocks
export const copyUserSelectedFollows = signal<Set<string>>(new Set());
export const copyUserSelectedBlocks = signal<Set<string>>(new Set());
export const copyUserProfiles = signal<Map<string, ProfileWithViewer>>(new Map());
export const copyUserProfilesError = signal<string | null>(null);
export const copyUserProfilesLoaded = signal(false);
export const copyUserExecuting = signal(false);
export const copyUserExecuteProgress = signal<{ done: number; total: number; type: string }>({
  done: 0,
  total: 0,
  type: '',
});

/**
 * Reset Copy User state
 */
export function resetCopyUserState(): void {
  copyUserTargetHandle.value = '';
  copyUserTargetDid.value = null;
  copyUserTargetProfile.value = null;
  copyUserLoading.value = false;
  copyUserProgress.value = '';
  copyUserError.value = null;
  copyUserFollows.value = [];
  copyUserBlocks.value = [];
  copyUserSelectedFollows.value = new Set();
  copyUserSelectedBlocks.value = new Set();
  copyUserProfiles.value = new Map();
  copyUserProfilesError.value = null;
  copyUserProfilesLoaded.value = false;
  copyUserExecuting.value = false;
  copyUserExecuteProgress.value = { done: 0, total: 0, type: '' };
}

/**
 * Toggle selection of a follow
 */
export function toggleCopyUserFollow(did: string): void {
  const newSet = new Set(copyUserSelectedFollows.value);
  if (newSet.has(did)) {
    newSet.delete(did);
  } else {
    newSet.add(did);
  }
  copyUserSelectedFollows.value = newSet;
}

/**
 * Toggle selection of a block
 */
export function toggleCopyUserBlock(did: string): void {
  const newSet = new Set(copyUserSelectedBlocks.value);
  if (newSet.has(did)) {
    newSet.delete(did);
  } else {
    newSet.add(did);
  }
  copyUserSelectedBlocks.value = newSet;
}

/**
 * Select all follows (excluding already-following)
 */
export function selectAllCopyUserFollows(dids: string[]): void {
  copyUserSelectedFollows.value = new Set(dids);
}

/**
 * Deselect all follows
 */
export function deselectAllCopyUserFollows(): void {
  copyUserSelectedFollows.value = new Set();
}

/**
 * Select all blocks (excluding already-blocked)
 */
export function selectAllCopyUserBlocks(dids: string[]): void {
  copyUserSelectedBlocks.value = new Set(dids);
}

/**
 * Deselect all blocks
 */
export function deselectAllCopyUserBlocks(): void {
  copyUserSelectedBlocks.value = new Set();
}

// ============================================================================
// Quote Sweep State
// ============================================================================

// QuotePoster is the canonical shape (types.ts); re-export so existing importers
// (e.g. QuoteSweepTab) keep their `from '../../signals/manager.js'` import path.
export type { QuotePoster };

export type QuoteActionType = 'block' | 'mute';

export const quoteAudience = signal<PostAudience | ''>('');
export const quotePostRef = signal<string>('');
export const quoteSubject = signal<string | null>(null);
export const quoteQuoters = signal<QuotePoster[]>([]);
export const quoteSelected = signal<Set<string>>(new Set());
export const quoteActionType = signal<QuoteActionType>('block');
// Duration in ms; -1 = permanent (matches the create primitive's isPermanent gate).
export const quoteDuration = signal<number>(7 * 24 * 60 * 60 * 1000);
export const quoteLoading = signal(false);
export const quoteExecuting = signal(false);
export const quoteError = signal<string | null>(null);
// True when the last fetch couldn't resolve viewer state (no auth / short profile fetch):
// the already-blocked/muted flags are unreliable, so the tab warns and skips select-all.
export const quoteViewerStateUnavailable = signal(false);
// True when the last fetch hit the pagination cap (quoter list is incomplete).
export const quoteTruncated = signal(false);
// Set true by the URL-param auto-fill so the tab fires one fetch on mount; the tab clears it.
export const quoteAutoFetch = signal(false);

/** Reset all quote-sweep state (used when starting a fresh sweep). */
export function resetQuoteSweepState(): void {
  quoteAudience.value = '';
  quoteAutoFetch.value = false;
  quotePostRef.value = '';
  quoteSubject.value = null;
  quoteQuoters.value = [];
  quoteSelected.value = new Set();
  quoteLoading.value = false;
  quoteExecuting.value = false;
  quoteError.value = null;
  quoteViewerStateUnavailable.value = false;
  quoteTruncated.value = false;
}

export function toggleQuoteSelection(did: string): void {
  const newSet = new Set(quoteSelected.value);
  if (newSet.has(did)) {
    newSet.delete(did);
  } else {
    newSet.add(did);
  }
  quoteSelected.value = newSet;
}

export function selectAllQuoters(dids: string[]): void {
  quoteSelected.value = new Set(dids);
}

export function clearQuoteSelection(): void {
  quoteSelected.value = new Set();
}
