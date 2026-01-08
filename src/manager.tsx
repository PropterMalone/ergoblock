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
} from './signals/manager.js';
import {
  StatsBar,
  TabNav,
  Toolbar,
  BlocksTable,
  MutesTable,
  HistoryTable,
  AmnestyTab,
  BlocklistAuditTab,
  ExportSection,
  formatTimeAgo,
} from './components/manager/index.js';

const TEMP_UNBLOCK_DURATION = 60 * 1000; // 60 seconds

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
      const response = (await browser.runtime.sendMessage({ type: 'SYNC_NOW' })) as {
        success: boolean;
        error?: string;
      };
      if (response.success) {
        await loadData();
      } else {
        alert(`Sync failed: ${response.error}`);
      }
    } catch (error) {
      console.error('[Manager] Sync error:', error);
      alert('Sync failed');
    }
  };

  // Unblock handler
  const handleUnblock = async (did: string, handle?: string) => {
    if (handle && !confirm(`Unblock @${handle}?`)) return;

    try {
      await removeTempBlock(did);
      const response = (await browser.runtime.sendMessage({ type: 'UNBLOCK_USER', did })) as {
        success: boolean;
        error?: string;
      };
      if (!response.success) {
        console.error('[Manager] Unblock failed:', response.error);
        alert(`Failed to unblock: ${response.error}`);
      }
      await loadData();
    } catch (error) {
      console.error('[Manager] Unblock error:', error);
      alert('Failed to unblock user');
    }
  };

  // Unmute handler
  const handleUnmute = async (did: string, handle?: string) => {
    if (handle && !confirm(`Unmute @${handle}?`)) return;

    try {
      await removeTempMute(did);
      const response = (await browser.runtime.sendMessage({ type: 'UNMUTE_USER', did })) as {
        success: boolean;
        error?: string;
      };
      if (!response.success) {
        console.error('[Manager] Unmute failed:', response.error);
        alert(`Failed to unmute: ${response.error}`);
      }
      await loadData();
    } catch (error) {
      console.error('[Manager] Unmute error:', error);
      alert('Failed to unmute user');
    }
  };

  // Find context handler
  const handleFindContext = async (did: string, handle: string) => {
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
        await loadData();
      } else {
        alert('No context found');
      }
    } catch (error) {
      console.error('[Manager] Find context failed:', error);
      alert('Failed to search for context');
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
      const response = (await browser.runtime.sendMessage({
        type: 'TEMP_UNBLOCK_FOR_VIEW',
        did,
        handle,
      })) as { success: boolean; error?: string };

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
      const response = (await browser.runtime.sendMessage({
        type: 'REBLOCK_USER',
        did,
        handle,
      })) as { success: boolean; error?: string };

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
          />
        );
      case 'mutes':
        return (
          <MutesTable
            onUnmute={handleUnmute}
            onFindContext={handleFindContext}
            onViewPost={handleTempUnblockAndView}
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
            onReload={loadData}
          />
        );
      case 'blocklist-audit':
        return <BlocklistAuditTab onReload={loadData} />;
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
          <button onClick={handleSync} disabled={isSyncing}>
            Sync Now
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
