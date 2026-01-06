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
  // Screenshot settings
  screenshotEnabled: boolean;
  screenshotQuality: number; // 0.1 to 1.0
  screenshotRetentionDays: number; // 0 = never delete
}

export const DEFAULT_OPTIONS: ExtensionOptions = {
  defaultDuration: 86400000, // 24 hours
  quickBlockDuration: 3600000, // 1 hour
  notificationsEnabled: true,
  notificationSound: false,
  checkInterval: 1,
  showBadgeCount: true,
  theme: 'auto',
  // Screenshot defaults
  screenshotEnabled: true,
  screenshotQuality: 0.7,
  screenshotRetentionDays: 30,
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
export type RetryableOperation = Record<string, unknown>;
export type UsageStats = Record<string, unknown>;
export type ExportData = Record<string, unknown>;
export type ImportResult = Record<string, unknown>;

export type NotificationType =
  | 'expired_success'
  | 'expired_failure'
  | 'rate_limited'
  | 'auth_error';

export interface BskySession {
  accessJwt: string;
  refreshJwt?: string;
  did: string;
  handle: string;
  pdsUrl: string;
  service?: string; // For compatibility
}

export interface BskyAccount {
  did: string;
  handle?: string;
  accessJwt?: string;
  refreshJwt?: string;
  service?: string;
  pdsUrl?: string;
}

export interface StorageStructure {
  session?: {
    currentAccount?: BskyAccount;
    accounts?: BskyAccount[];
  };
  currentAccount?: BskyAccount;
  accounts?: BskyAccount[];
  accessJwt?: string;
  did?: string;
  handle?: string;
  service?: string;
  pdsUrl?: string;
  authStatus?: 'valid' | 'invalid' | 'unknown';
}

export type AuthStatus = 'valid' | 'invalid' | 'unknown';

export interface ListRecordsResponse {
  records?: Array<{
    uri: string;
    value: { subject: string };
  }>;
}

export interface Profile {
  did: string;
  handle: string;
}

/**
 * Screenshot data stored when blocking/muting from a post
 */
export interface ScreenshotData {
  id: string;
  imageData: string; // Base64 encoded JPEG
  handle: string;
  did: string;
  actionType: 'block' | 'mute';
  permanent: boolean;
  timestamp: number;
  postText?: string; // Extracted text from the post
  postUrl?: string; // URL of the post if available
}
