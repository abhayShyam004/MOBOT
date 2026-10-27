# MOBOT Phase 16 — Response Intelligence & Visual Telemetry Isolation Acceptance Report

**Authoritative Roadmap:** `mobot_54_phases_prompt.md` (Lines 1008–1047: Phase 16)  
**Execution Date:** October 26, 2026  
**Physical Target:** Samsung Galaxy A07 (`SM-A075F`, Android 16 / API 36 / ARM64, Serial: `R8YY90VT4EM`)  
**Preview Package:** `com.openmausbot.companion.preview` (PID `7696` / Companion Host PID `7857` on port `18789`)  
**Production Package:** `com.openmausbot.companion` (PID `7267`, undisturbed)  
**Final Verdict:** `ACCEPTED`

---

## 1. Official Phase 16 Requirements & Roadmap References

From `mobot_54_phases_prompt.md:1008-1047`:
- **Architectural Objective & Motivation:** Eliminate rigid, robotic response templates. Output structure, length, tone, and formatting must adapt dynamically to the query type, balancing conversational conciseness with technical depth. Furthermore, browser screenshots and visual telemetry must be strictly decoupled from normal chat text.
- **Canonical Subsystem Mapping:**
  - Authority: `server/system-prompt.ts`, `server/screen-frame-gate.ts`
  - Client Renderer: `android/core/.../core/Markdown.kt`, `android/app/.../ui/ChatScreen.kt`
  - Test Coverage: `server/screen-frame-gate.test.ts`, `server/system-prompt.test.ts`
- **Formal Data Contract & Schema Specifications:**
  ```typescript
  export type ResponseModalityShape =
    | "short_conversational"
    | "structured_report"
    | "code_block"
    | "tabular_comparison";

  export interface ResponseFormattingPlan {
    shape: ResponseModalityShape;
    includeVisualAttachment: boolean;
    maxWordsTarget?: number;
    useMarkdownTables: boolean;
    requireExecutiveConclusion: boolean;
  }
  ```
- **State Transitions & Behavioral Invariants:**
  - Invariant: Screen frames are NEVER attached to chat messages unless explicit visual intent patterns match (`server/screen-frame-gate.ts`).
  - Invariant: Simple factual questions receive answers in 1 to 3 sentences without superfluous headings.
- **Failure Classification & Recovery Protocols:**
  - `ERR_CHAT_POLLUTION_BLOCKED`: A tool attempted to push a raw browser screen capture into chat history.
  - Recovery: `screen-frame-gate.ts` drops the frame from the message store, routing it solely to the SSE stream for Watch Computer.
- **Anti-Patterns & Prohibited Implementations:**
  - Never force every response into: Summary -> Steps -> Conclusion.
  - Never output raw base64 data URIs directly into Markdown text.
- **Verification & Acceptance Criteria:**
  - Unit Test: Run `server/screen-frame-gate.test.ts`; confirm all 18 intent and surface routing tests pass.
  - Device Test: Run research query on Samsung Galaxy A07; confirm Watch Computer shows live browser while chat displays only clean synthesized text.

---

## 2. Repository Root, Branch, HEAD, and Git Status

