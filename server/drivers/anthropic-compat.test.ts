// The Anthropic Messages runtime: request shape, SSE translation, and the
// tool_use → tool_result round trip, driven through a stubbed fetch exactly
// like the openai-compat suite drives its sibling.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEvent, SendTurnInput } from "../contracts.ts";
import { AnthropicCompatDriver } from "./anthropic-compat.ts";

afterEach(() => vi.unstubAllGlobals());

const create = (config: Record<string, unknown> = {}, environment: Record<string, string> = { ANTHROPIC_COMPAT_API_KEY: "sk-test" }) =>
  AnthropicCompatDriver.create({
    instanceId: "anthropic-compat",
    displayName: "My gateway",
    enabled: true,
    config: AnthropicCompatDriver.decodeConfig({ url: "https://gateway.example", model: "my-claude", ...config }),
    environment,
  });

async function runTurn(
  body: string | Array<string>,
  overrides: Partial<SendTurnInput> = {},
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
  const bodies: string[] = [];
  const seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const queue = Array.isArray(body) ? [...body] : [body];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const text = typeof init?.body === "string" ? init.body : "";
      bodies.push(text);
      seen.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      });
      if (fetchImpl) return fetchImpl(input, init);
      const next = queue.shift() ?? queue[queue.length - 1] ?? "";
      return new Response(next, { status: 200, headers: { "content-type": "text/event-stream" } });
    }),
  );
  const instance = await create();
  const events: RuntimeEvent[] = [];
  instance.adapter.onEvent((event) => events.push(event));
  await instance.adapter.sendTurn({ threadId: "thread", text: "hi", ...overrides });
  await vi.waitFor(() => {
    if (!events.some((event) => event.type === "turn.completed")) throw new Error("turn still running");
  });
  await instance.dispose();
  return { events, bodies, seen };
}

const textStream =
  'data: {"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":0}}}\n\n' +
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n' +
  'data: {"type":"content_block_stop","index":0}\n\n' +
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n' +
  'data: {"type":"message_stop"}\n\n';

describe("AnthropicCompatDriver", () => {
  it("speaks the Messages wire contract and translates the stream", async () => {
    const { events, seen } = await runTurn(textStream, { transcript: [{ role: "user", text: "earlier" }, { role: "assistant", text: "sure" }] });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://gateway.example/v1/messages");
    expect(seen[0].headers.get("x-api-key")).toBe("sk-test");
    expect(seen[0].headers.get("anthropic-version")).toBe("2023-06-01");
    expect(seen[0].body).toMatchObject({
      model: "my-claude",
      stream: true,
      max_tokens: expect.any(Number),
      messages: [
        { role: "user", content: [{ type: "text", text: "earlier" }] },
        { role: "assistant", content: [{ type: "text", text: "sure" }] },
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
    });
    // No tools were mounted, so a strict gateway never sees a tools array.
    expect(seen[0].body).not.toHaveProperty("tools");

    const deltas = events.filter((event) => event.type === "content.delta").map((event) => (event as { delta: string }).delta);
    expect(deltas).toEqual(["Hello", " there"]);
    expect(events.find((event) => event.type === "item.completed")).toMatchObject({ itemType: "assistant_text", text: "Hello there" });
    expect(events.find((event) => event.type === "runtime.error")).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true, usage: { input: 11, output: 7 } });
  });

  it("round-trips a streamed tool_use through a real tool result", async () => {
    const executed: unknown[] = [];
    const first =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"fx_read"}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"README.md\\"}"}}\n\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}\n\n' +
      'data: {"type":"message_stop"}\n\n';
    const { events, seen } = await runTurn([first, textStream], {
      turnTools: [{
        name: "fx_read",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        execute: (args) => {
          executed.push(args);
          return "file contents";
        },
      }],
    });

    expect(executed).toEqual([{ path: "README.md" }]);
    expect(events.find((event) => event.type === "item.completed" && event.itemType === "tool")).toMatchObject({
      itemId: "toolu_1",
      ok: true,
    });
    expect(events.find((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toMatchObject({
      text: "Hello there",
    });

    // The second request hands the assistant's own tool_use block back
    // verbatim, then the tool_result as the next user turn.
    const second = seen[1].body as { messages: Array<{ role: string; content: Array<Record<string, unknown>> }>; tools: Array<{ name: string }> };
    expect(seen[1].body).toMatchObject({ tools: [{ name: "fx_read" }] });
    expect(second.messages.at(-2)).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "fx_read", input: { path: "README.md" } }],
    });
    const resultBlock = second.messages.at(-1)!.content[0];
    expect(resultBlock).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(JSON.parse(String(resultBlock.content))).toEqual({ ok: true, result: "file contents" });

    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
  });

  it("raises a terminal runtime error when the provider refuses the turn", async () => {
    const { events } = await runTurn("", {}, async () =>
      new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }));
    expect(events.find((event) => event.type === "runtime.error")).toMatchObject({
      type: "runtime.error",
      terminal: true,
      message: expect.stringContaining("HTTP 401"),
    });
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
  });

  it("reports availability from the key alone", async () => {
    const without = await create({}, {});
    expect(await without.snapshot()).toMatchObject({ state: "unavailable" });
    await without.dispose();
    const withKey = await create();
    expect(await withKey.snapshot()).toMatchObject({ state: "available", authenticated: true });
    await withKey.dispose();
  });
});
