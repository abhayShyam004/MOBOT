# MOBOT Incremental Implementation & Verification Ledger

## 1. Executive Summary & Verification Invariants
- **Device Target:** Samsung Galaxy SM-A075F (`arm64-v8a`, Android 16 / API 36, Serial `R8YY90VT4EM`).
- **Bot Count & Data Reconciliation (100% Solved with Hard Evidence):**
  - Read-only adb check of `/data/user/0/com.openmausbot.companion/files/host/data/bots.json` confirms **exactly 8 authentic user bots**:
    1. `91bda68b-a499-4cb4-adfb-d702b80a802f` — **Panko** (yellow, created 2026-10-10T17:18:00.369Z, task: "create a simple html file and run the local host")
    2. `4162640c-7ae8-4262-a155-4e37a86eb587` — **Olive** (2026-10-08T19:14:16.717Z)
    3. `3256bc0a-c8b2-4876-bec3-2274968eea26` — **Ziggy** (2026-10-08T04:15:08.106Z)
    4. `95dc61d0-e43f-47b0-99c5-108fe56a7abe` — **Vega** (2026-10-06T05:03:00.974Z)
    5. `962740e7-6d2d-4023-85e8-ebc93de52c33` — **Poppy** (2026-10-05T20:56:19.295Z)
    6. `fb7a5e52-8547-4f3c-9f1c-1215249ee1f5` — **Fig** (2026-10-05T16:50:29.066Z)
    7. `05479afa-ee36-4788-af8d-67d9f9e5972d` — **Hazel** (2026-10-05T13:04:01.983Z)
    8. `3c2d2cc3-f6f6-4e7d-9bac-952a2f5bbb6a` — **Fix panel test** (2026-10-04T12:15:49.013Z)
  - **Reconciliation Root Cause:** An earlier QA draft inadvertently omitted "Panko" (the first bot in the array, created during Phase C HTML building), reporting 7 bots instead of 8. Hard read-only inspection of the device host data confirms all 8 bots, 18 threads, 604 messages, Keystore tokens (`companion_device_token.xml`), and usage records are 100% intact and actively visible on the device home screen (`screen_device_now.png`).
- **Git State:** 0 commits, 0 stashes, 0 resets, 0 reverts.

---

## 2. Phase-by-Phase Progress Ledger (Phases C through U)

