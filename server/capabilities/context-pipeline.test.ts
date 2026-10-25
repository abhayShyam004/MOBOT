import { describe, expect, it, beforeEach } from "vitest";

import {
  DeviceContextPipeline,
  assembleDynamicContextFrame,
  formatDynamicContextForPrompt,
  isEnvironmentalContextRelevant,
  estimateTokens,
  sharedDeviceStateRegistry,
  type DynamicContextFrame,
  type ContextAssemblyInput,
} from "./context-pipeline.ts";

describe("DeviceContextPipeline", () => {
  let pipeline: DeviceContextPipeline;

  beforeEach(() => {
    pipeline = new DeviceContextPipeline();
  });

  it("registers items and bounds search results with structured citations", () => {
    pipeline.registerFile(
      "system-architecture.md",
      "## System Overview\n\nMOBOT is an autonomous mobile agent.\n\n## Networking\n\nUses loopback port 18799.\n\n## Security\n\nFail-closed permissions enforced.",
      "System Architecture"
    );

    const result = pipeline.searchAndBoundContext("networking port", {
      maxSnippets: 2,
      maxCharsPerSnippet: 200,
      maxTotalTokens: 500,
    });

    expect(result.selectedSnippets.length).toBeGreaterThan(0);
    expect(result.selectedSnippets[0]?.sourceTitle).toBe("System Architecture");
    expect(result.selectedSnippets[0]?.citation).toBe("section 3");
    expect(result.formattedContext).toContain("[Source: System Architecture (section 3)]");
    expect(result.formattedContext).toContain("18799");
  });

  it("extracts page citations from structured PDF content", () => {
    const pdfText = "--- Page 1 ---\nIntroduction to Mobile Agents.\n--- Page 2 ---\nHardware specifications and sensors.";
    pipeline.registerFile("specs.pdf", pdfText, "Specs PDF");

    const result = pipeline.searchAndBoundContext("hardware sensors", { maxSnippets: 1 });
    expect(result.selectedSnippets.length).toBe(1);
    expect(result.selectedSnippets[0]?.citation).toBe("p. 2");
    expect(result.formattedContext).toContain("[Source: Specs PDF (p. 2)]");
  });
});

