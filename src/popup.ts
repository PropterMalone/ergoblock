// Popup script for Bluesky Temp Block & Mute

import { STORAGE_KEYS } from './storage.js';

interface TempItem {
  handle: string;
  expiresAt: number;
}

/**
 * Format remaining time
 */
function formatTimeRemaining(expiresAt: number): string {
  const now = Date.now();
  const remaining = expiresAt - now;

  if (remaining <= 0) {
    return 'Expired';
  }

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  }
  return `${minutes}m remaining`;
}

/**
 * Create an item element
 */
function createItemElement(did: string, data: TempItem, type: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';

  const info = document.createElement('div');
  info.className = 'item-info';

  const handleDiv = document.createElement('div');
  handleDiv.className = 'item-handle';
  handleDiv.textContent = `@${data.handle}`;

  const timeDiv = document.createElement('div');
  timeDiv.className = 'item-time';
  timeDiv.textContent = formatTimeRemaining(data.expiresAt);

  info.appendChild(handleDiv);
  info.appendChild(timeDiv);

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  const btn = document.createElement('button');
  btn.className = 'btn btn-remove';
  btn.dataset.did = did;
  btn.dataset.type = type;
  btn.textContent = 'Remove';

  actions.appendChild(btn);

  item.appendChild(info);
  item.appendChild(actions);

  return item;
}

/**
 * Render the blocks list
 */
async function renderBlocks(): Promise<void> {
  const list = document.getElementById('blocks-list');
  if (!list) return;

  const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_BLOCKS);
  const blocks = (result[STORAGE_KEYS.TEMP_BLOCKS] || {}) as Record<string, TempItem>;

  const entries = Object.entries(blocks);

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🚫</div>
        <div>No temporary blocks</div>
      </div>
    `;
    return;
  }

  list.innerHTML = '';
  for (const [did, data] of entries) {
    list.appendChild(createItemElement(did, data, 'block'));
  }
}

/**
 * Render the mutes list
 */
async function renderMutes(): Promise<void> {
  const list = document.getElementById('mutes-list');
  if (!list) return;

  const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_MUTES);
  const mutes = (result[STORAGE_KEYS.TEMP_MUTES] || {}) as Record<string, TempItem>;

  const entries = Object.entries(mutes);

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔇</div>
        <div>No temporary mutes</div>
      </div>
    `;
    return;
  }

  list.innerHTML = '';
  for (const [did, data] of entries) {
    list.appendChild(createItemElement(did, data, 'mute'));
  }
}

/**
 * Remove a temp block or mute
 */
async function removeItem(did: string, type: string): Promise<void> {
  const key = type === 'block' ? STORAGE_KEYS.TEMP_BLOCKS : STORAGE_KEYS.TEMP_MUTES;
  const result = await chrome.storage.sync.get(key);
  const items = (result[key] || {}) as Record<string, TempItem>;

  delete items[did];
  await chrome.storage.sync.set({ [key]: items });

  // Re-render
  if (type === 'block') {
    renderBlocks();
  } else {
    renderMutes();
  }

  updateStatus('Item removed (user remains blocked/muted until you manually unblock/unmute)');
}

/**
 * Switch tabs
 */
async function switchTab(tab: string): Promise<void> {
  // Save to storage
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_TAB]: tab });

  // Update tab styles
  document.querySelectorAll('.tab').forEach((t) => {
    const el = t as HTMLElement;
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  // Show/hide lists
  const blocksList = document.getElementById('blocks-list');
  const mutesList = document.getElementById('mutes-list');
  if (blocksList) blocksList.style.display = tab === 'blocks' ? 'block' : 'none';
  if (mutesList) mutesList.style.display = tab === 'mutes' ? 'block' : 'none';
}

/**
 * Update status message
 */
function updateStatus(message: string): void {
  const status = document.getElementById('status');
  if (!status) return;

  status.textContent = message;
  setTimeout(() => {
    status.textContent = '';
  }, 3000);
}

/**
 * Check and display auth status
 */
async function checkAuthStatus(): Promise<void> {
  const warning = document.getElementById('auth-warning');
  if (!warning) return;

  const result = await chrome.storage.local.get('authStatus');
  const status = result.authStatus || 'unknown';

  if (status === 'invalid') {
    warning.style.display = 'block';
  } else {
    warning.style.display = 'none';
  }
}

/**
 * Check expirations now
 */
async function checkNow(): Promise<void> {
  updateStatus('Checking expirations...');

  try {
    const response = (await chrome.runtime.sendMessage({ type: 'CHECK_NOW' })) as {
      success: boolean;
    };
    if (response.success) {
      updateStatus('Check complete!');
    }

    // Re-render lists
    renderBlocks();
    renderMutes();
    checkAuthStatus();
  } catch (error) {
    const result = await chrome.storage.local.get('authStatus');
    if (result.authStatus === 'invalid') {
      updateStatus('Error: Session expired');
    } else {
      updateStatus('Error: ' + (error instanceof Error ? error.message : String(error)));
    }
    checkAuthStatus();
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Load last active tab
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_TAB);
  const lastTab = (result[STORAGE_KEYS.LAST_TAB] as string) || 'blocks';

  await switchTab(lastTab);
  renderBlocks();
  renderMutes();
  checkAuthStatus();

  // Tab switching
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const el = tab as HTMLElement;
      if (el.dataset.tab) {
        switchTab(el.dataset.tab);
      }
    });
  });

  // Check now button
  const checkNowBtn = document.getElementById('check-now');
  if (checkNowBtn) {
    checkNowBtn.addEventListener('click', checkNow);
  }

  // Remove buttons (delegated)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('btn-remove')) {
      const did = target.dataset.did;
      const type = target.dataset.type;
      if (did && type) {
        removeItem(did, type);
      }
    }
  });
});

// Refresh lists periodically while popup is open
setInterval(() => {
  const activeTab = document.querySelector('.tab.active') as HTMLElement;
  const currentTab = activeTab?.dataset.tab || 'blocks';

  if (currentTab === 'blocks') {
    renderBlocks();
  } else {
    renderMutes();
  }
}, 30000); // Every 30 seconds
