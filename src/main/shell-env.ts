import { spawn } from 'node:child_process';
import path from 'node:path';

// A macOS app opened from the Dock or at login starts with launchd's minimal
// environment, not the one the user's shell profile builds. Everything Chorus
// spawns (claude, its hooks, gh, the shell panel) needs the latter: PATH
// entries from nvm/asdf, SSH_AUTH_SOCK, exported tokens.

/** A cold login can keep a profile with oh-my-zsh, nvm and rvm busy for several seconds. */
const SHELL_ENV_TIMEOUT_MS = 20_000;

// Printed around the environment: whatever rc files print is skipped, and the
// end marks it complete without waiting for the shell's output to close,
// which a background job started by an rc file can hold open. The end is
// printed only if env succeeded, so a failed env can't pass for an empty one.
const ENV_START = '__CHORUS_SHELL_ENV_START__';
const ENV_END = '__CHORUS_SHELL_ENV_END__';

/** Variables that describe the probing shell process, not the user's environment. */
const PROBE_VARIABLES: ReadonlySet<string> = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL']);

export type ShellEnv = Record<string, string>;

/** The user's login shell; zsh, the macOS default, when $SHELL is unset. */
export function userShell(): string {
  return process.env.SHELL || '/bin/zsh';
}

/**
 * Start `shell` as an interactive login shell, the way a terminal would, and
 * capture the environment it ends up with. Rejects when the shell or env
 * fails, takes longer than `timeoutMs`, or prints no environment.
 */
export function readLoginShellEnv(shell: string, timeoutMs = SHELL_ENV_TIMEOUT_MS): Promise<ShellEnv> {
  return new Promise((resolve, reject) => {
    // -i as well as -l: version managers usually hook in from .zshrc / .bashrc.
    // `command` keeps an alias or function named env from standing in for it.
    const probe = `printf '%s' '${ENV_START}'; command env -0 && printf '%s' '${ENV_END}'`;
    const child = spawn(shell, ['-ilc', probe], { stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      // An interactive shell ignores SIGTERM
      child.kill('SIGKILL');
      reject(new Error(`${shell} didn't finish starting within ${timeoutMs / 1000}s.`));
    }, timeoutMs);

    let stdout = '';
    const readStdout = (chunk: string): void => {
      stdout += chunk;
      const env = parseEnvOutput(stdout);
      if (!env) return;
      clearTimeout(timer);
      child.stdout.off('data', readStdout);
      resolve(env);
    };
    child.stdout.setEncoding('utf8').on('data', readStdout);

    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't start ${shell}: ${err.message}`));
    });

    // Once the whole environment has arrived, the promise is settled and this changes nothing
    child.on('close', (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          code === 0 ? `${shell} printed no environment.` : `${shell} exited with code ${code}.${lastLine(stderr)}`,
        ),
      );
    });
  });
}

/** The environment printed between the markers; null until all of it has arrived. */
function parseEnvOutput(stdout: string): ShellEnv | null {
  const start = stdout.indexOf(ENV_START);
  if (start === -1) return null;
  const end = stdout.indexOf(ENV_END, start);
  if (end === -1) return null;

  const env: ShellEnv = {};
  for (const entry of stdout.slice(start + ENV_START.length, end).split('\0')) {
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
