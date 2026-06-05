/**
 * Blocklist audit storage - subscribed blocklists, social graph, conflicts
 */

import browser from '../browser.js';
import type {
  SubscribedBlocklist,
  FollowRelation,
  BlocklistConflictGroup,
  BlocklistAuditState,
} from '../../types.js';
import { STORAGE_KEYS } from './keys.js';

// ── Blocklist Audit State ────────────────────────────────────────────────────

const DEFAULT_AUDIT_STATE: BlocklistAuditState = {
  lastSyncAt: 0,
  syncInProgress: false,
  followCount: 0,
  followerCount: 0,
  blocklistCount: 0,
  conflictCount: 0,
};

/**
 * Get blocklist audit state
 */
export async function getBlocklistAuditState(): Promise<BlocklistAuditState> {
  const result = await browser.storage.local.get(STORAGE_KEYS.BLOCKLIST_AUDIT_STATE);
  return (result[STORAGE_KEYS.BLOCKLIST_AUDIT_STATE] as BlocklistAuditState) || DEFAULT_AUDIT_STATE;
}

/**
 * Set blocklist audit state
 */
export async function setBlocklistAuditState(state: BlocklistAuditState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.BLOCKLIST_AUDIT_STATE]: state });
}

/**
 * Update blocklist audit state partially
 */
export async function updateBlocklistAuditState(
  update: Partial<BlocklistAuditState>
): Promise<void> {
  const current = await getBlocklistAuditState();
  await setBlocklistAuditState({ ...current, ...update });
}

// ── Subscribed Blocklists ────────────────────────────────────────────────────

/**
 * Get subscribed blocklists
 */
export async function getSubscribedBlocklists(): Promise<SubscribedBlocklist[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SUBSCRIBED_BLOCKLISTS);
  return (result[STORAGE_KEYS.SUBSCRIBED_BLOCKLISTS] as SubscribedBlocklist[]) || [];
}

/**
 * Set subscribed blocklists
 */
export async function setSubscribedBlocklists(lists: SubscribedBlocklist[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.SUBSCRIBED_BLOCKLISTS]: lists });
}

// ── Social Graph ─────────────────────────────────────────────────────────────

interface SocialGraphData {
  follows: FollowRelation[];
  followers: FollowRelation[];
  syncedAt: number;
}

/**
 * Get social graph (follows + followers)
 */
export async function getSocialGraph(): Promise<SocialGraphData> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SOCIAL_GRAPH);
  return (
    (result[STORAGE_KEYS.SOCIAL_GRAPH] as SocialGraphData) || {
      follows: [],
      followers: [],
      syncedAt: 0,
    }
  );
}

/**
 * Set social graph
 */
export async function setSocialGraph(data: SocialGraphData): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.SOCIAL_GRAPH]: data });
}

// ── Follows Handles (lightweight, for repost filter) ─────────────────────────

interface FollowsHandlesData {
  handles: string[]; // lowercase handles
  syncedAt: number;
}

/**
 * Get follows handles (lightweight list for repost filter)
 */
export async function getFollowsHandles(): Promise<FollowsHandlesData> {
  const result = await browser.storage.local.get(STORAGE_KEYS.FOLLOWS_HANDLES);
  return (
    (result[STORAGE_KEYS.FOLLOWS_HANDLES] as FollowsHandlesData) || {
      handles: [],
      syncedAt: 0,
    }
  );
}

/**
 * Set follows handles (lightweight list for repost filter)
 */
export async function setFollowsHandles(handles: string[], syncedAt: number): Promise<void> {
  const data: FollowsHandlesData = {
    handles: handles.map((h) => h.toLowerCase()),
    syncedAt,
  };
  await browser.storage.local.set({ [STORAGE_KEYS.FOLLOWS_HANDLES]: data });
}

/**
 * Check if a handle is in the follows list
 */
export async function isHandleFollowed(handle: string): Promise<boolean> {
  const data = await getFollowsHandles();
  return data.handles.includes(handle.toLowerCase());
}

// ── Blocklist Conflicts ──────────────────────────────────────────────────────

/**
 * Get blocklist conflicts grouped by list
 */
export async function getBlocklistConflicts(): Promise<BlocklistConflictGroup[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.BLOCKLIST_CONFLICTS);
  return (result[STORAGE_KEYS.BLOCKLIST_CONFLICTS] as BlocklistConflictGroup[]) || [];
}

/**
 * Set blocklist conflicts
 */
export async function setBlocklistConflicts(conflicts: BlocklistConflictGroup[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.BLOCKLIST_CONFLICTS]: conflicts });
}

/**
 * Get dismissed conflict list URIs
 */
export async function getDismissedConflicts(): Promise<Set<string>> {
  const result = await browser.storage.local.get(STORAGE_KEYS.DISMISSED_CONFLICTS);
  const dismissed = (result[STORAGE_KEYS.DISMISSED_CONFLICTS] as string[]) || [];
  return new Set(dismissed);
}

/**
 * Dismiss conflicts for a blocklist
 */
export async function dismissBlocklistConflicts(listUri: string): Promise<void> {
  const dismissed = await getDismissedConflicts();
  dismissed.add(listUri);
  await browser.storage.local.set({
    [STORAGE_KEYS.DISMISSED_CONFLICTS]: Array.from(dismissed),
  });
}

/**
 * Undismiss conflicts for a blocklist (show again)
 */
export async function undismissBlocklistConflicts(listUri: string): Promise<void> {
  const dismissed = await getDismissedConflicts();
  dismissed.delete(listUri);
  await browser.storage.local.set({
    [STORAGE_KEYS.DISMISSED_CONFLICTS]: Array.from(dismissed),
  });
}

/**
 * Clear all blocklist audit data
 */
export async function clearBlocklistAuditData(): Promise<void> {
  await browser.storage.local.remove([
    STORAGE_KEYS.BLOCKLIST_AUDIT_STATE,
    STORAGE_KEYS.SUBSCRIBED_BLOCKLISTS,
    STORAGE_KEYS.SOCIAL_GRAPH,
    STORAGE_KEYS.BLOCKLIST_CONFLICTS,
    STORAGE_KEYS.DISMISSED_CONFLICTS,
  ]);
}
