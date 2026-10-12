// Turn-time file ingestion for attached documents.
//
// The composer delivers a PDF as an <attached-file> transport tag pointing at
// the private attachments dir. Images already have a turn pipeline
// (turn-images.ts); documents had none — on the Android host no tool can reach
// ATTACHMENTS_DIR, so the model saw the tag and nothing else, and "uploading a
// PDF" silently did nothing. This module gives the current message's document
// tags the same treatment images get: bounded, in-process extraction with the
// result injected into the prompt text, honestly marked when it fails.
//
// The document is MODEL CONTEXT, never chat: the transcript shows one
// acknowledgment line, the text rides behind document markers, and the model
// is told to acknowledge briefly when the attachment carried no question.
// Page markers preserve citations. A PDF far larger than the inline budget is
// offered as an outline plus a read_document_pages tool, so big documents are
// retrieved on demand instead of truncated mid-page and presented as whole.
//
// Security posture mirrors turn-images.ts: only exact standalone tags from the
// CURRENT message are resolved; the path must name a bare, already-committed
// file inside ATTACHMENTS_DIR (no separators, no traversal — readAttachment's
// discipline, widened to document extensions); extraction is capped in bytes,
// pages and characters; failure text is honest, never invented content.

import { statSync } from "node:fs";

import { ATTACHMENTS_DIR } from "./attachments.ts";
import { RESOURCE_MAX_PDF_PAGES, RESOURCE_PDF_TEXT_CHARS } from "./android-resources.ts";

/** Matches the composer's standalone <attached-file> tag exactly. */
const FILE_TAG =
  /^<attached-file[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>$/;

/** The path attribute is always the on-disk UUID name the upload route returned. */
const OWNED_FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|txt|md|csv|tsv|json|rtf)$/;

export const TURN_FILE_MAX_COUNT = 4;
export const TURN_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** One attached document contributes at most this many characters of context. */
export const TURN_FILE_TEXT_CHARS = 60_000;

/**
 * A PDF this much larger than the inline budget is offered to the model as an
 * outline plus a read tool, rather than truncated mid-page: a truncated
 * contract reads whole, and the model cannot know it only saw the front.
 */
export const TURN_FILE_LARGE_PDF_CHARS = 240_000;
/** One read_document_pages call returns at most this many characters. */
export const TURN_FILE_PAGE_READ_CHARS = 30_000;

/** A tool the turn's driver should offer alongside the injected context. */
export interface TurnFileTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface TurnFileInput {
  name: string;
  mime: string;
  /** The bytes as the protocol wants them (base64 for PDF-native providers). */
  data: Buffer;
}

export interface ExtractedFile {
  /** The tag this came from, removed from the prompt either way. */
  tag: string;
  displayName: string;
  /** Human-readable summary block injected in place of the tag. */
  context: string;
  input: TurnFileInput | null;
  error: string | null;
}

/** Decode exactly the entities the composer writes (see turn-images.ts). */
function decodeAttachmentAttribute(value: string): string {
  return value.replace(
    /&(quot|lt|gt|amp);|&#(9|10|13);/g,
    (entity, named: string | undefined, numeric: string | undefined) => {
      if (numeric === "9") return "\t";
      if (numeric === "10") return "\n";
      if (numeric === "13") return "\r";
      if (named === "quot") return '"';
      if (named === "lt") return "<";
      if (named === "gt") return ">";
      if (named === "amp") return "&";
      return entity;
    },
  );
}

