import type { JSX } from 'preact';
import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

export interface NotificationMenuProps {
  handle: string;
  onBlock: () => void;
  onMute: () => void;
}

const buttonStyles = `
  .ergo-notif-menu-container {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .ergo-notif-menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    color: rgb(102, 117, 133);
    padding: 0;
    transition: background-color 0.2s, color 0.2s;
  }

  .ergo-notif-menu-btn:hover {
    background: rgba(29, 161, 242, 0.1);
    color: rgb(32, 139, 254);
  }

  .ergo-notif-menu-btn:focus {
    outline: none;
  }

  .ergo-notif-menu-btn svg {
    width: 20px;
    height: 20px;
  }
`;

const dropdownStyles = `
  .ergo-notif-dropdown {
    position: fixed;
    min-width: 200px;
    background: rgb(255, 255, 255);
    border-radius: 12px;
    box-shadow: rgba(0, 0, 0, 0.1) 0px 0px 15px, rgba(0, 0, 0, 0.1) 0px 0px 3px 1px;
    z-index: 2147483647;
    overflow: hidden;
    font-family: InterVariable, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  .ergo-notif-dropdown-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 16px;
    font-weight: 500;
    color: rgb(11, 15, 20);
    text-align: left;
    transition: background-color 0.1s;
  }

  .ergo-notif-dropdown-item:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .ergo-notif-dropdown-item.danger {
    color: rgb(209, 58, 50);
  }

  .ergo-notif-dropdown-item.danger:hover {
    background: rgba(209, 58, 50, 0.1);
  }

  .ergo-notif-dropdown-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }
`;

// Three dots icon (matches Bluesky's native menu icon)
function DotsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

// Block icon (slash through circle)
function BlockIcon(): JSX.Element {
  return (
    <svg
      class="ergo-notif-dropdown-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="4" y1="4" x2="20" y2="20" />
    </svg>
  );
}

// Mute icon (speaker with X)
function MuteIcon(): JSX.Element {
  return (
    <svg
      class="ergo-notif-dropdown-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

// Dropdown content rendered into portal
function DropdownContent({
  top,
  left,
  onBlock,
  onMute,
}: {
  top: number;
  left: number;
  onBlock: () => void;
  onMute: () => void;
}): JSX.Element {
  return (
    <>
      <style>{dropdownStyles}</style>
      <div class="ergo-notif-dropdown" role="menu" style={{ top: `${top}px`, left: `${left}px` }}>
        <button
          type="button"
          class="ergo-notif-dropdown-item danger"
          role="menuitem"
          onClick={onBlock}
        >
          <BlockIcon />
          Block account
        </button>
        <button type="button" class="ergo-notif-dropdown-item" role="menuitem" onClick={onMute}>
          <MuteIcon />
          Mute account
        </button>
      </div>
    </>
  );
}

// Global portal host for dropdowns (created once, reused)
let portalHost: HTMLElement | null = null;
let portalShadow: ShadowRoot | null = null;
let portalContainer: HTMLElement | null = null;

function getPortal(): { shadow: ShadowRoot; container: HTMLElement } {
  if (!portalHost) {
    portalHost = document.createElement('div');
    portalHost.id = 'ergoblock-notif-dropdown-portal';
    portalHost.style.cssText =
      'position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;';
    document.body.appendChild(portalHost);
    portalShadow = portalHost.attachShadow({ mode: 'closed' });
    portalContainer = document.createElement('div');
    portalContainer.style.cssText = 'pointer-events: auto;';
    portalShadow.appendChild(portalContainer);
  }
  return { shadow: portalShadow!, container: portalContainer! };
}

function showDropdownPortal(
  top: number,
  left: number,
  onBlock: () => void,
  onMute: () => void,
  onClose: () => void
): void {
  const { container } = getPortal();

  const handleBlock = () => {
    onClose();
    onBlock();
  };

  const handleMute = () => {
    onClose();
    onMute();
  };

  render(
    <DropdownContent top={top} left={left} onBlock={handleBlock} onMute={handleMute} />,
    container
  );
}

function hideDropdownPortal(): void {
  if (portalContainer) {
    render(null, portalContainer);
  }
}

export function NotificationMenu({ handle, onBlock, onMute }: NotificationMenuProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isOpen) {
        hideDropdownPortal();
        setIsOpen(false);
      } else {
        // Use the click event's coordinates as a reliable anchor point
        // This avoids issues with getBoundingClientRect across Shadow DOM boundaries
        const clickX = e.clientX;
        const clickY = e.clientY;

        // Position dropdown below and to the left of click point
        const dropdownWidth = 200;
        let left = clickX - dropdownWidth + 15; // Offset so dropdown is left of cursor
        // Ensure dropdown doesn't go off the left edge
        if (left < 8) left = 8;
        // Ensure dropdown doesn't go off the right edge (leave 8px margin)
        if (left + dropdownWidth > window.innerWidth - 8) {
          left = window.innerWidth - dropdownWidth - 8;
        }
        const top = clickY + 20; // Below the click point

        showDropdownPortal(top, left, onBlock, onMute, () => {
          hideDropdownPortal();
          setIsOpen(false);
        });
        setIsOpen(true);
      }
    },
    [isOpen, onBlock, onMute]
  );

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      // Check if click is inside the portal dropdown
      if (portalContainer?.contains(e.target as Node)) {
        return;
      }
      // Check if click is on our menu button (has specific class) - check in Shadow DOM too
      const target = e.target as HTMLElement;
      if (target.closest?.('.ergo-notif-menu-btn')) {
        return;
      }
      // Also check composed path for Shadow DOM elements
      const path = e.composedPath?.() || [];
      for (const el of path) {
        if (el instanceof HTMLElement && el.classList?.contains('ergo-notif-menu-btn')) {
          return;
        }
      }
      hideDropdownPortal();
      setIsOpen(false);
    };

    // Use longer timeout to ensure the opening click has fully propagated
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside, true);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hideDropdownPortal();
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isOpen) {
        hideDropdownPortal();
      }
    };
  }, [isOpen]);

  return (
    <>
      <style>{buttonStyles}</style>
      <div class="ergo-notif-menu-container">
        <button
          type="button"
          class="ergo-notif-menu-btn"
          onClick={handleToggle}
          aria-label={`More options for @${handle}`}
          aria-expanded={isOpen}
          aria-haspopup="menu"
        >
          <DotsIcon />
        </button>
      </div>
    </>
  );
}
