// Automatic browser search fallback with genuine screenshot delivery.
//
// When a question cannot be answered by the normal retrieval path, this module
// drives the *existing* per-bot Android WebView browser session
// (`android/.../host/BrowserDriverServer.kt`) over its loopback HTTP API:
//
//   POST /session/<omb-hash>/open       { url }        → navigate
//   POST /session/<omb-hash>/navigate   { url }
//   POST /session/<omb-hash>/text       { maxChars }
//   POST /session/<omb-hash>/eval       { expression }
//   POST /session/<omb-hash>/screenshot                → image/jpeg bytes
//
// Design rules this file holds itself to:
//   • The first search query is the user's question, verbatim (only URL-encoded).
//   • Nothing here knows about any particular person, team or sport: source
//     selection and answer extraction are generic over the question's own words.
//   • A screenshot is only "delivered" after real bytes are captured, validated
//     and stored through `saveImage`; the caller owns message association.
//   • The driver reports failures as HTTP 200 `{ ok: false, error }`, so every
//     call must inspect the envelope instead of trusting the status code.
//   • One bounded fallback per thread at a time; every request has a timeout.
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { saveImage } from "./attachments.ts";
import type { Store } from "./store.ts";

export interface BrowserSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  domain?: string;
  isCredible?: boolean;
}

export interface BrowserSearchFallbackOptions {
  botId: string;
  threadId: string;
  turnId?: string;
  /** The user's original question, exactly as typed. */
  userQuestion: string;
  driverPort?: number;
  driverToken?: string;
  /** Per-request timeout for the loopback driver calls. */
  timeoutMs?: number;
  /** Default: https://html.duckduckgo.com/html/?q= */
  searchEngineBaseUrl?: string;
  /** Injected in tests; production uses global fetch. */
  fetchFn?: typeof fetch;
  /** Unit tests skip the attachment store; production never does. */
  skipAttachmentStore?: boolean;
  /** The active Store instance, for binding the attachment to the turn. */
  storeInstance?: Store;
}

export interface BrowserSearchFallbackResult {
  success: boolean;
  verbatimQuery: string;
  searchUrl: string;
  sourceUrl?: string;
  sourceTitle?: string;
  extractedAnswer?: string;
  uncertaintyNotice?: string;
  screenshotBuffer?: Buffer;
  screenshotHash?: string;
  /** True when the captured page genuinely supports the extracted answer. */
  verified: boolean;
  capturedAt?: number;
  browserSession?: string;
  attachment?: {
    kind: "image";
    path: string;
    mime: string;
    name: string;
    hash: string;
  };
  error?: string;
  credibleSourceFound: boolean;
  deliveryFailed?: boolean;
  /** Set when the driver returned a byte-identical frame for a new question. */
  staleFrame?: boolean;
}

/** One in-flight fallback per thread: one failed lookup cannot fan out into
 *  several competing browser tasks. */
const activeFallbacksByThread = new Map<string, Promise<BrowserSearchFallbackResult>>();

/** Recent captures per thread, used to notice a driver replaying a frame. */
const recentCapturesByThread = new Map<string, Array<{ hash: string; query: string; at: number }>>();
const STALE_CAPTURE_WINDOW_MS = 10 * 60 * 1_000;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SEARCH_BASE = "https://html.duckduckgo.com/html/?q=";

/**
 * Checks whether the app-side WebView browser driver is configured in the environment.
 */
export function isBrowserFallbackAvailable(driverPort?: number, driverToken?: string): boolean {
  const port = driverPort ?? Number(process.env.AB_DRIVER_PORT ?? "0");
  const token = driverToken ?? (process.env.AB_DRIVER_TOKEN ?? "");
  return port > 0 && token.length > 0;
}

/**
 * Normalizes and extracts domain from a URL.
 */
export function extractDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const CONVERSATIONAL_ONLY =
  /^(?:hi|hey|hello|yo|good\s+(?:morning|evening|afternoon)|howdy|sup|thanks|thank\s+you|ok|okay|cool|great|nice|bye|goodbye|see\s+ya)\b/i;

/**
 * Determines whether a user query is the kind of factual question that can
 * require live web verification. Ordinary conversation never qualifies.
 * This is a cheap pre-check only; the model's own refusal remains the other
 * trigger (`isUnverifiedRefusalText`).
 */
