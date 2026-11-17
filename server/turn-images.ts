// Turn-local image admission.
//
// Composer messages persist a standalone <attached-image> transport tag so
// every client can render the attachment later. Providers should not have to
// discover that image through a filesystem tool (and an approval round trip),
// so this module turns only app-owned tags from the CURRENT message into the
// structured image input each native protocol understands.
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

import { fromMarkdown } from "mdast-util-from-markdown";

import { ATTACHMENTS_DIR, IMAGE_MAX_BYTES } from "./attachments.ts";
import { defaultArtifactManager } from "./computer-agent/artifact-manager.ts";
import { isAcknowledgement, isGreeting } from "./conversational-cadence.ts";
import type { TurnImageInput } from "./contracts.ts";
import type { AttachmentAuthor, WireAttachment } from "../shared/wire.ts";

/** Matches the companion composer policy. Four maximum-sized images are
 * bounded to 40 MiB before a provider is asked to ingest them. */
export const TURN_IMAGE_MAX_COUNT = 4;
export const TURN_IMAGE_MAX_BYTES = TURN_IMAGE_MAX_COUNT * IMAGE_MAX_BYTES;

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

type TagCandidate = { start: number; end: number; path: string };

const OWNED_IMAGE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
const IMAGE_TAG =
  /^<attached-image[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>$/;

const MIME_BY_EXTENSION: Readonly<Record<string, TurnImageInput["mime"]>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function statusError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Decode exactly the entities emitted by the composer. Repeated or unknown
 * encodings stay encoded and therefore cannot acquire a privileged path. */
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

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    visit(current);
    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  }
}

/** Find only exact, standalone HTML transport tags. mdast keeps examples in
 * code fences/code spans out of HTML nodes; the line boundary check keeps
 * prose containing a tag literal from becoming an attachment capability. */
function imageTagCandidates(text: string): TagCandidate[] {
  const candidates: TagCandidate[] = [];
  walk(fromMarkdown(text) as MarkdownNode, (node) => {
    if (node.type !== "html" || !node.value || !node.position) return;
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    if (start === undefined || end === undefined) return;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLine = text.indexOf("\n", end);
    const lineEnd = nextLine < 0 ? text.length : nextLine;
    if (text.slice(lineStart, start).trim() || text.slice(end, lineEnd).trim()) return;
    const match = IMAGE_TAG.exec(node.value);
    if (!match) return;
    candidates.push({ start, end, path: decodeAttachmentAttribute(match[1]!) });
  });
  return candidates;
}

export function ownedImage(path: string, attachmentsDir: string): TurnImageInput | null {
  const result = checkImageFileStatus(path, attachmentsDir);
  return result.status === "valid" ? result.image : null;
}

export function checkImageFileStatus(
  path: string,
  attachmentsDir: string,
): { status: "valid"; image: TurnImageInput } | { status: "missing" | "invalid" } {
  if (!path || path.includes("\0")) return { status: "invalid" };
  const cleaned = path.replace(/^(attachments?:|api\/attachments\/|\/api\/attachments\/)/i, "");
  const name = cleaned.split(/[\\/]/).at(-1) ?? "";
  if (!OWNED_IMAGE_NAME.test(name)) return { status: "invalid" };

  // The composer receives and returns the exact server-generated path. A
  // basename match alone would let an arbitrary /tmp/<uuid>.png masquerade
  // as an app attachment, so the lexical path must point into this store too.
  // Allowed representations:
  // 1. Direct path matching expected: resolve(path) === expected
  // 2. /api/attachments/<uuid>.<ext> or api/attachments/<uuid>.<ext>
  // 3. attachment:<uuid>.<ext> or attachment:/<uuid>.<ext>
  const expected = resolve(attachmentsDir, name);
  const isApiRoute = path === `/api/attachments/${name}` || path === `api/attachments/${name}`;
  const isAttachmentScheme =
    path === `attachment:${name}` ||
    path === `attachments:${name}` ||
    path === `attachment:/${name}` ||
    path === `attachments:/${name}`;
  const isDirectPath = resolve(path) === expected;

  if (!isDirectPath && !isApiRoute && !isAttachmentScheme) return { status: "invalid" };

  try {
    const canonicalRoot = realpathSync(attachmentsDir);
    const canonicalFile = realpathSync(expected);
    if (dirname(canonicalFile) !== canonicalRoot) return { status: "invalid" };
    const entry = statSync(canonicalFile);
    if (!entry.isFile() || entry.size <= 0 || entry.size > IMAGE_MAX_BYTES) return { status: "missing" };
    const mime = MIME_BY_EXTENSION[extname(name)];
    return mime ? { status: "valid", image: { path: canonicalFile, mime, bytes: entry.size } } : { status: "invalid" };
  } catch {
    // If expected points to an authentic image filename in attachmentsDir but statSync/realpath failed,
    // the file is missing or expired on disk.
    return { status: "missing" };
  }
}

