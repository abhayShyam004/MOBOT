import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeFrameHash,
  createScreenFrameSource,
  FPS_10_GAP_MS,
  FPS_HALF_GAP_MS,
  type ScreenCapture,
  type WatchWorkspaceTelemetryEvent,
} from "./screen-frame-source.ts";

afterEach(() => vi.restoreAllMocks());

const frame = (png: string) => ({ png, format: "png" });
const publicFrame = (png: string) => ({ png, mime: "image/png" });

function fixture(captures?: { computer?: ScreenCapture; browser?: ScreenCapture }) {
  let time = 100_000;
  vi.spyOn(Date, "now").mockImplementation(() => time);
  const control = { held: false, revision: 0 };
  const computer = vi.fn(async () => frame("desktop"));
  const browser = vi.fn(async () => frame("page"));
  const onFrame = vi.fn();
  const source = createScreenFrameSource({
    captures: captures ?? { computer, browser },
    control: () => ({ ...control }),
    onFrame,
    minGapMs: 3000,
  });
  return { source, computer, browser, control, onFrame, advance: (ms: number) => { time += ms; } };
}

describe("screen frame source", () => {
  it("throttles previews on one surface, but takes a fresh settled frame", async () => {
    const { source, computer, advance } = fixture();
    await source.capture();
    advance(1);
    await source.capture();
    expect(computer).toHaveBeenCalledTimes(1);
    computer.mockResolvedValue(frame("settled desktop"));
    await source.capture(true);
    expect(computer).toHaveBeenCalledTimes(2);
    expect(source.last).toEqual(publicFrame("settled desktop"));
  });

  it("switches to the browser inside the desktop preview's throttle window", async () => {
    const { source, browser, advance } = fixture();
    await source.capture();
    advance(1);
    source.surface = "browser";
    expect(source.last).toBeNull();
    await source.capture();
    expect(browser).toHaveBeenCalledTimes(1);
    expect(source.last).toEqual(publicFrame("page"));
  });

  it("waits for an in-flight desktop frame, discards it, then settles the browser", async () => {
    let resolveDesktop!: (frame: { png: string; format: string }) => void;
    const computer = vi.fn(() => new Promise<{ png: string; format: string }>((resolve) => { resolveDesktop = resolve; }));
    const browser = vi.fn(async () => frame("page"));
    const { source, onFrame } = fixture({ computer, browser });
    const oldCapture = source.capture();
    source.surface = "browser";
    const settled = source.capture(true);
    expect(browser).not.toHaveBeenCalled();
    resolveDesktop(frame("stale desktop"));
    await Promise.all([oldCapture, settled]);
    expect(source.last).toEqual(publicFrame("page"));
    expect(onFrame.mock.calls).toEqual([[publicFrame("page")]]);
  });

  it("also switches from the browser back to the desktop", async () => {
    const { source } = fixture();
    source.surface = "browser";
    await source.capture();
    source.surface = "computer";
    await source.capture(true);
    expect(source.last).toEqual(publicFrame("desktop"));
  });

  it("does not use an old desktop as fallback when the selected browser fails", async () => {
    const { source, browser } = fixture();
    await source.capture();
    browser.mockRejectedValue(new Error("browser unavailable"));
    source.surface = "browser";
    await source.capture(true);
    expect(source.last).toBeNull();
  });

  it("serializes concurrent preview requests even while switching surfaces", async () => {
    const { source, computer } = fixture();
    await Promise.all([source.capture(), source.capture(), source.capture()]);
    expect(computer).toHaveBeenCalledTimes(1);
  });

  it("never captures while the human holds control, even for a settled frame", async () => {
    const { source, computer, control } = fixture();
    control.held = true;
    await source.capture(true);
    expect(computer).not.toHaveBeenCalled();
    expect(source.last).toBeNull();
  });

  it("discards a frame if human control changed while it was in flight", async () => {
    const { source, computer, control, onFrame } = fixture();
    computer.mockImplementation(async () => {
      control.revision += 2;
      return frame("private");
    });
    await source.capture(true);
    expect(source.last).toBeNull();
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("keeps the only available surface usable", async () => {
    const { source } = fixture({ browser: async () => frame("only browser") });
    expect(source.surface).toBe("browser");
    await source.capture(true);
    expect(source.last).toEqual(publicFrame("only browser"));
  });

  describe("Phase 22: Watch Workspace telemetry, hashing, deduplication & rate adaptation", () => {
    it("computes standard SHA-256 frame hashes", () => {
      const sample = "iVBORw0KGgoAAAANSUhEUgAA";
      const expected = createHash("sha256").update(sample).digest("hex");
      expect(computeFrameHash(sample)).toBe(expected);
    });

    it("deduplicates identical consecutive frames to save bandwidth & render overhead", async () => {
      let time = 200_000;
      vi.spyOn(Date, "now").mockImplementation(() => time);
      const control = { held: false, revision: 0 };
      const browser = vi.fn(async () => frame("identical_pixels"));
      const onFrame = vi.fn();
      const onTelemetry = vi.fn();

      const source = createScreenFrameSource({
        botId: "bot_dedupe_test",
        captures: { browser },
        control: () => ({ ...control }),
        onFrame,
        onTelemetry,
        minGapMs: 100,
        deduplicate: true,
      });

      // First capture: fires onFrame and onTelemetry with frameHash
      await source.capture();
      expect(browser).toHaveBeenCalledTimes(1);
      expect(onFrame).toHaveBeenCalledTimes(1);
      expect(source.lastHash).toBe(computeFrameHash("identical_pixels"));

      // Advance time past minGapMs, but frame is identical
      time += 200;
      await source.capture();
      expect(browser).toHaveBeenCalledTimes(2);
      // onFrame was NOT called again because frame was deduplicated!
      expect(onFrame).toHaveBeenCalledTimes(1);

      // Now return changed frame
      browser.mockResolvedValue(frame("different_pixels"));
      time += 200;
      await source.capture();
      expect(browser).toHaveBeenCalledTimes(3);
      expect(onFrame).toHaveBeenCalledTimes(2);
      expect(source.lastHash).toBe(computeFrameHash("different_pixels"));
    });

    it("adapts frame rate dynamically: 10 FPS during active interaction, 0.5 FPS when static", async () => {
      let time = 300_000;
      vi.spyOn(Date, "now").mockImplementation(() => time);
      const control = { held: false, revision: 0 };
      let frameSeq = 0;
      const browser = vi.fn(async () => frame(`frame_${++frameSeq}`));

      const source = createScreenFrameSource({
        botId: "bot_fps_test",
        captures: { browser },
        control: () => ({ ...control }),
        minGapMs: 2000, // 0.5 FPS default
      });

      // Static mode: gap is 2000ms
      expect(source.effectiveMinGapMs()).toBe(2000);
      await source.capture();
      expect(browser).toHaveBeenCalledTimes(1);

      // Advance 100ms in static mode: throttled
      time += 100;
      await source.capture();
      expect(browser).toHaveBeenCalledTimes(1);

      // Transition to active UI interaction (e.g. navigation / interaction):
      source.activeFps = true;
      expect(source.effectiveMinGapMs()).toBe(FPS_10_GAP_MS); // 100ms (10 FPS)

      // In active mode, 100ms gap allows capture
      time += 100;
      await source.capture();
      expect(browser).toHaveBeenCalledTimes(2);

      // Switch back to static
      source.activeFps = false;
      expect(source.effectiveMinGapMs()).toBe(FPS_HALF_GAP_MS); // 2000ms
    });

    it("emits authentic telemetry events for all Phase 22 surfaces", () => {
      const telemetryEvents: WatchWorkspaceTelemetryEvent[] = [];
      const source = createScreenFrameSource({
        botId: "bot_surfaces",
        captures: {},
        control: () => ({ held: false, revision: 0 }),
        onTelemetry: (evt) => telemetryEvents.push(evt),
        minGapMs: 1000,
      });

      // 1. Idle state (standby)
      const idleEvt = source.transitionToIdle("Standby - Ready for tasks");
      expect(idleEvt.surface).toBe("idle");
      expect(idleEvt.isLiveExecution).toBe(false);
      expect(idleEvt.statusCapsuleText).toBe("Standby - Ready for tasks");
      expect(idleEvt.botId).toBe("bot_surfaces");

      // 2. Browser navigation
      const browserEvt = source.transitionToBrowser("https://github.com/facebook/react", true);
      expect(browserEvt.surface).toBe("browser");
      expect(browserEvt.isLiveExecution).toBe(true);
      expect(browserEvt.statusCapsuleText).toContain("github.com");

      // 3. Terminal session
      const terminalEvt = source.transitionToTerminal("npm run test", "$ test passed 12/12\n");
      expect(terminalEvt.surface).toBe("terminal");
      expect(terminalEvt.isLiveExecution).toBe(true);
      expect(terminalEvt.terminalChunk).toBe("$ test passed 12/12\n");
      expect(terminalEvt.statusCapsuleText).toBe("Running: npm run test");

      // 4. File editor
      const fileEvt = source.transitionToFileEditor("server/index.ts", "patch");
      expect(fileEvt.surface).toBe("file_editor");
      expect(fileEvt.isLiveExecution).toBe(true);
      expect(fileEvt.activeFileOperation).toEqual({ path: "server/index.ts", operation: "patch" });
      expect(fileEvt.statusCapsuleText).toBe("PATCH: server/index.ts");

      // 5. Phone vision
      const phoneEvt = source.transitionToPhone("Inspecting Settings App");
      expect(phoneEvt.surface).toBe("phone_screen");
      expect(phoneEvt.isLiveExecution).toBe(true);
      expect(phoneEvt.statusCapsuleText).toBe("Inspecting Settings App");

      // 6. Return to authentic idle (no spinning progress)
      const returnIdle = source.transitionToIdle();
      expect(returnIdle.surface).toBe("idle");
      expect(returnIdle.isLiveExecution).toBe(false);
      expect(returnIdle.statusCapsuleText).toBe("Ready");
    });
  });
});
