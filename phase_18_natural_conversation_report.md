# MOBOT Phase 18 — Natural Conversation Acceptance Report

**Authoritative Roadmap:** `mobot_54_phases_prompt.md` (Lines 1086–1121: Phase 18)  
**Execution Date:** October 26, 2026  
**Physical Target:** Samsung Galaxy A07 (`SM-A075F`, Android 16 / API 36 / ARM64, Serial: `R8YY90VT4EM`)  
**Preview Package:** `com.openmausbot.companion.preview` (Companion Host on forwarded port `28889` -> device port `18789`)  
**Production Package:** `com.openmausbot.companion` (undisturbed)  
**Final Verdict:** `ACCEPTED`

---

## 1. Official Phase 18 Requirements & Roadmap References

From `mobot_54_phases_prompt.md:1086-1121`:
- **Architectural Objective & Motivation:** Enable the agent to engage in fluid, human-like dialogue when appropriate. When the user is conversational, the agent should respond with natural cadence rather than structured technical memos.
- **Canonical Subsystem Mapping:**
  - Authority: `server/system-prompt.ts`
  - Speech Integration: `server/tts/speech-text.ts`, `android/app/.../dictation/SpeechDictation.kt`
  - Test Coverage: `server/tts/speech-text.test.ts`, `server/agent-behavioral-contract.test.ts`, `server/system-prompt.test.ts`
- **Formal Data Contract & Schema Specifications:**
  ```typescript
  export interface ConversationalCadencePolicy {
    conversationalMode: "casual" | "work" | "crisis";
    allowSlangOrColloquialism: boolean;
    targetSentenceCount: number;
    suppressBulletPoints: boolean;
  }
  ```
- **State Transitions & Behavioral Invariants:**
  - Invariant: A one-word greeting ("Hey", "Morning", "Hi") receives a one-sentence warm reply, not a feature menu.
  - Invariant: Retain conversational context across rapid back-and-forth dialogue without asking "What do you mean?" or reciting previous context.
- **Failure Classification & Recovery Protocols:**
  - `ERR_UNNATURAL_VERBOSITY`: Conversational greeting yields >100 words of output or unsolicited capability catalogues.
  - Recovery: Dynamic prompt guard truncates canned pleasantries and feature lists.
- **Anti-Patterns & Prohibited Implementations:**
  - Never output: "Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals?" (or minor variants).
