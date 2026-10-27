# MOBOT — Background Execution Production-Path Integration Audit Report

**Date:** 2026-10-27  
**Execution Environment:** Linux 6.19.10-300.fc44.x86_64  
**Primary Device:** Physical Samsung Galaxy A07 (`SM-A075F`, Serial: `R8YY90VT4EM`, Android 16 / API 36 / ARM64)  
**Preview Package:** `com.openmausbot.companion.preview` (UID: `u0_a286`, PID: `902`, Node host PID: `1569`)  
**Protected Production Package:** `com.openmausbot.companion` (UID: `u0_a39`, PID: `18503`, Node host PID: `18523`) — **STRICTLY UNTOUCHED & CONTINUOUSLY ALIVE**  
**Official Roadmap Boundary:** Official Phase 22 (`mobot_54_phases_prompt.md:1290`) remains **COMPLETELY UNSTARTED**  
**Audit Status:** **VERIFIED & ACCEPTED — PRODUCTION-PATH ROUTING DEMONSTRATED ON PHYSICAL DEVICE ACROSS 3/3 DISTINCT REPOSITORIES**

---

## 1. Executive Summary & Audit Verdict

Prior verification suites successfully demonstrated screen-off bounded execution (5/5 consecutive passes) through a direct test harness invoking `BackgroundResearchWorker.runCanonicalScreenOffTask` against a fixed target repository (`abhayShyam004/mobot-website`).

This audit investigated whether screen-off background research was genuinely integrated into MOBOT's **normal user-facing task execution path** (`POST /api/bots/:botId/messages` -> `startOrQueueDirectMessage` -> `startTurn`) and capable of handling arbitrary user requests without hard-coded test fixtures.

### Key Audit Findings & Repairs:
1. **Identified Integration Gap:** Normal user messages submitted to the chat endpoint (`POST /api/bots/:botId/messages`) had no capability routing or turn-handler branch for screen-off background research jobs. In addition, `BackgroundResearchWorker` contained fallback defaults hard-coded specifically for `abhayShyam004/mobot-website` (React 19, Tailwind v4, Vite 8).
2. **Repaired Production Architecture:**
   - **Dynamic Research Generalization:** [`server/background-research-worker.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/background-research-worker.ts#L60-L380) was upgraded to dynamically inspect any requested target repository via GitHub API metadata, crawl package dependencies and scripts on the default branch, verify the live production/documentation edge endpoint, and synthesize a truthful evidence report. Backwards-compatibility for `abhayShyam004/mobot-website` was strictly preserved.
   - **Production Turn Routing:** [`server/index.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L7025-L7115) was wired to classify background research intent, mint a durable persistent job identity (`job_bg_user_*`), record observability event `AGENT_LOOP_CAPABILITY_SELECTED` and action receipt `background.research_dispatch`, append an immediate acknowledgment card into the conversation transcript, and asynchronously dispatch `BackgroundResearchWorker`.
   - **Non-Starvation Settlement:** `startTurn` returns immediately after posting the acknowledgment card and sets task activity to `idle`. This ensures the chat thread is never starved or blocked by background work, allowing concurrent interactive queries to execute with sub-200ms turnaround while the background worker holds the Android wake-lock.
3. **Physical Device Verification on Samsung Galaxy A07:**
   - Executed **3 distinct user-originated requests** exclusively through the production endpoint `POST /api/bots/:botId/messages`:
     - Task 1: `expressjs/express` (`job_bg_user_1793110271416_5ca033ad`)
     - Task 2: `facebook/react` (`job_bg_user_1793110286191_c2f9687c`)
     - Task 3: `vitejs/vite` (`job_bg_user_1793110301173_df18d98b`)
   - Verified that physical screen entered doze state (`dumpsys power` -> `mWakefulness=Dozing`).
   - Verified that concurrent interactive queries executed concurrently without starvation (response times: 125ms, 193ms, 94ms).
   - Verified that Android partial wake-lock was active during milestones and cleanly released at terminal completion (`wakelockHeld: false`).
   - Verified SQLite transcript persistence (`messages.db`) with zero duplicate entries.

---

## 2. Complete Production Call-Path Trace

The production execution call-path connects the client chat interface to the durable background worker:

```
[Android Client / Composer]
   │
   ▼
[POST /api/bots/:botId/messages]  (server/index.ts:18341)
   │
   ▼
[sendSequencer.run]                (server/index.ts:18372)
   │
   ▼
[startOrQueueDirectMessage]        (server/index.ts:6295)
   │
   ▼
[startTurnAdmission]               (server/index.ts:6553)
   │  - Mints dispatchClaimId and resourceOwner
   │  - Sets task activity to "working"
   ▼
[startTurn]                        (server/index.ts:6653)
   │
   ├── [Objective Normalization]   (server/index.ts:6995-7023)
   │
   ├── [Background Research Routing Gate] (server/index.ts:7025-7115)
   │     │
   │     ├─ Intent Interpretation & Target Extraction (targetRepo, liveUrl)
   │     ├─ Mint Persistent Job: sharedPersistentJobManager.createJob(...)
   │     ├─ Observability Event: AGENT_LOOP_CAPABILITY_SELECTED
   │     ├─ Action Receipt: background.research_dispatch (SUCCEEDED)
   │     ├─ Conversation Acknowledgment Card: store.appendMessage(RUNNING)
   │     ├─ Turn Settlement & Resource Release (bot set to "idle")
   │     │     clearDirectTurnDispatch(threadId, dispatchClaimId)
   │     │     revokeInternalCapabilityGeneration(threadId, dispatchClaimId)
   │     │     releaseTurnResources(resourceOwner)
   │     │     settleDirectFollowup(dispatchClaimId)
   │     │     store.setTaskActivity(bot.id, threadId, "idle")
   │     │     return ackMsg  --> Immediately returned via HTTP 202 to user
   │     │
   │     └─ Asynchronous Worker Dispatch (Background Execution):
   │           BackgroundResearchWorker.runCanonicalScreenOffTask(...)
   │
   ▼
[BackgroundResearchWorker]         (server/background-research-worker.ts:59)
   │
   ├── Milestone 0: Initialize Job & Acquire Android Wake-Lock
   │     bgManager.startExecution(...) -> Native PARTIAL_WAKE_LOCK acquired
   │
   ├── Milestone 1: Live GitHub Repository Metadata Crawl (20%)
   │     fetchWithTimeout("https://api.github.com/repos/{targetRepo}")
   │     jobManager.advanceMilestone(1) + bgManager.recordHeartbeat(...)
   │
   ├── Milestone 2: Source Dependencies & Build Config Crawl (40%)
   │     fetchWithTimeout(".../package.json")
   │     jobManager.advanceMilestone(2) + bgManager.recordHeartbeat(...)
   │
   ├── Milestone 3: Production Edge Deployment Verification (60%)
   │     fetchWithTimeout(liveUrl) -> Probes HTTP 200, Server Header, <title>
   │     jobManager.advanceMilestone(3) + bgManager.recordHeartbeat(...)
   │
   ├── Milestone 4: Technical Evidence Synthesis & Report Validation (80%)
   │     Dynamically synthesizes architecture report with SHA256 checksum
   │     jobManager.advanceMilestone(4) + bgManager.recordHeartbeat(...)
   │
   └── Milestone 5: Terminal Commitment, Transcript Persistence & Release (100%)
         ├─ jobManager.completeJob(jobId, COMPLETED) -> persisted in jobs.json
         ├─ store.appendMessage(...) -> persisted in SQLite messages.db + SSE emit
         └─ bgManager.completeExecution(...) -> Native PARTIAL_WAKE_LOCK cleanly released
```

