# Phase 10 — Same-UID signing oracle: PID-authenticated integrity bridge

Date: 2026-10-22 · Device: Samsung Galaxy A07 (`R8YY90VT4EM`, SM-A075F, Android 16 /
API 36, arm64-v8a) · HEAD: `b945d72756199f004624a980127fdec5c56be6ce`
(unchanged; nothing staged or committed)

## 1. Acceptance status — **NOT ACCEPTED**

Path A (the `/proc/<host>/fd` signing oracle) is **closed and measured closed on the
physical device**. Path B (direct same-UID Keystore invocation, gate §13.2) is
**OPEN by architecture** and is not claimed closed. Because the required guarantee
covers both, the phase is **NOT ACCEPTED**.

| Gate | Result | Evidence |
|---|---|---|
| `/proc/<host>/fd/0` reopen (MAC channel) | **PASS — closed** | `ENXIO` from an app-spawned PTY (§3-A) |
| Host memory read (`/proc/<host>/mem`) | **PASS — denied** | open accepted, first read `EIO`, zero bytes (§3-A) |
| Channel endpoints authenticated both ways | **PASS** | `SO_PEERCRED` vs `Process` pid, logged at accept (§5) |
| MAC frames only on the authenticated socket | **PASS** | memory round trip + `first Keystore MAC request` (§9) |
| Tamper / manifest removal fails closed | **PASS** | `ERR_MEMORY_HASH_MISMATCH`, `ERR_MEMORY_INTEGRITY` (§9) |
| Direct Keystore use by same-UID code (§13.2) | **FAIL — still reachable in principle** | `app_process` runs `RuntimeInit` as uid 10279 (§7) |

## 2. Threat model and process identities

Every actor below runs under **one application UID** (app, embedded host, agent PTY,
MCP children). There is no UID boundary between them. The boundaries this design
uses are all kernel-enforced:

| Property | Mechanism |
|---|---|
| Integrity channel unreachable via `/proc` | sockets cannot be reopened through `/proc/<pid>/fd` magic links — `open(2)` answers **ENXIO** (pipes could be, and were: phases 8–9 measured `PTY_FD_FD_READ_OK/WRITE_OK` and request injection on `/proc/<host>/fd/0,1`) |
| Channel endpoints authenticated | `SO_PEERCRED` (kernel pid/uid at connect time; unforgeable, not replayable) checked **in both directions** |
| Host process state | `PR_SET_DUMPABLE=0` (phase 9): `/proc/<host>/mem` unreadable, `pidfd_getfd` and core dumps denied — re-measured this phase |
| Channel cannot be inherited | the host's connected socket lives at **fd 0**; every process the host spawns replaces fd 0 with its own pipes/PTY |
| Socket name is *not* a secret | measured: the agent reads the host's environment, which contains `OMB_MEMORY_INTEGRITY_SOCK` (§3-A) — which is exactly why identity, not obscurity, gates the accept |

Out of scope, unchanged: root, OS compromise, modified installed app, arbitrary
execution *inside* the trusted host, and same-UID denial of service (a same-UID
process can `kill(2)` the host regardless of this design).

## 3. Reproduction of the two attack paths

### A. Descriptor bridge access — reproduced, then closed, measured on device

Phase 9 measured the host's stdio pipes reopenable from the agent's PTY, MAC
requests injectable and responses readable. This phase's first candidate fix (an
inherited socketpair end) was **rejected by the device itself** (20:04): the
launcher died with `could not attach the integrity bridge to stdin: Bad file
descriptor`, proving Android's `ProcessBuilder` closes non-stdio descriptors
pre-exec. The fail-closed design held (no host booted), and the handoff was
replaced with a per-spawn abstract socket (§4-B).

Post-fix measurement, from the **agent's own position** — a PTY child of the app
spawned through `TerminalDriverServer`, i.e. `u:r:untrusted_app:s0` and the app
UID, not the broader `runas_app` domain `adb run-as` gets:

```
DOMAIN:       u:r:untrusted_app:s0:c23,c257,c512,c768
PPID:         PPid:  31677                      ← /proc/<host>/status readable
FD0_READ:     can't open /proc/31756/fd/0: No such device or address   (ENXIO)
FD1_WRITE:    open succeeds                     ← stdout is a log pipe, not the channel
MEM_OPEN:     open succeeds
MEM_READ:     dd: /proc/31756/mem: read error: I/O error   (0 bytes copied)
ENVIRON_OPEN: open succeeds, contents readable  ← socket name is discoverable
CMDLINE_OPEN: open succeeds
```

