export const MIN_CHECK_INTERVAL = 1;
export const MAX_CHECK_INTERVAL = 10;

export const CHECK_INTERVAL_OPTIONS = Array.from({ length: MAX_CHECK_INTERVAL }, (_, index) => {
  const value = index + MIN_CHECK_INTERVAL;
  return { value, label: `${value} ${value === 1 ? 'minute' : 'minutes'}` };
});

export function normalizeCheckInterval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MIN_CHECK_INTERVAL;
  return Math.max(MIN_CHECK_INTERVAL, Math.min(MAX_CHECK_INTERVAL, Math.round(value)));
}
