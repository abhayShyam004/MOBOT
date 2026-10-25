# Phase 13 — Signer-owned anti-rollback anchor and enrollment-protocol audit

Device: Samsung SM-A075F (`R8YY90VT4EM`), Android 16 (`ro.build.version.release=16`), preview build
`1.1.1-threads-preview`, signer `1.0.0`.
HEAD at start and end: `b945d72756199f004624a980127fdec5c56be6ce` — nothing committed, nothing staged,
no `git reset`/`clean`/`checkout`, the official package `com.openmausbot.companion` never installed
over, uninstalled or force-stopped by this phase.

---

## 1. Acceptance status

| Gate | Subject | Status |
| --- | --- | --- |
| A | Trusted anti-rollback state outside the agent-writable memory directory | **PASS** |
| B | Crash-safe mutation protocol tying the anchor to the canonical store | **PASS** (protocol + unit tests; on-device crash injection **NOT RUN**) |
| C | Enrollment-protocol integrity (no same-UID takeover, replay, interception) | **PASS** |
| D | Backward compatibility for legitimate v2/v3 memory and legacy adoption | **PASS** |

Definition-of-done items 1–15 of the brief are met except where a line below says **BLOCKED** or
**NOT RUN**. The guarantee is explicitly *forward-looking*: an anchor created in this phase cannot
prove anything about generations sealed before it existed (§7.3), and a full-device or backup restore
that moves the signer's own data along with the app's is not detected (§15).

---

## 2. Threat model and trust boundaries

| Component | UID (device) | PID (observed) | What it can do |
| --- | --- | --- | --- |
| `com.openmausbot.companion` (official) | 10039 | 15988 (+ host 24628) | installed, untouched; owns the Keystore alias of the *pre-signer* era |
| `com.openmausbot.companion.preview` | 10286 | 28366 → 24559 after restart | the harness; spawns the Node host; **the adversary's UID** |
| Node host (`libnode_host.so`) | 10286 | child of 28366/24559 | canonical memory store, all memory routes |
| agent PTY / bot shell | 10286 | child of the host | same UID as the harness — this is the attacker |
| `com.openmausbot.companion.signer` | 10280 | 28450 | owns the non-exportable HMAC key **and the rollback anchor** |

The boundary that matters is the kernel's: the signer's `filesDir` (`/data/data/
com.openmausbot.companion.signer/files/rollback-anchor.json`) is `0700`/`0600` under UID 10280.
Measured from the main app's UID (10286, the exact UID every agent shell runs as):

```
$ adb shell run-as com.openmausbot.companion.preview ls -l /data/data/com.openmausbot.companion.signer/files/rollback-anchor.json
ls: ...: Permission denied
$ adb shell run-as com.openmausbot.companion.preview cat .../rollback-anchor.json
cat: ...: Permission denied
$ adb shell run-as com.openmausbot.companion.preview rm -f .../rollback-anchor.json
rm: ...: Permission denied
$ adb shell run-as com.openmausbot.companion.preview ls -ld /data/data/com.openmausbot.companion.signer
ls: ...: Permission denied
```

And as the signer itself:

```
-rw------- 1 u0_a280 u0_a280 504 2026-10-23 21:51 files/rollback-anchor.json
```

Out of scope, stated rather than implied: root, a compromised TEE/StrongBox (the key is
software-backed here — `key level=1` in the signer log), code executing inside the main app's own
process, and an attacker who can restore the signer package's data as well as the app's.

---

## 3. Reproduction of the paired-rollback attack

### 3.1 The attack, defined

Both files are attacker-writable and both were individually valid: `records.json` and
`records.integrity.json` from generation N−1, each with correct MACs under the signer key. Every
record MAC verifies, the manifest MAC verifies, the digest matches those records, `seq` is a
perfectly legal generation. Nothing in the pre-anchor design compares the pair to a *history*.

### 3.2 Pre-fix evidence

`server/memory-integrity.test.ts` pins the pre-fix behaviour as a regression:

* **"verifies the same N−1 bytes once the anchor is gone — the regression that motivated the
  anchor"** (line 1524). The same two files, the same signer key, the same record MACs; only the
  external freshness record is removed, and the store loads (2 records) and is accepted.

