# Grok Android App — Design Tokens & Visual Design System Specification

**Target Package:** `ai.x.grok.bot` (`SandMobile` v1.15.0 / build 1033)  
**System Architecture:** Dark-First Minimalist Modern Utility with Procedural Accent Identity  
**Evidence Basis:** Pixel extraction from hardware screenshots, decompiled Hermes bytecode styles, `assets/babygrok-geometry.json`, and native asset inspection.

---

## 1. Color Palette Tokens

### 1.1 Foundation & Surfaces (Dark Theme — Default)

| Token Name | Hex Value | RGB | Role / Usage | Evidence Basis | Confidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `color.bg.base` | `#141414` | `(20, 20, 20)` | Root application background | Hardware screenshot sample | **HIGH** |
| `color.bg.canvas` | `#0D0D0D` | `(13, 13, 13)` | Deep canvas background (Voice, Canvas) | Bytecode style extract | **HIGH** |
| `color.surface.subtle` | `#18181B` | `(24, 24, 27)` | Grouped section background / secondary fill | Bytecode style extract | **HIGH** |
| `color.surface.elevated`| `#202024` | `(32, 32, 36)` | Message bubble, input surface, card background | Bytecode style extract | **HIGH** |
| `color.surface.hover` | `#27272A` | `(39, 39, 42)` | Pressed / active state on cards and buttons | Bytecode style extract | **HIGH** |
| `color.surface.overlay` | `rgba(0,0,0,0.65)` | `(0, 0, 0, 0.65)` | Backdrop scrim for bottom sheets and modals | Reanimated overlay style | **HIGH** |
| `color.border.subtle` | `#262626` | `(38, 38, 38)` | Card borders, subtle dividers | Bytecode style extract | **HIGH** |
| `color.border.default` | `#313538` | `(49, 53, 56)` | Input borders, toolbar bottom divider | Bytecode style extract | **HIGH** |
| `color.border.focus` | `#52525B` | `(82, 82, 91)` | Focused input outline, active selection | Bytecode style extract | **MEDIUM** |

### 1.2 Typography & Foreground Colors

| Token Name | Hex Value | RGB | Role / Usage | Evidence Basis | Confidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `color.text.primary` | `#FFFFFF` | `(255, 255, 255)` | Headings, user text, primary button text | Hardware screenshot sample | **HIGH** |
| `color.text.secondary` | `#A1A1AA` | `(161, 161, 170)` | Subtitles, timestamps, helper descriptions | Hardware screenshot sample | **HIGH** |
| `color.text.muted` | `#71717A` | `(113, 113, 122)` | Disabled text, tertiary metadata, placeholders | Bytecode style extract | **HIGH** |
| `color.text.inverse` | `#141414` | `(20, 20, 20)` | Text placed on white primary pill buttons | Hardware screenshot sample | **HIGH** |
| `color.text.link` | `#38BDF8` | `(56, 189, 248)` | Clickable web links and markdown citations | Bytecode style extract | **MEDIUM** |

### 1.3 Canonical Avatar & Accent Palette (`babygrok-geometry.json`)
The application defines 11 canonical pairs of light/dark accent colors for its procedural bot identity engine:

| Palette Name | Light Mode Hex | Dark Mode Hex | Semantic Role / Persona | Confidence |
| :--- | :--- | :--- | :--- | :--- |
| `accent.black` | `#000000` | `#FFFFFF` | Monochrome, System, Executive | **HIGH** |
| `accent.brown` | `#A27952` | `#855C36` | Earthy, Stable, Archive | **HIGH** |
| `accent.red` | `#FF3E51` | `#E02135` | Error, Critical, High Alert | **HIGH** |
| `accent.orange` | `#FF781C` | `#FF6700` | Creative, Warning, Pending Action | **HIGH** |
| `accent.yellow` | `#FFAF38` | `#FF9800` | Thinking, Reasoning, Attention | **HIGH** |
| `accent.green` | `#00C972` | `#009957` | Success, Completed Turn, Operational | **HIGH** |
| `accent.cyan` | `#1CC3B0` | `#00A592` | Web Browsing, Data Extraction | **HIGH** |
| `accent.blue` | `#2A92FE` | `#0E74E0` | Primary Agent, Code Execution, Cloud | **HIGH** |
| `accent.violet` | `#A97EFE` | `#804EE0` | Research, Deep Analysis, Synthesis | **HIGH** |
| `accent.magenta` | `#FF5EB1` | `#E02A88` | Personal, Creative, Chat | **HIGH** |
| `accent.gray` | `#959595` | `#777777` | Neutral, Inactive, Background | **HIGH** |

