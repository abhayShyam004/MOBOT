You are working on OpenMausBot Android, a standalone native Android application.

IMPORTANT:
This is a COMPLETE UI/UX REDESIGN phase.

The goal is NOT to add new functionality.
The goal is NOT to redesign the backend.
The goal is NOT to simplify or remove existing capabilities.

The goal is to transform the visual design, information hierarchy, navigation, interaction patterns, spacing, typography, components, animations, dialogs, settings, bot roster, chat interface, and overall user experience so the application feels like a polished modern AI-native Android application with the visual cleanliness and refinement of Grok Bot.

Use the provided Grok Bot screenshots as the PRIMARY VISUAL REFERENCE.

Do NOT blindly clone Grok.
Do NOT copy proprietary assets.
Do NOT copy exact icons or branding.
Do NOT recreate Grok pixel-for-pixel.

Instead, reproduce the DESIGN QUALITY and DESIGN LANGUAGE:

- extremely clean
- minimal
- spacious
- dark
- elegant
- modern
- personality-driven
- bot-centric
- visually calm
- strong typography
- restrained colors
- subtle surfaces
- minimal chrome
- excellent spacing
- obvious hierarchy
- very little unnecessary metadata
- polished Android-native interaction
- functionality hidden until needed

The final application should feel like a product designed intentionally by a high-end consumer product design team, not an engineering dashboard.

==================================================
1. ABSOLUTE PRODUCT PRINCIPLE
==================================================

The application currently exposes too much of its internal machinery through the UI.

Change that.

The user should feel:

    "I have AI agents that I work with."

NOT:

    "I am operating a complicated agent management system."

OpenMausBot contains sophisticated functionality:

- persistent bots
- conversations
- threads
- memory
- MCP
- connectors
- browser
- computer
- terminal
- filesystem
- coding
- long-running tasks
- routines
- skills
- approvals
- providers
- models
- projects
- artifacts
- autonomous execution
- notifications
- agent collaboration

None of that should disappear.

Instead, the interface should progressively reveal complexity only when the user needs it.

The UI should communicate sophistication through simplicity.

==================================================
2. VISUAL NORTH STAR
==================================================

Use the provided Grok Bot screenshots as the visual benchmark.

The target aesthetic is:

DARK
MINIMAL
SPACIOUS
SOFT
PERSONAL
BOT-CENTRIC
PREMIUM
QUIET

Avoid:

- dense cards
- excessive borders
- excessive shadows
- dashboard grids
- large technical labels
- excessive status text
- giant settings forms
- nested boxes
- unnecessary tabs
- excessive floating buttons
- visual clutter
- excessive iconography
- desktop-style controls
- "developer console" appearance
- enterprise SaaS appearance
- generic Material 3 template appearance

The application should NOT look like:

- a CRUD application
- an admin dashboard
- a settings application
- a developer IDE
- a monitoring console
- a web application wrapped inside Android

It should feel like a native AI companion/workspace application.

==================================================
3. DESIGN LANGUAGE
==================================================

Create a coherent global design system before redesigning individual screens.

Define centralized:

- colors
- typography
- spacing
- corner radii
- icon sizes
- avatar sizes
- dividers
- surfaces
- buttons
- chips
- dialogs
- bottom sheets
- navigation
- list rows
- status indicators
- empty states
- loading states
- error states
- animations

Do NOT independently style each screen.

Everything must come from the same design system.

--------------------------------------------------
3.1 Color
--------------------------------------------------

Use a sophisticated dark theme as the primary experience.

The background should be very dark but NOT necessarily pure black.

Use a small number of surfaces:

- background
- elevated surface
- slightly elevated surface
- pressed/selected surface

Avoid rainbow-colored UI.

Accent colors should primarily come from:

- bot avatars
- meaningful state
- important actions

Do not make every button brightly colored.

Status colors should be restrained:

- success
- warning
- error
- active
- waiting

These should never dominate the interface.

Create proper light-theme support if the existing application supports it, but the dark theme is the primary visual benchmark.

