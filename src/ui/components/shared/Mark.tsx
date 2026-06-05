import type { JSX } from 'preact';

export interface MarkProps {
  size?: number;
  accent?: string;
  stroke?: number;
  withDot?: boolean;
}

/**
 * Companion-mark: Bluesky butterfly silhouette as outline + small accent dot.
 * Says "extension companion to Bluesky", not impersonation.
 */
export function Mark({
  size = 28,
  accent = 'var(--eb-blue-500)',
  stroke = 1.6,
  withDot = true,
}: MarkProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 57" fill="none" aria-hidden="true">
      <path
        d="M13.873 3.805C21.21 9.332 29.103 20.537 32 26.55c2.897-6.013 10.79-17.218 18.127-22.745C55.422.214 64-2.034 64 7.755c0 1.954-1.12 16.408-1.778 18.747-2.282 8.13-10.575 10.205-17.954 8.952 12.896 2.192 16.177 9.466 9.09 16.74-13.453 13.812-19.339-3.46-20.846-7.892-.276-.812-.405-1.192-.51-1.192-.107 0-.236.38-.512 1.192-1.507 4.432-7.392 21.704-20.846 7.892-7.087-7.274-3.806-14.548 9.09-16.74-7.378 1.253-15.671-.822-17.954-8.952C1.12 24.163 0 9.708 0 7.755 0-2.034 8.578.214 13.873 3.805z"
        stroke={accent}
        strokeWidth={stroke}
        fill="none"
      />
      {withDot && <circle cx="32" cy="32" r="3" fill={accent} />}
    </svg>
  );
}

export interface WordmarkProps {
  size?: number;
  includeMark?: boolean;
}

export function Wordmark({ size = 18, includeMark = true }: WordmarkProps): JSX.Element {
  return (
    <span class="eb-wordmark" style={{ gap: `${size * 0.4}px` }}>
      {includeMark && <Mark size={size * 1.1} stroke={1.4} withDot />}
      <span class="eb-wordmark__text" style={{ fontSize: `${size}px` }}>
        ergoblock
      </span>
    </span>
  );
}
