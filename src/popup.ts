// Popup script for Bluesky Temp Block & Mute

const STORAGE_KEYS = {
  TEMP_BLOCKS: 'tempBlocks',
  TEMP_MUTES: 'tempMutes',
};

interface TempItem {
  handle: string;
  expiresAt: number;
}

let currentTab = 'blocks';

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
  item.innerHTML = `
    <div class="item-info">
      <div class="item-handle">@${data.handle}</div>
      <div class="item-time">${formatTimeRemaining(data.expiresAt)}</div>
    </div>
    <div class="item-actions">
      <button class="btn btn-remove" data-did="${did}" data-type="${type}">
        Remove
      </button>
    </div>
  `;
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
function switchTab(tab: string): void {
  currentTab = tab;

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
 * Check expirations now
 */
async function checkNow(): Promise<void> {
  updateStatus('Checking expirations...');

  try {
    await chrome.runtime.sendMessage({ type: 'CHECK_NOW' });
    updateStatus('Check complete!');

    // Re-render lists
    renderBlocks();
    renderMutes();
  } catch (error) {
    updateStatus('Error: ' + (error instanceof Error ? error.message : String(error)));
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  renderBlocks();
  renderMutes();

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
  if (currentTab === 'blocks') {
    renderBlocks();
  } else {
    renderMutes();
  }
}, 30000); // Every 30 seconds