function ownedAttachmentPath(rawPath: string): string | null {
  const name = decodeAttachmentAttribute(rawPath);
  if (!OWNED_FILE_NAME.test(name)) return null;
  const path = `${ATTACHMENTS_DIR}/${name}`;
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  return path;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

async function readPdfPages(
  path: string,
): Promise<{ pages: string[]; numPages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(path);
  if (data.byteLength > TURN_FILE_MAX_BYTES) {
    throw new Error(`PDF is ${Math.round(data.byteLength / 1_000_000)} MB; attachments are capped at ${Math.round(TURN_FILE_MAX_BYTES / 1_000_000)} MB`);
  }
  const pdf = await getDocumentProxy(new Uint8Array(data));
  if (pdf.numPages > RESOURCE_MAX_PDF_PAGES) {
    throw new Error(`PDF has ${pdf.numPages} pages; extraction is capped at ${RESOURCE_MAX_PDF_PAGES} pages — try splitting the document`);
  }
  const { text } = await extractText(pdf, { mergePages: false });
  return { pages: text, numPages: pdf.numPages };
}

/** Format column-aligned tabular lines into structured markdown tables where detected. */
export function formatTabularText(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let tableBuffer: string[][] = [];

  function flushTable() {
    if (tableBuffer.length === 0) return;
    if (tableBuffer.length >= 2) {
      const colCount = Math.max(...tableBuffer.map((r) => r.length));
      if (colCount >= 2) {
        const header = tableBuffer[0]!;
        while (header.length < colCount) header.push("");
        result.push("| " + header.join(" | ") + " |");
        result.push("| " + header.map(() => "---").join(" | ") + " |");
        for (let i = 1; i < tableBuffer.length; i++) {
          const row = tableBuffer[i]!;
          while (row.length < colCount) row.push("");
          result.push("| " + row.join(" | ") + " |");
        }
        tableBuffer = [];
        return;
      }
    }
    for (const row of tableBuffer) {
      result.push(row.join("   "));
    }
    tableBuffer = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushTable();
      result.push(line);
      continue;
    }
    const cells = trimmed.split(/\t+|\s{3,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && !trimmed.startsWith("#") && !trimmed.startsWith("-") && !trimmed.startsWith("*") && !trimmed.startsWith("|")) {
      tableBuffer.push(cells);
    } else {
      flushTable();
      result.push(line);
    }
  }
  flushTable();
  return result.join("\n");
}

/** Join page texts with per-page markers so a model can cite page numbers. */
function joinPagesWithMarkers(pages: string[]): string {
  return pages
    .map((pageText, index) => `[page ${index + 1}]\n${formatTabularText(pageText).trim()}`)
    .join("\n\n");
}

/** Collapse page texts into the outline shown instead of a full large PDF. */
function pdfOutline(pages: string[]): string {
  const lines: string[] = [];
  for (const [index, pageText] of pages.entries()) {
    const heading = pageText
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length >= 8 && line.length <= 120);
    lines.push(`- page ${index + 1}: ${heading ?? "(no extractable text on this page)"}`);
  }
  return lines.join("\n");
}

/** A parse or size failure restated as the action that fixes it. */
function friendlyDocumentError(extension: string, message: string): string {
  if (extension === ".pdf") {
    if (/password|encrypt/i.test(message)) {
      return "This PDF is password-protected. Remove the password and attach it again.";
    }
    if (/bytes|capped at \d+ MB/i.test(message)) {
      return `${message}. A smaller export usually works.`;
    }
    if (/corrupt|structure|invalid|parse|XRef|provider/i.test(message)) {
      return "This PDF could not be parsed — the file may be damaged or not really a PDF. Re-export it and attach it again.";
    }
    return message;
  }
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x08\x0E-\x1F]/.test(message) || /could not be decoded|invalid utf/i.test(message)) {
    return "This file is not readable text in the expected encoding — try attaching it in a text format.";
  }
  return message;
}

/** Plain-text documents pass through with the same character cap. */
function readTextDocument(path: string, _extension: string): { text: string; truncated: boolean } {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  const truncated = text.length > TURN_FILE_TEXT_CHARS;
  return { text: truncated ? text.slice(0, TURN_FILE_TEXT_CHARS) : text, truncated };
}

interface PdfContext {
  /** The text (or outline) injected into the prompt. */
  context: string;
  /** The key the model passes to read_document_pages, when offered. */
  retrievalKey: string | null;
  /** Page count, for receipts and honesty notes. */
  pages: number;
  /** True when only an outline was injected. */
  outlineOnly: boolean;
}

/** Documents registered for this message's read_document_pages tool. */
const documentRegistry = new Map<string, RegisteredDocument>();

export interface RegisteredDocument {
  name: string;
  kind: "pdf" | "text";
  pages: string[] | null;
  text: string | null;
  registeredAt: number;
}

