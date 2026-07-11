import type { PrRef } from './types';

// Accepts a GitHub PR URL, optionally with a trailing path/query/fragment
// (e.g. ".../pull/12/files", ".../pull/12#discussion_r1").
const PR_URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export function parsePrUrl(url: string): PrRef | null {
  const match = url.trim().match(PR_URL_RE);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
