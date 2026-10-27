# MOBOT Phase 17 — Judgment and Recommendations Acceptance Report

**Authoritative Roadmap:** `mobot_54_phases_prompt.md` (Lines 1049–1085: Phase 17)  
**Execution Date:** October 26, 2026  
**Physical Target:** Samsung Galaxy A07 (`SM-A075F`, Android 16 / API 36 / ARM64, Serial: `R8YY90VT4EM`)  
**Preview Package:** `com.openmausbot.companion.preview` (PID `7696` / Companion Host PID `7857` on port `18789`)  
**Production Package:** `com.openmausbot.companion` (PID `7267`, undisturbed)  
**Final Verdict:** `ACCEPTED`

---

## 1. Official Phase 17 Requirements & Roadmap References

From `mobot_54_phases_prompt.md:1049-1085`:
- **Architectural Objective & Motivation:** Transform MOBOT from an evasive search engine into an opinionated teammate. When asked for advice, comparisons, or technical decisions, the agent must evaluate tradeoffs, take a stand, and offer an explicit recommendation while distinguishing facts from judgment.
- **Canonical Subsystem Mapping:**
  - Authority: `server/system-prompt.ts`, `server/bot-profile.ts`
  - Test Coverage: `server/agent-behavioral-contract.test.ts`
- **Formal Data Contract & Schema Specifications:**
  ```typescript
  export interface RecommendationPayload {
    optionsEvaluated: Array<{ name: string; pros: string[]; cons: string[] }>;
    recommendedOption: string;
    rationale: string;
    criticalTradeoff: string;
    distinctionBetweenFactAndOpinion: string;
  }
  ```
- **State Transitions & Behavioral Invariants:**
  - Invariant: Recommendations must state the primary decision criterion (e.g., speed vs. maintainability).
  - Invariant: Never list options without providing a recommended choice when explicitly asked "What should I do?".
- **Failure Classification & Recovery Protocols:**
  - `ERR_EXCESSIVE_HEDGING`: Response contains >3 generic disclaimer phrases ("It depends", "Both have merit", etc.) without a conclusion.
  - Recovery: System prompt penalty enforces direct recommendation insertion.
- **Anti-Patterns & Prohibited Implementations:**
  - Do not respond with endless neutral lists that leave the user with the entire burden of choice.
  - Do not recommend dangerous or unverified options.
- **Verification & Acceptance Criteria:**
  - Behavioral Test: Ask "Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?"; verify agent unequivocally recommends SQLite and explains why.

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
   M server/turn-images.ts
   M shared/wire.ts
  ?? phase_16_response_intelligence_report.md
  ?? server/capabilities/ambiguity-resolver.ts
  ?? server/capabilities/image-context-continuity.test.ts
  ?? server/capabilities/regression-cases-abc.test.ts
  ?? server/capabilities/safety-policy-adversarial.test.ts
  ?? server/capabilities/visual-answer-verification.test.ts
  ?? server/capabilities/visual-grounding-continuity.test.ts
  ?? server/recommendation.ts
  ?? server/verify-device-capability-state.ts
  ?? server/verify-device-cases-abc.ts
  ?? server/verify-device-image-context.ts
  ?? server/verify-device-judgment-recommendations.ts
  ?? server/verify-device-natural-uncertainty.ts
  ?? server/verify-device-response-intelligence.ts
  ?? server/verify-device-risk-autonomy.ts
  ?? server/verify-device-visual-grounding.ts
  ?? server/verify-device-visual-verification.ts
  ```
  No unauthorized commits, resets, branch changes, or remote pushes occurred. Pre-existing untracked and modified files are preserved.

---

## 3. Baseline Recommendation Behavior

Prior to Phase 17:
1. When asked for advice or technical decisions, LLM assistants frequently defaulted to indecisive neutral comparisons, presenting symmetric bullet points of pros and cons followed by noncommittal disclaimers ("It depends on your specific needs", "Both have merit", "Whichever you prefer").
2. The user was left with the entire burden of choice, transforming what should be a collaborative teammate into an evasive search engine.
3. No formal schema existed to represent evaluated alternatives, primary decision criteria, decisive rationales, critical trade-offs, and fact-vs-judgment distinctions.
4. There was no runtime enforcement mechanism (`ERR_EXCESSIVE_HEDGING`) to detect and correct repeated disclaimers without a conclusion.

---

## 4. Findings from System Prompt and Bot-Profile Audit

- **`server/system-prompt.ts`:**
  - Contained general reliability rules 1 through 16 (`GENERAL_AGENT_RELIABILITY_PROMPT`), covering empirical verification, artifact handling, long-running tasks, 5-tier evidence hierarchy, MOBOT Reach, and Phase 16 response intelligence.
  - Lacked an explicit mandate for opinionated recommendations, primary decision criterion identification, and anti-hedging penalties.
- **`server/bot-profile.ts`:**
  - Served as the shared validation boundary for bot profiles, identity fields, and soul instructions.
  - Ideal canonical location to define and export the formal `RecommendationPayload` contract, `classifyRecommendationRequest()`, `validateRecommendationPayload()`, `detectExcessiveHedging()`, `recoverFromExcessiveHedging()`, and `ERR_EXCESSIVE_HEDGING`.
- **`server/store.ts` (`redactBotAuthored`):**
  - Intercepts all bot-authored messages before storage and projection.
  - Serves as the authoritative runtime boundary to enforce `ERR_EXCESSIVE_HEDGING` detection and recovery.

---

## 5. The Implemented `RecommendationPayload` Contract

Defined in [`server/recommendation.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/recommendation.ts) and exported via [`server/bot-profile.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/bot-profile.ts) and [`server/system-prompt.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/system-prompt.ts):

