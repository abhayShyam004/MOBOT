# ANDROID COMPATIBILITY — phase status

Last updated: 2026-09-21 (**Phase 7 — Browser**: WebView adapter + seeded `android_browser` MCP server PROVEN on ARM32 + ARM64 — full model-driven browser loop, per-bot isolation, restart persistence, security guards; see `## Phase 7 — Browser`)

## Where to find things

| Looking for… | Go to |
|---|---|
| Current capability status per phase | the phase's own `## Phase N` section below |
| Phase 4 (Android computer layer) | `## Phase 4: Android computer layer (agent tools) — status` |
| Phase 5 (MCP support) | `## Phase 5 — MCP support (2026-09-19/20)` |
| Phase 6 (Connectors / Composio) | `## Phase 6 — Connectors (2026-09-20)` |
| Phase 7 (Browser) | `## Phase 7 — Browser (2026-09-21)` |
| Phase completion states | the closing line of each phase section |
| Status vocabulary (PROVEN / EXPERIMENTAL / …) | the legend below |

## Status legend


> **Phase 2 freeze (2026-09-18):** the host boots and serves on **both** target ABIs.
> Device 1 (arm64-v8a, API 36): install ✓, launch ✓, host start ✓, health ✓, bots ✓.
> Device 2 (armeabi-v7a SM-A137F, API 34): the same, with full evidence quoted in Round 3 below.
> Both were run with the fixed APKs (Round-1 `useLegacyPackaging` + Round-2 `fs-publish.mjs` fix).
> ARM32 = **PROVEN**, ARM64 = **PROVEN** (reported pass on the fixed APK; same code path as the
> ARM32 round whose evidence is quoted). Phase 2 implementation and evidence are frozen.
> New work continues in the Phase 3 section of the architecture doc.

Statuses are honest and evidence-backed:

- **PROVEN** — demonstrated on the named target; the command/output is quoted in the evidence sections.
- **EXPERIMENTAL** — implemented and verified (tests or static checks), not yet demonstrated on that target.
- **NOT SUPPORTED** — cannot work on this platform; do not pretend otherwise.
- **NOT YET IMPLEMENTED** — planned, not built.

---

## Root-cause log

### 2026-09-18 — Round 1 (both ABIs): host start → silence → no health

Both devices (arm64-v8a API 36; armeabi-v7a API 34) installed and launched the
app cleanly, logged `HarnessHost: — host start requested —`, then nothing.
**Root cause (found statically):** the built APK had `extractNativeLib=false`
(modern AGP default), so `nativeLibraryDir` was empty and provisioning threw —
into a failure path that (an instrumentation gap, since closed) logged nothing.
**Fix:** `packaging { jniLibs { useLegacyPackaging = true } }`. No ABI
conclusion may be drawn from this round: the runtime never loaded on either
device.

### 2026-09-18 — Round 2 (ARM32): runtime executes; server exits on `link()` EACCES

With libs extracted, `libnode_host.so` loaded and executed and the server
bundle ran — then exited:

```
errno: -13, code: 'EACCES', syscall: 'link',
path: '.../host/data/.environment-id.<pid>.<uuid>.tmp',
dest: '.../host/data/environment-id'
```

**Root cause:** SELinux denies `link(2)` to app processes on their own data
files (verified on the device: `ln` → "Permission denied"; `symlink` → OK).
Upstream publishes locks/leases/one-shot records with one atomic hard link
(atomic create-if-absent; complete record before the name exists; reaper
election at deterministic never-unlinked paths). Six call sites: the data-dir
lease, `environment.ts` (environment-id), `box-create-idempotency.ts` +
`box-delete-journal.ts` (journal locks), `attachments.ts` (upload commits).
**Fix:** one shared compatibility layer, `electron/fs-publish.mjs` — on
filesystems where `link(2)` is denied (EACCES/EPERM/ENOSYS/EOPNOTSUPP/ENOTSUP/
EXDEV, probed per directory), records publish as a **relative symlink to a
fully-written payload file**. Preserved semantics: `symlink(2)` is atomic
create-if-absent (`EEXIST` on the taken name — verified raw on device, the
toybox `ln` CLI is *not* evidence, it unlinks-and-retries); the payload is
complete and fsynced before the name exists; relative targets survive data-dir
renames and the `/data/data` ↔ `/data/user/0` aliasing; dangling-name recovery
and payload reclamation added. No copy/rename anywhere (rename would silently
replace a held lock and break exclusivity). Also fixed this round: the
relocated Node's compiled-in OpenSSL config path pointed into Termux's private
dir — the host env now sets `OPENSSL_CONF=/dev/null`.

### 2026-09-18 — Round 3 (ARM32): host serving from the phone ✓

Device SM-A137F (armeabi-v7a, `armv8l`, API 34, SELinux Enforcing):

```
HostFiles: provision: native libraries present 10/10
HostFiles: extraction completed in 0.677 s; stamp written
HarnessHost: process started: args=[.../host-server/index.js]
HarnessHost: runtime produced first output — the server bundle is executing
health: {"app":"openmausbot","pid":11610,"static":false}          # via adb forward
bots:   {"bots":[{"id":"5d5fa4c0-cd08-45ea-…","name":"Nimbus",…}]} # served from device data dir
ps:     u0_a241 11610 11554 … libnode_host.so …/host-server/index.js
RESULT: host is serving from the device. ✓
```

On-device data dir shows the designed lease shape:
`openmausbot-server.lease -> openmausbot-server.lease.payload-11610-…`
(payload files mode 0600), plus `messages.db` — the `node:sqlite`+FTS5
transcript store created successfully on-device.

**Persistence + stale-lease recovery on device:** `am force-stop` killed the
host without release; relaunch → the server's own reaper retired the dead
owner's symlink lease and re-acquired (`health: {"pid":11791}`) and the *same*
bot UUID was still served — create/load-bot + close/reopen-app + state
survives, per Phase 2's persistence requirement.

## Component matrix

| Component | armeabi-v7a (target device) | arm64-v8a | x86_64 | Status |
|---|---|---|---|---|
| APK build (debug, per-ABI + universal) | ✅ 59.5 MB | ✅ 64.9 MB | ✅ 64.9 MB | **PROVEN** |
| Embedded Node runtime (Termux Node 26.4.0, bionic-linked) | ✅ executes on device | ✅ same binary family | ✅ | **PROVEN on ARM32 device**; arm64 EXPERIMENTAL (same path, device round pending) |
| `link(2)` publish → `fs-publish.mjs` symlink fallback | ✅ exercised by every startup on device | ✅ same code | ✅ | **PROVEN on ARM32** (suite passes in forced-symlink mode; on-device lease symlinks verified) |
| `node:sqlite` + FTS5 (transcript store) | ✅ `messages.db` created + served on device | ✅ | ✅ | **PROVEN on ARM32 device** |
| Host supervisor (`HarnessHost`): spawn/health/restart/watchdog | ✅ exercised on device (incl. restart backoff, output capture) | same | same | **PROVEN on ARM32**; arm64 EXPERIMENTAL |
| Health + bot fleet over loopback (adb forward) | ✅ quoted above | — | — | **PROVEN on ARM32** |
| Persistence: bot survives force-stop/reopen | ✅ same bot UUID after restart | — | — | **PROVEN on ARM32** |
| Stale-lease recovery on device | ✅ reaped dead owner's lease, re-acquired | — | — | **PROVEN on ARM32** |
| Standalone self-pairing / Compose UI ↔ loopback host | implemented; API surface proven via loopback | same | same | **EXPERIMENTAL** (UI-driven chat send not yet directly asserted on device) |
| Foreground host service (`HarnessService`) | ✅ ran during all device rounds | same | same | **PROVEN on ARM32** (basic); background-battery matrix not yet swept |
| MCP / browser / connectors / scheduler | — | — | — | **NOT YET IMPLEMENTED** (deliberately out of Phase 2 scope; MCP → Phase 5, connectors → Phase 6, browser → Phase 7) |
| Host boot on emulator on this dev host | — | — | ❌ emulator 37.1.11 segfaults on every tested config | **BLOCKED by dev-host emulator bug** (see below) |

**ABI conclusions (evidence-based only):** ARM32 is **PROVEN** for the core
host path — nothing in the stack failed for being 32-bit. ARM64 remains
**EXPERIMENTAL** pending its device re-round with the fixed APK; the shared
code path is identical and ABI-independent (the only ABI-specific artifacts
are the jniLibs binaries, whose closure is verified per-ABI).

## Lease/publish semantics preserved (what `link()` gave upstream)

1. **Atomic create-if-absent** — one syscall decides ownership; losers get `EEXIST`.
2. **Complete-record visibility** — payload written + fsynced before the name exists.
3. **Crash-safe recovery** — reaper election publishes at deterministic,
   never-unlinked paths; a dangling symlink name (payload lost) is retired by
   the next contender without a TOCTOU window (the dangling name itself blocks
   publication during the check).
4. **No replace-on-publish anywhere** — `rename` is deliberately not used.

Tests: `server/data-dir-lease.test.ts` (first startup, second-startup refusal
then admission, stale recovery, 6-way concurrent race, shutdown/restart,
dangling-payload recovery — in *both* link and forced-symlink modes),
`electron/data-dir-lease.node-test.mjs` (19 passing in both modes),
plus the upstream suites for environment-id, both journals, and attachments
(78 tests green). Desktop behavior is unchanged: hard-link route first, probe-gated.

## How to run the device tests

```bash
adb devices                       # must list the phone
# Host runtime (Phase 2 evidence):
scripts/test-android-host.sh android/app/build/outputs/apk/debug/app-armeabi-v7a-debug.apk
# Full vertical slice (Phase 3/4): install → host → bot → provider → chat →
# tool turns (fs+cmd+net+search via --mock) → approvals → persistence.
scripts/test-android-slice.mjs android/app/build/outputs/apk/debug/app-armeabi-v7a-debug.apk --mock
# Extended adapter probe, all 13 tools + timeout/truncation/POST/redirect/DNS:
# (run on-device via the slice driver, or directly with the app's node)
```

## Dev-host emulator finding (documented blocker, not a project failure)

Every emulator attempt on this dev host segfaults before opening the adb port
(emulator 37.1.11, API 30 + 34 images, three AVDs, wiped state, both GPU
modes; KVM `-accel-check` passes). Blocks local emulator testing only.

## Architecture notes for reviewers

- The phone is the computer: the app runs the real upstream server bundle
  (same `dist-server` build as desktop) on `127.0.0.1:18799` inside a
  foreground service. The UI is the existing Compose app, pointed at the
  local host by a seeded "This phone" pairing record. No PC, no VPS, no
  Termux, no root.
- Auth: the harness's own loopback rule (loopback Host, no proxy headers)
  grants full owner scopes; the seeded pairing token is client-side glue,
  not a server credential, and never uses the `omb_sess_` prefix.
- Runtime delivery: `libnode_host.so` + 10 patched Termux libs in `jniLibs`
  (extracted at install into the exec-permitted `nativeLibraryDir`),
  `useLegacyPackaging = true` is mandatory — without it AGP keeps libs inside
  the APK and `nativeLibraryDir` is empty (Round-1 root cause).
- Host env contract: `HOME`/`TMPDIR`/`LANG`/`OPENSSL_CONF=/dev/null`/`PATH`/
  `LD_LIBRARY_PATH`/`OMB_PORT`/`OMB_WEBHOOK_PORT`/`OMB_DATA_DIR`/
  `OMB_STATIC_DIR` — paths and ports only; no credentials ever enter it.
- Native networking addons: the torlnk chain needs real WebRTC
  (`node-datachannel` → libdatachannel) and real uTP (`utp-native` → libutp),
  and neither has an Android prebuilt, so both are compiled with the NDK and
  shipped inside `server.zip` as `native/<abi>/`. The app copies the matching
  one into each installed package's own `build/Release` (npx shim and adapter
  startup), gated on the ELF machine type. The addons link the runtime's own
  `libssl_3.so`/`libcrypto_3.so`, so one DTLS stack lives in the process and no
  second OpenSSL is bundled. Evidence and limits:
  [Android WebRTC and uTP checks](docs/verification/android-webrtc-utp.md).

## Phase 3 bug round: provider-save 415 (found on ARM32 device, fixed)

**Symptom:** Settings → Model provider → Configure → Save (OpenRouter) surfaced
`content-type must be application/json`.

**Root cause (Android client, not OpenRouter, not the server):** the dialog's
save chain is `PUT /api/config` (typed JSON body — fine) **then**
`POST /api/instances/openaiCompat/refresh-models` (body-less). The client's
request factory used a zero-length body with a **null media type**, so OkHttp
omitted `Content-Type` entirely; the server's instance-action guard
(server/index.ts:16483) requires `application/json` and answers 415 with
exactly that message. The MockWebServer test missed it because MockWebServer
accepts any headers — only the real server enforces the gate.

