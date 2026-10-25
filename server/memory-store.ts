// The person-facing half of bot memory: browse it, edit it, delete it.
//
// workspace.ts owns the files (MEMORY.md and memory/ under the bot's
// workspace) and the load budget. This module owns the RULES for reaching
// those files from outside the process. A `path` arrives from HTTP, so it
// is matched against an allowlist of the three shapes memory actually has
// rather than sanitised — a rejected name is a bug report, not a path to
// be repaired. Anything else would be an arbitrary-file-read on the disk.
//
// Every write goes through writeFileAtomic at 0600 and through the secret
// scrubber first: memory is agent-authored as often as person-authored,
// and a bot that pastes a key into its own notes must not leave it on disk
// in the clear. Writes also carry an optional expected hash so an editor
// that opened the file a minute ago cannot silently overwrite an entry the
// bot wrote in between — today's whole-file PUT races memory_update.
//
// No knowledge of turns or HTTP here; the journal and the routes sit on top.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { redactSecretsInText } from "./redact.ts";
import {
  MEMORY_FILE_MAX_BYTES,
  MEMORY_MAX_BYTES as PROMPT_MEMORY_MAX_BYTES,
  MEMORY_MAX_LINES,
  ensureWorkspace,
  ensureSharedWorkspace,
  isMemoryTopicName,
  sharedWorkspaceDir,
  workspaceDir,
} from "./workspace.ts";
import {
  ERR_CROSS_BOT_MEMORY_LEAK,
  CrossBotMemoryLeakError,
  checkMemoryAccessPermission,
} from "./permission-policy.ts";
import { recordMemoryIntegrityIncident, recordMemorySecurityViolation } from "./memory-journal.ts";
import { maybeCrashMemory } from "./memory-crash-point.ts";
import {
  ERR_MEMORY_INTEGRITY,
  MemoryIntegrityError,
  MemoryIntegrityKeyUnavailableError,
  acceptLegacyIntegrity,
  assertMemoryIntegrityCurrent,
  MemoryFreshnessError,
  anchorBaselineAuthorized,
  anchorBaselineEstablished,
  memoryIntegrityStoreKey,
  rememberAnchorBaseline,
  signerAnchorHead,
  recoverInterruptedRecordsWrite,
  completeMemoryIntegrityCommit,
  legacyIntegrityAccepted,
  legacyUpgradeAuthorized,
  SIGNER_MEMORY_INTEGRITY_VERSION,
  MERKLE_MEMORY_INTEGRITY_VERSION,
  currentManifestVersion,
  markNativeMigrationComplete,
  markSignerMigrationComplete,
  memoryIntegrityKeyProvider,
  memoryIntegritySignerMode,
  nativeMigrationComplete,
  signerMigrationComplete,
  readManifest,
  resealMemoryIntegrity,
  memoryIntegrityManifestPath,
  rememberLegacyAcceptance,
  sealMemoryIntegrity,
  verifyMemoryIntegrity,
  writeMemoryIntegrityManifest,
} from "./memory-integrity.ts";

export const MEMORY_INDEX = "MEMORY.md";

/** Authoritative Phase 6 Partitioned Memory Data Contracts */
export interface PartitionedMemoryQuery {
  botId: string;
  queryText: string;
  includeShared: boolean;
  maxSharedSnippets: number;
  maxSpecializedSnippets: number;
}

export interface PartitionedMemoryResult {
  sharedSnippets: Array<{
    path: "shared/MEMORY.md";
    content: string;
  }>;
  specializedSnippets: Array<{
    path: `bots/${string}/MEMORY.md`;
    content: string;
  }>;
}

export {
  ERR_CROSS_BOT_MEMORY_LEAK,
  CrossBotMemoryLeakError,
  checkMemoryAccessPermission,
};

/** Authoritative Phase 4 memory storage limit (1 MB). */
export const MEMORY_MAX_BYTES = 1_048_576;
export const MEMORY_STORE_MAX_BYTES = 1_048_576;
export const MEMORY_RECORD_FILE = "memory/records.json";

export const ERR_MEMORY_HASH_MISMATCH = "ERR_MEMORY_HASH_MISMATCH";
export const ERR_MEMORY_STORAGE_EXCEEDED = "ERR_MEMORY_STORAGE_EXCEEDED";
/** Phase 6: a bot tried to write the shared partition as raw markdown, which
 * would bypass the confidence/relevance gate. Same family as
 * ERR_CROSS_BOT_MEMORY_LEAK: a partition boundary was crossed. */
export const ERR_SHARED_MEMORY_WRITE_GATE = "ERR_SHARED_MEMORY_WRITE_GATE";
/** How many labelled lines per partition ride into one turn's persistent
 * context. Bounded like every other injected layer. */
export const MEMORY_PARTITION_CONTEXT_MAX_LINES = 12;
/** Hard ceiling on snippets one partitioned query may return per partition,
 * whatever the caller asks for. `max*sSnippets` narrows this, never widens it. */
export const MEMORY_PARTITION_QUERY_MAX_SNIPPETS = 50;

export type MemoryCategory =
  | "stable_identity"
  | "user_preference"
  | "active_project"
  | "episodic_event";

export interface MemoryRecord {
  id: string;
  botId: string;
  category: MemoryCategory;
  headline: string;
  detail: string;
  confidence: number;
  sourceTurnId: string;
  createdAt: number;
  lastReinforcedAt: number;
  accessCount: number;
  sha256Hash: string;
  redacted: boolean;
  lifecycle?: MemoryLifecycle;
}

export type MemoryLifecycle = "active" | "archived" | "deleted";

export interface StoredMemoryRecord extends MemoryRecord {
  lifecycle: MemoryLifecycle;
  archivedAt?: number;
  deletedAt?: number;
  /** Set when a record was explicitly superseded as invalid rather than
   * merely retired because a replacement exists (Phase 5). Absent on a
   * record that was archived because a newer belief replaced it. Not part
   * of the hashed payload, exactly like archivedAt/deletedAt: the lifecycle
   * transition is what the hash covers. */
  deprecatedAt?: number;
  deprecationReason?: string;
}

export type MemoryDocKind = "index" | "topic" | "log";

export interface MemoryDocRef {
  /** The workspace-relative path as the API spells it. */
  path: string;
  kind: MemoryDocKind;
  /** File name without its directory. */
  name: string;
}

export type MemoryStoreErrorCode =
  | "path"
  | "conflict"
  | "too-large"
  | "forbidden"
  | "invalid-record"
  | "storage-exceeded"
  | "hash-mismatch"
  | "integrity"
  | "invalid-reconciliation"
  | "contradiction";

/** Carries an HTTP status so the route can answer without a lookup table.
 * A conflict also carries what is on disk now, so an editor can show the
 * bot's version next to the person's draft instead of guessing. */
export class MemoryStoreError extends Error {
  readonly status: number;
  readonly code: MemoryStoreErrorCode;
  readonly currentHash?: string;
  readonly current?: string;
  /** Set when the store verified but is not the committed generation. */
  readonly freshness: boolean;
  constructor(
    code: MemoryStoreErrorCode,
    status: number,
    message: string,
    conflict?: { currentHash: string; current: string },
    freshness = false,
  ) {
    super(message);
    this.name = "MemoryStoreError";
    this.code = code;
    this.status = status;
    this.freshness = freshness;
    if (conflict) {
      this.currentHash = conflict.currentHash;
      this.current = conflict.current;
    }
  }
}

const BOT_ID = /^[\w-]{1,128}$/;

function pathError(path: string): MemoryStoreError {
  return new MemoryStoreError("path", 400, `not a memory file: ${JSON.stringify(path)} — use MEMORY.md, memory/<topic>.md or memory/log/<day>.md`);
}

/** Only three shapes exist: the index, one topic file directly under
 * memory/, or one daily log directly under memory/log/. The name gate is
 * the same one listing uses (workspace.ts isMemoryTopicName), so what the
 * API can reach and what the overview shows agree by construction. No
 * separators inside a name means no traversal; no leading dot means no
 * dotfiles and no bare "..". Backslashes and NUL never match. */
export function parseMemoryPath(path: string): MemoryDocRef {
  if (typeof path !== "string" || !path) throw pathError(path);
  if (path === MEMORY_INDEX) return { path, kind: "index", name: MEMORY_INDEX };
  const parts = path.split("/");
  if (parts.length === 2 && parts[0] === "memory" && isMemoryTopicName(parts[1])) {
    return { path, kind: "topic", name: parts[1] };
  }
  if (parts.length === 3 && parts[0] === "memory" && parts[1] === "log" && isMemoryTopicName(parts[2])) {
    return { path, kind: "log", name: parts[2] };
  }
  throw pathError(path);
}

/**
 * Parses a partitioned memory path of the shape `shared/MEMORY.md` or `bots/<botId>/MEMORY.md`.
 */
export function parsePartitionedPath(path: string): {
  partition: "shared" | "specialized";
  botId?: string;
  relativePath: string;
} | null {
  if (typeof path !== "string") return null;
  // A malformed escape is not a name to be repaired: it is an unknown shape,
  // which the caller turns into the ordinary path refusal. Letting the
  // URIError escape would surface as a 500 instead of a fail-closed denial.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const clean = decoded.replace(/\\/g, "/");
  if (clean === "shared/MEMORY.md" || clean.startsWith("shared/")) {
    return {
      partition: "shared",
      relativePath: clean.slice("shared/".length),
    };
  }
  const match = clean.match(/^bots\/([\w-]+)\/(.+)$/);
  if (match) {
    return {
      partition: "specialized",
      botId: match[1],
      relativePath: match[2],
    };
  }
  return null;
}

function assertBotId(botId: string): void {
  if (!BOT_ID.test(botId)) throw new MemoryStoreError("path", 400, "invalid bot id");
}

function relativeSegments(ref: MemoryDocRef): string[] {
  if (ref.kind === "index") return [MEMORY_INDEX];
  if (ref.kind === "topic") return ["memory", ref.name];
  return ["memory", "log", ref.name];
}

/** The absolute path a memory document lives at, after proving it stays
 * inside the workspace. The grammar already forbids traversal; this guards
 * the other escape — a symlink. A bot with file tools can turn memory/ or
 * a topic file into a link to anywhere, and the editor would then read or
 * overwrite that target. So the nearest existing ancestor is resolved
 * through realpath and must sit under the real workspace, and the file
 * itself, when present, must be a regular file rather than a link. */
export function resolveMemoryPath(botId: string, path: string, options?: { customWorkspaceDir?: string }): string {
  assertBotId(botId);
  const ref = parseMemoryPath(path);
  let root = botId === "shared"
    ? sharedWorkspaceDir(options?.customWorkspaceDir)
    : (options?.customWorkspaceDir ?? workspaceDir(botId));
  if (options?.customWorkspaceDir && botId !== "shared") {
    if (existsSync(join(options.customWorkspaceDir, "bots", botId))) {
      root = join(options.customWorkspaceDir, "bots", botId);
    } else if (existsSync(join(options.customWorkspaceDir, botId))) {
      root = join(options.customWorkspaceDir, botId);
    }
  }
  const absolute = join(root, ...relativeSegments(ref));
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    // no workspace yet — nothing to escape from, nothing to read either
    return absolute;
  }
  let ancestor = dirname(absolute);
  while (!existsSync(ancestor) && ancestor !== root) ancestor = dirname(ancestor);
  const realAncestor = realpathSync(ancestor);
  if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + sep)) {
    throw new MemoryStoreError("path", 400, `memory path escapes the workspace: ${JSON.stringify(path)}`);
  }
  try {
    if (lstatSync(absolute).isSymbolicLink()) {
      throw new MemoryStoreError("path", 400, `memory file is a link, not a file: ${JSON.stringify(path)}`);
    }
  } catch (error) {
    if (error instanceof MemoryStoreError) throw error;
    // missing is fine: a topic the person is about to create
  }
  return absolute;
}

export function hashMemoryText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface MemoryCapacity {
  /** Lines and bytes on disk. A trailing newline counts as a line, the
   * same way the load budget counts it. */
  lines: number;
  bytes: number;
  maxLines: number;
  maxBytes: number;
  /** What loadMemory() would actually put into the system prompt. */
  loadedLines: number;
  loadedBytes: number;
  truncated: boolean;
  hash: string;
}

export interface MemoryFileInfo {
  path: string;
  name: string;
  bytes: number;
  modifiedAt: number;
}

export interface MemoryOverview {
  botId: string;
  /** Where the folder is on the server's disk — plain markdown a person
   * can open in any editor, which is why the panel says so. */
  workspacePath: string;
  index: MemoryCapacity;
  topics: MemoryFileInfo[];
  logs: MemoryFileInfo[];
}

/** Mirrors loadMemory()'s cut exactly so the gauge never claims something
 * loads that does not: first MEMORY_MAX_LINES lines, then MEMORY_MAX_BYTES
 * bytes, whichever cuts first. */
export function memoryCapacity(raw: string): MemoryCapacity {
  const lines = raw === "" ? 0 : raw.split("\n").length;
  let loaded = raw;
  let truncated = false;
  if (lines > MEMORY_MAX_LINES) {
    loaded = raw.split("\n").slice(0, MEMORY_MAX_LINES).join("\n");
    truncated = true;
  }
  if (Buffer.byteLength(loaded, "utf8") > PROMPT_MEMORY_MAX_BYTES) {
    loaded = Buffer.from(loaded, "utf8").subarray(0, PROMPT_MEMORY_MAX_BYTES).toString("utf8").replace(/�+$/, "");
    truncated = true;
  }
  return {
    lines,
    bytes: Buffer.byteLength(raw, "utf8"),
    maxLines: MEMORY_MAX_LINES,
    maxBytes: PROMPT_MEMORY_MAX_BYTES,
    loadedLines: loaded === "" ? 0 : loaded.split("\n").length,
    loadedBytes: Buffer.byteLength(loaded, "utf8"),
    truncated,
    hash: hashMemoryText(raw),
  };
}

function listMarkdown(dir: string, prefix: string): MemoryFileInfo[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files: MemoryFileInfo[] = [];
  for (const name of names) {
    if (!isMemoryTopicName(name)) continue;
    try {
      // lstat, not stat: a symlinked topic is not a memory file (see
      // resolveMemoryPath) and must not be listed as one
      const info = lstatSync(join(dir, name));
      if (!info.isFile()) continue;
      files.push({ path: `${prefix}/${name}`, name, bytes: info.size, modifiedAt: Math.round(info.mtimeMs) });
    } catch {
      // deleted between readdir and lstat: simply not listed
    }
  }
  // newest first: the file the bot just touched is the one to look at
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
}

/** Reads never create the workspace: a bot that has not run yet simply
 * has nothing to show, and an overview must not leave a folder behind. */
export function memoryOverview(botId: string): MemoryOverview {
  assertBotId(botId);
  const root = workspaceDir(botId);
  let raw = "";
  try {
    raw = readFileSync(resolveMemoryPath(botId, MEMORY_INDEX), "utf8");
  } catch (error) {
    if (error instanceof MemoryStoreError) throw error;
    raw = "";
  }
  return {
    botId,
    workspacePath: root,
    index: memoryCapacity(raw),
    topics: listMarkdown(join(root, "memory"), "memory"),
    logs: listMarkdown(join(root, "memory", "log"), "memory/log"),
  };
}

export interface MemoryDoc {
  path: string;
  text: string;
  /** sha256 of `text`; an editor sends it back as expectedHash on save. */
  hash: string;
  exists: boolean;
}

/** A missing document reads as empty rather than as an error: the topic
 * the person is about to create has no file yet, and its hash is the hash
 * of "", which is what a save of a new file must present. */
