# ANDROID_PORT_ARCHITECTURE.md

**Project:** OpenMausBot Android — fully standalone native agent platform (fork of `milind-soni/OpenMausBot` @ `8d8182ea`)
**Status:** living document — updated every phase. Honesty ledger governs all claims:
**PROVEN** = executed/tested on a real ARM64 Android device · **EXPERIMENTAL** = works, edge cases unproven · **NOT YET IMPLEMENTED** · **UNDETERMINED** = needs a test we haven't run.

---

## 1. Current OpenMausBot architecture (as read, Phase 1)

Two processes, one contract file:

- **Harness server** (`server/`, portable Node, zero frameworks): `server/contracts.ts` is the SPI — `ProviderDriver` (metadata, `defaultConfig`, `decodeConfig`, `create`, `install`) → `ProviderInstance` (snapshot, models, `adapter: ProviderAdapter`). `ProviderAdapter.sendTurn / interruptTurn / respondToRequest / onEvent` plus capability flags (`computerMcp`, `agentsMcp`, `composioMcp`, `browserMcp`, `images`, `effortLevels`, `queueing`, …). Every provider is flattened into this one shape; unknown/broken configs degrade to **unavailable shadow snapshots** instead of crashing.
- **`server/harness/`**: `registry.ts` (config map → live instances, decorate, dispose; `describe()` → model picker payloads incl. auth methods `paste-code`/`device-code`/`browser`) and `bus.ts` (fan-in event bus; every adapter event stamped with `providerInstanceId`, redacted, teed to per-thread NDJSON logs, delivered to SSE subscribers).
- **API**: `server/index.ts` (~935 KB, 17.8k lines) — HTTP + SSE (`/api/...`, `GET /api/events` SSE, `server.listen(PORT, "127.0.0.1")`). Env knobs: `OMB_PORT` (8799), `OMB_WEBHOOK_PORT` (+1), `OMB_DATA_DIR`, `HOME` (~/.openmausbot), `OMB_STATIC_DIR` (static UI).
- **Storage** (`server/store.ts` ~99 KB + `message-db.ts`): **`node:sqlite` (`DatabaseSync`) is the primary transcript store, with FTS5** for recall/search — a hard engine requirement. Secrets are "configured"-only to the UI; canonical event logs are NDJSON per thread.
- **Drivers** (`server/drivers/builtIn.ts`): 17 registered — CLI engines (claude, codex, grok, kimi, droid, cursor-agent, qwen, opencode, hermes, pi, antigravity), `acp/*` family, `boxAgent` (cloud computer), `openai-compat` (**API-native, not a CLI** — takes an API key, speaks to OpenAI-compatible endpoints; default models target OpenRouter/Groq), `minimax`. CLIs spawn as child processes; the permission broker surfaces their asks as Allow/Deny/Answer cards.
- **MCP**: first-class. `StdioMcpSpec {command,args,env}` and `RemoteMcpSpec {type:"http"|"sse",url,headers}` (`contracts.ts`); `customMcpServers()` normalizes user config; user-configured MCP mounts via `turn.integrations.custom` riding the normal permission flow. Bundled proxies are separate entry points (`mcp-gate.ts`, `browser-proxy.ts`, `connector-proxy.ts`, `permission-proxy.ts`, …).
- **Routines**: `server/routines.ts` (~75 KB) — croner-based scheduler inside the harness.
- **UI** (`src/`, React+Vite+Tailwind): zero transports of its own — HTTP out, one SSE stream in. **Desktop frontend only** (per revised plan: not ported, not wrapped).
- **Companion stack**: `companion/src/*` = sidecar on `0.0.0.0:8810` proxying to harness `127.0.0.1:8799` with **default-deny route allowlist** (`routes.ts`), SSE scrubbing, pairing (HPKE-wrapped credentials), mDNS. `android/` = the phone app (see §2). `ios/` mirrors it.
- **Electron** (`electron/`): desktop shell — dictation, browser WebContentsView, CUA computer-use, cloudflared. Platform-specific desktop code lives here.
- **`enterprise/`**: source-available carve-out, NOT Apache-2.0 → **excluded from the Android APK**. OSS edition boots without it (server prints `open-source edition` — confirmed in our boot log).
- **Tests**: vitest unit + driver-contract (scripted fake CLIs) + API smoke (`index.test.ts` boots the real server against a throwaway HOME). No-sleep waiting rules; isolated fixtures mandatory.

## 2. Existing Android application (the UI we keep)

`android/` — 246 Kotlin files (~68k lines), two Gradle modules:

- **`:core`** (pure Kotlin, 66 `@Serializable` classes): `Client.kt` (1085 lines, OkHttp), `Sse.kt` (SSE parser + `eventStream()` Flow), `Frames.kt` (stream frames), `Session.kt` (2098 lines — bots/threads/tasks/routines/profile/model state machine), `Connection.kt` (endpoint policy, pairing invite parsing, `openmausbot://pair` deep links), `Endpoint.kt` (hosted/tailnet/lan/bonjour authority validation), `Store.kt`, `Models.kt` (1195 lines), `Transcript.kt`, markdown, dictation contract.
- **`:app`** (Compose): `MainActivity` (single Activity, permission launchers, notification nav), `OpenMausApp` (ProcessLifecycleOwner connect/disconnect), screens: `RosterScreen`, `ChatScreen` (1695 lines), `MessageRow`, `MarkdownText`, `ComputerScreen`, `ConnectedAppsScreen`, `TasksRoutinesScreen` + `RoutineEditorSheet`, `AgentProfileSheet`, `SettingsScreen`, `OnboardingScreens`, `PairingScreen`, `QrScannerScreen`, permission cards (`PermissionRequests`, `QuestionCard`), mascots (MausFace engine), `browser/CloudDesktopBrowser`, `dictation/SpeechDictation`, `notifications/*`, `lifecycle/*` (linger 25s anchor, opt-in always-on foreground service, boot receiver), `storage/*` incl. `KeystoreTokenStore`, `sharing/*`, `discovery/NsdDiscovery`. Variants: release (signed/unsigned handover), `preview` (`.preview` appId, debug key). minSdk 26, target/compileSdk 37, R8 off deliberately (serialization reflection; ~34 MB cost, documented).

