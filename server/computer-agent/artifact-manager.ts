// General Artifact Registry and Lifecycle Manager
// Implements general artifact handling across all kinds (image, pdf, document, code, archive, dataset, file)
// Follows CREATE/FETCH -> VALIDATE -> REGISTER -> DELIVER -> RENDER pipeline.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { ATTACHMENTS_DIR, ensureAttachmentsDir } from "../attachments.ts";
import { StaleWorkerFenceError, type FencingToken, sharedPersistentJobManager } from "../tasks.ts";

export function resolveWorkspacePath(p: string): string {
  if (!p) return p;
  if (isAbsolute(p)) return p;
  const ws = process.env.AC_WORKSPACE || process.cwd();
  return resolve(ws, p);
}

export type ArtifactVisibility = "internal" | "intermediate" | "user_visible" | "final";

export type ArtifactKind =
  | "image"
  | "pdf"
  | "document"
  | "code"
  | "archive"
  | "dataset"
  | "file";

export interface ArtifactMetadata {
  title?: string;
  description?: string;
  threadId?: string;
  turnId?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  format?: string;
  pageCount?: number;
  lineCount?: number;
  [key: string]: unknown;
}

export interface ArtifactRecord {
  id: string;
  name: string;
  kind: ArtifactKind;
  mime: string;
  sizeBytes: number;
  sha256: string;
  urlPath: string; // e.g. /api/attachments/<id>.<ext>
  localPath: string;
  createdAt: string;
  visibility: ArtifactVisibility;
  validationState?: "valid" | "invalid" | "unverified";
  deliveryState?: "registered" | "delivered" | "failed";
  metadata?: ArtifactMetadata;
}

export interface ArtifactValidationResult {
  valid: boolean;
  kind: ArtifactKind;
  mime: string;
  sizeBytes: number;
  sha256: string;
  error?: string;
  metadata?: ArtifactMetadata;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The media type Colab and Jupyter both recognise for a notebook file. */
export const NOTEBOOK_MIME = "application/x-ipynb+json";

const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(...buffers: Buffer[]): number {
  let crc = 0xffffffff;
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i++) {
      crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Validate PNG container framing (chunk lengths, chunk types, IHDR/IDAT/IEND
 * ordering, per-chunk CRC) and read the real IHDR dimensions.
 *
 * The 8-byte PNG signature only proves the file *starts* like a PNG. Hand-rolled
 * or truncated encoders produce files with the signature but with broken chunk
 * framing (displaced CRCs, shifted chunk types, zeroed checksums, absurd chunk
 * lengths). Those bytes cannot be decoded by any renderer, so they must never be
 * accepted as a valid image artifact.
 */
export function inspectPngContainer(
  buffer: Buffer,
): { ok: true; width: number; height: number } | { ok: false; error: string } {
  if (buffer.length < PNG_SIGNATURE.length + 25) {
    return { ok: false, error: `truncated PNG (${buffer.length} bytes)` };
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { ok: false, error: "missing PNG signature" };
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeBytes = buffer.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("latin1");

    if (!/^[A-Za-z]{4}$/.test(type)) {
      return { ok: false, error: `chunk at byte ${offset} has an invalid type (${JSON.stringify(type)})` };
    }
    if (length > 0x7fffffff) {
      return { ok: false, error: `${type} chunk at byte ${offset} declares an impossible length (${length} bytes)` };
    }
    if (offset + 12 + length > buffer.length) {
      return {
        ok: false,
        error: `${type} chunk at byte ${offset} declares ${length} bytes, past the end of the ${buffer.length}-byte file`,
      };
    }

    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const storedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(typeBytes, data);
    if (storedCrc !== actualCrc) {
      return { ok: false, error: `${type} chunk at byte ${offset} has an invalid checksum` };
    }

    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) {
        return { ok: false, error: `must start with a 13-byte IHDR chunk (found ${type}, ${length} bytes)` };
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width <= 0 || height <= 0) {
        return { ok: false, error: `IHDR declares invalid dimensions ${width}x${height}` };
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0) return { ok: false, error: "IEND chunk is not empty" };
      if (!sawImageData) return { ok: false, error: "contains no IDAT image data" };
      return { ok: true, width, height };
    }

    offset += 12 + length;
  }

  if (!sawHeader) return { ok: false, error: "contains no IHDR chunk" };
  if (!sawImageData) return { ok: false, error: "contains no IDAT image data" };
  return { ok: false, error: "is missing its IEND terminator" };
}

/**
 * Extensions whose contents are expected to be decodable images. A file with one
 * of these extensions must validate as an image before it can reach a transcript.
 */
