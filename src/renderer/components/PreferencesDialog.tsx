import React, { useState, useEffect, useRef } from 'react';
import { THEMES } from '../themes';

interface PreferencesDialogProps {
  open: boolean;
  fontFamily: string;
  theme: string;
  claudeFontSize: number;
  shellFontSize: number;
  onClose: () => void;
  onSave: (settings: { fontFamily: string; theme: string; claudeFontSize: number; shellFontSize: number }) => void;
  onPreviewTheme: (themeId: string) => void;
}

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

function parseFontSize(value: string): number | null {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  if (n < MIN_FONT_SIZE || n > MAX_FONT_SIZE) return null;
  return n;
}

export function PreferencesDialog({ open, fontFamily, theme, claudeFontSize, shellFontSize, onClose, onSave, onPreviewTheme }: PreferencesDialogProps): React.ReactElement | null {
  const [font, setFont] = useState(fontFamily);
  const [selectedTheme, setSelectedTheme] = useState(theme);
  const [claudeSize, setClaudeSize] = useState<string>(String(claudeFontSize));
  const [shellSize, setShellSize] = useState<string>(String(shellFontSize));
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setFont(fontFamily);
    setSelectedTheme(theme);
    setClaudeSize(String(claudeFontSize));
    setShellSize(String(shellFontSize));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, fontFamily, theme, claudeFontSize, shellFontSize]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
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
  }, [open, onClose, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    onPreviewTheme(theme); // restore original theme
    onClose();
  };

  const handleThemeSelect = (id: string) => {
    setSelectedTheme(id);
    onPreviewTheme(id);
  };

  const claudeSizeNum = parseFontSize(claudeSize);
  const shellSizeNum = parseFontSize(shellSize);
  const canSave = font.trim().length > 0 && claudeSizeNum !== null && shellSizeNum !== null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave({
      fontFamily: font.trim(),
      theme: selectedTheme,
      claudeFontSize: claudeSizeNum,
      shellFontSize: shellSizeNum,
    });
  };

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div ref={dialogRef} style={dialogStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Preferences">
        <div style={titleStyle}>Preferences</div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Theme picker */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Theme</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {THEMES.map((t) => {
                const isActive = selectedTheme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleThemeSelect(t.id)}
                    style={{
                      width: 'calc(25% - 5px)',
                      padding: 0,
                      borderRadius: 'var(--radius-md)',
                      border: `2px solid ${isActive ? t.preview.accent : 'transparent'}`,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      background: 'none',
                      transition: 'border-color var(--transition-fast)',
                    }}
                  >
                    <div style={{
                      height: 28,
                      background: t.preview.bg,
                      position: 'relative',
                    }}>
                      <div style={{
                        position: 'absolute',
                        bottom: 5,
                        left: 7,
                        width: 10,
                        height: 3,
                        borderRadius: 1,
                        background: t.preview.accent,
                        opacity: 0.9,
                      }} />
                      <div style={{
                        position: 'absolute',
                        bottom: 5,
                        left: 20,
                        width: 18,
                        height: 2,
                        borderRadius: 1,
                        background: t.preview.accent,
                        opacity: 0.25,
                      }} />
                    </div>
                    <div style={{
                      padding: '4px 0',
                      fontSize: 9,
                      fontWeight: 600,
                      background: t.preview.panel,
                      color: isActive ? t.preview.accent : '#888',
                      textAlign: 'center',
                      letterSpacing: '0.02em',
                    }}>
                      {t.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Font family */}
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

          {/* Font sizes */}
          <div style={fieldStyle}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ ...fieldStyle, flex: 1 }}>
                <label style={labelStyle}>Claude Code Font Size</label>
                <input
                  type="number"
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
                  step={1}
                  style={{ ...inputStyle, borderColor: claudeSizeNum === null ? 'var(--accent-red)' : undefined }}
                  value={claudeSize}
                  onChange={(e) => setClaudeSize(e.target.value)}
                />
              </div>
              <div style={{ ...fieldStyle, flex: 1 }}>
                <label style={labelStyle}>Shell Font Size</label>
                <input
                  type="number"
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
                  step={1}
                  style={{ ...inputStyle, borderColor: shellSizeNum === null ? 'var(--accent-red)' : undefined }}
                  value={shellSize}
                  onChange={(e) => setShellSize(e.target.value)}
                />
              </div>
            </div>
            <span style={hintStyle}>Between {MIN_FONT_SIZE} and {MAX_FONT_SIZE}.</span>
          </div>

          {/* Preview */}
          <div style={previewContainerStyle}>
            <span style={previewLabelStyle}>Preview</span>
            <div style={{ ...previewTextStyle, fontFamily: font || undefined, fontSize: claudeSizeNum ?? 13 }}>
              AaBbCc 0123 {'{ }'} =&gt; !=
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" style={cancelButtonStyle} onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...submitButtonStyle,
                opacity: canSave ? 1 : 0.4,
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
              disabled={!canSave}
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
  color: 'var(--btn-primary-text)',
  background: 'var(--accent-primary)',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  transition: 'all var(--transition-fast)',
};
