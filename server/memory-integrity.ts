// Authenticity for canonical memory records.
//
// `records.json` sits inside a bot's workspace, which is exactly where the
// bot's own file tools can reach. A SHA-256 in the record only proves the
// record is internally consistent — a writer can edit a field and recompute
// it. This module adds the missing question: was this exact state produced by
// the canonical memory store, or merely written to the same path?
//
// The answer is an HMAC-SHA256 authority outside every workspace. Three
// providers exist, and only one runs on a phone:
//
//   native (Android)  Android Keystore holds a non-exportable HMAC key and
//                     computes every MAC. The host sends canonical payloads
//                     over its own stdout pipe and reads MACs back from its
//                     stdin pipe (`MemoryIntegrityBridge` in HarnessHost.kt).
//                     No key material ever enters this process.
//   stdin (Android,   The previous design: the app unwraps an AES-wrapped key
//   migration only)   and writes it on stdin. Kept solely to verify v1
//                     manifests once, during the keystore migration.
//   file (desktop)    `<DATA_DIR>/memory-integrity/key`, 0600. Unchanged.
//
// Each record gets a MAC over every field that changes authorization or model
// behaviour, and a signed manifest binds the whole set. What this cannot do is
// stated plainly in docs/verification: code that runs inside the app sandbox
// with Android APIs, reads host memory, or replaces the host bundle is outside
// the boundary.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { maybeCrashMemory } from "./memory-crash-point.ts";

export const ERR_MEMORY_INTEGRITY = "ERR_MEMORY_INTEGRITY";
/** v1 = file or stdin key. v2 = Android Keystore MACs in the app UID.
 *  v3 = the separate-UID signer package's Keystore key. */
export const MEMORY_INTEGRITY_VERSION = 1 as const;
export const NATIVE_MEMORY_INTEGRITY_VERSION = 2 as const;
export const SIGNER_MEMORY_INTEGRITY_VERSION = 3 as const;
/** v4 = one signer-authenticated Merkle root over the canonical records, with
 *  no per-record MACs. Lazily migrated from v3 on the first read after the
 *  upgrade; the signer-owned freshness anchor remains authoritative. */
export const MERKLE_MEMORY_INTEGRITY_VERSION = 4 as const;
export type MemoryIntegrityVersion = 1 | 2 | 3 | 4;

/** A record as stored. The integrity layer deliberately takes the persisted
 * shape rather than the narrower `MemoryRecord`, because lifecycle and
 * deprecation fields decide whether a record can become context. */
export interface IntegrityRecordShape {
  id: string;
  botId: string;
  category: string;
  headline: string;
  detail: string;
  confidence: number;
  sourceTurnId: string;
  createdAt: number;
  lastReinforcedAt: number;
  accessCount: number;
  sha256Hash: string;
  redacted: boolean;
  lifecycle?: string;
  archivedAt?: number;
  deletedAt?: number;
  deprecatedAt?: number;
  deprecationReason?: string;
}

export interface MemoryIntegrityManifest {
  version: MemoryIntegrityVersion;
  /** Present on v2/v3: which authority can verify this store. */
  provider?: "keystore" | "keystore-signer";
  /** Monotonic per bot; lets an older manifest be recognised when a newer
   * one is still available elsewhere. */
  seq: number;
  count: number;
  /** SHA-256 over the canonical records array, in file order. */
  digest: string;
  /** v4: SHA-256 Merkle root over the canonical records, sorted by id. */
  root?: string;
  /** v4: the bot or shared namespace this store belongs to. */
  botId?: string;
  /** record id -> MAC of that record's canonical payload (v1-v3; empty on v4). */
  macs: Record<string, string>;
  /** MAC over the manifest header above and every mac. */
  mac: string;
}

export class MemoryIntegrityError extends Error {
  readonly code = ERR_MEMORY_INTEGRITY;
  constructor(message: string) {
    super(message);
    this.name = "MemoryIntegrityError";
  }
}

/**
 * The bytes verify but are not the committed generation: a rollback, a reseal
 * of an older generation, or a store whose anchor was lost. Kept as its own
 * type because it is the one integrity failure that must also stop the
 * *derived* views of a store (the MEMORY.md mirror), not just the records.
 */
export class MemoryFreshnessError extends MemoryIntegrityError {
  constructor(message: string) {
    super(message);
    this.name = "MemoryFreshnessError";
  }
}

/** The store is still sealed with the retired key and this boot cannot reach
 * it. Distinct from a failed verification: nothing was checked, so nothing
 * may be called tampered and the key may not be retired. */
export class MemoryIntegrityKeyUnavailableError extends MemoryIntegrityError {
  constructor(message: string) {
    super(message);
    this.name = "MemoryIntegrityKeyUnavailableError";
  }
}

const KEY_BYTES = 32;
const HEX_64 = /^[0-9a-f]{64}$/;
const keyCache = new Map<string, Buffer>();

/** Set by the Android harness when the Keystore performs the MACs. */
export const MEMORY_INTEGRITY_NATIVE_ENV = "OMB_MEMORY_INTEGRITY_NATIVE";
/** Set when the MAC authority is the separate-UID signer package rather than
 *  the app UID's own Keystore alias. Only ever combined with the native
 *  mode above: the transport is the same authenticated bridge. */
export const MEMORY_INTEGRITY_SIGNER_ENV = "OMB_MEMORY_INTEGRITY_SIGNER";
/** Set only on the boots that still need the retired key for the migration. */
export const MEMORY_INTEGRITY_LEGACY_ENV = "OMB_MEMORY_INTEGRITY_LEGACY";
/** Historical name for the stdin key delivery; still honoured for migration. */
export const MEMORY_INTEGRITY_STDIN_ENV = "OMB_MEMORY_INTEGRITY_KEY_STDIN";
/** Set by the Android harness only on a boot where the retired key was
 *  decrypted, i.e. the one boot that may adopt a pre-authenticity store. */
export const MEMORY_INTEGRITY_LEGACY_UPGRADE_ENV = "OMB_MEMORY_INTEGRITY_ALLOW_LEGACY_UPGRADE";
/** This host's end of the integrity bridge — a connected Unix socket the
 * launcher has already moved onto fd 0 by the time this process runs; the
 * raw number is only ever seen by tests, which point it at fixtures. */
export const MEMORY_INTEGRITY_FD_ENV = "OMB_MEMORY_INTEGRITY_FD";

export type MemoryIntegrityProvider = "native" | "stdin" | "file";

/** Which provider this process uses. Native wins: a host started with both
 * flags must never fall back to the weaker one. */
export function memoryIntegrityKeyProvider(): MemoryIntegrityProvider {
  if (process.env[MEMORY_INTEGRITY_NATIVE_ENV] === "1") return "native";
  if (process.env[MEMORY_INTEGRITY_STDIN_ENV] === "1" || process.env[MEMORY_INTEGRITY_LEGACY_ENV] === "1") return "stdin";
  return "file";
}

/** True when the harness told us the MAC authority is the separate-UID signer
 *  package. It implies native transport; a signer flag without it is a
 *  configuration error and fails closed rather than picking a weaker key. */
export function memoryIntegritySignerMode(): boolean {
  return process.env[MEMORY_INTEGRITY_SIGNER_ENV] === "1";
}

/**
 * Where the file/stdin key lives. Native mode never reads or creates it; the
 * path is still the anchor for the legacy-migration ledger beside it.
 *
 * Tests inherit the throwaway HOME that `server/testing/setup.ts` installs, so
 * the developer's real key is never opened. `OMB_MEMORY_INTEGRITY_KEY_PATH` is
 * an explicit fixture opt-in, not a runtime knob.
 */
