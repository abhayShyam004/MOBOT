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

import type { ResolvedBotIdentity } from "../shared/bot-identity.ts";

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
/** A canned *introduction* is by definition at the opening of a reply. The
 * patterns also appear verbatim in the system prompt that forbids them, so
 * testing the whole reply flagged a long answer for quoting the anti-pattern
 * and the verbosity recovery then cut it down to its first sentence. */
const CANNED_GREETING_OPENING = 200;

const opensWithProhibitedGreeting = (text: string): boolean => {
  const opening = text.trimStart().slice(0, CANNED_GREETING_OPENING);
  return PROHIBITED_CANNED_GREETING_REGEXES.some((rx) => rx.test(opening));
};

export const PROHIBITED_CANNED_GREETING_REGEXES: readonly RegExp[] = [
  /Hello!\s+I\s+am\s+MOBOT,\s+your\s+AI\s+assistant\.\s+How\s+may\s+I\s+assist\s+you\s+today\s+with\s+your\s+coding,\s*research,\s*or\s+productivity\s+goals\?/i,
  /Hello!\s+I(?:'m|\s+am)\s+MOBOT,\s+your(?:\s+personal)?\s+AI\s+assistant\b/i,
  /How\s+may\s+I\s+assist\s+you\s+today\s+with\s+your\s+coding,\s*research,\s*or\s+productivity\s+goals\?/i,
  /I\s+am\s+MOBOT,\s+your\s+AI\s+assistant\.\s+How\s+can\s+I\s+assist\s+you/i,
];

const GREETING_PHRASE =
  /^(?:hey(?:[ -]there)?|hi(?:[ -]there)?|hello(?:[ -]there)?|hiya|yo|howdy|sup|morning|good[ -]morning|afternoon|good[ -]afternoon|evening|good[ -]evening|greetings|salutations|what'?s[ -]up)/i;
const DEFAULT_GREETING_ADDRESSES = ["mobot", "bot", "there", "friend", "buddy", "team"];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cleanGreetingPrompt = (prompt: string): string =>
  prompt
    .trim()
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, "");

function greetingAddresses(addressTerms: readonly string[]): string[] {
  const addresses = [...DEFAULT_GREETING_ADDRESSES];
  for (const term of addressTerms) {
    if (typeof term !== "string") continue;
    const normalized = term.trim().toLowerCase().replace(/^[^\w]+|[^\w]+$/g, "");
    if (normalized && !addresses.includes(normalized)) addresses.push(normalized);
  }
  return addresses;
}

/**
 * Checks whether a user prompt is a one-word or short conversational greeting.
 * Invariant: One-word greeting ("Hey", "Morning") receives a one-sentence warm reply, not a feature menu.
 *
 * Only the built-in address terms and, when supplied, the active bot's own name
 * may follow the greeting phrase. Arbitrary trailing words are not accepted:
 * "hey can you explain…" is a request, not a greeting.
 */
export function isGreeting(prompt: string, addressTerms: readonly string[] = []): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const clean = cleanGreetingPrompt(prompt);
  if (!clean) return false;

  const addressPattern = greetingAddresses(addressTerms).map(escapeRegExp).join("|");
  return new RegExp(`^${GREETING_PHRASE.source}(?:\\s+(?:${addressPattern}))?$`, "i").test(clean);
}

/**
 * Returns the request that follows a leading greeting ("hey, explain X" →
 * "explain X"), or null when the prompt is only a greeting. Greeting is
 * conversational framing; it must not change how the request behind it is
 * classified.
 */
export function stripGreetingPrefix(prompt: string, addressTerms: readonly string[] = []): string | null {
  if (!prompt || typeof prompt !== "string") return null;
  const clean = cleanGreetingPrompt(prompt);
  if (!clean) return null;

  const addressPattern = greetingAddresses(addressTerms).map(escapeRegExp).join("|");
  const match = new RegExp(`^${GREETING_PHRASE.source}(?:\\s+(?:${addressPattern}))?[\\s,!.]*`, "i").exec(clean);
  if (!match) return null;
  const remainder = clean.slice(match[0].length).trim();
  return remainder || null;
}

/**
 * Output-format directives are instructions about how an answer is rendered,
 * not about what the answer must do in the world. They are a small, closed
 * linguistic category: an imperative answer verb plus a rendering target
 * ("reply with just the number", "respond in one sentence"). They are kept
 * separate from capability vocabulary so a word that happens to appear inside
 * the directive ("reply with the single word SEARCH") cannot select a tool.
 */
const OUTPUT_FORMAT_VERB =
  /^(?:please\s+|just\s+|now\s+)*(?:reply|respond|answer|output|return|print|write|say|format)\b/i;
const OUTPUT_FORMAT_TARGET =
  /\b(?:word|words|sentence|sentences|number|numbers|line|lines|paragraph|paragraphs|bullet|bullets|list|json|markdown|format|lowercase|uppercase|letter|letters|character|characters|token|tokens|phrase|phrases|exactly|only|plain\s+text)\b/i;
/** Objects that make a sentence a real task even when it also constrains the
 * rendering. "Reply with the number of files in the directory" still needs
 * the filesystem; "Reply with the single word SEARCH" does not. */
const OUTPUT_FORMAT_EXTERNAL_OBJECT =
  /\b(?:file|files|folder|folders|directory|directories|app|apps|application|applications|browser|website|url|weather|news|calendar|event|contacts?|location|screenshot|camera|clipboard|reminder|alarm|terminal|shell|command|script|program|repository|repo|git|database|server|phone|device)\b/i;