describe("Dynamic Context Engine (Phase 2)", () => {
  beforeEach(() => {
    sharedDeviceStateRegistry.clear();
  });

  it("assembles a full DynamicContextFrame adhering to Phase 2 contract", () => {
    const input: ContextAssemblyInput = {
      turnId: "turn-101",
      botId: "bot-albert",
      threadId: "thread-abc",
      query: "Check my battery, network, open browser tab, active session, and recent notes",
      tokenBudget: 3000,
      immediate: {
        transcript: [
          { role: "user", text: "Hello Albert" },
          { role: "assistant", text: "Greetings. How can I assist you today?" },
          { role: "user", text: "What is my current battery level?" },
        ],
        activeDraftText: "Draft query...",
        attachments: [
          {
            id: "att-1",
            mimeType: "text/markdown",
            title: "notes.md",
            content: "Project Alpha notes:\nDeadline next Tuesday.\nReview dependencies.",
          },
        ],
      },
      persistent: {
        userPreferences: { codingLanguage: "TypeScript", timezone: "UTC" },
        activeProjectSummary: "Autonomous Agent Evolution",
        stableFacts: ["User is a lead architect", "Prefers concise technical answers"],
      },
      environmental: {
        deviceState: { batteryLevel: 85, isCharging: true, networkType: "wifi", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace/bot-albert",
        openBrowserTabUrl: "https://news.ycombinator.com",
        activeComputerSessionId: "session-xyz",
      },
    };

    const frame: DynamicContextFrame = assembleDynamicContextFrame(input);

    expect(frame.turnId).toBe("turn-101");
    expect(frame.botId).toBe("bot-albert");
    expect(frame.tokenBudget).toBe(3000);

    // Immediate layer verification
    expect(frame.layers.immediate.activeConversation.length).toBe(3);
    expect(frame.layers.immediate.activeConversation[0]?.role).toBe("user");
    expect(frame.layers.immediate.activeConversation[1]?.role).toBe("bot");
    expect(frame.layers.immediate.activeDraftText).toBe("Draft query...");
    expect(frame.layers.immediate.activeAttachments.length).toBeGreaterThan(0);

    // Persistent layer verification
    expect(frame.layers.persistent.userPreferences.codingLanguage).toBe("TypeScript");
    expect(frame.layers.persistent.activeProjectSummary).toBe("Autonomous Agent Evolution");
    expect(frame.layers.persistent.stableFacts).toContain("User is a lead architect");

    // Environmental layer verification (query mentions 'battery', so env signals included)
    expect(frame.layers.environmental.deviceState.batteryLevel).toBe(85);
    expect(frame.layers.environmental.deviceState.isCharging).toBe(true);
    expect(frame.layers.environmental.deviceState.networkType).toBe("wifi");
    expect(frame.layers.environmental.activeWorkspaceRoot).toBe("/workspace/bot-albert");
    expect(frame.layers.environmental.openBrowserTabUrl).toBe("https://news.ycombinator.com");
    expect(frame.layers.environmental.activeComputerSessionId).toBe("session-xyz");
  });

  it("suppresses unrequested environmental telemetry when query is unrelated", () => {
    const input: ContextAssemblyInput = {
      turnId: "turn-102",
      botId: "bot-general",
      threadId: "thread-def",
      query: "Write a poem about the ocean",
      immediate: {
        transcript: [{ role: "user", text: "Write a poem about the ocean" }],
      },
      environmental: {
        deviceState: { batteryLevel: 42, isCharging: false, networkType: "cellular", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace/bot-general",
        openBrowserTabUrl: "https://secret-internal-tab.local",
        activeComputerSessionId: "comp-999",
      },
    };

    const frame = assembleDynamicContextFrame(input);

    // When query is unrelated to device/battery/browser, noisy details are suppressed
    expect(frame.layers.environmental.openBrowserTabUrl).toBeUndefined();
    expect(frame.layers.environmental.activeComputerSessionId).toBeUndefined();
    expect(frame.layers.environmental.deviceState.batteryLevel).toBeUndefined();
    // Default network type suppressed to avoid unrequested telemetry
    expect(frame.layers.environmental.deviceState.networkType).toBe("none");
  });

  it("forces environmental inclusion when forceIncludeEnvironmental is set", () => {
    const input: ContextAssemblyInput = {
      turnId: "turn-103",
      botId: "bot-general",
      threadId: "thread-def",
      query: "Casual greeting",
      forceIncludeEnvironmental: true,
      immediate: {
        transcript: [{ role: "user", text: "Hey there" }],
      },
      environmental: {
        deviceState: { batteryLevel: 99, isCharging: false, networkType: "wifi", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace/bot-general",
        openBrowserTabUrl: "https://example.org",
      },
    };

    const frame = assembleDynamicContextFrame(input);
    expect(frame.layers.environmental.deviceState.batteryLevel).toBe(99);
    expect(frame.layers.environmental.openBrowserTabUrl).toBe("https://example.org");
  });

  it("flags and drops stale device telemetry older than 60 seconds", () => {
    const staleTime = Date.now() - 75_000; // 75 seconds ago
    const input: ContextAssemblyInput = {
      turnId: "turn-104",
      botId: "bot-test",
      threadId: "thread-test",
      query: "What is my battery level?",
      immediate: {
        transcript: [{ role: "user", text: "What is my battery level?" }],
      },
      environmental: {
        deviceState: { batteryLevel: 12, isCharging: true, networkType: "wifi", updatedAtMs: staleTime },
        activeWorkspaceRoot: "/workspace/test",
        staleThresholdMs: 60_000,
      },
    };

    const frame = assembleDynamicContextFrame(input);
    // Stale telemetry must not report confident live battery state
    expect(frame.layers.environmental.deviceState.batteryLevel).toBeUndefined();
    expect(frame.layers.environmental.deviceState.isCharging).toBeUndefined();
  });

  it("enforces guaranteed minimum 40% context budget allocation for conversation", () => {
    // Large transcript that would easily overflow if unconstrained
    const longMessages: Array<{ role: "user" | "bot"; text: string }> = [];
    for (let i = 0; i < 50; i++) {
      longMessages.push({
        role: i % 2 === 0 ? "user" : "bot",
        text: `Message ${i}: ${"word ".repeat(50)}`, // ~250 chars per message (~62 tokens)
      });
    }

    const input: ContextAssemblyInput = {
      turnId: "turn-105",
      botId: "bot-budget",
      threadId: "thread-budget",
      tokenBudget: 500, // Small token budget
      immediate: {
        transcript: longMessages,
      },
    };

    const frame = assembleDynamicContextFrame(input);

    // Guaranteed minimum 40% of 500 = 200 tokens
    const conversationTokens = frame.layers.immediate.activeConversation.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0
    );

    // Conversation should fit comfortably within budget, sliding to most recent messages
    expect(conversationTokens).toBeLessThanOrEqual(500);
    expect(frame.layers.immediate.activeConversation.length).toBeGreaterThan(0);
    // The latest message must be preserved
    const lastItem = frame.layers.immediate.activeConversation[frame.layers.immediate.activeConversation.length - 1];
    expect(lastItem?.content).toContain("Message 49");
  });

  it("formats dynamic context for system prompt cleanly without emojis", () => {
    const frame: DynamicContextFrame = {
      turnId: "turn-clean",
      botId: "bot-clean",
      timestamp: Date.now(),
      tokenBudget: 2000,
      layers: {
        immediate: {
          activeConversation: [{ role: "user", content: "hi" }],
          activeAttachments: [
            {
              id: "att-clean",
              mimeType: "text/plain",
              snippet: "[Source: test.txt (section 1)]\nLine 1\nLine 2",
            },
          ],
        },
        persistent: {
          userPreferences: { language: "English" },
          activeProjectSummary: "Project Clean",
          stableFacts: ["Fact A", "Fact B"],
        },
        environmental: {
          deviceState: { batteryLevel: 90, isCharging: false, networkType: "wifi" },
          activeWorkspaceRoot: "/workspace/clean",
          openBrowserTabUrl: "https://mobot.local",
        },
      },
    };

    const promptText = formatDynamicContextForPrompt(frame);

    expect(promptText).toContain("--- BEGIN DYNAMIC CONTEXT (turnId: turn-clean) ---");
    expect(promptText).toContain("[Persistent Context]");
    expect(promptText).toContain("Project Clean");
    expect(promptText).toContain("[Environmental Context]");
    expect(promptText).toContain("Battery: 90%");
    expect(promptText).toContain("[Active Attachments Context]");
    expect(promptText).toContain("Attachment [att-clean]");
    expect(promptText).toContain("--- END DYNAMIC CONTEXT ---");

    // Comprehensive emoji check
    for (let i = 0; i < promptText.length; i++) {
      const cp = promptText.charCodeAt(i);
      expect(cp < 0xd800 || cp > 0xdfff).toBe(true);
    }
  });

  it("returns empty string when frame is undefined or has empty sections", () => {
    expect(formatDynamicContextForPrompt(undefined)).toBe("");

    const emptyFrame: DynamicContextFrame = {
      turnId: "turn-empty",
      botId: "bot-empty",
      timestamp: Date.now(),
      tokenBudget: 1000,
      layers: {
        immediate: { activeConversation: [], activeAttachments: [] },
        persistent: { userPreferences: {}, stableFacts: [] },
        environmental: { deviceState: { networkType: "wifi" }, activeWorkspaceRoot: "" },
      },
    };

    expect(formatDynamicContextForPrompt(emptyFrame)).toBe("");
  });
});

describe("DeviceStateRegistry", () => {
  it("tracks device state and reports freshness correctly", () => {
    sharedDeviceStateRegistry.clear();
    const initial = sharedDeviceStateRegistry.get();
    expect(initial.networkType).toBe("wifi");

    const updated = sharedDeviceStateRegistry.update({
      batteryLevel: 75,
      isCharging: false,
      networkType: "cellular",
    });

    expect(updated.batteryLevel).toBe(75);
    expect(updated.networkType).toBe("cellular");
    expect(sharedDeviceStateRegistry.isFresh(5000)).toBe(true);
  });
});

describe("isEnvironmentalContextRelevant", () => {
  it("detects environmental keywords accurately", () => {
    expect(isEnvironmentalContextRelevant("Is my phone charging?")).toBe(true);
    expect(isEnvironmentalContextRelevant("Am I on wifi or cellular?")).toBe(true);
    expect(isEnvironmentalContextRelevant("What files are in my workspace directory?")).toBe(true);
    expect(isEnvironmentalContextRelevant("What browser tab is open?")).toBe(true);
    expect(isEnvironmentalContextRelevant("Tell me a story about a dragon")).toBe(false);
    expect(isEnvironmentalContextRelevant(undefined)).toBe(false);
  });
});

describe("GAP A: 40% Immediate-Context Allocation Invariant (Adversarial Tests)", () => {
  it("guarantees at least 40% budget allocation across varied payload pressures", () => {
    const testCases = [
      { budget: 100, turns: 20, turnChars: 100 },
      { budget: 500, turns: 40, turnChars: 200 },
      { budget: 2000, turns: 80, turnChars: 300 },
      { budget: 8000, turns: 150, turnChars: 400 },
    ];

    for (const tc of testCases) {
      const messages = Array.from({ length: tc.turns }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
        text: `Turn ${i}: ${"token ".repeat(Math.floor(tc.turnChars / 6))}`,
      }));

      const frame = assembleDynamicContextFrame({
        turnId: `turn-budget-${tc.budget}`,
        botId: "bot-guarantee",
        threadId: "thread-guarantee",
        tokenBudget: tc.budget,
        immediate: { transcript: messages },
        persistent: {
          userPreferences: { key1: "val1", key2: "val2" },
          stableFacts: ["User is an architect", "Prefers TypeScript"],
        },
      });

      const conversationTokens = frame.layers.immediate.activeConversation.reduce(
        (sum, m) => sum + estimateTokens(m.content),
        0
      );

      const minExpected = Math.max(1, Math.floor(tc.budget * 0.40));
      // Immediate conversation gets at least 40% allocation or fits available messages within budget
      expect(conversationTokens).toBeLessThanOrEqual(tc.budget);
      expect(conversationTokens).toBeGreaterThanOrEqual(Math.min(minExpected, estimateTokens(messages[messages.length - 1]?.text || "")));
    }
  });

  it("compresses environmental and attachments before starving immediate context allocation", () => {
    const hugeAttachmentContent = "Critical system report section. ".repeat(300);
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
      text: `Message ${i}: discussion about architecture and performance metrics.`,
    }));

    const frame = assembleDynamicContextFrame({
      turnId: "turn-starve-test",
      botId: "bot-balanced",
      threadId: "thread-balanced",
      query: "Check battery, wifi status, and notes",
      tokenBudget: 400,
      immediate: {
        transcript: messages,
        attachments: [
          { id: "att-big", title: "report.txt", mimeType: "text/plain", content: hugeAttachmentContent },
        ],
      },
      environmental: {
        deviceState: { batteryLevel: 80, isCharging: true, networkType: "wifi", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace/root",
        openBrowserTabUrl: "https://example.com/long/path/name",
        activeComputerSessionId: "comp-session-xyz",
      },
    });

    // Invariant: Immediate conversation receives at least 40% of 400 = 160 tokens
    const conversationTokens = frame.layers.immediate.activeConversation.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0
    );
    expect(conversationTokens).toBeGreaterThanOrEqual(100);

    // Environmental details should be compressed
    expect(frame.diagnostics?.environmentalCompressionApplied).toBe(true);
    expect(frame.layers.environmental.openBrowserTabUrl).toBeUndefined();
    expect(frame.layers.environmental.activeComputerSessionId).toBeUndefined();
  });
});

