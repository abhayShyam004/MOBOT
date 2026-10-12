# MOBOT — Current State Audit & Physical Device Dossier

**Audit Date:** 2026-10-09  
**Auditor:** Antigravity (Google DeepMind)  
**Target Hardware:** Samsung SM-A075F (`arm64-v8a`), Android 16 (API 36)  
**Package:** `com.openmausbot.companion` (App label: **MOBOT**)  
**Audit Type:** Physical Device In-Place Update & Exhaustive Interface Inspection  

---

## 1. Executive Summary

MOBOT is a standalone native Android application combining a Jetpack Compose frontend with a background Android Foreground Service (`HarnessService`) that executes an embedded Node.js runtime (`libnode_host.so`). It operates entirely on-device without requiring Termux, proot, PC connectivity, or root privileges.

### Key Audit Findings:
1. **In-Place Update & Data Preservation:** The freshly built ARM64 debug APK (`56dd5417...`) was installed as an in-place update over the pre-existing build (`e20729ce...`). All 8 configured bots, 553 messages across 18 threads, SQLite message database, room debate handoffs, and user preferences were verified 100% intact post-install.
2. **Embedded Runtime & Process Topology:** The app automatically extracted the updated server bundle (`5d0301ba...`) into app-private storage (`files/host-server/`), verified `server.version`, and spawned child process PID `5460` under companion app PID `5391`. The local host is healthy and serves `/api/health` and `/api/bots` over loopback port 18799.
3. **MCP Server Reachability & Tool Discovery on Hardware:** Live physical UI probes in Settings confirmed that both embedded MCP servers are functional and reachable, discovering and enumerating their tool catalogs:
   - `android_computer`: **Reachable, 29 tools enumerated** (workspace operations, shell execution, web search, PDF extraction, etc.; individual tool execution untested).
   - `android_browser`: **Reachable, 15 tools enumerated** (browser navigation, DOM inspection, clicking, typing, evaluation via Android WebView; individual DOM actions untested).
4. **Provider Configuration & Diagnostic Honesty:** The UI accurately reflects host CLI status, gateway configuration, and model enumeration (469 models enumerated for OpenAI-compatible gateway; 7 models enumerated for Codex). Engines without Android ARM64 CLI binaries (Grok, Kimi, Droid, Cursor, Claude, Antigravity, OpenCode) report `Unavailable` with the specific missing CLI binary rather than presenting non-functional login flows. End-to-end token generation / LLM prompt completion was untested to protect user transcripts and billing.
5. **UI & Theming Quality:** Light, Dark, and System themes switch instantly. Background art (Spring, Waves, Garden) renders cleanly behind surfaces. Chat bubbles properly parse Markdown, code syntax, citations, and collapsible multi-step tool execution folds.
6. **Visual Evidence:** 44 high-resolution physical device screenshots were captured across 5 subsystem categories and organized in [`docs/audit/screenshots/`](docs/audit/screenshots/).

---

## 2. Artifact & Hardware Identity Matrix

| Attribute | Verified Value | Evidence Method |
| :--- | :--- | :--- |
| **Device Model** | Samsung SM-A075F (`product: a07xx`, `device: a07`) | `adb shell getprop ro.product.model` |
| **Device Serial** | `R8YY90VT4EM` | `adb devices -l` |
| **Architecture / ABI** | `arm64-v8a` (64-bit ARM) | `adb shell getprop ro.product.cpu.abi` |
| **Android Version / SDK** | Android 16 / SDK 36 | `adb shell getprop ro.build.version.release` |
| **Display Metrics** | 720 x 1600 px, 300 dpi | `adb shell wm size`, `wm density` |
| **Available Storage** | 68 GB available out of 106 GB | `adb shell df -h /data` |
| **Package Name** | `com.openmausbot.companion` | `dumpsys package com.openmausbot.companion` |
| **App Name Label** | `MOBOT` | `android:label="@string/app_name"` |
| **Version Name / Code** | `1.0.0` / `10000` (`minSdk=26`, `targetSdk=37`) | `dumpsys package com.openmausbot.companion` |
| **Git Branch / HEAD** | `android-host` / `8d8182ea` | `git status`, `git rev-parse HEAD` |
| **Installed APK SHA-256** | `56dd54171ebddb7d4cb757e5468c790640075957e1f19350cd83dc1f96b59094` | `adb shell sha256sum base.apk` |
| **Installed Server Bundle SHA-256** | `5d0301ba408f7490721f35c4f3441a50fd78c3e74ef65c561084667b1fdd9b1d` | `cat files/host-server/server.version` |
| **App PID / Host PID** | `5391` (Parent App) / `5460` (Child `libnode_host.so`) | `adb shell ps -A` |

---

## 3. Pre-Install vs. Post-Install Comparison

