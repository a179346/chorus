import React, { useRef, useEffect } from 'react';
import '@xterm/xterm/css/xterm.css';
import { terminals, type TerminalKind } from '../terminal-host';

interface TerminalViewProps {
  sessionId: string | null;
  type: TerminalKind;
  visible?: boolean;
  fontFamily?: string;
  fontSize?: number;
}

/** Thin React adapter over the terminal host: mounts the cached terminal for a session. */
export function TerminalView({
  sessionId,
  type,
  visible = true,
  fontFamily,
  fontSize,
}: TerminalViewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId || !containerRef.current || !visible) return;
    return terminals.attach(type, sessionId, containerRef.current, { fontFamily, fontSize });
  }, [sessionId, type, visible, fontFamily, fontSize]);

  // The breathing room lives on a wrapper: the fit addon sizes the terminal
  // from its container's box, so the container itself must stay unpadded.
  return (
    <div
      style={{ ...gutterStyle, display: visible ? 'block' : 'none' }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget || !sessionId) return;
        e.preventDefault();
        terminals.focus(type, sessionId);
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

const gutterStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  padding: '8px 4px 4px 14px',
  background: 'var(--bg-terminal)',
};
