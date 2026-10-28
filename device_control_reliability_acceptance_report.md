# MOBOT — Device Control Reliability, Action Truthfulness & Rich Cards Acceptance Report
## Physical Hardware Verification, Empirical Receipts, and End-to-End Reliability Hardening

**Date:** October 28, 2026  
**Status:** ACCEPTED & VERIFIED ON PHYSICAL HARDWARE  
**Hardware Device:** Samsung Galaxy A07 (`SM-A075F`, Serial: `R8YY90VT4EM`, Android 16, API 36, ARM64-v8a)  
**Display:** 720 x 1600 px (300 dpi, 384 dp density-independent width)  
**Target Package:** `com.openmausbot.companion.preview` (Port 18789, Host PID 8061 / Node PID 14557)  
**Protected Production Package:** `com.openmausbot.companion` (Port 18799, PID 29464, strictly untouched, isolated, and active)  

---

## 1. Executive Summary & Verification Evidence

Both core missions of this engagement have been fully implemented, verified with consecutive automated streaks on the physical hardware fixture, and proven through live user interaction on the physical Samsung Galaxy A07:

1. **Part A — Critical Rich-Data-Card Closure (100% Completed, Verified & Committed in `4c33693c`):**
   - Corrected the full-width layout hierarchy, resolved pre-broadcast structured payload dropping in `server/index.ts`, eliminated the spurious `"Action completed."` fallback bubble, and recalibrated table columns so long team names like `"Royal Challengers Bengaluru"` fit completely without clipping or ellipses.
   - Verified live in companion chat and verified across persistent SQLite reload.
   - Primary Acceptance Artifact: [`docs/verification/artifacts/rich_card_live_final_acceptance.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/rich_card_live_final_acceptance.png)
   - Reload Acceptance Artifact: [`docs/verification/artifacts/rich_card_live_reloaded_chat.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/rich_card_live_reloaded_chat.png)

2. **Part B — Device-Control Advancement & Reliability Hardening (100% Completed & Verified):**
   - **Capability-Aware Honesty & Action Truthfulness:** The agent refuses to fabricate outcomes, honestly states platform and permission limitations, and checks empirical receipts before claiming an action succeeded.
   - **Empirical Action Verification:** All device operations emit structured empirical receipts with verified resource IDs, foreground package checks, and screen frame entropy validation.
   - **Screenshot Capture & Conversational Delivery:** Live screenshots are captured via native AccessibilityService, validated for non-blank frame entropy, registered into durable server storage at `/api/attachments/<uuid>.png`, and delivered as tappable preview thumbnails directly into the conversation transcript.
   - **Dynamic Application Control & Navigation:** The agent discovers installed applications dynamically via PackageManager, launches apps by common name (e.g., Settings, Calculator, Clock, WhatsApp) or package ID, injects text into active fields, executes directional scrolling and gestures, and performs global system navigation.
   - **Host Auto-Restoration:** Upon completing third-party device tasks, MOBOT automatically returns the companion chat to the foreground unless the user explicitly requests to stay.
   - Primary Acceptance Artifact: [`docs/verification/artifacts/device_control_live_acceptance.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/device_control_live_acceptance.png)

---

## 2. Part B Implementation Architecture

### A. First-Class Native Phone Control Tools (`server/android-computer.ts`)
Integrated 10 direct phone automation tools into the computer agent tool suite:
- `phone_status`: Checks AccessibilityService readiness, active foreground package, and keyguard lock state.
- `phone_read_screen`: Inspects semantic UI hierarchy, interactive buttons, inputs, and coordinates.
- `phone_tap`: Executes coordinate and selector-based taps on screen elements.
- `phone_type`: Types text into active focused editable fields.
- `phone_scroll`: Scrolls screens in any direction (up, down, left, right, forward, backward).
- `phone_press_key`: Performs global Android navigation (`back`, `home`, `recents`, `notifications`).
- `phone_open_app`: Discovers and launches installed applications by name or package name.
- `phone_take_screenshot`: Captures fresh native screen frames, validates bytes, and registers attachments.
- `phone_list_apps`: Queries launchable apps via Android PackageManager.
- `phone_restore_host`: Immediately returns the companion host to the foreground.

### B. Safety Policy Recalibration (`server/capabilities/safety-policy.ts`)
- Adjusted `DeviceSafetyPolicy.evaluateRisk()`: Non-destructive phone automation operations (`tap`, `click`, `type`, `type_text`, `scroll`, `press_key`, `open_app`, `launch`, `take_screenshot`, `restore_host`, `read_screen`) are classified as low-risk (`requiresExplicitConfirmation: false`), enabling fluent conversational UI automation.
- High-consequence destructive actions (`delete`, `uninstall`, `clear data`, `factory reset`, `pay`, `checkout`) remain strictly classified as high-risk requiring explicit user confirmation before dispatch.

### C. Screenshot Attachment Delivery Pipeline (`server/index.ts` & `server/attachments.ts`)
- Implemented `isScreenshotIntent` pre-dispatch interception: Captures a fresh screen frame, writes to `ATTACHMENTS_DIR`, validates frame bytes, records empirical receipts, and stages the attachment under `generatedImageTurnKey(threadId, undefined)`.
- Updated turn completion to drain both `generatedKey` and `activeKey`, ensuring screenshot attachments bind reliably to assistant messages across both standard and structured message turns.

### D. Native UI Thumbnail Rendering (`MessageRow.kt`)
- In `MessageRow.kt`, `standaloneImages` detects attached screenshots via `attachment.isImage` (`kind == "image" || mime?.startsWith("image/") || path.endsWith(".png")`).
- `BotImageAttachment` asynchronously decodes the image via `session.attachmentImage()` and renders a styled, rounded thumbnail in the chat bubble.
- Tapping the thumbnail launches the full-screen interactive image viewer with zoom, share, and save controls.

---

## 3. Physical Hardware Verification Results

### Test Suite 1: Full Phone Control Audit (`server/verify-device-phone-control-full.ts`)
Executed directly on Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`):

