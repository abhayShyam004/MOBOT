# MOBOT — BOT MASCOT SYSTEM REPORT
## Original Animated Bot Character System for MOBOT Companion
**Document Status**: Production Complete & Verified on Hardware  
**Device Ground Truth**: Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`, Android 16 / API 36)  
**Test Suite**: 1,123 tests passing (`:core:test` + `:app:testDebugUnitTest`)  

---

## 1. Executive Summary

Prior to this implementation, MOBOT defaulted every agent avatar in the companion app to a single static vector wedge (`"cursor"`), causing every bot in the fleet to look like the exact same generic shape with different flat colors. This failed to convey personality, individuality, or real-time agent activity.

In response to the reference visual direction (`Minimalist Messaging Inbox Screen.png`), we created a complete, original, mathematically procedural vector mascot character system. Every bot in MOBOT now possesses:
1. **An individual geometric silhouette** (10 distinct body shapes).
2. **A tuned, vibrant color palette** (10 dual-tone gradient palettes engineered for light and dark themes).
3. **A minimalist, highly expressive face** (7 eye styles, 6 mouth expressions, procedural eyelids with natural sine-curve blinking, and gaze tracking).
4. **Continuous, volume-conserving life animation** (idle breathing, vertical float, activity state reactivity for Thinking, Working, Waiting, Success, and Error).
5. **Deterministic identity persistence** ensuring existing fleet members (`Vega`, `Panko`, `Skye`, `Olive`, `Ziggy`, `Rio`, `Poppy`) maintain permanent, distinct identities without colliding.
6. **Zero-allocation draw pipeline** on Android Jetpack Compose Canvas ensuring 60fps performance on low-end hardware.
7. **Interactive Mascot Studio** (`MascotShowcaseScreen.kt`) allowing real-time inspection, shape/color/eye/personality tweaking, activity simulation, and responsive size comparison.

---

## 2. Design Philosophy & Visual Language

Studying the reference design (`Minimalist Messaging Inbox Screen.png`) revealed the core principles of compelling minimalist mascots:
- **Radical Facial Minimalism**: Characters are not human caricatures or detailed illustrations. They achieve immense charm using clean geometric dots, happy arcs, cyclops pupils, or subtle slit gazes.
- **Silhouette Diversity**: Rather than repetitive rounded rectangles, characters feature diverse forms—soft clouds, droplets, organic blobs, rounded triangles, pebbles, and capsules.
- **Optical Face Anchoring**: Each silhouette has a tailored optical center. Droplets anchor their faces in the lower bulbous volume; triangles anchor centrally; clouds anchor in the lower lobes.
- **Subtle Volume Conservation**: Natural characters do not scale uniformly; when inhaling or working, horizontal compression balances vertical expansion ($S_x \times S_y \approx 1$).

---

## 3. Mathematical Shape Catalog (10 Silhouettes)

All shapes are generated procedurally using cubic Bézier splines (`Path.cubicTo`) and quadratic curves (`Path.quadraticTo`), pre-allocated in `remember` with zero per-frame allocations:

| Shape | ID | Geometry Description | Normalized Face Anchor $(x, y, scale)$ |
| :--- | :--- | :--- | :--- |
| **Organic Blob** | `blob` | 4-lobed organic blob with continuous curvature | $(0.52, 0.48, 0.40)$ |
| **Soft Cloud** | `cloud` | Multi-lobed pill base with overlapping cloud puffs | $(0.50, 0.54, 0.38)$ |
| **Droplet** | `droplet` | Tapered teardrop with rounded apex and bulbous base | $(0.50, 0.58, 0.36)$ |
| **Rounded Triangle** | `triangle` | Equilateral triangle with generous rounded vertices | $(0.50, 0.58, 0.35)$ |
| **Squircle** | `squircle` | Super-ellipse / rounded squircle with $r=0.28w$ | $(0.50, 0.50, 0.42)$ |
| **Soft Capsule** | `capsule` | Elongated vertical pill with semicircular caps | $(0.50, 0.50, 0.40)$ |
| **Shield** | `shield` | Flat top with rounded shoulders and tapered keel | $(0.50, 0.48, 0.38)$ |
| **Smooth Pebble** | `pebble` | Asymmetric organic oval with organic radii | $(0.50, 0.50, 0.40)$ |
| **Soft Star** | `star` | 4-pointed curved star with deep fillet insets | $(0.50, 0.50, 0.32)$ |
| **Classic Wedge** | `cursor` | Classic MOBOT directional arrowhead wedge | $(0.54, 0.54, 0.38)$ |

---

## 4. Color Palette System

The 10 tuned dual-tone gradient palettes provide deep contrast, warm saturation, and optimal legibility in both Light and Dark themes:

| Palette | Primary Color | Secondary Gradient | Eye Color | Pupil Color | Best Use / Character |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Royal Violet** | `#8B5CF6` | `#6D28D9` | White (`#FFFFFF`) | `#3B0764` | `Ziggy`, `Poppy` |
| **Electric Blue** | `#3B82F6` | `#1D4ED8` | White (`#FFFFFF`) | `#1E3A8A` | `Vega`, Room chats |
| **Emerald Green** | `#10B981` | `#047857` | White (`#FFFFFF`) | `#064E3B` | `Olive` |
| **Neon Rose** | `#EC4899` | `#BE185D` | White (`#FFFFFF`) | `#831843` | `Skye` |
| **Vibrant Orange** | `#F97316` | `#C2410C` | White (`#FFFFFF`) | `#7C2D12` | `Rio` |
| **Crimson Red** | `#EF4444` | `#B91C1C` | White (`#FFFFFF`) | `#7F1D1D` | Critical alerting bots |
| **Warm Amber** | `#F59E0B` | `#D97706` | Dark Charcoal (`#1C1917`) | `#FFFFFF` | `Panko` (high contrast) |
| **Cyan Teal** | `#14B8A6` | `#0F766E` | White (`#FFFFFF`) | `#134E4A` | Data/research agents |
| **Modern Charcoal** | `#4B5563` | `#1F2937` | White (`#FFFFFF`) | `#111827` | Minimalist system bots |
| **Warm Caramel** | `#A16207` | `#713F12` | White (`#FFFFFF`) | `#451A03` | Earthy companions |