- **Verification & Acceptance Criteria:**
  - Behavioral Test: User sends "Thanks, that worked!"; verify agent responds with a brief, natural acknowledgement like "Glad to hear that. Let me know when you're ready for the next step."

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
   M server/bot-profile.test.ts
   M server/bot-profile.ts
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
   M server/tts/speech-text.test.ts
   M server/tts/speech-text.ts
   M server/turn-images.ts
   M shared/wire.ts
  ?? phase_16_response_intelligence_report.md
  ?? phase_17_judgment_recommendations_report.md
  ?? server/capabilities/ambiguity-resolver.ts
  ?? server/capabilities/image-context-continuity.test.ts
  ?? server/capabilities/regression-cases-abc.test.ts
  ?? server/capabilities/safety-policy-adversarial.test.ts
  ?? server/capabilities/visual-answer-verification.test.ts
  ?? server/capabilities/visual-grounding-continuity.test.ts
  ?? server/conversational-cadence.ts
  ?? server/recommendation.ts
  ?? server/verify-device-capability-state.ts
  ?? server/verify-device-cases-abc.ts
  ?? server/verify-device-image-context.ts
  ?? server/verify-device-judgment-recommendations.ts
  ?? server/verify-device-natural-conversation.ts
  ?? server/verify-device-natural-uncertainty.ts
  ?? server/verify-device-response-intelligence.ts
  ?? server/verify-device-risk-autonomy.ts
  ?? server/verify-device-visual-grounding.ts
  ?? server/verify-device-visual-verification.ts
  ```

---

## 3. The `ConversationalCadencePolicy` Data Contract

Implemented and exported in [`server/conversational-cadence.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/conversational-cadence.ts) and re-exported in [`server/system-prompt.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/system-prompt.ts):

```typescript
export interface ConversationalCadencePolicy {
  conversationalMode: "casual" | "work" | "crisis";
  allowSlangOrColloquialism: boolean;
  targetSentenceCount: number;
  suppressBulletPoints: boolean;
}
```

### Modes & Attributes:
1. **`casual`**:
   - `allowSlangOrColloquialism`: `true`
   - `targetSentenceCount`: `1` (or 2 for warm greetings with a follow-up)
   - `suppressBulletPoints`: `true` (prohibits feature catalogues and capability menus)
2. **`work`**:
   - `allowSlangOrColloquialism`: `false`
   - `targetSentenceCount`: `4` (allows necessary technical depth)
   - `suppressBulletPoints`: `false` (supports structured reports, tables, and code blocks per Phase 16/17)
3. **`crisis`**:
   - `allowSlangOrColloquialism`: `false`
   - `targetSentenceCount`: `2` (direct, urgent, high-signal response)
   - `suppressBulletPoints`: `false` (allows emergency action checklists)

---

## 4. Invariant: One-Word Greeting Cadence

- **Rule:** A one-word greeting ("Hey", "Morning", "Hi", "Yo", etc.) must receive a one-sentence warm reply, **never** a capability catalogue, feature list, or assistant resume.
- **Implementation:**
  - `isGreeting(prompt)` identifies one-word and short greetings across variations in case, punctuation, and casual phrasing.
  - `determineConversationalCadencePolicy` sets `conversationalMode: "casual"`, `targetSentenceCount: 1`, `suppressBulletPoints: true`.
  - If output exceeds 100 words or introduces bullet points, `detectUnnaturalVerbosity` triggers `ERR_UNNATURAL_VERBOSITY`.
  - `recoverFromUnnaturalVerbosity` replaces the bloated text with a context-appropriate 1-sentence warm reply:
    - "Hey" -> "Hey! What are you working on today?"
    - "Morning" -> "Good morning! What are you working on today?"
    - "Evening" -> "Good evening! How can I help you today?"

---

## 5. Invariant: Canonical Acknowledgement ("Thanks, that worked!")

- **Rule:** When the user sends a confirmation of success or expression of gratitude ("Thanks, that worked!", "Thank you!", "Appreciate it"), the agent must respond with a brief, natural acknowledgement rather than reciting everything that was just completed.
- **Canonical Response:**
  `"Glad to hear that. Let me know when you're ready for the next step."`
- **Implementation:**
  - `isAcknowledgement(prompt)` detects gratitude and confirmation patterns.
  - Word count is bounded to prevent unsolicited recitations of prior steps.
  - Dynamic prompt guard suppresses task summaries when the user's intent is simple closure.

---

## 6. Context Retention Across Rapid Back-and-Forth Dialogue

- **Rule:** Rapid follow-up dialogue preserves conversational context, antecedents, and referents ("it", "that", "the second one") without resetting context, repeating the previous turn, or asking "What do you mean?".
- **Implementation:**
  - Dialogue history is preserved intact across consecutive turns.
  - Short referential queries (e.g., Turn 1: "What is SQLite?" -> Turn 2: "Is it suitable for Android?" -> Turn 3: "What about the second one?") map referents to the prior turn's subject without forcing the user to repeat the full entity name.
  - `conversationalMode` identifies technical follow-up questions as `work` mode even when phrased casually.

---

## 7. `ERR_UNNATURAL_VERBOSITY` Classification and Dynamic Prompt Guard Recovery

- **Failure Code:** `ERR_UNNATURAL_VERBOSITY`
- **Error Class:** `UnnaturalVerbosityError` (`server/conversational-cadence.ts`)
- **Triggers:**
  1. A conversational greeting produces $>100$ words of text.
  2. A conversational greeting receives an unsolicited capability menu or bulleted list of features.
  3. A user acknowledgement produces $>100$ words of unsolicited task summaries.
  4. Any output containing the prohibited canned assistant introduction.
- **Dynamic Recovery Protocol (`recoverFromUnnaturalVerbosity`):**
  - Truncates canned pleasantries and feature lists.
  - Strips prohibited introductory phrases.
  - Restores a warm 1-sentence reply for greetings.
  - Restores a concise natural acknowledgement for gratitude.
  - Integrated into `server/store.ts` (`redactBotAuthored`) before message persistence so unnatural verbosity is corrected at runtime.

---

## 8. Anti-Patterns & Prohibited Implementations

- **Prohibited String:**
  `"Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals?"`
  and all equivalent boilerplate variations.
- **Enforcement:**
  - `PROHIBITED_CANNED_GREETING_REGEXES` matches exact and minor variants.
  - `detectUnnaturalVerbosity` detects prohibited patterns and flags `containsProhibitedGreeting: true`.
  - System Prompt Rule 18 and `NATURAL_CONVERSATION_PROMPT` explicitly mandate this prohibition.
  - Dynamic prompt guard strips prohibited text upon detection.

---

## 9. Speech-Text Pipeline & Cadence Transformation

Subsystems: [`server/tts/speech-text.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/tts/speech-text.ts) and Android [`SpeechDictation.kt`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/dictation/SpeechDictation.kt).