export function memoryIntegrityKeyPath(): string {
  const override = process.env.OMB_MEMORY_INTEGRITY_KEY_PATH;
  if (override && override.trim()) return override;
  return join(DATA_DIR, "memory-integrity", "key");
}

/** The manifest sits beside the records it authenticates. It is not secret;
 * its value is that it cannot be produced without the MAC authority. */
export function memoryIntegrityManifestPath(recordsPath: string): string {
  return join(dirname(recordsPath), "records.integrity.json");
}

/** Written once the whole install has been re-sealed under the Keystore key.
 * Its presence is what lets the app delete the retired wrapped key. */
export function nativeMigrationMarkerPath(): string {
  return join(DATA_DIR, "memory-integrity", "native-provider.json");
}

/** The one-time legacy upgrade is remembered outside the workspace, so
 * deleting the manifest later cannot re-open the "trust whatever is here"
 * door. It is not secret either; only the server writes it. */
export function memoryLegacyLedgerPath(botId: string, recordsPath: string): string {
  // The workspace path is part of the name: two stores can share a bot id
  // (fixtures, a restored workspace, a second data dir) and a global ledger
  // would let one store's upgrade make the other look like a deletion.
  const fingerprint = createHash("sha256").update(dirname(recordsPath)).digest("hex").slice(0, 20);
  return join(dirname(memoryIntegrityKeyPath()), "legacy", `${botId}-${fingerprint}.json`);
}

// ── native bridge ───────────────────────────────────────────────────────────
// Framed JSON over a Unix-domain socket the Android harness authenticated
// this host on (SO_PEERCRED, both directions) — never the host's stdio
// pipes. Pipes were reopenable: any same-UID process could
// `open("/proc/<host>/fd/1")` and inject MAC requests or read the answers
// (measured on the target device). A socket cannot be reopened through a
// /proc fd magic link at all — open(2) answers ENXIO — so the channel is
// unreachable from agent tools by kernel enforcement, not by protocol. The
// launcher moves the host's end onto fd 0, which also means every process
// the host spawns finds its own pipes or PTY there and can never inherit
// the channel. Without OMB_MEMORY_INTEGRITY_FD there is no channel, and
// native mode fails closed instead of downgrading.

const FRAME_PREFIX = "\u001eOMBINT ";
let frameSeq = 0;
let stdinBuffer = "";
const pendingFrames: Array<Record<string, unknown>> = [];
let legacyKey: Buffer | null = null;

/** The descriptor the harness handed this host (0 once the launcher has run
 *  its dup2). Absent or malformed means there is no Keystore channel, and
 *  that must be an error — never a silent fall back to a weaker provider. */
function bridgeDescriptor(): number {
  const raw = process.env[MEMORY_INTEGRITY_FD_ENV];
  const fd = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : -1;
  if (fd < 0 || fd > 1048576) {
    throw new MemoryIntegrityError(
      "memory integrity bridge has no descriptor; refusing to authenticate records without the Keystore channel",
    );
  }
  return fd;
}

function readLine(fd: number): string {
  const newline = stdinBuffer.indexOf("\n");
  if (newline >= 0) {
    const line = stdinBuffer.slice(0, newline);
    stdinBuffer = stdinBuffer.slice(newline + 1);
    return line;
  }
  const chunk = Buffer.alloc(64 * 1024);
  for (;;) {
    let read: number;
    try {
      read = readSync(fd, chunk, 0, chunk.length, null);
    } catch (error) {
      throw new MemoryIntegrityError(
        `memory integrity bridge is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (read === 0) {
      throw new MemoryIntegrityError(
        "memory integrity bridge closed before answering; the host cannot authenticate records",
      );
    }
    stdinBuffer += chunk.subarray(0, read).toString("utf8");
    const at = stdinBuffer.indexOf("\n");
    if (at >= 0) {
      const line = stdinBuffer.slice(0, at);
      stdinBuffer = stdinBuffer.slice(at + 1);
      return line;
    }
    if (stdinBuffer.length > 4 * 1024 * 1024) {
      throw new MemoryIntegrityError("memory integrity bridge sent an oversized response");
    }
  }
}

/** Read frames until the harness sends the retired key. Only migration boots
 * get one; a missing delivery is an explicit failure, never a fresh key. */
function readLegacyKeyFromBridge(): Buffer {
  const fd = bridgeDescriptor();
  for (;;) {
    if (pendingFrames.length > 0) {
      const frame = pendingFrames.shift()!;
      if (frame.op === "legacy-key") return decodeDeliveredMemoryIntegrityKey(String(frame.key ?? ""));
      continue;
    }
    const line = readLine(fd);
    if (!line.startsWith(FRAME_PREFIX)) continue;
    const frame = JSON.parse(line.slice(FRAME_PREFIX.length)) as Record<string, unknown>;
    if (frame.op === "legacy-key") return decodeDeliveredMemoryIntegrityKey(String(frame.key ?? ""));
    pendingFrames.push(frame);
  }
}

export function legacyMemoryIntegrityKey(): Buffer {
  if (legacyKey) return legacyKey;
  const cached = keyCache.get(memoryIntegrityKeyPath());
  if (cached) {
    legacyKey = cached;
    return legacyKey;
  }
  if (memoryIntegrityKeyProvider() === "native") {
    if (process.env[MEMORY_INTEGRITY_LEGACY_ENV] !== "1") {
      throw new MemoryIntegrityKeyUnavailableError(
        nativeMigrationComplete()
          ? "this store is still signed with the retired key: it did not verify during the Keystore migration, so its records are untrusted"
          : "this store is still signed with the retired key, and this boot has no access to it to migrate",
      );
    }
    legacyKey = readLegacyKeyFromBridge();
    return legacyKey;
  }
  return memoryIntegrityKey();
}

function bridgeRequest(frame: Record<string, unknown>): Record<string, unknown> {
  const id = ++frameSeq;
  const request = JSON.stringify({ ...frame, id });
  // The bridge descriptor is the harness's socketpair — not stdout, which is
  // a pipe any same-UID process could reopen. The direct fd write keeps the
  // frame whole: this process is the only writer and is blocked here until
  // the bytes land.
  const fd = bridgeDescriptor();
  writeSync(fd, `${FRAME_PREFIX}${request}\n`);
  for (;;) {
    if (pendingFrames.length > 0) {
      const next = pendingFrames.shift()!;
      if (next.id === id) return next;
      if (next.op === "legacy-key") continue;
      continue;
    }
    const line = readLine(fd);
    if (!line.startsWith(FRAME_PREFIX)) continue;
    const frame = JSON.parse(line.slice(FRAME_PREFIX.length)) as Record<string, unknown>;
    if (frame.id === id) return frame;
    if (frame.op !== "legacy-key") pendingFrames.push(frame);
  }
}

let nativeMacBridgeForTest:
  | ((purpose: "record" | "manifest", payloads: string[], key: "v2" | "v3") => string[])
  | null = null;

/** Unit tests cannot own the app's stdio pipes; this seam substitutes the
 * Keystore only under vitest. The real bridge is verified on the device. */
export function __setNativeMacBridgeForTest(
  bridge: ((purpose: "record" | "manifest", payloads: string[], key: "v2" | "v3") => string[]) | null,
): void {
  if (process.env.NODE_ENV !== "test") throw new Error("native MAC bridge override is test-only");
  nativeMacBridgeForTest = bridge;
}

function nativeMacBatch(
  purpose: "record" | "manifest",
  payloads: string[],
  key: "v2" | "v3" = memoryIntegritySignerMode() ? "v3" : "v2",
): string[] {
  if (payloads.length === 0) return [];
  if (nativeMacBridgeForTest) return nativeMacBridgeForTest(purpose, payloads, key);
  const response = bridgeRequest({ op: "mac", purpose, payloads, key });
  if (typeof response.error === "string") {
    throw new MemoryIntegrityError(`keystore refused the integrity request: ${response.error}`);
  }
  const macs = response.macs;
  if (!Array.isArray(macs) || macs.length !== payloads.length) {
    throw new MemoryIntegrityError("keystore returned a malformed MAC response");
  }
  return macs.map((mac) => {
    if (typeof mac !== "string" || !HEX_64.test(mac)) {
      throw new MemoryIntegrityError("keystore returned an invalid MAC");
    }
    return mac;
  });
}

/** Tell the harness the install is fully re-sealed so it may retire the old
 * key. Best effort: the marker file is the authoritative signal. */
function notifyNativeMigrationComplete(): void {
  try {
    writeSync(bridgeDescriptor(), `${FRAME_PREFIX}${JSON.stringify({ id: ++frameSeq, op: "migrated" })}\n`);
  } catch {
    /* the marker file still records completion */
  }
}

// ── keys ───────────────────────────────────────────────────────────────────

function readKeyFromDisk(path: string): Buffer {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8").trim();
  } catch (error) {
    throw new MemoryIntegrityError(
      `memory integrity key is unreadable at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new MemoryIntegrityError(`memory integrity key at ${path} is not ${KEY_BYTES} bytes`);
  }
  return key;
}

function createKey(path: string): Buffer {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  const fd = (() => {
    try {
      // `wx` means an existing key is never replaced. A concurrent creator
      // wins and is read below; losing that race must not invalidate records
      // signed with the winner's key.
      return openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as { code?: string }).code === "EEXIST") return null;
      throw error;
    }
  })();
  if (fd !== null) {
    try {
      writeSync(fd, `${key.toString("base64")}\n`);
    } finally {
      closeSync(fd);
    }
    return key;
  }
  return readKeyFromDisk(path);
}

