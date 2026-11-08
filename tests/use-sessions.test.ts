import { describe, it, expect } from 'vitest';
import { countNeedingAttention, findNextNeedingAttention } from '../src/renderer/use-sessions';
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