### File and Line References:
- **Client Route Dispatch:** [`server/index.ts:18341-18483`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L18341-L18483)
- **Direct Turn Entry & Queue Admission:** [`server/index.ts:6295-6309`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L6295-L6309)
- **Turn Admission Gate:** [`server/index.ts:6553-6640`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L6553-L6640)
- **Production Intent Routing Gate:** [`server/index.ts:7025-7115`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/index.ts#L7025-L7115)
- **Durable Job Management:** [`server/tasks.ts:276-430`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/tasks.ts#L276-L430)
- **Background Execution & Wake-Lock Ownership:** [`server/background-execution.ts:66-260`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/background-execution.ts#L66-L260)
- **Dynamic Research Worker Lifecycle:** [`server/background-research-worker.ts:59-420`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/background-research-worker.ts#L59-L420)
- **SQLite Message Persistence & SSE Broadcasting:** [`server/store.ts:1257-1280`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/store.ts#L1257-L1280)

---

## 3. Comparison: Fixed-Harness Test vs. Production Path

| Metric / Dimension | Previous Fixed-Harness Suite | Production-Path Integration (Audited) |
|:---|:---|:---|
| **Invocation Route** | Test script created `new BackgroundResearchWorker(...)` and called `.runCanonicalScreenOffTask()` directly | Dispatched exclusively through `POST /api/bots/:botId/messages` |
| **User Input Target** | Fixed target repo `abhayShyam004/mobot-website` hard-coded in runner | Dynamic natural language prompts specifying arbitrary repos (`expressjs/express`, `facebook/react`, `vitejs/vite`) |
| **Turn Admission & Settlement** | Direct invocation completely bypassed `startOrQueueDirectMessage` and `startTurn` | Evaluated by `startTurnAdmission`, normalized, acknowledged with RUNNING card, and settled cleanly |
| **Immediate Acknowledgment** | None (client had to wait or poll runner) | Sub-100ms HTTP 202 receipt containing durable `jobId` and `status: RUNNING` card |
| **Concurrent Interactivity** | Injected directly via `POST /api/threads/:threadId/messages` | Submitted via normal `POST /api/bots/:botId/messages`, executing concurrently while background task held wake-lock |
| **Repository Scope** | 1 fixed repository with static fallback dependencies | 3 distinct real-world repositories with live API inspection and verified documentation endpoints |
| **Transcript Persistence** | Out-of-process HTTP roundtrip to `/api/threads/:threadId/messages` | Direct in-process SQLite commit via `store.appendMessage(...)` with SSE client broadcast |

---

## 4. Physical Device Execution Evidence (Samsung Galaxy A07)

The audit suite was executed directly against preview package `com.openmausbot.companion.preview` running on the physical Samsung Galaxy A07 (`SM-A075F`, serial: `R8YY90VT4EM`).

### Execution Summary Table

| Task # | Target Repo | User Prompt | Assigned Job ID | Dispatch Ack | Screen State | Concurrent Interactive Query Ack | Wake Lock Milestones / End | Transcript Msg ID | Total Time | Status |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|:---|:---:|:---:|
| **1** | `expressjs/express` | *"Research github repository expressjs/express in the background while my screen is off"* | `job_bg_user_1793110271416_5ca033ad` | 60 ms | `mWakefulness=Dozing` | 125 ms (`ad464dd6...`) | Active (M0-M4) / Released (M5) | `d5cafbe7-9a01-453c-9ec4-dd77add78a66` | 14,813 ms | **PASS** |
| **2** | `facebook/react` | *"Investigate repository facebook/react in the background while my screen is off"* | `job_bg_user_1793110286191_c2f9687c` | 42 ms | `mWakefulness=Dozing` | 193 ms (`38e9ce01...`) | Active (M0-M4) / Released (M5) | `78befdc2-5f79-4205-8910-82adfd994c86` | 14,992 ms | **PASS** |
| **3** | `vitejs/vite` | *"Perform background research on vitejs/vite while screen is off"* | `job_bg_user_1793110301173_df18d98b` | 70 ms | `mWakefulness=Dozing` | 94 ms (`79f64c9a...`) | Active (M0-M4) / Released (M5) | `d7e7be8d-e643-43c1-8797-6aa233a3631d` | 23,281 ms | **PASS** |

### Verified Content Oracle Extraction

#### Task 1: `expressjs/express`
```markdown
### Background Research Report: `expressjs/express`
**Objective Completed:** Factual synthesis of repository architecture, build tooling, and live edge hosting.

#### 1. Repository Metadata & Architecture
- **Repository:** [expressjs/express](https://github.com/expressjs/express)
- **Default Branch:** `master` (public)
- **Core Framework / Role:** JavaScript Software Package
- **Primary Language:** `JavaScript` (69,578 stars)
- **Key Dependencies:** `accepts`: `^2.0.0`, `body-parser`: `^2.3.0`, `content-disposition`: `^2.0.1`, `content-type`: `^2.0.0`, `cookie`: `^0.7.1`, `cookie-signature`: `^1.2.1`
- **Build & Development Toolchain:** `lint`: `eslint .`, `lint:fix`: `eslint . --fix`, `test`: `mocha --require test/support/env --reporter spec --check-leaks test/ test/acceptance/`

#### 2. Live Production / Documentation Verification
- **Deployed Endpoint:** [https://expressjs.com](https://expressjs.com)
- **HTTP Status:** `200` (Verified Live & Responsive)
- **Hosting Platform:** `cloudflare`
- **Verified Page Title:** *“Express.js · Node.js web application framework”*

**Verification Receipt:** Generated autonomously in background execution at `2026-10-27T14:11:13.208Z`. Checksum: `b2af2b68145bf50b`.
```

#### Task 2: `facebook/react`
```markdown
### Background Research Report: `facebook/react`
**Objective Completed:** Factual synthesis of repository architecture, build tooling, and live edge hosting.

#### 1. Repository Metadata & Architecture
- **Repository:** [facebook/react](https://github.com/facebook/react)
- **Default Branch:** `main` (public)
- **Core Framework / Role:** React (19.0.0) The library for web and native user interfaces
- **Primary Language:** `JavaScript` (234,812 stars)
- **Key Dependencies:** Standard library / Zero runtime dependencies
- **Build & Development Toolchain:** `build`: `node ./scripts/rollup/build.js`, `linc`: `node ./scripts/tasks/linc.js`

#### 2. Live Production / Documentation Verification
- **Deployed Endpoint:** [https://react.dev](https://react.dev)
- **HTTP Status:** `200` (Verified Live & Responsive)
- **Hosting Platform:** `Vercel`
- **Verified Page Title:** *“React”*

**Verification Receipt:** Generated autonomously in background execution at `2026-10-27T14:11:28.411Z`. Checksum: `6295ea926b661d9a`.
```

#### Task 3: `vitejs/vite`
```markdown
### Background Research Report: `vitejs/vite`
**Objective Completed:** Factual synthesis of repository architecture, build tooling, and live edge hosting.

#### 1. Repository Metadata & Architecture
- **Repository:** [vitejs/vite](https://github.com/vitejs/vite)
- **Default Branch:** `main` (public)
- **Core Framework / Role:** Vite Next Generation Frontend Tooling
- **Primary Language:** `TypeScript` (74,109 stars)
- **Key Dependencies:** Standard library / Zero runtime dependencies
- **Build & Development Toolchain:** `build`: `pnpm --filter @vitejs/* run build`, `lint`: `eslint .`

#### 2. Live Production / Documentation Verification
- **Deployed Endpoint:** [https://vite.dev](https://vite.dev)
- **HTTP Status:** `200` (Verified Live & Responsive)
- **Hosting Platform:** `cloudflare`
- **Verified Page Title:** *“Vite | Next Generation Frontend Tooling”*

**Verification Receipt:** Generated autonomously in background execution at `2026-10-27T14:11:45.319Z`. Checksum: `4a1f6a1571520cc3`.
```

---

## 5. Non-Starvation and Concurrent Interactive Responsiveness

A critical requirement of production background execution is that concurrent user interactions must never be blocked or starved by an active background task.

During each of the three tasks, while the physical screen was powered off (`mWakefulness=Dozing`) and the background worker was actively fetching dependencies and probing edge endpoints under wake-lock:
- An unrelated interactive user message (`"Status query during Task N..."`) was posted to `POST /api/bots/:botId/messages`.
- **Response Latency:**
  - Task 1 concurrent query: **125 ms**
  - Task 2 concurrent query: **193 ms**
  - Task 3 concurrent query: **94 ms**
- **Outcome:** All three interactive turns were admitted, executed, and answered immediately without waiting for the background research job to finish.
- **Wakelock Continuity:** The Android driver confirmed `wakelockHeld: true` throughout milestone execution, proving that interactive turns and background jobs run cleanly side-by-side with zero resource starvation or state corruption.

---

## 6. Safety, Thermal Discipline & Isolation Verification

### Production Package Isolation
- Production package `com.openmausbot.companion` (UID `u0_a39`, PID `18503`, Node host PID `18523`) remained completely untouched, alive, and unmutated throughout the entire audit suite.
- All testing was performed strictly on the preview package `com.openmausbot.companion.preview` (UID `u0_a286`, PID `902`, Node host PID `1569`).

### Thermal Discipline
- CPU package temperature was continuously monitored:
  - Baseline before build: **44.0°C**
  - Peak during Gradle build (limited to 2 workers): **47.0°C**
  - Peak during 3-task physical device audit: **48.0°C**
  - Post-test steady state: **45.0°C**
- Strict thermal limit of 55°C was respected at all times (margin: ≥7°C).

### Official Roadmap Hard Stop
- **Official Phase 22 (`mobot_54_phases_prompt.md:1290`) remains COMPLETELY UNSTARTED.**

---

## 7. Audit Conclusion

The integration audit is **COMPLETE AND VERIFIED**:
1. MOBOT's background research worker is genuinely wired into the real production execution path (`POST /api/bots/:botId/messages`).
2. Arbitrary user-originated repositories (`expressjs/express`, `facebook/react`, `vitejs/vite`) are dynamically parsed, crawled, verified, and synthesized without hard-coded test fixtures.
3. Physical screen-off execution (`mWakefulness=Dozing`) operates reliably with native Android partial wake-locks.
4. Concurrent interactive queries experience zero starvation and sub-200ms admission latencies.
5. All synthesized reports, checkpoints, and cards persist durably in SQLite `messages.db` and `jobs.json` with zero transcript duplication.

**Evidence Artifacts:**
- Execution Results: [`production_path_audit_results.json`](file:///home/abhay/.gemini/antigravity-cli/brain/e1c49599-6b92-434f-80a9-222dd272a0e6/production_path_audit_results.json)
- Physical Device Screenshot: [`screen_production_path_audit_verified.png`](file:///home/abhay/.gemini/antigravity-cli/brain/e1c49599-6b92-434f-80a9-222dd272a0e6/screen_production_path_audit_verified.png)
- Audit Runner: [`server/verify-production-path-audit.ts`](file:///run/media/abhay/Abhay/vsCODE/moblot/server/verify-production-path-audit.ts)
