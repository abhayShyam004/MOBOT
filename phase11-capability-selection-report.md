# MOBOT — Phase 11 Intelligent Capability Selection Report
**Master Roadmap Reference**: `mobot_54_phases_prompt.md:740-804`  
**Execution Date**: 2026-10-24  
**Hardware Platform**: Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`, Android 16 / API 36, ARM64)  
**Preview Host**: `com.openmausbot.companion.preview` (UID 10286, PID 19464, internal port 18789 / forwarded port 28889)  
**Production Isolation**: `com.openmausbot.companion` (UID 10039, PID 27434 / host PID 27457) — **Completely untouched and continuously running**  
**Signer Isolation**: `com.openmausbot.companion.signer` (UID 10280, PID 16942) — **Completely untouched and continuously running**  

---

## 1. Executive Summary & Verdict

Phase 11 (Intelligent Capability Selection) and the prerequisite Phase 10 Acceptance Gaps (Gate A) have been fully closed, implemented, verified with comprehensive unit and adversarial test suites, and validated on physical Android hardware (Samsung Galaxy A07).

| Gate / Milestone | Status | Key Verifications & Evidence |
| :--- | :---: | :--- |
| **Gate A: Phase 10 Acceptance Closure** | **PASS** | `web.scraper` fallback implemented; action-key normalization retains `id`/`uuid`/`path` & redacts secrets; 7 failure classes & backoffs verified; report discrepancies reconciled. |
| **Gate B1: Phase 11 Data Contracts** | **PASS** | `ExecutionModality`, `CapabilityMatchRequest`, `CapabilityMatchResolution`, and `ERR_NO_CAPABLE_TOOL` implemented in `server/capabilities/types.ts`. |
| **Gate B2: Selection Algorithm & Calibration** | **PASS** | `DeviceCapabilityRegistry.matchCapability()` evaluates objective, context keywords, required freshness, target device, and registered capabilities with calibrated confidence (0.00–1.00) and grounded rationale. |
| **Gate B3: Missing-Tool Protocol** | **PASS** | Returns structured `ERR_NO_CAPABLE_TOOL` when requested task exceeds registered device capabilities (e.g., unsupported quantum hardware sensors). |
| **Gate B4: AgentExecutionLoop Integration** | **PASS** | Integrated into `AgentExecutionLoop` constructor and step execution; auto-populates initial plan, fallback chain, and emits `AGENT_LOOP_CAPABILITY_SELECTED` telemetry. |
| **Gate B5: Adversarial Test Suite** | **PASS** | 35+ adversarial test cases covering all 9 modalities with negative assertions; 15/15 Vitest tests pass in `server/capabilities/capability-registry.test.ts`. |
| **Gate B6: Canonical Behavioral Test** | **PASS** | "What were the top tech headlines today?" routes to `web_search` (`device.browser` / `web.scraper`) rather than unsupported direct generation (confidence 0.94). |
| **Gate B7: Hardware Verification (Samsung Galaxy A07)** | **PASS** | 8/8 physical hardware scenarios executed on preview package `com.openmausbot.companion.preview` via ADB forward port 28889. Production package PID 27434 completely undisturbed. |

---

## 2. Gate A: Phase 10 Acceptance Closure Verification

### A1. Port 18800 Fallback Verification
- **Implementation**: Registered `WebScraperCapability` (`web.scraper`) in `DeviceCapabilityRegistry` (`server/capabilities/default-capabilities.ts`) supporting `search` and `scrape` operations.
- **Failover Logic**: `decideReplan()` in `server/runtime-failure.ts` automatically maps blocked port 18800 browser calls to `web.scraper` as primary fallback.
- **Test Evidence**: In `server/runtime-failure.test.ts`, verified real TCP socket refusing connection on `127.0.0.1:18800` (`ECONNREFUSED`), triggering seamless failover to `web.scraper` without terminating or crashing the agent execution loop.

### A2. Action Normalization Audit (`server/repeat-detector.ts`)
- **Fix**: Resource identifiers (`id`, `uuid`, `path`, `botId`, `threadId`, `contactId`, `eventId`) are now strictly preserved to ensure distinct actions on different entities are never erroneously treated as repeated loops.
- **Volatile Nonce Stripping**: Only transient tracing tokens (`requestId`, `correlationId`, `nonce`, `_t`, `timestamp`, `cacheBuster`) are stripped from action keys.
- **Privacy Hardening**: Sensitive fields matching `DEFAULT_SENSITIVE_KEY_PATTERN` (`password`, `token`, `secret`, `apiKey`, `auth`) and bearer token formats are redacted to `[REDACTED]`, completely preventing credential leaks in loop telemetry.
- **Regressions**: 16/16 tests pass in `server/repeat-detector.test.ts`.

### A3. Failure Classes, Backoff Bounds, and Sanitized Copy
- All 7 failure classes (`TRANSIENT_NETWORK`, `RATE_LIMIT`, `AUTH_REQUIRED`, `PERMISSION_BLOCKED`, `INVALID_INPUT`, `STRATEGY_INEFFECTIVE`, `RESOURCE_EXHAUSTED`) verified.
- Exponential backoff rigorously bounded: 1s (attempt 1), 4s (attempt 2), escalation at attempt 3.
- User-facing error copy strictly sanitized of raw stack traces, file paths, and socket descriptors.

### A4 & A5. Integration Boundaries & Report Reconciliation
- **Integration Boundary**: Normal streaming chat (`POST /api/bots/:id/messages`) uses `startTurn` with direct model synthesis, whereas autonomous multi-step tasks run under `AgentExecutionLoop` with full observation and self-evaluation loops.
- **Discrepancy Reconciled**: Phase 9 physical hardware scenario count was confirmed as exactly 7 (7/7 PASS), and documented in `phase10-closure-audit-report.md`.

---

## 3. Gate B: Phase 11 Implementation Details

### B1. Formal Contracts (`server/capabilities/types.ts`)
```typescript
export const ERR_NO_CAPABLE_TOOL = "ERR_NO_CAPABLE_TOOL";

