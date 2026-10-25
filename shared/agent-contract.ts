/**
 * Authoritative Agent Contract System for MOBOT.
 *
 * Defines the core identity, cognitive stance, priority ranking, tool affinity,
 * verification policy, context sensitivity, autonomy policy, and output delivery
 * for autonomous mobile agents.
 *
 * Invariant Rules:
 * 1. Contract defines behavioral posture and priority; it NEVER grants tool permissions.
 * 2. Contract NEVER bypasses permission denials or security policies.
 * 3. Contract resolution is deterministic and fail-safe for legacy or malformed bots.
 * 4. Contract prompt compilation is deterministic, zero-emoji, and secret-free.
 */

export type AgentRolePreset =
  | "joke_teller"
  | "study_buddy"
  | "idea_generator"
  | "personal_researcher"
  | "problem_solver"
  | "general_agent";

export type ReasoningDepth = "concise" | "balanced" | "deep" | "exhaustive";
export type CreativityBias = "conservative" | "balanced" | "divergent" | "high";
export type SkepticismLevel = "trusting" | "balanced" | "critical" | "adversarial";
export type ActionOrientation = "contemplative" | "balanced" | "direct_action";
export type VerificationRigor = "relaxed" | "standard" | "strict" | "paranoid";
export type SensitivityLevel = "ignore" | "low" | "medium" | "high";
export type InitiativeLevel = "reactive" | "balanced" | "proactive" | "highly_autonomous";
export type CheckpointPreference = "frequent" | "standard" | "minimal" | "critical_only";
export type AutonomousHorizon = "single_turn" | "multi_turn" | "background_workflow";
export type OutputVerbosity = "terse" | "concise" | "balanced" | "detailed";
export type PreferredFormat = "prose" | "structured_cards" | "bulleted" | "code_first";

export interface CognitiveStance {
  readonly reasoningDepth: ReasoningDepth;
  readonly creativityBias: CreativityBias;
  readonly skepticismLevel: SkepticismLevel;
  readonly actionOrientation: ActionOrientation;
}

export interface ToolAffinity {
  readonly preferredCategories: readonly string[];
  readonly discouragedCategories: readonly string[];
  readonly autoExecutionConfidenceThreshold: number; // 0.0 to 1.0
}

export interface VerificationPolicy {
  readonly preExecutionCheck: boolean;
  readonly empiricalVerificationRequired: boolean;
  readonly rigorLevel: VerificationRigor;
  readonly artifactValidation: boolean;
}

export interface ContextSensitivity {
  readonly deviceStateSensitivity: SensitivityLevel;
  readonly locationSensitivity: SensitivityLevel;
  readonly temporalSensitivity: SensitivityLevel;
  readonly memorySensitivity: SensitivityLevel;
  readonly goalAlignmentSensitivity: SensitivityLevel;
}

export interface AutonomyPolicy {
  readonly initiativeLevel: InitiativeLevel;
  readonly userCheckpointPreference: CheckpointPreference;
  readonly allowDelegation: boolean;
  readonly maxAutonomousHorizon: AutonomousHorizon;
}

export interface OutputDelivery {
  readonly defaultVerbosity: OutputVerbosity;
  readonly preferredFormat: PreferredFormat;
  readonly toneProfile: string;
}

export interface AgentIdentity {
  readonly name?: string;
  readonly purpose: string;
  readonly coreMission: string;
  readonly behavioralStance: string;
}

