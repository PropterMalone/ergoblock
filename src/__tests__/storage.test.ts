import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getTempBlocks,
  addTempBlock,
  removeTempBlock,
  getTempMutes,
  addTempMute,
  removeTempMute,
  getOptions,
  setOptions,
  getActionHistory,
  addHistoryEntry,
  removeAllExpiredBlocks,
  removeAllExpiredMutes,
  getPermanentBlocks,
  setPermanentBlocks,
  getPermanentMutes,
  setPermanentMutes,
  getSyncState,
  setSyncState,
  updateSyncState,
  getAllManagedBlocks,
  getAllManagedMutes,
  getPostContexts,
  addPostContext,
  deletePostContext,
  cleanupExpiredPostContexts,
  getRepostFilteredUsers,
  addRepostFilteredUser,
  removeRepostFilteredUser,
  isRepostFiltered,
  isHandleRepostFiltered,
  getRepostFilteredUsersArray,
  STORAGE_KEYS,
} from '../storage.js';
import { DEFAULT_OPTIONS, HistoryEntry, PostContext, RepostFilteredUser } from '../types.js';
import browser from '../browser.js';

// Get the mocked browser for assertions
const mockedBrowser = vi.mocked(browser);

describe('Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Temp Blocks', () => {
    it('should add and get a temp block', async () => {
      await addTempBlock('did:test:123', 'test.bsky.social', 3600000);

      const blocks = await getTempBlocks();
      expect(blocks['did:test:123']).toBeDefined();
      expect(blocks['did:test:123'].handle).toBe('test.bsky.social');
      expect(mockedBrowser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEMP_BLOCK_ADDED',
          did: 'did:test:123',
        })
      );
    });

    it('should remove a temp block', async () => {
      await addTempBlock('did:test:123', 'test.bsky.social');
      await removeTempBlock('did:test:123');

      const blocks = await getTempBlocks();
      expect(blocks['did:test:123']).toBeUndefined();
    });
  });

  describe('Temp Mutes', () => {
    it('should add and get a temp mute', async () => {
      await addTempMute('did:test:456', 'mute.bsky.social', 3600000);

      const mutes = await getTempMutes();
      expect(mutes['did:test:456']).toBeDefined();
      expect(mutes['did:test:456'].handle).toBe('mute.bsky.social');
      expect(mockedBrowser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEMP_MUTE_ADDED',
          did: 'did:test:456',
        })
      );
    });

    it('should remove a temp mute', async () => {
      await addTempMute('did:test:456', 'mute.bsky.social');
      await removeTempMute('did:test:456');

      const mutes = await getTempMutes();
      expect(mutes['did:test:456']).toBeUndefined();
    });
  });

  describe('Options', () => {
    it('should get default options when none are set', async () => {
      const options = await getOptions();
      expect(options).toEqual(DEFAULT_OPTIONS);
    });

    it('should set and get custom options', async () => {
      const customOptions = { ...DEFAULT_OPTIONS, theme: 'dark' as const };
      await setOptions(customOptions);

      const options = await getOptions();
      expect(options.theme).toBe('dark');
    });
  });

  describe('History', () => {
    it('should add and get history entries', async () => {
      const entry: HistoryEntry = {
        did: 'did:test:789',
        handle: 'history.bsky.social',
        action: 'blocked',
        timestamp: Date.now(),
        trigger: 'manual',
        success: true,
      };

      await addHistoryEntry(entry);

      const history = await getActionHistory();
      expect(history.length).toBe(1);
      expect(history[0].handle).toBe('history.bsky.social');
    });

    it('should limit history entries to HISTORY_MAX_ENTRIES (100)', async () => {
      for (let i = 0; i < 110; i++) {
        await addHistoryEntry({
          did: `did:test:${i}`,
          handle: `user${i}.bsky.social`,
          action: 'blocked',
          timestamp: Date.now(),
          trigger: 'manual',
          success: true,
        });
      }

      const history = await getActionHistory();
      expect(history.length).toBe(100);
      expect(history[0].handle).toBe('user109.bsky.social');
    });
  });

  describe('Cleanup', () => {
    it('should remove expired blocks', async () => {
      const now = Date.now();
      const blocks = {
        'did:expired': { handle: 'old', expiresAt: now - 1000, createdAt: now - 2000 },
        'did:active': { handle: 'new', expiresAt: now + 1000, createdAt: now },
      };
      await mockedBrowser.storage.sync.set({ tempBlocks: blocks });

      await removeAllExpiredBlocks();

      const updated = await getTempBlocks();
      expect(updated['did:expired']).toBeUndefined();
      expect(updated['did:active']).toBeDefined();
    });

    it('should remove expired mutes', async () => {
      const now = Date.now();
      const mutes = {
        'did:expired': { handle: 'old', expiresAt: now - 1000, createdAt: now - 2000 },
        'did:active': { handle: 'new', expiresAt: now + 1000, createdAt: now },
      };
      await mockedBrowser.storage.sync.set({ tempMutes: mutes });

      await removeAllExpiredMutes();

      const updated = await getTempMutes();
      expect(updated['did:expired']).toBeUndefined();
      expect(updated['did:active']).toBeDefined();
    });
  });

  describe('Permanent Blocks', () => {
    it('should get empty permanent blocks by default', async () => {
      const blocks = await getPermanentBlocks();
      expect(blocks).toEqual({});
    });

    it('should set and get permanent blocks', async () => {
      const now = Date.now();
      const blocks = {
        'did:perm:123': {
          did: 'did:perm:123',
          handle: 'perm.bsky.social',
          displayName: 'Permanent User',
          syncedAt: now,
        },
      };
      await setPermanentBlocks(blocks);

      const retrieved = await getPermanentBlocks();
      expect(retrieved['did:perm:123']).toBeDefined();
      expect(retrieved['did:perm:123'].handle).toBe('perm.bsky.social');
    });
  });

  describe('Permanent Mutes', () => {
    it('should get empty permanent mutes by default', async () => {
      const mutes = await getPermanentMutes();
      expect(mutes).toEqual({});
    });

    it('should set and get permanent mutes', async () => {
      const now = Date.now();
      const mutes = {
        'did:perm:456': {
          did: 'did:perm:456',
          handle: 'muted.bsky.social',
          syncedAt: now,
        },
      };
      await setPermanentMutes(mutes);

      const retrieved = await getPermanentMutes();
      expect(retrieved['did:perm:456']).toBeDefined();
      expect(retrieved['did:perm:456'].handle).toBe('muted.bsky.social');
    });
  });

  describe('Sync State', () => {
    it('should get default sync state', async () => {
      const state = await getSyncState();
      expect(state.lastBlockSync).toBe(0);
      expect(state.lastMuteSync).toBe(0);
      expect(state.syncInProgress).toBe(false);
    });

    it('should set and get sync state', async () => {
      const now = Date.now();
      await setSyncState({
        lastBlockSync: now,
        lastMuteSync: now - 1000,
        syncInProgress: true,
      });

      const state = await getSyncState();
      expect(state.lastBlockSync).toBe(now);
      expect(state.lastMuteSync).toBe(now - 1000);
      expect(state.syncInProgress).toBe(true);
    });

    it('should update sync state partially', async () => {
      const now = Date.now();
      await setSyncState({
        lastBlockSync: now,
        lastMuteSync: 0,
        syncInProgress: false,
      });

      await updateSyncState({ lastMuteSync: now + 1000 });

      const state = await getSyncState();
      expect(state.lastBlockSync).toBe(now);
      expect(state.lastMuteSync).toBe(now + 1000);
    });
  });

  describe('Managed Entries', () => {
    it('should get all managed blocks combining temp and permanent', async () => {
      const now = Date.now();

      // Set up temp blocks
      await addTempBlock('did:temp:1', 'temp.bsky.social', 3600000);

      // Set up permanent blocks
      await setPermanentBlocks({
        'did:perm:1': {
          did: 'did:perm:1',
          handle: 'perm.bsky.social',
          syncedAt: now,
        },
      });

      const managed = await getAllManagedBlocks();
      expect(managed.length).toBe(2);

      const temp = managed.find((m) => m.did === 'did:temp:1');
      expect(temp?.source).toBe('ergoblock_temp');
      expect(temp?.type).toBe('block');

      const perm = managed.find((m) => m.did === 'did:perm:1');
      expect(perm?.source).toBe('bluesky');
    });

    it('should not duplicate temp blocks in permanent list', async () => {
      const now = Date.now();

      // Same DID in both temp and permanent
      await addTempBlock('did:both:1', 'both.bsky.social', 3600000);
      await setPermanentBlocks({
        'did:both:1': {
          did: 'did:both:1',
          handle: 'both.bsky.social',
          syncedAt: now,
        },
      });

      const managed = await getAllManagedBlocks();
      // Should only appear once (as temp, since temp takes precedence)
      const matching = managed.filter((m) => m.did === 'did:both:1');
      expect(matching.length).toBe(1);
      expect(matching[0].source).toBe('ergoblock_temp');
    });

    it('should get all managed mutes combining temp and permanent', async () => {
      const now = Date.now();

      await addTempMute('did:temp:m1', 'tempmute.bsky.social', 3600000);
      await setPermanentMutes({
        'did:perm:m1': {
          did: 'did:perm:m1',
          handle: 'permmute.bsky.social',
          syncedAt: now,
        },
      });

      const managed = await getAllManagedMutes();
      expect(managed.length).toBe(2);

      const temp = managed.find((m) => m.did === 'did:temp:m1');
      expect(temp?.source).toBe('ergoblock_temp');
      expect(temp?.type).toBe('mute');
    });

    it('should sort managed entries by date (newest first)', async () => {
      const now = Date.now();

      await addTempBlock('did:newer', 'newer.bsky.social', 3600000);
      await setPermanentBlocks({
        'did:older': {
          did: 'did:older',
          handle: 'older.bsky.social',
          syncedAt: now - 10000,
        },
      });

      const managed = await getAllManagedBlocks();
      expect(managed[0].did).toBe('did:newer');
      expect(managed[1].did).toBe('did:older');
    });
  });

  describe('Post Contexts', () => {
    it('should get empty post contexts by default', async () => {
      const contexts = await getPostContexts();
      expect(contexts).toEqual([]);
    });

    it('should add and get post context', async () => {
      const context: PostContext = {
        id: 'ctx-1',
        postUri: 'at://did:post:123/app.bsky.feed.post/abc123',
        postAuthorDid: 'did:post:123',
        postAuthorHandle: 'poster.bsky.social',
        postText: 'Test post content',
        targetHandle: 'blocked.bsky.social',
        targetDid: 'did:blocked:456',
        actionType: 'block',
        permanent: false,
        timestamp: Date.now(),
      };

      await addPostContext(context);

      const contexts = await getPostContexts();
      expect(contexts.length).toBe(1);
      expect(contexts[0].id).toBe('ctx-1');
      expect(contexts[0].postText).toBe('Test post content');
    });

    it('should delete post context by ID', async () => {
      const context1: PostContext = {
        id: 'ctx-to-delete',
        postUri: 'at://test/app.bsky.feed.post/1',
        postAuthorDid: 'did:test',
        targetHandle: 'target1',
        targetDid: 'did:target1',
        actionType: 'block',
        permanent: false,
        timestamp: Date.now(),
      };
      const context2: PostContext = {
        id: 'ctx-to-keep',
        postUri: 'at://test/app.bsky.feed.post/2',
        postAuthorDid: 'did:test',
        targetHandle: 'target2',
        targetDid: 'did:target2',
        actionType: 'mute',
        permanent: true,
        timestamp: Date.now(),
      };

      await addPostContext(context1);
      await addPostContext(context2);
      await deletePostContext('ctx-to-delete');

      const contexts = await getPostContexts();
      expect(contexts.length).toBe(1);
      expect(contexts[0].id).toBe('ctx-to-keep');
    });

    it('should limit post contexts to MAX_POST_CONTEXTS (500)', async () => {
      for (let i = 0; i < 510; i++) {
        await addPostContext({
          id: `ctx-${i}`,
          postUri: `at://test/app.bsky.feed.post/${i}`,
          postAuthorDid: 'did:test',
          targetHandle: `target${i}`,
          targetDid: `did:target:${i}`,
          actionType: 'block',
          permanent: false,
          timestamp: Date.now() + i,
        });
      }

      const contexts = await getPostContexts();
      expect(contexts.length).toBe(500);
      // Newest should be first
      expect(contexts[0].id).toBe('ctx-509');
    });

    it('should cleanup expired post contexts based on retention policy', async () => {
      const now = Date.now();
      const thirtyDaysAgo = now - 31 * 24 * 60 * 60 * 1000;

      // Add an old context
      await addPostContext({
        id: 'ctx-old',
        postUri: 'at://test/app.bsky.feed.post/old',
        postAuthorDid: 'did:test',
        targetHandle: 'old-target',
        targetDid: 'did:old',
        actionType: 'block',
        permanent: false,
        timestamp: thirtyDaysAgo,
      });

      // Add a recent context
      await addPostContext({
        id: 'ctx-recent',
        postUri: 'at://test/app.bsky.feed.post/recent',
        postAuthorDid: 'did:test',
        targetHandle: 'recent-target',
        targetDid: 'did:recent',
        actionType: 'mute',
        permanent: false,
        timestamp: now,
      });

      // Set retention to 30 days
      await setOptions({ ...DEFAULT_OPTIONS, postContextRetentionDays: 30 });

      await cleanupExpiredPostContexts();

      const contexts = await getPostContexts();
      expect(contexts.length).toBe(1);
      expect(contexts[0].id).toBe('ctx-recent');
    });

    it('should not cleanup contexts when retention is 0 (never delete)', async () => {
      const oldTimestamp = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago

      await addPostContext({
        id: 'ctx-very-old',
        postUri: 'at://test/app.bsky.feed.post/veryold',
        postAuthorDid: 'did:test',
        targetHandle: 'ancient-target',
        targetDid: 'did:ancient',
        actionType: 'block',
        permanent: true,
        timestamp: oldTimestamp,
      });

      // Set retention to 0 (never delete)
      await setOptions({ ...DEFAULT_OPTIONS, postContextRetentionDays: 0 });

      await cleanupExpiredPostContexts();

      const contexts = await getPostContexts();
      expect(contexts.length).toBe(1);
    });
  });

  describe('Repost Filters', () => {
    it('should get empty repost filters by default', async () => {
      const users = await getRepostFilteredUsers();
      expect(users).toEqual({});
    });

    it('should add a repost filtered user', async () => {
      const user: RepostFilteredUser = {
        did: 'did:plc:repost1',
        handle: 'repost.bsky.social',
        displayName: 'Repost User',
        avatar: 'https://example.com/avatar.jpg',
        addedAt: Date.now(),
      };

      await addRepostFilteredUser(user);

      const users = await getRepostFilteredUsers();
      expect(users['did:plc:repost1']).toBeDefined();
      expect(users['did:plc:repost1'].handle).toBe('repost.bsky.social');
      expect(users['did:plc:repost1'].displayName).toBe('Repost User');
    });

    it('should remove a repost filtered user', async () => {
      const user: RepostFilteredUser = {
        did: 'did:plc:toremove',
        handle: 'remove.bsky.social',
        addedAt: Date.now(),
      };

      await addRepostFilteredUser(user);
      await removeRepostFilteredUser('did:plc:toremove');

      const users = await getRepostFilteredUsers();
      expect(users['did:plc:toremove']).toBeUndefined();
    });

    it('should check if a user is repost filtered by DID', async () => {
      const user: RepostFilteredUser = {
        did: 'did:plc:filtered',
        handle: 'filtered.bsky.social',
        addedAt: Date.now(),
      };

      await addRepostFilteredUser(user);

      expect(await isRepostFiltered('did:plc:filtered')).toBe(true);
      expect(await isRepostFiltered('did:plc:notfiltered')).toBe(false);
    });

    it('should check if a user is repost filtered by handle (case insensitive)', async () => {
      const user: RepostFilteredUser = {
        did: 'did:plc:handletest',
        handle: 'TestHandle.bsky.social',
        addedAt: Date.now(),
      };

      await addRepostFilteredUser(user);

      expect(await isHandleRepostFiltered('testhandle.bsky.social')).toBe(true);
      expect(await isHandleRepostFiltered('TESTHANDLE.BSKY.SOCIAL')).toBe(true);
      expect(await isHandleRepostFiltered('other.bsky.social')).toBe(false);
    });

    it('should get repost filtered users as sorted array', async () => {
      const now = Date.now();

      await addRepostFilteredUser({
        did: 'did:plc:older',
        handle: 'older.bsky.social',
        addedAt: now - 1000,
      });

      await addRepostFilteredUser({
        did: 'did:plc:newer',
        handle: 'newer.bsky.social',
        addedAt: now,
      });

      const users = await getRepostFilteredUsersArray();
      expect(users.length).toBe(2);
      // Newest first
      expect(users[0].did).toBe('did:plc:newer');
      expect(users[1].did).toBe('did:plc:older');
    });

    it('should update an existing filtered user', async () => {
      await addRepostFilteredUser({
        did: 'did:plc:update',
        handle: 'old.bsky.social',
        addedAt: Date.now() - 1000,
      });

      await addRepostFilteredUser({
        did: 'did:plc:update',
        handle: 'new.bsky.social',
        displayName: 'Updated Name',
        addedAt: Date.now(),
      });

      const users = await getRepostFilteredUsers();
      expect(users['did:plc:update'].handle).toBe('new.bsky.social');
      expect(users['did:plc:update'].displayName).toBe('Updated Name');
    });
  });

  describe('Storage Keys', () => {
    it('should export all required storage keys', () => {
      expect(STORAGE_KEYS.TEMP_BLOCKS).toBe('tempBlocks');
      expect(STORAGE_KEYS.TEMP_MUTES).toBe('tempMutes');
      expect(STORAGE_KEYS.OPTIONS).toBe('extensionOptions');
      expect(STORAGE_KEYS.ACTION_HISTORY).toBe('actionHistory');
      expect(STORAGE_KEYS.LAST_TAB).toBe('lastActiveTab');
      expect(STORAGE_KEYS.POST_CONTEXTS).toBe('postContexts');
      expect(STORAGE_KEYS.PERMANENT_BLOCKS).toBe('permanentBlocks');
      expect(STORAGE_KEYS.PERMANENT_MUTES).toBe('permanentMutes');
      expect(STORAGE_KEYS.SYNC_STATE).toBe('syncState');
      expect(STORAGE_KEYS.REPOST_FILTERED_USERS).toBe('repostFilteredUsers');
    });
  });
});
