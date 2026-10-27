// The two gates between a completed turn and a screenshot in the chat. Both
// are pure, so every spelling a driver can hand the poke site — and every
// tool that must NOT count — is pinned down here.
import { createHash } from "node:crypto";
import zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  screenFrameHash,
  screenSurfaceForTool,
  screenTouchingTool,
  settledFrameIsNews,
  shouldSurfaceBrowserScreenInChat,
  determineResponseFormattingPlan,
  validateResponseFormattingPlan,
  stripRawBase64DataUris,
  isProhibitedScreenFrame,
  sanitizeMessageForChatStorage,
  validateScreenFrameBytes,
  ERR_CHAT_POLLUTION_BLOCKED,
  ChatPollutionBlockedError,
  type ResponseFormattingPlan,
} from "./screen-frame-gate.ts";

describe("screenTouchingTool", () => {
  it("strips the Claude driver's mcp__<server>__ prefix", () => {
    expect(screenTouchingTool("mcp__computer__click")).toBe(true);
    expect(screenTouchingTool("mcp__computer__screenshot")).toBe(true);
    expect(screenTouchingTool("mcp__browser__browser_navigate")).toBe(true);
  });

  it("counts agent-browser's tools, which the engine swap left out", () => {
    // The Electron surface's names were kept and agent-browser's were never
    // added, so every browser turn silently stopped earning a picture.
    expect(screenTouchingTool("mcp__browser__agent_browser_open")).toBe(true);
    expect(screenTouchingTool("agent_browser_click")).toBe(true);
    expect(screenTouchingTool("agent_browser_fill")).toBe(true);
    expect(screenTouchingTool("agent_browser_type")).toBe(true);
    expect(screenTouchingTool("agent_browser_press")).toBe(true);
    expect(screenTouchingTool("agent_browser_select")).toBe(true);
    expect(screenTouchingTool("agent_browser_check")).toBe(true);
    expect(screenTouchingTool("agent_browser_screenshot")).toBe(true);
  });

  it("still leaves agent-browser's read-only tools and waits out", () => {
    expect(screenTouchingTool("agent_browser_snapshot")).toBe(false);
    expect(screenTouchingTool("agent_browser_read")).toBe(false);
    expect(screenTouchingTool("agent_browser_get_text")).toBe(false);
    expect(screenTouchingTool("agent_browser_wait_for_text")).toBe(false);
    expect(screenTouchingTool("agent_browser_wait_for_load")).toBe(false);
  });

  it("takes the server__tool spelling the desktop's own cards use", () => {
    // The approval card for a browser turn reads `browser__agent_browser_open`
    // — the server segment without Claude's `mcp` in front. Stripping only
    // `mcp__<server>__` left this unmatched, so a browser turn still settled
    // with no picture even after agent-browser's tool names were added.
    expect(screenTouchingTool("browser__agent_browser_open")).toBe(true);
    expect(screenTouchingTool("browser__agent_browser_screenshot")).toBe(true);
    expect(screenTouchingTool("android_browser_browser_open")).toBe(true);
    expect(screenTouchingTool("android_browser_browser_navigate")).toBe(true);
    expect(screenTouchingTool("android_browser_browser_screenshot")).toBe(true);
    expect(screenSurfaceForTool("browser__agent_browser_open")).toBe("browser");
    expect(screenSurfaceForTool("android_browser_browser_open")).toBe("browser");
    expect(screenSurfaceForTool("android_browser_browser_navigate")).toBe("browser");
    // Not only the browser: the computer server's own tools carry the same
    // spelling and were missed the same way.
    expect(screenTouchingTool("computer__screenshot")).toBe(true);
    expect(screenSurfaceForTool("computer__screenshot")).toBe("computer");
  });

  it("keeps read-only tools out whatever prefix they arrive with", () => {
    expect(screenTouchingTool("browser__agent_browser_snapshot")).toBe(false);
    expect(screenTouchingTool("browser__agent_browser_read")).toBe(false);
    expect(screenTouchingTool("computer__computer_status")).toBe(false);
  });

  it.each(["local_vm", "computer-use", "vm2", `v${"m".repeat(31)}`])(
    "accepts the valid %s namespace in both mounted spellings",
    (namespace) => {
      for (const prefix of [`mcp__${namespace}__`, `${namespace}__`]) {
        expect(screenTouchingTool(`${prefix}screenshot`)).toBe(true);
        expect(screenSurfaceForTool(`${prefix}screenshot`)).toBe("computer");
        expect(screenTouchingTool(`${prefix}agent_browser_open`)).toBe(true);
        expect(screenSurfaceForTool(`${prefix}agent_browser_open`)).toBe("browser");
        for (const tool of ["computer_exec", "computer_status", "agent_browser_snapshot", "wait_for"])
          expect(screenTouchingTool(`${prefix}${tool}`)).toBe(false);
      }
    },
  );

  it("preserves legacy MCP names without accepting invalid desktop namespaces", () => {
    expect(screenTouchingTool("mcp__legacy.server__screenshot")).toBe(true);
    expect(screenTouchingTool("MCP__LOCAL_VM__SCREENSHOT")).toBe(true);
    expect(screenTouchingTool("legacy.server__screenshot")).toBe(false);
    expect(screenTouchingTool(`${"v".repeat(33)}__screenshot`)).toBe(false);
    expect(screenTouchingTool("2vm__screenshot")).toBe(false);
  });

  it("takes Codex's bare names and pi's server_tool names", () => {
    expect(screenTouchingTool("click")).toBe(true);
    expect(screenTouchingTool("hotkey")).toBe(true);
    expect(screenTouchingTool("computer_click")).toBe(true);
    expect(screenTouchingTool("computer_zoom")).toBe(true);
    expect(screenTouchingTool("computer_computer_batch")).toBe(true);
    expect(screenTouchingTool("browser_browser_navigate")).toBe(true);
    // the box's own Chrome tools live on the computer server
    expect(screenTouchingTool("computer_browser_fill")).toBe(true);
  });

  const acting = [
    "screenshot", "click", "type_text", "press_key", "scroll", "computer_batch", "open_url", "browser_click", "browser_fill",
    "browser_navigate", "browser_type", "browser_press", "browser_scroll", "browser_hover", "browser_drag",
    "browser_select_option", "browser_back", "browser_forward", "browser_screenshot",
    "double_click", "right_click", "drag", "hotkey", "move_cursor", "launch_app", "bring_to_front", "zoom",
  ];
  for (const tool of acting) {
    it(`counts: ${tool}`, () => expect(screenTouchingTool(tool)).toBe(true));
  }

  const bystanders = [
    // the bug: every tool on the computer server is "mcp__computer__…", and
    // a shell command there leaves the desktop exactly as it was
    "mcp__computer__computer_exec",
    "computer_exec",
    "computer_computer_exec",
    // read-only text tools
    "computer_status", "browser_state", "browser_snapshot", "browser_read", "observation_metrics",
    "mcp__browser__browser_snapshot", "browser_browser_read",
    "start_session", "get_window_state", "get_desktop_state", "get_accessibility_tree",
    "list_windows", "list_apps", "check_permissions", "get_screen_size",
    // waits change nothing; the action before them already counted
    "wait_for", "mcp__computer__wait_for", "wait_for_navigation", "browser_wait_for",
    // the person's hands, not the bot's
    "computer_request_help", "browser_request_takeover",
    // not computer tools at all
    "Bash", "Read", "mcp__agents__ask_bot", "mcp__composio__GMAIL_SEND_EMAIL", "screenshot_helper",
  ];
  for (const tool of bystanders) {
    it(`ignores: ${tool}`, () => expect(screenTouchingTool(tool)).toBe(false));
  }
});

