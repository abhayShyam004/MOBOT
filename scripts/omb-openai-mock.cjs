// Deterministic OpenAI-compatible provider mock for on-device slice testing.
//
// Why a mock: a real LLM turn spends money and is non-deterministic; the
// thing under test is the OpenMausBot agent/tool/permission/workspace stack,
// which stays fully real. The mock stands in ONLY for the paid provider and
// scripts the agent through every android_computer tool class:
//
//   cue-write   → android_computer_workspace_write (approval card → file)
//   cue-cmd     → android_computer_run_command  (uname -m → ABI on device)
//   cue-fetch   → android_computer_http_fetch   (live HTTPS GET)
//   cue-search  → android_computer_web_search   (live DuckDuckGo results)
//   cue-rate-limit → the provider refuses EVERY attempt with HTTP 429 and the
//                    JSON body a real gateway sends. No turn is served, so the
//                    harness must exhaust its retry policy and settle — which
//                    is where the failure card comes from. The request-level
//                    refusal is deliberately not a tool cue: it has to hold for
//                    every attempt of the same turn, and for the retry.
//
// Protocol: turn N sees the conversation; if a role:"tool" result appears
// AFTER the newest user message, the cue was executed and the reply echoes a
// deterministic marker from the result (DONE CMD/ WROTE/ FETCH/ SEARCH).
// Otherwise it emits the cue's tool call. Stateless — no session state.
//
// Run on the DEVICE itself (app-private node, port 28798) by
// scripts/test-android-slice.mjs; pairing with the host loopback needs no
// adb tunnel because the harness fetches from the same phone.
const http = require("node:http");

const PORT = Number(process.argv[2] || 28798);

const CUES = {
  // Voluntary structured ask_user. Each cue scripts ONE typed question; the
  // server blocks the turn on the card, the driver answers over the same
  // HTTP route the app's own UI uses, and the answer returns as the tool
  // result — so the mock's next reply is `DONE <answer text>`, which proves
  // the SAME turn resumed with the answer rather than starting over.
  "cue-ask-single": {
    tool: "ask_user",
    args: {
      question: "Which local cache should the new index use?",
      type: "single_choice",
      choices: [
        { id: "sqlite", label: "SQLite", description: "One file, no server; matches the rest of the app." },
        { id: "leveldb", label: "LevelDB", description: "Key-value store; faster writes, less queryable." },
      ],
    },
  },
  "cue-ask-multi": {
    tool: "ask_user",
    args: {
      question: "Which providers should this bot enable?",
      type: "multiple_choice",
      choices: [
        { id: "openai", label: "OpenAI", description: "Broadest model catalog." },
        { id: "qwen", label: "Qwen", description: "Cheap, strong at code." },
        { id: "google", label: "Google", description: "Long context windows." },
      ],
      minSelections: 1,
      maxSelections: 2,
      allowOther: false,
    },
  },
  "cue-ask-confirm": {
    tool: "ask_user",
    args: {
      question: "Delete the staging database and all of its local backups?",
      type: "confirmation",
      choices: [],
    },
  },
  "cue-ask-free": {
    tool: "ask_user",
    args: {
      question: "How should the retry loop behave when the provider returns 429?",
      type: "free_text",
    },
  },
  "cue-write": {
    tool: "android_computer_workspace_write",
    args: { path: "agent-proof.txt", content: "written by the phone-hosted agent through the approval flow" },
  },
  "cue-cmd": { tool: "android_computer_run_command", args: { command: "uname", args: ["-m"] } },
  "cue-fetch": {
    tool: "android_computer_http_fetch",
    args: { url: "https://api.github.com/zen", headers: { "user-agent": "openmausbot-device-slice" } },
  },
  "cue-search": { tool: "android_computer_web_search", args: { query: "OpenMausBot Android agent", limit: 3 } },
  // Phase 5: cue-mcpwrite <file> drives a custom MCP server tool. Server
  // "ombmcp" + tool "ombmcp_write" mount as ombmcp_ombmcp_write.
  "cue-mcpwrite": { tool: "ombmcp_ombmcp_write", args: { dynamic: "filename-after-cue" } },
  // Phase 5 remote leg: cue-remotewrite <tool> <file> drives a mounted
  // remote MCP tool whose name is resolved dynamically from the tool list
  // (the cue text carries the unmounted tool name; matching is by suffix).
  "cue-remotewrite": { tool: "dynamic", args: { dynamic: "tool-and-filename-after-cue" } },
};

function lastUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function toolPayload(message) {
  const raw = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part) => part?.text ?? "").join("")
      : "";
  try { return JSON.parse(raw); } catch { return null; }
}

function doneReply(messages) {
  const start = lastUserIndex(messages);
  for (let i = start + 1; i < messages.length; i += 1) {
    if (messages[i].role !== "tool") continue;
    const payload = toolPayload(messages[i]);
    if (!payload) continue;
    // The wire shape the server actually sends for EVERY tool result
    // (openai-chat.ts): { ok, result } where result is safe text. A denied
    // call arrives here as { ok: false, result: "Permission denied…" }.
    if (typeof payload.result === "string" && payload.result.trim()) {
      return payload.ok ? `DONE ${payload.result.trim()}` : `MCPERROR ${payload.result.trim()}`;
    }
    // Legacy/tolerated shapes (kept so a server-side change to richer
    // payloads degrades to a specific DONE, never to a bare one).
    if (Array.isArray(payload.content)) {
      const text = payload.content.map((c) => c?.text ?? "").join(" ").trim();
      if (text) return payload.isError ? `MCPERROR ${text}` : `DONE ${text}`;
    }
    if (typeof payload.stdout === "string" && payload.stdout.trim()) return `DONE CMD ${payload.stdout.trim()}`;
    if (payload.bytesWritten !== undefined) return `DONE WROTE ${payload.path ?? ""}`.trim();
    if (payload.status !== undefined) return `DONE FETCH ${payload.status}`;
    if (Array.isArray(payload.results)) {
      return `DONE SEARCH ${payload.results.length} ${payload.results[0]?.url ?? ""}`.trim();
    }
  }
  const userText = start >= 0 ? messages[start]?.content : "";
  if (typeof userText === "string" && userText.includes("cue-skill-probe")) {
    const sysMsg = messages.find((m) => m.role === "system")?.content || "";
    const hasUiUx = sysMsg.includes('id="ui-ux-pro-max"');
    const hasTaste = sysMsg.includes('id="taste"');
    return `DONE SKILLS ui-ux-pro-max:${hasUiUx ? "ACTIVE" : "NONE"} taste:${hasTaste ? "ACTIVE" : "NONE"}`;
  }
  return "DONE";
}

// Mounted tool names are server-derived (chat-mcp-tools.ts normalizes
// `${serverName}_${toolName}`), so the cue resolves the write tool from the
// tool list the server actually sent — never a hardcoded name. A missing
// MCP tool (mount failed) yields null → a plain DONE reply, which the
// device driver treats as loud evidence the discovery leg failed.
function mcpWriteTool(tools) {
  return (tools ?? [])
    .map((t) => t?.function?.name ?? t?.name)
    .find((n) => typeof n === "string" && n.endsWith("_ombmcp_write")) ?? null;
}

function cueFor(messages, tools) {
  const start = lastUserIndex(messages);
  const fresh = start === -1 ? [] : messages.slice(start + 1);
  if (fresh.some((m) => m.role === "tool")) return null; // executed → DONE
  const text = (messages[start]?.content ?? "") + "";
  const lower = text.toLowerCase();
  // The LATEST mention wins, not the first. A turn whose provider session was
  // not resumed arrives as a replay of the whole thread (turn-context.ts)
  // ending in "[Now reply to the user's latest message:]" and the new
  // request, so an earlier cue's words are still in the text. The cue this
  // turn is actually about is the one mentioned last.
  let match = null;
  for (const [cue, spec] of Object.entries(CUES)) {
    const at = lower.lastIndexOf(cue);
    if (at === -1) continue;
    if (!match || at > match.at) match = { at, cue, spec };
  }
  if (!match) return null;
  const { cue, spec } = match;
  // cue-mcpwrite takes its target file from the user text itself; strip
  // trailing punctuation so the artifact name is a plain filename.
  if (cue === "cue-mcpwrite") {
    const tool = mcpWriteTool(tools);
    if (!tool) return null;
    const raw = text.split(/\s+/).find((w) => w.includes(".txt")) ?? "mcp-proof.txt";
    const file = raw.replace(/[.,;:!?)\]}'"]+$/g, "");
    return { tool, args: { path: file, text: `written by the ombmcp MCP server at ${new Date().toISOString()}` } };
  }
  if (cue === "cue-remotewrite") {
    // The mounted remote tool is any catalog entry ending in _write
    // that is NOT the stdio fixture's (cue-remotewrite runs on the
    // remote-only leg where ombmcp is not registered).
    const tool = (tools ?? [])
      .map((t) => t?.function?.name ?? t?.name)
      .find((n) => typeof n === "string" && n.endsWith("_write") && !n.includes("android_computer")) ?? null;
    if (!tool) return null;
    // The remote fixture's write tool keys its receipt by name=value, not
    // filename, so the cue text's token is not needed here (unlike
    // cue-mcpwrite below, where the file name IS the argument).
    return { tool, args: { name: "receipt", value: "done" } };
  }
  return spec;
}

