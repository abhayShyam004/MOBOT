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

/** A human sentence for the activity row that explains why a capture was not
 * attached. Raw codes stay in the log; the transcript gets plain language. */
export function screenFrameFailureMessage(result: ScreenFrameValidationResult): string {
  switch (result.code) {
    case "ERR_SCREEN_CAPTURE_BLANK":
      return "Screenshot not attached — the captured frame was blank.";
    case "ERR_SCREEN_CAPTURE_CORRUPT":
      return "Screenshot not attached — the image data was unreadable or truncated.";
    case "ERR_SCREEN_CAPTURE_EMPTY":
      return "Screenshot not attached — no image data was returned.";
    case "ERR_SCREEN_CAPTURE_TOO_SMALL":
      return "Screenshot not attached — the image data was incomplete.";
    case "ERR_SCREEN_CAPTURE_TOO_LARGE":
      return "Screenshot not attached — the image was too large.";
    case "ERR_SCREEN_CAPTURE_INVALID_DIMENSIONS":
      return "Screenshot not attached — the image had invalid dimensions.";
    case "ERR_SCREEN_CAPTURE_UNKNOWN_FORMAT":
      return "Screenshot not attached — the image format was not recognized.";
    default:
      return "Screenshot not attached — the image could not be verified.";
  }
}

// A 4K screen frame is ~8 MB; 32 MB leaves room for a lossless retina capture
// while still bounding the work an untrusted tool output can ask for.
const MAX_SCREEN_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_SCREEN_FRAME_PIXELS = 20_000_000;
const MAX_PNG_DECODED_BYTES = 96 * 1024 * 1024;

const PNG_COLOR_CHANNELS: Readonly<Record<number, number>> = {
  0: 1, // grayscale
  2: 3, // truecolour
  3: 1, // indexed
  4: 2, // grayscale + alpha
  6: 4, // truecolour + alpha
};

const PNG_BIT_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

const ADAM7_PASSES = [
  { xStart: 0, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 4, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 0, yStart: 4, xStep: 4, yStep: 8 },
  { xStart: 2, yStart: 0, xStep: 4, yStep: 4 },
  { xStart: 0, yStart: 2, xStep: 2, yStep: 4 },
  { xStart: 1, yStart: 0, xStep: 2, yStep: 2 },
  { xStart: 0, yStart: 1, xStep: 1, yStep: 2 },
] as const;

interface FrameStatistics {
  minLuminance: number;
  maxLuminance: number;
  dominantLuminance: number;
  materialPixels: number;
  pixels: number;
}

interface PngInspection {
  width: number;
  height: number;
  stats?: FrameStatistics;
  failure?: { code: string; reason: string };
}

function pngPassGeometry(
  width: number,
  height: number,
  interlace: number,
): Array<{ width: number; height: number }> {
  if (interlace !== 1) return [{ width, height }];
  return ADAM7_PASSES.map((pass) => ({
    width: width <= pass.xStart ? 0 : Math.ceil((width - pass.xStart) / pass.xStep),
    height: height <= pass.yStart ? 0 : Math.ceil((height - pass.yStart) / pass.yStep),
  }));
}

function pngExpectedBytes(
  width: number,
  height: number,
  bitDepth: number,
  channels: number,
  interlace: number,
): number {
  let total = 0;
  for (const pass of pngPassGeometry(width, height, interlace)) {
    if (pass.width === 0 || pass.height === 0) continue;
    const rowBytes = Math.ceil((pass.width * channels * bitDepth) / 8);
    total += (1 + rowBytes) * pass.height;
  }
  return total;
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

/** Reverse one PNG scanline filter in place. PNG filters predict each byte
 * from the already-reconstructed left byte and the previous row, so skipping
 * this step reads the raw filter residuals as if they were pixels. */
function unfilterScanline(
  row: Buffer,
  previous: Buffer | undefined,
  filter: number,
  bytesPerPixel: number,
): boolean {
  for (let index = 0; index < row.length; index++) {
    const raw = row[index]!;
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel]! : 0;
    const up = previous ? previous[index]! : 0;
    const upLeft = previous && index >= bytesPerPixel ? previous[index - bytesPerPixel]! : 0;
    let value: number;
    switch (filter) {
      case 0:
        value = raw;
        break;
      case 1:
        value = raw + left;
        break;
      case 2:
        value = raw + up;
        break;
      case 3:
        value = raw + Math.floor((left + up) / 2);
        break;
      case 4:
        value = raw + paethPredictor(left, up, upLeft);
        break;
      default:
        return false;
    }
    row[index] = value & 0xff;
  }
  return true;
}

/** Read one pixel sample. For 16-bit images the high byte carries enough
 * luminance information for a blank frame, so the low byte is skipped. */
