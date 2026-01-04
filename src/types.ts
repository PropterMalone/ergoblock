/**
 * Extension types and interfaces
 */

export interface ExtensionOptions {
  defaultDuration: number;
  quickBlockDuration: number;
  notificationsEnabled: boolean;
  notificationSound: boolean;
  checkInterval: number;
  showBadgeCount: boolean;
  theme: 'light' | 'dark' | 'auto';
}

export const DEFAULT_OPTIONS: ExtensionOptions = {
  defaultDuration: 86400000, // 24 hours
  quickBlockDuration: 3600000, // 1 hour
  notificationsEnabled: true,
  notificationSound: false,
  checkInterval: 1,
  showBadgeCount: true,
  theme: 'auto',
};

export interface HistoryEntry {
  id?: string;
  did: string;
  handle: string;
  action: 'blocked' | 'unblocked' | 'muted' | 'unmuted';
  timestamp: number;
  trigger: 'manual' | 'auto_expire' | 'removed';
  success: boolean;
  error?: string;
  duration?: number;
}

// Placeholder types for future features
export type RetryableOperation = object;
export type UsageStats = object;
export type ExportData = object;
export type ImportResult = object;

export type NotificationType =
  | 'expired_success'
  | 'expired_failure'
  | 'rate_limited'
  | 'auth_error';
