import type { ComponentChildren, JSX } from 'preact';
import { Tooltip } from './Tooltip.js';

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

/** Tooltip text for badge variants that need explanation */
const BADGE_TOOLTIPS: Partial<Record<BadgeVariant, string>> = {
  temp: 'Temporary - will automatically expire at the scheduled time',
  permanent: 'Permanent - will not expire unless manually removed',
  expiring: 'Expiring soon - scheduled to be removed within 24 hours',
};

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