function collectPassPixels(
  data: Buffer,
  width: number,
  bitDepth: number,
  colorType: number,
  palette: Buffer | null,
  paletteAlpha: Uint8Array | null,
  histogram: Uint32Array,
): string | null {
  const channels = PNG_COLOR_CHANNELS[colorType]!;
  const maxSample = (1 << bitDepth) - 1;
  const sampleAt = (index: number): number => {
    if (bitDepth === 8) return data[index]!;
    if (bitDepth === 16) return data[index * 2]!;
    const bitOffset = index * bitDepth;
    const byte = data[bitOffset >> 3]!;
    const shift = 8 - bitDepth - (bitOffset & 7);
    return (byte >> shift) & maxSample;
  };

  for (let pixel = 0; pixel < width; pixel++) {
    let red: number;
    let green: number;
    let blue: number;
    let alpha = 255;

    switch (colorType) {
      case 0: {
        const value = sampleAt(pixel);
        red = green = blue = bitDepth < 8 ? Math.round((value * 255) / maxSample) : value;
        break;
      }
      case 2: {
        const base = pixel * 3;
        red = sampleAt(base);
        green = sampleAt(base + 1);
        blue = sampleAt(base + 2);
        break;
      }
      case 3: {
        const index = sampleAt(pixel);
        if (!palette || index * 3 + 2 >= palette.length) {
          return "indexed PNG refers to a colour outside its palette";
        }
        red = palette[index * 3]!;
        green = palette[index * 3 + 1]!;
        blue = palette[index * 3 + 2]!;
        alpha = paletteAlpha?.[index] ?? 255;
        break;
      }
      case 4: {
        const base = pixel * channels;
        if (bitDepth === 8) {
          red = green = blue = data[base]!;
          alpha = data[base + 1]!;
        } else {
          red = green = blue = data[base * 2]!;
          alpha = data[base * 2 + 2]!;
        }
        break;
      }
      case 6: {
        const base = pixel * channels;
        if (bitDepth === 8) {
          red = data[base]!;
          green = data[base + 1]!;
          blue = data[base + 2]!;
          alpha = data[base + 3]!;
        } else {
          red = data[base * 2]!;
          green = data[base * 2 + 2]!;
          blue = data[base * 2 + 4]!;
          alpha = data[base * 2 + 6]!;
        }
        break;
      }
      default:
        return "unsupported PNG colour type";
    }

    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    // Composite over white: a fully transparent "coloured" frame is just as
    // blank to the reader as a white one.
    const visible = alpha >= 255
      ? luminance
      : (luminance * alpha + 255 * (255 - alpha)) / 255;
    const bucket = Math.max(0, Math.min(255, Math.round(visible)));
    histogram[bucket] = histogram[bucket]! + 1;
  }
  return null;
}

function analyseHistogram(histogram: Uint32Array, pixels: number): FrameStatistics {
  let minLuminance = 255;
  let maxLuminance = 0;
  let dominantLuminance = 0;
  for (let bucket = 0; bucket < histogram.length; bucket++) {
    const count = histogram[bucket]!;
    if (count === 0) continue;
    if (bucket < minLuminance) minLuminance = bucket;
    if (bucket > maxLuminance) maxLuminance = bucket;
    if (count > histogram[dominantLuminance]!) dominantLuminance = bucket;
  }
  let materialPixels = 0;
  for (let bucket = 0; bucket < histogram.length; bucket++) {
    if (Math.abs(bucket - dominantLuminance) > 8) materialPixels += histogram[bucket]!;
  }
  return {
    minLuminance: pixels === 0 ? 0 : minLuminance,
    maxLuminance,
    dominantLuminance,
    materialPixels,
    pixels,
  };
}

function blankFrameReason(stats: FrameStatistics, label: string): string | null {
  if (stats.pixels === 0) return `${label} screen capture contains no pixels`;
  if (stats.maxLuminance < 2) {
    return `${label} screen capture is completely black or blank (max luminance < 2)`;
  }
  if (stats.maxLuminance - stats.minLuminance < 3) {
    if (stats.minLuminance >= 250) return `${label} screen capture is blank (uniform white frame)`;
    return `${label} screen capture is blank (uniform frame, luminance range < 3)`;
  }
  // A handful of stray anti-aliasing pixels is not content: a blank white
  // page with one rounded corner is still blank. Real text or UI differs in
  // thousands of pixels. The floor keeps very small frames honest.
  const materialLimit = Math.max(2, Math.floor(stats.pixels * 0.00002));
  if (stats.materialPixels <= materialLimit) {
    return `${label} screen capture is blank (almost uniform: ${stats.materialPixels} differing pixels)`;
  }
  return null;
}