--------------------------------------------------
3.2 Typography
--------------------------------------------------

Typography must create most of the hierarchy.

Use:

- strong bot names
- medium-weight secondary information
- subtle metadata
- comfortable body text
- restrained captions

Do not use bold everywhere.

Do not make every piece of metadata equally prominent.

A typical hierarchy should be:

    Screen title
        ↓
    Bot name / primary object
        ↓
    Current activity / latest message
        ↓
    Secondary metadata

Technical information should generally be visually subordinate.

--------------------------------------------------
3.3 Spacing
--------------------------------------------------

Use generous spacing.

Do not try to fit maximum information onto the screen.

Prioritize:

- breathing room
- alignment
- rhythm
- consistent vertical spacing

Lists should feel calm.

A user should be able to scan the screen without feeling like they are reading a database table.

--------------------------------------------------
3.4 Shapes
--------------------------------------------------

Use rounded surfaces and rounded interactive elements where appropriate.

Do NOT put everything inside a card.

A row can simply be:

    avatar + text + trailing action

with a subtle divider.

Cards should have semantic meaning, not exist merely because "Material Design has cards."

==================================================
4. BOT ROSTER / HOME SCREEN
==================================================

This is the MOST IMPORTANT screen.

Redesign the main screen around the user's bots.

The user should immediately see their AI coworkers/agents.

The primary visual structure should resemble:

    [App identity / header]

    GROUPS

    [Group]     [New group +]

    BOTS

    [Avatar]  Vega                         >
              Coding
              Latest activity...

    [Avatar]  Poppy                        >
              Research
              Latest activity...

    [Avatar]  Hazel                         >
              Personal
              Latest activity...

The exact implementation may differ, but the visual hierarchy should follow this philosophy.

--------------------------------------------------
4.1 Bot avatars
--------------------------------------------------

Bots need strong visual identity.

Every bot should have a distinctive avatar.

Avatar should support:

- color
- shape
- generated/selected visual identity
- active state
- thinking state
- working state
- waiting state
- blocked state
- done/idle state

Avatar state should be subtle.

Do NOT turn the entire row into a status dashboard.

The avatar itself can communicate state.

--------------------------------------------------
4.2 Bot row
--------------------------------------------------

Each bot row should prioritize:

1. avatar
2. bot name
3. role/category
4. latest useful activity/message
5. time
6. subtle state indicator

Avoid exposing:

- internal IDs
- provider IDs
- model IDs
- technical runtime information
- raw task IDs
- implementation details

unless explicitly requested.

--------------------------------------------------
4.3 Threads
--------------------------------------------------

Threads should remain available but subordinate to the bot.

A bot should feel like the persistent entity.

Conceptually:

    BOT
      ↓
    Threads
      ↓
    Conversation

not:

    Conversations
      ↓
    Find which bot owns this

Thread counts and previews should be subtle.

--------------------------------------------------
4.4 Groups
--------------------------------------------------

Groups should be lightweight.

Allow users to organize bots without creating a complicated folder hierarchy.

Example:

    GROUPS

    [Quill & Co.]    [+ New group]

Then:

    BOTS

    Vega
    Poppy
    Hazel

Do not create an enterprise-style sidebar tree.

==================================================
5. NAVIGATION
==================================================

Simplify navigation dramatically.

Audit every existing navigation destination.

For each item ask:

    "Does the user need to see this constantly?"

If not, move it deeper.

Primary navigation should expose only the most important user concepts.

Potential top-level concepts:

- Bots
- Threads / activity
- Projects
- possibly search

Everything else should be accessible contextually.

Do not expose:

- MCP
- connectors
- provider internals
- runtime controls
- computer infrastructure
- technical diagnostics

as primary navigation destinations.

These belong inside appropriate bot/project/settings contexts.

==================================================
6. BOT DETAIL
==================================================

Bot detail should feel like opening the profile/workspace of an AI coworker.

Header:

    [Avatar]

    Vega
    Coding

    Active / Working / Waiting

