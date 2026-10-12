MOBOT — MASTER IMPLEMENTATION PROMPT
Native Agentic Android Platform + App Builder + Structured UI + Device Intelligence

You are continuing work on the existing OpenMausBot Android project.

IMPORTANT:
The ask_user implementation/real-model verification phase has just been completed. Do NOT restart or unnecessarily redesign ask_user. Treat the existing implementation as the foundation for the next features.

The product goal is no longer merely "run an agent on Android."

The goal is:

AN AUTONOMOUS AGENT DEVELOPMENT ENVIRONMENT THAT RUNS ENTIRELY ON ANDROID.

The Android phone is the computer, runtime, workspace, browser, coding environment, testing environment, preview host, and deployment control plane.

No PC.
No Mac.
No VPS.
No Termux.
No root.

Do not weaken this requirement.

--------------------------------------------------
GLOBAL ENGINEERING RULES
--------------------------------------------------

1. Reuse existing OpenMausBot architecture.

Do NOT create parallel:
- execution systems
- permission systems
- secret stores
- workspace systems
- browser systems
- model abstractions
- task schedulers
- agent runtimes

Extend the existing architecture.

2. Preserve existing functionality.

Existing bots/chats/threads:
- providers
- models
- MCP
- connectors
- browser
- computer
- memory
- skills
- routines
- permissions
- tools
- artifacts
- foreground runtime

must continue working.

3. Android-first.

All new functionality must be viable on:
- real ARM64 Android hardware
- the existing Android runtime architecture
- no desktop-only assumptions

4. No fake functionality.

Never add:
- fake OAuth
- fake deployment success
- fake localhost URLs
- fake model availability
- fake preview state
- fake notifications
- fake integrations

If a provider or platform cannot genuinely perform an operation, expose that honestly.

5. No hidden fallback behavior.

Do not silently:
- substitute models
- substitute providers
- silently change deployment targets
- silently change project configuration
- silently use a different runtime
- silently turn unavailable capabilities into "success"

6. Existing permission architecture remains authoritative.

Use risk-based approval:
- safe operations: silent
- meaningful external effects: approval
- destructive/high-impact actions: explicit approval

Do not create a second approval broker.

7. User-visible chat should remain clean.

Do NOT dump:
- internal tool progress
- shell output
- build logs
- deployment logs
- PDF contents
- internal orchestration
- routine success chatter

into normal conversation unless the user explicitly asks for details.

Use proper structured UI for:
- progress
- errors
- approvals
- questions
- previews
- deployment state
- artifacts

8. Test on the actual ARM64 phone.

Unit tests are necessary but insufficient.

Every feature involving:
- Android UI
- browser/WebView
- notifications
- processes
- background execution
- local server
- deployment
- file access
- Activity recreation

must have real-device verification.

--------------------------------------------------
PHASE ORDER
--------------------------------------------------

Implement in this order unless a dependency requires otherwise:

PHASE A
Notification architecture

PHASE B
Built-in skill system

PHASE C
Agent App Builder foundation

PHASE D
Android localhost development/preview

PHASE E
Build/test/fix autonomous loop

PHASE F
Vercel deployment

PHASE G
Render deployment

PHASE H
Project/workspace management

PHASE I
Final App Builder integration and physical-device verification

Do not attempt to implement everything in one uncontrolled change.

After each major phase:
- typecheck
- lint
- relevant tests
- Android tests
- physical-device verification where applicable
- inspect for regressions
- document limitations

--------------------------------------------------
PHASE A — NOTIFICATION SYSTEM
--------------------------------------------------

CURRENT PROBLEM:

A simple bot conversation can generate hundreds of Android notifications because individual bot messages each create notifications.

This is unacceptable.

REQUIRED BEHAVIOR:

1. ACTIVE CHAT SUPPRESSION

If the user is currently viewing Bot A's conversation:

Bot A sends 1 message
→ no notification

Bot A sends 50 messages
→ no notification

Suppress notifications only for the active relevant conversation.

Do NOT globally disable notifications.

2. ONE ACTIVE NOTIFICATION PER BOT

If the user is NOT viewing Bot A:

first unread message:
→ create one notification

subsequent messages:
→ update the existing notification

Never create one notification per message.

Use a stable notification ID associated with the bot/conversation identity.

3. MULTIPLE BOTS

Bot A:
→ one notification

Bot B:
→ one notification

Bot C:
→ one notification

A message burst must not create notification spam.

4. NOTIFICATION CONTENT

Show useful aggregated information such as:

"Vega"
"4 new messages"

Optionally show a concise latest-message preview when safe and appropriate.

Do not expose sensitive information unnecessarily.

5. OPENING CHAT

When the user opens the relevant chat:

- cancel that bot's active notification
- transition relevant unread state appropriately
- continue suppressing notifications while that chat is visible

6. LEAVING CHAT

If the user leaves the conversation:

- future bot messages should be eligible for notification
- existing unread messages should not generate a second notification if an active notification already represents them

7. RAPID MESSAGE BURSTS

If a bot generates many messages quickly:

- debounce/coalesce where appropriate
- update existing notification
- do not enqueue hundreds of notification operations

8. APP BACKGROUND

If application is backgrounded and bots generate new messages:

- notifications may be generated according to the policy
- still one active notification per relevant bot

9. ACTIVITY RECREATION

Verify:

- screen rotation
- Activity recreation
- background/foreground transitions
- navigation changes

Do not lose visibility state or create notification duplicates.

10. PROCESS RESTART

Where Android lifecycle allows:
- maintain coherent unread/notification state
- avoid duplicate notification creation after restart

11. TESTING

Add tests for:

- visible chat suppresses notification
- hidden chat creates notification
- repeated messages update one notification
- multiple bots produce distinct notifications
- opening chat clears notification
- rapid bursts remain one notification
- navigation away/restored
- Activity recreation
- process restart where testable

12. PHYSICAL DEVICE ACCEPTANCE TEST

VISIBLE BOT:
0 notifications

BACKGROUND BOT:
1 notification

BOT SENDS 10 MORE MESSAGES:
still 1 notification, updated

OPEN BOT:
notification disappears

Do not mark complete from unit tests alone.

--------------------------------------------------
PHASE B — BUILT-IN SKILLS SYSTEM
--------------------------------------------------

The agent needs an actual extensible skill system for complex work.

The skill system must not be implemented as one enormous static system prompt.

Create a first-class skill registry/loading mechanism using the existing agent architecture.

SKILL REQUIREMENTS:

Each skill should have:

- name
- version
- description
- source
- license
- triggers
- capabilities
- dependencies
- supported stacks/frameworks where appropriate
- prompt/instruction assets
- reference assets if required
- enabled/disabled state

Skills should be loaded only when relevant.

DO NOT inject every skill into every turn.

Support:

- discovery
- activation
- skill-specific references
- skill-specific instructions
- skill versioning
- enable/disable
- provenance
- attribution/license information
- local caching

Skills should preferably work offline after installation.

Do not require internet access every time a skill is invoked.

--------------------------------------------------
BUILT-IN SKILL #1 — UI/UX PRO MAX
--------------------------------------------------

Integrate the upstream UI/UX Pro Max skill:

https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md

Use the actual upstream skill structure and assets where appropriate.

Do not merely copy the skill name into a settings screen and claim integration.

The integration must make the relevant design intelligence available to the agent.

It should influence:

- layout
- typography
- color
- spacing
- responsive behavior
- accessibility
- interaction states
- component structure
- visual hierarchy
- design-system decisions
- UI review
- UX review
- chart/data visualization decisions where relevant
- framework-specific implementation

Preserve upstream attribution and license information.

Pin or record the upstream revision/commit used so behavior is reproducible.

If the upstream skill includes searchable local data or helper assets, integrate those assets rather than reducing the skill to a tiny prompt summary.

--------------------------------------------------
BUILT-IN SKILL #2 — TASTE SKILL
--------------------------------------------------

Integrate:

https://github.com/Leonxlnx/taste-skill

Use the current upstream implementation appropriately.

The project must recognize that the repository now contains multiple skill variants and a current v2/default frontend skill.

Do not casually install every Taste skill simultaneously.

The system should select the appropriate variant for the task.

Use Taste to improve:

- visual originality
- typography
- spacing
- layout experimentation
- motion
- density
- anti-generic UI decisions
- frontend visual quality

Preserve attribution and licensing.

Pin the source revision used.

--------------------------------------------------
SKILL ARCHITECTURE
--------------------------------------------------

Create a generic mechanism so more skills can be added later.

Example:

SkillRegistry
SkillManifest
SkillLoader
SkillResolver
SkillContext
SkillActivation

The agent should be able to decide:

"This task needs the UI/UX skill."

or:

"This task needs Taste."

or:

"This task needs both."

Do not force every skill into every task.

Potential future skills should be easy to add for:
- accessibility
- security review
- database design
- SEO
- testing
- performance
- copywriting
- backend architecture
- mobile design
- API design
- deployment

Do not implement all future skills now.
Implement the infrastructure that makes them easy to add.

--------------------------------------------------
PHASE C — FULL-STACK APP BUILDER
--------------------------------------------------

The central new capability:

THE BOT CAN BUILD COMPLETE APPLICATIONS BY ITSELF.

Example:

User:
"Build me a job application tracker."

The bot should be capable of:

- requirements gathering
- architecture
- UI design
- frontend implementation
- backend implementation
- database/data layer
- authentication where needed
- validation
- testing
- debugging
- local preview
- user feedback
- iteration
- deployment
- deployment verification

The bot must be able to ask the user as many meaningful questions as necessary.

Do NOT impose an arbitrary "maximum number of questions."

However:

Do not ask trivial questions that the agent can reasonably decide itself.

Good questions:
- authentication choice
- user roles
- important business behavior
- irreversible product decisions
- deployment target
- data retention
- external service choice
- visual direction where ambiguity matters
- privacy-sensitive behavior

Bad questions:
- variable names
- obvious implementation details
- file names
- whether to use semicolons
- every tiny CSS decision

The bot should make ordinary engineering decisions autonomously.

--------------------------------------------------
ASK_USER INTEGRATION
--------------------------------------------------

Use the existing ask_user mechanism.

Supported interaction forms must remain:

- single choice
- multiple choice
- free text
- "other"
- confirmation

Questions must:

- pause the current task
- preserve task state
- survive Activity recreation
- resume the same task
- pass the answer back to the model
- be visually distinct from permission requests

The agent may ask repeatedly throughout an application build.

Example:

Requirements
→ ask_user
→ architecture
→ ask_user
→ implementation
→ ask_user
→ preview
→ ask_user
→ deployment
→ ask_user

This is intentional.

DO NOT turn ask_user into a one-time setup wizard.

--------------------------------------------------
APP BUILDER TOOLS
--------------------------------------------------

Create first-class tools that build on the existing execution/workspace system.

At minimum:

project_create
project_list
project_open
project_read
project_write
project_patch
project_delete
project_rename

build_run
build_status
build_logs

test_run
test_status
test_logs

preview_start
preview_status
preview_logs
preview_stop
preview_restart

deployment_create
deployment_status
deployment_logs
deployment_cancel
deployment_redeploy

environment_list
environment_set
environment_remove

project_git_status
project_git_init
project_git_diff
project_git_commit

Use names appropriate to existing architecture if equivalent tools already exist.

DO NOT create a second execution engine.

--------------------------------------------------
PROJECT WORKSPACES
--------------------------------------------------

Every generated app should live in a first-class project workspace.

Project metadata should include:

- ID
- name
- description
- framework
- language
- runtime
- creation time
- last modified
- current state
- preview state
- deployment state
- Git state
- environment-variable metadata
- associated bot/owner where applicable

Projects must be isolated.

Do not allow one generated project to accidentally modify another.

--------------------------------------------------
SUPPORTED INITIAL APP TARGETS
--------------------------------------------------

Prioritize practical web application stacks that can run using the existing Android runtime.

Start with strong support for:

- React
- Next.js
- Node.js
- TypeScript
- HTML/CSS/JavaScript

Add other frameworks only after the runtime can genuinely support them.

Do not claim universal support for arbitrary ecosystems.

When a project requires unsupported native dependencies, explain the limitation rather than pretending.

--------------------------------------------------
FULL-STACK ARCHITECTURE
--------------------------------------------------

The agent must understand that "full-stack" may mean:

Frontend
+
Backend/API
+
Database/storage
+
Authentication
+
External services

depending on the project.

The bot should choose architecture based on requirements.

It should be able to explain important architectural choices when useful.

--------------------------------------------------
DATABASE SUPPORT
--------------------------------------------------

Design the app builder so projects can use:

- local development data stores
- SQLite where appropriate
- remote databases where configured
- existing OpenMausBot connectors/integrations

Do not automatically create paid external infrastructure without user approval.

When a remote database or third-party service is required, ask the user.

--------------------------------------------------
SECRETS / ENVIRONMENT VARIABLES
--------------------------------------------------

NEVER expose:

- API keys
- access tokens
- deployment tokens
- database passwords

in chat messages or normal logs.

Use the existing Android secret/Keystore architecture.

Project environment variables must distinguish:

safe metadata
vs
secret values.

When deployment requires a secret, use secure storage and explicit user approval where appropriate.

--------------------------------------------------
PHASE D — LOCALHOST APP PREVIEW
--------------------------------------------------

THIS IS A CORE REQUIREMENT.

The Android phone itself must be able to run applications created by the agent.

The bot should be able to:

Generate app
→ install dependencies
→ build/start development server
→ discover listening port
→ open preview
→ allow user interaction
→ modify app
→ restart/reload preview

No PC.
No Mac.
No Termux.
No root.
No VPS.

--------------------------------------------------
LOCAL SERVER
--------------------------------------------------

Use the existing embedded runtime.

The preview server must be capable of:

- starting
- health checking
- reporting port
- reporting URL
- logging
- stopping
- restarting
- detecting crashes
- recovering where possible

Use a centralized port allocator.

Prevent collisions with:

- OpenMausBot services
- browser driver
- other project previews
- other runtime services

--------------------------------------------------
PREVIEW UI
--------------------------------------------------

Create a proper Android preview experience.

At minimum:

- live preview surface
- reload
- restart
- stop
- local URL
- runtime status
- build/runtime error state
- open externally where appropriate

Use the existing Android browser/WebView infrastructure where appropriate.

Do not build a redundant browser stack unless genuinely necessary.

--------------------------------------------------
LOCALHOST URL
--------------------------------------------------

The project should report something equivalent to:

http://127.0.0.1:<PORT>

or another correct device-local URL depending on the runtime.

Do not invent the URL.

Only display a URL after the server is actually listening.

--------------------------------------------------
PREVIEW LIFECYCLE
--------------------------------------------------

Android may kill background work.

The preview system must therefore:

- detect preview process death
- show honest state
- allow restart
- avoid infinite spinners
- clean up orphan processes
- integrate with existing foreground-service/runtime lifecycle

Do not assume development servers behave like desktop processes.

--------------------------------------------------
LIVE ITERATION
--------------------------------------------------

Required workflow:

BUILD
→ LOCAL PREVIEW
→ USER REVIEWS
→ ASK_USER IF NECESSARY
→ PATCH
→ REBUILD
→ PREVIEW UPDATE

The user must not have to manually copy files.

--------------------------------------------------
FULL-STACK PREVIEW
--------------------------------------------------

Support projects requiring:

- frontend process
- backend process
- more than one local service where necessary

Represent these as one project-level preview environment.

Track each process independently.

Expose useful state:

frontend: running
backend: running

or:

frontend: running
backend: crashed

Do not show a generic "running" state when part of the app is dead.

--------------------------------------------------
BUILD ERROR LOOP
--------------------------------------------------

If an app fails to build:

1. inspect error
2. identify likely cause
3. fix source/configuration
4. retry build
5. run relevant tests
6. retry preview

Repeat autonomously when safe.

Do not ask the user to fix ordinary coding errors.

Ask the user only when the decision genuinely requires user input.

--------------------------------------------------
PHASE E — AUTONOMOUS BUILD / TEST / FIX LOOP
--------------------------------------------------

Create a robust development loop.

Desired behavior:

PLAN
↓
IMPLEMENT
↓
BUILD
↓
TEST
↓
FAIL?
↓
ANALYZE
↓
FIX
↓
RETEST
↓
LOCAL PREVIEW
↓
USER REVIEW
↓
ITERATE

The agent should know when to stop.

Do not allow endless automatic retries.

Record:
- attempt count
- failure class
- last successful stage

When a failure is genuinely ambiguous or requires a product decision:
→ ask_user

When it is an ordinary coding failure:
→ fix automatically

--------------------------------------------------
TESTING
--------------------------------------------------

Generated apps should receive appropriate testing.

At minimum, depending on stack:

- build verification
- typecheck
- lint
- unit tests where applicable
- basic route/API checks
- startup check
- preview health check

Do not blindly create massive fake test suites.

Tests should validate real behavior.

--------------------------------------------------
PHASE F — VERCEL DEPLOYMENT
--------------------------------------------------

The bot must be able to deploy supported web applications to Vercel.

Use legitimate Vercel APIs/integration mechanisms.

DO NOT make the Android app depend on the Vercel CLI being installed.

The architecture should prefer API-based deployment from the Android environment.

Support:

- authentication
- project creation/selection
- deployment
- deployment status
- build logs
- deployment URL
- redeployment
- environment variables where supported
- production vs preview distinction where appropriate

Do not claim deployment succeeded until the provider reports success.

--------------------------------------------------
VERCEL CREDENTIALS
--------------------------------------------------

Store credentials securely.

Never display access tokens.

Provide user-facing account configuration.

Allow:

- connect account
- test connection
- switch account where supported
- sign out
- inspect connected account metadata

Do not fake OAuth.

--------------------------------------------------
VERCEL DEPLOYMENT WORKFLOW
--------------------------------------------------

Expected:

local build
→ verify
→ collect project files
→ deploy
→ monitor
→ retrieve deployment URL
→ verify accessible result
→ report success

If deployment fails:

show:
- actionable error
- relevant build/deployment stage
- Retry
- Configure

Do not dump hundreds of lines of build logs into chat.

--------------------------------------------------
PHASE G — RENDER DEPLOYMENT
--------------------------------------------------

Add Render as a second deployment provider.

Use Render's supported API/integration architecture.

