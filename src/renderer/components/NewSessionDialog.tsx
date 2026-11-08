import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Star } from 'lucide-react';
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
import { invoke, ipcErrorMessage, IpcChannels } from '../ipc';
import { basename } from '../session-presentation';
import { readPrDraft } from '../pr-draft';
import { TOGGLE_LABELS, customFlagText, readCustomFlags, readToggles, toggleFlags } from '../session-flags';
import type { NewSessionInput } from '../use-sessions';
import { PrIdentity, PrRemoveButton, PrUrlInput, usePrRemovalFocus } from './PrLinks';
import { Dialog } from './Dialog';
import { Checkbox } from './Checkbox';

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  /** Resolves once the session exists; a rejection is shown in the dialog. */
  onSubmit: (config: NewSessionInput) => Promise<void>;
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
  // Creating can wait on the login-shell environment for many seconds
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const prInputRef = useRef<HTMLInputElement>(null);
  const prRemovalFocus = usePrRemovalFocus(prs, prInputRef);

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
    setSubmitting(false);
    setSubmitError(null);
    // Right away, so keys typed just after opening land here and not in a terminal
    nameRef.current?.focus();
  }, [open]);

  // An error describes the values that were submitted; any edit makes it stale
  useEffect(() => {
    setSubmitError(null);
  }, [name, cwd, worktree, prs, prDraft, prompt, autoMode, skipPermissions, chrome, customFlags, notifyOnIdle]);

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
    !submitting && !!name.trim() && !!cwd.trim() && pendingPr.kind !== 'invalid' && customFlagsDraft.kind === 'ok';

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit || customFlagsDraft.kind !== 'ok') return;
      const allPrs = pendingPr.kind === 'ok' ? [...prs, pendingPr.pr] : prs;
      setSubmitting(true);
      setSubmitError(null);
      try {
        await onSubmit({
          name: name.trim(),
          cwd: cwd.trim(),
          worktree: worktree.trim(),
          flags: [...toggleFlags({ autoMode, skipPermissions, chrome }), ...customFlagsDraft.args],
          notifyOnIdle,
          prUrls: allPrs.map(prUrl),
          prompt: prompt.trim(),
        });
      } catch (err) {
        setSubmitError(ipcErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, name, cwd, worktree, autoMode, skipPermissions, chrome, customFlagsDraft, notifyOnIdle, prs, pendingPr, prompt, onSubmit]
  );

  // A pending create belongs to this form: let it finish so its result
  // (closing, or an error) can't land on a later one
  const close = useCallback(() => {
    if (!submitting) onClose();
  }, [submitting, onClose]);

  if (!open) return null;

  return (
    <Dialog title="New Session" label="New Session" onClose={close} width={460}>
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !e.metaKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div className="field">
          <label htmlFor="new-session-name" className="field-label">Session Name</label>
          <input
            id="new-session-name"
            ref={nameRef}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-session"
          />
        </div>

        <div className="field">
          <label htmlFor="new-session-cwd" className="field-label">Working Directory</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              id="new-session-cwd"
              className="input"
              style={{ flex: 1 }}
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/Users/..."
              spellCheck={false}
            />
            <button
              type="button"
              className="btn"
              style={{ width: 32, padding: 0, color: isFavorite ? 'var(--accent-primary)' : undefined }}
              onClick={toggleFavorite}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFavorite}
            >
              <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className="btn" onClick={handleSelectDir}>
              Browse…
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

        <div className="field">
          <label htmlFor="new-session-worktree" className="field-label">
            Worktree <span className="field-optional">(optional)</span>
          </label>
          <input
            id="new-session-worktree"
            className="input"
            value={worktree}
            onChange={(e) => setWorktree(e.target.value)}
            placeholder="Leave empty to skip"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <span className="field-label">
            Pull Requests <span className="field-optional">(optional)</span>
          </span>
          {prs.map((pr) => (
            <div key={prLabel(pr)} style={prRowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <PrIdentity pr={pr} />
              </div>
              <PrRemoveButton
                pr={pr}
                buttonRef={prRemovalFocus.removeButtonRef(pr)}
                onRemove={() => {
                  prRemovalFocus.willRemove(pr);
                  setPrs(prs.filter((p) => p !== pr));
                }}
              />
            </div>
          ))}
          <PrUrlInput
            inputRef={prInputRef}
            value={prDraft}
            onChange={setPrDraft}
            linked={prs}
            onAdd={(pr) => {
              setPrs([...prs, pr]);
              setPrDraft('');
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="new-session-prompt" className="field-label">
            Prompt <span className="field-optional">(optional)</span>
          </label>
          <textarea
            id="new-session-prompt"
            className="input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should Claude work on?"
            rows={3}
          />
          <span className="field-hint">Sent as the first message when the session starts.</span>
        </div>

        <div style={optionsGridStyle}>
          <Checkbox checked={autoMode} onChange={setAutoMode}>{TOGGLE_LABELS.autoMode}</Checkbox>
          <Checkbox checked={notifyOnIdle} onChange={setNotifyOnIdle}>Notify when idle or waiting</Checkbox>
          <Checkbox checked={chrome} onChange={setChrome}>{TOGGLE_LABELS.chrome}</Checkbox>
          <Checkbox checked={skipPermissions} onChange={setSkipPermissions} tone="danger">
            {TOGGLE_LABELS.skipPermissions}
          </Checkbox>
        </div>

        <div className="field">
          <label htmlFor="new-session-flags" className="field-label">
            Additional Flags <span className="field-optional">(optional)</span>
          </label>
          <input
            id="new-session-flags"
            className="input"
            value={customFlags}
            onChange={(e) => setCustomFlags(e.target.value)}
            placeholder={`--model opus --allowed-tools "Bash(git *)"`}
            spellCheck={false}
            aria-invalid={customFlagsDraft.kind === 'invalid'}
          />
          {customFlagsDraft.kind === 'invalid' && <span className="field-error">{customFlagsDraft.error}</span>}
        </div>

        {submitError && <span className="field-error" role="alert">{submitError}</span>}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit} title="Create (⌘↵)">
            {submitting ? 'Creating…' : 'Create'}
            <span className="btn-kbd">⌘↵</span>
          </button>
        </div>
      </form>
    </Dialog>
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
      className="btn"
      style={{
        ...favoriteChipStyle,
        borderColor: selected ? 'var(--accent-primary)' : undefined,
        color: selected ? 'var(--text-primary)' : undefined,
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
      {/* .btn is a flex container, so the ellipsis needs a box of its own */}
      <span style={favoriteChipLabelStyle}>{basename(dir)}</span>
    </button>
  );
}

const prRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 4px 3px 8px',
  borderRadius: 'var(--radius-md)',
  background: 'rgba(var(--tint-rgb), 0.04)',
};

const favoriteChipStyle: React.CSSProperties = {
  height: 22,
  padding: '0 8px',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  maxWidth: '100%',
};

const favoriteChipLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const optionsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '10px 16px',
  padding: '12px 14px',
  borderRadius: 'var(--radius-md)',
  background: 'rgba(var(--tint-rgb), 0.03)',
  border: '1px solid var(--border-subtle)',
};
