# MOBOT — Grok-Inspired UI/UX Modernization Roadmap & Engineering Specifications

**Date:** 2026-10-13  
**Target Platform:** Native Android (Kotlin + Jetpack Compose + Material 3)  
**Goal:** Elevate MOBOT's perceived visual and tactile polish to world-class standards while preserving 100% on-device sovereignty.

---

## 1. Prioritized UX Modernization Roadmap

```
ROADMAP OVERVIEW
├── P0 [IMMEDIATE GAME-CHANGERS — HIGHEST USER-FACING IMPACT]
│   ├── P0.1: Compact Terminal & Tool Activity Fold Cards
│   ├── P0.2: Ambient Acoustic State Cues (Micro-Sound Design)
│   └── P0.3: Landing & Empty State Composition Overhaul
│
├── P1 [SIGNIFICANT SYSTEMIC ENHANCEMENTS]
│   ├── P1.1: Virtual Trackpad Overlay for Browser Tools
│   ├── P1.2: Swipeable Message Rows (Transcript Action Trays)
│   ├── P1.3: Multi-Tier Reasoning Toggle in Composer
│   └── P1.4: Per-Bot Composer Draft Isolation & @Bot Mentions
│
├── P2 [USEFUL REFINEMENTS & POLISH]
│   ├── P2.1: Procedural Geometric Identity & Animated Avatars
│   ├── P2.2: Dynamic Parameter Form Generation in Chat
│   └── P2.3: Floating Unread Jump Pill & Smooth Sticky Header
│
└── P3 [ADVANCED CAPABILITIES]
    ├── P3.1: Background Full-Duplex Realtime Voice Calls
    └── P3.2: Exportable Bot Template Share Deep Links
```

---

## 2. Engineering Specifications for P0 Implementations

### P0.1: Compact Terminal & Tool Activity Cards
- **Objective:** Eliminate the tall, disruptive console logs that flood MOBOT's chat during tool and bash execution.
- **Visual Design Spec:**
  - Card Height: `44dp` collapsed.
  - Background: `color.surface.elevated` (`#202024`), border: `1px solid #313538`, corner radius: `12dp`.
  - Left Element: Monospace terminal icon / tool glyph (18dp).
  - Center Element: Single-line truncated command string in `XVF Mono` (`13sp`, `#FFFFFF`).
  - Right Element:
    - Running: Animated circular spinner (14dp).
    - Success: Emerald pill badge (`#00C972`) with checkmark and execution duration (e.g., `0.8s`).
    - Failure: Coral pill badge (`#FF3E51`) with exit code (e.g., `Exit 127`).
- **Interaction Spec:**
  - Tapping the collapsed card expands a smooth animated accordion revealing syntax-highlighted stdout/stderr.
  - Tapping the "Pop Out" icon opens a full-screen Compose sheet with text selection, search, and copy-all action.
- **Compose Implementation Blueprint:**
  ```kotlin
  @Composable
  fun ToolExecutionCard(
      command: String,
      durationMs: Long?,
      exitCode: Int?,
      output: String,
      isExecuting: Boolean,
      modifier: Modifier = Modifier
  ) {
      var isExpanded by remember { mutableStateOf(false) }
      Surface(
          shape = RoundedCornerShape(12.dp),
          color = Color(0xFF202024),
          border = BorderStroke(1.dp, Color(0xFF313538)),
          modifier = modifier.fillMaxWidth().clickable { isExpanded = !isExpanded }
      ) {
          Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
              Row(verticalAlignment = Alignment.CenterVertically) {
                  Icon(Icons.Default.Terminal, contentDescription = null, tint = Color(0xFFA1A1AA))
                  Spacer(Modifier.width(8.dp))
                  Text(
                      text = command,
                      fontFamily = FontFamily.Monospace,
                      fontSize = 13.sp,
                      color = Color.White,
                      maxLines = 1,
                      overflow = TextOverflow.Ellipsis,
                      modifier = Modifier.weight(1f)
                  )
                  if (isExecuting) {
                      CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                  } else {
                      val isSuccess = exitCode == 0
                      Surface(
                          color = if (isSuccess) Color(0xFF00C972).copy(alpha = 0.15f) else Color(0xFFFF3E51).copy(alpha = 0.15f),
                          shape = CircleShape
                      ) {
                          Text(
                              text = if (isSuccess) "${durationMs?.div(1000f) ?: 0}s" else "Exit $exitCode",
                              color = if (isSuccess) Color(0xFF00C972) else Color(0xFFFF3E51),
                              fontSize = 11.sp,
                              fontWeight = FontWeight.SemiBold,
                              modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                          )
                      }
                  }
              }
              AnimatedVisibility(visible = isExpanded) {
                  SelectionContainer {
                      Text(
                          text = output,
                          fontFamily = FontFamily.Monospace,
                          fontSize = 12.sp,
                          color = Color(0xFFA1A1AA),
                          modifier = Modifier.padding(top = 8.dp)
                      )
                  }
              }
          }
      }
  }
  ```

