import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { GitBranch, Bell, BellOff, Plus, ArrowRight, Pencil, GitPullRequest, RotateCcw, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { LinkedPr, Session } from '../../shared/types';
import { prLabel } from '../../shared/pr-ref';
import { STAGE_ICON, prTooltip, summaryStage, statusColor, statusLabel, basename, hasExited } from '../session-presentation';
import { countNeedingAttention } from '../use-sessions';
import { useCommandHeld } from '../use-command-held';
import { PrIdentity, openPrInBrowser } from './PrLinks';
import { Menu, MenuItem, MenuDivider } from './Menu';
import { StatusDot } from './StatusDot';
import { Keys } from './Kbd';

interface SessionListProps {
  sessions: Session[];
  /** Saved sessions aren't back yet, so an empty list doesn't mean there are none. */
  loading: boolean;
  activeSessionId: string | null;
  /** The session whose name is being edited in place, if any. */
  renamingSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onStartRename: (id: string) => void;
  onRenameSession: (id: string, newName: string) => void;
  onCancelRename: () => void;
  onEndSession: (id: string) => void;
  onRestartSession: (id: string) => void;
  onToggleNotify: (id: string) => void;
  onReorderSessions: (sessions: Session[]) => void;
  onManagePrs: (id: string) => void;
  onJumpToAttention: () => void;
}

/** The open menu: a right-click context menu, or the list of a session's PRs. */
type MenuState =
  | { kind: 'session'; x: number; y: number; sessionId: string | null }
  | { kind: 'prs'; x: number; y: number; sessionId: string };

/** ⌘1–⌘9 reach the first nine sessions. */
const INDEXED_SESSIONS = 9;

export function SessionList({
  sessions,
  loading,
  activeSessionId,
  renamingSessionId,
  onSelectSession,
  onNewSession,
  onStartRename,
  onRenameSession,
  onCancelRename,
  onEndSession,
  onRestartSession,
  onToggleNotify,
  onReorderSessions,
  onManagePrs,
  onJumpToAttention,
}: SessionListProps): React.ReactElement {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const commandHeld = useCommandHeld();
  const attentionCount = countNeedingAttention(sessions, activeSessionId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = sessions.findIndex((s) => s.id === active.id);
      const newIndex = sessions.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = [...sessions];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      onReorderSessions(reordered);
    },
    [sessions, onReorderSessions],
  );

  const openSessionMenu = useCallback((e: React.MouseEvent, sessionId: string | null) => {
    e.preventDefault();
    setMenu({ kind: 'session', x: e.clientX, y: e.clientY, sessionId });
  }, []);

  // One PR opens directly; several open a menu to pick from
  const handlePrSummaryClick = useCallback(
    (e: React.MouseEvent<HTMLElement>, session: Session) => {
      e.stopPropagation();
      if (session.prs.length === 1) {
        openPrInBrowser(session.prs[0]);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      setMenu({ kind: 'prs', x: rect.left, y: rect.bottom + 4, sessionId: session.id });
    },
    []
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  /** Close the menu, then act — so a dialog the action opens isn't fighting the menu for focus. */
  const runFromMenu = useCallback((action: () => void) => {
    setMenu(null);
    action();
  }, []);

  const menuSession = menu ? sessions.find((s) => s.id === menu.sessionId) ?? null : null;

  return (
    <div
      style={containerStyle}
      onContextMenu={(e) => {
        // Only show "New Session" menu when right-clicking empty area (not on a card)
        if (!(e.target instanceof Element && e.target.closest('[data-session-card]'))) {
          openSessionMenu(e, null);
        }
      }}
    >
      {/* Header */}
      <div className="panel-header">
        <span className="panel-title">Sessions</span>
        {sessions.length > 0 && <span style={countStyle}>{sessions.length}</span>}
        {attentionCount > 0 && (
          <button
            type="button"
            style={attentionPillStyle}
            onClick={onJumpToAttention}
            title="Jump to the next session needing attention (⌘J)"
          >
            {attentionCount} need{attentionCount === 1 ? 's' : ''} you
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          style={{ marginLeft: 'auto' }}
          onClick={onNewSession}
          title="New Session (⌘T)"
          aria-label="New Session"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Session cards */}
      <div style={listStyle}>
        {loading ? null : sessions.length === 0 ? (
          <div style={emptyStyle}>
            <span>No sessions yet</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Keys keys={['⌘', 'T']} /> to start one
            </span>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sessionIds} strategy={verticalListSortingStrategy}>
              {sessions.map((session, index) => (
                <SortableSessionCard
                  key={session.id}
                  session={session}
                  shortcutIndex={commandHeld && index < INDEXED_SESSIONS ? index + 1 : null}
                  isActive={session.id === activeSessionId}
                  isEditing={session.id === renamingSessionId}
                  onClick={() => onSelectSession(session.id)}
                  onContextMenu={(e) => openSessionMenu(e, session.id)}
                  onRenameCommit={(newName) => onRenameSession(session.id, newName)}
                  onRenameCancel={onCancelRename}
                  onToggleNotify={() => onToggleNotify(session.id)}
                  onPrSummaryClick={(e) => handlePrSummaryClick(e, session)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Holding ⌘ reveals the shortcuts the badges hint at */}
      {commandHeld && sessions.length > 0 && <ShortcutSheet />}

      {menu?.kind === 'session' && (
        <Menu x={menu.x} y={menu.y} onClose={closeMenu}>
          {menuSession ? (
            <SessionMenuItems
              session={menuSession}
              isActive={menuSession.id === activeSessionId}
              run={runFromMenu}
              onSelect={onSelectSession}
              onRename={onStartRename}
              onToggleNotify={onToggleNotify}
              onManagePrs={onManagePrs}
              onRestart={onRestartSession}
              onEnd={onEndSession}
            />
          ) : (
            <MenuItem icon={<Plus size={13} />} shortcut="⌘T" onSelect={() => runFromMenu(onNewSession)}>
              New Session
            </MenuItem>
          )}
        </Menu>
      )}

      {menu?.kind === 'prs' && menuSession && (
        <Menu x={menu.x} y={menu.y} width={260} label="Pull requests" onClose={closeMenu}>
          {menuSession.prs.map((pr) => (
            <MenuItem key={prLabel(pr)} title={prTooltip(pr)} onSelect={() => runFromMenu(() => openPrInBrowser(pr))}>
              <PrIdentity pr={pr} stage={pr.stage} />
            </MenuItem>
          ))}
          <MenuDivider />
          <MenuItem onSelect={() => runFromMenu(() => onManagePrs(menuSession.id))}>Manage Pull Requests…</MenuItem>
        </Menu>
      )}
    </div>
  );
}

// ─── Session context menu ─────────────────────────────────

interface SessionMenuItemsProps {
  session: Session;
  isActive: boolean;
  run: (action: () => void) => void;
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onToggleNotify: (id: string) => void;
  onManagePrs: (id: string) => void;
  onRestart: (id: string) => void;
  onEnd: (id: string) => void;
}

function SessionMenuItems({
  session,
  isActive,
  run,
  onSelect,
  onRename,
  onToggleNotify,
  onManagePrs,
  onRestart,
  onEnd,
}: SessionMenuItemsProps): React.ReactElement {
  const { id } = session;
  return (
    <>
      {!isActive && (
        <MenuItem icon={<ArrowRight size={13} />} onSelect={() => run(() => onSelect(id))}>
          Switch to Session
        </MenuItem>
      )}
      <MenuItem icon={<Pencil size={13} />} onSelect={() => run(() => onRename(id))}>
        Rename…
      </MenuItem>
      <MenuItem
        icon={session.notifyOnIdle ? <BellOff size={13} /> : <Bell size={13} />}
        onSelect={() => run(() => onToggleNotify(id))}
      >
        {session.notifyOnIdle ? 'Turn Off Notifications' : 'Turn On Notifications'}
      </MenuItem>
      <MenuItem icon={<GitPullRequest size={13} />} onSelect={() => run(() => onManagePrs(id))}>
        Pull Requests…
      </MenuItem>
      {hasExited(session) && (
        <MenuItem icon={<RotateCcw size={13} />} onSelect={() => run(() => onRestart(id))}>
          Restart Claude Code
        </MenuItem>
      )}
      <MenuDivider />
      <MenuItem icon={<X size={13} />} shortcut={isActive ? '⌘W' : undefined} danger onSelect={() => run(() => onEnd(id))}>
        End Session…
      </MenuItem>
    </>
  );
}

// ─── Session card ─────────────────────────────────────────

interface SessionCardProps {
  session: Session;
  /** The ⌘-number to show while ⌘ is held, or null. */
  shortcutIndex: number | null;
  isActive: boolean;
  isEditing: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameCommit: (newName: string) => void;
  onRenameCancel: () => void;
  onToggleNotify: () => void;
  onPrSummaryClick: (e: React.MouseEvent<HTMLElement>) => void;
}

function SortableSessionCard(props: SessionCardProps): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.session.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    position: 'relative',
    zIndex: isDragging ? 1 : 0,
    margin: '0 6px',
    borderRadius: 'var(--radius-md)',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-label={`${props.session.name} — ${statusLabel(props.session.status)}`}
      onKeyDown={(e) => {
        // Only keys aimed at the card itself, not the rename field or bell inside it
        if (e.target !== e.currentTarget || props.isEditing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onClick();
        }
      }}
    >
      <SessionCard {...props} />
    </div>
  );
}

function SessionCard({
  session,
  shortcutIndex,
  isActive,
  isEditing,
  onClick,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onToggleNotify,
  onPrSummaryClick,
}: SessionCardProps): React.ReactElement {
  const [editValue, setEditValue] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    setEditValue(session.name);
    // rAF: the input mounts in this same commit
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [isEditing, session.name]);

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.name) {
      onRenameCommit(trimmed);
    } else {
      onRenameCancel();
    }
  };

  return (
    <div
      data-session-card
      className="session-card"
      data-active={isActive}
      onClick={isEditing ? undefined : onClick}
      onContextMenu={(e) => {
        e.stopPropagation();
        if (!isEditing) onContextMenu(e);
      }}
    >
      {/* Row 1: status · name · unread — index · PRs · bell */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 }}>
        <StatusDot status={session.status} />
        {isEditing ? (
          <input
            ref={inputRef}
            className="input"
            style={inlineEditStyle}
            value={editValue}
            aria-label="Session name"
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onRenameCancel();
              }
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <span
              title={session.hasUserInput ? undefined : "No input yet — this session won't be restored after a restart"}
              style={{
                ...nameStyle,
                fontWeight: session.unread ? 600 : 500,
                fontStyle: session.hasUserInput ? 'normal' : 'italic',
                color: session.hasUserInput || session.unread ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {session.name}
            </span>
            {session.unread && <span title="Unread" style={unreadDotStyle} />}
          </span>
        )}
        {shortcutIndex !== null && (
          <kbd className="kbd session-index">⌘{shortcutIndex}</kbd>
        )}
        <PrSummaryChip prs={session.prs} onClick={onPrSummaryClick} />
        <button
          type="button"
          className="icon-btn notify-toggle"
          data-on={session.notifyOnIdle}
          style={{ width: 20, height: 20, color: session.notifyOnIdle ? 'var(--accent-primary)' : undefined }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleNotify();
          }}
          title={session.notifyOnIdle ? 'Notifications on — click to turn off' : 'Notifications off — click to turn on'}
          aria-label={session.notifyOnIdle ? 'Turn off notifications' : 'Turn on notifications'}
          aria-pressed={session.notifyOnIdle}
        >
          {session.notifyOnIdle ? <Bell size={11} /> : <BellOff size={11} />}
        </button>
      </div>

      {/* Row 2: directory · worktree — status, aligned under the name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1, paddingLeft: 15 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <span style={metaStyle} title={session.cwd}>{basename(session.cwd)}</span>
          {session.worktree && (
            <span style={{ ...metaStyle, display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <GitBranch size={10} style={{ color: 'var(--accent-primary)' }} />
              {session.worktree}
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, color: statusColor(session.status), flexShrink: 0 }}>
          {statusLabel(session.status)}
        </span>
      </div>
    </div>
  );
}

// ─── ⌘-held shortcut sheet ───────────────────────────────

const SHEET_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['⌘', '1–9'], label: 'Switch session' },
  { keys: ['⌘', '[', ']'], label: 'Previous / next' },
  { keys: ['⌘', 'J'], label: 'Next needing attention' },
  { keys: ['⌘', 'K'], label: 'Command palette' },
  { keys: ['⌘', 'T'], label: 'New session' },
];

function ShortcutSheet(): React.ReactElement {
  return (
    <div style={sheetStyle} aria-hidden="true">
      {SHEET_SHORTCUTS.map(({ keys, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          <Keys keys={keys} />
        </div>
      ))}
    </div>
  );
}

// ─── PR summary chip ─────────────────────────────────────

interface PrSummaryChipProps {
  prs: LinkedPr[];
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
}

/** One icon for all of a session's PRs, plus a count when there are several. */
function PrSummaryChip({ prs, onClick }: PrSummaryChipProps): React.ReactElement | null {
  const stage = summaryStage(prs);
  if (!stage) return null;
  const { Icon, color, background } = STAGE_ICON[stage];
  const title = prs.length === 1 ? prTooltip(prs[0]) : `${prs.length} pull requests`;
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} style={{ ...prSummaryChipStyle, color, background }}>
      <Icon size={12} />
      {prs.length > 1 && <span style={{ fontSize: 10, lineHeight: 1 }}>{prs.length}</span>}
    </button>
  );
}

// ─── Styles ──────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  background: 'var(--bg-panel)',
};

const countStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-dimmed)',
  fontVariantNumeric: 'tabular-nums',
};

