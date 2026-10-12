# PROJECT: OpenMausBot Android — Fully Standalone Native Agent Platform

You are working on a fork of:

https://github.com/milind-soni/OpenMausBot

Your job is to transform this project into a **fully standalone Android application distributed as a working APK**.

This is NOT a companion app.

This is NOT a remote-control client.

This is NOT a mobile web wrapper for the desktop application.

The final APK must be capable of operating as the **actual OpenMausBot host/runtime on an Android phone**, with the phone itself acting as the bot's computer.

A PC, Mac, VPS, cloud VM, or another device must NOT be required for normal operation.

A remote computer connection may exist as an OPTIONAL capability that the user can explicitly enable, but the application must be completely functional without one.

---

# 1. PRIMARY OBJECTIVE

Create:

**OpenMausBot Android**

An Android-native, standalone fork that preserves the functionality, mental model, UI/UX, data model, agent architecture, bots, chats, channels, memory, skills, connectors, MCP servers, permissions, routines, browser/computer capabilities, voice features, and team functionality of OpenMausBot as closely as technically possible.

The phone becomes:

* the OpenMausBot host
* the agent harness
* the local data store
* the local bot computer
* the MCP host
* the skill runtime
* the browser host
* the permission broker
* the scheduler
* the credential store
* the app UI
* the primary execution environment

Internet access is still allowed and expected for AI providers, OAuth, SaaS connectors, cloud APIs, etc.

"Standalone" means that no second computing device is required.

---

# 2. READ THE REPOSITORY BEFORE MODIFYING IT

Before making significant changes:

1. Inspect the complete repository.
2. Read:

   * `AGENTS.md`
   * `CONTRIBUTING.md`
   * `README.md`
   * `server/contracts.ts`
   * `server/index.ts`
   * all files under `server/drivers/`
   * all files under `server/harness/`
   * `src/`
   * `skills/`
   * `android/`
   * `electron/`
   * connector-related implementation
   * MCP-related implementation
   * routines/scheduler implementation
   * persistence/storage implementation
   * browser/computer implementation
   * authentication/provider implementation
3. Map the actual current architecture.
4. Identify what is:

   * platform-independent
   * desktop-specific
   * Node-specific
   * Electron-specific
   * browser/UI-specific
   * provider-specific
   * cloud-dependent
5. Do NOT blindly port desktop code.
6. Do NOT rewrite functionality merely because you dislike the current implementation.
7. Preserve existing behavior wherever possible.
8. Make architectural changes only where Android requires them.

The repository's own contributing guide identifies `server/contracts.ts` as the architectural center of the project and describes the split between drivers, harness, API, React UI and Electron-specific capabilities. Preserve those conceptual boundaries.

---

# 3. NON-NEGOTIABLE END RESULT

At the end there must be an installable APK.

The project is not complete until:

```bash
./gradlew assembleDebug
```

or the appropriate final Android build command succeeds.

Produce the final APK in a clearly documented location such as:

```text
android/app/build/outputs/apk/debug/
```

Also document the exact build command.

The APK must launch on a real Android ARM64 device.

Do not declare success merely because TypeScript compiles.

---

# 4. CORE DESIGN PRINCIPLE

Treat OpenMausBot as a cross-platform agent platform rather than an Electron application.

The desired architecture is conceptually:

```
                OPENMAUSBOT

                     |
              Agent abstraction
                     |
          +----------+----------+
          |                     |
    Android Runtime       Desktop Runtime
          |                     |
   AndroidComputer        ElectronComputer
   LinuxSandbox           LocalDesktop
   AndroidTools           CUA Driver
   AndroidBrowser
          |
   AI Provider Layer
          |
 +--------+--------+---------+
 |        |        |         |
```

OpenAI  Anthropic  Google    Other
OAuth   OAuth/API  Auth/API  providers
|
+--------------------------------+
|
Connectors / MCP / Skills
|
Android-local execution

The Android implementation must become a first-class runtime, not a special hacked mode.

---

# 5. PRESERVE OPENMAUSBOT'S CORE CONCEPTS

The following must remain first-class concepts:

## Bots

Every bot must retain:

* name
* title
* description
* system prompt/personality
* model
* provider
* conversation state
* memory/context
* skills
* MCP tools
* connected applications
* computer/environment
* permissions
* working directory
* voice configuration where applicable
* bot-to-bot communication

Bots should continue behaving like independent contacts.

---

# 6. PRESERVE CHATS, CHANNELS AND ROOMS

Retain all existing conversation structures.

A user must be able to:

* create bots
* rename bots
* edit bot profiles
* duplicate bots
* delete bots
* hide bots
* pin bots
* create channels
* rename channels
* archive channels
* configure channel members
* maintain independent transcripts
* maintain channel-specific instructions
* maintain channel-specific working directories
* run tasks
* resume tasks
* switch tasks
* search conversations
* preserve conversation IDs
* preserve bot-to-bot communication

Existing transcript/event semantics should remain compatible wherever possible.

