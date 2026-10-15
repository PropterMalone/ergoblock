import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { render as mount } from 'preact';
import browser from './platform/browser.js';
import { send } from './platform/messages.js';
import { PopupApp } from './popup.js';

vi.mock('./platform/messages.js', () => ({ send: vi.fn() }));

beforeEach(() => {
  const initial = document.getElementById('app');
  if (initial) {
    mount(null, initial);
    initial.remove();
  }
  vi.clearAllMocks();
  Object.assign(browser, { tabs: { query: vi.fn().mockResolvedValue([]), create: vi.fn() } });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('popup startup recovery', () => {
  it.each(['auth rejection', 'missing auth response', 'tabs rejection'])(
    'shows retry and manager after %s and recovers',
    async (failure) => {
      if (failure === 'auth rejection') vi.mocked(send).mockRejectedValueOnce(new Error('offline'));
      else if (failure === 'missing auth response')
        vi.mocked(send).mockResolvedValueOnce(undefined as never);
      else {
        vi.mocked(send).mockResolvedValueOnce({ success: true, isAuthenticated: true });
        vi.mocked(browser.tabs.query).mockRejectedValueOnce(new Error('tabs unavailable'));
      }
      const view = render(<PopupApp />);
      const retry = await view.findByRole('button', { name: 'Retry' });
      expect(view.getByRole('alert').textContent).toMatch(/could not load/i);
      expect(view.getByRole('button', { name: 'Open manager' })).toBeTruthy();
      expect(console.error).toHaveBeenCalled();
      vi.mocked(send).mockResolvedValueOnce({ success: true, isAuthenticated: true });
      fireEvent.click(retry);
      await waitFor(() => expect(view.getByText('Open a Bluesky profile')).toBeTruthy());
      expect(view.queryByRole('alert')).toBeNull();
    }
  );
});
