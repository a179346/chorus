import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Ellipsis,
  GitPullRequest,
  GitCommitHorizontal,
  Terminal,
  Code,
  Server,
  Package,
  Rocket,
  Bug,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ToolkitCommand } from '../../shared/types';

interface ToolkitPanelProps {
  commands: ToolkitCommand[];
  onExecute: (commandId: string) => void;
  onAdd: (command: Omit<ToolkitCommand, 'id'>) => void;
  onUpdate: (command: ToolkitCommand) => void;
  onDelete: (commandId: string) => void;
}

// ─── Icon options for the command form ────────────────────
const ICON_MAP: Record<string, LucideIcon> = {
  'git-pull-request': GitPullRequest,
  'git-commit': GitCommitHorizontal,
  'terminal': Terminal,
  'code': Code,
  'server': Server,
  'package': Package,
  'rocket': Rocket,
  'bug': Bug,
  'wrench': Wrench,
  'zap': Zap,
};

const ICON_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'git-pull-request', label: 'PR' },
  { value: 'git-commit', label: 'Commit' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'code', label: 'Code' },
  { value: 'server', label: 'Server' },
  { value: 'package', label: 'Package' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'bug', label: 'Bug' },
  { value: 'wrench', label: 'Wrench' },
  { value: 'zap', label: 'Zap' },
];

function IconComponent({ icon, size = 12 }: { icon: string; size?: number }): React.ReactElement | null {
  const Comp = ICON_MAP[icon];
  if (!Comp) return null;
  return <Comp size={size} />;
}

