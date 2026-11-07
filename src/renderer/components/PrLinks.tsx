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
    <button type="button" style={iconButtonStyle} onClick={onRemove} title={label} aria-label={label}>
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
          style={{
            ...inputStyle,
            borderColor: draft.kind === 'invalid' ? 'var(--status-error, #e53e3e)' : 'var(--border-default)',
          }}
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
        />
        <button
          type="button"
          style={{ ...addButtonStyle, opacity: draft.kind === 'ok' ? 1 : 0.4 }}
          disabled={draft.kind !== 'ok'}
          onClick={add}
        >
          Add
        </button>
      </div>
      {message && (
        <span
          style={{
            fontSize: 10,
            color: draft.kind === 'duplicate' ? 'var(--text-dimmed)' : 'var(--status-error, #e53e3e)',
          }}
        >
          {message}
        </span>
      )}
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

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 10px',
  fontSize: 12,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  transition: 'border-color var(--transition-fast)',
};

const addButtonStyle: React.CSSProperties = {
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

export const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  flexShrink: 0,
  padding: 0,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-dimmed)',
  cursor: 'pointer',
  transition: 'color var(--transition-fast), background var(--transition-fast)',
};
