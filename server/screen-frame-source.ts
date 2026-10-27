import { createHash } from "node:crypto";
import { captureOutsideHumanControl, type PrivateScreenFrame } from "./private-screen-capture.ts";
import type { PhoneVisionObservationPayload } from "./android-computer.ts";

export type ActiveSurfaceType = "phone_screen" | "browser" | "terminal" | "file_editor" | "service_status" | "idle";
export type ScreenCapture = () => Promise<{ png: string; format: string }>;
export type Surface = "browser" | "computer" | ActiveSurfaceType;

export interface WatchWorkspaceTelemetryEvent {
  eventId: string;
  botId: string;
  surface: ActiveSurfaceType;
  timestampMs: number;
  isLiveExecution: boolean;
  frameBase64?: string;
  frameHash?: string;
  terminalChunk?: string;
  activeFileOperation?: { path: string; operation: "read" | "write" | "patch" };
  statusCapsuleText: string;
  phoneVision?: PhoneVisionObservationPayload;
}

export function computeFrameHash(pngBase64: string): string {
  return createHash("sha256").update(pngBase64).digest("hex");
}

export const FPS_10_GAP_MS = 100;
export const FPS_HALF_GAP_MS = 2000;

export interface ScreenFrameSourceOptions {
  botId?: string;
  captures: {
    computer?: ScreenCapture;
    browser?: ScreenCapture;
    phone_screen?: ScreenCapture;
    [surface: string]: ScreenCapture | undefined;
  };
  control: () => { held: boolean; revision: number };
  onFrame?: (frame: PrivateScreenFrame) => void;
  onTelemetry?: (event: WatchWorkspaceTelemetryEvent) => void;
  minGapMs: number;
  deduplicate?: boolean;
}

function normalizeActiveSurface(surface: Surface): ActiveSurfaceType {
  if (surface === "computer") return "phone_screen";
  if (surface === "phone_screen" || surface === "browser" || surface === "terminal" || surface === "file_editor" || surface === "service_status" || surface === "idle") {
    return surface;
  }
  return "idle";
}

function defaultStatusCapsule(surface: ActiveSurfaceType, isLive: boolean): string {
  if (!isLive) return "Ready";
  switch (surface) {
    case "browser": return "Browsing Web";
    case "phone_screen": return "Controlling Android";
    case "terminal": return "Running Terminal";
    case "file_editor": return "Editing File";
    case "service_status": return "Service Active";
    case "idle": return "Ready";
  }
}

/** One serialized preview source. A cached or in-flight desktop frame must
 * never become the browser's settled picture after the bot switches surfaces.
 *
 * Transformed in Phase 22 into the canonical Watch Workspace telemetry source,
 * emitting authentic WatchWorkspaceTelemetryEvent states with frame hashing,
 * deduplication, and dynamic frame rate adaptation (~10 FPS active -> ~0.5 FPS static).
 */
