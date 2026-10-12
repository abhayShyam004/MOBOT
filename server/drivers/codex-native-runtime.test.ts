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
import { createCodexNativeRuntime } from "./codex-native-runtime.ts";
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
    expect(headers["session-id"]).toBe("thread-1");
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      instructions: "be terse",
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: "thread-1",
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

  it("reports a failed response as a terminal runtime error, not a silent empty turn", async () => {
    writeAuth(home);
    const { transport, calls } = scriptedTransport([
      okStream(sse([{
        type: "response.failed",
        response: { id: "resp_x", status: "failed", error: { code: "rate_limit_exceeded", message: "Rate limit reached" } },
      }])),
    ]);
    const runtime = runtimeFor(transport);
    const recorder = recordEvents(runtime.adapter);

    await runtime.adapter.sendTurn({ threadId: "thread-fail", text: "hi" });
    const done = await recorder.until((event) => event.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "error" });
    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    expect(errors).toMatchObject([{ terminal: true }]);
    expect(errors[0]?.type === "runtime.error" ? errors[0].message : "").toContain("rate_limit_exceeded");
    // A protocol failure is never retried blindly.
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
