import browser from '../platform/browser.js';
import { STORAGE_KEYS } from '../platform/storage/keys.js';
import { normalizeCheckInterval } from '../platform/check-interval.js';
import { createLogger } from '../platform/utils.js';
import { setupAlarm } from './expiration.js';

const log = createLogger('bg:expiration-settings');
function interval(value: unknown): number {
  return normalizeCheckInterval(
    typeof value === 'object' && value !== null && 'checkInterval' in value
      ? value.checkInterval
      : undefined
  );
}

export function registerExpirationSettingsListener(): void {
  browser.storage.onChanged?.addListener(async (changes, area) => {
    const change = changes[STORAGE_KEYS.OPTIONS];
    if (area !== 'local' || !change || interval(change.oldValue) === interval(change.newValue))
      return;
    try {
      await setupAlarm();
    } catch (error) {
      log.error('Failed to reschedule expiration checks:', error);
    }
  });
}
