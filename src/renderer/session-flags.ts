import { flagName, formatFlagText, parseFlagText, unsupportedFlagError } from '../shared/claude-cli';

/** The New Session dialog's flag checkboxes. */
export interface FlagToggles {
  autoMode: boolean;
  skipPermissions: boolean;
  chrome: boolean;
}

export const TOGGLE_LABELS: Record<keyof FlagToggles, string> = {
  autoMode: 'Enable auto mode',
  skipPermissions: 'Skip permissions',
  chrome: 'Enable Claude in Chrome',
};

const AUTO_MODE = '--enable-auto-mode';
const SKIP_PERMISSIONS = '--dangerously-skip-permissions';
const CHROME = '--chrome';
const NO_CHROME = '--no-chrome';

/** Each flag a checkbox sets, and that checkbox. */
const TOGGLE_OF_FLAG: ReadonlyMap<string, keyof FlagToggles> = new Map([
  [AUTO_MODE, 'autoMode'],
  [SKIP_PERMISSIONS, 'skipPermissions'],
  [CHROME, 'chrome'],
  [NO_CHROME, 'chrome'],
]);

export function toggleFlags(toggles: FlagToggles): string[] {
  const flags: string[] = [];
  if (toggles.autoMode) flags.push(AUTO_MODE);
  if (toggles.skipPermissions) flags.push(SKIP_PERMISSIONS);
  flags.push(toggles.chrome ? CHROME : NO_CHROME);
  return flags;
}

/** The checkbox states behind a session's flags. */
export function readToggles(flags: readonly string[]): FlagToggles {
  return {
    autoMode: flags.includes(AUTO_MODE),
    skipPermissions: flags.includes(SKIP_PERMISSIONS),
    chrome: flags.includes(CHROME),
  };
}

/** The flags no checkbox owns, as text for the Additional Flags field. */
export function customFlagText(flags: readonly string[]): string {
  return formatFlagText(flags.filter((f) => !TOGGLE_OF_FLAG.has(f)));
}

/** What the user has typed into the Additional Flags field. */
export type CustomFlagsDraft = { kind: 'ok'; args: string[] } | { kind: 'invalid'; error: string };

export function readCustomFlags(text: string): CustomFlagsDraft {
  const parsed = parseFlagText(text);
  if (!parsed.ok) return { kind: 'invalid', error: parsed.error };

  const { args } = parsed;
  // A leading bare word would reach claude as a prompt or subcommand
  if (args.length > 0 && flagName(args[0]) === null) {
    return { kind: 'invalid', error: `${args[0]} isn't a flag — flags start with -` };
  }

  const unsupported = unsupportedFlagError(args);
  if (unsupported) return { kind: 'invalid', error: unsupported };

  for (const arg of args) {
    const toggle = TOGGLE_OF_FLAG.get(flagName(arg) ?? '');
    if (toggle) return { kind: 'invalid', error: `Use the “${TOGGLE_LABELS[toggle]}” checkbox above` };
  }
  return { kind: 'ok', args };
}
