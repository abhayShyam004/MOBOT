/**
 * Safety and Consent Model for Device Actions (Phase Q).
 *
 * Implements risk tiers and approval logic aligned with MOBOT principles:
 * - SAFE OPERATIONS SHOULD FEEL EASY (low risk read-only, clipboard, search, preview)
 * - MEANINGFUL CONSEQUENCES SHOULD BE VISIBLE (destructive deletes, external changes)
 * - Do not interrupt harmless operations with unnecessary permission dialogs.
 */

import type { RiskTier } from './types.ts';
import type { ApprovalMode } from '../../shared/approval-mode.ts';

export interface RiskAssessment {
  risk: RiskTier;
  reason: string;
  requiresPrompt: boolean;
  consequential: boolean;
}

export class DeviceSafetyPolicy {
  /**
   * Determine the risk tier of a specific device capability operation.
   */
  static assessRisk(
    capabilityId: string,
    operation: string,
    params: Record<string, unknown> = {}
  ): RiskAssessment {
    // 1. High Risk Operations (destructive, external messages, deletions)
    if (capabilityId === 'device.files' && operation === 'delete') {
      return {
        risk: 'high',
        reason: `Deleting file '${params.path ?? 'target'}' is irreversible.`,
        requiresPrompt: true,
        consequential: true,
      };
    }

    // 2. Medium Risk Operations (creating/modifying state, calendar events, external sharing)
    if (capabilityId === 'device.files' && operation === 'write') {
      return {
        risk: 'medium',
        reason: `Writing to file '${params.path ?? 'target'}'.`,
        requiresPrompt: false, // auto in edits/auto mode
        consequential: false,
      };
    }

    if (capabilityId === 'device.calendar' && operation === 'create_event') {
      return {
        risk: 'medium',
        reason: `Scheduling new calendar event '${params.title ?? 'Event'}'.`,
        requiresPrompt: false,
        consequential: false,
      };
    }

    if (capabilityId === 'device.share') {
      return {
        risk: 'medium',
        reason: 'Opening system share dialog.',
        requiresPrompt: false,
        consequential: false,
      };
    }

    if (capabilityId === 'device.camera') {
      return {
        risk: 'medium',
        reason: 'Accessing device camera.',
        requiresPrompt: false,
        consequential: false,
      };
    }

    // 3. Low Risk Operations (reading metadata, viewing screenshots, clipboard, apps, notifications)
    // Low risk operations execute seamlessly without prompting.
    return {
      risk: 'low',
      reason: 'Harmless read or non-consequential inspection.',
      requiresPrompt: false,
      consequential: false,
    };
  }

  /**
   * Evaluate whether an operation requires an explicit user approval prompt
   * given the bot's current approval mode.
   */
  static shouldPrompt(
    risk: RiskTier,
    approvalMode: ApprovalMode = 'auto'
  ): boolean {
    if (approvalMode === 'full') {
      return false;
    }

    if (risk === 'high') {
      // High risk actions always require prompt in ask, edits, and auto modes
      return true;
    }

    if (risk === 'medium') {
      // In 'ask' mode, medium actions prompt. In 'auto' or 'edits', safe medium actions pass.
      return approvalMode === 'ask';
    }

    // Low risk operations never interrupt the user
    return false;
  }

  /**
   * Determine whether an action represents a consequential state mutation
   * that requires strict post-action verification.
   */
  static isConsequential(
    capabilityId: string,
    operation: string,
    params: Record<string, unknown> = {}
  ): boolean {
    return DeviceSafetyPolicy.assessRisk(capabilityId, operation, params).consequential;
  }
}

