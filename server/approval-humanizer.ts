/**
 * Approval Humanizer
 *
 * Transforms raw provider/MCP permission requests and tool calls into
 * human-readable action contracts:
 * - High-level human action title (e.g. "Read Email", "Open Discord")
 * - Natural language explanation of what MOBOT wants to perform
 * - Category classification: read, write, action, system
 * - Target extraction (e.g. account, package name, application)
 * - Strict prevention of raw JSON serialization, braces, or internal IDs in user-facing cards.
 */

export interface HumanizedApproval {
  title: string;
  subtitle: string;
  category: "read" | "write" | "action" | "system";
  target?: string;
  isReadOnly: boolean;
  operation: string;
}

const COMMON_APP_NAMES: Record<string, string> = {
  "com.discord": "Discord",
  "com.whatsapp": "WhatsApp",
  "com.google.android.gm": "Gmail",
  "com.google.android.youtube": "YouTube",
  "com.spotify.music": "Spotify",
  "com.slack": "Slack",
  "com.google.android.apps.messaging": "Messages",
  "com.google.android.apps.maps": "Google Maps",
  "com.google.android.calendar": "Google Calendar",
  "com.android.chrome": "Chrome",
  "org.mozilla.firefox": "Firefox",
};

export function humanLabelForPackage(packageName: string): string {
  const norm = packageName.trim().toLowerCase();
  if (COMMON_APP_NAMES[norm]) return COMMON_APP_NAMES[norm];
  const parts = norm.split(".");
  const last = parts[parts.length - 1] || packageName;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/**
 * Attempts to safely parse a JSON object or string if present.
 */
function tryParseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        return null;
      }
    }
    // Also check for 'Requested permissions: {...}'
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function isReadOnlyTool(tool: string, summary?: string): boolean {
  const norm = tool.toLowerCase().replace(/^mcp__[^_]+__/, "");
  const readPrefixes = [
    "gmail_fetch",
    "gmail_list",
    "gmail_get",
    "gmail_search",
    "read_screen",
    "take_screenshot",
    "get_location",
    "list_apps",
    "get_contact",
    "read_file",
    "status",
    "read",
  ];
  if (readPrefixes.some((p) => norm.startsWith(p) || norm === p)) {
    return true;
  }
  if (summary) {
    const s = summary.toLowerCase();
    if (/\b(?:read|fetch|list|inspect|view|search|get)\b/.test(s) && !/\b(?:delete|remove|send|write|mutate|modify|create|post)\b/.test(s)) {
      return true;
    }
  }
  return false;
}