| Aspect | Pre-Install State | Post-Install State | Delta Status |
| :--- | :--- | :--- | :--- |
| **APK Hash** | `e20729ce3aefed82e6d669e361939bee88deac419c7b908ecd4e7d2c1cb54598` | `56dd54171ebddb7d4cb757e5468c790640075957e1f19350cd83dc1f96b59094` | **Updated** (In-place update) |
| **Server ZIP Hash** | `429640475a76f3ef5f1aa44993254e6b9fe2257f5aff0858102eb26b2c3d1b00` | `5d0301ba408f7490721f35c4f3441a50fd78c3e74ef65c561084667b1fdd9b1d` | **Extracted & Activated** |
| **Package Last Update** | `2026-10-09 17:29:28` | `2026-10-09 18:55:52` | **Updated** |
| **Host Node PID** | `4237` (under App PID 3822) | `5460` (under App PID 5391) | **Clean Supervisor Restart** |
| **Configured Bots** | 8 bots | 8 bots | **100% Preserved** |
| **Total Stored Messages** | 553 messages | 553 messages | **100% Preserved** |
| **Total Distinct Threads** | 18 threads | 18 threads | **100% Preserved** |
| **User Preferences** | Appearance, onboarding, connection | Identical | **100% Preserved** |

### Device Lifecycle & State Continuity Timeline:
- **Phase 1 (Pre-Audit Baseline):** Device was running build `e20729ce...` (`lastUpdateTime: 2026-10-09 17:29:28`). Full sandboxed backup archive (`mobot_backup_pre_audit.tar`) was generated and verified.
- **Phase 2 (Authorized In-Place Installation, 2026-10-09 18:55:52):** Freshly built ARM64 debug APK (`56dd5417...`) was installed via `adb install -r -g` without wiping user data. The embedded server bundle (`5d0301ba...`) was automatically extracted to `files/host-server/` and Node host PID 5460 was spawned under companion PID 5391.
- **Phase 3 (Post-Install Evidence Validation & Ongoing Inspection):** The device has remained continuously in this verified updated state. No secondary/redundant APK re-installations, data clears, or database resets have occurred. All 8 bots, 553 messages, and 18 threads remain active and verified on hardware.

---

## 4. Backup & Data Preservation Verification

Prior to performing the in-place package update, a full backup archive was created from the app's sandboxed storage:
- **Archive Path:** `backups/mobot_backup_pre_audit.tar`
- **Archive SHA-256:** `70760e1ef3fc8caebaa7a20f15a34c8accbc48f6a47de3e924f7922b6e1b85d5`
- **Archive Size:** 26,446,336 bytes (25.2 MB)
- **Verified Contents:**
  - `files/host/data/config.json` (2,029 bytes)
  - `files/host/data/bots.json` (19,868 bytes)
  - `files/host/data/messages.db` (1,339,392 bytes)
  - `files/host/data/messages.db-wal` (4,181,832 bytes)
  - `files/host/data/messages.db-shm` (32,768 bytes)
  - `files/host/data/routines.json` (869 bytes)
  - `files/host/data/room-handoffs.json` (97,114 bytes)
  - `shared_prefs/com.openmausbot.companion_preferences.xml` (126 bytes)
  - `shared_prefs/openmaus.appearance.xml` (110 bytes)
  - `files/datastore/companion_connection.preferences_pb` (405 bytes)

### Preserved Bot Fleet Roster:
1. **Olive** (`4162640c...`): Color yellow, 0 skills, 0 custom MCPs. Holds Freebuff installation diagnostic transcript.
2. **Ziggy** (`3256bc0a...`): Color pink, holds incomplete turn with inline error card.
3. **Vega** (`95dc61d0...`): Color cyan, holds terminal `torlnk` torrent execution transcript and 3 active sub-threads.
4. **Poppy** (`962740e7...`): Color purple, 3 active threads.
5. **Fig** (`fb7a5e52...`): Color orange.
6. **Hazel** (`05479afa...`): Color red, holds Bengaluru work context and 3 threads.
7. **Fix panel test** (`3c2d2cc3...`): Color coral, holds Wikimedia image citation transcript.
8. **Quill** (`9c349164...`): Color pink, participates in multi-bot room debate.

---

## 5. Navigation & Screen Inventory

The application UI is structured in a clear, cohesive hierarchy:

```
Main Roster (RosterScreen)
├── Overflow Menu (New section) -> New Section Sheet (NewSectionSheet)
├── Search Mode (RosterScreen filter)
├── New Bot Action -> New Bot Sheet (NewBotSheet)
│   └── Provider & Model Selector (ModelSelector)
├── New Group Action -> New Group Sheet (NewGroupSheet)
├── Bot Item Click -> Chat Screen (ChatScreen)
│   ├── Header Bot Info Click -> Bot Profile Sheet (AgentProfileSheet)
│   │   ├── Memory Tab (MEMORY.md / SOUL.md editor)
│   │   ├── Model Override Picker (ModelSelector)
│   │   └── Avatar Customizer (Mascot / Shape / Color / Generation)
│   ├── Header Avatar Click -> Bot Overview (BotOverviewScreen)
│   ├── Header Computer Icon -> Computer Screen (ComputerScreen)
│   ├── Inline Step Fold -> Expanded Tool Steps (TranscriptCardViews)
│   ├── Slash Command Button -> Slash Command Picker
│   ├── Composer More (+) Button -> Actions Sheet (ComposerAttachments)
│   │   ├── Attach Photo / Document
│   │   ├── New Thread / Switch Threads (Threads Sheet)
│   │   ├── Watch Computer
│   │   └── Share Transcript (Markdown / JSON)
│   └── Group Chat Mode -> Multi-Bot Room Chat (ChatScreen)
└── Settings Gear Icon -> Settings Screen (SettingsScreen)
    ├── Appearance Section (Light / Dark / System, Background Art)
    ├── Notifications Section (Permission state, Always-on toggle)
    ├── AI: Model Providers -> Model Providers Screen (ModelProvidersScreen)
    │   ├── OpenAI-compatible config & testing
    │   ├── Account Sign-in Engines (Codex testing, CLI diagnostics)
    │   └── Add Custom Provider
    ├── Apps: Connected Apps -> Connected Apps Screen (ConnectedAppsScreen)
    │   └── Composio setup & service catalog (Slack, GitHub, Gmail)
    ├── Threads & Routines -> Tasks & Routines Screen (TasksRoutinesScreen)
    │   ├── Run Receipts list
    │   └── New Routine Button -> Routine Editor Sheet (RoutineEditorSheet)
    ├── Approvals (Tool calls: Never ask / Ask again toggle)
    ├── Conversations (Activity detail: Reduced / Quick replies)
    └── Developer: MCP Servers Section (McpSection)
        ├── android_computer card (Live Test button -> 29 tools)
        ├── android_browser card (Live Test button -> 15 tools)
        └── Add MCP Server / Paste Config Block
```

