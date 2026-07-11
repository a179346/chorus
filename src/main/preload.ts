import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipc';

// Generic bridge over the channel registry in shared/ipc.ts. Type safety for
// payloads and responses lives in src/renderer/ipc.ts, derived from
// IpcInvokeMap/IpcPushMap — declaring a channel there is all it takes.

const KNOWN_CHANNELS = new Set<string>(Object.values(IpcChannels));

function assertKnown(channel: string): void {
  if (!KNOWN_CHANNELS.has(channel)) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }
}

contextBridge.exposeInMainWorld('chorusIpc', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    assertKnown(channel);
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel: string, callback: (payload: unknown) => void): (() => void) => {
    assertKnown(channel);
    const listener = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
