# MOBOT — MASTER IMPLEMENTATION DIRECTIVE
# PHASE 0 + PHASE 1 OF THE 54-PHASE AGENT EVOLUTION PROGRAM
# SUBSYSTEM FORENSICS → AUTHORITATIVE AGENT CONTRACT → BEHAVIORAL SPECIALIZATION FOUNDATION

================================================================================
EXECUTION MODE
================================================================================

You are the Lead Systems Architect, Principal Engineer, Agent-Runtime Engineer,
Android Systems Engineer, and Behavioral Systems Engineer responsible for
implementing Phase 0 and Phase 1 of the MOBOT Evolution Program.

This is not a generic feature request.

This is not a UI-only change.

This is not a prompt-writing exercise.

This is not permission to rebuild MOBOT from scratch.

This is a foundational architectural phase whose purpose is to establish the
authoritative substrate upon which all later agentic behavior will be built.

The existing MOBOT codebase already contains substantial systems for:

- persistent storage
- bots
- conversations
- model providers
- Codex authentication
- permissions
- tool execution
- filesystem
- terminal
- browser
- Android computer use
- Composio connected services
- location
- memory
- goals
- watches
- automations
- turn lifecycle
- attachments
- updater
- Android onboarding
- Android UI
- Watch Computer surface
- physical-device execution

Your responsibility is to understand the existing architecture before modifying
it, preserve everything that already works, identify the canonical implementation
of each subsystem, and create a clean authoritative foundation for real
agentic behavior.

The overarching transformation is:

CURRENT:
    bot = model + system prompt + tools

TARGET:
    bot = persistent autonomous teammate with:
        identity
        role
        priorities
        context sensitivity
        memory relationships
        capability preferences
        verification standards
        communication behavior
        autonomous operating policy
        compatibility with persistent goals
        compatibility with background execution
        compatibility with real computer/tool activity

The final objective of these two phases is NOT to make MOBOT fully autonomous
yet.

The objective is to make the architecture capable of becoming fully autonomous
without requiring another rewrite of the bot model later.

================================================================================
NON-NEGOTIABLE RULES
================================================================================

1. INSPECT BEFORE IMPLEMENTING.

Before modifying behavioral architecture, inspect the relevant repository
structure and identify:

- canonical source of truth
- state ownership
- persistence ownership
- lifecycle ownership
- API boundaries
- client/server boundaries
- Android/native boundaries
- existing tests
- existing duplication
- historical compatibility constraints
- existing race-condition protections
- existing isolation guarantees

Do not guess.

Do not assume a file is canonical merely because its name sounds canonical.

Trace actual call paths.

2. DO NOT CREATE DUPLICATE SUBSYSTEMS.

Before creating a new manager, store, registry, runtime, engine, service,
resolver, scheduler, memory layer, permission layer, or execution layer:

    SEARCH FOR AN EXISTING EQUIVALENT.

If an existing system already performs the required responsibility:

    EXTEND IT.

Do not create competing parallel versions.

3. PRESERVE EXISTING FUNCTIONALITY.

The following already-hardened capabilities must not regress:

- bot persistence
- conversation persistence
- thread isolation
- attachment isolation
- memory isolation
- permission enforcement
- connected service state
- provider authentication
- terminal
- filesystem
- browser
- Android computer use
- location provenance
- goals
- watches
- automations
- turn lifecycle
- updater
- onboarding
- physical Android execution
- no-emoji UI rule
- current test suite

4. REAL EXECUTION ONLY.

Do not create fake:

- tool activity
- browser activity
- terminal activity
- computer-use state
- progress
- completed tasks
- service connections
- memory
- location
- files
- verification results
- agent execution

Anything represented as occurring must actually occur.

5. NO PROMPT-ONLY SECURITY.

Agent contracts may influence behavior.

They may NOT bypass:

- permission policy
- Android permissions
- service authorization
- provider authentication
- filesystem isolation
- thread isolation
- bot isolation
- location privacy
- safety boundaries

6. FAIL CLOSED.

Unknown or unclassified capabilities must continue to fail closed.

7. NO SECRET LEAKAGE.

Never expose:

- API keys
- OAuth tokens
- refresh tokens
- internal credentials
- sensitive connection metadata

through:

- UI logs
- agent output
- activity feeds
- test snapshots
- error payloads
- diagnostics visible to users

8. NO RAW CHAIN OF THOUGHT.

Expose:

- actions
- status
- capability
- result
- verification
- failures
- progress

Do not expose hidden chain-of-thought.

9. NO AUTOMATIC GIT COMMIT.

Do not commit.

Do not push.

Do not rewrite Git history.

Stop at the final acceptance gate and provide a detailed report.

10. NO UNAUTHORIZED SCOPE EXPANSION.

Do not silently implement later phases.

However, Phase 0 and Phase 1 must create clean architectural attachment points for
later phases, especially:

- persistent goal execution
- agent runtime
- context engine
- memory reconciliation
- Watch Computer
- background jobs
- capability orchestration
- long-horizon execution

If a later capability requires an interface to be created now, create only the
minimum authoritative interface required.

================================================================================
PRODUCT NORTH STAR
================================================================================

MOBOT MUST EVOLVE TOWARD:

"A persistent team of specialized agents that knows the user, understands the
current situation, has access to the world around it, and independently works
toward useful outcomes."

The user must eventually feel that a bot is:

- someone with a role
- someone with priorities
- someone who remembers
- someone who understands context
- someone who can act
- someone who can continue working
- someone who can recover from failures
- someone who can make useful judgments
- someone who can use the user's available capabilities
- someone who can operate the phone
- someone who can work in the background
- someone whose actual activity can be observed

The system should NOT feel like:

"generic chat model + tools."

================================================================================
SECTION A — PHASE 0
SUBSYSTEM FORENSICS AND CANONICAL ARCHITECTURAL LEDGER
================================================================================

PHASE 0 IS FORENSICS FIRST.

Do not begin by implementing AgentContract.

First establish an authoritative understanding of the existing system.

--------------------------------------------------------------------------------
A1. FORENSIC OBJECTIVE
--------------------------------------------------------------------------------

Produce an authoritative architectural ledger covering all core MOBOT systems.

The ledger must establish:

- canonical implementation
- responsibilities
- inputs
- outputs
- state ownership
- persistence ownership
- lifecycle
- public/internal APIs
- Android/server boundaries
- consumers
- mutation paths
- event paths
- test coverage
- known invariants
- known limitations
- future extension points
- duplicate/overlapping implementations
- dangerous coupling

