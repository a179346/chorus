import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Session management
  sessionCreate: (config: unknown) => ipcRenderer.invoke('session:create', config),
  sessionList: () => ipcRenderer.invoke('session:list'),
  sessionGet: (id: string) => ipcRenderer.invoke('session:get', { id }),
  sessionRename: (id: string, name: string) => ipcRenderer.invoke('session:rename', { id, name }),
  sessionEnd: (id: string) => ipcRenderer.invoke('session:end', { id }),
  sessionSwitch: (id: string) => ipcRenderer.invoke('session:switch', { id }),
  sessionToggleNotify: (id: string) => ipcRenderer.invoke('session:toggle-notify', { id }),
  sessionReorder: (sessionIds: string[]) => ipcRenderer.invoke('session:reorder', { sessionIds }),

  // PTY I/O
  ptyWrite: (sessionId: string, data: string) => ipcRenderer.invoke('pty:write', { sessionId, data }),
  ptyResize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('pty:resize', { sessionId, cols, rows }),

  // Shell terminal
  shellWrite: (sessionId: string, data: string) => ipcRenderer.invoke('shell:write', { sessionId, data }),
  shellResize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('shell:resize', { sessionId, cols, rows }),

  // Toolkit
  toolkitList: (sessionId?: string) => ipcRenderer.invoke('toolkit:list', { sessionId }),
  toolkitExecute: (sessionId: string, commandId: string) => ipcRenderer.invoke('toolkit:execute', { sessionId, commandId }),
  toolkitSave: (commands: unknown) => ipcRenderer.invoke('toolkit:save', { commands }),
  toolkitAdd: (command: unknown) => ipcRenderer.invoke('toolkit:add', command),
  toolkitUpdate: (command: unknown) => ipcRenderer.invoke('toolkit:update', command),
  toolkitDelete: (id: string) => ipcRenderer.invoke('toolkit:delete', { id }),

  // App state
  appGetState: () => ipcRenderer.invoke('app:get-state'),
  appSaveState: (state: unknown) => ipcRenderer.invoke('app:save-state', state),
  appGetNewSessionDefaults: () => ipcRenderer.invoke('app:get-new-session-defaults'),

  // Dialog
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),

  // Shell utilities
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', { url }),

  // Event listeners (main → renderer)
  onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => {
    const listener = (_event: unknown, payload: { sessionId: string; data: string }) => callback(payload);
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);
  },
  onShellData: (callback: (data: { sessionId: string; data: string }) => void) => {
    const listener = (_event: unknown, payload: { sessionId: string; data: string }) => callback(payload);
    ipcRenderer.on('shell:data', listener);
    return () => ipcRenderer.removeListener('shell:data', listener);
  },
  onSessionState: (callback: (update: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('session:state', listener);
    return () => ipcRenderer.removeListener('session:state', listener);
  },
  onMenuNewSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:new-session', listener);
    return () => ipcRenderer.removeListener('menu:new-session', listener);
  },
  onMenuSwitchSession: (callback: (data: { index: number }) => void) => {
    const listener = (_event: unknown, payload: { index: number }) => callback(payload);
    ipcRenderer.on('menu:switch-session', listener);
    return () => ipcRenderer.removeListener('menu:switch-session', listener);
  },
  onMenuPrevSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:prev-session', listener);
    return () => ipcRenderer.removeListener('menu:prev-session', listener);
  },
  onMenuNextSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:next-session', listener);
    return () => ipcRenderer.removeListener('menu:next-session', listener);
  },
  onMenuCloseSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:close-session', listener);
    return () => ipcRenderer.removeListener('menu:close-session', listener);
  },
});
