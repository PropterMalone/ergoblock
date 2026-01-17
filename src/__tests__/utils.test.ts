import { describe, it, expect, vi } from 'vitest';
import { sleep, generateId } from '../utils.js';

describe('utils', () => {
  describe('sleep', () => {
    it('resolves after the specified delay', async () => {
      vi.useFakeTimers();
      const promise = sleep(100);

      // Should not resolve immediately
      vi.advanceTimersByTime(50);
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      // Flush pending promises
      await Promise.resolve();
      expect(resolved).toBe(false);

      // Advance to full time
      vi.advanceTimersByTime(50);
      await vi.runAllTimersAsync();

      expect(resolved).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('generateId', () => {
    it('generates an ID with the given prefix', () => {
      const id = generateId('test');
      expect(id).toMatch(/^test_\d+_[a-z0-9]+$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId('unique'));
      }
      expect(ids.size).toBe(100);
    });

    it('includes timestamp in ID', () => {
      const before = Date.now();
      const id = generateId('time');
      const after = Date.now();

      const parts = id.split('_');
      const timestamp = parseInt(parts[1], 10);

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('handles different prefixes correctly', () => {
      expect(generateId('ctx')).toMatch(/^ctx_/);
      expect(generateId('hist')).toMatch(/^hist_/);
      expect(generateId('manual')).toMatch(/^manual_/);
    });
  });
});
