# Phase 12 — Signer authorization hardening and legacy-downgrade closure

Device: Samsung SM-A075F (`R8YY90VT4EM`), Android 16 (`api=36`), build `1.1.1-threads-preview`.
HEAD at start and end: `b945d72756199f004624a980127fdec5c56be6ce` (nothing committed, nothing staged,
no `git reset`/`clean`/`checkout`, official package never installed over or uninstalled).

---

## 1. Acceptance status

| Gate | Subject | Status |
| --- | --- | --- |
| A | Signer caller authentication (first-caller pinning removed) | **PASS** |
| B | Direct access to the signing authority | **PASS** |
| C | Legacy-adoption and rollback safety | **PASS** |

The three gates are independent and each is evidenced below by a test that fails on the previous
implementation. Two things are **not** claimed: protection against code already running inside the
app's main process, and rollback detection of a *consistent* older (records + manifest) pair. Both
are residual, listed in §13.

The change that closes Gate A is not a stronger check on a caller-supplied value. It removes the
notion of "first caller" entirely: the signer mints a single-use random challenge and hands it to
one explicit component in the caller's own package, and only the process that presents that value
over Binder is authorized. Arriving first no longer confers anything.

---

## 2. Threat model and actual process identities

Measured on the device during this phase:

| Component | UID | PID (example) | Notes |
| --- | --- | --- | --- |
| `com.openmausbot.companion` (official) | 10039 | — | installed, not touched |
| `com.openmausbot.companion.preview` (main process) | 10286 | 17106 | enrolled client, spawns the host |
| Node host `libnode_host.so` | 10286 | 17164 | child of the harness, `SO_PEERCRED`-authenticated on the integrity socket |
| `com.openmausbot.companion.signer` | 10280 | 17128 | owns the Keystore key |
| agent PTY / bot shell | 10286 | — | same UID as the harness; this is the adversary |

`/proc` is mounted `hidepid=invisible, gid=3009(readproc)`. The shell holds `readproc`, application
UIDs do not. Two consequences were measured, not assumed:

* A directory listing of another app's `/proc/<pid>` is denied (`ls /proc/<pid>` → `DENIED`).
* `/proc/<pid>/stat` is still readable **by the signer** (it reported `identity=starttime`), which is
  what makes pid-recycling detection real rather than aspirational (§4).

The threat model is unchanged from Phase 11: an untrusted agent shell, running under the main app's
UID, that can execute native code, write the canonical store, and speak Binder if it wants to. Root,
a compromised TEE/StrongBox, and a modified system image remain out of scope.

---

## 3. First-caller race: reproduction and resolution

### 3.1 What the previous implementation did

`MemorySignerService.authorize()` pinned `Binder.getCallingPid()` of the first authorized
transaction and served only that pid. The argument for it was lifecycle ordering — the app binds
before it spawns the host, and every shell is a descendant of the host.

### 3.2 The adversary that ordering cannot answer

`android/app/src/preview/kotlin/com/openmausbot/companion/host/SignerRaceProbeService.kt`
(preview-flavor only, absent from the shipped APK) runs in `android:process=":race"`: **same UID
10286, different pid, same signature permission** — exactly a process that outlived a harness. It is
started before the app's main process exists:

```
adb shell am force-stop com.openmausbot.companion.preview
adb shell am force-stop com.openmausbot.companion.signer
adb shell am start-foreground-service \
  -n com.openmausbot.companion.preview/com.openmausbot.companion.host.SignerRaceProbeService
```

Against the **old** code this process is the first binder and therefore the authority. Against the
final build (measured 2026-10-23 10:28:46):

```
SignerRaceProbe: probe running as uid 10286 pid 17095 (main process is a different pid)
SignerRaceProbe: requestEnrollment -> true
SignerRaceProbe: enroll(guessed challenge) -> REFUSED SecurityException: the enrollment challenge does not match
SignerRaceProbe: mac(forged record) -> REFUSED SecurityException: the signing authority is not enrolled
SignerRaceProbe: describe -> state=armed peer=<main pid>
SignerRaceProbe: RESULT probe pid=17095 uid=10286
MemorySigner: enrolled pid 17106 (com.openmausbot.companion.preview) as the signing authority; key level=1; state=armed peer=17106 identity=starttime
```

The probe ran first, asked for a challenge, and still lost: the challenge was delivered to the app's
receiver, the app's main process (17106) presented it, and the probe was refused both an enrollment
and a MAC. `describe` reports `peer=17106`, not the probe's pid.

### 3.3 The mechanism

