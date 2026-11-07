import { describe, it, expect } from 'vitest';
import { prTooltip, summaryStage } from '../src/renderer/session-presentation';
import type { LinkedPr, PrStage } from '../src/shared/types';

const prsWith = (...stages: PrStage[]): LinkedPr[] =>
  stages.map((stage, i) => ({ owner: 'o', repo: 'r', number: i + 1, stage, stageUpdatedAt: null }));

describe('summaryStage', () => {
  it('is null without PRs', () => {
    expect(summaryStage([])).toBeNull();
  });

  it('lets an open PR outrank finished ones', () => {
    expect(summaryStage(prsWith('merged', 'closed', 'draft'))).toBe('draft');
    expect(summaryStage(prsWith('draft', 'ready', 'merged'))).toBe('ready');
  });

  it('prefers merged over closed when nothing is open', () => {
    expect(summaryStage(prsWith('closed', 'merged'))).toBe('merged');
  });

  it('shows unknown only when no PR has resolved', () => {
    expect(summaryStage(prsWith('unknown', 'closed'))).toBe('closed');
    expect(summaryStage(prsWith('unknown', 'unknown'))).toBe('unknown');
  });
});

describe('prTooltip', () => {
  it('names the PR and its stage', () => {
    expect(prTooltip(prsWith('ready')[0])).toBe('o/r#1 · Ready for review');
  });
});
