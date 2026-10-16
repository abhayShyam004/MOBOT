# MOBOT — P0 UI/UX REDESIGN
# PRODUCT SHELL + VISUAL FOUNDATION + HOME + NAVIGATION + CHAT + COMPOSER
# IMPLEMENTATION TASK

You are beginning P0 of MOBOT's product-wide UI/UX redesign.

This is NOT the entire redesign.

Do NOT work on P1/P2/P3 surfaces yet.

Your entire focus for this task is:

    1. Global visual design system
    2. Application shell
    3. Home / landing experience
    4. Primary navigation
    5. Chat experience
    6. Composer
    7. Tool/activity presentation
    8. Error/recovery presentation
    9. Loading/empty states
    10. Light/dark visual consistency
    11. Physical-device visual QA

The purpose of P0 is to establish the visual and interaction foundation that the rest of MOBOT can later inherit.

Do not rush into implementation.

First understand the current application.

Then design the foundation.

Then implement it systematically.

Then physically inspect it.

Then fix what is actually wrong.

======================================================================
0. ABSOLUTE SCOPE BOUNDARY
======================================================================

THIS TASK IS P0 ONLY.

Do NOT redesign:

- browser
- virtual trackpad
- terminal
- projects
- artifacts
- structured response renderers
- advanced settings architecture
- providers
- model configuration
- Connected Apps
- Vercel
- Render
- skills
- notification backend
- long-running task architecture
- backend agent architecture
- execution engine
- process manager
- app builder
- PDF/document UI
- advanced file-management UI

UNLESS a tiny supporting change is absolutely required for P0 to function correctly.

Do not opportunistically "clean up" unrelated areas.

Do not turn this into an architecture refactor.

Do not change backend behavior merely because you noticed something interesting.

This task is about the core product interface.

======================================================================
1. READ THE RESEARCH FIRST
======================================================================

Before touching code, read the relevant MOBOT product specification and the completed Grok UI/UX research.

Locate the actual files in the repository.

At minimum, search for:

- MOBOT master prompt
- Grok Android APK research
- Grok UI/UX forensic analysis
- Grok design-token research
- Grok screen inventory
- Grok/MOBOT UX gap analysis
- Grok UX recommendations

Potential filenames include:

    research/grok_android_apk_analysis.md
    research/grok_ui_ux_forensic_analysis.md
    research/grok_design_tokens.md
    research/grok_screen_inventory.md
    research/grok_mobot_ux_gap_analysis.md
    research/grok_ux_recommendations.md

Do not assume those exact names.

Search the repository.

Read the relevant material rather than relying on filenames or summaries.

Important:

The Grok research is RESEARCH INPUT.

It is not a specification saying "copy this."

Use it to understand:

- hierarchy
- spacing
- typography
- composition
- calmness
- interaction density
- visual rhythm
- status communication
- tool presentation
- chat organization
- composer design
- onboarding/landing composition
- navigation choices
- interaction feedback

Do not copy:

- proprietary assets
- logos
- branded artwork
- source code
- exact branding
- proprietary implementation
- Grok identity

MOBOT must remain MOBOT.

======================================================================
2. UNDERSTAND THE EXISTING MOBOT UI BEFORE CHANGING IT
======================================================================

Inspect the current Android UI architecture.

Find:

- root activity
- navigation host
- top-level scaffold
- theme
- typography
- color definitions
- spacing definitions
- reusable components
- home screen
- bot screen
- conversation list
- conversation screen
- composer
- message renderer
- tool renderer
- error renderer
- loading states
- dialogs
- bottom sheets
- navigation drawer
- top app bars

Determine:

- which components are already reusable
- which screens are duplicated
- which values are hardcoded
- which styles are inconsistent
- which screens share theme tokens
- which areas use one-off styling
- where the visual system currently breaks down

Do not start replacing components until you understand how they are connected.

======================================================================
3. CREATE A P0 UI AUDIT
======================================================================

