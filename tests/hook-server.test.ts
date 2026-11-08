import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { HookServer, prsCreatedBy, type HookEvent, type HookUpdate } from "../src/main/hook-server";
import type { PrRef } from "../src/shared/types";

function postHookEvent(
  port: number,
  event: Partial<HookEvent>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(event);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/hook",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => resolve(res.statusCode ?? 0),
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe("HookServer", () => {
  let server: HookServer;
  let updates: Array<{
    sessionId: string;
    update: HookUpdate;
  }>;

  beforeEach(async () => {
    updates = [];
    server = new HookServer((sessionId, update) => {
      updates.push({ sessionId, update });
    });
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  // ─── HTTP server ───────────────────────────────────────

  describe("HTTP server", () => {
    it("should start on a random port", () => {
      expect(server.getPort()).toBeGreaterThan(0);
    });

    it("should accept POST /hook and return 200", async () => {
      const status = await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "Stop",
        cwd: "/tmp",
      });
      expect(status).toBe(200);
    });

    it("should return 404 for unknown paths", async () => {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: server.getPort(),
            path: "/unknown",
            method: "GET",
          },
          (res) => resolve(res.statusCode ?? 0),
        );
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(404);
    });
  });

  // ─── Hook event mapping ────────────────────────────────

  describe("hook event -> status mapping", () => {
    it("Notification (permission_prompt) -> waiting with Claude's message", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "Notification",
        cwd: "/tmp",
        notification_type: "permission_prompt",
        message: "Claude needs your permission to use Bash",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update).toEqual({
        status: "waiting",
        waitingReason: "Claude needs your permission to use Bash",
      });
    });

    it("Notification (elicitation_dialog) -> waiting", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "Notification",
        cwd: "/tmp",
        notification_type: "elicitation_dialog",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update.status).toBe("waiting");
    });

    it.each(["idle_prompt", "auth_success", undefined])(
      "ignores non-blocking Notification type %s",
      async (notificationType) => {
        await postHookEvent(server.getPort(), {
          session_id: "s1",
          hook_event_name: "Notification",
          cwd: "/tmp",
          notification_type: notificationType,
        });
        // A follow-up event proves the Notification was processed (and dropped)
        await postHookEvent(server.getPort(), {
          session_id: "s1",
          hook_event_name: "PreToolUse",
          cwd: "/tmp",
        });
        await vi.waitFor(() => expect(updates).toHaveLength(1));
        expect(updates[0].update.status).toBe("generating");
      },
    );

    it("PostToolUse -> generating", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "PostToolUse",
        cwd: "/tmp",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update.status).toBe("generating");
    });

    it("PostToolUseFailure -> generating (a failing tool also ends a permission wait)", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "PostToolUseFailure",
        cwd: "/tmp",
        tool_name: "Bash",
        error: "Exit code 1",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update.status).toBe("generating");
    });

    it("UserPromptSubmit -> thinking", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "UserPromptSubmit",
        cwd: "/tmp",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update.status).toBe("thinking");
    });

    it("Stop -> idle", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "Stop",
        cwd: "/tmp",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update.status).toBe("idle");
    });

    it("PreToolUse -> generating", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "PreToolUse",
        cwd: "/tmp",
        tool_name: "Bash",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update.status).toBe("generating");
    });

    it("SessionStart -> idle with model", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "SessionStart",
        cwd: "/tmp",
        source: "startup",
        model: "claude-sonnet-4-6",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update.status).toBe("idle");
      expect(updates[0].update.model).toBe("claude-sonnet-4-6");
    });

    it("should ignore unknown hook events", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "SubagentStop",
        cwd: "/tmp",
      });
      // Small wait to ensure nothing arrives
      await new Promise((r) => setTimeout(r, 50));
      expect(updates).toHaveLength(0);
    });

    it("should ignore malformed JSON", async () => {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: server.getPort(),
            path: "/hook",
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          (res) => resolve(res.statusCode ?? 0),
        );
        req.on("error", reject);
        req.write("not json");
        req.end();
      });
      expect(status).toBe(200); // Still returns 200
      expect(updates).toHaveLength(0);
    });
  });

  // ─── Multiple sessions ────────────────────────────────

  describe("multiple sessions", () => {
    it("should track events from different sessions independently", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "UserPromptSubmit",
        cwd: "/tmp",
      });
      await postHookEvent(server.getPort(), {
        session_id: "s2",
        hook_event_name: "Stop",
        cwd: "/tmp",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(2));
      expect(updates[0]).toMatchObject({ sessionId: "s1", update: { status: "thinking" } });
      expect(updates[1]).toMatchObject({ sessionId: "s2", update: { status: "idle" } });
    });
  });
});

/** A Bash tool call that finished, as Claude Code reports it to the PostToolUse hook. */
function bashSucceeded(command: string, stdout: string): HookEvent {
  return {
    session_id: "s1",
    hook_event_name: "PostToolUse",
    cwd: "/tmp",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout, stderr: "", interrupted: false },
  };
}

