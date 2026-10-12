// Real HTTP + stdio MCP contract tests: a model's claim is never the receipt.
// The only writes performed by tools are in a fresh temporary directory.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureDirs, NATIVE_DIR } from "../config.ts";
import type { ProviderInstance, SendTurnInput } from "../contracts.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { recordEvents } from "../testing/events.ts";
import { GrokDriver } from "./grok.ts";
import { MinimaxDriver } from "./minimax.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";

interface ChatRequest {
  messages: Array<{
    role: string;
    content: string | null;
    reasoning_content?: string;
    reasoning_details?: unknown[];
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  }>;
  tools?: Array<{ type: string; function: { name: string; parameters: unknown } }>;
}

type Script = (body: ChatRequest, response: ServerResponse, round: number) => void;
type Provider = "openai-compat" | "grok" | "minimax";
const API_KEY_CANARY = "fixture-credential-cda00ee8d8384f54";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const chunk = (delta: unknown, finishReason: string | null = null) =>
  ({ choices: [{ index: 0, delta, finish_reason: finishReason }] });
const toolCall = (name = "audit_write", args = '{"name":"receipt","value":"done"}', id = "call_write") =>
  ({ index: 0, id, type: "function", function: { name, arguments: args } });

function sse(response: ServerResponse, chunks: unknown[], done = true) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const value of chunks) response.write(`data: ${JSON.stringify(value)}\n\n`);
  if (done) response.end("data: [DONE]\n\n");
}

function answer(response: ServerResponse, text = "The operation is complete.") {
  sse(response, [chunk({ content: text }, "stop")]);
}

