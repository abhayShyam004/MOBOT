# MOBOT — Phase 7 Integration-Acceptance Audit Report
## Autonomous Execution Loop Verification, Production Call-Path Analysis, and Master-Plan Alignment

**Date:** 2026-10-24  
**Audit Target:** Phase 7 ("Build the Real Agent Loop", `mobot_54_phases_prompt.md:533-589`)  
**Hardware Target:** Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`, Android 16 / API 36, ARM64)  
**Preview Package:** `com.openmausbot.companion.preview` (UID 10286, Host PID 18702, Port 18789 / Forwarded 28889)  
**Official Package:** `com.openmausbot.companion` (UID 10039, PID 25192 — **Untouched / Preserved**)  
**Signer Package:** `com.openmausbot.companion.signer` (UID 10280, PID 16942)  
**Git HEAD:** `b945d72756199f004624a980127fdec5c56be6ce` (Branch `main`)  

---

## 1. Executive Summary & Verdict

This independent audit evaluates the implementation and physical-device verification of **Official Roadmap Phase 7: Build the Real Agent Loop** against the authoritative requirements in `mobot_54_phases_prompt.md:533-589`.

### Audit Verdict: PARTIAL PASS (Conditional Pass with Disclosed Integration Boundary)

| Area | Evaluation | Verdict | Notes |
|---|---|---|---|
| **Data Contract (`ExecutionLoopState`)** | Schema strictly conforms to roadmap line 545 | **PASS** | Exported in `server/capabilities/orchestration.ts` and `server/index.ts` |
| **7-Phase State Machine Contract** | `understand -> plan -> act -> observe -> evaluate -> (act \| complete \| escalate)` | **PASS** | Hardened in Gate C with transition guards & concurrency locks |
| **Concrete Observation Invariant** | Every iteration records an observation before next step | **PASS** | Invariant verified in unit, behavioral, and device tests |
| **Iteration Bounds & Timeouts** | `maxTurns` (default: 15), throws `ExecutionLoopTimeoutError` | **PASS** | Clean timeout & budget exhaustion handling |
| **Adversarial & Fault Injection** | Hostile injection in tool output, capability failures, cancellations | **PASS** | 17/17 tests passing in `server/agent-loop.test.ts` |
| **Physical-Device Scenarios (Samsung Galaxy A07)** | 12 end-to-end device execution scenarios on preview host (PID 18702) | **PASS (Subsystem)** | Verified on live hardware via `server/verify-device-agent-loop.ts` |
| **Full User-Facing Chat Integration** | Wiring `POST /api/bots/:id/messages` to `AgentExecutionLoop` | **INTEGRATION GAP** | User chat currently uses provider adapter loops (`claudeAgent`, `openai-chat`) |
| **Autonomous Model Execution** | Live LLM inference during device scenarios | **DISCLOSED LIMITATION** | Device scenarios use scripted step/evaluation handlers, not live LLM API |
| **Official Application Safety** | Zero disturbance to production package `com.openmausbot.companion` | **PASS** | PID 25192 and PID 25252 remained alive and untouched |

**Summary Justification:**
The core algorithmic requirements of Phase 7—formal data contract, 7-phase state machine, concrete observation invariant, anti-pattern guards, timeout bounding, and bot isolation—are fully implemented, hardened, and verified on the Samsung Galaxy A07 hardware. However, a critical integration reality was discovered: **the primary user-facing chat endpoint (`POST /api/bots/:id/messages`) does not route turns through `AgentExecutionLoop`**. It continues to utilize provider adapter loops to preserve streaming and interactive steering. `AgentExecutionLoop` currently serves as the multi-step capability orchestrator. This distinction is documented and analyzed below for resolution in subsequent roadmap phases.

---

## 2. Authoritative Scope & Master Roadmap Alignment

The authoritative requirements for Phase 7 are defined in `mobot_54_phases_prompt.md`, lines 533–589:

### 2.1 Formal Data Contract Requirements (Lines 544–555)
```typescript
export interface ExecutionLoopState {
  goalId: string;
  turnNumber: number;
  maxTurns: number;
  phase: "understand" | "plan" | "act" | "observe" | "evaluate" | "complete" | "escalate";
  accumulatedObservations: Array<{
    turn: number;
    action: string;
    resultSummary: string;
    success: boolean;
  }>;
  terminationReason?: "goal_achieved" | "unrecoverable_failure" | "user_intervention_required" | "budget_exhausted";
}
```

### 2.2 Seven-Phase Lifecycle Requirements (Lines 535–542)
1. **Understand**: Parse the user's objective and constraints.
2. **Plan**: Formulate next action step.
3. **Act**: Dispatch action through capability boundary with parameter validation.
4. **Observe**: Capture real execution output, format, and errors.
5. **Evaluate**: Determine whether the goal is achieved, progress was made, or replanning is required.
6. **Complete**: Settle successfully with grounded user response (`goal_achieved`).
7. **Escalate**: Terminate cleanly when blocked or unrecoverable (`unrecoverable_failure` or `user_intervention_required`).

### 2.3 Master Plan Prohibitions & Anti-Patterns (Lines 557–570)
- **Anti-Pattern 1**: Blindly terminating execution after the first tool call returns, assuming single-turn settlement is sufficient for multi-step objectives.
- **Anti-Pattern 2**: Treating raw HTTP 200 or generic tool acknowledgment as proof that the underlying user objective was satisfied.
- **Bound Requirement**: Bounded execution with strict iteration limit (default: 15 turns) throwing `ERR_EXECUTION_LOOP_TIMEOUT`.

---

## 3. Production Call-Path Trace

An end-to-end trace of a normal user message was performed through the codebase to map every step of the real execution pipeline:

```mermaid
flowchart TD
    User([User Client]) -->|HTTP POST /api/bots/:id/messages| Router[server/index.ts:17343]
    Router -->|sendSequencer.run| Sequencer[server/index.ts:5975]
    Sequencer -->|startOrQueueDirectMessage| TurnAdmission[server/index.ts:6323 startTurn]
    TurnAdmission -->|assembleDynamicContextFrame| Context[server/turn-context.ts]
    Context -->|buildSystemPrompt| SysPrompt[server/system-prompt.ts]
    TurnAdmission -->|guardTurnDispatch| Adapter[instance.adapter.sendTurn]
    Adapter -->|Provider Loop| Engine[openai-chat.ts / claude.ts / codex]
    Engine -->|Tool Dispatch| ToolSurface[shared/tool-surface.ts]
    ToolSurface -->|Execute Tool| ToolExec[server/capabilities & android-browser]
    ToolExec -->|Result| Engine
    Engine -->|Runtime Events| EventBus[server/index.ts:5119 onEvent]
    EventBus -->|turn.completed| Settlement[server/store.ts persistMessage]
    Settlement -->|Final Response| User
