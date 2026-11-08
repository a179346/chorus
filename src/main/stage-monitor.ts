import { spawn } from 'node:child_process';
import pLimit from 'p-limit';
import type { LinkedPr, PrRef, PrStage, Session } from '../shared/types';
import { prKey, samePr } from '../shared/pr-ref';

const GH_TIMEOUT_MS = 10_000;
const GH_RETRY_AFTER_MS = 5 * 60 * 1000;
const STAGE_DEBOUNCE_MS = 1000;
const STAGE_POLL_INTERVAL_MS = 60_000;

/** The stages gh can report for a PR it found; `not-found` stands for one it didn't. */
type FoundPrStage = Exclude<PrStage, 'not-found'>;

export type GhResult =
  | { type: 'ok'; stage: FoundPrStage }
  | { type: 'not-found' }
  | { type: 'unavailable' }
  | { type: 'error' };

/** Adapter that asks GitHub for a PR's state. Prod: the gh CLI. Tests: a fake. */
export type GhRunner = (pr: PrRef) => Promise<GhResult>;

export function deriveStage(json: {
  state?: unknown;
  isDraft?: unknown;
  mergedAt?: unknown;
}): FoundPrStage {
  const state = typeof json.state === 'string' ? json.state.toUpperCase() : '';
  const isDraft = json.isDraft === true;
  const merged = json.mergedAt !== null && json.mergedAt !== undefined && json.mergedAt !== '';
  if (state === 'MERGED' || merged) return 'merged';
  if (state === 'CLOSED') return 'closed';
  if (state === 'OPEN') return isDraft ? 'draft' : 'ready';
  return 'unknown';
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
          // Linked PRs are on github.com; a bare owner/repo would go to GH_HOST,
          // or to an Enterprise host gh is logged in to
          `github.com/${pr.owner}/${pr.repo}`,
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

/** Strip a LinkedPr (or anything PrRef-shaped off the wire) down to its identity. */
function toPrRef(pr: PrRef): PrRef {
  return { owner: pr.owner, repo: pr.repo, number: pr.number };
}

function inFlightPrefix(sessionId: string): string {
  return `${sessionId}\0`;
}

function inFlightKey(sessionId: string, pr: PrRef): string {
  return inFlightPrefix(sessionId) + prKey(pr);
}

/** A merged PR stays merged; any other stage can still change (a closed PR can reopen). */
function canChangeStage(pr: LinkedPr): boolean {
  return pr.stage !== 'merged';
}

/**
 * Owns the PRs linked to each session: links them (created by Claude, or
 * added by the user), unlinks them, and keeps each one's stage current —
 * debouncing bursts, deduping in-flight lookups, limiting gh concurrency, and
 * backing off when gh is unavailable. Changes are committed through the
 * session-state seam; when a poll finds a PR's stage unchanged, only its
 * in-memory freshness timestamp is bumped — no persist, no broadcast.
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

  /** Keyed by session + PR (see inFlightKey). */
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

  /** Look up the stage of every PR linked to the session that can still change. */
  refresh(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) return Promise.resolve();
    return this.refreshPrs(sessionId, session.prs.filter(canChangeStage));
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
    for (const s of this.getAllSessions()) void this.refresh(s.id);
  }

  /**
   * Link PRs — ones Claude created, or the user added — to the session,
   * skipping those already linked, and look up each of them whose stage can
   * still change.
   */
  linkPrs(sessionId: string, prs: PrRef[]): void {
    const session = this.getSession(sessionId);
    if (!session) return;

    const linked: LinkedPr[] = [...session.prs];
    for (const pr of prs) {
      if (linked.some((p) => samePr(p, pr))) continue;
      linked.push({ ...toPrRef(pr), stage: 'unknown', stageUpdatedAt: null });
    }
    if (linked.length !== session.prs.length) this.commit(sessionId, { prs: linked });

    const requested = linked.filter((p) => prs.some((pr) => samePr(p, pr)));
    void this.refreshPrs(sessionId, requested.filter(canChangeStage));
  }

  /** Stop tracking a PR. */
  unlinkPr(sessionId: string, pr: PrRef): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    const prs = session.prs.filter((p) => !samePr(p, pr));
    if (prs.length === session.prs.length) return;
    this.commit(sessionId, { prs });
  }

  /** Drop any pending work for a session (called when it is closed). */
  forget(sessionId: string): void {
    const prefix = inFlightPrefix(sessionId);
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) this.inFlight.delete(key);
    }
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

  private async refreshPrs(sessionId: string, prs: PrRef[]): Promise<void> {
    await Promise.all(prs.map((pr) => this.refreshPr(sessionId, pr)));
  }

  private refreshPr(sessionId: string, pr: PrRef): Promise<void> {
    const key = inFlightKey(sessionId, pr);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this.limit(async () => {
      // Checked when the lookup runs, not when queued: an earlier lookup
      // in the queue may just have found gh unavailable
      if (this.ghBackingOff()) return;
      if (!this.findLinked(sessionId, pr)) return;
      const result = await this.runGh(toPrRef(pr));
      this.applyGhResult(sessionId, pr, result);
    }).finally(() => {
      // forget() may have dropped this lookup and a newer one taken the key
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  private ghBackingOff(): boolean {
    return !this.ghAvailable && this.now() < this.ghUnavailableUntil;
  }

  private applyGhResult(sessionId: string, pr: PrRef, result: GhResult): void {
    if (result.type === 'unavailable') {
      this.ghAvailable = false;
      this.ghUnavailableUntil = this.now() + this.retryAfterMs;
      return;
    }
    if (result.type === 'error') return;
    this.ghAvailable = true;

    // Re-read: the session may have been closed, or the PR unlinked, mid-lookup
    const found = this.findLinked(sessionId, pr);
    if (!found) return;
    const { session, entry } = found;

    // Kept, not unlinked: the user decides whether a PR gh can't see goes
    const stage = result.type === 'not-found' ? 'not-found' : result.stage;
    const ts = this.now();
    if (entry.stage === stage) {
      entry.stageUpdatedAt = ts;
      return;
    }
    this.commit(sessionId, {
      prs: session.prs.map((p) => (p === entry ? { ...p, stage, stageUpdatedAt: ts } : p)),
    });
  }

  /** The open session and its entry for this PR, unless the session was closed or the PR unlinked. */
  private findLinked(
    sessionId: string,
    pr: PrRef,
  ): { session: Session; entry: LinkedPr } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const entry = session.prs.find((p) => samePr(p, pr));
    return entry ? { session, entry } : null;
  }
}
