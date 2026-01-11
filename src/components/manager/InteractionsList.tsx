import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { Interaction } from '../../types.js';
import {
  expandedInteractions,
  expandedLoading,
  tempUnblockTimers,
} from '../../signals/manager.js';
import { postUriToUrl, formatTimeAgo } from './utils.js';

interface InteractionsListProps {
  did: string;
  handle: string;
  isBlocked: boolean;
  onFetchInteractions: (did: string, handle: string) => Promise<void>;
  onViewPost: (did: string, handle: string, url: string) => void;
}

export function InteractionsList({
  did,
  handle,
  isBlocked,
  onFetchInteractions,
  onViewPost,
}: InteractionsListProps): JSX.Element {
  const interactions = expandedInteractions.value.get(did);
  const isLoading = expandedLoading.value.has(did);
  const tempTimer = tempUnblockTimers.value.get(did);

  // Fetch interactions on mount if not already loaded
  useEffect(() => {
    if (!interactions && !isLoading) {
      onFetchInteractions(did, handle);
    }
  }, [did, handle, interactions, isLoading, onFetchInteractions]);

  if (isLoading) {
    return (
      <div class="interactions-list loading">
        <span class="loading-spinner" />
        Searching for interactions...
      </div>
    );
  }

  if (!interactions || interactions.length === 0) {
    return (
      <div class="interactions-list empty">
        <span class="no-interactions">No interactions found</span>
        <button
          class="context-btn"
          onClick={() => onFetchInteractions(did, handle)}
        >
          Search again
        </button>
      </div>
    );
  }

  return (
    <div class="interactions-list">
      <div class="interactions-header">
        <span class="interactions-count">{interactions.length} interaction{interactions.length !== 1 ? 's' : ''} found</span>
      </div>
      <div class="interactions-items">
        {interactions.map((interaction) => (
          <InteractionItem
            key={interaction.uri}
            interaction={interaction}
            isBlocked={isBlocked}
            tempTimer={tempTimer}
            onViewPost={(url) => onViewPost(did, handle, url)}
          />
        ))}
      </div>
    </div>
  );
}

interface InteractionItemProps {
  interaction: Interaction;
  isBlocked: boolean;
  tempTimer: { timerId: number; expiresAt: number } | undefined;
  onViewPost: (url: string) => void;
}

function InteractionItem({
  interaction,
  isBlocked,
  tempTimer,
  onViewPost,
}: InteractionItemProps): JSX.Element {
  const postUrl = postUriToUrl(interaction.uri);

  const typeLabels: Record<Interaction['type'], string> = {
    reply: 'Reply',
    quote: 'Quote',
    mention: 'Mention',
  };

  const authorLabel = interaction.author === 'them' ? 'They wrote' : 'You wrote';

  return (
    <div class="interaction-item">
      <div class="interaction-meta">
        <span class={`badge badge-${interaction.type}`}>
          {typeLabels[interaction.type]}
        </span>
        <span class="interaction-author">{authorLabel}</span>
        <span class="interaction-date" title={new Date(interaction.createdAt).toLocaleString()}>
          {formatTimeAgo(interaction.createdAt)}
        </span>
      </div>
      <div class="interaction-text">{interaction.text}</div>
      <div class="interaction-actions">
        {isBlocked ? (
          <button
            class={`context-btn context-view-btn ${tempTimer ? 'temp-unblocked' : ''}`}
            onClick={() => onViewPost(postUrl)}
            disabled={!!tempTimer}
          >
            {tempTimer ? 'Re-blocking...' : 'View'}
          </button>
        ) : (
          <a href={postUrl} target="_blank" rel="noopener" class="context-btn context-link-btn">
            View
          </a>
        )}
      </div>
    </div>
  );
}
