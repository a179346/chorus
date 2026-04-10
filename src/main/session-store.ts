import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  Session,
  PersistedSession,
  AppState,
  NewSessionDefaults,
  TerminalSettings,
  ToolkitCommand,
  WindowBounds,
  PanelSizes,
} from '../shared/types';

const CHORUS_DIR = path.join(os.homedir(), '.chorus');
const SESSIONS_FILE = path.join(CHORUS_DIR, 'sessions.json');
const STATE_FILE = path.join(CHORUS_DIR, 'state.json');
const TOOLKIT_FILE = path.join(CHORUS_DIR, 'toolkit.json');

const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  x: 100,
  y: 100,
  width: 1400,
  height: 900,
};

const DEFAULT_PANEL_SIZES: PanelSizes = {
  sidebarWidth: 350,
  shellHeight: 200,
  toolkitHeight: 200,
  shellCollapsed: false,
};

const DEFAULT_NEW_SESSION_DEFAULTS: NewSessionDefaults = {
  cwd: os.homedir(),
  flags: [],
  notifyOnIdle: false,
};

const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontFamily: "'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Fira Code', monospace",
};

const DEFAULT_APP_STATE: AppState = {
  windowBounds: DEFAULT_WINDOW_BOUNDS,
  panelSizes: DEFAULT_PANEL_SIZES,
  lastActiveSessionId: null,
  newSessionDefaults: DEFAULT_NEW_SESSION_DEFAULTS,
  terminalSettings: DEFAULT_TERMINAL_SETTINGS,
};

function ensureDir(): void {
  if (!fs.existsSync(CHORUS_DIR)) {
    fs.mkdirSync(CHORUS_DIR, { recursive: true });
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir();
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function sessionFilePath(id: string): string {
  return path.join(CHORUS_DIR, `session-${id}.json`);
}

// ─── Sessions ─────────────────────────────────────────────

/** sessions.json now only stores an array of session IDs. */
interface SessionsIndex {
  sessionIds: string[];
}

export class SessionStore {
  private sessions: Map<string, Session> = new Map();

  /** Load persisted sessions from disk. Reads the index, then each session file. */
  loadPersistedSessions(): PersistedSession[] {
    const index = readJson<SessionsIndex>(SESSIONS_FILE, { sessionIds: [] });
    const results: PersistedSession[] = [];

    for (const id of index.sessionIds) {
      const session = readJson<PersistedSession | null>(sessionFilePath(id), null);
      if (session) {
        results.push(session);
      }
    }

    return results;
  }

  /** Add a runtime session (after PTY is spawned). */
  addSession(session: Session): void {
    this.sessions.set(session.id, session);
  }

  getSession(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  updateSession(id: string, updates: Partial<Session>): Session | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    Object.assign(session, updates);
    session.lastActiveAt = Date.now();
    return session;
  }

  /** Reorder sessions to match the given ID order. */
  reorderSessions(sessionIds: string[]): void {
    const ordered = new Map<string, Session>();
    for (const id of sessionIds) {
      const session = this.sessions.get(id);
      if (session) ordered.set(id, session);
    }
    // Append any sessions not in the list (shouldn't happen, but safe)
    for (const [id, session] of this.sessions) {
      if (!ordered.has(id)) ordered.set(id, session);
    }
    this.sessions = ordered;
    this.persistSessionIndex();
  }

  removeSession(id: string): void {
    this.sessions.delete(id);

    // Delete session file
    try {
      const fp = sessionFilePath(id);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // Best-effort cleanup
    }

    // Update index
    this.persistSessionIndex();
  }

  /** Persist current sessions to disk. Writes index + individual session files. */
  persistSessions(): void {
    const activeSessions = this.getAllSessions().filter((s) => s.status !== 'ended');

    // Write each session file
    for (const s of activeSessions) {
      const persisted: PersistedSession = {
        id: s.id,
        name: s.name,
        cwd: s.cwd,
        worktree: s.worktree,
        flags: s.flags,
        notifyOnIdle: s.notifyOnIdle,
        unread: s.unread,
        model: s.model,
        contextUsage: s.contextUsage,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        hasUserInput: s.hasUserInput,
      };
      writeJson(sessionFilePath(s.id), persisted);
    }

    // Write index
    writeJson(SESSIONS_FILE, { sessionIds: activeSessions.map((s) => s.id) });
  }

  /** Delete session-*.json files whose ID is not in the current index. */
  cleanupOrphanedSessionFiles(): void {
    const index = readJson<SessionsIndex>(SESSIONS_FILE, { sessionIds: [] });
    const activeIds = new Set(index.sessionIds);
    try {
      const files = fs.readdirSync(CHORUS_DIR);
      for (const file of files) {
        const match = file.match(/^session-(.+)\.json$/);
        if (!match) continue;
        if (!activeIds.has(match[1])) {
          fs.unlinkSync(path.join(CHORUS_DIR, file));
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private persistSessionIndex(): void {
    const activeSessions = this.getAllSessions().filter((s) => s.status !== 'ended');
    writeJson(SESSIONS_FILE, { sessionIds: activeSessions.map((s) => s.id) });
  }

  // ─── App State ────────────────────────────────────────────

  loadAppState(): AppState {
    return readJson<AppState>(STATE_FILE, DEFAULT_APP_STATE);
  }

  saveAppState(partial: Partial<AppState>): void {
    const current = this.loadAppState();
    const merged: AppState = { ...current, ...partial };
    writeJson(STATE_FILE, merged);
  }

  getNewSessionDefaults(): NewSessionDefaults {
    const state = this.loadAppState();
    return state.newSessionDefaults;
  }

  // ─── Toolkit ──────────────────────────────────────────────

  loadToolkitCommands(): ToolkitCommand[] {
    const data = readJson<{ commands: ToolkitCommand[] }>(TOOLKIT_FILE, { commands: [] });
    return data.commands;
  }

  saveToolkitCommands(commands: ToolkitCommand[]): void {
    writeJson(TOOLKIT_FILE, { commands });
  }

  getToolkitCommands(): ToolkitCommand[] {
    return this.loadToolkitCommands();
  }
}
