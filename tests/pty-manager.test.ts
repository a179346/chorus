import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock node-pty
vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn(() => makeMockPty()),
  },
  spawn: vi.fn(() => makeMockPty()),
}));

function makeMockPty() {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    pid: 12345,
    cols: 120,
    rows: 30,
  };
}

const { PtyManager } = await import('../src/main/pty-manager');
const nodePty = vi.mocked(await import('node-pty'));

/** The onData callback of the n-th spawned PTY. */
function dataCallbackAt(spawnIndex: number): (data: string) => void {
  return nodePty.spawn.mock.results[spawnIndex].value.onData.mock.calls[0][0];
}

function exitClaudeAt(spawnIndex: number, exitCode = 0): void {
  nodePty.spawn.mock.results[spawnIndex].value.onExit.mock.calls[0][0]({ exitCode, signal: 0 });
}

/** The claude and shell PTYs the last spawn() created, in that order. */
function lastSpawnedPtys() {
  const results = nodePty.spawn.mock.results;
  return { claude: results.at(-2)!.value, shell: results.at(-1)!.value };
}

function makeMockWindow(destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: {
      send: vi.fn(),
    },
  } as any;
}

describe('PtyManager', () => {
  let manager: InstanceType<typeof PtyManager>;

  beforeEach(() => {
    manager = new PtyManager();
    vi.clearAllMocks();
    // Reset spawn to return fresh mock objects each time
    nodePty.spawn.mockImplementation(() => makeMockPty() as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('spawn', () => {
    it('should spawn both claude and shell PTYs', () => {
      manager.spawn('session-1', '/tmp/test', []);
      expect(nodePty.spawn).toHaveBeenCalledTimes(2);
    });

    it('should spawn claude with correct args', () => {
      manager.spawn('session-1', '/tmp/test', ['--enable-auto-mode']);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[0]).toBe('claude');
      expect(firstCall[1]).toContain('--enable-auto-mode');
      expect(firstCall[2]).toMatchObject({ cwd: '/tmp/test' });
    });

    it('should pass --session-id with its value argument', () => {
      manager.spawn('session-1', '/tmp/test', ['--session-id', 'uuid-abc-123']);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[1]).toContain('--session-id');
      expect(firstCall[1]).toContain('uuid-abc-123');
    });

    it('should pass --name with its value argument', () => {
      manager.spawn('session-1', '/tmp/test', ['--name', 'My Session']);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[1]).toContain('--name');
      expect(firstCall[1]).toContain('My Session');
    });

    it('should pass --resume with its value argument', () => {
      manager.spawn('session-1', '/tmp/test', ['--resume', 'uuid-abc-123']);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[1]).toContain('--resume');
      expect(firstCall[1]).toContain('uuid-abc-123');
    });

    it('should spawn claude with --dangerously-skip-permissions flag', () => {
      manager.spawn('session-1', '/tmp/test', ['--dangerously-skip-permissions']);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[1]).toContain('--dangerously-skip-permissions');
    });

    it('should combine --session-id with other flags', () => {
      manager.spawn('session-1', '/tmp/test', ['--enable-auto-mode', '--session-id', 'uuid-123']);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[1]).toContain('--enable-auto-mode');
      expect(firstCall[1]).toContain('--session-id');
      expect(firstCall[1]).toContain('uuid-123');
    });

    it('should combine --resume with other flags', () => {
      manager.spawn('session-1', '/tmp/test', ['--resume', 'uuid-123', '--verbose']);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[1]).toContain('--resume');
      expect(firstCall[1]).toContain('uuid-123');
      expect(firstCall[1]).toContain('--verbose');
    });

    it('passes args through unchanged, flag values and the initial prompt included', () => {
      const args = ['--effort', 'high', '--allowed-tools', 'Bash(git *)', 'Edit', '--', 'fix the bug'];
      manager.spawn('session-1', '/tmp/test', args);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[1]).toEqual(args);
    });

    it('should pass empty args when no flags given', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const firstCall = nodePty.spawn.mock.calls[0];
      expect(firstCall[1]).toEqual([]);
    });

    it('should spawn shell PTY with default shell', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const secondCall = nodePty.spawn.mock.calls[1];
      expect(typeof secondCall[0]).toBe('string');
      expect(secondCall[2]).toMatchObject({ cwd: '/tmp/test' });
    });

    it('should register the session in the ptys map', () => {
      manager.spawn('session-1', '/tmp/test', []);
      expect(manager.has('session-1')).toBe(true);
    });

    it('should set up onData listeners for both PTYs', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      expect(pair.claude.onData).toHaveBeenCalled();
      expect(pair.shell.onData).toHaveBeenCalled();
    });

    it('should set up onExit listener for claude PTY', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      expect(pair.claude.onExit).toHaveBeenCalled();
    });

    it('kills the PTYs a session already has, so the two pairs never share its terminals', () => {
      const exitHandler = vi.fn();
      manager.setExitHandler(exitHandler);
      manager.spawn('session-1', '/tmp/test', []);
      const first = lastSpawnedPtys();
      manager.spawn('session-1', '/tmp/test', []);
      const second = lastSpawnedPtys();

      expect(first.claude.kill).toHaveBeenCalledWith('SIGTERM');
      expect(first.shell.kill).toHaveBeenCalledWith('SIGTERM');
      exitClaudeAt(0);
      expect(exitHandler).not.toHaveBeenCalled();
      manager.writeToClaude('session-1', 'hi');
      expect(second.claude.write).toHaveBeenCalledWith('hi');
    });

    it('should propagate error when pty.spawn throws', () => {
      nodePty.spawn.mockImplementationOnce(() => {
        throw new Error('spawn failed: command not found');
      });
      expect(() => manager.spawn('session-1', '/tmp/test', [])).toThrow('spawn failed');
    });
  });

  describe('spawnShell', () => {
    it('spawns only the shell, in the given cwd', () => {
      manager.spawnShell('session-1', '/tmp/repo');

      expect(nodePty.spawn).toHaveBeenCalledTimes(1);
      expect(nodePty.spawn.mock.calls[0][0]).not.toBe('claude');
      expect(nodePty.spawn.mock.calls[0][2]).toMatchObject({ cwd: '/tmp/repo' });
      expect(manager.has('session-1')).toBe(true);
    });

    it('forwards the shell and takes its input', () => {
      const win = makeMockWindow();
      manager.setMainWindow(win);
      manager.spawnShell('session-1', '/tmp/repo');
      const shell = nodePty.spawn.mock.results[0].value;

      dataCallbackAt(0)('$ ');
      manager.writeToShell('session-1', 'ls\n');
      expect(win.webContents.send).toHaveBeenCalledWith('shell:data', { sessionId: 'session-1', data: '$ ' });
      expect(shell.write).toHaveBeenCalledWith('ls\n');
    });

    it('drops claude input and resizes, having no claude', () => {
      manager.spawnShell('session-1', '/tmp/repo');
      expect(() => manager.writeToClaude('session-1', 'hi')).not.toThrow();
      expect(() => manager.resizeClaude('session-1', 80, 24)).not.toThrow();
    });

    it('kills the PTYs the session already has', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const previous = lastSpawnedPtys();
      manager.spawnShell('session-1', '/tmp/test');

      expect(previous.claude.kill).toHaveBeenCalledWith('SIGTERM');
      expect(previous.shell.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('write', () => {
    it('should write to claude PTY', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      manager.writeToClaude('session-1', 'hello\n');
      expect(pair.claude.write).toHaveBeenCalledWith('hello\n');
    });

    it('should write to shell PTY', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      manager.writeToShell('session-1', 'ls\n');
      expect(pair.shell.write).toHaveBeenCalledWith('ls\n');
    });

    it('should not throw when writing to non-existent session', () => {
      expect(() => manager.writeToClaude('nonexistent', 'test')).not.toThrow();
      expect(() => manager.writeToShell('nonexistent', 'test')).not.toThrow();
    });

    it('should write to the correct session when multiple exist', () => {
      manager.spawn('session-1', '/tmp/a', []);
      const pair1 = lastSpawnedPtys();
      manager.spawn('session-2', '/tmp/b', []);
      const pair2 = lastSpawnedPtys();
      manager.writeToClaude('session-2', 'data');
      expect(pair1.claude.write).not.toHaveBeenCalled();
      expect(pair2.claude.write).toHaveBeenCalledWith('data');
    });
  });

  describe('resize', () => {
    it('should resize claude PTY', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      manager.resizeClaude('session-1', 80, 24);
      expect(pair.claude.resize).toHaveBeenCalledWith(80, 24);
    });

    it('should resize shell PTY', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      manager.resizeShell('session-1', 80, 24);
      expect(pair.shell.resize).toHaveBeenCalledWith(80, 24);
    });

    it('should not throw when resizing non-existent session', () => {
      expect(() => manager.resizeClaude('nonexistent', 80, 24)).not.toThrow();
      expect(() => manager.resizeShell('nonexistent', 80, 24)).not.toThrow();
    });

    it('never resizes a claude that exited (its descriptor may belong to another PTY by now)', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      exitClaudeAt(0);

      manager.resizeClaude('session-1', 80, 24);
      expect(pair.claude.resize).not.toHaveBeenCalled();
    });

    it('never resizes a shell that exited', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      pair.shell.onExit.mock.calls[0][0]({ exitCode: 0, signal: 0 });

      manager.resizeShell('session-1', 80, 24);
      expect(pair.shell.resize).not.toHaveBeenCalled();
    });
  });

  describe('kill', () => {
    it('should kill both PTYs for a session', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      manager.kill('session-1');
      expect(pair.claude.kill).toHaveBeenCalled();
      expect(pair.shell.kill).toHaveBeenCalled();
    });

    it('should remove session from ptys map after kill', () => {
      manager.spawn('session-1', '/tmp/test', []);
      manager.kill('session-1');
      expect(manager.has('session-1')).toBe(false);
    });

    it('should not throw when killing non-existent session', () => {
      expect(() => manager.kill('nonexistent')).not.toThrow();
    });

    it('should handle kill when PTY.kill throws (already dead)', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      (pair.claude.kill as any).mockImplementation(() => {
        throw new Error('Process already dead');
      });
      expect(() => manager.kill('session-1')).not.toThrow();
      expect(manager.has('session-1')).toBe(false);
    });

    it('should not signal a claude that already exited', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      const claudeOnExit = nodePty.spawn.mock.results[0].value.onExit;
      claudeOnExit.mock.calls[0][0]({ exitCode: 0, signal: 0 });

      manager.kill('session-1');
      expect(pair.claude.kill).not.toHaveBeenCalled();
      expect(pair.shell.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should not affect other sessions when killing one', () => {
      manager.spawn('session-1', '/tmp/a', []);
      manager.spawn('session-2', '/tmp/b', []);
      manager.kill('session-1');
      expect(manager.has('session-1')).toBe(false);
      expect(manager.has('session-2')).toBe(true);
    });
  });

  describe('killAll', () => {
    it('should kill all sessions', () => {
      manager.spawn('session-1', '/tmp/test', []);
      manager.spawn('session-2', '/tmp/test2', []);
      manager.killAll();
      expect(manager.has('session-1')).toBe(false);
      expect(manager.has('session-2')).toBe(false);
    });

    it('should be safe to call on empty manager', () => {
      expect(() => manager.killAll()).not.toThrow();
    });
  });

  describe('data forwarding', () => {
    it('should forward claude PTY data to renderer', () => {
      const win = makeMockWindow();
      manager.setMainWindow(win);
      manager.spawn('session-1', '/tmp/test', []);

      const claudeOnData = nodePty.spawn.mock.results[0].value.onData;
      const dataCallback = claudeOnData.mock.calls[0][0];

      dataCallback('hello world');
      expect(win.webContents.send).toHaveBeenCalledWith('pty:data', {
        sessionId: 'session-1',
        data: 'hello world',
      });
    });

    it('should forward shell PTY data to renderer', () => {
      const win = makeMockWindow();
      manager.setMainWindow(win);
      manager.spawn('session-1', '/tmp/test', []);

      const shellOnData = nodePty.spawn.mock.results[1].value.onData;
      const dataCallback = shellOnData.mock.calls[0][0];

      dataCallback('shell output');
      expect(win.webContents.send).toHaveBeenCalledWith('shell:data', {
        sessionId: 'session-1',
        data: 'shell output',
      });
    });

    it('drops output from PTYs the session no longer has', () => {
      const win = makeMockWindow();
      manager.setMainWindow(win);
      manager.spawn('session-1', '/tmp/test', []);
      manager.kill('session-1');

      dataCallbackAt(0)('claude after kill');
      dataCallbackAt(1)('shell after kill');
      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('forwards only the current claude after a restart', () => {
      const win = makeMockWindow();
      manager.setMainWindow(win);
      manager.spawn('session-1', '/tmp/test', []);
      manager.restartClaude('session-1', '/tmp/test', []);

      dataCallbackAt(0)('old claude');
      dataCallbackAt(2)('new claude');
      expect(win.webContents.send).toHaveBeenCalledTimes(1);
      expect(win.webContents.send).toHaveBeenCalledWith('pty:data', { sessionId: 'session-1', data: 'new claude' });
    });

    it('should not crash when mainWindow is null', () => {
      manager.setMainWindow(null);
      manager.spawn('session-1', '/tmp/test', []);

      const claudeOnData = nodePty.spawn.mock.results[0].value.onData;
      const dataCallback = claudeOnData.mock.calls[0][0];

      expect(() => dataCallback('data')).not.toThrow();
    });

    it('should not crash when mainWindow is destroyed', () => {
      const win = makeMockWindow(true);
      manager.setMainWindow(win);
      manager.spawn('session-1', '/tmp/test', []);

      const claudeOnData = nodePty.spawn.mock.results[0].value.onData;
      const dataCallback = claudeOnData.mock.calls[0][0];

      expect(() => dataCallback('data')).not.toThrow();
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('onExit handling', () => {
    it('should report claude PTY exit with code 0 to the exit handler', () => {
      const exitHandler = vi.fn();
      manager.setExitHandler(exitHandler);
      manager.spawn('session-1', '/tmp/test', []);

      const claudeOnExit = nodePty.spawn.mock.results[0].value.onExit;
      const exitCallback = claudeOnExit.mock.calls[0][0];

      exitCallback({ exitCode: 0, signal: 0 });
      expect(exitHandler).toHaveBeenCalledWith('session-1', 0);
    });

    it('should report non-zero exit codes to the exit handler', () => {
      const exitHandler = vi.fn();
      manager.setExitHandler(exitHandler);
      manager.spawn('session-1', '/tmp/test', []);

      const claudeOnExit = nodePty.spawn.mock.results[0].value.onExit;
      const exitCallback = claudeOnExit.mock.calls[0][0];

      exitCallback({ exitCode: 1, signal: 0 });
      expect(exitHandler).toHaveBeenCalledWith('session-1', 1);
    });

    it('should not report intentionally killed sessions', () => {
      const exitHandler = vi.fn();
      manager.setExitHandler(exitHandler);
      manager.spawn('session-1', '/tmp/test', []);

      const claudeOnExit = nodePty.spawn.mock.results[0].value.onExit;
      const exitCallback = claudeOnExit.mock.calls[0][0];

      // Kill the session first, then trigger onExit
      manager.kill('session-1');

      exitCallback({ exitCode: 0, signal: 0 });
      expect(exitHandler).not.toHaveBeenCalled();
    });

    it('should not crash on exit when no exit handler is set', () => {
      manager.spawn('session-1', '/tmp/test', []);

      const claudeOnExit = nodePty.spawn.mock.results[0].value.onExit;
      const exitCallback = claudeOnExit.mock.calls[0][0];

      expect(() => exitCallback({ exitCode: 0, signal: 0 })).not.toThrow();
    });
  });

  describe('restartClaude', () => {
    it('spawns a new claude with the given cwd and flags, keeping the shell', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      manager.restartClaude('session-1', '/tmp/worktree', ['--resume', 'abc']);

      expect(nodePty.spawn).toHaveBeenCalledTimes(3);
      const restartCall = nodePty.spawn.mock.calls[2];
      expect(restartCall[0]).toBe('claude');
      expect(restartCall[1]).toEqual(['--resume', 'abc']);
      expect(restartCall[2]).toMatchObject({ cwd: '/tmp/worktree' });
      expect(pair.shell.kill).not.toHaveBeenCalled();
    });

    it('starts at the size the terminal last asked for', () => {
      manager.spawn('session-1', '/tmp/test', []);
      manager.resizeClaude('session-1', 200, 50);
      manager.restartClaude('session-1', '/tmp/test', []);

      expect(nodePty.spawn.mock.calls[2][2]).toMatchObject({ cols: 200, rows: 50 });
    });

    it('starts at the size asked for after claude exited', () => {
      manager.spawn('session-1', '/tmp/test', []);
      exitClaudeAt(0);
      manager.resizeClaude('session-1', 90, 40);
      manager.restartClaude('session-1', '/tmp/test', []);

      expect(nodePty.spawn.mock.calls[2][2]).toMatchObject({ cols: 90, rows: 40 });
    });

    it("starts claude for a session spawned with only its shell, at its terminal's size", () => {
      const exitHandler = vi.fn();
      manager.setExitHandler(exitHandler);
      manager.spawnShell('session-1', '/tmp/repo');
      manager.resizeClaude('session-1', 100, 35);
      manager.restartClaude('session-1', '/tmp/worktree', ['--resume', 'abc']);

      expect(nodePty.spawn).toHaveBeenCalledTimes(2);
      const restartCall = nodePty.spawn.mock.calls[1];
      expect(restartCall[0]).toBe('claude');
      expect(restartCall[1]).toEqual(['--resume', 'abc']);
      expect(restartCall[2]).toMatchObject({ cwd: '/tmp/worktree', cols: 100, rows: 35 });

      manager.writeToClaude('session-1', 'hi');
      expect(nodePty.spawn.mock.results[1].value.write).toHaveBeenCalledWith('hi');
      exitClaudeAt(1, 1);
      expect(exitHandler).toHaveBeenCalledWith('session-1', 1);
    });

    it('forgets the size once the session is killed', () => {
      manager.spawn('session-1', '/tmp/test', []);
      manager.resizeClaude('session-1', 200, 50);
      manager.kill('session-1');
      manager.resizeClaude('session-1', 210, 60);
      manager.spawn('session-1', '/tmp/test', []);

      expect(nodePty.spawn.mock.calls[2][2]).toMatchObject({ cols: 120, rows: 30 });
    });

    it('routes input to the new claude', () => {
      manager.spawn('session-1', '/tmp/test', []);
      manager.restartClaude('session-1', '/tmp/test', []);
      manager.writeToClaude('session-1', 'hi');

      expect(nodePty.spawn.mock.results[0].value.write).not.toHaveBeenCalled();
      expect(nodePty.spawn.mock.results[2].value.write).toHaveBeenCalledWith('hi');
    });

    it('kills a still-running claude without reporting its exit', () => {
      const exitHandler = vi.fn();
      manager.setExitHandler(exitHandler);
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      manager.restartClaude('session-1', '/tmp/test', []);

      expect(pair.claude.kill).toHaveBeenCalledWith('SIGTERM');
      exitClaudeAt(0);
      expect(exitHandler).not.toHaveBeenCalled();
    });

    it('reports exits of the new claude', () => {
      const exitHandler = vi.fn();
      manager.setExitHandler(exitHandler);
      manager.spawn('session-1', '/tmp/test', []);
      manager.restartClaude('session-1', '/tmp/test', []);

      exitClaudeAt(2, 1);
      expect(exitHandler).toHaveBeenCalledWith('session-1', 1);
    });

    it('sends no input to a claude that exited', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      exitClaudeAt(0);

      manager.writeToClaude('session-1', 'hi');
      expect(pair.claude.write).not.toHaveBeenCalled();
    });

    it('does not signal a claude that already exited (its PID may be reused)', () => {
      manager.spawn('session-1', '/tmp/test', []);
      const pair = lastSpawnedPtys();
      exitClaudeAt(0);
      manager.restartClaude('session-1', '/tmp/test', []);

      expect(pair.claude.kill).not.toHaveBeenCalled();
    });

    it('throws for an unknown session', () => {
      expect(() => manager.restartClaude('nope', '/tmp/test', [])).toThrow();
    });
  });

  describe('has', () => {
    it('should return false for non-existent session', () => {
      expect(manager.has('nonexistent')).toBe(false);
    });

    it('should return true for spawned session', () => {
      manager.spawn('session-1', '/tmp/test', []);
      expect(manager.has('session-1')).toBe(true);
    });
  });

});