// This fake implements MCP on the wire, without importing the production
// transport or using a fake execution callback in the runtime under test.
const MCP_SCRIPT = `
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const [directory, callback] = process.argv.slice(2);
writeFileSync(join(directory, "pid"), String(process.pid));
writeFileSync(join(directory, "env.json"), JSON.stringify(process.env));
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
const schema = { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"], additionalProperties: false };
createInterface({ input: process.stdin }).on("line", async (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    reply(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } });
  } else if (request.method === "tools/list") {
    reply(request.id, { tools: ["write", "wait", "fail"].map((name) => ({ name, description: "Synthetic fixture operation", inputSchema: schema })) });
  } else if (request.method === "tools/call") {
    const { name, arguments: args } = request.params;
    await fetch(callback + "/mcp-start", { method: "POST", body: JSON.stringify({ name, args }) });
    if (name === "fail") {
      reply(request.id, { isError: true, content: [{ type: "text", text: "Synthetic tool failed before writing." }] });
      return;
    }
    if (name === "wait") await new Promise((resolve) => setTimeout(resolve, 30_000));
    appendFileSync(join(directory, "effects.ndjson"), JSON.stringify({ name, ...args }) + "\\n");
    reply(request.id, { content: [{ type: "text", text: "Stored " + args.name + "=" + args.value }] });
  } else if (request.id !== undefined && request.method === "ping") reply(request.id, {});
});
`;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(script: Script, provider: Provider = "openai-compat", apiKey = API_KEY_CANARY, route?: (request: IncomingMessage, response: ServerResponse) => boolean | Promise<boolean>) {
  const directory = mkdtempSync(join(tmpdir(), "omb-chat-tools-"));
  const requests: ChatRequest[] = [];
  const rpcStarted = deferred<{ name: string; args: Record<string, unknown> }>();
  const server = createServer(async (request, response) => {
    if (route && await route(request, response)) return;
    if (request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end('{"data":[]}');
      return;
    }
    let data = "";
    for await (const part of request) data += part.toString();
    if (request.url === "/mcp-start") {
      rpcStarted.resolve(JSON.parse(data));
      response.end("ok");
      return;
    }
    const body = JSON.parse(data) as ChatRequest;
    requests.push(body);
    script(body, response, requests.length);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const origin = `http://127.0.0.1:${address.port}`;
  const helper = join(directory, "mcp.mjs");
  writeFileSync(helper, MCP_SCRIPT);
  const common = { instanceId: randomUUID(), displayName: "Tool contract fixture", enabled: true };
  const instance: ProviderInstance = provider === "minimax"
    ? await MinimaxDriver.create({ ...common, config: { url: `${origin}/v1` }, environment: { MINIMAX_API_KEY: apiKey } })
    : await (provider === "grok" ? GrokDriver : OpenAICompatDriver).create({
      ...common,
      config: { url: `${origin}/v1`, apiKeyEnv: "FIXTURE_CHAT_KEY" },
      environment: { FIXTURE_CHAT_KEY: apiKey },
    });
  const recorder = recordEvents(instance.adapter);
  const threadId = randomUUID();
  const integrations: SendTurnInput["integrations"] = {
    custom: { audit: { command: process.execPath, args: [helper, directory, origin], env: {} } },
  };
  cleanups.push(async () => {
    recorder.stop();
    await instance.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await removeTempDir(directory);
  });
  const effects = () => existsSync(join(directory, "effects.ndjson"))
    ? readFileSync(join(directory, "effects.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    : [];
  return {
    instance, recorder, requests, threadId, directory, integrations, effects, rpcStarted, origin,
    start: (input: Partial<SendTurnInput> = {}) => instance.adapter.sendTurn({
      threadId, text: "Store the synthetic receipt.", model: "fixture-model", integrations, ...input,
    }),
    completed: () => recorder.until((event) => event.type === "turn.completed"),
    async decide(behavior: "allow" | "deny" = "allow") {
      const event = await recorder.until((value) => value.type === "request.opened");
      expect(event).toMatchObject({ requestType: "permission" });
      expect(effects()).toEqual([]);
      return instance.adapter.respondToRequest(threadId, event.requestId!, { behavior });
    },
  };
}

describe.each<Provider>(["openai-compat", "grok", "minimax"])("%s structured tool contract", (provider) => {
  it("handles content:null tool calls when a compatible endpoint returns a JSON completion", async () => {
    const f = await fixture((_body, response, round) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{
        index: 0,
        message: round === 1 ? {
          role: "assistant", content: null,
          tool_calls: [{ id: "call_write", type: "function", function: toolCall().function }],
        } : { role: "assistant", content: "The receipt was stored." },
        finish_reason: round === 1 ? "tool_calls" : "stop",
      }] }));
    }, provider);
    await f.start();
    await f.decide();
    expect(await f.completed()).toMatchObject({ ok: true });
    expect(f.effects()).toEqual([{ name: "receipt", value: "done" }]);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_write", content: expect.stringContaining("Stored receipt=done") });
  });

  it("advertises the mounted schema and runs an authorized call before returning its result to the model", async () => {
    const f = await fixture((_body, response, round) => {
      if (round === 1) sse(response, [chunk({ content: null, tool_calls: [toolCall()] }, "tool_calls")]);
      else answer(response);
    }, provider);
    await f.start();
    expect(await f.decide()).toBe("allowed-once");
    expect(await f.completed()).toMatchObject({ ok: true });

    expect(f.requests[0].tools).toContainEqual({
      type: "function",
      function: expect.objectContaining({
        name: "audit_write",
        parameters: expect.objectContaining({ required: ["name", "value"] }),
      }),
    });
    expect(f.effects()).toEqual([{ name: "receipt", value: "done" }]);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].tools).toEqual(f.requests[0].tools);
    expect(f.requests[1].messages.slice(-2)).toEqual([
      expect.objectContaining({ role: "assistant", tool_calls: [expect.objectContaining({ id: "call_write" })] }),
      expect.objectContaining({ role: "tool", tool_call_id: "call_write", content: expect.stringContaining("Stored receipt=done") }),
    ]);
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "tool", ok: true }));
    const started = f.recorder.events.find((event) => event.type === "item.started" && event.itemType === "tool");
    expect(started?.itemId).toEqual(expect.any(String));
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "tool", itemId: started?.itemId, ok: true }));
    expect(f.recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
    expect(f.instance.adapter.capabilities).toMatchObject({ agentsMcp: true, composioMcp: true, customMcp: true });
  });

  it("preserves ordinary transcript chat and leaves textual tool imitations as text", async () => {
    const imitation = '<tool_call>{"name":"audit_write","arguments":{"value":"pretend"}}</tool_call>';
    const f = await fixture((_body, response) => answer(response, imitation), provider);
    await f.start({ integrations: undefined, system: "Fixture persona", transcript: [{ role: "user", text: "Earlier question" }, { role: "assistant", text: "Earlier answer" }] });
    expect(await f.completed()).toMatchObject({ ok: true });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].tools).toBeUndefined();
    expect(f.requests[0].messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "assistant_text", text: imitation }));
    expect(f.recorder.events.some((event) => event.type === "request.opened" || event.type === "item.started")).toBe(false);
    expect(f.effects()).toEqual([]);
    expect(existsSync(join(f.directory, "pid"))).toBe(false);
  });
});

