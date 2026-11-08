import { describe, it, expect } from 'vitest';
import { customFlagText, readCustomFlags, readToggles, toggleFlags } from '../src/renderer/session-flags';

describe('toggleFlags / readToggles', () => {
  it('round-trips every checkbox combination', () => {
    for (const autoMode of [true, false]) {
      for (const skipPermissions of [true, false]) {
        for (const chrome of [true, false]) {
          const toggles = { autoMode, skipPermissions, chrome };
          expect(readToggles(toggleFlags(toggles))).toEqual(toggles);
        }
      }
    }
  });

  it('always states the Chrome choice explicitly', () => {
    expect(toggleFlags({ autoMode: false, skipPermissions: false, chrome: false })).toEqual(['--no-chrome']);
  });
});

describe('customFlagText', () => {
  it('leaves out the flags the checkboxes own', () => {
    const flags = ['--enable-auto-mode', '--no-chrome', '--effort', 'high', '--allowed-tools', 'Bash(git *)'];
    expect(customFlagText(flags)).toBe(`--effort high --allowed-tools 'Bash(git *)'`);
  });

  it('is empty for sessions created before custom flags existed', () => {
    expect(customFlagText(['--dangerously-skip-permissions', '--chrome'])).toBe('');
  });

  it('keeps a custom flag’s value that reads like a checkbox flag', () => {
    const flags = ['--no-chrome', '--append-system-prompt', '--chrome'];
    expect(customFlagText(flags)).toBe('--append-system-prompt --chrome');
    expect(readToggles(flags).chrome).toBe(false);
  });

  it('reads back as the same custom flags', () => {
    const custom = ['--append-system-prompt', `be "brief"`, '--model', 'opus'];
    const text = customFlagText(['--chrome', ...custom]);
    expect(readCustomFlags(text)).toEqual({ kind: 'ok', args: custom });
  });
});

describe('readCustomFlags', () => {
  it('accepts an empty field', () => {
    expect(readCustomFlags('  ')).toEqual({ kind: 'ok', args: [] });
  });

  it('accepts flags with quoted values', () => {
    expect(readCustomFlags('--effort high --allowed-tools "Bash(git *) Edit"')).toEqual({
      kind: 'ok',
      args: ['--effort', 'high', '--allowed-tools', 'Bash(git *) Edit'],
    });
  });

  it('reports a quoting mistake', () => {
    expect(readCustomFlags('--model "opus')).toEqual({ kind: 'invalid', error: 'Missing closing "' });
  });

  it('rejects a leading bare word, which claude would take as a prompt or subcommand', () => {
    expect(readCustomFlags('doctor --verbose')).toEqual({
      kind: 'invalid',
      error: "doctor isn't a flag — flags start with -",
    });
  });

  it('applies claude’s rules for session flags', () => {
    expect(readCustomFlags('--verbose true')).toEqual({
      kind: 'invalid',
      error: "true isn't a flag — --verbose takes no value",
    });
    expect(readCustomFlags('--verbose=true')).toEqual({ kind: 'invalid', error: '--verbose takes no value' });
    expect(readCustomFlags('--model')).toEqual({ kind: 'invalid', error: '--model needs a value' });
  });

  it('rejects flags Chorus manages', () => {
    expect(readCustomFlags('--verbose --resume abc')).toEqual({
      kind: 'invalid',
      error: "--resume isn't supported in Chorus sessions",
    });
  });

  it('points flags a checkbox owns to that checkbox', () => {
    expect(readCustomFlags('--no-chrome')).toEqual({
      kind: 'invalid',
      error: 'Use the “Enable Claude in Chrome” checkbox above',
    });
    expect(readCustomFlags('--verbose --dangerously-skip-permissions')).toEqual({
      kind: 'invalid',
      error: 'Use the “Skip permissions” checkbox above',
    });
  });

  it('accepts a checkbox flag’s name as another flag’s value', () => {
    expect(readCustomFlags('--append-system-prompt --chrome')).toEqual({
      kind: 'ok',
      args: ['--append-system-prompt', '--chrome'],
    });
  });
});