export function readMemoryDoc(
  botId: string,
  path: string,
  options: { requestingBotId?: string; customWorkspaceDir?: string } = {},
): MemoryDoc {
  if (options.requestingBotId) {
    const perm = checkMemoryAccessPermission({
      requestingBotId: options.requestingBotId,
      targetBotId: botId,
      operation: "read",
      path,
    });
    if (!perm.allowed) {
      recordMemorySecurityViolation({
        requestingBotId: options.requestingBotId,
        targetBotId: botId,
        operation: "read",
        path,
        reason: perm.error,
      });
      throw new CrossBotMemoryLeakError(options.requestingBotId, botId, perm.error);
    }
  }
  const absolute = resolveMemoryPath(botId, path, { customWorkspaceDir: options.customWorkspaceDir });
  try {
    const text = readFileSync(absolute, "utf8");
    return { path, text, hash: hashMemoryText(text), exists: true };
  } catch {
    return { path, text: "", hash: hashMemoryText(""), exists: false };
  }
}

export interface MemoryWriteResult {
  path: string;
  /** What was on disk before, or null when the file did not exist. */
  before: string | null;
  /** What is on disk now — redacted, so it can differ from the input. */
  after: string;
  hash: string;
}

/** Atomic, 0600, redacted. With `expectedHash`, the write is refused (409)
 * unless the file still hashes to what the caller last saw — the bot may
 * have written between the person's read and their save, and a whole-file
 * overwrite would erase that note without anyone noticing. */
export function writeMemoryDoc(
  botId: string,
  path: string,
  text: string,
  opts: {
    expectedHash?: string;
    requestingBotId?: string;
    customWorkspaceDir?: string;
    /** Internal direction guard: when a structured record write mirrors
     * itself into MEMORY.md, that mirror must not be parsed back into a new
     * candidate. Without this the mirror reinforces its own record, and a
     * single remembered preference is counted twice. */
    syncRecords?: boolean;
  } = {},
): MemoryWriteResult {
  if (opts.requestingBotId) {
    const perm = checkMemoryAccessPermission({
      requestingBotId: opts.requestingBotId,
      targetBotId: botId,
      operation: "write",
      path,
    });
    if (!perm.allowed) {
      recordMemorySecurityViolation({
        requestingBotId: opts.requestingBotId,
        targetBotId: botId,
        operation: "write",
        path,
        reason: perm.error,
      });
      throw new CrossBotMemoryLeakError(opts.requestingBotId, botId, perm.error);
    }
    // Phase 6: the shared markdown file is the person's surface and the
    // mirror of records that already cleared the strict shared gate. A bot
    // that could write it directly would promote any private observation
    // into team-wide memory by asking, with no confidence and no relevance
    // evidence — the exact thing the gate exists to prevent. Bot-originated
    // shared writes therefore go through putSharedMemoryRecord only.
    if (botId === "shared") {
      const reason = `${ERR_SHARED_MEMORY_WRITE_GATE}: Bot "${opts.requestingBotId}" cannot write shared memory as raw markdown. A shared write requires confidence > 0.90 and universal cross-bot relevance, which only the structured shared-record path evaluates.`;
      recordMemorySecurityViolation({
        requestingBotId: opts.requestingBotId,
        targetBotId: "shared",
        operation: "write",
        // Qualified like the partition contract spells it, so the audit row
        // says which partition the write aimed at, not just a file name.
        path: path.startsWith("shared/") ? path : `shared/${path}`,
        reason,
      });
      throw new MemoryStoreError("forbidden", 403, reason);
    }
  }
  const ref = parseMemoryPath(path);
  if (botId === "shared") {
    ensureSharedWorkspace(opts.customWorkspaceDir);
  } else {
    ensureWorkspace(botId);
  }
  const root = botId === "shared"
    ? sharedWorkspaceDir(opts.customWorkspaceDir)
    : (opts.customWorkspaceDir ?? workspaceDir(botId));
  if (ref.kind === "log") mkdirSync(join(root, "memory", "log"), { recursive: true, mode: 0o700 });
  const absolute = resolveMemoryPath(botId, path, { customWorkspaceDir: opts.customWorkspaceDir });
  const after = redactSecretsInText(text);
  const bytes = Buffer.byteLength(after, "utf8");
  if (bytes > MEMORY_FILE_MAX_BYTES) {
    throw new MemoryStoreError(
      "too-large",
      413,
      `memory files are capped at ${Math.round(MEMORY_FILE_MAX_BYTES / 1024)}KB — move longer notes into memory/<topic>.md files`,
    );
  }
  const current = readMemoryDoc(botId, path, { customWorkspaceDir: opts.customWorkspaceDir });
  if (opts.expectedHash !== undefined && opts.expectedHash !== current.hash) {
    throw new MemoryStoreError(
      "conflict",
      409,
      "this file changed since you opened it — reload to see the new version, or save again to overwrite it",
      { currentHash: current.hash, current: current.text },
    );
  }
  writeFileAtomic(absolute, after, { mode: 0o600 });
  if (ref.kind === "index" && opts.syncRecords !== false) {
    try {
      // The shared document has exactly one ingester: the shared gate. Running
      // the private-bot sync as well would parse the same lines a second way
      // and store a second, differently-worded belief for one sentence.
      if (botId === "shared") {
        ingestSharedMarkdown(after, {
          customWorkspaceDir: opts.customWorkspaceDir,
          sourceTurnId: "shared-document-save",
        });
      } else {
        syncMarkdownToRecords(botId, after, { customWorkspaceDir: opts.customWorkspaceDir });
      }
    } catch {}
  }
  return { path, before: current.exists ? current.text : null, after, hash: hashMemoryText(after) };
}

/**
 * Reads a partitioned memory document (e.g. `shared/MEMORY.md` or `bots/<botId>/MEMORY.md`).
 * Enforces cross-bot isolation and fail-closed permission policy.
 */
export function readPartitionedMemoryDoc(options: {
  requestingBotId: string;
  path: string;
  customBaseDir?: string;
}): MemoryDoc {
  const partitioned = parsePartitionedPath(options.path);
  if (partitioned) {
    if (partitioned.partition === "shared") {
      return readMemoryDoc("shared", partitioned.relativePath, {
        requestingBotId: options.requestingBotId,
        customWorkspaceDir: options.customBaseDir,
      });
    }
    const targetBot = partitioned.botId ?? options.requestingBotId;
    return readMemoryDoc(targetBot, partitioned.relativePath, {
      requestingBotId: options.requestingBotId,
      customWorkspaceDir: options.customBaseDir,
    });
  }
  return readMemoryDoc(options.requestingBotId, options.path, {
    requestingBotId: options.requestingBotId,
    customWorkspaceDir: options.customBaseDir,
  });
}

/**
 * Writes a partitioned memory document (e.g. `shared/MEMORY.md` or `bots/<botId>/MEMORY.md`).
 * Enforces cross-bot write isolation and fail-closed permission policy.
 */
export function writePartitionedMemoryDoc(options: {
  /** The bot acting, when a bot is acting. Absent for the person's own
   * writes through the memory panel: they own every partition. */
  requestingBotId?: string;
  path: string;
  text: string;
  expectedHash?: string;
  customBaseDir?: string;
}): MemoryWriteResult {
  const partitioned = parsePartitionedPath(options.path);
  if (partitioned) {
    if (partitioned.partition === "shared") {
      return writeMemoryDoc("shared", partitioned.relativePath, options.text, {
        expectedHash: options.expectedHash,
        requestingBotId: options.requestingBotId,
        customWorkspaceDir: options.customBaseDir,
      });
    }
    // A specialized path always names its bot; parsePartitionedPath only
    // returns one for `bots/<botId>/…`. Anything else is an unknown shape and
    // is refused rather than guessed at.
    const targetBot = partitioned.botId;
    if (!targetBot) throw pathError(options.path);
    return writeMemoryDoc(targetBot, partitioned.relativePath, options.text, {
      expectedHash: options.expectedHash,
      requestingBotId: options.requestingBotId,
      customWorkspaceDir: options.customBaseDir,
    });
  }
  // A path that names no partition and no acting bot has no owner to write
  // on behalf of: refuse instead of picking one.
  if (!options.requestingBotId) throw pathError(options.path);
  return writeMemoryDoc(options.requestingBotId, options.path, options.text, {
    expectedHash: options.expectedHash,
    requestingBotId: options.requestingBotId,
    customWorkspaceDir: options.customBaseDir,
  });
}

/** Topic and log files only. MEMORY.md is loaded unconditionally at turn
 * start and the next ensureWorkspace() would silently reseed it, which
 * reads as "delete did nothing" — clearing it is a write of "". */
export function deleteMemoryDoc(botId: string, path: string): { path: string; before: string | null } {
  const ref = parseMemoryPath(path);
  if (ref.kind === "index") {
    throw new MemoryStoreError("forbidden", 400, "MEMORY.md cannot be deleted — clear its text instead");
  }
  const absolute = resolveMemoryPath(botId, path);
  const current = readMemoryDoc(botId, path);
  if (current.exists) unlinkSync(absolute);
  return { path, before: current.exists ? current.text : null };
}

export type MemoryOpenTarget = "obsidian" | "folder";

export function obsidianUrlFor(workspacePath: string): string {
  return `obsidian://open?path=${encodeURIComponent(workspacePath)}`;
}

export type OpenerRunner = (command: string, args: string[]) => Promise<number | null>;

/** Runs the platform URL/folder opener and resolves its exit code; null
 * when it could not be launched or did not exit in time. Same shape as
 * cli.ts openDashboard: no shell, fixed argv, nothing from the request. */
const spawnOpener: OpenerRunner = (command, args) =>
  new Promise((done) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: "ignore", windowsHide: true, detached: true });
    } catch {
      return done(null);
    }
    const timer = setTimeout(() => {
      child.kill();
      done(null);
    }, 3000);
    child.once("error", () => {
      clearTimeout(timer);
      done(null);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      done(code);
    });
    child.unref();
  });

/** Opens the bot's memory folder on the machine running the server — in
 * Obsidian (obsidian://open?path=…) or in Finder/Explorer/the file manager.
 * The folder is on the server's disk, so this only makes sense from the
 * same machine; the route restricts it to loopback callers. The desktop
 * shell's own openExternal is http(s)-only, which is why the URL opener
 * lives here rather than going through the preload bridge. */
export async function openMemoryLocation(
  botId: string,
  target: MemoryOpenTarget,
  platform: NodeJS.Platform = process.platform,
  run: OpenerRunner = spawnOpener,
): Promise<{ ok: true; workspacePath: string } | { ok: false; error: string; workspacePath: string }> {
  assertBotId(botId);
  const workspacePath = ensureWorkspace(botId);
  const location = target === "obsidian" ? obsidianUrlFor(workspacePath) : workspacePath;
  let command: string;
  let args: string[];
  if (platform === "darwin") {
    command = "open";
    args = [location];
  } else if (platform === "win32") {
    command = target === "obsidian" ? "rundll32.exe" : "explorer.exe";
    args = target === "obsidian" ? ["url.dll,FileProtocolHandler", location] : [location];
  } else {
    command = "xdg-open";
    args = [location];
  }
  const code = await run(command, args);
  // explorer.exe reports 1 even when it opened the window; only "could not
  // launch" is a failure there
  const ok = code === 0 || (platform === "win32" && target === "folder" && code !== null);
  if (ok) return { ok: true, workspacePath };
  const error =
    target === "obsidian"
      ? `Obsidian did not open. Is it installed? The folder is ${workspacePath}`
      : `The file manager did not open. The folder is ${workspacePath}`;
  return { ok: false, error, workspacePath };
}

// ── Phase 4 Structured Long-Term Memory Subsystem ─────────────────────

/**
 * Validates a MemoryRecord against the authoritative contract.
 * Fails closed on any malformed or out-of-spec fields.
 */
export function validateMemoryRecord(record: unknown): { valid: boolean; error?: string } {
  if (typeof record !== "object" || record === null) {
    return { valid: false, error: "Record must be a non-null object" };
  }
  const r = record as Partial<StoredMemoryRecord>;
  if (typeof r.id !== "string" || !r.id.trim()) {
    return { valid: false, error: "id must be a non-empty string" };
  }
  if (typeof r.botId !== "string" || !BOT_ID.test(r.botId)) {
    return { valid: false, error: "botId must be a valid bot identifier" };
  }
  const validCategories: MemoryCategory[] = [
    "stable_identity",
    "user_preference",
    "active_project",
    "episodic_event",
  ];
  if (!r.category || !validCategories.includes(r.category)) {
    return { valid: false, error: `category must be one of: ${validCategories.join(", ")}` };
  }
  if (typeof r.headline !== "string" || !r.headline.trim() || r.headline.length > 300) {
    return { valid: false, error: "headline must be a non-empty string of max 300 characters" };
  }
  if (typeof r.detail !== "string" || !r.detail.trim() || r.detail.length > 2500) {
    return { valid: false, error: "detail must be a non-empty string of max 2500 characters" };
  }
  if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) {
    return { valid: false, error: "confidence must be a finite number between 0.00 and 1.00" };
  }
  if (typeof r.sourceTurnId !== "string" || !r.sourceTurnId.trim()) {
    return { valid: false, error: "sourceTurnId must be a non-empty string" };
  }
  if (typeof r.createdAt !== "number" || !Number.isFinite(r.createdAt) || r.createdAt <= 0) {
    return { valid: false, error: "createdAt must be a positive timestamp" };
  }
  if (typeof r.lastReinforcedAt !== "number" || !Number.isFinite(r.lastReinforcedAt) || r.lastReinforcedAt < r.createdAt) {
    return { valid: false, error: "lastReinforcedAt must be >= createdAt" };
  }
  if (typeof r.accessCount !== "number" || !Number.isFinite(r.accessCount) || r.accessCount < 0) {
    return { valid: false, error: "accessCount must be a non-negative number" };
  }
  if (typeof r.redacted !== "boolean") {
    return { valid: false, error: "redacted must be a boolean" };
  }
  if (r.lifecycle !== undefined) {
    const validLifecycles: MemoryLifecycle[] = ["active", "archived", "deleted"];
    if (!validLifecycles.includes(r.lifecycle)) {
      return { valid: false, error: `lifecycle must be one of: ${validLifecycles.join(", ")}` };
    }
  }
  // Phase 5 deprecation metadata. Optional and outside the hashed payload,
  // like archivedAt: a record archived in Phase 4 must keep validating.
  if (r.deprecatedAt !== undefined && (typeof r.deprecatedAt !== "number" || !Number.isFinite(r.deprecatedAt) || r.deprecatedAt <= 0)) {
    return { valid: false, error: "deprecatedAt must be a positive timestamp when present" };
  }
  if (r.deprecationReason !== undefined && (typeof r.deprecationReason !== "string" || r.deprecationReason.length > 500)) {
    return { valid: false, error: "deprecationReason must be a string of max 500 characters" };
  }
  if (typeof r.sha256Hash !== "string" || !verifyMemoryRecordHash(r as MemoryRecord)) {
    return { valid: false, error: "sha256Hash does not match canonical payload representation" };
  }
  return { valid: true };
}

/**
 * Deterministic serialization rule for hash integrity.
 * Sorts keys and standardizes numerical formatting and whitespace across platforms and restarts.
 */
export function canonicalMemoryPayload(record: Omit<MemoryRecord, "sha256Hash">): string {
  const normalized = {
    accessCount: Math.trunc(record.accessCount),
    botId: record.botId,
    category: record.category,
    confidence: Number(record.confidence.toFixed(4)),
    createdAt: Math.trunc(record.createdAt),
    detail: record.detail.trim(),
    headline: record.headline.trim(),
    id: record.id,
    lastReinforcedAt: Math.trunc(record.lastReinforcedAt),
    lifecycle: record.lifecycle ?? "active",
    redacted: Boolean(record.redacted),
    sourceTurnId: record.sourceTurnId,
  };
  return JSON.stringify(normalized);
}

/**
 * Computes deterministic SHA-256 hash representing canonical persisted record payload.
 */