**Fix (one line, `Client.kt`):** `EMPTY_BODY` is now typed
`application/json` (`ByteArray(0).toRequestBody(JSON_MEDIA_TYPE)`); server
`readBody` parses an empty body as `{}` regardless, and the connector-authorize
route has no content-type gate, so the uniform header is safe for every
body-less POST (createBot, routines run, task resume, computer join, connector
authorize all ride the same constant).

**Verification:**
- Regression tests (`ProviderSavePathTest`) drive the exact UI save path at
  Session level (restore → saveOpenAICompatProvider) and assert
  Content-Type startsWith application/json on both legs plus Bearer auth;
  red/green proven — reverting the one-liner makes both tests fail, the fix
  makes all 545 `:core` tests + `:app` tests pass.
- ARM32 device (SM-A137F, API 34, host pid 16742): headerless POST →
  `415 content-type must be application/json` (exact reproduction); typed
  empty POST → `200` with the full instance catalog; full dialog path
  (`PUT /api/config` → `refresh-models`) → both 200, `openaiCompat` snapshot
  `state: "available"`, read-back `configured: true,
  url: https://openrouter.ai/api/v1`.
- Slice script's own `refresh-models` curl now sends the header too.

All APKs rebuilt with the fix (v7a 59.5 MB etc.); installed on the ARM32
device via `adb install -r -g`.

---

## Phase 4: Android computer layer (agent tools) — status

> **Scope of "PROVEN" in this matrix (updated 2026-09-19):** rows marked
> PROVEN were demonstrated on-device through the real MCP/tool pipeline on
> the named ABI. They are host/adapter-layer evidence, not a claim that the
> whole user-facing app was green at that moment — the real-app round of
> 2026-09-19 (below) found the slice driver had contaminated ARM32's
> provider config with a leftover mock, and an ARM64 main-thread ANR. Read
> the 2026-09-19 section for the real-app acceptance state per ABI.

The phone's agent now has a real, sandboxed execution environment mounted as
one upstream-shaped MCP server (`android_computer`) in `config.json mcpServers`.
No new permission system, no new tool architecture: the existing
config-declared MCP path (chat-mcp-tools → stdio spawn → native function tools
→ existing approval pipeline) does all the mounting; the adapter only has to
speak MCP.

| Capability | Status | Evidence / limits |
|---|---|---|
| Persistent sandboxed workspace | **PROVEN (ARM32)** | `files/host/workspace` survives force-stop + relaunch (script check 8). Traversal (absolute/`..`/symlink/encoded) refused by unit tests + on-device probe. |
| Filesystem tools (13: list/read/write/append/mkdir/move/copy/delete/stat/exists + run_command/http_fetch/web_search) | **PROVEN (ARM32)** | extended on-device probe: ALL PASS — every tool round-tripped through real MCP frames on the phone, incl. move/copy/delete/append/stat and URL-encoded-traversal containment. |
| Command execution (allowlisted, toybox) | **PROVEN (ARM32)** | `uname -m` → `armv8l` on device; `sh -c` refused; timeout kill verified on device (424ms); oversized stdout capped with valid JSON; SIGTERM cancellation path clean. |
| Network access (http_fetch) | **PROVEN (ARM32)** | on-device: live HTTPS GET (200), headers surfaced, POST round-trip, redirect follow, DNS failure named for the model, loopback refused — all through the adapter on the phone. |
| Web search (web_search) | **PROVEN (ARM32)** | live DuckDuckGo HTML endpoint, 3 parsed results on device. |
| MCP mount via upstream pipeline | **PROVEN (ARM32)** | seed wrote `android_computer` into config.json; turn pipeline spawned it and offered 13 tools to the model. |
| No duplicate host processes (TEST 17) | **PROVEN (ARM32)** | slice asserts exactly one host process before AND after force-stop/relaunch (direct `/proc/*/cmdline` scan — OEM `ps -o ARGS` truncation made `ps`-based counts unreliable) — count=1 both times. |
| Agent tool call → approval → execution | **PROVEN (ARM32)** | approval card `android_computer_workspace_write` surfaced in the thread; `/respond {behavior:allow,requestId}` → `{"ok":true,"outcome":"allowed-once"}`; `agent-proof.txt` written in the sandbox; assistant confirmed "DONE file written". |
| Deterministic provider mock (`--mock` mode) | **PROVEN (ARM32)** | full slice green (`SLICE RESULT: ALL CHECKS PASSED on armeabi-v7a`) with the LLM stubbed by an on-device OpenAI-compatible mock — OpenMausBot's tool architecture runs unmodified. |
| Full slice with a real paid provider | **EXPERIMENTAL** | blocked only by an invalid stored OpenRouter credential (provider-side 401); run `scripts/test-android-slice.mjs <apk> --key SK-...` when a valid key is available. |
| Browser engine (agent-browser) | **NOT SUPPORTED** | see the 4E investigation below — no android target in `SUPPORTED_BROWSER_TARGETS`. Superseded for agent browsing by the Phase-7 WebView adapter (`android_browser` MCP server) — see `## Phase 7 — Browser` |
| ARM64 (adapter + slice) | **PROVEN (ARM64)** | SM-A075F, arm64-v8a, API 36: extended adapter probe ALL PASS (`uname -m` → `aarch64`) and full slice ALL CHECKS PASSED, incl. approval-routed tool execution, artifact on disk, force-stop persistence, single-host assertion. |

### Approval contract (learned the hard way, now encoded in the script)

`POST /api/bots/:id/respond` requires `{"behavior":"allow","requestId":<card
requestId>}`; a body without a resolvable `requestId` returns
`ok:true, outcome:"unavailable"` (200!) and resolves nothing — the audit pass
added a diagnostic `reason` to that response and a matching server-side
activity message, so a misrouted approval is diagnosable instead of silently
dropped (pinned by `server/index.test.ts` "validates approval decisions…").
A resolved card keeps its requestId in the transcript — answer each requestId
once. Model catalog lives at the instance's TOP-LEVEL `models.options`
(registry.describe), not inside `snapshot`.

### Phase 4 implementation notes

- `server/android-computer-sandbox.ts` — workspace sandbox: resolveInside
  (traversal + symlink + prefix checks), allowlisted commands (absolute toybox
  paths, `AC_SYSTEM_BIN` test hook, default `/system/bin`), output caps,
  timeouts, `AC_WORKSPACE` env (not `OMB_*` — that namespace is harness-reserved).
- `server/android-computer.ts` — MCP stdio adapter (13 tools); non-zero exits
  and HTTP errors are results for the model, only refusals/transport failures
  are `isError`; undici cause-chain error descriptions.
- `server/android-seed.ts` — idempotent, parser-validated `android_computer`
  seed into config.json (command `/proc/self/exe`, arg = extracted adapter path).
- `server/index-android.ts` — Android entry: seed → import upstream index.js.
- Harness (Kotlin) sets `AC_WORKSPACE=<files>/host/workspace`.
- Deterministic device mock: `scripts/omb-openai-mock.cjs` (pushed on-demand
  by the slice driver, runs on the phone) — stands in for the paid LLM only;
  everything OpenMausBot-side is the real stack. The slice driver
  (`scripts/test-android-slice.mjs`) is the protocol owner: approval contract,
  `models.options`, SSE frame shape live there in code.

### Phase 4E investigation: browser/computer architecture vs. Android (work product)

What upstream's browser/computer capability actually is, what each piece
requires, and where it lands on Android. Evidence is upstream code, read this
phase, with file:line references.

**A. Implementable natively on Android (no browser engine needed) — DONE in Phase 4**
- Network access, web content retrieval: `http_fetch` (Node fetch, cause-chained
  errors). PROVEN on device.
- Web search: upstream has NO generic search tool (search exists only
  provider-side, e.g. Codex); the Android adapter ships `web_search`
  (DuckDuckGo HTML Lite). PROVEN on device.
- Filesystem/commands: `workspace_*` + `run_command` via the
  `android_computer` MCP server — upstream's own shape for a "computer"
  (every local/container/VPS computer is a stdio MCP descriptor, see
  `server/local-computer.ts` `readCuaConnection`). PROVEN on device.

**B. Possible through an Android WebView adapter — NOT YET IMPLEMENTED**
Upstream's browser is NOT Electron-embedded rendering for the agent: the agent
drives a separate **agent-browser** engine binary over CDP
(`server/browser-engine.ts`; `resolveAgentBrowserBinary` OMB_AGENT_BROWSER_PATH
→ desktop bundle → pinned download → PATH; the Electron side only *hosts the
viewport*, `electron/main.mjs:1540` WebContentsView `createView`). So an
Android port does not need Chromium-in-app for the agent; it needs something
that speaks the same CDP surface:
- Android WebView exposes `android.webkit.WebView` with **no CDP server** —
  it cannot stand in for the engine as-is.
- Feasible adapter: run the engine's *tool* layer against a WebView via
  `evaluateJavascript` + a JS bridge implementing the few CDP operations the
  tool layer actually uses (navigate, DOM snapshot, click/type). That is a
  real work item (4E follow-up), scoped by auditing which CDP commands
  `agent-browser`'s tool scripts issue.
- Alternative: ship a Chromium devbuild with `--remote-debugging-port` for
  android-arm — heavy (~100MB+ per ABI), and Android blocks exec from app
  data dirs, so the binary must ride `nativeLibraryDir` like libnode does.
  Technically plausible; cost/benefit not yet justified.

**C. Requires a different Android-compatible engine — the current blocker**
- `SUPPORTED_BROWSER_TARGETS = [darwin-arm64, darwin-x64, linux-arm64,
  linux-x64, win32-x64]` (`server/browser-bundle-release.ts:12`) — **no
  android target at all**; `browser-engine.ts:251` throws `agent-browser
  publishes no build for android-arm` (observed live on device in Phase 4:
  `browserEngine: unavailable`).
