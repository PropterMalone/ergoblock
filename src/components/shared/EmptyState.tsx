import type { ComponentChildren, JSX } from 'preact';

export interface EmptyStateProps {
  icon?: string;
  message: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  children?: ComponentChildren;
}

export function EmptyState({
  icon,
  message,
  description,
  action,
  children,
}: EmptyStateProps): JSX.Element {
  return (
    <div class="empty-state">
      {icon && <div class="empty-state-icon">{icon}</div>}
      <p class="empty-state-message">{message}</p>
      {description && <p class="empty-state-description">{description}</p>}
      {action && (
        <button type="button" class="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {children}
    </div>
  );
}
