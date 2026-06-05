/**
 * Typed message protocol for extension messaging.
 *
 * Single source of truth for all message types exchanged between
 * content scripts, popup, manager, and the background service worker.
 *
 * Usage:
 *   import { send } from './messages.js';
 *   const result = await send('UNBLOCK_USER', { did });
 *   // result is typed as { success: boolean; error?: string }
 */
import browser from './browser.js';
import type {
  AuthData,
  RelationshipUser,
  Interaction,
  PostView,
  ProfileWithViewer,
  MassOpsSettings,
  GraphOperation,
  OwnedList,
  ListMember,
  ExportData,
  ImportOptions,
  ImportResult,
} from '../types.js';
import type { DismissedCluster } from './storage.js';
import type { CarCacheStatusInfo } from '../ui/signals/manager.js';

// ============================================================================
// Message Registry — maps every message type to { request, response }
// ============================================================================

/**
 * Cluster identifier used for dismiss/restore operations.
 * Minimal subset of MassOperationCluster for serialization.
 */
export interface ClusterIdentifier {
  type: 'block' | 'follow' | 'listitem';
  startTime: number;
  endTime: number;
  count: number;
}

export interface MessageRegistry {
  // ── Alarm triggers (fire-and-forget, no meaningful response) ──────────
  TEMP_BLOCK_ADDED: {
    request: { did: string; expiresAt: number };
    response: void;
  };
  TEMP_MUTE_ADDED: {
    request: { did: string; expiresAt: number };
    response: void;
  };

  // ── Auth ──────────────────────────────────────────────────────────────
  SET_AUTH_TOKEN: {
    request: { auth: AuthData };
    response: { success: boolean };
  };
  GET_AUTH_STATUS: {
    request: Record<string, never>;
    response: { success: boolean; isAuthenticated?: boolean };
  };
  /** Background → content script: request fresh auth from Bluesky tab */
  REQUEST_AUTH: {
    request: Record<string, never>;
    response: { auth: AuthData | null };
  };

  // ── Expiration & sync ─────────────────────────────────────────────────
  CHECK_NOW: {
    request: Record<string, never>;
    response: { success: boolean };
  };
  SYNC_NOW: {
    request: Record<string, never>;
    response: { success: boolean; error?: string };
  };

  // ── Block/mute operations ─────────────────────────────────────────────
  CREATE_TEMP_ACTION: {
    request: {
      did: string;
      handle: string;
      durationMs: number;
      isMute: boolean;
      isPermanent: boolean;
    };
    response: { success: boolean; error?: string };
  };
  UNBLOCK_USER: {
    request: { did: string };
    response: { success: boolean; error?: string };
  };
  UNMUTE_USER: {
    request: { did: string };
    response: { success: boolean; error?: string };
  };
  TEMP_UNBLOCK_FOR_VIEW: {
    request: { did: string; handle?: string };
    response: { success: boolean; error?: string };
  };
  REBLOCK_USER: {
    request: { did: string; handle?: string };
    response: { success: boolean; error?: string };
  };

  // ── Context search ────────────────────────────────────────────────────
  FIND_CONTEXT: {
    request: { did: string; handle: string; beforeTimestamp?: number };
    response: { success: boolean; found?: boolean; error?: string };
  };
  FETCH_ALL_INTERACTIONS: {
    request: { did: string; handle: string; beforeTimestamp?: number };
    response: { success: boolean; interactions?: Interaction[]; error?: string };
  };
  FIND_INTERACTIONS_BEFORE: {
    request: { targetDid: string; beforeTimestamp: number };
    response: { success: boolean; interactions?: Interaction[]; error?: string };
  };

  // ── Last Word delayed block ───────────────────────────────────────────
  SCHEDULE_DELAYED_BLOCK: {
    request: {
      did: string;
      handle: string;
      blockDurationMs?: number;
      permanent?: boolean;
      delaySeconds: number;
      mutedFirst?: boolean;
    };
    response: { success: boolean; error?: string; delaySeconds?: number };
  };