---

# 7. PRESERVE THE EXISTING EVENT/HARNESS MODEL

OpenMausBot currently has a canonical runtime model based around its provider contracts, harness, and event bus.

Do not throw this architecture away.

Create an Android implementation of the harness/runtime.

Prefer:

```text
shared contracts
        |
        +---- desktop implementation
        |
        +---- Android implementation
```

rather than creating an unrelated second application.

Canonical events should continue to represent things such as:

* assistant output
* streaming deltas
* tool calls
* tool results
* permission requests
* failures
* task lifecycle
* browser actions
* computer events
* bot-to-bot communication
* completion
* interruption

The existing UI should continue consuming normalized runtime events.

---

# 8. ANDROID APPLICATION ARCHITECTURE

Use Android-native infrastructure where appropriate.

Preferred baseline:

* Kotlin
* Android Gradle Plugin
* Jetpack
* Jetpack Compose where a UI port is necessary
* Android Service / Foreground Service for active long-running agent work
* WorkManager for scheduled/background routines
* Android Keystore for secrets
* Room/SQLite for persistent structured data
* Android Storage APIs for files
* WebView/Chromium-backed browser capability where appropriate

However:

DO NOT rewrite the entire existing UI unnecessarily.

First determine whether the current React/Vite UI can be retained inside an Android WebView while the underlying runtime becomes Android-native.

If preserving the existing UI using the current React application is practical, do that.

The priority is:

1. preserve existing visual design and UX
2. preserve functionality
3. minimize unnecessary rewrites
4. make the execution/runtime genuinely Android-native

If a WebView-based UI is used, it must still communicate with the Android runtime locally.

It must NOT depend on an external OpenMausBot server.

---

# 9. TRANSPORT LAYER

The existing desktop application communicates with the harness over HTTP and SSE.

Preserve this conceptual API where possible.

On Android, choose the best architecture after inspecting the repository.

Preferred order:

### Option A — embedded local runtime

Run the compatible OpenMausBot server/runtime completely inside the Android process/application environment.

### Option B — Android-native harness implementing the same API

If the Node runtime cannot be reliably embedded, implement the equivalent harness in Kotlin while preserving the existing API contracts and semantics.

### Option C — embedded JavaScript runtime

If this is substantially more practical, use an embedded JavaScript engine to execute platform-independent OpenMausBot logic.

But do NOT assume Node.js support.

Current Node.js documentation explicitly states that Android is not a supported platform. Validate every Node-on-Android approach experimentally before making the entire project depend on it.

Do not spend the entire project fighting an unsupported runtime.

The Android application must have a dependable production architecture.

---

# 10. IMPORTANT: DO NOT FAKE LOCAL EXECUTION

Never implement:

```text
Android UI
   ->
remote OpenMausBot server
```

and call that the Android version.

That violates the core requirement.

The phone itself must host the agent runtime.

The app must continue working when:

* no PC is running
* no Mac is running
* no VPS is running
* no local desktop OpenMausBot instance exists
* the user has never connected another device

---

# 11. ANDROID LOCAL COMPUTER

This is one of the most important parts.

Every bot should have a local computer/environment on the phone.

Create a capability abstraction such as:

```text
ComputerProvider
```

with implementations conceptually like:

```text
AndroidComputer
AndroidLinuxSandbox
CloudComputer
RemoteComputer
DesktopComputer
```

For Android:

```text
Bot
 |
 +--- Android Computer
       |
       +--- filesystem
       +--- shell
       +--- processes
       +--- browser
       +--- scripts
       +--- package/runtime environment
       +--- screenshots
       +--- tool execution
```

The Android computer is the default.

---

# 12. LOCAL LINUX ENVIRONMENT / "VM"

The desktop version provides a Local VM capability.

On Android, reproduce the PURPOSE of that capability rather than blindly reproducing the desktop implementation.

The bot needs an isolated Linux-like execution environment in which it can:

* execute shell commands
* create/read/write files
* run scripts
* run Python
* run JavaScript where practical
* run Node-compatible tooling where possible
* run MCP servers
* run CLI tools
* use git
* maintain its own working directory
* maintain persistent state
* install supported packages
* execute browser automation tooling
* run long-lived processes when allowed

Use a tiered architecture.

Preferred:

```text
Android
 |
 +--- Linux/VM backend
       |
       +--- strongest isolation available on device
```

If true hardware virtualization is available and practical, evaluate Android's virtualization facilities.

If a complete VM is too expensive/unreliable for the target device, use a rootless Linux userspace/container-style environment.

Do not require root access.

Do not modify the user's phone OS.

Do not unlock the bootloader.

Do not require root.

The Android version must work on ordinary consumer devices.

---

# 13. LOCAL ENVIRONMENT STRATEGY

Create a dedicated abstraction:

```text
ExecutionEnvironment
```

with operations conceptually like:

```text
create()
destroy()
start()
stop()
exec()
readFile()
writeFile()
listFiles()
spawn()
kill()
getStatus()
getScreenshot()
```

