import { describe, it, expect } from 'vitest';
import { parsePrUrl } from '../src/shared/pr-url';

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