DO NOT depend on the Render CLI.

Support appropriate service types for generated applications.

At minimum, architect for:

- web services
- static sites
- backend services

where compatible.

Support:

- service creation
- service configuration
- deployment
- status
- logs
- redeploy
- environment configuration
- service URL
- account connection
- account switching/sign-out where supported

Do not create an external service without appropriate user approval.

--------------------------------------------------
DEPLOYMENT ABSTRACTION
--------------------------------------------------

Create a common deployment abstraction.

Example:

DeploymentProvider

with implementations:

VercelDeploymentProvider
RenderDeploymentProvider

The App Builder should not need to know provider-specific details.

It should ask:

"Where should I deploy this?"

Then show only genuinely usable options.

--------------------------------------------------
DEPLOYMENT SAFETY
--------------------------------------------------

Differentiate:

Preview deployment
vs
Production deployment.

Production deployment should require clearer confirmation when it has meaningful external consequences.

Do not silently deploy to production.

--------------------------------------------------
PHASE H — PROJECT MANAGEMENT
--------------------------------------------------

Create a project area where the user can see generated applications.

For each project show:

- name
- framework
- current build status
- preview status
- deployment status
- last modified
- local preview action
- deployment action

Possible states:

Draft
Building
Ready
Previewing
Failed
Deploying
Live

No fake states.

--------------------------------------------------
PROJECT ACTIONS
--------------------------------------------------

Project-level actions:

- Open
- Preview
- Build
- Test
- Stop Preview
- Deploy
- Redeploy
- View Logs
- Environment
- Git
- Rename
- Delete

Destructive operations should follow the existing permission model.

--------------------------------------------------
GIT INTEGRATION
--------------------------------------------------

Generated projects should be Git-aware.

At minimum:

- initialize repository when appropriate
- status
- diff
- commit
- branch information

Do not require GitHub immediately.
Local Git should work independently.
Later, GitHub integration can be added through the existing connector system.

--------------------------------------------------
PHASE I — APP BUILDER USER EXPERIENCE
--------------------------------------------------

The user should not have to understand internal implementation details.

Example:

User:
"Build me a portfolio site."

Bot:
"I'll build it. I need a couple of decisions."

ask_user:

"What style should it have?"

Then:

"What sections should it include?"

Then:

"Should the contact form send email or simply open the user's mail client?"

Then:

build

Then:

"Your first version is ready."

[Preview]

User:
"Make the hero less boring."

Bot:
- activates Taste/UIUX skill
- modifies project
- rebuilds
- refreshes preview

Then:

"Looks good."

Bot:
"Deploy it?"

[Preview] [Deploy]

This is the desired product behavior.

--------------------------------------------------
ERROR UX
--------------------------------------------------

Any important error must be:

- centralized
- prominent enough to notice
- actionable
- concise

Do not show tiny red strings buried in a settings page.

Examples:

Provider authentication error

Dialog:

"Provider authentication failed"

[Configure Provider]
[Edit API Key]
[Retry]

Model unavailable

Dialog:

"Selected model is unavailable"

[Choose Model]
[Configure Provider]
[Retry]

Deployment failure

Dialog:

"Vercel deployment failed"

[View Error]
[Configure]
[Retry]

Local preview failure

Dialog:

"Preview could not start"

Reason:
Port 3100 is already in use.

[Restart]
[View Logs]

--------------------------------------------------
GENERAL CHAT UX
--------------------------------------------------

Bot messages should remain conversational.

Internal progress should not flood the conversation.

Do not turn:

"npm install started"
"npm install 4%"
"npm install 8%"
"npm install 16%"
...

into 40 visible chat messages.

Use a structured task/progress surface.

--------------------------------------------------
NOTIFICATION + TASK PROGRESS SEPARATION
--------------------------------------------------

A background task can update a notification without creating visible chat spam.

Chat:
clean conversation

Task surface:
detailed progress

Notification:
single aggregated bot notification

--------------------------------------------------
SKILL ACTIVATION DURING APP BUILDING
--------------------------------------------------

The agent should automatically consider relevant skills.

Example:

New SaaS UI
→ UI/UX Pro Max
→ Taste

Landing page
→ UI/UX Pro Max
→ Taste

Dashboard
→ UI/UX Pro Max

Redesign existing frontend
→ Taste
→ UI/UX Pro Max

Accessibility review
→ UI/UX Pro Max
→ future accessibility skill if installed

Do not activate unrelated skills.

--------------------------------------------------
DESIGN QUALITY BAR
--------------------------------------------------

Generated applications must not default to:

- generic centered cards
- default blue gradients
- random rounded rectangles
- boilerplate dashboards
- arbitrary giant headings
- repetitive card grids
- pointless animations

The agent should actively seek a coherent visual system.

Use:

- typography hierarchy
- meaningful spacing
- intentional composition
- responsive behavior
- interaction states
- accessible contrast
- appropriate motion
- consistent components

Use upstream design skills as actual guidance, not decoration.

--------------------------------------------------
MOBILE RESPONSIVENESS
--------------------------------------------------

Every generated web app must be checked at:

- mobile width
- tablet-ish width
- desktop width

At minimum, the agent should catch:

- overflow
- broken navigation
- unreadable text
- clipped controls
- unusable touch targets

--------------------------------------------------
SECURITY
--------------------------------------------------

Generated apps must not:

- expose secrets client-side
- embed provider credentials into frontend source
- trust arbitrary input blindly
- create insecure debug endpoints
- expose internal localhost services publicly
- deploy private secrets as source files

Local preview should not accidentally become a public network service.

Prefer loopback-only binding unless there is an explicit reason otherwise.

--------------------------------------------------
NETWORK SAFETY
--------------------------------------------------

Local development tools must respect the existing SSRF/network security model.

Do not allow generated projects to use local services as a bypass around existing network restrictions.

Third-party API access must remain subject to existing policies.

--------------------------------------------------
ARTIFACTS
--------------------------------------------------

Generated projects should be treated as real artifacts.

Support:

- project files
- build outputs where appropriate
- deployment metadata
- screenshots/previews where useful
- logs
- generated documentation

Artifacts should be accessible without dumping their contents into chat.

--------------------------------------------------
APP DELETION
--------------------------------------------------

Deleting a generated app must be distinct from:

- deleting a thread
- deleting a bot

The project should have its own lifecycle.

Deletion should:

- stop preview
- clean managed processes
- remove project metadata
- clean artifacts according to retention rules
- warn appropriately

Do not accidentally delete the bot or conversation.

--------------------------------------------------
RECOVERY
--------------------------------------------------

If Android restarts or the app process dies:

The app should recover enough state to show:

- what projects exist
- which previews were running
- deployment state
- task state

Do not pretend a preview is running when the underlying process no longer exists.

--------------------------------------------------
RESOURCE MANAGEMENT
--------------------------------------------------

Android has limited CPU/RAM.

Implement:

- bounded concurrent builds
- bounded preview processes
- process cleanup
- idle preview handling
- build cancellation where practical
- resource ownership tracking

Do not let one app build consume the entire agent runtime.

--------------------------------------------------
OBSERVABILITY
--------------------------------------------------

Internal debugging should record structured events.

For example:

APP_PROJECT_CREATED
APP_BUILD_STARTED
APP_BUILD_FAILED
APP_BUILD_SUCCEEDED
APP_PREVIEW_STARTED
APP_PREVIEW_FAILED
APP_DEPLOYMENT_STARTED
APP_DEPLOYMENT_SUCCEEDED
APP_DEPLOYMENT_FAILED
ASK_USER_REQUESTED
ASK_USER_ANSWERED

Do not expose raw internal event streams to normal users.

--------------------------------------------------
DOCUMENTATION
--------------------------------------------------

Update project documentation for:

- skill architecture
- App Builder architecture
- localhost preview
- deployment architecture
- notification behavior
- supported frameworks
- limitations
- Android constraints

Document what is genuinely supported.

Do not claim arbitrary framework support.

--------------------------------------------------
PHYSICAL DEVICE ACCEPTANCE TEST
--------------------------------------------------

Final acceptance must happen on the real ARM64 Android device.

Test:

1. Open existing bot.
2. Send a normal conversation.
3. Confirm no notification while inside that chat.
4. Leave chat.
5. Bot sends multiple messages.
6. Confirm exactly one notification.
7. Return to chat.
8. Confirm notification clears.

Then:

9. Create new app through the bot.
10. Allow the bot to ask multiple meaningful questions.
11. Answer through ask_user.
12. Confirm the same task resumes.
13. Confirm generated project appears in project workspace.
14. Build project.
15. Start localhost preview.
16. Open preview on Android.
17. Interact with the application.
18. Ask bot to modify application.
19. Confirm new version appears in preview.
20. Stop/restart preview.
21. Confirm honest runtime state.
22. Run tests.
23. Deploy to Vercel if configured.
24. Verify actual deployment.
25. Retrieve live deployment URL.
26. Verify live application.
27. Repeat with Render where configured.

--------------------------------------------------
NO FALSE PASSING
--------------------------------------------------

The test suite must FAIL when:

- notification duplicates exist
- preview URL is shown before server starts
- preview claims running while process is dead
- deployment claims success without provider confirmation
- generated app does not actually build
- user answer is not used
- skill is listed but not actually loaded
- credentials leak into project files
- production deployment happens without required confirmation
- unsupported frameworks are falsely marked supported

