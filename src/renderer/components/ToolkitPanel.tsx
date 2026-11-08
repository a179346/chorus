import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ToolkitCommand } from '../../shared/types';
import { useAsyncSubmit } from '../use-async-submit';
import { Dialog, ConfirmDialog } from './Dialog';
import { Menu, MenuItem, MenuDivider } from './Menu';
import { ICON_OPTIONS, ToolkitIcon } from './ToolkitIcon';

interface ToolkitPanelProps {
  commands: ToolkitCommand[];
  onExecute: (commandId: string) => void;
  // These reject when main refuses the edit (e.g. toolkit.json can't be read); the open dialog shows why
  onAdd: (command: Omit<ToolkitCommand, 'id'>) => Promise<void>;
  onUpdate: (command: ToolkitCommand) => Promise<void>;
  onDelete: (commandId: string) => Promise<void>;
}

/** The open add or edit form. */
interface CommandForm {
  /** Tells openings apart, so each one starts from a fresh form. */
  key: number;
  /** The command being edited; null when adding one. */
  editing: ToolkitCommand | null;
}

export function ToolkitPanel({ commands, onExecute, onAdd, onUpdate, onDelete }: ToolkitPanelProps): React.ReactElement {
  const [form, setForm] = useState<CommandForm | null>(null);
  const formOpeningsRef = useRef(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; commandId: string } | null>(null);
  // The "…" button the open menu hangs from; none for a right-click menu
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  /** One form at a time: opening another while one is open keeps that one. */
  const openForm = useCallback((editing: ToolkitCommand | null) => {
    const key = ++formOpeningsRef.current;
    setForm((current) => current ?? { key, editing });
  }, []);

  const closeForm = useCallback(() => setForm(null), []);

  const openMenuAt = useCallback((commandId: string, x: number, y: number) => {
    menuAnchorRef.current = null;
    setContextMenu({ x, y, commandId });
  }, []);

  const toggleMenuFrom = useCallback((commandId: string, button: HTMLElement) => {
    if (contextMenu && menuAnchorRef.current === button) {
      setContextMenu(null);
      return;
    }
    menuAnchorRef.current = button;
    // Anchored to the button: a keyboard press has no pointer position
    const rect = button.getBoundingClientRect();
    setContextMenu({ x: rect.left, y: rect.bottom + 4, commandId });
  }, [contextMenu]);

  const handleMenuAction = useCallback((action: 'edit' | 'delete') => {
    if (!contextMenu) return;
    const { commandId } = contextMenu;
    setContextMenu(null);
    if (action === 'edit') {
      const cmd = commands.find((c) => c.id === commandId);
      if (cmd) openForm(cmd);
    } else {
      setDeleteConfirm(commandId);
    }
  }, [contextMenu, commands, openForm]);

  const deleteCommand = useCallback(async (commandId: string) => {
    await onDelete(commandId);
    // Only its own confirm: a later one for another command stays open
    setDeleteConfirm((current) => (current === commandId ? null : current));
  }, [onDelete]);

  const submitForm = useCallback(async (submitted: CommandForm, data: { label: string; command: string; icon: string }) => {
    if (submitted.editing) await onUpdate({ ...submitted.editing, ...data });
    else await onAdd(data);
    // Only its own form: one opened since stays open
    setForm((current) => (current?.key === submitted.key ? null : current));
  }, [onAdd, onUpdate]);

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div className="panel-header">
        <span className="panel-title">Toolkit</span>
        <button
          type="button"
          className="icon-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => openForm(null)}
          title="Add command"
          aria-label="Add command"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Command grid */}
      <div style={gridStyle}>
        {commands.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-dimmed)', fontSize: 11, padding: 16, lineHeight: 1.5, textAlign: 'center' }}>
            Save prompts and commands you use often — one click types them into the current session.
            <button type="button" className="btn" onClick={() => openForm(null)}>
              <Plus size={12} />
              Add Command
            </button>
          </div>
        ) : (
          commands.map((cmd) => (
            <ToolkitButton
              key={cmd.id}
              command={cmd}
              onExecute={onExecute}
              onOpenMenu={openMenuAt}
              onToggleMenu={toggleMenuFrom}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <Menu x={contextMenu.x} y={contextMenu.y} anchorRef={menuAnchorRef} onClose={closeMenu}>
          <MenuItem icon={<Pencil size={13} />} onSelect={() => handleMenuAction('edit')}>
            Edit…
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={<Trash2 size={13} />} danger onSelect={() => handleMenuAction('delete')}>
            Delete…
          </MenuItem>
        </Menu>
      )}

      {/* Add / Edit form dialog */}
      {form && (
        <CommandFormDialog
          key={form.key}
          initial={form.editing}
          onSubmit={(data) => submitForm(form, data)}
          onClose={closeForm}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <ConfirmDialog
          key={deleteConfirm}
          title="Delete Command"
          message={
            <>
              Delete <strong>{commands.find((c) => c.id === deleteConfirm)?.label ?? 'this command'}</strong>? This can't be undone.
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => deleteCommand(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── Toolkit Button ──────────────────────────────────────

interface ToolkitButtonProps {
  command: ToolkitCommand;
  onExecute: (commandId: string) => void;
  onOpenMenu: (commandId: string, x: number, y: number) => void;
  onToggleMenu: (commandId: string, button: HTMLElement) => void;
}

function ToolkitButton({ command, onExecute, onOpenMenu, onToggleMenu }: ToolkitButtonProps): React.ReactElement {
  return (
    <div className="toolkit-item" style={{ position: 'relative' }}>
      <button
        type="button"
        className="toolkit-btn"
        onClick={() => onExecute(command.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu(command.id, e.clientX, e.clientY);
        }}
        title={command.command}
      >
        {command.icon && (
          <span style={{ display: 'flex', opacity: 0.7 }}>
            <ToolkitIcon icon={command.icon} size={12} />
          </span>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {command.label}
        </span>
      </button>
      <button
        type="button"
        className="toolkit-more"
        onClick={(e) => onToggleMenu(command.id, e.currentTarget)}
        title="Edit or delete"
        aria-label={`Edit or delete ${command.label}`}
      >
        <Ellipsis size={10} />
      </button>
    </div>
  );
}

// ─── Command Form Dialog (Add / Edit) ────────────────────

interface CommandFormDialogProps {
  initial: ToolkitCommand | null;
  /** Closes the dialog on success; rejects when the edit was refused, and the dialog says why. */
  onSubmit: (data: { label: string; command: string; icon: string }) => Promise<void>;
  onClose: () => void;
}

function CommandFormDialog({ initial, onSubmit, onClose }: CommandFormDialogProps): React.ReactElement {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '');
  const labelRef = useRef<HTMLInputElement>(null);
  const { run: submit, pending: submitting, error, clearError } = useAsyncSubmit(onSubmit);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  // An error describes the values that were submitted; any edit makes it stale
  useEffect(() => {
    clearError();
  }, [label, command, icon, clearError]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!label.trim() || !command.trim()) return;
    void submit({ label: label.trim(), command: command.trim(), icon });
  };

  // A pending save belongs to this form: let it finish so its result
  // (closing, or an error) can't land on a later one
  const close = (): void => {
    if (!submitting) onClose();
  };

  const isValid = label.trim() && command.trim();
  const title = initial ? 'Edit Command' : 'Add Command';

  return (
    <Dialog title={title} label={title} onClose={close} width={400}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label htmlFor="toolkit-label" className="field-label">Label</label>
          <input
            id="toolkit-label"
            ref={labelRef}
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Create PR"
          />
        </div>

        <div className="field">
          <label htmlFor="toolkit-command" className="field-label">Command</label>
          <input
            id="toolkit-command"
            className="input"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g. /pr"
            spellCheck={false}
          />
          <span className="field-hint">Typed into the current session's Claude Code prompt.</span>
        </div>

        <div className="field">
          <span className="field-label">Icon</span>
          <div role="group" aria-label="Icon" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ICON_OPTIONS.map((opt) => {
              const selected = icon === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={selected}
                  aria-label={opt.label}
                  title={opt.label}
                  className="btn"
                  onClick={() => setIcon(opt.value)}
                  style={{
                    width: 30,
                    padding: 0,
                    borderColor: selected ? 'var(--accent-primary)' : undefined,
                    background: selected ? 'rgba(var(--accent-rgb), 0.12)' : undefined,
                    color: selected ? 'var(--accent-primary)' : undefined,
                  }}
                >
                  {opt.value ? <ToolkitIcon icon={opt.value} size={14} /> : '—'}
                </button>
              );
            })}
          </div>
        </div>

        {error && <span className="field-error" role="alert">{error}</span>}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close} aria-disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!isValid} aria-disabled={submitting}>
            {initial ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Styles ──────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  background: 'var(--bg-panel)',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 6,
  padding: 8,
  flex: 1,
  overflowY: 'auto',
  alignContent: 'start',
};