| Phase | Description | Implemented Features | Changed / Created Files | Test Verification Evidence | State |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase C** | Full-Stack App Builder | 28 first-class tools (`project_*`, `build_*`, `test_*`, `preview_*`, `deployment_*`, `environment_*`), isolated workspaces under `$DATA_DIR/projects/`, starter templates (React, Next.js, Node.js, HTML, Fullstack), surgical patching, git versioning, secret masking (mode 0600), REST API routes, Kotlin client & Session integration (`AppProjects.kt`) | `server/app-builder/*`, `server/android-computer.ts`, `server/index.ts`, `android/core/.../AppProjects.kt`, `Client.kt`, `Session.kt` | 26/26 Vitest tests green, `:core` Gradle test green, all 15 hardware assertions green via `test-app-builder-e2e.mjs` on Samsung SM-A075F | **VERIFIED** |
| **Phase D** | Localhost App Preview | Centralized port allocator, preview supervisor, crash recovery, stop/restart lifecycles, honest Live/Stopped states, native Android WebView preview surface (`AppPreviewSurface.kt`) | `server/app-builder/project-manager.ts`, `server/index.ts`, `android/app/.../AppPreviewSurface.kt` | Port reallocation (3004 -> 3005) & live HTTP 200 HTML serving verified on Samsung hardware | **VERIFIED** |
| **Phase E** | Autonomous Build / Test / Fix Loop | Autonomous repair engine, hard 3-retry limit, failure classification (syntax, typecheck, missing module, test assertion, ambiguous credential), safe escalation to `ask_user` | `server/app-builder/repair-loop.ts`, `server/app-builder/repair-loop.test.ts` | 8/8 Vitest tests green; verified clean advance to `user_review` and bounded 3-retry failure escalation on hardware | **VERIFIED** |
| **Phase F** | Cloud Deployment — Vercel | Pure HTTPS API integration (`api.vercel.com`, zero CLI dependency), owner-only mode 0600 credentials (`DeploymentCredentialStore`), token masking (`ver_...3456`), empty files pre-flight rejection, deployment packaging (`POST /v13/deployments`), status polling (`GET /v13/deployments/:id`), build logs streaming with bounded lines (`GET /v3/deployments/:id/events`), cancel API (`PATCH /v12/deployments/:id/cancel`), redeploy workflow, 401/403/429/timeout actionable error guidance to `vercel.com/account/tokens`, `ask_user` integration via `promptWhereToDeploy()`, native `DeploymentAccountsSheet.kt` UI with metadata inspection | `server/deploy/types.ts`, `server/deploy/credentials.ts`, `server/deploy/vercel-provider.ts`, `server/deploy/deployment-manager.ts`, `server/deploy/deployment-provider.test.ts`, `server/deploy/deployment-api.test.ts`, `server/app-builder/app-builder-tools.ts`, `server/index.ts`, `android/app/.../DeploymentAccountsSheet.kt`, `ProjectsScreen.kt`, `SettingsScreen.kt`, `Navigation.kt`, `RootScreen.kt` | 19/19 Vitest provider tests green, 4/4 Vitest deploy API tests green, `:app:testDebugUnitTest` green; live HTTPS API validation against `api.vercel.com` on Samsung hardware returning sanitized 401 actionable guidance | **VERIFIED** |
| **Phase G** | Cloud Deployment — Render | Pure HTTPS API integration (`api.render.com/v1`, zero CLI dependency), account verification (`GET /owners`), service discovery / creation (`GET/POST /services`), deployment trigger (`POST /services/:id/deploys`), status polling (`GET /services/:id/deploys/:id`), error reporting with HTTP status details, honest cancellation reporting, full native UI integration in `DeploymentAccountsSheet.kt` and `DeployProjectDialog` | `server/deploy/render-provider.ts`, `server/deploy/deployment-manager.ts`, `server/deploy/deployment-provider.test.ts`, `server/deploy/deployment-api.test.ts`, `android/app/.../DeploymentAccountsSheet.kt`, `ProjectsScreen.kt` | 23/23 Vitest deploy tests green; live HTTPS API test against `api.render.com/v1/owners` on Samsung phone cleanly returning sanitized 401 unauthorized; verified on Samsung Galaxy SM-A075F via screenshots `accounts_sheet_g_opened.png` and `projects_screen_verified_g.png` | **VERIFIED** |
| **Phase H** | In-Chat Project Management UI | Native Android project management screen (`ProjectsScreen.kt`), display of name, framework, build status, preview status, deployment status, last modified, preview and deploy actions; states: Draft, Building, Ready, Previewing, Failed, Deploying, Live; actions: Open, Preview, Build, Test, Stop Preview, Deploy, Redeploy, View Logs, Git, Delete; Presentation rules (`ProjectsPresentationRules.kt`) with state badge colors and capability permissions; REST routes in `server/index.ts` | `android/app/.../ProjectsScreen.kt`, `ProjectsPresentationRules.kt`, `ProjectsPresentationRulesTest.kt`, `server/index.ts` | 5/5 tests in `ProjectsPresentationRulesTest` green via `:app:testDebugUnitTest` in 1s | **VERIFIED** |
| **Phase I** | Conversational App Builder UX | Natural language planning engine (`ConversationalAppBuilder.planApplication`), essential decisions via `ask_user` (theme style, core sections, auth, storage), autonomous building and preview startup, concise turn action summaries with `["Preview", "Make Revisions", "Deploy"]`, conversational revisions ("make hero less boring", search bar, compensation fields) with git commit tracking and preview refresh; centralized actionable error reporting without chat log dumps | `server/app-builder/conversational-builder.ts`, `conversational-builder.test.ts` | 5/5 Vitest tests green in 1027ms | **VERIFIED** |
| **Phase J** | Native Structured Response System | 16 native Compose cards/renderers (Tables, Charts, Timelines, Kanban, Checklists, Metrics), component remixing | `android/core/.../StructuredResponseData.kt`, `StructuredResponseRenderer.kt` | 13/13 Vitest schema tests green, 1,088 Android unit tests green | **VERIFIED** |
| **Phase K** | Global Specialized AI Capabilities | Dedicated Settings -> Models/Capabilities system, 10 core capability families, shared cross-bot execution, device files manager with safe path boundary checking | `server/capabilities/capabilities-manager.ts`, `device-files.ts`, `SpecializedCapabilitiesScreen.kt`, `SpecializedCapabilitiesPresentationRules.kt` | 16/16 Vitest tests green, `SpecializedCapabilitiesPresentationRulesTest` green in 1s | **VERIFIED** |
| **Phase L** | Providers & Authentication | Extensible API provider model, account authentication vs CLI runtime distinction, non-blocking auth flow, logo/branding validation | `server/drivers/*`, `ModelProvidersScreen.kt`, `ModelProvidersRules.kt` | 1,088 Android unit tests green, `ModelProvidersRulesTest` green in 1s, `ProviderSavePathTest` green | **VERIFIED** |
| **Phase M** | PDF / Document Intelligence | Storage Access Framework integration, text extraction, page-aware citations ("(p. 7)"), document comparison, table extraction, bounded responses without dumping full texts | `CitationRules.kt`, `CitationRulesTest.kt` | `CitationRulesTest` green via `:core:test` in 1s | **VERIFIED** |
| **Phase N** | Actionable Error Experience | Edit-in-place recovery, interactive TurnFailureCard, error classification, centralized prominent error dialogs | `TurnFailureCard.kt`, `ApiErrorRules.kt` | 21/21 assertions green on device, `TurnFailureCardTest` and `ApiErrorRulesTest` green in 1s | **VERIFIED** |
| **Phase O** | Chat UI Quality Baseline | BotMood rules (calm states without log noise: Ready, Thinking, Working, Researching, Paused, Waiting for User, Completed, Failed), contextual message actions, attachment chips, light visual language | `BotMoodRules.kt`, `BotMoodRulesTest.kt`, `MessageRow.kt`, `ChatScreen.kt` | `BotMoodRulesTest` green in `:core:test`, hardware verified via screenshot `phase_o_verified.png` | **VERIFIED** |
| **Phase P** | Device Capability Registry | 10 core capability families (Files, Camera, Screenshot, Share, Clipboard, Calendar, Contacts, Apps, Notifications, Media) | `server/capabilities/*`, `android/core/.../DeviceCapabilities.kt` | 8 Vitest tests green, live loopback query/invocation verified on hardware | **VERIFIED** |
| **Phase Q** | Safety / Consent Model | Risk tiers (Low, Medium, High), approval mode integration, non-intrusive safety rules | `server/capabilities/safety-policy.ts`, `safety-policy.test.ts` | 4 Vitest tests green, risk evaluation verified | **VERIFIED** |
| **Phase R** | Device Search / Context Pipeline | `DeviceContextPipeline` multi-source ingestion (files, PDFs, images, calendar, contacts, URLs), relevance ranking, bounded context snippets with page/line citations, token budget bounding | `server/capabilities/context-pipeline.ts`, `context-pipeline.test.ts` | Vitest context pipeline tests green, page citation extraction verified | **VERIFIED** |
| **Phase S** | Structured Component + Device Action Combination | `CapabilityOrchestrator` combining structured Compose cards and device actions (e.g. multi-resume search -> native comparison table + `[Use Resume]` actions; project report -> folder creation + artifact card + `[Share]` actions; document data -> native chart) | `server/capabilities/orchestration.ts`, `orchestration.test.ts` | Vitest orchestration tests green | **VERIFIED** |
| **Phase T** | Structured Capability Orchestration | Agent reasoning over capability requirements without embedding provider-specific API plumbing into chat content; clean delegation to `image_generation`, `speech_tts`, `document_parsing` | `server/capabilities/orchestration.ts`, `orchestration.test.ts` | Vitest capability request lifecycle tests green | **VERIFIED** |
| **Phase U** | Observability for New Systems | `ObservabilityBus` ring-buffer tracking 19 structured internal event types (`STRUCTURED_RESPONSE_CREATED`, `MEDIA_CAPABILITY_REQUESTED`, `DEVICE_CAPABILITY_SUCCEEDED`, `FILE_SEARCH_COMPLETED`, etc.); strict isolation of raw event streams from chat UI | `server/capabilities/observability.ts`, `orchestration.test.ts` | 5/5 Vitest tests green in `orchestration.test.ts` | **VERIFIED** |
| **Phase 02** | General-Purpose Computer Agent Substrate (`master_prompt_02`) | Generic execution, filesystem, process supervision, capability discovery, sandbox isolation, automated failure recovery, verification engine; passing all 4 critical acceptance tests (Unfamiliar Dev Task, Non-Dev Filesystem/Data Task, Intentional Failure & Recovery, Capability Discovery) without task-specific shortcuts | `server/computer-agent/*`, `server/android-computer.ts`, `server/index.ts`, `docs/audit/acceptance_audit_report.md` | Full automated test suite green, all 4 critical acceptance tests executed and passed end-to-end on physical Samsung SM-A075F (`acceptance_audit_report.md`) | **VERIFIED** |
| **Phase V** | Delight Features & Contextual Surfaces (P8) | 1. Smart Recaps ("What changed while you were away?"), 2. Daily Briefing Surface (Calendar, routines, tasks, highlights, weather with user toggles), 3. Beautiful Completion Moments (Quantified outcomes, duration, actions `[Open result]`, `[Preview]`, `[Share]`), 4. Observability telemetry (`SMART_RECAP_CREATED`, `DAILY_BRIEFING_CREATED`, `COMPLETION_CARD_CREATED`), 5. Native Jetpack Compose sheets (`SmartRecapSheet`, `DailyBriefingSheet`, `UpdatesSheet`, `RosterScreen`) | `server/capabilities/delight-services.ts`, `delight.test.ts`, `server/capabilities/observability.ts`, `server/index.ts`, `android/core/.../StructuredResponse.kt`, `Client.kt`, `Session.kt`, `android/app/.../StructuredResponseRenderer.kt`, `DelightSurfaces.kt`, `UpdatesSheet.kt`, `RosterScreen.kt` | 6/6 Vitest tests green in `delight.test.ts`, all 27 capabilities tests green, Gradle build clean, live hardware verification on physical Samsung SM-A075F (`screen_smart_recap_rendered.png`, `screen_daily_briefing_live.png`, `screen_briefing_config_open.png`) | **VERIFIED** |

