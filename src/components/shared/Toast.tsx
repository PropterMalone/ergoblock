import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}

export function Toast({
  message,
  type = 'info',
  duration = 3000,
  onClose,
}: ToastProps): JSX.Element {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onClose?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const classes = ['toast', `toast-${type}`, isVisible ? 'toast-visible' : 'toast-hidden']
    .filter(Boolean)
    .join(' ');

  return (
    <div class={classes} role="alert">
      <span class="toast-message">{message}</span>
      {onClose && (
        <button
          type="button"
          class="toast-close"
          onClick={() => {
            setIsVisible(false);
            onClose();
          }}
          aria-label="Close"
        >
          &times;
        </button>
      )}
    </div>
  );
}