Do not weaken assertions just to obtain green tests.

--------------------------------------------------
DELIVERABLES
--------------------------------------------------

At the end of the implementation provide:

1. Files changed.
2. Architecture summary.
3. New Android UI.
4. New agent tools.
5. Skill integration summary.
6. Localhost architecture.
7. Vercel integration.
8. Render integration.
9. Notification behavior.
10. Tests run.
11. Physical-device tests.
12. Known limitations.
13. Anything deliberately deferred.

Include exact:
- APK build result
- relevant test counts
- TypeScript status
- Android test status
- real-device result
- deployment verification where configured

Do not claim success for any item that was not actually verified.

--------------------------------------------------
PRIORITY / SCOPE DISCIPLINE
--------------------------------------------------

Priority order:

P0
Do not break existing OpenMausBot functionality.

P1
Notification correctness.

P2
Skill infrastructure + UI/UX Pro Max + Taste.

P3
Full-stack App Builder.

P4
Android localhost preview.

P5
Autonomous build/test/fix loop.

P6
Vercel.

P7
Render.

P8
Project/Git/deployment management polish.

Do not waste the current phase on unrelated cosmetic refactors.

Do not port desktop/iOS ask_user unless required by shared architecture.

Do not redesign already-working systems without a concrete reason.

--------------------------------------------------
MOST IMPORTANT PRODUCT PRINCIPLE
--------------------------------------------------

The ultimate experience should be:

USER:
"Build me a habit tracker."

AGENT:
asks meaningful requirements questions

→ plans the application

→ chooses architecture

→ activates relevant skills

→ builds frontend

→ builds backend

→ builds data layer

→ tests

→ starts localhost on the Android device

→ opens the live preview

→ asks the user for feedback

→ modifies the application

→ rebuilds

→ re-tests

→ previews again

→ asks:

"Ready to deploy?"

USER:
"Yes, deploy it to Vercel."

AGENT:
deploys through the real provider API

→ monitors deployment

→ verifies live application

→ returns the actual URL

This should feel like the Android device has become the user's coding workstation and the bot is the developer operating it.

That is the target product.

DO NOT simplify this into:
"AI generates some files."

Build toward:
"AI can take an application from idea → requirements → code → test → local running app → iteration → production."

Begin with PHASE A.


==================================================
MASTER EXTENSION — NATIVE AI UI, DEVICE INTELLIGENCE,
MEDIA CAPABILITIES, PROVIDERS, AND DELIGHTFUL UX
==================================================

IMPORTANT:
This extension is part of the same product specification. It does not replace the existing OpenMausBot architecture, ask_user system, permission system, runtime, browser, MCP, connectors, memory, routines, or app-builder work already specified above.

Treat the existing implementation as the foundation. Extend it cleanly. Do not create parallel systems when an existing abstraction can be extended.

The application name shown to users is:

MOBOT

The long-term product goal is:

MOBOT IS A NATIVE ANDROID AI OPERATING ENVIRONMENT.

It should feel like an AI that can reason, use tools, work with files and device capabilities, create rich native responses, build software, generate media, operate through controlled Android actions, and maintain useful context over time.

The phone is the host. Do not quietly reintroduce desktop, Mac, VPS, Termux, or root dependencies.

--------------------------------------------------
MASTER PRINCIPLE — AI REQUESTS SEMANTIC INTENT,
MOBOT OWNS EXECUTION AND PRESENTATION
--------------------------------------------------

The AI must not generate arbitrary UI code.

Do NOT make the model responsible for:
- HTML rendering
- arbitrary Compose code
- React components
- arbitrary JavaScript UI
- SVG used as a substitute for native components
- screenshots used as fake UI
- ASCII-art tables/charts/diagrams
- arbitrary executable markup

Instead:

AI / AGENT
    ↓
MOBOT STRUCTURED RESPONSE PROTOCOL
    ↓
SCHEMA VALIDATION
    ↓
NATIVE COMPONENT REGISTRY
    ↓
JETPACK COMPOSE RENDERER
    ↓
USER INTERACTION
    ↓
STRUCTURED EVENT
    ↓
ACTIVE AGENT / TASK

The AI supplies semantic data and intent.
MOBOT decides how that information is rendered, interacted with, themed, validated, persisted, and made accessible.

This is a foundational architecture decision.

--------------------------------------------------
PHASE J — NATIVE STRUCTURED RESPONSE SYSTEM
--------------------------------------------------

Build a first-class, versioned structured-response protocol that allows a model or agent to request rich native components in chat and in other MOBOT surfaces.

A response is not required to be plain text.

It may be a composition such as:

Response
├── RichText
├── Statistics
├── Table
├── Chart
├── SourceList
└── Actions

or:

Response
├── SummaryCard
├── Timeline
├── Map
├── Checklist
└── Artifact

or any other valid combination.

The model can request multiple components in one response.

--------------------------------------------------
STRUCTURED COMPONENT REGISTRY
--------------------------------------------------

Create a single registry with stable component contracts.

Every component must define:
- type
- schema version
- semantic purpose
- input/data schema
- validation rules
- native renderer
- supported interactions
- event schema
- accessibility semantics
- mobile layout rules
- compact/normal/expanded behavior where relevant
- theme integration
- persistence/serialization rules
- safe limits for data size and nesting

Example conceptual contract:

Component
├── type
├── version
├── data
├── validation
├── renderer
├── interactions
├── events
├── accessibility
├── layout
├── theming
└── persistence

Only registered components may be rendered.

Unknown component types must fail safely and fall back to readable text rather than arbitrary UI execution.

--------------------------------------------------
REQUIRED STRUCTURED CONTENT TYPES
--------------------------------------------------

Implement all of the following as native, mobile-first components.

1. TABLES
- sortable tables
- horizontally scrollable columns only when necessary
- compact mobile mode
- expandable rows
- filters where useful
- status badges
- tappable links
- numeric alignment
- priority columns
- column visibility rules
- empty/loading/error states

Tables must not simply be desktop HTML tables squeezed onto a phone.

2. CHARTS
Support at minimum:
- line
- bar
- horizontal bar
- area
- stacked bar
- stacked area
- pie
- donut
- scatter
- histogram
- heatmap
- radar
- sparkline

Support:
- titles
- subtitles
- legends
- labels
- touch interaction
- tooltips
- accessible descriptions
- sensible axis behavior
- empty/error states

Do not render a chart when the data is unsuitable.

3. TIMELINES
- chronological events
- milestones
- history
- project events
- travel itineraries
- activity history

4. KANBAN
- mobile horizontal column navigation
- task cards
- status
- priority
- assignee
- drag/reorder only where reliable and useful
- open/expand task details

5. TASKS / CHECKLISTS
- checkable items
- priorities
- due dates
- subtasks
- progress
- status
- actions

6. COMPARISONS
- item-vs-item comparisons
- feature comparisons
- recommendation summary
- pros/cons
- criteria weighting
- compact mobile comparison layout

7. DECISION MATRICES
- criteria
- weights
- options
- scores
- recommendation
- explanation

8. DASHBOARDS
- KPI/statistic cards
- charts
- summaries
- recent activity
- tasks
- alerts
- actions

Dashboards must be mobile-first and must not become a wall of cards.

9. DIAGRAMS
Support native interactive diagrams for:
- flowcharts
- architecture diagrams
- sequence diagrams
- state machines
- decision trees
- dependency graphs
- ER diagrams
- mind maps
- process diagrams
- organization charts

Support appropriate:
- zoom
- pan
- fit-to-screen
- node selection
- edge navigation
- accessible alternative representation

Do not require the AI to generate arbitrary SVG or image diagrams.

10. MAPS
- markers
- routes
- regions
- location details
- selected marker state
- useful actions

Use a legitimate Android/web map implementation appropriate to the actual supported provider.
Do not fake maps.

11. CALENDARS / SCHEDULES
- month view where appropriate
- agenda view
- event cards
- date ranges
- reminders where supported
- recurring schedule representation

12. GANTT-LIKE VIEWS
- tasks on a time axis
- dependencies where supported
- milestones
- progress
- mobile horizontal navigation

13. CODE / DEVELOPER VIEWS
Implement native renderers for:
- syntax-highlighted code
- file trees
- diffs
- test results
- build results
- terminal output
- structured logs
- JSON viewer
- YAML viewer
- SQL view
- dependency trees/graphs
- API schemas
- API explorer where appropriate
- stack traces

Large technical content should be collapsible and navigable.

14. ARTIFACTS / FILE PREVIEWS
Support rich artifact cards/previews for:
- PDF
- document
- spreadsheet
- CSV
- image
- video
- audio
- code project
- archive
- report
- dataset

Do not dump artifact contents into normal chat merely because an artifact was created.

15. FORMS / INTERACTIVE CONTROLS
Native components for:
- single-choice selection
- multi-select
- free text
- number input
- date
- time
- date range
- toggle
- slider
- dropdown
- confirmation
- file selection
- action buttons

These should integrate with the existing ask_user/task pause system.

16. RICH MEDIA
Support native media presentation for:
- images
- image galleries
- video
- audio
- generated media
- previews
- thumbnails
- full-screen viewing where appropriate

