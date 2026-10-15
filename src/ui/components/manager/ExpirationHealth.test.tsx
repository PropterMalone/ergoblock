import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { ExpirationHealth } from './ExpirationHealth.js';
import {
  emptyExpirationHealth,
  getExpirationHealthView,
} from '../../../platform/expiration-health.js';
import { send } from '../../../platform/messages.js';
vi.mock('../../../platform/expiration-health.js', async (original) => ({
  ...(await original<typeof import('../../../platform/expiration-health.js')>()),
  getExpirationHealthView: vi.fn(),
}));
vi.mock('../../../platform/messages.js', () => ({ send: vi.fn() }));
vi.mock('../../../platform/browser.js', () => ({
  default: { storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } },
}));
beforeEach(() => {
  vi.mocked(getExpirationHealthView).mockResolvedValue({
    health: { ...emptyExpirationHealth(), status: 'needs_auth', authNeedsAttention: true },
    overdueBlocks: 2,
    overdueMutes: 1,
  });
  vi.mocked(send).mockResolvedValue({
    success: false,
    outcome: { ...emptyExpirationHealth(), status: 'needs_auth', healthSaved: true },
    error: 'Open Bluesky and sign in.',
  });
});
afterEach(cleanup);
it('shows queued recovery and exhausted retries instead of success', async () => {
  vi.mocked(getExpirationHealthView).mockResolvedValue({
    health: {
      ...emptyExpirationHealth(),
      status: 'failed',
      pendingRecoveryCount: 2,
      exhaustedRecoveryCount: 1,
      reason: 'Pending recovery remains queued.',
    },
    overdueBlocks: 0,
    overdueMutes: 0,
  });
  const view = render(<ExpirationHealth />);
  await waitFor(() => expect(view.getByText(/2 pending recovery actions/)).toBeTruthy());
  expect(view.getByText(/1 exhausted automatic retries/)).toBeTruthy();
  expect(view.getByText('Pending recovery remains queued.')).toBeTruthy();
});
it('renders accessible health, overdue counts, coverage limits, and a truthful retry', async () => {
  const view = render(<ExpirationHealth />);
  await waitFor(() =>
    expect(view.getByRole('status').textContent).toContain('Sign-in needs attention')
  );
  expect(view.getByText('2 overdue blocks · 1 overdue mutes')).toBeTruthy();
  expect(view.getByText(/Last successful check: Never/)).toBeTruthy();
  expect(view.getByText('About expiration checks').closest('details')?.open).toBe(false);
  expect(view.getByRole('button', { name: 'Check now' })).toBeTruthy();
  expect(view.getByText(/cannot verify which account created older/)).toBeTruthy();
  expect(view.getByText(/browser is closed or offline/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Check now' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith('CHECK_NOW'));
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Open Bluesky'));
});
it('shows running state and disables duplicate manual checks', async () => {
  vi.mocked(getExpirationHealthView).mockResolvedValue({
    health: { ...emptyExpirationHealth(), status: 'running' },
    overdueBlocks: 0,
    overdueMutes: 0,
  });
  const view = render(<ExpirationHealth />);
  await waitFor(() => expect(view.getByRole('status').textContent).toContain('Check running'));
  expect((view.getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled).toBe(
    true
  );
});