Then useful information and actions.

Possible sections:

    Current work
    Recent threads
    Projects
    Skills
    Tools
    Memory
    Routines

But these should not appear as a huge settings form.

Use clean sections and progressive disclosure.

A bot should feel like an entity with capabilities, not a JSON object with 40 configuration fields.

==================================================
7. CHAT EXPERIENCE
==================================================

Redesign the chat screen to match the same visual language.

The chat should be extremely clean.

Prioritize:

- conversation
- bot identity
- input
- meaningful activity
- artifacts/results

Avoid exposing internal orchestration.

Do NOT dump:

- internal tool calls
- raw JSON
- execution logs
- model internals
- unnecessary progress messages
- verbose system events

unless the user explicitly requests technical details.

--------------------------------------------------
7.1 Agent activity
--------------------------------------------------

The agent can communicate that it is:

- thinking
- working
- browsing
- coding
- waiting
- asking the user
- completed

But this should be presented as elegant, compact activity UI.

Do NOT fill the conversation with:

    "Starting tool..."
    "Calling MCP..."
    "Fetching..."
    "Parsing..."
    "Executing..."
    "Finished..."

The user does not need a live transcript of the plumbing.

Show meaningful activity, not implementation details.

==================================================
8. ASK USER EXPERIENCE
==================================================

The existing structured ask_user system must remain functional.

Redesign it visually so it feels native to the new UI.

Supported:

- single choice
- multiple choice
- free text
- other
- confirmation

When the bot genuinely needs a decision during a task, pause the task and present a clean structured question.

Example:

    Vega needs a decision

    Which database should I use?

    ○ PostgreSQL
    ○ SQLite
    ○ Supabase
    ○ Other

                    Continue

This should look like a polished conversational interaction, not a system dialog.

The task must visibly remain paused until the user responds.

==================================================
9. ERROR UX
==================================================

Completely redesign errors.

Current raw technical errors such as:

    401 Unauthorized
    model unavailable
    API error
    connection failed

must NOT be dumped directly into chat.

Create a unified actionable error component.

Example:

    Couldn't connect to OpenRouter

    The API key appears to be invalid.

    [Edit provider]
    [Save & Test]

    [Retry]

For model errors:

    Model unavailable

    This model isn't currently available for this provider.

    Provider: OpenRouter
    Model: ...

    [Change model]
    [Edit provider]
    [Retry]

Error presentation must be:

- prominent enough to notice
- readable
- calm
- actionable
- technically accurate
- never raw-red-text-on-the-bottom-of-the-screen

The user should be able to fix common configuration errors without hunting through Settings.

==================================================
10. NEW CHAT
==================================================

Redesign New Chat as a beautiful native flow.

It should allow the user to select:

- Bot
- provider
- model
- context/project where appropriate
- role/persona where appropriate
- other relevant configuration

BUT:

Only show providers/models that are actually usable.

Do not show a huge catalog of unavailable models.

Unavailable models/providers should not dominate the interface.

The flow should feel like:

    New conversation

    Who do you want to talk to?

    [Bot selection]

    Model

    [Available model]

    Context

    [Project / context]

    [Start chat]

Keep it simple.

==================================================
11. PROVIDERS
==================================================

Provider management must be redesigned visually.

Separate concepts cleanly:

- API providers
- authenticated account providers
- models
- authentication state

Do not expose implementation details such as CLI detection as the primary UX.

Provider cards should communicate:

    OpenRouter
    Connected

    Codex
    Signed in

    Qwen
    Not connected

etc.

Where authentication is supported, provide a clear:

    Sign in

or:

    Connect account

Where API keys are required:

    Add API key

Provider settings should allow editing:

- provider
- API key
- account authentication
- default model
- endpoint where appropriate

Use secure storage as already implemented.

Do not regress existing provider functionality.

==================================================
12. CONNECTORS
==================================================

Connectors should NOT live as a cluttered general Settings category.

They belong where the user naturally expects them.

The Threads page top-right action should become the Connectors entry as already specified.