describe("remote MCP over the fleet turn path", () => {
  // The fixture HTTP server gains MCP endpoints: streamable HTTP on /mcp,
  // legacy SSE on /mcp-sse, both serving the identical tool implementation
  // as the stdio fixture — a remote mount must prove the transport, not a
  // different toolset. Session handling is real: the first response assigns
  // mcp-session-id, later requests must echo it.
  const remoteSchema = { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"], additionalProperties: false };

  async function remoteFixture(script: Script, kind: "http" | "sse") {
    const sseWaiters = new Map<number, (message: unknown) => void>();
    let sseResponse: ServerResponse | null = null;
    const tools = () => ["write", "wait", "fail"].map((name) => ({ name, description: "Synthetic fixture operation", inputSchema: remoteSchema }));
    const callResult = (params: { name?: string; arguments?: Record<string, unknown> }, directory: string) => {
      const { name, arguments: args } = params;
      if (name === "fail") return { isError: true, content: [{ type: "text", text: "Synthetic tool failed before writing." }] };
      appendFileSync(join(directory, "effects.ndjson"), JSON.stringify({ name, ...args }) + "\n");
      return { content: [{ type: "text", text: "Stored " + args?.name + "=" + args?.value }] };
    };
    const f = await fixture(script, "openai-compat", API_KEY_CANARY, async (request, response) => {
      if (kind === "http" && request.url === "/mcp") {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return true;
        }
        let frame = "";
        for await (const part of request) frame += part.toString();
        const message = JSON.parse(frame) as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
        if (message.method === "initialize") response.setHeader("mcp-session-id", "fixture-session-1");
        response.setHeader("content-type", "application/json");
        if (message.method === "initialize") {
          response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture-remote", version: "1" } } }));
        } else if (message.method === "notifications/initialized") {
          response.statusCode = 202;
          response.end("");
        } else if (message.method === "tools/list") {
          response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: tools() } }));
        } else if (message.method === "tools/call") {
          response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: callResult(message.params ?? {}, f.directory) }));
        } else {
          response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "fixture: method not implemented" } }));
        }
        return true;
      }
      if (kind === "sse" && request.url === "/mcp-sse" && request.method === "GET") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("event: endpoint\ndata: /mcp-sse/messages\n\n");
        sseResponse = response;
        request.on("close", () => { if (sseResponse === response) sseResponse = null; });
        return true;
      }
      if (kind === "sse" && request.url === "/mcp-sse/messages" && request.method === "POST") {
        let frame = "";
        for await (const part of request) frame += part.toString();
        response.writeHead(202);
        response.end();
        const message = JSON.parse(frame) as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
        if (message.id === undefined) return true; // notification: no reply
        const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result });
        if (message.method === "initialize") {
          sseResponse?.write(`event: message\ndata: ${JSON.stringify(reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture-remote", version: "1" } }))}\n\n`);
        } else if (message.method === "tools/list") {
          sseResponse?.write(`event: message\ndata: ${JSON.stringify(reply({ tools: tools() }))}\n\n`);
        } else if (message.method === "tools/call") {
          sseResponse?.write(`event: message\ndata: ${JSON.stringify(reply(callResult(message.params ?? {}, f.directory)))}\n\n`);
        }
        return true;
      }
      return false;
    });
    void sseWaiters;
    const transport = kind === "http"
      ? { type: "http" as const, url: `${f.origin}/mcp`, headers: {} }
      : { type: "sse" as const, url: `${f.origin}/mcp-sse`, headers: {} };
    return { ...f, transport };
  }

  it.each(["http", "sse"] as const)("discovers and executes a tool on a %s remote server, gated by approval", async (kind) => {
    const f = await remoteFixture((_body, response, round) => {
      if (round === 1) sse(response, [chunk({ content: null, tool_calls: [toolCall("remote_write")] }, "tool_calls")]);
      else answer(response, "Remote tool finished.");
    }, kind);
    const integrations: SendTurnInput["integrations"] = { custom: { remote: f.transport } };
    await f.start({ integrations });
    expect(await f.decide()).toBe("allowed-once");
    expect(await f.completed()).toMatchObject({ ok: true });
    expect(f.effects()).toEqual([{ name: "receipt", value: "done" }]);
    expect(f.requests[0].tools).toContainEqual({ type: "function", function: expect.objectContaining({ name: "remote_write" }) });
    expect(f.requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("Stored receipt=done") });
  });

  it("surfaces a remote declared tool error without claiming success", async () => {
    const f = await remoteFixture((_body, response, round) => {
      if (round === 1) sse(response, [chunk({ content: null, tool_calls: [toolCall("remote_fail")] }, "tool_calls")]);
      else answer(response, "It failed.");
    }, "http");
    const integrations: SendTurnInput["integrations"] = { custom: { remote: f.transport } };
    await f.start({ integrations });
    expect(await f.decide()).toBe("allowed-once");
    // A declared tool error must not be laundered into success: the turn
    // completes (the model still answers) but the turn-level receipt is a
    // failure and the error text reaches the model as the tool result.
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.recorder.events.some((event) => event.type === "runtime.error")).toBe(true);
    expect(f.effects()).toEqual([]);
    expect(f.requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("Synthetic tool failed") });
  });
});

describe("MCP child environment sanitization", () => {
  it("keeps harness provider credentials out of a spawned MCP server while honoring its own configured env", async () => {
    const f = await fixture((_body, response, round) => {
      if (round === 1) sse(response, [chunk({ content: null, tool_calls: [toolCall()] }, "tool_calls")]);
      else answer(response);
    });
    // The canary rides the harness environment exactly as a real provider
    // key would. The server's own env block re-declares OPENAI_API_KEY
    // deliberately; the dump must show the deliberate value and never the
    // inherited canary (nor the canary under any other name).
    process.env.OPENAI_COMPAT_API_KEY = API_KEY_CANARY;
    try {
      const integrations: SendTurnInput["integrations"] = {
        custom: {
          audit: {
            command: process.execPath, args: [join(f.directory, "mcp.mjs"), f.directory, f.origin],
            env: { OPENAI_API_KEY: "server-own-key" },
          },
        },
      };
      await f.start({ integrations });
      expect(await f.decide()).toBe("allowed-once");
      expect(await f.completed()).toMatchObject({ ok: true });
      const envDump = JSON.parse(readFileSync(join(f.directory, "env.json"), "utf8")) as Record<string, string>;
      expect(envDump.OPENAI_API_KEY).toBe("server-own-key");
      expect(Object.values(envDump)).not.toContain(API_KEY_CANARY);
    } finally {
      delete process.env.OPENAI_COMPAT_API_KEY;
    }
  });
});