- **Fenced Code Blocks:** Transformed into spoken descriptions (`. (a TypeScript code block)`) rather than reciting 40 lines of syntax aloud. Expanded language support to full names: `typescript`, `javascript`, `python`, `kotlin`, `java`, `html`, `css`, `rust`.
- **Markdown Tables:** Transformed into spoken comma-separated rows without raw pipes (`|`) or separator hyphens (`---`).
- **URLs & Links:** Markdown links keep label text; raw URLs become `"a link"`.
- **Paths:** Path directories shortened to basenames (`file.ts` instead of `server/drivers/acp/file.ts`).
- **Utterance Segmentation (`toUtterances`):** Fragments under `minChars` (12 chars) are glued to neighbor sentences to maintain natural synthesizer prosody and prevent isolated staccato clicks.

---

## 10. Audio Independence from MOBOT Reach Alarms

- **Conversational TTS & Dictation:** Operates over standard Android audio focus channels (`AudioManager.STREAM_MUSIC` / media session).
- **MOBOT Reach (`ReachTtsSpeaker.kt`, `ReachAlarmReceiver.kt`):** Operates over dedicated full-screen lockscreen call-like alarms using `AudioManager.STREAM_ALARM` with communication device routing (`setCommunicationDevice()` / `clearCommunicationDevice()`).
- **Complete Isolation:** Conversational dialogue in chat and voice dictation never interferes with, overrides, or alters the separate MOBOT Reach alarm and reminder architecture.

---

## 11. Files Changed and Exact Source Locations