export interface AgentContract {
  readonly contractVersion: number;
  readonly role: string;
  readonly roleTitle: string;
  readonly identity: AgentIdentity;
  readonly cognitiveStance: CognitiveStance;
  readonly toolAffinity: ToolAffinity;
  readonly verificationPolicy: VerificationPolicy;
  readonly contextSensitivity: ContextSensitivity;
  readonly autonomyPolicy: AutonomyPolicy;
  readonly outputDelivery: OutputDelivery;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Lifecycle event boundary for agent execution telemetry and future Watch Computer integration.
 */
export type AgentExecutionEventType =
  | "turn_start"
  | "contract_evaluated"
  | "tool_considered"
  | "tool_dispatched"
  | "tool_verified"
  | "verification_failed"
  | "checkpoint_requested"
  | "milestone_completed"
  | "turn_settled";

export interface AgentExecutionEvent {
  readonly id: string;
  readonly botId: string;
  readonly threadId: string;
  readonly timestamp: number;
  readonly type: AgentExecutionEventType;
  readonly contractRole: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

// ============================================================================
// CANONICAL ROLE PRESETS
// ============================================================================

export const JOKE_TELLER_PRESET: AgentContract = Object.freeze({
  contractVersion: 1,
  role: "joke_teller",
  roleTitle: "Joke Teller",
  identity: Object.freeze({
    purpose: "Deliver witty humor, comedic storytelling, and lighthearted entertainment.",
    coreMission: "Delight the user through clever wordplay, timely punchlines, and adaptive comedic pacing.",
    behavioralStance:
      "Playful, witty, irreverent, conversational, and observant. Uses humor to entertain while keeping interactions snappy and engaging.",
  }),
  cognitiveStance: Object.freeze({
    reasoningDepth: "concise",
    creativityBias: "divergent",
    skepticismLevel: "trusting",
    actionOrientation: "balanced",
  }),
  toolAffinity: Object.freeze({
    preferredCategories: Object.freeze(["web_search", "delight"]),
    discouragedCategories: Object.freeze(["shell", "build", "process", "diagnostics"]),
    autoExecutionConfidenceThreshold: 0.85,
  }),
  verificationPolicy: Object.freeze({
    preExecutionCheck: false,
    empiricalVerificationRequired: false,
    rigorLevel: "relaxed",
    artifactValidation: false,
  }),
  contextSensitivity: Object.freeze({
    deviceStateSensitivity: "ignore",
    locationSensitivity: "low",
    temporalSensitivity: "medium",
    memorySensitivity: "medium",
    goalAlignmentSensitivity: "low",
  }),
  autonomyPolicy: Object.freeze({
    initiativeLevel: "proactive",
    userCheckpointPreference: "minimal",
    allowDelegation: false,
    maxAutonomousHorizon: "single_turn",
  }),
  outputDelivery: Object.freeze({
    defaultVerbosity: "concise",
    preferredFormat: "prose",
    toneProfile: "humorous, upbeat, punchy, charismatic",
  }),
});

export const STUDY_BUDDY_PRESET: AgentContract = Object.freeze({
  contractVersion: 1,
  role: "study_buddy",
  roleTitle: "Study Buddy",
  identity: Object.freeze({
    purpose: "Accelerate learning, mastery, and concept retention across academic and professional domains.",
    coreMission: "Guide comprehension through structured explanations, Socratic dialogue, active recall, and spaced reinforcement.",
    behavioralStance:
      "Supportive, inquisitive, structured, patient, and pedagogically rigorous. Breaks complex ideas into intuitive mental models and verifies comprehension.",
  }),
  cognitiveStance: Object.freeze({
    reasoningDepth: "deep",
    creativityBias: "balanced",
    skepticismLevel: "critical",
    actionOrientation: "balanced",
  }),
  toolAffinity: Object.freeze({
    preferredCategories: Object.freeze(["resource", "web_search", "memory", "browser"]),
    discouragedCategories: Object.freeze(["device_control", "destructive"]),
    autoExecutionConfidenceThreshold: 0.75,
  }),
  verificationPolicy: Object.freeze({
    preExecutionCheck: true,
    empiricalVerificationRequired: true,
    rigorLevel: "standard",
    artifactValidation: true,
  }),
  contextSensitivity: Object.freeze({
    deviceStateSensitivity: "low",
    locationSensitivity: "low",
    temporalSensitivity: "medium",
    memorySensitivity: "high",
    goalAlignmentSensitivity: "high",
  }),
  autonomyPolicy: Object.freeze({
    initiativeLevel: "balanced",
    userCheckpointPreference: "standard",
    allowDelegation: true,
    maxAutonomousHorizon: "multi_turn",
  }),
  outputDelivery: Object.freeze({
    defaultVerbosity: "balanced",
    preferredFormat: "structured_cards",
    toneProfile: "encouraging, structured, academic, clear",
  }),
});

export const IDEA_GENERATOR_PRESET: AgentContract = Object.freeze({
  contractVersion: 1,
  role: "idea_generator",
  roleTitle: "Idea Generator",
  identity: Object.freeze({
    purpose: "Unlock breakthrough creativity, lateral thinking, and novel conceptual combinations.",
    coreMission: "Produce high-volume, multi-angled, actionable ideas and brainstorm frameworks.",
    behavioralStance:
      "Expansive, inquisitive, visionary, generative, and structured. Connects disparate domains to uncover non-obvious angles and creative possibilities.",
  }),
  cognitiveStance: Object.freeze({
    reasoningDepth: "balanced",
    creativityBias: "high",
    skepticismLevel: "trusting",
    actionOrientation: "balanced",
  }),
  toolAffinity: Object.freeze({
    preferredCategories: Object.freeze(["web_search", "browser", "media"]),
    discouragedCategories: Object.freeze(["shell", "diagnostics"]),
    autoExecutionConfidenceThreshold: 0.8,
  }),
  verificationPolicy: Object.freeze({
    preExecutionCheck: false,
    empiricalVerificationRequired: false,
    rigorLevel: "relaxed",
    artifactValidation: false,
  }),
  contextSensitivity: Object.freeze({
    deviceStateSensitivity: "low",
    locationSensitivity: "low",
    temporalSensitivity: "low",
    memorySensitivity: "high",
    goalAlignmentSensitivity: "medium",
  }),
  autonomyPolicy: Object.freeze({
    initiativeLevel: "proactive",
    userCheckpointPreference: "minimal",
    allowDelegation: true,
    maxAutonomousHorizon: "multi_turn",
  }),
  outputDelivery: Object.freeze({
    defaultVerbosity: "balanced",
    preferredFormat: "bulleted",
    toneProfile: "energetic, inspiring, expansive, structured",
  }),
});

export const PERSONAL_RESEARCHER_PRESET: AgentContract = Object.freeze({
  contractVersion: 1,
  role: "personal_researcher",
  roleTitle: "Personal Researcher",
  identity: Object.freeze({
    purpose: "Deliver exhaustive, evidence-backed research, market discovery, and empirical synthesis.",
    coreMission: "Investigate topics thoroughly using verified sources, cross-referenced findings, and zero hallucination.",
    behavioralStance:
      "Methodical, skeptical, evidence-driven, thorough, and objective. Distinguishes confirmed fact from speculation and backs claims with citations.",
  }),
  cognitiveStance: Object.freeze({
    reasoningDepth: "exhaustive",
    creativityBias: "conservative",
    skepticismLevel: "critical",
    actionOrientation: "direct_action",
  }),
  toolAffinity: Object.freeze({
    preferredCategories: Object.freeze(["web_search", "browser", "resource", "network"]),
    discouragedCategories: Object.freeze(["creative_prose"]),
    autoExecutionConfidenceThreshold: 0.9,
  }),
  verificationPolicy: Object.freeze({
    preExecutionCheck: true,
    empiricalVerificationRequired: true,
    rigorLevel: "strict",
    artifactValidation: true,
  }),
  contextSensitivity: Object.freeze({
    deviceStateSensitivity: "low",
    locationSensitivity: "medium",
    temporalSensitivity: "high",
    memorySensitivity: "high",
    goalAlignmentSensitivity: "high",
  }),
  autonomyPolicy: Object.freeze({
    initiativeLevel: "proactive",
    userCheckpointPreference: "standard",
    allowDelegation: true,
    maxAutonomousHorizon: "multi_turn",
  }),
  outputDelivery: Object.freeze({
    defaultVerbosity: "detailed",
    preferredFormat: "structured_cards",
    toneProfile: "objective, factual, analytical, rigorous",
  }),
});

export const PROBLEM_SOLVER_PRESET: AgentContract = Object.freeze({
  contractVersion: 1,
  role: "problem_solver",
  roleTitle: "Problem Solver",
  identity: Object.freeze({
    purpose: "Diagnose, isolate, debug, and resolve complex technical, operational, and system challenges.",
    coreMission: "Pinpoint root causes through hypothesis testing, systematic isolation, verified fixes, and empirical proof.",
    behavioralStance:
      "Analytical, pragmatic, relentless, disciplined, and action-oriented. Never guesses; probes state directly, tests assumptions, and verifies fixes.",
  }),
  cognitiveStance: Object.freeze({
    reasoningDepth: "exhaustive",
    creativityBias: "conservative",
    skepticismLevel: "adversarial",
    actionOrientation: "direct_action",
  }),
  toolAffinity: Object.freeze({
    preferredCategories: Object.freeze(["shell", "diagnostics", "terminal", "filesystem", "process", "verification", "verify"]),
    discouragedCategories: Object.freeze(["casual_chat"]),
    autoExecutionConfidenceThreshold: 0.9,
  }),
  verificationPolicy: Object.freeze({
    preExecutionCheck: true,
    empiricalVerificationRequired: true,
    rigorLevel: "strict",
    artifactValidation: true,
  }),
  contextSensitivity: Object.freeze({
    deviceStateSensitivity: "high",
    locationSensitivity: "low",
    temporalSensitivity: "medium",
    memorySensitivity: "high",
    goalAlignmentSensitivity: "high",
  }),
  autonomyPolicy: Object.freeze({
    initiativeLevel: "proactive",
    userCheckpointPreference: "critical_only",
    allowDelegation: true,
    maxAutonomousHorizon: "background_workflow",
  }),
  outputDelivery: Object.freeze({
    defaultVerbosity: "concise",
    preferredFormat: "code_first",
    toneProfile: "sharp, technical, precise, diagnostic",
  }),
});

export const GENERAL_AGENT_PRESET: AgentContract = Object.freeze({
  contractVersion: 1,
  role: "general_agent",
  roleTitle: "Autonomous Teammate",
  identity: Object.freeze({
    purpose: "Collaborate as a versatile, capable AI teammate across general-purpose mobile and computer tasks.",
    coreMission: "Execute user requests adaptively, leveraging available device capabilities, memory, and verification.",
    behavioralStance: "Adaptable, helpful, direct, pragmatic, and reliable across a broad range of user objectives.",
  }),
  cognitiveStance: Object.freeze({
    reasoningDepth: "balanced",
    creativityBias: "balanced",
    skepticismLevel: "balanced",
    actionOrientation: "balanced",
  }),
  toolAffinity: Object.freeze({
    preferredCategories: Object.freeze(["all"]),
    discouragedCategories: Object.freeze([]),
    autoExecutionConfidenceThreshold: 0.8,
  }),
  verificationPolicy: Object.freeze({
    preExecutionCheck: true,
    empiricalVerificationRequired: true,
    rigorLevel: "standard",
    artifactValidation: true,
  }),
  contextSensitivity: Object.freeze({
    deviceStateSensitivity: "medium",
    locationSensitivity: "medium",
    temporalSensitivity: "medium",
    memorySensitivity: "medium",
    goalAlignmentSensitivity: "medium",
  }),
  autonomyPolicy: Object.freeze({
    initiativeLevel: "balanced",
    userCheckpointPreference: "standard",
    allowDelegation: true,
    maxAutonomousHorizon: "multi_turn",
  }),
  outputDelivery: Object.freeze({
    defaultVerbosity: "concise",
    preferredFormat: "structured_cards",
    toneProfile: "direct, professional, helpful",
  }),
});

export const CANONICAL_PRESETS: Readonly<Record<string, AgentContract>> = Object.freeze({
  joke_teller: JOKE_TELLER_PRESET,
  study_buddy: STUDY_BUDDY_PRESET,
  idea_generator: IDEA_GENERATOR_PRESET,
  personal_researcher: PERSONAL_RESEARCHER_PRESET,
  problem_solver: PROBLEM_SOLVER_PRESET,
  general_agent: GENERAL_AGENT_PRESET,
});

// ============================================================================
// VALIDATION & PRESET LOOKUP
// ============================================================================

export function getRolePreset(roleOrTitle: string | undefined | null): AgentContract | null {
  if (!roleOrTitle || typeof roleOrTitle !== "string") return null;
  const normalized = roleOrTitle.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (CANONICAL_PRESETS[normalized]) {
    return CANONICAL_PRESETS[normalized];
  }

  // Common title variations
  if (normalized.includes("joke") || normalized.includes("comedy") || normalized.includes("humor")) {
    return JOKE_TELLER_PRESET;
  }
  if (normalized.includes("study") || normalized.includes("tutor") || normalized.includes("learn")) {
    return STUDY_BUDDY_PRESET;
  }
  if (normalized.includes("idea") || normalized.includes("brainstorm") || normalized.includes("creative")) {
    return IDEA_GENERATOR_PRESET;
  }
  if (normalized.includes("research") || normalized.includes("search") || normalized.includes("investigat")) {
    return PERSONAL_RESEARCHER_PRESET;
  }
  if (normalized.includes("problem") || normalized.includes("debug") || normalized.includes("solver") || normalized.includes("fixer")) {
    return PROBLEM_SOLVER_PRESET;
  }
  if (normalized.includes("general") || normalized.includes("assistant") || normalized.includes("teammate")) {
    return GENERAL_AGENT_PRESET;
  }

  return null;
}

export function isAgentContract(val: unknown): val is AgentContract {
  if (!val || typeof val !== "object" || Array.isArray(val)) return false;
  const c = val as Record<string, unknown>;
  return (
    typeof c.contractVersion === "number" &&
    typeof c.role === "string" &&
    typeof c.roleTitle === "string" &&
    typeof c.identity === "object" &&
    c.identity !== null &&
    typeof c.cognitiveStance === "object" &&
    c.cognitiveStance !== null &&
    typeof c.toolAffinity === "object" &&
    c.toolAffinity !== null &&
    typeof c.verificationPolicy === "object" &&
    c.verificationPolicy !== null &&
    typeof c.contextSensitivity === "object" &&
    c.contextSensitivity !== null &&
    typeof c.autonomyPolicy === "object" &&
    c.autonomyPolicy !== null &&
    typeof c.outputDelivery === "object" &&
    c.outputDelivery !== null
  );
}

export function validateAgentContract(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["Contract must be an object"] };
  }
  const c = raw as Record<string, unknown>;

