import { app, BrowserWindow, Menu, ipcMain, dialog, Notification, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import pLimit from "p-limit";
import { IpcChannels, IpcErrorCodes } from "../shared/ipc";
import type {
  Session,
  SessionConfig,
  SessionIdPayload,
  SessionRenamePayload,
  SessionReorderPayload,
  PtyWritePayload,
  PtyResizePayload,
  ToolkitCommand,
  ToolkitExecutePayload,
  ToolkitListPayload,
  ToolkitSavePayload,
  AppState,
  PrRef,
  SessionStage,
} from "../shared/types";
import { SessionStore } from "./session-store";
import { PtyManager } from "./pty-manager";
import { HookServer } from "./hook-server";

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

// ─── Singletons ─────────────────────────────────────────────

const sessionStore = new SessionStore();
let mainWindow: BrowserWindow | null = null;
let activeSessionId: string | null = null;

// ─── Stage Refresh ──────────────────────────────────────────

const GH_TIMEOUT_MS = 10_000;
const GH_RETRY_AFTER_MS = 5 * 60 * 1000;
const STAGE_DEBOUNCE_MS = 1000;
const STAGE_POLL_INTERVAL_MS = 60_000;

const stageRefreshLimit = pLimit(4);
const stageRefreshInFlight: Map<string, Promise<void>> = new Map();
const stageRefreshDebouncers: Map<string, ReturnType<typeof setTimeout>> = new Map();
let ghAvailable = true;
let ghUnavailableUntil = 0;

type GhResult =
  | { type: 'ok'; stage: SessionStage }
  | { type: 'not-found' }
  | { type: 'unavailable' }
  | { type: 'error' };

function deriveStage(json: {
  state?: unknown;
  isDraft?: unknown;
  mergedAt?: unknown;
}): SessionStage {
  const state = typeof json.state === 'string' ? json.state.toUpperCase() : '';
  const isDraft = json.isDraft === true;
  const merged = json.mergedAt !== null && json.mergedAt !== undefined && json.mergedAt !== '';
  if (state === 'MERGED' || merged) return 'merged';
  if (state === 'CLOSED') return 'closed';
  if (state === 'OPEN') return isDraft ? 'draft' : 'ready';
  return 'no-pr';
}

function runGhPrView(pr: PrRef): Promise<GhResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: GhResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child;
    try {
      child = spawn(
        'gh',
        [
          'pr',
          'view',
          String(pr.number),
          '-R',
          `${pr.owner}/${pr.repo}`,
          '--json',
          'state,isDraft,mergedAt',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      settle({ type: 'unavailable' });
      return;
    }

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      settle({ type: 'error' });
    }, GH_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') settle({ type: 'unavailable' });
      else settle({ type: 'error' });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        try {
          settle({ type: 'ok', stage: deriveStage(JSON.parse(stdout)) });
        } catch {
          settle({ type: 'error' });
        }
        return;
      }
      const msg = stderr.toLowerCase();
      if (msg.includes('not authenticated') || msg.includes('command not found')) {
        settle({ type: 'unavailable' });
      } else if (msg.includes('not found') || msg.includes('could not resolve')) {
        settle({ type: 'not-found' });
      } else {
        settle({ type: 'error' });
      }
    });
  });
}

function pushSessionState(payload: Record<string, unknown> & { sessionId: string }): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannels.SESSION_STATE, payload);
  }
}

function refreshStage(sessionId: string): Promise<void> {
  const session = sessionStore.getSession(sessionId);
  if (!session || !session.pr || session.status === 'ended') return Promise.resolve();

  const existing = stageRefreshInFlight.get(sessionId);
  if (existing) return existing;

  if (!ghAvailable && Date.now() < ghUnavailableUntil) return Promise.resolve();

  const promise = stageRefreshLimit(async () => {
    const s = sessionStore.getSession(sessionId);
    if (!s || !s.pr || s.status === 'ended') return;

    const result = await runGhPrView(s.pr);

    const after = sessionStore.getSession(sessionId);
    if (!after || after.status === 'ended') return;

    if (result.type === 'unavailable') {
      ghAvailable = false;
      ghUnavailableUntil = Date.now() + GH_RETRY_AFTER_MS;
      return;
    }
    if (result.type === 'error') return;

    ghAvailable = true;
    const ts = Date.now();

    if (result.type === 'not-found') {
      const changed = after.pr !== null || after.stage !== 'no-pr';
      if (changed) {
        sessionStore.updateSession(sessionId, {
          pr: null,
          stage: 'no-pr',
          stageUpdatedAt: ts,
        });
        sessionStore.persistSessions();
        pushSessionState({ sessionId, pr: null, stage: 'no-pr', stageUpdatedAt: ts });
      } else {
        after.stageUpdatedAt = ts;
      }
      return;
    }

    if (after.stage !== result.stage) {
      sessionStore.updateSession(sessionId, {
        stage: result.stage,
        stageUpdatedAt: ts,
      });
      sessionStore.persistSessions();
      pushSessionState({ sessionId, stage: result.stage, stageUpdatedAt: ts });
    } else {
      after.stageUpdatedAt = ts;
    }
  }).finally(() => {
    stageRefreshInFlight.delete(sessionId);
  });

  stageRefreshInFlight.set(sessionId, promise);
  return promise;
}

