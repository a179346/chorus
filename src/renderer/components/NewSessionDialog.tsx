import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PrRef } from '../../shared/types';
import { prLabel, prUrl } from '../../shared/pr-ref';
import { invoke, IpcChannels } from '../ipc';
import { basename } from '../session-presentation';
import { readPrDraft } from '../pr-draft';
import { TOGGLE_LABELS, customFlagText, readCustomFlags, readToggles, toggleFlags } from '../session-flags';
import { useModalKeys } from '../use-modal-keys';
import type { NewSessionInput } from '../use-sessions';
import { PrIdentity, PrRemoveButton, PrUrlInput } from './PrLinks';

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (config: NewSessionInput) => void;
}

export function NewSessionDialog({ open, onClose, onSubmit }: NewSessionDialogProps): React.ReactElement | null {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [worktree, setWorktree] = useState('');
  const [prs, setPrs] = useState<PrRef[]>([]);
  const [prDraft, setPrDraft] = useState('');
  const [prompt, setPrompt] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [chrome, setChrome] = useState(false);
  const [customFlags, setCustomFlags] = useState('');
  const [notifyOnIdle, setNotifyOnIdle] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Load defaults
    void invoke(IpcChannels.APP_GET_NEW_SESSION_DEFAULTS).then((defaults) => {
      setCwd(defaults.cwd || '');
      const toggles = readToggles(defaults.flags);
      setAutoMode(toggles.autoMode);
      setSkipPermissions(toggles.skipPermissions);
      setChrome(toggles.chrome);
      setCustomFlags(customFlagText(defaults.flags));
      setNotifyOnIdle(defaults.notifyOnIdle ?? false);
    });
    void invoke(IpcChannels.APP_GET_STATE).then((state) => {
      setFavorites(state.favoriteDirectories);
    });
    setName('');
    setWorktree('');
    setPrs([]);
    setPrDraft('');
    setPrompt('');
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  const dialogRef = useRef<HTMLDivElement>(null);

  useModalKeys(dialogRef, onClose, open);

  const handleSelectDir = useCallback(async () => {
    const dir = await invoke(IpcChannels.DIALOG_SELECT_DIRECTORY);
    if (dir) setCwd(dir);
  }, []);

  const isFavorite = favorites.includes(cwd.trim());

  const saveFavorites = useCallback((next: string[]) => {
    setFavorites(next);
    void invoke(IpcChannels.APP_SAVE_STATE, { favoriteDirectories: next });
  }, []);

  const toggleFavorite = useCallback(() => {
    const dir = cwd.trim();
    if (!dir) return;
    saveFavorites(
      favorites.includes(dir) ? favorites.filter((f) => f !== dir) : [...favorites, dir],
    );
  }, [cwd, favorites, saveFavorites]);

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleFavoriteDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = favorites.indexOf(String(active.id));
      const newIndex = favorites.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = [...favorites];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      saveFavorites(reordered);
    },
    [favorites, saveFavorites],
  );

  // A URL still sitting in the field counts as added when the form is submitted
  const pendingPr = useMemo(() => readPrDraft(prDraft, prs), [prDraft, prs]);
  const customFlagsDraft = useMemo(() => readCustomFlags(customFlags), [customFlags]);
  const canSubmit =
    !!name.trim() && !!cwd.trim() && pendingPr.kind !== 'invalid' && customFlagsDraft.kind === 'ok';

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit || customFlagsDraft.kind !== 'ok') return;
      const allPrs = pendingPr.kind === 'ok' ? [...prs, pendingPr.pr] : prs;
      onSubmit({
        name: name.trim(),
        cwd: cwd.trim(),
        worktree: worktree.trim(),
        flags: [...toggleFlags({ autoMode, skipPermissions, chrome }), ...customFlagsDraft.args],
        notifyOnIdle,
        prUrls: allPrs.map(prUrl),
        prompt: prompt.trim(),
      });
    },
    [canSubmit, name, cwd, worktree, autoMode, skipPermissions, chrome, customFlagsDraft, notifyOnIdle, prs, pendingPr, prompt, onSubmit]
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
              <button
                type="button"
                style={{
                  ...browseButtonStyle,
                  padding: '7px 9px',
                  color: isFavorite ? 'var(--accent-primary)' : 'var(--text-dimmed)',
                }}
                onClick={toggleFavorite}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                {isFavorite ? '★' : '☆'}
              </button>
              <button type="button" style={browseButtonStyle} onClick={handleSelectDir}>
                Browse
              </button>
            </div>
            {favorites.length > 0 && (
              <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleFavoriteDragEnd}>
                <SortableContext items={favorites} strategy={rectSortingStrategy}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                    {favorites.map((dir) => (
                      <FavoriteChip
                        key={dir}
                        dir={dir}
                        selected={dir === cwd.trim()}
                        onSelect={() => setCwd(dir)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
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

          {/* Pull requests */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Pull Requests <span style={{ color: 'var(--text-dimmed)', fontWeight: 400 }}>(optional)</span></label>
            {prs.map((pr) => (
              <div key={prLabel(pr)} style={prRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <PrIdentity pr={pr} />
                </div>
                <PrRemoveButton pr={pr} onRemove={() => setPrs(prs.filter((p) => p !== pr))} />
              </div>
            ))}
            <PrUrlInput
              value={prDraft}
              onChange={setPrDraft}
              linked={prs}
              onAdd={(pr) => {
                setPrs([...prs, pr]);
                setPrDraft('');
              }}
            />
          </div>

          {/* Initial prompt */}
          <div style={fieldStyle}>
            <label htmlFor="new-session-prompt" style={labelStyle}>
              Prompt <span style={{ color: 'var(--text-dimmed)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              id="new-session-prompt"
              style={textareaStyle}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !e.metaKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }}
              placeholder="What should Claude work on?"
              rows={3}
            />
            <span style={hintStyle}>Sent when the session starts · ⌘↵ to create</span>
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
              {TOGGLE_LABELS.autoMode}
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                ...checkboxStyle,
                background: skipPermissions ? 'var(--status-error, #e53e3e)' : 'var(--bg-surface)',
                borderColor: skipPermissions ? 'var(--status-error, #e53e3e)' : 'var(--border-default)',
              }}
              onClick={() => setSkipPermissions(!skipPermissions)}
            >
              {skipPermissions && <span style={{ fontSize: 10, lineHeight: 1 }}>✓</span>}
            </div>
            <label
              style={{ fontSize: 11, color: skipPermissions ? 'var(--status-error, #e53e3e)' : 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setSkipPermissions(!skipPermissions)}
            >
              {TOGGLE_LABELS.skipPermissions}
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
              {TOGGLE_LABELS.chrome}
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

          {/* Additional flags */}
          <div style={fieldStyle}>
            <label htmlFor="new-session-flags" style={labelStyle}>
              Additional Flags <span style={{ color: 'var(--text-dimmed)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="new-session-flags"
              style={{
                ...inputStyle,
                borderColor: customFlagsDraft.kind === 'invalid' ? 'var(--status-error, #e53e3e)' : 'var(--border-default)',
              }}
              value={customFlags}
              onChange={(e) => setCustomFlags(e.target.value)}
              placeholder={`--model opus --allowed-tools "Bash(git *)"`}
              spellCheck={false}
              aria-invalid={customFlagsDraft.kind === 'invalid'}
            />
            {customFlagsDraft.kind === 'invalid' && (
              <span style={{ ...hintStyle, color: 'var(--status-error, #e53e3e)' }}>{customFlagsDraft.error}</span>
            )}
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
                opacity: canSubmit ? 1 : 0.4,
              }}
              disabled={!canSubmit}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface FavoriteChipProps {
  dir: string;
  selected: boolean;
  onSelect: () => void;
}

/** Draggable favorite-directory chip: click selects, drag reorders. */
function FavoriteChip({ dir, selected, onSelect }: FavoriteChipProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dir,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{
        ...favoriteChipStyle,
        borderColor: selected ? 'var(--accent-primary)' : 'var(--border-default)',
        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1 : 0,
      }}
      title={dir}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {basename(dir)}
    </button>
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
  maxHeight: '90vh',
  overflowY: 'auto',
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

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 54,
  lineHeight: 1.5,
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-dimmed)',
};

const prRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 4px 3px 8px',
  borderRadius: 'var(--radius-md)',
  background: 'rgba(var(--tint-rgb), 0.04)',
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

const favoriteChipStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px 8px',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  transition: 'all var(--transition-fast)',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
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
