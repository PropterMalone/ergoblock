import browser from './browser.js';
import { executeApiRequest } from './api.js';
import {
  getTempBlocks,
  getTempMutes,
  removeTempBlock,
  removeTempMute,
  getOptions,
  addHistoryEntry,
  cleanupExpiredPostContexts,
  getPermanentBlocks,
  setPermanentBlocks,
  getPermanentMutes,
  setPermanentMutes,
  getSyncState,
  updateSyncState,
} from './storage.js';
import { ListRecordsResponse, GetBlocksResponse, GetMutesResponse, ProfileView } from './types.js';

const ALARM_NAME = 'checkExpirations';
const SYNC_ALARM_NAME = 'syncWithBluesky';
const SYNC_INTERVAL_MINUTES = 15;
const PAGINATION_DELAY = 500; // ms between paginated requests

interface AuthData {
  accessJwt: string;
  did: string;
  pdsUrl: string;
}

async function getAuthToken(): Promise<AuthData | null> {
  const result = await browser.storage.local.get('authToken');
  return (result.authToken as AuthData) || null;
}

/**
 * Wrapper for API requests that handles auth status updates
 */
async function bgApiRequest<T>(
  endpoint: string,
  method: string,
  body: unknown,
  token: string,
  pdsUrl: string
): Promise<T | null> {
  try {
    // Background operations should always use the PDS to ensure consistent writes to the user's repo.
    const result = await executeApiRequest<T>(
      endpoint,
      method,
      body,
      { accessJwt: token, pdsUrl },
      pdsUrl // Force PDS for background operations to ensure write consistency
    );

    // If request was successful, ensure status is valid
    await browser.storage.local.set({ authStatus: 'valid' });
    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('401') || error.message.includes('Auth error'))
    ) {
      console.error('[ErgoBlock BG] Auth failed (401), marking session invalid');
      await browser.storage.local.set({ authStatus: 'invalid' });
    }
    throw error;
  }
}

export async function unblockUser(
  did: string,
  token: string,
  ownerDid: string,
  pdsUrl: string,
  rkey?: string
): Promise<boolean> {
  // If we have the rkey, delete directly (O(1))
  if (rkey) {
    console.log('[ErgoBlock BG] Unblocking using direct rkey:', rkey);
    await bgApiRequest(
      'com.atproto.repo.deleteRecord',
      'POST',
      {
        repo: ownerDid,
        collection: 'app.bsky.graph.block',
        rkey,
      },
      token,
      pdsUrl
    );
    return true;
  }

  // Fallback: find the block record (legacy method, O(N))
  console.log('[ErgoBlock BG] Unblocking using list scan (legacy)...');
  const blocks = await bgApiRequest<ListRecordsResponse>(
    `com.atproto.repo.listRecords?repo=${ownerDid}&collection=app.bsky.graph.block&limit=100`,
    'GET',
    null,
    token,
    pdsUrl
  );

  const blockRecord = blocks?.records?.find((r) => r.value.subject === did);
  if (!blockRecord) {
    console.log('[ErgoBlock BG] No block record found for', did);
    return false;
  }

  const foundRkey = blockRecord.uri.split('/').pop();
  if (!foundRkey) {
    console.log('[ErgoBlock BG] Could not determine rkey from block URI', blockRecord.uri);
    return false;
  }

  await bgApiRequest(
    'com.atproto.repo.deleteRecord',
    'POST',
    {
      repo: ownerDid,
      collection: 'app.bsky.graph.block',
      rkey: foundRkey,
    },
    token,
    pdsUrl
  );

  return true;
}

export async function unmuteUser(did: string, token: string, pdsUrl: string): Promise<boolean> {
  await bgApiRequest('app.bsky.graph.unmuteActor', 'POST', { actor: did }, token, pdsUrl);
  return true;
}

export async function updateBadge(): Promise<void> {
  const options = await getOptions();
  if (!options.showBadgeCount) {
    await browser.action.setBadgeText({ text: '' });
    return;
  }

  const blocks = await getTempBlocks();
  const mutes = await getTempMutes();
  const count = Object.keys(blocks).length + Object.keys(mutes).length;

  await browser.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
  await browser.action.setBadgeBackgroundColor({ color: '#1185fe' });
}

