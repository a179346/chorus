import React, { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Session } from '../../shared/types';
import { statusColor } from '../session-presentation';
import { terminals } from '../terminal-host';

interface ExitedSessionBannerProps {
  session: Session;
  error: string | null;
  onRestart: (sessionId: string) => void;
}

/**
 * Overlays an exited session's Claude terminal with a restart affordance.
 * Enter restarts only while that dead terminal has focus (it accepts no
 * input anyway), so typing in the shell panel is never hijacked.
 */
export function ExitedSessionBanner({ session, error, onRestart }: ExitedSessionBannerProps): React.ReactElement {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
      const focused = terminals.focused();
      if (focused?.kind !== 'pty' || focused.sessionId !== session.id) return;
      // Capture phase: stop the keystroke before xterm forwards it to the dead PTY
      e.preventDefault();
      e.stopPropagation();
      onRestart(session.id);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [session.id, onRestart]);

  const message = session.status === 'error' ? 'Claude Code exited with an error' : 'Claude Code exited';

  return (
    <div style={bannerStyle} role="status">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-secondary)' }}>
          <span style={{ ...dotStyle, backgroundColor: statusColor(session.status) }} />
          {message}
        </span>
        {error && (
          <span style={{ color: 'var(--accent-red)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={error}>
            {error}
          </span>
        )}
      </div>
      <button style={restartButtonStyle} onClick={() => onRestart(session.id)} title="Restart Claude Code (⏎)">
        <RotateCcw size={11} />
        Restart
        <kbd style={kbdStyle}>⏎</kbd>
      </button>
    </div>
  );
}

const bannerStyle: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  right: 12,
  bottom: 12,
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 8px 8px 12px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  fontFamily: 'var(--font-ui)',
  fontSize: 12,
  animation: 'slideUp 200ms ease',
};

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
};

const restartButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
  padding: '6px 10px',
  borderRadius: 'var(--radius-md)',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-primary)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  transition: 'all var(--transition-fast)',
};

const kbdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 10,
  color: 'var(--text-dimmed)',
};
