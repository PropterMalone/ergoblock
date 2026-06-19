/**
 * ErgoBlock Manager - Full-page block/mute management UI (Preact version)
 */
import { render } from 'preact';
import { useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { send } from './platform/messages.js';
import { createLogger } from './platform/utils.js';
import { KOFI_URL, SUPPORT_LABEL } from './ui/constants/support.js';

const log = createLogger('manager');
import {
  getAllManagedBlocks,
  getAllManagedMutes,
  getPostContexts,
  getSyncState,
  getAmnestyReviewedDids,
  getAmnestyReviews,
  getOptions,
  getBlocklistAuditState,
  getBlocklistConflicts,
  getPermanentBlocks,
  getPermanentMutes,
  removeTempBlock,
  removeTempMute,
  removePermanentBlock,
  removePermanentMute,
} from './platform/storage.js';
import {
  blocks,
  mutes,
  contexts,
  syncState,
  options,
  amnestyReviewedDids,
  amnestyReviews,
  blocklistAuditState,
  blocklistConflicts,
  permanentBlocksRaw,
  permanentMutesRaw,
  currentTab,
  selectedItems,
  clearSelection,
  loading,
  quotePostRef,
  quoteAutoFetch,
  tempUnblockTimers,
  setInteractions,
  setExpandedLoading,
  setFindingContext,
  allEntries,
} from './ui/signals/manager.js';
import {
  StatsBar,
  TabNav,
  Toolbar,
  ActionsTable,
  AmnestyTab,
  BlocklistAuditTab,
  ReviewQueueTab,
  RepostFiltersTab,
  MassOpsTab,
  CopyUserTab,
  QuoteSweepTab,
  SettingsTab,
  ExportSection,
  formatTimeAgo,
} from './ui/components/manager/index.js';

const TEMP_UNBLOCK_DURATION = 60 * 1000; // 60 seconds

function ManagerApp(): JSX.Element {
  // Load all data
  const loadData = useCallback(async () => {
    const [
      blocksData,
      mutesData,
      contextsData,
      syncData,
      reviewedDids,
      reviewsData,
      optionsData,
      auditState,
      auditConflicts,
      permBlocks,
      permMutes,
    ] = await Promise.all([
      getAllManagedBlocks(),
      getAllManagedMutes(),
      getPostContexts(),
      getSyncState(),
      getAmnestyReviewedDids(),
      getAmnestyReviews(),
      getOptions(),
      getBlocklistAuditState(),
      getBlocklistConflicts(),
      getPermanentBlocks(),
      getPermanentMutes(),
    ]);

    blocks.value = blocksData;
    mutes.value = mutesData;
    contexts.value = contextsData;
    syncState.value = syncData;
    amnestyReviewedDids.value = reviewedDids;
    amnestyReviews.value = reviewsData;
    options.value = optionsData;
    blocklistAuditState.value = auditState;
    blocklistConflicts.value = auditConflicts;
    permanentBlocksRaw.value = permBlocks;
    permanentMutesRaw.value = permMutes;
    loading.value = false;
  }, []);

  // Initial load and auto-refresh
  useEffect(() => {
    loadData();

    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Auto-fill from URL params: ?tab=quote-sweep&postUri=<encoded at-uri>
  // Switches to the Quote Sweep tab and prefills/auto-triggers the fetch.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'quote-sweep') {
      currentTab.value = 'quote-sweep';
      const postUri = params.get('postUri');
      if (postUri) {
        quotePostRef.value = postUri;
        quoteAutoFetch.value = true;
      }
    }
  }, []);

  // Sync handler
  const handleSync = async () => {
    try {
      // Immediately show syncing state
      if (syncState.value) {
        syncState.value = { ...syncState.value, syncInProgress: true };
      }
      const response = await send('SYNC_NOW');
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
      log.error('Sync error:', error);
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
      const response = await send('UNBLOCK_USER', { did });
      if (!response.success) {
        log.error('Unblock failed:', response.error);
        alert(`Failed to unblock: ${response.error}`);
        return;
      }
      // Cancel any pending reblock timer (from "peek" feature)
      const pendingTimer = tempUnblockTimers.value.get(did);
      if (pendingTimer) {
        window.clearTimeout(pendingTimer.timerId);
        const newTimers = new Map(tempUnblockTimers.value);
        newTimers.delete(did);
        tempUnblockTimers.value = newTimers;
      }
      // Remove from both temp and permanent storage after API success
      await Promise.all([removeTempBlock(did), removePermanentBlock(did)]);
      await loadData();
    } catch (error) {
      log.error('Unblock error:', error);
      alert('Failed to unblock user');
    }
  };

  // Unmute handler - API call first, then storage removal on success
  const handleUnmute = async (did: string, handle?: string) => {
    if (handle && !confirm(`Unmute @${handle}?`)) return;

    try {
      const response = await send('UNMUTE_USER', { did });
      if (!response.success) {
        log.error('Unmute failed:', response.error);
        alert(`Failed to unmute: ${response.error}`);
        return;
      }
      // Remove from both temp and permanent storage after API success
      await Promise.all([removeTempMute(did), removePermanentMute(did)]);
      await loadData();
    } catch (error) {
      log.error('Unmute error:', error);
      alert('Failed to unmute user');
    }
  };

  // Find context handler
  const handleFindContext = async (did: string, handle: string) => {
    setFindingContext(did, true);
    try {
      // Bound the CAR scan by the block/mute creation time so we skip posts
      // authored after the action was taken (they can't have prompted it).
      const entry =
        blocks.value.find((b) => b.did === did) ?? mutes.value.find((m) => m.did === did);
      const response = await send('FIND_CONTEXT', {
        did,
        handle,
        beforeTimestamp: entry?.createdAt,
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
      log.error('Find context failed:', error);
      alert('Failed to search for context');
    } finally {
      setFindingContext(did, false);
    }
  };

  // Fetch all interactions for expanded row
  const handleFetchInteractions = async (did: string, handle: string) => {
    setExpandedLoading(did, true);
    try {
      const entry =
        blocks.value.find((b) => b.did === did) ?? mutes.value.find((m) => m.did === did);
      const response = await send('FETCH_ALL_INTERACTIONS', {
        did,
        handle,
        beforeTimestamp: entry?.createdAt,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch interactions');
      }

      setInteractions(did, response.interactions || []);
    } catch (error) {
      log.error('Fetch interactions failed:', error);
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
      const response = await send('TEMP_UNBLOCK_FOR_VIEW', { did, handle });

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
      log.error('Temp unblock failed:', error);
      alert(`Failed to unblock: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const reblockUser = async (did: string, handle: string) => {
    try {
      const response = await send('REBLOCK_USER', { did, handle });

      if (!response.success) {
        log.error('Reblock failed:', response.error);
      }
    } catch (error) {
      log.error('Reblock error:', error);
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

    // Determine what to remove based on each selected item's type
    const selected = Array.from(selectedItems.value);
    const entries = allEntries.value;

    // 'both' entries need both unblock and unmute
    const toUnblock = selected.filter((did) =>
      entries.find((e) => e.did === did && (e.type === 'block' || e.type === 'both'))
    );
    const toUnmute = selected.filter((did) =>
      entries.find((e) => e.did === did && (e.type === 'mute' || e.type === 'both'))
    );

    const parts: string[] = [];
    if (toUnblock.length > 0)
      parts.push(`${toUnblock.length} block${toUnblock.length > 1 ? 's' : ''}`);
    if (toUnmute.length > 0) parts.push(`${toUnmute.length} mute${toUnmute.length > 1 ? 's' : ''}`);

    if (!confirm(`Remove ${parts.join(' and ')}?`)) return;

    for (const did of toUnblock) {
      await handleUnblock(did);
    }
    for (const did of toUnmute) {
      await handleUnmute(did);
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
      case 'actions':
        return (
          <ActionsTable
            onUnblock={handleUnblock}
            onUnmute={handleUnmute}
            onFindContext={handleFindContext}
            onViewPost={handleTempUnblockAndView}
            onFetchInteractions={handleFetchInteractions}
          />
        );
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
      case 'review-queue':
        return <ReviewQueueTab onReload={loadData} />;
      case 'repost-filters':
        return <RepostFiltersTab onReload={loadData} />;
      case 'mass-ops':
        return <MassOpsTab onReload={loadData} />;
      case 'copy-user':
        return <CopyUserTab onReload={loadData} />;
      case 'quote-sweep':
        return <QuoteSweepTab onReload={loadData} />;
      case 'settings':
        return <SettingsTab onReload={loadData} />;
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
        <footer class="support-footer">
          <a href={KOFI_URL} target="_blank" rel="noopener noreferrer">
            {SUPPORT_LABEL}
          </a>
          <span class="support-footer__note">Free &amp; open source. Tips keep it maintained.</span>
        </footer>
      </div>
    </>
  );
}

// Mount the app
const app = document.getElementById('app');
if (app) {
  render(<ManagerApp />, app);
}
