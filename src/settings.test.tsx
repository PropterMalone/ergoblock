import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, act } from '@testing-library/preact';
import { render as mount } from 'preact';
import { useState } from 'preact/hooks';
import { useStoredTheme } from './ui/hooks/useTheme.js';
import { OptionsApp } from './options.js';
import { SettingsTab } from './ui/components/manager/SettingsTab.js';
import browser from './platform/browser.js';
import { getOptions, setOptions } from './platform/storage.js';
import { setupAlarm } from './domains/expiration.js';
import { DEFAULT_OPTIONS } from './types.js';

let dark = false;
let listeners: Set<() => void>;
type StorageListener = (changes: Record<string, unknown>, area: string) => void;
let storageListeners: Set<StorageListener>;
beforeEach(() => {
  const initial = document.getElementById('app');
  if (initial) {
    mount(null, initial);
    initial.remove();
  }
  dark = false;
  listeners = new Set();
  storageListeners = new Set();
  Object.assign(browser.storage, {
    onChanged: {
      addListener: (listener: StorageListener) => storageListeners.add(listener),
      removeListener: (listener: StorageListener) => storageListeners.delete(listener),
    },
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return dark;
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }))
  );
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ManagerThemeHarness() {
  useStoredTheme();
  const [settings, setSettings] = useState(true);
  return (
    <>
      <button onClick={() => setSettings(false)}>Leave Settings</button>
      {settings ? (
        <SettingsTab onReload={vi.fn().mockResolvedValue(undefined)} />
      ) : (
        <div>Other tab</div>
      )}
    </>
  );
}

const screens = [
  { name: 'options', component: () => <OptionsApp />, intervalRole: 'slider' },
  {
    name: 'manager settings',
    component: () => <SettingsTab onReload={vi.fn().mockResolvedValue(undefined)} />,
    intervalRole: 'combobox',
  },
];

describe('manager theme ownership', () => {
  it.each([false, true])(
    'restores persisted theme on tab exit (failed save: %s)',
    async (failSave) => {
      await setOptions({ ...DEFAULT_OPTIONS, theme: 'light' });
      const view = render(<ManagerThemeHarness />);
      await view.findByRole('radio', { name: 'Dark' });
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
      await waitFor(() => expect(listeners.size).toBe(0));
      fireEvent.click(view.getByRole('radio', { name: 'Dark' }));
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
      if (failSave) {
        vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error('save rejected'));
        fireEvent.click(view.getByRole('button', { name: 'Save Settings' }));
        await view.findByText('Failed to save settings');
      }
      fireEvent.click(view.getByText('Leave Settings'));
      await view.findByText('Other tab');
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
      expect((await getOptions()).theme).toBe('light');
    }
  );

  it('keeps an explicit preview above saved Auto when the OS changes', async () => {
    await setOptions({ ...DEFAULT_OPTIONS, theme: 'auto' });
    const view = render(<ManagerThemeHarness />);
    await view.findByRole('radio', { name: 'Dark' });
    fireEvent.click(view.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await act(async () => {
      dark = true;
      listeners.forEach((listener) => listener());
      dark = false;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(listeners.size).toBe(0);
    fireEvent.click(view.getByText('Leave Settings'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(listeners.size).toBe(1);
    await act(async () => {
      dark = true;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('restores the latest stored theme after preview and follows storage updates on other tabs', async () => {
    await setOptions({ ...DEFAULT_OPTIONS, theme: 'dark' });
    const view = render(<ManagerThemeHarness />);
    await view.findByRole('radio', { name: 'Light' });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    fireEvent.click(view.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    await act(async () => {
      await setOptions({ ...DEFAULT_OPTIONS, theme: 'auto' });
      storageListeners.forEach((listener) => listener({ extensionOptions: {} }, 'local'));
    });
    await act(async () => {
      dark = true;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(view.getByText('Leave Settings'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await act(async () => {
      await setOptions({ ...DEFAULT_OPTIONS, theme: 'light' });
      storageListeners.forEach((listener) => listener({ extensionOptions: {} }, 'local'));
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });
});

describe.each(screens)('$name', ({ component, intervalRole }) => {
  it('names duration and interval controls and exposes their descriptions', async () => {
    const view = render(component());
    await view.findByRole('combobox', { name: 'Default block/mute duration' });
    expect(view.getByRole('combobox', { name: 'Quick block duration' })).toBeTruthy();
    const interval = view.getByRole(intervalRole, { name: 'Check interval' });
    expect(
      document.getElementById(interval.getAttribute('aria-describedby') ?? '')?.textContent
    ).toMatch(/How often/);
    expect(view.queryByRole('spinbutton', { name: 'Forgiveness period' })).toBeNull();
    expect(view.queryByText('Save post context')).toBeNull();
    expect(view.queryByText('Amnesty')).toBeNull();
  });

  it('preserves retired option values when resetting active settings', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    await setOptions({
      ...DEFAULT_OPTIONS,
      savePostContext: false,
      postContextRetentionDays: 123,
      forgivenessPeriodDays: 45,
    });
    const view = render(component());
    fireEvent.click(await view.findByRole('button', { name: 'Reset to Defaults' }));
    await waitFor(async () =>
      expect(await getOptions()).toMatchObject({
        savePostContext: false,
        postContextRetentionDays: 123,
        forgivenessPeriodDays: 45,
      })
    );
  });

  it('normalizes legacy intervals to the value actually scheduled', async () => {
    await browser.storage.local.set({
      extensionOptions: { ...DEFAULT_OPTIONS, checkInterval: 1440 },
    });
    const view = render(component());
    const interval = await view.findByRole(intervalRole, { name: 'Check interval' });
    expect((interval as HTMLInputElement).value).toBe('10');
    await setupAlarm();
    expect(browser.alarms.create).toHaveBeenLastCalledWith('checkExpirations', {
      periodInMinutes: 10,
    });
    if (interval instanceof HTMLSelectElement)
      expect(Array.from(interval.options).map((option) => Number(option.value))).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
  });

  it('applies saved theme, previews changes, saves and restores on remount; Auto follows the OS', async () => {
    await setOptions({ ...DEFAULT_OPTIONS, theme: 'dark' });
    const view = render(component());
    await view.findByRole('radio', { name: 'Dark' });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(document.documentElement.style.colorScheme).toBe('dark');
    fireEvent.click(view.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    fireEvent.click(view.getByRole('button', { name: 'Save Settings' }));
    await waitFor(async () => expect((await getOptions()).theme).toBe('light'));
    view.unmount();
    const remounted = render(component());
    await remounted.findByRole('radio', { name: 'Light' });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    fireEvent.click(remounted.getByRole('radio', { name: 'Auto' }));
    await act(async () => {
      dark = true;
      listeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await act(async () => {
      dark = false;
      listeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });
});
