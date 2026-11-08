import http from 'node:http';

import type { PrRef, SessionStatus } from '../shared/types';
import { findPrUrls } from '../shared/pr-ref';
import { readTranscriptMetadata } from './transcript-reader';

export interface HookEvent {
  session_id: string;
  hook_event_name: string;
  cwd: string;
  transcript_path?: string;
  model?: string;
  tool_name?: string;
  tool_input?: unknown;
  /** PostToolUse: what the tool returned; Bash's has `stdout`. */
  tool_response?: unknown;
  /** PostToolUseFailure: why the tool failed, as a string. */
  error?: unknown;
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
  // A tool finishing (or failing) after a permission prompt is the only
  // signal that the user approved it — without it the session would read
  // 'waiting' until the next tool call or Stop.
  PostToolUse: 'generating',
  PostToolUseFailure: 'generating',
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

// ─── PR creation ─────────────────────────────────────────

const GH_PR_CREATE_RE = /(?:^|[\s;|&(])gh\s+pr\s+create\b/;
// The GitHub MCP server's tool under whatever name the server was added as
// (mcp__github__…, mcp__plugin_github_github__…, mcp__claude_ai_GitHub__…)
const MCP_CREATE_PR_TOOL_RE = /^mcp__[\w-]*github[\w-]*__create_pull_request$/i;

function runsGhPrCreate(event: HookEvent): boolean {
  if (event.tool_name !== 'Bash') return false;
  const input = event.tool_input;
  if (typeof input !== 'object' || input === null || !('command' in input)) return false;
  return typeof input.command === 'string' && GH_PR_CREATE_RE.test(input.command);
}

function stdoutOf(toolResponse: unknown): string | undefined {
  if (typeof toolResponse !== 'object' || toolResponse === null || !('stdout' in toolResponse)) return undefined;
  return typeof toolResponse.stdout === 'string' ? toolResponse.stdout : undefined;
}

/** The text in which a finished create-PR tool call reports its PR; undefined for any other event. */
function createPrOutput(event: HookEvent): string | undefined {
  switch (event.hook_event_name) {
    case 'PostToolUse':
      if (runsGhPrCreate(event)) return stdoutOf(event.tool_response);
      // MCP results differ in shape between servers; the URL is in there as text
      if (event.tool_name !== undefined && MCP_CREATE_PR_TOOL_RE.test(event.tool_name)) {
        return JSON.stringify(event.tool_response);
      }
      return undefined;
    case 'PostToolUseFailure':
      // gh fails when the branch already has a PR, and names that PR's URL
      return runsGhPrCreate(event) && typeof event.error === 'string' ? event.error : undefined;
    default:
      return undefined;
  }
}

/**
 * The PR (if any) a finished tool call created: from `gh pr create`, whose
 * output — or error, when the branch already has a PR — ends with the PR's
 * URL, or from the GitHub MCP server's create_pull_request.
 */
export function prsCreatedBy(event: HookEvent): PrRef[] {
  const output = createPrOutput(event);
  if (!output) return [];
  const created = findPrUrls(output).at(-1);
  return created ? [created] : [];
}

// ─── Server ──────────────────────────────────────────────

/** Whether a POSTed body has the fields every hook event carries. */
function isHookEvent(body: unknown): body is HookEvent {
  return (
    typeof body === 'object' &&
    body !== null &&
    'session_id' in body &&
    typeof body.session_id === 'string' &&
    'hook_event_name' in body &&
    typeof body.hook_event_name === 'string' &&
    'cwd' in body &&
    typeof body.cwd === 'string'
  );
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
    let event: unknown;
    try {
      event = JSON.parse(body);
    } catch {
      return; // Malformed JSON — ignore
    }
    if (!isHookEvent(event)) return;

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

    // On Stop, read transcript for updated model + context usage
    if (event.hook_event_name === 'Stop') {
      // Emit status immediately so UI updates fast
      this.callback(event.session_id, { status });

      // Wait briefly for Claude Code to flush the transcript before reading it
      const transcriptPath = this.transcriptPaths.get(event.session_id);
      if (transcriptPath) {
        const sessionId = event.session_id;
        const prevLimit = this.getContextLimit?.(sessionId) ?? null;
        new Promise((r) => setTimeout(r, 500))
          .then(() => readTranscriptMetadata(transcriptPath, prevLimit))
          .then((meta) => {
            if (meta.model || meta.contextUsage !== null || meta.contextLimit !== null) {
              this.callback(sessionId, {
                status,
                model: meta.model ?? undefined,
                contextUsage: meta.contextUsage ?? undefined,
                contextLimit: meta.contextLimit ?? undefined,
              });
            }
          })
          .catch(() => {
            // Ignore transcript read failures
          });
      }
      return;
    }

    this.callback(event.session_id, { status });

    const createdPrs = prsCreatedBy(event);
    if (createdPrs.length > 0 && this.prCallback) {
      this.prCallback(event.session_id, createdPrs);
    }
  }
}
