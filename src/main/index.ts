import { app, BrowserWindow, Menu, ipcMain, dialog, Notification, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { IpcChannels, IpcErrorCodes } from "../shared/ipc";
import type { IpcInvokeMap } from "../shared/ipc";
import type { PrRef, Session, SessionConfig, StoredSession } from "../shared/types";
import { parsePrUrl } from "../shared/pr-ref";
import { checkSessionFlags, newSessionArgs, relaunchArgs } from "../shared/claude-cli";
import { SessionStore, fromPersisted } from "./session-store";
import { SessionState } from "./session-state";
import { StageMonitor } from "./stage-monitor";
import { PtyManager } from "./pty-manager";
import { HookServer } from "./hook-server";
import { HookInstaller } from "./hook-installer";
import { fallbackPath, readLoginShellEnv, resolveShellEnv, userShell } from "./shell-env";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// ─── App Name & Icon ────────────────────────────────────────
// In dev mode, app.name defaults to "Electron". Set it explicitly.
app.name = "Chorus";

// Enable remote debugging in dev mode for testing
if (!app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
}

// Set dock icon in dev mode (production uses packaged Info.plist)
if (!app.isPackaged) {
  const iconPath = path.join(
    __dirname,
    "..",
    "..",
    "assets",
    "icons",
    "icon.png",
  );
  if (fs.existsSync(iconPath)) {
    const { nativeImage } = require("electron");
    app.dock?.setIcon(nativeImage.createFromPath(iconPath));
  }
}

// ─── Composition ────────────────────────────────────────────

const sessionStore = new SessionStore();
let mainWindow: BrowserWindow | null = null;

// One live notification per session. Holding the reference matters: a
// garbage-collected Notification silently stops delivering its click event.
const sessionNotifications = new Map<string, Notification>();

function showSessionNotification(sessionId: string, title: string, body: string): void {
  // A newer notification supersedes the session's previous one
  sessionNotifications.get(sessionId)?.close();

  const notification = new Notification({ title, body, silent: false });
  const release = (): void => {
    if (sessionNotifications.get(sessionId) === notification) {
      sessionNotifications.delete(sessionId);
    }
  };
  notification.on("click", () => {
    release();
    revealSession(sessionId);
  });
  notification.on("close", release);
  sessionNotifications.set(sessionId, notification);
  notification.show();
}

function dismissSessionNotification(sessionId: string): void {
  sessionNotifications.get(sessionId)?.close();
  sessionNotifications.delete(sessionId);
}

/** Bring the window forward and have the renderer switch to the session. */
function revealSession(sessionId: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const sessionExists = sessionStore.getSession(sessionId) !== null;
  // Before focusing: the focus handler marks the active session read
  if (sessionExists) sessionState.setActiveSession(sessionId);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (sessionExists) {
    mainWindow.webContents.send(IpcChannels.SESSION_REVEAL, { id: sessionId });
  }
}

/** The user is looking at the session: refresh its PRs, and clear its unread mark and notification. */
function markSessionSeen(sessionId: string): void {
  stageMonitor.scheduleRefresh(sessionId);
  sessionState.markRead(sessionId);
  dismissSessionNotification(sessionId);
}

const sessionState = new SessionState(sessionStore, {
  broadcast: (update) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.SESSION_STATE, update);
    }
  },
  isWindowFocused: () =>
    !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused(),
  showNotification: showSessionNotification,
  setUnreadCount: (count) => {
    app.dock?.setBadge(count > 0 ? String(count) : "");
  },
});

const stageMonitor = new StageMonitor({
  getSession: (id) => sessionStore.getSession(id),
  getAllSessions: () => sessionStore.getAllSessions(),
  commit: (sessionId, updates) => void sessionState.commit(sessionId, updates),
});

const hookServer = new HookServer(
  (sessionId, update) => sessionState.applyHookUpdate(sessionId, update),
  (sessionId, prs) => stageMonitor.linkPrs(sessionId, prs),
  (sessionId) => sessionStore.getSession(sessionId)?.contextLimit ?? null,
);

const hookInstaller = new HookInstaller(() => hookServer.getPort());

const ptyManager = new PtyManager();
ptyManager.setExitHandler((sessionId, exitCode) =>
  sessionState.handleClaudeExit(sessionId, exitCode),
);

/**
 * Restoring the saved sessions, which runs once process.env holds the
 * login-shell environment. Until then the store is empty: whatever lists or
 * spawns sessions waits for `done`. Saving the store on quit is only safe once
 * the restore `succeeded`; otherwise it would erase the saved sessions.
 */