export function computeMemoryRecordHash(record: Omit<MemoryRecord, "sha256Hash">): string {
  return createHash("sha256").update(canonicalMemoryPayload(record), "utf8").digest("hex");
}

/**
 * Verifies that a record's hash matches its canonical payload representation.
 */
export function verifyMemoryRecordHash(record: MemoryRecord): boolean {
  if (!record || typeof record.sha256Hash !== "string" || record.sha256Hash.length !== 64) {
    return false;
  }
  const { sha256Hash, ...rest } = record;
  const expected = computeMemoryRecordHash(rest);
  return sha256Hash === expected;
}

/**
 * Resolves the structured records storage file within the bot's workspace.
 * Defends against traversal and symlink escape.
 */
export function recordsFilePath(botId: string, customWorkspaceDir?: string): string {
  assertBotId(botId);
  if (botId === "shared") {
    const root = customWorkspaceDir ? sharedWorkspaceDir(customWorkspaceDir) : sharedWorkspaceDir();
    return join(root, "memory", "records.json");
  }
  let root = customWorkspaceDir ?? workspaceDir(botId);
  if (customWorkspaceDir) {
    if (existsSync(join(customWorkspaceDir, "bots", botId))) {
      root = join(customWorkspaceDir, "bots", botId);
    } else if (existsSync(join(customWorkspaceDir, botId))) {
      root = join(customWorkspaceDir, botId);
    }
  }
  return join(root, "memory", "records.json");
}

/**
 * Establish the first rollback anchor for every store that predates anchoring.
 *
 * The anchor cannot be created by the read path alone: a store nobody reads
 * this boot would stay unanchored, and the *next* boot is no longer authorized
 * to baseline it (the permission is deliberately one boot wide) — the store
 * would then fail closed forever. So the migration boot walks the roster once,
 * while it still holds the permission, and the marker is written only after
 * the walk is over: it means "every store was offered an anchor", not "one
 * store got one".
 *
 * A store that refuses is named and left alone — it stays fail-closed, and the
 * refusal is the honest outcome for bytes that cannot be shown to be the
 * committed generation. Only an operational failure keeps the marker back, so
 * the next boot tries again.
 */
