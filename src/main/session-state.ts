import type { Session, SessionStateUpdate } from '../shared/types';
import { SESSION_SYNC_FIELDS } from '../shared/types';
import type { HookUpdate } from './hook-server';

/**
 * The subset of SessionStore that SessionState needs. SessionStore satisfies
 * this structurally; tests substitute an in-memory fake.
 */
export interface SessionStoreLike {
  getSession(id: string): Session | null;
  getAllSessions(): Session[];
  updateSession(id: string, updates: Partial<Session>): Session | null;
  persistSessions(): void;
}

/** Everything SessionState needs from the shell it runs in (window, dock, notifications). */
export interface SessionStateEnvironment {
  broadcast(update: SessionStateUpdate): void;
  isWindowFocused(): boolean;
  showNotification(title: string, body: string): void;
  setUnreadCount(count: number): void;
}

/** Fields that must be flushed to disk when they change (subset of PersistedSession). */
const PERSISTED_FIELDS: ReadonlySet<keyof Session> = new Set<keyof Session>([
  'name',
  'worktree',
  'flags',
  'notifyOnIdle',
  'unread',
  'model',
  'contextUsage',
  'contextLimit',
  'hasUserInput',
  'pr',
  'stage',
  'stageUpdatedAt',
]);

/**
 * The write path for session state. Mutations — hook events, stage changes,
 * renames, PTY exits, read-marking — go through commit(), which updates the
 * store, persists when a persisted field changed, and broadcasts exactly the
 * changed fields to the renderer. One deliberate exception: StageMonitor
 * bumps stageUpdatedAt in memory when a poll finds no change, skipping the
 * persist/broadcast a commit would cause.
 */
export class SessionState {
  private activeId: string | null = null;

  constructor(
    private readonly store: SessionStoreLike,
    private readonly env: SessionStateEnvironment,
  ) {}

  get activeSessionId(): string | null {
    return this.activeId;
  }

  setActiveSession(id: string | null): void {
    this.activeId = id;
  }

  commit(sessionId: string, updates: Partial<Session>): Session | null {
    const session = this.store.updateSession(sessionId, updates);
    if (!session) return null;

    const keys = Object.keys(updates) as (keyof Session)[];
    if (keys.some((k) => PERSISTED_FIELDS.has(k))) {
      this.store.persistSessions();
    }

    const payload: SessionStateUpdate = { sessionId };
    for (const field of SESSION_SYNC_FIELDS) {
      if (field in updates) {
        (payload as Record<string, unknown>)[field] = updates[field];
      }
    }
    if (Object.keys(payload).length > 1) {
      this.env.broadcast(payload);
    }

    if (updates.unread !== undefined) this.refreshUnreadBadge();
    return session;
  }

  /**
   * Reducer for Claude Code hook events: maps the update onto session fields,
   * derives unread (session finished while not being looked at), and fires a
   * notification when the user opted in and the window is unfocused.
   */
  applyHookUpdate(sessionId: string, update: HookUpdate): void {
    const session = this.store.getSession(sessionId);
    if (!session) return;

    const updates: Partial<Session> = { status: update.status };
    if (update.status === 'thinking') updates.hasUserInput = true;
    if (update.model !== undefined) updates.model = update.model;
    if (update.contextUsage !== undefined) updates.contextUsage = update.contextUsage;
    if (update.contextLimit !== undefined) updates.contextLimit = update.contextLimit;

    const becameIdle =
      (session.status === 'thinking' || session.status === 'generating') &&
      (update.status === 'idle' || update.status === 'waiting');

    const windowFocused = this.env.isWindowFocused();
    if (becameIdle && (!windowFocused || sessionId !== this.activeId)) {
      updates.unread = true;
    }

    const shouldNotify = session.notifyOnIdle && becameIdle && !windowFocused;
    const sessionName = session.name;

    this.commit(sessionId, updates);

    if (shouldNotify) {
      const statusLabel = update.status === 'idle' ? 'Idle' : 'Waiting for input';
      this.env.showNotification(sessionName, `Session is now ${statusLabel}`);
    }
  }

  /** PTY exit results flow through the same commit path as everything else. */
  handleClaudeExit(sessionId: string, exitCode: number): void {
    this.commit(sessionId, { status: exitCode === 0 ? 'ended' : 'error' });
  }

  /** Clear unread when the user looks at a session (switch or window focus). */
  markRead(sessionId: string): void {
    const session = this.store.getSession(sessionId);
    if (session?.unread) {
      this.commit(sessionId, { unread: false });
    }
  }

  refreshUnreadBadge(): void {
    const count = this.store.getAllSessions().filter((s) => s.unread).length;
    this.env.setUnreadCount(count);
  }
}
