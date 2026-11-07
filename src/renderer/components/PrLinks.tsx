import React from 'react';
import { X } from 'lucide-react';
import type { PrRef, PrStage } from '../../shared/types';
import { prLabel, prUrl } from '../../shared/pr-ref';
import { STAGE_ICON } from '../session-presentation';
import { readPrDraft } from '../pr-draft';
import { invoke, IpcChannels } from '../ipc';

// Building blocks for showing and editing a session's linked PRs, shared by
// the sidebar, the status bar, and the New Session / Pull Requests dialogs.

export function openPrInBrowser(pr: PrRef): void {
  void invoke(IpcChannels.SHELL_OPEN_EXTERNAL, { url: prUrl(pr) });
}

interface PrIdentityProps {
  pr: PrRef;
  /** 'unknown' (the default) also suits a PR that isn't linked yet. */
  stage?: PrStage;
}

/** Stage icon + "owner/repo #123"; the repo part truncates first. */
export function PrIdentity({ pr, stage = 'unknown' }: PrIdentityProps): React.ReactElement {
  const { Icon, color } = STAGE_ICON[stage];
  return (
    <span style={identityStyle}>
      <Icon size={13} style={{ color, flexShrink: 0 }} />
      <span style={repoStyle}>{pr.owner}/{pr.repo}</span>
      <span style={numberStyle}>#{pr.number}</span>
    </span>
  );
}

interface PrRemoveButtonProps {
  pr: PrRef;
  onRemove: () => void;
}

export function PrRemoveButton({ pr, onRemove }: PrRemoveButtonProps): React.ReactElement {
  const label = `Remove ${prLabel(pr)}`;
  return (
    <button type="button" className="icon-btn" onClick={onRemove} title={label} aria-label={label}>
      <X size={12} />
    </button>
  );
}

const INVALID_URL_MESSAGE = 'Expected a GitHub PR URL like https://github.com/owner/repo/pull/123';

interface PrUrlInputProps {
  value: string;
  onChange: (value: string) => void;
  /** PRs already listed; entering one of them again is flagged instead of added. */
  linked: readonly PrRef[];
  onAdd: (pr: PrRef) => void;
  /** A failure from outside the field, e.g. main rejecting the link. */
  error?: string | null;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** URL field + Add button. Enter adds; on an empty field Enter falls through (e.g. to submit a form). */
export function PrUrlInput({ value, onChange, linked, onAdd, error, inputRef }: PrUrlInputProps): React.ReactElement {
  const draft = readPrDraft(value, linked);
  const message =
    draft.kind === 'invalid' ? INVALID_URL_MESSAGE : draft.kind === 'duplicate' ? 'Already linked' : error;

  const add = () => {
    if (draft.kind === 'ok') onAdd(draft.pr);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          ref={inputRef}
          className="input"
          style={{ flex: 1 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || draft.kind === 'empty') return;
            e.preventDefault();
            add();
          }}
          placeholder="https://github.com/owner/repo/pull/123"
          aria-label="Pull request URL"
          aria-invalid={draft.kind === 'invalid'}
          spellCheck={false}
        />
        <button type="button" className="btn" disabled={draft.kind !== 'ok'} onClick={add}>
          Add
        </button>
      </div>
      {message && <span className={draft.kind === 'duplicate' ? 'field-hint' : 'field-error'}>{message}</span>}
    </div>
  );
}

const identityStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
};

const repoStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const numberStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  flexShrink: 0,
};
