// The native Codex runtime is what makes a signed-in ChatGPT account usable
// on a host without the Codex CLI: the same Responses protocol the CLI speaks,
// over the tokens the sign-in stored. These tests run against a scripted
// transport — no network, no CLI, no account — and pin the wire shape (URL,
// headers, body), the tool round-trip, and token renewal.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { recordEvents } from "../testing/events.ts";
import { CodexDriver } from "./codex.ts";
import { compactFunctionCallArguments, compactToolOutputs, createCodexNativeRuntime } from "./codex-native-runtime.ts";
import { readCodexCredential } from "./codex-native-auth.ts";

const jwt = (payload: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const futureExp = (): number => Math.floor(Date.now() / 1000) + 3600;

type Call = { url: string; init: RequestInit };

function writeAuth(
  home: string,
  options: { accessToken?: string; refreshToken?: string; exp?: number; email?: string; accountId?: string } = {},
): void {
  const email = options.email ?? "person@example.com";
  const accountId = options.accountId ?? "acct-1";
  const exp = options.exp ?? futureExp();
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      id_token: jwt({ email, chatgpt_account_id: accountId, exp }),
      access_token: options.accessToken ?? jwt({ chatgpt_account_id: accountId, exp }),
      refresh_token: options.refreshToken ?? "refresh-1",
      account_id: accountId,
    },
    last_refresh: new Date().toISOString(),
    email,
  }));
}

const sse = (events: unknown[]): string =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

const completed = (output: unknown[], usage?: { input_tokens: number; output_tokens: number }): unknown => ({
  type: "response.completed",
  response: { id: "resp_1", status: "completed", output, ...(usage ? { usage } : {}) },
});

const textDelta = (delta: string): unknown => ({ type: "response.output_text.delta", delta });

const assistantItem = (text: string): unknown => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});

const functionCallItem = (callId: string, name: string, args: unknown): unknown => ({
  type: "function_call",
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
});

function scriptedTransport(responses: Array<() => Response>, token?: (init: RequestInit) => Response) {
  const calls: Call[] = [];
  const transport = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/oauth/token")) {
      if (!token) throw new Error("unexpected token refresh");
      return token(init);
    }
    const next = responses.shift();
    if (!next) throw new Error("no scripted response left");
    return next();
  }) as unknown as typeof fetch;
  return { transport, calls };
}

const okStream = (body: string): (() => Response) =>
  () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });

describe("codex native backend runtime", () => {
  let home: string;
  let environment: () => Record<string, string | undefined>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "omb-codex-native-runtime-"));
    environment = () => ({ HOME: home, USERPROFILE: home, CODEX_HOME: join(home, ".codex") });
  });

  afterEach(() => {
    removeTempDir(home);
  });

  const runtimeFor = (transport: typeof fetch, extra: Record<string, unknown> = {}) =>
    createCodexNativeRuntime({
      environment,
      models: () => ({ default: "gpt-5.6-sol", options: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }] }),
      transport,
      responsesUrl: "https://backend.test/backend-api/codex/responses",
      tokenUrl: "https://auth.test/oauth/token",
      requestTimeoutMs: 5_000,
      ...extra,
    });

  it("sends the ChatGPT responses request with the stored sign-in and streams the reply", async () => {
    writeAuth(home);
    const { transport, calls } = scriptedTransport([
      okStream(sse([
        { type: "response.created", response: { id: "resp_1" } },
        textDelta("Hel"),
        textDelta("lo"),
        completed([assistantItem("Hello")], { input_tokens: 11, output_tokens: 4 }),
      ])),
    ]);
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-1",
      text: "say hello",
      system: "be terse",
      model: "gpt-5.6-sol",
      approvalMode: "full",
    });
    const done = await recorder.until((event) => event.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://backend.test/backend-api/codex/responses");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${readCodexCredential(environment())?.accessToken}`);
    expect(headers["chatgpt-account-id"]).toBe("acct-1");
    expect(headers.originator).toBe("codex_cli_rs");
    expect(headers["session-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      instructions: "be terse",
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: expect.stringMatching(/^thread-1/),
    });
    expect(body.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "say hello" }] },
    ]);
    expect(body.tools).toBeUndefined();

    const deltas = recorder.events.filter((event) => event.type === "content.delta");
    expect(deltas.map((event) => (event.type === "content.delta" ? event.delta : "")).join("")).toBe("Hello");
    expect(recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "assistant_text"))
      .toMatchObject([{ text: "Hello" }]);
    expect(recorder.events.filter((event) => event.type === "thread.token-usage.updated"))
      .toMatchObject([{ input: 11, output: 4 }]);
  });

  it("reports the provider's cached share of input instead of discarding it", async () => {
    writeAuth(home);
    const { transport } = scriptedTransport([
      okStream(sse([
        textDelta("Hello"),
        completed([assistantItem("Hello")], {
          input_tokens: 1_000,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 750 },
        } as never),
      ])),
    ]);
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-cached",
      text: "say hello",
      system: "be terse",
      model: "gpt-5.6-sol",
      approvalMode: "full",
    });
    await recorder.until((event) => event.type === "turn.completed");

    // input is the total the provider billed as input; cachedInput is the part
    // it served from cache — kept apart because the two price differently.
    expect(recorder.events.filter((event) => event.type === "thread.token-usage.updated"))
      .toMatchObject([{ input: 1_000, output: 20, cachedInput: 750 }]);
  });

  it("proceeds to the provider when an integration cannot initialize and reports readiness", async () => {
    writeAuth(home);
    const script = join(home, "broken-mcp.mjs");
    writeFileSync(script, `
      import { createInterface } from "node:readline";
      const lines = createInterface({ input: process.stdin });
      lines.on("line", (line) => {
        let request;
        try { request = JSON.parse(line); } catch { return; }
        if (request.id === undefined) return;
        if (request.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "fixture down" } }) + "\\n");
          return;
        }
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }) + "\\n");
      });
    `);
    const { transport, calls } = scriptedTransport([
      okStream(sse([textDelta("Hello"), completed([assistantItem("Hello")])])),
    ]);
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-broken-tools",
      text: "say hello",
      system: "be terse",
      model: "gpt-5.6-sol",
      approvalMode: "full",
      integrations: { custom: { broken: { command: process.execPath, args: [script], env: {} } } },
    });
    const done = await recorder.until((event) => event.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(String(body.instructions)).toContain("[Tool Availability Notice]");
    expect(String(body.instructions)).toContain("broken (initialize; rpc_-32000)");
    expect(String(body.instructions)).not.toContain("fixture down");
    expect(body.tools).toBeUndefined();
    expect(recorder.events.find((event) => event.type === "tool.readiness")).toMatchObject({
      type: "tool.readiness",
      providerStarted: true,
      toolCount: 0,
      servers: [expect.objectContaining({ server: "broken", ok: false, stage: "initialize", code: "rpc_-32000" })],
    });
  });

  it("sends admitted image bytes as input_image and never serializes provenance", async () => {
    writeAuth(home);
    const imagePath = join(home, "probe.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);
    writeFileSync(imagePath, bytes);
    const { transport, calls } = scriptedTransport([
      okStream(sse([textDelta("It is blue."), completed([assistantItem("It is blue.")])])),
      okStream(sse([textDelta("No image."), completed([assistantItem("No image.")])])),
    ]);
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);
    const settled = (count: number) =>
      recorder.until(() => recorder.events.filter((event) => event.type === "turn.completed").length >= count);

    await runtime.adapter.sendTurn({
      threadId: "thread-image",
      text: "What colour is the circle?",
      approvalMode: "full",
      images: [{
        path: imagePath,
        mime: "image/png",
        bytes: bytes.length,
        author: "user",
        ownerThreadId: "thread-image",
        messageId: "message-1",
      }],
    });
    await settled(1);

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init.body)) as { input: Array<{ content: unknown[] }> };
    expect(body.input.at(-1)?.content).toEqual([
      { type: "input_text", text: "What colour is the circle?" },
      { type: "input_image", image_url: `data:image/png;base64,${bytes.toString("base64")}` },
    ]);
    // Provenance stays server-side: the backend receives bytes, not who owns
    // the thread or which message bound the file.
    expect(JSON.stringify(body)).not.toContain("ownerThreadId");
    expect(JSON.stringify(body)).not.toContain("message-1");

    await runtime.adapter.sendTurn({
      threadId: "thread-image",
      text: "And now with no picture?",
      approvalMode: "full",
    });
    await settled(2);

    expect(calls).toHaveLength(2);
    const next = JSON.parse(String(calls[1].init.body)) as { input: Array<{ content: unknown[] }> };
    expect(next.input.at(-1)?.content).toEqual([
      { type: "input_text", text: "And now with no picture?" },
    ]);
    expect(JSON.stringify(next)).not.toContain("input_image");
  });

  it("round-trips a tool call: the output item comes back as function_call_output", async () => {
    writeAuth(home);
    const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "opaque-blob", summary: [] };
    const { transport, calls } = scriptedTransport([
      okStream(sse([
        { type: "response.output_item.done", item: reasoning },
        { type: "response.output_item.done", item: functionCallItem("call_1", "read_page", { page: 2 }) },
        completed([reasoning, functionCallItem("call_1", "read_page", { page: 2 })]),
      ])),
      okStream(sse([
        textDelta("The page says X."),
        completed([assistantItem("The page says X.")]),
      ])),
    ]);
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-tools",
      text: "read page 2",
      approvalMode: "full",
      turnTools: [{
        name: "read_page",
        description: "read a page",
        inputSchema: { type: "object", properties: { page: { type: "number" } } },
        execute: () => "page text",
      }],
    });
    const done = await recorder.until((event) => event.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });

    expect(calls).toHaveLength(2);
    const first = JSON.parse(String(calls[0].init.body)) as { tools: Array<Record<string, unknown>> };
    expect(first.tools).toEqual([{
      type: "function",
      name: "read_page",
      description: "read a page",
      parameters: { type: "object", properties: { page: { type: "number" } } },
    }]);
    const second = JSON.parse(String(calls[1].init.body)) as { input: unknown[] };
    expect(second.input).toContainEqual(reasoning);
    expect(second.input).toContainEqual(functionCallItem("call_1", "read_page", { page: 2 }));
    const output = second.input.find((item) => (item as { type?: string }).type === "function_call_output");
    expect(output).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: JSON.stringify({ ok: true, result: "page text" }),
    });
    const toolEvents = recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "tool");
    expect(toolEvents).toMatchObject([{ ok: true }]);
  });

  const pageTool = () => ({
    name: "read_page",
    description: "read a page",
    inputSchema: { type: "object", properties: { page: { type: "number" } } },
    execute: () => "page text",
  });
  const toolCallRound = () => okStream(sse([
    { type: "response.output_item.done", item: functionCallItem("call_1", "read_page", { page: 2 }) },
    completed([functionCallItem("call_1", "read_page", { page: 2 })]),
  ]));

  const emptyEarlyEnd = () => okStream(sse([
    { type: "response.created", response: { id: "resp_empty_end" } },
    { type: "response.incomplete", response: { id: "resp_empty_end", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [], usage: { input_tokens: 0, output_tokens: 0 } } },
  ]));

  it("retries a failed request after a tool already ran, without executing the tool twice", async () => {
    writeAuth(home);
    // The old rule was "any executed tool makes every later failure terminal".
    // That is not what replay risk means: a retry is issued inside `complete`,
    // before this round's calls run, and the executed call's output is already
    // in `input`. Refusing it discarded a turn that still held its work — the
    // defect that ended the project-management turn after two tool calls.
    let executions = 0;
    const { transport, calls } = scriptedTransport([
      toolCallRound(),
      () => { throw new Error("fetch failed"); },
      okStream(sse([textDelta("Done."), completed([assistantItem("Done.")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-tool-then-fail",
      text: "read page 2 then answer",
      approvalMode: "full",
      turnTools: [{
        ...pageTool(),
        execute: () => {
          executions += 1;
          return "page text";
        },
      }],
    });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(executions).toBe(1);
    const responses = calls.filter((call) => call.url.includes("/responses"));
    expect(responses).toHaveLength(3);
    expect(recorder.events.filter((event) => event.type === "turn.retrying"))
      .toMatchObject([{ attempt: 1, reason: "connection_reset" }]);
    // The retried request still carries the executed call, so the model resumes
    // from the result instead of re-running it.
    const retried = JSON.parse(String(responses[1].init.body)) as { input: unknown[] };
    expect(retried.input).toContainEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: JSON.stringify({ ok: true, result: "page text" }),
    });
    recorder.stop();
  });

  it("recovers from an empty early end in a later round and keeps the work already done", async () => {
    writeAuth(home);
    // The measured device failure: real tool work finished, then the backend
    // closed a request with no items, no text and no usage. It is retryable,
    // and the retry must carry the state rather than restart the task.
    const { transport, calls } = scriptedTransport([
      toolCallRound(),
      emptyEarlyEnd(),
      okStream(sse([textDelta("Task finished."), completed([assistantItem("Task finished.")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-early-end-after-tool",
      text: "read page 2 then answer",
      approvalMode: "full",
      turnTools: [pageTool()],
    });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(recorder.events.filter((event) => event.type === "runtime.error")).toHaveLength(0);
    const responses = calls.filter((call) => call.url.includes("/responses"));
    expect(responses).toHaveLength(3);
    expect(recorder.events.filter((event) => event.type === "turn.retrying"))
      .toMatchObject([{ reason: "early_termination" }]);
    const retried = JSON.parse(String(responses[1].init.body)) as { input: unknown[] };
    expect(JSON.stringify(retried.input)).toContain("page text");
    recorder.stop();
  });

  it("retries a stream that ends before any output or terminal event", async () => {
    writeAuth(home);
    const truncated = () => okStream(sse([{ type: "response.created", response: { id: "resp_trunc" } }]));
    const { transport, calls } = scriptedTransport([
      truncated(),
      okStream(sse([textDelta("Recovered"), completed([assistantItem("Recovered")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-eof-before-output", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.type === "turn.retrying"))
      .toMatchObject([{ reason: "early_termination" }]);
    recorder.stop();
  });

  it("retries a 200 response whose body carries no events", async () => {
    writeAuth(home);
    const { transport, calls } = scriptedTransport([
      okStream(""),
      okStream(sse([textDelta("Recovered"), completed([assistantItem("Recovered")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-empty-200", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.type === "turn.retrying"))
      .toMatchObject([{ reason: "early_termination" }]);
    recorder.stop();
  });

  it("continues a partly finished task when repeated empty early ends exhaust the retries", async () => {
    writeAuth(home);
    // Three attempts with nothing generated is the end of this request's retry
    // budget. A turn that already did real work resumes from that work instead
    // of being thrown away, with a bounded number of resumptions.
    let executions = 0;
    const { transport, calls } = scriptedTransport([
      toolCallRound(),
      emptyEarlyEnd(),
      emptyEarlyEnd(),
      emptyEarlyEnd(),
      okStream(sse([textDelta("Finished after recovery"), completed([assistantItem("Finished after recovery")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-resume-after-empty",
      text: "read page 2 then answer",
      approvalMode: "full",
      turnTools: [{
        ...pageTool(),
        execute: () => {
          executions += 1;
          return "page text";
        },
      }],
    });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(executions).toBe(1);
    const responses = calls.filter((call) => call.url.includes("/responses"));
    expect(responses).toHaveLength(5);
    expect(recorder.events.filter((event) => event.type === "turn.retrying" && event.reason === "early_termination_resume"))
      .toHaveLength(1);
    const resumed = JSON.parse(String(responses[4].init.body)) as { input: unknown[] };
    const state = JSON.stringify(resumed.input);
    expect(state).toContain("[Recovery]");
    expect(state).toContain("read_page");
    expect(state).toContain("do not start over");
    recorder.stop();
  });

  it("reports the failing request's attempts, not every request the turn made", async () => {
    writeAuth(home);
    const { transport } = scriptedTransport([
      toolCallRound(),
      () => { throw new Error("fetch failed"); },
      () => { throw new Error("fetch failed"); },
      () => { throw new Error("fetch failed"); },
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-attempt-count",
      text: "read page 2 then answer",
      approvalMode: "full",
      turnTools: [pageTool()],
    });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false });
    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    // Four requests were made in the turn; the failed one was tried three times.
    expect(errors).toMatchObject([{ terminal: true, attempts: 3 }]);
    recorder.stop();
  });

  it("keeps streamed text when the stream ends before a terminal event", async () => {
    writeAuth(home);
    // A partial answer followed by EOF is not retried: the text already reached
    // the person, and replaying the request would duplicate it.
    const { transport, calls } = scriptedTransport([
      okStream(sse([{ type: "response.created", response: { id: "resp_cut" } }, textDelta("Partial")])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-eof-after-text", text: "explain" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "error" });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
    const streamed = recorder.events
      .filter((event) => event.type === "content.delta")
      .map((event) => (event.type === "content.delta" ? event.delta : ""))
      .join("");
    expect(streamed).toBe("Partial");
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(0);
    recorder.stop();
  });

  it("compacts old tool outputs, keeping call ids, ok flags and the newest results", () => {
    const input: Array<Record<string, unknown>> = [{ type: "message", role: "user", content: [] }];
    for (let index = 0; index < 12; index++) {
      input.push({
        type: "function_call_output",
        call_id: `call_${index}`,
        output: JSON.stringify({ ok: true, result: `payload-${index}-${"x".repeat(20_000)}` }),
      });
    }

    expect(compactToolOutputs(input, { budgetChars: 50_000, keepVerbatim: 2 })).toBe(10);
    const outputs = input.filter((item) => item.type === "function_call_output");
    const oldest = String(outputs[0]?.output);
    expect(outputs[0]).toMatchObject({ call_id: "call_0" });
    expect(oldest).toContain("[compacted:");
    expect(oldest).toContain("payload-0-");
    expect(JSON.parse(oldest)).toMatchObject({ ok: true });
    // The newest results are the ones the model is still working from.
    expect(String(outputs.at(-1)?.output)).toContain("payload-11-");
    expect(String(outputs.at(-1)?.output).length).toBeGreaterThan(20_000);
    // Inside the budget, nothing is touched.
    expect(compactToolOutputs(input, { budgetChars: 10_000_000 })).toBe(0);
  });

  it("compacts older function call arguments with large payload strings while preserving keys", () => {
    const input: Array<Record<string, unknown>> = [{ type: "message", role: "user", content: [] }];
    for (let index = 0; index < 6; index++) {
      input.push({
        type: "function_call",
        call_id: `call_${index}`,
        name: "project_write",
        arguments: JSON.stringify({ path: `src/file_${index}.ts`, content: "export const x = " + "a".repeat(15_000) }),
      });
      input.push({
        type: "function_call_output",
        call_id: `call_${index}`,
        output: JSON.stringify({ ok: true, result: `Wrote file_${index}.ts` }),
      });
    }

    const compacted = compactFunctionCallArguments(input, { keepVerbatim: 2 });
    expect(compacted).toBe(4);
    const calls = input.filter((item) => item.type === "function_call");
    const oldestArgs = JSON.parse(String(calls[0]?.arguments));
    expect(oldestArgs.path).toBe("src/file_0.ts");
    expect(oldestArgs.content).toContain("[compacted 15017 chars from earlier step:");
    const newestArgs = JSON.parse(String(calls[5]?.arguments));
    expect(newestArgs.content.length).toBeGreaterThan(15_000);
  });

  it("stops at the round boundary when the person cancels while a tool is running", async () => {
    writeAuth(home);
    // The other boundary a round clock does not govern: a stop. The tool round
    // completed its work, and the next request must never be sent — no retry,
    // no "finish the thought" round after the person stopped.
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });
    let releaseTool!: () => void;
    const toolGate = new Promise<void>((resolve) => { releaseTool = resolve; });
    const { transport, calls } = scriptedTransport([
      toolCallRound(),
      okStream(sse([textDelta("unreachable"), completed([assistantItem("unreachable")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 60_000 });
    const recorder = recordEvents(runtime.adapter);

    const turn = await runtime.adapter.sendTurn({
      threadId: "thread-cancel-between-rounds",
      text: "read page 2 then answer",
      approvalMode: "full",
      turnTools: [{
        ...pageTool(),
        execute: async () => { toolStarted(); await toolGate; return "page text"; },
      }],
    });
    await started;
    // interruptTurn settles with the turn, and the turn is waiting on this
    // tool: release it only after the stop is requested, then join the stop.
    const stopping = runtime.adapter.interruptTurn("thread-cancel-between-rounds", turn.turnId);
    releaseTool();
    await stopping;
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "interrupted" });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
    recorder.stop();
  });

  it("ends the turn when one round's budget is exhausted, without starting another round", async () => {
    writeAuth(home);
    const { transport, calls } = neverResponds();
    const runtime = runtimeFor(transport, {
      timeoutPolicy: { connectTimeoutMs: 40, firstTokenTimeoutMs: 40 },
      retryBudgetMs: 1_050,
      retryScale: 0.001,
    });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-round-exhausted",
      text: "go",
      approvalMode: "full",
      turnTools: [pageTool()],
    });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "timeout" });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "tool")).toHaveLength(0);
    recorder.stop();
  });

  it("renews an expired access token and persists the rotation", async () => {
    writeAuth(home, { exp: Math.floor(Date.now() / 1000) - 60 });
    const fresh = jwt({ chatgpt_account_id: "acct-1", exp: futureExp() });
    const { transport, calls } = scriptedTransport(
      [okStream(sse([textDelta("Hi"), completed([assistantItem("Hi")])]))],
      () => new Response(JSON.stringify({ access_token: fresh, refresh_token: "refresh-2" }), { status: 200 }),
    );
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-refresh", text: "hi" });
    await recorder.until((event) => event.type === "turn.completed");

    const refreshCall = calls.find((call) => call.url === "https://auth.test/oauth/token");
    expect(refreshCall).toBeDefined();
    expect(JSON.parse(String(refreshCall?.init.body))).toEqual({
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
    const responsesCall = calls.find((call) => call.url.includes("/responses"));
    const responsesHeaders = (responsesCall?.init.headers ?? {}) as Record<string, string>;
    expect(responsesHeaders.authorization).toBe(`Bearer ${fresh}`);
    expect(readCodexCredential(environment())).toMatchObject({ accessToken: fresh, refreshToken: "refresh-2" });
  });

  it("renews once on a 401 and retries the request with the new token", async () => {
    writeAuth(home);
    const fresh = jwt({ chatgpt_account_id: "acct-1", exp: futureExp() });
    const { transport, calls } = scriptedTransport(
      [
        () => new Response("unauthorized", { status: 401 }),
        okStream(sse([textDelta("Hi"), completed([assistantItem("Hi")])])),
      ],
      () => new Response(JSON.stringify({ access_token: fresh, refresh_token: "refresh-2" }), { status: 200 }),
    );
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-401", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });

    const responsesCalls = calls.filter((call) => call.url.includes("/responses"));
    expect(responsesCalls).toHaveLength(2);
    expect((responsesCalls[1].init.headers as Record<string, string>).authorization).toBe(`Bearer ${fresh}`);
  });

  // --- one budget for a whole retry sequence -------------------------------
  //
  // The per-attempt deadlines bound one request; these bound the sequence. A
  // provider that never answers must cost one budget, not one budget per
  // attempt — that is the difference between "the app is thinking" and "the
  // app is gone" for the person holding the phone.

  /** A transport that accepts the request and never answers with headers. */
  const neverResponds = () => {
    const calls: Call[] = [];
    const transport = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    return { transport, calls };
  };

  /** Headers, then not a single event — the first-token stall. */
  const silentStream = () => {
    const calls: Call[] = [];
    const bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
    const transport = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const body = new ReadableStream<Uint8Array>({ start(controller) { bodies.push(controller); } });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    return { transport, calls };
  };

  it("stops the retry sequence when the budget runs out, not when the attempts do", async () => {
    writeAuth(home);
    const { transport, calls } = neverResponds();
    // 40ms to connect, 1050ms in total: attempt 1 leaves 1010ms, attempt 2
    // leaves ~970ms — under the minimum worth starting, so the sequence ends.
    const runtime = runtimeFor(transport, {
      timeoutPolicy: { connectTimeoutMs: 40, firstTokenTimeoutMs: 40 },
      retryBudgetMs: 1_050,
      retryScale: 0.001,
    });
    const recorder = recordEvents(runtime.adapter);

    const startedAt = Date.now();
    await runtime.adapter.sendTurn({ threadId: "thread-budget-connect", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");
    const elapsed = Date.now() - startedAt;

    expect(done).toMatchObject({ ok: false, stopReason: "timeout" });
    // Bounded by the budget, not by three connect deadlines.
    expect(elapsed).toBeLessThan(1_050 + 700);
    // Two attempts, not the three the attempt counter alone would allow.
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);

    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    expect(errors).toHaveLength(1);
    const message = errors[0]?.type === "runtime.error" ? errors[0].message : "";
    expect(message).toContain("The provider did not answer within 40ms (connect timeout).");
    expect(message).toContain("Retrying stopped after 1.1s: the retry budget for this request was used up.");
    // The card's attempt count comes from the requests actually made, not from
    // the retry ceiling.
    expect(errors[0]).toMatchObject({ attempts: 2 });
    // One settlement, never two.
    expect(recorder.events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    recorder.stop();
  });

  it("bounds a first-token stall that used to cost three 75s attempts", async () => {
    writeAuth(home);
    const { transport, calls } = silentStream();
    const runtime = runtimeFor(transport, {
      timeoutPolicy: { connectTimeoutMs: 200, firstTokenTimeoutMs: 800 },
      retryBudgetMs: 2_000,
      retryScale: 0.001,
    });
    const recorder = recordEvents(runtime.adapter);

    const startedAt = Date.now();
    await runtime.adapter.sendTurn({ threadId: "thread-budget-first-token", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");
    const elapsed = Date.now() - startedAt;

    expect(done).toMatchObject({ ok: false, stopReason: "timeout" });
    // Nobody waits two full attempts plus a third: the total is the bound.
    expect(elapsed).toBeLessThan(2_400);
    const responses = calls.filter((call) => call.url.includes("/responses"));
    expect(responses.length).toBe(2);
    const message = recorder.events
      .filter((event) => event.type === "runtime.error")
      .map((event) => (event.type === "runtime.error" ? event.message : ""))
      .join(" ");
    expect(message).toContain("took too long to begin its response");
    expect(message).toContain("Retrying stopped after 2s");
    recorder.stop();
  });

  it("does not start another attempt when the budget runs out during backoff", async () => {
    writeAuth(home);
    const { transport, calls } = neverResponds();
    const runtime = runtimeFor(transport, {
      timeoutPolicy: { connectTimeoutMs: 20, firstTokenTimeoutMs: 20 },
      retryBudgetMs: 1_400,
      // 1.2s of backoff after a 20ms attempt leaves less than one attempt.
      retryScale: 1.2,
    });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-budget-backoff", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "timeout" });
    // The wait itself spent the budget, so the second attempt never happened.
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
    const retrying = recorder.events.filter((event) => event.type === "turn.retrying");
    expect(retrying).toHaveLength(1);
    recorder.stop();
  }, 15_000);

  it("still completes when the retry succeeds inside the budget", async () => {
    writeAuth(home);
    const { transport, calls } = scriptedTransport([
      () => { throw new Error("fetch failed"); },
      okStream(sse([textDelta("Back"), completed([assistantItem("Back")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-budget-ok", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(1);
    recorder.stop();
  });

  it("settles an output-ceiling response as output_limit on the first attempt", async () => {
    writeAuth(home);
    // `max_output_tokens` is deterministic: the same request reaches the same
    // ceiling. Retrying it labelled the failure `server_error` and made the
    // person wait through three identical truncations before the honest card.
    const ceiling = () => okStream(sse([
      { type: "response.created", response: { id: "resp_ceiling" } },
      // A real ceiling spends the budget, and the provider reports that spend.
      { type: "response.incomplete", response: { id: "resp_ceiling", incomplete_details: { reason: "max_output_tokens" }, output: [], usage: { input_tokens: 1_200, output_tokens: 16_384 } } },
    ]));
    const { transport, calls } = scriptedTransport([ceiling(), ceiling(), ceiling()]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-output-ceiling", text: "explain at length" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "output_limit" });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(0);
    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ terminal: true });
    expect(errors[0]?.type === "runtime.error" ? errors[0].message : "").toContain("max_output_tokens");
    expect(recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toHaveLength(0);
    recorder.stop();
  });

  it("retries an empty max_output_tokens response instead of calling it a ceiling", async () => {
    writeAuth(home);
    // Measured on Android: response.created, response.in_progress,
    // response.metadata, response.incomplete(max_output_tokens) with no text,
    // no items and usage 0/0 — for "Reply with exactly: PLAIN_OK". Nothing was
    // truncated, so settling as output_limit told the person to ask for less
    // and refused the retry that fixes it.
    const emptyCeiling = () => okStream(sse([
      { type: "response.created", response: { id: "resp_empty" } },
      { type: "response.in_progress", response: { id: "resp_empty" } },
      { type: "response.metadata", response: { id: "resp_empty" } },
      { type: "response.incomplete", response: { id: "resp_empty", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [], usage: { input_tokens: 0, output_tokens: 0 } } },
    ]));
    const { transport, calls } = scriptedTransport([
      emptyCeiling(),
      okStream(sse([textDelta("PLAIN_OK"), completed([assistantItem("PLAIN_OK")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-empty-ceiling", text: "Reply with exactly: PLAIN_OK" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(1);
    // The first attempt must not be described as a token ceiling, and must not
    // settle the turn before the retry runs.
    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    expect(errors).toHaveLength(0);
    expect(JSON.stringify(recorder.events)).not.toContain("max_output_tokens");
    recorder.stop();
  });

  it("keeps partial text that arrived before the ceiling and still marks the turn output_limit", async () => {
    writeAuth(home);
    const partial = () => okStream(sse([
      { type: "response.created", response: { id: "resp_partial" } },
      textDelta("A binary search tree keeps"),
      {
        type: "response.incomplete",
        response: {
          id: "resp_partial",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [assistantItem("A binary search tree keeps")],
        },
      },
    ]));
    const { transport, calls } = scriptedTransport([partial()]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-output-partial", text: "explain binary search trees" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    const text = recorder.events
      .filter((event) => event.type === "item.completed" && event.itemType === "assistant_text")
      .map((event) => (event.type === "item.completed" ? event.text : ""))
      .join("");
    expect(text).toBe("A binary search tree keeps");
    // The person keeps what was produced, but the turn is not called complete.
    expect(done).toMatchObject({ ok: false, stopReason: "output_limit" });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(0);
    recorder.stop();
  });

  it("retries an early incomplete response only when the cause is not the output ceiling", async () => {
    writeAuth(home);
    const earlyIncomplete = () => okStream(sse([
      { type: "response.created", response: { id: "resp_early" } },
      { type: "response.incomplete", response: { id: "resp_early", incomplete_details: { reason: "server_error" }, output: [] } },
    ]));
    const { transport, calls } = scriptedTransport([
      earlyIncomplete(),
      okStream(sse([textDelta("Recovered"), completed([assistantItem("Recovered")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-early-incomplete", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(1);
    recorder.stop();
  });

  it("does not replay an executed tool when a later round hits the output ceiling", async () => {
    writeAuth(home);
    let executions = 0;
    const tool = {
      ...pageTool(),
      execute: () => {
        executions += 1;
        return "page text";
      },
    };
    const { transport, calls } = scriptedTransport([
      toolCallRound(),
      okStream(sse([
        { type: "response.created", response: { id: "resp_after_tool" } },
        textDelta("I read the page and"),
        {
          type: "response.incomplete",
          response: {
            id: "resp_after_tool",
            incomplete_details: { reason: "max_output_tokens" },
            output: [assistantItem("I read the page and")],
          },
        },
      ])),
      toolCallRound(),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-tool-then-ceiling",
      text: "read page 2 then answer",
      approvalMode: "full",
      turnTools: [tool],
    });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "output_limit" });
    expect(executions).toBe(1);
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(0);
    recorder.stop();
  });

  it("never executes a tool proposed by an incomplete response", async () => {
    writeAuth(home);
    let executions = 0;
    const tool = {
      ...pageTool(),
      execute: () => {
        executions += 1;
        return "page text";
      },
    };
    const proposed = () => okStream(sse([
      { type: "response.output_item.done", item: functionCallItem("call_proposed", "read_page", { page: 2 }) },
      {
        type: "response.incomplete",
        response: {
          id: "resp_proposed",
          incomplete_details: { reason: "max_output_tokens" },
          output: [functionCallItem("call_proposed", "read_page", { page: 2 })],
        },
      },
    ]));
    const { transport, calls } = scriptedTransport([proposed()]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({
      threadId: "thread-proposed-tool",
      text: "read page 2",
      approvalMode: "full",
      turnTools: [tool],
    });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "output_limit" });
    expect(executions).toBe(0);
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
    expect(recorder.events.filter((event) => event.type === "item.started" && event.itemType === "tool")).toHaveLength(0);
    recorder.stop();
  });

  it("recovers on the next turn after an output-limit settlement", async () => {
    writeAuth(home);
    const ceiling = () => okStream(sse([
      { type: "response.incomplete", response: { id: "resp_ceiling", incomplete_details: { reason: "max_output_tokens" }, output: [], usage: { input_tokens: 900, output_tokens: 16_384 } } },
    ]));
    const { transport, calls } = scriptedTransport([
      ceiling(),
      okStream(sse([textDelta("Short answer"), completed([assistantItem("Short answer")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-recover-next-turn", text: "answer at length" });
    const first = await recorder.until((event) => event.type === "turn.completed");
    expect(first).toMatchObject({ ok: false, stopReason: "output_limit" });

    await runtime.adapter.sendTurn({ threadId: "thread-recover-next-turn", text: "answer briefly" });
    const second = await recorder.until((event) => event.type === "turn.completed" && event.turnId !== first.turnId);
    expect(second).toMatchObject({ ok: true, stopReason: null });
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    recorder.stop();
  });

  it("gives every HTTP request its own session id, even within one turn", async () => {
    writeAuth(home);
    // The backend keys conversation context off Session-Id. Reusing one across
    // a retry can make it return an early incomplete response with zero tokens;
    // each retried request — like each tool round — must carry a fresh id.
    // (The output ceiling is terminal now, so this fixture uses a transient
    // early end instead.)
    const earlyIncomplete = () => okStream(sse([
      { type: "response.created", response: { id: "resp_early" } },
      { type: "response.incomplete", response: { id: "resp_early", incomplete_details: { reason: "server_error" }, output: [] } },
    ]));
    const { transport, calls } = scriptedTransport([
      earlyIncomplete(),
      okStream(sse([textDelta("Recovered"), completed([assistantItem("Recovered")])])),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-session-id", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(1);

    const responses = calls.filter((call) => call.url.includes("/responses"));
    expect(responses).toHaveLength(2);
    const sessionIds = responses.map((call) => (call.init.headers as Record<string, string>)["session-id"]);
    expect(sessionIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionIds[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionIds[0]).not.toBe(sessionIds[1]);

    const bodies = responses.map((call) => JSON.parse(String(call.init.body)) as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({
      model: "gpt-5.6-sol",
      max_output_tokens: 16384,
      prompt_cache_key: expect.stringMatching(/^thread-session-id:[0-9a-f-]{36}$/),
    });
    expect(bodies[1].prompt_cache_key).toBe(bodies[0].prompt_cache_key);
    expect(bodies[1].input).toEqual(bodies[0].input);
    expect(bodies[1].max_output_tokens).toBe(16384);
    recorder.stop();
  });

  it("never cuts a response that is working just because the retry budget is short", async () => {
    writeAuth(home);
    // The first event arrives at once and the completion 400ms later: far past a
    // 150ms retry budget, and exactly the case the budget must not touch.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(sse([{ type: "response.created", response: { id: "resp_slow" } }, textDelta("Slow")])));
        setTimeout(() => {
          controller.enqueue(encoder.encode(sse([completed([assistantItem("Slow reply")])])));
          controller.close();
        }, 400);
      },
    });
    const { transport } = scriptedTransport([
      () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 150, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-budget-slow", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    expect(recorder.events.filter((event) => event.type === "runtime.error")).toHaveLength(0);
    recorder.stop();
  });

  it("keeps non-retryable failures non-retryable under a budget", async () => {
    writeAuth(home);
    const { transport, calls } = scriptedTransport([
      () => new Response("invalid request body", { status: 400 }),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-budget-400", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false });
    // An invalid request (400) is terminal and never retried.
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
    recorder.stop();
  });

  it("retries HTTP 504 gateway timeout and succeeds on next attempt", async () => {
    writeAuth(home);
    const { transport, calls } = scriptedTransport([
      () => new Response("<html>Gateway Timeout</html>", { status: 504 }),
      () => okStream(sse([
        { type: "response.output_text.delta", delta: "Recovered from 504" },
        { type: "response.completed", response: { id: "resp_ok", status: "completed" } },
      ]))(),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-504-retry", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: true });
    // Attempt 1 failed with 504, attempt 2 succeeded.
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(1);
    const retryEvent = recorder.events.find((event) => event.type === "turn.retrying");
    expect(retryEvent).toMatchObject({ attempt: 1, reason: "server_error" });
    recorder.stop();
  });

  it("retries HTTP 500, 502, 503 server errors", async () => {
    writeAuth(home);
    for (const status of [500, 502, 503]) {
      const { transport, calls } = scriptedTransport([
        () => new Response("server hiccup", { status }),
        () => okStream(sse([
          { type: "response.output_text.delta", delta: `Recovered from ${status}` },
          { type: "response.completed", response: { id: `resp_${status}`, status: "completed" } },
        ]))(),
      ]);
      const runtime = runtimeFor(transport, { retryBudgetMs: 5_000, retryScale: 0.001 });
      const recorder = recordEvents(runtime.adapter);

      await runtime.adapter.sendTurn({ threadId: `thread-${status}`, text: "hi" });
      const done = await recorder.until((event) => event.type === "turn.completed");

      expect(done).toMatchObject({ ok: true });
      expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(2);
      expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(1);
      recorder.stop();
    }
  });

  it("retries transient 504 until attempt exhaustion and reports accurate attempt count", async () => {
    writeAuth(home);
    const { transport, calls } = scriptedTransport([
      () => new Response("<html>Gateway Timeout 1</html>", { status: 504 }),
      () => new Response("<html>Gateway Timeout 2</html>", { status: 504 }),
      () => new Response("<html>Gateway Timeout 3</html>", { status: 504 }),
    ]);
    const runtime = runtimeFor(transport, { retryBudgetMs: 30_000, retryScale: 0.001 });
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-504-exhaust", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "timeout" });
    // Exactly 3 attempts made
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(3);
    const errorEvent = recorder.events.find((event) => event.type === "runtime.error");
    expect(errorEvent).toMatchObject({ terminal: true, attempts: 3 });
    recorder.stop();
  });

  it("stops the whole sequence when the person cancels", async () => {
    writeAuth(home);
    const { transport, calls } = neverResponds();
    // A connect budget far longer than the test, so only the interrupt can end it.
    const runtime = runtimeFor(transport, {
      timeoutPolicy: { connectTimeoutMs: 30_000, firstTokenTimeoutMs: 30_000 },
      retryBudgetMs: 60_000,
    });
    const recorder = recordEvents(runtime.adapter);

    const started = await runtime.adapter.sendTurn({ threadId: "thread-budget-cancel", text: "hi" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await runtime.adapter.interruptTurn("thread-budget-cancel", started.turnId);
    const done = await recorder.until((event) => event.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "interrupted" });
    // Cancelling ends the retry sequence; it does not start a fresh attempt.
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
    expect(recorder.events.filter((event) => event.type === "turn.retrying")).toHaveLength(0);
    recorder.stop();
  });

  it("reports a failed response as a terminal runtime error, not a silent empty turn", async () => {
    writeAuth(home);
    const { transport, calls } = scriptedTransport([
      okStream(sse([{
        type: "response.failed",
        response: { id: "resp_x", status: "failed", error: { code: "invalid_request_error", message: "The model is not supported" } },
      }])),
    ]);
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-fail", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "error" });
    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    expect(errors).toMatchObject([{ terminal: true }]);
    expect(errors[0]?.type === "runtime.error" ? errors[0].message : "").toContain("invalid_request_error");
    // A terminal refusal is never retried blindly.
    expect(calls.filter((call) => call.url.includes("/responses"))).toHaveLength(1);
  });
});

describe("CodexDriver without the CLI", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "omb-codex-native-driver-"));
  });

  afterEach(() => {
    removeTempDir(scratch);
  });

  const create = async (): Promise<Awaited<ReturnType<typeof CodexDriver.create>>> =>
    CodexDriver.create({
      instanceId: "codex-native-test",
      displayName: "Codex",
      environment: { HOME: scratch, USERPROFILE: scratch, CODEX_HOME: join(scratch, ".codex") },
      enabled: true,
      config: { cli: "omb-no-such-codex-cli-9f3a2b", fullAuto: false },
    });

  it("reports a signed-in account as an available provider with no CLI on the host", async () => {
    writeAuth(scratch);
    const instance = await create();
    expect(await instance.snapshot()).toMatchObject({
      state: "available",
      authenticated: true,
      version: null,
      billing: "subscription",
      account: { method: "login", email: "person@example.com" },
    });
    // The native runtime answers helper calls; the CLI-only path never did.
    expect(instance.generateText).toBeTypeOf("function");
    // No in-session steering on the backend runtime, and the host has no CLI
    // to queue into either.
    expect(instance.adapter.capabilities.queueing).toBe(false);
  });

  it("stays unavailable with neither a CLI nor a sign-in", async () => {
    const instance = await create();
    expect(await instance.snapshot()).toMatchObject({
      state: "unavailable",
      reason: "`omb-no-such-codex-cli-9f3a2b` CLI not found",
    });
    expect(instance.generateText).toBeUndefined();
  });
});
