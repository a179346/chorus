import type { Session, SessionConfig, SessionStateUpdate, ToolkitCommand, AppState, NewSessionDefaults } from '../shared/types';

interface ElectronAPI {
  // Session management
  sessionCreate: (config: SessionConfig) => Promise<Session>;
  sessionList: () => Promise<Session[]>;
  sessionGet: (id: string) => Promise<Session | null>;
  sessionRename: (id: string, name: string) => Promise<Session>;
  sessionEnd: (id: string) => Promise<void>;
  sessionSwitch: (id: string) => Promise<Session>;
  sessionToggleNotify: (id: string) => Promise<Session>;

  // PTY I/O
  ptyWrite: (sessionId: string, data: string) => Promise<void>;
  ptyResize: (sessionId: string, cols: number, rows: number) => Promise<void>;

  // Shell terminal
  shellWrite: (sessionId: string, data: string) => Promise<void>;
  shellResize: (sessionId: string, cols: number, rows: number) => Promise<void>;

  // Toolkit
  toolkitList: (sessionId?: string) => Promise<ToolkitCommand[]>;
  toolkitExecute: (sessionId: string, commandId: string) => Promise<void>;
  toolkitSave: (commands: ToolkitCommand[]) => Promise<void>;
  toolkitAdd: (command: ToolkitCommand) => Promise<ToolkitCommand>;
  toolkitUpdate: (command: ToolkitCommand) => Promise<ToolkitCommand>;
  toolkitDelete: (id: string) => Promise<void>;

  // App state
  appGetState: () => Promise<AppState>;
  appSaveState: (state: Partial<AppState>) => Promise<void>;
  appGetNewSessionDefaults: () => Promise<NewSessionDefaults>;

  // Dialog
  selectDirectory: () => Promise<string | null>;

  // Shell utilities
  openExternal: (url: string) => Promise<void>;

  // Event listeners
  onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => () => void;
  onShellData: (callback: (data: { sessionId: string; data: string }) => void) => () => void;
  onSessionState: (callback: (update: SessionStateUpdate) => void) => () => void;
  onMenuNewSession: (callback: () => void) => () => void;
  onMenuSwitchSession: (callback: (data: { index: number }) => void) => () => void;
  onMenuPrevSession: (callback: () => void) => () => void;
  onMenuNextSession: (callback: () => void) => () => void;
  onMenuCloseSession: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
