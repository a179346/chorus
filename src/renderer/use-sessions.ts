import { useState, useEffect, useCallback, useRef } from 'react';
import type { PrRef, Session } from '../shared/types';
import { invoke, on, IpcChannels } from './ipc';

export interface NewSessionInput {
  name: string;
  cwd: string;
  worktree: string;
  flags: string[];
  notifyOnIdle: boolean;
  prUrls: string[];
  /** Empty for none. */
  prompt: string;
}

/** New output you haven't seen, or Claude blocked until you respond. */
function needsAttention(session: Session): boolean {
  return session.unread || session.status === 'waiting';
}

/** Sessions other than the active one that want you — what ⌘J cycles through. */
export function countNeedingAttention(sessions: Session[], activeId: string | null): number {
  return sessions.filter((s) => s.id !== activeId && needsAttention(s)).length;
}

/**
 * The next session after the active one, in sidebar order and wrapping
 * around, that needs attention. Never the active session itself.
 */
export function findNextNeedingAttention(
  sessions: Session[],
  activeId: string | null,
): Session | null {
  const start = sessions.findIndex((s) => s.id === activeId);
  for (let step = 1; step <= sessions.length; step++) {
    const candidate = sessions[(start + step) % sessions.length];
    if (candidate.id !== activeId && needsAttention(candidate)) return candidate;
  }
  return null;
}

/** Once the saved sessions are listed: the wanted one if it came back, else the first. */
export function activeIdAfterLoad(list: readonly Session[], wantedId: string | null): string | null {
  return list.some((s) => s.id === wantedId) ? wantedId : list[0]?.id ?? null;
}

/** Who takes over when the active session ends: the first other one in the sidebar. */
export function activeIdAfterEnd(list: readonly Session[], endedId: string): string | null {
  return list.find((s) => s.id !== endedId)?.id ?? null;
}

/**
 * The renderer's copy of session state. Loads the initial list, merges
 * SESSION_STATE pushes from main in one place, and exposes every session
 * operation the UI needs. Pushes carry only SESSION_SYNC_FIELDS, merged
 * generically without a per-field case; any other field keeps the value the
 * session arrived with, so a field the UI must see change belongs in that list.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  // Main answers the first list only after restoring saved sessions, which
  // waits on the login-shell environment
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // May name a session that isn't listed yet: main can reveal one before the
  // first list arrives. Only a listed one becomes the active session, so
  // nothing acts on a session this list doesn't have.
  const [wantedActiveId, setWantedActiveId] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.id === wantedActiveId) ?? null;
  const activeSessionId = activeSession?.id ?? null;

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // The single merge point for state pushed from main
  useEffect(() => {
    return on(IpcChannels.SESSION_STATE, ({ sessionId, ...fields }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, ...fields } : s)),
      );
    });
  }, []);

  // Main tracks the active session too: it saves it, and never marks the one
  // you're looking at unread
  const selectSession = useCallback((id: string) => {
    setWantedActiveId(id);
    void invoke(IpcChannels.SESSION_SWITCH, { id });
  }, []);

  /** Makes the renderer's own pick active (after loading, after an end), or none; main hears either way. */
  const activate = useCallback(
    (id: string | null) => {
      if (id) {
        selectSession(id);
        return;
      }
      setWantedActiveId(null);
      void invoke(IpcChannels.APP_SAVE_STATE, { lastActiveSessionId: null });
    },
    [selectSession],
  );

  // Initial load
  useEffect(() => {
    void Promise.all([invoke(IpcChannels.SESSION_LIST), invoke(IpcChannels.APP_GET_STATE)]).then(
      ([list, state]) => {
        setSessions(list);
        setSessionsLoaded(true);
        activate(activeIdAfterLoad(list, state.lastActiveSessionId));
      },
    );
  }, [activate]);

  // Sessions main brings forward (notification click) or launches itself (reopen)
  useEffect(() => {
    const cleanups = [
      on(IpcChannels.SESSION_REVEAL, ({ id }) => selectSession(id)),
      on(IpcChannels.SESSION_OPENED, (session) => {
        setSessions((prev) => [...prev, session]);
        selectSession(session.id);
      }),
    ];
    return () => cleanups.forEach((c) => c());
  }, [selectSession]);

  const createSession = useCallback(async (input: NewSessionInput): Promise<Session> => {
    const session = await invoke(IpcChannels.SESSION_CREATE, {
      name: input.name,
      cwd: input.cwd,
      worktree: input.worktree || undefined,
      flags: input.flags,
      notifyOnIdle: input.notifyOnIdle,
      prUrls: input.prUrls,
      prompt: input.prompt || undefined,
    });
    setSessions((prev) => [...prev, session]);
    // Main made it active when it created it
    setWantedActiveId(session.id);
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

  const endSession = useCallback(
    async (id: string): Promise<void> => {
      await invoke(IpcChannels.SESSION_END, { id });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionIdRef.current === id) activate(activeIdAfterEnd(sessionsRef.current, id));
    },
    [activate],
  );

  // The new status comes back through the SESSION_STATE merge
  const restartSession = useCallback(
    (id: string): Promise<Session> => invoke(IpcChannels.SESSION_RESTART, { id }),
    [],
  );

  // The updated PR list comes back through the SESSION_STATE merge
  const linkPr = useCallback(
    (id: string, url: string): Promise<Session> => invoke(IpcChannels.SESSION_LINK_PR, { id, url }),
    [],
  );

  const unlinkPr = useCallback(
    (id: string, pr: PrRef): Promise<Session> => invoke(IpcChannels.SESSION_UNLINK_PR, { id, pr }),
    [],
  );

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

  const switchToNextNeedingAttention = useCallback(() => {
    const target = findNextNeedingAttention(sessionsRef.current, activeSessionIdRef.current);
    if (target) selectSession(target.id);
  }, [selectSession]);

  return {
    sessions,
    sessionsLoaded,
    activeSession,
    activeSessionId,
    activeSessionIdRef,
    selectSession,
    createSession,
    endSession,
    restartSession,
    linkPr,
    unlinkPr,
    toggleNotify,
    renameSession,
    reorderSessions,
    switchToIndex,
    switchRelative,
    switchToNextNeedingAttention,
  };
}