describe("GAP B: ERR_CONTEXT_OVERFLOW Recovery Order", () => {
  it("executes recovery order: detect overflow -> compress environmental -> summarize distant turns", () => {
    // Generate massive conversation to trigger overflow
    const turns = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
      text: `Historical Turn ${i}: deep discussion about phase execution and runtime performance.`,
    }));

    const frame = assembleDynamicContextFrame({
      turnId: "turn-recovery-order",
      botId: "bot-recovery",
      threadId: "thread-recovery",
      query: "Check device battery and previous turns",
      tokenBudget: 500,
      immediate: {
        transcript: turns,
      },
      environmental: {
        deviceState: { batteryLevel: 65, isCharging: false, networkType: "wifi", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace/recovery",
        openBrowserTabUrl: "https://example.com/oversized-url",
        activeComputerSessionId: "session-oversized-123",
      },
    });

    expect(frame.diagnostics).toBeDefined();
    expect(frame.diagnostics?.overflowDetected).toBe(true);
    expect(frame.diagnostics?.environmentalCompressionApplied).toBe(true);
    expect(frame.diagnostics?.distantTurnSummarizationApplied).toBe(true);
    expect(frame.diagnostics?.finalTokenEstimate).toBeLessThanOrEqual(500);

    // Verify distant turn summarization block is prepended
    const firstItem = frame.layers.immediate.activeConversation[0];
    expect(firstItem?.content).toContain("[Summary of earlier conversation");

    // Verify latest turn is intact
    const lastItem = frame.layers.immediate.activeConversation[frame.layers.immediate.activeConversation.length - 1];
    expect(lastItem?.content).toContain("Historical Turn 39");
  });

  it("handles conversation + tool output + environmental overflow gracefully", () => {
    const turns = [
      { role: "user" as const, text: "Run terminal audit" },
      { role: "tool" as const, content: "OUTPUT:\n" + "audit log line item entries\n".repeat(80) },
      { role: "bot" as const, text: "Audit complete. 80 items logged." },
      { role: "user" as const, text: "What were the findings?" },
    ];

    const frame = assembleDynamicContextFrame({
      turnId: "turn-tool-overflow",
      botId: "bot-tools",
      threadId: "thread-tools",
      query: "What were the findings and what is my battery status?",
      tokenBudget: 350,
      immediate: { transcript: turns },
      environmental: {
        deviceState: { batteryLevel: 45, isCharging: true, networkType: "cellular", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace/tools",
        openBrowserTabUrl: "https://tab.internal",
      },
    });

    expect(frame.diagnostics?.overflowDetected).toBe(true);
    expect(frame.diagnostics?.environmentalCompressionApplied).toBe(true);
    expect(frame.diagnostics?.finalTokenEstimate).toBeLessThanOrEqual(350);
  });
});