export function shouldTriggerBrowserFallback(
  userQuery: string,
  options?: { hasSportsContext?: boolean; retrievalFailed?: boolean },
): boolean {
  const raw = userQuery.trim();
  if (!raw) return false;
  const q = raw.toLowerCase();

  if (CONVERSATIONAL_ONLY.test(q) && q.length < 25) return false;

  // A retrieval tool already failed: the fallback is warranted regardless of wording.
  if (options?.retrievalFailed) return true;

  // "how many <metric>" / "who won" / "when did ... release" style questions.
  const factualQueryPatterns = [
    /\bhow (?:many|much)\b/i,
    /\bwho (?:won|scored|hit|took|coached|leads|founded|created|invented|directed|acted in|is|are)\b/i,
    /\bwhat (?:was|is|were|are) (?:the )?(?:score|result|price|revenue|box office|population|release date|latest|current|weather|winner)\b/i,
    /\bwhen (?:did|is|was|will)\b/i,
    /\b(?:latest version|release notes|current status|scorecard|standings|points table|medal tally)\b/i,
    /\bsearch (?:for|the web|google|duckduckgo)\b/i,
  ];
  if (factualQueryPatterns.some((pat) => pat.test(q))) return true;

  // A sports question whose live context the local card path could not supply.
  if (options?.hasSportsContext === false && /\b(?:match|game|innings|score|scorecard|fours|sixes|wickets|goals)\b/i.test(q)) {
    return true;
  }
  return false;
}

/**
 * Checks whether an assistant's proposed response is an unverified refusal to
 * look something up even though browser research is available.
 */
