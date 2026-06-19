// pattern: imperative shell (orchestrates auth + graph API + storage with rollback)
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// Mock the three collaborators of the unified create primitive. graph-ops is an
// unmanaged boundary (third-party AT Protocol), storage is our own module wrapped
// thinly; both are mocked here so the test asserts the primitive's contract only.

vi.mock('./api-client.js', () => ({
  getAuthToken: vi.fn(),
}));

vi.mock('./graph-ops.js', () => ({
  blockUser: vi.fn(),
  muteUser: vi.fn(),
  unblockUser: vi.fn(),
  unmuteUser: vi.fn(),
}));

vi.mock('../platform/storage.js', () => ({
  getTempBlocks: vi.fn().mockResolvedValue({}),
  getTempMutes: vi.fn().mockResolvedValue({}),
  getPermanentBlocks: vi.fn().mockResolvedValue({}),
  setPermanentBlocks: vi.fn().mockResolvedValue(undefined),
  getPermanentMutes: vi.fn().mockResolvedValue({}),
  setPermanentMutes: vi.fn().mockResolvedValue(undefined),
  addTempBlock: vi.fn().mockResolvedValue(undefined),
  addTempMute: vi.fn().mockResolvedValue(undefined),
  addHistoryEntry: vi.fn().mockResolvedValue(undefined),
  setHasCreatedAction: vi.fn().mockResolvedValue(undefined),
  addPostContext: vi.fn().mockResolvedValue(undefined),
  addPendingRollback: vi.fn().mockResolvedValue(undefined),
  preCheckStorageQuota: vi.fn().mockResolvedValue(undefined),
  calculateEntrySize: vi.fn().mockReturnValue(200),
  // Re-export the real StorageQuotaError so `instanceof` works inside the primitive.
  StorageQuotaError: class StorageQuotaError extends Error {
    quotaInfo: { percentUsed: number };
    constructor(message: string, quotaInfo: { percentUsed: number }) {
      super(message);
      this.name = 'StorageQuotaError';
      this.quotaInfo = quotaInfo;
    }
  },
}));

import { handleCreateTempAction } from './user-actions.js';
import { getAuthToken } from './api-client.js';
import { blockUser, muteUser, unblockUser, unmuteUser } from './graph-ops.js';
import {
  getTempBlocks,
  getTempMutes,
  getPermanentBlocks,
  getPermanentMutes,
  setPermanentBlocks,
  setPermanentMutes,
  addTempBlock,
  addTempMute,
  addHistoryEntry,
  addPostContext,
  addPendingRollback,
  preCheckStorageQuota,
  StorageQuotaError,
} from '../platform/storage.js';
import type { SerializedPostContext } from '../types.js';

const mockGetAuthToken = vi.mocked(getAuthToken);
const mockBlockUser = vi.mocked(blockUser);
const mockMuteUser = vi.mocked(muteUser);
const mockUnblockUser = vi.mocked(unblockUser);
const mockUnmuteUser = vi.mocked(unmuteUser);
const mockGetTempBlocks = vi.mocked(getTempBlocks);
const mockGetTempMutes = vi.mocked(getTempMutes);
const mockGetPermanentBlocks = vi.mocked(getPermanentBlocks);
const mockGetPermanentMutes = vi.mocked(getPermanentMutes);
const mockSetPermanentBlocks = vi.mocked(setPermanentBlocks);
const mockSetPermanentMutes = vi.mocked(setPermanentMutes);
const mockAddTempBlock = vi.mocked(addTempBlock);
const mockAddTempMute = vi.mocked(addTempMute);
const mockAddHistoryEntry = vi.mocked(addHistoryEntry);
const mockAddPostContext = vi.mocked(addPostContext);
const mockAddPendingRollback = vi.mocked(addPendingRollback);
const mockPreCheckStorageQuota = vi.mocked(preCheckStorageQuota);

const VALID_AUTH = {
  accessJwt: 'jwt',
  refreshJwt: 'refresh',
  did: 'did:plc:owner',
  pdsUrl: 'https://pds.example',
};
const BLOCK_RESULT = { uri: 'at://did:plc:owner/app.bsky.graph.block/rkey123', cid: 'cid' };

const TARGET_DID = 'did:plc:target';
const HANDLE = 'target.bsky.social';
const DURATION = 60 * 60 * 1000;

