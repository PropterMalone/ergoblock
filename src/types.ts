/**
 * Extension types and interfaces
 */

export interface ExtensionOptions {
  defaultDuration: number;
  quickBlockDuration: number;
  notificationsEnabled: boolean;
  notificationSound: boolean;
  checkInterval: number;
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
  // Engagement context - when blocking from liked-by/reposted-by pages
  engagementType?: 'like' | 'repost'; // Why they were on your radar
  engagedPostUri?: string; // The post they liked/reposted
  // Notification context - when blocking from notifications page
  notificationType?: NotificationReason; // Type of notification that triggered the block
  notificationSubjectUri?: string; // The post/content that generated the notification
}

/**
 * An interaction between two users (reply, quote, or mention)
 * Used in the expanded context view to show all interactions
 */
export interface Interaction {
  uri: string;
  text: string;
  createdAt: number;
  type: 'reply' | 'quote' | 'mention';
  author: 'them' | 'you';
  authorHandle: string;
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
    facets?: Array<{
      index: { byteStart: number; byteEnd: number };
      features: Array<{
        $type: string;
        did?: string;
        uri?: string;
        tag?: string;
      }>;
    }>;
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
 * Post view from app.bsky.feed.searchPosts
 */
export interface SearchPostView {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  record: {
    $type: 'app.bsky.feed.post';
    text: string;
    createdAt: string;
    reply?: { parent: { uri: string }; root?: { uri: string } };
    embed?: { $type: string; record?: { uri: string } };
    facets?: Array<{
      index: { byteStart: number; byteEnd: number };
      features: Array<{ $type: string; did?: string }>;
    }>;
  };
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  indexedAt: string;
}

/**
 * Response from app.bsky.feed.searchPosts
 */
export interface SearchPostsResponse {
  posts: SearchPostView[];
  cursor?: string;
  hitsTotal?: number;
}

/**
 * Record of a user that has been reviewed by Amnesty feature
 * Tracks DIDs that have been presented so we don't show them again
 */
export interface AmnestyReview {
  did: string;
  handle: string;
  reviewedAt: number;
  type: 'block' | 'mute';
  decision: 'unblocked' | 'unmuted' | 'kept_blocked' | 'kept_muted';
}

// ============================================================================
// Blocklist Audit Types
// ============================================================================

/**
 * A blocklist (moderation list) the user subscribes to
 */
export interface SubscribedBlocklist {
  uri: string; // at://did/app.bsky.graph.list/rkey
  name: string;
  description?: string;
  avatar?: string;
  creator: {
    did: string;
    handle: string;
    displayName?: string;
  };
  listItemCount?: number;
  subscribedAt?: number; // When we first detected subscription
  syncedAt: number; // When we last synced members
}

/**
 * A follow relationship
 */
export interface FollowRelation {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  relationship: 'following' | 'follower' | 'mutual';
}

/**
 * A conflict between a follow and a blocklist
 */
export interface BlocklistConflict {
  user: FollowRelation;
  listUri: string;
  listName: string;
  listCreatorHandle: string;
}

/**
 * Grouped conflicts by blocklist
 */
export interface BlocklistConflictGroup {
  list: SubscribedBlocklist;
  conflicts: BlocklistConflict[];
  dismissed: boolean; // User has acknowledged these conflicts
}

/**
 * Blocklist audit sync state
 */
export interface BlocklistAuditState {
  lastSyncAt: number;
  syncInProgress: boolean;
  followCount: number;
  followerCount: number;
  blocklistCount: number;
  conflictCount: number;
  lastError?: string;
}

/**
 * Response from app.bsky.graph.getFollows
 */
export interface GetFollowsResponse {
  follows: ProfileView[];
  cursor?: string;
}

/**
 * Response from app.bsky.graph.getFollowers
 */
export interface GetFollowersResponse {
  followers: ProfileView[];
  cursor?: string;
}

/**
 * Response from app.bsky.graph.getLists (user's own lists)
 */
export interface GetListsResponse {
  lists: ListView[];
  cursor?: string;
}

/**
 * List view from API
 */
export interface ListView {
  uri: string;
  cid: string;
  name: string;
  purpose: 'app.bsky.graph.defs#modlist' | 'app.bsky.graph.defs#curatelist';
  description?: string;
  avatar?: string;
  listItemCount?: number;
  creator: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  indexedAt: string;
  viewer?: {
    muted?: boolean;
    blocked?: string;
  };
}

/**
 * Response from app.bsky.graph.getListBlocks (blocklists user subscribes to)
 */
export interface GetListBlocksResponse {
  lists: ListView[];
  cursor?: string;
}

/**
 * Response from app.bsky.graph.getListMutes (mutelists user subscribes to)
 */
export interface GetListMutesResponse {
  lists: ListView[];
  cursor?: string;
}

/**
 * Response from app.bsky.graph.getList (members of a list)
 */
export interface GetListResponse {
  list: ListView;
  items: ListItemView[];
  cursor?: string;
}

/**
 * List item (member) view
 */
export interface ListItemView {
  uri: string;
  subject: ProfileView;
}

// ============================================================================
// Starter Pack Tools Types
// ============================================================================

/**
 * Follow record from PDS with creation timestamp
 */
export interface FollowRecord {
  uri: string;
  cid: string;
  value: {
    $type: 'app.bsky.graph.follow';
    subject: string; // DID of followed user
    createdAt: string; // ISO timestamp
  };
}

/**
 * Response from listing follow records
 */
export interface ListFollowRecordsResponse {
  records: FollowRecord[];
  cursor?: string;
}

/**
 * Notification types from Bluesky
 */
export type NotificationReason = 'like' | 'repost' | 'follow' | 'mention' | 'reply' | 'quote';

/**
 * Notification from Bluesky
 */
export interface Notification {
  uri: string;
  cid: string;
  author: ProfileView;
  reason: NotificationReason;
  reasonSubject?: string; // URI of the subject (post that was liked, etc.)
  record: unknown;
  isRead: boolean;
  indexedAt: string;
}

/**
 * Response from listing notifications
 */
export interface ListNotificationsResponse {
  notifications: Notification[];
  cursor?: string;
  seenAt?: string;
}

/**
 * Like record for tracking user's likes
 */
export interface LikeRecord {
  uri: string;
  cid: string;
  value: {
    $type: 'app.bsky.feed.like';
    subject: {
      uri: string;
      cid: string;
    };
    createdAt: string;
  };
}

/**
 * Response from getting actor's likes
 */
export interface GetActorLikesResponse {
  feed: Array<{
    post: {
      uri: string;
      cid: string;
      author: ProfileView;
      record: {
        text: string;
        createdAt: string;
      };
      indexedAt: string;
    };
  }>;
  cursor?: string;
}

// ============================================================================
// Repost Filtering Types
// ============================================================================

/**
 * A user whose reposts should be filtered from your feed
 * Stores profile info for display in the management UI
 */
export interface RepostFilteredUser {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  addedAt: number; // Timestamp when added to filter list
}

// ============================================================================
// List Audit Types
// ============================================================================

/**
 * A list owned by the user (from app.bsky.graph.getLists)
 */
export interface OwnedList {
  uri: string;
  name: string;
  purpose: 'modlist' | 'curatelist';
  description?: string;
  avatar?: string;
  listItemCount: number;
  createdAt: number;
}

/**
 * A member of a list with timestamp info for auditing
 */
export interface ListMember {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  listUri: string;
  listName: string;
  addedAt: number; // When added to list (from CAR parsing)
  listitemRkey: string; // Record key for deletion
}

/**
 * Record of a list member that has been reviewed by List Audit feature
 */
export interface ListAuditReview {
  did: string;
  handle: string;
  listUri: string;
  listName: string;
  reviewedAt: number;
  decision: 'removed' | 'kept';
}

// ============================================================================
// Mass Operations Detection Types
// ============================================================================

/**
 * A single graph operation extracted from CAR file with timestamp
 */
export interface GraphOperation {
  type: 'block' | 'follow' | 'listitem';
  did: string; // Target DID (blocked/followed user, or list member)
  rkey: string; // Record key for deletion
  createdAt: number; // Unix timestamp (ms)
  listUri?: string; // Only for listitem operations
  listName?: string; // Human-readable list name
}

/**
 * A cluster of operations detected as a "mass operation"
 */
export interface MassOperationCluster {
  id: string; // Unique ID for this cluster
  type: 'block' | 'follow' | 'listitem';
  operations: GraphOperation[];
  startTime: number; // Earliest operation timestamp
  endTime: number; // Latest operation timestamp
  count: number; // Number of operations
}

/**
 * Result of a mass ops scan
 */
export interface MassOpsScanResult {
  clusters: MassOperationCluster[];
  scannedAt: number;
  operationCounts: {
    blocks: number;
    follows: number;
    listitems: number;
  };
}

/**
 * User settings for mass ops detection
 */
export interface MassOpsSettings {
  timeWindowMinutes: number; // Default: 5
  minOperationCount: number; // Default: 10
}

export const DEFAULT_MASS_OPS_SETTINGS: MassOpsSettings = {
  timeWindowMinutes: 5,
  minOperationCount: 10,
};