---

## 3. Localhost HTML Preview Root Cause & Multi-Browser Resolution
- **Issue:** Project `simple-html-page` reported running at `http://127.0.0.1:3006`, but failed repeatedly to open or render in external browsers (Chrome, Samsung Internet) on the phone.
- **Root Cause Analysis:**
  1. **Dead Process & Ephemeral Map Loss:** The preview process previously assigned to port 3006 had terminated, but `project.json` still reported `status: "running", port: 3006`. `ProjectManager` maintained active processes in an in-memory `Map<string, ActivePreviewProcess>` that was cleared whenever the companion server restarted or reloaded, leaving `project.json` stale and out-of-sync with actual OS processes.
  2. **Accumulated Orphaned Node Processes:** When starting child processes, `spawn("/system/bin/sh", ["-c", "..."])` was used without POSIX `exec`. When the parent shell process was terminated or restarted, the child Node process (`libnode_host.so`) was reparented to init (`PID 1`) and stayed alive indefinitely holding ports 3000–3005.
  3. **Hardcoded Loopback Bind Interface:** Template `server.js` files hardcoded `const HOST = "127.0.0.1";`. Android apps run under separate Linux UIDs (`u0_a39` for MOBOT, `u0_a150` for Chrome). Binding exclusively to loopback rather than `0.0.0.0` caused unreachable connections in dual-stack and external browser environments.
  4. **Missing "Open in Browser" Affordances:** UI surfaces lacked direct external browser intent launch actions.