export interface ExtractTurnImagesOptions {
  /** Injectable only so focused tests never touch the user's data store. */
  attachmentsDir?: string;
  maxCount?: number;
  maxBytes?: number;
}

/** Resolve and remove trusted image tags from provider-facing text. The
 * caller continues to persist the original string unchanged. Invalid tags
 * stay visible as ordinary text and never turn into native image input. */
export function extractTurnImages(
  text: string,
  options: ExtractTurnImagesOptions = {},
): { text: string; images: TurnImageInput[] } {
  // Almost every turn is plain text. Skipping the Markdown tree for those
  // turns keeps image transport work out of the hot send path.
  if (!text.includes("<attached-image")) return { text, images: [] };

  const attachmentsDir = options.attachmentsDir ?? ATTACHMENTS_DIR;
  const maxCount = options.maxCount ?? TURN_IMAGE_MAX_COUNT;
  const maxBytes = options.maxBytes ?? TURN_IMAGE_MAX_BYTES;
  const admitted = imageTagCandidates(text)
    .map((tag) => ({ tag, image: ownedImage(tag.path, attachmentsDir) }))
    .filter((item): item is { tag: TagCandidate; image: TurnImageInput } => item.image !== null);

  if (admitted.length > maxCount) {
    throw statusError(413, `Send no more than ${maxCount} images at a time`);
  }
  const aggregateBytes = admitted.reduce((total, item) => total + item.image.bytes, 0);
  if (aggregateBytes > maxBytes) {
    throw statusError(413, `Attached images exceed ${Math.floor(maxBytes / (1024 * 1024))} MB total`);
  }

  let providerText = text;
  for (const { tag } of admitted.toReversed()) {
    providerText = providerText.slice(0, tag.start) + providerText.slice(tag.end);
  }
  return { text: providerText, images: admitted.map((item) => item.image) };
}

export interface PriorMessageLike {
  id?: string;
  role: string;
  kind?: string;
  text?: string;
  tool?: {
    name?: string;
    input?: string;
    output?: string;
    ok?: boolean;
    spoken?: string;
  };
  /** Conversation this row belongs to. The turn builder supplies it from the
   * store so a mixed message list cannot leak another thread's image. */
  threadId?: string;
  /** Bot that owns the row. Group rooms intentionally omit it: every member
   * may see the room's shared context. */
  botId?: string;
  attachments?: readonly WireAttachment[];
}

export interface ArtifactProvenanceInfo {
  sourceUrl?: string;
  sourceDomain?: string;
  subjectHint?: string;
  sha256?: string;
  originalPath?: string;
  verifiedDimensions?: { width: number; height: number };
}

export interface ResolveConversationImagesOptions {
  /** Injectable only so focused tests never touch the user's data store. */
  attachmentsDir?: string;
  maxCount?: number;
  maxBytes?: number;
  priorMessages?: readonly PriorMessageLike[];
  usesNativeImageInput?: boolean;
  injectGroundingNote?: boolean;
  /** The bot being addressed, so "hey panko" is recognized as a greeting
   *  rather than a two-word guess about the last image. */
  activeBotName?: string;
  /** The conversation assembling this turn. Prior rows stamped with a
   *  different thread are never admitted. */
  threadId?: string;
  /** The bot whose direct thread is running. A row stamped for another bot is
   *  never admitted; group rooms omit this because they share one thread. */
  botId?: string;
  /** The user message that carries the current turn's direct tags, when one
   *  already exists. */
  currentMessageId?: string;
}

export interface ResolveConversationImagesResult {
  text: string;
  images: TurnImageInput[];
  resolutionSource?: "turn-direct" | "conversation-history" | "none";
  selectedNames?: string[];
  missingImage?: boolean;
  groundingNote?: string;
  provenance?: ArtifactProvenanceInfo;
}

interface DiscoveredImageCandidate {
  rawPath: string;
  displayName: string;
  role: string;
  author: AttachmentAuthor;
  tool?: string;
  sourceMessageId?: string;
  sourceThreadId?: string;
  sourceBotId?: string;
  turnDistance: number;
  sourceText?: string;
  provenance?: ArtifactProvenanceInfo;
}

