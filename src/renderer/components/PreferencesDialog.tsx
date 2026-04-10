import React, { useState, useEffect, useRef } from 'react';

interface PreferencesDialogProps {
  open: boolean;
  fontFamily: string;
  onClose: () => void;
  onSave: (settings: { fontFamily: string }) => void;
}

export function PreferencesDialog({ open, fontFamily, onClose, onSave }: PreferencesDialogProps): React.ReactElement | null {
  const [font, setFont] = useState(fontFamily);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setFont(fontFamily);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, fontFamily]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!font.trim()) return;
    onSave({ fontFamily: font.trim() });
  };

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div ref={dialogRef} style={dialogStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Preferences">
        <div style={titleStyle}>Preferences</div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Terminal Font Family</label>
            <input
              ref={inputRef}
              style={inputStyle}
              value={font}
              onChange={(e) => setFont(e.target.value)}
              placeholder="'JetBrains Mono', 'Fira Code', monospace"
            />
            <span style={hintStyle}>
              Comma-separated list of fonts. Fonts are tried in order; the first available one is used.
            </span>
          </div>

          {/* Preview */}
          <div style={previewContainerStyle}>
            <span style={previewLabelStyle}>Preview</span>
            <div style={{ ...previewTextStyle, fontFamily: font || undefined }}>
              AaBbCc 0123 {'{ }'} =&gt; !=
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" style={cancelButtonStyle} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...submitButtonStyle,
                opacity: font.trim() ? 1 : 0.4,
              }}
              disabled={!font.trim()}
            >
              Save
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
  background: 'rgba(0, 0, 0, 0.6)',
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

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-dimmed)',
  lineHeight: 1.4,
  marginTop: 2,
};

const previewContainerStyle: React.CSSProperties = {
  background: 'var(--bg-terminal)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const previewLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 500,
  color: 'var(--text-dimmed)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const previewTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-primary)',
  lineHeight: 1.4,
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
  color: '#fff',
  background: 'var(--accent-blue)',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  transition: 'all var(--transition-fast)',
};