export function checkAgentExecutionPermission(
  toolOrCapability: string,
  permissions?: { terminal?: string; filesystem?: string; browser?: string; composio?: string } | null,
): { allowed: boolean; reason?: string } {
  if (!permissions) return { allowed: true };

  const terminalTools = new Set([
    "Bash", "run_command", "run_shell", "open_interactive",
    "terminal_start", "terminal_write", "terminal_read",
    "terminal_resize", "terminal_close", "terminal_list",
  ]);
  const filesystemTools = new Set([
    "ReadFile", "WriteFile", "EditFile",
    "workspace_list", "workspace_read", "workspace_write",
    "workspace_append", "workspace_mkdir", "workspace_move",
    "workspace_copy", "workspace_delete", "workspace_stat",
    "workspace_exists", "device.files",
  ]);
  const browserTools = new Set([
    "http_fetch", "web_search", "resource_inspect",
    "resource_fetch", "resource_download", "resource_extract_pdf",
    "resource_extract_html", "resource_artifacts", "browser_open",
    "browser_click", "browser_screenshot", "browser_navigate",
  ]);

  if (terminalTools.has(toolOrCapability) || /^(bash|sh|terminal|shell|exec)/i.test(toolOrCapability)) {
    if (permissions.terminal === "denied") {
      return { allowed: false, reason: "Permission Denied: Terminal & Shell Execution is disabled in Settings -> Permissions." };
    }
  }
  if (filesystemTools.has(toolOrCapability) || /^(fs_|file_|workspace_)/i.test(toolOrCapability)) {
    if (permissions.filesystem === "denied") {
      return { allowed: false, reason: "Permission Denied: Filesystem Read & Write is disabled in Settings -> Permissions." };
    }
  }
  if (browserTools.has(toolOrCapability) || /^(browser_|web_|http_)/i.test(toolOrCapability)) {
    if (permissions.browser === "denied") {
      return { allowed: false, reason: "Permission Denied: Browser & Network is disabled in Settings -> Permissions." };
    }
  }
  if (/^composio/i.test(toolOrCapability) || toolOrCapability.startsWith("mcp__composio")) {
    if (permissions.composio === "denied") {
      return { allowed: false, reason: "Permission Denied: Connected Apps (Composio) is disabled in Settings -> Permissions." };
    }
  }
  return { allowed: true };
}

// ── Official Roadmap Phase 9: Self-Evaluation Data Contracts & Evaluator ────

export const ERR_EMPTY_OR_JUNK_PAYLOAD = "ERR_EMPTY_OR_JUNK_PAYLOAD";

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

export interface ActionEvaluationContext {
  actionId?: string;
  action?: string;
  capabilityId?: string;
  operation?: string;
  params?: Record<string, unknown>;
  technicalSuccess: boolean;
  rawOutput?: unknown;
  resultSummary?: string;
  error?: string;
  objective?: string;
  successCriteria?: string[];
  expectedFormat?: "json" | "text" | "file" | "list" | "any";
  isConsequential?: boolean;
  accumulatedObservations?: Array<{
    turn: number;
    action: string;
    resultSummary: string;
    success: boolean;
  }>;
}

export function isConsequentialAction(
  capabilityId?: string,
  operation?: string,
  params: Record<string, unknown> = {}
): boolean {
  if (!capabilityId || !operation) return false;
  return DeviceSafetyPolicy.assessRisk(capabilityId, operation, params).consequential;
}

