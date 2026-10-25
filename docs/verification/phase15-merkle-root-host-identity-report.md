# Phase 15 — host identity, Merkle-root memory integrity, and measured verification

Date: 2026-10-24. Device: Samsung Galaxy A07 (`R8YY90VT4EM`, arm64, Android 16 /
API 36). Repository HEAD at start and end: `b945d72756199f004624a980127fdec5c56be6ce`
(no commit, branch `main`).

This phase had two objectives: decide whether the agent's own process can obtain
the host-identity token, and replace per-record signer MAC verification with one
authenticated Merkle root if the measurements justify it. Both were implemented
and measured on the device. **The token audit found a second exposure that had
survived the first fix, so the token was removed entirely** (§2); memory
verification now uses a v4 Merkle manifest (§4–§8).

---

## 1. Final acceptance status

| Item | Status | Evidence |
| --- | --- | --- |
| Host-identity token audit | **PASS** | §2: three delivery designs measured; the final design has no secret |
| Host impersonation by the agent process | **PASS (fixed)** | §2.5: `/proc/<host>/mem` readable → token design abandoned; boundary is the kernel-proven bridge pid |
| Foreign healthy listener not adopted | **PASS** | §9: `HOST FAILED: another application is serving …`; no HTTP served |
| Official app untouched | **PASS** | §9: version 1.1.1, `lastUpdateTime=2026-10-21 23:23:17`, host pid 25252 unchanged |
| Merkle v4 manifest + canonical leaves | **PASS** | §4, §5; 110 integrity tests |
| Signer authenticates v4 (root, bot binding, count, generation) | **PASS** | §5; signer 23 unit tests; device `prepared/committed generation 212` |
| v3→v4 migration preserves records | **PASS** | §7: 206-record store, `records.json` sha256 unchanged, seq 211→212 |
| Old snapshot rejected after a newer commit | **PASS** | §6, §8: HTTP 500 before context; survives host and app restarts |
| Mutation crash-safety | **PASS (unit)** / **NOT RUN (device re-injection this phase)** | §6.2: seven transitions still covered by tests; Phase 14 device runs stand |
| Memory sources feeding model context audited | **PASS** | §4.6 |
| Performance improvement measured | **PASS** | §10: 200+ record read median 2499 ms → 78 ms; 0 record MACs |
| Final APK / embedded runtime identity | **PASS** | §12: APK `5c620606…`, zip `65dc7f58…`, extracted `index-android.js` identical |
| Automated regression | **PASS except one inherited failure** | §11: 650/651 vitest, 1804/1804 Android, typecheck 0, lint 0 |
| No destructive Git or user-data action | **PASS** | §13: HEAD unchanged, no commit/push/reset/clean; official app never installed over |

The one failing vitest file (`server/legacy-migration.test.ts`) is a data-dir
bootstrap assertion unrelated to this task; it fails identically on re-run and
does not touch any file changed here (§11.4). It is reported, not hidden.

---

## 2. Host identity — what the token actually protected

### 2.1 The three designs, in order

1. **Per-installation token in `files/host-instance.token` (0600), also copied
   into the child's environment.** Same-UID code is not stopped by a file mode.
   Phase 15's first audit, run in the real agent PTY, read the file and
   `/proc/<host>/environ`. This was a confirmed impersonation path.
2. **Per-spawn token in memory only, delivered over the integrity bridge.**
   `HostIdentity.newToken()` → `HarnessHost` writes one `host-identity` frame on
   the accepted socketpair; the host keeps it in a module variable and
   `GET /api/host/identity` compares it in constant time. No file, no
   environment block, and the socket cannot be reopened via `/proc/<pid>/fd`
   (measured `ENXIO`). This looked sufficient and passed the first device run.
3. **No secret: the bridge peer pid is the identity (final).** This phase's
   re-audit found design 2 still exposed. `/proc/<pid>/mem` is *openable* by a
   same-UID process because `execve` resets `PR_SET_DUMPABLE` after the launcher
   sets it; design 2 therefore put a usable bearer token in readable memory.
   The token, the identity route and the whole token concept were removed.

### 2.2 Measured attack paths (Galaxy A07, preview UID 10286)

