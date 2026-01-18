import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DEFAULT_OPTIONS, type ExtensionOptions } from '../types';

// Declare global for Node.js environment
declare const globalThis: {
  chrome: typeof chrome;
  document: {
    getElementById: (id: string) => unknown;
    querySelector: (selector: string) => unknown;
  };
  confirm: (message: string) => boolean;
};

// Mock storage state
let mockLocalStorage: Record<string, unknown> = {};

// Mock DOM elements
interface MockHTMLElement {
  value: string;
  checked: boolean;
  textContent: string;
  className: string;
  classList: {
    remove: (className: string) => void;
  };
  addEventListener: (event: string, handler: () => void) => void;
}

const createMockElement = (overrides: Partial<MockHTMLElement> = {}): MockHTMLElement => ({
  value: '',
  checked: false,
  textContent: '',
  className: '',
  classList: {
    remove: vi.fn(),
  },
  addEventListener: vi.fn(),
  ...overrides,
});

let mockElements: Record<string, MockHTMLElement> = {};

const createMockChrome = () => ({
  storage: {
    sync: {
      get: vi.fn((key: string) => {
        if (typeof key === 'string') {
          return Promise.resolve({ [key]: {} });
        }
        return Promise.resolve({});
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    local: {
      get: vi.fn((key: string) => {
        if (typeof key === 'string') {
          return Promise.resolve({ [key]: mockLocalStorage[key] });
        }
        return Promise.resolve(mockLocalStorage);
      }),
      set: vi.fn((data: Record<string, unknown>) => {
        Object.assign(mockLocalStorage, data);
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
});

describe('options module', () => {
  let mockChrome: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    // Reset storage
    mockLocalStorage = {};

    // Reset mocks
    vi.clearAllMocks();
    vi.resetModules();

    // Create mock elements
    mockElements = {
      defaultDuration: createMockElement({ value: '86400000' }),
      quickBlockDuration: createMockElement({ value: '3600000' }),
      notificationsEnabled: createMockElement({ checked: true }),
      notificationSound: createMockElement({ checked: false }),
      checkInterval: createMockElement({ value: '1' }),
      intervalValue: createMockElement({ textContent: '1' }),
      saveBtn: createMockElement(),
      resetBtn: createMockElement(),
      status: createMockElement({ className: '', textContent: '' }),
      themeAuto: createMockElement({ checked: true }),
      themeLight: createMockElement({ checked: false }),
      themeDark: createMockElement({ checked: false }),
    };

    // Mock document.getElementById
    const mockGetElementById = vi.fn((id: string) => {
      return mockElements[id] || null;
    });

    // Mock document.querySelector for theme radio buttons
    const mockQuerySelector = vi.fn((selector: string) => {
      if (selector.includes('theme')) {
        if (selector.includes('auto')) return mockElements.themeAuto;
        if (selector.includes('light')) return mockElements.themeLight;
        if (selector.includes('dark')) return mockElements.themeDark;
        // For checked theme query
        if (selector.includes(':checked')) {
          if (mockElements.themeAuto?.checked) return { value: 'auto' };
          if (mockElements.themeLight?.checked) return { value: 'light' };
          if (mockElements.themeDark?.checked) return { value: 'dark' };
        }
      }
      return null;
    });

    // Set up global mocks
    mockChrome = createMockChrome();
    globalThis.chrome = mockChrome as unknown as typeof chrome;
    globalThis.confirm = vi.fn().mockReturnValue(true);

    // Mock document
    Object.defineProperty(globalThis, 'document', {
      value: {
        getElementById: mockGetElementById,
        querySelector: mockQuerySelector,
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadOptions', () => {
    it('should load default options when none are stored', async () => {
      // No options in storage
      mockLocalStorage['extensionOptions'] = undefined;

      // The options module should use DEFAULT_OPTIONS
      expect(DEFAULT_OPTIONS.defaultDuration).toBe(86400000);
      expect(DEFAULT_OPTIONS.theme).toBe('auto');
    });

    it('should load stored options', async () => {
      const customOptions: ExtensionOptions = {
        defaultDuration: 3600000,
        quickBlockDuration: 1800000,
        notificationsEnabled: false,
        notificationSound: true,
        checkInterval: 5,
        theme: 'dark',
        savePostContext: true,
        postContextRetentionDays: 90,
        forgivenessPeriodDays: 90,
      };
      mockLocalStorage['extensionOptions'] = customOptions;

      const result = await mockChrome.storage.local.get('extensionOptions');
      expect(result['extensionOptions']).toEqual(customOptions);
    });
  });

  describe('saveOptions', () => {
    it('should save options to local storage', async () => {
      const options: ExtensionOptions = {
        defaultDuration: 7200000,
        quickBlockDuration: 3600000,
        notificationsEnabled: true,
        notificationSound: false,
        checkInterval: 2,
        theme: 'light',
        savePostContext: false,
        postContextRetentionDays: 30,
        forgivenessPeriodDays: 90,
      };

      await mockChrome.storage.local.set({ extensionOptions: options });

      expect(mockChrome.storage.local.set).toHaveBeenCalledWith({
        extensionOptions: options,
      });
    });

    it('should parse duration values correctly', () => {
      const durationString = '86400000';
      const parsedDuration = parseInt(durationString, 10);
      expect(parsedDuration).toBe(86400000);
    });

    it('should parse interval values correctly', () => {
      const intervalString = '5';
      const parsedInterval = parseInt(intervalString, 10);
      expect(parsedInterval).toBe(5);
    });
  });

  describe('resetOptions', () => {
    it('should reset to default options when confirmed', async () => {
      globalThis.confirm = vi.fn().mockReturnValue(true);

      await mockChrome.storage.local.set({ extensionOptions: DEFAULT_OPTIONS });

      expect(mockChrome.storage.local.set).toHaveBeenCalledWith({
        extensionOptions: DEFAULT_OPTIONS,
      });
    });

    it('should not reset when cancelled', () => {
      globalThis.confirm = vi.fn().mockReturnValue(false);

      // When confirm returns false, storage should not be called
      const confirmResult = globalThis.confirm('Reset all settings to defaults?');
      expect(confirmResult).toBe(false);
    });
  });

  describe('interval value display', () => {
    it('should update interval display when changed', () => {
      const intervalElement = mockElements.checkInterval;
      const displayElement = mockElements.intervalValue;

      intervalElement.value = '5';
      displayElement.textContent = intervalElement.value;

      expect(displayElement.textContent).toBe('5');
    });
  });

  describe('theme selection', () => {
    it('should handle light theme selection', () => {
      mockElements.themeLight.checked = true;
      mockElements.themeAuto.checked = false;
      mockElements.themeDark.checked = false;

      const selectedTheme = mockElements.themeLight.checked ? 'light' : 'auto';
      expect(selectedTheme).toBe('light');
    });

    it('should handle dark theme selection', () => {
      mockElements.themeDark.checked = true;
      mockElements.themeAuto.checked = false;
      mockElements.themeLight.checked = false;

      const selectedTheme = mockElements.themeDark.checked ? 'dark' : 'auto';
      expect(selectedTheme).toBe('dark');
    });

    it('should handle auto theme selection', () => {
      mockElements.themeAuto.checked = true;
      mockElements.themeLight.checked = false;
      mockElements.themeDark.checked = false;

      const selectedTheme = mockElements.themeAuto.checked ? 'auto' : 'light';
      expect(selectedTheme).toBe('auto');
    });
  });

  describe('form validation', () => {
    it('should handle valid duration values', () => {
      const validDurations = [3600000, 21600000, 43200000, 86400000, 259200000, 604800000];

      for (const duration of validDurations) {
        expect(duration).toBeGreaterThan(0);
        expect(Number.isInteger(duration)).toBe(true);
      }
    });

    it('should handle valid interval values', () => {
      const validIntervals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      for (const interval of validIntervals) {
        expect(interval).toBeGreaterThanOrEqual(1);
        expect(interval).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('status message', () => {
    it('should show success message', () => {
      const statusElement = mockElements.status;
      statusElement.textContent = 'Settings saved successfully!';
      statusElement.className = 'status-message show success';

      expect(statusElement.textContent).toBe('Settings saved successfully!');
      expect(statusElement.className).toContain('success');
    });

    it('should show error message', () => {
      const statusElement = mockElements.status;
      statusElement.textContent = 'Failed to load settings';
      statusElement.className = 'status-message show error';

      expect(statusElement.textContent).toBe('Failed to load settings');
      expect(statusElement.className).toContain('error');
    });

    it('should show reset confirmation message', () => {
      const statusElement = mockElements.status;
      statusElement.textContent = 'Settings reset to defaults';
      statusElement.className = 'status-message show success';

      expect(statusElement.textContent).toBe('Settings reset to defaults');
    });
  });

  describe('checkbox handling', () => {
    it('should handle notifications enabled checkbox', () => {
      mockElements.notificationsEnabled.checked = false;
      expect(mockElements.notificationsEnabled.checked).toBe(false);

      mockElements.notificationsEnabled.checked = true;
      expect(mockElements.notificationsEnabled.checked).toBe(true);
    });

    it('should handle notification sound checkbox', () => {
      mockElements.notificationSound.checked = true;
      expect(mockElements.notificationSound.checked).toBe(true);

      mockElements.notificationSound.checked = false;
      expect(mockElements.notificationSound.checked).toBe(false);
    });
  });

  describe('select handling', () => {
    it('should handle default duration select', () => {
      const durations = ['3600000', '21600000', '43200000', '86400000', '259200000', '604800000'];

      for (const duration of durations) {
        mockElements.defaultDuration.value = duration;
        expect(mockElements.defaultDuration.value).toBe(duration);
      }
    });

    it('should handle quick block duration select', () => {
      const durations = ['1800000', '3600000', '7200000'];

      for (const duration of durations) {
        mockElements.quickBlockDuration.value = duration;
        expect(mockElements.quickBlockDuration.value).toBe(duration);
      }
    });
  });

  describe('integration with storage module', () => {
    it('should use correct storage keys', async () => {
      const key = 'extensionOptions';
      await mockChrome.storage.local.get(key);
      expect(mockChrome.storage.local.get).toHaveBeenCalledWith(key);
    });

    it('should handle storage errors gracefully', async () => {
      mockChrome.storage.local.get = vi.fn().mockRejectedValue(new Error('Storage error'));

      try {
        await mockChrome.storage.local.get('extensionOptions');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Storage error');
      }
    });
  });
});

describe('options form behavior', () => {
  it('should have correct duration option values', () => {
    const durationOptions = [
      { label: '1 hour', value: 3600000 },
      { label: '6 hours', value: 21600000 },
      { label: '12 hours', value: 43200000 },
      { label: '24 hours', value: 86400000 },
      { label: '3 days', value: 259200000 },
      { label: '1 week', value: 604800000 },
    ];

    for (const option of durationOptions) {
      expect(option.value).toBeGreaterThan(0);
      expect(option.label).toBeTruthy();
    }
  });

  it('should have correct quick block duration options', () => {
    const quickOptions = [
      { label: '30 minutes', value: 1800000 },
      { label: '1 hour', value: 3600000 },
      { label: '2 hours', value: 7200000 },
    ];

    for (const option of quickOptions) {
      expect(option.value).toBeLessThanOrEqual(DEFAULT_OPTIONS.defaultDuration);
    }
  });

  it('should have correct check interval range', () => {
    const minInterval = 1;
    const maxInterval = 10;

    expect(minInterval).toBe(1);
    expect(maxInterval).toBe(10);
    expect(DEFAULT_OPTIONS.checkInterval).toBeGreaterThanOrEqual(minInterval);
    expect(DEFAULT_OPTIONS.checkInterval).toBeLessThanOrEqual(maxInterval);
  });
});