const IMAGE_FILE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/**
 * Safely inspect ZIP archive entries in-memory without decompressing payloads.
 * Protects against ZIP extraction vulnerabilities and ZIP bombs.
 */
export function inspectZipContainer(buffer: Buffer): { ok: boolean; entries: Set<string>; error?: string } {
  if (buffer.length < 22) {
    return { ok: false, entries: new Set(), error: "File too small to be a valid ZIP archive" };
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    return { ok: false, entries: new Set(), error: "Missing ZIP local file header signature" };
  }
  const entries = new Set<string>();
  let offset = 0;
  let count = 0;
  const maxEntries = 250;

  try {
    while (offset + 30 <= buffer.length && count < maxEntries) {
      if (buffer[offset] === 0x50 && buffer[offset + 1] === 0x4b && buffer[offset + 2] === 0x03 && buffer[offset + 3] === 0x04) {
        const fileNameLen = buffer.readUInt16LE(offset + 26);
        const extraLen = buffer.readUInt16LE(offset + 28);
        const fileNameStart = offset + 30;
        const fileNameEnd = fileNameStart + fileNameLen;
        if (fileNameEnd <= buffer.length) {
          const name = buffer.toString("utf8", fileNameStart, fileNameEnd);
          entries.add(name);
        }
        offset = fileNameEnd + extraLen;
        let next = -1;
        for (let i = offset; i + 4 <= buffer.length; i++) {
          if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b) {
            if ((buffer[i + 2] === 0x03 && buffer[i + 3] === 0x04) || (buffer[i + 2] === 0x01 && buffer[i + 3] === 0x02)) {
              next = i;
              break;
            }
          }
        }
        if (next === -1) break;
        offset = next;
        count++;
      } else if (buffer[offset] === 0x50 && buffer[offset + 1] === 0x4b && buffer[offset + 2] === 0x01 && buffer[offset + 3] === 0x02) {
        const fileNameLen = buffer.readUInt16LE(offset + 28);
        const extraLen = buffer.readUInt16LE(offset + 30);
        const commentLen = buffer.readUInt16LE(offset + 32);
        const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLen);
        entries.add(name);
        offset += 46 + fileNameLen + extraLen + commentLen;
        count++;
      } else {
        break;
      }
    }
  } catch (err) {
    return { ok: false, entries, error: `Corrupt ZIP package: ${(err as Error).message}` };
  }

  return { ok: entries.size > 0, entries };
}

