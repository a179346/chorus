import { app, BrowserWindow, Menu, ipcMain, dialog, Notification, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { IpcChannels, IpcErrorCodes } from "../shared/ipc";
import type { IpcInvokeMap } from "../shared/ipc";
import type { PrRef, Session, SessionConfig } from "../shared/types";
import { parsePrUrl } from "../shared/pr-url";
import { SessionStore, fromPersisted } from "./session-store";
import { SessionState } from "./session-state";
import { StageMonitor } from "./stage-monitor";
import { PtyManager } from "./pty-manager";
import { HookServer } from "./hook-server";
import { HookInstaller } from "./hook-installer";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// ─── App Name & Icon ────────────────────────────────────────
// In dev mode, app.name defaults to "Electron". Set it explicitly.
app.name = "Chorus";

// Fix PATH for packaged app (macOS GUI apps don't inherit shell PATH)
if (app.isPackaged) {
  try {
    const userShell = process.env.SHELL || "/bin/zsh";
    const shellPath = execSync(`${userShell} -ilc 'printf "%s" "$PATH"'`, {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {
    // Fall back to appending common paths
    process.env.PATH = [
      process.env.PATH,
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${process.env.HOME}/.local/bin`,
    ].join(":");
  }
}

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

const sessionState = new SessionState(sessionStore, {
  broadcast: (update) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.SESSION_STATE, update);
    }
  },
  isWindowFocused: () =>
    !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused(),
  showNotification: (title, body) => {
    new Notification({ title, body, silent: false }).show();
  },
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
  (sessionId, pr) => stageMonitor.handlePrDetected(sessionId, pr),
  (sessionId) => sessionStore.getSession(sessionId)?.contextLimit ?? null,
);

const hookInstaller = new HookInstaller(() => hookServer.getPort());

const ptyManager = new PtyManager();
ptyManager.setExitHandler((sessionId, exitCode) =>
  sessionState.handleClaudeExit(sessionId, exitCode),
);

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

  let pr: PrRef | null = null;
  if (config.prUrl?.trim()) {
    pr = parsePrUrl(config.prUrl);
    if (!pr) {
      throw ipcError(
        IpcErrorCodes.INVALID_PR_URL,
        `Not a GitHub PR URL: ${config.prUrl}`,
      );
    }
  }

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
    pr: null,
    stage: "no-pr",
    stageUpdatedAt: null,
  };

  const worktreeCwd = worktree
    ? path.join(cwd, ".claude", "worktrees", worktree)
    : cwd;

  const worktreeDirExists = !!worktree && fs.existsSync(worktreeCwd);

  const spawnCwd = worktreeDirExists ? worktreeCwd : cwd;

  // Use --session-id so Claude Code uses our ID (enables precise resume later)
  // If worktree specified, let Claude Code handle worktree creation via --worktree flag
  const spawnFlags = [...config.flags, "--session-id", id, "--name", config.name];
  if (worktree && !worktreeDirExists) {
    spawnFlags.push("--worktree", worktree);
  }

  // Spawn PTYs (hooks must be on disk before claude starts)
  try {
    hookInstaller.ensureInstalled(spawnCwd);
    ptyManager.spawn(id, spawnCwd, spawnFlags, cwd);
  } catch (err) {
    throw ipcError(
      IpcErrorCodes.PTY_SPAWN_FAILED,
      `Failed to spawn PTY: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Session stays in 'creating' status — the renderer / PTY output parser
  // will transition to 'idle' once the Claude prompt is detected.
  sessionStore.addSession(session);
  if (pr) {
    // Link the PR now (synchronously sets session.pr) and kick off a stage lookup
    stageMonitor.handlePrDetected(id, pr);
  }
  return session;
}

function restoreSessions(): void {
  const persisted = sessionStore.loadPersistedSessions().filter((ps) => ps.hasUserInput);
  for (const ps of persisted) {
    const resolvedCwd = path.resolve(ps.cwd);
    if (!fs.existsSync(resolvedCwd)) continue;

    try {
      // Use --resume <id> to restore the exact Claude Code session
      // For worktree sessions, resume from the worktree directory
      const spawnCwd = ps.worktree
        ? path.join(resolvedCwd, ".claude", "worktrees", ps.worktree)
        : resolvedCwd;
      if (!fs.existsSync(spawnCwd)) continue;

      const resumeFlags = [...ps.flags, "--resume", ps.id];
      hookInstaller.ensureInstalled(spawnCwd);
      ptyManager.spawn(ps.id, spawnCwd, resumeFlags, resolvedCwd);
      sessionStore.addSession(fromPersisted(ps, resolvedCwd));
    } catch {
      // Skip sessions that fail to restore
    }
  }
  sessionState.refreshUnreadBadge();
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
    if (!activeId) return;
    stageMonitor.scheduleRefresh(activeId);
    sessionState.markRead(activeId);
  });

  mainWindow.on("closed", () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    ptyManager.setMainWindow(null);
    mainWindow = null;
  });
}

// ─── Menu ───────────────────────────────────────────────────

function createMenu(): void {
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

  [IpcChannels.SESSION_LIST]: () => sessionStore.getAllSessions(),

  [IpcChannels.SESSION_GET]: ({ id }) => sessionStore.getSession(id),

  [IpcChannels.SESSION_RENAME]: ({ id, name }) => {
    requireSession(id);
    return sessionState.commit(id, { name })!;
  },

  [IpcChannels.SESSION_END]: ({ id }) => {
    requireSession(id);
    ptyManager.kill(id);
    sessionStore.updateSession(id, { status: "ended" });
    stageMonitor.forget(id);
    sessionStore.removeSession(id);
    sessionStore.persistSessions();
    sessionState.refreshUnreadBadge();
  },

  [IpcChannels.SESSION_SWITCH]: ({ id }) => {
    const session = requireSession(id);
    sessionState.setActiveSession(id);
    sessionStore.saveAppState({ lastActiveSessionId: id });
    session.lastActiveAt = Date.now();
    stageMonitor.scheduleRefresh(id);
    sessionState.markRead(id);
    return session;
  },

  [IpcChannels.SESSION_TOGGLE_NOTIFY]: ({ id }) => {
    const session = requireSession(id);
    return sessionState.commit(id, { notifyOnIdle: !session.notifyOnIdle })!;
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

  // Start hook server before spawning any sessions
  await hookServer.start();

  createMenu();
  registerIpcHandlers();
  createWindow();
  restoreSessions();

  stageMonitor.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  sessionStore.persistSessions();
  sessionStore.cleanupOrphanedSessionFiles();
  stageMonitor.stop();
  ptyManager.killAll();
  hookServer.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
