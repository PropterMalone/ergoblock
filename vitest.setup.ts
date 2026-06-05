import { vi, beforeEach } from 'vitest';

// Shared mock storage that persists within each test
let syncStore: Record<string, unknown> = {};
let localStore: Record<string, unknown> = {};

// Mock IndexedDB for clearskyCache
const createMockRequest = (result: unknown = undefined) => {
  const request = {
    onsuccess: null as ((event: unknown) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    result,
    error: null,
  };
  // Auto-resolve success
  setTimeout(() => request.onsuccess?.({ target: request }), 0);
  return request;
};

const createMockObjectStore = () => ({
  put: vi.fn().mockImplementation(() => createMockRequest()),
  get: vi.fn().mockImplementation(() => createMockRequest(null)),
  delete: vi.fn().mockImplementation(() => createMockRequest()),
  clear: vi.fn().mockImplementation(() => createMockRequest()),
  getAll: vi.fn().mockImplementation(() => createMockRequest([])),
  createIndex: vi.fn(),
});

const createMockTransaction = () => ({
  objectStore: vi.fn().mockReturnValue(createMockObjectStore()),
  oncomplete: null as (() => void) | null,
  onerror: null as (() => void) | null,
});

const createMockDatabase = () => ({
  transaction: vi.fn().mockImplementation(() => {
    const tx = createMockTransaction();
    // Auto-complete the transaction
    setTimeout(() => tx.oncomplete?.(), 0);
    return tx;
  }),
  objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
  createObjectStore: vi.fn().mockReturnValue(createMockObjectStore()),
  close: vi.fn(),
});

const mockIndexedDB = {
  open: vi.fn().mockImplementation(() => {
    const request = {
      onsuccess: null as ((event: unknown) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      onupgradeneeded: null as ((event: unknown) => void) | null,
      result: createMockDatabase(),
      error: null,
    };
    // Simulate async success
    setTimeout(() => {
      request.onsuccess?.({ target: request });
    }, 0);
    return request;
  }),
  deleteDatabase: vi.fn().mockImplementation(() => {
    const request = {
      onsuccess: null as ((event: unknown) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      result: undefined,
    };
    setTimeout(() => request.onsuccess?.({ target: request }), 0);
    return request;
  }),
};

global.indexedDB = mockIndexedDB as unknown as IDBFactory;

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