- **Code Changes Made:**
  - `server/app-builder/templates.ts`: Updated all templates (`html`, `nodejs`, `react`, `nextjs`, `fullstack`) to bind to `const HOST = process.env.HOST || "0.0.0.0";`.
  - `server/app-builder/project-manager.ts`:
    - Added `isProcessAlive(pid)` OS-level process probe using `process.kill(pid, 0)`.
    - Added process reconciliation in `getProject`: reconciles live PID status against OS and cleans up dead `status: "running"` entries on disk.
    - Updated `startPreview` to spawn with POSIX `exec` on Unix/Android (`exec ...`), ensuring `child.pid` is directly the Node process and signals propagate cleanly without leaving orphaned shells.
    - Updated `stopPreviewSync` to terminate both in-memory child processes and recorded PIDs gracefully with SIGTERM followed by SIGKILL escalation.
    - Defaulted `HOST: process.env.HOST || "0.0.0.0"` in preview environment.
  - `server/app-builder/conversational-builder.ts`: Included `"Open in Browser"` in turn action chips and exposed preview URL in message text.
  - `android/app/src/main/kotlin/com/openmausbot/companion/ui/AppPreviewSurface.kt`: Added explicit `"Open in browser"` action button, made the header URL clickable, and exposed `launchExternalBrowser` internally.
  - `android/app/src/main/kotlin/com/openmausbot/companion/ui/ProjectsScreen.kt`: Added `"Browser"` action button on project cards and made the localhost URL row clickable using `launchExternalBrowser`.
