import { describe, it, expect } from 'vitest';
import {
  checkSessionFlags,
  formatFlagText,
  newSessionArgs,
  parseFlagText,
  relaunchArgs,
} from '../src/shared/claude-cli';

describe('parseFlagText', () => {
  const args = (text: string) => {
    const result = parseFlagText(text);
    if (!result.ok) throw new Error(result.error);
    return result.args;
  };

  it('splits on any run of whitespace', () => {
    expect(args('  --verbose\t--effort   high\n')).toEqual(['--verbose', '--effort', 'high']);
  });

  it('returns no args for blank text', () => {
    expect(args('   ')).toEqual([]);
  });

  it('keeps a double-quoted value as one argument', () => {
    expect(args('--allowed-tools "Bash(git *) Edit"')).toEqual(['--allowed-tools', 'Bash(git *) Edit']);
  });

  it('keeps single-quoted text literal', () => {
    expect(args(`--append-system-prompt 'say "hi" \\n'`)).toEqual(['--append-system-prompt', 'say "hi" \\n']);
  });

  it('honours \\" and \\\\ inside double quotes', () => {
    expect(args('"a \\"b\\" c\\\\"')).toEqual(['a "b" c\\']);
  });

  it('lets a backslash escape the next character outside quotes', () => {
    expect(args('a\\ b')).toEqual(['a b']);
  });

  it('joins quoted and unquoted parts of one argument', () => {
    expect(args(`--model=claude-'opus'"-x"`)).toEqual(['--model=claude-opus-x']);
  });

  it('keeps an empty quoted argument', () => {
    expect(args(`--fallback-model ''`)).toEqual(['--fallback-model', '']);
  });

  it('rejects an unterminated quote', () => {
    expect(parseFlagText('--x "abc')).toEqual({ ok: false, error: 'Missing closing "' });
    expect(parseFlagText("--x 'abc")).toEqual({ ok: false, error: "Missing closing '" });
  });
});

describe('formatFlagText', () => {
  it('leaves plain arguments bare', () => {
    expect(formatFlagText(['--effort', 'high', '--model=opus'])).toBe('--effort high --model=opus');
  });

  it.each([
    [['--allowed-tools', 'Bash(git *) Edit']],
    [['--append-system-prompt', `it's "quoted" \\ here`]],
    [['--fallback-model', '']],
    [['--x', 'line\nbreak', '$HOME']],
  ])('round-trips through parseFlagText: %j', (args) => {
    expect(parseFlagText(formatFlagText(args))).toEqual({ ok: true, args });
  });
});

