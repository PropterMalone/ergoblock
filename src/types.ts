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
  // Post context settings
  savePostContext: boolean;
  postContextRetentionDays: number; // 0 = never delete
}

export const DEFAULT_OPTIONS: ExtensionOptions = {
  defaultDuration: 86400000, // 24 hours
  quickBlockDuration: 3600000, // 1 hour
  notificationsEnabled: true,
  notificationSound: false,
  checkInterval: 1,
  showBadgeCount: true,
  theme: 'auto',
  // Post context defaults
  savePostContext: true,
  postContextRetentionDays: 90,
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
 * Profile view returned from Bluesky API (getBlocks, getMutes)
 */
export interface ProfileView {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
  indexedAt?: string;
}

/**
 * Response from app.bsky.graph.getBlocks
 */
export interface GetBlocksResponse {
  blocks: ProfileView[];
  cursor?: string;
}

/**
 * Response from app.bsky.graph.getMutes
 */
export interface GetMutesResponse {
  mutes: ProfileView[];
  cursor?: string;
}

/**
 * Permanent block/mute from Bluesky (not managed by ErgoBlock)
 */
export interface PermanentBlockMute {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  syncedAt: number;
}

/**
 * Combined block/mute entry for manager UI
 */
export interface ManagedEntry {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  source: 'ergoblock_temp' | 'ergoblock_permanent' | 'bluesky';
  type: 'block' | 'mute';
  expiresAt?: number;
  createdAt?: number;
  syncedAt?: number;
  rkey?: string;
}

/**
 * Sync state tracking
 */
export interface SyncState {
  lastBlockSync: number;
  lastMuteSync: number;
  syncInProgress: boolean;
  lastError?: string;
}

/**
 * Post context stored when blocking/muting from a post
 * Stores the AT Protocol URI so we can fetch the post later
 */
export interface PostContext {
  id: string;
  postUri: string; // AT Protocol URI (at://did/app.bsky.feed.post/rkey)
  postAuthorDid: string;
  postAuthorHandle?: string;
  postText?: string; // Cached text at time of action
  targetHandle: string; // Who was blocked/muted
  targetDid: string;
  actionType: 'block' | 'mute';
  permanent: boolean;
  timestamp: number;
}
