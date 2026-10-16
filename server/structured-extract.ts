import { validateStructuredResponse, type StructuredResponseData } from "../shared/structured-response.ts";

export interface ExtractedStructuredContent {
  cleanText: string;
  structured?: StructuredResponseData;
}

const STRUCTURED_BLOCK_REGEX = /```(?:structured|json:structured)\s*[\r\n]+([\s\S]*?)[\r\n]+```/g;

/**
 * Extracts structured response data blocks (fenced as ```structured or ```json:structured)
 * from assistant reply text, validates against the Structured Response protocol,
 * strips the raw JSON code fence from the visible prose, and returns the clean text
 * and validated structured data.
 */
export function extractStructuredContent(rawText: string): ExtractedStructuredContent {
  if (!rawText || typeof rawText !== "string") {
    return { cleanText: rawText || "" };
  }

  let structured: StructuredResponseData | undefined;

  let cleanText = rawText.replace(STRUCTURED_BLOCK_REGEX, (_match, jsonContent) => {
    try {
      const parsed = JSON.parse(jsonContent.trim());
      const validation = validateStructuredResponse(parsed);
      if (validation.valid && validation.sanitized) {
        if (!structured) {
          structured = validation.sanitized;
        } else {
          structured = {
            ...structured,
            components: [...structured.components, ...validation.sanitized.components],
          };
        }
        return "";
      }
    } catch {
      // Invalid JSON syntax; leave unmodified so the user sees whatever was sent
    }
    return _match;
  });

  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return {
    cleanText,
    ...(structured ? { structured } : {}),
  };
}
