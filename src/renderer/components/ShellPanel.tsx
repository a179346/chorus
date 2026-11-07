import React from 'react';
import { ChevronDown, SquareTerminal } from 'lucide-react';

/** Also the panel's collapsed size, so the split pane must use the same number. */
export const SHELL_HEADER_HEIGHT = 28;

interface ShellPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function ShellPanel({ collapsed, onToggle, children }: ShellPanelProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <button
        type="button"
        style={headerStyle}
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show shell' : 'Hide shell'}
      >
        <SquareTerminal size={12} />
        <span className="panel-title">Shell</span>
        <ChevronDown
          size={12}
          style={{
            transition: 'transform var(--transition-fast)',
            transform: collapsed ? 'rotate(-90deg)' : 'none',
          }}
        />
      </button>
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-terminal)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  height: SHELL_HEADER_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '0 14px',
  background: 'var(--bg-panel)',
  color: 'var(--text-dimmed)',
  flexShrink: 0,
  userSelect: 'none',
};
