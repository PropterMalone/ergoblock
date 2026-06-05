/**
 * Amnesty feature storage - review decisions for old blocks/mutes
 */

import browser from '../browser.js';
import type { AmnestyReview } from '../../types.js';
import { STORAGE_KEYS } from './keys.js';

/**
 * Get all amnesty reviews from storage
 * Note: Uses local storage to avoid sync quota limits (8KB per item)
 */
export async function getAmnestyReviews(): Promise<AmnestyReview[]> {
  // Try local first, fall back to sync for migration
  const localResult = await browser.storage.local.get(STORAGE_KEYS.AMNESTY_REVIEWS);
  if (localResult[STORAGE_KEYS.AMNESTY_REVIEWS]) {
    return localResult[STORAGE_KEYS.AMNESTY_REVIEWS] as AmnestyReview[];
  }
  // Check sync for existing data and migrate if found
  const syncResult = await browser.storage.sync.get(STORAGE_KEYS.AMNESTY_REVIEWS);
  const syncReviews = (syncResult[STORAGE_KEYS.AMNESTY_REVIEWS] as AmnestyReview[]) || [];
  if (syncReviews.length > 0) {
    // Migrate to local storage
    await browser.storage.local.set({ [STORAGE_KEYS.AMNESTY_REVIEWS]: syncReviews });
    // Clean up sync storage
    await browser.storage.sync.remove(STORAGE_KEYS.AMNESTY_REVIEWS);
  }
  return syncReviews;
}

/**
 * Get set of DIDs that have been reviewed by amnesty
 */
export async function getAmnestyReviewedDids(): Promise<Set<string>> {
  const reviews = await getAmnestyReviews();
  return new Set(reviews.map((r) => r.did));
}

/**
 * Add an amnesty review record
 * Note: Uses local storage to avoid sync quota limits
 */
export async function addAmnestyReview(review: AmnestyReview): Promise<void> {
  const reviews = await getAmnestyReviews();
  // Remove any existing review for this DID (in case of re-review)
  const filtered = reviews.filter((r) => r.did !== review.did);
  filtered.push(review);
  await browser.storage.local.set({ [STORAGE_KEYS.AMNESTY_REVIEWS]: filtered });
}

/**
 * Get amnesty statistics
 */
export async function getAmnestyStats(): Promise<{
  totalReviewed: number;
  unblocked: number;
  keptBlocked: number;
  unmuted: number;
  keptMuted: number;
}> {
  const reviews = await getAmnestyReviews();
  return {
    totalReviewed: reviews.length,
    unblocked: reviews.filter((r) => r.decision === 'unblocked').length,
    keptBlocked: reviews.filter((r) => r.decision === 'kept_blocked').length,
    unmuted: reviews.filter((r) => r.decision === 'unmuted').length,
    keptMuted: reviews.filter((r) => r.decision === 'kept_muted').length,
  };
}