export function extractArtifactProvenance(
  rawPath: string,
  displayName: string,
  priorMessages: readonly PriorMessageLike[] = [],
): ArtifactProvenanceInfo | undefined {
  const normDisplayName = displayName.toLowerCase();
  const normRawPath = rawPath.toLowerCase();
  const rawBase = basename(rawPath).toLowerCase();

  // 1. Search priorMessages for tool activities (e.g. resource_download, verify_image, etc.)
  for (let i = priorMessages.length - 1; i >= 0; i -= 1) {
    const pm = priorMessages[i]!;
    if (pm.tool && (pm.tool.input || pm.tool.output)) {
      let inputObj: Record<string, unknown> | undefined;
      let outputObj: Record<string, unknown> | undefined;
      try {
        if (pm.tool.input) inputObj = JSON.parse(pm.tool.input);
      } catch {
        // ignore non-json
      }
      try {
        if (pm.tool.output) outputObj = JSON.parse(pm.tool.output);
      } catch {
        // ignore non-json
      }

      const inputPath = typeof inputObj?.path === "string" ? inputObj.path.toLowerCase() : "";
      const resultObj =
        outputObj?.result && typeof outputObj.result === "object"
          ? (outputObj.result as Record<string, unknown>)
          : outputObj;
      const outputPath = typeof resultObj?.path === "string" ? resultObj.path.toLowerCase() : "";

      const pathMatches =
        Boolean(inputPath && (inputPath.endsWith(normDisplayName) || normDisplayName.endsWith(basename(inputPath)) || inputPath.includes(rawBase))) ||
        Boolean(outputPath && (outputPath.endsWith(normDisplayName) || normDisplayName.endsWith(basename(outputPath)) || outputPath.includes(rawBase)));

      if (pathMatches) {
        const rawUrl =
          (typeof inputObj?.url === "string" ? inputObj.url : undefined) ||
          (typeof resultObj?.url === "string" ? resultObj.url : undefined) ||
          (typeof resultObj?.finalUrl === "string" ? resultObj.finalUrl : undefined);

        const sha256 =
          (typeof resultObj?.sha256 === "string" ? resultObj.sha256 : undefined) ||
          (typeof outputObj?.sha256 === "string" ? outputObj.sha256 : undefined);

        const imgDim =
          resultObj?.image && typeof resultObj.image === "object"
            ? (resultObj.image as { width?: number; height?: number })
            : undefined;

        const verifiedDimensions =
          imgDim && typeof imgDim.width === "number" && typeof imgDim.height === "number"
            ? { width: imgDim.width, height: imgDim.height }
            : undefined;

        if (rawUrl) {
          let sourceDomain: string | undefined;
          let subjectHint: string | undefined;
          try {
            const parsedUrl = new URL(rawUrl);
            sourceDomain = parsedUrl.hostname;
            const segments = parsedUrl.pathname.split("/").filter(Boolean);
            const genericTerms = new Set([
              "map", "country-region", "country", "images", "image", "assets", "downloads", "static", "media", "raw", "master", "main", "files",
              "outline-std", "outline", "std", "thumb", "icon", "flag", "default", "full", "preview", "large", "small"
            ]);
            for (let s = segments.length - 1; s >= 0; s -= 1) {
              const seg = segments[s]!.toLowerCase().replace(/\.[^.]+$/, "");
              if (seg && !genericTerms.has(seg) && !/^\d+$/.test(seg) && seg.length >= 3) {
                subjectHint = seg;
                break;
              }
            }
          } catch {
            // invalid URL format
          }

          return {
            sourceUrl: rawUrl,
            sourceDomain,
            subjectHint,
            sha256,
            originalPath: inputPath || outputPath,
            verifiedDimensions,
          };
        }
      }
    }
  }

  // 2. Check defaultArtifactManager if available
  try {
    const all = defaultArtifactManager.listArtifacts();
    const matched = all.find((a) => {
      const aName = a.name.toLowerCase();
      const aPath = a.urlPath.toLowerCase();
      return aName === normDisplayName || aPath === normRawPath || (rawBase && aPath.includes(rawBase));
    });
    if (matched && matched.metadata?.sourceUrl) {
      const rawUrl = String(matched.metadata.sourceUrl);
      let sourceDomain: string | undefined;
      let subjectHint: string | undefined;
      try {
        const parsedUrl = new URL(rawUrl);
        sourceDomain = parsedUrl.hostname;
        const segments = parsedUrl.pathname.split("/").filter(Boolean);
        const genericTerms = new Set([
          "map", "country-region", "country", "images", "image", "assets", "downloads", "static", "media", "raw", "master", "main", "files",
          "outline-std", "outline", "std", "thumb", "icon", "flag", "default", "full", "preview", "large", "small"
        ]);
        for (let s = segments.length - 1; s >= 0; s -= 1) {
          const seg = segments[s]!.toLowerCase().replace(/\.[^.]+$/, "");
          if (seg && !genericTerms.has(seg) && !/^\d+$/.test(seg) && seg.length >= 3) {
            subjectHint = seg;
            break;
          }
        }
      } catch {
        // invalid URL format
      }
      return {
        sourceUrl: rawUrl,
        sourceDomain,
        subjectHint,
        sha256: matched.sha256,
        originalPath: matched.localPath,
        verifiedDimensions:
          matched.metadata.width && matched.metadata.height
            ? { width: Number(matched.metadata.width), height: Number(matched.metadata.height) }
            : undefined,
      };
    }
  } catch {
    // Artifact manager not available
  }

  return undefined;
}