/** Load (or initialize once) the file/stdin key. Native mode never calls this
 * for MACs; the migration path calls it through `legacyMemoryIntegrityKey`
 * only. Missing is not an error on desktop; corrupt is never regenerated. */
export function memoryIntegrityKey(): Buffer {
  if (memoryIntegrityKeyProvider() === "native") {
    throw new MemoryIntegrityError(
      "native integrity mode has no key in this process; ask the Keystore through the bridge",
    );
  }
  const path = memoryIntegrityKeyPath();
  const cached = keyCache.get(path);
  if (cached) return cached;
  const key = process.env[MEMORY_INTEGRITY_STDIN_ENV] === "1" || process.env[MEMORY_INTEGRITY_LEGACY_ENV] === "1"
    ? readMemoryIntegrityKeyFromStdin()
    : existsSync(path) ? readKeyFromDisk(path) : createKey(path);
  keyCache.set(path, key);
  return key;
}

/** Parse the base64 key the harness delivers. Exported so the wire format is
 * testable without a pipe; a malformed delivery never leaks the bytes. */
export function decodeDeliveredMemoryIntegrityKey(raw: string): Buffer {
  const line = raw.trim();
  if (!line) {
    throw new MemoryIntegrityError(
      "memory integrity key was not delivered on stdin; the host cannot authenticate records without it",
    );
  }
  const key = Buffer.from(line, "base64");
  if (key.length !== KEY_BYTES) {
    throw new MemoryIntegrityError(`delivered memory integrity key is not ${KEY_BYTES} bytes`);
  }
  return key;
}

/** Install a delivered key into this process's cache (stdin provider and
 * tests). Not reachable from any route, tool, or capability. */
export function installMemoryIntegrityKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new MemoryIntegrityError(`memory integrity key is not ${KEY_BYTES} bytes`);
  }
  keyCache.set(memoryIntegrityKeyPath(), Buffer.from(key));
}

/** Read the historical stdin delivery (one base64 line). Desktop-host only:
 *  on Android the equivalent frame rides the integrity bridge. */
export function readMemoryIntegrityKeyFromStdin(): Buffer {
  return decodeDeliveredMemoryIntegrityKey(readLine(0));
}

/** Test-only: forget cached keys and bridge state. */
export function resetMemoryIntegrityKeyCache(): void {
  keyCache.clear();
  legacyKey = null;
  stdinBuffer = "";
  pendingFrames.length = 0;
}

// ── MACs ───────────────────────────────────────────────────────────────────

function fileHmac(key: Buffer, purpose: string, payload: string): string {
  return createHmac("sha256", key).update(`${purpose}\n${payload}`, "utf8").digest("hex");
}

function sameHex(a: string, b: string): boolean {
  if (!HEX_64.test(a) || !HEX_64.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * The exact bytes an authenticity check covers for one record.
 *
 * Deliberately explicit rather than `JSON.stringify(record)`: unknown fields
 * added by a future writer must not change whether an old record verifies,
 * and every field that can change retrieval or authorization is named here.
 * Undefined and null are normalised to the same value so a JSON round-trip
 * through an older writer cannot create a false mismatch.
 */
export function canonicalIntegrityRecord(record: IntegrityRecordShape): string {
  return JSON.stringify({
    accessCount: Math.trunc(record.accessCount),
    archivedAt: record.archivedAt ?? null,
    botId: record.botId,
    category: record.category,
    confidence: Number(record.confidence.toFixed(4)),
    createdAt: Math.trunc(record.createdAt),
    deletedAt: record.deletedAt ?? null,
    deprecatedAt: record.deprecatedAt ?? null,
    deprecationReason: record.deprecationReason ?? null,
    detail: record.detail,
    headline: record.headline,
    id: record.id,
    lastReinforcedAt: Math.trunc(record.lastReinforcedAt),
    lifecycle: record.lifecycle ?? "active",
    redacted: Boolean(record.redacted),
    sha256Hash: record.sha256Hash,
    sourceTurnId: record.sourceTurnId,
  });
}

type MacAuthority = "signer" | "native" | "legacy" | "file";

function authorityFor(version: MemoryIntegrityVersion): MacAuthority {
  if (version === SIGNER_MEMORY_INTEGRITY_VERSION || version === MERKLE_MEMORY_INTEGRITY_VERSION) return "signer";
  if (version === NATIVE_MEMORY_INTEGRITY_VERSION) return "native";
  return memoryIntegrityKeyProvider() === "native" ? "legacy" : "file";
}

/**
 * The payload the prior manifest's MACs cover, per record id.
 *
 * Null when the file is missing or unreadable: the caller then signs every
 * record, which is slower but never wrong. This never decides whether a record
 * is trustworthy — the store was verified on load before the write path got
 * here — it only decides whether recomputing an identical MAC is necessary.
 */
function priorRecordPayloads(recordsPath: string): Map<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(recordsPath, "utf8"));
    if (!Array.isArray(parsed)) return null;
    const payloads = new Map<string, string>();
    for (const record of parsed as IntegrityRecordShape[]) {
      if (!record || typeof record.id !== "string") return null;
      payloads.set(record.id, canonicalIntegrityRecord(record));
    }
    return payloads;
  } catch {
    return null;
  }
}

function recordMacs(records: IntegrityRecordShape[], authority: MacAuthority): string[] {
  const payloads = records.map(canonicalIntegrityRecord);
  if (authority === "signer") return nativeMacBatch("record", payloads, "v3");
  if (authority === "native") return nativeMacBatch("record", payloads, "v2");
  const key = authority === "legacy" ? legacyMemoryIntegrityKey() : memoryIntegrityKey();
  return payloads.map((payload) => fileHmac(key, "omb-memory-record-v1", payload));
}

export function recordMac(
  record: IntegrityRecordShape,
  authority: MacAuthority = memoryIntegrityKeyProvider() === "native" ? "native" : "file",
): string {
  return recordMacs([record], authority)[0]!;
}

export function recordsDigest(records: IntegrityRecordShape[]): string {
  return createHash("sha256")
    .update(JSON.stringify(records.map(canonicalIntegrityRecord)), "utf8")
    .digest("hex");
}

