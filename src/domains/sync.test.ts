// pattern: imperative shell (two-way reconciliation between local storage and Bluesky)
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// sync orchestrates the AppView (bgApiRequest), auth, viewer-state hydration, and storage.
// All boundaries are mocked so we assert the reconciliation contract: the propagation
// grace window protects fresh entries, and a null page aborts WITHOUT deleting anything.

vi.mock('./api-client.js', () => ({
  getAuthToken: vi.fn(),
  bgApiRequest: vi.fn(),
  PAGINATION_DELAY: 0,
}));

vi.mock('./graph-ops.js', () => ({
  fetchViewerStates: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../platform/storage.js', () => ({
  getTempBlocks: vi.fn().mockResolvedValue({}),
  removeTempBlock: vi.fn().mockResolvedValue(undefined),
  getPermanentBlocks: vi.fn().mockResolvedValue({}),
  setPermanentBlocks: vi.fn().mockResolvedValue(undefined),
  getTempMutes: vi.fn().mockResolvedValue({}),
  removeTempMute: vi.fn().mockResolvedValue(undefined),
  getPermanentMutes: vi.fn().mockResolvedValue({}),
  setPermanentMutes: vi.fn().mockResolvedValue(undefined),
  addHistoryEntry: vi.fn().mockResolvedValue(undefined),
  updateSyncState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../platform/utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/utils.js')>();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

import { performFullSync } from './sync.js';
import { getAuthToken, bgApiRequest } from './api-client.js';
import {
  getTempBlocks,
  removeTempBlock,
  getTempMutes,
  removeTempMute,
} from '../platform/storage.js';

const mockGetAuthToken = vi.mocked(getAuthToken);
const mockBgApiRequest = vi.mocked(bgApiRequest);
const mockGetTempBlocks = vi.mocked(getTempBlocks);
const mockRemoveTempBlock = vi.mocked(removeTempBlock);
const mockGetTempMutes = vi.mocked(getTempMutes);
const mockRemoveTempMute = vi.mocked(removeTempMute);

const AUTH = {
  accessJwt: 'jwt',
  refreshJwt: 'refresh',
  did: 'did:plc:owner',
  pdsUrl: 'https://pds.example',
};

/**
 * Route a sync API request to an empty page by endpoint. getBlocks/getMutes/listRecords
 * all return an empty, cursor-less page (a complete fetch with zero remote rows) unless a
 * per-test override says otherwise.
 */
function emptyPagesImpl(endpoint: string) {
  if (endpoint.startsWith('app.bsky.graph.getBlocks')) return Promise.resolve({ blocks: [] });
  if (endpoint.startsWith('app.bsky.graph.getMutes')) return Promise.resolve({ mutes: [] });
  if (endpoint.startsWith('com.atproto.repo.listRecords')) return Promise.resolve({ records: [] });
  return Promise.resolve({});
}

describe('performFullSync — reconciliation grace window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthToken.mockResolvedValue(AUTH);
    mockGetTempBlocks.mockResolvedValue({});
    mockGetTempMutes.mockResolvedValue({});
    mockBgApiRequest.mockImplementation((endpoint: string) => emptyPagesImpl(endpoint) as never);
  });

  it('does NOT reconciliation-delete a freshly-created temp block (within grace window)', async () => {
    // A temp block created 1s ago, absent from the (empty) remote fetch. AppView lag, not
    // an external unblock — must survive.
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:fresh': { handle: 'fresh.bsky', createdAt: Date.now() - 1000 },
    } as never);

    const result = await performFullSync();

    expect(result.success).toBe(true);
    expect(mockRemoveTempBlock).not.toHaveBeenCalled();
  });

  it('does reconciliation-delete a stale temp block absent from the remote (past grace window)', async () => {
    // Created 10 minutes ago (> 5min grace), absent remotely → user unblocked externally.
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:stale': { handle: 'stale.bsky', createdAt: Date.now() - 10 * 60 * 1000 },
    } as never);

    const result = await performFullSync();

    expect(result.success).toBe(true);
    expect(mockRemoveTempBlock).toHaveBeenCalledWith('did:plc:stale');
  });

  it('a null block page throws & aborts the block sync with NO deletions', async () => {
    // Even a stale temp block must NOT be deleted when the fetch is incomplete — a null
    // page means we can't prove the block is gone remotely.
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:stale': { handle: 'stale.bsky', createdAt: Date.now() - 10 * 60 * 1000 },
    } as never);
    mockBgApiRequest.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('app.bsky.graph.getBlocks')) return Promise.resolve(null) as never;
      return emptyPagesImpl(endpoint) as never;
    });

    const result = await performFullSync();

    // Block sync rejected → overall sync reports partial failure, and nothing was deleted.
    expect(result.success).toBe(false);
    expect(mockRemoveTempBlock).not.toHaveBeenCalled();
  });

  it('a null mute page aborts the mute sync with NO mute deletions', async () => {
    mockGetTempMutes.mockResolvedValue({
      'did:plc:stalemute': { handle: 'stale.bsky', createdAt: Date.now() - 10 * 60 * 1000 },
    } as never);
    mockBgApiRequest.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('app.bsky.graph.getMutes')) return Promise.resolve(null) as never;
      return emptyPagesImpl(endpoint) as never;
    });

    const result = await performFullSync();

    expect(result.success).toBe(false);
    expect(mockRemoveTempMute).not.toHaveBeenCalled();
  });
});
