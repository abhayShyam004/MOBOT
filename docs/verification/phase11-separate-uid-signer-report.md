# Phase 11 — separate-UID signing authority and same-UID attack closure

Device: Samsung Galaxy A07 (SM-A075F), Android 16, kernel 6.6.75, arm64.
Preview package `com.openmausbot.companion.preview` (uid 10279), signer package
`com.openmausbot.companion.signer` (uid 10280), official package
`com.openmausbot.companion` (uid 10039) untouched.

## 1. Acceptance status

**Key confidentiality: PASS.** The HMAC key that seals canonical memory now lives in a
second application package with its own Linux UID. Android binds Keystore keys to the
creating UID, so no process of the main app — harness, Node host, or the bot's own PTY
shell — shares the key's namespace.

**Signing-authority isolation: PARTIAL / NOT ACCEPTED.** The signer refuses to be a
signing oracle: it has no listening socket, no `sign(bytes)` API, a signature-level
permission, a versioned three-call AIDL surface, and it pins the one caller process it
will serve. But the caller check rests on a lifecycle fact, not on a
same-UID-proof primitive: Android gives a cross-UID service only `uid` + `pid`, `uid`
is shared with the agent shell, and `hidepid=invisible` prevents the signer from
inspecting app processes at all (measured: cross-UID `/proc/<pid>` reads answer
`Permission denied`). Section 9 states the residual precisely.

**Direct Keystore attack from the agent PTY: BLOCKED / UNKNOWN.** `app_process` from
the real PTY aborts inside ART runtime creation (`GetDefaultBootImageLocation`) before
any Java runs — an initialization failure, **not** a Keystore denial. The direct-Java
probe therefore neither demonstrates the exploit nor proves the denial. What is
proved is that the alias is no longer in a namespace the agent's UID owns.

## 2. Threat model and process identities

| Process | UID | Role |
| --- | --- | --- |
| `com.openmausbot.companion.preview` | 10279 | UI + `HarnessHost`; owns the PID-authenticated bridge |
| Node host (child of the harness) | 10279 | canonical store, sends MAC frames over the bridge |
| agent PTY / bot shell (child of the host) | 10279 | untrusted code executed on the person's behalf |
| `com.openmausbot.companion.signer` | 10280 | owns the HMAC key; serves exactly one pinned caller |

Out of scope, stated rather than implied: root/adb, a compromised Android runtime,
another app with the platform signature, and physical access.

## 3. Direct Keystore attack reproduction

Measured on the preview install:

* The fleet's HMAC alias `omb_memory_integrity_hmac_v2` is created by, and scoped to,
  uid 10279. Every process of the app can therefore request MACs for it in principle.
* `adb shell run-as com.openmausbot.companion.preview app_process …` aborts in
  `GetDefaultBootImageLocation` — the failure is ART initialization, not authorization.
* A native Binder/Keystore client was not attempted; the JVM route is the only
  practical one from a shell, and its failure mode does not distinguish the two.

Conclusion: the *previous* architecture could not exclude same-UID Keystore use by
capability, only by the accident of a broken runtime. That is the gap the signer
closes for the key, and partially closes for the operation.

## 4. Separate-UID signer architecture

New Gradle module `android/signer` → APK `com.openmausbot.companion.signer`,
`minSdk 26`, no `sharedUserId`, signed with the same certificate as the app (required
for the signature permission).

* `MemorySignerKey` (signer UID): creates a non-exportable HMAC-SHA256 key under alias
  `omb_memory_integrity_hmac_v3`. MAC construction is byte-identical to the previous
  authority (`omb-memory-<purpose>-v1\n<payload>`, lowercase hex), so the canonical
  store's format did not change — only who holds the key. Missing key on a migrated
  install is an error; it is never regenerated.
* `MemorySignerService`: exported, protected by
  `com.openmausbot.companion.permission.MEMORY_SIGNER` (`protectionLevel=signature`).
  Surface is exactly `protocolVersion()`, `mac(protocol, id, purpose, payloads)`,
  `describe()` — no arbitrary-bytes call.
* The transport is Binder from the harness to the signer. The signer opens nothing.

## 5. Signer-caller authorization protocol

1. **Permission.** Only an APK signed with this app's certificate can bind. Measured:
   `adb shell am start-service …/.MemorySignerService` →
   `Error: Requires permission com.openmausbot.companion.permission.MEMORY_SIGNER`.
2. **Application uid only.** Every transaction rejects the signer's own uid and every
   uid below `FIRST_APPLICATION_UID`.