Before implementation, create an internal audit of these surfaces:

1. application launch
2. home/landing
3. bot list
4. conversation list
5. chat
6. composer
7. tool activity
8. thinking state
9. loading
10. errors
11. recovery
12. empty states
13. navigation
14. dialogs
15. bottom sheets

For each, identify:

- current layout
- current colors
- typography
- spacing
- shape
- elevation
- interaction hierarchy
- major visual problems
- major UX problems
- existing components
- intended P0 target

Do not rewrite the application yet.

======================================================================
4. DEFINE THE P0 DESIGN LANGUAGE
======================================================================

Create a centralized MOBOT visual foundation.

Do NOT scatter colors, typography, radii, and spacing throughout individual composables.

The following must become deliberate reusable tokens.

--------------------------------------------------
4.1 COLORS
--------------------------------------------------

Define semantic colors.

At minimum:

Background
Surface
SurfaceVariant
ElevatedSurface
PrimaryText
SecondaryText
TertiaryText
DisabledText
Border
SubtleBorder
Divider
PrimaryAction
PrimaryActionContent
SecondaryAction
Destructive
Warning
Success
Info
Selected
Pressed
Focused
Disabled
Thinking
Running
Waiting
Recovering
Error
Complete

Do not let individual screens invent their own versions.

Light and dark themes must both be intentionally designed.

Do not make dark theme by merely taking light theme and mechanically inverting values.

The two themes should feel like the same product.

Check contrast.

Do not use color alone to communicate state.

--------------------------------------------------
4.2 TYPOGRAPHY
--------------------------------------------------

Establish a clear typography hierarchy.

At minimum define:

- screen title
- large heading
- section heading
- body
- body emphasized
- secondary
- metadata
- caption
- button
- label
- monospace/code

The most important rule:

Typography must establish hierarchy before decoration does.

Avoid:

- giant titles everywhere
- tiny grey labels
- excessive bolding
- too many font sizes
- arbitrary weights

Long messages must remain readable.

--------------------------------------------------
4.3 SPACING
--------------------------------------------------

Create a coherent spacing system.

Define reusable dimensions for:

- screen horizontal padding
- screen vertical padding
- section spacing
- card padding
- row spacing
- message spacing
- composer spacing
- icon/text gap
- title/subtitle gap
- control gap
- modal spacing

Do not allow:

    Home = 24dp
    Chat = 19dp
    Settings = 17dp
    Error card = 13dp
    Random developer = 21dp because it looked right at 2:14 AM

Use a consistent system.

--------------------------------------------------
4.4 SHAPE LANGUAGE
--------------------------------------------------

Define:

- standard card radius
- compact card radius
- input radius
- button radius
- chip radius
- dialog radius
- bottom sheet radius

Do not use rounded corners everywhere.

A shape should communicate hierarchy.

Pills are for compact controls/tags/selection states where appropriate.

Not every container needs to be a pill.

--------------------------------------------------
4.5 ELEVATION
--------------------------------------------------

Define when a surface should visually separate from another surface.

Use elevation for:

- overlays
- temporary surfaces
- dialogs
- floating actions
- important hierarchy changes

Do not add shadows to everything.

The app should feel calm, not like every component is floating independently in space.

--------------------------------------------------
4.6 ICONOGRAPHY
--------------------------------------------------

Standardize:

- icon size
- icon alignment
- icon/text spacing
- selected state
- disabled state
- emphasis

Do not mix unrelated icon styles.

======================================================================
5. DEFINE MOBOT'S VISUAL HIERARCHY
======================================================================

Before implementing screens, answer this through actual design:

What is visually most important?

Priority should generally be:

1. current task/conversation
2. primary action
3. active state
4. agent/tool activity
5. supporting information
6. secondary controls
7. metadata

Do not let:

- timestamps
- decorative labels
- borders
- icons
- status chips
- secondary actions

