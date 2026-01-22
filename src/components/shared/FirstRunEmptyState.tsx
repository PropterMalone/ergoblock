import type { JSX } from 'preact';

export interface FirstRunEmptyStateProps {
  /** Which surface this is displayed on */
  surface: 'popup' | 'manager';
}

/**
 * Enhanced empty state for first-time users.
 * Explains what ErgoBlock does and how to get started.
 */
export function FirstRunEmptyState({ surface }: FirstRunEmptyStateProps): JSX.Element {
  return (
    <div class="first-run-empty-state">
      <h2>Welcome to ErgoBlock!</h2>
      <p>
        This extension lets you temporarily block or mute people on Bluesky.
        Blocks and mutes you create will automatically expire after the time you choose.
      </p>
      <div class="first-run-steps">
        <h3>To get started:</h3>
        <ol>
          <li>Go to <a href="https://bsky.app" target="_blank" rel="noopener">bsky.app</a> and find someone's profile</li>
          <li>Click the <strong>...</strong> menu</li>
          <li>Choose <strong>Block</strong> or <strong>Mute</strong> - you'll see duration options</li>
        </ol>
      </div>
      {surface === 'manager' && (
        <p class="first-run-note">
          Once you create your first block or mute, you'll see it listed here.
        </p>
      )}
    </div>
  );
}
