import type { PrRef } from './types';

const PR_URL = String.raw`https://github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)`;
// A whole field may carry a trailing path/query/fragment
// (e.g. ".../pull/12/files", ".../pull/12#discussion_r1").
const WHOLE_PR_URL_RE = new RegExp(`^${PR_URL}(?:[/?#].*)?$`);
const PR_URL_IN_TEXT_RE = new RegExp(PR_URL, 'g');

function prRefFrom(match: RegExpMatchArray): PrRef {
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function parsePrUrl(url: string): PrRef | null {
  const match = url.trim().match(WHOLE_PR_URL_RE);
  return match ? prRefFrom(match) : null;
}

/** Every GitHub PR URL in free text (command output, an error message), in order. */
export function findPrUrls(text: string): PrRef[] {
  return Array.from(text.matchAll(PR_URL_IN_TEXT_RE), prRefFrom);
}

export function prUrl(pr: PrRef): string {
  return `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
}

/** "owner/repo#123" */
export function prLabel(pr: PrRef): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

/** A PR's identity as a string. GitHub treats owner and repo names case-insensitively. */
export function prKey(pr: PrRef): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
}

export function samePr(a: PrRef, b: PrRef): boolean {
  return prKey(a) === prKey(b);
}