- **Repository Root:** `/run/media/abhay/Abhay/vsCODE/moblot`
- **Active Git Branch:** `main`
- **Current HEAD Commit:** `a21962a3d60e747ed7a89fed904df039e735fe64`
- **Git Working Tree Status (`git status --short`):**
  ```
   M android/app/src/main/AndroidManifest.xml
   M android/app/src/main/assets/host/server.zip
   M android/app/src/main/kotlin/com/openmausbot/companion/host/PhoneDriverServer.kt
   M android/app/src/main/kotlin/com/openmausbot/companion/reach/ReachActivity.kt
   M android/app/src/main/kotlin/com/openmausbot/companion/reach/ReachAlarmReceiver.kt
   M android/app/src/main/kotlin/com/openmausbot/companion/reach/ReachEvent.kt
   M android/app/src/main/kotlin/com/openmausbot/companion/reach/ReachTtsSpeaker.kt
   M android/app/src/main/kotlin/com/openmausbot/companion/service/CompanionAccessibilityService.kt
   M android/core/src/main/kotlin/com/openmausbot/companion/core/Markdown.kt
   M android/core/src/test/kotlin/com/openmausbot/companion/core/MarkdownTest.kt
   M server/agent-behavioral-contract.test.ts
   M server/android-computer.test.ts
   M server/android-computer.ts
   M server/auto-approve.ts
   M server/capabilities/default-capabilities.ts
   M server/capabilities/observability.ts
   M server/capabilities/orchestration.ts
   M server/capabilities/phone-control.ts
   M server/capabilities/reach.ts
   M server/capabilities/safety-policy.ts
   M server/composio.ts
   M server/computer-agent/artifact-manager.ts
   M server/drivers/anthropic-compat.ts
   M server/drivers/codex-native-runtime.ts
   M server/drivers/openai-chat.ts
   M server/index.ts
   M server/location-context.test.ts
   M server/location-context.ts
   M server/message-db.ts
   M server/screen-frame-gate.test.ts
   M server/screen-frame-gate.ts
   M server/store.ts
   M server/system-prompt.test.ts
   M server/system-prompt.ts
   M server/turn-images.ts
   M shared/wire.ts
  ?? server/capabilities/ambiguity-resolver.ts
  ?? server/capabilities/image-context-continuity.test.ts
  ?? server/capabilities/regression-cases-abc.test.ts
  ?? server/capabilities/safety-policy-adversarial.test.ts
  ?? server/capabilities/visual-answer-verification.test.ts
  ?? server/capabilities/visual-grounding-continuity.test.ts
  ?? server/verify-device-capability-state.ts
  ?? server/verify-device-cases-abc.ts
  ?? server/verify-device-image-context.ts
  ?? server/verify-device-natural-uncertainty.ts
  ?? server/verify-device-response-intelligence.ts
  ?? server/verify-device-risk-autonomy.ts
  ?? server/verify-device-visual-grounding.ts
  ?? server/verify-device-visual-verification.ts
  ```
  No unauthorized commits, resets, branch changes, or remote pushes were executed. Untracked verification files from earlier phases have been strictly preserved.

---

## 3. Findings from the Current Response-Formatting Implementation

Prior to Phase 16, LLM system prompts encouraged structural consistency, which inadvertently led to rigid, formulaic responses:
1. Every answer—even simple factual questions—tended to generate redundant headings (`Summary`, `Key Steps`, `Conclusion`).
2. Code responses often suffered from excessive discursive fluff preceding and following code blocks.
3. Comparisons were frequently rendered as unaligned nested lists rather than legible tabular matrices.
4. The system lacked an explicit data contract (`ResponseFormattingPlan`) to communicate the expected shape and constraints of the output.

In Phase 16, response intelligence is established dynamically based on user intent and task characteristics without forcing rigid schemas.

---

## 4. Findings from the Screen-Frame Gate and All Relevant Writers

Prior inspection of the message persistence pipeline revealed several potential leakage paths:
1. **Tool Output Persistence:** During browser automation, intermediate screenshots taken for tool observation could be surfaced if `surface !== "browser"` checks had edge cases or if tool wrappers pushed images as generic bot messages.
2. **SQLite Boundary Bypasses:** Direct insertion in `server/message-db.ts` (`insertMessage()` and `importThread()`) did not validate whether an incoming message was a prohibited screen capture or contained raw base64 data URIs.
3. **Markdown Text Smuggling:** Raw base64 strings (`data:image/png;base64,...` or raw chunks > 256 bytes) could be embedded inside bot-authored markdown text.

All writer boundaries (`Store.appendMessage`, `Store.insertMessageAfter`, `Store.redactBotAuthored`, `MessageDb.insertMessage`, and `MessageDb.importThread`) now explicitly enforce the screen-frame gate and base64 stripping.

---

## 5. Implementation of `ResponseFormattingPlan`

The canonical data contract defined in `server/screen-frame-gate.ts`:

```typescript
export type ResponseModalityShape =
  | "short_conversational"
  | "structured_report"
  | "code_block"
  | "tabular_comparison";

export interface ResponseFormattingPlan {
  shape: ResponseModalityShape;
  includeVisualAttachment: boolean;
  maxWordsTarget?: number;
  useMarkdownTables: boolean;
  requireExecutiveConclusion: boolean;
}
```

The system provides `determineResponseFormattingPlan()` to analyze user prompts and context, and `validateResponseFormattingPlan()` to normalize and validate the contract against strict invariants.

---

## 6. Formatting Decision Rules & Fallback Behavior

