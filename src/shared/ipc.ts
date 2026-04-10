// ─── IPC Channel Names ───────────────────────────────────
// All IPC channels are defined here as typed constants.
// Direction conventions:
//   invoke: renderer → main (request/response via ipcRenderer.invoke)
//   push:   main → renderer (one-way via webContents.send)

export const IpcChannels = {
  // Session management (invoke)
  SESSION_CREATE: 'session:create',
  SESSION_LIST: 'session:list',
  SESSION_GET: 'session:get',
  SESSION_RENAME: 'session:rename',
  SESSION_END: 'session:end',
  SESSION_SWITCH: 'session:switch',
  SESSION_TOGGLE_NOTIFY: 'session:toggle-notify',
  SESSION_REORDER: 'session:reorder',
  // Session state updates (push: main → renderer)
  SESSION_STATE: 'session:state',

  // PTY I/O — Claude Code terminal
  PTY_DATA: 'pty:data',       // push: main → renderer
  PTY_WRITE: 'pty:write',     // invoke: renderer → main
  PTY_RESIZE: 'pty:resize',   // invoke: renderer → main

  // Shell terminal (bottom panel)
  SHELL_DATA: 'shell:data',     // push: main → renderer
  SHELL_WRITE: 'shell:write',   // invoke: renderer → main
  SHELL_RESIZE: 'shell:resize', // invoke: renderer → main

  // Toolkit commands
  TOOLKIT_LIST: 'toolkit:list',       // invoke
  TOOLKIT_EXECUTE: 'toolkit:execute', // invoke
  TOOLKIT_SAVE: 'toolkit:save',       // invoke
  TOOLKIT_ADD: 'toolkit:add',         // invoke
  TOOLKIT_UPDATE: 'toolkit:update',   // invoke
  TOOLKIT_DELETE: 'toolkit:delete',   // invoke

  // App state
  APP_GET_STATE: 'app:get-state',                         // invoke
  APP_SAVE_STATE: 'app:save-state',                       // invoke
  APP_GET_NEW_SESSION_DEFAULTS: 'app:get-new-session-defaults', // invoke

  // Native dialogs
  DIALOG_SELECT_DIRECTORY: 'dialog:select-directory', // invoke

  // Shell utilities
  SHELL_OPEN_EXTERNAL: 'shell:open-external', // invoke

  // Menu actions (push: main → renderer)
  MENU_NEW_SESSION: 'menu:new-session',
  MENU_SWITCH_SESSION: 'menu:switch-session',
  MENU_PREV_SESSION: 'menu:prev-session',
  MENU_NEXT_SESSION: 'menu:next-session',
  MENU_CLOSE_SESSION: 'menu:close-session',
  MENU_FIND: 'menu:find',
  MENU_FIND_NEXT: 'menu:find-next',
  MENU_FIND_PREVIOUS: 'menu:find-previous',
  MENU_PREFERENCES: 'menu:preferences',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

// ─── IPC Error Codes ─────────────────────────────────────

export const IpcErrorCodes = {
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  PTY_SPAWN_FAILED: 'PTY_SPAWN_FAILED',
  INVALID_DIRECTORY: 'INVALID_DIRECTORY',
} as const;

export type IpcErrorCode = (typeof IpcErrorCodes)[keyof typeof IpcErrorCodes];

// ─── Type-safe IPC Map ───────────────────────────────────
// Maps each channel to its request payload and response type.
// Used by both main and renderer for type-safe IPC.

import type {
  Session,
  SessionConfig,
  SessionIdPayload,
  SessionRenamePayload,
  SessionReorderPayload,
  SessionStateUpdate,
  PtyDataPayload,
  PtyWritePayload,
  PtyResizePayload,
  ToolkitCommand,
  ToolkitExecutePayload,
  ToolkitListPayload,
  ToolkitSavePayload,
  AppState,
  NewSessionDefaults,
  SessionSwitchByIndexPayload,
} from './types';

// Invoke channels: renderer → main (request/response)
export interface IpcInvokeMap {
  [IpcChannels.SESSION_CREATE]: { payload: SessionConfig; response: Session };
  [IpcChannels.SESSION_LIST]: { payload: void; response: Session[] };
  [IpcChannels.SESSION_GET]: { payload: SessionIdPayload; response: Session | null };
  [IpcChannels.SESSION_RENAME]: { payload: SessionRenamePayload; response: Session };
  [IpcChannels.SESSION_END]: { payload: SessionIdPayload; response: void };
  [IpcChannels.SESSION_SWITCH]: { payload: SessionIdPayload; response: Session };
  [IpcChannels.SESSION_TOGGLE_NOTIFY]: { payload: SessionIdPayload; response: Session };
  [IpcChannels.SESSION_REORDER]: { payload: SessionReorderPayload; response: void };
  [IpcChannels.PTY_WRITE]: { payload: PtyWritePayload; response: void };
  [IpcChannels.PTY_RESIZE]: { payload: PtyResizePayload; response: void };
  [IpcChannels.SHELL_WRITE]: { payload: PtyWritePayload; response: void };
  [IpcChannels.SHELL_RESIZE]: { payload: PtyResizePayload; response: void };
  [IpcChannels.TOOLKIT_LIST]: { payload: ToolkitListPayload; response: ToolkitCommand[] };
  [IpcChannels.TOOLKIT_EXECUTE]: { payload: ToolkitExecutePayload; response: void };
  [IpcChannels.TOOLKIT_SAVE]: { payload: ToolkitSavePayload; response: void };
  [IpcChannels.TOOLKIT_ADD]: { payload: ToolkitCommand; response: ToolkitCommand };
  [IpcChannels.TOOLKIT_UPDATE]: { payload: ToolkitCommand; response: ToolkitCommand };
  [IpcChannels.TOOLKIT_DELETE]: { payload: SessionIdPayload; response: void };
  [IpcChannels.APP_GET_STATE]: { payload: void; response: AppState };
  [IpcChannels.APP_SAVE_STATE]: { payload: Partial<AppState>; response: void };
  [IpcChannels.APP_GET_NEW_SESSION_DEFAULTS]: { payload: void; response: NewSessionDefaults };
  [IpcChannels.DIALOG_SELECT_DIRECTORY]: { payload: void; response: string | null };
  [IpcChannels.SHELL_OPEN_EXTERNAL]: { payload: { url: string }; response: void };
}

// Push channels: main → renderer (one-way events)
export interface IpcPushMap {
  [IpcChannels.PTY_DATA]: PtyDataPayload;
  [IpcChannels.SHELL_DATA]: PtyDataPayload;
  [IpcChannels.SESSION_STATE]: SessionStateUpdate;
  [IpcChannels.MENU_NEW_SESSION]: void;
  [IpcChannels.MENU_SWITCH_SESSION]: SessionSwitchByIndexPayload;
  [IpcChannels.MENU_PREV_SESSION]: void;
  [IpcChannels.MENU_NEXT_SESSION]: void;
  [IpcChannels.MENU_CLOSE_SESSION]: void;
  [IpcChannels.MENU_FIND]: void;
  [IpcChannels.MENU_FIND_NEXT]: void;
  [IpcChannels.MENU_FIND_PREVIOUS]: void;
  [IpcChannels.MENU_PREFERENCES]: void;
}