Run as `run-as com.openmausbot.companion.preview sh /data/local/tmp/probe.sh`
(UID 10286, SELinux `u:r:runas_app:s0:c30,c257,c512,c768`):

| Probe | Result |
| --- | --- |
| legacy `files/host/data/host-instance.token` | absent (deleted by `HostIdentity.discardLegacyTokenFile`) |
| 64-hex token-shaped files under `files/` | only `files/host-server/server.version` (bundle hash; not a token) |
| `/proc/<host>/environ` | readable — **1316 bytes**; contains `AT_DRIVER_TOKEN`, no host-identity value |
| `/proc/<host>/cmdline` | readable; no token |
| `/proc/<host>/fd` | 32 entries; reopening fd 0 (`dd`) → `ENXIO` (“No such device or address”) |
| `/proc/<host>/mem` | **open succeeded**, read at offset 0 → `EIO` (unmapped page). A real scanner would read mapped pages. This is the finding that retired the token. |
| `/proc/<app>/environ` | readable (6031 bytes); no host-identity value |
| `env` in the probe shell | 0 token-like variables |
| `GET /api/host/identity` after the fix | `404` — the route no longer exists |

The first two designs were therefore not a boundary against the agent process.
Design 3 removes the asset instead of moving it.

### 2.3 The final boundary

- The app creates a socketpair before spawning; the host dials in through
  `libombexec.so`, and the app accepts **only** the peer whose pid is the child
  it forked (`SO_PEERCRED`, with kernel parentage as fallback when the Java pid
  is hidden). This is `acceptHostBridge` in `HarnessHost.kt`.
- The accepted fd is `CLOEXEC`, is never inherited by a child, cannot be
  reopened through `/proc`, and dies with the host.
- `/api/health` now returns `{app, pid, port, static}`. The app treats a
  responder as its host only when `HostIdentity.verify(port, bridgePeerPid)`
  reports the same pid it got from the kernel. No header, no token, no
  adoption-by-port-health.
- Before a spawn the app has no bridge, so it trusts nothing on the port. It
  looks for its own leftover host via `/proc` command line **only to kill it**,
  then spawns; a listener that is not that process is a startup failure.
- `/api/host/identity` was deleted from `server/index.ts`; the
  `host-identity` frame handling was deleted from `server/memory-integrity.ts`.

Why a pid claim is not forgeable here: a foreign process can print any pid in
an HTTP body, but it cannot keep the app's bridge fd alive after killing the
host (the socket closes), and it cannot bind port 18789 while the host holds it.
If it kills the host first, the bridge is gone and the app refuses/restarts
rather than trusting the new responder.

### 2.4 Required reproduction results

| Check | Result |
| --- | --- |
| Preview host serves its own identity | `GET /api/health` → `pid=32312`, host pid `32312`; log `integrity bridge accepted — peer pid 32312` |
| Correct credential accepted | The app's own health probe succeeded and the host is serving; no external bearer credential exists to replay |
| Missing credential rejected | `/api/host/identity` is `404`; the identity decision does not use an HTTP credential |
| Agent process acquires the token | **No token exists.** `/proc/<host>/mem` is readable but holds no secret; legacy file deleted; env has none |
| Foreign process impersonates the host | **FAILED for the attacker**: a listener holding 18789 makes the app fail closed (`another application is serving … refusing to adopt it`), even before any HTTP answer |
| Official app untouched | Yes: separate UID 10039, port 18799, package update time 2026-10-21, host pid unchanged |
| Repeat after preview host restart | Host pid 3174 → 3606 after `kill -9`; serving resumed, rollback refusal preserved (§9) |

### 2.5 Residual limitation, stated plainly

The app process and its host remain same-UID, dumpable processes. Anything that
already executes inside this app's own trust boundary (a future native addon, a
replaced server bundle, an Android API-level exploit) can inspect them. During
this audit the only same-UID code available was `runas_app`, which could read
both; the agent PTY's `untrusted_app` shell is not more restricted. That is why
the fix is “no secret”, not “a better-hidden secret”. What the boundary does
guarantee is narrower and true: **another package, a stale process, or any
HTTP-only responder cannot be mistaken for this installation's host.**

---

## 3. Trust boundaries and threat model after this phase

