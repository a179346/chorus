import { describe, it, expect } from 'vitest';
import { wordScore, filterPaletteItems } from '../src/renderer/palette-match';

describe('wordScore', () => {
  it('ignores case', () => {
    expect(wordScore('Fix Login Bug', 'fix')).not.toBeNull();
    expect(wordScore('fix-login-bug', 'LOGIN')).not.toBeNull();
  });

  it('ranks prefix over word start over substring over scattered letters', () => {
    const prefix = wordScore('login-page', 'log');
    const wordStart = wordScore('fix-login', 'log');
    const substring = wordScore('catalog', 'log');
    const subsequence = wordScore('large-object-graph', 'log');
    expect(prefix).toBeGreaterThan(wordStart!);
    expect(wordStart).toBeGreaterThan(substring!);
    expect(substring).toBeGreaterThan(subsequence!);
  });

  it('treats spaces, dashes, underscores, dots and slashes as word breaks', () => {
    const wordStart = wordScore('fix-login', 'log');
    for (const text of ['fix login', 'fix_login', 'fix.login', 'fix/login']) {
      expect(wordScore(text, 'log')).toBe(wordStart);
    }
  });

  it('rejects text missing any letter of the word in order', () => {
    expect(wordScore('api-refactor', 'xyz')).toBeNull();
    expect(wordScore('abc', 'cba')).toBeNull();
  });

  it('counts an emoji as one character when matching scattered letters', () => {
    expect(wordScore('ship 🚀 to prod', 's🚀p')).not.toBeNull();
    expect(wordScore('ship to prod', 's🚀p')).toBeNull();
  });

  it('matches composed and decomposed accents alike', () => {
    const composed = 'café';
    const decomposed = 'café';
    expect(wordScore(`${composed}-menu`, decomposed)).toBe(wordScore('cafe-menu', 'cafe'));
    expect(wordScore(`${decomposed}-menu`, composed)).toBe(wordScore('cafe-menu', 'cafe'));
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
    expect(ids(filterPaletteItems(items, '   '))).toEqual(['1', '2', '3', '4']);
  });

  it('drops items that match nowhere', () => {
    expect(ids(filterPaletteItems(items, 'login'))).toEqual(['2']);
  });

  it('matches the subtitle and keywords too', () => {
    expect(ids(filterPaletteItems(items, 'web-app'))).toEqual(['2']);
    expect(ids(filterPaletteItems(items, 'theme'))).toEqual(['4']);
  });

  it('matches several words in any order, each anywhere in the item', () => {
    expect(ids(filterPaletteItems(items, 'login bug'))).toEqual(['2']);
    expect(ids(filterPaletteItems(items, 'bug login'))).toEqual(['2']);
    expect(ids(filterPaletteItems(items, 'fix web'))).toEqual(['2']);
    expect(ids(filterPaletteItems(items, 'login xyz'))).toEqual([]);
  });

  it('ranks a several-word match by its weakest word', () => {
    const result = filterPaletteItems(
      [
        { id: 'subtitle-hit', group: 'Actions', title: 'Rename Session…', subtitle: 'api' },
        { id: 'title-hits', group: 'Actions', title: 'Rename api' },
      ],
      'rename api',
    );
    expect(ids(result)).toEqual(['title-hits', 'subtitle-hit']);
  });

  it('leads with the group holding the best match', () => {
    // "end" is only a keyword (the status) of the ended session, but the title of the action
    const result = filterPaletteItems(
      [
        { id: 'ended-session', group: 'Sessions', title: 'api-refactor', keywords: 'Ended' },
        { id: 'end-action', group: 'Actions', title: 'End Session…', subtitle: 'api-refactor' },
      ],
      'end',
    );
    expect(ids(result)).toEqual(['end-action', 'ended-session']);
  });

  it('keeps each group together, ranked within', () => {
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

  it('keeps the original group order when the best matches tie', () => {
    const result = filterPaletteItems(
      [
        { id: 'session', group: 'Sessions', title: 'deploy' },
        { id: 'action', group: 'Actions', title: 'Deploy Preview' },
      ],
      'deploy',
    );
    expect(ids(result)).toEqual(['session', 'action']);
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
