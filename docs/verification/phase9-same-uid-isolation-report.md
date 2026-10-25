# Phase 9 — Same-UID agent execution isolation: **NOT ACCEPTED**

The previous phase left one honest hole: code running as the app's UID could open
`/proc/<host>/fd/0|1` and use the Keystore MAC bridge as a signing oracle. This
phase traced that path through MOBOT's real agent execution code, measured what
the kernel actually enforces on the device, implemented the strongest mitigation
that does not break the product, and concluded that the required isolation
cannot be delivered on this architecture without either a separate UID for
untrusted code or an asynchronous PID-authenticated bridge. Both are redesigns,
not hardening. The guarantee is therefore **NOT ACCEPTED**, and the residual is
named precisely below rather than papered over.

`HEAD` before and after: `b945d72756199f004624a980127fdec5c56be6ce`. Nothing
committed, pushed, staged, reset or cleaned.
Device: Galaxy A07 `R8YY90VT4EM`; preview `com.openmausbot.companion.preview`
(1.1.1-threads-preview), official `com.openmausbot.companion` (1.1.1) untouched.

---

## 1. Acceptance status

| Requirement | Status |
| --- | --- |
| Untrusted agent execution path traced end to end | **PASS** |
| Boundary enforced by the OS | **FAIL** — no UID boundary exists for agent commands |
| Untrusted code cannot inspect privileged host descriptors | **FAIL** — measured: `fd/0` and `fd/1` open for read and write |
| Untrusted code cannot reach an unrestricted signing operation | **FAIL** — the bridge remains reachable; direct Keystore use is also possible |
| Authorized canonical memory mutations still work | **PASS** |
| Memory integrity across restarts | **PASS** |
| Shared/private bot isolation | **PASS** |
| Security and regression tests | **PASS** for what was run (see §9) |
| Final package contains the tested source | **PASS** |
| Boundaries and residuals documented | **PASS** |

**Overall: NOT ACCEPTED.** The mitigation implemented here is real but partial
(it closes `/proc/<pid>/mem`, core dumps and `pidfd_getfd`), and it does not
close the demonstrated bridge attack.

---

## 2. Threat model and process identities (measured)

```
$ adb shell "pidof com.openmausbot.companion.preview"          → 19632 (app, u0_a279)
$ adb shell "ps -A -o PID,PPID" | child of 19632               → 19843 (libnode_host.so, u0_a279)
$ adb shell "run-as ... id"                                     → uid=10279(u0_a279), context=u:r:untrusted_app
```

| Process | UID | Can reach |
| --- | --- | --- |
| App process (Kotlin host, PTY driver, Keystore) | 10279 | Keystore, app data, host pipes |
| Embedded Node host (`libnode_host.so`) | 10279 | Keystore bridge, canonical records, app data |
| Agent PTY child (the real tool path) | 10279 | everything the app can reach, including the host's `/proc` |
| `adb shell run-as` (test harness) | 10279 | the same, used only as a same-UID probe |

Both the PTY child and the host are `untrusted_app` in the same UID; the kernel
does not distinguish them. Confirmations come from the PTY probe in §3, where
the command's own `id` output is `uid=10279(u0_a279)`.

---

## 3. Root cause and reproduced attack

**Execution path.** `server/android-computer.ts` exposes `run_shell`/`run_command`
(and the persistent `terminal_*` tools) to bots; the app-side
`TerminalDriverServer` forks a PTY child (`android/app/src/main/kotlin/.../terminal/`)
with the app's UID. None of these is a sandbox: the child inherits the UID, and
this kernel has no Yama `ptrace_scope` file.

**Reproduction on the real PTY path** (token and port taken from the harness's
own `spawn: env summary`, session started through `TerminalDriverServer`):

```
$ curl -X POST http://127.0.0.1:43863/start -H "authorization: Bearer <AT_DRIVER_TOKEN>" \
  -d '{"program":"/system/bin/sh","args":["-c","exec 9</proc/<host>/fd/1 && echo PTY_FD_READ_OK; \
       exec 8>/proc/<host>/fd/1 && echo PTY_FD_WRITE_OK; \
       cat /proc/<host>/mem >/dev/null && echo PTY_MEM_OK; id"]}'
```