The Phase 12 report already recorded this as a residual. State snapshots captured on the pre-anchor
build (phase-12 APK, installed 11:12) are preserved in `.omb-scratch/phase13/`
(`n3-…` … `n6-records-rebuilt.json`). **Log classification:** the acceptance was observed on the
device before the anchor existed; the HTTP transcript of that specific run was not saved, so the
authoritative, repeatable statement of the pre-fix behaviour is the unit test above, not a device log.

### 3.3 Post-fix, on the device (the same attack, same fixture)

Fixture `AnchorFixture` (`0eaf64cb-…`): generation N−1 = 6 was restored over generation N = 7 while
the signer's anchor stayed at 7. Disk: `seq=6 count=6 digest=1636240207808e13`; anchor:
`gen=7 digest=06910add7cfd…`.

```
--- 1. canonical memory-store read
{"error":"ERR_MEMORY_INTEGRITY: records.json is generation 6 but generation 7 was committed: this store was rolled back"}
[HTTP 500]
--- 2. partitioned retrieval (shared + specialized)
{"error":"… this store was rolled back"}   [HTTP 500]
--- 5. write attempt against the stale store
{"error":"… this store was rolled back"}   [HTTP 500]
--- 6. disk still generation 6?
seq=6 count=6 digest=1636240207808e13
```

Full transcript: `.omb-scratch/p13-device-evidence.log`. The refusal happens inside
`loadMemoryRecords` before a single record is returned
(`server/memory-store.ts:1212` → `assertMemoryIntegrityCurrent`), so the stale snapshot cannot reach
the partitioned query, the context frame, or the prompt.

**Residual, measured:** `GET /api/bots/<id>/memory/file?path=MEMORY.md` still answers 200 (701 bytes)
for that bot. `MEMORY.md` is the person's own document — it is written from records but is not MAC'd
and is editable through its own route by design (`isProtectedMemoryPath` deliberately excludes it,
`server/memory-integrity.ts:1084`). A records-only rollback leaves that mirror at the *newer* state;
a rollback that also replaces it is indistinguishable from the person editing their own memory file,
which no integrity scheme can prevent while the file is theirs. Canonical records — the thing that
enters model context as memory — are covered.

---

## 4. Anchor architecture and signer-owned storage

**Where.** `SignerAnchorStore` (`android/signer/.../SignerAnchorStore.kt`) persists
`filesDir/rollback-anchor.json` in the signer's UID, through a `.tmp` sibling + `Os.chmod(0600)` +
`renameTo` (never a partial ledger). The document is `{body, mac}` where `mac =
HMAC-SHA256(signer key, "omb-memory-anchor-v1\n" + body.toString())`; a truncated or edited file fails
its own MAC and every operation then refuses (`AnchorLedger.Refused`). Missing and corrupt are
different states: missing is "this signer never anchored anything" (fresh install only, because the
directory is unreachable from the app UID); corrupt is damage and fails closed.

**What it holds.** One entry per store key:

```json
{"key":"<storeKey>","generation":N,"digest":"<64 hex>","pending":{"generation":N+1,"digest":"…"}}
```

`storeKey = memoryIntegrityStoreKey(botId, recordsPath)` — a hash of bot id + absolute records path,
so a valid pair copied into another directory under the same bot id is a *different* store and has no
anchor (test: "refuses a valid pair copied into a different directory under the same bot id"). No
memory content, no headlines, no key material is stored — only monotone generation counters and
SHA-256 digests of the record set.

