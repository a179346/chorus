import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractPrFromCreateCall, readTranscriptMetadata } from "../src/main/transcript-reader";

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

describe("extractPrFromCreateCall", () => {
  let file: string;

  afterEach(() => {
    if (file) rmFile(file);
  });

  it("returns null when transcript file does not exist", async () => {
    expect(await extractPrFromCreateCall("/nonexistent/path.jsonl")).toBeNull();
  });

  it("matches plain `gh pr create` Bash command", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "u1", name: "Bash", input: { command: "gh pr create --title foo" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "u1",
              content: "https://github.com/myorg/myrepo/pull/42\n",
            },
          ],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toEqual({
      owner: "myorg",
      repo: "myrepo",
      number: 42,
    });
  });

  it("matches chained `cd worktree && gh pr create`", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "u1",
              name: "Bash",
              input: { command: "cd .claude/worktrees/feat && gh pr create --draft" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "u1", content: "Created PR\nhttps://github.com/o/r/pull/7" },
          ],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toEqual({ owner: "o", repo: "r", number: 7 });
  });

  it("handles tool_result content as array of blocks", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "u1", name: "Bash", input: { command: "gh pr create" } }],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "u1",
              content: [
                { type: "text", text: "Creating PR..." },
                { type: "text", text: "https://github.com/foo/bar/pull/99" },
              ],
            },
          ],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toEqual({ owner: "foo", repo: "bar", number: 99 });
  });

  it("ignores `gh pr list` / `gh pr view <other>` noise", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "u1", name: "Bash", input: { command: "gh pr list" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "u1",
              content:
                "https://github.com/x/y/pull/1\nhttps://github.com/x/y/pull/2\nhttps://github.com/x/y/pull/3\n",
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "u2", name: "Bash", input: { command: "gh pr view 555" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "u2", content: "https://github.com/x/y/pull/555" },
          ],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toBeNull();
  });

  it("picks the create-PR result even when noise URLs are nearby", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "list1", name: "Bash", input: { command: "gh pr list" } }],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "list1",
              content: "https://github.com/x/y/pull/100\nhttps://github.com/x/y/pull/200",
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "create1", name: "Bash", input: { command: "gh pr create" } }],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "create1", content: "https://github.com/x/y/pull/300" },
          ],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toEqual({ owner: "x", repo: "y", number: 300 });
  });

  it("takes the latest of multiple successful create attempts", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "gh pr create" } }],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "c1", content: "https://github.com/o/r/pull/1" }],
        },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "c2", name: "Bash", input: { command: "gh pr create" } }],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "c2", content: "https://github.com/o/r/pull/2" }],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toEqual({ owner: "o", repo: "r", number: 2 });
  });

  it("falls back to earlier create when latest create has no URL (failed)", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "ok", name: "Bash", input: { command: "gh pr create" } }],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "ok", content: "https://github.com/o/r/pull/7" }],
        },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "fail", name: "Bash", input: { command: "gh pr create" } }],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "fail", content: "error: branch not found" }],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toEqual({ owner: "o", repo: "r", number: 7 });
  });

  it("matches mcp__github__create_pull_request tool name", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "m1",
              name: "mcp__github__create_pull_request",
              input: { title: "x" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "m1", content: "Created: https://github.com/o/r/pull/55" },
          ],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toEqual({ owner: "o", repo: "r", number: 55 });
  });

  it("handles multiple tool_use in same JSONL line", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "doing stuff" },
            { type: "tool_use", id: "a", name: "Bash", input: { command: "ls" } },
            { type: "tool_use", id: "b", name: "Bash", input: { command: "gh pr create --draft" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "a", content: "file1\nfile2" },
            { type: "tool_result", tool_use_id: "b", content: "https://github.com/o/r/pull/9" },
          ],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toEqual({ owner: "o", repo: "r", number: 9 });
  });

  it("returns null for malformed JSONL lines", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-transcript-"));
    file = path.join(dir, "transcript.jsonl");
    fs.writeFileSync(file, "{not valid json\n{also bad\n");

    expect(await extractPrFromCreateCall(file)).toBeNull();
  });

  it("returns null when no PR create call is found", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "just thinking" }],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toBeNull();
  });

  it("does not match `gh pr ready` or other gh subcommands", async () => {
    file = makeTempTranscript([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "u1", name: "Bash", input: { command: "gh pr ready 42" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "u1", content: "https://github.com/o/r/pull/42" },
          ],
        },
      },
    ]);

    expect(await extractPrFromCreateCall(file)).toBeNull();
  });
});

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