function sanitizePathString(s: string): string {
  return s
    .replace(/\/data\/(?:user\/\d+|data)\/[^/\s'"]+\/files\/host\/(?:data\/)?(?:task-workspaces|workspaces)\/[^/\s'"]+\/?(?:data\/)?/gi, "")
    .replace(/\/data\/(?:user\/\d+|data)\/[^/\s'"]+\/?/gi, "");
}

export function humanizeApprovalRequest(options: {
  tool: string;
  summary?: string;
  parameters?: Record<string, unknown> | null;
  requestType?: "permission" | "question";
  approvalScope?: string;
  command?: string;
}): HumanizedApproval {
  const rawTool = options.tool || "";
  const normTool = rawTool
    .replace(/^mcp__(?:android_computer|android_browser|openmausbot-phone)__/i, "")
    .replace(/^mcp__[^_]+__/i, "")
    .replace(/^android_(?:computer|browser)_/i, "");
  const params = options.parameters || tryParseJson(options.summary) || {};
  const summaryStr = sanitizePathString(String(options.summary || "").trim());
  // A chat driver's own assessment (server/tool-approval.ts) arrives as prose:
  // the action, then a facts line ("Leaves this device: no · …"). Its first
  // line is the action itself, which is what the card's title is for — a
  // prettified tool name, or a canned branch's own verb, says less. Detected
  // up here so the tool-specific branches below defer to it instead of
  // replacing the driver's action with their own.
  const assessed = /^[^\n]+\n\n[^\n]*Leaves this device: /.test(summaryStr);

  // Workspace Tools
  if (normTool === "workspace_list" || normTool === "list_files") {
    return {
      title: "Inspect Workspace",
      subtitle: "MOBOT wants to inspect the files in your workspace.",
      category: "read",
      isReadOnly: true,
      operation: "workspace_list",
    };
  }

  if (normTool === "workspace_read" || normTool === "read_file") {
    const path = String(params.path || params.file || summaryStr).trim();
    const cleanPath = path ? sanitizePathString(path) : "";
    return {
      title: "Read File",
      subtitle: cleanPath ? `MOBOT wants to read ${cleanPath} in your workspace.` : "MOBOT wants to read a file in your workspace.",
      category: "read",
      isReadOnly: true,
      target: cleanPath || undefined,
      operation: "workspace_read",
    };
  }

  if (normTool === "workspace_write" || normTool === "write_file") {
    if (assessed) {
      return {
        title: sanitizePathString(summaryStr.split("\n")[0].trim()),
        subtitle: sanitizePathString(summaryStr),
        category: "write",
        isReadOnly: false,
        operation: "workspace_write",
      };
    }
    const explicitPath = String(params.path || params.file || "").trim();
    const summaryPath = summaryStr;
    // Prose is a summary, not a path: a caller that says "The bot wants to
    // write a file" must keep its prettified tool name rather than have the
    // sentence spliced into "MOBOT wants to write … in your workspace".
    if (!explicitPath && /\s/.test(summaryPath) && !summaryPath.startsWith("{")) {
      return {
        title: "Workspace Write",
        subtitle: summaryPath,
        category: "write",
        isReadOnly: false,
        operation: "workspace_write",
      };
    }
    const path = explicitPath || summaryPath;
    const cleanPath = path ? sanitizePathString(path) : "";
    return {
      title: "Create File",
      subtitle: cleanPath ? `MOBOT wants to write ${cleanPath} in your workspace.` : "MOBOT wants to create or modify a file in your workspace.",
      category: "write",
      isReadOnly: false,
      target: cleanPath || undefined,
      operation: "workspace_write",
    };
  }

  if (normTool === "artifact_register") {
    return {
      title: "Register Deliverable",
      subtitle: "MOBOT wants to register a generated deliverable.",
      category: "action",
      isReadOnly: false,
      operation: "artifact_register",
    };
  }

  // 1. Gmail Tools (Composio / MCP)
  if (/^gmail_/i.test(normTool) || /^GMAIL_/i.test(rawTool)) {
    if (/fetch|get/i.test(normTool)) {
      const msgId = String(params.message_id || params.messageId || params.id || "").trim();
      const account = String(params.user_id || params.userId || "me").trim();
      const idClause = msgId ? ` (ID: ${msgId.slice(0, 12)}${msgId.length > 12 ? "…" : ""})` : "";
      return {
        title: "Read Email",
        subtitle: `MOBOT wants to read an email message${idClause} to check details or invoice attachments.`,
        category: "read",
        isReadOnly: true,
        target: `Gmail (${account})`,
        operation: normTool,
      };
    }
    if (/list|search/i.test(normTool)) {
      const query = String(params.q || params.query || "").trim();
      const account = String(params.user_id || params.userId || "me").trim();
      const queryClause = query ? ` matching '${query}'` : "";
      return {
        title: "Search Emails",
        subtitle: `MOBOT wants to search your Gmail messages${queryClause}.`,
        category: "read",
        isReadOnly: true,
        target: `Gmail (${account})`,
        operation: normTool,
      };
    }
    if (/send/i.test(normTool)) {
      const recipient = String(params.to || params.recipient || "").trim();
      const toClause = recipient ? ` to ${recipient}` : "";
      return {
        title: "Send Email",
        subtitle: `MOBOT wants to send an email${toClause}.`,
        category: "write",
        isReadOnly: false,
        target: "Gmail",
        operation: normTool,
      };
    }
    if (/create_draft|draft/i.test(normTool)) {
      return {
        title: "Create Email Draft",
        subtitle: "MOBOT wants to create an email draft in your Gmail account.",
        category: "write",
        isReadOnly: false,
        target: "Gmail",
        operation: normTool,
      };
    }
  }

  // 2. Phone Control / Android Device Tools
  if (normTool === "open_app" || normTool === "launch_app" || rawTool === "device.phone_control" || rawTool === "device.apps") {
    const pkg = String(params.packageName || params.package || "").trim();
    const appLabel = pkg ? humanLabelForPackage(pkg) : "Application";
    return {
      title: `Open ${appLabel}`,
      subtitle: `MOBOT wants to open ${appLabel}${pkg ? ` (${pkg})` : ""} on your device.`,
      category: "action",
      isReadOnly: false,
      target: pkg || undefined,
      operation: "open_app",
    };
  }

  if (normTool === "read_screen") {
    return {
      title: "Inspect Screen",
      subtitle: "MOBOT wants to read the current UI hierarchy and content on your screen.",
      category: "read",
      isReadOnly: true,
      operation: "read_screen",
    };
  }

  if (normTool === "take_screenshot" || normTool === "screenshot") {
    return {
      title: "Take Screenshot",
      subtitle: "MOBOT wants to capture a screenshot of your screen.",
      category: "read",
      isReadOnly: true,
      operation: "take_screenshot",
    };
  }

  if (normTool === "tap") {
    const text = String(params.text || params.id || "").trim();
    const targetClause = text ? ` '${text}'` : "";
    return {
      title: "Tap Screen",
      subtitle: `MOBOT wants to tap${targetClause} on your screen.`,
      category: "action",
      isReadOnly: false,
      operation: "tap",
    };
  }

  if (normTool === "type_text") {
    return {
      title: "Type Text",
      subtitle: "MOBOT wants to enter text into the active field on your screen.",
      category: "action",
      isReadOnly: false,
      operation: "type_text",
    };
  }

  // 3. Agent & Session Workspace Tools
  if (normTool === "agents_session_search" || normTool === "session_search") {
    return {
      title: "Search Project Activity",
      subtitle: "MOBOT wants to search your recent project files and session history.",
      category: "read",
      isReadOnly: true,
      operation: "agents_session_search",
    };
  }

  if (normTool === "agents_select_computer" || normTool === "select_computer") {
    return {
      title: "Connect Computer",
      subtitle: "MOBOT wants to connect to your computer workspace.",
      category: "action",
      isReadOnly: false,
      operation: "agents_select_computer",
    };
  }

  // 4. Command Execution / Shell
  if (normTool === "shell" || normTool === "bash" || normTool === "terminal" || normTool === "run_shell" || normTool === "run_command") {
    const cmd = String(options.command || params.command || params.cmd || summaryStr).trim();
    const isRead = isReadOnlyTool(normTool, cmd);
    const cleanCmd = cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd;
    return {
      title: isRead ? "Inspect Terminal / File" : "Execute Command",
      subtitle: cleanCmd ? `Run: ${cleanCmd}` : "MOBOT wants to run a shell command.",
      category: isRead ? "read" : "write",
      isReadOnly: isRead,
      operation: "shell",
    };
  }

  // 4. File Changes
  if (normTool === "edit" || normTool === "file_change") {
    const path = String(params.path || params.file || summaryStr).trim();
    return {
      title: "Edit File",
      subtitle: path ? `Modify ${path}` : "MOBOT wants to modify a project file.",
      category: "write",
      isReadOnly: false,
      operation: "edit",
    };
  }

  // 5. Questions / User Input
  if (options.requestType === "question" || normTool === "ask_user" || normTool === "askuserquestion") {
    return {
      title: "Question from MOBOT",
      subtitle: summaryStr || "MOBOT needs additional information to continue.",
      category: "read",
      isReadOnly: true,
      operation: "ask_user",
    };
  }

  // 6. Generic MCP / Provider fallback: clean up JSON formatting
  const isRead = isReadOnlyTool(normTool, summaryStr);
  let cleanSubtitle = summaryStr;

  // An assessment is already written for a person, so the JSON cleanup below
  // must not run on it: it would find the `Arguments:` payload, flatten that,
  // and throw away the action, the destination and whether the step can be
  // undone.

  // Clean raw JSON strings from subtitle
  const jsonParsed = assessed ? null : tryParseJson(cleanSubtitle);
  if (jsonParsed) {
    const entries = Object.entries(jsonParsed)
      .filter(([k]) => !k.startsWith("_") && k !== "transport" && k !== "connector")
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ");
    cleanSubtitle = entries || "Permission requested for action";
  } else if (cleanSubtitle.startsWith("Requested permissions:")) {
    const innerJson = tryParseJson(cleanSubtitle);
    if (innerJson) {
      const keys = Object.keys(innerJson).join(", ");
      cleanSubtitle = keys ? `Permissions requested: ${keys}` : "External permissions requested";
    }
  }

  const cleanTitle = normTool
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const assessedAction = assessed ? sanitizePathString(summaryStr.split("\n")[0].trim()) : "";

  return {
    title: assessedAction || (options.approvalScope === "local-computer" ? "Local Computer Approval" : cleanTitle || "Approval Needed"),
    subtitle: sanitizePathString(cleanSubtitle) || "MOBOT requires your approval to proceed with this action.",
    category: isRead ? "read" : "action",
    isReadOnly: isRead,
    operation: normTool,
  };
}
