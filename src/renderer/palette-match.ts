// Ranking for the command palette: how well a typed query matches an item.

const PREFIX = 100;
const WORD_START = 80;
const SUBSTRING = 60;
const SCATTERED = 20;
/** A hit in an item's secondary text counts for less than one in its title. */
const SECONDARY_PENALTY = 30;

const WORD_BREAK = /[\s\-_./]/;

/** Case- and Unicode-form-insensitive, so "café" typed either way matches. */
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFC');
}

/**
 * How well `text` matches one query `word`, ignoring case, or null when it
 * doesn't: a prefix beats a word start, which beats a substring, which beats
 * the word's letters appearing in order with gaps.
 */
export function wordScore(text: string, word: string): number | null {
  const t = normalize(text);
  const w = normalize(word);

  if (t.startsWith(w)) return PREFIX;
  for (let i = t.indexOf(w); i !== -1; i = t.indexOf(w, i + 1)) {
    if (i > 0 && WORD_BREAK.test(t[i - 1])) return WORD_START;
  }
  if (t.includes(w)) return SUBSTRING;
  return isSubsequence(w, t) ? SCATTERED : null;
}

function isSubsequence(needle: string, haystack: string): boolean {
  // By code point, not UTF-16 unit, so an emoji is one character on both sides
  const wanted = Array.from(needle);
  let next = 0;
  for (const ch of haystack) {
    if (ch === wanted[next]) next++;
    if (next === wanted.length) return true;
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

/** The item's best score for one word: in its title, or for less in its other text. */
function fieldScore(item: Matchable, word: string): number | null {
  const title = wordScore(item.title, word);
  const secondary = [item.subtitle, item.keywords]
    .map((text) => (text ? wordScore(text, word) : null))
    .filter((score): score is number => score !== null)
    .map((score) => score - SECONDARY_PENALTY);
  const scores = title === null ? secondary : [title, ...secondary];
  return scores.length ? Math.max(...scores) : null;
}

/**
 * Every word must match somewhere in the item, in any order ("rename api"
 * finds Rename Session… on session api), and the item ranks by its weakest
 * word.
 */
function itemScore(item: Matchable, words: readonly string[]): number | null {
  const scores: number[] = [];
  for (const word of words) {
    const score = fieldScore(item, word);
    if (score === null) return null;
    scores.push(score);
  }
  return Math.min(...scores);
}

/**
 * The items matching `query`, best first. A group's items stay together so
 * section headers don't repeat, and the group holding the best match leads;
 * equal scores keep the original order. Without a query, everything keeps
 * its original order.
 */
export function filterPaletteItems<T extends Matchable>(items: readonly T[], query: string): T[] {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];

  const ranked = items
    .map((item, index) => ({ item, index, score: itemScore(item, words) }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  // A group first appears with its best match, so groups come out best-led too
  const byGroup = new Map<string, T[]>();
  for (const { item } of ranked) {
    const group = byGroup.get(item.group);
    if (group) group.push(item);
    else byGroup.set(item.group, [item]);
  }
  return [...byGroup.values()].flat();
}