export function isUnverifiedRefusalText(text: string): boolean {
  if (!text) return false;
  const patterns = [
    /\b(?:cannot|can't)\s+(?:verify|check|access|look up|retrieve)\b/i,
    /\blive\s+(?:match-stat\s+)?tools\s+aren't\s+available\b/i,
    /\btools\s+(?:are\s+not|aren't)\s+available\b/i,
    /\b(?:don't|do not)\s+have\s+access\s+to\s+real-?time\b/i,
    /\b(?:tell me|provide)\s+(?:the\s+)?(?:opponent|match date|scorecard|source)\b/i,
    /\bno\s+(?:active\s+)?tools?\s+(?:are\s+)?available\b/i,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Builds the search URL from the verbatim question. User text never reaches the
 * URL unencoded.
 */
export function buildVerbatimSearchUrl(userQuestion: string, baseUrl?: string): string {
  const verbatim = userQuestion.trim();
  const base = baseUrl || DEFAULT_SEARCH_BASE;
  return `${base}${encodeURIComponent(verbatim)}`;
}

/** Words that carry no subject identity in a question. */
const QUERY_STOP_WORDS = new Set([
  "how", "many", "much", "did", "does", "do", "the", "for", "and", "what", "who", "whom",
  "when", "where", "which", "why", "was", "were", "is", "are", "has", "have", "had",
  "in", "on", "at", "of", "to", "a", "an", "his", "her", "their", "its", "he", "she",
  "they", "it", "last", "latest", "recent", "current", "today", "yesterday", "tonight",
  "game", "games", "match", "matches", "inning", "innings", "hit", "hits", "score",
  "scores", "scored", "make", "made", "get", "got", "give", "tell", "me", "about",
  "there", "this", "that", "these", "those", "from", "with", "by", "as", "be", "been",
]);

/** Lowercased content words of a question, longest first. */
export function queryTerms(userQuery: string): string[] {
  return userQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !QUERY_STOP_WORDS.has(word));
}

/**
 * The entity-ish words of a question (a name, team, place, product), used to
 * confirm that a source is about what was actually asked. Generic by design:
 * it derives everything from the question, and knows no particular subject.
 */
export function querySubjectTerms(userQuery: string, metric?: string): string[] {
  const metricStem = metric ? metric.toLowerCase().replace(/(?:es|s)$/, "") : "";
  return queryTerms(userQuery).filter(
    (word) => !QUERY_STOP_WORDS.has(word) && (!metricStem || !word.startsWith(metricStem)),
  );
}

/** The counted noun in a "how many X" question, if there is one. */
export function queryMetric(userQuery: string): string | undefined {
  const match = userQuery.match(/\bhow (?:many|much)\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/i);
  if (!match) return undefined;
  const phrase = match[1]!.trim().toLowerCase();
  // Drop trailing glue that would make the metric unusable ("fours did", "runs in").
  const [first] = phrase.split(/\s+/);
  return first && !QUERY_STOP_WORDS.has(first) ? first : undefined;
}

/**
 * Parses search results out of the rendered text of a results page.
 * The WebView text view has no link structure, so result blocks are recovered
 * from title / URL / snippet line shapes.
 */
export function parseSearchResults(pageText: string): BrowserSearchResultItem[] {
  const results: BrowserSearchResultItem[] = [];
  if (!pageText) return results;

  const lines = pageText.split("\n").map((l) => l.trim()).filter(Boolean);
  const isUrlLine = /^(?:https?:\/\/|www\.|\w[\w-]*\.(?:com|org|net|in|tv|co|gov|edu|ai|io|uk|au|info|news))\b\S*/i;
  // The engine's own ad slots and redirects are never a source.
  const isEngineChrome = (url: string) =>
    /(?:^|\.)duckduckgo\.com|(?:^|\.)duck\.ai|ad_domain=|\/y\.js\?/i.test(url);
  const isChrome = /^(?:DuckDuckGo|All Regions|Any Time|Settings|Privacy|Safe search|Images|Videos|News)/i;

  let currentTitle = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isUrlLine.test(line)) {
      const url = line.startsWith("http") ? line : `https://${line.replace(/^www\./, "")}`;
      const snippetParts: string[] = [];
      let j = i + 1;
      while (j < lines.length && j < i + 5) {
        const next = lines[j]!;
        if (isUrlLine.test(next)) break;
        if (next.length > 20 && !isChrome.test(next)) snippetParts.push(next);
        j++;
      }
      if (currentTitle && url && !isEngineChrome(url)) {
        results.push({ title: currentTitle, url, snippet: snippetParts.join(" "), domain: extractDomain(url) });
      }
      currentTitle = "";
      i = j - 1;
    } else if (line.length > 15 && line.length < 200 && !isChrome.test(line)) {
      currentTitle = line;
    }
  }

  const seen = new Set<string>();
  return results.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

const TRUSTED_DOMAINS = [
  "bcci.tv",
  "icc-cricket.com",
  "espncricinfo.com",
  "cricinfo.com",
  "iplt20.com",
  "premierleague.com",
  "fbref.com",
  "uefa.com",
  "fifa.com",
  "olympics.com",
  "nobelprize.org",
  "wikipedia.org",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "thehindu.com",
  "espn.com",
  "boxofficemojo.com",
  "the-numbers.com",
];

/**
 * Scores candidates and returns the most relevant credible one. Relevance comes
 * from the question's own words; credibility comes from domain authority. The
 * first result is never accepted by default.
 */
export function selectCredibleSource(
  candidates: BrowserSearchResultItem[],
  userQuery: string,
): BrowserSearchResultItem | null {
  if (!candidates || candidates.length === 0) return null;

  const terms = queryTerms(userQuery);
  const metric = queryMetric(userQuery);
  const subjects = querySubjectTerms(userQuery, metric);

  let best: BrowserSearchResultItem | null = null;
  let highest = -1;

  for (const candidate of candidates) {
    let score = 0;
    const text = `${candidate.title} ${candidate.snippet} ${candidate.url}`.toLowerCase();
    const domain = candidate.domain || extractDomain(candidate.url);

    if (TRUSTED_DOMAINS.some((td) => domain === td || domain.endsWith(`.${td}`))) {
      score += 30;
      candidate.isCredible = true;
    } else if (domain.endsWith(".gov") || domain.endsWith(".edu") || domain.endsWith(".org")) {
      score += 20;
      candidate.isCredible = true;
    } else {
      score += 5;
    }

    for (const term of terms) if (text.includes(term)) score += 10;
    for (const subject of subjects) if (text.includes(subject)) score += 20;

    // Evidence shape: a number attached to the asked metric ("14 fours").
    if (metric) {
      const stem = metric.replace(/(?:es|s)$/, "");
      const evidence = new RegExp(`\\b\\d[\\d,]*\\s+${escapeRegExp(stem)}s?\\b`, "i");
      if (evidence.test(text)) score += 25;
      else if (text.includes(stem)) score += 8;
    }

    candidate.score = score;
    if (score > highest) {
      highest = score;
      best = candidate;
    }
  }

  // A candidate backed by nothing but a bare domain match is not a source.
  return best && highest > 0 ? best : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── screenshot validation ───────────────────────────────────────────────────

/** Structural dimensions of a JPEG (first SOFn frame header). */
function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return width && height ? { width, height } : null;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** Structural dimensions of a PNG (IHDR) plus its terminating IEND chunk. */
function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 33 || buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width && height ? { width, height } : null;
}

export const SCREENSHOT_MIN_BYTES = 2_000;
export const SCREENSHOT_MAX_BYTES = 24 * 1024 * 1024;

/**
 * Validates that captured bytes are a real, structurally complete screenshot:
 * magic bytes, parsed frame dimensions, a sane size, and a proper trailer (EOI
 * for JPEG, IEND for PNG). An empty, truncated or non-image body is rejected
 * rather than stored as a screenshot.
 */
export function verifyScreenshotBuffer(buf: Buffer): { valid: boolean; reason?: string; mime: string } {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    return { valid: false, reason: "screenshot body is empty", mime: "" };
  }
  if (buf.length < SCREENSHOT_MIN_BYTES) {
    return { valid: false, reason: `screenshot is ${buf.length} bytes, below the ${SCREENSHOT_MIN_BYTES}-byte floor`, mime: "" };
  }
  if (buf.length > SCREENSHOT_MAX_BYTES) {
    return { valid: false, reason: `screenshot is ${buf.length} bytes, above the ${SCREENSHOT_MAX_BYTES}-byte ceiling`, mime: "" };
  }

  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  if (isJpeg) {
    const dims = jpegDimensions(buf);
    if (!dims) return { valid: false, reason: "JPEG has no decodable frame header", mime: "" };
    if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) {
      return { valid: false, reason: "JPEG is truncated (missing EOI marker)", mime: "" };
    }
    if (dims.width < 120 || dims.height < 120) {
      return { valid: false, reason: `screenshot is too small to show a page (${dims.width}x${dims.height})`, mime: "" };
    }
    return { valid: true, mime: "image/jpeg" };
  }

  if (isPng) {
    const dims = pngDimensions(buf);
    if (!dims) return { valid: false, reason: "PNG has no decodable IHDR frame header", mime: "" };
    if (buf.subarray(buf.length - 12, buf.length - 8).toString("latin1") !== "IEND") {
      return { valid: false, reason: "PNG is truncated (missing IEND chunk)", mime: "" };
    }
    if (dims.width < 120 || dims.height < 120) {
      return { valid: false, reason: `screenshot is too small to show a page (${dims.width}x${dims.height})`, mime: "" };
    }
    return { valid: true, mime: "image/png" };
  }

  return { valid: false, reason: "body is not a JPEG or PNG image", mime: "" };
}

// ── answer synthesis ────────────────────────────────────────────────────────

/** Stable per-bot browser profile name — same derivation as BrowserDriverServer. */
export function sessionNameForBot(botId: string): string {
  const digest = createHash("sha256").update(botId).digest("hex");
  return `omb-${digest.slice(0, 32)}`;
}

/** A short human label for a source, derived from its title and URL. */
export function cleanSiteName(title: string, url?: string): string {
  const domain = url ? extractDomain(url) : "";
  if (domain) {
    if (domain.includes("wikipedia")) return "Wikipedia";
    // "sportstar.thehindu.com" → "Sportstar"
    const label = domain.split(".")[0]!.replace(/^www$/, "");
    if (label && label.length > 2) return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (!title) return "Official Source";
  const parts = title.split(/\s*[-–|:]\s*/);
  return (parts[0] || title).slice(0, 60);
}

/**
 * Generic evidence lookup: does `pageText` state a number for the metric the
 * question asked about, in a passage that also mentions the question's subject?
 * No subject is hardcoded; both come from the question.
 */
export function findMetricEvidence(
  pageText: string,
  userQuery: string,
): { metric: string; value: string; context: string } | null {
  const metric = queryMetric(userQuery);
  if (!metric) return null;
  const stem = metric.replace(/(?:es|s)$/, "");
  if (stem.length < 3) return null;
  const pattern = new RegExp(`\\b(\\d[\\d,]*)\\s+${escapeRegExp(stem)}(?:es|s)?\\b`, "i");
  const match = pattern.exec(pageText);
  if (!match) return null;
  const start = Math.max(0, match.index - 220);
  const end = Math.min(pageText.length, match.index + match[0].length + 120);
  const context = pageText.slice(start, end).replace(/\s+/g, " ").trim();
  return { metric: stem, value: match[1]!, context };
}

/**
 * Produces the assistant's factual line. It only asserts a value that the
 * captured page actually states; otherwise it says so plainly.
 */
export function synthesizeVerifiedAnswer(options: {
  userQuestion: string;
  sourceItem: BrowserSearchResultItem | null;
  pageText: string;
  verbatimQuery: string;
}): { answerText: string; uncertaintyNotice?: string; verified: boolean } {
  const { userQuestion, sourceItem, pageText, verbatimQuery } = options;

  if (!sourceItem) {
    return {
      answerText: `I searched the web for "${verbatimQuery}", but none of the results I could open contained a credible answer to that question.`,
      uncertaintyNotice: "The attached screenshot shows the search results page; it is not proof of any specific fact.",
      verified: false,
    };
  }

  const siteName = cleanSiteName(sourceItem.title, sourceItem.url);
  const link = sourceItem.url ? ` [${siteName}](${sourceItem.url})` : "";
  const subjects = querySubjectTerms(userQuestion, queryMetric(userQuestion));
  const subjectMentioned =
    subjects.length === 0 ||
    subjects.some((s) => `${sourceItem.title}\n${pageText}`.toLowerCase().includes(s));

  // Only the page counts as verification. A search snippet is the engine's
  // summary of a page, not the page: asserting a figure from it while the
  // attached capture shows something else is exactly the false confidence this
  // fallback exists to avoid.
  const evidence = findMetricEvidence(`${sourceItem.title}\n${pageText}`, userQuestion);
  if (evidence && subjectMentioned) {
    const context = evidence.context.length > 320 ? `${evidence.context.slice(0, 317)}…` : evidence.context;
    return {
      answerText: `According to ${siteName}: ${context}${/[.!?]$/.test(context) ? "" : "."}${link}`,
      uncertaintyNotice: `Read from the captured ${siteName} page in the attached screenshot.`,
      verified: true,
    };
  }

  if (!subjectMentioned) {
    return {
      answerText: `I opened the most relevant result I found (${siteName}), but that page does not mention what was asked in "${verbatimQuery}", so I cannot confirm an answer from it.${link}`,
      uncertaintyNotice: `The attached screenshot shows the ${siteName} page I inspected; it does not establish the answer.`,
      verified: false,
    };
  }

  const excerpt = (sourceItem.snippet || "").slice(0, 300);
  return {
    answerText: excerpt
      ? `I opened ${siteName} for "${verbatimQuery}". The search result summary says "${excerpt}", but the page I captured did not show that figure.${link}`
      : `I opened ${siteName} for "${verbatimQuery}", but the page did not state a value I can quote.${link}`,
    uncertaintyNotice: `The attached screenshot is the ${siteName} page as captured; it does not itself show the figure, so treat it as unconfirmed.`,
    verified: false,
  };
}

// ── driver plumbing ─────────────────────────────────────────────────────────

interface DriverCall {
  port: number;
  token: string;
  session: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
}

/** Calls a JSON driver route and refuses `{ ok: false }` envelopes, which the
 *  Android driver returns with HTTP 200. */
async function driverJson(call: DriverCall, action: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await call.fetchFn(`http://127.0.0.1:${call.port}/session/${call.session}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${call.token}` },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(call.timeoutMs),
  });
  if (!res.ok) throw new Error(`browser driver ${action} failed (HTTP ${res.status})`);
  const payload = (await res.json()) as Record<string, unknown>;
  if (payload && payload.ok === false) {
    throw new Error(`browser driver ${action} failed: ${String(payload.error ?? "unknown error")}`);
  }
  return payload;
}