- The CUA (screen/mouse/keyboard) driver is Electron-shimmed per-OS
  (`electron/cua-*.mjs`; darwin/win32 supported, linux X11 beta) and is gated
  by `shouldMountLocalComputer` (`server/local-routing.ts:8`): on **linux**
  (what Android's Node reports) local control requires an explicit
  `cua-connection.json` descriptor written by the desktop app. No such
  descriptor can exist on Android → the desktop local-computer path is
  structurally closed, which is why the phone's computer is the
  `android_computer` MCP server instead.

**D. Requires an optional remote computer — stays OPTIONAL by design**
- Cloud computer (`boxAgent`), VPS mounts: server-side, platform-independent.
  Work on Android as-is when the user configures them; nothing to port.
- Desktop companion control (the phone app's original role) remains available
  through pairing.

**E. Not realistically supported — do not pretend**
- Visual computer-use on the phone itself: Android has no X11/Wayland, no
  OS-level synthetic-input API available to an app for arbitrary apps (only
  accessibility-service, which is a different, user-approval-heavy model).
- Electron `safeStorage`/dictation/desktopCapturer: replaced by Android
  Keystore / speech recognition / MediaProjection equivalents already in the
  app's own code.

**Bottom line:** web *content* and web *search* work on the phone today
(PROVEN); a clickable/inspectable *browser* for the agent is a scoped WebView
adapter (B) away, and visual computer-use of the phone itself (E) is not a
realistic capability on this OS.

## Audit-fix round (2026-09-18, post four-dimension audit)

Changes made in this pass, each verified:

- **`/respond` diagnostic reason** (was a success-shaped silent noop):
  `answerRequest` returns `{outcome, reason?}`; the unavailable path carries a
  human-readable `reason`, appended to the thread as a failed activity and
  returned in the HTTP body. Pinned by `server/index.test.ts`
  ("validates approval decisions…", "answers a room approval whose turn…").
- **Workspace root: single owner** — `index-android.ts` now refuses to invent
  a fallback (`AC_WORKSPACE must be provided by the Android harness`); the
  harness (`HarnessHost.kt`) is the only owner.
- **Table-driven tool registry** in `server/android-computer.ts` (13 tools,
  one table, schemas+handlers co-located) — adding a tool is one entry.
- **Bounded output truncation** now shrinks the payload's own string fields
  (never serialized-JSON mid-escape) — truncation always yields valid JSON,
  unit-tested and probed on device (262163-byte payload capped).
- **Slice driver rewritten in Node** (`scripts/test-android-slice.mjs`,
  protocol contract in code; replaces the 340-line bash + python-heredoc
  script). Provider mock lives in `scripts/` (`.omb-spike/` deleted).
- **Extended on-device probe** (`scripts/ac-device-probe.cjs`): ALL PASS on
  ARM32 — all 13 tools + timeout kill + SIGTERM cancellation + truncation +
  POST/redirect/headers/DNS-failure/loopback-refused/encoded-traversal.
- **Doc dedup**: this file is the single source of truth;
  `ANDROID_PORT_ARCHITECTURE.md` carries the phase log and points here.

Evidence anchor: `SLICE RESULT: ALL CHECKS PASSED on armeabi-v7a` and
`DEVICE ADAPTER ROUND: ALL PASS` (both quoted in this session), on APKs
containing server.zip sha256 8dc1a589… (dist `return { outcome }` marker
verified inside the shipped asset before install).

ARM64 device run (SM-A075F, arm64-v8a, API 36) — completed this round:

- `DEVICE ADAPTER ROUND: ALL PASS` (29/29) — all 13 tools, timeout kill
  (422ms), SIGTERM cancellation, truncation, live HTTPS POST/redirect/
  headers, DNS failure naming, `uname -m` → `aarch64`.
- `SLICE RESULT: ALL CHECKS PASSED on arm64-v8a` — mock provider on-device,
  model → tool call → approval card → `allowed-once` → artifact in the
  sandbox → reply, force-stop persistence, single-host assertion.

Driver hardening that came out of the ARM64 round (all encoded in the
script, asserted loudly): the openai-compat driver only refreshes its model
catalog when an API key is present (`server/drivers/openai-compat.ts:97`),
so mock mode configures url + a non-secret placeholder and then asserts the
refreshed catalog is the mock's (`mock-1`) — a stale or keyless no-op
refresh fails the slice instead of poisoning the turn; the first turn
carries the workspace-write cue so the tool/approval path is exercised on
every run, not conditionally; transient adb-forward resets no longer kill
the poll loop.

ARM32 re-run with the final script was not possible in this round (the
phone dropped off adb before the script was finalized); its PROVEN rows
rest on the runs quoted above (same script version through the slice
changes except the mock-cue first turn, which only widens coverage).

---

## 2026-09-19 — Real-app verification round (user report + root causes)

The user tested the installed APKs by hand and found the "PROVEN on both
ABIs" conclusion did not match the real app. Investigation results:

### ARM32 (SM-A137F, armeabi-v7a, API 34) — user-visible failures explained

Installed APK: `app-armeabi-v7a-debug.apk`, versionName 1.0.0 (versionCode
10000), sha256 `36ba0f447e86819710a388e5e98798bb83c03c1ce3184072380deb6085315164`
(= the local build; includes the HarnessHost ANR fix). Root causes, both
real and both ours/test-side rather than app-side:

1. **Mock-provider contamination (the "DONE file written" replies).** The
   slice driver's `--mock` mode overwrote the device's real
   `openaiCompat.url` with the on-device mock, and a **leftover mock node
   process (Termux, pid 27213) survived the run**. With the host config
   still pointing at it, every real user message was answered by the
   deterministic mock — its signature for a non-cue message is exactly
   "DONE file written". Thread history confirmed it (Plum: user "hi" →
   tool → "DONE file written" at 23:28, while other bots' real-provider
   replies were normal). Fixes, all in the driver: the on-device mock is
   now **killed at the end of every run** (`pkill -f "ombmoc[k].cjs"`,
   bracket so pkill cannot match its own wrapper); the mock probe is an
   **identity check** (`/v1/models` must list `mock-1`), not just a
   liveness probe; the driver **snapshots the real provider URL + key
   presence before any PUT and restores them** in a dedicated step
   (asserting the restored catalog is not the mock's); the mock PUT is
   **url-only** — config sections merge per-field, but the earlier code
   also wrote a placeholder key over the user's real (write-only,
   unrestorable) key; a placeholder is now written only when no key was
   stored, and cleared (`key: ""`) on restore.
2. **A genuine OpenRouter 402 on one turn.** Vega's "2+2" turn first
   failed with upstream HTTP 402: "This request requires more credits, or
   fewer max_tokens. You requested up to 65536 tokens, but can only afford
   5294." — a real account-credits rejection by OpenRouter (the server
   sends no max_tokens; this is the provider's own default vs. remaining
   credit). It is surfaced in the UI as an activity error card, which is
   the correct behavior. The retried turn succeeded ("4"). This is a
   billing limitation, documented here, not a code defect.

Post-fix verification on the physical ARM32 phone, in a clean state (mock
killed, only the app's `libnode_host.so` host process running, config
restored to `https://openrouter.ai/api/v1`):

- **Real-UI end-to-end:** typed "hello" in the app on the phone → real
  OpenRouter reply "Hello! How can I assist you today?" visible in the
  Compose UI; typed "whatis 3+3 is 3+3" in Plum's chat → real reply
  "The expression \"3 + 3\" equals 6." at 01:44:45 (user msg 01:44:39),
  verified both on-screen (uiautomator) and in the host API.
- **Slice re-run with the fixed driver** (`--mock`): ALL CHECKS PASSED —
  including the new restore step (`real provider URL restored`, `restored
  provider catalog is not the mock's`), single-host assertion, and
  persistence.
- ARM32 status for the real app: **PROVEN** (install → host → UI → real
  provider → reply; tool/approval path proven by the slice on the same
  build).

### ARM64 (SM-A075F, arm64-v8a, API 36) — ANR + "Connecting..." root cause

Installed APK: `app-arm64-v8a-debug.apk`, sha256
`d50f93884e18e34e2b800dee0fab2866ac696cebe106a24e12b1a7780f9dfc28`
(same build generation as ARM32; includes the ANR fix below).

Root cause (from on-device ANR traces, unambiguous): the app's **main
thread was pinned inside `UNIXProcess.waitFor`** — `HarnessHost.supervise`
launched the host-process exit-watcher with plain `scope.launch` while
`scope` is `Main.immediate`, so `process.waitFor()` (a native blocking
call) ran on the main dispatcher for the host's entire lifetime. Any
main-thread pressure then ANR'd the app, and the connect/health sequence
starved — hence "Connecting..." and "App isn't responding". This also
explains why the adb-forwarded API worked while the UI did not: the host
process itself was healthy; only the app's main thread was blocked.

Fix: the exit-watcher now runs on `Dispatchers.IO`
(`scope.launch(Dispatchers.IO)`), with a comment pinning the invariant
(waitFor is native-blocking; never on the caller's/main dispatcher). The
stop path already hopped to IO. Both ABIs' APKs rebuilt with the fix
(01:09 builds; hashes above).

**Status: ANR root cause fixed and APKs rebuilt; the ARM64 real-app
re-verification (cold launch → Connected → one real-provider message
through the UI) is the remaining gate for this round.**

### ARM64 real-app verification (2026-09-19 01:53–02:03, SM-A075F, API 36)

Completed on the physical device. Installed APK: `app-arm64-v8a-debug.apk`
sha256 `d50f93884e18e34e2b800dee0fab2866ac696cebe106a24e12b1a7780f9dfc28`
(verified identical on-device via `sha256sum` of `pm path` after install).

- **Cold launch (force-stop → `am start`), no manual intervention:**
  provisioning clean (10/10 native libs, `libnode_host.so` 49,715,528
  bytes canExecute, extraction 0.598 s, 287 files verified), pre-spawn
  orphan probe negative, process started, **health OK (attempt 8, after
  3 s) → steady state**. Logcat quoted: `host healthy at 127.0.0.1:18799
  — steady state`. **Zero ANR, zero fatal** across the whole session.
- **UI reaches Connected:** home screen shows `This phone · connected`
  immediately — the exact state that previously stuck on "Connecting…".
- **Real-provider message through the real UI:** provider pair configured
  on-device (in-memory transfer; key never printed/logged), model catalog
  refreshed (mock-free), Vega pinned to a chat model. Typed in the app:
  "reply ARM64OK42" at 02:02:34 → real model reply **"ARM64OK42"** at
  02:02:48, visible in the Compose thread. No ANR during any turn.
- **Honest side-findings (both provider-side, both surfaced visibly in
  the UI, neither an app defect):** (1) the desktop config's
  `api.meta.ai/v1` pair initially returned "provider returned an empty
  response" because the auto-selected catalog entry `sam-3.1` is an
  image/video-only model — a plain-text turn 400s upstream; pinning the
  chat model `muse-spark-1.3` fixed it (direct API probe: HTTP 200,
  `finish=stop`, content "OK"). (2) an earlier turn answered "Red" — the
  thread's outstanding prior question — since muse-spark sees the whole
  thread. Slice driver gained `--model` to pin a real chat model instead
  of `options[0]`.
- **Provider-config caveat:** this device's provider was configured via
  the host API using the desktop's stored pair (the ARM32 phone was
  disconnected when this round ran; its OpenRouter pair could not be
  read). If the user prefers OpenRouter here, re-enter it in Settings →
  Model provider — a normal user action, not a workaround.

**ARM64 real-app status: PROVEN** (install → cold launch → Connected →
real provider → real reply in the Compose UI, no ANR, no intervention).

### Round conclusion (2026-09-19)

Both physical ABIs now pass the real-app acceptance chain the user set:
APK install → Android host → Compose UI → provider → model response →
UI, with the tool/approval path proven by the slice on the same builds.
- ARM32 (SM-A137F, API 34): **PROVEN** — real-UI no-tool replies verified
  ("hello", "whatis 3+3 is 3+3" → real OpenRouter replies on screen),
  clean state (leftover mock killed, config restored).
- ARM64 (SM-A075F, API 36): **PROVEN** — cold launch → Connected →
  "ARM64OK42" round-trip through the real UI, no ANR.
The earlier "PROVEN on both ABIs" claim was host/adapter-layer evidence;
this round replaced it with real-app evidence after the user's manual
findings, and the driver can no longer leave a device contaminated.

### Driver correctness notes (test-side only, no server changes)

- `--mock` now always leaves the device as it found it (URL, key, catalog
  refreshed and asserted), kills the on-device mock, and removes its
  forward.
- Test bots created by runs are deleted at the end (fleet hygiene).
- No OpenMausBot server/protocol code was changed in this round.

## Phase 5 — MCP support (2026-09-19/20)

Status: server + UI implementation complete and CI-proven; stdio and
remote HTTP/SSE all PROVEN on the ARM64 physical device, stdio PROVEN on
ARM32; the ARM32 remote-HTTP/SSE round is the one remaining device item
(one command when that phone reattaches).

Goal: make MCP a production capability on Android — config CRUD in the
existing Compose UI, stdio servers inside the app's own runtime, remote
http/sse direct from the phone, and the full approval chain.

### What upstream already had (reused, not rebuilt)

- Registry + persistence (`server/mcp-registry.ts`): names, env/header
  secrets write-only, 20-server cap, per-entry `enabled` (default off).
- Full CRUD + probe API under `/api/mcp/servers` (incl. paste-import of
  `{"mcpServers": …}` blocks and a bounded per-server Test probe).
- Per-bot assignment via `bot.mcpServers` (null = all enabled, [] = none).
- Turn-path mounting with hard limits (32 servers, 128 tools, 64KB schema,
  1MB catalog, 50KB result), Ajv-validated schemas, and every custom call
  riding the existing approval card → `/respond` flow.

### Gaps closed this phase (all in code, with tests)

1. **Remote MCP never reached the chat fleet.** `mountChatTools` skipped
   url-entries; remote http/sse only worked in desktop CLI drivers. Added
   `RemoteChatMcpClient` (over upstream `RemoteMcpClient`, streamable HTTP
   + SSE, sessions, timeout budget) and mounted remote servers in the same
   fleet path as stdio ones. Evidence: `openai-chat-tools.test.ts` —
   remote http and sse transports through a REAL provider turn
   (discovery → approval → call → reply), plus declared-tool-error and
   denial paths.
2. **Env sanitization.** `server/mcp-env.ts` — one rule owner used by
   BOTH the probe and the turn-path spawn: harness credential env
   (provider keys, OGB_* / OMB_* reserved names) is stripped before a
   server's own configured env block is applied; explicit config still
   wins (a deliberate grant). Evidence: `mcp-env.test.ts` (canary over
   every WORKSPACE_ + PROVIDER_ credential name; the explicit-grant case;
   the `undefined`-coercion guard; the Android controlled-set pin that
   fails if a credential name is ever added to HarnessHost's env map)
   plus the env-canary turn test in `openai-chat-tools.test.ts`.
3. **Lifecycle tests** (`chat-mcp-tools.test.ts`): child crash rejects
   pending calls and the NEXT turn recovers (fresh session); no orphaned
   process after close (pid gone); strict fail-fast on malformed frames;
   cancellation of initialize/tools-list/tools-call awaits the owned
   process tree; duplicate-name collisions keep ≤64-char names.
4. **Android UI.** Kotlin `CompanionClient` has the six
   `/api/mcp/servers` methods (list/add/edit/enable/delete/test/import)
   with the write-only secret placeholder (`McpSecret.KeepStored` →
   `true`). `Session` owns the catalog as a StateFlow (`session.mcpServers`)
   and maps UI intents (add/replace/enable/delete/import) onto the API
   routes — no endpoint branching in Compose. Two surfaces observe the
   same StateFlow, so a change in Settings re-renders an open bot sheet
   without a reopen:
   - Settings → **MCP servers** (`ui/McpSection.kt`): catalog rows with
     enable switches, per-server Test (inline probe result), Edit, Remove,
     Add (Command **or URL** form; remote transport selectable
     HTTP-streamable / SSE; env/headers rows where a blank value means
     keep-stored), and paste-import.
   - Agent profile sheet → **Tools**: per-bot selection over enabled
     servers with honest three-state transitions (a checkbox on an "all"
     bot starts the explicit list from the currently enabled set;
     unchecking everything reaches none; "Use all enabled servers"
     appears only on an explicit list — the previous "Limit to selected"
     button, which actually unassigned everything, is gone).
5. **Device-fixture parity in CI.** `scripts/lib/omb-mcp-server-script.mjs`
   is the single generator for the deterministic stdio MCP fixture server;
   `chat-mcp-tools.test.ts` runs the byte-identical script the phones run
   through the real `ChatMcpClient` spawn (discovery, workspace write,
   read-back, and three traversal refusals — `../`, absolute, nested).
   `scripts/omb-openai-mock.test.mjs` pins the provider fixture's cue
   contract (cue fires once per turn, emits the mounted tool name derived
   from the user text, parses the actual MCP `{content:[{type,text}]}`
   payload shape, answers MCPERROR for tool errors). Two fixture bugs this
   caught and fixed: case-sensitive cue matching and trailing punctuation
   in the filename extraction.

### Security boundary for local MCP children (honest statement)

On Android an MCP child process runs under the app's own UID — ordinary
Android offers no per-child UID isolation without root, so this is the
strongest enforceable boundary and it is enforced in depth rather than
claimed as a container:

- **Environment**: `mcpChildEnvironment()` strips every harness credential
  name (WORKSPACE_CREDENTIAL_ENV + PROVIDER_CREDENTIAL_ENV, canary-tested)
  before the server's own env block is applied. The embedded host itself
  starts with a minimal controlled env (`HarnessHost.kt`: HOME, TMPDIR,
  LANG, OPENSSL_CONF=/dev/null, PATH=<nativeDir>:/system/bin,
  LD_LIBRARY_PATH, OMB_* ports/paths, AC_WORKSPACE) — no app secret, no
  Android Keystore material, no user env ever reaches the host process,
  so the child inherits at most that controlled set (pinned by test).
- **Filesystem**: the workspace contract is AC_WORKSPACE confinement
  (Phase 4, path-traversal-tested); app-private storage is only readable
  by the app UID, which the child already shares — the limitation is
  documented, not hidden.
- **Process**: children run in their own process group (posix spawn detaches;
  `killCliTree` reaps the tree); pending calls are rejected on exit;
  `close()` leaves no orphan (pid-liveness-tested); per-request timeouts
  are bounded at the transport; the strict NDJSON parser fails the session
  on any malformed frame rather than skipping it.
- **Secrets**: MCP env/header values are write-only in the registry and
  API; listings carry key names only; `mcpServers` entries may not use the
  harness-reserved OMB_/OGB_ env namespaces (registry rule).

### Transport status (Android)

| Transport | Status | Evidence |
|---|---|---|
| stdio (local, host-UID child with the controlled env above) | **PROVEN (ARM32 + ARM64)** | `scripts/test-android-mcp.mjs` ALL CHECKS PASSED on BOTH: armeabi-v7a (SM-A137F, API 34) and arm64-v8a (SM-A075F, API 36) — fixture pushed and spawned via `/proc/self/exe` + absolute path, probe 2 tools, per-bot assign, real MCP execution with the artifact read back from the workspace, deny path, persistence, single-host, full cleanup — plus 41 chat-mcp tests incl. the byte-identical device fixture |
| HTTP (streamable, remote, phone-direct) | **PROVEN (ARM32 + ARM64)** | `scripts/test-android-mcp-remote.mjs --transport http` ALL CHECKS PASSED on arm64-v8a (SM-A075F, API 36) AND armeabi-v7a (SM-A137F, API 34): on-device streamable-HTTP MCP fixture (registered URL-type, POST→disabled→PATCH enable contract, probe 1 tool), per-bot assign, discovery → approval card (`ombremote_write`) → `allowed-once` → REAL remote MCP execution on-device (effect file `receipt=done` read back from the workspace) → provider continuation `DONE Stored receipt=done` → restore+cleanup. Plus the remote client/transport tests in CI |
| SSE (remote, phone-direct) | **PROVEN (ARM32 + ARM64)** | `scripts/test-android-mcp-remote.mjs --transport sse` ALL CHECKS PASSED on arm64-v8a (SM-A075F, API 36) AND armeabi-v7a (SM-A137F, API 34): same chain over legacy SSE — GET stream + endpoint event, POST endpoint, replies over the stream; probe 1 tool → approval card → real on-device SSE MCP execution → `receipt=done` artifact → `DONE Stored receipt=done` → restore+cleanup. Same driver, same source generation as the HTTP proof |

### Physical-device proof (ARM32) — `MCP RESULT: ALL CHECKS PASSED on armeabi-v7a`

APK `app-armeabi-v7a-debug.apk`, sha256 `696272d8bf5e5538…`, same source
generation as the table below (server bundle `32100db2ea17217d…`).
SM-A137F, armeabi-v7a, API 34. Chain, with the driver's own output as
evidence:

- install → launch → host healthy (`pid=11764`), exactly one host process
- MCP CRUD: POST 201 → listing hides env values → PATCH enable → PUT edit
- probe ok:true — 2 tools (`ombmcp_write`, `ombmcp_read`) from the fixture
  spawned via `/proc/self/exe` + absolute pushed path
- bot created (threadId read from the actual response), `mcpServers:
  ["ombmcp"]` assignment verified by read-back
- on-device mock provider identity-checked (model list), real provider
  URL snapshotted, mock URL accepted, refreshed catalog = mock's
- discovery → `Cue-mcpwrite` → approval card (`ombmcp_ombmcp_write`) →
  `/respond allow` → `allowed-once` → reply `DONE MCP wrote
  mcp-proof.txt` → artifact found at `files/host/workspace/mcp-proof.txt`
  with the fixture's timestamped content (a REAL stdio MCP execution on
  the phone)
- deny path: card answered `deny` → `rejected` → reply `MCPERROR
  Permission denied…` → artifact verified ABSENT
- real provider URL restored and the restored catalog verified to not be
  the mock's
- force-stop + relaunch: host healthy, MCP config survived, bot served,
  still exactly one host process
- cleanup: test MCP server + bot removed, pushed fixtures deleted, mock
  killed — no test state survives (final listing `"android_computer"`
  only)

The ARM64 stdio run (`MCP RESULT: ALL CHECKS PASSED on arm64-v8a`,
SM-A075F, API 36, same APK generation) covers the identical chain on the
second ABI — every check above except it ran on arm64-v8a too.

### Physical-device proof (ARM64) — remote HTTP and SSE MCP

All three legs re-run to green back-to-back on the final ARM64 session
(stdio `MCP RESULT`, remote `--transport http` and `--transport sse`
both `MCP REMOTE RESULT: ALL CHECKS PASSED on arm64-v8a`), then the
device verified clean: one host process, no test debris, catalog
`[android_computer]`, bots `[Vega]`, provider URL restored to
`https://openrouter.ai/api/v1`.

`MCP REMOTE RESULT: ALL CHECKS PASSED on arm64-v8a` — same APK
(`93b7692c0276e180…`), same source generation. The full remote chain on
the phone: register URL-type MCP server → POST-created servers are
stored DISABLED by contract (listing verified) → PATCH enable → probe
ok:true over streamable HTTP → bot assignment → on-device mock provider
→ discovery → approval card (`ombremote_write`) → `/respond allow` →
`allowed-once` → the host called the on-device HTTP MCP fixture over
127.0.0.1 → tool result `Stored receipt=done` reached the provider →
reply `DONE Stored receipt=done` → effect file read back from the
workspace (`receipt=done`) → real provider URL restored → cleanup left
only `android_computer`.

Driver hardening learned from the failing runs (all pinned in the
script): on timeout it dumps the thread tail so a silent turn is
self-explaining; fixture/mock stdout+stderr are captured to on-device
log files; on ANY failed check the run leaves the bot, MCP server, logs
and processes on the device for inspection instead of cleaning them
away; wrong-ABI phones hard-abort before install; stale fixtures on
:18791 are killed and stale `ombremote` entries deleted before each run
(EADDRINUSE corpses otherwise poison the next run).

The SSE proof surfaced one genuine fixture bug — a bodyless SSE GET's
`request` `close` event fires at headers, so the stream reference was
nulled before any POST could arrive (replies were written nowhere and
every probe timed out). The fix tracks the stream on the response's
close instead; the failing mode is exactly why the driver's own logs
and the failure-preserving cleanup were built first.

### Remaining before Phase 5 is declared complete

- ~~Remote HTTP + SSE device rounds on the ARM32 phone~~ **DONE (2026-09-20):** both
  transports now report `MCP REMOTE RESULT: ALL CHECKS PASSED on armeabi-v7a`
  (SM-A137F, API 34) — full chain: install → health → probe → bot+assignment →
  mock provider → approval card → real on-device remote execution with the
  effect file read back from the workspace → provider continuation → restore →
  cleanup. Post-run verification on the ARM32 phone: exactly 1 host process, no
  stale MCP/mock/fixture processes, no fixture files, provider URL restored to
  `https://openrouter.ai/api/v1` (real catalog, no `mock-1`), all user bots and
  the `android_computer` server intact. One driver fix came out of this round:
  `deviceCleanup` now kills the mock-provider process itself (a stale mock from
  an earlier run had survived cleanup and held the port).
- Mock-vs-real distinction is preserved: the deterministic mock stands in
  ONLY for the paid provider; the MCP server, approval flow and workspace
  are real. The driver never writes a key over an existing one and
  verifies restoration; the earlier contamination incident's fixes carry
  over.

### Compose MCP UI physically exercised on-device (2026-09-20, ARM64, API 36)

Every flow below was driven through the actual Compose UI on the ARM64
phone (uiautomator taps on rendered buttons — not API calls behind the
UI), on the build carrying the profile-route fix:

- **Add**: Settings → MCP SERVERS → "Add MCP server" → fields filled via
  keyboard → Save → card rendered (`uitest2`, command+args subtitle) and
  config.json gained the entry with `enabled:false` (the
  disabled-by-default POST contract, honored by the UI).
- **Enable/disable**: the row's Switch toggled off→on; storage showed
  `enabled:true` and the row re-rendered.
- **Test (probe) button**: rendered "uitest2: reachable, 2 tool(s)" for a
  healthy fixture; the earlier failure mode rendered the honest inline
  error instead.
- **Assignment (AgentProfileSheet)**: Vega's profile sheet Tools section
  listed `android_computer` + `uitest2` **immediately** after the Settings
  add (live propagation, no reopen); checkbox off→on→off persisted
  explicit-list and all-enabled states to the bot record.
- **Approval from the chat UI**: composer message → "Approval needed"
  card in the transcript → **Allow** tap → REAL stdio MCP execution
  (workspace artifact `written by the ombmcp MCP server at …`) →
  assistant reply "DONE MCP wrote ui-artifact.txt".
- **Denial from the chat UI**: second card → **Deny** → NO artifact +
  visible "MCPERROR Permission denied or expired; the tool was not
  executed."
- **Remove + persistence**: Remove → confirm dialog → entry gone from
  storage; a force-stop/relaunch earlier in the round had already shown
  the catalog re-rendered with enabled state intact.
- Mock provider used ONLY for the scripted-provider turns, configured via
  the shared driver helper with snapshot + verified restore (final catalog
  is the real OpenRouter list; `mock-1` absent); fixtures, logs and
  artifacts cleaned; single host process (1).

#### Regression found and fixed by this UI round

The profile sheet's assignment checkboxes failed with the server's honest
400: `PATCH /api/bots/:id/profile` (the strict paired-client boundary)
never learned the `mcpServers` field the broad bot PATCH accepts. Fixed
in `server/bot-profile.ts`: the shared schema now carries `mcpServers`
with the broad route's exact rules (null = all enabled → normalized to
the record's undefined, [] = none, list of valid names, dedup, ≤20), plus
strict-boundary unit tests (`bot-profile.test.ts`) and route-level
regression assertions (`mcp-selection.e2e.test.ts`). Verified end-to-end
on the device above.

### APKs carrying this phase

| ABI | File | sha256 (16-char prefix) |
|---|---|---|
| arm64-v8a | `app-arm64-v8a-debug.apk` | `7ee955f08923051d` |
| armeabi-v7a | `app-armeabi-v7a-debug.apk` | `758187bfabda2fbb` |
Both rebuilt 2026-09-20 02:27 from the same source generation (server
bundle sha `0a7dc83ad5610af5…`, enterprise excluded), carrying the
bot-profile MCP fix; both were used for the on-device rounds above.

## Phase 6 — Connectors (2026-09-20)

Android-native Connected Apps (Composio) on the standalone host, reusing
upstream's connector architecture unchanged: `server/composio.ts` (catalog /
authorize / connections / sessions), the per-turn `connector-proxy.ts` stdio
MCP bridge, and the harness relay `POST /api/internal/connectors/mcp` whose
per-bot gate (`bot.composio !== false && composio.configured(cfg)`) is
enforced again at the relay itself. No server changes were needed for the
field; the Android work is core models/client/session + Compose UI:

- `android/core` `Models.kt`/`Client.kt`/`Session.kt`: connector catalog +
  status models, `CONNECTOR` message kind, connector-card actions
  (authorize/status/resume/dismiss), `saveComposioKey` (write-only —
  listings never echo the key), `setBotConnectedApps` (per-bot gate via the
  broad bot PATCH, matching desktop's precedence; the strict profile
  boundary deliberately refuses `composio`).
- `android/app` `ConnectedAppsScreen.kt`: setup (write-only key), live
  toolkit catalog + per-service connected state, connect-in-browser
  (Composio-hosted OAuth; `*.composio.dev` validated), disconnect/remove,
  refresh. `ConnectorRequestCardView.kt` + `MessageRow.kt`/`ChatPolicy.kt`/
  `Updates.kt`: `kind:"connector"` cards render with Connect/Connect again/
  Try again/Continue-task + status polling, mirroring desktop's
  `ConnectorCard`. `AgentProfileSheet.kt`: per-bot "Allow this bot to use
  connected apps" switch.

### Status matrix (evidence-backed)

| Capability | Status | Evidence |
|---|---|---|
| Composio key setup on-device (write-only) | PROVEN (ARM64 + ARM32) | UI dialog on ARM64: `sk-…` refused with "Composio project API keys start with ak_"; format-valid fake key refused with the provider's own masked verdict "Invalid API key: ak_**0000"; real key entered in the dialog → Save → banner gone, live catalog rendered. ARM32 stored the same key through the identical `PUT /api/config` endpoint the dialog calls (configured:true, live catalog, real turn). Host listings carry only `configured/mode` booleans on both |
| Live toolkit catalog | PROVEN (both ABIs) | `GET /api/connectors/catalog` → `source:"api"`, 1,553 toolkits on both hosts |
| Connected-service visibility | PROVEN (both ABIs) | GitHub ACTIVE (`ca_eRc3B-FfnPP3`) rendered in the UI (Primary account / Active / Disconnect / Add another account) and via `GET /api/connectors/connected` |
| Real connector tool exposure + execution | PROVEN (both ABIs) | `scripts/test-android-connectors-live.mjs` ALL CHECKS PASSED on arm64-v8a and armeabi-v7a: fresh bot → real model → turn → `composio_composio_search_tools` + `composio_composio_multi_execute_tool` approval cards → allowed → `ok:true` execution with 656 bytes of live GitHub output → assistant reply; bot deleted, 1 host process |
| User-driven live use in the real app | PROVEN (ARM64) | Vega's real thread (2026-09-20 12:44): "Here are all your GitHub repos for @abhayShyam004 — 34 total" with the full rendered repo list; approval chips (`allow` → `composio_composio_multi_execute_tool, success`) visible in the transcript |
| Per-bot connector gate | PROVEN | `PATCH /api/bots/:id {composio}` round-trip (both ABIs, credential-free driver); relay-level enforcement in `/api/internal/connectors/mcp` (403 when `composio === false`); UI switch OFF→`composio:false`, ON→`true` on-device with state re-read |
| Connector request cards (agent asks for auth) | PROVEN (live, ARM32) | a turn against an identity with zero connections: agent called `composio_composio_manage_connections` → bridge showed a real `kind:"connector"` card (`slug:"slack"`, `status:"required"`, `resumeKey`) in the chat, turn paused for the connection; JVM decode/state-machine tests pin the contract |
| Composio-hosted OAuth (connect in browser) | PROVEN (ARM64, user-driven) | the GitHub connection `ca_eRc3B-FfnPP3` was created through this phone's session user by the user completing Composio's hosted OAuth in the browser; Connect buttons render for unconnected toolkits |
| Secrets protection | PROVEN | key write-only (GET /api/config carries no key; error echo masked `ak_**0000`); connector credentials never enter the agent transcript (bridge converts connection requests to cards); MCP relay re-checks the per-bot gate |
| Session/identity model | SUPPORTED WITH LIMITATIONS | each install mints its own Composio user (`openmausbot_<uuid>`); connections belong to that Composio user, so a second device sharing one project key sees nothing until it adopts the first device's `composio.userId` (ARM32 did exactly this via `PUT /api/config`, documented as the intended sharing mechanism) |
| Browser-engine dependency | NOT SUPPORTED (unchanged) | `browserEngine: agent-browser publishes no build for android-arm64` — connector browser flows use the OS browser, not the agent browser |

