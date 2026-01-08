/**
 * ErgoBlock Manager - Full-page block/mute management UI
 */

import browser from './browser.js';
import {
  getAllManagedBlocks,
  getAllManagedMutes,
  getActionHistory,
  getPostContexts,
  getSyncState,
  removeTempBlock,
  removeTempMute,
  getAmnestyReviewedDids,
  addAmnestyReview,
  getAmnestyStats,
  getOptions,
  setOptions,
} from './storage.js';
import type {
  ManagedEntry,
  HistoryEntry,
  PostContext,
  SyncState,
  ProfileViewerState,
  AmnestyReview,
  ExtensionOptions,
} from './types.js';

// State
let allBlocks: ManagedEntry[] = [];
let allMutes: ManagedEntry[] = [];
let history: HistoryEntry[] = [];
let contexts: PostContext[] = [];
let syncState: SyncState | null = null;
let currentTab = 'blocks';
let selectedItems: Set<string> = new Set();
let options: ExtensionOptions | null = null;

// Amnesty state
let amnestyReviewedDids: Set<string> = new Set();
let amnestyCandidate: ManagedEntry | null = null;
let amnestySearching = false;

// Sort state
type SortColumn = 'user' | 'source' | 'status' | 'expires' | 'date';
type SortDirection = 'asc' | 'desc';
let sortColumn: SortColumn = 'date';
let sortDirection: SortDirection = 'desc';

// DOM elements
const elements = {
  syncStatus: document.getElementById('sync-status') as HTMLSpanElement,
  syncButton: document.getElementById('sync-now') as HTMLButtonElement,
  totalBlocks: document.getElementById('total-blocks') as HTMLDivElement,
  totalMutes: document.getElementById('total-mutes') as HTMLDivElement,
  tempBlocks: document.getElementById('temp-blocks') as HTMLDivElement,
  tempMutes: document.getElementById('temp-mutes') as HTMLDivElement,
  dataContainer: document.getElementById('data-container') as HTMLDivElement,
  search: document.getElementById('search') as HTMLInputElement,
  filterSource: document.getElementById('filter-source') as HTMLSelectElement,
  bulkActions: document.getElementById('bulk-actions') as HTMLDivElement,
  selectedCount: document.getElementById('selected-count') as HTMLSpanElement,
  bulkRemove: document.getElementById('bulk-remove') as HTMLButtonElement,
};

// ============================================================================
// Data Loading
// ============================================================================

async function loadData(): Promise<void> {
  [allBlocks, allMutes, history, contexts, syncState, amnestyReviewedDids, options] = await Promise.all([
    getAllManagedBlocks(),
    getAllManagedMutes(),
    getActionHistory(),
    getPostContexts(),
    getSyncState(),
    getAmnestyReviewedDids(),
    getOptions(),
  ]);
}

// ============================================================================
// Stats & UI Updates
// ============================================================================

function updateStats(): void {
  elements.totalBlocks.textContent = allBlocks.length.toString();
  elements.totalMutes.textContent = allMutes.length.toString();
  elements.tempBlocks.textContent = allBlocks.filter((b) => b.source === 'ergoblock_temp').length.toString();
  elements.tempMutes.textContent = allMutes.filter((m) => m.source === 'ergoblock_temp').length.toString();
}

