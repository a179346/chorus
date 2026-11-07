import { describe, it, expect } from 'vitest';
import { readPrDraft } from '../src/renderer/pr-draft';

describe('readPrDraft', () => {
  const linked = [{ owner: 'o', repo: 'r', number: 1 }];

  it('treats a blank field as empty', () => {
    expect(readPrDraft('   ', linked)).toEqual({ kind: 'empty' });
  });

  it('flags text that is not a GitHub PR URL', () => {
    expect(readPrDraft('https://github.com/o/r/issues/2', linked)).toEqual({ kind: 'invalid' });
  });

  it('flags a PR that is already listed, whatever the case or URL suffix', () => {
    expect(readPrDraft('https://github.com/O/R/pull/1/files', linked)).toEqual({ kind: 'duplicate' });
  });

  it('accepts a new PR', () => {
    expect(readPrDraft(' https://github.com/o/r/pull/2 ', linked)).toEqual({
      kind: 'ok',
      pr: { owner: 'o', repo: 'r', number: 2 },
    });
  });
});