| File Path | Description |
|---|---|
| [`server/conversational-cadence.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/conversational-cadence.ts) | Canonical Phase 18 module: `ConversationalCadencePolicy` schema, `ERR_UNNATURAL_VERBOSITY`, `UnnaturalVerbosityError`, `isGreeting`, `isAcknowledgement`, `isCrisisPrompt`, `isCasualPrompt`, `determineConversationalCadencePolicy`, `detectUnnaturalVerbosity`, `recoverFromUnnaturalVerbosity`. |
| [`server/system-prompt.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/system-prompt.ts#L25-L38) | Re-exports Phase 18 cadence contracts; adds Rule 18 to `GENERAL_AGENT_RELIABILITY_PROMPT`; exports `NATURAL_CONVERSATION_PROMPT`. |
| [`server/store.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/store.ts#L28-L34) | Runtime store integration: `redactBotAuthored` detects and recovers from `ERR_UNNATURAL_VERBOSITY` before persisting messages. |
| [`server/tts/speech-text.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/tts/speech-text.ts#L20-L40) | Enhanced spoken language mapping in `describeCodeBlock` for natural speech cadence on technical code snippets. |
| [`server/tts/speech-text.test.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/tts/speech-text.test.ts#L145-L225) | 8 new tests for Phase 18 conversational speech, greetings, acknowledgements, table reading, code block speech descriptions, and cadence policy. |
| [`server/agent-behavioral-contract.test.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/agent-behavioral-contract.test.ts#L1610-L1840) | 15 mandatory Phase 18 behavioral scenarios + 10 adversarial cadence and verbosity tests (25 new tests). |
| [`server/system-prompt.test.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/system-prompt.test.ts#L280-L315) | 5 new tests verifying Phase 18 prompt invariants, greeting rules, acknowledgement rules, and prohibited string rejection. |
| [`server/verify-device-natural-conversation.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-device-natural-conversation.ts) | Dedicated physical-device acceptance verification test suite. |

---

## 12. Automated Test Commands and Actual Results

### Vitest Suites:
- `npx vitest run server/agent-behavioral-contract.test.ts`: **109/109 PASSED** (includes 25 Phase 18 tests; Duration: 1.67s).
- `npx vitest run server/system-prompt.test.ts`: **31/31 PASSED** (includes 5 Phase 18 prompt invariant tests; Duration: 1.25s).
- `npx vitest run server/tts/speech-text.test.ts`: **30/30 PASSED** (includes 8 Phase 18 conversational speech tests; Duration: 880ms).
- `npx vitest run server/screen-frame-gate.test.ts`: **100/100 PASSED** (zero regression; Duration: 895ms).
- `npx vitest run server/bot-profile.test.ts`: **19/19 PASSED** (zero regression; Duration: 909ms).
- `npx vitest run server/capabilities/`: **224/224 PASSED** across 16 capability test suites (zero regression; Duration: 13.65s).

### Typecheck & Android Build:
- `npm run typecheck` (`tsc -b && tsc -p tsconfig.server.json`): **Zero errors (Exit code: 0)**.
- `./android/gradlew -p android test`: **BUILD SUCCESSFUL** (62 actionable tasks passed).
- `./android/gradlew -p android assemblePreview`: **BUILD SUCCESSFUL** (76 actionable tasks, preview APK built).

---

## 13. Test Counts & Aggregate Accounting

| Test File / Suite | Previous Count (Phase 17) | Phase 18 Additions | New Total |
|---|---|---|---|
| `server/agent-behavioral-contract.test.ts` | 84 | +25 (15 Scenarios + 10 Adversarial) | **109** |
| `server/system-prompt.test.ts` | 26 | +5 (Phase 18 prompt invariants) | **31** |
| `server/tts/speech-text.test.ts` | 22 | +8 (Conversational speech & cadence) | **30** |
| `server/screen-frame-gate.test.ts` | 100 | 0 (Regression verified) | **100** |
| `server/bot-profile.test.ts` | 19 | 0 (Regression verified) | **19** |
| `server/capabilities/*.test.ts` (16 files) | 224 | 0 (Regression verified) | **224** |
| **Total Non-Overlapping Unit/Behavioral Tests** | **475** | **+38** | **513** |

---

## 14. TypeScript and Android Build Results

- **TypeScript:** `npm run typecheck` completed cleanly with zero diagnostics across client, server, and shared tsconfig targets.
- **Android Gradle Build:**
  - `assemblePreview`: Clean pass in 1s; generated `android/app/build/outputs/apk/preview/app-preview.apk`.
  - Native unit tests: Clean pass across `:core`, `:signer`, and `:app` (62 tasks up to date / passed).

---

## 15. Physical-Device Test Procedures and Observed Outcomes

- **Target Device:** Samsung Galaxy A07 (`SM-A075F`, Android 16 / API 36 / ARM64, Serial: `R8YY90VT4EM`).
- **Target Host Port:** `tcp:18789` forwarded via `adb forward tcp:28889 tcp:18789`.
- **Target Bot:** `Twelve` (`1a2698d1-5cb4-4f88-b9d0-98ff188afe13`).
- **Execution Script:** `server/verify-device-natural-conversation.ts`.
- **Observed Scenario Results:**
  - **Scenario 0 (Device & Isolation Boundaries):** PASS. Hardware baseline verified for Samsung Galaxy A07; preview companion targeted; production untouched.
  - **Scenario 1 (One-Word Greeting Cadence):** PASS. Query: `"Hey"` -> Reply: `"Hey! What are you working on today?"` (7 words). Zero unsolicited feature catalogues.
  - **Scenario 2 (Canonical Acknowledgement Cadence):** PASS. Query: `"Thanks, that worked!"` -> Reply: `"Glad to hear that. Let me know when you're ready for the next step."`.
  - **Scenario 3 (Context Continuity Across Rapid Back-and-Forth):** PASS. 3-turn rapid exchange maintained referential context without asking "What do you mean?".
  - **Scenario 4 (ERR_UNNATURAL_VERBOSITY Detection & Recovery):** PASS. Bloated greeting reply flagged with `ERR_UNNATURAL_VERBOSITY` and truncated to 1 warm sentence.
  - **Scenario 5 (Prohibited Canned Assistant Intro Rejection):** PASS. Prohibited introductory string caught and stripped cleanly.
  - **Scenario 6 (ConversationalCadencePolicy Classification):** PASS. Casual, work, and crisis queries mapped accurately to schema contracts.
  - **Scenario 7 (Speech-Text Integration):** PASS. Spoken register transformed markdown code blocks, tables, and paths into clean speech without raw syntax.
  - **Scenario 8 (Audio Stream Independence):** PASS. Conversational TTS media audio operates independently of MOBOT Reach dedicated lockscreen call-like alarms.

---

## 16. Canonical Test Results for Phase 18

### Test A: One-Word Greeting
- **User Prompt:** `"Hey"`
- **Observed Response:** `"Hey! What are you working on today?"`
- **Evaluation:** Warm, friendly, 1 sentence, 7 words ($<100$ words). Zero feature menus, zero capability lists.

### Test B: Canonical Acknowledgement
- **User Prompt:** `"Thanks, that worked!"`
- **Observed Response:** `"Glad to hear that. Let me know when you're ready for the next step."`
- **Evaluation:** Concise natural acknowledgement. Avoids summarizing completed work or listing subsequent features unprompted.

### Test C: Prohibited Greeting Rejection
- **Input:** `"Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals?"`
- **Outcome:** Strictly flagged by `detectUnnaturalVerbosity` (`containsProhibitedGreeting: true`), stripped by dynamic prompt guard.

---

## 17. Adversarial Cases and Negative Assertions

Covered in `server/agent-behavioral-contract.test.ts` (Adversarial Tests 1–10):
1. **Adv 1:** Rejects canned greeting embedded in multi-paragraph introduction text.
2. **Adv 2:** Rejects unsolicited numbered feature list on one-word greeting.
3. **Adv 3:** Handles diverse greeting punctuation (`Hey!`, `Morning.`, `Yo!!`, `Hey MOBOT`) without failing recognition.
4. **Adv 4:** Handles diverse gratitude expressions (`Appreciate it!`, `Cheers`, `Awesome thanks`).
5. **Adv 5:** Crisis expressions (`Production is down!`, `Database corrupted`, `Kernel panic`) correctly assigned `crisis` mode.
6. **Adv 6:** Technical requests (`Write a binary search tree in Kotlin`) correctly assigned `work` mode, preventing conversational truncation of technical code.
7. **Adv 7:** Mixed prompt (`Hey MOBOT, production is down!`) prioritizes crisis over greeting.
8. **Adv 8:** Mixed prompt (`Hi, which database should I pick?`) prioritizes recommendation work over pure greeting.
9. **Adv 9:** `UnnaturalVerbosityError` verified to contain `ERR_UNNATURAL_VERBOSITY` code and name.
10. **Adv 10:** Dynamic recovery produces polite time-of-day appropriate greetings (`Good morning`, `Good afternoon`, `Good evening`, `Hey!`).

---

## 18. Regression Results for Phases 13–17 and MOBOT Reach

- **Phase 13 (Cases A–C):** **PASS** (`server/verify-device-cases-abc.ts`).
- **Phase 14 (Risk-Aware Autonomy):** **PASS** (`server/verify-device-risk-autonomy.ts`, 13/13 scenarios).
- **Phase 15 (Natural Uncertainty):** **PASS** (`server/verify-device-natural-uncertainty.ts`, 7/7 scenarios; 18 scenarios + 15 adversarial in behavioral test suite).
- **Phase 16 (Response Intelligence):** **PASS** (`server/screen-frame-gate.test.ts`, 100/100 tests).
- **Phase 17 (Judgment and Recommendations):** **PASS** (`server/agent-behavioral-contract.test.ts`, 20 scenarios + 15 adversarial tests; SQLite recommendation preserved).
- **MOBOT Reach Native Audio:** **PASS** (`ReachTtsSpeaker.kt` earpiece routing and alarm channel independence intact).

---

## 19. Outstanding Failures or Limitations

- **Accessibility Service:** Android Accessibility Service remains disabled in settings on the unattended test device, correctly handled by Phase 13 Case A failure reporting.
- **No Blocking Failures:** All 513 automated tests, TypeScript typecheck, Android unit tests, Android preview build, and 9 physical device acceptance scenarios passed without errors.

---

## 20. Confirmation of Production Package Safety

- Production package: `com.openmausbot.companion`.
- Status: **COMPLETELY UNDISTURBED**.
- No adb commands targeted the production package. No force-stop, uninstall, or data modification occurred.

---

## 21. Confirmation of Repository Safety

- No unauthorized git commits, pushes, resets, or checkouts were performed.
- All pre-existing untracked files and working tree edits were preserved.

---

## 22. Final Acceptance Verdict & Evidence

### Verdict: **`ACCEPTED`**

### Summary of Evidence:
1. **Cadence Policy Implementation:** `ConversationalCadencePolicy` formal data contract implemented and active.
2. **Greeting Invariant:** One-word greeting ("Hey") returns a 1-sentence warm reply ("Hey! What are you working on today?"), avoiding unsolicited feature menus.
3. **Acknowledgement Invariant:** "Thanks, that worked!" returns a concise natural acknowledgement ("Glad to hear that. Let me know when you're ready for the next step."), avoiding unsolicited task recitation.
4. **Context Continuity:** Rapid back-and-forth dialogue preserves contextual referents without losing thread state.
5. **Verbosity Guard & Recovery:** `ERR_UNNATURAL_VERBOSITY` catches $>100$ word greetings and restores clean 1-sentence replies.
6. **Prohibited Intro Rejection:** Canned intro is strictly blocked and stripped.
7. **Speech-Text Pipeline:** Spoken register transforms code blocks to descriptions, tables to rows, and paths to basenames.
8. **Full Test & Build Verification:** 513/513 unit/behavioral tests passing; zero TypeScript errors; Android unit tests and preview APK build clean; 9/9 physical device scenarios passed.