compete with the main content.

The interface should be visually quiet until something important happens.

======================================================================
6. REDESIGN THE APPLICATION SHELL
======================================================================

The shell is the frame surrounding the product.

Inspect:

- top bar
- navigation
- drawer
- content container
- floating controls
- background
- transitions

The shell must make MOBOT feel like one application.

Not:

    screen A uses one visual language
    screen B uses another
    settings looks like Android 2019
    chat looks like a web app
    home looks like an AI landing page

Everything must share the same design language.

--------------------------------------------------
6.1 MOBOT IDENTITY
--------------------------------------------------

The user-facing identity should be MOBOT.

Audit visible text for stale OpenMausBot identity.

Change only USER-FACING identity.

Do NOT casually rename:

- packages
- namespaces
- internal identifiers
- database identifiers
- migration identifiers
- compatibility identifiers

unless genuinely required.

Search all P0 surfaces for stale branding.

Check:

- launch
- home
- navigation
- chat
- settings entry points
- dialogs
- empty states
- errors
- notifications
- about/identity surfaces

======================================================================
7. REDESIGN THE HOME / LANDING SCREEN
======================================================================

This is the highest-priority screen.

Treat it as the product's front door.

Do not simply make the existing screen prettier.

Re-evaluate its hierarchy.

The user should understand quickly:

- this is MOBOT
- what bot/context is active
- what they can do now
- where their recent work is
- what important work is ongoing

The screen should not become a dashboard full of boxes.

Aim for:

- strong identity
- clear primary action
- clean hierarchy
- useful recent content
- active work when relevant
- calm empty state

Avoid unnecessary marketing copy.

Avoid pointless decorative elements.

Do not restore a generic greeting such as:

    "Good afternoon"

unless it communicates something genuinely useful.

The home screen should not need to shout to establish personality.

--------------------------------------------------
7.1 HOME LAYOUT
--------------------------------------------------

Determine the appropriate structure after inspecting the existing app.

Potential hierarchy:

TOP:
MOBOT identity / contextual header

PRIMARY:
main action / conversation entry

SECONDARY:
recent work / active conversations

OPTIONAL:
running task / meaningful status

Do not blindly implement this exact structure.

Use actual product requirements and research.

--------------------------------------------------
7.2 HOME EMPTY STATE
--------------------------------------------------

When there is no history:

Explain the product through action, not marketing.

The user should know what to do next.

Possible conceptual structure:

    MOBOT

    Your local computer agent.

    [Start a task]

But do not copy this wording blindly.

Use the actual product identity and capabilities.

--------------------------------------------------
7.3 HOME EXISTING-DATA STATE
--------------------------------------------------

When the user has conversations/bots/tasks:

Do not let empty-state messaging dominate.

Existing work should become the primary content.

Make recent work easy to scan.

Use:

- name
- context
- useful metadata
- active status where meaningful

Avoid unnecessary cards.

======================================================================
8. REDESIGN PRIMARY NAVIGATION
======================================================================

Review all top-level navigation.

Determine what genuinely belongs at the top level.

The navigation should make major destinations discoverable without becoming a dumping ground.

Audit:

- home
- bots
- conversations
- tasks
- settings
- other current top-level destinations

Remove obsolete entries from the visible user experience where appropriate.

Important existing direction:

Do not keep obsolete "Applications" navigation simply because it already exists.

Do not move things randomly.

Navigation changes must have a coherent information architecture.

--------------------------------------------------
8.1 NAVIGATION STATES
--------------------------------------------------

Design:

- active
- inactive
- pressed
- disabled
- badge/attention state
- back behavior

Selected navigation must be visually obvious without aggressive color or giant containers.

--------------------------------------------------
8.2 DRAWER / SHEET
--------------------------------------------------

If a drawer exists, inspect it carefully.

It should not feel like a junk drawer.

Group items logically.

Keep secondary destinations secondary.