// ── v4 Merkle root ─────────────────────────────────────────────────────────
// One signer MAC authenticates a root that commits to every canonical record.
// The hashing is local (Node's SHA-256); only the root and the manifest header
// cross the Keystore bridge. Domain separation makes a leaf, an internal node
// and the empty root different preimages, so a record can never be replayed as
// a node or a two-record tree as a leaf.

const MERKLE_LEAF_DOMAIN = "omb-memory-leaf-v4\n";
const MERKLE_NODE_DOMAIN = "omb-memory-node-v4\n";
const MERKLE_EMPTY_DOMAIN = "omb-memory-root-v4\nempty\n";

function sha256Hex(parts: Buffer | string, ...rest: Array<Buffer | string>): string {
  const hash = createHash("sha256").update(parts);
  for (const part of rest) hash.update(part);
  return hash.digest("hex");
}

/** A record's canonical leaf hash. Every field the canonical payload covers is
 *  committed here; two records that differ in any covered byte get different
 *  leaves. */
export function merkleLeaf(record: IntegrityRecordShape): string {
  return sha256Hex(MERKLE_LEAF_DOMAIN, canonicalIntegrityRecord(record));
}

/** Ordering is the record id, byte-wise, independent of file order. */
function canonicalLeafOrder(records: IntegrityRecordShape[]): string[] {
  return [...records]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(merkleLeaf);
}

/**
 * The Merkle root over the canonical record set.
 *
 * Odd nodes are promoted unchanged to the next level (not duplicated), which
 * keeps the tree shape a function of the count alone and avoids the classic
 * duplicate-last-leaf ambiguity. Duplicate ids are rejected by the callers
 * before this runs; the root itself is shape-only.
 */
export function merkleRoot(records: IntegrityRecordShape[]): string {
  let layer = canonicalLeafOrder(records);
  if (layer.length === 0) return sha256Hex(MERKLE_EMPTY_DOMAIN, "0");
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1] ?? left;
      next.push(sha256Hex(MERKLE_NODE_DOMAIN, left, right));
    }
    layer = next;
  }
  return layer[0]!;
}

/** Reject a set whose ids collide: two records with one id have no single
 *  canonical position in the tree (the writer dedupes, so this is tamper or a
 *  corrupt store). */
function assertUniqueRecordIds(records: IntegrityRecordShape[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) throw new MemoryIntegrityError(`duplicate record id "${record.id}"`);
    seen.add(record.id);
  }
}

function manifestPayload(manifest: Omit<MemoryIntegrityManifest, "mac">): string {
  const macs = Object.keys(manifest.macs)
    .sort()
    .map((id) => [id, manifest.macs[id]]);
  // v1 keeps its exact historical payload, so manifests written before this
  // change still verify. v2 names its authority, which makes a downgrade to
  // v1 fail even if the old key were available.
  if (manifest.version === MERKLE_MEMORY_INTEGRITY_VERSION) {
    // The empty `macs` array keeps the signed payload in the shape the signer
    // has always accepted and makes the absence of per-record MACs explicit;
    // the root and the bot binding are what this version authenticates.
    return JSON.stringify({
      botId: manifest.botId ?? null,
      count: manifest.count,
      digest: manifest.digest,
      macs: [] as string[],
      provider: manifest.provider ?? null,
      root: manifest.root ?? null,
      seq: manifest.seq,
      version: manifest.version,
    });
  }
  if (
    manifest.version === NATIVE_MEMORY_INTEGRITY_VERSION ||
    manifest.version === SIGNER_MEMORY_INTEGRITY_VERSION
  ) {
    return JSON.stringify({
      count: manifest.count,
      digest: manifest.digest,
      macs,
      provider: manifest.provider ?? null,
      seq: manifest.seq,
      version: manifest.version,
    });
  }
  return JSON.stringify({
    count: manifest.count,
    digest: manifest.digest,
    macs,
    seq: manifest.seq,
    version: manifest.version,
  });
}

export function manifestMac(manifest: Omit<MemoryIntegrityManifest, "mac">): string {
  const payload = manifestPayload(manifest);
  const authority = authorityFor(manifest.version);
  if (authority === "signer") return nativeMacBatch("manifest", [payload], "v3")[0]!;
  if (authority === "native") return nativeMacBatch("manifest", [payload], "v2")[0]!;
  const key = authority === "legacy" ? legacyMemoryIntegrityKey() : memoryIntegrityKey();
  return fileHmac(key, "omb-memory-manifest-v1", payload);
}

// ── rollback anchor ────────────────────────────────────────────────────────
//
// MACs prove authenticity; they cannot prove freshness, because an old
// manifest is still a validly sealed manifest. The freshness authority is the
// signer's own per-store generation counter, in the signer's private storage —
// a different UID, which the app (and therefore the agent shell) cannot read or
// write. This file only relays requests to it.

export const MEMORY_INTEGRITY_ANCHOR_BASELINE_ENV = "OMB_MEMORY_INTEGRITY_ALLOW_ANCHOR_BASELINE";

/** Identity of one canonical store, as the anchor knows it. The bot id keeps
 * shared and private domains apart; the directory keeps two installs that
 * happen to share a bot id (fixtures, a restored workspace) apart. */
export function memoryIntegrityStoreKey(botId: string, recordsPath: string): string {
  return createHash("sha256")
    .update(`${botId}\u0000${dirname(recordsPath)}`)
    .digest("hex")
    .slice(0, 32);
}

export interface MemoryAnchorHead {
  generation: number;
  digest: string;
  pending: { generation: number; digest: string } | null;
}

let anchorBridgeForTest:
  | ((op: "head" | "prepare" | "commit" | "baseline", frame: Record<string, unknown>) => Record<string, unknown>)
  | null = null;

/** Unit tests cannot own the app's socketpair; this seam substitutes the
 * signer's anchor store. The real bridge is verified on the device. */
export function __setNativeAnchorBridgeForTest(
  bridge: ((op: "head" | "prepare" | "commit" | "baseline", frame: Record<string, unknown>) => Record<string, unknown>) | null,
): void {
  if (process.env.NODE_ENV !== "test") throw new Error("native anchor bridge override is test-only");
  anchorBridgeForTest = bridge;
}

function anchorRequest(
  op: "head" | "prepare" | "commit" | "baseline",
  frame: Record<string, unknown>,
): Record<string, unknown> {
  const response = anchorBridgeForTest
    ? anchorBridgeForTest(op, frame)
    : bridgeRequest({ ...frame, op, key: "v3" });
  // The seam returns the same shapes as the bridge, refusals included: a test
  // fake that answered `{error}` was being read as an empty success, so a
  // refused prepare looked like an invalid MAC instead of the anchor's verdict.
  if (typeof response.error === "string") {
    throw new MemoryIntegrityError(`the rollback anchor refused ${op}: ${response.error}`);
  }
  return response;
}

/** The signer's committed generation for this store, or null when it has none. */
export function signerAnchorHead(storeKey: string): MemoryAnchorHead | null {
  const response = anchorRequest("head", { storeKey });
  const raw = response.head;
  if (raw === "none" || raw === undefined) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    throw new MemoryIntegrityError("the rollback anchor answered with malformed state");
  }
  const generation = Number(parsed.generation);
  const digest = String(parsed.digest ?? "");
  if (!Number.isInteger(generation) || generation < 1 || !HEX_64.test(digest)) {
    throw new MemoryIntegrityError("the rollback anchor answered with invalid state");
  }
  const pendingRaw = parsed.pending as Record<string, unknown> | undefined;
  const pending = pendingRaw && Number.isInteger(Number(pendingRaw.generation))
    ? { generation: Number(pendingRaw.generation), digest: String(pendingRaw.digest ?? "") }
    : null;
  return { generation, digest, pending };
}

