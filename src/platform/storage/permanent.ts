/**
 * Permanent blocks/mutes storage and merged views for manager UI
 */

import browser from '../browser.js';
import type { PermanentBlockMute, ManagedEntry } from '../../types.js';
import { STORAGE_KEYS } from './keys.js';
import { getTempBlocks, getTempMutes } from './temp-actions.js';

interface PermanentBlocksMutesMap {
  [did: string]: PermanentBlockMute;
}

// ── Permanent Blocks ─────────────────────────────────────────────────────────

/**
 * Get permanent blocks from local storage (blocks synced from Bluesky)
 */
export async function getPermanentBlocks(): Promise<PermanentBlocksMutesMap> {
  const result = await browser.storage.local.get(STORAGE_KEYS.PERMANENT_BLOCKS);
  return (result[STORAGE_KEYS.PERMANENT_BLOCKS] as PermanentBlocksMutesMap) || {};
}

/**
 * Set permanent blocks in local storage
 */
export async function setPermanentBlocks(blocks: PermanentBlocksMutesMap): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.PERMANENT_BLOCKS]: blocks });
}

/**
 * Remove a permanent block from local storage
 */
export async function removePermanentBlock(did: string): Promise<void> {
  const blocks = await getPermanentBlocks();
  delete blocks[did];
  await browser.storage.local.set({ [STORAGE_KEYS.PERMANENT_BLOCKS]: blocks });
}

// ── Permanent Mutes ──────────────────────────────────────────────────────────

/**
 * Get permanent mutes from local storage (mutes synced from Bluesky)
 */
export async function getPermanentMutes(): Promise<PermanentBlocksMutesMap> {
  const result = await browser.storage.local.get(STORAGE_KEYS.PERMANENT_MUTES);
  return (result[STORAGE_KEYS.PERMANENT_MUTES] as PermanentBlocksMutesMap) || {};
}

/**
 * Set permanent mutes in local storage
 */
export async function setPermanentMutes(mutes: PermanentBlocksMutesMap): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.PERMANENT_MUTES]: mutes });
}

/**
 * Remove a permanent mute from local storage
 */
export async function removePermanentMute(did: string): Promise<void> {
  const mutes = await getPermanentMutes();
  delete mutes[did];
  await browser.storage.local.set({ [STORAGE_KEYS.PERMANENT_MUTES]: mutes });
}

// ── Merged Views ─────────────────────────────────────────────────────────────

/**
 * Get all managed blocks (temp + permanent) as a unified list
 * Returns entries sorted by creation/sync date (newest first)
 */
export async function getAllManagedBlocks(): Promise<ManagedEntry[]> {
  const [tempBlocks, permanentBlocks] = await Promise.all([getTempBlocks(), getPermanentBlocks()]);

  const entries: ManagedEntry[] = [];

  // Add temp blocks
  for (const [did, data] of Object.entries(tempBlocks)) {
    entries.push({
      did,
      handle: data.handle,
      source: 'ergoblock_temp',
      type: 'block',
      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
      rkey: data.rkey,
    });
  }

  // Add permanent blocks (only those not already tracked as temp)
  for (const [did, data] of Object.entries(permanentBlocks)) {
    if (!tempBlocks[did]) {
      entries.push({
        did,
        handle: data.handle,
        displayName: data.displayName,
        avatar: data.avatar,
        source: 'bluesky',
        type: 'block',
        syncedAt: data.syncedAt,
        createdAt: data.createdAt,
        rkey: data.rkey,
        mutualBlock: data.mutualBlock,
        viewer: data.viewer,
      });
    }
  }

  // Sort by date (newest first)
  entries.sort((a, b) => {
    const dateA = a.createdAt || a.syncedAt || 0;
    const dateB = b.createdAt || b.syncedAt || 0;
    return dateB - dateA;
  });

  return entries;
}

/**
 * Get all managed mutes (temp + permanent) as a unified list
 * Returns entries sorted by creation/sync date (newest first)
 */
export async function getAllManagedMutes(): Promise<ManagedEntry[]> {
  const [tempMutes, permanentMutes] = await Promise.all([getTempMutes(), getPermanentMutes()]);

  const entries: ManagedEntry[] = [];

  // Add temp mutes
  for (const [did, data] of Object.entries(tempMutes)) {
    entries.push({
      did,
      handle: data.handle,
      source: 'ergoblock_temp',
      type: 'mute',
      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
    });
  }

  // Add permanent mutes (only those not already tracked as temp)
  for (const [did, data] of Object.entries(permanentMutes)) {
    if (!tempMutes[did]) {
      entries.push({
        did,
        handle: data.handle,
        displayName: data.displayName,
        avatar: data.avatar,
        source: 'bluesky',
        type: 'mute',
        syncedAt: data.syncedAt,
        viewer: data.viewer,
      });
    }
  }

  // Sort by date (newest first)
  entries.sort((a, b) => {
    const dateA = a.createdAt || a.syncedAt || 0;
    const dateB = b.createdAt || b.syncedAt || 0;
    return dateB - dateA;
  });

  return entries;
}