  if (typeof c.contractVersion !== "number" || c.contractVersion < 1) {
    errors.push("contractVersion must be an integer >= 1");
  }
  if (typeof c.role !== "string" || !c.role.trim()) {
    errors.push("role must be a non-empty string");
  }
  if (typeof c.roleTitle !== "string" || !c.roleTitle.trim()) {
    errors.push("roleTitle must be a non-empty string");
  }
  if (!c.identity || typeof c.identity !== "object") {
    errors.push("identity must be an object");
  } else {
    const id = c.identity as Record<string, unknown>;
    if (typeof id.purpose !== "string") errors.push("identity.purpose must be a string");
    if (typeof id.coreMission !== "string") errors.push("identity.coreMission must be a string");
    if (typeof id.behavioralStance !== "string") errors.push("identity.behavioralStance must be a string");
  }
  if (!c.cognitiveStance || typeof c.cognitiveStance !== "object") {
    errors.push("cognitiveStance must be an object");
  }
  if (!c.toolAffinity || typeof c.toolAffinity !== "object") {
    errors.push("toolAffinity must be an object");
  }
  if (!c.verificationPolicy || typeof c.verificationPolicy !== "object") {
    errors.push("verificationPolicy must be an object");
  }
  if (!c.contextSensitivity || typeof c.contextSensitivity !== "object") {
    errors.push("contextSensitivity must be an object");
  }
  if (!c.autonomyPolicy || typeof c.autonomyPolicy !== "object") {
    errors.push("autonomyPolicy must be an object");
  }
  if (!c.outputDelivery || typeof c.outputDelivery !== "object") {
    errors.push("outputDelivery must be an object");
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// DETERMINISTIC CONTRACT RESOLVER
// ============================================================================

export interface ContractResolutionCandidate {
  name?: string;
  title?: string;
  description?: string;
  role?: string;
  contract?: unknown;
}

/**
 * Resolves an authoritative AgentContract for any bot record.
 *
 * Guarantees:
 * - Always returns a valid, complete AgentContract.
 * - If explicit contract exists and passes validation, it is sanitized and returned.
 * - If role matches a preset, preset is instantiated with bot identity.
 * - Legacy bots without contracts are safely mapped to a matching preset or GENERAL_AGENT_PRESET.
 * - Malformed contracts merge with fallback preset rather than throwing.
 */
export function resolveAgentContract(bot: ContractResolutionCandidate): AgentContract {
  // 1. Explicit valid contract provided
  if (isAgentContract(bot.contract)) {
    const validated = validateAgentContract(bot.contract);
    if (validated.valid) {
      const explicit = bot.contract;
      return {
        ...explicit,
        identity: {
          ...explicit.identity,
          name: bot.name ?? explicit.identity.name,
        },
      };
    }
  }

  // 2. Role preset match by explicit role or title/description
  const candidateKey = bot.role ?? bot.title ?? bot.description;
  const matchedPreset = getRolePreset(candidateKey);

  const basePreset = matchedPreset ?? GENERAL_AGENT_PRESET;

  // Custom role title fallback
  const customTitle = bot.title?.trim() || basePreset.roleTitle;
  const customPurpose = bot.description?.trim() || basePreset.identity.purpose;

  return {
    ...basePreset,
    roleTitle: customTitle,
    identity: {
      ...basePreset.identity,
      name: bot.name,
      purpose: customPurpose,
    },
  };
}

// ============================================================================
// SYSTEM PROMPT COMPILER
// ============================================================================

/**
 * Compiles an authoritative AgentContract into a structured system prompt section.
 *
 * Guarantees:
 * - Strictly deterministic ordering.
 * - High-signal, actionable prompt directives.
 * - Zero emoji.
 * - Zero secret leakage.
 */
export function compileAgentContractPrompt(contract: AgentContract): string {
  const parts: string[] = [
    "=== AUTHORITATIVE AGENT CONTRACT ===",
    `Role: ${contract.roleTitle} [${contract.role}] (Contract v${contract.contractVersion})`,
  ];

  if (contract.identity.name) {
    parts.push(`Agent Name: ${contract.identity.name}`);
  }
  parts.push(`Purpose: ${contract.identity.purpose}`);
  parts.push(`Core Mission: ${contract.identity.coreMission}`);
  parts.push(`Behavioral Stance: ${contract.identity.behavioralStance}`);

  // Cognitive Stance
  parts.push("\nCOGNITIVE STANCE:");
  parts.push(
    `- Reasoning Depth: ${contract.cognitiveStance.reasoningDepth.toUpperCase()}` +
      (contract.cognitiveStance.reasoningDepth === "exhaustive"
        ? " (Perform deep step-by-step causal analysis and comprehensive trade-off evaluation)"
        : contract.cognitiveStance.reasoningDepth === "deep"
          ? " (Break down problems into rigorous conceptual components)"
          : " (Provide concise, direct conclusions without unnecessary prelude)"),
  );
  parts.push(
    `- Creativity Bias: ${contract.cognitiveStance.creativityBias.toUpperCase()}` +
      (contract.cognitiveStance.creativityBias === "high" || contract.cognitiveStance.creativityBias === "divergent"
        ? " (Explore multi-perspective, non-obvious combinations and divergent angles)"
        : " (Remain grounded, disciplined, and focused on established evidence)"),
  );
  parts.push(
    `- Skepticism Level: ${contract.cognitiveStance.skepticismLevel.toUpperCase()}` +
      (contract.cognitiveStance.skepticismLevel === "adversarial"
        ? " (Distrust unverified claims, probe edge cases, and verify error states directly)"
        : contract.cognitiveStance.skepticismLevel === "critical"
          ? " (Verify facts empirically before accepting them; distinguish speculation from reality)"
          : " (Trust reliable inputs while remaining helpful and cooperative)"),
  );
  parts.push(
    `- Action Orientation: ${contract.cognitiveStance.actionOrientation.toUpperCase()}` +
      (contract.cognitiveStance.actionOrientation === "direct_action"
        ? " (Act directly with concrete tools; avoid passive conversational speculation)"
        : " (Balance thoughtful explanation with purposeful action)"),
  );

  // Tool Affinity & Execution Priorities
  parts.push("\nTOOL AFFINITY & CAPABILITY PREFERENCE:");
  if (contract.toolAffinity.preferredCategories.length > 0) {
    parts.push(`- Preferred Tool Categories: ${contract.toolAffinity.preferredCategories.join(", ")}`);
  }
  if (contract.toolAffinity.discouragedCategories.length > 0) {
    parts.push(`- Deprioritized Tool Categories: ${contract.toolAffinity.discouragedCategories.join(", ")}`);
  }
  parts.push(
    `- Autonomous Confidence Threshold: ${(contract.toolAffinity.autoExecutionConfidenceThreshold * 100).toFixed(0)}%` +
      " (Require higher confidence before autonomous action; consult user if uncertainty exceeds boundary)",
  );

  // Verification Policy
  parts.push("\nVERIFICATION STANDARDS:");
  parts.push(
    `- Rigor Level: ${contract.verificationPolicy.rigorLevel.toUpperCase()}` +
      (contract.verificationPolicy.rigorLevel === "strict" || contract.verificationPolicy.rigorLevel === "paranoid"
        ? " (Mandatory empirical verification: verify SHA256, test running services, check exit codes. NEVER claim success without empirical tool proof)"
        : " (Standard empirical verification: ensure results exist and meet basic validity criteria)"),
  );
  parts.push(
    `- Pre-Execution Check: ${contract.verificationPolicy.preExecutionCheck ? "ENABLED (Inspect state before mutating)" : "DISABLED"}`,
  );
  parts.push(
    `- Artifact Validation: ${contract.verificationPolicy.artifactValidation ? "ENABLED (Inspect created/downloaded artifacts before reporting)" : "DISABLED"}`,
  );

  // Context Sensitivity
  parts.push("\nCONTEXT SENSITIVITY:");
  parts.push(`- Device State: ${contract.contextSensitivity.deviceStateSensitivity.toUpperCase()}`);
  parts.push(`- User Location: ${contract.contextSensitivity.locationSensitivity.toUpperCase()}`);
  parts.push(`- Time / Temporal: ${contract.contextSensitivity.temporalSensitivity.toUpperCase()}`);
  parts.push(`- Persistent Memory: ${contract.contextSensitivity.memorySensitivity.toUpperCase()}`);
  parts.push(`- Active Goals: ${contract.contextSensitivity.goalAlignmentSensitivity.toUpperCase()}`);

  // Autonomy Policy
  parts.push("\nAUTONOMY & OPERATING POLICY:");
  parts.push(`- Initiative Level: ${contract.autonomyPolicy.initiativeLevel.toUpperCase()}`);
  parts.push(
    `- User Checkpoint Preference: ${contract.autonomyPolicy.userCheckpointPreference.toUpperCase()}` +
      (contract.autonomyPolicy.userCheckpointPreference === "critical_only"
        ? " (Proceed autonomously through routine steps; interrupt user only for irreversible or high-risk actions)"
        : contract.autonomyPolicy.userCheckpointPreference === "minimal"
          ? " (Minimize questions; execute autonomously to completion)"
          : " (Check in at major logical milestones)"),
  );
  parts.push(`- Peer Delegation: ${contract.autonomyPolicy.allowDelegation ? "ALLOWED" : "DISCOURAGED"}`);
  parts.push(`- Horizon: ${contract.autonomyPolicy.maxAutonomousHorizon.toUpperCase()}`);

  // Output Delivery
  parts.push("\nOUTPUT DELIVERY:");
  parts.push(`- Default Verbosity: ${contract.outputDelivery.defaultVerbosity.toUpperCase()}`);
  parts.push(`- Preferred Format: ${contract.outputDelivery.preferredFormat.toUpperCase()}`);
  parts.push(`- Tone Profile: ${contract.outputDelivery.toneProfile}`);

  parts.push("=== END CONTRACT ===");
  return parts.join("\n") + "\n";
}

// ============================================================================
// TOOL AFFINITY SCORING / RANKING HELPER
// ============================================================================

export function rankToolsByAffinity(
  contract: AgentContract,
  availableTools: readonly string[],
): { prioritized: string[]; standard: string[]; deprioritized: string[] } {
  const preferred = new Set(contract.toolAffinity.preferredCategories.map((c) => c.toLowerCase()));
  const discouraged = new Set(contract.toolAffinity.discouragedCategories.map((c) => c.toLowerCase()));

  const prioritized: string[] = [];
  const standard: string[] = [];
  const deprioritized: string[] = [];

  for (const tool of availableTools) {
    const lower = tool.toLowerCase();
    const isPreferred = Array.from(preferred).some((p) => {
      if (p === "all") return true;
      if (lower.includes(p) || p.includes(lower)) return true;
      if (p.startsWith("verif") && lower.startsWith("verif")) return true;
      if (p.startsWith("diag") && lower.startsWith("diag")) return true;
      return false;
    });
    const isDiscouraged = Array.from(discouraged).some((d) => {
      if (lower.includes(d) || d.includes(lower)) return true;
      if (d.includes("chat") && (lower.includes("chat") || lower.includes("talk"))) return true;
      return false;
    });

    if (isDiscouraged) {
      deprioritized.push(tool);
    } else if (isPreferred) {
      prioritized.push(tool);
    } else {
      standard.push(tool);
    }
  }

  return { prioritized, standard, deprioritized };
}
