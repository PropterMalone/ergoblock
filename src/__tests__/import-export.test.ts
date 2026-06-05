import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
const mockGetAuthToken = vi.fn();
const mockBgApiRequest = vi.fn();
const mockBlockUser = vi.fn();
const mockGetTempBlocks = vi.fn();
const mockGetTempMutes = vi.fn();
const mockAddTempBlock = vi.fn();
const mockAddTempMute = vi.fn();
const mockGetPermanentBlocks = vi.fn();
const mockSetPermanentBlocks = vi.fn();
const mockGetPermanentMutes = vi.fn();
const mockSetPermanentMutes = vi.fn();
const mockAddPostContext = vi.fn();

vi.mock('../domains/api-client.js', () => ({
  getAuthToken: (...args: unknown[]) => mockGetAuthToken(...args),
  bgApiRequest: (...args: unknown[]) => mockBgApiRequest(...args),
}));

vi.mock('../domains/graph-ops.js', () => ({
  blockUser: (...args: unknown[]) => mockBlockUser(...args),
}));

vi.mock('../platform/storage/temp-actions.js', () => ({
  getTempBlocks: (...args: unknown[]) => mockGetTempBlocks(...args),
  getTempMutes: (...args: unknown[]) => mockGetTempMutes(...args),
  addTempBlock: (...args: unknown[]) => mockAddTempBlock(...args),
  addTempMute: (...args: unknown[]) => mockAddTempMute(...args),
}));

vi.mock('../platform/storage/permanent.js', () => ({
  getPermanentBlocks: (...args: unknown[]) => mockGetPermanentBlocks(...args),
  setPermanentBlocks: (...args: unknown[]) => mockSetPermanentBlocks(...args),
  getPermanentMutes: (...args: unknown[]) => mockGetPermanentMutes(...args),
  setPermanentMutes: (...args: unknown[]) => mockSetPermanentMutes(...args),
}));

vi.mock('../platform/storage/history.js', () => ({
  addPostContext: (...args: unknown[]) => mockAddPostContext(...args),
}));

