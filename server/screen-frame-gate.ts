// Which turns earn a settled screenshot in the transcript.
//
// The screen poller folds a turn's last frame into the chat on turn end.
// Two questions decide whether that frame is worth the reader's attention,
// and both are answered here, pure, so they can be pinned down in tests:
//   1. did the tool that just completed act on (or look at) the screen — a
//      shell command over computer_exec or a status read does not count,
//      however the driver happens to spell the tool's name;
//   2. is the end frame different from the one the transcript already
//      shows — a boxAgent turn starts as screen work by definition, so this
//      is what keeps its shell-only replies from re-picturing the same idle
//      desktop.
import { createHash } from "node:crypto";
import zlib from "node:zlib";

// Tool-name classification lives in shared/tool-surface.ts so the renderer
// reads a tool the same way the poller does.
import { screenSurfaceForTool, screenTouchingTool } from "../shared/tool-surface.ts";
export { screenSurfaceForTool, screenTouchingTool };

/** sha256 over the base64 frame — the same fingerprint the model-side
 * observation dedupe uses (server/computer-observation.ts). */
export function screenFrameHash(png: string): string {
  return createHash("sha256").update(png).digest("hex");
}

/** A settled frame is news only when it differs from the frame the reader
 * can already see. With nothing to compare against it fails open, like the
 * observation dedupe does: an unshown screen beats a wrongly hidden one. */
export function settledFrameIsNews(shownFrameHash: string | undefined, png: string): boolean {
  return shownFrameHash === undefined || screenFrameHash(png) !== shownFrameHash;
}

/**
 * Browser visual telemetry is decoupled from chat output.
 * Live browser frames stream to Watch Computer and internal tools, but
 * are only surfaced as chat attachments/messages when explicitly requested:
 *  1. User explicitly asks:
 *     - "show me the page"
 *     - "send me a screenshot"
 *     - "what does the page look like?"
 *  2. The task explicitly requests a screenshot/image artifact.
 *  3. Visual appearance / layout is necessary to communicate the result.
 *  4. User explicitly asks for visual evidence / proof.
 */
export const BROWSER_SCREENSHOT_INTENT_PATTERNS: readonly RegExp[] = [
  // 1. Explicit screenshot requests:
  // "screenshot", "screenshots", "screen shot", "take a screenshot", "send a screenshot", etc.
  /\b(?:take|capture|grab|get|snap|send|give|provide|include|attach|post|share)\b[\w\s]{0,25}\b(?:screenshot|screen-shot|screen\s*shot)s?\b/i,
  /\b(?:screenshot|screen-shot|screen\s*shot)s?\b/i,

  // 2. "show me the page", "let me see the page", "can I see the page/screen"
  /\b(?:show|send|display)\b(?:\s+me)?\s+(?:the\s+)?(?:page|webpage|website|site|screen)\b/i,
  /\b(?:let\s+me|can\s+i)\s+(?:see|view)\s+(?:the\s+)?(?:page|webpage|website|site|screen)\b/i,

  // 3. "what does the page look like", "how does it look", "what the site looks like"
  /\bwhat\b[\w\s]{0,30}\blooks?\s+like\b/i,
  /\bhow\s+does\b[\w\s]{0,30}\blook\b/i,

  // 4. Visual evidence / proof / visual layout
  /\bvisual\s+(?:evidence|proof|inspection|confirmation|layout|appearance)\b/i,
  /\b(?:look\s+and\s+feel|visual\s+design)\b/i,
  /\bimage\s+(?:proof|evidence)\b/i,

  // Test fixture tokens
  /\bFIRST_SCREEN\b/,
];

export function shouldSurfaceBrowserScreenInChat(options: {
  userPrompt?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
  explicitIntent?: boolean;
}): boolean {
  if (options.explicitIntent) return true;
  const candidates = [
    options.userPrompt,
    options.taskTitle,
    options.taskDescription,
  ].filter((text): text is string => typeof text === "string" && text.length > 0);

  for (const text of candidates) {
    if (BROWSER_SCREENSHOT_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
      return true;
    }
  }
  return false;
}

// ── Official Roadmap Phase 16: Response Intelligence Data Contracts & Authority ──

