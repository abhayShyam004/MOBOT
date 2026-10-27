# MOBOT — General-Purpose Android App Control, Dynamic Discovery & Execution Integrity Remediation Closure Report
**Final Evidence-Backed Engineering and Physical Device Acceptance Report**

- **Date:** 2026-10-27  
- **Target Device:** Samsung Galaxy A07 (`SM-A075F`, Serial: `R8YY90VT4EM`, Android 16 / API 36 / ARM64)  
- **Production Package:** `com.openmausbot.companion` (UID `u0_a39`, PID `18503`, Node Host PID `18523` — **Untouched & Protected**)  
- **Preview Package:** `com.openmausbot.companion.preview` (UID `u0_a286`, PID `14999`, Node Host PID `15458`)  
- **Test Verdict:** **FULL PASS (7/7 Device Scenarios, 217 Automated Tests)**  
- **Official Phase Status:** **HARD STOP MAINTAINED — Official Phase 22 remains unstarted.**

---

## 1. Executive Summary & General-Purpose Architecture

This engineering report closes the personal-agent phone control remediation.

### Critical Architecture Clarification
WhatsApp, Discord, and Calculator were initial test targets used to isolate specific regression failure modes. **They are not the intended boundary of MOBOT's phone control system.** MOBOT is architected to dynamically discover, open, inspect, and interact with **any installed Android application** accessible through legitimate Android APIs, system permissions, and user-authorized automation.

The core implementation does not rely on a hardcoded allowlist or special-cased paths for specific apps:
1. **Dynamic Application Discovery & Resolution:** Applications are queried dynamically from the device's native `PackageManager` (`Intent.ACTION_MAIN`, `Intent.CATEGORY_LAUNCHER`). Input targets are resolved via multi-pass matching (exact case-insensitive label, normalized alphanumeric label, word boundary, package suffix, and package contains) without requiring hardcoded static tables.
2. **App-Agnostic UI Observation & Interaction:** Semantic UI hierarchy inspection (`/screen`), precision tapping (`/tap` by text, description, id, or coordinates), text entry (`/type` into active editable fields), scrolling (`/scroll`), and native screenshot capture (`/screenshot`) operate generically across any visible window hierarchy.
3. **Dynamic Permission Discovery & Recovery:** Missing system capabilities (e.g., Accessibility Service, Notification Listener, or app permissions) are discovered dynamically at runtime. MOBOT launches the appropriate system intent (`Settings.ACTION_ACCESSIBILITY_SETTINGS` or `ACTION_APPLICATION_DETAILS_SETTINGS`), checkpoints the suspended task context, and seamlessly resumes after setup.
4. **Transparent Boundaries & Foreground/Background Discipline:** Android's security constraints are strictly enforced: restricted system installers/controllers are protected; background activity launch (BAL) rules are respected; operations requiring foreground visibility truthfully settle or report verifiable errors.

---

## 2. Remediation Disposition Table

| Defect / Requirement | Initial State | General-Purpose Remediation Applied | Physical Device Verification (`SM-A075F`) | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Failure A: App Launch & Settle** | MOBOT falsely claimed app opened while remaining in foreground; asked user to open app manually. | Used AccessibilityService context for Background Activity Launch (BAL) privileges; real-time `rootInActiveWindow` inspection in `getForegroundPackage()`; generalized dynamic app launch dispatcher in `server/index.ts`. | Launched `Discord`; verified foreground package settled to `com.discord`; inspected 48 UI nodes. | **PASS** |
| **Failure B: Multi-Step Approval & Input** | User confirmed `1234` in Calculator; MOBOT reported phone-control permission rejected the action. | Normalized capability IDs (`normalizeCapabilityId`); bound user approvals in `answerRequest()` to `ActionAuthorizationManager`; unconsumed grant matching; validated input and native screenshot. | Launched `Calculator`; grant created & consumed; text `1234` typed into `formula` node; verified non-black screenshot (108 KB) delivered. | **PASS** |
| **Failure C: Permission Recovery & Checkpoint** | Abandoned task on missing permission, requiring user to re-type prompt from scratch. | Added `POST /setup_permission` in native loopback driver; implemented `PhoneControlTaskCheckpointManager` to suspend and resume task context. | Initiated `setup_permission` with `accessibility`; opened `com.android.settings`; preserved task state across setup; resumed pending operation upon revalidation. | **PASS** |
| **App-Agnostic Extension (Unlisted App)** | Verification restricted to specific test targets (WhatsApp, Discord, Calculator). | Dynamic `PackageManager` discovery without static dependencies; generic UI node inspection. | Dynamically launched unlisted **Google Clock** (`com.google.android.deskclock`); inspected 39 nodes; identified tab navigation controls (`Alarm`, `Clock`, `Timer`, `Stopwatch`); switched tab. | **PASS** |
| **Production Isolation** | Live companion app must never be disturbed. | All builds, installs, and commands strictly scoped to `com.openmausbot.companion.preview`. | Production package `com.openmausbot.companion` (UID `u0_a39`, PID `18503`, Node PID `18523`) remained running and untouched. | **PASS** |
| **Thermal Limit** | Laptop thermals must stay under 55°C. | CPU-bounded Gradle workers (`--max-workers=2`) and efficient native Node calls. | Peak temperature during build was 47.4°C; settled at 45.8°C (well below 55°C limit). | **PASS** |