Each bot should have its own environment or isolated workspace.

At minimum:

```text
/data/user/0/<package>/files/openmaus/
    bots/
        <bot-id>/
            workspace/
            runtime/
            browser/
            skills/
            mcp/
            logs/
```

Do not expose unrestricted Android app-private directories directly to agents.

The agent gets only the scoped working directory.

---

# 14. BOT SANDBOXING

Every bot must have an isolated execution context.

Bot A must not automatically gain access to:

* Bot B's files
* application secrets
* credentials
* unrelated conversations
* other bot workspaces
* Android private app storage
* arbitrary databases

unless explicitly granted.

Design permissions at multiple levels:

```text
Android permission
      ↓
OpenMausBot capability permission
      ↓
Bot permission
      ↓
Tool permission
      ↓
Specific action
```

---

# 15. PERMISSION BROKER

Preserve the existing OpenMausBot approval philosophy.

Actions such as:

* shell execution
* file modification
* deletion
* external communication
* connector actions
* account actions
* browser actions
* Android actions
* installing packages
* launching external apps
* microphone/camera usage

must be able to flow through a permission broker.

The user interface should provide actions analogous to:

```text
Allow
Deny
Answer
```

Do not silently grant high-risk capabilities.

Do not create a "god mode" by default.

---

# 16. ANDROID CAPABILITIES AS TOOLS

Create an Android-specific tool namespace.

Conceptually:

```text
android.files.*
android.browser.*
android.share.*
android.intent.*
android.calendar.*
android.contacts.*
android.clipboard.*
android.notifications.*
android.camera.*
android.microphone.*
android.storage.*
android.app.*
```

Only expose capabilities that Android permits and that have been implemented correctly.

Every capability must use the Android permission system appropriately.

Examples:

```text
android.files.read
android.files.write
android.files.list
android.browser.open
android.browser.navigate
android.browser.click
android.browser.type
android.browser.extract
android.browser.screenshot
android.share.text
android.calendar.create
```

Do NOT expose capabilities merely as fake tool names.

They must actually work.

---

# 17. BROWSER

Preserve browser functionality.

The Android implementation should have a proper browser abstraction.

Primary Android implementation may use Android WebView/Chromium facilities if this produces the most reliable architecture.

The browser should support:

* isolated sessions
* persistent sessions
* navigation
* page loading
* DOM inspection
* text extraction
* clicking
* typing
* form interaction
* screenshots
* JavaScript execution where appropriate
* links
* downloads
* authentication cookies/session persistence
* per-bot browser state

The agent should be able to control its browser.

The user should be able to inspect what the bot is doing.

Ideally provide:

```text
Computer
 ├── Browser
 ├── Files
 ├── Terminal
 └── Activity
```

inside the existing Computer panel concept.

---

# 18. COMPUTER PANEL

Preserve the existing computer experience.

For Android:

```text
Computer
    |
    +--- Local Android computer
    +--- Linux environment
    +--- Browser
    +--- Terminal
    +--- Activity/events
```

The UI should clearly show:

* environment status
* running/stopped
* active processes
* browser
* recent screenshots
* current task
* permission requests

Make the Android computer the default.

Cloud/remote computer options may remain available, but they must be explicitly optional.

---

# 19. MCP SUPPORT

This is mandatory.

Preserve:

* built-in MCP infrastructure
* custom MCP servers
* MCP tool discovery
* MCP lifecycle
* per-bot MCP configuration
* permissions
* MCP server logs/errors
* MCP environment variables
* MCP credentials

Users must be able to add custom MCP servers without modifying application source.

The existing repository already documents zero-code custom MCP configuration; preserve that concept on Android.

For example:

```text
MCP Servers
--------------------------
GitHub
Filesystem
Custom Server
Postgres
Resend
...
```

A user should be able to configure:

```text
name
transport
command
arguments
environment
working directory
enabled/disabled
bots using it
```

where the transport is actually supported.

---

# 20. MCP RUNTIME

This is a critical reason the local Linux execution environment exists.

MCP servers must be able to run locally.

Implement support for the major patterns actually present in the repository:

```text
stdio
HTTP
SSE
```

or whatever transports the current implementation actually uses.

For local stdio MCP servers:

```text
Bot
 ↓
MCP manager
 ↓
Linux/Android execution environment
 ↓
MCP process
```

Do not run arbitrary third-party binaries directly with unrestricted Android privileges.

Keep them inside the execution sandbox.

---

# 21. CONNECTORS

Preserve the connected-app system.

The user must be able to connect services such as:

* GitHub
* Gmail
* Slack
* Notion
* Linear
* etc.

The connector system should remain conceptually identical.

Where a provider supports official OAuth:

```text
Connect
→ browser/app authentication
→ callback
→ credential/token storage
→ connected
```

Use official authentication mechanisms.

Where OAuth is not available:

```text
API key
token
credential
```

may be supported where appropriate.

