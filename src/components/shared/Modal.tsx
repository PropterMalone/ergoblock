import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useCallback } from 'preact/hooks';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  class?: string;
  children: ComponentChildren;
}

export function Modal({
  isOpen,
  onClose,
  title,
  class: className = '',
  children,
}: ModalProps): JSX.Element | null {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  const handleOverlayClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, handleEscape]);

  if (!isOpen) {
    return null;
  }

  const classes = ['modal', className].filter(Boolean).join(' ');

  return (
    <div class="modal-overlay" onClick={handleOverlayClick}>
      <div class={classes} role="dialog" aria-modal="true" aria-labelledby={title ? 'modal-title' : undefined}>
        {title && (
          <div class="modal-header">
            <h2 id="modal-title" class="modal-title">
              {title}
            </h2>
            <button type="button" class="modal-close" onClick={onClose} aria-label="Close">
              &times;
            </button>
          </div>
        )}
        <div class="modal-content">{children}</div>
      </div>
    </div>
  );
}
