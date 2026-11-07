import { describe, it, expect } from 'vitest';
import { matchScore, filterPaletteItems } from '../src/renderer/palette-match';

describe('matchScore', () => {
  it('matches everything with an empty query', () => {
    expect(matchScore('anything', '')).toBe(0);
    expect(matchScore('anything', '   ')).toBe(0);
  });

  it('ignores case', () => {
    expect(matchScore('Fix Login Bug', 'fix')).not.toBeNull();
    expect(matchScore('fix-login-bug', 'LOGIN')).not.toBeNull();
  });

  it('ranks prefix over word start over substring over scattered letters', () => {
    const prefix = matchScore('login-page', 'log');
    const wordStart = matchScore('fix-login', 'log');
    const substring = matchScore('catalog', 'log');
    const subsequence = matchScore('large-object-graph', 'log');
    expect(prefix).toBeGreaterThan(wordStart!);
    expect(wordStart).toBeGreaterThan(substring!);
    expect(substring).toBeGreaterThan(subsequence!);
  });

  it('treats spaces, dashes, underscores, dots and slashes as word breaks', () => {
    const wordStart = matchScore('fix-login', 'log');
    for (const text of ['fix login', 'fix_login', 'fix.login', 'fix/login']) {
      expect(matchScore(text, 'log')).toBe(wordStart);
    }
  });

  it('rejects text missing any query letter in order', () => {
    expect(matchScore('api-refactor', 'xyz')).toBeNull();
    expect(matchScore('abc', 'cba')).toBeNull();
  });
});

describe('filterPaletteItems', () => {
  const items = [
    { id: '1', group: 'Sessions', title: 'api-refactor', subtitle: '~/code/api-server' },
    { id: '2', group: 'Sessions', title: 'fix-login-bug', subtitle: '~/code/web-app' },
    { id: '3', group: 'Actions', title: 'New Session' },
    { id: '4', group: 'Actions', title: 'Preferences…', keywords: 'settings theme font' },
  ];
  const ids = (list: { id: string }[]) => list.map((i) => i.id);

  it('keeps every item in its original order without a query', () => {
    expect(ids(filterPaletteItems(items, ''))).toEqual(['1', '2', '3', '4']);
  });

  it('drops items that match nowhere', () => {
    expect(ids(filterPaletteItems(items, 'login'))).toEqual(['2']);
  });

  it('matches the subtitle and keywords too', () => {
    expect(ids(filterPaletteItems(items, 'web-app'))).toEqual(['2']);
    expect(ids(filterPaletteItems(items, 'theme'))).toEqual(['4']);
  });

  it('keeps groups in their original order and ranks within each group', () => {
    const result = filterPaletteItems(
      [
        { id: 'a', group: 'Sessions', title: 'catalog' },
        { id: 'b', group: 'Sessions', title: 'log-viewer' },
        { id: 'c', group: 'Actions', title: 'Show Log' },
      ],
      'log',
    );
    expect(ids(result)).toEqual(['b', 'a', 'c']);
  });

  it('ranks a title hit above a subtitle-only hit', () => {
    const result = filterPaletteItems(
      [
        { id: 'sub', group: 'Sessions', title: 'alpha', subtitle: '~/web' },
        { id: 'title', group: 'Sessions', title: 'web-app' },
      ],
      'web',
    );
    expect(ids(result)).toEqual(['title', 'sub']);
  });
});
