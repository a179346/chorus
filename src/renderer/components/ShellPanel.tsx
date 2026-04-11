import React from 'react';

interface ShellPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function ShellPanel({ collapsed, onToggle, children }: ShellPanelProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={headerStyle} onClick={onToggle}>
        <span
          style={{
            display: 'inline-block',
            transition: 'transform var(--transition-fast)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            fontSize: 9,
            color: 'var(--text-dimmed)',
            marginRight: 6,
          }}
        >
          ▼
        </span>
        <span style={{ color: 'var(--text-dimmed)', fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Shell
        </span>
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-terminal)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  height: 'var(--shell-collapsed-height)',
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  background: 'var(--bg-surface)',
  borderTop: '1px solid rgba(var(--tint-rgb), 0.08)',
  cursor: 'pointer',
  flexShrink: 0,
  userSelect: 'none',
};
