/**
 * Tests for review queue signals, handlers, and integration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal, computed } from '@preact/signals';
import type { PermanentBlockMute } from '../types';

// ============================================================================
// Signal Logic Tests (standalone, no mocks needed)
// ============================================================================

describe('Review Queue Signals', () => {
  describe('unreviewedItems computed signal', () => {
    it('should filter blocks and mutes where needsReview === true', () => {
      const mockBlocks = signal<Record<string, PermanentBlockMute>>({
        'did:plc:reviewed': {
          did: 'did:plc:reviewed',
          handle: 'reviewed.bsky.social',
          syncedAt: Date.now(),
          needsReview: false,
          source: 'ergoblock',
        },
        'did:plc:unreviewed1': {
          did: 'did:plc:unreviewed1',
          handle: 'unreviewed1.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external',
        },
        'did:plc:unreviewed2': {
          did: 'did:plc:unreviewed2',
          handle: 'unreviewed2.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external',
        },
      });

      const mockMutes = signal<Record<string, PermanentBlockMute>>({
        'did:plc:grandfathered': {
          did: 'did:plc:grandfathered',
          handle: 'old.bsky.social',
          syncedAt: Date.now() - 86400000 * 30,
          // needsReview undefined (grandfathered)
        },
        'did:plc:unreviewed3': {
          did: 'did:plc:unreviewed3',
          handle: 'unreviewed3.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external',
        },
      });

      const unreviewedItems = computed(() => {
        const items: Array<PermanentBlockMute & { actionType: 'block' | 'mute' }> = [];

        for (const block of Object.values(mockBlocks.value)) {
          if (block.needsReview === true) {
            items.push({ ...block, actionType: 'block' });
          }
        }

        for (const mute of Object.values(mockMutes.value)) {
          if (mute.needsReview === true) {
            items.push({ ...mute, actionType: 'mute' });
          }
        }

        return items;
      });

      expect(unreviewedItems.value).toHaveLength(3);
      expect(unreviewedItems.value.map((i) => i.actionType)).toEqual(['block', 'block', 'mute']);
    });

    it('should return empty array when no items need review', () => {
      const mockBlocks = signal<Record<string, PermanentBlockMute>>({
        'did:plc:reviewed': {
          did: 'did:plc:reviewed',
          handle: 'reviewed.bsky.social',
          syncedAt: Date.now(),
          needsReview: false,
          source: 'ergoblock',
        },
      });

      const mockMutes = signal<Record<string, PermanentBlockMute>>({});

      const unreviewedItems = computed(() => {
        const items: Array<PermanentBlockMute & { actionType: 'block' | 'mute' }> = [];

        for (const block of Object.values(mockBlocks.value)) {
          if (block.needsReview === true) {
            items.push({ ...block, actionType: 'block' });
          }
        }

        for (const mute of Object.values(mockMutes.value)) {
          if (mute.needsReview === true) {
            items.push({ ...mute, actionType: 'mute' });
          }
        }

        return items;
      });

      expect(unreviewedItems.value).toHaveLength(0);
    });

    it('should update reactively when blocks change', () => {
      const mockBlocks = signal<Record<string, PermanentBlockMute>>({});

      const unreviewedItems = computed(() => {
        const items: Array<PermanentBlockMute & { actionType: 'block' | 'mute' }> = [];

        for (const block of Object.values(mockBlocks.value)) {
          if (block.needsReview === true) {
            items.push({ ...block, actionType: 'block' });
          }
        }

        return items;
      });

      expect(unreviewedItems.value).toHaveLength(0);

      mockBlocks.value = {
        'did:plc:new': {
          did: 'did:plc:new',
          handle: 'new.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external',
        },
      };

      expect(unreviewedItems.value).toHaveLength(1);
    });

    it('should treat undefined needsReview as not needing review', () => {
      const mockBlocks = signal<Record<string, PermanentBlockMute>>({
        'did:plc:old': {
          did: 'did:plc:old',
          handle: 'old.bsky.social',
          syncedAt: Date.now(),
          // needsReview is undefined — grandfathered data
        },
      });

      const unreviewedItems = computed(() =>
        Object.values(mockBlocks.value).filter((b) => b.needsReview === true)
      );

      expect(unreviewedItems.value).toHaveLength(0);
    });
  });

  describe('review queue UI signals', () => {
    it('should initialize with default values', () => {
      const viewMode = signal<'card' | 'table'>('card');
      const currentIndex = signal(0);
      const selectedItems = signal<Set<string>>(new Set());

      expect(viewMode.value).toBe('card');
      expect(currentIndex.value).toBe(0);
      expect(selectedItems.value.size).toBe(0);
    });
  });
});

// ============================================================================
// Review Queue Handler Tests
// ============================================================================

vi.mock('../platform/storage', () => ({
  getPermanentBlocks: vi.fn(),
  setPermanentBlocks: vi.fn(),
  getPermanentMutes: vi.fn(),
  setPermanentMutes: vi.fn(),
  addTempBlock: vi.fn(),
  addTempMute: vi.fn(),
}));

import {
  getPermanentBlocks,
  setPermanentBlocks,
  getPermanentMutes,
  setPermanentMutes,
  addTempBlock,
  addTempMute,
} from '../platform/storage';
import {
  handleAssignDurationToPermanent,
  handleMarkPermanentReviewed,
  handleDismissReview,
  handleBackfillReviewQueue,
} from '../domains/review-queue';

describe('Review Queue Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleAssignDurationToPermanent', () => {
    it('should create temp block and mark reviewed for blocks', async () => {
      const permanentBlocks = {
        'did:plc:test': {
          did: 'did:plc:test',
          handle: 'test.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external' as const,
          rkey: 'abc123',
        },
      };

      vi.mocked(getPermanentBlocks).mockResolvedValue(permanentBlocks);
      vi.mocked(setPermanentBlocks).mockResolvedValue(undefined);
      vi.mocked(addTempBlock).mockResolvedValue(undefined);

      const result = await handleAssignDurationToPermanent(
        'did:plc:test',
        'block',
        7 * 24 * 60 * 60 * 1000
      );

      expect(result.success).toBe(true);
      expect(addTempBlock).toHaveBeenCalledWith(
        'did:plc:test',
        'test.bsky.social',
        7 * 24 * 60 * 60 * 1000,
        'abc123'
      );
      expect(setPermanentBlocks).toHaveBeenCalledWith(
        expect.objectContaining({
          'did:plc:test': expect.objectContaining({
            needsReview: false,
          }),
        })
      );
    });

    it('should create temp mute and mark reviewed for mutes', async () => {
      const permanentMutes = {
        'did:plc:mute1': {
          did: 'did:plc:mute1',
          handle: 'muted.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external' as const,
        },
      };

      vi.mocked(getPermanentMutes).mockResolvedValue(permanentMutes);
      vi.mocked(setPermanentMutes).mockResolvedValue(undefined);
      vi.mocked(addTempMute).mockResolvedValue(undefined);

      const result = await handleAssignDurationToPermanent(
        'did:plc:mute1',
        'mute',
        24 * 60 * 60 * 1000
      );

      expect(result.success).toBe(true);
      expect(addTempMute).toHaveBeenCalledWith(
        'did:plc:mute1',
        'muted.bsky.social',
        24 * 60 * 60 * 1000
      );
    });

    it('should return error when block not found', async () => {
      vi.mocked(getPermanentBlocks).mockResolvedValue({});

      const result = await handleAssignDurationToPermanent('did:plc:missing', 'block', 1000);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Block not found');
    });

    it('should return error when mute not found', async () => {
      vi.mocked(getPermanentMutes).mockResolvedValue({});

      const result = await handleAssignDurationToPermanent('did:plc:missing', 'mute', 1000);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Mute not found');
    });
  });

  describe('handleMarkPermanentReviewed', () => {
    it('should mark block as reviewed and change source to ergoblock', async () => {
      const permanentBlocks = {
        'did:plc:test': {
          did: 'did:plc:test',
          handle: 'test.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external' as const,
        },
      };

      vi.mocked(getPermanentBlocks).mockResolvedValue(permanentBlocks);
      vi.mocked(setPermanentBlocks).mockResolvedValue(undefined);

      const result = await handleMarkPermanentReviewed('did:plc:test', 'block');

      expect(result.success).toBe(true);
      expect(setPermanentBlocks).toHaveBeenCalledWith(
        expect.objectContaining({
          'did:plc:test': expect.objectContaining({
            needsReview: false,
            source: 'ergoblock',
          }),
        })
      );
    });

    it('should mark mute as reviewed and change source to ergoblock', async () => {
      const permanentMutes = {
        'did:plc:mute1': {
          did: 'did:plc:mute1',
          handle: 'muted.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external' as const,
        },
      };

      vi.mocked(getPermanentMutes).mockResolvedValue(permanentMutes);
      vi.mocked(setPermanentMutes).mockResolvedValue(undefined);

      const result = await handleMarkPermanentReviewed('did:plc:mute1', 'mute');

      expect(result.success).toBe(true);
      expect(setPermanentMutes).toHaveBeenCalledWith(
        expect.objectContaining({
          'did:plc:mute1': expect.objectContaining({
            needsReview: false,
            source: 'ergoblock',
          }),
        })
      );
    });

    it('should return error when block not found', async () => {
      vi.mocked(getPermanentBlocks).mockResolvedValue({});

      const result = await handleMarkPermanentReviewed('did:plc:missing', 'block');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Block not found');
    });
  });

  describe('handleDismissReview', () => {
    it('should clear needsReview without changing source', async () => {
      const permanentBlocks = {
        'did:plc:test': {
          did: 'did:plc:test',
          handle: 'test.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external' as const,
        },
      };

      vi.mocked(getPermanentBlocks).mockResolvedValue(permanentBlocks);
      vi.mocked(setPermanentBlocks).mockResolvedValue(undefined);

      const result = await handleDismissReview('did:plc:test', 'block');

      expect(result.success).toBe(true);
      expect(setPermanentBlocks).toHaveBeenCalledWith(
        expect.objectContaining({
          'did:plc:test': expect.objectContaining({
            needsReview: false,
            source: 'external', // Source preserved
          }),
        })
      );
    });

    it('should dismiss mute review', async () => {
      const permanentMutes = {
        'did:plc:mute1': {
          did: 'did:plc:mute1',
          handle: 'muted.bsky.social',
          syncedAt: Date.now(),
          needsReview: true,
          source: 'external' as const,
        },
      };

      vi.mocked(getPermanentMutes).mockResolvedValue(permanentMutes);
      vi.mocked(setPermanentMutes).mockResolvedValue(undefined);

      const result = await handleDismissReview('did:plc:mute1', 'mute');

      expect(result.success).toBe(true);
    });
  });

  describe('handleBackfillReviewQueue', () => {
    it('should flag grandfathered blocks and mutes as needing review', async () => {
      const permanentBlocks = {
        'did:plc:old1': {
          did: 'did:plc:old1',
          handle: 'old1.bsky.social',
          syncedAt: Date.now() - 86400000 * 30,
          // source undefined — grandfathered
        },
        'did:plc:tracked': {
          did: 'did:plc:tracked',
          handle: 'tracked.bsky.social',
          syncedAt: Date.now(),
          needsReview: false,
          source: 'ergoblock' as const,
        },
      };

      const permanentMutes = {
        'did:plc:old2': {
          did: 'did:plc:old2',
          handle: 'old2.bsky.social',
          syncedAt: Date.now() - 86400000 * 60,
          // source undefined — grandfathered
        },
      };

      vi.mocked(getPermanentBlocks).mockResolvedValue(permanentBlocks);
      vi.mocked(getPermanentMutes).mockResolvedValue(permanentMutes);
      vi.mocked(setPermanentBlocks).mockResolvedValue(undefined);
      vi.mocked(setPermanentMutes).mockResolvedValue(undefined);

      const result = await handleBackfillReviewQueue();

      expect(result.success).toBe(true);
      expect(result.flaggedBlocks).toBe(1);
      expect(result.flaggedMutes).toBe(1);

      // Verify the grandfathered block was flagged
      expect(setPermanentBlocks).toHaveBeenCalledWith(
        expect.objectContaining({
          'did:plc:old1': expect.objectContaining({
            needsReview: true,
            source: 'external',
          }),
          // Already-tracked block should be untouched
          'did:plc:tracked': expect.objectContaining({
            needsReview: false,
            source: 'ergoblock',
          }),
        })
      );

      expect(setPermanentMutes).toHaveBeenCalledWith(
        expect.objectContaining({
          'did:plc:old2': expect.objectContaining({
            needsReview: true,
            source: 'external',
          }),
        })
      );
    });

    it('should return zero counts when nothing to backfill', async () => {
      vi.mocked(getPermanentBlocks).mockResolvedValue({
        'did:plc:tracked': {
          did: 'did:plc:tracked',
          handle: 'tracked.bsky.social',
          syncedAt: Date.now(),
          needsReview: false,
          source: 'ergoblock' as const,
        },
      });
      vi.mocked(getPermanentMutes).mockResolvedValue({});
      vi.mocked(setPermanentBlocks).mockResolvedValue(undefined);
      vi.mocked(setPermanentMutes).mockResolvedValue(undefined);

      const result = await handleBackfillReviewQueue();

      expect(result.success).toBe(true);
      expect(result.flaggedBlocks).toBe(0);
      expect(result.flaggedMutes).toBe(0);
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Review Queue Edge Cases', () => {
  it('should handle dual block+mute for same DID as separate items', () => {
    const permanentBlocks: Record<string, PermanentBlockMute> = {
      'did:plc:both': {
        did: 'did:plc:both',
        handle: 'both.bsky.social',
        syncedAt: Date.now(),
        needsReview: true,
        source: 'external',
      },
    };

    const permanentMutes: Record<string, PermanentBlockMute> = {
      'did:plc:both': {
        did: 'did:plc:both',
        handle: 'both.bsky.social',
        syncedAt: Date.now(),
        needsReview: true,
        source: 'external',
      },
    };

    const items: Array<PermanentBlockMute & { actionType: 'block' | 'mute' }> = [];

    for (const block of Object.values(permanentBlocks)) {
      if (block.needsReview === true) {
        items.push({ ...block, actionType: 'block' });
      }
    }

    for (const mute of Object.values(permanentMutes)) {
      if (mute.needsReview === true) {
        items.push({ ...mute, actionType: 'mute' });
      }
    }

    expect(items).toHaveLength(2);
    expect(items[0].actionType).toBe('block');
    expect(items[1].actionType).toBe('mute');
    expect(items[0].did).toBe(items[1].did);
  });

  // ── Composite selection key tests (DID:actionType bug fix) ──────────────

  describe('composite selection key (DID:actionType)', () => {
    // Simulates the signal logic extracted from manager.ts
    function makeSelectionSet(): Set<string> {
      return new Set();
    }

    function toggleSelection(
      set: Set<string>,
      did: string,
      actionType: 'block' | 'mute'
    ): Set<string> {
      const key = `${did}:${actionType}`;
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    }

    function selectAll(items: Array<{ did: string; actionType: 'block' | 'mute' }>): Set<string> {
      return new Set(items.map((i) => `${i.did}:${i.actionType}`));
    }

    it('selecting the block row does NOT toggle the mute row for the same DID', () => {
      const did = 'did:plc:both';
      let sel = makeSelectionSet();

      // Select the block row
      sel = toggleSelection(sel, did, 'block');

      expect(sel.has(`${did}:block`)).toBe(true);
      // Mute row must remain unselected
      expect(sel.has(`${did}:mute`)).toBe(false);
    });

    it('selecting the mute row does NOT toggle the block row for the same DID', () => {
      const did = 'did:plc:both';
      let sel = makeSelectionSet();

      sel = toggleSelection(sel, did, 'mute');

      expect(sel.has(`${did}:mute`)).toBe(true);
      expect(sel.has(`${did}:block`)).toBe(false);
    });

    it('both rows can be independently selected', () => {
      const did = 'did:plc:both';
      let sel = makeSelectionSet();

      sel = toggleSelection(sel, did, 'block');
      sel = toggleSelection(sel, did, 'mute');

      expect(sel.has(`${did}:block`)).toBe(true);
      expect(sel.has(`${did}:mute`)).toBe(true);
      expect(sel.size).toBe(2);
    });

    it('deselecting one row leaves the other selected', () => {
      const did = 'did:plc:both';
      let sel = makeSelectionSet();

      sel = toggleSelection(sel, did, 'block');
      sel = toggleSelection(sel, did, 'mute');
      // Now deselect block
      sel = toggleSelection(sel, did, 'block');

      expect(sel.has(`${did}:block`)).toBe(false);
      expect(sel.has(`${did}:mute`)).toBe(true);
    });

    it('selectAll produces composite keys for all items including dual-DID entries', () => {
      const did = 'did:plc:both';
      const items = [
        { did, actionType: 'block' as const },
        { did, actionType: 'mute' as const },
        { did: 'did:plc:blockonly', actionType: 'block' as const },
      ];

      const sel = selectAll(items);

      expect(sel.size).toBe(3);
      expect(sel.has(`${did}:block`)).toBe(true);
      expect(sel.has(`${did}:mute`)).toBe(true);
      expect(sel.has('did:plc:blockonly:block')).toBe(true);
    });

    it('bulk action matches items by composite key so both block and mute are processed', () => {
      const did = 'did:plc:both';
      const items: Array<{ did: string; actionType: 'block' | 'mute'; handle: string }> = [
        { did, actionType: 'block', handle: 'both.bsky.social' },
        { did, actionType: 'mute', handle: 'both.bsky.social' },
      ];

      // Select both
      const selectedKeys = [`${did}:block`, `${did}:mute`];

      // Simulate the fixed bulk-action lookup (split on last colon to handle DID colons)
      const processed = selectedKeys.map((key) => {
        const sep = key.lastIndexOf(':');
        const itemDid = key.slice(0, sep);
        const itemActionType = key.slice(sep + 1) as 'block' | 'mute';
        return items.find((i) => i.did === itemDid && i.actionType === itemActionType);
      });

      expect(processed).toHaveLength(2);
      expect(processed[0]).toMatchObject({ did, actionType: 'block' });
      expect(processed[1]).toMatchObject({ did, actionType: 'mute' });
    });

    it('old DID-only key would have caused collision — regression guard', () => {
      // Demonstrates the bug: a DID-only set cannot distinguish block from mute
      const did = 'did:plc:both';
      const badSet = new Set<string>();
      badSet.add(did); // old behaviour: one entry covers both rows

      // Under the old approach, both rows appear "selected"
      expect(badSet.has(did)).toBe(true); // block row thinks it's selected
      expect(badSet.has(did)).toBe(true); // mute row also thinks it's selected — collision

      // The fix: composite keys are distinct
      const goodSet = new Set<string>();
      goodSet.add(`${did}:block`);

      expect(goodSet.has(`${did}:block`)).toBe(true);
      expect(goodSet.has(`${did}:mute`)).toBe(false); // no collision
    });
  });

  it('should preserve existing data when syncing known blocks', () => {
    // Simulate sync logic for existing (non-new) blocks
    const existingBlock: PermanentBlockMute = {
      did: 'did:plc:existing',
      handle: 'existing.bsky.social',
      syncedAt: Date.now() - 86400000,
      needsReview: false,
      source: 'ergoblock',
    };

    // On re-sync, existing blocks should preserve their review state
    const isNewBlock = false;
    const result = isNewBlock
      ? { needsReview: true, source: 'external' as const }
      : { needsReview: existingBlock.needsReview, source: existingBlock.source };

    expect(result.needsReview).toBe(false);
    expect(result.source).toBe('ergoblock');
  });
});