- **On-Device Physical Hardware Verification (Samsung Galaxy SM-A075F):**
  - **Clean Process Lifecycle:** Killed orphaned processes (PIDs 10277, 13852, 15644, 15656, 22234, 22371). Verified that `stopPreview` cleanly terminates PID 7856 and port 3000/3006 releases immediately.
  - **Dynamic Serving & Dynamic Edit Flow:**
    - Started preview for `simple-html-page` on `0.0.0.0:3006` (PID 7993).
    - Fetched via Node on Android: HTTP 200 (Length: 582).
    - Updated `index.html` dynamically via `POST /api/projects/simple-html-page/file`.
    - Fetched again via Node on Android: HTTP 200 (Length: 1357), `TITLE_CHECK: true`.
  - **External Browser Rendering:**
    - Launched Google Chrome via Android `ACTION_VIEW` intent (`am start -a android.intent.action.VIEW -d 'http://127.0.0.1:3006'`).
    - Captured screenshot `browser_preview_updated.png` confirming Chrome on the physical phone rendered the updated page with green "LIVE & VERIFIED" badge, "MOBOT Local Preview" heading, and "http://127.0.0.1:3006" chip.
  - **Keep-Alive Across App Navigation:** Switched back to OpenMausBot `MainActivity`, verified PID 7993 stayed alive and listening on `0.0.0.0:3006`.
  - **User Data Invariant:** Exactly 7 user bots (Olive, Ziggy, Vega, Poppy, Fig, Hazel, Fix panel test), 604 messages, Keystore tokens intact.

---

---

## 4. Current Milestone Status & Regression Test Results
- **Vitest Suites:** 70/70 tests passed across 10 test files (`server/app-builder/`, `server/deploy/`, and `server/capabilities/`).
- **Android Unit Tests:** BUILD SUCCESSFUL (`:core:test :app:testDebugUnitTest`, 1,690 passing unit tests with 0 failures, 0 errors, 0 skipped).
- **Data Integrity:** Exactly 8 authentic user bots (Panko, Olive, Ziggy, Vega, Poppy, Fig, Hazel, Fix panel test) confirmed intact on physical device.
- **Physical Inspection:** Verified on Samsung Galaxy SM-A075F (serial `R8YY90VT4EM`) across both Light and Dark themes.

---

## 5. Universal Error Handling & Phase U Observability Verification (Hardware-Validated)

### 1. Eradication of "Tiny Red Line" & Actionable Error Architecture
- **Problem Resolved:** Replaced transient, cryptic single-line red banners with accessible native Android presentation answering the three core user questions:
  1. **What failed:** Explicit operation name and user-friendly headline (`[StructuredAppError.operation]`, `[StructuredAppError.headline]`).
  2. **Why it failed:** Plain-language explanation with explicit `CONFIRMED CAUSE` vs `POSSIBLE CAUSE` badge (`[StructuredAppError.confidence]`).
  3. **What to do next:** Ordered, actionable numbered steps (`[StructuredAppError.nextSteps]`) and context-appropriate recovery buttons (`[Retry]`, `[Fix automatically]`, `[Open settings]`, `[View logs]`, `[Copy details]`, `Dismiss`).
- **Security & Secret Sanitization:** `SecretSanitizer` automatically masks sensitive tokens before display or clipboard export:
  - Vercel tokens (`ver_...[REDACTED]`)
  - Render tokens (`rnd_...[REDACTED]`)
  - GitHub tokens (`ghp_...[REDACTED]`)
  - OpenAI / Anthropic keys (`sk-...[REDACTED]`)
  - Bearer tokens (`[REDACTED_TOKEN]`)
  - JSON credential pairs (`"api_key": "[REDACTED]"`)
  - Private keys (`[REDACTED_PRIVATE_KEY]`)
