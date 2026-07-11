import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionState, type SessionStoreLike, type SessionStateEnvironment } from '../src/main/session-state';
import type { Session } from '../src/shared/types';

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
    hasUserInput: false,
    pr: null,
    stage: 'no-pr',
    stageUpdatedAt: null,
    ...overrides,
  };
}

function makeStore(sessions: Map<string, Session>): SessionStoreLike & { persistCount: number } {
  return {
    persistCount: 0,
    getSession: (id) => sessions.get(id) ?? null,
    getAllSessions: () => Array.from(sessions.values()),
    updateSession(id, updates) {
      const s = sessions.get(id);
      if (!s) return null;
      Object.assign(s, updates);
      return s;
    },
    persistSessions() {
      this.persistCount++;
    },
  };
}

describe('SessionState', () => {
  let sessions: Map<string, Session>;
  let store: ReturnType<typeof makeStore>;
  let env: SessionStateEnvironment & {
    broadcast: ReturnType<typeof vi.fn>;
    showNotification: ReturnType<typeof vi.fn>;
    setUnreadCount: ReturnType<typeof vi.fn>;
  };
  let windowFocused: boolean;
  let state: SessionState;

  beforeEach(() => {
    sessions = new Map([['s1', makeSession()]]);
    store = makeStore(sessions);
    windowFocused = true;
    env = {
      broadcast: vi.fn(),
      isWindowFocused: () => windowFocused,
      showNotification: vi.fn(),
      setUnreadCount: vi.fn(),
    };
    state = new SessionState(store, env);
  });

  describe('commit', () => {
    it('updates the store and broadcasts exactly the changed fields', () => {
      state.commit('s1', { status: 'thinking', model: 'claude-opus-4-6' });

      expect(sessions.get('s1')!.status).toBe('thinking');
      expect(env.broadcast).toHaveBeenCalledWith({
        sessionId: 's1',
        status: 'thinking',
        model: 'claude-opus-4-6',
      });
    });

    it('returns null and does nothing for unknown sessions', () => {
      expect(state.commit('missing', { status: 'idle' })).toBeNull();
      expect(env.broadcast).not.toHaveBeenCalled();
      expect(store.persistCount).toBe(0);
    });

    it('does not persist status-only changes', () => {
      state.commit('s1', { status: 'generating' });
      expect(store.persistCount).toBe(0);
    });

    it('persists when a persisted field changed', () => {
      state.commit('s1', { name: 'Renamed' });
      expect(store.persistCount).toBe(1);

      state.commit('s1', { stage: 'ready', stageUpdatedAt: 1 });
      expect(store.persistCount).toBe(2);
    });

    it('refreshes the unread badge when unread changes', () => {
      state.commit('s1', { unread: true });
      expect(env.setUnreadCount).toHaveBeenCalledWith(1);

      state.commit('s1', { unread: false });
      expect(env.setUnreadCount).toHaveBeenLastCalledWith(0);
    });
  });

  describe('applyHookUpdate', () => {
    it('commits the mapped status', () => {
      state.applyHookUpdate('s1', { status: 'thinking' });
      expect(sessions.get('s1')!.status).toBe('thinking');
      expect(sessions.get('s1')!.hasUserInput).toBe(true);
    });

    it('marks unread when a working session goes idle while unfocused', () => {
      sessions.get('s1')!.status = 'generating';
      windowFocused = false;

      state.applyHookUpdate('s1', { status: 'idle' });

      expect(sessions.get('s1')!.unread).toBe(true);
      expect(env.setUnreadCount).toHaveBeenCalledWith(1);
    });

    it('marks unread when idle arrives for a non-active session even if focused', () => {
      sessions.set('s2', makeSession({ id: 's2', status: 'thinking' }));
      state.setActiveSession('s1');

      state.applyHookUpdate('s2', { status: 'idle' });

      expect(sessions.get('s2')!.unread).toBe(true);
    });

    it('does not mark unread when the active session finishes while focused', () => {
      sessions.get('s1')!.status = 'thinking';
      state.setActiveSession('s1');

      state.applyHookUpdate('s1', { status: 'idle' });

      expect(sessions.get('s1')!.unread).toBe(false);
    });

    it('notifies when notifyOnIdle is set and the window is unfocused', () => {
      sessions.get('s1')!.status = 'thinking';
      sessions.get('s1')!.notifyOnIdle = true;
      windowFocused = false;

      state.applyHookUpdate('s1', { status: 'idle' });

      expect(env.showNotification).toHaveBeenCalledWith('Test', 'Session is now Idle');
    });

    it('does not notify when the window is focused', () => {
      sessions.get('s1')!.status = 'thinking';
      sessions.get('s1')!.notifyOnIdle = true;

      state.applyHookUpdate('s1', { status: 'idle' });

      expect(env.showNotification).not.toHaveBeenCalled();
    });

    it('passes model and context metadata through to the commit', () => {
      state.applyHookUpdate('s1', {
        status: 'idle',
        model: 'claude-opus-4-6',
        contextUsage: 42,
        contextLimit: 200000,
      });

      expect(env.broadcast).toHaveBeenCalledWith({
        sessionId: 's1',
        status: 'idle',
        model: 'claude-opus-4-6',
        contextUsage: 42,
        contextLimit: 200000,
      });
    });

    it('ignores updates for unknown sessions', () => {
      expect(() => state.applyHookUpdate('missing', { status: 'idle' })).not.toThrow();
      expect(env.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('handleClaudeExit', () => {
    it('commits ended on exit code 0', () => {
      state.handleClaudeExit('s1', 0);
      expect(sessions.get('s1')!.status).toBe('ended');
      expect(env.broadcast).toHaveBeenCalledWith({ sessionId: 's1', status: 'ended' });
    });

    it('commits error on non-zero exit', () => {
      state.handleClaudeExit('s1', 1);
      expect(sessions.get('s1')!.status).toBe('error');
    });
  });

  describe('markRead', () => {
    it('clears unread and broadcasts', () => {
      sessions.get('s1')!.unread = true;

      state.markRead('s1');

      expect(sessions.get('s1')!.unread).toBe(false);
      expect(env.broadcast).toHaveBeenCalledWith({ sessionId: 's1', unread: false });
    });

    it('does nothing when the session is already read', () => {
      state.markRead('s1');
      expect(env.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('active session', () => {
    it('tracks the active session id', () => {
      expect(state.activeSessionId).toBeNull();
      state.setActiveSession('s1');
      expect(state.activeSessionId).toBe('s1');
    });
  });
});
