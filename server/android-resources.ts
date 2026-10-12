// Internet resource tools for the Android computer adapter (Phase: resources).
//
// Discovery already exists (web_search), generic HTTP exists (http_fetch);
// this layer is the resource-acquisition complement: inspect a URL's
// metadata, fetch bounded content for reading, download files into the bot's
// sandboxed workspace with real streaming (no whole-file buffers), extract
// PDF text, discover links/images in HTML, and describe stored artifacts.
//
// Security model (see android-net-guard.ts for the network half):
//   • Every destination passes the SSRF policy — per redirect hop, with DNS
//     resolved by us and connections pinned to validated addresses.
//   • Every path lives inside AC_WORKSPACE via the same resolveInside the
//     workspace tools use — no model-supplied path can escape the sandbox.
//   • Server-supplied filenames (Content-Disposition, URL basenames) are
//     untrusted input: sanitized to a safe basename, never taken verbatim.
//   • Content-Type is never trusted alone; magic bytes decide what a file
//     really is, and disagreement is reported, not hidden.
//   • Downloads write to `<name>.part` and rename atomically on success; a
//     cancelled or failed download never leaves a half file pretending to be
//     an artifact.
//   • PDF extraction runs in-process (pure-JS pdf.js via unpdf) with its own
//     byte and page caps; scanned PDFs are reported as image-only, honestly.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import {
  DownloadAbortedError,
  NetworkPolicyError,
  contentDispositionFilename,
  describeNetworkError,
  guardedInspect,
  guardedRequest,
  guardedStream,
  validateUrl,
} from "./android-net-guard.ts";
import { SandboxError, resolveInside } from "./android-computer-sandbox.ts";

// ── limits (device-sized, deliberately not enormous) ────────────────────────
/** A fetched-into-context resource: 1 MiB decompressed, then truncated:true. */
export const RESOURCE_FETCH_BYTES = 1024 * 1024;
/** How much of a fetched text resource enters the model result. */
export const RESOURCE_TEXT_CHARS = 32_000;
/** A downloaded artifact: 50 MiB. Big enough for real PDFs and images.
 *  OMB_RESOURCE_DOWNLOAD_CAP overrides it in tests (same seam discipline as
 *  the netguard loopback seam; HarnessHost never sets either). */
export const RESOURCE_DOWNLOAD_BYTES = process.env.OMB_RESOURCE_DOWNLOAD_CAP
  ? Math.max(1024, Number(process.env.OMB_RESOURCE_DOWNLOAD_CAP) || 50 * 1024 * 1024)
  : 50 * 1024 * 1024;
/** PDF text extraction input cap (decompressed parse happens in memory). */
export const RESOURCE_PDF_BYTES = 20 * 1024 * 1024;
/** PDF text output cap per extraction call. */
export const RESOURCE_PDF_TEXT_CHARS = 120_000;
/** Hard cap on extracted link/image rows (HTML can reference thousands). */
export const RESOURCE_MAX_LINKS = 200;
/** Page-level extraction: don't parse a 2000-page scan for one page. */
export const RESOURCE_MAX_PDF_PAGES = 2_000;

const DOWNLOADS_DIR = "downloads";

// ── content sniffing ────────────────────────────────────────────────────────

export type ResourceKind =
  | "pdf" | "image" | "html" | "json" | "xml" | "text" | "zip" | "binary" | "empty";

export interface Sniff {
  kind: ResourceKind;
  mime: string;
  image?: { width: number; height: number; format: string };
}

/** Magic-byte sniffing over the first bytes; the declared type is the
 * fallback, never the verdict. Pass at least the first 24 bytes when they
 * exist (PNG reads its IHDR at a fixed offset). */