Never scrape login credentials.

Never intercept passwords.

Never attempt to bypass provider authentication.

---

# 22. AUTHENTICATION ARCHITECTURE

Create a common authentication abstraction.

Conceptually:

```text
AuthMethod
├── OAuth
├── DeviceCode
├── APIKey
├── PersonalToken
└── ProviderSpecific
```

The user should be offered the valid authentication methods supported by each service.

Do NOT assume authentication and API keys are interchangeable.

Use official provider authentication mechanisms.

Some providers may allow account/subscription-based authentication.

Some may require an API key.

Support both when legitimately supported.

Never circumvent subscription limitations.

---

# 23. AI PROVIDERS

Preserve the model-provider architecture.

The user should be able to configure model access using:

### Account authentication

where officially supported.

Examples may include:

```text
Sign in
Device code
OAuth
Provider account authentication
```

### API authentication

where supported:

```text
API key
base URL
model
```

The UI should make these separate choices.

For example:

```text
OpenAI
    Sign in with supported account authentication
    OR
    Use API key

Anthropic
    Sign in using supported authentication
    OR
    Use API
```

Do not impersonate provider-owned clients.

Do not bypass provider restrictions.

Use official supported mechanisms.

---

# 24. DO NOT ASSUME DESKTOP CLI COMPATIBILITY

The desktop version currently relies heavily on CLI agents such as Claude/Codex/Grok.

Do not assume these CLI executables can simply be copied into the APK.

Investigate each one.

For every existing engine determine:

```text
Can it run natively on Android?
Does its provider permit this?
Can its official authentication flow operate on Android?
Does it depend on a desktop shell?
Does it depend on native binaries?
Does it depend on Node?
Does it depend on filesystem semantics unavailable on Android?
```

Where a CLI engine cannot safely/reliably run on Android, implement a provider-native Android adapter using the supported API/auth mechanism.

Do not remove the engine from the architecture merely because the CLI is desktop-only.

Instead preserve the provider abstraction.

---

# 25. PROVIDER ABSTRACTION

The architecture should look approximately like:

```text
AgentProvider
├── OpenAI
├── Anthropic
├── Google
├── xAI
├── OpenAI-compatible
├── Other supported providers
└── LocalModel
```

and separately:

```text
EngineAdapter
├── AndroidNativeEngine
├── CLIEngine
└── RemoteEngine
```

This prevents the entire application from being coupled to executable CLIs.

---

# 26. SKILLS

Preserve the entire Skills concept.

Skills must support:

* skill files
* descriptions
* instructions
* tools
* applicable bots
* installation
* enabling/disabling
* loading
* execution
* versioning where present
* import/export

The Android app must be able to discover and execute skills.

Do not hardcode current skills into Kotlin.

Keep them data-driven.

If a skill requires shell access, execute it in the bot's sandbox.

---

# 27. TEAM IMPORT / EXPORT

Preserve the current portable team/package format.

Users should be able to:

* import a team
* import Markdown/YAML team packages
* review them
* approve them
* create bots
* create channels
* configure skills
* configure connectors
* configure routines
* export teams

Credentials must NEVER be bundled into exported teams.

Permissions must NEVER be silently imported as granted.

---

# 28. BOT-TO-BOT COMMUNICATION

Preserve it.

Bots must be able to communicate with other bots through the existing conceptual mechanism.

Respect:

* recursion limits
* permission rules
* task ownership
* conversation state
* interruption
* event logging

Do not create infinite bot-to-bot loops.

---

# 29. ROUTINES / BACKGROUND TASKS

Preserve scheduled routines.

Use Android-native scheduling:

```text
WorkManager
Foreground Service
Alarm mechanisms where genuinely required
```

Choose the appropriate Android mechanism for each task.

Understand that Android does not allow arbitrary unlimited background execution.

Therefore:

* scheduled work must survive app restarts
* active long-running agent tasks must use an appropriate foreground mechanism
* persistent notification must be used when Android requires it
* gracefully recover from process death
* persist queued work
* resume safely where possible
* never claim unsupported background guarantees

Routines should behave as closely as possible to desktop OpenMausBot.

---

# 30. DATA STORAGE

Preserve OpenMausBot's local-first philosophy.

Store locally:

* bots
* profiles
* conversations
* channels
* tasks
* event history
* configuration
* skills
* MCP configuration
* connector metadata
* browser sessions
* runtime state

Use appropriate Android storage.

Prefer:

```text
Room / SQLite
```

for structured data.

Use filesystem storage for:

* large files
* transcripts if appropriate
* skill packages
* browser data
* bot workspaces

Do NOT use browser localStorage as the primary database.

---

# 31. SECRETS

Improve the security model for Android.

Do not store secrets in plain text if avoidable.

Use:

```text
Android Keystore
Encrypted storage
```

for:

* API keys
* OAuth tokens
* connector credentials
* MCP secrets
* provider credentials

The UI must never display raw stored secrets unless the user explicitly enters them.