--------------------------------------------------------------------------------
A2. CANONICAL SUBSYSTEMS TO TRACE
--------------------------------------------------------------------------------

Trace at minimum:

1. Canonical Store / Persistence
2. Model Providers / Codex Authentication
3. Permission and Tool Execution Policy
4. Android Computer Use
5. Connected Services / Composio
6. Filesystem / Terminal / Browser
7. Context / Location
8. Memory
9. Goals / Watches / Automations
10. Turn Lifecycle / Steering
11. Updater / Safety Snapshots
12. Android Compose UI / Onboarding / Watch Computer

Do not assume the list is exhaustive.

During forensic inspection, identify any additional subsystem that is relevant
to agent execution, such as:

- attachment/document registries
- artifact handling
- research orchestration
- background execution
- notification system
- activity/event streaming
- capability registry
- job scheduler
- conversation state
- bot role/profile systems
- model routing
- error/retry infrastructure

Add these to the ledger if they materially participate in agent behavior.

--------------------------------------------------------------------------------
A3. CANONICAL STORE FORENSICS
--------------------------------------------------------------------------------

Trace:

- bots.json
- messages.db
- threads.json
- config.json
- memory persistence
- goals persistence
- watches persistence
- automation persistence
- artifact persistence
- attachment persistence

Determine:

- every mutation entry point
- every read path
- every serialization/deserialization path
- every recovery path
- every restart path
- every delete path
- every bot cleanup path
- every cross-thread boundary

Confirm that bot mutations route through the existing canonical Store.

Do not create an AgentContract persistence mechanism outside the canonical store.

--------------------------------------------------------------------------------
A4. MODEL / PROVIDER FORENSICS
--------------------------------------------------------------------------------

Trace:

- provider definitions
- model selection
- Codex OAuth
- OpenAI-compatible API keys
- provider configuration
- model persistence
- provider error handling
- auth lifecycle
- secret redaction

Confirm that AgentContract additions do not accidentally duplicate
provider selection or authentication.

The contract may influence agent behavior, but provider authentication remains
owned by the provider subsystem.

--------------------------------------------------------------------------------
A5. PERMISSION FORENSICS
--------------------------------------------------------------------------------

Trace:

- agent-tool-policy.ts
- capability-registry
- Android runtime permission boundaries
- tool invocation boundaries
- connected service authorization
- computer-use permissions
- location permissions
- terminal/filesystem/browser permissions

Document:

    Agent intent
        ↓
    capability request
        ↓
    permission evaluation
        ↓
    actual execution

The AgentContract must NEVER become a second permission system.

--------------------------------------------------------------------------------
A6. COMPUTER USE FORENSICS
--------------------------------------------------------------------------------

Trace:

- android-computer.ts
- phone proxy
- AccessibilityService
- screen observation
- screenshots
- semantic UI nodes
- action execution
- action lifecycle
- retries
- mutex/serialization
- Android lifecycle
- failure classification

Confirm that the phone remains the actual computer.

There must be no desktop pairing dependency.

Document how a future Agent Runtime will request computer-use actions.

Do not implement a new computer-use engine.

--------------------------------------------------------------------------------
A7. CONNECTED SERVICE FORENSICS
--------------------------------------------------------------------------------

Trace Composio end-to-end:

    agent/tool intent
        ↓
    canonical capability
        ↓
    connection state
        ↓
    authorization
        ↓
    Composio execution
        ↓
    result
        ↓
    verification

Document existing states and authoritative state ownership.

AgentContract must not create a second service abstraction.

--------------------------------------------------------------------------------
A8. FILE / TERMINAL / BROWSER FORENSICS
--------------------------------------------------------------------------------

Trace:

- workspace isolation
- per-thread state
- per-bot state
- command execution
- browser navigation
- browser results
- file parsing
- attachment access
- generated artifacts

Identify all places where agent execution currently touches files.

Confirm that future Agent Runtime events can reference real actions without
moving file ownership into the AgentContract.

--------------------------------------------------------------------------------
A9. LOCATION AND CONTEXT FORENSICS
--------------------------------------------------------------------------------

Trace every location source.

Required source classes:

- DEVICE_LIVE
- USER_EXPLICIT
- SAVED_USER
- CONVERSATION_CONTEXT
- UNKNOWN / UNAVAILABLE

Identify:

- source creation
- persistence
- sanitization
- reuse
- expiration
- clearing
- bot switching
- conversation switching
- restart behavior
- privacy suppression

Absolutely forbid:

- timezone → location inference
- test fixture → production location
- stale location → current location
- assistant response → authoritative location without valid provenance

Document exactly how AgentContract will consume context without taking ownership
of the location subsystem.

--------------------------------------------------------------------------------
A10. MEMORY FORENSICS
--------------------------------------------------------------------------------

Trace:

- stable facts
- preferences
- projects
- goals
- episodic memory
- memory journals
- confidence
- provenance
- bot scoping
- shared scoping
- deletion
- update
- reconciliation
- persistence

IMPORTANT MEMORY REQUIREMENT:

Do NOT force the Phase 1 contract to own memory.

The AgentContract should declare which classes of context matter to the bot.

The Memory Engine remains the authoritative owner of memory.

--------------------------------------------------------------------------------
A11. GOALS / WATCHES / AUTOMATIONS FORENSICS
--------------------------------------------------------------------------------

Trace:

- goal creation
- milestone progression
- watch state
- paused state
- automation state
- deletion
- persistence
- background execution
- trigger evaluation

Phase 1 must NOT rebuild these systems.

Instead, document how a future Agent Runtime can consume goal state.

CRITICAL:

The AgentContract must NOT become the goal itself.

The distinction must remain:

    Agent Identity / Contract
        =
    "Who this bot is and how it tends to operate"

    Objective / Goal
        =
    "What this bot is currently trying to accomplish"

--------------------------------------------------------------------------------
A12. TURN LIFECYCLE FORENSICS
--------------------------------------------------------------------------------

Trace:

- user send
- turn creation
- thinking state
- prompt assembly
- tool calls
- failures
- steering
- retry
- cancellation
- completion
- persistence
- message streaming
- multi-turn behavior

Identify exactly where AgentContract should enter prompt construction.

Do not create a second turn lifecycle.

--------------------------------------------------------------------------------
A13. UPDATER FORENSICS
--------------------------------------------------------------------------------

Ensure AgentContract changes are included safely in:

- persistence snapshots
- migration
- validation
- rollback

Do not hard-code assumptions about test counts, current release versions,
or repository state.

