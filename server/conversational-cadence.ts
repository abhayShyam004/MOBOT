/**
 * Official Roadmap Phase 18: Natural Conversation
 *
 * Implements:
 * 1. ConversationalCadencePolicy formal data contract (mobot_54_phases_prompt.md:1096-1104)
 * 2. Conversational cadence policy determination: "casual" | "work" | "crisis"
 * 3. Behavioral invariants:
 *    - One-word greeting ("Hey", "Morning", "Hi") receives a 1-sentence warm reply, not a feature menu.
 *    - Gratitude ("Thanks, that worked!") receives a concise natural acknowledgement.
 *    - Retain conversational context across rapid back-and-forth dialogue.
 * 4. ERR_UNNATURAL_VERBOSITY classification & dynamic prompt guard recovery protocol:
 *    - Conversational greeting yielding >100 words of output triggers ERR_UNNATURAL_VERBOSITY.
 *    - Recovery: Dynamic prompt guard truncates canned pleasantries and unsolicited feature catalogues.
 * 5. Prohibited implementation enforcement:
 *    - Never output: "Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals?"
 */

import { countWords } from "./response-length.ts";

export interface ConversationalCadencePolicy {
  conversationalMode: "casual" | "work" | "crisis";
  allowSlangOrColloquialism: boolean;
  targetSentenceCount: number;
  suppressBulletPoints: boolean;
}

export const ERR_UNNATURAL_VERBOSITY = "ERR_UNNATURAL_VERBOSITY";

export class UnnaturalVerbosityError extends Error {
  readonly code = ERR_UNNATURAL_VERBOSITY;
  constructor(
    message = "ERR_UNNATURAL_VERBOSITY: Conversational greeting yielded unnatural verbosity (>100 words or canned capability catalogue)."
  ) {
    super(message);
    this.name = "UnnaturalVerbosityError";
  }
}

/**
 * Prohibited canned introductions mandated by Phase 18 Section 6:
 * Anti-Patterns & Prohibited Implementations.
 */
export const PROHIBITED_CANNED_GREETING_REGEXES: readonly RegExp[] = [
  /Hello!\s+I\s+am\s+MOBOT,\s+your\s+AI\s+assistant\.\s+How\s+may\s+I\s+assist\s+you\s+today\s+with\s+your\s+coding,\s*research,\s*or\s+productivity\s+goals\?/i,
  /Hello!\s+I(?:'m|\s+am)\s+MOBOT,\s+your(?:\s+personal)?\s+AI\s+assistant\b/i,
  /How\s+may\s+I\s+assist\s+you\s+today\s+with\s+your\s+coding,\s*research,\s*or\s+productivity\s+goals\?/i,
  /I\s+am\s+MOBOT,\s+your\s+AI\s+assistant\.\s+How\s+can\s+I\s+assist\s+you/i,
];

/**
 * Checks whether a user prompt is a one-word or short conversational greeting.
 * Invariant: One-word greeting ("Hey", "Morning") receives a one-sentence warm reply, not a feature menu.
 */
export function isGreeting(prompt: string): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const clean = prompt
    .trim()
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, "");
  if (!clean) return false;

  // Single word or short greeting phrase
  return /^(?:hey(?:[ -]there)?|hi(?:[ -]there)?|hello(?:[ -]there)?|hiya|yo|howdy|sup|morning|good[ -]morning|afternoon|good[ -]afternoon|evening|good[ -]evening|greetings|salutations|what'?s[ -]up)(?:\s+(?:mobot|bot|there|friend|buddy|team))?$/i.test(
    clean
  );
}

/**
 * Checks whether a user prompt is a brief acknowledgement or expression of gratitude.
 * Invariant: "Thanks, that worked!" receives a brief, natural acknowledgement.
 */