export function anchorMemoryIntegrityStores(
  botIds: string[],
  options: { customBaseDir?: string } = {},
): { anchored: string[]; refused: Array<{ botId: string; reason: string }>; complete: boolean } {
  const nothing = { anchored: [], refused: [], complete: true };
  if (memoryIntegrityKeyProvider() !== "native" || !memoryIntegritySignerMode()) return nothing;
  if (!anchorBaselineAuthorized() || anchorBaselineEstablished()) return nothing;
  const anchored: string[] = [];
  const refused: Array<{ botId: string; reason: string }> = [];
  let complete = true;
  for (const botId of new Set([...botIds, "shared"])) {
    try {
      const path = recordsFilePath(botId, options.customBaseDir);
      if (!existsSync(path)) continue;
      const before = readManifest(path);
      loadMemoryRecords(botId, {
        includeArchived: true,
        includeDeleted: true,
        ...(options.customBaseDir ? { customWorkspaceDir: options.customBaseDir } : {}),
      });
      if (before && signerAnchorHead(memoryIntegrityStoreKey(botId, path))) anchored.push(botId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // A refusal is a verdict about the store, not about this boot: record it
      // and carry on, exactly like the v1→v2 migration does.
      if (error instanceof MemoryIntegrityError) refused.push({ botId, reason });
      else {
        refused.push({ botId, reason });
        complete = false;
      }
    }
  }
  if (complete) rememberAnchorBaseline();
  return { anchored, refused, complete };
}

/**
 * Move the whole installation from the retired file key to the Keystore.
 *
 * Runs once at boot while the harness still delivers the old key. Every store
 * is loaded (which verifies it with that key and re-seals its manifest under
 * the Keystore authority) before the completion marker is written.
 *
 * A store the retired key cannot authenticate is *refused*: its bytes are
 * left exactly as they are, it stays fail-closed on every later read, and it
 * is named in the marker so the refusal is durable and diagnosable. It does
 * not hold the key hostage — the key cannot make that store verify, and
 * keeping it in the host forever would undo the reason for the migration.
 * Only an operational failure (an unreadable file, a disk error) blocks the
 * marker, because that one might be transient and the old key may still be
 * the only way to read the store once the disk recovers.
 */
export function migrateMemoryIntegrityToNative(
  botIds: string[],
  options: { customBaseDir?: string } = {},
): {
  migrated: string[];
  refused: Array<{ botId: string; reason: string }>;
  blocked: Array<{ botId: string; reason: string }>;
  complete: boolean;
} {
  if (memoryIntegrityKeyProvider() !== "native") return { migrated: [], refused: [], blocked: [], complete: false };
  // Two migrations share this pass. v1→v2 re-seals the retired file key under
  // the app UID's Keystore key; v2→v3 re-seals that key under the separate-UID
  // signer. The target is whichever authority this boot can actually seal
  // with, and each has its own completion marker so the first does not stand
  // in for the second.
  const targetVersion = currentManifestVersion();
  const alreadyComplete = memoryIntegritySignerMode()
    ? signerMigrationComplete()
    : nativeMigrationComplete();
  if (alreadyComplete) return { migrated: [], refused: [], blocked: [], complete: true };
  const migrated: string[] = [];
  const refused: Array<{ botId: string; reason: string }> = [];
  const blocked: Array<{ botId: string; reason: string }> = [];
  for (const botId of new Set([...botIds, "shared"])) {
    const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
    try {
      const path = recordsFilePath(botId, options.customBaseDir);
      if (!existsSync(path)) continue;
      const before = readManifest(path);
      loadMemoryRecords(botId, {
        includeArchived: true,
        includeDeleted: true,
        ...(options.customBaseDir ? { customWorkspaceDir: options.customBaseDir } : {}),
      });
      if (before && before.version !== targetVersion) migrated.push(botId);
    } catch (error) {
      if (error instanceof MemoryIntegrityKeyUnavailableError) {
        // Nothing was verified: this boot simply cannot reach the retired
        // key. Keep it in service rather than record a tampering verdict.
        blocked.push({ botId, reason: reasonOf(error) });
        continue;
      }
      const authenticity =
        error instanceof MemoryIntegrityError ||
        (error instanceof MemoryStoreError && error.code === "integrity");
      (authenticity ? refused : blocked).push({ botId, reason: reasonOf(error) });
    }
  }
  if (blocked.length === 0) {
    if (memoryIntegritySignerMode()) markSignerMigrationComplete(migrated, refused);
    else markNativeMigrationComplete(migrated, refused);
    return { migrated, refused, blocked, complete: true };
  }
  return { migrated, refused, blocked, complete: false };
}

/**
 * Creates an authoritative MemoryRecord with mandatory secret redaction and deterministic hashing.
 * Invariant: CANDIDATE -> redactSecretsInText() -> ONLY THEN -> DISK WRITE
 */
export function createMemoryRecord(params: {
  id?: string;
  botId: string;
  category: MemoryCategory;
  headline: string;
  detail: string;
  confidence: number;
  sourceTurnId: string;
  createdAt?: number;
  lastReinforcedAt?: number;
  accessCount?: number;
  lifecycle?: MemoryLifecycle;
}): StoredMemoryRecord {
  assertBotId(params.botId);
  const rawHeadline = (params.headline || "").trim();
  const rawDetail = (params.detail || "").trim();

  // Enforce canonical secret redaction prior to hashing or disk persistence
  const headline = redactSecretsInText(rawHeadline);
  const detail = redactSecretsInText(rawDetail);
  const redacted = headline !== rawHeadline || detail !== rawDetail;

  const id = params.id || randomUUID();
  const now = Date.now();
  const createdAt = params.createdAt ?? now;
  const lastReinforcedAt = params.lastReinforcedAt ?? createdAt;
  const accessCount = params.accessCount ?? 0;
  const lifecycle: MemoryLifecycle = params.lifecycle ?? "active";

  const recordWithoutHash: Omit<MemoryRecord, "sha256Hash"> = {
    id,
    botId: params.botId,
    category: params.category,
    headline,
    detail,
    confidence: Number(params.confidence.toFixed(4)),
    sourceTurnId: params.sourceTurnId,
    createdAt,
    lastReinforcedAt,
    accessCount,
    redacted,
    lifecycle,
  };

  const sha256Hash = computeMemoryRecordHash(recordWithoutHash);
  const record: StoredMemoryRecord = { ...recordWithoutHash, lifecycle, sha256Hash };

  const validation = validateMemoryRecord(record);
  if (!validation.valid) {
    throw new MemoryStoreError("invalid-record", 400, validation.error ?? "Invalid memory record");
  }
  return record;
}

/** A failed authenticity check is not a parse error: it means the bytes on
 * disk are not the bytes this server wrote. Nothing from the partition may
 * reach context, and the refusal is recorded without the record text. */
function integrityFailure(botId: string, message: string, freshness = false): never {
  recordMemoryIntegrityIncident({ botId, path: "memory/records.json", reason: message });
  throw new MemoryStoreError("integrity", 500, `${ERR_MEMORY_INTEGRITY}: ${message}`, undefined, freshness);
}

/**
 * Loads all stored memory records for a bot from its workspace.
 * Validates integrity and detects corrupted JSON or mismatched hashes.
 */
export function loadMemoryRecords(
  botId: string,
  options: {
    customWorkspaceDir?: string;
    includeArchived?: boolean;
    includeDeleted?: boolean;
    /** Filled with the hash of the exact bytes this call verified, so a save
     *  that replaces those same bytes does not verify them a second time.
     *  Absent unless the caller asked; never used to skip a *different* read. */
    verifiedHash?: { value?: string };
  } = {}
): StoredMemoryRecord[] {
  assertBotId(botId);
  const path = recordsFilePath(botId, options.customWorkspaceDir);
  if (!existsSync(path)) {
    // A manifest without its records is not an empty store: it is the
    // fingerprint of a deletion. An empty store is represented by an empty
    // array plus a count-0 manifest, which is written by the canonical path.
    if (existsSync(memoryIntegrityManifestPath(path))) {
      integrityFailure(botId, "records.json is missing but its integrity manifest still exists");
    }
    // Both files gone is the documented bot-workspace removal: nothing is
    // left to verify and nothing can be forged from absence. Deleting the
    // records and then writing new ones does NOT take this branch — the
    // ledger check below refuses that reseal — so removal cannot be used to
    // erase evidence and then plant a fresh store in its place.
    return [];
  }

  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  if (!raw.trim()) {
    if (existsSync(memoryIntegrityManifestPath(path)) || legacyIntegrityAccepted(botId, path)) {
      integrityFailure(botId, "records.json is empty after upgrade");
    }
    return [];
  }
  // The bytes named here are the ones every check below operates on; if this
  // call returns, they verified.
  if (options.verifiedHash) options.verifiedHash.value = hashMemoryText(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MemoryStoreError(
      "hash-mismatch",
      500,
      `${ERR_MEMORY_HASH_MISMATCH}: records.json is corrupted and contains invalid JSON`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new MemoryStoreError(
      "hash-mismatch",
      500,
      `${ERR_MEMORY_HASH_MISMATCH}: records.json payload is not an array`
    );
  }

  const allRecords: StoredMemoryRecord[] = [];
  for (const item of parsed) {
    const record = item as StoredMemoryRecord;
    const validation = validateMemoryRecord(record);
    if (!validation.valid) {
      recordMemoryIntegrityIncident({
        botId,
        path: "memory/records.json",
        reason: `record ${record?.id ?? "unknown"} failed validation: ${validation.error}`,
      });
      throw new MemoryStoreError(
        "hash-mismatch",
        500,
        `${ERR_MEMORY_HASH_MISMATCH}: record ${record?.id ?? "unknown"} failed validation: ${validation.error}`
      );
    }
    if (!verifyMemoryRecordHash(record)) {
      recordMemoryIntegrityIncident({
        botId,
        path: "memory/records.json",
        reason: `record ${record.id} sha256Hash mismatch detected on disk`,
      });
      throw new MemoryStoreError(
        "hash-mismatch",
        500,
        `${ERR_MEMORY_HASH_MISMATCH}: record ${record.id} sha256Hash mismatch detected on disk`
      );
    }
    allRecords.push(record);
  }

  // Authenticity is checked before lifecycle filtering: an archived record
  // still carries an owner, a provenance, and a lifecycle transition, and a
  // tampered one is evidence rather than something to hide from the check.
  try {
    if (!existsSync(memoryIntegrityManifestPath(path))) {
      if (allRecords.length === 0) return [];
      if (legacyIntegrityAccepted(botId, path)) {
        integrityFailure(botId, "records.json has no integrity manifest and this store was already upgraded");
      }
      // A manifest-less store is adopted only by a boot the harness armed for
      // it (the one boot that still holds the retired key). The manifest and
      // the ledger are both writable by the application UID — measured on the
      // Galaxy A07: deleting them, then rolling a record out of records.json,
      // made this branch re-seal the reduced store with a live Keystore MAC.
      // On-disk state cannot prove "never sealed", so the boot proves it.
      if (!legacyUpgradeAuthorized()) {
        integrityFailure(
          botId,
          "records.json has no integrity manifest and this boot is not authorized to adopt an unsealed store",
        );
      }
      // One-time upgrade of a pre-authenticity store. The ledger written here
      // is what makes a later manifest deletion a failure instead of a second
      // automatic blessing of whatever is on disk.
      acceptLegacyIntegrity(botId, allRecords, path);
    } else {
      let verified: ReturnType<typeof verifyMemoryIntegrity>;
      try {
        verified = verifyMemoryIntegrity(allRecords, path, botId);
      } catch (error) {
        // One interrupted write is recoverable: records durable at N+1, the
        // manifest still at N, and N+1 prepared in the signer. The recovery
        // only proceeds when the file's digest equals the candidate the signer
        // itself recorded, so it cannot bless arbitrary bytes. Everything else
        // keeps failing closed, exactly as before.
        if (!(error instanceof MemoryIntegrityError) || !recoverInterruptedRecordsWrite(botId, path)) {
          throw error;
        }
        verified = verifyMemoryIntegrity(allRecords, path, botId);
      }
      // A crash between the manifest and the ledger is harmless: the manifest
      // authenticates the store, and this records that the workspace has been
      // upgraded so a later manifest deletion cannot look like a first run.
      if (!legacyIntegrityAccepted(botId, path)) rememberLegacyAcceptance(botId, verified.manifest, path);
      // The migration boot still holds the retired key, so this store has just
      // been verified with it. Re-seal only the manifest under the Keystore
      // authority; the records themselves are never rewritten.
      // Re-seal only the manifest, and only *up* to the version this boot
      // seals: a v2 store verified with the app UID's key becomes v3 on the
      // first signer boot, and the signer's store is left alone afterwards.
      // The records themselves are never rewritten.
      //
      // Never the other direction. Measured on the Galaxy A07: a restart whose
      // signer enrollment missed the harness's startup wait spawned the host
      // with `OMB_MEMORY_INTEGRITY_SIGNER=0`; a v3 store was verified under the
      // signer's own MACs and then re-sealed as v2 under the app UID's key,
      // dropping the signer-owned freshness anchor for every later generation
      // without a single failed check. A v3 store means the signer sealed it,
      // so a boot without the signer authority cannot re-bless it — it fails
      // closed and the next enrolled boot verifies it normally.
      const sealingVersion = currentManifestVersion();
      const signerSealed =
        verified.manifest.version === SIGNER_MEMORY_INTEGRITY_VERSION ||
        verified.manifest.version === MERKLE_MEMORY_INTEGRITY_VERSION;
      const signerBoot =
        sealingVersion === SIGNER_MEMORY_INTEGRITY_VERSION ||
        sealingVersion === MERKLE_MEMORY_INTEGRITY_VERSION;
      if (signerSealed && !signerBoot) {
        throw new MemoryIntegrityError(
          "records were sealed by the separate-UID signer but this boot has no signer authority; " +
            "refusing to move the store to a weaker integrity provider",
        );
      }
      if (verified.manifest.version !== sealingVersion && memoryIntegrityKeyProvider() === "native") {
        resealMemoryIntegrity(botId, allRecords, path, verified.manifest);
      } else {
        // Authenticity is settled by the MACs above. Freshness is a separate
        // question — an older but validly sealed snapshot passes every MAC —
        // and it is answered by the signer's own committed generation. This
        // throws before a single record reaches a caller when the store is
        // older than what was committed, and completes a commit that a crash
        // left unfinished when it is exactly one step ahead.
        assertMemoryIntegrityCurrent(botId, path, verified.manifest);
      }
    }
  } catch (error) {
    if (error instanceof MemoryIntegrityError) {
      integrityFailure(botId, error.message, error instanceof MemoryFreshnessError);
    }
    throw error;
  }

  const validRecords = allRecords.filter((record) => {
    if (record.lifecycle === "deleted" && !options.includeDeleted) return false;
    if (record.lifecycle === "archived" && !options.includeArchived) return false;
    return true;
  });

  return validRecords;
}

/**
 * Evaluates ranking value score for semantic compaction.
 * Higher score = more valuable, preserved during compaction.
 */
function memoryRecordValueScore(record: StoredMemoryRecord): number {
  let categoryMultiplier = 1.0;
  switch (record.category) {
    case "stable_identity":
      categoryMultiplier = 100.0;
      break;
    case "user_preference":
      categoryMultiplier = 50.0;
      break;
    case "active_project":
      categoryMultiplier = 20.0;
      break;
    case "episodic_event":
      categoryMultiplier = 1.0;
      break;
  }
  const confidenceScore = record.confidence * 20;
  const accessScore = Math.min(record.accessCount * 2, 20);
  const ageDays = Math.max(0, (Date.now() - record.lastReinforcedAt) / 86_400_000);
  const recencyScore = Math.max(0, 10 - ageDays);
  return categoryMultiplier * 100 + confidenceScore + accessScore + recencyScore;
}

/**
 * Performs semantic compaction in-memory, archiving low-value episodic memories first
 * while strictly preserving stable identity, meaningful preferences, and active projects.
 */
export function compactRecordsInMemory(
  records: StoredMemoryRecord[],
  targetBytes: number = MEMORY_MAX_BYTES * 0.80
): StoredMemoryRecord[] {
  let currentBytes = Buffer.byteLength(JSON.stringify(records, null, 2), "utf8");
  if (currentBytes <= targetBytes) return records;

  const cloned = records.map((r) => ({ ...r }));

  // Separate protected core memories from archivable memories
  const archivable = cloned.filter(
    (r) =>
      r.lifecycle === "active" &&
      r.category !== "stable_identity" &&
      !(r.category === "user_preference" && r.confidence >= 0.85) &&
      r.category !== "active_project"
  );

  // Sort ascending by value score (lowest score archived first)
  archivable.sort((a, b) => memoryRecordValueScore(a) - memoryRecordValueScore(b));

  for (const record of archivable) {
    record.lifecycle = "archived";
    record.archivedAt = Date.now();
    const { sha256Hash: _oldHash, ...rest } = record;
    record.sha256Hash = computeMemoryRecordHash(rest);
  }

  let remainingRecords = cloned;
  currentBytes = Buffer.byteLength(JSON.stringify(remainingRecords, null, 2), "utf8");

  // If still above target bytes, prune oldest archived records
  if (currentBytes > targetBytes) {
    const activeOnly = remainingRecords.filter((r) => r.lifecycle === "active");
    const archivedOnly = remainingRecords.filter((r) => r.lifecycle === "archived");
    archivedOnly.sort((a, b) => (a.archivedAt ?? a.createdAt) - (b.archivedAt ?? b.createdAt));

    while (archivedOnly.length > 0 && currentBytes > targetBytes) {
      archivedOnly.shift();
      currentBytes = Buffer.byteLength(JSON.stringify([...activeOnly, ...archivedOnly], null, 2), "utf8");
    }
    remainingRecords = [...activeOnly, ...archivedOnly];
  }

  return remainingRecords;
}

/**
 * Saves memory records atomically to disk with mode 0600.
 * Handles concurrency conflicts via 3-way record merge and exponential backoff.
 * Enforces MEMORY_MAX_BYTES (1 MB) storage limit and triggers semantic compaction.
 */
export function saveMemoryRecords(
  botId: string,
  records: StoredMemoryRecord[],
  options: {
    expectedFileHash?: string;
    customWorkspaceDir?: string;
    skipCompaction?: boolean;
    maxRetries?: number;
    /** Hash of bytes a caller verified in this same operation. When the file
     *  still hashes to it, the pre-seal re-verification would be the identical
     *  MAC work on identical bytes; when it does not, verification runs. */
    verifiedFileHash?: string;
  } = {}
): { path: string; bytes: number; count: number; hash: string } {
  assertBotId(botId);
  const root = options.customWorkspaceDir ?? workspaceDir(botId);
  const dir = join(root, "memory");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const filePath = recordsFilePath(botId, options.customWorkspaceDir);
  const maxRetries = options.maxRetries ?? 3;

  let currentRecords = records;
  let attempts = 0;

  while (attempts <= maxRetries) {
    // Validate every record prior to writing
    for (const record of currentRecords) {
      const val = validateMemoryRecord(record);
      if (!val.valid) {
        throw new MemoryStoreError("invalid-record", 400, `Cannot persist invalid record: ${val.error}`);
      }
    }

    // Detect concurrent mutation if expectedFileHash was specified
    if (options.expectedFileHash !== undefined && existsSync(filePath)) {
      const currentText = readFileSync(filePath, "utf8");
      const currentHash = hashMemoryText(currentText);

      if (currentHash !== options.expectedFileHash) {
        if (attempts >= maxRetries) {
          throw new MemoryStoreError(
            "conflict",
            409,
            `${ERR_MEMORY_HASH_MISMATCH}: Memory storage was modified concurrently and conflict could not be reconciled`
          );
        }

        // Perform 3-way merge on record level
        const diskRecords = loadMemoryRecords(botId, {
          customWorkspaceDir: options.customWorkspaceDir,
          includeArchived: true,
          includeDeleted: true,
        });

        const mergedMap = new Map<string, StoredMemoryRecord>();
        for (const d of diskRecords) {
          mergedMap.set(d.id, d);
        }
        for (const r of currentRecords) {
          const existing = mergedMap.get(r.id);
          if (!existing) {
            mergedMap.set(r.id, r);
          } else if (existing.lifecycle !== "active" && r.lifecycle === "active") {
            // Disk transitioned to archived or deleted; preserve disk lifecycle transition
            mergedMap.set(r.id, existing);
          } else if (r.lifecycle !== "active" && existing.lifecycle === "active") {
            // Current transitioned to archived or deleted; take current
            mergedMap.set(r.id, r);
          } else if (r.lastReinforcedAt > existing.lastReinforcedAt) {
            mergedMap.set(r.id, r);
          } else if (r.confidence > existing.confidence) {
            mergedMap.set(r.id, r);
          } else {
            mergedMap.set(r.id, existing);
          }
        }
        currentRecords = Array.from(mergedMap.values());
        options.expectedFileHash = currentHash;
        attempts++;
        continue;
      }
    }

    let jsonString = JSON.stringify(currentRecords, null, 2);
    let bytes = Buffer.byteLength(jsonString, "utf8");

    // Enforce 1 MB storage limit
    if (bytes > MEMORY_MAX_BYTES) {
      if (!options.skipCompaction) {
        const compacted = compactRecordsInMemory(currentRecords, MEMORY_MAX_BYTES * 0.85);
        jsonString = JSON.stringify(compacted, null, 2);
        bytes = Buffer.byteLength(jsonString, "utf8");
        currentRecords = compacted;

        if (bytes > MEMORY_MAX_BYTES) {
          throw new MemoryStoreError(
            "storage-exceeded",
            413,
            `${ERR_MEMORY_STORAGE_EXCEEDED}: Memory store size (${bytes} bytes) exceeds maximum allowed ${MEMORY_MAX_BYTES} bytes even after compaction`
          );
        }
      } else {
        throw new MemoryStoreError(
          "storage-exceeded",
          413,
          `${ERR_MEMORY_STORAGE_EXCEEDED}: Memory store size (${bytes} bytes) exceeds maximum allowed ${MEMORY_MAX_BYTES} bytes`
        );
      }
    }

    // A save may only replace a store that still verifies. Without this, a
    // caller that skipped the load (or a future shortcut) could hand the
    // canonical writer a tampered array and have it signed as truth. The
    // check runs before the records hit disk so a failed save changes none.
    if (existsSync(filePath) && existsSync(memoryIntegrityManifestPath(filePath))) {
      const currentBytes = readFileSync(filePath, "utf8");
      const unchanged = options.verifiedFileHash !== undefined &&
        hashMemoryText(currentBytes) === options.verifiedFileHash;
      if (!unchanged) {
        loadMemoryRecords(botId, {
          customWorkspaceDir: options.customWorkspaceDir,
          includeArchived: true,
          includeDeleted: true,
        });
      }
    }

    // Sealing happens before the records hit disk: if the existing manifest
    // is corrupt or the store was upgraded and then had its manifest removed,
    // this refuses rather than turning a save into a repair of tampered data.
    const hadManifest = existsSync(memoryIntegrityManifestPath(filePath));
    if (!hadManifest && existsSync(filePath) && legacyIntegrityAccepted(botId, filePath)) {
      throw new MemoryStoreError(
        "integrity",
        500,
        `${ERR_MEMORY_INTEGRITY}: refusing to reseal a store whose integrity manifest was removed after upgrade`,
      );
    }
    // Same rule for the write path: without an authorized adoption, a save
    // over a manifest-less file would sign whatever the file happens to hold —
    // including records a same-UID process planted after deleting the manifest.
    if (!hadManifest && existsSync(filePath) && !legacyUpgradeAuthorized()) {
      throw new MemoryStoreError(
        "integrity",
        500,
        `${ERR_MEMORY_INTEGRITY}: refusing to seal records.json without an integrity manifest — this boot is not authorized to adopt an unsealed store`,
      );
    }
    maybeCrashMemory("before-prepare");
    let manifest: ReturnType<typeof sealMemoryIntegrity>;
    try {
      manifest = sealMemoryIntegrity(botId, currentRecords, filePath);
    } catch (error) {
      if (error instanceof MemoryIntegrityError) integrityFailure(botId, error.message);
      throw error;
    }

    // Write atomically with strict 0600 file mode
    writeFileAtomic(filePath, jsonString, { mode: 0o600 });
    maybeCrashMemory("after-records");
    writeMemoryIntegrityManifest(filePath, manifest);
    maybeCrashMemory("after-manifest");
    // The manifest is durable; now the generation becomes official. A crash
    // before this line leaves the *next* read to complete the same step, and a
    // crash before the manifest write leaves the previous generation intact.
    maybeCrashMemory("before-commit");
    completeMemoryIntegrityCommit(botId, filePath, manifest);
    maybeCrashMemory("after-commit");
    if (!hadManifest && !legacyIntegrityAccepted(botId, filePath)) rememberLegacyAcceptance(botId, manifest, filePath);
    const finalHash = hashMemoryText(jsonString);

    return {
      path: filePath,
      bytes,
      count: currentRecords.length,
      hash: finalHash,
    };
  }

  throw new MemoryStoreError(
    "conflict",
    409,
    `${ERR_MEMORY_HASH_MISMATCH}: Concurrent modification retry limit exhausted`
  );
}

/**
 * Triggers semantic compaction explicitly on a bot's memory store.
 */
export function compactMemoryStore(
  botId: string,
  options: { customWorkspaceDir?: string; targetBytes?: number } = {}
): { compacted: boolean; beforeBytes: number; afterBytes: number; archivedCount: number } {
  assertBotId(botId);
  const records = loadMemoryRecords(botId, {
    customWorkspaceDir: options.customWorkspaceDir,
    includeArchived: true,
    includeDeleted: true,
  });

  const beforeJson = JSON.stringify(records, null, 2);
  const beforeBytes = Buffer.byteLength(beforeJson, "utf8");
  const beforeArchived = records.filter((r) => r.lifecycle === "archived").length;

  const compacted = compactRecordsInMemory(records, options.targetBytes ?? MEMORY_MAX_BYTES * 0.80);
  const result = saveMemoryRecords(botId, compacted, {
    customWorkspaceDir: options.customWorkspaceDir,
    skipCompaction: true,
  });

  const afterArchived = compacted.filter((r) => r.lifecycle === "archived").length;
  notifyRecordJournal(botId, { action: "compact", recordId: `compacted-${Date.now()}` });

  return {
    compacted: true,
    beforeBytes,
    afterBytes: result.bytes,
    archivedCount: Math.max(0, afterArchived - beforeArchived),
  };
}

function notifyRecordJournal(
  botId: string,
  entry: {
    action: "create" | "reinforce" | "archive" | "delete" | "compact";
    recordId: string;
    category?: string;
    headline?: string;
    confidence?: number;
    sourceTurnId?: string;
    via?: string;
  }
): void {
  import("./memory-journal.ts")
    .then((j) => j.recordMemoryRecordJournalEntry(botId, entry))
    .catch(() => {});
}

/**
 * Checks for substantially identical active records to prevent duplicate accumulation.
 */
export function findSubstantiallyIdenticalRecord(
  records: StoredMemoryRecord[],
  candidate: { category: MemoryCategory; headline: string; detail: string }
): StoredMemoryRecord | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candHeadlineNorm = norm(candidate.headline);
  const candDetailNorm = norm(candidate.detail);

  for (const r of records) {
    if (r.lifecycle !== "active") continue;
    if (r.category !== candidate.category) continue;

    const rHeadlineNorm = norm(r.headline);
    if (rHeadlineNorm === candHeadlineNorm) return r;

    // Substantial detail overlap
    const rDetailNorm = norm(r.detail);
    if (
      candDetailNorm.length > 10 &&
      rDetailNorm.length > 10 &&
      (candDetailNorm.includes(rDetailNorm) || rDetailNorm.includes(candDetailNorm))
    ) {
      return r;
    }
  }
  return null;
}

/**
 * Determines whether candidate memory information meets universal relevance
 * requirements across the bot team rather than specialist/task-local private notes.
 */
export function isUniversallyRelevant(
  headline: string,
  detail: string,
  category: MemoryCategory,
): { relevant: boolean; reason: string } {
  const combined = `${headline} ${detail}`.toLowerCase();

  const roleSpecificPatterns = [
    /\b(?:coder|researcher|planner|specialist|agent)\s+(?:thinks|concluded|found|believes|decided|bookmarked|noted|suggests)\b/i,
    /\bthis\s+(?:particular\s+)?(?:helper|function|class|method|file|script|investigation|notebook|dependency|ordering)\b/i,
    /\bmilestone\s+\d+\s+should\s+happen\s+before\s+milestone\s+\d+\b/i,
    /\bfor\s+this\s+one\s+investigation\b/i,
    /\bprivate\s+note\b/i,
    /\bunfinished\s+specialist\s+task\b/i,
    /\btask-local\b/i,
  ];

  for (const pattern of roleSpecificPatterns) {
    if (pattern.test(combined)) {
      return {
        relevant: false,
        reason: "Contains role-specific, task-local, or specialist-private indicators",
      };
    }
  }

  if (category === "stable_identity") {
    return { relevant: true, reason: "Stable identity is universally relevant across bots" };
  }

  if (category === "user_preference") {
    return { relevant: true, reason: "Global user preference is universally relevant" };
  }

  if (category === "active_project") {
    return { relevant: true, reason: "Active project context is universally relevant across bots" };
  }

  if (category === "episodic_event") {
    if (/\b(?:launched|migrated all|company-wide|team-wide|switched permanently)\b/i.test(combined)) {
      return { relevant: true, reason: "Team-wide episodic milestone is universally relevant" };
    }
    return { relevant: false, reason: "Episodic events require team-wide or universal significance" };
  }

  return { relevant: false, reason: "Does not meet universal relevance criteria" };
}

/**
 * Validates candidate against shared memory write gate:
 * 1. Confidence must be strictly > 0.90
 * 2. Universal cross-bot relevance must be established
 */
export function validateSharedMemoryWrite(candidate: {
  category: MemoryCategory;
  headline: string;
  detail: string;
  confidence: number;
}): { valid: boolean; error?: string } {
  if (typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence <= 0.90) {
    return {
      valid: false,
      error: `Shared memory requires confidence strictly greater than 0.90 (got ${typeof candidate.confidence === "number" ? candidate.confidence.toFixed(2) : candidate.confidence})`,
    };
  }
  const relevance = isUniversallyRelevant(candidate.headline, candidate.detail, candidate.category);
  if (!relevance.relevant) {
    return {
      valid: false,
      error: `Shared memory write rejected: ${relevance.reason}`,
    };
  }
  return { valid: true };
}

function syncRecordToMarkdown(
  botId: string,
  record: StoredMemoryRecord,
  options: { customWorkspaceDir?: string } = {}
): void {
  try {
    const mem = readMemoryDoc(botId, MEMORY_INDEX, { customWorkspaceDir: options.customWorkspaceDir });
    const line = `- ${record.headline}: ${record.detail}`;
    if (!mem.text.includes(record.headline)) {
      const nextText = mem.text ? `${mem.text.trim()}\n${line}\n` : `# Memory\n\n${line}\n`;
      // syncRecords: false — the record is already in the store and this is
      // its forward mirror, not a new observation. See writeMemoryDoc.
      writeMemoryDoc(botId, MEMORY_INDEX, nextText, {
        customWorkspaceDir: options.customWorkspaceDir,
        syncRecords: false,
      });
    }
  } catch {}
}

/**
 * Puts a candidate memory into the store, reinforcing existing records on duplicate.
 */
export function putMemoryRecord(
  botId: string,
  candidate: {
    category: MemoryCategory;
    headline: string;
    detail: string;
    confidence: number;
    sourceTurnId: string;
    id?: string;
  },
  options: {
    customWorkspaceDir?: string;
    requestingBotId?: string;
    /** Off for a record that was just parsed *out of* MEMORY.md: its line is
     * already in the file, and mirroring it back would append a normalised
     * duplicate under the person's own edit. */
    mirror?: boolean;
  } = {}
): { record: MemoryRecord; created: boolean; reinforced: boolean } {
  assertBotId(botId);

  // Cross-bot write boundary enforcement
  if (options.requestingBotId && botId !== "shared" && options.requestingBotId !== botId) {
    const permError = `${ERR_CROSS_BOT_MEMORY_LEAK}: Bot "${options.requestingBotId}" cannot write private memory of Bot "${botId}".`;
    recordMemorySecurityViolation({
      requestingBotId: options.requestingBotId,
      targetBotId: botId,
      operation: "write",
      reason: permError,
    });
    throw new CrossBotMemoryLeakError(options.requestingBotId, botId, permError);
  }

  // Shared memory write gating: confidence > 0.90 and universal cross-bot relevance
  if (botId === "shared") {
    const gate = validateSharedMemoryWrite(candidate);
    if (!gate.valid) {
      throw new MemoryStoreError("forbidden", 403, gate.error ?? "Shared memory write rejected by gating policy");
    }
  }
  const verified: { value?: string } = {};
  const existingRecords = loadMemoryRecords(botId, {
    customWorkspaceDir: options.customWorkspaceDir,
    includeArchived: true,
    includeDeleted: true,
    verifiedHash: verified,
  });

  const identical = findSubstantiallyIdenticalRecord(existingRecords, candidate);
  if (identical && identical.lifecycle === "active") {
    // Reinforce existing record
    identical.lastReinforcedAt = Date.now();
    identical.accessCount += 1;
    identical.confidence = Math.min(1.0, Number((identical.confidence + 0.02).toFixed(4)));
    identical.sourceTurnId = candidate.sourceTurnId;

    if (candidate.detail.length > identical.detail.length && !identical.detail.includes(candidate.detail)) {
      const scrubbed = redactSecretsInText(candidate.detail);
      identical.detail = scrubbed;
      identical.redacted = identical.redacted || scrubbed !== candidate.detail;
    }

    const { sha256Hash: _oldHash, ...rest } = identical;
    identical.sha256Hash = computeMemoryRecordHash(rest);

    saveMemoryRecords(botId, existingRecords, {
      customWorkspaceDir: options.customWorkspaceDir,
      verifiedFileHash: verified.value,
    });
    notifyRecordJournal(botId, {
      action: "reinforce",
      recordId: identical.id,
      category: identical.category,
      headline: identical.headline,
      confidence: identical.confidence,
      sourceTurnId: candidate.sourceTurnId,
    });
    if (options.mirror !== false) syncRecordToMarkdown(botId, identical, { customWorkspaceDir: options.customWorkspaceDir });
    return { record: identical, created: false, reinforced: true };
  }

  // Create fresh record
  const record = createMemoryRecord({
    id: candidate.id,
    botId,
    category: candidate.category,
    headline: candidate.headline,
    detail: candidate.detail,
    confidence: candidate.confidence,
    sourceTurnId: candidate.sourceTurnId,
    lifecycle: "active",
  });

  existingRecords.push(record);
  saveMemoryRecords(botId, existingRecords, {
    customWorkspaceDir: options.customWorkspaceDir,
    verifiedFileHash: verified.value,
  });
  notifyRecordJournal(botId, {
    action: "create",
    recordId: record.id,
    category: record.category,
    headline: record.headline,
    confidence: record.confidence,
    sourceTurnId: record.sourceTurnId,
  });
  if (options.mirror !== false) syncRecordToMarkdown(botId, record, { customWorkspaceDir: options.customWorkspaceDir });

  return { record, created: true, reinforced: false };
}

/**
 * Puts a shared memory record into the shared partition, enforcing
 * strict write gating (confidence > 0.90, universal cross-bot relevance).
 */
export function putSharedMemoryRecord(
  candidate: {
    category: MemoryCategory;
    headline: string;
    detail: string;
    confidence: number;
    sourceTurnId: string;
    id?: string;
  },
  options: { customWorkspaceDir?: string; requestingBotId?: string; mirror?: boolean } = {}
): { record: MemoryRecord; created: boolean; reinforced: boolean } {
  return putMemoryRecord("shared", candidate, options);
}

/**
 * Archives an active memory record, removing it from active retrieval.
 */
export function archiveMemoryRecord(
  botId: string,
  recordId: string,
  options: { customWorkspaceDir?: string; requestingBotId?: string } = {}
): StoredMemoryRecord | null {
  assertBotId(botId);
  if (options.requestingBotId && botId !== "shared" && options.requestingBotId !== botId) {
    const permError = `${ERR_CROSS_BOT_MEMORY_LEAK}: Bot "${options.requestingBotId}" cannot archive private memory of Bot "${botId}".`;
    recordMemorySecurityViolation({
      requestingBotId: options.requestingBotId,
      targetBotId: botId,
      operation: "write",
      reason: permError,
    });
    throw new CrossBotMemoryLeakError(options.requestingBotId, botId, permError);
  }
  const records = loadMemoryRecords(botId, {
    customWorkspaceDir: options.customWorkspaceDir,
    includeArchived: true,
    includeDeleted: true,
  });

  const target = records.find((r) => r.id === recordId);
  if (!target || target.lifecycle === "deleted") return null;

  target.lifecycle = "archived";
  target.archivedAt = Date.now();
  const { sha256Hash: _oldHash, ...rest } = target;
  target.sha256Hash = computeMemoryRecordHash(rest);
  saveMemoryRecords(botId, records, { customWorkspaceDir: options.customWorkspaceDir });
  notifyRecordJournal(botId, {
    action: "archive",
    recordId: target.id,
    category: target.category,
    headline: target.headline,
  });
  return target;
}

/**
 * Deletes a memory record permanently from active retrieval.
 */
export function deleteMemoryRecord(
  botId: string,
  recordId: string,
  options: { customWorkspaceDir?: string; requestingBotId?: string } = {}
): boolean {
  assertBotId(botId);
  if (options.requestingBotId && botId !== "shared" && options.requestingBotId !== botId) {
    const permError = `${ERR_CROSS_BOT_MEMORY_LEAK}: Bot "${options.requestingBotId}" cannot delete private memory of Bot "${botId}".`;
    recordMemorySecurityViolation({
      requestingBotId: options.requestingBotId,
      targetBotId: botId,
      operation: "write",
      reason: permError,
    });
    throw new CrossBotMemoryLeakError(options.requestingBotId, botId, permError);
  }
  const verified: { value?: string } = {};
  const records = loadMemoryRecords(botId, {
    customWorkspaceDir: options.customWorkspaceDir,
    includeArchived: true,
    includeDeleted: true,
    verifiedHash: verified,
  });

  const target = records.find((r) => r.id === recordId);
  if (!target) return false;

  target.lifecycle = "deleted";
  target.deletedAt = Date.now();
  const { sha256Hash: _oldHash, ...rest } = target;
  target.sha256Hash = computeMemoryRecordHash(rest);
  saveMemoryRecords(botId, records, {
    customWorkspaceDir: options.customWorkspaceDir,
    verifiedFileHash: verified.value,
  });
  notifyRecordJournal(botId, {
    action: "delete",
    recordId: target.id,
    category: target.category,
    headline: target.headline,
  });
  return true;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  matchReasons: string[];
}

/**
 * Performs relevance-ranked retrieval over a bot's active memories.
 * Bounded by limit, respects bot scope, excludes archived/deleted records.
 */
export function retrieveMemoryRecords(
  botId: string,
  query: string,
  options: {
    limit?: number;
    category?: MemoryCategory;
    customWorkspaceDir?: string;
    updateAccessCount?: boolean;
    minScore?: number;
    requestingBotId?: string;
  } = {}
): MemorySearchResult[] {
  assertBotId(botId);
  if (options.requestingBotId && botId !== "shared" && options.requestingBotId !== botId) {
    const permError = `${ERR_CROSS_BOT_MEMORY_LEAK}: Bot "${options.requestingBotId}" cannot retrieve private memory of Bot "${botId}".`;
    recordMemorySecurityViolation({
      requestingBotId: options.requestingBotId,
      targetBotId: botId,
      operation: "read",
      reason: permError,
    });
    throw new CrossBotMemoryLeakError(options.requestingBotId, botId, permError);
  }
  const records = loadMemoryRecords(botId, {
    customWorkspaceDir: options.customWorkspaceDir,
    includeArchived: false,
    includeDeleted: false,
  });

  const maxLimit = Math.min(options.limit ?? 5, 10);
  const minScore = options.minScore ?? 0.05;
  const qClean = (query || "").toLowerCase().trim();
  const tokens = qClean
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9_-]/g, ""))
    .filter((t) => t.length > 2 && !["the", "and", "for", "with", "this", "that", "you", "are", "what", "how"].includes(t));

  const results: MemorySearchResult[] = [];

  for (const r of records) {
    if (r.botId !== botId || r.lifecycle !== "active") continue;
    if (options.category && r.category !== options.category) continue;

    const matchReasons: string[] = [];
    let score = 0;

    const hLower = r.headline.toLowerCase();
    const dLower = r.detail.toLowerCase();

    if (qClean && (hLower.includes(qClean) || dLower.includes(qClean))) {
      score += 2.0;
      matchReasons.push("phrase match");
    }

    let tokenMatches = 0;
    for (const token of tokens) {
      if (hLower.includes(token)) {
        tokenMatches += 2;
      } else if (dLower.includes(token)) {
        tokenMatches += 1;
      }
    }

    if (tokenMatches > 0) {
      score += tokenMatches * 0.5;
      matchReasons.push(`${tokenMatches} term matches`);
    }

    if (r.category === "user_preference" && /(?:prefer|like|style|format|always|never|favorite|convention)/i.test(qClean)) {
      score += 1.5;
      matchReasons.push("category match: user_preference");
    } else if (r.category === "active_project" && /(?:project|build|task|goal|status|architecture|db|database)/i.test(qClean)) {
      score += 1.5;
      matchReasons.push("category match: active_project");
    } else if (r.category === "stable_identity" && /(?:who|name|user|identity|developer|author)/i.test(qClean)) {
      score += 1.5;
      matchReasons.push("category match: stable_identity");
    } else if (r.category === "episodic_event" && /(?:decided|happened|event|history|prior|previous|when)/i.test(qClean)) {
      score += 1.0;
      matchReasons.push("category match: episodic_event");
    }

    // Boost by quality, confidence, and access
    score *= 0.5 + 0.5 * r.confidence;
    score += Math.min(r.accessCount * 0.05, 0.5);

    if (score >= minScore) {
      results.push({ record: r, score: Number(score.toFixed(4)), matchReasons });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const bounded = results.slice(0, maxLimit);

  if (options.updateAccessCount && bounded.length > 0) {
    let touched = false;
    for (const res of bounded) {
      const match = records.find((rec) => rec.id === res.record.id);
      if (match) {
        match.accessCount += 1;
        const { sha256Hash: _oldHash, ...rest } = match;
        match.sha256Hash = computeMemoryRecordHash(rest);
        res.record.accessCount = match.accessCount;
        res.record.sha256Hash = match.sha256Hash;
        touched = true;
      }
    }
    if (touched) {
      try {
        saveMemoryRecords(botId, records, { customWorkspaceDir: options.customWorkspaceDir });
      } catch {}
    }
  }

  return bounded;
}

export interface MemoryCandidateEvaluation {
  isCandidate: boolean;
  category?: MemoryCategory;
  headline?: string;
  detail?: string;
  confidence?: number;
  reason?: string;
}

/**
 * Distinguishes meaningless/transient conversation from candidate memory facts.
 */
export function isMeaninglessObservation(text: string): boolean {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 3) return true;
  if (/^(?:ok|okay|thanks(?: you)?(?: so much)?|thank you(?: very much| so much)?|sounds good|cool|got it|sure|yep|yes|no|nope|bye|hello|hi|hey|good morning)[.!?]*$/i.test(t)) {
    return true;
  }
  if (/^\d+\s*[+\-*/]\s*\d+\s*(=|\?|$)/.test(t)) return true;
  if (/^(?:what is the time|what time is it|test|ping)[.!?]*$/i.test(t)) return true;
  if (t.length > 2000) return true;
  return false;
}

