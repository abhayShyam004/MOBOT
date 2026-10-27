// Unified Canonical Response Pipeline (Phases 15, 16, 17, and 18)
//
// Guarantees the fundamental invariant:
// The user must not receive one answer while the stored conversation
// silently records a materially different answer.
//
// Response transformations that affect user-visible meaning or content
// are resolved deterministically before content is irreversibly delivered
// to the client via SSE or written to persistent storage.

import { redactSecretsInText } from "./redact.ts";
import { stripRawBase64DataUris, determineResponseFormattingPlan, type ResponseFormattingPlan } from "./screen-frame-gate.ts";
import { verifyAndEnforceTurnTruthfulness } from "./capabilities/action-truthfulness.ts";
import {
  classifyRecommendationRequest,
  detectExcessiveHedging,
  recoverFromExcessiveHedging,
} from "./recommendation.ts";
import {
  detectUnnaturalVerbosity,
  recoverFromUnnaturalVerbosity,
  isGreeting,
  isAcknowledgement,
} from "./conversational-cadence.ts";
import { enforceResponseLength } from "./response-length.ts";
import { extractStructuredContent } from "./structured-extract.ts";
import type { StructuredResponseData } from "../shared/structured-response.ts";

export interface CanonicalizeOptions {
  userPrompt?: string | null;
  threadId?: string;
  turnId?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
}

export interface CanonicalResponseResult {
  text: string;
  structured?: StructuredResponseData;
  modalityPlan: ResponseFormattingPlan;
  recoveredVerbosity: boolean;
  recoveredHedging: boolean;
  correctedTruthfulness: boolean;
  strippedBase64: boolean;
}

export function stripEmojis(text: string): string {
  if (!text) return text;
  return text
    .replace(/\p{Regional_Indicator}{2}/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/(?:\u200D|\uFE0E|\uFE0F)/g, "")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

export function cleanUserFacingText(text: string): string {
  if (!text) return text;
  let cleaned = text;
  cleaned = cleaned.replace(/\[(?:image|file)\s+attached\]/gi, "");
  cleaned = cleaned.replace(/\[image:\s*[^\]]+\]/gi, "");
  cleaned = cleaned.replace(/\[(?:download\s+the\s+[^\]]+|download\s+[^\]]+)\]\((?:attachment:[^)]+|\/api\/attachments\/[^)]+)\)/gi, "");
  cleaned = cleaned.replace(/!\[[^\]]*\]\(attachment:[a-f0-9-]+\.[a-z0-9]+\)/gi, "");
  cleaned = cleaned.replace(/\s*\*\([^)]*peeking at the filename[^)]*\)\*\s*/gi, "\n");
  cleaned = stripEmojis(cleaned);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

/**
 * Determines whether raw token-level streaming deltas must be buffered for this turn
 * until the canonical response is ready.
 *
 * Trade-off documentation:
 * 1. For turns subject to holistic text transformations (greetings, acknowledgements,
 *    and explicit architecture / technology recommendations), streaming un-recovered
 *    chunks creates a jarring visual defect where bloated or hedged text streams onto
 *    the user's screen and is then abruptly replaced with a different answer at completion.
 *    Buffering deltas until `item.completed` guarantees complete event-stream and
 *    storage parity.
 * 2. For general work, coding tasks, explanations, reports, and routine execution,
 *    streaming deltas are emitted in real time after token-level secret and base64 filtering.
 */
export function shouldBufferStreamingDeltas(userPrompt?: string | null): boolean {
  if (!userPrompt || typeof userPrompt !== "string") return false;
  const trimmed = userPrompt.trim();
  if (isGreeting(trimmed) || isAcknowledgement(trimmed)) return true;
  const reqClass = classifyRecommendationRequest(trimmed);
  if (reqClass === "explicit_advice" || reqClass === "architecture_decision") {
    return true;
  }
  return false;
}

/**
 * Sanitizes incremental streaming deltas to ensure raw base64 binary pollution,
 * credentials, or emojis never reach the live UI bubble even during real-time streaming.
 */
export function sanitizeStreamingDelta(delta: string): string {
  if (!delta || typeof delta !== "string") return "";
  // Suppress data URIs in progress
  let sanitized = delta.replace(/data:image\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]+/gi, "");
  sanitized = stripRawBase64DataUris(sanitized);
  sanitized = redactSecretsInText(sanitized);
  sanitized = stripEmojis(sanitized);
  return sanitized;
}

/**
 * Authoritative canonicalization boundary.
 * Produces the single authoritative assistant response that is both streamed to the client
 * and committed to durable message storage.
 */
export function canonicalizeAssistantResponse(
  rawText: string,
  options: CanonicalizeOptions = {},
): CanonicalResponseResult {
  const userPrompt = options.userPrompt ? options.userPrompt.trim() : undefined;
  const threadId = options.threadId ?? "";
  const turnId = options.turnId ?? undefined;

  let text = cleanUserFacingText(rawText);
  let strippedBase64 = false;
  const beforeBase64Strip = text;
  text = stripRawBase64DataUris(text);
  if (text !== beforeBase64Strip) {
    strippedBase64 = true;
  }

  text = redactSecretsInText(text);

  // Extract structured content if present
  const { cleanText, structured } = extractStructuredContent(text, { threadId });
  text = cleanText;

  // Truthfulness check against tool receipts
  let correctedTruthfulness = false;
  if (threadId) {
    const truthfulness = verifyAndEnforceTurnTruthfulness({
      threadId,
      turnId,
      assistantText: text,
      userText: userPrompt,
    });
    if (truthfulness.corrected) {
      correctedTruthfulness = true;
      text = truthfulness.text;
    }
  }

  // Recommendation & hedging evaluation
  let recoveredHedging = false;
  if (userPrompt) {
    const reqClass = classifyRecommendationRequest(userPrompt);
    if (reqClass === "explicit_advice" || reqClass === "architecture_decision") {
      const hedging = detectExcessiveHedging(text, { userPrompt, isAdviceRequest: true });
      if (hedging.hasExcessiveHedging) {
        text = recoverFromExcessiveHedging(text, { userPrompt });
        recoveredHedging = true;
      }
    }
  }

  // Conversational cadence & verbosity evaluation
  let recoveredVerbosity = false;
  if (userPrompt) {
    const verbosity = detectUnnaturalVerbosity(text, { userPrompt });
    if (verbosity.hasUnnaturalVerbosity) {
      text = recoverFromUnnaturalVerbosity(text, { userPrompt });
      recoveredVerbosity = true;
    }
  }

  // Response length bounding
  text = enforceResponseLength(text, { userPrompt });
  text = stripEmojis(text);

  // Formatting plan
  const modalityPlan = determineResponseFormattingPlan({
    userPrompt,
    taskTitle: options.taskTitle,
    taskDescription: options.taskDescription,
  });

  return {
    text,
    structured,
    modalityPlan,
    recoveredVerbosity,
    recoveredHedging,
    correctedTruthfulness,
    strippedBase64,
  };
}
