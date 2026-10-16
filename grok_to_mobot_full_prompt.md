# MOBOT — FULL PRODUCT UI/UX REDESIGN
# GROK-INSPIRED VISUAL QUALITY, NATIVE MOBOT IDENTITY
# IMPLEMENTATION TASK — FROM AUDIT TO PHYSICAL DEVICE SIGN-OFF

You are working on MOBOT, the native Android agentic-computer platform described by the repository and master prompt.

This is an IMPLEMENTATION task.

Your job is to take the existing MOBOT Android application and perform a comprehensive UI/UX redesign using the previously completed Grok Android UI/UX research as design evidence.

The goal is NOT to turn MOBOT into Grok.
The goal is NOT to integrate Grok.
The goal is NOT to copy proprietary code, assets, branding, or internal implementation.

The goal is:

    Build a significantly more polished, coherent, professional, modern, calm, intentional, native Android UI for MOBOT by learning from the strongest visual and interaction decisions discovered during the Grok research.

This is a product-wide redesign, not a collection of isolated component tweaks.

Do not simply add a few rounded cards, change a few colors, or imitate screenshots.

Redesign the visual language and interaction hierarchy of the application from the first screen onward.

======================================================================
0. ABSOLUTE RULES
======================================================================

1. Do NOT modify backend/agent capabilities unless a UI change genuinely requires a small supporting interface/API change.

2. Do NOT remove existing agent capabilities.

3. Do NOT break existing tools, structured responses, notifications, browser, terminal, task orchestration, projects, artifacts, settings, bots, providers, conversations, credentials, or persistent data.

4. Do NOT replace working functionality with mocked UI.

5. Do NOT create fake functionality merely because it looks good.

6. Do NOT claim something is implemented unless it is actually implemented and tested.

7. Do NOT use Grok APIs.

8. Do NOT attempt to bypass Grok authentication, subscription restrictions, account protections, or service boundaries.

9. Do NOT copy proprietary Grok assets, source code, logos, fonts, artwork, or exact branded UI.

10. You may reproduce general design principles:
    - hierarchy
    - spacing
    - composition
    - interaction patterns
    - information density
    - animation principles
    - card behavior
    - navigation patterns
    - visual calmness
    - responsive behavior
    - status communication
    - interaction affordances

11. Preserve MOBOT's own identity.

12. The result must still visibly and conceptually be MOBOT.

13. Do not blindly implement every recommendation from the research reports.
    Evaluate each recommendation against MOBOT's architecture and product goals.

14. Prefer native Android/Jetpack Compose solutions where appropriate.

15. Do not create unnecessary abstractions simply to make the code appear sophisticated.

16. Avoid a giant monolithic Settings screen.

17. Avoid excessive visual decoration.

18. Avoid excessive rounded rectangles where they do not communicate grouping.

19. Avoid gradient-heavy "AI startup" aesthetics.

20. Avoid UI that looks like a generic web dashboard transplanted into Android.

21. Avoid tiny text.

22. Avoid clutter.

23. Avoid excessive icons without labels or context.

24. Avoid unnecessary animations that slow interaction.

25. Preserve accessibility.

26. Preserve light and dark themes.

27. Test on the actual Samsung SM-A075F / Android 16 physical device.

28. The physical device is the final authority for visual and interaction verification.

29. Never declare the redesign complete solely because unit tests pass.

30. Do not stop after implementing the first visually successful screen.
    The entire product must be reviewed.

======================================================================
1. START BY READING EVERYTHING RELEVANT
======================================================================

Before changing code, perform a repository and research audit.

Read the full relevant content of:

1. The MOBOT master prompt / authoritative product specification.

2. The completed Grok Android research report.

3. The deep Grok UI/UX forensic analysis.

4. The Grok design-token research, if present.

5. The Grok screen inventory, if present.

6. The Grok/MOBOT UX gap analysis, if present.

7. The Grok UX recommendations, if present.

Expected research files may include:

    research/grok_android_apk_analysis.md
    research/grok_ui_ux_forensic_analysis.md
    research/grok_design_tokens.md
    research/grok_screen_inventory.md
    research/grok_mobot_ux_gap_analysis.md
    research/grok_ux_recommendations.md

Also inspect existing MOBOT UI implementation.

Do not assume those filenames exist.
Search the repository and locate the actual files.

Then identify:

- Compose architecture
- navigation architecture
- theme system
- colors
- typography
- spacing
- reusable components
- screens
- dialogs
- bottom sheets
- navigation drawer
- top bars
- chat UI
- composer
- bot selection
- home/landing UI
- settings
- provider UI
- model UI
- browser UI
- terminal UI
- task/project UI
- artifact UI
- structured-response UI
- error UI
- loading UI
- notification UI
- onboarding UI
- empty states
- permission/approval UI
- tool execution UI
- progress UI

Trace where every major visual surface is rendered.

Do not begin implementation until you understand the existing UI architecture sufficiently to avoid blindly creating duplicate systems.

======================================================================
2. CREATE A PRE-IMPLEMENTATION UI AUDIT
======================================================================

Before modifying UI code, create an internal inventory.

