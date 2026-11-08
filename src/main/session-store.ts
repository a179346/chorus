import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isExitedStatus } from '../shared/types';
import type {
  Session,
  PersistedSession,
  StoredSession,
  LinkedPr,
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
const RECENTLY_CLOSED_FILE = path.join(CHORUS_DIR, 'recently-closed.json');

/** How many closed sessions stay reopenable. */
export const RECENTLY_CLOSED_LIMIT = 10;

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
  fontFamily: "'MesloLGS NF', 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Fira Code', monospace",
  theme: 'espresso',
  claudeFontSize: 13,
  shellFontSize: 13,
};

const DEFAULT_APP_STATE: AppState = {
  windowBounds: DEFAULT_WINDOW_BOUNDS,
  panelSizes: DEFAULT_PANEL_SIZES,
  lastActiveSessionId: null,
  newSessionDefaults: DEFAULT_NEW_SESSION_DEFAULTS,
  terminalSettings: DEFAULT_TERMINAL_SETTINGS,
  favoriteDirectories: [],
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

/** sessions.json only stores the session IDs, in sidebar order. */
interface SessionsIndex {
  sessionIds: string[];
}

/** Only the container is checked: Chorus alone writes the file. */
function isSessionsIndex(data: unknown): data is SessionsIndex {
  return typeof data === 'object' && data !== null && 'sessionIds' in data && Array.isArray(data.sessionIds);
}

/** The IDs in sessions.json; none when it is missing or holds something else. */
function readSessionIds(): string[] {
  const index = readJson<unknown>(SESSIONS_FILE, null);
  return isSessionsIndex(index) ? index.sessionIds : [];
}

// The Session ⇄ PersistedSession mapping lives in this pair and nowhere else.

export function toPersisted(s: Session): PersistedSession {
  return {
    id: s.id,
    name: s.name,
    cwd: s.cwd,
    worktree: s.worktree,
    flags: s.flags,
    notifyOnIdle: s.notifyOnIdle,
    unread: s.unread,
    model: s.model,
    contextUsage: s.contextUsage,
    contextLimit: s.contextLimit,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    hasUserInput: s.hasUserInput,
    prs: s.prs,
    exitStatus: isExitedStatus(s.status) ? s.status : null,
  };
}

function linkedPrsFromDisk(ps: StoredSession): LinkedPr[] {
  if (ps.prs) return ps.prs;
  if (!ps.pr) return [];
  const stage = ps.stage && ps.stage !== 'no-pr' ? ps.stage : 'unknown';
  return [{ ...ps.pr, stage, stageUpdatedAt: ps.stageUpdatedAt ?? null }];
}

/** Rebuild a runtime Session from disk. `cwd` may be re-resolved by the caller. */
export function fromPersisted(ps: StoredSession, cwd: string = ps.cwd): Session {
  return {
    id: ps.id,
    name: ps.name,
    cwd,
    worktree: ps.worktree,
    status: ps.exitStatus ?? 'creating',
    model: ps.model,
    contextUsage: ps.contextUsage,
    contextLimit: ps.contextLimit ?? null,
    flags: ps.flags,
    notifyOnIdle: ps.notifyOnIdle,
    unread: ps.unread,
    createdAt: ps.createdAt,
    lastActiveAt: ps.lastActiveAt,
    hasUserInput: ps.hasUserInput,
    prs: linkedPrsFromDisk(ps),
  };
}

/** recently-closed.json, most recently closed first. */
interface RecentlyClosedFile {
  sessions: StoredSession[];
}

/** Only the container is checked: Chorus alone writes the file. */
function isRecentlyClosedFile(data: unknown): data is RecentlyClosedFile {
  return typeof data === 'object' && data !== null && 'sessions' in data && Array.isArray(data.sessions);
}

// ─── Toolkit ──────────────────────────────────────────────

/** toolkit.json. People edit it by hand, so each command is checked as it is read. */
interface ToolkitFile {
  commands: unknown[];
}

function isToolkitFile(data: unknown): data is ToolkitFile {
  return typeof data === 'object' && data !== null && 'commands' in data && Array.isArray(data.commands);
}

/** A command as toolkit.json holds it: only its label and command are sure to be right. */
interface StoredToolkitCommand {
  id?: unknown;
  label: string;
  command: string;
  icon?: unknown;
}

function isStoredToolkitCommand(data: unknown): data is StoredToolkitCommand {
  return (
    typeof data === 'object' &&
    data !== null &&
    'label' in data &&
    typeof data.label === 'string' &&
    'command' in data &&
    typeof data.command === 'string'
  );
}

/**
 * The commands, each with a unique id: the id is how a command is run, edited
 * or deleted. A missing or repeated id is replaced by one derived from it, so
 * every load of the same file gives the same ids. An icon that isn't a name
 * is dropped.
 */
function toToolkitCommands(stored: readonly StoredToolkitCommand[]): ToolkitCommand[] {
  const taken = new Set<string>();
  return stored.map(({ id, label, command, icon }) => {
    const base = typeof id === 'string' && id !== '' ? id : 'command';
    let unique = base;
    for (let n = 2; taken.has(unique); n++) unique = `${base}-${n}`;
    taken.add(unique);
    return typeof icon === 'string' ? { id: unique, label, command, icon } : { id: unique, label, command };
  });
}

// ─── Store ────────────────────────────────────────────────

export class SessionStore {
  private sessions: Map<string, Session> = new Map();
  /**
   * Saved sessions that aren't in `sessions`: not restored yet, or their
   * restore failed. Writes keep them in the index, and cleanup keeps their
   * files, until they are restored or removed. Read from the index on first
   * use, so not even a write before the restore can drop them.
   */
  private unrestored: Set<string> | null = null;

  /**
   * The saved sessions, read from the index and then each session's file.
   * Each stays saved, though not listed, until it is added or removed.
   */
  loadPersistedSessions(): StoredSession[] {
    const results: StoredSession[] = [];

    for (const id of readSessionIds()) {
      const session = readJson<StoredSession | null>(sessionFilePath(id), null);
      if (session) {
        results.push(session);
      }
    }

    this.unrestored = new Set(results.map((s) => s.id).filter((id) => !this.sessions.has(id)));
    return results;
  }

  /** Add a runtime session (after PTY is spawned). */
  addSession(session: Session): void {
    this.unrestoredIds().delete(session.id);
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

  /** Remove a session, listed or saved and not restored, and delete its file. */
  removeSession(id: string): void {
    this.sessions.delete(id);
    this.unrestoredIds().delete(id);

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

  /**
   * Save each listed session to its own file, which records whether its
   * claude exited, and the index (unrestored sessions included). On relaunch,
   * each session with user input comes back as it was saved: claude resumes
   * its conversation, or, if it had exited, only the shell runs until the user
   * restarts it. One that can't come back goes to Recently Closed.
   */
  persistSessions(): void {
    for (const s of this.getAllSessions()) {
      writeJson(sessionFilePath(s.id), toPersisted(s));
    }
    this.persistSessionIndex();
  }

  /** Delete the session files of sessions the store holds neither listed nor unrestored. */
  cleanupOrphanedSessionFiles(): void {
    const keptIds = new Set(this.savedSessionIds());
    try {
      const files = fs.readdirSync(CHORUS_DIR);
      for (const file of files) {
        const match = file.match(/^session-(.+)\.json$/);
        if (!match) continue;
        if (!keptIds.has(match[1])) {
          fs.unlinkSync(path.join(CHORUS_DIR, file));
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private persistSessionIndex(): void {
    const index: SessionsIndex = { sessionIds: this.savedSessionIds() };
    writeJson(SESSIONS_FILE, index);
  }

  /** Listed sessions in sidebar order, then the unrestored ones. */
  private savedSessionIds(): string[] {
    return [...this.sessions.keys(), ...this.unrestoredIds()];
  }

  private unrestoredIds(): Set<string> {
    this.unrestored ??= new Set(readSessionIds().filter((id) => !this.sessions.has(id)));
    return this.unrestored;
  }

  // ─── Recently closed ──────────────────────────────────────

  /** Closed sessions that can be reopened, most recently closed first. */
  loadRecentlyClosed(): StoredSession[] {
    const file = readJson<unknown>(RECENTLY_CLOSED_FILE, null);
    return isRecentlyClosedFile(file) ? file.sessions : [];
  }

  /** Remember a closed session so it can be reopened later. */
  rememberClosed(session: Session): void {
    const rest = this.loadRecentlyClosed().filter((ps) => ps.id !== session.id);
    const sessions = [toPersisted(session), ...rest].slice(0, RECENTLY_CLOSED_LIMIT);
    writeJson(RECENTLY_CLOSED_FILE, { sessions });
  }

  forgetClosed(id: string): void {
    const sessions = this.loadRecentlyClosed().filter((ps) => ps.id !== id);
    writeJson(RECENTLY_CLOSED_FILE, { sessions });
  }

  // ─── App State ────────────────────────────────────────────

  loadAppState(): AppState {
    const loaded = readJson<Partial<AppState> | null>(STATE_FILE, null);
    if (!loaded || typeof loaded !== 'object') return DEFAULT_APP_STATE;
    return {
      ...DEFAULT_APP_STATE,
      ...loaded,
      windowBounds: { ...DEFAULT_APP_STATE.windowBounds, ...(loaded.windowBounds ?? {}) },
      panelSizes: { ...DEFAULT_APP_STATE.panelSizes, ...(loaded.panelSizes ?? {}) },
      newSessionDefaults: { ...DEFAULT_APP_STATE.newSessionDefaults, ...(loaded.newSessionDefaults ?? {}) },
      terminalSettings: { ...DEFAULT_APP_STATE.terminalSettings, ...(loaded.terminalSettings ?? {}) },
    };
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

  /** The toolkit's commands; any entry that isn't a command is left out. */
  loadToolkitCommands(): ToolkitCommand[] {
    const file = readJson<unknown>(TOOLKIT_FILE, null);
    if (!isToolkitFile(file)) return [];
    return toToolkitCommands(file.commands.filter(isStoredToolkitCommand));
  }

  saveToolkitCommands(commands: ToolkitCommand[]): void {
    writeJson(TOOLKIT_FILE, { commands });
  }
}
