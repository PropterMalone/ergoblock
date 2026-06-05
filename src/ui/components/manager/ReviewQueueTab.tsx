import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  Clock,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  List,
  LayoutGrid,
  Shield,
} from 'lucide-preact';
import type { PermanentBlockMute } from '../../../types.js';
import { send } from '../../../platform/messages.js';
import {
  unreviewedItems,
  reviewQueueCurrentIndex,
  reviewQueueViewMode,
  reviewQueueNext,
  reviewQueuePrevious,
  reviewQueueResetIndex,
  reviewQueueToggleViewMode,
  reviewQueueToggleSelection,
  reviewQueueSelectAll,
  reviewQueueClearSelection,
  reviewQueueSelectedItems,
  permanentBlocksRaw,
  permanentMutesRaw,
} from '../../signals/manager.js';

type ReviewableItem = PermanentBlockMute & { actionType: 'block' | 'mute' };

interface ReviewQueueTabProps {
  onReload: () => Promise<void>;
}

const DURATION_OPTIONS = [
  { label: '1 Day', value: 1 * 24 * 60 * 60 * 1000 },
  { label: '7 Days', value: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 Days', value: 30 * 24 * 60 * 60 * 1000 },
];

export function ReviewQueueTab({ onReload }: ReviewQueueTabProps): JSX.Element {
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<'user' | 'type' | 'detected'>('detected');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const items = unreviewedItems.value;
  const totalItems = items.length;
  const currentIndex = reviewQueueCurrentIndex.value;
  const currentItem: ReviewableItem | null = items[currentIndex] || null;

  // Count untracked (grandfathered) items that could be backfilled
  const untrackedCount = [
    ...Object.values(permanentBlocksRaw.value),
    ...Object.values(permanentMutesRaw.value),
  ].filter((item) => item.source === undefined).length;

  // Clamp index when items shrink
  useEffect(() => {
    if (currentIndex >= totalItems && totalItems > 0) {
      reviewQueueResetIndex();
    }
  }, [totalItems, currentIndex]);

  // ── Action handlers ────────────────────────────────────────────────────

  const handleAssignDuration = async (
    duration: number,
    targetDid?: string,
    targetActionType?: 'block' | 'mute'
  ) => {
    const did = targetDid || currentItem?.did;
    const item = targetActionType
      ? items.find((i) => i.did === did && i.actionType === targetActionType)
      : items.find((i) => i.did === did);
    if (!item) return;

    setProcessing('assign');
    setError(null);

    try {
      const response = await send('ASSIGN_DURATION_TO_PERMANENT', {
        did: item.did,
        actionType: item.actionType,
        duration,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to assign duration');
      }

      // Advance only in card view
      if (!targetDid) {
        if (currentIndex < totalItems - 1) reviewQueueNext();
        else reviewQueueResetIndex();
      }

      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign duration');
    } finally {
      setProcessing(null);
    }
  };

  const handleMarkPermanent = async (targetDid?: string, targetActionType?: 'block' | 'mute') => {
    const did = targetDid || currentItem?.did;
    const item = targetActionType
      ? items.find((i) => i.did === did && i.actionType === targetActionType)
      : items.find((i) => i.did === did);
    if (!item) return;

    setProcessing('permanent');
    setError(null);

    try {
      const response = await send('MARK_PERMANENT_REVIEWED', {
        did: item.did,
        actionType: item.actionType,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to mark as permanent');
      }

      if (!targetDid) {
        if (currentIndex < totalItems - 1) reviewQueueNext();
        else reviewQueueResetIndex();
      }

      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as permanent');
    } finally {
      setProcessing(null);
    }
  };

  const handleDismiss = async (targetDid?: string, targetActionType?: 'block' | 'mute') => {
    const did = targetDid || currentItem?.did;
    const item = targetActionType
      ? items.find((i) => i.did === did && i.actionType === targetActionType)
      : items.find((i) => i.did === did);
    if (!item) return;

    setProcessing('dismiss');
    setError(null);

    try {
      const response = await send('DISMISS_REVIEW', {
        did: item.did,
        actionType: item.actionType,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to dismiss');
      }

      if (!targetDid) {
        if (currentIndex < totalItems - 1) reviewQueueNext();
        else reviewQueueResetIndex();
      }

      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss');
    } finally {
      setProcessing(null);
    }
  };

  // ── Bulk actions ───────────────────────────────────────────────────────

  const handleBulkAction = async (
    action: 'assign' | 'permanent' | 'dismiss',
    duration?: number
  ) => {
    const selectedKeys = Array.from(reviewQueueSelectedItems.value);
    if (selectedKeys.length === 0) return;

    setProcessing(`bulk-${action}`);
    setError(null);

    try {
      const promises = selectedKeys.map((key) => {
        const sep = key.lastIndexOf(':');
        const did = key.slice(0, sep);
        const actionType = key.slice(sep + 1) as 'block' | 'mute';
        const item = items.find((i) => i.did === did && i.actionType === actionType);
        if (!item) return Promise.resolve({ success: false });

        if (action === 'assign' && duration) {
          return send('ASSIGN_DURATION_TO_PERMANENT', {
            did: item.did,
            actionType: item.actionType,
            duration,
          });
        } else if (action === 'permanent') {
          return send('MARK_PERMANENT_REVIEWED', {
            did: item.did,
            actionType: item.actionType,
          });
        } else {
          return send('DISMISS_REVIEW', {
            did: item.did,
            actionType: item.actionType,
          });
        }
      });

      const results = await Promise.all(promises);
      const failures = results.filter((r) => !r.success);
      if (failures.length > 0) {
        throw new Error(`Failed for ${failures.length} of ${selectedKeys.length} items`);
      }

      reviewQueueClearSelection();
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk action failed');
    } finally {
      setProcessing(null);
    }
  };

  // ── Backfill ────────────────────────────────────────────────────────

  const handleBackfill = async () => {
    setProcessing('backfill');
    setError(null);

    try {
      const response = await send('BACKFILL_REVIEW_QUEUE');

      if (!response.success) {
        throw new Error(response.error || 'Backfill failed');
      }

      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setProcessing(null);
    }
  };

  // ── Sorting (table view) ──────────────────────────────────────────────

  const getSortedItems = (): ReviewableItem[] => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'user':
          cmp = (a.displayName || a.handle).localeCompare(b.displayName || b.handle);
          break;
        case 'type':
          cmp = a.actionType.localeCompare(b.actionType);
          break;
        case 'detected':
          cmp = a.syncedAt - b.syncedAt;
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  };

  const handleSort = (column: 'user' | 'type' | 'detected') => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // ── Empty states ──────────────────────────────────────────────────────

  const hasAnyPermanent =
    Object.keys(permanentBlocksRaw.value).length > 0 ||
    Object.keys(permanentMutesRaw.value).length > 0;

  if (!hasAnyPermanent) {
    return (
      <div class="review-queue-container">
        {renderHeader()}
        <div class="empty-state empty-state-first-run">
          <Shield size={64} />
          <h3>No blocks or mutes yet</h3>
          <p>
            When you block or mute someone outside ErgoBlock (e.g., via the Bluesky app), they'll
            appear here for you to review and optionally assign expiration times.
          </p>
          <div class="empty-state-hint">
            <AlertCircle size={16} />
            <span>
              ErgoBlock detects external blocks automatically during sync (every 60 minutes).
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (totalItems === 0) {
    return (
      <div class="review-queue-container">
        {renderHeader()}
        <div class="empty-state empty-state-all-reviewed">
          <Check size={64} />
          <h3>All caught up!</h3>
          <p>
            All external blocks and mutes have been reviewed. New items will appear here
            automatically when ErgoBlock detects blocks created outside the extension.
          </p>
          <div class="empty-state-stats">
            <div class="empty-state-stat">
              <span class="empty-state-stat-value">
                {Object.keys(permanentBlocksRaw.value).length}
              </span>
              <span class="empty-state-stat-label">Total Blocks</span>
            </div>
            <div class="empty-state-stat">
              <span class="empty-state-stat-value">
                {Object.keys(permanentMutesRaw.value).length}
              </span>
              <span class="empty-state-stat-label">Total Mutes</span>
            </div>
          </div>
          {untrackedCount > 0 && (
            <div class="empty-state-backfill">
              <p>
                {untrackedCount} permanent {untrackedCount === 1 ? 'item was' : 'items were'}{' '}
                created before ErgoBlock started tracking sources.
              </p>
              <button
                class="btn btn-secondary"
                onClick={handleBackfill}
                disabled={processing !== null}
              >
                {processing === 'backfill'
                  ? 'Reviewing...'
                  : `Review ${untrackedCount} untracked items`}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render helpers ────────────────────────────────────────────────────

  function renderHeader(): JSX.Element {
    return (
      <div class="review-queue-header">
        <div class="review-queue-header-left">
          <h2>Review Queue</h2>
          <p class="review-queue-subtitle">Review blocks and mutes created outside ErgoBlock</p>
        </div>
        {totalItems > 0 && (
          <div class="review-queue-header-right">
            <button
              class="btn btn-secondary btn-sm"
              onClick={() => reviewQueueToggleViewMode()}
              title={
                reviewQueueViewMode.value === 'card'
                  ? 'Switch to Table View'
                  : 'Switch to Card View'
              }
            >
              {reviewQueueViewMode.value === 'card' ? (
                <>
                  <List size={16} />
                  <span>Table View</span>
                </>
              ) : (
                <>
                  <LayoutGrid size={16} />
                  <span>Card View</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderCardView(): JSX.Element {
    if (!currentItem) return <></>;

    return (
      <div class="review-queue-card">
        <div class="review-queue-card-header">
          <span class={`badge badge-${currentItem.actionType}`}>{currentItem.actionType}</span>
          <span class="review-queue-counter">
            {currentIndex + 1} / {totalItems}
          </span>
        </div>

        <div class="review-queue-card-body">
          <div class="review-queue-user">
            {currentItem.avatar && <img src={currentItem.avatar} alt="" class="avatar" />}
            <div class="review-queue-user-info">
              <div class="review-queue-user-name">
                {currentItem.displayName || currentItem.handle}
              </div>
              <div class="review-queue-user-handle">@{currentItem.handle}</div>
            </div>
          </div>

          <div class="review-queue-meta">
            <AlertCircle size={16} />
            <span>Detected externally {new Date(currentItem.syncedAt).toLocaleDateString()}</span>
          </div>
        </div>

        <div class="review-queue-actions">
          <div class="review-queue-action-group">
            <label class="review-queue-action-label">Assign Duration:</label>
            <div class="review-queue-duration-buttons">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  class="btn btn-primary"
                  onClick={() => handleAssignDuration(opt.value)}
                  disabled={processing !== null}
                >
                  <Clock size={16} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div class="review-queue-action-row">
            <button
              class="btn btn-secondary"
              onClick={() => handleMarkPermanent()}
              disabled={processing !== null}
            >
              <Check size={16} />
              <span>Keep Permanent</span>
            </button>
            <button
              class="btn btn-ghost"
              onClick={() => handleDismiss()}
              disabled={processing !== null}
            >
              <X size={16} />
              <span>Dismiss</span>
            </button>
          </div>
        </div>

        <div class="review-queue-navigation">
          <button
            class="btn btn-icon"
            onClick={() => reviewQueuePrevious()}
            disabled={currentIndex === 0}
            title="Previous"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            class="btn btn-icon"
            onClick={() => reviewQueueNext()}
            disabled={currentIndex >= totalItems - 1}
            title="Next"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    );
  }

  function renderTableView(): JSX.Element {
    const sorted = getSortedItems();
    const selectedCount = reviewQueueSelectedItems.value.size;

    return (
      <div class="review-queue-table-container">
        {selectedCount > 0 && (
          <div class="review-queue-bulk-toolbar">
            <span class="review-queue-bulk-count">{selectedCount} selected</span>
            <div class="review-queue-bulk-actions">
              <button
                class="btn btn-primary btn-sm"
                onClick={() => handleBulkAction('assign', 7 * 24 * 60 * 60 * 1000)}
                disabled={processing !== null}
              >
                <Clock size={16} />
                <span>Assign 7 Days</span>
              </button>
              <button
                class="btn btn-secondary btn-sm"
                onClick={() => handleBulkAction('permanent')}
                disabled={processing !== null}
              >
                <Check size={16} />
                <span>Keep All Permanent</span>
              </button>
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => handleBulkAction('dismiss')}
                disabled={processing !== null}
              >
                <X size={16} />
                <span>Dismiss All</span>
              </button>
              <button class="btn btn-ghost btn-sm" onClick={() => reviewQueueClearSelection()}>
                Clear Selection
              </button>
            </div>
          </div>
        )}

        <table class="review-queue-table">
          <thead>
            <tr>
              <th class="review-queue-table-checkbox">
                <input
                  type="checkbox"
                  checked={sorted.length > 0 && selectedCount === sorted.length}
                  onChange={(e) => {
                    if ((e.target as HTMLInputElement).checked) reviewQueueSelectAll();
                    else reviewQueueClearSelection();
                  }}
                  title="Select all"
                />
              </th>
              <th
                class={`review-queue-table-sortable ${sortColumn === 'user' ? 'sorted' : ''}`}
                onClick={() => handleSort('user')}
              >
                User
              </th>
              <th
                class={`review-queue-table-sortable ${sortColumn === 'type' ? 'sorted' : ''}`}
                onClick={() => handleSort('type')}
              >
                Type
              </th>
              <th
                class={`review-queue-table-sortable ${sortColumn === 'detected' ? 'sorted' : ''}`}
                onClick={() => handleSort('detected')}
              >
                Detected
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={`${item.did}-${item.actionType}`} class="review-queue-table-row">
                <td class="review-queue-table-checkbox">
                  <input
                    type="checkbox"
                    checked={reviewQueueSelectedItems.value.has(`${item.did}:${item.actionType}`)}
                    onChange={() => reviewQueueToggleSelection(item.did, item.actionType)}
                  />
                </td>
                <td class="review-queue-table-user">
                  {item.avatar && <img src={item.avatar} alt="" class="avatar-sm" />}
                  <div class="review-queue-table-user-info">
                    <div class="review-queue-table-user-name">
                      {item.displayName || item.handle}
                    </div>
                    <div class="review-queue-table-user-handle">@{item.handle}</div>
                  </div>
                </td>
                <td>
                  <span class={`badge badge-${item.actionType}`}>{item.actionType}</span>
                </td>
                <td class="review-queue-table-date">
                  {new Date(item.syncedAt).toLocaleDateString()}
                </td>
                <td class="review-queue-table-actions">
                  <button
                    class="btn btn-primary btn-xs"
                    onClick={() =>
                      handleAssignDuration(7 * 24 * 60 * 60 * 1000, item.did, item.actionType)
                    }
                    disabled={processing !== null}
                    title="Assign 7 days"
                  >
                    7d
                  </button>
                  <button
                    class="btn btn-secondary btn-xs"
                    onClick={() => handleMarkPermanent(item.did, item.actionType)}
                    disabled={processing !== null}
                    title="Keep permanent"
                  >
                    Keep
                  </button>
                  <button
                    class="btn btn-ghost btn-xs"
                    onClick={() => handleDismiss(item.did, item.actionType)}
                    disabled={processing !== null}
                    title="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────

  return (
    <div class="review-queue-container">
      {renderHeader()}

      {reviewQueueViewMode.value === 'card' ? renderCardView() : renderTableView()}

      {error && (
        <div class="error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}
    </div>
  );
}
