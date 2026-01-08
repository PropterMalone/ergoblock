import type { ComponentChildren, JSX } from 'preact';

export type BadgeVariant =
  | 'temp'
  | 'permanent'
  | 'expiring'
  | 'guessed'
  | 'mute'
  | 'block'
  | 'mutual'
  | 'following'
  | 'follower'
  | 'info'
  | 'warning'
  | 'error'
  | 'success';

export interface BadgeProps {
  variant: BadgeVariant;
  class?: string;
  children: ComponentChildren;
}

export function Badge({ variant, class: className = '', children }: BadgeProps): JSX.Element {
  const classes = ['badge', `badge-${variant}`, className].filter(Boolean).join(' ');

  return <span class={classes}>{children}</span>;
}
