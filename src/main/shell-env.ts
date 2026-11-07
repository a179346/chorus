import { spawn } from 'node:child_process';
import path from 'node:path';

// A macOS app opened from the Dock or at login starts with launchd's minimal
// environment, not the one the user's shell profile builds. Everything Chorus
// spawns (claude, its hooks, gh, the shell panel) needs the latter: PATH
// entries from nvm/asdf, SSH_AUTH_SOCK, exported tokens.

/** A cold login can keep a profile with oh-my-zsh, nvm and rvm busy for several seconds. */
export const SHELL_ENV_TIMEOUT_MS = 20_000;

// Printed right before the environment, so whatever rc files print is skipped
const SENTINEL = '__CHORUS_SHELL_ENV__';

/** Variables that describe the probing shell process, not the user's environment. */
const PROBE_VARIABLES: ReadonlySet<string> = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL']);

export type ShellEnv = Record<string, string>;

/**
 * Start `shell` as an interactive login shell, the way a terminal would, and
 * capture the environment it ends up with. Rejects when the shell fails, takes
 * longer than `timeoutMs`, or prints no environment.
 */
export function readLoginShellEnv(shell: string, timeoutMs = SHELL_ENV_TIMEOUT_MS): Promise<ShellEnv> {
  return new Promise((resolve, reject) => {
    // -i as well as -l: version managers usually hook in from .zshrc / .bashrc
    const child = spawn(shell, ['-ilc', `printf '%s' '${SENTINEL}'; env -0`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

    const timer = setTimeout(() => {
      // An interactive shell ignores SIGTERM
      child.kill('SIGKILL');
      reject(new Error(`${shell} didn't finish starting within ${timeoutMs / 1000}s.`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't start ${shell}: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${shell} exited with code ${code}.${lastLine(stderr)}`));
        return;
      }
      const env = parseEnvOutput(stdout);
      if (env) resolve(env);
      else reject(new Error(`${shell} printed no environment.`));
    });
  });
}

function parseEnvOutput(stdout: string): ShellEnv | null {
  const start = stdout.indexOf(SENTINEL);
  if (start === -1) return null;

  const env: ShellEnv = {};
  for (const entry of stdout.slice(start + SENTINEL.length).split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (!PROBE_VARIABLES.has(name)) env[name] = entry.slice(eq + 1);
  }
  return env;
}

function lastLine(text: string): string {
  const line = text.trim().split('\n').pop();
  return line ? ` ${line}` : '';
}

/**
 * Read the environment until it works or the user gives up: each failure is
 * passed to `confirmRetry`, and null comes back once it answers false.
 */
export async function resolveShellEnv(
  read: () => Promise<ShellEnv>,
  confirmRetry: (error: Error) => Promise<boolean>,
): Promise<ShellEnv | null> {
  for (;;) {
    try {
      return await read();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (!(await confirmRetry(error))) return null;
    }
  }
}

/** `currentPath` plus the directories claude and gh are usually installed in. */
export function fallbackPath(currentPath: string | undefined, home: string): string {
  return [currentPath, '/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.local', 'bin')]
    .filter(Boolean)
    .join(':');
}