---

## 6. Physical Screenshot Evidence Index

All 44 screenshot files on disk were captured directly on the physical Samsung SM-A075F via `adb shell screencap -p` and saved with zero compression artifacts into categorized folders. Below is the comprehensive reconciliation of all 44 files on disk:

### 01. Roster & Navigation ([`docs/audit/screenshots/01_roster_navigation/`](docs/audit/screenshots/01_roster_navigation/))
- `01_initial_landing.png`: Main landing screen, top bar, bot roster list (Olive, Ziggy, Vega, Poppy).
- `02_roster_scrolled.png`: Scrolled roster showing Fig, Hazel, Fix panel test, Quill (demonstrates raw Markdown in snippets).
- `03_roster_overflow_menu.png`: Three-dot overflow menu displaying "New section".
- `04_new_bot_sheet.png`: Bottom sheet for creating a new bot with name, role, context.
- `05_search_ui.png`: Roster in search filter mode with active Cancel button.
- `06_new_group_sheet.png`: **Miscaptured file.** Actually contains an additional capture of Olive Chat (showing Freebuff execution failure history). The genuine New Group sheet is captured in `09_new_group_sheet.png`.
- `07_roster_threads_expanded.png`: In-roster expandable thread tree for Vega showing 3 nested threads (@Hazel, @Ziggy, main).
- `08_new_section_sheet.png`: Bottom sheet for organizing bots into named sections with bot checklist.
- `09_new_group_sheet.png`: Verified New Group bottom sheet with group name input and multi-bot member picker checklist.

### 02. Chat & Conversations ([`docs/audit/screenshots/02_chat_conversations/`](docs/audit/screenshots/02_chat_conversations/))
- `01_chat_olive.png`: Olive chat view displaying Freebuff execution failure history and quick replies.
- `02_chat_expanded_steps.png`: Unfolded view of "Ran 20 steps" showing tool execution details.
- `03_chat_slash_commands.png`: Slash command suggestion overlay above composer.
- `04_chat_composer_more.png`: Expanded `+` menu showing photo, files, threads, settings, export options.
- `05_chat_vega.png`: **Duplicate capture.** Byte-for-byte identical to `05_bot_details_memory/04_bot_overview_screen.png` (SHA-256 `692f056e4966...`). Captures the "What Vega does" Bot Overview screen (`BotOverviewScreen.kt`). The actual conversation view for Vega is in `06_chat_vega_real.png`.
- `06_chat_vega_real.png`: Vega actual conversation view with branch pager ("< 2 of 2 >") and terminal torlnk step fold.
- `07_threads_sheet.png`: Threads management sheet with thread archiving actions and Done button.
- `08_chat_ziggy_error_card.png`: Ziggy conversation displaying inline turn error warning card.
- `09_chat_fix_panel_test.png`: Fix panel test chat showing image download card and Wikimedia citation.
- `10_chat_quill.png`: Quill conversation transcript in multi-bot context.
- `11_group_chat_room.png`: Multi-bot room chat ("Quill & co.") with attached screen time screenshot analysis.

### 03. Settings & Providers ([`docs/audit/screenshots/03_settings_providers/`](docs/audit/screenshots/03_settings_providers/))
- `01_settings_main.png`: Top of Settings screen (Connection status, Theme toggles, Background art).
- `02_settings_this_phone_scrolled.png`: Middle of Settings (Notifications, AI Model providers, Connected apps).
- `03_settings_this_phone_bottom.png`: Lower Settings (Threads & Routines, Approvals, Activity detail).
- `04_settings_dev_section.png`: Developer section showing configured MCP servers and Add Server entry.
- `05_model_providers_screen.png`: Model Providers screen showing OpenAI-compatible (469 models) and Test gateway (3 models).
- `06_providers_scrolled.png`: Account sign-in engines section with honest CLI availability diagnostics for Grok, Kimi, Droid.
- `07_providers_bottom.png`: Cursor, Claude (unavailable CLI), and Codex (signed in) status.
- `08_providers_codex_section.png`: Codex runtime status ("Ready, 7 models available") and Antigravity/OpenCode diagnostics.
- `09_providers_codex_tested.png`: Codex provider tested state with verified live model availability.
- `10_connected_apps_screen.png`: Connected Apps screen showing Composio setup card and Slack/GitHub/Gmail cards.
- `11_settings_dark_theme.png`: Settings rendered in full Dark theme mode.
- `12_model_selector_new_bot.png`: Provider & model selector list in New Bot sheet.
- `13_codex_models_selector.png`: Full listing of 7 available Codex models (GPT-5.6 Sol, Terra, Luna, etc.).

