import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Trash2, ExternalLink, Filter, RefreshCw, Plus } from 'lucide-preact';
import type { RepostFilteredUser } from '../../types.js';
import {
  getRepostFilteredUsersArray,
  removeRepostFilteredUser,
  addRepostFilteredUser,
} from '../../storage.js';
import { formatDate } from './utils.js';
import browser from '../../browser.js';

interface RepostFiltersTabProps {
  onReload: () => Promise<void>;
}

export function RepostFiltersTab({ onReload }: RepostFiltersTabProps): JSX.Element {
  const [users, setUsers] = useState<RepostFilteredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [addHandle, setAddHandle] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const filteredUsers = await getRepostFilteredUsersArray();
      setUsers(filteredUsers);
    } catch (error) {
      console.error('[RepostFiltersTab] Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleRemove = async (did: string) => {
    setRemoving(did);
    try {
      await removeRepostFilteredUser(did);
      await loadUsers();
      await onReload();
    } catch (error) {
      console.error('[RepostFiltersTab] Failed to remove user:', error);
      alert('Failed to remove user from filter list');
    } finally {
      setRemoving(null);
    }
  };

  const handleAddUser = async () => {
    if (!addHandle.trim()) {
      setAddError('Please enter a handle');
      return;
    }

    setAdding(true);
    setAddError(null);

    try {
      // Strip leading @ if present
      const normalizedHandle = addHandle.trim().startsWith('@')
        ? addHandle.trim().slice(1)
        : addHandle.trim();

      // Check if user already exists in the list
      const existingUser = users.find(
        (u) => u.handle.toLowerCase() === normalizedHandle.toLowerCase()
      );
      if (existingUser) {
        setAddError('User is already in your filter list');
        return;
      }

      // Resolve handle to get profile
      const response = (await browser.runtime.sendMessage({
        type: 'RESOLVE_HANDLE',
        handle: normalizedHandle,
      })) as { success: boolean; profile?: { did: string; handle: string; displayName?: string; avatar?: string }; error?: string };

      if (!response.success || !response.profile) {
        setAddError(response.error || 'User not found');
        return;
      }

      // Check if DID already exists (in case handle changed)
      const existingByDid = users.find((u) => u.did === response.profile!.did);
      if (existingByDid) {
        setAddError('User is already in your filter list');
        return;
      }

      // Add to repost filter list
      const newUser: RepostFilteredUser = {
        did: response.profile.did,
        handle: response.profile.handle,
        displayName: response.profile.displayName,
        avatar: response.profile.avatar,
        addedAt: Date.now(),
      };
      await addRepostFilteredUser(newUser);

      // Reload the list and clear input
      await loadUsers();
      await onReload();
      setAddHandle('');
      setAddError(null);
    } catch (error) {
      console.error('[RepostFiltersTab] Failed to add user:', error);
      setAddError('Failed to add user');
    } finally {
      setAdding(false);
    }
  };

  const filteredUsers = searchQuery
    ? users.filter(
        (user) =>
          user.handle.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : users;

  const defaultAvatar =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z"/></svg>';

  if (loading) {
    return (
      <div class="blocklist-audit-container">
        <div class="blocklist-audit-empty">
          <RefreshCw size={24} class="spinner" />
          <p>Loading repost filters...</p>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div class="blocklist-audit-container">
        <div class="blocklist-audit-empty">
          <Filter size={32} style={{ marginBottom: '12px', color: '#666' }} />
          <h3>Repost Filters</h3>
          <p>
            No repost filters configured yet.
            <br />
            <br />
            To hide reposts from specific users while still seeing their original posts, click the
            three-dot menu on their profile and select "Disable Reposts", or add a user by handle
            below.
          </p>
        </div>
        {/* Add User Section - shown even when empty */}
        <div class="block-rel-search-section" style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <input
                type="text"
                class="block-rel-search-input"
                placeholder="Enter handle, e.g. user.bsky.social"
                value={addHandle}
                onInput={(e) => {
                  setAddHandle((e.target as HTMLInputElement).value);
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !adding) {
                    handleAddUser();
                  }
                }}
                disabled={adding}
                style={{ width: '100%' }}
              />
              {addError && (
                <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>
                  {addError}
                </div>
              )}
            </div>
            <button
              class="blocklist-action-btn"
              onClick={handleAddUser}
              disabled={adding || !addHandle.trim()}
              title="Add user to filter list"
            >
              {adding ? <RefreshCw size={14} class="spinner" /> : <Plus size={14} />}
              Add
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="blocklist-audit-container">
      {/* Stats Header */}
      <div class="blocklist-audit-header">
        <div class="blocklist-audit-stats">
          <div class="audit-stat">
            <div class="audit-stat-value">{users.length}</div>
            <div class="audit-stat-label">Filtered Users</div>
          </div>
        </div>
        <div class="blocklist-audit-actions">
          <input
            type="text"
            class="block-rel-search-input"
            placeholder="Search users..."
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            style={{ width: '200px', marginRight: '8px' }}
          />
        </div>
      </div>

      {/* Description */}
      <div class="block-rel-search-section" style={{ marginBottom: '16px' }}>
        <p class="block-rel-search-desc">
          Reposts from these users are hidden from your feed. Their original posts will still
          appear.
        </p>
      </div>

      {/* Add User Section */}
      <div class="block-rel-search-section" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <input
              type="text"
              class="block-rel-search-input"
              placeholder="Enter handle, e.g. user.bsky.social"
              value={addHandle}
              onInput={(e) => {
                setAddHandle((e.target as HTMLInputElement).value);
                setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !adding) {
                  handleAddUser();
                }
              }}
              disabled={adding}
              style={{ width: '100%' }}
            />
            {addError && (
              <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>
                {addError}
              </div>
            )}
          </div>
          <button
            class="blocklist-action-btn"
            onClick={handleAddUser}
            disabled={adding || !addHandle.trim()}
            title="Add user to filter list"
          >
            {adding ? <RefreshCw size={14} class="spinner" /> : <Plus size={14} />}
            Add
          </button>
        </div>
      </div>

      {/* User List */}
      <div class="block-rel-results">
        {filteredUsers.length === 0 ? (
          <div class="block-rel-no-results">
            <p>No users match your search.</p>
          </div>
        ) : (
          <div class="block-rel-user-list">
            {filteredUsers.map((user) => (
              <div key={user.did} class="block-rel-user-row">
                <img
                  class="block-rel-user-avatar"
                  src={user.avatar || defaultAvatar}
                  alt=""
                  loading="lazy"
                />
                <div class="block-rel-user-info">
                  <span class="block-rel-user-handle">@{user.handle}</span>
                  {user.displayName && <span class="block-rel-user-name">{user.displayName}</span>}
                  <span class="block-rel-user-date">Added {formatDate(user.addedAt)}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <a
                    class="conflict-view-profile"
                    href={`https://bsky.app/profile/${user.handle}`}
                    target="_blank"
                    rel="noopener"
                  >
                    <ExternalLink size={12} /> View
                  </a>
                  <button
                    class="blocklist-action-btn danger"
                    onClick={() => handleRemove(user.did)}
                    disabled={removing === user.did}
                    title="Remove from filter list"
                  >
                    {removing === user.did ? (
                      <RefreshCw size={14} class="spinner" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
