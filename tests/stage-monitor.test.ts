import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StageMonitor, deriveStage, type GhResult } from '../src/main/stage-monitor';
import type { PrRef, Session } from '../src/shared/types';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Test',
    cwd: '/tmp',
    worktree: null,
    status: 'idle',
    model: null,
    contextUsage: null,
    contextLimit: null,
    flags: [],
    notifyOnIdle: false,
    unread: false,
    createdAt: 0,
    lastActiveAt: 0,
    hasUserInput: true,
    pr: { owner: 'o', repo: 'r', number: 1 },
    stage: 'no-pr',
    stageUpdatedAt: null,
    ...overrides,
  };
}

describe('deriveStage', () => {
  it('maps OPEN to ready', () => {
    expect(deriveStage({ state: 'OPEN', isDraft: false, mergedAt: null })).toBe('ready');
  });

  it('maps OPEN + isDraft to draft', () => {
    expect(deriveStage({ state: 'OPEN', isDraft: true, mergedAt: null })).toBe('draft');
  });

  it('maps MERGED to merged', () => {
    expect(deriveStage({ state: 'MERGED', isDraft: false, mergedAt: null })).toBe('merged');
  });

  it('treats a mergedAt timestamp as merged regardless of state', () => {
    expect(deriveStage({ state: 'CLOSED', isDraft: false, mergedAt: '2026-01-01T00:00:00Z' })).toBe('merged');
  });

  it('maps CLOSED to closed', () => {
    expect(deriveStage({ state: 'CLOSED', isDraft: false, mergedAt: null })).toBe('closed');
  });

  it('maps unknown state to no-pr', () => {
    expect(deriveStage({})).toBe('no-pr');
    expect(deriveStage({ state: 42 })).toBe('no-pr');
  });

  it('is case-insensitive on state', () => {
    expect(deriveStage({ state: 'open', isDraft: false, mergedAt: null })).toBe('ready');
  });
});