The sidecar is an allowlist proxy in front of the **same harness API** — the phone already speaks harness protocol. Standalone = point `:core` at an in-process harness on loopback and unlock host-side routes.

## 3. Components REUSED (unchanged)

| Component | Where | Notes |
|---|---|---|
| Harness server bundle | `dist-server/*` via `pnpm build:server` | Real upstream code, esbuild self-contained ESM; boots with `HOME`/`OMB_DATA_DIR`/`OMB_PORT` env — proven on host |
| Driver registry + event bus | `server/harness/*` | Fail-closed semantics preserved |
| `openai-compat` driver + SPI | `server/drivers/*` | Template for API-native providers; add Android-native drivers, register in `builtIn.ts` |
| MCP machinery | `server/*` (specs, gate, proxies) | stdio + http + sse transports already modeled |
| Permission broker + approval cards | server + `:app` UI | Philosophy preserved |
| `:core` protocol module | `android/core` | 66 `@Serializable` classes, SSE client, session store |
| Compose UI (all screens above) | `android/app` | The product UI (§4 migration map) |
| Lifecycle services, notifications, sharing, dictation contract, Keystore store | `:app` | |
| Test harness patterns | `server/testing/*`, fake drivers | Extended with fake HTTP providers |

## 4. Components ADAPTED (platform boundary)

| Component | Change |
|---|---|
| `:core` `Connection`/`Endpoint` | New **local** loopback authority (in-process `127.0.0.1:<port>`), trusted by construction; pairing path kept for optional Remote computer |
| Onboarding | First-run = standalone flow (welcome → provider auth/key → model → local computer → optional connectors). Pairing demoted to "Remote computer (optional)" |
| Settings | Extends to: AI providers (§60-style), MCP servers (§62-style), computer selector (This phone default), storage management, diagnostics |
| `ComputerScreen` | Renders the phone-local computer: environment status, workspaces, browser, terminal, activity |
| Server data location | `HOME`→ app-private files dir; `~/.openmausbot` → `files/openmaus/` |
| Secrets | Harness config keys provisioned from Android Keystore wrapper by the host service; UI stays "configured"-only |
| Boot/discovery | NsdDiscovery/pairing screens kept but bypassed on standalone path |

## 5. Components REPLACED (remote-host assumptions)

| Component | Replacement |
|---|---|
| Remote desktop as agent runtime | **In-process harness on the phone** (foreground `HarnessService`) |
| `AlwaysOnConnectionService` (keep-pairing-alive) | `HarnessService` (foreground, owns engine+server lifetime) |
| CloudDesktopBrowser as *the* computer | Phone-local browser tools; cloud stays optional |
| Host-managed credentials/keys | On-device Keystore-backed provisioning |

## 6. Components REWRITTEN (new)

| Component | Why |
|---|---|
| API-native provider drivers (Android engine adapters) | CLIs can't run on the phone; preserve SPI |
| AndroidComputer (`ExecutionEnvironment` impl) | The phone is the bot's computer |
| WorkManager bridge for routines | Android background execution contract |
| Host variant (Gradle flavor/applicationId, branding strings) | Standalone product identity |

## 7. Runtime decision — **GATE A, status: evidence collected, device test pending**

**Host-side (PROVEN, this machine):** real server bundle builds clean (`pnpm build:server` → self-contained ESM) and boots in isolation — `HOME=/tmp X OMB_PORT=18973` → health 200 in ~7s cold, 13 driver instances registered fail-closed, `/api/bots` serves auto-created fleet, SSE `/api/events` streams `hello`+cursor, data dir laid out (`messages` store, `events/`, leases).

**Device-side (the open half of Gate A):** the same bundle must run inside the app on android-arm64. Hard requirement discovered: the harness's primary store is **`node:sqlite` (bundled SQLite with FTS5), stable Node ≥ 22.5-ish** — so any embedded engine must be a **new-generation libnode** (not the historical Node 16/18 nodejs-mobile builds, which lack `node:sqlite`/FTS5). Packaging path for native binaries on modern Android: `jniLibs`/`lib*.so` (app dirs are `noexec`; `jniLibs` is the exec-permitted exception — documented constraint for every bundled runtime).

**Spike protocol (time-boxed, Phase 2 kickoff, real ARM64 device or emulator):** boot `dist-server/index.js` under embedded engine → verify startup, filesystem (`HOME` redirect), loopback HTTP+SSE, env vars, persistence across restart, `node:sqlite` + FTS5 queries, child-process spawn (`toybox sh`), shutdown, memory, APK packaging.

**Decision gate:** instability / packaging pain / unsupported APIs / disproportionate time → **fallback: Kotlin harness re-implementing `contracts.ts` semantics** (Compose UI unchanged — same HTTP+SSE). Alternative rejected up front: swapping `node:sqlite` for a JS store (violates reuse rule; last resort only).

