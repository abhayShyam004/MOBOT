# MOBOT PROJECT HANDOFF — READ BEFORE CHANGING ANYTHING

You are taking over an existing Android-first AI-agent project. The user has a real ARM64 Android phone connected. Your first job is to establish the actual repository/device state, understand what is already implemented, and report a trustworthy baseline. **Do not start implementing the future master prompt yet.** The user will provide a separate master implementation prompt after this handoff and baseline investigation are complete.

This is a continuity/handoff document, not proof that every historical claim below remains true in the current checkout. Verify current state. Do not blindly trust this note, git history, old logs, or previous agent summaries over live source/tests/device evidence.

## 1. Product identity and non-negotiable direction

The app is officially named **MOBOT** (formerly OpenMausBot Android / project based on `milind-soni/OpenMausBot`).

MOBOT is intended to be a standalone native Android AI-agent environment. The Android phone itself is the host, runtime, workspace, browser, coding environment, testing environment, and eventually local preview/deployment control plane.

Hard constraints:
- No PC/Mac dependency for normal use.
- No VPS dependency for the core app.
- No Termux dependency.
- No root.
- Target real ARM64 Android hardware; ARM32 is not the current validation target.
- Preserve the existing OpenMausBot architecture and functionality. Extend it; do not casually replace working subsystems with parallel implementations.
- Never claim a capability works merely because a button, class, tool, setting, mock, or test scaffold exists.
- Never fake provider/auth status, model availability, generated media, browser/computer state, preview state, deployment success, or device action completion.
- Safe operations should not trigger needless prompts. Meaningful external effects need appropriate approval, and destructive/high-impact actions need explicit approval, using the existing permission architecture. Do not create a second permission broker.
- Normal chat must remain clean: do not flood it with internal tool events, terminal/build logs, PDF dumps, orchestration chatter, or repeated progress messages. Use structured UI, task state, actionable dialogs, and artifacts.
- Important failures must be visible, understandable, and recoverable. Do not expose raw provider JSON/stack dumps as the main UX.
- The user is particularly concerned that coding agents prematurely declare work finished, cut scope, or claim success without sufficient verification. You must resist that tendency.

## 2. How to work with this user

The user expects complete, honest engineering work, not a quick cosmetic patch. Do not finish just because one happy-path test passes.

Required working style:
1. Inspect first; make a written inventory of actual state before modifying anything.
2. Identify current branch, HEAD, dirty/untracked files, recent commits, build setup, scripts, device identity, installed package/version, and existing test coverage.
3. Preserve user changes. Never reset, checkout over, clean, or discard uncommitted work without explicit authorization.
4. Do not rewrite large systems merely because they are unfamiliar. Trace existing implementations and extend the correct abstractions.
5. Work in small, coherent phases with explicit acceptance criteria.
6. After each phase run relevant tests, typecheck, lint, Android build/tests, and physical-device tests where applicable.
7. If something fails, diagnose it. Do not weaken assertions, skip tests, relabel failures, or replace live integration tests with mocks to get green results.
8. Keep a running status ledger: **verified complete / implemented but unverified / partially implemented / blocked / not started**.
9. Report exact commands, outcomes, test counts, APK path/hash if built, device used, and known limitations. Distinguish current evidence from historical reports.
10. Never say “done” unless the acceptance criteria are met. If blocked, say exactly what blocks progress and continue with independent work.
11. Do not implement the future master prompt until the user explicitly sends it after this handoff/baseline step. The file `MOBOT_MASTER_PROMPT.md` is the future scope document, not permission to start all those features now.
12. Do not make the user repeat context already supplied here. Ask only questions that are genuinely necessary.

## 3. Existing architecture and capabilities to preserve

Historical project work has established or substantially developed these areas. Verify each against the current checkout; do not assume the current source/device has all the same state.

### Android/runtime foundation
- Native Android app using Kotlin/Jetpack Compose.
- Embedded Node runtime and bundled native dependencies, with ARM64 Android as the primary target.
- No Termux requirement in the intended product.
- Foreground service/runtime lifecycle, process management, local server/client architecture, Android storage APIs, Room/SQLite, Keystore-backed secrets, and Android UI.
- A watchdog/helper (`scripts/await-phone.mjs`) was improved historically for startup/log/heartbeat handling. Verify it still exists and behaves correctly before relying on it.
- The app label was changed to MOBOT; earlier preview builds used “MOBOT Preview.” Verify the current installed/build label rather than assuming.