`determineResponseFormattingPlan(context)` resolves modality shapes using intentional analysis:
1. **`tabular_comparison`**: Triggered by explicit comparison keywords (`compare`, `comparison`, `vs`, `versus`, `difference between`) combined with multiple entities or table requests. Sets `shape = "tabular_comparison"`, `useMarkdownTables = true`, `requireExecutiveConclusion = false`.
2. **`code_block`**: Triggered by coding keywords (`code`, `function`, `script`, `write a`, `implement`, `typescript`, `python`, `regex`, etc.) without comparison/report overrides. Sets `shape = "code_block"`, `maxWordsTarget = 250`, `useMarkdownTables = false`, `requireExecutiveConclusion = false`.
3. **`structured_report`**: Triggered by explicit requests for reports, architecture breakdowns, security audits, or deep research. Sets `shape = "structured_report"`, `requireExecutiveConclusion = true`, `maxWordsTarget = 800`.
4. **`short_conversational` (Default / Factual)**: Triggered for routine factual queries (`what is`, `what does`, `how many`, `is it`, `can i`, greetings, short questions). Sets `shape = "short_conversational"`, `maxWordsTarget = 80`, `useMarkdownTables = false`, `requireExecutiveConclusion = false`.
5. **Visual Attachment Invariant**: `includeVisualAttachment = true` is granted **only** when explicit visual-intent regex patterns match (`screenshot`, `take a photo`, `show me what ... looks like`, `capture the page`, etc.).

---

## 7. Authoritative Screen-Frame Blocking and Routing Boundary

The authoritative gate is centralized in `server/screen-frame-gate.ts`:
- `isProhibitedScreenFrame(message, userPrompt)`:
  - If `message.kind === "screen"` and `message.surface === "browser"`:
    - Checks `hasExplicitVisualIntent(userPrompt)`.
    - If no explicit visual intent, returns `true` (prohibited from chat storage).
  - Also detects if a text message contains raw base64 PNG/JPEG signatures.
- **Enforcement Points:**
  1. `server/index.ts:5491-5503`: Turn settlement intercepts final screen frames. If `shouldSurface` is false, the frame is stored in `latestScreens` and broadcast to SSE (`/api/events`), but omitted from `store.insertMessageAfter()`.
  2. `server/store.ts:1287-1300`: `appendMessage()` and `insertMessageAfter()` check `isProhibitedScreenFrame()`. If violated, drops the frame and logs `ERR_CHAT_POLLUTION_BLOCKED`.
  3. `server/message-db.ts:122-132, 275-285`: SQLite database level drops prohibited frames during direct insertion and thread import.

---

## 8. Behavior of `ERR_CHAT_POLLUTION_BLOCKED`

When a tool or subsystem attempts to write a browser screen frame to chat storage without explicit visual intent:
- A `ChatPollutionBlockedError` is logged with code `ERR_CHAT_POLLUTION_BLOCKED`.
- The frame is silently dropped from chat message storage and SQLite database persistence.
- The user-facing assistant response is never blocked or crashed; normal text synthesis proceeds unaffected.
- The visual telemetry payload is diverted exclusively to the live observation pipeline.

---

## 9. Separation Between Chat Storage and Visual SSE / Watch Computer

- **Watch Computer Pipeline:**
  - Real-time browser screencasts and interactive desktop frames stream via Server-Sent Events (`GET /api/events`) with event shape `{ kind: "screen", botId, threadId, png, mime, surface }`.
  - The Watch Computer UI subscribes to this stream to render live browser activity.
- **Chat Storage Pipeline:**
  - Messages in `store` and SQLite database contain only conversational text, tool activity cards, and authorized deliverable attachments.
  - Chat state is completely clean of raw base64 data strings and unrequested screen frames.

---

## 10. Changes to `server/system-prompt.ts`

1. Exported `RESPONSE_INTELLIGENCE_PROMPT` defining Rule 16:
   - Dynamic modality adaptation (`short_conversational`, `structured_report`, `code_block`, `tabular_comparison`).
   - Factual question constraint: 1 to 3 sentences without superfluous generic headings (`Summary`, `Steps`, `Conclusion`).
   - Strict ban on raw base64 data URIs in markdown text.
   - Decoupling of visual browser telemetry from conversation history.