export function isAcknowledgement(prompt: string): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const clean = prompt
    .trim()
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, "");
  if (!clean) return false;

  if (
    /^(?:thanks|thank\s+you|thx|ty|awesome\s+thanks|thanks(?:\s+a\s+lot)?|thanks[,!]?\s+that\s+worked|that\s+worked[,!]?\s+thanks|appreciate\s+it|much\s+appreciated|great[,!]?\s+thanks|perfect[,!]?\s+thank\s+you|cheers|got\s+it[,!]?\s+thanks|cool[,!]?\s+thanks|ok\s+thanks|okay\s+thanks)(?:\s+(?:mobot|bot))?$/i.test(
      clean
    )
  ) {
    return true;
  }

  // Also check "thanks, that worked!" or variants
  if (
    /^(?:thanks|thank\s+you)[,!]?\s+(?:that\s+(?:worked|helped|did\s+it|fixed\s+it)|all\s+good|you're\s+the\s+best)$/i.test(
      clean
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Checks whether a user prompt describes a high-urgency operational crisis.
 */
export function isCrisisPrompt(prompt: string): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const clean = prompt.trim().toLowerCase();
  return /\b(?:production\s+(?:is\s+)?down|site\s+(?:is\s+)?down|server\s+(?:crashed|is\s+down)|database\s+(?:crashed|corrupted)|data\s+loss|outage|fatal\s+crash|kernel\s+panic|emergency|p0\s+incident|sev-?1|security\s+breach|immediate\s+rollback|service\s+unavailable\s+503)\b/i.test(
    clean
  );
}

/**
 * Checks whether a user prompt is casual dialogue or social small-talk.
 */
export function isCasualPrompt(prompt: string): boolean {
  if (isGreeting(prompt) || isAcknowledgement(prompt)) return true;
  const clean = prompt
    .trim()
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, "");
  if (!clean) return false;

  return /^(?:how\s+are\s+you(?:\s+doing)?|how's\s+it\s+going|what's\s+up|who\s+are\s+you|tell\s+me\s+a\s+joke|nice\s+weather|good\s+to\s+see\s+you|how\s+was\s+your\s+day)$/i.test(
    clean
  );
}

/**
 * Determines the ConversationalCadencePolicy based on the user's message and context.
 */
export function determineConversationalCadencePolicy(
  userPrompt: string,
  _history?: Array<{ role: string; text?: string }>
): ConversationalCadencePolicy {
  if (isCrisisPrompt(userPrompt)) {
    return {
      conversationalMode: "crisis",
      allowSlangOrColloquialism: false,
      targetSentenceCount: 2,
      suppressBulletPoints: false,
    };
  }

  if (isCasualPrompt(userPrompt)) {
    return {
      conversationalMode: "casual",
      allowSlangOrColloquialism: true,
      targetSentenceCount: 1,
      suppressBulletPoints: true,
    };
  }

  return {
    conversationalMode: "work",
    allowSlangOrColloquialism: false,
    targetSentenceCount: 4,
    suppressBulletPoints: false,
  };
}

export interface UnnaturalVerbosityCheckResult {
  hasUnnaturalVerbosity: boolean;
  wordCount: number;
  isGreeting: boolean;
  isAcknowledgement: boolean;
  containsProhibitedGreeting: boolean;
  containsUnsolicitedCatalogue: boolean;
  reasons: string[];
}

/**
 * Detects unnatural verbosity according to Phase 18 invariants:
 * - Conversational greeting yielding >100 words of output triggers ERR_UNNATURAL_VERBOSITY.
 * - Prohibited canned introductions trigger ERR_UNNATURAL_VERBOSITY.
 * - Unsolicited feature catalogues / capability lists for simple greetings trigger ERR_UNNATURAL_VERBOSITY.
 */