| Boundary | Mechanism | What it stops |
| --- | --- | --- |
| App ↔ host identity | Kernel `SO_PEERCRED` on an app-owned socketpair + `/api/health` pid match | Another package's host, a stale host, a foreign listener, a token copied from disk/env/memory |
| Host ↔ signer | Bind with signature permission, enrollment challenge, pinned caller pid/start time, separate UID 10280 | The app UID (and therefore the agent shell) asking the signer for MACs |
| Memory authenticity | v4 Merkle root signed by the signer's non-exportable Keystore key | Editing/adding/removing/reordering records, cross-store copies, manifest edits |
| Memory freshness | Signer-owned per-store generation/digest anchor | Restoring a valid older records+manifest pair, same-generation reseal |
| Canonical context | `verifyMemoryIntegrity` before any record leaves the store; partition query fails closed on a private-store failure | Forged memory reaching prompts or snippets |
| Workspace documents | Shared `MEMORY.md` is not a context source; private `MEMORY.md` is bot-scoped (§4.6) | Cross-bot/shared prompt injection through Markdown |

Out of scope, unchanged: full-device or signer-state rollback (an attacker who
rolls back the whole data partition and the signer's private storage together
defeats the anchor), a replaced APK/runtime, and code running inside the app's
own trust boundary.

---

## 4. Merkle format (v4) and canonical leaves

### 4.1 Where it lives

- `server/memory-integrity.ts` — leaf/root construction, manifest payload,
  verification, migration seam (`__setManifestVersionForTest`, test-only),
  anchor protocol.
- `server/memory-store.ts` — lazy v3→v4 migration on load, sealing on write,
  fail-closed query/context paths, bot-binding check.
- `android/signer/.../MemorySignerService.kt` — accepts manifest versions 3 and
  4; v4 must carry `root` and `botId`; prepares/commits through `AnchorLedger`.
- Format version: **4** (`MERKLE_MEMORY_INTEGRITY_VERSION = 4`). v3 (per-record
  MACs) remains readable; v1/v2 remain readable as before.

### 4.2 Leaf definition

`canonicalIntegrityRecord()` is the single serializer, used by v1–v4. It names
every persisted field rather than stringifying the object, so unknown fields do
not change an old record's leaf:

```
accessCount (trunc)      archivedAt|null        botId
category                 confidence (4 dp)      createdAt (trunc)
deletedAt|null           deprecatedAt|null      deprecationReason|null
detail                   headline                id
lastReinforcedAt (trunc) lifecycle (default "active")
redacted                 sha256Hash              sourceTurnId
```

`JSON.stringify` of that object (fixed key order, UTF-8) is the leaf preimage:
`sha256("omb-memory-leaf-v4\n" + canonical)`. Undefined and null normalize to
the same value; numbers are truncated/rounded exactly once; strings are the
already-redacted canonical text.

### 4.3 Tree

- Leaves are ordered by **record id, byte-wise**, independent of file order.
- Odd node promoted unchanged (no duplicate-last-leaf ambiguity):
  `node = sha256("omb-memory-node-v4\n" + left + right)`.
- Empty store: `sha256("omb-memory-root-v4\nempty\n" + "0")`.
- Domain strings keep leaf/node/empty/manifest preimages distinguishable.
- Duplicate ids are rejected before a root is built (`assertUniqueRecordIds`).

### 4.4 Manifest

v4 manifest fields: `version`, `provider:"keystore-signer"`, `seq`, `count`,
`digest` (SHA-256 of the canonical array in file order, kept for compatibility),
`root`, `botId`, `macs:{}`, `mac`.

The signed payload is exactly:

```json
{"botId":…,"count":…,"digest":…,"macs":[],"provider":"keystore-signer",
 "root":…,"seq":…,"version":4}
```

`readManifest` rejects a v4 manifest with no 64-hex root, no bot binding, any
per-record MAC, an absent/invalid MAC, or a MAC that does not verify. The root
alone is never enough.

### 4.5 Verification

`verifyMemoryIntegrity(records, path, expectedBotId)`:

1. manifest exists, parses, has a valid MAC (one signer operation);
2. count matches;
3. every record's `botId` matches the partition being read; on v4 the manifest's
   `botId` must match too;