/**
 * Memory candidate extraction gate: extracts structured facts with confidence and category.
 */
export function evaluateMemoryCandidate(input: {
  botId: string;
  text: string;
  sourceTurnId: string;
  role?: string;
}): MemoryCandidateEvaluation {
  const text = (input.text || "").trim();
  if (isMeaninglessObservation(text)) {
    return { isCandidate: false, reason: "Text is trivial, conversational filler, or oversized" };
  }

  // 1. Stable Identity
  const identityMatch = text.match(/(?:my name is|i am|call me)\s+([A-Za-z0-9 _-]{2,40})/i);
  if (identityMatch && !/(?:busy|tired|hungry|here|leaving|running)/i.test(identityMatch[1])) {
    return {
      isCandidate: true,
      category: "stable_identity",
      headline: `User identity: ${identityMatch[1].trim()}`,
      detail: text,
      confidence: 0.98,
    };
  }

  // 2. User Preference
  if (/(?:(?:i|user)\s+prefer(?:s)?|prefer(?:s)?|my favorite language is|always format|always use|never use|i like to use|my preferred)\s+(.+)/i.test(text)) {
    const prefMatch = text.match(/(?:(?:i|user)\s+prefer(?:s)?|prefer(?:s)?|my favorite language is|always format|always use|never use|i like to use|my preferred)\s+([^.\n]+)/i);
    const summary = prefMatch ? prefMatch[0].trim() : text.slice(0, 80);
    return {
      isCandidate: true,
      category: "user_preference",
      headline: summary.charAt(0).toUpperCase() + summary.slice(1),
      detail: text,
      confidence: 0.95,
    };
  }

  // 3. Active Project
  if (/(?:we are building|project goal is|the architecture is|we decided to use|our deadline is|working on the)\s+(.+)/i.test(text)) {
    const projMatch = text.match(/(?:we are building|project goal is|the architecture is|we decided to use|our deadline is|working on the)\s+([^.\n]+)/i);
    const summary = projMatch ? projMatch[0].trim() : text.slice(0, 80);
    return {
      isCandidate: true,
      category: "active_project",
      headline: summary.charAt(0).toUpperCase() + summary.slice(1),
      detail: text,
      confidence: 0.90,
    };
  }

  // 4. Episodic Event
  if (/(?:today we decided|we launched|completed the milestone|milestone achieved|finished the audit)\s*(.*)/i.test(text)) {
    const eventMatch = text.match(/(?:today we decided|we launched|completed the milestone|milestone achieved|finished the audit)\s*([^.\n]*)/i);
    const summary = eventMatch ? eventMatch[0].trim() : text.slice(0, 80);
    return {
      isCandidate: true,
      category: "episodic_event",
      headline: summary.charAt(0).toUpperCase() + summary.slice(1),
      detail: text,
      confidence: 0.85,
    };
  }

  return { isCandidate: false, reason: "No strong durable memory markers detected" };
}

