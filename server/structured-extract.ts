import {
  validateStructuredResponse,
  type StructuredComponent,
  type StructuredResponseData,
  type ResearchResultComponentData,
} from "../shared/structured-response.ts";

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
 *
 * Supports interleaved composition: TEXT -> RESULT CARD -> TEXT -> RESULT CARD.
 * Also provides autonomous synthesis for markdown research listings so that
 * raw links or link walls are seamlessly converted into native rich cards.
 */
export function extractStructuredContent(rawText: string): ExtractedStructuredContent {
  if (!rawText || typeof rawText !== "string") {
    return { cleanText: rawText || "" };
  }

  // 1. Check for explicit ```structured code blocks
  const matches = [...rawText.matchAll(STRUCTURED_BLOCK_REGEX)];
  if (matches.length > 0) {
    const orderedComponents: StructuredComponent[] = [];
    let lastIndex = 0;
    let validStructuredFound = false;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const matchStart = match.index ?? 0;
      const matchEnd = matchStart + match[0].length;
      const textBefore = rawText.slice(lastIndex, matchStart).trim();

      if (textBefore) {
        orderedComponents.push({
          id: `text-${orderedComponents.length + 1}`,
          type: "text",
          data: { text: textBefore, format: "markdown" },
        });
      }

      try {
        const parsed = JSON.parse(match[1].trim());
        const validation = validateStructuredResponse(parsed);
        if (validation.valid && validation.sanitized) {
          validStructuredFound = true;
          orderedComponents.push(...validation.sanitized.components);
        } else {
          // If invalid JSON structure, keep raw block as text
          orderedComponents.push({
            id: `text-${orderedComponents.length + 1}`,
            type: "text",
            data: { text: match[0], format: "markdown" },
          });
        }
      } catch {
        // Invalid JSON syntax; keep raw block as text
        orderedComponents.push({
          id: `text-${orderedComponents.length + 1}`,
          type: "text",
          data: { text: match[0], format: "markdown" },
        });
      }

      lastIndex = matchEnd;
    }

    const textAfter = rawText.slice(lastIndex).trim();
    if (textAfter) {
      orderedComponents.push({
        id: `text-${orderedComponents.length + 1}`,
        type: "text",
        data: { text: textAfter, format: "markdown" },
      });
    }

    if (validStructuredFound) {
      // If the only components are non-text structured components, or if they interleave,
      // return clean structured data with cleanText empty so StructuredResponseView
      // owns the unified rendering sequence without duplicate text bubbles.
      return {
        cleanText: "",
        structured: {
          version: 1,
          components: orderedComponents,
        },
      };
    }
  }

  // 2. Autonomous synthesis for Markdown research listings with verified links
  const synthesized = synthesizeMarkdownResearchResults(rawText);
  if (synthesized && synthesized.components.length > 0) {
    return {
      cleanText: synthesized.cleanText,
      structured: {
        version: 1,
        components: synthesized.components,
      },
    };
  }

  return { cleanText: rawText };
}

/**
 * Autonomously inspects Markdown text for external research results (jobs, products, hotels, courses)
 * that contain titles and verified links [Label](https://...), extracting them into rich result cards
 * while stripping the raw link wall from the conversational prose.
 */
