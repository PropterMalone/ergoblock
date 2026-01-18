import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPTIONS,
  type ExtensionOptions,
  type HistoryEntry,
  type NotificationType,
} from '../types';

describe('types module', () => {
  describe('DEFAULT_OPTIONS', () => {
    it('should have correct default duration (24 hours)', () => {
      expect(DEFAULT_OPTIONS.defaultDuration).toBe(86400000);
      // Verify it's actually 24 hours
      expect(DEFAULT_OPTIONS.defaultDuration).toBe(24 * 60 * 60 * 1000);
    });

    it('should have correct quick block duration (1 hour)', () => {
      expect(DEFAULT_OPTIONS.quickBlockDuration).toBe(3600000);
      // Verify it's actually 1 hour
      expect(DEFAULT_OPTIONS.quickBlockDuration).toBe(60 * 60 * 1000);
    });

    it('should have notifications enabled by default', () => {
      expect(DEFAULT_OPTIONS.notificationsEnabled).toBe(true);
    });

    it('should have notification sound disabled by default', () => {
      expect(DEFAULT_OPTIONS.notificationSound).toBe(false);
    });

    it('should have check interval of 1 minute by default', () => {
      expect(DEFAULT_OPTIONS.checkInterval).toBe(1);
    });

    it('should have auto theme by default', () => {
      expect(DEFAULT_OPTIONS.theme).toBe('auto');
    });

    it('should have all required properties', () => {
      const requiredKeys: (keyof ExtensionOptions)[] = [
        'defaultDuration',
        'quickBlockDuration',
        'notificationsEnabled',
        'notificationSound',
        'checkInterval',
        'theme',
      ];

      for (const key of requiredKeys) {
        expect(DEFAULT_OPTIONS).toHaveProperty(key);
      }
    });

    it('should have valid theme value', () => {
      const validThemes = ['light', 'dark', 'auto'];
      expect(validThemes).toContain(DEFAULT_OPTIONS.theme);
    });

    it('should have positive duration values', () => {
      expect(DEFAULT_OPTIONS.defaultDuration).toBeGreaterThan(0);
      expect(DEFAULT_OPTIONS.quickBlockDuration).toBeGreaterThan(0);
    });

    it('should have reasonable check interval', () => {
      expect(DEFAULT_OPTIONS.checkInterval).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_OPTIONS.checkInterval).toBeLessThanOrEqual(10);
    });
  });

  describe('ExtensionOptions type', () => {
    it('should accept valid options object', () => {
      const options: ExtensionOptions = {
        defaultDuration: 3600000,
        quickBlockDuration: 1800000,
        notificationsEnabled: false,
        notificationSound: true,
        checkInterval: 5,
        theme: 'dark',
        savePostContext: true,
        postContextRetentionDays: 60,
        forgivenessPeriodDays: 90,
      };

      expect(options.defaultDuration).toBe(3600000);
      expect(options.theme).toBe('dark');
    });

    it('should accept light theme', () => {
      const options: ExtensionOptions = {
        ...DEFAULT_OPTIONS,
        theme: 'light',
      };
      expect(options.theme).toBe('light');
    });

    it('should accept dark theme', () => {
      const options: ExtensionOptions = {
        ...DEFAULT_OPTIONS,
        theme: 'dark',
      };
      expect(options.theme).toBe('dark');
    });

    it('should accept auto theme', () => {
      const options: ExtensionOptions = {
        ...DEFAULT_OPTIONS,
        theme: 'auto',
      };
      expect(options.theme).toBe('auto');
    });
  });

  describe('HistoryEntry type', () => {
    it('should accept valid blocked entry', () => {
      const entry: HistoryEntry = {
        did: 'did:plc:abc123',
        handle: 'user.bsky.social',
        action: 'blocked',
        timestamp: Date.now(),
        trigger: 'manual',
        success: true,
      };

      expect(entry.action).toBe('blocked');
      expect(entry.trigger).toBe('manual');
    });

    it('should accept valid unblocked entry', () => {
      const entry: HistoryEntry = {
        did: 'did:plc:abc123',
        handle: 'user.bsky.social',
        action: 'unblocked',
        timestamp: Date.now(),
        trigger: 'auto_expire',
        success: true,
        duration: 3600000,
      };

      expect(entry.action).toBe('unblocked');
      expect(entry.trigger).toBe('auto_expire');
      expect(entry.duration).toBe(3600000);
    });

    it('should accept valid muted entry', () => {
      const entry: HistoryEntry = {
        did: 'did:plc:abc123',
        handle: 'user.bsky.social',
        action: 'muted',
        timestamp: Date.now(),
        trigger: 'manual',
        success: true,
      };

      expect(entry.action).toBe('muted');
    });

    it('should accept valid unmuted entry', () => {
      const entry: HistoryEntry = {
        did: 'did:plc:abc123',
        handle: 'user.bsky.social',
        action: 'unmuted',
        timestamp: Date.now(),
        trigger: 'auto_expire',
        success: true,
      };

      expect(entry.action).toBe('unmuted');
    });

    it('should accept entry with optional id', () => {
      const entry: HistoryEntry = {
        id: 'custom-id-123',
        did: 'did:plc:abc123',
        handle: 'user.bsky.social',
        action: 'blocked',
        timestamp: Date.now(),
        trigger: 'manual',
        success: true,
      };

      expect(entry.id).toBe('custom-id-123');
    });

    it('should accept failed entry with error', () => {
      const entry: HistoryEntry = {
        did: 'did:plc:abc123',
        handle: 'user.bsky.social',
        action: 'unblocked',
        timestamp: Date.now(),
        trigger: 'auto_expire',
        success: false,
        error: 'API request failed',
      };

      expect(entry.success).toBe(false);
      expect(entry.error).toBe('API request failed');
    });

    it('should accept removed trigger', () => {
      const entry: HistoryEntry = {
        did: 'did:plc:abc123',
        handle: 'user.bsky.social',
        action: 'unblocked',
        timestamp: Date.now(),
        trigger: 'removed',
        success: true,
      };

      expect(entry.trigger).toBe('removed');
    });

    it('should have all action types available', () => {
      const actions: HistoryEntry['action'][] = ['blocked', 'unblocked', 'muted', 'unmuted'];

      for (const action of actions) {
        const entry: HistoryEntry = {
          did: 'did:plc:test',
          handle: 'test.bsky.social',
          action,
          timestamp: Date.now(),
          trigger: 'manual',
          success: true,
        };
        expect(entry.action).toBe(action);
      }
    });

    it('should have all trigger types available', () => {
      const triggers: HistoryEntry['trigger'][] = ['manual', 'auto_expire', 'removed'];

      for (const trigger of triggers) {
        const entry: HistoryEntry = {
          did: 'did:plc:test',
          handle: 'test.bsky.social',
          action: 'blocked',
          timestamp: Date.now(),
          trigger,
          success: true,
        };
        expect(entry.trigger).toBe(trigger);
      }
    });
  });

  describe('NotificationType type', () => {
    it('should accept all valid notification types', () => {
      const types: NotificationType[] = [
        'expired_success',
        'expired_failure',
        'rate_limited',
        'auth_error',
      ];

      for (const type of types) {
        const notificationType: NotificationType = type;
        expect(notificationType).toBe(type);
      }
    });
  });

  describe('Duration calculations', () => {
    it('should have correct millisecond values for common durations', () => {
      const oneHour = 60 * 60 * 1000;
      const sixHours = 6 * 60 * 60 * 1000;
      const twelveHours = 12 * 60 * 60 * 1000;
      const twentyFourHours = 24 * 60 * 60 * 1000;
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      const oneWeek = 7 * 24 * 60 * 60 * 1000;

      expect(oneHour).toBe(3600000);
      expect(sixHours).toBe(21600000);
      expect(twelveHours).toBe(43200000);
      expect(twentyFourHours).toBe(86400000);
      expect(threeDays).toBe(259200000);
      expect(oneWeek).toBe(604800000);

      // Verify DEFAULT_OPTIONS uses these values correctly
      expect(DEFAULT_OPTIONS.quickBlockDuration).toBe(oneHour);
      expect(DEFAULT_OPTIONS.defaultDuration).toBe(twentyFourHours);
    });
  });
});