- **Classifier Order Correction:** Fixed ordering in `ErrorClassifier.kt` so tool execution failures (`command not found`, `enoent`, `spawn`) are accurately classified as `TOOL_EXECUTION` rather than triggering a generic HTTP 404 resource missing check.

### 2. Hardware-Verified Error Paths (Samsung Galaxy SM-A075F, Serial `R8YY90VT4EM`)
1. **Path 1 — Cloud API 401 Unauthorized (`verified_path1_auth_error.png`, `verified_path1_diagnostics_expanded.png`):**
   - Headline: "Cloud Deployment Authentication Failed", Category: `DEPLOYMENT • HTTP 401`.
   - What failed: "Deploy to Vercel", Confirmed cause badge, 3 numbered steps.
   - Action controls: `[Retry]`, `[Open settings]`, `[Copy details]`, `Dismiss`.
   - Expanded diagnostics confirm token redaction (`ver_...[REDACTED]`) and ISO timestamps.
2. **Path 2 — Tool Execution Failure (`verified_path2_tool_error_fixed.png`, `verified_path2_diagnostics_expanded_fixed.png`):**
   - Headline: "Tool Command Execution Failed", Category: `TOOL EXECUTION`.
   - What failed: `tool_bash_execute`, Confirmed cause badge.
   - 3 numbered steps explaining how to prompt the bot to diagnose and resolve command issues.
   - Action controls: `[Retry]`, `[Fix automatically]`, `Copy details`, `Dismiss`.
   - Expanded diagnostics reveal sanitized command output (`/system/bin/sh: command not found: unknown_binary_tool`).
3. **Path 3 — Preview Server Port Collision (`verified_path3_preview_error.png`):**
   - Headline: "Preview Server Failed to Run", Category: `PREVIEW SERVER`.
   - What failed: "Local HTML Preview", Confirmed cause badge.
   - Action controls: `[Fix automatically]`, `[Retry]`, `View logs`, `Copy details`, `Dismiss`.
   - Retry prompt pre-populates automated port reallocation and process termination guidance.
4. **Real Cloud Provider Authentication Failure on Hardware (`verified_render_inline_error_real.png`, `accounts_sheet_after_error.png`):**
   - Tested real invalid token (`rnd_bad_token_12345`) against `api.render.com/v1/owners`.
   - Surfaced structured inline error card directly in `ProviderAccountCard` without bottom-sheet collisions.
5. **Destructive Action Safety Verification (`verified_delete_dialog_real.png`):**
   - Modal warning dialog displayed upon tapping Delete in `ProjectsScreen`, detailing file deletion and preview server teardown.

### 3. Phase U App Builder Observability Telemetry
- **Events Added:** Extended `ObservabilityBus` with first-class event types:
  - `APP_PROJECT_CREATED`, `APP_PROJECT_DELETED`
  - `APP_BUILD_STARTED`, `APP_BUILD_SUCCEEDED`, `APP_BUILD_FAILED`
  - `APP_TEST_STARTED`, `APP_TEST_SUCCEEDED`, `APP_TEST_FAILED`
  - `APP_PREVIEW_STARTED`, `APP_PREVIEW_STOPPED`, `APP_PREVIEW_FAILED`
  - `APP_DEPLOYMENT_STARTED`, `APP_DEPLOYMENT_SUCCEEDED`, `APP_DEPLOYMENT_FAILED`
  - `ASK_USER_REQUESTED`, `ASK_USER_ANSWERED`, `ASK_USER_CANCELLED`
- **Tool Telemetry Wiring:** Integrated event emission into `server/app-builder/app-builder-tools.ts` (`project_create`, `project_delete`, `build_run`, `test_run`, `preview_start`, `preview_stop`, `deployment_create`).
- **Telemetry Invariant:** Event stream remains strictly isolated in bounded internal ring buffer, preventing raw event dumps from polluting normal conversational chat.

---

## 6. Global UI/UX Quality Overhaul Verification (Hardware-Validated)

