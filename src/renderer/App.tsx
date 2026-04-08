import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Session, SessionStateUpdate, ToolkitCommand } from '../shared/types';
import { SplitPane } from './components/SplitPane';
import { StatusBar } from './components/StatusBar';
import { ShellPanel } from './components/ShellPanel';
import { SessionList } from './components/SessionList';
import { ToolkitPanel } from './components/ToolkitPanel';
import { TerminalView, disposeTerminal, focusTerminal } from './components/TerminalView';
import { NewSessionDialog } from './components/NewSessionDialog';

const DEFAULT_SIDEBAR_WIDTH = 320;
const DEFAULT_SHELL_HEIGHT = 200;
const DEFAULT_TOOLKIT_HEIGHT = 200;

export function App(): React.ReactElement {
  // ─── State ──────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [toolkitCommands, setToolkitCommands] = useState<ToolkitCommand[]>([]);
  const [shellCollapsed, setShellCollapsed] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [endSessionConfirm, setEndSessionConfirm] = useState<string | null>(null);

  // Panel sizes
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [shellHeight, setShellHeight] = useState(DEFAULT_SHELL_HEIGHT);
  const [toolkitHeight, setToolkitHeight] = useState(DEFAULT_TOOLKIT_HEIGHT);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // ─── Load initial state ─────────────────────────────
  useEffect(() => {
    window.electronAPI.appGetState().then((state) => {
      if (state.panelSizes) {
        setSidebarWidth(state.panelSizes.sidebarWidth || DEFAULT_SIDEBAR_WIDTH);
        setShellHeight(state.panelSizes.shellHeight || DEFAULT_SHELL_HEIGHT);
        setToolkitHeight(state.panelSizes.toolkitHeight || DEFAULT_TOOLKIT_HEIGHT);
        setShellCollapsed(state.panelSizes.shellCollapsed ?? false);
      }
      if (state.lastActiveSessionId) {
        setActiveSessionId(state.lastActiveSessionId);
      }
    });

    window.electronAPI.sessionList().then((list) => {
      setSessions(list);
      if (list.length > 0 && !activeSessionId) {
        setActiveSessionId(list[0].id);
      }
    });

    window.electronAPI.toolkitList().then(setToolkitCommands);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Session state updates from main ────────────────
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionState((update: SessionStateUpdate) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === update.sessionId
            ? {
                ...s,
                ...(update.status !== undefined && { status: update.status }),
                ...(update.model !== undefined && { model: update.model }),
                ...(update.contextUsage !== undefined && { contextUsage: update.contextUsage }),
                ...(update.gitBranch !== undefined && { gitBranch: update.gitBranch }),
                ...(update.hasUserInput !== undefined && { hasUserInput: update.hasUserInput }),
                ...(update.unread !== undefined && { unread: update.unread }),
              }
            : s
        )
      );
    });
    return cleanup;
  }, []);

  // ─── Menu event listeners ──────────────────────────
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onMenuNewSession(() => setShowNewSession(true)),
      window.electronAPI.onMenuSwitchSession(({ index }) => {
        setSessions((prev) => {
          if (index >= 0 && index < prev.length) {
            setActiveSessionId(prev[index].id);
          }
          return prev;
        });
      }),
      window.electronAPI.onMenuPrevSession(() => {
        setSessions((prev) => {
          if (prev.length <= 1) return prev;
          const currentId = activeSessionIdRef.current;
          const idx = prev.findIndex((s) => s.id === currentId);
          const prevIdx = idx <= 0 ? prev.length - 1 : idx - 1;
          setActiveSessionId(prev[prevIdx].id);
          return prev;
        });
      }),
      window.electronAPI.onMenuNextSession(() => {
        setSessions((prev) => {
          if (prev.length <= 1) return prev;
          const currentId = activeSessionIdRef.current;
          const idx = prev.findIndex((s) => s.id === currentId);
          const nextIdx = idx >= prev.length - 1 ? 0 : idx + 1;
          setActiveSessionId(prev[nextIdx].id);
          return prev;
        });
      }),
      window.electronAPI.onMenuCloseSession(() => {
        const currentId = activeSessionIdRef.current;
        if (currentId) setEndSessionConfirm(currentId);
      }),
    ];
    return () => cleanups.forEach((c) => c());
  }, []);

  // ─── Persist panel sizes (debounced) ────────────────
  const savePanelSizes = useCallback(
    (overrides?: { sidebarWidth?: number; shellHeight?: number; toolkitHeight?: number; shellCollapsed?: boolean }) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        window.electronAPI.appSaveState({
          panelSizes: {
            sidebarWidth: overrides?.sidebarWidth ?? sidebarWidth,
            shellHeight: overrides?.shellHeight ?? shellHeight,
            toolkitHeight: overrides?.toolkitHeight ?? toolkitHeight,
            shellCollapsed: overrides?.shellCollapsed ?? shellCollapsed,
          },
        });
      }, 300);
    },
    [sidebarWidth, shellHeight, toolkitHeight, shellCollapsed]
  );

  // ─── Handlers ──────────────────────────────────────
  const handleSelectSession = useCallback(
    (id: string) => {
      setActiveSessionId(id);
      window.electronAPI.sessionSwitch(id);
      window.electronAPI.appSaveState({ lastActiveSessionId: id });
    },
    []
  );

  const handleNewSession = useCallback(
    async (config: { name: string; cwd: string; worktree: string; flags: string[]; notifyOnIdle: boolean }) => {
      const session = await window.electronAPI.sessionCreate({
        name: config.name,
        cwd: config.cwd,
        worktree: config.worktree || undefined,
        flags: config.flags,
      });
      // Set notifyOnIdle if requested
      if (config.notifyOnIdle) {
        const updated = await window.electronAPI.sessionToggleNotify(session.id);
        setSessions((prev) => [...prev, updated]);
      } else {
        setSessions((prev) => [...prev, session]);
      }
      setActiveSessionId(session.id);
      setShowNewSession(false);
      window.electronAPI.appSaveState({
        lastActiveSessionId: session.id,
        newSessionDefaults: { cwd: config.cwd, flags: config.flags, notifyOnIdle: config.notifyOnIdle },
      });
    },
    []
  );

  const handleEndSession = useCallback(
    async (id: string) => {
      await window.electronAPI.sessionEnd(id);
      // Dispose cached xterm instances for this session
      disposeTerminal('pty', id);
      disposeTerminal('shell', id);
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== id);
        if (activeSessionIdRef.current === id) {
          setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
        }
        return filtered;
      });
    },
    []
  );
  const requestEndSession = useCallback(
    (id: string) => {
      setEndSessionConfirm(id);
    },
    []
  );

  const handleConfirmEndSession = useCallback(() => {
    if (endSessionConfirm) {
      handleEndSession(endSessionConfirm);
      setEndSessionConfirm(null);
    }
  }, [endSessionConfirm, handleEndSession]);

  const handleToggleNotify = useCallback(
    async (id: string) => {
      const updated = await window.electronAPI.sessionToggleNotify(id);
      setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    },
    []
  );

  const handleReorderSessions = useCallback(
    (reorderedSessions: Session[]) => {
      setSessions(reorderedSessions);
      window.electronAPI.sessionReorder(reorderedSessions.map((s) => s.id));
    },
    []
  );

  const handleRenameSession = useCallback(
    (id: string, newName: string) => {
      window.electronAPI.sessionRename(id, newName).then((updated) => {
        setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
      });
    },
    []
  );

  const handleToolkitExecute = useCallback(
    (commandId: string) => {
      const sid = activeSessionIdRef.current;
      if (sid) {
        window.electronAPI.toolkitExecute(sid, commandId);
        requestAnimationFrame(() => focusTerminal('pty', sid));
      }
    },
    []
  );

  const handleToolkitAdd = useCallback(
    async (command: Omit<ToolkitCommand, 'id'>) => {
      const added = await window.electronAPI.toolkitAdd({ ...command, id: crypto.randomUUID() } as ToolkitCommand);
      setToolkitCommands((prev) => [...prev, added]);
    },
    []
  );

  const handleToolkitUpdate = useCallback(
    async (command: ToolkitCommand) => {
      const updated = await window.electronAPI.toolkitUpdate(command);
      setToolkitCommands((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    },
    []
  );

  const handleToolkitDelete = useCallback(
    async (commandId: string) => {
      await window.electronAPI.toolkitDelete(commandId);
      setToolkitCommands((prev) => prev.filter((c) => c.id !== commandId));
    },
    []
  );

  const handleShellToggle = useCallback(() => {
    setShellCollapsed((prev) => {
      const next = !prev;
      savePanelSizes({ shellCollapsed: next });
      return next;
    });
  }, [savePanelSizes]);

  const handleSidebarResize = useCallback(
    (size: number) => {
      setSidebarWidth(size);
      savePanelSizes({ sidebarWidth: size });
    },
    [savePanelSizes]
  );

  const handleShellResize = useCallback(
    (size: number) => {
      setShellHeight(size);
      savePanelSizes({ shellHeight: size });
    },
    [savePanelSizes]
  );

  const handleToolkitResize = useCallback(
    (size: number) => {
      setToolkitHeight(size);
      savePanelSizes({ toolkitHeight: size });
    },
    [savePanelSizes]
  );

  // ─── Render ─────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Global keyframe animations */}
      <style>{`
        @keyframes statusPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Context menu item hover + focus */
        [role="menuitem"]:hover,
        [role="menuitem"]:focus {
          background: var(--bg-hover);
          outline: none;
        }
      `}</style>

      {/* Main layout: left/right split */}
      <SplitPane
        direction="horizontal"
        initialSize={sidebarWidth}
        minPrimary={250}
        minSecondary={400}
        primaryIndex={1}
        onResize={handleSidebarResize}
      >
        {/* LEFT PANE: status bar + terminal + shell */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <StatusBar session={activeSession} />

          <SplitPane
            direction="vertical"
            initialSize={shellCollapsed ? 28 : shellHeight}
            minPrimary={28}
            minSecondary={200}
            maxPrimaryRatio={0.6}
            primaryIndex={1}
            onResize={handleShellResize}
            collapsed={shellCollapsed}
            collapsedSize={28}
          >
            {/* Claude Code terminal */}
            <div style={{ width: '100%', height: '100%', background: 'var(--bg-terminal)' }}>
              <TerminalView sessionId={activeSessionId} type="pty" />
            </div>

            {/* Shell terminal (collapsible) */}
            <ShellPanel collapsed={shellCollapsed} onToggle={handleShellToggle}>
              <TerminalView sessionId={activeSessionId} type="shell" visible={!shellCollapsed} />
            </ShellPanel>
          </SplitPane>
        </div>

        {/* RIGHT PANE: sessions + toolkit */}
        <SplitPane
          direction="vertical"
          initialSize={toolkitHeight}
          minPrimary={100}
          minSecondary={150}
          primaryIndex={1}
          onResize={handleToolkitResize}
        >
          {/* Session list */}
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={() => setShowNewSession(true)}
            onRenameSession={handleRenameSession}
            onEndSession={requestEndSession}
            onToggleNotify={handleToggleNotify}
            onReorderSessions={handleReorderSessions}
          />

          {/* Toolkit */}
          <ToolkitPanel
            commands={toolkitCommands}
            onExecute={handleToolkitExecute}
            onAdd={handleToolkitAdd}
            onUpdate={handleToolkitUpdate}
            onDelete={handleToolkitDelete}
          />
        </SplitPane>
      </SplitPane>

      {/* New session dialog */}
      <NewSessionDialog
        open={showNewSession}
        onClose={() => setShowNewSession(false)}
        onSubmit={handleNewSession}
      />

      {/* End session confirmation dialog */}
      {endSessionConfirm && (
        <EndSessionConfirmDialog
          sessionName={sessions.find((s) => s.id === endSessionConfirm)?.name ?? 'this session'}
          onConfirm={handleConfirmEndSession}
          onCancel={() => setEndSessionConfirm(null)}
        />
      )}

    </div>
  );
}

// ─── End Session Confirmation Dialog ─────────────────────

function EndSessionConfirmDialog({
  sessionName,
  onConfirm,
  onCancel,
}: {
  sessionName: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const endBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setTimeout(() => endBtnRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div style={confirmOverlayStyle} onClick={onCancel}>
      <div style={confirmDialogStyle} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="End session">
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, letterSpacing: '0.02em' }}>
          End Session
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 18px' }}>
          End session <strong style={{ color: 'var(--text-primary)' }}>{sessionName}</strong>? This will terminate the Claude Code process and remove the session.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={confirmCancelBtnStyle} onClick={onCancel}>Cancel</button>
          <button ref={endBtnRef} style={confirmEndBtnStyle} onClick={onConfirm}>End Session</button>
        </div>
      </div>
    </div>
  );
}

const confirmOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
  animation: 'fadeIn 150ms ease',
};

const confirmDialogStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  padding: 24,
  width: 380,
  maxWidth: '90vw',
  animation: 'slideUp 200ms ease',
};

const confirmCancelBtnStyle: React.CSSProperties = {
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

const confirmEndBtnStyle: React.CSSProperties = {
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