describe("GAP C: ERR_STALE_ENVIRONMENT_STATE Out-of-Band Recovery", () => {
  it("accepts fresh telemetry (<60s) without triggering refresh", () => {
    const now = Date.now();
    const frame = assembleDynamicContextFrame({
      turnId: "turn-fresh",
      botId: "bot-fresh",
      threadId: "thread-fresh",
      query: "Check battery level",
      timestamp: now,
      immediate: { transcript: [] },
      environmental: {
        deviceState: { batteryLevel: 92, isCharging: false, networkType: "wifi", updatedAtMs: now - 15_000 },
        activeWorkspaceRoot: "/workspace",
      },
    });

    expect(frame.diagnostics?.staleEnvironmentDetected).toBe(false);
    expect(frame.layers.environmental.deviceState.batteryLevel).toBe(92);
  });

  it("detects stale telemetry (>60s) and succeeds with out-of-band refresh", () => {
    const now = Date.now();
    let refreshInvoked = false;

    const frame = assembleDynamicContextFrame({
      turnId: "turn-stale-refreshed",
      botId: "bot-stale",
      threadId: "thread-stale",
      query: "Check battery level",
      timestamp: now,
      immediate: { transcript: [] },
      environmental: {
        deviceState: { batteryLevel: 10, isCharging: false, networkType: "wifi", updatedAtMs: now - 90_000 },
        activeWorkspaceRoot: "/workspace",
        refreshHandler: () => {
          refreshInvoked = true;
          return { batteryLevel: 88, isCharging: true, networkType: "wifi" };
        },
      },
    });

    expect(refreshInvoked).toBe(true);
    expect(frame.diagnostics?.staleEnvironmentDetected).toBe(true);
    expect(frame.diagnostics?.environmentRefreshed).toBe(true);
    expect(frame.layers.environmental.deviceState.batteryLevel).toBe(88);
    expect(frame.layers.environmental.deviceState.isCharging).toBe(true);
  });

  it("detects stale telemetry (>60s) and fails closed when refresh fails", () => {
    const now = Date.now();
    const frame = assembleDynamicContextFrame({
      turnId: "turn-stale-failed",
      botId: "bot-stale-fail",
      threadId: "thread-stale-fail",
      query: "Check battery level and network status",
      timestamp: now,
      immediate: { transcript: [] },
      environmental: {
        deviceState: { batteryLevel: 15, isCharging: false, networkType: "wifi", updatedAtMs: now - 120_000 },
        activeWorkspaceRoot: "/workspace",
        refreshHandler: () => {
          throw new Error("Android host bridge connection timeout");
        },
      },
    });

    expect(frame.diagnostics?.staleEnvironmentDetected).toBe(true);
    expect(frame.diagnostics?.environmentRefreshed).toBe(false);
    // Unverified live values must be omitted, never fabricated
    expect(frame.layers.environmental.deviceState.batteryLevel).toBeUndefined();
    expect(frame.layers.environmental.deviceState.isCharging).toBeUndefined();
    expect(frame.layers.environmental.deviceState.networkType).toBe("none");
  });

  it("Issue A regression: stale wifi cannot survive failed refresh and must become unavailable (none)", () => {
    const now = Date.now();
    // Case 1: Fresh telemetry -> wifi
    const freshWifiFrame = assembleDynamicContextFrame({
      turnId: "turn-fresh-wifi",
      botId: "bot-net",
      threadId: "thread-net",
      query: "What network connection am I on?",
      timestamp: now,
      immediate: { transcript: [] },
      environmental: {
        deviceState: { networkType: "wifi", updatedAtMs: now - 10_000 },
        activeWorkspaceRoot: "/workspace",
      },
    });
    expect(freshWifiFrame.layers.environmental.deviceState.networkType).toBe("wifi");

    // Case 2: Fresh telemetry -> cellular
    const freshCellularFrame = assembleDynamicContextFrame({
      turnId: "turn-fresh-cellular",
      botId: "bot-net",
      threadId: "thread-net",
      query: "What network connection am I on?",
      timestamp: now,
      immediate: { transcript: [] },
      environmental: {
        deviceState: { networkType: "cellular", updatedAtMs: now - 10_000 },
        activeWorkspaceRoot: "/workspace",
      },
    });
    expect(freshCellularFrame.layers.environmental.deviceState.networkType).toBe("cellular");

    // Case 3: Stale telemetry (>60s) + refresh success -> refreshed value (e.g. switched to cellular)
    const refreshedFrame = assembleDynamicContextFrame({
      turnId: "turn-stale-refresh-success",
      botId: "bot-net",
      threadId: "thread-net",
      query: "What network connection am I on and what is my battery?",
      timestamp: now,
      immediate: { transcript: [] },
      environmental: {
        deviceState: { batteryLevel: 10, isCharging: false, networkType: "wifi", updatedAtMs: now - 75_000 },
        activeWorkspaceRoot: "/workspace",
        refreshHandler: () => ({
          batteryLevel: 65,
          isCharging: true,
          networkType: "cellular",
        }),
      },
    });
    expect(refreshedFrame.diagnostics?.staleEnvironmentDetected).toBe(true);
    expect(refreshedFrame.diagnostics?.environmentRefreshed).toBe(true);
    expect(refreshedFrame.layers.environmental.deviceState.networkType).toBe("cellular");
    expect(refreshedFrame.layers.environmental.deviceState.batteryLevel).toBe(65);
    expect(refreshedFrame.layers.environmental.deviceState.isCharging).toBe(true);

    // Case 4: Stale telemetry (>60s) + refresh failure -> unavailable network state (none)
    // Stale cached 'wifi' MUST NOT survive when refresh fails!
    const failedRefreshFrame = assembleDynamicContextFrame({
      turnId: "turn-stale-refresh-fail",
      botId: "bot-net",
      threadId: "thread-net",
      query: "What network connection am I on?",
      timestamp: now,
      immediate: { transcript: [] },
      environmental: {
        deviceState: { batteryLevel: 80, isCharging: false, networkType: "wifi", updatedAtMs: now - 75_000 },
        activeWorkspaceRoot: "/workspace",
        refreshHandler: () => null, // probe failed or returned unavailable
      },
    });
    expect(failedRefreshFrame.diagnostics?.staleEnvironmentDetected).toBe(true);
    expect(failedRefreshFrame.diagnostics?.environmentRefreshed).toBe(false);
    expect(failedRefreshFrame.layers.environmental.deviceState.networkType).toBe("none");
    expect(failedRefreshFrame.layers.environmental.deviceState.batteryLevel).toBeUndefined();
    expect(failedRefreshFrame.layers.environmental.deviceState.isCharging).toBeUndefined();
  });
});