---

## 3. General-Purpose Architecture & Implementation Details

### 1. Dynamic Application Resolution via Native `PackageManager`
- **File:** [`android/app/src/main/kotlin/com/openmausbot/companion/host/PhoneDriverServer.kt`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/host/PhoneDriverServer.kt#L530-L585)
- Rather than checking a static map of test applications, `resolveTargetPackage(input)` executes a multi-stage dynamic discovery process:
  1. **Direct Package Check:** Returns `trimmed` immediately if `packageManager.getLaunchIntentForPackage(trimmed)` exists.
  2. **Launcher Activity Enumeration:** Queries all activities with `ACTION_MAIN` and `CATEGORY_LAUNCHER` on the device:
     - Exact case-insensitive label match (`label.equals(trimmed, ignoreCase = true)`).
     - Normalized alphanumeric label match (e.g. `"playstore"` matches `"Play Store"`, `"myfiles"` matches `"My Files"`, `"clock"` matches `"Clock"`).
     - Word boundary and prefix match on label (`label.startsWith(lower)`).
     - Package name suffix match (e.g. `deskclock` matches `com.google.android.deskclock`, `chrome` matches `com.android.chrome`).
     - Substring match on package name.
  3. **Generic Synonyms Fallback:** Maps common platform synonyms (`browser` $\to$ default browser, `email` $\to$ default email, `sms` $\to$ default messages).
- **Installed App Enumeration (`GET /apps`):** Queries device `PackageManager` to return all 52 installed launcher apps dynamically to the agent runtime.

### 2. Native Background Activity Launch (BAL) & Window State
- **File:** [`android/app/src/main/kotlin/com/openmausbot/companion/service/CompanionAccessibilityService.kt`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/service/CompanionAccessibilityService.kt#L100-L125)
- **Background Activity Launch (BAL) Privilege:** Invokes `startActivity` using the `CompanionAccessibilityService` context (`instance ?: context`), which holds platform-level BAL authorization under Android 16.
- **Active Window Verification:** `getForegroundPackage()` queries `rootInActiveWindow?.packageName` and focused window roots in real time rather than relying on stale cached events.

### 3. Authoritative Action Authorization & Safety Policy
- **File:** [`server/capabilities/safety-policy.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/safety-policy.ts)
- **Universal Identifier Normalization:** `normalizeCapabilityId(id)` canonicalizes `phone-control`, `phone_control`, and `android_computer` to `device.phone_control`.
- **Authoritative Grant Validation:** In `answerRequest()`, user approvals create grants registered in `defaultActionAuthorizationManager`. In `validateAndConsumeGrant()`, unconsumed grants are resolved by `(botId, threadId, capabilityId, operation)`.
- **Denial Override:** `clearDenial()` clears prior denials upon explicit user confirmation.

### 4. Task State Machine & Checkpointing
- **File:** [`server/capabilities/phone-control.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/phone-control.ts)
- **State Machine:** Explicit `PhoneControlState` enum tracking (`ACCESSIBILITY_READY`, `PERMISSION_SETUP_REQUIRED`, `AWAITING_USER_SYSTEM_ACTION`, `APP_LAUNCH_REQUESTED`, `APP_FOREGROUND_VERIFIED`, etc.).
- **Checkpoint Manager:** [`PhoneControlTaskCheckpointManager`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/phone-control.ts#L70) suspends and resumes task context, target package, and pending parameters when system settings dialogs are launched.

### 5. Generalized Server Pre-Dispatch
- **File:** [`server/index.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L7285-L7335)
- Replaced app-specific regexes with generalized multi-word app launch detection:
  `/(?:open|launch)\s+([a-zA-Z0-9_.\s-]+?)(?:\s+(?:app|application|and|then|to|please)|$)/i`
- Dispatches any application name directly to `defaultCapabilityRegistry.invoke("device.phone_control", "open_app", ...)` and verifies foreground settlement.

---

## 4. Automated Test Suites Execution

All automated suites passed with zero failures:

```
Test Files  6 passed (6)
     Tests  191 passed (191)
  Duration  7.13s
✓ server/phone-control.test.ts (14 tests)
✓ server/capabilities/capability-registry.test.ts (24 tests)
✓ server/screen-frame-gate.test.ts (104 tests)
✓ server/capabilities/safety-policy.test.ts (20 tests)
✓ server/auto-approve.test.ts (17 tests)
✓ server/approval-humanizer.test.ts (12 tests)

Test Files  2 passed (2)
     Tests  26 passed (26)
  Duration  4.21s
✓ server/capabilities/safety-policy-adversarial.test.ts (14 tests)
✓ server/capabilities/regression-cases-abc.test.ts (12 tests)
```

### Android Gradle Unit Tests & Build
```
(cd android && ./gradlew testDebugUnitTest :app:assemblePreview --max-workers=2)
BUILD SUCCESSFUL in 1m 19s
97 actionable tasks: 11 executed, 86 up-to-date
```

### Server Bundle & Asset Generation
```
pnpm build:server && node scripts/prepare-android-host.mjs
bundled 2084 files (42.5 MB raw) -> android/app/src/main/assets/host/server.zip (11.1 MB)
```

---

## 5. Physical Device Verification Matrix (Samsung Galaxy A07)

Executed on physical device `SM-A075F` (serial `R8YY90VT4EM`) via [`server/verify-device-phone-control-full.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-device-phone-control-full.ts):

```
========================================================================
MOBOT General-Purpose Android Phone Control & Automation Verification
Target: Samsung Galaxy A07 (R8YY90VT4EM)
========================================================================

[Scenario 0] Hardware Baseline and Package Isolation...
[Scenario 1] Failure A Remediation: Discord Launch & Foreground Transition...
[Scenario 2] Failure B Remediation: Calculator Launch, Grant Validation, Typing & Screenshot...
[Scenario 3] WhatsApp Dynamic Launch & Verification...
[Scenario 4] Failure C Remediation: Autonomous Permission Setup & Task Resumption...
[Scenario 5] General-Purpose Control: Dynamically Launching Unlisted App (Clock)...
[Scenario 6] Dynamic Discovery via PackageManager & High-Security Boundary Enforcement...

========================================================================
Verification Complete. Summary:
[Scenario 0] Hardware Baseline and Package Isolation: PASS
[Scenario 1] Failure A Remediation: Discord Launch and Foreground Verification: PASS
[Scenario 2] Failure B Remediation: Calculator E2E Action, Authorization Grant, and Verified Screenshot: PASS
[Scenario 3] WhatsApp Dynamic Launch and Foreground Verification: PASS
[Scenario 4] Failure C Remediation: Autonomous Permission Setup and Task Continuity Checkpointing: PASS
[Scenario 5] General-Purpose App Control: Unlisted Application (Clock) Dynamic Discovery, Launch & UI Inspection: PASS
[Scenario 6] Installed Apps Dynamic Discovery and High-Security Boundaries: PASS
========================================================================
```

### Detailed Device Scenario Breakdown

| Scenario | Objective | Observed Result on Device | Evidence Receipts | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **0. Baseline & Isolation** | Verify hardware baseline; ensure production companion app is untouched. | Samsung Galaxy A07 (`SM-A075F`, Android 16, API 36, arm64). Production package PID `18503` continuously alive. | Production UID `u0_a39` PID `18503` & `18523` running. Preview UID `u0_a286` active. | **PASS** |
| **1. Discord Launch (Failure A)** | Launch Discord by name; verify foreground transition and inspect UI hierarchy. | `com.discord` launched; foreground verified as `com.discord` (settled=`true`). | Inspected 48 accessible UI nodes in active Discord hierarchy. | **PASS** |
| **2. Calculator Flow (Failure B)** | Launch Calculator, validate authorization grant, type `1234`, verify formula node, capture non-black screenshot. | Calculator launched; grant validated and consumed; `1234` typed; verified in formula node; screenshot captured. | Active node `formula` text: `"1234"`. Screenshot (720x1600, 108,589 bytes) passed entropy and non-black gates. | **PASS** |
| **3. WhatsApp Dynamic Launch** | Launch WhatsApp by name; verify foreground transition and UI nodes. | `com.whatsapp` launched; foreground verified as `com.whatsapp`. | Inspected active WhatsApp window hierarchy. | **PASS** |
| **4. Permission Setup (Failure C)** | Trigger `setup_permission` for accessibility; verify Settings opens; suspend & resume task checkpoint. | Settings app (`com.android.settings`) opened in foreground. Task state checkpointed and recovered. | Checkpoint `task_phone_001` preserved `pendingAction: type_text`, objective, and resumed upon revalidation. | **PASS** |
| **5. Unlisted App (Clock)** | **Demonstrate general-purpose app control on an unlisted target not in original prompt.** | Requested `"Clock"`. Dynamically resolved `com.google.android.deskclock` via `PackageManager`. Foreground verified. | Inspected 39 nodes; identified tab navigation (`Alarm`, `Clock`, `Timer`, `Stopwatch`); tapped `Timer`. | **PASS** |
| **6. App Discovery & Boundaries** | Enumerate all launchable apps dynamically; verify security boundary on restricted packages. | 52 installed launcher apps discovered dynamically. Restricted package launch blocked. | Returned Clock, Chrome, Drive, YouTube, Duolingo, etc. Strictly blocked `com.android.permissioncontroller`. | **PASS** |

---

## 6. Artifact Index

1. **Verified Calculator Screenshot Artifact:**  
   [`screen_calculator_1234_verified.png`](file:///home/abhay/.gemini/antigravity-cli/brain/e1c49599-6b92-434f-80a9-222dd272a0e6/screen_calculator_1234_verified.png)  
   - Format: PNG 720x1600 RGBA non-interlaced, 108,589 bytes  
   - Depiction: Real Calculator interface displaying formula `1234` in the input field  
   - Gate status: Non-black frame check passed, entropy check passed.

2. **Verification Harness Script:**  
   [`server/verify-device-phone-control-full.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-device-phone-control-full.ts)

3. **Core Modified Implementation Files:**  
   - [`PhoneDriverServer.kt`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/host/PhoneDriverServer.kt) — Dynamic `PackageManager` discovery & intent dispatch  
   - [`CompanionAccessibilityService.kt`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/service/CompanionAccessibilityService.kt) — Active window hierarchy & BAL privileges  
   - [`server/drivers/phone-proxy.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/drivers/phone-proxy.ts) — App-agnostic driver calls & dynamic app listing  
   - [`server/capabilities/safety-policy.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/safety-policy.ts) — Authorization grant matching & canonical capability normalization  
   - [`server/capabilities/phone-control.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/phone-control.ts) — Task state machine & checkpoint suspension/resumption  
   - [`server/index.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts) — Authoritative grant issuance & multi-word dynamic app dispatch  
   - [`skills/phone-harness/manifest.json`](file:///run/media/abhay/Abhay/vsCODE/moblot/skills/phone-harness/manifest.json) — Generalized app control harness triggers

---

## 7. Strict Compliance & Boundary Audit

1. **Official Phase 22 Boundary:**  
   Official Phase 22 (Transform Watch Computer into the Agent Workspace) and all subsequent phases remain **UNSTARTED**. Work was strictly confined to phone control remediation and general-purpose architecture hardening.
2. **Git Hygiene:**  
   No `git commit`, `git push`, `git reset`, `git clean`, or destructive checkouts were performed. All working tree changes and artifacts are preserved intact.
3. **Production Safety:**  
   Production companion package `com.openmausbot.companion` (UID `u0_a39`, PID `18503`, Node Host PID `18523`) remained protected and continuously running throughout all tests.
4. **Thermal Governance:**  
   Laptop temperature remained well below the 55°C ceiling throughout the entire build and verification pipeline (current Tctl: 45.8°C).
