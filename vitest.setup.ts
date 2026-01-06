import { vi, beforeEach } from 'vitest';

// Shared mock storage that persists within each test
let syncStore: Record<string, unknown> = {};
let localStore: Record<string, unknown> = {};

// Create the mock chrome/browser API
const createBrowserMock = () => ({
  storage: {
    sync: {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve({ [key]: syncStore[key] })),
      set: vi.fn().mockImplementation((data: Record<string, unknown>) => {
        Object.assign(syncStore, data);
        return Promise.resolve();
      }),
    },
    local: {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve({ [key]: localStore[key] })),
      set: vi.fn().mockImplementation((data: Record<string, unknown>) => {
        Object.assign(localStore, data);
        return Promise.resolve();
      }),
    },
  },
  alarms: {
    create: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    onAlarm: {
      addListener: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
    onStartup: {
      addListener: vi.fn(),
    },
  },
  action: {
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  },
  notifications: {
    create: vi.fn().mockResolvedValue(undefined),
  },
});

const browserMock = createBrowserMock();

// Set up global chrome and browser
global.chrome = browserMock as any;
global.browser = browserMock as any;

// Reset stores before each test
beforeEach(() => {
  syncStore = {};
  localStore = {};
});

// Mock the webextension-polyfill module to use our mock
vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));
