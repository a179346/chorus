import { spawn } from 'node:child_process';
import pLimit from 'p-limit';
import type { PrRef, Session, SessionStage } from '../shared/types';

const GH_TIMEOUT_MS = 10_000;
const GH_RETRY_AFTER_MS = 5 * 60 * 1000;
const STAGE_DEBOUNCE_MS = 1000;
const STAGE_POLL_INTERVAL_MS = 60_000;

export type GhResult =
  | { type: 'ok'; stage: SessionStage }
  | { type: 'not-found' }
  | { type: 'unavailable' }
  | { type: 'error' };

/** Adapter that asks GitHub for a PR's state. Prod: the gh CLI. Tests: a fake. */
export type GhRunner = (pr: PrRef) => Promise<GhResult>;

export function deriveStage(json: {
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

/** Default GhRunner: spawn `gh pr view` and decode its JSON. */
export function runGhPrView(pr: PrRef): Promise<GhResult> {
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

export interface StageMonitorOptions {
  getSession(id: string): Session | null;
  getAllSessions(): Session[];
  /** State writes go through the session-state commit seam. */
  commit(sessionId: string, updates: Partial<Session>): void;
  runGh?: GhRunner;
  debounceMs?: number;
  pollIntervalMs?: number;
  retryAfterMs?: number;
  concurrency?: number;
  now?: () => number;
}

/**
 * Watches sessions with a detected PR and keeps their stage current:
 * debounces bursts, dedupes in-flight lookups, limits gh concurrency, and
 * backs off when gh is unavailable. Stage changes are committed through the
 * session-state seam; when a poll finds no change, only the in-memory
 * freshness timestamp is bumped — no persist, no broadcast.
 */
export class StageMonitor {
  private readonly getSession: (id: string) => Session | null;
  private readonly getAllSessions: () => Session[];
  private readonly commit: (sessionId: string, updates: Partial<Session>) => void;
  private readonly runGh: GhRunner;
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;
  private readonly retryAfterMs: number;
  private readonly now: () => number;
  private readonly limit: ReturnType<typeof pLimit>;

  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly debouncers = new Map<string, ReturnType<typeof setTimeout>>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private ghAvailable = true;
  private ghUnavailableUntil = 0;

  constructor(opts: StageMonitorOptions) {
    this.getSession = opts.getSession;
    this.getAllSessions = opts.getAllSessions;
    this.commit = opts.commit;
    this.runGh = opts.runGh ?? runGhPrView;
    this.debounceMs = opts.debounceMs ?? STAGE_DEBOUNCE_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? STAGE_POLL_INTERVAL_MS;
    this.retryAfterMs = opts.retryAfterMs ?? GH_RETRY_AFTER_MS;
    this.now = opts.now ?? Date.now;
    this.limit = pLimit(opts.concurrency ?? 4);
  }

  refresh(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session || !session.pr || session.status === 'ended') return Promise.resolve();

    const existing = this.inFlight.get(sessionId);
    if (existing) return existing;

    if (!this.ghAvailable && this.now() < this.ghUnavailableUntil) return Promise.resolve();

    const promise = this.limit(async () => {
      const s = this.getSession(sessionId);
      if (!s || !s.pr || s.status === 'ended') return;

      const result = await this.runGh(s.pr);

      const after = this.getSession(sessionId);
      if (!after || after.status === 'ended') return;

      if (result.type === 'unavailable') {
        this.ghAvailable = false;
        this.ghUnavailableUntil = this.now() + this.retryAfterMs;
        return;
      }
      if (result.type === 'error') return;

      this.ghAvailable = true;
      const ts = this.now();

      if (result.type === 'not-found') {
        if (after.pr !== null || after.stage !== 'no-pr') {
          this.commit(sessionId, { pr: null, stage: 'no-pr', stageUpdatedAt: ts });
        } else {
          after.stageUpdatedAt = ts;
        }
        return;
      }

      if (after.stage !== result.stage) {
        this.commit(sessionId, { stage: result.stage, stageUpdatedAt: ts });
      } else {
        after.stageUpdatedAt = ts;
      }
    }).finally(() => {
      this.inFlight.delete(sessionId);
    });

    this.inFlight.set(sessionId, promise);
    return promise;
  }

  scheduleRefresh(sessionId: string | null): void {
    if (!sessionId) return;
    const existing = this.debouncers.get(sessionId);
    if (existing) clearTimeout(existing);
    this.debouncers.set(
      sessionId,
      setTimeout(() => {
        this.debouncers.delete(sessionId);
        void this.refresh(sessionId);
      }, this.debounceMs),
    );
  }

  refreshAll(): void {
    for (const s of this.getAllSessions()) {
      if (s.pr && s.status !== 'ended') void this.refresh(s.id);
    }
  }

  handlePrDetected(sessionId: string, pr: PrRef): void {
    const session = this.getSession(sessionId);
    if (!session || session.status === 'ended') return;
    const current = session.pr;
    if (
      current &&
      current.owner === pr.owner &&
      current.repo === pr.repo &&
      current.number === pr.number
    ) {
      void this.refresh(sessionId);
      return;
    }
    this.commit(sessionId, { pr });
    void this.refresh(sessionId);
  }

  /** Drop any pending work for a session (called when it ends). */
  forget(sessionId: string): void {
    this.inFlight.delete(sessionId);
    const t = this.debouncers.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.debouncers.delete(sessionId);
    }
  }

  start(): void {
    if (this.pollTimer) return;
    this.refreshAll();
    this.pollTimer = setInterval(() => this.refreshAll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const t of this.debouncers.values()) clearTimeout(t);
    this.debouncers.clear();
    this.inFlight.clear();
  }
}