function scheduleRefresh(sessionId: string | null): void {
  if (!sessionId) return;
  const existing = stageRefreshDebouncers.get(sessionId);
  if (existing) clearTimeout(existing);
  stageRefreshDebouncers.set(
    sessionId,
    setTimeout(() => {
      stageRefreshDebouncers.delete(sessionId);
      void refreshStage(sessionId);
    }, STAGE_DEBOUNCE_MS),
  );
}

function cleanupStageRefresh(sessionId: string): void {
  stageRefreshInFlight.delete(sessionId);
  const t = stageRefreshDebouncers.get(sessionId);
  if (t) {
    clearTimeout(t);
    stageRefreshDebouncers.delete(sessionId);
  }
}

function refreshAllStages(): void {
  for (const s of sessionStore.getAllSessions()) {
    if (s.pr && s.status !== 'ended') void refreshStage(s.id);
  }
}

function handlePrDetected(sessionId: string, pr: PrRef): void {
  const session = sessionStore.getSession(sessionId);
  if (!session || session.status === 'ended') return;
  const current = session.pr;
  if (
    current &&
    current.owner === pr.owner &&
    current.repo === pr.repo &&
    current.number === pr.number
  ) {
    void refreshStage(sessionId);
    return;
  }
  sessionStore.updateSession(sessionId, { pr });
  sessionStore.persistSessions();
  pushSessionState({ sessionId, pr });
  void refreshStage(sessionId);
}

const hookServer = new HookServer((sessionId, update) => {
  const updates: Partial<Session> = { status: update.status };
  if (update.status === "thinking") updates.hasUserInput = true;
  if (update.model !== undefined) updates.model = update.model;
  if (update.contextUsage !== undefined)
    updates.contextUsage = update.contextUsage;

  // Check flags before updating (need previous status)
  const session = sessionStore.getSession(sessionId);
  const becameIdle =
    session &&
    (session.status === "thinking" || session.status === "generating") &&
    (update.status === "idle" || update.status === "waiting");

  // Mark unread if session finished and it's not the one the user is looking at
  if (becameIdle) {
    const isWindowFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
    if (!isWindowFocused || sessionId !== activeSessionId) {
      updates.unread = true;
    }
  }

  const shouldNotify = session?.notifyOnIdle && becameIdle;

  sessionStore.updateSession(sessionId, updates);
  if (updates.unread !== undefined) updateDockBadge();

  if (shouldNotify && session) {
    const isWindowFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();

    if (!isWindowFocused) {
      const statusLabel = update.status === "idle" ? "Idle" : "Waiting for input";
      new Notification({
        title: session.name,
        body: `Session is now ${statusLabel}`,
        silent: false,
      }).show();
    }
  }

  // Push only defined fields to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    const payload: Record<string, unknown> = {
      sessionId,
      status: update.status,
    };
    if (update.status === "thinking") payload.hasUserInput = true;
    if (update.model !== undefined) payload.model = update.model;
    if (update.contextUsage !== undefined)
      payload.contextUsage = update.contextUsage;
    if (updates.unread !== undefined) payload.unread = updates.unread;
    mainWindow.webContents.send(IpcChannels.SESSION_STATE, payload);
  }
}, handlePrDetected);

const ptyManager = new PtyManager();

