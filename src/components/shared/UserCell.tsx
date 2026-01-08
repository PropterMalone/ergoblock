import type { JSX } from 'preact';

export interface UserCellProps {
  avatar?: string;
  handle: string;
  displayName?: string;
  did?: string;
  showLink?: boolean;
}

export function UserCell({
  avatar,
  handle,
  displayName,
  did,
  showLink = true,
}: UserCellProps): JSX.Element {
  const profileUrl = `https://bsky.app/profile/${handle}`;
  const avatarSrc = avatar || 'icons/default-avatar.svg';

  const content = (
    <>
      <img class="user-avatar" src={avatarSrc} alt="" loading="lazy" />
      <div class="user-info">
        {displayName && <span class="user-display-name">{displayName}</span>}
        <span class="user-handle">@{handle}</span>
      </div>
    </>
  );

  if (showLink) {
    return (
      <a
        class="user-cell"
        href={profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={did ? `DID: ${did}` : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <div class="user-cell" title={did ? `DID: ${did}` : undefined}>
      {content}
    </div>
  );
}
