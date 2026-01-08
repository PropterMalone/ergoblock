import type { ComponentChildren, JSX } from 'preact';

export interface ButtonProps {
  variant?: 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  class?: string;
  children: ComponentChildren;
}

export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  class: className = '',
  children,
}: ButtonProps): JSX.Element {
  const baseClass = 'btn';
  const variantClass = `btn-${variant}`;
  const sizeClass = size === 'sm' ? 'btn-sm' : '';
  const loadingClass = loading ? 'btn-loading' : '';

  const classes = [baseClass, variantClass, sizeClass, loadingClass, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      class={classes}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading ? <span class="spinner" /> : null}
      {children}
    </button>
  );
}
