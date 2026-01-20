import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Trash2,
  CheckSquare,
  Square,
  RefreshCw,
  Database,
  Loader2,
} from 'lucide-preact';
import type { MassOperationCluster, GraphOperation, ProfileWithViewer } from '../../types.js';
import {
  massOpsLoading,
  massOpsProgress,
  massOpsScanResult,
  massOpsSettings,
  massOpsExpandedClusters,
  massOpsSelectedItems,
  toggleMassOpsClusterExpanded,
  initMassOpsClusterSelection,
  toggleMassOpsItemSelection,
  selectAllMassOpsItems,
  deselectAllMassOpsItems,
  getMassOpsSelectedItems,
  carCacheStatus,
  carDownloadProgress,
  carEstimatedSize,
  type CarCacheStatusInfo,
  type CarProgressInfo,
} from '../../signals/manager.js';
import { getMassOpsScanResult, setMassOpsSettings, STORAGE_KEYS } from '../../storage.js';
import { formatDate } from './utils.js';
import browser from '../../browser.js';

/**
 * Fetch profiles via background worker (has access to auth)
 */
async function fetchProfilesViaBackground(dids: string[]): Promise<Map<string, ProfileWithViewer>> {
  const response = (await browser.runtime.sendMessage({
    type: 'GET_PROFILES_BATCHED',
    dids,
  })) as { success: boolean; profiles?: Record<string, ProfileWithViewer>; error?: string };

  if (!response.success) {
    throw new Error(response.error || 'Failed to fetch profiles');
  }

  // Convert object back to Map
  const map = new Map<string, ProfileWithViewer>();
  if (response.profiles) {
    for (const [did, profile] of Object.entries(response.profiles)) {
      map.set(did, profile);
    }
  }
  return map;
}

interface MassOpsTabProps {
  onReload: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return 'just now';
}

