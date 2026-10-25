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

  // 3. "what does the page look like", "how does it look"
  /\bwhat\s+(?:does|do)\b[\w\s]{0,30}\blook\s+like\b/i,
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


