import { describe, it, expect } from 'vitest';
import {
  flagName,
  formatFlagText,
  initialPromptArgs,
  parseFlagText,
  unsupportedFlagError,
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

describe('flagName', () => {
  it('names long flags, with or without an attached value', () => {
    expect(flagName('--resume')).toBe('--resume');
    expect(flagName('--resume=abc')).toBe('--resume');
  });

  it('names short flags, with or without an attached value', () => {
    expect(flagName('-r')).toBe('-r');
    expect(flagName('-rabc')).toBe('-r');
  });

  it('treats -- as a flag of its own', () => {
    expect(flagName('--')).toBe('--');
  });

  it('returns null for plain values', () => {
    expect(flagName('high')).toBeNull();
    expect(flagName('-')).toBeNull();
  });
});

describe('unsupportedFlagError', () => {
  it('accepts ordinary flags and their values', () => {
    expect(unsupportedFlagError(['--chrome', '--effort', 'high', '--model', 'opus'])).toBeNull();
  });

  it.each([
    ['--session-id', 'abc'],
    ['--resume'],
    ['-r'],
    ['--continue'],
    ['-c'],
    ['--name=x'],
    ['-nX'],
    ['--worktree', 'w'],
    ['-p'],
    ['--background'],
    ['--'],
  ])('rejects flags Chorus manages or that end the interactive session: %j', (...args) => {
    const name = flagName(args[0]);
    expect(unsupportedFlagError(args)).toBe(`${name} isn't supported in Chorus sessions`);
  });
});

describe('initialPromptArgs', () => {
  it('passes nothing for a blank prompt', () => {
    expect(initialPromptArgs(undefined)).toEqual([]);
    expect(initialPromptArgs('  \n ')).toEqual([]);
  });

  it('passes the trimmed prompt after --', () => {
    expect(initialPromptArgs('  fix the\nlogin bug  ')).toEqual(['--', 'fix the\nlogin bug']);
  });

  it('keeps a prompt that starts with - as the prompt', () => {
    expect(initialPromptArgs('-v is broken')).toEqual(['--', '-v is broken']);
  });

  it('pads a one-word prompt so claude does not run it as a subcommand', () => {
    expect(initialPromptArgs('doctor')).toEqual(['--', 'doctor ']);
  });
});