**Phrasing rule:** preserve upstream behavior wherever Android permits; replace platform-specific mechanisms where necessary.

## 8. VM/sandbox decision — tiered, evidence-gated

**Tier 1 — AndroidComputer (complete first computer, no Linux dependency):** per-bot scoped workspace `files/openmaus/bots/<bot-id>/{workspace,runtime,browser,skills,mcp,logs}`; `/system/bin/sh` (toybox, Apache-2.0); fs ops; exec/kill; **sanitized env only** (PATH/HOME/TMPDIR/bot vars — never app env/secrets); permission broker on every risky action. Demo chain required on device: bot → permission → workspace → mkdir → write → read → exec → result → terminate. **NOT YET IMPLEMENTED.**

**Tier 2 — provisioned Linux userspace (explicit spike, no assumptions):** official-Linux-binaries-on-Android is NOT proven by arm64 alone. On-device tests: dynamic loader, libc/runtime compat, filesystem, process creation, signals, networking, env vars, stdin/stdout, child processes, persistence, startup time, memory — for **Python AND Node AND one stdio MCP server**. If glibc builds fail (likely loader/noexec issues): evidence-first alternatives — musl static binaries, bionic-built packages, or Tier 3. Node inside the bot environment is **separate from the harness engine** (Gate A) — independent verdicts. **UNDETERMINED.**

**Tier 3 — proot-style rootfs:** **EXPERIMENTAL** decision gate, only if Tier 2 proves insufficient. Hardware virtualization: expected NOT PRACTICAL on consumer devices; documented as such. No root, no Termux, no Docker, no bootloader changes — always.

Every tier's docs state: technology, ABI, fs mapping, process model, networking, startup/memory/storage footprint, package install, persistence, upgrades, cleanup, integrity verification, crash recovery, isolation, escape prevention.

## 9. Provider strategy

Auth axes independent: account/OAuth · device-code · API key · personal token. API-native drivers implement the SPI (streaming, cancellation, model catalog/switching) and register in `builtIn.ts`:
- `openai-compat` **already exists upstream** (PROVEN registered; needs key + Android-appropriate default model list) — first API provider.
- Anthropic / Google / xAI native drivers: NOT YET IMPLEMENTED (Gate D evidence table to follow).
- CLI engines: stay in registry; on Android they snapshot `unavailable` with real reason (proven behavior — "CLI not found" shadows observed live). Grok CLI: UNDETERMINED until tested. No provider-client impersonation; no credential circumvention; zero hardcoded secrets.

## 10. Auth strategy

Reuse registry auth plumbing (`startAuthentication` → `paste-code`/`device-code`/`browser` flows) + Android App Links/`openmausbot://` callback (existing PairingLink plumbing). API keys enter once, live in Keystore-wrapped storage, leave the UI as "configured" booleans. Connector OAuth (Composio) via official flows only; never scrape/intercept credentials.

## 11. MCP strategy

Feature complete only when a bot **discovers and executes** a tool. Verification matrix: one local stdio MCP (runs inside bot sandbox via provisioned/bundled runtime), one HTTP (streamable), one SSE. Verify: spawning, framing, lifecycle, cancellation, env handling, credentials, permission flow, bot isolation, failure reporting (exit code + reason, never silent). UI: add/edit/enable/assign/log servers per §62 of the project prompt. **NOT YET IMPLEMENTED.**

## 12. Connector strategy

Composio marketplace routes already exist (`/api/connectors/*`, catalog/connected/authorize); keep default-deny route list reviewed for host-local operation (it can be widened deliberately, per `routes.ts` doctrine). OAuth callbacks deep-link back into the app. Tokens Keystore-backed, never returned to UI.

## 13. Browser strategy — Phase 7 decision (2026-09-20, evidence-backed; implemented + PROVEN on both ABIs 2026-09-21)

**Engine choice: Option A — Android WebView adapter, inside the existing sandboxed host, exposed as a seeded stdio MCP server (`android_browser`).** This is the smallest architecture that satisfies the required bot behavior. Options B/C (bundled Chromium or Gecko-based engine) are ruled out: a full Chromium ships 100-400 MB of ABI-specific native code per device and is untenable on the ARM32 target; desktop's `agent-browser` needs a Rust daemon plus Chrome-for-Testing and publishes no android-arm(64) build — the exact `unavailable` reason the config surface already reports. Option D (remote browser) contradicts the standalone-phone goal; it remains documented as an optional escape hatch, never the default. **The default stays: this phone.**

**Why an adapter is NOT pretend-Chromium.** Upstream's own design doc fixes the contract as the MCP tool surface (the `agent_browser_*` core verbs), not Chrome internals: "An MCP stdio server whose verbs match our browser tools almost one to one." OMB's `browser-tool-shape.ts` exists precisely because the engine behind the MCP server is swappable at that boundary. A WebView implements the semantics — navigate/read/act/extract/screenshot/cookies — for the same tools, with the platform browser engine Android itself ships and updates. What it does NOT give (and what the docs must say so):

- **No CDP.** WebView exposes no DevTools protocol. Every operation goes through the app-owned driver server (HTTP on a loopback port) that owns the WebView instances. The harness never assumes CDP; the CDP attach config (`browserEngine.attachCdpUrl`) stays desktop-only.
- **No multi-tab parity, no screencast WebSocket, no extension/webMCP.** One page per bot session; the UI take-control surface is a real WebView view, not a frame stream.