--------------------------------------------------------------------------------
A14. ANDROID UI FORENSICS
--------------------------------------------------------------------------------

Trace:

- onboarding
- bot creation
- bot profile
- chat
- settings
- Watch Computer
- theme
- mascot
- role selection
- persistence
- process restart

Determine exactly where role identity should surface.

Do not create a second bot identity state on Android.

--------------------------------------------------------------------------------
A15. FORENSIC OUTPUT
--------------------------------------------------------------------------------

Before implementation, produce a structured internal ledger:

SUBSYSTEM
CANONICAL OWNER
PERSISTENCE
MUTATION API
READ API
EVENTS
DEPENDENCIES
CONSUMERS
SECURITY BOUNDARY
TESTS
KNOWN RISKS
AGENT EXTENSION POINT
WATCH COMPUTER EXTENSION POINT

Also explicitly list:

DUPLICATE SYSTEMS FOUND
POTENTIAL CONFLICTS
UNCERTAIN OWNERSHIP
MIGRATION REQUIREMENTS

Do not modify behavioral architecture until this inspection is complete.

--------------------------------------------------------------------------------
A16. PHASE 0 GATE
--------------------------------------------------------------------------------

PHASE 0 PASSES ONLY IF:

- every core subsystem has a canonical owner
- every relevant mutation path is identified
- every persistence path is understood
- no new duplicate system was created
- dangerous overlaps are identified
- the AgentContract insertion point is known
- the future Agent Runtime insertion point is known
- the future Watch Computer event source is known
- current regression invariants are documented
- no existing security boundary is weakened

Then stop and report.

Do not commit.

Do not push.

Do not silently continue into implementation without recording the ledger.

================================================================================
SECTION B — PHASE 1
AUTHORITATIVE AGENT CONTRACT AND BEHAVIORAL SPECIALIZATION
================================================================================

PHASE 1 establishes what a bot IS.

It does not yet attempt to implement the complete long-horizon agent runtime.

The purpose is to make bots structurally capable of becoming persistent
autonomous teammates.

================================================================================
B1. AGENT CONTRACT DEFINITION
================================================================================

Create one canonical AgentContract representation.

The contract must represent at least:

- role type
- role title
- operational mission
- cognitive stance
- communication behavior
- priority order
- tool affinity
- context sensitivities
- verification preferences
- failure-recovery preference
- autonomy policy
- behavioral directives
- compatibility/version metadata

The AgentContract must be:

- serializable
- persistable
- backwards compatible
- schema-validatable
- inspectable
- deterministic when defaults are resolved
- safe against malformed legacy data

================================================================================
B2. DO NOT MAKE ROLE TYPE THE WHOLE IDENTITY
================================================================================

A bot role is not sufficient by itself.

These are different:

ROLE:
    "Personal Researcher"

IDENTITY:
    "Atlas"

MISSION:
    investigate, synthesize, compare, explain

CONTEXT SENSITIVITY:
    user preferences, projects, location when relevant

TOOL AFFINITY:
    browser, search, files, terminal

VERIFICATION:
    cross-check important findings

COMMUNICATION:
    concise synthesis

Therefore the contract must support both:

- semantic role
- specific bot identity

================================================================================
B3. ROLE PRESETS VS CORE ARCHITECTURE
================================================================================

Do NOT make a handful of starter roles permanently define the architecture.

Starter roles are presets.

The contract system must support additional roles later.

Initial presets may include:

- Joke Teller
- Study Buddy
- Idea Generator
- Personal Researcher
- Problem Solver
- General Autonomous Teammate

But these must be represented as default contract presets, not as a hard
architectural limitation.

A future bot should be able to have a custom role without requiring a schema rewrite.

================================================================================
B4. CORE CONTRACT DIMENSIONS
================================================================================

Every AgentContract should support the following dimensions.

--------------------------------------------------------------------------------
B4.1 PERCEPTUAL FILTER
--------------------------------------------------------------------------------

What does this bot naturally notice?

Examples:

Researcher:
    claims, evidence, source quality, contradictions

Problem Solver:
    symptoms, failure causes, logs, dependencies

Study Buddy:
    comprehension gaps, misconceptions, prerequisite knowledge

Planner:
    deadlines, dependencies, constraints, sequencing

General Teammate:
    task relevance, user context, likely next actions

This MUST influence actual selection and prioritization behavior where possible.

It must not be purely descriptive text.

--------------------------------------------------------------------------------
B4.2 COGNITIVE STANCE
--------------------------------------------------------------------------------

Represent the preferred mode of thought/interaction without exposing hidden
chain-of-thought.

Possible semantic values:

- reactive_immediate
- iterative_investigative
- systematic_analytical
- socratic_pedagogical
- divergent_creative
- strategic_planning
- pragmatic_execution

These are behavioral policies, not hidden reasoning traces.

A cognitive stance should influence:

- decomposition depth
- investigation preference
- tool selection tendencies
- response structure
- verification preference

--------------------------------------------------------------------------------
B4.3 PRIORITY ORDER
--------------------------------------------------------------------------------

Represent an ordered list of priorities.

Example:

Problem Solver:

1. solve the actual problem
2. identify root cause
3. minimize blast radius
4. verify outcome
5. explain relevant result

Researcher:

1. answer the user's actual question
2. gather reliable evidence
3. synthesize rather than dump
4. identify uncertainty
5. provide useful conclusion

This priority list should influence conflict resolution when several behaviors
are possible.

--------------------------------------------------------------------------------
B4.4 TOOL AFFINITY
--------------------------------------------------------------------------------

Represent:

- preferred tools
- secondary tools
- discouraged tools
- reasons/conditions for using tools

But IMPORTANT:

Tool affinity is NOT permission.

Tool affinity is NOT a hard capability boundary.

Tool affinity means:

"This bot tends to prefer this capability when appropriate."

Actual availability remains governed by the canonical capability registry and
permission system.

--------------------------------------------------------------------------------
B4.5 AUTONOMY POLICY
--------------------------------------------------------------------------------

DO NOT use a hard tool-step number as a proxy for autonomy.

DO NOT encode:

"after N tool calls, ask the user."

That would recreate premature stopping.

Instead, represent autonomy conceptually through:

- default autonomous behavior
- conditions for continuing
- conditions requiring user input
- high-impact action policy
- safety boundary policy
- resource boundary policy
- failure recovery policy

Conceptual model:

CONTINUE when:
    goal remains incomplete
    next action is safe
    required capability is available
    meaningful progress is possible

