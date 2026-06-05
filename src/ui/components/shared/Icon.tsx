import type { JSX } from 'preact';

const baseProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function svg(size: number, children: JSX.Element | JSX.Element[]): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseProps} aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icon = {
  search: (s = 16): JSX.Element =>
    svg(
      s,
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </>
    ),
  check: (s = 16): JSX.Element => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      {...baseProps}
      strokeWidth={2.5}
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  x: (s = 16): JSX.Element => svg(s, <path d="M18 6L6 18M6 6l12 12" />),
  clock: (s = 16): JSX.Element =>
    svg(
      s,
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  block: (s = 16): JSX.Element =>
    svg(
      s,
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M5.6 5.6l12.8 12.8" />
      </>
    ),
  mute: (s = 16): JSX.Element => svg(s, <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />),
  filter: (s = 16): JSX.Element => svg(s, <path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z" />),
  chevron: (s = 16): JSX.Element => svg(s, <path d="M6 9l6 6 6-6" />),
  external: (s = 14): JSX.Element =>
    svg(s, <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />),
};