export function evaluateActionOutcome(context: ActionEvaluationContext): SelfEvaluationResult {
  const actionId = context.actionId || "eval_action";

  // 1. Technical failure at the execution boundary
  if (!context.technicalSuccess) {
    const err = context.error || context.resultSummary || "Action failed technically at the execution layer.";
    let rec: SelfEvaluationResult["recommendedAction"] = "retry_with_variation";
    if (/permission|denied|auth|unauthorized|forbidden/i.test(err)) {
      rec = "abort";
    } else if (/not found|unsupported|unknown capability|unregistered/i.test(err)) {
      rec = "switch_strategy";
    }
    return {
      actionId,
      technicalSuccess: false,
      semanticSuccess: false,
      usefulnessScore: 0,
      criticism: err,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: rec,
    };
  }

  // 2. Detect ERR_EMPTY_OR_JUNK_PAYLOAD: Tool succeeded technically, but returned empty, generic, or error-disguised content
  // A. Both rawOutput and resultSummary are empty / null / undefined / whitespace-only
  const hasRawOutput =
    context.rawOutput !== null &&
    context.rawOutput !== undefined &&
    !(typeof context.rawOutput === "string" && context.rawOutput.trim() === "");
  const hasResultSummary =
    typeof context.resultSummary === "string" && context.resultSummary.trim().length > 0;

  if (!hasRawOutput && !hasResultSummary) {
    return {
      actionId,
      technicalSuccess: true,
      semanticSuccess: false,
      usefulnessScore: 0,
      criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Output payload is empty or whitespace-only.`,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: "retry_with_variation",
    };
  }

  // B. Empty (0-byte) file or artifact generated
  if (typeof context.rawOutput === "object" && context.rawOutput !== null) {
    const obj = context.rawOutput as Record<string, unknown>;
    const isFileOp =
      context.capabilityId === "device.files" ||
      /write|create|file|download|pdf|doc|save|export/i.test(context.action || "") ||
      context.expectedFormat === "file" ||
      "path" in obj ||
      "file" in obj ||
      "filename" in obj;
    if (isFileOp) {
      if (
        obj.size === 0 ||
        obj.bytes === 0 ||
        obj.bytesWritten === 0 ||
        obj.length === 0 ||
        ("content" in obj && obj.content === "")
      ) {
        return {
          actionId,
          technicalSuccess: true,
          semanticSuccess: false,
          usefulnessScore: 0,
          criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Tool generated an empty (0-byte) file or artifact.`,
          evidenceFound: [],
          objectiveCompleted: false,
          recommendedAction: "retry_with_variation",
        };
      }
    }
  }

  // C. Search or listing queries returning zero results or empty arrays
  const allowsEmpty = Boolean(
    context.params?.allowEmpty === true ||
    (context.objective && /\b(?:verify|check|assert|confirm|ensure)\s+(?:no|zero|empty|none|clean|clear|absence)\b/i.test(context.objective)) ||
    (context.action && /\b(?:verify|check|assert|confirm|ensure)\s+(?:no|zero|empty|none|clean|clear|absence)\b/i.test(context.action))
  );

  if (Array.isArray(context.rawOutput) && context.rawOutput.length === 0) {
    if (allowsEmpty) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: true,
        usefulnessScore: 10,
        criticism: "Verified empty result as expected by objective.",
        evidenceFound: ["Confirmed 0 items / empty result set as requested"],
        objectiveCompleted: true,
        recommendedAction: "finalize",
      };
    }
    return {
      actionId,
      technicalSuccess: true,
      semanticSuccess: false,
      usefulnessScore: 1,
      criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Search or query returned zero items/empty list.`,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: "retry_with_variation",
    };
  }

  if (typeof context.rawOutput === "object" && context.rawOutput !== null) {
    const obj = context.rawOutput as Record<string, unknown>;
    const emptyArrayField = ["results", "items", "files", "matches", "data"].find(
      (key) => Array.isArray(obj[key]) && (obj[key] as unknown[]).length === 0
    );
    if (emptyArrayField && Object.keys(obj).length <= 2) {
      if (allowsEmpty) {
        return {
          actionId,
          technicalSuccess: true,
          semanticSuccess: true,
          usefulnessScore: 10,
          criticism: `Verified empty result array for ${emptyArrayField} as expected by objective.`,
          evidenceFound: [`Confirmed empty ${emptyArrayField}: [] as requested`],
          objectiveCompleted: true,
          recommendedAction: "finalize",
        };
      }
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 1,
        criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Query produced an empty results array (${emptyArrayField}: []).`,
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "retry_with_variation",
      };
    }
  }

  const textPayload =
    typeof context.rawOutput === "string"
      ? context.rawOutput
      : context.resultSummary || "";

  // Trap explicit error messages masquerading as non-empty text success
  const explicitErrorPattern = /^(?:error|fatal|exception|failure|command failed|fatal error):\s+/i;
  const isExplicitError =
    (typeof context.rawOutput === "string" && explicitErrorPattern.test(context.rawOutput.trim())) ||
    (typeof context.resultSummary === "string" && explicitErrorPattern.test(context.resultSummary.trim()));

  if (isExplicitError) {
    const errorMsg =
      typeof context.rawOutput === "string" && explicitErrorPattern.test(context.rawOutput.trim())
        ? context.rawOutput.trim().slice(0, 200)
        : (context.resultSummary || "Explicit error output").slice(0, 200);
    return {
      actionId,
      technicalSuccess: true,
      semanticSuccess: false,
      usefulnessScore: 0,
      criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Tool returned error text despite technical success: ${errorMsg}`,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: "switch_strategy",
    };
  }

  const noResultsRegex =
    /(?:^|\b)(?:no|0|zero)\s+(?:results?|matches?|items?|files?|records?)\s*(?:found|returned)?\b/i;
  if (
    noResultsRegex.test(textPayload) ||
    /\bnothing\s+found\b/i.test(textPayload) ||
    /^not\s+found$/i.test(textPayload.trim())
  ) {
    if (allowsEmpty) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: true,
        usefulnessScore: 10,
        criticism: "Verified no-results confirmation as expected by absence/clean objective.",
        evidenceFound: ["Confirmed zero results matching condition"],
        objectiveCompleted: true,
        recommendedAction: "finalize",
      };
    }
    return {
      actionId,
      technicalSuccess: true,
      semanticSuccess: false,
      usefulnessScore: 1,
      criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Search tool reported no results found.`,
      evidenceFound: [],
      objectiveCompleted: false,
      recommendedAction: "retry_with_variation",
    };
  }

  // D. Disguised error payloads returned under technical success (HTTP 200)
  if (typeof context.rawOutput === "object" && context.rawOutput !== null) {
    const obj = context.rawOutput as Record<string, unknown>;
    if (
      ("error" in obj && typeof obj.error === "string") ||
      ("error_code" in obj) ||
      ("status" in obj && (obj.status === "error" || obj.status === "failed")) ||
      ("success" in obj && obj.success === false)
    ) {
      const errMsg = String(obj.error || obj.message || obj.error_code || "Disguised error object");
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 0,
        criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Execution returned error payload disguised as successful response: ${errMsg}`,
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "switch_strategy",
      };
    }
  }

  // E. Uninformative placeholder tokens
  if (typeof context.rawOutput === "string") {
    const trimmed = context.rawOutput.trim();
    if (/^(?:todo|n\/a|undefined|null|\[object object\]|\{\})$/i.test(trimmed)) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 0,
        criticism: `${ERR_EMPTY_OR_JUNK_PAYLOAD}: Output contains only placeholder or uninformative content ('${trimmed}').`,
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "retry_with_variation",
      };
    }
  }

  // F. Corrupted / broken JSON when JSON output was requested
  const expectsJson =
    context.expectedFormat === "json" ||
    /\bjson\b/i.test(context.objective || "") ||
    /\bjson\b/i.test(context.action || "");

  if (expectsJson && typeof context.rawOutput === "string") {
    try {
      JSON.parse(context.rawOutput);
    } catch (jsonErr: any) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 2,
        criticism: `Corrupted payload: Invalid JSON structure generated (${jsonErr.message}).`,
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "retry_with_variation",
      };
    }
  }

  // G. Consequential / destructive actions: anti-pattern prohibits skipping self-evaluation
  const isConsequential = Boolean(
    context.isConsequential ||
    isConsequentialAction(context.capabilityId, context.operation, context.params)
  );

  if (isConsequential) {
    const rawObj =
      typeof context.rawOutput === "object" && context.rawOutput !== null
        ? (context.rawOutput as Record<string, unknown>)
        : undefined;

    // Reject bare assertion of success without concrete mutation attributes
    const bareSuccessClaim =
      rawObj !== undefined &&
      Object.keys(rawObj).length <= 2 &&
      ("success" in rawObj || "ok" in rawObj) &&
      !(
        "deleted" in rawObj ||
        "written" in rawObj ||
        "bytesWritten" in rawObj ||
        "path" in rawObj ||
        "id" in rawObj ||
        "timestamp" in rawObj ||
        "verified" in rawObj
      );

    const mutationEvidenced =
      !bareSuccessClaim &&
      Boolean(
        context.resultSummary &&
        !/failed|error|skipped|no change/i.test(context.resultSummary) &&
        (
          (rawObj &&
            Object.keys(rawObj).length > 0 &&
            ("deleted" in rawObj ||
              "path" in rawObj ||
              "id" in rawObj ||
              "bytesWritten" in rawObj ||
              "size" in rawObj ||
              "verified" in rawObj)) ||
          (typeof context.rawOutput === "string" &&
            context.rawOutput.length > 5 &&
            !/^(?:ok|success|done)$/i.test(context.rawOutput.trim())) ||
          /\b(?:successfully deleted|wrote \d+ bytes|created (?:event|file|folder)|verified state change)\b/i.test(
            context.resultSummary
          )
        )
      );

    if (!mutationEvidenced) {
      return {
        actionId,
        technicalSuccess: true,
        semanticSuccess: false,
        usefulnessScore: 2,
        criticism:
          "Consequential operation did not produce verifiable state mutation confirmation; bare tool claim rejected.",
        evidenceFound: [],
        objectiveCompleted: false,
        recommendedAction: "switch_strategy",
      };
    }
  }

  // 3. Valid payload: extract evidence and evaluate progress against success criteria
  const evidenceFound: string[] = [];

  if (typeof context.rawOutput === "string") {
    if (context.rawOutput.trim().length > 0) {
      evidenceFound.push(`Text output (${context.rawOutput.trim().length} chars)`);
    }
  } else if (Array.isArray(context.rawOutput)) {
    evidenceFound.push(`Array with ${context.rawOutput.length} items`);
    for (const item of context.rawOutput.slice(0, 3)) {
      if (typeof item === "string") evidenceFound.push(item);
      else if (typeof item === "object" && item !== null) {
        const recordDesc = Object.entries(item)
          .slice(0, 2)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        if (recordDesc) evidenceFound.push(recordDesc);
      }
    }
  } else if (typeof context.rawOutput === "object" && context.rawOutput !== null) {
    const keys = Object.keys(context.rawOutput as object);
    if (keys.length > 0) {
      evidenceFound.push(`Object with fields: ${keys.join(", ")}`);
    }
  }

  if (context.resultSummary && context.resultSummary.length > 0) {
    evidenceFound.push(context.resultSummary.slice(0, 150));
  }

  const criteria = context.successCriteria || [];
  let satisfiedCriteriaCount = 0;

  if (criteria.length > 0) {
    const pastObservationsText = (context.accumulatedObservations || [])
      .map((o) => o.resultSummary)
      .join(" ");
    const combinedHaystack = `${pastObservationsText} ${textPayload} ${JSON.stringify(context.rawOutput || "")}`.toLowerCase();
    for (const crit of criteria) {
      const words = crit
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const matches = words.filter((w) => combinedHaystack.includes(w));
      if (words.length === 0 || matches.length >= Math.ceil(words.length * 0.5)) {
        satisfiedCriteriaCount++;
        evidenceFound.push(`Criterion verified: ${crit}`);
      }
    }
  }

  const allCriteriaSatisfied = criteria.length === 0 ? true : satisfiedCriteriaCount === criteria.length;
  const objectiveCompleted = allCriteriaSatisfied;

  let usefulnessScore: number;
  if (objectiveCompleted) {
    usefulnessScore = criteria.length > 0 ? 10 : 8;
  } else {
    usefulnessScore = Math.min(7, Math.max(3, Math.round((satisfiedCriteriaCount / criteria.length) * 10)));
  }

  const criticism = objectiveCompleted
    ? criteria.length > 0
      ? `All ${criteria.length} success criteria verified.`
      : "Action produced valid substantive output fulfilling the objective."
    : `Partial progress: ${satisfiedCriteriaCount}/${criteria.length} success criteria satisfied.`;

  return {
    actionId,
    technicalSuccess: true,
    semanticSuccess: true,
    usefulnessScore,
    criticism,
    evidenceFound,
    objectiveCompleted,
    recommendedAction: objectiveCompleted ? "finalize" : "retry_with_variation",
  };
}