describe("structured tool execution boundaries", () => {
  it.each(["JSON", "SSE"] as const)("preserves opaque reasoning details and their original order through %s tool continuation", async (format) => {
    const details = [
      { type: "reasoning.text", id: "trace-text", format: "fixture-format", index: 2, text: "Opaque reasoning text", signature: "synthetic-text-signature" },
      { type: "reasoning.encrypted", id: "trace-encrypted", format: "fixture-format", index: 1, data: "synthetic-encrypted-segment-a" },
      { type: "reasoning.encrypted", id: "trace-encrypted", format: "fixture-format", index: 1, data: "synthetic-encrypted-segment-b", signature: "synthetic-encrypted-signature" },
    ];
    const f = await fixture((_request, response, round) => {
      if (round > 1) return answer(response);
      if (format === "JSON") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ choices: [{
          message: {
            role: "assistant", content: null, reasoning: "Synthetic reasoning.", reasoning_details: details,
            tool_calls: [{ id: "call_write", type: "function", function: toolCall().function }],
          },
          finish_reason: "tool_calls",
        }] }));
      } else {
        sse(response, [
          chunk({ reasoning: "Synthetic ", reasoning_details: details.slice(0, 2) }),
          chunk({ reasoning: "reasoning.", reasoning_details: details.slice(2), content: null, tool_calls: [toolCall()] }, "tool_calls"),
        ]);
      }
    });
    await f.start();
    await f.decide();
    expect(await f.completed()).toMatchObject({ ok: true });
    const assistant = f.requests[1].messages.find((message) => message.role === "assistant");
    expect(assistant).toMatchObject({ content: null, reasoning_content: "Synthetic reasoning." });
    expect(assistant?.reasoning_details).toEqual(details);
    expect(f.recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toEqual([
      expect.objectContaining({ text: "The operation is complete." }),
    ]);
    if (format === "SSE") {
      const reasoning = f.recorder.events.flatMap((event) => event.type === "content.delta" && event.streamKind === "reasoning_text" ? [event.delta] : []).join("");
      expect(reasoning).toBe("Synthetic reasoning.");
    }
    expect(JSON.stringify(f.recorder.events)).not.toContain("synthetic-encrypted");
    expect(f.effects()).toEqual([{ name: "receipt", value: "done" }]);
  });

  it.each([
    { scenario: "only a DONE marker", body: "data: [DONE]\n\n" },
    { scenario: "an invalid frame before DONE", body: "data: {invalid\n\ndata: [DONE]\n\n" },
    { scenario: "a frame without a completion choice", body: "data: {}\n\ndata: [DONE]\n\n" },
    {
      scenario: "ordinary text followed by a malformed frame",
      body: `data: ${JSON.stringify(chunk({ content: "Partial response" }))}\n\ndata: {invalid\n\ndata: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`,
    },
  ])("fails an SSE response with $scenario instead of completing successfully", async ({ body }) => {
    const f = await fixture((_request, response) => {
      response.setHeader("content-type", "text/event-stream");
      response.end(body);
    });
    await f.start({ integrations: undefined });
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.requests).toHaveLength(1);
    expect(f.effects()).toEqual([]);
    expect(f.recorder.events.some((event) => event.type === "runtime.error")).toBe(true);
    expect(f.recorder.events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });

  it("preserves ordinary text surrounded by normal role, empty finish, and usage frames", async () => {
    const f = await fixture((_request, response) => sse(response, [
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "Hello from " }),
      chunk({ content: "the fixture." }),
      chunk({}, "stop"),
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } },
    ]));
    await f.start({ integrations: undefined });
    expect(await f.completed()).toMatchObject({ ok: true, usage: { input: 12, output: 4 } });
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "assistant_text", text: "Hello from the fixture." }));
    expect(f.recorder.events.some((event) => event.type === "runtime.error" || event.type === "request.opened")).toBe(false);
    expect(f.requests[0].tools).toBeUndefined();
    expect(f.effects()).toEqual([]);
  });

  it.each([
    { scenario: "missing choices", body: {} },
    { scenario: "empty choices", body: { choices: [] } },
    { scenario: "empty assistant message", body: { choices: [{ message: {}, finish_reason: "stop" }] } },
    { scenario: "null content without calls", body: { choices: [{ message: { content: null }, finish_reason: "stop" }] } },
    { scenario: "blank content", body: { choices: [{ message: { content: "   " }, finish_reason: "stop" }] } },
  ])("rejects a JSON completion with $scenario instead of reporting an empty successful turn", async ({ body }) => {
    const f = await fixture((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    });
    await f.start({ integrations: undefined });
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.requests).toHaveLength(1);
    expect(f.effects()).toEqual([]);
    expect(f.recorder.events.some((event) => event.type === "runtime.error")).toBe(true);
    expect(f.recorder.events.some((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toBe(false);
  });

  it.each(["content", "reasoning_content"] as const)("redacts a configured credential split across %s deltas before publishing any fragment", async (field) => {
    const pieces = [API_KEY_CANARY.slice(0, 19), API_KEY_CANARY.slice(19, 27), API_KEY_CANARY.slice(27)];
    const f = await fixture((_request, response) => sse(response, [
      chunk({ [field]: `Before ${pieces[0]}` }),
      chunk({ [field]: pieces[1] }),
      chunk({ [field]: `${pieces[2]} after.` }, "stop"),
    ]));
    await f.start({ integrations: undefined });
    expect(await f.completed()).toMatchObject({ ok: true });
    const deltas = f.recorder.events.filter((event) => event.type === "content.delta");
    const combined = deltas.map((event) => event.delta).join("");
    const completed = f.recorder.events.find((event) => event.type === "item.completed" && event.itemType === "assistant_text");
    expect(completed).toMatchObject({ text: combined });
    expect(combined).toContain("Before ");
    expect(combined).toContain(" after.");
    expect(combined).not.toContain(API_KEY_CANARY);
    const events = JSON.stringify(f.recorder.events);
    for (const piece of pieces) expect(events).not.toContain(piece);
  });

  it.each([
    { scenario: "one chunk", pieces: ["abab"] },
    { scenario: "split chunks", pieces: ["ab", "ab"] },
  ])("redacts an overlapping-prefix credential received in $scenario", async ({ pieces }) => {
    const f = await fixture((_request, response) => sse(response, [
      chunk({ content: "Before " }),
      ...pieces.map((piece) => chunk({ content: piece })),
      chunk({ content: " after." }, "stop"),
    ]), "openai-compat", "abab");
    await f.start({ integrations: undefined });
    expect(await f.completed()).toMatchObject({ ok: true });
    const combined = f.recorder.events.filter((event) => event.type === "content.delta").map((event) => event.delta).join("");
    expect(combined).toBe("Before [redacted] after.");
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "assistant_text", text: combined }));
    expect(JSON.stringify(f.recorder.events)).not.toContain("abab");
  });

  it("redacts a configured credential echoed by a tool from events, diagnostics, and the returned tool result", async () => {
    ensureDirs();
    const f = await fixture((_body, response, round) => round === 1
      ? sse(response, [chunk({ tool_calls: [toolCall("audit_write", JSON.stringify({ name: "receipt", value: API_KEY_CANARY }))] }, "tool_calls")])
      : answer(response), "grok");
    await f.start();
    await f.decide();
    expect(await f.completed()).toMatchObject({ ok: true });
    expect(f.effects()).toEqual([{ name: "receipt", value: API_KEY_CANARY }]);
    expect(f.requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("Stored receipt=") });
    expect(f.requests[1].messages.at(-1)?.content).not.toContain(API_KEY_CANARY);
    expect(JSON.stringify(f.recorder.events)).not.toContain(API_KEY_CANARY);
    expect(readFileSync(join(NATIVE_DIR, `${f.threadId}.ndjson`), "utf8")).not.toContain(API_KEY_CANARY);
  });

  it("never promotes textual tool syntax into execution, even when that tool is mounted", async () => {
    const imitation = '<tool_call>{"name":"audit_write","arguments":{"name":"receipt","value":"pretend"}}</tool_call>';
    const f = await fixture((_body, response) => answer(response, imitation));
    await f.start();
    expect(await f.completed()).toMatchObject({ ok: true });
    expect(f.requests[0].tools?.some((tool) => tool.function.name === "audit_write")).toBe(true);
    expect(f.recorder.events.some((event) => event.type === "request.opened" || event.type === "item.started")).toBe(false);
    expect(f.effects()).toEqual([]);
    expect(f.requests).toHaveLength(1);
  });

  it("accumulates interleaved argument fragments and pairs both results with their original call IDs", async () => {
    const f = await fixture((_body, response, round) => {
      if (round > 1) return answer(response);
      sse(response, [
        chunk({ tool_calls: [toolCall("audit_write", '{"name":"first",', "call_first"), { ...toolCall("audit_write", '{"name":"second",', "call_second"), index: 1 }] }),
        chunk({ tool_calls: [{ index: 1, function: { arguments: '"value":"two"}' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"value":"one"}' } }] }, "tool_calls"),
      ]);
    });
    const approved: string[] = [];
    const stop = f.instance.adapter.onEvent((event) => {
      if (event.type === "request.opened") {
        approved.push(event.requestId!);
        void f.instance.adapter.respondToRequest(f.threadId, event.requestId!, { behavior: "allow" });
      }
    });
    await f.start();
    expect(await f.completed()).toMatchObject({ ok: true });
    stop();
    expect(new Set(approved).size).toBe(2);
    expect(f.effects()).toEqual([{ name: "first", value: "one" }, { name: "second", value: "two" }]);
    expect(f.requests[1].messages.filter((message) => message.role === "tool")).toEqual([
      { role: "tool", tool_call_id: "call_first", content: expect.stringContaining("Stored first=one") },
      { role: "tool", tool_call_id: "call_second", content: expect.stringContaining("Stored second=two") },
    ]);
  });

  it("aggregates model usage across execution and continuation", async () => {
    const f = await fixture((_body, response, round) => sse(response, [
      round === 1 ? chunk({ tool_calls: [toolCall()] }, "tool_calls") : chunk({ content: "Receipt verified." }, "stop"),
      { choices: [], usage: { prompt_tokens: round * 10, completion_tokens: round * 2 } },
    ]));
    await f.start();
    await f.decide();
    expect(await f.completed()).toMatchObject({ ok: true, usage: { input: 30, output: 6 } });
  });

  it("returns denial to the model without treating a convincing final answer as successful execution", async () => {
    const f = await fixture((_body, response, round) => {
      if (round === 1) sse(response, [chunk({ tool_calls: [toolCall()] }, "tool_calls")]);
      else answer(response, "I successfully wrote the receipt.");
    });
    await f.start();
    expect(await f.decide("deny")).toBe("rejected");
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.effects()).toEqual([]);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_write", content: expect.stringMatching(/denied|declined|not allowed/i) });
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "tool", ok: false }));
  });

  it("keeps approvals bound to the pending request and thread", async () => {
    const f = await fixture((_body, response, round) => round === 1
      ? sse(response, [chunk({ tool_calls: [toolCall()] }, "tool_calls")]) : answer(response));
    await f.start();
    const request = await f.recorder.until((event) => event.type === "request.opened");
    expect(await f.instance.adapter.respondToRequest("another-thread", request.requestId!, { behavior: "allow" })).toBe("unavailable");
    expect(await f.instance.adapter.respondToRequest(f.threadId, "unknown-request", { behavior: "allow" })).toBe("unavailable");
    expect(await f.instance.adapter.respondToRequest(f.threadId, request.requestId!, { behavior: "answer" })).toBe("unavailable");
    expect(f.effects()).toEqual([]);
    expect(await f.decide()).toBe("allowed-once");
    await f.completed();
    expect(await f.instance.adapter.respondToRequest(f.threadId, request.requestId!, { behavior: "allow" })).toBe("unavailable");
    expect(f.effects()).toHaveLength(1);
  });

  it.each([
    ["invalid JSON", "audit_write", '{"name":'],
    ["non-object arguments", "audit_write", '[]'],
    ["arguments outside the advertised schema", "audit_write", '{"name":"receipt","value":42}'],
    ["unknown tool", "audit_unknown", '{"name":"receipt","value":"done"}'],
  ])("reports %s without granting permission or executing", async (_scenario, name, args) => {
    const f = await fixture((_body, response, round) => round === 1
      ? sse(response, [chunk({ tool_calls: [toolCall(name, args)] }, "tool_calls")]) : answer(response));
    await f.start();
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.effects()).toEqual([]);
    expect(f.recorder.events.some((event) => event.type === "request.opened")).toBe(false);
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "item.completed", itemType: "tool", ok: false }));
    expect(f.requests[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_write", content: expect.any(String) });
  });

  it.each([
    { scenario: "duplicate call IDs", frames: [chunk({ tool_calls: [toolCall(), { ...toolCall(), index: 1 }] }, "tool_calls")] },
    { scenario: "missing call ID", frames: [chunk({ tool_calls: [{ index: 0, type: "function", function: toolCall().function }] }, "tool_calls")] },
    { scenario: "changed call ID", frames: [chunk({ tool_calls: [toolCall()] }), chunk({ tool_calls: [{ index: 0, id: "a_different_call" }] }, "tool_calls")] },
    { scenario: "truncated tool completion", frames: [chunk({ tool_calls: [toolCall()] }, "length")] },
    { scenario: "tool finish without a call", frames: [chunk({}, "tool_calls")] },
  ])("rejects $scenario before any tool can execute", async ({ frames }) => {
    const f = await fixture((_body, response) => sse(response, frames));
    await f.start();
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.effects()).toEqual([]);
    expect(f.requests).toHaveLength(1);
    expect(f.recorder.events.some((event) => event.type === "request.opened")).toBe(false);
    expect(f.recorder.events.some((event) => event.type === "runtime.error")).toBe(true);
  });

  it("returns an MCP tool failure and preserves its unsuccessful operation status", async () => {
    const f = await fixture((_body, response, round) => round === 1
      ? sse(response, [chunk({ tool_calls: [toolCall("audit_fail")] }, "tool_calls")]) : answer(response));
    await f.start();
    await f.decide();
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.effects()).toEqual([]);
    expect(f.requests[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_write", content: expect.stringContaining("Synthetic tool failed") });
  });

  it("fails explicitly if the model requests a structured tool when none was mounted", async () => {
    const f = await fixture((_body, response) => sse(response, [chunk({ content: null, tool_calls: [toolCall()] }, "tool_calls")]));
    await f.start({ integrations: undefined });
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.effects()).toEqual([]);
    expect(f.recorder.events.some((event) => event.type === "runtime.error" || (event.type === "item.completed" && event.itemType === "tool" && !event.ok))).toBe(true);
  });

  it("never retries a provider error after a tool's effect has already happened", async () => {
    const f = await fixture((_body, response, round) => {
      if (round === 1) sse(response, [chunk({ tool_calls: [toolCall()] }, "tool_calls")]);
      else { response.writeHead(503); response.end("Synthetic provider unavailable"); }
    }, "grok");
    await f.start();
    await f.decide();
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.effects()).toHaveLength(1);
    expect(f.requests).toHaveLength(2);
    expect(f.recorder.events.some((event) => event.type === "turn.retrying")).toBe(false);
    expect(f.recorder.events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });

  it("rejects a repeated call ID in a later model round before duplicating its effect", async () => {
    const f = await fixture((_body, response) => sse(response, [chunk({ tool_calls: [toolCall()] }, "tool_calls")]));
    await f.start();
    await f.decide();
    expect(await f.completed()).toMatchObject({ ok: false });
    expect(f.effects()).toHaveLength(1);
    expect(f.requests).toHaveLength(2);
    expect(f.recorder.events.filter((event) => event.type === "request.opened")).toHaveLength(1);
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "runtime.error", message: expect.stringMatching(/repeat|duplicate/i) }));
  });

  it("stops a model that keeps requesting tools at the turn limit", async () => {
    const f = await fixture((_body, response, round) => sse(response, [
      chunk({ tool_calls: [toolCall("audit_write", '{"name":"receipt","value":"done"}', `call_${round}`)] }, "tool_calls"),
    ]));
    const stop = f.instance.adapter.onEvent((event) => {
      if (event.type === "request.opened") void f.instance.adapter.respondToRequest(f.threadId, event.requestId!, { behavior: "allow" });
    });
    await f.start();
    expect(await f.completed()).toMatchObject({ ok: false });
    stop();
    expect(f.requests.length).toBeGreaterThan(1);
    expect(f.requests.length).toBeLessThanOrEqual(16);
    expect(f.effects().length).toBeLessThanOrEqual(16);
    expect(f.recorder.events).toContainEqual(expect.objectContaining({ type: "runtime.error", message: expect.stringMatching(/limit/i) }));
  });

  it.each(["stream", "approval", "rpc", "continuation"] as const)("cancels during %s, closes execution authority, and settles exactly once", async (stage) => {
    const heldResponse = deferred();
    const f = await fixture((_body, response, round) => {
      if (stage === "stream") {
        sse(response, [chunk({ tool_calls: [toolCall("audit_write", '{"name":')] })], false);
        heldResponse.resolve();
      } else if (round === 1) {
        sse(response, [chunk({ tool_calls: [toolCall(stage === "rpc" ? "audit_wait" : "audit_write")] }, "tool_calls")]);
      } else {
        sse(response, [chunk({ content: "Finishing" })], false);
        heldResponse.resolve();
      }
    });
    const { turnId } = await f.start();
    if (stage === "stream") await heldResponse.promise;
    else if (stage === "approval") await f.recorder.until((event) => event.type === "request.opened");
    else {
      await f.decide();
      await (stage === "rpc" ? f.rpcStarted.promise : heldResponse.promise);
    }
    await f.instance.adapter.interruptTurn(f.threadId, turnId);
    expect(await f.completed()).toMatchObject({ ok: false, stopReason: "interrupted" });
    expect(f.effects()).toHaveLength(stage === "continuation" ? 1 : 0);
    expect(f.requests).toHaveLength(stage === "continuation" ? 2 : 1);
    expect(f.instance.adapter.hasSession(f.threadId)).toBe(false);
    const pid = Number(readFileSync(join(f.directory, "pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    const pending = f.recorder.events.find((event) => event.type === "request.opened");
    if (pending) expect(await f.instance.adapter.respondToRequest(f.threadId, pending.requestId!, { behavior: "allow" })).toBe("unavailable");
    expect(f.recorder.events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });

  it("ask_user raises a question card, and the person's answer becomes the tool result", async () => {
    const f = await fixture((_request, response, round) => {
      if (round > 1) return answer(response);
      sse(response, [chunk({ tool_calls: [{
        index: 0, id: "call_ask", type: "function",
        function: { name: "ask_user", arguments: JSON.stringify({ question: "Which layout?", choices: ["By project", "By date"] }) },
      }] }, "tool_calls")]);
    });
    await f.start({ integrations: undefined, turnTools: [{
      name: "ask_user",
      description: "ask",
      inputSchema: { type: "object", properties: { question: { type: "string" } } },
      execute: () => "unused",
    }] });
    // The card is a QUESTION, not a permission: ordinary tool calls in the
    // same turn raised no allow/deny card, and this one must not either.
    const opened = await f.recorder.until((event) => event.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "question", tool: "ask_user" });
    // The recorder yields the whole event union; narrow before reading the
    // question payload so the assertions below stay type-checked.
    if (opened.type !== "request.opened") throw new Error("expected a request.opened event");
    expect(opened.questions).toHaveLength(1);
    expect(opened.questions?.[0]?.options.map((option) => option.label)).toEqual(["By project", "By date"]);
    // The person answers (the card's answer behavior) — their words ride
    // back to the model as the tool result.
    const outcome = await f.instance.adapter.respondToRequest(f.threadId, opened.requestId!, {
      behavior: "answer", message: "By date, but prioritize recent folders",
    });
    expect(outcome).toBe("answered");
    expect(await f.completed()).toMatchObject({ ok: true });
    // The second model call carries the answer as the ask_user tool result.
    const toolMessage = f.requests[1].messages.find((message) => message.role === "tool");
    expect(JSON.parse(String(toolMessage?.content))).toMatchObject({
      ok: true,
      result: "By date, but prioritize recent folders",
    });
    // And the continuation completed with the model's final text.
    expect(f.recorder.events.some((event) => event.type === "item.completed" && event.itemType === "assistant_text" && event.text === "The operation is complete.")).toBe(true);
  });

  it("a typed ask_user carries type, ids and bounds to the card, and the same turn resumes on the answer", async () => {
    const f = await fixture((_request, response, round) => {
      if (round > 1) return answer(response);
      sse(response, [chunk({ tool_calls: [{
        index: 0, id: "call_ask", type: "function",
        function: { name: "ask_user", arguments: JSON.stringify({
          question: "Which providers should I enable?",
          type: "multiple_choice",
          minSelections: 1,
          maxSelections: 2,
          choices: [
            { id: "openai", label: "OpenAI", description: "GPT models" },
            { id: "qwen", label: "Qwen" },
          ],
        }) },
      }] }, "tool_calls")]);
    });
    await f.start({ integrations: undefined, turnTools: [{
      name: "ask_user",
      description: "ask",
      inputSchema: { type: "object", properties: { question: { type: "string" } } },
      execute: () => "unused",
    }] });
    const opened = await f.recorder.until((event) => event.type === "request.opened");
    if (opened.type !== "request.opened") throw new Error("expected a request.opened event");
    const [question] = opened.questions ?? [];
    expect(question?.type).toBe("multiple_choice");
    expect(question?.multiSelect).toBe(true);
    expect(question?.minSelections).toBe(1);
    expect(question?.maxSelections).toBe(2);
    expect(question?.options.map((option) => option.id)).toEqual(["openai", "qwen"]);
    // The answer (whatever words the card sends) resumes THE SAME turn as
    // this ask_user tool's result — not a new turn.
    const outcome = await f.instance.adapter.respondToRequest(f.threadId, opened.requestId!, {
      behavior: "answer", message: "OpenAI, but only for chat models",
    });
    expect(outcome).toBe("answered");
    expect(await f.completed()).toMatchObject({ ok: true });
    const toolMessage = f.requests[1].messages.find((message) => message.role === "tool");
    expect(JSON.parse(String(toolMessage?.content))).toMatchObject({ ok: true, result: "OpenAI, but only for chat models" });
  });

  it("confirmation and free_text asks normalize to their own shapes", async () => {
    const f = await fixture((_request, response, round) => {
      if (round > 1) return answer(response);
      sse(response, [chunk({ tool_calls: [
        { index: 0, id: "call_confirm", type: "function",
          function: { name: "ask_user", arguments: JSON.stringify({ question: "Delete the selected bot and all of its local data?", type: "confirmation" }) } },
      ] }, "tool_calls")]);
    });
    await f.start({ integrations: undefined, turnTools: [{
      name: "ask_user",
      description: "ask",
      inputSchema: { type: "object", properties: { question: { type: "string" } } },
      execute: () => "unused",
    }] });
    const opened = await f.recorder.until((event) => event.type === "request.opened");
    if (opened.type !== "request.opened") throw new Error("expected a request.opened event");
    const [question] = opened.questions ?? [];
    expect(question?.type).toBe("confirmation");
    expect(question?.options.map((option) => option.id)).toEqual(["confirmed", "declined"]);
    expect(question?.options.map((option) => option.label)).toEqual(["Confirm", "Cancel"]);
    const outcome = await f.instance.adapter.respondToRequest(f.threadId, opened.requestId!, {
      behavior: "answer", message: "The user confirmed.",
    });
    expect(outcome).toBe("answered");
    expect(await f.completed()).toMatchObject({ ok: true });
  });

  it("an ask_user left open is resolved unanswered when the turn is interrupted", async () => {
    const held = deferred<void>();
    const f = await fixture((_request, response, round) => {
      if (round > 1) {
        void held.promise.then(() => answer(response));
        return;
      }
      sse(response, [chunk({ tool_calls: [{
        index: 0, id: "call_ask", type: "function",
        function: { name: "ask_user", arguments: JSON.stringify({ question: "Proceed?" }) },
      }] }, "tool_calls")]);
    });
    const { turnId } = await f.start({ integrations: undefined, turnTools: [{
      name: "ask_user",
      description: "ask",
      inputSchema: { type: "object", properties: { question: { type: "string" } } },
      execute: () => "unused",
    }] });
    const opened = await f.recorder.until((event) => event.type === "request.opened");
    await f.instance.adapter.interruptTurn(f.threadId, turnId);
    expect(await f.completed()).toMatchObject({ ok: false, stopReason: "interrupted" });
    // The abandoned ask can no longer be answered.
    expect(await f.instance.adapter.respondToRequest(f.threadId, opened.requestId!, { behavior: "answer", message: "late" })).toBe("unavailable");
    held.resolve();
  });
});
