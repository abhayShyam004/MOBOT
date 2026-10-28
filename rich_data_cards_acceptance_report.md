# MOBOT — Universal Rich Data Cards & Sports Data Experience Acceptance Report
## Asset Completeness, Authentic Portraits & Crests, Embedded Table Scrolling & Physical Hardware Verification

**Date:** October 28, 2026  
**Status:** FULLY ACCEPTED & VERIFIED ON PHYSICAL HARDWARE  
**Hardware Device:** Samsung Galaxy A07 (`SM-A075F`, Serial: `R8YY90VT4EM`, Android 16, API 36, ARM64)  
**Target Package:** `com.openmausbot.companion.preview` (Port 18789, Node PID 1849, Preview App PID 8420)  
**Protected Production App:** `com.openmausbot.companion` (Port 18799, PID 29464 / 30021, strictly untouched and active)  

---

## 1. Verified Physical Hardware Evidence (Samsung Galaxy A07)

All evidence screenshots were captured live from the connected Samsung Galaxy A07 running `com.openmausbot.companion.preview`:

1. **Player Statistics Card with Authentic Portrait (Virat Kohli)**:  
   [`docs/verification/artifacts/player_stats_authentic_portrait.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/player_stats_authentic_portrait.png)  
   - Displays genuine photographic portrait of Virat Kohli cropped to a 44.dp circular avatar with high-contrast accent border.
   - Player name, team identity, role badge (`Batter`), and headline metric banner ("76 runs off 59 balls").
   - 4-column metric grid tiles (Runs: 76, Balls: 59, Fours: 6, Sixes: 2) and wide Strike Rate tile (128.81).
   - Full-width "Full Scorecard" action button and source attribution footer (`Source: Sky Sports ->`).
   - Graceful monogram fallback preserved for unphotographed players.

2. **Premier League 20-Team Standings with Embedded Internal Scrolling & Authentic Crests**:  
   - **Top View (Rows 1–9)**: [`docs/verification/artifacts/premier_league_embedded_scroll_top.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/premier_league_embedded_scroll_top.png)  
     - Bounded maximum height viewport (`280.dp`) keeping the chat conversation navigable.
     - **Stationary Column Headers**: `POS`, `TEAM`, `P`, `PTS` remain sticky at the top.
     - Authentic club crests for Liverpool, Arsenal, Manchester City, Chelsea, Newcastle United, Aston Villa.
     - Scroll affordance indicator: `Scroll for all 20 teams    1-20`.
     - External stationary footer: `View Full Table` button and `Source: Premier League Official ->` stay outside the scrollable area.
   - **Mid View (Rows 8–16)**: [`docs/verification/artifacts/premier_league_embedded_scroll_mid.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/premier_league_embedded_scroll_mid.png)  
     - Swiping inside the table scrolls rows smoothly to Brighton, Bournemouth, Brentford, Fulham, Crystal Palace, Everton, West Ham, Wolves, Manchester United (with authentic United crest).
     - Column header `POS TEAM P PTS` remains stationary above the rows.
   - **Bottom View (Rows 12–20)**: [`docs/verification/artifacts/premier_league_embedded_scroll_bottom.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/premier_league_embedded_scroll_bottom.png)  
     - Scrolled completely to row 20 (Southampton) with Tottenham Hotspur (authentic cockerel crest), Leicester, Ipswich.
     - Action button and source footer remain fixed and fully interactive.

3. **Asian Games Multi-Sport Medal Tally with Embedded Scrolling & Authentic Flags**:  
   [`docs/verification/artifacts/asian_games_medal_embedded_scroll.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/asian_games_medal_embedded_scroll.png)  
   - Bounded embedded scrollable container with stationary `POS NATION G S B TOT` column headers.
   - Authentic national flag assets across minimum-coverage nations: China (`flag_cn`), Japan (`flag_jp`), South Korea (`flag_kr`), India (`flag_in`), Uzbekistan (`flag_uz`), Iran (`flag_ir`), Thailand (`flag_th`), Kazakhstan (`flag_kz`), Hong Kong (`flag_hk`), Bahrain (`flag_bh`).
   - Scrolled smoothly to row 10 (Bahrain) inside the card without moving the chat list.
   - External stationary `View Full Medal Table` button and source attribution footer.

4. **Football Match Scorecard with Authentic Club Crests (Arsenal vs Manchester City)**:  
   [`docs/verification/artifacts/football_and_tennis_authentic_assets.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/football_and_tennis_authentic_assets.png)  
   - Tournament header (`FA COMMUNITY SHIELD 2026`) and `FULL-TIME` status pill badge.
   - Authentic Arsenal crest on the left; authentic Manchester City crest in full 22.dp resolution on the right.
   - Scoreline: `Arsenal 3 - 0 Manchester City`.
   - Goal events: 1', 28', 48' with interactive `[Summary]`, `[Stats]`, `[Events]` tabs.

