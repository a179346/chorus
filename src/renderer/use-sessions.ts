import { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '../shared/types';
import { invoke, on, IpcChannels } from './ipc';

export interface NewSessionInput {
  name: string;
  cwd: string;
  worktree: string;
  flags: string[];
  notifyOnIdle: boolean;
  prUrl: string;
}

/**
 * The renderer's copy of session state. Loads the initial list, merges
 * SESSION_STATE pushes from main in one place (generically — any field the
 * main process commits lands here without a per-field case), and exposes
 * every session operation the UI needs.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Initial load
  useEffect(() => {
    void invoke(IpcChannels.SESSION_LIST).then((list) => {
      setSessions(list);
      setActiveSessionId((current) => current ?? list[0]?.id ?? null);
    });
  }, []);

  // The single merge point for state pushed from main
  useEffect(() => {
    return on(IpcChannels.SESSION_STATE, ({ sessionId, ...fields }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, ...fields } : s)),
      );
    });
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    void invoke(IpcChannels.SESSION_SWITCH, { id });
    void invoke(IpcChannels.APP_SAVE_STATE, { lastActiveSessionId: id });
  }, []);

  const createSession = useCallback(async (input: NewSessionInput): Promise<Session> => {
    const session = await invoke(IpcChannels.SESSION_CREATE, {
      name: input.name,
      cwd: input.cwd,
      worktree: input.worktree || undefined,
      flags: input.flags,
      notifyOnIdle: input.notifyOnIdle,
      prUrl: input.prUrl || undefined,
    });
    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
    void invoke(IpcChannels.APP_SAVE_STATE, {
      lastActiveSessionId: session.id,
      newSessionDefaults: {
        cwd: input.cwd,
        flags: input.flags,
        notifyOnIdle: input.notifyOnIdle,
      },
    });
    return session;
  }, []);

  const endSession = useCallback(async (id: string): Promise<void> => {
    await invoke(IpcChannels.SESSION_END, { id });
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (activeSessionIdRef.current === id) {
        setActiveSessionId(filtered[0]?.id ?? null);
      }
      return filtered;
    });
  }, []);

  // notifyOnIdle and name changes come back through the SESSION_STATE merge
  const toggleNotify = useCallback((id: string) => {
    void invoke(IpcChannels.SESSION_TOGGLE_NOTIFY, { id });
  }, []);

  const renameSession = useCallback((id: string, name: string) => {
    void invoke(IpcChannels.SESSION_RENAME, { id, name });
  }, []);

  const reorderSessions = useCallback((reordered: Session[]) => {
    setSessions(reordered);
    void invoke(IpcChannels.SESSION_REORDER, {
      sessionIds: reordered.map((s) => s.id),
    });
  }, []);

  const switchToIndex = useCallback(
    (index: number) => {
      const target = sessionsRef.current[index];
      if (target) selectSession(target.id);
    },
    [selectSession],
  );

  const switchRelative = useCallback(
    (offset: 1 | -1) => {
      const list = sessionsRef.current;
      if (list.length <= 1) return;
      const idx = list.findIndex((s) => s.id === activeSessionIdRef.current);
      const next = (idx + offset + list.length) % list.length;
      selectSession(list[next].id);
    },
    [selectSession],
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  return {
    sessions,
    activeSession,
    activeSessionId,
    activeSessionIdRef,
    setActiveSessionId,
    selectSession,
    createSession,
    endSession,
    toggleNotify,
    renameSession,
    reorderSessions,
    switchToIndex,
    switchRelative,
  };
}
