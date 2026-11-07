import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check } from 'lucide-react';
import { THEMES } from '../themes';
import { Dialog } from './Dialog';

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

  useEffect(() => {
    if (!open) return;
    setFont(fontFamily);
    setSelectedTheme(theme);
    setClaudeSize(String(claudeFontSize));
    setShellSize(String(shellFontSize));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, fontFamily, theme, claudeFontSize, shellFontSize]);

  const handleClose = useCallback(() => {
    onPreviewTheme(theme); // restore original theme
    onClose();
  }, [theme, onPreviewTheme, onClose]);

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
    <Dialog title="Preferences" label="Preferences" onClose={handleClose} width={460}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Theme picker */}
        <div className="field" role="radiogroup" aria-label="Theme">
          <span className="field-label">Theme</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {THEMES.map((t) => {
              const isActive = selectedTheme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={t.name}
                  onClick={() => handleThemeSelect(t.id)}
                  style={{
                    padding: 0,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-default)',
                    outline: isActive ? `2px solid ${t.preview.accent}` : 'none',
                    outlineOffset: 1,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    background: 'none',
                    transition: 'outline-color var(--transition-fast)',
                  }}
                >
                  <div style={{
                    height: 38,
                    background: t.preview.bg,
                    position: 'relative',
                  }}>
                    {isActive && (
                      <span style={{ position: 'absolute', top: 5, right: 5, display: 'flex', color: t.preview.accent }}>
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
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
        <div className="field">
          <label htmlFor="pref-font" className="field-label">Terminal Font Family</label>
          <input
            id="pref-font"
            ref={inputRef}
            className="input"
            spellCheck={false}
            value={font}
            onChange={(e) => setFont(e.target.value)}
            placeholder="'JetBrains Mono', 'Fira Code', monospace"
          />
          <span className="field-hint">
            Comma-separated list of fonts. Fonts are tried in order; the first available one is used.
          </span>
        </div>

        {/* Font sizes */}
        <div className="field">
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="pref-claude-size" className="field-label">Claude Code Font Size</label>
              <input
                id="pref-claude-size"
                type="number"
                min={MIN_FONT_SIZE}
                max={MAX_FONT_SIZE}
                step={1}
                className="input"
                aria-invalid={claudeSizeNum === null}
                value={claudeSize}
                onChange={(e) => setClaudeSize(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="pref-shell-size" className="field-label">Shell Font Size</label>
              <input
                id="pref-shell-size"
                type="number"
                min={MIN_FONT_SIZE}
                max={MAX_FONT_SIZE}
                step={1}
                className="input"
                aria-invalid={shellSizeNum === null}
                value={shellSize}
                onChange={(e) => setShellSize(e.target.value)}
              />
            </div>
          </div>
          <span className="field-hint">Between {MIN_FONT_SIZE} and {MAX_FONT_SIZE}.</span>
        </div>

        {/* Preview */}
        <div style={previewContainerStyle}>
          <span style={previewLabelStyle}>Preview</span>
          <div style={{ ...previewTextStyle, fontFamily: font || undefined, fontSize: claudeSizeNum ?? 13 }}>
            AaBbCc 0123 {'{ }'} =&gt; !=
          </div>
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSave}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

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