export function detectUnnaturalVerbosity(
  botResponse: string,
  options: { userPrompt: string }
): UnnaturalVerbosityCheckResult {
  const text = (botResponse || "").trim();
  const prompt = (options.userPrompt || "").trim();
  const wordCount = countWords(text);
  const greeting = isGreeting(prompt);
  const ack = isAcknowledgement(prompt);

  const reasons: string[] = [];

  // 1. Prohibited canned greeting
  const containsProhibitedGreeting = PROHIBITED_CANNED_GREETING_REGEXES.some((rx) => rx.test(text));
  if (containsProhibitedGreeting) {
    reasons.push(
      `${ERR_UNNATURAL_VERBOSITY}: Response contains prohibited canned assistant introduction.`
    );
  }

  // 2. Greeting yielding >100 words
  if (greeting && wordCount > 100) {
    reasons.push(
      `${ERR_UNNATURAL_VERBOSITY}: Conversational greeting yielded >100 words of output (${wordCount} words).`
    );
  }

  // 3. Greeting yielding unsolicited feature catalogue / bullet points
  let containsUnsolicitedCatalogue = false;
  if (greeting) {
    const hasBulletPoints = /^\s*[-*+]\s+/m.test(text) || /^\s*\d+[.)]\s+/m.test(text);
    const hasCatalogueHeader =
      /\b(?:here\s+(?:is\s+what|are\s+the\s+things)\s+i\s+can\s+do|capabilities|features\s+include|i\s+can\s+help\s+you\s+with:\b)/i.test(
        text
      );
    if (hasBulletPoints || hasCatalogueHeader) {
      containsUnsolicitedCatalogue = true;
      reasons.push(
        `${ERR_UNNATURAL_VERBOSITY}: Conversational greeting received unsolicited capability catalogue or bullet points.`
      );
    }
  }

  // 4. Acknowledgement yielding excessive length (>100 words)
  if (ack && wordCount > 100) {
    reasons.push(
      `${ERR_UNNATURAL_VERBOSITY}: Acknowledgement yielded >100 words of output (${wordCount} words).`
    );
  }

  const hasUnnaturalVerbosity = reasons.length > 0;

  return {
    hasUnnaturalVerbosity,
    wordCount,
    isGreeting: greeting,
    isAcknowledgement: ack,
    containsProhibitedGreeting,
    containsUnsolicitedCatalogue,
    reasons,
  };
}

/**
 * Dynamic prompt guard recovery truncating canned pleasantries and unsolicited feature catalogues.
 */
export function recoverFromUnnaturalVerbosity(
  botResponse: string,
  options: { userPrompt: string }
): string {
  const prompt = (options.userPrompt || "").trim();
  const text = (botResponse || "").trim();

  // 1. User sent a simple greeting ("Hey", "Morning", "Hi")
  if (isGreeting(prompt)) {
    const cleanPrompt = prompt.toLowerCase();
    if (/morning/i.test(cleanPrompt)) {
      return "Good morning! What are you working on today?";
    }
    if (/evening/i.test(cleanPrompt)) {
      return "Good evening! How can I help you today?";
    }
    if (/afternoon/i.test(cleanPrompt)) {
      return "Good afternoon! What's on your mind?";
    }
    return "Hey! What are you working on today?";
  }

  // 2. User sent an acknowledgement ("Thanks, that worked!")
  if (isAcknowledgement(prompt)) {
    return "Glad to hear that. Let me know when you're ready for the next step.";
  }

  // 3. Prohibited canned greeting in mixed response: strip prohibited prefixes
  let cleaned = text;
  for (const rx of PROHIBITED_CANNED_GREETING_REGEXES) {
    cleaned = cleaned.replace(rx, "").trim();
  }

  if (!cleaned) {
    return "Ready when you are. What would you like to do?";
  }

  // 4. Bound conversational output length if >99 words
  if (countWords(cleaned) > 99) {
    const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (firstSentence && countWords(firstSentence) <= 30) {
      return firstSentence;
    }
    return cleaned.slice(0, 160).trim() + "...";
  }

  return cleaned;
}
