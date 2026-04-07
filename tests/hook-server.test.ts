import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { HookServer, type HookEvent, type HookUpdate } from "../src/main/hook-server";
import type { SessionStatus } from "../src/shared/types";

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
  let tmpDir: string;

  beforeEach(async () => {
    updates = [];
    server = new HookServer((sessionId, update) => {
      updates.push({ sessionId, update });
    });
    await server.start();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-hook-test-"));
  });

  afterEach(() => {
    server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    it("Notification -> waiting", async () => {
      await postHookEvent(server.getPort(), {
        session_id: "s1",
        hook_event_name: "Notification",
        cwd: "/tmp",
      });
      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].update.status).toBe("waiting");
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
        hook_event_name: "PostToolUse",
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

  // ─── Hook installation ────────────────────────────────

  describe("ensureHooksInstalled", () => {
    it("should create .claude/settings.local.json if it does not exist", () => {
      server.ensureHooksInstalled(tmpDir);
      const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.Notification).toBeDefined();
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.SessionStart).toBeDefined();
    });

    it("should include curl command pointing to the correct port", () => {
      server.ensureHooksInstalled(tmpDir);
      const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      const hookEntry = settings.hooks.Stop[0].hooks[0];
      expect(hookEntry.type).toBe("command");
      expect(hookEntry.command).toContain(
        `http://127.0.0.1:${server.getPort()}/hook`,
      );
      expect(hookEntry.timeout).toBe(5);
    });

    it("should not overwrite existing settings", () => {
      const claudeDir = path.join(tmpDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.local.json"),
        JSON.stringify({ permissions: { allow: ["Bash"] } }),
      );

      server.ensureHooksInstalled(tmpDir);
      const settings = JSON.parse(
        fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"),
      );
      expect(settings.permissions).toEqual({ allow: ["Bash"] });
      expect(settings.hooks).toBeDefined();
    });

    it("should preserve existing hooks for the same event", () => {
      const claudeDir = path.join(tmpDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.local.json"),
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: "command", command: "echo user-hook" }] }],
          },
        }),
      );

      server.ensureHooksInstalled(tmpDir);
      const settings = JSON.parse(
        fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"),
      );
      // Should have both user hook and our hook
      expect(settings.hooks.Stop).toHaveLength(2);
      expect(settings.hooks.Stop[0].hooks[0].command).toBe("echo user-hook");
      expect(settings.hooks.Stop[1].hooks[0].command).toContain("127.0.0.1");
    });

    it("should not duplicate hooks on repeated calls", () => {
      server.ensureHooksInstalled(tmpDir);
      server.ensureHooksInstalled(tmpDir);

      const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.Stop).toHaveLength(1);
    });
  });

  // ─── Hook removal ─────────────────────────────────────

  describe("removeHooks", () => {
    it("should remove Chorus hooks from settings", () => {
      server.ensureHooksInstalled(tmpDir);
      server.removeHooks(tmpDir);

      const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");
      // File should be deleted since it was empty after removing our hooks
      expect(fs.existsSync(settingsPath)).toBe(false);
    });

    it("should preserve user hooks when removing Chorus hooks", () => {
      const claudeDir = path.join(tmpDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.local.json"),
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: "command", command: "echo user-hook" }] }],
          },
        }),
      );

      server.ensureHooksInstalled(tmpDir);
      server.removeHooks(tmpDir);

      const settings = JSON.parse(
        fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"),
      );
      expect(settings.hooks.Stop).toHaveLength(1);
      expect(settings.hooks.Stop[0].hooks[0].command).toBe("echo user-hook");
    });

    it("should not throw if settings file does not exist", () => {
      expect(() => server.removeHooks(tmpDir)).not.toThrow();
    });
  });
});