PAUSE / ASK when:
    user intent is materially ambiguous
    action is significantly destructive
    missing authorization is required
    missing configuration requires user choice
    no safe next action exists

STOP when:
    objective complete
    objective impossible
    unrecoverable blocker
    user cancellation
    hard safety boundary
    legitimate system resource boundary

If an implementation-specific action-depth safeguard is necessary,
it must be treated as a safety/resource guard, NEVER as:

"now ask the user."

--------------------------------------------------------------------------------
B4.6 FAILURE RECOVERY POLICY
--------------------------------------------------------------------------------

A contract may describe how aggressively a bot should recover.

Examples:

Researcher:
    alternate search queries, alternate sources

Problem Solver:
    alternate diagnostics, inspect logs, try controlled reproduction

Planner:
    re-evaluate assumptions and re-sequence

General Teammate:
    choose the simplest viable recovery

But actual retry/replan execution belongs to the future canonical Agent Runtime.

The contract expresses preferred behavior.

It must not create a separate runtime.

--------------------------------------------------------------------------------
B4.7 VERIFICATION CONTRACT
--------------------------------------------------------------------------------

Each agent may have a verification standard.

Examples:

Researcher:
    cross-check important facts

Problem Solver:
    execute test or inspect actual state

Filesystem-focused agent:
    read back generated artifact

Computer-use agent:
    inspect post-action UI

Verification must be extensible.

Do NOT hard-code a tiny four-value verification enum if the existing system
will need more verification methods later.

Support an extensible verification requirement model.

Examples:

- file_readback
- command_exit_check
- browser_state_check
- api_response_check
- ui_visual_inspection
- ui_semantic_verification
- factual_cross_reference
- artifact_integrity
- service_state_check
- persistence_readback
- goal_state_verification
- user_visible_outcome_verification

--------------------------------------------------------------------------------
B4.8 COMMUNICATION CONTRACT
--------------------------------------------------------------------------------

Represent preferred communication behavior:

- concise
- detailed
- technical
- conversational
- playful
- academic
- pragmatic
- structured
- natural

This must NOT force every answer into one fixed response format.

The final response system will still choose:

- length
- format
- structure

based on current task/context.

The contract is a preference, not a rigid output template.

--------------------------------------------------------------------------------
B4.9 CONTEXT SENSITIVITY
--------------------------------------------------------------------------------

Represent what contextual dimensions are especially relevant to this bot.

Potential dimensions:

- user_preferences
- projects
- goals
- current_location
- nearby_context
- current_device
- installed_apps
- filesystem
- browser_state
- connected_services
- current_time
- current_conversation
- recent_decisions

This does not grant access.

It declares relevance.

Actual access remains controlled by canonical context and permission systems.

--------------------------------------------------------------------------------
B4.10 BEHAVIORAL DIRECTIVES
--------------------------------------------------------------------------------

Behavioral directives should be:

- specific
- measurable where possible
- role-relevant
- non-contradictory
- safe
- compatible with the canonical agent runtime

Avoid generic filler:

"Be helpful."

Prefer:

"When investigating factual claims, prioritize primary/authoritative sources
and synthesize contradictions rather than dumping raw search results."

================================================================================
B5. AUTHORITATIVE BOT DATA MODEL
================================================================================

Extend the canonical Bot model so AgentContract is part of the authoritative bot
identity.

Do NOT create a second Agent table unless the existing architecture proves that
one is required.

The Bot model should remain compatible with existing bots.

Use a schema/versioning strategy that permits:

- old bots without explicit contract
- contract resolution from legacy metadata
- explicit contract persistence
- controlled migration
- default fallback

Legacy bots must not break.

================================================================================
B6. CONTRACT RESOLUTION
================================================================================

Create one canonical resolver:

    resolveAgentContract(bot)

Resolution order should be deterministic.

For example:

1. valid explicit persisted contract
2. valid role metadata
3. valid legacy title/role inference
4. safe general-teammate default

Do not infer a complex behavioral profile from arbitrary conversational text.

Malformed contracts should:

- fail validation
- fall back safely
- preserve user data
- never crash the turn system

================================================================================
B7. CONTRACT VERSIONING
================================================================================

Introduce contract schema versioning.

Example concept:

    agentContractVersion

This is required because later phases will evolve:

- autonomy
- tool affinity
- verification
- context sensitivity
- role configuration

The migration mechanism must support future contract schema evolution without
destroying old bot data.

Do not hard-code only the current version as if it will never change.

================================================================================
B8. PROMPT COMPILATION
================================================================================

Upgrade the canonical system-prompt construction.

AgentContract should compile into a clearly bounded authoritative directive
block.

The generated block must communicate:

- identity
- role
- mission
- priorities
- cognitive stance
- preferred capability behavior
- verification standards
- communication preferences
- contextual sensitivities
- autonomy philosophy
- role-specific behavioral directives

The compiler must be deterministic.

Do not append arbitrary contract text in scattered locations.

Do not duplicate role rules across multiple prompt builders.

One canonical compiler.

================================================================================
B9. PROMPT INTEGRITY
================================================================================

The contract must be treated as authoritative within the agent's behavioral
hierarchy.

Generic assistant behavior must not erase:

- role identity
- role mission
- role priorities

However, safety policies, permission policies, system invariants, and
user-authorized explicit instructions remain higher priority where applicable.

The implementation must preserve this hierarchy explicitly.

================================================================================
B10. EXPLICIT USER OVERRIDE
================================================================================

Role consistency is important.

But the user's explicit request can temporarily override role behavior.

Example:

A research bot can be asked:

"Forget research mode for a moment and help me debug this."

The bot should adapt.

However, the role does not disappear permanently.

After the task, the bot should still retain its underlying identity.

Therefore distinguish:

- persistent role identity
- temporary task mode
- explicit user override

Do not mutate permanent role settings merely because the user requested a
temporary behavior change.

================================================================================
B11. BEHAVIORAL DIVERGENCE
================================================================================

Roles must differ behaviorally.

Create a differential test matrix using identical inputs.

At minimum test:

1. simple factual request
2. technical problem
3. ambiguous request
4. long task
5. failure scenario
6. research question
7. creative request
8. connected-service opportunity
9. file-based task
10. computer-use opportunity

For every scenario, verify that role differences affect meaningful behavior,
not merely wording.

Examples:

Problem Solver should tend toward:
    diagnose → inspect → test → verify

Researcher should tend toward:
    investigate → compare → synthesize → cite

Study Buddy should tend toward:
    explain → scaffold → check understanding