---

### P0.2: Ambient Acoustic State Cues (Micro-Sound Design)
- **Objective:** Provide subconscious acoustic feedback so users immediately understand agent progress without staring at the screen.
- **Audio Asset Architecture:**
  - Place 5 lightweight 16-bit PCM WAV assets in `android/app/src/main/res/raw/`:
    - `sound_blip.wav`: Conversation start.
    - `sound_tick.wav`: Subconscious heartbeat during reasoning & tool execution (played at low volume: 0.15).
    - `sound_double_tick.wav`: Intermediate tool step completion.
    - `sound_chime.wav`: Turn finalized and message ready.
- **Android Sound Manager Blueprint:**
  ```kotlin
  class AgentSoundManager(context: Context) {
      private val soundPool = SoundPool.Builder().setMaxStreams(4).build()
      private val tickId = soundPool.load(context, R.raw.sound_tick, 1)
      private val doubleTickId = soundPool.load(context, R.raw.sound_double_tick, 1)
      private val chimeId = soundPool.load(context, R.raw.sound_chime, 1)

      fun playToolHeartbeat() { soundPool.play(tickId, 0.15f, 0.15f, 1, 0, 1.0f) }
      fun playToolComplete() { soundPool.play(doubleTickId, 0.4f, 0.4f, 1, 0, 1.0f) }
      fun playTurnComplete() { soundPool.play(chimeId, 0.6f, 0.6f, 1, 0, 1.0f) }
  }
  ```

---

### P0.3: Landing Page & Empty State Overhaul
- **Objective:** Transform MOBOT's initial screen from a blank utility view into an inviting, high-polish entry point.
- **Visual Design Spec:**
  - Background: Root dark neutral `#141414`.
  - Floating Elements: 6–8 procedurally scattered geometric bot avatars (squircle, cloud, hex) framing the upper and lower screen edges, leaving the center clear.
  - Centered Typography Stack:
    - App Title: `XVF` 28sp Bold, `#FFFFFF`, perfectly centered.
    - Subtitle: `XVF` 15sp Regular, `#A1A1AA`, 2 lines max, centered with 20dp line height.
    - Spacing: Exactly 28dp between title and subtitle.
  - Primary Action Button:
    - Width: Full width minus 36dp (18dp side margins).
    - Height: `48dp` full pill (`RoundedCornerShape(24.dp)`).
    - Background: Solid `#FFFFFF`, Text: `#141414` Bold 16sp.
    - Elevation: 0dp shadow, relies purely on maximum contrast against `#141414` ground.

---

## 3. Engineering Specifications for P1 Implementations

### P1.1: Virtual Trackpad Overlay for Android WebView Browser Tools
- **Objective:** Give users fluid, precise cursor control when viewing or interacting with web pages automated by `android_browser`.
- **Implementation Strategy:** Inject a lightweight JavaScript overlay directly into the Android `WebView` via `evaluateJavascript()`:
  - Transparent overlay `div` with `touch-action: none`.
  - Multi-touch gesture decoder:
    - Single finger drag: translates relative delta `dx`, `dy` into mouse coordinates.
    - Single finger tap: synthetic `mousedown` + `mouseup` (left click).
    - Two finger tap: synthetic right click (`button = 2`).
    - Two finger drag: dispatches `WheelEvent` with delta scaling for smooth mouse wheel scrolling.
  - Auto-Pan: If cursor approaches canvas boundary, calls viewport scroll smoothly.
  - In Compose: Floating pill toggle on the WebView bar allowing users to switch between "Trackpad Mode" and "Direct Touch Mode".