Do not put every feature in the main navigation.

======================================================================
9. REDESIGN THE CHAT SCREEN
======================================================================

This is the second major P0 surface.

MOBOT chat is not merely a messaging screen.

It is the user's primary interface with an agent that can perform computer actions.

The chat must clearly distinguish:

- user's request
- assistant response
- current activity
- tool execution
- waiting
- recovery
- approval
- completion
- error

Do not expose private chain-of-thought.

Do expose meaningful user-facing execution state.

======================================================================
10. CHAT VISUAL STRUCTURE
======================================================================

Review:

- top bar
- conversation title
- bot identity
- message grouping
- spacing
- scrolling
- tool activity
- composer
- contextual controls

The main conversation should dominate the screen.

Do not allow metadata to become visually louder than content.

--------------------------------------------------
10.1 USER MESSAGES
--------------------------------------------------

Design user messages to be:

- easy to locate
- visually distinct
- compact enough for long conversations
- readable for long messages

Avoid giant bubbles consuming unnecessary width.

--------------------------------------------------
10.2 AGENT MESSAGES
--------------------------------------------------

Agent messages should feel like native content rather than giant chat balloons.

Consider:

- grouping
- readable line length
- markdown hierarchy
- contextual metadata
- actions where useful

Avoid creating a separate card for every sentence.

--------------------------------------------------
10.3 MESSAGE GROUPING
--------------------------------------------------

Consecutive messages from the same source should feel grouped.

Do not visually repeat:

avatar
name
timestamp
separator

for every single message if it is unnecessary.

The transcript should have rhythm.

======================================================================
11. THINKING / ACTIVE EXECUTION STATE
======================================================================

MOBOT must look active when it is actually active.

Do not fake intelligence with decorative pulsating dots.

Create an honest state system.

Examples:

Planning
Executing
Waiting
Recovering
Awaiting approval
Completing

The UI should answer:

    Is MOBOT doing something?

without exposing internal chain-of-thought.

--------------------------------------------------
11.1 THINKING PRESENTATION
--------------------------------------------------

Design subtle but clear activity.

Possible elements:

- status text
- animated indicator
- active tool indicator
- elapsed time where useful
- current action

Avoid:

- fake reasoning text
- fabricated progress
- excessive animation
- huge loading cards

======================================================================
12. TOOL EXECUTION PRESENTATION
======================================================================

This is a P0 feature because MOBOT's central differentiator is that it actually does things.

Tool activity must feel integrated into the conversation.

Do not dump internal raw logs by default.

Create a consistent tool/activity component.

At minimum support:

- action name
- concise description
- state
- result summary
- expandable details

Possible states:

Pending
Running
Completed
Failed
Recovering

Use visual hierarchy.

Example conceptual structure:

    RUN TERMINAL COMMAND
    Installing dependencies

    Running · 3.2s

    [Show output]

or:

    CREATE FILE
    expenses/report.md

    Completed

Do not force this exact wording.

Use the actual tool data available.

======================================================================
13. TOOL CARD COLLAPSE / EXPANSION
======================================================================

The default conversation should remain readable.

Tool output can be large.

Therefore:

Collapsed:
- action
- state
- important result

Expanded:
- relevant technical details
- output
- arguments where appropriate
- errors
- timing

Never hide essential information merely for visual beauty.

Never expose sensitive information unnecessarily.

======================================================================
14. ERROR UX
======================================================================

Redesign errors completely within P0.

An error should not appear as:

    Error: blah blah blah...

in tiny red text at the bottom of the screen.

Every meaningful error should communicate:

1. WHAT happened
2. CURRENT state
3. WHETHER MOBOT recovered
4. WHAT the user can do

Example conceptual design:

    Couldn't start the task

    The selected provider is unavailable.

    MOBOT has not started execution.

    [Change provider]
    [View details]

Or:

    Preview stopped

    MOBOT detected that the process exited unexpectedly.

    Restarted successfully.

    [Open preview]
    [View details]