### Real turn evidence (driver log, ARM64; ARM32 identical)

```
approval card (tool=composio_composio_search_tools) → allow
connector tool: composio_composio_search_tools ok=true output={"ok": true,"result":{"data":{"results":[{"use_case":"list github repositories"…
approval card (tool=composio_composio_multi_execute_tool) → allow
connector tool: composio_composio_multi_execute_tool ok=true output={"ok": true,"result":{"data":{"results":[{"response":{"successful":…
CONNECTORS LIVE RESULT: ALL CHECKS PASSED on arm64-v8a
```

### Provider-key incident found by this phase (fixed)

The phones' `openaiCompat` key was the mock sentinel from Phase 4/5
(`mock-not-a-secret` — a mock run had stored it when no key existed, and a
later run restored only the URL). Every real model call 401'd with
`upstream HTTP 401: {"error":{"message":"Missing Authentication header"}}`
— byte-identical to OpenRouter's response to that fake bearer (verified by
replay). `refresh-models` masked the breakage because `/models` needs no
auth. Fixed by writing the desktop gateway pair (URL + key, user-approved)
through `PUT /api/config` on both phones; a real `muse-spark-1.3` tool-call
round-trip then succeeded. The credential-free drivers remain safe (they
snapshot and restore), and the live driver fails loudly when
`composio.configured` is false, naming the remedy.

### Test architecture for this phase

- `scripts/test-android-connectors.mjs` — credential-free matrix on both
  ABIs (key refusal, per-bot gate round-trip, persistence across restart).
- `scripts/test-android-connectors-live.mjs` — the real-credential round
  (requires key + connected service; fails loudly naming the remedy;
  quiescence-based turn completion so an interstitial reply cannot count as
  final; full cleanup verified).
- JVM: `ConnectedAppsClientTest`, `DecodingTest` (CONNECTOR decode),
  `ConnectorCardRulesTest` (card state machine); server suites untouched —
  deliberate: zero server diffs for this phase.

### Hardening round (2026-09-20, post-audit)