  // ── Blocklist audit ───────────────────────────────────────────────────
  BLOCKLIST_AUDIT_SYNC: {
    request: Record<string, never>;
    response: { success: boolean; error?: string };
  };
  UNSUBSCRIBE_BLOCKLIST: {
    request: { listUri: string };
    response: { success: boolean; error?: string };
  };
  COPY_BLOCKLIST_AS_INDIVIDUAL_BLOCKS: {
    request: { listUri: string };
    response: { success: boolean; blocked?: number; skipped?: number; error?: string };
  };

  // ── List audit ────────────────────────────────────────────────────────
  FETCH_OWNED_LISTS: {
    request: Record<string, never>;
    response: { success: boolean; lists?: OwnedList[]; error?: string };
  };
  FETCH_LIST_MEMBERS_WITH_TIMESTAMPS: {
    request: { listUri: string };
    response: { success: boolean; members?: ListMember[]; error?: string };
  };
  REMOVE_FROM_LIST: {
    request: { rkey: string };
    response: { success: boolean; error?: string };
  };

  // ── Social connections (amnesty) ──────────────────────────────────────
  GET_FOLLOW_RELATIONSHIPS: {
    request: { did: string };
    response: {
      success: boolean;
      followsWhoFollowThem?: RelationshipUser[];
      followersWhoFollowThem?: RelationshipUser[];
      followsTheyBlock?: RelationshipUser[];
      error?: string;
    };
  };
  GET_FOLLOWS_WHO_FOLLOW_THEM: {
    request: { did: string };
    response: { success: boolean; users?: RelationshipUser[]; error?: string };
  };
  GET_FOLLOWERS_WHO_FOLLOW_THEM: {
    request: { did: string };
    response: { success: boolean; users?: RelationshipUser[]; error?: string };
  };
  GET_FOLLOWS_THEY_BLOCK: {
    request: { did: string };
    response: { success: boolean; users?: RelationshipUser[]; error?: string };
  };
  GET_FOLLOWS_WHO_BLOCK_THEM: {
    request: { did: string };
    response: {
      success: boolean;
      users?: RelationshipUser[];
      count?: number;
      totalBlockers?: number;
      cached?: boolean;
      error?: string;
    };
  };
  GET_FOLLOWS_WHO_BLOCK_THEM_CACHED: {
    request: { did: string };
    response: {
      success: boolean;
      users?: RelationshipUser[];
      count?: number;
      totalBlockers?: number;
      cached?: boolean;
      error?: string;
    };
  };

  // ── Clearsky cache ────────────────────────────────────────────────────
  PREWARM_CLEARSKY_CACHE: {
    request: { targetDids: string[] };
    response: { success: boolean; queued?: number; alreadyCached?: number };
  };
  PREFETCH_CLEARSKY_LOOKAHEAD: {
    request: { targetDids: string[] };
    response: { success: boolean; queued?: number; alreadyCached?: number };
  };
  CLEAR_CLEARSKY_CACHE: {
    request: Record<string, never>;
    response: { success: boolean; error?: string };
  };

  // ── Mass operations ───────────────────────────────────────────────────
  SCAN_MASS_OPS: {
    request: { settings: MassOpsSettings; forceRefresh?: boolean };
    response: { success: boolean; error?: string };
  };
  UNDO_MASS_OPERATIONS: {
    request: { operations: GraphOperation[] };
    response: { success: boolean; undone?: number; failed?: number; errors?: string[] };
  };
  GET_MASS_OPS_SETTINGS: {
    request: Record<string, never>;
    response: { success: boolean; settings?: MassOpsSettings };
  };
  SET_MASS_OPS_SETTINGS: {
    request: { settings: MassOpsSettings };
    response: { success: boolean };
  };
  DISMISS_MASS_OPS_CLUSTER: {
    request: { cluster: ClusterIdentifier };
    response: { success: boolean; error?: string };
  };
  GET_DISMISSED_MASS_OPS_CLUSTERS: {
    request: Record<string, never>;
    response: { success: boolean; dismissed?: DismissedCluster[]; error?: string };
  };
  RESTORE_MASS_OPS_CLUSTER: {
    request: { cluster: ClusterIdentifier };
    response: { success: boolean; error?: string };
  };

