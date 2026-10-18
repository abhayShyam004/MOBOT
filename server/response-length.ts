/**
 * MOBOT Global Response Length Invariant
 *
 * Every bot in MOBOT must keep its normal user-facing response UNDER 100 WORDS
 * (target: 0–99 words). On mobile devices, long walls of text clutter the screen.
 *
 * Exceptions:
 * 1. The user explicitly asks for a longer/detailed answer ("explain in detail",
 *    "be comprehensive", "give me everything", etc.).
 * 2. The task genuinely requires more content (documents, code, reports, tables, transcripts).
 * 3. Structured UI components (cards, chips, attachments) do NOT count toward conversational words.
 */

export const DEFAULT_MAX_CONVERSATIONAL_WORDS = 99;

const EXPLICIT_DETAIL_REGEX =
  /\b(?:explain in detail|in-depth|in depth|full explanation|comprehensive|detailed|deep dive|elaborate|thoroughly|don't keep it short|dont keep it short|give me everything|all details|step by step|complete guide|write a (?:report|doc|document|code|script|essay|story|article|poem|summary report|table)|generate code|write code|show code|show me the code|full code|table of|markdown table|transcript)\b/i;

const CONTENT_EXCEPTION_REGEX =
  /(?:```[a-z0-9_-]*[\s\S]+?```|\|[^\n]+\|\r?\n\|[\s-:]+\|[\s-:]+\|)/i;

const sentenceSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "sentence" })
    : null;

/**
 * Splits text into natural sentence segments without breaking on decimals or abbreviations.
 */
export function splitIntoSentences(text: string): string[] {
  if (sentenceSegmenter) {
    return [...sentenceSegmenter.segment(text)].map((s) => s.segment);
  }
  const pattern = /([^\n.!?]+[.!?]+(?:['"”’)]+)?(?:\s+|\n+|$)|[^\n.!?]+(?:\n+|$))/g;
  return text.match(pattern) ?? [text];
}

/**
 * Counts conversational words in a string, ignoring structured blocks.
 */
export function countWords(text: string): number {
  if (!text || typeof text !== "string") return 0;
  const stripped = text
    .replace(/```(?:structured|json:structured)[\s\S]*?```/g, "")
    .trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).filter(Boolean).length;
}

/**
 * Checks whether an explicit exception applies to bypass the 100-word limit.
 */
export function isLengthException(text: string, userPrompt?: string): boolean {
  if (userPrompt && EXPLICIT_DETAIL_REGEX.test(userPrompt)) {
    return true;
  }
  if (CONTENT_EXCEPTION_REGEX.test(text)) {
    return true;
  }
  return false;
}

/**
 * Condenses conversational text gracefully to the nearest sentence boundary
 * that keeps the total word count strictly under 100 words (maxWords, default 99).
 * Avoids destructive mid-sentence or mid-word slicing.
 */
export function condenseToSentenceBoundary(
  text: string,
  maxWords: number = DEFAULT_MAX_CONVERSATIONAL_WORDS,
): string {
  if (!text || typeof text !== "string") return "";
  const cleaned = text.trim();
  if (countWords(cleaned) <= maxWords) return cleaned;

  const rawSegments = splitIntoSentences(cleaned);
  const accepted: string[] = [];
  let accumulatedWords = 0;

  for (const segment of rawSegments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const segWords = countWords(trimmed);
    if (accumulatedWords + segWords <= maxWords) {
      accepted.push(segment);
      accumulatedWords += segWords;
    } else {
      break;
    }
  }

  if (accepted.length > 0) {
    let result = accepted.join("").trim();
    if (!/[.!?]$/.test(result)) {
      result += ".";
    }
    return result;
  }

  // Fallback for a single run-on sentence exceeding maxWords:
  // Break cleanly at the last clause boundary before the limit.
  const words = cleaned.split(/\s+/).filter(Boolean);
  const targetWords = words.slice(0, Math.max(1, maxWords - 4)).join(" ");
  const lastClauseIdx = Math.max(
    targetWords.lastIndexOf(","),
    targetWords.lastIndexOf(";"),
    targetWords.lastIndexOf(":"),
    targetWords.lastIndexOf(" - "),
    targetWords.lastIndexOf(" -- "),
    targetWords.lastIndexOf("—"),
  );

  if (lastClauseIdx > 20) {
    return targetWords.slice(0, lastClauseIdx).trim() + "...";
  }

  return targetWords.trim() + "...";
}

/**
 * Enforces the global response length invariant on conversational text.
 */
export function enforceResponseLength(
  text: string,
  options?: { userPrompt?: string; maxWords?: number },
): string {
  if (!text || typeof text !== "string") return text;
  const maxWords = options?.maxWords ?? DEFAULT_MAX_CONVERSATIONAL_WORDS;
  if (countWords(text) <= maxWords) {
    return text;
  }
  if (isLengthException(text, options?.userPrompt)) {
    return text;
  }
  return condenseToSentenceBoundary(text, maxWords);
}
