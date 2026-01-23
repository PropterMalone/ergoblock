import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { LastWordOptions } from '../../types.js';
import { Tooltip } from '../shared/Tooltip.js';
import { DURATION_TOOLTIPS } from '../../constants/tooltips.js';

export interface DurationOption {
  label: string;
  ms: number;
}

export interface DurationPickerProps {
  actionType: 'block' | 'mute';
  handle: string;
  did?: string;
  options: DurationOption[];
  onSelect: (durationMs: number, label: string, lastWordOptions?: LastWordOptions) => void;
  onCancel: () => void;
  defaultLastWordDelaySeconds?: number; // From settings, defaults to 60
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

  .ergo-lastword-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #e5e5e5;
  }

  .ergo-lastword-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 14px;
    color: #1a1a1a;
    user-select: none;
  }

  .ergo-lastword-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: #0085ff;
  }

  .ergo-lastword-delay {
    margin-top: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ergo-lastword-delay-label {
    font-size: 13px;
    color: #666;
  }

  .ergo-lastword-delay-input {
    width: 70px;
    padding: 6px 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
    text-align: center;
  }

  .ergo-lastword-delay-input:focus {
    outline: none;
    border-color: #0085ff;
  }

  .ergo-lastword-hint {
    margin-top: 8px;
    font-size: 12px;
    color: #888;
    line-height: 1.4;
  }
`;

export function DurationPicker({
  actionType,
  handle,
  options,
  onSelect,
  onCancel,
  defaultLastWordDelaySeconds = 60,
}: DurationPickerProps): JSX.Element {
  // Last Word state (only for blocks)
  const [lastWordEnabled, setLastWordEnabled] = useState(false);
  const [lastWordDelay, setLastWordDelay] = useState(defaultLastWordDelaySeconds);

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
      if (lastWordEnabled && actionType === 'block') {
        onSelect(option.ms, option.label, {
          enabled: true,
          delaySeconds: lastWordDelay,
        });
      } else {
        onSelect(option.ms, option.label);
      }
    },
    [onSelect, lastWordEnabled, lastWordDelay, actionType]
  );

  const handleDelayChange = useCallback((e: Event) => {
    const value = parseInt((e.target as HTMLInputElement).value, 10);
    // Clamp between 10 and 3600 seconds
    if (!isNaN(value)) {
      setLastWordDelay(Math.max(10, Math.min(3600, value)));
    }
  }, []);

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
            {options.map((option) => {
              const button = (
                <button
                  key={option.label}
                  type="button"
                  class={`ergo-duration-btn ${option.ms === -1 ? 'permanent' : ''}`}
                  onClick={() => handleSelect(option)}
                >
                  {option.label}
                </button>
              );

              // Add tooltip for Permanent option
              if (option.ms === -1) {
                return (
                  <Tooltip key={option.label} text={DURATION_TOOLTIPS.permanent} position="left">
                    <span>{button}</span>
                  </Tooltip>
                );
              }

              return button;
            })}
          </div>
          {actionType === 'block' && (
            <div class="ergo-lastword-section">
              <Tooltip text={DURATION_TOOLTIPS.lastWordOption} position="left">
                <label class="ergo-lastword-label">
                  <input
                    type="checkbox"
                    class="ergo-lastword-checkbox"
                    checked={lastWordEnabled}
                    onChange={(e) => setLastWordEnabled((e.target as HTMLInputElement).checked)}
                  />
                  Last Word (delay block)
                </label>
              </Tooltip>
              {lastWordEnabled && (
                <>
                  <div class="ergo-lastword-delay">
                    <span class="ergo-lastword-delay-label">Block after</span>
                    <input
                      type="number"
                      class="ergo-lastword-delay-input"
                      value={lastWordDelay}
                      min={10}
                      max={3600}
                      onChange={handleDelayChange}
                    />
                    <span class="ergo-lastword-delay-label">seconds</span>
                  </div>
                  <p class="ergo-lastword-hint">
                    Block on a delay to get in the last word.
                  </p>
                </>
              )}
            </div>
          )}
          <button type="button" class="ergo-duration-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