3. **Pinning.** `onBind` runs in the signer process, where `Binder.getCallingUid()`
   reports the signer itself (measured: 10280) — so binding is *not* where identity can
   be read. The pin is taken on the **first authorized transaction**, from
   `Binder.getCallingPid()`, which the kernel fills in and the caller cannot claim.
   Every later transaction must come from that pid or it throws.
4. **Ordering.** The app binds in `OpenMausApp.onCreate` (`MemorySignerClient.install`),
   *before* `HarnessHost` exists and therefore before any PTY child exists. Every shell
   is a descendant of the host, so at pin time there is no agent process to race.
5. **Protocol bounds.** Version check, monotonic request id (replay), purpose whitelist
   (`record`|`manifest`), ≤512 payloads, ≤64 KiB per payload, ≤1 MiB per batch, and the
   same canonical-shape check the harness applies. The signer does not rely on its
   caller for validation.
6. **Fail closed.** No signer ⇒ no v3 MACs ⇒ `ERR_MEMORY_INTEGRITY`, never a fallback.

Measured pins across three boots: pid 30600, 14880, 22368 — each the app's own process,
each logged by the signer before the harness spawned the host.

## 6. Direct Keystore and signer IPC results

| Check | Result |
| --- | --- |
| Distinct UIDs | **PASS** — 10279 vs 10280 (`pm list packages -U`) |
| Signer key created in its own UID | **PASS** — `created the non-exportable HMAC key in the signer's Keystore (level=1)` |
| App/agent can read signer data | **PASS (denied)** — `run-as` and shell: `Permission denied` on `/data/data/com.openmausbot.companion.signer` |
| App/agent can start the signer | **PASS (denied)** — signature permission required |
| App can use the signer alias directly | **BLOCKED** — no Java/Binder probe possible from the PTY (`app_process` aborts at ART init); Keystore ownership is the mechanism |
| Foreign-uid service call | **NOT RUN** — would need a third signed APK; the permission check was measured from shell |
| Replayed / oversized / unknown-purpose frames | **PASS (unit)** — enforced in `MemorySignerService` and covered by the protocol tests |

## 7. Existing socket bridge regression

Unchanged and still enforced: per-spawn abstract name, `SO_PEERCRED`, accept only the
child pid the harness just spawned, `PR_SET_DUMPABLE=0` via `libombexec.so`. Measured
on this build: `integrity bridge accepted — peer pid 22539 authenticated by pid +
SO_PEERCRED`. `/proc/<host>/fd` reopening remains `ENXIO`.

New: the bridge frame carries `key: "v2" | "v3"`. The harness serves v2 with the app
UID's alias (migration only) and v3 with the signer. An unknown key is an error.

## 8. Key migration and integrity behavior

Manifest version 3 (`provider: "keystore-signer"`) is the signer's. v2 stays the app
UID's key, and both remain verifiable only by their own authority:

* A v2 store verifies with the app key, then `loadMemoryRecords` re-seals **only the
  manifest** at v3. Record bytes are untouched (asserted in
  `re-seals a verified v2 store under the signer without rewriting records`).
* A v3 store cannot be verified with the app key — rewriting `version`/`provider` on a
  v2 manifest does not make it pass (`does not let a v2 store verify with the signer
  key`).
* The signer migration has its own marker (`signer-provider.json`), so the v1→v2
  completion does not stand in for it. Written on device at 00:32.
* On device: fresh store sealed as `version 3 / provider keystore-signer`, write 200,
  read 200. A tamper that recomputed the record's unkeyed SHA-256 returned
  `ERR_MEMORY_INTEGRITY: record … failed integrity verification`. Restoring the exact
  bytes returned 200 again; a full app+host restart still verified.
* **Fail closed, measured live:** `am force-stop com.openmausbot.companion.signer`
  dropped the binding, and the next write returned HTTP 500
  `ERR_MEMORY_INTEGRITY: keystore refused the integrity request: the separate-UID
  signer is unavailable: the separate-UID signer is not attached`. No manifest and no
  records file were created — nothing fell back to the v2 key. After the app restarted
  (signer re-bound, pinned a new pid) the same write sealed at v3 again.

## 9. Agent capabilities retained or changed

Retained: the PTY, workspace access, Node/npm, file tools, and every shell feature.
Nothing about command execution moved UID.

Changed: the MAC key is no longer in the app UID, and the harness no longer computes
v3 MACs itself. When the signer package is absent the harness logs
`no separate-UID signer attached` and keeps the v2 authority — that is a packaging
decision (a second APK), not a silent downgrade of a configured boundary. On a
signer-configured install, losing the signer fails memory closed.

## 10. Android Galaxy A07 verification