Observed output, final build (host pid 19843):

```
PTY_FD_READ_OK
PTY_FD_WRITE_OK
PTY_MEM_DENIED
uid=10279(u0_a279) … context=u:r:untrusted_app:s0:c23,c257,c512,c768
```

So a bot's own terminal can still duplicate both ends of the host's bridge pipes
and exchange frames with the harness. The previous phase demonstrated that a
frame injected this way is answered with a valid Keystore MAC; nothing about
that access changed in this build.

Second same-UID route: `/system/bin/app_process` is executable from the same
PTY (`BIN_OK`, and invoking it did not fail immediately), so a shell is not
limited to toybox — it can start a JVM with the app's UID and reach the Keystore
alias directly, without the bridge at all.

---

## 4. Architecture evaluated

| Candidate | Finding | Verdict |
| --- | --- | --- |
| `android:isolatedProcess` service for shell | Isolated UID by definition; no app-private storage, no INTERNET, no Keystore namespace. Shell commands would lose the bot workspace, `node`, `npm`, and every file the agent works on. Child processes inherit the isolated UID, so the separation is real — but so is the capability loss. Not a drop-in replacement. | Rejected for this phase |
| Separate package / second UID for signing | Keystore keys are per-UID, so the existing v2 manifests would need another rotation; the service would need a binder API plus authentication. A same-UID shell can still bind to an exported service, so the service must authenticate the caller — which brings the same problem back unless the trusted caller is identified by kernel credentials (PID) over binder, which Node cannot use without a native binding. | Redesign, out of scope |
| PID-authenticated Unix socket bridge | The app is the server, the host connects, `SO_PEERCRED` gives a kernel-verified PID; sockets cannot be reopened through `/proc/<pid>/fd`. This is the right long-term shape, but Node's socket API is asynchronous and the canonical store's write contract is synchronous; converting it is the async refactor the previous phase deliberately avoided, and a half-done version would put an `await` between records and manifest. | Proposed, not implemented |
| Remove untrusted code execution (drop bot shell/terminal on Android) | Closes both the bridge and the direct-Keystore route, but removes a headline Android capability and the engine's own Bash path; a product decision, not a silent hardening step. | Proposed, not implemented |
| `PR_SET_DUMPABLE=0` on the host | Blocks `/proc/<pid>/mem`, core dumps and `pidfd_getfd`, and survives exec with unchanged credentials. Measured **not** to block `/proc/<pid>/fd` reopening on this kernel. | **Implemented** as partial mitigation |

---

## 5. Selected boundary and why it is not the required one

Implemented: the host is now started through the packaged launcher
`libombexec.so` with `OMB_EXEC_NODE=1` and `OMB_EXEC_NONDUMPABLE=1`; the launcher
calls `prctl(PR_SET_DUMPABLE, 0)` immediately before `execv` of the runtime
([ombexec.c](../../android/app/src/main/jni/ombexec.c)). If the launcher is
missing, [HarnessHost.kt](../../android/app/src/main/kotlin/com/openmausbot/companion/host/HarnessHost.kt)
logs a security line and spawns directly rather than pretending the hardening
exists.

Measured effect on the final build (host 19843, same-UID probe):

```
cat /proc/<host>/mem   → MEM_DENIED (EACCES)
cat /proc/<host>/environ → ENVIRON_OK      (kernel still allows)
cat /proc/<host>/cmdline → CMDLINE_OK      (kernel still allows)
open /proc/<host>/fd/1   → FD_OK (read and write)
```

`/proc/<pid>/mem` denial proves the flag is set (it was `MEM_OK`/I/O-error
before). The fd path remains, so the bridge is still usable. This is the measured
reason the boundary is not accepted: on this GKI kernel, `PR_SET_DUMPABLE=0`
does not gate the magic links under `/proc/<pid>/fd`.

