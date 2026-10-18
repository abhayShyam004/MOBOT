// Phase 7 (Android browser): the bots' browser tools on Android.
//
// The engine is Android's own WebView — the platform browser the OS itself
// ships and updates — owned app-side by BrowserDriverServer (one androidx.webkit
// Profile per bot session, so cookies/localStorage/history are isolated per
// bot). This process is the MCP boundary: it speaks the same newline-delimited
// JSON-RPC the harness's chat transport speaks (protocolVersion 2024-11-05,
// same as android-computer.ts), exposes the browser_* tools, applies the
// session identity, and maps the driver's {ok,error} shape onto tool results.
//
// What it deliberately is NOT: no CDP, no Chrome, no agent-browser. Desktop's
// engine publishes no android-arm(64) build; the WebView adapter is the
// smallest architecture that satisfies the tool contract (see
// ANDROID_PORT_ARCHITECTURE.md §13). No addJavascriptInterface bridge exists
// in either direction; evaluateJavascript returning text is the only JS path.
// No credentials reach this process: the harness env carries the driver's
// loopback port, capability token, and the bot's session name — paths/ports,
// never secrets (the Phase 4 rule, unchanged).
//
// Approval rides the existing permission-card flow: every tool call here is
// subject to the harness's per-call approval exactly like android_computer's,
// so a browser session the user authorized for a bot does not re-ask for each
// navigation — the session grant IS the scope.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { checkToolPermission, loadDiskPermissions } from "./permission-policy.ts";

// ── env contract (set by HarnessHost.kt; fail closed, say why) ──────────────
const DRIVER_PORT = Number(process.env.AB_DRIVER_PORT ?? "0");
const DRIVER_TOKEN = process.env.AB_DRIVER_TOKEN ?? "";
if (!DRIVER_PORT || !DRIVER_TOKEN) {
  process.stderr.write("android-browser: AB_DRIVER_PORT/AB_DRIVER_TOKEN are not set — refusing to start\n");
  process.exit(2);
}
const SESSION_ROOT = process.env.AB_SESSIONS_ROOT ?? "";
if (!SESSION_ROOT) {
  process.stderr.write("android-browser: AB_SESSIONS_ROOT is not set\n");
  process.exit(2);
}
mkdirSync(SESSION_ROOT, { recursive: true });

const DRIVER_BASE = `http://127.0.0.1:${DRIVER_PORT}`;
const FRAME_BYTES = 2 * 1024 * 1024;
const MAX_FRAMES = 50_000;
// One tool result entering the model's context. A heavy page's text fits well
// under this; the driver caps extraction at 60k chars regardless.
const MAX_RESULT_BYTES = 24 * 1024;
const CALL_TIMEOUT_MS = 60_000;

// ── session identity: the bot's id comes in via env from the seeded entry ───
// HarnessHost cannot know the bot id (the server process is per-boot, bots are
// per-turn), so the MCP layer accepts the bot id as a tool argument and maps
// it to the same digest identity the app side uses. Tools take `botId` —
// validated, hashed, never passed through as a path component.
function sessionName(botId: unknown): string {
  if (typeof botId !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(botId)) {
    throw new Error("botId is required (the bot's own id, from context)");
  }
  const digest = createHash("sha256").update(botId).digest("hex");
  return `omb-${digest.slice(0, 32)}`;
}

type RpcMessage = { id?: number | string | null; method?: string; params?: unknown };

let buffer = "";
let frames = 0;

function writeFrame(frame: unknown): void {
  const line = JSON.stringify(frame) + "\n";
  if (Buffer.byteLength(line) > FRAME_BYTES) throw new Error("frame too large");
  process.stdout.write(line);
}

function reply(id: number | string, result: unknown): void {
  writeFrame({ jsonrpc: "2.0", id, result });
}