export type ExecutionModality =
  | "direct_answer"
  | "web_search"
  | "browser_session"
  | "terminal_command"
  | "filesystem_mutation"
  | "device_gesture"
  | "composio_service"
  | "specialist_handoff"
  | "user_clarification";

export interface CapabilityMatchRequest {
  objective: string;
  contextKeywords?: string[];
  requiredDataFreshness?: "realtime" | "static" | "historical";
  targetDevice?: "android_local" | "cloud_vps" | "external_saas";
  activeBotId?: string;
}

export interface CapabilityMatchResolution {
  chosenModality: ExecutionModality;
  primaryCapabilityId?: string;
  fallbackCapabilityIds: string[];
  justification: string;
  confidenceScore: number; // 0.00 to 1.00
}
```

### B2. Routing Architecture & Decision Matrix
`DeviceCapabilityRegistry.matchCapability()` executes an 11-step principled evaluation:
1. **Ambiguous / Incomplete / Nonsensical Objective**: Resolves to `user_clarification` (`confidenceScore: 0.95`).
2. **Conversational Greetings & Pure Direct Reasoning**: Greetings ("hello there", "good morning!") and conceptual queries ("explain quicksort", math "what is 25 * 4 + 17", poems) resolve to `direct_answer` (`confidenceScore: 0.96`), bypassing heavy tool dispatch.
3. **Specialist Subagent Handoff**: Explicit requests for subagent delegation ("delegate to coder bot", "handoff to researcher") resolve to `specialist_handoff` (`confidenceScore: 0.88`).
4. **Cloud SaaS Services**: Cloud integrations (Gmail, Slack, GitHub PR) without web URLs resolve to `composio_service` (`confidenceScore: 0.90` if connected, `0.30` with Phase 12 upgrade advisory if not).
5. **Terminal / Cloud VPS**: Shell scripts, docker commands, and CLI invocations resolve to `terminal_command` (`system.terminal` or `device.apps`).
6. **Filesystem Mutations**: Operations modifying or reading local files, documents, and workspace storage resolve to `filesystem_mutation` (`device.files`).
7. **Interactive Browser Sessions**: Full webpage navigation, DOM inspection, clicking, and form filling with URLs resolve to `browser_session` (`device.browser`).
8. **Real-Time Factual Queries & Web Search**: Queries requiring real-time freshness ("top tech headlines today", "current weather", "live stock prices") resolve to `web_search` (`device.browser` with fallback `web.scraper`). Anti-pattern blocked: Factual queries requiring real-time data cannot route to `direct_answer`.
9. **Android Device Gestures & Hardware Sensors**: Explicit device interactions (camera, screenshot, clipboard, calendar, contacts, notifications, GPS location, app launch) resolve to `device_gesture` with specific matched Android capability.
10. **Registered Capability Fallback**: Exact matching against dynamic custom capabilities registered in the registry.
11. **Missing Tool Protocol (`ERR_NO_CAPABLE_TOOL`)**: When no registered tool matches requested hardware/peripheral actions, returns structured `ERR_NO_CAPABLE_TOOL` justification with `confidenceScore: 0.20`.

### B3. AgentExecutionLoop Integration (`server/capabilities/orchestration.ts`)
- The `AgentExecutionLoop` constructor invokes `capabilityRegistry.matchCapability()` on initialization.
- If no initial plan was supplied, the loop automatically formulates `this.currentPlan` from `primaryCapabilityId` and `chosenModality`.
- Fallbacks are populated from `fallbackCapabilityIds`.
- Telemetry event `AGENT_LOOP_CAPABILITY_SELECTED` is emitted to the `ObservabilityBus` with grounded metadata (`chosenModality`, `primaryCapabilityId`, `confidenceScore`, `justification`).

---

## 4. Test Suite Execution & Code Quality Evidence

### Vitest Subsystem Regressions
Command:
```bash
npx vitest run \
  server/repeat-detector.test.ts \
  server/runtime-failure.test.ts \
  server/agent-behavioral-contract.test.ts \
  server/agent-loop.test.ts \
  server/goals.test.ts \
  server/round6-system-chaos.test.ts \
  server/capabilities/capability-registry.test.ts
