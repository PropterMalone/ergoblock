import { beforeEach, describe, expect, it, vi } from 'vitest';
import browser from './browser.js';
import { getTempBlocks, getTempMutes } from './storage.js';
import {
  emptyExpirationHealth,
  expirationCheckResponse,
  getExpirationHealthView,
} from './expiration-health.js';
vi.mock('./browser.js', () => ({ default: { storage: { local: { get: vi.fn() } } } }));
vi.mock('./storage.js', () => ({ getTempBlocks: vi.fn(), getTempMutes: vi.fn() }));
beforeEach(() => {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    expirationHealth: { status: 'success', overdueBlocks: 99 },
  });
  vi.mocked(getTempBlocks).mockResolvedValue({
    a: { handle: 'a', expiresAt: 1, createdAt: 0 },
    b: { handle: 'b', expiresAt: 10, createdAt: 0 },
  });
  vi.mocked(getTempMutes).mockResolvedValue({ a: { handle: 'a', expiresAt: 2, createdAt: 0 } });
});
describe('expiration health', () => {
  it('calculates overdue counts from current storage and the current time', async () => {
    expect(await getExpirationHealthView(10)).toMatchObject({ overdueBlocks: 1, overdueMutes: 1 });
    vi.mocked(getTempBlocks).mockResolvedValue({});
    expect(await getExpirationHealthView(11)).toMatchObject({ overdueBlocks: 0, overdueMutes: 1 });
  });
  it('preserves the boolean response and includes truthful structured outcomes', () => {
    const base = { ...emptyExpirationHealth(), healthSaved: true };
    expect(expirationCheckResponse({ ...base, status: 'needs_auth' }).success).toBe(false);
    expect(expirationCheckResponse({ ...base, status: 'partial' }).success).toBe(false);
    expect(expirationCheckResponse({ ...base, status: 'success' }).success).toBe(true);
    expect(
      expirationCheckResponse({ ...base, status: 'success', healthSaved: false })
    ).toMatchObject({
      success: false,
      outcome: { status: 'success' },
      error: expect.stringContaining('could not be saved'),
    });
  });
});
