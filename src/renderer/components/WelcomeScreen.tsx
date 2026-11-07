import React from 'react';
import { Plus } from 'lucide-react';
import { Keys } from './Kbd';

interface WelcomeScreenProps {
  onNewSession: () => void;
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['⌘', 'K'], label: 'Command palette' },
  { keys: ['⌘', '1–9'], label: 'Switch between sessions' },
  { keys: ['⌘', 'J'], label: 'Jump to a session that needs you' },
  { keys: ['⌘', '⇧', 'T'], label: 'Reopen a closed session' },
];

/** Fills the main area when there are no sessions, so the first step is obvious. */
export function WelcomeScreen({ onNewSession }: WelcomeScreenProps): React.ReactElement {
  return (
    <div style={containerStyle}>
      <div style={contentStyle}>
        <ChorusMark />
        <h1 style={titleStyle}>Chorus</h1>
        <p style={taglineStyle}>Every Claude Code session, in one quiet window.</p>

        <button type="button" className="btn btn-primary" style={{ height: 34, padding: '0 18px', fontSize: 12 }} onClick={onNewSession}>
          <Plus size={14} />
          New Session
          <span className="btn-kbd">⌘T</span>
        </button>

        <div style={shortcutsStyle}>
          {SHORTCUTS.map(({ keys, label }) => (
            <React.Fragment key={label}>
              <span style={{ justifySelf: 'end' }}>
                <Keys keys={keys} />
              </span>
              <span>{label}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The app icon's prompt glyph in the theme's accent, stacked like the sessions it runs. */
function ChorusMark(): React.ReactElement {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true" style={{ marginBottom: 18 }}>
      <rect x="14" y="4" width="44" height="44" rx="11" fill="var(--bg-surface)" opacity="0.5" />
      <rect x="9" y="10" width="54" height="50" rx="12" fill="var(--bg-surface)" opacity="0.8" />
      <rect
        x="4.5"
        y="16.5"
        width="63"
        height="51"
        rx="13"
        fill="var(--bg-elevated)"
        stroke="rgba(var(--tint-rgb), 0.12)"
      />
      <path
        d="M21 33l9 8-9 8"
        stroke="var(--accent-primary)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M36 50h15" stroke="var(--accent-primary)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background:
    'radial-gradient(640px circle at 50% 38%, rgba(var(--accent-rgb), 0.05), transparent 65%), var(--bg-terminal)',
  overflow: 'auto',
};

const contentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: 32,
  animation: 'popIn 320ms var(--ease-out)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'var(--text-primary)',
};

const taglineStyle: React.CSSProperties = {
  margin: '6px 0 24px',
  fontSize: 13,
  color: 'var(--text-secondary)',
};

const shortcutsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto auto',
  alignItems: 'center',
  columnGap: 14,
  rowGap: 10,
  marginTop: 36,
  paddingTop: 24,
  borderTop: '1px solid var(--border-subtle)',
  fontSize: 11,
  color: 'var(--text-dimmed)',
};
