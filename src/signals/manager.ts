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
  BlocklistAuditState,
  BlocklistConflictGroup,
  AmnestyReview,
  Interaction,
  OwnedList,
  ListMember,
  MassOpsScanResult,
  MassOpsSettings,
  ProfileWithViewer,
} from '../types.js';
import { DEFAULT_MASS_OPS_SETTINGS } from '../types.js';

// Core data signals
export const blocks = signal<ManagedEntry[]>([]);
export const mutes = signal<ManagedEntry[]>([]);
export const history = signal<HistoryEntry[]>([]);
export const contexts = signal<PostContext[]>([]);
export const syncState = signal<SyncState | null>(null);
export const options = signal<ExtensionOptions | null>(null);

// Amnesty state
export const amnestyReviewedDids = signal<Set<string>>(new Set());
export const amnestyReviews = signal<AmnestyReview[]>([]); // Full review records for showing status
export const amnestyCandidate = signal<ManagedEntry | null>(null);
export const amnestySearching = signal(false);
// Track DIDs where we already searched and found no context (avoids repeated searches)
export const amnestySearchedNoContext = signal<Set<string>>(new Set());

// List audit state (Amnesty mode for auditing list members)
export type AmnestyMode = 'blocks_mutes' | 'list_members';
export const amnestyMode = signal<AmnestyMode>('blocks_mutes');
export const ownedLists = signal<OwnedList[]>([]);
export const selectedListUri = signal<string | null>(null);
export const listMembers = signal<ListMember[]>([]);
export const listAuditCandidate = signal<ListMember | null>(null);
export const listAuditReviewedDids = signal<Set<string>>(new Set());
export const listAuditLoading = signal(false);

/**
 * Set the amnesty mode and reset relevant state
 */
export function setAmnestyMode(mode: AmnestyMode): void {
  amnestyMode.value = mode;
  // Reset candidates when switching modes
  if (mode === 'blocks_mutes') {
    listAuditCandidate.value = null;
  } else {
    amnestyCandidate.value = null;
  }
}

/**
 * Select a list for auditing
 */
export function selectList(uri: string | null): void {
  selectedListUri.value = uri;
  listMembers.value = [];
  listAuditCandidate.value = null;
  listAuditReviewedDids.value = new Set();
}

// Computed map of DID -> amnesty status ('denied' or undefined for unreviewed)
export const amnestyStatusMap = computed(() => {
  const map = new Map<string, 'denied'>();
  for (const review of amnestyReviews.value) {
    // 'kept_blocked' or 'kept_muted' means user decided to keep the block/mute
    if (review.decision === 'kept_blocked' || review.decision === 'kept_muted') {
      map.set(review.did, 'denied');
    }
    // 'unblocked' or 'unmuted' means they were freed - they won't be in the list anymore
  }
  return map;
});

// Blocklist audit state
export const blocklistAuditState = signal<BlocklistAuditState | null>(null);
export const blocklistConflicts = signal<BlocklistConflictGroup[]>([]);

// UI state
export type TabType =
  | 'blocks'
  | 'mutes'
  | 'history'
  | 'amnesty'
  | 'blocklist-audit'
  | 'repost-filters'
  | 'mass-ops'
  | 'copy-user';
export type SortColumn = 'user' | 'source' | 'status' | 'amnesty' | 'expires' | 'date';
export type SortDirection = 'asc' | 'desc';

export const currentTab = signal<TabType>('blocks');
export const searchQuery = signal('');
export const filterSource = signal('all');
export const sortColumn = signal<SortColumn>('date');
export const sortDirection = signal<SortDirection>('desc');
export const selectedItems = signal<Set<string>>(new Set());
export const loading = signal(true);

// Temp unblock tracking
export const tempUnblockTimers = signal<Map<string, { timerId: number; expiresAt: number }>>(
  new Map()
);

// Find context loading state
export const findingContext = signal<Set<string>>(new Set());

export function setFindingContext(did: string, loading: boolean): void {
  const newSet = new Set(findingContext.value);
  if (loading) {
    newSet.add(did);
  } else {
    newSet.delete(did);
  }
  findingContext.value = newSet;
}

// Expanded row state for viewing all interactions
export const expandedRows = signal<Set<string>>(new Set());
export const expandedInteractions = signal<Map<string, Interaction[]>>(new Map());
export const expandedLoading = signal<Set<string>>(new Set());

export function toggleExpanded(did: string): void {
  const newSet = new Set(expandedRows.value);
  if (newSet.has(did)) {
    newSet.delete(did);
  } else {
    newSet.add(did);
  }
  expandedRows.value = newSet;
}

export function setInteractions(did: string, interactions: Interaction[]): void {
  const newMap = new Map(expandedInteractions.value);
  newMap.set(did, interactions);
  expandedInteractions.value = newMap;
}

export function setExpandedLoading(did: string, loading: boolean): void {
  const newSet = new Set(expandedLoading.value);
  if (loading) {
    newSet.add(did);
  } else {
    newSet.delete(did);
  }
  expandedLoading.value = newSet;
}

// Context map computed from contexts
export const contextMap = computed(() => {
  const map = new Map<string, PostContext>();
  for (const ctx of contexts.value) {
    const existing = map.get(ctx.targetDid);
    if (!existing || ctx.timestamp > existing.timestamp) {
      map.set(ctx.targetDid, ctx);
    }
  }
  return map;
});

// Computed stats
export const stats = computed(() => ({
  totalBlocks: blocks.value.length,
  totalMutes: mutes.value.length,
  tempBlocks: blocks.value.filter((b) => b.source === 'ergoblock_temp').length,
  tempMutes: mutes.value.filter((m) => m.source === 'ergoblock_temp').length,
}));

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
