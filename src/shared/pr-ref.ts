import type { PrRef } from './types';

// Accepts a GitHub PR URL, optionally with a trailing path/query/fragment
// (e.g. ".../pull/12/files", ".../pull/12#discussion_r1").
const PR_URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export function parsePrUrl(url: string): PrRef | null {
  const match = url.trim().match(PR_URL_RE);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function prUrl(pr: PrRef): string {
  return `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
}

/** "owner/repo#123" */
export function prLabel(pr: PrRef): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

/** GitHub treats owner and repo names case-insensitively. */
export function samePr(a: PrRef, b: PrRef): boolean {
  return (
    a.number === b.number &&
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}
