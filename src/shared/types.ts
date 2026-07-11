// ─── Session ──────────────────────────────────────────────

export type SessionStatus =
  | 'creating'
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'generating'
  | 'error'
  | 'ended';

export type SessionStage =
  | 'no-pr'
  | 'draft'
  | 'ready'
  | 'merged'
  | 'closed';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface Session {
  id: string;
  name: string;
  cwd: string;
  worktree: string | null;
  status: SessionStatus;
  model: string | null;
  contextUsage: number | null;
  contextLimit: number | null;
  flags: string[];
  notifyOnIdle: boolean;
  unread: boolean;
  createdAt: number;
  lastActiveAt: number;
  hasUserInput: boolean;
  pr: PrRef | null;
  stage: SessionStage;
  stageUpdatedAt: number | null;
}

export interface SessionConfig {
  name: string;
  cwd: string;
  worktree?: string;
  flags: string[];
  notifyOnIdle?: boolean;
  /** GitHub PR URL — links the session to the PR for stage tracking. */
  prUrl?: string;
}

// Fields the main process may push to the renderer over SESSION_STATE.
// SessionStateUpdate is derived from this list, so a new syncable field is
// declared exactly once and both sides of the seam pick it up.
export const SESSION_SYNC_FIELDS = [
  'status',
  'model',
  'contextUsage',
  'contextLimit',
  'hasUserInput',
  'unread',
  'name',
  'notifyOnIdle',
  'pr',
  'stage',
  'stageUpdatedAt',
] as const satisfies readonly (keyof Session)[];

export type SessionSyncField = (typeof SESSION_SYNC_FIELDS)[number];

export type SessionStateUpdate = { sessionId: string } & Partial<
  Pick<Session, SessionSyncField>
>;

// ─── Persistence (subset of Session saved to disk) ──────

export interface PersistedSession {
  id: string;
  name: string;
  cwd: string;
  worktree: string | null;
  flags: string[];
  notifyOnIdle: boolean;
  unread: boolean;
  model: string | null;
  contextUsage: number | null;
  contextLimit: number | null;
  createdAt: number;
  lastActiveAt: number;
  hasUserInput: boolean;
  pr: PrRef | null;
  stage: SessionStage;
  stageUpdatedAt: number | null;
}

// ─── Toolkit ─────────────────────────────────────────────

export interface ToolkitCommand {
  id: string;
  label: string;
  command: string;
  icon?: string;
}

// ─── Terminal Settings ───────────────────────────────────

export interface TerminalSettings {
  fontFamily: string;
  theme: string;
  claudeFontSize: number;
  shellFontSize: number;
}

// ─── App State ───────────────────────────────────────────

export interface AppState {
  windowBounds: WindowBounds;
  panelSizes: PanelSizes;
  lastActiveSessionId: string | null;
  newSessionDefaults: NewSessionDefaults;
  terminalSettings: TerminalSettings;
  /** Pinned working directories offered as one-click choices in the new-session dialog. */
  favoriteDirectories: string[];
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelSizes {
  sidebarWidth: number;
  shellHeight: number;
  toolkitHeight: number;
  shellCollapsed: boolean;
}

export interface NewSessionDefaults {
  cwd: string;
  flags: string[];
  notifyOnIdle: boolean;
}

// ─── IPC Payloads ────────────────────────────────────────

export interface PtyDataPayload {
  sessionId: string;
  data: string;
}

export interface PtyWritePayload {
  sessionId: string;
  data: string;
}

export interface PtyResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface SessionIdPayload {
  id: string;
}

export interface SessionRenamePayload {
  id: string;
  name: string;
}

export interface SessionSwitchByIndexPayload {
  index: number;
}

export interface ToolkitExecutePayload {
  sessionId: string;
  commandId: string;
}

export interface ToolkitListPayload {
  sessionId?: string;
}

export interface SessionReorderPayload {
  sessionIds: string[];
}

export interface ToolkitSavePayload {
  commands: ToolkitCommand[];
}

export interface IpcError {
  code: string;
  message: string;
}