---

## 2. Typography Hierarchy Tokens

### 2.1 Font Families
- **Sans-Serif (Body & Display):** `XVF` (Variable font family, custom cut for xAI / Cursor).
- **Monospace (Code & Terminal):** `XVF Mono`.
- **System Symbols:** Material Symbols Regular 400 (`@expo-google-fonts/material-symbols`).
- **Icon Glyphs:** `CursorIcons16-Regular`.

### 2.2 Type Scale Hierarchy

| Token Name | Font Family | Weight | Size (sp/dp) | Line Height (dp) | Letter Spacing | Usage | Confidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `font.display.large` | `XVF` | 700 (Bold) | `32sp` | `38dp` | `-0.5px` | Splash, Marketing Hero | **HIGH** |
| `font.display.medium`| `XVF` | 700 (Bold) | `28sp` | `34dp` | `-0.3px` | Onboarding Title ("Grok Bot") | **HIGH** |
| `font.title.large` | `XVF` | 600 (Semibold) | `22sp` | `28dp` | `-0.2px` | Screen Header, Bot Profile Name | **HIGH** |
| `font.title.medium`| `XVF` | 600 (Semibold) | `18sp` | `24dp` | `0px` | Card Headers, Sheet Titles | **HIGH** |
| `font.body.large` | `XVF` | 400 (Regular) | `16sp` | `24dp` | `0px` | Chat Message Body, Form Fields | **HIGH** |
| `font.body.medium` | `XVF` | 400 (Regular) | `14sp` | `20dp` | `0px` | Secondary Descriptions, Subtitles | **HIGH** |
| `font.body.small` | `XVF` | 400 (Regular) | `12sp` | `16dp` | `+0.2px` | Legal Footers, Timestamps, Tags | **HIGH** |
| `font.mono.body` | `XVF Mono` | 400 (Regular) | `13sp` | `18dp` | `0px` | Inline Code, Terminal Output | **HIGH** |
| `font.mono.bold` | `XVF Mono` | 600 (Semibold) | `13sp` | `18dp` | `0px` | Shell Command Headers, Keywords | **HIGH** |
| `font.label.button` | `XVF` | 600 (Semibold) | `16sp` | `20dp` | `+0.1px` | Pill Button Labels ("Log In") | **HIGH** |

---

## 3. Spacing & Dimensional Scale Tokens

The visual layout adheres strictly to an **8-point base grid** with a 4-point micro-step scale:

| Token Name | Dimension (dp) | Measured Pixels (at 1.875x) | Usage / Context | Confidence |
| :--- | :--- | :--- | :--- | :--- |
| `spacing.2xs` | `2dp` | `4px` | Micro-gap between status dot and text | **HIGH** |
| `spacing.xs` | `4dp` | `8px` | Icon-to-text gap, compact chip padding | **HIGH** |
| `spacing.sm` | `8dp` | `15px` | Spacing between horizontal chips, tool icons | **HIGH** |
| `spacing.md` | `12dp` | `22px` | Internal card padding, compact message margin | **HIGH** |
| `spacing.lg` | `16dp` | `30px` | Default message horizontal padding, dock inset | **HIGH** |
| `spacing.xl` | `18–20dp` | `34–38px` | **Primary Screen Side Margin** (measured: 18.1dp) | **HIGH** |
| `spacing.2xl` | `24dp` | `45px` | Section gap, header vertical padding | **HIGH** |
| `spacing.3xl` | `32dp` | `60px` | Separation between headline and subtitle | **HIGH** |
| `spacing.4xl` | `48dp` | `90px` | Top inset below system status bar | **HIGH** |

---

## 4. Shape & Corner Radius Tokens

