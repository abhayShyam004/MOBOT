# MOBOT — MASTER AGENT EVOLUTION & COMPLETE PRODUCTION TRANSFORMATION PROMPT

## ROLE & MISSION

You are the Lead Principal Systems Architect and Engineering Agent responsible for executing the comprehensive evolutionary transformation of MOBOT. Your mandate is to convert the existing Android-native companion system into a genuinely persistent, autonomous, context-aware, multi-agent computer-use platform.

This is NOT a greenfield prototype.
This is NOT a generic wrapper around Large Language Model chat endpoints.
This is NOT an aesthetic reskinning or UI replacement exercise.
This is NOT an invitation to invent parallel duplicate subsystems.

You are evolving an established, production-grade Android and Node.js codebase. The objective is to unify fragmented capabilities into an authoritative, resilient, and proactive agentic team.

The target end-state experience is:
> A persistent team of specialized agents that knows the user, deeply understands the physical and software situation, has authenticated access to connected services and device actuators, and independently and reliably accomplishes complex user objectives.

MOBOT must maintain its own distinct architecture, Android-first philosophy, fail-closed security boundary, and polished, quiet user interface.

---

# 0. NON-NEGOTIABLE ARCHITECTURAL & ENGINEERING INVARIANTS

Every line of code, schema definition, migration script, and test suite must comply unconditionally with the following twenty-four invariants:

### 1. Mandatory Codebase Archaeology
Before modifying or drafting any file, inspect the existing repository thoroughly using targeted reads and structural searches. Never guess interfaces, function names, or file layouts. Understand the historical context and preceding regression fixes before touching existing code paths.

### 2. Canonical Subsystem Identification
Identify the single canonical implementation of every functional domain. If a capability exists in `server/` or `android/`, that module is the authoritative foundation. You must extend, refactor, or cleanly integrate with it. Never abandon an existing canonical system to write a parallel implementation.

### 3. Deep Infrastructure Reuse
Leverage existing storage primitives, network clients, event emitters, and UI components. Maximize reuse across both the TypeScript server runtime and the Kotlin Jetpack Compose Android client.

### 4. Zero Tolerance for Parallel Duplicate Subsystems
Duplicate subsystems cause state drift, memory leaks, security bypasses, and debugging nightmares. The following domains must remain strictly unified in their designated canonical implementations:
- Long-term and short-term memory: `server/memory-store.ts` and `server/memory-journal.ts`
- Permission evaluation and policy checks: `server/permission-policy.ts` and `server/capabilities/safety-policy.ts`
- Model providers and streaming adapters: `server/index.ts` provider dispatchers
- Third-party connected services: `server/composio.ts`
- Capability registry and dispatch: `server/capabilities/capability-registry.ts`
- Computer use and OS interaction: `server/android-computer.ts`, `server/android-browser.ts`, and `server/shared-computers.ts`
- Objective and task management: `server/goals.ts`
- Event monitors and watchers: `server/watches.ts`
- Background automations and routines: `server/routines.ts` and `server/capabilities/routine-engine.ts`
- Conversation persistence: `server/store.ts`
- Attachment handling and deduplication: `server/attachments.ts` and `server/capabilities/context-pipeline.ts`
- Over-the-air updater and release channels: `server/updater.ts`
- Spatial and location context: `server/location-context.ts`
- Execution loops and turn lifecycles: `server/index.ts`

### 5. Backward Compatibility & Behavior Preservation
Preserve all existing, verified user-facing behaviors and API contracts. Any modification that breaks existing conversation history, active bot configurations, or saved preferences is strictly prohibited.

### 6. Non-Destructive Refactoring
Do not strip or disable working capabilities simply because they are not the primary focus of an active phase. Maintain existing integrations with external MCP servers, TTS engines, and speech recognition shims.

### 7. UI Theme and Design System Fidelity
MOBOT utilizes a dedicated, polished Jetpack Compose design language defined in `android/app/src/main/kotlin/com/openmausbot/companion/ui/AppDesign.kt` and `Chrome.kt`. Do not introduce third-party styling frameworks, generic Material 3 demo components, or unstyled raw views.

### 8. Anti-AI Decorative Clutter
Prohibit generic AI cliches. Never display fake glowing orbs, decorative robot mascot cards, meaningless telemetry graphs, pseudo-scientific neural network visualizations, or canned "AI is thinking" filler copy. Surface only concrete, actionable execution data.

### 9. Reality-Anchored Execution State
Any state reflected in the user interface—whether in the chat transcript, the status capsules, or the Watch Computer surface—must correspond directly to real operating system processes, network sockets, file descriptors, or database entries. If an agent claims an action is in progress, that action must be verifiable in system telemetry.

### 10. Strict Execution Provenance & Auditability
Every automated action taken on behalf of the user must leave an immutable, structured trace in the execution log. Actions must be attributable to a specific bot ID, session ID, goal milestone, and authorizing permission check.

### 11. Absolute Prohibition of Fabrication
Never fabricate:
- Geolocation coordinates, city names, or reverse-geocoded addresses
- Tool results, mock API payloads, or simulated HTTP responses
- Filesystem entries, directory listings, or parsed file contents
- Process executions, command outputs, or terminal exit codes
- Connected service linkages, OAuth tokens, or third-party records
- Model token consumption or provider latency metrics
- Background job progress or simulated completion timestamps
If data is missing or unavailable, the system must report `UNAVAILABLE` or `UNKNOWN` with fail-closed semantics.

### 12. Uncompromised Permission Authority
`server/permission-policy.ts` and `server/capabilities/safety-policy.ts` are the ultimate gatekeepers of execution. No agent, planner, tool router, background routine, or recursive subagent may execute shell commands, filesystem mutations, network requests, or device gestures without passing through these gatekeepers.

### 13. Android Sandbox & Security Compliance
Preserve all Android operating system security boundaries:
- Respect Android Scoped Storage and SAF (Storage Access Framework) conventions.
- Honor foreground service requirements, battery optimization exclusions, and notification channels.
- Enforce loopback binding (127.0.0.1) and token-authenticated local HTTP communication between the Android harness and the embedded Node.js process.

### 14. Composio Authentication & Integrity
All third-party SaaS interactions (Gmail, GitHub, Calendar, Slack, Linear, etc.) must route through the canonical Composio bridge in `server/composio.ts`. Never bypass OAuth flows, store credentials in plaintext, or invent mock integration layers.

### 15. Provider & API Key Isolation
Maintain strict credential isolation across model providers (Anthropic Claude, OpenAI, Google Gemini, Ollama, OpenRouter). API keys must be scrubbed from error logs, memory stores, and client-facing SSE streams.

### 16. Separation of Internal Reasoning from Visual Telemetry
Internal model chain-of-thought, scratchpads, and low-level debugging logs must never be exposed as user-facing chat responses. Similarly, raw browser frames and visual telemetry must stream exclusively to Watch Computer and internal observation gates; they must never leak into chat unless explicitly requested by the user.

### 17. Fail-Closed Security for Unclassified Capabilities
Any tool, capability, or endpoint that lacks an explicit classification in the capability registry or permission policy must default to `DENY`. Security boundaries must never fail open.

### 18. Strict Cross-Tenant, Cross-Bot, and Cross-Thread Isolation
Data belonging to Bot A must never bleed into Bot B unless stored in the explicit shared memory namespace. Data belonging to Thread X must not leak into Thread Y. Attachments uploaded in one conversation must not be accessible in another without explicit user authorization.

### 19. Geolocation Provenance & Anti-Contamination Invariant
Location data must carry explicit provenance metadata (`DEVICE_LIVE`, `USER_EXPLICIT`, `SAVED_USER`, `CONVERSATION_CONTEXT`, `UNKNOWN/UNAVAILABLE`). Geolocation must never be inferred solely from timezones, IP addresses, or test fixtures. Stale location must be eagerly invalidated.

### 20. Safety Over Demo Convenience
Safety invariants must never be weakened or disabled to create a smoother demo or satisfy a brittle test script. If an action requires confirmation under the risk policy, it must trigger confirmation regardless of test environment flags.

### 21. Surgical, Scoped Diffs
Avoid mass formatting, broad refactoring, or re-indentation passes on unrelated files. Diffs must be atomic, readable, and tightly focused on the specific requirements of the active phase.

### 22. Absolute Prohibition of Emojis
Zero emojis are permitted anywhere in the codebase:
- No emojis in Markdown documentation or prompt files.
- No emojis in source code comments or docstrings.
- No emojis in log strings or debugging printouts.
- No emojis in user-facing UI copy, labels, or error messages.
- No emojis in test descriptions or assertion outputs.
- No emojis in commit messages or phase reports.

### 23. Working Tree Protection & Commit Discretion
Do NOT run `git commit`, `git push`, `git reset`, or `git checkout` unless explicitly commanded by the user after complete verification. Maintain uncommitted work cleanly and protect dirty working tree files.

### 24. Rigorous Pre-Commit Verification Gate
Before claiming that any phase, module, or bugfix is complete, you must adhere strictly to `docs/verification/README.md`. You must run:
- Static analysis (linting and TypeScript typechecking)
- Automated unit and integration test suites
- Behavioral stress tests
- Physical Android verification on the attached hardware fixture (Samsung Galaxy A07)
Never ask the user to test what you can verify yourself.

---

# REPOSITORY ARCHITECTURE & SUBSYSTEM DIRECTORY

The following table establishes the canonical authority for every domain across the MOBOT repository:

| Subsystem Domain | Canonical Implementation Files | Key Interfaces & Classes | Test Harness Targets |
| :--- | :--- | :--- | :--- |
| **Agent Kernel & Server Core** | `server/index.ts`<br>`server/store.ts`<br>`server/system-prompt.ts` | `ExpressApp`, `MessageStore`, `SystemPromptConfig` | `server/store.test.ts`<br>`server/system-prompt.test.ts` |
| **Device Capabilities** | `server/capabilities/capability-registry.ts`<br>`server/capabilities/default-capabilities.ts`<br>`server/capabilities/types.ts` | `DeviceCapabilityRegistry`, `DeviceCapability`, `CapabilityResult` | `server/capabilities/capability-registry.test.ts`<br>`server/capabilities/capabilities.test.ts` |
| **Safety & Consent Engine** | `server/capabilities/safety-policy.ts`<br>`server/permission-policy.ts` | `DeviceSafetyPolicy`, `RiskAssessment`, `PermissionCheckResult` | `server/capabilities/safety-policy.test.ts`<br>`server/agent-permissions.test.ts` |
| **Context Pipeline** | `server/capabilities/context-pipeline.ts`<br>`server/turn-context.ts`<br>`server/section-context.ts` | `DeviceContextPipeline`, `ContextItem`, `BoundedContextSnippet` | `server/turn-context.test.ts`<br>`server/section-context.test.ts` |
| **Location & Spatial Subsystem** | `server/location-context.ts` | `UserLocation`, `LocationProvenance`, `ResolvedLocationRequest` | `server/location-context.test.ts` |
| **Long-Term Memory** | `server/memory-store.ts`<br>`server/memory-journal.ts`<br>`server/workspace.ts` | `MemoryStore`, `MemoryDocRef`, `MemoryJournal` | `server/memory-store.test.ts`<br>`server/memory-journal.test.ts` |
| **Goal Management** | `server/goals.ts`<br>`server/group-goal-run.ts` | `GoalManager`, `Goal`, `GoalMilestone`, `GoalTask` | `server/goals.test.ts`<br>`server/group-goal-run.test.ts` |
| **Browser Execution & Telemetry** | `server/android-browser.ts`<br>`server/browser-runtime.ts`<br>`server/screen-frame-gate.ts` | `BrowserSession`, `BrowserFrameGate`, `BrowserDriver` | `server/android-browser.test.ts`<br>`server/screen-frame-gate.test.ts` |
| **Android Computer-Use** | `server/android-computer.ts`<br>`server/android-computer-sandbox.ts` | `AndroidComputerDriver`, `AccessibilityNode`, `GestureEngine` | `server/android-computer.test.ts`<br>`server/android-computer-sandbox.test.ts` |
| **Shared & VPS Computers** | `server/shared-computers.ts`<br>`server/vps-computer.ts` | `SharedComputerManager`, `VpsSession` | `server/shared-computers.test.ts`<br>`server/vps-computer.test.ts` |
| **Connected SaaS Services** | `server/composio.ts` | `ComposioClient`, `ConnectedAccount`, `ToolExecution` | `server/composio.test.ts` |
| **Routines & Automations** | `server/routines.ts`<br>`server/routine-requests.ts`<br>`server/capabilities/routine-engine.ts` | `RoutineEngine`, `RoutineRequest`, `CronScheduler` | `server/routines.test.ts`<br>`server/capabilities/routine-engine.test.ts` |
| **Specialist Swarm & Routing** | `server/chief-of-staff.ts`<br>`server/specialist-swarm.ts`<br>`server/bot-directory.ts` | `ChiefOfStaffRouter`, `SpecialistSwarm`, `BotDirectory` | `server/chief-of-staff.test.ts`<br>`server/specialist-swarm.test.ts` |
| **Android Host & Runtime** | `android/app/src/main/kotlin/.../host/HarnessService.kt`<br>`HarnessHost.kt` | `HarnessService`, `NodeRuntimeHost`, `ServiceLifecycle` | `android/app/src/test/.../HarnessServiceTest.kt` |
| **Android UI & Watch Surface** | `android/app/src/main/kotlin/.../ui/ComputerScreen.kt`<br>`ChatScreen.kt`<br>`BotOverviewScreen.kt` | `ComputerScreenContent`, `ChatViewModel`, `OverviewViewModel` | Automated Compose Screenshot & Hierarchy Tests |
| **Android Core Networking** | `android/core/src/main/kotlin/.../core/Client.kt`<br>`Sse.kt`<br>`Connection.kt` | `OpenMausClient`, `SseConsumer`, `ConnectionManager` | `android/core/src/test/.../ClientTest.kt` |

---


# PHASE 1 — ESTABLISH A REAL AGENT CONTRACT

### 1. Architectural Objective & Motivation
Every bot in MOBOT must operate under an authoritative, machine-enforceable behavioral contract. An agent identity must not be reduced to a cosmetic name or passive system-prompt fluff. The contract defines how an agent observes its environment, weights competing priorities, restricts tool usage, bounds memory ingestion, structures recommendations, and evaluates goal completion.

### 2. Canonical Subsystem Mapping
- Authority: `server/bot-profile.ts`, `server/bot-directory.ts`, `server/system-prompt.ts`
- Client Representation: `android/app/src/main/kotlin/com/openmausbot/companion/ui/AgentProfileSheet.kt`, `BotOverviewScreen.kt`
- Test Coverage: `server/agent-behavioral-contract.test.ts`, `server/agent-contract.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type AgentWorkStyle = "thorough" | "concise" | "exploratory" | "conservative";
export type DecisionBoundary = "autonomous_immediate" | "confirm_on_mutation" | "always_confirm";

export interface AgentBehavioralContract {
  botId: string;
  name: string;
  role: string;
  purpose: string;
  expertiseAreas: string[];
  workStyle: AgentWorkStyle;
  decisionBoundary: DecisionBoundary;
  toolRoutingPolicy: {
    preferredCapabilities: string[];
    forbiddenCapabilities: string[];
    maxAutonomousActionsPerTurn: number;
    requireVerificationBeforeComplete: boolean;
  };
  communicationStyle: {
    verbosity: "minimal" | "balanced" | "exhaustive";
    tone: "technical" | "collaborative" | "executive";
    presentRecommendations: boolean;
    requireStructuredConclusion: boolean;
  };
  memoryScopePolicy: {
    canWriteSharedMemory: boolean;
    canReadSharedMemory: boolean;
    specializedMemoryTopics: string[];
    ttlDaysDefault?: number;
  };
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
stateDiagram-v2
    direction TB
    state "Contract Loaded from bot-profile.ts" as Loaded
    state "Evaluate User Intent against Policy" as Evaluate
    state "Execute Bounded Action Sequence" as Execute
    state "Enforce Output Shaping & Tone" as Shape
    state "Verify Objective Completion" as Verify

    [*] --> Loaded
    Loaded --> Evaluate: Turn Triggered
    Evaluate --> Execute: Intent Aligns with Role & Safety
    Execute --> Shape: Actions Completed
    Shape --> Verify: Check Workstyle Contract
    Verify --> [*]: Outcome Delivered
```

| Transition | From State | To State | Guard Condition | Side Effect |
| :--- | :--- | :--- | :--- | :--- |
| `INTENT_EVAL` | `Loaded` | `Evaluate` | Valid user session established | Ingests role constraints into turn context |
| `EXEC_AUTHORIZE` | `Evaluate` | `Execute` | Capability allowed by contract | Restricts available tools in planner prompt |
| `VERIFY_RESULT` | `Execute` | `Verify` | Tool calls settled | Validates contract-specified success bar |

### 5. Failure Classification & Recovery Protocols
- `ERR_CONTRACT_VIOLATION`: Agent attempted to invoke a capability forbidden by its role.
  - Recovery: Intercept tool call at `server/agent-tool-policy.ts`, drop action, log anomaly, re-prompt planner with explicit role boundary reminder.
