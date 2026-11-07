// What Chorus knows about the claude CLI's argument syntax: the flags it
// can't let users pass, the shell-like text extra flags are typed in, and how
// a session's first prompt is handed over.

/**
 * Flags that set a session's identity, resume or worktree (Chorus passes
 * these itself), or that keep claude from running as an interactive session
 * in this terminal. `--` is here because Chorus uses it to pass the prompt.
 */
const UNSUPPORTED_FLAGS: ReadonlySet<string> = new Set([
  '--',
  '--session-id',
  '-r', '--resume',
  '-c', '--continue',
  '--fork-session',
  '--from-pr',
  '--teleport',
  '-n', '--name',
  '-w', '--worktree',
  '-p', '--print',
  '--bg', '--background',
  '--cloud',
  '--desktop',
  '-h', '--help',
  '-v', '--version',
]);

/**
 * The flag an argument names, or null for a plain value. Covers the forms
 * the CLI accepts: `--name=value`, and a short flag with its value attached
 * (`-nvalue`).
 */
export function flagName(arg: string): string | null {
  if (arg === '--') return arg;
  if (arg.startsWith('--')) return arg.split('=')[0];
  if (arg.startsWith('-') && arg.length > 1) return arg.slice(0, 2);
  return null;
}

/** Why these flags can't launch a Chorus session, or null when they can. */
export function unsupportedFlagError(args: readonly string[]): string | null {
  for (const arg of args) {
    const name = flagName(arg);
    if (name && UNSUPPORTED_FLAGS.has(name)) return `${name} isn't supported in Chorus sessions`;
  }
  return null;
}

export type FlagTextParse = { ok: true; args: string[] } | { ok: false; error: string };

/**
 * Split typed flags into arguments the way a POSIX shell would: whitespace
 * separates them, single quotes keep text literal, double quotes allow \" and
 * \\, and a backslash outside quotes escapes the next character.
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

/**
 * Arguments that give claude its first prompt; none for a blank prompt.
 * `--` ends option parsing, so the prompt can follow a variadic flag
 * (`--allowed-tools a b`) or start with "-". claude still runs a lone word
 * that names a subcommand (`claude -- purge` runs `claude purge`), so a
 * one-word prompt gets a trailing space, which the subcommand lookup doesn't
 * match.
 */
export function initialPromptArgs(prompt: string | undefined): string[] {
  const text = prompt?.trim() ?? '';
  if (!text) return [];
  return ['--', /\s/.test(text) ? text : `${text} `];
}
