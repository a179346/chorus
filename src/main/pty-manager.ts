import * as pty from 'node-pty';
import type { BrowserWindow } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type { PtyDataPayload } from '../shared/types';
import { userShell } from './shell-env';

interface SessionPtys {
  /** Null while claude isn't running: it exited, or the session was restored with only its shell. */
  claude: pty.IPty | null;
  shell: pty.IPty;
}

interface TerminalSize {
  cols: number;
  rows: number;
}

/** Called when a claude PTY exits on its own (not via kill() or restartClaude()). */
export type ClaudeExitHandler = (sessionId: string, exitCode: number) => void;

const DEFAULT_SIZE: TerminalSize = { cols: 120, rows: 30 };

export class PtyManager {
  private ptys: Map<string, SessionPtys> = new Map();
  /** The size each session's Claude terminal last asked for: a claude started later starts at it. */
  private claudeSizes = new Map<string, TerminalSize>();
  /** PTYs whose process is gone: signalling them could hit an unrelated process that reused the PID. */
  private exited = new WeakSet<pty.IPty>();
  private mainWindow: BrowserWindow | null = null;
  private exitHandler: ClaudeExitHandler | null = null;

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  setExitHandler(handler: ClaudeExitHandler | null): void {
    this.exitHandler = handler;
  }

  /**
   * Spawn a claude PTY and a shell PTY for a session, killing any the session
   * already has: two pairs would mix their output in its terminals.
   * `claudeArgs` reach claude unchanged.
   */
  spawn(
    sessionId: string,
    cwd: string,
    claudeArgs: string[],
    shellCwd?: string,
  ): void {
    this.kill(sessionId);
    const claude = this.spawnClaude(sessionId, cwd, claudeArgs);
    // Shell uses the original cwd, not the worktree
    const shell = this.spawnShellPty(sessionId, shellCwd ?? cwd);
    this.ptys.set(sessionId, { claude, shell });
  }

  /**
   * Spawn only a session's shell, for a session whose claude isn't running
   * (restored after it had exited): restartClaude starts claude. Kills any
   * PTYs the session already has, as spawn does.
   */
  spawnShell(sessionId: string, shellCwd: string): void {
    this.kill(sessionId);
    this.ptys.set(sessionId, { claude: null, shell: this.spawnShellPty(sessionId, shellCwd) });
  }

  /**
   * Start a session's claude, replacing the one it runs, if any, and keeping
   * its shell. claude starts at the size the session's terminal last asked
   * for, so its TUI draws at the right dimensions immediately.
   */
  restartClaude(sessionId: string, cwd: string, claudeArgs: string[]): void {
    const ptys = this.ptys.get(sessionId);
    if (!ptys) throw new Error(`No PTYs for session ${sessionId}`);

    const claude = this.spawnClaude(sessionId, cwd, claudeArgs);
    this.ptys.set(sessionId, { claude, shell: ptys.shell });
    if (ptys.claude) this.killGracefully(ptys.claude);
  }

  writeToClaude(sessionId: string, data: string): void {
    const claude = this.ptys.get(sessionId)?.claude;
    if (claude) {
      claude.write(data);
    }
  }

  writeToShell(sessionId: string, data: string): void {
    const ptys = this.ptys.get(sessionId);
    if (ptys) {
      ptys.shell.write(data);
    }
  }

  /** Resizes a running claude; either way the size is kept for the next one restartClaude starts. */
  resizeClaude(sessionId: string, cols: number, rows: number): void {
    const ptys = this.ptys.get(sessionId);
    if (!ptys) return;

    this.claudeSizes.set(sessionId, { cols, rows });
    if (ptys.claude) {
      ptys.claude.resize(cols, rows);
    }
  }

  resizeShell(sessionId: string, cols: number, rows: number): void {
    const shell = this.ptys.get(sessionId)?.shell;
    // An exited PTY's descriptor is closed, and may already belong to another session's PTY
    if (shell && !this.exited.has(shell)) {
      shell.resize(cols, rows);
    }
  }

  /** Kill both PTYs for a session. Sends SIGTERM, then SIGKILL after 2s. */
  kill(sessionId: string): void {
    this.claudeSizes.delete(sessionId);
    const ptys = this.ptys.get(sessionId);
    if (!ptys) return;

    // Dropping the PTYs first makes them non-current, so claude's exit goes unreported
    this.ptys.delete(sessionId);
    if (ptys.claude) this.killGracefully(ptys.claude);
    this.killGracefully(ptys.shell);
  }

  /** Kill all PTYs (used on app quit). */
  killAll(): void {
    for (const sessionId of Array.from(this.ptys.keys())) {
      this.kill(sessionId);
    }
  }

  has(sessionId: string): boolean {
    return this.ptys.has(sessionId);
  }

  private spawnClaude(sessionId: string, cwd: string, claudeArgs: string[]): pty.IPty {
    const { cols, rows } = this.claudeSizes.get(sessionId) ?? DEFAULT_SIZE;
    const claudePty = pty.spawn('claude', claudeArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    claudePty.onData((data: string) => {
      if (!this.isCurrent(sessionId, 'claude', claudePty)) return;
      this.sendToRenderer(IpcChannels.PTY_DATA, { sessionId, data });
    });

    claudePty.onExit(({ exitCode }) => {
      this.exited.add(claudePty);
      const ptys = this.ptys.get(sessionId);
      if (ptys?.claude !== claudePty) return;
      this.ptys.set(sessionId, { claude: null, shell: ptys.shell });
      this.exitHandler?.(sessionId, exitCode);
    });

    return claudePty;
  }

  private spawnShellPty(sessionId: string, cwd: string): pty.IPty {
    const shellPty = pty.spawn(userShell(), [], {
      name: 'xterm-256color',
      cols: DEFAULT_SIZE.cols,
      rows: DEFAULT_SIZE.rows,
      cwd,
      env: process.env as Record<string, string>,
    });
    shellPty.onData((data: string) => {
      if (!this.isCurrent(sessionId, 'shell', shellPty)) return;
      this.sendToRenderer(IpcChannels.SHELL_DATA, { sessionId, data });
    });
    shellPty.onExit(() => this.exited.add(shellPty));
    return shellPty;
  }

  /**
   * Whether `p` is still the session's PTY of this kind. Only the current one
   * reaches the session's terminal and reports exits: one that was killed or
   * replaced (by a restart or a respawn) may live on for a moment, but it
   * no longer speaks for the session.
   */
  private isCurrent(sessionId: string, kind: keyof SessionPtys, p: pty.IPty): boolean {
    return this.ptys.get(sessionId)?.[kind] === p;
  }

  /** SIGTERM, then SIGKILL after 2s if it is still running. */
  private killGracefully(p: pty.IPty): void {
    if (this.exited.has(p)) return;
    try {
      p.kill('SIGTERM');
    } catch {
      return; // Already dead
    }
    setTimeout(() => {
      if (this.exited.has(p)) return;
      try {
        p.kill('SIGKILL');
      } catch {
        // Already dead — fine
      }
    }, 2000);
  }

  private sendToRenderer(channel: string, payload: PtyDataPayload): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
  }
}