4. unique ids;
5. recomputed root equals `manifest.root`;
6. file-order digest equals `manifest.digest`.
Then `assertMemoryIntegrityCurrent` checks the signer anchor (generation and
digest), completing a prepared commit if the crash left one, and refusing older
or unanchored states. Only after all of that does `loadMemoryRecords` filter by
lifecycle and return records.

### 4.6 Every source that can reach model context

Inspected call sites in `server/memory-store.ts`, `server/workspace.ts`,
`server/capabilities/context-pipeline.ts`, `server/index.ts`,
`server/memory-journal.ts`:

| Source | Reaches context? | Trust |
| --- | --- | --- |
| Canonical records, bot private (`bots/<id>/memory/records.json`) | Yes: `assembleMemoryForContext`, `queryPartitionedMemory`, pipeline persistent layer | v4-authenticated + anchored; fails closed |
| Canonical records, shared (`shared/memory/records.json`) | Yes, same paths | v4-authenticated; per-partition degradation only where no Markdown is read |
| Migrated Markdown → records | Yes, as records | One-time `migrateSharedMarkdownOnce` when no store exists, ledger-once; confidence/relevance gate |
| Person’s Markdown saves | Yes, via `ingestSharedMarkdown`/`syncMarkdownToRecords` validation into records | Authorized ingestion path, then authenticated as records |
| Shared `MEMORY.md` | **No** | Explicitly excluded from `assembleMemoryForContext` and `queryPartitionedMemory`; only the person’s UI reads/writes it |
| Bot-private `MEMORY.md` | Yes: `memorySystemPrompt` and mirror lines in `assemble`/`query` | **Not Merkle-authenticated.** Bot-scoped, redacted on the server write path, mirror lines filtered against removed records. Agent file tools can write it, so it can self-inject into that same bot's prompt; it cannot reach another bot’s context. Documented as a residual (§14). |
| `memory/<topic>.md`, daily logs | Only when the agent calls `session_search`/file tools | Tool output, not automatic context |
| Journals (`memory-journal.ts`) | No | Audit trail only; no record text in the integrity reasons |
| Archived/deleted records | Yes when requested, and in the root | Authenticated; lifecycle/archive fields are inside the leaf |

No raw workspace Markdown is promoted into records by hashing. The Merkle root
protects `records.json`, not the private mirror; the report does not claim
otherwise.

---

## 5. Manifest authentication and the signer anchor

- The signer (`MemorySignerService`) validates the caller, protocol, purpose,
  payload shape, and manifest version **before** computing a MAC. v4 requires
  `root` (64 hex) and `botId`; `macs` must be absent/empty; version 3 still
  requires its `macs` map.
- `prepareManifest` parses and validates the manifest, then
  `AnchorLedger.prepare` records the candidate generation/digest. It refuses a
  generation other than `committed + 1`. `commitManifest` accepts only the
  prepared candidate.
- `sealManifestMac` never signs a bare digest: it either prepares the next
  generation (normal write) or baselines a store that has no anchor, and only
  after the old bytes verified (migration) or an authorized boot.
- The anchor store key is `sha256(botId + "\0" + dirname(recordsPath))[:32]`, so
  shared/private stores and copied directories are distinct.
- The signer's anchor file is in UID 10280 storage; the app cannot read or
  write it. A copy of a valid store into another directory has no anchor and is
  refused (device: “belongs to another store”/no anchor).

---

## 6. Crash recovery and concurrency

### 6.1 Unit coverage (executed this phase)

- Seven commit transitions (before prepare, after prepare, after records, after
  manifest, after commit, after response, plus the record-reinforcement case)
  remain covered in `server/memory-integrity.test.ts` section J.
- Interrupted records→manifest recovery re-seals **every** record (no MAC reuse
  against bytes the prior manifest did not cover).
- A prepared commit is completed on the next read only when the file digest
  equals the signer's prepared digest; a forged record in that window is
  refused and the anchor does not move.
- Concurrent same-store writes are detected by the file hash (`conflict` /
  `hash-mismatch`), different stores are independent, and the anchor refuses a
  repeated or skipped generation.