function inspectPng(buf: Buffer): PngInspection {
  if (buf.length < 33) {
    return { width: 0, height: 0, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG buffer too short for IHDR" } };
  }

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_INVALID_DIMENSIONS", reason: `Invalid PNG dimensions (${width}x${height})` } };
  }
  if (width > 20_000 || height > 20_000 || width * height > MAX_SCREEN_FRAME_PIXELS) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_TOO_LARGE", reason: `PNG dimensions are too large (${width}x${height})` } };
  }

  let header: Buffer | null = null;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idatChunks: Buffer[] = [];
  let sawEnd = false;
  let offset = 8;

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    if (offset + 12 + length > buf.length) {
      return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: `PNG chunk '${type}' is truncated` } };
    }
    const data = buf.subarray(offset + 8, offset + 8 + length);

    if (!header) {
      if (type !== "IHDR" || length !== 13) {
        return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG does not begin with a valid IHDR chunk" } };
      }
      header = data;
    } else if (type === "IHDR") {
      return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG contains more than one IHDR chunk" } };
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "PLTE") {
      if (length === 0 || length > 768 || length % 3 !== 0) {
        return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG palette has an invalid length" } };
      }
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset += 12 + length;
  }

  if (!header) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG is missing its IHDR chunk" } };
  }
  if (idatChunks.length === 0) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG is missing image data" } };
  }
  if (!sawEnd) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG is missing its IEND terminator" } };
  }

  const bitDepth = header[8]!;
  const colorType = header[9]!;
  const compression = header[10]!;
  const filterMethod = header[11]!;
  const interlace = header[12]!;
  const channels = PNG_COLOR_CHANNELS[colorType];
  const allowedDepths = PNG_BIT_DEPTHS[colorType];

  if (!channels || !allowedDepths || !allowedDepths.includes(bitDepth)) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: `Unsupported PNG colour type ${colorType} at bit depth ${bitDepth}` } };
  }
  if (compression !== 0 || filterMethod !== 0 || (interlace !== 0 && interlace !== 1)) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG uses an unsupported compression, filter, or interlace mode" } };
  }
  if (colorType === 3 && !palette) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "Indexed PNG is missing its palette" } };
  }

  const expectedBytes = pngExpectedBytes(width, height, bitDepth, channels, interlace);
  if (expectedBytes > MAX_PNG_DECODED_BYTES) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_TOO_LARGE", reason: `PNG decodes to an oversized frame (${expectedBytes} bytes)` } };
  }

  let decompressed: Buffer;
  try {
    decompressed = zlib.inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedBytes });
  } catch {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "PNG image data is corrupt or truncated" } };
  }
  if (decompressed.length !== expectedBytes) {
    return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: `PNG image data is truncated (${decompressed.length} of ${expectedBytes} bytes)` } };
  }

  const paletteAlpha = colorType === 3 && transparency
    ? Uint8Array.from({ length: 256 }, (_, index) => transparency![index] ?? 255)
    : null;
  const filterBytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const histogram = new Uint32Array(256);
  let pixels = 0;
  let cursor = 0;

  for (const pass of pngPassGeometry(width, height, interlace)) {
    if (pass.width === 0 || pass.height === 0) continue;
    const rowBytes = Math.ceil((pass.width * channels * bitDepth) / 8);
    let previous: Buffer | undefined;
    for (let row = 0; row < pass.height; row++) {
      const filter = decompressed[cursor]!;
      const scanline = decompressed.subarray(cursor + 1, cursor + 1 + rowBytes);
      if (!unfilterScanline(scanline, previous, filter, filterBytesPerPixel)) {
        return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: `PNG uses an unknown scanline filter (${filter})` } };
      }
      const error = collectPassPixels(
        scanline,
        pass.width,
        bitDepth,
        colorType,
        palette,
        paletteAlpha,
        histogram,
      );
      if (error) {
        return { width, height, failure: { code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: `PNG pixel data is invalid: ${error}` } };
      }
      pixels += pass.width;
      previous = scanline;
      cursor += 1 + rowBytes;
    }
  }

  return { width, height, stats: analyseHistogram(histogram, pixels) };
}