export function sniffContent(buf: Buffer, declaredType: string): Sniff {
  if (buf.length === 0) return { kind: "empty", mime: "application/x-empty" };
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { kind: "pdf", mime: "application/pdf" };
  }
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { kind: "image", mime: "image/png", image: { ...pngSize(buf), format: "png" } };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const size = jpegSize(buf);
    return { kind: "image", mime: "image/jpeg", ...(size ? { image: { ...size, format: "jpeg" } } : {}) };
  }
  if (buf.length >= 14 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    const size = webpSize(buf);
    return { kind: "image", mime: "image/webp", ...(size ? { image: { ...size, format: "webp" } } : {}) };
  }
  if (buf.length >= 10) {
    const head = buf.subarray(0, 6).toString("latin1");
    if (head === "GIF87a" || head === "GIF89a") {
      return { kind: "image", mime: "image/gif", image: { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: "gif" } };
    }
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7)) {
    return { kind: "zip", mime: "application/zip" };
  }
  const declared = declaredType.split(";")[0]?.trim().toLowerCase() ?? "";
  const textish =
    declared.startsWith("text/") ||
    declared.includes("json") || declared.includes("xml") || declared.includes("javascript") ||
    declared === "image/svg+xml" || declared === "";
  if (textish && looksTextual(buf)) {
    const sample = buf.toString("utf8");
    // The xml prolog must win over the html doctype: an XHTML document
    // starts with <?xml and would otherwise be reported as html.
    if (/^\s*<\?xml/i.test(sample)) return { kind: "xml", mime: declared === "image/svg+xml" ? "image/svg+xml" : declared || "application/xml" };
    if (/^\s*(<!doctype|<html[\s>])/i.test(sample)) return { kind: "html", mime: "text/html" };
    if (declared.includes("json") || /^[\s[{]/.test(sample) && looksLikeJson(sample)) return { kind: "json", mime: declared || "application/json" };
    if (/^\s*<[\w!-]+[\s>/]/.test(sample)) return { kind: "xml", mime: declared || "application/xml" };
    return { kind: "text", mime: declared || "text/plain" };
  }
  if (declared.startsWith("image/")) return { kind: "image", mime: declared };
  return { kind: "binary", mime: declared || "application/octet-stream" };
}

function looksTextual(buf: Buffer): boolean {
  const sample = buf.subarray(0, 4_096);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / Math.max(1, sample.length) < 0.05;
}

function looksLikeJson(sample: string): boolean {
  try { JSON.parse(sample.slice(0, 8_192)); return true; } catch { return false; }
}

function pngSize(buf: Buffer): { width: number; height: number } {
  // IHDR always follows the 8-byte signature at a fixed offset.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) { offset += 1; continue; }
    const marker = buf[offset + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const chunk = buf.subarray(12, 16).toString("latin1");
  if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

// ── untrusted filename → safe workspace-relative name ───────────────────────

/** Sanitize a server- or URL-derived filename to a single safe path
 * component. Traversal, NUL, control characters, Windows-reserved names and
 * absurd lengths all collapse here; the result is a bare name or null. */
export function sanitizeFilename(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* keep raw */ }
  name = basename(name.replace(/\\/g, "/"));
  // Strip NUL/C0 control characters and DEL (a regex over \u0000-\u001f
  // trips the no-control-regex lint; the filter says the same thing).
  name = [...name.normalize("NFKC")]
    .filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127)
    .join("")
    .replace(/[:*?"<>|]/g, "_")
    .trim();
  if (!name || name === "." || name === "..") return null;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) return null;
  if (name.length > 120) {
    const ext = extname(name).slice(0, 16);
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name === "." || name === ".." ? null : name;
}

/** Filename from the response (Content-Disposition first, then URL), already
 * sanitized; null when neither yields anything safe. */
export function filenameFromResponse(url: URL, disposition: string | null): string | null {
  return sanitizeFilename(contentDispositionFilename(disposition)) ?? sanitizeFilename(basename(url.pathname));
}

/** Deterministic fallback: type prefix + host + content hash. */
function generatedFilename(sn: Sniff, url: URL, hash: string): string {
  const ext = sn.kind === "pdf" ? ".pdf"
    : sn.kind === "image" ? `.${sn.image?.format ?? "img"}`
    : sn.kind === "html" ? ".html"
    : sn.kind === "json" ? ".json"
    : sn.kind === "xml" ? ".xml"
    : sn.kind === "text" ? ".txt"
    : sn.kind === "zip" ? ".zip"
    : ".bin";
  return `resource-${url.hostname.replace(/[^a-z0-9.-]/gi, "")}-${hash.slice(0, 12)}${ext}`;
}

/** Unique path inside the bot's downloads dir; never overwrites (1, 2, 3…).
 *  The path is resolved through the workspace sandbox before any write. */
async function uniqueDownloadPath(workspace: string, name: string): Promise<{ absolute: string; relative: string }> {
  const dirRelative = `${DOWNLOADS_DIR}`;
  const dir = resolveInside(workspace, dirRelative);
  await mkdir(dir, { recursive: true });
  const taken = new Set(await readdir(dir));
  let candidate = name;
  let counter = 1;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length) || name;
  while (taken.has(candidate)) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
    if (counter > 9_999) throw new SandboxError("could not find a free filename");
  }
  const relative = `${dirRelative}/${candidate}`;
  return { absolute: resolveInside(workspace, relative), relative };
}

// ── HTML extraction (dependency-free, bounded) ──────────────────────────────

export interface ExtractedLink {
  url: string;
  text: string;
  sameOrigin: boolean;
  looksDownloadable: boolean;
}
export interface ExtractedImage {
  url: string;
  alt: string;
}

export function extractFromHtml(html: string, baseUrl: string): {
  title: string;
  description: string | null;
  canonical: string | null;
  links: ExtractedLink[];
  images: ExtractedImage[];
  text: string;
} {
  const base = new URL(baseUrl);
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]*>/g, "")).trim().slice(0, 300);
  const description = firstMeta(html, ["description"]);
  const canonical = firstLinkRel(html, ["canonical"]);
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    if (links.length >= RESOURCE_MAX_LINKS) break;
    const href = match[2] ?? match[3] ?? match[4] ?? "";
    const anchorText = decodeEntities(match[5].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim().slice(0, 160);
    let resolved: URL;
    try { resolved = new URL(href, base); } catch { continue; }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    resolved.hash = "";
    const key = resolved.href;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      url: resolved.href,
      text: anchorText,
      sameOrigin: resolved.origin === base.origin,
      looksDownloadable: /\.(pdf|zip|docx?|xlsx?|pptx?|csv|epub|tgz|gz|tar)([?#]|$)/i.test(resolved.pathname + resolved.search) ||
        match[0].includes("download"),
    });
  }
  const images: ExtractedImage[] = [];
  const imgSeen = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (images.length >= RESOURCE_MAX_LINKS) break;
    const tag = match[0];
    const src = attrOf(tag, "src") ?? attrOf(tag, "data-src");
    if (!src) continue;
    let resolved: URL;
    try { resolved = new URL(src, base); } catch { continue; }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    if (imgSeen.has(resolved.href)) continue;
    imgSeen.add(resolved.href);
    images.push({ url: resolved.href, alt: decodeEntities(attrOf(tag, "alt") ?? "").slice(0, 200) });
  }
  // OpenGraph / Twitter card images: often the "main" picture of a page.
  for (const name of ["og:image", "twitter:image", "twitter:image:src"]) {
    const value = firstMeta(html, [name]);
    if (!value || images.length >= RESOURCE_MAX_LINKS) continue;
    try {
      const resolved = new URL(value, base);
      if ((resolved.protocol === "http:" || resolved.protocol === "https:") && !imgSeen.has(resolved.href)) {
        imgSeen.add(resolved.href);
        images.unshift({ url: resolved.href, alt: name });
      }
    } catch { /* not a URL; ignore */ }
  }
  return { title, description, canonical, links, images, text: htmlToText(html) };
}

