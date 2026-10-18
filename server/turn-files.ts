// Turn-time file ingestion for attached documents.
//
// The composer delivers a PDF or document as an <attached-file> transport tag pointing at
// the private attachments dir. This module resolves app-owned document tags into bounded,
// in-process extraction with deterministic status lifecycle, cross-turn persistence,
// and first-class structured metadata.
//
// Hard Autonomy Invariant:
// NEVER ask the user to provide information that is already available through
// an attached file or previous conversation context. The agent must resolve and
// extract the document first, deriving candidate profile or document details directly.

import { statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as zlib from "node:zlib";

import { ATTACHMENTS_DIR } from "./attachments.ts";
import { RESOURCE_MAX_PDF_PAGES, RESOURCE_PDF_TEXT_CHARS } from "./android-resources.ts";

/** Matches the composer's standalone <attached-file> tag exactly. */
const FILE_TAG =
  /^<attached-file[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>$/;

/** The path attribute is always the on-disk UUID name the upload route returned. */
const OWNED_FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|txt|md|csv|tsv|json|rtf|docx|xlsx|doc|xls|pptx|ppt|odt|ods|odp)$/i;

export const TURN_FILE_MAX_COUNT = 4;
export const TURN_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** One attached document contributes at most this many characters of context. */
export const TURN_FILE_TEXT_CHARS = 60_000;

/**
 * A PDF this much larger than the inline budget is offered to the model as an
 * outline plus a read tool, rather than truncated mid-page.
 */
export const TURN_FILE_LARGE_PDF_CHARS = 240_000;
/** One read_document_pages call returns at most this many characters. */
export const TURN_FILE_PAGE_READ_CHARS = 30_000;

export type AttachmentStatus =
  | "AVAILABLE"
  | "PARSING"
  | "PARSED"
  | "UNAVAILABLE"
  | "FAILED"
  | "UNSUPPORTED";

export interface AttachmentMetadata {
  attachmentId: string;
  name: string;
  mime: string;
  size: number;
  status: AttachmentStatus;
  parser?: string;
  error?: string | null;
  pages?: number;
  extractedChars?: number;
  retrievalKey?: string | null;
}

/** A tool the turn's driver should offer alongside the injected context. */
export interface TurnFileTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface TurnFileInput {
  name: string;
  mime: string;
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
  metadata: AttachmentMetadata;
}

export interface ExtractTurnFilesOptions {
  threadId?: string;
  priorMessages?: Array<{
    role: string;
    text?: string;
    attachments?: Array<{ kind?: string; path: string; name?: string; mime?: string }>;
  }>;
}

/** Decode exactly the entities the composer writes (see turn-images.ts). */
export function decodeAttachmentAttribute(value: string): string {
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

export function ownedAttachmentPath(rawPath: string): string | null {
  const decoded = decodeAttachmentAttribute(rawPath);
  const name = decoded.split(/[\\/]/).at(-1) ?? "";
  if (!OWNED_FILE_NAME.test(name)) return null;
  const path = resolve(ATTACHMENTS_DIR, name);
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

function attachmentIdFromPath(path: string): string {
  const filename = path.split(/[\\/]/).at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? filename : filename.slice(0, dot);
}

function mimeFromExtension(extension: string): string {
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".json": "application/json",
    ".rtf": "application/rtf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".doc": "application/msword",
    ".xls": "application/vnd.ms-excel",
    ".ppt": "application/vnd.ms-powerpoint",
  };
  return map[extension] ?? "application/octet-stream";
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

/** Extract text from DOCX (Word) file by extracting word/document.xml from the ZIP package. */
export function readDocxDocument(path: string): { text: string; truncated: boolean } {
  const bytes = readFileSync(path);
  if (bytes.byteLength > TURN_FILE_MAX_BYTES) {
    throw new Error(`DOCX file is ${Math.round(bytes.byteLength / 1_000_000)} MB; attachments are capped at ${Math.round(TURN_FILE_MAX_BYTES / 1_000_000)} MB`);
  }

  let xmlBuffer: Buffer | null = null;

  // Local file headers pass
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig = bytes.readUInt32LE(offset);
    if (sig === 0x04034b50) {
      const method = bytes.readUInt16LE(offset + 8);
      const compSize = bytes.readUInt32LE(offset + 18);
      const nameLen = bytes.readUInt16LE(offset + 26);
      const extraLen = bytes.readUInt16LE(offset + 28);
      const name = bytes.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
      const dataOffset = offset + 30 + nameLen + extraLen;
      if (name === "word/document.xml" && dataOffset + compSize <= bytes.length) {
        const compData = bytes.subarray(dataOffset, dataOffset + compSize);
        if (method === 8) {
          xmlBuffer = zlib.inflateRawSync(compData);
        } else if (method === 0) {
          xmlBuffer = compData;
        }
        break;
      }
      offset = dataOffset + compSize;
    } else {
      break;
    }
  }

  // Central directory fallback if local header didn't locate word/document.xml
  if (!xmlBuffer) {
    const eocdSig = 0x06054b50;
    const maxSearch = Math.min(bytes.length, 65536 + 22);
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= bytes.length - maxSearch; i -= 1) {
      if (bytes.readUInt32LE(i) === eocdSig) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset !== -1) {
      const cdOffset = bytes.readUInt32LE(eocdOffset + 16);
      const cdCount = bytes.readUInt16LE(eocdOffset + 10);
      let cur = cdOffset;
      for (let i = 0; i < cdCount && cur + 46 <= bytes.length; i += 1) {
        if (bytes.readUInt32LE(cur) !== 0x02014b50) break;
        const method = bytes.readUInt16LE(cur + 10);
        const compSize = bytes.readUInt32LE(cur + 20);
        const nameLen = bytes.readUInt16LE(cur + 28);
        const extraLen = bytes.readUInt16LE(cur + 30);
        const commentLen = bytes.readUInt16LE(cur + 32);
        const localHeaderOffset = bytes.readUInt32LE(cur + 42);
        const name = bytes.subarray(cur + 46, cur + 46 + nameLen).toString("utf8");
        if (name === "word/document.xml" && localHeaderOffset + 30 <= bytes.length) {
          const localNameLen = bytes.readUInt16LE(localHeaderOffset + 26);
          const localExtraLen = bytes.readUInt16LE(localHeaderOffset + 28);
          const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
          if (dataOffset + compSize <= bytes.length) {
            const compData = bytes.subarray(dataOffset, dataOffset + compSize);
            if (method === 8) {
              xmlBuffer = zlib.inflateRawSync(compData);
            } else if (method === 0) {
              xmlBuffer = compData;
            }
          }
          break;
        }
        cur += 46 + nameLen + extraLen + commentLen;
      }
    }
  }

  if (!xmlBuffer) {
    throw new Error("Could not extract readable text from DOCX archive (missing word/document.xml).");
  }

  const xml = xmlBuffer.toString("utf8");
  const extracted = xml
    .replace(/<w:p\b[^>]*>/gi, "\n")
    .replace(/<w:tab\b[^>]*\/>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

  const truncated = extracted.length > TURN_FILE_TEXT_CHARS;
  const text = truncated ? extracted.slice(0, TURN_FILE_TEXT_CHARS) : extracted;
  return { text: formatTabularText(text), truncated };
}

function parseRtfText(rawRtf: string): string {
  let text = rawRtf.replace(/\\par[d]?\b|\\line\b/gi, "\n");
  text = text.replace(/\\tab\b/gi, "\t");
  text = text.replace(/\\[a-zA-Z]+(-?\d+)? ?/g, "");
  text = text.replace(/[{}]/g, "");
  return text.trim();
}

/** Format column-aligned tabular lines into structured markdown tables where detected. */
export function formatTabularText(text: string, extension?: string): string {
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
    const isCsv = extension === ".csv";
    const cells = isCsv
      ? trimmed.split(",").map((c) => c.trim()).filter(Boolean)
      : trimmed.split(/\t+|\s{3,}/).map((c) => c.trim()).filter(Boolean);
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
  if (extension === ".docx") {
    return `This Word document could not be read: ${message}`;
  }
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x08\x0E-\x1F]/.test(message) || /could not be decoded|invalid utf/i.test(message)) {
    return "This file is not readable text in the expected encoding — try attaching it in a text format.";
  }
  return message;
}