export function createScreenFrameSource(input: ScreenFrameSourceOptions) {
  let current: Promise<void> | null = null;
  let lastAt = 0;
  let attemptedSurface: Surface | undefined;
  let last: PrivateScreenFrame | null = null;
  let lastSurface: Surface | undefined;
  let lastHash: string | null = null;
  let lastTelemetry: WatchWorkspaceTelemetryEvent | null = null;

  const deduplicate = input.deduplicate ?? true;
  let activeFps = false;
  let isLiveExecution = false;
  let currentStatusCapsule = "Ready";
  let activeTerminalChunk: string | undefined;
  let activeFileOp: { path: string; operation: "read" | "write" | "patch" } | undefined;

  const selectedCaptureKey = (s: Surface): string => {
    if (input.captures[s]) return s;
    if (s === "phone_screen" && input.captures.computer) return "computer";
    if (s === "computer" && input.captures.phone_screen) return "phone_screen";
    return input.captures.computer ? "computer" : (input.captures.browser ? "browser" : (input.captures.phone_screen ? "phone_screen" : s));
  };

  const selectedSurface = (): Surface => {
    const key = selectedCaptureKey(source.surface);
    return (key as Surface);
  };

  const initialSurface: Surface = input.captures.computer
    ? "computer"
    : (input.captures.phone_screen ? "phone_screen" : "browser");
  let activeSurface: Surface = initialSurface;

  const buildTelemetry = (partial?: Partial<WatchWorkspaceTelemetryEvent>): WatchWorkspaceTelemetryEvent => {
    const surfaceType = normalizeActiveSurface(source.surface);
    const event: WatchWorkspaceTelemetryEvent = {
      eventId: `wste_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      botId: input.botId ?? "default",
      surface: surfaceType,
      timestampMs: Date.now(),
      isLiveExecution,
      frameBase64: last?.png,
      frameHash: lastHash ?? (last?.png ? computeFrameHash(last.png) : undefined),
      terminalChunk: activeTerminalChunk,
      activeFileOperation: activeFileOp,
      statusCapsuleText: currentStatusCapsule || defaultStatusCapsule(surfaceType, isLiveExecution),
      ...partial,
    };
    return event;
  };

  const source = {
    get surface(): Surface {
      return activeSurface;
    },
    set surface(val: Surface) {
      activeSurface = val;
    },
    get last(): PrivateScreenFrame | null {
      return lastSurface === selectedSurface() ? last : null;
    },
    get lastHash(): string | null {
      return lastSurface === selectedSurface() ? lastHash : null;
    },
    get lastTelemetry(): WatchWorkspaceTelemetryEvent | null {
      return lastTelemetry;
    },
    get isLiveExecution(): boolean {
      return isLiveExecution;
    },
    set isLiveExecution(val: boolean) {
      isLiveExecution = val;
    },
    get activeFps(): boolean {
      return activeFps;
    },
    set activeFps(val: boolean) {
      activeFps = val;
    },
    get statusCapsuleText(): string {
      return currentStatusCapsule;
    },
    set statusCapsuleText(val: string) {
      currentStatusCapsule = val;
    },
    get terminalChunk(): string | undefined {
      return activeTerminalChunk;
    },
    set terminalChunk(val: string | undefined) {
      activeTerminalChunk = val;
    },
    get activeFileOperation(): { path: string; operation: "read" | "write" | "patch" } | undefined {
      return activeFileOp;
    },
    set activeFileOperation(val: { path: string; operation: "read" | "write" | "patch" } | undefined) {
      activeFileOp = val;
    },

    /**
     * Compute effective minimum gap between frame captures.
     * Adapts dynamically: 10 FPS (100ms) during active interaction,
     * falling to ~0.5 FPS (2000ms) or event-driven on static pages.
     */
    effectiveMinGapMs(): number {
      if (activeFps) {
        return FPS_10_GAP_MS; // ~10 FPS (100ms) during active UI interaction
      }
      return input.minGapMs ?? FPS_HALF_GAP_MS; // ~0.5 FPS (2000ms) on static surface
    },

    emitTelemetry(partial?: Partial<WatchWorkspaceTelemetryEvent>): WatchWorkspaceTelemetryEvent {
      const event = buildTelemetry(partial);
      lastTelemetry = event;
      input.onTelemetry?.(event);
      return event;
    },

    transitionToIdle(status?: string): WatchWorkspaceTelemetryEvent {
      isLiveExecution = false;
      source.surface = "idle";
      currentStatusCapsule = status || "Ready";
      activeTerminalChunk = undefined;
      activeFileOp = undefined;
      activeFps = false;
      return source.emitTelemetry({
        surface: "idle",
        isLiveExecution: false,
        statusCapsuleText: currentStatusCapsule,
      });
    },

    transitionToBrowser(url: string, isNavigating = false): WatchWorkspaceTelemetryEvent {
      isLiveExecution = true;
      source.surface = "browser";
      currentStatusCapsule = isNavigating ? `Navigating to ${url}` : `Browsing: ${url}`;
      activeFps = isNavigating;
      return source.emitTelemetry({
        surface: "browser",
        isLiveExecution: true,
        statusCapsuleText: currentStatusCapsule,
      });
    },

    transitionToTerminal(command: string, chunk?: string): WatchWorkspaceTelemetryEvent {
      isLiveExecution = true;
      source.surface = "terminal";
      currentStatusCapsule = `Running: ${command}`;
      activeTerminalChunk = chunk;
      activeFps = false;
      return source.emitTelemetry({
        surface: "terminal",
        isLiveExecution: true,
        terminalChunk: chunk,
        statusCapsuleText: currentStatusCapsule,
      });
    },

    transitionToFileEditor(path: string, op: "read" | "write" | "patch"): WatchWorkspaceTelemetryEvent {
      isLiveExecution = true;
      source.surface = "file_editor";
      currentStatusCapsule = `${op.toUpperCase()}: ${path}`;
      activeFileOp = { path, operation: op };
      activeFps = false;
      return source.emitTelemetry({
        surface: "file_editor",
        isLiveExecution: true,
        activeFileOperation: activeFileOp,
        statusCapsuleText: currentStatusCapsule,
      });
    },

    transitionToPhone(status?: string): WatchWorkspaceTelemetryEvent {
      isLiveExecution = true;
      source.surface = "phone_screen";
      currentStatusCapsule = status || "Controlling Android";
      activeFps = true;
      return source.emitTelemetry({
        surface: "phone_screen",
        isLiveExecution: true,
        statusCapsuleText: currentStatusCapsule,
      });
    },

    transitionToPhoneVision(observation: PhoneVisionObservationPayload, status?: string): WatchWorkspaceTelemetryEvent {
      isLiveExecution = true;
      source.surface = "phone_screen";
      currentStatusCapsule = status || `Controlling ${observation.focusedPackageName || "Android"}`;
      activeFps = true;
      last = {
        png: observation.screenshotPngBase64,
        mime: "image/png",
      };
      lastHash = computeFrameHash(observation.screenshotPngBase64);
      lastSurface = "phone_screen";
      return source.emitTelemetry({
        surface: "phone_screen",
        isLiveExecution: true,
        frameBase64: observation.screenshotPngBase64,
        frameHash: lastHash,
        phoneVision: observation,
        statusCapsuleText: currentStatusCapsule,
      });
    },

    transitionToPhoneProtected(packageName: string, status?: string): WatchWorkspaceTelemetryEvent {
      isLiveExecution = true;
      source.surface = "phone_screen";
      currentStatusCapsule = status || `Protected Screen: ${packageName}`;
      activeFps = false;
      return source.emitTelemetry({
        surface: "phone_screen",
        isLiveExecution: true,
        statusCapsuleText: currentStatusCapsule,
      });
    },

    async capture(fresh = false): Promise<void> {
      // Wait for the previous source before selecting the next one. A final
      // capture bypasses the preview throttle, even if a poke just finished.
      while (current) await current;
      if (input.control().held) return;
      const surface = selectedSurface();
      const minGap = source.effectiveMinGapMs();
      if (!fresh && attemptedSurface === surface && Date.now() - lastAt < minGap) return;
      attemptedSurface = surface;
      current = (async () => {
        try {
          const captureKey = selectedCaptureKey(surface);
          const capture = input.captures[captureKey];
          if (!capture) return;
          const frame = await captureOutsideHumanControl(input.control, capture);
          if (!frame || surface !== selectedSurface()) return;

          const frameHash = computeFrameHash(frame.png);

          // Deduplication: If the frame hash matches the previous frame on this surface
          // and fresh capture wasn't requested, deduplicate redundant pixel broadcast
          if (deduplicate && lastHash === frameHash && lastSurface === surface && !fresh) {
            lastAt = Date.now();
            return;
          }

          last = frame;
          lastSurface = surface;
          lastHash = frameHash;
          input.onFrame?.(frame);

          const telemetry = buildTelemetry({
            frameBase64: frame.png,
            frameHash,
          });
          lastTelemetry = telemetry;
          input.onTelemetry?.(telemetry);
        } catch {
          // A sleeping or mid-command surface is retried by the next tick.
        } finally {
          lastAt = Date.now();
        }
      })();
      try {
        await current;
      } finally {
        current = null;
      }
    },
  };
  return source;
}