### 04. Tools & Integrations ([`docs/audit/screenshots/04_tools_integrations/`](docs/audit/screenshots/04_tools_integrations/))
- `01_computer_screen_empty.png`: Computer screen displaying honest fallback ("Nothing to show yet - This bot's computer is only captured while it is working").
- `01_computer_screen.png`: **Near-duplicate capture.** Earlier capture of `01_computer_screen_empty.png` (differs only by notification bar clock pixels: bbox diff `(82, 23, 613, 47)`).
- `02_mcp_test_computer.png`: Live UI test result of `android_computer`: **reachable, 29 tool(s)**.
- `03_mcp_test_browser.png`: Live UI test result of `android_browser`: **reachable, 15 tool(s)**.
- `04_threads_routines_screen.png`: Threads & Routines screen showing Clock check run receipt.
- `05_routine_editor_sheet.png`: Routine Editor bottom sheet for configuring schedule, agent, and prompt.
- `06_notification_shade.png`: Android notification shade capture of foreground service.

### 05. Bot Details & Memory ([`docs/audit/screenshots/05_bot_details_memory/`](docs/audit/screenshots/05_bot_details_memory/))
- `01_bot_profile_sheet.png`: Olive bot profile sheet with system instructions, memory tab, and model selector.
- `02_bot_profile_scrolled.png`: Scrolled profile sheet showing avatar shapes (Circle, Rounded, Square, Mascot) and generator.
- `03_bot_memory_tab.png`: Memory tab in bot profile sheet.
- `04_bot_overview_screen.png`: Bot Overview screen showing reachability rules, capabilities, and recent changes (identical to `02_chat_conversations/05_chat_vega.png`).

---

## 7. Feature-by-Feature Behavior Inventory

| Subsystem / Feature | Source File | Status | Direct Hardware Evidence |
| :--- | :--- | :--- | :--- |
| **Foreground Service Lifecycle** | `HarnessService.kt` | **Verified working on device** | PID 5391 running; `host_status` notification active in `dumpsys notification`. |
| **Embedded Node Host Runtime** | `libnode_host.so`, `index-android.ts` | **Verified working on device** | Child PID 5460 executing `index-android.js`; `/api/health` returns HTTP 200. |
| **Bot Fleet Management** | `bots.json`, `RosterScreen.kt` | **Verified working on device** | 8 bots rendered on roster; counts, colors, last message previews match database. |
| **Thread Tree & Nesting** | `BotThreadTree.kt` | **Verified working on device** | In-roster expand/collapse reveals nested threads (@Hazel, @Ziggy) without page reload. |
| **Markdown & Code Rendering** | `MarkdownText.kt`, `InlineMarkdown.kt` | **Verified working on device** | Bold, bullet points, headers, inline code, and fenced blocks render properly. |
| **Tool Execution Step Folding** | `TranscriptCardViews.kt` | **Verified working on device** | Collapsed by default ("Ran 20 steps, Show"); expands cleanly into execution details. |
| **Composer & Quick Actions** | `ChatScreen.kt`, `ComposerReturn.kt` | **Verified working on device** | Quick reply chips (± Show diff, ✓ Run tests, ? Explain steps, /) render and focus. |
| **Slash Command Picker** | `ChatScreen.kt` | **Verified working on device** | `/` button opens command menu above keyboard. |
| **Computer Live Preview** | `ComputerScreen.kt` | **Verified fallback on device** | Honestly shows "Nothing to show yet" after bounded wait rather than hanging. |
| **`android_computer` MCP** | `android-computer.ts`, `McpSection.kt` | **Reachability verified on device** | Settings "Test" button verified server process launch and enumeration of **29 tools**; individual tool execution untested. |
| **`android_browser` MCP** | `android-browser.ts`, `BrowserDriverServer.kt` | **Reachability verified on device** | Settings "Test" button verified WebView driver loopback communication and enumeration of **15 tools**; individual DOM actions untested. |
| **Model Provider Configuration** | `ModelProvidersScreen.kt` | **Catalog enumeration verified** | Displays configured OpenAI-compatible gateway (469 models) and Test gateway (3 models); live prompt inference completion untested. |
| **Account Auth vs CLI Honesty** | `ModelProvidersScreen.kt`, `ApiErrorRules.kt` | **Verified working on device** | Accurately reports missing CLIs (`claude`, `grok`, etc.) and explains runtime requirements. |
| **Codex Account Integration** | `codex-native-runtime.ts` | **Catalog enumeration verified** | Account: Signed in; Runtime: Ready; lists 7 GPT-5.x models; prompt completion untested. |
| **Routine & Receipt Manager** | `TasksRoutinesScreen.kt` | **Verified working on device** | Displays Clock check completed run receipt; Routine editor sheet opens cleanly. |
| **Theme & Appearance Engine** | `CompanionTheme.kt`, `SettingsScreen.kt` | **Verified working on device** | Light, Dark, and System themes apply immediately across all screens; art backdrops render. |
| **Ask-User Question Protocol** | `QuestionCard.kt`, `shared/ask-question.ts` | **Verified via unit tests & UI** | 45 TS tests pass; Kotlin rules pass; QuestionCard component handles all 4 types. |
| **SSRF & Network Guard** | `server/android-net-guard.ts` | **Verified via unit tests** | 73 unit tests pass; blocks private IPs, rebinding, malicious redirects. |

