import React, { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { focusIsLost, useFocusReturn } from '../use-focus-return';

const VIEWPORT_MARGIN = 8;

interface MenuProps {
  x: number;
  y: number;
  label?: string;
  width?: number;
  /** The button that opened the menu: pressing it again is its own toggle, not an outside press. */
  anchorRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A floating menu at (x, y), measured and nudged to stay on screen, scrolling
 * when taller than the window. While focus is in it, arrow keys, Home and End
 * move between items. It closes on Escape, Tab, a press outside it and its
 * anchor, or focus leaving it, and hands focus back to whatever had it before.
 */
export function Menu({ x, y, label, width, anchorRef, onClose, children }: MenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  const isReturningFocus = useFocusReturn(menuRef);

  // Before paint, so the menu never flashes at its unclamped spot, and again
  // whenever its items change size while it's open
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const clamp = (): void => {
      const { width: w, height: h } = menu.getBoundingClientRect();
      setPosition({
        left: clampToViewport(x, w, window.innerWidth),
        top: clampToViewport(y, h, window.innerHeight),
      });
    };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node) || menuRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) {
        // The anchor's click toggles the menu; until then focus stays in it
        e.preventDefault();
        return;
      }
      onClose();
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [anchorRef, onClose]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const focusFirstItem = (): void => menuItems(menu)[0]?.focus();
    focusFirstItem();
    // A re-render can remove the focused item (its action stopped applying); keep the keyboard in the menu
    const observer = new MutationObserver(() => {
      if (focusIsLost()) focusFirstItem();
    });
    observer.observe(menu, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      // Tab would wander off into the page behind; leave the way Escape does
      e.preventDefault();
      onClose();
      return;
    }
    const items = menuItems(e.currentTarget);
    const current = items.findIndex((item) => item === document.activeElement);
    const next = itemIndexForKey(e.key, current, items.length);
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="menu"
      style={{ ...position, width, maxHeight: `calc(100vh - ${2 * VIEWPORT_MARGIN}px)` }}
      onKeyDown={handleKeyDown}
      // Focus leaving for anywhere else (another window, a dialog or palette opened over it) closes it;
      // focus going back where it came from as the menu closes doesn't
      onBlur={(e) => {
        if (!isReturningFocus() && !e.currentTarget.contains(e.relatedTarget)) onClose();
      }}
      // Hover already moves focus; a press on a divider or the padding mustn't drop it
      onMouseDown={(e) => e.preventDefault()}
      // A right-click inside is the menu's own: no native menu, and none from the panel behind
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

/** `start` moved as little as needed for `size` to fit in `viewport`, margin included. */
function clampToViewport(start: number, size: number, viewport: number): number {
  return Math.max(VIEWPORT_MARGIN, Math.min(start, viewport - size - VIEWPORT_MARGIN));
}

function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

/** The item a navigation key moves to from `current` (-1 for none), or null for any other key. */
function itemIndexForKey(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

interface MenuItemProps {
  onSelect: () => void;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  title?: string;
  children: React.ReactNode;
}

export function MenuItem({ onSelect, icon, shortcut, danger, title, children }: MenuItemProps): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      title={title}
      className={danger ? 'menu-item menu-item-danger' : 'menu-item'}
      // The pointer moves focus, so mouse and arrow keys share one highlight
      onMouseMove={(e) => e.currentTarget.focus()}
      onClick={onSelect}
    >
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </span>
      {shortcut && <span className="menu-item-shortcut">{shortcut}</span>}
    </button>
  );
}

export function MenuDivider(): React.ReactElement {
  return <div className="menu-divider" role="separator" />;
}
