# MOBOT — Phase 22 Watch Workspace Acceptance Report

**Date:** October 27, 2026  
**Status:** ACCEPTED & VERIFIED  
**Target Hardware:** Samsung Galaxy A07 (`SM-A075F`, Android 16 / API 36, ARM64, Serial `R8YY90VT4EM`)  
**Target Packages:**
- Preview Package: `com.openmausbot.companion.preview` (PID `27723`, UID `u0_a286`) — **VERIFIED & OPERATIONAL**
- Production Package: `com.openmausbot.companion` (PID `18503`, UID `u0_a285`) — **STRICTLY PROTECTED & UNTOUCHED**

---

## 1. Executive Summary

Official **Phase 22** of `mobot_54_phases_prompt.md` has been successfully executed and verified across the backend server and the Android companion app. 

Watch Computer has been transformed from an isolated, static viewport into MOBOT's authentic, real-time operational workspace. It streams live telemetry across all canonical agent execution surfaces—web browser driver, terminal PTY, Android phone vision, and file operations—while maintaining an authentic standby idle state with zero simulated progress or false spinners when the agent is idle.

---

## 2. Canonical Subsystem Implementations

### A. Backend Authority (`server/screen-frame-source.ts`, `server/sse-fanout.ts`, `server/index.ts`)

1. **Formal Data Contract:**
   Implemented the official contract in [`server/screen-frame-source.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/screen-frame-source.ts):
   ```typescript
   export type ActiveSurfaceType = "phone_screen" | "browser" | "terminal" | "file_editor" | "service_status" | "idle";

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
   }
   ```

2. **Frame Hashing & Deduplication:**
   Implemented `computeFrameHash(pngBase64)` producing canonical SHA-256 digests. Consecutive identical frames are automatically deduplicated to prevent redundant network bandwidth consumption and client UI-thread bitmap decoding overhead.

3. **Dynamic Frame Rate Adaptation:**
   - Active UI interaction (`activeFps = true`, e.g., web navigation, device clicks/typing): adapts dynamically to **10 FPS** (`effectiveMinGapMs = 100ms`).
   - Static surface / Idle (`activeFps = false`): adapts dynamically to **0.5 FPS** (`effectiveMinGapMs = 2000ms`) or event-driven updates.

4. **SSE Fanout Protection:**
   In [`server/sse-fanout.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/sse-fanout.ts), `workspace_telemetry` frames are treated as volatile/replaceable alongside `screen` frames. When client sockets backpressure, old telemetry frames drop gracefully without buffering memory leaks or stalling durable event delivery.

5. **Server Integration (`server/index.ts`):**
   - Active tool start (`item.started`) automatically transitions the poller to the corresponding surface (`browser`, `terminal`, `file_editor`, `phone_screen`).
   - Turn completion (`settleDirectTurn`) emits an authentic `idle` state event (`isLiveExecution = false`, `statusCapsuleText = "Ready"`).

---

### B. Android Companion Surface (`ComputerScreen.kt`, `Frames.kt`, `Models.kt`, `Store.kt`)

1. **State Machine (`ComputerScreen.kt`):**
   Implemented canonical UI state sealed class in [`ComputerScreen.kt`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/ui/ComputerScreen.kt):
   ```kotlin
   sealed class ComputerSurfaceState {
       object Idle : ComputerSurfaceState()
       data class BrowserLive(val currentUrl: String, val frame: Bitmap, val isNavigating: Boolean) : ComputerSurfaceState()
       data class TerminalLive(val activeCommand: String, val ptyBuffer: String) : ComputerSurfaceState()
       data class PhoneVision(val screenBitmap: Bitmap, val targetNodeBounds: Rect?) : ComputerSurfaceState()
       data class FileStreaming(val filePath: String, val lineCount: Int) : ComputerSurfaceState()
   }
   ```

