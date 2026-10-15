import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAssignDurationToPermanent } from './action-duration.js';
import * as storage from '../platform/storage.js';
vi.mock('./api-client.js', () => ({
  getAuthToken: vi.fn(async () => ({ did: 'did:plc:owner' })),
  captureAuthGeneration: vi.fn(() => 0),
  withAuthSession: vi.fn(async (_auth: unknown, operation: () => Promise<unknown>) => operation()),
}));
vi.mock('../platform/storage.js', () => ({
  getPermanentBlocks: vi.fn(),
  getPermanentMutes: vi.fn(),
  addTempBlock: vi.fn(),
  addTempMute: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getPermanentBlocks).mockResolvedValue({
    'did:plc:target': {
      did: 'did:plc:target',
      handle: 'target.test',
      syncedAt: 1,
      rkey: 'existing',
      needsReview: true,
    },
  });
  vi.mocked(storage.getPermanentMutes).mockResolvedValue({
    'did:plc:target': { did: 'did:plc:target', handle: 'target.test', syncedAt: 1 },
  });
});
describe('set expiration on an existing action', () => {
  it('tracks the existing block rkey without creating a server block or changing legacy metadata', async () => {
    expect(await handleAssignDurationToPermanent('did:plc:target', 'block', 3600000)).toEqual({
      success: true,
    });
    expect(storage.addTempBlock).toHaveBeenCalledWith(
      'did:plc:target',
      'target.test',
      3600000,
      'existing',
      expect.objectContaining({ ownerDid: 'did:plc:owner' })
    );
    expect(storage.addTempMute).not.toHaveBeenCalled();
  });
  it('tracks an existing mute', async () => {
    expect(await handleAssignDurationToPermanent('did:plc:target', 'mute', 3600000)).toEqual({
      success: true,
    });
    expect(storage.addTempMute).toHaveBeenCalledWith(
      'did:plc:target',
      'target.test',
      3600000,
      expect.objectContaining({ ownerDid: 'did:plc:owner' })
    );
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid duration %s', async (duration) => {
    expect(
      (await handleAssignDurationToPermanent('did:plc:target', 'block', duration)).success
    ).toBe(false);
    expect(storage.addTempBlock).not.toHaveBeenCalled();
  });
  it('returns missing-action and storage failures', async () => {
    expect((await handleAssignDurationToPermanent('missing', 'block', 1)).success).toBe(false);
    vi.mocked(storage.addTempMute).mockRejectedValueOnce(new Error('quota full'));
    expect(await handleAssignDurationToPermanent('did:plc:target', 'mute', 1)).toEqual({
      success: false,
      error: 'quota full',
    });
  });
});