function replyError(id: number | string, message: string, code = -32603): void {
  writeFrame({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── driver client (loopback, token-checked) ─────────────────────────────────

async function driver(action: string, session: string, body: Record<string, unknown> = {}, binary = false): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await fetch(`${DRIVER_BASE}/session/${session}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DRIVER_TOKEN}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`browser driver HTTP ${response.status}`);
    if (binary) return Buffer.from(await response.arrayBuffer());
    const payload = await response.json() as { ok?: boolean; error?: string };
    if (payload.ok === false) throw new Error(payload.error ?? "browser action failed");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function toolError(message: string): Record<string, unknown> {
  return { ok: false, error: message };
}

/** Bounded string: never cut raw text mid-surrogate, keep re-serialization
 *  valid (same discipline as android-computer.ts). */
function bounded(text: string, limit = MAX_RESULT_BYTES, marker = " [truncated]"): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let end = limit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8") + marker;
}

function textResult(payload: unknown, isError = false): unknown {
  const full = JSON.stringify(payload, null, 1);
  if (Buffer.byteLength(full) <= MAX_RESULT_BYTES) {
    return { content: [{ type: "text", text: full }], ...(isError ? { isError: true } : {}) };
  }
  const shrunk: Record<string, unknown> = { ...(payload as Record<string, unknown>), truncated: true };
  const strings = Object.entries(shrunk).filter(([, v]) => typeof v === "string") as Array<[string, string]>;
  const totalStringBytes = strings.reduce((sum, [, v]) => sum + Buffer.byteLength(v), 0);
  const otherBytes = Buffer.byteLength(full) - totalStringBytes;
  if (totalStringBytes > 0 && otherBytes < MAX_RESULT_BYTES) {
    const budget = MAX_RESULT_BYTES - otherBytes - 256;
    for (const [name, value] of strings) {
      shrunk[name] = bounded(value, Math.max(1024, Math.floor(budget * (Buffer.byteLength(value) / totalStringBytes))));
    }
  }
  return { content: [{ type: "text", text: JSON.stringify(shrunk, null, 1) }], ...(isError ? { isError: true } : {}) };
}

/** Screenshot result: an MCP image content part, base64 JPEG (bounded size). */
function imageResult(jpeg: Buffer): unknown {
  return { content: [{ type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" }] };
}

// ── tool handlers ───────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

async function requireSession(args: Record<string, unknown>): Promise<string> {
  return sessionName(args.botId);
}

const TOOLS: Record<string, { description: string; inputSchema: Record<string, unknown>; handler: ToolHandler }> = {
  browser_open: {
    description: "Open a URL in this bot's browser and wait for the page to load. Only http/https; private and loopback addresses are refused. The browser session is this bot's own — cookies and storage are isolated per bot.",
    inputSchema: { type: "object", properties: { botId: { type: "string" }, url: { type: "string", description: "Absolute http(s) URL to open" } }, required: ["botId", "url"] },
    handler: async (args) => driver("open", await requireSession(args), { url: String(args.url ?? "") }),
  },
  browser_navigate: {
    description: "Navigate the current tab to a new URL (same session, same isolation).",
    inputSchema: { type: "object", properties: { botId: { type: "string" }, url: { type: "string" } }, required: ["botId", "url"] },
    handler: async (args) => driver("navigate", await requireSession(args), { url: String(args.url ?? "") }),
  },
  browser_status: {
    description: "Current page URL, title, load progress and back/forward availability.",
    inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
    handler: async (args) => driver("status", await requireSession(args)),
  },
  browser_back: {
    description: "Go back one page in this bot's browser history.",
    inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
    handler: async (args) => driver("back", await requireSession(args)),
  },
  browser_forward: {
    description: "Go forward one page in this bot's browser history.",
    inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
    handler: async (args) => driver("forward", await requireSession(args)),
  },
  browser_get_text: {
    description: "Read the page's visible text, bounded (default 20,000 characters). Prefer this over re-snapshotting a page.",
    inputSchema: { type: "object", properties: { botId: { type: "string" }, maxChars: { type: "integer", minimum: 200, maximum: 60_000 } }, required: ["botId"] },
    handler: async (args) => driver("text", await requireSession(args), { maxChars: Number(args.maxChars ?? 20_000) }),
  },
  browser_dom: {
    description: "Inspect the page's interactive elements (links, buttons, inputs) with @eN refs for click/type. Bounded to the first N elements with visible size.",
    inputSchema: { type: "object", properties: { botId: { type: "string" }, maxElements: { type: "integer", minimum: 10, maximum: 400 } }, required: ["botId"] },
    handler: async (args) => driver("dom", await requireSession(args), { maxElements: Number(args.maxElements ?? 120) }),
  },
  browser_click: {
    description: "Click an element by @eN ref from browser_dom (scrolls it into view first).",
    inputSchema: { type: "object", properties: { botId: { type: "string" }, ref: { type: "string", description: "@eN from browser_dom" } }, required: ["botId", "ref"] },
    handler: async (args) => driver("click", await requireSession(args), { ref: String(args.ref ?? "") }),
  },
  browser_type: {
    description: "Type text into an input/textarea by @eN ref (clears the field first by default, fires input/change events).",
    inputSchema: { type: "object", properties: { botId: { type: "string" }, ref: { type: "string" }, text: { type: "string" }, clear: { type: "boolean" } }, required: ["botId", "ref", "text"] },
    handler: async (args) => driver("type", await requireSession(args), { ref: String(args.ref ?? ""), text: String(args.text ?? ""), clear: args.clear !== false }),
  },
  browser_eval: {
    description: "Run JavaScript in the page's context and return the result as text. Page code can reach nothing of the app or other bots — this is read/write to the page only.",
    inputSchema: { type: "object", properties: { botId: { type: "string" }, expression: { type: "string" } }, required: ["botId", "expression"] },
    handler: async (args) => driver("eval", await requireSession(args), { expression: String(args.expression ?? "") }),
  },
  browser_screenshot: {
    description: "Capture the current page as a JPEG image (bounded size).",
    inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
    handler: async (args) => {
      const jpeg = await driver("screenshot", await requireSession(args), {}, true) as Buffer;
      return imageResult(jpeg);
    },
  },
  browser_cookies: {
    description: "List this session's cookies (per-bot isolated; other bots' cookies are invisible by construction).",
    inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
    handler: async (args) => driver("cookies", await requireSession(args)),
  },
  browser_clear: {
    description: "Clear this bot's browser state: cookies, storage, history. Other bots are unaffected.",
    inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
    handler: async (args) => driver("clear", await requireSession(args)),
  },
  browser_close: {
    description: "Close this bot's browser session and destroy its state on the phone.",
    inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
    handler: async (args) => driver("close", await requireSession(args)),
  },
  browser_persist: {
    description: "Flush this session's cookies to storage so logins survive an app restart (where the platform supports it).",
    inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
    handler: async (args) => driver("persist", await requireSession(args)),
  },
};

const TOOL_LIST = Object.entries(TOOLS).map(([name, spec]) => ({ name, description: spec.description, inputSchema: spec.inputSchema }));

let shuttingDown = false;
process.on("SIGTERM", () => {
  shuttingDown = true;
  process.exit(0);
});
process.on("SIGINT", () => process.exit(0));

function handle(message: RpcMessage): void {
  const id = message.id;
  if (typeof id !== "number" && typeof id !== "string") return;
  if (message.method === "initialize") {
    reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "android_browser", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "tools/list") {
    reply(id, { tools: TOOL_LIST });
    return;
  }
  if (message.method === "tools/call") {
    const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = typeof params.name === "string" ? params.name : "";
    const spec = TOOLS[name];
    if (!spec) {
      replyError(id, `unknown tool: ${name}`, -32602);
      return;
    }
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const perm = checkToolPermission(name, loadDiskPermissions(), args);
    if (!perm.allowed) {
      reply(id, textResult(toolError(perm.reason || "Browser access is disabled in Settings -> Agent Permissions"), true));
      return;
    }
    Promise.resolve()
      .then(() => spec.handler(args))
      .then(
        (result) => {
          if (shuttingDown) return;
          const failed = (result as { ok?: unknown }).ok === false && !("data" in (result as object));
          reply(id, textResult(result, failed));
        },
        (error) => {
          if (shuttingDown) return;
          const message = error instanceof Error ? error.message : String(error);
          reply(id, textResult(toolError(message), true));
        },
      );
    return;
  }
  if (message.method === "ping") {
    reply(id, {});
    return;
  }
  if (message.method === "notifications/initialized") return;
  replyError(id, "method not supported", -32601);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline: number;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    if (++frames > MAX_FRAMES) {
      process.stderr.write("android-browser: frame limit exceeded\n");
      process.exit(2);
    }
    if (Buffer.byteLength(line) > FRAME_BYTES) {
      process.stderr.write("android-browser: frame too large\n");
      process.exit(2);
    }
    let message: RpcMessage;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write("android-browser: invalid JSON frame\n");
      continue;
    }
    try {
      handle(message);
    } catch (error) {
      const id = (message as { id?: unknown }).id;
      if (typeof id === "number" || typeof id === "string") {
        replyError(id, error instanceof Error ? error.message : String(error));
      }
    }
  }
});
process.stdin.on("end", () => process.exit(0));