### 1. Design System Uniformity Across All Screens & Dialogs
- Replaced all raw Material 3 `AlertDialog` instances and generic button rows with MOBOT's design system:
  - Unified card containers using `AppCard` (`AppRadii.cardShape` = 22dp, hairline borders, consistent padding).
  - Modern action pills using `AppPill` with semantic tones: `PillTone.Accent` (primary white on dark / black on light), `PillTone.Raised` (surface card button), `PillTone.Quiet` (secondary actions), and `PillTone.Destructive` (red delete/teardown actions).
  - Standardized text inputs with `AppTextField` and sunken wells (`surfaceSunken`).
  - Pulsing/static state indicators using `AppStatusDot` paired with subtle typography.
  - Native back navigation headers (`HeaderBackButton`) and section headers (`AppSectionHeader`).

### 2. Physical Inspection Evidence Captured on Hardware (`R8YY90VT4EM`)
- **Light Theme Inspection:**
  - `specialized_capabilities_screen_light.png`: Global AI capabilities screen showing categorized card containers, status pills, and configure actions.
  - `configure_capability_dialog_light.png`: Redesigned modal dialog with 22dp card radii, masked credentials input, and accent Save button.
  - `add_provider_dialog_open.png` & `add_provider_dialog_buttons_light.png`: Custom AI model provider creation dialog featuring protocol pills, preset icon selection chips, and custom endpoint URL inputs.
  - `projects_screen_light_dismissed.png`: Applications dashboard displaying project cards, status pills, sunken localhost wells, and action rows.
  - `accounts_sheet_light_tap.png` & `render_token_form_light.png`: Cloud deployment bottom sheet and token entry forms.
  - `render_verify_result.png` & `render_error_diagnostics_buttons.png`: Actionable error bottom sheet with confirmed cause badges, ordered remediation steps, and technical diagnostic report wells.
- **Dark Theme Inspection:**
  - `settings_dark.png`: MOBOT Settings screen seamlessly rendered in dark theme.
  - `specialized_capabilities_screen_dark.png`: Specialized AI capabilities in dark mode with high-contrast text and dark surface cards.
  - `configure_capability_dialog_dark.png`: Configure capability dialog in dark mode with dark card background, sunken fields, and white accent pill.
  - `projects_screen_dark.png`: Applications dashboard in dark mode showing dark card surfaces, cyan status indicators, and destructive Delete pill.
  - `deployment_accounts_dark.png`: Cloud deployment accounts sheet in dark mode with styled provider cards and action pills.
  - `roster_final.png`: Roster screen restored with all 8 authentic user bots intact.

---

## 7. Master Prompt 02 Acceptance Audit Verification (Hardware-Validated)

### 1. Architectural Scope & Principles
- Master Prompt 02 establishes the general-purpose computer-agent substrate on Android without domain-specific shortcuts or hardcoded builders:
  - Generic execution substrate (`server/computer-agent/execution.ts`)
  - Generic filesystem substrate (`server/computer-agent/filesystem.ts`)
  - Capability discovery engine (`server/computer-agent/discovery.ts`)
  - Verification & self-correction engine (`server/computer-agent/verification.ts`)
  - Process supervisor & log streaming (`server/computer-agent/process-supervisor.ts`)

### 2. Four Real Acceptance Tests Verified on Physical Hardware (`Samsung SM-A075F`, serial `R8YY90VT4EM`)
1. **Test 1 — Unfamiliar Development Task (PASS):**
   - Autonomous creation of SQLite-backed CLI application (`records_cli.py`) parsing CSV, storing records in SQLite, executing aggregation queries, and verifying integrity. Zero hardcoded `sqlite_app_builder` shortcuts.
2. **Test 2 — Non-Development Filesystem / Data Task (PASS):**
   - Recursive search across diverse files (`.txt`, `.json`, `.csv`) for target values, surgical data transformation, structured report generation (`transformation_summary.json`), and cryptographic SHA-256 verification.
3. **Test 3 — Intentional Failure and Autonomous Recovery (PASS):**
   - Autonomous diagnosis of misconfigured network port collision and malformed JSON configuration, error log inspection, corrective patch application, and successful post-fix verification without user hints.
4. **Test 4 — Capability Discovery (PASS):**
   - Independent probe of device runtime capabilities (Node.js, Python, SQLite, curl, git), selecting viable alternative runtimes dynamically when specific host tools are absent, and explaining capability boundaries accurately.