const attentionPillStyle: React.CSSProperties = {
  padding: '1px 7px',
  borderRadius: 999,
  background: 'rgba(var(--accent-rgb), 0.16)',
  color: 'var(--accent-primary)',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
  animation: 'fadeIn 150ms ease',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflowY: 'auto',
  padding: '6px 0',
  gap: 2,
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  flex: 1,
  color: 'var(--text-dimmed)',
  fontSize: 11,
};

const nameStyle: React.CSSProperties = {
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  transition: 'color var(--transition-fast)',
};

const unreadDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--accent-primary)',
  boxShadow: '0 0 6px rgba(var(--accent-rgb), 0.6)',
  flexShrink: 0,
};

const metaStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-dimmed)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const inlineEditStyle: React.CSSProperties = {
  flex: 1,
  padding: '1px 6px',
  fontFamily: 'var(--font-ui)',
  fontSize: 12,
  fontWeight: 500,
};

const prSummaryChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  flexShrink: 0,
  height: 18,
  borderRadius: 'var(--radius-sm)',
  padding: '0 4px',
};

const sheetStyle: React.CSSProperties = {
  position: 'absolute',
  left: 8,
  right: 8,
  bottom: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-elevated)',
  boxShadow: 'var(--shadow-md)',
  fontSize: 11,
  animation: 'slideUp 150ms var(--ease-out)',
  pointerEvents: 'none',
};
