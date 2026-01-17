/**
 * ErgoBlock Manager - Full-page block/mute management UI (Preact version)
 */
import { render } from 'preact';
import { useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import browser from './browser.js';
import {
  getAllManagedBlocks,
  getAllManagedMutes,
  getActionHistory,
  getPostContexts,
  getSyncState,
  getAmnestyReviewedDids,
  getAmnestyReviews,
  getOptions,
  getBlocklistAuditState,
  getBlocklistConflicts,
  removeTempBlock,
  removeTempMute,
} from './storage.js';
import {
  blocks,
  mutes,
  history,
  contexts,
  syncState,
  options,
  amnestyReviewedDids,
  amnestyReviews,
  blocklistAuditState,
  blocklistConflicts,
  currentTab,
  selectedItems,
  clearSelection,
  loading,
  tempUnblockTimers,
  setInteractions,
  setExpandedLoading,
  setFindingContext,
} from './signals/manager.js';
import type { Interaction } from './types.js';
import {
  StatsBar,
  TabNav,
  Toolbar,
  BlocksTable,
  MutesTable,
  HistoryTable,
  AmnestyTab,
  BlocklistAuditTab,
  BlockRelationshipsTab,
  RepostFiltersTab,
  ExportSection,
  formatTimeAgo,
} from './components/manager/index.js';

const TEMP_UNBLOCK_DURATION = 60 * 1000; // 60 seconds

// Response validation types
interface MessageResponse {
  success: boolean;
  error?: string;
  found?: boolean;
  interactions?: Interaction[];
}

/**
 * Validate that a response has the expected shape
 */
function isValidResponse(response: unknown): response is MessageResponse {
  if (typeof response !== 'object' || response === null) {
    return false;
  }
  const resp = response as Record<string, unknown>;
  return typeof resp.success === 'boolean';
}

/**
 * Send a message and validate the response
 */
async function sendValidatedMessage(message: Record<string, unknown>): Promise<MessageResponse> {
  const response = await browser.runtime.sendMessage(message);
  if (!isValidResponse(response)) {
    console.error('[Manager] Invalid response shape:', response);
    return { success: false, error: 'Invalid response from background' };
  }
  return response;
}

function ManagerApp(): JSX.Element {
  // Load all data
  const loadData = useCallback(async () => {
    const [
      blocksData,
      mutesData,
      historyData,
      contextsData,
      syncData,
      reviewedDids,
      reviewsData,
      optionsData,
      auditState,
      auditConflicts,
    ] = await Promise.all([
      getAllManagedBlocks(),
      getAllManagedMutes(),
      getActionHistory(),
      getPostContexts(),
      getSyncState(),
      getAmnestyReviewedDids(),
      getAmnestyReviews(),
      getOptions(),
      getBlocklistAuditState(),
      getBlocklistConflicts(),
    ]);

    blocks.value = blocksData;
    mutes.value = mutesData;
    history.value = historyData;
    contexts.value = contextsData;
    syncState.value = syncData;
    amnestyReviewedDids.value = reviewedDids;
    amnestyReviews.value = reviewsData;
    options.value = optionsData;
    blocklistAuditState.value = auditState;
    blocklistConflicts.value = auditConflicts;
    loading.value = false;
  }, []);

  // Initial load and auto-refresh
  useEffect(() => {
    loadData();

    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Sync handler
  const handleSync = async () => {
    try {
      // Immediately show syncing state
      if (syncState.value) {
        syncState.value = { ...syncState.value, syncInProgress: true };
      }
      const response = await sendValidatedMessage({ type: 'SYNC_NOW' });
      if (response.success) {
        await loadData();
      } else {
        // Reset sync state on failure
        if (syncState.value) {
          syncState.value = { ...syncState.value, syncInProgress: false };
        }
        alert(`Sync failed: ${response.error}`);
      }
    } catch (error) {
      console.error('[Manager] Sync error:', error);
      // Reset sync state on error
      if (syncState.value) {
        syncState.value = { ...syncState.value, syncInProgress: false };
      }
      alert('Sync failed');
    }
  };

  // Unblock handler - API call first, then storage removal on success
  const handleUnblock = async (did: string, handle?: string) => {
    if (handle && !confirm(`Unblock @${handle}?`)) return;

    try {
      const response = await sendValidatedMessage({ type: 'UNBLOCK_USER', did });
      if (!response.success) {
        console.error('[Manager] Unblock failed:', response.error);
        alert(`Failed to unblock: ${response.error}`);
        return;
      }
      // Only remove from storage after API success
      await removeTempBlock(did);
      await loadData();
    } catch (error) {
      console.error('[Manager] Unblock error:', error);
      alert('Failed to unblock user');
    }
  };

  // Unmute handler - API call first, then storage removal on success
  const handleUnmute = async (did: string, handle?: string) => {
    if (handle && !confirm(`Unmute @${handle}?`)) return;

    try {
      const response = await sendValidatedMessage({ type: 'UNMUTE_USER', did });
      if (!response.success) {
        console.error('[Manager] Unmute failed:', response.error);
        alert(`Failed to unmute: ${response.error}`);
        return;
      }
      // Only remove from storage after API success
      await removeTempMute(did);
      await loadData();
    } catch (error) {
      console.error('[Manager] Unmute error:', error);
      alert('Failed to unmute user');
    }
  };

  // Find context handler
  const handleFindContext = async (did: string, handle: string) => {
    setFindingContext(did, true);
    try {
      const response = await sendValidatedMessage({
        type: 'FIND_CONTEXT',
        did,
        handle,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to search');
      }

      if (response.found) {
        await loadData();
      } else {
        alert('No context found');
      }
    } catch (error) {
      console.error('[Manager] Find context failed:', error);
      alert('Failed to search for context');
    } finally {
      setFindingContext(did, false);
    }
  };

  // Fetch all interactions for expanded row
  const handleFetchInteractions = async (did: string, handle: string) => {
    setExpandedLoading(did, true);
    try {
      const response = await sendValidatedMessage({
        type: 'FETCH_ALL_INTERACTIONS',
        did,
        handle,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch interactions');
      }

      setInteractions(did, response.interactions || []);
    } catch (error) {
      console.error('[Manager] Fetch interactions failed:', error);
      setInteractions(did, []);
    } finally {
      setExpandedLoading(did, false);
    }
  };

  // Temp unblock for viewing
  const handleTempUnblockAndView = async (did: string, handle: string, url: string) => {
    // Check if already temp unblocked
    if (tempUnblockTimers.value.has(did)) {
      window.open(url, '_blank');
      return;
    }

    try {
      const response = await sendValidatedMessage({
        type: 'TEMP_UNBLOCK_FOR_VIEW',
        did,
        handle,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to unblock');
      }

      window.open(url, '_blank');

      // Track the temp unblock
      const expiresAt = Date.now() + TEMP_UNBLOCK_DURATION;
      const timerId = window.setTimeout(async () => {
        await reblockUser(did, handle);
      }, TEMP_UNBLOCK_DURATION);

      const newTimers = new Map(tempUnblockTimers.value);
      newTimers.set(did, { timerId, expiresAt });
      tempUnblockTimers.value = newTimers;
    } catch (error) {
      console.error('[Manager] Temp unblock failed:', error);
      alert(`Failed to unblock: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const reblockUser = async (did: string, handle: string) => {
    try {
      const response = await sendValidatedMessage({
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
      const newTimers = new Map(tempUnblockTimers.value);
      newTimers.delete(did);
      tempUnblockTimers.value = newTimers;
    }
  };

  // Bulk remove handler
  const handleBulkRemove = async () => {
    const count = selectedItems.value.size;
    if (count === 0) return;

    const tab = currentTab.value;
    const type = tab === 'blocks' ? 'unblock' : 'unmute';
    if (!confirm(`${type === 'unblock' ? 'Unblock' : 'Unmute'} ${count} users?`)) return;

    for (const did of selectedItems.value) {
      if (type === 'unblock') {
        await handleUnblock(did);
      } else {
        await handleUnmute(did);
      }
    }

    clearSelection();
  };

  // Sync status display
  const getSyncStatusText = () => {
    if (!syncState.value) return 'Last synced: Never';

    const lastSync = Math.max(syncState.value.lastBlockSync, syncState.value.lastMuteSync);
    const syncStartedTooLongAgo =
      syncState.value.syncInProgress && lastSync > 0 && Date.now() - lastSync > 5 * 60 * 1000;

    if (syncState.value.syncInProgress && !syncStartedTooLongAgo) {
      return 'Syncing...';
    }

    if (syncState.value.lastError) {
      return `Sync error: ${syncState.value.lastError}`;
    }

    if (lastSync > 0) {
      return `Last synced: ${formatTimeAgo(lastSync)}`;
    }

    return 'Last synced: Never';
  };

  const isSyncing =
    syncState.value?.syncInProgress &&
    !(
      syncState.value.syncInProgress &&
      Math.max(syncState.value.lastBlockSync, syncState.value.lastMuteSync) > 0 &&
      Date.now() - Math.max(syncState.value.lastBlockSync, syncState.value.lastMuteSync) >
        5 * 60 * 1000
    );

  // Render tab content
  const renderTabContent = () => {
    if (loading.value) {
      return (
        <div class="loading">
          <div class="spinner" />
          <p>Loading...</p>
        </div>
      );
    }

    switch (currentTab.value) {
      case 'blocks':
        return (
          <BlocksTable
            onUnblock={handleUnblock}
            onFindContext={handleFindContext}
            onViewPost={handleTempUnblockAndView}
            onFetchInteractions={handleFetchInteractions}
          />
        );
      case 'mutes':
        return (
          <MutesTable
            onUnmute={handleUnmute}
            onFindContext={handleFindContext}
            onViewPost={handleTempUnblockAndView}
            onFetchInteractions={handleFetchInteractions}
          />
        );
      case 'history':
        return <HistoryTable />;
      case 'amnesty':
        return (
          <AmnestyTab
            onUnblock={async (did) => handleUnblock(did)}
            onUnmute={async (did) => handleUnmute(did)}
            onTempUnblockAndView={handleTempUnblockAndView}
            onFetchInteractions={handleFetchInteractions}
            onReload={loadData}
          />
        );
      case 'blocklist-audit':
        return <BlocklistAuditTab onReload={loadData} />;
      case 'relationships':
        return <BlockRelationshipsTab onReload={loadData} />;
      case 'repost-filters':
        return <RepostFiltersTab onReload={loadData} />;
      default:
        return null;
    }
  };

  return (
    <>
      <header>
        <h1>ErgoBlock Manager</h1>
        <div class="sync-status">
          <span>{getSyncStatusText()}</span>
          <button onClick={handleSync} disabled={isSyncing} class={isSyncing ? 'syncing' : ''}>
            {isSyncing ? (
              <>
                <span class="spinner" />
                Syncing...
              </>
            ) : (
              'Sync Now'
            )}
          </button>
        </div>
      </header>

      <div class="container">
        <StatsBar />
        <TabNav />
        <Toolbar onBulkRemove={handleBulkRemove} />
        <div class="table-container">{renderTabContent()}</div>
        <ExportSection />
      </div>
    </>
  );
}

// Mount the app
const app = document.getElementById('app');
if (app) {
  render(<ManagerApp />, app);
}
