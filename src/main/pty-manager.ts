import * as pty from 'node-pty';
import type { BrowserWindow } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type { PtyDataPayload } from '../shared/types';
import { userShell } from './shell-env';

interface PtyPair {
  claude: pty.IPty;
  shell: pty.IPty;
}

/** Called when a claude PTY exits on its own (not via kill() or restartClaude()). */
export type ClaudeExitHandler = (sessionId: string, exitCode: number) => void;

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

export class PtyManager {
  private ptys: Map<string, PtyPair> = new Map();
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
  ): PtyPair {
    this.kill(sessionId);
    const claudePty = this.spawnClaude(sessionId, cwd, claudeArgs, DEFAULT_COLS, DEFAULT_ROWS);

    // Shell uses the original cwd, not the worktree
    const shellPty = pty.spawn(userShell(), [], {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: shellCwd ?? cwd,
      env: process.env as Record<string, string>,
    });
    shellPty.onData((data: string) => {
      if (!this.isCurrent(sessionId, 'shell', shellPty)) return;
      this.sendToRenderer(IpcChannels.SHELL_DATA, { sessionId, data });
    });
    shellPty.onExit(() => this.exited.add(shellPty));

    const pair: PtyPair = { claude: claudePty, shell: shellPty };
    this.ptys.set(sessionId, pair);
    return pair;
  }

  /**
   * Replace a session's claude process with a fresh one, keeping its shell.
   * A still-running claude is killed; the new one inherits its terminal size
   * so the TUI draws at the right dimensions immediately.
   */
  restartClaude(sessionId: string, cwd: string, claudeArgs: string[]): void {
    const pair = this.ptys.get(sessionId);
    if (!pair) throw new Error(`No PTYs for session ${sessionId}`);

    const previous = pair.claude;
    const claude = this.spawnClaude(sessionId, cwd, claudeArgs, previous.cols, previous.rows);
    this.ptys.set(sessionId, { claude, shell: pair.shell });
    this.killGracefully(previous);
  }

  writeToClaude(sessionId: string, data: string): void {
    const pair = this.ptys.get(sessionId);
    if (pair) {
      pair.claude.write(data);
    }
  }

  writeToShell(sessionId: string, data: string): void {
    const pair = this.ptys.get(sessionId);
    if (pair) {
      pair.shell.write(data);
    }
  }

  resizeClaude(sessionId: string, cols: number, rows: number): void {
    const pair = this.ptys.get(sessionId);
    if (pair) {
      pair.claude.resize(cols, rows);
    }
  }

  resizeShell(sessionId: string, cols: number, rows: number): void {
    const pair = this.ptys.get(sessionId);
    if (pair) {
      pair.shell.resize(cols, rows);
    }
  }

  /** Kill both PTYs for a session. Sends SIGTERM, then SIGKILL after 2s. */
  kill(sessionId: string): void {
    const pair = this.ptys.get(sessionId);
    if (!pair) return;

    // Dropping the pair first makes its claude PTY non-current, so its exit goes unreported
    this.ptys.delete(sessionId);
    this.killGracefully(pair.claude);
    this.killGracefully(pair.shell);
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

  private spawnClaude(
    sessionId: string,
    cwd: string,
    claudeArgs: string[],
    cols: number,
    rows: number,
  ): pty.IPty {
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
      if (!this.isCurrent(sessionId, 'claude', claudePty)) return;
      this.exitHandler?.(sessionId, exitCode);
    });

    return claudePty;
  }

  /**
   * Whether `p` is still the session's PTY of this kind. Only the current one
   * reaches the session's terminal and reports exits: one that was killed or
   * replaced (by a restart or a respawn) may live on for a moment, but it
   * no longer speaks for the session.
   */
  private isCurrent(sessionId: string, kind: keyof PtyPair, p: pty.IPty): boolean {
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