- A failed signer prepare (observed on device before the signer APK was
  upgraded) leaves `records.json` and the v3 manifest untouched and returns
  `ERR_MEMORY_INTEGRITY`; nothing was re-signed.

### 6.2 Device crash injection

The seven-transition crash matrix was **NOT RUN again** this phase: each run
requires arming the preview-only global crash point and reinstalling/clearing
the preview, which would replace the final tested artifact mid-verification.
Phase 14's three runs per transition remain the physical evidence; this phase's
device runs cover host-only restart and full app restart. This distinction is
deliberate, not an inferred pass.

---

## 7. Migration and compatibility

Lazy, on the first load after the upgrade, inside the existing write/verify
path (`loadMemoryRecords` → `resealMemoryIntegrity`):

1. The v3 manifest and every v3 record MAC are verified with the signer.
2. The anchor is checked (the store must be the committed generation).
3. The same records are sealed as v4 with `seq = prior.seq + 1`; the new root
   and bot binding are signed through `prepareManifest`.
4. The manifest is written atomically; the anchor commits generation N+1.
5. `records.json` is never rewritten.

Device run on the 206-record `Perf fixture F`:

- Before: `version 3 seq 211 count 206 macs 206`, anchor `gen=211`,
  `records.json` sha256 `6d775b92…`.
- First read after installing the final build: HTTP 200, 206 records,
  `1.6167 s`; manifest `version 4 provider keystore-signer seq 212 count 206
  macs 0 root 4efa35828f59064d…`; `records.json` sha256 **unchanged**
  `6d775b92…`; signer log `prepared generation 212`, `committed generation 212`.
- Second read: one manifest MAC, no record MACs, seq stays 212.
- The shared store migrated the same way on the first partitioned query
  (`v4 seq 2 count 1`); Fixture D migrated to `v4 seq 6 count 4`.
- A v3 pair restored after the v4 commit is refused by the anchor
  (“generation 211 but 212 was committed”), not re-migrated.

Compatibility limits:

- A **v3 store remains readable** if the signer is absent? No: v3 and v4 both
  declare the signer provider, so a boot without the signer fails closed. This
  is intentional (previous phase measured the downgrade to v2).
- The first v4 migration cannot detect a rollback that happened **before** the
  signer anchor existed; anchoring begins from the state that verified at that
  moment. Stated as a baseline limitation, unchanged from Phase 13/14.
- No silent format reset and no fresh anchor: a store whose bytes cannot be
  verified is left untouched and refused (device and unit coverage).

---

## 8. Adversarial tampering and context injection

All tests drive the real store; `server/memory-integrity.test.ts` now has a
dedicated v4 suite (section K) in addition to the existing v1–v3 suites.

### 8.1 Roots and canonicalization

- 200-record store: root equals `merkleRoot(records)`; one manifest MAC, zero
  record MACs; 201st write keeps zero record MACs.
- Root is stable across file reordering; a reordered *file* is still rejected
  because the digest is file-order-bound.
- Empty root is deterministic, 64 hex, distinct from a non-empty root; leaf ≠
  root; unicode content verifies and round-trips.
- Count mismatch (`covers 1 records but 2 are present`), duplicate ids, malformed
  manifests, and records without a manifest are refused.

### 8.2 Record tampering (v4)

Each mutation is written with a **recomputed record SHA-256**, so only the root
can catch it. All were rejected:

headline, detail, confidence, owner bot id, category, provenance, record id,
lifecycle, created/lastReinforced timestamps, access count, archivedAt,
deprecation fields, redaction flag; deletion, insertion, duplication,
reordering, whole-store replacement, and a valid store copied into another
bot’s directory or the shared scope.

### 8.3 Manifest/anchor attacks

- Root replaced (all-zero or recomputed over forged records) → `MAC does not
  verify`.
- Generation changed, bot binding changed → `MAC does not verify`.
- Per-record MACs injected → `carries per-record MACs`.
- Root removed → `has no root`.
- Manifest removed → `no integrity manifest` / “already upgraded”.
- Valid N−1 and N−2 pairs after N → `rolled back`, before and after host/app
  restart.
- Same generation with different bytes → `does not match the anchored digest`.
- Ahead of the anchor with no prepared candidate → `ahead of the committed
  generation`.