Grok's design language is defined by a **dual-shape philosophy**: full organic pill rounding for interactive controls and subtle smooth squircle rounding for content cards.

| Token Name | Radius Value | Geometry Description | Usage | Confidence |
| :--- | :--- | :--- | :--- | :--- |
| `radius.full` | `9999dp` (Pill) | Full semicircular ends (50% of height) | Primary CTA buttons, chip toggles, jump pills | **HIGH** |
| `radius.xl` | `24dp` | Heavy rounding | Composer text input container, large modal sheets | **HIGH** |
| `radius.lg` | `16dp` | Standard card rounding | Message bubbles, tool cards, terminal cards | **HIGH** |
| `radius.md` | `12dp` | Medium rounding | Image thumbnails, code block containers | **HIGH** |
| `radius.sm` | `8dp` | Subtle rounding | Tool badges, citation pill buttons | **HIGH** |
| `radius.none` | `0dp` | Sharp square | Embedded full-bleed browser viewport | **HIGH** |

---

## 5. Elevation, Border & Depth Tokens

Grok deliberately avoids heavy drop-shadows on dark backgrounds, using **surface value shifts and crisp hairline borders** to create hierarchy:

| Token Name | Elevation Layer | Border Rule | Fill Color | Confidence |
| :--- | :--- | :--- | :--- | :--- |
| `elevation.level0` | Base Ground | None | `#141414` | **HIGH** |
| `elevation.level1` | Recessed / Inset | None | `#101010` (Code block background) | **HIGH** |
| `elevation.level2` | Surface Card | `1px solid #262626` | `#1C1C1F` | **HIGH** |
| `elevation.level3` | Interactive Element | `1px solid #313538` | `#222226` | **HIGH** |
| `elevation.level4` | Modal / Bottom Sheet | `1px solid #3F3F46` (Top only) | `#1A1A1E` + Backdrop Scrim | **HIGH** |
| `elevation.floating` | Floating Action Pill | `1px solid rgba(255,255,255,0.12)` | `#2A2A2E` + 12dp Blur Shadow | **HIGH** |

---

## 6. Motion & Physics Tokens

Physics parameters recovered from `react-native-reanimated` worklets:

| Token Name | Animation Type | Parameters / Curves | Duration / Feel | Confidence |
| :--- | :--- | :--- | :--- | :--- |
| `motion.spring.row` | Spring Physics | `stiffness: 300, damping: 30, mass: 1` | `withSpring(0, releaseSpring)` (Swipeable row release) | **HIGH** |
| `motion.spring.pill` | Scale Spring | `PILL_RESTING_SCALE = 1.0, activeScale = 0.96` | Tactile feedback on button press | **HIGH** |
| `motion.timing.fade` | Linear / Quad Out | `duration: 180ms, easing: Easing.out(Easing.quad)` | Message fade-in on arrival | **MEDIUM** |
| `motion.sheet.enter` | Bottom Sheet In | `duration: 320ms, easing: Easing.bezier(0.16, 1, 0.3, 1)` | iOS-style decelerating sheet slide-up | **HIGH** |
| `motion.canvas.hold` | Anti-Flicker | Retains prior frame in DOM during resize | Zero-flash resolution transition (`holdFrame`) | **HIGH** |

---

## 7. Acoustic & Sensory Feedback Tokens

| Sound Asset | Audio Character | Milliseconds | State Trigger | Confidence |
| :--- | :--- | :--- | :--- | :--- |
| `ping_1_open_blip.wav` | High-pitch ascending pop | ~80ms | Opening a conversation or starting agent turn | **HIGH** |
| `ping_2_tick.wav` | Ultra-subtle woodblock tick | ~40ms | Periodic heartbeat during reasoning & tool runs | **HIGH** |
| `ping_3_double_tick.wav` | Crisp double-click | ~90ms | Successful completion of an intermediate tool call | **HIGH** |
| `ping_4_chime_a.wav` | Soft resonant metallic bell | ~350ms | Agent turn successfully completed with response | **HIGH** |
| `ping_5_chime_b.wav` | Higher overtone bell | ~380ms | Background task / scheduled routine completion | **HIGH** |
