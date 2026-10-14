import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, act } from '@testing-library/preact';
import { QuoteSweepTab } from './QuoteSweepTab.js';
import { send } from '../../../platform/messages.js';
import * as state from '../../signals/manager.js';
import type { QuotePoster } from '../../../types.js';

vi.mock('../../../platform/messages.js', () => ({ send: vi.fn() }));
const uri = 'at://did:plc:author/app.bsky.feed.post/key';
const account = (did: string, extra: Partial<QuotePoster> = {}): QuotePoster => ({
  did,
  handle: did,
  alreadyBlocked: false,
  alreadyMuted: false,
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  state.resetQuoteSweepState();
  state.quoteActionType.value = 'block';
  state.quoteDuration.value = 604800000;
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
  it('requires explicit audience selection, even when arriving with a post deep link', () => {
    state.quoteAutoFetch.value = true;
    const view = setup();
    expect(view.getByText('Post actions')).toBeTruthy();
    expect(
      (view.getByRole('button', { name: 'Fetch accounts' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['quotes', 'reposts', 'likes'])(
    'sends the explicitly chosen %s audience without any writes',
    async (audience) => {
      vi.mocked(send).mockResolvedValue({
        success: true,
        subject: uri,
        quoters: [account('did:plc:a')],
      });
      const view = setup();
      await fetchAudience(view, audience);
      expect(send).toHaveBeenCalledWith(
        'GET_QUOTE_POSTERS',
        expect.objectContaining({ postRef: uri, audience, requestId: expect.any(String) })
      );
      expect(send).toHaveBeenCalledTimes(1);
    }
  );

  it('protects followed and already-actioned accounts, while allowing review exclusions', async () => {
    vi.mocked(send).mockResolvedValue({
      success: true,
      subject: uri,
      quoters: [
        account('did:plc:a'),
        account('did:plc:friend', { followed: true }),
        account('did:plc:blocked', { alreadyBlocked: true }),
      ],
    });
    const view = setup();
    await fetchAudience(view);
    expect([...state.quoteSelected.value]).toEqual(['did:plc:a']);
    fireEvent.click(view.getByRole('checkbox', { name: /did:plc:a/ }));
    expect(state.quoteSelected.value.size).toBe(0);
    expect((view.getByRole('checkbox', { name: /friend/ }) as HTMLInputElement).disabled).toBe(
      true
    );
    fireEvent.click(view.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(state.quoteSelected.value.size).toBe(0));
  });

  it('disables select-all and never auto-selects after action changes with degraded viewer state', async () => {
    vi.mocked(send).mockResolvedValue({
      success: true,
      subject: uri,
      viewerStateUnavailable: true,
      truncated: true,
      quoters: [account('did:plc:a')],
    });
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

  it('names audience, count, action, post and permanent duration before writing; declined confirmation writes nothing', async () => {
    vi.mocked(send).mockResolvedValue({
      success: true,
      subject: uri,
      quoters: [account('did:plc:a')],
    });
    const view = setup();
    await fetchAudience(view);
    fireEvent.click(view.getByRole('button', { name: 'Mute' }));
    fireEvent.change(view.getByLabelText('Duration:'), { target: { value: '-1' } });
    await waitFor(() => expect(state.quoteDuration.value).toBe(-1));
    fireEvent.click(view.getByRole('button', { name: 'Mute Selected (1)' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(
        /Mute 1 account\(s\).*Likers[\s\S]*Post: https:\/\/bsky.app[\s\S]*PERMANENT[\s\S]*stay muted/
      )
    );
    expect(send).toHaveBeenCalledTimes(1);
    vi.mocked(confirm).mockReturnValue(true);
    vi.mocked(send).mockResolvedValue({ created: 1, failed: 0, skipped: 0, errors: [] });
    fireEvent.click(view.getByRole('button', { name: 'Mute Selected (1)' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('BULK_TEMP_ACTION', {
        dids: ['did:plc:a'],
        handles: { 'did:plc:a': 'did:plc:a' },
        isMute: true,
        durationMs: -1,
        isPermanent: true,
      })
    );
  });

  it('confirms the temporary duration and sends only the reviewed selection', async () => {
    vi.mocked(send).mockResolvedValue({
      success: true,
      subject: uri,
      quoters: [account('did:plc:a'), account('did:plc:b')],
    });
    const view = setup();
    await fetchAudience(view, 'reposts');
    fireEvent.click(view.getByRole('checkbox', { name: /did:plc:b/ }));
    vi.mocked(confirm).mockReturnValue(true);
    vi.mocked(send).mockResolvedValue({ created: 1, failed: 0, skipped: 0, errors: [] });
    fireEvent.click(view.getByRole('button', { name: 'Block Selected (1)' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/Block 1 account\(s\) from Reposters[\s\S]*Duration: 7 days/)
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'BULK_TEMP_ACTION',
        expect.objectContaining({
          dids: ['did:plc:a'],
          durationMs: 604800000,
          isPermanent: false,
          isMute: false,
        })
      )
    );
  });

  it('preserves exclusions across action switches and sends only the reviewed DID', async () => {
    vi.mocked(send).mockResolvedValue({
      success: true,
      subject: uri,
      quoters: [account('did:plc:included'), account('did:plc:excluded')],
    });
    const view = setup();
    await fetchAudience(view, 'reposts');
    fireEvent.click(view.getByRole('checkbox', { name: /did:plc:excluded/ }));
    expect([...state.quoteSelected.value]).toEqual(['did:plc:included']);

    fireEvent.click(view.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(state.quoteActionType.value).toBe('mute'));
    expect([...state.quoteSelected.value]).toEqual(['did:plc:included']);

    fireEvent.click(view.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(state.quoteActionType.value).toBe('block'));
    expect([...state.quoteSelected.value]).toEqual(['did:plc:included']);

    fireEvent.click(view.getByRole('button', { name: 'Block' }));
    expect([...state.quoteSelected.value]).toEqual(['did:plc:included']);

    vi.mocked(confirm).mockReturnValue(true);
    vi.mocked(send).mockResolvedValue({ created: 1, failed: 0, skipped: 0, errors: [] });
    fireEvent.click(view.getByRole('button', { name: 'Block Selected (1)' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'BULK_TEMP_ACTION',
        expect.objectContaining({ dids: ['did:plc:included'], isMute: false })
      )
    );
    const payload = vi.mocked(send).mock.calls.find(([type]) => type === 'BULK_TEMP_ACTION')?.[1];
    expect(payload).toEqual(
      expect.objectContaining({ dids: expect.not.arrayContaining(['did:plc:excluded']) })
    );
  });

  it('discards a fetch response after leaving the tab', async () => {
    let finish: (value: {
      success: boolean;
      subject: string;
      quoters: QuotePoster[];
    }) => void = () => {
      throw new Error('not started');
    };
    vi.mocked(send)
      .mockResolvedValue({ success: true })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
    const view = setup();
    fireEvent.change(view.getByLabelText('Audience'), { target: { value: 'quotes' } });
    fireEvent.click(view.getByRole('button', { name: 'Fetch accounts' }));
    await waitFor(() => expect(state.quoteLoading.value).toBe(true));
    view.unmount();
    await act(async () => {
      finish({ success: true, subject: uri, quoters: [account('did:plc:late')] });
    });
    expect(state.quoteQuoters.value).toEqual([]);
    expect(state.quoteLoading.value).toBe(false);
    expect(send).toHaveBeenCalledWith('CANCEL_POST_AUDIENCE_FETCH', {
      requestId: expect.any(String),
    });
  });

  it('cancels an in-flight fetch and ignores its late response after switching audience', async () => {
    let finish: (value: {
      success: boolean;
      subject: string;
      quoters: QuotePoster[];
    }) => void = () => {
      throw new Error('not started');
    };
    vi.mocked(send)
      .mockResolvedValue({ success: true })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
    const view = setup();
    fireEvent.change(view.getByLabelText('Audience'), { target: { value: 'likes' } });
    fireEvent.click(view.getByRole('button', { name: 'Fetch accounts' }));
    await waitFor(() => expect(state.quoteLoading.value).toBe(true));
    fireEvent.click(view.getByRole('button', { name: 'Cancel fetch' }));
    fireEvent.change(view.getByLabelText('Audience'), { target: { value: 'reposts' } });
    await act(async () => {
      finish({ success: true, subject: uri, quoters: [account('did:plc:late')] });
    });
    expect(state.quoteQuoters.value).toEqual([]);
    expect(state.quoteSelected.value.size).toBe(0);
    expect(send).toHaveBeenCalledWith('CANCEL_POST_AUDIENCE_FETCH', {
      requestId: expect.any(String),
    });
  });
});