Keep connector UX simple:

    Connectors

    GitHub
    Connected

    Google Drive
    Connected

    Slack
    Not connected

etc.

Connection, OAuth, permissions, and execution must remain functional.

Do not expose connector implementation details.

==================================================
13. COMPUTER / BROWSER
==================================================

The application already supports browser/computer infrastructure.

Do not remove it.

But remove desktop-style visual leftovers.

The UI should communicate:

    Computer
    Working

or:

    Computer
    Waiting for you

or:

    Computer
    Ready

If a live preview is actually available, show it elegantly.

If it is not available, do NOT show an infinite spinner or fake preview.

Use honest states.

Example:

    Computer

    No live preview available right now.

    [Take over]

if takeover is actually possible.

Never pretend something is live when it isn't.

==================================================
14. TERMINAL / CODING / FILES
==================================================

These capabilities remain.

They should appear contextually when useful.

For example, when a coding task is active:

    Vega
    Working on project

    ┌──────────────────────────┐
    │ Building project...      │
    │ 3 files changed          │
    │ Tests running            │
    └──────────────────────────┘

Do NOT turn the main UI into an IDE.

Artifacts, code, files, diffs, logs, and terminal output should use specialized views when opened.

==================================================
15. ARTIFACTS
==================================================

Artifacts should have a beautiful presentation.

Examples:

- code
- files
- PDFs
- generated documents
- project outputs
- reports
- images
- previews

Do not dump large artifact contents directly into chat.

Instead use compact artifact cards:

    Project report
    PDF · 14 pages

    [Open]

or:

    app/
    23 files

    [Open project]

==================================================
16. PDF / FILE UPLOAD
==================================================

File upload must remain permissionless through Android Storage Access Framework.

The UI should feel simple:

    +

    Camera / File / etc.

When a PDF is uploaded:

- show a compact attachment
- parse it in the background
- do NOT dump the PDF's raw extracted text into chat
- allow the model to semantically understand the document
- preserve page references where possible
- support multiple PDFs distinctly

Example:

    [PDF icon]
    Research Paper.pdf
    18 pages

Then the user can naturally ask:

    "What does this paper conclude?"

The response should reference the document naturally.

==================================================
17. SETTINGS
==================================================

Completely redesign Settings.

The current Settings screen should NOT be treated as sacred.

Group settings logically.

Example:

    Settings

    ACCOUNT
    Profile
    Appearance

    AI
    Providers
    Models
    Defaults

    AGENTS
    Bots
    Skills
    Routines

    CONNECTIONS
    Connectors

    DATA
    Memory
    Storage

    NOTIFICATIONS
    Notifications

    ABOUT
    About OpenMausBot

Do not show internal implementation concepts unless they are genuinely useful to users.

Remove unnecessary desktop/computer leftovers from Settings.

Do not expose development/debugging infrastructure in normal user settings.

Developer/debug tools can remain behind a developer/debug section if they are required.

==================================================
18. APPEARANCE
==================================================

Appearance settings must actually work.

Support:

- dark/light/system theme where applicable
- accent preferences if already supported
- bot avatar shape
- bot avatar color
- other supported personalization

Changes must persist across restart.

Avatar customization must visibly affect the UI.

Do not expose controls that don't actually work.

==================================================
19. SEARCH
==================================================

Search should be visually lightweight.

It should allow users to find:

- bots
- threads
- projects
- artifacts
- relevant history

Use a clean search surface rather than a huge filtering dashboard.

==================================================
20. NOTIFICATIONS
==================================================

Notifications should match the same philosophy.

The notification system should not spam the user with internal progress.

For a bot actively working:

DO NOT notify:

    "Tool call started"
    "Browser opened"
    "MCP request"
    "Step 4 complete"

Instead, notify only when something actually needs attention.

Examples:

    Vega needs your decision

    Hazel finished your report

    Poppy is blocked by an authentication issue

If the user is already viewing the relevant bot/chat, suppress unnecessary notifications.