### Existing OpenMausBot product areas
Preserve working bots, chats/threads, model/provider configuration, MCP servers, connectors, browser, computer, memory, skills, routines, tools, artifacts, approvals/permissions, and foreground runtime.

### Provider/model work
- An OpenRouter configuration save UI issue was fixed historically.
- Provider identity/model selector work was done to avoid presenting unrelated providers as fake OpenAI-compatible wrappers.
- Provider/API configuration and account authentication are distinct concepts. Do not infer that a CLI being absent means a provider cannot authenticate; equally, do not invent OAuth/device-code flows or claim login works without implementing and verifying the real flow.
- New Chat should only expose genuinely usable provider/model choices, not a large catalog of unavailable entries.
- A 429 retry path was improved historically to use retries, but exhausted retries still once exposed raw upstream JSON in chat. The intended behavior is a prominent actionable error card/dialog with provider/model, clear explanation, and actions such as Retry, Change model, Provider settings / Save & Test. Preserve diagnostic details in logs, not raw output in the conversation.
- Some image-capable models may be image-only; do not assume all catalog models support text chat. Choose a valid text-capable model for text testing and report model capability limitations honestly.

### MCP and connectors
- MCP UI/API wiring and profile schema work was done historically, including fixing a strict bot-profile schema that omitted `mcpServers`.
- Connector work included Composio-related integration paths, catalogs, connected services, approval/request cards, OAuth resume machinery, per-bot gating, persistence and cleanup.
- Historical physical-device tests covered MCP/connector workflows, including approval/deny paths and persistence. Verify the current implementation and do not touch real connected GitHub/Supabase accounts or trigger real external writes without authorization.

### Browser, computer, and resource retrieval
- Android WebView/browser driver work was done. A WebView attachment/lifecycle issue was fixed by attaching it to the resumed Activity decor view; a duplicate WebView race was also fixed.
- The browser test driver had fixes around waking/foregrounding the app, stale `AB_DRIVER_PORT`, and curl false positives.
- A resource retrieval layer was developed historically: fetch/inspect/download/extract links/images; HTML/JSON/text/XML/PDF/images/generic files; redirects, streaming, limits, cancellation, content type/magic bytes; SSRF/private IP/DNS rebinding/redirect-to-private protections; path traversal/symlink protections; PDF extraction and honest treatment of scanned PDFs; browser-session integration and download lifecycle/artifacts/cache.
- There is a known limitation: the Android computer host did not have a true capture source for live computer frames, so the UI should honestly show no preview after a bounded wait rather than spin forever or pretend it has a frame.
- A recurring `android_computer_workspace_stat` issue was on the requested hardening list. Verify current status and fix only with a reproducible root cause.

### Ask-user mechanism
- A structured `ask_user` mechanism was historically implemented and verified on the ARM64 device.
- It supports single choice, multiple choice, free text, “other,” and confirmation, with task pause/resume, stable IDs, persistence across Activity recreation, and protection against duplicate answers.
- Historical device verification reported 53 checks with 0 failures; TypeScript and Android tests were green at that point. Some tests exercised the HTTP route rather than finger interaction; mock testing proved the mechanism, not whether a live model independently chooses to ask a question. Desktop/iOS cards were still v1 and were not part of the Android scope.
- **Do not restart or unnecessarily redesign ask_user.** Treat it as a foundation. Future structured forms should integrate with it rather than replacing it or creating a competing task-pause system.

## 4. Historical quality gates/results (NOT current proof)