function sse(res, chunks) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let i = 0;
  const tick = () => {
    if (i >= chunks.length) {
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", model: "mock-1", choices: [{ index: 0, delta: chunks[i], finish_reason: null }] })}\n\n`);
    i += 1;
    setTimeout(tick, 30);
  };
  tick();
}

// Release-gated hold for the capacity-race replay: a message containing
// "cue-hold <token>" keeps the provider request open (the turn stays busy)
// until files/omb-rel-<token> appears next to this script. The device driver
// creates release files through run-as to control completion order.
function heldToken(messages) {
  const start = lastUserIndex(messages);
  if (start === -1) return null;
  if (messages.slice(start + 1).some((m) => m.role === "tool")) return null;
  const match = /cue-hold[\s_-]+([\w-]+)/.exec(messages[start]?.content ?? "");
  return match ? match[1] : null;
}

// cue-rate-limit is read off the CONVERSATION, not off the latest user
// message: a retried request replays the same messages, and the refusal has to
// hold for every attempt — including attempt three — or the mock would answer
// the last try and never exercise the exhausted path. Every request is counted
// so the device driver can read the real attempt count out of the mock's log
// (files/ombmock.log) instead of trusting the card's own claim.
let rateLimited = 0;
function wantsRateLimit(messages) {
  return (messages ?? []).some((m) => typeof m.content === "string" && m.content.includes("cue-rate-limit"));
}
function rateLimitPayload() {
  return { error: { message: "Provider returned error", type: "rate_limit_exceeded", code: 429 } };
}

function awaitRelease(token, timeoutMs = 90_000) {
  const path = require("node:path").join(__dirname, `omb-rel-${token}`);
  const fs = require("node:fs");
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (fs.existsSync(path)) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
}

const server = http.createServer(async (req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });    req.on("end", async () => {
    const url = req.url.split("?")[0];
    if (url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "mock-1", object: "model" }, { id: "mock-large", object: "model" }] }));
    }
    if (url.endsWith("/chat/completions")) {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const messages = parsed.messages || [];
      if (wantsRateLimit(messages)) {
        rateLimited += 1;
        console.log(`rate-limited completion attempt ${rateLimited}`);
        res.writeHead(429, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(rateLimitPayload()));
      }
      const hold = heldToken(messages);
      if (hold) {
        const released = await awaitRelease(hold);
        return sse(res, [{ role: "assistant", content: released ? `DONE HELD ${hold}` : `DONE HELD-TIMEOUT ${hold}` }, {}, { finish_reason: "stop" }]);
      }
      const cue = cueFor(messages, parsed.tools);
      if (!cue) {
        return sse(res, [{ role: "assistant", content: doneReply(messages) }, {}, { finish_reason: "stop" }]);
      }
      const args = JSON.stringify(cue.args);
      return sse(res, [
        { role: "assistant", tool_calls: [{ index: 0, id: "call_mock_1", type: "function", function: { name: cue.tool, arguments: "" } }] },
        { tool_calls: [{ index: 0, function: { arguments: args } }] },
        { finish_reason: "tool_calls" },
      ]);
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `mock: no route ${url}` } }));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock provider on 127.0.0.1:${PORT}`));
