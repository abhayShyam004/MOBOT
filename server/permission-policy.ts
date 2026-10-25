import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentPermissionsConfig, AgentPermissionState } from "./config.ts";

export const ERR_CROSS_BOT_MEMORY_LEAK = "ERR_CROSS_BOT_MEMORY_LEAK";

export class CrossBotMemoryLeakError extends Error {
  readonly code = ERR_CROSS_BOT_MEMORY_LEAK;
  readonly category = "permission_denied" as const;
  readonly requestingBotId: string;
  readonly targetBotId: string;

  constructor(requestingBotId: string, targetBotId: string, message?: string) {
    super(
      message ??
        `${ERR_CROSS_BOT_MEMORY_LEAK}: Bot "${requestingBotId}" cannot access private memory partition of Bot "${targetBotId}".`,
    );
    this.name = "CrossBotMemoryLeakError";
    this.requestingBotId = requestingBotId;
    this.targetBotId = targetBotId;
  }
}

export interface MemoryAccessRequest {
  requestingBotId: string;
  targetBotId: string;
  operation: "read" | "write" | "query";
  path?: string;
}

const VALID_BOT_ID = /^[\w-]{1,128}$/;

/**
 * Authoritative cross-bot memory permission boundary enforcement.
 * Blocks any attempt by one bot to read, write, or query another bot's private memory partition.
 * Defends against direct bot references, path traversals, and percent-encoded variations.
 */
export function checkMemoryAccessPermission(req: MemoryAccessRequest): {
  allowed: boolean;
  error?: string;
  category?: "permission_denied";
} {
  const { requestingBotId, targetBotId, operation, path } = req;

  if (!requestingBotId || !VALID_BOT_ID.test(requestingBotId)) {
    return {
      allowed: false,
      error: `${ERR_CROSS_BOT_MEMORY_LEAK}: Invalid or unknown requesting botId "${requestingBotId}".`,
      category: "permission_denied",
    };
  }

  // Inspect path if specified
  if (path) {
    let clean: string;
    try {
      clean = decodeURIComponent(path).replace(/\\/g, "/");
    } catch {
      return {
        allowed: false,
        error: `${ERR_CROSS_BOT_MEMORY_LEAK}: Malformed encoded path "${path}".`,
        category: "permission_denied",
      };
    }

    // Traversal check
    const segments = clean.split("/");
    if (segments.some((s) => s === ".." || (s === "." && clean !== "."))) {
      return {
        allowed: false,
        error: `${ERR_CROSS_BOT_MEMORY_LEAK}: Path traversal blocked in memory path "${path}".`,
        category: "permission_denied",
      };
    }

    // Explicit cross-bot path target check (e.g. bots/otherBot/... or workspaces/otherBot/...)
    const botMatch = clean.match(/^(?:bots\/|workspaces\/)([\w-]+)\//);
    if (botMatch && botMatch[1] !== requestingBotId && botMatch[1] !== "shared") {
      return {
        allowed: false,
        error: `${ERR_CROSS_BOT_MEMORY_LEAK}: Cross-bot path access blocked from "${requestingBotId}" to "${botMatch[1]}".`,
        category: "permission_denied",
      };
    }
  }

  // Shared target partition: universally readable by any bot
  if (targetBotId === "shared") {
    return { allowed: true };
  }

  // Private bot partition: Bot A cannot access Bot B's private partition under any circumstance
  if (targetBotId !== requestingBotId) {
    return {
      allowed: false,
      error: `${ERR_CROSS_BOT_MEMORY_LEAK}: Bot "${requestingBotId}" cannot ${operation} private memory partition of Bot "${targetBotId}".`,
      category: "permission_denied",
    };
  }

  return { allowed: true };
}

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
  "port_forward_create",
  "port_forward_list",
  "port_forward_close",
]);

const PHONE_TOOL_NAMES = new Set([
  "status",
  "read_screen",
  "screenshot",
  "list_apps",
  "open_app",
  "tap_text",
  "tap",
  "swipe",
  "type_text",
  "clear_text",
  "press",
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
  "resource_extract_pdf_text",
  "resource_extract_pdf",
  "resource_artifact_info",
  "resource_list",
]);

