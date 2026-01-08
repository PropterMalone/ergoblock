import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { signal, computed } from '@preact/signals';
import browser from './browser.js';
import {
  STORAGE_KEYS,
  getTempBlocks,
  getTempMutes,
  getPermanentBlocks,
  getPermanentMutes,
  getActionHistory,
  getSyncState,
} from './storage.js';
import type { HistoryEntry, SyncState } from './types.js';

// Types
interface TempItem {
  handle: string;
  expiresAt: number;
  createdAt: number;
}

interface CombinedItem {
  did: string;
  handle: string;
  expiresAt: number;
  createdAt: number;
  type: 'block' | 'mute';
}

interface Stats {
  blocks: number;
  mutes: number;
  expiring: number;
}

// Constants
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL = 30000;

// Global signals for reactive state
const stats = signal<Stats>({ blocks: 0, mutes: 0, expiring: 0 });
const expiringItems = signal<CombinedItem[]>([]);
const recentActivity = signal<HistoryEntry[]>([]);
const syncState = signal<SyncState | null>(null);
const authExpired = signal(false);
const statusMessage = signal('');
const loading = signal(true);

// Formatting utilities
function formatTimeRemaining(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTimestamp(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// Data loading functions
async function loadStats(): Promise<void> {
  const [tempBlocks, tempMutes, permBlocks, permMutes] = await Promise.all([
    getTempBlocks(),
    getTempMutes(),
    getPermanentBlocks(),
    getPermanentMutes(),
  ]);

  const blockCount = Object.keys(tempBlocks).length + Object.keys(permBlocks).length;
  const muteCount = Object.keys(tempMutes).length + Object.keys(permMutes).length;

  const now = Date.now();
  let expiringCount = 0;

  for (const data of Object.values(tempBlocks)) {
    if (data.expiresAt - now <= TWENTY_FOUR_HOURS && data.expiresAt > now) {
      expiringCount++;
    }
  }
  for (const data of Object.values(tempMutes)) {
    if (data.expiresAt - now <= TWENTY_FOUR_HOURS && data.expiresAt > now) {
      expiringCount++;
    }
  }

  stats.value = { blocks: blockCount, mutes: muteCount, expiring: expiringCount };
}

async function loadExpiringItems(): Promise<void> {
  const [blocks, mutes] = await Promise.all([getTempBlocks(), getTempMutes()]);
  const now = Date.now();
  const combined: CombinedItem[] = [];

  for (const [did, data] of Object.entries(blocks)) {
    const item = data as TempItem;
    if (item.expiresAt - now <= TWENTY_FOUR_HOURS && item.expiresAt > now) {
      combined.push({
        did,
        handle: item.handle,
        expiresAt: item.expiresAt,
        createdAt: item.createdAt,
        type: 'block',
      });
    }
  }

  for (const [did, data] of Object.entries(mutes)) {
    const item = data as TempItem;
    if (item.expiresAt - now <= TWENTY_FOUR_HOURS && item.expiresAt > now) {
      combined.push({
        did,
        handle: item.handle,
        expiresAt: item.expiresAt,
        createdAt: item.createdAt,
        type: 'mute',
      });
    }
  }

  combined.sort((a, b) => a.expiresAt - b.expiresAt);
  expiringItems.value = combined.slice(0, 5);
}

async function loadRecentActivity(): Promise<void> {
  const history = await getActionHistory();
  recentActivity.value = history.slice(0, 5);
}

async function loadSyncState(): Promise<void> {
  const state = await getSyncState();
  syncState.value = state;
}

async function checkAuthStatus(): Promise<void> {
  const result = await browser.storage.local.get('authStatus');
  authExpired.value = result.authStatus === 'invalid';
}

async function loadAllData(): Promise<void> {
  loading.value = true;
  await Promise.all([
    loadStats(),
    loadExpiringItems(),
    loadRecentActivity(),
    loadSyncState(),
    checkAuthStatus(),
  ]);
  loading.value = false;
}

// Actions
function showStatus(message: string): void {
  statusMessage.value = message;
  setTimeout(() => {
    statusMessage.value = '';
  }, 3000);
}

async function removeItem(did: string, type: 'block' | 'mute'): Promise<void> {
  showStatus(type === 'block' ? 'Unblocking...' : 'Unmuting...');

  try {
    const response = (await browser.runtime.sendMessage({
      type: type === 'block' ? 'UNBLOCK_USER' : 'UNMUTE_USER',
      did,
    })) as { success: boolean; error?: string };

    if (!response.success) {
      throw new Error(response.error || 'Failed to process request');
    }

    const key = type === 'block' ? STORAGE_KEYS.TEMP_BLOCKS : STORAGE_KEYS.TEMP_MUTES;
    const result = await browser.storage.sync.get(key);
    const items = (result[key] || {}) as Record<string, TempItem>;

    delete items[did];
    await browser.storage.sync.set({ [key]: items });

    await loadStats();
    await loadExpiringItems();
    showStatus(type === 'block' ? 'Unblocked!' : 'Unmuted!');
  } catch (error) {
    console.error('[ErgoBlock Popup] Remove failed:', error);
    showStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function checkNow(): Promise<void> {
  showStatus('Checking expirations...');

  try {
    const response = (await browser.runtime.sendMessage({ type: 'CHECK_NOW' })) as { success: boolean };
    if (response.success) {
      showStatus('Check complete!');
    }
    await loadAllData();
  } catch (error) {
    const result = await browser.storage.local.get('authStatus');
    if (result.authStatus === 'invalid') {
      showStatus('Error: Session expired');
    } else {
      showStatus('Error: ' + (error instanceof Error ? error.message : String(error)));
    }
    await checkAuthStatus();
  }
}

async function syncNow(): Promise<void> {
  showStatus('Syncing with Bluesky...');

  try {
    const response = (await browser.runtime.sendMessage({ type: 'SYNC_NOW' })) as {
      success: boolean;
      error?: string;
    };

    if (response.success) {
      showStatus('Sync complete!');
    } else {
      throw new Error(response.error || 'Sync failed');
    }
    await loadAllData();
  } catch (error) {
    console.error('[ErgoBlock Popup] Sync failed:', error);
    showStatus(`Sync error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function openManager(): void {
  browser.tabs.create({ url: browser.runtime.getURL('manager.html') });
}

// Components
function PopupApp() {
  useEffect(() => {
    loadAllData();

    const interval = setInterval(() => {
      loadStats();
      loadExpiringItems();
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <Header />
      {authExpired.value && <AuthWarning />}
      <SyncStatus />
      <StatsBar />
      <ExpiringSection />
      <RecentSection />
      <Footer />
      <StatusBar />
    </>
  );
}

function Header() {
  return (
    <div class="header">
      <h1>ErgoBlock</h1>
      <button class="header-link" onClick={openManager}>
        Open Full Manager
      </button>
    </div>
  );
}

function AuthWarning() {
  return (
    <div class="auth-warning">Session Expired: Please open Bluesky to re-sync</div>
  );
}

function SyncStatus() {
  const state = syncState.value;
  if (!state || (state.lastBlockSync <= 0 && state.lastMuteSync <= 0)) {
    return null;
  }

  const lastSync = Math.max(state.lastBlockSync, state.lastMuteSync);
  return <div class="sync-status">Last sync: {formatTimestamp(lastSync)}</div>;
}

function StatsBar() {
  const { blocks, mutes, expiring } = stats.value;
  return (
    <div class="stats">
      <StatItem value={blocks} label="Blocks" />
      <StatItem value={mutes} label="Mutes" />
      <StatItem value={expiring} label="Expiring 24h" />
    </div>
  );
}

function StatItem({ value, label }: { value: number; label: string }) {
  return (
    <div class="stat">
      <div class="stat-value">{value}</div>
      <div class="stat-label">{label}</div>
    </div>
  );
}

function ExpiringSection() {
  const items = expiringItems.value;

  return (
    <div class="section">
      <div class="section-header">Expiring Soon</div>
      <div class="section-content">
        {items.length === 0 ? (
          <div class="empty">Nothing expiring soon</div>
        ) : (
          items.map((item) => <ExpiringItem key={item.did} item={item} />)
        )}
      </div>
    </div>
  );
}

function ExpiringItem({ item }: { item: CombinedItem }) {
  const handleRemove = useCallback(() => {
    removeItem(item.did, item.type);
  }, [item.did, item.type]);

  return (
    <div class="item">
      <div class="item-info">
        <div class="item-handle">@{item.handle}</div>
        <div class="item-meta">
          <span class={`item-type ${item.type}`}>{item.type}</span>
          <span>{formatTimeRemaining(item.expiresAt)}</span>
        </div>
      </div>
      <div class="item-actions">
        <button class="btn btn-remove" onClick={handleRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

function RecentSection() {
  const items = recentActivity.value;

  return (
    <div class="section">
      <div class="section-header">Recent Activity</div>
      <div class="section-content">
        {items.length === 0 ? (
          <div class="empty">No recent activity</div>
        ) : (
          items.map((entry, index) => <RecentItem key={entry.id || index} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function RecentItem({ entry }: { entry: HistoryEntry }) {
  const actionType = entry.action.includes('block') ? 'block' : 'mute';

  return (
    <div class="item">
      <div class="item-info">
        <div class="item-handle">@{entry.handle}</div>
        <div class="item-meta">
          <span class={`item-type ${actionType}`}>{entry.action}</span>
          <span>{formatTimestamp(entry.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div class="footer">
      <button class="btn btn-action" onClick={checkNow}>
        Check Now
      </button>
      <button class="btn btn-action secondary" onClick={syncNow}>
        Sync
      </button>
    </div>
  );
}

function StatusBar() {
  const message = statusMessage.value;
  if (!message) return <div class="status" />;
  return <div class="status">{message}</div>;
}

// Mount the app
const root = document.getElementById('app');
if (root) {
  render(<PopupApp />, root);
} else {
  const container = document.createElement('div');
  container.id = 'app';
  document.body.appendChild(container);
  render(<PopupApp />, container);
}
