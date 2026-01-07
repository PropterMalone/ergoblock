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
  // Amnesty settings
  forgivenessPeriodDays: number; // How old a block must be to be eligible for amnesty
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
  // Amnesty defaults
  forgivenessPeriodDays: 90, // 3 months
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
 * Viewer state from profile - relationship between logged-in user and the profile
 */
export interface ProfileViewerState {
  muted?: boolean;
  blockedBy?: boolean;
  blocking?: string; // URI of the block record if blocking
  following?: string; // URI of the follow record if following
  followedBy?: string; // URI of follow record if they follow us
}

/**
 * Extended profile with viewer state
 */
export interface ProfileWithViewer extends Profile {
  displayName?: string;
  avatar?: string;
  viewer?: ProfileViewerState;
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
  createdAt?: number; // Actual block creation time (from record)
  syncedAt: number; // When we synced this entry
  rkey?: string; // Record key for direct deletion
  mutualBlock?: boolean; // True if user has also blocked us back
  // Relationship state (from getProfiles viewer)
  viewer?: ProfileViewerState;
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
  mutualBlock?: boolean; // True if user has also blocked us back
  // Relationship indicators (fetched on demand)
  viewer?: ProfileViewerState;
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
  postCreatedAt?: number; // When the post was created (ms timestamp)
  targetHandle: string; // Who was blocked/muted
  targetDid: string;
  actionType: 'block' | 'mute';
  permanent: boolean;
  timestamp: number; // When the block/mute action occurred
  guessed?: boolean; // True if auto-detected from interactions, not captured during block
}

/**
 * Block record from com.atproto.repo.listRecords
 */
export interface BlockRecord {
  uri: string;
  cid: string;
  value: {
    $type: 'app.bsky.graph.block';
    subject: string; // DID of blocked user
    createdAt: string; // ISO timestamp
  };
}

/**
 * Response from com.atproto.repo.listRecords for blocks
 */
export interface ListBlockRecordsResponse {
  records: BlockRecord[];
  cursor?: string;
}

/**
 * Feed post from app.bsky.feed.getAuthorFeed
 */
export interface FeedPost {
  uri: string;
  cid: string;
  author: { did: string; handle: string };
  record: {
    text: string;
    createdAt: string;
    reply?: { parent: { uri: string }; root?: { uri: string } };
    embed?: { $type: string; record?: { uri: string } };
  };
}

/**
 * Response from app.bsky.feed.getAuthorFeed
 */
export interface GetAuthorFeedResponse {
  feed: Array<{ post: FeedPost }>;
  cursor?: string;
}

/**
 * DID document from PLC directory
 */
export interface DidDocument {
  id: string;
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

/**
 * Raw post record from com.atproto.repo.listRecords
 */
export interface RawPostRecord {
  uri: string;
  cid: string;
  value: {
    $type: 'app.bsky.feed.post';
    text: string;
    createdAt: string;
    reply?: { parent: { uri: string }; root?: { uri: string } };
    embed?: { $type: string; record?: { uri: string } };
  };
}

/**
 * Response from com.atproto.repo.listRecords for posts
 */
export interface ListPostRecordsResponse {
  records: RawPostRecord[];
  cursor?: string;
}

/**
 * Record of a user that has been reviewed by Amnesty feature
 * Tracks DIDs that have been presented so we don't show them again
 */
export interface AmnestyReview {
  did: string;
  handle: string;
  reviewedAt: number;
  decision: 'unblocked' | 'kept_blocked';
}
