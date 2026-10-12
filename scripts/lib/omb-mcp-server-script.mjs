// Source of truth for the deterministic stdio MCP test server used by the
// Phase 5 device driver (scripts/test-android-mcp.mjs pushes its output onto
// the phone) and by chat-mcp-tools.test.ts, which runs the byte-identical
// script through the real ChatMcpClient spawn. One generator, two consumers:
// the device run and CI can never drift apart.
//
// The server speaks MCP over NDJSON stdin/stdout and exposes two tools:
//   ombmcp_write(path, text) — write inside AC_WORKSPACE (the Phase 4 root)
//   ombmcp_read(path)        — read back inside AC_WORKSPACE
// Paths that escape the workspace (../, absolute, symlink-following) are
// refused with an isError result, which the drivers assert.

/** The fixture server as a standalone CommonJS script. */
export function deviceMcpServerScript() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const WS = process.env.AC_WORKSPACE || process.env.HOME || "/tmp";
function inside(p) {
  const full = path.resolve(WS, String(p ?? "").replace(/^${"\\\\"}/, ""));
  return full === WS || full.startsWith(WS + path.sep) ? full : null;
}
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
function result(id, r) { send({ jsonrpc: "2.0", id, result: r }); }
function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return result(id, {
    protocolVersion: (params && params.protocolVersion) || "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: { name: "ombmcp", version: "1.0.0" },
  });
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return result(id, { tools: [
    {
      name: "ombmcp_write",
      description: "Write text to a file in the workspace via MCP",
      inputSchema: { type: "object", properties: { path: { type: "string" }, text: { type: "string" } }, required: ["path", "text"] },
    },
    {
      name: "ombmcp_read",
      description: "Read a file from the workspace via MCP",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ] });
  if (method === "tools/call") {
    const name = params && params.name;
    const a = (params && params.arguments) || {};
    try {
      if (name === "ombmcp_write") {
        const target = inside(a.path);
        if (!target) throw new Error("path escapes the workspace");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, String(a.text ?? ""), "utf8");
        return result(id, { content: [{ type: "text", text: "MCP wrote " + a.path }] });
      }
      if (name === "ombmcp_read") {
        const target = inside(a.path);
        if (!target) throw new Error("path escapes the workspace");
        return result(id, { content: [{ type: "text", text: fs.readFileSync(target, "utf8") }] });
      }
      return result(id, { content: [{ type: "text", text: "unknown tool " + name }], isError: true });
    } catch (e) {
      return result(id, { content: [{ type: "text", text: String((e && e.message) || e) }], isError: true });
    }
  }
  if (id !== undefined) result(id, {});
}
`;
}