export type ResponseModalityShape =
  | "short_conversational"
  | "structured_report"
  | "code_block"
  | "tabular_comparison";

export interface ResponseFormattingPlan {
  shape: ResponseModalityShape;
  includeVisualAttachment: boolean;
  maxWordsTarget?: number;
  useMarkdownTables: boolean;
  requireExecutiveConclusion: boolean;
}

export const ERR_CHAT_POLLUTION_BLOCKED = "ERR_CHAT_POLLUTION_BLOCKED";
export const ERR_SCREEN_CAPTURE_BLOCKED = "ERR_SCREEN_CAPTURE_BLOCKED";

export class ChatPollutionBlockedError extends Error {
  readonly code = ERR_CHAT_POLLUTION_BLOCKED;
  constructor(message: string = "Attempted injection of prohibited browser screen capture into chat history blocked") {
    super(message);
    this.name = "ChatPollutionBlockedError";
  }
}

const EXPLICIT_TABLE_REGEX = /\b(?:table|comparison\s*table|tabular|table\s*of|comparison\s*matrix|markdown\s*table)\b/i;
const MULTI_OPTION_COMPARISON_REGEX = /\b(?:compare|comparison|versus|vs\.?|trade-?offs?|pros\s*and\s*cons)\b[\w\s]{0,50}\b(?:between|across|with|against|and)\b/i;
const SIMPLE_DIFFERENCE_FACTUAL_REGEX = /^(?:what\s+is\s+the\s+difference\s+between\s+[\w\s-]+\s+and\s+[\w\s-]+|\s*difference\s+between\s+[\w\s-]+\s+and\s+[\w\s-]+)\??$/i;

const EXPLICIT_CODE_REGEX = /\b(?:write|generate|give|show|create|provide|implement|send)\b[\w\s]{0,25}\b(?:code|script|function|snippet|command|curl|bash|regex|sql|dockerfile|yaml|json|api\s*call)\b/i;
const CODE_INQUIRY_ONLY_REGEX = /^(?:what\s+(?:is|does)\b|how\s+does\b|is\s+[\w\s-]+\s+(?:safe|valid|fast|good)|explain\b)/i;

const EXPLICIT_REPORT_REGEX = /\b(?:report|audit|technical\s+breakdown|architecture\s+review|security\s+audit|comprehensive\s+review|detailed\s+analysis|in-depth\s+analysis|engineering\s+review|implementation\s+plan)\b/i;
const EXPLICIT_DETAIL_REQUEST_REGEX = /\b(?:explain\s+in\s+detail|provide\s+a\s+detailed\s+report|give\s+a\s+full\s+breakdown|be\s+comprehensive|give\s+me\s+everything)\b/i;

const CONCISE_OVERRIDE_REGEX = /\b(?:in\s+one\s+sentence|in\s+1\s+sentence|briefly|short\s+answer|keep\s+it\s+short|concise\s+answer|quick\s+answer)\b/i;

/**
 * Determines the authoritative ResponseFormattingPlan based on user prompt,
 * task title, and contextual intent without relying on brittle keyword tricks.
 */