```

### Detailed Trace by File and Function:
1. **Request Entry**: `POST /api/bots/:id/messages` in [server/index.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L17343).
   - Validates session authorization and bot existence.
   - Forwards request payload to message sequencer: `sendSequencer.run(...)`.
2. **Turn Admission & Queueing**: `startOrQueueDirectMessage()` in [server/index.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L5975).
   - Checks bot turn lock and queue depth.
   - Calls `startTurn(...)` in [server/index.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L6323).
3. **Context Assembly**:
   - Assembles turn context in [server/turn-context.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/turn-context.ts#L150).
   - Builds stable and volatile system prompt frames in [server/system-prompt.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/system-prompt.ts#L80).
   - Injects canonical Merkle-root memory context verified under Phase 16.
4. **Turn Dispatch Guarding**:
   - Calls `guardTurnDispatch(...)` in [server/index.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L7450).
   - Hands off execution to `instance.adapter.sendTurn(...)`.
5. **Model Invocation & Tool Handling (Provider Adapters)**:
   - For OpenAI-compatible models: [server/adapters/openai-chat.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/adapters/openai-chat.ts#L440-L560) manages model streaming and tool invocation.
   - For Claude: [server/adapters/claude.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/adapters/claude.ts#L310-L420) manages multi-turn tool loops.
   - Tools are validated against [shared/tool-surface.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/shared/tool-surface.ts).
6. **Observation Recording & Event Folding**:
   - Adapter emits event callbacks (`item.started`, `item.completed`, `turn.completed`).
   - Handled by runtime event listener in [server/index.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L5119).
7. **Settlement**:
   - Message persisted to SQLite via [server/store.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/store.ts).
   - Response returned to client over HTTP / WebSocket stream.

---

## 4. Ordinary User-Facing Request Path vs. `AgentExecutionLoop`

### 4.1 Where `AgentExecutionLoop` is Instantiated
A comprehensive codebase grep for `AgentExecutionLoop` reveals the following locations:
1. **Definition**: [server/capabilities/orchestration.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/orchestration.ts#L258-L450).
2. **Factory Method**: `CapabilityOrchestrator.createExecutionLoop(options)` in [server/capabilities/orchestration.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/orchestration.ts#L250).
3. **Re-export**: [server/index.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L53).
4. **Unit & Behavioral Tests**: [server/agent-loop.test.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/agent-loop.test.ts#L2-L25).
5. **Physical Device Verification Harness**: [server/verify-device-agent-loop.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-device-agent-loop.ts#L5-L10).

### 4.2 Integration Gap Analysis
The normal user chat path (`POST /api/bots/:id/messages` -> `startTurn()`) **does NOT instantiate or delegate to `AgentExecutionLoop`**. 

**Why this was not wired into `startTurn()` during Phase 7:**
- `startTurn()` delegates directly to LLM provider adapters (`openai-chat.ts`, `claude.ts`, `grokAgent.ts`, `codex.ts`). Each adapter implements its own engine-level loop for handling tool calls and chunked streaming to frontend WebSockets.
- Forcibly replacing `adapter.sendTurn(...)` in `startTurn()` with `AgentExecutionLoop` without an engine-to-loop translation bridge would break:
  1. Real-time WebSocket token streaming to the UI.
  2. Interactive user turn steering and abort handling tested in `server/steer-e2e.test.ts`.
  3. Interactive terminal PTY sessions (`ombpty`).
- Therefore, `AgentExecutionLoop` was built as the formal capability orchestration engine.

**Recommendation for Future Phases:**
Phase 8 ("Persist Original Goal", `mobot_54_phases_prompt.md:592-640`) requires persisting goals, plans, and evaluation states to SQLite across restarts. The proper architectural integration point is for Phase 8 to wrap high-level bot execution tasks using `AgentExecutionLoop` backed by SQLite goal records, while keeping driver-level streaming within the provider adapters.

---

## 5. Scenario-by-Scenario Audit of the 12 Physical-Device Tests

The 12 physical-device scenarios in [server/verify-device-agent-loop.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-device-agent-loop.ts) were audited line-by-line to categorize what was tested against real device capabilities versus simulated/scripted test policies:

| Scenario | Name | Test Mechanism | Real Hardware / Device Capability Invoked? | Live Model Used? | Verdict |
|---|---|---|---|---|---|
| **1** | Task requiring no tool | Harness logic | No (in-memory step handler returning direct answer) | No (scripted) | **PASS (Harness)** |
| **2** | Task requiring one authorized tool | Device capability | **YES**: Executed `device.files.list` against Galaxy A07 filesystem | No (scripted) | **PASS (Device)** |
| **3** | Sequential multi-step (5+ actions) | Multi-step loop | No (iterated through fixed array of 5 action steps) | No (scripted) | **PASS (Harness)** |
| **4** | Result-determined subsequent action | State-dependent plan | No (Step 1 output `"ARM64"` selected Step 2 action `"optimize_arm64"`) | No (scripted) | **PASS (Harness)** |
| **5** | Tool failure reported honestly | Fault injection | No (simulated sensor timeout; verified honest escalation) | No (scripted) | **PASS (Harness)** |
| **6** | Unauthorized action rejected | Capability registry | **YES**: `DeviceCapabilityRegistry` rejected unknown capability on device | No (scripted) | **PASS (Device)** |
| **7** | Iteration limit bounds runaway execution | Timeout bounding | No (verified `maxTurns: 3` timeout and `budget_exhausted` rejection) | No (scripted) | **PASS (Harness)** |
| **8** | Cancellation via AbortSignal | Interruption check | No (`AbortController` triggered mid-execution, transitioned to intervention) | No (scripted) | **PASS (Harness)** |
| **9** | Grounded response | State reflection | No (final response grounded in genuine computed execution state) | No (scripted) | **PASS (Harness)** |
| **10** | Bot and turn isolation | Isolation barrier | No (two distinct `AgentExecutionLoop` instances verified state separation) | No (scripted) | **PASS (Harness)** |
| **11** | Host responsiveness & process stability | Host HTTP API | **YES**: Polled live preview host `GET /api/health` on Galaxy A07; PID 18702 unchanged | No (N/A) | **PASS (Device)** |
| **12** | Observability coverage | Telemetry ring | No (verified all 8 loop event types captured in `ObservabilityBus`) | No (scripted) | **PASS (Harness)** |

### Critical Finding on Model Autonomy:
None of the 12 device scenarios invoked a remote LLM (such as OpenAI or Anthropic). All step actions and evaluation decisions were driven by deterministic JavaScript callbacks (`stepHandler` and `evaluationHandler`). This validates the **mechanical correctness of the state machine, capability boundaries, timeout handling, and telemetry on Android**, but does **not** prove that an autonomous LLM will make sound evaluation decisions without prompting guidance.

---

## 6. State-Machine and Termination-Contract Findings (Gate C Hardening)

During Gate C of this audit, strict state transition validation and concurrency protections were added to [server/capabilities/orchestration.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/orchestration.ts) to eliminate theoretical race conditions and boundary vulnerabilities:

```mermaid
stateDiagram-v2
    [*] --> understand: Constructor (turn=0)
    understand --> plan: advanceToPlan()
    plan --> act: executeAction()
    act --> observe: Observation Recorded
    observe --> evaluate: evaluateProgress()
    evaluate --> act: phase == "act" (Loop continues)
    evaluate --> complete: phase == "complete" (goal_achieved)
    evaluate --> escalate: phase == "escalate" (blocker/timeout)
    complete --> [*]
    escalate --> [*]
