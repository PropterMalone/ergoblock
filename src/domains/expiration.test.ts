// pattern: imperative shell (auto-expire temp actions + process pending rollbacks)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// expiration orchestrates auth, graph un-actions, storage, and (for rollbacks) the raw
// executeApiRequest. All boundaries are mocked; we assert the expiry boundary condition
// (strict `<`) and the rollback delete using repo = owner DID.

vi.mock('../platform/browser.js', () => ({
  default: {
    storage: { local: { set: vi.fn().mockResolvedValue(undefined) } },
    alarms: { create: vi.fn(), clear: vi.fn() },
  },
}));

vi.mock('./api-client.js', () => ({
  getAuthToken: vi.fn(),
  requestFreshAuth: vi.fn().mockResolvedValue(null),
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./graph-ops.js', () => ({
  unblockUser: vi.fn().mockResolvedValue(true),
  unmuteUser: vi.fn().mockResolvedValue(true),
}));

vi.mock('../platform/api.js', () => ({
  executeApiRequest: vi.fn().mockResolvedValue({}),
}));

vi.mock('../platform/storage.js', () => ({
  getTempBlocks: vi.fn().mockResolvedValue({}),
  getTempMutes: vi.fn().mockResolvedValue({}),
  removeTempBlock: vi.fn().mockResolvedValue(undefined),
  removeTempMute: vi.fn().mockResolvedValue(undefined),
  addHistoryEntry: vi.fn().mockResolvedValue(undefined),
  cleanupExpiredPostContexts: vi.fn().mockResolvedValue(undefined),
  getOptions: vi.fn().mockResolvedValue({ notificationsEnabled: false }),
  getProcessableRollbacks: vi.fn().mockResolvedValue([]),
  updatePendingRollback: vi.fn().mockResolvedValue(undefined),
  removePendingRollback: vi.fn().mockResolvedValue(undefined),
  cleanupOldRollbacks: vi.fn().mockResolvedValue(0),
}));

import { checkExpirations } from './expiration.js';
import { getAuthToken } from './api-client.js';
import { unblockUser } from './graph-ops.js';
import { executeApiRequest } from '../platform/api.js';
import {
  getTempBlocks,
  getTempMutes,
  removeTempBlock,
  getProcessableRollbacks,
  removePendingRollback,
} from '../platform/storage.js';

const mockGetAuthToken = vi.mocked(getAuthToken);
const mockUnblockUser = vi.mocked(unblockUser);
const mockExecuteApiRequest = vi.mocked(executeApiRequest);
const mockGetTempBlocks = vi.mocked(getTempBlocks);
const mockGetTempMutes = vi.mocked(getTempMutes);
const mockRemoveTempBlock = vi.mocked(removeTempBlock);
const mockGetProcessableRollbacks = vi.mocked(getProcessableRollbacks);
const mockRemovePendingRollback = vi.mocked(removePendingRollback);

const AUTH = {
  accessJwt: 'jwt',
  refreshJwt: 'refresh',
  did: 'did:plc:owner',
  pdsUrl: 'https://pds.example',
};
const NOW = 1_700_000_000_000;

describe('checkExpirations — expiry boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    mockGetAuthToken.mockResolvedValue(AUTH);
    mockGetTempBlocks.mockResolvedValue({});
    mockGetTempMutes.mockResolvedValue({});
    mockGetProcessableRollbacks.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT expire an entry whose expiresAt === now (strict `<`)', async () => {
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:edge': { handle: 'edge.bsky', expiresAt: NOW, createdAt: NOW - 1000 },
    } as never);

    await checkExpirations();

    expect(mockUnblockUser).not.toHaveBeenCalled();
    expect(mockRemoveTempBlock).not.toHaveBeenCalled();
  });

  it('DOES expire an entry whose expiresAt is strictly before now', async () => {
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:past': {
        handle: 'past.bsky',
        expiresAt: NOW - 1,
        createdAt: NOW - 1000,
        rkey: 'rk',
      },
    } as never);

    await checkExpirations();

    expect(mockUnblockUser).toHaveBeenCalledWith(
      'did:plc:past',
      AUTH.accessJwt,
      AUTH.did,
      AUTH.pdsUrl,
      'rk'
    );
    expect(mockRemoveTempBlock).toHaveBeenCalledWith('did:plc:past');
  });
});

describe('checkExpirations — pending rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    mockGetAuthToken.mockResolvedValue(AUTH);
    mockGetTempBlocks.mockResolvedValue({});
    mockGetTempMutes.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an unblock rollback deletes the block record using repo = OWNER did', async () => {
    mockGetProcessableRollbacks.mockResolvedValue([
      {
        id: 'r1',
        type: 'unblock',
        did: 'did:plc:target',
        handle: 'target.bsky',
        rkey: 'rk1',
        attempts: 0,
      },
    ] as never);

    await checkExpirations();

    expect(mockExecuteApiRequest).toHaveBeenCalledWith(
      'com.atproto.repo.deleteRecord',
      'POST',
      {
        repo: AUTH.did, // owner did, NOT the blocked user's did
        collection: 'app.bsky.graph.block',
        rkey: 'rk1',
      },
      AUTH
    );
    expect(mockRemovePendingRollback).toHaveBeenCalledWith('r1');
  });
});
