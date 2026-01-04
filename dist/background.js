"use strict";
(() => {
  // src/types.ts
  var DEFAULT_OPTIONS = {
    defaultDuration: 864e5,
    // 24 hours
    quickBlockDuration: 36e5,
    // 1 hour
    notificationsEnabled: true,
    notificationSound: false,
    checkInterval: 1,
    showBadgeCount: true,
    theme: "auto"
  };

  // src/storage.ts
  var STORAGE_KEYS = {
    TEMP_BLOCKS: "tempBlocks",
    TEMP_MUTES: "tempMutes",
    OPTIONS: "extensionOptions",
    ACTION_HISTORY: "actionHistory"
  };
  var HISTORY_MAX_ENTRIES = 100;
  var DEFAULT_DURATION_MS = 24 * 60 * 60 * 1e3;
  async function getTempBlocks() {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_BLOCKS);
    return result[STORAGE_KEYS.TEMP_BLOCKS] || {};
  }
  async function getTempMutes() {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_MUTES);
    return result[STORAGE_KEYS.TEMP_MUTES] || {};
  }
  async function removeTempBlock(did) {
    const blocks = await getTempBlocks();
    delete blocks[did];
    await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
  }
  async function removeTempMute(did) {
    const mutes = await getTempMutes();
    delete mutes[did];
    await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
  }
  async function getOptions() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS);
    return result[STORAGE_KEYS.OPTIONS] || DEFAULT_OPTIONS;
  }
  async function getActionHistory() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ACTION_HISTORY);
    const history = result[STORAGE_KEYS.ACTION_HISTORY] || [];
    return history;
  }
  async function addHistoryEntry(entry) {
    const entryWithId = {
      ...entry,
      id: entry.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    const history = await getActionHistory();
    history.unshift(entryWithId);
    const trimmed = history.slice(0, HISTORY_MAX_ENTRIES);
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTION_HISTORY]: trimmed });
  }

  // src/background.ts
  var ALARM_NAME = "checkExpirations";
  async function getAuthToken() {
    const result = await chrome.storage.local.get("authToken");
    return result.authToken || null;
  }
  async function apiRequest(endpoint, method, body, token, pdsUrl) {
    const baseUrl = pdsUrl || "https://bsky.social";
    const url = `${baseUrl}/xrpc/${endpoint}`;
    console.log("[ErgoBlock BG] API request:", method, url);
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error("[ErgoBlock BG] API error:", response.status, error);
      throw new Error(error.message || `API error: ${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async function unblockUser(did, token, ownerDid, pdsUrl) {
    const blocks = await apiRequest(
      `com.atproto.repo.listRecords?repo=${ownerDid}&collection=app.bsky.graph.block&limit=100`,
      "GET",
      null,
      token,
      pdsUrl
    );
    const blockRecord = blocks?.records?.find((r) => r.value.subject === did);
    if (!blockRecord) {
      console.log("[ErgoBlock BG] No block record found for", did);
      return false;
    }
    const rkey = blockRecord.uri.split("/").pop();
    await apiRequest(
      "com.atproto.repo.deleteRecord",
      "POST",
      {
        repo: ownerDid,
        collection: "app.bsky.graph.block",
        rkey
      },
      token,
      pdsUrl
    );
    return true;
  }
  async function unmuteUser(did, token, pdsUrl) {
    await apiRequest("app.bsky.graph.unmuteActor", "POST", { actor: did }, token, pdsUrl);
    return true;
  }
  async function updateBadge() {
    const options = await getOptions();
    if (!options.showBadgeCount) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }
    const blocks = await getTempBlocks();
    const mutes = await getTempMutes();
    const count = Object.keys(blocks).length + Object.keys(mutes).length;
    await chrome.action.setBadgeText({ text: count > 0 ? count.toString() : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#1185fe" });
  }
  async function sendNotification(type, handle, action, error) {
    const options = await getOptions();
    if (!options.notificationsEnabled) {
      return;
    }
    let title;
    let message;
    if (type === "expired_success") {
      title = "\u2705 Temporary action expired";
      message = `Your temporary ${action} of @${handle} has been lifted`;
    } else {
      title = "\u26A0\uFE0F Action failed";
      message = `Failed to ${action} @${handle}: ${error || "Unknown error"}`;
    }
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      silent: !options.notificationSound
    });
  }
  async function checkExpirations() {
    console.log("[ErgoBlock BG] Checking expirations...");
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      console.log("[ErgoBlock BG] No auth token available, skipping check");
      return;
    }
    console.log("[ErgoBlock BG] Using PDS:", auth.pdsUrl);
    const now = Date.now();
    const blocks = await getTempBlocks();
    const expiredBlocks = [];
    for (const [did, data] of Object.entries(blocks)) {
      if (data.expiresAt <= now) {
        console.log("[ErgoBlock BG] Unblocking expired:", data.handle);
        try {
          await unblockUser(did, auth.accessJwt, auth.did, auth.pdsUrl);
          await removeTempBlock(did);
          await addHistoryEntry({
            did,
            handle: data.handle,
            action: "unblocked",
            timestamp: Date.now(),
            trigger: "auto_expire",
            success: true,
            duration: data.createdAt ? Date.now() - data.createdAt : void 0
          });
          console.log("[ErgoBlock BG] Successfully unblocked:", data.handle);
          expiredBlocks.push({ did, handle: data.handle });
          await sendNotification("expired_success", data.handle, "block");
        } catch (error) {
          console.error("[ErgoBlock BG] Failed to unblock:", data.handle, error);
          await addHistoryEntry({
            did,
            handle: data.handle,
            action: "unblocked",
            timestamp: Date.now(),
            trigger: "auto_expire",
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
          });
          await sendNotification(
            "expired_failure",
            data.handle,
            "block",
            error instanceof Error ? error.message : "Unknown error"
          );
        }
      }
    }
    const mutes = await getTempMutes();
    const expiredMutes = [];
    for (const [did, data] of Object.entries(mutes)) {
      if (data.expiresAt <= now) {
        console.log("[ErgoBlock BG] Unmuting expired:", data.handle);
        try {
          await unmuteUser(did, auth.accessJwt, auth.pdsUrl);
          await removeTempMute(did);
          await addHistoryEntry({
            did,
            handle: data.handle,
            action: "unmuted",
            timestamp: Date.now(),
            trigger: "auto_expire",
            success: true,
            duration: data.createdAt ? Date.now() - data.createdAt : void 0
          });
          console.log("[ErgoBlock BG] Successfully unmuted:", data.handle);
          expiredMutes.push({ did, handle: data.handle });
          await sendNotification("expired_success", data.handle, "mute");
        } catch (error) {
          console.error("[ErgoBlock BG] Failed to unmute:", data.handle, error);
          await addHistoryEntry({
            did,
            handle: data.handle,
            action: "unmuted",
            timestamp: Date.now(),
            trigger: "auto_expire",
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
          });
          await sendNotification(
            "expired_failure",
            data.handle,
            "mute",
            error instanceof Error ? error.message : "Unknown error"
          );
        }
      }
    }
    await updateBadge();
    console.log("[ErgoBlock BG] Expiration check complete");
  }
  async function setupAlarm() {
    const options = await getOptions();
    const intervalMinutes = Math.max(1, Math.min(10, options.checkInterval));
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: intervalMinutes
    });
    console.log("[ErgoBlock BG] Alarm set up with interval:", intervalMinutes, "minutes");
  }
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      checkExpirations();
    }
  });
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      console.log("[ErgoBlock BG] Received message:", message.type);
      if (message.type === "TEMP_BLOCK_ADDED" || message.type === "TEMP_MUTE_ADDED") {
        setupAlarm();
        updateBadge();
      }
      if (message.type === "SET_AUTH_TOKEN" && message.auth) {
        chrome.storage.local.set({ authToken: message.auth });
        sendResponse({ success: true });
      }
      if (message.type === "CHECK_NOW") {
        checkExpirations().then(() => sendResponse({ success: true }));
        return true;
      }
      return false;
    }
  );
  chrome.runtime.onInstalled.addListener(() => {
    console.log("[ErgoBlock BG] Extension installed");
    setupAlarm();
    updateBadge();
  });
  chrome.runtime.onStartup.addListener(() => {
    console.log("[ErgoBlock BG] Extension started");
    setupAlarm();
    updateBadge();
  });
})();