```

### Targeted Gate C Improvements Made:
1. **Transition Validation**:
   - `advanceToPlan()`: Restriced to `understand`, `evaluate`, or `plan`. Direct calls from `act` or `observe` throw descriptive errors.
   - `executeAction()`: Restricted to `plan` or `act`. Calling `executeAction()` directly from `understand` or `observe` throws `Invalid state transition: cannot execute action from phase "<current>"`.
   - `evaluateProgress()`: Restricted to `observe` or `evaluate`. Calling `evaluateProgress()` before an observation is recorded throws `Invalid state transition: cannot evaluate progress from phase "<current>"`.
   - Evaluation return phase must be strictly one of `"act"`, `"complete"`, or `"escalate"`.
2. **Concurrency Mutex**:
   - Added an `inFlight` boolean lock to `AgentExecutionLoop`.
   - Any concurrent execution attempt (e.g., overlapping async calls to `executeAction()` or `step()`) immediately throws `Concurrent execution rejected: an action or step is already in flight`.
3. **Turn Budget Boundary (`maxTurns: 0`)**:
   - Corrected constructor to permit `maxTurns: 0` without resetting to default 15.
   - When `turnNumber >= maxTurns` before action dispatch, execution immediately transitions to `phase: "escalate"` with `terminationReason: "budget_exhausted"` and throws `ExecutionLoopTimeoutError`.

---

## 7. Security and Regression Test Results

### 7.1 Vitest Execution Suites
All unit, behavioral, and regression suites were executed:

```bash
# Agent Execution Loop Suite (17 tests)
npx vitest run server/agent-loop.test.ts
✓ server/agent-loop.test.ts (17 tests) 78ms

