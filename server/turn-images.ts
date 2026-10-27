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
import type { TurnImageInput } from "./contracts.ts";

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
  attachments?: Array<{ kind?: string; path: string; name?: string; mime?: string }>;
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

const VISUAL_REFERENCE_PATTERN =
  /\b(image|images|picture|pictures|photo|photos|screenshot|screenshots|diagram|diagrams|graphic|graphics|drawing|drawings|outline|outlines|silhouette|silhouettes|map|maps|chart|charts|figure|figures|visual|look|looks|looking|see|seeing|view|viewing|shown|above|display|displayed|depict|depicted|depicts|depiction|appear|appears|guess|guessing|correct|wrong|right|verify|verifying|verification|identify|identifying|identification|recognize|recognise|recognizing|recognising|recognition|solve|solving|inspect|inspecting|inspection|examine|examining|examination|observe|observing|observation|color|colour|shape|shapes|coast|coastline|coastlines|landlocked|border|borders|ocean|oceans|sea|seas|mountain|mountains)\b/i;

const ENTITY_QUESTION_PATTERN =
  /\b(what('?s|\s+is|\s+was|\s+am|\s+are)?|which|who('?s|\s+is|\s+was|\s+are)?|tell me|name|give|reveal|can you|could you|would you|do you (know|recognize|recognise|see)|is|are|was|were)\b.*\b(country|nation|place|state|city|region|answer|animal|object|logo|flag|subject|symbol|silhouette|shape|it|this|that|these|those)\b/i;

const UNRELATED_DOMAIN_PATTERN =
  /^\s*(what\s+is\s+)?\d+\s*[\+\-\*\/x×]\s*\d+|\b(python|javascript|typescript|bash|shell|rust|go|c|java|sql)\b|^\s*(\/|git\b|npm\b|npx\b|node\b|python\b|ls\b|cat\b|echo\b|const\b|let\b|var\b|def\b|function\b|import\b|class\b|return\b)/i;

const MULTIPLE_IMAGE_PATTERN = /\b(both|all|two|these|those|compare|each)\b/i;
const FIRST_IMAGE_PATTERN = /\b(first|1st)\b/i;
const SECOND_IMAGE_PATTERN = /\b(second|2nd)\b/i;

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

  // 1. Check current turn for direct <attached-image> tags
  if (text.includes("<attached-image")) {
    const direct = extractTurnImages(text, { attachmentsDir, maxCount, maxBytes });
    if (direct.images.length > 0) {
      return {
        text: direct.text,
        images: direct.images,
        resolutionSource: "turn-direct",
        selectedNames: direct.images.map((img) => img.path.split(/[\\/]/).at(-1) ?? ""),
      };
    }
  }

  // 2. Cross-turn resolution if priorMessages is provided
  const priorMessages = options.priorMessages;
  if (!priorMessages || priorMessages.length === 0) {
    return { text, images: [], resolutionSource: "none" };
  }

  // 3. Collect image candidates from prior messages in reverse chronological order
  const candidates: DiscoveredImageCandidate[] = [];
  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();

  for (let i = priorMessages.length - 1; i >= 0; i -= 1) {
    const pm = priorMessages[i]!;
    const distance = priorMessages.length - 1 - i;

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
          const pathKey = att.path.toLowerCase();
          const nameKey = displayName.toLowerCase();
          if (!seenPaths.has(pathKey) && !seenNames.has(nameKey)) {
            seenPaths.add(pathKey);
            seenNames.add(nameKey);
            candidates.push({
              rawPath: att.path,
              displayName,
              role: pm.role,
              turnDistance: distance,
              sourceText: pm.text,
            });
          }
        }
      }
    }

    // Check message text for <attached-image tags
    if (pm.text && pm.text.includes("<attached-image")) {
      const tags = imageTagCandidates(pm.text);
      for (let t = tags.length - 1; t >= 0; t -= 1) {
        const tag = tags[t]!;
        const displayName = tag.path.split(/[\\/]/).at(-1) || "image.png";
        const pathKey = tag.path.toLowerCase();
        const nameKey = displayName.toLowerCase();
        if (!seenPaths.has(pathKey) && !seenNames.has(nameKey)) {
          seenPaths.add(pathKey);
          seenNames.add(nameKey);
          candidates.push({
            rawPath: tag.path,
            displayName,
            role: pm.role,
            turnDistance: distance,
            sourceText: pm.text,
          });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return { text, images: [], resolutionSource: "none" };
  }

  // 4. Relevance determination (Requirement 7: Avoid unnecessary token overhead)
  const trimmed = text.trim();
  const isUnrelated = UNRELATED_DOMAIN_PATTERN.test(trimmed);

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
      admittedImages.push(status.image);
      selectedNames.push(candidate.displayName);
    }
  }

  // Enforce caps
  if (admittedImages.length > maxCount) admittedImages.length = maxCount;
  const aggregateBytes = admittedImages.reduce((sum, img) => sum + img.bytes, 0);
  if (aggregateBytes > maxBytes) {
    while (admittedImages.length > 0 && admittedImages.reduce((sum, img) => sum + img.bytes, 0) > maxBytes) {
      admittedImages.pop();
      selectedNames.pop();
    }
  }

  let finalText = text;
  let groundingNote: string | undefined;
  let selectedProvenance: ArtifactProvenanceInfo | undefined;

  if (admittedImages.length > 0) {
    const names = selectedNames.join(", ");
    selectedProvenance = selected[0]?.provenance;

    let provenanceClause = "";
    if (selectedProvenance?.sourceUrl) {
      const hint = selectedProvenance.subjectHint ? ` (Source subject identifier: "${selectedProvenance.subjectHint}")` : "";
      provenanceClause = ` Trusted Artifact Provenance: Sourced from "${selectedProvenance.sourceUrl}"${hint}. When trusted provenance conclusively identifies an artifact, use it appropriately as ground truth rather than claiming unassisted visual recognition or defending ungrounded guesses.`;
    }

    groundingNote = `[Visual Context: The image (${names}) from this conversation is attached for your visual inspection. Inspect it directly to answer the user's inquiry.${provenanceClause} Evidence Hierarchy: Direct Input Evidence & Trusted Provenance > Independently Verified Facts > Inferences & Deductions > Conversational History > Unknowns. Never treat prior assistant claims in conversational history as ground truth; if earlier claims were mistaken, acknowledge and correct the mistake rather than defending it or inventing attributes (such as fabricating coastlines or borders). If you cannot identify visual subjects with complete certainty, state what can and cannot be observed with calibrated confidence rather than fabricating physical/geographic attributes or repeating prior unverified claims. Never claim that the image is unavailable or tell the user to resend it when the image is attached.]`;

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
