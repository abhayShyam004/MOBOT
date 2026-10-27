import { describe, expect, it } from "vitest";
import {
  canonicalizeAssistantResponse,
  shouldBufferStreamingDeltas,
  sanitizeStreamingDelta,
  stripEmojis,
} from "./canonical-response.ts";
import {
  isProhibitedScreenFrame,
  shouldSurfaceBrowserScreenInChat,
} from "./screen-frame-gate.ts";

describe("Unified Canonical Response Pipeline (Phases 15, 16, 17, 18)", () => {
  it("buffers streaming deltas for conversational greetings to prevent flashing bloated text", () => {
    expect(shouldBufferStreamingDeltas("hey")).toBe(true);
    expect(shouldBufferStreamingDeltas("Good morning")).toBe(true);
    expect(shouldBufferStreamingDeltas("Thanks, that worked!")).toBe(true);
    // General work requests are streamed in real time
    expect(shouldBufferStreamingDeltas("Write a TypeScript function to sort an array")).toBe(false);
    expect(shouldBufferStreamingDeltas("Explain how Raft consensus works")).toBe(false);
  });

  it("buffers streaming deltas for explicit recommendation & architecture decisions", () => {
    expect(
      shouldBufferStreamingDeltas("Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?")
    ).toBe(true);
    expect(shouldBufferStreamingDeltas("Should I use Redis or Memcached for session caching?")).toBe(true);
  });

  it("sanitizes incremental streaming deltas removing raw base64 data URIs and emojis in real time", () => {
    const rawDelta = "Here is the visual 🚀 data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg== and more text.";
    const sanitized = sanitizeStreamingDelta(rawDelta);
    expect(sanitized).not.toContain("data:image/png;base64");
    expect(sanitized).not.toContain("🚀");
    expect(sanitized).toContain("Here is the visual");
    expect(sanitized).toContain("and more text.");
  });

  it("recovers bloated greeting (ERR_UNNATURAL_VERBOSITY) identically for stream and storage", () => {
    const userPrompt = "Hey";
    const bloatedGreeting =
      "Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals? Here is what I can do:\n- Run shell commands\n- Edit source code\n- Build Android apps\n- Coordinate background tasks";

    const canonical = canonicalizeAssistantResponse(bloatedGreeting, { userPrompt });

    expect(canonical.recoveredVerbosity).toBe(true);
    // Natural concise reply
    expect(canonical.text.length).toBeLessThan(80);
    expect(canonical.text.toLowerCase()).toContain("hey");
    expect(canonical.text).not.toContain("Here is what I can do");

    // Idempotence: Passing the canonical text again produces the exact same text
    const reCanonical = canonicalizeAssistantResponse(canonical.text, { userPrompt });
    expect(reCanonical.text).toBe(canonical.text);
  });

  it("recovers excessive hedging (ERR_EXCESSIVE_HEDGING) with explicit recommendation", () => {
    const userPrompt = "Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?";
    // Contains 4 disclaimers: "it depends", "both have merit", "there is no clear answer", "it's up to you" without conclusion
    const hedgedText =
      "Choosing between SQLite and PostgreSQL is complicated. It depends heavily on your context. Both have merit for different use cases. There is no clear answer to this question. Ultimately it's up to you to evaluate.";

    const canonical = canonicalizeAssistantResponse(hedgedText, { userPrompt });

    expect(canonical.recoveredHedging).toBe(true);
    expect(canonical.text).toContain("SQLite");
    expect(canonical.text.toLowerCase()).toContain("recommend");
    expect(canonical.text).not.toContain("There is no clear answer");

    // Idempotent persistence guarantee
    const reCanonical = canonicalizeAssistantResponse(canonical.text, { userPrompt });
    expect(reCanonical.text).toBe(canonical.text);
  });

  it("retains recommendation conclusion across both stream delivery and storage boundaries", () => {
    const userPrompt = "Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?";
    const directRecommendation =
      "I recommend SQLite for a lightweight local mobile app. SQLite is an in-process, serverless engine that requires zero network overhead and minimal memory footprint, making it ideal for mobile devices. PostgreSQL would only be warranted if you required centralized multi-user writes or complex server-side analytical extensions.";

    const canonical = canonicalizeAssistantResponse(directRecommendation, { userPrompt });

    expect(canonical.recoveredHedging).toBe(false);
    expect(canonical.text).toContain("SQLite");
    expect(canonical.text).toBe(directRecommendation);
  });

  it("strips raw base64 data URIs from assistant text preventing visual pollution", () => {
    const rawText =
      "Here is the result of the analysis:\n\n![Screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA\nAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO\n9TXL0Y4OHwAAAABJRU5ErkJggg==)\n\nThe task completed successfully.";

    const canonical = canonicalizeAssistantResponse(rawText, { userPrompt: "Run analysis" });

    expect(canonical.strippedBase64).toBe(true);
    expect(canonical.text).not.toContain("data:image/png;base64");
    expect(canonical.text).toContain("Here is the result of the analysis");
    expect(canonical.text).toContain("The task completed successfully.");
  });

  it("differentiates prohibited browser frames from legitimate user-requested attachments", () => {
    // Unsolicited browser frame -> Prohibited from chat history
    const prohibitedFrame = {
      role: "bot",
      kind: "screen",
      surface: "browser",
      png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    };
    expect(isProhibitedScreenFrame(prohibitedFrame)).toBe(true);

    // Explicit user request -> Allowed
    const explicitPrompt = "Show me the page";
    expect(shouldSurfaceBrowserScreenInChat({ userPrompt: explicitPrompt })).toBe(true);

    const normalPrompt = "What is the capital of France?";
    expect(shouldSurfaceBrowserScreenInChat({ userPrompt: normalPrompt })).toBe(false);
  });

  it("guarantees full byte-for-byte agreement between delivered stream and persisted storage", () => {
    const userPrompt = "Morning";
    const modelOutput =
      "Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals? Here is what I can do:\n- Continuous integration\n- Coding tasks\n- Mobile tests";

    // 1. Transformation before delivery (SSE item.completed)
    const streamEventText = canonicalizeAssistantResponse(modelOutput, { userPrompt }).text;

    // 2. Transformation during message persistence (store.appendMessage / redactBotAuthored)
    const storedMessageText = canonicalizeAssistantResponse(streamEventText, { userPrompt }).text;

    // 3. Retrieved message for Android rendering
    const androidRenderedText = stripEmojis(storedMessageText);

    // All three representations agree 100%
    expect(streamEventText).toBe(storedMessageText);
    expect(storedMessageText).toBe(androidRenderedText);
    expect(streamEventText).not.toContain("Continuous integration");
  });
});