export function MassOpsTab({ onReload: _onReload }: MassOpsTabProps): JSX.Element {
  const [undoing, setUndoing] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [checkingCache, setCheckingCache] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissedClusters, setDismissedClusters] = useState<
    Array<{ type: string; startTime: number; endTime: number; count: number; dismissedAt: number }>
  >([]);

  const loading = massOpsLoading.value;
  const progress = massOpsProgress.value;
  const scanResult = massOpsScanResult.value;
  const settings = massOpsSettings.value;
  const cacheStatus = carCacheStatus.value;
  const downloadProgress = carDownloadProgress.value;
  const estimatedSize = carEstimatedSize.value;

  // Listen for storage changes to update progress in real-time
  useEffect(() => {
    const handleStorageChange = (
      changes: { [key: string]: browser.Storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes[STORAGE_KEYS.CAR_DOWNLOAD_PROGRESS]) {
        const newProgress = changes[STORAGE_KEYS.CAR_DOWNLOAD_PROGRESS].newValue as
          | CarProgressInfo
          | undefined;
        carDownloadProgress.value = newProgress || null;
        if (newProgress) {
          massOpsProgress.value = newProgress.message;
        }
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Check cache status on mount
  useEffect(() => {
    checkCacheStatus();
  }, []);

  const checkCacheStatus = async () => {
    setCheckingCache(true);
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'CHECK_CAR_CACHE_STATUS',
      })) as { success: boolean; status?: CarCacheStatusInfo; error?: string };

      if (result.success && result.status) {
        carCacheStatus.value = result.status;
      }

      // Also get estimated size if no cache
      if (!result.status?.hasCached || result.status?.isStale) {
        const sizeResult = (await browser.runtime.sendMessage({
          type: 'ESTIMATE_CAR_SIZE',
        })) as { success: boolean; sizeBytes?: number };

        if (sizeResult.success && sizeResult.sizeBytes) {
          carEstimatedSize.value = sizeResult.sizeBytes;
        }
      }
    } catch (error) {
      console.error('[MassOpsTab] Failed to check cache status:', error);
    } finally {
      setCheckingCache(false);
    }
  };

  const handleSettingsChange = async (
    field: 'timeWindowMinutes' | 'minOperationCount',
    value: number
  ) => {
    const newSettings = { ...settings, [field]: value };
    massOpsSettings.value = newSettings;
    await setMassOpsSettings(newSettings);
  };

  const handleScan = async (forceRefresh = false) => {
    massOpsLoading.value = true;
    massOpsProgress.value = 'Starting scan...';

    try {
      const result = (await browser.runtime.sendMessage({
        type: 'SCAN_MASS_OPS',
        settings,
        forceRefresh,
      })) as { success: boolean; error?: string };

      if (result.success) {
        // Reload the scan result from storage
        const storedResult = await getMassOpsScanResult();
        massOpsScanResult.value = storedResult;

        // Initialize selection for each cluster (all selected by default)
        if (storedResult) {
          for (const cluster of storedResult.clusters) {
            initMassOpsClusterSelection(
              cluster.id,
              cluster.operations.map((op) => op.rkey)
            );
          }
        }

        massOpsProgress.value = '';
        // Refresh cache status after scan
        await checkCacheStatus();
      } else {
        massOpsProgress.value = `Error: ${result.error || 'Unknown error'}`;
      }
    } catch (error) {
      console.error('[MassOpsTab] Scan failed:', error);
      massOpsProgress.value = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      massOpsLoading.value = false;
      carDownloadProgress.value = null;
    }
  };

  const handleUndoCluster = async (cluster: MassOperationCluster) => {
    const selectedRkeys = getMassOpsSelectedItems(cluster.id);
    if (selectedRkeys.size === 0) {
      alert('No operations selected to undo');
      return;
    }

    setShowConfirm(cluster.id);
  };

  const confirmUndo = async (cluster: MassOperationCluster) => {
    setShowConfirm(null);
    setUndoing(cluster.id);

    const selectedRkeys = getMassOpsSelectedItems(cluster.id);
    const selectedOps = cluster.operations.filter((op) => selectedRkeys.has(op.rkey));

    try {
      const result = (await browser.runtime.sendMessage({
        type: 'UNDO_MASS_OPERATIONS',
        operations: selectedOps,
      })) as { success: boolean; undone: number; failed: number; errors: string[] };

      if (result.undone > 0) {
        alert(
          `Successfully undid ${result.undone} operations.` +
            (result.failed > 0 ? ` ${result.failed} failed.` : '')
        );
        // Rescan to update the results
        await handleScan();
      } else {
        alert(`Failed to undo operations: ${result.errors.join(', ')}`);
      }
    } catch (error) {
      console.error('[MassOpsTab] Undo failed:', error);
      alert(`Failed to undo: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUndoing(null);
    }
  };

  const handleDismissCluster = async (cluster: MassOperationCluster) => {
    setDismissing(cluster.id);
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'DISMISS_MASS_OPS_CLUSTER',
        cluster: {
          type: cluster.type,
          startTime: cluster.startTime,
          endTime: cluster.endTime,
          count: cluster.count,
        },
      })) as { success: boolean; error?: string };

      if (result.success) {
        // Remove cluster from current scan result
        if (scanResult) {
          massOpsScanResult.value = {
            ...scanResult,
            clusters: scanResult.clusters.filter((c) => c.id !== cluster.id),
          };
        }
        // Refresh dismissed list if showing
        if (showDismissed) {
          await loadDismissedClusters();
        }
      } else {
        alert(`Failed to dismiss: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[MassOpsTab] Dismiss failed:', error);
      alert(`Failed to dismiss: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDismissing(null);
    }
  };

  const loadDismissedClusters = async () => {
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'GET_DISMISSED_MASS_OPS_CLUSTERS',
      })) as { success: boolean; dismissed?: typeof dismissedClusters; error?: string };

      if (result.success && result.dismissed) {
        setDismissedClusters(result.dismissed);
      }
    } catch (error) {
      console.error('[MassOpsTab] Failed to load dismissed clusters:', error);
    }
  };

  const handleRestoreCluster = async (cluster: (typeof dismissedClusters)[0]) => {
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'RESTORE_MASS_OPS_CLUSTER',
        cluster: {
          type: cluster.type,
          startTime: cluster.startTime,
          endTime: cluster.endTime,
          count: cluster.count,
        },
      })) as { success: boolean; error?: string };

      if (result.success) {
        // Remove from local list
        setDismissedClusters((prev) =>
          prev.filter(
            (c) =>
              !(
                c.type === cluster.type &&
                c.startTime === cluster.startTime &&
                c.endTime === cluster.endTime &&
                c.count === cluster.count
              )
          )
        );
      } else {
        alert(`Failed to restore: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[MassOpsTab] Restore failed:', error);
    }
  };

  const handleToggleShowDismissed = async () => {
    if (!showDismissed) {
      await loadDismissedClusters();
    }
    setShowDismissed(!showDismissed);
  };

  // Render cache status info
  const renderCacheStatus = () => {
    if (checkingCache) {
      return <div class="mass-ops-cache-status checking">Checking cache status...</div>;
    }

    if (!cacheStatus) {
      return null;
    }

    if (cacheStatus.hasCached && !cacheStatus.isStale) {
      return (
        <div class="mass-ops-cache-status cached">
          <Database size={14} />
          <span>
            Using cached data from {formatRelativeTime(cacheStatus.cachedAt || 0)}
            {cacheStatus.cachedSize && ` (${formatBytes(cacheStatus.cachedSize)})`}
          </span>
          <button
            class="mass-ops-refresh-btn"
            onClick={() => handleScan(true)}
            disabled={loading}
            title="Force refresh from server"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      );
    }

    if (cacheStatus.hasCached && cacheStatus.isStale) {
      return (
        <div class="mass-ops-cache-status stale">
          <Database size={14} />
          <span>
            Cached data from {formatRelativeTime(cacheStatus.cachedAt || 0)}
            {cacheStatus.cachedSize && ` (${formatBytes(cacheStatus.cachedSize)})`}
          </span>
          <button
            class="mass-ops-refresh-btn"
            onClick={() => handleScan(true)}
            disabled={loading}
            title="Download fresh data from server"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      );
    }

    return (
      <div class="mass-ops-cache-status no-cache">
        <span>
          No cached data
          {estimatedSize && ` - Download: ~${formatBytes(estimatedSize)}`}
        </span>
      </div>
    );
  };

  // Render progress bar during download
  const renderProgressBar = () => {
    if (!downloadProgress || downloadProgress.stage === 'complete') {
      return null;
    }

    const percent = downloadProgress.percentComplete ?? 0;

    return (
      <div class="mass-ops-progress-container">
        <div class="mass-ops-progress-bar">
          <div class="mass-ops-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <div class="mass-ops-progress-text">
          {downloadProgress.message}
          {downloadProgress.isIncremental && ' (incremental)'}
        </div>
      </div>
    );
  };

  // Initial state - no scan yet
  if (!scanResult) {
    return (
      <div class="mass-ops-container">
        <div class="mass-ops-intro">
          <h3>Mass Operations Detection</h3>
          <p>
            Scan your account for clusters of rapid blocks, follows, or list additions. This can
            help identify and undo actions taken by automation tools, starter packs, or during
            moments of frustration.
          </p>
          <p class="mass-ops-note">
            Note: Mutes cannot be detected as they are not stored in your repository.
          </p>

          {renderCacheStatus()}

          <div class="mass-ops-settings">
            <label>
              Time window (minutes):
              <input
                type="number"
                min="1"
                max="60"
                value={settings.timeWindowMinutes}
                onChange={(e) =>
                  handleSettingsChange(
                    'timeWindowMinutes',
                    parseInt((e.target as HTMLInputElement).value) || 5
                  )
                }
              />
            </label>
            <label>
              Minimum operations:
              <input
                type="number"
                min="2"
                max="100"
                value={settings.minOperationCount}
                onChange={(e) =>
                  handleSettingsChange(
                    'minOperationCount',
                    parseInt((e.target as HTMLInputElement).value) || 10
                  )
                }
              />
            </label>
          </div>

          <button class="mass-ops-scan-btn" onClick={() => handleScan(false)} disabled={loading}>
            <Search size={16} class={loading ? 'spinner' : ''} />
            {loading
              ? 'Scanning...'
              : cacheStatus?.hasCached
                ? 'Scan Cached Data'
                : 'Download & Scan'}
          </button>

          {loading && renderProgressBar()}
          {progress && !downloadProgress && <div class="mass-ops-progress">{progress}</div>}
        </div>
      </div>
    );
  }

  // Results view
  const { clusters, scannedAt, operationCounts } = scanResult;

  return (
    <div class="mass-ops-container">
      <div class="mass-ops-header">
        <div class="mass-ops-stats">
          <div class="mass-ops-stat" title="Records in your repo (may include deleted/suspended accounts)">
            <div class="stat-value">{operationCounts.blocks}</div>
            <div class="stat-label">Blocks*</div>
          </div>
          <div class="mass-ops-stat" title="Records in your repo (may include deleted/suspended accounts)">
            <div class="stat-value">{operationCounts.follows}</div>
            <div class="stat-label">Follows*</div>
          </div>
          <div class="mass-ops-stat">
            <div class="stat-value">{operationCounts.listitems}</div>
            <div class="stat-label">List Items</div>
          </div>
          <div class="mass-ops-stat">
            <div class="stat-value" style={{ color: clusters.length > 0 ? '#dc2626' : '#16a34a' }}>
              {clusters.length}
            </div>
            <div class="stat-label">Clusters</div>
          </div>
        </div>
        <div class="mass-ops-repo-note">
          *Counts from your repository data. May be higher than active counts if you've blocked/followed accounts that were later deleted or suspended.
        </div>

        <div class="mass-ops-actions">
          <button class="mass-ops-scan-btn" onClick={() => handleScan(false)} disabled={loading}>
            <Search size={16} class={loading ? 'spinner' : ''} />
            {loading ? 'Scanning...' : 'Rescan'}
          </button>
          <button
            class="mass-ops-refresh-btn"
            onClick={() => handleScan(true)}
            disabled={loading}
            title="Download fresh data from server"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div class="mass-ops-last-scan">
        Last scanned: {formatDate(scannedAt)}
        {cacheStatus?.hasCached && (
          <span class="mass-ops-cache-indicator">
            {' '}
            (data from {formatRelativeTime(cacheStatus.cachedAt || 0)})
          </span>
        )}
      </div>

      {loading && renderProgressBar()}
      {progress && !downloadProgress && <div class="mass-ops-progress">{progress}</div>}

      {clusters.length === 0 ? (
        <div class="mass-ops-empty">
          <p>No mass operations detected with current settings.</p>
          <p>
            Try adjusting the time window or minimum count if you believe there should be results.
          </p>
        </div>
      ) : (
        <div class="mass-ops-clusters">
          {clusters.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              onUndo={handleUndoCluster}
              onDismiss={handleDismissCluster}
              undoing={undoing === cluster.id}
              dismissing={dismissing === cluster.id}
              showConfirm={showConfirm === cluster.id}
              onConfirmUndo={confirmUndo}
              onCancelUndo={() => setShowConfirm(null)}
            />
          ))}
        </div>
      )}

      {/* Settings at bottom for adjustments */}
      <div class="mass-ops-settings-footer">
        <span>Detection settings:</span>
        <label>
          Window:
          <input
            type="number"
            min="1"
            max="60"
            value={settings.timeWindowMinutes}
            onChange={(e) =>
              handleSettingsChange(
                'timeWindowMinutes',
                parseInt((e.target as HTMLInputElement).value) || 5
              )
            }
          />
          min
        </label>
        <label>
          Min ops:
          <input
            type="number"
            min="2"
            max="100"
            value={settings.minOperationCount}
            onChange={(e) =>
              handleSettingsChange(
                'minOperationCount',
                parseInt((e.target as HTMLInputElement).value) || 10
              )
            }
          />
        </label>
      </div>

      {/* Dismissed clusters section */}
      <div class="mass-ops-dismissed-section">
        <button class="mass-ops-show-dismissed-btn" onClick={handleToggleShowDismissed}>
          {showDismissed ? 'Hide' : 'Show'} Dismissed Clusters
          {dismissedClusters.length > 0 && ` (${dismissedClusters.length})`}
        </button>

        {showDismissed && (
          <div class="mass-ops-dismissed-list">
            {dismissedClusters.length === 0 ? (
              <p class="mass-ops-no-dismissed">No dismissed clusters.</p>
            ) : (
              dismissedClusters.map((cluster, index) => {
                const typeLabel =
                  cluster.type === 'block'
                    ? 'Blocks'
                    : cluster.type === 'follow'
                      ? 'Follows'
                      : 'List Adds';
                const timeRange = formatTimeRange(cluster.startTime, cluster.endTime);
                return (
                  <div key={index} class="mass-ops-dismissed-item">
                    <span class="dismissed-type">{typeLabel}</span>
                    <span class="dismissed-count">{cluster.count} ops</span>
                    <span class="dismissed-time">{timeRange}</span>
                    <button
                      class="dismissed-restore-btn"
                      onClick={() => handleRestoreCluster(cluster)}
                      title="Restore this cluster to show in future scans"
                    >
                      Restore
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ClusterCardProps {
  cluster: MassOperationCluster;
  onUndo: (cluster: MassOperationCluster) => void;
  onDismiss: (cluster: MassOperationCluster) => void;
  undoing: boolean;
  dismissing: boolean;
  showConfirm: boolean;
  onConfirmUndo: (cluster: MassOperationCluster) => void;
  onCancelUndo: () => void;
}

function ClusterCard({
  cluster,
  onUndo,
  onDismiss,
  undoing,
  dismissing,
  showConfirm,
  onConfirmUndo,
  onCancelUndo,
}: ClusterCardProps): JSX.Element {
  const expanded = massOpsExpandedClusters.value.has(cluster.id);
  const selectedRkeys = getMassOpsSelectedItems(cluster.id);
  const allSelected = selectedRkeys.size === cluster.operations.length;
  const noneSelected = selectedRkeys.size === 0;

  // Profile cache for this cluster
  const [profiles, setProfiles] = useState<Map<string, ProfileWithViewer>>(new Map());
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profilesLoaded, setProfilesLoaded] = useState(false);

  const typeLabel =
    cluster.type === 'block' ? 'Blocks' : cluster.type === 'follow' ? 'Follows' : 'List Adds';
  const typeColor =
    cluster.type === 'block' ? '#dc2626' : cluster.type === 'follow' ? '#2563eb' : '#9333ea';

  const timeRange = formatTimeRange(cluster.startTime, cluster.endTime);

  // Fetch profiles when cluster is expanded
  useEffect(() => {
    if (expanded && !profilesLoaded && !loadingProfiles) {
      const fetchProfiles = async () => {
        // Check if user is logged in before attempting to fetch
        try {
          const authResponse = (await browser.runtime.sendMessage({ type: 'GET_AUTH_STATUS' })) as {
            success: boolean;
            isAuthenticated?: boolean;
          };
          if (!authResponse.success || !authResponse.isAuthenticated) {
            setProfilesLoaded(true); // Mark as loaded to prevent retry
            return;
          }
        } catch {
          setProfilesLoaded(true);
          return;
        }

        setLoadingProfiles(true);
        try {
          const dids = cluster.operations.map((op) => op.did);
          const profileMap = await fetchProfilesViaBackground(dids);
          setProfiles(profileMap);
          setProfilesLoaded(true);
        } catch (error) {
          console.error('[MassOpsTab] Failed to fetch profiles:', error);
          // Still mark as loaded so we don't retry indefinitely
          setProfilesLoaded(true);
        } finally {
          setLoadingProfiles(false);
        }
      };
      fetchProfiles();
    }
  }, [expanded, profilesLoaded, loadingProfiles, cluster.operations]);

  const handleToggleExpand = () => {
    toggleMassOpsClusterExpanded(cluster.id);
    // Initialize selection if not already done
    if (!massOpsSelectedItems.value.has(cluster.id)) {
      initMassOpsClusterSelection(
        cluster.id,
        cluster.operations.map((op) => op.rkey)
      );
    }
  };

  const handleSelectAll = () => {
    selectAllMassOpsItems(
      cluster.id,
      cluster.operations.map((op) => op.rkey)
    );
  };

  const handleDeselectAll = () => {
    deselectAllMassOpsItems(cluster.id);
  };

  return (
    <div class="mass-ops-cluster">
      <div class="cluster-header" onClick={handleToggleExpand}>
        <span class="cluster-expand-icon">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span class="cluster-type" style={{ color: typeColor }}>
          {typeLabel}
        </span>
        <span class="cluster-count">{cluster.count} operations</span>
        <span class="cluster-time">{timeRange}</span>
        <button
          class="cluster-undo-btn"
          onClick={(e) => {
            e.stopPropagation();
            onUndo(cluster);
          }}
          disabled={undoing || noneSelected}
        >
          <Trash2 size={14} />
          {undoing ? 'Undoing...' : `Undo ${selectedRkeys.size}`}
        </button>
        <button
          class="cluster-dismiss-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(cluster);
          }}
          disabled={dismissing}
          title="Hide this cluster from future scans"
        >
          {dismissing ? '...' : 'Dismiss'}
        </button>
      </div>

      {showConfirm && (
        <div class="cluster-confirm">
          <span>
            Are you sure you want to undo {selectedRkeys.size} {cluster.type}
            {selectedRkeys.size === 1 ? '' : 's'}?
          </span>
          <button class="confirm-yes" onClick={() => onConfirmUndo(cluster)}>
            Yes, Undo
          </button>
          <button class="confirm-no" onClick={onCancelUndo}>
            Cancel
          </button>
        </div>
      )}

      {expanded && (
        <div class="cluster-operations">
          <div class="cluster-select-all">
            <button onClick={allSelected ? handleDeselectAll : handleSelectAll}>
              {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            <span class="select-count">
              {selectedRkeys.size} of {cluster.operations.length} selected
            </span>
            {loadingProfiles && (
              <span class="loading-profiles">
                <Loader2 size={14} class="spinner" />
                Loading profiles...
              </span>
            )}
          </div>
          <div class="operations-list">
            {cluster.operations.map((op) => (
              <OperationRow
                key={op.rkey}
                operation={op}
                clusterId={cluster.id}
                profile={profiles.get(op.did)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface OperationRowProps {
  operation: GraphOperation;
  clusterId: string;
  profile?: ProfileWithViewer;
}

function OperationRow({ operation, clusterId, profile }: OperationRowProps): JSX.Element {
  const selectedRkeys = getMassOpsSelectedItems(clusterId);
  const isSelected = selectedRkeys.has(operation.rkey);

  // Use profile info if available, otherwise fall back to truncated DID
  const displayName = profile?.displayName || profile?.handle;
  const displayIdentifier =
    displayName ||
    (operation.did.length > 40
      ? `${operation.did.slice(0, 20)}...${operation.did.slice(-15)}`
      : operation.did);

  return (
    <div
      class={`operation-row ${isSelected ? 'selected' : ''}`}
      onClick={() => toggleMassOpsItemSelection(clusterId, operation.rkey)}
    >
      <span class="operation-checkbox">
        {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
      </span>
      <a
        class="operation-user"
        href={`https://bsky.app/profile/${operation.did}`}
        target="_blank"
        rel="noopener"
        title={operation.did}
        onClick={(e) => e.stopPropagation()}
      >
        {profile?.avatar ? (
          <img src={profile.avatar} alt="" class="operation-avatar" />
        ) : (
          <span class="operation-avatar-placeholder" />
        )}
        <span class="operation-identity">
          <span class="operation-display-name">{displayIdentifier}</span>
          {displayName && profile?.handle && (
            <span class="operation-handle">@{profile.handle}</span>
          )}
        </span>
      </a>
      {operation.listName && <span class="operation-list-name">{operation.listName}</span>}
      <span class="operation-time">{formatDate(operation.createdAt)}</span>
      <a
        class="operation-view"
        href={`https://bsky.app/profile/${operation.did}`}
        target="_blank"
        rel="noopener"
        onClick={(e) => e.stopPropagation()}
      >
        View
      </a>
    </div>
  );
}

function formatTimeRange(startTime: number, endTime: number): string {
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

  const startDateStr = startDate.toLocaleDateString(undefined, dateOptions);
  const startTimeStr = startDate.toLocaleTimeString(undefined, timeOptions);
  const endTimeStr = endDate.toLocaleTimeString(undefined, timeOptions);

  // If same day, show: "Jan 15, 10:30 - 10:35 AM"
  // If different days, show full range
  const endDateStr = endDate.toLocaleDateString(undefined, dateOptions);
  if (startDateStr === endDateStr) {
    return `${startDateStr}, ${startTimeStr} - ${endTimeStr}`;
  }
  return `${startDateStr} ${startTimeStr} - ${endDateStr} ${endTimeStr}`;
}