---

### P1.2: Swipeable Message Rows for Transcript Action Trays
- **Objective:** Declutter the primary chat view by hiding secondary actions (fork, copy code, inspect raw JSON, retry) behind smooth swipe gestures.
- **Implementation Strategy:**
  - Wrap each `MessageItem` in a custom Compose horizontal swipe container using `Modifier.pointerInput` and `Animatable(0f)`.
  - Swiping left by 64dp reveals an action tray with 3 icons (Copy, Fork, Inspect).
  - Swiping past 120dp triggers an elastic spring snap (`spring(stiffness = Spring.StiffnessMediumLow, dampingRatio = Spring.DampingRatioMediumBouncy)`).

---

### P1.3: Multi-Tier Reasoning Toggle in Composer
- **Objective:** Give users deliberate control over model reasoning effort directly in the composer.
- **Visual Spec:**
  - Compact pill chip in the composer toolbar: `Reasoning: Low | Med | High`.
  - Tapping opens a minimal popover or cycles values.
  - Transcripts fold reasoning thoughts into a clean accordion with live token count (`n_ai.usage.output_tokens.reasoningTokens`), ensuring internal model monologue never interrupts reading flow.

---

### P1.4: Per-Bot Composer Draft Persistence & `@Bot` Autocomplete
- **Objective:** Ensure user prompts are never lost when navigating between bots or room debates.
- **Implementation Strategy:**
  - Key draft text by `botId` in an in-memory ViewModel map backed by DataStore.
  - Typing `@` inside the text field triggers an animated popover list of available local bots. Selecting a bot inserts `@BotName` and configures the dispatch router for that turn.

---

## 4. Screen-by-Screen Implementation Guide for Android Engineers

| Screen | Primary Hierarchy | Color Tokens | Spacing Scale | Key Component |
| :--- | :--- | :--- | :--- | :--- |
| **Landing Screen** | Floating Bot Avatars -> Title -> Subtitle -> Pill CTA | `#141414` base, `#FFFFFF` CTA, `#A1A1AA` sub | Margin: 18dp, Section: 32dp, Button: 48dp | `FloatingAvatarCanvas`, `PillButton` |
| **Chat Transcript** | Header (Avatar + Title + Model) -> LazyList -> Sticky Composer Dock | `#141414` ground, `#202024` bubbles, `#313538` border | Bubble padding: 14dp, Turn gap: 16dp | `SwipeableTranscriptRow`, `NitroMarkdown` |
| **Tool Execution** | Command Line -> Status Badge -> Collapsed Output Fold | `#202024` card, `#00C972` success, `#FF3E51` fail | Height: 44dp, Icon: 18dp, Margin: 8dp | `ToolExecutionCard` |
| **Browser Viewport** | Web Toolbar (URL + Status + Mode) -> WebView -> Trackpad Overlay | `#0D0D0D` ground, `#202024` toolbar | Full-bleed, Toolbar: 48dp | `AndroidWebView` + Injected Trackpad JS |
| **Terminal Viewer** | Monospace Terminal -> Search/Filter Bar -> Action Bar (Copy/Kill) | `#0D0D0D` ground, `#A1A1AA` mono, `#313538` border | Margin: 12dp, Type: 12sp mono | `SelectionContainer` + Monospace Log Canvas |
| **Bot Profile** | Avatar Geometry Editor -> Identity Fields -> Tool Grants -> Routines | `#141414` ground, `#18181B` grouped rows | Row padding: 14dp, Group gap: 20dp | `ProceduralAvatarView`, `SettingRow` |
| **Settings Screen** | Grouped Card Lists -> Hairline Dividers -> Chevron Indicators | `#141414` ground, `#202024` cards, `#262626` dividers | Side margin: 16dp, Row: 52dp | `GroupedCardList` |
