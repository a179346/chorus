import fs from 'node:fs';
import path from 'node:path';
import { HOOK_EVENTS } from './hook-server';

/**
 * Owns the on-disk hook configuration in `{cwd}/.claude/settings.local.json`:
 * merging Chorus hook entries into existing settings and removing them again.
 * Deliberately separate from HookServer, which only receives events over HTTP.
 */
export class HookInstaller {
  /** Tracks which cwd directories have had hooks installed this session. */
  private installedDirs: Set<string> = new Set();

  constructor(private readonly getPort: () => number) {}

  /**
   * Ensure hooks are installed in `{cwd}/.claude/settings.local.json`.
   * Merges our hook config with any existing settings, only if not already present.
   */
  ensureInstalled(cwd: string): void {
    if (this.installedDirs.has(cwd)) return;

    const claudeDir = path.join(cwd, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    // Read existing settings or start fresh
    let settings: Record<string, unknown> = {};
    try {
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
    } catch {
      // Corrupted file — start fresh
      settings = {};
    }

    const existingHooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    const chorusMarker = `http://127.0.0.1:${this.getPort()}/hook`;

    // Check if our hooks are already installed (look for our URL in any hook command)
    const alreadyInstalled = JSON.stringify(existingHooks).includes(chorusMarker);
    if (alreadyInstalled) {
      this.installedDirs.add(cwd);
      return;
    }

    // Remove any old Chorus hooks (from a previous port) before adding new ones
    const cleaned = removeChorusHooks(existingHooks);

    // Build our hook entries
    const chorusHooks = this.buildHookConfig();

    // Merge: for each event, append our hooks to any existing hooks
    for (const [event, hookEntries] of Object.entries(chorusHooks)) {
      const existing = (cleaned[event] ?? []) as unknown[];
      cleaned[event] = [...existing, ...hookEntries];
    }

    settings.hooks = cleaned;

    // Write back
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    this.installedDirs.add(cwd);
  }

  /**
   * Remove Chorus hooks from a cwd's settings when a session ends.
   * If no other Chorus sessions use this cwd, clean up our hooks.
   */
  remove(cwd: string): void {
    this.installedDirs.delete(cwd);

    const settingsPath = path.join(cwd, '.claude', 'settings.local.json');
    try {
      if (!fs.existsSync(settingsPath)) return;

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (!settings.hooks) return;

      settings.hooks = removeChorusHooks(settings.hooks);

      // Remove empty hook arrays
      for (const [event, entries] of Object.entries(settings.hooks as Record<string, unknown[]>)) {
        if (Array.isArray(entries) && entries.length === 0) {
          delete (settings.hooks as Record<string, unknown[]>)[event];
        }
      }

      // Remove hooks key entirely if empty
      if (Object.keys(settings.hooks as object).length === 0) {
        delete settings.hooks;
      }

      // If settings is now empty, delete the file; otherwise write back
      if (Object.keys(settings).length === 0) {
        fs.unlinkSync(settingsPath);
      } else {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private buildHookConfig(): Record<string, unknown[]> {
    const curlCmd = `curl -s -X POST http://127.0.0.1:${this.getPort()}/hook -H 'Content-Type: application/json' -d @- 2>/dev/null || true`;

    const config: Record<string, unknown[]> = {};

    for (const event of HOOK_EVENTS) {
      config[event] = [
        {
          hooks: [
            {
              type: 'command',
              command: curlCmd,
              timeout: 5,
            },
          ],
        },
      ];
    }

    return config;
  }
}

/** Remove any hook entries that contain our Chorus server URL pattern. */
function removeChorusHooks(hooks: Record<string, unknown[]>): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      result[event] = entries;
      continue;
    }

    const filtered = entries.filter((entry) => {
      const str = JSON.stringify(entry);
      // Match any Chorus hook URL pattern (any port)
      return !/http:\/\/127\.0\.0\.1:\d+\/hook/.test(str);
    });

    result[event] = filtered;
  }

  return result;
}