const BROWSER_TOOL_NAMES = new Set([
  "http_fetch",
  "web_search",
  "Fetch",
  "WebSearch",
  "resource_inspect",
  "resource_fetch",
  "resource_download",
  "resource_extract_links",
  "resource_extract_html",
  "resource_artifacts",
  "browser_open",
  "browser_navigate",
  "browser_status",
  "browser_back",
  "browser_forward",
  "browser_get_text",
  "browser_dom",
  "browser_click",
  "browser_type",
  "browser_eval",
  "browser_screenshot",
  "browser_cookies",
  "browser_clear",
  "browser_close",
  "browser_persist",
  "browser_scroll",
  "browser_fill",
  "browser_tabs",
  "browser_press",
  "browser_hover",
  "browser_evaluate",
]);

const KNOWN_BROWSER_ACTIONS = new Set([
  "open",
  "navigate",
  "status",
  "back",
  "forward",
  "get_text",
  "dom",
  "click",
  "type",
  "eval",
  "screenshot",
  "cookies",
  "clear",
  "close",
  "persist",
  "scroll",
  "fill",
  "tabs",
  "press",
  "hover",
  "evaluate",
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
 * Strip common adapter and MCP namespace prefixes to inspect the underlying tool operation.
 */
function stripMcpPrefix(name: string): string {
  // mcp__<server>__<tool>
  const mcpMatch = /^mcp__[a-zA-Z0-9_-]+__(.+)$/i.exec(name);
  if (mcpMatch) return mcpMatch[1];
  // android_browser_<tool>
  const abMatch = /^android_browser_(.+)$/i.exec(name);
  if (abMatch) return abMatch[1];
  // android_computer_<tool>
  const acMatch = /^android_computer_(.+)$/i.exec(name);
  if (acMatch) return acMatch[1];
  return name;
}

/**
 * Classify a tool call into its canonical permission domain, system status, or unknown.
 */
export function classifyTool(
  toolName: string,
  args?: Record<string, unknown>,
): { domain: PermissionDomain | "system" | "unknown"; label: string } {
  const normalized = toolName.trim();
  const stripped = stripMcpPrefix(normalized);

  if (
    SYSTEM_TOOL_NAMES.has(normalized) ||
    SYSTEM_TOOL_NAMES.has(stripped) ||
    /^(plan_|task_)/i.test(normalized) ||
    /^(plan_|task_)/i.test(stripped)
  ) {
    return { domain: "system", label: "System Collaboration" };
  }

  // Handle dynamic device capability tool
  if (normalized === "device_capability_invoke" || stripped === "device_capability_invoke") {
    if (args) {
      const capId = String(args.capabilityId || "");
      if (capId === "device.files") return { domain: "filesystem", label: PERMISSION_DOMAINS.filesystem.title };
      if (capId === "device.browser" || capId === "device.network") return { domain: "browser", label: PERMISSION_DOMAINS.browser.title };
      if (capId.startsWith("device.")) return { domain: "system", label: "Device Native Capability" };
    }
    return { domain: "system", label: "Device Native Capability" };
  }

  // Legitimate browser tools check:
  // Must be in BROWSER_TOOL_NAMES, or have an authentic browser action suffix
  const isAuthenticBrowser =
    BROWSER_TOOL_NAMES.has(normalized) ||
    BROWSER_TOOL_NAMES.has(stripped) ||
    (stripped.startsWith("browser_") && KNOWN_BROWSER_ACTIONS.has(stripped.slice("browser_".length))) ||
    KNOWN_BROWSER_ACTIONS.has(stripped) ||
    /^(preview_|deployment_|verify_service)/i.test(normalized) ||
    /^(preview_|deployment_|verify_service)/i.test(stripped);

  // If a tool explicitly claims the android_browser namespace, verify it is an authentic browser tool
  if (normalized.startsWith("android_browser_") || normalized.startsWith("mcp__android_browser__")) {
    if (isAuthenticBrowser) {
      return { domain: "browser", label: PERMISSION_DOMAINS.browser.title };
    }
    return { domain: "unknown", label: "Unclassified Tool" };
  }

  // Android computer namespace verification
  if (normalized.startsWith("android_computer_") || normalized.startsWith("mcp__android_computer__")) {
    if (isAuthenticBrowser) {
      return { domain: "browser", label: PERMISSION_DOMAINS.browser.title };
    }
    if (
      TERMINAL_TOOL_NAMES.has(stripped) ||
      PHONE_TOOL_NAMES.has(stripped) ||
      /^(bash|sh|terminal_|shell_|exec_|process_|build_|test_|project_git_|repair_|phone_)/i.test(stripped)
    ) {
      return { domain: "terminal", label: PERMISSION_DOMAINS.terminal.title };
    }
    if (
      FILESYSTEM_TOOL_NAMES.has(stripped) ||
      /^(fs_|file_|workspace_|artifact_|project_(create|open|read|write|patch|delete|rename|list)|verify_file|verify_artifact|verify_image)/i.test(stripped)
    ) {
      return { domain: "filesystem", label: PERMISSION_DOMAINS.filesystem.title };
    }
    return { domain: "unknown", label: "Unclassified Tool" };
  }

  if (isAuthenticBrowser) {
    return { domain: "browser", label: PERMISSION_DOMAINS.browser.title };
  }

  if (
    TERMINAL_TOOL_NAMES.has(normalized) ||
    TERMINAL_TOOL_NAMES.has(stripped) ||
    PHONE_TOOL_NAMES.has(normalized) ||
    PHONE_TOOL_NAMES.has(stripped) ||
    /^(bash|sh|terminal_|shell_|exec_|process_|build_|test_|project_git_|repair_|mcp__openmausbot-phone__|phone_)/i.test(normalized) ||
    /^(bash|sh|terminal_|shell_|exec_|process_|build_|test_|project_git_|repair_|phone_)/i.test(stripped)
  ) {
    return { domain: "terminal", label: PERMISSION_DOMAINS.terminal.title };
  }

  if (
    FILESYSTEM_TOOL_NAMES.has(normalized) ||
    FILESYSTEM_TOOL_NAMES.has(stripped) ||
    /^(fs_|file_|workspace_|artifact_|project_(create|open|read|write|patch|delete|rename|list)|verify_file|verify_artifact|verify_image)/i.test(normalized) ||
    /^(fs_|file_|workspace_|artifact_|project_(create|open|read|write|patch|delete|rename|list)|verify_file|verify_artifact|verify_image)/i.test(stripped)
  ) {
    return { domain: "filesystem", label: PERMISSION_DOMAINS.filesystem.title };
  }

  if (
    normalized.startsWith("mcp__composio") ||
    normalized.startsWith("composio_") ||
    stripped.startsWith("composio_") ||
    /^composio/i.test(normalized) ||
    /^composio/i.test(stripped)
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
  extra?: { composioConfigured?: boolean; botId?: string; requestingBotId?: string },
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
    // Authoritative cross-bot memory / workspace boundary verification
    const requestingBot = extra?.requestingBotId ?? extra?.botId ?? (typeof args?.requestingBotId === "string" ? args.requestingBotId : undefined);
    const pathArg = typeof args?.path === "string" ? args.path : (typeof args?.filePath === "string" ? args.filePath : undefined);
    if (requestingBot && pathArg) {
      const memCheck = checkMemoryAccessPermission({
        requestingBotId: String(requestingBot),
        targetBotId: String(requestingBot),
        operation: "read",
        path: pathArg,
      });
      if (!memCheck.allowed) {
        return {
          allowed: false,
          reason: memCheck.error ?? `${ERR_CROSS_BOT_MEMORY_LEAK}: Cross-bot memory access blocked.`,
          domain: "filesystem",
          state: "denied",
        };
      }
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
