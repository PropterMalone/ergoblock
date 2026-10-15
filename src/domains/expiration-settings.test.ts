import { beforeEach, describe, expect, it, vi } from 'vitest';
import browser from '../platform/browser.js';
import { setOptions } from '../platform/storage.js';
import { DEFAULT_OPTIONS } from '../types.js';
import { setupAlarm } from './expiration.js';
import { registerExpirationSettingsListener } from './expiration-settings.js';

type Listener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string
) => Promise<void>;
let listener: Listener;
beforeEach(() => {
  Object.assign(browser.storage, {
    onChanged: {
      addListener: vi.fn((callback: Listener) => {
        listener = callback;
      }),
      removeListener: vi.fn(),
    },
  });
  vi.mocked(browser.alarms.create).mockClear();
  vi.mocked(browser.alarms.clear).mockClear();
});

describe('expiration settings changes', () => {
  it('reschedules the live alarm from 1 to 5 minutes after options change', async () => {
    registerExpirationSettingsListener();
    await setOptions({ ...DEFAULT_OPTIONS, checkInterval: 1 });
    await setupAlarm();
    expect(browser.alarms.create).toHaveBeenLastCalledWith('checkExpirations', {
      periodInMinutes: 1,
    });
    await setOptions({ ...DEFAULT_OPTIONS, checkInterval: 5 });
    await listener(
      { extensionOptions: { oldValue: { checkInterval: 1 }, newValue: { checkInterval: 5 } } },
      'local'
    );
    expect(browser.alarms.create).toHaveBeenLastCalledWith('checkExpirations', {
      periodInMinutes: 5,
    });
  });
  it('serializes startup and overlapping changes, reading settings when each setup starts', async () => {
    registerExpirationSettingsListener();
    let releaseClear: (value: boolean) => void = () => {
      throw new Error('clear was not started');
    };
    const delayedClear = new Promise<boolean>((resolve) => {
      releaseClear = resolve;
    });
    vi.mocked(browser.alarms.clear).mockImplementationOnce(() => delayedClear);
    await setOptions({ ...DEFAULT_OPTIONS, checkInterval: 5 });
    const startup = setupAlarm();
    await vi.waitFor(() => expect(browser.alarms.clear).toHaveBeenCalledTimes(1));
    await setOptions({ ...DEFAULT_OPTIONS, checkInterval: 10 });
    const newer = listener(
      { extensionOptions: { oldValue: { checkInterval: 5 }, newValue: { checkInterval: 10 } } },
      'local'
    );
    await setOptions({ ...DEFAULT_OPTIONS, checkInterval: 7 });
    const latest = listener(
      { extensionOptions: { oldValue: { checkInterval: 10 }, newValue: { checkInterval: 7 } } },
      'local'
    );
    releaseClear(true);
    await Promise.all([startup, newer, latest]);
    expect(vi.mocked(browser.alarms.create).mock.calls).toEqual([
      ['checkExpirations', { periodInMinutes: 5 }],
      ['checkExpirations', { periodInMinutes: 7 }],
      ['checkExpirations', { periodInMinutes: 7 }],
    ]);
  });

  it('ignores unrelated, sync and normalized-equivalent changes', async () => {
    registerExpirationSettingsListener();
    await listener(
      { extensionOptions: { oldValue: { checkInterval: 1 }, newValue: { checkInterval: 5 } } },
      'sync'
    );
    await listener({ other: {} }, 'local');
    await listener(
      { extensionOptions: { oldValue: { checkInterval: 60 }, newValue: { checkInterval: 1440 } } },
      'local'
    );
    expect(browser.alarms.create).not.toHaveBeenCalled();
  });
});