describe('checkSessionFlags', () => {
  const errorOf = (args: string[]) => {
    const check = checkSessionFlags(args);
    return check.ok ? null : check.error;
  };

  it('accepts no flags', () => {
    expect(checkSessionFlags([])).toEqual({ ok: true, flagNames: [] });
  });

  it('accepts flags with and without values, naming only the flags', () => {
    expect(checkSessionFlags(['--chrome', '--effort', 'high', '--model=opus', '-dhooks', '--verbose'])).toEqual({
      ok: true,
      flagNames: ['--chrome', '--effort', '--model', '-d', '--verbose'],
    });
  });

  it('takes the argument after a value flag as its value, even when it looks like a flag', () => {
    expect(checkSessionFlags(['--append-system-prompt', '-p means print', '--model', '--resume'])).toEqual({
      ok: true,
      flagNames: ['--append-system-prompt', '--model'],
    });
  });

  it('gives an optional value only a following argument that is not a flag', () => {
    expect(checkSessionFlags(['--debug', 'hooks,mcp', '--remote-control', '--verbose', '--debug'])).toEqual({
      ok: true,
      flagNames: ['--debug', '--remote-control', '--verbose', '--debug'],
    });
  });

  it('gives a variadic flag every argument up to the next flag', () => {
    expect(checkSessionFlags(['--add-dir', '../a', '../b', '--allowed-tools', 'Bash(git *)', 'Edit', '--verbose'])).toEqual({
      ok: true,
      flagNames: ['--add-dir', '--allowed-tools', '--verbose'],
    });
  });

  it('knows the value flags --help leaves out', () => {
    expect(
      checkSessionFlags([
        '--append-system-prompt-file', 'prompt.md',
        '--channels', 'plugin:a', 'server:b',
        '--rc', '--thinking', 'disabled',
        '--max-turns', '3',
      ]),
    ).toEqual({
      ok: true,
      flagNames: ['--append-system-prompt-file', '--channels', '--rc', '--thinking', '--max-turns'],
    });
  });

  it('knows the boolean flags --help leaves out', () => {
    const hidden = ['--allow-other-models', '-d2e', '--debug-to-stderr', '--include-unsupported-models', '--init', '--maintenance'];
    expect(checkSessionFlags(hidden)).toEqual({ ok: true, flagNames: hidden });
    expect(errorOf(['--maintenance', 'now'])).toBe("now isn't a flag — --maintenance takes no value");
    expect(errorOf(['--init=1'])).toBe('--init takes no value');
  });

  it('reads -d2e as a flag of its own, as claude does, not -d with a value', () => {
    expect(errorOf(['-d2e', 'hooks'])).toBe("hooks isn't a flag — -d2e takes no value");
    expect(checkSessionFlags(['-dhooks'])).toEqual({ ok: true, flagNames: ['-d'] });
  });

  it('keeps an empty value with its flag', () => {
    expect(errorOf(['--fallback-model', ''])).toBeNull();
  });

  it('rejects a leading word, which claude would take as a prompt or subcommand', () => {
    expect(errorOf(['doctor', '--verbose'])).toBe("doctor isn't a flag — flags start with -");
    expect(errorOf(['-'])).toBe("- isn't a flag — flags start with -");
  });

  it('names an empty argument that is not a value', () => {
    expect(errorOf(['', '--model', 'x'])).toBe("The empty argument '' isn't a flag — flags start with -");
  });

  it('says so when a word follows a flag that takes no value', () => {
    expect(errorOf(['--verbose', 'true'])).toBe("true isn't a flag — --verbose takes no value");
    expect(errorOf(['--chrome', 'yes'])).toBe("yes isn't a flag — --chrome takes no value");
  });

  it('rejects a value attached to a flag that takes none, which claude would refuse', () => {
    expect(errorOf(['--verbose=true'])).toBe('--verbose takes no value');
    expect(errorOf(['--enable-auto-mode=1'])).toBe('--enable-auto-mode takes no value');
    expect(errorOf(['--no-chrome='])).toBe('--no-chrome takes no value');
  });

  it('suggests --flag=value for a word after a flag it doesn’t know', () => {
    expect(errorOf(['--new-flag', 'a b'])).toBe(
      "'a b' isn't a flag — if it's the value of --new-flag, write '--new-flag=a b'",
    );
    expect(errorOf(['--new-flag=a b'])).toBeNull();
  });

  it('rejects a second word after a single value', () => {
    expect(errorOf(['--model', 'opus', 'sonnet'])).toBe("sonnet isn't a flag — flags start with -");
    expect(errorOf(['--add-dir=../a', '../b'])).toBe("../b isn't a flag — flags start with -");
  });

  it('rejects a value flag that ends the flags without its value', () => {
    expect(errorOf(['--verbose', '--model'])).toBe('--model needs a value');
    expect(errorOf(['--add-dir'])).toBe('--add-dir needs a value');
  });

  it.each([
    [['--session-id', 'abc'], '--session-id'],
    [['--resume-session-at', 'msg_1'], '--resume-session-at'],
    [['--session-began-as-copy', '1'], '--session-began-as-copy'],
    [['--parent-session-id', 'abc'], '--parent-session-id'],
    [['--resume'], '--resume'],
    [['--resume=abc'], '--resume'],
    [['-r'], '-r'],
    [['-rabc'], '-r'],
    [['--continue'], '--continue'],
    [['-c'], '-c'],
    [['--name=x'], '--name'],
    [['-nX'], '-n'],
    [['--worktree', 'w'], '--worktree'],
    [['-p'], '-p'],
    [['--sdk-url', 'ws://localhost'], '--sdk-url'],
    [['--background'], '--background'],
    [['--environment', 'env_1'], '--environment'],
    [['--pool', 'pool_1'], '--pool'],
    [['--remote'], '--remote'],
    [['--rewind-files', 'msg_1'], '--rewind-files'],
    [['--init-only'], '--init-only'],
    [['--attach-serve', 'abc'], '--attach-serve'],
    [['--tmux'], '--tmux'],
    [['--bare'], '--bare'],
    [['--safe-mode'], '--safe-mode'],
    [['--restricted'], '--restricted'],
    [['--project-config-root', '..'], '--project-config-root'],
    [['--session-mirror'], '--session-mirror'],
    [['--await-claim'], '--await-claim'],
    [['--await-initialize'], '--await-initialize'],
    [['--host-auth-is-org-sign-in'], '--host-auth-is-org-sign-in'],
    [['--enable-auth-status'], '--enable-auth-status'],
    [['--deep-link-origin'], '--deep-link-origin'],
    [['--reply-on-resume'], '--reply-on-resume'],
    [['--agents-view-if-allowed'], '--agents-view-if-allowed'],
    [['--plan-mode-required'], '--plan-mode-required'],
    [['--deep-link-repo', 'o/r'], '--deep-link-repo'],
    [['--agent-id', 'a1'], '--agent-id'],
    [['--team-name=t'], '--team-name'],
    [['--'], '--'],
  ])('rejects flags Chorus manages, that end the interactive session, that a launching host sets, or that turn off its hooks: %j', (args, name) => {
    expect(errorOf(args)).toBe(`${name} isn't supported in Chorus sessions`);
  });

  it('rejects an unsupported flag after valid ones', () => {
    expect(errorOf(['--verbose', '--resume', 'abc'])).toBe("--resume isn't supported in Chorus sessions");
  });

  it('accepts --setting-sources only when it loads the local settings, where the hooks are', () => {
    expect(errorOf(['--setting-sources', 'user, local'])).toBeNull();
    expect(errorOf(['--setting-sources=local'])).toBeNull();
    const error = "--setting-sources must include local, where Chorus's hooks are";
    expect(errorOf(['--setting-sources', 'user,project'])).toBe(error);
    expect(errorOf(['--setting-sources='])).toBe(error);
  });

  it.each(['local,', 'local,,user', 'Local', 'local,managed'])(
    'rejects --setting-sources %j, which claude refuses to start with',
    (sources) => {
      expect(errorOf(['--setting-sources', sources])).toBe(
        '--setting-sources takes a comma-separated list of user, project and local',
      );
    },
  );
});