describe('StageMonitor', () => {
  let sessions: Map<string, Session>;
  let commits: Array<{ sessionId: string; updates: Partial<Session> }>;
  let ghCalls: PrRef[];
  let ghResult: GhResult;

  const runGh = vi.fn(async (pr: PrRef): Promise<GhResult> => {
    ghCalls.push(pr);
    return ghResult;
  });

  function makeMonitor(overrides: Partial<ConstructorParameters<typeof StageMonitor>[0]> = {}) {
    return new StageMonitor({
      getSession: (id) => sessions.get(id) ?? null,
      getAllSessions: () => Array.from(sessions.values()),
      commit: (sessionId, updates) => {
        commits.push({ sessionId, updates });
        const s = sessions.get(sessionId);
        if (s) Object.assign(s, updates);
      },
      runGh,
      ...overrides,
    });
  }

  beforeEach(() => {
    sessions = new Map();
    commits = [];
    ghCalls = [];
    ghResult = { type: 'ok', stage: 'ready' };
    runGh.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits the new stage when it changed', async () => {
    sessions.set('s1', makeSession());
    const monitor = makeMonitor();

    await monitor.refresh('s1');

    expect(commits).toHaveLength(1);
    expect(commits[0].sessionId).toBe('s1');
    expect(commits[0].updates.stage).toBe('ready');
    expect(commits[0].updates.stageUpdatedAt).toBeTypeOf('number');
  });

  it('does not commit when the stage is unchanged', async () => {
    sessions.set('s1', makeSession({ stage: 'ready' }));
    const monitor = makeMonitor();

    await monitor.refresh('s1');

    expect(commits).toHaveLength(0);
    // but the freshness timestamp is still bumped in memory
    expect(sessions.get('s1')!.stageUpdatedAt).toBeTypeOf('number');
  });

  it('clears the pr on not-found', async () => {
    sessions.set('s1', makeSession({ stage: 'ready' }));
    ghResult = { type: 'not-found' };
    const monitor = makeMonitor();

    await monitor.refresh('s1');

    expect(commits).toHaveLength(1);
    expect(commits[0].updates.pr).toBeNull();
    expect(commits[0].updates.stage).toBe('no-pr');
  });

  it('does nothing for sessions without a pr, ended sessions, or unknown ids', async () => {
    sessions.set('no-pr', makeSession({ id: 'no-pr', pr: null }));
    sessions.set('ended', makeSession({ id: 'ended', status: 'ended' }));
    const monitor = makeMonitor();

    await monitor.refresh('no-pr');
    await monitor.refresh('ended');
    await monitor.refresh('missing');

    expect(runGh).not.toHaveBeenCalled();
    expect(commits).toHaveLength(0);
  });

  it('commits nothing on gh error', async () => {
    sessions.set('s1', makeSession());
    ghResult = { type: 'error' };
    const monitor = makeMonitor();

    await monitor.refresh('s1');

    expect(commits).toHaveLength(0);
  });

  it('backs off when gh is unavailable and retries after the window', async () => {
    let now = 1_000_000;
    sessions.set('s1', makeSession());
    ghResult = { type: 'unavailable' };
    const monitor = makeMonitor({ retryAfterMs: 60_000, now: () => now });

    await monitor.refresh('s1');
    expect(runGh).toHaveBeenCalledTimes(1);

    // Within the backoff window: no new gh call
    await monitor.refresh('s1');
    expect(runGh).toHaveBeenCalledTimes(1);

    // After the window: gh is retried
    now += 60_001;
    ghResult = { type: 'ok', stage: 'ready' };
    await monitor.refresh('s1');
    expect(runGh).toHaveBeenCalledTimes(2);
    expect(commits).toHaveLength(1);
  });

  it('dedupes concurrent refreshes for the same session', async () => {
    sessions.set('s1', makeSession());
    let release!: (r: GhResult) => void;
    runGh.mockImplementationOnce(
      () => new Promise<GhResult>((resolve) => { release = resolve; }),
    );
    const monitor = makeMonitor();

    const first = monitor.refresh('s1');
    const second = monitor.refresh('s1');
    expect(second).toBe(first);

    // The concurrency limiter starts the gh call on a microtask; wait for it
    // so `release` is assigned before we resolve.
    await vi.waitFor(() => expect(runGh).toHaveBeenCalledTimes(1));
    release({ type: 'ok', stage: 'ready' });
    await first;
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  it('debounces scheduleRefresh', async () => {
    vi.useFakeTimers();
    sessions.set('s1', makeSession());
    const monitor = makeMonitor({ debounceMs: 500 });

    monitor.scheduleRefresh('s1');
    monitor.scheduleRefresh('s1');
    monitor.scheduleRefresh('s1');

    await vi.advanceTimersByTimeAsync(499);
    expect(runGh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  it('forget cancels a pending debounced refresh', async () => {
    vi.useFakeTimers();
    sessions.set('s1', makeSession());
    const monitor = makeMonitor({ debounceMs: 500 });

    monitor.scheduleRefresh('s1');
    monitor.forget('s1');

    await vi.advanceTimersByTimeAsync(1000);
    expect(runGh).not.toHaveBeenCalled();
  });

  describe('handlePrDetected', () => {
    it('commits a newly detected pr and refreshes', async () => {
      sessions.set('s1', makeSession({ pr: null }));
      const monitor = makeMonitor();

      monitor.handlePrDetected('s1', { owner: 'o', repo: 'r', number: 7 });

      expect(commits[0].updates.pr).toEqual({ owner: 'o', repo: 'r', number: 7 });
      await vi.waitFor(() => expect(runGh).toHaveBeenCalled());
    });

    it('only refreshes when the same pr is detected again', async () => {
      sessions.set('s1', makeSession());
      const monitor = makeMonitor();

      monitor.handlePrDetected('s1', { owner: 'o', repo: 'r', number: 1 });

      await vi.waitFor(() => expect(runGh).toHaveBeenCalled());
      // No pr commit — only the stage change from the refresh itself
      expect(commits.every((c) => !('pr' in c.updates))).toBe(true);
    });

    it('ignores detection for ended sessions', () => {
      sessions.set('s1', makeSession({ status: 'ended' }));
      const monitor = makeMonitor();

      monitor.handlePrDetected('s1', { owner: 'o', repo: 'r', number: 1 });

      expect(commits).toHaveLength(0);
      expect(runGh).not.toHaveBeenCalled();
    });
  });
});