Do not say "restarted successfully" unless it actually did.

======================================================================
15. ERROR SEVERITY
======================================================================

Not every failure needs the same visual treatment.

Define levels such as:

Informational
Warning
Recoverable error
Blocking error
Critical user-action-required state

Use visual hierarchy.

Avoid making every problem bright red.

Users should be able to distinguish:

- normal status
- something needs attention
- something failed badly

======================================================================
16. RECOVERY STATE
======================================================================

Because MOBOT already has real orchestration/recovery behavior, the UI must represent it accurately.

When recovery is happening:

    Recovering
    MOBOT is retrying the failed step.

When recovered:

    Recovered
    The task resumed.

When recovery fails:

    Recovery failed
    The task could not continue automatically.

Do not show all intermediate internal attempts.

Do not spam the conversation with five nearly identical failure messages.

The interface should compress machine complexity into understandable user-facing state.

======================================================================
17. LOADING STATES
======================================================================

Review all P0 loading states.

Avoid endless generic spinners.

Differentiate:

- loading data
- waiting for model
- running tool
- starting process
- recovering

Use:

- skeletons where useful
- compact progress indicators
- meaningful status labels
- incremental rendering

Do not create fake progress percentages.

======================================================================
18. EMPTY STATES
======================================================================

Redesign empty states across P0.

At minimum:

- no bots
- no conversations
- empty home
- empty chat where relevant

Each should answer:

- what is this?
- why is it empty?
- what should I do?

Keep them visually quiet.

Do not make empty states huge marketing posters.

======================================================================
19. COMPOSER REDESIGN
======================================================================

The composer is one of the most important P0 surfaces.

Treat it as a core product control, not a text box at the bottom.

It must balance:

- typing
- sending
- attachments
- contextual actions
- current bot
- current state
- cancellation/stop
- keyboard behavior

--------------------------------------------------
19.1 COMPOSER STRUCTURE
--------------------------------------------------

Inspect the existing composer architecture.

Decide:

- input placement
- send button
- attachment control
- bot/model context
- optional action buttons
- processing state

Do not create a toolbar containing every possible MOBOT capability.

Contextual controls should remain understandable.

--------------------------------------------------
19.2 COMPOSER STATES
--------------------------------------------------

Design at minimum:

Idle
Typing
Disabled
Sending
Executing
Error
Stop available

Do not show the same Send button when the correct action is actually Stop.

--------------------------------------------------
19.3 KEYBOARD
--------------------------------------------------

Physically test:

- keyboard opening
- composer resize
- scrolling
- send action
- multiline text
- long messages
- keyboard dismissal

There must not be:

- clipped composer
- hidden send button
- content jumping unexpectedly
- broken inset handling

======================================================================
20. BOT IDENTITY IN CHAT
======================================================================

The active bot should be identifiable without consuming excessive space.

Consider:

- small avatar
- name
- state
- model/provider information only where useful

Do not put a giant bot header above every conversation.

Identity should be available, not intrusive.

======================================================================
21. TOP BAR
======================================================================

Redesign the top bar carefully.

It should communicate only the most relevant context.

Possible information:

- back
- conversation name
- bot identity
- task state
- context action

Do not cram every action into the top bar.

Secondary actions belong elsewhere.

======================================================================
22. TRANSITIONS
======================================================================

P0 includes basic shell/chat motion.

Implement only meaningful transitions.

Good candidates:

- home ↔ chat
- drawer open/close
- dialog
- tool expansion
- error appearance
- recovery state
- composer state

Do not create:

- excessive zoom
- bouncing elements
- unnecessary parallax
- decorative motion everywhere

Motion should make the app feel coherent, not animated.

======================================================================
23. LIGHT THEME
======================================================================

Do a dedicated light-theme design pass.

Check:

- contrast
- hierarchy
- surface separation
- text readability
- border visibility
- disabled states
- primary action
- error states
- tool cards
- composer

Do not just use white backgrounds everywhere.

The hierarchy should remain visible.

======================================================================
24. DARK THEME
======================================================================

Do a dedicated dark-theme design pass.

Important:

Do not simply invert the light palette.

Check:

- background depth
- elevated surfaces
- borders
- text brightness
- primary action
- selection
- error states
- tool cards
- composer

Avoid:

- pure black everywhere
- glowing colors
- excessive contrast
- grey text that becomes unreadable

The dark theme should feel intentional and calm.

======================================================================
25. ACCESSIBILITY
======================================================================

P0 must be accessibility-safe.

Check:

- touch targets
- content descriptions
- contrast
- dynamic text
- text clipping
- semantics
- button labels
- state communication

Do not make important actions dependent only on color.

Do not create tiny icon-only actions without accessible descriptions.

======================================================================
26. PERFORMANCE
======================================================================

Do not introduce expensive visual effects.

Pay special attention to:

- chat transcript
- streaming text
- markdown
- message recomposition
- animations
- tool cards
- lazy lists

No unnecessary blur.

No massive background images.

No expensive animation loops that run continuously.

======================================================================
27. REUSABLE COMPONENT STRATEGY
======================================================================

As you implement P0, identify components that should become shared primitives.

The actual names are up to the existing architecture.

Examples:

- MobotAppScaffold
- MobotTopBar
- MobotNavigation
- MobotSurface
- MobotCard
- MobotButton
- MobotIconButton
- MobotStatus
- MobotMessage
- MobotToolCard
- MobotErrorCard
- MobotProgressIndicator
- MobotEmptyState
- MobotComposer

Do not create components merely for the sake of component count.

A shared component should exist because it establishes consistent behavior or styling.

======================================================================
28. DO NOT REDESIGN P1 SURFACES YET
======================================================================

When you encounter browser, terminal, artifacts, structured responses, settings, providers, etc.:

DO NOT embark on their redesign.

You may ensure the global theme primitives are compatible with them.

You may update them only enough to avoid visual breakage from the new theme.

But their dedicated redesign belongs to later phases.

This prevents P0 from exploding into the entire product.

======================================================================
29. PHYSICAL DEVICE VALIDATION
======================================================================

After implementation, install the application on:

Samsung SM-A075F
Android 16 / API 36

This physical device is mandatory.

Do not rely only on emulator screenshots.

Test:

--------------------------------------------------
HOME
--------------------------------------------------

Launch app.

Check:

- first impression
- hierarchy
- MOBOT identity
- primary action
- recent content
- empty state
- navigation

--------------------------------------------------
NAVIGATION
--------------------------------------------------

Check:

- open navigation
- switch sections
- back
- selected states
- drawer/sheet
- transitions

--------------------------------------------------
CHAT
--------------------------------------------------

Check:

- opening conversation
- long conversation
- user messages
- assistant messages
- tool cards
- scrolling
- active state
- errors
- recovery
- loading

--------------------------------------------------
COMPOSER
--------------------------------------------------

Check:

- typing
- multiline
- send
- disabled
- executing
- stop
- keyboard
- attachments if currently part of the composer

--------------------------------------------------
THEMES
--------------------------------------------------

Test:

- light
- dark
- switching theme if supported

Check visually, not just functionally.

======================================================================
30. SCREENSHOT-BASED VISUAL REVIEW
======================================================================

Capture screenshots from the physical device.

At minimum:

1. Home empty
2. Home populated
3. Navigation
4. Chat idle
5. Chat with long messages
6. Tool executing
7. Tool completed
8. Tool failed
9. Recovery state
10. Composer idle
11. Composer typing
12. Loading
13. Error
14. Light theme
15. Dark theme

Inspect them critically.

Ask:

- Is the hierarchy immediately obvious?
- Is anything too large?
- Is anything too small?
- Is there unnecessary whitespace?
- Is the UI too dense?
- Are cards overused?
- Are borders too visible?
- Are icons aligned?
- Are states clear?
- Is the composer comfortable?
- Is the navigation obvious?
- Does the screen feel calm?
- Does it feel like one product?

Do not mark a screen passing merely because no component is technically broken.

======================================================================
31. REAL UX WALKTHROUGHS
======================================================================

Perform these complete flows.

FLOW 1:
New user opens MOBOT.

Record whether the user can understand the product and start a conversation.

FLOW 2:
User asks MOBOT to perform a multi-step task.

Observe:

request → active state → tool activity → result

FLOW 3:
A tool fails and recovery occurs.

Observe:

failure → explanation → recovery → final state

FLOW 4:
User sends a long message.

Observe:

composer → keyboard → send → transcript

FLOW 5:
User returns to an existing conversation.

Observe:

navigation → conversation → state restoration

FLOW 6:
User changes theme.

Observe:

visual consistency across home/chat/composer/navigation

Do not judge only technical correctness.

Judge clarity.

======================================================================
32. DATA SAFETY
======================================================================

Do not delete or reset existing data.

Before and after implementation verify that existing:

- bots
- conversations
- messages
- providers
- settings
- credentials/configuration
- tasks

remain intact.

UI redesign must not mutate persistent user state accidentally.

======================================================================
33. TESTING
======================================================================

Run all directly relevant tests.

At minimum:

- Android unit tests
- relevant Compose/UI tests if present
- Core tests if affected
- structured response tests only if touched
- relevant server/shared tests only if shared contracts were touched

Do not run tests just to produce a number.

Use them to verify actual regression safety.

Report exact counts.

Never write:

    "Tests passed."

without stating what was actually run.

======================================================================
34. BUILD AND INSTALL
======================================================================

Build the actual APK.

Install on the physical Samsung.

Launch it.

Verify it is the newly built version.

Do not confuse an old installed APK with the newly built artifact.

======================================================================
35. VISUAL QA FIX LOOP
======================================================================

The workflow is:

AUDIT
    ↓
DESIGN SYSTEM
    ↓
IMPLEMENT
    ↓
BUILD
    ↓
INSTALL
    ↓
PHYSICAL INSPECTION
    ↓
SCREENSHOT REVIEW
    ↓
IDENTIFY PROBLEMS
    ↓
FIX
    ↓
REBUILD
    ↓
REINSTALL
    ↓
RETEST

Do not stop after the first installation.

Expect the first physical pass to reveal issues.

======================================================================
36. WHAT COUNTS AS A P0 FAILURE
======================================================================

P0 is not complete if any of these remain:

- inconsistent major typography
- inconsistent colors
- inconsistent spacing
- broken dark theme
- broken light theme
- confusing navigation
- cluttered home
- weak home hierarchy
- confusing chat hierarchy
- ugly or oversized message presentation
- tool output dominating the conversation
- unclear thinking state
- unclear error state
- unclear recovery state
- poor composer UX
- broken keyboard behavior
- misleading status
- stale user-visible branding
- obvious visual inconsistency between major screens
- accessibility failure in primary actions
- regression of existing conversation/bot data

Do not hide these in the final report.

======================================================================
37. ACCEPTANCE CRITERIA
======================================================================

P0 is accepted only when:

1. A centralized MOBOT visual system exists.

2. Home uses that visual system.

3. Navigation uses that visual system.

4. Chat uses that visual system.

5. Composer uses that visual system.

6. Tool activity uses that visual system.

7. Errors use that visual system.

8. Loading states use that visual system.

9. Empty states use that visual system.

10. Light theme is deliberately designed.

11. Dark theme is deliberately designed.

12. MOBOT user-facing identity is consistent.

13. Primary navigation is coherent.

14. Chat hierarchy is clear.

15. Tool activity is understandable without exposing raw technical noise.