For every significant screen/surface, record:

- current screen name
- navigation path
- purpose
- composable/class responsible
- existing components used
- theme dependency
- state sources
- important actions
- empty state
- loading state
- error state
- success state
- accessibility concerns
- current visual problems
- target visual direction
- whether redesign is required
- whether behavior must remain unchanged

Include at minimum:

A. App launch
B. Landing/home
C. Bot list
D. Bot creation
E. Bot conversation list
F. Chat screen
G. Message bubbles/rows
H. Tool execution
I. Thinking state
J. Error state
K. Composer
L. Attachments
M. Mentions
N. Bot switching
O. Navigation
P. Settings
Q. Providers
R. Models
S. Connected Apps
T. Notifications
U. Skills
V. Browser
W. Terminal
X. Artifacts
Y. Structured responses
Z. Projects
AA. Tasks
AB. Approvals
AC. Authentication boundaries
AD. Empty states
AE. Loading states
AF. Confirmation dialogs
AG. Permission requests
AH. Success/completion surfaces
AI. Error recovery
AJ. Long-running tasks
AK. Generated app/project surfaces
AL. File/document previews
AM. PDF/document intelligence surfaces
AN. Any other surface discovered in the repository

Do not limit yourself to this list.

======================================================================
3. ESTABLISH THE TARGET PRODUCT FEEL
======================================================================

The target design should feel:

- professional
- calm
- intelligent
- technically capable
- deliberate
- modern
- native
- lightweight
- premium without being flashy
- dense enough for power users
- simple enough for normal use

The interface should communicate:

    "This is a serious computer-control/agent platform."

It should NOT communicate:

    "This is a toy chatbot."

It should NOT communicate:

    "This is a generic admin dashboard."

It should NOT communicate:

    "This is a copy of another AI application."

The visual hierarchy must make the product's capabilities feel powerful without making the interface visually noisy.

======================================================================
4. DEFINE A COMPLETE MOBOT DESIGN SYSTEM
======================================================================

Before redesigning individual screens, define the visual system.

Do not improvise colors independently on every screen.

Create a centralized design system.

Define:

--------------------------------------------------
4.1 COLOR SYSTEM
--------------------------------------------------

Define semantic color roles, not arbitrary screen-specific colors.

At minimum:

- background
- elevated background
- primary surface
- secondary surface
- tertiary surface
- primary text
- secondary text
- muted text
- disabled text
- border
- subtle border
- divider
- primary action
- secondary action
- destructive
- warning
- success
- info
- selected state
- pressed state
- focused state
- hover state where applicable
- tool state
- thinking state
- processing state
- waiting state
- approval-required state
- failed state
- completed state

Support:

- light theme
- dark theme

Do not simply invert colors between themes.

Ensure both themes feel intentionally designed.

Use contrast that satisfies accessibility requirements.

Do not use color as the sole indication of state.

--------------------------------------------------
4.2 TYPOGRAPHY
--------------------------------------------------

Establish a clear type scale.

Define:

- display
- headline
- title
- section title
- body
- body emphasized
- secondary
- caption
- label
- button text
- code
- terminal output
- metadata

Control:

- font size
- weight
- line height
- letter spacing
- maximum line width
- truncation
- wrapping

Avoid microscopic labels.

Use typography to establish hierarchy before adding decorative components.

--------------------------------------------------
4.3 SPACING
--------------------------------------------------

Create a consistent spacing system.

Define reusable values for:

- screen padding
- section spacing
- card padding
- row height
- message spacing
- composer spacing
- modal padding
- toolbar spacing
- chip spacing
- icon-to-text spacing
- title/subtitle spacing
- paragraph spacing

Do not have every screen invent its own padding numbers.

--------------------------------------------------
4.4 SHAPES
--------------------------------------------------

Define a deliberate shape language.

Decide:

- corner radii
- card radii
- button radii
- text field radii
- chip radii
- dialog radii
- bottom-sheet shape
- image/media treatment

Do not make every element a pill.

Pills should communicate actions, filters, tags, or compact selectable states.

--------------------------------------------------
4.5 ELEVATION
--------------------------------------------------

Define when elevation is appropriate.

Use elevation to communicate:

- hierarchy
- overlay
- temporary surface
- modal surface
- floating control
- focused content

Avoid putting shadows on everything.

Flat surfaces are preferable where hierarchy does not require elevation.

--------------------------------------------------
4.6 ICONOGRAPHY
--------------------------------------------------

Establish:

- icon size
- stroke weight
- alignment
- active state
- inactive state
- semantic meaning
- spacing

Do not mix incompatible icon styles.

Avoid icons without obvious purpose.

--------------------------------------------------
4.7 MOTION
--------------------------------------------------

Define motion principles.

Use animation for:

- state changes
- hierarchy changes
- surface transitions
- content appearance
- expanding/collapsing tool cards
- loading
- progress
- navigation

Animations should be:

- quick
- purposeful
- interruptible
- subtle
- consistent

Do not animate everything.

Do not introduce animations that make the application feel slow.

Respect reduced-motion accessibility where practical.

