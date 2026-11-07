import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fallbackPath, readLoginShellEnv, resolveShellEnv } from '../src/main/shell-env';

// Stand-in shells: each gets `-ilc <probe command>` exactly as a real shell would
let dir: string;

function fakeShell(name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-shell-env-'));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readLoginShellEnv', () => {
  it('returns the environment the shell builds, skipping whatever rc files print', async () => {
    const shell = fakeShell(
      'profile.sh',
      [
        'echo "Welcome back"',
        `export CHORUS_TEST_VALUE='a=b`,
        `second line'`,
        'exec /bin/sh -c "$2"',
      ].join('\n'),
    );

    const env = await readLoginShellEnv(shell);

    expect(env.CHORUS_TEST_VALUE).toBe('a=b\nsecond line');
    expect(env.PATH).toBeTruthy();
    expect(Object.keys(env).some((k) => k.includes('Welcome'))).toBe(false);
  });

  it('leaves out variables that describe the probing shell itself', async () => {
    const env = await readLoginShellEnv(fakeShell('plain.sh', 'exec /bin/sh -c "$2"'));
    for (const name of ['_', 'PWD', 'OLDPWD', 'SHLVL']) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it('gives up on a shell that takes longer than the timeout', async () => {
    const shell = fakeShell('slow.sh', 'sleep 5');
    await expect(readLoginShellEnv(shell, 200)).rejects.toThrow(`${shell} didn't finish starting within 0.2s.`);
  });

  it('reports a failing shell with the last line it printed to stderr', async () => {
    const shell = fakeShell('broken.sh', 'echo "loading nvm" >&2\necho ".zshrc:12: command not found: nvm" >&2\nexit 3');
    await expect(readLoginShellEnv(shell)).rejects.toThrow(
      `${shell} exited with code 3. .zshrc:12: command not found: nvm`,
    );
  });

  it('rejects output without the environment', async () => {
    const shell = fakeShell('silent.sh', 'echo "hello"');
    await expect(readLoginShellEnv(shell)).rejects.toThrow(`${shell} printed no environment.`);
  });

  it('rejects a shell that does not exist', async () => {
    await expect(readLoginShellEnv(path.join(dir, 'missing'))).rejects.toThrow(/^Couldn't start /);
  });
});

describe('resolveShellEnv', () => {
  it('returns the environment without asking when the first read works', async () => {
    const confirmRetry = vi.fn();
    const env = await resolveShellEnv(async () => ({ PATH: '/bin' }), confirmRetry);
    expect(env).toEqual({ PATH: '/bin' });
    expect(confirmRetry).not.toHaveBeenCalled();
  });

  it('retries for as long as the user asks to', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('slow'))
      .mockRejectedValueOnce(new Error('still slow'))
      .mockResolvedValueOnce({ PATH: '/bin' });
    const confirmRetry = vi.fn(async (_error: Error) => true);

    expect(await resolveShellEnv(read, confirmRetry)).toEqual({ PATH: '/bin' });
    expect(read).toHaveBeenCalledTimes(3);
    expect(confirmRetry.mock.calls.map(([error]) => error.message)).toEqual(['slow', 'still slow']);
  });

  it('returns null once the user chooses to continue without it', async () => {
    const read = vi.fn().mockRejectedValue(new Error('slow'));
    expect(await resolveShellEnv(read, async () => false)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('fallbackPath', () => {
  it('appends the usual install directories', () => {
    expect(fallbackPath('/usr/bin:/bin', '/Users/me')).toBe(
      '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:/Users/me/.local/bin',
    );
  });

  it('copes with no PATH at all', () => {
    expect(fallbackPath(undefined, '/Users/me')).toBe('/usr/local/bin:/opt/homebrew/bin:/Users/me/.local/bin');
  });
});