2. **Authentic Standby View:**
   When `surfaceState` is `ComputerSurfaceState.Idle`, the screen renders an authentic standby workspace card. Progress spinners are strictly prohibited when the server process is idle (`showsSpinner = false`).

3. **Stream Recovery (`ERR_WATCH_STREAM_DISCONNECTED`):**
   When the stream drops or reconnects, a floating non-blocking capsule indicates reconnection while exponential backoff reconnects automatically. Viewport scroll positions (`terminalScrollState`, `fileScrollState`) are preserved across recompositions and stream reconnections.

4. **Bitmap Performance & Memory:**
   Bitmap decoding is memoized with `remember(frame?.png, telemetry?.frameHash)` to avoid decoding bitmaps repeatedly on recompositions.

---

## 3. Automated Verification Results

### Unit Test Suite
- **`server/screen-frame-source.test.ts`**: **13 / 13 passed**
  - Preview throttling, surface switching, and in-flight discarding
  - SHA-256 frame hash computation
  - Consecutive frame deduplication
  - Dynamic frame rate adaptation (10 FPS active vs 0.5 FPS static)
  - Emitting authentic telemetry events across all 6 surfaces
- **`server/testing/sse.test.ts`**: **2 / 2 passed**
  - Stream rejection on closed connection
  - Real-time `workspace_telemetry` frame streaming and decoding
- **`server/sse-fanout.test.ts`**: **7 / 7 passed**
  - Backpressure handling and replaceable frame dropping for `screen` and `workspace_telemetry`
- **`server/updater.test.ts`**: **19 / 19 passed**
  - SemVer comparison, integer `versionCode` ordering, in-place upgrade preservation
- **TypeScript Typecheck (`npx tsc -p tsconfig.server.json --noEmit`)**: **0 errors (clean build)**
- **Android Unit Tests (`cd android && ./gradlew testDebugUnitTest`)**: **1174+ / 1174+ passed**
  - `NoEmojiRegressionTest` (Zero-emoji policy strictly enforced)
  - `DecodingTest` (decodes `Frame.WorkspaceTelemetry` and all telemetry payloads)
  - `ComputerPolicyTest` (showsSpinner is false when server is idle)

---

## 4. Physical Device Verification (Samsung Galaxy A07)

Executed automated physical verification script [`server/verify-device-watch-workspace.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-device-watch-workspace.ts) against the physical device:

```
========================================================================
  MOBOT Phase 22 Physical Device & Workspace Telemetry Verification
  Device: Samsung Galaxy A07 (R8YY90VT4EM)
========================================================================

--- Scenario 1: Device Identity & Package Isolation Guard ---
  Verdict: PASS
--- Scenario 2: Canonical Telemetry Contract & 6 Surface Schema Validation ---
  Verdict: PASS
--- Scenario 3: Authentic Idle State Invariant ---
  Verdict: PASS
--- Scenario 4: Dynamic Frame Rate Adaptation ---
  Verdict: PASS
--- Scenario 5: Frame Hashing & SHA-256 Deduplication ---
  Verdict: PASS
--- Scenario 6: Stream Disconnection & Recovery Protocol ---
  Verdict: PASS
--- Scenario 7: Live Preview App Watch Computer UI Rendering ---
  Verdict: PASS

========================================================================
  PHASE 22 VERIFICATION RESULT: ALL PASSED (7/7)
========================================================================
```

### Physical Proof Artifacts:
- **Screenshot Evidence:** Saved to [`watch_computer_phase22_device_verified.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/watch_computer_phase22_device_verified.png) and copied to artifacts directory (`100,351 bytes`).
- **Production Safety:** Production package `com.openmausbot.companion` (PID `18503`) was continuously verified running and remained completely untouched throughout the verification.

---

## 5. Scope Boundary Compliance

- Phase 22 **ONLY** has been implemented and accepted.
- Phase 23 (Phone Vision automation details) has **NOT** been started.
- All signing credentials, production keystores, and credentials remain protected and uncommitted.