`android/signer/src/main/kotlin/com/openmausbot/companion/signer/SignerAuthorization.kt` — a plain
Kotlin state machine, unit-tested on the JVM:

* `requestChallenge(callerPid)` mints 32 random bytes, supersedes any previous challenge, and
  returns it **to the service**, never to the caller. It returns `null` while the authority is held
  by a *live* peer, so a second process cannot obtain a challenge that would let it take over a
  running one.
* `enroll(protocol, nonce, callerPid)` requires the outstanding, unexpired, matching challenge and
  pins the **kernel** caller pid of that transaction. No caller-supplied pid is ever accepted; the
  AIDL has no parameter for one.
* `authorize(callerPid)` requires: armed, `callerPid == pinned`, the peer still alive
  (`/proc/<pid>/stat`, falling back to `kill(pid, 0)`), and — where readable — the same kernel start
  time, so a recycled pid is refused **and disarms** the authority.
* A dead peer disarms; the next caller gets a fresh challenge. That is the restart path, and it is
  why an app restart recovers without any process inheriting the old grant.

Delivery (`MemorySignerService.deliverChallenge`) is an **explicit-component** broadcast:
`ComponentName(callerPackage, "com.openmausbot.companion.host.SignerEnrollmentReceiver")`. Android
delivers an explicit component only to that manifest receiver — a dynamically registered receiver in
the same package (the one way a same-UID process could have listened) receives nothing — and the
receiver requires `com.openmausbot.companion.permission.MEMORY_SIGNER` of its *senders*, a signature
permission declared by the signer itself. The nonce is never written to disk, never returned by any
Binder call, and is burned on use.

One measured detail worth recording: declaring a permission does not grant it to the declaring app.
Without an explicit `<uses-permission>` the signer's own broadcast was skipped at enqueue with
`Permission Denial ... requires com.openmausbot.companion.permission.MEMORY_SIGNER` (seen in
`dumpsys activity broadcasts`). The manifest now requests it and says why.

Unit tests (`android/signer/src/test/kotlin/.../SignerAuthorizationTest.kt`, 12 tests, all passing):
`an unenrolled signer signs nothing`, `binding first confers nothing without the challenge`,
`the process that presents the challenge is the one that signs`, `a competing process cannot take
over a live enrollment`, `the challenge is single use`, `an expired challenge is refused`,
`an app restart re-enrolls and the old pid loses the authority`, `a recycled pid cannot inherit the
authority`, `a disarmed signer refuses until it is enrolled again`, `a protocol mismatch is refused
before any pinning`, `challenges are unpredictable and distinct`, `describe never carries the
challenge`.

---

## 4. Reverse-direction socket architecture: evaluated, not adopted

The candidate in the brief was for the signer to dial an approved host endpoint. It was evaluated
and rejected on a concrete property of Linux AF_UNIX: `SO_PEERCRED` records the credentials of the
process that called `connect(2)`, and that value is what *the connecting* side sees as well. A
signer that dials therefore learns nothing about the listener, and the socket name it would dial has
to reach it over the same unauthenticated channel it is trying to authenticate — which reduces the
problem to the pin it was meant to replace. Kernel peer credentials authenticate a peer only to the
party that *spawned or accepted* it, and the signer spawns nothing in the app.

The enrollment challenge is the reverse direction that does work: the **system server** routes it to
one component, and the process identity then arrives from the kernel on the transaction that carries
it. No socket, no shared secret, no bootstrap token in the agent's environment.

Existing kernel-verified channels are unchanged and were re-verified on the final build:

```
HarnessHost: security: integrity bridge accepted — peer pid 31389 authenticated by pid + SO_PEERCRED; /proc cannot reopen it
```

---

## 5. Direct Keystore access: what was actually tested

### 5.1 The `app_process` probe is still inconclusive — and is not counted

A Java probe (`android.os.Process.myUid()` + `KeyStore.getEntry("omb_memory_integrity_hmac_v3")`)
dexed with `d8` and run under `run-as com.openmausbot.companion.preview` **aborts inside ART**:

```
F DEBUG: Abort message: 'Check failed: system_class_loader != nullptr java.lang.ExceptionInInitializerError'
F DEBUG: art::CreateSystemClassLoader(art::Runtime*) ← art::Runtime::Start() ← JNI_CreateJavaVM
```

Class-loader initialization fails before any Keystore call. This is `BLOCKED` at the runtime, not a
denial: it says nothing about the key. It is recorded here so it is not mistaken for evidence.

### 5.2 A real Keystore session under the app UID

The preview probe is ordinary app code in a second process of the app's UID, so its Keystore
namespace is the same one an agent process sees. `keystoreCheck()` in
`SignerRaceProbeService.kt`, measured on the final build:

```
keystore: uid=10286 aliases=[_androidx_security_master_key_, omb_memory_integrity_hmac_v2]
keystore: getEntry(omb_memory_integrity_hmac_v3)=NULL
keystore: a lookalike alias in this UID produces 2d9f37dab59b53d1… — a different key
keystore: lookalike deleted; this UID still cannot open the signer's key
```

Three facts, all from a live Keystore session:

1. The UID's own namespaces are visible — including the **old v2 alias** the app created in earlier
   phases — so the listing is real, not an empty view.
2. The signer's `v3` alias is **absent**. Android scopes keys per UID; there is no "denied" to
   report because the key does not exist in this namespace.
3. An alias of the same *name* can be created in this UID and it is a **different key**. The name is
   not the secret; the UID is.

The lookalike is deleted immediately, so the probe is repeatable and leaves nothing behind.

---

## 6. Signer authorization and replay behavior

* Protocol is now **2** (`SignerAuthorization.PROTOCOL`); a mismatched protocol is refused before
  any pinning.
* `mac()` requires an enrolled caller, a strictly increasing request id per authority (replay
  refused), one of the two canonical purposes, 1..512 payloads, ≤64 KiB per payload and ≤1 MiB per
  batch, and a shape check for record/manifest JSON — the same check the harness applies, repeated
  because the signer holds the key.
* `describe()` reports `state=unarmed|armed|armed-stale peer=<pid> identity=starttime|liveness-only`
  plus the Keystore security level. It contains no secret; the challenge is never formatted into a
  log line or a reply (`describe never carries the challenge` test).
* Key creation is one-way: `MemorySignerKey.key()` creates the alias once and never regenerates.
  `unavailable` fails closed; the harness then refuses to start a v3-sealing host at all rather than
  falling back to the app UID's key (`fails closed on a v3 store when the signer is unavailable`).
* `HarnessHost.signerActive` is now `MemorySignerClient.ready(5_000)`, which is true **only after
  enrollment**. Being bound is not an authority; the log line says which of the two applied.

---

## 7. Legacy-adoption downgrade regression

### 7.1 The fix

`legacyUpgradeAuthorized()` (server/memory-integrity.ts) now honours an explicit denial:

```ts
if (flag === "1") return true;
if (flag === "0") return false;
return memoryIntegrityKeyProvider() === "file";   // desktop, unchanged
```

The harness already exports `OMB_MEMORY_INTEGRITY_ALLOW_LEGACY_UPGRADE` on every spawn — `1` only on
the one boot where the retired wrapped key decrypted, `0` otherwise. An explicit `0` now wins over
the desktop default, so a boot told it may not adopt an unsealed store cannot adopt one.

### 7.2 On the device, through the real HTTP API

Store: `…/workspaces/<bot>/memory`. Attack: delete `records.integrity.json`, delete the ledger in
`…/host/data/memory-integrity/legacy/`, drop one record.

```
GET  /api/bots/<bot>/memory/records   status=500
  {"error":"ERR_MEMORY_INTEGRITY: records.json has no integrity manifest and this boot is not authorized to adopt an unsealed store","code":"integrity"}
POST /api/bots/<bot>/memory/records   status=500  (same error — a save cannot bless it either)
```

Before the fix this was `200` with the reduced set. The ledger-only variant is also refused:

```
{"error":"ERR_MEMORY_INTEGRITY: records.json has no integrity manifest and this store was already upgraded"}
```

Restoring the original `records.json` + manifest returns the store to `200`/`count 2`, and a full
app restart still verifies (`200`, `count 2`) — the fix refuses to trust, it does not destroy.

### 7.3 Deterministic matrix

`server/memory-integrity.test.ts` → *I. legacy adoption matrix (signer authority)*, 6 new tests:
manifest-less-with-ledger refused; missing ledger restored from a verified manifest and a later
deletion refused; stale ledger + deleted manifest refused; empty new install is not an adoption;
the observed downgrade refused on **load and save** with no manifest minted; a v2 store left by an
interrupted migration re-seals to v3 with byte-identical records.

`server/memory-downgrade-api.test.ts` (2 tests, new) drives the same attack through a real fixture
server launched with `OMB_MEMORY_INTEGRITY_ALLOW_LEGACY_UPGRADE=0` and asserts `500`, not `200`, for
both the read and the write, and that a brand-new bot is still writable.

---

## 8. Memory-integrity and partition regression

Device, forged record with a **recomputed** SHA-256 (the plain hash check passes, so only authenticity
can catch it):