5. **Tennis Match Scorecard with Player Portraits (Carlos Alcaraz vs Novak Djokovic)**:  
   [`docs/verification/artifacts/football_and_tennis_authentic_assets.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/football_and_tennis_authentic_assets.png)  
   - Tournament header (`WIMBLEDON 2024`, 14 July 2024) and `FINAL` status pill badge.
   - Authentic portrait photos of Carlos Alcaraz and Novak Djokovic.
   - Set scores: Carlos Alcaraz (3 sets) vs Novak Djokovic (0 sets).
   - Outcome banner: "Carlos Alcaraz won in straight sets".

6. **Cricket Match Scorecard with Authentic Flags (India vs New Zealand & India vs South Africa)**:  
   [`docs/verification/artifacts/cricket_scorecard_authentic_flags.png`](file:///run/media/abhay/Abhay/vsCODE/moblot/docs/verification/artifacts/cricket_scorecard_authentic_flags.png)  
   - India Tour of New Zealand: Authentic New Zealand flag asset (`flag_nz`) and authentic Indian Tiranga (`flag_in`).
   - T20 World Cup Final: Authentic South African rainbow flag asset (`flag_za`) and Indian Tiranga (`flag_in`).
   - Innings scores, overs, run rates, outcome banner ("India won by 7 runs"), and interactive tabs.

---

## 2. Technical Architecture & Solved Failure Modes

### 1. Authentic Player Portraits (`RichCardAssetResolver.kt`)
- **Previous state**: Player cards derived a circular badge containing initials (`VK`), ignoring genuine portraits.
- **Implemented solution**:
  - Implemented `RichCardAssetResolver` with 2-tier caching: in-memory `LruCache<String, ImageBitmap>(120)` and persistent disk cache in `context.cacheDir/rich_card_assets/`.
  - Added authentic bundled portraits in `res/drawable-nodpi/`:
    - `player_virat_kohli.png`
    - `player_sanju_samson.png`
    - `player_rohit_sharma.png`
    - `player_carlos_alcaraz.png`
    - `player_novak_djokovic.png`
  - Integrated `loadRemoteImage(context, avatarUrl)` with non-blocking coroutines on `Dispatchers.IO` and timeout safeguards.
  - Fallback logic: Remote URL -> Bundled portrait -> Monogram initials badge with team color.

### 2. Reliable Flags & Team Crests (Elimination of Unicode Regional Indicators)
- **Previous state**: Country flags were computed via `isoToFlag()` using Unicode regional-indicator characters (`0x1F1E6`), which frequently rendered as two-letter country codes (e.g. `IN`) or caused font rendering errors. Team logos were absent.
- **Implemented solution**:
  - Deleted `isoToFlag()` completely, removing all regional indicator characters.
  - Added authentic bundled national flags in `res/drawable-nodpi/` covering the minimum-coverage set:
    - India (`flag_in`), New Zealand (`flag_nz`), South Africa (`flag_za`), China (`flag_cn`), Japan (`flag_jp`), South Korea (`flag_kr`), Uzbekistan (`flag_uz`), Iran (`flag_ir`), Thailand (`flag_th`), Kazakhstan (`flag_kz`), Hong Kong (`flag_hk`), Bahrain (`flag_bh`), United States (`flag_us`), Great Britain (`flag_gb`), Australia (`flag_au`), Spain (`flag_es`), Italy (`flag_it`).
    - Plus 19 additional nations: DE, FR, AR, BR, PK, LK, BD, AF, NL, CA, JM, KE, ET, NO, SE, CH, PT, BE, AT.
  - Added authentic bundled club crests:
    - Football: Arsenal, Manchester City, Liverpool, Chelsea, Manchester United, Tottenham Hotspur, Newcastle United, Aston Villa, Real Madrid, Barcelona.
    - Cricket: BCCI, CSK, MI.
  - Added diagnostic fallback with country/team abbreviations and diagnostic logging (`Log.d` / `Log.w`) for unmapped entries.

### 3. Embedded Vertical Table Scrolling with Stationary Headers
- **Previous state**: Standings and medal tables expanded indefinitely down the chat, creating huge messages that required scrolling past several screens.
- **Implemented solution**:
  - Implemented embedded vertical scrolling in `StandingsTableRenderer` and `MedalTallyRenderer`:
    - Tables with > 7 rows are bounded by `Modifier.heightIn(max = 280.dp).verticalScroll(vScrollState)`.
    - Column headers (`POS TEAM P PTS` / `POS NATION G S B TOT`) remain STATIONARY above the scrolling rows container.
    - Both header and rows container share horizontal scrolling coordination when table width exceeds screen width.
    - Added scroll affordance badges (`Scroll for all N teams/nations    1-N`).
    - Stationary action button ("View Full Table") and source attribution footers remain outside the scrolling container at the bottom.
    - Nested scroll propagation allows natural chat scrolling when swiping outside or past the table bounds.

---

## 3. Automated Test Suite Verification

### 1. Android Unit Tests (`./gradlew :app:testDebugUnitTest`)
- `RichCardAssetResolverTest`:
  - `verifySeventeenMinimumCoverageNationsFlags`: PASSED (all 17 countries + IOC/ISO codes).
  - `verifyPlayerPortraitsResolution`: PASSED (Virat Kohli, Sanju Samson, Rohit Sharma, Carlos Alcaraz, Novak Djokovic).
  - `verifyClubLogosResolution`: PASSED (Arsenal, Man City, Liverpool, Chelsea, Man Utd, Tottenham, Newcastle, Aston Villa, Real Madrid, Barcelona, CSK, MI, BCCI).
  - `verifyNationalTeamClubLogoFallbackToFlag`: PASSED.
- `NoEmojiRegressionTest`:
  - `verifyNoEmojisInProductionAndroidCode`: PASSED (0 emojis across all Kotlin/Java production sources).
  - `verifyNoEmojisInAndroidXmlResources`: PASSED (0 emojis across all XML resources).
  - `verifyStripEmojisSanitizesFlagsAndEmoticons`: PASSED.

### 2. Server Unit Tests (`npx vitest run server/rich-data-cards.test.ts`)
- **25 of 25 tests PASSED**:
  - All 24 preexisting scenarios passed.
  - Scenario 25 added and passed: Asset completeness (`avatarUrl`, `logoUrl`, `flagUrl`) and embedded table scrolling preservation through extraction, sanitization, and persistence.

---

## 4. Protected Environment Integrity
- **Production app**: `com.openmausbot.companion` (Port 18799, PID `30021`) running untouched.
- **Release tag**: `v1.1.2` untouched.
- **Zero-emoji policy**: Strictly maintained.
