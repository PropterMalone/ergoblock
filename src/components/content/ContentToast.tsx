import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export interface ContentToastProps {
  message: string;
  isError?: boolean;
  duration?: number;
  onClose: () => void;
}

const styles = `
  @keyframes ergo-slideUp {
    from {
      transform: translateX(-50%) translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  }

  .ergo-toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 2147483646;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: ergo-slideUp 0.3s ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .ergo-toast.success {
    background: #0085ff;
    color: white;
  }

  .ergo-toast.error {
    background: #dc2626;
    color: white;
  }
`;

export function ContentToast({
  message,
  isError = false,
  duration = 3000,
  onClose,
}: ContentToastProps): JSX.Element {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!visible) return <></>;

  return (
    <>
      <style>{styles}</style>
      <div class={`ergo-toast ${isError ? 'error' : 'success'}`}>{message}</div>
    </>
  );
}
