 # MOBOT — PHASE 2 ONLY
# BUILD A REAL CONTEXT ENGINE
# PRODUCTION IMPLEMENTATION + ADVERSARIAL VERIFICATION

You are now authorized to implement ONLY:

# PHASE 2 — BUILD A REAL CONTEXT ENGINE

This phase comes from `mobot_54_phases_prompt.md`.

PHASE 1 is already complete and accepted.

DO NOT IMPLEMENT PHASE 3 OR ANY LATER PHASE.

Do not begin:

- context provenance redesign
- long-term memory redesign
- memory reconciliation
- shared/private memory redesign
- autonomous execution loop
- persistent goals
- self-evaluation
- autonomous replanning
- capability routing redesign
- background execution
- Watch Computer redesign
- multi-agent orchestration
- any unrelated feature

However, Phase 2 MUST create clean interfaces that later phases can safely
extend.

The goal is to turn MOBOT's context handling from a simplistic conversation
history assembly mechanism into a real, bounded, relevance-aware Context
Engine.

================================================================================
0. PHASE OBJECTIVE
================================================================================

The master specification defines this phase as:

Replace naive conversation-history dumping with a multi-layered, bounded
Context Engine.

The Context Engine must dynamically assemble:

1. Immediate conversational state
2. Persistent user context
3. Relevant environmental context

while:

- respecting token budgets
- preserving relevant context
- avoiding irrelevant context
- avoiding cross-thread leakage
- handling attachments safely
- preserving provenance boundaries for future Phase 3
- avoiding prompt bloat
- avoiding stale environmental state
- remaining deterministic and testable

The target architecture is conceptually:

RAW SIGNALS
    ↓
RELEVANCE FILTER
    ↓
SCOPING / ISOLATION
    ↓
TOKEN BUDGET ALLOCATION
    ↓
COMPRESSION / SUMMARIZATION
    ↓
CITATION / SNIPPET GENERATION
    ↓
DynamicContextFrame
    ↓
SYSTEM / PLANNER CONTEXT INJECTION

Do NOT simply add more text to the system prompt.

Build an actual context assembly pipeline.

================================================================================
1. FIRST: CODEBASE ARCHAEOLOGY
================================================================================

Before modifying any source file:

Inspect the existing implementation of:

- `server/capabilities/context-pipeline.ts`
- `server/turn-context.ts`
- `server/section-context.ts`
- `server/system-prompt.ts`
- prompt assembly
- conversation loading
- message history retrieval
- attachments
- memory reads
- bot profile / AgentContract resolution
- current environment/device state
- browser state
- Android computer session state
- current workspace state
- token accounting utilities
- summarization utilities
- any existing context caches
- SSE/turn events involved in context generation
- existing context-related tests
- existing attachment tests
- existing bot/thread isolation tests

Also inspect the Phase 1 AgentContract implementation.

The Context Engine must consume AgentContract information where relevant,
but must NOT duplicate the AgentContract system.

Determine:

- what currently enters the prompt
- where it enters
- in what order
- how much enters
- where it is truncated
- whether different prompt builders duplicate context
- where attachments are injected
- where memory is injected
- whether context is currently assembled more than once
- where environment data comes from
- whether the current environment data is authoritative
- what existing tests already cover

Do not guess.

================================================================================
2. CANONICAL OWNERSHIP
================================================================================

The canonical Context Engine authority is:

- `server/capabilities/context-pipeline.ts`
- `server/turn-context.ts`
- `server/section-context.ts`

Integrate with existing code.

Do not create:

- ContextEngine2
- DynamicContextManager2
- PromptContextStore
- duplicate attachment context pipeline
- duplicate memory context pipeline

If multiple competing context systems already exist:

1. identify them
2. determine which is canonical
3. document the conflict
4. consolidate only where required for this phase
5. preserve existing working behavior

================================================================================
3. FORMAL CONTEXT CONTRACT
================================================================================

Implement or evolve the canonical context frame around the Phase 2 contract:

```ts
export interface DynamicContextFrame {
  turnId: string;
  botId: string;
  timestamp: number;
  tokenBudget: number;

  layers: {
    immediate: {
      activeConversation: Array<{
        role: "user" | "bot" | "tool";
        content: string;
      }>;

      activeDraftText?: string;

      activeAttachments: Array<{
        id: string;
        mimeType: string;
        snippet: string;
      }>;
    };

    persistent: {
      userPreferences: Record<string, string>;
      activeProjectSummary?: string;
      stableFacts: string[];
    };

    environmental: {
      deviceState: {
        batteryLevel?: number;
        isCharging?: boolean;
        networkType: "wifi" | "cellular" | "none";
      };

      activeWorkspaceRoot: string;

      openBrowserTabUrl?: string;

      activeComputerSessionId?: string;
    };
  };
}
```

================================================================================
4. STATE TRANSITIONS & BEHAVIORAL INVARIANTS
================================================================================

- Invariant 1: Immediate conversation history consumes a guaranteed minimum of 40% of the allocated context budget.
- Invariant 2: Environmental context is injected only when explicitly relevant to the active task.
- Invariant 3: Device telemetry older than 60 seconds is treated as stale and excluded or refreshed.
- Invariant 4: No emojis anywhere in code, comments, logs, or UI text.

================================================================================
5. FAILURE CLASSIFICATION & RECOVERY PROTOCOLS
================================================================================

- ERR_CONTEXT_OVERFLOW: Combined context exceeds token budget limit.
  - Recovery: Eagerly compress environmental context first, then summarize distant turns using server/section-context.ts.
- ERR_STALE_ENVIRONMENT_STATE: Cached device telemetry is older than 60 seconds.
  - Recovery: Trigger an out-of-band state refresh probe via HarnessHost.

================================================================================
6. ANTI-PATTERNS & PROHIBITED IMPLEMENTATIONS
================================================================================

- Do not dump entire files into the system prompt. Always route file ingestion through server/capabilities/context-pipeline.ts to produce bounded snippets with line citations.
- Do not leak private context across independent conversation threads or bots.
- Zero emojis.

================================================================================
7. VERIFICATION & ACCEPTANCE CRITERIA
================================================================================

- Unit Test: Run server/capabilities/context-pipeline.test.ts and server/turn-context.test.ts.
- Verify strict adherence to token budgets and 40% minimum immediate conversation budget under adversarial payload sizes.
- Integration Test: Bounded snippet generation with citations.
- Device Test: Physical Samsung Galaxy A07 live state updates via API.

  