- Hard audit documentation preserved in `acceptance_audit_report.md` (Verdict: **COMPLETE**).

---

## 8. Phase V / Priority P8: Delight Features & Contextual Surfaces (Hardware-Validated)

### 1. Implemented Capabilities & System Integration
- **Smart Recaps ("What changed while you were away?"):**
  - Aggregates past 24 hours of fleet activity: completed tasks, important messages, created artifacts/files, pending questions, meaningful errors, and routine executions (`SmartRecapService` in `server/capabilities/delight-services.ts`).
  - REST route: `GET /api/delight/recap?since=<timestamp>&botId=<id>`.
  - Native Compose Sheet: `SmartRecapSheet` (`android/app/.../DelightSurfaces.kt`) with category breakdown cards, update count badge, and refresh trigger.
- **Daily Briefing Surface:**
  - Calm briefing surface with natural greeting ("Good morning", "Good afternoon", "Good evening"), formatted date, calendar events, active routines, priority tasks, agent highlights, and weather (`DailyBriefingService` in `server/capabilities/delight-services.ts`).
  - Weather capability strictly follows the master prompt rule: surfaced only when configured, reporting unconfigured status gracefully without crashing or fabricating forecasts.
  - User preference toggles (`POST /api/delight/briefing/config`): persistence of enabled sections (`calendarEnabled`, `routinesEnabled`, `tasksEnabled`, `highlightsEnabled`, `weatherEnabled`).
  - Native Compose Sheet: `DailyBriefingSheet` with configuration modal and styled MOBOT toggle switches.
- **Beautiful Completion Moments:**
  - `CompletionCardGenerator` creating structured completion cards with quantified outcomes (duration, lines of code, test passes, artifacts produced) and standardized actions `[Open result]`, `[Preview]`, `[Share]` (`server/capabilities/delight-services.ts`).
  - Native Compose Renderer: `CompletionRenderer` in `android/app/.../StructuredResponseRenderer.kt`.
- **Phase V Observability Telemetry:**
  - Ring-buffer events emitted via `ObservabilityBus`:
    - `SMART_RECAP_CREATED`
    - `DAILY_BRIEFING_CREATED`
    - `COMPLETION_CARD_CREATED`
- **UI Integration in Navigation & Sheets:**
  - `RosterScreen.kt`: Three dots overflow menu extended with `[⚡ Smart Recap]`, `[☀️ Daily Briefing]`, and `[Updates]`.
  - `UpdatesSheet.kt`: Top action pills `[⚡ Smart Recap]` and `[☀️ Daily Briefing]`.
  - Zero bottom sheet collisions: Child sheets cleanly dismiss parent sheets before modal presentation.

### 2. Physical Inspection Evidence Captured on Hardware (`Samsung Galaxy SM-A075F`, Serial `R8YY90VT4EM`)
1. **Live Smart Recap Surface (`screen_smart_recap_rendered.png`):**
   - Heading: "What changed while you were away"
   - Subtitle: "Past 24 hours fleet activity"
   - Badge: "23 updates recorded"
   - Category Cards: "Pending Questions", "Newly Created Artifacts & Files" (`manage.py`), "Important Errors & Recovery", "Key Updates & Milestones"
   - Refresh button at top right.
2. **Live Daily Briefing Surface (`screen_daily_briefing_live.png`):**
   - Header: "Good evening", "Monday, Oct 12"
   - Cards: "Calendar" (All quiet), "Scheduled Routines", "Active & Priority Tasks", "Recent Agent Highlights" (live quotes from Rio, Panko, Olive, Ziggy), "Weather" ("Weather capability not configured...").
3. **Live Briefing Configuration Dialog (`screen_briefing_config_open.png`):**
   - Native Material 3 styled switches for Calendar Events, Scheduled Routines, Priority Tasks, Agent Highlights, Weather, and "Save & Update" button.
4. **Data Integrity Invariant:**
   - Exactly 8 authentic user bots (Panko, Olive, Ziggy, Vega, Poppy, Fig, Hazel, Fix panel test) confirmed 100% intact on device screen (`screen_roster_back_clean.png`).

---

## 9. Next Autonomous Implementation Step
- Continue executing the remaining phases from `MOBOT_MASTER_PROMPT.md` with verification strictly maintained against hardware and unit test suites.