Idea Generator should tend toward:
    generate → diversify → filter → propose experiments

Joke Teller should tend toward:
    conversational response rather than automatically invoking heavyweight tools

General Teammate should remain broad and context-sensitive.

================================================================================
B12. BEHAVIORAL DIFFERENCE MUST BE TESTABLE
================================================================================

Do NOT accept:

"the outputs sound different."

Require behavioral evidence where tool use is expected.

Examples:

Problem Solver receives broken repository:
    should tend to inspect files or execute tests when available.

Joke Teller receives same prompt:
    should not blindly execute terminal diagnostics.

Researcher receives factual comparison:
    should gather/synthesize evidence when appropriate.

Study Buddy receives learning request:
    should emphasize understanding rather than raw answer delivery.

The test should inspect:

- selected tool class
- number/type of tool attempts
- response structure
- verification behavior
- recovery behavior
- task framing

Avoid requiring exact model output text.

================================================================================
B13. AGENT CONTRACT MUST NOT CONTROL PERMISSIONS
================================================================================

A contract saying:

"Primary tool = terminal"

does not mean terminal permission is automatically granted.

Actual chain:

Agent preference
    ↓
Capability decision
    ↓
Permission system
    ↓
Actual tool execution

If permission is denied:

The agent must respect denial.

Do not weaken permission gates.

================================================================================
B14. AGENT CONTRACT MUST NOT OWN GOALS
================================================================================

Separate:

WHO I AM
from
WHAT I AM DOING

AgentContract:
    persistent identity and behavioral preferences.

Goal:
    current objective.

Task:
    current execution instance.

Turn:
    current interaction.

Job:
    persistent execution lifecycle.

Do not merge these into a single oversized structure.

This separation is essential for future long-horizon execution.

================================================================================
B15. AGENT CONTRACT MUST NOT OWN MEMORY
================================================================================

AgentContract may specify:

- memory categories especially relevant
- preference for recalling project context
- preferred scope

But the canonical Memory Engine remains authoritative.

Do not duplicate memory storage.

Do not put arbitrary memory blobs inside Bot records.

================================================================================
B16. AGENT CONTRACT MUST NOT OWN TOOL EXECUTION
================================================================================

The contract describes preference.

The canonical Tool Execution Engine remains authoritative.

Do not embed tool implementations into role code.

Do not implement:

if role == researcher:
    custom browser engine

Instead:

AgentContract
    → informs capability selection

Canonical Tool Engine
    → performs capability

================================================================================
B17. AGENT CONTRACT MUST NOT OWN WATCH COMPUTER
================================================================================

Watch Computer is a separate observation surface.

However, Phase 1 MUST establish the architectural interface needed for future
Watch Computer integration.

Define or identify a canonical agent execution event model.

Conceptually:

AgentExecutionEvent {
    eventId
    jobId / turnId
    botId
    timestamp
    capability
    actionType
    target
    lifecycleState
    resultSummary
    verificationState
    errorCategory
    metadata
}

Do not leak secrets.

Do not store hidden chain-of-thought.

The point is:

If MOBOT eventually uses:

- browser
- terminal
- phone
- files
- Maps
- Gmail
- GitHub
- Composio

the Watch Computer surface must later be able to observe real events from the
same execution source.

Do NOT build the complete Watch Computer implementation in Phase 1 unless
strictly necessary.

Build the canonical event/extension boundary.

================================================================================
B18. EXECUTION EVENT REQUIREMENTS
================================================================================

AgentExecutionEvent should support lifecycle concepts such as:

REQUESTED
STARTED
OBSERVING
EXECUTING
SUCCEEDED
FAILED
RETRYING
REPLANNING
PAUSED
WAITING_FOR_USER
CANCELLED
VERIFIED
COMPLETED

Use only states that fit the existing architecture.

Avoid creating multiple competing lifecycle state machines.

If a canonical action lifecycle already exists, integrate with it instead of
creating another.

================================================================================
B19. FUTURE GOAL INTEGRATION POINT
================================================================================

Phase 1 must clearly establish how AgentContract connects to future goals.

Conceptually:

Agent
    |
    +-- AgentContract
    |
    +-- Current Goal
    |
    +-- Context
    |
    +-- Memory
    |
    +-- Capability Registry
    |
    +-- Runtime State

The contract should influence:

- priorities
- verification
- tool affinity
- communication

The goal should define:

- objective
- constraints
- success criteria
- progress
- current strategy
- remaining work

The future Agent Runtime should orchestrate both.

Do not implement the entire planner/replanner if it belongs to later phases.

Do create the clean boundary.

================================================================================
B20. MEMORY RECONCILIATION REQUIREMENT
================================================================================

The architecture must support the following behavior:

If newer evidence strongly contradicts an old memory, the memory system should
be able to revise its understanding automatically.

Examples:

OLD:
    user prefers X

NEW EXPLICIT:
    user says they now prefer Y

EXPECTED:
    memory updates toward Y

But:

WEAK:
    user happened to choose Y once

EXPECTED:
    do not automatically erase a strong established preference

Memory reconciliation should consider:

- explicitness
- source
- confidence
- recency
- repetition
- context
- specificity
- contradiction strength

PHASE 1 SHOULD NOT IMPLEMENT A GIANT NEW MEMORY ENGINE.

Instead:

1. preserve the existing canonical memory engine
2. document the required reconciliation contract
3. expose the interface the later memory phase can use
4. ensure AgentContract does not contradict it

================================================================================
B21. ROLE CONTEXT SENSITIVITY
================================================================================

Bots should differ in what context they consider especially important.

Example:

Personal Researcher:
    user preferences
    active project
    source quality
    research context

Problem Solver:
    filesystem
    logs
    device state
    installed apps
    execution state

Study Buddy:
    previous learning gaps
    study material
    progress
    knowledge level

General Teammate:
    broad relevant context

This must not grant unauthorized access.

Context sensitivity is a prioritization mechanism.

================================================================================
B22. COMMUNICATION ADAPTATION
================================================================================

The AgentContract should influence style, but must NOT override situational
communication.

Example:

A technical bot can still respond casually when the user is casually talking.

A playful bot can become precise during a serious task.

A research bot can be concise for a tiny question.

Therefore the final response system should conceptually combine:

BOT CONTRACT
+
CURRENT TASK
+
USER TONE
+
CONVERSATION CONTEXT
+
RESULT COMPLEXITY

Do not implement rigid personality prisons.

================================================================================
B23. PRODUCTIVE AUTONOMY
================================================================================

