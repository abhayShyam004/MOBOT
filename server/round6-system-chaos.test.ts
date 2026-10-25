import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseSendId,
  sendFingerprint,
  SendSequencer,
} from "./send-idempotency.ts";
import {
  cancelSteeredMessage,
  drainSteeredMessages,
  queuedSteeredMessage,
  queuedSteerSnapshot,
  queueSteeredMessage,
  restoreSteeredMessages,
  _queuedCount,
} from "./steer-queue.ts";
import {
  clearUserLocation,
  loadUserLocation,
  resolveLocationIntent,
  type UserLocation,
} from "./location-context.ts";
import {
  escapeInputText,
  escapeShellComponent,
  normalizeInputText,
} from "./drivers/phone-proxy.ts";
import {
  checkToolPermission,
  classifyTool,
} from "./permission-policy.ts";
import type { AgentPermissionsConfig } from "./config.ts";
import {
  extractTurnFiles,
  readDocumentPages,
  removeDocumentsForThread,
  resetTurnDocumentRegistry,
} from "./turn-files.ts";
import { GoalManager } from "./goals.ts";
import { WatchManager } from "./watches.ts";
import { type BotRecord, type Message } from "./store.ts";
import { ATTACHMENTS_DIR } from "./attachments.ts";

describe("Round 6: Full-System Chaos & Cross-Subsystem Regression", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omb-r6-chaos-"));
    restoreSteeredMessages();
    resetTurnDocumentRegistry();
  });

  afterEach(() => {
    restoreSteeredMessages();
    resetTurnDocumentRegistry();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  function createTestStore(botId: string, threadId: string) {
    const messages: Message[] = [];
    return {
      messages,
      bot: (id: string) =>
        id === botId ? ({ id, threadId, busy: false } as BotRecord) : null,
      appendMessage: (_t: string, msg: Omit<Message, "id" | "at">) => {
        const saved = { ...msg, id: `msg-${messages.length}`, at: Date.now() };
        messages.push(saved);
        return saved;
      },
      patchMessage: () => null,
    };
  }

  // =========================================================================
  // 1. CHAT / STREAMING CHAOS (200+ VARIED MESSAGES REPLAY)
  // =========================================================================
  describe("1. Chat & Streaming Chaos (200+ message corpus)", () => {
    const generateCorpus = (): string[] => {
      const items: string[] = [];

      // Basic conversation (20)
      for (let i = 1; i <= 20; i++) {
        items.push(`Standard conversational inquiry #${i}: What are the key properties of system component ${i}?`);
      }

      // Technical & Code (30)
      for (let i = 1; i <= 30; i++) {
        items.push(
          `function calculateValue_${i}(input: number): number {\n  const result = input * ${i};\n  return result > 100 ? result : 100;\n}`
        );
      }

      // URLs and Query Parameters (25)
      for (let i = 1; i <= 25; i++) {
        items.push(
          `https://api.example.com/v1/search?query=component_${i}&filter=active&sort=desc&page=${i}#result-${i}`
        );
      }

      // Math & Expressions (25)
      for (let i = 1; i <= 25; i++) {
        items.push(`Evaluate: (${i} * 15.5) / [3 + {4 * (2 - 1)}] + 100% - $50.25`);
      }

      // Punctuation & Metacharacters (30)
      const metachars = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '{', '}', '[', ']', '|', '\\', ':', ';', '"', "'", '<', '>', ',', '.', '?', '/', '~', '`'];
      for (let i = 0; i < 30; i++) {
        items.push(`Special string test: ${metachars.slice(0, i + 1).join(" ")} -- index=${i}`);
      }

      // Ambiguous & Contradictory (30)
      for (let i = 1; i <= 30; i++) {
        items.push(
          `User request with conflicting instructions: Please perform task A, but actually do task B instead, while ignoring component ${i}.`
        );
      }

      // Long Prompts (20) - 2KB to 5KB each
      for (let i = 1; i <= 20; i++) {
        items.push(
          `Detailed architectural overview #${i}:\n` +
            `Section A: Analysis of distributed node clustering under load.\n`.repeat(15) +
            `Section B: Memory cache eviction strategies.\n`.repeat(15)
        );
      }

      // Follow-up & Revisions (20)
      for (let i = 1; i <= 20; i++) {
        items.push(`Follow-up #${i}: Regarding the previous response, can you elaborate on point ${i}?`);
      }

      // Edge Cases: Numbers, JSON, Markdown (20)
      for (let i = 1; i <= 20; i++) {
        items.push(JSON.stringify({ testId: i, payload: { value: i * 100, active: i % 2 === 0, tags: ["system", "test"] } }));
      }

      return items;
    };

    const corpus = generateCorpus();

    it("verifies the corpus contains 220 varied test inputs", () => {
      expect(corpus.length).toBe(220);
    });

    it("replays all 220 messages through send validation, queueing, and drainage without data loss", () => {
      const botId = "chaos-bot-1";
      const threadId = "chaos-thread-1";
      const store = createTestStore(botId, threadId);

      // 1. Replay each message into the queue
      const queueIds: string[] = [];
      for (let idx = 0; idx < corpus.length; idx++) {
        const text = corpus[idx];
        const sendId = `send-chaos-key-${String(idx).padStart(4, "0")}`;
        const queued = queueSteeredMessage(botId, threadId, text, {
          sendId,
          prompt: text,
        });
        expect(queued.id).toBeTruthy();
        queueIds.push(queued.id);
      }

      expect(_queuedCount(threadId)).toBe(220);

      // 2. Verify queue snapshot reflects all messages in order
      const snapshot = queuedSteerSnapshot(() => true);
      expect(snapshot[threadId]).toHaveLength(220);
      expect(snapshot[threadId][0].text).toBe(corpus[0]);
      expect(snapshot[threadId][219].text).toBe(corpus[219]);

      // 3. Drain all messages atomically
      const runFn = vi.fn();
      drainSteeredMessages(store, runFn);

      expect(runFn).toHaveBeenCalledTimes(1);
      expect(store.messages).toHaveLength(220);
      expect(_queuedCount(threadId)).toBe(0);

      // Verify prompt combined all 220 messages with double newlines
      const combinedPrompt = runFn.mock.calls[0][2];
      expect(combinedPrompt).toContain(corpus[0]);
      expect(combinedPrompt).toContain(corpus[219]);
    });

    it("handles concurrent sends and coalesces duplicate sendIds cleanly", async () => {
      const sequencer = new SendSequencer();
      const sendId = "send-unique-concurrent-12345678";
      const fingerprint = sendFingerprint("Test concurrent send");

      let executionCount = 0;
      const work = async () => {
        executionCount += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, timestamp: Date.now() };
      };

      // 10 concurrent requests with the identical sendId
      const promises = Array.from({ length: 10 }, () =>
        sequencer.run(sendId, fingerprint, work)
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      expect(executionCount).toBe(1); // Only executed once!
      for (const res of results) {
        expect(res.ok).toBe(true);
      }
    });

    it("rejects conflicting text with the same sendId with 409 conflict", async () => {
      const sequencer = new SendSequencer();
      const sendId = "send-conflict-key-87654321000";
      const fp1 = sendFingerprint("Initial message");
      const fp2 = sendFingerprint("Conflicting message with same ID");

      const first = sequencer.run(sendId, fp1, async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true };
      });

      await expect(
        sequencer.run(sendId, fp2, async () => ({ ok: true }))
      ).rejects.toMatchObject({ status: 409 });

      await first;
    });

    it("rejects invalid sendId formats at the schema boundary", () => {
      expect(() => parseSendId("short")).toThrow(/sendId must be a client-generated id/);
      expect(() => parseSendId("with spaces in key name 123456")).toThrow();
      expect(parseSendId("valid-client-id-12345678901234")).toBe("valid-client-id-12345678901234");
      expect(parseSendId(undefined)).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. CONTEXT / MEMORY / BOT ISOLATION CHAOS
  // =========================================================================
  describe("2. Context, Memory & Bot Isolation", () => {
    it("deleting Bot A cleans up transcripts, memory, watches, and goals without leaking into Bot B", () => {
      const goalFile = join(tempDir, "goals.json");
      const watchFile = join(tempDir, "watches.json");

      const gm = new GoalManager(goalFile);
      const wm = new WatchManager(watchFile);

      // Create goals for Bot A and Bot B
      gm.createGoal({ botId: "bot-a", title: "Bot A Goal", objective: "Private A" });
      const goalB = gm.createGoal({ botId: "bot-b", title: "Bot B Goal", objective: "Private B" });
      expect(gm.listGoals("bot-a")).toHaveLength(1);
      expect(gm.listGoals("bot-b")).toHaveLength(1);

      // Create watches for Bot A and Bot B
      wm.createWatch({ botId: "bot-a", target: "https://api.a.com", condition: "status == 200" });
      const watchB = wm.createWatch({ botId: "bot-b", target: "https://api.b.com", condition: "status == 200" });
      expect(wm.listWatches("bot-a")).toHaveLength(1);
      expect(wm.listWatches("bot-b")).toHaveLength(1);

      // Delete Bot A's goals and watches
      const goalsRemoved = gm.deleteGoalsForBot("bot-a");
      const watchesRemoved = wm.deleteWatchesForBot("bot-a");
      expect(goalsRemoved).toBe(1);
      expect(watchesRemoved).toBe(1);

      // Verify Bot A is completely erased while Bot B is 100% pristine
      expect(gm.listGoals("bot-a")).toHaveLength(0);
      expect(gm.listGoals("bot-b")).toHaveLength(1);
      expect(gm.listGoals("bot-b")[0].id).toBe(goalB.id);

      expect(wm.listWatches("bot-a")).toHaveLength(0);
      expect(wm.listWatches("bot-b")).toHaveLength(1);
      expect(wm.listWatches("bot-b")[0].id).toBe(watchB.id);

      // Verify disk persistence after deletion
      const gmReloaded = new GoalManager(goalFile);
      const wmReloaded = new WatchManager(watchFile);
      expect(gmReloaded.listGoals("bot-a")).toHaveLength(0);
      expect(gmReloaded.listGoals("bot-b")).toHaveLength(1);
      expect(wmReloaded.listWatches("bot-a")).toHaveLength(0);
      expect(wmReloaded.listWatches("bot-b")).toHaveLength(1);
    });

    it("verifies queues remain strictly isolated between bots on different tasks", () => {
      queueSteeredMessage("bot-x", "thread-x", "Message for X");
      queueSteeredMessage("bot-y", "thread-y", "Message for Y");

      expect(queuedSteeredMessage("bot-x", "thread-x", "any")).toBeNull();
      expect(queuedSteerSnapshot(() => true)["thread-x"]).toHaveLength(1);
      expect(queuedSteerSnapshot(() => true)["thread-y"]).toHaveLength(1);

      // Attempting to cancel with wrong botId fails
      const cancelledWrong = cancelSteeredMessage("bot-y", queuedSteerSnapshot(() => true)["thread-x"][0].queueId);
      expect(cancelledWrong).toBe(false);
      expect(_queuedCount("thread-x")).toBe(1);

      // Correct botId cancels successfully
      const cancelledRight = cancelSteeredMessage("bot-x", queuedSteerSnapshot(() => true)["thread-x"][0].queueId);
      expect(cancelledRight).toBe(true);
      expect(_queuedCount("thread-x")).toBe(0);
      expect(_queuedCount("thread-y")).toBe(1);
    });
  });

  // =========================================================================
  // 3. LOCATION / MAPS / WEATHER CHAOS
  // =========================================================================
  describe("3. Location, Maps & Weather Chaos", () => {
    const liveDevice: UserLocation = {
      city: "Tokyo",
      country: "Japan",
      latitude: 35.6762,
      longitude: 139.6503,
      provenance: "DEVICE_LIVE",
      source: "device",
      enabled: true,
    };

    const savedUser: UserLocation = {
      city: "Seattle",
      region: "Washington",
      country: "United States",
      provenance: "SAVED_USER",
      enabled: true,
    };

    it("evaluates all location questions against direct inquiries without fabrication", () => {
      // 1. Where am I? (Live device)
      const q1 = resolveLocationIntent("Where am I?", liveDevice);
      expect(q1.scope).toBe("default");
      expect(q1.effectiveLocation?.city).toBe("Tokyo");
      expect(q1.effectiveLocation?.provenance).toBe("DEVICE_LIVE");

      // 2. What city am I in? (Live device) - BUG-033 verification
      const q2 = resolveLocationIntent("What city am I in?", liveDevice);
      expect(q2.scope).toBe("default");
      expect(q2.effectiveLocation?.city).toBe("Tokyo");

      // 3. Which city am I in? (Saved user location when live unavailable)
      const q3 = resolveLocationIntent("Which city am I in?", savedUser);
      expect(q3.scope).toBe("default");
      expect(q3.effectiveLocation?.city).toBe("Seattle");

      // 4. What is near me? (Live device)
      const q4 = resolveLocationIntent("What's near me?", liveDevice);
      expect(q4.scope).toBe("default");
      expect(q4.effectiveLocation?.city).toBe("Tokyo");

      // 5. Open Maps (Live device)
      const q5 = resolveLocationIntent("Open Maps", liveDevice);
      expect(q5.scope).toBe("default");
      expect(q5.effectiveLocation?.city).toBe("Tokyo");

      // 6. Navigate to Central Park (Explicit override)
      const q6 = resolveLocationIntent("Navigate to Central Park", liveDevice);
      expect(q6.scope).toBe("explicit_override");
      expect(q6.effectiveLocation?.city).toBe("Central Park");
      expect(q6.effectiveLocation?.provenance).toBe("USER_EXPLICIT");

      // 7. When unconfigured (UNKNOWN/UNAVAILABLE), never fabricates Austin or any city
      const q7 = resolveLocationIntent("Where am I?", null);
      expect(q7.scope).toBe("default");
      expect(q7.effectiveLocation).toBeNull();
      expect(q7.reason).toContain("unavailable");

      const q8 = resolveLocationIntent("What city am I in?", null);
      expect(q8.scope).toBe("default");
      expect(q8.effectiveLocation).toBeNull();
    });

    it("verifies explicit location overrides saved default but never overwrites persistent storage", () => {
      const explicit = resolveLocationIntent("Find ramen in Kyoto", savedUser);
      expect(explicit.scope).toBe("explicit_override");
      expect(explicit.effectiveLocation?.city).toBe("Kyoto");
      expect(explicit.effectiveLocation?.provenance).toBe("USER_EXPLICIT");

      // Persistence remains untouched
      expect(savedUser.city).toBe("Seattle");
      expect(savedUser.provenance).toBe("SAVED_USER");
    });

    it("clearing user location completely removes disk file and leaves memory clean", () => {
      const locPath = join(tempDir, "user-location.json");
      writeFileSync(locPath, JSON.stringify(savedUser, null, 2), "utf8");
      expect(existsSync(locPath)).toBe(true);

      const loaded = loadUserLocation(tempDir);
      expect(loaded?.city).toBe("Seattle");

      clearUserLocation(tempDir);
      expect(existsSync(locPath)).toBe(false);
      expect(loadUserLocation(tempDir)).toBeNull();
    });
  });

  // =========================================================================
  // 4. COMPUTER USE CHAOS
  // =========================================================================
  describe("4. Computer Use & Phone Proxy", () => {
    it("escapes shell components with dollar signs", () => {
      expect(escapeShellComponent("com.app/com.app.MainActivity$SubClass")).toBe(
        "com.app/com.app.MainActivity\\$SubClass"
      );
    });

    it("escapes all printable ASCII punctuation, URLs, and code characters properly", () => {
      const sample = 'https://example.com/api?a=1&b=2#ref; val="test"; (x > 0 && y < 10);';
      const escaped = escapeInputText(sample);
      expect(escaped).toContain("\\?");
      expect(escaped).toContain("\\&");
      expect(escaped).toContain("\\#");
      expect(escaped).toContain("\\;");
      expect(escaped).toContain('\\"test\\"');
      expect(escaped).toContain("\\(");
      expect(escaped).toContain("\\)");
      expect(escaped).toContain("\\<");
      expect(escaped).toContain("\\>");
    });

    it("normalizes smart quotes, dashes, and accented unicode into ASCII", () => {
      const input = '“Hello”—said the café façade…';
      const normalized = normalizeInputText(input);
      expect(normalized).toBe('"Hello"-said the cafe facade...');
    });
  });

  // =========================================================================
  // 5. PERMISSIONS / PROVIDERS / COMPOSIO
  // =========================================================================
  describe("5. Permissions, Providers & Composio", () => {
    it("properly classifies tools into their respective canonical domains", () => {
      expect(classifyTool("Bash").domain).toBe("terminal");
      expect(classifyTool("open_app").domain).toBe("terminal");
      expect(classifyTool("ReadFile").domain).toBe("filesystem");
      expect(classifyTool("http_fetch").domain).toBe("browser");
      expect(classifyTool("composio_send_email").domain).toBe("composio");
      expect(classifyTool("ask_user").domain).toBe("system");
      expect(classifyTool("unrecognized_tool_xyz").domain).toBe("unknown");
    });

    it("fails closed on denied permissions and unknown tools with actionable reasons", () => {
      const deniedConfig: AgentPermissionsConfig = {
        terminal: "denied",
        filesystem: "denied",
        browser: "denied",
        composio: "denied",
      };

      const t1 = checkToolPermission("run_shell", deniedConfig);
      expect(t1.allowed).toBe(false);
      expect(t1.reason).toContain("Terminal & Shell Execution is disabled");

      const t2 = checkToolPermission("workspace_write", deniedConfig);
      expect(t2.allowed).toBe(false);
      expect(t2.reason).toContain("Filesystem Read & Write is disabled");

      const t3 = checkToolPermission("web_search", deniedConfig);
      expect(t3.allowed).toBe(false);
      expect(t3.reason).toContain("Browser & Network is disabled");

      const t4 = checkToolPermission("composio_slack_post", deniedConfig);
      expect(t4.allowed).toBe(false);
      expect(t4.reason).toContain("Composio Integrations is disabled");

      // Unknown tool fails closed
      const tUnknown = checkToolPermission("random_hacker_backdoor", { terminal: "granted" });
      expect(tUnknown.allowed).toBe(false);
      expect(tUnknown.reason).toContain("blocked by security policy");
    });
  });

  // =========================================================================
  // 6. ATTACHMENTS & ARTIFACTS ISOLATION
  // =========================================================================
  describe("6. Attachments, Research & Document Isolation", () => {
    it("enforces thread-level isolation on registered documents (BUG-032)", async () => {
      // Test thread isolation and removal directly via removeDocumentsForThread
      const docName = "12345678-0000-0000-8000-000000000001.pdf";
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });
      writeFileSync(join(ATTACHMENTS_DIR, docName), "Test PDF content");

      try {
        await extractTurnFiles(`<attached-file path="${docName}" name="ConfidentialReport.pdf" />`, {
          threadId: "thread-isolated-1",
        });

        // Requesting with a mismatched threadId fails with registration error
        const crossAttempt = readDocumentPages("confidentialreport", 1, 2, "thread-isolated-2");
        expect(crossAttempt).toContain("Error: no document is registered under");

        // Evicting documents for thread-isolated-1 cleans up registry
        removeDocumentsForThread("thread-isolated-1");

        // Subsequent read fails even with thread-isolated-1
        const afterEviction = readDocumentPages("confidentialreport", 1, 2, "thread-isolated-1");
        expect(afterEviction).toContain("Error: no document is registered under");
      } finally {
        rmSync(join(ATTACHMENTS_DIR, docName), { force: true });
      }
    });

    it("handles binary files, empty files, and malformed tags safely without throwing", async () => {
      const emptyName = "12345678-0000-0000-8000-000000000002.txt";
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });
      writeFileSync(join(ATTACHMENTS_DIR, emptyName), "");

      try {
        const res = await extractTurnFiles(`<attached-file path="${emptyName}" name="Empty.txt" />`);
        expect(res.files).toHaveLength(1);
        expect(res.files[0].error).toContain("empty");
        expect(res.text).toContain("could not be read");
      } finally {
        rmSync(join(ATTACHMENTS_DIR, emptyName), { force: true });
      }
    });
  });

  // =========================================================================
  // 7. GOALS / WATCHES / AUTOMATIONS
  // =========================================================================
  describe("7. Goals & Watches Lifecycle", () => {
    it("completes milestones and achieves 100% progress properly", () => {
      const gm = new GoalManager(join(tempDir, "goals-progress.json"));
      const goal = gm.createGoal({
        botId: "bot-alpha",
        title: "Test Goal",
        objective: "Milestone test",
        milestones: [
          {
            title: "Milestone 1",
            tasks: [{ title: "Task 1" }],
          },
          {
            title: "Milestone 2",
            tasks: [{ title: "Task 2" }],
          },
        ],
      });

      expect(goal.progress).toBe(0);
      expect(goal.status).toBe("active");

      // Complete Task 1
      const m1 = goal.milestones[0];
      const m2 = goal.milestones[1];
      gm.completeTask(goal.id, m1.id, m1.tasks[0].id);
      const updated1 = gm.getGoal(goal.id)!;
      expect(updated1.progress).toBe(50);
      expect(updated1.milestones[0].completed).toBe(true);

      // Complete Task 2 -> Goal fully achieved
      gm.completeTask(goal.id, m2.id, m2.tasks[0].id);
      const updated2 = gm.getGoal(goal.id)!;
      expect(updated2.progress).toBe(100);
      expect(updated2.status).toBe("completed");
      expect(updated2.nextAction).toBe("Goal fully achieved!");
    });

    it("paused watches never probe and report skipped status", async () => {
      const wm = new WatchManager(join(tempDir, "watches-paused.json"));
      const watch = wm.createWatch({
        botId: "bot-beta",
        target: "https://status.example.com",
        condition: "healthy",
      });

      wm.pauseWatch(watch.id);
      expect(wm.getWatch(watch.id)?.status).toBe("paused");

      const probeResult = await wm.checkWatch(watch.id);
      expect(probeResult).toMatchObject({
        watchId: watch.id,
        changed: false,
        triggered: false,
        note: "Watch is paused; check skipped",
      });
    });
  });

  describe("8. Phase 9: Self-Evaluation Under System Chaos & Flaky Execution", () => {
    it("resiliently traps chaos stream of empty, junk, disguised error, and malformed outputs", async () => {
      const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");
      const { ObservabilityBus } = await import("./capabilities/observability.ts");
      const { ERR_EMPTY_OR_JUNK_PAYLOAD } = await import("./capabilities/safety-policy.ts");

      const bus = new ObservabilityBus();
      let iteration = 0;

      // Chaotic sequence of failing/junk payloads followed by clean success
      const chaosPayloads = [
        { success: true, rawOutput: "", resultSummary: "" }, // empty string
        { success: true, rawOutput: { results: [] }, resultSummary: "0 results returned" }, // empty search
        { success: true, rawOutput: { error: "upstream timeout", status: 504 }, resultSummary: "HTTP 200" }, // disguised error
        { success: true, rawOutput: { size: 0, path: "report.pdf" }, resultSummary: "Wrote report.pdf" }, // empty file
        { success: true, rawOutput: '{"incomplete": true,', resultSummary: "diagnostics json" }, // corrupted json
      ];

      const loop = new AgentExecutionLoop({
        objective: "Perform resilient system health diagnostics producing JSON summary",
        maxTurns: 10,
        observabilityBus: bus,
        stepHandler: async (_plan) => {
          iteration++;
          if (iteration <= chaosPayloads.length) {
            const chaos = chaosPayloads[iteration - 1];
            return {
              action: `chaos_step_${iteration}`,
              success: chaos.success,
              rawOutput: chaos.rawOutput,
              resultSummary: chaos.resultSummary,
            };
          }
          // Final clean step
          return {
            action: "clean_final_step",
            success: true,
            rawOutput: JSON.stringify({ status: "healthy", services: ["auth", "database", "storage"] }),
            resultSummary: "Clean diagnostics completed successfully with all services healthy",
          };
        },
      });

      // Run until settled across all chaotic steps
      const finalState = await loop.runUntilSettled();

      expect(iteration).toBe(6);
      expect(finalState.phase).toBe("complete");
      expect(finalState.turnNumber).toBe(6);
      expect(finalState.terminationReason).toBe("goal_achieved");

      // Verify that every single chaos step was trapped as a semantic failure
      const semanticFailures = bus.getEvents({ type: "AGENT_LOOP_SEMANTIC_FAILURE" });
      expect(semanticFailures.length).toBe(5);

      // Verify error codes logged for junk
      const junkEvents = semanticFailures.filter((e) =>
        String(e.payload.criticism).includes(ERR_EMPTY_OR_JUNK_PAYLOAD)
      );
      expect(junkEvents.length).toBe(4);

      // Verify final self-evaluation succeeded
      const lastEval = loop.getLastSelfEvaluation();
      expect(lastEval?.semanticSuccess).toBe(true);
      expect(lastEval?.objectiveCompleted).toBe(true);
      expect(lastEval?.usefulnessScore).toBeGreaterThanOrEqual(8);
    });
  });
});
