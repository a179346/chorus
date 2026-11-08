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

/** How many sessions the user closed stay reopenable; saved sessions that couldn't be restored stay as well. */
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
  sessions: RecentlyClosedEntry[];
}

/**
 * A closed session as recently-closed.json holds it. `restoreFailed` marks a
 * saved session that couldn't be restored, which nobody chose to close: it
 * stays until it is reopened or removed, outside RECENTLY_CLOSED_LIMIT.
 */
type RecentlyClosedEntry = StoredSession & { restoreFailed?: boolean };

/** The entries that stay: every one whose restore failed, and the latest RECENTLY_CLOSED_LIMIT others. */
function withinLimit(entries: readonly RecentlyClosedEntry[]): RecentlyClosedEntry[] {
  const latestClosed = new Set(entries.filter((entry) => !entry.restoreFailed).slice(0, RECENTLY_CLOSED_LIMIT));
  return entries.filter((entry) => entry.restoreFailed || latestClosed.has(entry));
}

/** The latest entry the user closed, passing over the ones whose restore failed. */
export function lastClosedByUser(entries: readonly RecentlyClosedEntry[]): RecentlyClosedEntry | undefined {
  return entries.find((entry) => !entry.restoreFailed);
}

/** Only the container is checked: Chorus alone writes the file. */
function isRecentlyClosedFile(data: unknown): data is RecentlyClosedFile {
  return typeof data === 'object' && data !== null && 'sessions' in data && Array.isArray(data.sessions);
}

// ─── Toolkit ──────────────────────────────────────────────

/**
 * toolkit.json. People edit it by hand, so each command is checked as it is
 * read, and an edit leaves every other entry and key as written, apart from
 * writing in each command's id.
 */
interface ToolkitFile {
  commands: unknown[];
}

function isToolkitFile(data: unknown): data is ToolkitFile {
  return typeof data === 'object' && data !== null && 'commands' in data && Array.isArray(data.commands);
}