2. Integrated `RESPONSE_INTELLIGENCE_PROMPT` into `GENERAL_AGENT_RELIABILITY_PROMPT` as Rule 16.
3. Preserved all existing Phase 14 risk-aware autonomy and Phase 15 natural uncertainty prompt invariants.

---

## 11. Changes to Markdown and Chat Renderer

1. **`android/core/.../core/Markdown.kt`:**
   - Updated `Markdown.blocks()` parser to intercept paragraphs and images containing raw base64 data URIs (`data:image/...;base64,...`).
   - Banned raw base64 payloads from rendering in Android `ChatScreen`.
   - Preserved authorized attachment protocols (`/api/attachments/`, `attachment:`, and external HTTPS image URLs).
2. **`android/core/.../core/MarkdownTest.kt`:**
   - Verified that markdown with base64 data URIs cleanly strips the payload while preserving surrounding valid text.

---

## 12. Source Files Changed and Line References

| File Path | Relevant Lines | Description |
|---|---|---|
| `server/screen-frame-gate.ts` | Lines 1–320 | Data contract, `determineResponseFormattingPlan`, `validateResponseFormattingPlan`, `stripRawBase64DataUris`, `isProhibitedScreenFrame`, `sanitizeMessageForChatStorage`, `ERR_CHAT_POLLUTION_BLOCKED` |
| `server/store.ts` | Lines 1285–1315, 1420–1435, 1460–1470 | Chat store enforcement of prohibited frame rejection and base64 stripping on insert and redact |
| `server/message-db.ts` | Lines 120–135, 275–288 | SQLite persistence layer boundary protection |
| `server/index.ts` | Lines 5490–5505 | SSE Watch Computer visual routing on chat-frame exclusion |
| `server/system-prompt.ts` | Lines 38–70, 115–125 | `RESPONSE_INTELLIGENCE_PROMPT` and Rule 16 in `GENERAL_AGENT_RELIABILITY_PROMPT` |
| `shared/wire.ts` | Lines 68–75 | Added `surface?: "browser" \| "computer" \| Surface;` to `WireMessage` |
| `android/core/src/main/kotlin/.../Markdown.kt` | Lines 45–75 | Base64 data URI stripping from Android Chat markdown blocks |
| `android/app/src/main/kotlin/.../ReachTtsSpeaker.kt` | Lines 88–138 | `setCommunicationDevice` and `getCommunicationDevice` verification and cleanup |
| `server/screen-frame-gate.test.ts` | Lines 1–450 | 18 mandatory Phase 16 unit scenarios and gate tests (100 total tests) |
| `server/system-prompt.test.ts` | Lines 110–150 | Phase 16 prompt invariant tests (22 total tests) |
| `server/verify-device-response-intelligence.ts` | Lines 1–320 | Dedicated physical-device acceptance verification test suite |

---

## 13. Automated Test Commands and Actual Results

### Vitest Suites:
- `npx vitest run server/screen-frame-gate.test.ts`: **100/100 PASSED** (Duration: 914ms)
- `npx vitest run server/system-prompt.test.ts`: **22/22 PASSED** (Duration: 1.22s)
- `npx vitest run server/agent-behavioral-contract.test.ts`: **49/49 PASSED** (Duration: 1.56s)
- `npx vitest run server/capabilities/`: **224/224 PASSED** across 16 test files (Duration: 14.10s)

### Typecheck & Android Build:
- `npm run typecheck` (`tsc -b && tsc -p tsconfig.server.json`): **Zero errors (Exit code: 0)**
- `./android/gradlew -p android test`: **BUILD SUCCESSFUL** (62 actionable tasks passed across `:core`, `:signer`, `:app`)
- `./android/gradlew -p android assemblePreview`: **BUILD SUCCESSFUL** (76 actionable tasks, preview APK built)

---

## 14. Aggregate Test Counts & Accounting Reconciliation

### Reconciliation of Phase 15 Baseline Claims:
- The Phase 15 summary recorded 49 behavioral tests, 224 capability-regression tests, and 17 system-prompt tests, citing 273 as the aggregate total.
- **Evidence Accounting:** 49 behavioral + 224 capability = **exactly 273**. The 17 system-prompt tests were a separate suite.
- **Current Phase 16 Totals:**
  - `server/capabilities/*.test.ts`: **224 tests**
  - `server/agent-behavioral-contract.test.ts`: **49 tests**
  - `server/system-prompt.test.ts`: **22 tests** (17 baseline + 5 new Phase 16 invariant tests)
  - `server/screen-frame-gate.test.ts`: **100 tests** (82 baseline + 18 Phase 16 scenarios)
  - **Grand Total Non-Overlapping Tests:** **395 tests** (all passing).

