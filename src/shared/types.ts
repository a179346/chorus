// ─── Session ──────────────────────────────────────────────

export type SessionStatus =
  | 'creating'
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'generating'
  | 'error'
  | 'ended';

export interface Session {
  id: string;
  name: string;
  cwd: string;
  worktree: string | null;
  status: SessionStatus;
  model: string | null;
  contextUsage: number | null;
  gitBranch: string | null;
  flags: string[];
  notifyOnIdle: boolean;
  unread: boolean;
  createdAt: number;
  lastActiveAt: number;
  hasUserInput: boolean;
}

export interface SessionConfig {
  name: string;
  cwd: string;
  worktree?: string;
  flags: string[];
}

export interface SessionStateUpdate {
  sessionId: string;
  status?: SessionStatus;
  model?: string | null;
  contextUsage?: number | null;
  gitBranch?: string | null;
  hasUserInput?: boolean;
  unread?: boolean;
}

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
  createdAt: number;
  lastActiveAt: number;
  hasUserInput: boolean;
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
}

// ─── App State ───────────────────────────────────────────

export interface AppState {
  windowBounds: WindowBounds;
  panelSizes: PanelSizes;
  lastActiveSessionId: string | null;
  newSessionDefaults: NewSessionDefaults;
  terminalSettings: TerminalSettings;
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