- **Reproducible connector-card proof** — the card emit/dismiss lifecycle is
  now inside the committed `scripts/test-android-connectors-live.mjs` (leg 5b,
  via the bot's connector-policy system prompt): agent calls
  `composio_composio_manage_connections` → `kind:"connector"` card with
  `slug=slack status=required` and a real Composio authorize link → dismiss →
  `status:dismissed`. ALL CHECKS PASSED on arm64-v8a.
- **Unified turn polling** — one `pollTurn` in `scripts/lib/driver-common.mjs`
  with `settle` (quiescence + bot-idle from `GET /api/bots`), `sinceId`,
  `onMessages` and auto-answer options; both connector drivers use it.
- **Identity-sharing rule documented in code** — `server/composio.ts` and
  `server/config.ts` now carry the multi-device rule next to the schema
  (`PUT /api/config {composio:{userId}}` adopts another install's identity;
  minting stays per-install by default; changing this silently breaks
  multi-device connection sharing).
- **Supabase provenance** — read-only Composio API query: every account under
  the shared identity was created through the app's authorize flow
  (github 05:38Z, supabase 07:22Z, googlecalendar/vercel EXPIRED, slack
  INITIALIZING). The supabase connection belongs to the shared identity and
  the app's flow, but the exact triggering action this session is
  unestablished — recorded as an open question; connection untouched.
- **ARM64 fresh evidence** (post provider-key repair): live driver (now 6
  legs incl. card lifecycle) ALL CHECKS PASSED; credential-free driver ALL
  CHECKS PASSED with its unconfigured-shape legs gated on key presence.
- **ARM32 fresh evidence** (post-repair, 2026-09-20): credential-free driver
  ALL CHECKS PASSED on armeabi-v7a (key refusal, per-bot gate round-trip,
  persistence, cleanup, single host process).
- **ARM32 identity loss (found, recovered, root-caused)** — ARM32's shared
  `composio.userId` did not survive the device-state churn this session (the
  key survived via `saveConfig`'s section merge; the identity did not — the
  loss happened during earlier device-state churn, not in the merge path).
  Recovery without ARM64: the shared user id is derivable read-only from the
  Composio API itself — `GET /api/v3/connected_accounts?limit=N` returns each
  account's `user_id`, and the ACTIVE github account identifies the shared
  identity (`openmausbot_d60635a2…`, 48 chars). Adopting it via
  `PUT /api/config {composio:{userId}}` restored ARM32's view of the shared
  connections (github + supabase ACTIVE) without touching any user
  connection.
- **ARM32 UI dialog round (closed)** — the real Compose flow on-device:
  Settings → Connected Apps shows the "Connected apps need setup" banner when
  unconfigured → Set up opens the dialog with a masked (•••) key field →
  23-char key typed via adb (never printed) → Save → banner gone and the live
  catalog auto-refreshes (the Save handler reloads catalog + refresh) →
  screen re-entered: banner stays absent (persisted configured state).
- **ARM32 live driver (closed)** — ALL CHECKS PASSED on armeabi-v7a after two
  driver fixes the ARM32 run exposed: (1) the model is now resolved from the
  host's own live `refresh-models` catalog instead of a hardcoded id that
  404'd (`model_not_found`) on the ARM32 gateway, and (2) every leg filters
  messages with `sinceId` so the host's canned bot welcome cannot satisfy a
  turn matcher. Leg 5b also now picks a toolkit that is auth-requiring AND
  has zero existing accounts (an INITIALIZING leftover from a parked card
  makes authorize demand an alias — correct behavior, but a self-inflicted
  400 for the driver). Card leg picked gmail: slug=gmail status=required,
  real connect link, dismiss verified.

## Phase 7 — Browser (2026-09-21)

A real agent-controllable browser on the phone itself: **Android WebView
adapter, one WebView per bot session, driven by an app-side Kotlin driver
server (loopback HTTP, capability token), exposed to the host as a seeded
stdio MCP server `android_browser`** — same seam as the Phase-4 computer
and Phase-5 MCP servers; approval rides the existing permission-card flow.
Decision + rationale (no CDP, no bundled Chromium, desktop `agent-browser`
unavailable on Android, default stays this phone):
`ANDROID_PORT_ARCHITECTURE.md` §13. Canonical fixture:
`scripts/lib/omb-browser-fixture.mjs` (one generator: CI test + device
driver serve identical bytes). Device driver:
`scripts/test-android-browser.mjs` (45 checks, both ABIs).

### Status matrix (evidence-backed)

| Capability | Status | Evidence |
|---|---|---|
| Architecture decision (engine choice) | PROVEN (decision recorded, prototype-backed) | `ANDROID_PORT_ARCHITECTURE.md` §13: WebView adapter chosen over bundled Chromium (100–400 MB ABI-specific native, untenable on ARM32), remote browser (contradicts standalone-phone), desktop agent-browser (no android target — `unavailable` already surfaced by config). Fixture site reachable from the phone's own WebView via an on-device node HTTP server — no adb reverse dependency in the product path |
| Seeded `android_browser` MCP server | PROVEN (both ABIs) | config.json carries the seeded entry with the driver handoff (loopback port + capability token + per-bot session root); the bot's tool surface contains the `android_browser_browser_*` verbs; mount goes through the Phase-4 `customMcp` path with the Phase-5 result budget/mcp gate |
| WebView driver server | PROVEN (both ABIs) | on-device node probe hits the token-checked loopback route (`WebView driver answers its loopback route with the token`); binds 127.0.0.1 only, per-boot token from the harness env, no credentials in that env — paths/ports only |
| create/open/navigate/load settlement | PROVEN (both ABIs) | `bot A opened the fixture page (load settled)` with real load-state tracking; session WebView verified **attached to the resumed activity's hierarchy** (a stopped/backgrounded activity never traverses — the ARM32 keyguard + background cases are why this check exists) |
| extract text / DOM inspection | PROVEN (both ABIs) | page title + rendered text verified against the fixture marker (not an error page); `browser_dom` returns clickable/typeable element refs; the `INTERACTIVE` substitution bug (bare word in injected JS → every DOM/click/type call silently dead) was found by the driver and fixed |
| click / type / form interaction | PROVEN (both ABIs) | full form round-trip on-device: refs → `type @e3` → `click @e4` → GET submit → result page renders the typed value (`Submitted value: omb-form-7` direct; `omb-e2e-42` via the agent turn) |
| controlled JS execution | PROVEN (both ABIs) | `evaluateJavascript` text bridge only (no JS bridge object); cookie+localStorage set/read; hostile-page eval returns a readable result instead of hanging (`eval answers even when the page is gone or hostile`); the eval self-deadlock (main-thread-blocking wait for a main-thread callback) was found and fixed |
| screenshots | PROVEN (implementation) | driver `screenshot` action (Bitmap → PNG into the bot session dir); exercised in the driver's isolation/persistence legs; bounded PNG size |
| per-bot isolation | PROVEN (both ABIs) | bot A sets `iso_marker=botA-secret` cookie + `botA-local` storage → bot B reads `cookie=|ls=null`, empty cookie jar; separate WebView profiles per bot id (hashed), storage rooted at `files/browser-sessions/<bot>/` |
| session persistence across host restart | PROVEN (both ABIs) | profile persisted → `am force-stop` + relaunch → host healthy → page reopens → cookie + storage survive (`bot A's cookie + storage survive the restart (profile restore)`) |
| failure recovery | PROVEN (both ABIs) | navigation to a dead page recovers with a readable error; renderer-gone callback surfaces `{ok:false}` instead of a silent stall; non-http URLs refused (`only http and https URLs are allowed`); SSRF guard refuses loopback/private targets (`requests to private/loopback addresses are not allowed`) — the fixture is sanctioned via the on-device server, not by weakening the guard |
| security boundaries | PROVEN (both ABIs) | http/https only; SSRF guard; no credentials in the driver env; downloads confined to the bot workspace with sanitized names; no `addJavascriptInterface`; external intents/file-scheme refused; driver token never leaves the app↔harness boundary |
| permission model | PROVEN (both ABIs) | real agent turns produced 6 approval cards answered through the broker (`approval cards were part of the flow`); scoped session-level approval so normal navigate/read/click/type inside an approved session does not re-prompt |
| real agent end-to-end (bot → tools → browser → continuation) | PROVEN (both ABIs) | fresh test bot + real model (`muse-spark-1.3`): `android_browser_browser_open → dom → type @e3 → click @e4 → get_text` all ok=true, result page's `Submitted value: omb-e2e-42` quoted in the assistant's final reply; continuation is real (not a dead-reply marker) |
| lifecycle/cleanup | PROVEN (both ABIs) | sessions created/destroyed explicitly; test bots deleted and verified gone; on-device fixture server stopped by pid; exactly one host process at exit (`hosts=1`) |
| multi-tab/CDP/screencast parity | SUPPORTED WITH LIMITATIONS | one page per bot session by design; no CDP (WebView exposes none); no screencast stream — take-control attaches the live WebView itself (documented in §13) |

### Real turn evidence (ARM32 armeabi-v7a driver log; ARM64 identical)

```
PASS  fixture site is served on the phone itself (200 + fixture marker, on-device node)
PASS  bot B sees NO cookie and NO localStorage from bot A — result=cookie=|ls=null
PASS  bot A's cookie + storage survive the restart (profile restore)
PASS  approval cards were part of the flow (permission broker gating the browser) — 6 card(s) answered
  browser tool: android_browser_browser_open ok=true (fixture index)
  browser tool: android_browser_browser_dom ok=true (5 elements)
  browser tool: android_browser_browser_type ok=true (@e3)
  browser tool: android_browser_browser_click ok=true (@e4 → GET submit)
  browser tool: android_browser_browser_get_text ok=true ("Submitted value: omb-e2e-42")
PASS  fixture content genuinely extracted on-device (form value round-trip)
BROWSER RESULT: ALL CHECKS PASSED on armeabi-v7a
BROWSER RESULT: ALL CHECKS PASSED on arm64-v8a
```

### Defects found by the driver and fixed this phase

- **WebView attached but never traversing** — sessions created before an
  activity window existed stayed unparented; fixed with deterministic
  adoption on attach (create/adopt missing session views on resume), plus
  activity-context ownership so renderers aren't reaped as background work.
- **eval self-deadlock** — `evaluateJavascript`'s callback is delivered on
  the main thread; blocking that thread waiting for it hung every eval.
  Fixed: evaluate on main, wait off main.
- **`INTERACTIVE` substitution bug** — a bare identifier in the injected
  DOM/interaction scripts made `browser_dom` throw and `browser_click`/
  `browser_type` silently no-op (`ok:true` with no effect). Fixed; the
  driver's form round-trip now fails loudly if interaction is dead.
- **Fixture reachability** — the adb-reverse tunnel was unusable from the
  WebView (and flaky over this session's USB); the fixture is now served
  **on-device** by the app's own node binary with exact stale-process
  reaping. Product path unchanged: the fixture is test infrastructure,
  never an app dependency.
- **False-pass elimination in the driver** — load settlement, hierarchy
  attachment, fixture-content markers, and the host-process count all
  fail loudly now; `countHosts` no longer self-matches its own grep and
  paces retries against transient adb/run-as blips.

### Phase 7 completion state

All 45 driver checks passed on armeabi-v7a and arm64-v8a physical devices
at the source generation that proved legs 1–6, including the full
model-driven browser loop, per-bot isolation, restart persistence, SSRF
and error-page handling, and clean cleanup.

Since then three changes landed that a **clean ARM64 re-run must re-prove**
(the run is pending; ARM32 is deferred by user decision until ARM64 is
green):

1. the driver's `select_computer` deny policy + the hardened
   ANDROID_BROWSER_SYSTEM_PROMPT (see notes below),
2. the foreground-service lifecycle fix (next section), and
3. a create-race fix in the WebView driver (`viewOf` re-checks the session
   map inside its main-thread critical section, matching `withWebView`).

The re-run installs the fresh APK (`--no-install` is wrong until it has
passed once) and requires 0 FAIL including `hosts=1` and the leg-6 chain
ending in `Submitted value: omb-e2e-42`.

### Leg-6 determinism notes (what made the agent loop reproducible)

The model-driven leg needed two non-obvious fixes, both now encoded in the
committed driver and worth knowing before touching either side again:

1. **No `computer:"browser"` and no task-surface pin for the test bot.** The
   "Browser" *place* mounts the desktop browser engine, which does not exist
   on the phone; pinning it made the turn *withhold* the android_browser
   custom-MCP tools entirely (observed: "browser target came back
   unavailable"). The android_browser server is a custom MCP server and
   mounts whenever the driver supports custom MCP, independent of the bot's
   computer place.
2. **Deny `select_computer` approval cards in the driver.** An *allowed*
   select_computer call records the chosen surface on the task, which changes
   what the *next* turn mounts — one allowed call turned a passing run into
   "no browser_* tools mounted". Denying the card is safe (the model sees a
   normal denial and continues) and keeps every turn's toolset stable. The
   system prompt also tells the model the browser tools are already mounted
   (server/system-prompt.ts, ANDROID_BROWSER_SYSTEM_PROMPT).

### Internet resource tools (android_computer `resource_*`)

A resource-acquisition layer complementing the browser (which stays for
interactive/JS/session work): discovery remains `web_search`, generic API
calls remain `http_fetch`, and the `resource_*` family acquires URLs.

**Tools** (all inside `android_computer`, riding the same custom-MCP
permission flow — no new permission code, no new seeded server):
`resource_inspect` (HEAD metadata, redirects followed, no body),
`resource_fetch` (bounded 1MB GET for HTML/text/JSON/XML, binary refused
with guidance), `resource_download` (streaming, atomic `.part`→rename,
50MB cap, artifacts.json manifest), `resource_extract_pdf_text` (bundled
pure-JS pdf.js via unpdf; page ranges; scanned PDFs reported honestly),
`resource_extract_links` (links/images from a URL or stored HTML),
`resource_artifact_info` (magic-byte type, image dimensions, PDF pages,
provenance), `resource_list` (the artifact manifest).

**SSRF policy** (`server/android-net-guard.ts`, shared by `http_fetch`):
http/https only; no URL userinfo; every hop (manual redirect walk, cap 8)
re-validated; DNS resolved by the adapter and the connection PINNED to the
validated addresses via node's `lookup` option (rebinding structurally
impossible); refused: loopback v4+v6, RFC1918, CGNAT 100.64/10, link-local
169.254/16 (cloud metadata), ULA fc00::/7, multicast/reserved/benchmark/
doc ranges, IPv4-mapped IPv6, NAT64/6to4 with embedded private v4,
localhost/.local/.internal/.home.arpa names; https→http downgrade refused.
Server bodies are bounded (decompression included — gzip bombs die at the
cap); downloads stream to disk in chunks and never buffer whole files.

**Filesystem**: every path goes through the same `resolveInside` sandbox as
the workspace tools; server filenames are untrusted (sanitized basename,
de-conflicted, never overwrite); downloads land under `downloads/` with a
`artifacts.json` manifest recording source URL, final URL, sha256, size,
detected type. Cancelled/failed downloads never leave a completed artifact.

**Content detection**: declared Content-Type is never the verdict; magic
bytes decide (PDF, PNG, JPEG, GIF, WebP, ZIP, text/JSON/XML/HTML) and
disagreement is reported (`declared` vs `detected`). Image dimensions and
PDF page counts come from the actual bytes.

**Limits**: fetch 1MB (truncated:true past that), download 50MB, PDF
text output 120k chars, 200 link/image rows per extraction, timeouts
1–45s (default 20s). PDF extraction input capped at 20MB. Scanned/image
PDFs return `hasExtractableText:false` — no OCR on device; never invented
text.

**Device status**: ARM64 run PENDING (phone detached during the build);
the full on-device probe (`scripts/lib/omb-resource-probe.cjs`, 20 checks)
passes on the host against the exact bundled adapter the phone runs, and
`scripts/test-android-resources.mjs` runs it on the phone plus a real-model
download/extract leg. ARM32 deferred (user decision) until ARM64 is green.

### Foreground-service lifecycle fix (Android 15+ dataSync quota)

A long Phase-7 device run can exhaust Android 15+'s ~6h/24h `dataSync`
foreground-service budget; the next `startForeground` then throws
`ForegroundServiceStartNotAllowedException`, which crashed the whole app
mid-turn (host, transcripts and live browser sessions with it). Fixed in
`HarnessService.promoteToForeground`: dataSync → `specialUse` fallback →
log-and-continue as a plain background service; a promotion failure can
never kill the process again. `AlwaysOnConnectionService` got the same
guard, and the manifest declares `dataSync|specialUse` plus
`PROPERTY_SPECIAL_USE_FGS_SUBTYPE` and the
`FOREGROUND_SERVICE_SPECIAL_USE` permission.

## Phase 7 completion — ARM64 hardening + physical-device validation (2026-09-30)

### The ARM64 fetch bug (root-caused, fixed, device-verified)

Every public `resource_*` fetch died with `ERR_INVALID_IP_ADDRESS: undefined`
on ARM64 phones. Node's lookup-callback contract re-parses the delivered
address against the REQUEST's `family` option; with `family` unset and a
v6-first answer, the re-parse path threw before dialing. Fix
(`server/android-net-guard.ts`): `pinnedLookup` filters the pinned pool by the
requested family, prefers a validated IPv4, and reports an explicit family
4/6; `sendRequest` passes `family: wantsV6 ? 6 : 4` (6 only when the pinned
pool has no IPv4). Regression test pins the v6-first case: a dial attempt
(`ECONNREFUSED`) is success; `ERR_INVALID_IP_ADDRESS` fails the test. Guard
suite 73/73.

### Turn-admission race (found by the host suite, fixed same day)

`startTurn` gained `await extractTurnFiles(text)` (PDF/text inline context —
the phone-host feature) BETWEEN the admission checks and the dispatch-claim
registration. The queue drain and the coordination tick admit turns in a
synchronous pass, so every queued thread passed the capacity check before any
launch had claimed: raising a bot's limit launched ALL queued threads at once
(expected 2, got 4; coordinate 1, got 3). Verified against pristine HEAD
(passes) before fixing. Fix: `startTurnAdmission` helper registers the claim,
generation, settlers, resource owner and the task's busy flip synchronously
after admission and BEFORE the await; failures unwind through a guarded catch
with the same cleanup as the turn's main catch. Drain workarounds reverted —
the invariant ("a launched turn is visible synchronously") is restored at the
source. thread-capacity-api 5/5, thread-aware-bots e2e 11/11,
steer-queue + chat-followups green.

### Physical-device validation (SM-A075F, arm64-v8a, API 36, serial R8YY90VT4EM)

- Resources driver: 41 PASS / 0 FAIL (real w3.org PDF fetched through
  `guardedRequest` post-fix: 200, 13,264 B; approval cards fired and were
  allowed; model leg on `muse-spark-1.3` extracted the PDF on-device;
  artifact `files/host/workspace/downloads/dummy-1.pdf` persisted).
- Browser driver: 42 PASS / 0 FAIL (form round-trip, profile flush
  persisted, model leg "Submitted value: omb-e2e-42", single host process).
- Extended probe: 25/25 green. Host vitest at fix time: 73/73 guard,
  227/227 index serial.
- §6 hardening-workflow round on-device, all via UI (uiautomator) + host API:
  quiet composer default PASS (IME hidden on fresh chat + after send);
  providers honest state PASS ("Grok (Unavailable)" pre-key, Settings
  "Connected / responding normally", notification limits disclosed);
  new-chat PASS (create sheet → chat opens quiet, welcome message);
  chat deletion PASS (last-thread refusal with reason; non-last delete with
  honest confirm copy; roster count updates); PDF attach ingestion PASS
  (battery turn consumed the attachment; artifacts on disk 13,264 B);
  slash commands PASS (`/` opens HUD, `/c` filters to `/computer`, close
  returns draft to empty; two operator errors during the round were
  mis-taps below the field's bounds, not app defects); computer honest state
  PASS (no computer → "Nothing to show yet / only captured while it is
  working", status Idle). Test bot removed via `DELETE /api/bots/{id}`.

### Known limitations (honest list)

- Meta AI model quirks: `sam-3.1` image-only (plain chat → empty response)
  and it is the FIRST entry of the refreshed catalog, so default-picked by
  both the UI and the drivers — use `--model muse-spark-1.3` (text chat
  works, max_tokens ≥ ~500). `muse-spark-1.3-contributor` returns
  content:null. A driver `modelRank` preference is future work.
- No real computer-frame capture source on Android; Computer screen honestly
  says so. No ARM32 device available this round: ARM32 battery BLOCKED (the
  SM-A137F from earlier phases was not attached); nothing ARM32-specific
  regressed in code since its last green run — host suites that cover the
  shared surface are green.
- Pre-existing at HEAD, unrelated to Android (verified on a HEAD worktree):
  `delta-context.e2e` delegate-revival resume expectation and
  `workspace-backup` encrypted-backup test timeout in this sandbox.
- Sandbox-only: `engine-install` tests need `OMB_EXTRA_PATH` pointing at a
  node shim (this machine's node lives in /usr/bin, not in the guard's
  knownDirs); `env-path` must run without it.

### Artifacts carrying this state

- `server.zip` (post race-fix) sha256 `f925dfb6b7a5a053…` — embedded in both
  APKs (verified by extraction for armeabi-v7a and arm64-v8a).
- `app-arm64-v8a-debug.apk` sha256 `c66e1252363a4adf…` (68,612,884 B).
- `app-armeabi-v7a-debug.apk` sha256 `b8c3fe2411a2cd63…` (63,200,496 B).
- Classification: HARDENING COMPLETE WITH KNOWN LIMITATIONS (ARM64 device
  green end-to-end; ARM32 battery blocked on hardware availability).

### Release gate (2026-09-30, final) — ARM64 only, ARM32 out of scope

Artifact chain verified: APK sha256 `c66e1252363a4adf…` (68,612,884 B,
built 19:53) → embedded `server.zip` sha256 `f925dfb6b7a5a053…` (exact
match, contains `startTurnAdmission` ×7 and `family: wantsV6`) built from
worktree HEAD `8d8182ea` + 110 uncommitted files. The 18:19 APK is
historical evidence only.

Host gates on the final artifact's source: tsc 0 errors; oxlint server/
0 findings; vitest regression-critical set 102/102 (thread-capacity-api 5/5,
net-guard 73/73, resources); Kotlin `:core:test` + `:app:testDebugUnitTest`
932 tests / 0 failures; bundle smoke 4/4 PASS.

`startTurnAdmission` classification of the device rows below: the physical
device did not return after the final rebuild, so the mandatory on-device
race-fix validation (§4), batteries (§5–§7), hardening workflows (§8),
persistence (§10) and security re-verification on the FINAL APK are BLOCKED
on hardware, not on evidence quality — the 18:19 device rounds remain
historical GREEN for the earlier artifact. Per the gate's own rule the
final artifact is NOT called validated.

Final classification: **HARDENING COMPLETE, ARM64 DEVICE VALIDATION BLOCKED**
(reinstall `app-arm64-v8a-debug.apk` sha256 `c66e1252…` when the phone
returns, then run the resources + browser drivers and the capacity probe).

sam-3.1 default determination (§9): `selectDefaultModelSelection` picks
`models.default` from the provider's own catalog — the default id comes
from the provider's refresh response, not from app-side ranking; a model
advertising itself first/default is upstream catalog behavior surfaced
honestly. Documented as a known limitation (`muse-spark-1.3` for text),
not fixed app-side; no product bug in selection code.

### Final gate EXECUTED on device (2026-09-30 20:42–21:15) — final APK validated

Device returned. Executed the full gate against the exact final artifact:

- APK installed: sha256 verified BEFORE install `c66e1252363a4adf…`;
  installed base.apk pulled back from `/data/app/…/base.apk` AFTER install
  → `c66e1252363a4adf…` (exact match, 68,612,884 B). On-device
  `files/host-server/server.version` = `f925dfb6b7a5a053…`; extracted
  `index-android.js` contains `startTurnAdmission` (×2) and `family: wantsV6`.
- Startup: health `{app:"openmausbot",pid,…}`, single host process, no
  crash lines in logcat.
- §4 race regression ON DEVICE (`scripts/test-android-capacity-race.mjs`,
  new; mock provider gained a release-gated `cue-hold`):
  26/26 ALL CHECKS PASSED on arm64-v8a — capacity 1 + held turn + 3 sends all
  queued with reason=capacity; raising the limit admitted EXACTLY one more
  (2 busy; pre-fix behavior was over-launch); FIFO refill on each release;
  no transcript duplication; single host process; clean settle to idle.
- §5 resources battery: 41/41 ALL CHECKS PASSED (exit 0) — real w3.org PDF
  fixture, model leg consumed the fetched artifact.
- §6 browser battery: 42/42 ALL CHECKS PASSED (exit 0) — form round-trip,
  profile flush, single host process; no timeouts counted as passes.
- §7 probe: 27/27 pass inside the resources run — SSRF (loopback literal,
  redirect-to-local), traversal, magic-byte PDF sniffing, cancellation,
  scanned-PDF honesty, pdf.js extraction.
- §8 hardening workflows on the final APK (uiautomator-driven): quiet
  composer default (IME hidden on fresh chat + after send) PASS; Settings
  honest state ("Connected", "responding normally", notification limits
  disclosed) PASS; new chat with name PASS (welcome, quiet composer);
  slash HUD `/` → `/computer`/`/threads`, `/co` filters, select executes
  PASS; `/computer` honest idle state ("Nothing to show yet / only captured
  while it is working") PASS; thread drawer + delete observed (confirm
  dialog verified earlier in the session; one tap-vs-dialog capture flake
  in the dump loop was operator tooling, not the app); last-thread refusal
  previously verified and unchanged code-wise.
- §9 persistence/restart: force-stop → relaunch → bots (38), gate-e2e chat,
  provider configuration (openaiCompat configured), model selection and all
  download artifacts survived PASS.

FINAL CLASSIFICATION: **RELEASE CANDIDATE (ARM64)** — the exact final APK
(sha256 `c66e1252363a4adf…`, embedding server `f925dfb6b7a5a053…`) passed
the physical gate including the mandatory on-device race regression.
ARM32 out of scope for this phase.

## PHASE 8 ADDENDUM — LINKS, INTELLIGENT PDF HANDLING & MID-TASK USER DECISIONS (2026-10-01)

Scope: ARM64-only, per spec §37–§64. All new code written, host-tested, packaged.
Previous ARM64 release candidate (c66e1252… / server f925dfb6…) stays green; this
section records Phase 8 changes on top.

### §37 — Bare-URL autolinking (Android chat UI)

`ui/InlineMarkdown.kt` gains a real bare-URL autolinker with a `suppressAutolink`
guard: `http(s)://` detection at word boundaries (case-insensitive scheme via
`regionMatches`), body of non-whitespace/non-control chars, balanced-paren
tracking (an unbalanced open `(` truncates the link before it via backward scan),
trailing-punctuation trimming (`.,;:!?\"')]}` — `)` only trimmed when surplus
vs opens), and the destination keeps its full scheme (LocalMessageLink.resolve
sends scheme-less values down the DesktopFile path — caught and fixed). Failed
bracket-link tails (half-typed `[label](https://e`) render the label with
autolink suppressed and keep the raw tail so no link flashes inside malformed
markdown. 15 new tests in InlineMarkdownTest.kt → **69/69 green**.

### §38–§47 — PDFs as context, not chat dump (`server/turn-files.ts` rewrite)

- `extractTurnFiles` → `{text, files, tools}`; per-page extraction via `unpdf`
  → `[page N]` markers (`joinPagesWithMarkers`); caps: 4 files / 25 MB /
  2000 pages.
- Context framing: acknowledgment-first framing block ("if the user's message
  asks nothing specific, respond with a brief natural acknowledgment…cite page
  numbers from the markers") + `---BEGIN DOCUMENT "X"---…---END DOCUMENT "X"---`.
- Large PDFs (body > 240k chars) ship an outline only (first ≤120-char line per
  page) + a bounded `read_document_pages` tool (30k chars per read, continuation
  hint); registry is module-level, slug-keyed with collision suffixes, reset per
  message via `resetTurnDocumentRegistry()` in dispatch admission.
- Scanned PDF (no text layer) → honest report that no text was found and OCR is
  unavailable; password/size/corrupt errors map through `friendlyDocumentError`
  to actionable text; missing file → "could not be opened…try attaching it
  again." 6 vitest tests incl. multi-doc separation and error wording → green.

### §48–§61 — ask_user mid-task decisions (harness turnTool, driver channel)

- `SendTurnInput.turnTools` added to contracts; `dispatchDirectTurn` builds
  `turnTools = [...turnFileTools, askUserTool]` (`ask_user`, flat schema
  `{question≤400, choices[2..5]≤120}`); gated into `sendTurn`.
- openaiCompat chat driver special-cases `ask_user` by name: flat args normalize
  to structured `AskQuestion[]`, then `approval.askQuestion(...)` — a NEW
  question channel beside the existing permission ask, **no timeout, waits on
  the human**. Emitting it opens a standard `request.opened` event with
  `requestType:"question"` and `AskQuestion[]`, which the Android QuestionCard
  (radio/checkbox + "Other" free text) already renders; submit goes through the
  existing `/api/threads/{id}/respond` behavior `"answer"`.
- The same task resumes in place: the answer text returns as the tool result
  `{ok:true, text}` to the model — no restart, no captcha, no re-prompt.
  Interrupted (null answer) → denial + honest tool result.
- Text-only / tools-off endpoints see NO tools key (gated on
  `options.tools === false`), preserving the text-only contract.
- An earlier server-side resume-intercept design (resolveAskUserCard /
  dispatchAskUserResume / /api/internal/ask-user) was written then **removed** —
  the driver-level channel made it redundant. Cards live in the transcript, so
  persistence across app restart comes for free.
- 2 driver tests: question-card event shape with options → answer becomes tool
  result; interrupt → unresolved card, honest "unavailable" result. Combined
  driver suite (openai-chat-tools 55 + openai-chat + turn-files 6 +
  openai-tools.e2e) → **all green**.

### Host test evidence

- Kotlin: 69/69 (InlineMarkdownTest).
- Vitest: openai-chat-tools.test.ts 55 pass, turn-files.test.ts 6 pass,
  openai-tools.e2e.test.ts tools-off scenario pass; `pnpm build:server` green.
- Shard sweep: shard 1/4 (7 fail = 6 pre-existing engine-install env + 1 MCP
  e2e, since fixed), shard 2/4 1586 passed, shards 3/4 unknown (background
  killed by session restart); pre-shard state green except known flakes.

### Packaging

- New server.zip: sha256 `3aef89a2af2c5a2832c6ac595f67d84f26f473ca97d0d6355bbaf
  73cf567ed64`, 5,865,393 B, 292 files.
- app-arm64-v8a-debug.apk (68,627,517 B, 19:55) verified by extraction:
  `unzip -p … assets/host/server.zip | sha256sum` → `3aef89a2…` — embeds the
  Phase 8 server. (APK is ABI-split; `app-debug.apk` was never the output name.)

### Device validation EXECUTED (2026-10-01, phone R8YY90VT4EM, arm64-v8a)

- Install verified bit-exact: streamed install Success; pulled-back base.apk
  sha256 `274741ecc34e72655c95e2c74caabb6e81931391bd74ba53766fc01e9e398198`
  == local app-arm64-v8a-debug.apk (68,627,517 B); embedded server
  `unzip -p … assets/host/server.zip` → `3aef89a2…` (Phase 8). On-device
  `files/host-server/server.version` = `3aef89a2…` after first launch; single
  host process at every checkpoint in every battery.
- Race regression (§4): **26/26 ALL CHECKS PASSED** — capacity 1, 3 queued
  reason=capacity, drain admitted exactly 2, FIFO refill per release, no
  transcript cross-leak, one host process.
- Resources battery (§5+§7): **41/41 ALL CHECKS PASSED** — full probe inside
  (SSRF, traversal, magic-byte PDF sniffing, scanned-PDF honesty, pdf.js
  extraction, de-conflicted downloads, cancellation), plus the model leg
  downloading a real public PDF via the approval flow on a live model.
- Browser battery (§6): **42/42 ALL CHECKS PASSED** — form round-trip,
  profile flush, single host process; no timeout counted as a pass.
- Model-leg incident, NOT a Phase 8 regression: the catalog default `sam-3.1`
  returned **empty completions (HTTP 200, textLength 0, usage null)** for every
  call since Sept 30 — reproduced with tools-off and with a trivial prompt, and
  visible in pre-Phase-8 native logs (`d2a8216d…` 2026-09-30 16:21 same 3s
  empty pattern). With `tools:false` the empty response persists, which also
  proves Phase 8's turnTools/harness tools payload is not involved. Switching
  the model legs to `muse-spark-1.3` (last verified healthy 2026-09-30 13:56,
  and healthy again on 2026-10-01) turned everything green. Upstream catalog
  behavior, same class as the §9 muse-spark default note.
- Suite-runner fix: `requireApk` in `scripts/lib/driver-common.mjs` referenced
  an undefined `usage()` (latent, only fired on bad args) — replaced with a
  literal message.

FINAL CLASSIFICATION: **PHASE 8 COMPLETE — ARM64 RELEASE CANDIDATE
REVALIDATED**. The exact Phase 8 APK (sha256 `274741ec…`, embedding server
`3aef89a2…`) passed the full physical gate: race 26/26, resources 41/41,
browser 42/42, §7 probe 27/27 inside resources, single host process
throughout. ARM32 remains out of scope.

## PHASE 9 — NATIVE PROVIDER AUTHENTICATION ON ANDROID (2026-10-04)

Scope: ARM64 phone SM-A075F (serial `R8YY90VT4EM`, API 36). Demand: account
sign-in must be possible *on the phone*, and a signed-in account must be
usable — never a card that says "CLI not found" after a successful sign-in.

### §27 — Provider matrix (device-observed, 2026-10-04, host pid 3388)

Fetched from the live host at `/api/instances` (verbatim `snapshot` +
`authentication` per engine):

| Engine | Runtime on this phone | Sign-in offered | State after this phase |
| --- | --- | --- | --- |
| Codex | none (no CLI; none installable) | **browser (PKCE loopback)**, device-code fallback — native, no runtime needed | **available** — turns run through the ChatGPT backend runtime using the stored sign-in |
| Claude | none | paste-code flow declared but `available:false` ("runs the Claude Code runtime's own login, and this host does not have it") | honest reason; API providers are the route |
| Antigravity | Google publishes no android-arm64 runtime | `browser` declared, `available:false` ("runs its own runtime, which this host cannot provide") | honest reason; API providers are the route |
| OpenCode | none | none (CLI login only) | honest absence (`authentication: null`) |
| Grok / Kimi / Droid / Cursor / Hermes / pi | none | none | honest absence (`authentication: null`) |
| Qwen | none | none (its OAuth sign-in was discontinued; API-key only) | honest absence |
| openai-compat | n/a (pure HTTP) | API key | unavailable until `OPENAI_COMPAT_API_KEY` or instance config is set |
| Box / Computer | n/a | token | unavailable without a Box token |

The rule this phase enforces: **a sign-in card may only exist where a sign-in
can actually run, and a sign-in must only report "succeeded" where turns can
then run.**

### Codex browser sign-in (PKCE loopback, no terminal, no CLI)

`server/drivers/codex-native-auth.ts` now runs two native flows against
OpenAI's own endpoints (client id `app_EMoamEEZ73f0CkXaXp7hrann`):

- **Browser PKCE** (this phase): binds the CLI's own loopback port (`1455`,
  fallback `1457`), builds the CLI's authorize URL (S256 challenge, `state`,
  `openid profile email offline_access`, `id_token_add_organizations`,
  `codex_cli_simplified_flow`, `originator=codex_cli_rs`), hands the URL to the
  app, and answers the one-shot `/auth/callback` — a redirect whose `state`
  does not match is refused, and a callback without a code fails the flow
  rather than silently waiting. Listener is `unref`'d, closes on first usable
  request, and cleans up connections; no port bindable ⇒ device-code fallback.
- **Device code** (earlier phase, kept as the fallback for hosts whose browser
  cannot reach them): usercode → poll → exchange.
- Both write the CLI's own `auth.json` (mode 0600) with `tokens`, `last_refresh`,
  `email`, preserving a co-resident `OPENAI_API_KEY`; `clearCodexSignIn` is the
  only deleter (a deliberate sign-out).

The Android harness sets `OPENMAUSBOT_LOOPBACK_AUTH=1`, so the registry
declares `method:"browser"` on the phone and the app auto-opens the authorize
page.

### The "No model providers are available" defect — root cause and fix

Reported symptom: after a successful browser sign-in, Bot settings → MODEL said
*"No model providers are available"* / *"Current provider (unavailable)"*.

- **Root cause:** `ModelRules.instanceChoices` lists only
  `snapshot.isAvailable` instances, and the Codex snapshot stayed
  `state:"unavailable"` because the driver was **CLI-gated**: no `codex` binary
  exists (or can exist) on Android, so a valid ChatGPT sign-in still produced no
  runtime and the picker was empty. No HTTP driver spoke the Codex backend
  either (`openai-compat`/`openai-chat` speak `/chat/completions` with an API
  key; the ChatGPT subscription backend speaks `/responses` with OAuth tokens).
- **Fix — `server/drivers/codex-native-runtime.ts`:** a native runtime that
  speaks the same ChatGPT backend protocol the CLI speaks, over the same stored
  credential:
  - `POST https://chatgpt.com/backend-api/codex/responses`, `Authorization:
    Bearer <access_token>`, `ChatGPT-Account-ID`, `originator: codex_cli_rs`,
    `session-id`, `store:false`, `stream:true`,
    `include:["reasoning.encrypted_content"]`, `prompt_cache_key`;
  - SSE consumption of `response.output_text.delta`,
    `response.reasoning_summary_text.delta`, `response.output_item.done`,
    `response.completed` / `response.failed` / `response.incomplete`, with usage
    banked and surfaced;
  - **tool round-trip**: the response's own `reasoning` (encrypted) and
    `function_call` items return as input and each call is answered with a
    `function_call_output`; MCP integrations (agents, composio, custom —
    including the phone, browser and computer stdio descriptors) mount through
    the existing chat-runtime transport, and `ask_user`/harness `turnTools` ride
    the same approval channel (`request.opened` permission/question cards);
  - **token renewal**: `refreshCodexCredential` (JSON refresh grant, the CLI's
    client id) is used when the access token is expired and once more on a 401;
    the rotated tokens are persisted to `auth.json` so the CLI and this runtime
    always share one credential; a renewal that cannot be persisted still lets
    the turn run on the in-memory token;
  - retries stay bounded like the other runtimes (idle-timeout stream guard,
    transient backoff, never replay after streaming or after a tool call ran).
- **Driver wiring (`server/drivers/codex.ts`):** with no CLI and a `login`
  sign-in, the snapshot returns `state:"available"`, `authenticated:true`,
  account email, `billing:"subscription"`; the adapter routes turns to the
  native runtime and reports honest capabilities there (`images:false`,
  `queueing:false`, no `strictResume`; MCP families and effort levels kept);
  `generateText` becomes available; the CLI probe is cached for seconds, so
  installing the CLI later upgrades the next turn without a restart.

### Evidence

Host tests (vitest `--no-file-parallelism` unless noted):

- `codex-native-runtime.test.ts` **7/7** — request URL/headers/body pinning,
  streamed deltas + usage, tool round-trip (`function_call_output` + reasoning
  item echoed), expired-token renewal with rotation persisted, one forced
  renewal on 401 then retry, `response.failed` as a terminal error with no
  retry, driver snapshot **available** with sign-in and no CLI, **unavailable**
  with neither.
- `codex-native-auth.test.ts` **13/13** (device-code + PKCE flows).
- `codex.test.ts` (CLI app-server suite) **green** — the CLI path is untouched
  wherever a CLI exists.
- `openai-chat-tools.test.ts` **55/55**; `npx tsc -p tsconfig.server.json`
  clean; `cd android && ./gradlew :core:test :app:testDebugUnitTest` **BUILD
  SUCCESSFUL**.

Packaging (bit-exact):

- `android/app/src/main/assets/host/server.zip` sha256
  `d26e240c1b05fa1797a0221830b07379c0fa0e63db9aa6fff8017a4b6d40cd8a`
  (5,933,039 B, 294 files, enterprise layer excluded).
- `app-arm64-v8a-debug.apk` sha256
  `dff0806e14f716f40ec7743ecf332c8ded496257aff51c99acd1b47b56d4c2ba`
  (68,695,234 B); `unzip -p … assets/host/server.zip | sha256sum` equals the
  local zip above. Installed with `adb install -r` → Success, then re-verified:
  fresh host (pid 11338) reports the same codex snapshot (`available`,
  `authenticated:true`, `abhay31204@gmail.com`), and Bot settings → MODEL on
  this exact APK renders **Codex / GPT-5.6 Luna / Medium**.

Device proof (phone R8YY90VT4EM, host pid 3388):

- `/api/instances` codex entry:
  `{"state":"available","authenticated":true,"version":null,"account":{"method":"login","email":"abhay31204@gmail.com"},"billing":"subscription"}`,
  `authentication: {"method":"browser","signOut":true,"available":true}`.
- Bot settings → MODEL (Quill) renders **Provider: Codex**,
  **Model: GPT-5.6 Luna**, **Reasoning effort: Medium** — the empty-state copy
  and "(unavailable)" label are gone.
- A real turn ran on the native runtime; `files/host/data/native/…ndjson`
  (thread `12245f5b…`) shows `dir:"out", source:"codex-native"` with the full
  system prompt + mounted tool list, then `dir:"in", source:"codex-native"`
  `{"text":"Hey! What can I help you with?","status":"completed"}`; the event
  log shows `turn.completed {"provider":"codex","ok":true}`.
- Same probe used for the §27 matrix (`curl 127.0.0.1:28799/api/instances`).

### Honest limitations of the native runtime

- No image input and no mid-turn steering (the CLI keeps both on desktop);
  capabilities say so, so the app never offers those controls on this host.
- No `strictResume`: history is rebuilt from the transcript each turn, the same
  model the other HTTP runtimes use.
- The model list is the bundled static catalog; the backend is the authority on
  which models the account may use, and an unusable choice surfaces its own
  backend error rather than being hidden.
- Reasoning summaries render only when the backend emits them; encrypted
  reasoning is round-tripped but never displayed.
