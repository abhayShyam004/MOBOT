# Android key isolation and trusted signing — acceptance report

Continuation of the canonical-memory integrity hardening. The previous pass
authenticated records with an HMAC key stored as a `0600` file under the app's
data directory; that report demonstrated that any process with the app's uid
(including `adb run-as` and a bot's terminal tool) could read it. This pass moves
the key behind the Android Keystore and delivers its plaintext to the host
through the spawn pipe only.

Measured on the final tree (`HEAD b945d727`, dirty, no commits) and the final
preview APK installed on `R8YY90VT4EM`.

---

## 1. Acceptance status

**ACCEPTED** for the claim that a filesystem-only attacker — the previously
demonstrated `run-as` copy, a bot file tool, a backup/sync copy, another app
instance, an editor — can no longer obtain the HMAC key or mint valid records.

The key exists on disk only as an AES-256-GCM blob wrapped by an Android Keystore
key. The plaintext reaches the host **only** through the child's stdin pipe at
spawn, is read once, and no longer exists as a file. Running the packaged bundle
yourself, without that pipe, makes every memory read and write fail closed with
`ERR_MEMORY_INTEGRITY`.

**Not claimed:** a process that can read the host's memory, replace the host
bundle, or execute Android-runtime code inside the app sandbox and call the
Keystore directly. See §16. This device reports the wrapping key at security
level 1 (software-backed Keystore), not TEE/StrongBox; that is reported as
measured, not as a hardware guarantee.

| Criterion (§13 of the brief) | Result |
|---|---|
| 1. No key material in ordinary filesystem storage | **PASS** — plaintext `key` deleted; only a 61-byte ciphertext blob remains |
| 2. The provider is the one the running server uses | **PASS** — host logs the stdin delivery; keyless host fails closed |
| 3. Agent tools cannot retrieve the secret | **PASS** for filesystem/tool access; residual in §16 |
| 4. No unrestricted signing of arbitrary bytes | **PASS** — no signing route, tool, or service exists |
| 5. Authentication follows the canonical mutation path | **PASS** — unchanged writer, MAC after validation |
| 6. Previous tampering attacks still blocked | **PASS** — 13/13 device, 317 unit/integration |
| 7. Migration preserves memory, idempotent | **PASS** — same key re-wrapped, manifests still verify |
| 8. Shared/specialized behaviour correct | **PASS** — 7/7 device checks |
| 9. Phase 4–6 invariants intact | **PASS** — 317 + 54 + 18 + 10 tests |
| 10. Automated and Android tests pass | **PASS** |
| 11. Final package matches tested source | **PASS** — hash chain in §13 |
| 12. Limits stated | **PASS** — §16 |

---

## 2. Threat model and security claims

**Attacker A (was in scope, now defeated):** a process that can read and copy any
file under `files/` — `adb run-as`, a bot file tool, a sync/backup agent, a
copied data directory. Before this pass it read `memory-integrity/key` and could
forge MACs. Now it sees only ciphertext; the Keystore key never leaves the
Keystore, and the plaintext is not in any file, argv, environment variable, log
line, journal, or API response.

**Attacker B (unchanged):** a process that edits memory files without the key.
Integrity verification refuses before context, exactly as in the previous pass.

**Attacker C (documented, not defeated):** code that runs inside the app's
sandbox with enough runtime to call `AndroidKeyStore`, or that can read host
memory / replace the host bundle. §16.

**Claim:** record authenticity now requires the cooperation of the app's Keystore
and the harness's spawn path, not merely filesystem access.

**Non-claims:** this is not a general signing service. Nothing in the system will
MAC bytes supplied by a caller; the only MAC call sites are the canonical writer
after authorization, redaction and lifecycle validation.

---

## 3. Existing key and signer architecture (before this pass)

- `server/memory-integrity.ts` generated 32 random bytes into
  `<DATA_DIR>/memory-integrity/key` (`0600` in `0700`), read them with
  `readFileSync`, and used them for `recordMac` / `manifestMac` (HMAC-SHA256,
  purposes `omb-memory-record-v1` / `omb-memory-manifest-v1`).
- The key path was outside every workspace but inside `files/host/data`, i.e.
  same-uid readable. Demonstrated on device in the previous report:
  `run-as com.openmausbot.companion.preview cat …/key` → 45 bytes.
- There was no signer service or endpoint; signing was in-process. The weakness
  was purely key custody, not an exposed oracle.
- Android spawn: `HarnessHost.spawn` builds a minimal environment, starts
  `libnode_host.so index-android.js`, and streams output. Child stdin was unused.

---

## 4. Key-isolation mechanism selected

`android/app/src/main/kotlin/com/openmausbot/companion/host/MemoryIntegrityKeyStore.kt`:

- An AES-256-GCM wrapping key in `AndroidKeyStore` (alias
  `omb_memory_integrity_wrap_v1`), generated with
  `setRandomizedEncryptionRequired(true)`, no user-auth gate (memory must load on
  background restarts), `PURPOSE_ENCRYPT|DECRYPT`.
- The HMAC key is stored as `data/memory-integrity/key.keystore`:
  `[version=1][12-byte IV][32-byte ciphertext][16-byte tag]` = **61 bytes**,
  written to a temp file, `0600`, then renamed.
- On spawn, `HarnessHost` unwraps the key in the app process, writes one base64
  line to the child's stdin, closes the stream, and zeroes its buffer. The child
  gets `OMB_MEMORY_INTEGRITY_KEY_STDIN=1` and **no key in the environment**.
- `server/memory-integrity.ts` reads that line synchronously at first use
  (`readMemoryIntegrityKeyFromStdin`), validates 32 bytes, and never touches the
  file path in this mode.
- The blob is never regenerated over an existing one. Unwrap failure (device
  restore, cleared Keystore) throws `MemoryIntegrityUnavailable`, the harness logs
  it and delivers **nothing**, and memory fails closed.

Device log (final build):

```
I MemoryIntegrity: key migrated to the Android Keystore blob; plaintext key removed
I HarnessHost: memory integrity: key delivered on stdin (Keystore-wrapped at rest; level=1)
```

`level=1` is `KeyInfo.getSecurityLevel()`: 1 = software, 2 = TEE, 3 = StrongBox.
This device/profile reports **software-backed**; no StrongBox claim is made.

### Why not non-exportable HMAC inside the Keystore

The store's `recordMac`/`manifestMac` are synchronous and called from
`loadMemoryRecords`, which every context path uses synchronously. A Keystore
HMAC with the key never entering Node would require either (a) making the entire
store async — a rewrite of the read path across the server, out of proportion to
this hardening — or (b) a loopback HMAC service that any same-uid process could
call, which is precisely the "unrestricted signer" the brief forbids. Wrapping
the key at rest and handing it over a private pipe removes the demonstrated
filesystem exposure without inventing an oracle. The remaining exposure (key in
host RAM) is stated in §16 and is the same class as any in-process secret.

---

## 5. Signing authority and authorization boundary

- No route, tool, MCP capability, IPC endpoint, or bridge signs arbitrary bytes.
  `installMemoryIntegrityKey` exists only for the stdin reader and tests, is not
  reachable from any request, and takes a 32-byte key, not a payload.
- Authorization, redaction, confidence/relevance gates, lifecycle and
  reconciliation are unchanged and still precede any MAC (`saveMemoryRecords` →
  `sealMemoryIntegrity`).
- **Device evidence that the key path is the authority:** starting the packaged
  bundle by hand on 18999 with `OMB_MEMORY_INTEGRITY_KEY_STDIN=1` and no pipe
  data produced:

  ```
  GET  /api/bots/<Coder>/memory/records
       → 500 {"error":"ERR_MEMORY_INTEGRITY: memory integrity key was not delivered on stdin; …"}
  POST /api/memory/shared/records
       → 500 {"error":"ERR_MEMORY_INTEGRITY: …","code":"integrity"}
  ```

  A process that can run the server but cannot obtain the harness's delivery
  cannot read or write authenticated memory. Falling back to a file key was
  explicitly rejected in code so this cannot silently downgrade.

---

## 6. Key migration and lifecycle

- **Existing install (device):** plaintext `key` present, no blob. First launch
  after upgrade read it, wrapped it, wrote `key.keystore` atomically, deleted the
  plaintext, then delivered the same bytes. Because the key is *unchanged*,
  every existing record MAC and manifest still verifies — no re-signing, no
  re-blessing, no data loss. Measured: migration + delivery took 19 ms
  (`16:16:13.725` → `.744`).
- **Crash windows:** blob written but plaintext not deleted → next boot uses the
  blob and deletes the leftover (logged as a warning if deletion fails). Crash
  before the blob is durable → plaintext remains, i.e. the old behaviour, never a
  store whose key is unrecoverable. Rename-based install means the blob is never
  half-written.
- **Fresh install:** the key is generated by the app and wrapped before first
  use, so no plaintext file ever exists.
- **Restart:** each app start unwraps and re-delivers; the blob is not rewritten
  (timestamp unchanged across the 16:17 restart). Records verified after restart
  (device tamper harness, host pid 9883 → 10809).
- **Device restore / cleared Keystore:** unwrap fails, nothing is delivered,
  memory fails closed and logs. The blob is not replaced and records are not
  re-signed.
- **Rotation:** not implemented. The alias is versioned so a future scheme is
  additive; a rotation would be an explicit re-seal operation, not automatic.

---

## 7. Adversarial attack matrix and observed outcomes

### A. File extraction / key custody

| Probe | Result |
|---|---|
| `find files -name key -o -name '*.key'` in the preview sandbox | **PASS** — nothing found |
| `ls data/memory-integrity` | **PASS** — only `key.keystore` (61 B, `0600`) and `legacy/` |
| Blob bytes | **PASS** — `01 03 7a 42 …`; version+IV+ciphertext+tag, not a base64 key |
| Log lines | **PASS** — migration/delivery lines contain no key material |
| Restart does not regenerate | **PASS** — same blob, unchanged mtime, records verify |
| Key absent / malformed at delivery | **PASS** — unit tests `decodeDeliveredMemoryIntegrityKey`, `readMemoryIntegrityKeyFromStdin` refuse; child-process test exits non-zero |

### B. Signing authority

| Probe | Result |
|---|---|
| Hand-start packaged bundle (agent-equivalent), no pipe key | **PASS** — records GET/POST 500 `ERR_MEMORY_INTEGRITY` |
| Read key through file tools / device file surface | **PASS** — no key file; `isProtectedMemoryPath` also covers `key.keystore` |
| Any endpoint that MACs caller bytes | **none exists** (code search of routes/capabilities) |
| Replay a previously authorized payload | **not meaningful** — MACs are not tokens; each save re-verifies the whole store and re-seals a new manifest |
| Authenticate another bot's record | **PASS** — MAC binds `botId`/`id`; moving a record fails verification |
| Authenticate shared content without the gate | **PASS** — unchanged Phase 6 writer gate |

### C. Data-file tampering (unchanged matrix, re-run on the Keystore build)

`server/memory-integrity.test.ts` (44 tests) still covers: headline/detail/
confidence/owner/category/provenance/id/lifecycle/timestamp/access-count edits
with SHA recomputation, forged append, deletion, whole-file replacement,
reordering, duplicate ids, manifest edit/removal, symlink, truncation, MAC reuse,
retrieval-triggered re-save, archived records, journal forgery, crash between the
two writes, planted store after deletion, corrupt/foreign key.

### D. Context and partitions — device, 7/7 PASS

```
PASS  both bots see the approved shared preference
PASS  Bot A sees only its own specialized memory
PASS  Bot B sees only its own specialized memory
PASS  no cross-bot private text
PASS  raw shared Markdown append never reaches either bot's shared snippets
PASS  raw shared Markdown append never reaches the specialized partition
PASS  restored shared document still yields the approved preference
```

### E. Key and integrity failure — device

| Scenario | Observed |
|---|---|
| No key delivered | records GET/POST `500 ERR_MEMORY_INTEGRITY`; no shared snippets from the store |
| Tampered record + recomputed SHA | `500 ERR_MEMORY_INTEGRITY`, forged text absent from both bots |
| Restart with tampered bytes | still refused (new host pid) |
| Restore original bytes | readable again, integrity audit retained |

---

## 8. Record authenticity and context-injection results

The record format, manifest semantics and verification point are unchanged:
`canonicalIntegrityRecord` covers every authorization- and behaviour-relevant
field, the manifest covers count/order/digest/per-record MAC, and verification
runs in `loadMemoryRecords` before lifecycle filtering. Because the *key* is the
same before and after migration, this pass changed custody only — the 317
memory/integrity/round tests that assert MAC behaviour pass unchanged.

Device, final bundle: a record edited on disk (headline + detail, SHA recomputed)
never appeared in `sharedSnippets`, `specializedSnippets`, or assembled context;
the records API answered 500; the neighbouring bot was unaffected; after a real
app restart (which re-unwrapped the Keystore key) the forged bytes were still
refused; 56 `integrity_failure` audit rows existed and contained no forged text;
restoring the original bytes restored reads.

---

## 9. Phase 4–6 compatibility

| Suite | Tests | Result |
|---|---|---|
| memory-integrity, memory-store, partition, journal, reconciliation, routes, round4, round7 | 317 | **PASS** |
| context-pipeline, permission-policy, capability-registry | 54 | **PASS** |
| `server/index.test.ts -t "bot memory API"` | 18 (213 skipped) | **PASS** |
| memory-room-prompt + thread-aware-bots e2e | 10 | **PASS** |

Phase 4 (atomic 0600 writes, redaction before hashing, stale-hash 409, 3-way
merge, compaction), Phase 5 (scope-aware reconciliation, archived beliefs stay
retired) and Phase 6 (shared Markdown is not a trust source, shared write gate,
partition isolation) are untouched by this change and re-verified.

---

## 10. Physical Galaxy A07 results

Device `R8YY90VT4EM`, preview package `com.openmausbot.companion.preview`
(`1.1.1-threads-preview`, versionCode 10101). The official package
`com.openmausbot.companion` was temporarily stopped so the preview could bind the
only loopback port its harness supports (`18799`); its data was not read,
written, cleared, or reinstalled, and it was relaunched afterwards and is serving
its own host again. This also removed the previous pass's ambiguity where the
preview silently adopted the official host.

| # | Check | Result |
|---|---|---|
| 1 | Fresh preview APK installed, main package untouched | **PASS** |
| 2 | Version/signature: `1.1.1-threads-preview` / 10101; installed `files/host-server/index-android.js` hash matches the build | **PASS** |
| 3 | Key provider and level | **PASS** — `key.keystore`, `level=1` (software-backed, reported verbatim) |
| 4 | Key survives host + app restart | **PASS** — 16:16 migration, 16:17 restart re-delivered the same blob |
| 5 | No raw key file after migration | **PASS** — `find` returns nothing; only the 61-byte blob |
| 6 | Authorized shared write through the app path | **PASS** — `PUT /api/memory/shared` 200 |
| 7 | Both bots retrieve the approved shared record | **PASS** |
| 8 | Private-memory isolation | **PASS** — each bot sees only its own specialized snippet |
| 9 | Direct record modification | **PASS** — 500 `ERR_MEMORY_INTEGRITY` |
| 10 | Unauthorized signing refused | **PASS** — hand-started bundle cannot read or write records |
| 11 | Modified records never reach context | **PASS** — 13/13 tamper checks |
| 12 | Normal authorized save | **PASS** — 200 |
| 13 | Stale-hash conflict | **PASS** — 409 |
| 14 | Relaunch + integrity verification | **PASS** — host pid 9883 → 10809, records still verify |
| 15 | Logcat | **PASS** — no fatal exception/ANR for either package during this pass |
| 16 | UI screenshots | **N/A** — the UI renders Markdown documents, not canonical records; key isolation is not a UI scenario. Previous phase's screenshots remain in `docs/verification/`. |

Model-backed phone conversation: **NOT RUN** (not part of this change; previous
pass recorded it as BLOCKED for port reasons).

---

## 11. Performance

The key path adds exactly one startup read; per-operation crypto is unchanged
(same HMAC calls, same key bytes). Measured anyway:

Device (Samsung A07, final build, logcat timestamps):

| Event | Time |
|---|---|
| First boot with migration (extraction + wrap + delete + delivery) | start `16:16:09.814` → migrated `16:16:13.725` → delivered `.744`: **19 ms** for wrap+write+deliver after provisioning |
| Warm app restart, blob already present | start `16:17:06.626` → delivered `16:17:07.387`: **761 ms** total (provisioning, unwrap, spawn) |
| Key missing | memory operations fail in-band: **~0 ms**, no retry, no fallback |

Desktop (Node 22, Linux x86_64, temp data dir), same benchmark as the previous
pass, run against the final code:

| Store | 100 verified loads | per load | update save (verify + seal + 2 atomic writes) |
|---|---|---|---|
| 0 records | 19.71 ms | 0.20 ms | — |
| 10 records | 81.83 ms | 0.82 ms | 1.77 ms |
| 50 records | 238.45 ms | 2.38 ms | 4.27 ms |
| 200 records | 762.64 ms | 7.63 ms | 14.23 ms |

These are faster than the previous pass's run (same host, different load); the
relevant point is that key isolation adds no per-record cost. No verification
cache was introduced, so an external edit or restart is always re-verified.

---

## 12. Typecheck, lint, builds and tests

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** (exit 0) |
| Lint | `npm run lint` | **PASS** — 0 warnings, 0 errors, 1581 files |
| Server build | `npm run build:server` | **PASS** |
| Host bundle | `node scripts/prepare-android-host.mjs` | **PASS** |
| Android unit tests | `cd android && ./gradlew :core:test :app:testDebugUnitTest` | **PASS** |
| Preview APK | `cd android && ./gradlew :app:assemblePreview` | **PASS** |

Kotlin compilation of `MemoryIntegrityKeyStore.kt` and the `HarnessHost` changes
is covered by both Gradle tasks above (the first compile attempt failed on
`KeyInfo.SECURITY_LEVEL_*` constants; the code now reports the numeric level and
compiles cleanly).

---

## 13. Bundle identity and installed preview

| Artifact | SHA-256 |
|---|---|
| `dist-server/index-android.js` | `d970fd250e8c89001d4dbf76bd053abf300476cc51690d02b9dc7b2c2d5c09e5` |
| `android/app/src/main/assets/host/server.zip` | `c9e266f07c9dd57e56f689355b208962a5db487afb92e357b0070d8f61613172` |
| APK's `assets/host/server.zip` | `c9e266f0…` (matches the asset) |
| Installed `files/host-server/index-android.js` | `d970fd25…` (matches the build) |
| `app-arm64-v8a-preview.apk` | `1186bbfd78d3c1f0ec3b464696ed852a625250afe1b445c85a0ccf2d02bdb1d9` |

Installed package: `com.openmausbot.companion.preview`, `1.1.1-threads-preview`
(10101).

---

## 14. Files changed

**New**

- `android/app/src/main/kotlin/com/openmausbot/companion/host/MemoryIntegrityKeyStore.kt`
  — Keystore wrapping, migration, versioned blob, security-level diagnostic.
- `server/memory-integrity.test.ts` additions (section F, 5 tests) — pending
  review: the file itself predates this pass; this pass added the key-isolation
  cases and the child-process pipe tests.
- `docs/verification/keystore-key-isolation-report.md` (this report).

**Modified**

- `android/app/src/main/kotlin/com/openmausbot/companion/host/HarnessHost.kt` —
  unwrap at spawn, deliver on stdin, zeroize, set `OMB_MEMORY_INTEGRITY_KEY_STDIN`,
  log provider/level or the fail-closed path.
- `server/memory-integrity.ts` — `MEMORY_INTEGRITY_STDIN_ENV`,
  `memoryIntegrityKeyProvider`, `decodeDeliveredMemoryIntegrityKey`,
  `readMemoryIntegrityKeyFromStdin`, `installMemoryIntegrityKey`, provider-aware
  `memoryIntegrityKey()`, `key.keystore` added to `isProtectedMemoryPath`.
- `android/app/src/main/assets/host/server.zip` — rebuilt.
- Generated: `android/app/build/outputs/apk/preview/*.apk` (not tracked).

Pre-existing uncommitted Phase 1–6 work remains as it was; nothing outside this
list was touched by this pass.

---

## 15. Git state

- `HEAD` = `b945d72756199f004624a980127fdec5c56be6ce` — unchanged.
- No commit, push, stage, reset, clean, checkout, or stash.
- Preview package upgraded only; official package data untouched and its app
  relaunched and serving again.
- Verification artifacts (harnesses, logs, benchmark) live in gitignored
  `.omb-scratch/`; no secrets were written to logs or tracked files.
- The preview fixture's key was migrated in place; its records are intact and
  verify under the wrapped key.

---

## 16. Residual risks and blocked verification

1. **Plaintext key is in the host process's memory** while it runs, because the
   store's HMAC calls are synchronous. A process that can read that memory
   (ptrace is restricted to descendants on Android, so an agent's child cannot
   trace its host parent) or replace the host bundle is outside this boundary.
2. **Keystore is software-backed on this device** (`level=1`). Key material is
   not accessible through the filesystem, but it is not protected by a TEE on
   this hardware/profile. No StrongBox claim is made.
3. **Same-sandbox Android-runtime code** that can call `AndroidKeyStore` for this
   uid could ask the Keystore to unwrap the blob. That requires executing inside
   the app sandbox with Android APIs — a higher bar than the file read this pass
   closes — and is not claimed as defended.
4. **Device restore loses the Keystore key** (by design: it is not backed up).
   The wrapped blob will not unwrap on another device, so memory fails closed
   with a diagnostic and requires the explicit recovery path. No automatic
   re-keying, because that would authenticate nothing the old key signed.
5. **Paired rollback of records + manifest remains undetectable** (unchanged from
   the previous pass; no out-of-workspace monotonic anchor exists).
6. **Not run:** the full 885-file vitest suite; the targeted suites above are the
   ones this change can affect.
7. **Blocked / not applicable:** provider-backed phone conversation and UI
   click-through for this change (the UI shows documents, not records).

No roadmap Phase 7 (autonomous loop) work was started.
