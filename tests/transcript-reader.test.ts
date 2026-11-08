import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readTranscriptMetadata } from "../src/main/transcript-reader";

function makeTempTranscript(lines: object[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-transcript-"));
  const file = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

function rmFile(file: string): void {
  try {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

describe("readTranscriptMetadata", () => {
  let file: string;

  afterEach(() => {
    if (file) rmFile(file);
  });

  function assistantEntry(usage: Record<string, number>, model = "claude-opus-4-7") {
    return {
      type: "assistant",
      message: { model, usage },
    };
  }

  it("returns nulls when file does not exist", async () => {
    const meta = await readTranscriptMetadata("/nonexistent.jsonl");
    expect(meta).toEqual({ model: null, contextUsage: null, contextLimit: null });
  });

  it("computes percentage from prompt tokens against 200k by default", async () => {
    file = makeTempTranscript([
      assistantEntry({
        input_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 19_999,
        output_tokens: 100_000, // should NOT be counted
      }),
    ]);
    const meta = await readTranscriptMetadata(file);
    expect(meta.model).toBe("claude-opus-4-7");
    expect(meta.contextLimit).toBe(200_000);
    // 20_000 / 200_000 = 10%
    expect(meta.contextUsage).toBe(10);
  });

  it("excludes output_tokens from the numerator", async () => {
    file = makeTempTranscript([
      assistantEntry({
        input_tokens: 50_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 50_000,
      }),
    ]);
    const meta = await readTranscriptMetadata(file);
    // Old behavior would have given (50k+50k)/200k = 50%; new gives 25%.
    expect(meta.contextUsage).toBe(25);
  });

  it("detects 1M mode when prompt exceeds 200k and bumps the limit", async () => {
    file = makeTempTranscript([
      assistantEntry({
        input_tokens: 250_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 100,
      }),
    ]);
    const meta = await readTranscriptMetadata(file);
    expect(meta.contextLimit).toBe(1_000_000);
    // 250_000 / 1_000_000 = 25%
    expect(meta.contextUsage).toBe(25);
  });

  it("keeps the 1M limit sticky via prevContextLimit even after small turns", async () => {
    file = makeTempTranscript([
      assistantEntry({
        input_tokens: 100_000, // small prompt, would normally look like 200k mode
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      }),
    ]);
    const meta = await readTranscriptMetadata(file, 1_000_000);
    expect(meta.contextLimit).toBe(1_000_000);
    // 100k / 1M = 10%
    expect(meta.contextUsage).toBe(10);
  });
});