The contract system should be compatible with this future target:

IF GOAL IS CLEAR
AND ACTION IS AVAILABLE
AND ACTION IS SAFE
AND NO USER DECISION IS REQUIRED

THEN:

    continue autonomously.

Do not force:

"ask user after N steps."

Do not encode premature stopping behavior into roles.

The future runtime must be able to pursue long tasks.

================================================================================
B24. ROLE-SPECIFIC VERIFICATION
================================================================================

Verification must be behaviorally meaningful.

Examples:

Problem Solver:
    test actual fix.

Researcher:
    validate important evidence.

Study Buddy:
    verify comprehension when pedagogically appropriate.

Idea Generator:
    verify that ideas satisfy the requested constraints rather than
    mechanically executing tests.

Joke Teller:
    verify conversational appropriateness rather than requiring web evidence.

General Teammate:
    choose verification appropriate to the task.

Do not require identical verification for every role.

================================================================================
B25. ROLE-SPECIFIC FAILURE RECOVERY
================================================================================

Failure behavior should differ appropriately.

Researcher:
    search differently
    change sources
    compare conflicting evidence

Problem Solver:
    inspect logs
    reproduce
    isolate
    test alternative fix

Study Buddy:
    simplify
    change explanation
    use another example
    diagnose misunderstanding

Idea Generator:
    change creative axis
    alter constraints
    generate alternatives

General Teammate:
    choose the most efficient safe recovery

Do not hard-code actual recovery implementations here.

Expose policy hooks for the future Agent Runtime.

================================================================================
B26. BOT CREATION
================================================================================

Integrate AgentContract into the existing bot creation flow.

Do not allow automatic surprise bot creation.

Clean installation remains:

    zero bots

The user explicitly creates the first bot.

Starter role selection should map to a real contract preset.

The persisted bot must retain:

- role
- contract
- identity
- configuration
- model selection
- avatar/mascot state
- existing fields

No data loss.

================================================================================
B27. BOT EDITING
================================================================================

If the user changes a bot's role:

- update the contract deterministically
- preserve stable user memory
- preserve conversation history
- preserve unrelated bot settings
- make the role change obvious

Do not silently mutate historical conversations.

Do not retroactively rewrite old bot identity.

================================================================================
B28. ANDROID MODEL ALIGNMENT
================================================================================

The Android model representation must remain compatible with the server's
canonical Bot schema.

Avoid duplicate contract semantics on Android.

Android should primarily:

- display
- select
- edit
- persist through canonical APIs
- reflect current authoritative state

The server-side contract resolution remains authoritative unless existing
architecture requires otherwise.

================================================================================
B29. UI REQUIREMENTS
================================================================================

The role should be visible where useful:

- bot profile
- onboarding
- relevant bot settings
- Watch Computer identity
- active work indicators where applicable

Do not overload the Chat UI.

Do not create:

- giant role cards
- AI dashboards
- excessive metadata
- decorative statistics

The user should understand:

WHO is working
WHAT their role is
WHAT they are doing

without UI clutter.

================================================================================
B30. MASCOT / VISUAL IDENTITY
================================================================================

Preserve the existing canonical mascot architecture.

Do not create a second mascot system.

If role-specific visual adaptation already exists or is required, ensure the
visual layer reflects identity without becoming a substitute for behavioral
specialization.

Visual difference is secondary.

Behavioral difference is primary.

================================================================================
B31. BACKWARD COMPATIBILITY
================================================================================

Existing bots may lack explicit AgentContract.

They must continue working.

Migration strategy must support:

- missing contract
- legacy role/title
- partial contract
- malformed contract
- future contract versions

Safe fallback:

GENERAL AUTONOMOUS TEAMMATE

unless another existing authoritative role can be reliably inferred.

Do not fabricate role semantics from weak evidence.

================================================================================
B32. SCHEMA VALIDATION
================================================================================

Add strong validation.

Validate:

- enum values
- required fields
- array types
- nested structures
- numeric bounds where applicable
- unknown fields according to chosen schema policy
- version compatibility

Malformed contract:

- must not crash startup
- must not crash chat
- must not corrupt bots.json
- must fall back safely
- should be observable in developer diagnostics

================================================================================
B33. PERSISTENCE SAFETY
================================================================================

AgentContract persistence must use existing safe persistence practices.

Test:

- create
- update
- delete
- restart
- force stop
- reload
- malformed data
- partial data
- schema migration

Ensure bot deletion removes contract state with the bot.

Ensure contract data cannot leak between bots.

================================================================================
B34. CONTRACT SERIALIZATION
================================================================================

Round-trip test:

Bot
→ serialize
→ persist
→ reload
→ resolve
→ compare

The contract should preserve all meaningful semantics.

No silent loss of:

- role
- priorities
- tool affinity
- verification
- context sensitivity
- communication preferences
- autonomy policy

================================================================================
B35. PROMPT GENERATION TESTS
================================================================================

Test:

- contract present
- contract absent
- legacy bot
- malformed contract
- custom role
- all starter presets
- temporary explicit user override
- conflicting instructions

The compiled prompt should:

- contain the authoritative role block
- preserve higher-priority system safety rules
- not contain secrets
- not duplicate contract blocks
- not grow uncontrollably with every turn

================================================================================
B36. DIFFERENTIAL ROLE TEST MATRIX
================================================================================

Use a test suite where multiple bots receive identical scenarios.

SCENARIO 1:
"Here is a repository with a broken test. Help me."

Expected tendency:

Problem Solver:
    inspect → test → diagnose → fix → verify

Joke Teller:
    conversational/humorous response unless explicitly asked to operate

SCENARIO 2:
"Compare these three research claims."

Researcher:
    investigate → cross-check → synthesize

Study Buddy:
    explain concepts and possibly test understanding

SCENARIO 3:
"I don't know what project to build."

Idea Generator:
    generate diversified options

Problem Solver:
    could focus on constraints and feasibility

Study Buddy:
    could help clarify learning objectives

SCENARIO 4:
"Why is this code failing?"

Problem Solver:
    diagnose empirically

Joke Teller:
    should not automatically launch terminal diagnostics

SCENARIO 5:
"I need to understand this chapter."

Study Buddy:
    pedagogical behavior

Researcher:
    evidence/reference orientation

SCENARIO 6:
"Find me the best option."

Researcher:
    investigate and synthesize

General Teammate:
    can perform broad comparison

The test must evaluate meaningful behavioral differences.

================================================================================
B37. NO LLM-ONLY ACCEPTANCE
================================================================================