--------------------------------------------------
INTERACTIVE RESPONSE EVENTS
--------------------------------------------------

Structured UI must be interactive, not dead decoration.

Examples:
- table sorted
- row opened
- filter changed
- chart point selected
- task checked
- Kanban item moved
- option selected
- form submitted
- artifact opened
- source opened
- retry pressed
- model changed

Return structured events to the active agent/task.

Conceptual flow:

USER TAPS NATIVE CONTROL
    ↓
COMPONENT EVENT
    ↓
MOBOT EVENT ROUTER
    ↓
ACTIVE TASK / AGENT CONTEXT
    ↓
MODEL RECEIVES STRUCTURED RESULT
    ↓
AGENT CONTINUES

Events must not require scraping chat text.

--------------------------------------------------
COMPOSABLE RESPONSE TREES
--------------------------------------------------

The protocol must allow arbitrary combinations of registered components up to safe nesting/depth/size limits.

Example:

RichText
→ Statistics
→ Chart
→ Table
→ SourceList
→ Actions

Each child remains independently addressable when needed.

--------------------------------------------------
SEMANTIC CARD TYPES
--------------------------------------------------

Do not use one generic card for everything.

Support semantic card styles for:
- information
- warning
- success
- error
- recommendation
- profile/person
- product
- location
- event
- file/artifact
- agent/task
- approval
- question
- source

The visual treatment must be consistent across the app.

--------------------------------------------------
PROGRESSIVE DISCLOSURE
--------------------------------------------------

Long responses should reveal important information first.

Support expandable sections for:
- methodology
- detailed analysis
- sources
- raw data
- logs
- technical details
- additional context

Do not force users to read enormous walls of content.

--------------------------------------------------
INTELLIGENT REPRESENTATION SELECTION
--------------------------------------------------

The agent may request semantic content without hard-coding a presentation when appropriate.

MOBOT should support sensible representation guidance such as:

- time series → line/area chart
- category comparison → bar chart
- ranking → ranked list/bar chart
- composition → stacked chart/donut when appropriate
- distribution → histogram
- relationship → scatter
- sequence → timeline
- project tasks → checklist/Kanban/Gantt
- architecture → diagram
- geographic information → map
- structured records → table
- configuration choice → native form
- generated media → media artifact

The system must be able to reject or adapt a poor representation request when necessary.

Never invent data to make a visualization possible.

--------------------------------------------------
VIEW SWITCHING
--------------------------------------------------

Where multiple views are semantically valid, allow the user to switch representations without losing data.

Examples:
- table ↔ chart
- list ↔ Kanban ↔ timeline
- compact ↔ comfortable ↔ expanded

The data model should remain stable while the renderer changes.

--------------------------------------------------
SOURCES / CITATIONS
--------------------------------------------------

Research responses should support native source components.

Each source may include:
- site/provider icon
- title
- domain
- publication/update date where available
- description
- open action

Citations inside structured responses should be tappable where possible.

Do not force users to copy raw URLs.

--------------------------------------------------
SMART LINKS
--------------------------------------------------

Links should be semantic where enough information is known.

Support appropriate handling for:
- normal URLs
- webpages
- files
- documents
- email addresses
- phone numbers
- maps/locations
- product links
- source links
- supported deep links

All valid user-visible links must be clickable.

Never turn a link into an executable action without appropriate validation and permission handling.

--------------------------------------------------
PERSISTENCE OF STRUCTURED CONTENT
--------------------------------------------------

Structured responses must remain structured in conversation history.

Do not flatten them permanently into Markdown or plain text after rendering.

Persist:
- component type
- schema version
- component data
- event/revision metadata as necessary

The renderer should be able to evolve without invalidating historical responses.

Support migration/version compatibility for old component schemas.

--------------------------------------------------
EXPORT / SHARE
--------------------------------------------------

Where appropriate, allow structured content to be:
- shared
- exported
- copied
- saved as an artifact

Export should preserve structure when possible rather than taking a crude screenshot.

--------------------------------------------------
ACCESSIBILITY
--------------------------------------------------

All native components must support:
- content descriptions
- semantic roles
- sufficient contrast
- readable text sizing
- large enough touch targets
- keyboard/accessibility navigation where relevant
- non-visual alternatives to charts and diagrams

Do not make visual beauty depend on sacrificing accessibility.

--------------------------------------------------
SECURITY / VALIDATION OF STRUCTURED UI
--------------------------------------------------

The structured-response renderer must reject:
- arbitrary code
- arbitrary Compose code
- arbitrary JavaScript execution
- executable shell instructions
- unsafe intents
- arbitrary file access requests embedded as UI
- untrusted network calls embedded in component definitions

All components are declarative.

Validate:
- schema
- values
- size
- nesting
- URLs
- IDs
- event payloads

--------------------------------------------------
PHASE K — GLOBAL SPECIALIZED AI CAPABILITIES
--------------------------------------------------

Add a dedicated Settings → Models / Capabilities system for specialized models.

Do not force these models into ordinary bot provider configuration.

Support at minimum dedicated sections for:

- Image Generation
- Video Generation
- Audio Generation
- Speech / TTS
- Music Generation where supported
- Image Understanding / Vision where supported
- Video Understanding where supported
- Audio Understanding where supported
- future specialized capabilities

Each capability entry must support appropriate:
- provider
- model
- authentication/credentials
- enabled/disabled state
- capability metadata
- limits
- cost/usage metadata where available

Generation models are GLOBAL and SHARED across bots unless a future feature explicitly introduces scoped overrides.

A bot should not need separate image-model configuration merely because another bot already uses the same generation model.

--------------------------------------------------
MEDIA GENERATION FLOW
--------------------------------------------------

Normal chat model:
→ determines that image/video/audio/etc. generation is needed
→ requests a structured capability invocation
→ MOBOT resolves configured global capability model
→ provider executes real API call
→ generated output becomes an artifact/media result
→ native renderer displays it in chat

The chat model must not need to know provider-specific API plumbing.

Use legitimate provider APIs.
Never fake successful generation.

Generation failures use the same polished actionable error system described elsewhere in this prompt.

--------------------------------------------------
NATIVE ANDROID DEVICE INTELLIGENCE
--------------------------------------------------

MOBOT should expose controlled Android-native capabilities through a single coherent capability layer.

Do not create a parallel execution/permission architecture.

The AI may request capabilities such as:

Find file
Read file
Create folder
Move file
Copy file
Rename file
Delete file, when permitted
Open app
Open URL
Share
Copy
Calendar action
Contact action
Camera
Screenshot
Notification action

Also support where legitimately available:
- create file
- search files by semantic metadata
- inspect file metadata
- open file
- export/save artifact
- launch Android chooser
- invoke supported Android intents

Every device action must have a clear capability contract.

--------------------------------------------------
DEVICE FILE SYSTEM ACCESS
--------------------------------------------------

Add a first-class Device Files capability.

Goal:
The bot should be able to work with the accessible file structure on the Android device instead of requiring manual attachment for every operation.

Support:
- browse directories
- list contents
- search files
- read supported files
- inspect metadata
- create directories
- create files
- copy
- move
- rename
- delete according to permission/risk rules
- save generated artifacts to selected destinations

Use Android storage mechanisms correctly.

Support:
- Storage Access Framework for user-selected files/folders
- broader shared-storage access only where legitimately permitted by Android and the distribution environment

Important:
Do not claim unrestricted access to Android private app sandboxes or system-protected areas when Android does not permit it.
Expose an honest capability scope.

Possible user-facing access levels:
- No file access
- Selected folders/files
- Shared device storage / broad file access where supported and explicitly granted

The bot must only use the access already granted to that bot/task scope.

--------------------------------------------------
FILE SEARCH / NATURAL LANGUAGE
--------------------------------------------------

Support requests such as:

"Find my latest resume."

"Find the PDF I downloaded about Kubernetes."

"Compare these three reports."

"Create a folder for this project and save the generated files there."

Use indexing/metadata where practical so common searches do not require scanning the entire storage repeatedly.

Index only data the user has actually granted access to.

--------------------------------------------------
DEVICE STORAGE INSIGHTS
--------------------------------------------------

Provide useful native views for:
- storage usage
- large files
- file categories
- duplicate candidates
- old downloads
- project folders

Destructive cleanup remains subject to the existing risk-based permission model.

--------------------------------------------------
DOWNLOADS ORGANIZER
--------------------------------------------------

Allow the user to ask MOBOT to inspect an accessible Downloads folder and suggest organization such as:
- PDFs
- images
- videos
- installers
- documents
- archives
- project files

The agent may propose actions and execute safe organization silently where permitted.
Destructive actions require approval.

--------------------------------------------------
FILE WATCHERS / AUTOMATIONS
--------------------------------------------------

Where Android lifecycle and storage APIs allow, support routines such as:

"Whenever a PDF arrives in this folder, summarize it and save the summary here."

File watchers must:
- respect Android restrictions
- survive restart where supported
- avoid excessive background work
- avoid notification spam
- expose honest state

--------------------------------------------------
ANDROID SHARE SHEET
--------------------------------------------------

Support:
Android Share → MOBOT

Allow sharing:
- text
- links
- images
- files
- videos
- documents

The user should be able to select a destination bot where appropriate and continue naturally.

