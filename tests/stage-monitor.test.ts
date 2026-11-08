import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StageMonitor, deriveStage, type GhResult } from '../src/main/stage-monitor';
import type { LinkedPr, PrRef, Session } from '../src/shared/types';

const PR1: PrRef = { owner: 'o', repo: 'r', number: 1 };
const PR2: PrRef = { owner: 'o', repo: 'r', number: 2 };

function linked(pr: PrRef, overrides: Partial<LinkedPr> = {}): LinkedPr {
  return { ...pr, stage: 'unknown', stageUpdatedAt: null, ...overrides };
}

/** Let the limiter and any fire-and-forget lookups run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    prs: [linked(PR1)],
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

  it('maps unrecognized state to unknown', () => {
    expect(deriveStage({})).toBe('unknown');
    expect(deriveStage({ state: 42 })).toBe('unknown');
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
  /** Per-PR overrides of ghResult, keyed by PR number. */
  let ghResultByNumber: Map<number, GhResult>;

  const runGh = vi.fn(async (pr: PrRef): Promise<GhResult> => {
    ghCalls.push(pr);
    return ghResultByNumber.get(pr.number) ?? ghResult;
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

  const prsOf = (id: string) => sessions.get(id)!.prs;

  beforeEach(() => {
    sessions = new Map();
    commits = [];
    ghCalls = [];
    ghResult = { type: 'ok', stage: 'ready' };
    ghResultByNumber = new Map();
    runGh.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('refresh', () => {
    it('commits the new stage when it changed', async () => {
      sessions.set('s1', makeSession());
      const monitor = makeMonitor();

      await monitor.refresh('s1');

      expect(commits).toHaveLength(1);
      expect(commits[0].sessionId).toBe('s1');
      expect(commits[0].updates.prs).toEqual([
        { ...PR1, stage: 'ready', stageUpdatedAt: expect.any(Number) },
      ]);
    });

    it('does not commit when the stage is unchanged', async () => {
      sessions.set('s1', makeSession({ prs: [linked(PR1, { stage: 'ready' })] }));
      const monitor = makeMonitor();

      await monitor.refresh('s1');

      expect(commits).toHaveLength(0);
      // but the freshness timestamp is still bumped in memory
      expect(prsOf('s1')[0].stageUpdatedAt).toBeTypeOf('number');
    });

    it('looks up every linked PR and updates each one', async () => {
      sessions.set('s1', makeSession({ prs: [linked(PR1), linked(PR2)] }));
      ghResultByNumber.set(2, { type: 'ok', stage: 'merged' });
      const monitor = makeMonitor();

      await monitor.refresh('s1');

      expect(ghCalls).toEqual([PR1, PR2]);
      expect(prsOf('s1').map((pr) => [pr.number, pr.stage])).toEqual([
        [1, 'ready'],
        [2, 'merged'],
      ]);
    });

    it('keeps a PR GitHub cannot find, marked not found', async () => {
      sessions.set('s1', makeSession({ prs: [linked(PR1, { stage: 'ready' }), linked(PR2, { stage: 'ready' })] }));
      ghResultByNumber.set(1, { type: 'not-found' });
      const monitor = makeMonitor();

      await monitor.refresh('s1');

      expect(commits).toHaveLength(1);
      expect(prsOf('s1').map((pr) => [pr.number, pr.stage])).toEqual([
        [1, 'not-found'],
        [2, 'ready'],
      ]);
    });

    it('keeps looking up a not-found PR, which resolves once gh can see it', async () => {
      sessions.set('s1', makeSession({ prs: [linked(PR1, { stage: 'not-found' })] }));
      const monitor = makeMonitor();

      await monitor.refresh('s1');

      expect(prsOf('s1')[0].stage).toBe('ready');
    });

    it('stops looking up a merged PR but keeps looking up a closed one', async () => {
      sessions.set('s1', makeSession({ prs: [linked(PR1, { stage: 'merged' }), linked(PR2, { stage: 'closed' })] }));
      const monitor = makeMonitor();

      await monitor.refresh('s1');

      expect(ghCalls).toEqual([PR2]);
    });

    it.each(['ended', 'error'] as const)(
      'keeps looking up the PRs of a session whose claude exited (%s)',
      async (status) => {
        sessions.set('s1', makeSession({ status }));
        const monitor = makeMonitor();

        await monitor.refresh('s1');

        expect(prsOf('s1')[0].stage).toBe('ready');
      },
    );

    it('does nothing for sessions without prs or ids no longer open', async () => {
      sessions.set('no-pr', makeSession({ id: 'no-pr', prs: [] }));
      const monitor = makeMonitor();

      await monitor.refresh('no-pr');
      await monitor.refresh('closed');

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

    it('skips lookups queued behind the one that finds gh unavailable', async () => {
      sessions.set('s1', makeSession({ prs: [linked(PR1), linked(PR2)] }));
      ghResult = { type: 'unavailable' };
      const monitor = makeMonitor({ concurrency: 1 });

      await monitor.refresh('s1');

      expect(runGh).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent lookups of the same PR', async () => {
      sessions.set('s1', makeSession());
      let release!: (r: GhResult) => void;
      runGh.mockImplementationOnce(
        () => new Promise<GhResult>((resolve) => { release = resolve; }),
      );
      const monitor = makeMonitor();

      const first = monitor.refresh('s1');
      const second = monitor.refresh('s1');

      // The concurrency limiter starts the gh call on a microtask; wait for it
      // so `release` is assigned before we resolve.
      await vi.waitFor(() => expect(runGh).toHaveBeenCalledTimes(1));
      release({ type: 'ok', stage: 'ready' });
      await Promise.all([first, second]);
      expect(runGh).toHaveBeenCalledTimes(1);
    });

    it('keeps deduping the lookup that replaced one forgotten mid-flight', async () => {
      sessions.set('s1', makeSession());
      const releases: Array<(r: GhResult) => void> = [];
      const pendingGh = () => new Promise<GhResult>((resolve) => { releases.push(resolve); });
      runGh.mockImplementationOnce(pendingGh).mockImplementationOnce(pendingGh);
      const monitor = makeMonitor();

      const first = monitor.refresh('s1');
      await vi.waitFor(() => expect(runGh).toHaveBeenCalledTimes(1));
      // The session is closed and reopened under the same id
      monitor.forget('s1');
      const second = monitor.refresh('s1');
      await vi.waitFor(() => expect(runGh).toHaveBeenCalledTimes(2));

      releases[0]({ type: 'ok', stage: 'ready' });
      await first;
      void monitor.refresh('s1');
      await flush();
      expect(runGh).toHaveBeenCalledTimes(2);

      releases[1]({ type: 'ok', stage: 'ready' });
      await second;
    });

    it('drops the result for a PR unlinked while its lookup was in flight', async () => {
      sessions.set('s1', makeSession());
      let release!: (r: GhResult) => void;
      runGh.mockImplementationOnce(
        () => new Promise<GhResult>((resolve) => { release = resolve; }),
      );
      const monitor = makeMonitor();

      const pending = monitor.refresh('s1');
      await vi.waitFor(() => expect(runGh).toHaveBeenCalledTimes(1));
      monitor.unlinkPr('s1', PR1);
      release({ type: 'ok', stage: 'ready' });
      await pending;

      expect(prsOf('s1')).toEqual([]);
      expect(commits).toHaveLength(1); // only the unlink
    });
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

  describe('linkPrs', () => {
    it('links new PRs after the existing ones and looks them up', async () => {
      sessions.set('s1', makeSession({ prs: [] }));
      const monitor = makeMonitor();

      monitor.linkPrs('s1', [PR1, PR2]);

      expect(commits[0].updates.prs).toEqual([linked(PR1), linked(PR2)]);
      await vi.waitFor(() => expect(ghCalls).toEqual([PR1, PR2]));
    });

    it('only refreshes when every PR is already linked', async () => {
      sessions.set('s1', makeSession());
      const monitor = makeMonitor();

      monitor.linkPrs('s1', [{ owner: 'O', repo: 'R', number: 1 }]);

      await vi.waitFor(() => expect(runGh).toHaveBeenCalled());
      // No link commit — only the stage change from the refresh itself
      expect(prsOf('s1')).toHaveLength(1);
      expect(commits.every((c) => c.updates.prs?.[0].stage === 'ready')).toBe(true);
    });

    it('skips PRs already linked, including duplicates within the request', () => {
      sessions.set('s1', makeSession());
      const monitor = makeMonitor();

      monitor.linkPrs('s1', [PR1, PR2, PR2]);

      expect(commits[0].updates.prs).toEqual([linked(PR1), linked(PR2)]);
    });

    it('links and looks up on a session whose claude exited', async () => {
      sessions.set('s1', makeSession({ status: 'ended', prs: [] }));
      const monitor = makeMonitor();

      monitor.linkPrs('s1', [PR1]);

      expect(prsOf('s1')).toEqual([linked(PR1)]);
      await vi.waitFor(() => expect(ghCalls).toEqual([PR1]));
    });

    it('ignores a session that is no longer open', async () => {
      const monitor = makeMonitor();

      monitor.linkPrs('closed', [PR1]);
      await flush();

      expect(commits).toHaveLength(0);
      expect(runGh).not.toHaveBeenCalled();
    });
  });

  describe('unlinkPr', () => {
    it('removes only that PR', () => {
      sessions.set('s1', makeSession({ prs: [linked(PR1), linked(PR2)] }));
      const monitor = makeMonitor();

      monitor.unlinkPr('s1', { owner: 'O', repo: 'r', number: 1 });

      expect(commits).toEqual([{ sessionId: 's1', updates: { prs: [linked(PR2)] } }]);
    });

    it('does nothing for a PR that is not linked', () => {
      sessions.set('s1', makeSession());
      const monitor = makeMonitor();

      monitor.unlinkPr('s1', PR2);

      expect(commits).toHaveLength(0);
    });
  });
});