```
status=500 {"error":"ERR_MEMORY_INTEGRITY: record \"cbd421e7-…\" failed integrity verification","code":"integrity"}
```

Manifests on the device are `version 3, provider keystore-signer` and files are `0600`.

Suites (all `0` exit):

| Command | Result |
| --- | --- |
| `npx vitest run server/memory-integrity.test.ts server/memory-store.test.ts server/memory-partition.test.ts server/memory-routes.test.ts server/memory-reconciliation.test.ts server/memory-journal.test.ts server/memory-downgrade-api.test.ts` | 7 files, **273 passed** |
| `npx vitest run server/index.test.ts server/memory-room-prompt.e2e.test.ts server/thread-aware-bots.e2e.test.ts` | 3 files, **241 passed** |
| `npx vitest run server/capabilities/capability-registry.test.ts server/capabilities/context-pipeline.test.ts server/permission-policy.test.ts` | 3 files, **54 passed** |

Shared/private partitioning, thread isolation, lifecycle, archival, reconciliation and stale-hash
concurrency are covered by those suites and were not modified.

---

## 9. Physical Galaxy A07 verification

| Check | Result |
| --- | --- |
| Signer and preview have distinct UIDs | PASS — 10280 vs 10286 |
| Enrollment on a cold start | PASS — `issued an enrollment challenge … back to pid`, receiver logs it, `enrolled pid <main>` |
| First-caller race (separate process, same UID) | PASS — refused enrollment and MAC; `peer=<main pid>` |
| Keystore alias absent in the app UID | PASS — `getEntry(...)=NULL` |
| Same-named key in the app UID is a different key | PASS |
| Shell cannot start the signer | PASS (earlier phase, unchanged): `Requires permission …MEMORY_SIGNER` |
| Authorized write/read through the API | PASS — write `200`, read `200`, manifest v3 |
| Recomputed-hash forgery | PASS — `500 failed integrity verification` |
| Manifest + ledger deletion with a dropped record | PASS — `500 not authorized to adopt an unsealed store` |
| Save over the same store | PASS — `500`, no manifest minted |
| Restore + read | PASS — `200`, count 2 |
| App restart | PASS — re-enrolled as a new pid, host v3, `200`, count 2 |
| Host bridge on the final build | PASS — `peer pid … authenticated by pid + SO_PEERCRED` |
| logcat: crashes / ANRs | PASS — none from the app or signer on the final build |

A note on the probe: it is started with `am start-foreground-service`, so it must post its own
notification. Before that it was killed with `ForegroundServiceDidNotStartInTimeException`, which
looks like an app crash in logcat; the probe now calls `startForeground()` with a `specialUse` type
and the crash is gone (verified: empty crash scan after the final run).

---

## 10. Build, typecheck, lint, automated tests

| Check | Command | Exit |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | 0 |
| Lint | `npm run lint` (oxlint `--deny-warnings`) | 0 — 0 warnings, 0 errors, 1582 files |
| Server bundle | `npm run build:server` + `node scripts/prepare-android-host.mjs` | 0 — 2047 files, enterprise layer excluded |
| Android unit tests | `./gradlew :core:test :app:testDebugUnitTest :signer:testDebugUnitTest` | 0 — BUILD SUCCESSFUL (1157 app tests) |
| Signer authorization unit tests | `./gradlew :signer:testDebugUnitTest` | 0 — 12 tests |
| Preview APK | `./gradlew :signer:assemblePreview :app:assemblePreview` | 0 |
| Host bundle inside APK | `unzip` + hash compare against the extracted runtime | byte-identical |

Two failures were caught and fixed rather than waived:

* `ParagraphDirectionTest` and `SessionLingerServiceTest` NPE'd at `MemorySignerClient.kt:72` because
  Robolectric answers `bindService` with a null binder. A null binder is now treated exactly like an
  absent signer (fail closed), which is correct on device too.
* An instrumentation variant was attempted (`testBuildType = "preview"` + an `androidTest` Keystore
  suite). It ran and passed on the device (3/3), but it moved the unit-test variant to `preview` and
  broke 74 pre-existing app unit tests, and it renamed `:app:testDebugUnitTest` — which 31 documents
  reference. It was **reverted** in full; the Keystore evidence now comes from the preview probe,
  which needs no build-config change. Consequence to record: that experiment **uninstalled and
  reinstalled the preview package**, so the preview fixture lost its data (it is a disposable test
  install; the official `com.openmausbot.companion` was never installed over or uninstalled).

The full 885-file repository suite was **NOT RUN**; the suites above are the memory, capability and
API ones this change can affect.

---

## 11. Artifact identity