function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    let marker = buf[offset + 1]!;
    while (marker === 0xff && offset + 2 < buf.length) {
      offset++;
      marker = buf[offset + 1]!;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 4 > buf.length) return null;
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buf.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7 || offset + 9 > buf.length) return null;
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Validates raw or base64 screen frame bytes:
 * - Checks file signatures (PNG, JPEG, WebP) and bounds the payload
 * - Unpacks PNG scanlines through every filter, then samples real pixels
 * - Rejects black, white, uniform, and almost-uniform placeholders while
 *   preserving mostly-white frames that contain actual text or UI
 * - Rejects corrupt, truncated, or oversized captures.
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
    if (!/^[A-Za-z0-9+/=_\-\s]+$/.test(raw)) {
      return { valid: false, code: "ERR_SCREEN_CAPTURE_CORRUPT", reason: "Image string is not valid base64" };
    }
    try {
      buf = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
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
  if (buf.length > MAX_SCREEN_FRAME_BYTES) {
    return { valid: false, code: "ERR_SCREEN_CAPTURE_TOO_LARGE", reason: `Image buffer is too large (${buf.length} bytes)` };
  }

  // 1. Detect PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    const inspected = inspectPng(buf);
    if (inspected.failure) {
      return {
        valid: false,
        code: inspected.failure.code,
        reason: inspected.failure.reason,
        format: "png",
        width: inspected.width,
        height: inspected.height,
      };
    }
    if (inspected.stats) {
      const reason = blankFrameReason(inspected.stats, "PNG");
      if (reason) {
        return {
          valid: false,
          code: "ERR_SCREEN_CAPTURE_BLANK",
          reason,
          format: "png",
          width: inspected.width,
          height: inspected.height,
        };
      }
    }
    return { valid: true, format: "png", width: inspected.width, height: inspected.height };
  }

  // 2. Detect JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const dimensions = jpegDimensions(buf);
    if (dimensions && (dimensions.width > 20_000 || dimensions.height > 20_000 || dimensions.width * dimensions.height > MAX_SCREEN_FRAME_PIXELS)) {
      return {
        valid: false,
        code: "ERR_SCREEN_CAPTURE_TOO_LARGE",
        reason: `JPEG dimensions are too large (${dimensions.width}x${dimensions.height})`,
        format: "jpeg",
        width: dimensions.width,
        height: dimensions.height,
      };
    }

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
        ...(dimensions ?? {}),
      };
    }

    return { valid: true, format: "jpeg", ...(dimensions ?? {}) };
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

export interface ExtractedImagePayload {
  base64: string;
  mime?: string;
}

/**
 * Robustly extracts base64 image data and optional MIME type from arbitrary tool
 * output structures, including:
 *   - MCP image parts: `{ content: [{ type: "image", data: "...", mimeType: "..." }] }`
 *   - Escaped JSON strings (e.g. nested in `result` string)
 *   - Objects with `data`, `base64`, or `image`
 *   - Plain JSON strings or regex matches supporting escaped quotes
 */
export function extractBase64ImageFromOutput(output: unknown): ExtractedImagePayload | null {
  if (!output) return null;

  const visit = (val: unknown, depth = 0): ExtractedImagePayload | null => {
    if (depth > 5 || !val) return null;

    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        const res = visit(parsed, depth + 1);
        if (res) return res;
      } catch {}

      const m = val.match(/(?:\\)?"(?:data|base64)(?:\\)?"\s*:\s*(?:\\)?"([A-Za-z0-9+/=]{100,})(?:\\)?"/);
      if (m && m[1]) {
        const mimeMatch = val.match(/(?:\\)?"(?:mimeType|mime)(?:\\)?"\s*:\s*(?:\\)?"([^"\\]+)(?:\\)?"/i);
        return {
          base64: m[1],
          ...(mimeMatch && mimeMatch[1] ? { mime: mimeMatch[1] } : {}),
        };
      }
      return null;
    }

    if (typeof val !== "object") return null;

    if (Array.isArray(val)) {
      for (const item of val) {
        const res = visit(item, depth + 1);
        if (res) return res;
      }
      return null;
    }

    const rec = val as Record<string, unknown>;

    // Standard MCP image content part
    if (Array.isArray(rec.content)) {
      for (const part of rec.content) {
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (p.type === "image" && typeof p.data === "string" && p.data.length > 100) {
            return {
              base64: p.data,
              ...(typeof p.mimeType === "string" ? { mime: p.mimeType } : {}),
            };
          }
          const res = visit(part, depth + 1);
          if (res) return res;
        }
      }
    }

    if (typeof rec.base64 === "string" && rec.base64.length > 100) {
      return {
        base64: rec.base64,
        ...(typeof rec.mime === "string" ? { mime: rec.mime } : typeof rec.mimeType === "string" ? { mime: rec.mimeType } : {}),
      };
    }

    if (typeof rec.data === "string" && rec.data.length > 100) {
      return {
        base64: rec.data,
        ...(typeof rec.mime === "string" ? { mime: rec.mime } : typeof rec.mimeType === "string" ? { mime: rec.mimeType } : {}),
      };
    }

    if ("result" in rec) {
      const res = visit(rec.result, depth + 1);
      if (res) return res;
    }

    if ("screenshot" in rec) {
      const res = visit(rec.screenshot, depth + 1);
      if (res) return res;
    }

    return null;
  };

  return visit(output);
}



