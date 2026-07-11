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

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--bg-terminal)',
        display: visible ? 'block' : 'none',
      }}
    />
  );
}
