import { describe, expect, it } from "vitest";
import {
  checkToolPermission,
  classifyTool,
  disallowedToolsForPermissions,
  loadDiskPermissions,
  PERMISSION_DOMAINS,
} from "./permission-policy.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTempDir } from "./testing/cleanup.ts";

describe("permission-policy", () => {
  describe("PERMISSION_DOMAINS", () => {
    it("defines metadata for all four domains", () => {
      expect(PERMISSION_DOMAINS.terminal.title).toBe("Terminal & Shell Execution");
      expect(PERMISSION_DOMAINS.filesystem.title).toBe("Filesystem Read & Write");
      expect(PERMISSION_DOMAINS.browser.title).toBe("Browser & Network");
      expect(PERMISSION_DOMAINS.composio.title).toBe("Composio Integrations");
    });
  });

  describe("classifyTool", () => {
    it("classifies terminal tools correctly", () => {
      expect(classifyTool("Bash").domain).toBe("terminal");
      expect(classifyTool("bash").domain).toBe("terminal");
      expect(classifyTool("run_command").domain).toBe("terminal");
      expect(classifyTool("run_shell").domain).toBe("terminal");
      expect(classifyTool("process_start").domain).toBe("terminal");
      expect(classifyTool("build_run").domain).toBe("terminal");
      expect(classifyTool("test_run").domain).toBe("terminal");
      expect(classifyTool("project_git_status").domain).toBe("terminal");
    });

    it("classifies filesystem tools correctly", () => {
      expect(classifyTool("ReadFile").domain).toBe("filesystem");
      expect(classifyTool("WriteFile").domain).toBe("filesystem");
      expect(classifyTool("EditFile").domain).toBe("filesystem");
      expect(classifyTool("GlobTool").domain).toBe("filesystem");
      expect(classifyTool("workspace_read").domain).toBe("filesystem");
      expect(classifyTool("workspace_write").domain).toBe("filesystem");
      expect(classifyTool("artifact_create").domain).toBe("filesystem");
      expect(classifyTool("project_create").domain).toBe("filesystem");
      expect(classifyTool("verify_file").domain).toBe("filesystem");
    });

    it("classifies browser and network tools correctly", () => {
      expect(classifyTool("http_fetch").domain).toBe("browser");
      expect(classifyTool("web_search").domain).toBe("browser");
      expect(classifyTool("Fetch").domain).toBe("browser");
      expect(classifyTool("WebSearch").domain).toBe("browser");
      expect(classifyTool("browser_open").domain).toBe("browser");
      expect(classifyTool("preview_start").domain).toBe("browser");
      expect(classifyTool("deployment_create").domain).toBe("browser");
    });

    it("classifies composio tools correctly", () => {
      expect(classifyTool("mcp__composio__github_create_issue").domain).toBe("composio");
      expect(classifyTool("composio_gmail_send_mail").domain).toBe("composio");
      expect(classifyTool("composio_search").domain).toBe("composio");
    });

    it("classifies system and collaboration tools correctly", () => {
      expect(classifyTool("ask_user").domain).toBe("system");
      expect(classifyTool("AskUserQuestion").domain).toBe("system");
      expect(classifyTool("coordinate_bots").domain).toBe("system");
      expect(classifyTool("delegate_bot").domain).toBe("system");
      expect(classifyTool("approve").domain).toBe("system");
      expect(classifyTool("environment_discover").domain).toBe("system");
      expect(classifyTool("plan_create").domain).toBe("system");
      expect(classifyTool("task_create").domain).toBe("system");
    });

    it("classifies dynamic device_capability_invoke based on capabilityId", () => {
      expect(classifyTool("device_capability_invoke", { capabilityId: "device.files" }).domain).toBe("filesystem");
      expect(classifyTool("device_capability_invoke", { capabilityId: "device.browser" }).domain).toBe("browser");
      expect(classifyTool("device_capability_invoke", { capabilityId: "device.clipboard" }).domain).toBe("system");
      expect(classifyTool("device_capability_invoke", { capabilityId: "device.camera" }).domain).toBe("system");
    });

    it("fails closed on unclassified unknown tools", () => {
      expect(classifyTool("arbitrary_unknown_exploit_tool").domain).toBe("unknown");
    });
  });

  describe("checkToolPermission", () => {
    it("allows system tools unconditionally", () => {
      const res = checkToolPermission("ask_user", {
        terminal: "denied",
        filesystem: "denied",
        browser: "denied",
        composio: "denied",
      });
      expect(res.allowed).toBe(true);
    });

    it("blocks unclassified tools fail-closed", () => {
      const res = checkToolPermission("unknown_backdoor");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("blocked by security policy");
    });

    it("enforces terminal permission states", () => {
      expect(checkToolPermission("Bash", { terminal: "granted" }).allowed).toBe(true);
      expect(checkToolPermission("Bash", { terminal: "denied" }).allowed).toBe(false);
      expect(checkToolPermission("Bash", { terminal: "denied" }).reason).toContain("Terminal & Shell Execution is disabled");
      expect(checkToolPermission("Bash", { terminal: "restricted" }).allowed).toBe(false);
    });

    it("enforces filesystem permission states", () => {
      expect(checkToolPermission("ReadFile", { filesystem: "granted" }).allowed).toBe(true);
      expect(checkToolPermission("ReadFile", { filesystem: "denied" }).allowed).toBe(false);
      expect(checkToolPermission("ReadFile", { filesystem: "denied" }).reason).toContain("Filesystem Read & Write is disabled");
      expect(checkToolPermission("ReadFile", { filesystem: "restricted" }).allowed).toBe(false);
    });

    it("enforces browser permission states", () => {
      expect(checkToolPermission("http_fetch", { browser: "granted" }).allowed).toBe(true);
      expect(checkToolPermission("http_fetch", { browser: "denied" }).allowed).toBe(false);
      expect(checkToolPermission("http_fetch", { browser: "denied" }).reason).toContain("Browser & Network is disabled");
      expect(checkToolPermission("http_fetch", { browser: "restricted" }).allowed).toBe(false);
    });

    it("enforces composio permission states and configuration requirements", () => {
      expect(checkToolPermission("composio_action", { composio: "granted" }).allowed).toBe(true);
      expect(checkToolPermission("composio_action", { composio: "denied" }).allowed).toBe(false);
      expect(checkToolPermission("composio_action", { composio: "denied" }).reason).toContain("Composio Integrations is disabled");
      expect(checkToolPermission("composio_action", { composio: "requires_configuration" }).allowed).toBe(false);
      expect(checkToolPermission("composio_action", { composio: "requires_configuration" }).reason).toContain("Settings -> Connected Services");
      expect(checkToolPermission("composio_action", { composio: "granted" }, {}, { composioConfigured: false }).allowed).toBe(false);
    });
  });

  describe("disallowedToolsForPermissions", () => {
    it("returns correct disallowed tool names for Claude CLI", () => {
      expect(disallowedToolsForPermissions({ terminal: "denied" })).toContain("Bash");
      expect(disallowedToolsForPermissions({ filesystem: "denied" })).toEqual(
        expect.arrayContaining(["ReadFile", "WriteFile", "EditFile", "GlobTool", "GrepTool"]),
      );
      expect(disallowedToolsForPermissions({ browser: "denied" })).toEqual(
        expect.arrayContaining(["WebSearch", "Fetch"]),
      );
      expect(disallowedToolsForPermissions({ terminal: "granted", filesystem: "granted" })).toEqual([]);
    });
  });

  describe("loadDiskPermissions", () => {
    it("loads permissions from disk accurately", () => {
      const scratch = mkdtempSync(join(tmpdir(), "omb-perms-test-"));
      try {
        writeFileSync(
          join(scratch, "config.json"),
          JSON.stringify({ agentPermissions: { terminal: "denied", browser: "denied" } }),
        );
        process.env.OMB_DATA_DIR = scratch;
        const perms = loadDiskPermissions();
        expect(perms.terminal).toBe("denied");
        expect(perms.browser).toBe("denied");
        expect(perms.filesystem).toBeUndefined();
      } finally {
        delete process.env.OMB_DATA_DIR;
        removeTempDir(scratch);
      }
    });
  });
});