/** MAC a manifest *and* prepare its generation, in one signer transaction. */
function prepareManifestMac(storeKey: string, payload: string): string {
  const response = anchorRequest("prepare", { storeKey, payload });
  const mac = String(response.mac ?? "");
  if (!HEX_64.test(mac)) throw new MemoryIntegrityError("the rollback anchor returned an invalid MAC");
  return mac;
}

function commitGeneration(storeKey: string, generation: number, digest: string): void {
  anchorRequest("commit", { storeKey, generation, digest });
}

function baselineGeneration(storeKey: string, payload: string, mac: string): void {
  anchorRequest("baseline", { storeKey, payload, mac });
}

/** May this boot establish a *first* anchor for a store that predates
 * anchoring? Set by the harness on the first boot after the upgrade only. */
export function anchorBaselineAuthorized(): boolean {
  return process.env[MEMORY_INTEGRITY_ANCHOR_BASELINE_ENV] === "1";
}

export function memoryAnchorMarkerPath(): string {
  return join(dirname(memoryIntegrityKeyPath()), "anchor", "baseline.json");
}

export function anchorBaselineEstablished(): boolean {
  return existsSync(memoryAnchorMarkerPath());
}

/** Record that the anchor migration walked every store; afterwards a missing
 * anchor is damage, not a first run. App-writable on purpose: it can only
 * re-arm the *request*, and the signer still refuses a second baseline. It is
 * written only after the whole roster was visited, never by a single store. */
export function rememberAnchorBaseline(): void {
  mkdirSync(dirname(memoryAnchorMarkerPath()), { recursive: true, mode: 0o700 });
  writeFileAtomic(memoryAnchorMarkerPath(), `${JSON.stringify({ v: 1, at: Date.now() })}\n`, { mode: 0o600 });
}

/**
 * Is the store on disk still the generation the signer committed?
 *
 * Three outcomes are legitimate: the same generation with the same digest, the
 * generation after a commit that crashed before it was recorded (completed
 * here), and a first anchor for a store that predates anchoring (authorized
 * boot only). Everything else — older, newer than one step, same generation
 * with different bytes — fails closed.
 */
export function assertMemoryIntegrityCurrent(
  botId: string,
  recordsPath: string,
  manifest: MemoryIntegrityManifest,
): void {
  if (authorityFor(manifest.version) !== "signer") return;
  const storeKey = memoryIntegrityStoreKey(botId, recordsPath);
  const head = signerAnchorHead(storeKey);
  if (!head) {
    if (manifest.seq === 1) {
      baselineGeneration(storeKey, manifestPayloadOf(manifest), manifest.mac);
      return;
    }
    if (!anchorBaselineAuthorized()) {
      throw new MemoryFreshnessError(
        `no rollback anchor is recorded for this store and this boot is not authorized to establish one; ` +
          `memory sealed before anchoring cannot be shown to be the latest`,
      );
    }
    baselineGeneration(storeKey, manifestPayloadOf(manifest), manifest.mac);
    return;
  }
  if (manifest.seq === head.generation) {
    if (manifest.digest !== head.digest) {
      throw new MemoryFreshnessError(
        `generation ${manifest.seq} on disk does not match the anchored digest; refusing a resealed history`,
      );
    }
    return;
  }
  if (manifest.seq < head.generation) {
    throw new MemoryFreshnessError(
      `records.json is generation ${manifest.seq} but generation ${head.generation} was committed: ` +
        `this store was rolled back`,
    );
  }
  // Ahead of the anchor by exactly one and matching the prepared candidate: a
  // write that was made durable and then lost its commit (a crash, or a signer
  // that went away between the two). Completing it here is safe because the
  // digest is the one the signer prepared and the MAC has already verified.
  if (manifest.seq === head.generation + 1 && head.pending &&
      head.pending.generation === manifest.seq && head.pending.digest === manifest.digest) {
    commitGeneration(storeKey, manifest.seq, manifest.digest);
    return;
  }
  throw new MemoryFreshnessError(
    `records.json is generation ${manifest.seq}, ahead of the committed generation ${head.generation} ` +
      `with no matching prepared commit`,
  );
}

/**
 * Finish a write that crashed between its two files.
 *
 * The commit order is prepare → records → manifest → commit. A crash after the
 * records are durable and before the manifest is leaves the store in the one
 * state no earlier step describes: `records.json` at N+1, the manifest still at
 * N, and the signer holding N+1 as its *prepared* candidate. Left alone the
 * store cannot be read (the manifest no longer covers the bytes) and cannot be
 * written (the write path verifies before sealing), so a killed process would
 * cost the last committed generation.
 *
 * The signer's pending candidate is the proof that those exact bytes are the
 * generation it was asked to seal: the digest of the file must equal the digest
 * the signer recorded at prepare time, which an attacker cannot arrange without
 * having produced those bytes in the canonical writer. Only then is the
 * manifest re-sealed (the signer prepares the same generation again, over the
 * same digest) and committed — the interrupted write completes instead of being
 * discarded, and nothing arbitrary is blessed. Every other mismatch returns
 * false and leaves the caller to fail closed.
 */
export function recoverInterruptedRecordsWrite(botId: string, recordsPath: string): boolean {
  if (memoryIntegrityKeyProvider() !== "native" || !memoryIntegritySignerMode()) return false;
  let manifest: MemoryIntegrityManifest | null;
  try {
    manifest = readManifest(recordsPath);
  } catch {
    return false;
  }
  if (
    !manifest ||
    (manifest.version !== SIGNER_MEMORY_INTEGRITY_VERSION &&
      manifest.version !== MERKLE_MEMORY_INTEGRITY_VERSION)
  ) {
    return false;
  }
  const storeKey = memoryIntegrityStoreKey(botId, recordsPath);
  const head = signerAnchorHead(storeKey);
  if (!head || !head.pending) return false;
  if (head.generation !== manifest.seq || head.pending.generation !== manifest.seq + 1) return false;
  let records: IntegrityRecordShape[];
  try {
    const parsed: unknown = JSON.parse(readFileSync(recordsPath, "utf8"));
    if (!Array.isArray(parsed)) return false;
    records = parsed as IntegrityRecordShape[];
  } catch {
    return false;
  }
  if (recordsDigest(records) !== head.pending.digest) return false;
  // Sign every record: the interrupted write has already replaced
  // records.json, so the prior manifest's MACs cannot be matched against it
  // to decide reuse (see sealMemoryIntegrity).
  const sealed = sealMemoryIntegrity(botId, records, recordsPath, manifest.seq + 1, {
    reusePriorMacs: false,
  });
  writeMemoryIntegrityManifest(recordsPath, sealed);
  completeMemoryIntegrityCommit(botId, recordsPath, sealed);
  return true;
}

/** Called only after the manifest is durable: makes the generation official. */
export function completeMemoryIntegrityCommit(
  botId: string,
  recordsPath: string,
  manifest: MemoryIntegrityManifest,
): void {
  if (authorityFor(manifest.version) !== "signer") return;
  commitGeneration(memoryIntegrityStoreKey(botId, recordsPath), manifest.seq, manifest.digest);
}

/** The payload an existing manifest's MAC covers. */
function manifestPayloadOf(manifest: MemoryIntegrityManifest): string {
  return manifestPayload(manifest);
}

/** The version a manifest sealed right now must carry. The separate-UID signer
 * seals v4 (one Merkle root); a boot with only the app-UID Keystore keeps v2,
 * and desktop keeps v1 and its file key exactly as before. */
let manifestVersionForTest: MemoryIntegrityVersion | null = null;

/** Fixtures for the v3→v4 migration need to create a v3 store after the
 *  current writer moved to v4. Test-only; there is no production path here —
 *  the signer rejects nothing about it, but a caller cannot reach this seam.
 */