/** Bounded window into one registered document, pages inclusive on both ends. */
export function readDocumentPages(key: string, from: number, to: number): string {
  const document = documentRegistry.get(key);
  if (!document) {
    return `Error: no document is registered under "${key}". Attachments are available during the message that carries them; ask the user to attach it again.`;
  }
  if (document.kind !== "pdf" || !document.pages) {
    return `Error: "${document.name}" is a plain-text document; its full text is already in this conversation.`;
  }
  const total = document.pages.length;
  const first = Math.max(1, Math.floor(from));
  const last = Math.min(total, Math.floor(to));
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) {
    return `Error: give a page range from 1 to ${total}.`;
  }
  let budget = TURN_FILE_PAGE_READ_CHARS;
  const chunks: string[] = [];
  for (let page = first; page <= last && budget > 0; page += 1) {
    const body = document.pages[page - 1].trim() || "(no extractable text on this page)";
    const piece = body.length > budget ? body.slice(0, budget) : body;
    budget -= piece.length;
    chunks.push(`[page ${page} of ${total}]\n${piece}`);
    if (piece.length < body.length) break;
  }
  const suffix = last < total
    ? `\n[pages ${last + 1}-${total} not included; call read_document_pages with from_page ${last + 1} for more]`
    : "";
  return chunks.join("\n\n") + suffix;
}

export function resetTurnDocumentRegistry(): void {
  documentRegistry.clear();
}

/** Number of entries currently registered (test seam; bounded by TURN_FILE_MAX_COUNT). */
export function turnDocumentRegistrySize(): number {
  return documentRegistry.size;
}

/** Per-document retrieval key for read_document_pages. */
function documentKey(displayName: string, ordinal: number): string {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "document";
  return ordinal === 1 ? slug : `${slug}-${ordinal}`;
}