**Operations** (AIDL `IMemorySigner`, mirrored in the app's `android/app/src/main/aidl/…`):

| Method | Effect |
| --- | --- |
| `anchorHead(store)` | `"none"` or `{generation, digest, pending}` |
| `prepareManifest(store, payload)` | MACs a canonical manifest **and** records its `(seq, digest)` as the pending candidate, in one transaction |
| `commitManifest(store, gen, digest)` | promotes the pending candidate; idempotent |
| `baselineManifest(store, payload, mac)` | first anchor for a pre-anchor store; recomputes the MAC from the payload rather than trusting the caller, and refuses to overwrite an existing anchor |

There is **no** call that advances the anchor for an arbitrary digest. The MAC of a manifest and its
preparation are the same operation, so a caller cannot prepare one candidate and write another.
`MemorySignerKey.mac` accepts `record|manifest|anchor`, but the service rejects any caller-supplied
purpose outside `record|manifest` before it reaches the key, so `anchor` is not a signing oracle.

**Read path.** Every loaded store that is under the signer authority ends in
`assertMemoryIntegrityCurrent` (`server/memory-integrity.ts:697`), which asks the signer for the head
and compares it with the manifest on disk. Exactly three outcomes are legitimate:

1. `seq == head.generation && digest == head.digest` → serve.
2. `seq == head.generation + 1` and `head.pending` matches `(seq, digest)` → a crash between the
   durable manifest and the commit; commit now (idempotent) and serve.
3. no head at all and `seq == 1` (a store being born) → establish the anchor at generation 1.

Everything else fails closed with `MemoryFreshnessError`: older than the anchor (rollback), the same
generation with different bytes (resealed history), ahead of the anchor with no prepared candidate,
or no anchor on a store that has history (deleted anchor, unauthorized boot). `MemoryFreshnessError`
is a distinct type from `MemoryIntegrityError` precisely so the derived views know the *bytes* were
fine and the *history* was not.

---

## 5. Crash-safe commit and recovery protocol

**Why the pair needed a protocol.** `records.json` and its manifest are two files; each write is
atomic, the pair is not. The order is fixed and is the whole design:

```
1. signer.prepareManifest(store, header)   → pending = (N, digest); returns the manifest MAC
2. writeFileAtomic(records.json, records)  → new bytes, old manifest still authoritative
3. writeMemoryIntegrityManifest(manifest)  → the manifest becomes authoritative
4. signer.commitManifest(store, N, digest) → the generation becomes official
5. respond to the caller
```

The caller is answered only after step 4 (`server/memory-store.ts:1469` calls
`completeMemoryIntegrityCommit` before returning the write result). Recovery on the next read:

| Interrupted after | State on disk | Anchor | Next read |
| --- | --- | --- | --- |
| prepare (1) | N−1 pair | N−1 with pending N | serves N−1; the next writer may replace the candidate ("keeps the last committed generation when only a prepare landed") |
| records (2) | new records, N−1 manifest | N−1 with pending N | the manifest no longer matches the records → integrity error, no silent blessing |
| manifest (3) | N pair | N−1 with pending N | completes the commit, then serves ("completes a commit that a crash left between the durable manifest and the anchor") |
| commit (4) | N pair | N | normal path |

An anchor that is *ahead* of the disk with no matching pending candidate is not repaired — it is
refused ("refuses a manifest ahead of the anchor with no prepared candidate"). Concurrent writers are
serialized by the store's existing per-store write queue; the signer itself synchronizes every ledger
mutation on one lock and refuses a second `commitManifest` for the same generation unless it matches
the prepared digest (`AnchorLedgerTest`: "commit refuses a digest that was not prepared").

Device-level crash injection (SIGKILL between steps) was **NOT RUN** — the unit tests mutate the fake
anchor into exactly those states instead, and `SignerAnchorStore.persist()` is the only writer.

---

## 6. Enrollment challenge and receiver audit

Unchanged in this phase, re-audited line by line because it is the same trust boundary.

| Property | Implementation | Evidence |
| --- | --- | --- |
| Randomness | `SecureRandom`, 32 bytes, hex | `SignerAuthorization.requestChallenge`; test "challenges are unpredictable and distinct" |
| Freshness | new challenge supersedes the previous one | same method |
| Lifetime | 120 s TTL, checked at enrollment | test "an expired challenge is refused" |
| Single use | `nonce = null` on success | test "the challenge is single use" |
| Delivery | **explicit** broadcast to `ComponentName(callerPkg, SignerEnrollmentReceiver)`; never returned by Binder | `MemorySignerService.deliverChallenge` |
| Receiver exposure | `android:exported="true"` + `android:permission="…permission.MEMORY_SIGNER"` (signature) | `android/app/src/main/AndroidManifest.xml:283`; test "the receiver is exported only behind the signer signature permission" |
| Not persisted / not returned | only `Log.i("issued an enrollment challenge …")`; the value never lands in a file, an argument or a log | source inspection |
| Identity | the pid comes from the Binder transaction, and its kernel start time is pinned; a recycled pid disarms | tests "a recycled pid cannot inherit the authority", "binding first confers nothing without the challenge" |
| Takeover | a live armed peer refuses to hand out a challenge | test "a competing process cannot take over a live enrollment" |
| Restart | client death / binding death disarms; the next caller gets a fresh challenge | test "an app restart re-enrolls and the old pid loses the authority"; device log below |

Device log for the restart path (the app's main process changed 28366 → 24559):

```
21:52:41.889 28450 I MemorySigner: enrolled pid 24559 (com.openmausbot.companion.preview) as the signing authority; key level=1; state=armed peer=24559 identity=starttime
```

What a same-UID process can do: bind, call `requestEnrollment`, and cause a challenge to be minted —
which is delivered to the app's *manifest* receiver, not to it (explicit intents are not delivered to
dynamically registered receivers), and the pid that presents it is the one that gets armed. A forged
broadcast to the receiver is inert: the receiver forwards the value, the signer compares it with the
one it minted. New test: `android/app/src/test/kotlin/…/SignerEnrollmentReceiverTest.kt`
("a broadcast with no challenge is ignored", "a forged challenge does not enroll this process",
"the receiver is exported only behind the signer signature permission").

Honest limit: code inside the app's main process is the enrolled client; the scheme distinguishes
*processes*, not code inside the trusted one, and such code already owns the store.

---

## 7. Legacy migration and first-anchor establishment

### 7.1 Three states, never conflated

| Situation | Behaviour |
| --- | --- |
| brand-new store, no records file | empty; first write anchors generation 1 (no flag needed) |
| store sealed before anchoring, v3 manifest verifies | fail closed **unless** this boot is authorized to baseline it |
| anchor missing/corrupt on a store with history | fail closed; only the explicit authorized migration can re-establish |

### 7.2 The authorized first anchor

`OMB_MEMORY_INTEGRITY_ANCHOR_BASELINE=1` is set by the harness on the first boot of this build only.
`anchorMemoryIntegrityStores` (`server/memory-store.ts:892`) then walks the whole roster **plus
`shared`** while that permission still exists — a store nobody reads this boot would otherwise be
permanently unanchorable, because the permission is deliberately one boot wide. It loads each store
through the verifying loader, and only then writes the install-wide marker
`memory-integrity/anchor/baseline.json`. The marker is app-writable on purpose: it can only re-arm
the *request*, and the signer still refuses a second baseline for a store it already anchors. A store
that refuses is named in the log and left fail-closed; only an operational failure keeps the marker
back so the next boot retries.

### 7.3 What the first anchor can and cannot say

The anchor created here is a statement about *the generation on disk at migration time*. Nothing on
the device can prove that generation was the newest one ever written, so **rollback that predates the
first anchor is not detectable** — only rollback after it is. This is stated in the report rather
than papered over, and the migration is exactly why the permission is one boot wide.

### 7.4 Compatibility matrix (all in `server/memory-integrity.test.ts`)

| # | Scenario | Test |
| --- | --- | --- |
| 1 | fresh empty install | "treats a brand-new empty install as empty, not as an adoption"; "anchors a genuinely fresh store at generation 1 without a baseline flag" |
| 2 | valid v3 manifest, no anchor yet | "fails closed on a signer-sealed store whose anchor is missing, until a boot is authorized to baseline it" |
| 3 | v3 manifest + records verify | describe H ("seals v3 manifests with the signer key…"), plus every §J test's first read |
| 4 | missing/corrupt manifest | "refuses a v3 manifest that names the app UID provider"; §I matrix |
| 5 | missing signer anchor | same as #2 |
| 6 | old v2 provider state | "re-seals a verified v2 store under the signer without rewriting records"; "gives a pre-anchor v2 store one automatic first anchor, then refuses a rolled-back v2 pair" |
| 7 | interrupted v2→v3 migration | "re-seals a v2 store left behind by an interrupted migration without touching records" |
| 8 | upgrade marker deleted | "refuses a manifest-less store that still has its upgrade ledger, whatever the marker says" |
| 9 | legacy ledger deleted | "restores a missing ledger from a verified manifest and never re-adopts on the next deletion" |
| 10 | marker + ledger deleted | "rejects the observed downgrade on the load and the save path alike" (load **and** save) |
| 11 | valid earlier pair | "rejects the N−1 pair after N was committed…"; "rejects N−2 after N" |
| 12 | paired rollback + upgrade metadata removed | same as #10; the records are still manifest-less, so no adoption |
| 13 | crash during anchor initialization | `SignerAnchorStore.persist()` (tmp+rename, MAC'd); "anchors every pre-existing store in the migration boot" |
| 14 | crash during advancement | §5 table; "completes a commit that a crash left…", "keeps the last committed generation when only a prepare landed" |
| 15 | repeated startup after a failed migration | marker-withheld retry path (`complete=false`); **indirectly** covered — no test starts the process twice |

---

## 8. Adversarial anti-rollback results (unit)

`describe("canonical memory integrity J. signer-owned rollback anchor")` — 14 tests, all passing:

| Attack | Verdict | Test |
| --- | --- | --- |
| N−1 after N | rejected | "rejects the N−1 pair after N was committed, though every MAC still verifies" |
| N−2 after N | rejected | "rejects N−2 after N, not only the immediately previous generation" |
| N−1 records + N manifest | rejected | "rejects N−1 records under N's manifest…" |
| N records + N−1 manifest | rejected | same test |
| valid pair, different directory | rejected (different store key) | "refuses a valid pair copied into a different directory under the same bot id" |
| anchor missing | fails closed | "fails closed on a signer-sealed store whose anchor is missing…" |
| same generation, different bytes | rejected | "refuses the same generation with different bytes" |
| manifest ahead, nothing prepared | rejected | "refuses a manifest ahead of the anchor with no prepared candidate" |
| commit crash (manifest durable, anchor not) | completed, not blessed | "completes a commit that a crash left between the durable manifest and the anchor" |
| prepare crash | previous generation kept | "keeps the last committed generation when only a prepare landed" |
| stale snapshot reaching context | thrown before context | "keeps a rolled-back store out of every context path" (store read, retrieval, partitioned query, `assembleMemoryForContext`) |

Signer-side ledger (`android/signer/src/test/…/AnchorLedgerTest.kt`, 11 tests): generation must be
exactly next, a digest that was not prepared cannot be committed, a commit without a candidate is
refused, repeated commit is idempotent, re-prepare replaces the candidate, baseline cannot overwrite,
invalid generations/digests are refused before any mutation, stores advance independently, snapshot
round-trips through the on-disk shape.

---

## 9. Memory-integrity and shared/private regression results

`npx vitest run server/memory-integrity.test.ts server/memory-store.test.ts
server/memory-partition.test.ts server/memory-reconciliation.test.ts server/memory-journal.test.ts
server/memory-routes.test.ts server/workspace.test.ts server/capabilities/context-pipeline.test.ts
server/permission-policy.test.ts` → **exit 0, 9 files, 361 tests passed**
(`.omb-scratch/p13-memory-suites.log`).

This covers shared vs private scoping, thread isolation, lifecycle (archive/delete), reconciliation,
stale-hash conflicts, journaling, redaction, the write queue, legacy adoption, and the whole v2→v3 and
anchor matrix — including shared-store writes and partitioned retrieval under the anchor authority.
Freshness is per store: the anchor refusal of one bot's store does not touch another bot's, and a
record-free fixture (this device's `shared` workspace holds only the markdown document, no records
store) has nothing to anchor.

---

## 10. Physical Galaxy A07 results

Performed on the isolated preview package; the official package was never installed over, cleared or
restored.

| Step | Result |
| --- | --- |
| 1. signer + enrollment working before the change | PASS (enrolled pid 28366, `state=armed … identity=starttime`) |
| 2. legitimate shared-memory update | **NOT RUN on this fixture** — its `shared` workspace has no records store (only the markdown document), so there was nothing to write; covered at unit level (`memory-partition.test.ts`, §9) |
| 3. legitimate bot-private update | PASS (200-record fixture advanced 200 → 205; "prepared generation 201…205", each followed by "committed generation …") |
| 4. both bots receive correct context | PASS at unit level; on device the partitioned query was exercised for one bot against its own valid store. A two-bot context window was **NOT RUN** on this build |
| 5–6. capture N and N−1 in a disposable fixture | PASS (`AnchorFixture`: N−1 = 6, N = 7) |
| 7. restore N−1 without touching the anchor | PASS (files replaced via `run-as`; anchor untouched) |
| 8. old state rejected | PASS — HTTP 500 `… generation 6 but generation 7 was committed: this store was rolled back` |
| 9. stale content absent from context | PASS for every records-backed route (store, partitioned, write); see the `MEMORY.md` residual in §3.3 |
| 10. restart the embedded host and repeat | **BLOCKED** — see below |
| 11. restart the app and repeat | **BLOCKED** (same cause); the anchor itself survived the restart (§10.1) |
| 12. anchor persists in signer storage | PASS — `-rw------- u0_a280 504 2026-10-23 21:51`, three stores, generations 205 / 2 / 7 |
| 13. authorized writes still work | PASS (205 generations committed; §11) |
| 14. stale-hash behaviour unchanged | PASS (unit + the same 409 path; no code touched) |
| 15. missing/corrupt anchor fails closed | PASS at unit level; device-level corruption used a disposable fixture earlier (`.omb-scratch/phase13/anchor-corrupt.json`, `anchor-before-corruption.json`), not the only copy |
| 16. logcat clean | PASS — no `FATAL`/`ANR` for either package; the only errors are the deliberate `EADDRINUSE` described below |
| 17. genuine evidence for the final build | PASS — bundle hashes in §13 |

### 10.1 Why steps 10–11 are blocked (and what it revealed)

After `am force-stop com.openmausbot.companion.preview` + relaunch, the preview's host could not bind
the shared loopback port, because the **official** app's host had taken it:

```
21:52:47.970 24559 E HarnessHost: host-output| Error: listen EADDRINUSE: address already in use 127.0.0.1:18799
21:52:48.129 15988 I HarnessHost: health: OK (attempt 11, after 5s) — server is serving 127.0.0.1:18799
21:52:50.332 24559 I HarnessHost: adopting healthy host already serving 127.0.0.1:18799
```

Two consequences, both reported rather than worked around:

1. **Port 18799 is not a build identity.** The exact hazard the brief warned about materialized: after
   the restart the port answered with UID 10039's data (`/api/bots` listed the official app's
   `Researcher` bot). Every measurement in §11 was taken *before* that restart, when the responder was
   verified to be preview UID 10286 (fixture bots, preview paths, signer log `pid 28366`).
2. **The pre-spawn "adopt a healthy host" probe does not verify the responder's package.** The preview
   adopted the official app's host. This is pre-existing harness behaviour (not introduced by this
   phase), it does not weaken the anchor, and it is why the post-restart HTTP repeat could not be run
   without disturbing the user's live app. Fixing it is out of scope here and is recorded in §15.