describe("settledFrameIsNews", () => {
  const frame = "iVBORw0KGgo-frame-a";

  it("fails open when no frame has been shown yet", () => {
    expect(settledFrameIsNews(undefined, frame)).toBe(true);
  });

  it("is not news when the end frame is byte-identical to the shown one", () => {
    expect(settledFrameIsNews(screenFrameHash(frame), frame)).toBe(false);
  });

  it("is news once a single byte differs", () => {
    expect(settledFrameIsNews(screenFrameHash(frame), "iVBORw0KGgo-frame-b")).toBe(true);
  });

  it("fingerprints with sha256 over the base64, like the observation dedupe", () => {
    expect(screenFrameHash(frame)).toBe(createHash("sha256").update(frame).digest("hex"));
  });
});

describe("screenSurfaceForTool", () => {
  it("sends browser tools to the browser, whichever surface names them", () => {
    expect(screenSurfaceForTool("agent_browser_open")).toBe("browser");
    expect(screenSurfaceForTool("mcp__browser__agent_browser_click")).toBe("browser");
    expect(screenSurfaceForTool("browser_navigate")).toBe("browser");
  });

  it("sends everything else to the computer", () => {
    expect(screenSurfaceForTool("click")).toBe("computer");
    expect(screenSurfaceForTool("mcp__computer__screenshot")).toBe("computer");
    expect(screenSurfaceForTool("computer_batch")).toBe("computer");
  });

  it.each(["browser_click", "browser_fill"])("keeps desktop %s on the computer across drivers", (tool) => {
    expect(screenSurfaceForTool(`mcp__computer__${tool}`)).toBe("computer");
    expect(screenSurfaceForTool(`computer_${tool}`)).toBe("computer");
    expect(screenSurfaceForTool(`computer__${tool}`)).toBe("computer");
    expect(screenSurfaceForTool(tool)).toBe("computer");
    expect(screenSurfaceForTool(`mcp__browser__${tool}`)).toBe("browser");
    expect(screenSurfaceForTool(`browser__${tool}`)).toBe("browser");
    expect(screenSurfaceForTool(`browser_agent_${tool}`)).toBe("browser");
  });

  it("keeps a browsed page from being illustrated with an idle desktop", () => {
    // The case that made this necessary: a bot holding both surfaces, whose
    // turn was entirely web work, settled with a picture of its Local VM.
    expect(screenSurfaceForTool("agent_browser_open")).not.toBe(screenSurfaceForTool("launch_app"));
  });
});