class SessionRestore {
  private outcome: "pending" | "succeeded" | "failed" = "pending";
  private markDone: () => void = () => {};
  /** Resolves once the restore has run, whether or not it succeeded. */
  readonly done = new Promise<void>((resolve) => {
    this.markDone = resolve;
  });

  get succeeded(): boolean {
    return this.outcome === "succeeded";
  }

  finish(outcome: "succeeded" | "failed"): void {
    this.outcome = outcome;
    this.markDone();
  }
}

const sessionRestore = new SessionRestore();

// ─── Shell Environment ──────────────────────────────────────

/**
 * Give every process Chorus spawns the user's login-shell environment. Only
 * the packaged app needs this: `npm start` already inherits the terminal's.
 */
async function adoptLoginShellEnv(): Promise<void> {
  const shell = userShell();
  const env = await resolveShellEnv(() => readLoginShellEnv(shell), confirmShellEnvRetry);
  if (env) {
    Object.assign(process.env, env);
  } else {
    process.env.PATH = fallbackPath(process.env.PATH, os.homedir());
  }
}

async function confirmShellEnvRetry(error: Error): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: "Couldn't load your shell environment",
    detail:
      `${error.message}\n\n` +
      "Sessions start once this is resolved. If you continue without it, " +
      "they get a minimal PATH, so tools set up by your shell profile " +
      "(nvm, asdf and the like) may be missing until you relaunch Chorus.",
    buttons: ["Retry", "Continue"],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

// ─── Helpers ────────────────────────────────────────────────

class IpcHandlerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "IpcHandlerError";
  }
}

function ipcError(code: string, message: string): IpcHandlerError {
  return new IpcHandlerError(code, message);
}

function requireSession(id: string): Session {
  const session = sessionStore.getSession(id);
  if (!session)
    throw ipcError(IpcErrorCodes.SESSION_NOT_FOUND, `Session not found: ${id}`);
  return session;
}

function requirePrRef(url: string): PrRef {
  const pr = parsePrUrl(url);
  if (!pr) {
    throw ipcError(IpcErrorCodes.INVALID_PR_URL, `Not a GitHub PR URL: ${url}`);
  }
  return pr;
}

function validateCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  if (!fs.existsSync(resolved)) {
    throw ipcError(
      IpcErrorCodes.INVALID_DIRECTORY,
      `Directory does not exist: ${resolved}`,
    );
  }
  return resolved;
}

// ─── Session Launcher ───────────────────────────────────────

