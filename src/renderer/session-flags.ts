import { checkSessionFlags, formatFlagText, parseFlagText } from '../shared/claude-cli';

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

/**
 * How many of a session's flags the checkboxes set. They lead (the dialog
 * puts them before the custom flags), so a custom flag's value that happens
 * to read like one is left alone.
 */
function toggleFlagCount(flags: readonly string[]): number {
  let count = 0;
  while (count < flags.length && TOGGLE_OF_FLAG.has(flags[count])) count++;
  return count;
}

/** The checkbox states behind a session's flags. */
export function readToggles(flags: readonly string[]): FlagToggles {
  const owned = flags.slice(0, toggleFlagCount(flags));
  return {
    autoMode: owned.includes(AUTO_MODE),
    skipPermissions: owned.includes(SKIP_PERMISSIONS),
    chrome: owned.includes(CHROME),
  };
}

/** The flags no checkbox owns, as text for the Additional Flags field. */
export function customFlagText(flags: readonly string[]): string {
  return formatFlagText(flags.slice(toggleFlagCount(flags)));
}

/** What the user has typed into the Additional Flags field. */
export type CustomFlagsDraft = { kind: 'ok'; args: string[] } | { kind: 'invalid'; error: string };

/** claude's rules for session flags (main checks them again), plus pointing checkbox flags to their checkbox. */
export function readCustomFlags(text: string): CustomFlagsDraft {
  const parsed = parseFlagText(text);
  if (!parsed.ok) return { kind: 'invalid', error: parsed.error };

  const check = checkSessionFlags(parsed.args);
  if (!check.ok) return { kind: 'invalid', error: check.error };

  for (const name of check.flagNames) {
    const toggle = TOGGLE_OF_FLAG.get(name);
    if (toggle) return { kind: 'invalid', error: `Use the “${TOGGLE_LABELS[toggle]}” checkbox above` };
  }
  return { kind: 'ok', args: parsed.args };
}