======================================================================
5. REDESIGN THE LANDING / HOME EXPERIENCE
======================================================================

The landing/home screen gets special attention.

This is the first impression.

Study the existing MOBOT landing screen carefully.

Then redesign it from first principles.

The home screen should answer almost immediately:

- What is MOBOT?
- What can I do?
- Which bot am I using?
- How do I start?
- What is currently active?
- What important work is in progress?

The home screen should not become a dashboard full of panels.

Prefer strong hierarchy.

Consider:

- MOBOT identity
- bot identity
- concise contextual greeting or status
- primary action
- recent conversations
- active tasks
- important running work
- quick actions
- capabilities where useful
- empty state when nothing exists

Do not keep unnecessary decorative marketing copy inside a productivity application.

Do not restore the old "Good afternoon" style if it does not contribute useful information.

Do not add an unnecessary "New Bot" button if the product already has an obvious + action.

The + interaction should have a clear visual location and semantics.

"MOBOT" should have strong, intentional product identity.

Do not confuse brand identity with a giant title consuming most of the screen.

======================================================================
6. REDESIGN APP NAVIGATION
======================================================================

Review navigation architecture.

The user should not have to hunt through menus to find important functions.

Audit:

- bottom navigation
- drawer
- top app bar
- overflow menus
- back behavior
- contextual navigation
- nested navigation
- settings categories
- connected apps
- projects
- tasks
- browser
- terminal

Remove stale, redundant, or confusing navigation entries.

The Applications section should not remain in the hamburger menu if it is obsolete according to the current product direction.

Review whether Vercel and Render sign-ins belong under Connected Apps.

Do not move functionality merely for aesthetic reasons.
Preserve semantic discoverability.

Navigation must communicate a clear information architecture.

======================================================================
7. REDESIGN THE CHAT EXPERIENCE
======================================================================

This is one of the highest-priority areas.

Do not treat the chat as a generic messaging application.

MOBOT is an agentic computer interface.

The chat should clearly distinguish:

- user request
- agent reasoning/thinking state
- tool activity
- intermediate observations
- progress
- approvals
- generated artifacts
- errors
- final answer
- background task status
- recoverable failures
- completed actions

Do not expose private chain-of-thought.

Show only appropriate user-facing status and activity information.

--------------------------------------------------
7.1 MESSAGE HIERARCHY
--------------------------------------------------

Redesign message presentation.

Consider:

- message grouping
- spacing
- sender differentiation
- timestamps
- metadata
- tool activity
- status
- expandable details
- attachments
- artifacts
- action controls

Avoid enormous speech bubbles.

Avoid making every message look like a separate card.

The conversation should feel like one coherent workspace.

--------------------------------------------------
7.2 SWIPEABLE MESSAGE/ROW INTERACTIONS
--------------------------------------------------

Use the research where appropriate.

Evaluate swipe actions for:

- copy
- retry
- delete
- share
- inspect
- context actions

Do not add swipe actions merely because Grok has them.

Only add actions that are useful in MOBOT.

Make swipe affordances discoverable without becoming annoying.

--------------------------------------------------
7.3 THINKING STATE
--------------------------------------------------

Create a refined thinking/progress presentation.

Differentiate:

- preparing
- executing
- waiting
- recovering
- awaiting approval
- completed

Do not fake streamed progress.

Do not pretend the model is thinking when it is not.

Do not expose chain-of-thought.

Use concise user-facing status.

The UI should communicate:

    "The agent is actively doing something."

rather than:

    "The interface is frozen."

--------------------------------------------------
7.4 TOOL EXECUTION CARDS
--------------------------------------------------

This is a major design opportunity.

Tool execution should feel like part of the conversation instead of raw debugging output.

Cards should communicate:

- tool name / human-friendly action
- current status
- concise action description
- important result
- duration where useful
- exit status where relevant
- expandable output
- retry/recovery where appropriate

For terminal commands specifically, investigate a compact presentation inspired by the research:

    command
    status
    exit code
    duration
    concise output preview
    expand

Do not dump huge terminal logs into the main conversation.

Long output should be collapsible or available in a dedicated viewer.

--------------------------------------------------
7.5 ERROR PRESENTATION
--------------------------------------------------

Errors must stop looking like tiny red strings.

Every important failure should answer:

1. What happened?
2. What does it mean?
3. Did MOBOT recover automatically?
4. What can the user do?
5. Is action required?

Examples:

    Failed
    Preview process stopped unexpectedly.

    MOBOT restarted it automatically.

    [View details] [Open preview]

Or:

    Authentication required
    Vercel is not connected.

    [Connect Vercel]

Do not expose internal exception noise by default.

Provide technical details behind expansion.

Avoid vague:

    "Something went wrong."

unless absolutely unavoidable.

--------------------------------------------------
7.6 RECOVERY UI
--------------------------------------------------

When MOBOT detects a recoverable failure:

- show the issue
- communicate recovery
- show current state
- avoid duplicating multiple error messages
- allow inspection
- avoid making the user panic

Example conceptual state:

    Recovering
    The task failed at the network step.
    MOBOT is retrying with an adjusted request.

Then:

    Recovered
    The task resumed successfully.

