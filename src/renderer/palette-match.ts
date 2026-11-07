// Ranking for the command palette: how well a typed query matches an item.

const PREFIX = 100;
const WORD_START = 80;
const SUBSTRING = 60;
const SCATTERED = 20;
/** A hit in an item's secondary text counts for less than one in its title. */
const SECONDARY_PENALTY = 30;

const WORD_BREAK = /[\s\-_./]/;

/**
 * How well `text` matches `query`, case-insensitively, or null when it doesn't:
 * a prefix beats a word start, which beats a substring, which beats the
 * query's letters appearing in order with gaps.
 */
export function matchScore(text: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  if (t.startsWith(q)) return PREFIX;
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + 1)) {
    if (i > 0 && WORD_BREAK.test(t[i - 1])) return WORD_START;
  }
  if (t.includes(q)) return SUBSTRING;
  return isSubsequence(q, t) ? SCATTERED : null;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let next = 0;
  for (const ch of haystack) {
    if (ch === needle[next]) next++;
    if (next === needle.length) return true;
  }
  return false;
}

export interface Matchable {
  group: string;
  title: string;
  subtitle?: string;
  /** Extra words to match that aren't shown, e.g. "settings" for Preferences. */
  keywords?: string;
}

function itemScore(item: Matchable, query: string): number | null {
  const title = matchScore(item.title, query);
  const secondary = [item.subtitle, item.keywords]
    .map((text) => (text ? matchScore(text, query) : null))
    .filter((score): score is number => score !== null)
    .map((score) => score - SECONDARY_PENALTY);
  const scores = title === null ? secondary : [title, ...secondary];
  return scores.length ? Math.max(...scores) : null;
}

/**
 * The items matching `query`. Groups keep the order they first appear in, so
 * section headers stay stable while typing; within a group, better matches
 * come first and ties keep their original order.
 */
export function filterPaletteItems<T extends Matchable>(items: readonly T[], query: string): T[] {
  const groupRanks = new Map<string, number>();
  const groupRank = (group: string): number => {
    let rank = groupRanks.get(group);
    if (rank === undefined) {
      rank = groupRanks.size;
      groupRanks.set(group, rank);
    }
    return rank;
  };
  return items
    .map((item, index) => ({ item, index, group: groupRank(item.group), score: itemScore(item, query) }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    .sort((a, b) => a.group - b.group || b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