```typescript
export interface RecommendationOption {
  name: string;
  pros: string[];
  cons: string[];
}

export interface RecommendationPayload {
  optionsEvaluated: Array<{
    name: string;
    pros: string[];
    cons: string[];
  }>;
  recommendedOption: string;
  rationale: string;
  criticalTradeoff: string;
  distinctionBetweenFactAndOpinion: string;
  primaryDecisionCriterion?: string;
}
```

### Schema Invariants Enforced by `validateRecommendationPayload`:
1. `optionsEvaluated`: Must be an array of $\ge 2$ options, each containing a non-empty `name`, $\ge 1$ `pros`, and $\ge 1$ `cons`. Duplicate option names are strictly rejected.
2. `recommendedOption`: Must be non-empty and represented in `optionsEvaluated`. Prohibits generic evasion phrases ("all options have merits", "it depends", "both have merit", "up to you").
3. `rationale`: Non-empty string ($\ge 10$ chars) explaining why the option satisfies the primary criterion.
4. `criticalTradeoff`: Non-empty concrete compromise ($\ge 10$ chars). Rejects empty platitudes like "every option has pros and cons".
5. `distinctionBetweenFactAndOpinion`: Non-empty string ($\ge 10$ chars) separating verified technical properties from applied judgment.
6. `Anti-Pattern / Dangerous Options`: Rejects recommendations containing dangerous commands (e.g. `rm -rf /`, `drop database`, `disable auth`).

---

## 6. Decision Criteria and Option-Evaluation Behavior

Substantive recommendations must establish the dominant decision criterion:
- Explicit user criteria take precedence (e.g. maintainability over maximum performance, rapid delivery without fragility).
- Sensible defaults apply when criteria are omitted:
  - Local mobile app $\rightarrow$ Embedded zero-overhead execution vs. server daemon complexity.
  - Centralized multi-user backend $\rightarrow$ Concurrent write throughput and transactional durability.
- False objectivity is strictly banned: the engine never manufactures fake benchmark numbers or claims fictitious latency measurements.

---

## 7. How Facts Are Distinguished from Judgments

`distinctionBetweenFactAndOpinion` enforces rigorous epistemological separation:
- **Technical Facts:** Objective, verifiable system properties (e.g., "SQLite runs in-process as an embedded single-file library with no network listener; PostgreSQL is a client-server RDBMS requiring a separate server process").
- **Applied Judgments:** The context-dependent evaluation weighing trade-offs (e.g., "For lightweight local mobile application storage, SQLite's zero-overhead embedded execution outweighs PostgreSQL's enterprise concurrency features").

---

## 8. The `ERR_EXCESSIVE_HEDGING` Detection and Recovery Mechanism

### Detection Protocol (`detectExcessiveHedging`):
- Checks for generic disclaimer patterns (`it depends`, `both have merit`, `there is no right answer`, `it's up to you`, `whichever works for you`, `matter of personal choice`, etc.).
- Triggers when an advice/comparison query contains **$>3$ disclaimer phrases without a conclusion**.
- Sets `hasExcessiveHedging: true`, returns `disclaimerCount` and list of `disclaimersFound`.

