// Regression tests for the deterministic on-device provider fixture
// (scripts/omb-openai-mock.cjs). The device drivers cue this mock and parse
// its replies; if its cue mechanics or its tool-result parsing drift, the
// phone run would chase the wrong failure. These tests pin the contract in
// CI: the cue fires exactly once, emits the mounted tool name, and the DONE
// reply is derived from the actual tool-result payload shape the server
// produces (MCP content arrays, command stdout, fetch status).
//
// The mock module only starts an HTTP server on require when run as a
// process — require() with NODE_ENV=test would still bind, so instead the
// test spawns it on a free port and talks real HTTP, exactly like the phone.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const MOCK_PATH = fileURLToPath(new URL("./omb-openai-mock.cjs", import.meta.url));

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const dirs = [];
const children = [];
const ports = [];
afterAll(() => {
  for (const child of children) child.kill();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function startMock() {
  const port = await freePort();
  ports.push(port);
  const child = spawn(process.execPath, [MOCK_PATH, String(port)], { stdio: "ignore" });
  children.push(child);
  for (let i = 0; i < 50; i += 1) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(500) });
      if (probe.ok) return `http://127.0.0.1:${port}`;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("mock did not start");
}

async function completions(base, messages, tools) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-1", messages, ...(tools ? { tools } : {}) }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(res.ok).toBe(true);
  const text = await res.text();
  // Reassemble the SSE chunks the way the harness does.
  const deltas = [...text.matchAll(/^data: (.*)$/gm)]
    .map((m) => m[1])
    .filter((line) => line !== "[DONE]")
    .map((line) => JSON.parse(line).choices?.[0]?.delta ?? {});
  return deltas;
}

function assistantToolCall(deltas) {
  const name = deltas.map((d) => d.tool_calls?.[0]?.function?.name ?? "").join("");
  const args = deltas.map((d) => d.tool_calls?.[0]?.function?.arguments ?? "").join("");
  const finish = deltas.some((d) => d.finish_reason === "tool_calls");
  return { name, args: JSON.parse(args), finish };
}

function assistantText(deltas) {
  return deltas.map((d) => d.content ?? "").join("");
}

function assistantToolCallDeltas(deltas) {
  return deltas.some((d) => d.tool_calls?.length > 0 || d.finish_reason === "tool_calls");
}

describe("deterministic provider fixture contract", () => {
  it("serves a model list the driver's identity check accepts", async () => {
    const base = await startMock();
    const res = await fetch(`${base}/v1/models`);
    const body = await res.json();
    expect(body.data.map((m) => m.id)).toContain("mock-1");
  });

  it("cue-mcpwrite emits the mounted tool name with the filename from the user text", async () => {
    const base = await startMock();
    // The harness always sends the mounted tool list; the mock resolves the
    // write tool's mounted name from it (never a hardcoded name).
    const tools = [{ type: "function", function: { name: "ombmcp_ombmcp_write", parameters: {} } }];
    const deltas = await completions(base, [
      { role: "user", content: "Cue-mcpwrite mcp-proof.txt. Reply DONE when complete." },
    ], tools);
    const call = assistantToolCall(deltas);
    expect(call.finish).toBe(true);
    expect(call.name).toBe("ombmcp_ombmcp_write");
    expect(call.args.path).toBe("mcp-proof.txt");
    expect(typeof call.args.text).toBe("string");
  });

  it("degrades to a plain DONE when no MCP tool is mounted (loud discovery failure)", async () => {
    const base = await startMock();
    const deltas = await completions(base, [
      { role: "user", content: "Cue-mcpwrite mcp-proof.txt. Reply DONE when complete." },
    ], [{ type: "function", function: { name: "unrelated_tool", parameters: {} } }]);
    expect(assistantText(deltas)).toBe("DONE");
    expect(assistantToolCallDeltas(deltas)).toBe(false);
  });

  it("answers DONE by parsing an MCP tool-result payload ({content:[{type:'text',text}]})", async () => {
    const base = await startMock();
    const deltas = await completions(base, [
      { role: "user", content: "Cue-mcpwrite mcp-proof.txt. Reply DONE when complete." },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "ombmcp_ombmcp_write", arguments: "{}" } }] },
      // Exactly the shape server/index.ts serializes MCP results into the
      // transcript with (chat-mcp-tools.ts bounds and re-shapes content[]).
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ content: [{ type: "text", text: "MCP wrote mcp-proof.txt" }] }) },
    ]);
    expect(assistantText(deltas)).toMatch(/^DONE MCP wrote mcp-proof\.txt$/);
  });

  it("answers MCPERROR when the tool result is an MCP error", async () => {
    const base = await startMock();
    const deltas = await completions(base, [
      { role: "user", content: "Cue-mcpwrite denied.txt" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "ombmcp_ombmcp_write", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ isError: true, content: [{ type: "text", text: "path escapes the workspace" }] }) },
    ]);
    expect(assistantText(deltas)).toMatch(/^MCPERROR path escapes the workspace$/);
  });

  it("refuses every attempt when the conversation carries cue-rate-limit", async () => {
    const base = await startMock();
    const messages = [
      { role: "system", content: "You are a bot." },
      { role: "user", content: "Summarize the logs. cue-rate-limit" },
    ];
    // Three attempts of the same turn, replayed exactly as the retry loop
    // sends them: the refusal has to hold for all three, or the last reply
    // would answer the turn and the exhausted path would never be exercised.
    for (const attempt of [1, 2, 3]) {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "mock-1", messages, stream: true }),
        signal: AbortSignal.timeout(5_000),
      });
      expect(res.status, `attempt ${attempt}`).toBe(429);
      const body = await res.json();
      // The gateway's own JSON — the payload that must never reach a chat.
      expect(body.error?.type).toBe("rate_limit_exceeded");
      expect(body.error?.code).toBe(429);
    }
  });

  it("a tool message after the cue stops the cue (executed → DONE) and other payloads still parse", async () => {
    const base = await startMock();
    const deltas = await completions(base, [
      { role: "user", content: "cue-write please" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "android_computer_workspace_write", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ bytesWritten: 10, path: "agent-proof.txt" }) },
    ]);
    expect(assistantText(deltas)).toMatch(/^DONE WROTE agent-proof\.txt$/);
  });
});
