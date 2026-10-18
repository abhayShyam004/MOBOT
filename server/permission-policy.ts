import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentPermissionsConfig, AgentPermissionState } from "./config.ts";

export type PermissionDomain = "terminal" | "filesystem" | "browser" | "composio";

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  domain?: PermissionDomain;
  state?: AgentPermissionState;
}

export interface DomainMetadata {
  id: PermissionDomain;
  title: string;
  description: string;
}

export const PERMISSION_DOMAINS: Record<PermissionDomain, DomainMetadata> = {
  terminal: {
    id: "terminal",
    title: "Terminal & Shell Execution",
    description: "Allows MOBOT to run shell commands, scripts, and subprocesses.",
  },
  filesystem: {
    id: "filesystem",
    title: "Filesystem Read & Write",
    description: "Allows MOBOT to read, create, edit, and delete workspace files.",
  },
  browser: {
    id: "browser",
    title: "Browser & Network",
    description: "Allows MOBOT to search the web, fetch URLs, and use browser automation.",
  },
  composio: {
    id: "composio",
    title: "Composio Integrations",
    description: "Allows MOBOT to invoke third-party actions on connected apps.",
  },
};

const TERMINAL_TOOL_NAMES = new Set([
  "Bash",
  "bash",
  "sh",
  "run_command",
  "run_shell",
  "open_interactive",
  "terminal_start",
  "terminal_write",
  "terminal_read",
  "terminal_resize",
  "terminal_close",
  "terminal_list",
  "pty",
  "shell_exec",
  "process_start",
  "process_stop",
  "process_list",
  "process_status",
  "process_signal",
  "project_run",
  "project_build",
]);

const FILESYSTEM_TOOL_NAMES = new Set([
  "ReadFile",
  "WriteFile",
  "EditFile",
  "GlobTool",
  "GrepTool",
  "workspace_list",
  "workspace_read",
  "workspace_write",
  "workspace_append",
  "workspace_mkdir",
  "workspace_move",
  "workspace_copy",
  "workspace_delete",
  "workspace_stat",
  "workspace_exists",
  "file_read",
  "file_write",
  "file_delete",
  "device.files",
  "artifact_create",
  "artifact_read",
  "artifact_write",
  "artifact_delete",
  "artifact_list",
  "project_create",
]);

const BROWSER_TOOL_NAMES = new Set([
  "http_fetch",
  "web_search",
  "Fetch",
  "WebSearch",
  "resource_inspect",
  "resource_fetch",
  "resource_download",
  "resource_extract_pdf",
  "resource_extract_html",
  "resource_artifacts",
  "browser_open",
  "browser_click",
  "browser_screenshot",
  "browser_navigate",
  "browser_scroll",
  "browser_fill",
  "browser_close",
  "browser_tabs",
  "browser_press",
  "browser_hover",
  "browser_evaluate",
]);

const SYSTEM_TOOL_NAMES = new Set([
  "ask_user",
  "AskUserQuestion",
  "coordinate_bots",
  "delegate_bot",
  "approve",
  "environment_discover",
  "environment_list",
  "environment_set",
  "environment_remove",
  "package_status",
  "device_capability_list",
  "device_capability_describe",
]);

/**
 * Classify a tool call into its canonical permission domain, system status, or unknown.
 */
export function classifyTool(
  toolName: string,
  args?: Record<string, unknown>,
): { domain: PermissionDomain | "system" | "unknown"; label: string } {
  const normalized = toolName.trim();

  if (SYSTEM_TOOL_NAMES.has(normalized) || /^(plan_|task_)/i.test(normalized)) {
    return { domain: "system", label: "System Collaboration" };
  }

  // Handle dynamic device capability tool
  if (normalized === "device_capability_invoke" && args) {
    const capId = String(args.capabilityId || "");
    if (capId === "device.files") return { domain: "filesystem", label: PERMISSION_DOMAINS.filesystem.title };
    if (capId === "device.browser" || capId === "device.network") return { domain: "browser", label: PERMISSION_DOMAINS.browser.title };
    if (capId.startsWith("device.")) return { domain: "system", label: "Device Native Capability" };
  }

  if (
    TERMINAL_TOOL_NAMES.has(normalized) ||
    /^(bash|sh|terminal_|shell_|exec_|process_|build_|test_|project_git_|repair_)/i.test(normalized)
  ) {
    return { domain: "terminal", label: PERMISSION_DOMAINS.terminal.title };
  }

  if (
    FILESYSTEM_TOOL_NAMES.has(normalized) ||
    /^(fs_|file_|workspace_|artifact_|project_(create|open|read|write|patch|delete|rename|list)|verify_file|verify_artifact|verify_image)/i.test(normalized)
  ) {
    return { domain: "filesystem", label: PERMISSION_DOMAINS.filesystem.title };
  }

  if (
    BROWSER_TOOL_NAMES.has(normalized) ||
    /^(browser_|web_|http_|fetch_|network_|preview_|deployment_|verify_service)/i.test(normalized)
  ) {
    return { domain: "browser", label: PERMISSION_DOMAINS.browser.title };
  }

  if (
    normalized.startsWith("mcp__composio") ||
    normalized.startsWith("composio_") ||
    /^composio/i.test(normalized)
  ) {
    return { domain: "composio", label: PERMISSION_DOMAINS.composio.title };
  }

  return { domain: "unknown", label: "Unclassified Tool" };
}

