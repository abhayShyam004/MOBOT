# MOBOT vs. Grok — Deep Forensic UI/UX Gap Analysis

**Date:** 2026-10-13  
**Evaluator:** Product Designer & Mobile Systems Engineer  
**Scope:** Comparative analysis between **MOBOT** (`com.openmausbot.companion`) and **Grok Android** (`ai.x.grok.bot`, `SandMobile` v1.15.0).

---

## 1. Architectural Paradigms & Foundational Contrast

| System Dimension | MOBOT (`com.openmausbot.companion`) | Grok Bot (`ai.x.grok.bot`) |
| :--- | :--- | :--- |
| **Compute Topology** | **100% On-Device Local Host:** Embedded Node.js runtime (`libnode_host.so`, PID child) running locally on loopback port 18799. | **100% Cloud-Dependent:** Client is a remote controller for cloud-hosted agent VMs and GPU clusters. |
| **Data Sovereignty** | **100% Local:** SQLite message store (`messages.db`), local bot JSONs, offline capability. Zero telemetry leaks. | **Cloud-Synced:** Transcripts, artifacts, and profiles reside on xAI/Cursor servers with Braze, Sentry, AppsFlyer. |
| **Frontend Toolkit** | **100% Native Jetpack Compose (Kotlin):** Material 3 declarative UI natively compiled to Android ART. | **Hybrid React Native + Expo 57:** Hermes Bytecode v98 + C++ JSI (`libNitroModules.so`). |
| **Markdown Engine** | Compose Text / Multiplatform Markdown parser. | **Native C++ AST Session:** `libNitroMarkdown.so` updating incremental syntax trees without JS serialization. |
| **Browser Execution** | **Local Android WebView (`android_browser`):** 15 tools executing DOM commands on-device. | **Remote Desktop Container via noVNC:** Embedded WebView streaming remote desktop with a virtual trackpad overlay. |
| **Terminal Execution** | **Local Shell (`android_computer`):** 29 tools executing bash directly on Android storage. | **Persistent Cloud Shell:** `cloud_persistent_terminal` session with compact card rendering in chat. |

---

## 2. Category A: What MOBOT Already Does Well

MOBOT has strong foundational engineering advantages that must be preserved:

1. **Local-First Speed & Zero Network Latency:**
   - Because MOBOT's host server runs in the same Android process group via `HarnessService`, tool discovery, local file reads, and database operations execute in sub-millisecond loopback time without requiring internet connectivity.
2. **True Native Android Integration:**
   - MOBOT uses 100% native Kotlin Jetpack Compose. This provides instant startup, native Android predictive back navigation, exact Material 3 dynamic color integration, and clean battery management without Hermes JVM memory overhead.
3. **Multi-Agent Room Deliberation:**
   - MOBOT has native multi-bot debate rooms with handoff queues (`room-handoffs.json`). Users can watch multiple local bots converse and collaborate in a shared room, whereas Grok's model is primarily 1:1 conversation with `@Bot` mentions.
4. **Transparent Local Tool Catalog:**
   - MOBOT explicitly enumerates all 29 tools for `android_computer` and 15 tools for `android_browser` in its Settings UI, providing engineering transparency rather than obscuring actions behind opaque cloud abstractions.

---

## 3. Category B: Areas Where MOBOT Is Clearly Weaker

Despite its architectural strengths, MOBOT's UI/UX feels unpolished compared to Grok. The following specific deficiencies were identified:

### 3.1 Terminal Output Presentation
- **The Defect in MOBOT:** When a local bot runs a bash command via `android_computer`, raw stdout/stderr logs are often rendered in tall, multi-line console blocks inside the chat bubble. A 50-line `npm install` or `find` command pushes the user's conversation context completely off screen.
- **The Grok Solution:** Commands are presented in a **`compact_terminal-rectangle`** card:
  - Displays the one-line command string in crisp `XVFMono`.
  - Shows execution status with a colored exit code badge (green for code 0, red for error) and a duration tag (`1.4s`).
  - Output is folded by default. Tapping the card opens a dedicated modal viewer with text selection and copy actions.
  - Streaming stdout is throttled (`disable_terminal_output_ui_streaming`) to prevent UI frame drops.

### 3.2 Browser & Web Tool Interaction Ergonomics
- **The Defect in MOBOT:** `android_browser` operates headlessly or through a hidden WebView. When a web action fails or a user wants to view the page the agent is browsing, there is no smooth tactile interface to interact with the page.
- **The Grok Solution:** Grok embeds the browser viewport and injects the **`sand-trackpad-overlay`**:
  - Translates finger touch gestures into a floating mouse cursor.
  - 1-finger drag moves the cursor; 1-finger tap sends a click; 2-finger drag smoothly scrolls the mouse wheel (`dispatchWheel`).
  - Automatic edge clamping and smooth viewport panning (`window.sandZoom.panBy`).
  - Dual modes: users can toggle between "trackpad mode" and "direct touch mode".