// Magic bytes definitions
export function sniffMagic(
  buffer: Buffer,
  originalName = "",
  declaredMime = "",
): { kind: ArtifactKind; mime: string; metadata?: ArtifactMetadata; error?: string } {
  const ext = extname(originalName).toLowerCase();

  // 1. PDF
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { kind: "pdf", mime: "application/pdf" };
  }

  // 2. PNG — the container is inspected, not just the signature, so undecodable
  // PNGs fall through to a plain file instead of being presented as an image.
  if (buffer.length >= 8 && buffer.subarray(0, 4).equals(PNG_SIGNATURE.subarray(0, 4))) {
    const png = inspectPngContainer(buffer);
    if (!png.ok) {
      return { kind: "file", mime: "application/octet-stream", error: `invalid PNG image: ${png.error}` };
    }
    return { kind: "image", mime: "image/png", metadata: { width: png.width, height: png.height, format: "png" } };
  }

  // 3. JPEG
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let width = 0;
    let height = 0;
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        height = buffer.readUInt16BE(offset + 5);
        width = buffer.readUInt16BE(offset + 7);
        break;
      }
      const len = buffer.readUInt16BE(offset + 2);
      offset += 2 + len;
    }
    return { kind: "image", mime: "image/jpeg", metadata: { width, height, format: "jpeg" } };
  }

  // 4. WebP
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    return { kind: "image", mime: "image/webp", metadata: { format: "webp" } };
  }

  // 5. GIF
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("latin1");
    if (head === "GIF87a" || head === "GIF89a") {
      const width = buffer.length >= 10 ? buffer.readUInt16LE(6) : 0;
      const height = buffer.length >= 10 ? buffer.readUInt16LE(8) : 0;
      return { kind: "image", mime: "image/gif", metadata: { width, height, format: "gif" } };
    }
  }

  // 6. ZIP / Archive & Structural OpenXML / OpenDocument verification
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 3 || buffer[2] === 5 || buffer[2] === 7)) {
    const zip = inspectZipContainer(buffer);

    // Structural checks for OpenXML components:
    // A genuine OpenXML document package contains [Content_Types].xml and parts under xl/, word/, or ppt/
    // When the ZIP container is valid and entries parsed, check genuine entry names to prevent false positives
    // from random compressed byte patterns matching "xl/". Fall back to buffer search only for partial/mock buffers.
    const hasContentTypes = zip.ok
      ? zip.entries.has("[Content_Types].xml")
      : buffer.includes(Buffer.from("[Content_Types].xml"));
    const hasXl = zip.ok
      ? Array.from(zip.entries).some((e) => e.startsWith("xl/"))
      : buffer.includes(Buffer.from("xl/"));
    const hasWord = zip.ok
      ? Array.from(zip.entries).some((e) => e.startsWith("word/"))
      : buffer.includes(Buffer.from("word/"));
    const hasPpt = zip.ok
      ? Array.from(zip.entries).some((e) => e.startsWith("ppt/"))
      : buffer.includes(Buffer.from("ppt/"));

    // Content-first OpenXML structural identification
    if (hasWord && !hasXl) {
      return {
        kind: "document",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ...(ext && ext !== ".docx" ? { error: `File has ${ext} extension but contains OpenXML Word document contents` } : {}),
      };
    }

    if (hasXl && !hasWord) {
      return {
        kind: "document",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ...(ext && ext !== ".xlsx" ? { error: `File has ${ext} extension but contains OpenXML spreadsheet contents` } : {}),
      };
    }

    if (hasPpt && !hasXl && !hasWord) {
      return {
        kind: "document",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ...(ext && ext !== ".pptx" ? { error: `File has ${ext} extension but contains OpenXML presentation contents` } : {}),
      };
    }

    if (ext === ".xlsx") {
      // If genuine ZIP of unrelated files renamed to .xlsx -> spoofing detected
      if (zip.ok && !hasXl && !hasContentTypes && zip.entries.size > 0) {
        return {
          kind: "archive",
          mime: "application/zip",
          error: "Archive lacks OpenXML spreadsheet structure ([Content_Types].xml and xl/ missing)",
        };
      }
      return { kind: "document", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    }

    if (ext === ".docx") {
      if (zip.ok && !hasWord && !hasContentTypes && zip.entries.size > 0) {
        return {
          kind: "archive",
          mime: "application/zip",
          error: "Archive lacks OpenXML Word document structure",
        };
      }
      return { kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    }

    if (ext === ".pptx") {
      return { kind: "document", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
    }

    if (hasPpt) {
      return {
        kind: "document",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ...(ext && ext !== ".pptx" ? { error: `File has ${ext} extension but contains OpenXML PowerPoint contents` } : {}),
      };
    }

    if (ext === ".ods" || ext === ".odt" || ext === ".odp") {
      const hasMimetype = zip.entries.has("mimetype") || buffer.includes(Buffer.from("mimetype"));
      if (hasMimetype) {
        if (ext === ".ods") return { kind: "document", mime: "application/vnd.oasis.opendocument.spreadsheet" };
        if (ext === ".odt") return { kind: "document", mime: "application/vnd.oasis.opendocument.text" };
        if (ext === ".odp") return { kind: "document", mime: "application/vnd.oasis.opendocument.presentation" };
      }
    }

    if (ext === ".apk" && (zip.entries.has("AndroidManifest.xml") || buffer.includes(Buffer.from("AndroidManifest.xml")))) {
      return { kind: "archive", mime: "application/vnd.android.package-archive" };
    }
    if (ext === ".jar" && (zip.entries.has("META-INF/MANIFEST.MF") || buffer.includes(Buffer.from("META-INF/MANIFEST.MF")))) {
      return { kind: "archive", mime: "application/java-archive" };
    }
    if (ext === ".epub" && (zip.entries.has("META-INF/container.xml") || buffer.includes(Buffer.from("META-INF/container.xml")))) {
      return { kind: "document", mime: "application/epub+zip" };
    }

    return { kind: "archive", mime: "application/zip" };
  }

  // 7. Legacy MS Office (OLE2 compound documents)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  ) {
    if (ext === ".xls") return { kind: "document", mime: "application/vnd.ms-excel" };
    if (ext === ".doc") return { kind: "document", mime: "application/msword" };
    if (ext === ".ppt") return { kind: "document", mime: "application/vnd.ms-powerpoint" };
    return { kind: "document", mime: "application/octet-stream" };
  }

  // 7. GZIP
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return { kind: "archive", mime: "application/gzip" };
  }

  // Extension / content-based heuristics
  if (ext === ".geojson") {
    try {
      const parsed = JSON.parse(buffer.toString("utf8"));
      return {
        kind: "dataset",
        mime: "application/geo+json",
        metadata: {
          isGeoJson: true,
          type: typeof parsed?.type === "string" ? parsed.type : undefined,
          featureCount: Array.isArray(parsed?.features) ? parsed.features.length : undefined,
        },
      };
    } catch {
      return { kind: "dataset", mime: "application/geo+json" };
    }
  }

  if (ext === ".json") {
    try {
      JSON.parse(buffer.toString("utf8"));
      return { kind: "dataset", mime: "application/json" };
    } catch {
      return { kind: "code", mime: "application/json" };
    }
  }

  // A notebook is JSON, but delivering it as application/json loses the fact
  // that it is a runnable Colab/Jupyter document. Its container is inspected so
  // a half-written file is reported as broken instead of offered as a notebook.
  if (ext === ".ipynb") {
    const notebook = inspectNotebook(buffer);
    if (!notebook.ok) {
      return { kind: "file", mime: "application/octet-stream", error: `invalid notebook: ${notebook.error}` };
    }
    return {
      kind: "document",
      mime: NOTEBOOK_MIME,
      metadata: {
        format: "ipynb",
        nbformat: notebook.nbformat,
        nbformatMinor: notebook.nbformatMinor,
        cellCount: notebook.cellCount,
        codeCellCount: notebook.codeCellCount,
        kernel: notebook.kernel,
      },
    };
  }

  if (ext === ".csv") return { kind: "dataset", mime: "text/csv" };
  if (ext === ".tsv") return { kind: "dataset", mime: "text/tab-separated-values" };
  if (ext === ".md") return { kind: "document", mime: "text/markdown" };
  if (ext === ".txt") return { kind: "document", mime: "text/plain" };
  if (ext === ".rtf") return { kind: "document", mime: "application/rtf" };
  if (ext === ".svg") return { kind: "image", mime: "image/svg+xml" };

  if ([".py", ".js", ".ts", ".jsx", ".tsx", ".sh", ".html", ".css", ".sql", ".rs", ".go", ".c", ".cpp", ".java", ".kt"].includes(ext)) {
    const lineCount = buffer.toString("utf8").split("\n").length;
    return { kind: "code", mime: "text/plain", metadata: { lineCount } };
  }

  if ([".tar", ".gz", ".bz2", ".xz", ".7z"].includes(ext)) {
    return { kind: "archive", mime: "application/octet-stream" };
  }

  const mime = declaredMime || "application/octet-stream";
  return { kind: "file", mime };
}