function attrOf(tag: string, name: string): string | null {
  const value = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return value ? (value[2] ?? value[3] ?? value[4] ?? null) : null;
}

function firstMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const match = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i"));
    if (match) {
      const content = attrOf(match[0], "content");
      if (content) return decodeEntities(content).trim().slice(0, 500);
    }
  }
  return null;
}

function firstLinkRel(html: string, rels: string[]): string | null {
  for (const rel of rels) {
    const match = html.match(new RegExp(`<link[^>]+rel\\s*=\\s*["']${rel}["'][^>]*>`, "i"));
    if (match) {
      const href = attrOf(match[0], "href");
      if (href) return href;
    }
  }
  return null;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    });
}

/** Visible-text approximation: drop script/style/noscript, strip tags,
 * collapse whitespace — cheap and bounded, not a rendering engine. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  ).replace(/[ \t\f\v]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

// ── workspace helpers ───────────────────────────────────────────────────────

function hashOf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

interface ArtifactRecord {
  path: string;
  url: string;
  finalUrl: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  fetchedAtMs: number;
  contentKind: ResourceKind;
}

/** Append/update the workspace manifest the bot can read later. */
async function recordArtifact(workspace: string, record: ArtifactRecord): Promise<void> {
  const manifestPath = resolveInside(workspace, "artifacts.json");
  let artifacts: ArtifactRecord[] = [];
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (Array.isArray(parsed)) artifacts = parsed as ArtifactRecord[];
  } catch { /* first artifact */ }
  const existing = artifacts.findIndex((a) => a.path === record.path);
  if (existing >= 0) artifacts[existing] = record;
  else artifacts.push(record);
  if (artifacts.length > 500) artifacts = artifacts.slice(-500);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(manifestPath, JSON.stringify(artifacts, null, 1));
}