function updateDockBadge(): void {
  const count = sessionStore.getAllSessions().filter((s) => s.unread).length;
  app.dock?.setBadge(count > 0 ? String(count) : '');
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

async function createSessionFromConfig(
  config: SessionConfig,
): Promise<Session> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const cwd = validateCwd(config.cwd);
  const worktree = config.worktree || null;

  const session: Session = {
    id,
    name: config.name,
    cwd,
    worktree,
    status: "creating",
    model: null,
    contextUsage: null,
    gitBranch: null,
    flags: config.flags,
    notifyOnIdle: false,
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

  // Spawn PTYs
  try {
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
  return session;
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
    if (!activeSessionId) return;
    scheduleRefresh(activeSessionId);
    const session = sessionStore.getSession(activeSessionId);
    if (session?.unread) {
      session.unread = false;
      updateDockBadge();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannels.SESSION_STATE, {
          sessionId: activeSessionId,
          unread: false,
        });
      }
    }
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
          label: "Preferences\u2026",
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

function registerIpcHandlers(): void {
  // --- Session management ---

  ipcMain.handle(
    IpcChannels.SESSION_CREATE,
    async (_event, config: SessionConfig): Promise<Session> => {
      const session = await createSessionFromConfig(config);
      activeSessionId = session.id;
      sessionStore.saveAppState({
        newSessionDefaults: { cwd: config.cwd, flags: config.flags, notifyOnIdle: false },
        lastActiveSessionId: session.id,
      });
      sessionStore.persistSessions();
      return session;
    },
  );

  ipcMain.handle(IpcChannels.SESSION_LIST, (): Session[] => {
    return sessionStore.getAllSessions();
  });

  ipcMain.handle(
    IpcChannels.SESSION_GET,
    (_event, payload: SessionIdPayload): Session | null => {
      return sessionStore.getSession(payload.id);
    },
  );

  ipcMain.handle(
    IpcChannels.SESSION_RENAME,
    (_event, payload: SessionRenamePayload): Session => {
      const session = sessionStore.updateSession(payload.id, {
        name: payload.name,
      });
      if (!session)
        throw ipcError(
          IpcErrorCodes.SESSION_NOT_FOUND,
          `Session not found: ${payload.id}`,
        );
      sessionStore.persistSessions();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannels.SESSION_STATE, {
          sessionId: payload.id,
          name: payload.name,
        });
      }
      return session;
    },
  );

  ipcMain.handle(
    IpcChannels.SESSION_END,
    (_event, payload: SessionIdPayload): void => {
      const session = sessionStore.getSession(payload.id);
      if (!session)
        throw ipcError(
          IpcErrorCodes.SESSION_NOT_FOUND,
          `Session not found: ${payload.id}`,
        );
      ptyManager.kill(payload.id);
      sessionStore.updateSession(payload.id, { status: "ended" });
      cleanupStageRefresh(payload.id);
      sessionStore.removeSession(payload.id);
      sessionStore.persistSessions();
    },
  );

  ipcMain.handle(
    IpcChannels.SESSION_SWITCH,
    (_event, payload: SessionIdPayload): Session => {
      const session = sessionStore.getSession(payload.id);
      if (!session)
        throw ipcError(
          IpcErrorCodes.SESSION_NOT_FOUND,
          `Session not found: ${payload.id}`,
        );
      activeSessionId = payload.id;
      sessionStore.saveAppState({ lastActiveSessionId: payload.id });
      session.lastActiveAt = Date.now();
      scheduleRefresh(payload.id);
      if (session.unread) {
        session.unread = false;
        updateDockBadge();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcChannels.SESSION_STATE, {
            sessionId: payload.id,
            unread: false,
          });
        }
      }
      return session;
    },
  );

  ipcMain.handle(
    IpcChannels.SESSION_TOGGLE_NOTIFY,
    (_event, payload: SessionIdPayload): Session => {
      const session = sessionStore.getSession(payload.id);
      if (!session)
        throw ipcError(
          IpcErrorCodes.SESSION_NOT_FOUND,
          `Session not found: ${payload.id}`,
        );
      sessionStore.updateSession(payload.id, {
        notifyOnIdle: !session.notifyOnIdle,
      });
      sessionStore.persistSessions();
      return sessionStore.getSession(payload.id)!;
    },
  );

  ipcMain.handle(
    IpcChannels.SESSION_REORDER,
    (_event, payload: SessionReorderPayload): void => {
      sessionStore.reorderSessions(payload.sessionIds);
    },
  );

  // --- PTY I/O ---

  ipcMain.handle(
    IpcChannels.PTY_WRITE,
    (_event, payload: PtyWritePayload): void => {
      ptyManager.writeToClaude(payload.sessionId, payload.data);
    },
  );

  ipcMain.handle(
    IpcChannels.PTY_RESIZE,
    (_event, payload: PtyResizePayload): void => {
      ptyManager.resizeClaude(payload.sessionId, payload.cols, payload.rows);
    },
  );

  // --- Shell terminal ---

  ipcMain.handle(
    IpcChannels.SHELL_WRITE,
    (_event, payload: PtyWritePayload): void => {
      ptyManager.writeToShell(payload.sessionId, payload.data);
    },
  );

  ipcMain.handle(
    IpcChannels.SHELL_RESIZE,
    (_event, payload: PtyResizePayload): void => {
      ptyManager.resizeShell(payload.sessionId, payload.cols, payload.rows);
    },
  );

  // --- Toolkit ---

  ipcMain.handle(IpcChannels.TOOLKIT_LIST, () => {
    return sessionStore.getToolkitCommands();
  });

  ipcMain.handle(
    IpcChannels.TOOLKIT_SAVE,
    (_event, payload: ToolkitSavePayload): void => {
      sessionStore.saveToolkitCommands(payload.commands);
    },
  );

  ipcMain.handle(
    IpcChannels.TOOLKIT_EXECUTE,
    (_event, payload: ToolkitExecutePayload): void => {
      const commands = sessionStore.loadToolkitCommands();
      const cmd = commands.find((c) => c.id === payload.commandId);
      if (!cmd) return;
      ptyManager.writeToClaude(payload.sessionId, cmd.command);
    },
  );

  ipcMain.handle(
    IpcChannels.TOOLKIT_ADD,
    (_event, command: ToolkitCommand): ToolkitCommand => {
      const commands = sessionStore.loadToolkitCommands();
      commands.push(command);
      sessionStore.saveToolkitCommands(commands);
      return command;
    },
  );

  ipcMain.handle(
    IpcChannels.TOOLKIT_UPDATE,
    (_event, command: ToolkitCommand): ToolkitCommand => {
      const commands = sessionStore.loadToolkitCommands();
      const idx = commands.findIndex((c) => c.id === command.id);
      if (idx !== -1) {
        commands[idx] = command;
      }
      sessionStore.saveToolkitCommands(commands);
      return command;
    },
  );

  ipcMain.handle(
    IpcChannels.TOOLKIT_DELETE,
    (_event, payload: SessionIdPayload): void => {
      const commands = sessionStore.loadToolkitCommands();
      const filtered = commands.filter((c) => c.id !== payload.id);
      sessionStore.saveToolkitCommands(filtered);
    },
  );

  // --- App state ---

  ipcMain.handle(IpcChannels.APP_GET_STATE, (): AppState => {
    return sessionStore.loadAppState();
  });

  ipcMain.handle(
    IpcChannels.APP_SAVE_STATE,
    (_event, partial: Partial<AppState>): void => {
      if (partial.lastActiveSessionId !== undefined) {
        activeSessionId = partial.lastActiveSessionId;
      }
      sessionStore.saveAppState(partial);
    },
  );

  ipcMain.handle(IpcChannels.APP_GET_NEW_SESSION_DEFAULTS, () => {
    return sessionStore.getNewSessionDefaults();
  });

  // --- Dialog ---

  ipcMain.handle(
    IpcChannels.DIALOG_SELECT_DIRECTORY,
    async (): Promise<string | null> => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  );

  // --- Shell utilities ---

  ipcMain.handle(
    IpcChannels.SHELL_OPEN_EXTERNAL,
    async (_event: Electron.IpcMainInvokeEvent, payload: { url: string }) => {
      await shell.openExternal(payload.url);
    },
  );
}