Prefer the existing "configured" model:

```text
Configured
Not configured
```

instead of returning secrets to the UI.

---

# 32. NETWORKING

The application must communicate directly with:

* AI providers
* connector providers
* MCP endpoints
* OAuth endpoints
* web services

from the phone.

Do NOT route normal provider traffic through a personal PC.

Do NOT require OpenMausBot's desktop server.

Do NOT introduce an unnecessary backend proxy.

---

# 33. OFFLINE BEHAVIOR

The application should remain usable offline for local functionality.

Offline:

* view conversations
* view bots
* edit bots
* inspect settings
* inspect skills
* inspect MCP configuration
* inspect files
* interact with local environments where dependencies are local
* browse existing history

Online:

* model inference
* OAuth
* cloud connectors
* external MCP servers
* web access

Make network failures explicit and recoverable.

---

# 34. VOICE

Preserve voice/TTS concepts where practical.

Support Android-native:

* microphone input
* speech recognition where available
* text-to-speech

Maintain compatibility with existing hosted TTS providers where legitimate.

Voice configuration should remain per bot where supported.

Do not remove voice simply because the desktop implementation was platform-specific.

Replace platform-specific implementations with Android equivalents.

---

# 35. FILES

Bots must be able to work with files.

Support:

* app-private files
* user-selected files
* imports
* exports
* document picker
* downloads
* bot workspaces

Use Android's Storage Access Framework where appropriate.

Do not request broad filesystem access unless absolutely necessary.

---

# 36. ANDROID INTENTS

Provide safe Android integration through explicit tools.

Examples:

```text
open URL
share text
open document
open calendar
open supported application
```

The agent should not have unrestricted control over every Android application.

Use Android intents and supported interfaces.

---

# 37. PER-APP PERMISSION MODEL

Maintain explicit user consent for:

* microphone
* camera
* notifications
* contacts
* calendar
* location if eventually supported
* files
* external app launching

Do not request permissions at first launch unless needed.

Request them contextually.

---

# 38. REMOTE COMPUTER SUPPORT

Remote device support is OPTIONAL.

The standalone Android installation must work perfectly without it.

However, preserve an abstraction allowing:

```text
RemoteComputer
```

later.

For example:

```text
This phone
Remote PC
Cloud computer
```

The user can select:

```text
Bot Computer:
    ○ This phone
    ○ Remote computer
    ○ Cloud computer
```

Default:

```text
This phone
```

Remote control must never become a hidden dependency.

---

# 39. CLOUD COMPUTER

Cloud computer support may remain as an optional feature for compatibility with existing OpenMausBot functionality.

It must be clearly labeled as remote/cloud.

The Android application itself must still have a local computer environment.

A user should be able to completely ignore cloud computers.

---

# 40. EXISTING UI/UX

This is extremely important.

Do NOT redesign OpenMausBot just because it is being ported.

Preserve:

* layout
* sidebar
* bot list
* conversation UI
* message rendering
* tool activity
* permission cards
* model picker
* channel UI
* settings
* connector marketplace
* MCP interface
* computer panel
* team management
* visual language
* spacing
* hierarchy
* interaction behavior
* terminology

The goal is:

"If someone used desktop OpenMausBot and then opened this Android app, they should immediately recognize it as the same product."

Adapt only where Android requires it.

Examples of legitimate adaptation:

* navigation rail instead of a desktop sidebar at narrow widths
* bottom sheets
* Android back gesture
* Android permission dialogs
* mobile keyboard behavior
* portrait/landscape adaptation
* touch controls

Do NOT change the product identity.

---

# 41. RESPONSIVE UI

The Android app must work on:

* phones
* tablets if practical

Minimum target:

* modern ARM64 Android phone
* portrait orientation
* landscape orientation

No content may become unusable because of the keyboard.

Handle:

* IME
* safe areas
* keyboard resize
* rotation
* process recreation
* lifecycle changes

---

# 42. APP LIFECYCLE

The app must survive normal Android lifecycle events.

Handle:

```text
Activity destroyed
Activity recreated
screen rotated
app backgrounded
app resumed
process killed
phone rebooted
network disappears
network returns
```

Persist state before the process can disappear.

Active tasks must have explicit lifecycle management.

---

# 43. PROCESS MODEL

Separate:

```text
UI
Agent runtime
Execution sandbox
Browser runtime
Scheduler
Credential manager
MCP manager
Storage
```

Do not put everything inside a single Activity.

The Activity is NOT the agent runtime.

The agent runtime must survive normal UI lifecycle events.

---

# 44. LOGGING

Add structured logs for:

* startup
* runtime
* providers
* MCP
* connectors
* sandbox
* browser
* authentication
* background tasks
* failures

Provide an in-app diagnostics page.

The user should be able to obtain logs when something fails.

Never log secrets.

---

# 45. ERROR HANDLING

No feature should silently fail.

Examples:

If a provider cannot run:

```text
Provider unavailable
Reason: ...
```

