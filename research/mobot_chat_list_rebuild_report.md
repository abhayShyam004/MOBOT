# MOBOT — Chat List Screen Rebuild Report
**Target**: Grok Bot Chat-List Screen Specification (`Minimalist Messaging Inbox Screen.png`)  
**Hardware Verified**: Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`, Android 16 / API 36)  
**Date**: October 14, 2026

---

## 1. Executive Summary

The MOBOT Chat-List / Home screen has been redesigned and rebuilt from the ground up to match the visual specification of the Grok minimalist messaging inbox. 

The previous layout suffered from visual fragmentation: a decorative green fan backdrop, an obstructive "RosterHero" banner card, horizontal group carousels ("GroupsStrip"), collapsible multi-level thread accordions, and section headers that divided conversations.

The new implementation provides a unified, continuous inbox matching the Grok specification:
- **Clean Header**: Left 38dp circular "PC" profile button, open center whitespace, top-right Search and Add icons.
- **Row Anatomy**: 52dp animated mascot avatars, 16dp spacing, bold 17.5sp bot names, rounded role/member pills, 14.5sp single-line message previews, right-aligned 12.5sp timestamps, and 8.5dp vibrant blue unread dots.
- **Unified Flow**: Single vertical scroll of all conversations (pinned, unread, recent) without card boundaries or table divider lines.
- **Inline Search**: Seamless search field with clear and cancel interactions, real-time message and thread matching.
- **Real Data & Hardware**: All 11 live bots/channels hydrated from the embedded Node host, verified on the physical Samsung Galaxy A07 device in both Light and Dark themes.

---

## 2. Structural & Visual Transformations

| Surface Element | Previous MOBOT UI | New Grok Specification Implementation |
| :--- | :--- | :--- |
| **Top Header** | "MOBOT" text label + App mark + 3-dots overflow button | 38dp circular "PC" badge on left, pure whitespace center, Search + Add glyphs on right |
| **Backdrop** | `DecorativeBackdrop` (large green fan/discs across top) | Clean solid canvas (`AppTheme.colors.background`) |
| **Hero Banner** | `RosterHero` card ("11 bots • 0 working") | Removed; chat rows begin immediately beneath the header |
| **Row Anatomy** | 46dp avatar, cramped text, card dividers | 52dp avatar, 16dp spacing, 17.5sp bold title + pill, 14.5sp preview, 12.5sp timestamp |
| **Row Separation** | Hairline rules / bordered cards | Clean whitespace separation (20dp horizontal, 13dp vertical padding) |
| **Thread Grouping** | Collapsible `BotThreadTree` accordions under every bot | Pure uninterrupted single-row inbox; bot details accessible via tap / overview |
| **Channels / Groups** | Horizontal scrollable tiles strip (`GroupsStrip`) | Unified as chat rows in the single vertical conversation inbox |
| **Search Mode** | Floating bottom bar / modal sheet | Inline search bar in header with clear button and "Cancel" action |
| **Unread State** | Small inline dot | Vibrant electric blue (`0xFF1D9BF0`) 8.5dp status dot at bottom-right |

---

## 3. Key Files Modified

1. **`android/app/src/main/kotlin/com/openmausbot/companion/ui/AppDesign.kt`**:
   - Updated `AppSizes.rowAvatar` from `46.dp` to `52.dp`.
2. **`android/app/src/main/kotlin/com/openmausbot/companion/ui/AppComponents.kt`**:
   - Rebuilt `BotRow` with 52dp avatar, 16dp horizontal spacing, 17.5sp bold title, `RoleChip` badge, 14.5sp preview, 12.5sp timestamp, and 8.5dp Grok electric blue unread indicator.
   - Refined `RoleChip` with 8dp rounded corners, subtle fill, and crisp typography.
3. **`android/app/src/main/kotlin/com/openmausbot/companion/ui/RosterScreen.kt`**:
   - Replaced fragmented section items with unified `items(summaries)` in `LazyColumn`.
   - Rebuilt `RosterHeader` with 38dp "PC" profile circle, whitespace spacer, search, and add actions.
   - Embedded companion feature menu (Mascot Studio, Universal Search, etc.) into long-press on "PC" and Settings.
   - Removed `DecorativeBackdrop`, `RosterHero`, and `GroupsStrip` from the main inbox flow.

---

## 4. Hardware Verification & Ground Truth

All changes were compiled, assembled, installed, and verified on the connected physical device:
- **Device**: Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`, Android 16 / API 36).
- **Unit Tests**: `./gradlew testDebugUnitTest` passed (31 actionable tasks, BUILD SUCCESSFUL).
- **Compilation**: `./gradlew :app:assembleDebug` passed; `app-arm64-v8a-debug.apk` installed cleanly.
- **Device Screenshots**:
  - `research/screen_grok_final_light.png`: Verified light mode inbox composition, avatar fidelity, row alignment, typography, and spacing.
  - `research/screen_grok_chat_list_dark.png`: Verified dark mode with pitch neutral ground, high-contrast typography, and glowing mascots.
  - `research/screen_grok_search_active.png`: Verified inline search header with autofocus and cancel action.
  - `research/screen_grok_search_vega.png`: Verified search filtering against live message hits and threads.
  - `research/screen_grok_chat_panko.png`: Verified opening chat rows into full conversation views with active agents.