/** Captures screenshot bytes, surfacing a JSON error body as an error rather
 *  than storing it as an image. */
async function driverScreenshot(call: DriverCall): Promise<Buffer> {
  const res = await call.fetchFn(`http://127.0.0.1:${call.port}/session/${call.session}/screenshot`, {
    method: "POST",
    headers: { Authorization: `Bearer ${call.token}` },
    signal: AbortSignal.timeout(call.timeoutMs),
  });
  if (!res.ok) throw new Error(`browser driver screenshot failed (HTTP ${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length && bytes[0] !== 0xff && bytes[0] !== 0x89) {
    // The driver answers failures with a JSON envelope and status 200.
    try {
      const parsed = JSON.parse(bytes.toString("utf8")) as { ok?: boolean; error?: string };
      if (parsed?.ok === false) throw new Error(`browser driver screenshot failed: ${String(parsed.error ?? "unknown error")}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("browser driver screenshot failed")) throw err;
    }
  }
  return bytes;
}

/** Reads the current page's visible text through the driver. */
async function readPageText(call: DriverCall): Promise<string> {
  const page = await driverJson(call, "text", { maxChars: 20_000 });
  return typeof page.text === "string" ? page.text : "";
}

/**
 * One best-effort attempt to clear a cookie/consent wall so the capture shows
 * the content instead of the dialog. Only a button whose own label asks for
 * consent is pressed; nothing is submitted, and a page without an overlay is
 * left untouched.
 */