At one historical release-candidate point, the team reported:
- ARM64 device: Samsung SM-A075F, device serial `R8YY90VT4EM`, API 36.
- Kotlin compile/test report: 932 passed, 0 failed at that point; later transcript reported Android `:app` 1015 and `:core` 563.
- TypeScript check 0 errors, oxlint 0 errors.
- One serial index suite 227/227, critical regression suite 102/102.
- Resource retrieval 41/41, browser 42/42, extended probes around 25–27 passing, and hardening UI workflows 7/7.
- Ask-user physical checks: 53/0 failures.
- A final APK and embedded server bundle matched at that historical point.
- Historical server ZIP SHA-256: `f925dfb6b7a5a053270547379fdcc039ceffb54313a4866c631aa50725cecf28`, size 5,850,786 bytes.
- Historical ARM64 APK SHA-256: `c66e1252363a4adf1afd8a02241da9c1101ac2f694d3323595a5e45d5c2662b6`, size 68,612,884 bytes.
- The source was described as HEAD `8d8182ea` plus 110 uncommitted branch files at that point.
- Historical known environmental/pre-existing issues included delta-context e2e, workspace-backup timeout, and engine-install sandbox PATH requiring an `OMB_EXTRA_PATH` shim.
- A race in turn admission was fixed by synchronously registering claim/generation/settlers/resource owner/busy flip before awaiting file extraction; a network-guard `family: wantsV6` fix was also reported.
- A model selection quirk existed where `sam-3.1` was image-only and `muse-spark-1.3` was a text-capable alternative.

**These values are historical breadcrumbs only.** The present repository may have moved on. Do not repeat these as current test/build status unless you independently verify them. Recompute the current hashes and current results.

## 5. Recent failed Freebuff experiment — intentionally parked

The user wants, eventually, to tell a MOBOT bot something like “open Freebuff in your terminal and implement X,” with MOBOT able to observe/interact with the coding agent.

The user tried the third-party Android adaptation `@nyxur/freebuff` v0.0.126 from MOBOT. The package installed and launched, but failed because it expects a Termux-specific glibc/`grun` runtime and reports Android ARM64 unsupported in this environment. It expects things such as `glibc-repo`, `glibc-runner`, `ripgrep`, and `git`, which the standalone MOBOT environment does not provide.

Decision: **leave Freebuff alone for now**. Do not install Termux, do not keep trying random unofficial adaptations, and do not make this the current task. The future investigation, when explicitly resumed, should inspect the official Freebuff repository/SDK/runtime and establish feasibility before changes. It must not be mixed into the current baseline or future master-prompt implementation without user direction.

## 6. Current device and immediate task

The user states the ARM64 Android phone is connected now. Confirm the actual device using the available Android/ADB tooling before testing. Do not assume a historical serial is still correct.

Your immediate task is a **handoff reconnaissance and baseline audit**, not feature implementation.

### Step A — Establish repository truth
- Print `pwd`.
- Inspect `git status --short --branch`, current branch, HEAD hash, recent commits, and diff summary.
- Inventory tracked modifications and untracked files without deleting or overwriting anything.
- Identify repository root, packages/workspaces, build system, scripts, Android modules, server bundle location, and existing documentation.
- Compare the actual master prompt file if present. The user will provide it as a later instruction; do not start implementing it now.
- Find any uncommitted changes that appear intentional and preserve them.

### Step B — Establish phone truth
- Run `adb devices -l` and identify the connected device.
- Read model, Android version/API, ABI, package ID, installed version, app label, and whether the app is currently installed/running.
- Check whether the device is reachable/unlocked and whether the current app build matches the local project. Do not uninstall/overwrite a user build without first recording what is installed and confirming it is safe.
- If there are multiple devices, do not guess; report them and use the clearly intended ARM64 device only if unambiguous.
- Check available storage and relevant log access if needed.

### Step C — Establish build/test truth
- Inspect the project's documented commands first. Do not invent commands when package scripts/Gradle tasks already exist.
- Run low-risk baseline checks in a sensible order: repository-specific typecheck, lint, focused tests, Kotlin compile/unit tests, APK build if feasible.
- Capture exact command, exit code, relevant test count, failures, and duration where practical.
- Do not start broad high-CPU suites concurrently if prior history suggests CPU contention/order dependence.
- Do not treat stale logs or old green reports as a substitute for running current checks.
- Do not repair unrelated failures during reconnaissance unless necessary to run the baseline; classify them and report them.
- Install to the connected phone only when the build artifact is known and installation is safe. Before replacing the installed APK, record current package/version and build artifact. Run smoke/physical tests for key existing flows if feasible.

### Step D — Audit architecture, don't refactor
Inspect where these existing concepts live and report exact file paths / entry points:
- Agent turn admission/orchestration and task lifecycle.
- ask_user pause/resume and persistent state.
- Provider/model configuration and availability.
- MCP and connector capability wiring.
- Browser/WebView and resource retrieval.
- Computer capability and current frame limitation.
- File/artifact/storage/secret handling.
- Permission/approval system.
- Foreground service/runtime and process ownership.
- Android Compose navigation/screens/theme.
- Existing tests and device test scripts.
- Server bundle packaging and APK build pipeline.