describe('handleCreateTempAction — unified create primitive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthToken.mockResolvedValue(VALID_AUTH);
    mockBlockUser.mockResolvedValue(BLOCK_RESULT);
    mockMuteUser.mockResolvedValue(true);
    mockUnblockUser.mockResolvedValue(true);
    mockUnmuteUser.mockResolvedValue(true);
    // Re-establish resolving implementations: clearAllMocks clears call history but NOT
    // implementations, so a prior test's mockRejectedValue would otherwise leak forward.
    mockPreCheckStorageQuota.mockResolvedValue(undefined);
    mockAddTempBlock.mockResolvedValue(undefined);
    mockAddTempMute.mockResolvedValue(undefined);
    // Default read-back: entry present after write
    mockGetTempBlocks.mockResolvedValue({
      [TARGET_DID]: { handle: HANDLE, expiresAt: Date.now() + DURATION, createdAt: Date.now() },
    });
    mockGetTempMutes.mockResolvedValue({
      [TARGET_DID]: { handle: HANDLE, expiresAt: Date.now() + DURATION, createdAt: Date.now() },
    });
    mockGetPermanentBlocks.mockResolvedValue({
      [TARGET_DID]: {
        did: TARGET_DID,
        handle: HANDLE,
        createdAt: Date.now(),
        syncedAt: Date.now(),
      },
    });
    mockGetPermanentMutes.mockResolvedValue({
      [TARGET_DID]: {
        did: TARGET_DID,
        handle: HANDLE,
        createdAt: Date.now(),
        syncedAt: Date.now(),
      },
    });
  });

  it('auth missing → no API call, actionable error', async () => {
    mockGetAuthToken.mockResolvedValue(null);

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false);

    expect(res.success).toBe(false);
    expect(res.error).toContain('Not authenticated');
    expect(mockBlockUser).not.toHaveBeenCalled();
    expect(mockAddTempBlock).not.toHaveBeenCalled();
  });

  it('quota gates the API call for temp actions (error is a plain string, not a class)', async () => {
    mockPreCheckStorageQuota.mockRejectedValue(
      new StorageQuotaError('full', { percentUsed: 0.97 } as never)
    );

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false);

    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string');
    expect(res.error).toContain('Storage full');
    // API must NOT be called when quota would be exceeded
    expect(mockBlockUser).not.toHaveBeenCalled();
  });

  it('null block result → failure with NO storage write', async () => {
    mockBlockUser.mockResolvedValue(null);

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false);

    expect(res.success).toBe(false);
    expect(mockAddTempBlock).not.toHaveBeenCalled();
    expect(mockSetPermanentBlocks).not.toHaveBeenCalled();
    expect(mockAddHistoryEntry).not.toHaveBeenCalled();
  });

  it('happy path temp block: API → storage → verify → history', async () => {
    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false);

    expect(res.success).toBe(true);
    expect(mockBlockUser).toHaveBeenCalledOnce();
    expect(mockAddTempBlock).toHaveBeenCalledWith(TARGET_DID, HANDLE, DURATION, 'rkey123');
    expect(mockAddHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'blocked', success: true })
    );
  });

  it('storage-fail triggers immediate unblock rollback (no pending queue when undo succeeds)', async () => {
    mockAddTempBlock.mockRejectedValue(new Error('storage write failed'));

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false);

    expect(res.success).toBe(false);
    expect(mockUnblockUser).toHaveBeenCalledWith(
      TARGET_DID,
      VALID_AUTH.accessJwt,
      VALID_AUTH.did,
      VALID_AUTH.pdsUrl,
      'rkey123'
    );
    expect(mockAddPendingRollback).not.toHaveBeenCalled();
  });

  it('double-fail (storage + unblock) queues a well-formed pendingRollback', async () => {
    mockAddTempBlock.mockRejectedValue(new Error('storage write failed'));
    mockUnblockUser.mockRejectedValue(new Error('unblock failed'));

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false);

    expect(res.success).toBe(false);
    expect(mockAddPendingRollback).toHaveBeenCalledWith({
      type: 'unblock',
      did: TARGET_DID,
      handle: HANDLE,
      rkey: 'rkey123',
    });
  });

  it('read-back verification fails → rollback even though storage write "succeeded"', async () => {
    // addTempBlock resolves, but the entry is absent on read-back
    mockGetTempBlocks.mockResolvedValue({});

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false);

    expect(res.success).toBe(false);
    expect(mockUnblockUser).toHaveBeenCalled();
    expect(mockAddHistoryEntry).not.toHaveBeenCalled();
  });

  it('permanent block routes to permanent/local storage, never temp', async () => {
    const res = await handleCreateTempAction(TARGET_DID, HANDLE, 0, false, true);

    expect(res.success).toBe(true);
    expect(mockSetPermanentBlocks).toHaveBeenCalledOnce();
    expect(mockAddTempBlock).not.toHaveBeenCalled();
    // Quota pre-check is skipped for permanent (local storage, not bounded sync)
    expect(mockPreCheckStorageQuota).not.toHaveBeenCalled();
    expect(mockAddHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'blocked', duration: undefined })
    );
  });

  it('happy path temp mute: API → storage → verify → history', async () => {
    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, true, false);

    expect(res.success).toBe(true);
    expect(mockMuteUser).toHaveBeenCalledOnce();
    expect(mockAddTempMute).toHaveBeenCalledWith(TARGET_DID, HANDLE, DURATION);
    expect(mockAddHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'muted', success: true })
    );
  });

  it('mute storage-fail triggers unmute rollback', async () => {
    mockAddTempMute.mockRejectedValue(new Error('storage write failed'));

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, true, false);

    expect(res.success).toBe(false);
    expect(mockUnmuteUser).toHaveBeenCalledWith(
      TARGET_DID,
      VALID_AUTH.accessJwt,
      VALID_AUTH.pdsUrl
    );
  });

  it('permanent mute routes to permanent/local storage', async () => {
    const res = await handleCreateTempAction(TARGET_DID, HANDLE, 0, true, true);

    expect(res.success).toBe(true);
    expect(mockSetPermanentMutes).toHaveBeenCalledOnce();
    expect(mockAddTempMute).not.toHaveBeenCalled();
  });

  it('post context saved when provided', async () => {
    const ctx: SerializedPostContext = {
      postUri: 'at://did:plc:target/app.bsky.feed.post/abc',
      postAuthorDid: TARGET_DID,
      targetHandle: HANDLE,
      targetDid: TARGET_DID,
      actionType: 'block',
      permanent: false,
      timestamp: Date.now(),
    };

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false, ctx);

    expect(res.success).toBe(true);
    expect(mockAddPostContext).toHaveBeenCalledWith(
      expect.objectContaining({ postUri: ctx.postUri, id: expect.any(String) })
    );
  });

  it('post context skipped when null/omitted', async () => {
    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false, null);

    expect(res.success).toBe(true);
    expect(mockAddPostContext).not.toHaveBeenCalled();
  });

  it('a thrown addPostContext does NOT fail the create (best-effort)', async () => {
    mockAddPostContext.mockRejectedValue(new Error('idb write failed'));
    const ctx = {
      postUri: 'at://did:plc:target/app.bsky.feed.post/abc',
      postAuthorDid: TARGET_DID,
      targetHandle: HANDLE,
      targetDid: TARGET_DID,
      actionType: 'block' as const,
      permanent: false,
      timestamp: Date.now(),
    };

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, DURATION, false, false, ctx);

    // Create still succeeds even though the context persist threw.
    expect(res.success).toBe(true);
    expect(mockAddHistoryEntry).toHaveBeenCalled();
  });

  it('permanent normalization: a -1 duration is collapsed to permanent (never reaches addTempBlock)', async () => {
    // quote-sweep passes -1 for permanent; fix C normalizes it so it can never leak into
    // a temp write as a negative duration.
    const res = await handleCreateTempAction(TARGET_DID, HANDLE, -1, false, true);

    expect(res.success).toBe(true);
    expect(mockSetPermanentBlocks).toHaveBeenCalledOnce();
    expect(mockAddTempBlock).not.toHaveBeenCalled();
    // History records permanent as duration: undefined regardless of the -1 input.
    expect(mockAddHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'blocked', duration: undefined })
    );
  });

  it('permanent block read-back MISS does NOT roll back (local set is authoritative)', async () => {
    // Permanent goes to local storage; a read-back race must not undo a successful block.
    mockGetPermanentBlocks
      .mockResolvedValueOnce({}) // first read inside the write path (getPermanentBlocks before set)
      .mockResolvedValue({}); // any subsequent read still empty

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, 0, false, true);

    expect(res.success).toBe(true);
    expect(mockUnblockUser).not.toHaveBeenCalled();
    expect(mockAddPendingRollback).not.toHaveBeenCalled();
    expect(mockAddHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'blocked' })
    );
  });

  it('permanent mute read-back MISS does NOT roll back', async () => {
    mockGetPermanentMutes.mockResolvedValue({});

    const res = await handleCreateTempAction(TARGET_DID, HANDLE, 0, true, true);

    expect(res.success).toBe(true);
    expect(mockUnmuteUser).not.toHaveBeenCalled();
  });
});