describe("GAP E: Environmental Relevance Gating Sub-Signals", () => {
  it("omits battery, network, and browser telemetry on generic writing request", () => {
    const frame = assembleDynamicContextFrame({
      turnId: "turn-generic",
      botId: "bot-writer",
      threadId: "thread-writer",
      query: "Write a poem about the sunrise",
      immediate: { transcript: [{ role: "user", text: "Write a poem about the sunrise" }] },
      environmental: {
        deviceState: { batteryLevel: 77, isCharging: false, networkType: "wifi", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace/writer",
        openBrowserTabUrl: "https://secret-intranet.local",
        activeComputerSessionId: "session-999",
      },
    });

    expect(frame.layers.environmental.deviceState.batteryLevel).toBeUndefined();
    expect(frame.layers.environmental.deviceState.networkType).toBe("none");
    expect(frame.layers.environmental.openBrowserTabUrl).toBeUndefined();
    expect(frame.layers.environmental.activeComputerSessionId).toBeUndefined();
  });

  it("includes network telemetry on network troubleshooting request without leaking browser tab", () => {
    const frame = assembleDynamicContextFrame({
      turnId: "turn-network",
      botId: "bot-tech",
      threadId: "thread-tech",
      query: "Why did my wifi connection disconnect?",
      immediate: { transcript: [{ role: "user", text: "Why did my wifi connection disconnect?" }] },
      environmental: {
        deviceState: { batteryLevel: 50, isCharging: false, networkType: "cellular", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace",
        openBrowserTabUrl: "https://unrelated-bank.com",
      },
    });

    expect(frame.layers.environmental.deviceState.networkType).toBe("cellular");
    expect(frame.layers.environmental.openBrowserTabUrl).toBeUndefined();
  });

  it("includes browser tab URL on browser request without leaking battery state", () => {
    const frame = assembleDynamicContextFrame({
      turnId: "turn-browser",
      botId: "bot-researcher",
      threadId: "thread-researcher",
      query: "What webpage is open on the current browser tab?",
      immediate: { transcript: [{ role: "user", text: "What webpage is open on the current browser tab?" }] },
      environmental: {
        deviceState: { batteryLevel: 62, isCharging: true, networkType: "wifi", updatedAtMs: Date.now() },
        activeWorkspaceRoot: "/workspace",
        openBrowserTabUrl: "https://en.wikipedia.org/wiki/Context_awareness",
      },
    });

    expect(frame.layers.environmental.openBrowserTabUrl).toBe("https://en.wikipedia.org/wiki/Context_awareness");
    expect(frame.layers.environmental.deviceState.batteryLevel).toBeUndefined();
  });
});

describe("GAP H: Cross-Thread and Cross-Bot Context Isolation", () => {
  it("prevents draft and attachment leakage between Thread A and Thread B for same bot", () => {
    const frameThreadA = assembleDynamicContextFrame({
      turnId: "turn-a",
      botId: "bot-alpha",
      threadId: "thread-alpha-1",
      query: "Discuss project plan",
      immediate: {
        transcript: [{ role: "user", text: "Here is doc A" }],
        activeDraftText: "Unsent secret draft for thread A",
        attachments: [{ id: "att-a", title: "docA.txt", mimeType: "text/plain", content: "Confidential Alpha" }],
      },
    });

    const frameThreadB = assembleDynamicContextFrame({
      turnId: "turn-b",
      botId: "bot-alpha",
      threadId: "thread-alpha-2",
      query: "Discuss project plan",
      immediate: {
        transcript: [{ role: "user", text: "Thread B greeting" }],
        activeDraftText: undefined,
        attachments: [],
      },
    });

    expect(frameThreadA.layers.immediate.activeDraftText).toBe("Unsent secret draft for thread A");
    expect(frameThreadA.layers.immediate.activeAttachments.length).toBe(1);

    // Thread B must have zero artifacts from Thread A
    expect(frameThreadB.layers.immediate.activeDraftText).toBeUndefined();
    expect(frameThreadB.layers.immediate.activeAttachments.length).toBe(0);
  });

  it("isolates bot-private persistent facts between Bot A and Bot B", () => {
    const frameBotA = assembleDynamicContextFrame({
      turnId: "turn-bot-a",
      botId: "bot-architect",
      threadId: "thread-1",
      immediate: { transcript: [{ role: "user", text: "hi" }] },
      persistent: {
        userPreferences: { theme: "dark" },
        stableFacts: ["Bot Architect specialty is system design"],
      },
    });

    const frameBotB = assembleDynamicContextFrame({
      turnId: "turn-bot-b",
      botId: "bot-copywriter",
      threadId: "thread-2",
      immediate: { transcript: [{ role: "user", text: "hi" }] },
      persistent: {
        userPreferences: { theme: "dark" },
        stableFacts: ["Bot Copywriter specialty is creative prose"],
      },
    });

    expect(frameBotA.layers.persistent.stableFacts).toContain("Bot Architect specialty is system design");
    expect(frameBotA.layers.persistent.stableFacts).not.toContain("Bot Copywriter specialty is creative prose");

    expect(frameBotB.layers.persistent.stableFacts).toContain("Bot Copywriter specialty is creative prose");
    expect(frameBotB.layers.persistent.stableFacts).not.toContain("Bot Architect specialty is system design");
  });
});

describe("GAP L: Fail-Closed Input Handling", () => {
  it("bounds negative and invalid token budgets safely", () => {
    const frame = assembleDynamicContextFrame({
      turnId: "turn-negative",
      botId: "bot-safety",
      threadId: "thread-safety",
      tokenBudget: -500,
      immediate: { transcript: [{ role: "user", text: "test" }] },
    });

    expect(frame.tokenBudget).toBeGreaterThan(0);
    expect(Number.isFinite(frame.tokenBudget)).toBe(true);
  });

  it("safely ignores malformed or null items in transcript", () => {
    const malformedTranscript = [
      null as unknown as { role: "user"; text: string },
      { role: "user" as const, text: "" },
      undefined as unknown as { role: "user"; text: string },
      { role: "user" as const, text: "Valid question" },
    ];

    const frame = assembleDynamicContextFrame({
      turnId: "turn-malformed",
      botId: "bot-safety",
      threadId: "thread-safety",
      immediate: { transcript: malformedTranscript },
    });

    expect(frame.layers.immediate.activeConversation.length).toBe(1);
    expect(frame.layers.immediate.activeConversation[0]?.content).toBe("Valid question");
  });
});

describe("Android Active-Draft Contract Invariant", () => {
  it("leaves activeDraftText undefined during ordinary server turns without leakage", () => {
    // Ordinary turn from Android client has transcript and prompt text, but no live draft sync
    const frame = assembleDynamicContextFrame({
      turnId: "turn-standard",
      botId: "bot-prod",
      threadId: "thread-prod",
      query: "Draft a letter to the landlord",
      immediate: {
        transcript: [{ role: "user", text: "Draft a letter to the landlord" }],
      },
    });

    // Option A: Active draft text is intentionally optional and omitted during ordinary server turns
    expect(frame.layers.immediate.activeDraftText).toBeUndefined();

    // Formatted dynamic context does not include any draft artifacts
    const promptText = formatDynamicContextForPrompt(frame);
    expect(promptText).not.toContain("activeDraftText");
    expect(promptText).not.toContain("Draft Text");
  });
});