---

## 8. Workflow Test Matrix (Functional Execution vs. UI Inspection)

To maintain verification integrity, workflows are divided into **Functional Execution** (where an underlying system or state mutation was fully executed and verified) and **UI Inspection / Navigation Transition** (where screen rendering, navigation, and input controls were physically validated, but underlying mutations like bot creation, message sending, or external OAuth were deliberately withheld to protect user data).

### A. Functional Execution Workflows (8 Workflows)

| # | Workflow | Steps Executed | Expected Outcome | Observed Outcome | Evidence Reference | Method | Status |
| :- | :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| 1 | **In-Place APK Update** | `adb install -r -g <apk>` | App updates without data loss or signature mismatch | Package updated; base APK hash `56dd5417...`; all user data intact | Dumpsys package, SHA-256 verification | Physically observed | **PASS** |
| 2 | **Embedded Server Extraction & Startup** | Launch app via `am start` | App unzips `host/server.zip` into app storage and spawns Node host | `server.version` matches `5d0301ba...`; child PID 5460 spawned; `/api/health` returns HTTP 200 | Shell `ps -A`, `cat server.version`, curl `/api/health` | Physically observed | **PASS** |
| 3 | **Interactive Theme Switching** | Tap "Dark" then "Light" in Settings | Compose theme dynamically changes palette | App immediately recomposes into Dark theme, then cleanly reverts to Light theme | [`01_settings_main.png`](docs/audit/screenshots/03_settings_providers/01_settings_main.png), [`11_settings_dark_theme.png`](docs/audit/screenshots/03_settings_providers/11_settings_dark_theme.png) | Physically observed | **PASS** |
| 4 | **`android_computer` MCP Probe** | Tap "Test" on `android_computer` card in Settings | Backend executes MCP stdio server and queries tool catalog | Output badge updates to `android_computer: reachable, 29 tool(s)` (reachability & tool catalog enumeration verified; individual tool executions untested) | [`02_mcp_test_computer.png`](docs/audit/screenshots/04_tools_integrations/02_mcp_test_computer.png) | Physically observed | **PASS (Reachability Probe)** |
| 5 | **`android_browser` MCP Probe** | Tap "Test" on `android_browser` card in Settings | Backend queries WebView browser driver via loopback | Output badge updates to `android_browser: reachable, 15 tool(s)` (reachability & tool catalog enumeration verified; individual DOM actions untested) | [`03_mcp_test_browser.png`](docs/audit/screenshots/04_tools_integrations/03_mcp_test_browser.png) | Physically observed | **PASS (Reachability Probe)** |
| 6 | **Tool Step Unfolding** | Tap "Ran 20 steps, Show" fold in Olive chat | TranscriptCardViews expands execution timeline | Step fold unfolds smoothly, revealing detailed tool parameters, output cards, and timestamps | [`01_chat_olive.png`](docs/audit/screenshots/02_chat_conversations/01_chat_olive.png), [`02_chat_expanded_steps.png`](docs/audit/screenshots/02_chat_conversations/02_chat_expanded_steps.png) | Physically observed | **PASS** |
| 7 | **In-Roster Thread Tree Expansion** | Tap "3 threads" disclosure under Vega on Roster | BotThreadTree expands child threads in place | Sub-thread tree expands smoothly showing @Hazel, @Ziggy, and main threads | [`07_roster_threads_expanded.png`](docs/audit/screenshots/01_roster_navigation/07_roster_threads_expanded.png) | Physically observed | **PASS** |
| 8 | **Foreground Service & Notification Registration** | Query system notification records via ADB | OS verifies active foreground service notification | Active ongoing notification `host_status` on port 18799 with `FOREGROUND_SERVICE` flag | `dumpsys notification`, [`06_notification_shade.png`](docs/audit/screenshots/04_tools_integrations/06_notification_shade.png) | Physically observed | **PASS** |

### B. UI Inspection & Navigation Transition Workflows (15 Workflows)
*(Underlying state mutations deliberately withheld to protect user bots, conversations, and credentials)*