Do not mark behavioral specialization complete because:

"the model produced a different answer."

Acceptance must include observable evidence where appropriate:

- different tool decisions
- different verification choices
- different context usage
- different recovery behavior
- different output structure
- different task decomposition tendency

Textual differences alone are insufficient.

================================================================================
B38. AGENT CONTRACT INSPECTION TOOLING
================================================================================

Provide developer-facing diagnostics sufficient to inspect:

- resolved role
- contract version
- mission
- priorities
- tool affinities
- context sensitivities
- verification policy
- autonomy policy
- communication policy

Do not expose secrets.

Do not expose hidden model reasoning.

This diagnostic capability should help future debugging of:

"Why did this bot behave this way?"

================================================================================
B39. FUTURE WATCH COMPUTER COMPATIBILITY
================================================================================

The Phase 1 implementation must not block the future Watch Computer feature.

At minimum, identify or establish canonical event boundaries allowing Watch
Computer to observe:

- bot begins work
- capability selected
- action begins
- action completes
- action fails
- agent replans
- agent pauses
- agent resumes
- agent verifies
- agent completes

The events should point to actual execution.

No fake activity layer.

================================================================================
B40. FUTURE BACKGROUND EXECUTION COMPATIBILITY
================================================================================

Phase 1 should not implement the entire persistent background runtime.

But AgentContract must not assume:

"one turn = one short response."

It must remain compatible with:

- long-running jobs
- background tasks
- persistent objectives
- multiple tool actions
- retries
- pauses
- resumes
- waiting for user
- job completion

This is essential.

================================================================================
B41. FUTURE GOAL-ORIENTED RUNTIME COMPATIBILITY
================================================================================

The contract must be compatible with future:

UNDERSTAND
→ DEFINE SUCCESS
→ PLAN
→ ACT
→ OBSERVE
→ EVALUATE
→ REPLAN
→ CONTINUE

Do not hard-code one-shot chat assumptions into the contract.

================================================================================
B42. FUTURE CONTEXT ENGINE COMPATIBILITY
================================================================================

AgentContract should be able to consume a canonical context object later.

Conceptual:

AgentContext {
    conversation
    userContext
    locationContext
    deviceContext
    activeJob
    currentGoal
    availableCapabilities
    permissionState
    connectedServices
    relevantMemory
    currentArtifacts
}

Phase 1 need not implement the complete context engine.

But it must not invent competing context structures.

================================================================================
B43. FUTURE MEMORY RECONCILIATION COMPATIBILITY
================================================================================

The contract should be able to express:

- what memory categories matter
- what preferences are relevant
- what context types are high priority

The Memory Engine remains responsible for:

- storing
- scoring
- reconciling
- expiring
- deleting
- sourcing

================================================================================
B44. FUTURE CAPABILITY ROUTING COMPATIBILITY
================================================================================

The contract should feed into future capability selection.

Conceptual:

User Goal
+
AgentContract
+
Context
+
AvailableCapabilities
+
Permissions
=
Capability Decision

But:

AgentContract does not execute the tool.

The canonical execution layer remains authoritative.

================================================================================
B45. TESTING REQUIREMENTS
================================================================================

Create tests for:

1. contract schema
2. serialization
3. deserialization
4. legacy fallback
5. migration
6. malformed contract
7. role resolution
8. prompt compilation
9. priority resolution
10. tool affinity interpretation
11. verification contract
12. context sensitivity
13. role switching
14. bot deletion
15. process restart
16. persistence
17. Android model alignment
18. behavioral divergence
19. permission compatibility
20. secret redaction
21. Watch Computer event compatibility
22. goal compatibility
23. memory compatibility

================================================================================
B46. PROPERTY / INVARIANT TESTING
================================================================================

Add invariant tests such as:

INVARIANT 1:
Every bot resolves to exactly one effective AgentContract.

INVARIANT 2:
No bot can resolve to an invalid contract.

INVARIANT 3:
A contract never grants a capability.

INVARIANT 4:
A contract never bypasses a permission denial.

INVARIANT 5:
Deleting a bot deletes its contract state.

INVARIANT 6:
Contract state cannot leak across bots.

INVARIANT 7:
Contract state survives restart.

INVARIANT 8:
Legacy bots remain valid.

INVARIANT 9:
The contract compiler is deterministic.

INVARIANT 10:
The contract cannot contain secrets.

INVARIANT 11:
Role differences remain observable in behavioral tests.

INVARIANT 12:
No numeric autonomy safeguard forces a user confirmation merely because
a step threshold was reached.

INVARIANT 13:
The contract cannot fabricate context.

INVARIANT 14:
The contract cannot override system safety.

INVARIANT 15:
The contract cannot override user explicit task instructions when the task
does not violate higher-priority boundaries.

================================================================================
B47. PHYSICAL ANDROID VERIFICATION
================================================================================

Use the physical Samsung Galaxy A07 whenever hardware is required.

Do not replace physical verification with assumptions.

At minimum verify:

1. fresh installation
2. onboarding
3. zero initial bot state
4. create starter bot
5. contract persistence
6. bot identity display
7. role selection
8. chat
9. process restart
10. force stop
11. app relaunch
12. role persistence
13. contract persistence
14. legacy bot compatibility where practical
15. no data loss
16. no UI regression
17. no emoji regression
18. no secret leakage
19. no computer-use regression
20. no permission regression

Do not hard-code old test counts.

Run the current test suite and report the actual counts at execution time.

================================================================================
B48. TESTING CURRENT REPOSITORY, NOT HISTORICAL ASSUMPTIONS
================================================================================

Do not assume:

- current Android test count
- current server test count
- current release version
- current dependency versions
- current file counts
- current OS behavior
- current model/provider list

Instead:

DISCOVER
→ RUN
→ REPORT CURRENT VALUE

This prevents stale specifications from becoming false acceptance criteria.

================================================================================
B49. LINT / TYPECHECK / BUILD
================================================================================

At the end of Phase 1 run all relevant existing validation:

- TypeScript typecheck
- server tests
- core Android tests
- app Android tests
- integration tests
- lint where configured
- debug build
- release build where relevant
- APK installation where required

Report exact results.

Do not replace real verification with:

"looks good."

================================================================================
B50. REGRESSION SAFETY
================================================================================

Specifically re-test:

- bot creation
- bot deletion
- conversations
- groups
- message sending
- thinking state
- cancellation
- model selection
- provider auth
- attachments
- PDF viewer
- filesystem
- terminal
- browser
- computer use
- Maps
- location
- memory
- goals
- watches
- automations
- connected services
- permissions
- updater
- onboarding
- Watch Computer entry point