export function ToolkitPanel({ commands, onExecute, onAdd, onUpdate, onDelete }: ToolkitPanelProps): React.ReactElement {
  const [editingCommand, setEditingCommand] = useState<ToolkitCommand | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; commandId: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, commandId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, commandId });
  }, []);

  const handleMenuAction = useCallback((action: 'edit' | 'delete') => {
    if (!contextMenu) return;
    const { commandId } = contextMenu;
    setContextMenu(null);
    if (action === 'edit') {
      const cmd = commands.find((c) => c.id === commandId);
      if (cmd) setEditingCommand(cmd);
    } else {
      setDeleteConfirm(commandId);
    }
  }, [contextMenu, commands]);

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirm) {
      onDelete(deleteConfirm);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, onDelete]);

  const handleFormSubmit = useCallback((data: { label: string; command: string; icon: string }) => {
    if (editingCommand) {
      onUpdate({ ...editingCommand, ...data });
      setEditingCommand(null);
    } else {
      onAdd(data);
      setShowAddForm(false);
    }
  }, [editingCommand, onAdd, onUpdate]);

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dimmed)' }}>
          Toolkit
        </span>
        <button
          style={addButtonStyle}
          onClick={() => setShowAddForm(true)}
          title="Add command"
        >
          +
        </button>
      </div>

      {/* Command grid */}
      <div style={gridStyle}>
        {commands.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-dimmed)', fontSize: 11, padding: 16 }}>
            No commands configured.
            <br />
            <span
              style={{ color: 'var(--accent-blue)', cursor: 'pointer' }}
              onClick={() => setShowAddForm(true)}
            >
              Add one
            </span>
          </div>
        ) : (
          commands.map((cmd) => (
            <ToolkitButton
              key={cmd.id}
              command={cmd}
              onExecute={onExecute}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            ...ctxMenuStyle,
            left: Math.max(4, Math.min(contextMenu.x, window.innerWidth - 140)),
            top: Math.max(4, Math.min(contextMenu.y, window.innerHeight - 80)),
          }}
        >
          <div role="menuitem" tabIndex={0} style={ctxMenuItemStyle} onClick={() => handleMenuAction('edit')}>
            Edit
          </div>
          <div style={ctxMenuDividerStyle} />
          <div
            role="menuitem"
            tabIndex={0}
            style={{ ...ctxMenuItemStyle, color: 'var(--accent-red)' }}
            onClick={() => handleMenuAction('delete')}
          >
            Delete
          </div>
        </div>
      )}

      {/* Add / Edit form dialog */}
      {(showAddForm || editingCommand) && (
        <CommandFormDialog
          initial={editingCommand}
          onSubmit={handleFormSubmit}
          onClose={() => { setShowAddForm(false); setEditingCommand(null); }}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <DeleteConfirmDialog
          commandLabel={commands.find((c) => c.id === deleteConfirm)?.label ?? 'this command'}
          onConfirm={handleConfirmDelete}
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
  onContextMenu: (e: React.MouseEvent, commandId: string) => void;
}

function ToolkitButton({ command, onExecute, onContextMenu }: ToolkitButtonProps & { onDelete?: (commandId: string) => void }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
    >
      <button
        style={{
          ...buttonStyle,
          width: '100%',
          background: pressed
            ? 'var(--bg-active)'
            : hovered
              ? 'var(--bg-hover)'
              : 'var(--bg-surface)',
          borderColor: hovered ? 'var(--border-default)' : 'var(--border-subtle)',
          transform: pressed ? 'scale(0.97)' : undefined,
        }}
        onClick={() => onExecute(command.id)}
        onContextMenu={(e) => onContextMenu(e, command.id)}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        title={command.command}
      >
        {command.icon && (
          <span style={{ display: 'flex', marginRight: 4, opacity: 0.7 }}>
            <IconComponent icon={command.icon} size={12} />
          </span>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {command.label}
        </span>
      </button>
      {hovered && (
        <button
          style={closeBtnStyle}
          onClick={(e) => { e.stopPropagation(); onContextMenu(e as any, command.id); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, command.id); }}
          title="Edit / Delete"
        >
          <Ellipsis size={12} />
        </button>
      )}
    </div>
  );
}

// ─── Command Form Dialog (Add / Edit) ────────────────────

interface CommandFormDialogProps {
  initial: ToolkitCommand | null;
  onSubmit: (data: { label: string; command: string; icon: string }) => void;
  onClose: () => void;
}

function CommandFormDialog({ initial, onSubmit, onClose }: CommandFormDialogProps): React.ReactElement {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '');
  const labelRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => labelRef.current?.focus(), 50);
  }, []);

  // Focus trap + Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'input, select, button, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !command.trim()) return;
    onSubmit({ label: label.trim(), command: command.trim(), icon });
  };

  const isValid = label.trim() && command.trim();

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div ref={dialogRef} style={dialogStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={initial ? 'Edit Command' : 'Add Command'}>
        <div style={titleStyle}>{initial ? 'Edit Command' : 'Add Command'}</div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Label */}
          <div style={fieldStyle}>
            <label style={formLabelStyle}>Label</label>
            <input
              ref={labelRef}
              style={inputStyle}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Create PR"
            />
          </div>

          {/* Command */}
          <div style={fieldStyle}>
            <label style={formLabelStyle}>Command</label>
            <input
              style={inputStyle}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. /pr"
            />
          </div>

          {/* Icon */}
          <div style={fieldStyle}>
            <label style={formLabelStyle}>Icon</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  title={opt.label}
                  onClick={() => setIcon(opt.value)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${icon === opt.value ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                    background: icon === opt.value ? 'rgba(var(--accent-rgb), 0.12)' : 'var(--bg-surface)',
                    color: icon === opt.value ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 10,
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  {opt.value ? <IconComponent icon={opt.value} size={14} /> : '—'}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" style={cancelBtnStyle} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...submitBtnStyle, opacity: isValid ? 1 : 0.4 }}
              disabled={!isValid}
            >
              {initial ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Dialog ──────────────────────────

interface DeleteConfirmDialogProps {
  commandLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({ commandLabel, onConfirm, onCancel }: DeleteConfirmDialogProps): React.ReactElement {
  const deleteBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setTimeout(() => deleteBtnRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={{ ...dialogStyle, width: 340 }} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Delete command">
        <div style={titleStyle}>Delete Command</div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 18px' }}>
          Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>{commandLabel}</strong>? This action cannot be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={cancelBtnStyle} onClick={onCancel}>Cancel</button>
          <button ref={deleteBtnRef} style={deleteBtnStyle} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
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

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 14px',
  borderTop: '1px solid var(--border-subtle)',
  flexShrink: 0,
};

const addButtonStyle: React.CSSProperties = {
  marginLeft: 'auto',
  width: 22,
  height: 22,
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'var(--bg-hover)',
  color: 'var(--text-secondary)',
  fontSize: 15,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all var(--transition-fast)',
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

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '7px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  fontSize: 11,
  fontWeight: 500,
  fontFamily: 'var(--font-ui)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'all var(--transition-fast)',
  lineHeight: 1.3,
};

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: -6,
  right: -6,
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-dimmed)',
  fontSize: 9,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
};

const ctxMenuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-lg)',
  padding: '4px 0',
  minWidth: 120,
};

const ctxMenuItemStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  cursor: 'pointer',
  color: 'var(--text-primary)',
  transition: 'background var(--transition-fast)',
};

const ctxMenuDividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--border-subtle)',
  margin: '4px 0',
};

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
  width: 380,
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

const formLabelStyle: React.CSSProperties = {
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

const cancelBtnStyle: React.CSSProperties = {
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

const submitBtnStyle: React.CSSProperties = {
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

const deleteBtnStyle: React.CSSProperties = {
  padding: '7px 20px',
  borderRadius: 'var(--radius-md)',
  fontSize: 11,
  fontWeight: 600,
  color: '#fff',
  background: 'var(--accent-red)',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  transition: 'all var(--transition-fast)',
};
