import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HookServer, type HookEvent, type HookUpdate } from "../src/main/hook-server";
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

describe("HookServer PR detection", () => {
  let server: HookServer;
  let dir: string;
  let detected: Array<{ sessionId: string; prs: PrRef[] }>;

  /** A transcript in which Claude ran `gh pr create` once per PR number. */
  function writeTranscript(prNumbers: number[]): string {
    const lines = prNumbers.flatMap((n) => [
      { type: "assistant", message: { content: [{ type: "tool_use", id: `c${n}`, name: "Bash", input: { command: "gh pr create" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `c${n}`, content: `https://github.com/o/r/pull/${n}` }] } },
    ]);
    const file = path.join(dir, "transcript.jsonl");
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return file;
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-hook-"));
    detected = [];
    server = new HookServer(
      () => {},
      (sessionId, prs) => detected.push({ sessionId, prs }),
    );
    await server.start();
  });

  afterEach(() => {
    server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports every PR created in the transcript on Stop", async () => {
    await postHookEvent(server.getPort(), {
      session_id: "s1",
      hook_event_name: "Stop",
      cwd: "/tmp",
      transcript_path: writeTranscript([1, 2]),
    });

    await vi.waitFor(() => expect(detected).toHaveLength(1), { timeout: 2000 });
    expect(detected[0]).toEqual({
      sessionId: "s1",
      prs: [
        { owner: "o", repo: "r", number: 1 },
        { owner: "o", repo: "r", number: 2 },
      ],
    });
  });

  it("stays quiet when the transcript created no PR", async () => {
    await postHookEvent(server.getPort(), {
      session_id: "s1",
      hook_event_name: "Stop",
      cwd: "/tmp",
      transcript_path: writeTranscript([]),
    });

    // The server waits 500ms for Claude to flush the transcript before reading it
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(detected).toEqual([]);
  });
});
