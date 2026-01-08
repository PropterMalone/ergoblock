import type { JSX } from 'preact';
import { useCallback, useEffect } from 'preact/hooks';

export interface DurationOption {
  label: string;
  ms: number;
}

export interface DurationPickerProps {
  actionType: 'block' | 'mute';
  handle: string;
  options: DurationOption[];
  onSelect: (durationMs: number, label: string) => void;
  onCancel: () => void;
}

const styles = `
  .ergo-duration-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
  }

  .ergo-duration-dialog {
    background: white;
    border-radius: 12px;
    padding: 20px;
    min-width: 280px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .ergo-duration-title {
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 600;
    color: #1a1a1a;
  }

  .ergo-duration-subtitle {
    margin: 0 0 16px 0;
    font-size: 14px;
    color: #666;
  }

  .ergo-duration-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .ergo-duration-btn {
    padding: 10px 16px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #f5f5f5;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: #1a1a1a;
    transition: all 0.2s;
  }

  .ergo-duration-btn:hover {
    background: #0085ff;
    color: white;
    border-color: #0085ff;
  }

  .ergo-duration-btn.permanent {
    grid-column: 1 / -1;
    border-color: #dc2626;
    background: #dc2626;
    color: white;
  }

  .ergo-duration-btn.permanent:hover {
    background: #b91c1c;
    border-color: #b91c1c;
  }

  .ergo-duration-cancel {
    margin-top: 12px;
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    font-size: 14px;
    color: #666;
    width: 100%;
  }

  .ergo-duration-cancel:hover {
    background: #f5f5f5;
  }
`;

export function DurationPicker({
  actionType,
  handle,
  options,
  onSelect,
  onCancel,
}: DurationPickerProps): JSX.Element {
  const handleOverlayClick = useCallback(
    (e: MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains('ergo-duration-overlay')) {
        onCancel();
      }
    },
    [onCancel]
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const handleSelect = useCallback(
    (option: DurationOption) => {
      onSelect(option.ms, option.label);
    },
    [onSelect]
  );

  return (
    <>
      <style>{styles}</style>
      <div class="ergo-duration-overlay" onClick={handleOverlayClick}>
        <div class="ergo-duration-dialog">
          <h3 class="ergo-duration-title">
            {actionType === 'block' ? 'Block' : 'Mute'} @{handle}
          </h3>
          <p class="ergo-duration-subtitle">Choose duration:</p>
          <div class="ergo-duration-buttons">
            {options.map((option) => (
              <button
                key={option.label}
                type="button"
                class={`ergo-duration-btn ${option.ms === -1 ? 'permanent' : ''}`}
                onClick={() => handleSelect(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" class="ergo-duration-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