/**
 * Assembles persistent memory context for injection into Phase 2 DynamicContextFrame.
 */
/** Mirror lines whose record is no longer active. The markdown mirror only
 * ever appends, so without this a reconciled or archived belief would keep
 * answering queries — and keep riding into the prompt — from the file after
 * the store retired it, which is the exact leak Phase 5 lifecycle exists to
 * prevent. Matching is by the mirror's own `headline: detail` line, so the
 * person's own hand-written bullets are never touched. */
export function retiredMirrorLines(botId: string, options: { customWorkspaceDir?: string } = {}): Set<string> {
  const retired = new Set<string>();
  try {
    for (const record of loadMemoryRecords(botId, {
      customWorkspaceDir: options.customWorkspaceDir,
      includeArchived: true,
      includeDeleted: true,
    })) {
      if (record.lifecycle === "active") continue;
      retired.add(`${record.headline}: ${record.detail}`);
    }
  } catch {}
  return retired;
}

/**
 * The bullet lines of a MEMORY.md, with the harness's dated prefix stripped:
 * one line per fact, the way a person reads the file.
 */
export function memoryBulletLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => (line.startsWith("- ") || line.startsWith("* ")) && !line.startsWith("- Durable") && !line.startsWith("* Durable"))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*(?:from [^·\n]*\s*·\s*)?/, "").trim())
    .filter(Boolean);
}

/** Accumulates one partition's labelled lines without repeating a line, and
 * stops at the same bound for every caller so one turn's context cannot grow
 * with the number of things a bot has ever written down. */
function partitionLines(limit = MEMORY_PARTITION_CONTEXT_MAX_LINES): { lines: string[]; add: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    add(line: string) {
      const clean = line.trim();
      if (!clean || lines.includes(clean) || lines.length >= limit) return;
      lines.push(clean);
    },
  };
}

/**
 * What a turn's persistent layer knows, kept in the two partitions it came
 * from. The flattened fields below are the Phase 2/4/5 shape and stay exactly
 * as they were; `shared` and `specialized` are the Phase 6 addition that lets
 * the prompt say which partition a fact belongs to. A caller that ignores
 * them loses the label, never the isolation: `specialized` is read from this
 * bot's workspace only.
 */
export function assembleMemoryForContext(
  botId: string,
  query?: string,
  options: { customWorkspaceDir?: string; maxTokens?: number; includeShared?: boolean } = {}
): {
  userPreferences: Record<string, string>;
  activeProjectSummary?: string;
  stableFacts: string[];
  shared: string[];
  specialized: string[];
} {
  assertBotId(botId);
  const userPreferences: Record<string, string> = {};
  const stableFacts: string[] = [];
  const projectNotes: string[] = [];
  const sharedPart = partitionLines();
  const specializedPart = partitionLines();
  const sharedDir = options.customWorkspaceDir
    ? sharedWorkspaceDir(options.customWorkspaceDir)
    : sharedWorkspaceDir();

  // 1. Shared Partition: include shared durable memory across bots
  if (options.includeShared !== false && botId !== "shared") {
    try {
      const sharedActive = loadMemoryRecords("shared", {
        customWorkspaceDir: sharedDir,
        includeArchived: false,
        includeDeleted: false,
      });
      for (const record of sharedActive) {
        sharedPart.add(`${record.headline}: ${record.detail}`);
        if (record.category === "stable_identity") {
          stableFacts.push(`${record.headline}: ${record.detail}`);
        } else if (record.category === "user_preference") {
          userPreferences[record.headline] = record.detail;
        } else if (record.category === "active_project") {
          projectNotes.push(record.detail);
        } else if (record.category === "episodic_event") {
          stableFacts.push(`[Prior event] ${record.headline}: ${record.detail}`);
        }
      }
      // No markdown scan for the shared partition: the file is not a trust
      // source (see queryPartitionedMemory). Human edits reach context through
      // ingestSharedMarkdown, which validates them into records first.
    } catch {}
  }

  // 2. Specialized Bot Partition: private memory for this specific bot
  const relevant = retrieveMemoryRecords(botId, query || "", {
    limit: 8,
    customWorkspaceDir: options.customWorkspaceDir,
    updateAccessCount: true,
  });

  const allActive = loadMemoryRecords(botId, {
    customWorkspaceDir: options.customWorkspaceDir,
    includeArchived: false,
    includeDeleted: false,
  });

  // Always include active stable_identity records
  for (const record of allActive) {
    if (record.category === "stable_identity") {
      const fact = `${record.headline}: ${record.detail}`;
      specializedPart.add(fact);
      if (!stableFacts.includes(fact)) {
        stableFacts.push(fact);
      }
    }
  }

  for (const { record } of relevant) {
    specializedPart.add(`${record.headline}: ${record.detail}`);
    if (record.category === "user_preference") {
      userPreferences[record.headline] = record.detail;
    } else if (record.category === "stable_identity") {
      const fact = `${record.headline}: ${record.detail}`;
      if (!stableFacts.includes(fact)) {
        stableFacts.push(fact);
      }
    } else if (record.category === "active_project") {
      if (!projectNotes.includes(record.detail)) {
        projectNotes.push(record.detail);
      }
    } else if (record.category === "episodic_event") {
      stableFacts.push(`[Prior event] ${record.headline}: ${record.detail}`);
    }
  }

  // Phase 16: An agent-writable private MEMORY.md must NEVER be treated as
  // authenticated durable memory merely because it belongs to that bot or
  // because the file is located inside that bot's workspace.
  // Private memory context is constructed EXCLUSIVELY from authenticated
  // canonical records above, which passed v4 Merkle root, manifest MAC, and
  // freshness anchor checks. Raw markdown files are never scanned into context.

  return {
    userPreferences,
    activeProjectSummary: projectNotes.length > 0 ? projectNotes.join("; ") : undefined,
    stableFacts,
    shared: sharedPart.lines,
    specialized: specializedPart.lines,
  };
}

/**
 * A partition whose canonical store failed integrity must not be answered from
 * its derived document: `bots/<id>/MEMORY.md` and `shared/MEMORY.md` are
 * mirrors of the store, so if the store cannot be shown to be the committed
 * generation, neither can the mirror. Absence is still fine — an empty store
 * with a hand-written document is the normal case — so only failures that mean
 * "the bytes are not what we committed" are propagated.
 */
function rethrowIntegrityFailure(error: unknown): void {
  if (error instanceof MemoryStoreError && error.freshness) throw error;
}

/**
 * Canonical query path for partitioned memory across shared and bot-specialized partitions.
 * Strictly adheres to Phase 6 authoritative data contract and authorization rules.
 */
export function queryPartitionedMemory(
  query: PartitionedMemoryQuery,
  options: {
    customBaseDir?: string;
    /** Authoritative bot roster. An unknown or deleted bot never reaches the
     * filesystem: its workspace and journal are gone, and a stale id must not
     * be able to address a partition that a later bot could reuse. */
    botExists?: (botId: string) => boolean;
    /** The route's store shape, kept so the HTTP path does not have to adapt. */
    store?: { bot: (id: string) => unknown };
    /** The bot acting on this query. When supplied it must equal query.botId;
     * a mismatch is a cross-bot read and fails closed through the permission
     * policy, exactly like a direct document read. */
    requestingBotId?: string;
  } = {}
): PartitionedMemoryResult {
  // 1. botId identifies the requesting bot
  if (!query || typeof query.botId !== "string" || !BOT_ID.test(query.botId) || query.botId === "shared") {
    return { sharedSnippets: [], specializedSnippets: [] };
  }

  // A bot acting on its own behalf cannot ask for another bot's partition.
  // Checked before anything is opened, and audited like every other denial.
  if (options.requestingBotId !== undefined) {
    const perm = checkMemoryAccessPermission({
      requestingBotId: options.requestingBotId,
      targetBotId: query.botId,
      operation: "query",
    });
    if (!perm.allowed) {
      recordMemorySecurityViolation({
        requestingBotId: options.requestingBotId,
        targetBotId: query.botId,
        operation: "query",
        reason: perm.error,
      });
      throw new CrossBotMemoryLeakError(options.requestingBotId, query.botId, perm.error);
    }
  }

  // 10. Unknown botId or deleted botId must fail safely
  const exists = options.botExists ?? (options.store ? (id: string) => Boolean(options.store!.bot(id)) : undefined);
  if (exists && !exists(query.botId)) {
    return { sharedSnippets: [], specializedSnippets: [] };
  }

  // 6, 7, 8, 9. Normalize limits (respect zero limits, reject/normalize negative limits, respect caps)
  const limit = (value: number | undefined) => {
    const raw = typeof value === "number" && Number.isFinite(value) ? value : 5;
    return Math.min(MEMORY_PARTITION_QUERY_MAX_SNIPPETS, Math.max(0, Math.floor(raw)));
  };
  const maxShared = limit(query.maxSharedSnippets);
  const maxSpecialized = limit(query.maxSpecializedSnippets);

  // 11. An empty query keeps the store's existing retrieval semantics: a
  // query with no terms scores nothing, so it matches nothing. Returning the
  // whole partition instead would turn `queryText: ""` into a full dump.
  const queryText = typeof query.queryText === "string" ? query.queryText.trim() : "";
  if (!queryText) return { sharedSnippets: [], specializedSnippets: [] };

  const sharedSnippets: Array<{ path: "shared/MEMORY.md"; content: string }> = [];
  const specializedSnippets: Array<{ path: `bots/${string}/MEMORY.md`; content: string }> = [];

  const qClean = queryText.toLowerCase();
  const qTokens = qClean
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9_-]/g, ""))
    .filter((t) => t.length > 2 && !["the", "and", "for", "with", "this", "that", "you", "are", "what", "how"].includes(t));

  const matchesQuery = (text: string): boolean => {
    if (!qClean) return true;
    const lower = text.toLowerCase();
    if (lower.includes(qClean)) return true;
    if (qTokens.some((token) => lower.includes(token))) return true;
    return false;
  };

  // 2, 3. Include shared memory only when includeShared is true and maxShared > 0
  if (query.includeShared !== false && maxShared > 0) {
    const sharedDir = options.customBaseDir
      ? sharedWorkspaceDir(options.customBaseDir)
      : sharedWorkspaceDir();
    const collectedShared: string[] = [];

    // From structured records in shared partition
    try {
      const records = loadMemoryRecords("shared", {
        customWorkspaceDir: sharedDir,
        includeArchived: false,
        includeDeleted: false,
      });
      for (const r of records) {
        if (r.lifecycle !== "active") continue;
        const line = r.headline === r.detail ? r.headline : `${r.headline}: ${r.detail}`;
        if (matchesQuery(line) && !collectedShared.includes(line)) {
          collectedShared.push(line);
        }
      }
    } catch (error) {
      rethrowIntegrityFailure(error);
    }

    // Shared/MEMORY.md is deliberately NOT a trust source here. The file is
    // readable and writable by anything that can reach the shared workspace
    // (agent file/shell tools included), so a line's presence in it is not
    // evidence that a shared write was approved. Only canonical records —
    // which the confidence/relevance gate creates, and which the person's
    // authorizing save ingests through that gate — can enter a bot's
    // partition result.

    for (const content of collectedShared.slice(0, maxShared)) {
      sharedSnippets.push({
        path: "shared/MEMORY.md",
        content,
      });
    }
  }

  // 4, 5. Specialized snippets must come only from the requesting bot's own private memory.
  // Specialized snippets from another bot must NEVER appear.
  if (maxSpecialized > 0) {
    const botId = query.botId;
    let botDir = workspaceDir(botId);
    if (options.customBaseDir) {
      if (existsSync(join(options.customBaseDir, "bots", botId))) {
        botDir = join(options.customBaseDir, "bots", botId);
      } else if (existsSync(join(options.customBaseDir, botId))) {
        botDir = join(options.customBaseDir, botId);
      } else {
        botDir = options.customBaseDir;
      }
    }

    const collectedSpecialized: string[] = [];

    // From structured records in requesting bot's partition
    try {
      const records = loadMemoryRecords(botId, {
        customWorkspaceDir: botDir,
        includeArchived: false,
        includeDeleted: false,
      });
      for (const r of records) {
        if (r.botId !== botId || r.lifecycle !== "active") continue;
        const line = r.headline === r.detail ? r.headline : `${r.headline}: ${r.detail}`;
        if (matchesQuery(line) && !collectedSpecialized.includes(line)) {
          collectedSpecialized.push(line);
        }
      }
    } catch (error) {
      // The shared partition can degrade to "no snippets": its MEMORY.md is
      // never scanned. This partition cannot, because the mirror below *is*
      // read and the bot's own tools can write it. Answering a detected tamper
      // from that mirror would turn a failed verification into a
      // prompt-injection channel, so a private store that does not verify
      // fails the whole query.
      if (error instanceof MemoryStoreError) throw error;
      rethrowIntegrityFailure(error);
    }

    // Phase 16: Specialized snippets come EXCLUSIVELY from authenticated
    // canonical records in the requesting bot's partition above.
    // The agent-writable private MEMORY.md file is NOT an authenticated trust
    // source and is never scanned for snippets.

    for (const content of collectedSpecialized.slice(0, maxSpecialized)) {
      specializedSnippets.push({
        path: `bots/${botId}/MEMORY.md`,
        content,
      });
    }
  }

  return {
    sharedSnippets,
    specializedSnippets,
  };
}

/**
 * The only way a line written into `shared/MEMORY.md` can become trusted
 * shared memory.
 *
 * The shared file is a document the person edits and the store mirrors
 * approved records into. Anything else that can write files can also append
 * to it, so its contents are not evidence of approval — but a person typing
 * a preference into Settings must still be remembered. Both cases therefore
 * pass through this function, which reuses the canonical candidate
 * evaluation and the shared write gate (confidence strictly above 0.90 plus
 * universal relevance); a line that fails is reported, never trusted.
 */