/** True when the whole message is only a rendering instruction. */
export function isOutputFormatInstruction(prompt: string): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const text = prompt.trim();
  if (!text) return false;
  if (!OUTPUT_FORMAT_VERB.test(text)) return false;
  if (!OUTPUT_FORMAT_TARGET.test(text)) return false;
  return !OUTPUT_FORMAT_EXTERNAL_OBJECT.test(text);
}

/**
 * Removes trailing rendering instructions from the text used for routing.
 * The original message still reaches the provider; this only stops a format
 * suffix from changing the task's modality. A message that is entirely a
 * formatting instruction is returned unchanged so callers can recognize it.
 */
export function stripTrailingOutputFormatConstraints(prompt: string): string {
  if (!prompt || typeof prompt !== "string") return prompt;
  const trimmed = prompt.trim();
  if (!trimmed) return prompt;

  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  while (sentences.length > 1 && isOutputFormatInstruction(sentences[sentences.length - 1]!)) {
    sentences.pop();
  }
  let result = sentences.join(' ').trim();

  // One sentence can still carry a coordinate format clause:
  // "Search for recent Android research and reply with three bullet points."
  const clause = /(?:,\s*|\s+and\s+|;\s*)(?:please\s+)?(?:reply|respond|answer|output|return|print|say|format)\b[\s\S]*$/i.exec(result);
  if (clause) {
    const directive = clause[0].replace(/^(?:,\s*|\s+and\s+|;\s*)/i, '').trim();
    if (isOutputFormatInstruction(directive)) {
      const head = result.slice(0, clause.index).trim();
      if (head.length >= 3) result = head;
    }
  }
  return result || prompt;
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
  containsGenericAssistantTrope?: boolean;
  containsMalformedRoleInterpolation?: boolean;
  reasons: string[];
}

/**
 * Detects unnatural verbosity according to Phase 18 invariants:
 * - Conversational greeting yielding >100 words of output triggers ERR_UNNATURAL_VERBOSITY.
 * - Prohibited canned introductions trigger ERR_UNNATURAL_VERBOSITY.
 * - Unsolicited feature catalogues / capability lists for simple greetings trigger ERR_UNNATURAL_VERBOSITY.
 * - Generic boilerplate assistant tropes on greeting for custom identity bots trigger recovery.
 */
export function detectUnnaturalVerbosity(
  botResponse: string,
  options: { userPrompt: string; botIdentity?: ResolvedBotIdentity | null }
): UnnaturalVerbosityCheckResult {
  const text = (botResponse || "").trim();
  const prompt = (options.userPrompt || "").trim();
  const wordCount = countWords(text);
  const greeting = isGreeting(prompt);
  const ack = isAcknowledgement(prompt);

  const reasons: string[] = [];

  // 1. Prohibited canned greeting
  const containsProhibitedGreeting = opensWithProhibitedGreeting(text);
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

  // 5. Generic boilerplate assistant tropes on greeting for custom identity bots
  let containsGenericAssistantTrope = false;
  if (greeting && options.botIdentity?.hasCustomIdentity) {
    if (
      /\b(?:what\s+are\s+we\s+tackling|what\s+would\s+you\s+like(?:\s+me)?\s+to\s+do|how\s+(?:can|may)\s+i\s+(?:help|assist)\s+you|what\s+can\s+i\s+do\s+for\s+you|what\s+are\s+we\s+working\s+on\s+today)\b/i.test(
        text
      )
    ) {
      containsGenericAssistantTrope = true;
      reasons.push(
        `${ERR_UNNATURAL_VERBOSITY}: Customized bot emitted generic assistant trope on greeting.`
      );
    }
  }

  // 6. Malformed role interpolation (e.g. "ready to dive into study budy", "dive into study buddy")
  let containsMalformedRoleInterpolation = false;
  if (/\b(?:(?:ready\s+to\s+)?dive\s+into\s+[\w\s]{2,30}|here,\s*ready\s+to\s+dive)\b/i.test(text)) {
    containsMalformedRoleInterpolation = true;
    reasons.push(
      `${ERR_UNNATURAL_VERBOSITY}: Response contains malformed role interpolation or template artifact.`
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
    containsGenericAssistantTrope,
    containsMalformedRoleInterpolation,
    reasons,
  };
}

/**
 * Dynamic prompt guard recovery truncating canned pleasantries and unsolicited feature catalogues.
 */
export function recoverFromUnnaturalVerbosity(
  botResponse: string,
  options: { userPrompt: string; botIdentity?: ResolvedBotIdentity | null }
): string {
  const prompt = (options.userPrompt || "").trim();
  const text = (botResponse || "").trim();

  // 1. User sent a simple greeting ("Hey", "Morning", "Hi", "yo")
  if (isGreeting(prompt)) {
    if (options.botIdentity && options.botIdentity.hasCustomIdentity) {
      return options.botIdentity.conversationalGreetingReply;
    }
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
  if (opensWithProhibitedGreeting(cleaned)) {
    for (const rx of PROHIBITED_CANNED_GREETING_REGEXES) {
      cleaned = cleaned.replace(rx, "").trim();
    }
  }

  // Strip malformed role interpolation artifacts (e.g. ", ready to dive into study budy")
  cleaned = cleaned.replace(/,\s*(?:ready\s+to\s+)?dive\s+into\s+[\w\s]{2,30}(?=[.!?]|\s+—|\s+what)/i, "").trim();
  cleaned = cleaned.replace(/\b(?:ready\s+to\s+)?dive\s+into\s+[\w\s]{2,30}\s*—\s*/i, "").trim();

  if (!cleaned) {
    if (options.botIdentity && options.botIdentity.hasCustomIdentity) {
      return options.botIdentity.conversationalGreetingReply;
    }
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
