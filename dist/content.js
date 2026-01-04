"use strict";
(() => {
  // src/api.ts
  var BSKY_PUBLIC_API = "https://public.api.bsky.app";
  var BSKY_PDS_DEFAULT = "https://bsky.social";
  function getSession() {
    try {
      const possibleKeys = Object.keys(localStorage).filter(
        (k) => k.includes("BSKY") || k.includes("bsky") || k.includes("session")
      );
      console.log("[TempBlock] Found storage keys:", possibleKeys);
      for (const storageKey of possibleKeys) {
        try {
          const raw = localStorage.getItem(storageKey);
          if (!raw) continue;
          const storage = JSON.parse(raw);
          console.log("[TempBlock] Checking storage key:", storageKey, storage);
          let session = null;
          if (storage?.session?.currentAccount) {
            const currentDid = storage.session.currentAccount.did;
            const account = storage.session.accounts?.find((a) => a.did === currentDid);
            if (account?.accessJwt) {
              session = account;
            }
          }
          if (!session && storage?.currentAccount) {
            const currentDid = storage.currentAccount.did;
            const account = storage.accounts?.find((a) => a.did === currentDid);
            if (account?.accessJwt) {
              session = account;
            }
          }
          if (!session && storage?.accessJwt && storage?.did) {
            session = storage;
          }
          if (session) {
            console.log("[TempBlock] Found session for:", session.handle || session.did);
            let pdsUrl = session.pdsUrl || session.service || BSKY_PDS_DEFAULT;
            pdsUrl = pdsUrl.replace(/\/+$/, "");
            if (!pdsUrl.startsWith("http://") && !pdsUrl.startsWith("https://")) {
              pdsUrl = "https://" + pdsUrl;
            }
            console.log("[TempBlock] Using PDS URL:", pdsUrl);
            return {
              accessJwt: session.accessJwt,
              refreshJwt: session.refreshJwt,
              did: session.did,
              handle: session.handle,
              pdsUrl
            };
          }
        } catch {
        }
      }
      console.error("[TempBlock] No valid session found in localStorage");
      return null;
    } catch (e) {
      console.error("[TempBlock] Failed to get session:", e);
      return null;
    }
  }
  async function apiRequest(endpoint, method = "GET", body = null, baseUrl = null) {
    const session = getSession();
    if (!session) {
      throw new Error("Not logged in to Bluesky");
    }
    let base = baseUrl;
    if (!base) {
      if (endpoint.startsWith("com.atproto.repo.")) {
        base = session.pdsUrl;
      } else {
        base = BSKY_PUBLIC_API;
      }
    }
    base = base.replace(/\/+$/, "");
    const url = `${base}/xrpc/${endpoint}`;
    console.log("[TempBlock] API request:", method, url);
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        "Content-Type": "application/json"
      }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error("[TempBlock] API error:", response.status, error);
      throw new Error(error.message || `API error: ${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async function blockUser(did) {
    const session = getSession();
    if (!session) throw new Error("Not logged in");
    const record = {
      $type: "app.bsky.graph.block",
      subject: did,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return await apiRequest("com.atproto.repo.createRecord", "POST", {
      repo: session.did,
      collection: "app.bsky.graph.block",
      record
    });
  }
  async function muteUser(did) {
    const session = getSession();
    if (!session) throw new Error("Not logged in");
    await apiRequest(
      "app.bsky.graph.muteActor",
      "POST",
      {
        actor: did
      },
      session.pdsUrl
    );
  }
  async function getProfile(actor) {
    const result = await apiRequest(
      `app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`
    );
    if (!result) throw new Error("Profile not found");
    return result;
  }

  // src/storage.ts
  var STORAGE_KEYS = {
    TEMP_BLOCKS: "tempBlocks",
    TEMP_MUTES: "tempMutes",
    OPTIONS: "extensionOptions",
    ACTION_HISTORY: "actionHistory"
  };
  var DEFAULT_DURATION_MS = 24 * 60 * 60 * 1e3;
  async function getTempBlocks() {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_BLOCKS);
    return result[STORAGE_KEYS.TEMP_BLOCKS] || {};
  }
  async function getTempMutes() {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.TEMP_MUTES);
    return result[STORAGE_KEYS.TEMP_MUTES] || {};
  }
  async function addTempBlock(did, handle, durationMs = DEFAULT_DURATION_MS) {
    const blocks = await getTempBlocks();
    blocks[did] = {
      handle,
      expiresAt: Date.now() + durationMs,
      createdAt: Date.now()
    };
    await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_BLOCKS]: blocks });
    chrome.runtime.sendMessage({
      type: "TEMP_BLOCK_ADDED",
      did,
      expiresAt: blocks[did].expiresAt
    });
  }
  async function addTempMute(did, handle, durationMs = DEFAULT_DURATION_MS) {
    const mutes = await getTempMutes();
    mutes[did] = {
      handle,
      expiresAt: Date.now() + durationMs,
      createdAt: Date.now()
    };
    await chrome.storage.sync.set({ [STORAGE_KEYS.TEMP_MUTES]: mutes });
    chrome.runtime.sendMessage({
      type: "TEMP_MUTE_ADDED",
      did,
      expiresAt: mutes[did].expiresAt
    });
  }

  // src/content.ts
  (function() {
    "use strict";
    const MENU_ITEM_SELECTOR = '[data-testid="profileHeaderDropdownBtn"]';
    const POST_MENU_SELECTOR = '[data-testid="postDropdownBtn"]';
    let currentObserver = null;
    function extractUserFromPage() {
      const profileMatch = window.location.pathname.match(/\/profile\/([^/]+)/);
      if (profileMatch) {
        return { handle: profileMatch[1] };
      }
      return null;
    }
    let lastClickedElement = null;
    document.addEventListener(
      "click",
      (e) => {
        lastClickedElement = e.target;
      },
      true
    );
    function extractUserFromMenu(menuElement) {
      const profileLink = menuElement.querySelector('a[href*="/profile/"]');
      if (profileLink) {
        const match = profileLink.href.match(/\/profile\/([^/]+)/);
        if (match) return { handle: match[1] };
      }
      const parent = menuElement.closest("[data-testid]");
      if (parent) {
        const handleEl = parent.querySelector('a[href*="/profile/"]');
        if (handleEl) {
          const match = handleEl.href.match(/\/profile\/([^/]+)/);
          if (match) return { handle: match[1] };
        }
      }
      if (lastClickedElement) {
        const postContainer = lastClickedElement.closest(
          '[data-testid*="feedItem"], [data-testid*="postThreadItem"], article, [data-testid*="post"]'
        );
        if (postContainer) {
          const authorLink = postContainer.querySelector('a[href*="/profile/"]');
          if (authorLink) {
            const match = authorLink.href.match(/\/profile\/([^/]+)/);
            if (match) {
              console.log("[TempBlock] Found user from post context:", match[1]);
              return { handle: match[1] };
            }
          }
        }
        let el = lastClickedElement;
        for (let i = 0; i < 10 && el; i++) {
          const links = el.querySelectorAll ? el.querySelectorAll('a[href*="/profile/"]') : [];
          for (const link of links) {
            const match = link.href.match(/\/profile\/([^/]+)/);
            if (match) {
              console.log("[TempBlock] Found user from click context:", match[1]);
              return { handle: match[1] };
            }
          }
          el = el.parentElement;
        }
      }
      return null;
    }
    function createMenuItem(text, icon, onClick) {
      const item = document.createElement("div");
      item.setAttribute("role", "menuitem");
      item.setAttribute("tabindex", "0");
      item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      cursor: pointer;
      color: inherit;
      font-size: 14px;
    `;
      item.innerHTML = `
      <span style="font-size: 16px;">${icon}</span>
      <span>${text}</span>
    `;
      item.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await onClick();
      });
      item.addEventListener("mouseenter", () => {
        item.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.backgroundColor = "transparent";
      });
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      });
      return item;
    }
    function createSeparator() {
      const sep = document.createElement("div");
      sep.style.cssText = `
      height: 1px;
      background-color: rgba(0, 0, 0, 0.1);
      margin: 4px 0;
    `;
      return sep;
    }
    const DURATION_OPTIONS = [
      { label: "1 hour", ms: 1 * 60 * 60 * 1e3 },
      { label: "6 hours", ms: 6 * 60 * 60 * 1e3 },
      { label: "12 hours", ms: 12 * 60 * 60 * 1e3 },
      { label: "24 hours", ms: 24 * 60 * 60 * 1e3 },
      { label: "3 days", ms: 3 * 24 * 60 * 60 * 1e3 },
      { label: "1 week", ms: 7 * 24 * 60 * 60 * 1e3 }
    ];
    function showDurationPicker(actionType, handle) {
      const existing = document.getElementById("temp-block-duration-picker");
      if (existing) existing.remove();
      const overlay = document.createElement("div");
      overlay.id = "temp-block-duration-picker";
      overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
    `;
      const dialog = document.createElement("div");
      dialog.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 20px;
      min-width: 280px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
      const title = document.createElement("h3");
      title.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
    `;
      title.textContent = `Temp ${actionType === "block" ? "Block" : "Mute"} @${handle}`;
      const subtitle = document.createElement("p");
      subtitle.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 14px;
      color: #666;
    `;
      subtitle.textContent = "Select duration:";
      const buttonContainer = document.createElement("div");
      buttonContainer.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    `;
      DURATION_OPTIONS.forEach((option) => {
        const btn = document.createElement("button");
        btn.style.cssText = `
        padding: 10px 16px;
        border: 1px solid #ddd;
        border-radius: 8px;
        background: #f5f5f5;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        color: #1a1a1a;
        transition: all 0.2s;
      `;
        btn.textContent = option.label;
        btn.addEventListener("mouseenter", () => {
          btn.style.background = "#0085ff";
          btn.style.color = "white";
          btn.style.borderColor = "#0085ff";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "#f5f5f5";
          btn.style.color = "#1a1a1a";
          btn.style.borderColor = "#ddd";
        });
        btn.addEventListener("click", async () => {
          overlay.remove();
          if (actionType === "block") {
            await handleTempBlock(handle, option.ms, option.label);
          } else {
            await handleTempMute(handle, option.ms, option.label);
          }
        });
        buttonContainer.appendChild(btn);
      });
      const cancelBtn = document.createElement("button");
      cancelBtn.style.cssText = `
      margin-top: 12px;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      color: #666;
      width: 100%;
    `;
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => overlay.remove());
      dialog.appendChild(title);
      dialog.appendChild(subtitle);
      dialog.appendChild(buttonContainer);
      dialog.appendChild(cancelBtn);
      overlay.appendChild(dialog);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
      });
      const escHandler = (e) => {
        if (e.key === "Escape") {
          overlay.remove();
          document.removeEventListener("keydown", escHandler);
        }
      };
      document.addEventListener("keydown", escHandler);
      document.body.appendChild(overlay);
    }
    function showToast(message, isError = false) {
      const toast = document.createElement("div");
      toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${isError ? "#dc2626" : "#0085ff"};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: slideUp 0.3s ease;
    `;
      toast.textContent = message;
      if (!document.getElementById("temp-block-toast-styles")) {
        const style = document.createElement("style");
        style.id = "temp-block-toast-styles";
        style.textContent = `
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `;
        document.head.appendChild(style);
      }
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3e3);
    }
    function closeMenus() {
      document.body.click();
    }
    async function handleTempBlock(handle, durationMs, durationLabel) {
      console.log("[TempBlock] handleTempBlock called for:", handle, "duration:", durationLabel);
      try {
        console.log("[TempBlock] Getting profile...");
        const profile = await getProfile(handle);
        console.log("[TempBlock] Got profile:", profile);
        if (!profile?.did) {
          throw new Error("Could not get user profile");
        }
        console.log("[TempBlock] Blocking user with DID:", profile.did);
        const blockResult = await blockUser(profile.did);
        console.log("[TempBlock] Block result:", blockResult);
        console.log("[TempBlock] Storing temp block...");
        await addTempBlock(profile.did, profile.handle, durationMs);
        console.log("[TempBlock] Stored temp block");
        closeMenus();
        console.log("[TempBlock] Showing success toast");
        showToast(`Temporarily blocked @${profile.handle} for ${durationLabel}`);
      } catch (error) {
        console.error("[TempBlock] Failed to temp block:", error);
        showToast(`Failed to block: ${error.message}`, true);
      }
    }
    async function handleTempMute(handle, durationMs, durationLabel) {
      console.log("[TempBlock] handleTempMute called for:", handle, "duration:", durationLabel);
      try {
        const profile = await getProfile(handle);
        if (!profile?.did) {
          throw new Error("Could not get user profile");
        }
        await muteUser(profile.did);
        await addTempMute(profile.did, profile.handle, durationMs);
        closeMenus();
        showToast(`Temporarily muted @${profile.handle} for ${durationLabel}`);
      } catch (error) {
        console.error("[TempBlock] Failed to temp mute:", error);
        showToast(`Failed to mute: ${error.message}`, true);
      }
    }
    function injectMenuItems(menu) {
      if (menu.querySelector("[data-temp-block-injected]")) {
        return;
      }
      const menuItems = menu.querySelector('[role="menu"]') || menu;
      let userInfo = extractUserFromMenu(menu);
      if (!userInfo) {
        userInfo = extractUserFromPage();
      }
      if (!userInfo?.handle) {
        console.log("[TempBlock] Could not determine user for menu");
        return;
      }
      const menuItemsList = menuItems.querySelectorAll('[role="menuitem"]');
      let insertAfter = null;
      for (const item of menuItemsList) {
        const text = item.textContent?.toLowerCase() || "";
        if (text.includes("block")) {
          insertAfter = item;
          break;
        }
      }
      const separator = createSeparator();
      separator.setAttribute("data-temp-block-injected", "true");
      const tempMuteItem = createMenuItem("Temp Mute...", "\u23F1\uFE0F", () => {
        closeMenus();
        showDurationPicker("mute", userInfo.handle);
      });
      tempMuteItem.setAttribute("data-temp-block-injected", "true");
      const tempBlockItem = createMenuItem("Temp Block...", "\u23F1\uFE0F", () => {
        closeMenus();
        showDurationPicker("block", userInfo.handle);
      });
      tempBlockItem.setAttribute("data-temp-block-injected", "true");
      if (insertAfter && insertAfter.nextSibling) {
        insertAfter.parentNode.insertBefore(separator, insertAfter.nextSibling);
        insertAfter.parentNode.insertBefore(tempMuteItem, separator.nextSibling);
        insertAfter.parentNode.insertBefore(tempBlockItem, tempMuteItem.nextSibling);
      } else {
        menuItems.appendChild(separator);
        menuItems.appendChild(tempMuteItem);
        menuItems.appendChild(tempBlockItem);
      }
      console.log("[TempBlock] Injected menu items for", userInfo.handle);
    }
    function observeMenus() {
      if (currentObserver) {
        currentObserver.disconnect();
      }
      currentObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const menus = node.querySelectorAll ? [node, ...node.querySelectorAll('[role="menu"], [data-radix-menu-content]')] : [node];
            for (const menu of menus) {
              if (menu.getAttribute?.("role") === "menu" || menu.hasAttribute?.("data-radix-menu-content") || menu.querySelector?.('[role="menuitem"]')) {
                const hasBlockOption = Array.from(menu.querySelectorAll('[role="menuitem"]')).some(
                  (item) => {
                    const text = item.textContent?.toLowerCase() || "";
                    return text.includes("block") || text.includes("mute");
                  }
                );
                if (hasBlockOption) {
                  setTimeout(() => injectMenuItems(menu), 50);
                }
              }
            }
          }
        }
      });
      currentObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      console.log("[TempBlock] Menu observer started");
    }
    function syncAuthToBackground() {
      const session = getSession();
      if (session?.accessJwt && session?.did && session?.pdsUrl) {
        chrome.runtime.sendMessage({
          type: "SET_AUTH_TOKEN",
          auth: {
            accessJwt: session.accessJwt,
            did: session.did,
            pdsUrl: session.pdsUrl
          }
        });
        console.log("[TempBlock] Auth synced to background (PDS:", session.pdsUrl, ")");
      }
    }
    function init() {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          observeMenus();
          setTimeout(syncAuthToBackground, 2e3);
        });
      } else {
        observeMenus();
        setTimeout(syncAuthToBackground, 2e3);
      }
      setInterval(syncAuthToBackground, 5 * 60 * 1e3);
      console.log("[TempBlock] Extension initialized");
    }
    init();
  })();
})();
