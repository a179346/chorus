// What Chorus knows about the claude CLI's argument syntax: which flags take
// a value and which take none, the flags a session can't take, the shell-like
// text extra flags are typed in, and the arguments a session's claude is
// launched with.

import type { Session } from './types';

/**
 * Flags that set a session's identity, resume or worktree (Chorus passes
 * these itself), that keep claude from running as an interactive session in
 * this terminal, that whatever launches claude sets for its own ends, or that
 * turn off the hooks Chorus relies on to follow the session. `--` is here
 * because Chorus uses it to pass the prompt. A `--settings` file or JSON can
 * turn the hooks off too (`disableAllHooks`), but what it holds isn't
 * inspected.
 */
const UNSUPPORTED_FLAGS: ReadonlySet<string> = new Set([
  '--',
  // The session's identity, resume or worktree, which Chorus sets
  '--session-id',
  '-r', '--resume',
  '--resume-session-at',
  '--session-began-as-copy',
  '--parent-session-id',
  '-c', '--continue',
  '--fork-session',
  '--from-pr',
  '--teleport',
  '-n', '--name',
  '-w', '--worktree',
  // Not an interactive session in this terminal
  '-p', '--print',
  '--sdk-url',
  '--bg', '--background', '--routine',
  '--cloud', '--remote',
  '--environment', '--pool',
  '--desktop',
  '--tmux',
  '--attach-serve',
  '--init-only',
  '--rewind-files',
  '-h', '--help',
  '-v', '--version',
  // Set by an SDK or desktop host, a deep link, /background, `claude agents`
  // or a team lead when it launches claude; meaningless in a session started here
  '--session-mirror',
  '--await-claim',
  '--await-initialize',
  '--host-auth-is-org-sign-in',
  '--enable-auth-status',
  '--deep-link-origin',
  '--deep-link-repo',
  '--deep-link-last-fetch',
  '--deep-link-cwd-b64',
  '--reply-on-resume',
  '--agents-view-if-allowed',
  '--plan-mode-required',
  '--agent-id',
  '--agent-name',
  '--agent-type',
  '--agent-color',
  '--team-name',
  '--managed-settings',
  // Turn off the hooks (as does a --setting-sources without local)
  '--bare',
  '--safe-mode',
  '--restricted',
  // Reads the project's settings, hooks included, from another directory
  '--project-config-root',
]);

/** What --setting-sources can name. */
const SETTING_SOURCES: ReadonlySet<string> = new Set(['user', 'project', 'local']);

/** Chorus's hooks live in .claude/settings.local.json, which this source covers. */
const HOOKS_SETTING_SOURCE = 'local';

/**
 * Why claude can't launch with this --setting-sources value (comma-separated,
 * like `user,project`) or wouldn't load Chorus's hooks with it; null when it
 * can. Read as claude reads it: an empty value names no sources.
 */
function settingSourcesError(value: string): string | null {
  const sources = value === '' ? [] : value.split(',').map((source) => source.trim());
  if (!sources.every((source) => SETTING_SOURCES.has(source))) {
    return '--setting-sources takes a comma-separated list of user, project and local';
  }
  if (!sources.includes(HOOKS_SETTING_SOURCE)) {
    return `--setting-sources must include ${HOOKS_SETTING_SOURCE}, where Chorus's hooks are`;
  }
  return null;
}

/**
 * How claude's option parser reads a flag's value. `required`: always the
 * next argument, whatever it looks like. `optional`: the next argument unless
 * it is a flag. `variadic`: like `required`, plus every argument after it up
 * to the next flag.
 */
type ValueKind = 'required' | 'optional' | 'variadic';

