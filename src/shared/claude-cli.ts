// What Chorus knows about the claude CLI's argument syntax: which flags take
// a value, the flags a session can't take, the shell-like text extra flags are
// typed in, and the arguments a session's claude is launched with.

import type { Session } from './types';

/**
 * Flags that set a session's identity, resume or worktree (Chorus passes
 * these itself), that keep claude from running as an interactive session in
 * this terminal, or that turn off the hooks Chorus relies on to follow the
 * session. `--` is here because Chorus uses it to pass the prompt.
 */
const UNSUPPORTED_FLAGS: ReadonlySet<string> = new Set([
  '--',
  // Chorus passes these itself
  '--session-id',
  '-r', '--resume',
  '-c', '--continue',
  '--fork-session',
  '--from-pr',
  '--teleport',
  '-n', '--name',
  '-w', '--worktree',
  // Not an interactive session in this terminal
  '-p', '--print',
  '--bg', '--background',
  '--cloud', '--remote',
  '--environment', '--pool',
  '--desktop',
  '--tmux',
  '--attach-serve',
  '--init-only',
  '--rewind-files',
  '-h', '--help',
  '-v', '--version',
  // Turn off the hooks (as does a --setting-sources without local)
  '--bare',
  '--safe-mode',
  '--restricted',
]);

/** Chorus's hooks live in .claude/settings.local.json, which this source covers. */
const HOOKS_SETTING_SOURCE = 'local';

/** Whether a --setting-sources value (comma-separated, like `user,project`) loads Chorus's hooks. */
function loadsHookSettings(sources: string): boolean {
  return sources.split(',').some((source) => source.trim() === HOOKS_SETTING_SOURCE);
}

/**
 * How claude's option parser reads a flag's value. `required`: always the
 * next argument, whatever it looks like. `optional`: the next argument unless
 * it is a flag. `variadic`: like `required`, plus every argument after it up
 * to the next flag.
 */
type ValueKind = 'required' | 'optional' | 'variadic';

/**
 * The flags in `claude --help` (2.1.319) that take a value. This must follow
 * claude's flags: a value flag missing here can only be passed as
 * --flag=value. Unsupported flags are left out, since they are rejected
 * before their value matters.
 */
const VALUE_FLAGS: ReadonlyMap<string, ValueKind> = new Map<string, ValueKind>([
  ['--add-dir', 'variadic'],
  ['--agent', 'required'],
  ['--agents', 'required'],
  ['--allowedTools', 'variadic'],
  ['--allowed-tools', 'variadic'],
  ['--append-system-prompt', 'required'],
  ['--autocompact', 'required'],
  ['--betas', 'variadic'],
  ['-d', 'optional'],
  ['--debug', 'optional'],
  ['--debug-file', 'required'],
  ['--disallowedTools', 'variadic'],
  ['--disallowed-tools', 'variadic'],
  ['--effort', 'required'],
  ['--fallback-model', 'required'],
  ['--file', 'variadic'],
  ['--input-format', 'required'],
  ['--json-schema', 'required'],
  ['--max-budget-usd', 'required'],
  ['--mcp-config', 'variadic'],
  ['--model', 'required'],
  ['--output-format', 'required'],
  ['--permission-mode', 'required'],
  ['--permission-prompts', 'required'],
  ['--plugin-dir', 'required'],
  ['--plugin-url', 'required'],
  ['--prompt-suggestions', 'optional'],
  ['--remote-control', 'optional'],
  ['--remote-control-session-name-prefix', 'required'],
  ['--setting-sources', 'required'],
  ['--settings', 'required'],
  ['--system-prompt', 'required'],
  ['--system-prompt-snapshot', 'required'],
  ['--tools', 'variadic'],
]);

/**
 * The flag an argument names, or null for a plain value. Covers the forms
 * the CLI accepts: `--name=value`, and a short flag with its value attached
 * (`-nvalue`).
 */
function flagName(arg: string): string | null {
  if (arg === '--') return arg;
  if (arg.startsWith('--')) return arg.split('=')[0];
  if (arg.startsWith('-') && arg.length > 1) return arg.slice(0, 2);
  return null;
}

function isValue(arg: string): boolean {
  return flagName(arg) === null;
}

/** The value written into the flag's own argument: `--model=opus`, `-dhooks`. */
function attachedValue(arg: string, name: string): string {
  return arg.slice(name.startsWith('--') ? name.length + 1 : name.length);
}

/** The arguments claude reads as a flag's value; null when a value it requires is missing. */
function valuesAfter(kind: ValueKind | undefined, following: readonly string[]): string[] | null {
  if (kind === undefined) return [];
  if (kind === 'optional') return following.length > 0 && isValue(following[0]) ? following.slice(0, 1) : [];
  if (following.length === 0) return null;
  if (kind === 'required') return following.slice(0, 1);

  let end = 1;
  while (end < following.length && isValue(following[end])) end++;
  return following.slice(0, end);
}

export type SessionFlagsCheck = { ok: true; flagNames: string[] } | { ok: false; error: string };

