/**
 * Centralized tooltip text definitions for consistent messaging across the UI.
 * These explain jargon and domain-specific terms to new users.
 */

/** Badge-related tooltips (also used in Phase 1) */
export const BADGE_TOOLTIPS = {
  temp: 'Temporary - will automatically expire at the scheduled time',
  permanent: 'Permanent - will not expire unless manually removed',
  expiring: 'Expiring soon - scheduled to be removed within 24 hours',
} as const;

/** Tab name tooltips (also used in Phase 1) */
export const TAB_TOOLTIPS = {
  actions: 'View and manage all your blocked and muted accounts',
  amnesty: 'Review old blocks to decide if they should be removed',
  blocklistAudit: 'Check for conflicts between your follows and blocklist subscriptions',
  repostFilters: "Manage accounts whose reposts you've hidden from your feed",
  massOps: 'Detect and undo patterns of rapid automated blocking',
  copyUser: "Import another user's blocks or follows to your account",
  settings: 'Configure ErgoBlock behavior and appearance',
} as const;

/** Column header tooltips */
export const COLUMN_TOOLTIPS = {
  context: 'The post or situation that triggered this block/mute',
  source: 'Where this block/mute came from - ErgoBlock (temporary) or native Bluesky (permanent)',
  status: 'Block relationship with this account (mutual block, they block you, etc.)',
  amnesty: 'Review status for possible block removal',
  expires: 'When this temporary block/mute will be automatically removed',
} as const;

/** Settings page tooltips */
export const SETTINGS_TOOLTIPS = {
  lastWord: 'Block after a delay so you can send a final reply first',
  lastWordDelay: 'How long to wait before the block takes effect',
  pds: 'Personal Data Server - where your Bluesky data is stored',
  car: 'Content Addressable Repository - a data export format',
  checkInterval: 'How often ErgoBlock checks for expired blocks/mutes',
  forgivenessPeriod: 'How long before a block becomes eligible for amnesty review',
  postContextRetention: 'How long to keep the context of what triggered each block/mute',
} as const;

/** Popup tooltips */
export const POPUP_TOOLTIPS = {
  expiring24h: 'Blocks and mutes that will expire in the next 24 hours',
  checkNow: 'Manually check for expired blocks/mutes and remove them',
  sync: 'Refresh data from your Bluesky account',
  openManager: 'Open the full ErgoBlock manager to view and manage all blocks/mutes',
} as const;

/** Duration picker tooltips */
export const DURATION_TOOLTIPS = {
  permanent: 'This block/mute will not expire unless you manually remove it',
  lastWordOption: 'Send a final reply before the block takes effect',
} as const;

/** General term tooltips */
export const TERM_TOOLTIPS = {
  blocklist: 'A shared list of blocked accounts you can subscribe to',
  massOps: 'Detect patterns of rapid automated blocking',
} as const;
