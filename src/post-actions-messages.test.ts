import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from './platform/browser.js';
import {
  handleFetchQuotePosters,
  cancelPostAudienceFetch,
  handleBulkTempAction,
} from './domains/quote-sweep.js';

vi.mock('./domains/quote-sweep.js', () => ({
  handleFetchQuotePosters: vi.fn(),
  cancelPostAudienceFetch: vi.fn(),
  handleBulkTempAction: vi.fn(),
}));
vi.mock('./domains/init.js', () => ({
  clearStaleSyncState: vi.fn(),
  clearBloatedStorageData: vi.fn(),
  migrateBlockedByCache: vi.fn(),
}));
vi.mock('./domains/expiration.js', () => ({ setupAlarm: vi.fn(), checkExpirations: vi.fn() }));
vi.mock('./domains/sync.js', () => ({ setupSyncAlarm: vi.fn(), performFullSync: vi.fn() }));
vi.mock('./domains/social-graph.js', () => ({
  setupFollowsSyncAlarm: vi.fn(),
  syncFollowsOnly: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function listener() {
  await import('./background.js');
  const calls = vi.mocked(browser.runtime.onMessage.addListener).mock.calls;
  const callback = calls[calls.length - 1]?.[0];
  if (!callback) throw new Error('Background listener not registered');
  return (message: unknown) => callback(message, {}, vi.fn());
}

describe('post actions message routing', () => {
  it('preserves old quote-only messages', async () => {
    const dispatch = await listener();
    vi.mocked(handleFetchQuotePosters).mockResolvedValue({ success: true, quoters: [] });
    expect(await dispatch({ type: 'GET_QUOTE_POSTERS', postRef: 'legacy' })).toEqual({
      success: true,
      quoters: [],
    });
    expect(handleFetchQuotePosters).toHaveBeenCalledWith('legacy', undefined, undefined);
    expect(handleBulkTempAction).not.toHaveBeenCalled();
  });
  it.each(['likes', 'reposts', 'quotes'])(
    'forwards the %s audience and cancellation ID without writing',
    async (audience) => {
      const dispatch = await listener();
      await dispatch({
        type: 'GET_QUOTE_POSTERS',
        postRef: 'post',
        audience,
        requestId: 'request',
      });
      expect(handleFetchQuotePosters).toHaveBeenCalledWith('post', audience, 'request');
      expect(await dispatch({ type: 'CANCEL_POST_AUDIENCE_FETCH', requestId: 'request' })).toEqual({
        success: true,
      });
      expect(cancelPostAudienceFetch).toHaveBeenCalledWith('request');
      expect(handleBulkTempAction).not.toHaveBeenCalled();
    }
  );
});