**Placement (same seam as the Phase 4 computer and Phase 5 MCP):** the phone harness mounts a new seeded stdio MCP server, `android_browser`, run by the host's own Node binary from the extracted server dir, one per turn pipeline, pointed at per-bot session roots via env (`AB_SESSION_ROOT`, never credentials). The server talks to the app-side **driver server** (Kotlin, loopback HTTP, capability-token-authenticated) which owns WebView instances, cookies, storage, and screenshots. Approval rides the existing permission-card flow (chat-tool-approval); the seeded entry goes to every bot with `browser !== false` through the same `customMcp` path Phase 4 uses — with the result budget/mcp-gate applied so snapshots cannot flood context.

**Per-bot isolation:** one named profile per bot (hash of bot id, like upstream's restore key), each a separate WebView instance with its own `CookieManager` domain (per-profile data directory), localStorage and history confined to `files/browser-sessions/<bot>/`. No shared process state. Cross-bot leakage tests are part of the device matrix.

**Security invariants (enforced in the adapter, tested in CI + on device):** only http/https; loopback/link-local/metadata addresses refused (SSRF); no credentials in URLs; downloads only into the bot's workspace with sanitized filenames; no `addJavascriptInterface` bridge ever (JS evaluation returns text via `evaluateJavascript` only); the driver server binds 127.0.0.1, requires a per-boot capability token from the harness env, and never sees provider keys (the harness env carries paths/ports only — unchanged from Phase 4). External app launching, intents, and file-scheme URLs are refused.

**UI:** extend the existing Computer experience — the bot's Computer panel gains a Browser section (current URL, recent screenshot, last actions) and a take-control mode that attaches the same live WebView to a Compose view. Same visual language, watch-and-take-over like desktop.

**Status: IMPLEMENTED as designed.** The seeded `android_browser` stdio MCP server, the Kotlin WebView driver server (loopback + capability token), and per-bot session profiles are on device; the 45-check driver `scripts/test-android-browser.mjs` passes end to end on armeabi-v7a and arm64-v8a physical phones (model-driven browser loop, per-bot isolation, restart persistence, SSRF/error-page handling, clean cleanup). Evidence + fixed defects: `ANDROID_COMPATIBILITY.md` → `## Phase 7 — Browser`. What remains SUPPORTED WITH LIMITATIONS (by design, per above): no CDP, one page per bot session, no screencast stream.

## 14. Storage strategy

Keep upstream local-first file layout (`~/.openmausbot` → `files/openmaus/`): SQLite `messages.db` (FTS5) stays the transcript store; NDJSON per-thread event logs; config.json with "configured"-only secrets; per-bot workspaces. Backup/restore via existing `workspace-backup.ts` machinery (uses `node:sqlite` backup API — same engine dependency as Gate A). Do NOT replace the store for Android (reuse rule). Structured settings for the Android layer via existing DataStore preferences.

## 15. Security model

- Permission broker preserved: every risky action → Allow/Deny/Answer cards; no god mode; broadening stays explicit.
- Multi-level: Android permission → capability → bot → tool → action. Contextual permission requests (existing `PermissionRequests` infra).
- Sanitized exec env (PATH/HOME/TMPDIR/bot vars only); secrets Keystore-wrapped; path traversal/symlink escape tests; per-bot workspace isolation; hostile-MCP-input tests; sidecar's default-deny doctrine retained for any network-exposed surface (Remote computer).
- No hardcoded credentials anywhere (tests use mock providers/CLIs).
- Diagnostics page with structured logs (startup/runtime/providers/MCP/sandbox/browser/auth/background); secrets never logged.

## 16. Build strategy

- Fork branch `android-host` off upstream `8d8182ea`; enterprise/ excluded from APK; attribution + NOTICE retained; fork disclaimers added; trademark note (upstream LICENSING.md) documented as accepted risk.
- Server bundle: `pnpm build:server` → `dist-server/` packaged into APK assets (harness entry points + proxies per upstream's own packaging contract).
- APK: `./gradlew assembleDebug` (+ `assembleRelease` unsigned handover per upstream flow) from `android/`; host variant with own applicationId; CI workflow produces APK artifacts every push (fallback confirmed). Local toolchain gaps: Android SDK absent; JDK 25 present (AGP compatibility to be resolved in Phase 2 — pin JDK 17 if required).
- Do not require Node/pnpm/Termux/root/Docker on the device. Reproducible: pinned engine assets with integrity checks; large Tier-2 assets download post-install with verification.

## 17. Known platform limitations

- `node:sqlite`+FTS5 pins the embedded engine to new-generation Node; if no viable libnode, Gate A fallback (Kotlin harness) triggers.
- Background execution: no unlimited guarantees; routines = scheduler (source of truth) + WorkManager (persistence/wakeup), idempotent runs, foreground service for active turns.
- No root: no real VM; Tier 2/3 are userspace tiers with honest labels.
- `noexec` app dirs → all native binaries via `jniLibs`.
- Android 15+ dataSync FGS timeout → HarnessService chooses an appropriate FGS type; long-turn UX designed around it.
- Trademark: "OpenMausBot" name/mascot are upstream trademarks; fork adds disclaimers, no affiliation implied with xAI/OpenAI/Anthropic/Google.

## 18. UI migration map (review deliverable)

Rule: REUSE > EXTEND > ADAPT > REPLACE; replace only what fundamentally assumes a remote desktop host; replacements preserve appearance/interaction/terminology/identity.

| Existing (`android/`) | Verdict | Reason |
|---|---|---|
| `ui/RosterScreen`, `ChatScreen`, `MessageRow`, `MarkdownText`, `InlineMarkdown`, `TranscriptCardViews` | **KEEP** | Core product UI; consumes normalized stream frames already |
| `ui/PermissionRequests`, `QuestionCard`, `ExecutionFeedback`, `QueuedSendRow` | **KEEP** | Broker cards — the approval UX |
| `ui/ModelRules` + model picker, `ModelPickerRenderTest` | **KEEP** | Driven by registry describe() payload |
| `ui/CompanionTheme`, `Chrome`, `Haptics`, `Maus*` mascots, `SpeechBubble`, `RelativeStamp` | **KEEP** | Visual identity |
| `ui/Navigation`, `RootScreen`, `BotOverviewScreen`, `BotThread*`, `NewGroup/NewSection` sheets, `TaskSheet`/`TaskRules`, `RoutineEditorSheet` | **KEEP/EXTEND** | Add host-local surfaces (computer panel entry, teams) without redesign |
| `ui/AgentProfileSheet`, `ProfileRules`, `QuickRepliesEditor` | **EXTEND** | Add computer/skills/MCP/voice sections per bot |
| `ui/OnboardingScreens` + `OnboardingPreferences` | **ADAPT** | First-run = standalone flow; pairing becomes optional Remote-computer step |
| `ui/PairingScreen`, `QrScannerScreen`, `PairingHandoff`, `PendingPairing` | **ADAPT** | Keep for "Remote computer (optional)"; never required |
| `ui/SettingsScreen`, `SettingsPolicy` | **EXTEND** | + AI providers, MCP servers, computer selector, storage, diagnostics |
| `ui/ComputerScreen`, `ComputerPolicy` | **EXTEND** | Render phone-local computer (status/workspaces/browser/terminal/activity); This phone default |
| `ui/ConnectedAppsScreen`, `ConnectedAppsPolicy` | **EXTEND** | Point at local connectors API; keep marketplace UX |
| `browser/CloudDesktopBrowser` | **ADAPT** | Becomes bot-browser viewing surface; phone-local sessions |
| `dictation/SpeechDictation`, `audio/VoicePreviewPlayer` | **KEEP** | Already Android-native; extends to per-bot voice |
| `notifications/*` | **KEEP** | Already local; retarget from remote events to local SSE |
| `lifecycle/SessionLinger*` (25s anchor) | **KEEP** | Same shape works for local runtime transitions |
| `lifecycle/AlwaysOnConnectionService` + boot receiver | **REPLACE** | Purpose was keeping a remote pairing alive → `HarnessService` foreground host |
| `discovery/NsdDiscovery` | **KEEP (dormant)** | Only for optional Remote computer |
| `storage/KeystoreTokenStore`, DataStore prefs, `ChatPreferences` | **KEEP/EXTEND** | Extend to provider keys/MCP secrets with Keystore wrapping |
| `sharing/*` (share sheet in/out, transcript export) | **KEEP** | Platform glue, host-agnostic |
| `core/Client`, `Sse`, `Frames`, `Session`, `Store`, `Transcript`, `Models` | **KEEP/EXTEND** | Point at loopback authority; add host-only routes as needed |
| `core/Endpoint`, `Connection` policy, pairing invite parsing | **EXTEND** | Add trusted local authority; keep remote policy for optional pairing |
| `avatar/*` | **KEEP** | |
| MainActivity + OpenMausApp lifecycle | **ADAPT** | Starts/owns `HarnessService`; ProcessLifecycle logic flips from "connect to host" to "host is here" |

## 19. Phase log

- **Phase 0 (done):** `prompt.md` saved verbatim; upstream cloned (`8d8182ea`); fork branch `android-host`; this document created.
- **Phase 1 (done):** full server/Android/companion read; migration map (§18); host-side Gate A evidence (§7); Tier-2 spike protocol defined (§8); toolchain probed (Node 22 local / Node ≥22.5 engine requirement; JDK 25; no Android SDK → CI fallback). On-device Gate A half → Phase 2 kickoff.
- **Phase 2 (CLOSED — core host PROVEN on ARM32 and ARM64 devices):**
  - Embedded runtime assembled: Termux Node 26.4.0 (bionic-linked, no glibc) + dependency closure (node, libz, c-ares, sqlite3+FTS5, ffi, crypto/ssl 3, icu 78 split libs, libc++_shared) for **armeabi-v7a, arm64-v8a, x86_64**; transitive NEEDED closure verified `MISSING: []` per ABI; DT_NEEDED strings binary-patched to same-length `lib*_N.so` names (jniLibs legality); node renamed `libnode_host.so` and staged in `jniLibs` (packaged-manager extraction → exec-permitted `nativeLibraryDir`, no root).
  - Server shipped as `assets/host/server.zip` (3.0 MB, 280 files) via `scripts/prepare-android-host.mjs`; **enterprise layer excluded** (license carve-out; hook file `server/enterprise.js` is Apache-licensed and stays); stamped by SHA-256, extracted to app-private `files/host-server` on first run with zip-slip guard.
  - Android host layer (`android/app/.../host/`): `HostFiles` (provisioning), `HarnessHost` (process supervisor: spawn → health wait 120s cold/45s warm → watchdog 5×10s → bounded restart 2s/5s/10s ×3 → orphan adoption; controlled env with `LD_LIBRARY_PATH`; bounded output ring, no env/secrets logged), `HarnessService` (foreground, `dataSync`, START_STICKY), `StandalonePairing` (seeded loopback "This phone" Connection + client-side token; server auth = harness loopback rule with full owner scopes — verified in `server/request-auth.ts`), `HostStatus` (transparent failure states with output tails).
  - UI connection: existing Compose app unchanged; `OpenMausApp` wires decorated stores + starts `HarnessService`; fixed port 18799 (seeded pairing is persisted → deterministic port).
  - Artifacts: `app-armeabi-v7a-debug.apk` (102 MB), `app-arm64-v8a-debug.apk` (124 MB), `app-x86_64-debug.apk`, universal (313 MB) — all installable; per-ABI splits added.
  - Device test: `scripts/test-android-host.sh` (install → launch → HarnessHost logs → health via adb forward → bot fleet JSON → node process). **Result (Round 3, SM-A137F armeabi-v7a API 34): host is serving from the device ✓** — health `{"app":"openmausbot","pid":…}`, bot fleet from the device's own data dir, `messages.db` (`node:sqlite`+FTS5) created on-device, persistence across force-stop/reopen (same bot UUID), stale-lease recovery on device (reaped dead owner's symlink lease, re-acquired).
  - Root-cause rounds (full detail in ANDROID_COMPATIBILITY.md): Round 1 — `extractNativeLibs=false` AGP default left `nativeLibraryDir` empty → `useLegacyPackaging = true`. Round 2 — SELinux denies `link(2)` in app storage (EACCES), breaking upstream's hard-link publication at the lease **and** `environment-id` **and** both journal locks **and** attachment commits → shared compat layer `electron/fs-publish.mjs` publishes via relative symlink to a fully-written payload file (same atomic create-if-absent, same never-replace, reaper election preserved; `rename` deliberately not used), probe-gated so desktop behavior is unchanged; plus `OPENSSL_CONF=/dev/null` for the relocated Termux Node. Round 3 — green.
  - Dev-host finding: Android emulator 37.1.11 segfaults on this machine in all tested configurations (API 30 + 34 images, fresh AVDs, wiped state, both GPU modes; KVM OK) — local emulator verification blocked by an environment bug, documented in ANDROID_COMPATIBILITY.md.
  - Full status matrix: `ANDROID_COMPATIBILITY.md`.
- **Phase 3 (in progress — vertical slice through the existing Compose UI):**
  - **Scope guard:** Phase 2 evidence is FROZEN (both physical ABIs passed `scripts/test-android-host.sh`); no further architectural changes in this phase. Companion-remote remains an optional, dormant capability.
  - **Server-side contracts verified for the slice** (all pre-existing upstream routes, no host changes needed):
    - `POST /api/bots {name}` → 201 `{bot:{id,threadId,…}}` (server/index.ts:14202)
    - `PUT /api/config {openaiCompat:{url,key}}` → key is write-only; blank/absent key keeps the stored one (Client.kt mirrors this)
    - `POST /api/instances/openaiCompat/refresh-models` → `{instances:[{instanceId:"openaiCompat",models:[…]}]}`
    - `PATCH /api/bots/:id {modelSelection:{instanceId,model}}` (model picker path)
    - `POST /api/bots/:id/messages {text,threadId}` — the exact wire the UI's send path already uses (Client.kt:498)
    - `GET /api/events` SSE — the live stream the UI already renders; `/api/bots/:id/respond` for approval cards
  - **Auth finding (important):** the harness is not Electron, so `desktopMutationToken` is never delivered (it arrives via the Electron utility parent-port message). On Android the loopback rule therefore does NOT demand the desktop-owner capability for public mutations — loopback requests carry full `LOOPBACK_SCOPES`, which is exactly what the phone-local UI needs. The `x-openmausbot-companion-auth` mutation gate is likewise inert (no token configured). Consequence: mutations from the device-local UI and from the slice driver (same adb-forward loopback path) work with no new server code.
  - **Implemented (slice piece that genuinely did not exist):** local provider configuration UI. Client.kt: `updateOpenAICompat(url,key)`, `refreshOpenAICompatModels()`, `config()`; Session.kt: `saveOpenAICompatProvider()` (save + refresh models + re-hydrate through the existing actionError channel), `readProviderStatus()`; SettingsScreen: "Model provider" section (status row, endpoint row, Configure dialog with password field and blank-key-keeps-stored semantics) in the screen's existing visual language.
  - **Tests:** fixed 2 Robolectric failures (`SessionLingerServiceTest`) — `OpenMausApp.onCreate` now starts `HarnessService`, whose intent sat at the head of the shadow's started-service queue; tests now `clearStartedServices()` first (test-isolation fix, not a production change). Added Client wire tests: `openaiCompatSaveAndRefreshHitTheStandaloneProviderRoutes` (asserts PUT /api/config body incl. key, POST refresh-models, Bearer auth) and `openaiCompatSaveOmitsTheKeyWhenAbsentSoTheStoredOneSurvives`. `:app:testDebugUnitTest`, `:core:test` all green.
  - **Slice driver:** `scripts/test-android-slice.mjs [apk] [--key SK] [--stored-key] [--mock]` — one Node client owning the protocol contract (approval `behavior+requestId`, top-level `models.options`, SSE `data:` frames). Modes: config-layer default; `--key` real provider; `--mock` deterministic on-device provider scripting the agent through workspace/command/network/search tool turns. Proves install → health → bot → provider → chat → SSE → tool calls → approvals → single-host → force-stop persistence.
  - **Companion-assumption inventory (documented for later phase; NOT ripped out mid-slice):** remaining user-visible remote-computer copy is concentrated in Settings ("Computer" section framing, status strings "This phone is not paired with a computer"), SharePolicy ("Create one on your computer first", "Couldn't reach your computer"), ShareSheet ("Choose a computer"), RoutineRules ("on the paired computer"), and the onboarding unpaired-home branch. These stay correct when a Remote computer IS paired, so the cleanup is wording/flow priority, not deletion: reframe "This phone" as the primary computer, keep remote pairing as an explicit secondary action.
  - **Builds:** continuous per-ABI debug APKs rebuilt with the slice (v7a 59.5 MB, arm64 64.9 MB, x86_64 64.9 MB, universal 142.9 MB); device rounds: see ANDROID_COMPATIBILITY.md (single source of truth for statuses).
  - **Bug round (ARM32 device): provider-save 415.** The Settings dialog's
    save chain is `PUT /api/config` (typed body, fine) then body-less
    `POST /api/instances/openaiCompat/refresh-models`; the client's request
    factory gave empty bodies a null media type, so no Content-Type header was
    sent and the server's instance-action JSON guard answered 415
    "content-type must be application/json". Fix: one line — `EMPTY_BODY` is
    now typed `application/json` (safe for every body-less POST: `readBody`
    parses empty as `{}`, and the connector-authorize route has no gate).
    Regression coverage: `ProviderSavePathTest` drives the exact UI path at
    Session level and asserts the headers (red/green verified by temporarily
    reverting the fix). On-device reproduction + proof: headerless → 415,
    typed → 200; full dialog path both 200 with the openaiCompat instance
    `available` and the URL read back. Slice script fixed twice after device
    evidence: refresh-models curl now sends the header, and the SSE check
    counts `data:` frames (the server's frames have no `event:` field).
    **Slice result on SM-A137F: ALL CHECKS PASSED** (bot creation, provider
    config, chat 202, SSE 8 frames/8s, force-stop/reopen persistence).

## 20. Phase 4 — Local computer / execution environment

### 20.1 Upstream architecture findings (the map)

- **"Computer" mounts are stdio MCP processes.** `index.ts:6255` mounts the
  local computer as `gatedLocalComputer(cua, …)` → `local-computer-proxy.ts`
  → `runMcpBridge({command: <CUA driver>})`. The built-in browser is the same
  shape (`browser-engine.ts` spawning the agent-browser MCP binary). VPS and
  container computers likewise are MCP descriptors. There is no desktop-only
  tool protocol to replicate — the contract IS stdio MCP.
- **openai-compat engines mount MCP as native function tools.**
  `openai-chat.ts:358` calls `mountChatTools(turn.integrations, …)`
  (drivers/chat-mcp-tools.ts) which spawns each stdio server, lists its
  tools, validates args with Ajv, executes calls, and runs every call through
  `createChatToolApproval` → the existing UI permission cards. Capabilities:
  `customMcp: true` for this driver class (openai-chat.ts:527); custom mounts
  come from `customMcpServers(cfg, bot.mcpServers)` (config.json
  `mcpServers`, index.ts:6010) with `enabled` defaulting to true.
- **Spawn resolution**: `spawnCli` → `resolveCliSpawn` → `resolveWord` passes
  bare names to POSIX `spawn` (PATH lookup). The harness env already contains
  `nativeLibraryDir` in PATH — our own Node binary — and the env is controlled
  by `HarnessHost`.
- **Electron-only pieces** (NOT needed for Phase 4): desktop CUA drivers
  (darwin/win32 cjs), `ELECTRON_RUN_AS_NODE` hacks, the desktop-mutation
  token, browser-engine's Electron download path. The Linux CUA driver needs
  X11 tooling — NOT SUPPORTED on Android; screen control is out of scope.
- **Workspace**: CLI engines get `~/.openmausbot/workspaces/<botId>` via
  `supportsWorkspaceFiles()` — which currently **excludes `openai-compat`**.
  The Android computer gives this engine class a workspace through its own
  tools instead (upstream contract preserved: no driver surgery).
- **No upstream generic web-search tool exists** (only Codex's provider-side
  `web_search` opt-in). Search must be provided as a tool.

### 20.2 Phase 4 design (smallest honest vertical slice)

**Android Computer Adapter = one stdio MCP server** (`server/android-computer.ts`),
bundled into the APK's server.zip like every other entry point, run BY the
host's own Node, speaking the exact MCP contract every engine already speaks:

  - name: `android_computer` (legal MCP name; not reserved)
  - seeded host-side into `config.json mcpServers` on Android (idempotent:
    `enabled: true`, command = absolute path to the harness's own node
    (`/proc/self/exe`), args = `[<hostDir>/android-computer.mjs]`,
    env: `OMB_ANDROID_WORKSPACE` + `OMB_ANDROID_SANDBOX_BIN`), so
    `customMcpServers()` picks it up and the existing turn pipeline,
    approval cards, tool previews, and 50KB result budget apply unchanged.
  - tools (Phase 4A–4D):
    - `workspace_list` / `workspace_read` / `workspace_write` /
      `workspace_append` / `workspace_mkdir` / `workspace_move` /
      `workspace_copy` / `workspace_delete` / `workspace_stat` /
      `workspace_exists` — one sandbox: `<filesDir>/host/workspace/`,
      canonical-path containment (symlink + `..` + URL-encoded traversal
      all refused), path/directory argument size caps.
    - `run_command` — toybox/busybox allowlist interpreter: cwd forced into
      the workspace, timeout, 256KB output caps, env allowlist, denylist for
      dangerous paths/commands, no shell interpolation (argv spawn).
    - `http_fetch` — real Node fetch: method/url/headers/body, response
      status + headers + body (capped), timeouts, no credential env access.
    - `web_search` — DuckDuckGo HTML Lite endpoint, parsed to real results
      (title/url/snippet); the first live-internet capability.
  - permission model: rides the **upstream approval flow** (every
    android_computer tool call opens a permission card; `full` approval mode
    bypasses exactly as upstream allows). Destructive ops are additionally
    labeled in summaries. No new permission system.

**Sandbox rule**: only `<workspace>` is reachable; the data dir, provider
keys, pairing tokens and native libs are not (workspace lives outside the
harness `data/` dir; config paths are never passed to the proxy).

### 20.3 Honesty ledger (statuses at Phase 4 start)

| Upstream capability | Original implementation | Android implementation | Status |
|---|---|---|---|
| Local computer control (screen/mouse/keyboard) | Electron CUA driver (darwin/win32; linux X11 beta) | none — X11/Wayland-free environment | NOT SUPPORTED |
| Built-in browser (agent-browser, CDP) | Engine download + CDP via Electron | Chromium via WebView is Phase 4E, not this slice | NOT YET IMPLEMENTED |
| MCP servers (config mcpServers) | stdio/http processes via harness | same contract; android_computer is one such server | EXPERIMENTAL → proven on device |
| Web search | none generic (Codex provider-side only) | android_computer web_search (DuckDuckGo Lite) | EXPERIMENTAL → proven on device |
| Per-bot CLI workspaces | `supportsWorkspaceFiles` (excludes openai-compat) | workspace via android_computer tools, sandboxed | EXPERIMENTAL → proven on device |

---

## Phase 4 record — Android computer layer (implemented, ARM32-proven)

Architecture: the phone's execution environment ships as ONE upstream-shaped
MCP server. `index-android.ts` seeds `android_computer` into config.json
(idempotent, parser-validated) before the upstream server module loads; the
existing turn pipeline (chat-mcp-tools) spawns it over stdio via
`/proc/self/exe` and offers its 13 tools (10 filesystem, run_command,
http_fetch, web_search) as native function tools through the existing
approval pipeline. No new permission system, no new tool architecture — the
Android adapter is purely additive, desktop index.js untouched.

Sandbox: workspace = `<files>/host/workspace` (harness-provided AC_WORKSPACE;
`OMB_*` is deliberately harness-reserved, hence the AC_ prefix). resolveInside
blocks traversal/symlink/prefix escapes; commands are an absolute-path toybox
allowlist executed with cwd inside the workspace, capped output, timeouts;
network tools wrap fetch with cause-chained error descriptions so the model
sees DNS vs TLS vs refused vs timeout.

Evidence (SM-A137F, armeabi-v7a, API 34): adapter MCP probe 15/15 PASS on
device (incl. live HTTPS + live web search); full slice script ALL CHECKS
PASSED — bot create → mock-provider model options → SSE stream → model tool
call → approval card answered (`behavior+requestId` → `allowed-once`) →
`agent-proof.txt` written by the adapter → assistant reply → force-stop +
relaunch → bot + workspace file both intact under a new host pid. Server-side
contracts the hard way: /respond requires the card's requestId; model catalog
is top-level `models.options`; PUT /api/config hot-reloads the openaiCompat
instance (no restart needed).

Open items: ARM64 slice run (adapter is pure JS; Phase 2 boot already proven
there), real-paid-provider deep run (waiting on a valid key; current stored
OpenRouter key returns provider-side 401), 4E WebView browser foundation
(upstream agent-browser publishes no android-arm build — NOT SUPPORTED as-is).

## Phase 4 audit-fix record (post-audit pass)

Every audit gap closed in code, not prose:

- **Workspace root, one owner** — `HarnessHost.kt` passes `AC_WORKSPACE`;
  `index-android.ts` now *refuses to seed* the computer adapter when it is
  missing (the divergent `DATA_DIR/workspace` fallback is gone; a missing
  harness var is a loud error, not a forked sandbox).
- **`/respond` silence fixed** — `answerRequest` returns
  `{outcome:"unavailable", reason}` and the HTTP layer surfaces it
  (`server/index.ts`); a stale requestId now explains itself in the response
  body, the thread's activity chip, and the server log. Upstream-shape
  preserved (regression-tested in `index.test.ts`).
- **Tool registry table-driven** — `android-computer.ts` has one `ToolSpec`
  table; `tools/list` is derived, adding a tool is one row (no TOOLS/HANDLERS
  twin).
- **Truncation correctness** — oversized tool results shrink their *raw string
  fields* and re-serialize (`truncated:true`), so the frame is always valid
  JSON; cutting serialized JSON (the old `bounded()` on the stringified form)
  could split a `\uXXXX` escape and break the client's parse. Unit-tested.
- **Slice driver rewritten** — `scripts/test-android-slice.mjs` (Node) replaces
  the 340-line bash+python script; it owns the protocol contract in code and
  adds: agent turns driving workspace/command/network/search tools (via the
  on-device scripted provider `scripts/omb-openai-mock.cjs`), a
  single-host-process assertion, and requestId-tracked approvals.
- **Extended on-device probe** — `scripts/ac-device-probe.cjs` exercises ALL 13
  tools over real MCP frames plus timeout-kill, SIGTERM shutdown, output
  truncation, POST/redirect/response-headers/DNS-failure and encoded-path
  handling.
- **Dead scaffolding removed** — `.omb-spike/` deleted (204MB); the mock and
  probe now live in `scripts/` next to the driver that uses them.
- **Docs deduplicated** — `ANDROID_COMPATIBILITY.md` is the single source of
  truth for statuses/evidence (incl. the 4E A–E investigation); the phase log
  here records decisions, not repeated evidence.
