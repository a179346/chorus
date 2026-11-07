import http from 'node:http';

import type { PrRef, SessionStatus } from '../shared/types';
import { extractPrsFromCreateCalls, readTranscriptMetadata } from './transcript-reader';

export interface HookEvent {
  session_id: string;
  hook_event_name: string;
  cwd: string;
  transcript_path?: string;
  model?: string;
  tool_name?: string;
  tool_input?: unknown;
  message?: string;
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
  // A tool finishing after a permission prompt is the only signal that the
  // user approved it — without it the session would read 'waiting' until
  // the next tool call or Stop.
  PostToolUse: 'generating',
  SessionStart: 'idle',
};

/**
 * Notification types where Claude is blocked until the user responds. The
 * rest (idle_prompt, auth_success) are informational and leave status alone.
 */
const BLOCKING_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'permission_prompt',
  'elicitation_dialog',
]);

/** The hook events Chorus subscribes to. HookInstaller writes these into settings files. */
export const HOOK_EVENTS = Object.keys(HOOK_STATUS_MAP);

export interface HookUpdate {
  status: SessionStatus;
  model?: string | null;
  contextUsage?: number | null;
  contextLimit?: number | null;
  /** Claude's own description of what it is blocked on; set only with 'waiting'. */
  waitingReason?: string;
}

export type HookStatusCallback = (sessionId: string, update: HookUpdate) => void;
export type PrsDetectedCallback = (sessionId: string, prs: PrRef[]) => void;
/** Returns the previously detected context limit for a session, or null. */
export type GetContextLimitCallback = (sessionId: string) => number | null;

export class HookServer {
  private server: http.Server | null = null;
  private port = 0;
  private callback: HookStatusCallback;
  private prCallback: PrsDetectedCallback | null = null;
  private getContextLimit: GetContextLimitCallback | null = null;
  /** Maps session ID -> transcript path. */
  private transcriptPaths: Map<string, string> = new Map();

  constructor(
    callback: HookStatusCallback,
    prCallback?: PrsDetectedCallback,
    getContextLimit?: GetContextLimitCallback,
  ) {
    this.callback = callback;
    this.prCallback = prCallback ?? null;
    this.getContextLimit = getContextLimit ?? null;
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

    if (event.hook_event_name === 'Notification') {
      if (!BLOCKING_NOTIFICATION_TYPES.has(event.notification_type ?? '')) return;
      this.callback(event.session_id, { status, waitingReason: event.message });
      return;
    }

    // On SessionStart, emit model from the event directly
    if (event.hook_event_name === 'SessionStart' && event.model) {
      this.callback(event.session_id, { status, model: event.model });
      return;
    }

    // On Stop, read transcript for updated model + context usage + PR detection
    if (event.hook_event_name === 'Stop') {
      // Emit status immediately so UI updates fast
      this.callback(event.session_id, { status });

      // Wait briefly for Claude Code to flush the transcript, then run both
      // metadata + PR extraction in parallel against the freshly-flushed file.
      const transcriptPath = this.transcriptPaths.get(event.session_id);
      if (transcriptPath) {
        const sessionId = event.session_id;
        const prevLimit = this.getContextLimit?.(sessionId) ?? null;
        new Promise((r) => setTimeout(r, 500))
          .then(() =>
            Promise.all([
              readTranscriptMetadata(transcriptPath, prevLimit),
              extractPrsFromCreateCalls(transcriptPath),
            ]),
          )
          .then(([meta, prs]) => {
            if (meta.model || meta.contextUsage !== null || meta.contextLimit !== null) {
              this.callback(sessionId, {
                status,
                model: meta.model ?? undefined,
                contextUsage: meta.contextUsage ?? undefined,
                contextLimit: meta.contextLimit ?? undefined,
              });
            }
            if (prs.length > 0 && this.prCallback) {
              this.prCallback(sessionId, prs);
            }
          })
          .catch(() => {
            // Ignore transcript read failures
          });
      }
      return;
    }

    this.callback(event.session_id, { status });
  }
}