### 3.3 Streaming Markdown Rendering & Frame Rate
- **The Defect in MOBOT:** Parsing incoming Markdown chunks with syntax-highlighted code blocks in Compose can trigger frequent recomposition passes on the main thread, resulting in micro-stuttering during high-speed token generation.
- **The Grok Solution:** Offloads streaming Markdown parsing entirely to native C++ (`libNitroMarkdown.so`), maintaining a persistent `HybridMarkdownSession` that incrementally appends tokens and yields AST updates with zero garbage collection spikes.

### 3.4 Complete Absence of Acoustic & Haptic Feedback
- **The Defect in MOBOT:** MOBOT is completely silent. During multi-step agent operations (e.g. searching web -> extracting text -> editing file -> running shell), the user must stare fixated at the screen or wonder if the app has frozen.
- **The Grok Solution:** Grok incorporates subtle, deliberate sound design:
  - `ping_2_tick.wav`: A quiet rhythmic tick acts as an ambient heartbeat while the bot is reasoning or running tools.
  - `ping_3_double_tick.wav`: A satisfying double-tick confirms a tool step just succeeded.
  - `ping_4_chime.wav`: A soft chime notifies the user that the final response is ready.
  - This turns long agent tasks into a reassuring ambient experience.

### 3.5 Action Clutter on Message Bubbles
- **The Defect in MOBOT:** Action buttons (copy text, retry, fork turn, inspect raw tool payload) are permanently rendered below each message bubble, adding persistent visual noise.
- **The Grok Solution:** Grok uses Reanimated **`transcriptSwipeRow`** spring gestures. Swiping a message horizontally reveals an action tray with crisp spring physics (`withSpring(0, releaseSpring)`), keeping the primary reading canvas pristine.

### 3.6 Reasoning / Thinking Control
- **The Defect in MOBOT:** Thinking effort is treated as a global setting or hidden system parameter.
- **The Grok Solution:** Grok provides an explicit pill toggle in the composer dock: `Thinking: Low | Medium | High`. During generation, thinking thoughts are rendered in a dedicated collapsible fold with live token metrics (`reasoningTokens`), cleanly separating internal deliberation from final user-facing text.

### 3.7 Identity & Emotional Polish
- **The Defect in MOBOT:** MOBOT bots are distinguished by simple static colors or flat icons, feeling like database records.
- **The Grok Solution:** Grok's procedural identity engine (`babygrok-geometry.json`) generates living geometric personalities with distinct body shapes (squircle, cloud, hex, teardrop) and expressive animated eyes that react to agent states (idle, listening, thinking, speaking).

---

## 4. Category C: Missing Patterns Worth Adopting in MOBOT

| Pattern | Description | Technical Path in MOBOT |
| :--- | :--- | :--- |
| **Compact Tool Execution Cards** | Fold intermediate tool runs into 48dp rectangular badges with duration, status code, and tap-to-expand. | Implement Compose `ToolExecutionCard` composable in `MessageBubble.kt`. |
| **Virtual Touchpad for Browser Tools** | Injected JavaScript overlay into Android WebView enabling 2-finger wheel scroll, cursor drag, and auto-pan. | Inject `trackpad.js` into MOBOT's `android_browser` WebView container. |
| **Acoustic Status Feedback** | Subtle micro-sounds for tool heartbeat, tool finish, and turn completion. | Add lightweight WAV assets to Android `res/raw` and play via Android `SoundPool`. |
| **Swipeable Message Rows** | Horizontal swipe on messages to reveal contextual action buttons. | Utilize Jetpack Compose `SwipeToDismissBox` / custom `pointerInput` offset with spring spec. |
| **Multi-Tier Thinking Toggle** | In-composer chip toggle for reasoning effort (`Low`, `Medium`, `High`) with collapsible thought folds. | Add reasoning level selector to `ChatInputBar.kt` passing parameter to model gateway. |
| **Per-Bot Composer Draft Persistence** | Preserve in-progress prompt drafts per bot so switching bots never loses user text. | Persist `draft_[botId]` in Android DataStore / SQLite preferences. |
| **Interactive In-Chat Form Sheets** | When a tool needs parameters, render a native Compose form in chat instead of asking endless conversational questions. | Implement dynamic JSON Schema form renderer in chat. |

---

## 5. Category D: Things MOBOT Should NOT Copy

1. **Do NOT Sacrifice Local On-Device Sovereignty:**
   - Grok's cloud computer VM architecture requires external servers, internet connectivity, and monthly subscriptions. MOBOT's core value proposition is **100% on-device private execution**.
2. **Do NOT Switch to React Native / Expo:**
   - MOBOT's native Jetpack Compose architecture is technically superior in memory efficiency, battery consumption, and native Android lifecycle integration.
3. **Do NOT Introduce Telemetry or Tracking SDKs:**
   - Grok embeds Braze, AppsFlyer, Sentry, and Google Ads SDKs. MOBOT must remain 100% private and telemetry-free.
4. **Do NOT Gate Local Tools Behind Integrity Checks:**
   - Grok uses Google Play Protect PairIP to lock down code. MOBOT is an open, hackable agent platform and should remain open.