/**
 * Check whether a tool execution is allowed under current permissions.
 */
export function checkToolPermission(
  toolName: string,
  permissions?: AgentPermissionsConfig,
  args?: Record<string, unknown>,
  extra?: { composioConfigured?: boolean },
): PermissionCheckResult {
  const classification = classifyTool(toolName, args);

  if (classification.domain === "system") {
    return { allowed: true, reason: "" };
  }

  if (classification.domain === "unknown") {
    // Fail closed on unclassified tools
    return {
      allowed: false,
      reason: `Unclassified tool "${toolName}" is blocked by security policy.`,
      domain: undefined,
    };
  }

  const domain = classification.domain;
  const state: AgentPermissionState = permissions?.[domain] ?? "granted";

  if (domain === "terminal") {
    if (state === "denied") {
      return {
        allowed: false,
        reason: "Terminal & Shell Execution is disabled in Settings -> Agent Permissions.",
        domain: "terminal",
        state: "denied",
      };
    }
    if (state === "restricted") {
      return {
        allowed: false,
        reason: "Terminal execution is restricted by the current environment.",
        domain: "terminal",
        state: "restricted",
      };
    }
    return { allowed: true, reason: "", domain: "terminal", state };
  }

  if (domain === "filesystem") {
    if (state === "denied") {
      return {
        allowed: false,
        reason: "Filesystem Read & Write is disabled in Settings -> Agent Permissions.",
        domain: "filesystem",
        state: "denied",
      };
    }
    if (state === "restricted") {
      return {
        allowed: false,
        reason: "Filesystem operations are restricted by the current environment.",
        domain: "filesystem",
        state: "restricted",
      };
    }
    return { allowed: true, reason: "", domain: "filesystem", state };
  }

  if (domain === "browser") {
    if (state === "denied") {
      return {
        allowed: false,
        reason: "Browser & Network is disabled in Settings -> Agent Permissions.",
        domain: "browser",
        state: "denied",
      };
    }
    if (state === "restricted") {
      return {
        allowed: false,
        reason: "Browser automation is restricted by the current environment.",
        domain: "browser",
        state: "restricted",
      };
    }
    return { allowed: true, reason: "", domain: "browser", state };
  }

  if (domain === "composio") {
    if (state === "denied") {
      return {
        allowed: false,
        reason: "Composio Integrations is disabled in Settings -> Agent Permissions.",
        domain: "composio",
        state: "denied",
      };
    }
    if (extra?.composioConfigured === false || state === "requires_configuration") {
      return {
        allowed: false,
        reason: "Composio capability requires configuration in Settings -> Connected Services.",
        domain: "composio",
        state: "requires_configuration",
      };
    }
    return { allowed: true, reason: "", domain: "composio", state };
  }

  return { allowed: true, reason: "" };
}

/**
 * Generate CLI disallowed tools flags for Claude CLI based on active permissions.
 */
export function disallowedToolsForPermissions(permissions?: AgentPermissionsConfig): string[] {
  const disallowed: string[] = [];

  if (permissions?.terminal === "denied") {
    disallowed.push("Bash", "Bash(*)");
  }

  if (permissions?.filesystem === "denied") {
    disallowed.push("ReadFile", "WriteFile", "EditFile", "GlobTool", "GrepTool");
  }

  if (permissions?.browser === "denied") {
    disallowed.push("WebSearch", "Fetch");
  }

  return disallowed;
}

/**
 * Load on-disk agent permissions from the active data directory.
 */
export function loadDiskPermissions(): AgentPermissionsConfig {
  try {
    const dataDir = process.env.OMB_DATA_DIR || (process.env.HOME ? join(process.env.HOME, ".openmausbot") : "");
    if (!dataDir) return {};
    const configPath = join(dataDir, "config.json");
    if (!existsSync(configPath)) return {};
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return (raw.agentPermissions as AgentPermissionsConfig) ?? {};
  } catch {
    return {};
  }
}