export function ingestSharedMarkdown(
  text: string,
  options: { customWorkspaceDir?: string; sourceTurnId?: string } = {},
): { ingested: string[]; rejected: Array<{ line: string; reason: string }> } {
  const ingested: string[] = [];
  const rejected: Array<{ line: string; reason: string }> = [];
  const sourceTurnId = options.sourceTurnId ?? "shared-markdown";
  const workspace = options.customWorkspaceDir
    ? sharedWorkspaceDir(options.customWorkspaceDir)
    : sharedWorkspaceDir();

  // A line the store itself put there — or one whose belief already exists in
  // any lifecycle — is already accounted for. Retired records must not be
  // resurrected by their own leftover mirror, and an unchanged file must not
  // reinforce every record on every boot.
  const known = new Set<string>();
  try {
    for (const record of loadMemoryRecords("shared", {
      customWorkspaceDir: workspace,
      includeArchived: true,
      includeDeleted: true,
    })) {
      known.add(`${record.headline}: ${record.detail}`);
      known.add(record.headline);
      known.add(record.detail);
    }
  } catch {}

  for (const line of memoryBulletLines(text)) {
    const clean = line
      .replace(/^[-*]\s+/, "")
      .replace(/^\d{4}-\d{2}-\d{2}\s*·\s*(?:from [^·\n]*\s*·\s*)?/, "")
      .trim();
    if (!clean || known.has(clean)) continue;

    const candidate = evaluateMemoryCandidate({ botId: "shared", text: clean, sourceTurnId });
    if (!candidate.isCandidate || !candidate.category || !candidate.headline || !candidate.detail) {
      rejected.push({ line: clean, reason: candidate.reason ?? "not a durable memory candidate" });
      continue;
    }
    try {
      putSharedMemoryRecord(
        {
          category: candidate.category,
          headline: candidate.headline,
          detail: candidate.detail,
          confidence: candidate.confidence ?? 0.9,
          sourceTurnId,
        },
        { customWorkspaceDir: workspace, mirror: false },
      );
      ingested.push(clean);
    } catch (error) {
      rejected.push({ line: clean, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ingested, rejected };
}

/**
 * One-time migration of a pre-Phase-6 shared document — never a re-read.
 *
 * The boot path cannot be a trust source either: an attacker who appends a
 * preference-shaped line and waits for a restart would otherwise be promoted.
 * So the file is ingested at most once, at the upgrade, and only when no
 * record store exists yet (a store that exists is authoritative and its
 * contents are the truth). The ledger written here also means a later boot
 * with the same file is a no-op even if the records file is removed.
 */
export function migrateSharedMarkdownOnce(
  options: { customWorkspaceDir?: string } = {},
): { migrated: boolean; reason: string; ingested: string[]; rejected: Array<{ line: string; reason: string }> } {
  const workspace = options.customWorkspaceDir
    ? sharedWorkspaceDir(options.customWorkspaceDir)
    : sharedWorkspaceDir();
  const ledgerPath = join(workspace, "memory", "markdown-migration.json");
  if (existsSync(ledgerPath)) {
    return { migrated: false, reason: "already migrated", ingested: [], rejected: [] };
  }
  if (existsSync(recordsFilePath("shared", options.customWorkspaceDir))) {
    writeFileAtomic(ledgerPath, JSON.stringify({ at: Date.now(), skipped: "records-are-authoritative" }), { mode: 0o600 });
    return { migrated: false, reason: "records are authoritative", ingested: [], rejected: [] };
  }
  const text = readMemoryDoc("shared", MEMORY_INDEX, { customWorkspaceDir: options.customWorkspaceDir }).text;
  const result = ingestSharedMarkdown(text, {
    customWorkspaceDir: options.customWorkspaceDir,
    sourceTurnId: "shared-markdown-migration",
  });
  mkdirSync(join(workspace, "memory"), { recursive: true, mode: 0o700 });
  writeFileAtomic(
    ledgerPath,
    JSON.stringify({ at: Date.now(), hash: hashMemoryText(text), ingested: result.ingested, rejected: result.rejected.length }),
    { mode: 0o600 },
  );
  return { migrated: true, reason: "upgraded pre-Phase-6 document", ...result };
}

/**
 * Synchronizes lines from MEMORY.md into structured memory records.
 * Invoked when MEMORY.md is saved from the Companion app UI (AgentProfileSheet / MemoryScreen).
 */
export function syncMarkdownToRecords(
  botId: string,
  text: string,
  options: { customWorkspaceDir?: string; sourceTurnId?: string } = {}
): { ingested: string[]; rejected: Array<{ line: string; reason: string }> } {
  const ingested: string[] = [];
  const rejected: Array<{ line: string; reason: string }> = [];
  const sourceTurnId = options.sourceTurnId ?? "markdown-sync";
  // Every record already mirrored into this file spells itself
  // `- headline: detail`. Reading that line back as a fresh observation would
  // store a second record whose detail is the whole sentence (headline
  // included), so a save would slowly degrade the belief it was meant to
  // preserve. The mirror is not evidence; only lines the person wrote are.
  const mirrored = new Set<string>();
  try {
    for (const record of loadMemoryRecords(botId, {
      customWorkspaceDir: options.customWorkspaceDir,
      includeArchived: true,
      includeDeleted: true,
    })) {
      mirrored.add(`${record.headline}: ${record.detail}`);
      mirrored.add(record.headline);
      mirrored.add(record.detail);
    }
  } catch {}

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) continue;
    const body = trimmed.replace(/^[-*]\s+/, "").trim();
    if (body.startsWith("Durable notes") || body.startsWith("The first")) continue;
    if (mirrored.has(body)) continue;

    // Remove dated or middle-dot prefix if present
    const clean = body.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*(?:from [^·\n]*\s*·\s*)?/, "").trim();
    if (!clean) continue;
    if (mirrored.has(clean)) continue;

    const cand = evaluateMemoryCandidate({ botId, text: clean, sourceTurnId });
    if (!cand.isCandidate || !cand.category || !cand.headline || !cand.detail) {
      rejected.push({ line: clean, reason: cand.reason ?? "not a durable memory candidate" });
      continue;
    }
    try {
      putMemoryRecord(
        botId,
        {
          category: cand.category,
          headline: cand.headline,
          detail: cand.detail,
          confidence: cand.confidence ?? 0.90,
          sourceTurnId,
        },
        { ...options, mirror: false }
      );
      ingested.push(clean);
    } catch (error) {
      rejected.push({ line: clean, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ingested, rejected };
}

// ── Phase 5: Memory Reconciliation ────────────────────────────────────
//
// Phase 4 remembers. This is the layer that decides what to do when the
// person says something that disagrees with what is already remembered.
//
// The rule the whole section exists to enforce: a durable belief is not
// overwritten because one turn contradicted it. Evidence is classified
// first (who said it, does it claim permanence, is it task-local, is it
// circumstantial), and only explicit durable evidence that resolves a
// contradiction above RECONCILIATION_CONFIDENCE_THRESHOLD may replace a
// durable preference. Everything else either leaves the belief alone
// (retain) or refuses to guess and raises ERR_RECONCILIATION_CONTRADICTION
// with the evidence attached, so the next relevant turn can ask.
//
// Everything here is deterministic: no model call, no hidden probability.
// The score is a documented linear combination of three inputs that a
// reader can recompute by hand
// (see scoreReconciliationConfidence).

export const ERR_RECONCILIATION_CONTRADICTION = "ERR_RECONCILIATION_CONTRADICTION";

/** The authoritative Phase 5 bar. A resolution must be strictly above this
 * to overwrite durable memory; at or below it the contradiction stands. */
export const RECONCILIATION_CONFIDENCE_THRESHOLD = 0.85;

export type ReconciliationActionType = "retain" | "update" | "archive" | "deprecate";

export const RECONCILIATION_ACTION_TYPES: readonly ReconciliationActionType[] = [
  "retain",
  "update",
  "archive",
  "deprecate",
];

/** The Phase 5 contract. `existingRecordId` names the belief under review;
 * `update` replaces it, `retain` leaves it exactly as it is. */
export interface MemoryReconciliationAction {
  actionType: ReconciliationActionType;
  existingRecordId: string;
  replacementDetail?: string;
  justification: string;
  contradictionEvidence: string;
  confidenceScore: number;
}

/** Fail-closed validation. Confidence is rejected, never clamped: a caller
 * that computed 1.4 made a mistake and must hear about it rather than have
 * the store quietly substitute a number it can live with. */
export function validateMemoryReconciliationAction(action: unknown): { valid: boolean; error?: string } {
  if (typeof action !== "object" || action === null) {
    return { valid: false, error: "Reconciliation action must be a non-null object" };
  }
  const a = action as Partial<MemoryReconciliationAction>;
  if (typeof a.actionType !== "string" || !RECONCILIATION_ACTION_TYPES.includes(a.actionType as ReconciliationActionType)) {
    return { valid: false, error: `actionType must be one of: ${RECONCILIATION_ACTION_TYPES.join(", ")}` };
  }
  if (typeof a.existingRecordId !== "string" || !a.existingRecordId.trim() || a.existingRecordId.length > 128) {
    return { valid: false, error: "existingRecordId must be a non-empty string of max 128 characters" };
  }
  if (typeof a.justification !== "string" || !a.justification.trim() || a.justification.length > 2000) {
    return { valid: false, error: "justification must be a non-empty string of max 2000 characters" };
  }
  if (typeof a.contradictionEvidence !== "string" || !a.contradictionEvidence.trim() || a.contradictionEvidence.length > 2500) {
    return { valid: false, error: "contradictionEvidence must be a non-empty string of max 2500 characters" };
  }
  if (
    typeof a.confidenceScore !== "number" ||
    !Number.isFinite(a.confidenceScore) ||
    a.confidenceScore < 0 ||
    a.confidenceScore > 1
  ) {
    return { valid: false, error: "confidenceScore must be a finite number between 0.00 and 1.00" };
  }
  const hasReplacement = typeof a.replacementDetail === "string" && a.replacementDetail.trim().length > 0;
  if (a.replacementDetail !== undefined && (typeof a.replacementDetail !== "string" || a.replacementDetail.length > 2500)) {
    return { valid: false, error: "replacementDetail must be a string of max 2500 characters" };
  }
  if (a.actionType === "update" && !hasReplacement) {
    return { valid: false, error: "an update must carry replacementDetail" };
  }
  if (a.actionType === "retain" && a.replacementDetail !== undefined) {
    // retain means the durable belief does not change; a replacement here
    // would describe a change the action swears it is not making
    return { valid: false, error: "retain must not carry replacementDetail" };
  }
  return { valid: true };
}

export type ReconciliationEvidenceStrength = "strong" | "medium" | "weak";

export interface ReconciliationEvidence {
  /** What was said or observed, in the person's words. */
  text: string;
  sourceTurnId: string;
  /** Who the evidence came from. Only a person's own statement can be strong. */
  source?: "user_explicit" | "conversation_context" | "tool_observation" | "disk";
  /** The statement claims a durable or permanent change. */
  permanence?: boolean;
  /** The statement explicitly corrects a prior belief. */
  correction?: boolean;
  /** The statement is about this task or this one script only. */
  taskLocal?: boolean;
  /** Inferred from a commit, a file, or a tool result rather than stated. */
  circumstantial?: boolean;
  /** How many times this has been observed; repetition strengthens evidence. */
  repetition?: number;
  /** Where the claim applies. A project-scoped claim never rewrites a
   * global preference. */
  scope?: "global" | "project";
  projectId?: string;
}

/**
 * Deterministic evidence classification. The ordering of these branches is
 * the policy: a task-local or circumstantial statement is weak no matter
 * who said it, because "use Python for this script" is not a preference; an
 * explicit statement that claims permanence (or corrects the old belief) is
 * strong; an explicit statement without permanence, or a repeated
 * observation, is medium.
 */
export function classifyReconciliationEvidence(evidence: ReconciliationEvidence): {
  strength: ReconciliationEvidenceStrength;
  weight: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (evidence.taskLocal) {
    reasons.push("task-local statement");
    return { strength: "weak", weight: 0.35, reasons };
  }
  if (evidence.circumstantial) {
    reasons.push("circumstantial observation, not a statement");
    return { strength: "weak", weight: 0.35, reasons };
  }
  const explicit = evidence.source === "user_explicit";
  if (explicit && (evidence.permanence || evidence.correction)) {
    reasons.push(evidence.correction ? "explicit correction of the prior belief" : "explicit statement of a permanent change");
    return { strength: "strong", weight: 1.0, reasons };
  }
  if (explicit && (evidence.repetition ?? 0) >= 2) {
    reasons.push("repeated explicit statements");
    return { strength: "strong", weight: 0.95, reasons };
  }
  if (evidence.scope === "project" && evidence.permanence) {
    reasons.push("permanent change scoped to one project");
    return { strength: "medium", weight: 0.7, reasons };
  }
  if (explicit) {
    reasons.push("explicit statement without a claim of permanence");
    return { strength: "medium", weight: 0.6, reasons };
  }
  if ((evidence.repetition ?? 0) >= 2) {
    reasons.push("repeated observation");
    return { strength: "medium", weight: 0.6, reasons };
  }
  reasons.push("single weak observation");
  return { strength: "weak", weight: 0.35, reasons };
}

/** Subject slots a preference can be about. This is a bounded lexicon, not
 * natural-language understanding: it exists so "user prefers TypeScript"
 * and "switching to Python" are recognised as disagreeing about the same
 * slot even though they share no word. A statement whose slot is unknown
 * falls back to lexical overlap, which is deliberately conservative. */
const PREFERENCE_SLOTS: ReadonlyArray<{ slot: string; pattern: RegExp }> = [
  { slot: "language", pattern: /\b(?:typescript|javascript|python|rust|golang|java|kotlin|swift|ruby|php|c\+\+|c#|scala|elixir|haskell|perl|clojure|dart)\b/i },
  { slot: "editor", pattern: /\b(?:vim|neovim|emacs|vscode|vs code|intellij|sublime|zed|android studio)\b/i },
  { slot: "shell", pattern: /\b(?:bash|zsh|fish|powershell|sh|nushell)\b/i },
  { slot: "database", pattern: /\b(?:sqlite|postgres|postgresql|mysql|mongo(?:db)?|redis|dynamodb|clickhouse)\b/i },
  { slot: "framework", pattern: /\b(?:react|vue|svelte|next\.?js|django|rails|spring|flutter|electron)\b/i },
  { slot: "package_manager", pattern: /\b(?:npm|pnpm|yarn|bun|pip|poetry|cargo|gradle|maven)\b/i },
  { slot: "platform", pattern: /\b(?:macos|linux|windows|android|ios|ubuntu|debian|fedora)\b/i },
  { slot: "format", pattern: /\b(?:markdown|json|yaml|toml|csv|xml|html)\b/i },
  { slot: "tone", pattern: /\b(?:formal|casual|terse|verbose|concise|blunt|neutral)\b/i },
];

/** The preference slot a piece of text is about, or null when unknown. */
export function reconciliationSubject(text: string): string | null {
  for (const { slot, pattern } of PREFERENCE_SLOTS) {
    if (pattern.test(text)) return slot;
  }
  return null;
}

const RECONCILIATION_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had", "was", "were",
  "user", "prefer", "prefers", "preferred", "preference", "use", "uses", "using", "used",
  "my", "our", "your", "its", "his", "her", "their", "they", "them", "myself", "ourselves",
  "i", "we", "you", "it", "is", "are", "be", "been", "to", "of", "in", "on", "at", "as",
  "a", "an", "or", "but", "not", "now", "only", "just", "one", "all", "some", "any",
  "switch", "switching", "switched", "change", "changed", "changing", "decided", "decide",
  "permanently", "permanent", "everything", "always", "never", "again", "still", "really",
]);

function reconciliationTokens(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9+#.-]{3,}/g) ?? [];
  return new Set(tokens.filter((token) => !RECONCILIATION_STOPWORDS.has(token)));
}

/**
 * How strongly `evidenceText` contradicts `record`, on 0..1. Zero means the
 * two are about different things and simply coexist (a new fact, not a
 * contradiction). A shared known subject slot is the strongest signal; a
 * shared significant word is a weaker one; anything else is unrelated.
 */
export function reconciliationContradictionStrength(
  record: Pick<MemoryRecord, "headline" | "detail">,
  evidenceText: string,
): number {
  const evidenceSubject = reconciliationSubject(evidenceText);
  const recordSubject = reconciliationSubject(`${record.headline} ${record.detail}`);
  if (evidenceSubject && recordSubject) {
    return evidenceSubject === recordSubject ? 0.9 : 0;
  }
  const evidenceTokens = reconciliationTokens(evidenceText);
  const recordTokens = reconciliationTokens(`${record.headline} ${record.detail}`);
  let overlap = 0;
  for (const token of evidenceTokens) {
    if (recordTokens.has(token)) overlap++;
  }
  return overlap > 0 ? 0.6 : 0;
}

/**
 * The resolution score. Three inputs, read left to right:
 *   evidence weight  (55%)  how strong the new evidence is
 *   contradiction    (35%)  how directly it disagrees with the belief
 *   existing belief  (10%)  how sure the store already was
 * Strong explicit evidence against a shared slot lands near 0.96; a
 * repeated-but-unqualified statement lands near 0.79; a single task command
 * near 0.60. Only the first is above the 0.85 bar, by construction.
 */
export function scoreReconciliationConfidence(input: {
  evidenceWeight: number;
  contradictionStrength: number;
  existingConfidence: number;
}): number {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const raw =
    clamp(input.evidenceWeight) * 0.55 +
    clamp(input.contradictionStrength) * 0.35 +
    clamp(input.existingConfidence) * 0.1;
  return Number(clamp(raw).toFixed(4));
}

/** A contradiction the evidence cannot settle. Carries what the next turn
 * needs to ask a useful question, and nothing that would let a caller
 * mistake it for a mutation: no record is written when this is thrown. */
export class ReconciliationContradiction extends MemoryStoreError {
  readonly existingRecordId: string;
  readonly contradictionEvidence: string;
  readonly resolutionConfidence: number;
  readonly recommendedAction: ReconciliationActionType;
  readonly requiresUserClarification: boolean;

  constructor(input: {
    botId: string;
    existingRecordId: string;
    contradictionEvidence: string;
    resolutionConfidence: number;
    justification: string;
    recommendedAction?: ReconciliationActionType;
  }) {
    super(
      "contradiction",
      409,
      `${ERR_RECONCILIATION_CONTRADICTION}: ${input.justification} ` +
        `(record ${input.existingRecordId}, resolution confidence ${input.resolutionConfidence.toFixed(2)} ` +
        `at or below the ${RECONCILIATION_CONFIDENCE_THRESHOLD} threshold)`,
    );
    this.name = "ReconciliationContradiction";
    this.existingRecordId = input.existingRecordId;
    this.contradictionEvidence = input.contradictionEvidence;
    this.resolutionConfidence = input.resolutionConfidence;
    this.recommendedAction = input.recommendedAction ?? "retain";
    this.requiresUserClarification = true;
  }
}

export type ReconciliationDecision =
  | { decision: "none"; reason: string }
  | { decision: "retain"; action: MemoryReconciliationAction; record: StoredMemoryRecord; resolutionConfidence: number }
  | { decision: "update"; action: MemoryReconciliationAction; record: StoredMemoryRecord; resolutionConfidence: number };

/** The best candidate among same-category records the evidence disagrees
 * with. Deterministic: strongest contradiction, then most confident, then
 * most recently reinforced, then id. */
function pickReconciliationTarget(
  records: StoredMemoryRecord[],
  evidenceText: string,
  category: MemoryCategory,
): { record: StoredMemoryRecord; strength: number } | null {
  const candidates = records
    .filter((record) => record.lifecycle === "active" && record.category === category)
    .map((record) => ({ record, strength: reconciliationContradictionStrength(record, evidenceText) }))
    .filter((candidate) => candidate.strength > 0);
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      b.strength - a.strength ||
      b.record.confidence - a.record.confidence ||
      b.record.lastReinforcedAt - a.record.lastReinforcedAt ||
      a.record.id.localeCompare(b.record.id),
  );
  return candidates[0];
}

/**
 * Decides what the evidence should do to the store, without writing. This is
 * the "classify then choose" half of the phase: retain for weaker or scoped
 * evidence, update only when strong durable evidence clears the bar, and a
 * thrown ERR_RECONCILIATION_CONTRADICTION when the evidence genuinely
 * contradicts a belief but cannot settle it.
 */
export function planMemoryReconciliation(
  botId: string,
  evidence: ReconciliationEvidence,
  options: { category?: MemoryCategory; customWorkspaceDir?: string } = {},
): ReconciliationDecision {
  assertBotId(botId);
  if (typeof evidence?.text !== "string" || !evidence.text.trim()) {
    throw new MemoryStoreError("invalid-reconciliation", 400, "evidence text must be a non-empty string");
  }
  if (typeof evidence.sourceTurnId !== "string" || !evidence.sourceTurnId.trim()) {
    throw new MemoryStoreError("invalid-reconciliation", 400, "evidence sourceTurnId must be a non-empty string");
  }
  const category = options.category ?? "user_preference";
  const records = loadMemoryRecords(botId, {
    customWorkspaceDir: options.customWorkspaceDir,
    includeArchived: false,
    includeDeleted: false,
  });
  const target = pickReconciliationTarget(records, evidence.text, category);
  if (!target) return { decision: "none", reason: "no active memory contradicts this evidence" };

  const classified = classifyReconciliationEvidence(evidence);
  const resolutionConfidence = scoreReconciliationConfidence({
    evidenceWeight: classified.weight,
    contradictionStrength: target.strength,
    existingConfidence: target.record.confidence,
  });
  const evidenceLine = evidence.text.trim();

  // A task-local or project-scoped statement is an exception, not a rewrite.
  if (evidence.taskLocal || evidence.scope === "project") {
    const reason = evidence.scope === "project"
      ? "project-scoped exception; the durable belief is unchanged"
      : "task-local exception; the durable belief is unchanged";
    return {
      decision: "retain",
      record: target.record,
      resolutionConfidence,
      action: {
        actionType: "retain",
        existingRecordId: target.record.id,
        justification: `${reason} (${classified.reasons.join(", ")})`,
        contradictionEvidence: evidenceLine,
        confidenceScore: resolutionConfidence,
      },
    };
  }

  if (resolutionConfidence > RECONCILIATION_CONFIDENCE_THRESHOLD && classified.strength === "strong") {
    return {
      decision: "update",
      record: target.record,
      resolutionConfidence,
      action: {
        actionType: "update",
        existingRecordId: target.record.id,
        replacementDetail: evidenceLine,
        justification: `explicit durable contradiction resolved above the ${RECONCILIATION_CONFIDENCE_THRESHOLD} threshold (${classified.reasons.join(", ")})`,
        contradictionEvidence: evidenceLine,
        confidenceScore: resolutionConfidence,
      },
    };
  }

  throw new ReconciliationContradiction({
    botId,
    existingRecordId: target.record.id,
    contradictionEvidence: evidenceLine,
    resolutionConfidence,
    justification: `the new evidence contradicts "${target.record.headline}" but cannot settle it (${classified.reasons.join(", ")})`,
    recommendedAction: "retain",
  });
}

export interface ReconciliationOutcome {
  action: MemoryReconciliationAction;
  /** Authoritative record after the action; null when nothing is active. */
  record: StoredMemoryRecord | null;
  /** The record retired by update/archive/deprecate; null for retain. */
  retired: StoredMemoryRecord | null;
  resolutionConfidence: number;
  /** True when the audit row was handed to the journal. */
  journaled: boolean;
}

function reconciliationHeadline(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  return flat.length <= 300 ? flat : `${flat.slice(0, 297)}...`;
}

/** Records the audit row. Fire-and-forget, like every other journal write:
 * a failed audit line must never undo a reconciliation that already
 * persisted. */
function notifyReconciliationJournal(
  botId: string,
  entry: {
    action: "reconcile";
    actionType: ReconciliationActionType;
    recordId: string;
    retiredRecordId?: string;
    category?: string;
    headline?: string;
    priorDetail?: string;
    replacementDetail?: string;
    contradictionEvidence: string;
    justification: string;
    confidenceScore: number;
    sourceTurnId?: string;
    actor: "person" | "bot" | "system" | "import";
    via: string;
  },
): boolean {
  import("./memory-journal.ts")
    .then((journal) => journal.recordMemoryReconciliationJournalEntry(botId, entry))
    .catch(() => {});
  return true;
}

/**
 * Applies a validated reconciliation action to the canonical store.
 *
 * - retain leaves the durable record untouched (unless `reinforce` asks for
 *   the access bookkeeping Phase 4 already does, in which case the hash is
 *   recomputed because lastReinforcedAt/accessCount are hashed fields).
 * - update archives every active record that disagrees about the same
 *   subject and creates the replacement as a new active record, so the old
 *   belief stays auditable with its original text instead of being mutated
 *   into something it never said.
 * - archive retires a belief because a replacement exists.
 * - deprecate retires a belief that is known to be invalid, and keeps the
 *   reason on the record (archived plus deprecatedAt) so the two are
 *   distinguishable in the audit trail and in retrieval.
 *
 * With `expectedFileHash`, a store that changed since the caller looked is
 * detected before anything is written: the fresh state is re-read and the
 * target re-evaluated, and a target that is no longer active is a 409 rather
 * than a silent overwrite.
 */
export function reconcileMemoryRecord(
  botId: string,
  action: MemoryReconciliationAction,
  options: {
    customWorkspaceDir?: string;
    expectedFileHash?: string;
    sourceTurnId?: string;
    actor?: "person" | "bot" | "system" | "import";
    via?: string;
    reinforce?: boolean;
    replacementHeadline?: string;
    deprecationReason?: string;
    requestingBotId?: string;
  } = {},
): ReconciliationOutcome {
  assertBotId(botId);

  // Cross-bot reconciliation write boundary enforcement
  if (options.requestingBotId && botId !== "shared" && options.requestingBotId !== botId) {
    const permError = `${ERR_CROSS_BOT_MEMORY_LEAK}: Bot "${options.requestingBotId}" cannot reconcile private memory of Bot "${botId}".`;
    recordMemorySecurityViolation({
      requestingBotId: options.requestingBotId,
      targetBotId: botId,
      operation: "write",
      reason: permError,
    });
    throw new CrossBotMemoryLeakError(options.requestingBotId, botId, permError);
  }

  const validation = validateMemoryReconciliationAction(action);
  if (!validation.valid) {
    throw new MemoryStoreError("invalid-reconciliation", 400, `invalid reconciliation action: ${validation.error}`);
  }

  const filePath = recordsFilePath(botId, options.customWorkspaceDir);
  const currentFileHash = () => {
    if (!existsSync(filePath)) return hashMemoryText("");
    return hashMemoryText(readFileSync(filePath, "utf8"));
  };

  let expected = options.expectedFileHash;
  const staleOnEntry = expected !== undefined && expected !== currentFileHash();
  // Re-read authoritative state either way; `staleOnEntry` only decides
  // whether a target that moved underneath us is a conflict or ordinary.
  let records = loadMemoryRecords(botId, {
    customWorkspaceDir: options.customWorkspaceDir,
    includeArchived: true,
    includeDeleted: true,
  });
  const target = records.find((record) => record.id === action.existingRecordId);
  if (!target || target.lifecycle === "deleted") {
    throw new MemoryStoreError(
      "invalid-reconciliation",
      target ? 409 : 404,
      target ? "cannot reconcile a deleted memory" : `no such memory record: ${action.existingRecordId}`,
    );
  }
  if (staleOnEntry && target.lifecycle !== "active") {
    throw new MemoryStoreError(
      "conflict",
      409,
      `${ERR_MEMORY_HASH_MISMATCH}: the memory changed while this reconciliation was being decided — re-read and re-evaluate`,
    );
  }
  // A retired belief cannot be superseded again: update/archive/deprecate
  // all act on the belief the person currently holds. Retain still works on
  // an archived record (a caller may be confirming history is unchanged).
  if (action.actionType !== "retain" && target.lifecycle !== "active") {
    throw new MemoryStoreError(
      "conflict",
      409,
      `cannot ${action.actionType} a memory that is already ${target.lifecycle}: ${target.id}`,
    );
  }
  if (staleOnEntry) expected = currentFileHash();

  let authoritative: StoredMemoryRecord | null = target;
  let retired: StoredMemoryRecord | null = null;
  const now = Date.now();

  if (action.actionType === "retain") {
    if (options.reinforce) {
      target.lastReinforcedAt = now;
      target.accessCount += 1;
      const { sha256Hash: _oldHash, ...rest } = target;
      target.sha256Hash = computeMemoryRecordHash(rest);
      authoritative = target;
    }
  } else if (action.actionType === "update") {
    // Raw on purpose: createMemoryRecord is the one place that scrubs and
    // sets the `redacted` flag, so the replacement must not arrive already
    // scrubbed (`redacted` would then claim nothing was hidden).
    const replacementDetail = (action.replacementDetail ?? "").trim();
    // Every active record that disagrees about the same subject is retired;
    // leaving a second one active would leave two authoritative answers.
    const subject = reconciliationSubject(`${target.headline} ${target.detail}`);
    for (const record of records) {
      if (record.lifecycle !== "active" || record.category !== target.category) continue;
      const sameRecord = record.id === target.id;
      const sameSubject = subject !== null && reconciliationSubject(`${record.headline} ${record.detail}`) === subject;
      if (!sameRecord && !sameSubject) continue;
      record.lifecycle = "archived";
      record.archivedAt = now;
      const { sha256Hash: _oldHash, ...rest } = record;
      record.sha256Hash = computeMemoryRecordHash(rest);
      if (sameRecord) retired = record;
    }
    const replacement = createMemoryRecord({
      botId,
      category: target.category,
      headline: options.replacementHeadline ?? reconciliationHeadline(replacementDetail),
      detail: replacementDetail,
      confidence: action.confidenceScore,
      sourceTurnId: options.sourceTurnId ?? target.sourceTurnId,
      lifecycle: "active",
    });
    records.push(replacement);
    authoritative = replacement;
  } else {
    target.lifecycle = "archived";
    target.archivedAt = now;
    if (action.actionType === "deprecate") {
      target.deprecatedAt = now;
      target.deprecationReason = redactSecretsInText(options.deprecationReason ?? action.justification).slice(0, 500);
    }
    const { sha256Hash: _oldHash, ...rest } = target;
    target.sha256Hash = computeMemoryRecordHash(rest);
    retired = target;
    authoritative = null;
  }

  saveMemoryRecords(botId, records, {
    customWorkspaceDir: options.customWorkspaceDir,
    expectedFileHash: expected,
  });

  const journaled = notifyReconciliationJournal(botId, {
    action: "reconcile",
    actionType: action.actionType,
    recordId: (authoritative ?? retired ?? target).id,
    ...(retired ? { retiredRecordId: retired.id } : {}),
    category: target.category,
    headline: (authoritative ?? target).headline,
    priorDetail: target.detail,
    ...(action.replacementDetail ? { replacementDetail: redactSecretsInText(action.replacementDetail) } : {}),
    contradictionEvidence: redactSecretsInText(action.contradictionEvidence),
    justification: redactSecretsInText(action.justification),
    confidenceScore: action.confidenceScore,
    ...(options.sourceTurnId ?? target.sourceTurnId ? { sourceTurnId: options.sourceTurnId ?? target.sourceTurnId } : {}),
    actor: options.actor ?? "system",
    via: options.via ?? "reconciliation",
  });

  return {
    action,
    record: authoritative,
    retired,
    resolutionConfidence: action.confidenceScore,
    journaled,
  };
}