/**
 * The flags in `claude --help` (2.1.319) that take a value, then hidden ones
 * a user is likely to type. This must follow claude's flags: a value flag
 * missing here can only be passed as --flag=value. Unsupported flags are left
 * out, since they are rejected before their value matters.
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
  // Hidden from --help
  ['--advisor', 'required'],
  ['--append-system-prompt-file', 'required'],
  ['--channels', 'variadic'],
  ['--dangerously-load-development-channels', 'variadic'],
  ['--fast-mode', 'required'],
  ['--max-thinking-tokens', 'required'],
  ['--max-turns', 'required'],
  ['--permission-prompt-tool', 'required'],
  ['--plugin-dir-no-mcp', 'required'],
  ['--proactivity', 'required'],
  ['--rc', 'optional'],
  ['--system-prompt-file', 'required'],
  ['--teammate-mode', 'required'],
  ['--thinking', 'required'],
]);

/**
 * Every flag claude (2.1.319) declares that takes no value: the ones in
 * `claude --help`, then the hidden ones. claude rejects a value attached to
 * one (`--verbose=true`). This must follow claude's flags: one missing here
 * passes with a value attached, and a word after it gets the hint to attach
 * it. Unsupported flags are left out.
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  '--allow-dangerously-skip-permissions',
  '--ax-screen-reader',
  '--brief',
  '--chrome',
  '--dangerously-skip-permissions',
  '--disable-slash-commands',
  '--exclude-dynamic-system-prompt-sections',
  '--forward-subagent-text',
  '--ide',
  '--include-hook-events',
  '--include-partial-messages',
  '--no-chrome',
  '--no-session-persistence',
  '--replay-user-messages',
  '--strict-mcp-config',
  '--verbose',
  // Hidden from --help
  '--allow-other-models',
  '-d2e', '--debug-to-stderr',
  '--enable-auto-mode',
  '--include-unsupported-models',
  '--init',
  '--maintenance',
]);

function isKnownFlag(arg: string): boolean {
  return UNSUPPORTED_FLAGS.has(arg) || VALUE_FLAGS.has(arg) || BOOLEAN_FLAGS.has(arg);
}

/**
 * The flag an argument names, or null for a plain value. As in claude's
 * parser, an argument that is a whole known flag names it (`-d2e` is a flag of
 * its own, not `-d` with a value). Otherwise covers the forms the CLI accepts:
 * `--name=value`, and a short flag with its value attached (`-nvalue`).
 */
function flagName(arg: string): string | null {
  if (isKnownFlag(arg)) return arg;
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
    if (attached && BOOLEAN_FLAGS.has(name)) return { ok: false, error: `${name} takes no value` };
    const values = attached ? [attachedValue(arg, name)] : valuesAfter(VALUE_FLAGS.get(name), args.slice(i + 1));
    if (values === null) return { ok: false, error: `${name} needs a value` };
    if (name === '--setting-sources') {
      const error = settingSourcesError(values[0]);
      if (error) return { ok: false, error };
    }

    flagNames.push(name);
    valuelessFlag = values.length === 0 ? name : null;
    i += attached ? 1 : 1 + values.length;
  }
  return { ok: true, flagNames };
}

function strayArgumentError(arg: string, valuelessFlag: string | null): string {
  const shown = arg === '' ? "The empty argument ''" : formatFlagText([arg]);
  if (valuelessFlag !== null && BOOLEAN_FLAGS.has(valuelessFlag)) {
    return `${shown} isn't a flag — ${valuelessFlag} takes no value`;
  }
  // A flag in neither table may take a value, which is unambiguous only when attached
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
 * session addressable by the same id. `recreateWorktree` is for a session
 * whose worktree directory is gone (claude removes a clean one when it
 * exits): claude, launched from the session's cwd, creates it again.
 */
export function relaunchArgs(
  session: Pick<Session, 'id' | 'name' | 'worktree' | 'flags' | 'hasUserInput'>,
  { recreateWorktree }: { recreateWorktree: boolean },
): string[] {
  const identity = session.hasUserInput
    ? ['--resume', session.id]
    : ['--session-id', session.id, '--name', session.name];
  const worktree = recreateWorktree && session.worktree ? ['--worktree', session.worktree] : [];
  return [...identity, ...worktree, ...session.flags];
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