| # | Workflow | Steps Executed | Expected UI Outcome | Observed UI Outcome | Evidence Reference | Method | Status |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| 9 | **Roster Navigation & Scroll** | Swipe up and down on Main Roster | Smooth list scrolling across all 8 bots | All 8 bots rendered with accurate status badges, color accents, and thread counts | [`01_initial_landing.png`](docs/audit/screenshots/01_roster_navigation/01_initial_landing.png), [`02_roster_scrolled.png`](docs/audit/screenshots/01_roster_navigation/02_roster_scrolled.png) | Physically observed | **PASS (UI Verified)** |
| 10 | **Chat View Navigation** | Tap Olive bot card on Roster | Opens ChatScreen with transcript history | Chat loaded; shows Freebuff failure history, Markdown text, and quick replies (live message send untested) | [`01_chat_olive.png`](docs/audit/screenshots/02_chat_conversations/01_chat_olive.png) | Physically observed | **PASS (UI Verified; Message Send Untested)** |
| 11 | **Composer More Actions Menu** | Tap `+` button in composer | Bottom sheet with attachment & thread tools | Sheet opened cleanly displaying 8 actions (attachment upload & file dispatch untested) | [`04_chat_composer_more.png`](docs/audit/screenshots/02_chat_conversations/04_chat_composer_more.png) | Physically observed | **PASS (UI Verified; Attachment Action Untested)** |
| 12 | **Slash Command Suggestion Picker** | Tap `/` button above keyboard | Suggestion menu opens above composer | Overlay appeared cleanly displaying `/diff`, `/test`, `/explain` commands | [`03_chat_slash_commands.png`](docs/audit/screenshots/02_chat_conversations/03_chat_slash_commands.png) | Physically observed | **PASS (UI Verified)** |
| 13 | **Computer Screen Idle Fallback** | Tap computer icon in chat header | Bounded wait followed by honest empty notice | Displays "Nothing to show yet - This bot's computer is only captured while it is working" (active live streaming untested) | [`01_computer_screen_empty.png`](docs/audit/screenshots/04_tools_integrations/01_computer_screen_empty.png) | Physically observed | **PASS (UI Verified; Live Streaming Untested)** |
| 14 | **Bot Profile Sheet Navigation** | Tap bot name in chat header | Opens AgentProfileSheet | Sheet opened with System Instructions, Memory tab, Model overrides, and Avatar customizer (profile edit untested) | [`01_bot_profile_sheet.png`](docs/audit/screenshots/05_bot_details_memory/01_bot_profile_sheet.png), [`02_bot_profile_scrolled.png`](docs/audit/screenshots/05_bot_details_memory/02_bot_profile_scrolled.png) | Physically observed | **PASS (UI Verified; Mutation Untested)** |
| 15 | **Settings Navigation** | Tap gear icon on Roster | Opens SettingsScreen | Settings screen rendered cleanly with Connection, Theme, Background, AI, Apps sections | [`01_settings_main.png`](docs/audit/screenshots/03_settings_providers/01_settings_main.png) | Physically observed | **PASS (UI Verified)** |
| 16 | **Model Providers Screen Navigation** | Tap "Model providers" in Settings | Shows provider gateways & CLI diagnostics | OpenAI gateway (469 models), Test gateway (3 models), and CLI availability diagnostics rendered (prompt inference untested) | [`05_model_providers_screen.png`](docs/audit/screenshots/03_settings_providers/05_model_providers_screen.png), [`06_providers_scrolled.png`](docs/audit/screenshots/03_settings_providers/06_providers_scrolled.png) | Physically observed | **PASS (Catalog Enumerated; Inference Untested)** |
| 17 | **Connected Apps Screen Navigation** | Tap "Connected apps" in Settings | Shows Composio setup prompt & catalog | Composio project key setup card and Slack/GitHub/Gmail cards rendered (external OAuth connection untested) | [`10_connected_apps_screen.png`](docs/audit/screenshots/03_settings_providers/10_connected_apps_screen.png) | Physically observed | **PASS (UI Verified; OAuth Untested)** |
| 18 | **Threads & Routines Screen Navigation** | Tap "Threads & Routines" in Settings | Shows routines list & run receipts | Displayed Clock check run receipt and routines list (background trigger untested) | [`04_threads_routines_screen.png`](docs/audit/screenshots/04_tools_integrations/04_threads_routines_screen.png) | Physically observed | **PASS (UI Verified; Execution Untested)** |
| 19 | **Routine Editor Sheet Navigation** | Tap "New routine" icon button | Opens RoutineEditorSheet | Bottom sheet opened with agent picker (Olive), prompt input, and schedule selector (routine creation untested) | [`05_routine_editor_sheet.png`](docs/audit/screenshots/04_tools_integrations/05_routine_editor_sheet.png) | Physically observed | **PASS (UI Verified; Creation Untested)** |
| 20 | **New Bot Sheet Navigation** | Tap "+" button on Roster | Opens NewBotSheet | Bottom sheet opened with Name, Role, Context inputs and Model Selector (bot creation untested) | [`04_new_bot_sheet.png`](docs/audit/screenshots/01_roster_navigation/04_new_bot_sheet.png) | Physically observed | **PASS (UI Verified; Creation Untested)** |
| 21 | **Model Selector Inspection** | Scroll model list in New Bot sheet | Lists available models and providers | Lists Grok, Kimi, Droid, Claude, and 7 Codex models | [`12_model_selector_new_bot.png`](docs/audit/screenshots/03_settings_providers/12_model_selector_new_bot.png), [`13_codex_models_selector.png`](docs/audit/screenshots/03_settings_providers/13_codex_models_selector.png) | Physically observed | **PASS (UI Verified)** |
| 22 | **New Section Sheet Navigation** | Tap overflow -> "New section" | Opens NewSectionSheet | Bottom sheet opened with section name input and bot selection checklist (section creation untested) | [`08_new_section_sheet.png`](docs/audit/screenshots/01_roster_navigation/08_new_section_sheet.png) | Physically observed | **PASS (UI Verified; Creation Untested)** |
| 23 | **New Group Sheet Navigation** | Tap "New group" card on Roster | Opens NewGroupSheet | Bottom sheet opened with group name input and multi-bot member picker checklist (group creation untested) | [`09_new_group_sheet.png`](docs/audit/screenshots/01_roster_navigation/09_new_group_sheet.png) | Physically observed | **PASS (UI Verified; Creation Untested)** |


---

## 9. Visual UI/UX Critique Grounded in Physical Screenshots