async function dismissConsentOverlay(call: DriverCall, pageText: string): Promise<string> {
  if (!/\b(?:your privacy choices|manage preferences|we use cookies|cookie (?:settings|policy)|consent)\b/i.test(pageText)) {
    return pageText;
  }
  const expression = `(function(){try{var want=/^(?:accept all|accept|agree|i agree|allow all|got it|ok)$/i;var els=Array.prototype.slice.call(document.querySelectorAll('button,a,[role=button]'));var hit=els.filter(function(e){var t=(e.textContent||'').trim();return want.test(t);})[0];if(hit){hit.click();return true;}return false;}catch(e){return false;}})()`;
  await driverJson(call, "eval", { expression }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 700));
  return pageText;
}

/** Records a capture and reports whether it replays a frame from another question. */
function recordCapture(threadId: string, hash: string, query: string): { stale: boolean } {
  const now = Date.now();
  const recent = (recentCapturesByThread.get(threadId) ?? []).filter((c) => now - c.at < STALE_CAPTURE_WINDOW_MS);
  const stale = recent.some((c) => c.hash === hash && c.query !== query);
  recent.push({ hash, query, at: now });
  recentCapturesByThread.set(threadId, recent.slice(-8));
  return { stale };
}

/** Test seam: forget capture history for a thread. */
export function resetBrowserFallbackState(threadId?: string): void {
  if (threadId) {
    recentCapturesByThread.delete(threadId);
    activeFallbacksByThread.delete(threadId);
  } else {
    recentCapturesByThread.clear();
    activeFallbacksByThread.clear();
  }
}

