import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import type { SessionStatus } from '../shared/types';
import { readTranscriptMetadata } from './transcript-reader';

export interface HookEvent {
  session_id: string;
  hook_event_name: string;
  cwd: string;
  transcript_path?: string;
  model?: string;
  tool_name?: string;
  tool_input?: unknown;
  notification_type?: string;
  source?: string;
  reason?: string;
  stop_hook_active?: boolean;
  response_text?: string;
  prompt?: string;
}

/** Maps Claude Code hook events to Chorus session statuses. */
const HOOK_STATUS_MAP: Record<string, SessionStatus> = {
  Notification: 'waiting',
  UserPromptSubmit: 'thinking',
  Stop: 'idle',
  PreToolUse: 'generating',
  SessionStart: 'idle',
};

const HOOK_EVENTS = Object.keys(HOOK_STATUS_MAP);

export interface HookUpdate {
  status: SessionStatus;
  model?: string | null;
  contextUsage?: number | null;
}

export type HookStatusCallback = (sessionId: string, update: HookUpdate) => void;

export class HookServer {
  private server: http.Server | null = null;
  private port = 0;
  private callback: HookStatusCallback;
  /** Tracks which cwd directories have had hooks installed this session. */
  private installedDirs: Set<string> = new Set();
  /** Maps session ID -> transcript path. */
  private transcriptPaths: Map<string, string> = new Map();

  constructor(callback: HookStatusCallback) {
    this.callback = callback;
  }

  /** Start the HTTP server on a random available port. */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/hook') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            res.writeHead(200);
            res.end('ok');
            this.handleHookEvent(body);
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.server.on('error', reject);

      // Listen on port 0 to get a random available port
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve(this.port);
      });
    });
  }

  /** Stop the HTTP server. */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /** Get the port the server is listening on. */
  getPort(): number {
    return this.port;
  }

  /**
   * Ensure hooks are installed in `{cwd}/.claude/settings.local.json`.
   * Merges our hook config with any existing settings, only if not already present.
   */
  ensureHooksInstalled(cwd: string): void {
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
    const chorusMarker = `http://127.0.0.1:${this.port}/hook`;

    // Check if our hooks are already installed (look for our URL in any hook command)
    const alreadyInstalled = JSON.stringify(existingHooks).includes(chorusMarker);
    if (alreadyInstalled) {
      this.installedDirs.add(cwd);
      return;
    }

    // Remove any old Chorus hooks (from a previous port) before adding new ones
    const cleaned = this.removeChorusHooks(existingHooks);

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
  removeHooks(cwd: string): void {
    this.installedDirs.delete(cwd);

    const settingsPath = path.join(cwd, '.claude', 'settings.local.json');
    try {
      if (!fs.existsSync(settingsPath)) return;

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (!settings.hooks) return;

      settings.hooks = this.removeChorusHooks(settings.hooks);

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

  private handleHookEvent(body: string): void {
    let event: HookEvent;
    try {
      event = JSON.parse(body);
    } catch {
      return; // Malformed JSON — ignore
    }

    const status = HOOK_STATUS_MAP[event.hook_event_name];
    if (!status) return;

    // Track transcript path from any event that provides it
    if (event.transcript_path) {
      this.transcriptPaths.set(event.session_id, event.transcript_path);
    }

    // On SessionStart, emit model from the event directly
    if (event.hook_event_name === 'SessionStart' && event.model) {
      this.callback(event.session_id, { status, model: event.model });
      return;
    }

    // On Stop, read transcript for updated model + context usage
    if (event.hook_event_name === 'Stop') {
      // Emit status immediately so UI updates fast
      this.callback(event.session_id, { status });

      // Wait briefly for Claude Code to flush the transcript, then read metadata
      const transcriptPath = this.transcriptPaths.get(event.session_id);
      if (transcriptPath) {
        new Promise((r) => setTimeout(r, 500)).then(() => readTranscriptMetadata(transcriptPath)).then((meta) => {
          if (meta.model || meta.contextUsage !== null) {
            this.callback(event.session_id, {
              status,
              model: meta.model ?? undefined,
              contextUsage: meta.contextUsage ?? undefined,
            });
          }
        }).catch(() => {
          // Ignore transcript read failures
        });
      }
      return;
    }

    this.callback(event.session_id, { status });
  }

  private buildHookConfig(): Record<string, unknown[]> {
    const curlCmd = `curl -s -X POST http://127.0.0.1:${this.port}/hook -H 'Content-Type: application/json' -d @- 2>/dev/null || true`;

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

  /** Remove any hook entries that contain our Chorus server URL pattern. */
  private removeChorusHooks(hooks: Record<string, unknown[]>): Record<string, unknown[]> {
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
}