- Missing anchor → fails closed unless an authorized baseline boot.
- Copy of a valid pair into another directory/bot → refused (`belongs to
  another store`; no anchor for that store identity).

### 8.4 End-to-end context

For a tampered private store, `loadMemoryRecords`, `retrieveMemoryRecords`,
`queryPartitionedMemory` and `assembleMemoryForContext` all throw
`ERR_MEMORY_INTEGRITY`; the forged marker never appears in a snippet or frame.
For a verified private store the partition query reads its `MEMORY.md` mirror
only after the store verified; on a shared-store failure the shared partition
contributes nothing (its mirror is never scanned). Device: a copied pair and a
restored older pair returned HTTP 500 on both the records route and the
partitioned query route.

---

## 9. Host identity and official/preview isolation (final build)

Device state during the final runs:

| Package | Version | UID | Notes |
| --- | --- | --- | --- |
| `com.openmausbot.companion` (official) | 1.1.1 | 10039 | Never installed over; host pid 25252 alive throughout; `lastUpdateTime 2026-10-21 23:23:17` |
| `com.openmausbot.companion.preview` | 1.1.1-threads-preview | 10286 | Installed 12:16; final APK `5c620606…` |
| `com.openmausbot.companion.signer` | 1.0.0 | 10280 | Updated 11:39; test task 23/23 |

- `/api/host/identity` returns `404`; the token route is gone.
- `GET /api/health` → `{"app":"openmausbot","pid":32312,"port":18789,…}`; the
  preview host at that moment was pid 32312, and the log records
  `integrity bridge accepted — peer pid 32312 authenticated by pid + SO_PEERCRED`.
- `files/host/data/host-instance.token` is absent; no token-shaped file exists
  under `files/` except the bundle hash file.
- A same-UID shell (`runas_app`, UID 10286) was used to re-run the audit after
  the token was removed: `/proc/<host>/environ` and `/proc/<app>/environ` are
  readable, `/api/host/identity` is 404, and there is no secret in either
  process to recover. `/proc/<host>/fd/0` cannot be reopened (`ENXIO`).
- **Foreign listener test:** with the preview stopped, `toybox nc -l -p 18789`
  held the preview’s own port; starting the app produced
  `HOST FAILED: another application is serving 127.0.0.1:18789 (port 18789 is
  held by a listener this app process did not start); refusing to adopt it` and
  the API answered nothing (`000`). After the listener was removed and the app
  restarted, it served again (4 polls) with a fresh host.
- Host-only restart: killed host pid 3174; the app spawned pid 3606 within four
  polls; the health pid matched the new bridge peer; a rolled-back store stayed
  refused.
- App restart (`force-stop` + launcher): host 3606; identity route still 404;
  the rollback refusal survived, and restoring N+1 served 200 again.
- `logcat`: `FATAL EXCEPTION` count **0**, `ANR in` count **0**.

The official app and the preview use separate ports (18799 vs 18789) and
separate UIDs, and neither was ever pointed at the other's data.

---

## 10. Galaxy A07 performance (same fixture, same adb-forwarded loopback)

Comparable baseline: the v3 build installed before this phase’s changes, same
206–207-record `Perf fixture F`, same device, same HTTP route. Times include the
adb forward and the HTTP round trip.

| Operation | v3 baseline (median / p90) | v4 final (median / p90) | Change |
| --- | --- | --- | --- |
| GET records, 200+ (n=7) | **2499 ms / 3309 ms** | **78 ms / 143 ms** | ~32× |
| POST one record, 200+ (n=5) | 2303 ms / 2585 ms | 200 ms / 206 ms | ~11.5× |
| POST partitioned query, 200+ (n=5) | 2970 ms / 3016 ms | 164 ms / 173 ms | ~18× |
| GET records, 4-record (n=5) | 74 ms / 74 ms | 47 ms / 48 ms | ~1.6× |
| GET records, empty (n=7) | 7 ms / 9 ms | 12 ms / 13 ms | noise (no store, no MAC) |

Signer operations, from the new per-request log in `HarnessHost`:

- v3 read of 206 records: `v3 signed record batch=206` + `v3 signed manifest
  batch=1` (one Keystore MAC **per record**).