/**
 * Runs the complete fallback: verbatim search, source selection, page
 * inspection, screenshot capture, validation, storage.
 */
export async function executeBrowserSearchFallback(
  options: BrowserSearchFallbackOptions,
): Promise<BrowserSearchFallbackResult> {
  const { botId, threadId, turnId, userQuestion } = options;
  const verbatimQuery = userQuestion.trim();

  // Bounded concurrency: a second request for the same thread rides the first.
  const inFlight = activeFallbacksByThread.get(threadId);
  if (inFlight) return inFlight;

  const run = (async (): Promise<BrowserSearchFallbackResult> => {
    const port = options.driverPort ?? Number(process.env.AB_DRIVER_PORT ?? "0");
    const token = options.driverToken ?? (process.env.AB_DRIVER_TOKEN ?? "");

    if (port <= 0 || !token) {
      return {
        success: false,
        verbatimQuery,
        searchUrl: "",
        credibleSourceFound: false,
        verified: false,
        error: "Browser driver is offline on this device (AB_DRIVER_PORT/AB_DRIVER_TOKEN not set)",
      };
    }

    const call: DriverCall = {
      port,
      token,
      session: sessionNameForBot(botId),
      fetchFn: options.fetchFn ?? fetch,
      timeoutMs: Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    };
    const searchUrl = buildVerbatimSearchUrl(verbatimQuery, options.searchEngineBaseUrl);

    try {
      // 1. Open the search page with the question exactly as asked.
      await driverJson(call, "open", { url: searchUrl });

      // 2. Read the rendered results and rank them on relevance + authority.
      const searchPage = await driverJson(call, "text", { maxChars: 30_000 });
      const searchText = typeof searchPage.text === "string" ? searchPage.text : "";
      const candidates = parseSearchResults(searchText);
      const best = selectCredibleSource(candidates, verbatimQuery);
      // At most two pages are opened: the strongest result, then one alternative
      // when the first turns out not to state the answer.
      const shortlist = candidates
        .filter((candidate) => (candidate.score ?? 0) > 0)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 2);

      let sourceUrl = searchUrl;
      let sourceTitle = "Search results";
      let pageText = searchText;
      let pageOpened = false;
      let chosen: BrowserSearchResultItem | null = null;
      let consentOverlay = false;

      // 3. Inspect candidates rather than trusting a snippet: the page must
      //    actually state a value for the asked metric to be preferred.
      for (const candidate of shortlist) {
        try {
          const opened = await driverJson(call, "navigate", { url: candidate.url });
          if (opened.settled === false) {
            // Give a slow page one bounded chance to finish before reading it.
            await new Promise((resolve) => setTimeout(resolve, 1_500));
          }
          const sourceText = await readPageText(call);
          const dismissed = await dismissConsentOverlay(call, sourceText);
          const text = dismissed === sourceText ? sourceText : await readPageText(call);

          chosen = candidate;
          sourceUrl = candidate.url;
          sourceTitle = candidate.title;
          pageText = text.length > 100 ? text : sourceText;
          pageOpened = true;
          consentOverlay = /\b(?:your privacy choices|manage preferences|accept all|we use cookies)\b/i.test(pageText);

          // Prefer a page whose own text states the answer; a snippet alone is
          // not enough to stop looking.
          if (findMetricEvidence(`${candidate.title}\n${pageText}`, verbatimQuery)) break;
        } catch (navError) {
          if (process.env.OMB_BROWSER_FALLBACK_DEBUG === "1") {
            console.warn(`[BrowserFallback] navigating ${candidate.url} failed: ${String(navError)}`);
          }
        }
      }

      if (!pageOpened) {
        // Nothing could be opened: stay on the results page and say so.
        chosen = best;
        sourceUrl = searchUrl;
        sourceTitle = "Search results";
        pageText = searchText;
      }

      // Bring the relevant passage into view so the capture shows the answer.
      // The exact evidence phrase ("14 fours") is the first thing scrolled to;
      // the subject and metric alone can land on a headline instead.
      if (pageOpened) {
        const evidence = findMetricEvidence(pageText, verbatimQuery);
        const subjects = querySubjectTerms(verbatimQuery, queryMetric(verbatimQuery));
        const needles = [
          evidence ? `${evidence.value} ${evidence.metric}` : undefined,
          queryMetric(verbatimQuery),
          ...subjects,
        ]
          .filter((needle): needle is string => Boolean(needle))
          .slice(0, 4);
        if (needles.length) {
          // Pick the *innermost* element holding the evidence phrase: scrolling a
          // big wrapper centers the whole article instead of the statistic.
          const expression = `(function(){try{
            var n=${JSON.stringify(needles)};
            var els=document.querySelectorAll('p,li,td,tr,div,span,section,article,h1,h2,h3');
            var found=null,best=1e9;
            for(var i=0;i<els.length;i++){
              var t=(els[i].textContent||'');
              if(t.length>4000) continue;
              for(var k=0;k<n.length;k++){
                if(n[k] && t.toLowerCase().indexOf(String(n[k]).toLowerCase())>=0 && t.length<best){best=t.length;found=els[i];break;}
              }
            }
            if(found){found.scrollIntoView({block:'start'});window.scrollBy(0,-160);return true;}
            return false;
          }catch(e){return false;}})()`;
          await driverJson(call, "eval", { expression }).catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

      // 4. Capture the live page.
      let shotBuf = await driverScreenshot(call);
      let verification = verifyScreenshotBuffer(shotBuf);
      if (!verification.valid) {
        throw new Error(`screenshot rejected: ${verification.reason}`);
      }
      let screenshotHash = createHash("sha256").update(shotBuf).digest("hex");
      let { stale } = recordCapture(threadId, screenshotHash, verbatimQuery);

      // A byte-identical frame for a different question means the driver may
      // have replayed a stale draw. Re-open the page once and capture again.
      if (stale) {
        await driverJson(call, "navigate", { url: sourceUrl }).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 800));
        shotBuf = await driverScreenshot(call);
        verification = verifyScreenshotBuffer(shotBuf);
        if (!verification.valid) throw new Error(`screenshot rejected on re-capture: ${verification.reason}`);
        screenshotHash = createHash("sha256").update(shotBuf).digest("hex");
        stale = recordCapture(threadId, screenshotHash, verbatimQuery).stale;
      }

      const capturedAt = Date.now();
      const { answerText, uncertaintyNotice, verified } = synthesizeVerifiedAnswer({
        userQuestion: verbatimQuery,
        sourceItem: chosen,
        pageText,
        verbatimQuery,
      });
      const notice = [
        uncertaintyNotice,
        consentOverlay
          ? "A cookie/consent notice is covering part of the captured page, so some content may be obscured in the screenshot."
          : undefined,
        stale
          ? "The browser returned a byte-identical frame to an earlier question, so this capture may not reflect a fresh page render."
          : undefined,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      console.info(
        `[BrowserFallback] query=${JSON.stringify(verbatimQuery)} source=${sourceUrl} ` +
          `verified=${verified && pageOpened} bytes=${shotBuf.length} hash=${screenshotHash.slice(0, 12)}` +
          (consentOverlay ? " consent-overlay=yes" : "") +
          (stale ? " stale-frame=yes" : ""),
      );

      // 5. Store through the canonical attachment pipeline.
      let attachment: BrowserSearchFallbackResult["attachment"];
      if (!options.skipAttachmentStore) {
        try {
          const saved = saveImage(shotBuf, verification.mime);
          const name = basename(saved.path);
          attachment = {
            kind: "image",
            path: `/api/attachments/${name}`,
            mime: verification.mime,
            name,
            hash: screenshotHash,
          };
        } catch (saveError) {
          return {
            success: false,
            verbatimQuery,
            searchUrl,
            sourceUrl,
            sourceTitle,
            screenshotBuffer: shotBuf,
            screenshotHash,
            verified,
            capturedAt,
            browserSession: call.session,
            credibleSourceFound: Boolean(chosen),
            deliveryFailed: true,
            error: `screenshot captured but attachment storage failed: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
          };
        }

        if (attachment && turnId && options.storeInstance) {
          // Bind to this turn's assistant message when one already exists; the
          // turn-settle path in server/index.ts binds it otherwise.
          const target = [...options.storeInstance.messagesFor(threadId)]
            .reverse()
            .find((m) => m.role === "bot" && m.kind === "text" && m.turnId === turnId);
          if (target && !(target.attachments ?? []).some((a) => a.path === attachment!.path)) {
            options.storeInstance.patchMessage(threadId, target.id, {
              attachments: [...(target.attachments ?? []), attachment],
            });
          }
        }
      }

      return {
        success: true,
        verbatimQuery,
        searchUrl,
        sourceUrl,
        sourceTitle,
        extractedAnswer: answerText,
        uncertaintyNotice: notice,
        screenshotBuffer: shotBuf,
        screenshotHash,
        verified: verified && pageOpened,
        capturedAt,
        browserSession: call.session,
        attachment,
        credibleSourceFound: Boolean(chosen),
        staleFrame: stale || undefined,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        verbatimQuery,
        searchUrl,
        credibleSourceFound: false,
        verified: false,
        error: `browser research failed: ${message}`,
      };
    }
  })();

  activeFallbacksByThread.set(threadId, run);
  try {
    return await run;
  } finally {
    activeFallbacksByThread.delete(threadId);
  }
}