/** Explicit stored provenance wins. Legacy rows fall back to what the owning
 * message is: a user line is a user upload, a tool activity is tool output,
 * and any other bot line is the assistant's own image. */
function authorForMessage(
  message: PriorMessageLike,
  attachment?: WireAttachment,
): AttachmentAuthor {
  if (message.role === "user") return "user";
  if (attachment?.author === "assistant" || attachment?.author === "tool") return attachment.author;
  if (message.tool) return "tool";
  return "assistant";
}

/** A prior row is admissible only when its stamped conversation agrees with
 * the turn being assembled. Unstamped legacy rows are accepted: they came
 * from the caller's own active path before provenance was recorded. */
function belongsToConversation(
  message: PriorMessageLike,
  options: ResolveConversationImagesOptions,
): boolean {
  if (options.threadId && message.threadId && message.threadId !== options.threadId) return false;
  if (options.botId && message.botId && message.botId !== options.botId) return false;
  return true;
}

/** App-owned image tags whose file vanished after the upload. Invalid or
 * foreign tags stay visible as ordinary text; only a genuine missing
 * attachment is turned into a truthful availability note. */
function missingAppImageTags(
  text: string,
  attachmentsDir: string,
): { text: string; names: string[] } {
  if (!text.includes("<attached-image")) return { text, names: [] };
  const missing = imageTagCandidates(text).filter(
    (tag) => checkImageFileStatus(tag.path, attachmentsDir).status === "missing",
  );
  if (!missing.length) return { text, names: [] };
  let providerText = text;
  const names: string[] = [];
  for (const tag of missing.toReversed()) {
    providerText = providerText.slice(0, tag.start) + providerText.slice(tag.end);
    names.unshift(tag.path.split(/[\\/]/).at(-1) ?? "image");
  }
  return { text: providerText, names };
}

function missingImageNote(names: string[]): string {
  const list = names.map((name) => `"${name}"`).join(", ");
  const one = names.length === 1;
  return `[Context note: The attached image${one ? "" : "s"} (${list}) ${one ? "is" : "are"} no longer available on disk (missing or expired). Explain this truthfully; do not claim to see ${one ? "it" : "them"}.]`;
}

const VISUAL_REFERENCE_PATTERN =
  /\b(image|images|picture|pictures|photo|photos|screenshot|screenshots|diagram|diagrams|graphic|graphics|drawing|drawings|outline|outlines|silhouette|silhouettes|map|maps|chart|charts|figure|figures|visual|look|looks|looking|see|seeing|view|viewing|shown|above|display|displayed|depict|depicted|depicts|depiction|appear|appears|guess|guessing|correct|wrong|right|verify|verifying|verification|identify|identifying|identification|recognize|recognise|recognizing|recognising|recognition|solve|solving|inspect|inspecting|inspection|examine|examining|examination|observe|observing|observation|color|colour|shape|shapes|coast|coastline|coastlines|landlocked|border|borders|ocean|oceans|sea|seas|mountain|mountains)\b/i;