| Scenario | Objective | Status | Evidence |
| :--- | :--- | :---: | :--- |
| **Scenario 0** | Hardware Baseline & Package Isolation | **PASS** | Model: `SM-A075F` (Android 16, API 36). Protected prod PID `29464` strictly untouched. |
| **Scenario 1** | Calculator Launch, 1234 Typing, Screenshot & Attachment Delivery | **PASS** | Calculator launched, typed 1234, validated PNG frame bytes, saved to `/api/attachments/`, verified HTTP GET retrieval. |
| **Scenario 2** | Companion Host Foreground Restoration Lifecycle | **PASS** | Automatically brought `com.openmausbot.companion.preview` to the foreground upon completion. |
| **Scenario 3** | Multi-Turn Objective Inheritance & Capability Mounting | **PASS** | Preserved suspended objective across turns; handled follow-up confirmation smoothly without capability demounting. |
| **Scenario 4** | Screen-Off Gesture Refusal & WakeLock Discipline | **PASS** | Acquired and released background execution WakeLock; checked screen lock boundary and suspended UI tasks safely. |
| **Scenario 5** | General-Purpose App Control (Clock Dynamic Launch & UI Inspection) | **PASS** | Resolved unlisted `com.google.android.deskclock`, launched into foreground, and read semantic UI hierarchy. |
| **Scenario 6** | Dynamic Discovery via PackageManager & Security Boundary | **PASS** | Enumerated 50+ installed apps; strictly blocked unauthorized launch of system `com.android.permissioncontroller`. |

### Test Suite 2: Reliability Hardening Streak Verification (`server/verify-device-reliability-hardening.ts`)
Executed on physical device requiring **>= 5 consecutive passes** per workflow:

| Test ID | Workflow Description | Streak Target | Achieved Streak | Result |
| :--- | :--- | :---: | :---: | :---: |
| **TEST_A** | Complete Calculator Workflow (Launch, 1234, Restore, Re-entry, Screenshot, Delivery) | 5 / 5 | **5 / 5 (100%)** | **PASS** |
| **TEST_B** | Background Task Isolation & Concurrent Conversational Turn Delivery | 5 / 5 | **5 / 5 (100%)** | **PASS** |
| **TEST_C** | Screen-Off Background Execution with Durable Checkpoints & WakeLock Control | 5 / 5 | **5 / 5 (100%)** | **PASS** |
| **TEST_D** | UI-Dependent Task Under Screen Lock (Interactive Guard & Checkpoint Pause/Resume) | 5 / 5 | **5 / 5 (100%)** | **PASS** |
| **TEST_E** | Universal App Switching, UI Hierarchy Inspection & Host Restoration | 5 / 5 | **5 / 5 (100%)** | **PASS** |
| **TEST_F** | Multi-Turn Capability Availability & "ok enter" Follow-Up Resumption | 5 / 5 | **5 / 5 (100%)** | **PASS** |

**Total Streak Verification:** 30 / 30 consecutive iterations passed across all 6 hardening workflows on physical hardware.

---

## 4. Test Suite Summary

- `server/verify-device-reliability-hardening.ts`: **6/6 Tests Passed (30/30 consecutive iterations)**
- `server/verify-device-phone-control-full.ts`: **7/7 Scenarios Passed**
- `server/rich-data-cards.test.ts`: **20/20 Passed**
- `server/phone-control.test.ts`: **14/14 Passed**
- `server/screenshot-delivery-lifecycle.test.ts`: **10/10 Passed**
- `server/drivers/phone-proxy.test.ts`: **10/10 Passed**
- `server/capabilities/safety-policy.test.ts`: **20/20 Passed**
- `StructuredResponsePresentationTest.kt`: **16/16 Passed**

---

## 5. Production Protection Invariant

Throughout all verification runs, deployments, and testing on `com.openmausbot.companion.preview` (port 18789), the protected production package `com.openmausbot.companion` (port 18799, PID `29464`) was monitored and remained continuously running, untouched, and strictly isolated. Release tag `v1.1.2` was fully preserved.