==================================================
21. LOADING / EMPTY / OFFLINE STATES
==================================================

Every screen needs polished states.

Avoid generic:

    Loading...

    Error

    No data

Instead use context-specific states.

Startup:

    Initializing
       ↓
    Connecting
       ↓
    Connected

Do NOT show "offline" prematurely during normal startup.

Empty bot state:

    Your workspace is empty

    Create your first bot

Empty threads:

    No conversations yet

etc.

==================================================
22. ANIMATIONS
==================================================

Introduce subtle, high-quality motion.

Use animations for:

- navigation
- bot state changes
- expanding sections
- dialogs
- bottom sheets
- list insertion/removal
- loading states
- ask_user interactions
- task completion

Animations must be:

- short
- smooth
- purposeful

Do NOT animate everything.

No excessive bouncing, spinning, or decorative motion.

==================================================
23. ICONOGRAPHY
==================================================

Audit every icon.

Use one coherent icon system.

Icons should:

- have consistent stroke/weight
- have consistent size
- align properly
- have appropriate touch targets

Remove random icons that look like they came from different libraries.

The interface should feel like one product.

==================================================
24. BOTTOM ACTIONS
==================================================

Use floating actions sparingly.

The Grok-style principle should be:

    fewer controls
    larger touch targets
    clearer intent

Do not create five floating buttons because there are five possible operations.

Prioritize the most common action.

Secondary actions should appear contextually.

==================================================
25. ACCESSIBILITY
==================================================

The redesign must remain accessible.

Ensure:

- sufficient contrast
- minimum touch target sizes
- screen reader labels
- sensible content descriptions
- dynamic text sizing where possible
- no information conveyed only through color
- keyboard navigation where applicable

Do not sacrifice usability for aesthetics.

==================================================
26. RESPONSIVE ANDROID DESIGN
==================================================

The UI must work across:

- small phones
- large phones
- different aspect ratios
- portrait
- landscape where supported
- Android system font scaling

Do not hardcode screenshot-specific dimensions.

Use Compose responsive layout principles.

==================================================
27. IMPLEMENTATION REQUIREMENTS
==================================================

Technology remains:

- Kotlin
- Jetpack Compose
- existing Android architecture
- existing backend/server
- existing embedded runtime
- existing APIs
- existing storage
- existing security model

Do NOT rewrite working backend functionality merely to achieve visual changes.

Do NOT remove functionality because it is difficult to expose elegantly.

Refactor UI architecture where necessary.

Create reusable Compose components.

Prefer:

    AppTheme
    AppTypography
    AppSpacing
    AppShapes
    BotAvatar
    BotRow
    ThreadRow
    StatusIndicator
    ActivityCard
    ArtifactCard
    ErrorCard
    AskUserCard
    ProviderRow
    ConnectorRow
    EmptyState
    LoadingState
    BottomActionBar
    SectionHeader

etc.

Do not duplicate visual constants across screens.

==================================================
28. INFORMATION HIERARCHY AUDIT
==================================================

For EVERY existing screen, perform this audit:

1. What is the primary object?
2. What is the primary action?
3. What information does the user actually need?
4. What information is implementation detail?
5. What can be hidden until requested?
6. What can become contextual?
7. What can be removed entirely from the primary view?
8. What should become a reusable component?

Do not simply restyle existing layouts.

If the hierarchy is wrong, change the hierarchy.

==================================================
29. SCREEN-BY-SCREEN REDESIGN
==================================================

At minimum redesign:

- startup
- bot roster/home
- bot creation
- bot profile
- bot settings
- thread list
- chat
- new chat
- ask_user cards
- error dialogs
- provider management
- model selection
- authentication
- connectors
- connector details
- projects
- artifacts
- browser
- computer
- terminal
- files
- routines
- skills
- memory
- notifications
- search
- appearance
- general settings
- empty states
- loading states
- offline/error states

Every screen must belong to the same design system.

==================================================
30. WHAT MUST NOT CHANGE
==================================================

Unless absolutely required to support the UI:

DO NOT BREAK:

- bot runtime
- bot persistence
- chat persistence
- thread persistence
- memory
- MCP
- connectors
- OAuth
- provider authentication
- API providers
- model selection
- browser
- computer
- terminal
- filesystem
- coding
- long-running tasks
- routines
- skills
- approvals
- ask_user
- PDF parsing
- artifacts
- notifications
- background execution
- task pause/resume
- secure storage
- Android lifecycle behavior
- embedded server
- physical-device functionality

The redesign must be a UI/UX transformation, not a disguised rewrite of the product.

==================================================
31. TESTING REQUIREMENTS
==================================================

After redesigning each major area:

1. Compile Kotlin.
2. Run TypeScript checks.
3. Run existing Android tests.
4. Run existing server tests.
5. Build the APK.
6. Install on a real ARM64 Android device.
7. Test the redesigned UI physically.

Do not consider the redesign complete because screenshots look good in an emulator.

Physical device verification is mandatory.

Test:

- scrolling
- touch targets
- keyboard
- dialogs
- bottom sheets
- rotation
- Activity recreation
- background/foreground
- process restart
- persistence
- dark theme
- system font scaling
- long bot names
- long messages
- many bots
- many threads
- empty states
- errors
- slow network
- offline state
- ask_user
- provider errors
- connector flows
- PDF attachments
- computer state
- browser state

==================================================
32. VISUAL QA
==================================================

Perform a dedicated visual QA pass.

Compare the application against the provided Grok Bot screenshots for:

- visual density
- whitespace
- typography
- avatar prominence
- list hierarchy
- iconography
- surface treatment
- divider usage
- button prominence
- navigation complexity
- information density
- perceived polish

The question is NOT:

    "Does this technically resemble Grok?"

The question is:

    "Does this have the same level of visual restraint, polish,
     clarity, and intentionality?"

==================================================
33. NO FAKE POLISH
==================================================

Do not game the task by:

- changing only colors
- rounding every corner
- increasing font size
- adding gradients
- adding animations everywhere
- replacing icons
- changing one screen
- hiding functionality permanently
- removing technical features
- calling the result "Grok-inspired"

The entire application must feel coherent.

==================================================
34. DESIGN REVIEW CHECKPOINT
==================================================

Before declaring completion, inspect the entire application as a user.

Start from a clean installation.

Ask:

    "What is this app?"

Within 3 seconds the answer should be:

    "This is an app where I have AI bots I can work with."

NOT:

    "This is some complicated agent infrastructure."

Then ask:

    "Can I immediately find my bots?"

    "Can I tell which bots are active?"

    "Can I open a bot and understand what it is doing?"

    "Can I start a conversation?"

    "Can I see what needs my attention?"

    "Can I understand an error and fix it?"

    "Can I find my connectors?"

    "Can I configure providers without digging through technical settings?"

If the answer to these requires excessive navigation, redesign the relevant screen.

==================================================
35. FINAL DESIGN PRINCIPLE
==================================================

The application should feel like:

    AI coworkers in your pocket.

Not:

    An AI runtime exposed through an Android interface.

The underlying system can remain extremely sophisticated.

The UI should make that sophistication feel effortless.

Use the provided Grok Bot screenshots as the visual quality bar:

    simple
    beautiful
    calm
    recognizable
    personal
    spacious
    polished

The user should feel that they are interacting with persistent AI agents, not operating software infrastructure.

==================================================
36. DELIVERABLES
==================================================

At completion provide:

1. Summary of the new design system.
2. List of redesigned screens.
3. List of removed/hidden UI clutter.
4. Navigation architecture before vs after.
5. New reusable Compose components.
6. Any UI architecture refactoring.
7. Screenshots of major redesigned screens.
8. Physical ARM64 device verification results.
9. Kotlin/test/typecheck results.
10. Confirmation that existing functionality remains intact.
11. List of any known limitations or intentionally deferred visual work.

Do not claim completion if only the home screen has been redesigned.

This is a COMPLETE application-wide UI/UX redesign.