export function __setManifestVersionForTest(version: MemoryIntegrityVersion | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("manifest version override is test-only");
  manifestVersionForTest = version;
}

export function currentManifestVersion(): MemoryIntegrityVersion {
  if (manifestVersionForTest !== null) return manifestVersionForTest;
  if (memoryIntegrityKeyProvider() === "native") {
    return memoryIntegritySignerMode() ? MERKLE_MEMORY_INTEGRITY_VERSION : NATIVE_MEMORY_INTEGRITY_VERSION;
  }
  return MEMORY_INTEGRITY_VERSION;
}

/** Build a signed manifest for exactly these records. Callers write the
 * records first, then this; a torn pair is caught on the next load. */
export function sealMemoryIntegrity(
  botId: string,
  records: IntegrityRecordShape[],
  recordsPath: string,
  seqOverride?: number,
  options: { allowFirstAnchor?: boolean; reusePriorMacs?: boolean } = {},
): MemoryIntegrityManifest {
  const prior = readManifest(recordsPath);
  let seq = seqOverride ?? 0;
  if (seq <= 0) {
    seq = prior && prior.seq > 0 ? prior.seq + 1 : 1;
  }
  const version = currentManifestVersion();
  if (version === MERKLE_MEMORY_INTEGRITY_VERSION) {
    // One manifest MAC authenticates the whole canonical set. Per-record MACs
    // are not written: the root commits to every canonical leaf, so changing
    // any covered byte changes the root the signer authenticated.
    assertUniqueRecordIds(records);
    const header = {
      version,
      provider: "keystore-signer" as const,
      seq,
      count: records.length,
      digest: recordsDigest(records),
      root: merkleRoot(records),
      botId,
      macs: {},
    } as Omit<MemoryIntegrityManifest, "mac">;
    const mac = sealManifestMac(botId, recordsPath, header, version, options.allowFirstAnchor === true);
    maybeCrashMemory("after-prepare");
    return { ...header, mac };
  }
  const authority: MacAuthority =
    version === SIGNER_MEMORY_INTEGRITY_VERSION ? "signer" : version === NATIVE_MEMORY_INTEGRITY_VERSION ? "native" : "file";
  const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const macs: Record<string, string> = {};
  // A record whose canonical payload is byte-identical to the one the prior
  // manifest already covers keeps that MAC. This is not a weaker check: HMAC
  // over the same bytes under the same key *is* the same value, so the only
  // thing skipped is recomputing it. It is allowed only when the prior
  // manifest carries the same authority/version — a re-seal under a new key
  // (the v2→v3 migration) signs everything again — and only for records whose
  // bytes are unchanged, which the prior manifest authenticated on load before
  // this write was allowed to run at all.
  // Reuse is only sound while the prior manifest's MACs and the bytes on disk
  // still describe the same records. The normal save path seals *before* it
  // writes, so the file holds exactly what the prior manifest authenticated.
  // The crash-recovery path is the opposite: the interrupted write already
  // replaced records.json, so reading it back would make every comparison
  // self-satisfying and carry an old MAC onto new bytes — a manifest that
  // cannot verify. Recovery therefore signs every record.
  const reusable = prior && prior.version === version && options.reusePriorMacs !== false
    ? priorRecordPayloads(recordsPath)
    : null;
  const toSign: IntegrityRecordShape[] = [];
  for (const record of sorted) {
    const payload = canonicalIntegrityRecord(record);
    const priorMac = prior && prior.version === version ? prior.macs[record.id] : undefined;
    if (priorMac && reusable?.get(record.id) === payload) {
      macs[record.id] = priorMac;
    } else {
      toSign.push(record);
    }
  }
  const macList = toSign.length > 0 ? recordMacs(toSign, authority) : [];
  toSign.forEach((record, index) => {
    macs[record.id] = macList[index]!;
  });
  const header = {
    version,
    ...(version === SIGNER_MEMORY_INTEGRITY_VERSION
      ? { provider: "keystore-signer" as const }
      : version === NATIVE_MEMORY_INTEGRITY_VERSION
        ? { provider: "keystore" as const }
        : {}),
    seq,
    count: records.length,
    digest: recordsDigest(records),
    macs,
  } as Omit<MemoryIntegrityManifest, "mac">;
  const mac = sealManifestMac(botId, recordsPath, header, version, options.allowFirstAnchor === true);
  // The signer now holds the pending candidate. A crash-injection boot dies
  // here, before a single record reaches the disk (device tests only; the
  // variable is set by the preview harness and does nothing else).
  maybeCrashMemory("after-prepare");
  return { ...header, mac };
}

/**
 * The MAC for a manifest that is about to be written.
 *
 * Under the signer authority this is never a free MAC: it either prepares the
 * next generation (so the digest the anchor records is exactly the digest the
 * MAC covers) or, for a store that has never been anchored, establishes the
 * baseline the boot is allowed to establish. A store whose anchor exists can
 * only move forward one generation at a time, which is what makes a rolled-back
 * manifest impossible to re-seal even with a legitimate writer.
 */
function sealManifestMac(
  botId: string,
  recordsPath: string,
  header: Omit<MemoryIntegrityManifest, "mac">,
  version: MemoryIntegrityVersion,
  allowFirstAnchor: boolean,
): string {
  if (authorityFor(version) !== "signer") return manifestMac(header);
  const storeKey = memoryIntegrityStoreKey(botId, recordsPath);
  const head = signerAnchorHead(storeKey);
  if (head) {
    if (header.seq !== head.generation + 1) {
      throw new MemoryFreshnessError(
        `manifest sequence ${header.seq} is not the next generation after anchor generation ${head.generation}`,
      );
    }
    return prepareManifestMac(storeKey, manifestPayload(header));
  }

  // No anchor yet. Generation 1 is a store being born (or adopted), which
  // nothing can be rolled back to; anything else is a store sealed before
  // anchoring, and only a caller that has just verified the store under its
  // old authority (or a manually armed boot) may baseline it.
  if (header.seq !== 1 && !allowFirstAnchor && !anchorBaselineAuthorized()) {
    throw new MemoryFreshnessError(
      "this store has no rollback anchor and this boot is not authorized to establish one",
    );
  }
  const mac = manifestMac(header);
  baselineGeneration(storeKey, manifestPayload(header), mac);
  return mac;
}