/** One distinguishing suffix attempt per collision; caps stay bounded. */
function uniqueDocumentKey(displayName: string, ordinal: number): string {
  const base = documentKey(displayName, ordinal);
  if (!documentRegistry.has(base)) return base;
  for (let suffix = 2; suffix <= 9; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!documentRegistry.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Compose one document's context block: acknowledged in the transcript, with
 * the text itself riding in the prompt behind a marker — model context, not
 * chat. Large PDFs get an outline plus a bounded read tool instead of a
 * truncated front half presented as the whole document.
 */
function buildTurnFileContext(
  displayName: string,
  pdf: PdfContext | null,
  textDocument: { text: string; truncated?: boolean } | null,
): string {
  const label = `"${displayName}"`;
  if (pdf) {
    if (pdf.outlineOnly) {
      return [
        `[attached document ${label}: ${pdf.pages} pages — the full text is too long to include, so here is a per-page outline instead.]`,
        `To read any part of it, call the read_document_pages tool with document "${pdf.retrievalKey}" and a page range (up to ~30,000 characters per call). Answer naturally and cite page numbers from the markers when referencing content (e.g. (p. 1) or [p. 1]). Do NOT dump raw page text into chat. If comparing documents, keep each document clearly distinguished.`,
        `---BEGIN DOCUMENT OUTLINE ${label}---`,
        pdf.context,
        `---END DOCUMENT OUTLINE ${label}---`,
      ].join("\n");
    }
    return [
      `[attached document ${label}: ${pdf.pages} pages. Answer naturally, directly, and concisely using the document content — do NOT dump raw or extracted blocks of text into chat. When citing facts, figures, tables, or claims, cite the exact page number (e.g. (p. 1) or [p. 1]). If multiple documents are attached, keep references to each document clearly distinguished. If the user's message asks nothing specific, respond with a brief natural acknowledgment — one or two sentences — instead of reciting the document.]`,
      `---BEGIN DOCUMENT ${label}---`,
      pdf.context,
      `---END DOCUMENT ${label}---`,
    ].join("\n");
  }
  const text = textDocument?.text ?? "";
  const note = textDocument?.truncated
    ? `[attached document ${label} (text truncated at ${TURN_FILE_TEXT_CHARS} characters). If the user's message asks nothing specific, respond with a brief natural acknowledgment instead of reciting the document.]`
    : `[attached document ${label}. If the user's message asks nothing specific, respond with a brief natural acknowledgment instead of reciting the document.]`;
  return [
    note,
    `---BEGIN DOCUMENT ${label}---`,
    text,
    `---END DOCUMENT ${label}---`,
  ].join("\n");
}

/**
 * Pull every standalone <attached-file> tag out of one message's text and turn
 * it into bounded model context. The returned text has every recognized tag
 * replaced by the context block (or by an honest failure note); unrecognized
 * tags are left untouched, exactly as before. `tools` carries the retrieval
 * tools the turn's driver should offer the model (large-PDF page reads).
 */
export async function extractTurnFiles(text: string): Promise<{
  text: string;
  files: ExtractedFile[];
  tools: TurnFileTool[];
}> {
  if (!text.includes("<attached-file")) return { text, files: [], tools: [] };
  const files: ExtractedFile[] = [];
  const tools: TurnFileTool[] = [];
  const lines = text.split("\n");
  const out: string[] = [];
  let admitted = 0;
  let pdfOrdinal = 0;
  for (const line of lines) {
    const m = FILE_TAG.exec(line.trim());
    if (!m) {
      out.push(line);
      continue;
    }
    const tag = line.trim();
    const displayName = (m[2] ? decodeAttachmentAttribute(m[2]) : "") || "document";
    if (admitted >= TURN_FILE_MAX_COUNT) {
      files.push({
        tag,
        displayName,
        context: "",
        input: null,
        error: `At most ${TURN_FILE_MAX_COUNT} documents can be read per message.`,
      });
      out.push(`[attached document "${displayName}" was not read: too many attachments in one message]`);
      continue;
    }
    const path = ownedAttachmentPath(m[1] ?? "");
    if (!path) {
      files.push({ tag, displayName, context: "", input: null, error: "the attachment could not be located" });
      out.push(`[attached document "${displayName}" could not be opened. It may have been removed, or the upload did not finish — try attaching it again.]`);
      continue;
    }
    admitted += 1;
    const extension = extensionOf(path);
    try {
      if (extension === ".pdf") {
        pdfOrdinal += 1;
        const { pages, numPages } = await readPdfPages(path);
        const body = joinPagesWithMarkers(pages);
        if (body.replace(/\[page \d+\]/g, "").trim().length === 0) {
          files.push({
            tag,
            displayName,
            context: "",
            input: null,
            error:
              "This PDF appears to be scanned or image-based. No text layer was found and OCR is not available, so its contents cannot be read automatically — a text-based export would work.",
          });
          out.push(
            `[attached document "${displayName}": ${numPages} pages. This PDF appears to be scanned or image-based — no text layer was found, so its contents are not available to the model. OCR is not available; a text-based export would work.]`,
          );
          continue;
        }
        const outlineOnly = body.length > TURN_FILE_LARGE_PDF_CHARS;
        const key = outlineOnly ? uniqueDocumentKey(displayName, pdfOrdinal) : null;
        if (key) {
          documentRegistry.set(key, { name: displayName, kind: "pdf", pages, text: null, registeredAt: Date.now() });
          tools.push({
            name: "read_document_pages",
            description:
              "Read pages of an attached PDF. Returns the text of the requested pages, each headed with its page number.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                document: { type: "string", description: "The document key named on the attached document." },
                from_page: { type: "integer", minimum: 1, description: "First page to read." },
                to_page: { type: "integer", minimum: 1, description: "Last page to read (inclusive)." },
              },
              required: ["document", "from_page", "to_page"],
            },
          });
        }
        const context = buildTurnFileContext(displayName, {
          context: outlineOnly ? pdfOutline(pages) : body.slice(0, TURN_FILE_TEXT_CHARS),
          retrievalKey: key,
          pages: numPages,
          outlineOnly,
        }, null);
        files.push({ tag, displayName, context, input: null, error: null });
        out.push(context);
      } else {
        const { text: docText, truncated } = readTextDocument(path, extension);
        files.push({ tag, displayName, context: docText, input: null, error: null });
        out.push(buildTurnFileContext(displayName, null, { text: docText, truncated }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const friendly = friendlyDocumentError(extension, message);
      files.push({ tag, displayName, context: "", input: null, error: friendly });
      out.push(`[attached document "${displayName}" could not be read: ${friendly}]`);
    }
  }
  return { text: out.join("\n"), files, tools };
}

/** Kept for the byte-cap symmetry assertion in tests. */
export const TURN_FILE_LIMITS = {
  maxCount: TURN_FILE_MAX_COUNT,
  maxBytes: TURN_FILE_MAX_BYTES,
  maxChars: TURN_FILE_TEXT_CHARS,
  pdfTextChars: RESOURCE_PDF_TEXT_CHARS,
  pdfPages: RESOURCE_MAX_PDF_PAGES,
  fileMimes: null,
} as const;
