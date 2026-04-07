import * as pty from 'node-pty';
import type { BrowserWindow } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type { PtyDataPayload } from '../shared/types';
import type { HookServer } from './hook-server';

interface PtyPair {
  claude: pty.IPty;
  shell: pty.IPty;
}

export class PtyManager {
  private ptys: Map<string, PtyPair> = new Map();
  private killedSessions: Set<string> = new Set();
  private mainWindow: BrowserWindow | null = null;
  private hookServer: HookServer | null = null;

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  setHookServer(hookServer: HookServer): void {
    this.hookServer = hookServer;
  }

  /**
   * Spawn a claude PTY and a shell PTY for a session.
   */
  spawn(
    sessionId: string,
    cwd: string,
    flags: string[],
    shellCwd?: string,
  ): PtyPair {
    // Ensure hooks are installed in the working directory before spawning
    this.hookServer?.ensureHooksInstalled(cwd);

    const shell = process.env.SHELL ?? '/bin/zsh';
    const defaultCols = 120;
    const defaultRows = 30;

    // Build claude command args — only allow flags starting with -,
    // plus value arguments that follow --session-id or --resume
    const claudeArgs: string[] = [];
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i];
      if (f.startsWith('-')) {
        claudeArgs.push(f);
        if ((f === '--session-id' || f === '--resume' || f === '--worktree') && i + 1 < flags.length) {
          claudeArgs.push(flags[++i]);
        }
      }
    }

    // Spawn claude PTY
    const claudePty = pty.spawn('claude', claudeArgs, {
      name: 'xterm-256color',
      cols: defaultCols,
      rows: defaultRows,
      cwd,
      env: process.env as Record<string, string>,
    });

    // Spawn shell PTY (uses original cwd, not worktree)
    const shellPty = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: defaultCols,
      rows: defaultRows,
      cwd: shellCwd ?? cwd,
      env: process.env as Record<string, string>,
    });

    const pair: PtyPair = { claude: claudePty, shell: shellPty };
    this.ptys.set(sessionId, pair);
    this.killedSessions.delete(sessionId);

    // Forward claude PTY output to renderer
    claudePty.onData((data: string) => {
      this.sendToRenderer(IpcChannels.PTY_DATA, { sessionId, data });
    });

    claudePty.onExit(({ exitCode }) => {
      // Don't send state update for intentionally killed sessions
      if (this.killedSessions.has(sessionId)) {
        this.killedSessions.delete(sessionId);
        return;
      }

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(IpcChannels.SESSION_STATE, {
          sessionId,
          status: exitCode === 0 ? 'ended' : 'error',
        });
      }
    });

    // Forward shell PTY output to renderer
    shellPty.onData((data: string) => {
      this.sendToRenderer(IpcChannels.SHELL_DATA, { sessionId, data });
    });

    return pair;
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

    // Mark as intentionally killed so onExit doesn't send spurious state updates
    this.killedSessions.add(sessionId);
    this.ptys.delete(sessionId);

    const killPty = (p: pty.IPty): void => {
      try {
        p.kill('SIGTERM');
      } catch {
        return; // Already dead
      }
      setTimeout(() => {
        try {
          p.kill('SIGKILL');
        } catch {
          // Already dead — fine
        }
      }, 2000);
    };

    killPty(pair.claude);
    killPty(pair.shell);
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

  private sendToRenderer(channel: string, payload: PtyDataPayload): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
  }
}