describe('newSessionArgs', () => {
  const launch = { id: 'uuid-1', name: 'Fix login', newWorktree: null, flags: [] };

  it('passes Chorus’s id and name', () => {
    expect(newSessionArgs(launch)).toEqual(['--session-id', 'uuid-1', '--name', 'Fix login']);
  });

  it('asks claude to create a new worktree', () => {
    expect(newSessionArgs({ ...launch, newWorktree: 'fix-login' })).toEqual([
      '--session-id', 'uuid-1', '--name', 'Fix login', '--worktree', 'fix-login',
    ]);
  });

  it('puts the user’s flags after Chorus’s own, so none can take one as its value', () => {
    expect(newSessionArgs({ ...launch, flags: ['--chrome', '--effort', 'high'] })).toEqual([
      '--session-id', 'uuid-1', '--name', 'Fix login', '--chrome', '--effort', 'high',
    ]);
  });

  it('passes nothing more for a blank prompt', () => {
    expect(newSessionArgs({ ...launch, prompt: '  \n ' })).toEqual(newSessionArgs(launch));
  });

  it('passes the trimmed prompt last, after --', () => {
    expect(newSessionArgs({ ...launch, flags: ['--add-dir', '../a'], prompt: '  fix the\nlogin bug  ' })).toEqual([
      '--session-id', 'uuid-1', '--name', 'Fix login', '--add-dir', '../a', '--', 'fix the\nlogin bug',
    ]);
  });

  it('keeps a prompt that starts with - as the prompt', () => {
    expect(newSessionArgs({ ...launch, prompt: '-v is broken' }).slice(-2)).toEqual(['--', '-v is broken']);
  });

  it('pads a one-word prompt so claude does not run it as a subcommand', () => {
    expect(newSessionArgs({ ...launch, prompt: 'doctor' }).slice(-2)).toEqual(['--', 'doctor ']);
  });
});

describe('relaunchArgs', () => {
  const session = { id: 'uuid-1', name: 'Fix login', worktree: 'fix-login', flags: ['--chrome', '--model', 'opus'] };
  const inPlace = { recreateWorktree: false };

  it('resumes a session the user has prompted, before the user’s flags', () => {
    expect(relaunchArgs({ ...session, hasUserInput: true }, inPlace)).toEqual([
      '--resume', 'uuid-1', '--chrome', '--model', 'opus',
    ]);
  });

  it('reuses the id of a session that has no conversation yet', () => {
    expect(relaunchArgs({ ...session, hasUserInput: false }, inPlace)).toEqual([
      '--session-id', 'uuid-1', '--name', 'Fix login', '--chrome', '--model', 'opus',
    ]);
  });

  it('asks claude to create the session’s worktree again when it is gone', () => {
    const recreate = { recreateWorktree: true };
    expect(relaunchArgs({ ...session, hasUserInput: true }, recreate)).toEqual([
      '--resume', 'uuid-1', '--worktree', 'fix-login', '--chrome', '--model', 'opus',
    ]);
    expect(relaunchArgs({ ...session, hasUserInput: false }, recreate)).toEqual([
      '--session-id', 'uuid-1', '--name', 'Fix login', '--worktree', 'fix-login', '--chrome', '--model', 'opus',
    ]);
  });

  it('has no worktree to recreate for a session without one', () => {
    expect(relaunchArgs({ ...session, worktree: null, hasUserInput: true }, { recreateWorktree: true })).toEqual([
      '--resume', 'uuid-1', '--chrome', '--model', 'opus',
    ]);
  });
});
