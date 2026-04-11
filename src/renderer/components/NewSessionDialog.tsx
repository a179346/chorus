import React, { useState, useEffect, useRef, useCallback } from 'react';

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (config: { name: string; cwd: string; worktree: string; flags: string[]; notifyOnIdle: boolean }) => void;
}

export function NewSessionDialog({ open, onClose, onSubmit }: NewSessionDialogProps): React.ReactElement | null {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [worktree, setWorktree] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [chrome, setChrome] = useState(false);
  const [notifyOnIdle, setNotifyOnIdle] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Load defaults
    window.electronAPI.appGetNewSessionDefaults().then((defaults) => {
      setCwd(defaults.cwd || '');
      setAutoMode(defaults.flags.includes('--enable-auto-mode'));
      setChrome(defaults.flags.includes('--chrome'));
      setNotifyOnIdle(defaults.notifyOnIdle ?? false);
    });
    setName('');
    setWorktree('');
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Focus trap: keep Tab cycling within dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'input, button, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSelectDir = useCallback(async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) setCwd(dir);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !cwd.trim()) return;
      const flags: string[] = [];
      if (autoMode) flags.push('--enable-auto-mode');
      flags.push(chrome ? '--chrome' : '--no-chrome');
      onSubmit({ name: name.trim(), cwd: cwd.trim(), worktree: worktree.trim(), flags, notifyOnIdle });
    },
    [name, cwd, worktree, autoMode, chrome, notifyOnIdle, onSubmit]
  );

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div ref={dialogRef} style={dialogStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New Session">
        <div style={titleStyle}>New Session</div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Name */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Session Name</label>
            <input
              ref={nameRef}
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-session"
              autoFocus
            />
          </div>

          {/* Working Directory */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Working Directory</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/Users/..."
              />
              <button type="button" style={browseButtonStyle} onClick={handleSelectDir}>
                Browse
              </button>
            </div>
          </div>

          {/* Worktree */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Worktree <span style={{ color: 'var(--text-dimmed)', fontWeight: 400 }}>(optional)</span></label>
            <input
              style={inputStyle}
              value={worktree}
              onChange={(e) => setWorktree(e.target.value)}
              placeholder="Leave empty to skip"
            />
          </div>

          {/* Flags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                ...checkboxStyle,
                background: autoMode ? 'var(--accent-blue)' : 'var(--bg-surface)',
                borderColor: autoMode ? 'var(--accent-blue)' : 'var(--border-default)',
              }}
              onClick={() => setAutoMode(!autoMode)}
            >
              {autoMode && <span style={{ fontSize: 10, lineHeight: 1 }}>✓</span>}
            </div>
            <label
              style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setAutoMode(!autoMode)}
            >
              Enable auto mode
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                ...checkboxStyle,
                background: chrome ? 'var(--accent-blue)' : 'var(--bg-surface)',
                borderColor: chrome ? 'var(--accent-blue)' : 'var(--border-default)',
              }}
              onClick={() => setChrome(!chrome)}
            >
              {chrome && <span style={{ fontSize: 10, lineHeight: 1 }}>✓</span>}
            </div>
            <label
              style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setChrome(!chrome)}
            >
              Enable Claude in Chrome
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                ...checkboxStyle,
                background: notifyOnIdle ? 'var(--accent-blue)' : 'var(--bg-surface)',
                borderColor: notifyOnIdle ? 'var(--accent-blue)' : 'var(--border-default)',
              }}
              onClick={() => setNotifyOnIdle(!notifyOnIdle)}
            >
              {notifyOnIdle && <span style={{ fontSize: 10, lineHeight: 1 }}>✓</span>}
            </div>
            <label
              style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setNotifyOnIdle(!notifyOnIdle)}
            >
              Notify when idle or waiting
            </label>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" style={cancelButtonStyle} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...submitButtonStyle,
                opacity: name.trim() && cwd.trim() ? 1 : 0.4,
              }}
              disabled={!name.trim() || !cwd.trim()}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(var(--shade-rgb), 0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
  animation: 'fadeIn 150ms ease',
};

const dialogStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  padding: 24,
  width: 420,
  maxWidth: '90vw',
  animation: 'slideUp 200ms ease',
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 18,
  letterSpacing: '0.02em',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 10px',
  fontSize: 12,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  transition: 'border-color var(--transition-fast)',
};

const browseButtonStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 12px',
  fontSize: 11,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  transition: 'all var(--transition-fast)',
  whiteSpace: 'nowrap',
};

const checkboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-default)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all var(--transition-fast)',
  color: 'var(--btn-primary-text)',
  flexShrink: 0,
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '7px 16px',
  borderRadius: 'var(--radius-md)',
  fontSize: 11,
  color: 'var(--text-secondary)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  transition: 'all var(--transition-fast)',
};

const submitButtonStyle: React.CSSProperties = {
  padding: '7px 20px',
  borderRadius: 'var(--radius-md)',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--btn-primary-text)',
  background: 'var(--accent-primary)',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  transition: 'all var(--transition-fast)',
};