The anchor's survival across the restart is nevertheless evidenced directly in signer storage and by
the re-enrollment log line in §6; the HTTP rejection is deterministic given those two facts and is
additionally pinned by the unit tests.

---

## 11. Performance measurements

Conditions: SM-A075F, Android 16, preview build §13, all requests over `adb forward tcp:28799
tcp:18799` (so each number includes an adb-forwarded loopback HTTP round trip), `curl -w
%{time_total}`, store on the device's internal storage, signer in a separate UID with a
software-backed Keystore key (`level=1`). Raw: `.omb-scratch/p13-perf.log`.

| Case | n | median | p90 | max |
| --- | --- | --- | --- | --- |
| `GET /memory/records`, 0-record store | 10 | 8 ms | 10 ms | 11 ms |
| `GET /memory/records`, 200-record store | 10 | 1311 ms | 3244 ms | 3735 ms |
| `GET /memory/file?path=MEMORY.md` (no integrity work) | 10 | 17 ms | 19 ms | 19 ms |
| `POST /memory/records` (one record, 200-record store) | 5 | 5835 ms | 6084 ms | 6095 ms |
| `POST /memory/partitioned/query`, 200-record store | 10 | 2684 ms | 4689 ms | 4724 ms |
| app restart → HTTP ready | 1 | 9771 ms | — | — |

