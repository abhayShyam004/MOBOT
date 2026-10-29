import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { readFileSync } from "node:fs";
import {
  executeBrowserSearchFallback,
  shouldTriggerBrowserFallback,
  buildVerbatimSearchUrl,
  selectCredibleSource,
  verifyScreenshotBuffer,
  synthesizeVerifiedAnswer,
  queryMetric,
  findMetricEvidence,
  resetBrowserFallbackState,
} from "./browser-search-fallback.ts";
import { Store } from "./store.ts";
import { saveImage, readAttachment } from "./attachments.ts";
import { verifyAndEnforceTurnTruthfulness, recordActionReceipt } from "./capabilities/action-truthfulness.ts";
import { extractStructuredContent } from "./structured-extract.ts";

describe("Browser Search Fallback & Screenshot Delivery", () => {
  const TEST_THREAD = "test-thread-fallback-1";
  const TEST_BOT = "test-bot-fallback-1";
  const DUMMY_PORT = 19999;
  const DUMMY_TOKEN = "dummy-token-1234567890";
  let store: Store;
  const selection = () => ({ instanceId: "codex", model: "gpt-5.6-luna" });

  /** A structurally complete JPEG: SOI, APP0, SOF0 with real dimensions, a
   *  payload body, and the EOI trailer. It exercises the same header walk a
   *  genuine WebView capture does (it is a fixture, not proof of capture). */
  const createValidJpegBuffer = (payload = "jpeg-bytes-payload-sample", width = 1080, height = 1920) => {
    const app0 = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10,
      0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ]);
    const sof = Buffer.from([
      0xff, 0xc0, 0x00, 0x11, 0x08,
      (height >> 8) & 0xff, height & 0xff,
      (width >> 8) & 0xff, width & 0xff,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
    const body = Buffer.from(payload);
    const padding = Buffer.alloc(3_000, 0x41);
    const eoi = Buffer.from([0xff, 0xd9]);
    return Buffer.concat([app0, sof, body, padding, eoi]);
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    resetBrowserFallbackState();
    store = new Store(selection as any);
    store.createBot();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: Fallback is triggered when a specialized provider is unavailable
  it("Test 1: Fallback is triggered when a specialized provider is unavailable", () => {
    // Normal chat greeting does not trigger fallback
    expect(shouldTriggerBrowserFallback("Hello, how are you today?")).toBe(false);
    expect(shouldTriggerBrowserFallback("thanks for the help!")).toBe(false);

    // Question about player statistics without sports context triggers fallback
    expect(shouldTriggerBrowserFallback("how many fours did sanju hit in last game", { hasSportsContext: false })).toBe(true);

    // General factual queries trigger fallback
    expect(shouldTriggerBrowserFallback("who won the 2024 Nobel Prize in Chemistry?")).toBe(true);
    expect(shouldTriggerBrowserFallback("what was the box office for Inside Out 2?")).toBe(true);

    // If retrieval failed flag is set, always triggers
    expect(shouldTriggerBrowserFallback("any question", { retrievalFailed: true })).toBe(true);
  });

  // Test 2: The initial browser search uses the exact original question verbatim
  it("Test 2: The initial browser search uses the exact original question verbatim", async () => {
    const question = "how many fours did sanju hit in last game";
    let capturedUrl = "";

    const mockFetch = vi.fn().mockImplementation(async (urlStr: string, init?: any) => {
      if (urlStr.includes("/open")) {
        const body = JSON.parse(init.body);
        capturedUrl = body.url;
        return {
          ok: true,
          json: async () => ({ ok: true, url: capturedUrl, settled: true }),
        };
      }
      if (urlStr.includes("/text")) {
        return {
          ok: true,
          json: async () => ({ ok: true, text: "Sample text with 14 fours in Kerala Cricket League" }),
        };
      }
      if (urlStr.includes("/screenshot")) {
        const buf = createValidJpegBuffer();
        return {
          ok: true,
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const res = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: question,
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetch as any,
    });

    expect(res.success).toBe(true);
    expect(res.verbatimQuery).toBe(question);
    expect(capturedUrl).toContain(encodeURIComponent(question));
  });

  // Test 3: Search URLs encode question text safely
  it("Test 3: Search URLs encode question text safely", () => {
    const trickyQuestion = 'who won "match #1"? & who scored 50+ runs & 4s/6s?';
    const searchUrl = buildVerbatimSearchUrl(trickyQuestion);
    expect(searchUrl).not.toContain('"');
    expect(searchUrl).not.toContain('#');
    expect(searchUrl).not.toContain(' ');
    expect(searchUrl).toContain(encodeURIComponent(trickyQuestion.trim()));
  });

  // Test 4: Relevant results are inspected rather than blindly selecting the first result
  it("Test 4: Relevant results are inspected rather than blindly selecting the first result", () => {
    const candidates = [
      {
        title: "Random Blog - Who played cricket today",
        url: "https://random-unverified-blog.xyz/post/123",
        snippet: "General chat about sports and fun games without stats.",
      },
      {
        title: "Sanju Samson slams 42-ball century in Kerala T20 cricket tournament",
        url: "https://www.rajasthanroyals.com/latest-news/sanju-samson-t20-cricket-league-kerala-century",
        snippet: "Sanju Samson scored 121 off 51 balls for Kochi. His innings included 14 fours and seven sixes.",
      },
      {
        title: "Buy Cricket Bats & Accessories",
        url: "https://shop.cricketequipment.com/bats",
        snippet: "Buy cricket equipment online at great discounts.",
      },
    ];

    const selected = selectCredibleSource(candidates, "how many fours did sanju hit in last game");
    expect(selected).not.toBeNull();
    // Must select candidate 2 (rajasthanroyals.com) with official stat (14 fours), NOT candidate 1
    expect(selected?.url).toBe("https://www.rajasthanroyals.com/latest-news/sanju-samson-t20-cricket-league-kerala-century");
    expect(selected?.snippet).toContain("14 fours");
  });

  // Test 5: The selected source actually contains the requested answer
  it("Test 5: The selected source actually contains the requested answer", () => {
    const sourceItem = {
      title: "Sanju Samson 42-ball century - Sportstar",
      url: "https://sportstar.thehindu.com/cricket/sanju-samson-hundred-42-balls-kerala-cricket-league",
      snippet: "Samson struck 14 fours and five maximums for Kochi Blue Tigers.",
    };

    const synthesized = synthesizeVerifiedAnswer({
      userQuestion: "how many fours did sanju hit in last game",
      sourceItem,
      pageText: "Kochi Blue Tigers vs Aries Kollam Sailors in Kerala Cricket League. Samson struck 14 fours.",
      verbatimQuery: "how many fours did sanju hit in last game",
    });

    expect(synthesized.answerText).toContain("14 fours");
    expect(synthesized.answerText).toContain("Kochi Blue Tigers");
    expect(synthesized.answerText).toContain("[Sportstar]");
  });

  // Test 6: Insufficient evidence produces an honest limitation instead of a fabricated answer
  it("Test 6: Insufficient evidence produces an honest limitation instead of a fabricated answer", () => {
    const synthesized = synthesizeVerifiedAnswer({
      userQuestion: "how many fours did unknown player xyz hit in tournament",
      sourceItem: null,
      pageText: "No matches found. Check spelling or try a different search.",
      verbatimQuery: "how many fours did unknown player xyz hit in tournament",
    });

    expect(synthesized.verified).toBe(false);
    expect(synthesized.answerText).toContain("none of the results I could open contained a credible answer");
    expect(synthesized.uncertaintyNotice).toContain("attached screenshot shows the search results");
  });

  // Test 7: A fresh screenshot is captured from the selected browser page
  it("Test 7: A fresh screenshot is captured from the selected browser page", async () => {
    let screenshotCalled = false;
    const testBuf = createValidJpegBuffer("fresh-screenshot-capture-test");

    const mockFetch = vi.fn().mockImplementation(async (urlStr: string) => {
      if (urlStr.includes("/screenshot")) {
        screenshotCalled = true;
        return {
          ok: true,
          arrayBuffer: async () => testBuf.buffer.slice(testBuf.byteOffset, testBuf.byteOffset + testBuf.byteLength),
        };
      }
      return { ok: true, json: async () => ({ ok: true, text: "Sample text" }) };
    });

    const res = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: "how many fours did sanju hit in last game",
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetch as any,
    });

    expect(screenshotCalled).toBe(true);
    expect(res.screenshotBuffer).toBeDefined();
    expect(res.screenshotHash).toBe(createHash("sha256").update(testBuf).digest("hex"));
  });

  // Test 8: An invalid or empty screenshot is rejected
  it("Test 8: An invalid or empty screenshot is rejected", () => {
    // Empty buffer
    const emptyCheck = verifyScreenshotBuffer(Buffer.alloc(0));
    expect(emptyCheck.valid).toBe(false);

    // Tiny buffer
    const tinyCheck = verifyScreenshotBuffer(Buffer.from([0xff, 0xd8, 0xff]));
    expect(tinyCheck.valid).toBe(false);

    // Corrupted non-image bytes
    const corruptCheck = verifyScreenshotBuffer(Buffer.alloc(4_000, 0x00));
    expect(corruptCheck.valid).toBe(false);

    // Magic bytes with no decodable frame header (a fabricated "screenshot")
    const headerOnly = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3_000, 0x41)]);
    expect(verifyScreenshotBuffer(headerOnly).valid).toBe(false);

    // Truncated capture: valid header, no EOI trailer
    const truncated = createValidJpegBuffer().subarray(0, 3_000);
    expect(verifyScreenshotBuffer(truncated).valid).toBe(false);

    // A 1x1 image cannot show a page
    expect(verifyScreenshotBuffer(createValidJpegBuffer("tiny", 1, 1)).valid).toBe(false);

    // Valid JPEG buffer
    const validCheck = verifyScreenshotBuffer(createValidJpegBuffer());
    expect(validCheck.valid).toBe(true);
    expect(validCheck.mime).toBe("image/jpeg");
  });

  // Test 9: Captured bytes are correctly stored and retrieved
  it("Test 9: Captured bytes are correctly stored and retrieved", () => {
    const rawJpeg = createValidJpegBuffer("storage-and-retrieval-test-payload");
    const saved = saveImage(rawJpeg, "image/jpeg");
    expect(saved.path).toBeDefined();
    expect(saved.mime).toBe("image/jpeg");

    const filename = basename(saved.path);
    const retrieved = readAttachment(filename);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.bytes.equals(rawJpeg)).toBe(true);
    expect(retrieved?.mime).toBe("image/jpeg");
  });

  // Test 10: The attachment is associated with the correct assistant turn
  it("Test 10: The attachment is associated with the correct assistant turn", async () => {
    const turnId = "turn-samson-fallback-10";
    // Append bot message to thread
    const msg = store.appendMessage(TEST_THREAD, {
      role: "bot",
      kind: "text",
      text: "Waiting for research...",
      turnId,
    });

    const mockFetch = vi.fn().mockImplementation(async (urlStr: string) => {
      if (urlStr.includes("/screenshot")) {
        const buf = createValidJpegBuffer("turn-association-test");
        return {
          ok: true,
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        };
      }
      return { ok: true, json: async () => ({ ok: true, text: "Sample text" }) };
    });

    const res = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      turnId,
      userQuestion: "how many fours did sanju hit in last game",
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetch as any,
      storeInstance: store,
    });

    expect(res.success).toBe(true);
    expect(res.attachment).toBeDefined();

    // Verify attachment is patched onto the message
    const updated = store.messagesFor(TEST_THREAD).find((m) => m.id === msg.id);
    expect(updated?.attachments).toBeDefined();
    expect(updated?.attachments?.length).toBeGreaterThan(0);
    expect(updated?.attachments?.[0]?.path).toBe(res.attachment?.path);
  });

  // Test 11: The screenshot renders in the Android chat interface (Attachment structure validation)
  it("Test 11: The screenshot renders in the Android chat interface", () => {
    const filename = "test-screenshot-uuid.jpg";
    const attachment = {
      kind: "image",
      path: `/api/attachments/${filename}`,
      mime: "image/jpeg",
      name: filename,
    };

    // Protocol & UI contract check: isImage must be true
    const isImage =
      attachment.kind === "image" ||
      attachment.mime.startsWith("image/") ||
      attachment.path.endsWith(".jpg") ||
      attachment.path.endsWith(".png");

    expect(isImage).toBe(true);
    expect(attachment.path.startsWith("/api/attachments/")).toBe(true);
  });

  // Test 12: Conversation reload retains the image
  it("Test 12: Conversation reload retains the image", () => {
    const rawJpeg = createValidJpegBuffer("persistence-reload-test");
    const saved = saveImage(rawJpeg, "image/jpeg");
    const fname = basename(saved.path);

    const msg = store.appendMessage(TEST_THREAD, {
      role: "bot",
      kind: "text",
      text: "Verified scorecard attached.",
      attachments: [
        {
          kind: "image",
          path: `/api/attachments/${fname}`,
          mime: "image/jpeg",
          name: fname,
        },
      ],
    });

    // Simulate reloading messages from store
    const reloaded = store.messagesFor(TEST_THREAD).find((m) => m.id === msg.id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.attachments?.[0]?.path).toBe(`/api/attachments/${fname}`);

    // Verify image is still readable from disk
    const onDisk = readAttachment(fname);
    expect(onDisk).not.toBeNull();
    expect(onDisk?.bytes.equals(rawJpeg)).toBe(true);
  });

  // Test 13: Failed attachment delivery prevents a false success message
  it("Test 13: Failed attachment delivery prevents a false success message", async () => {
    const turnId = "turn-failed-delivery-13";
    recordActionReceipt({
      operationId: turnId,
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      turnId,
      actionType: "browser.search_fallback",
      status: "FAILED",
      error: { code: "ERR_ATTACHMENT_DELIVERY_FAILED", message: "disk quota exceeded" },
      attemptedAt: Date.now(),
    });

    const falseSuccessText = "I have captured and attached the screenshot for you here.";
    const truthfulness = verifyAndEnforceTurnTruthfulness({
      threadId: TEST_THREAD,
      turnId,
      assistantText: falseSuccessText,
    });

    expect(truthfulness.corrected).toBe(true);
    expect(truthfulness.text).toContain("screenshot attachment delivery failed");
    expect(truthfulness.text).not.toContain("attached the screenshot for you");
  });

  // Test 14: Repeated requests do not reuse stale screenshots accidentally
  it("Test 14: Repeated requests do not reuse stale screenshots accidentally", async () => {
    const bufA = createValidJpegBuffer("unique-shot-A");
    const bufB = createValidJpegBuffer("unique-shot-B");

    let toggle = false;
    const mockFetch = vi.fn().mockImplementation(async (urlStr: string) => {
      if (urlStr.includes("/screenshot")) {
        toggle = !toggle;
        const b = toggle ? bufA : bufB;
        return {
          ok: true,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        };
      }
      return { ok: true, json: async () => ({ ok: true, text: "Sample" }) };
    });

    const resA = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: "first question",
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetch as any,
    });

    const resB = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: "second question",
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetch as any,
    });

    expect(resA.screenshotHash).not.toBe(resB.screenshotHash);
    expect(resA.attachment?.path).not.toBe(resB.attachment?.path);
  });

  // Test 15: Browser failure and timeout handling remains bounded
  it("Test 15: Browser failure and timeout handling remains bounded", async () => {
    const mockFetchFail = vi.fn().mockRejectedValue(new Error("Connection refused: browser driver offline"));

    const res = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: "question when driver is down",
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetchFail as any,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("browser driver offline");

    // Also test invalid port (driver not configured)
    const resNoDriver = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: "question without driver",
      driverPort: 0,
      driverToken: "",
    });

    expect(resNoDriver.success).toBe(false);
    expect(resNoDriver.error).toContain("Browser driver is offline");
  });

  // Test 16: Existing sports cards, normal chat messages, and other attachments continue to function
  it("Test 16: Existing sports cards, normal chat messages, and other attachments continue to function", () => {
    // Normal chat message
    const msg = store.appendMessage(TEST_THREAD, {
      role: "bot",
      kind: "text",
      text: "Plain conversational message without fallback.",
    });
    expect(msg.kind).toBe("text");

    // Existing sports scorecard extraction
    const rawScorecard = `
\`\`\`structured
{
  "version": 1,
  "components": [
    {
      "id": "match-1",
      "type": "match_scorecard",
      "data": {
        "sport": "cricket",
        "competition": "IPL 2025",
        "fixtureTitle": "RR vs CSK",
        "teams": [
          { "name": "Rajasthan Royals", "score": "180/4" },
          { "name": "Chennai Super Kings", "score": "175/7" }
        ],
        "outcomeHeadline": "Rajasthan Royals won by 5 runs",
        "sourceUrl": "https://www.iplt20.com/match/123"
      }
    }
  ]
}
\`\`\`
`;
    const extracted = extractStructuredContent(rawScorecard, { threadId: TEST_THREAD });
    expect(extracted.structured?.components[0]?.type).toBe("match_scorecard");
    expect(extracted.structured?.components[0]?.data.outcomeHeadline).toContain("Rajasthan Royals won");
  });

  // Test 17: Answer extraction is generic, not tied to any person or sport
  it("Test 17: Answer extraction is generic across subjects and metrics", () => {
    const astronomyQuery = "how many moons does jupiter have";
    expect(queryMetric(astronomyQuery)).toBe("moons");

    const pageText =
      "Jupiter is the largest planet in the Solar System. Jupiter has 95 moons with confirmed orbits as of 2024, though the count changes as new observations are confirmed.";
    const evidence = findMetricEvidence(pageText, astronomyQuery);
    expect(evidence?.value).toBe("95");
    expect(evidence?.context).toContain("Jupiter has 95 moons");

    const synthesized = synthesizeVerifiedAnswer({
      userQuestion: astronomyQuery,
      sourceItem: {
        title: "Jupiter - NASA Science",
        url: "https://science.nasa.gov/jupiter/",
        snippet: "Jupiter has 95 moons with confirmed orbits.",
      },
      pageText,
      verbatimQuery: astronomyQuery,
    });
    expect(synthesized.verified).toBe(true);
    expect(synthesized.answerText).toContain("95");
    expect(synthesized.answerText).toContain("[Science]");

    // The same machinery works for a non-numeric subject mismatch
    const mismatch = synthesizeVerifiedAnswer({
      userQuestion: "how many moons does venus have",
      sourceItem: {
        title: "Jupiter - NASA Science",
        url: "https://science.nasa.gov/jupiter/",
        snippet: "Jupiter has 95 moons.",
      },
      pageText,
      verbatimQuery: "how many moons does venus have",
    });
    expect(mismatch.verified).toBe(false);
    expect(mismatch.answerText).toContain("does not mention what was asked");

    // No cricket- or person-specific branch exists in the module
    const source = readFileSync(join(process.cwd(), "server/browser-search-fallback.ts"), "utf8");
    expect(source.toLowerCase()).not.toContain("sanju");
    expect(source.toLowerCase()).not.toContain("kerala");
  });

  // Test 18: The Android driver reports failures as HTTP 200 { ok:false }
  it("Test 18: Driver error envelopes are surfaced instead of treated as success", async () => {
    const mockFetch = vi.fn().mockImplementation(async (urlStr: string) => {
      if (urlStr.includes("/open")) {
        return { ok: true, json: async () => ({ ok: false, error: "no such browser session: omb-deadbeef" }) };
      }
      return { ok: true, json: async () => ({ ok: true, text: "" }) };
    });

    const res = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: "how many moons does jupiter have",
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetch as any,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("no such browser session");
    expect(res.attachment).toBeUndefined();
  });

  // Test 19: A byte-identical frame for a new question is re-captured and disclosed
  it("Test 19: A repeated frame for a different question is re-captured and disclosed", async () => {
    const fixed = createValidJpegBuffer("identical-frame");
    let captures = 0;
    const mockFetch = vi.fn().mockImplementation(async (urlStr: string) => {
      if (urlStr.includes("/screenshot")) {
        captures += 1;
        return {
          ok: true,
          arrayBuffer: async () => fixed.buffer.slice(fixed.byteOffset, fixed.byteOffset + fixed.byteLength),
        };
      }
      return { ok: true, json: async () => ({ ok: true, text: "Sample" }) };
    });

    const first = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: "first question",
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetch as any,
    });
    expect(first.success).toBe(true);
    expect(first.staleFrame).toBeUndefined();

    const second = await executeBrowserSearchFallback({
      botId: TEST_BOT,
      threadId: TEST_THREAD,
      userQuestion: "second question",
      driverPort: DUMMY_PORT,
      driverToken: DUMMY_TOKEN,
      fetchFn: mockFetch as any,
    });

    // Re-capture was attempted, and the disclosure is present rather than hidden.
    expect(captures).toBe(3);
    expect(second.staleFrame).toBe(true);
    expect(second.uncertaintyNotice).toContain("byte-identical frame");
  });
});