export function determineResponseFormattingPlan(options: {
  userPrompt?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
  context?: Record<string, unknown>;
}): ResponseFormattingPlan {
  const prompt = (options.userPrompt || "").trim();
  const title = (options.taskTitle || "").trim();
  const desc = (options.taskDescription || "").trim();
  const combined = `${prompt} ${title} ${desc}`.trim();

  const includeVisualAttachment = shouldSurfaceBrowserScreenInChat(options);

  // Explicit user override for shortness
  if (CONCISE_OVERRIDE_REGEX.test(prompt)) {
    return {
      shape: "short_conversational",
      includeVisualAttachment,
      maxWordsTarget: 40,
      useMarkdownTables: false,
      requireExecutiveConclusion: false,
    };
  }

  // 1. Tabular Comparison
  const wantsTable = EXPLICIT_TABLE_REGEX.test(combined);
  const isMultiComparison = MULTI_OPTION_COMPARISON_REGEX.test(combined);
  const isSimpleDifference = SIMPLE_DIFFERENCE_FACTUAL_REGEX.test(prompt);

  if ((wantsTable || isMultiComparison) && !isSimpleDifference) {
    return {
      shape: "tabular_comparison",
      includeVisualAttachment,
      maxWordsTarget: 350,
      useMarkdownTables: true,
      requireExecutiveConclusion: true,
    };
  }

  // 2. Code Block
  const isCodeRequest = EXPLICIT_CODE_REGEX.test(combined);
  const isOnlyFactualAboutCode = CODE_INQUIRY_ONLY_REGEX.test(prompt) && !/\b(?:write|give|show|create)\b/i.test(prompt);

  if (isCodeRequest && !isOnlyFactualAboutCode) {
    return {
      shape: "code_block",
      includeVisualAttachment: false,
      maxWordsTarget: 500,
      useMarkdownTables: false,
      requireExecutiveConclusion: false,
    };
  }

  // 3. Structured Report
  const isReport = EXPLICIT_REPORT_REGEX.test(combined);
  const wantsDetail = EXPLICIT_DETAIL_REQUEST_REGEX.test(combined);

  if (isReport || wantsDetail) {
    return {
      shape: "structured_report",
      includeVisualAttachment,
      maxWordsTarget: 600,
      useMarkdownTables: false,
      requireExecutiveConclusion: true,
    };
  }

  // 4. Default: Short Conversational for simple factual queries, greetings, and routine tasks
  return {
    shape: "short_conversational",
    includeVisualAttachment,
    maxWordsTarget: 80,
    useMarkdownTables: false,
    requireExecutiveConclusion: false,
  };
}

/**
 * Validates a ResponseFormattingPlan against allowed schema invariants.
 * Replaces malformed values with safe coherent defaults.
 */
export function validateResponseFormattingPlan(plan: unknown): ResponseFormattingPlan {
  if (!plan || typeof plan !== "object") {
    return {
      shape: "short_conversational",
      includeVisualAttachment: false,
      maxWordsTarget: 80,
      useMarkdownTables: false,
      requireExecutiveConclusion: false,
    };
  }

  const p = plan as Partial<ResponseFormattingPlan>;
  const allowedShapes: ResponseModalityShape[] = [
    "short_conversational",
    "structured_report",
    "code_block",
    "tabular_comparison",
  ];

  const shape: ResponseModalityShape = allowedShapes.includes(p.shape as ResponseModalityShape)
    ? (p.shape as ResponseModalityShape)
    : "short_conversational";

  const includeVisualAttachment = Boolean(p.includeVisualAttachment);
  let useMarkdownTables = Boolean(p.useMarkdownTables);
  let requireExecutiveConclusion = Boolean(p.requireExecutiveConclusion);

  let maxWordsTarget: number | undefined = undefined;
  if (typeof p.maxWordsTarget === "number" && Number.isFinite(p.maxWordsTarget) && p.maxWordsTarget > 0) {
    maxWordsTarget = Math.min(Math.round(p.maxWordsTarget), 5000);
  }

  // Coherence normalization
  if (shape === "tabular_comparison") {
    useMarkdownTables = true;
  } else if (shape === "short_conversational") {
    useMarkdownTables = false;
    requireExecutiveConclusion = false;
    if (maxWordsTarget === undefined || maxWordsTarget > 150) {
      maxWordsTarget = 80;
    }
  }

  return {
    shape,
    includeVisualAttachment,
    ...(maxWordsTarget !== undefined ? { maxWordsTarget } : {}),
    useMarkdownTables,
    requireExecutiveConclusion,
  };
}

/**
 * Strips raw base64 data URIs and raw image payloads from text while preserving
 * synthesized conversational and technical Markdown content.
 */
