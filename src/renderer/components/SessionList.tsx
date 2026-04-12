import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { GitBranch, Bell, BellOff } from 'lucide-react';
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
import type { Session } from '../../shared/types';

interface SessionListProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRenameSession: (id: string, newName: string) => void;
  onEndSession: (id: string) => void;
  onToggleNotify: (id: string) => void;
  onReorderSessions: (sessions: Session[]) => void;
}

const statusColors: Record<string, string> = {
  idle: 'var(--status-idle)',
  waiting: 'var(--status-idle)',
  thinking: 'var(--status-thinking)',
  generating: 'var(--status-generating)',
  creating: 'var(--status-creating)',
  error: 'var(--status-error)',
  ended: 'var(--status-ended)',
};

function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}

interface ContextMenuState {
  x: number;
  y: number;
  sessionId: string | null;
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onEndSession,
  onToggleNotify,
  onReorderSessions,
}: SessionListProps): React.ReactElement {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sessionId: string | null) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
    },
    []
  );

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        return;
      }
      if (!menuRef.current) return;
      const items = menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (items.length === 0) return;
      const focused = document.activeElement as HTMLElement;
      const currentIdx = Array.from(items).indexOf(focused);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
        items[next].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
        items[prev].focus();
      } else if (e.key === 'Enter' && currentIdx >= 0) {
        e.preventDefault();
        items[currentIdx].click();
      }
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    // Focus first menu item
    requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      first?.focus();
    });
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const handleMenuAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      const { sessionId } = contextMenu;
      setContextMenu(null);
      switch (action) {
        case 'switch':
          if (sessionId) onSelectSession(sessionId);
          break;
        case 'rename':
          if (sessionId) setEditingSessionId(sessionId);
          break;
        case 'end':
          if (sessionId) onEndSession(sessionId);
          break;
        case 'new':
          onNewSession();
          break;
      }
    },
    [contextMenu, onSelectSession, onEndSession, onNewSession]
  );

  const handleRenameCommit = useCallback(
    (id: string, newName: string) => {
      onRenameSession(id, newName);
      setEditingSessionId(null);
    },
    [onRenameSession]
  );

  const handleRenameCancel = useCallback(() => {
    setEditingSessionId(null);
  }, []);

  return (
    <div
      style={containerStyle}
      onContextMenu={(e) => {
        // Only show "New Session" menu when right-clicking empty area (not on a card)
        if (e.target === e.currentTarget || !(e.target as HTMLElement).closest('[data-session-card]')) {
          handleContextMenu(e, null);
        }
      }}
    >
      {/* Header */}
      <div style={headerBarStyle}>
        <span style={headerTitleStyle}>Sessions</span>
        <button
          style={newSessionButtonStyle}
          onClick={onNewSession}
          title="New Session (⌘T)"
          aria-label="New Session"
        >
          +
        </button>
      </div>

      {/* Session cards */}
      <div style={listStyle}>
        {sessions.length === 0 ? (
          <div style={emptyStyle}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>No sessions yet</span>
            <br />
            <span
              style={{ color: 'var(--accent-blue)', cursor: 'pointer' }}
              onClick={onNewSession}
            >
              New Session
            </span>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              marginTop: 4,
              color: 'var(--text-secondary)',
              fontSize: 11,
            }}>
              <kbd style={kbdStyle}>⌘</kbd>
              <span style={{ color: 'var(--text-dimmed)', fontSize: 10 }}>+</span>
              <kbd style={kbdStyle}>T</kbd>
            </span>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sessionIds} strategy={verticalListSortingStrategy}>
              {sessions.map((session) => (
                <SortableSessionCard
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  isEditing={session.id === editingSessionId}
                  onClick={() => onSelectSession(session.id)}
                  onContextMenu={(e) => handleContextMenu(e, session.id)}
                  onRenameCommit={(newName) => handleRenameCommit(session.id, newName)}
                  onRenameCancel={handleRenameCancel}
                  onToggleNotify={() => onToggleNotify(session.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Keyboard shortcuts */}
      <div style={shortcutsStyle}>
        <div style={shortcutRowStyle}>
          <span style={shortcutLabelStyle}>Switch</span>
          <span style={shortcutKeysStyle}><kbd style={kbdStyle}>⌘</kbd> <kbd style={kbdStyle}>1</kbd>–<kbd style={kbdStyle}>9</kbd></span>
        </div>
        <div style={shortcutRowStyle}>
          <span style={shortcutLabelStyle}>Prev / Next</span>
          <span style={shortcutKeysStyle}><kbd style={kbdStyle}>⌘</kbd> <kbd style={kbdStyle}>[</kbd> <kbd style={kbdStyle}>]</kbd></span>
        </div>
        <div style={shortcutRowStyle}>
          <span style={shortcutLabelStyle}>New</span>
          <span style={shortcutKeysStyle}><kbd style={kbdStyle}>⌘</kbd> <kbd style={kbdStyle}>T</kbd></span>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menuRef={menuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          sessionId={contextMenu.sessionId}
          onAction={handleMenuAction}
        />
      )}
    </div>
  );
}

interface SessionCardProps {
  session: Session;
  isActive: boolean;
  isEditing: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameCommit: (newName: string) => void;
  onRenameCancel: () => void;
  onToggleNotify: () => void;
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
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <SessionCard {...props} />
    </div>
  );
}