async function artifactInfo(workspace: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const relative = typeof args.path === "string" ? args.path : "";
  if (!relative) return { ok: false, error: "path is required" };
  const absolute = resolveInside(workspace, relative);
  const info = await stat(absolute).catch(() => null);
  if (!info) return { ok: false, error: `no such file: ${relative}` };
  const manifest = await readManifest(workspace);
  const record = manifest.find((a) => a.path === relative.replace(/^\.\//, ""));
  const head = Buffer.alloc(24); // ≥ PNG IHDR (signature + 16 bytes)
  const { open } = await import("node:fs/promises");
  const handle = await open(absolute, "r");
  try {
    await handle.read(head, 0, 24, 0);
  } finally {
    await handle.close();
  }
  const sniffed = sniffContent(head, record?.mimeType ?? "");
  const pdfMeta = sniffed.kind === "pdf" && info.size <= RESOURCE_PDF_BYTES
    ? await pdfMetadata(absolute).catch(() => null)
    : null;
  return {
    ok: true,
    path: relative,
    sizeBytes: info.size,
    modifiedAtMs: Math.round(info.mtimeMs),
    declaredMimeType: record?.mimeType ?? null,
    detectedKind: sniffed.kind,
    detectedMimeType: sniffed.mime,
    ...(sniffed.image ? { image: sniffed.image } : {}),
    ...(pdfMeta ? { pdf: pdfMeta } : {}),
    ...(record ? { sourceUrl: record.url, finalUrl: record.finalUrl, fetchedAtMs: record.fetchedAtMs, sha256: record.sha256 } : {}),
  };
}

async function readManifest(workspace: string): Promise<ArtifactRecord[]> {
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed: unknown = JSON.parse(await readFile(resolveInside(workspace, "artifacts.json"), "utf8"));
    return Array.isArray(parsed) ? (parsed as ArtifactRecord[]) : [];
  } catch {
    return [];
  }
}

// ── PDF (unpdf: pure-JS pdf.js, no native deps) ─────────────────────────────

let pdfLibs: typeof import("unpdf") | null = null;
async function pdfModule() {
  if (!pdfLibs) pdfLibs = await import("unpdf");
  return pdfLibs;
}

async function pdfMetadata(path: string): Promise<{ pages: number; title: string | null; hasExtractableText: boolean }> {
  const { getDocumentProxy } = await pdfModule();
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(path);
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const meta = await pdf.getMetadata().catch(() => null);
  const first = await pdf.getPage(1).then((page) => page.getTextContent()).catch(() => null);
  const hasText = !!first && first.items.some((item) => "str" in item && item.str.trim().length > 0);
  return {
    pages: pdf.numPages,
    title: (meta as { info?: { Title?: string } } | null)?.info?.Title || null,
    hasExtractableText: hasText,
  };
}

async function extractPdfText(
  absolutePath: string,
  pages?: { from?: number; to?: number },
): Promise<{ text: string; pages: number; truncated: boolean }> {
  const { extractText, getDocumentProxy } = await pdfModule();
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(absolutePath);
  const pdf = await getDocumentProxy(new Uint8Array(data));
  if (pdf.numPages > RESOURCE_MAX_PDF_PAGES) {
    throw new SandboxError(`PDF has ${pdf.numPages} pages; extraction is capped at ${RESOURCE_MAX_PDF_PAGES}`);
  }
  const from = Math.max(1, Math.min(pages?.from ?? 1, pdf.numPages));
  const to = Math.min(pages?.to ?? pdf.numPages, pdf.numPages);
  if (from > to) throw new SandboxError(`page range ${from}-${to} is empty (document has ${pdf.numPages} pages)`);
  const { text } = await extractText(pdf, { mergePages: false });
  const selected = text.slice(from - 1, to);
  let merged = selected.join("\n\n");
  let truncated = false;
  if (merged.length > RESOURCE_PDF_TEXT_CHARS) {
    merged = merged.slice(0, RESOURCE_PDF_TEXT_CHARS);
    truncated = true;
  }
  return { text: merged, pages: to - from + 1, truncated };
}

// ── tool handlers ───────────────────────────────────────────────────────────

function mapNetworkError(error: unknown): Record<string, unknown> {
  if (error instanceof DownloadAbortedError) return { ok: false, error: "cancelled", cancelled: true };
  if (error instanceof NetworkPolicyError || error instanceof SandboxError) return { ok: false, error: error.message };
  return { ok: false, error: describeNetworkError(error) };
}

/** resource_inspect: metadata without a body download. */
async function resourceInspect(args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  try {
    const url = validateUrl(args.url);
    const timeoutMs = timeoutFrom(args);
    const { meta, finalUrl, redirectCount } = await guardedInspect(url, { timeoutMs, signal });
    return {
      ok: true,
      url: url.href,
      finalUrl: finalUrl.href,
      redirectCount,
      status: meta.status,
      statusText: meta.statusText,
      contentType: meta.contentType,
      contentLength: meta.contentLength,
      contentDisposition: meta.contentDisposition,
      suggestedFilename: filenameFromResponse(finalUrl, meta.contentDisposition),
      etag: meta.etag,
      lastModified: meta.lastModified,
    };
  } catch (error) {
    return mapNetworkError(error);
  }
}

/** resource_fetch: bounded GET whose body may enter the model context. */
async function resourceFetch(args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  try {
    const url = validateUrl(args.url);
    const maxBytes = RESOURCE_FETCH_BYTES;
    const { meta, finalUrl, redirectCount, body } = await guardedRequest(url, { method: "GET", maxBodyBytes: maxBytes, timeoutMs: timeoutFrom(args), signal, onOversize: "truncate" });
    if (meta.status >= 400) {
      return {
        ok: false, error: `HTTP ${meta.status} ${meta.statusText}`.trim(),
        status: meta.status, finalUrl: finalUrl.href,
        bodyPreview: body.length ? body.toString("utf8").slice(0, 2_000) : undefined,
      };
    }
    const sniff = sniffContent(body, meta.contentType);
    const textual = sniff.kind === "html" || sniff.kind === "json" || sniff.kind === "xml" || sniff.kind === "text";
    const truncated = body.length >= maxBytes;
    const base: Record<string, unknown> = {
      ok: true,
      url: url.href,
      finalUrl: finalUrl.href,
      redirectCount,
      status: meta.status,
      declaredContentType: meta.contentType,
      detectedContentType: sniff.mime,
      detectedKind: sniff.kind,
      sizeBytes: body.length,
      truncated,
      ...(sniff.image ? { image: sniff.image } : {}),
      sha256: hashOf(body),
    };
    if (!textual) {
      // Not something the model can read: say what it is, offer download.
      return {
        ...base,
        note: sniff.kind === "pdf"
          ? "PDF content — use resource_download to store it, then resource_extract_pdf_text to read it."
          : sniff.kind === "image"
          ? "Binary image content — use resource_download to store it in the workspace."
          : "Binary content — use resource_download to store it in the workspace.",
        bodyPreview: body.subarray(0, 256).toString("latin1").replace(/[^\x20-\x7e\n]/g, "·"),
      };
    }
    const text = body.toString("utf8");
    if (sniff.kind === "html") {
      const extracted = extractFromHtml(text, finalUrl.href);
      return {
        ...base,
        title: extracted.title,
        description: extracted.description,
        canonical: extracted.canonical,
        text: boundedText(extracted.text),
        linkCount: extracted.links.length,
        links: extracted.links.slice(0, 60),
        imageCount: extracted.images.length,
        images: extracted.images.slice(0, 30),
        linksTruncated: extracted.links.length > 60 || truncated,
      };
    }
    return { ...base, text: boundedText(text) };
  } catch (error) {
    return mapNetworkError(error);
  }
}

function boundedText(text: string): string {
  return text.length > RESOURCE_TEXT_CHARS ? text.slice(0, RESOURCE_TEXT_CHARS) + "\n[truncated]" : text;
}

function timeoutFrom(args: Record<string, unknown>): number {
  const raw = args.timeoutMs;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) return 20_000;
  return Math.min(Math.max(raw, 1_000), 45_000);
}