---

## 15. TypeScript and Android Build Results

- **TypeScript:** Zero compiler diagnostics across root project, client workspace, and `tsconfig.server.json`.
- **Android Gradle Build:**
  - `assemblePreview`: Generated `android/app/build/outputs/apk/preview/app-preview.apk`.
  - Zero compilation errors. Deprecation warnings for legacy `AudioManager.isSpeakerphoneOn` retained strictly as fallback for API < 31 devices.

---

## 16. Physical-Device Procedure and Observed Outcomes

- **Target Device:** Samsung Galaxy A07 (`SM-A075F`, Android 16 / API 36 / ARM64, Serial: `R8YY90VT4EM`).
- **Target Host Port:** `tcp:18789` forwarded via `adb forward tcp:28889 tcp:18789`.
- **Target Bot:** `Twelve` (`1a2698d1-5cb4-4f88-b9d0-98ff188afe13`).
- **Execution Script:** `server/verify-device-response-intelligence.ts`.
- **Observed Scenario Results:**
  - **Scenario 0 (Device & Isolation Boundaries):** PASS (`SM-A075F`, preview package `com.openmausbot.companion.preview` running, production package `com.openmausbot.companion` untouched).
  - **Scenario 1 (Canonical Research Visual Telemetry Separation):** PASS. Query: `"Research the population of Tokyo and key facts"`. Executed `android_computer_web_search` and `android_computer_resource_fetch` (3 tool activities). Synthesized text received (14.273 million residents). Screen frames omitted from chat message store; zero base64 data URIs.
  - **Scenario 2 (Multi-Turn Conversational Cadence & Isolation):** PASS. Query: `"What was the population number again?"`. Twelve responded in a single direct sentence: `"Tokyo Metropolis had an estimated **14.273 million residents** as of **October 1, 2025**."` Zero visual telemetry pollution leaked into follow-up turn.
  - **Scenario 3 (Adaptive Formatting — short_conversational):** PASS. Query: `"What does DNS do?"`. Answered concisely in 50 words without generic `Summary`, `Steps`, or `Conclusion` boilerplate templates.
  - **Scenario 4 (Adaptive Formatting — tabular_comparison):** PASS. Query: `"Compare SQLite and PostgreSQL with a table"`. Twelve generated a structured Markdown comparison table contrasting feature trade-offs.
  - **Scenario 5 (Adaptive Formatting — code_block):** PASS. Query: `"Show me a TypeScript function to debounce an event handler"`. Twelve returned cleanly fenced TypeScript code (````ts`) with minimal accompanying explanation.
  - **Scenario 6 (Screen Frame Gate Invariants & ERR_CHAT_POLLUTION_BLOCKED):** PASS. Prohibited frames blocked; explicit visual intent permitted; raw base64 data URIs stripped.
  - **Scenario 7 (Reach Audio Routing Verification):** PASS. `ReachTtsSpeaker.kt` validated for `setCommunicationDevice()`, `communicationDevice` verification, and `clearCommunicationDevice()` restoration.

---

## 17. Evidence Showing Watch Computer Visual Activity and Clean Chat Text

- **Watch Computer SSE Stream:**
  - Connected to `/api/events` on port `28889`. Observed initial event `data: {"kind":"hello","cursor":"f9a64d74:769","resumed":false}`.
  - Live browser frames from tool execution broadcast with `kind: "screen"` to SSE subscribers.
- **Chat Message Store:**
  - Messages in thread `49f66cc7-01df-45a1-a659-9658d15abf43` verified via `/api/bots`:
    - User message: `Research the population of Tokyo and key facts`
    - Bot activity: `tool=android_computer_web_search`
    - Bot activity: `tool=android_computer_resource_fetch`
    - Bot activity: `tool=android_computer_resource_fetch`
    - Bot text: `According to the Tokyo Metropolitan Government, Tokyo Metropolis had an estimated 14.273 million residents...`
    - `kind: "screen"` messages in chat store: **0**
    - `data:image` / base64 occurrences in chat text: **0**

---

## 18. Evidence for Legitimate Explicit Image Delivery

- In `server/screen-frame-gate.test.ts` (Scenario 6 & 14) and verified via `screen-frame-gate.ts`:
  - When user prompt contains explicit visual intent (e.g., `"take a screenshot of python.org"`, `"show me what the website looks like"`, `"capture the page"`), `determineResponseFormattingPlan()` sets `includeVisualAttachment: true`.
  - `isProhibitedScreenFrame()` evaluates to `false`, allowing the legitimate screenshot or deliverable attachment to pass through to the chat store and render in `ChatScreen`.

---

## 19. Regression Results: Phase 13, Phase 14, Phase 15, and MOBOT Reach

- **Phase 13 Cases A, B, C (`server/verify-device-cases-abc.ts`):** **ALL PASSED**.
  - Case A (WhatsApp messaging truthfulness): PASS.
  - Case B (Country outline artifact classification): PASS.
  - Case C (Bounded execution & no indefinite thinking hangs): PASS.
- **Phase 14 Risk-Aware Autonomy (`server/verify-device-risk-autonomy.ts`):** **13/13 PASSED**.
  - All confirmation gates, grant consumption, and irreversible action protections intact.
- **Phase 15 Natural Uncertainty (`server/verify-device-natural-uncertainty.ts`):** **7/7 PASSED**.
  - Single project autonomous progression, irreversible fork clarification, and prompt invariants intact.
- **Multi-Turn Visual Grounding (`server/verify-device-visual-grounding.ts`):** **Turns 1-3 PASSED**.
- **MOBOT Reach Audio Routing:**
  - Verified `ReachTtsSpeaker.kt` uses `setCommunicationDevice()` on API >= 31, inspects `am.communicationDevice`, and restores to `MODE_NORMAL` via `clearCommunicationDevice()`.

---

## 20. Outstanding Failures or Platform Limitations

- **Deprecation Warnings:** Kotlin compiler emits warnings for `am.isSpeakerphoneOn` in `ReachTtsSpeaker.kt`, which is intentionally maintained as a backward-compatibility fallback for pre-Android 12 (API < 31) runtimes.
- **Accessibility Service:** On physical device, Android Settings Accessibility Service is currently disabled, which is expected in unattended headless ADB mode and correctly handled by Phase 13 Case A failure reporting.
- **No Blocking Failures:** All 18 Phase 16 scenarios, 100 screen-frame gate tests, 22 system-prompt tests, 49 behavioral tests, 224 capability tests, and 8 physical-device acceptance scenarios pass cleanly.

---

## 21. Confirmation of Production Package Safety

- Production package: `com.openmausbot.companion` (PID `7267`).
- Status: **COMPLETELY UNDISTURBED**.
- No commands targeted the production package. No uninstall, force-stop, data-clear, or permission changes were executed against `com.openmausbot.companion`.

---

## 22. Confirmation of Repository Safety

- No unauthorized commits were made.
- No `git push`, `git reset`, `git checkout`, or history rewrites were executed.
- All pre-existing untracked files and working tree edits were strictly preserved.

---

## 23. Final Acceptance Decision & Rationale

### Decision: **ACCEPTED**

### Rationale:
1. **Gate A (Adaptive Formatting):** MOBOT adapts response shapes (`short_conversational`, `structured_report`, `code_block`, `tabular_comparison`) to user intent without forcing rigid `Summary -> Steps -> Conclusion` templates.
2. **Gate B (Visual-Telemetry Isolation):** Screen frames are strictly prohibited from chat history unless explicit visual intent matches. `ERR_CHAT_POLLUTION_BLOCKED` intercepts raw browser captures, stripping raw base64 data URIs while routing live visual frames exclusively to Watch Computer SSE.
3. **Gate C (Integration):** Authoritative decision boundaries in `screen-frame-gate.ts`, `store.ts`, `message-db.ts`, and `index.ts` ensure neither historical replay, transcript reconstruction, nor alternate writers can bypass the gate.
4. **Gate D (Testing):** All 100 screen-frame gate tests, 22 system prompt tests, 49 behavioral contract tests, and 224 capability tests passed. Typecheck and Android unit tests passed with zero errors.
5. **Gate E (Physical Device):** Acceptance verified on Samsung Galaxy A07 (`SM-A075F`, Android 16 / API 36) on preview companion `com.openmausbot.companion.preview`.
6. **Gate F (Repository Safety):** Production package untouched, existing files preserved, zero remote pushes.
