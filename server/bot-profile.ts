import { z } from "zod";

import { BOT_AVATAR_CROPS, botAvatarCropSchema, botAvatarUrlSchema } from "../shared/bot-avatar.ts";
import { BOT_PROFILE_LIMITS } from "../shared/bot-profile.ts";
import { MASCOT_BODY_IDS, mascotBodySchema } from "../shared/mascot-bodies.ts";
import { MAX_MCP_SERVERS, mcpServerNameError } from "./mcp-registry.ts";

import type { BotRecord } from "./store.ts";

export {
  type RecommendationOption,
  type RecommendationPayload,
  type RecommendationRequestClass,
  type HedgingDetectionResult,
  ERR_EXCESSIVE_HEDGING,
  ExcessiveHedgingError,
  classifyRecommendationRequest,
  detectExcessiveHedging,
  validateRecommendationPayload,
  evaluateRecommendation,
  recoverFromExcessiveHedging,
  GENERIC_DISCLAIMER_PATTERNS,
  CONCLUSION_INDICATOR_PATTERNS,
} from "./recommendation.ts";

/** A name or title is quoted inside prompts and cards as one line — a
 * roster entry, a "Name: …" speaker line, the bracketed provenance note.
 * Text that can break out of that line (a newline, a control byte, the
 * Unicode separators) is refused at the door rather than flattened later,
 * so what the person sees in the sidebar is what every prompt sees too.
 * Written as a scan because a control-character class is the kind of
 * literal the linter (rightly) refuses. */
export function fitsOnOneLine(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return false;
  }
  return true;
}

export const BOT_PROFILE_PATCH_FIELDS = [
  "name",
  "title",
  "description",
  "soul",
  "notifications",
  "color",
  "avatarUrl",
  "avatarCrop",
  "mascotBody",
  "voice",
  "speakReplies",
] as const;

const profilePatchSchema = z.object({
  name: z
    .string({ error: "name must be a string" })
    .max(BOT_PROFILE_LIMITS.name, { error: "name must be at most 100 characters" })
    .refine((value) => Boolean(value.trim()), { error: "name must not be empty" })
    .refine(fitsOnOneLine, { error: "name must fit on one line" })
    .optional(),
  title: z
    .string({ error: "title must be a string" })
    .max(BOT_PROFILE_LIMITS.title, { error: "title must be at most 200 characters" })
    .refine(fitsOnOneLine, { error: "title must fit on one line" })
    .optional(),
  description: z
    .string({ error: "description must be a string" })
    .max(BOT_PROFILE_LIMITS.description, { error: "description must be at most 4000 characters" })
    .optional(),
  soul: z
    .string({ error: "soul must be a string" })
    .refine((value) => Buffer.byteLength(value, "utf8") <= BOT_PROFILE_LIMITS.soul, {
      error: "standing instructions must be at most 24000 bytes",
    })
    .optional(),
  notifications: z.boolean({ error: "notifications must be true or false" }).optional(),
  // The bot's own colour — the mascot tint and the name pill. The same ten
  // names every bot has always been created with; a person may now pick one.
  color: z
    .enum(["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"], {
      error: "color must be one of the ten bot colours",
    })
    .optional(),
  avatarUrl: z
    .union([botAvatarUrlSchema, z.literal(""), z.null()], {
      error: "avatarUrl must be a stored PNG, JPEG, GIF, or WebP attachment",
    })
    .optional(),
  avatarCrop: botAvatarCropSchema.optional(),
  mascotBody: mascotBodySchema.optional(),
  voice: z
    .string({ error: "voice must be a string" })
    .max(BOT_PROFILE_LIMITS.voice, { error: "voice must be at most 200 characters" })
    .optional(),
  speakReplies: z.boolean({ error: "speakReplies must be true or false" }).optional(),
  /** Per-bot selection of app-wide MCP servers. Same shape and rules as the
   * broad bot PATCH: null restores every enabled server, [] mounts none, a
   * list is exactly those (deduped) names. */
  mcpServers: z
    .union([
      z.null(),
      z
        .array(z.string().refine((name) => mcpServerNameError(name) === null, {
          error: "mcpServers must be a list of server names, or null",
        }))
        .max(MAX_MCP_SERVERS, { error: `Select at most ${MAX_MCP_SERVERS} MCP servers.` }),
    ])
    .optional(),
});

export type BotProfilePatchInput = z.input<typeof profilePatchSchema>;

export type BotProfilePatch = Partial<
  Pick<
    BotRecord,
    | "name"
    | "title"
    | "description"
    | "soul"
    | "notifications"
    | "avatarUrl"
    | "avatarCrop"
    | "mascotBody"
    | "voice"
    | "speakReplies"
    | "mcpServers"
  >
>;

export type BotProfilePatchResult =
  | { ok: true; patch: BotProfilePatch }
  | { ok: false; error: string };

/**
 * The shared validation boundary for profile fields. The desktop's broad bot
 * PATCH passes strict=false; paired clients use strict=true so a future bot
 * field cannot silently become remotely writable.
 *
 * avatarUrl deliberately uses `undefined` as the normalized clear value.
 * Store persistence already omits undefined fields, while wireBot sends null
 * back to clients so Codable and object-spread clients both clear stale data.
 */
export function parseBotProfilePatch(input: BotProfilePatchInput, strict = false): BotProfilePatchResult {
  const parsed = (strict ? profilePatchSchema.strict() : profilePatchSchema).safeParse(input);
  if (!parsed.success) {
    const unsupported = parsed.error.issues.find((issue) => issue.code === "unrecognized_keys");
    if (unsupported?.code === "unrecognized_keys") {
      return { ok: false, error: `unsupported profile field: ${unsupported.keys[0] ?? "unknown"}` };
    }
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "avatarCrop") {
      const options = `${BOT_AVATAR_CROPS.slice(0, -1).join(", ")}, or ${BOT_AVATAR_CROPS.at(-1)}`;
      return { ok: false, error: `avatarCrop must be ${options}` };
    }
    if (issue?.path[0] === "mascotBody") {
      const options = `${MASCOT_BODY_IDS.slice(0, -1).join(", ")}, or ${MASCOT_BODY_IDS.at(-1)}`;
      return { ok: false, error: `mascotBody must be ${options}` };
    }
    return { ok: false, error: issue?.message ?? "invalid profile patch" };
  }

  const { avatarUrl, mcpServers, ...fields } = parsed.data;
  const patch: BotProfilePatch = fields;
  if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl || undefined;
  // null (all enabled) normalizes to the record's undefined state; a list
  // is deduped exactly as the broad bot PATCH normalizes it.
  if (mcpServers !== undefined) {
    patch.mcpServers = mcpServers === null ? undefined : [...new Set(mcpServers)];
  }
  return { ok: true, patch };
}
