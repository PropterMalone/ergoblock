import type { JSX } from 'preact';

interface UserCellProps {
  handle: string;
  displayName?: string;
  avatar?: string;
}

export function UserCell({ handle, displayName, avatar }: UserCellProps): JSX.Element {
  return (
    <td class="user-col">
      <div class="user-cell">
        {avatar ? (
          <img src={avatar} class="user-avatar" alt="" loading="lazy" />
        ) : (
          <div class="user-avatar" />
        )}
        <div class="user-info">
          <span class="user-handle">@{handle}</span>
          {displayName && <span class="user-display-name">{displayName}</span>}
        </div>
      </div>
    </td>
  );
}
