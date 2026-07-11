// The raw bridge exposed by preload. Renderer code should not use this
// directly — go through src/renderer/ipc.ts, which layers the channel types
// from IpcInvokeMap/IpcPushMap on top.
declare global {
  interface Window {
    chorusIpc: {
      invoke: (channel: string, payload?: unknown) => Promise<unknown>;
      on: (channel: string, callback: (payload: unknown) => void) => () => void;
    };
  }
}

export {};
