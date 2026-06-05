import type { ComponentChildren, JSX } from 'preact';
import { Tooltip } from './Tooltip.js';
import { BADGE_TOOLTIPS } from '../../constants/tooltips.js';

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
  /** Override default tooltip text, or false to disable */
  tooltip?: string | false;
}

export function Badge({
  variant,
  class: className = '',
  children,
  tooltip,
}: BadgeProps): JSX.Element {
  const classes = ['badge', `badge-${variant}`, className].filter(Boolean).join(' ');
  const badgeElement = <span class={classes}>{children}</span>;

  // Determine tooltip text: explicit prop > default > none
  const tooltipText = tooltip === false ? null : (tooltip ?? BADGE_TOOLTIPS[variant] ?? null);

  if (tooltipText) {
    return (
      <Tooltip text={tooltipText} position="top">
        {badgeElement}
      </Tooltip>
    );
  }

  return badgeElement;
}
