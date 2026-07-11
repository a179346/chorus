import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { HookInstaller } from "../src/main/hook-installer";

const PORT = 45678;

describe("HookInstaller", () => {
  let installer: HookInstaller;
  let tmpDir: string;

  beforeEach(() => {
    installer = new HookInstaller(() => PORT);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-hook-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("ensureInstalled", () => {
    it("should create .claude/settings.local.json if it does not exist", () => {
      installer.ensureInstalled(tmpDir);
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
      installer.ensureInstalled(tmpDir);
      const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      const hookEntry = settings.hooks.Stop[0].hooks[0];
      expect(hookEntry.type).toBe("command");
      expect(hookEntry.command).toContain(`http://127.0.0.1:${PORT}/hook`);
      expect(hookEntry.timeout).toBe(5);
    });

    it("should not overwrite existing settings", () => {
      const claudeDir = path.join(tmpDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.local.json"),
        JSON.stringify({ permissions: { allow: ["Bash"] } }),
      );

      installer.ensureInstalled(tmpDir);
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

      installer.ensureInstalled(tmpDir);
      const settings = JSON.parse(
        fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"),
      );
      // Should have both user hook and our hook
      expect(settings.hooks.Stop).toHaveLength(2);
      expect(settings.hooks.Stop[0].hooks[0].command).toBe("echo user-hook");
      expect(settings.hooks.Stop[1].hooks[0].command).toContain("127.0.0.1");
    });

    it("should not duplicate hooks on repeated calls", () => {
      installer.ensureInstalled(tmpDir);
      installer.ensureInstalled(tmpDir);

      const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.Stop).toHaveLength(1);
    });

    it("should replace hooks from a previous port", () => {
      const oldInstaller = new HookInstaller(() => PORT + 1);
      oldInstaller.ensureInstalled(tmpDir);
      installer.ensureInstalled(tmpDir);

      const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.Stop).toHaveLength(1);
      expect(settings.hooks.Stop[0].hooks[0].command).toContain(`:${PORT}/hook`);
    });
  });
});