```
**Result**: 7 test files, **117 passed (117/117)** in 8.39s.

### TypeScript Compilation
Command:
```bash
npx tsc -p tsconfig.server.json --noEmit
```
**Result**: Exit code 0, **zero errors**.

### Linter (oxlint)
Command:
```bash
npm run lint
```
**Result**: Exit code 0, **0 errors, 0 warnings across 1,588 files**.

### Server Bundle Build
Command:
```bash
npm run build:server
```
**Result**: Exit code 0, bundled `dist-server/index-android.js` (7.3MB).

---

## 5. Physical Hardware Verification on Samsung Galaxy A07

### Device & Host Profile
- **Target Device**: Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`, Android 16, ARM64)
- **Preview App**: `com.openmausbot.companion.preview` (UID 10286, PID 19464)
- **Live Host Endpoint**: Port 18789 on device (Forwarded to `tcp:28889` via ADB)
- **Health Verification**: `{"app":"openmausbot","pid":19464,"port":18789,"static":false}`
- **Production Package**: `com.openmausbot.companion` (UID 10039, PID 27434 / host PID 27457) — untouched, running continuously since 15:52:27.

### Physical Device Verification Results (`server/verify-device-capability-selection.ts`)

| Scenario | Objective / Operation | Modality / Tool | Confidence | Result | Evidence Details |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **1** | "What were the top tech headlines today?" (Canonical) | `web_search`<br>Primary: `device.browser`<br>Fallback: `web.scraper` | 0.94 | **PASS** | Modality `web_search`, not `direct_answer`. Real search invocation succeeded on device returning authentic headlines. |
| **2** | "Good morning!" (Greeting Bypass) | `direct_answer` | 0.96 | **PASS** | Routed to `direct_answer` without tool dispatch. Justification confirms conversational greeting bypass. |
| **3** | "Take a screenshot of the current Android screen" | `device_gesture`<br>Primary: `device.screenshot` | 0.92 | **PASS** | Captured screenshot on Samsung Galaxy A07 at `/sdcard/Download/screenshot_1792852456056.png`. |
| **4** | "Save summary report to workspace/summary.md file" | `filesystem_mutation`<br>Primary: `device.files` | 0.94 | **PASS** | Routed to `device.files` with calibrated confidence 0.94. |
| **5** | "Control the quantum ion trap peripheral on USB bus" | `user_clarification`<br>Tool: `undefined` | 0.20 | **PASS** | Emits `ERR_NO_CAPABLE_TOOL`: No registered capability satisfies requirements for quantum ion trap. |
| **6** | Freshness Divergence: "Who won 1998 World Cup?" vs "Who won match today?" | Historical: `direct_answer`<br>Real-time: `web_search` | 0.96 / 0.94 | **PASS** | Historical factual inquiry satisfied directly; real-time query routed to web search to prevent hallucinations. |
| **7** | Live `AgentExecutionLoop` Telemetry | `ObservabilityBus` event | 0.94 | **PASS** | Bus received `AGENT_LOOP_CAPABILITY_SELECTED` with modality `web_search`, goal ID, and justification. |
| **8** | Physical Host Process Isolation Verification | Health / PID check | N/A | **PASS** | Preview host running on port 18789 (PID 19464); production app (PID 27434) completely undisturbed. |

**Hardware Verification Verdict: PASS (8/8 scenarios passed)**

---

## 6. Acceptance Matrix Summary

| Criterion | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :---: |
| **C1** | Data Contracts in `types.ts` | Source inspection & contract tests | **PASS** |
| **C2** | Calibrated Confidence Scoring | 35+ scenario tests in `capability-registry.test.ts` | **PASS** |
| **C3** | Missing-Tool Protocol | Negative tests asserting `ERR_NO_CAPABLE_TOOL` | **PASS** |
| **C4** | Integration with `AgentExecutionLoop` | Telemetry & fallback auto-population tests | **PASS** |
| **C5** | Canonical Tech Headlines Test | Physical device test on Samsung Galaxy A07 | **PASS** |
| **C6** | Anti-Pattern: Realtime -> Search | Freshness divergence tests on device | **PASS** |
| **C7** | Zero Regressions across Subsystems | 117 tests across 7 test suites | **PASS** |
| **C8** | Code Quality & Type Cleanliness | TypeScript 0 errors, oxlint 0 warnings | **PASS** |
| **C9** | Production Host Process Untouched | ADB process table verification (PID 27434 preserved) | **PASS** |

Both Gate A (Phase 10 Acceptance Closure) and Gate B (Phase 11 Intelligent Capability Selection) are fully complete and physically verified.
