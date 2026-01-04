import {
  getTempBlocks,
  getTempMutes,
  removeTempBlock,
  removeTempMute,
  getOptions,
  addHistoryEntry,
} from './storage.js';
import { ListRecordsResponse } from './types.js';

const ALARM_NAME = 'checkExpirations';

interface AuthData {
  accessJwt: string;
  did: string;
  pdsUrl: string;
}

async function getAuthToken(): Promise<AuthData | null> {
  const result = await chrome.storage.local.get('authToken');
  return (result.authToken as AuthData) || null;
}

export async function apiRequest<T>(
  endpoint: string,
  method: string,
  body: Record<string, unknown> | null,
  token: string,
  pdsUrl: string
): Promise<T | null> {
  const baseUrl = pdsUrl || 'https://bsky.social';
  const url = `${baseUrl}/xrpc/${endpoint}`;
  console.log('[ErgoBlock BG] API request:', method, url);

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    console.error('[ErgoBlock BG] API error:', response.status, error);
    throw new Error(error.message || `API error: ${response.status}`);
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

export async function unblockUser(
  did: string,
  token: string,
  ownerDid: string,
  pdsUrl: string
): Promise<boolean> {
  const blocks = await apiRequest<ListRecordsResponse>(
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

  const rkey = blockRecord.uri.split('/').pop();
  await apiRequest(
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

export async function unmuteUser(did: string, token: string, pdsUrl: string): Promise<boolean> {
  await apiRequest('app.bsky.graph.unmuteActor', 'POST', { actor: did }, token, pdsUrl);
  return true;
}

export async function updateBadge(): Promise<void> {
  const options = await getOptions();
  if (!options.showBadgeCount) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const blocks = await getTempBlocks();
  const mutes = await getTempMutes();
  const count = Object.keys(blocks).length + Object.keys(mutes).length;

  await chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#1185fe' });
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

  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    silent: !options.notificationSound,
  });
}

export async function checkExpirations(): Promise<void> {
  console.log('[ErgoBlock BG] Checking expirations...');

  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    console.log('[ErgoBlock BG] No auth token available, skipping check');
    return;
  }

  console.log('[ErgoBlock BG] Using PDS:', auth.pdsUrl);
  const now = Date.now();

  // Check expired blocks
  const blocks = await getTempBlocks();
  const expiredBlocks: Array<{ did: string; handle: string }> = [];

  for (const [did, data] of Object.entries(blocks)) {
    if (data.expiresAt <= now) {
      console.log('[ErgoBlock BG] Unblocking expired:', data.handle);
      try {
        await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
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
        expiredBlocks.push({ did, handle: data.handle });
        await sendNotification('expired_success', data.handle, 'block');
      } catch (error) {
        console.error('[ErgoBlock BG] Failed to unblock:', data.handle, error);
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
  const expiredMutes: Array<{ did: string; handle: string }> = [];

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
        expiredMutes.push({ did, handle: data.handle });
        await sendNotification('expired_success', data.handle, 'mute');
      } catch (error) {
        console.error('[ErgoBlock BG] Failed to unmute:', data.handle, error);
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

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: intervalMinutes,
  });
  console.log('[ErgoBlock BG] Alarm set up with interval:', intervalMinutes, 'minutes');
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkExpirations();
  }
});

// Listen for messages from content script
interface ExtensionMessage {
  type: string;
  auth?: AuthData;
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: { success: boolean }) => void) => {
    console.log('[ErgoBlock BG] Received message:', message.type);

    if (message.type === 'TEMP_BLOCK_ADDED' || message.type === 'TEMP_MUTE_ADDED') {
      setupAlarm();
      updateBadge();
    }

    if (message.type === 'SET_AUTH_TOKEN' && message.auth) {
      chrome.storage.local.set({ authToken: message.auth });
      sendResponse({ success: true });
    }

    if (message.type === 'CHECK_NOW') {
      checkExpirations().then(() => sendResponse({ success: true }));
      return true; // Indicates async response
    }

    return false;
  }
);

// Initialize on install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ErgoBlock BG] Extension installed');
  setupAlarm();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[ErgoBlock BG] Extension started');
  setupAlarm();
  updateBadge();
});