Reading these honestly:

* **The anchor is not the cost.** It adds exactly one Binder transaction per load (`head`) and two per
  mutation (`prepare`, `commit`). The 0-record store answers in 8 ms — *below* the 17 ms it takes to
  serve `MEMORY.md`, i.e. the anchor round trip is under the noise floor of the HTTP path.
* The 200-record numbers are dominated by the pre-existing per-record MACs: every load re-verifies 200
  record MACs through the signer (~1.3 s), and every write re-seals all 200 (~5.8 s). That cost
  existed before this phase and was not increased.
* **No caching was added**, so there is nothing that could stay trusted after an external mutation, a
  signer restart or an integrity failure. Every load asks the signer.
* Host restart and recovery cost are inside the 9.8 s cold start, which includes Android process
  start, host spawn, the v2→v3 and anchor roster passes, and route registration. No target was
  invented for this; the measurement stands on its own.

---

## 12. Typecheck, lint, builds, tests

All commands run on the final source state; the Android host bundle is newer than every source file
it embeds (`server/memory-store.ts` 11:39, `server/index.ts` 11:36, bundle 11:40).

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` (`tsc -b && tsc -p tsconfig.server.json`) | **exit 0** |
| Lint | `pnpm lint` (`oxlint --deny-warnings .`) | **exit 0**, 0 warnings / 0 errors, 1582 files |
| Memory + integrity + capability suites | `npx vitest run` (9 files, §9) | **exit 0**, 361 tests |
| Memory-integrity anchor section | included above | 14 anchor tests (§J) + the §H/§I v3 and legacy matrices |
| API + e2e | `npx vitest run server/index.test.ts server/memory-room-prompt.e2e.test.ts server/thread-aware-bots.e2e.test.ts` | **exit 0**, 3 files, 241 tests (561.9 s) |
| Capability + downgrade API | `npx vitest run server/capabilities/capability-registry.test.ts server/memory-downgrade-api.test.ts` | **exit 0**, 12 tests |
| Production server build | `pnpm build:server` | **exit 0** (`.omb-scratch/build-server.log`) |
| Android host bundle | `node scripts/prepare-android-host.mjs` | **exit 0** |
| `:core:test` | `./gradlew :core:test` | **608 tests, 0 failures** |
| `:app:testDebugUnitTest` | `./gradlew :app:testDebugUnitTest` | **1160 tests, 0 failures** (includes the 3 new receiver tests) |
| signer package tests | `./gradlew :signer:testDebugUnitTest` | **23 tests, 0 failures** |
| Preview APK | `./gradlew :app:assemblePreview` | **exit 0**, 4 APKs |

**NOT RUN:** the complete repository suite (`885` detected test files). It was not run in Phase 12
either, and is not claimed here. Also not run: on-device crash injection (§5), on-device
anchor-corruption against this exact build (§10 step 15, unit-level only), and any UI-level flow for
the anchor.

---

## 13. Final signer, APK and runtime bundle identity

| Artifact | Identity |
| --- | --- |
| HEAD | `b945d72756199f004624a980127fdec5c56be6ce` (unchanged) |
| `server.zip` (source of truth) | sha256 `148f7714c2d8d34922c589e6…`, 10 981 025 bytes, built 11:40:57 |
| APK asset `assets/host/server.zip` | sha256 `148f7714c2d8d34922c589e6…` (identical) |
| Installed `files/host-server/index-android.js` | sha256 `bccf7f7676dc2d40b413551c7da6349e…` = the same entry inside `server.zip` |
| Preview APK (arm64) | sha256 `039c992e8d765a85a475c68295936a8cc127…`, 85 227 992 bytes |
| Signer APK | sha256 `716a33c478f2f2c896fc23d6d8622e75758b…`, 920 894 bytes, built 11:12:04, installed 11:12:23 |
| Preview package | `com.openmausbot.companion.preview`, UID 10286, versionName `1.1.1-threads-preview` |
| Signer package | `com.openmausbot.companion.signer`, UID 10280, versionName `1.0.0` |
| Official package | `com.openmausbot.companion`, UID 10039 — untouched |
| Keystore capability | `key level=1` (software-backed), `identity=starttime` |

The installed bundle carries the anchor code: the same `server.zip` entry contains
"no rollback anchor is recorded for this store and this boot is not authorized to establish one".

---

## 14. Files changed and Git state

No commit, no push, no stage, no reset/clean/checkout. `git diff --cached` is empty. Tracked diff:
51 files, +8446 / −153 (this includes the pre-existing Phase 1–12 work in the same working tree).

**New in this phase**

* `android/signer/src/main/kotlin/…/AnchorLedger.kt` — the generation/digest ledger and its invariants
* `android/signer/src/main/kotlin/…/SignerAnchorStore.kt` — durable, MAC'd, 0600, tmp+rename
* `android/signer/src/test/kotlin/…/AnchorLedgerTest.kt` — 11 tests
* `android/app/src/main/aidl/com/openmausbot/companion/signer/IMemorySigner.aidl` — anchor surface
* `android/app/src/test/kotlin/…/SignerEnrollmentReceiverTest.kt` — 3 tests
* `docs/verification/phase13-signer-anchor-antirollback-report.md` — this file

**Edited in this phase**

* `android/signer/.../MemorySignerService.kt` — four anchor transactions, all enrolled-caller only
* `android/signer/.../IMemorySigner.aidl`, `.../MemorySignerKey.kt` — the `anchor` purpose, internal only
* `android/app/.../host/MemorySignerClient.kt` — anchor client calls
* `android/app/.../host/HarnessHost.kt` — `head|prepare|commit|baseline` frames on the authenticated socket
* `server/memory-integrity.ts` — `signerAnchorHead`, `assertMemoryIntegrityCurrent`,
  `completeMemoryIntegrityCommit`, `sealManifestMac`, baseline policy
* `server/memory-store.ts` — the load-path assert, the write-path commit, `anchorMemoryIntegrityStores`
* `server/index.ts` — the startup roster walk after the v2→v3 migration
* `server/memory-integrity.test.ts` — section J (14 tests) and the baseline/migration cases
* `android/app/src/main/assets/host/server.zip` — rebuilt bundle

**Generated, not committed:** `android/app/build/outputs/apk/preview/*.apk`,
`android/signer/build/outputs/apk/debug/signer-debug.apk`, `.omb-scratch/` (evidence, ignored).

**Pre-existing dirty files** (Phase 1–12, unchanged by this phase): the remaining entries in
`git status --short`, including `server/turn-context.ts`, `server/permission-policy.ts`,
`shared/*`, the JNI libraries and the earlier reports/screenshots.

No key material, nonce, or production user data appears in any artifact: the anchor report lines in
this document are generation numbers and 12-hex-digit digest prefixes.

---

## 15. Remaining risks and blocked verification

1. **Pre-anchor history is not protected.** The first anchor is a statement about the migration
   moment. Rollback to a state older than that moment cannot be detected. *Future* rollback is.
2. **The signer's storage can itself be rolled back** by anyone who can do a full-device restore or
   restore the signer package's data. `allowBackup="false"` and `hasFragileUserData="false"` keep
   ordinary backup mechanisms out, but that is not a monotonic hardware authority. Against that
   attacker this design is **NOT ACCEPTED**, and the brief's own rule applies.
3. **Software-backed Keystore** (`level=1`): the key is protected by the UID boundary and the
   Keystore's file encryption, not by a TEE. Root or a compromised runtime is out of scope.
4. **Same-process compromise** is out of scope: code inside the app's main process is the enrolled
   client by definition.
5. **`MEMORY.md` is not anchored** (§3.3). It is the person's document, deliberately writable; a
   records-only rollback leaves it newer, and a rollback that also replaces it is indistinguishable
   from a hand edit.
6. **Port 18799 does not identify a build.** Observed: after the preview restarted, the official app's
   host owned the port and the preview adopted it (`adopting healthy host already serving
   127.0.0.1:18799`). The pre-spawn probe checks health, not package identity. Not introduced here,
   not fixed here.
7. **Blocked:** on-device restart repetition of the rollback test (§10 steps 10–11), on-device crash
   injection, on-device corrupt-anchor test against this exact build, any UI-level anchor flow.
8. **NOT RUN:** the complete repository suite; scenario 15 in §7.4 has no direct test (repeated
   startup after a failed migration is covered by the marker-retry logic, not by a test that starts
   the process twice).
