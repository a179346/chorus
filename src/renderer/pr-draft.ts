import type { PrRef } from '../shared/types';
import { parsePrUrl, samePr } from '../shared/pr-ref';

/** What the user has typed into a PR URL field, judged against the PRs already listed. */
export type PrDraft =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'duplicate' }
  | { kind: 'ok'; pr: PrRef };

export function readPrDraft(value: string, linked: readonly PrRef[]): PrDraft {
  if (value.trim() === '') return { kind: 'empty' };
  const pr = parsePrUrl(value);
  if (!pr) return { kind: 'invalid' };
  if (linked.some((p) => samePr(p, pr))) return { kind: 'duplicate' };
  return { kind: 'ok', pr };
}