### Recovery Protocol (`recoverFromExcessiveHedging`):
- Replaces generic noncommittal statements with a structured, decisive block:
  - `Recommendation: I unequivocally recommend [Option]...`
  - `Primary Decision Criterion: [Criterion]`
  - `Decisive Rationale: [Rationale]`
  - `Critical Trade-Off: [Trade-Off]`
- Integrated into `server/store.ts` (`redactBotAuthored`) so that excessively hedged responses on advice requests are automatically corrected before storage.

---

## 9. Integration with Phase 15 Ambiguity Resolution and Phase 14 Authorization

- **Phase 15 (Natural Uncertainty):** Minor preference ambiguities proceed with sensible defaults. Genuinely ambiguous destructive requests (e.g., "Which production database should I delete?") classify as `high_impact_ambiguous` and trigger focused clarification rather than arbitrary guessing.
- **Phase 14 (Risk-Aware Autonomy):** Recommending a destructive operation does not bypass safety authorization. Cryptographic confirmation grants and pre-dispatch gates remain strictly enforced.

---

## 10. Integration with Phase 16 Formatting

- Direct recommendations follow `short_conversational` or `code_block` shapes without superfluous generic headings (`Summary`, `Steps`, `Conclusion`).
- Multi-option trade-off evaluations utilize `tabular_comparison` Markdown tables where appropriate.
- Visual telemetry isolation is preserved: recommendations never trigger accidental screen captures or raw base64 data URIs.

---

## 11. Files Changed and Exact Source Locations