/** resource_download: streaming, atomic, sandboxed. */
async function resourceDownload(workspace: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  let tmpAbsolute: string | null = null;
  try {
    const url = validateUrl(args.url);
    const timeoutMs = timeoutFrom(args);
    const streamed = await guardedStream(url, { timeoutMs, signal });
    const { meta, finalUrl } = streamed;
    if (meta.status >= 400) {
      await streamed.consume(() => {}, 64 * 1024).catch(() => {});
      return { ok: false, error: `HTTP ${meta.status} ${meta.statusText}`.trim(), status: meta.status };
    }
    if (meta.contentLength != null && meta.contentLength > RESOURCE_DOWNLOAD_BYTES) {
      return { ok: false, error: `resource is ${meta.contentLength} bytes; downloads are capped at ${RESOURCE_DOWNLOAD_BYTES}` };
    }
    // Sweep stale .part files from killed runs (SIGKILL leaves no finally).
    try {
      const tmpDir = resolveInside(workspace, ".tmp");
      for (const entry of await readdir(tmpDir).catch(() => [] as string[])) {
        if (!entry.endsWith(".part")) continue;
        const stale = await stat(join(tmpDir, entry)).catch(() => null);
        if (stale && Date.now() - stale.mtimeMs > 3_600_000) {
          await rm(join(tmpDir, entry), { force: true });
        }
      }
    } catch { /* hygiene, never fatal */ }
    // The first bytes decide sniffing + extension; the rest streams to
    // disk. Chunks accumulate into headBuf until the sniff, so a tiny first
    // chunk cannot mislabel the file.
    let headBuf: Buffer = Buffer.alloc(0);
    let sniff: Sniff | null = null;
    const tmpName = `.tmp/download-${Date.now()}-${process.pid}.part`;
    const tmpResolved = resolveInside(workspace, tmpName);
    tmpAbsolute = tmpResolved;
    await mkdir(join(tmpResolved, ".."), { recursive: true });
    const handle = createWriteStream(tmpResolved, { flags: "wx" });
    let total = 0;
    const write = async (chunk: Buffer) => {
      if (!sniff) {
        headBuf = Buffer.concat([headBuf, chunk]);
        // 24 bytes: enough for the PNG IHDR check; end-of-stream re-sniffs
        // with whatever arrived for smaller files.
        if (headBuf.length >= 24) sniff = sniffContent(headBuf.subarray(0, 4_096), meta.contentType);
      }
      total += chunk.length;
      if (!handle.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          handle.once("drain", resolve);
          handle.once("error", reject);
        });
      }
    };
    try {
      await streamed.consume(write, RESOURCE_DOWNLOAD_BYTES);
    } catch (error) {
      handle.destroy();
      await unlink(tmpResolved).catch(() => {});
      tmpAbsolute = null;
      throw error;
    }
    await new Promise<void>((resolve, reject) => {
      handle.end(() => resolve());
      handle.once("error", reject);
    });
    if (sniff === null) sniff = sniffContent(headBuf, meta.contentType);
    const effectiveSniff: Sniff = sniff;
    // Content-Length disagreement is information, not an error.
    const declaredSize = meta.contentLength;
    const sizeMismatch = declaredSize != null && declaredSize !== total;
    const hash = await sha256File(tmpResolved);
    // Name: caller's logical name (already sanitized) > server name > URL >
    // generated. All paths resolve through the sandbox either way.
    const requested = typeof args.path === "string" ? sanitizeFilename(basename(args.path.replace(/\\/g, "/"))) : null;
    const serverName = filenameFromResponse(finalUrl, meta.contentDisposition);
    const name = requested ?? serverName ?? generatedFilename(effectiveSniff, finalUrl, hash);
    const { absolute, relative } = await uniqueDownloadPath(workspace, name);
    await rename(tmpResolved, absolute);
    tmpAbsolute = null;
    await recordArtifact(workspace, {
      path: relative,
      url: url.href,
      finalUrl: finalUrl.href,
      mimeType: effectiveSniff.mime,
      sizeBytes: total,
      sha256: hash,
      fetchedAtMs: Date.now(),
      contentKind: effectiveSniff.kind,
    });
    return {
      ok: true,
      path: relative,
      url: url.href,
      finalUrl: finalUrl.href,
      redirectCount: streamed.redirectCount,
      status: meta.status,
      declaredContentType: meta.contentType,
      detectedContentType: effectiveSniff.mime,
      detectedKind: effectiveSniff.kind,
      sizeBytes: total,
      ...(declaredSize != null ? { declaredSizeBytes: declaredSize, ...(sizeMismatch ? { sizeMismatch: true } : {}) } : {}),
      sha256: hash,
      ...(effectiveSniff.image ? { image: effectiveSniff.image } : {}),
      note: effectiveSniff.kind === "pdf"
        ? "PDF stored. Use resource_extract_pdf_text on this path to read it."
        : effectiveSniff.kind === "binary"
        ? "Stored, but this format cannot be read as text by the resource extractor."
        : undefined,
    };
  } catch (error) {
    if (tmpAbsolute) await rm(tmpAbsolute, { force: true }).catch(() => {});
    return mapNetworkError(error);
  }
}