(Measured on the final APK: app pid 31677, host pid 31756. The same probe on the
first fixed build, app 17826 / host 17951, produced identical results, including
`/proc/17951/fd/0: No such device or address`.)

Two conclusions, both load-bearing:

- **The descriptor oracle is gone.** `open()` on the bridge fd is refused by the
  kernel with `ENXIO`; there is no numeric, reopenable handle for a same-UID
  process to speak the MAC protocol over. `fd 1` remains writable, but stdout now
  carries log lines only — frames travel exclusively on the authenticated socket.
- **The socket name must not be treated as a secret.** The agent can read the
  host's environment and therefore `OMB_MEMORY_INTEGRITY_SOCK`. Obscurity is not
  the boundary; the PID check is (§5).

`/proc/<host>/mem` opens but yields **zero readable bytes** (`EIO` on first read):
the dumpable flag is doing its job. Phase 9 recorded the same denial as `EACCES`
from a different probe; the fact measured today is "no bytes readable".

### B. Direct Keystore invocation — route available, exploitation not reproduced

From the same PTY:

```
APP_PROCESS: executable
RuntimeInit: >>>>>> START com.android.internal.os.RuntimeInit uid 10279 <<<<<<
probe:       exit code 0, no stdout/stderr, no keystore2 HMAC traffic
```

So `/system/bin/app_process` **does** start a JVM under the application UID on this
build — the route exists. The probe class (`KeystoreProbe`, dex confirmed to
contain `LKeystoreProbe;`) did not execute in this invocation: no output, exit 0,
and `keystore2` logged only its idle watchdog. Phase 9 recorded a different,
incidental ART abort ("APEX data files untrusted"). **Neither observation is a
designed boundary.** Same-UID code with a Keystore-capable runtime, or native
`keystore2` binder traffic, can still use the app's key; gate §13.2 is **OPEN**.
Why the probe class does not run is **UNKNOWN** (not investigated further: it does
not change the verdict).

## 4. Architecture evaluated and decision record

- **A — Inherited socketpair end** (first implementation this phase): **REJECTED
  on measured evidence** (Section 3-A: `EBADF`; `ProcessBuilder` closes non-stdio
  fds pre-exec). It would also have leaked the fd into the host's children.
- **B — PID-authenticated abstract Unix socket** (implemented, device-verified):
  the launcher *dials in* to a per-spawn abstract socket name; the harness accepts
  only the connection whose **kernel** pid is the process it forked, and the host
  checks the listener's kernel pid against `OMB_HARNESS_PID`. No inherited fds, no
  filesystem entry to squat. A squatter can at worst stall a boot (DoS — already
  out of scope), never impersonate either side.
- **C — Separate-UID trusted signer** (evaluated, not the smallest viable step):
  an `isolatedProcess` UID genuinely separates, but isolated UIDs cannot use the
  app's Keystore keys (keys are per-UID), and a second signing package needs its
  own install/rotation/signature-permission machinery. It remains **the only
  design that can close gate §13.2**; proposed as the product decision in §15.

The mission's "asynchronous PID-authenticated socket" is implemented
synchronously: the connected socket sits at fd 0, so the existing
`readSync`/`writeSync` frame protocol is preserved, and PID authentication is
kernel-side, needing no async control plane.

## 5. Implementation and trust boundaries

