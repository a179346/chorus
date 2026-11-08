import { describe, it, expect } from 'vitest';
import { findPrUrls, parsePrUrl, prKey, prLabel, prUrl, samePr } from '../src/shared/pr-ref';
import type { LinkedPr } from '../src/shared/types';

describe('parsePrUrl', () => {
  it('parses a plain PR URL', () => {
    expect(parsePrUrl('https://github.com/a179346/chorus/pull/47')).toEqual({
      owner: 'a179346',
      repo: 'chorus',
      number: 47,
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePrUrl('  https://github.com/foo/bar/pull/1 ')).toEqual({
      owner: 'foo',
      repo: 'bar',
      number: 1,
    });
  });

  it('accepts trailing path, query, and fragment', () => {
    expect(parsePrUrl('https://github.com/foo/bar/pull/12/files')?.number).toBe(12);
    expect(parsePrUrl('https://github.com/foo/bar/pull/12?diff=split')?.number).toBe(12);
    expect(parsePrUrl('https://github.com/foo/bar/pull/12#discussion_r1')?.number).toBe(12);
  });

  it('accepts dots and dashes in owner/repo', () => {
    expect(parsePrUrl('https://github.com/my-org/my.repo-x/pull/3')).toEqual({
      owner: 'my-org',
      repo: 'my.repo-x',
      number: 3,
    });
  });

  it('rejects non-PR GitHub URLs', () => {
    expect(parsePrUrl('https://github.com/foo/bar')).toBeNull();
    expect(parsePrUrl('https://github.com/foo/bar/issues/12')).toBeNull();
    expect(parsePrUrl('https://github.com/foo/bar/pull/')).toBeNull();
  });

  it('rejects non-GitHub hosts and garbage', () => {
    expect(parsePrUrl('https://gitlab.com/foo/bar/pull/12')).toBeNull();
    expect(parsePrUrl('http://github.com/foo/bar/pull/12')).toBeNull();
    expect(parsePrUrl('not a url')).toBeNull();
    expect(parsePrUrl('')).toBeNull();
  });
});

describe('findPrUrls', () => {
  it('finds every PR URL in free text, in order', () => {
    const text = 'Created https://github.com/o/r/pull/1 (see https://github.com/my-org/my.repo/pull/22/files).';
    expect(findPrUrls(text)).toEqual([
      { owner: 'o', repo: 'r', number: 1 },
      { owner: 'my-org', repo: 'my.repo', number: 22 },
    ]);
  });

  it('skips links that are not a numbered PR', () => {
    expect(findPrUrls('remote: https://github.com/o/r/pull/new/feat\nhttps://github.com/o/r/issues/3')).toEqual([]);
  });

  it('returns nothing for text without a PR URL', () => {
    expect(findPrUrls('')).toEqual([]);
  });
});

describe('prUrl / prLabel', () => {
  const pr = { owner: 'a179346', repo: 'chorus', number: 47 };

  it('formats the canonical URL, which parses back to the same ref', () => {
    expect(prUrl(pr)).toBe('https://github.com/a179346/chorus/pull/47');
    expect(parsePrUrl(prUrl(pr))).toEqual(pr);
  });

  it('formats a short label', () => {
    expect(prLabel(pr)).toBe('a179346/chorus#47');
  });
});

describe('prKey', () => {
  it('is the same for refs that differ only in owner/repo case', () => {
    expect(prKey({ owner: 'Foo', repo: 'Bar', number: 1 })).toBe(prKey({ owner: 'foo', repo: 'bar', number: 1 }));
  });

  it('differs between PRs', () => {
    expect(prKey({ owner: 'o', repo: 'r', number: 1 })).not.toBe(prKey({ owner: 'o', repo: 'r', number: 2 }));
    expect(prKey({ owner: 'o', repo: 'r1', number: 1 })).not.toBe(prKey({ owner: 'o1', repo: 'r', number: 1 }));
  });
});

describe('samePr', () => {
  it('matches owner and repo case-insensitively', () => {
    expect(samePr({ owner: 'Foo', repo: 'Bar', number: 1 }, { owner: 'foo', repo: 'bar', number: 1 })).toBe(true);
  });

  it('distinguishes number, repo, and owner', () => {
    const pr = { owner: 'o', repo: 'r', number: 1 };
    expect(samePr(pr, { ...pr, number: 2 })).toBe(false);
    expect(samePr(pr, { ...pr, repo: 'x' })).toBe(false);
    expect(samePr(pr, { ...pr, owner: 'x' })).toBe(false);
  });

  it('compares a linked PR by identity only, ignoring its stage', () => {
    const linked: LinkedPr = { owner: 'o', repo: 'r', number: 1, stage: 'ready', stageUpdatedAt: 5 };
    expect(samePr({ owner: 'o', repo: 'r', number: 1 }, linked)).toBe(true);
  });
});
