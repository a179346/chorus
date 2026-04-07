import fs from 'node:fs';

/** Known context window sizes by model family. */
const CONTEXT_LIMITS: Record<string, number> = {
  'opus': 200_000,
  'sonnet': 200_000,
  'haiku': 200_000,
};

const DEFAULT_CONTEXT_LIMIT = 200_000;
const LINES_PER_CHUNK = 15;
const MAX_ATTEMPTS = 4;

function getContextLimit(model: string): number {
  for (const [family, limit] of Object.entries(CONTEXT_LIMITS)) {
    if (model.includes(family)) return limit;
  }
  return DEFAULT_CONTEXT_LIMIT;
}

export interface TranscriptMetadata {
  model: string | null;
  contextUsage: number | null; // 0-100 percentage
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
 */
export async function readTranscriptMetadata(transcriptPath: string): Promise<TranscriptMetadata> {
  if (!fs.existsSync(transcriptPath)) {
    return { model: null, contextUsage: null };
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
      if (usage) {
        const inputTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        const outputTokens = usage.output_tokens ?? 0;
        const totalTokens = inputTokens + outputTokens;

        if (model && totalTokens > 0) {
          const limit = getContextLimit(model);
          contextUsage = Math.min(100, Math.round((totalTokens / limit) * 100));
        }
      }

      return { model, contextUsage };
    }
  }

  return { model: null, contextUsage: null };
}