- v4 read of 200+ records: `v3 signed manifest batch=1`, **no record batch at
  all**; the 200 leaves are local SHA-256.
- v4 write: one manifest batch, no record batch.

The 200-record read still loads, canonicalizes and hashes every record
(linear, local). What became constant is the number of **signer/Keystore
operations per verified snapshot**: 207 → 1. The unit test also pins this
(`K. Merkle-root manifest (v4)`, 200-record case: `recordMacOps=0`,
`manifestMacOps=1`; the v3 migration read costs 206 once).

Cold start was not re-measured separately this phase; the first post-install
read includes the 1.62 s migration of 206 v3 records, and later reads are warm.

---

## 11. Automated test results

Commands were run from the repository root; `set -o pipefail` on every piped
run; exit codes captured.

| Command | Result |
| --- | --- |
| `npm run typecheck` | **exit 0** |
| `npm run lint` (`oxlint --deny-warnings .`) | **exit 0**, 0 warnings / 0 errors, 1583 files |
| `npx vitest run server/memory-integrity.test.ts` | **110 passed** (including K, 200-record case) |
| `npx vitest run server/memory-store.test.ts` | **76 passed** |
| `npx vitest run server/memory-partition.test.ts` | **58 passed** |
| `npx vitest run server/memory-reconciliation.test.ts` | **38 passed** |
| `npx vitest run server/memory-routes.test.ts` | **9 passed** |
| `npx vitest run server/capabilities/context-pipeline.test.ts` | **27 passed** |
| `npx vitest run server/turn-context.test.ts` | **22 passed** |
| `npx vitest run server/index.test.ts` | **231 passed**, exit 0; 534.86 s, 545.98 s and the final post-refactor 516.00 s run (`.omb-scratch/p15-index3.log`) |
| `npx vitest run server/memory-journal.test.ts server/memory-downgrade-api.test.ts server/legacy-migration.test.ts server/permission-policy.test.ts server/system-prompt.test.ts server/capabilities/capability-registry.test.ts server/memory-room-prompt.e2e.test.ts` | **70 passed, 1 failed** (`legacy-migration`, see §11.4) |
| `npx vitest run server/thread-aware-bots.e2e.test.ts` | **9 passed** |
| `./gradlew :signer:testDebugUnitTest :core:test :app:testDebugUnitTest` | **BUILD SUCCESSFUL**; signer 23, core 608, app 1173 → **1804 tests, 0 failures** |
| `npm run build:server` + `node scripts/prepare-android-host.mjs` | exit 0; `server.zip` `65dc7f58…` |
| `./gradlew :signer:assemblePreview :app:assemblePreview` | exit 0 |

### 11.4 The one failure, accurately

`server/legacy-migration.test.ts` asserts `~/.opengrokbot` was renamed to
`~/.openmausbot` on a fresh boot with `HOME` in a temp dir. It fails because the
new dir already exists when `ensureDirs()` runs, so the rename is skipped.
Reproduced manually and on re-run; the failing code path is data-dir bootstrap
(`server/config.ts`, `store.ts`, `message-db.ts`), none of which this task
changed. `git diff HEAD` shows `server/store.ts` and `server/index.ts` already
modified by earlier phases before this task began; `config.ts` and the test are
untouched. It is reported as **inherited/unrelated**, not a memory-integrity
regression. No other test failed.

---

## 12. Final APK and embedded runtime identity

| Artifact | SHA-256 |
| --- | --- |
| Preview APK `android/app/build/outputs/apk/preview/app-arm64-v8a-preview.apk` | `5c6206067c1e0f9fd6dbe6fdc5c335346112ace3e139aa28e9fa89e332b86d02` |
| Embedded `assets/host/server.zip` in that APK | `65dc7f58930379ab0c83c038a3e937d9fb2780a6907334eeb1c78d47ff65ef1d` |
| Working-tree `android/app/src/main/assets/host/server.zip` | same `65dc7f58…` |
| Extracted runtime `files/host-server/index-android.js` on device | `a6489aecb1745fc2bfafc73267682b36405634b6b86b776b0abf1c0fc1cd9897` — byte-identical to the entry in the embedded `server.zip` |
| Signer APK `android/signer/build/outputs/apk/preview/signer-preview.apk` | `34da75e634312117ac0c0978e96ceedb69ed55ae013b2671f5fdbc55c00b1855` |