const ENTITY_QUESTION_PATTERN =
  /\b(what('?s|\s+is|\s+was|\s+am|\s+are)?|which|who('?s|\s+is|\s+was|\s+are)?|tell me|name|give|reveal|can you|could you|would you|do you (know|recognize|recognise|see)|is|are|was|were)\b.*\b(country|nation|place|state|city|region|answer|animal|object|logo|flag|subject|symbol|silhouette|shape|it|this|that|these|those)\b/i;

const UNRELATED_DOMAIN_PATTERN =
  /^\s*(what\s+is\s+)?\d+\s*[\+\-\*\/x×]\s*\d+|\b(python|javascript|typescript|bash|shell|rust|go|c|java|sql)\b|^\s*(\/|git\b|npm\b|npx\b|node\b|python\b|ls\b|cat\b|echo\b|const\b|let\b|var\b|def\b|function\b|import\b|class\b|return\b)/i;

const MULTIPLE_IMAGE_PATTERN = /\b(both|all|two|these|those|compare|each)\b/i;
const FIRST_IMAGE_PATTERN = /\b(first|1st)\b/i;
const SECOND_IMAGE_PATTERN = /\b(second|2nd)\b/i;

/** Social openers. Used only to keep a bare "hey <name>" from being read as a
 *  two-word guess about the last image; a greeting with a real request behind
 *  it ("hey, what country is this?") still carries its visual reference. */