// ─── Session Restoration ────────────────────────────────────

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
      ptyManager.spawn(ps.id, spawnCwd, resumeFlags, resolvedCwd);
      const session: Session = {
        id: ps.id,
        name: ps.name,
        cwd: resolvedCwd,
        worktree: ps.worktree ?? null,
        status: "creating",
        model: ps.model ?? null,
        contextUsage: ps.contextUsage ?? null,
        gitBranch: null,
        flags: ps.flags,
        notifyOnIdle: ps.notifyOnIdle ?? false,
        unread: ps.unread ?? false,
        createdAt: ps.createdAt,
        lastActiveAt: ps.lastActiveAt,
        hasUserInput: ps.hasUserInput,
        pr: ps.pr ?? null,
        stage: ps.stage ?? "no-pr",
        stageUpdatedAt: ps.stageUpdatedAt ?? null,
      };
      sessionStore.addSession(session);
    } catch {
      // Skip sessions that fail to restore
    }
  }
}

// ─── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(async () => {
  // Initialize active session from persisted state
  activeSessionId = sessionStore.loadAppState().lastActiveSessionId;

  // Start hook server before spawning any sessions
  await hookServer.start();
  ptyManager.setHookServer(hookServer);

  createMenu();
  registerIpcHandlers();
  createWindow();
  restoreSessions();

  refreshAllStages();
  setInterval(refreshAllStages, STAGE_POLL_INTERVAL_MS);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  sessionStore.persistSessions();
  sessionStore.cleanupOrphanedSessionFiles();
  ptyManager.killAll();
  hookServer.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