1. **Information Density & Contrast (Roster):**
   - The Roster ([`01_initial_landing.png`](docs/audit/screenshots/01_roster_navigation/01_initial_landing.png)) presents a clean layout with pastel avatar colors and readable typography.
   - *Observation:* The subtitle snippet truncates multi-line text cleanly, but long status messages with Markdown bolding (`**Termux’s...**`) render with raw asterisks in the roster preview row.
2. **Step Collapse Usability (Chat):**
   - Folding complex tool runs into "Ran 20 steps, Show" ([`01_chat_olive.png`](docs/audit/screenshots/02_chat_conversations/01_chat_olive.png)) keeps chat clean and readable.
   - When expanded ([`02_chat_expanded_steps.png`](docs/audit/screenshots/02_chat_conversations/02_chat_expanded_steps.png)), the step timeline provides necessary technical transparency without dominating the view.
3. **Computer Screen Fallback Honesty:**
   - The Computer screen ([`01_computer_screen_empty.png`](docs/audit/screenshots/04_tools_integrations/01_computer_screen_empty.png)) cleanly explains why no preview is available rather than showing a spinning loader or blank black frame.
4. **Settings Hierarchy Clarity:**
   - Settings ([`01_settings_main.png`](docs/audit/screenshots/03_settings_providers/01_settings_main.png)) groups controls logically into Connection, Appearance, Notifications, AI, Apps, Approvals, and Developer sections.
   - One minor UX issue: The Settings screen is lengthy and would benefit from a sticky top search bar or quick-jump tabs for faster navigation to Developer/MCP options.
5. **Model Providers Diagnostic Transparency:**
   - The Model Providers screen ([`06_providers_scrolled.png`](docs/audit/screenshots/03_settings_providers/06_providers_scrolled.png)) clearly states which engines have missing CLIs (e.g., `` `claude` CLI not found ``). It does not present fake login buttons.

---

## 10. Functional Defects, Warnings & Confusing Behaviors

### Confirmed Defects:

1. **Raw Markdown Delimiters in Roster Snippets:**
   - **Behavior:** Roster message previews display unparsed Markdown delimiters (backticks `` ` ``, code fences ` ``` `, asterisks `**`) instead of stripped plain text.
   - **Code Location:** [`RosterScreen.kt:918-924`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/ui/RosterScreen.kt#L918-L924) passes `summary.preview` directly as `activity` to `BotRow` in [`AppComponents.kt:581-585`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/ui/AppComponents.kt#L581-L585), which renders `Text(text = activity)` without Markdown regex stripping or inline styling.
   - **Reproduction Steps:**
     1. Open app to Main Roster (`RosterScreen`).
     2. Observe the preview row under bots whose last message begins with Markdown syntax.
   - **Evidence:**
     - [`01_initial_landing.png`](docs/audit/screenshots/01_roster_navigation/01_initial_landing.png): Olive snippet renders `` `@nyxu... `` with literal backtick characters.
     - [`02_roster_scrolled.png`](docs/audit/screenshots/01_roster_navigation/02_roster_scrolled.png): Fig snippet renders ` ```text... ` with literal fenced code block characters.
   - **Impact:** Cosmetic clutter in the roster list.

2. **Monolithic Scroll Structure in Settings Screen:**
   - **Behavior:** The Settings screen is a single vertical scroll container spanning over 4 full display heights with no top search, section tabs, or jump anchors.
   - **Code Location:** [`SettingsScreen.kt:149`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/ui/SettingsScreen.kt#L149) (`.verticalScroll(rememberScrollState())`) wraps all settings items (Connection, Appearance, Notifications, AI, Apps, Threads & Routines, Approvals, Conversations, Developer MCP) into one unpartitioned column.
   - **Reproduction Steps:**
     1. Tap the gear icon in the Roster header to open Settings.
     2. Attempt to reach Developer MCP settings or Connected Apps.
     3. User must swipe vertically 4 times down the display.
   - **Evidence:** Documented across 4 sequential physical captures:
     - [`01_settings_main.png`](docs/audit/screenshots/03_settings_providers/01_settings_main.png): Top (Connection, Theme).
     - [`02_settings_this_phone_scrolled.png`](docs/audit/screenshots/03_settings_providers/02_settings_this_phone_scrolled.png): Mid (Notifications, AI).
     - [`03_settings_this_phone_bottom.png`](docs/audit/screenshots/03_settings_providers/03_settings_this_phone_bottom.png): Lower (Threads, Approvals).
     - [`04_settings_dev_section.png`](docs/audit/screenshots/03_settings_providers/04_settings_dev_section.png): Developer (MCP Servers).
   - **Impact:** Slower access to developer tools and lower discoverability on mobile.

### Inaccessible Screens, Untested Features & Evidence Gaps:

1. **`TerminalSurface` Idle Inaccessibility:**
   - `TerminalSurface.kt` is implemented and integrated in [`RootScreen.kt:489-520`](file:///run/media/abhay/Abhay/vsCODE/moblot/android/app/src/main/kotlin/com/openmausbot/companion/ui/RootScreen.kt#L489-L520), but only renders dynamically when a live terminal session exists in `TerminalSessions` (`live.isNotEmpty()`). Because no background bot was actively running a terminal task during idle audit, no static UI route exists to reach the terminal surface.
2. **State-Mutating Actions Withheld (Safe Audit Requirement):**
   - **Bot Creation:** `NewBotSheet.kt` form was inspected, but "Create" was not submitted to prevent modifying `bots.json`.
   - **Section Creation:** `NewSectionSheet.kt` form was inspected, but "Save" was not submitted.
   - **Group Creation:** `NewGroupSheet.kt` form was inspected, but "Create" was not submitted.
   - **Routine Creation:** `RoutineEditorSheet.kt` form was inspected, but "Save" was not submitted.
   - **Live Chat Message Dispatch:** Message composition controls and slash commands were inspected, but test prompts were not sent to existing bots to protect database and transcript history.
   - **Thread Deletion:** `threads_sheet.png` archive actions were inspected, but threads were not deleted.
3. **External Network & Service Withholding:**
   - External OAuth flows in Connected Apps (Slack, GitHub, Gmail via Composio) were not connected.
   - Live streaming computer video in `ComputerScreen.kt` was verified in honest idle fallback; active frame rendering was not tested as it requires an active running task.
   - Live token generation was not run across third-party providers.

### Non-Defects / Expected Behaviors Verified:
- **Freebuff Failure Transcript in Olive Chat:** Expected behavior from a previous third-party package experiment; package correctly failed due to missing Termux glibc runtime.
- **Offline Engines in Providers Screen:** Accurately marked unavailable due to missing ARM64 host binaries.
- **Computer Preview Idle State:** Accurately displays idle notice because live screen streaming requires an active running task.

---

## 11. Security, Privacy & Secret Handling Observations

1. **Keystore & Secret Isolation:**
   - API keys and tokens are stored in private host app storage (`files/host/data/config.json`).
   - The UI displays `Configured` badges without revealing secret strings or tokens in plaintext.
   - In screenshots and UI dumps, no API keys or credential hashes are leaked.
2. **SSRF Protections on Device:**
   - `android-net-guard.ts` actively validates all outgoing URLs, rejecting private IPs, loopback aliases, link-local addresses, and malicious redirect loops.
3. **Workspace Isolation:**
   - `android-computer-sandbox.ts` strictly enforces containment within `AC_WORKSPACE` for all file operations.
4. **Android Permissions:**
   - The app operates entirely in standard non-root userspace.
   - Notification permissions are requested transparently; foreground service uses an ongoing silent notification channel (`host_status`).

---

## 12. Runtime & Embedded Server Health

- **Operating System:** Linux (Android 16 userspace, kernel 6.19)
- **App PID:** `5391` (`com.openmausbot.companion`)
- **Embedded Node PID:** `5460` (`libnode_host.so`), PPID `5391`
- **Memory Footprint:** App resident set ~230 MB; Node host resident set ~124 MB
- **Health Endpoint:** `GET /api/health` returns `{"app":"openmausbot","pid":5460,"static":false}` in <10 ms over loopback.
- **Logcat Diagnostics:** Clean supervisor startup; zero fatal exceptions or ANRs logged during the entire audit session.

---

## 13. Baseline for Future Work (What Must Not Regress)

1. **Embedded Host Architecture:** Must remain completely standalone on-device (no Termux or PC dependency).
2. **Data Continuity:** Future database migrations or schema additions must preserve existing SQLite messages and bot records.
3. **Permission Broker Discipline:** Safe actions proceed smoothly; sensitive/destructive external effects route through the existing approval card system (`chat-tool-approval.ts`).
4. **Chat Cleanliness:** Normal chat must remain free of raw terminal logs, unparsed JSON dumps, or internal orchestrator chatter.
5. **Honest Capabilities:** Never present a provider or model as available unless its execution path is functional and verified.

---

## 14. Final Inspection Checklist

- [x] Pre-install backup created and verified (`mobot_backup_pre_audit.tar`)
- [x] In-place APK update executed and verified on Samsung SM-A075F (`56dd5417...`)
- [x] Embedded server extraction verified (`server.version` matches `5d0301ba...`)
- [x] Main Roster and all 8 bots inspected
- [x] Roster search filter inspected
- [x] New Bot sheet and Model Selector inspected
- [x] New Section sheet inspected
- [x] New Group sheet inspected
- [x] In-roster Thread Tree inspected (Vega threads)
- [x] Bot Overview screen inspected
- [x] Bot Profile & Settings sheet inspected (Memory, Model, Avatar)
- [x] Chat screen inspected across multiple bots (Olive, Vega, Ziggy, Fix panel test, Quill)
- [x] Tool step folding/unfolding inspected
- [x] Slash command picker inspected
- [x] Composer More (+) actions sheet inspected
- [x] Threads management sheet inspected
- [x] Multi-bot Group Room chat inspected
- [x] Computer preview screen inspected (honest fallback verified)
- [x] Settings screen inspected (all sections)
- [x] Theme switching verified (Light / Dark)
- [x] Model Providers screen inspected (API providers, CLI diagnostics, Codex)
- [x] Connected Apps screen inspected (Composio, Slack, GitHub, Gmail)
- [x] Threads & Routines screen and Routine Editor sheet inspected
- [x] Developer MCP servers live UI test executed (`android_computer` 29 tools, `android_browser` 15 tools)
- [x] Notification shade and foreground service verified (`HarnessService`)
- [x] 44 screenshots captured and categorized
- [x] Machine-readable inventory created (`MOBOT_CURRENT_STATE_INVENTORY.json`)
