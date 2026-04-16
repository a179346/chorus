import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We need to mock fs before importing SessionStore
vi.mock('node:fs');
vi.mock('node:os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home',
}));

const { SessionStore } = await import('../src/main/session-store');

function makeSession(overrides: Partial<import('../src/shared/types').Session> = {}): import('../src/shared/types').Session {
  return {
    id: 'test-id-1',
    name: 'Test Session',
    cwd: '/tmp/test',
    worktree: null,
    status: 'idle',
    model: null,
    contextUsage: null,
    gitBranch: null,
    flags: [],
    createdAt: 1000,
    lastActiveAt: 1000,
    ...overrides,
  };
}

describe('SessionStore', () => {
  let store: InstanceType<typeof SessionStore>;

  beforeEach(() => {
    store = new SessionStore();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.renameSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('CRUD operations', () => {
    it('should add and retrieve a session', () => {
      const session = makeSession();
      store.addSession(session);
      expect(store.getSession('test-id-1')).toEqual(session);
    });

    it('should return null for non-existent session', () => {
      expect(store.getSession('nonexistent')).toBeNull();
    });

    it('should list all sessions', () => {
      const s1 = makeSession({ id: 'a' });
      const s2 = makeSession({ id: 'b', name: 'Session B' });
      store.addSession(s1);
      store.addSession(s2);
      expect(store.getAllSessions()).toHaveLength(2);
    });

    it('should update a session', () => {
      store.addSession(makeSession());
      const updated = store.updateSession('test-id-1', { name: 'Renamed' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed');
    });

    it('should return null when updating non-existent session', () => {
      expect(store.updateSession('nonexistent', { name: 'x' })).toBeNull();
    });

    it('should update lastActiveAt on update', () => {
      const session = makeSession({ lastActiveAt: 100 });
      store.addSession(session);
      const before = Date.now();
      store.updateSession('test-id-1', { name: 'Updated' });
      const after = Date.now();
      const s = store.getSession('test-id-1')!;
      expect(s.lastActiveAt).toBeGreaterThanOrEqual(before);
      expect(s.lastActiveAt).toBeLessThanOrEqual(after);
    });

    it('should remove a session', () => {
      store.addSession(makeSession());
      store.removeSession('test-id-1');
      expect(store.getSession('test-id-1')).toBeNull();
    });

    it('should overwrite session when adding with duplicate id', () => {
      store.addSession(makeSession({ id: 'dup', name: 'First' }));
      store.addSession(makeSession({ id: 'dup', name: 'Second' }));
      expect(store.getAllSessions()).toHaveLength(1);
      expect(store.getSession('dup')!.name).toBe('Second');
    });

    it('should remove only the specified session, leaving others intact', () => {
      store.addSession(makeSession({ id: 'a' }));
      store.addSession(makeSession({ id: 'b' }));
      store.removeSession('a');
      expect(store.getSession('a')).toBeNull();
      expect(store.getSession('b')).not.toBeNull();
    });
  });

  describe('persistence', () => {
    it('should persist non-ended sessions: index + individual files', () => {
      store.addSession(makeSession({ id: 'a', status: 'idle' }));
      store.addSession(makeSession({ id: 'b', status: 'ended' }));
      store.persistSessions();

      // Find the index file write (sessions.json)
      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const indexWrite = writeCalls.find((c) => String(c[0]).includes('sessions.json.tmp'));
      expect(indexWrite).toBeDefined();
      const index = JSON.parse(indexWrite![1] as string);
      expect(index.sessionIds).toEqual(['a']);

      // Find the session file write (session-a.json)
      const sessionWrite = writeCalls.find((c) => String(c[0]).includes('session-a.json.tmp'));
      expect(sessionWrite).toBeDefined();
      const saved = JSON.parse(sessionWrite![1] as string);
      expect(saved.id).toBe('a');

      // Should NOT write session-b (ended)
      const sessionBWrite = writeCalls.find((c) => String(c[0]).includes('session-b.json.tmp'));
      expect(sessionBWrite).toBeUndefined();
    });

    it('should load persisted sessions from index + individual files', () => {
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.includes('sessions.json')) {
          return JSON.stringify({ sessionIds: ['x'] });
        }
        if (filePath.includes('session-x.json')) {
          return JSON.stringify({ id: 'x', name: 'Persisted', cwd: '/tmp', worktree: null, flags: [], model: null, contextUsage: null, createdAt: 1, lastActiveAt: 1 });
        }
        throw new Error('ENOENT');
      });
      const persisted = store.loadPersistedSessions();
      expect(persisted).toHaveLength(1);
      expect(persisted[0].name).toBe('Persisted');
    });

    it('should return empty array if sessions index is missing', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const persisted = store.loadPersistedSessions();
      expect(persisted).toEqual([]);
    });

    it('should skip sessions with missing individual files', () => {
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.includes('sessions.json')) {
          return JSON.stringify({ sessionIds: ['a', 'b'] });
        }
        if (filePath.includes('session-a.json')) {
          return JSON.stringify({ id: 'a', name: 'A', cwd: '/tmp', worktree: null, flags: [], model: null, contextUsage: null, createdAt: 1, lastActiveAt: 1 });
        }
        throw new Error('ENOENT');
      });
      const persisted = store.loadPersistedSessions();
      expect(persisted).toHaveLength(1);
      expect(persisted[0].id).toBe('a');
    });

    it('should persist only PersistedSession fields (no runtime state)', () => {
      store.addSession(makeSession({
        id: 'p1',
        status: 'thinking',
        model: 'opus',
        contextUsage: 50,
        gitBranch: 'main',
      }));
      store.persistSessions();

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const sessionWrite = writeCalls.find((c) => String(c[0]).includes('session-p1.json.tmp'));
      expect(sessionWrite).toBeDefined();
      const saved = JSON.parse(sessionWrite![1] as string);
      expect(saved).not.toHaveProperty('status');
      expect(saved).not.toHaveProperty('gitBranch');
      expect(saved).toHaveProperty('model', 'opus');
      expect(saved).toHaveProperty('contextUsage', 50);
      expect(saved).toHaveProperty('id');
      expect(saved).toHaveProperty('name');
      expect(saved).toHaveProperty('cwd');
      expect(saved).toHaveProperty('flags');
    });

    it('should delete session file and update index on removeSession', () => {
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});
      store.addSession(makeSession({ id: 'a', status: 'idle' }));
      store.addSession(makeSession({ id: 'b', status: 'idle' }));
      store.removeSession('a');

      // Should have tried to delete session-a.json
      expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledWith(
        expect.stringContaining('session-a.json')
      );

      // Index should only contain 'b'
      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const indexWrite = writeCalls.find((c) => String(c[0]).includes('sessions.json.tmp'));
      expect(indexWrite).toBeDefined();
      const index = JSON.parse(indexWrite![1] as string);
      expect(index.sessionIds).toEqual(['b']);
    });
  });

  describe('app state', () => {
    it('should load default app state when file is missing', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const state = store.loadAppState();
      expect(state.windowBounds).toBeDefined();
      expect(state.panelSizes).toBeDefined();
      expect(state.lastActiveSessionId).toBeNull();
      expect(state.newSessionDefaults).toBeDefined();
    });

    it('should return default app state for corrupted JSON', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('corrupted!!!');
      const state = store.loadAppState();
      expect(state.windowBounds).toBeDefined();
      expect(state.lastActiveSessionId).toBeNull();
    });

    it('should merge partial app state on save', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          windowBounds: { x: 0, y: 0, width: 800, height: 600 },
          panelSizes: { sidebarWidth: 300, shellHeight: 200, toolkitHeight: 200, shellCollapsed: false },
          lastActiveSessionId: null,
          newSessionDefaults: { cwd: '/tmp', flags: [] },
        })
      );

      store.saveAppState({ lastActiveSessionId: 'session-1' });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string);
      expect(written.lastActiveSessionId).toBe('session-1');
      expect(written.windowBounds.width).toBe(800); // preserved
    });

    it('should get new session defaults', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          windowBounds: { x: 0, y: 0, width: 800, height: 600 },
          panelSizes: { sidebarWidth: 300, shellHeight: 200, toolkitHeight: 200, shellCollapsed: false },
          lastActiveSessionId: null,
          newSessionDefaults: { cwd: '/home/user', flags: ['--enable-auto-mode'] },
        })
      );
      const defaults = store.getNewSessionDefaults();
      expect(defaults.cwd).toBe('/home/user');
      expect(defaults.flags).toContain('--enable-auto-mode');
    });

    it('should persist --dangerously-skip-permissions in new session defaults', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          windowBounds: { x: 0, y: 0, width: 800, height: 600 },
          panelSizes: { sidebarWidth: 300, shellHeight: 200, toolkitHeight: 200, shellCollapsed: false },
          lastActiveSessionId: null,
          newSessionDefaults: { cwd: '/tmp', flags: ['--dangerously-skip-permissions'] },
        })
      );
      const defaults = store.getNewSessionDefaults();
      expect(defaults.flags).toContain('--dangerously-skip-permissions');
    });
  });

  describe('toolkit commands', () => {
    it('should load toolkit commands', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          commands: [
            { id: 'cmd-1', label: 'Test', command: '/test' },
          ],
        })
      );
      const cmds = store.loadToolkitCommands();
      expect(cmds).toHaveLength(1);
      expect(cmds[0].label).toBe('Test');
    });

    it('should return empty array for corrupted toolkit file', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('not json');
      const cmds = store.loadToolkitCommands();
      expect(cmds).toEqual([]);
    });

    it('should save toolkit commands', () => {
      const commands = [
        { id: 'cmd-1', label: 'Test', command: '/test' },
      ];
      store.saveToolkitCommands(commands as any);
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string);
      expect(written.commands).toHaveLength(1);
    });

    it('should return all commands', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          commands: [
            { id: '1', label: 'All', command: '/all' },
            { id: '2', label: 'Other', command: '/other' },
          ],
        })
      );
      const all = store.getToolkitCommands();
      expect(all).toHaveLength(2);
    });
  });
});
