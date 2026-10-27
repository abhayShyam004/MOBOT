/**
 * Ambiguity Resolution Engine (Official Roadmap Phase 15: Natural Uncertainty).
 *
 * Implements intelligent ambiguity resolution, focused clarification, sensible assumptions,
 * consequence-aware decision strategies, and failure classification:
 * - ERR_PARALYSIS_BY_UNCERTAINTY: Agent repeatedly asks clarifying questions for minor details.
 *   - Recovery: Force default reasonable assumption and proceed if risk tier is low.
 * - Invariant: Clarification questions must offer 2 to 4 concise options plus an open text field.
 * - Invariant: Never ask multiple nested clarifying questions in a single turn.
 * - Anti-pattern: Do not prefix responses with generic disclaimers ("As an AI, I am not completely sure...").
 * - Anti-pattern: Do not halt execution when a sensible default exists.
 * - Security Gate: Clarification is not authorization. Naming a target does not bypass Phase 14 confirmation.
 */

import { DeviceSafetyPolicy, type RiskAssessment } from './safety-policy.ts';

export type AmbiguityType = 'minor_preference' | 'critical_intent' | 'irreversible_fork';
export type ConsequenceLevel = 'negligible' | 'moderate' | 'critical';
export type AmbiguityStrategy = 'proceed_with_assumption' | 'ask_focused_question';

export interface ClarificationQuestion {
  prompt: string;
  options: string[];
  allowCustomInput: boolean;
}

export interface AmbiguityResolution {
  ambiguityType: AmbiguityType;
  consequenceLevel: ConsequenceLevel;
  strategy: AmbiguityStrategy;
  statedAssumption?: string;
  clarificationQuestion?: ClarificationQuestion;
}

export const ERR_PARALYSIS_BY_UNCERTAINTY = 'ERR_PARALYSIS_BY_UNCERTAINTY';

export interface AmbiguityValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates an AmbiguityResolution payload according to Phase 15 invariants.
 */
