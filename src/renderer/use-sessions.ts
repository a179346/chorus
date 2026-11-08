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

/**
 * The first list plus sessions that arrived ahead of it (one reopened as main
 * finished restoring), which it may not include.
 */
export function mergeLoadedSessions(
  listed: readonly Session[],
  arrivedEarlier: readonly Session[],
): Session[] {
  const listedIds = new Set(listed.map((s) => s.id));
  return [...listed, ...arrivedEarlier.filter((s) => !listedIds.has(s.id))];
}

/**
 * Once the saved sessions are listed: the session picked while they loaded if
 * listed, else the saved last-active one if listed, else the first.
 */
export function activeIdAfterLoad(
  list: readonly Session[],
  pickedId: string | null,
  savedId: string | null,
): string | null {
  const isListed = (id: string | null) => list.some((s) => s.id === id);
  return [pickedId, savedId].find(isListed) ?? list[0]?.id ?? null;
}

/** Who takes over when the active session ends: the first other one in the sidebar. */
export function activeIdAfterEnd(list: readonly Session[], endedId: string): string | null {
  return list.find((s) => s.id !== endedId)?.id ?? null;
}

/** useState whose ref holds the latest value at once, ahead of the re-render that shows it. */
function useLatestState<T>(initial: T): [T, { readonly current: T }, (next: T) => void] {
  const [state, setState] = useState(initial);
  const latestRef = useRef(initial);
  const set = useCallback((next: T) => {
    latestRef.current = next;
    setState(next);
  }, []);
  return [state, latestRef, set];
}

/**
 * The renderer's copy of session state. Loads the initial list, merges
 * SESSION_STATE pushes from main in one place, and exposes every session
 * operation the UI needs. Pushes carry only SESSION_SYNC_FIELDS, merged
 * generically without a per-field case; any other field keeps the value the
 * session arrived with, so a field the UI must see change belongs in that list.
 */
export function useSessions() {
  const [sessions, sessionsRef, setSessions] = useLatestState<Session[]>([]);
  // Main answers the first list only after restoring saved sessions, which
  // waits on the login-shell environment
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // May name a session that isn't listed yet: main can reveal one before the
  // first list arrives, and the load keeps that pick. Only a listed one
  // becomes the active session, so nothing acts on a session this list
  // doesn't have.
  const [wantedActiveId, wantedActiveIdRef, setWantedActiveId] = useLatestState<string | null>(null);

  const activeSession = sessions.find((s) => s.id === wantedActiveId) ?? null;
  const activeSessionId = activeSession?.id ?? null;

  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // The single merge point for state pushed from main
  useEffect(() => {
    return on(IpcChannels.SESSION_STATE, ({ sessionId, ...fields }) => {
      setSessions(sessionsRef.current.map((s) => (s.id === sessionId ? { ...s, ...fields } : s)));
    });
  }, [setSessions, sessionsRef]);

  // Main tracks the active session too: it saves it, and never marks the one
  // you're looking at unread
  const selectSession = useCallback(
    (id: string) => {
      setWantedActiveId(id);
      void invoke(IpcChannels.SESSION_SWITCH, { id });
    },
    [setWantedActiveId],
  );

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
    [selectSession, setWantedActiveId],
  );

  /** A session main just started (created, or reopened on its own) joins the list as the active one. */
  const addAndSelect = useCallback(
    (session: Session) => {
      setSessions([...sessionsRef.current, session]);
      selectSession(session.id);
    },
    [setSessions, sessionsRef, selectSession],
  );

  // Initial load. Keeps what came ahead of the list: sessions main opened, and
  // the session picked meanwhile. Reads them through refs, as it can run right
  // after such a push, before React re-renders.
  useEffect(() => {
    void Promise.all([invoke(IpcChannels.SESSION_LIST), invoke(IpcChannels.APP_GET_STATE)]).then(
      ([list, state]) => {
        const loaded = mergeLoadedSessions(list, sessionsRef.current);
        setSessions(loaded);
        setSessionsLoaded(true);
        activate(activeIdAfterLoad(loaded, wantedActiveIdRef.current, state.lastActiveSessionId));
      },
    );
  }, [activate, setSessions, sessionsRef, wantedActiveIdRef]);

  // Sessions main brings forward (notification click) or launches itself (reopen)
  useEffect(() => {
    const cleanups = [
      on(IpcChannels.SESSION_REVEAL, ({ id }) => selectSession(id)),
      on(IpcChannels.SESSION_OPENED, addAndSelect),
    ];
    return () => cleanups.forEach((c) => c());
  }, [selectSession, addAndSelect]);

  // Main saves the new-session defaults itself
  const createSession = useCallback(
    async (input: NewSessionInput): Promise<Session> => {
      const session = await invoke(IpcChannels.SESSION_CREATE, {
        name: input.name,
        cwd: input.cwd,
        worktree: input.worktree || undefined,
        flags: input.flags,
        notifyOnIdle: input.notifyOnIdle,
        prUrls: input.prUrls,
        prompt: input.prompt || undefined,
      });
      addAndSelect(session);
      return session;
    },
    [addAndSelect],
  );

  const endSession = useCallback(
    async (id: string): Promise<void> => {
      await invoke(IpcChannels.SESSION_END, { id });
      setSessions(sessionsRef.current.filter((s) => s.id !== id));
      if (activeSessionIdRef.current === id) activate(activeIdAfterEnd(sessionsRef.current, id));
    },
    [activate, setSessions, sessionsRef],
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

  const reorderSessions = useCallback(
    (reordered: Session[]) => {
      setSessions(reordered);
      void invoke(IpcChannels.SESSION_REORDER, {
        sessionIds: reordered.map((s) => s.id),
      });
    },
    [setSessions],
  );

  const switchToIndex = useCallback(
    (index: number) => {
      const target = sessionsRef.current[index];
      if (target) selectSession(target.id);
    },
    [selectSession, sessionsRef],
  );

  const switchRelative = useCallback(
    (offset: 1 | -1) => {
      const list = sessionsRef.current;
      if (list.length <= 1) return;
      const idx = list.findIndex((s) => s.id === activeSessionIdRef.current);
      const next = (idx + offset + list.length) % list.length;
      selectSession(list[next].id);
    },
    [selectSession, sessionsRef],
  );

  const switchToNextNeedingAttention = useCallback(() => {
    const target = findNextNeedingAttention(sessionsRef.current, activeSessionIdRef.current);
    if (target) selectSession(target.id);
  }, [selectSession, sessionsRef]);

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
