import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PrRef, Session } from '../../shared/types';
import { prLabel, prUrl } from '../../shared/pr-ref';
import { STAGE_ICON } from '../session-presentation';
import { ipcErrorMessage } from '../ipc';
import { useModalKeys } from '../use-modal-keys';
import { PrIdentity, PrRemoveButton, PrUrlInput, iconButtonStyle, openPrInBrowser } from './PrLinks';

interface PullRequestsDialogProps {
  session: Session;
  onLink: (url: string) => Promise<unknown>;
  onUnlink: (pr: PrRef) => Promise<unknown>;
  onClose: () => void;
}

/** Lists a session's linked PRs and lets the user open, unlink, or add them. */
export function PullRequestsDialog({ session, onLink, onUnlink, onClose }: PullRequestsDialogProps): React.ReactElement {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useModalKeys(dialogRef, onClose);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleAdd = async (pr: PrRef) => {
    setError(null);
    try {
      await onLink(prUrl(pr));
      setDraft('');
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const handleRemove = async (pr: PrRef) => {
    setError(null);
    try {
      await onUnlink(pr);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        ref={dialogRef}
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Pull requests for ${session.name}`}
      >
        <div style={titleStyle}>
          Pull Requests
          <span style={{ color: 'var(--text-dimmed)', fontWeight: 400 }}> · {session.name}</span>
        </div>

        {session.prs.length === 0 ? (
          <p style={emptyStyle}>No pull requests linked yet. PRs Claude creates in this session are linked automatically.</p>
        ) : (
          <ul style={listStyle}>
            {session.prs.map((pr) => {
              const openLabel = `Open ${prLabel(pr)} on GitHub`;
              return (
                <li key={prLabel(pr)} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PrIdentity pr={pr} stage={pr.stage} />
                  </div>
                  <span style={{ ...stageLabelStyle, color: STAGE_ICON[pr.stage].color }}>
                    {STAGE_ICON[pr.stage].label}
                  </span>
                  <button
                    type="button"
                    style={iconButtonStyle}
                    onClick={() => openPrInBrowser(pr)}
                    title={openLabel}
                    aria-label={openLabel}
                  >
                    <ExternalLink size={12} />
                  </button>
                  <PrRemoveButton pr={pr} onRemove={() => void handleRemove(pr)} />
                </li>
              );
            })}
          </ul>
        )}

        <PrUrlInput
          inputRef={inputRef}
          value={draft}
          onChange={(value) => {
            setDraft(value);
            setError(null);
          }}
          linked={session.prs}
          onAdd={(pr) => void handleAdd(pr)}
          error={error}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" style={doneButtonStyle} onClick={onClose}>
            Done
          </button>
        </div>
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
  width: 460,
  maxWidth: '90vw',
  animation: 'slideUp 200ms ease',
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 14,
  letterSpacing: '0.02em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const emptyStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dimmed)',
  lineHeight: 1.6,
  margin: '0 0 12px',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '0 0 12px',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 240,
  overflowY: 'auto',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 4px 4px 8px',
  borderRadius: 'var(--radius-md)',
  background: 'rgba(var(--tint-rgb), 0.04)',
};

const stageLabelStyle: React.CSSProperties = {
  fontSize: 10,
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

const doneButtonStyle: React.CSSProperties = {
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
