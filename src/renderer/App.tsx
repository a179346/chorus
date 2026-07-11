import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ToolkitCommand } from '../shared/types';
import { SplitPane } from './components/SplitPane';
import { StatusBar } from './components/StatusBar';
import { ShellPanel } from './components/ShellPanel';
import { SessionList } from './components/SessionList';
import { ToolkitPanel } from './components/ToolkitPanel';
import { TerminalView } from './components/TerminalView';
import { SearchBar } from './components/SearchBar';
import { NewSessionDialog } from './components/NewSessionDialog';
import { PreferencesDialog } from './components/PreferencesDialog';
import { applyThemeCss, getTheme, DEFAULT_THEME_ID } from './themes';
import { terminals } from './terminal-host';
import { useSessions, type NewSessionInput } from './use-sessions';
import { invoke, on, IpcChannels } from './ipc';

const DEFAULT_SIDEBAR_WIDTH = 320;
const DEFAULT_SHELL_HEIGHT = 200;
const DEFAULT_TOOLKIT_HEIGHT = 200;
const DEFAULT_FONT_SIZE = 13;

export function App(): React.ReactElement {
  // ─── Session state (owned by the useSessions hook) ──
  const {
    sessions,
    activeSession,
    activeSessionId,
    activeSessionIdRef,
    setActiveSessionId,
    selectSession,
    createSession,
    endSession,
    toggleNotify,
    renameSession,
    reorderSessions,
    switchToIndex,
    switchRelative,
  } = useSessions();

  // ─── UI state ───────────────────────────────────────
  const [toolkitCommands, setToolkitCommands] = useState<ToolkitCommand[]>([]);
  const [shellCollapsed, setShellCollapsed] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [terminalFontFamily, setTerminalFontFamily] = useState("'MesloLGS NF', 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Fira Code', monospace");
  const [claudeFontSize, setClaudeFontSize] = useState(DEFAULT_FONT_SIZE);
  const [shellFontSize, setShellFontSize] = useState(DEFAULT_FONT_SIZE);
  const [endSessionConfirm, setEndSessionConfirm] = useState<string | null>(null);
  const [currentTheme, setCurrentTheme] = useState(DEFAULT_THEME_ID);
  const [ptySearch, setPtySearch] = useState<{ sessionId: string; key: number } | null>(null);
  const [shellSearch, setShellSearch] = useState<{ sessionId: string; key: number } | null>(null);
  const searchKeyRef = useRef(0);

  // Panel sizes
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [shellHeight, setShellHeight] = useState(DEFAULT_SHELL_HEIGHT);
  const [toolkitHeight, setToolkitHeight] = useState(DEFAULT_TOOLKIT_HEIGHT);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Load initial state ─────────────────────────────
  useEffect(() => {
    void invoke(IpcChannels.APP_GET_STATE).then((state) => {
      if (state.panelSizes) {
        setSidebarWidth(state.panelSizes.sidebarWidth || DEFAULT_SIDEBAR_WIDTH);
        setShellHeight(state.panelSizes.shellHeight || DEFAULT_SHELL_HEIGHT);
        setToolkitHeight(state.panelSizes.toolkitHeight || DEFAULT_TOOLKIT_HEIGHT);
        setShellCollapsed(state.panelSizes.shellCollapsed ?? false);
      }
      if (state.lastActiveSessionId) {
        setActiveSessionId(state.lastActiveSessionId);
      }
      if (state.terminalSettings?.fontFamily) {
        setTerminalFontFamily(state.terminalSettings.fontFamily);
      }
      if (state.terminalSettings?.claudeFontSize) {
        setClaudeFontSize(state.terminalSettings.claudeFontSize);
      }
      if (state.terminalSettings?.shellFontSize) {
        setShellFontSize(state.terminalSettings.shellFontSize);
      }
      if (state.terminalSettings?.theme) {
        const tid = state.terminalSettings.theme;
        setCurrentTheme(tid);
        applyThemeCss(tid);
        const t = getTheme(tid);
        terminals.setTheme(t.xtermTheme, t.searchDecorations);
      }
    });

    void invoke(IpcChannels.TOOLKIT_LIST, {}).then(setToolkitCommands);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Preload terminals for every session ───────────
  // Background sessions emit PTY data immediately on app restart (claude --resume
  // dumps conversation history). Without a registered listener, that output is
  // dropped. terminals.preload creates a cached xterm + IPC listener per session
  // so the data is captured even before the user switches to that session.
  useEffect(() => {
    for (const s of sessions) {
      terminals.preload('pty', s.id, terminalFontFamily, claudeFontSize);
      terminals.preload('shell', s.id, terminalFontFamily, shellFontSize);
    }
  }, [sessions, terminalFontFamily, claudeFontSize, shellFontSize]);

  // Keep cached terminals' fonts in sync with current settings (handles the
  // case where preload ran with defaults before APP_GET_STATE resolved).
  useEffect(() => {
    terminals.applySettings({
      fontFamily: terminalFontFamily,
      claudeFontSize,
      shellFontSize,
    });
  }, [terminalFontFamily, claudeFontSize, shellFontSize]);

  // ─── Menu event listeners ──────────────────────────
  useEffect(() => {
    const cleanups = [
      on(IpcChannels.MENU_NEW_SESSION, () => setShowNewSession(true)),
      on(IpcChannels.MENU_SWITCH_SESSION, ({ index }) => switchToIndex(index)),
      on(IpcChannels.MENU_PREV_SESSION, () => switchRelative(-1)),
      on(IpcChannels.MENU_NEXT_SESSION, () => switchRelative(1)),
      on(IpcChannels.MENU_CLOSE_SESSION, () => {
        const currentId = activeSessionIdRef.current;
        if (currentId) setEndSessionConfirm(currentId);
      }),
      on(IpcChannels.MENU_FIND, () => {
        const currentId = activeSessionIdRef.current;
        if (!currentId) return;
        const k = ++searchKeyRef.current;
        const focused = terminals.focused();
        if (focused && focused.sessionId === currentId && focused.kind === 'shell') {
          setShellSearch({ sessionId: focused.sessionId, key: k });
        } else {
          setPtySearch({ sessionId: currentId, key: k });
        }
      }),
      on(IpcChannels.MENU_PREFERENCES, () => setShowPreferences(true)),
    ];
    return () => cleanups.forEach((c) => c());
  }, [switchToIndex, switchRelative]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Persist panel sizes (debounced) ────────────────
  const savePanelSizes = useCallback(
    (overrides?: { sidebarWidth?: number; shellHeight?: number; toolkitHeight?: number; shellCollapsed?: boolean }) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        void invoke(IpcChannels.APP_SAVE_STATE, {
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
      setPtySearch(null);
      setShellSearch(null);
      selectSession(id);
    },
    [selectSession]
  );

  const handleNewSession = useCallback(
    async (config: NewSessionInput) => {
      await createSession(config);
      setShowNewSession(false);
    },
    [createSession]
  );

  const handleEndSession = useCallback(
    async (id: string) => {
      await endSession(id);
      terminals.dispose(id);
    },
    [endSession]
  );

  const requestEndSession = useCallback(
    (id: string) => {
      setEndSessionConfirm(id);
    },
    []
  );

  const handleConfirmEndSession = useCallback(() => {
    if (endSessionConfirm) {
      void handleEndSession(endSessionConfirm);
      setEndSessionConfirm(null);
    }
  }, [endSessionConfirm, handleEndSession]);

  const handleToolkitExecute = useCallback(
    (commandId: string) => {
      const sid = activeSessionIdRef.current;
      if (sid) {
        void invoke(IpcChannels.TOOLKIT_EXECUTE, { sessionId: sid, commandId });
        requestAnimationFrame(() => terminals.focus('pty', sid));
      }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleToolkitAdd = useCallback(
    async (command: Omit<ToolkitCommand, 'id'>) => {
      const added = await invoke(IpcChannels.TOOLKIT_ADD, { ...command, id: crypto.randomUUID() } as ToolkitCommand);
      setToolkitCommands((prev) => [...prev, added]);
    },
    []
  );

  const handleToolkitUpdate = useCallback(
    async (command: ToolkitCommand) => {
      const updated = await invoke(IpcChannels.TOOLKIT_UPDATE, command);
      setToolkitCommands((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    },
    []
  );

  const handleToolkitDelete = useCallback(
    async (commandId: string) => {
      await invoke(IpcChannels.TOOLKIT_DELETE, { id: commandId });
      setToolkitCommands((prev) => prev.filter((c) => c.id !== commandId));
    },
    []
  );

  const handlePreviewTheme = useCallback((themeId: string) => {
    applyThemeCss(themeId);
    const t = getTheme(themeId);
    terminals.setTheme(t.xtermTheme, t.searchDecorations);
  }, []);

  const handleSavePreferences = useCallback(
    (settings: { fontFamily: string; theme: string; claudeFontSize: number; shellFontSize: number }) => {
      setTerminalFontFamily(settings.fontFamily);
      setClaudeFontSize(settings.claudeFontSize);
      setShellFontSize(settings.shellFontSize);
      terminals.applySettings({
        fontFamily: settings.fontFamily,
        claudeFontSize: settings.claudeFontSize,
        shellFontSize: settings.shellFontSize,
      });
      setCurrentTheme(settings.theme);
      handlePreviewTheme(settings.theme);
      void invoke(IpcChannels.APP_SAVE_STATE, {
        terminalSettings: {
          fontFamily: settings.fontFamily,
          theme: settings.theme,
          claudeFontSize: settings.claudeFontSize,
          shellFontSize: settings.shellFontSize,
        },
      });
      setShowPreferences(false);
    },
    [handlePreviewTheme]
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
          50% { opacity: 0.35; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Context menu item hover + focus */
        [role="menuitem"]:hover,
        [role="menuitem"]:focus {
          background: var(--bg-hover);
          outline: none;
        }
        /* Divider hover highlight */
        [data-divider] {
          background: rgba(var(--tint-rgb), 0.14) !important;
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
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
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
            <div style={{ width: '100%', height: '100%', background: 'var(--bg-terminal)', position: 'relative' }}>
              {ptySearch && (
                <SearchBar
                  key={ptySearch.key}
                  type="pty"
                  sessionId={ptySearch.sessionId}
                  onClose={() => setPtySearch(null)}
                />
              )}
              <TerminalView sessionId={activeSessionId} type="pty" fontFamily={terminalFontFamily} fontSize={claudeFontSize} />
            </div>

            {/* Shell terminal (collapsible) */}
            <ShellPanel collapsed={shellCollapsed} onToggle={handleShellToggle}>
              <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                {shellSearch && (
                  <SearchBar
                    key={shellSearch.key}
                    type="shell"
                    sessionId={shellSearch.sessionId}
                    onClose={() => setShellSearch(null)}
                  />
                )}
                <TerminalView sessionId={activeSessionId} type="shell" visible={!shellCollapsed} fontFamily={terminalFontFamily} fontSize={shellFontSize} />
              </div>
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
            onRenameSession={renameSession}
            onEndSession={requestEndSession}
            onToggleNotify={toggleNotify}
            onReorderSessions={reorderSessions}
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

      {/* Preferences dialog */}
      <PreferencesDialog
        open={showPreferences}
        fontFamily={terminalFontFamily}
        theme={currentTheme}
        claudeFontSize={claudeFontSize}
        shellFontSize={shellFontSize}
        onClose={() => setShowPreferences(false)}
        onSave={handleSavePreferences}
        onPreviewTheme={handlePreviewTheme}
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
  background: 'rgba(var(--shade-rgb), 0.6)',
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