Package facts: preview `versionCode=10101`, `versionName=1.1.1-threads-preview`,
installed 12:16, UID 10286; signer `versionCode=1`, `versionName=1.0.0`, UID
10280; official 1.1.1, UID 10039, update time unchanged. All three share the
same signing certificate (`8de72180…`), which is expected and is not a UID
boundary. The signer’s Keystore reports `level=1` (software-backed) on this
device; that is the pre-existing device capability, not a regression.

---

## 13. Files changed and Git state

**This task (Phase 15) directly edited:**

- `server/memory-integrity.ts` — v4 leaves/root/manifest, test seam, anchor
  seam error handling, bot binding, removed host-identity token machinery.
- `server/memory-store.ts` — v4 sealing/migration, bot-binding check, private
  partition fail-closed on any integrity failure.
- `server/memory-integrity.test.ts` — v4 suite (roots, fields, shapes, manifest
  attacks, migration, context) and v3 fixture seam.
- `server/index.ts` — removed `/api/host/identity` and its import; `/api/health`
  now carries `port`.
- `android/app/src/main/kotlin/com/openmausbot/companion/host/HarnessHost.kt` —
  bridge peer pid, no token, port-ownership decision, health by pid, signer
  batch log.
- `android/app/src/main/kotlin/com/openmausbot/companion/host/HostIdentity.kt` —
  new file: health/verify by bridge pid, legacy token cleanup, explicit
  “no secret” documentation.
- `android/app/src/test/kotlin/com/openmausbot/companion/host/HostIdentityTest.kt`
  — rewritten for the pid boundary.
- `android/signer/src/main/kotlin/com/openmausbot/companion/signer/MemorySignerService.kt`
  — v4 manifest support (inside the untracked `android/signer/` added by an
  earlier phase).
- `android/app/src/main/assets/host/server.zip` — regenerated build artifact.

**Generated, not source:** `android/app/build/…` APKs, `dist-server/`,
`android/signer/build/…`, `.omb-scratch/*.log`, `*.sh`, `*.mjs`, and the fixture
files under `/tmp`. No APK was published; no device data was cleared.

**Git:** `HEAD` remains `b945d72756199f004624a980127fdec5c56be6ce`; branch `main`;
no commit, push, reset, clean, checkout, or stash. The tree was dirty before
this task (Phases 9–14 left 110 changed/untracked entries, including
`server/memory-integrity.ts` as an untracked new file and the whole
`android/signer/` package). Those inherited changes were not staged or
discarded. Temporary test state was limited to the preview package and its
fixtures; the copied cross-bot pair was deleted and the empty fixture restored.

---

## 14. Remaining risks and blocked verification

1. **Private `MEMORY.md` is not under the Merkle root.** It is bot-scoped and
   redacted on the server write path, but the agent's own file tools can write
   it and it is read into that bot's system prompt and mirror lines. It cannot
   cross to another bot. Closing this would require either authenticating a
   person-editable document or dropping mirror lines, both product changes.
2. **Full-device rollback** (data partition + signer private storage) remains
   outside the anchor, as stated since Phase 13. The first v4 migration cannot
   retroactively detect a rollback that predates the anchor.
3. **Same-UID code inside the app's trust boundary** can read app/host memory.
   The final identity does not rely on a secret, but a replaced bundle or a
   native addon still owns the app's own capabilities.
4. **Device crash-injection matrix** was not repeated this phase (§6.2); the
   unit tests and Phase 14 device runs stand, but this phase did not re-prove
   every physical process-death transition on the final APK.
5. **Migration of the `v2` 211-record store** was not exercised on device (only
   v3 stores were); the v2→v3→v4 path is covered by unit tests, including
   “re-seals a verified v2 store under the signer without rewriting records”.
6. **`server/legacy-migration.test.ts`** fails for a pre-existing boot-order
   reason unrelated to memory (§11.4); it should be fixed separately.
7. The final device run used the signer `level=1` software Keystore; a
   TEE/StrongBox device would have different absolute latencies (the operation
   count reduction is independent of that).