/**
 * Read a `.ipynb` the way an editor or Colab will: it must be JSON, it must
 * declare nbformat, and every cell must be a real notebook cell with a source.
 * A structurally broken notebook must never reach a transcript as if it were a
 * deliverable — the person would open it and get a parse error, not answers.
 */
export function inspectNotebook(
  buffer: Buffer,
):
  | {
      ok: true;
      nbformat: number;
      nbformatMinor: number;
      cellCount: number;
      codeCellCount: number;
      kernel?: string;
    }
  | { ok: false; error: string } {
  let document: unknown;
  try {
    document = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    return { ok: false, error: `notebook is not valid JSON (${(error as Error).message})` };
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, error: "notebook root is not a JSON object" };
  }
  const notebook = document as Record<string, unknown>;
  if (typeof notebook.nbformat !== "number") return { ok: false, error: "notebook has no numeric nbformat" };
  if (notebook.nbformat < 4) return { ok: false, error: `unsupported nbformat ${notebook.nbformat}` };
  if (typeof notebook.nbformat_minor !== "number") {
    return { ok: false, error: "notebook has no numeric nbformat_minor" };
  }
  if (!Array.isArray(notebook.cells)) return { ok: false, error: "notebook has no cells array" };
  if (notebook.cells.length === 0) return { ok: false, error: "notebook has no cells" };

  let codeCellCount = 0;
  for (let index = 0; index < notebook.cells.length; index += 1) {
    const cell = notebook.cells[index];
    if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
      return { ok: false, error: `cell ${index} is not an object` };
    }
    const record = cell as Record<string, unknown>;
    const cellType = record.cell_type;
    if (cellType !== "code" && cellType !== "markdown" && cellType !== "raw") {
      return { ok: false, error: `cell ${index} has an unknown cell_type ${JSON.stringify(cellType)}` };
    }
    const source = record.source;
    const sourceOk =
      typeof source === "string" || (Array.isArray(source) && source.every((line) => typeof line === "string"));
    if (!sourceOk) return { ok: false, error: `cell ${index} has no string source` };
    if (cellType === "code") codeCellCount += 1;
  }

  const metadata = notebook.metadata;
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, any>) : {};
  const kernel =
    (typeof meta.kernelspec?.name === "string" && meta.kernelspec.name) ||
    (typeof meta.language_info?.name === "string" && meta.language_info.name) ||
    undefined;

  return {
    ok: true,
    nbformat: notebook.nbformat,
    nbformatMinor: notebook.nbformat_minor,
    cellCount: notebook.cells.length,
    codeCellCount,
    kernel: kernel || undefined,
  };
}