vi.mock('../platform/utils.js', async () => {
  const actual = await vi.importActual('../platform/utils.js');
  return {
    ...actual,
    // Make sleep instant in tests
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

import { handleImportData } from '../domains/import-export.js';
import type { ExportData, ImportOptions } from '../types.js';

const AUTH = { accessJwt: 'jwt-123', did: 'did:plc:owner', pdsUrl: 'https://pds.example.com' };

const defaultOptions: ImportOptions = {
  importBlocks: true,
  importMutes: true,
  importContexts: true,
  skipExisting: true,
  asTemporary: false,
  tempDuration: 86400000,
};

const exportData: ExportData = {
  version: '1.0',
  exportedAt: Date.now(),
  blocks: [
    { did: 'did:plc:block1', handle: 'block1.bsky.social' },
    { did: 'did:plc:block2', handle: 'block2.bsky.social', createdAt: 1700000000000 },
  ],
  mutes: [{ did: 'did:plc:mute1', handle: 'mute1.bsky.social' }],
  contexts: [
    {
      id: 'ctx-1',
      postUri: 'at://did:plc:block1/app.bsky.feed.post/abc',
      postAuthorDid: 'did:plc:block1',
      postText: 'some post',
      targetHandle: 'block1.bsky.social',
      targetDid: 'did:plc:block1',
      actionType: 'block',
      permanent: false,
      timestamp: Date.now(),
    },
  ],
};

describe('handleImportData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthToken.mockResolvedValue(AUTH);
    mockGetTempBlocks.mockResolvedValue({});
    mockGetTempMutes.mockResolvedValue({});
    mockGetPermanentBlocks.mockResolvedValue({});
    mockGetPermanentMutes.mockResolvedValue({});
    mockBlockUser.mockResolvedValue({
      uri: 'at://did:plc:owner/app.bsky.graph.block/rkey1',
      cid: 'cid1',
    });
    mockBgApiRequest.mockResolvedValue(null);
    mockAddTempBlock.mockResolvedValue(undefined);
    mockAddTempMute.mockResolvedValue(undefined);
    mockSetPermanentBlocks.mockResolvedValue(undefined);
    mockSetPermanentMutes.mockResolvedValue(undefined);
    mockAddPostContext.mockResolvedValue(undefined);
  });

  it('returns auth error when not authenticated', async () => {
    mockGetAuthToken.mockResolvedValue(null);
    const result = await handleImportData(exportData, defaultOptions);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Not authenticated');
  });

  it('imports blocks as permanent by default', async () => {
    const result = await handleImportData(exportData, defaultOptions);
    expect(result.success).toBe(true);
    expect(result.blocksImported).toBe(2);
    expect(mockBlockUser).toHaveBeenCalledTimes(2);
    expect(mockSetPermanentBlocks).toHaveBeenCalledTimes(2);
  });

  it('imports mutes as permanent by default', async () => {
    const result = await handleImportData(exportData, defaultOptions);
    expect(result.mutesImported).toBe(1);
    expect(mockBgApiRequest).toHaveBeenCalledWith(
      'app.bsky.graph.muteActor',
      'POST',
      { actor: 'did:plc:mute1' },
      AUTH.accessJwt,
      AUTH.pdsUrl
    );
    expect(mockSetPermanentMutes).toHaveBeenCalledTimes(1);
  });

  it('imports post contexts', async () => {
    const result = await handleImportData(exportData, defaultOptions);
    expect(result.contextsImported).toBe(1);
    expect(mockAddPostContext).toHaveBeenCalledWith(exportData.contexts![0]);
  });

  it('skips existing blocks when skipExisting is true', async () => {
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:block1': { handle: 'block1', expiresAt: 999, createdAt: 1 },
    });
    const result = await handleImportData(exportData, defaultOptions);
    expect(result.blocksImported).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    expect(mockBlockUser).toHaveBeenCalledTimes(1);
  });

  it('skips existing mutes when skipExisting is true', async () => {
    mockGetPermanentMutes.mockResolvedValue({
      'did:plc:mute1': { did: 'did:plc:mute1', handle: 'mute1', syncedAt: 1 },
    });
    const result = await handleImportData(exportData, defaultOptions);
    expect(result.mutesImported).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
  });

  it('does not skip existing when skipExisting is false', async () => {
    mockGetTempBlocks.mockResolvedValue({
      'did:plc:block1': { handle: 'block1', expiresAt: 999, createdAt: 1 },
    });
    const opts = { ...defaultOptions, skipExisting: false };
    const result = await handleImportData(exportData, opts);
    expect(result.blocksImported).toBe(2);
    expect(result.skippedDuplicates).toBe(0);
  });

  it('imports as temporary when asTemporary is true', async () => {
    const opts = { ...defaultOptions, asTemporary: true, tempDuration: 3600000 };
    const result = await handleImportData(exportData, opts);
    expect(result.blocksImported).toBe(2);
    expect(result.mutesImported).toBe(1);
    expect(mockAddTempBlock).toHaveBeenCalledTimes(2);
    expect(mockAddTempMute).toHaveBeenCalledTimes(1);
    expect(mockSetPermanentBlocks).not.toHaveBeenCalled();
    expect(mockSetPermanentMutes).not.toHaveBeenCalled();
  });

  it('respects importBlocks=false', async () => {
    const opts = { ...defaultOptions, importBlocks: false };
    const result = await handleImportData(exportData, opts);
    expect(result.blocksImported).toBe(0);
    expect(mockBlockUser).not.toHaveBeenCalled();
    expect(result.mutesImported).toBe(1);
  });

  it('respects importMutes=false', async () => {
    const opts = { ...defaultOptions, importMutes: false };
    const result = await handleImportData(exportData, opts);
    expect(result.mutesImported).toBe(0);
    expect(result.blocksImported).toBe(2);
  });

  it('respects importContexts=false', async () => {
    const opts = { ...defaultOptions, importContexts: false };
    const result = await handleImportData(exportData, opts);
    expect(result.contextsImported).toBe(0);
    expect(mockAddPostContext).not.toHaveBeenCalled();
  });

  it('records errors for failed block API calls without stopping', async () => {
    mockBlockUser.mockRejectedValueOnce(new Error('Rate limited'));
    mockBlockUser.mockResolvedValueOnce({ uri: 'at://x/y/z', cid: 'c' });
    const result = await handleImportData(exportData, defaultOptions);
    expect(result.blocksImported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('block1.bsky.social');
    expect(result.errors[0]).toContain('Rate limited');
  });

  it('records errors for failed mute API calls without stopping', async () => {
    mockBgApiRequest.mockRejectedValueOnce(new Error('Server error'));
    const result = await handleImportData(exportData, defaultOptions);
    expect(result.mutesImported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('mute1.bsky.social');
  });

  it('extracts rkey from block record URI', async () => {
    mockBlockUser.mockResolvedValue({
      uri: 'at://did:plc:owner/app.bsky.graph.block/extracted-rkey',
      cid: 'c',
    });
    await handleImportData({ ...exportData, mutes: [], contexts: [] }, defaultOptions);
    // Check the permanent block was set with the extracted rkey
    const setCall = mockSetPermanentBlocks.mock.calls[0][0];
    expect(setCall['did:plc:block1'].rkey).toBe('extracted-rkey');
  });

  it('handles empty export data', async () => {
    const empty: ExportData = { version: '1.0', exportedAt: Date.now(), blocks: [], mutes: [] };
    const result = await handleImportData(empty, defaultOptions);
    expect(result.success).toBe(true);
    expect(result.blocksImported).toBe(0);
    expect(result.mutesImported).toBe(0);
    expect(result.contextsImported).toBe(0);
  });
});