Produce a map of important modules and explain which parts are shared vs Android-specific. Do not add parallel systems.

### Step E — Produce a candid baseline report
The report must contain:
1. Current branch and HEAD.
2. Dirty/untracked file inventory and what must be preserved.
3. Connected device details.
4. Current installed app vs locally built app identity.
5. Baseline typecheck/lint/test/build results with exact counts.
6. What is verified working on the current device.
7. What exists in source but remains unverified.
8. Current known failures, flaky tests, environmental blockers, and limitations.
9. Key architecture map and entry points.
10. Immediate risks/regressions.
11. Recommended next step, but do not implement the later master prompt yet.

## 7. Anti-premature-completion rules

These rules are mandatory:
- Do not say “the project is ready” after only inspecting files.
- Do not say “all tests pass” unless all relevant tests actually ran and passed; list tests not run.
- Do not say a feature is complete because an API endpoint exists; verify end-to-end behavior.
- Do not say Android support works based on host tests alone.
- Do not use mocks as the only proof for real providers, OAuth, file access, media generation, notifications, WebView, or deployment.
- Do not hide flaky/failing tests behind summaries like “minor issues.”
- Do not silently reduce scope, omit difficult features, or replace requirements with a simplified approximation.
- Do not remove assertions, skip tests, relax validation, or change expected output simply to make tests green.
- Do not produce a giant speculative refactor. First baseline, then plan, then implementation in explicit phases.
- When a test cannot be run, state why and what evidence remains missing.
- Before declaring any phase complete, check the acceptance criteria against actual evidence and report each item as PASS / FAIL / BLOCKED / NOT TESTED.
- Keep going through diagnosis and verification; don't stop at the first plausible fix.
- If a task is too large for one turn, leave a precise continuation note with current state, remaining work, commands run, test results, and next action.

## 8. Relationship to the forthcoming master prompt

The user has an extensive file titled **MOBOT — MASTER IMPLEMENTATION PROMPT: Native Agentic Android Platform + App Builder + Structured UI + Device Intelligence** (approximately 3,744 lines in the uploaded copy). It contains, among other things:
- Notification deduplication/active-chat suppression.
- Built-in skill registry and upstream UI/UX Pro Max + Taste integration.
- Full-stack App Builder, project workspaces, localhost preview, build/test/fix loop, Vercel and Render deployment, Git/project management.
- Native structured response protocol with a registry and Compose renderers for tables, charts, timelines, Kanban, checklists, comparisons, decision matrices, dashboards, diagrams, maps, calendars, Gantt-like views, code/dev views, artifacts, forms, and rich media.
- Structured interactions that return events to the active agent; composable response trees; semantic cards; progressive disclosure; automatic representation selection; view switching; sources/citations; smart links; persistence/export/share/accessibility/security.
- Global shared specialized AI capabilities for image/video/audio generation and understanding, speech/TTS, and future modalities.
- Android device capabilities, device file access, natural-language file search, storage insights, downloads organizer, file watchers/routines, share sheet, clipboard/context, camera/screenshots, calendar/contact/URL/app/notification actions.
- PDF/document semantic understanding with page-aware citations where possible and rich artifacts rather than raw content dumps.
- Provider/auth correctness, clear distinction between API providers, account auth, and CLI runtime; honest availability and model capability reporting.
- Prominent actionable error UX for 429/quota/auth/model/network errors.
- Light-first, polished, accessible, customizable visual system and useful delightful features such as contextual actions, response remixing, smart recaps, daily briefing, and completion surfaces.
- Extensive physical ARM64 testing, observability, no-false-pass requirements, and a phased implementation order.

This master prompt is intentionally **not the current instruction to implement**. The user wants to send it after the new agent has understood the existing project and the current state. Do not begin implementing all 3,744 lines now. First finish reconnaissance and report the truth. When the user sends the master prompt as the active instruction, plan a staged rollout, preserve current working systems, and implement phases sequentially with verification.

## 9. First response required from you

Start by acknowledging that you understand the task is a handoff/baseline audit. Then immediately inspect the current repository and connected ARM64 device. Do not reply with only a plan or ask the user to paste more context. The user says the device is connected, so use the available tools to verify it.

Your first deliverable is a factual baseline report, not an implementation claim.