Only show truthful states.

======================================================================
8. REDESIGN THE COMPOSER
======================================================================

The composer is one of the most important controls in the entire application.

It should feel effortless.

Audit:

- text input
- send
- attachments
- files
- image input
- microphone if supported
- tool/action invocation
- bot selection
- model selection
- mentions
- context
- task controls
- cancel/stop
- queued work

Consider:

- strong visual hierarchy
- comfortable typing area
- clear send action
- attachment affordance
- contextual tools
- current bot identity
- current model where useful
- disabled state
- processing state
- stop/cancel state

Avoid turning the composer into a toolbar containing 19 tiny icons.

Controls should appear according to context.

======================================================================
9. MENTIONS AND BOT IDENTITY
======================================================================

Study and improve bot identity.

Bots should feel distinct without requiring huge avatars.

Consider:

- subtle avatar
- color identity
- name
- model/provider information where relevant
- current state

Composer drafts should remain correctly isolated per conversation/bot where the existing architecture supports it.

Mentions should be understandable.

Do not turn the interface into a social-media imitation.

======================================================================
10. BROWSER UI REDESIGN
======================================================================

Browser is a major MOBOT capability.

Treat it as a first-class computer interface.

Study the existing browser implementation and the Grok research.

Do NOT copy Grok's proprietary implementation.

Implement useful interaction principles where compatible with MOBOT.

Review:

- browser surface
- page area
- navigation controls
- address/URL display
- loading state
- page failure
- interaction state
- click feedback
- scroll behavior
- touch behavior
- trackpad behavior
- cursor
- selection
- back
- reload
- open externally
- return to agent

--------------------------------------------------
10.1 VIRTUAL TRACKPAD
--------------------------------------------------

Evaluate whether MOBOT's browser benefits from a virtual trackpad control.

Possible behavior:

- relative pointer movement
- tap
- drag
- scroll
- two-finger scroll
- edge auto-pan
- cursor visibility
- touch feedback

Do not add it if the existing architecture already provides something better.

It must feel natural on a phone.

The trackpad must not permanently cover important page content.

The user should understand whether they are:

- directly touching page content
- controlling a virtual cursor
- scrolling
- dragging

Make interaction mode visually obvious.

--------------------------------------------------
10.2 BROWSER STATES
--------------------------------------------------

Design:

- loading
- connected
- interacting
- blocked
- navigation error
- network error
- authentication-required
- page crash
- browser unavailable
- agent-controlled browser
- user-controlled browser

These are distinct states.

Do not collapse everything into a spinner.

======================================================================
11. TERMINAL UI REDESIGN
======================================================================

Terminal must look powerful without looking like a raw developer console pasted onto the app.

Design:

- compact command cards
- output preview
- status
- exit code
- runtime
- process state
- expand
- full-screen terminal
- copy
- save
- retry where valid
- stop
- background process state
- logs

Use a compact card presentation for routine commands.

Use a dedicated terminal surface for large output.

Show persistent process state clearly:

    Running
    Healthy
    Stopped
    Failed
    Recovering

Avoid giant blocks of monospace text in the main chat.

Output should remain inspectable and copyable.

======================================================================
12. TASKS AND LONG-RUNNING WORK
======================================================================

MOBOT now has durable orchestration and long-running task infrastructure.

The UI must represent this correctly.

Design states:

- Created
- Planning
- Running
- Waiting
- Recovering
- Awaiting approval
- Paused
- Cancelled
- Completed
- Failed

Users should be able to understand:

- what MOBOT is doing
- current step
- overall progress
- whether the task needs them
- whether it is running in the background
- whether it completed
- whether it failed
- whether it recovered

Avoid fake percentage progress.

Only show percentage when it has semantic meaning.

Prefer milestone/progress descriptions when exact percentage is unknown.

======================================================================
13. APPROVALS AND USER CONTROL
======================================================================

Approval requests should be visually clear and impossible to confuse with ordinary informational cards.

They should explain:

- what action is requested
- why approval is needed
- what will happen
- relevant scope
- available choices

Use:

    [Approve]
    [Reject]

where appropriate.

For destructive/high-impact actions, provide sufficient context.

Do not create confirmation dialogs for trivial actions.

======================================================================
14. ARTIFACTS
======================================================================

Artifacts are first-class output.

Improve their presentation.

Support visual distinction between:

- document
- image
- code
- dataset
- archive
- generated app
- report
- PDF
- file
- directory/project

Artifact cards should show useful metadata.

Consider:

- name
- type
- size
- created/updated
- verification status
- preview where possible
- open
- share
- save
- copy path

Do not reduce every artifact to:

    [Download]

MOBOT is a computer workspace.

======================================================================
15. STRUCTURED RESPONSES
======================================================================

MOBOT already has a native structured-response system.

Do not replace it.

Improve its presentation.

Review renderers for:

- tables
- charts
- timelines
- Kanban
- checklists
- comparisons
- matrices
- dashboards
- diagrams
- calendars
- Gantt
- forms
- code
- files
- diffs
- logs
- tests
- artifacts
- media

The semantic architecture must remain separated from presentation.