* `adb devices` → `R8YY90VT4EM … model:SM_A075F device:a07`.
* Installed preview `base.apk` sha256 `0f99e2ff…95c2986` (85,221,552 bytes), signer
  `b23caa67…13137e625` (893,154 bytes) — both identical to the built artifacts.
* Boot sequence observed: signer started → `pinned the trusted caller to pid 22368` →
  key created → app `attached to the separate-UID signer (protocol 1, level=1)` →
  harness `memory MACs will come from the separate-UID signer` → bridge accepted.
* v3 write/read, MAC-preserving tamper rejection, cross-UID data denial, service-start
  denial, signer-loss fail-closed, recovery after restart — all as tabulated above.
* Probe bots removed afterwards; the fixture is back to Planner/Coder/Researcher.
* Logcat: no FATAL/ANR from either package across the run.

## 11. Automated tests and exact exit codes

| Command | Result |
| --- | --- |
| `npm run typecheck` | **0** |
| `npm run lint` | **0** (0 warnings, 0 errors, 1581 files) |
| `npx vitest run server/memory-integrity.test.ts` | **61 passed** (6 new signer cases) |
| `… memory-store memory-partition memory-routes memory-reconciliation` | **242 passed** |
| `npx vitest run server/index.test.ts server/memory-room-prompt.e2e.test.ts server/thread-aware-bots.e2e.test.ts` | **241 passed** (3 files, 581.8 s) |
| `npx vitest run capability-registry.test.ts safety-policy.test.ts` | **14 passed** |
| `./gradlew :core:test :app:testDebugUnitTest` | **BUILD SUCCESSFUL** |
| `./gradlew :app:assemblePreview` | **BUILD SUCCESSFUL** |
| `./gradlew :signer:assembleDebug` | **BUILD SUCCESSFUL** |
| `npm run build:server` + `prepare-android-host.mjs` | **0 / 0** |

The new tests are adversarial: they drive two distinct bridge keys and assert *which
one* sealed each manifest, so "the manifest says v3" is never taken as proof.

## 12. Build, APK, and bundle identity

* `server.zip` sha256 `c5c76685…3bb69021` (10,973,805 bytes), packaged into the APK and
  verified equal after extraction.
* App APK `0f99e2ff…`, signer APK `b23caa67…`; both installed packages hash-equal to
  the tested files.
* `versionName 1.1.1`, preview suffix `-threads-preview`.

## 13. Files changed and Git state

New: `android/signer/**` (build file, manifest, AIDL, `MemorySignerKey`,
`MemorySignerService`), `android/app/src/main/kotlin/.../host/MemorySignerClient.kt`,
`android/app/src/main/aidl/.../IMemorySigner.aidl`,
`docs/verification/phase11-separate-uid-signer-report.md`.

Modified: `android/settings.gradle.kts` (module), `android/app/build.gradle.kts`
(`aidl`), `android/app/src/main/AndroidManifest.xml` (permission + `<queries>`),
`OpenMausApp.kt` (bind before host), `HarnessHost.kt` (signer flag, key routing,
`OMB_MEMORY_INTEGRITY_SIGNER`), `server/memory-integrity.ts` (v3, signer mode, key
routing, marker), `server/memory-store.ts` (target-version migration and reseal),
`server/memory-integrity.test.ts` (new suite), and the rebuilt
`android/app/src/main/assets/host/server.zip` + native libs.

Git: HEAD `b945d727`, 94 dirty paths, 50 tracked files changed (+8220/−152). Nothing
staged, committed, reset, cleaned, or checked out; the official package untouched.

## 14. Remaining risks and blocked checks

1. **Pinning is lifecycle-based, not cryptographic.** A same-UID process that could
   survive the app's death and issue a Binder transaction before the new harness binds
   could, if it won that race, receive MACs. The agent shell cannot issue Binder
   transactions today (`app_process` aborts), but that is not a boundary. Closing it
   needs either a trusted kernel-visible identity for the app's main process — Android
   does not expose one to another app — or moving the untrusted shell to its own UID.
2. **Direct Keystore probe from the PTY is BLOCKED**, not denied: the measured failure
   is ART initialization. The UID separation is real; a Java denial was not observed.
3. **Keystore is software-backed** on this device (`level=1`). A runtime compromise can
   read the key regardless of UID.
4. **The signer is a second APK.** Shipping it is a product decision (install flow,
   release signing, store policy). Without it the app keeps the v2 in-app authority and
   the same-UID limit that motivated this phase.
5. **Not run:** a foreign signed app attempting the binder (no third certificate
   available); a multi-bot concurrency soak against the signer; an on-device Java
   probe of the signer alias (blocked by ART init, section 6).
