import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PrRef, Session } from '../../shared/types';
import { prLabel, prUrl } from '../../shared/pr-ref';
import { STAGE_ICON } from '../session-presentation';
import { ipcErrorMessage } from '../ipc';
import { PrIdentity, PrRemoveButton, PrUrlInput, openPrInBrowser, usePrRemovalFocus } from './PrLinks';
import { Dialog } from './Dialog';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const removalFocus = usePrRemovalFocus(session.prs, inputRef);

  useEffect(() => {
    inputRef.current?.focus();
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
    removalFocus.willRemove(pr);
    try {
      await onUnlink(pr);
    } catch (err) {
      removalFocus.cancel();
      setError(ipcErrorMessage(err));
    }
  };

  return (
    <Dialog
      title={
        <>
          Pull Requests
          <span style={{ color: 'var(--text-dimmed)', fontWeight: 400 }}> · {session.name}</span>
        </>
      }
      label={`Pull requests for ${session.name}`}
      onClose={onClose}
      width={460}
    >
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
                  className="icon-btn"
                  onClick={() => openPrInBrowser(pr)}
                  title={openLabel}
                  aria-label={openLabel}
                >
                  <ExternalLink size={12} />
                </button>
                <PrRemoveButton
                  pr={pr}
                  buttonRef={removalFocus.removeButtonRef(pr)}
                  onRemove={() => void handleRemove(pr)}
                />
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

      <div className="dialog-actions" style={{ marginTop: 18 }}>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

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