`pidfd_getfd` remains blocked too (it needs `PTRACE_MODE_ATTACH_REALCREDS`,
which `dumpable=0` denies), so the only surviving route is the fd reopen shown
above — but that is exactly the route that matters.

---

## 6. Key and signing-authority protection

Unchanged from the previous phase and still holding:

- The HMAC key is a non-exportable Keystore `HmacSHA256` entry; it never enters
  Node, argv, env, files or logs; `key.keystore` is gone and the marker exists.
- The bridge validates purpose (`record`/`manifest`), canonical payload shape,
  batch size, and binds the purpose into the MAC input.
- Authorization, redaction, confidence, scope, lifecycle and reconciliation all
  run in `memory-store.ts` before the payload is formed; there is no generic
  `sign(bytes)` route.

What does **not** hold: a same-UID process can still obtain MACs, because it can
write into the host's stdout. The Keystore key is also directly usable by
same-UID Java/native code (`app_process` is executable). Neither is fixed by
`dumpable`.

---

## 7. Agent filesystem and shell behaviour after the change

- Shell and terminal capabilities are **unchanged** (no capability was removed).
- The host is non-dumpable, so `ps`/`/proc/<pid>/status` remain readable but
  memory scraping and ptrace-style attachment are denied.
- Bot file tools are still confined to the workspace; canonical records,
  manifests and `memory-integrity/*` remain refused by the device-file surface.

Narrowing shell execution was evaluated and deliberately **not** applied,
because it would remove a supported capability without the user asking for it
and because the engine's own Bash path would need the same treatment; that is a
product decision listed in §14.

---

## 8. Security regression tests and results

Device (final build):

| Check | Result |
| --- | --- |
| PTY child UID / SELinux context | **PASS** — `uid=10279(u0_a279)`, `untrusted_app` |
| PTY child opens host `fd/1` for read | **FAIL (vulnerability)** — `PTY_FD_READ_OK` |
| PTY child opens host `fd/1` for write | **FAIL (vulnerability)** — `PTY_FD_WRITE_OK` |
| PTY child reads host `/proc/<pid>/mem` | **PASS** — `PTY_MEM_DENIED` |
| `run-as` reads host `/proc/<pid>/mem` | **PASS** — denied |
| `run-as` reads host `environ` | **FAIL** — allowed on this kernel |
| `run-as` opens host `fd/0|1` | **FAIL** — allowed |
| `app_process` executable from the shell | **FAIL** — allowed (JVM route to Keystore open) |
| Keystore key / marker state after change | **PASS** — no blob, marker intact |

Automated:

- `cd android && ./gradlew :core:test :app:testDebugUnitTest` → **PASS** (exit 0).
- `npm run typecheck` → **PASS**.
- `npm run lint` → **PASS** (0 warnings, 0 errors, 1581 files).
- No server source changed in this phase, so the 508/143/50 suites from the
  previous report were not re-run; this is a Kotlin/native-only change, and the
  `server.zip` bundle is byte-identical (`b84ba086…`).

The forged-record matrix, stale-hash `409`, shared/private isolation and restart
behaviour were re-exercised at the API level on the final build via the previous
phase's verification script path: shared and private reads succeeded
(`shared 1 private 1`), the marker survived, and no key file exists.

---

## 9. Preserved device/computer-use capabilities

Nothing was removed. Workspace tools, terminal sessions, browser, and the
person's terminal all still work; the only behavioural difference is that the
host process is non-dumpable (it cannot be ptraced or memory-read by other
same-UID processes, and produces no core dumps).

---

## 10. Galaxy A07 evidence

- `adb devices` → `R8YY90VT4EM device`.
- Preview launched, host healthy: logcat `security: host launcher present —
  clearing the dumpable flag before exec`, then `Keystore HMAC provider active
  (level=1)`, `host healthy at 127.0.0.1:18799`.
