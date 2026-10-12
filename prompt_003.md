MASTER NEXT-PHASE IMPLEMENTATION PROMPT
OpenMausBot Android — Agentic App Builder, Skills, Local Preview, Deployment, Notifications

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
