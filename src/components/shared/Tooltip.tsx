import type { ComponentChildren, JSX } from 'preact';
import { useId } from 'preact/hooks';

export interface TooltipProps {
  /** The tooltip text to display */
  text: string;
  /** Position of tooltip relative to children */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** The element that triggers the tooltip */
  children: ComponentChildren;
  /** Additional CSS class for the wrapper */
  class?: string;
}

/**
 * Tooltip component that shows explanatory text on hover/focus.
 * Uses CSS-only approach for performance. Accessible via aria-describedby.
 */
export function Tooltip({
  text,
  position = 'top',
  children,
  class: className,
}: TooltipProps): JSX.Element {
  const tooltipId = useId();

  return (
    <span
      class={`tooltip-wrapper ${className ?? ''}`}
      data-tooltip-position={position}
    >
      <span class="tooltip-trigger" aria-describedby={tooltipId}>
        {children}
      </span>
      <span id={tooltipId} class="tooltip-content" role="tooltip">
        {text}
      </span>
    </span>
  );
}