| Artifact | SHA-256 |
| --- | --- |
| `app-arm64-v8a-preview.apk` (built) | `5c61ecccb34fb5bd41e3f2428705a175551ba5f9c63bf06af889aedb56821de9` |
| installed `base.apk` (pulled from the device) | `5c61ecccb34fb5bd41e3f2428705a175551ba5f9c63bf06af889aedb56821de9` |
| `signer-preview.apk` | `04d98680301803e52b792e60987fac80aec73243b7934622e0d8f2cf3b0e5c5d` |
| `assets/host/server.zip` | `19243a36cd0a02d5ffd53f1108554aa7f29397af363dd100e9f56786bf40e7f6` |
| extracted `files/host-server/index-android.js` vs the same entry in the zip | `6e09b7bc0f4cfe9100bfc5a506bdc751f017f1f2b5c4ec46f877e53f6520c7b1` (both) |

The installed package therefore runs exactly the tested APK and the tested server bundle.

---

## 12. Files changed and Git state

New:

* `android/signer/src/main/kotlin/com/openmausbot/companion/signer/SignerAuthorization.kt`
* `android/signer/src/test/kotlin/com/openmausbot/companion/signer/SignerAuthorizationTest.kt`
* `android/app/src/main/kotlin/com/openmausbot/companion/host/SignerEnrollmentReceiver.kt`
* `android/app/src/preview/kotlin/com/openmausbot/companion/host/SignerRaceProbeService.kt`
* `server/memory-downgrade-api.test.ts`
* this report

Modified:

* `android/signer/src/main/aidl/com/openmausbot/companion/signer/IMemorySigner.aidl` (+ the app's copy)
* `android/signer/src/main/kotlin/com/openmausbot/companion/signer/MemorySignerService.kt`
* `android/signer/src/main/AndroidManifest.xml`, `android/signer/build.gradle.kts`
* `android/app/src/main/AndroidManifest.xml` (enrollment receiver), `android/app/src/preview/AndroidManifest.xml`
* `android/app/src/main/kotlin/com/openmausbot/companion/host/MemorySignerClient.kt`, `HarnessHost.kt`
* `server/memory-integrity.ts`, `server/memory-integrity.test.ts`
* `android/app/src/main/assets/host/server.zip` (rebuilt from the tested server)

Git: HEAD unchanged at `b945d72756199f004624a980127fdec5c56be6ce`; 51 modified files (Phase 1–12),
new files untracked; nothing staged, committed or pushed. No destructive command was run. The
official package `com.openmausbot.companion` (uid 10039) was never installed over, cleared or
uninstalled.

---

## 13. Remaining risks and blocked checks

1. **Code inside the app's main process is not distinguishable from the harness.** The enrollment
   challenge protects *which process* may sign; a process that has already achieved execution inside
   the app's main process is that process. Such code already owns the canonical store, the host
   environment and the workspace, so the signer is not the weak link — but it must not be claimed as
   isolated from it.
2. **Paired rollback of a consistent older (records + manifest) pair is not detected.** Restoring
   both files to an earlier signed state leaves a store that verifies, because nothing outside the
   workspace records a monotonic head. The existing test states this explicitly
   (`does not re-trust a store when the manifest and records are rolled back together`). Closing it
   needs a monotonic anchor held outside the app UID — the signer is now a plausible home for one —
   and was out of scope for this phase.
3. **The Keystore is software-backed** (`level=1`). Key extraction from a TEE is not what protects
   the key here; UID separation is. A compromised runtime can still ask the signer to sign, in which
   case the record-shape and purpose checks are all that stand between the attacker and a MAC.
4. **`app_process` direct-Keystore probing is BLOCKED** (ART class-loader abort under `runas_app`).
   The app-UID answer comes from a JVM-free Android process instead, which is stronger evidence
   anyway, but the classic `app_process` route remains unmeasurable on this device.
5. **`ptrace_scope` readback was UNKNOWN** (not readable from the shell), so "a same-UID process
   cannot read the challenge out of the app's heap via ptrace" rests on Android's documented
   restriction of PTRACE_MODE_ATTACH to ancestors, not on a measurement taken here.
6. **The preview fixture lost its data** during the reverted instrumentation experiment (§10). No
   user-facing install was affected.
7. **Desktop `file`-provider installs keep the historical adoption rule** when the harness flag is
   absent. That is deliberate — the key sits beside the store there — but it means Gate C's closure
   is a property of the harness-driven (Android) boot, not of every deployment.
8. **The preview probe is test-only code in the product tree.** It is confined to
   `android/app/src/preview/`, is absent from the official build, and only logs; it must not be
   carried into a shipped variant.
