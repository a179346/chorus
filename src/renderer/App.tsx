import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ToolkitCommand } from '../shared/types';
import { SplitPane } from './components/SplitPane';
import { StatusBar } from './components/StatusBar';
import { ShellPanel, SHELL_HEADER_HEIGHT } from './components/ShellPanel';
import { SessionList } from './components/SessionList';
import { ToolkitPanel } from './components/ToolkitPanel';
import { TerminalView } from './components/TerminalView';
import { SearchBar } from './components/SearchBar';
import { NewSessionDialog } from './components/NewSessionDialog';
import { PreferencesDialog } from './components/PreferencesDialog';
import { ExitedSessionBanner } from './components/ExitedSessionBanner';
import { PullRequestsDialog } from './components/PullRequestsDialog';
import { ConfirmDialog } from './components/Dialog';
import { WelcomeScreen } from './components/WelcomeScreen';
import { CommandPalette } from './components/CommandPalette';
import { buildPaletteItems } from './palette-items';
import { applyThemeCss, getTheme, DEFAULT_THEME_ID } from './themes';
import { terminals } from './terminal-host';
import { useSessions, type NewSessionInput } from './use-sessions';
import { hasExited } from './session-presentation';
import { invoke, ipcErrorMessage, on, IpcChannels } from './ipc';

const DEFAULT_SIDEBAR_WIDTH = 320;
const DEFAULT_SHELL_HEIGHT = 200;
const DEFAULT_TOOLKIT_HEIGHT = 200;
const DEFAULT_FONT_SIZE = 13;