export async function sendNotification(
  type: 'expired_success' | 'expired_failure',
  handle: string,
  action: 'block' | 'mute',
  error?: string
): Promise<void> {
  const options = await getOptions();
  if (!options.notificationsEnabled) {
    return;
  }

  let title: string;
  let message: string;

  if (type === 'expired_success') {
    title = '✅ Temporary action expired';
    message = `Your temporary ${action} of @${handle} has been lifted`;
  } else {
    title = '⚠️ Action failed';
    message = `Failed to ${action} @${handle}: ${error || 'Unknown error'}`;
  }

  await browser.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    silent: !options.notificationSound,
  });
}

// ============================================================================
// Sync Engine - Two-way sync with Bluesky
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all blocks from Bluesky with pagination
 */
async function fetchAllBlocks(auth: AuthData): Promise<ProfileView[]> {
  const allBlocks: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = 'app.bsky.graph.getBlocks?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetBlocksResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.blocks) {
      allBlocks.push(...response.blocks);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allBlocks;
}

/**
 * Fetch all mutes from Bluesky with pagination
 */
async function fetchAllMutes(auth: AuthData): Promise<ProfileView[]> {
  const allMutes: ProfileView[] = [];
  let cursor: string | undefined;

  do {
    let endpoint = 'app.bsky.graph.getMutes?limit=100';
    if (cursor) {
      endpoint += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await bgApiRequest<GetMutesResponse>(
      endpoint,
      'GET',
      null,
      auth.accessJwt,
      auth.pdsUrl
    );

    if (response?.mutes) {
      allMutes.push(...response.mutes);
    }
    cursor = response?.cursor;

    if (cursor) {
      await sleep(PAGINATION_DELAY);
    }
  } while (cursor);

  return allMutes;
}

/**
 * Sync blocks from Bluesky
 * - Adds new blocks found in Bluesky to permanent storage
 * - Removes temp blocks that no longer exist in Bluesky (user unblocked externally)
 */
async function syncBlocks(auth: AuthData): Promise<{ added: number; removed: number }> {
  const now = Date.now();
  let added = 0;
  let removed = 0;

  // Fetch current blocks from Bluesky
  const bskyBlocks = await fetchAllBlocks(auth);
  const bskyBlockDids = new Set(bskyBlocks.map((b) => b.did));

  // Get current storage
  const [tempBlocks, permanentBlocks] = await Promise.all([
    getTempBlocks(),
    getPermanentBlocks(),
  ]);

  // Build new permanent blocks map
  const newPermanentBlocks: Record<string, { did: string; handle: string; displayName?: string; avatar?: string; syncedAt: number }> = {};

  for (const block of bskyBlocks) {
    // Skip if it's a temp block (we track those separately)
    if (tempBlocks[block.did]) {
      continue;
    }

    // Add to permanent blocks
    newPermanentBlocks[block.did] = {
      did: block.did,
      handle: block.handle,
      displayName: block.displayName,
      avatar: block.avatar,
      syncedAt: permanentBlocks[block.did]?.syncedAt || now,
    };

    if (!permanentBlocks[block.did]) {
      added++;
    }
  }

  // Check for temp blocks that no longer exist in Bluesky (user unblocked externally)
  for (const did of Object.keys(tempBlocks)) {
    if (!bskyBlockDids.has(did)) {
      console.log('[ErgoBlock BG] Temp block removed externally:', tempBlocks[did].handle);
      await removeTempBlock(did);
      await addHistoryEntry({
        did,
        handle: tempBlocks[did].handle,
        action: 'unblocked',
        timestamp: now,
        trigger: 'removed', // User removed externally
        success: true,
      });
      removed++;
    }
  }

  await setPermanentBlocks(newPermanentBlocks);
  return { added, removed };
}

/**
 * Sync mutes from Bluesky
 * - Adds new mutes found in Bluesky to permanent storage
 * - Removes temp mutes that no longer exist in Bluesky (user unmuted externally)
 */
async function syncMutes(auth: AuthData): Promise<{ added: number; removed: number }> {
  const now = Date.now();
  let added = 0;
  let removed = 0;

  // Fetch current mutes from Bluesky
  const bskyMutes = await fetchAllMutes(auth);
  const bskyMuteDids = new Set(bskyMutes.map((m) => m.did));

  // Get current storage
  const [tempMutes, permanentMutes] = await Promise.all([
    getTempMutes(),
    getPermanentMutes(),
  ]);

  // Build new permanent mutes map
  const newPermanentMutes: Record<string, { did: string; handle: string; displayName?: string; avatar?: string; syncedAt: number }> = {};

  for (const mute of bskyMutes) {
    // Skip if it's a temp mute (we track those separately)
    if (tempMutes[mute.did]) {
      continue;
    }

    // Add to permanent mutes
    newPermanentMutes[mute.did] = {
      did: mute.did,
      handle: mute.handle,
      displayName: mute.displayName,
      avatar: mute.avatar,
      syncedAt: permanentMutes[mute.did]?.syncedAt || now,
    };

    if (!permanentMutes[mute.did]) {
      added++;
    }
  }

  // Check for temp mutes that no longer exist in Bluesky (user unmuted externally)
  for (const did of Object.keys(tempMutes)) {
    if (!bskyMuteDids.has(did)) {
      console.log('[ErgoBlock BG] Temp mute removed externally:', tempMutes[did].handle);
      await removeTempMute(did);
      await addHistoryEntry({
        did,
        handle: tempMutes[did].handle,
        action: 'unmuted',
        timestamp: now,
        trigger: 'removed', // User removed externally
        success: true,
      });
      removed++;
    }
  }

  await setPermanentMutes(newPermanentMutes);
  return { added, removed };
}

/**
 * Perform full sync with Bluesky
 */
export async function performFullSync(): Promise<{ success: boolean; error?: string; blocks?: { added: number; removed: number }; mutes?: { added: number; removed: number } }> {
  const syncState = await getSyncState();

  // Prevent concurrent syncs
  if (syncState.syncInProgress) {
    console.log('[ErgoBlock BG] Sync already in progress, skipping');
    return { success: false, error: 'Sync already in progress' };
  }

  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    console.log('[ErgoBlock BG] No auth token available, skipping sync');
    return { success: false, error: 'Not authenticated' };
  }

  console.log('[ErgoBlock BG] Starting full sync with Bluesky...');
  await updateSyncState({ syncInProgress: true, lastError: undefined });

  try {
    const [blockResult, muteResult] = await Promise.all([
      syncBlocks(auth),
      syncMutes(auth),
    ]);

    await updateSyncState({
      syncInProgress: false,
      lastBlockSync: Date.now(),
      lastMuteSync: Date.now(),
    });

    console.log('[ErgoBlock BG] Sync complete:', {
      blocks: blockResult,
      mutes: muteResult,
    });

    await updateBadge();

    return {
      success: true,
      blocks: blockResult,
      mutes: muteResult,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ErgoBlock BG] Sync failed:', errorMessage);

    await updateSyncState({
      syncInProgress: false,
      lastError: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * Set up sync alarm
 */
export async function setupSyncAlarm(): Promise<void> {
  await browser.alarms.clear(SYNC_ALARM_NAME);
  await browser.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
    delayInMinutes: 1, // First sync 1 minute after startup
  });
  console.log('[ErgoBlock BG] Sync alarm set up with interval:', SYNC_INTERVAL_MINUTES, 'minutes');
}

// ============================================================================
// Expiration checking
// ============================================================================

export async function checkExpirations(): Promise<void> {
  console.log('[ErgoBlock BG] Checking expirations...');

  // Clean up expired screenshots based on retention policy
  await cleanupExpiredPostContexts();

  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    console.log('[ErgoBlock BG] No auth token available, skipping check');
    await browser.storage.local.set({ authStatus: 'invalid' });
    return;
  }

  console.log('[ErgoBlock BG] Using PDS:', auth.pdsUrl);
  const now = Date.now();

  // Check expired blocks
  const blocks = await getTempBlocks();

  for (const [did, data] of Object.entries(blocks)) {
    if (data.expiresAt <= now) {
      console.log('[ErgoBlock BG] Unblocking expired:', data.handle);
      try {
        await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, data.rkey);
        await removeTempBlock(did);
        await addHistoryEntry({
          did,
          handle: data.handle,
          action: 'unblocked',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: true,
          duration: data.createdAt ? Date.now() - data.createdAt : undefined,
        });
        console.log('[ErgoBlock BG] Successfully unblocked:', data.handle);
        await sendNotification('expired_success', data.handle, 'block');
      } catch (error) {
        console.error('[ErgoBlock BG] Failed to unblock:', data.handle, error);

        // If it's an auth error, we stop processing further entries
        if (
          error instanceof Error &&
          (error.message.includes('401') || error.message.includes('Auth error'))
        ) {
          return;
        }

        await addHistoryEntry({
          did,
          handle: data.handle,
          action: 'unblocked',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        await sendNotification(
          'expired_failure',
          data.handle,
          'block',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  // Check expired mutes
  const mutes = await getTempMutes();

  for (const [did, data] of Object.entries(mutes)) {
    if (data.expiresAt <= now) {
      console.log('[ErgoBlock BG] Unmuting expired:', data.handle);
      try {
        await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
        await removeTempMute(did);
        await addHistoryEntry({
          did,
          handle: data.handle,
          action: 'unmuted',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: true,
          duration: data.createdAt ? Date.now() - data.createdAt : undefined,
        });
        console.log('[ErgoBlock BG] Successfully unmuted:', data.handle);
        await sendNotification('expired_success', data.handle, 'mute');
      } catch (error) {
        console.error('[ErgoBlock BG] Failed to unmute:', data.handle, error);

        // If it's an auth error, we stop processing further entries
        if (
          error instanceof Error &&
          (error.message.includes('401') || error.message.includes('Auth error'))
        ) {
          return;
        }

        await addHistoryEntry({
          did,
          handle: data.handle,
          action: 'unmuted',
          timestamp: Date.now(),
          trigger: 'auto_expire',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        await sendNotification(
          'expired_failure',
          data.handle,
          'mute',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  await updateBadge();
  console.log('[ErgoBlock BG] Expiration check complete');
}

export async function setupAlarm(): Promise<void> {
  const options = await getOptions();
  const intervalMinutes = Math.max(1, Math.min(10, options.checkInterval));

  await browser.alarms.clear(ALARM_NAME);
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: intervalMinutes,
  });
  console.log('[ErgoBlock BG] Alarm set up with interval:', intervalMinutes, 'minutes');
}

// Listen for alarm events
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkExpirations();
  }
  if (alarm.name === SYNC_ALARM_NAME) {
    performFullSync();
  }
});

// Listen for messages from content script and popup
interface ExtensionMessage {
  type: string;
  auth?: AuthData;
  did?: string;
}

type MessageResponse = { success: boolean; error?: string };

/**
 * Handle unblock request from popup
 */
async function handleUnblockRequest(did: string): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the rkey from storage if available
    const blocks = await getTempBlocks();
    const blockData = blocks[did];
    const rkey = blockData?.rkey;

    await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl, rkey);
    await updateBadge();
    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Unblock failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle unmute request from popup
 */
async function handleUnmuteRequest(did: string): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
    await updateBadge();
    return { success: true };
  } catch (error) {
    console.error('[ErgoBlock BG] Unmute failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

browser.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: MessageResponse) => void) => {
    console.log('[ErgoBlock BG] Received message:', message.type);

    if (message.type === 'TEMP_BLOCK_ADDED' || message.type === 'TEMP_MUTE_ADDED') {
      setupAlarm();
      updateBadge();
    }

    if (message.type === 'SET_AUTH_TOKEN' && message.auth) {
      browser.storage.local.set({ authToken: message.auth });
      sendResponse({ success: true });
    }

    if (message.type === 'CHECK_NOW') {
      checkExpirations().then(() => sendResponse({ success: true }));
      return true; // Indicates async response
    }

    if (message.type === 'SYNC_NOW') {
      performFullSync().then((result) => sendResponse(result));
      return true; // Indicates async response
    }

    if (message.type === 'UNBLOCK_USER' && message.did) {
      handleUnblockRequest(message.did).then(sendResponse);
      return true; // Indicates async response
    }

    if (message.type === 'UNMUTE_USER' && message.did) {
      handleUnmuteRequest(message.did).then(sendResponse);
      return true; // Indicates async response
    }

    return false;
  }
);

// Initialize on install/startup
browser.runtime.onInstalled.addListener(() => {
  console.log('[ErgoBlock BG] Extension installed');
  setupAlarm();
  setupSyncAlarm();
  updateBadge();
});

browser.runtime.onStartup.addListener(() => {
  console.log('[ErgoBlock BG] Extension started');
  setupAlarm();
  setupSyncAlarm();
  updateBadge();
});