/** Plain-text documents pass through with the same character cap. */
function readTextDocument(path: string, extension: string): { text: string; truncated: boolean } {
  const bytes = readFileSync(path);
  let text = bytes.toString("utf8");
  if (extension === ".rtf") {
    text = parseRtfText(text);
  } else if (extension === ".csv" || extension === ".tsv") {
    text = formatTabularText(text, extension);
  }
  const truncated = text.length > TURN_FILE_TEXT_CHARS;
  return { text: truncated ? text.slice(0, TURN_FILE_TEXT_CHARS) : text, truncated };
}

interface PdfContext {
  context: string;
  retrievalKey: string | null;
  pages: number;
  outlineOnly: boolean;
}

export interface RegisteredDocument {
  id: string;
  name: string;
  path: string;
  kind: "pdf" | "text" | "docx";
  status: AttachmentStatus;
  pages: string[] | null;
  text: string | null;
  error: string | null;
  numPages?: number;
  retrievalKey: string | null;
  registeredAt: number;
  threadId?: string;
}

/** Documents registered for read_document_pages across turns. Retained across turns. */
const documentRegistry = new Map<string, RegisteredDocument>();
/** Document cache keyed by path/UUID. */
const documentCache = new Map<string, RegisteredDocument>();

/** Bounded window into one registered document, pages inclusive on both ends. */
export function readDocumentPages(key: string, from: number, to: number): string {
  const document = documentRegistry.get(key);
  if (!document) {
    return `Error: no document is registered under "${key}".`;
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
  documentCache.clear();
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
  isCrossTurn = false,
): string {
  const label = `"${displayName}"`;
  const headerPrefix = isCrossTurn
    ? `[PREVIOUSLY ATTACHED DOCUMENT ${label} (from conversation history)`
    : `[attached document ${label}`;

  const autonomyInstruction =
    "CORE AUTONOMY RULE: NEVER ask the user to provide information that is already available through this document or conversation context. Inspect and extract all relevant candidate profile details (skills, roles, experience, background) or document facts directly. If the user asked for recommendations, jobs, or next steps matching this document, do NOT ask how to provide the document or what their qualifications are; proceed directly with the task, or only ask targeted questions (via ask_user) for genuinely missing search constraints (e.g. preferred location, remote/in-person, target salary) that are NOT in the document.";

  if (pdf) {
    if (pdf.outlineOnly) {
      return [
        `${headerPrefix}: ${pdf.pages} pages (status: PARSED) — the full text is too long to include, so here is a per-page outline instead.]`,
        autonomyInstruction,
        `To read any part of it, call the read_document_pages tool with document "${pdf.retrievalKey}" and a page range (up to ~30,000 characters per call). Answer naturally and cite page numbers from the markers when referencing content (e.g. (p. 1) or [p. 1]). Do NOT dump raw page text into chat. If comparing documents, keep each document clearly distinguished.`,
        `---BEGIN DOCUMENT OUTLINE ${label}---`,
        pdf.context,
        `---END DOCUMENT OUTLINE ${label}---`,
      ].join("\n");
    }
    return [
      `${headerPrefix}: ${pdf.pages} pages. Answer naturally, directly, and concisely using the document content — do NOT dump raw or extracted blocks of text into chat. When citing facts, figures, tables, or claims, cite the exact page number (e.g. (p. 1) or [p. 1]). If multiple documents are attached, keep references to each document clearly distinguished. If the user's message asks nothing specific, respond with a brief natural acknowledgment — one or two sentences — instead of reciting the document.]`,
      autonomyInstruction,
      `---BEGIN DOCUMENT ${label}---`,
      pdf.context,
      `---END DOCUMENT ${label}---`,
    ].join("\n");
  }
  const text = textDocument?.text ?? "";
  const note = textDocument?.truncated
    ? `${headerPrefix} (text truncated at ${TURN_FILE_TEXT_CHARS} characters). If the user's message asks nothing specific, respond with a brief natural acknowledgment instead of reciting the document.]`
    : `${headerPrefix}. If the user's message asks nothing specific, respond with a brief natural acknowledgment instead of reciting the document.]`;
  return [
    note,
    autonomyInstruction,
    `---BEGIN DOCUMENT ${label}---`,
    text,
    `---END DOCUMENT ${label}---`,
  ].join("\n");
}

function createDocumentReadTool(_key?: string): TurnFileTool {
  return {
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
  };
}

/**
 * Pull every standalone <attached-file> tag out of one message's text and turn
 * it into bounded model context. Also resolves prior conversation attachments
 * across turns when options.priorMessages is supplied.
 */
export async function extractTurnFiles(
  text: string,
  options?: ExtractTurnFilesOptions,
): Promise<{
  text: string;
  files: ExtractedFile[];
  tools: TurnFileTool[];
}> {
  const files: ExtractedFile[] = [];
  const tools: TurnFileTool[] = [];
  let pdfOrdinal = 0;

  // 1. Process current turn message
  const hasCurrentTags = text.includes("<attached-file");
  let outText = text;

  if (hasCurrentTags) {
    const lines = text.split("\n");
    const out: string[] = [];
    let admitted = 0;

    for (const line of lines) {
      const m = FILE_TAG.exec(line.trim());
      if (!m) {
        out.push(line);
        continue;
      }
      const tag = line.trim();
      const displayName = (m[2] ? decodeAttachmentAttribute(m[2]) : "") || "document";
      const rawPath = m[1] ?? "";

      if (admitted >= TURN_FILE_MAX_COUNT) {
        const metadata: AttachmentMetadata = {
          attachmentId: attachmentIdFromPath(rawPath),
          name: displayName,
          mime: mimeFromExtension(extensionOf(rawPath)),
          size: 0,
          status: "FAILED",
          error: `At most ${TURN_FILE_MAX_COUNT} documents can be read per message.`,
        };
        files.push({
          tag,
          displayName,
          context: "",
          input: null,
          error: metadata.error ?? null,
          metadata,
        });
        out.push(`[attached document "${displayName}" was not read: too many attachments in one message]`);
        continue;
      }

      const path = ownedAttachmentPath(rawPath);
      if (!path) {
        const metadata: AttachmentMetadata = {
          attachmentId: attachmentIdFromPath(rawPath),
          name: displayName,
          mime: mimeFromExtension(extensionOf(rawPath)),
          size: 0,
          status: "UNAVAILABLE",
          error: "the attachment could not be located",
        };
        files.push({ tag, displayName, context: "", input: null, error: metadata.error ?? null, metadata });
        out.push(`[attached document "${displayName}" could not be opened. It may have been removed, or the upload did not finish — try attaching it again.]`);
        continue;
      }

      admitted += 1;
      const extension = extensionOf(path);
      const mime = mimeFromExtension(extension);
      const stat = statSync(path);
      const attId = attachmentIdFromPath(path);

      try {
        if (extension === ".pdf") {
          pdfOrdinal += 1;
          const { pages, numPages } = await readPdfPages(path);
          const body = joinPagesWithMarkers(pages);

          if (body.replace(/\[page \d+\]/g, "").trim().length === 0) {
            const errorMsg =
              "This PDF appears to be scanned or image-based. No text layer was found and OCR is not available, so its contents cannot be read automatically — a text-based export would work.";
            const metadata: AttachmentMetadata = {
              attachmentId: attId,
              name: displayName,
              mime,
              size: stat.size,
              status: "FAILED",
              pages: numPages,
              error: errorMsg,
            };
            files.push({
              tag,
              displayName,
              context: "",
              input: null,
              error: errorMsg,
              metadata,
            });
            out.push(
              `[attached document "${displayName}": ${numPages} pages. This PDF appears to be scanned or image-based — no text layer was found, so its contents are not available to the model. OCR is not available; a text-based export would work.]`,
            );
            continue;
          }

          const outlineOnly = body.length > TURN_FILE_LARGE_PDF_CHARS;
          const key = outlineOnly ? uniqueDocumentKey(displayName, pdfOrdinal) : null;
          if (key) {
            const registeredDoc: RegisteredDocument = {
              id: attId,
              name: displayName,
              path,
              kind: "pdf",
              status: "PARSED",
              pages,
              text: null,
              numPages,
              error: null,
              retrievalKey: key,
              registeredAt: Date.now(),
              threadId: options?.threadId,
            };
            documentRegistry.set(key, registeredDoc);
            documentCache.set(path, registeredDoc);
            tools.push(createDocumentReadTool(key));
          } else {
            documentCache.set(path, {
              id: attId,
              name: displayName,
              path,
              kind: "pdf",
              status: "PARSED",
              pages,
              text: body,
              numPages,
              error: null,
              retrievalKey: null,
              registeredAt: Date.now(),
              threadId: options?.threadId,
            });
          }

          const context = buildTurnFileContext(displayName, {
            context: outlineOnly ? pdfOutline(pages) : body.slice(0, TURN_FILE_TEXT_CHARS),
            retrievalKey: key,
            pages: numPages,
            outlineOnly,
          }, null);

          const metadata: AttachmentMetadata = {
            attachmentId: attId,
            name: displayName,
            mime,
            size: stat.size,
            status: "PARSED",
            parser: "unpdf",
            pages: numPages,
            extractedChars: body.length,
            retrievalKey: key,
          };

          files.push({ tag, displayName, context, input: null, error: null, metadata });
          out.push(context);
        } else if (extension === ".docx") {
          const { text: docText, truncated } = readDocxDocument(path);
          const metadata: AttachmentMetadata = {
            attachmentId: attId,
            name: displayName,
            mime,
            size: stat.size,
            status: "PARSED",
            parser: "docx-zip",
            extractedChars: docText.length,
          };
          documentCache.set(path, {
            id: attId,
            name: displayName,
            path,
            kind: "docx",
            status: "PARSED",
            pages: null,
            text: docText,
            error: null,
            retrievalKey: null,
            registeredAt: Date.now(),
            threadId: options?.threadId,
          });
          const context = buildTurnFileContext(displayName, null, { text: docText, truncated });
          files.push({ tag, displayName, context, input: null, error: null, metadata });
          out.push(context);
        } else {
          const { text: docText, truncated } = readTextDocument(path, extension);
          const metadata: AttachmentMetadata = {
            attachmentId: attId,
            name: displayName,
            mime,
            size: stat.size,
            status: "PARSED",
            parser: "text-utf8",
            extractedChars: docText.length,
          };
          documentCache.set(path, {
            id: attId,
            name: displayName,
            path,
            kind: "text",
            status: "PARSED",
            pages: null,
            text: docText,
            error: null,
            retrievalKey: null,
            registeredAt: Date.now(),
            threadId: options?.threadId,
          });
          const context = buildTurnFileContext(displayName, null, { text: docText, truncated });
          files.push({ tag, displayName, context, input: null, error: null, metadata });
          out.push(context);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const friendly = friendlyDocumentError(extension, message);
        const metadata: AttachmentMetadata = {
          attachmentId: attId,
          name: displayName,
          mime,
          size: stat.size,
          status: "FAILED",
          error: friendly,
        };
        files.push({ tag, displayName, context: "", input: null, error: friendly, metadata });
        out.push(`[attached document "${displayName}" could not be read: ${friendly}]`);
      }
    }
    outText = out.join("\n");
  }

  // 2. Cross-Turn Resolution: inspect prior messages for attachments in this conversation
  if (options?.priorMessages && options.priorMessages.length > 0) {
    const priorAttachments: Array<{ rawPath: string; name: string }> = [];
    const seenPaths = new Set<string>();

    for (let i = options.priorMessages.length - 1; i >= 0 && priorAttachments.length < TURN_FILE_MAX_COUNT; i -= 1) {
      const pm = options.priorMessages[i];
      if (pm.text && pm.text.includes("<attached-file")) {
        const pLines = pm.text.split("\n");
        for (const line of pLines) {
          const pmMatch = FILE_TAG.exec(line.trim());
          if (pmMatch) {
            const rawPath = pmMatch[1] ?? "";
            const name = (pmMatch[2] ? decodeAttachmentAttribute(pmMatch[2]) : "") || "document";
            if (!seenPaths.has(rawPath)) {
              seenPaths.add(rawPath);
              priorAttachments.push({ rawPath, name });
            }
          }
        }
      }
      if (pm.attachments && Array.isArray(pm.attachments)) {
        for (const att of pm.attachments) {
          if (att.kind === "file" || att.kind === "document" || att.kind === "pdf") {
            if (!seenPaths.has(att.path)) {
              seenPaths.add(att.path);
              priorAttachments.push({ rawPath: att.path, name: att.name || "document" });
            }
          }
        }
      }
    }

    if (priorAttachments.length > 0) {
      // Check if current message refers to prior attachments
      const refersToAttachment =
        /resume|cv|pdf|file|document|attachment|look at|sent you|uploaded|match|job|above|earlier/i.test(text);

      const crossTurnContexts: string[] = [];

      for (const prior of priorAttachments) {
        const path = ownedAttachmentPath(prior.rawPath);
        if (!path) continue;

        let cached = documentCache.get(path);
        const extension = extensionOf(path);
        const mime = mimeFromExtension(extension);
        const attId = attachmentIdFromPath(path);

        // If not in cache, parse it now
        if (!cached) {
          try {
            if (extension === ".pdf") {
              pdfOrdinal += 1;
              const { pages, numPages } = await readPdfPages(path);
              const body = joinPagesWithMarkers(pages);
              const outlineOnly = body.length > TURN_FILE_LARGE_PDF_CHARS;
              const key = outlineOnly ? uniqueDocumentKey(prior.name, pdfOrdinal) : null;
              cached = {
                id: attId,
                name: prior.name,
                path,
                kind: "pdf",
                status: "PARSED",
                pages,
                text: body,
                numPages,
                error: null,
                retrievalKey: key,
                registeredAt: Date.now(),
                threadId: options.threadId,
              };
              if (key) {
                documentRegistry.set(key, cached);
              }
              documentCache.set(path, cached);
            } else if (extension === ".docx") {
              const { text: docText } = readDocxDocument(path);
              cached = {
                id: attId,
                name: prior.name,
                path,
                kind: "docx",
                status: "PARSED",
                pages: null,
                text: docText,
                error: null,
                retrievalKey: null,
                registeredAt: Date.now(),
                threadId: options.threadId,
              };
              documentCache.set(path, cached);
            } else {
              const { text: docText } = readTextDocument(path, extension);
              cached = {
                id: attId,
                name: prior.name,
                path,
                kind: "text",
                status: "PARSED",
                pages: null,
                text: docText,
                error: null,
                retrievalKey: null,
                registeredAt: Date.now(),
                threadId: options.threadId,
              };
              documentCache.set(path, cached);
            }
          } catch {
            continue;
          }
        }

        if (cached && cached.status === "PARSED") {
          // Ensure retrieval tool is offered for large PDFs
          if (cached.retrievalKey) {
            tools.push(createDocumentReadTool(cached.retrievalKey));
          }

          // If current turn didn't attach any new file, make prior document accessible
          if (!hasCurrentTags) {
            const metadata: AttachmentMetadata = {
              attachmentId: cached.id,
              name: cached.name,
              mime,
              size: 0,
              status: "PARSED",
              pages: cached.numPages,
              retrievalKey: cached.retrievalKey,
            };

            if (cached.kind === "pdf" && cached.pages) {
              const outlineOnly = Boolean(cached.retrievalKey);
              const ctx = buildTurnFileContext(cached.name, {
                context: outlineOnly ? pdfOutline(cached.pages) : (cached.text ?? "").slice(0, TURN_FILE_TEXT_CHARS),
                retrievalKey: cached.retrievalKey,
                pages: cached.numPages ?? cached.pages.length,
                outlineOnly,
              }, null, true);

              files.push({
                tag: `<attached-file path="${prior.rawPath}" name="${cached.name}" />`,
                displayName: cached.name,
                context: ctx,
                input: null,
                error: null,
                metadata,
              });

              if (refersToAttachment) {
                crossTurnContexts.push(ctx);
              } else {
                crossTurnContexts.push(
                  `[available conversation attachment "${cached.name}" (${cached.numPages} pages, status: PARSED). Use read_document_pages or refer to it when relevant.]`,
                );
              }
            } else if (cached.text) {
              const ctx = buildTurnFileContext(cached.name, null, { text: cached.text }, true);
              files.push({
                tag: `<attached-file path="${prior.rawPath}" name="${cached.name}" />`,
                displayName: cached.name,
                context: ctx,
                input: null,
                error: null,
                metadata,
              });
              if (refersToAttachment) {
                crossTurnContexts.push(ctx);
              } else {
                crossTurnContexts.push(
                  `[available conversation attachment "${cached.name}" (status: PARSED). Refer to it when relevant.]`,
                );
              }
            }
          }
        }
      }

      if (crossTurnContexts.length > 0 && !hasCurrentTags) {
        outText = `${outText}\n\n${crossTurnContexts.join("\n\n")}`;
      }
    }
  }

  return { text: outText, files, tools };
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