| File | Change |
|---|---|
| `android/app/src/main/jni/ombexec.c` | `omb_attach_bridge()`: connect to `OMB_MEMORY_INTEGRITY_SOCK` (abstract), verify listener pid == `OMB_HARNESS_PID` and uid via `SO_PEERCRED`, `dup2` → fd 0, `setenv OMB_MEMORY_INTEGRITY_FD=0`, else honest stderr + exit 127 (fail closed) |
| `android/app/src/main/jni/ombpty.c` | `nativeListen` (abstract bind+listen, `SOCK_CLOEXEC`), `nativeAcceptPeer` (poll+accept4+`SO_PEERCRED`, foreign-uid callers closed as `-EACCES`), `nativeSetCloexec` |
| `.../host/NativeIpc.kt` (new) | Kotlin seam over those JNI symbols |
| `.../host/HarnessHost.kt` | Per-spawn name `omb-integrity-<appPid>-<nonce>`; env `OMB_MEMORY_INTEGRITY_SOCK` + `OMB_HARNESS_PID`; accept loop keeps only the connection whose kernel pid is the spawned child (**pid from `Process.toString()`**, parentage fallback), logs the proof, marks the accepted fd `FD_CLOEXEC`; frames (MAC responses, legacy key) ride that socket; stdout is logs only |
| `server/memory-integrity.ts` | Bridge I/O on `OMB_MEMORY_INTEGRITY_FD`; native mode **fails closed** when it is absent or malformed — never a weaker provider |
| `server/memory-integrity.test.ts` | Suite "H. bridge descriptor contract": no descriptor ⇒ fail closed; malformed ⇒ fail closed; frames land on the handed-over descriptor, never stdout |
| `.../host/NativeIpcJniContractTest.kt` (new) | JNI name contract for `NativeIpc` |

### The defect the phone found, and the fix

The first install of this design **failed closed on device**, and the logs said
why (22:38:30, app pid 15174, host 15305):

```
hiddenapi: Accessing hidden method Ljava/lang/Process;->pid()J … api=blocked … denied
security: integrity bridge connection from pid 15305 (uid 10279) refused — the host is pid -1
security: the host never authenticated on the integrity bridge — memory integrity stays closed
```

`java.lang.Process#pid()` is blocked for this `targetSdk` by ART, so the harness
could not name the child it had forked — and refused its own host. Memory stayed
closed (no silent downgrade), which is the correct posture but an unusable
feature. Fix, in `HarnessHost.kt`:

1. **`pidOf` falls back to public API**: the platform's `Process.toString()`
   prints `Process[pid=<n>, …]` (the literal ``Process[pid=`` is present in this
   build's `core-oj` dex), so the pid is recovered without hidden methods.
2. **`describeParent`** — a second, independent proof for builds where even that
   fails: `/proc/<peer>/status` carries the `PPid` the kernel assigned at fork,
   and no process can make itself a child of another. It returns `verified` or
   the exact reason it could not (the refusal log prints it). Anything short of
   `verified` leaves the bridge closed.

Both proofs are compared against `SO_PEERCRED`, which the kernel fills at connect
time; neither can be influenced by the connector. Post-fix accept line:

```
security: integrity bridge accepted — peer pid 31756 authenticated by pid + SO_PEERCRED; /proc cannot reopen it
memory integrity: Keystore HMAC provider active (level=1)
memory integrity: bridge reader attached (bridge fd 164)
```

(First fixed build, 22:47:30: peer pid 17951, bridge fd 158. The logcat above is
the final APK at 22:58:58, app pid 31677.)

## 6. Host descriptor and IPC results

Measured on the final package (§3-A): `/proc/<host>/fd/0` → `ENXIO`;
`/proc/<host>/mem` → `EIO` on read, zero bytes; `fd/1` writable but inert (log pipe
only). The harness's accept path refused a same-UID connection whose pid did not
match (observed pre-fix at 22:38:30 with `pid -1`), and keeps only a
kernel-authenticated match once the pid is known. Descriptor handoff of the
accepted end as `FD_CLOEXEC`: `nativeSetCloexec` returned 0 (no warning logged).

## 7. Direct Keystore access results — **OPEN**

See §3-B. The route (executable `app_process`, JVM start as uid 10279) is
available; the probe class did not execute in this configuration, and no MAC was
obtained through it. This is **not** a boundary and the gate is **not** closed.
Canonical-payload validation and per-boot frame ids remain as defence in depth,
but the alias is reachable in principle by any same-UID process that can speak
Keystore.

## 8. Signing-authority and replay protection

MAC requests are answerable only over the two-endpoint channel; frames carry
per-boot monotonic ids and the harness MACs **only canonical record/manifest
payloads** (≤512 per request), never arbitrary bytes. There is no third endpoint
that can deliver bytes to the harness side: the abstract name is per-spawn with a
nonce (and although the name is readable from the host's environment, a foreign
connector's kernel pid is not the child's, so it is refused), `SO_PEERCRED`
rejects foreign UIDs, and the socket is not reopenable via `/proc`
(`ENXIO`, measured).

## 9. Memory-integrity and partition regression results — **PASS**

On-device, through the authenticated bridge (final APK: app 31677, host
31756; the same sequence on the first fixed build, app 17826 / host 17951,
gave the same results):

| Step | Result |
|---|---|
| `POST /api/bots/<id>/memory/records` | 200, record sealed (`6de0096f-…`) |
| logcat | `memory integrity: first Keystore MAC request received from the host` (22:59:46.012 on the final APK; 22:50:12.384 on the first fixed build) |
| `GET …/memory/records` | 200, record returned, verified |
| tamper `records.json` (`adb run-as`, same UID, `runas_app` domain — a *file* write, which any same-UID process can do) | `ERR_MEMORY_HASH_MISMATCH … sha256Hash does not match canonical payload representation`, HTTP 500 |
| restore `records.json` | 200, records verify again |
| remove `records.integrity.json` (MAC manifest) | `ERR_MEMORY_INTEGRITY: records.json has no integrity manifest and this store was already upgraded`, HTTP 500 — **no downgrade path** |
| restore manifest, `DELETE` the probe record | 200, `deleted: true`; `count 0` |
| remove the probe's own tombstone files (the bot had no records before this test) | `GET` → `{"ok":true,…,"count":0}`; device data left as found |

Local suites after the final source change: `npm run typecheck` **0**,
`npm run lint` **0 warnings / 0 errors**,
`vitest server/memory-integrity.test.ts server/memory-store.test.ts
server/memory-routes.test.ts` **138/138**. Earlier the same session, the full
battery: memory suites (`integrity`, `store`, `routes`, `reconciliation`,
`partition`, `journal`) **257/257**; `server/index.test.ts` (bot-memory API)
**231/231**; `memory-room-prompt.e2e`, `thread-aware-bots.e2e`,
`capability-registry`, `safety-policy` **24/24**; Android
`:core:test :app:testDebugUnitTest` **BUILD SUCCESSFUL** (re-run after the
Kotlin fix, both JNI contract suites included).

## 10. Preserved or changed agent capabilities

Unchanged: agent shell/PTY execution, computer-use, browser driver, file tools,
MCP. Changed: the host's stdio pipes no longer carry integrity frames (stdout is
logs only), and native-mode memory **requires** the authenticated channel — a
hardened build without it fails closed instead of downgrading (measured pre-fix:
the app still served, memory stayed closed).

## 11. Physical Galaxy A07 evidence

- 22:36 — device reconnected after USB debugging was enabled; `adb devices` →
  `R8YY90VT4EM device` (USB had exposed only MTP: `04e8:6860`, Imaging + CDC, no
  ADB interface).
- 22:38 — pre-fix install: hidden-API block on `Process.pid()` → bridge refused
  its own host (`pid -1`), memory closed, host healthy. This is the defect fixed
  in §5.
- 22:46–22:47 — first fixed APK built and installed, launched; bridge accepted
  (`peer pid 17951 authenticated by pid + SO_PEERCRED`, `bridge fd 158`).
- 22:49–22:50 — PTY probes (`§3-A`), record write/read, tamper and
  manifest-removal tests (`§9`); `app_process` probe attempt (`§3-B`).
- 22:58 — final APK (one comment corrected) built, installed (`lastUpdateTime`
  22:58:41), launched; identical bridge line: `peer pid 31756 authenticated by
  pid + SO_PEERCRED`, `bridge fd 164`, app 31677.
- 22:59 — final-build PTY probe: `FD0_READ` `ENXIO`, `MEM_READ` `EIO`; memory
  record write/read; tamper, manifest-removal and delete repeated with the same
  results as §9; `app_process` `RuntimeInit uid 10279` again.
- Probe sessions and artifacts removed afterwards (`files/p10-probe.dex`,
  `kp*.out`, `/data/local/tmp/p10-keystore-probe.dex`); the probe record and its
  tombstone files removed; `GET …/memory/records` ends at `count 0`.

## 12. Build, static-analysis, and test results

`npm run typecheck` PASS (0) · `npm run lint` PASS (0/0) · native libs rebuilt for
all 3 ABIs (`node scripts/build-android-pty.mjs`) · `npm run build:server` PASS ·
`node scripts/prepare-android-host.mjs` PASS · `./gradlew :core:test
:app:testDebugUnitTest` PASS (`BUILD SUCCESSFUL in 1m 3s`, re-run after the
final rebuild) · `./gradlew :app:assemblePreview` PASS · vitest suites listed in
§9 PASS · on-device checks listed in §3, §6, §9 PASS except the direct-Keystore
gate (§7).

## 13. Final APK and bundle identity

- APK: `android/app/build/outputs/apk/preview/app-arm64-v8a-preview.apk`,
  **85,218,912 bytes**, sha256
  `16f92452000e532dffeed1b114b11747bca772a1ec334c316b2fdf2dfd8b166f`.
- **Installed and running copy is byte-identical**: the device's
  `/data/app/…/base.apk` reports the same sha256 and size
  (`pm path` → `sha256sum`, 23:00), and the running process is that install
  (`lastUpdateTime` 22:58:41, host 31756).
- Embedded `assets/host/server.zip` sha256
  `c6701e311b8f6e38109c6190fb41a3a222da6764e72beb68729590845bb75c5d` — unchanged
  by this fix (Kotlin-only), byte-identical to the tested `dist-server` bundle.
- Verified inside the APK: launcher contains `OMB_MEMORY_INTEGRITY_SOCK`,
  `OMB_HARNESS_PID`, "refusing the channel"; `libombpty.so` exports
  `Java_com_openmausbot_companion_host_NativeIpc_nativeListen` and
  `…_nativeAcceptPeer` (arm64-v8a strings inspection); dex contains the new
  `kernel parentage` and `cannot read /proc/` strings.

## 14. Files changed and Git state

Phase-10 source changes: `ombexec.c`, `ombpty.c`, `NativeIpc.kt` (new),
`HarnessHost.kt`, `NativeIpcJniContractTest.kt` (new), `memory-integrity.ts`,
`memory-integrity.test.ts`, all 6 `jniLibs/**/libomb{pty,exec}.so` (rebuilt),
`assets/host/server.zip` (rebuilt). Device-probe scripts:
`.omb-scratch/p10/pty-probe.py`, `.omb-scratch/p10/pty-probe2.py`. Working tree
also carries the uncommitted Phase 1–9 work (86 dirty paths total); **nothing
staged or committed**; `git rev-parse HEAD` = `b945d727…` before and after.

## 15. Remaining limitations and blocked checks

- **OPEN by architecture**: direct same-UID Keystore invocation (gate §13.2).
  Only a signer in a *different UID* (a separate signing package with a
  signature-level permission, or an isolated-process broker that owns the key)
  closes it; that is a product decision (install flow, key rotation), not a
  silent hardening step.
- **UNKNOWN**: why the `app_process` probe class does not execute on this build
  (route availability is proven, exploitation is not).
- **UNEXERCISED**: the `/proc`-parentage fallback in `acceptHostBridge`. The
  exact-pid path (from `Process.toString()`) succeeds first on this device, so
  the fallback never runs; it fails closed if consulted and its refusal log names
  the reason. Not verified on hardware.
- **NOT RUN** on device: none of the checklist items — all were executed this
  phase (§11).
- Adopted hosts (restart of the *app* process while the host survives) have no
  bridge: memory fails closed for that boot — same posture as phase 8.
- Same-UID DoS (killing the host, or stalling a boot by squatting the abstract
  name) remains possible and out of scope.
- `stdio: "inherit"` spawns exist only in `android-npx-shim.ts` (runs in shell
  lineage whose fd 0 is a pipe/PTY, never the host's channel); verified by source
  inspection, not re-measured on device this phase.

---

### Reproduce (device attach)

```bash
adb install -r android/app/build/outputs/apk/preview/app-arm64-v8a-preview.apk
adb shell am force-stop com.openmausbot.companion.preview
adb logcat -c && adb shell am start -n com.openmausbot.companion.preview/com.openmausbot.companion.MainActivity
# expect: "integrity bridge accepted — peer pid <n> authenticated by pid + SO_PEERCRED"
adb forward tcp:28799 tcp:18799
curl -s -X POST -H 'content-type: application/json' \
  -d '{"category":"episodic_event","headline":"probe","detail":"d","confidence":0.9}' \
  http://127.0.0.1:28799/api/bots/<botId>/memory/records     # then GET the same path
# fd probe from the agent's own position: .omb-scratch/p10/pty-probe.py (credentials
# are the per-boot AT_DRIVER_PORT/AT_DRIVER_TOKEN in the host's environment)
```