/** resource_extract_pdf_text: bounded page-range extraction from a stored PDF. */
async function resourcePdfText(workspace: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const relative = typeof args.path === "string" ? args.path : "";
    if (!relative) return { ok: false, error: "path is required" };
    const absolute = resolveInside(workspace, relative);
    const info = await stat(absolute).catch(() => null);
    if (!info) return { ok: false, error: `no such file: ${relative}` };
    if (info.size > RESOURCE_PDF_BYTES) {
      return { ok: false, error: `PDF is ${info.size} bytes; text extraction is capped at ${RESOURCE_PDF_BYTES} bytes` };
    }
    const head = Buffer.alloc(5);
    const { open } = await import("node:fs/promises");
    const handle = await open(absolute, "r");
    try {
      await handle.read(head, 0, 5, 0);
    } finally {
      await handle.close();
    }
    if (head.toString("latin1") !== "%PDF-") {
      return { ok: false, error: "file does not start with a PDF signature; not a PDF" };
    }
    const from = typeof args.fromPage === "number" && Number.isSafeInteger(args.fromPage) ? args.fromPage : undefined;
    const to = typeof args.toPage === "number" && Number.isSafeInteger(args.toPage) ? args.toPage : undefined;
    const result = await extractPdfText(absolute, { from, to });
    const meta = await pdfMetadata(absolute).catch(() => null);
    const extractable = result.text.replace(/\s/g, "").length > 0;
    return {
      ok: true,
      path: relative,
      pages: meta?.pages ?? null,
      extractedPages: result.pages,
      extractedChars: result.text.length,
      truncated: result.truncated,
      hasExtractableText: extractable,
      ...(extractable ? {} : { note: "PDF stored successfully, but it contains no directly extractable text (likely a scanned/image PDF). OCR is not available on this device." }),
      text: result.text.slice(0, RESOURCE_PDF_TEXT_CHARS),
    };
  } catch (error) {
    if (error instanceof SandboxError) return { ok: false, error: error.message };
    return { ok: false, error: `PDF extraction failed: ${describeNetworkError(error)}` };
  }
}

