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
        <span style={{ color: 'var(--text-dimmed)', fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Shell
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{
            marginLeft: 5,
            transition: 'transform var(--transition-fast)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}
        >
          <path d="M2.5 3.5L5 6.5L7.5 3.5" stroke="var(--text-dimmed)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
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
  padding: '0 14px',
  background: 'var(--bg-panel)',
  borderTop: '1px solid rgba(var(--tint-rgb), 0.06)',
  cursor: 'pointer',
  flexShrink: 0,
  userSelect: 'none',
};
