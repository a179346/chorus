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

const { SessionStore, toPersisted, fromPersisted, lastClosedByUser, RECENTLY_CLOSED_LIMIT } = await import('../src/main/session-store');

function makeSession(overrides: Partial<import('../src/shared/types').Session> = {}): import('../src/shared/types').Session {
  return {
    id: 'test-id-1',
    name: 'Test Session',
    cwd: '/tmp/test',
    worktree: null,
    status: 'idle',
    model: null,
    contextUsage: null,
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
    it('should persist every session, including ones whose claude exited: index + individual files', () => {
      store.addSession(makeSession({ id: 'a', status: 'idle' }));
      store.addSession(makeSession({ id: 'b', status: 'ended' }));
      store.addSession(makeSession({ id: 'c', status: 'error' }));
      store.persistSessions();

      // Find the index file write (sessions.json)
      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const indexWrite = writeCalls.find((c) => String(c[0]).includes('sessions.json.tmp'));
      expect(indexWrite).toBeDefined();
      const index = JSON.parse(indexWrite![1] as string);
      expect(index.sessionIds).toEqual(['a', 'b', 'c']);

      for (const id of ['a', 'b', 'c']) {
        const sessionWrite = writeCalls.find((c) => String(c[0]).includes(`session-${id}.json.tmp`));
        expect(sessionWrite).toBeDefined();
        expect(JSON.parse(sessionWrite![1] as string).id).toBe(id);
      }
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

    it.each([['null'], ['{}'], ['[]'], ['{"sessionIds":{}}']])(
      'should return empty array if the sessions index is %s',
      (content) => {
        vi.mocked(fs.readFileSync).mockReturnValue(content);
        expect(store.loadPersistedSessions()).toEqual([]);
      },
    );

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

    describe('saved sessions not restored', () => {
      const STORED = { name: 'S', cwd: '/tmp', worktree: null, flags: [], model: null, contextUsage: null, createdAt: 1, lastActiveAt: 1 };

      function savedOnDisk(ids: string[]): void {
        vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
          const filePath = String(p);
          if (filePath.endsWith('sessions.json')) return JSON.stringify({ sessionIds: ids });
          const id = ids.find((i) => filePath.endsWith(`session-${i}.json`));
          if (id) return JSON.stringify({ ...STORED, id });
          throw new Error('ENOENT');
        });
      }

      function writtenIndex(): string[] {
        const indexWrite = vi.mocked(fs.writeFileSync).mock.calls.filter((c) => String(c[0]).includes('sessions.json.tmp')).at(-1);
        expect(indexWrite).toBeDefined();
        return JSON.parse(indexWrite![1] as string).sessionIds;
      }

      it('stay in the index when other sessions are written', () => {
        savedOnDisk(['a', 'b']);
        store.loadPersistedSessions();
        store.addSession(makeSession({ id: 'a' }));
        store.addSession(makeSession({ id: 'new' }));
        store.persistSessions();

        expect(writtenIndex()).toEqual(['a', 'new', 'b']);
        // Only listed sessions are written; b's file is left as it is
        expect(vi.mocked(fs.writeFileSync).mock.calls.some((c) => String(c[0]).includes('session-b.json'))).toBe(false);
      });

      it('stay in the index when a write comes before any restore', () => {
        savedOnDisk(['a', 'b']);
        store.addSession(makeSession({ id: 'new' }));
        store.persistSessions();

        expect(writtenIndex()).toEqual(['new', 'a', 'b']);
      });

      it('stay in the index through a reorder and a removal', () => {
        savedOnDisk(['a', 'b']);
        store.loadPersistedSessions();
        store.addSession(makeSession({ id: 'x' }));
        store.addSession(makeSession({ id: 'y' }));

        store.reorderSessions(['y', 'x']);
        expect(writtenIndex()).toEqual(['y', 'x', 'a', 'b']);

        vi.mocked(fs.unlinkSync).mockImplementation(() => {});
        store.removeSession('x');
        expect(writtenIndex()).toEqual(['y', 'a', 'b']);
      });

      it('leave the index, and lose their file, when removed', () => {
        vi.mocked(fs.unlinkSync).mockImplementation(() => {});
        savedOnDisk(['a', 'b']);
        store.loadPersistedSessions();
        store.removeSession('a');

        expect(writtenIndex()).toEqual(['b']);
        expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledWith(expect.stringContaining('session-a.json'));
      });

      it('leave out ids whose file is gone once loaded', () => {
        vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
          const filePath = String(p);
          if (filePath.endsWith('sessions.json')) return JSON.stringify({ sessionIds: ['a', 'gone'] });
          if (filePath.endsWith('session-a.json')) return JSON.stringify({ ...STORED, id: 'a' });
          throw new Error('ENOENT');
        });
        store.loadPersistedSessions();
        store.persistSessions();

        expect(writtenIndex()).toEqual(['a']);
      });

      it('keep their files through the orphan cleanup', () => {
        vi.mocked(fs.unlinkSync).mockImplementation(() => {});
        vi.mocked(fs.readdirSync).mockReturnValue(
          ['session-a.json', 'session-b.json', 'session-orphan.json', 'state.json'] as any,
        );
        savedOnDisk(['b']);
        store.loadPersistedSessions();
        store.addSession(makeSession({ id: 'a' }));
        store.cleanupOrphanedSessionFiles();

        const deleted = vi.mocked(fs.unlinkSync).mock.calls.map((c) => path.basename(String(c[0])));
        expect(deleted).toEqual(['session-orphan.json']);
      });
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
      expect(state.favoriteDirectories).toEqual([]);
    });

    it('should backfill favoriteDirectories when state.json predates them', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          windowBounds: { x: 0, y: 0, width: 800, height: 600 },
        })
      );
      expect(store.loadAppState().favoriteDirectories).toEqual([]);
    });

    it('should preserve saved favoriteDirectories', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ favoriteDirectories: ['/Users/me/code/app'] })
      );
      expect(store.loadAppState().favoriteDirectories).toEqual(['/Users/me/code/app']);
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

    it('should include default font sizes in terminalSettings when file is missing', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const state = store.loadAppState();
      expect(state.terminalSettings.claudeFontSize).toBe(13);
      expect(state.terminalSettings.shellFontSize).toBe(13);
      expect(typeof state.terminalSettings.fontFamily).toBe('string');
      expect(typeof state.terminalSettings.theme).toBe('string');
    });

    it('should backfill missing fontSize fields when state.json predates them', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          windowBounds: { x: 0, y: 0, width: 800, height: 600 },
          panelSizes: { sidebarWidth: 300, shellHeight: 200, toolkitHeight: 200, shellCollapsed: false },
          lastActiveSessionId: null,
          newSessionDefaults: { cwd: '/tmp', flags: [] },
          terminalSettings: { fontFamily: 'monospace', theme: 'espresso' },
        })
      );
      const state = store.loadAppState();
      expect(state.terminalSettings.fontFamily).toBe('monospace');
      expect(state.terminalSettings.theme).toBe('espresso');
      expect(state.terminalSettings.claudeFontSize).toBe(13);
      expect(state.terminalSettings.shellFontSize).toBe(13);
    });

    it('should preserve user-set fontSize values', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          terminalSettings: { fontFamily: 'monospace', theme: 'espresso', claudeFontSize: 16, shellFontSize: 11 },
        })
      );
      const state = store.loadAppState();
      expect(state.terminalSettings.claudeFontSize).toBe(16);
      expect(state.terminalSettings.shellFontSize).toBe(11);
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

  describe('recently closed', () => {
    function storedClosed(ids: string[]): void {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ sessions: ids.map((id) => ({ id })) }),
      );
    }

    function writtenClosedIds(): string[] {
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.at(-1)!;
      expect(String(writeCall[0])).toContain('recently-closed.json');
      return JSON.parse(writeCall[1] as string).sessions.map((s: { id: string }) => s.id);
    }

    it('should return an empty list when nothing was closed yet', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(store.loadRecentlyClosed()).toEqual([]);
    });

    it.each([['null'], ['{}'], ['{"sessions":{}}']])(
      'should treat a file holding %s as an empty list',
      (content) => {
        vi.mocked(fs.readFileSync).mockReturnValue(content);
        expect(store.loadRecentlyClosed()).toEqual([]);

        store.rememberClosed(makeSession({ id: 'c' }));
        expect(writtenClosedIds()).toEqual(['c']);
      },
    );

    it('should put the newly closed session first', () => {
      storedClosed(['a', 'b']);
      store.rememberClosed(makeSession({ id: 'c' }));
      expect(writtenClosedIds()).toEqual(['c', 'a', 'b']);
    });

    it('should move a session closed again to the front instead of duplicating it', () => {
      storedClosed(['a', 'b', 'c']);
      store.rememberClosed(makeSession({ id: 'b' }));
      expect(writtenClosedIds()).toEqual(['b', 'a', 'c']);
    });

    it('should keep at most RECENTLY_CLOSED_LIMIT sessions', () => {
      storedClosed(Array.from({ length: RECENTLY_CLOSED_LIMIT }, (_, i) => `old-${i}`));
      store.rememberClosed(makeSession({ id: 'new' }));

      const ids = writtenClosedIds();
      expect(ids).toHaveLength(RECENTLY_CLOSED_LIMIT);
      expect(ids[0]).toBe('new');
      expect(ids).not.toContain(`old-${RECENTLY_CLOSED_LIMIT - 1}`);
    });

    it('should forget a reopened session', () => {
      storedClosed(['a', 'b', 'c']);
      store.forgetClosed('b');
      expect(writtenClosedIds()).toEqual(['a', 'c']);
    });

    describe('saved sessions that could not be restored', () => {
      const STORED = { name: 'S', cwd: '/gone', worktree: null, flags: [], notifyOnIdle: false, unread: false, model: null, contextUsage: null, createdAt: 1, lastActiveAt: 1, hasUserInput: true };
      // What the store has written, by path, so that reads see earlier writes
      let disk: Map<string, string>;

      beforeEach(() => {
        disk = new Map();
        vi.mocked(fs.writeFileSync).mockImplementation((file, data) => {
          disk.set(String(file).replace(/\.tmp$/, ''), String(data));
        });
        vi.mocked(fs.readFileSync).mockImplementation((file) => {
          const content = disk.get(String(file));
          if (content === undefined) throw new Error('ENOENT');
          return content;
        });
        vi.mocked(fs.unlinkSync).mockImplementation(() => {});
      });

      function onDisk(name: string, data: unknown): void {
        disk.set(path.join('/mock-home', '.chorus', name), JSON.stringify(data));
      }

      function closedIds(): string[] {
        return store.loadRecentlyClosed().map((s) => s.id);
      }

      function recentlyClosedWrites(): number {
        return vi.mocked(fs.writeFileSync).mock.calls.filter((c) => String(c[0]).includes('recently-closed.json')).length;
      }

      it('go first, all in one write', () => {
        onDisk('recently-closed.json', { sessions: [{ ...STORED, id: 'closed' }] });
        store.moveUnrestorableToRecentlyClosed([{ ...STORED, id: 'f1' }, { ...STORED, id: 'f2' }]);

        expect(closedIds()).toEqual(['f1', 'f2', 'closed']);
        expect(recentlyClosedWrites()).toBe(1);
      });

      it('stay past the limit, which only drops sessions closed by the user', () => {
        const closed = Array.from({ length: RECENTLY_CLOSED_LIMIT }, (_, i) => ({ ...STORED, id: `old-${i}` }));
        onDisk('recently-closed.json', { sessions: closed });
        const failed = Array.from({ length: RECENTLY_CLOSED_LIMIT + 2 }, (_, i) => ({ ...STORED, id: `failed-${i}` }));

        store.moveUnrestorableToRecentlyClosed(failed);
        expect(closedIds()).toEqual([...failed, ...closed].map((s) => s.id));

        store.rememberClosed(makeSession({ id: 'new' }));
        expect(closedIds()).toEqual(['new', ...failed.map((s) => s.id), ...closed.slice(0, -1).map((s) => s.id)]);
      });

      it('leave the saved sessions once Recently Closed holds them', () => {
        onDisk('sessions.json', { sessionIds: ['f1', 'kept'] });
        onDisk('session-f1.json', { ...STORED, id: 'f1' });
        onDisk('session-kept.json', { ...STORED, id: 'kept' });
        const [f1] = store.loadPersistedSessions();

        store.moveUnrestorableToRecentlyClosed([f1]);

        const unlink = vi.mocked(fs.unlinkSync).mock;
        expect(unlink.calls.map((c) => path.basename(String(c[0])))).toEqual(['session-f1.json']);
        const recentlyClosedWrite = vi.mocked(fs.writeFileSync).mock.calls.findIndex((c) => String(c[0]).includes('recently-closed.json'));
        expect(vi.mocked(fs.writeFileSync).mock.invocationCallOrder[recentlyClosedWrite]).toBeLessThan(unlink.invocationCallOrder[0]);
        expect(JSON.parse(disk.get(path.join('/mock-home', '.chorus', 'sessions.json'))!).sessionIds).toEqual(['kept']);
      });

      it('are passed over when reopening the latest session the user closed', () => {
        onDisk('recently-closed.json', { sessions: [{ ...STORED, id: 'closed' }] });
        store.moveUnrestorableToRecentlyClosed([{ ...STORED, id: 'f1' }]);
        expect(lastClosedByUser(store.loadRecentlyClosed())).toMatchObject({ id: 'closed' });

        store.forgetClosed('closed');
        expect(lastClosedByUser(store.loadRecentlyClosed())).toBeUndefined();
      });

      it('take in a session kept after its reopen failed, which then is passed over the same way, where it is', () => {
        onDisk('recently-closed.json', { sessions: [{ ...STORED, id: 'failing' }, { ...STORED, id: 'older' }] });

        store.markRestoreFailed('failing');

        expect(closedIds()).toEqual(['failing', 'older']);
        expect(lastClosedByUser(store.loadRecentlyClosed())).toMatchObject({ id: 'older' });
      });

      it('stay saved, to be restored next time, when Recently Closed cannot be written', () => {
        onDisk('sessions.json', { sessionIds: ['f1'] });
        onDisk('session-f1.json', { ...STORED, id: 'f1' });
        const [f1] = store.loadPersistedSessions();
        vi.mocked(fs.writeFileSync).mockImplementation((file) => {
          if (String(file).includes('recently-closed.json')) throw new Error('EACCES');
        });

        expect(() => store.moveUnrestorableToRecentlyClosed([f1])).toThrow('EACCES');

        expect(fs.unlinkSync).not.toHaveBeenCalled();
        store.persistSessions();
        const indexWrite = vi.mocked(fs.writeFileSync).mock.calls.filter((c) => String(c[0]).includes('sessions.json.tmp')).at(-1);
        expect(JSON.parse(String(indexWrite![1])).sessionIds).toEqual(['f1']);
      });
    });
  });

  describe('toolkit commands', () => {
    const A = { label: 'A', command: '/a' };
    const B = { label: 'B', command: '/b' };
    const Z = { label: 'Z', command: '/z' };

    // Reads see what the last write wrote, so each edit starts from the one before
    function toolkitOnDisk(file: unknown): void {
      let content = JSON.stringify(file);
      vi.mocked(fs.readFileSync).mockImplementation(() => content);
      vi.mocked(fs.writeFileSync).mockImplementation((_file, data) => {
        content = String(data);
      });
    }

    function writtenToolkit(): unknown {
      const write = vi.mocked(fs.writeFileSync).mock.calls.filter((c) => String(c[0]).includes('toolkit.json.tmp')).at(-1);
      expect(write).toBeDefined();
      return JSON.parse(String(write![1]));
    }

    function loadedIds(): string[] {
      return store.loadToolkitCommands().map((c) => c.id);
    }

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

    it.each([['null'], ['[]'], ['{}'], ['{"commands":{}}']])('should treat a toolkit file holding %s as empty', (content) => {
      vi.mocked(fs.readFileSync).mockReturnValue(content);
      expect(store.loadToolkitCommands()).toEqual([]);
    });

    it('should leave out entries that are not commands', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          commands: [null, 'x', { id: 'a' }, { id: 'b', label: 'B', command: 7 }, { id: 'c', label: 'C', command: '/c' }],
        }),
      );
      expect(store.loadToolkitCommands()).toEqual([{ id: 'c', label: 'C', command: '/c' }]);
    });

    it('should drop an icon that is not a name', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ commands: [{ id: 'a', label: 'A', command: '/a', icon: null }] }),
      );
      expect(store.loadToolkitCommands()).toEqual([{ id: 'a', label: 'A', command: '/a' }]);
    });

    it('should keep each id no other entry has, and derive the others from the label and command, the same on every load', () => {
      toolkitOnDisk({
        commands: [
          { id: 'dup', label: 'One', command: '/1' },
          { id: 'dup', label: 'Two', command: '/2' },
          { label: 'Three', command: '/3' },
          { id: '', label: 'Four', command: '/4' },
          { id: 'own', label: 'Five', command: '/5' },
        ],
      });
      const ids = loadedIds();

      expect(ids.slice(0, 4)).toEqual(Array.from({ length: 4 }, () => expect.stringMatching(/^command-[0-9a-f]{8}$/)));
      expect(ids[4]).toBe('own');
      expect(new Set(ids).size).toBe(ids.length);
      expect(loadedIds()).toEqual(ids);
    });

    it('should give a command the same derived id wherever it is, telling twins apart by order', () => {
      toolkitOnDisk({ commands: [A, B] });
      const [, b] = store.loadToolkitCommands();

      toolkitOnDisk({ commands: [Z, B, A] });
      expect(store.loadToolkitCommands()[1]).toEqual(b);

      toolkitOnDisk({ commands: [A, A, B] });
      const ids = loadedIds();
      expect(ids[0]).not.toBe(ids[1]);
      expect(ids[2]).toBe(b.id);
      expect(loadedIds()).toEqual(ids);
    });

    it('should derive no id that an entry has as its own, even one entries share', () => {
      toolkitOnDisk({ commands: [A] });
      const [{ id: derived }] = store.loadToolkitCommands();

      toolkitOnDisk({ commands: [A, { ...B, id: derived }] });
      expect(loadedIds()).toEqual([`${derived}-2`, derived]);

      toolkitOnDisk({ commands: [A, { ...B, id: derived }, { ...Z, id: derived }] });
      expect(loadedIds()).not.toContain(derived);
    });

    it('should find the command to run by its id after entries are moved by hand', () => {
      toolkitOnDisk({ commands: [A, B] });
      const [, b] = store.loadToolkitCommands();

      toolkitOnDisk({ commands: [B, A] });

      expect(store.requireToolkitCommand(b.id).command).toBe('/b');
    });

    it('should refuse to run an id no command goes by', () => {
      toolkitOnDisk({ commands: [A] });
      expect(() => store.requireToolkitCommand('missing')).toThrow(/changed or removed outside Chorus/);
    });

    it('should never write when loading or finding commands', () => {
      toolkitOnDisk({ commands: [A, A, { ...B, id: 'dup' }, { ...Z, id: 'dup' }, { label: 'Not a command' }] });

      const [first] = store.loadToolkitCommands();
      store.requireToolkitCommand(first.id);

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.renameSync).not.toHaveBeenCalled();
    });

    it('should save toolkit commands', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('{"commands":[]}');
      const commands = [
        { id: 'cmd-1', label: 'Test', command: '/test' },
      ];
      store.saveToolkitCommands(commands);
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string);
      expect(written.commands).toHaveLength(1);
    });

    describe('edits', () => {
      const HAND_WRITTEN = [
        { id: 'a', label: 'A', command: '/a' },
        { label: 'Not a command yet' },
        { id: 'b', label: 'B', command: '/b', note: 'mine' },
      ];
      const NEW = { id: 'c', label: 'C', command: '/c' };

      it('add a command after every entry, keeping the ones that are not commands and the other keys', () => {
        toolkitOnDisk({ commands: HAND_WRITTEN, comment: 'my toolkit' });
        store.addToolkitCommand(NEW);
        expect(writtenToolkit()).toEqual({ commands: [...HAND_WRITTEN, NEW], comment: 'my toolkit' });
      });

      it('replace the edited command whole, and only it', () => {
        toolkitOnDisk({ commands: HAND_WRITTEN });
        store.updateToolkitCommand({ id: 'b', label: 'B2', command: '/b2' });
        expect(writtenToolkit()).toEqual({ commands: [HAND_WRITTEN[0], HAND_WRITTEN[1], { id: 'b', label: 'B2', command: '/b2' }] });
      });

      it('delete only the deleted command', () => {
        toolkitOnDisk({ commands: HAND_WRITTEN });
        store.deleteToolkitCommand('a');
        expect(writtenToolkit()).toEqual({ commands: HAND_WRITTEN.slice(1) });
      });

      it('return the commands they wrote, without reading the file again', () => {
        toolkitOnDisk({ commands: HAND_WRITTEN });

        const returned = store.addToolkitCommand(NEW);

        expect(fs.readFileSync).toHaveBeenCalledTimes(1);
        expect(returned).toEqual(store.loadToolkitCommands());
        expect(returned.map((c) => c.id)).toEqual(['a', 'b', 'c']);
      });

      it('find a command by the id it was loaded with', () => {
        const commands = [{ label: 'One', command: '/1' }, { label: 'Two', command: '/2' }];
        toolkitOnDisk({ commands });
        const [first, second] = store.loadToolkitCommands();

        store.deleteToolkitCommand(second.id);

        expect(writtenToolkit()).toEqual({ commands: [{ ...commands[0], id: first.id }] });
      });

      it('find a command by the id it was loaded with after an entry is added above it by hand', () => {
        toolkitOnDisk({ commands: [A, B] });
        const [a, b] = store.loadToolkitCommands();
        toolkitOnDisk({ commands: [Z, A, B] });
        const [z] = store.loadToolkitCommands();

        store.updateToolkitCommand({ ...b, label: 'B!' });
        expect(writtenToolkit()).toEqual({ commands: [{ ...Z, id: z.id }, { ...A, id: a.id }, { ...b, label: 'B!' }] });

        store.deleteToolkitCommand(b.id);
        expect(writtenToolkit()).toEqual({ commands: [{ ...Z, id: z.id }, { ...A, id: a.id }] });
      });

      it('write in the ids of commands that go by derived ones', () => {
        const commands = [
          { label: 'One', command: '/1' },
          { id: 'x', label: 'X', command: '/x' },
          { id: 'x', label: 'X again', command: '/x2' },
        ];
        toolkitOnDisk({ commands });
        const ids = loadedIds();

        store.addToolkitCommand(NEW);

        expect(ids).not.toContain('x');
        expect(writtenToolkit()).toEqual({
          commands: [...commands.map((command, i) => ({ ...command, id: ids[i] })), NEW],
        });
      });

      it('keep each id on the command it was loaded for, through edits of the other commands', () => {
        toolkitOnDisk({
          commands: [{ label: 'One', command: '/1' }, { label: 'Two', command: '/2' }, { label: 'Three', command: '/3' }],
        });
        const [one, two, three] = store.loadToolkitCommands();

        store.deleteToolkitCommand(one.id);
        expect(store.loadToolkitCommands()).toEqual([two, three]);

        store.updateToolkitCommand({ ...two, label: 'Two!' });
        expect(store.requireToolkitCommand(three.id)).toEqual(three);
        store.deleteToolkitCommand(three.id);

        expect(store.loadToolkitCommands()).toEqual([{ ...two, label: 'Two!' }]);
      });

      it('refuse to update an id no command goes by, leaving the file alone', () => {
        toolkitOnDisk({ commands: HAND_WRITTEN });
        expect(() => store.updateToolkitCommand({ ...NEW, id: 'missing' })).toThrow(/changed or removed outside Chorus/);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('refuse to update a command whose label or command was changed by hand before it had its id written', () => {
        toolkitOnDisk({ commands: [A] });
        const [a] = store.loadToolkitCommands();
        toolkitOnDisk({ commands: [{ ...A, command: '/a-changed' }] });

        expect(() => store.updateToolkitCommand({ ...a, label: 'A!' })).toThrow(/changed or removed outside Chorus/);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('delete an id no command goes by as already gone, writing nothing', () => {
        toolkitOnDisk({ commands: HAND_WRITTEN });
        const loaded = store.loadToolkitCommands();

        expect(store.deleteToolkitCommand('missing')).toEqual(loaded);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('find neither of two commands by the id they were both given by hand', () => {
        toolkitOnDisk({ commands: [{ ...A, id: 'u' }] });
        const [a] = store.loadToolkitCommands();
        toolkitOnDisk({ commands: [{ id: 'u', label: 'A copy', command: '/a-copy' }, { ...A, id: 'u' }] });
        const loaded = store.loadToolkitCommands();

        expect(loaded.map((c) => c.id)).not.toContain('u');
        expect(() => store.updateToolkitCommand({ ...a, label: 'A!' })).toThrow(/changed or removed outside Chorus/);
        expect(store.deleteToolkitCommand(a.id)).toEqual(loaded);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('start the toolkit when there is no file', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        store.addToolkitCommand(NEW);
        expect(writtenToolkit()).toEqual({ commands: [NEW] });
      });

      it.each([['not json'], ['null'], ['[]'], ['{}'], ['{"commands":{}}']])(
        'refuse to overwrite a file holding %s, which loads as empty',
        (content) => {
          vi.mocked(fs.readFileSync).mockReturnValue(content);
          const refusal = /toolkit\.json: it isn't JSON with a "commands" list/;

          expect(() => store.addToolkitCommand(NEW)).toThrow(refusal);
          expect(() => store.updateToolkitCommand(NEW)).toThrow(refusal);
          expect(() => store.deleteToolkitCommand('a')).toThrow(refusal);
          expect(() => store.saveToolkitCommands([NEW])).toThrow(refusal);
          expect(fs.writeFileSync).not.toHaveBeenCalled();
        },
      );
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
      const all = store.loadToolkitCommands();
      expect(all).toHaveLength(2);
    });
  });
});

describe('toPersisted / fromPersisted', () => {
  const base = {
    id: 'p1',
    name: 'Persisted',
    cwd: '/tmp',
    worktree: null,
    flags: [],
    notifyOnIdle: false,
    unread: false,
    model: null,
    contextUsage: null,
    contextLimit: null,
    createdAt: 1,
    lastActiveAt: 1,
    hasUserInput: true,
    exitStatus: null,
  };

  it('round-trips linked PRs', () => {
    const prs = [
      { owner: 'o', repo: 'r', number: 1, stage: 'merged' as const, stageUpdatedAt: 5 },
      { owner: 'o', repo: 'r', number: 2, stage: 'not-found' as const, stageUpdatedAt: 6 },
    ];
    const session = fromPersisted({ ...base, prs });

    expect(session.prs).toEqual(prs);
    expect(toPersisted(session)).toEqual({ ...base, prs });
  });

  it('ignores keys this version no longer writes', () => {
    const stored = JSON.parse(JSON.stringify({ ...base, prs: [], unlinkedPrs: [{ owner: 'o', repo: 'r', number: 3 }] }));

    expect(toPersisted(fromPersisted(stored))).toEqual({ ...base, prs: [] });
  });

  it.each([['ended' as const], ['error' as const]])('saves that claude exited (%s) and restores the session exited', (status) => {
    const saved = toPersisted({ ...fromPersisted({ ...base, prs: [] }), status });

    expect(saved.exitStatus).toBe(status);
    expect(fromPersisted(saved).status).toBe(status);
  });

  it.each([['idle' as const], ['thinking' as const], ['creating' as const]])(
    'saves a session whose claude runs (%s) as running, to be relaunched',
    (status) => {
      const saved = toPersisted({ ...fromPersisted({ ...base, prs: [] }), status });

      expect(saved.exitStatus).toBeNull();
      expect(fromPersisted(saved).status).toBe('creating');
    },
  );

  it('reads a file from before exit statuses were saved as a running session', () => {
    const { exitStatus: _omitted, ...stored } = base;

    expect(fromPersisted({ ...stored, prs: [] }).status).toBe('creating');
  });

  it('reads a file from before v1.5.0 without a context limit', () => {
    const { contextLimit: _omitted, ...stored } = base;

    expect(fromPersisted(stored).contextLimit).toBeNull();
  });

  it('migrates a file from before multiple PRs into a one-PR list', () => {
    const legacy = JSON.parse(
      JSON.stringify({ ...base, pr: { owner: 'o', repo: 'r', number: 7 }, stage: 'draft', stageUpdatedAt: 9 }),
    );
    const session = fromPersisted(legacy);

    expect(session.prs).toEqual([{ owner: 'o', repo: 'r', number: 7, stage: 'draft', stageUpdatedAt: 9 }]);
  });

  it("migrates a legacy PR whose stage was never resolved ('no-pr') as unknown", () => {
    const legacy = JSON.parse(
      JSON.stringify({ ...base, pr: { owner: 'o', repo: 'r', number: 7 }, stage: 'no-pr', stageUpdatedAt: null }),
    );

    expect(fromPersisted(legacy).prs).toEqual([
      { owner: 'o', repo: 'r', number: 7, stage: 'unknown', stageUpdatedAt: null },
    ]);
  });

  it('migrates a legacy file without a PR to an empty list', () => {
    const legacy = JSON.parse(JSON.stringify({ ...base, pr: null, stage: 'no-pr', stageUpdatedAt: null }));

    expect(fromPersisted(legacy).prs).toEqual([]);
  });
});
