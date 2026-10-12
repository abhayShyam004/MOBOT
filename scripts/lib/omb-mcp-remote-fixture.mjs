// Source of truth for the remote MCP test fixture — the URL-transport twin
// of lib/omb-mcp-server-script.mjs (stdio). One generator, two consumers:
// the device driver (test-android-mcp-remote.mjs pushes the output onto the
// phone and serves it from the app's embedded node) and CI
// (openai-chat-tools.test.ts runs the same script through the real
// RemoteMcpClient), so the device run and CI can never drift apart.
//
// Serves BOTH remote transports on one port:
//   --transport http → streamable HTTP on /mcp (POST, JSON answers)
//   --transport sse  → legacy SSE on /mcp-sse (GET stream names /mcp-messages;
//                      requests POST there, replies ride the stream)
//
// The fixture exposes one tool, write(name, value): it writes
// `name=value` into AC_WORKSPACE and answers "Stored name=value" — the
// device driver reads the file back as the proof of a real remote
// execution on the phone.
export function remoteMcpFixtureScript(port, transport = "http", effectFile = "mcp-remote-effect.txt") {
  return `#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
const WS = process.env.AC_WORKSPACE || process.env.HOME || "/tmp";
const schema = { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"], additionalProperties: false };
const tools = () => [{ name: "write", description: "Write a remote effect into the workspace", inputSchema: schema }];
const ok = (id, result) => JSON.stringify({ jsonrpc: "2.0", id, result });
const sse = (res, id, result) => res.write("event: message\\ndata: " + ok(id, result) + "\\n\\n");
let sseStream = null;
const handle = (msg) => {
  if (msg.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture-remote", version: "1" } };
  if (msg.method === "tools/list") return { tools: tools() };
  if (msg.method === "tools/call") {
    const a = msg.params?.arguments ?? {};
    fs.writeFileSync(WS + "/" + ${JSON.stringify(effectFile)}, a.name + "=" + a.value);
    return { content: [{ type: "text", text: "Stored " + a.name + "=" + a.value }] };
  }
  return undefined;
};
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let msg = {};
    try { msg = JSON.parse(body); } catch {}
    if (req.method === "GET") {
      // legacy SSE: the stream opens here and its first event names the POST endpoint
      res.writeHead(200, { "content-type": "text/event-stream" });
      sseStream = res;
      // the endpoint event MUST be the first stream event; Node buffers the
      // 200-headers until the first write, so write it after stashing res
      res.write("event: endpoint\\ndata: /mcp-messages\\n\\n");
      // null the stream on the RESPONSE's close — the request's close fires
      // immediately for a bodyless GET (message complete at headers), which
      // would drop the stream before any POST arrives
      res.on("close", () => { if (sseStream === res) sseStream = null; });
      return;
    }
    if (msg.method === "initialize") res.setHeader("mcp-session-id", "remote-fixture-1");
    if (${JSON.stringify(transport)} === "sse" || (req.url ?? "").endsWith("/mcp-messages")) {
      // legacy SSE: requests POST to the endpoint, replies go over the stream.
      // A POST arriving with no open stream still gets 202 (the client's
      // request promise then fails on stream close) but must NOT crash us.
      res.writeHead(202);
      res.end();
      if (msg.id === undefined || !sseStream) return;
      const result = handle(msg);
      if (result === undefined) sseStream?.write("event: message\\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "fixture: no method" } }) + "\\n\\n");
      else sse(sseStream, msg.id, result);
      return;
    }
    res.setHeader("content-type", "application/json");
    if (msg.method === "notifications/initialized") { res.statusCode = 202; return res.end(""); }
    const result = handle(msg);
    if (result === undefined) return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "fixture: no method" } }));
    return res.end(ok(msg.id, result));
  });
}).listen(${port}, "127.0.0.1", () => console.log("remote fixture (${transport}) on 127.0.0.1:${port}"));
`;
}