--------------------------------------------------
CLIPBOARD INTELLIGENCE
--------------------------------------------------

Provide explicit, privacy-conscious support for analyzing copied content.

Examples:
- copied URL → summarize/research/open
- copied error → explain/fix
- copied text → rewrite/summarize
- copied code → analyze

Do not continuously monitor the clipboard without legitimate Android permission/behavior and clear product justification.

Prefer user-initiated invocation.

--------------------------------------------------
SCREEN CONTEXT
--------------------------------------------------

Where Android permits, support explicit user-invoked screen context.

The user may ask MOBOT about what they are currently viewing.

Examples:
- explain this screen
- summarize what I'm looking at
- help me complete this form

Do not create covert screen surveillance.

User invocation and platform restrictions must be respected.

--------------------------------------------------
SCREENSHOT UNDERSTANDING
--------------------------------------------------

Support an explicit action to capture a screenshot and send it to a capable vision model.

The bot should understand the image as content, not merely attach it as a dumb file.

--------------------------------------------------
CAMERA INPUT
--------------------------------------------------

Support user-initiated camera capture for tasks such as:
- identify/explain object
- read text
- inspect document
- compare physical objects
- interpret signs/labels

Do not activate the camera silently.

--------------------------------------------------
LOCAL MEDIA INTELLIGENCE
--------------------------------------------------

When the user grants access to local media, support semantic analysis of:
- images
- videos
- audio

Examples:
- find photos matching a description
- summarize a video
- transcribe an audio file
- identify duplicate/near-duplicate media candidates

Respect resource limits and Android permissions.

--------------------------------------------------
UNIVERSAL CAPTURE
--------------------------------------------------

Provide one simple MOBOT entry point that can capture the current user-provided context such as:
- screenshot
- selected text
- shared link
- selected file
- camera image

Then allow the user to immediately ask a bot what to do with it.

--------------------------------------------------
CALENDAR / CONTACTS / DEVICE ACTIONS
--------------------------------------------------

Where APIs and permissions permit, support native actions through Android's appropriate APIs/intents.

Calendar examples:
- inspect schedule
- create event
- modify event
- find conflicts

Contact examples:
- search contact
- retrieve permitted contact details
- open contact

All external effects use the existing risk-based permission system.

Do not create hidden or silent external actions with meaningful consequences.

--------------------------------------------------
UNIVERSAL SEARCH
--------------------------------------------------

Build a unified search experience across data the user has permitted MOBOT to index:
- chats
- threads
- bots
- memories
- files
- artifacts
- projects
- sources
- routines
- connected services where available

Search should understand semantics, not only exact text, where practical.

--------------------------------------------------
SMART LINK HANDLING
--------------------------------------------------

When a user pastes a URL, offer relevant native actions based on actual content/capability:
- open
- summarize
- research
- extract data
- save
- download
- compare

Do not assume every URL is safe or fetchable.
Use the existing browser/network/SSRF security model.

--------------------------------------------------
PHONE SHORTCUTS / WIDGETS
--------------------------------------------------

Where practical, support Android-native shortcuts/widgets for:
- opening a selected bot
- starting a new chat
- quick capture
- routines
- active task state
- daily briefing

Do not create widgets that pretend an agent is active when the runtime is not actually active.

--------------------------------------------------
VOICE EXPERIENCE
--------------------------------------------------

Support a polished native voice conversation mode when configured capabilities exist.

Support:
- speech input
- model response
- TTS playback
- interruption
- stop/resume
- visible state

Use globally configured speech models.

--------------------------------------------------
PHASE L — PROVIDERS AND AUTHENTICATION
--------------------------------------------------

Complete the provider system so API providers and account-authentication providers are represented correctly.

These are related but distinct concepts:

API PROVIDER
→ API endpoint + model catalog + credential method

ACCOUNT AUTHENTICATION
→ user signs into an account/service and obtains legitimate authorization

CLI RUNTIME
→ optional execution mechanism, NOT proof that authentication is unavailable

Do not confuse:
- "CLI not installed"
with:
- "sign-in unavailable"

Do not solve this by merely hiding sign-in buttons.

--------------------------------------------------
PROVIDER REQUIREMENTS
--------------------------------------------------

Support an extensible, effectively unlimited provider model.

Users should be able to add legitimate API providers without hard-coded arbitrary limits.

Each provider can define:
- display name
- official logo/icon
- API endpoint configuration
- model catalog
- auth mode
- API key support where applicable
- account auth support where legitimately available
- health/availability
- limits
- documentation/help links

Provider-specific branding must be honest.
Do not display an official provider identity for a generic OpenAI-compatible endpoint unless the configuration genuinely represents that provider.

--------------------------------------------------
NATIVE ACCOUNT AUTH
--------------------------------------------------

Where a provider supports legitimate browser/device-code/redirect/native authentication that can be implemented on Android, implement the real flow.

Support where legitimately possible:
- sign in
- callback/redirect handling
- secure token storage
- token refresh
- account metadata
- sign out
- account switching

Never invent OAuth endpoints, fake callback URLs, mock accounts, or fake success states.

For providers such as Codex, Qwen, OpenCode, or any future account-auth provider:
- investigate the real supported authentication mechanism
- do not require a desktop CLI merely to represent account auth
- do not label a provider unavailable solely because its CLI is absent
- if there is no legitimate native authentication mechanism, say so honestly
- where an API-key route genuinely exists, expose it as an appropriate alternative

New Chat should show only providers/models that are genuinely usable in the current configuration.

--------------------------------------------------
MODEL SELECTOR
--------------------------------------------------

Provider/model selection must be exceptionally polished.

Requirements:
- provider logos, not arbitrary letters where a real logo exists
- provider name clearly visible
- model list filtered to the selected provider
- usable models only in New Chat
- honest availability status
- auth/configuration path when required
- search/filter when catalogs are large
- useful model metadata where available

A generic OpenAI-compatible API entry must not masquerade as unrelated official providers.

--------------------------------------------------
PHASE M — PDF / DOCUMENT INTELLIGENCE
--------------------------------------------------

Support PDF upload through Android's Storage Access Framework without requesting unnecessary device storage permissions.

PDF handling must support:
- text extraction
- page-aware references where possible
- multiple distinct PDFs in one task
- structured parsing
- semantic retrieval
- document comparison
- table extraction where supported
- image/page inspection where necessary

The bot should answer naturally from the PDF.

Do NOT dump the entire PDF's extracted text into chat.

Example:
User:
"What does the report say about revenue growth?"

Good:
"The report says revenue grew 14% in FY2025, mainly due to... (p. 7)."

Bad:
A giant pasted block of PDF text.

When precise page references are available, expose them in the answer or as native citations.

Multiple documents must remain distinguishable.

--------------------------------------------------
PHASE N — ACTIONABLE ERROR EXPERIENCE
--------------------------------------------------

Raw upstream errors must never be dumped into normal chat.

Classify common errors including:
- 429 rate limit
- quota/credits exhaustion
- authentication failure
- unavailable model
- invalid configuration
- provider outage
- network failure
- timeout
- malformed provider response
- local runtime failure
- deployment failure
- preview failure

Show a prominent, polished native error card/dialog.

Minimum content:
- what went wrong
- provider/model involved
- what the user can do

Useful actions may include:
- Retry
- Change model
- Provider settings
- Edit API key
- Save & Test
- View diagnostic details

The underlying technical error remains available to diagnostics/logging but is not exposed as raw JSON by default.

The exhausted-retry path is included in testing.

For 429 specifically:
- retry according to the existing bounded retry system where applicable
- once retries are exhausted, show the polished actionable error UI
- never show the raw upstream JSON blob as the primary experience

--------------------------------------------------
EDIT-IN-PLACE ERROR RECOVERY
--------------------------------------------------

When a provider/model failure is caused by configuration, the error UI should allow direct correction where practical.

Example:

Provider authentication failed

Provider: OpenRouter
Model: selected-model

[Edit provider]
[Edit API key]
[Save & Test]
[Retry]

For model errors:

Model unavailable

[Change model]
[Provider settings]
[Retry]

Do not force the user through multiple unrelated settings screens if the relevant editor can safely appear in-context.

--------------------------------------------------
PHASE O — CHAT / APP UI QUALITY BASELINE
--------------------------------------------------

The default MOBOT visual language is LIGHT.

Do not make dark mode the default.

Target characteristics:
- warm/light canvas
- soft neutral surfaces
- restrained accent colors
- subtle decorative backgrounds/patterns
- strong typography
- generous but controlled whitespace
- elegant icons
- rounded surfaces where appropriate
- subtle depth
- polished conversation bubbles
- minimal chrome
- clean mobile hierarchy

The visual quality target should be inspired by high-quality modern conversational products such as the provided reference, without cloning proprietary branding/assets.

The interface must feel intentional, editorial, playful, premium, and native to Android.

Do not allow the background art to overpower the conversation.

--------------------------------------------------
GLOBAL BACKGROUND SYSTEM
--------------------------------------------------

Support site-wide subtle backgrounds.

Existing background picker behavior should remain functional.

Allow users to choose from bundled MOBOT backgrounds.

Future-ready design:
- predefined backgrounds
- user-selected device image
- future color controls
- future bot-specific variants

Background preference must persist.

