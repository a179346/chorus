// ─── Session ──────────────────────────────────────────────

export type SessionStatus =
  | 'creating'
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'generating'
  | 'error'
  | 'ended';

/**
 * A linked PR's state on GitHub; 'unknown' until a lookup succeeds.
 * 'not-found' means gh can't see it — a mistyped URL, or no access.
 */
export type PrStage =
  | 'unknown'
  | 'not-found'
  | 'draft'
  | 'ready'
  | 'merged'
  | 'closed';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** A PR linked to a session, with its last known stage. */
export interface LinkedPr extends PrRef {
  stage: PrStage;
  stageUpdatedAt: number | null;
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
  /** In the order they were linked. */
  prs: LinkedPr[];
}

export interface SessionConfig {
  name: string;
  cwd: string;
  worktree?: string;
  flags: string[];
  notifyOnIdle?: boolean;
  /** GitHub PR URLs — links the session to each PR for stage tracking. */
  prUrls?: string[];
  /** Sent as the first message when claude starts. Not kept: a relaunch resumes instead. */
  prompt?: string;
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
  'prs',
] as const satisfies readonly (keyof Session)[];

export type SessionSyncField = (typeof SESSION_SYNC_FIELDS)[number];

export type SessionStateUpdate = { sessionId: string } & Partial<
  Pick<Session, SessionSyncField>
>;

// ─── Persistence (subset of Session saved to disk) ──────

/** What this version writes to disk for a session. */
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
  prs: LinkedPr[];
}

/**
 * A saved session as read back from disk. This or any older release may have
 * written it, so fields added after v1.0.0 can be missing.
 */
export interface StoredSession extends Omit<PersistedSession, 'contextLimit' | 'prs'> {
  /** Since v1.5.0. */
  contextLimit?: number | null;
  /** After v1.6.0; v1.4.0–v1.6.0 stored one PR as `pr` / `stage` / `stageUpdatedAt`. */
  prs?: LinkedPr[];
  pr?: PrRef | null;
  stage?: 'no-pr' | 'draft' | 'ready' | 'merged' | 'closed';
  stageUpdatedAt?: number | null;
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

export interface SessionLinkPrPayload {
  id: string;
  url: string;
}

export interface SessionUnlinkPrPayload {
  id: string;
  pr: PrRef;
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