/** resource_extract_links: links/images from an HTML URL (or a stored HTML file). */
async function resourceExtractLinks(workspace: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  try {
    let html: string;
    let baseUrl: string;
    if (typeof args.path === "string" && args.path) {
      const absolute = resolveInside(workspace, args.path);
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(absolute);
      if (buf.length > RESOURCE_FETCH_BYTES) return { ok: false, error: `stored file is ${buf.length} bytes; link extraction is capped at ${RESOURCE_FETCH_BYTES}` };
      html = buf.toString("utf8");
      baseUrl = typeof args.url === "string" && args.url ? validateUrl(args.url).href : `file://${basename(absolute)}`;
      if (baseUrl.startsWith("file://")) baseUrl = "https://localhost.invalid/";
    } else if (typeof args.url === "string" && args.url) {
      const url = validateUrl(args.url);
      const { meta, finalUrl, body } = await guardedRequest(url, { method: "GET", maxBodyBytes: RESOURCE_FETCH_BYTES, timeoutMs: timeoutFrom(args), signal });
      if (meta.status >= 400) return { ok: false, error: `HTTP ${meta.status} ${meta.statusText}`.trim(), status: meta.status };
      html = body.toString("utf8");
      baseUrl = finalUrl.href;
    } else {
      return { ok: false, error: "url or path is required" };
    }
    const extracted = extractFromHtml(html, baseUrl);
    const filter = typeof args.filter === "string" ? args.filter.toLowerCase() : "";
    const kindFilter = typeof args.kind === "string" ? args.kind.toLowerCase() : "";
    let links = extracted.links;
    if (kindFilter === "downloads" || kindFilter === "downloadable") links = links.filter((link) => link.looksDownloadable);
    if (kindFilter === "same-origin") links = links.filter((link) => link.sameOrigin);
    if (kindFilter === "external") links = links.filter((link) => !link.sameOrigin);
    if (filter) links = links.filter((link) => (link.text + " " + link.url).toLowerCase().includes(filter));
    return {
      ok: true,
      baseUrl,
      title: extracted.title,
      description: extracted.description,
      links,
      totalLinks: extracted.links.length,
      truncated: extracted.links.length > RESOURCE_MAX_LINKS,
      images: extracted.images,
      totalImages: extracted.images.length,
      imagesTruncated: extracted.images.length > RESOURCE_MAX_LINKS,
    };
  } catch (error) {
    return mapNetworkError(error);
  }
}

