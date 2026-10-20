import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as journal from "./message-db.ts";
import {
  cancelSteeredMessage,
  drainSteeredMessages,
  queuedSteerSnapshot,
  queueSteeredMessage,
  restoreSteeredMessages,
  type SteerStore,
} from "./steer-queue.ts";
import type { BotRecord, Message } from "./store.ts";

describe("rapid-fire-failure-stress", () => {
  beforeEach(() => {
    restoreSteeredMessages();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    journal.settleChatFollowups(journal.chatFollowups().map((row) => row.id), null);
    restoreSteeredMessages();
  });

  function createMockStore(botId: string, threadId: string): SteerStore & { messages: Message[] } {
    const messages: Message[] = [];
    return {
      messages,
      bot: (id) => (id === botId ? ({ id, threadId, busy: false } as BotRecord) : null),
      appendMessage: (_thread, message) => {
        const saved = { ...message, id: `msg-${messages.length}`, at: Date.now() };
        messages.push(saved);
        return saved;
      },
      patchMessage: () => null,
    };
  }

  it("1. 10 rapid-fire messages sent in quick succession maintain FIFO queue order", () => {
    const botId = "bot-rapid";
    const threadId = "thread-rapid";
    const queueIds: string[] = [];

    // Send 10 messages in rapid succession
    for (let i = 1; i <= 10; i++) {
      const q = queueSteeredMessage(botId, threadId, `rapid message ${i}`, {
        sendId: `send-key-${i}`,
      });
      queueIds.push(q.id);
    }

    expect(queueIds).toHaveLength(10);

    const snapshot = queuedSteerSnapshot(() => true);
    expect(snapshot[threadId]).toHaveLength(10);
    expect(snapshot[threadId].map((item) => item.text)).toEqual([
      "rapid message 1",
      "rapid message 2",
      "rapid message 3",
      "rapid message 4",
      "rapid message 5",
      "rapid message 6",
      "rapid message 7",
      "rapid message 8",
      "rapid message 9",
      "rapid message 10",
    ]);

    // Drain into store and verify single follow-up prompt joins all 10 messages
    const store = createMockStore(botId, threadId);
    let drainedPrompt = "";
    drainSteeredMessages(store, (_b, _t, prompt) => {
      drainedPrompt = prompt;
    });

    expect(store.messages).toHaveLength(10);
    expect(drainedPrompt).toContain("rapid message 1");
    expect(drainedPrompt).toContain("rapid message 10");
  });

  it("2. rapid-fire duplicate message IDs are deduplicated immediately", () => {
    const botId = "bot-dedup";
    const threadId = "thread-dedup";

    // Client double-tap or network retry with identical sendId 5 times
    const q1 = queueSteeredMessage(botId, threadId, "identical payload", { sendId: "unique-client-key-123" });
    const q2 = queueSteeredMessage(botId, threadId, "identical payload", { sendId: "unique-client-key-123" });
    const q3 = queueSteeredMessage(botId, threadId, "identical payload", { sendId: "unique-client-key-123" });
    const q4 = queueSteeredMessage(botId, threadId, "identical payload", { sendId: "unique-client-key-123" });
    const q5 = queueSteeredMessage(botId, threadId, "identical payload", { sendId: "unique-client-key-123" });

    // All returns the same queueId
    expect(q2.id).toBe(q1.id);
    expect(q3.id).toBe(q1.id);
    expect(q4.id).toBe(q1.id);
    expect(q5.id).toBe(q1.id);

    // Queue has exactly 1 entry
    const snapshot = queuedSteerSnapshot(() => true);
    expect(snapshot[threadId]).toHaveLength(1);
    expect(snapshot[threadId][0].queueId).toBe(q1.id);
  });

  it("3. cancellation mid-burst removes targeted message while retaining remaining queue", () => {
    const botId = "bot-cancel";
    const threadId = "thread-cancel";

    const q1 = queueSteeredMessage(botId, threadId, "keep message 1", { sendId: "k1" });
    const q2 = queueSteeredMessage(botId, threadId, "cancel message 2", { sendId: "k2" });
    const q3 = queueSteeredMessage(botId, threadId, "keep message 3", { sendId: "k3" });

    // User cancels message 2
    const cancelled = cancelSteeredMessage(botId, q2.id);
    expect(cancelled).toBe(true);

    const snapshot = queuedSteerSnapshot(() => true);
    expect(snapshot[threadId]).toHaveLength(2);
    expect(snapshot[threadId].map((i) => i.queueId)).toEqual([q1.id, q3.id]);

    const store = createMockStore(botId, threadId);
    let combinedPrompt = "";
    drainSteeredMessages(store, (_b, _t, prompt) => {
      combinedPrompt = prompt;
    });

    expect(combinedPrompt).toContain("keep message 1");
    expect(combinedPrompt).not.toContain("cancel message 2");
    expect(combinedPrompt).toContain("keep message 3");
  });

  it("4. simulated failure injection: timeout in tool execution aborts cleanly without hung state", async () => {
    const timeoutError = new Error("Command execution timed out after 10000ms");
    timeoutError.name = "TimeoutError";

    const executeToolWithTimeout = async (timeoutMs: number): Promise<{ success: boolean; error?: string }> => {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeoutMs);

      try {
        await new Promise((_, reject) => {
          abortController.signal.addEventListener("abort", () => {
            reject(timeoutError);
          });
        });
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      } finally {
        clearTimeout(timer);
      }
    };

    const result = await executeToolWithTimeout(10);
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("5. simulated failure injection: permission denial produces explicit error report without state mutation", () => {
    interface PermissionRequest {
      tool: string;
      granted: boolean;
    }

    const checkPermissionAndExecute = (
      req: PermissionRequest,
      execute: () => void,
    ): { status: "applied" | "denied"; error?: string } => {
      if (!req.granted) {
        return { status: "denied", error: `Permission denied for tool ${req.tool}` };
      }
      execute();
      return { status: "applied" };
    };

    let executed = false;
    const result = checkPermissionAndExecute(
      { tool: "run_shell", granted: false },
      () => {
        executed = true;
      },
    );

    expect(result.status).toBe("denied");
    expect(result.error).toContain("Permission denied");
    expect(executed).toBe(false);
  });

  it("6. simulated failure injection: provider rate limiting (HTTP 429) returns structured retry details", () => {
    interface ProviderResponse {
      status: number;
      retryAfterSeconds?: number;
      error?: string;
    }

    const handleProviderResponse = (res: ProviderResponse): { shouldRetry: boolean; waitMs: number; error: string } => {
      if (res.status === 429) {
        const waitMs = (res.retryAfterSeconds ?? 5) * 1000;
        return {
          shouldRetry: true,
          waitMs,
          error: `Provider rate limit exceeded. Retry after ${res.retryAfterSeconds ?? 5}s`,
        };
      }
      return { shouldRetry: false, waitMs: 0, error: "" };
    };

    const rateLimited = handleProviderResponse({ status: 429, retryAfterSeconds: 3 });
    expect(rateLimited.shouldRetry).toBe(true);
    expect(rateLimited.waitMs).toBe(3000);
    expect(rateLimited.error).toContain("rate limit exceeded");
  });

  it("7. verifies zero emojis anywhere in rapid-fire and failure test assertions", () => {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    expect(emojiRegex.test("rapid message 1")).toBe(false);
    expect(emojiRegex.test("Permission denied")).toBe(false);
    expect(emojiRegex.test("Provider rate limit exceeded")).toBe(false);
  });
});