If an MCP server fails:

```text
MCP server failed
Exit code: ...
Reason: ...
```

If sandbox startup fails:

```text
Local computer unavailable
Reason: ...
```

If Android does not support a capability:

```text
Not supported on this device
```

Do not show fake "successful" states.

---

# 46. DEVICE CAPABILITY DETECTION

Detect at runtime:

* ABI
* Android version
* available RAM
* storage
* virtualization support
* WebView availability
* hardware capabilities
* permissions
* background execution constraints

Expose an internal capability registry.

Example:

```text
CapabilityRegistry

android.files
android.browser
android.camera
android.microphone
linux.sandbox
vm
background.tasks
speech
tts
```

The UI should respond to actual capability availability.

---

# 47. PERFORMANCE

The app must be usable on a modern flagship/mid-high-end Android phone.

Avoid:

* unnecessary memory duplication
* spawning a full Linux environment for every screen
* permanent CPU-heavy processes
* huge database queries
* loading all chat history into RAM
* rendering enormous transcripts at once

Use:

* pagination
* streaming
* lazy loading
* bounded logs
* persistent workers
* resource cleanup

---

# 48. STORAGE MANAGEMENT

The Linux runtime, browser data and skills may consume substantial storage.

Create an Android settings page showing:

```text
OpenMausBot data
Bot workspaces
Browser data
Linux environment
Skills
MCP data
```

Allow safe cleanup.

Never delete active bot data without confirmation.

---

# 49. IMPORT / EXPORT / BACKUP

Provide export/import for OpenMausBot application state.

At minimum support backup/restore of:

* bots
* chats
* channels
* settings
* skills
* MCP definitions
* connector metadata

Credentials should require deliberate secure handling.

Do not export raw secrets accidentally.

---

# 50. TESTING REQUIREMENTS

Before declaring the project complete:

## Unit tests

Cover:

* bot management
* chat state
* channel state
* provider routing
* event processing
* permissions
* MCP configuration
* connector state
* persistence
* sandbox manager
* scheduling
* authentication state

## Integration tests

Test:

```text
UI
 ↓
Android runtime
 ↓
provider
 ↓
agent response
```

and:

```text
Bot
 ↓
tool call
 ↓
permission
 ↓
tool execution
 ↓
result
 ↓
assistant continuation
```

## Android tests

Test:

* installation
* launch
* bot creation
* message sending
* streaming
* tool calls
* approvals
* MCP connection
* connector authentication
* local files
* local shell
* browser
* background task
* app restart
* phone reboot

---

# 51. REAL DEVICE TESTING

Do not rely exclusively on emulators.

The final milestone requires testing on a real ARM64 Android phone.

At minimum verify:

```text
APK installs
APK launches
First-run setup works
Provider authentication works
Bot can respond
Bot can use tools
Bot can use local computer
Bot can read/write its workspace
MCP works
Connector works
Browser works
App survives backgrounding
Data survives restart
```

---

# 52. SECURITY TESTING

Test that a bot cannot accidentally:

* access another bot's workspace
* read unrelated application files
* obtain stored provider secrets
* bypass permission prompts
* access unrestricted Android APIs
* escape the sandbox
* execute outside its intended scope

Test hostile/malformed MCP input.

Test malicious filenames and paths.

Prevent:

```text
../
absolute path traversal
symlink escapes
environment-secret leaks
credential disclosure
```

where applicable.

---

# 53. PATH AND EXECUTION SECURITY

Every shell execution must use a controlled environment.

Do not pass the Android application's entire process environment to bots.

Construct a sanitized environment:

```text
PATH
HOME
TMPDIR
bot-specific variables
approved MCP variables
approved connector variables
```

Never expose:

```text
API keys
Android app secrets
OAuth tokens
Keystore material
```

unless explicitly required and carefully scoped.

---

# 54. NO HARDCODED CREDENTIALS

Absolutely no:

* API keys
* tokens
* OAuth secrets
* passwords
* provider credentials

inside source code.

No credentials in:

* git history
* tests
* sample configs
* APK assets
* build files

Use mock credentials in tests.

---

# 55. LICENSE / ATTRIBUTION

Respect the upstream repository's license and notices.

Do not remove required attribution.

Add clear documentation that this is a fork/Android adaptation where appropriate.

Do not imply affiliation with providers such as OpenAI, Anthropic, xAI, Google, etc.

---

# 56. BUILD SYSTEM

Create a clean Android build.

The repository should support something conceptually like:

```bash
./gradlew assembleDebug
```

Potentially:

```bash
./gradlew assembleRelease
```

Use current stable Android build tooling compatible with the available environment.

Do not blindly choose versions without checking compatibility.

The Android build must be reproducible.

The final APK must package everything required for normal operation.

Do not require the user to install:

* Node
* pnpm
* Python
* Termux
* Linux
* Docker
* another application

to make OpenMausBot work.

---

# 57. EMBEDDED RUNTIMES

Where the Android runtime requires:

* shell
* Python
* JavaScript
* native helpers
* browser components

bundle or provision them as part of the application architecture.

Do not tell the user:

"Install Termux first."

Do not make Termux a prerequisite.

Do not make root a prerequisite.

Do not assume Node.js is available on Android.

If you use an embedded Node-compatible runtime, prove that it actually works on the target Android architecture and version.

---

# 58. LINUX ROOTFS

If the local execution environment requires a Linux userspace:

Create a versioned, reproducible environment.

It should have only what is necessary.

At minimum investigate support for:

```text
shell
git
python
node/javascript tooling where feasible
package managers where feasible
common MCP runtimes
browser automation dependencies
```

Do not inflate the APK unnecessarily.

Prefer downloading large optional runtime assets after installation only if this still preserves a standalone architecture.

If assets are downloaded, verify integrity and clearly manage them.

---

# 59. FIRST-RUN EXPERIENCE

First launch should guide the user through:

```text
Welcome
↓
Choose AI access
↓
Sign in / API key
↓
Choose model
↓
Set up local computer
↓
Optional connector setup
↓
Ready
```

The user should NOT have to configure a desktop server.

No localhost desktop setup.

No pairing required.

No QR code required for ordinary usage.

---

# 60. MODEL CONNECTION UI

Create a clear provider configuration screen.

Example structure:

```text
AI Providers

OpenAI
    Connected via account
    Connected via API
    Not configured

Anthropic
    Connected via account
    Connected via API
    Not configured

Google
    Connected
    API
    Not configured

xAI
    API
    Not configured
```

Only show authentication methods that are actually supported.

---

# 61. CONNECTOR UI

Preserve the existing connector marketplace concept.

Example:

```text
Connections

GitHub       Connected
Gmail        Connected
Slack        Not connected
Notion       Connected

+ Add connection
```

Connection state must be local and persistent.

OAuth flow must return to the app securely.

---

# 62. MCP UI

Provide:

```text
MCP Servers

Built-in
Custom

+ Add MCP server
```

For each MCP:

```text
Name
Transport
Command
Arguments
Environment
Enabled
Assigned bots
Status
Logs
```

---

# 63. BOT CREATION

Bot creation should feel like creating a contact.

User chooses:

```text
Name
Personality
Model
Computer
Skills
MCPs
Connections
Voice
```

Default computer:

```text
This phone
```

---

# 64. MEMORY

Preserve existing memory/thread semantics.

Do not convert all memory into a generic vector database unless the current application actually needs it.

Preserve the repository's existing semantics first.

Add Android-safe persistence underneath.

---

# 65. STREAMING

Responses must stream.

Do not wait for an entire response before displaying it.

Preserve tool activity chips/cards.

For example:

```text
Bot:
I'll inspect the repository.

[Running tool...]
[Reading file...]

I found...
```

---

# 66. INTERRUPTIONS

Users must be able to stop active agent work.

Implement:

```text
Stop
Interrupt
Cancel
```

and ensure the underlying execution process actually terminates or reaches a safe stopped state.

Do not merely stop rendering the output.

---

# 67. RECOVERY

When a process crashes:

* mark the task failed
* store the failure
* clean up resources
* preserve conversation state
* allow retry

When Android kills a process:

* recover persisted queued tasks
* do not duplicate completed operations
* clearly mark interrupted work

---

# 68. DO NOT SIMPLIFY THE PRODUCT

Do not produce an MVP containing only:

* chat
* API key
* one model

and call it the Android version.

That is explicitly not the requested result.

The requested product is an Android adaptation of OpenMausBot itself.

---

# 69. PRIORITY ORDER

Implement in this order:

## Phase 1 — Repository analysis

Understand the current architecture completely.

## Phase 2 — Android foundation

Create:

* Android project
* application lifecycle
* persistent storage
* secrets
* runtime interfaces
* capability registry

## Phase 3 — Core harness

Port the:

* bot system
* conversation system
* event bus
* task lifecycle
* permissions

## Phase 4 — Provider system

Implement:

* account authentication where officially supported
* API-key providers
* model selection
* streaming
* cancellation

## Phase 5 — Local computer

Implement:

* Android computer abstraction
* sandbox
* shell
* filesystem
* workspace
* process execution

## Phase 6 — MCP

Implement:

* local MCP
* remote MCP
* configuration
* lifecycle
* permissions

## Phase 7 — Connectors

Implement:

* OAuth
* credentials
* connector tool exposure

## Phase 8 — Browser

Implement:

* isolated browser sessions
* navigation
* DOM access
* actions
* screenshots
* persistent sessions

## Phase 9 — Skills

Implement complete skill management/execution.

## Phase 10 — Routines/background execution

Implement Android-native scheduling.

## Phase 11 — Voice / Android capabilities

Add:

* speech
* TTS
* Android-specific tools

## Phase 12 — UI integration

Make the existing OpenMausBot UI operate entirely against the Android runtime.

## Phase 13 — Integration testing