Do not reduce text readability or accessibility.

--------------------------------------------------
BOT VISUAL IDENTITY
--------------------------------------------------

Each bot may have a visual identity with:
- avatar
- avatar shape
- avatar color/accent
- subtle background treatment
- personality-aware accenting

Avatar shape/color controls must actually work and persist.

Provider logos should be shown where relevant rather than generic letter avatars.

--------------------------------------------------
BOT MOOD / STATUS
--------------------------------------------------

Provide subtle user-facing states such as:
- ready
- thinking
- researching
- waiting for user
- working
- paused
- completed
- failed

Do not expose internal chain-of-thought.
Do not create noisy per-tool progress messages.

--------------------------------------------------
CONTEXTUAL MESSAGE ACTIONS
--------------------------------------------------

Messages should support useful lightweight actions such as:
- retry
- regenerate
- shorten
- expand
- explain
- summarize
- translate
- make a plan
- challenge this
- visualize
- turn into table
- turn into checklist
- save as artifact
- share

These should be context-sensitive rather than a giant permanent toolbar.

--------------------------------------------------
RESPONSE REMIXING
--------------------------------------------------

Allow a user to regenerate or transform only a selected section/component of a structured response without regenerating everything.

Example:
User changes only the chart.

The rest of the response remains stable.

Preserve structured data and component identity where possible.

--------------------------------------------------
BEAUTIFUL PREVIEWS
--------------------------------------------------

Automatically turn supported links/files/media/artifacts into polished native previews.

Avoid plain attachment rows when a richer preview is useful.

--------------------------------------------------
SMART CONTEXTUAL ACTIONS
--------------------------------------------------

When content is on screen, show useful context-aware actions.

Examples:

PDF:
[Summarize] [Extract data] [Compare] [Find contradictions]

Image:
[Explain] [Extract text] [Describe] [Compare]

Dataset:
[Analyze] [Chart] [Find anomalies] [Summarize]

URL:
[Open] [Summarize] [Research] [Save]

Do not show irrelevant generic actions.

--------------------------------------------------
SMART RECAPS
--------------------------------------------------

Provide optional personalized recap experiences such as:

"What changed while you were away?"

A recap may summarize:
- completed tasks
- important bot messages
- newly created artifacts
- pending questions
- meaningful errors
- routine results

Do not create notification spam.

--------------------------------------------------
DAILY BRIEFING
--------------------------------------------------

Provide an optional beautiful daily briefing surface that can aggregate user-configured information from available MOBOT capabilities, such as:
- calendar
- routines
- important tasks
- agent results
- selected updates
- weather only if a weather capability is configured/available

The user must control what appears.

Keep it useful, concise, and calm.

--------------------------------------------------
MEMORY / KNOWLEDGE EXPERIENCE
--------------------------------------------------

Make bot memory inspectable and editable.

Support useful contextual surfaces such as:
- remembered facts
- source/context
- confidence where supported
- recent relevant memories

A future-ready "Knowledge Garden" concept may surface useful connections between saved material, conversations, files, projects, and recurring topics.

Do not expose sensitive internal reasoning.

--------------------------------------------------
BEAUTIFUL COMPLETION MOMENTS
--------------------------------------------------

When a long task completes, do not merely emit:

"Done."

Show a useful completion summary such as:

Task complete

Created:
- 4 files
- 1 report
- 2 charts

[Open result]
[Preview]
[Share]

The completion surface must remain concise and meaningful.

--------------------------------------------------
SHARING
--------------------------------------------------

Support beautiful native sharing for:
- messages
- structured response components
- charts
- source lists
- artifacts
- generated media

Prefer a clean structured share representation where possible rather than a low-quality screenshot.

--------------------------------------------------
ROUTINES
--------------------------------------------------

Routines should feel like useful personal workflows rather than raw cron jobs.

Support:
- friendly routine cards
- status
- next run
- last result
- history
- enable/disable
- conversational editing where supported

Examples:
- daily briefing
- file watcher
- recurring research
- periodic report
- periodic cleanup suggestion

Respect Android lifecycle and power constraints.

--------------------------------------------------
EXISTING UI REQUIREMENTS TO PRESERVE
--------------------------------------------------

Preserve/fix the following product expectations:

- app name: MOBOT
- landing page should not show unnecessary date/time
- provider logos should be used where available
- memory editor must support multiline editing
- bot settings should clearly show current provider rather than an ambiguous "Select provider" state when configured
- model selector should only show models belonging to the selected provider
- connectors should be accessible from the appropriate dedicated entry point rather than cluttering general Settings
- Threads top-right T icon should function as the Connectors entry point if that is the established product design
- chat deletion must work, including appropriate protection against deleting the final required thread/state
- New Chat should allow meaningful configuration such as name, provider, model, context, role, and other relevant settings
- New Chat should show only genuinely usable providers/models
- PDF attachment must use the Android picker without unnecessary blanket storage permissions
- all user-visible links should be clickable
- computer state must be honest and must not spin forever
- remove unnecessary desktop/computer leftovers from Android settings
- remove obsolete UI and dead settings that do not represent actual Android functionality
- avatar customization must work and persist

--------------------------------------------------
COMPUTER / BROWSER HONESTY
--------------------------------------------------

If Android genuinely lacks a capture/preview source for computer frames:
- do not show a fake live preview
- do not spin indefinitely
- show a clear capability state
- allow the supported actions that still work

Similarly, browser/preview state must only be shown as active when the underlying runtime is active.

Fix recurring issues such as:
- android_computer_workspace_stat errors
- duplicate WebView instances
- stale preview state
- stale driver ports
- misleading connection state

--------------------------------------------------
STARTUP / CONNECTION UX
--------------------------------------------------

Startup should transition honestly:

Initializing
→ Connecting
→ Connected

Do not immediately show "Offline" merely because the first connection check has not completed.

If connection fails, show a real error state with a useful retry/configuration path.

--------------------------------------------------
APPROVAL UX
--------------------------------------------------

Do not overwhelm users with approval spam.

Use the existing permission architecture.

Prefer task-level approval scope when appropriate.

Safe ordinary operations should be silent.

Meaningful external effects should request approval.

Destructive/high-impact actions should require explicit approval.

Approval requests must be visually distinct from ask_user.

Do not create another broker.

--------------------------------------------------
VISUAL TASK / AGENT STATUS
--------------------------------------------------

Do not put internal execution noise into normal chat.

A task surface may show structured status such as:

Researching semiconductor companies
3 sources found
2 reports analyzed

Expandable for details.

Normal chat remains conversational.

Notifications remain aggregated.

--------------------------------------------------
PHASE P — FUTURE-FACING DEVICE CAPABILITY REGISTRY
--------------------------------------------------

Build the device capability layer so future Android actions can be added without redesigning the agent architecture.

Conceptually:

DeviceCapabilityRegistry
├── Files
├── Camera
├── Screenshot
├── Share
├── Clipboard
├── Calendar
├── Contacts
├── Apps / Intents
├── Notifications
├── Media
└── future capabilities

Each capability should expose:
- stable ID
- description
- availability
- required Android permission(s)
- supported operations
- risk classification
- invocation schema
- result schema
- lifecycle behavior
- error classification

The agent sees capabilities, not implementation-specific Android internals.

--------------------------------------------------
PHASE Q — SAFETY / CONSENT MODEL FOR DEVICE ACTIONS
--------------------------------------------------

Use the existing permission/approval architecture.

Suggested risk categories:

LOW RISK
- read permitted file metadata
- read permitted file content
- open URL
- open app
- analyze user-provided screenshot
- copy to clipboard when explicitly requested

MEDIUM RISK
- create/move/rename files
- create calendar event
- share content
- modify non-destructive app state

HIGH RISK
- delete files
- send external messages
- make consequential external changes
- production-impacting actions

Do not treat categories as immutable if an existing capability policy already has a better classification.

The important rule is:

SAFE OPERATIONS SHOULD FEEL EASY.
MEANINGFUL CONSEQUENCES SHOULD BE VISIBLE.

Do not interrupt harmless operations with permission dialogs just because Android has a permission API available.

--------------------------------------------------
PHASE R — DEVICE SEARCH / CONTEXT PIPELINE
--------------------------------------------------

Build a coherent context pipeline for user-provided or user-authorized device data.

Potential sources:
- files
- PDFs
- images
- screenshots
- camera captures
- videos
- audio
- shared URLs
- selected text
- calendar data
- contacts
- project artifacts

The agent should receive bounded, relevant context rather than indiscriminately dumping everything into a model prompt.

Use retrieval, indexing, previews, and references where practical.

--------------------------------------------------
PHASE S — STRUCTURED COMPONENT + DEVICE ACTION COMBINATION
--------------------------------------------------

Structured UI and device capabilities must work together.

Example:

User:
"Find my three latest resumes and compare them."

MOBOT:
→ searches accessible files
→ identifies candidate resumes
→ renders native comparison table
→ provides [Open] actions
→ provides [Use this resume] action

Another example:

User:
"Create a folder for this project and save the generated report there."

MOBOT:
→ asks approval only if required
→ creates folder
→ saves artifact
→ renders artifact card with path and actions

Another:

User:
"Make this PDF into a chart."