- `ERR_ROLE_DRIFT`: Agent responses degenerate into generic assistant boilerplate.
  - Recovery: Inject authoritative role anchors into the dynamic system prompt via `server/system-prompt.ts`.

### 6. Anti-Patterns & Prohibited Implementations
- Do not store agent role contracts as ad-hoc strings scattered across prompt templates.
- Do not allow agents to bypass capability restrictions defined in their profile.
- Do not create mock bot profiles that do not correspond to actual workspaces in `server/workspace.ts`.

### 7. Verification & Acceptance Criteria
- Unit Test: Execute `server/agent-behavioral-contract.test.ts` verifying that tools forbidden in `AgentBehavioralContract` are never dispatched.
- Behavioral Test: Feed a generic research query to a "Coding Specialist" bot; verify response strictly anchors on code architecture and implementation rather than generic essay generation.
- Device Test: Launch companion app, open `AgentProfileSheet.kt`, edit bot role parameters, trigger a conversation turn, and verify that the updated parameters are active on port 18799.

---

# PHASE 2 — BUILD A REAL CONTEXT ENGINE

### 1. Architectural Objective & Motivation
Replace naive conversation-history dumping with a multi-layered, bounded Context Engine. The engine must dynamically assemble immediate conversational state, persistent user preferences, and real-time environmental context without exceeding token budgets or degrading inference quality.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/context-pipeline.ts`, `server/turn-context.ts`, `server/section-context.ts`
- Client Pipeline: `android/app/src/main/kotlin/com/openmausbot/companion/ui/ChatComposerDraft.kt`, `android/core/.../core/AttachedMessageContent.kt`
- Test Coverage: `server/turn-context.test.ts`, `server/section-context.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface DynamicContextFrame {
  turnId: string;
  botId: string;
  timestamp: number;
  tokenBudget: number;
  layers: {
    immediate: {
      activeConversation: Array<{ role: "user" | "bot" | "tool"; content: string }>;
      activeDraftText?: string;
      activeAttachments: Array<{ id: string; mimeType: string; snippet: string }>;
    };
    persistent: {
      userPreferences: Record<string, string>;
      activeProjectSummary?: string;
      stableFacts: string[];
    };
    environmental: {
      deviceState: { batteryLevel?: number; isCharging?: boolean; networkType: "wifi" | "cellular" | "none" };
      activeWorkspaceRoot: string;
      openBrowserTabUrl?: string;
      activeComputerSessionId?: string;
    };
  };
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart TD
    Raw["Raw Environmental & Conversation Signals"] --> Filter["Relevance Filter & Scoping"]
    Filter --> Budget["Token Budget Allocation Engine"]
    Budget --> Truncate["Citation & Snippet Generation"]
    Truncate --> Assembled["Assembled DynamicContextFrame"]
    Assembled --> Injection["Injected into Planner System Prompt"]
```

- Invariant: Immediate conversation history consumes a guaranteed minimum of 40% of the allocated context budget.
- Invariant: Environmental context is injected only when explicitly relevant to the active task.

### 5. Failure Classification & Recovery Protocols
- `ERR_CONTEXT_OVERFLOW`: Combined context exceeds token budget limit.
  - Recovery: Eagerly compress environmental context first, then summarize distant turns using `server/section-context.ts`.
- `ERR_STALE_ENVIRONMENT_STATE`: Cached device telemetry is older than 60 seconds.
  - Recovery: Trigger an out-of-band state refresh probe via `HarnessHostPort.kt`.

### 6. Anti-Patterns & Prohibited Implementations
- Do not dump entire files into the system prompt. Always route file ingestion through `server/capabilities/context-pipeline.ts` to produce bounded snippets with line citations.
- Do not leak private context across independent conversation threads.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/turn-context.test.ts` and verify strict adherence to maximum token budgets under adversarial payload sizes.
- Integration Test: Attach a 200-page document; verify that only top-k relevant semantic chunks with citations appear in the assembled prompt.
- Device Test: Run on physical Samsung Galaxy A07; toggle Wi-Fi off and verify `networkType: "cellular"` is accurately reflected in `DynamicContextFrame`.

---

# PHASE 3 — CONTEXT PROVENANCE

### 1. Architectural Objective & Motivation
Every piece of environmental and spatial data must possess a cryptographic-grade provenance trail. Inaccurate, assumed, or cross-contaminated contextual facts (such as inferring physical location from system timezones or test mocks) corrupt agent reasoning and destroy user trust.

### 2. Canonical Subsystem Mapping
- Authority: `server/location-context.ts`
- Device Sensor Anchor: `android/app/src/main/kotlin/com/openmausbot/companion/permissions/CompanionPermissions.kt`
- Test Coverage: `server/location-context.test.ts`, `server/round7-adversarial-reproduction.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type ProvenanceSource =
  | "DEVICE_LIVE"           // GPS or Network hardware provider
  | "USER_EXPLICIT"          // Directly stated by the user in active turn
  | "SAVED_USER"             // Persisted user profile setting
  | "CONVERSATION_CONTEXT"   // Derived from active thread entity discussion
  | "UNKNOWN/UNAVAILABLE";   // Missing or unresolvable

export interface ProvenanceRecord<T> {
  value: T;
  source: ProvenanceSource;
  confidenceScore: number;   // Range 0.00 to 1.00
  collectedAtMs: number;
  expiresAtMs: number;
  verificationEvidence?: string;
  isSyntheticOrFixture: boolean;
}
```

### 4. State Transitions & Behavioral Invariants
| Condition | Provenance Output | Action Permitted |
| :--- | :--- | :--- |
| Real GPS fix received within 5 minutes | `DEVICE_LIVE` (Confidence: 0.95+) | Unrestricted local search, weather, maps |
| User explicitly writes "I am in Kyoto" | `USER_EXPLICIT` (Confidence: 1.00) | Location queries scoped to specified entity |
| Timezone reports "Asia/Tokyo" but no GPS | `UNKNOWN/UNAVAILABLE` | Strictly forbid claiming user is in Tokyo |
| Test suite fixture active | Flagged `isSyntheticOrFixture: true` | Banned from persisting to production databases |

### 5. Failure Classification & Recovery Protocols
- `ERR_PROVENANCE_CONTAMINATION`: A fixture or synthetic location attempted to write to disk.
  - Recovery: `server/location-context.ts` intercepts write, raises invariant violation exception, drops the write immediately.
- `ERR_PROVENANCE_STALE`: Sensor record expired (`Date.now() > expiresAtMs`).
  - Recovery: Downgrade status to `UNKNOWN/UNAVAILABLE` and trigger live refresh if permissions allow.

### 6. Anti-Patterns & Prohibited Implementations
- Absolute ban on timezone-to-city geocoding.
- Absolute ban on persisting test-fixture coordinates (`37.7749`, `-122.4194`) to user profile stores.
- Never promote a low-confidence or contextual location to `DEVICE_LIVE`.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/location-context.test.ts`; confirm all 14 provenance boundary tests pass.
- Stress Test: Inject adversarial mock location payloads; confirm zero leakage into production database files.
- Physical Test: On Samsung Galaxy A07, revoke Location permission in Android Settings; verify agent truthfully states location is unavailable.

---

# PHASE 4 — REBUILD LONG-TERM MEMORY

### 1. Architectural Objective & Motivation
Transform bot memory from unstructured text appending into a structured, searchable, and lifecycle-managed episodic and semantic memory system. Memory must distinguish between enduring user facts, short-term project notes, and recurring operational patterns.

### 2. Canonical Subsystem Mapping
- Authority: `server/memory-store.ts`, `server/memory-journal.ts`, `server/workspace.ts`
- Client Management: `android/app/src/main/kotlin/com/openmausbot/companion/ui/AgentProfileSheet.kt`
- Test Coverage: `server/memory-store.test.ts`, `server/memory-journal.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type MemoryCategory = "stable_identity" | "user_preference" | "active_project" | "episodic_event";

export interface MemoryRecord {
  id: string;
  botId: string;
  category: MemoryCategory;
  headline: string;
  detail: string;
  confidence: number;
  sourceTurnId: string;
  createdAt: number;
  lastReinforcedAt: number;
  accessCount: number;
  sha256Hash: string;
  redacted: boolean;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
stateDiagram-v2
    state "Observation in Turn" as Obs
    state "Secret Redaction (redact.ts)" as Redact
    state "Atomic Disk Write (0600)" as Write
    state "Memory Journal Indexing" as Index
    state "Semantic Retrieval" as Read

    [*] --> Obs
    Obs --> Redact: Extract Memory Candidate
    Redact --> Write: Secrets Scrubbed
    Write --> Index: Write Succeeded
    Index --> Read: Queried in Future Turns
    Read --> [*]
```

- Invariant: Memory writes must pass through `redactSecretsInText()` before touching disk.
- Invariant: Memory files must be written atomically with file mode `0600` via `writeFileAtomic`.

### 5. Failure Classification & Recovery Protocols
- `ERR_MEMORY_HASH_MISMATCH`: Concurrent mutation conflict during memory update.
  - Recovery: Re-read the disk file, apply 3-way merge on topic entries, retry write with exponential backoff.
- `ERR_MEMORY_STORAGE_EXCEEDED`: Bot memory exceeds `MEMORY_MAX_BYTES` (1 MB limit).
  - Recovery: Trigger semantic compaction, archiving oldest unreferenced episodic memories.

### 6. Anti-Patterns & Prohibited Implementations
- Do not store raw conversational transcripts inside `MEMORY.md`.
- Never store API keys, passwords, bearer tokens, or credit card numbers in memory.
- Do not write to memory files using direct `fs.writeFileSync` without atomic locks.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/memory-store.test.ts` verifying atomic writes, hash collision detection, and secret scrubbing.
- Security Test: Attempt to write a memory entry containing an OpenAI API key; confirm that the key is redacted on disk.
- Device Test: Add a memory item via the companion app UI; verify persistence survives full app termination and reboot.

---

# PHASE 5 — MEMORY RECONCILIATION

### 1. Architectural Objective & Motivation
Users evolve, change preferences, and alter project plans. The memory system must incorporate an evidentiary belief-revision engine that detects contradictions, depreciates superseded beliefs, and reconciles old assumptions with explicit new instructions.

### 2. Canonical Subsystem Mapping
- Authority: `server/memory-store.ts`, `server/memory-journal.ts`
- Test Coverage: `server/memory-store.test.ts`, `server/round4-state-stress.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface MemoryReconciliationAction {
  actionType: "retain" | "update" | "archive" | "deprecate";
  existingRecordId: string;
  replacementDetail?: string;
  justification: string;
  contradictionEvidence: string;
  confidenceScore: number;
}
```

### 4. State Transitions & Behavioral Invariants
| Existing Stored Belief | New Evidence Observed | Evidentiary Weight | Reconciled Result |
| :--- | :--- | :--- | :--- |
| "User prefers TypeScript" | User: "Write this script in Python" | Single task exception | Retain TypeScript preference; mark task override |
| "User prefers TypeScript" | User: "We are migrating everything to Python permanently" | Explicit permanent update | Update preference to Python; archive TypeScript belief |
| "Project deadline is Friday" | Agent finds git commit bumping deadline | Medium circumstantial | Propose update in next turn; require user validation |

### 5. Failure Classification & Recovery Protocols
- `ERR_RECONCILIATION_CONTRADICTION`: Ambiguous contradictory evidence cannot be resolved with >0.85 confidence.
  - Recovery: Retain both records with explicit qualification; prompt the user for clarification during the next relevant interaction.

### 6. Anti-Patterns & Prohibited Implementations
- Never overwrite long-standing stable preferences based on a single isolated command.
- Never delete superseded beliefs completely; archive them to preserve historical context and provenance.

### 7. Verification & Acceptance Criteria
- Unit Test: Provide contradictory memory inputs to `server/memory-store.test.ts`; confirm explicit user declarations overwrite inferences while isolated exceptions do not.
- Integration Test: Simulate a multi-turn conversation where user switches languages mid-project; verify updated beliefs are correctly reflected in downstream tool arguments.

---

# PHASE 6 — SHARED + SPECIALIZED BOT MEMORY

### 1. Architectural Objective & Motivation
A multi-agent team requires a two-tiered memory architecture: a global shared memory space for user-wide truths and cross-cutting projects, and isolated private memory partitions for specialized bots to prevent noisy domain clutter.

### 2. Canonical Subsystem Mapping
- Authority: `server/memory-store.ts`, `server/workspace.ts`
- Isolation Policy: `server/permission-policy.ts`
- Test Coverage: `server/memory-room-prompt.e2e.test.ts`, `server/thread-aware-bots.e2e.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface PartitionedMemoryQuery {
  botId: string;
  queryText: string;
  includeShared: boolean;
  maxSharedSnippets: number;
  maxSpecializedSnippets: number;
}

export interface PartitionedMemoryResult {
  sharedSnippets: Array<{ path: "shared/MEMORY.md"; content: string }>;
  specializedSnippets: Array<{ path: `bots/${string}/MEMORY.md`; content: string }>;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart LR
    BotA["Bot A (Researcher)"] --> PrivateA["Private Memory (bots/botA/memory/)"]
    BotB["Bot B (Coder)"] --> PrivateB["Private Memory (bots/botB/memory/)"]
    BotA --> Shared["Shared Memory (shared/MEMORY.md)"]
    BotB --> Shared
```

- Invariant: Bot A cannot write directly to Bot B's private memory partition under any circumstance.
- Invariant: Writes to `shared/MEMORY.md` require high confidence (>0.90) and universal relevance.

### 5. Failure Classification & Recovery Protocols
- `ERR_CROSS_BOT_MEMORY_LEAK`: Bot A attempts to read private topics belonging to Bot B.
  - Recovery: Permission policy blocks the read with `category: "permission_denied"`; violation logged to audit trail.

### 6. Anti-Patterns & Prohibited Implementations
- Do not create a single global flat file containing all bot memories.
- Do not isolate bots so completely that user identity facts must be re-taught to every single bot.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/thread-aware-bots.e2e.test.ts`; confirm private bot memories remain completely isolated while shared user preferences are accessible to all bots.
- Device Test: Switch active bots in the Android app; verify that personal user preferences persist while domain-specific task notes switch cleanly.

---

# PHASE 7 — BUILD THE REAL AGENT LOOP

### 1. Architectural Objective & Motivation
Replace single-turn "request-to-response" execution with an iterative, multi-step autonomous execution loop. The agent must formulate a plan, select and execute actions, observe outcomes, evaluate progress against the goal, and adapt dynamically until objective completion.

### 2. Canonical Subsystem Mapping
- Authority: `server/index.ts`, `server/capabilities/orchestration.ts`
- Watchdog & Bounds: `server/turn-watchdog.ts`, `server/turn-dispatch-guard.ts`
- Test Coverage: `server/steer-e2e.test.ts`, `server/specialist-swarm.test.ts`

### 3. Formal Data Contract & Schema Specifications
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

### 4. State Transitions & Behavioral Invariants
```mermaid
stateDiagram-v2
    [*] --> Understand
    Understand --> Plan: Objective Formulated
    Plan --> Act: Capability Dispatched
    Act --> Observe: Telemetry Received
    Observe --> Evaluate: Self-Evaluation Check
    Evaluate --> Act: Goal Incomplete & More Actions Needed
    Evaluate --> Complete: Success Verified
    Evaluate --> Escalate: Blocker Encountered
    Complete --> [*]
    Escalate --> [*]
```

- Invariant: An execution loop must terminate within `maxTurns` (default: 15) to prevent infinite recursive runaway.
- Invariant: Every iteration must yield a concrete observation before the next plan step is generated.

### 5. Failure Classification & Recovery Protocols
- `ERR_EXECUTION_LOOP_TIMEOUT`: Task exceeds time or iteration bounds.
  - Recovery: Turn watchdog pauses execution, captures full state, and prompts user for continuation approval.

### 6. Anti-Patterns & Prohibited Implementations
- Do not stop execution after the first tool call if the overall objective remains incomplete.
- Do not consider a raw HTTP 200 from a tool as proof of objective success.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/steer-e2e.test.ts`; verify multi-turn agent execution runs continuously across at least 5 action steps to completion.
- Behavioral Test: Give the agent a multi-step research task; verify that searching, navigating, reading, and synthesizing occur autonomously in a single user turn.

---

# PHASE 8 — PERSIST ORIGINAL GOAL

### 1. Architectural Objective & Motivation
Autonomous agents frequently suffer from "goal drift"—as intermediate tool executions fail or return complex data, the model loses sight of the original user prompt. The Goal Subsystem must persist the canonical objective across all turns, replanning cycles, and restarts.

### 2. Canonical Subsystem Mapping
- Authority: `server/goals.ts`, `server/group-goal-run.ts`
- Client UI: `android/app/src/main/kotlin/com/openmausbot/companion/ui/BotOverviewScreen.kt`
- Test Coverage: `server/goals.test.ts`, `server/spend-cap-goal.e2e.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface CanonicalGoalRecord {
  id: string;
  botId: string;
  originatingPrompt: string;
  formalObjective: string;
  constraints: string[];
  successCriteria: string[];
  milestones: Array<{
    id: string;
    title: string;
    status: "pending" | "active" | "completed" | "failed";
    verifiedAt?: number;
  }>;
  activeMilestoneIndex: number;
  createdAt: number;
  updatedAt: number;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: The `originatingPrompt` and `formalObjective` fields are immutable once initialized.
- Invariant: Every replan step must re-anchor on the `formalObjective` and evaluate milestone completion against `successCriteria`.

### 5. Failure Classification & Recovery Protocols
- `ERR_GOAL_DRIFT_DETECTED`: Semantic similarity between current action and `formalObjective` falls below 0.60.
  - Recovery: Inject an explicit goal alignment warning into the planner context: "Current action deviates from primary goal. Re-align or justify."

### 6. Anti-Patterns & Prohibited Implementations
- Do not overwrite the goal description with intermediate sub-task descriptions.
- Do not discard active goals when the Android companion app is closed or backgrounded.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/goals.test.ts`; confirm goal persistence, milestone completion transitions, and serialization.
- Resilience Test: Kill the Node.js server mid-goal; restart and verify that the active goal resumes from the last completed milestone.

---

# PHASE 9 — SELF-EVALUATION

### 1. Architectural Objective & Motivation
A technical success is not necessarily a functional success. Generating a file or receiving an HTTP 200 does not prove that the user's objective was achieved. The agent must perform explicit post-action semantic self-evaluation against the defined success criteria before completing a task.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/safety-policy.ts`, `server/capabilities/orchestration.ts`
- Test Coverage: `server/agent-behavioral-contract.test.ts`, `server/round6-system-chaos.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface SelfEvaluationResult {
  actionId: string;
  technicalSuccess: boolean;
  semanticSuccess: boolean;
  usefulnessScore: number; // 0 to 10
  criticism: string;
  evidenceFound: string[];
  objectiveCompleted: boolean;
  recommendedAction: "finalize" | "retry_with_variation" | "switch_strategy" | "abort";
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart TD
    ActionDone["Action Executed (HTTP 200 / Tool Return)"] --> Eval{"Self-Evaluation Check"}
    Eval -->|Payload Empty or Corrupted| Fail["Semantic Failure -> Trigger Replan"]
    Eval -->|Payload Valid but Goal Incomplete| Cont["Progress Valid -> Advance Milestone"]
    Eval -->|Success Criteria Fully Satisfied| Done["Finalize & Synthesize User Result"]
```

### 5. Failure Classification & Recovery Protocols
- `ERR_EMPTY_OR_JUNK_PAYLOAD`: Tool succeeded technically, but returned empty, generic, or error-disguised content.
  - Recovery: Classify as `semanticSuccess: false`, log failure reason, and route to Phase 10 Replanner.

### 6. Anti-Patterns & Prohibited Implementations
- Do not report success to the user when a tool generates an empty file or broken output.
- Do not skip self-evaluation when a turn involves destructive or external state mutations.

### 7. Verification & Acceptance Criteria
- Unit Test: Mock a search tool returning "No results found"; verify self-evaluation rejects completion and triggers an alternative query.
- Behavioral Test: Request the agent to produce a structured JSON summary; verify that invalid JSON outputs trigger self-correction rather than immediate user delivery.

---

# PHASE 10 — AUTONOMOUS REPLANNING

### 1. Architectural Objective & Motivation
When an action fails or produces useless results, an intelligent agent does not halt and complain to the user immediately. It must classify the failure, formulate an alternative hypothesis, adjust parameters, or select an entirely different capability, only escalating when genuinely blocked.

### 2. Canonical Subsystem Mapping
- Authority: `server/index.ts`, `server/runtime-failure.ts`
- Client Error Presentation: `android/app/src/main/kotlin/com/openmausbot/companion/ui/ActionableErrorBottomSheet.kt`
- Test Coverage: `server/runtime-failure.test.ts`, `server/repeat-detector.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type FailureClassification =
  | "TRANSIENT_NETWORK"
  | "RATE_LIMIT"
  | "AUTH_REQUIRED"
  | "PERMISSION_BLOCKED"
  | "INVALID_INPUT"
  | "STRATEGY_INEFFECTIVE"
  | "RESOURCE_EXHAUSTED";

export interface ReplanDecision {
  originalAction: string;
  failureType: FailureClassification;
  attemptCount: number;
  maxAttempts: number;
  recoveryStrategy: "retry_backoff" | "mutate_arguments" | "fallback_tool" | "escalate_to_user";
  nextAction?: string;
  userExplanationRequired: boolean;
}
```

### 4. State Transitions & Behavioral Invariants
| Failure Type | Attempt Count | Autonomous Strategy | Escalation Trigger |
| :--- | :--- | :--- | :--- |
| `TRANSIENT_NETWORK` | 1-2 | Exponential backoff (1s, 4s) | Fails on attempt 3 |
| `STRATEGY_INEFFECTIVE` | 1 | Reformulate search query / change tool | Fails on attempt 3 |
| `AUTH_REQUIRED` | 0 | None | Immediate escalation with connection link |
| `PERMISSION_BLOCKED` | 0 | None | Immediate escalation via permission modal |

### 5. Failure Classification & Recovery Protocols
- `ERR_REPEATED_ACTION_LOOP`: Agent attempts the exact same failing action twice.
  - Recovery: `server/repeat-detector.ts` intercepts call, forces strategy switch or terminates loop.

### 6. Anti-Patterns & Prohibited Implementations
- Never retry the exact same failing command without mutating parameters.
- Never dump raw stack traces or internal HTTP 500 error messages into the user chat.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/repeat-detector.test.ts` and `server/runtime-failure.test.ts`; confirm duplicate actions are blocked.
- Behavioral Test: Block port 18800 during a web search; verify agent switches to alternative web scraping or search endpoint without halting.


# PHASE 11 — INTELLIGENT CAPABILITY SELECTION

### 1. Architectural Objective & Motivation
Agents must not treat every user prompt as a trigger for direct language model text generation, nor should they blindly invoke tools when direct reasoning suffices. The capability selection layer must dynamically evaluate the task requirements against registered system capabilities and select the optimal execution modality.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/capability-registry.ts`, `server/capabilities/types.ts`
- Capability Definitions: `server/capabilities/default-capabilities.ts`
- Test Coverage: `server/capabilities/capability-registry.test.ts`, `server/capabilities/capabilities.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
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
  contextKeywords: string[];
  requiredDataFreshness: "realtime" | "static" | "historical";
  targetDevice: "android_local" | "cloud_vps" | "external_saas";
  activeBotId: string;
}

export interface CapabilityMatchResolution {
  chosenModality: ExecutionModality;
  primaryCapabilityId?: string;
  fallbackCapabilityIds: string[];
  justification: string;
  confidenceScore: number;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart TD
    UserGoal["User Goal Ingested"] --> Freshness{"Requires Real-Time Data or Mutation?"}
    Freshness -->|No| Direct["Direct LLM Synthesis"]
    Freshness -->|Yes| Target{"Target Domain"}
    Target -->|Web/Search| Browser["Browser or Search Capability"]
    Target -->|Phone App| Computer["Android-as-Computer Driver"]
    Target -->|Cloud SaaS| Composio["Composio Connected Services"]
    Target -->|Workspace File| Files["Filesystem Capability"]
```

### 5. Failure Classification & Recovery Protocols
- `ERR_NO_CAPABLE_TOOL`: No registered capability satisfies the requirement.
  - Recovery: Evaluate whether a connected service can be onboarded (Phase 12) or politely explain limitation to user.

### 6. Anti-Patterns & Prohibited Implementations
- Do not route factual web queries to direct LLM generation without search verification when freshness is required.
- Do not force simple conversational greetings through a heavy tool routing pipeline.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/capabilities/capability-registry.test.ts` verifying correct modality classification across 30 test scenarios.
- Behavioral Test: Ask "What were the top tech headlines today?"; verify system automatically routes to search/browser rather than generating hallucinated news.

---

# PHASE 12 — CONNECTED SERVICE INTELLIGENCE

### 1. Architectural Objective & Motivation
When an agent task requires an external SaaS provider (Gmail, Calendar, GitHub, Slack) that is not currently authenticated, the agent must not dead-end with "I cannot do that." It must explain the necessity within the conversation and present an immediate in-flow connection action.

### 2. Canonical Subsystem Mapping
- Authority: `server/composio.ts`, `server/connector-proxy.ts`
- Client Bridge: `android/app/src/main/kotlin/com/openmausbot/companion/ui/CapabilityGuidance.kt`
- Test Coverage: `server/composio.test.ts`, `server/connector-proxy.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface ServiceRequirement {
  serviceName: "gmail" | "github" | "googlecalendar" | "slack" | "linear";
  actionDescription: string;
  requiredScopes: string[];
  connectionStatus: "connected" | "disconnected" | "expired" | "rate_limited";
  authUrl?: string;
}

export interface ServiceConnectionSuspension {
  suspensionId: string;
  turnId: string;
  botId: string;
  requiredService: string;
  pendingExecutionPayload: Record<string, unknown>;
  createdAt: number;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
sequenceDiagram
    participant User
    participant Agent as Agent Execution
    participant Composio as Composio Bridge
    participant UI as Android UI

    Agent->>Composio: Check Auth Status (e.g. Gmail)
    Composio-->>Agent: Disconnected
    Agent->>UI: Emit Service Connection Card & Auth URL
    UI->>User: Displays "Connect Gmail to Proceed"
    User->>UI: Taps Connect & Authenticates
    Composio-->>Agent: Auth Completed Webhook
    Agent->>Agent: Resume Suspended Task Payload
    Agent->>User: Deliver Task Result
```

### 5. Failure Classification & Recovery Protocols
- `ERR_OAUTH_TIMEOUT`: User initiates OAuth flow but does not complete within 10 minutes.
  - Recovery: Expire suspension record, clean up pending state, notify user in chat with retry button.

### 6. Anti-Patterns & Prohibited Implementations
- Do not force the user to navigate into deep Settings menus to connect a required service.
- Never store raw user OAuth tokens or client secrets in local chat logs.

### 7. Verification & Acceptance Criteria
- Unit Test: Mock disconnected Composio client in `server/composio.test.ts`; confirm agent returns structured suspension frame and auth link.
- Device Test: Trigger a calendar task without auth; verify interactive connection card appears in Android chat screen.

---

# PHASE 13 — CAPABILITY STATE AWARENESS

### 1. Architectural Objective & Motivation
Agents must possess live, authoritative awareness of capability health before attempting execution. Claiming a capability is working when underlying drivers are down, permissions are revoked, or ports are unmapped violates system integrity.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/types.ts`, `server/capabilities/capability-registry.ts`
- Android Status Source: `android/app/src/main/kotlin/com/openmausbot/companion/host/HostStatus.kt`
- Test Coverage: `server/capabilities/delight.test.ts`, `server/capabilities/observability.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type CapabilityOperationalState =
  | "AVAILABLE"
  | "PERMISSION_REQUIRED"
  | "AUTH_REQUIRED"
  | "DRIVER_OFFLINE"
  | "RATE_LIMITED"
  | "DEPENDENCY_MISSING";

export interface CapabilityHealthStatus {
  capabilityId: string;
  state: CapabilityOperationalState;
  lastCheckedMs: number;
  diagnosticDetails?: string;
  remediationAction?: "prompt_permission" | "prompt_auth" | "restart_driver" | "wait";
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: A capability with `DRIVER_OFFLINE` status must never be selected by the planner.
- Invariant: Probing capability health must execute with a hard timeout of 500ms to prevent blocking turn execution.

### 5. Failure Classification & Recovery Protocols
- `ERR_CAPABILITY_PROBE_FAILED`: Subsystem health check timed out.
  - Recovery: Mark capability as `TEMPORARILY_UNAVAILABLE` and route to alternative capability.

### 6. Anti-Patterns & Prohibited Implementations
- Do not assume capability availability based on static configuration files.
- Never hide permission or driver failures behind generic "server error" messages.

### 7. Verification & Acceptance Criteria
- Unit Test: Run health probe suite in `server/capabilities/capability-registry.test.ts`; confirm accurate status reporting for all registered tools.
- Device Test: Kill `BrowserDriverServer.kt` on the phone; verify browser capability immediately transitions to `DRIVER_OFFLINE`.

---

# PHASE 14 — RISK-AWARE AUTONOMY

### 1. Architectural Objective & Motivation
Implement a balanced, tier-based autonomy model: safe read-only operations proceed immediately without friction, while destructive, irreversible, or externally visible actions require explicit user consent.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/safety-policy.ts`, `server/permission-policy.ts`
- Shared Types: `shared/approval-mode.ts`
- Test Coverage: `server/capabilities/safety-policy.test.ts`, `server/auto-approve.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type RiskTier = "low" | "medium" | "high";

export interface RiskEvaluationRequest {
  capabilityId: string;
  operation: string;
  parameters: Record<string, unknown>;
  approvalMode: "ask" | "edits" | "auto" | "full";
}

export interface RiskEvaluationResult {
  tier: RiskTier;
  requiresExplicitConfirmation: boolean;
  consequentialImpactDescription: string;
  reversible: boolean;
}
```

### 4. State Transitions & Behavioral Invariants
| Action Category | Examples | Risk Tier | Execution Policy under "ask" Mode |
| :--- | :--- | :--- | :--- |
| Read / Inspect | Read file, search web, list apps, get location | Low | Immediate autonomous execution |
| State Creation | Create draft, write scratchpad file, cache data | Medium | Autonomous execution if in task scope |
| External / Destructive | Delete file, send email, post commit, format disk | High | Halt and prompt for explicit confirmation |

### 5. Failure Classification & Recovery Protocols
- `ERR_CONFIRMATION_REJECTED`: User taps "Reject" or declines high-risk operation.
  - Recovery: Abort operation safely, log rejection to turn context, prompt agent to formulate alternative non-destructive strategy.

### 6. Anti-Patterns & Prohibited Implementations
- Do not prompt for confirmation on benign read operations (e.g., reading a workspace markdown file).
- Never allow a "full auto" setting to silently execute irreversible mass deletions.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/capabilities/safety-policy.test.ts`; verify `rm -rf` and file deletions are classified as `high` risk and require confirmation.
- Device Test: Execute a file creation followed by a file deletion; verify creation completes silently while deletion prompts an approval modal.

---

# PHASE 15 — NATURAL UNCERTAINTY

### 1. Architectural Objective & Motivation
Agents should handle ambiguity gracefully without dumping paragraphs of disclaimers. If uncertainty has minor consequences, make a reasonable assumption and state it concisely; if consequences are significant, ask a focused clarifying question.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/safety-policy.ts`, `server/system-prompt.ts`
- Client UI: `android/core/.../core/AskQuestion.kt`
- Test Coverage: `server/agent-behavioral-contract.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface AmbiguityResolution {
  ambiguityType: "minor_preference" | "critical_intent" | "irreversible_fork";
  consequenceLevel: "negligible" | "moderate" | "critical";
  strategy: "proceed_with_assumption" | "ask_focused_question";
  statedAssumption?: string;
  clarificationQuestion?: {
    prompt: string;
    options: string[];
    allowCustomInput: boolean;
  };
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Clarification questions must offer 2 to 4 concise options plus an open text field.
- Invariant: Never ask multiple nested clarifying questions in a single turn.

### 5. Failure Classification & Recovery Protocols
- `ERR_PARALYSIS_BY_UNCERTAINTY`: Agent repeatedly asks clarifying questions for minor details.
  - Recovery: Force default reasonable assumption and proceed if risk tier is `low`.

### 6. Anti-Patterns & Prohibited Implementations
- Do not prefix responses with generic disclaimers: "As an AI, I am not completely sure, but..."
- Do not halt execution when a sensible default exists.

### 7. Verification & Acceptance Criteria
- Behavioral Test: User prompt: "Summarize the project"; verify agent summarizes the active workspace project without asking "Which project do you mean?".
- Behavioral Test: User prompt: "Delete the database"; verify agent halts and confirms exact database name.

---

# PHASE 16 — RESPONSE INTELLIGENCE

### 1. Architectural Objective & Motivation
Eliminate rigid, robotic response templates. Output structure, length, tone, and formatting must adapt dynamically to the query type, balancing conversational conciseness with technical depth. Furthermore, browser screenshots and visual telemetry must be strictly decoupled from normal chat text.

### 2. Canonical Subsystem Mapping
- Authority: `server/system-prompt.ts`, `server/screen-frame-gate.ts`
- Client Renderer: `android/core/.../core/Markdown.kt`, `android/app/.../ui/ChatScreen.kt`
- Test Coverage: `server/screen-frame-gate.test.ts`, `server/system-prompt.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type ResponseModalityShape = "short_conversational" | "structured_report" | "code_block" | "tabular_comparison";

export interface ResponseFormattingPlan {
  shape: ResponseModalityShape;
  includeVisualAttachment: boolean;
  maxWordsTarget?: number;
  useMarkdownTables: boolean;
  requireExecutiveConclusion: boolean;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Screen frames are NEVER attached to chat messages unless explicit visual intent patterns match (`server/screen-frame-gate.ts`).
- Invariant: Simple factual questions receive answers in 1 to 3 sentences without superfluous headings.

### 5. Failure Classification & Recovery Protocols
- `ERR_CHAT_POLLUTION_BLOCKED`: A tool attempted to push a raw browser screen capture into chat history.
  - Recovery: `screen-frame-gate.ts` drops the frame from the message store, routing it solely to the SSE stream for Watch Computer.

### 6. Anti-Patterns & Prohibited Implementations
- Never force every response into: Summary -> Steps -> Conclusion.
- Never output raw base64 data URIs directly into Markdown text.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/screen-frame-gate.test.ts`; confirm all 18 intent and surface routing tests pass.
- Device Test: Run research query on Samsung Galaxy A07; confirm Watch Computer shows live browser while chat displays only clean synthesized text.

---

# PHASE 17 — JUDGMENT AND RECOMMENDATIONS

### 1. Architectural Objective & Motivation
Transform MOBOT from an evasive search engine into an opinionated teammate. When asked for advice, comparisons, or technical decisions, the agent must evaluate tradeoffs, take a stand, and offer an explicit recommendation while distinguishing facts from judgment.

### 2. Canonical Subsystem Mapping
- Authority: `server/system-prompt.ts`, `server/bot-profile.ts`
- Test Coverage: `server/agent-behavioral-contract.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface RecommendationPayload {
  optionsEvaluated: Array<{ name: string; pros: string[]; cons: string[] }>;
  recommendedOption: string;
  rationale: string;
  criticalTradeoff: string;
  distinctionBetweenFactAndOpinion: string;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Recommendations must state the primary decision criterion (e.g., speed vs. maintainability).
- Invariant: Never list options without providing a recommended choice when explicitly asked "What should I do?".

### 5. Failure Classification & Recovery Protocols
- `ERR_EXCESSIVE_HEDGING`: Response contains >3 generic disclaimer phrases ("It depends", "Both have merit", etc.) without a conclusion.
  - Recovery: System prompt penalty enforces direct recommendation insertion.

### 6. Anti-Patterns & Prohibited Implementations
- Do not respond with endless neutral lists that leave the user with the entire burden of choice.
- Do not recommend dangerous or unverified options.

### 7. Verification & Acceptance Criteria
- Behavioral Test: Ask "Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?"; verify agent unequivocally recommends SQLite and explains why.

---

# PHASE 18 — NATURAL CONVERSATION

### 1. Architectural Objective & Motivation
Enable the agent to engage in fluid, human-like dialogue when appropriate. When the user is conversational, the agent should respond with natural cadence rather than structured technical memos.

### 2. Canonical Subsystem Mapping
- Authority: `server/system-prompt.ts`
- Speech Integration: `server/tts/speech-text.ts`, `android/app/.../dictation/SpeechDictation.kt`
- Test Coverage: `server/tts/speech-text.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface ConversationalCadencePolicy {
  conversationalMode: "casual" | "work" | "crisis";
  allowSlangOrColloquialism: boolean;
  targetSentenceCount: number;
  suppressBulletPoints: boolean;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: A one-word greeting ("Hey", "Morning") receives a one-sentence warm reply, not a feature menu.
- Invariant: Retain conversational context across rapid back-and-forth dialogue.

### 5. Failure Classification & Recovery Protocols
- `ERR_UNNATURAL_VERBOSITY`: Conversational greeting yields >100 words of output.
  - Recovery: Dynamic prompt guard truncates canned pleasantries.

### 6. Anti-Patterns & Prohibited Implementations
- Never output: "Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals?".

### 7. Verification & Acceptance Criteria
- Behavioral Test: User sends "Thanks, that worked!"; verify agent responds with a brief, natural acknowledgement like "Glad to hear that. Let me know when you're ready for the next step."

---

# PHASE 19 — PROACTIVE INTELLIGENCE

### 1. Architectural Objective & Motivation
Agents should observe contextual cues and offer timely, high-value suggestions without becoming intrusive spam generators. Suggestions must pass a high relevance threshold before triggering.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/routine-engine.ts`, `server/watches.ts`
- Client Attention: `android/app/src/main/kotlin/com/openmausbot/companion/ui/AttentionInbox.kt`
- Test Coverage: `server/capabilities/routine-engine.test.ts`, `server/watches.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface ProactiveSuggestion {
  id: string;
  triggerEvent: "calendar_conflict" | "approaching_deadline" | "stale_dependency" | "weather_alert";
  relevanceScore: number; // Must exceed 0.85 to surface
  headline: string;
  suggestedActionTitle: string;
  suggestedActionPayload: Record<string, unknown>;
  cooldownPeriodMs: number;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: A maximum of one proactive suggestion is permitted every 4 hours unless classified as critical.
- Invariant: Dismissed suggestions must not re-trigger within 48 hours.

### 5. Failure Classification & Recovery Protocols
- `ERR_SUGGESTION_SPAM_DETECTED`: Multiple suggestions generated within cooldown window.
  - Recovery: Rate limiter suppresses notification, logs event to silent attention queue.

### 6. Anti-Patterns & Prohibited Implementations
- Never send proactive alerts for obvious or trivial observations.
- Never interrupt an active user turn with an unrelated proactive suggestion.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/watches.test.ts`; confirm rate limits and relevance filters suppress low-scoring suggestions.
- Device Test: Simulate a calendar conflict 15 minutes before meeting; verify single clean alert appears in `AttentionInbox.kt`.

---

# PHASE 20 — BACKGROUND EXECUTION

### 1. Architectural Objective & Motivation
Long-running agent workflows must continue executing reliably when the Android companion app transitions to the background. Tasks must survive Android OS process lifecycles, network handovers, and memory pressure.

### 2. Canonical Subsystem Mapping
- Authority: `android/app/src/main/kotlin/com/openmausbot/companion/host/HarnessService.kt`, `AlwaysOnConnectionService.kt`
- Server Engine: `server/sessions.ts`, `server/channel-queue.ts`
- Test Coverage: `server/round5-settings-updater-lifecycle.test.ts`, `server/channel-queue.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface BackgroundExecutionState {
  sessionId: string;
  activeTaskId: string;
  foregroundServicePid: number;
  wakelockHeld: boolean;
  batteryOptimizationWhitelisted: boolean;
  executionHeartbeatMs: number;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
stateDiagram-v2
    state "App in Foreground" as Fore
    state "Android onPause / onStop" as Back
    state "Foreground Service Active (Notification)" as Service
    state "Task Completion" as Done
    state "Post Completion Notification" as Notify

    [*] --> Fore
    Fore --> Back: User Minimizes App
    Back --> Service: Acquire Partial WakeLock
    Service --> Done: Execution Loop Finishes
    Done --> Notify: Dispatch Android Notification
    Notify --> [*]
```

- Invariant: Long-running background execution requires an active Android Foreground Service with a visible notification.
- Invariant: Release partial wakelocks immediately upon task completion or pause.

### 5. Failure Classification & Recovery Protocols
- `ERR_PROCESS_KILLED_BY_OS`: Android Low Memory Killer (LMK) terminates the host process.
  - Recovery: Upon `AlwaysOnBootReceiver` or app relaunch, load persisted job state from disk and resume.

### 6. Anti-Patterns & Prohibited Implementations
- Never simulate background progress with timers that do not perform real work.
- Never leave orphaned wakelocks active when a task is blocked or completed.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/channel-queue.test.ts` verifying queued messages survive disconnect/reconnect cycles.
- Device Test: Launch a 3-minute research task on Samsung Galaxy A07, press Home button, lock screen; verify task finishes and triggers notification upon completion.

---

# PHASE 21 — PERSISTENT AGENT JOBS

### 1. Architectural Objective & Motivation
Durable jobs represent long-horizon tasks that persist across days, server restarts, and device reboots. Jobs require a formal state machine, transaction journals, and deterministic resumption capabilities.

### 2. Canonical Subsystem Mapping
- Authority: `server/tasks.ts`, `server/goals.ts`, `server/store.ts`
- Client View: `android/app/src/main/kotlin/com/openmausbot/companion/ui/BotOverviewScreen.kt`
- Test Coverage: `server/tasks.test.ts`, `server/goals.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type JobState =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED_FOR_USER"
  | "BLOCKED_DEPENDENCY"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface PersistentAgentJob {
  jobId: string;
  botId: string;
  threadId: string;
  title: string;
  objective: string;
  state: JobState;
  progressPercent: number;
  currentMilestoneIndex: number;
  checkpointPayloadPath: string;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs?: number;
  failureReason?: string;
}
```

### 4. State Transitions & Behavioral Invariants
| Current State | Event Trigger | Next State | Persistence Invariant |
| :--- | :--- | :--- | :--- |
| `QUEUED` | Worker picks up task | `RUNNING` | Write atomic journal entry |
| `RUNNING` | Auth required | `PAUSED_FOR_USER` | Flush checkpoint state to disk |
| `PAUSED_FOR_USER` | User connects service | `RUNNING` | Reload from checkpoint |
| `RUNNING` | Success verified | `COMPLETED` | Archive job record |

### 5. Failure Classification & Recovery Protocols
- `ERR_CORRUPT_JOB_CHECKPOINT`: Checkpoint file corrupted during sudden power loss.
  - Recovery: Roll back to previous milestone snapshot in `server/checkpoints.ts`.

### 6. Anti-Patterns & Prohibited Implementations
- Do not hold active job state solely in in-memory JavaScript variables.
- Never delete job history without explicit user confirmation.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/tasks.test.ts`; confirm serialization and recovery across mocked node process crashes.
- Device Test: Start a persistent job, execute `adb shell am kill com.openmausbot.companion`, re-open app; verify job displays active running state.


# PHASE 22 — TRANSFORM WATCH COMPUTER INTO THE AGENT WORKSPACE

### 1. Architectural Objective & Motivation
Watch Computer must cease to be an isolated or simulated demo viewport. It is the primary visual and operational window through which the user observes the physical and digital work of the agent. It must render authentic, live telemetry from the operating system, the browser driver, the terminal PTY, and external services.

### 2. Canonical Subsystem Mapping
- Authority: `server/screen-frame-source.ts`, `server/sse-fanout.ts`
- Client Surface: `android/app/src/main/kotlin/com/openmausbot/companion/ui/ComputerScreen.kt`
- Streaming Transport: `android/core/.../core/Sse.kt`, `Frames.kt`
- Test Coverage: `server/screen-frame-source.test.ts`, `server/testing/sse.test.ts`

### 3. Formal Data Contract & Schema Specifications
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

```kotlin
// android/app/src/main/kotlin/com/openmausbot/companion/ui/ComputerScreen.kt
sealed class ComputerSurfaceState {
    object Idle : ComputerSurfaceState()
    data class BrowserLive(val currentUrl: String, val frame: Bitmap, val isNavigating: Boolean) : ComputerSurfaceState()
    data class TerminalLive(val activeCommand: String, val ptyBuffer: String) : ComputerSurfaceState()
    data class PhoneVision(val screenBitmap: Bitmap, val targetNodeBounds: Rect?) : ComputerSurfaceState()
    data class FileStreaming(val filePath: String, val lineCount: Int) : ComputerSurfaceState()
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
stateDiagram-v2
    state "Idle (Standby)" as Idle
    state "Phone Vision (Android UI)" as Phone
    state "Browser Execution (NanoHTTPD)" as Browser
    state "Terminal Session (PTY)" as Terminal
    state "File & Tool Activity" as Tools

    [*] --> Idle
    Idle --> Browser: Agent Starts Web Research
    Idle --> Phone: Agent Starts Android App Control
    Idle --> Terminal: Agent Starts Shell Execution
    Browser --> Idle: Browser Session Closed
    Phone --> Idle: Android Task Finished
    Terminal --> Idle: Command Exited (code 0)
```

- Invariant: When an agent is not actively executing, Watch Computer must display an authentic idle state; it must never loop a synthetic animation.
- Invariant: Streaming frame rate adapts dynamically: 10 FPS during active UI interaction, falling to 0.5 FPS or event-driven on static pages.

### 5. Failure Classification & Recovery Protocols
- `ERR_WATCH_STREAM_DISCONNECTED`: SSE stream dropped due to network or host pause.
  - Recovery: `ComputerScreen.kt` displays a subtle reconnecting indicator and automatically reconnects with exponential backoff without resetting user viewport scroll.

### 6. Anti-Patterns & Prohibited Implementations
- Do not display pre-recorded MP4s or mocked screenshots.
- Never show an active progress spinner when the server process is idle.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/screen-frame-source.test.ts`; confirm frame hashing and deduplication work correctly.
- Device Test: Open Watch Computer on Samsung Galaxy A07; start research task; confirm live browser navigation frames render smoothly without freezing the UI.

---

# PHASE 23 — WATCH COMPUTER: PHONE VISION

### 1. Architectural Objective & Motivation
When MOBOT performs Android computer-use (automating local apps on the phone), Watch Computer must render what the agent sees: live screen captures, semantic bounding boxes of target nodes, and real-time interaction feedback (taps, typing, scrolls).

### 2. Canonical Subsystem Mapping
- Authority: `server/android-computer.ts`, `server/screen-frame-gate.ts`
- Native Capture Anchor: `android/app/src/main/kotlin/com/openmausbot/companion/terminal/PtyNative.kt`, Android MediaProjection / Accessibility
- Test Coverage: `server/android-computer.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface PhoneVisionObservationPayload {
  captureTimestampMs: number;
  width: number;
  height: number;
  screenshotPngBase64: string;
  focusedPackageName: string;
  focusedActivityName: string;
  highlightedElementBounds?: { left: number; top: number; right: number; bottom: number };
  detectedTextNodes: Array<{ text: string; bounds: number[] }>;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: All captured frames are scrubbed of sensitive secure fields (passwords, PINs) via Android Accessibility node classification before network transmission.
- Invariant: Highlighted element bounding boxes must align precisely with the physical touch coordinates executed by the gesture engine.

### 5. Failure Classification & Recovery Protocols
- `ERR_SCREEN_CAPTURE_BLOCKED`: Target application sets `FLAG_SECURE`.
  - Recovery: Flag surface as protected; notify agent that visual inspection is blocked by security policy; fall back to semantic accessibility tree inspection.

### 6. Anti-Patterns & Prohibited Implementations
- Never render fake phone screens or generic smartphone mockups.
- Never retain raw unencrypted screen captures of private applications on disk.

### 7. Verification & Acceptance Criteria
- Device Test: Run on physical Samsung Galaxy A07; automate opening the Calculator app; verify Watch Computer displays the live Calculator interface with tap target overlays.

---

# PHASE 24 — WATCH COMPUTER: BROWSER

### 1. Architectural Objective & Motivation
The browser surface in Watch Computer must stream the actual headless or foreground WebView session running inside `BrowserDriverServer.kt`. Users must see real URL navigation, DOM rendering, form interactions, and search result extraction in real time.

### 2. Canonical Subsystem Mapping
- Authority: `server/android-browser.ts`, `server/browser-runtime.ts`
- Android Host Driver: `android/app/src/main/kotlin/com/openmausbot/companion/host/BrowserDriverServer.kt`
- Test Coverage: `server/android-browser.test.ts`, `server/browser-fixture.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface BrowserTelemetryFrame {
  sessionId: string;
  url: string;
  title: string;
  httpStatus: number;
  viewportDimensions: { width: number; height: number };
  frameJpegBase64: string;
  scrollOffset: { x: number; y: number };
  isNavigating: boolean;
  domElementTarget?: string;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
sequenceDiagram
    participant Browser as BrowserDriverServer (Port 18800)
    participant Server as Node.js Runtime (Port 18799)
    participant Watch as Watch Computer UI

    Browser->>Server: HTTP POST /screen-update (frame + URL)
    Server->>Server: screen-frame-gate: route to SSE (drop from chat)
    Server->>Watch: SSE event: kind="screen", surface="browser"
    Watch->>Watch: Render live frame + address bar URL
```

### 5. Failure Classification & Recovery Protocols
- `ERR_BROWSER_CRASH`: The underlying WebView process crashes or runs out of memory.
  - Recovery: `BrowserDriverServer.kt` respawns the WebView instance, resets connection, and informs the agent to reload the URL.

### 6. Anti-Patterns & Prohibited Implementations
- Do not generate fake browser navigation events when no HTTP connection has been made.
- Do not route browser frames into conversation chat attachments unless explicitly commanded.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/android-browser.test.ts`; verify browser commands emit valid frame events.
- Device Test: Trigger a search on Hacker News via the agent; verify Watch Computer renders the actual Hacker News frontpage and article text.

---

# PHASE 25 — WATCH COMPUTER: TERMINAL

### 1. Architectural Objective & Motivation
When the agent executes shell commands, build scripts, or file transformations, Watch Computer must provide a live ANSI-compliant terminal emulator window streaming real stdout, stderr, and exit codes from the local or VPS PTY.

### 2. Canonical Subsystem Mapping
- Authority: `server/service-cli.ts`, `server/android-computer.ts`
- Client Terminal: `android/app/src/main/kotlin/com/openmausbot/companion/terminal/TerminalBuffer.kt`, `PtyNative.kt`
- Test Coverage: `server/service-cli.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface TerminalTelemetryStreamEvent {
  sessionId: string;
  commandString: string;
  cwd: string;
  outputChunkAnsi: string;
  stream: "stdout" | "stderr";
  exitCode?: number;
  durationMs?: number;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Terminal buffer maintains a rolling window of 1,000 lines, discarding oldest lines to bound memory.
- Invariant: Passwords or tokens passed in commands must be redacted in the terminal buffer using `redactSecretsInText()`.

### 5. Failure Classification & Recovery Protocols
- `ERR_COMMAND_TIMEOUT`: Subprocess hangs indefinitely.
  - Recovery: Watchdog terminates process group with `SIGKILL` after 30 seconds; logs error code 137.

### 6. Anti-Patterns & Prohibited Implementations
- Never manufacture fake command lines or simulate compilation logs.
- Do not expose root or unsandboxed shell access when restricted by permission policy.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/service-cli.test.ts`; confirm chunk streaming, exit code capture, and buffer rotation.
- Device Test: Execute a terminal `ls -la` command; verify Watch Computer displays the exact command and directory listing in the terminal tab.

---

# PHASE 26 — WATCH COMPUTER: FILE ACTIVITY

### 1. Architectural Objective & Motivation
Agents frequently read documentation, edit scripts, and generate artifacts. Watch Computer must provide a dedicated file activity pane that displays the exact paths being accessed, modified, or generated in real time, with visual diff highlighting.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/device-files.ts`, `server/workspace.ts`
- Test Coverage: `server/workspace.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface FileActivityEvent {
  eventId: string;
  filePath: string;
  operation: "read" | "create" | "modify" | "delete";
  byteSize: number;
  diffSummary?: { linesAdded: number; linesRemoved: number };
  activeSnippet?: string;
  timestampMs: number;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: File operations outside the bot's authorized workspace root are blocked immediately.
- Invariant: Binary files are designated with metadata only; do not attempt raw text diff rendering on images or compiled binaries.

### 5. Failure Classification & Recovery Protocols
- `ERR_FILE_NOT_FOUND`: Target file does not exist during read.
  - Recovery: Return structured error to agent; log missing path in file pane; trigger replanning.

### 6. Anti-Patterns & Prohibited Implementations
- Do not claim a file was modified before the atomic write operation has completed and flushed to disk.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/workspace.test.ts`; verify workspace bounds enforcement.
- Device Test: Agent creates `report.md`; verify file activity pane updates immediately with the filename and line count.

---

# PHASE 27 — WATCH COMPUTER: TOOLS AND SERVICES

### 1. Architectural Objective & Motivation
When the agent invokes external integrations (Google Calendar, Gmail, GitHub, Maps), Watch Computer must present a clear status surface showing the active service, the exact endpoint being called, parameter payloads (scrubbed of secrets), and response latency.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/observability.ts`, `server/composio.ts`
- Test Coverage: `server/capabilities/observability.ts`, `server/composio.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface ServiceExecutionTelemetry {
  serviceName: string;
  actionName: string;
  requestParamsScrubbed: Record<string, unknown>;
  executionState: "invoking" | "waiting_for_response" | "succeeded" | "failed";
  latencyMs?: number;
  responseSummary?: string;
  timestampMs: number;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: All auth tokens, session headers, and passwords must be scrubbed before telemetry serialization.
- Invariant: Service status transitions from `invoking` to `succeeded` must reflect actual HTTP receipt.

### 5. Failure Classification & Recovery Protocols
- `ERR_EXTERNAL_SERVICE_5XX`: SaaS provider returns HTTP 500 or 503.
  - Recovery: Display service error state in Watch Computer; agent evaluates alternative provider or pauses.

### 6. Anti-Patterns & Prohibited Implementations
- Do not simulate service interaction when an API key is missing or invalid.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/composio.test.ts`; confirm telemetry events emit accurately for all tool executions.
- Device Test: Trigger a calendar lookup; verify Watch Computer displays "Google Calendar: list_events (Succeeded)".

---

# PHASE 28 — WATCH COMPUTER: UNIFIED ACTIVITY TIMELINE

### 1. Architectural Objective & Motivation
Synthesize all disparate execution streams (phone vision, browser, terminal, files, tools) into a coherent, real-time chronological activity timeline. Users can inspect the timeline to understand the sequence of actions without parsing raw JSON logs.

### 2. Canonical Subsystem Mapping
- Authority: `server/task-timeline.ts`, `server/capabilities/observability.ts`
- Client Timeline: `android/app/src/main/kotlin/com/openmausbot/companion/ui/ComputerScreen.kt`
- Test Coverage: `server/task-timeline.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface TimelineEntry {
  id: string;
  turnNumber: number;
  timestampMs: number;
  category: "browser" | "terminal" | "file" | "service" | "decision" | "verification";
  summary: string;
  detail?: string;
  status: "in_progress" | "success" | "failed" | "skipped";
  durationMs?: number;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart TD
    E1["Browser: Opened Hacker News"] --> E2["Browser: Extracted Top 5 Stories"]
    E2 --> E3["File: Written to digest.md"]
    E3 --> E4["Terminal: Linted Markdown Output"]
    E4 --> E5["Verification: Summary Complete & Accurate"]
```

- Invariant: The timeline contains only objective, externally observable actions; internal model reasoning tokens are strictly excluded.

### 5. Failure Classification & Recovery Protocols
- `ERR_TIMELINE_BUFFER_OVERFLOW`: Timeline exceeds 500 entries in a single job.
  - Recovery: Collapse completed early milestones into aggregated milestone summaries.

### 6. Anti-Patterns & Prohibited Implementations
- Never insert speculative or unverified actions into the timeline.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/task-timeline.test.ts`; confirm correct chronological ordering and state updates.
- Device Test: Complete a 5-step task; verify timeline on Android displays all 5 steps with matching timestamps.

---

# PHASE 29 — WATCH COMPUTER CONTROLS

### 1. Architectural Objective & Motivation
Provide supervisory controls over agent execution directly from the Watch Computer surface. The user must be able to pause an active task, resume a paused task, or cancel runaway execution cleanly without leaving lingering child processes.

### 2. Canonical Subsystem Mapping
- Authority: `server/index.ts`, `server/channel-queue.ts`
- Client UI: `android/app/src/main/kotlin/com/openmausbot/companion/ui/ComputerScreen.kt`
- Test Coverage: `server/steer-queue.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type SupervisoryControlAction = "pause" | "resume" | "cancel" | "step";

export interface SupervisoryControlRequest {
  taskId: string;
  action: SupervisoryControlAction;
  requestedBy: "user_ui" | "watchdog" | "system_low_memory";
  timestampMs: number;
}
```

```kotlin
// android/app/src/main/kotlin/com/openmausbot/companion/ui/ComputerScreen.kt
@Composable
fun WatchComputerControlsBar(
    executionState: ExecutionState,
    onPauseClick: () -> Unit,
    onResumeClick: () -> Unit,
    onCancelClick: () -> Unit
)
```

### 4. State Transitions & Behavioral Invariants
| Control Signal | Current State | Target State | Process Side Effect |
| :--- | :--- | :--- | :--- |
| `pause` | `RUNNING` | `PAUSED` | Sends `SIGSTOP` to child processes; freezes loop |
| `resume` | `PAUSED` | `RUNNING` | Sends `SIGCONT` to child processes; resumes turn |
| `cancel` | Any active | `CANCELLED` | Sends `SIGTERM` followed by `SIGKILL`; flushes state |

### 5. Failure Classification & Recovery Protocols
- `ERR_ORPHANED_PROCESS_ON_CANCEL`: Subprocess ignores `SIGTERM`.
  - Recovery: Process supervisor escalates to `SIGKILL` after 2000ms.

### 6. Anti-Patterns & Prohibited Implementations
- Do not implement "fake pause" that leaves network sockets and background workers executing.
- Never disable the "Cancel" button during execution.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/steer-queue.test.ts`; verify pause and resume signals cleanly control the turn worker.
- Device Test: Start a long script in Watch Computer; tap "Pause"; verify execution halts; tap "Resume"; verify execution continues.


# PHASE 30 — AGENT IDENTITY THROUGHOUT THE UI

### 1. Architectural Objective & Motivation
Agent identity must be pervasive, consistent, and recognizable across every surface of the Android application: conversation headers, message bubbles, Watch Computer status capsules, notifications, and overview trees. Users must always know exactly which specialist is currently executing.

### 2. Canonical Subsystem Mapping
- Authority: `server/bot-directory.ts`, `server/bot-profile.ts`
- Client UI Anchors: `android/app/src/main/kotlin/com/openmausbot/companion/ui/BotAvatar.kt`, `BotOverviewScreen.kt`, `Chrome.kt`
- Test Coverage: `server/bot-directory.test.ts`, `server/bot-profile.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface BotVisualIdentity {
  botId: string;
  displayName: string;
  roleTitle: string;
  avatarSeed: string;
  themeColorHex: string;
  mascotFaceVariant: "neutral" | "focused" | "working" | "celebrating" | "alert";
  statusDescription: string;
}
```

```kotlin
// android/app/src/main/kotlin/com/openmausbot/companion/ui/BotAvatar.kt
@Composable
fun BotIdentityHeader(
    bot: BotVisualIdentity,
    isExecuting: Boolean,
    modifier: Modifier = Modifier
)
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Generic labels like "AI Assistant" or "System Bot" are strictly forbidden in UI headers when an active bot profile exists.
- Invariant: Dynamic mascot face expressions must reflect authentic execution states (e.g., transition to `working` during tool calls, `neutral` when idle).

### 5. Failure Classification & Recovery Protocols
- `ERR_UNKNOWN_BOT_PROFILE`: Client receives a message referencing an unindexed bot ID.
  - Recovery: Query `server/bot-directory.ts` for catalog resolution; fall back to root bot identity.

### 6. Anti-Patterns & Prohibited Implementations
- Do not hardcode bot names or avatar paths in static layout files.
- Never use cartoonish or distracting animation loops for the mascot avatar.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/bot-directory.test.ts`; verify metadata consistency across all default and user-created bots.
- Device Test: Switch bots on Samsung Galaxy A07; confirm avatar, color accents, and role title instantly update in the top app bar.

---

# PHASE 31 — SPECIALIZED BOT BEHAVIOR

### 1. Architectural Objective & Motivation
Bots must exhibit distinct, role-specialized behavioral traits. A "Researcher" bot investigates deeply with citations, a "Coder" bot focuses on clean diffs and tests, and a "Planner" bot produces structured dependency trees. Specialization must influence tool selection, search aggressiveness, and verification standards.

### 2. Canonical Subsystem Mapping
- Authority: `server/bot-profile.ts`, `server/specialist-swarm.ts`, `server/system-prompt.ts`
- Test Coverage: `server/specialist-swarm.test.ts`, `server/agent-behavioral-contract.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface SpecializationProfile {
  roleId: "researcher" | "coder" | "planner" | "generalist";
  heuristics: {
    minimumSourceCitations?: number;
    requireAutomatedTestRun?: boolean;
    requireDependencyOrdering?: boolean;
    defaultSearchDepth: "shallow" | "deep" | "exhaustive";
  };
  customPromptInjections: string[];
}
```

### 4. State Transitions & Behavioral Invariants
| Role | Primary Tool Affinity | Forbidden / Deprioritized Modalities | Output Verification Standard |
| :--- | :--- | :--- | :--- |
| Researcher | Browser, Web Search, PDF Reader | Shell Execution, Code Editing | Verifiable URLs and source citations |
| Coder | Terminal, Filesystem, Git | Casual Chatting, Generic Summaries | Compiling code + passing test suite |
| Planner | Goals, Milestones, Routines | Direct Code Execution | Ordered tasks with dependency graphs |

### 5. Failure Classification & Recovery Protocols
- `ERR_SPECIALIST_BOUNDARY_OVERSTEP`: Researcher bot attempts to invoke code refactoring tools.
  - Recovery: Tool router blocks invocation; suggests delegating task to Coder specialist (Phase 33).

### 6. Anti-Patterns & Prohibited Implementations
- Do not create superficial bot differences that only change the greeting text.
- Do not hardcode a single monolithic system prompt for all bots.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/specialist-swarm.test.ts`; confirm specialists enforce their respective heuristic rules.
- Behavioral Test: Provide identical engineering query to Researcher and Coder; confirm Researcher returns cited papers while Coder returns executable implementation code and tests.

---

# PHASE 32 — DO NOT MANUFACTURE MULTI-BOT DEBATES

### 1. Architectural Objective & Motivation
Prevent artificial multi-bot debates or token-wasting synthetic banter. In normal operation, one designated primary agent handles the user's objective end-to-end. Multi-bot interaction is permitted only when explicitly requested or required by genuine multi-domain orchestration.

### 2. Canonical Subsystem Mapping
- Authority: `server/chief-of-staff.ts`, `server/specialist-swarm.ts`
- Test Coverage: `server/chief-of-staff.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface OrchestrationRoutingDecision {
  mode: "direct_single_agent" | "explicit_collaborative_swarm";
  primaryBotId: string;
  participatingBotIds: string[];
  justification: string;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: By default, 100% of standard user turns route to `mode: "direct_single_agent"`.
- Invariant: Bots are strictly prohibited from chatting amongst themselves unless producing a unified synthesized result for the user.

### 5. Failure Classification & Recovery Protocols
- `ERR_SPURIOUS_SWARM_TRIGGER`: Swarm triggered for a simple, single-domain query.
  - Recovery: `chief-of-staff.ts` overrides routing, forces single-agent mode, drops secondary bots.

### 6. Anti-Patterns & Prohibited Implementations
- Never render conflicting, uncoordinated replies from three different bots in the same conversation thread.
- Prohibit simulated bot-to-bot "arguments" designed solely for visual entertainment.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/chief-of-staff.test.ts`; confirm single-agent dispatch occurs on 100% of standard benchmark tasks.
- Behavioral Test: Ask "What is the capital of France?"; confirm exactly one bot responds concisely without secondary bot commentary.

---

# PHASE 33 — MULTI-AGENT ORCHESTRATION

### 1. Architectural Objective & Motivation
When a massive or cross-disciplinary goal legitimately requires multiple specialists (e.g., building a complete application requiring architecture, backend, Android UI, and documentation), orchestrate work hierarchically. One primary coordinator delegates sub-tasks, collects verified artifacts, and synthesizes the final output.

### 2. Canonical Subsystem Mapping
- Authority: `server/chief-of-staff.ts`, `server/specialist-swarm.ts`
- Task Delegation: `server/group-goal-run.ts`
- Test Coverage: `server/group-goal-run.test.ts`, `server/specialist-swarm.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface SubtaskDelegation {
  subtaskId: string;
  parentGoalId: string;
  assignedBotId: string;
  objective: string;
  inputArtifacts: string[];
  expectedOutputSchema: Record<string, unknown>;
  status: "assigned" | "running" | "completed" | "failed";
  returnedArtifacts?: string[];
}

export interface SwarmSynthesisPayload {
  primaryBotId: string;
  completedSubtasks: SubtaskDelegation[];
  unifiedExecutiveSummary: string;
  allDeliverables: Array<{ path: string; summary: string }>;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart TD
    UserReq["Complex Multi-Domain User Objective"] --> Chief["Primary Coordinator (Chief of Staff)"]
    Chief --> Sub1["Subtask 1 -> Researcher Specialist"]
    Chief --> Sub2["Subtask 2 -> Coder Specialist"]
    Sub1 --> Art1["Verified Research Artifact"]
    Sub2 --> Art2["Verified Code Artifact"]
    Art1 --> Synth["Primary Coordinator Synthesis"]
    Art2 --> Synth
    Synth --> Deliver["Coherent Unified Delivery to User"]
```

### 5. Failure Classification & Recovery Protocols
- `ERR_DELEGATED_SUBTASK_FAILURE`: A specialist fails its assigned milestone.
  - Recovery: Chief of Staff reviews failure diagnostics, reassigns to an alternative specialist, or re-scopes subtask.

### 6. Anti-Patterns & Prohibited Implementations
- Never allow sub-agents to dump raw intermediate fragments into the primary user chat.
- Do not delegate tasks cyclically between agents without progress markers.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/group-goal-run.test.ts`; confirm multi-specialist delegation, parallel artifact generation, and synthesis.
- Integration Test: Execute a multi-part research-and-code scenario; verify that user receives a single synthesized conclusion with linked artifacts.

---

# PHASE 34 — UNIFY IDENTITY + MEMORY + CONTEXT + GOALS

### 1. Architectural Objective & Motivation
Unify the previously isolated pillars—Agent Identity, Long-Term Memory, Multi-Tier Context, Active Goals, and Registered Capabilities—into a coherent agent execution frame. The planner must reason from this unified state at every turn.

### 2. Canonical Subsystem Mapping
- Authority: `server/index.ts`, `server/system-prompt.ts`
- State Assembly: `server/turn-context.ts`, `server/goals.ts`, `server/memory-store.ts`
- Test Coverage: `server/system-prompt.test.ts`, `server/agent-behavioral-contract.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface UnifiedAgentExecutionFrame {
  identity: AgentBehavioralContract;
  activeGoal: CanonicalGoalRecord | null;
  persistentMemory: PartitionedMemoryResult;
  dynamicContext: DynamicContextFrame;
  availableCapabilities: DeviceCapabilityDescription[];
  permissionPolicySnapshot: PermissionDomain[];
  safetyRiskTolerances: Record<RiskTier, boolean>;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: No action can be planned without checking `UnifiedAgentExecutionFrame` invariants.
- Invariant: If `activeGoal` is set, all actions in the turn must explicitly link to an active milestone ID.

### 5. Failure Classification & Recovery Protocols
- `ERR_UNIFIED_FRAME_DESYNC`: Memory or goal state on disk does not match the in-memory execution frame.
  - Recovery: Invalidate turn cache, reload authoritative state from disk journals, restart turn assembly.

### 6. Anti-Patterns & Prohibited Implementations
- Do not maintain isolated, conflicting definitions of user state in different files.
- Never construct system prompts through loose string concatenations scattered across multiple handlers.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/system-prompt.test.ts`; verify that all six pillars are correctly assembled and structured.
- End-to-End Test: Verify a complex task requiring identity adherence, memory recall, goal advancement, and tool execution runs cleanly in a single turn.

---

# PHASE 35 — ANDROID-AS-COMPUTER

### 1. Architectural Objective & Motivation
MOBOT operates on an Android device: the phone itself is the computer. The agent must possess native, robust capabilities to observe the Android UI tree, launch applications, perform precise gesture inputs, and handle system dialogues without relying on external desktop tethering.

### 2. Canonical Subsystem Mapping
- Authority: `server/android-computer.ts`, `server/android-computer-sandbox.ts`
- Native Accessibility Service: `android/app/src/main/kotlin/com/openmausbot/companion/service/CompanionAccessibilityService.kt`
- Test Coverage: `server/android-computer.test.ts`, `server/android-computer-sandbox.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type AndroidGestureType = "tap" | "double_tap" | "long_press" | "type" | "swipe" | "press_key";

export interface AndroidGestureAction {
  gesture: AndroidGestureType;
  coordinates?: { x: number; y: number };
  swipeVector?: { startX: number; startY: number; endX: number; endY: number; durationMs: number };
  inputText?: string;
  keyCode?: number; // e.g. KeyEvent.KEYCODE_BACK, KEYCODE_HOME
  targetNodeId?: string;
}

export interface AndroidUiSemanticNode {
  nodeId: string;
  packageName: string;
  className: string;
  text?: string;
  contentDescription?: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  isClickable: boolean;
  isEditable: boolean;
  isEnabled: boolean;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Accessibility actions must never interact with system permission dialogues attempting to silently grant dangerous permissions.
- Invariant: Before executing a tap gesture, verify that the target node is still visible and matches expected text.

### 5. Failure Classification & Recovery Protocols
- `ERR_NODE_DISAPPEARED`: Target node vanished between observation and gesture injection (UI changed).
  - Recovery: Take fresh screen observation; locate updated node position; re-attempt gesture.

### 6. Anti-Patterns & Prohibited Implementations
- Never use hardcoded pixel coordinates when semantic accessibility nodes are available.
- Do not simulate taps without verifying screen state post-action.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/android-computer.test.ts`; confirm accessibility tree parsing and gesture serialization.
- Physical Device Test: Automate opening Settings -> Display on Samsung Galaxy A07; confirm navigation succeeds via semantic accessibility nodes.

---

# PHASE 36 — LOCATION AS REAL CONTEXT

### 1. Architectural Objective & Motivation
Location is sensitive contextual data. It must be treated as a first-class reliability subsystem with strict privacy guards, freshness bounds, and provenance tracking. Stale coordinates or test mocks must never be treated as live user location.

### 2. Canonical Subsystem Mapping
- Authority: `server/location-context.ts`
- Device Location Service: `android/app/src/main/kotlin/com/openmausbot/companion/permissions/CompanionPermissions.kt`
- Test Coverage: `server/location-context.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface LocationContextResolution {
  status: "AVAILABLE" | "PERMISSION_DENIED" | "DISABLED_BY_USER" | "STALE" | "UNKNOWN";
  location?: {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    city?: string;
    region?: string;
    country?: string;
    provenance: LocationProvenance;
    timestampMs: number;
  };
  policyNotice?: string;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: If location freshness exceeds 15 minutes, mark status as `STALE` and trigger background refresh if permitted.
- Invariant: If user disables location context in Settings, return `DISABLED_BY_USER` immediately; never attempt background GPS polls.

### 5. Failure Classification & Recovery Protocols
- `ERR_LOCATION_PERMISSION_REVOKED`: Android OS returns permission denied.
  - Recovery: Update internal state to `PERMISSION_DENIED`; suppress location-dependent tool execution.

### 6. Anti-Patterns & Prohibited Implementations
- Absolute ban on guessing location from IP addresses without user consent.
- Never write location coordinates into long-term memory unless explicitly commanded: "Remember where I parked".

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/location-context.test.ts`; confirm location freshness expiry and privacy gating.
- Device Test: Revoke Location permission on Samsung Galaxy A07; verify agent truthfully states location is unavailable.

---

# PHASE 37 — LOCATION / MAPS / WEATHER AS CONTEXTUAL CAPABILITIES

### 1. Architectural Objective & Motivation
Location, navigation, mapping, and meteorological data must function as organic context sources rather than disjointed utility commands. If a user asks "Should I carry an umbrella?", the agent must understand that location and weather capabilities are required and execute them seamlessly.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/default-capabilities.ts`, `server/location-context.ts`
- External Bridges: Open-Meteo / Google Maps endpoints
- Test Coverage: `server/capabilities/capabilities.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface ContextualLocationEnrichment {
  currentCoordinates?: { lat: number; lng: number };
  weatherSnapshot?: {
    temperatureC: number;
    weatherCondition: "clear" | "rain" | "snow" | "cloudy" | "storm";
    precipitationProbabilityPercent: number;
    updatedAtMs: number;
  };
  nearbyPOIs?: Array<{ name: string; category: string; distanceMeters: number }>;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart TD
    UserQ["'Should I go for a run now?'"] --> Classify["Classify Intent: Outdoor Activity"]
    Classify --> FetchLoc["Obtain Verified Location Context"]
    FetchLoc --> FetchWeather["Query Weather API for Coordinates"]
    FetchWeather --> Evaluate["Evaluate Precipitation & Temperature"]
    Evaluate --> Answer["'It is 18C and clear right now, but rain starts in 45m. You have time for a short run.'"]
```

### 5. Failure Classification & Recovery Protocols
- `ERR_WEATHER_API_UNAVAILABLE`: Weather service endpoint unreachable.
  - Recovery: Explain that real-time weather cannot be retrieved; advise user based on general forecast or ask location.

### 6. Anti-Patterns & Prohibited Implementations
- Do not fabricate weather forecasts when the weather API is unreachable.
- Do not poll GPS continuously for queries that do not require outdoor context.

### 7. Verification & Acceptance Criteria
- Integration Test: Mock location in `server/capabilities/capabilities.test.ts`; verify weather capability accurately fetches and parses forecast data.
- Behavioral Test: Ask "Do I need a jacket?"; verify agent references real-time temperature and wind chill in its recommendation.


# PHASE 38 — STANDARDIZED ERROR RECOVERY

### 1. Architectural Objective & Motivation
Establish a standardized, system-wide error classification and recovery pipeline across all layers (browser, terminal, phone gestures, network, model providers, Composio). Errors must follow a consistent lifecycle: Detect -> Classify -> Diagnose -> Recover -> Verify -> Escalate.

### 2. Canonical Subsystem Mapping
- Authority: `server/runtime-failure.ts`
- Client Error Classification: `android/core/.../core/ErrorClassifier.kt`, `StructuredAppError.kt`
- Test Coverage: `server/runtime-failure.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export type ErrorSeverity = "info" | "warning" | "transient_error" | "fatal_error";

export interface StandardizedSystemError {
  errorCode: string;
  subsystem: "browser" | "terminal" | "phone" | "filesystem" | "network" | "provider" | "composio";
  severity: ErrorSeverity;
  rawErrorMessage: string;
  classification: FailureClassification;
  diagnosticContext: Record<string, unknown>;
  autoRecoveryAttempted: boolean;
  recoveryActionTaken?: string;
  isEscalatedToUser: boolean;
  userFacingExplanation: string;
}
```

```kotlin
// android/core/src/main/kotlin/com/openmausbot/companion/core/ErrorClassifier.kt
data class ClassifiedClientError(
    val code: String,
    val userTitle: String,
    val userResolution: String,
    val actionableButtonLabel: String?,
    val canAutoRetry: Boolean
)
```

### 4. State Transitions & Behavioral Invariants
```mermaid
stateDiagram-v2
    state "Error Detected" as Detect
    state "Classify Severity & Subsystem" as Classify
    state "Evaluate Auto-Recovery Strategy" as Eval
    state "Auto-Recovery Action (Retry / Fallback)" as Recover
    state "Escalate to User (Actionable Sheet)" as Escalate

    [*] --> Detect
    Detect --> Classify
    Classify --> Eval
    Eval --> Recover: Strategy Available (Attempt < 3)
    Eval --> Escalate: No Strategy or Max Attempts Exceeded
    Recover --> Detect: Retried Action Failed
    Recover --> [*]: Action Succeeded Post-Recovery
    Escalate --> [*]
```

### 5. Failure Classification & Recovery Protocols
- `ERR_MAX_RETRIES_EXCEEDED`: Subsystem attempted recovery 3 times without resolution.
  - Recovery: Freeze execution loop; emit structured error capsule to client UI with "Retry" and "Cancel" actions.

### 6. Anti-Patterns & Prohibited Implementations
- Never swallow errors silently without logging to the structured error bus.
- Never display raw stack traces, SQL errors, or Node.js internal error strings to the user.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/runtime-failure.test.ts`; confirm standard error transformation for 50 distinct error types.
- Device Test: Inject an intentional network fault; verify Android UI displays `ActionableErrorBottomSheet.kt` with a clear recovery action.

---

# PHASE 39 — OBSERVABILITY

### 1. Architectural Objective & Motivation
Implement a unified, low-overhead production observability pipeline. The agent platform must track execution turns, tool latency, memory usage, replanning events, and completion states without polluting normal user conversation transcripts.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/observability.ts`, `server/sse-fanout.ts`
- Metrics Ledger: `server/usage-ledger.ts`
- Test Coverage: `server/usage-ledger.test.ts`, `server/testing/sse.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface ExecutionTelemetryTrace {
  traceId: string;
  turnId: string;
  botId: string;
  goalId?: string;
  metrics: {
    durationTotalMs: number;
    tokensIn: number;
    tokensOut: number;
    toolExecutionCount: number;
    replanCount: number;
    turnOutcome: "success" | "failure" | "cancelled";
  };
  spanRecords: Array<{
    spanName: string;
    subsystem: string;
    durationMs: number;
    success: boolean;
  }>;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Telemetry collection overhead must not exceed 5ms per turn.
- Invariant: User credentials and private conversation text must be strictly excluded from telemetry traces.

### 5. Failure Classification & Recovery Protocols
- `ERR_OBSERVABILITY_QUEUE_FULL`: SSE or metrics queue backed up.
  - Recovery: Drop oldest non-critical spans; preserve goal and error milestone records.

### 6. Anti-Patterns & Prohibited Implementations
- Do not stream internal telemetry spans into the user chat interface.
- Never write telemetry directly to synchronous disk files in the request hot path.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/usage-ledger.test.ts`; confirm accurate token and latency accounting.
- Device Test: Run multi-step task; verify telemetry traces stream smoothly over SSE without UI jitter.

---

# PHASE 40 — TRUST AND ACTION TRANSPARENCY

### 1. Architectural Objective & Motivation
Foster user trust through total action transparency. If the agent states that it searched the web, created a file, or checked an email, that statement must be backed by an immutable system record. Hallucinated or speculative claims are strictly prohibited.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/safety-policy.ts`, `server/store.ts`
- Test Coverage: `server/agent-behavioral-contract.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface VerifiedActionClaim {
  statement: string;
  subsystem: "browser" | "terminal" | "file" | "service";
  verifiableEntityId: string; // e.g. commit hash, file SHA256, URL visited
  verifiedAtMs: number;
  cryptographicProofHash?: string;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: An agent must not write "I created file X" unless `fs.existsSync(X)` returns true.
- Invariant: An agent must not write "I sent email Y" unless the Composio client returned HTTP 200.

### 5. Failure Classification & Recovery Protocols
- `ERR_UNVERIFIED_ACTION_CLAIM`: Agent attempted to claim completion of an action that lacks an execution record.
  - Recovery: Dynamic output sanitizer flags discrepancy; requires agent to re-verify or restate truthfully.

### 6. Anti-Patterns & Prohibited Implementations
- Absolute ban on claiming actions occurred when tools returned error codes.
- Do not use hypothetical future tense disguised as completed past tense ("I will have checked the logs").

### 7. Verification & Acceptance Criteria
- Unit Test: Provide mocked failure to file creation tool; confirm agent prompt strictly prohibits claiming the file was created.
- Behavioral Test: Instruct agent to perform an impossible network task; verify agent truthfully states the action failed.

---

# PHASE 41 — PRIVACY AND DATA BOUNDARIES

### 1. Architectural Objective & Motivation
Enforce strict multi-tenant and cross-bot privacy boundaries. Data belonging to Bot A, Thread X, or Workspace 1 must remain completely isolated from Bot B, Thread Y, or Workspace 2. Sensitive user credentials must never cross security domains.

### 2. Canonical Subsystem Mapping
- Authority: `server/permission-policy.ts`, `server/workspace.ts`
- Client Token Store: `android/app/src/main/kotlin/com/openmausbot/companion/storage/KeystoreTokenStore.kt`
- Test Coverage: `server/branching.test.ts`, `server/thread-retention.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface SecurityIsolationBoundary {
  tenantId: string;
  botId: string;
  threadId: string;
  authorizedWorkspaceRoot: string;
  permittedMemoryPaths: string[];
  deniedGlobalPaths: string[];
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: File system access outside `authorizedWorkspaceRoot` is blocked with `ENOENT` or `EACCES`.
- Invariant: API keys and auth tokens stored in `KeystoreTokenStore.kt` are never passed into system prompt contexts.

### 5. Failure Classification & Recovery Protocols
- `ERR_CROSS_THREAD_ISOLATION_VIOLATION`: Query attempts to read message history from another thread ID.
  - Recovery: Drop query immediately; log security alert to system audit journal.

### 6. Anti-Patterns & Prohibited Implementations
- Never share temporary scratchpad directories between different bot instances.
- Never store plaintext user credentials in SQLite message databases.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/branching.test.ts`; confirm total isolation of thread branches and scratchpad files.
- Device Test: Create two distinct bots on Samsung Galaxy A07; upload private document to Bot 1; verify Bot 2 cannot access or reference it.

---

# PHASE 42 — PERMISSIONS REMAIN AUTHORITATIVE

### 1. Architectural Objective & Motivation
The permission subsystem is an immutable kernel. No model reasoning, planner bypass, autonomous background routine, or retry loop can override the permission policy. Unregistered or unclassified capabilities must fail closed.

### 2. Canonical Subsystem Mapping
- Authority: `server/permission-policy.ts`, `server/agent-permissions.test.ts`
- Android Manifest / Runtime: `android/app/src/main/AndroidManifest.xml`, `CompanionPermissions.kt`
- Test Coverage: `server/agent-permissions.test.ts`, `server/capabilities/safety-policy.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface AuthoritativePermissionGate {
  evaluate(domain: PermissionDomain, capabilityId: string, params: Record<string, unknown>): PermissionCheckResult;
  enforce(domain: PermissionDomain, capabilityId: string, params: Record<string, unknown>): Promise<void>;
  failClosedOnUnclassified(toolName: string): boolean;
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart TD
    Req["Agent Capability Execution Request"] --> Classify["Classify Permission Domain"]
    Classify --> Check{"Domain Classified in Registry?"}
    Check -->|No| BlockFailClosed["DENY: Fail-Closed (Unclassified)"]
    Check -->|Yes| Policy{"Policy State in permission-policy.ts"}
    Policy -->|Allowed| Exec["Execute Native Action"]
    Policy -->|Denied| BlockDenied["DENY: Permission Denied"]
    Policy -->|Prompt User| Modal["Prompt User in Android UI"]
```

### 5. Failure Classification & Recovery Protocols
- `ERR_PERMISSION_DENIED_FAIL_CLOSED`: Unrecognized tool requested execution.
  - Recovery: Block execution with `status: "permission_denied"`; do not execute subprocess.

### 6. Anti-Patterns & Prohibited Implementations
- Absolute ban on prompt-only security (e.g. instructing the LLM "do not execute dangerous commands" without a runtime gate).
- Never allow a background automation to execute high-risk operations without pre-authorized permission grants.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/agent-permissions.test.ts`; confirm fail-closed behavior for all unclassified tools.
- Device Test: Revoke terminal execution permission in Android app; attempt to run `ls`; verify command is blocked at the server gate.

---

# PHASE 43 — UX SIMPLICITY

### 1. Architectural Objective & Motivation
Maintain a calm, purposeful, and clutter-free mobile user experience. MOBOT is a sophisticated tool, not a noisy dashboard. Progressive disclosure must be utilized to surface technical complexity only when relevant to the user.

### 2. Canonical Subsystem Mapping
- Authority: `android/app/src/main/kotlin/com/openmausbot/companion/ui/AppDesign.kt`, `Chrome.kt`
- Screen Implementations: `ChatScreen.kt`, `BotOverviewScreen.kt`, `ComputerScreen.kt`
- Design Tokens: `android/app/src/main/kotlin/com/openmausbot/companion/ui/MausBodies.kt`

### 3. Formal Data Contract & Schema Specifications
```kotlin
// android/app/src/main/kotlin/com/openmausbot/companion/ui/AppDesign.kt
object MobotDesignTokens {
    val SurfaceBackground = Color(0xFF121214)
    val SurfaceElevated = Color(0xFF1E1E22)
    val AccentPrimary = Color(0xFF3B82F6)
    val TextPrimary = Color(0xFFF3F4F6)
    val TextSecondary = Color(0xFF9CA3AF)
    val ContentPadding = 16.dp
    val CornerRadius = 12.dp
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: No screen may display more than two primary action buttons simultaneously.
- Invariant: Zero decorative AI widgets, glowing gradients, or animated particle effects.

### 5. Failure Classification & Recovery Protocols
- `ERR_UI_HIERARCHY_OVERFLOW`: Screen layout elements exceed viewport height on small screens (e.g. 720p).
  - Recovery: Jetpack Compose layouts must provide smooth vertical scrolling and adaptive spacing.

### 6. Anti-Patterns & Prohibited Implementations
- Do not build giant dashboards with dozens of unrequested metrics cards.
- Never use emojis as iconography or bullet points in the UI.

### 7. Verification & Acceptance Criteria
- Compose Hierarchy Test: Verify that `ChatScreen.kt` and `ComputerScreen.kt` render cleanly across both 720p and 1080p Android display densities without clipping.
- Device Test: Visually inspect Android app on Samsung Galaxy A07; confirm clean typography, consistent margins, and fast touch responsiveness.

---

# PHASE 44 — ONBOARDING INTEGRATION

### 1. Architectural Objective & Motivation
Onboarding is the critical gateway where the user establishes their identity, grants initial permissions, connects essential services, and explicitly creates their first teammate. The first bot must feel like a real colleague immediately.

### 2. Canonical Subsystem Mapping
- Authority: `android/app/src/main/kotlin/com/openmausbot/companion/ui/OnboardingScreens.kt`
- Storage: `android/app/src/main/kotlin/com/openmausbot/companion/storage/OnboardingStateStore.kt`
- Seed Engine: `server/android-seed.ts`
- Test Coverage: `android/core/.../core/Onboarding.kt`, `server/android-seed.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface OnboardingConfigurationPayload {
  userName: string;
  userEmail: string;
  providerKeyConfigured: boolean;
  selectedDefaultModel: string;
  initialBotCreation: {
    name: string;
    role: string;
    workStyle: AgentWorkStyle;
    themeColor: string;
  };
  consentedPermissions: PermissionDomain[];
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
stateDiagram-v2
    state "Welcome & User Identity" as Welcome
    state "Model & Provider Setup" as Provider
    state "Authoritative Permissions" as Perms
    state "Create First Teammate" as CreateBot
    state "Onboarding Complete" as Complete

    [*] --> Welcome
    Welcome --> Provider: User Name & Email Entered
    Provider --> Perms: API Key Configured
    Perms --> CreateBot: Permissions Reviewed
    CreateBot --> Complete: Bot Initialized
    Complete --> [*]
```

- Invariant: Users must explicitly create their first bot; no surprise auto-generated bots are permitted.
- Invariant: Onboarding completion state must persist atomically in `OnboardingStateStore.kt`.

### 5. Failure Classification & Recovery Protocols
- `ERR_INVALID_PROVIDER_KEY`: User enters malformed API key during onboarding.
  - Recovery: Validate key against provider ping endpoint; display clear inline error; do not advance step until valid.

### 6. Anti-Patterns & Prohibited Implementations
- Do not skip the provider setup step and leave the agent in an unconfigured, broken state.
- Do not create a separate, parallel onboarding flow for different model types.

### 7. Verification & Acceptance Criteria
- Unit Test: Run `server/android-seed.test.ts`; confirm first-bot seeding and workspace creation.
- Device Test: Clear app data on Samsung Galaxy A07; complete onboarding; confirm user navigates directly into the newly created bot's chat screen.

---

# PHASE 45 — FIRST-USE AGENT EXPERIENCE

### 1. Architectural Objective & Motivation
The very first conversation turn with a newly created bot must establish its identity, competence, and role specialization. It must avoid generic greeting tropes ("Hello! How can I help you today?") and immediately demonstrate capability awareness.

### 2. Canonical Subsystem Mapping
- Authority: `server/bot-directory.ts`, `server/system-prompt.ts`
- Client UI: `android/app/src/main/kotlin/com/openmausbot/companion/ui/ChatScreen.kt`
- Test Coverage: `server/agent-behavioral-contract.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface FirstUseGreetingDirective {
  botName: string;
  botRole: string;
  userName: string;
  workspaceReady: boolean;
  activeCapabilitiesSummary: string[];
  suggestedStarterActions: string[];
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: First greeting must explicitly reference the bot's specific role and at least two concrete things it can accomplish.
- Invariant: Starter suggestions must be actionable commands, not vague conversational topics.

### 5. Failure Classification & Recovery Protocols
- `ERR_GENERIC_GREETING_DETECTED`: Model outputs a canned generic greeting.
  - Recovery: Dynamic output filter intercepts response, replaces with role-anchored introduction.

### 6. Anti-Patterns & Prohibited Implementations
- Never greet the user as an anonymous chatbot.
- Do not flood the screen with a massive list of commands on the first turn.

### 7. Verification & Acceptance Criteria
- Behavioral Test: Initialize a "Security Auditor" bot; confirm first message introduces itself as a security specialist ready to inspect dependencies, permissions, and configs.
- Device Test: Launch newly created bot on Samsung Galaxy A07; verify first-turn message renders crisply and establishes persona.


# PHASE 46 — TESTING ARCHITECTURE

### 1. Architectural Objective & Motivation
Testing must be institutionalized across four distinct, non-overlapping verification layers: Unit, Integration, Behavioral Stress, and Physical Hardware. Passing unit tests alone does not prove production readiness. Every phase deliverable must pass all four gates.

### 2. Canonical Subsystem Mapping
- Harness Authority: `server/testing/setup.ts`, `server/testing/events.ts`
- Physical Anchor: `android/app/src/main/kotlin/com/openmausbot/companion/host/HarnessService.kt`
- Test Suite Roots: `server/*.test.ts`, `android/app/src/test/`, `android/core/src/test/`
- Test Coverage: `server/behavioral-stress-corpus.test.ts`, `server/fakes-self-contained.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface VerificationSuiteReport {
  timestampMs: number;
  layer1_Unit: { total: number; passed: number; failed: number; coveragePercent: number };
  layer2_Integration: { total: number; passed: number; failed: number };
  layer3_Behavioral: { totalScenarios: number; passedScenarios: number; driftScore: number };
  layer4_PhysicalAndroid: {
    deviceSerial: string;
    model: string;
    osVersion: string;
    batteryLevel: number;
    testsExecuted: number;
    allPassed: boolean;
  };
}
```

### 4. State Transitions & Behavioral Invariants
```mermaid
flowchart LR
    L1["Layer 1: Unit Tests (Vitest)"] --> L2["Layer 2: Integration & E2E"]
    L2 --> L3["Layer 3: Behavioral Corpus"]
    L3 --> L4["Layer 4: Physical Samsung A07"]
    L4 --> Gate["Production Release Gate Passed"]
```

- Invariant: A failure in ANY of the four layers blocks release and checkpointing immediately.
- Invariant: Physical tests must run against live hardware (Samsung Galaxy A07, Android 16), never software emulators.

### 5. Failure Classification & Recovery Protocols
- `ERR_TEST_FLAKINESS`: A test fails intermittently due to race conditions or timing.
  - Recovery: Identify unawaited promises or non-deterministic timers; replace with deterministic event listeners.

### 6. Anti-Patterns & Prohibited Implementations
- Never skip physical Android verification for features touching the UI, browser, or device capabilities.
- Prohibit mock-only test suites that do not execute real binary paths.

### 7. Verification & Acceptance Criteria
- Full Matrix Run: Run all 145+ Vitest server tests and 1,762+ Android Gradle tests; confirm 100% pass rate.
- Device Test: Run ADB test runner against connected Samsung Galaxy A07; confirm zero crashes or memory leaks.

---

# PHASE 47 — AGENT OUTCOME BENCHMARK

### 1. Architectural Objective & Motivation
Establish an automated benchmark suite that evaluates whether an agent genuinely achieved a complex objective rather than merely executing individual tool calls. The benchmark assesses plan coherence, tool efficacy, evidence synthesis, and user utility.

### 2. Canonical Subsystem Mapping
- Authority: `server/testing/fakes-self-contained.test.ts`, `server/agent-behavioral-contract.test.ts`
- Test Coverage: `server/steer-e2e.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface OutcomeBenchmarkCase {
  benchmarkId: string;
  category: "research" | "coding" | "planning" | "device_automation";
  userPrompt: string;
  expectedToolCallsMin: number;
  expectedArtifactTypes: string[];
  evaluationRubric: {
    objectiveCompletedWeight: number; // 0.40
    factualAccuracyWeight: number;     // 0.30
    recommendationQualityWeight: number; // 0.20
    concisenessWeight: number;          // 0.10
  };
  minimumPassingScore: number; // Default 8.5 / 10.0
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: A benchmark fails if the agent stops before producing the required deliverables, even if all tool calls succeeded.
- Invariant: A benchmark fails if the agent outputs hallucinated citations or unverified assertions.

### 5. Failure Classification & Recovery Protocols
- `ERR_BENCHMARK_SCORE_BELOW_THRESHOLD`: Agent scored < 8.5 on evaluation rubric.
  - Recovery: Analyze telemetry trace; identify whether failure was caused by premature stopping, bad tool arguments, or poor synthesis.

### 6. Anti-Patterns & Prohibited Implementations
- Do not evaluate agents solely on token count or latency.
- Never write benchmarks that test only the "happy path" without introducing realistic real-world edge cases.

### 7. Verification & Acceptance Criteria
- Automated Benchmark Suite: Run 20 distinct multi-step benchmark scenarios; confirm average score exceeds 9.0/10.0.

---

# PHASE 48 — LONG-HORIZON AGENT TESTS

### 1. Architectural Objective & Motivation
Autonomous agents must endure across extended multi-action sequences without suffering goal drift, context window degradation, memory leaks, or execution loops. Stress test the system across 10, 20, and 50 continuous action sequences.

### 2. Canonical Subsystem Mapping
- Authority: `server/round4-state-stress.test.ts`, `server/round7-adversarial-reproduction.test.ts`
- Test Coverage: `server/steer-e2e.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface LongHorizonStressProfile {
  targetActionCount: 10 | 20 | 50;
  introducedFaults: Array<{ actionIndex: number; faultType: FailureClassification }>;
  memoryGrowthThresholdBytes: number;
  contextTokenCeiling: number;
  expectedReplansCount: number;
}
```

### 4. State Transitions & Behavioral Invariants
| Target Horizon | Maximum Token Usage | Maximum Memory Growth | Required Replans Handled |
| :--- | :--- | :--- | :--- |
| 10 Actions | 16,000 tokens | < 10 MB | 1-2 replans |
| 20 Actions | 32,000 tokens | < 25 MB | 2-4 replans |
| 50 Actions | 64,000 tokens (compressed) | < 50 MB | 5+ replans |

### 5. Failure Classification & Recovery Protocols
- `ERR_HORIZON_DESYNC`: Context window exhausted or memory leaked mid-run.
  - Recovery: Section context summarizer compresses historical turns; garbage collector flushes completed action buffers.

### 6. Anti-Patterns & Prohibited Implementations
- Never allow a 50-action task to append every raw tool output uncompressed into prompt memory.
- Prohibit tasks that fail silently at turn 25 and return a generic apology.

### 7. Verification & Acceptance Criteria
- Stress Test: Run 50-action continuous execution harness in `server/round4-state-stress.test.ts`; confirm agent reaches final verified objective with original goal intact.

---

# PHASE 49 — BACKGROUND EXECUTION TESTS

### 1. Architectural Objective & Motivation
Rigidly test background execution survivability under simulated and physical Android conditions: app minimization, display sleep, low memory pressure, Wi-Fi to cellular transitions, and incoming call interruptions.

### 2. Canonical Subsystem Mapping
- Authority: `android/app/src/main/kotlin/com/openmausbot/companion/lifecycle/SessionLingerController.kt`
- Test Coverage: `server/round5-settings-updater-lifecycle.test.ts`, `server/channel-queue.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface BackgroundSurvivalTestCase {
  testId: string;
  disruptionTrigger: "screen_off" | "app_backgrounded" | "network_switch" | "process_killed";
  disruptionDurationMs: number;
  expectedTaskOutcome: "continued_uninterrupted" | "resumed_from_checkpoint";
  notificationVerified: boolean;
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Background tasks must never freeze or drop queued SSE messages while the OS keeps the Foreground Service alive.
- Invariant: When interrupted by process death, recovery must resume from the last completed milestone within 5 seconds of relaunch.

### 5. Failure Classification & Recovery Protocols
- `ERR_BACKGROUND_EXECUTION_STALLED`: Task ceased emitting heartbeats for >60s while in background.
  - Recovery: `SessionLingerController.kt` restarts the embedded Node runtime host and re-queues active job.

### 6. Anti-Patterns & Prohibited Implementations
- Do not claim background capability if tasks halt the instant `onStop()` is called.

### 7. Verification & Acceptance Criteria
- Physical Test: On Samsung Galaxy A07, start a 5-minute task, lock the screen for 4 minutes, unlock; confirm task completed and notification posted.

---

# PHASE 50 — WATCH COMPUTER ACCEPTANCE TESTS

### 1. Architectural Objective & Motivation
Verify that Watch Computer surfaces authentic, real-time telemetry across all operational domains: browser, phone vision, terminal, files, tools, and unified timeline. Confirm zero synthetic frames, zero stale spinners, and clean viewport rendering.

### 2. Canonical Subsystem Mapping
- Authority: `server/screen-frame-source.ts`, `server/screen-frame-gate.ts`
- Client UI: `android/app/src/main/kotlin/com/openmausbot/companion/ui/ComputerScreen.kt`
- Test Coverage: `server/screen-frame-source.test.ts`, `server/browser-live-routes.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface WatchAcceptanceCriteriaReport {
  browserSurfaceSynchronized: boolean;
  phoneVisionOverlaysAccurate: boolean;
  terminalAnsiRenderedCleanly: boolean;
  fileDiffsReflectActualDisk: boolean;
  timelineChronologyConsistent: boolean;
  zeroFakeActivityDetected: boolean;
  frameLatencyAvgMs: number; // Must be < 300ms
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Frame stream must match live browser DOM state within 300ms of navigation completion.
- Invariant: If browser is closed, Watch Computer must immediately transition from browser viewport to idle status.

### 5. Failure Classification & Recovery Protocols
- `ERR_STALE_FRAME_DISPLAYED`: Watch Computer displays a cached frame that does not match current driver state.
  - Recovery: `screen-frame-source.ts` detects hash desync, broadcasts immediate forced frame refresh over SSE.

### 6. Anti-Patterns & Prohibited Implementations
- Never render a generic web browser mockup with a fake Google logo.
- Prohibit blank white screens during active page loading.

### 7. Verification & Acceptance Criteria
- Physical Test: Navigate to three distinct websites via the agent while observing Watch Computer on Samsung Galaxy A07; confirm page transitions render in real time.

---

# PHASE 51 — MEMORY BENCHMARK

### 1. Architectural Objective & Motivation
Verify the long-term memory system across ten essential criteria: retention durability, selective storage, contradiction reconciliation, shared vs. specialized scoping, secret redaction, deletion compliance, and cross-thread isolation.

### 2. Canonical Subsystem Mapping
- Authority: `server/memory-store.ts`, `server/memory-journal.ts`
- Test Coverage: `server/memory-store.test.ts`, `server/memory-journal.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface MemoryBenchmarkSuiteResult {
  durabilityScore: number;     // 100% across restarts
  selectivityScore: number;    // > 90% trivia filtered
  reconciliationScore: number; // 100% explicit updates honored
  isolationScore: number;      // 0 leaks across bots/threads
  redactionScore: number;      // 100% secrets scrubbed
  deletionScore: number;       // 100% purged on request
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Explicit user instruction to "Forget X" or "Delete memory Y" must permanently scrub the record from disk and journal files.
- Invariant: A memory entry must never contain un-redacted API keys or passwords.

### 5. Failure Classification & Recovery Protocols
- `ERR_MEMORY_RECALL_FAILURE`: Relevant stored memory failed to inject into turn context.
  - Recovery: Re-index `memory-journal.ts`; verify search query normalization and semantic threshold.

### 6. Anti-Patterns & Prohibited Implementations
- Do not store ephemeral conversation pleasantries ("User said hello") in persistent memory.
- Prohibit "soft deletes" that leave user data accessible to downstream prompts.

### 7. Verification & Acceptance Criteria
- Automated Benchmark: Run 10-point memory evaluation in `server/memory-store.test.ts`; confirm all 10 benchmarks pass.

---

# PHASE 52 — CONTEXT BENCHMARK

### 1. Architectural Objective & Motivation
Benchmark the context pipeline for relevance precision, token bounding compliance, citation integrity, and strict spatial provenance. Verify that context enhances agent performance without diluting prompt focus.

### 2. Canonical Subsystem Mapping
- Authority: `server/capabilities/context-pipeline.ts`, `server/location-context.ts`
- Test Coverage: `server/turn-context.test.ts`, `server/location-context.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface ContextBenchmarkResult {
  tokenBudgetCompliancePercent: 100;
  citationValidityScore: number; // > 95% line citations match source
  relevancePrecisionAtK: number; // > 0.85
  provenanceViolationCount: 0;   // Strictly 0 tolerated
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Context injected into planner prompt must never exceed the allocated token ceiling.
- Invariant: Every snippet extracted from an attached document must include a verifiable page or line number citation.

### 5. Failure Classification & Recovery Protocols
- `ERR_CITATION_MISMATCH`: Generated citation references non-existent lines in the source document.
  - Recovery: Pipeline re-indexes document chunks and verifies line offsets before prompt injection.

### 6. Anti-Patterns & Prohibited Implementations
- Never inject un-indexed full documents directly into system prompts.
- Never promote unverified contextual guesses to authoritative facts.

### 7. Verification & Acceptance Criteria
- Automated Benchmark: Run `server/turn-context.test.ts` across 25 document attachment scenarios; confirm 100% token budget compliance and valid citations.

---

# PHASE 53 — AUTONOMY BENCHMARK

### 1. Architectural Objective & Motivation
Measure agent autonomy quantitatively: initiative, persistence, replanning efficiency, and termination accuracy. An autonomous agent succeeds when it takes safe initiative, persists through transient errors, and halts only when the objective is truly complete.

### 2. Canonical Subsystem Mapping
- Authority: `server/index.ts`, `server/capabilities/orchestration.ts`
- Test Coverage: `server/steer-e2e.test.ts`, `server/round4-state-stress.test.ts`

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface AutonomyBenchmarkMetrics {
  totalTasksEvaluated: number;
  autonomousSuccessRatePercent: number; // Target > 90%
  unnecessaryClarificationCount: number; // Must be < 5% of turns
  prematureHaltsCount: 0;                // Strictly 0 tolerated
  averageReplansToSuccess: number;       // Typically 1.2 - 2.5
  infiniteLoopCount: 0;                  // Strictly 0 tolerated
}
```

### 4. State Transitions & Behavioral Invariants
- Invariant: Agent must never halt after a failed tool call without attempting at least one classified replanning cycle.
- Invariant: Low-risk actions must proceed automatically without seeking user permission.

### 5. Failure Classification & Recovery Protocols
- `ERR_PREMATURE_TERMINATION`: Agent reported completion when verifiable deliverables were missing.
  - Recovery: Self-evaluation layer (Phase 9) intercepts turn and forces continuation.

### 6. Anti-Patterns & Prohibited Implementations
- Do not celebrate "autonomy" that runs uncontrolled in circles burning model tokens.
- Prohibit asking user confirmation for standard read operations.

### 7. Verification & Acceptance Criteria
- Automated Benchmark: Run 50 autonomous task scenarios; verify autonomous completion rate exceeds 90% with zero premature halts.

---

# PHASE 54 — FINAL PRODUCT / HUMAN EXPERIENCE ACCEPTANCE

### 1. Architectural Objective & Motivation
The ultimate acceptance gate is the human product experience: Does interacting with MOBOT genuinely feel like working with an intelligent, persistent team of specialized colleagues rather than typing into a generic AI chatbot?

### 2. Canonical Subsystem Mapping
- Comprehensive Repository Integration: `server/`, `android/app/`, `android/core/`
- Hardware Authority: Samsung Galaxy A07 (`SM-A075F`, Android 16)
- Test Coverage: Full end-to-end multi-domain test corpus

### 3. Formal Data Contract & Schema Specifications
```typescript
export interface HumanExperienceAcceptanceAudit {
  evaluator: string;
  testDateMs: number;
  hardwareDevice: "Samsung Galaxy A07 (SM-A075F)";
  criteriaEvaluations: {
    feelsLikePersistentTeam: boolean;
    maintainsObjectiveAcrossLongHorizons: boolean;
    watchComputerReflectsRealReality: boolean;
    conversationalToneIsNaturalAndCalm: boolean;
    specialistsBehaveDistinctly: boolean;
    permissionsAndPrivacyAreRockSolid: boolean;
    backgroundExecutionWorksFlawlessly: boolean;
    onboardingCreatesInstantTeammate: boolean;
  };
  unanimousApproval: boolean;
}
```

### 4. The 18-Point Human Experience Scenario
To achieve Phase 54 acceptance, the system must execute the following end-to-end scenario flawlessly on physical hardware:
1. User creates a specialized "Senior Researcher" bot during clean onboarding.
2. User provides a multi-step objective: "Research the current release status of Node.js 24, extract top 3 changes, check if our workspace dependencies conflict, and draft a migration memo."
3. Agent acknowledges task with authoritative, concise specialist tone.
4. Agent determines required capabilities: Web Search, Browser, Filesystem.
5. Agent opens Browser, navigates to Node.js release page, and extracts changes.
6. User opens Watch Computer and visibly watches the live browser navigating and scrolling.
7. Agent transitions to Filesystem capability, reading `package.json` in workspace.
8. Watch Computer file activity pane updates with read events in real time.
9. Agent identifies dependency conflicts, evaluates migration risks, and makes an explicit recommendation.
10. Agent encounters a temporary network timeout during doc fetch; autonomously retries with backoff and succeeds without bothering user.
11. User locks phone and walks away for 3 minutes; agent continues background execution via Foreground Service.
12. Agent verifies all 3 success criteria are fully met via Phase 9 self-evaluation.
13. Agent drafts `migration-memo.md` atomically with 0600 permissions.
14. Agent completes goal and posts a single clean Android completion notification.
15. User taps notification, returning to chat.
16. Chat displays clean, beautifully structured synthesis with zero raw telemetry spam.
17. Watch Computer displays settled idle state.
18. Memory system records user preference regarding dependency management for future turns.

### 5. Final Acceptance Invariant
If any step in the 18-point scenario fails, stutters, fabricates data, or leaks raw telemetry, Phase 54 fails. Zero compromises.


# MASTER PRODUCT PRINCIPLES

The following twelve architectural principles govern all implementation decisions across MOBOT. They override superficial implementation conveniences and must be preserved through every phase.

---

### 1. OUTCOME OVER ACTION
- Principle: The objective of an agent is not to make tool calls or consume tokens; it is to successfully accomplish the user's intended outcome.
- Architectural Realization: Turn success is judged by post-action self-evaluation against goal success criteria, not by tool return codes.
- Anti-Pattern: Halting execution and claiming success because a search query returned HTTP 200, when the searched data was never synthesized or delivered.
- Verification Metric: Outcome benchmark rubric score must exceed 8.5/10.0.

---

### 2. CONTEXT OVER GENERICITY
- Principle: MOBOT must understand the specific physical, digital, and conversational situation of the user rather than behaving as a detached generic chatbot.
- Architectural Realization: Dynamic context assembly infuses verified location, device health, active workspace files, and persistent user preferences into the planner prompt.
- Anti-Pattern: Asking the user "What OS are you using?" or "Where are you located?" when that context is legitimately available from Android sensors.
- Verification Metric: 100% of context-eligible benchmark tasks leverage available environmental context without redundant user prompts.

---

### 3. INITIATIVE OVER BABYSITTING
- Principle: If the path forward is clear, low-risk, and aligned with user intent, act decisively without demanding manual confirmation at every micro-step.
- Architectural Realization: The safety policy categorizes read-only and local workspace mutations as low-risk, permitting autonomous execution loops.
- Anti-Pattern: Prompting the user: "I found 3 search results. Should I read the first one?"
- Verification Metric: Unnecessary user clarification turns occur in less than 5% of benchmark tasks.

---

### 4. JUDGMENT OVER ENDLESS NEUTRALITY
- Principle: When asked for advice, technical decisions, or comparisons, evaluate tradeoffs and take an informed stand.
- Architectural Realization: System prompt guidelines enforce a mandatory recommendation section when queries involve comparative evaluations.
- Anti-Pattern: Providing a bulleted list of 10 options followed by "The choice depends entirely on your needs; both have pros and cons."
- Verification Metric: 100% of comparative benchmark queries include an explicit recommended choice with technical justification.

---

### 5. PERSISTENCE OVER PREMATURE STOPPING
- Principle: Remain committed to the objective through transient errors, rate limits, and environmental disruptions.
- Architectural Realization: Phase 10 autonomous replanning retries with exponential backoff, mutates arguments, or switches capabilities before halting.
- Anti-Pattern: Throwing an unhandled exception or stopping work because a web page took 5 seconds to load.
- Verification Metric: Zero premature halts across the 50-task autonomy stress suite.

---

### 6. ADAPTATION OVER RIGID WORKFLOWS
- Principle: Reality is dynamic. If an initial plan encounters an unexpected obstacle, adapt the strategy rather than repeating failed attempts.
- Architectural Realization: Repeat-detector monitors execution traces; upon detecting identical consecutive failures, it forces alternative capability routing.
- Anti-Pattern: Retrying the exact same failing shell command three times in a row.
- Verification Metric: 100% of simulated tool failures trigger strategy mutation or capability fallback.

---

### 7. IDENTITY OVER GENERIC ASSISTANT BEHAVIOR
- Principle: A bot's role must fundamentally dictate its behavior, priorities, tools, and communication style.
- Architectural Realization: Authoritative agent behavioral contracts inject domain-specific heuristics and constraints into the planner core.
- Anti-Pattern: All bots speaking in the exact same generic assistant voice and selecting the exact same default tools.
- Verification Metric: Distinct behavioral corpus divergence scores between Coder, Researcher, and Planner bots.

---

### 8. MEMORY OVER AMNESIA
- Principle: Remember what is valuable, adapt when beliefs change, and purge trivia to keep context clean.
- Architectural Realization: Two-tiered memory architecture with atomic disk journals, secret scrubbing, and evidentiary reconciliation.
- Anti-Pattern: Forgetting the user's project tech stack 5 minutes after being told, or filling memory with trivial greetings.
- Verification Metric: 100% retention of critical user preferences across server restarts in Phase 51 memory benchmarks.

---

### 9. TRANSPARENCY OVER FAKE MAGIC
- Principle: Expose authentic execution state through Watch Computer; never fabricate telemetry or hide behind canned animations.
- Architectural Realization: 1:1 binding between live OS/driver streams (NanoHTTPD browser, PTY terminal, Accessibility nodes) and Watch Computer surfaces.
- Anti-Pattern: Displaying a simulated terminal with hardcoded text while no subprocess is running.
- Verification Metric: Cryptographic frame hash verification confirms 100% of Watch Computer frames originate from live drivers.

---

### 10. SAFETY OVER RECKLESS AUTONOMY
- Principle: Autonomous does not mean unrestricted. High-risk, destructive, or costly actions must pass through authoritative permission gates.
- Architectural Realization: Fail-closed permission kernel and interactive consent modals in `server/capabilities/safety-policy.ts`.
- Anti-Pattern: Allowing an agent to execute `rm -rf /` or email sensitive files without explicit user approval.
- Verification Metric: Zero unauthorized high-risk operations permitted across all adversarial penetration tests.

---

### 11. SIMPLICITY OVER DASHBOARD BLOAT
- Principle: Build powerful, robust systems underneath while presenting a calm, focused, and intuitive surface to the user.
- Architectural Realization: Progressive disclosure in Jetpack Compose UI; clean typography and zero decorative AI clutter.
- Anti-Pattern: Cluttering the screen with dozens of cards, graphs, glowing badges, and technical jargon.
- Verification Metric: UI hierarchy review confirms zero unrequested telemetry cards on primary chat and overview screens.

---

### 12. REAL CAPABILITY OVER SIMULATED CAPABILITY
- Principle: Every capability must be backed by authentic native actuators; never fake execution to create an illusion of competence.
- Architectural Realization: Real Android drivers (`android-computer.ts`, `android-browser.ts`, `BrowserDriverServer.kt`) execute against OS APIs.
- Anti-Pattern: Simulating an Android tap without injecting a real MotionEvent or Accessibility action.
- Verification Metric: Physical Samsung Galaxy A07 test confirms actual app state mutations on hardware.

---

# IMPLEMENTATION METHODOLOGY & WAVE STRATEGY

Do NOT attempt to implement all 54 phases in a single monolithic code modification. That approach produces untestable regressions, race conditions, and architecture drift. Implementation must proceed in eleven disciplined, sequential waves:

```mermaid
flowchart TD
    W1["Wave 1: Contracts & Memory Foundations (Phases 1-6)"] --> W2["Wave 2: Execution Loop & Replanning (Phases 7-10)"]
    W2 --> W3["Wave 3: Capability Routing & Services (Phases 11-15)"]
    W3 --> W4["Wave 4: Response Intelligence & Proactivity (Phases 16-19)"]
    W4 --> W5["Wave 5: Background Continuation & Jobs (Phases 20-21)"]
    W5 --> W6["Wave 6: Watch Computer Visual Workspace (Phases 22-29)"]
    W6 --> W7["Wave 7: Agent Swarms & Unified Runtime (Phases 30-34)"]
    W7 --> W8["Wave 8: Android Computer-Use & Geocontext (Phases 35-37)"]
    W8 --> W9["Wave 9: Resilience, Observability & Security (Phases 38-42)"]
    W9 --> W10["Wave 10: UX Polish & Onboarding Journey (Phases 43-45)"]
    W10 --> W11["Wave 11: Benchmark Harness & Final Gate (Phases 46-54)"]
```

### Wave Execution Protocol
For every individual wave:
1. Inspect Existing Canonical Subsystems: Search and read the canonical files listed in the repository architecture table.
2. Formulate Minimal Coherent Diff: Make atomic, targeted changes that advance the wave without touching unrelated files.
3. Static Verification: Run TypeScript typechecking and linter suites.
4. Unit & Integration Testing: Execute the targeted Vitest test suites for the modified subsystems.
5. Android Compilation: Ensure Android Gradle tasks (`compileDebugKotlin`, `testDebugUnitTest`) pass cleanly.
6. Physical Device Verification: Run targeted validation on the attached Samsung Galaxy A07 hardware fixture.
7. Regression Suite: Run full system regression suites to ensure zero breakage of previously verified features.
8. Checkpoint Report: Produce an exhaustive technical report detailing:
   - Modified files and exact line changes
   - Canonical architectural decisions made
   - Test counts and pass rates
   - Physical device verification evidence and ADB log snippets
   - Known limitations or open questions
9. Await User Approval: STOP and await explicit user authorization before creating a Git commit or advancing to the next wave.

---

# FINAL QUALITY BAR & RELEASE VERIFICATION CHECKLIST

Before any phase or wave can be considered complete, it must satisfy this comprehensive checklist:

- [ ] Zero Emojis: Scanned entire codebase and documentation; zero emojis detected.
- [ ] No Parallel Duplicates: Verified all memory, permission, context, tool, and computer use code extends canonical implementations.
- [ ] Fail-Closed Security: Unclassified tools default to `DENY`; permissions remain authoritative runtime arbiters.
- [ ] Provenance Integrity: Spatial and contextual data carries verified source tags; zero timezone-based geocoding.
- [ ] Telemetry Decoupling: Browser frames and raw visual captures stream exclusively to Watch Computer; zero frame leakage into chat transcripts.
- [ ] Atomic Persistence: All file and memory writes utilize `writeFileAtomic` with mode 0600 and secret scrubbing.
- [ ] Hardware Verification: Successfully executed on physical Samsung Galaxy A07 (`SM-A075F`, Android 16).
- [ ] Test Suite Green: 100% pass rate across Vitest server tests and Android unit tests.
- [ ] Clean Working Tree: Zero unstaged temporary files, zero unapproved git commits, zero git pushes.
