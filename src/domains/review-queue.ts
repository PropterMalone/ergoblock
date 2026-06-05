/**
 * Review Queue handlers - manage external blocks/mutes that need user review
 */

import { createLogger } from '../platform/utils.js';
import {
  getPermanentBlocks,
  setPermanentBlocks,
  getPermanentMutes,
  setPermanentMutes,
  addTempBlock,
  addTempMute,
} from '../platform/storage.js';

const log = createLogger('bg:review-queue');

/**
 * Assign a duration to a permanent block/mute, converting it to temporary.
 * The server-side block/mute stays in place; we just add ErgoBlock tracking.
 */
export async function handleAssignDurationToPermanent(
  did: string,
  actionType: 'block' | 'mute',
  duration: number
): Promise<{ success: boolean; error?: string }> {
  try {
    if (actionType === 'block') {
      const permanentBlocks = await getPermanentBlocks();
      const block = permanentBlocks[did];
      if (!block) {
        return { success: false, error: 'Block not found' };
      }

      // Create temp block with expiration (block already exists on Bluesky)
      await addTempBlock(did, block.handle, duration, block.rkey);

      // Mark as reviewed
      permanentBlocks[did] = { ...block, needsReview: false };
      await setPermanentBlocks(permanentBlocks);

      log.info(`Assigned ${duration}ms duration to block ${block.handle}`);
      return { success: true };
    } else {
      const permanentMutes = await getPermanentMutes();
      const mute = permanentMutes[did];
      if (!mute) {
        return { success: false, error: 'Mute not found' };
      }

      // Create temp mute with expiration (mute already exists on Bluesky)
      await addTempMute(did, mute.handle, duration);

      // Mark as reviewed
      permanentMutes[did] = { ...mute, needsReview: false };
      await setPermanentMutes(permanentMutes);

      log.info(`Assigned ${duration}ms duration to mute ${mute.handle}`);
      return { success: true };
    }
  } catch (error) {
    log.error('Failed to assign duration:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Mark a permanent block/mute as reviewed (keep as permanent, user confirmed it).
 * Changes source to 'ergoblock' to indicate user explicitly confirmed it.
 */
export async function handleMarkPermanentReviewed(
  did: string,
  actionType: 'block' | 'mute'
): Promise<{ success: boolean; error?: string }> {
  try {
    if (actionType === 'block') {
      const permanentBlocks = await getPermanentBlocks();
      const block = permanentBlocks[did];
      if (!block) {
        return { success: false, error: 'Block not found' };
      }

      permanentBlocks[did] = { ...block, needsReview: false, source: 'ergoblock' };
      await setPermanentBlocks(permanentBlocks);

      log.info(`Marked block ${block.handle} as reviewed (permanent)`);
      return { success: true };
    } else {
      const permanentMutes = await getPermanentMutes();
      const mute = permanentMutes[did];
      if (!mute) {
        return { success: false, error: 'Mute not found' };
      }

      permanentMutes[did] = { ...mute, needsReview: false, source: 'ergoblock' };
      await setPermanentMutes(permanentMutes);

      log.info(`Marked mute ${mute.handle} as reviewed (permanent)`);
      return { success: true };
    }
  } catch (error) {
    log.error('Failed to mark reviewed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Dismiss a review queue item (keep as-is, remove from review queue).
 * Unlike MARK_PERMANENT_REVIEWED, this doesn't change the source — just clears needsReview.
 */
/**
 * Backfill: mark all grandfathered permanent blocks/mutes (source undefined) as needing review.
 * This lets users review blocks that existed before the review queue feature was added.
 */
export async function handleBackfillReviewQueue(): Promise<{
  success: boolean;
  flaggedBlocks: number;
  flaggedMutes: number;
  error?: string;
}> {
  try {
    const [permanentBlocks, permanentMutes] = await Promise.all([
      getPermanentBlocks(),
      getPermanentMutes(),
    ]);

    let flaggedBlocks = 0;
    let flaggedMutes = 0;

    for (const [did, block] of Object.entries(permanentBlocks)) {
      if (block.source === undefined) {
        permanentBlocks[did] = { ...block, needsReview: true, source: 'external' };
        flaggedBlocks++;
      }
    }

    for (const [did, mute] of Object.entries(permanentMutes)) {
      if (mute.source === undefined) {
        permanentMutes[did] = { ...mute, needsReview: true, source: 'external' };
        flaggedMutes++;
      }
    }

    await Promise.all([setPermanentBlocks(permanentBlocks), setPermanentMutes(permanentMutes)]);

    log.info(
      `Backfill complete: ${flaggedBlocks} blocks, ${flaggedMutes} mutes flagged for review`
    );
    return { success: true, flaggedBlocks, flaggedMutes };
  } catch (error) {
    log.error('Backfill failed:', error);
    return {
      success: false,
      flaggedBlocks: 0,
      flaggedMutes: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleDismissReview(
  did: string,
  actionType: 'block' | 'mute'
): Promise<{ success: boolean; error?: string }> {
  try {
    if (actionType === 'block') {
      const permanentBlocks = await getPermanentBlocks();
      const block = permanentBlocks[did];
      if (!block) {
        return { success: false, error: 'Block not found' };
      }

      permanentBlocks[did] = { ...block, needsReview: false };
      await setPermanentBlocks(permanentBlocks);

      log.info(`Dismissed review for block ${block.handle}`);
      return { success: true };
    } else {
      const permanentMutes = await getPermanentMutes();
      const mute = permanentMutes[did];
      if (!mute) {
        return { success: false, error: 'Mute not found' };
      }

      permanentMutes[did] = { ...mute, needsReview: false };
      await setPermanentMutes(permanentMutes);

      log.info(`Dismissed review for mute ${mute.handle}`);
      return { success: true };
    }
  } catch (error) {
    log.error('Failed to dismiss review:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
