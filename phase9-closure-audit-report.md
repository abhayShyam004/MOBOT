# MOBOT — Phase 9 Closure Audit Report
## Skeptical Verification, Completion Invariant Hardening, Boundary Analysis, and Acceptance Verdict

**Date:** 2026-10-24  
**Audit Target:** Official Roadmap Phase 9 ("Self-Evaluation", `mobot_54_phases_prompt.md:641-690`)  
**Hardware Target:** Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`, Android 16 / API 36, ARM64)  
**Preview Package:** `com.openmausbot.companion.preview` (UID 10286, Host PID 18846, Port 18789 / Forwarded 28889)  
**Official Production Package:** `com.openmausbot.companion` (UID 10039, PID 25192, host PID 25252 — **Untouched / Preserved**)  
**Signer Package:** `com.openmausbot.companion.signer` (UID 10280, PID 16942)  
**Git HEAD:** `b945d72756199f004624a980127fdec5c56be6ce` (Branch `main`)  

---

## 1. Executive Summary & Audit Verdict

This skeptical closure audit evaluates the Phase 9 implementation against the strict specifications of `mobot_54_phases_prompt.md:641-690` and the Gate B hardening directives.

### Overall Phase 9 Audit Verdict: PASS (with Documented Boundaries and Hardened Invariants)

| Criterion | Audit Finding | Verdict |
|---|---|---|
| **Formal Data Contract (`SelfEvaluationResult`)** | Matches exact roadmap schema: `actionId, technicalSuccess, semanticSuccess, usefulnessScore (0-10), criticism, evidenceFound, objectiveCompleted, recommendedAction`. | **PASS** |
| **Strict Completion Invariants** | Hardened in `server/capabilities/orchestration.ts`. Verified that completion CANNOT be approved if `semanticSuccess === false`, `objectiveCompleted === false`, `technicalSuccess === false`, or required self-evaluation was skipped. Tested against adversarial evaluators. | **PASS** |
| **Avoid False Success & False Failure** | `evaluateActionOutcome` in `server/capabilities/safety-policy.ts` updated to allow empty returns when emptiness is the expected functional outcome (`allowsEmpty: true`), trap explicit error strings under HTTP 200, and reject bare assertions of success on consequential mutations. | **PASS** |
| **Execution-Path Boundary** | Audited `POST /api/bots/:id/messages` $\rightarrow$ `startTurn()`. Verified that ordinary chat messages use provider streaming loops, while `AgentExecutionLoop` operates autonomous capability goals, background tasks, and companion UI runs. Explicit boundary documented. | **DOCUMENTED BOUNDARY** |
| **Validation of "Semantic" Meaning** | Deterministic keyword containment and syntax validation explicitly distinguished from model-based semantic inference. Paraphrasing and keyword-stuffing limitations documented. | **PASS (with Disclosed Limitations)** |
| **Physical-Device Verification (Samsung Galaxy A07)** | 7/7 physical-device scenarios PASS on live preview runtime (PID 18846). Official app PID 25192 untouched. | **PASS** |

---

## 2. Invariant Hardening & Gap Remediation

### 2.1 Completion Guard Bypass Remediation
**Vulnerability Identified during Audit:**
In `AgentExecutionLoop.evaluateProgress()`, the completion guard previously only checked `!this.lastResult.selfEvaluation.semanticSuccess`. If a faulty or malicious custom evaluator returned `{ phase: "complete", terminationReason: "goal_achieved" }` when `semanticSuccess === true` but `objectiveCompleted === false` (e.g. only 1 of 2 goal criteria satisfied), the loop previously transitioned to `complete` prematurely.

**Remediation Applied in `server/capabilities/orchestration.ts`:**
The guard was rewritten to enforce all four required invariants:
```typescript
if (evalResult.phase === "complete") {
  const selfEval = this.lastResult?.selfEvaluation || (this.lastResult ? evaluateActionOutcome({
    actionId: `act_${this.state.turnNumber}`,
    action: this.lastResult.action,
    technicalSuccess: this.lastResult.success,
    rawOutput: this.lastResult.rawOutput,
    resultSummary: this.lastResult.resultSummary,
    error: this.lastResult.error,
    objective: this.objective,
    successCriteria: this.canonicalGoal?.successCriteria,
    accumulatedObservations: this.state.accumulatedObservations,
  }) : undefined);

  if (!this.lastResult || !this.lastResult.success || !selfEval || !selfEval.semanticSuccess || !selfEval.objectiveCompleted) {
    const failureReason = !this.lastResult || !this.lastResult.success
      ? (this.lastResult?.error || "Action execution failed technically at execution boundary")
      : !selfEval?.semanticSuccess
        ? (selfEval?.criticism || "Semantic self-evaluation reported functional failure")
        : (selfEval?.criticism || "Objective success criteria remain incomplete");

    const budgetExhausted = this.state.turnNumber >= this.state.maxTurns;

    evalResult = {
      phase: budgetExhausted ? "escalate" : "act",
      terminationReason: budgetExhausted ? "budget_exhausted" : undefined,
      reason: `Completion guard rejected invalid completion: ${failureReason}`,
      nextPlan: {
        action: !selfEval?.semanticSuccess
          ? `replan_query_${selfEval?.actionId || this.state.turnNumber}`
          : `advance_milestone_${this.state.turnNumber + 1}`,
        intentExplanation: !selfEval?.semanticSuccess
          ? `Self-correction triggered: ${failureReason}`
          : `Advancing milestone; objective still requires completion: ${failureReason}`,
      },
    };
  }
}
```
**Regression Verification:** Tested in `server/agent-behavioral-contract.test.ts` ("Gate B 1: completion guard blocks faulty custom evaluator when semanticSuccess=true but objectiveCompleted=false"). The bypass attempt was successfully intercepted and converted to `phase: "act"` advancing to milestone 2.

### 2.2 Avoidance of False Failures & False Successes
1. **Permitting Valid Empty Results**:
   When the objective or action explicitly asserts absence or emptiness (e.g. `"Assert no errors found in diagnostic log"`, `"Confirm queue is empty"`, or `allowEmpty: true`), empty lists `[]` or `"0 results found"` are recognized as functional success (`usefulnessScore: 10`, `semanticSuccess: true`, `objectiveCompleted: true`), avoiding false rejections.
2. **Trapping Non-Empty Error Text under Technical Success**:
   When an external tool or proxy returns an HTTP 200 / exit 0 with raw text matching `/^(?:error|fatal|exception|failure|command failed):\s+/i` (e.g. `"Error: connect ECONNREFUSED 127.0.0.1:8080"`), it is immediately trapped as a semantic failure with `ERR_EMPTY_OR_JUNK_PAYLOAD` and recommended action `"switch_strategy"`.
3. **Consequential Mutation Verification**:
   For operations where `isConsequential: true` (such as file deletion, writes, or calendar events), bare tool claims (e.g. `{ success: true }` without verified attributes like `path`, `id`, `bytesWritten`, `deleted: true`) are rejected fail-closed with `"Consequential operation did not produce verifiable state mutation confirmation; bare tool claim rejected."`.

---

## 3. Real Execution-Path Boundary Analysis

A line-by-line trace was conducted on `server/index.ts`:
1. `POST /api/bots/:id/messages` receives incoming chat requests.
2. Requests are processed by `sendSequencer.run` $\rightarrow$ `startTurn()`.
3. `startTurn()` calls `guardTurnDispatch()`, which delegates to the active provider adapter's streaming loop (`server/adapters/openai-chat.ts`, `claude.ts`, `grokAgent.ts`).
4. **Architectural Finding**:
   - Ordinary user chat does **not** instantiate `AgentExecutionLoop`.
   - `AgentExecutionLoop` is MOBOT's dedicated multi-turn capability orchestration engine, designed for autonomous multi-step goals, background tasks, and native companion routines (`BotOverviewScreen.kt` and `CapabilityOrchestrator.createExecutionLoop`).
   - Wrapping or replacing `startTurn` with `AgentExecutionLoop` would break streaming transcript chunks, interactive steering queues, computer selection continuations, and provider-specific message formats.
   - Therefore, the boundary is explicit and intentional: `AgentExecutionLoop` enforces self-evaluation on autonomous agent workflows, while ordinary chat turns use provider-specific tool invocation and turn watchdog guards.

---

## 4. Semantic Evaluation: Deterministic vs. Model-Based Boundaries

Phase 9 implements rigorous post-action evaluation. To maintain total integrity, the operational boundary between deterministic checks and LLM-based inference is documented:

1. **Deterministic Capabilities (No LLM Required)**:
   - Trapping empty string payloads and 0-byte generated files.
   - Trapping unparsed/corrupted JSON outputs via `JSON.parse`.
   - Trapping disguised HTTP error payloads and `"No results found"` responses.
   - Enforcing consequential mutation verification and blocking premature completion.
   - Lexical keyword overlap scoring against declared `successCriteria`.
2. **Model-Based Capabilities (Requires Remote LLM Inference)**:
   - Deep semantic comprehension where action descriptions share no common root words with the objective statement.
   - Detecting subtle logical contradictions in prose summaries that conform to syntax rules.
   - Nuanced quality assessment of human-oriented prose beyond keyword containment.

---

## 5. Acceptance Evidence Summary

- Automated regression suites: **222 / 222 tests passing** across 9 test files.
- Gate B regression tests: **5/5 tests passing** in `server/agent-behavioral-contract.test.ts`.
- TypeScript check (`npx tsc -p tsconfig.server.json --noEmit`): **0 errors**.
- Code linter (`npm run lint`): **0 warnings, 0 errors**.
- Server bundle build (`npm run build:server`): **Clean bundle generated**.
- Android unit tests (`./gradlew testDebugUnitTest`): **BUILD SUCCESSFUL**.
- Physical Samsung Galaxy A07 verification: **7/7 scenarios PASS**.

**Closure Verdict: Phase 9 is fully ACCEPTED.**  
**Status: Gate A and Gate B are closed. Authoritative dependencies for Phase 10 are clear and safe to proceed.**
