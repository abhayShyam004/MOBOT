import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfigPatch, saveConfig, DATA_DIR } from "./config.ts";

describe("Agent Permissions Architecture (Phase B)", () => {
  it("validates and parses agentPermissions patch correctly", () => {
    const patch = parseConfigPatch({
      agentPermissions: {
        terminal: "denied",
        filesystem: "granted",
        browser: "restricted",
        composio: "requires_configuration",
      },
    });

    expect(patch.agentPermissions).toEqual({
      terminal: "denied",
      filesystem: "granted",
      browser: "restricted",
      composio: "requires_configuration",
    });
  });

  it("rejects invalid permission states", () => {
    expect(() =>
      parseConfigPatch({
        agentPermissions: {
          terminal: "unlimited" as any,
        },
      }),
    ).toThrow();
  });

  it("persists agent permissions to config.json", () => {
    const configPath = join(DATA_DIR, "config.json");
    saveConfig({
      agentPermissions: {
        terminal: "denied",
        filesystem: "granted",
        browser: "denied",
      },
    });

    const onDisk = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(onDisk.agentPermissions).toEqual({
      terminal: "denied",
      filesystem: "granted",
      browser: "denied",
    });

    // Reset back to granted
    saveConfig({
      agentPermissions: {
        terminal: "granted",
        filesystem: "granted",
        browser: "granted",
      },
    });
  });

  it("enforces execution blocking via checkAgentExecutionPermission", async () => {
    const { checkAgentExecutionPermission } = await import("./capabilities/safety-policy.ts");

    const deniedPerms = {
      terminal: "denied",
      filesystem: "denied",
      browser: "denied",
      composio: "denied",
    };

    // Terminal blocked
    expect(checkAgentExecutionPermission("Bash", deniedPerms).allowed).toBe(false);
    expect(checkAgentExecutionPermission("run_command", deniedPerms).allowed).toBe(false);
    expect(checkAgentExecutionPermission("terminal_start", deniedPerms).allowed).toBe(false);

    // Filesystem blocked
    expect(checkAgentExecutionPermission("ReadFile", deniedPerms).allowed).toBe(false);
    expect(checkAgentExecutionPermission("workspace_write", deniedPerms).allowed).toBe(false);
    expect(checkAgentExecutionPermission("device.files", deniedPerms).allowed).toBe(false);

    // Browser blocked
    expect(checkAgentExecutionPermission("web_search", deniedPerms).allowed).toBe(false);
    expect(checkAgentExecutionPermission("http_fetch", deniedPerms).allowed).toBe(false);
    expect(checkAgentExecutionPermission("browser_open", deniedPerms).allowed).toBe(false);

    // Composio blocked
    expect(checkAgentExecutionPermission("composio_slack", deniedPerms).allowed).toBe(false);
    expect(checkAgentExecutionPermission("mcp__composio__send_email", deniedPerms).allowed).toBe(false);

    // Granted perms allow all
    const grantedPerms = {
      terminal: "granted",
      filesystem: "granted",
      browser: "granted",
      composio: "granted",
    };
    expect(checkAgentExecutionPermission("Bash", grantedPerms).allowed).toBe(true);
    expect(checkAgentExecutionPermission("workspace_write", grantedPerms).allowed).toBe(true);
    expect(checkAgentExecutionPermission("http_fetch", grantedPerms).allowed).toBe(true);
    expect(checkAgentExecutionPermission("composio_slack", grantedPerms).allowed).toBe(true);
  });
});
