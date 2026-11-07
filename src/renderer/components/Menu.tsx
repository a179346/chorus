import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const VIEWPORT_MARGIN = 8;

interface MenuProps {
  x: number;
  y: number;
  label?: string;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A floating menu at (x, y), measured and nudged to stay on screen.
 * Closes on outside press or Escape; arrow keys move between items.
 */
export function Menu({ x, y, label, width, onClose, children }: MenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // Read through a ref so a new callback identity doesn't re-run the setup and steal focus
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Before paint, so the menu never flashes at its unclamped spot
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width: w, height: h } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - w - VIEWPORT_MARGIN)),
      top: Math.max(4, Math.min(y, window.innerHeight - h - VIEWPORT_MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    const items = (): HTMLElement[] =>
      Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

    const handlePointerDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && !menuRef.current?.contains(e.target)) onCloseRef.current();
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = items();
      if (list.length === 0) return;
      const current = list.findIndex((item) => item === document.activeElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(current + step + list.length) % list.length].focus();
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    items()[0]?.focus();
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div ref={menuRef} role="menu" aria-label={label} className="menu" style={{ ...position, width }}>
      {children}
    </div>
  );
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