const GREETING_OPENER =
  /^(?:hey|hi|hello|hiya|yo|howdy|sup|morning|afternoon|evening|good\s+(?:morning|afternoon|evening)|what'?s\s+up)\b/i;

/**
 * Cross-turn image admission.
 * When a user asks a follow-up question referencing an image previously presented in
 * the conversation (by assistant or user), resolves the underlying image and supplies
 * it to the model if the file still exists and the provider supports image inputs.
 */
export function resolveConversationImages(
  text: string,
  options: ResolveConversationImagesOptions = {},
): ResolveConversationImagesResult {
  const attachmentsDir = options.attachmentsDir ?? ATTACHMENTS_DIR;
  const maxCount = options.maxCount ?? TURN_IMAGE_MAX_COUNT;
  const maxBytes = options.maxBytes ?? TURN_IMAGE_MAX_BYTES;
  const priorMessages = options.priorMessages;

  // 1. Check current turn for direct <attached-image> tags. These are the
  // user's own words on the message being sent, so authorship is the user by
  // construction; the file still has to be a real app attachment.
  if (text.includes("<attached-image")) {
    const direct = extractTurnImages(text, { attachmentsDir, maxCount, maxBytes });
    const missing = missingAppImageTags(direct.text, attachmentsDir);
    const currentMessageId = options.currentMessageId
      ?? [...(priorMessages ?? [])].reverse().find((message) => message.role === "user" && message.text === text)?.id;
    if (direct.images.length > 0) {
      const images = direct.images.map((image) => ({
        ...image,
        author: "user" as const,
        ...(options.threadId ? { ownerThreadId: options.threadId } : {}),
        ...(currentMessageId ? { messageId: currentMessageId } : {}),
      }));
      return {
        text: missing.names.length
          ? `${missing.text}\n\n${missingImageNote(missing.names)}`
          : missing.text,
        images,
        resolutionSource: "turn-direct",
        selectedNames: images.map((img) => img.path.split(/[\\/]/).at(-1) ?? ""),
        ...(missing.names.length ? { missingImage: true } : {}),
      };
    }
    if (missing.names.length) {
      return {
        text: `${missing.text}\n\n${missingImageNote(missing.names)}`,
        images: [],
        resolutionSource: "turn-direct",
        selectedNames: missing.names,
        missingImage: true,
      };
    }
  }

  // 2. Cross-turn resolution if priorMessages is provided
  if (!priorMessages || priorMessages.length === 0) {
    return { text, images: [], resolutionSource: "none" };
  }

  // 3. Collect image candidates from prior messages in reverse chronological
  // order. A duplicate path keeps its newest turn position but the strongest
  // origin provenance: a bot quoting the user's upload does not turn that
  // upload into an assistant-generated picture.
  const candidates: DiscoveredImageCandidate[] = [];
  const candidateByPath = new Map<string, DiscoveredImageCandidate>();
  const seenNames = new Set<string>();
  const authorRank = (author: AttachmentAuthor): number =>
    author === "user" ? 3 : author === "tool" ? 2 : 1;

  const addCandidate = (candidate: DiscoveredImageCandidate): void => {
    const pathKey = candidate.rawPath.toLowerCase();
    const nameKey = candidate.displayName.toLowerCase();
    const existing = candidateByPath.get(pathKey);
    if (existing) {
      if (authorRank(candidate.author) > authorRank(existing.author)) {
        existing.author = candidate.author;
        existing.tool = candidate.tool;
        existing.sourceMessageId = candidate.sourceMessageId;
        existing.sourceThreadId = candidate.sourceThreadId;
        existing.sourceBotId = candidate.sourceBotId;
      }
      return;
    }
    if (seenNames.has(nameKey)) return;
    candidateByPath.set(pathKey, candidate);
    seenNames.add(nameKey);
    candidates.push(candidate);
  };

  for (let i = priorMessages.length - 1; i >= 0; i -= 1) {
    const pm = priorMessages[i]!;
    if (!belongsToConversation(pm, options)) continue;
    const distance = priorMessages.length - 1 - i;
    const source = {
      role: pm.role,
      author: authorForMessage(pm),
      ...(pm.tool?.name ? { tool: pm.tool.name } : {}),
      ...(pm.id ? { sourceMessageId: pm.id } : {}),
      sourceThreadId: pm.threadId ?? options.threadId,
      ...(pm.botId ? { sourceBotId: pm.botId } : {}),
      turnDistance: distance,
      sourceText: pm.text,
    };

    // Check message attachments array in reverse order so newer attachments come first
    if (pm.attachments && Array.isArray(pm.attachments)) {
      for (let a = pm.attachments.length - 1; a >= 0; a -= 1) {
        const att = pm.attachments[a]!;
        // Exclude non-images (Requirement 8)
        if (
          att.kind === "file" ||
          att.kind === "document" ||
          att.kind === "pdf" ||
          att.kind === "dataset" ||
          att.kind === "code" ||
          att.kind === "archive"
        ) {
          continue;
        }
        const name = (att.name ?? "").toLowerCase();
        const rawPath = (att.path ?? "").toLowerCase();
        if (
          name.endsWith(".geojson") ||
          rawPath.endsWith(".geojson") ||
          name.endsWith(".json") ||
          name.endsWith(".csv") ||
          name.endsWith(".txt")
        ) {
          continue;
        }

        const isImageKind =
          att.kind === "image" ||
          (typeof att.mime === "string" && att.mime.startsWith("image/")) ||
          /\.(png|jpe?g|gif|webp)$/i.test(att.name ?? "") ||
          /\.(png|jpe?g|gif|webp)$/i.test(att.path ?? "");

        if (isImageKind && att.path) {
          const displayName = att.name || att.path.split(/[\\/]/).at(-1) || "image.png";
          const author = authorForMessage(pm, att);
          const tool = att.tool ?? (author === "tool" ? pm.tool?.name : undefined);
          addCandidate({
            rawPath: att.path,
            displayName,
            ...source,
            author,
            ...(tool ? { tool } : {}),
          });
        }
      }
    }

    // Check message text for <attached-image tags
    if (pm.text && pm.text.includes("<attached-image")) {
      const tags = imageTagCandidates(pm.text);
      for (let t = tags.length - 1; t >= 0; t -= 1) {
        const tag = tags[t]!;
        const displayName = tag.path.split(/[\\/]/).at(-1) || "image.png";
        addCandidate({
          rawPath: tag.path,
          displayName,
          ...source,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { text, images: [], resolutionSource: "none" };
  }

  // 4. Relevance determination (Requirement 7: Avoid unnecessary token overhead)
  const trimmed = text.trim();
  const isUnrelated = UNRELATED_DOMAIN_PATTERN.test(trimmed);
  const botNames = options.activeBotName ? [options.activeBotName] : [];

  // Greetings and acknowledgements are social framing, not references to the
  // last picture. Admitting an earlier bot-generated image into "hey panko"
  // made the model narrate that image back as "the image you shared" — a
  // provenance claim the user never made (November 2 D4).
  const isConversationalOnly =
    isGreeting(trimmed, botNames) ||
    isAcknowledgement(trimmed) ||
    (GREETING_OPENER.test(trimmed) &&
      trimmed.split(/\s+/).length <= 2 &&
      !VISUAL_REFERENCE_PATTERN.test(trimmed));
  if (isConversationalOnly) {
    return { text, images: [], resolutionSource: "none" };
  }

  const hasVisualKeyword = VISUAL_REFERENCE_PATTERN.test(text);
  const isEntityQuestion = ENTITY_QUESTION_PATTERN.test(text);

  // Check if user explicitly mentioned any candidate's display name or stem
  const mentionsCandidateName = candidates.some((cand) => {
    const stem = cand.displayName.replace(/\.[^.]+$/, "");
    return stem.length >= 3 && text.toLowerCase().includes(stem.toLowerCase());
  });

  // Check if recent conversation has an active visual subject candidate
  const minDistance = Math.min(...candidates.map((c) => c.turnDistance));
  const recentMessages = priorMessages.slice(-6);
  const recentThreadHadVisualContext =
    minDistance <= 8 &&
    recentMessages.some(
      (m) =>
        VISUAL_REFERENCE_PATTERN.test(m.text || "") ||
        ENTITY_QUESTION_PATTERN.test(m.text || "") ||
        Boolean(m.attachments && m.attachments.some((a) => a.kind === "image")),
    );

  const isShortImmediateReply =
    minDistance === 0 &&
    trimmed.length > 0 &&
    trimmed.length <= 80 &&
    !isUnrelated;

  const isShortGuess =
    recentThreadHadVisualContext &&
    trimmed.length > 0 &&
    trimmed.length <= 40 &&
    !isUnrelated &&
    !GREETING_OPENER.test(trimmed) &&
    /^(maybe\s+)?([A-Za-z]+(\s+[A-Za-z]+)?)\??$/.test(trimmed);

  // Unrelated queries or non-visual tasks should be excluded unless explicitly naming or referencing the candidate image
  const isRelevant = !isUnrelated
    ? hasVisualKeyword || isEntityQuestion || mentionsCandidateName || isShortImmediateReply || isShortGuess
    : mentionsCandidateName;

  if (!isRelevant) {
    return { text, images: [], resolutionSource: "none" };
  }

  // 5. Candidate selection & disambiguation (Requirement 3)
  let selected: DiscoveredImageCandidate[] = [];
  const chronological = candidates.toReversed();

  // Check if multiple images requested
  if (MULTIPLE_IMAGE_PATTERN.test(text) && candidates.length > 1) {
    selected = candidates.slice(0, maxCount);
  } else if (mentionsCandidateName) {
    // Pick the specifically mentioned candidate
    const matched = candidates.filter((cand) => {
      const stem = cand.displayName.replace(/\.[^.]+$/, "");
      return stem.length >= 3 && text.toLowerCase().includes(stem.toLowerCase());
    });
    selected = matched.slice(0, 1);
  } else if (FIRST_IMAGE_PATTERN.test(text) && chronological.length > 1) {
    // First / oldest image in the conversation
    selected = [chronological[0]!];
  } else if (SECOND_IMAGE_PATTERN.test(text) && chronological.length > 1) {
    // Second image in chronological order
    selected = [chronological[Math.min(1, chronological.length - 1)]!];
  } else {
    // Default to most recent candidate
    selected = [candidates[0]!];
  }

  if (selected.length === 0) {
    return { text, images: [], resolutionSource: "none" };
  }

  // 6. Inspect physical availability on disk (Requirement 4) and provider capabilities (Requirement 5)
  const admittedImages: TurnImageInput[] = [];
  const selectedNames: string[] = [];
  // Authorship travels with the image. A bot-generated or tool-produced
  // picture is not evidence that the user shared anything, and the grounding
  // note must not let the model claim otherwise.
  const admittedAuthors: Array<{ author: AttachmentAuthor; tool?: string }> = [];

  for (const candidate of selected) {
    candidate.provenance = extractArtifactProvenance(candidate.rawPath, candidate.displayName, priorMessages);
    const status = checkImageFileStatus(candidate.rawPath, attachmentsDir);
    if (status.status === "missing") {
      const missingNote = `[Context note: The image ("${candidate.displayName}") was previously displayed in this conversation, but its underlying file is no longer available on disk (missing or expired). Explain this truthfully to the user if they are asking about the image.]`;
      return {
        text: `${text}\n\n${missingNote}`,
        images: [],
        resolutionSource: "conversation-history",
        selectedNames: [candidate.displayName],
        missingImage: true,
      };
    }

    if (status.status === "valid") {
      if (options.usesNativeImageInput === false) {
        // Selected provider cannot accept image inputs (Requirement 5)
        const limitationNote = `[Note: The user is asking about an image ("${candidate.displayName}"), but visual analysis is unavailable because the selected model/provider does not support image or multimodal input. Clearly state this limitation to the user rather than guessing or pretending the image is visible.]`;
        return {
          text: `${text}\n\n${limitationNote}`,
          images: [],
          resolutionSource: "conversation-history",
          selectedNames: [candidate.displayName],
        };
      }
      admittedImages.push({
        ...status.image,
        author: candidate.author,
        ...(candidate.tool ? { tool: candidate.tool } : {}),
        ...(candidate.sourceThreadId ?? options.threadId
          ? { ownerThreadId: candidate.sourceThreadId ?? options.threadId }
          : {}),
        ...(candidate.sourceMessageId ? { messageId: candidate.sourceMessageId } : {}),
      });
      selectedNames.push(candidate.displayName);
      admittedAuthors.push({
        author: candidate.author,
        ...(candidate.tool ? { tool: candidate.tool } : {}),
      });
    }
  }

  // Enforce caps
  if (admittedImages.length > maxCount) admittedImages.length = maxCount;
  const aggregateBytes = admittedImages.reduce((sum, img) => sum + img.bytes, 0);
  if (aggregateBytes > maxBytes) {
    while (admittedImages.length > 0 && admittedImages.reduce((sum, img) => sum + img.bytes, 0) > maxBytes) {
      admittedImages.pop();
      selectedNames.pop();
      admittedAuthors.pop();
    }
  }

  let finalText = text;
  let groundingNote: string | undefined;
  let selectedProvenance: ArtifactProvenanceInfo | undefined;

  if (admittedImages.length > 0) {
    selectedProvenance = selected[0]?.provenance;

    let provenanceClause = "";
    if (selectedProvenance?.sourceUrl) {
      const hint = selectedProvenance.subjectHint ? ` (Source subject identifier: "${selectedProvenance.subjectHint}")` : "";
      provenanceClause = ` Trusted Artifact Provenance: Sourced from "${selectedProvenance.sourceUrl}"${hint}. When trusted provenance conclusively identifies an artifact, use it appropriately as ground truth rather than claiming unassisted visual recognition or defending ungrounded guesses.`;
    }

    const authorLabel = (entry: { author: AttachmentAuthor; tool?: string }): string => {
      if (entry.author === "user") return "shared by the user";
      if (entry.author === "tool") {
        return entry.tool
          ? `generated by the ${entry.tool} tool during this conversation`
          : "generated by a tool during this conversation";
      }
      return "generated or shown by you earlier";
    };
    const attribution = selectedNames
      .map((name, index) => `${name} (${authorLabel(admittedAuthors[index] ?? { author: "assistant" })})`)
      .join(", ");
    const uniqueAuthors = new Set(admittedAuthors.map((entry) => entry.author));
    const authorshipSentence = uniqueAuthors.size === 1 && uniqueAuthors.has("user")
      ? `The user attached this image earlier in the conversation; "the image you shared" is an accurate way to refer to it.`
      : uniqueAuthors.size === 1 && uniqueAuthors.has("tool")
        ? `A tool produced this image during this conversation. Neither the user nor you supplied it as a photograph; refer to it as the image the tool produced, never as "the image you shared" or as something the user uploaded.`
        : uniqueAuthors.size === 1
          ? `You generated or showed this image in an earlier reply; the user did not attach it. Refer to it as the image you generated or showed, never as "the image you shared" or as something the user uploaded.`
          : `Some of these images were shared by the user, some were generated or shown by you, and some were produced by tools; attribute each one by its listed author, and never call a non-user image "the image you shared" or claim the user uploaded it.`;

    groundingNote = `[Visual Context: ${attribution}. ${authorshipSentence} Inspect the attached image directly to answer the user's inquiry.${provenanceClause} Evidence Hierarchy: Direct Input Evidence & Trusted Provenance > Independently Verified Facts > Inferences & Deductions > Conversational History > Unknowns. Never treat prior assistant claims in conversational history as ground truth; if earlier claims were mistaken, acknowledge and correct the mistake rather than defending it or inventing attributes (such as fabricating coastlines or borders). If you cannot identify visual subjects with complete certainty, state what can and cannot be observed with calibrated confidence rather than fabricating physical/geographic attributes or repeating prior unverified claims. Never claim that the image is unavailable or tell the user to resend it when the image is attached.]`;

    if (options.injectGroundingNote) {
      finalText = `${text}\n\n${groundingNote}`;
    }
  }

  return {
    text: finalText,
    images: admittedImages,
    resolutionSource: admittedImages.length > 0 ? "conversation-history" : "none",
    selectedNames,
    groundingNote,
    provenance: selectedProvenance,
  };
}
