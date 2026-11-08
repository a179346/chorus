import fs from 'node:fs';

/**
 * Default context window — every current Claude model ships with at least 200k.
 * Some (Opus 4.7, Sonnet 4.5) can be toggled to 1M at runtime via beta header,
 * but the model id in the transcript looks identical for both modes, so we
 * cannot tell from the model string alone. See detect1mFromUsage below.
 */
const DEFAULT_CONTEXT_LIMIT = 200_000;
const EXTENDED_CONTEXT_LIMIT = 1_000_000;
const LINES_PER_CHUNK = 15;
const MAX_ATTEMPTS = 4;

export interface TranscriptMetadata {
  model: string | null;
  contextUsage: number | null; // 0-100 percentage
  contextLimit: number | null; // tokens
}

/**
 * One-way detection: if the prompt for a single turn ever exceeded 200k, the
 * session must be in 1M mode (a 200k session physically cannot hold that many
 * tokens). Sticky — once detected, callers should keep passing the bumped
 * limit back in so it persists across restarts.
 */
function detectLimit(prevLimit: number | null | undefined, observedInputTokens: number): number {
  const base = prevLimit && prevLimit > 0 ? prevLimit : DEFAULT_CONTEXT_LIMIT;
  if (observedInputTokens > DEFAULT_CONTEXT_LIMIT) return EXTENDED_CONTEXT_LIMIT;
  return base;
}

/**
 * Read the tail of a JSONL file and return the last N non-empty lines.
 * Reads backwards from the end of the file in chunks.
 */
function readTailLines(filePath: string, lineCount: number, skipLines: number): string[] {
  const fd = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  const fileSize = stat.size;

  if (fileSize === 0) {
    fs.closeSync(fd);
    return [];
  }

  // Read from end in 4KB chunks, collect lines
  const chunkSize = 4096;
  let position = fileSize;
  let remainder = '';
  const allLines: string[] = [];
  const totalNeeded = lineCount + skipLines;

  while (position > 0 && allLines.length < totalNeeded) {
    const readSize = Math.min(chunkSize, position);
    position -= readSize;

    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, position);
    const chunk = buf.toString('utf-8');

    const text = chunk + remainder;
    const lines = text.split('\n');

    // First element may be a partial line — save for next iteration
    remainder = lines.shift() ?? '';

    // Add non-empty lines in reverse order (bottom-up)
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        allLines.push(lines[i]);
      }
    }
  }

  // Don't forget the remainder (first line of file)
  if (remainder.trim() && allLines.length < totalNeeded) {
    allLines.push(remainder);
  }

  fs.closeSync(fd);

  // allLines is in reverse order (last line first)
  // Skip the first `skipLines` entries, then take `lineCount`
  return allLines.slice(skipLines, skipLines + lineCount);
}

/**
 * Read a Claude Code transcript JSONL file tail and extract the latest model
 * and estimated context usage from the most recent assistant message.
 *
 * Reads 15 lines from the tail at a time, up to 4 attempts (60 lines max).
 *
 * `prevContextLimit` lets the caller persist a previously detected 1M limit
 * across calls; once a session has been observed to exceed 200k it stays at
 * 1M even if later turns are smaller (e.g. after /clear).
 *
 * The numerator counts only prompt tokens (input + cache_read + cache_creation),
 * matching what Claude Code's own /context displays — output_tokens are excluded
 * because they don't carry into the next turn's context budget.
 */
export async function readTranscriptMetadata(
  transcriptPath: string,
  prevContextLimit?: number | null,
): Promise<TranscriptMetadata> {
  if (!fs.existsSync(transcriptPath)) {
    return { model: null, contextUsage: null, contextLimit: prevContextLimit ?? null };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const skipLines = attempt * LINES_PER_CHUNK;
    const lines = readTailLines(transcriptPath, LINES_PER_CHUNK, skipLines);

    if (lines.length === 0) break;

    // lines are in reverse order (most recent first) — search from index 0
    for (const line of lines) {
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type !== 'assistant' || !entry.message) continue;

      const msg = entry.message;
      const model = msg.model ?? null;
      const usage = msg.usage;

      let contextUsage: number | null = null;
      let contextLimit: number | null = prevContextLimit ?? null;
      if (usage) {
        const inputTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);

        contextLimit = detectLimit(prevContextLimit, inputTokens);

        if (model && inputTokens > 0) {
          contextUsage = Math.min(100, Math.round((inputTokens / contextLimit) * 100));
        }
      }

      return { model, contextUsage, contextLimit };
    }
  }

  return { model: null, contextUsage: null, contextLimit: prevContextLimit ?? null };
}