Test everything together.

## Phase 14 — APK

Build and validate the final APK on a real Android device.

---

# 70. IMPORTANT IMPLEMENTATION RULE

At the beginning of the task, create a document:

```text
ANDROID_PORT_ARCHITECTURE.md
```

containing:

1. Current OpenMausBot architecture
2. Android architecture
3. Components reused
4. Components rewritten
5. Components replaced
6. Runtime decision
7. VM/sandbox decision
8. Provider strategy
9. Auth strategy
10. MCP strategy
11. Connector strategy
12. Browser strategy
13. Storage strategy
14. Security model
15. Build strategy
16. Known platform limitations

Keep this document updated while implementing.

---

# 71. DECISION RULE FOR DIFFICULT TECHNICAL PROBLEMS

Do not stop and ask the user to choose between ten architecture options.

Investigate.

Prototype.

Benchmark.

Choose the architecture that best satisfies:

1. standalone
2. functional
3. secure
4. maintainable
5. performant
6. closest to OpenMausBot behavior
7. actually buildable as an APK

Only ask the user if there is a genuinely irreversible product decision that cannot reasonably be inferred.

---

# 72. ABSOLUTE REQUIREMENTS

The final application MUST satisfy all of the following:

```text
[ ] Installs as an APK
[ ] Runs directly on Android
[ ] Does not require a PC
[ ] Does not require a VPS
[ ] Does not require a separate OpenMausBot server
[ ] Does not require Termux
[ ] Does not require root
[ ] Supports multiple bots
[ ] Supports bot personalities
[ ] Supports chats
[ ] Supports channels/rooms
[ ] Supports tasks
[ ] Supports bot memory/state
[ ] Supports model selection
[ ] Supports account authentication where officially available
[ ] Supports API-key authentication
[ ] Supports connectors
[ ] Supports OAuth connectors
[ ] Supports custom MCP servers
[ ] Supports skills
[ ] Supports permission approvals
[ ] Supports local bot computer
[ ] Supports isolated bot workspace
[ ] Supports local shell execution
[ ] Supports local file operations
[ ] Supports browser interaction
[ ] Supports browser sessions
[ ] Supports routines
[ ] Supports background work within Android limits
[ ] Supports streaming responses
[ ] Supports interruptions
[ ] Supports voice where practical
[ ] Preserves the existing OpenMausBot UI/UX
[ ] Persists all important data locally
[ ] Protects secrets
[ ] Has meaningful diagnostics
[ ] Has automated tests
[ ] Produces a working APK
[ ] Is tested on a real Android ARM64 device
```

---

# 73. DEFINITION OF "DONE"

Do not say "done" merely because:

```text
the APK builds
```

It is done only after demonstrating the following end-to-end workflow:

### Test A — Bot

Create:

```text
Bot: Developer
Model: configured provider
Computer: This phone
```

Send:

```text
Create a file named hello.txt containing "Hello from OpenMausBot Android".
```

The bot must:

1. reason
2. request permission if required
3. access its local computer
4. create the file
5. report completion
6. allow the user to inspect the file

---

### Test B — MCP

Configure a working MCP server.

The bot must discover its tools and execute one successfully.

---

### Test C — Connector

Connect a supported application through its legitimate auth flow.

Bot must perform a real connector action.

---

### Test D — Browser

Bot opens a browser session, navigates to a permitted page, interacts with it, extracts information, and returns the result.

---

### Test E — Skill

Install/enable a skill.

Bot successfully uses it.

---

### Test F — Background task

Create a routine.

Kill/restart the application.

The routine must remain persisted and execute according to Android's scheduling rules.

---

### Test G — Restart

Kill the application.

Reopen it.

Bots, chats, channels, settings and workspaces must remain intact.

---

# 74. FINAL DELIVERABLES

When implementation is complete, produce:

```text
1. Working APK
2. Build instructions
3. Architecture documentation
4. Android limitations documentation
5. Test report
6. List of supported AI providers
7. List of supported authentication mechanisms
8. List of supported connectors
9. List of supported MCP transports
10. Local-computer architecture explanation
11. Backup/restore instructions
12. Known limitations
```

Also provide the exact APK path.

---

# 75. FINAL PRINCIPLE

The guiding idea is:

> OpenMausBot should stop thinking of Android as a phone connected to a computer.

Instead:

> Android IS the computer.

The agent lives on the phone.

The phone hosts the harness.

The phone hosts the bot workspaces.

The phone hosts the local execution environment.

The phone hosts the browser.

The phone hosts MCP runtimes.

The phone stores conversations and configuration.

The phone authenticates with providers.

The phone accesses connectors.

The phone schedules work.

A PC is merely an optional additional computer that may be attached later.

Do not weaken this architecture to make the implementation easier.

When something from the desktop version cannot be directly transplanted, replace the underlying mechanism while preserving the behavior and user experience.

The final result should feel like:

**"OpenMausBot, but my Android phone is the machine the bots actually live and work on."**