MOBOT:
→ reads PDF
→ extracts relevant data
→ validates chart suitability
→ renders native chart
→ provides page/source references

--------------------------------------------------
PHASE T — STRUCTURED MODEL / CAPABILITY ORCHESTRATION
--------------------------------------------------

The agent should reason about what capability is needed, then request the capability.

Examples:

"Generate an image of this concept."
→ image_generation

"Turn this report into a narrated summary."
→ document parsing + speech/TTS

"Build a presentation from these notes."
→ structured content + image generation + artifact generation

"Analyze these photos and create a contact sheet."
→ local media + vision + native artifact renderer

The agent should not manually encode provider-specific API calls into chat content.

--------------------------------------------------
MASTER PRODUCT EXPERIENCE
--------------------------------------------------

MOBOT should support the following conceptual loop:

USER
→ asks a normal question

AGENT
→ answers naturally

or:

USER
→ provides file/image/link/context

AGENT
→ analyzes it
→ chooses appropriate native representation
→ produces structured result

or:

USER
→ asks MOBOT to perform a task

AGENT
→ selects capabilities/tools
→ performs safe operations
→ asks user only when genuinely necessary
→ pauses/resumes through existing ask_user
→ returns a clean result

or:

USER
→ asks MOBOT to create software

AGENT
→ gathers requirements
→ activates relevant skills
→ builds
→ tests
→ previews
→ asks for feedback
→ iterates
→ deploys when approved

or:

USER
→ asks MOBOT to work with the device

AGENT
→ requests native device capability
→ validates risk/permissions
→ performs operation
→ reports clean structured result

--------------------------------------------------
FUN / DELIGHTFUL BUT USEFUL FEATURES
--------------------------------------------------

These are intentionally not games. They should make daily use of MOBOT feel pleasant and personal.

1. BOT VISUAL IDENTITY
Each bot can have its own restrained visual identity: avatar, accent, subtle background, and personality-aware presentation.

2. CONTEXTUAL ACTION CHIPS
Useful action suggestions change according to the content currently on screen.

3. RESPONSE REMIXING
Transform or regenerate one section/component without regenerating everything.

4. SMART RECAP
A beautiful "what changed while I was away?" surface across meaningful agent activity, artifacts, tasks, and pending questions.

5. DAILY BRIEFING
Optional personalized morning/periodic briefing using user-selected MOBOT capabilities.

6. BEAUTIFUL COMPLETION CARDS
Long-running tasks finish with a polished, useful summary and direct result actions.

7. PERSONAL KNOWLEDGE GARDEN
Optional future-facing surface that helps users discover useful connections among saved material, projects, files, and conversations.

8. SMART SHARE CARDS
Turn useful structured responses into clean shareable representations.

Do not allow these features to become clutter.

--------------------------------------------------
DESIGN DISCIPLINE FOR FUN FEATURES
--------------------------------------------------

Delight must come from:
- good motion
- hierarchy
- interaction
- responsiveness
- personalization
- visual quality
- useful shortcuts

Not from:
- excessive animations
- gamification
- confetti everywhere
- notification spam
- huge decorative UI
- meaningless badges

--------------------------------------------------
PHASE U — OBSERVABILITY FOR NEW SYSTEMS
--------------------------------------------------

Add structured internal events for important operations such as:

STRUCTURED_RESPONSE_CREATED
STRUCTURED_COMPONENT_RENDER_FAILED
STRUCTURED_COMPONENT_INTERACTION
MEDIA_CAPABILITY_REQUESTED
MEDIA_GENERATION_STARTED
MEDIA_GENERATION_SUCCEEDED
MEDIA_GENERATION_FAILED
DEVICE_CAPABILITY_REQUESTED
DEVICE_CAPABILITY_SUCCEEDED
DEVICE_CAPABILITY_FAILED
FILE_SEARCH_STARTED
FILE_SEARCH_COMPLETED
FILE_ACTION_APPROVAL_REQUESTED
FILE_ACTION_SUCCEEDED
PROVIDER_AUTH_STARTED
PROVIDER_AUTH_SUCCEEDED
PROVIDER_AUTH_FAILED
MODEL_AVAILABILITY_CHANGED
SMART_RECAP_CREATED
DAILY_BRIEFING_CREATED

Keep raw event streams out of normal chat.

--------------------------------------------------
TESTING REQUIREMENTS FOR NEW SYSTEMS
--------------------------------------------------

Every new subsystem must include:
- unit tests
- integration tests where appropriate
- schema validation tests
- Android UI tests where applicable
- persistence/restart tests
- failure-path tests
- physical ARM64 verification where Android behavior is involved

Structured UI physical tests must cover at least:
- table rendering
- chart rendering
- scrolling
- component expansion
- action events
- form submission
- mixed response rendering
- persistence after Activity recreation
- history replay
- invalid component fallback

Device capability physical tests must cover at least:
- file discovery
- file read
- file creation
- folder creation
- move/rename
- safe deletion approval path where applicable
- Share Sheet
- screenshot
- camera with explicit invocation
- calendar action where configured
- contact lookup where configured
- app/URL intents
- notification behavior
- restart/recovery

Provider tests must cover actual configured providers and must distinguish:
- unavailable CLI runtime
- unavailable authentication
- invalid credentials
- unavailable model
- successful configuration

Media tests must verify actual generated/returned artifacts when real provider credentials are configured.
Do not substitute mocks for final proof where real integration is required.

--------------------------------------------------
NO FALSE PASSING — EXTENDED
--------------------------------------------------

Tests must fail when:
- structured UI is silently flattened into ugly plain text
- component interactions do not reach the active task
- invalid component schemas render unsafe content
- charts display invented or malformed data
- structured responses disappear after reload
- unavailable models appear as usable in New Chat
- CLI absence is incorrectly treated as proof that account auth is impossible
- fake provider authentication is shown as successful
- fake generation output is shown as real
- raw 429/provider JSON is shown to users after retries
- PDF content is dumped wholesale into chat
- unauthorized device files are accessed
- destructive actions bypass approval
- device action state is faked
- background/runtime state is faked
- notification spam returns
- dark/default styling makes the app unreadable
- provider identity is falsely represented

Do not weaken tests simply to obtain green results.

--------------------------------------------------
IMPLEMENTATION ORDER FOR THIS EXTENSION
--------------------------------------------------

After completing the existing prompt's active phase and without breaking it, prioritize this extension roughly as follows:

P0
Preserve existing MOBOT functionality and current verified systems.

P1
Native structured response protocol + component registry + core renderers.

P2
Structured interactions + persistence + forms/ask_user integration.

P3
Provider/auth correctness and polished model/provider selectors.

P4
Device file capability + file search + Android actions.

P5
PDF/document semantic intelligence + rich artifacts.

P6
Global specialized AI capability registry + image/video/audio generation.

P7
Structured sources, links, code views, maps, dashboards, diagrams, schedules, and advanced views.

P8
Delight features such as contextual actions, response remixing, smart recaps, daily briefing, and polished completion surfaces.

P9
Physical-device visual QA and end-to-end integration.

Do not implement every feature in a single uncontrolled commit.

--------------------------------------------------
DEFINITION OF DONE — EXTENSION
--------------------------------------------------

This extension is not complete because source files merely exist.

It is complete only when:

1. The AI can request registered structured components.
2. MOBOT renders those components natively in Compose.
3. Mixed structured responses work in one chat message.
4. Components are mobile-first and accessible.
5. Component interactions return structured events to the agent.
6. Structured responses persist and replay correctly.
7. The AI can request global specialized generation capabilities.
8. Generated media becomes a real artifact in chat.
9. Provider/authentication state is truthful.
10. New Chat exposes only genuinely usable models/providers.
11. The bot can work with user-authorized device files.
12. Native device actions work through the existing permission architecture.
13. PDF/document understanding is semantic and page-aware where possible.
14. Important errors are prominent, actionable, and free of raw provider JSON.
15. Existing notification behavior remains aggregated and non-spammy.
16. Existing ask_user survives unchanged as the task-pause mechanism.
17. Background/runtime/computer state is honest.
18. All relevant Android behavior is verified on real ARM64 hardware.
19. No fake capability, fake auth, fake generation, fake deployment, or fake runtime state exists.
20. Documentation reflects what is genuinely supported and what remains constrained by Android/provider capabilities.

--------------------------------------------------
FINAL PRODUCT PRINCIPLE
--------------------------------------------------

MOBOT SHOULD FEEL LIKE THIS:

The user talks normally.

The AI decides what it needs.

MOBOT provides the right tool, file capability, Android capability, specialized model, or native UI component.

The result appears as a beautiful, useful, interactive native experience.

The user can act on that result without fighting the interface.

When the agent needs a meaningful decision, it asks cleanly.

When the agent encounters a failure, it explains it clearly and provides recovery actions.

When it finishes a substantial task, it presents the result elegantly.

When the user returns later, useful state remains available.

The model supplies intelligence.
MOBOT supplies capability, execution, safety, persistence, and presentation.

Do not reduce MOBOT to:

"AI generates text and some files."

Build toward:

"AI can understand the user's intent, work with the Android device, use tools and specialized models, produce rich native interfaces, build software, operate on permitted files, generate artifacts, pause for meaningful decisions, recover from errors, and complete real tasks entirely from the phone."

That is the target.