function SessionCard({ session, isActive, isEditing, onClick, onContextMenu, onRenameCommit, onRenameCancel, onToggleNotify }: SessionCardProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const [editValue, setEditValue] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusColor = statusColors[session.status] ?? 'var(--text-dimmed)';
  const isPulsing = session.status === 'thinking' || session.status === 'generating' || session.status === 'waiting';

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditValue(session.name);
      // Use rAF to ensure the input is rendered before focusing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
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
      style={{
        ...cardStyle,
        background: isActive ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
      }}
      onClick={isEditing ? undefined : onClick}
      onContextMenu={(e) => {
        e.stopPropagation();
        if (!isEditing) onContextMenu(e);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Row 1: name + bell + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {isEditing ? (
          <input
            ref={inputRef}
            style={inlineEditStyle}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', minWidth: 0 }}>
            {session.unread ? (
              <span
                title="Unread"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: 'var(--accent-blue)',
                  flexShrink: 0,
                }}
              />
            ) : !session.hasUserInput ? (
              <span
                title="No user input yet — session won't be persisted"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: 'var(--text-dimmed)',
                  flexShrink: 0,
                }}
              />
            ) : null}
            <span style={{
              fontWeight: session.unread ? 600 : 500,
              fontSize: 12,
              color: session.unread ? 'var(--text-accent)' : 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              transition: 'color var(--transition-fast)',
            }}>
              {session.name}
            </span>
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleNotify();
            }}
            title={session.notifyOnIdle ? 'Notifications on — click to disable' : 'Notifications off — click to enable'}
            style={{
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              color: session.notifyOnIdle ? 'var(--accent-blue)' : 'var(--text-dimmed)',
              opacity: session.notifyOnIdle ? 1 : 0.4,
              transition: 'color var(--transition-fast), opacity var(--transition-fast)',
            }}
          >
            {session.notifyOnIdle ? <Bell size={11} /> : <BellOff size={11} />}
          </span>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: statusColor,
              display: 'inline-block',
              animation: isPulsing ? 'statusPulse 1.5s ease-in-out infinite' : undefined,
              boxShadow: isPulsing ? `0 0 4px ${statusColor}` : undefined,
            }}
          />
          <span style={{ fontSize: 10, color: statusColor, textTransform: 'capitalize' }}>
            {session.status}
          </span>
        </div>
      </div>

      {/* Row 2: cwd + worktree */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <div style={{ fontSize: 10, color: 'var(--text-dimmed)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {shortenPath(session.cwd)}
        </div>
        {session.worktree && (
          <span style={{ ...cardTagStyle, flexShrink: 0, background: 'none', padding: 0 }}>
            <GitBranch size={10} style={{ color: 'var(--accent-blue)' }} /> {session.worktree}
          </span>
        )}
      </div>

      {/* Row 3: model, branch, context */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {session.model && (
          <span style={cardTagStyle}>{session.model}</span>
        )}
        {session.gitBranch && (
          <span style={cardTagStyle}>
            <span style={{ color: 'var(--accent-orange)' }}></span> {session.gitBranch}
          </span>
        )}
        {session.contextUsage != null && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 36, height: 3, background: 'rgba(var(--tint-rgb), 0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, session.contextUsage)}%`,
                  height: '100%',
                  borderRadius: 2,
                  backgroundColor:
                    session.contextUsage > 80
                      ? 'var(--accent-red)'
                      : session.contextUsage > 50
                        ? 'var(--accent-yellow)'
                        : 'var(--accent-primary)',
                  transition: 'width var(--transition-normal)',
                }}
              />
            </div>
            <span style={{ fontSize: 9, color: 'var(--text-dimmed)' }}>{session.contextUsage}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Context Menu (viewport-clamped, keyboard-navigable) ───

interface ContextMenuProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  sessionId: string | null;
  onAction: (action: string) => void;
}

function ContextMenu({ menuRef, x, y, sessionId, onAction }: ContextMenuProps): React.ReactElement {
  // Clamp position so menu stays within viewport
  const menuWidth = 180;
  const menuHeight = sessionId ? 150 : 36;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        ...contextMenuStyle,
        left: Math.max(4, clampedX),
        top: Math.max(4, clampedY),
      }}
    >
      {sessionId ? (
        <>
          <div role="menuitem" tabIndex={0} style={menuItemStyle} onClick={() => onAction('switch')}>
            Switch to Session
          </div>
          <div role="menuitem" tabIndex={0} style={menuItemStyle} onClick={() => onAction('rename')}>
            Rename Session
          </div>
          <div style={menuDividerStyle} />
          <div
            role="menuitem"
            tabIndex={0}
            style={{ ...menuItemStyle, color: 'var(--accent-red)' }}
            onClick={() => onAction('end')}
          >
            End Session & Remove
          </div>
        </>
      ) : (
        <div role="menuitem" tabIndex={0} style={menuItemStyle} onClick={() => onAction('new')}>
          New Session
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  background: 'var(--bg-panel)',
};

const headerBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 14px',
  borderBottom: '1px solid var(--border-subtle)',
  flexShrink: 0,
};

const newSessionButtonStyle: React.CSSProperties = {
  marginLeft: 'auto',
  width: 22,
  height: 22,
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-dimmed)',
  fontSize: 16,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'color var(--transition-fast)',
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-dimmed)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
  gap: 1,
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  color: 'var(--text-dimmed)',
  fontSize: 11,
  lineHeight: 1.8,
};

const kbdStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 18,
  padding: '0 4px',
  fontSize: 10,
  fontFamily: 'var(--font-ui)',
  color: 'var(--text-secondary)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
};

const shortcutsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '8px 16px',
  borderTop: '1px solid var(--border-subtle)',
  flexShrink: 0,
  opacity: 0.6,
};

const shortcutRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const shortcutLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-dimmed)',
};

const shortcutKeysStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 10,
  color: 'var(--text-dimmed)',
};

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  cursor: 'pointer',
  transition: 'background var(--transition-fast), border-color var(--transition-fast)',
  margin: '0 6px',
  borderRadius: 'var(--radius-md)',
};

const cardTagStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-dimmed)',
  background: 'rgba(var(--tint-rgb), 0.06)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 5px',
  lineHeight: '16px',
  whiteSpace: 'nowrap',
};

const inlineEditStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 11,
  color: 'var(--text-primary)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--accent-blue)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 4px',
  outline: 'none',
  fontFamily: 'var(--font-ui)',
  width: '100%',
  minWidth: 0,
};

const contextMenuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-lg)',
  padding: '4px 0',
  minWidth: 160,
};

const menuItemStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  cursor: 'pointer',
  color: 'var(--text-primary)',
  transition: 'background var(--transition-fast)',
};

const menuDividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--border-subtle)',
  margin: '4px 0',
};