function updateSyncStatus(): void {
  if (!syncState) {
    elements.syncStatus.textContent = 'Last synced: Never';
    return;
  }

  // Detect stale "syncing" state - if sync started more than 5 minutes ago, it's likely stale
  const lastSync = Math.max(syncState.lastBlockSync, syncState.lastMuteSync);
  const syncStartedTooLongAgo = syncState.syncInProgress && lastSync > 0 && Date.now() - lastSync > 5 * 60 * 1000;

  if (syncState.syncInProgress && !syncStartedTooLongAgo) {
    elements.syncStatus.textContent = 'Syncing...';
    elements.syncButton.disabled = true;
    return;
  }

  elements.syncButton.disabled = false;

  if (syncState.lastError) {
    elements.syncStatus.textContent = `Sync error: ${syncState.lastError}`;
    return;
  }

  if (lastSync > 0) {
    const ago = formatTimeAgo(lastSync);
    elements.syncStatus.textContent = `Last synced: ${ago}`;
  } else {
    elements.syncStatus.textContent = 'Last synced: Never';
  }
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatTimeRemaining(expiresAt: number): string {
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

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

// ============================================================================
// Filtering & Sorting
// ============================================================================

function getItemHandle<T>(item: T): string {
  if (typeof item === 'object' && item !== null) {
    if ('handle' in item) return (item as ManagedEntry).handle;
    if ('targetHandle' in item) return (item as PostContext).targetHandle;
  }
  return '';
}

function getItemDate<T>(item: T): number {
  if (typeof item === 'object' && item !== null) {
    if ('source' in item) {
      // ManagedEntry
      return (item as ManagedEntry).createdAt || (item as ManagedEntry).syncedAt || 0;
    } else if ('postCreatedAt' in item) {
      // PostContext
      return (item as PostContext).postCreatedAt || (item as PostContext).timestamp || 0;
    } else if ('timestamp' in item) {
      // HistoryEntry
      return (item as HistoryEntry).timestamp || 0;
    }
  }
  return 0;
}

function filterAndSort<T extends ManagedEntry | HistoryEntry | PostContext>(
  items: T[],
  _type: 'blocks' | 'mutes' | 'history' | 'contexts'
): T[] {
  const search = elements.search.value.toLowerCase();
  const filterSource = elements.filterSource.value;

  let filtered = items.filter((item) => {
    // Search filter
    if (search) {
      const handle = getItemHandle(item);
      if (!handle.toLowerCase().includes(search)) return false;
    }

    // Source filter (only for blocks/mutes)
    if (filterSource !== 'all' && 'source' in item) {
      if ((item as ManagedEntry).source !== filterSource) return false;
    }

    return true;
  });

  // Sort based on current column and direction
  const dir = sortDirection === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    let cmp = 0;

    switch (sortColumn) {
      case 'user': {
        const handleA = getItemHandle(a);
        const handleB = getItemHandle(b);
        cmp = handleA.localeCompare(handleB);
        break;
      }
      case 'source': {
        const sourceA = 'source' in a ? (a as ManagedEntry).source : '';
        const sourceB = 'source' in b ? (b as ManagedEntry).source : '';
        cmp = sourceA.localeCompare(sourceB);
        break;
      }
      case 'expires': {
        const expA = 'expiresAt' in a ? ((a as ManagedEntry).expiresAt || Infinity) : Infinity;
        const expB = 'expiresAt' in b ? ((b as ManagedEntry).expiresAt || Infinity) : Infinity;
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

/**
 * Toggle sort on a column. If already sorting by this column, flip direction.
 * Otherwise, sort by this column with default direction.
 */
function toggleSort(column: SortColumn): void {
  if (sortColumn === column) {
    // Flip direction
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    // New column - default to desc for date, asc for others
    sortColumn = column;
    sortDirection = column === 'date' || column === 'expires' ? 'desc' : 'asc';
  }
  renderCurrentTab();
}

/**
 * Get the sort arrow for a column header
 */
function getSortArrow(column: SortColumn): string {
  if (sortColumn !== column) {
    return '<span class="sort-arrow sort-inactive">⇅</span>';
  }
  return sortDirection === 'asc'
    ? '<span class="sort-arrow sort-active">↑</span>'
    : '<span class="sort-arrow sort-active">↓</span>';
}

// ============================================================================
// Rendering
// ============================================================================

// Context lookup map by target DID
let contextMap: Map<string, PostContext> = new Map();

function buildContextMap(): void {
  contextMap.clear();
  for (const ctx of contexts) {
    // Use most recent context per target DID
    const existing = contextMap.get(ctx.targetDid);
    if (!existing || ctx.timestamp > existing.timestamp) {
      contextMap.set(ctx.targetDid, ctx);
    }
  }
}

function renderCurrentTab(): void {
  selectedItems.clear();
  updateBulkActions();
  buildContextMap();

  // Hide toolbar for amnesty tab
  const toolbar = document.querySelector('.toolbar') as HTMLElement;
  if (toolbar) {
    toolbar.style.display = currentTab === 'amnesty' ? 'none' : 'flex';
  }

  switch (currentTab) {
    case 'blocks':
      renderBlocksTable();
      break;
    case 'mutes':
      renderMutesTable();
      break;
    case 'history':
      renderHistoryTable();
      break;
    case 'amnesty':
      renderAmnestyTab();
      break;
  }
}

function renderBlocksTable(): void {
  const filtered = filterAndSort(allBlocks, 'blocks');

  if (filtered.length === 0) {
    elements.dataContainer.innerHTML = `
      <div class="empty-state">
        <h3>No blocks found</h3>
        <p>You haven't blocked anyone yet, or try adjusting your filters.</p>
      </div>
    `;
    return;
  }

  elements.dataContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="select-all"></th>
          <th class="sortable" data-sort="user">User ${getSortArrow('user')}</th>
          <th>Context</th>
          <th class="sortable" data-sort="source">Source ${getSortArrow('source')}</th>
          <th>Status</th>
          <th class="sortable" data-sort="expires">Expires ${getSortArrow('expires')}</th>
          <th class="sortable" data-sort="date">Date ${getSortArrow('date')}</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((block) => renderBlockRow(block)).join('')}
      </tbody>
    </table>
  `;

  setupTableEvents();
}

function renderContextCell(did: string, handle: string, isBlocked: boolean): string {
  const ctx = contextMap.get(did);

  if (!ctx) {
    return `
      <td class="context-col">
        <div class="context-cell">
          <span class="no-context">No context</span>
          <button class="context-btn find-context-btn" data-did="${escapeHtml(did)}" data-handle="${escapeHtml(handle)}">Find</button>
        </div>
      </td>
    `;
  }

  const postUrl = ctx.postUri
    ? ctx.postUri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/')
    : '';
  const isGuessed = ctx.guessed === true;

  // For blocked users, we need a button to temp-unblock. For mutes, direct link is fine.
  let linkHtml = '';
  if (postUrl) {
    if (isBlocked) {
      linkHtml = `<button class="context-btn context-view-btn" data-did="${escapeHtml(ctx.targetDid)}" data-handle="${escapeHtml(ctx.targetHandle)}" data-url="${escapeHtml(postUrl)}">View</button>`;
    } else {
      linkHtml = `<a href="${escapeHtml(postUrl)}" target="_blank" class="context-btn context-link-btn">View</a>`;
    }
  }

  return `
    <td class="context-col">
      <div class="context-cell">
        ${ctx.postText ? `<span class="context-text">${escapeHtml(ctx.postText)}</span>` : '<span class="no-context">No text</span>'}
        <div class="context-meta">
          ${isGuessed ? '<span class="badge badge-guessed" title="Auto-detected">Auto</span>' : ''}
          ${linkHtml}
        </div>
      </div>
    </td>
  `;
}

function getStatusIndicators(viewer: ProfileViewerState | undefined, isBlocksTab: boolean): string {
  const labels: string[] = [];

  // Block status
  if (viewer?.blockedBy) {
    labels.push('<span class="status-label status-blocked-by">Blocking you</span>');
  }

  // Follow status
  const weFollow = !!viewer?.following;
  const theyFollow = !!viewer?.followedBy;
  if (weFollow && theyFollow) {
    labels.push('<span class="status-label status-mutual-follow">Mutual follow</span>');
  } else if (weFollow) {
    labels.push('<span class="status-label status-following">Following</span>');
  } else if (theyFollow) {
    labels.push('<span class="status-label status-followed-by">Follows you</span>');
  }

  // Mute status (only on mutes tab)
  if (!isBlocksTab && viewer?.muted) {
    labels.push('<span class="status-label status-muted">Muted</span>');
  }

  if (labels.length === 0) return '-';
  return `<span class="status-labels">${labels.join('')}</span>`;
}

function renderBlockRow(block: ManagedEntry): string {
  const isTemp = block.source === 'ergoblock_temp';
  const isExpiringSoon = isTemp && block.expiresAt && block.expiresAt - Date.now() < 24 * 60 * 60 * 1000;
  const isMutual = block.viewer?.blockedBy === true;

  return `
    <tr data-did="${block.did}" class="${isMutual ? 'mutual-block' : ''}">
      <td><input type="checkbox" class="row-checkbox" data-did="${block.did}"></td>
      <td class="user-col">
        <div class="user-cell">
          ${block.avatar ? `<img src="${block.avatar}" class="user-avatar" alt="">` : '<div class="user-avatar"></div>'}
          <div class="user-info">
            <span class="user-handle">@${block.handle}</span>
            ${block.displayName ? `<span class="user-display-name">${escapeHtml(block.displayName)}</span>` : ''}
          </div>
        </div>
      </td>
      ${renderContextCell(block.did, block.handle, true)}
      <td>
        <span class="badge ${isTemp ? 'badge-temp' : 'badge-permanent'}">
          ${isTemp ? 'Temp' : 'Perm'}
        </span>
      </td>
      <td>${getStatusIndicators(block.viewer, true)}</td>
      <td>
        ${isTemp && block.expiresAt ? `
          <span class="badge ${isExpiringSoon ? 'badge-expiring' : ''}">
            ${formatTimeRemaining(block.expiresAt)}
          </span>
        ` : '-'}
      </td>
      <td>${block.createdAt ? formatDate(block.createdAt) : block.syncedAt ? formatDate(block.syncedAt) : '-'}</td>
      <td>
        <button class="action-btn danger unblock-btn" data-did="${block.did}" data-handle="${block.handle}">
          Unblock
        </button>
      </td>
    </tr>
  `;
}

function renderMutesTable(): void {
  const filtered = filterAndSort(allMutes, 'mutes');

  if (filtered.length === 0) {
    elements.dataContainer.innerHTML = `
      <div class="empty-state">
        <h3>No mutes found</h3>
        <p>You haven't muted anyone yet, or try adjusting your filters.</p>
      </div>
    `;
    return;
  }

  elements.dataContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="select-all"></th>
          <th class="sortable" data-sort="user">User ${getSortArrow('user')}</th>
          <th>Context</th>
          <th class="sortable" data-sort="source">Source ${getSortArrow('source')}</th>
          <th>Status</th>
          <th class="sortable" data-sort="expires">Expires ${getSortArrow('expires')}</th>
          <th class="sortable" data-sort="date">Date ${getSortArrow('date')}</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((mute) => renderMuteRow(mute)).join('')}
      </tbody>
    </table>
  `;

  setupTableEvents();
}

function renderMuteRow(mute: ManagedEntry): string {
  const isTemp = mute.source === 'ergoblock_temp';
  const isExpiringSoon = isTemp && mute.expiresAt && mute.expiresAt - Date.now() < 24 * 60 * 60 * 1000;
  const weBlockThem = !!mute.viewer?.blocking;
  const theyBlockUs = !!mute.viewer?.blockedBy;
  const rowClass = weBlockThem && theyBlockUs ? 'mutual-block' : theyBlockUs ? 'blocked-by' : weBlockThem ? 'mutual-block' : '';

  return `
    <tr data-did="${mute.did}" class="${rowClass}">
      <td><input type="checkbox" class="row-checkbox" data-did="${mute.did}"></td>
      <td class="user-col">
        <div class="user-cell">
          ${mute.avatar ? `<img src="${mute.avatar}" class="user-avatar" alt="">` : '<div class="user-avatar"></div>'}
          <div class="user-info">
            <span class="user-handle">@${mute.handle}</span>
            ${mute.displayName ? `<span class="user-display-name">${escapeHtml(mute.displayName)}</span>` : ''}
          </div>
        </div>
      </td>
      ${renderContextCell(mute.did, mute.handle, false)}
      <td>
        <span class="badge ${isTemp ? 'badge-temp' : 'badge-permanent'}">
          ${isTemp ? 'Temp' : 'Perm'}
        </span>
      </td>
      <td>${getStatusIndicators(mute.viewer, false)}</td>
      <td>
        ${isTemp && mute.expiresAt ? `
          <span class="badge ${isExpiringSoon ? 'badge-expiring' : ''}">
            ${formatTimeRemaining(mute.expiresAt)}
          </span>
        ` : '-'}
      </td>
      <td>${mute.createdAt ? formatDate(mute.createdAt) : mute.syncedAt ? formatDate(mute.syncedAt) : '-'}</td>
      <td>
        <button class="action-btn danger unmute-btn" data-did="${mute.did}" data-handle="${mute.handle}">
          Unmute
        </button>
      </td>
    </tr>
  `;
}

function renderHistoryTable(): void {
  const filtered = filterAndSort(history, 'history');

  if (filtered.length === 0) {
    elements.dataContainer.innerHTML = `
      <div class="empty-state">
        <h3>No history</h3>
        <p>Your block/mute history will appear here.</p>
      </div>
    `;
    return;
  }

  elements.dataContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th class="sortable" data-sort="user">User ${getSortArrow('user')}</th>
          <th>Action</th>
          <th>Trigger</th>
          <th>Status</th>
          <th class="sortable" data-sort="date">Date ${getSortArrow('date')}</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((entry) => renderHistoryRow(entry)).join('')}
      </tbody>
    </table>
  `;

  setupTableEvents();
}

function renderHistoryRow(entry: HistoryEntry): string {
  const triggerLabels: Record<string, string> = {
    manual: 'Manual',
    auto_expire: 'Auto-expired',
    removed: 'External',
  };

  return `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-info">
            <span class="user-handle">@${entry.handle}</span>
          </div>
        </div>
      </td>
      <td>
        <span class="history-action ${entry.action}">${entry.action}</span>
      </td>
      <td>
        <span class="history-trigger">${triggerLabels[entry.trigger] || entry.trigger}</span>
      </td>
      <td>
        ${entry.success ? '✓' : `✗ ${entry.error || ''}`}
      </td>
      <td>${formatDate(entry.timestamp)}</td>
    </tr>
  `;
}

// ============================================================================
// Amnesty Feature
// ============================================================================

// Forgiveness period options (in days)
const FORGIVENESS_OPTIONS = [
  { value: 30, label: '1 month' },
  { value: 60, label: '2 months' },
  { value: 90, label: '3 months' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
];

/**
 * Get the forgiveness period in milliseconds from options
 */
function getForgivenessPeriodMs(): number {
  const days = options?.forgivenessPeriodDays || 90;
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Get eligible amnesty candidates (blocks and mutes):
 * - Action at least N days ago (based on forgivenessPeriodDays option)
 * - For blocks: not blocking us back
 * - Not previously reviewed by amnesty
 */
function getAmnestyCandidates(): ManagedEntry[] {
  const now = Date.now();
  const cutoff = now - getForgivenessPeriodMs();

  const blockCandidates = allBlocks.filter((block) => {
    // Must be blocked at least N days ago
    const blockDate = block.createdAt || block.syncedAt || now;
    if (blockDate > cutoff) return false;

    // Must not be blocking us
    if (block.viewer?.blockedBy) return false;

    // Must not have been reviewed already
    if (amnestyReviewedDids.has(block.did)) return false;

    return true;
  });

  const muteCandidates = allMutes.filter((mute) => {
    // Must be muted at least N days ago
    const muteDate = mute.createdAt || mute.syncedAt || now;
    if (muteDate > cutoff) return false;

    // Must not have been reviewed already
    if (amnestyReviewedDids.has(mute.did)) return false;

    return true;
  });

  // Combine and return
  return [...blockCandidates, ...muteCandidates];
}

/**
 * Select a random amnesty candidate
 */
function selectRandomCandidate(): ManagedEntry | null {
  const candidates = getAmnestyCandidates();
  if (candidates.length === 0) return null;

  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

/**
 * Render the amnesty tab
 */
async function renderAmnestyTab(): Promise<void> {
  const stats = await getAmnestyStats();
  const candidates = getAmnestyCandidates();
  const currentPeriod = options?.forgivenessPeriodDays || 90;
  const currentPeriodLabel = FORGIVENESS_OPTIONS.find(o => o.value === currentPeriod)?.label || `${currentPeriod} days`;

  // If we have an active candidate being shown, render the card
  if (amnestyCandidate) {
    renderAmnestyCard(amnestyCandidate, stats);
    return;
  }

  // Build forgiveness period options
  const periodOptions = FORGIVENESS_OPTIONS.map(opt =>
    `<option value="${opt.value}" ${opt.value === currentPeriod ? 'selected' : ''}>${opt.label}</option>`
  ).join('');

  // Count blocks vs mutes in candidates
  const blockCount = candidates.filter(c => c.type === 'block').length;
  const muteCount = candidates.filter(c => c.type === 'mute').length;
  const freedCount = stats.unblocked + stats.unmuted;

  // Otherwise, show the intro screen
  elements.dataContainer.innerHTML = `
    <div class="amnesty-container">
      <div class="amnesty-intro">
        <h3>Amnesty</h3>
        <p>Review old blocks and mutes to decide if they still deserve it.</p>
      </div>

      <div class="amnesty-forgiveness">
        <label class="amnesty-forgiveness-label">How long does it take you to forgive?</label>
        <select id="forgiveness-period" class="amnesty-forgiveness-select">
          ${periodOptions}
        </select>
        <p class="amnesty-forgiveness-hint">Only actions older than this will appear. Blocks from users blocking you back are excluded.</p>
      </div>

      <div class="amnesty-stats">
        <div class="amnesty-stat amnesty-stat-primary">
          <div class="amnesty-stat-value">${candidates.length}</div>
          <div class="amnesty-stat-label">Ready for Review</div>
          ${candidates.length > 0 ? `<div class="amnesty-stat-detail">${blockCount} blocks, ${muteCount} mutes</div>` : ''}
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">${stats.totalReviewed}</div>
          <div class="amnesty-stat-label">Reviewed</div>
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">${freedCount}</div>
          <div class="amnesty-stat-label">Freed</div>
        </div>
      </div>

      ${candidates.length > 0 ? `
        <button class="amnesty-start-btn" id="amnesty-start">
          Start Review
        </button>
      ` : `
        <div class="amnesty-empty">
          <h3>No candidates available</h3>
          <p>All eligible entries have been reviewed, or you don't have any blocks/mutes older than ${currentPeriodLabel}.</p>
        </div>
      `}
    </div>
  `;

  // Setup start button
  const startBtn = document.getElementById('amnesty-start');
  if (startBtn) {
    startBtn.addEventListener('click', startAmnestyReview);
  }

  // Setup forgiveness period change handler
  const periodSelect = document.getElementById('forgiveness-period') as HTMLSelectElement;
  if (periodSelect) {
    periodSelect.addEventListener('change', async () => {
      const newPeriod = parseInt(periodSelect.value, 10);
      if (options) {
        options.forgivenessPeriodDays = newPeriod;
        await setOptions(options);
        // Re-render to show updated candidate count
        renderAmnestyTab();
      }
    });
  }
}

/**
 * Start the amnesty review process
 */
async function startAmnestyReview(): Promise<void> {
  amnestyCandidate = selectRandomCandidate();
  if (!amnestyCandidate) {
    renderAmnestyTab();
    return;
  }

  renderAmnestyCard(amnestyCandidate, await getAmnestyStats());

  // Search for context if we don't have it
  const ctx = contextMap.get(amnestyCandidate.did);
  if (!ctx) {
    amnestySearching = true;
    updateAmnestyContext();

    // Request background to find context
    const response = (await browser.runtime.sendMessage({
      type: 'FIND_CONTEXT',
      did: amnestyCandidate.did,
      handle: amnestyCandidate.handle,
    })) as { success: boolean; found?: boolean };

    amnestySearching = false;

    if (response.found) {
      // Reload contexts
      contexts = await getPostContexts();
      buildContextMap();
    }

    updateAmnestyContext();
  }
}

/**
 * Render the amnesty review card for a candidate
 */
async function renderAmnestyCard(
  candidate: ManagedEntry,
  stats: { totalReviewed: number; unblocked: number; keptBlocked: number; unmuted: number; keptMuted: number }
): Promise<void> {
  const ctx = contextMap.get(candidate.did);
  const actionDate = candidate.createdAt || candidate.syncedAt;
  const actionDateStr = actionDate ? new Date(actionDate).toLocaleDateString() : 'Unknown';
  const isBlock = candidate.type === 'block';
  const actionVerb = isBlock ? 'Blocked' : 'Muted';
  const actionVerbLower = isBlock ? 'block' : 'mute';
  const freedCount = stats.unblocked + stats.unmuted;

  const postUrl = ctx?.postUri
    ? ctx.postUri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/')
    : '';

  elements.dataContainer.innerHTML = `
    <div class="amnesty-container">
      <div class="amnesty-stats">
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">${getAmnestyCandidates().length}</div>
          <div class="amnesty-stat-label">Remaining</div>
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">${stats.totalReviewed}</div>
          <div class="amnesty-stat-label">Reviewed</div>
        </div>
        <div class="amnesty-stat">
          <div class="amnesty-stat-value">${freedCount}</div>
          <div class="amnesty-stat-label">Freed</div>
        </div>
      </div>

      <div class="amnesty-card ${isBlock ? 'amnesty-card-block' : 'amnesty-card-mute'}">
        <div class="amnesty-card-header">
          ${candidate.avatar ? `<img src="${candidate.avatar}" class="amnesty-avatar" alt="">` : '<div class="amnesty-avatar"></div>'}
          <div class="amnesty-user-info">
            <div class="amnesty-handle">@${escapeHtml(candidate.handle)}</div>
            ${candidate.displayName ? `<div class="amnesty-display-name">${escapeHtml(candidate.displayName)}</div>` : ''}
            <div class="amnesty-blocked-date">
              <span class="amnesty-type-badge ${isBlock ? 'badge-block' : 'badge-mute'}">${actionVerb}</span>
              on ${actionDateStr}
            </div>
          </div>
        </div>

        <div class="amnesty-card-context" id="amnesty-context">
          <div class="amnesty-context-label">Why did you ${actionVerbLower} them?</div>
          ${amnestySearching ? `
            <div class="amnesty-searching">
              <div class="spinner"></div>
              Searching for interaction...
            </div>
          ` : ctx ? `
            <div class="amnesty-context-text">${escapeHtml(ctx.postText || 'No post text available')}</div>
            ${postUrl ? `
              <div class="amnesty-context-link">
                ${isBlock ? `
                  <button class="context-btn amnesty-view-btn" data-did="${escapeHtml(candidate.did)}" data-handle="${escapeHtml(candidate.handle)}" data-url="${escapeHtml(postUrl)}">View Post</button>
                ` : `
                  <a href="${escapeHtml(postUrl)}" target="_blank" class="context-btn">View Post</a>
                `}
              </div>
            ` : ''}
          ` : `
            <div class="amnesty-no-context">No context found for this ${actionVerbLower}</div>
          `}
        </div>

        <div class="amnesty-card-actions">
          <button class="amnesty-btn ${isBlock ? 'amnesty-btn-unblock' : 'amnesty-btn-unmute'}" id="amnesty-free">
            👍 ${isBlock ? 'Unblock' : 'Unmute'}
          </button>
          <button class="amnesty-btn amnesty-btn-keep" id="amnesty-keep">
            👎 Keep ${actionVerb}
          </button>
        </div>
      </div>
    </div>
  `;

  setupAmnestyEvents();
}

/**
 * Update just the context section of the amnesty card
 */
function updateAmnestyContext(): void {
  if (!amnestyCandidate) return;

  const contextEl = document.getElementById('amnesty-context');
  if (!contextEl) return;

  const ctx = contextMap.get(amnestyCandidate.did);
  const isBlock = amnestyCandidate.type === 'block';
  const actionVerbLower = isBlock ? 'block' : 'mute';
  const postUrl = ctx?.postUri
    ? ctx.postUri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/')
    : '';

  contextEl.innerHTML = `
    <div class="amnesty-context-label">Why did you ${actionVerbLower} them?</div>
    ${amnestySearching ? `
      <div class="amnesty-searching">
        <div class="spinner"></div>
        Searching for interaction...
      </div>
    ` : ctx ? `
      <div class="amnesty-context-text">${escapeHtml(ctx.postText || 'No post text available')}</div>
      ${postUrl ? `
        <div class="amnesty-context-link">
          ${isBlock ? `
            <button class="context-btn amnesty-view-btn" data-did="${escapeHtml(amnestyCandidate.did)}" data-handle="${escapeHtml(amnestyCandidate.handle)}" data-url="${escapeHtml(postUrl)}">View Post</button>
          ` : `
            <a href="${escapeHtml(postUrl)}" target="_blank" class="context-btn">View Post</a>
          `}
        </div>
      ` : ''}
    ` : `
      <div class="amnesty-no-context">No context found for this ${actionVerbLower}</div>
    `}
  `;

  // Re-setup view button (only for blocks, mutes can link directly)
  if (isBlock) {
    const viewBtn = document.querySelector('.amnesty-view-btn') as HTMLButtonElement;
    if (viewBtn) {
      viewBtn.addEventListener('click', async () => {
        const did = viewBtn.dataset.did;
        const handle = viewBtn.dataset.handle;
        const url = viewBtn.dataset.url;
        if (did && handle && url) {
          await handleTempUnblockAndView(did, handle, url, viewBtn);
        }
      });
    }
  }
}

/**
 * Setup event listeners for amnesty card
 */
function setupAmnestyEvents(): void {
  const freeBtn = document.getElementById('amnesty-free');
  const keepBtn = document.getElementById('amnesty-keep');
  const viewBtn = document.querySelector('.amnesty-view-btn') as HTMLButtonElement;
  const isBlock = amnestyCandidate?.type === 'block';

  if (freeBtn) {
    freeBtn.addEventListener('click', () => {
      handleAmnestyDecision(isBlock ? 'unblocked' : 'unmuted');
    });
  }

  if (keepBtn) {
    keepBtn.addEventListener('click', () => {
      handleAmnestyDecision(isBlock ? 'kept_blocked' : 'kept_muted');
    });
  }

  // View button only exists for blocks (mutes use a direct link)
  if (viewBtn && isBlock) {
    viewBtn.addEventListener('click', async () => {
      const did = viewBtn.dataset.did;
      const handle = viewBtn.dataset.handle;
      const url = viewBtn.dataset.url;
      if (did && handle && url) {
        await handleTempUnblockAndView(did, handle, url, viewBtn);
      }
    });
  }
}

/**
 * Handle amnesty decision (unblock/unmute or keep blocked/muted)
 */
async function handleAmnestyDecision(decision: 'unblocked' | 'unmuted' | 'kept_blocked' | 'kept_muted'): Promise<void> {
  if (!amnestyCandidate) return;

  const freeBtn = document.getElementById('amnesty-free') as HTMLButtonElement;
  const keepBtn = document.getElementById('amnesty-keep') as HTMLButtonElement;

  // Disable buttons
  if (freeBtn) freeBtn.disabled = true;
  if (keepBtn) keepBtn.disabled = true;

  const isBlock = amnestyCandidate.type === 'block';
  const review: AmnestyReview = {
    did: amnestyCandidate.did,
    handle: amnestyCandidate.handle,
    reviewedAt: Date.now(),
    type: isBlock ? 'block' : 'mute',
    decision,
  };

  try {
    // Record the review
    await addAmnestyReview(review);
    amnestyReviewedDids.add(amnestyCandidate.did);

    // If freeing, actually unblock/unmute them
    if (decision === 'unblocked') {
      await handleUnblock(amnestyCandidate.did);
    } else if (decision === 'unmuted') {
      await handleUnmute(amnestyCandidate.did);
    }

    // Move to next candidate
    amnestyCandidate = null;
    await loadData();
    startAmnestyReview();
  } catch (error) {
    console.error('[Manager] Amnesty decision failed:', error);
    alert('Failed to process decision');
    if (freeBtn) freeBtn.disabled = false;
    if (keepBtn) keepBtn.disabled = false;
  }
}

// Track active temp unblock timers by DID
const tempUnblockTimers: Map<string, { timerId: number; expiresAt: number }> = new Map();

// ============================================================================
// Event Handlers
// ============================================================================

function setupTableEvents(): void {
  // Sortable column headers
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.sort as SortColumn;
      if (col) {
        toggleSort(col);
      }
    });
  });

  // Select all checkbox
  const selectAll = document.getElementById('select-all') as HTMLInputElement;
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const checkboxes = document.querySelectorAll('.row-checkbox') as NodeListOf<HTMLInputElement>;
      checkboxes.forEach((cb) => {
        cb.checked = selectAll.checked;
        const did = cb.dataset.did;
        if (did) {
          if (selectAll.checked) {
            selectedItems.add(did);
          } else {
            selectedItems.delete(did);
          }
        }
      });
      updateBulkActions();
    });
  }

  // Row checkboxes
  document.querySelectorAll('.row-checkbox').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const did = target.dataset.did;
      if (did) {
        if (target.checked) {
          selectedItems.add(did);
        } else {
          selectedItems.delete(did);
        }
      }
      updateBulkActions();
    });
  });

  // Unblock buttons
  document.querySelectorAll('.unblock-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement;
      const did = target.dataset.did;
      const handle = target.dataset.handle;
      if (did && confirm(`Unblock @${handle}?`)) {
        await handleUnblock(did);
      }
    });
  });

  // Unmute buttons
  document.querySelectorAll('.unmute-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement;
      const did = target.dataset.did;
      const handle = target.dataset.handle;
      if (did && confirm(`Unmute @${handle}?`)) {
        await handleUnmute(did);
      }
    });
  });

  // View post buttons (temp unblock for blocked users)
  document.querySelectorAll('.view-post-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement;
      const did = target.dataset.did;
      const handle = target.dataset.handle;
      const url = target.dataset.url;

      if (did && handle && url) {
        await handleTempUnblockAndView(did, handle, url, target);
      }
    });
  });

  // Context pane unblock buttons
  document.querySelectorAll('.context-unblock-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement;
      const did = target.dataset.did;
      const handle = target.dataset.handle;
      if (did && confirm(`Unblock @${handle}?`)) {
        await handleUnblock(did);
      }
    });
  });

  // Context pane unmute buttons
  document.querySelectorAll('.context-unmute-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement;
      const did = target.dataset.did;
      const handle = target.dataset.handle;
      if (did && confirm(`Unmute @${handle}?`)) {
        await handleUnmute(did);
      }
    });
  });

  // Find context buttons
  document.querySelectorAll('.find-context-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement;
      const did = target.dataset.did;
      const handle = target.dataset.handle;
      if (did && handle) {
        await handleFindContext(did, handle, target);
      }
    });
  });

  // Context view buttons (temp unblock to view post)
  document.querySelectorAll('.context-view-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement;
      const did = target.dataset.did;
      const handle = target.dataset.handle;
      const url = target.dataset.url;

      if (did && handle && url) {
        await handleTempUnblockAndView(did, handle, url, target);
      }
    });
  });

  // Update countdown timers for any active temp unblocks
  updateCountdownTimers();
}

// ============================================================================
// Temp Unblock for Viewing
// ============================================================================

const TEMP_UNBLOCK_DURATION = 60 * 1000; // 60 seconds

/**
 * Temporarily unblock a user so we can view their post, then re-block
 */
async function handleTempUnblockAndView(
  did: string,
  handle: string,
  url: string,
  button: HTMLButtonElement
): Promise<void> {
  // Check if already temp unblocked
  if (tempUnblockTimers.has(did)) {
    // Already unblocked, just open the URL
    window.open(url, '_blank');
    return;
  }

  // Disable button and show loading state
  button.disabled = true;
  button.textContent = 'Unblocking...';

  try {
    // Request background to unblock
    const response = await browser.runtime.sendMessage({
      type: 'TEMP_UNBLOCK_FOR_VIEW',
      did,
      handle,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to unblock');
    }

    // Open the URL
    window.open(url, '_blank');

    // Track the temp unblock
    const expiresAt = Date.now() + TEMP_UNBLOCK_DURATION;
    const timerId = window.setTimeout(async () => {
      // Re-block the user
      await reblockUser(did, handle, button);
    }, TEMP_UNBLOCK_DURATION);

    tempUnblockTimers.set(did, { timerId, expiresAt });

    // Update button to show countdown
    button.classList.add('temp-unblocked');
    updateCountdownTimers();

  } catch (error) {
    console.error('[Manager] Temp unblock failed:', error);
    alert(`Failed to unblock: ${error instanceof Error ? error.message : 'Unknown error'}`);
    button.disabled = false;
    button.textContent = 'View Post';
  }
}

/**
 * Re-block a user after temp unblock period
 */
async function reblockUser(did: string, handle: string, button: HTMLButtonElement): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'REBLOCK_USER',
      did,
      handle,
    });

    if (!response.success) {
      console.error('[Manager] Reblock failed:', response.error);
    }
  } catch (error) {
    console.error('[Manager] Reblock error:', error);
  } finally {
    // Clean up timer state
    tempUnblockTimers.delete(did);

    // Reset button
    button.classList.remove('temp-unblocked');
    button.disabled = false;
    button.textContent = 'View Post';
  }
}

/**
 * Update countdown timers for all active temp unblocks
 */
function updateCountdownTimers(): void {
  const now = Date.now();

  for (const [did, { expiresAt }] of tempUnblockTimers) {
    const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
    const countdown = document.querySelector(`.countdown[data-did="${did}"]`);

    if (countdown) {
      if (remaining > 0) {
        countdown.textContent = `Re-blocking in ${remaining}s`;
      } else {
        countdown.textContent = 'Re-blocking...';
      }
    }
  }

  // Schedule next update if there are active timers
  if (tempUnblockTimers.size > 0) {
    requestAnimationFrame(() => {
      setTimeout(updateCountdownTimers, 100);
    });
  }
}

function updateBulkActions(): void {
  const count = selectedItems.size;
  if (count > 0) {
    elements.bulkActions.style.display = 'flex';
    elements.selectedCount.textContent = `${count} selected`;
  } else {
    elements.bulkActions.style.display = 'none';
  }
}

async function handleUnblock(did: string): Promise<void> {
  try {
    // Remove from local storage first
    await removeTempBlock(did);

    // Request background to unblock via API
    const response = await browser.runtime.sendMessage({ type: 'UNBLOCK_USER', did });
    if (!response.success) {
      console.error('[Manager] Unblock failed:', response.error);
      alert(`Failed to unblock: ${response.error}`);
    }

    // Reload data
    await loadData();
    updateStats();
    renderCurrentTab();
  } catch (error) {
    console.error('[Manager] Unblock error:', error);
    alert('Failed to unblock user');
  }
}

async function handleUnmute(did: string): Promise<void> {
  try {
    // Remove from local storage first
    await removeTempMute(did);

    // Request background to unmute via API
    const response = await browser.runtime.sendMessage({ type: 'UNMUTE_USER', did });
    if (!response.success) {
      console.error('[Manager] Unmute failed:', response.error);
      alert(`Failed to unmute: ${response.error}`);
    }

    // Reload data
    await loadData();
    updateStats();
    renderCurrentTab();
  } catch (error) {
    console.error('[Manager] Unmute error:', error);
    alert('Failed to unmute user');
  }
}

async function handleBulkRemove(): Promise<void> {
  const count = selectedItems.size;
  if (count === 0) return;

  const type = currentTab === 'blocks' ? 'unblock' : 'unmute';
  if (!confirm(`${type === 'unblock' ? 'Unblock' : 'Unmute'} ${count} users?`)) return;

  for (const did of selectedItems) {
    if (type === 'unblock') {
      await handleUnblock(did);
    } else {
      await handleUnmute(did);
    }
  }

  selectedItems.clear();
  updateBulkActions();
}

async function handleFindContext(did: string, handle: string, button: HTMLButtonElement): Promise<void> {
  // Disable button and show searching state
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Searching...';

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'FIND_CONTEXT',
      did,
      handle,
    })) as { success: boolean; error?: string; found?: boolean };

    if (!response.success) {
      throw new Error(response.error || 'Failed to search');
    }

    if (response.found) {
      // Reload data to show the new context
      await loadData();
      renderCurrentTab();
    } else {
      // No context found - show message and keep button visible
      button.textContent = 'Not Found';
      button.disabled = true;
      // Reset after 2 seconds
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 2000);
    }
  } catch (error) {
    console.error('[Manager] Find context failed:', error);
    button.textContent = 'Error';
    // Reset after 2 seconds
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 2000);
  }
}

async function handleSync(): Promise<void> {
  elements.syncButton.disabled = true;
  elements.syncStatus.textContent = 'Syncing...';

  try {
    const response = await browser.runtime.sendMessage({ type: 'SYNC_NOW' });
    if (response.success) {
      await loadData();
      updateStats();
      updateSyncStatus();
      renderCurrentTab();
    } else {
      elements.syncStatus.textContent = `Sync failed: ${response.error}`;
    }
  } catch (error) {
    console.error('[Manager] Sync error:', error);
    elements.syncStatus.textContent = 'Sync failed';
  } finally {
    elements.syncButton.disabled = false;
  }
}

// ============================================================================
// CSV Export
// ============================================================================

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportBlocksCSV(): void {
  const headers = ['DID', 'Handle', 'Display Name', 'Source', 'Expires At', 'Created At'];
  const rows = allBlocks.map((b) => [
    b.did,
    b.handle,
    b.displayName || '',
    b.source,
    b.expiresAt ? new Date(b.expiresAt).toISOString() : '',
    b.createdAt ? new Date(b.createdAt).toISOString() : b.syncedAt ? new Date(b.syncedAt).toISOString() : '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(',')).join('\n');
  downloadCSV(csv, `ergoblock-blocks-${Date.now()}.csv`);
}

function exportMutesCSV(): void {
  const headers = ['DID', 'Handle', 'Display Name', 'Source', 'Expires At', 'Created At'];
  const rows = allMutes.map((m) => [
    m.did,
    m.handle,
    m.displayName || '',
    m.source,
    m.expiresAt ? new Date(m.expiresAt).toISOString() : '',
    m.createdAt ? new Date(m.createdAt).toISOString() : m.syncedAt ? new Date(m.syncedAt).toISOString() : '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(',')).join('\n');
  downloadCSV(csv, `ergoblock-mutes-${Date.now()}.csv`);
}

function exportHistoryCSV(): void {
  const headers = ['DID', 'Handle', 'Action', 'Timestamp', 'Trigger', 'Success', 'Error', 'Duration'];
  const rows = history.map((h) => [
    h.did,
    h.handle,
    h.action,
    new Date(h.timestamp).toISOString(),
    h.trigger,
    h.success ? 'Yes' : 'No',
    h.error || '',
    h.duration ? Math.round(h.duration / 1000 / 60).toString() + ' min' : '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(',')).join('\n');
  downloadCSV(csv, `ergoblock-history-${Date.now()}.csv`);
}

function exportContextsCSV(): void {
  const headers = ['Post URI', 'Post Author', 'Target Handle', 'Target DID', 'Action', 'Permanent', 'Auto-detected', 'Timestamp', 'Post Text'];
  const rows = contexts.map((c) => [
    c.postUri,
    c.postAuthorHandle || c.postAuthorDid,
    c.targetHandle,
    c.targetDid,
    c.actionType,
    c.permanent ? 'Yes' : 'No',
    c.guessed ? 'Yes' : 'No',
    new Date(c.timestamp).toISOString(),
    c.postText || '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(',')).join('\n');
  downloadCSV(csv, `ergoblock-contexts-${Date.now()}.csv`);
}

function exportAllJSON(): void {
  const data = {
    blocks: allBlocks,
    mutes: allMutes,
    history,
    contexts,
    exportedAt: new Date().toISOString(),
  };
  downloadJSON(data, `ergoblock-export-${Date.now()}.json`);
}

// ============================================================================
// Initialization
// ============================================================================

async function init(): Promise<void> {
  // Load data
  await loadData();
  updateStats();
  updateSyncStatus();
  renderCurrentTab();

  // Tab switching
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const newTab = target.dataset.tab;
      if (newTab && newTab !== currentTab) {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        target.classList.add('active');
        currentTab = newTab;
        renderCurrentTab();
      }
    });
  });

  // Search/filter
  elements.search.addEventListener('input', () => renderCurrentTab());
  elements.filterSource.addEventListener('change', () => renderCurrentTab());

  // Sync button
  elements.syncButton.addEventListener('click', handleSync);

  // Bulk remove
  elements.bulkRemove.addEventListener('click', handleBulkRemove);

  // Export buttons
  document.getElementById('export-blocks-csv')?.addEventListener('click', exportBlocksCSV);
  document.getElementById('export-mutes-csv')?.addEventListener('click', exportMutesCSV);
  document.getElementById('export-history-csv')?.addEventListener('click', exportHistoryCSV);
  document.getElementById('export-contexts-csv')?.addEventListener('click', exportContextsCSV);
  document.getElementById('export-all-json')?.addEventListener('click', exportAllJSON);

  // Auto-refresh every 30 seconds
  setInterval(async () => {
    await loadData();
    updateStats();
    updateSyncStatus();
  }, 30000);
}

init();