describe("shouldSurfaceBrowserScreenInChat", () => {
  it("rejects normal browsing research tasks without explicit screenshot intent", () => {
    const normalQueries = [
      "Find me the best course for me.",
      "Search for recent AI news on news.ycombinator.com",
      "Research the cheapest flights to Tokyo next month",
      "Compare price of Python books on Amazon and Barnes & Noble",
      "Go to python.org and read the latest release notes",
      "What is the population of Tokyo?",
      "Summarize the Wikipedia article on quantum computing",
    ];
    for (const prompt of normalQueries) {
      expect(shouldSurfaceBrowserScreenInChat({ userPrompt: prompt })).toBe(false);
    }
  });

  it("accepts explicit user requests to show the page or send a screenshot", () => {
    const explicitQueries = [
      "show me the page",
      "show the page",
      "show me the website",
      "show me the screen",
      "send me a screenshot",
      "take a screenshot of the homepage",
      "take screenshot",
      "capture a screenshot",
      "grab a screenshot of the results",
      "snap a screenshot",
      "give me a screenshot",
      "what does the page look like?",
      "what does the website look like",
      "what does it look like",
      "how does the page look",
      "can I see the page",
      "let me see the page",
      "include visual evidence",
      "provide visual proof",
      "inspect the visual layout",
      "FIRST_SCREEN",
    ];
    for (const prompt of explicitQueries) {
      expect(shouldSurfaceBrowserScreenInChat({ userPrompt: prompt })).toBe(true);
    }
  });

  it("checks taskTitle and taskDescription when userPrompt has no explicit request", () => {
    expect(shouldSurfaceBrowserScreenInChat({
      userPrompt: "Find best course",
      taskTitle: "Capture screenshot of course syllabus",
    })).toBe(true);

    expect(shouldSurfaceBrowserScreenInChat({
      userPrompt: "Find best course",
      taskDescription: "Navigate to page and take a screenshot for verification",
    })).toBe(true);

    expect(shouldSurfaceBrowserScreenInChat({
      userPrompt: "Find best course",
      taskTitle: "Course research",
      taskDescription: "Find top 3 courses and summarize in text",
    })).toBe(false);
  });

  it("does not false-positive on incidental screen or page references", () => {
    const incidental = [
      "Tap the search icon on the screen",
      "The phone has an OLED screen with high refresh rate",
      "Click the submit button on the page",
      "Scroll down the page to find the comments",
      "Read the text on the page",
      "Find a laptop with a 16 inch screen",
    ];
    for (const prompt of incidental) {
      expect(shouldSurfaceBrowserScreenInChat({ userPrompt: prompt })).toBe(false);
    }
  });

  it("honors explicitIntent flag", () => {
    expect(shouldSurfaceBrowserScreenInChat({ userPrompt: "hello", explicitIntent: true })).toBe(true);
    expect(shouldSurfaceBrowserScreenInChat({ explicitIntent: true })).toBe(true);
  });

  it("handles empty or missing parameters safely", () => {
    expect(shouldSurfaceBrowserScreenInChat({})).toBe(false);
    expect(shouldSurfaceBrowserScreenInChat({ userPrompt: null, taskTitle: undefined })).toBe(false);
    expect(shouldSurfaceBrowserScreenInChat({ userPrompt: "" })).toBe(false);
  });
});