async function createSessionFromConfig(
  config: SessionConfig,
): Promise<Session> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const cwd = validateCwd(config.cwd);
  const worktree = config.worktree || null;
  const prs = (config.prUrls ?? []).map(requirePrRef);
  const flagsCheck = checkSessionFlags(config.flags);
  if (!flagsCheck.ok) throw ipcError(IpcErrorCodes.INVALID_FLAGS, flagsCheck.error);

  const session: Session = {
    id,
    name: config.name,
    cwd,
    worktree,
    status: "creating",
    model: null,
    contextUsage: null,
    contextLimit: null,
    flags: config.flags,
    notifyOnIdle: config.notifyOnIdle ?? false,
    unread: false,
    createdAt: now,
    lastActiveAt: now,
    hasUserInput: false,
    prs: [],
  };

  const worktreeCwd = sessionSpawnCwd(cwd, worktree);

  const worktreeDirExists = !!worktree && fs.existsSync(worktreeCwd);

  const spawnCwd = worktreeDirExists ? worktreeCwd : cwd;

  const claudeArgs = newSessionArgs({
    id,
    name: config.name,
    newWorktree: worktree && !worktreeDirExists ? worktree : null,
    flags: config.flags,
    prompt: config.prompt,
  });

  // Spawn PTYs (hooks must be on disk before claude starts)
  try {
    hookInstaller.ensureInstalled(spawnCwd);
    ptyManager.spawn(id, spawnCwd, claudeArgs, cwd);
  } catch (err) {
    throw ipcError(
      IpcErrorCodes.PTY_SPAWN_FAILED,
      `Failed to spawn PTY: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Session stays in 'creating' status — the renderer / PTY output parser
  // will transition to 'idle' once the Claude prompt is detected.
  sessionStore.addSession(session);
  if (prs.length > 0) {
    // Links synchronously (sets session.prs) and kicks off the stage lookups
    stageMonitor.linkPrs(id, prs);
  }
  return session;
}

/** Where a session's claude runs: inside its worktree when it has one. */
function sessionSpawnCwd(cwd: string, worktree: string | null): string {
  return worktree ? path.join(cwd, ".claude", "worktrees", worktree) : cwd;
}

/** Spawn a saved session's PTYs, resuming its conversation, and register it. */
function resumeStoredSession(stored: StoredSession): Session {
  const session = fromPersisted(stored, validateCwd(stored.cwd));
  const spawnCwd = validateCwd(sessionSpawnCwd(session.cwd, session.worktree));
  hookInstaller.ensureInstalled(spawnCwd);
  ptyManager.spawn(session.id, spawnCwd, relaunchArgs(session), session.cwd);
  sessionStore.addSession(session);
  return session;
}

function resumeSavedSessions(): void {
  const stored = sessionStore.loadPersistedSessions().filter((s) => s.hasUserInput);
  for (const s of stored) {
    try {
      resumeStoredSession(s);
    } catch {
      // Skip sessions that fail to restore (directory gone, spawn failure)
    }
  }
  sessionState.refreshUnreadBadge();
}

/**
 * Restore the saved sessions once the shell environment is in place, then
 * let whatever waits on the restore through, even if it failed.
 */
async function restoreSessions(shellEnvAdopted: Promise<void>): Promise<void> {
  try {
    await shellEnvAdopted;
    resumeSavedSessions();
    sessionRestore.finish("succeeded");
  } catch (err) {
    sessionRestore.finish("failed");
    void dialog.showMessageBox({
      type: "error",
      message: "Couldn't restore your sessions",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Reopen an ended session (the most recently closed one when no id is given)
 * and hand it to the renderer. Failures surface as a native dialog because
 * this runs from the menu, outside any renderer request.
 */
async function reopenClosedSession(id?: string): Promise<void> {
  await sessionRestore.done;
  const recentlyClosed = sessionStore.loadRecentlyClosed();
  const stored = id ? recentlyClosed.find((s) => s.id === id) : recentlyClosed[0];
  if (!stored) return;

  // Listed yet still open (its End Session was cut short): reopening would run a second claude on its id
  if (sessionStore.getSession(stored.id)) {
    sessionStore.forgetClosed(stored.id);
    createMenu();
    revealSession(stored.id);
    return;
  }

  let session: Session;
  try {
    session = resumeStoredSession(stored);
  } catch (err) {
    // A vanished directory never comes back; a spawn failure may be transient
    if (err instanceof IpcHandlerError && err.code === IpcErrorCodes.INVALID_DIRECTORY) {
      sessionStore.forgetClosed(stored.id);
    }
    void dialog.showMessageBox({
      type: "error",
      message: `Couldn't reopen "${stored.name}"`,
      detail: err instanceof Error ? err.message : String(err),
    });
    createMenu();
    return;
  }

  mainWindow?.webContents.send(IpcChannels.SESSION_OPENED, session);
  sessionStore.forgetClosed(stored.id);
  sessionStore.persistSessions();
  createMenu();
}

// ─── Window ─────────────────────────────────────────────────

function createWindow(): void {
  const appState = sessionStore.loadAppState();
  const bounds = appState.windowBounds;

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0d0d1a",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ptyManager.setMainWindow(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Save window bounds on move/resize (debounced to avoid disk thrashing)
  let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = (): void => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (!mainWindow) return;
      const b = mainWindow.getBounds();
      sessionStore.saveAppState({
        windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      });
    }, 500);
  };

  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  mainWindow.on("focus", () => {
    const activeId = sessionState.activeSessionId;
    if (activeId) markSessionSeen(activeId);
  });

  mainWindow.on("closed", () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    ptyManager.setMainWindow(null);
    mainWindow = null;
  });
}

// ─── Menu ───────────────────────────────────────────────────

