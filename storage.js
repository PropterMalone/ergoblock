// Storage helpers for temp blocks and mutes
// Uses Chrome sync storage to persist across devices

const STORAGE_KEYS = {
  TEMP_BLOCKS: 'tempBlocks',
  TEMP_MUTES: 'tempMutes'
};

const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours default

/**
 * Get all temp blocks from storage
 * @returns {Promise<Object>} Map of DID -> { handle, expiresAt }
 */
async function getTempBlocks() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_BLOCKS);
  return result[STORAGE_KEYS.TEMP_BLOCKS] || {};
}

/**
 * Get all temp mutes from storage
 * @returns {Promise<Object>} Map of DID -> { handle, expiresAt }
 */
async function getTempMutes() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_MUTES);
  return result[STORAGE_KEYS.TEMP_MUTES] || {};
}

/**
 * Add a temp block
 * @param {string} did - User's DID
 * @param {string} handle - User's handle
 * @param {number} durationMs - Duration in milliseconds (default 24h)
 */
async function addTempBlock(did, handle, durationMs = DEFAULT_DURATION_MS) {
  const blocks = await getTempBlocks();
  blocks[did] = {
    handle,
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now()
  };
  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
  // Notify background to set alarm
  chrome.runtime.sendMessage({ type: 'TEMP_BLOCK_ADDED', did, expiresAt: blocks[did].expiresAt });
}

/**
 * Add a temp mute
 * @param {string} did - User's DID
 * @param {string} handle - User's handle
 * @param {number} durationMs - Duration in milliseconds (default 24h)
 */
async function addTempMute(did, handle, durationMs = DEFAULT_DURATION_MS) {
  const mutes = await getTempMutes();
  mutes[did] = {
    handle,
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now()
  };
  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
  // Notify background to set alarm
  chrome.runtime.sendMessage({ type: 'TEMP_MUTE_ADDED', did, expiresAt: mutes[did].expiresAt });
}

/**
 * Remove a temp block
 * @param {string} did - User's DID
 */
async function removeTempBlock(did) {
  const blocks = await getTempBlocks();
  delete blocks[did];
  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
}

/**
 * Remove a temp mute
 * @param {string} did - User's DID
 */
async function removeTempMute(did) {
  const mutes = await getTempMutes();
  delete mutes[did];
  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
}

/**
 * Get all expired temp blocks
 * @returns {Promise<Array>} Array of { did, handle } for expired blocks
 */
async function getExpiredBlocks() {
  const blocks = await getTempBlocks();
  const now = Date.now();
  return Object.entries(blocks)
    .filter(([_, data]) => data.expiresAt <= now)
    .map(([did, data]) => ({ did, handle: data.handle }));
}

/**
 * Get all expired temp mutes
 * @returns {Promise<Array>} Array of { did, handle } for expired mutes
 */
async function getExpiredMutes() {
  const mutes = await getTempMutes();
  const now = Date.now();
  return Object.entries(mutes)
    .filter(([_, data]) => data.expiresAt <= now)
    .map(([did, data]) => ({ did, handle: data.handle }));
}

// Export for use in other scripts (content script context)
if (typeof window !== 'undefined') {
  window.TempBlockStorage = {
    getTempBlocks,
    getTempMutes,
    addTempBlock,
    addTempMute,
    removeTempBlock,
    removeTempMute,
    getExpiredBlocks,
    getExpiredMutes,
    DEFAULT_DURATION_MS
  };
}
