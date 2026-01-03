// Background service worker for Bluesky Temp Block & Mute
// Handles alarm-based expiration of temp blocks and mutes

const ALARM_NAME = 'checkExpirations';
const CHECK_INTERVAL_MINUTES = 1; // Check every minute

const STORAGE_KEYS = {
  TEMP_BLOCKS: 'tempBlocks',
  TEMP_MUTES: 'tempMutes',
  AUTH_TOKEN: 'authToken'
};

/**
 * Get stored auth token (set by content script)
 */
async function getAuthToken() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN);
  return result[STORAGE_KEYS.AUTH_TOKEN];
}

/**
 * Make an authenticated API request from background
 */
async function apiRequest(endpoint, method, body, token, pdsUrl) {
  // Use provided PDS URL or fall back to default
  const baseUrl = pdsUrl || 'https://bsky.social';
  const url = `${baseUrl}/xrpc/${endpoint}`;
  console.log('[TempBlock BG] API request:', method, url);

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('[TempBlock BG] API error:', response.status, error);
    throw new Error(error.message || `API error: ${response.status}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Unblock a user
 */
async function unblockUser(did, token, ownerDid, pdsUrl) {
  // Find the block record
  const blocks = await apiRequest(
    `com.atproto.repo.listRecords?repo=${ownerDid}&collection=app.bsky.graph.block&limit=100`,
    'GET',
    null,
    token,
    pdsUrl
  );

  const blockRecord = blocks.records?.find(r => r.value.subject === did);
  if (!blockRecord) {
    console.log('[TempBlock BG] No block record found for', did);
    return false;
  }

  const rkey = blockRecord.uri.split('/').pop();
  await apiRequest('com.atproto.repo.deleteRecord', 'POST', {
    repo: ownerDid,
    collection: 'app.bsky.graph.block',
    rkey
  }, token, pdsUrl);

  return true;
}

/**
 * Unmute a user
 */
async function unmuteUser(did, token, pdsUrl) {
  await apiRequest('app.bsky.graph.unmuteActor', 'POST', {
    actor: did
  }, token, pdsUrl);
  return true;
}

/**
 * Check for and process expired blocks/mutes
 */
async function checkExpirations() {
  console.log('[TempBlock BG] Checking expirations...');

  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    console.log('[TempBlock BG] No auth token available, skipping check. Has:',
      auth ? `jwt:${!!auth.accessJwt}, did:${!!auth.did}, pds:${!!auth.pdsUrl}` : 'null');
    return;
  }

  console.log('[TempBlock BG] Using PDS:', auth.pdsUrl);
  const now = Date.now();

  // Check expired blocks
  const blocksResult = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_BLOCKS);
  const blocks = blocksResult[STORAGE_KEYS.TEMP_BLOCKS] || {};

  for (const [did, data] of Object.entries(blocks)) {
    if (data.expiresAt <= now) {
      console.log('[TempBlock BG] Unblocking expired:', data.handle);
      try {
        await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
        delete blocks[did];
        console.log('[TempBlock BG] Successfully unblocked:', data.handle);
      } catch (error) {
        console.error('[TempBlock BG] Failed to unblock:', data.handle, error);
      }
    }
  }

  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });

  // Check expired mutes
  const mutesResult = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_MUTES);
  const mutes = mutesResult[STORAGE_KEYS.TEMP_MUTES] || {};

  for (const [did, data] of Object.entries(mutes)) {
    if (data.expiresAt <= now) {
      console.log('[TempBlock BG] Unmuting expired:', data.handle);
      try {
        await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
        delete mutes[did];
        console.log('[TempBlock BG] Successfully unmuted:', data.handle);
      } catch (error) {
        console.error('[TempBlock BG] Failed to unmute:', data.handle, error);
      }
    }
  }

  await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });

  console.log('[TempBlock BG] Expiration check complete');
}

/**
 * Set up the periodic alarm
 */
async function setupAlarm() {
  // Clear any existing alarm
  await chrome.alarms.clear(ALARM_NAME);

  // Create new alarm that fires every minute
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_INTERVAL_MINUTES
  });

  console.log('[TempBlock BG] Alarm set up');
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkExpirations();
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[TempBlock BG] Received message:', message.type);

  if (message.type === 'TEMP_BLOCK_ADDED' || message.type === 'TEMP_MUTE_ADDED') {
    // Ensure alarm is running
    setupAlarm();
  }

  if (message.type === 'SET_AUTH_TOKEN') {
    // Store auth token for background use
    chrome.storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: message.auth });
    sendResponse({ success: true });
  }

  if (message.type === 'CHECK_NOW') {
    checkExpirations().then(() => sendResponse({ success: true }));
    return true; // Indicates async response
  }

  return false;
});

// Initialize on install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('[TempBlock BG] Extension installed');
  setupAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[TempBlock BG] Extension started');
  setupAlarm();
  // Check immediately on startup
  checkExpirations();
});

// Also set up alarm immediately when service worker starts
setupAlarm();