/**
 * Whether claude can launch a Chorus session with these flags, read the way
 * claude's option parser reads them: a value goes with its flag and is never
 * taken for a flag, and any other argument that isn't a flag would reach
 * claude as a prompt or subcommand, so it is an error. On success, the names
 * of the flags, in order.
 */
export function checkSessionFlags(args: readonly string[]): SessionFlagsCheck {
  const flagNames: string[] = [];
  // The previous argument, when it was a flag that took no value
  let valuelessFlag: string | null = null;

  for (let i = 0; i < args.length; ) {
    const arg = args[i];
    const name = flagName(arg);
    if (name === null) return { ok: false, error: strayArgumentError(arg, valuelessFlag) };
    if (UNSUPPORTED_FLAGS.has(name)) return { ok: false, error: `${name} isn't supported in Chorus sessions` };

    const attached = arg !== name;
    const values = attached ? [attachedValue(arg, name)] : valuesAfter(VALUE_FLAGS.get(name), args.slice(i + 1));
    if (values === null) return { ok: false, error: `${name} needs a value` };
    if (name === '--setting-sources' && !loadsHookSettings(values[0])) {
      return { ok: false, error: `--setting-sources must include ${HOOKS_SETTING_SOURCE}, where Chorus's hooks are` };
    }

    flagNames.push(name);
    valuelessFlag = values.length === 0 ? name : null;
    i += attached ? 1 : 1 + values.length;
  }
  return { ok: true, flagNames };
}

function strayArgumentError(arg: string, valuelessFlag: string | null): string {
  const shown = arg === '' ? "The empty argument ''" : formatFlagText([arg]);
  if (valuelessFlag?.startsWith('--')) {
    const attached = formatFlagText([`${valuelessFlag}=${arg}`]);
    return `${shown} isn't a flag — if it's the value of ${valuelessFlag}, write ${attached}`;
  }
  return `${shown} isn't a flag — flags start with -`;
}

export type FlagTextParse = { ok: true; args: string[] } | { ok: false; error: string };

/**
 * Split typed flags into arguments with shell-style quoting: whitespace
 * separates them, single quotes keep text literal, double quotes allow \" and
 * \\, and a backslash outside quotes escapes the next character. Nothing else
 * is shell syntax here: ~, $VAR and # reach claude as typed.
 */
export function parseFlagText(text: string): FlagTextParse {
  const args: string[] = [];
  let current = '';
  // Separate from `current` so that '' still yields an (empty) argument
  let inArg = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) current += text[++i];
      else current += ch;
    } else if (/\s/.test(ch)) {
      if (inArg) args.push(current);
      current = '';
      inArg = false;
    } else {
      inArg = true;
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch === '\\' && i + 1 < text.length) current += text[++i];
      else current += ch;
    }
  }

  if (quote) return { ok: false, error: `Missing closing ${quote}` };
  if (inArg) args.push(current);
  return { ok: true, args };
}

/** The inverse of parseFlagText: text that parses back to exactly these arguments. */
export function formatFlagText(args: readonly string[]): string {
  return args.map(quoteArg).join(' ');
}

function quoteArg(arg: string): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** What a new session's first claude launch needs. */
export interface NewSessionLaunch {
  id: string;
  name: string;
  /** A worktree for claude to create; null when there is none, or it already exists. */
  newWorktree: string | null;
  flags: readonly string[];
  prompt?: string;
}

/**
 * claude's arguments for a new session's first launch. Chorus's own flags go
 * first, so none can be taken as the value of a user flag. `--session-id`
 * makes claude use Chorus's id, which the hooks report and a relaunch
 * resumes. Only this launch gets the prompt: a relaunch resumes the
 * conversation instead of sending it again.
 */
export function newSessionArgs(launch: NewSessionLaunch): string[] {
  return [
    '--session-id', launch.id,
    '--name', launch.name,
    ...(launch.newWorktree ? ['--worktree', launch.newWorktree] : []),
    ...launch.flags,
    ...initialPromptArgs(launch.prompt),
  ];
}

/**
 * claude's arguments for launching an existing session again, Chorus's own
 * flags first as for a new session. Once the user has prompted it, claude
 * has a transcript to --resume; before that, reusing the session id keeps the
 * session addressable by the same id.
 */
export function relaunchArgs(session: Pick<Session, 'id' | 'name' | 'flags' | 'hasUserInput'>): string[] {
  const identity = session.hasUserInput
    ? ['--resume', session.id]
    : ['--session-id', session.id, '--name', session.name];
  return [...identity, ...session.flags];
}

/**
 * Arguments that give claude its first prompt; none for a blank prompt.
 * `--` ends option parsing, so the prompt can follow a variadic flag
 * (`--allowed-tools a b`) or start with "-". claude still runs a lone word
 * that names a subcommand (`claude -- purge` runs `claude purge`), so a
 * one-word prompt gets a trailing space, which the subcommand lookup doesn't
 * match.
 */
function initialPromptArgs(prompt: string | undefined): string[] {
  const text = prompt?.trim() ?? '';
  if (!text) return [];
  return ['--', /\s/.test(text) ? text : `${text} `];
}