# Capability Orchestration Suite (5 tests)
npx vitest run server/capabilities/orchestration.test.ts
✓ server/capabilities/orchestration.test.ts (5 tests) 32ms

# Turn Watchdog Suite (5 tests)
npx vitest run server/turn-watchdog.test.ts
✓ server/turn-watchdog.test.ts (5 tests) 30ms

# Turn Dispatch Guard Suite (16 tests)
npx vitest run server/turn-dispatch-guard.test.ts
✓ server/turn-dispatch-guard.test.ts (16 tests) 58ms

# Specialist Swarm Suite (2 tests)
npx vitest run server/specialist-swarm.test.ts
✓ server/specialist-swarm.test.ts (2 tests) 28ms
```
**Total Vitest Tests Passed:** 45 / 45.

### 7.2 TypeScript Static Typecheck
```bash
npx tsc -p tsconfig.server.json --noEmit
# Exit code: 0 (Zero errors)
```

### 7.3 Codebase Linter
```bash
npm run lint
> oxlint --deny-warnings .
Found 0 warnings and 0 errors.
Finished in 258ms on 1585 files using 12 threads.
```

---

## 8. Runtime Artifact and Package Verification

Physical process verification was executed on the connected Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`, Android 16):

```bash
adb shell "ps -ef | grep openmausbot"
```

