import type { ComponentChildren, JSX } from 'preact';

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid';
export type BtnSize = 'sm' | 'md' | 'lg';

export interface BtnProps {
  variant?: BtnVariant;
  size?: BtnSize;
  block?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: (event: MouseEvent) => void;
  class?: string;
  children: ComponentChildren;
}

/** Pill button — v2 popup primitive. Coexists with Button.tsx (manager). */
export function Btn({
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  type = 'button',
  onClick,
  class: className = '',
  children,
}: BtnProps): JSX.Element {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`, block ? 'btn--block' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} class={classes} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
