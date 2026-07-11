import { IpcChannels } from '../shared/ipc';
import type { IpcInvokeMap, IpcPushMap } from '../shared/ipc';

// Typed renderer side of the IPC seam. Channel names, payloads, and responses
// all come from the registry in shared/ipc.ts — a new channel is declared
// there once and is immediately callable here with full types.

export { IpcChannels };

export function invoke<C extends keyof IpcInvokeMap>(
  channel: C,
  ...args: IpcInvokeMap[C]['payload'] extends void ? [] : [IpcInvokeMap[C]['payload']]
): Promise<IpcInvokeMap[C]['response']> {
  return window.chorusIpc.invoke(channel, args[0]) as Promise<IpcInvokeMap[C]['response']>;
}

export function on<C extends keyof IpcPushMap>(
  channel: C,
  callback: (payload: IpcPushMap[C]) => void,
): () => void {
  return window.chorusIpc.on(channel, callback as (payload: unknown) => void);
}