export function App(): React.ReactElement {
  // ─── Session state (owned by the useSessions hook) ──
  const {
    sessions,
    sessionsLoaded,
    activeSession,
    activeSessionId,
    activeSessionIdRef,
    setActiveSessionId,
    selectSession,
    createSession,
    endSession,
    restartSession,
    linkPr,
    unlinkPr,
    toggleNotify,
    renameSession,
    reorderSessions,
    switchToIndex,
    switchRelative,
    switchToNextNeedingAttention,
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
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [prDialogSessionId, setPrDialogSessionId] = useState<string | null>(null);
  const [restartError, setRestartError] = useState<{ sessionId: string; message: string } | null>(null);
  const restartingRef = useRef<Set<string>>(new Set());
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

  // Searches the focused terminal: the shell when it has focus, else Claude's
  const openFind = useCallback(() => {
    const currentId = activeSessionIdRef.current;
    if (!currentId) return;
    const k = ++searchKeyRef.current;
    const focused = terminals.focused();
    if (focused && focused.sessionId === currentId && focused.kind === 'shell') {
      setShellSearch({ sessionId: focused.sessionId, key: k });
    } else {
      setPtySearch({ sessionId: currentId, key: k });
    }
  }, [activeSessionIdRef]);

  // ─── Menu event listeners ──────────────────────────
  useEffect(() => {
    const cleanups = [
      on(IpcChannels.MENU_NEW_SESSION, () => setShowNewSession(true)),
      on(IpcChannels.MENU_SWITCH_SESSION, ({ index }) => switchToIndex(index)),
      on(IpcChannels.MENU_PREV_SESSION, () => switchRelative(-1)),
      on(IpcChannels.MENU_NEXT_SESSION, () => switchRelative(1)),
      on(IpcChannels.MENU_NEXT_NEEDING_ATTENTION, () => switchToNextNeedingAttention()),
      on(IpcChannels.MENU_CLOSE_SESSION, () => {
        const currentId = activeSessionIdRef.current;
        if (currentId) setEndSessionConfirm(currentId);
      }),
      on(IpcChannels.MENU_PULL_REQUESTS, () => {
        const currentId = activeSessionIdRef.current;
        if (currentId) setPrDialogSessionId(currentId);
      }),
      on(IpcChannels.MENU_FIND, openFind),
      on(IpcChannels.MENU_PREFERENCES, () => setShowPreferences(true)),
      on(IpcChannels.MENU_COMMAND_PALETTE, () => {
        setPaletteOpen((open) => {
          if (open) return false;
          // Over another dialog, Escape would close both; let that one finish first
          return !document.querySelector('[aria-modal="true"]');
        });
      }),
    ];
    return () => cleanups.forEach((c) => c());
  }, [switchToIndex, switchRelative, switchToNextNeedingAttention, openFind]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleRestartSession = useCallback(
    async (id: string) => {
      // Enter and the button can both fire before the new status arrives
      if (restartingRef.current.has(id)) return;
      restartingRef.current.add(id);
      setRestartError(null);
      try {
        await restartSession(id);
        // The resumed claude replays its history; start from a clean screen.
        // Safe after the await: main replies before the new PTY emits output.
        terminals.reset('pty', id);
        requestAnimationFrame(() => terminals.focus('pty', id));
      } catch (err) {
        setRestartError({ sessionId: id, message: ipcErrorMessage(err) });
      } finally {
        restartingRef.current.delete(id);
      }
    },
    [restartSession]
  );

  const requestEndSession = useCallback(
    (id: string) => {
      setEndSessionConfirm(id);
    },
    []
  );

  /** After renaming, put the keyboard back in Claude — unless focus already went somewhere else. */
  const refocusTerminalIfIdle = useCallback(() => {
    requestAnimationFrame(() => {
      const sid = activeSessionIdRef.current;
      if (sid && document.activeElement === document.body) terminals.focus('pty', sid);
    });
  }, [activeSessionIdRef]);

  const handleRenameSession = useCallback(
    (id: string, name: string) => {
      renameSession(id, name);
      setRenamingSessionId(null);
      refocusTerminalIfIdle();
    },
    [renameSession, refocusTerminalIfIdle]
  );

  const handleCancelRename = useCallback(() => {
    setRenamingSessionId(null);
    refocusTerminalIfIdle();
  }, [refocusTerminalIfIdle]);

  const handleConfirmEndSession = useCallback(() => {
    if (endSessionConfirm) {
      void handleEndSession(endSessionConfirm);
      setEndSessionConfirm(null);
    }
  }, [endSessionConfirm, handleEndSession]);

  const sessionToEnd = sessions.find((s) => s.id === endSessionConfirm) ?? null;

  const closePrDialog = useCallback(() => setPrDialogSessionId(null), []);
  const prDialogSession = sessions.find((s) => s.id === prDialogSessionId) ?? null;

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

          {sessionsLoaded && sessions.length === 0 ? (
            <WelcomeScreen onNewSession={() => setShowNewSession(true)} />
          ) : (
            <SplitPane
              direction="vertical"
              initialSize={shellCollapsed ? SHELL_HEADER_HEIGHT : shellHeight}
              minPrimary={SHELL_HEADER_HEIGHT}
              minSecondary={200}
              maxPrimaryRatio={0.6}
              primaryIndex={1}
              onResize={handleShellResize}
              collapsed={shellCollapsed}
              collapsedSize={SHELL_HEADER_HEIGHT}
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
                {activeSession && hasExited(activeSession) && (
                  <ExitedSessionBanner
                    session={activeSession}
                    error={restartError?.sessionId === activeSession.id ? restartError.message : null}
                    onRestart={handleRestartSession}
                  />
                )}
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
          )}
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
            loading={!sessionsLoaded}
            activeSessionId={activeSessionId}
            renamingSessionId={renamingSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={() => setShowNewSession(true)}
            onStartRename={setRenamingSessionId}
            onRenameSession={handleRenameSession}
            onCancelRename={handleCancelRename}
            onEndSession={requestEndSession}
            onRestartSession={handleRestartSession}
            onToggleNotify={toggleNotify}
            onReorderSessions={reorderSessions}
            onManagePrs={setPrDialogSessionId}
            onJumpToAttention={switchToNextNeedingAttention}
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

      {/* Linked pull requests dialog */}
      {prDialogSession && (
        <PullRequestsDialog
          session={prDialogSession}
          onLink={(url) => linkPr(prDialogSession.id, url)}
          onUnlink={(pr) => unlinkPr(prDialogSession.id, pr)}
          onClose={closePrDialog}
        />
      )}

      {/* End session confirmation dialog */}
      {sessionToEnd && (
        <ConfirmDialog
          title="End Session"
          message={
            <>
              End <strong>{sessionToEnd.name}</strong>? This stops its Claude Code process and removes it from the list.{' '}
              {sessionToEnd.hasUserInput
                ? 'You can bring it back with ⌘⇧T.'
                : "It has no conversation yet, so it can't be reopened."}
            </>
          }
          confirmLabel="End Session"
          onConfirm={handleConfirmEndSession}
          onCancel={() => setEndSessionConfirm(null)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          items={buildPaletteItems({
            sessions,
            activeSession,
            toolkitCommands,
            shellCollapsed,
            actions: {
              selectSession: handleSelectSession,
              newSession: () => setShowNewSession(true),
              nextNeedingAttention: switchToNextNeedingAttention,
              renameSession: setRenamingSessionId,
              toggleNotify,
              managePrs: setPrDialogSessionId,
              restartSession: (id) => void handleRestartSession(id),
              findInTerminal: openFind,
              endSession: requestEndSession,
              toggleShell: handleShellToggle,
              openPreferences: () => setShowPreferences(true),
              runToolkitCommand: handleToolkitExecute,
            },
          })}
          onClose={() => setPaletteOpen(false)}
        />
      )}

    </div>
  );
}