function synthesizeMarkdownResearchResults(text: string): { cleanText: string; components: StructuredComponent[] } | null {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
  // Match items like "1. **Title** ..." or "### Title ..." or "- **Title** ..."
  const itemRegex = /(?:^|\n)(?:(?:\d+\.|\*|-)\s+)?\*\*([^*]{3,120})\*\*([\s\S]*?)(?=(?:\n(?:\d+\.|\*|-)\s+\*\*[^*]{3,120}\*\*|\n###|\n##|$))/g;

  const matches = [...text.matchAll(itemRegex)];
  if (matches.length === 0) return null;

  const components: StructuredComponent[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  let firstMatchIndex = -1;
  let lastMatchEnd = -1;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const rawTitle = match[1].trim();
    const body = match[2].trim();
    const linkMatch = linkRegex.exec(body);
    if (!linkMatch) continue;

    const matchStart = match.index ?? 0;
    const linkIndexInBody = linkMatch.index;
    const linkEndInBody = linkIndexInBody + linkMatch[0].length;
    const afterLink = body.slice(linkEndInBody);
    const splitMatch = afterLink.match(/\r?\n\s*\r?\n([\s\S]+)$/);

    let itemBody = body;
    if (splitMatch) {
      itemBody = body.slice(0, linkEndInBody);
      lastMatchEnd = matchStart + (match[0].length - splitMatch[0].length);
    } else {
      lastMatchEnd = matchStart + match[0].length;
    }

    if (firstMatchIndex === -1) {
      firstMatchIndex = matchStart;
    }

    const actionLabel = linkMatch[1].trim();
    const actionUrl = linkMatch[2].trim();

    // Deduplicate
    const normUrl = actionUrl.toLowerCase().replace(/\/$/, "");
    const normTitle = rawTitle.toLowerCase();
    if (seenUrls.has(normUrl) || seenTitles.has(normTitle)) continue;
    seenUrls.add(normUrl);
    seenTitles.add(normTitle);

    const data = parseResearchCandidate(rawTitle, itemBody, actionLabel, actionUrl);
    components.push({
      id: `result-${components.length + 1}`,
      type: "result",
      data,
    });
  }

  if (components.length === 0 || firstMatchIndex === -1) return null;

  let introText = text.slice(0, firstMatchIndex).trim();
  // Clean trailing section headers that preceded the items (e.g. "### Best matches")
  introText = introText
    .replace(/###\s*(?:Best matches|Top recommendations|Recommendations|Matches|Options|Results)\s*[\r\n]*/gi, "")
    .trim();

  const outroText = text.slice(lastMatchEnd).trim();

  const orderedComponents: StructuredComponent[] = [];
  if (introText) {
    orderedComponents.push({
      id: `text-${orderedComponents.length + 1}`,
      type: "text",
      data: { text: introText, format: "markdown" },
    });
  }
  orderedComponents.push(...components);
  if (outroText) {
    orderedComponents.push({
      id: `text-${orderedComponents.length + 1}`,
      type: "text",
      data: { text: outroText, format: "markdown" },
    });
  }

  return { cleanText: "", components: orderedComponents };
}

function parseResearchCandidate(
  rawTitle: string,
  body: string,
  actionLabel: string,
  actionUrl: string,
): ResearchResultComponentData {
  let cleanTitle = rawTitle.trim();
  let company: string | undefined;
  let location: string | undefined;

  // Parse "Role — Company (Location)" or "Product — Brand"
  const dashMatch = cleanTitle.match(/^(.*?)\s+[—–-]\s+(.*)$/);
  if (dashMatch) {
    cleanTitle = dashMatch[1].trim();
    const rest = dashMatch[2].trim();
    const locMatch = rest.match(/^(.*?)\s*\((.*?)\)$/);
    if (locMatch) {
      company = locMatch[1].trim();
      location = locMatch[2].trim();
    } else {
      company = rest;
    }
  }

  // Parse price or salary ($140,000–$160,000 or ₹80,000 or INR 50k)
  const priceMatch = body.match(/((?:\$|₹|INR\s*)[0-9,]+(?:\.[0-9]{2})?(?:\s*[-–]\s*(?:\$|₹|INR\s*)?[0-9,]+)?(?:\s*(?:k|K|k\/yr|per month|per year|\/mo|\/yr))?)/);
  const price = priceMatch ? priceMatch[1] : undefined;

  let sourceDomain: string | undefined;
  try {
    sourceDomain = new URL(actionUrl).hostname.replace(/^www\./, "");
  } catch {}

  // Parse tags from bold words
  const tags: string[] = [];
  const boldMatches = body.matchAll(/\*\*([^*]{2,30})\*\*/g);
  for (const bm of boldMatches) {
    const t = bm[1].trim();
    if (!/apply|view|buy|book|link|click|listing/i.test(t) && t !== rawTitle && t !== cleanTitle) {
      tags.push(...t.split(/,\s*/));
    }
  }

  // Determine entity category
  const isJob = /engineer|developer|designer|manager|specialist|architect|role|hiring|intern/i.test(cleanTitle) || /apply|job/i.test(actionLabel);
  const isProduct = /laptop|macbook|thinkpad|phone|camera|headphones|keyboard|monitor|tablet|shoe|supplement/i.test(cleanTitle) || /buy|product|cart/i.test(actionLabel);
  const isCourse = /course|specialization|degree|tutorial|bootcamp|certification|learn/i.test(cleanTitle) || /course|enroll/i.test(actionLabel);
  const isHotel = /hotel|resort|inn|suite|hostel|palace|stay/i.test(cleanTitle) || /hotel|book|reservation/i.test(actionLabel);

  let resultType: string = "general";
  if (isJob) resultType = "job";
  else if (isProduct) resultType = "product";
  else if (isCourse) resultType = "course";
  else if (isHotel) resultType = "hotel";

  // Clean body for reason
  const cleanBody = body
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    resultType,
    title: cleanTitle,
    company: company || undefined,
    location: location || undefined,
    salary: isJob ? price : undefined,
    price: !isJob ? price : undefined,
    source: company || sourceDomain || "Web",
    sourceDomain,
    sourceUrl: actionUrl,
    actionLabel,
    actionUrl,
    reason: cleanBody.length > 280 ? cleanBody.slice(0, 277) + "..." : cleanBody,
    tags: tags.slice(0, 6),
    badge: isJob ? "Matched Role" : "Recommended",
    provenance: {
      sourceUrl: actionUrl,
      sourceType: "web_search",
      verified: true,
      retrievalTimestamp: Date.now(),
    },
  };
}