/** Builds and installs the app menu; call again whenever the recently-closed list changes. */
function createMenu(): void {
  const recentlyClosed = sessionStore.loadRecentlyClosed();
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: "About Chorus",
          click: async () => {
            const result = await dialog.showMessageBox({
              type: "info",
              title: "About Chorus",
              message: "Chorus",
              detail: `Version ${app.getVersion()}\nMulti-session Claude Code terminal manager\n\nhttps://github.com/a179346/chorus`,
              buttons: ["OK", "GitHub"],
              defaultId: 0,
              icon: app.isPackaged
                ? undefined
                : path.join(
                    __dirname,
                    "..",
                    "..",
                    "assets",
                    "icons",
                    "icon.png",
                  ),
            });
            if (result.response === 1) {
              shell.openExternal("https://github.com/a179346/chorus");
            }
          },
        },
        { type: "separator" },
        {
          label: "Preferences…",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_PREFERENCES);
          },
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Session",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_NEW_SESSION);
          },
        },
        {
          label: "Close Session",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_CLOSE_SESSION);
          },
        },
        { type: "separator" },
        {
          label: "Reopen Closed Session",
          accelerator: "CmdOrCtrl+Shift+T",
          enabled: recentlyClosed.length > 0,
          click: () => void reopenClosedSession(),
        },
        {
          label: "Recently Closed",
          enabled: recentlyClosed.length > 0,
          submenu: recentlyClosed.map((ps) => ({
            label: `${ps.name} — ${path.basename(ps.cwd)}`,
            click: () => void reopenClosedSession(ps.id),
          })),
        },
      ],
    },
    {
      label: "Session",
      submenu: [
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Switch to Session ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_SWITCH_SESSION, {
              index: i,
            });
          },
        })),
        { type: "separator" as const },
        {
          label: "Previous Session",
          accelerator: "CmdOrCtrl+[",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_PREV_SESSION);
          },
        },
        {
          label: "Next Session",
          accelerator: "CmdOrCtrl+]",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_NEXT_SESSION);
          },
        },
        {
          label: "Next Session Needing Attention",
          accelerator: "CmdOrCtrl+J",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_NEXT_NEEDING_ATTENTION);
          },
        },
        { type: "separator" as const },
        {
          label: "Pull Requests…",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_PULL_REQUESTS);
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find",
          accelerator: "CmdOrCtrl+F",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_FIND);
          },
        },
        {
          label: "Find Next",
          accelerator: "CmdOrCtrl+G",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_FIND_NEXT);
          },
        },
        {
          label: "Find Previous",
          accelerator: "CmdOrCtrl+Shift+G",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_FIND_PREVIOUS);
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Command Palette…",
          accelerator: "CmdOrCtrl+K",
          click: () => {
            mainWindow?.webContents.send(IpcChannels.MENU_COMMAND_PALETTE);
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC Handlers ───────────────────────────────────────────
// One entry per invoke channel. The mapped type makes coverage exhaustive:
// adding a channel to IpcInvokeMap without a handler here is a compile error.

type InvokeHandlers = {
  [C in keyof IpcInvokeMap]: (
    payload: IpcInvokeMap[C]["payload"],
  ) => IpcInvokeMap[C]["response"] | Promise<IpcInvokeMap[C]["response"]>;
};

const invokeHandlers: InvokeHandlers = {
  // --- Session management ---

  [IpcChannels.SESSION_CREATE]: async (config) => {
    await sessionRestore.done;
    const session = await createSessionFromConfig(config);
    sessionState.setActiveSession(session.id);
    sessionStore.saveAppState({
      newSessionDefaults: {
        cwd: config.cwd,
        flags: config.flags,
        notifyOnIdle: config.notifyOnIdle ?? false,
      },
      lastActiveSessionId: session.id,
    });
    sessionStore.persistSessions();
    return session;
  },

  [IpcChannels.SESSION_LIST]: async () => {
    await sessionRestore.done;
    return sessionStore.getAllSessions();
  },

  [IpcChannels.SESSION_GET]: ({ id }) => sessionStore.getSession(id),

  [IpcChannels.SESSION_RENAME]: ({ id, name }) => {
    requireSession(id);
    sessionState.commit(id, { name });
    return requireSession(id);
  },

  [IpcChannels.SESSION_END]: ({ id }) => {
    const session = requireSession(id);
    ptyManager.kill(id);
    dismissSessionNotification(id);
    // Only a prompted session has a transcript Claude can --resume
    if (session.hasUserInput) {
      sessionStore.rememberClosed({ ...session, unread: false });
      createMenu();
    }
    stageMonitor.forget(id);
    sessionStore.removeSession(id);
    sessionStore.persistSessions();
    sessionState.refreshUnreadBadge();
  },

  [IpcChannels.SESSION_RESTART]: ({ id }) => {
    const session = requireSession(id);
    const spawnCwd = validateCwd(sessionSpawnCwd(session.cwd, session.worktree));
    try {
      hookInstaller.ensureInstalled(spawnCwd);
      ptyManager.restartClaude(id, spawnCwd, relaunchArgs(session));
    } catch (err) {
      throw ipcError(
        IpcErrorCodes.PTY_SPAWN_FAILED,
        `Failed to restart Claude Code: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    sessionState.commit(id, { status: "creating" });
    return requireSession(id);
  },

  [IpcChannels.SESSION_LINK_PR]: ({ id, url }) => {
    requireSession(id);
    stageMonitor.linkPrs(id, [requirePrRef(url)]);
    return requireSession(id);
  },

  [IpcChannels.SESSION_UNLINK_PR]: ({ id, pr }) => {
    requireSession(id);
    stageMonitor.unlinkPr(id, pr);
    return requireSession(id);
  },

  [IpcChannels.SESSION_SWITCH]: ({ id }) => {
    const session = requireSession(id);
    sessionState.setActiveSession(id);
    sessionStore.saveAppState({ lastActiveSessionId: id });
    session.lastActiveAt = Date.now();
    markSessionSeen(id);
    return session;
  },

  [IpcChannels.SESSION_TOGGLE_NOTIFY]: ({ id }) => {
    const session = requireSession(id);
    sessionState.commit(id, { notifyOnIdle: !session.notifyOnIdle });
    return requireSession(id);
  },

  [IpcChannels.SESSION_REORDER]: ({ sessionIds }) => {
    sessionStore.reorderSessions(sessionIds);
  },

  // --- PTY I/O ---

  [IpcChannels.PTY_WRITE]: ({ sessionId, data }) => {
    ptyManager.writeToClaude(sessionId, data);
  },

  [IpcChannels.PTY_RESIZE]: ({ sessionId, cols, rows }) => {
    ptyManager.resizeClaude(sessionId, cols, rows);
  },

  // --- Shell terminal ---

  [IpcChannels.SHELL_WRITE]: ({ sessionId, data }) => {
    ptyManager.writeToShell(sessionId, data);
  },

  [IpcChannels.SHELL_RESIZE]: ({ sessionId, cols, rows }) => {
    ptyManager.resizeShell(sessionId, cols, rows);
  },

  // --- Toolkit ---

  [IpcChannels.TOOLKIT_LIST]: () => sessionStore.loadToolkitCommands(),

  [IpcChannels.TOOLKIT_SAVE]: ({ commands }) => {
    sessionStore.saveToolkitCommands(commands);
  },

  [IpcChannels.TOOLKIT_EXECUTE]: ({ sessionId, commandId }) => {
    const commands = sessionStore.loadToolkitCommands();
    const cmd = commands.find((c) => c.id === commandId);
    if (!cmd) return;
    ptyManager.writeToClaude(sessionId, cmd.command);
  },

  [IpcChannels.TOOLKIT_ADD]: (command) => {
    const commands = sessionStore.loadToolkitCommands();
    commands.push(command);
    sessionStore.saveToolkitCommands(commands);
    return command;
  },

  [IpcChannels.TOOLKIT_UPDATE]: (command) => {
    const commands = sessionStore.loadToolkitCommands();
    const idx = commands.findIndex((c) => c.id === command.id);
    if (idx !== -1) {
      commands[idx] = command;
    }
    sessionStore.saveToolkitCommands(commands);
    return command;
  },

  [IpcChannels.TOOLKIT_DELETE]: ({ id }) => {
    const commands = sessionStore.loadToolkitCommands();
    const filtered = commands.filter((c) => c.id !== id);
    sessionStore.saveToolkitCommands(filtered);
  },

  // --- App state ---

  [IpcChannels.APP_GET_STATE]: () => sessionStore.loadAppState(),

  [IpcChannels.APP_SAVE_STATE]: (partial) => {
    if (partial.lastActiveSessionId !== undefined) {
      sessionState.setActiveSession(partial.lastActiveSessionId);
    }
    sessionStore.saveAppState(partial);
  },

  [IpcChannels.APP_GET_NEW_SESSION_DEFAULTS]: () =>
    sessionStore.getNewSessionDefaults(),

  // --- Dialog ---

  [IpcChannels.DIALOG_SELECT_DIRECTORY]: async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  },

  // --- Shell utilities ---

  [IpcChannels.SHELL_OPEN_EXTERNAL]: async ({ url }) => {
    await shell.openExternal(url);
  },
};

function registerIpcHandlers(): void {
  for (const channel of Object.keys(invokeHandlers) as (keyof IpcInvokeMap)[]) {
    const handler = invokeHandlers[channel] as (payload: unknown) => unknown;
    ipcMain.handle(channel, (_event, payload) => handler(payload));
  }
}

// ─── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(async () => {
  // Initialize active session from persisted state
  sessionState.setActiveSession(sessionStore.loadAppState().lastActiveSessionId);

  // A slow shell profile must not hold up the window; sessions wait on it instead
  const shellEnvAdopted = app.isPackaged ? adoptLoginShellEnv() : Promise.resolve();

  // Start hook server before spawning any sessions
  await hookServer.start();

  createMenu();
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  await restoreSessions(shellEnvAdopted);
  stageMonitor.start();
});

app.on("before-quit", () => {
  if (sessionRestore.succeeded) {
    sessionStore.persistSessions();
    sessionStore.cleanupOrphanedSessionFiles();
  }
  stageMonitor.stop();
  ptyManager.killAll();
  hookServer.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
