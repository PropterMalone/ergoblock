/**
 * Action history and post context storage
 */

import browser from '../browser.js';
import type { HistoryEntry, PostContext } from '../../types.js';
import { generateId, createLogger } from '../utils.js';
import { STORAGE_KEYS, HISTORY_MAX_ENTRIES } from './keys.js';
import { getOptions } from './state.js';

const log = createLogger('storage');

// ── Action History ───────────────────────────────────────────────────────────

/**
 * Get action history from local storage
 * Returns entries in reverse chronological order (newest first)
 */
export async function getActionHistory(): Promise<HistoryEntry[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.ACTION_HISTORY);
  const history = result[STORAGE_KEYS.ACTION_HISTORY] || [];
  return history as HistoryEntry[];
}

/**
 * Add an entry to action history
 * Maintains a maximum of HISTORY_MAX_ENTRIES
 */
export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  // Generate ID if not provided
  const entryWithId = {
    ...entry,
    id: entry.id || generateId('hist'),
  };

  const history = await getActionHistory();
  history.unshift(entryWithId); // Add to beginning (newest first)

  // Keep only the last HISTORY_MAX_ENTRIES
  const trimmed = history.slice(0, HISTORY_MAX_ENTRIES);

  await browser.storage.local.set({ [STORAGE_KEYS.ACTION_HISTORY]: trimmed });
}

// ── Post Contexts ────────────────────────────────────────────────────────────

const MAX_POST_CONTEXTS = 500; // Keep last 500 post contexts

/**
 * Get all stored post contexts
 */
export async function getPostContexts(): Promise<PostContext[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.POST_CONTEXTS);
  return (result[STORAGE_KEYS.POST_CONTEXTS] as PostContext[]) || [];
}

/**
 * Add a post context to storage
 */
export async function addPostContext(context: PostContext): Promise<void> {
  const contexts = await getPostContexts();
  contexts.unshift(context); // Add to beginning (newest first)

  // Trim to max entries
  const trimmed = contexts.slice(0, MAX_POST_CONTEXTS);

  await browser.storage.local.set({ [STORAGE_KEYS.POST_CONTEXTS]: trimmed });
}

/**
 * Delete a post context by ID
 */
export async function deletePostContext(id: string): Promise<void> {
  const contexts = await getPostContexts();
  const filtered = contexts.filter((c) => c.id !== id);
  await browser.storage.local.set({ [STORAGE_KEYS.POST_CONTEXTS]: filtered });
}

/**
 * Clean up expired post contexts based on retention policy
 */
export async function cleanupExpiredPostContexts(): Promise<void> {
  const options = await getOptions();
  if (options.postContextRetentionDays <= 0) return; // 0 = never delete

  const contexts = await getPostContexts();
  const cutoff = Date.now() - options.postContextRetentionDays * 24 * 60 * 60 * 1000;

  const filtered = contexts.filter((c) => c.timestamp > cutoff);
  if (filtered.length !== contexts.length) {
    await browser.storage.local.set({ [STORAGE_KEYS.POST_CONTEXTS]: filtered });
    log.info(`Cleaned up ${contexts.length - filtered.length} expired post contexts`);
  }
}
