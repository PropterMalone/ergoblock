import { describe, it, expect } from 'vitest';
import { isWithinTimeBound } from '../domains/context-search.js';

describe('context-search', () => {
  describe('isWithinTimeBound', () => {
    const blockedAt = new Date('2026-01-15T00:00:00Z').getTime();

    it('returns true when no upper bound is provided', () => {
      expect(isWithinTimeBound('2026-03-01T00:00:00Z', undefined)).toBe(true);
      expect(isWithinTimeBound(undefined, undefined)).toBe(true);
    });

    it('keeps posts whose createdAt is missing (conservative)', () => {
      expect(isWithinTimeBound(undefined, blockedAt)).toBe(true);
    });

    it('keeps posts whose createdAt is unparseable (conservative)', () => {
      expect(isWithinTimeBound('not-a-date', blockedAt)).toBe(true);
      expect(isWithinTimeBound('', blockedAt)).toBe(true);
    });

    it('keeps posts strictly before the bound', () => {
      expect(isWithinTimeBound('2025-12-01T00:00:00Z', blockedAt)).toBe(true);
    });

    it('keeps posts exactly at the bound', () => {
      expect(isWithinTimeBound('2026-01-15T00:00:00Z', blockedAt)).toBe(true);
    });

    it('drops posts strictly after the bound', () => {
      expect(isWithinTimeBound('2026-02-01T00:00:00Z', blockedAt)).toBe(false);
      expect(isWithinTimeBound('2030-01-01T00:00:00Z', blockedAt)).toBe(false);
    });
  });
});
