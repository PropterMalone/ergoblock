import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, act } from '@testing-library/preact';
import { QuoteSweepTab } from './QuoteSweepTab.js';
import { send } from '../../../platform/messages.js';
import * as state from '../../signals/manager.js';
import type { QuotePoster } from '../../../types.js';

vi.mock('../../../platform/messages.js', () => ({ send: vi.fn() }));
vi.mock('../../../platform/browser.js', () => ({
  default: {
    storage: { local: { get: vi.fn(async () => ({ authToken: { did: 'did:plc:owner' } })) } },
  },
}));
const uri = 'at://did:plc:author/app.bsky.feed.post/key';
const account = (did: string, extra: Partial<QuotePoster> = {}): QuotePoster => ({
  did,
  handle: did,
  alreadyBlocked: false,
  alreadyMuted: false,
  ...extra,
});
let audienceResponse: {
  success: boolean;
  subject: string;
  quoters: QuotePoster[];
  viewerStateUnavailable?: boolean;
  truncated?: boolean;
};
let audienceRead: (() => Promise<typeof audienceResponse>) | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  state.resetQuoteSweepState();
  state.quoteActionType.value = 'block';
  state.quoteDuration.value = 604800000;
  audienceResponse = { success: true, subject: uri, quoters: [account('did:plc:a')] };
  audienceRead = undefined;
  vi.mocked(send).mockImplementation(async (type) => {
    if (type === 'GET_POST_BATCHES') return { runs: [] };
    if (type === 'GET_QUOTE_POSTERS') return audienceRead ? audienceRead() : audienceResponse;
    if (type === 'START_POST_BATCH') return { id: 'saved-run' };
    return { success: true };
  });
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup() {
  state.quotePostRef.value = uri;
  return render(<QuoteSweepTab onReload={vi.fn().mockResolvedValue(undefined)} />);
}
async function fetchAudience(view: ReturnType<typeof setup>, audience = 'likes') {
  fireEvent.change(view.getByLabelText('Audience'), { target: { value: audience } });
  fireEvent.click(view.getByRole('button', { name: 'Fetch accounts' }));
  await waitFor(() => expect(state.quoteLoading.value).toBe(false));
}

describe('Post actions review', () => {
  it('requires audience choice while loading durable past outcomes', () => {
    state.quoteAutoFetch.value = true;
    const view = setup();
    expect(
      (view.getByRole('button', { name: 'Fetch accounts' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(send).toHaveBeenCalledWith('GET_POST_BATCHES', {});
    expect(send).not.toHaveBeenCalledWith('GET_QUOTE_POSTERS', expect.anything());
    expect(send).not.toHaveBeenCalledWith('START_POST_BATCH', expect.anything());
  });
  it.each(['quotes', 'reposts', 'likes'])(
    'fetches only chosen %s audience, without writes',
    async (audience) => {
      const view = setup();
      await fetchAudience(view, audience);
      expect(send).toHaveBeenCalledWith(
        'GET_QUOTE_POSTERS',
        expect.objectContaining({ postRef: uri, audience, requestId: expect.any(String) })
      );
      expect(send).not.toHaveBeenCalledWith('START_POST_BATCH', expect.anything());
    }
  );
  it('protects followed/already-active accounts and preserves manual exclusions across action switches', async () => {
    audienceResponse.quoters = [
      account('did:plc:a'),
      account('did:plc:b'),
      account('did:plc:friend', { followed: true }),
      account('did:plc:blocked', { alreadyBlocked: true }),
    ];
    const view = setup();
    await fetchAudience(view, 'reposts');
    expect([...state.quoteSelected.value]).toEqual(['did:plc:a', 'did:plc:b']);
    expect((view.getByRole('checkbox', { name: /friend/ }) as HTMLInputElement).disabled).toBe(
      true
    );
    fireEvent.click(view.getByRole('checkbox', { name: 'Select @did:plc:b' }));
    fireEvent.click(view.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(state.quoteActionType.value).toBe('mute'));
    fireEvent.click(view.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(state.quoteActionType.value).toBe('block'));
    vi.mocked(confirm).mockReturnValue(true);
    fireEvent.click(view.getByRole('button', { name: 'Block Selected (1)' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('START_POST_BATCH', {
        owner: 'did:plc:owner',
        sourcePost: uri,
        audience: 'reposts',
        action: 'block',
        durationMs: 604800000,
        confirmed: true,
        targets: [{ did: 'did:plc:a', handle: 'did:plc:a' }],
      })
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(
        /Block 1 account\(s\) from Reposters[\s\S]*Account: did:plc:owner[\s\S]*Duration: 7 days/
      )
    );
    expect(send).not.toHaveBeenCalledWith('BULK_TEMP_ACTION', expect.anything());
  });
  it('disables select-all and clears selection when viewer state is unavailable', async () => {
    audienceResponse.viewerStateUnavailable = true;
    audienceResponse.truncated = true;
    const view = setup();
    await fetchAudience(view);
    expect(state.quoteSelected.value.size).toBe(0);
    expect((view.getByRole('button', { name: 'Select All' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    fireEvent.click(view.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(state.quoteActionType.value).toBe('mute'));
    expect(state.quoteSelected.value.size).toBe(0);
    expect(view.getByText(/incomplete/)).toBeTruthy();
  });
  it('names owner/audience/count/post/permanent duration and does nothing on declined confirmation', async () => {
    const view = setup();
    await fetchAudience(view);
    fireEvent.click(view.getByRole('button', { name: 'Mute' }));
    fireEvent.change(view.getByLabelText('Duration:'), { target: { value: '-1' } });
    await waitFor(() => expect(state.quoteDuration.value).toBe(-1));
    fireEvent.click(view.getByRole('button', { name: 'Mute Selected (1)' }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        expect.stringMatching(
          /Mute 1 account\(s\).*Likers[\s\S]*Account: did:plc:owner[\s\S]*Post: https:\/\/bsky.app[\s\S]*PERMANENT[\s\S]*stay muted/
        )
      )
    );
    expect(send).not.toHaveBeenCalledWith('START_POST_BATCH', expect.anything());
    vi.mocked(confirm).mockReturnValue(true);
    fireEvent.click(view.getByRole('button', { name: 'Mute Selected (1)' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'START_POST_BATCH',
        expect.objectContaining({ durationMs: -1, action: 'mute', confirmed: true })
      )
    );
  });
  it.each(['leave', 'cancel'])('ignores late fetch results after %s', async (mode) => {
    let finish!: (value: typeof audienceResponse) => void;
    audienceRead = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const view = setup();
    fireEvent.change(view.getByLabelText('Audience'), { target: { value: 'quotes' } });
    fireEvent.click(view.getByRole('button', { name: 'Fetch accounts' }));
    await waitFor(() => expect(finish).toBeDefined());
    if (mode === 'leave') view.unmount();
    else {
      fireEvent.click(view.getByRole('button', { name: 'Cancel fetch' }));
      fireEvent.change(view.getByLabelText('Audience'), { target: { value: 'reposts' } });
    }
    await act(async () =>
      finish({ success: true, subject: uri, quoters: [account('did:plc:late')] })
    );
    expect(state.quoteQuoters.value).toEqual([]);
    expect(state.quoteSelected.value.size).toBe(0);
    expect(state.quoteLoading.value).toBe(false);
    expect(send).toHaveBeenCalledWith('CANCEL_POST_AUDIENCE_FETCH', {
      requestId: expect.any(String),
    });
  });
});