/** toolkit.json as written (an empty toolkit when there's no file); null when it isn't a toolkit. */
function readToolkitFile(): ToolkitFile | null {
  if (!fs.existsSync(TOOLKIT_FILE)) return { commands: [] };
  const file = readJson<unknown>(TOOLKIT_FILE, null);
  return isToolkitFile(file) ? file : null;
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

/** A command entry of toolkit.json, where it is among the entries, and the id it goes by. */
interface CommandEntry {
  entry: StoredToolkitCommand;
  entryIndex: number;
  id: string;
}

/**
 * The entries that are commands, each with a unique id: the id is how a
 * command is run, edited or deleted. An entry keeps its own id unless an
 * earlier one has it; a missing or repeated id is then replaced by one
 * derived from it ("x-2", or "command" when there's none) that no entry has
 * as its own. Every load of the same file gives the same ids.
 */
function toCommandEntries(entries: readonly unknown[]): CommandEntry[] {
  const commands = entries.flatMap((entry, entryIndex) => (isStoredToolkitCommand(entry) ? [{ entry, entryIndex }] : []));
  const taken = new Set<string>();
  const keptIds = commands.map(({ entry }) => {
    const id = ownId(entry);
    if (id === null || taken.has(id)) return null;
    taken.add(id);
    return id;
  });
  return commands.map((command, i) => ({
    ...command,
    id: keptIds[i] ?? takeDerivedId(ownId(command.entry) ?? 'command', taken),
  }));
}

function ownId(entry: StoredToolkitCommand): string | null {
  return typeof entry.id === 'string' && entry.id !== '' ? entry.id : null;
}

/** The first of `base`, `base-2`, `base-3`… not in `taken`, which it is added to. */
function takeDerivedId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** An icon that isn't a name is dropped. */
function toToolkitCommand({ entry: { label, command, icon }, id }: CommandEntry): ToolkitCommand {
  return typeof icon === 'string' ? { id, label, command, icon } : { id, label, command };
}

/**
 * The entries with each command's id written into it. A derived id depends on
 * the entries around it; once written, adding or deleting entries can't move
 * it to another command.
 */
function withIdsWritten(entries: readonly unknown[]): unknown[] {
  const written = [...entries];
  for (const { entry, entryIndex, id } of toCommandEntries(entries)) {
    if (entry.id !== id) written[entryIndex] = { ...entry, id };
  }
  return written;
}

/** Where the command with this id is among the entries; throws when no command has it. */
function requireEntryIndex(entries: readonly unknown[], id: string): number {
  const found = toCommandEntries(entries).find((command) => command.id === id);
  if (!found) throw new Error(`Didn't change ${TOOLKIT_FILE}: no command in it has the id "${id}".`);
  return found.entryIndex;
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
  loadRecentlyClosed(): RecentlyClosedEntry[] {
    const file = readJson<unknown>(RECENTLY_CLOSED_FILE, null);
    return isRecentlyClosedFile(file) ? file.sessions : [];
  }

  /** Remember a closed session so it can be reopened later. */
  rememberClosed(session: Session): void {
    this.putFirstInRecentlyClosed([toPersisted(session)]);
  }

  /**
   * Move saved sessions that couldn't be restored to Recently Closed, in one
   * write, so they don't vanish. Each leaves the saved sessions only once
   * Recently Closed holds it: if the write fails, they stay saved and are
   * restored next time.
   */
  moveUnrestorableToRecentlyClosed(sessions: readonly StoredSession[]): void {
    this.putFirstInRecentlyClosed(
      sessions.map((stored) => ({ ...toPersisted(fromPersisted(stored)), restoreFailed: true })),
    );
    for (const stored of sessions) this.removeSession(stored.id);
  }

  forgetClosed(id: string): void {
    this.writeRecentlyClosed(this.loadRecentlyClosed().filter((entry) => entry.id !== id));
  }

  /** Put these entries first, in place of any earlier entry for the same session. */
  private putFirstInRecentlyClosed(entries: readonly RecentlyClosedEntry[]): void {
    const ids = new Set(entries.map((entry) => entry.id));
    const rest = this.loadRecentlyClosed().filter((entry) => !ids.has(entry.id));
    this.writeRecentlyClosed([...entries, ...rest]);
  }

  private writeRecentlyClosed(entries: readonly RecentlyClosedEntry[]): void {
    const file: RecentlyClosedFile = { sessions: withinLimit(entries) };
    writeJson(RECENTLY_CLOSED_FILE, file);
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

  /** The toolkit's commands; any entry that isn't a command is left out, and a file that isn't a toolkit has none. */
  loadToolkitCommands(): ToolkitCommand[] {
    const file = readToolkitFile();
    return file ? toCommandEntries(file.commands).map(toToolkitCommand) : [];
  }

  /** Replace all of the toolkit's entries with these commands. */
  saveToolkitCommands(commands: ToolkitCommand[]): void {
    this.editToolkit(() => commands);
  }

  addToolkitCommand(command: ToolkitCommand): void {
    this.editToolkit((entries) => [...entries, command]);
  }

  /** Replace the command that has this one's id; throws when none has it. */
  updateToolkitCommand(command: ToolkitCommand): void {
    this.editToolkit((entries) => {
      const index = requireEntryIndex(entries, command.id);
      return entries.map((entry, i) => (i === index ? command : entry));
    });
  }

  /** Delete the command that has this id; throws when none has it. */
  deleteToolkitCommand(id: string): void {
    this.editToolkit((entries) => {
      const index = requireEntryIndex(entries, id);
      return entries.filter((_, i) => i !== index);
    });
  }

  /**
   * Write toolkit.json with `edit` applied to its entries, once each command's
   * id is written into its entry (see withIdsWritten). Throws, leaving the
   * file alone, when `edit` does, or when the file isn't a toolkit: writing
   * would lose what the user wrote in it.
   */
  private editToolkit(edit: (entries: unknown[]) => unknown[]): void {
    const file = readToolkitFile();
    if (!file) {
      throw new Error(`Didn't change ${TOOLKIT_FILE}: it isn't JSON with a "commands" list. Fix or move it, then try again.`);
    }
    writeJson(TOOLKIT_FILE, { ...file, commands: edit(withIdsWritten(file.commands)) });
  }
}