/** resource_artifact_info: describe a stored file (declared vs detected, PDF pages, image dims). */
async function resourceArtifactInfo(workspace: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    return await artifactInfo(workspace, args);
  } catch (error) {
    if (error instanceof SandboxError) return { ok: false, error: error.message };
    return { ok: false, error: describeNetworkError(error) };
  }
}

/** resource_list: the bot's artifact manifest (what was downloaded, from where). */
async function resourceList(workspace: string): Promise<Record<string, unknown>> {
  const artifacts = await readManifest(workspace);
  return {
    ok: true,
    count: artifacts.length,
    artifacts: artifacts.slice(-100).reverse().map((record) => ({
      path: record.path,
      url: record.url,
      finalUrl: record.finalUrl,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256.slice(0, 16),
      fetchedAtMs: record.fetchedAtMs,
      contentKind: record.contentKind,
    })),
  };
}

// ── tool table (wired into android-computer.ts TOOLS) ───────────────────────

export interface ResourceToolSpec {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (workspace: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

const PATH_PROP = { type: "string", description: "Workspace-relative path of a stored file (from resource_download)" } as const;

export const RESOURCE_TOOLS: Record<string, ResourceToolSpec> = {
  resource_inspect: {
    description: "Inspect a remote resource's metadata WITHOUT downloading it: final URL after redirects, status, content type, size, suggested filename, ETag/Last-Modified. Use to decide whether fetching or downloading is worthwhile.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, timeoutMs: { type: "integer" } }, required: ["url"] },
    handler: (_workspace, args, signal) => resourceInspect(args, signal),
  },
  resource_fetch: {
    description: "Fetch a URL for reading (bounded to 1MB): page text/metadata/links for HTML, raw text/JSON/XML for text resources. Binary types are detected but not returned — download those instead. Private/loopback addresses are refused.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, timeoutMs: { type: "integer" } }, required: ["url"] },
    handler: (_workspace, args, signal) => resourceFetch(args, signal),
  },
  resource_download: {
    description: `Download a URL into the bot's workspace (streamed, capped at ${Math.round(RESOURCE_DOWNLOAD_BYTES / 1024 / 1024)}MB) and register it as an artifact. Optionally pass a logical filename (workspace-relative under downloads/); server filenames are sanitized regardless. Returns the stored path, detected content type, size and checksum.`,
    inputSchema: { type: "object", properties: { url: { type: "string" }, path: { type: "string", description: "Optional logical filename inside the bot's downloads folder" }, timeoutMs: { type: "integer" } }, required: ["url"] },
    handler: (workspace, args, signal) => resourceDownload(workspace, args, signal),
  },
  resource_extract_pdf_text: {
    description: "Extract text from a stored PDF artifact (from resource_download), optionally a page range (fromPage/toPage). Reports scanned/image-only PDFs honestly instead of inventing text.",
    inputSchema: { type: "object", properties: { path: PATH_PROP, fromPage: { type: "integer", minimum: 1 }, toPage: { type: "integer", minimum: 1 } }, required: ["path"] },
    handler: (workspace, args) => resourcePdfText(workspace, args),
  },
  resource_extract_links: {
    description: "Extract links (and images) from an HTML page by URL, or from a stored HTML file (path + url base). Filter with kind=same-origin|external|downloads and a text filter. Use browser tools instead when a page needs JavaScript rendering.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, path: { type: "string", description: "Stored HTML file to parse instead of fetching" }, kind: { type: "string", enum: ["same-origin", "external", "downloads"] }, filter: { type: "string" }, timeoutMs: { type: "integer" } } },
    handler: (workspace, args, signal) => resourceExtractLinks(workspace, args, signal),
  },
  resource_artifact_info: {
    description: "Describe a stored file: size, detected content type (magic bytes, not just the declared type), image dimensions, PDF page count and text-extractability, plus the source URL and checksum when it was downloaded.",
    inputSchema: { type: "object", properties: { path: PATH_PROP }, required: ["path"] },
    handler: (workspace, args) => resourceArtifactInfo(workspace, args),
  },
  resource_list: {
    description: "List the bot's downloaded artifacts (path, source URL, type, size, checksum) from the workspace manifest.",
    inputSchema: { type: "object", properties: {} },
    handler: (workspace) => resourceList(workspace),
  },
};