You are changing the definition of a bot.

Therefore test every subsystem that depends on Bot identity.

================================================================================
B51. NO BEHAVIORAL PLACEBO
================================================================================

Do not declare the phase complete if the implementation merely changes the
system prompt.

A successful implementation must establish:

- canonical persisted contract
- schema
- resolver
- migration
- prompt compilation
- behavioral hooks
- capability preference hooks
- verification hooks
- context sensitivity hooks
- future runtime integration points
- behavioral tests
- physical verification

The bot must be structurally capable of acting differently.

================================================================================
B52. NO PREMATURE AGENT-RUNTIME IMPLEMENTATION
================================================================================

Do not silently implement the entire future autonomous runtime during Phase 1.

The future runtime may include:

- persistent goal execution
- planning
- replanning
- background execution
- long-horizon orchestration
- active context engine
- Watch Computer
- autonomous recovery

Phase 1 only needs to make the architecture ready for these.

Do not turn Phase 1 into an uncontrolled rewrite.

================================================================================
B53. FINAL ARCHITECTURAL DELIVERABLES
================================================================================

At completion, produce:

1. Phase 0 canonical subsystem ledger
2. ownership graph
3. dependency summary
4. identified duplicate/overlap report
5. AgentContract schema
6. role preset definitions
7. contract resolver
8. persistence integration
9. schema migration strategy
10. prompt compiler integration
11. capability-affinity integration hooks
12. verification hooks
13. context sensitivity integration
14. execution-event integration boundary
15. future-goal integration boundary
16. future-memory integration boundary
17. future-Agent-Runtime integration boundary
18. tests
19. physical-device verification report
20. exact files changed
21. exact test counts
22. known limitations
23. unresolved risks

================================================================================
B54. FINAL ACCEPTANCE CRITERIA
================================================================================

Phase 0 passes ONLY if:

[ ] Canonical subsystem owners identified
[ ] State ownership documented
[ ] Persistence ownership documented
[ ] Mutation paths identified
[ ] AgentContract insertion point identified
[ ] Future Agent Runtime boundary identified
[ ] Future Watch Computer event boundary identified
[ ] Existing security boundaries documented
[ ] Existing regression invariants documented
[ ] No duplicate systems created

Phase 1 passes ONLY if:

[ ] Every bot resolves to an AgentContract
[ ] Contract persists safely
[ ] Contract survives restart
[ ] Legacy bots remain functional
[ ] Malformed contract fails safely
[ ] Role presets work
[ ] Custom-role architecture remains possible
[ ] Role influences real behavior
[ ] Behavioral differential tests pass
[ ] Tool affinity does not bypass permissions
[ ] Verification policy is represented
[ ] Context sensitivity is represented
[ ] Autonomy policy does not enforce arbitrary step-count stopping
[ ] Explicit user instructions can temporarily override role behavior
[ ] Contract is compatible with future goal runtime
[ ] Contract is compatible with future memory reconciliation
[ ] Contract is compatible with future Watch Computer
[ ] Contract is compatible with future background execution
[ ] No secrets are exposed
[ ] No existing subsystems regress
[ ] Physical Android verification passes
[ ] Full current test suite passes
[ ] Current build succeeds
[ ] Working tree is understood and reported
[ ] No Git commit performed
[ ] No Git push performed

================================================================================
FINAL HUMAN-EXPERIENCE ACCEPTANCE
================================================================================

Ask one final question before declaring success:

"If I create two MOBOT bots with meaningfully different roles, do they now
actually behave like different teammates, or do they merely sound different?"

The answer must be:

THEY BEHAVE DIFFERENTLY.

A successful Phase 1 should make it possible to say:

"This bot has an identity, a mission, priorities, preferences, context
sensitivities, tool tendencies, verification standards, and autonomous
operating policy."

It should NOT yet require:

"this bot has already mastered long-horizon execution."

That comes later.

================================================================================
MANDATORY STOP CONDITIONS
================================================================================

STOP and report instead of improvising if you discover:

- contradictory sources of truth
- multiple competing stores
- duplicate memory systems
- permission bypass
- inconsistent bot schemas
- unsafe migration
- state ownership ambiguity
- impossible backward compatibility
- hidden test contamination
- fabricated context
- secret leakage
- Watch Computer architecture that conflicts with the required event model
- an existing system that would be damaged by the proposed design

Do not paper over architectural contradictions.

Report them.

================================================================================
MANDATORY FINAL REPORT FORMAT
================================================================================

At completion, report:

PHASE:
    0 + 1

STATUS:
    PASS / PARTIAL / BLOCKED

ARCHITECTURAL FINDINGS:
    ...

CANONICAL SUBSYSTEM LEDGER:
    ...

CHANGES MADE:
    ...

FILES CREATED:
    ...

FILES MODIFIED:
    ...

FILES REMOVED:
    ...

MIGRATIONS:
    ...

TESTS:
    exact current counts

TYPECHECK:
    ...

LINT:
    ...

BUILD:
    ...

PHYSICAL DEVICE:
    exact device verification

BEHAVIORAL ROLE TESTS:
    ...

PERSISTENCE TESTS:
    ...

REGRESSION TESTS:
    ...

KNOWN LIMITATIONS:
    ...

UNRESOLVED RISKS:
    ...

FUTURE PHASE INTEGRATION POINTS:
    ...

GIT:
    DO NOT COMMIT
    DO NOT PUSH

Then STOP and WAIT for explicit approval.

================================================================================
ULTIMATE PRINCIPLE
================================================================================

Do not build a smarter prompt.

Build the architectural foundation for a smarter agent.

Do not make MOBOT look autonomous.

Make its architecture capable of becoming autonomous.

Do not make bots sound different.

Make their priorities, context sensitivity, capability preferences,
verification standards, and behavior different.

Do not create more isolated features.

Create one coherent system in which:

IDENTITY
+
CONTEXT
+
MEMORY
+
GOALS
+
CAPABILITIES
+
PERMISSIONS
+
EXECUTION
+
OBSERVATION
+
VERIFICATION

can eventually operate as one agentic organism.

PHASE 0 establishes the truth of the existing architecture.

PHASE 1 establishes what a MOBOT agent actually is.

Everything after this should build on those foundations.
================================================================================
END OF PHASE 0 + PHASE 1 MASTER IMPLEMENTATION DIRECTIVE
================================================================================