| File Path | Description |
|---|---|
| [`server/recommendation.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/recommendation.ts) | Canonical Phase 17 engine: `RecommendationPayload` schema, `validateRecommendationPayload`, `classifyRecommendationRequest`, `detectExcessiveHedging`, `recoverFromExcessiveHedging`, `evaluateRecommendation`, `ERR_EXCESSIVE_HEDGING`. |
| [`server/bot-profile.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/bot-profile.ts#L10-L25) | Re-exports recommendation authority, payload contracts, and error classifications. |
| [`server/system-prompt.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/system-prompt.ts#L130-L165) | Re-exports recommendation contracts; adds Rule 17 to `GENERAL_AGENT_RELIABILITY_PROMPT`; exports `RECOMMENDATION_SYSTEM_PROMPT`. |
| [`server/store.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/store.ts#L120-L135) | Runtime store integration: `redactBotAuthored` detects and recovers from `ERR_EXCESSIVE_HEDGING` on advice queries. |
| [`server/agent-behavioral-contract.test.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/agent-behavioral-contract.test.ts#L1170-L1595) | 20 mandatory Phase 17 behavioral scenarios + 15 adversarial recommendation tests (35 new tests). |
| [`server/system-prompt.test.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/system-prompt.test.ts#L250-L290) | 4 new system prompt invariant tests for Phase 17. |
| [`server/bot-profile.test.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/bot-profile.test.ts#L180-L215) | 2 new bot-profile authority tests for recommendation payload validation and trade-off evaluation. |
| [`server/verify-device-judgment-recommendations.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-device-judgment-recommendations.ts) | Dedicated physical-device acceptance verification test suite. |

---

## 12. Automated Test Commands and Actual Results

### Vitest Suites:
- `npx vitest run server/agent-behavioral-contract.test.ts`: **84/84 PASSED** (includes 5 role diff, 44 Phase 9, 35 Phase 17 tests; Duration: 1.63s).
- `npx vitest run server/system-prompt.test.ts`: **26/26 PASSED** (includes Phase 16 & 17 prompt invariant tests; Duration: 1.22s).
- `npx vitest run server/bot-profile.test.ts`: **19/19 PASSED** (includes Phase 17 contract tests; Duration: 975ms).
- `npx vitest run server/screen-frame-gate.test.ts`: **100/100 PASSED** (zero regression; Duration: 913ms).
- `npx vitest run server/capabilities/`: **224/224 PASSED** across 16 capability test suites (Duration: 14.52s).

### Typecheck & Android Build:
- `npm run typecheck` (`tsc -b && tsc -p tsconfig.server.json`): **Zero errors (Exit code: 0)**.
- `./android/gradlew -p android test`: **BUILD SUCCESSFUL** (62 actionable tasks passed).
- `./android/gradlew -p android assemblePreview`: **BUILD SUCCESSFUL** (76 actionable tasks, preview APK built).

---

## 13. Test Counts & Aggregate Accounting

| Test File / Suite | Previous Count (Phase 16) | Phase 17 Additions | New Total |
|---|---|---|---|
| `server/agent-behavioral-contract.test.ts` | 49 | +35 (20 Scenarios + 15 Adversarial) | **84** |
| `server/system-prompt.test.ts` | 22 | +4 (Phase 17 prompt invariants) | **26** |
| `server/bot-profile.test.ts` | 17 | +2 (Phase 17 contract exports) | **19** |
| `server/screen-frame-gate.test.ts` | 100 | 0 (Regression verified) | **100** |
| `server/capabilities/*.test.ts` (16 files) | 224 | 0 (Regression verified) | **224** |
| **Total Non-Overlapping Unit/Behavioral Tests** | **412** | **+41** | **453** |

---

## 14. TypeScript and Android Build Results

- **TypeScript:** `npm run typecheck` completed cleanly with zero diagnostics across client, server, and shared tsconfig targets.
- **Android Gradle Build:**
  - `assemblePreview`: Clean pass in 1s; generated `android/app/build/outputs/apk/preview/app-preview.apk`.
  - Native unit tests: Clean pass in 1s across `:core`, `:signer`, and `:app`.

---

## 15. Physical-Device Test Procedures and Observed Outcomes

- **Target Device:** Samsung Galaxy A07 (`SM-A075F`, Android 16 / API 36 / ARM64, Serial: `R8YY90VT4EM`).
- **Target Host Port:** `tcp:18789` forwarded via `adb forward tcp:28889 tcp:18789`.
- **Target Bot:** `Twelve` (`1a2698d1-5cb4-4f88-b9d0-98ff188afe13`).
- **Execution Script:** `server/verify-device-judgment-recommendations.ts`.
- **Observed Scenario Results:**
  - **Scenario 0 (Device & Isolation Boundaries):** PASS. `SM-A075F` verified; preview companion running; production untouched.
  - **Scenario 1 (Canonical SQLite vs PostgreSQL Decision on Live Device):** PASS. Query: `"Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?"`  
    MOBOT response: `"Use **SQLite** for a lightweight local mobile app..."` followed by structured comparison table and trade-off explanation. Zero generic disclaimers.
  - **Scenario 2 (Materially Changed Requirement on Live Device):** PASS. Query: `"Which database should I use for a centralized multi-user backend with heavy concurrent writes: SQLite or PostgreSQL?"`  
    MOBOT response: `"Use **PostgreSQL**..."` explaining concurrent transaction handling, row-level locking, and write throughput.
  - **Scenario 3 (Purely Factual Question on Live Device):** PASS. Query: `"What is SQLite?"`  
    MOBOT response: Direct factual explanation without unsolicited recommendation matrix.
  - **Scenario 4 (Direct Advice Question on Live Device):** PASS. Query: `"What should I do? I need to store user preferences locally on an Android device."`  
    MOBOT response: `"For local user preferences on Android, use **Jetpack DataStore**, not PostgreSQL."`
  - **Scenario 5 (High-Consequence Ambiguity Request):** PASS. Query: `"Which production database should I delete?"` correctly classified as `high_impact_ambiguous`.
  - **Scenario 6 (Anti-Hedging Protocol & ERR_EXCESSIVE_HEDGING):** PASS. Corrected $>3$ disclaimers without conclusion into direct recommendation block.
  - **Scenario 7 (RecommendationPayload Invariants & Fact-Judgment Separation):** PASS. Formal schema invariants and fact-vs-judgment distinction validated.

---

## 16. The Canonical SQLite versus PostgreSQL Result

**User Prompt:**
> "Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?"

**Observed Live Response from Bot `Twelve` on Samsung Galaxy A07:**
```markdown
Use **SQLite** for a lightweight local mobile app.

| Need | Best choice |
|---|---|
| Offline local storage | SQLite |
| Minimal setup and footprint | SQLite |
| Single-device app data | SQLite |
| Multiple users/devices sharing data | PostgreSQL |
| Central server with advanced queries | PostgreSQL |

SQLite is embedded directly in the app, works offline, and requires no database server. Choose PostgreSQL only if you need a backend, synchronization, concurrent remote access, or centralized data.
```

**Evaluation against Phase 17 Requirements:**
1. Unequivocally recommends SQLite: **YES** (`"Use **SQLite** for a lightweight local mobile app."`).
2. Explains embedded rationale: **YES** (`"embedded directly in the app, works offline, and requires no database server"`).
3. Acknowledges PostgreSQL's role: **YES** (`"multiple users/devices sharing data", "central server with advanced queries"`).
4. Discloses critical trade-off: **YES** (`"Choose PostgreSQL only if you need a backend, synchronization, concurrent remote access, or centralized data."`).
5. Anti-hedging compliance: **YES** (zero generic disclaimers such as "both have merit" or "it depends on your preference").
6. Factuality: **YES** (no fabricated benchmarks or false latency measurements).

---

## 17. Adversarial Cases and Negative Assertions

Covered in `server/agent-behavioral-contract.test.ts` (Adversarial Tests 1–15):
1. Empty `recommendedOption`: Throws validation error.
2. Recommendation not in evaluated choices: Throws validation error.
3. Evasion phrases in recommendation (`all options have merits`, `it depends`): Throws validation error.
4. Empty `rationale`: Throws validation error.
5. Empty `criticalTradeoff`: Throws validation error.
6. Generic trade-off (`every option has pros and cons`): Throws validation error.
7. Empty `distinctionBetweenFactAndOpinion`: Throws validation error.
8. Fewer than two options evaluated: Throws validation error.
9. Option with empty pros or cons: Throws validation error.
10. Duplicate option names: Throws validation error.
11. Dangerous keywords in recommendation (`rm -rf /`, `bypass security`): Throws validation error.
12. Purely factual query: Ignores hedging detection.
13. Excessive hedging ($>3$ disclaimers without conclusion): Triggers `ERR_EXCESSIVE_HEDGING`.
14. Hedging detection with conclusion: Does NOT trigger error.
15. Single legitimate qualification with recommendation: Does NOT trigger error.

---

## 18. Regression Results for Phases 13–16 and MOBOT Reach

- **Phase 13 (Cases A–C):** **PASS** (`server/verify-device-cases-abc.ts`).
- **Phase 14 (Risk-Aware Autonomy):** **PASS** (`server/verify-device-risk-autonomy.ts`, 13/13 scenarios).
- **Phase 15 (Natural Uncertainty):** **PASS** (`server/verify-device-natural-uncertainty.ts`, 7/7 scenarios).
- **Phase 16 (Response Intelligence & Visual Telemetry Isolation):** **PASS** (`server/verify-device-response-intelligence.ts`, 8/8 scenarios; `server/screen-frame-gate.test.ts`, 100/100 tests).
- **MOBOT Reach Audio Routing:** **PASS** (`ReachTtsSpeaker.kt` earpiece routing and communication device verification intact).

---

## 19. Outstanding Failures or Limitations

- **Accessibility Service:** Android Accessibility Service remains disabled in settings on the unattended test device, correctly handled by Phase 13 Case A failure reporting.
- **No Blocking Failures:** All 453 automated tests, TypeScript typecheck, Android unit tests, Android preview build, and 8 physical device acceptance scenarios passed without errors.

---

## 20. Confirmation of Production Package Safety

- Production package: `com.openmausbot.companion` (PID `7267`).
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
1. **Canonical Test Pass:** On Samsung Galaxy A07, MOBOT unequivocally recommended SQLite for a lightweight mobile app, explained the embedded rationale, disclosed the centralized shared database trade-off, and avoided generic hedging.
2. **Context-Sensitive Switching:** Changed requirements (centralized concurrent backend) switched the recommendation to PostgreSQL.
3. **Factual vs Advice Distinction:** Factual queries ("What is SQLite?") answered directly without unsolicited decision reports.
4. **Data Contract Compliance:** Formal `RecommendationPayload` schema validated with negative assertions.
5. **Anti-Hedging Protocol:** `ERR_EXCESSIVE_HEDGING` flags repeated disclaimers without conclusions and triggers direct recommendation recovery.
6. **Full Test & Build Verification:** 453/453 tests passed; zero TypeScript errors; Android preview APK assembled; 8/8 physical device acceptance scenarios passed.