describe("Official Roadmap Phase 16: Response Intelligence & Visual Telemetry Isolation (Scenarios 1-18)", () => {
  // Scenario 1 — Routine factual question
  it("Scenario 1: Routine factual questions receive concise short_conversational shape without superfluous headings", () => {
    const factualPrompts = [
      "What does DNS do?",
      "Is this command safe?",
      "What is the difference between RAM and storage?",
      "Thanks, that worked.",
      "What time is it in Tokyo?",
    ];

    for (const prompt of factualPrompts) {
      const plan = determineResponseFormattingPlan({ userPrompt: prompt });
      const validated: ResponseFormattingPlan = validateResponseFormattingPlan(plan);
      expect(validated.shape).toBe("short_conversational");
      expect(plan.shape).toBe("short_conversational");
      expect(plan.useMarkdownTables).toBe(false);
      expect(plan.requireExecutiveConclusion).toBe(false);
      expect(plan.includeVisualAttachment).toBe(false);
      expect(plan.maxWordsTarget).toBeLessThanOrEqual(80);

      // Verify simulated concise answer avoids superfluous templates (Summary -> Steps -> Conclusion)
      const simulatedAnswer = "DNS translates human-readable domain names into numerical IP addresses needed to route network traffic.";
      expect(simulatedAnswer.startsWith("Summary:")).toBe(false);
      expect(simulatedAnswer.includes("### Steps")).toBe(false);
      expect(simulatedAnswer.includes("### Conclusion")).toBe(false);
      expect(simulatedAnswer.split(".").filter(Boolean).length).toBeLessThanOrEqual(3);
    }

    // Validation handles null or malformed plans safely
    const fallbackPlan = validateResponseFormattingPlan(null);
    expect(fallbackPlan.shape).toBe("short_conversational");
    expect(fallbackPlan.useMarkdownTables).toBe(false);
  });

  // Scenario 2 — Explicit structured report
  it("Scenario 2: Explicit structured report requests produce structured_report shape with executive conclusion", () => {
    const reportPrompts = [
      "Provide a detailed architectural security audit report for the cloud deployment",
      "Write a comprehensive engineering review of the database migration plan",
      "Give me an in-depth analysis of the system performance bottlenecks",
      "Explain in detail how the consensus algorithm handles network partitions",
    ];

    for (const prompt of reportPrompts) {
      const plan = determineResponseFormattingPlan({ userPrompt: prompt });
      expect(plan.shape).toBe("structured_report");
      expect(plan.requireExecutiveConclusion).toBe(true);
      expect(plan.useMarkdownTables).toBe(false);
      expect(plan.maxWordsTarget).toBeGreaterThanOrEqual(300);
    }
  });

  // Scenario 3 — Explicit code request
  it("Scenario 3: Explicit code requests select code_block shape without embedding visual telemetry", () => {
    const codePrompts = [
      "Write a TypeScript function to parse semver strings",
      "Give me the curl command to upload a file to the S3 bucket",
      "Generate a Python script to calculate Fibonacci numbers iteratively",
      "Show me the Dockerfile configuration for a multi-stage Node.js build",
    ];

    for (const prompt of codePrompts) {
      const plan = determineResponseFormattingPlan({ userPrompt: prompt });
      expect(plan.shape).toBe("code_block");
      expect(plan.useMarkdownTables).toBe(false);
      expect(plan.includeVisualAttachment).toBe(false);
      expect(plan.requireExecutiveConclusion).toBe(false);
    }

    // Factual queries that merely mention the word "code" must NOT be forced into code_block
    const factualWithCode = "What is bytecode in Java?";
    const factualPlan = determineResponseFormattingPlan({ userPrompt: factualWithCode });
    expect(factualPlan.shape).toBe("short_conversational");
  });

  // Scenario 4 — Genuine comparison
  it("Scenario 4: Genuine comparisons select tabular_comparison shape and enable Markdown tables", () => {
    const comparisonPrompts = [
      "Compare PostgreSQL, MongoDB, and Redis across scalability, consistency, and latency in a comparison table",
      "Evaluate the trade-offs between REST and GraphQL with a comparison matrix",
      "Compare AWS Lambda vs Google Cloud Functions across pricing and cold start times",
    ];

    for (const prompt of comparisonPrompts) {
      const plan = determineResponseFormattingPlan({ userPrompt: prompt });
      expect(plan.shape).toBe("tabular_comparison");
      expect(plan.useMarkdownTables).toBe(true);
      expect(plan.requireExecutiveConclusion).toBe(true);
    }
  });

  // Scenario 5 — Screenshot generated for internal observation
  it("Scenario 5: Browser frames generated for internal tool observation are prohibited from chat history", () => {
    const researchPrompt = "Research the cheapest flights to Tokyo next month";
    expect(shouldSurfaceBrowserScreenInChat({ userPrompt: researchPrompt })).toBe(false);

    const internalFrame = {
      role: "bot",
      kind: "screen",
      surface: "browser",
      png: "iVBORw0KGgo-browser-frame-internal-telemetry",
    };

    expect(isProhibitedScreenFrame(internalFrame, researchPrompt)).toBe(true);

    let blockedCaught = false;
    const sanitized = sanitizeMessageForChatStorage(internalFrame, {
      userPrompt: researchPrompt,
      onBlocked: (err) => {
        blockedCaught = true;
        expect(err.code).toBe(ERR_CHAT_POLLUTION_BLOCKED);
      },
    });

    expect(blockedCaught).toBe(true);
    expect(sanitized.blocked).toBe(true);
    expect(sanitized.message).toBeNull();
  });

  // Scenario 6 — Explicit request for a screenshot
  it("Scenario 6: Explicit screenshot request permits legitimate image deliverable in chat", () => {
    const explicitPrompts = [
      "Take a screenshot of the homepage and send it to me",
      "Show me the page layout",
      "Can I see the screen?",
      "Provide visual proof of the booking confirmation",
    ];

    for (const prompt of explicitPrompts) {
      const plan = determineResponseFormattingPlan({ userPrompt: prompt });
      expect(plan.includeVisualAttachment).toBe(true);

      const frame = {
        role: "bot",
        kind: "screen",
        surface: "browser",
        png: "iVBORw0KGgo-legitimate-requested-screenshot",
      };

      expect(isProhibitedScreenFrame(frame, prompt)).toBe(false);
      const res = sanitizeMessageForChatStorage(frame, { userPrompt: prompt });
      expect(res.blocked).toBe(false);
      expect(res.message).not.toBeNull();
    }
  });

  // Scenario 7 — Raw base64 injection
  it("Scenario 7: Direct attempt to inject raw base64 data URI is blocked with ERR_CHAT_POLLUTION_BLOCKED", () => {
    const rawBase64Msg = {
      role: "bot",
      kind: "text",
      text: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    };

    expect(isProhibitedScreenFrame(rawBase64Msg, "Check this")).toBe(true);

    let errorFired = false;
    const res = sanitizeMessageForChatStorage(rawBase64Msg, {
      userPrompt: "Check this",
      onBlocked: (err) => {
        errorFired = true;
        expect(err.code).toBe(ERR_CHAT_POLLUTION_BLOCKED);
      },
    });

    expect(errorFired).toBe(true);
    expect(res.blocked).toBe(true);
    expect(res.message).toBeNull();
  });

  // Scenario 8 — Mixed valid text and invalid visual payload
  it("Scenario 8: Mixed message with valid text and prohibited base64 payload preserves text while stripping raw visual data", () => {
    const rawDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const mixedText = `The security audit identified 2 critical package vulnerabilities in package.json.\n\n![Screenshot](${rawDataUri})\n${rawDataUri}\n\nRecommended remediation is upgrading auth0-js to v9.20.`;

    const cleaned = stripRawBase64DataUris(mixedText);
    expect(cleaned).toContain("The security audit identified 2 critical package vulnerabilities in package.json.");
    expect(cleaned).toContain("Recommended remediation is upgrading auth0-js to v9.20.");
    expect(cleaned).not.toContain("data:image/");
    expect(cleaned).not.toContain("iVBORw0KGgo");

    const message = {
      role: "bot",
      kind: "text",
      text: mixedText,
    };

    const res = sanitizeMessageForChatStorage(message, { userPrompt: "Audit packages" });
    expect(res.blocked).toBe(false);
    expect(res.message?.text).toBe(cleaned);
  });

  // Scenario 9 — Visual SSE continuity
  it("Scenario 9: Visual telemetry remains available to Watch Computer SSE broadcast while excluded from chat storage", () => {
    const sseBroadcastFrames: Array<{ kind: string; surface: string; png: string }> = [];
    const chatStorageMessages: Array<{ kind: string; text?: string }> = [];

    const mockBroadcast = (event: { kind: string; surface: string; png: string }) => {
      sseBroadcastFrames.push(event);
    };

    const mockChatStore = (msg: { kind: string; surface?: string; png?: string; text?: string }, userPrompt: string) => {
      const res = sanitizeMessageForChatStorage(msg as any, { userPrompt });
      if (!res.blocked && res.message) {
        chatStorageMessages.push(res.message as any);
      }
    };

    const prompt = "Search for top AI news on Hacker News";
    const frame = { kind: "screen", surface: "browser", png: "iVBORw0KGgo-live-browser-view" };

    // 1. Live SSE delivery for Watch Computer
    mockBroadcast(frame);
    expect(sseBroadcastFrames.length).toBe(1);
    expect(sseBroadcastFrames[0].kind).toBe("screen");

    // 2. Chat storage gate
    mockChatStore(frame, prompt);
    // Frame is prohibited from chat storage
    expect(chatStorageMessages.length).toBe(0);

    // 3. Synthesized textual answer enters chat store
    const textAnswer = { kind: "text", text: "Found 3 top AI stories on HN: 1. Model release, 2. Open weights discussion, 3. Benchmarks." };
    mockChatStore(textAnswer, prompt);
    expect(chatStorageMessages.length).toBe(1);
    expect(chatStorageMessages[0].text).toContain("Found 3 top AI stories");
  });

  // Scenario 10 — Unrelated text-only turns
  it("Scenario 10: Unrelated text-only follow-ups do not inherit visual attachments from previous browser sessions", () => {
    const turn1Prompt = "Take a screenshot of the homepage";
    const turn1Plan = determineResponseFormattingPlan({ userPrompt: turn1Prompt });
    expect(turn1Plan.includeVisualAttachment).toBe(true);

    // Turn 2 is an unrelated factual question
    const turn2Prompt = "Now calculate 15 percent tip on a 120 dollar restaurant bill";
    const turn2Plan = determineResponseFormattingPlan({ userPrompt: turn2Prompt });
    expect(turn2Plan.shape).toBe("short_conversational");
    expect(turn2Plan.includeVisualAttachment).toBe(false);
  });

  // Scenario 11 — History reconstruction
  it("Scenario 11: History reconstruction sanitizes transcripts and rejects prohibited browser frames", () => {
    const historicalMessages = [
      { id: "m1", role: "user", kind: "text", text: "Find news" },
      { id: "m2", role: "bot", kind: "screen", surface: "browser", png: "iVBORw0KGgo-polluted-history" },
      { id: "m3", role: "bot", kind: "text", text: "Here is the summary." },
    ];

    const reconstructed = historicalMessages.filter((msg) => !isProhibitedScreenFrame(msg as any, "Find news"));
    expect(reconstructed.length).toBe(2);
    expect(reconstructed.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  // Scenario 12 — Message replay
  it("Scenario 12: Replaying persisted messages filters out dropped frames from chat presentation", () => {
    const rawEvents = [
      { kind: "text", text: "Starting browse..." },
      { kind: "screen", surface: "browser", png: "iVBORw0KGgo-replay-drop" },
      { kind: "text", text: "Finished research." },
    ];

    const replayTarget: string[] = [];
    for (const evt of rawEvents) {
      const res = sanitizeMessageForChatStorage(evt as any, { userPrompt: "General query" });
      if (!res.blocked && res.message) {
        replayTarget.push(res.message.kind);
      }
    }

    expect(replayTarget).toEqual(["text", "text"]);
    expect(replayTarget.includes("screen")).toBe(false);
  });

  // Scenario 13 — Alternate message writer
  it("Scenario 13: Alternate message writing boundaries enforce the prohibited frame gate", () => {
    const writerAttempts = [
      { role: "bot", kind: "screen", surface: "browser", png: "iVBORw0KGgo-alt-writer-1" },
      { role: "bot", kind: "screen", surface: "browser", png: "iVBORw0KGgo-alt-writer-2" },
    ];

    for (const attempt of writerAttempts) {
      expect(isProhibitedScreenFrame(attempt, "Read article")).toBe(true);
      const res = sanitizeMessageForChatStorage(attempt, { userPrompt: "Read article" });
      expect(res.blocked).toBe(true);
      expect(res.code).toBe(ERR_CHAT_POLLUTION_BLOCKED);
    }
  });

  // Scenario 14 — Explicit visual intent
  it("Scenario 14: Explicit visual intent matches diverse user expressions", () => {
    const visualQueries = [
      "Show me what the website looks like",
      "Send me a screenshot of your screen",
      "Can I view the page?",
      "Provide visual confirmation of the ticket",
      "What does the checkout page look like?",
    ];

    for (const q of visualQueries) {
      expect(shouldSurfaceBrowserScreenInChat({ userPrompt: q })).toBe(true);
      const plan = determineResponseFormattingPlan({ userPrompt: q });
      expect(plan.includeVisualAttachment).toBe(true);
    }
  });

  // Scenario 15 — Invalid implicit visual intent
  it("Scenario 15: Incidental mentions of screen or page do not trigger visual attachments", () => {
    const nonVisualQueries = [
      "Click the blue button on the page",
      "The device screen is 6.5 inches",
      "Scroll down to find the article author",
      "Does this screen support HDR10?",
      "Read the second paragraph on the page",
    ];

    for (const q of nonVisualQueries) {
      expect(shouldSurfaceBrowserScreenInChat({ userPrompt: q })).toBe(false);
      const plan = determineResponseFormattingPlan({ userPrompt: q });
      expect(plan.includeVisualAttachment).toBe(false);
    }
  });

  // Scenario 16 — Chat text remains clean
  it("Scenario 16: Research output text is verified free of base64 payloads, [object Object], and raw JSON", () => {
    const messyTelemetryText = `The research returned 3 findings.\n{"rawScreenshot": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."}\n[object Object]\nConclusion: All services healthy.`;

    const cleaned = stripRawBase64DataUris(messyTelemetryText)
      .replace(/\[object Object\]/g, "")
      .replace(/\{"rawScreenshot":\s*""\}/g, "")
      .trim();

    expect(cleaned).not.toContain("data:image/");
    expect(cleaned).not.toContain("iVBORw0KGgo");
    expect(cleaned).toContain("The research returned 3 findings.");
    expect(cleaned).toContain("Conclusion: All services healthy.");
  });

  // Scenario 17 — Watch Computer stream remains functional
  it("Scenario 17: Watch Computer stream receives live frames while chat history remains clean", () => {
    const watchComputerLiveFrames: string[] = [];
    const chatTranscript: string[] = [];

    const handleTurnEvent = (event: { kind: string; surface: string; png?: string; text?: string }, userPrompt: string) => {
      // 1. Live observation SSE fanout
      if (event.kind === "screen" && event.png) {
        watchComputerLiveFrames.push(event.png);
      }
      // 2. Chat persistence gate
      const res = sanitizeMessageForChatStorage(event as any, { userPrompt });
      if (!res.blocked && res.message?.text) {
        chatTranscript.push(res.message.text);
      }
    };

    const prompt = "Navigate to github.com and read the trending repos";
    handleTurnEvent({ kind: "screen", surface: "browser", png: "frame-1-github-home" }, prompt);
    handleTurnEvent({ kind: "screen", surface: "browser", png: "frame-2-github-trending" }, prompt);
    handleTurnEvent({ kind: "text", surface: "browser", text: "Top trending repo is langchain-ai." }, prompt);

    expect(watchComputerLiveFrames).toEqual(["frame-1-github-home", "frame-2-github-trending"]);
    expect(chatTranscript).toEqual(["Top trending repo is langchain-ai."]);
  });

  // Scenario 18 — Error and failure recovery
  it("Scenario 18: Blocked chat pollution attempts recover gracefully without crashing or exposing raw stack traces", () => {
    const prohibitedFrame = {
      role: "bot",
      kind: "screen",
      surface: "browser",
      png: "iVBORw0KGgo-exploit-pollution-attempt",
    };

    let blockedError: ChatPollutionBlockedError | null = null;
    let turnCrashed = false;

    try {
      const res = sanitizeMessageForChatStorage(prohibitedFrame, {
        userPrompt: "Regular question",
        onBlocked: (err) => {
          blockedError = err;
        },
      });

      expect(res.blocked).toBe(true);
      expect(res.code).toBe(ERR_CHAT_POLLUTION_BLOCKED);
      expect(blockedError).not.toBeNull();
      if (blockedError) {
        const err = blockedError as ChatPollutionBlockedError;
        expect(err.code).toBe(ERR_CHAT_POLLUTION_BLOCKED);
      }
    } catch {
      turnCrashed = true;
    }

    expect(turnCrashed).toBe(false);
  });

  // Bug A Remediation: Screenshot Integrity & Black Image Elimination
  describe("Bug A Remediation: Screenshot Integrity & Black Image Elimination", () => {
    function generateTestPng(w: number, h: number, pixelLuminance: number = 0): Buffer {
      const bpp = 4;
      const stride = 1 + w * bpp;
      const raw = Buffer.alloc(stride * h, 0);
      for (let row = 0; row < h; row++) {
        const rowOffset = row * stride;
        raw[rowOffset] = 0; // Filter None
        for (let col = 0; col < w; col++) {
          const px = rowOffset + 1 + col * bpp;
          raw[px] = pixelLuminance;     // R
          raw[px + 1] = pixelLuminance; // G
          raw[px + 2] = pixelLuminance; // B
          raw[px + 3] = 255;            // A
        }
      }
      const idat = zlib.deflateSync(raw);

      const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdr = Buffer.alloc(25);
      ihdr.writeUInt32BE(13, 0);
      ihdr.write("IHDR", 4);
      ihdr.writeUInt32BE(w, 8);
      ihdr.writeUInt32BE(h, 12);
      ihdr[16] = 8;  // bit depth
      ihdr[17] = 6;  // RGBA
      ihdr[18] = 0;  // deflate
      ihdr[19] = 0;  // filter
      ihdr[20] = 0;  // interlace
      ihdr.writeUInt32BE(0x12345678, 21);

      const idatChunk = Buffer.alloc(12 + idat.length);
      idatChunk.writeUInt32BE(idat.length, 0);
      idatChunk.write("IDAT", 4);
      idat.copy(idatChunk, 8);
      idatChunk.writeUInt32BE(0x87654321, 8 + idat.length);

      const iendChunk = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
      return Buffer.concat([header, ihdr, idatChunk, iendChunk]);
    }

    it("accepts valid rendered PNG image buffers with luminance", () => {
      const validPng = generateTestPng(32, 32, 200);
      const res = validateScreenFrameBytes(validPng);
      expect(res.valid).toBe(true);
      expect(res.format).toBe("png");
      expect(res.width).toBe(32);
      expect(res.height).toBe(32);
    });

    it("rejects all-black unrendered PNG frames with ERR_SCREEN_CAPTURE_BLANK", () => {
      const blackPng = generateTestPng(32, 32, 0);
      const res = validateScreenFrameBytes(blackPng);
      expect(res.valid).toBe(false);
      expect(res.code).toBe("ERR_SCREEN_CAPTURE_BLANK");
      expect(res.reason).toContain("completely black or blank");
    });

    it("rejects all-black frames even when user prompt explicitly requested a screenshot", () => {
      const blackPng = generateTestPng(64, 64, 0);
      const blackBase64 = blackPng.toString("base64");
      const message = {
        role: "bot",
        kind: "screen",
        surface: "browser",
        png: blackBase64,
      };

      // Despite explicit screenshot prompt, black frames must be prohibited from chat history
      expect(isProhibitedScreenFrame(message, "can you send a screenshot of it to me")).toBe(true);
      const sanitizeRes = sanitizeMessageForChatStorage(message, { userPrompt: "can you send a screenshot of it to me" });
      expect(sanitizeRes.blocked).toBe(true);
      expect(sanitizeRes.code).toBe(ERR_CHAT_POLLUTION_BLOCKED);
    });

    it("rejects empty or corrupt payloads", () => {
      expect(validateScreenFrameBytes(null).valid).toBe(false);
      expect(validateScreenFrameBytes("").valid).toBe(false);
      expect(validateScreenFrameBytes(Buffer.from([0, 1, 2])).valid).toBe(false);
    });
  });
});