The model supplies semantic data/intent.

MOBOT owns:

- rendering
- interaction
- validation
- persistence
- accessibility
- visual consistency

All structured responses should use the same design language.

A table should look like it belongs to the application.

A chart should look like it belongs to the application.

A Kanban board should look like it belongs to the application.

Do not let each renderer invent its own visual language.

======================================================================
16. SETTINGS REDESIGN
======================================================================

Settings must be redesigned carefully.

Avoid a massive monolithic screen.

Group logically.

Potential categories:

- General
- Appearance
- Bots
- Providers
- Models
- Connected Apps
- Notifications
- Skills
- Browser
- Terminal
- Tasks
- Files/Storage
- Privacy/Safety
- Advanced
- About

Do not mechanically use these categories if the actual product architecture suggests better organization.

Settings should use:

- clear section hierarchy
- concise descriptions
- correct controls
- current state
- navigation into details
- sensible defaults

Connected Apps should be the natural home for integrations such as Vercel/Render where appropriate.

Do not expose implementation details that ordinary users do not need.

======================================================================
17. PROVIDERS AND MODELS
======================================================================

Provider/model configuration should feel professional and trustworthy.

Show:

- provider
- connection state
- model
- capabilities
- configuration
- errors
- authentication state

Do not show false capability badges.

Do not show unsupported models.

Do not imply credentials are secure using language that is not technically justified.

Preserve all existing provider data.

======================================================================
18. NOTIFICATIONS
======================================================================

Review notification-related UI.

Notifications should feel coherent with the in-app design system.

Review:

- task completion
- task failure
- recovery
- approval
- background work
- message notifications

Notification-related UI should avoid spam.

Preserve the existing notification backend behavior.

This task is primarily a visual/interaction redesign.

======================================================================
19. EMPTY STATES
======================================================================

Every major surface should have a meaningful empty state.

Examples:

- no conversations
- no bots
- no tasks
- no artifacts
- no connected apps
- no projects
- no browser session
- no terminal session

Do not use meaningless:

    "Nothing here yet."

unless paired with useful context.

Explain:

- what this section is
- why it is empty
- what the user can do

Keep empty states compact.

======================================================================
20. LOADING STATES
======================================================================

Replace random spinners with meaningful loading states.

Use appropriate:

- skeletons
- progress indicators
- shimmer only where useful
- status text
- incremental rendering
- partial content

Do not show a spinner indefinitely.

Differentiate:

- waiting for network
- agent execution
- tool execution
- rendering
- data loading
- process startup

======================================================================
21. ANIMATION AND MICRO-INTERACTION PASS
======================================================================

After static layout is correct, perform a dedicated motion pass.

Review:

- screen navigation
- message appearance
- tool cards
- expand/collapse
- loading
- task state
- success
- errors
- browser transitions
- terminal transitions
- drawers
- dialogs
- bottom sheets

Animation should make state changes easier to understand.

Do not use animation to hide poor layout.

Avoid excessive bouncing, glowing, pulsing, or flashy AI aesthetics.

======================================================================
22. AUDIO / HAPTICS
======================================================================

The research identified multi-sensory feedback.

Do not prioritize this above the visual foundation.

Only implement audio/haptics where they provide a meaningful interaction benefit.

Good candidates may include:

- important completion
- approval request
- critical user-attention state

Avoid making every message or tool execution produce noise.

Respect Android settings and user preferences.

Do not make this a P0 unless the existing architecture makes it trivial and the visual system is already complete.

======================================================================
23. RESPONSIVENESS
======================================================================

Test the redesigned interface across realistic Android conditions.

At minimum:

- Samsung SM-A075F
- current physical portrait configuration
- different text lengths
- long bot names
- long model names
- long file names
- long URLs
- large tool output
- large tables
- long messages
- empty states
- keyboard open
- keyboard closed
- orientation behavior if supported

Do not allow content to become clipped.

Do not assume short English strings.

======================================================================
24. ACCESSIBILITY
======================================================================

Perform a complete accessibility pass.

Check:

- touch target sizes
- content descriptions
- semantic labels
- focus behavior
- contrast
- dynamic text
- screen reader behavior
- state announcements
- logical navigation
- disabled states
- error announcements
- keyboard behavior where applicable

Do not sacrifice accessibility for visual minimalism.

A beautiful invisible button is still a bad button.

======================================================================
25. PERFORMANCE
======================================================================

UI redesign must not introduce performance regressions.

Watch for:

- excessive recomposition
- expensive animations
- huge lists
- unnecessary image decoding
- expensive markdown rendering
- large terminal output rendering
- expensive blur effects
- overdraw
- memory leaks
- unnecessary recomputation

Particular attention should be paid to:

- chat transcript rendering
- streaming content
- markdown
- structured responses
- browser
- terminal
- artifact previews

Do not use heavy visual effects merely because they look impressive in a static screenshot.

======================================================================
26. IMPLEMENTATION ARCHITECTURE
======================================================================

Use centralized reusable primitives.

Examples:

- MobotScaffold
- MobotTopBar
- MobotSection
- MobotCard
- MobotStatus
- MobotPrimaryAction
- MobotSecondaryAction
- MobotChip
- MobotIconButton
- MobotDivider
- MobotMessage
- MobotToolCard
- MobotErrorCard
- MobotProgressCard
- MobotArtifactCard
- MobotTaskCard
- MobotApprovalCard
- MobotEmptyState
- MobotLoadingState

Do not blindly use these names.
Use the repository's architecture where appropriate.

The important requirement is a shared visual system.

Do not duplicate slightly different versions of the same component across the app.

======================================================================
27. MIGRATE EXISTING SURFACES
======================================================================

After creating the design system, migrate the existing screens into it.

Do this systematically.

Do not leave half the application using the old style.

A complete redesign should not produce:

    modern home
    old chat
    old settings
    old browser
    old terminal
    random new cards

The application must look like one product.

Prioritize:

P0:
- overall shell
- landing/home
- navigation
- chat
- composer
- tool execution
- error/recovery UX
- typography
- colors
- spacing
- dark/light themes

P1:
- browser
- trackpad
- terminal
- tasks
- artifacts
- settings
- connected apps
- structured responses

P2:
- swipe interactions
- bot identity
- mentions
- draft isolation presentation
- deeper micro-interactions

P3:
- optional audio/haptic refinements
- low-priority decorative polish

Reorder these priorities if the repository evidence shows a more logical dependency order.

======================================================================
28. DO NOT BREAK PRODUCT IDENTITY
======================================================================

Remove stale OpenMausBot branding where it should no longer be user-visible.

The application user-facing identity should be MOBOT.

However:

Do NOT rename internal package names, namespaces, compatibility identifiers, database identifiers, migration keys, or server identifiers unless there is a real requirement.

Internal compatibility identifiers may remain unchanged.

User-visible text should consistently use MOBOT.

Audit:

- titles
- splash screen
- landing screen
- menus
- dialogs
- error text
- notifications
- settings
- about pages
- generated preview UI where relevant
- empty states
- onboarding
- system prompts where user-facing identity leaks occur

======================================================================
29. DO NOT LET THE AGENT FAKE UI CAPABILITIES
======================================================================

Every button must have a real action.

Every status must correspond to real state.

Every progress indicator must correspond to real progress.

Every "connected" state must come from actual connection state.

Every "running" state must correspond to a real process/task state.

Every "complete" state must be empirically established where the backend supports verification.

The UI is part of the trust model.

Never make the UI look more capable than the underlying system actually is.

======================================================================
30. TEST THE ACTUAL IMPLEMENTATION
======================================================================

After implementation:

1. Run formatting/static checks.

2. Run Android unit tests.

3. Run Core tests.

4. Run relevant server tests if UI changes touch shared protocols.

5. Run relevant structured-response tests.

6. Run navigation/UI tests where available.

7. Build the application.

8. Install onto the physical Samsung SM-A075F.

9. Start the application.

10. Test every major navigation route manually.

11. Test both light and dark themes.

12. Test keyboard behavior.

13. Test chat.

14. Test tool execution.

15. Test error states.

16. Test recovery.

17. Test artifacts.

18. Test browser.

19. Test terminal.

20. Test structured responses.

21. Test long-running task UI.

22. Test approvals.

23. Test settings.

24. Test connected apps.

25. Test notifications.

26. Test empty states.

27. Test loading states.

28. Test scrolling.

29. Test back navigation.

30. Test returning to the app after backgrounding.

======================================================================
31. PHYSICAL DEVICE VISUAL QA
======================================================================

This is mandatory.

Use the actual Samsung SM-A075F running Android 16.

Do not rely solely on emulator or screenshot mocks.

For each major surface capture evidence.

At minimum capture:

1. Launch/home
2. Bot selection
3. Conversation list
4. Chat
5. Tool card
6. Thinking state
7. Error state
8. Recovery state
9. Composer
10. Artifact card
11. Structured response
12. Browser
13. Virtual trackpad if implemented
14. Terminal
15. Task progress
16. Approval
17. Settings
18. Connected Apps
19. Light theme
20. Dark theme

Review screenshots as a product designer would.

Look for:

- cramped spacing
- awkward padding
- inconsistent alignment
- oversized text
- tiny text
- visual noise
- accidental borders
- inconsistent radii
- excessive cards
- poor empty states
- broken hierarchy
- awkward keyboard interaction
- clipped content
- confusing controls
- accidental scroll containers
- strange icon alignment
- excessive whitespace
- insufficient whitespace
- ugly transitions
- inconsistent dark theme
- accidental old branding

Fix actual problems found.

Do not mark screenshots as "pass" simply because the screen renders.

======================================================================
32. HUMAN-LIKE UX WALKTHROUGHS
======================================================================

Perform realistic end-to-end walkthroughs.

Scenario A:
New user opens MOBOT.

Observe:

- first impression
- understanding
- first action
- navigation
- bot selection
- first conversation

Scenario B:
User asks MOBOT to perform a multi-step task.

Observe:

- request
- planning
- tool activity
- progress
- output
- completion

Scenario C:
A tool fails.

Observe:

- error visibility
- explanation
- recovery
- user trust
- final state

Scenario D:
MOBOT needs approval.

Observe:

- explanation
- decision
- confirmation
- continuation

Scenario E:
User launches a browser task.

Observe:

- entering browser
- page interaction
- touch
- trackpad
- feedback
- completion

Scenario F:
User runs a terminal command.

Observe:

- command card
- output
- process state
- expansion
- terminal view

Scenario G:
Long-running task.

Observe:

- backgrounding
- returning later
- state visibility
- completion
- notification

Scenario H:
User changes settings.

Observe:

- discoverability
- clarity
- navigation
- control
- feedback

Do not just test whether buttons work.

Evaluate whether the experience makes sense.

======================================================================
33. REGRESSION PROTECTION
======================================================================

Before accepting the redesign, verify that these remain intact:

- existing bots
- conversations
- threads
- messages
- providers
- models
- credentials
- skills
- task history
- project data
- workspaces
- artifacts
- notification behavior
- browser functionality
- terminal functionality
- tool execution
- structured responses
- long-running tasks
- approval flow
- persistence

Never reset or wipe user data to simplify UI testing.

If a migration is required, make it safe and reversible.

======================================================================
34. TEST FAILURE CASES
======================================================================

Intentionally exercise UI states caused by real failures.

Examples:

- network failure
- tool failure
- process crash
- preview unavailable
- authentication missing
- invalid artifact
- task recovery
- task cancellation
- browser failure
- terminal failure
- malformed structured response
- unavailable provider

The UI must communicate these states truthfully.

======================================================================
35. VISUAL CONSISTENCY AUDIT
======================================================================

After implementation, perform a dedicated consistency pass.

Check every screen for:

- same typography scale
- same spacing
- same corner logic
- same button hierarchy
- same status logic
- same colors
- same icon sizing
- same card treatment
- same error language
- same loading language
- same transition principles

The application should appear to have been designed by one product team.

Not by twelve developers who met once in a hallway.

======================================================================
36. FINAL RESEARCH COMPARISON
======================================================================

Only after implementation, compare the result with the Grok research.

For each major design principle, classify:

    Adopted
    Adapted
    Rejected
    Not applicable

Explain why.

Do not ask:

    "Does this look exactly like Grok?"

Ask:

    "Did we learn the underlying design principle?"

Examples:

Grok research:
    compact tool presentation

MOBOT:
    compact tool cards with MOBOT-specific data and interaction

Grok research:
    virtual trackpad browser interaction

MOBOT:
    native browser control optimized for MOBOT's local computer-agent architecture

Grok research:
    strong visual hierarchy

MOBOT:
    unified typography/spacing/color system

This is the correct form of reuse.

======================================================================
37. FINAL UI QUALITY BAR
======================================================================

Do not stop at:

    "It works."

Do not stop at:

    "The tests pass."

Do not stop at:

    "The screenshot looks okay."

The result should satisfy all three:

A. FUNCTIONAL CORRECTNESS
    The UI performs the underlying real action.

B. VISUAL QUALITY
    The UI looks coherent, professional, intentional, and polished.

C. INTERACTION QUALITY
    The user can understand what is happening and what to do next.

All three are required.

======================================================================
38. REQUIRED DELIVERABLES
======================================================================

Create or update a final implementation report:

    research/mobot_grok_inspired_ui_implementation_report.md

Include:

1. Executive summary

2. Initial UI audit

3. Existing architecture used

4. Design system created

5. Color system

6. Typography system

7. Spacing system

8. Shape/elevation system

9. Navigation redesign

10. Home/landing redesign

11. Chat redesign

12. Composer redesign

13. Tool card redesign

14. Error/recovery redesign

15. Browser redesign

16. Trackpad redesign

17. Terminal redesign

18. Task/long-running-work redesign

19. Artifact redesign

20. Structured response redesign

21. Settings redesign

22. Connected Apps redesign

23. Accessibility work

24. Animation/motion work

25. Performance considerations

26. Physical-device test results

27. Light-theme test results

28. Dark-theme test results

29. Regression results

30. Known limitations

31. Remaining visual issues

32. Comparison with Grok research

33. Evidence/screenshots

34. Exact test counts

35. Exact build/install result

36. Final acceptance status

Do not write "all tests passed" without exact counts.

Do not claim a visual area passed unless it was actually inspected.

======================================================================
39. FINAL ACCEPTANCE CHECKLIST
======================================================================

Before declaring completion, verify:

[ ] MOBOT identity is consistent
[ ] No stale user-visible OpenMausBot branding remains where it should not
[ ] Home screen redesigned
[ ] Navigation redesigned
[ ] Chat redesigned
[ ] Composer redesigned
[ ] Tool cards redesigned
[ ] Error UI redesigned
[ ] Recovery UI redesigned
[ ] Loading UI redesigned
[ ] Empty states redesigned
[ ] Browser redesigned
[ ] Trackpad evaluated/implemented where justified
[ ] Terminal redesigned
[ ] Tasks redesigned
[ ] Approvals redesigned
[ ] Artifacts redesigned
[ ] Structured responses integrated visually
[ ] Settings reorganized
[ ] Connected Apps integrated appropriately
[ ] Providers/models visually consistent
[ ] Notifications considered
[ ] Dark theme polished
[ ] Light theme polished
[ ] Accessibility checked
[ ] Long text checked
[ ] Long output checked
[ ] Keyboard checked
[ ] Back navigation checked
[ ] Physical Samsung tested
[ ] Real functionality preserved
[ ] Existing data preserved
[ ] No fake UI states
[ ] No fake capability claims
[ ] No Grok integration added
[ ] No auth/subscription bypass attempted
[ ] No proprietary Grok assets/code copied
[ ] Tests executed
[ ] Build executed
[ ] APK installed
[ ] Major screens physically inspected
[ ] Final report written

======================================================================
40. IMPORTANT IMPLEMENTATION ORDER
======================================================================

Follow this order.

PHASE 0
Read the master prompt and Grok research.

PHASE 1
Audit the existing MOBOT UI architecture.

PHASE 2
Create the global design system.

PHASE 3
Redesign application shell and navigation.

PHASE 4
Redesign home/landing.

PHASE 5
Redesign chat and composer.

PHASE 6
Redesign tool execution, status, error, recovery, and approval surfaces.

PHASE 7
Redesign browser and terminal.

PHASE 8
Redesign tasks, artifacts, structured responses, and project-related UI.

PHASE 9
Redesign settings, providers, models, and Connected Apps.

PHASE 10
Perform light/dark theme pass.

PHASE 11
Perform accessibility pass.

PHASE 12
Perform animation/micro-interaction pass.

PHASE 13
Perform performance pass.

PHASE 14
Build and install on physical Samsung.

PHASE 15
Conduct screen-by-screen visual QA.

PHASE 16
Conduct realistic end-to-end UX scenarios.

PHASE 17
Fix issues discovered during physical QA.

PHASE 18
Run full regression tests.

PHASE 19
Perform final visual consistency audit.

PHASE 20
Write the final implementation report.

Do not skip earlier phases because a later screen looks more interesting.

======================================================================
41. HOW TO HANDLE DISCOVERED PROBLEMS
======================================================================

Whenever you discover a problem, classify it as one of:

1. visual design problem
2. interaction design problem
3. navigation problem
4. missing reusable component
5. state-model problem
6. rendering problem
7. performance problem
8. accessibility problem
9. underlying capability problem
10. persistence/data problem
11. integration problem
12. unrelated pre-existing defect

Fix only what is necessary for this task.

Do not silently expand scope into unrelated architecture changes.

If a true underlying capability defect prevents correct UI behavior, document it and fix it only when the fix is directly necessary for truthful UI behavior.

======================================================================
42. WHEN TO STOP
======================================================================

Do not stop because one screen looks excellent.

Do not stop because the home screen is beautiful.

Do not stop because the Grok comparison looks impressive.

Stop only when:

- the global design system is coherent
- all major product surfaces use it
- core interactions remain functional
- the physical device has been tested
- important failure states were tested
- light/dark themes were inspected
- regression tests pass or known failures are explicitly documented
- no major visual inconsistencies remain
- final evidence/report exists

======================================================================
43. FINAL REPORT FORMAT
======================================================================

At the end, report exactly:

A. What was changed
B. Why it was changed
C. What research evidence informed it
D. What was deliberately not copied
E. What remained unchanged
F. Tests executed
G. Exact test counts
H. Physical-device validation
I. Screens inspected
J. Failures discovered
K. Failures fixed
L. Known remaining issues
M. Data/persistence verification
N. Build/install verification
O. Final acceptance verdict

Use evidence.

Do not use vague language such as:

    "Everything looks good."

Instead provide concrete statements such as:

    "Chat screen, tool cards, browser, terminal, settings, and artifact surfaces were physically inspected on the Samsung SM-A075F."

======================================================================
44. MOST IMPORTANT PRODUCT PRINCIPLE
======================================================================

Do not build "Grok for Android."

Build:

    MOBOT, after learning what a highly polished agentic computer interface can feel like.

Grok is the research subject.

MOBOT is the product.

The final interface should feel native to MOBOT's capabilities:

    agent
    computer
    browser
    terminal
    files
    artifacts
    tasks
    tools
    structured responses
    long-running work
    local device control

Make those capabilities feel like parts of one coherent product.

The strongest result is not the one with the most visual similarity to Grok.

The strongest result is the one where a user immediately thinks:

    "This feels like a serious native computer agent."

======================================================================
45. START NOW
======================================================================

Begin by:

1. reading the master prompt
2. locating and reading all Grok research artifacts
3. auditing MOBOT's existing UI architecture
4. creating the screen inventory
5. identifying the existing design system
6. identifying inconsistencies
7. producing an implementation plan
8. then implementing the redesign in dependency order

Do not modify anything until the audit is sufficiently complete.

Do not rush.

Do not stop at a superficial pass.

Do not replace working functionality with mockups.

Do not fabricate results.

Use the research.
Use the existing architecture.
Use the physical Samsung.
Verify everything.
Then deliver the complete MOBOT UI/UX redesign.
