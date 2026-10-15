import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { ActionsTable } from './ActionsTable.js';
import { blocks, mutes } from '../../signals/manager.js';
import { send } from '../../../platform/messages.js';
import browser from '../../../platform/browser.js';
vi.mock('../../../platform/messages.js', () => ({
  send: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../../platform/storage.js', async () => {
  const { DEFAULT_COLUMN_VISIBILITY } = await import('../../../types.js');
  return {
    getHasCreatedAction: vi.fn().mockResolvedValue(true),
    getColumnVisibility: vi.fn().mockResolvedValue(DEFAULT_COLUMN_VISIBILITY),
  };
});
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  blocks.value = [];
  mutes.value = [];
  Object.assign(browser.storage, { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } });
});
describe('existing action expiration', () => {
  it('offers separate expiration for permanent blocks and mutes without context or review controls', async () => {
    blocks.value = [
      { did: 'did:plc:target', handle: 'target.test', source: 'bluesky', type: 'block' },
    ];
    mutes.value = [
      { did: 'did:plc:target', handle: 'target.test', source: 'bluesky', type: 'mute' },
    ];
    const onReload = vi.fn().mockResolvedValue(undefined);
    render(<ActionsTable onUnblock={vi.fn()} onUnmute={vi.fn()} onReload={onReload} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set mute expiration' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Expire mute in' }), {
      target: { value: '86400000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set expiration' }));
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith('ASSIGN_DURATION_TO_PERMANENT', {
      did: 'did:plc:target',
      actionType: 'mute',
      duration: 86400000,
    });
    expect(screen.getByRole('button', { name: 'Set block expiration' })).toBeTruthy();
    expect(screen.queryByText('Context')).toBeNull();
    expect(screen.queryByText('Amnesty')).toBeNull();
  });
  it('does not offer conversion for an already temporary action', () => {
    blocks.value = [
      {
        did: 'did:plc:target',
        handle: 'target.test',
        source: 'ergoblock_temp',
        type: 'block',
        expiresAt: Date.now() + 10000,
      },
    ];
    render(<ActionsTable onUnblock={vi.fn()} onUnmute={vi.fn()} onReload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Set block expiration' })).toBeNull();
  });
});