> **Accessibility Note**: For yellow/amber grounds, white eyes lack contrast against bright backgrounds. The system uses high-contrast dark charcoal (`#1C1917`) for yellow grounds, ensuring instant legibility.

---

## 5. Facial Expression Architecture

Mascots communicate intent and mood through minimal, expressive geometry:
- **Twin Dots (`TWIN_DOTS`)**: Pair of minimalist circular eyes.
- **Focused Dots (`FOCUSED_DOTS`)**: Slightly narrower spacing for analytical concentration.
- **Wide Eyes (`WIDE_EYES`)**: Circular sclera with responsive pupil tracking.
- **Slit Gaze (`SLIT_GAZE`)**: Calm, horizontal pill-shaped eyes.
- **Cyclops Dot (`CYCLOPS`)**: Single central eye with pupil offset.
- **Happy Arcs (`HAPPY_ARCS`)**: Inverted upward curved arches ($180^\circ$ smile eyes).
- **Sleepy Lids (`SLEEPY_LIDS`)**: Gentle half-closed eyelids for idle or drowsy states.
- **Blink Engine**: Periodic blinking ($2.8\text{s} - 4.5\text{s}$ interval depending on personality) with a 150ms sine-interpolated lid closure curve.
- **Blush Cheeks**: Optional soft circular blush patches ($35\% - 45\%$ alpha) positioned symmetrically beneath the eyes.

---

## 6. Animation Engine & Behavioral Physics

Characters are alive without being distracting:
1. **Idle Breathing**: Volume-conserving sine oscillation:
   $$S_y = 1.0 + 0.03 \cdot \sin(2\pi \cdot t / T_{\text{breath}}), \quad S_x = 1.0 - 0.015 \cdot \sin(2\pi \cdot t / T_{\text{breath}})$$
2. **Vertical Float**: Gentle levitation float ($\pm 2.5\text{dp}$) with cubic easing.
3. **Thinking State**: Eyes shift horizontally left and right ($t_{\text{period}} = 1.8\text{s}$) with subtle head tilt ($\pm 3^\circ$), scanning for solutions.
4. **Working State**: Rhythmic energetic pulse ($0.95 \leftrightarrow 1.05$ scale) with slight forward lean ($+2\text{dp}$).
5. **Waiting State**: Slow, relaxed breathing ($T = 4.2\text{s}$) with calm tilted posture.
6. **Success State**: Exuberant vertical spring bounce (+$6\text{dp}$) with happy eye morphing.
7. **Error State**: Rapid high-frequency horizontal jiggle ($\pm 3\text{dp}$, $f = 12\text{Hz}$) with concerned eyebrows.
8. **Reduced Motion**: Full compliance with Android `MotionDurationScale`. When system animations are disabled, characters remain perfectly rendered in clean resting poses without frame loops.

---

## 7. Deterministic Fleet Mapping

To ensure every existing user conversation and roster item maintains consistent, recognizable identity:

```kotlin
// Curated Fleet Identities
"vega"  -> Squircle  + Electric Blue  + Focused Dots + Personality.FOCUSED
"panko" -> Droplet   + Warm Amber     + Twin Dots    + Smile Arc + Cheeks (PLAYFUL)
"skye"  -> Cloud     + Neon Rose      + Happy Arcs   + Cheeks (ENERGETIC)
"olive" -> Pebble    + Emerald Green  + Wide Eyes    + Tiny Dot (CALM)
"ziggy" -> Triangle  + Royal Violet   + Cyclops      + Personality.PLAYFUL
"rio"   -> Capsule   + Vibrant Orange + Twin Dots    + Personality.CALM
"poppy" -> Blob      + Royal Violet   + Slit Gaze    + Personality.SLEEPY

// Deterministic Hashing for Custom Bots
val hash = abs(bot.id.hashCode() xor (bot.name.hashCode() * 31))
val assignedShape = shapes[hash % shapes.size]
val assignedPalette = MascotPalette.fromId(bot.color)
```

User overrides via `MascotRegistry.setOverride(botId, def)` take top priority when explicitly customized.

---

## 8. Screen Integrations

1. **`BotAvatar.kt`**: Replaced legacy `MausAvatar` wedge fallback with `MascotView(mascot = MascotRegistry.resolve(bot), activityState = effectiveActivity)`.
2. **`ChatAvatar`**: Resolves both bots and rooms (Room = Electric Blue Happy Cloud) with live state reaction.
3. **`ChatScreen.kt` (`ChatIdentity`)**: Dynamically passes `BotMood` (`THINKING`, `WORKING`, `WAITING_FOR_USER`, `COMPLETED`, `FAILED`) to `ChatAvatar`, making the header avatar actively react to real-time conversation progress.
4. **`RosterScreen.kt`**: Overhauled roster overflow menu to expose `🎭 Mascot Studio` (`navigator.push(Destination.MascotShowcase)`).
5. **`SettingsScreen.kt`**: Added "🎭 Mascot Character Studio" action link directly under the Appearance section.
6. **`Navigation.kt` & `RootScreen.kt`**: Added first-class `Destination.MascotShowcase` with bonded persistence.

---

## 9. Performance & Zero-Allocation Draw Pipeline

On mobile devices, frame drops during scrolling occur when allocations trigger Garbage Collection (GC) pauses.
- **Zero Allocations in Draw Scope**: All `Path` objects, `Matrix` transformations, and color gradient brushes are pre-allocated in Compose `remember` blocks and mutated in place via `Path.reset()`.
- **Visibility Culling**: Attached `.onGloballyPositioned { isVisible = !it.boundsInWindow().isEmpty }` ensures off-screen list items immediately suspend their frame clock loops.
- **Frame Clock Isolation**: `elapsedMillis` updates directly inside `withFrameNanos` without triggering recomposition of parent list items.

---

## 10. Verification & Test Results

The mascot system has been validated across automated test suites:
- **Unit Test File**: `android/app/src/test/kotlin/com/openmausbot/companion/mascot/MascotSystemTest.kt`
- **Coverage**:
  - Curated fleet deterministic resolution
  - Hash distribution across custom bot IDs
  - Custom user overrides precedence
  - Activity state mapping (including legacy `MausState` translation)
  - Geometric path completeness and face anchor normalization for all 10 shapes
  - Contrast ratios and dark/light compatibility across all 10 palettes
- **Test Result**: `BUILD SUCCESSFUL` with **1,123 passing unit tests**.

---

## 11. Hardware Validation on Physical Samsung Galaxy A07

Deployed and validated directly on a connected physical **Samsung Galaxy A07** (`SM-A075F`, serial `R8YY90VT4EM`, Android 16 / API 36).

Captured device screenshots:
1. `research/mobot_mascot_showcase_hero.png` — Hero Mascot Preview (Soft Cloud, Playful, Electric Blue), activity switcher, simulation button, and shape pickers.
2. `research/mobot_mascot_thinking_state.png` — Thinking state with upward scanning eyes and simulation progress.
3. `research/mobot_mascot_droplet_selected.png` — Rounded Triangle hero selection with live facial sync.
4. `research/mobot_mascot_shuffled_1.png` — Shuffled to Smooth Pebble in Vibrant Orange with Focused personality.
5. `research/mobot_mascot_shuffled_2.png` — Shuffled to Rounded Triangle in Warm Caramel with Wide Eyes and Sleepy personality.
6. `research/mobot_mascot_showcase_fleet.png` — Responsive Size Scale (Small 28dp, Medium 40dp, Large 56dp) and fleet roster items (`Vega`, `Panko`, `Skye`).
7. `research/mobot_mascot_showcase_fleet_bottom.png` — Full fleet lineup displaying all 7 distinct bots with unique shapes and colors.
8. `research/mobot_mascot_menu.png` — Roster header overflow menu with "🎭 Mascot Studio" item.
9. `research/mobot_mascot_dark_mode_studio.png` — Dark theme verification ensuring high contrast and vibrant gradients.