16. Error/recovery states are truthful and actionable.

17. Composer is comfortable on the physical device.

18. Major P0 screens have been physically inspected.

19. Existing product functionality still works.

20. Existing user data remains intact.

21. Relevant automated tests pass.

22. Build succeeds.

23. APK installs and launches on the physical Samsung.

24. No significant P0 visual defects remain.

======================================================================
38. REQUIRED FINAL REPORT
======================================================================

Create:

    research/mobot_p0_ui_ux_implementation.md

Include:

1. P0 objective
2. Initial UI audit
3. Existing architecture used
4. Global design system
5. Color system
6. Typography system
7. Spacing system
8. Shape system
9. Elevation system
10. Home redesign
11. Navigation redesign
12. Chat redesign
13. Tool activity redesign
14. Thinking/activity state redesign
15. Error redesign
16. Recovery redesign
17. Loading/empty state redesign
18. Composer redesign
19. Light theme
20. Dark theme
21. Accessibility
22. Performance considerations
23. Physical-device validation
24. UX walkthrough results
25. Data preservation validation
26. Tests run with exact counts
27. Build/install verification
28. Screenshots/evidence
29. Remaining P0 issues
30. Explicit statement of what was NOT changed because it belongs to P1+

Do not call the redesign "complete" if significant P0 problems remain.

======================================================================
39. FINAL REPORT MUST DISTINGUISH
======================================================================

For each major change classify the source:

    Existing MOBOT requirement
    Grok research observation
    Design adaptation
    New MOBOT design decision

This is important.

Do not claim:

    "Grok does X, therefore MOBOT must do X."

Instead explain why the idea is useful for MOBOT.

======================================================================
40. FINAL PRODUCT TEST
======================================================================

Before declaring P0 complete, open the application as a user.

Do not inspect the source code.

Simply use it.

Start from the first screen.

Ask:

    Does this immediately feel like one coherent product?

    Does the home screen clearly communicate what MOBOT is?

    Can I start working immediately?

    Is navigation obvious?

    Does chat feel like an agentic workspace rather than a generic chatbot?

    Can I tell when MOBOT is working?

    Can I tell what tool it is using?

    Can I understand failure?

    Can I understand recovery?

    Is the composer effortless?

    Does the UI remain calm when the agent becomes busy?

    Does the interface still feel good with lots of information?

    Does dark mode feel deliberately designed?

    Does light mode feel deliberately designed?

    Does the application feel professional without becoming visually sterile?

    Does anything look like it belongs to a different application?

Fix the most important problems found.

======================================================================
41. DO NOT OVERDESIGN
======================================================================

A polished interface is not an interface with more things.

Do not add:

- unnecessary cards
- unnecessary gradients
- unnecessary animations
- unnecessary badges
- unnecessary icons
- unnecessary labels
- unnecessary shadows
- unnecessary navigation
- unnecessary decorative illustrations

Prefer:

- hierarchy
- spacing
- typography
- clarity
- consistency
- feedback
- restraint

The goal is not visual spectacle.

The goal is confidence.

======================================================================
42. FINAL DIRECTIVE
======================================================================

P0 is the foundation of the entire later redesign.

Treat it as a real product-design and implementation task.

Do not attempt the entire roadmap.

Do not touch P1 just because P0 becomes inconvenient.

Do not rush.

Do not make speculative architecture changes.

Do not fake UI state.

Do not copy Grok.

Learn from the research.

Make MOBOT itself better.

Start with the audit.

Then build the design system.

Then implement:

    SHELL
    HOME
    NAVIGATION
    CHAT
    TOOL ACTIVITY
    ERROR/RECOVERY
    LOADING/EMPTY
    COMPOSER

Then test everything on the physical Samsung.

Then fix the problems you actually observe.

Then produce the final report.

Do not declare success until P0 has been physically inspected and the result genuinely feels like one coherent MOBOT product.