export function stripRawBase64DataUris(text: string): string {
  if (!text || typeof text !== "string") return "";

  let cleaned = text;

  // 1. Remove Markdown images containing data URIs: ![alt](data:image/...) -> ""
  cleaned = cleaned.replace(/!\[([^\]]*)\]\(data:image\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]+[\s\S]*?\)/gi, "");

  // 2. Remove raw data URIs: data:image/png;base64,...
  cleaned = cleaned.replace(/data:image\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]+/gi, "");

  // 3. Remove accidental raw base64 blocks (>100 characters of continuous base64 without spaces)
  cleaned = cleaned.replace(/\b(?:iVBORw0KGgo|\/9j\/4AAQSkZJRg|R0lGODlh)[A-Za-z0-9+/=]{80,}\b/g, "");

  // Clean trailing empty spaces and blank lines
  return cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ScreenFrameValidationResult {
  valid: boolean;
  code?: string;
  reason?: string;
  format?: "png" | "jpeg" | "webp" | "unknown";
  width?: number;
  height?: number;
}

/**
 * Validates raw or base64 screen frame bytes:
 * - Checks file signatures (PNG, JPEG, WebP)
 * - Verifies dimensions and minimum payload integrity
 * - Unpacks and samples scanlines to prevent all-black or blank placeholders
 *   from settling into the transcript.
 */
export function validateScreenFrameBytes(input: Buffer | string | undefined | null): ScreenFrameValidationResult {
  if (!input) {
    return { valid: false, code: "ERR_SCREEN_CAPTURE_EMPTY", reason: "Screen capture buffer is empty or missing" };
  }

  let buf: Buffer;
  if (typeof input === "string") {
    const raw = input.trim().replace(/^data:image\/[a-zA-Z0-9.+_-]+;base64,/, "");
    if (!raw) {
      return { valid: false, code: "ERR_SCREEN_CAPTURE_EMPTY", reason: "Base64 image string is empty" };
    }
    try {
      buf = Buffer.from(raw, "base64");
    } catch {
      return { valid: false, code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "Failed to decode base64 image data" };
    }
  } else if (Buffer.isBuffer(input)) {
    buf = input;
  } else {
    return { valid: false, code: "ERR_SCREEN_CAPTURE_INVALID", reason: "Unsupported input type for screen capture validation" };
  }

  if (buf.length < 32) {
    return { valid: false, code: "ERR_SCREEN_CAPTURE_TOO_SMALL", reason: `Image buffer is suspiciously small (${buf.length} bytes)` };
  }

  // 1. Detect PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    if (buf.length < 33) {
      return { valid: false, code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG buffer too short for IHDR" };
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const colorType = buf[25];

    if (width === 0 || height === 0) {
      return { valid: false, code: "ERR_SCREEN_CAPTURE_INVALID_DIMENSIONS", reason: `Invalid PNG dimensions (${width}x${height})` };
    }

    const idatChunks: Buffer[] = [];
    let offset = 8;
    while (offset + 8 <= buf.length) {
      const length = buf.readUInt32BE(offset);
      const type = buf.toString("ascii", offset + 4, offset + 8);
      if (type === "IDAT" && offset + 8 + length <= buf.length) {
        idatChunks.push(buf.subarray(offset + 8, offset + 8 + length));
      }
      offset += 12 + length;
      if (type === "IEND") break;
    }

    if (idatChunks.length > 0) {
      try {
        const compressed = Buffer.concat(idatChunks);
        const decompressed = zlib.inflateSync(compressed);
        let maxLum = 0;
        const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
        const stride = 1 + width * bpp;

        const stepRow = Math.max(1, Math.floor(height / 100));
        for (let row = 0; row < height; row += stepRow) {
          const rowOffset = row * stride;
          if (rowOffset + stride > decompressed.length) break;
          const stepCol = Math.max(1, Math.floor(width / 20));
          for (let col = 0; col < width; col += stepCol) {
            const pxOffset = rowOffset + 1 + col * bpp;
            if (pxOffset + bpp <= decompressed.length) {
              const r = decompressed[pxOffset]!;
              const g = bpp >= 3 ? decompressed[pxOffset + 1]! : r;
              const b = bpp >= 3 ? decompressed[pxOffset + 2]! : r;
              const lum = (r * 299 + g * 587 + b * 114) / 1000;
              if (lum > maxLum) maxLum = lum;
            }
          }
        }

        if (maxLum < 2) {
          return {
            valid: false,
            code: "ERR_SCREEN_CAPTURE_BLANK",
            reason: "PNG screen capture is completely black or blank (max luminance < 2)",
            format: "png",
            width,
            height,
          };
        }
      } catch {
        // If inflate fails, fall through to structural validity
      }
    }

    return { valid: true, format: "png", width, height };
  }

  // 2. Detect JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let sum = 0;
    let sumSq = 0;
    const n = Math.min(buf.length, 4096);
    const start = Math.min(100, Math.floor(buf.length / 4));
    for (let i = start; i < start + n && i < buf.length; i++) {
      const val = buf[i]!;
      sum += val;
      sumSq += val * val;
    }
    const mean = sum / n;
    const variance = (sumSq / n) - (mean * mean);

    if (buf.length < 2000 && variance < 15) {
      return {
        valid: false,
        code: "ERR_SCREEN_CAPTURE_BLANK",
        reason: "JPEG screen capture is blank or lacks visual content",
        format: "jpeg",
      };
    }

    return { valid: true, format: "jpeg" };
  }

  // 3. Detect WebP: RIFF ... WEBP
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { valid: true, format: "webp" };
  }

  return { valid: false, code: "ERR_SCREEN_CAPTURE_UNKNOWN_FORMAT", reason: "Unrecognized image format" };
}