| User | PID | PPID | Command / Package | Role | Audit Status |
|---|---|---|---|---|---|
| `u0_a39` | 25192 | 1137 | `com.openmausbot.companion` | **Official Application** | **Completely Untouched** (Running since 01:07) |
| `u0_a39` | 25252 | 25192 | `libnode_host.so .../index-android.js` | Official Node Host | **Completely Untouched** (Running since 01:07) |
| `u0_a280` | 16942 | 1137 | `com.openmausbot.companion.signer` | Memory Signer App | **Untouched** (Running since 14:08) |
| `u0_a286` | 18617 | 1137 | `com.openmausbot.companion.preview` | Preview Application | Active Test Harness (Running since 14:11) |
| `u0_a286` | 18702 | 18617 | `libnode_host.so .../index-android.js` | Preview Node Host | Active Device Target (Port 18789 / 28889) |

Live host health was verified during and after all 12 device verification scenarios:
```json
{
  "app": "openmausbot",
  "pid": 18702,
  "port": 18789,
  "static": false
}
```
Host PID 18702 remained completely stable with zero restarts or memory crashes.

---

## 9. Summary of Targeted Code Changes

All code changes were targeted, surgical, and accompanied by regression coverage:

1. **[server/capabilities/orchestration.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/capabilities/orchestration.ts)**:
   - Added `inFlight` concurrency guard to `AgentExecutionLoop`.
   - Added phase validation guards to `advanceToPlan()`, `executeAction()`, and `evaluateProgress()`.
   - Handled `maxTurns: 0` boundary and strict turn-limit enforcement.
2. **[server/agent-loop.test.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/agent-loop.test.ts)**:
   - Added Section 6 with 4 new regression tests covering boundary conditions, invalid phase transitions, exact turn limits, and concurrency rejection.
   - Cleaned unused type imports and added `lifecycleBehavior: "stateless"` to mock capability.
3. **[server/verify-device-agent-loop.ts](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-device-agent-loop.ts)**:
   - Removed unused type imports.
   - Added safe type assertions for `healthData` and `endHealthData` JSON responses.

---

## 10. Unresolved Issues and Severity Matrix

| Issue ID | Description | Severity | Impact | Mitigation / Recommendation |
|---|---|---|---|---|
| **ISSUE-P7-01** | `AgentExecutionLoop` is not integrated into `POST /api/bots/:id/messages` (`startTurn()`). | **Medium** | Ordinary chat messages do not execute under the 7-phase state machine or `ExecutionLoopState` schema. | Address during **Phase 8** ("Persist Original Goal") by attaching persistent goal records to conversational turns. |
| **ISSUE-P7-02** | Device verification scenarios use scripted step/evaluation policies rather than live LLM inference. | **Low** | Tests prove state machine, timeout bounds, and capability dispatch on Android, but do not evaluate model reasoning. | Addressed in later roadmap phases when autonomous goal planning is exercised end-to-end against live providers. |

---

## 11. Final Recommendation and Next Steps

1. **Phase 7 Acceptance**: Accepted with the documented partial integration boundary. The core state-machine contract, bounds, anti-pattern defenses, and Android capability mechanisms are solid and verified on real hardware.
2. **Preservation Confirmation**: The official application (`com.openmausbot.companion`, UID 10039, PID 25192) remains preserved and untouched.
3. **Ready for Official Roadmap Phase 8**: Proceed to **Phase 8: Persist Original Goal** (`mobot_54_phases_prompt.md:592-640`), which will implement persistent goal state, plan progression, and evaluation journaling in SQLite.