  // ── CAR cache ─────────────────────────────────────────────────────────
  CHECK_CAR_CACHE_STATUS: {
    request: Record<string, never>;
    response: { success: boolean; status?: CarCacheStatusInfo; error?: string };
  };
  ESTIMATE_CAR_SIZE: {
    request: Record<string, never>;
    response: { success: boolean; sizeBytes?: number; error?: string };
  };
  INVALIDATE_CAR_CACHE: {
    request: Record<string, never>;
    response: { success: boolean; error?: string };
  };

  // ── Profile fetching ──────────────────────────────────────────────────
  GET_PROFILES_BATCHED: {
    request: { dids: string[] };
    response: { success: boolean; profiles?: Record<string, ProfileWithViewer>; error?: string };
  };

  // ── Copy user ─────────────────────────────────────────────────────────
  FETCH_COPY_USER_DATA: {
    request: { handle: string };
    response: {
      success: boolean;
      error?: string;
      did?: string;
      profile?: ProfileWithViewer;
      follows?: string[];
      blocks?: string[];
    };
  };
  EXECUTE_COPY_USER_FOLLOWS: {
    request: { dids: string[] };
    response: {
      success: boolean;
      succeeded?: number;
      failed?: number;
      errors?: string[];
      skipped?: number;
    };
  };
  EXECUTE_COPY_USER_BLOCKS: {
    request: { dids: string[] };
    response: { success: boolean; succeeded?: number; failed?: number; errors?: string[] };
  };

  // ── PDS maintenance ───────────────────────────────────────────────────
  SCAN_DUPLICATE_FOLLOWS: {
    request: { deleteDuplicates?: boolean };
    response: {
      success: boolean;
      error?: string;
      totalRecords?: number;
      uniqueFollows?: number;
      duplicateDids?: number;
      duplicateRecords?: number;
      deleted?: number;
      deleteFailed?: number;
      duplicateDetails?: Array<{ did: string; count: number; uris: string[] }>;
    };
  };
  RECTIFY_AMNESTY_UNBLOCKS: {
    request: Record<string, never>;
    response: {
      success: boolean;
      checked?: number;
      fixed?: number;
      failed?: number;
      fixedHandles?: string[];
      error?: string;
    };
  };
  GET_PDS_RECORD_COUNTS: {
    request: Record<string, never>;
    response: {
      success: boolean;
      error?: string;
      collections?: Array<{ id: string; label: string; count: number }>;
    };
  };

  // ── Handle resolution ─────────────────────────────────────────────────
  RESOLVE_HANDLE: {
    request: { handle: string };
    response: {
      success: boolean;
      profile?: { did: string; handle: string; displayName?: string; avatar?: string };
      error?: string;
    };
  };

  // ── Debug ─────────────────────────────────────────────────────────────
  DEBUG_FIND_ORPHAN_BLOCKS: {
    request: Record<string, never>;
    response: { success: boolean; error?: string };
  };

  // ── QT Peek ───────────────────────────────────────────────────────────
  FETCH_POSTS_PUBLIC: {
    request: { uris: string[] };
    response: { success: boolean; posts?: PostView[]; error?: string };
  };

  // ── Import/Export ─────────────────────────────────────────────────────
  IMPORT_DATA: {
    request: { data: ExportData; options: ImportOptions };
    response: ImportResult;
  };