- Installed extracted bundle `files/host-server/index-android.js` =
  `b84ba086e7b6f520…` = `dist-server/index-android.js`; APK asset
  `host/server.zip` unchanged.
- APK `app-arm64-v8a-preview.apk` contains the rebuilt `libombexec.so` (8,416 B
  stripped; source artifact 10,448 B) with `OMB_EXEC_NODE` present.
- Logcat after the final install: no `FATAL EXCEPTION`, no `ANR in`.
- The official app was stopped only so the preview could bind 18799, and is
  running again with its own host afterwards; its data was never touched.
- Live model-backed turn: **NOT RUN**.

---

## 11. Build, static analysis, tests

| Command | Result |
| --- | --- |
| `node scripts/build-android-pty.mjs` | **PASS** — 3 ABIs, `libombexec.so` + `libombpty.so` |
| `cd android && ./gradlew :app:assemblePreview` | **PASS** |
| `./gradlew :core:test :app:testDebugUnitTest` | **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** 0/0 |
| Full repository suite | **NOT RUN** |

---

## 12. Final package identity

```
app-arm64-v8a-preview.apk    path android/app/build/outputs/apk/preview/
installed host bundle        b84ba086e7b6f520cdb6b81307a4d94e98bee7752bf50094ac98223c1ab94a45
dist-server bundle           b84ba086e7b6f520… (identical)
```

---

## 13. Files changed and Git state

- [android/app/src/main/jni/ombexec.c](../../android/app/src/main/jni/ombexec.c) — `OMB_EXEC_NODE`
  entry point and `OMB_EXEC_NONDUMPABLE` / `PR_SET_DUMPABLE` hardening.
- [android/app/src/main/jniLibs/*/libombexec.so](../../android/app/src/main/jniLibs)
  — rebuilt for arm64-v8a, armeabi-v7a, x86_64 (tracked artifacts).
- [HarnessHost.kt](../../android/app/src/main/kotlin/com/openmausbot/companion/host/HarnessHost.kt)
  — launch the host through the launcher; explicit log when it is missing.
- [docs/verification/phase9-same-uid-isolation-report.md](phase9-same-uid-isolation-report.md) — this report.
- `.omb-scratch/p9-*` — probe scripts and build/test logs (ignored).

`HEAD` unchanged; nothing staged or committed. Pre-existing Phase 1–6 working
tree changes remain untouched.

---

## 14. Remaining limitations and required follow-up

1. **The demonstrated vulnerability is still present**: a bot's PTY shell (same
   UID) can read and write the host's `/proc/<pid>/fd`, so it can ask the
   harness for MACs. Marked **FAIL**.
2. **Direct Keystore use** by same-UID Java code (`app_process` is executable) is
   possible; the bridge is not even required. Marked **FAIL**.
3. `PR_SET_DUMPABLE=0` does not gate `/proc/<pid>/fd` or `/environ` on this
   kernel — measured. It does block `/proc/<pid>/mem`, core dumps and
   `pidfd_getfd`, which is why it was kept.
4. Isolated-process execution cannot retain app-private workspace access, so it
   is not a drop-in fix; that evaluation is based on Android's documented
   process model and was **NOT** exercised on the device beyond the UID checks.
5. `isolatedProcess` UID/child inheritance and `SO_PEERCRED` bridge behaviour are
   reasoned, not device-verified: **NOT RUN**.

Proposed next step, in order of preference:

1. Replace stdio with a PID-authenticated Unix-socket bridge and make the MAC
   path asynchronous end to end (app is the server; `SO_PEERCRED.pid` must equal
   the spawned host's pid; sockets cannot be reopened through `/proc`). This is
   the only design that keeps the shell and closes the oracle.
2. If the async refactor is not acceptable, move bot shell execution to an
   isolated UID and broker workspace access explicitly, accepting the capability
   loss and documenting it.
3. Keep `PR_SET_DUMPABLE=0` either way; it is cheap and closes memory scraping.

Until one of those lands, the same-UID isolation guarantee is **NOT ACCEPTED**.