export function isInternalFilename(name: string): boolean {
  const lower = name.toLowerCase();
  if (
    lower === "artifacts.json" ||
    lower === "package.json" ||
    lower === "package-lock.json" ||
    lower === "tsconfig.json" ||
    lower.startsWith(".openmaus") ||
    lower.startsWith(".system") ||
    lower.startsWith("tmp") ||
    lower.endsWith(".tmp") ||
    lower.endsWith(".log") ||
    lower.endsWith(".lock") ||
    lower.endsWith(".js") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".py") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".bash") ||
    lower.endsWith(".geojson") ||
    lower.endsWith(".raw") ||
    lower.endsWith(".part") ||
    lower.startsWith("download-")
  ) {
    return true;
  }
  return false;
}

/**
 * The user-facing artifacts a computer tool registered, read back out of the
 * tool's own JSON result. `artifact_register` runs inside the MCP child, which
 * has no idea which turn called it, and a model cannot know the turn's ids
 * either — so the harness binds the registration to the turn that made the
 * call instead of trusting a `turnId` argument the model can only guess at.
 * Only durable `/api/attachments/...` records the tool marked user-visible (or
 * final) count; internal working files never reach a transcript.
 */
export function artifactsFromToolOutput(
  output: unknown,
): Array<{ kind: ArtifactKind; path: string; mime?: string; name: string }> {
  if (!output) return [];
  let parsed: unknown = output;
  if (typeof output === "string") {
    if (!output.includes("/api/attachments/")) return [];
    try {
      parsed = JSON.parse(output);
    } catch {
      return [];
    }
  } else if (typeof output !== "object") {
    return [];
  }
  const found: Array<{ kind: ArtifactKind; path: string; mime?: string; name: string }> = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value === "string" && value.includes("/api/attachments/")) {
      try {
        const innerParsed = JSON.parse(value);
        visit(innerParsed, depth + 1);
      } catch {}
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const urlPath = typeof record.urlPath === "string" ? record.urlPath : (typeof record.path === "string" ? record.path : undefined);
    if (urlPath && urlPath.startsWith("/api/attachments/")) {
      const name = typeof record.name === "string" && record.name ? record.name : basename(urlPath);
      const visibility = typeof record.visibility === "string" ? record.visibility : "user_visible";
      const userFacing = visibility === "user_visible" || visibility === "final";
      if (userFacing && !isInternalFilename(name) && !seen.has(urlPath)) {
        seen.add(urlPath);
        found.push({
          kind: typeof record.kind === "string" ? (record.kind as ArtifactKind) : "file",
          path: urlPath,
          mime: typeof record.mime === "string" ? record.mime : undefined,
          name,
        });
      }
    }
    for (const inner of Object.values(record)) visit(inner, depth + 1);
  };
  visit(parsed, 0);
  return found;
}

export function isUserFacingArtifact(record: ArtifactRecord): boolean {
  if (record.visibility === "internal" || record.visibility === "intermediate") {
    return false;
  }
  if (record.metadata?.quarantined) {
    return false;
  }
  if (isInternalFilename(record.name)) {
    return false;
  }
  return record.visibility === "user_visible" || record.visibility === "final";
}

export class ArtifactManager {
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly artifactsBySha = new Map<string, ArtifactRecord>();
  private readonly turnArtifacts = new Map<string, Set<string>>(); // turnId -> Set<artifactId>
  private readonly deliveredFiles = new Set<string>(); // canonical path on disk -> already delivered
  private readonly registryPath = join(ATTACHMENTS_DIR, ".artifacts-registry.json");
  private leaseValidator?: (token: FencingToken) => void;

  constructor() {
    this.loadRegistry();
  }

  setLeaseValidator(validator: (token: FencingToken) => void): void {
    this.leaseValidator = validator;
  }

  private validateFencing(token?: FencingToken, targetJobId?: string): void {
    const jId = token?.jobId || targetJobId;
    if (jId) {
      if (!token) {
        throw new StaleWorkerFenceError(
          jId,
          1,
          0,
          "Missing mandatory fencing token for outcome artifact operation"
        );
      }
      if (this.leaseValidator) {
        this.leaseValidator(token);
      } else {
        sharedPersistentJobManager.assertWorkerLeaseActive(token);
      }
    }
  }

