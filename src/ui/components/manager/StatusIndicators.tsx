import type { JSX } from 'preact';
import type { ProfileViewerState } from '../../../types.js';

interface StatusIndicatorsProps {
  viewer?: ProfileViewerState;
  isBlocksTab: boolean;
}

export function StatusIndicators({ viewer, isBlocksTab }: StatusIndicatorsProps): JSX.Element {
  const labels: JSX.Element[] = [];

  if (viewer?.blockedBy) {
    labels.push(
      <span key="blocked-by" class="status-label status-blocked-by">
        Blocking you
      </span>
    );
  }

  const weFollow = !!viewer?.following;
  const theyFollow = !!viewer?.followedBy;

  if (weFollow && theyFollow) {
    labels.push(
      <span key="mutual" class="status-label status-mutual-follow">
        Mutual follow
      </span>
    );
  } else if (weFollow) {
    labels.push(
      <span key="following" class="status-label status-following">
        Following
      </span>
    );
  } else if (theyFollow) {
    labels.push(
      <span key="followed-by" class="status-label status-followed-by">
        Follows you
      </span>
    );
  }

  if (!isBlocksTab && viewer?.muted) {
    labels.push(
      <span key="muted" class="status-label status-muted">
        Muted
      </span>
    );
  }

  if (labels.length === 0) {
    return <td>-</td>;
  }

  return (
    <td>
      <span class="status-labels">{labels}</span>
    </td>
  );
}
