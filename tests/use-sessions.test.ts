import { describe, it, expect } from 'vitest';
import {
  activeIdAfterEnd,
  activeIdAfterLoad,
  countNeedingAttention,
  findNextNeedingAttention,
  mergeLoadedSessions,
} from '../src/renderer/use-sessions';
import type { Session } from '../src/shared/types';

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    cwd: '/tmp',
    worktree: null,
    status: 'idle',
    model: null,
    contextUsage: null,
    contextLimit: null,
    flags: [],
    notifyOnIdle: false,
    unread: false,
    createdAt: 0,
    lastActiveAt: 0,
    hasUserInput: true,
    prs: [],
    ...overrides,
  };
}

const ids = (s: Session | null) => s?.id ?? null;

describe('findNextNeedingAttention', () => {
  it('finds the next unread session after the active one', () => {
    const sessions = [
      makeSession('a'),
      makeSession('b'),
      makeSession('c', { unread: true }),
    ];
    expect(ids(findNextNeedingAttention(sessions, 'a'))).toBe('c');
  });

  it('treats a session waiting on the user as needing attention', () => {
    const sessions = [makeSession('a'), makeSession('b', { status: 'waiting' })];
    expect(ids(findNextNeedingAttention(sessions, 'a'))).toBe('b');
  });

  it('wraps around to the start of the list', () => {
    const sessions = [
      makeSession('a', { unread: true }),
      makeSession('b'),
      makeSession('c'),
    ];
    expect(ids(findNextNeedingAttention(sessions, 'b'))).toBe('a');
  });

  it('cycles in sidebar order across repeated jumps', () => {
    const sessions = [
      makeSession('a', { unread: true }),
      makeSession('b'),
      makeSession('c', { status: 'waiting' }),
    ];
    expect(ids(findNextNeedingAttention(sessions, 'a'))).toBe('c');
    expect(ids(findNextNeedingAttention(sessions, 'c'))).toBe('a');
  });

  it('never returns the active session itself', () => {
    const sessions = [makeSession('a', { status: 'waiting' }), makeSession('b')];
    expect(findNextNeedingAttention(sessions, 'a')).toBeNull();
  });

  it('ignores sessions that are merely working or idle', () => {
    const sessions = [
      makeSession('a'),
      makeSession('b', { status: 'generating' }),
      makeSession('c', { status: 'thinking' }),
    ];
    expect(findNextNeedingAttention(sessions, 'a')).toBeNull();
  });

  it('starts from the top when no session is active', () => {
    const sessions = [makeSession('a', { unread: true }), makeSession('b', { unread: true })];
    expect(ids(findNextNeedingAttention(sessions, null))).toBe('a');
  });

  it('returns null for an empty list', () => {
    expect(findNextNeedingAttention([], null)).toBeNull();
  });
});

describe('countNeedingAttention', () => {
  it('counts unread and waiting sessions', () => {
    const sessions = [
      makeSession('a'),
      makeSession('b', { unread: true }),
      makeSession('c', { status: 'waiting' }),
      makeSession('d', { status: 'generating' }),
    ];
    expect(countNeedingAttention(sessions, 'a')).toBe(2);
  });

  it('leaves out the active session, which you are already looking at', () => {
    const sessions = [makeSession('a', { status: 'waiting' }), makeSession('b', { unread: true })];
    expect(countNeedingAttention(sessions, 'a')).toBe(1);
    expect(countNeedingAttention(sessions, null)).toBe(2);
  });
});

describe('mergeLoadedSessions', () => {
  const sessionIds = (list: Session[]) => list.map((s) => s.id);

  it('keeps a session that arrived ahead of a list without it', () => {
    const merged = mergeLoadedSessions([makeSession('a')], [makeSession('reopened')]);
    expect(sessionIds(merged)).toEqual(['a', 'reopened']);
  });

  it('lists a session the list already has only once, as listed', () => {
    const listed = makeSession('a', { status: 'idle' });
    const merged = mergeLoadedSessions([listed], [makeSession('a', { status: 'creating' })]);
    expect(merged).toEqual([listed]);
  });

  it('is the list itself when nothing arrived ahead of it', () => {
    expect(sessionIds(mergeLoadedSessions([makeSession('a'), makeSession('b')], []))).toEqual(['a', 'b']);
  });
});

describe('activeIdAfterLoad', () => {
  const list = [makeSession('a'), makeSession('b'), makeSession('c')];

  it('keeps a session picked while the list loaded over the saved one', () => {
    expect(activeIdAfterLoad(list, 'c', 'b')).toBe('c');
  });

  it('falls back to the saved session when the pick is not listed', () => {
    expect(activeIdAfterLoad(list, 'gone', 'b')).toBe('b');
  });

  it('keeps the saved session when it came back and nothing was picked', () => {
    expect(activeIdAfterLoad(list, null, 'b')).toBe('b');
  });

  it('falls back to the first session when the saved one is gone', () => {
    expect(activeIdAfterLoad(list, null, 'gone')).toBe('a');
  });

  it('falls back to the first session when none was picked or saved', () => {
    expect(activeIdAfterLoad(list, null, null)).toBe('a');
  });

  it('is null when nothing came back', () => {
    expect(activeIdAfterLoad([], 'gone', 'gone')).toBeNull();
  });
});

describe('activeIdAfterEnd', () => {
  const list = [makeSession('a'), makeSession('b'), makeSession('c')];

  it('hands over to the first session in the sidebar', () => {
    expect(activeIdAfterEnd(list, 'b')).toBe('a');
  });

  it('skips the ended session when it was first', () => {
    expect(activeIdAfterEnd(list, 'a')).toBe('b');
  });

  it('is null when the ended session was the only one', () => {
    expect(activeIdAfterEnd([makeSession('a')], 'a')).toBeNull();
  });
});