  private loadRegistry(): void {
    if (!existsSync(this.registryPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.registryPath, "utf8"));
      if (Array.isArray(data.artifacts)) {
        for (const record of data.artifacts as ArtifactRecord[]) {
          this.artifacts.set(record.id, record);
          this.artifactsBySha.set(record.sha256, record);
          if (record.metadata?.turnId) {
            const turnId = record.metadata.turnId as string;
            if (!this.turnArtifacts.has(turnId)) {
              this.turnArtifacts.set(turnId, new Set());
            }
            this.turnArtifacts.get(turnId)!.add(record.id);
          }
        }
      }
      if (Array.isArray(data.deliveredFiles)) {
        for (const file of data.deliveredFiles as string[]) {
          this.deliveredFiles.add(file);
        }
      }
    } catch {
      // Ignore corrupt registry
    }
  }

  private saveRegistry(): void {
    try {
      ensureAttachmentsDir();
      const data = {
        artifacts: Array.from(this.artifacts.values()),
        deliveredFiles: Array.from(this.deliveredFiles.values()),
      };
      writeFileSync(this.registryPath, JSON.stringify(data, null, 2));
    } catch {
      // Best-effort registry save
    }
  }

  /**
   * Empirically validate an artifact buffer or file.
   */
  validateArtifact(source: string | Buffer, options: { expectedKind?: ArtifactKind; minBytes?: number; originalName?: string } = {}): ArtifactValidationResult {
    let buffer: Buffer;
    let name = options.originalName || "artifact";

    if (typeof source === "string") {
      const fullPath = resolveWorkspacePath(source);
      name = basename(fullPath);
      if (!existsSync(fullPath)) {
        return {
          valid: false,
          kind: "file",
          mime: "application/octet-stream",
          sizeBytes: 0,
          sha256: "",
          error: `File does not exist: ${source}`,
        };
      }
      try {
        buffer = readFileSync(fullPath);
      } catch (err: any) {
        return {
          valid: false,
          kind: "file",
          mime: "application/octet-stream",
          sizeBytes: 0,
          sha256: "",
          error: `Failed to read file: ${err.message}`,
        };
      }
    } else {
      buffer = source;
    }

    if (buffer.byteLength === 0) {
      return {
        valid: false,
        kind: "file",
        mime: "application/octet-stream",
        sizeBytes: 0,
        sha256: "",
        error: "Artifact is empty (0 bytes)",
      };
    }

    if (options.minBytes && buffer.byteLength < options.minBytes) {
      return {
        valid: false,
        kind: "file",
        mime: "application/octet-stream",
        sizeBytes: buffer.byteLength,
        sha256: "",
        error: `Artifact size ${buffer.byteLength} is less than required minimum ${options.minBytes} bytes`,
      };
    }

    const sniffed = sniffMagic(buffer, name);
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    if (options.expectedKind && sniffed.kind !== options.expectedKind) {
      return {
        valid: false,
        kind: sniffed.kind,
        mime: sniffed.mime,
        sizeBytes: buffer.byteLength,
        sha256,
        error: `Expected artifact kind ${options.expectedKind}, but detected ${sniffed.kind}${
          sniffed.error ? ` (${sniffed.error})` : ""
        }`,
      };
    }

    return {
      valid: true,
      kind: sniffed.kind,
      mime: sniffed.mime,
      sizeBytes: buffer.byteLength,
      sha256,
      metadata: sniffed.metadata,
    };
  }

  /**
   * Register an artifact into the system storage and record its provenance.
   * Prevents duplicate files by checking existing SHA-256 digests.
   */
  registerArtifact(
    source: string | Buffer,
    options: {
      name?: string;
      visibility?: ArtifactVisibility;
      metadata?: ArtifactMetadata;
      fencingToken?: FencingToken;
      jobId?: string;
    } = {},
  ): ArtifactRecord {
    const targetJobId = options.jobId || options.fencingToken?.jobId || (options.metadata?.jobId as string | undefined);
    if (targetJobId || options.fencingToken) {
      this.validateFencing(options.fencingToken, targetJobId);
    }

    let buffer: Buffer;
    let fullPath: string | undefined;
    let originalName = options.name || (typeof source === "string" ? basename(source) : "artifact");

    if (typeof source === "string") {
      fullPath = resolveWorkspacePath(source);
      if (!existsSync(fullPath)) {
        throw new Error(`Cannot register non-existent file: ${source}`);
      }
      buffer = readFileSync(fullPath);
    } else {
      buffer = source;
    }

    const validation = this.validateArtifact(buffer, { originalName });
    if (!validation.valid) {
      throw new Error(`Artifact validation failed: ${validation.error}`);
    }

    // A file named like an image must actually contain a readable image. Without
    // this gate a corrupt PNG (valid signature, broken chunks) is registered and
    // delivered as a user-visible "image" that the chat viewer cannot render.
    // Same gate for notebooks: the extension promises a runnable document, so
    // bytes that no notebook reader would accept must not be registered at all.
    if (extname(originalName).toLowerCase() === ".ipynb") {
      const notebook = inspectNotebook(buffer);
      if (!notebook.ok) {
        throw new Error(
          `Refusing to register "${originalName}" as a Colab notebook: ${notebook.error}. ` +
            "Write the complete nbformat 4 JSON (cells with cell_type and source) and register it again.",
        );
      }
    }

    if (IMAGE_FILE_EXTENSIONS.has(extname(originalName).toLowerCase()) && validation.kind !== "image") {
      const imageProblem = this.validateArtifact(buffer, { originalName, expectedKind: "image" });
      throw new Error(
        `Refusing to register "${originalName}" as an image artifact: ${
          imageProblem.error || "the file contents are not a readable image"
        }. Regenerate or repair the file and pass verify_image before registering it.`,
      );
    }

    const visibility: ArtifactVisibility =
      options.visibility || (isInternalFilename(originalName) ? "internal" : "user_visible");

    // Exact SHA-256 deduplication: reuse existing registered artifact rather than duplicating files on disk
    const existing = this.artifactsBySha.get(validation.sha256);
    if (existing) {
      if (options.metadata?.turnId && (existing.metadata?.turnId === options.metadata.turnId || options.metadata?.reused)) {
        const turnId = options.metadata.turnId;
        if (!this.turnArtifacts.has(turnId)) {
          this.turnArtifacts.set(turnId, new Set());
        }
        this.turnArtifacts.get(turnId)!.add(existing.id);
      }
      if (fullPath) {
        this.deliveredFiles.add(fullPath);
        this.saveRegistry();
      }
      return existing;
    }

    ensureAttachmentsDir();
    const id = randomUUID();
    const ext = extname(originalName) || (validation.kind === "image" ? ".png" : validation.kind === "pdf" ? ".pdf" : ".bin");
    const safeExt = ext.startsWith(".") ? ext : `.${ext}`;
    const storageFileName = `${id}${safeExt}`;
    const storagePath = join(ATTACHMENTS_DIR, storageFileName);

    // Save copy into ATTACHMENTS_DIR for durable HTTP serving
    writeFileSync(storagePath, buffer);

    const record: ArtifactRecord = {
      id,
      name: originalName,
      kind: validation.kind,
      mime: validation.mime,
      sizeBytes: buffer.byteLength,
      sha256: validation.sha256,
      urlPath: `/api/attachments/${storageFileName}`,
      localPath: storagePath,
      createdAt: new Date().toISOString(),
      visibility,
      validationState: "valid",
      deliveryState: "registered",
      metadata: {
        ...validation.metadata,
        ...options.metadata,
        jobId: targetJobId,
        workerId: options.fencingToken?.workerId,
        fencingGeneration: options.fencingToken?.fencingGeneration,
      },
    };

    this.artifacts.set(id, record);
    this.artifactsBySha.set(validation.sha256, record);

    if (options.metadata?.turnId) {
      const turnId = options.metadata.turnId;
      if (!this.turnArtifacts.has(turnId)) {
        this.turnArtifacts.set(turnId, new Set());
      }
      this.turnArtifacts.get(turnId)!.add(id);
    }

    if (fullPath) {
      this.deliveredFiles.add(fullPath);
    } else if (typeof source === "string") {
      this.deliveredFiles.add(source);
    }
    this.saveRegistry();

    return record;
  }

  /**
   * Promote an artifact to user_visible or final with strict fencing verification.
   * If fencing validation fails or active lease is lost, the artifact is immediately quarantined.
   */
  promoteArtifact(
    artifactId: string,
    targetVisibility: "user_visible" | "final",
    options?: {
      fencingToken?: FencingToken;
      jobId?: string;
    }
  ): ArtifactRecord {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const targetJobId = options?.jobId || options?.fencingToken?.jobId || (artifact.metadata?.jobId as string | undefined);

    if (targetJobId || options?.fencingToken) {
      try {
        this.validateFencing(options?.fencingToken, targetJobId);
      } catch (fenceErr) {
        // Quarantines stale artifact immediately: never become final deliverable
        artifact.visibility = "internal";
        artifact.metadata = {
          ...artifact.metadata,
          quarantined: true,
          quarantineReason: fenceErr instanceof Error ? fenceErr.message : "Stale worker fence violation",
          quarantinedAt: new Date().toISOString(),
        };
        this.saveRegistry();
        throw fenceErr;
      }
    }

    artifact.visibility = targetVisibility;
    artifact.metadata = {
      ...artifact.metadata,
      promotedAt: new Date().toISOString(),
      promotedByWorker: options?.fencingToken?.workerId,
      promotionGeneration: options?.fencingToken?.fencingGeneration,
    };
    this.saveRegistry();
    return artifact;
  }

  getArtifact(id: string): ArtifactRecord | undefined {
    return this.artifacts.get(id);
  }

  getArtifactByStorageName(storageFileName: string): ArtifactRecord | undefined {
    if (!storageFileName) return undefined;
    const base = basename(storageFileName);
    for (const record of this.artifacts.values()) {
      if (basename(record.urlPath) === base || basename(record.localPath) === base || record.id === base) {
        return record;
      }
    }
    return undefined;
  }

  listArtifacts(filter?: { kind?: ArtifactKind; threadId?: string; visibility?: ArtifactVisibility }): ArtifactRecord[] {
    const all = Array.from(this.artifacts.values());
    if (!filter) return all;
    return all.filter((a) => {
      if (filter.kind && a.kind !== filter.kind) return false;
      if (filter.threadId && a.metadata?.threadId !== filter.threadId) return false;
      if (filter.visibility && a.visibility !== filter.visibility) return false;
      return true;
    });
  }

  /**
   * Retrieve artifacts registered for a specific turn.
   */
  getArtifactsForTurn(turnId: string): ArtifactRecord[] {
    const ids = this.turnArtifacts.get(turnId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.artifacts.get(id))
      .filter((a): a is ArtifactRecord => Boolean(a));
  }

  /**
   * Scan designated candidate output folders for new user-facing artifacts created during a turn.
   * Excludes root workspace scripts, internal working files, and duplicates.
   *
   * Root level is scanned too, but only for finished deliverables: the system
   * prompt tells a model that a file it generates is published automatically,
   * and a notebook or report written straight to the workspace root is exactly
   * that. Source files, project manifests and logs stay out — the extension
   * allowlist is what keeps the workspace's own code from being attached to a
   * reply.
   */
  scanAndRegisterWorkspaceArtifacts(
    workspaceRoots: string[],
    options: { turnId?: string; threadId?: string; maxAgeMs?: number; turnStartTime?: number } = {},
  ): ArtifactRecord[] {
    const cutoff = options.turnStartTime
      ? options.turnStartTime - 1000
      : Date.now() - (options.maxAgeMs ?? 15_000);
    const discovered: ArtifactRecord[] = [];

    // Strictly scan designated artifact/download folders, NEVER root "."
    const candidateFolders = [
      "artifacts",
      "output",
      "downloads",
    ];

    // Finished deliverables a model writes at the workspace root, by extension.
    const ROOT_DELIVERABLE_EXTENSIONS = new Set([
      ".ipynb",
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".csv",
      ".tsv",
      ".ppt",
      ".pptx",
      ".odt",
      ".ods",
      ".odp",
      ".zip",
      ".md",
      ".txt",
      ".json",
      ".html",
    ]);

    for (const root of workspaceRoots) {
      if (!existsSync(root)) continue;

      const scanTargets: Array<{ dir: string; rootDeliverablesOnly: boolean }> = candidateFolders.map((sub) => ({
        dir: join(root, sub),
        rootDeliverablesOnly: false,
      }));
      scanTargets.push({ dir: root, rootDeliverablesOnly: true });

      for (const { dir, rootDeliverablesOnly } of scanTargets) {
        if (!existsSync(dir)) continue;

        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          continue;
        }

        for (const name of entries) {
          if (name.startsWith(".")) continue;
          if (isInternalFilename(name)) continue;
          if (rootDeliverablesOnly && !ROOT_DELIVERABLE_EXTENSIONS.has(extname(name).toLowerCase())) continue;

          const absolute = resolve(dir, name);
          if (this.deliveredFiles.has(absolute)) continue;

          let st;
          try {
            st = statSync(absolute);
          } catch {
            continue;
          }

          if (!st.isFile() || st.mtimeMs < cutoff || st.size === 0 || st.size > 50 * 1024 * 1024) continue;

          let buffer: Buffer;
          try {
            buffer = readFileSync(absolute);
          } catch {
            continue;
          }
          const hash = createHash("sha256").update(buffer).digest("hex");
          if (this.artifactsBySha.has(hash)) {
            this.deliveredFiles.add(absolute);
            this.saveRegistry();
            continue;
          }

          try {
            const registered = this.registerArtifact(absolute, {
              name,
              visibility: "user_visible",
              metadata: {
                turnId: options.turnId,
                threadId: options.threadId,
              },
            });
            this.deliveredFiles.add(absolute);
            this.saveRegistry();
            if (isUserFacingArtifact(registered)) {
              discovered.push(registered);
            }
          } catch {
            // Ignore files that fail validation
          }
        }
      }
    }

    return discovered;
  }
}

export const defaultArtifactManager = new ArtifactManager();