/** A Bash tool call that exited non-zero, as reported to the PostToolUseFailure hook. */
function bashFailed(command: string, error: string): HookEvent {
  return {
    session_id: "s1",
    hook_event_name: "PostToolUseFailure",
    cwd: "/tmp",
    tool_name: "Bash",
    tool_input: { command },
    error,
  };
}

describe("prsCreatedBy", () => {
  it("reads the PR URL gh pr create prints", () => {
    expect(prsCreatedBy(bashSucceeded("gh pr create --title foo", "https://github.com/myorg/myrepo/pull/42\n"))).toEqual([
      { owner: "myorg", repo: "myrepo", number: 42 },
    ]);
  });

  it("matches gh pr create chained after other commands", () => {
    const event = bashSucceeded("cd .claude/worktrees/feat && gh pr create --draft", "https://github.com/o/r/pull/7");
    expect(prsCreatedBy(event)).toEqual([{ owner: "o", repo: "r", number: 7 }]);
  });

  it("takes the last URL, which is the one gh prints for the new PR", () => {
    const event = bashSucceeded("gh pr create", "see https://github.com/o/r/pull/1\nhttps://github.com/o/r/pull/2\n");
    expect(prsCreatedBy(event)).toEqual([{ owner: "o", repo: "r", number: 2 }]);
  });

  it("reads the existing PR from gh's error when the branch already has one", () => {
    const event = bashFailed(
      "gh pr create --fill",
      'Exit code 1\na pull request for branch "feat" into branch "main" already exists:\nhttps://github.com/o/r/pull/4',
    );
    expect(prsCreatedBy(event)).toEqual([{ owner: "o", repo: "r", number: 4 }]);
  });

  it("finds nothing when gh pr create fails without naming a PR", () => {
    expect(prsCreatedBy(bashFailed("gh pr create", "Exit code 1\nno commits between main and feat"))).toEqual([]);
  });

  it.each(["gh pr list", "gh pr view 555", "gh pr ready 42", "git log --grep='gh pr create'"])(
    "ignores PR URLs printed by `%s`",
    (command) => {
      expect(prsCreatedBy(bashSucceeded(command, "https://github.com/x/y/pull/555"))).toEqual([]);
    },
  );

  it("ignores gh pr create before it has run", () => {
    expect(
      prsCreatedBy({ session_id: "s1", hook_event_name: "PreToolUse", cwd: "/tmp", tool_name: "Bash", tool_input: { command: "gh pr create" } }),
    ).toEqual([]);
  });

  it("ignores other tools whose output mentions a PR", () => {
    expect(
      prsCreatedBy({
        session_id: "s1",
        hook_event_name: "PostToolUse",
        cwd: "/tmp",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/notes.md" },
        tool_response: { stdout: "https://github.com/o/r/pull/9" },
      }),
    ).toEqual([]);
  });

  it.each(["mcp__github__create_pull_request", "mcp__plugin_github_github__create_pull_request"])(
    "reads the PR from the %s MCP tool's result",
    (toolName) => {
      const event: HookEvent = {
        session_id: "s1",
        hook_event_name: "PostToolUse",
        cwd: "/tmp",
        tool_name: toolName,
        tool_input: { owner: "o", repo: "r", title: "x" },
        tool_response: [{ type: "text", text: '{"id":"1","url":"https://github.com/o/r/pull/55"}' }],
      };
      expect(prsCreatedBy(event)).toEqual([{ owner: "o", repo: "r", number: 55 }]);
    },
  );

  it("ignores other GitHub MCP tools", () => {
    expect(
      prsCreatedBy({
        session_id: "s1",
        hook_event_name: "PostToolUse",
        cwd: "/tmp",
        tool_name: "mcp__github__get_pull_request",
        tool_response: [{ type: "text", text: "https://github.com/o/r/pull/55" }],
      }),
    ).toEqual([]);
  });
});

describe("HookServer PR detection", () => {
  let server: HookServer;
  let updates: HookUpdate[];
  let detected: Array<{ sessionId: string; prs: PrRef[] }>;

  beforeEach(async () => {
    updates = [];
    detected = [];
    server = new HookServer(
      (_sessionId, update) => updates.push(update),
      (sessionId, prs) => detected.push({ sessionId, prs }),
    );
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it("reports the PR as soon as gh pr create finishes", async () => {
    await postHookEvent(server.getPort(), bashSucceeded("gh pr create", "https://github.com/o/r/pull/1\n"));

    await vi.waitFor(() => expect(detected).toHaveLength(1));
    expect(detected[0]).toEqual({ sessionId: "s1", prs: [{ owner: "o", repo: "r", number: 1 }] });
    expect(updates).toEqual([{ status: "generating" }]);
  });

  it("reports the existing PR when gh pr create fails because of it", async () => {
    await postHookEvent(
      server.getPort(),
      bashFailed("gh pr create", "Exit code 1\na pull request already exists:\nhttps://github.com/o/r/pull/3"),
    );

    await vi.waitFor(() => expect(detected).toHaveLength(1));
    expect(detected[0].prs).toEqual([{ owner: "o", repo: "r", number: 3 }]);
  });

  it("stays quiet for tool calls that created no PR", async () => {
    await postHookEvent(server.getPort(), bashSucceeded("ls", "file1\nfile2"));

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(detected).toEqual([]);
  });
});