export function validateAmbiguityResolution(resolution: unknown): AmbiguityValidationResult {
  const errors: string[] = [];

  if (!resolution || typeof resolution !== 'object') {
    return { valid: false, errors: ['Ambiguity resolution must be a non-null object.'] };
  }

  const res = resolution as Record<string, unknown>;

  // 1. Validate ambiguityType
  const validTypes: AmbiguityType[] = ['minor_preference', 'critical_intent', 'irreversible_fork'];
  if (!validTypes.includes(res.ambiguityType as AmbiguityType)) {
    errors.push(`Invalid ambiguityType "${res.ambiguityType}". Expected one of: ${validTypes.join(', ')}.`);
  }

  // 2. Validate consequenceLevel
  const validConsequences: ConsequenceLevel[] = ['negligible', 'moderate', 'critical'];
  if (!validConsequences.includes(res.consequenceLevel as ConsequenceLevel)) {
    errors.push(`Invalid consequenceLevel "${res.consequenceLevel}". Expected one of: ${validConsequences.join(', ')}.`);
  }

  // 3. Validate strategy
  const validStrategies: AmbiguityStrategy[] = ['proceed_with_assumption', 'ask_focused_question'];
  if (!validStrategies.includes(res.strategy as AmbiguityStrategy)) {
    errors.push(`Invalid strategy "${res.strategy}". Expected one of: ${validStrategies.join(', ')}.`);
  }

  // 4. Invariant: irreversible_fork cannot proceed with assumption
  if (res.ambiguityType === 'irreversible_fork' && res.strategy === 'proceed_with_assumption') {
    errors.push('Cannot proceed with assumption for an irreversible_fork ambiguity.');
  }

  // 5. Invariant: critical consequence cannot proceed with assumption
  if (res.consequenceLevel === 'critical' && res.strategy === 'proceed_with_assumption') {
    errors.push('Cannot proceed with assumption when consequenceLevel is critical.');
  }

  // 6. Invariant: minor_preference with negligible consequence should proceed with assumption
  if (res.ambiguityType === 'minor_preference' && res.consequenceLevel === 'negligible' && res.strategy === 'ask_focused_question') {
    errors.push('Cannot ask clarification question for a minor_preference with negligible consequence; must proceed with assumption.');
  }

  // 7. Validate strategy-specific fields
  if (res.strategy === 'proceed_with_assumption') {
    if (res.clarificationQuestion !== undefined) {
      errors.push('Clarification question must not be provided when strategy is proceed_with_assumption.');
    }
  } else if (res.strategy === 'ask_focused_question') {
    if (!res.clarificationQuestion || typeof res.clarificationQuestion !== 'object') {
      errors.push('Clarification question is required when strategy is ask_focused_question.');
    } else {
      const q = res.clarificationQuestion as Record<string, unknown>;
      const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
      if (!prompt) {
        errors.push('Clarification question prompt must be a non-empty string.');
      }

      const options = q.options;
      if (!Array.isArray(options)) {
        errors.push('Clarification question options must be an array of strings.');
      } else {
        // Invariant: Clarification questions must offer 2 to 4 concise options
        if (options.length < 2 || options.length > 4) {
          errors.push(`Clarification question options must contain between 2 and 4 choices (received ${options.length}).`);
        }

        // Check for duplicates and non-empty strings
        const seen = new Set<string>();
        for (const opt of options) {
          if (typeof opt !== 'string' || !opt.trim()) {
            errors.push('All clarification question options must be non-empty strings.');
            break;
          }
          const norm = opt.trim().toLowerCase();
          if (seen.has(norm)) {
            errors.push(`Duplicate option detected in clarification question: "${opt.trim()}".`);
            break;
          }
          seen.add(norm);
        }
      }

      if (typeof q.allowCustomInput !== 'boolean') {
        errors.push('allowCustomInput must be a boolean.');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface AmbiguityResolutionContext {
  taskId?: string;
  conversationId?: string;
  activeWorkspaceProject?: string;
  availableCandidates?: string[];
  knownTarget?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  clarificationLoopCount?: number;
  lastAskedQuestion?: string;
  isDestructive?: boolean;
  isExternalMutation?: boolean;
  requiresConfirmation?: boolean;
  targetCapability?: string;
  operation?: string;
  parameters?: Record<string, unknown>;
  userCorrections?: string[];
}

export interface AmbiguityResolutionRequest {
  userPrompt: string;
  context?: AmbiguityResolutionContext;
}

/**
 * Core Ambiguity Resolution Engine.
 * Evaluates consequence, context, and intent to deterministically resolve ambiguity
 * or formulate a focused clarification question.
 */
export function resolveAmbiguity(request: AmbiguityResolutionRequest): AmbiguityResolution {
  const prompt = (request.userPrompt || '').trim();
  const context = request.context || {};
  const candidates = context.availableCandidates || [];
  const loopCount = context.clarificationLoopCount || 0;

  // ── Rule 0: Explicit User Corrections take absolute precedence ──
  if (context.userCorrections && context.userCorrections.length > 0) {
    const latestCorrection = context.userCorrections[context.userCorrections.length - 1];
    return {
      ambiguityType: 'minor_preference',
      consequenceLevel: 'negligible',
      strategy: 'proceed_with_assumption',
      statedAssumption: `Applying explicit user correction: ${latestCorrection}`,
    };
  }

  // ── Rule 1: Prior Answer Already Present in History or Context ──
  if (context.knownTarget && context.knownTarget.trim()) {
    const target = context.knownTarget.trim();
    return {
      ambiguityType: 'minor_preference',
      consequenceLevel: 'negligible',
      strategy: 'proceed_with_assumption',
      statedAssumption: `Target already identified in context: ${target}`,
    };
  }

  // Inspect conversation history for previous target resolution
  if (context.conversationHistory && context.conversationHistory.length > 0) {
    for (const msg of context.conversationHistory) {
      if (msg.role === 'user' && msg.content) {
        // If user already specified a candidate previously
        const found = candidates.find(c => msg.content.toLowerCase().includes(c.toLowerCase()));
        if (found) {
          return {
            ambiguityType: 'minor_preference',
            consequenceLevel: 'negligible',
            strategy: 'proceed_with_assumption',
            statedAssumption: `Using previously chosen target: ${found}`,
          };
        }
      }
    }
  }

  // ── Rule 2: Consequence-Aware Paralysis by Uncertainty Recovery ──
  // If repeated clarification loop detected
  const isHighRisk = context.isDestructive ||
    /(?:delete|destroy|drop\s+database|wipe|purge|remove\s+database|mkfs|wipefs|format\s+(?:disk|drive|[a-z]:))\b/i.test(prompt) ||
    (context.targetCapability === 'device.storage' && /(?:delete|wipe|purge)/i.test(context.operation || ''));

  if (loopCount >= 2) {
    if (!isHighRisk) {
      // For low/medium risk: Force reasonable assumption default and recover
      let fallbackAssumption = 'Proceeding with standard reversible default.';
      if (context.activeWorkspaceProject) {
        fallbackAssumption = `Summarizing active workspace project: ${context.activeWorkspaceProject}`;
      } else if (candidates.length > 0) {
        fallbackAssumption = `Proceeding with default option: ${candidates[0]}`;
      }
      return {
        ambiguityType: 'minor_preference',
        consequenceLevel: 'negligible',
        strategy: 'proceed_with_assumption',
        statedAssumption: `${fallbackAssumption} (Recovered from ${ERR_PARALYSIS_BY_UNCERTAINTY})`,
      };
    } else {
      // For high risk: NEVER guess or force destructive default!
      const questionOptions = candidates.length >= 2
        ? candidates.slice(0, 4)
        : ['Abort operation', 'List resources first', 'Specify exact name manually'];
      return {
        ambiguityType: 'irreversible_fork',
        consequenceLevel: 'critical',
        strategy: 'ask_focused_question',
        clarificationQuestion: {
          prompt: 'Cannot proceed with destructive action without verified target. Which exact resource do you want to target?',
          options: questionOptions.slice(0, 4),
          allowCustomInput: true,
        },
      };
    }
  }

  // ── Rule 3: Destructive Operations with Ambiguous Targets (Irreversible Fork) ──
  const isDestructive = isHighRisk;
  if (isDestructive) {
    // If exactly 1 candidate exists and is authoritative, target is known
    if (candidates.length === 1) {
      return {
        ambiguityType: 'minor_preference',
        consequenceLevel: 'negligible',
        strategy: 'proceed_with_assumption',
        statedAssumption: `Target identified as ${candidates[0]}. Confirmation required before dispatch.`,
      };
    }

    // Multiple candidates or no candidate specified for destructive action
    const options = candidates.length >= 2
      ? candidates.slice(0, 4)
      : ['production_db', 'staging_db', 'development_db'];

    return {
      ambiguityType: 'irreversible_fork',
      consequenceLevel: 'critical',
      strategy: 'ask_focused_question',
      clarificationQuestion: {
        prompt: 'Which database or resource do you want to delete?',
        options: options.slice(0, 4),
        allowCustomInput: true,
      },
    };
  }

  // ── Rule 4: Critical Intent Operations with Ambiguous Recipient / Target ──
  const isSendOrMoveOrCancel = /(?:send\s+the\s+report|send\s+message|move\s+meeting|cancel\s+alarm|use\s+the\s+other\s+account)\b/i.test(prompt);
  if (isSendOrMoveOrCancel && candidates.length > 1) {
    return {
      ambiguityType: 'critical_intent',
      consequenceLevel: 'moderate',
      strategy: 'ask_focused_question',
      clarificationQuestion: {
        prompt: `Which intended target should this apply to?`,
        options: candidates.slice(0, 4),
        allowCustomInput: true,
      },
    };
  }

  // ── Rule 5: Summarize Project with Active Workspace Context ──
  const isSummarizeProject = /summarize\s+(?:the\s+)?project/i.test(prompt);
  if (isSummarizeProject && context.activeWorkspaceProject) {
    return {
      ambiguityType: 'minor_preference',
      consequenceLevel: 'negligible',
      strategy: 'proceed_with_assumption',
      statedAssumption: `Summarizing active workspace project: ${context.activeWorkspaceProject}`,
    };
  }

  // ── Rule 6: Minor Formatting & Stylistic Preferences ──
  const isFormatting = /(?:clean(?:er)?|format|style|tidy\s+up|prettify)\b/i.test(prompt);
  if (isFormatting) {
    return {
      ambiguityType: 'minor_preference',
      consequenceLevel: 'negligible',
      strategy: 'proceed_with_assumption',
      statedAssumption: 'Applying standard, clean formatting guidelines.',
    };
  }

  // ── Rule 7: Single Candidate or Clear Intent ──
  if (candidates.length === 1) {
    return {
      ambiguityType: 'minor_preference',
      consequenceLevel: 'negligible',
      strategy: 'proceed_with_assumption',
      statedAssumption: `Proceeding with sole matching candidate: ${candidates[0]}`,
    };
  }

  // ── Rule 8: Harmless General Ambiguity Default ──
  return {
    ambiguityType: 'minor_preference',
    consequenceLevel: 'negligible',
    strategy: 'proceed_with_assumption',
    statedAssumption: 'Proceeding with standard execution scope.',
  };
}

/**
 * Task resumption data contract when a clarification answer is received.
 */
export interface PendingAmbiguityTask {
  taskId: string;
  conversationId: string;
  originalPrompt: string;
  clarificationQuestion: ClarificationQuestion;
  targetCapability?: string;
  operation?: string;
  parameters?: Record<string, unknown>;
  createdAtMs: number;
  resolved: boolean;
}

export interface ClarificationAnswer {
  taskId: string;
  conversationId: string;
  selectedOptionId?: string;
  selectedOptionLabel?: string;
  customText?: string;
}

export interface ResumedTaskResult {
  success: boolean;
  resolvedTarget: string;
  updatedParameters: Record<string, unknown>;
  requiresPhase14Confirmation: boolean;
  error?: string;
}

/**
 * Maps a clarification answer to a pending task and resumes execution.
 * Enforces that clarification does NOT grant authorization for consequential actions.
 */
export function resumeTaskWithClarification(
  pendingTask: PendingAmbiguityTask,
  answer: ClarificationAnswer
): ResumedTaskResult {
  // Validate conversation and task binding
  if (pendingTask.taskId !== answer.taskId) {
    return {
      success: false,
      resolvedTarget: '',
      updatedParameters: {},
      requiresPhase14Confirmation: false,
      error: 'Task ID mismatch in clarification answer.',
    };
  }

  if (pendingTask.conversationId !== answer.conversationId) {
    return {
      success: false,
      resolvedTarget: '',
      updatedParameters: {},
      requiresPhase14Confirmation: false,
      error: 'Conversation ID mismatch in clarification answer.',
    };
  }

  if (pendingTask.resolved) {
    return {
      success: false,
      resolvedTarget: '',
      updatedParameters: {},
      requiresPhase14Confirmation: false,
      error: 'Clarification for this task is already resolved.',
    };
  }

  // Extract resolved target (custom text takes precedence if entered, else option)
  const resolvedTarget = (answer.customText && answer.customText.trim()) ||
    (answer.selectedOptionLabel && answer.selectedOptionLabel.trim()) ||
    (answer.selectedOptionId && answer.selectedOptionId.trim()) ||
    '';

  if (!resolvedTarget) {
    return {
      success: false,
      resolvedTarget: '',
      updatedParameters: {},
      requiresPhase14Confirmation: false,
      error: 'Clarification answer did not provide an option or custom text.',
    };
  }

  // Update parameters with the resolved target
  const updatedParameters = {
    ...(pendingTask.parameters || {}),
    target: resolvedTarget,
    database: resolvedTarget,
    recipient: resolvedTarget,
  };

  // Evaluate if Phase 14 confirmation grant is still required
  const capId = pendingTask.targetCapability || 'system';
  const op = pendingTask.operation || 'execute';
  const riskAssessment: RiskAssessment = DeviceSafetyPolicy.assessRisk(capId, op, updatedParameters);

  return {
    success: true,
    resolvedTarget,
    updatedParameters,
    requiresPhase14Confirmation: riskAssessment.requiresPrompt || riskAssessment.risk === 'high',
  };
}
