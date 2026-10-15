/** Full-page management for blocks, mutes, and post actions. */
import { render } from 'preact';
import { useEffect, useCallback, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { send } from './platform/messages.js';
import { createLogger } from './platform/utils.js';
import { useStoredTheme } from './ui/hooks/useTheme.js';
import { KOFI_URL, SUPPORT_LABEL } from './ui/constants/support.js';
import {
  getAllManagedBlocks,
  getAllManagedMutes,
  getPostContexts,
  getActionHistory,
  getSyncState,
  getOptions,
  removeTempBlock,
  removeTempMute,
  removePermanentBlock,
  removePermanentMute,
} from './platform/storage.js';
import {
  blocks,
  mutes,
  contexts,
  history,
  syncState,
  options,
  currentTab,
  selectedItems,
  clearSelection,
  loading,
  quotePostRef,
  quoteAutoFetch,
  allEntries,
} from './ui/signals/manager.js';
import {
  StatsBar,
  TabNav,
  Toolbar,
  ActionsTable,
  MassOpsTab,
  CopyUserTab,
  QuoteSweepTab,
  SettingsTab,
  ExportSection,
  formatTimeAgo,
} from './ui/components/manager/index.js';
import { ExpirationHealth } from './ui/components/manager/ExpirationHealth.js';
const log = createLogger('manager');

export function ManagerApp(): JSX.Element {
  useStoredTheme();
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadData = useCallback(async () => {
    try {
      const [blocksData, mutesData, contextsData, historyData, syncData, optionsData] =
        await Promise.all([
          getAllManagedBlocks(),
          getAllManagedMutes(),
          getPostContexts(),
          getActionHistory(),
          getSyncState(),
          getOptions(),
        ]);
      blocks.value = blocksData;
      mutes.value = mutesData;
      // Legacy contexts remain readable for export; no new context is collected.
      contexts.value = contextsData;
      history.value = historyData;
      syncState.value = syncData;
      options.value = optionsData;
      setLoadError(null);
    } catch (error) {
      log.error('Failed to load manager data:', error);
      setLoadError('Could not load saved actions. Retry or reopen the manager.');
    } finally {
      loading.value = false;
    }
  }, []);
  useEffect(() => {
    void loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Preserve existing in-page and bookmarked deep links.
    if (params.get('tab') === 'quote-sweep') {
      currentTab.value = 'quote-sweep';
      const postUri = params.get('postUri');
      if (postUri) {
        quotePostRef.value = postUri;
        quoteAutoFetch.value = true;
      }
    }
  }, []);
  const handleSync = async () => {
    if (syncState.value) syncState.value = { ...syncState.value, syncInProgress: true };
    try {
      const response = await send('SYNC_NOW');
      if (!response.success) throw new Error(response.error || 'Sync failed');
      await loadData();
    } catch (error) {
      log.error('Sync error:', error);
      alert(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      if (syncState.value) syncState.value = { ...syncState.value, syncInProgress: false };
    }
  };
  const remove = async (did: string, actionType: 'block' | 'mute', handle?: string) => {
    const verb = actionType === 'block' ? 'Unblock' : 'Unmute';
    if (handle && !confirm(`${verb} @${handle}?`)) return;
    try {
      const response =
        actionType === 'block'
          ? await send('UNBLOCK_USER', { did })
          : await send('UNMUTE_USER', { did });
      if (!response.success) throw new Error(response.error || `${verb} failed`);
      await (actionType === 'block'
        ? Promise.all([removeTempBlock(did), removePermanentBlock(did)])
        : Promise.all([removeTempMute(did), removePermanentMute(did)]));
      await loadData();
    } catch (error) {
      log.error(`${verb} failed:`, error);
      alert(error instanceof Error ? error.message : `${verb} failed`);
    }
  };
  const handleBulkRemove = async () => {
    const selected = allEntries.value.filter((entry) => selectedItems.value.has(entry.did));
    if (
      !selected.length ||
      !confirm(`Remove blocks and mutes for ${selected.length} selected accounts?`)
    )
      return;
    for (const entry of selected) {
      if (entry.type === 'block' || entry.type === 'both') await remove(entry.did, 'block');
      if (entry.type === 'mute' || entry.type === 'both') await remove(entry.did, 'mute');
    }
    clearSelection();
  };
  const renderTabContent = () => {
    if (loading.value)
      return (
        <div class="loading">
          <div class="spinner" />
          <p>Loading...</p>
        </div>
      );
    switch (currentTab.value) {
      case 'actions':
        return (
          <ActionsTable
            onUnblock={(did, handle) => remove(did, 'block', handle)}
            onUnmute={(did, handle) => remove(did, 'mute', handle)}
            onReload={loadData}
          />
        );
      case 'mass-ops':
        return <MassOpsTab onReload={loadData} />;
      case 'copy-user':
        return <CopyUserTab onReload={loadData} />;
      case 'quote-sweep':
        return <QuoteSweepTab onReload={loadData} />;
      case 'settings':
        return <SettingsTab onReload={loadData} />;
    }
  };
  const lastSync = Math.max(
    syncState.value?.lastBlockSync ?? 0,
    syncState.value?.lastMuteSync ?? 0
  );
  return (
    <>
      <header>
        <h1>ErgoBlock Manager</h1>
        <div class="sync-status">
          <span>
            {syncState.value?.lastError
              ? `Sync error: ${syncState.value.lastError}`
              : lastSync
                ? `Last synced: ${formatTimeAgo(lastSync)}`
                : 'Last synced: Never'}
          </span>
          <button onClick={handleSync} disabled={syncState.value?.syncInProgress}>
            {syncState.value?.syncInProgress ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </header>
      <div class="container">
        <StatsBar />
        <TabNav />
        {loadError && (
          <p role="alert">
            {loadError} <button onClick={loadData}>Retry</button>
          </p>
        )}
        {currentTab.value === 'actions' && <ExpirationHealth />}
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
const app = document.getElementById('app');
if (app) render(<ManagerApp />, app);