export function writeMemoryIntegrityManifest(recordsPath: string, manifest: MemoryIntegrityManifest): void {
  writeFileAtomic(memoryIntegrityManifestPath(recordsPath), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

export function readManifest(recordsPath: string): MemoryIntegrityManifest | null {
  const path = memoryIntegrityManifestPath(recordsPath);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new MemoryIntegrityError("records integrity manifest is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MemoryIntegrityError("records integrity manifest is not an object");
  }
  const m = parsed as Partial<MemoryIntegrityManifest>;
  if (
    m.version !== MEMORY_INTEGRITY_VERSION &&
    m.version !== NATIVE_MEMORY_INTEGRITY_VERSION &&
    m.version !== SIGNER_MEMORY_INTEGRITY_VERSION &&
    m.version !== MERKLE_MEMORY_INTEGRITY_VERSION
  ) {
    throw new MemoryIntegrityError(`records integrity manifest has unsupported version ${String(m.version)}`);
  }
  if (m.version === NATIVE_MEMORY_INTEGRITY_VERSION && m.provider !== "keystore") {
    throw new MemoryIntegrityError("native records integrity manifest does not name the keystore provider");
  }
  if (
    (m.version === SIGNER_MEMORY_INTEGRITY_VERSION || m.version === MERKLE_MEMORY_INTEGRITY_VERSION) &&
    m.provider !== "keystore-signer"
  ) {
    throw new MemoryIntegrityError("signer records integrity manifest does not name the signer provider");
  }
  if (m.version === MERKLE_MEMORY_INTEGRITY_VERSION) {
    if (typeof m.root !== "string" || !HEX_64.test(m.root)) {
      throw new MemoryIntegrityError("merkle records integrity manifest has no root");
    }
    if (typeof m.botId !== "string" || m.botId.length === 0 || m.botId.length > 200) {
      throw new MemoryIntegrityError("merkle records integrity manifest has no store binding");
    }
  } else if (m.root !== undefined || m.botId !== undefined) {
    throw new MemoryIntegrityError("a pre-Merkle records integrity manifest names a root");
  }
  if (typeof m.seq !== "number" || !Number.isInteger(m.seq) || m.seq < 1) {
    throw new MemoryIntegrityError("records integrity manifest has an invalid sequence");
  }
  if (typeof m.count !== "number" || !Number.isInteger(m.count) || m.count < 0) {
    throw new MemoryIntegrityError("records integrity manifest has an invalid count");
  }
  if (typeof m.digest !== "string" || !HEX_64.test(m.digest)) {
    throw new MemoryIntegrityError("records integrity manifest has an invalid digest");
  }
  if (!m.macs || typeof m.macs !== "object" || Array.isArray(m.macs)) {
    throw new MemoryIntegrityError("records integrity manifest has invalid record MACs");
  }
  for (const [id, mac] of Object.entries(m.macs)) {
    if (!id || typeof mac !== "string" || !HEX_64.test(mac)) {
      throw new MemoryIntegrityError("records integrity manifest contains an invalid record MAC");
    }
  }
  if (m.version === MERKLE_MEMORY_INTEGRITY_VERSION && Object.keys(m.macs).length > 0) {
    throw new MemoryIntegrityError("merkle records integrity manifest carries per-record MACs");
  }
  if (m.version !== MERKLE_MEMORY_INTEGRITY_VERSION && m.count > 0 && Object.keys(m.macs).length === 0) {
    throw new MemoryIntegrityError("records integrity manifest has no record MACs");
  }
  if (typeof m.mac !== "string" || !HEX_64.test(m.mac)) {
    throw new MemoryIntegrityError("records integrity manifest is unsigned");
  }
  const { mac: _mac, ...header } = m as MemoryIntegrityManifest;
  if (!sameHex(manifestMac(header), m.mac)) {
    throw new MemoryIntegrityError("records integrity manifest MAC does not verify");
  }
  return m as MemoryIntegrityManifest;
}

export interface IntegrityVerification {
  ok: true;
  manifest: MemoryIntegrityManifest;
}

/**
 * Verify the whole store. Throws `MemoryIntegrityError` on any mismatch; the
 * caller converts that to a fail-closed store error and never returns a
 * partially verified partition as trusted context.
 */
export function verifyMemoryIntegrity(
  records: IntegrityRecordShape[],
  recordsPath: string,
  expectedBotId?: string,
): IntegrityVerification {
  const manifest = readManifest(recordsPath);
  if (!manifest) throw new MemoryIntegrityError("records integrity manifest is missing");
  if (manifest.count !== records.length) {
    throw new MemoryIntegrityError(
      `records integrity manifest covers ${manifest.count} records but ${records.length} are present`,
    );
  }
  // The store's identity is part of what is authenticated. Without this a
  // valid generation-1 store copied into another bot's directory verified and
  // then baselined a fresh anchor for it — the root was valid, it just
  // belonged to someone else. Records and (on v4) the manifest must name the
  // partition they are being read as.
  if (expectedBotId !== undefined) {
    for (const record of records) {
      if (record.botId !== expectedBotId) {
        throw new MemoryIntegrityError(`record "${record.id}" belongs to another store`);
      }
    }
    if (manifest.version === MERKLE_MEMORY_INTEGRITY_VERSION && manifest.botId !== expectedBotId) {
      throw new MemoryIntegrityError(
        `the manifest is bound to store "${manifest.botId}", not "${expectedBotId}"`,
      );
    }
  }
  if (manifest.version === MERKLE_MEMORY_INTEGRITY_VERSION) {
    // One root MAC was verified in readManifest. Reconstruct the root from the
    // records on disk: any changed, removed, added, reordered or cross-store
    // record produces a different root, before a single record is returned.
    assertUniqueRecordIds(records);
    for (const record of records) {
      if (record.botId !== manifest.botId) {
        throw new MemoryIntegrityError(`record "${record.id}" belongs to another store`);
      }
    }
    if (merkleRoot(records) !== manifest.root) {
      throw new MemoryIntegrityError("records do not match the authenticated Merkle root");
    }
    if (manifest.digest !== recordsDigest(records)) {
      throw new MemoryIntegrityError("records file digest does not match its manifest");
    }
    return { ok: true, manifest };
  }
  const authority = authorityFor(manifest.version);
  const ids = new Set<string>();
  const ordered: IntegrityRecordShape[] = [];
  for (const record of records) {
    if (ids.has(record.id)) throw new MemoryIntegrityError(`duplicate record id "${record.id}"`);
    ids.add(record.id);
    if (!manifest.macs[record.id]) throw new MemoryIntegrityError(`record "${record.id}" has no integrity MAC`);
    ordered.push(record);
  }
  for (const id of Object.keys(manifest.macs)) {
    if (!ids.has(id)) throw new MemoryIntegrityError(`manifest names absent record "${id}"`);
  }
  const computed = recordMacs(ordered, authority);
  ordered.forEach((record, index) => {
    if (!sameHex(manifest.macs[record.id]!, computed[index]!)) {
      throw new MemoryIntegrityError(`record "${record.id}" failed integrity verification`);
    }
  });
  if (manifest.digest !== recordsDigest(records)) {
    throw new MemoryIntegrityError("records file digest does not match its manifest");
  }
  return { ok: true, manifest };
}

/** The one-time upgrade path for records written before authenticity existed.
 * It runs only when no manifest and no ledger exist; the ledger then makes a
 * later manifest deletion a failure rather than a second welcome mat. */
export function legacyIntegrityAccepted(botId: string, recordsPath: string): boolean {
  return existsSync(memoryLegacyLedgerPath(botId, recordsPath));
}

/**
 * Whether this boot may adopt a manifest-less store as pre-authenticity state.
 *
 * The manifest and the ledger both live in the data directory, which is
 * writable by the application UID — and the bot's own shell runs under that
 * UID. Measured on the Galaxy A07: deleting `records.integrity.json` and the
 * ledger, then removing a record from `records.json`, made the next read
 * re-seal the reduced store with a live Keystore MAC (HTTP 200) — a downgrade
 * any same-UID process could perform, undoing the authenticity guarantee.
 * On-disk state cannot answer "has this store ever been sealed?", because
 * whoever can delete the manifest can delete the evidence too.
 *
 * So adoption is allowed only when the harness says so, and it says so only on
 * the boot where the retired wrapped key decrypted. That key is deleted at
 * retirement and its wrapping alias is a Keystore entry that cannot be
 * recreated with the old secret, so the authorization cannot be forged by a
 * same-UID process — it cannot choose the host's environment. The desktop
 * `file` provider keeps the historical behaviour: its key sits beside the
 * store anyway, so its threat model was never "a process that cannot read the
 * key".
 */
export function legacyUpgradeAuthorized(): boolean {
  const flag = process.env[MEMORY_INTEGRITY_LEGACY_UPGRADE_ENV];
  // The harness sets this on every Android spawn, so an explicit "0" is a
  // denial and wins over the desktop default below: a boot told it may not
  // adopt an unsealed store must not adopt one, whatever else it looks like.
  if (flag === "1") return true;
  if (flag === "0") return false;
  return memoryIntegrityKeyProvider() === "file";
}

export function rememberLegacyAcceptance(botId: string, manifest: MemoryIntegrityManifest, recordsPath: string): void {
  const ledger = memoryLegacyLedgerPath(botId, recordsPath);
  mkdirSync(dirname(ledger), { recursive: true, mode: 0o700 });
  writeFileAtomic(
    ledger,
    `${JSON.stringify({
      v: 1,
      at: Date.now(),
      count: manifest.count,
      digest: manifest.digest,
      // The upgrade is the one moment the old store is trusted as-is; the
      // digest records exactly what that moment contained for later review.
    })}\n`,
    { mode: 0o600 },
  );
}

export function acceptLegacyIntegrity(botId: string, records: IntegrityRecordShape[], recordsPath: string): MemoryIntegrityManifest {
  const manifest = sealMemoryIntegrity(botId, records, recordsPath, 1);
  writeMemoryIntegrityManifest(recordsPath, manifest);
  completeMemoryIntegrityCommit(botId, recordsPath, manifest);
  rememberLegacyAcceptance(botId, manifest, recordsPath);
  return manifest;
}

/** Re-seal one already-verified store under the Keystore key. The records are
 * not rewritten — only their manifest — and nothing is signed that the old
 * authority had not just verified. */
export function resealMemoryIntegrity(
  botId: string,
  records: IntegrityRecordShape[],
  recordsPath: string,
  prior?: MemoryIntegrityManifest | null,
): MemoryIntegrityManifest {
  // The caller only reaches this after `verifyMemoryIntegrity` accepted the
  // store under its old authority, so this is the one migration in which a
  // first anchor may be established from state that was just authenticated: a
  // pre-anchor store moving to the signer provider. It is not a general
  // "missing anchor" amnesty — a v3 store without an anchor still fails closed.
  const version = currentManifestVersion();
  const isSigner = authorityFor(version) === "signer";
  const storeKey = isSigner ? memoryIntegrityStoreKey(botId, recordsPath) : null;
  const head = storeKey ? signerAnchorHead(storeKey) : null;

  if (isSigner && prior && authorityFor(prior.version) === "signer") {
    if (!head) {
      throw new MemoryFreshnessError(
        "signer-sealed store has no rollback anchor; refusing to reseal without freshness anchor",
      );
    }
    if (prior.seq < head.generation) {
      throw new MemoryFreshnessError(
        `refusing to reseal a store whose prior sequence ${prior.seq} is older than the committed anchor generation ${head.generation}`,
      );
    }
    if (prior.seq === head.generation) {
      if (prior.digest !== head.digest) {
        throw new MemoryFreshnessError(
          `refusing to reseal a store whose generation ${prior.seq} digest does not match the anchored digest`,
        );
      }
    } else if (prior.seq === head.generation + 1) {
      if (head.pending && head.pending.generation === prior.seq && head.pending.digest === prior.digest) {
        // Interrupted commit recovery: complete the commit to advance head to prior.seq
        commitGeneration(storeKey!, prior.seq, prior.digest);
      } else {
        throw new MemoryFreshnessError(
          `refusing to reseal a store whose sequence ${prior.seq} is ahead of anchor generation ${head.generation} with no matching prepared commit`,
        );
      }
    } else {
      throw new MemoryFreshnessError(
        `refusing to reseal a store whose sequence ${prior.seq} is ahead of anchor generation ${head.generation} by more than one generation`,
      );
    }
  }

  if (isSigner && head !== null && prior && authorityFor(prior.version) !== "signer") {
    if (prior.seq <= head.generation) {
      throw new MemoryFreshnessError(
        `refusing to reseal a legacy store whose sequence ${prior.seq} is already anchored at generation ${head.generation}`,
      );
    }
  }

  let nextSeq: number | undefined;
  if (head) {
    if (prior && prior.seq === head.generation + 1 && head.pending && head.pending.generation === prior.seq) {
      nextSeq = prior.seq + 1;
    } else {
      nextSeq = head.generation + 1;
    }
  } else if (prior) {
    nextSeq = Math.max(2, prior.seq + 1);
  }

  const manifest = sealMemoryIntegrity(botId, records, recordsPath, nextSeq, {
    allowFirstAnchor: prior != null && authorityFor(prior.version) !== "signer",
  });
  writeMemoryIntegrityManifest(recordsPath, manifest);
  completeMemoryIntegrityCommit(botId, recordsPath, manifest);
  return manifest;
}

/** Record that every store is now sealed under the Keystore key. Called by
 * the store once the roster pass finishes without an operational failure; the
 * presence of this file is what lets the harness delete the retired wrapped
 * key. `refused` names the stores the retired key could not authenticate —
 * their bytes are untouched and they stay fail-closed, and recording them
 * here is the durable evidence of what happened, not a re-blessing. */
export function markNativeMigrationComplete(
  migrated: string[],
  refused: Array<{ botId: string; reason: string }> = [],
): void {
  mkdirSync(dirname(nativeMigrationMarkerPath()), { recursive: true, mode: 0o700 });
  writeFileAtomic(
    nativeMigrationMarkerPath(),
    `${JSON.stringify({ v: 2, at: Date.now(), migrated, refused })}\n`,
    { mode: 0o600 },
  );
  notifyNativeMigrationComplete();
}

export function nativeMigrationComplete(): boolean {
  return existsSync(nativeMigrationMarkerPath());
}

/** Written once the install has been re-sealed under the separate-UID
 *  signer's key. Distinct from the v1→v2 marker: an install may be past the
 *  first migration and still waiting for the second. */
export function signerMigrationMarkerPath(): string {
  return join(DATA_DIR, "memory-integrity", "signer-provider.json");
}

export function markSignerMigrationComplete(
  migrated: string[],
  refused: Array<{ botId: string; reason: string }> = [],
): void {
  mkdirSync(dirname(signerMigrationMarkerPath()), { recursive: true, mode: 0o700 });
  writeFileAtomic(
    signerMigrationMarkerPath(),
    `${JSON.stringify({ v: 3, at: Date.now(), migrated, refused })}\n`,
    { mode: 0o600 },
  );
}

export function signerMigrationComplete(): boolean {
  return existsSync(signerMigrationMarkerPath());
}

/** Files the generic device-file surface must never read or write: the
 * canonical record store, its manifest, and the key. `MEMORY.md` is not here
 * — that is the person's document and stays editable through its own route. */
export function isProtectedMemoryPath(path: string): boolean {
  const normal = path.replace(/\\/g, "/");
  if (normal === memoryIntegrityKeyPath().replace(/\\/g, "/")) return true;
  // The Android Keystore blob is ciphertext, but a file tool has no business
  // handling it either: replacing it would take memory down, not forge it.
  if (/(^|\/)memory-integrity\/key(\.keystore)?$/.test(normal)) return true;
  if (/(^|\/)memory-integrity\/native-provider\.json$/.test(normal)) return true;
  if (/(^|\/)memory-integrity\/signer-provider\.json$/.test(normal)) return true;
  return /(^|\/)memory\/records(\.integrity)?\.json$/.test(normal);
}

/** A small diagnostic used by boot and tests; no record content, no key. */
export function memoryIntegrityStatus(recordsPath: string): {
  manifest: boolean;
  verified: boolean;
  reason?: string;
} {
  if (!existsSync(recordsPath)) return { manifest: false, verified: true };
  try {
    const raw = JSON.parse(readFileSync(recordsPath, "utf8")) as IntegrityRecordShape[];
    if (!Array.isArray(raw)) return { manifest: false, verified: false, reason: "records is not an array" };
    verifyMemoryIntegrity(raw, recordsPath);
    return { manifest: true, verified: true };
  } catch (error) {
    return {
      manifest: existsSync(memoryIntegrityManifestPath(recordsPath)),
      verified: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