  // ── Review Queue ────────────────────────────────────────────────────
  ASSIGN_DURATION_TO_PERMANENT: {
    request: { did: string; actionType: 'block' | 'mute'; duration: number };
    response: { success: boolean; error?: string };
  };
  MARK_PERMANENT_REVIEWED: {
    request: { did: string; actionType: 'block' | 'mute' };
    response: { success: boolean; error?: string };
  };
  DISMISS_REVIEW: {
    request: { did: string; actionType: 'block' | 'mute' };
    response: { success: boolean; error?: string };
  };
  BACKFILL_REVIEW_QUEUE: {
    request: Record<string, never>;
    response: { success: boolean; flaggedBlocks: number; flaggedMutes: number; error?: string };
  };
}

// ============================================================================
// Utility types derived from the registry
// ============================================================================

/** All valid message type strings */
export type MessageType = keyof MessageRegistry;

/** Extract request payload for a given message type */
export type MessageRequest<T extends MessageType> = MessageRegistry[T]['request'];

/** Extract response type for a given message type */
export type MessageResponse<T extends MessageType> = MessageRegistry[T]['response'];

// ============================================================================
// Typed send() — replaces browser.runtime.sendMessage with autocomplete
// ============================================================================

/**
 * Send a typed message to the background service worker.
 *
 * - Messages with empty request (`Record<string, never>`) need no payload:
 *     `await send('CHECK_NOW')`
 * - Messages with data require a typed payload:
 *     `await send('UNBLOCK_USER', { did })`
 *
 * The return type is automatically inferred from the registry.
 */
export async function send<T extends MessageType>(
  type: T,
  ...args: Record<string, never> extends MessageRequest<T>
    ? [data?: MessageRequest<T>]
    : [data: MessageRequest<T>]
): Promise<MessageResponse<T>> {
  const data = args[0] ?? {};
  const response = await browser.runtime.sendMessage({ type, ...data });
  return response as MessageResponse<T>;
}

/**
 * Send a typed message to a specific tab (background → content script).
 * Used by the background service worker to communicate with content scripts.
 */
export async function sendToTab<T extends MessageType>(
  tabId: number,
  type: T,
  ...args: Record<string, never> extends MessageRequest<T>
    ? [data?: MessageRequest<T>]
    : [data: MessageRequest<T>]
): Promise<MessageResponse<T>> {
  const data = args[0] ?? {};
  const response = await browser.tabs.sendMessage(tabId, { type, ...data });
  return response as MessageResponse<T>;
}

// ============================================================================
// Handler utilities (for Step 4 — background.ts migration)
// ============================================================================

/** Handler function type for a single message type */
export type MessageHandler<T extends MessageType> = (
  data: MessageRequest<T>
) => Promise<MessageResponse<T>> | MessageResponse<T>;

/** A map of message types to their handler functions */
export type HandlerMap = {
  [T in MessageType]?: MessageHandler<T>;
};

/**
 * Identity function that provides type inference for handler maps.
 * Use in Step 4 when migrating background.ts handlers:
 *
 * ```ts
 * const handlers = createHandlerMap({
 *   UNBLOCK_USER: async ({ did }) => handleUnblockRequest(did),
 *   CHECK_NOW: async () => { await checkExpirations(); return { success: true }; },
 * });
 * ```
 */
export function createHandlerMap<T extends Partial<HandlerMap>>(map: T): T {
  return map;
}

/**
 * Dispatch a raw incoming message to the appropriate typed handler.
 * Returns undefined if no handler is registered for the message type.
 */
export async function dispatchMessage(
  handlers: Partial<HandlerMap>,
  rawMessage: unknown
): Promise<unknown> {
  if (typeof rawMessage !== 'object' || rawMessage === null) return undefined;
  const { type, ...data } = rawMessage as { type: string } & Record<string, unknown>;
  const handler = handlers[type as MessageType];
  if (!handler) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (handler as (data: any) => Promise<unknown>)(data);
}