/**
 * Identifies whether a screen frame or payload represents an invalid browser screen capture
 * that must be prohibited from ordinary chat history.
 */
export function isProhibitedScreenFrame(
  message: {
    role?: string;
    kind?: string;
    surface?: string;
    png?: string;
    text?: string;
  },
  userPrompt?: string | null,
): boolean {
  if (message.kind === "screen") {
    // 1. Reject empty or all-black / blank image frames
    if (message.png) {
      const validation = validateScreenFrameBytes(message.png);
      if (!validation.valid && validation.code === "ERR_SCREEN_CAPTURE_BLANK") {
        return true;
      }
    } else {
      return true;
    }

    const isBrowserSurface = message.surface === "browser" ||
      (message.png && message.png.includes("browser")) ||
      (message.surface === undefined && message.role === "bot");
    if (isBrowserSurface && !shouldSurfaceBrowserScreenInChat({ userPrompt })) {
      return true;
    }
  }

  if (message.kind === "text" && message.text) {
    const trimmed = message.text.trim();
    if (
      trimmed.startsWith("data:image/") ||
      (trimmed.startsWith("iVBORw0KGgo") && trimmed.length > 100) ||
      /^!\[[^\]]*\]\(data:image\/[^)]+\)$/.test(trimmed)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitizes a message before persistence into the authoritative chat store.
 * Filters prohibited browser screen frames (triggering onBlocked and ERR_CHAT_POLLUTION_BLOCKED)
 * and strips raw base64 data URIs from message text.
 */
export function sanitizeMessageForChatStorage<
  T extends {
    role?: string;
    kind?: string;
    surface?: string;
    png?: string;
    text?: string;
    attachments?: Array<{ kind: string; path: string; name?: string }>;
  }
>(
  message: T,
  options?: {
    userPrompt?: string | null;
    onBlocked?: (error: ChatPollutionBlockedError) => void;
  },
): {
  message: T | null;
  blocked: boolean;
  code?: string;
  reason?: string;
} {
  if (isProhibitedScreenFrame(message, options?.userPrompt)) {
    const err = new ChatPollutionBlockedError(
      `Attempted insertion of prohibited browser screen capture into chat history blocked for turn '${options?.userPrompt ?? "unspecified"}'`,
    );
    options?.onBlocked?.(err);
    return {
      message: null,
      blocked: true,
      code: ERR_CHAT_POLLUTION_BLOCKED,
      reason: err.message,
    };
  }

  if (typeof message.text === "string") {
    const sanitizedText = stripRawBase64DataUris(message.text);
    if (!sanitizedText && !message.attachments?.length && message.kind === "text") {
      const err = new ChatPollutionBlockedError("Raw base64 image text blocked from chat history");
      options?.onBlocked?.(err);
      return {
        message: null,
        blocked: true,
        code: ERR_CHAT_POLLUTION_BLOCKED,
        reason: err.message,
      };
    }
    return {
      message: { ...message, text: sanitizedText },
      blocked: false,
    };
  }

  return { message, blocked: false };
}



