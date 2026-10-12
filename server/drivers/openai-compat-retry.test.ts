// The endpoint a person adds themselves, and what happens when the provider
// rate-limits it.
//
// This is the OpenAI-compatible driver — OpenRouter, Groq, Together, a local
// llama.cpp — which rides the same fetch-based runtime as Grok and MiniMax. A
// real transcript on a phone showed "upstream HTTP 429: {"error":{"message":
// "Provider returned error"...}}" as the bot's answer to a task: the free
// model behind the router had rate-limited the request, and the driver gave up
// on the first response instead of waiting, which is what the turn then
// carried into the conversation as its final word.
//
// The policy under test is the shared one in `retry.ts`: a transient failure
// (429/5xx/reset) gets up to three attempts with 1s/3s/8s backoff, a terminal
// one (401/400) never gets a second, and a turn that already streamed text or
// handled a tool call is never replayed.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";

const SSE_BODY = (text: string) =>
  [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    "data: [DONE]",
    "",
  ].join("\n");

const sseResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });

describe("OpenAI-compatible endpoint failures (fake fetch)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let previousFetch: typeof globalThis.fetch;
  /** Script of chat responses/errors consumed in order; empty = succeed. */
  let script: Array<{ status?: number; sse?: string }> = [];
  /** Chat completions requested — the catalog probe does not count. */
  let calls = 0;

  const create = async () => {
    instance = await OpenAICompatDriver.create({
      instanceId: "openrouter-test",
      displayName: "OpenAI-compatible",
      environment: { OPENAI_COMPAT_API_KEY: "sk-or-v1-fake" },
      enabled: true,
      config: { url: "https://fake.router.invalid/v1", apiKeyEnv: "OPENAI_COMPAT_API_KEY" },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    ensureDirs();
    process.env.FAKE_OPENAI_COMPAT_RETRY_SCALE = "0.001";
    previousFetch = globalThis.fetch;
    calls = 0;
    // SAFETY: the stub only returns real Response objects, the sole member of
    // fetch's return type this driver consumes.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
      // The driver probes /models on create; leave that out of the script.
      if (url.endsWith("/models")) {
        return Response.json({ data: [{ id: "inclusionai/ling-3.1-flash", name: "Ling 3.1 Flash" }] });
      }
      const step = script.shift();
      calls++;
      if (!step || step.sse !== undefined) return sseResponse(step?.sse ?? SSE_BODY("done from the fake router"));
      return new Response(`{"error":{"message":"Provider returned error","code":${step.status}}}`, { status: step.status });
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = previousFetch;
    delete process.env.FAKE_OPENAI_COMPAT_RETRY_SCALE;
    recorder?.stop();
    await instance?.dispose();
  });

  it("waits out a 429 and completes the turn", async () => {
    script = [{ status: 429 }];
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-rate-limit", text: "what is my name" });
    await recorder.until((e) => e.type === "turn.completed" && e.ok === true);

    const retries = recorder.events.filter((e) => e.type === "turn.retrying");
    expect(retries.map((e) => e.reason)).toEqual(["rate_limited"]);
    expect(retries.every((e) => e.delayMs > 0)).toBe(true);
    expect(calls).toBe(2);
    // One answer, not two: the retry replaces the failed attempt.
    expect(recorder.events.filter((e) => e.type === "item.completed" && e.itemType === "assistant_text")).toHaveLength(1);
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true, turnId });
  }, 20_000);

  it("settles as failed after the attempt cap, keeping the endpoint's own error", async () => {
    script = [{ status: 429 }, { status: 429 }, { status: 429 }];
    await create();
    await instance.adapter.sendTurn({ threadId: "t-cap", text: "go" });
    await recorder.until((e) => e.type === "turn.completed" && e.ok === false);

    expect(recorder.events.filter((e) => e.type === "turn.retrying").map((e) => e.attempt)).toEqual([1, 2]);
    expect(calls).toBe(3);
    // The transcript keeps the status the provider gave, because that is what
    // tells a person whether to wait (429) or go and fix a key (401).
    const failure = recorder.events.find((e) => e.type === "runtime.error");
    expect(JSON.stringify(failure)).toContain("upstream HTTP 429");
  }, 20_000);

  it("never retries a terminal auth failure", async () => {
    script = [{ status: 401 }];
    await create();
    await instance.adapter.sendTurn({ threadId: "t-auth", text: "go" });
    await recorder.until((e) => e.type === "turn.completed" && e.ok === false);

    expect(recorder.events.filter((e) => e.type === "turn.retrying")).toHaveLength(0);
    expect(calls).toBe(1);
  }, 20_000);
});
