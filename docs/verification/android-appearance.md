# Android name, provider marks, memory editing, and backgrounds

One pass over five user-facing changes to the standalone Android app:

- the app is named **MOBOT** wherever it speaks about itself,
- a provider is named by its real logo instead of a letter,
- the roster's opening line no longer states the date and time,
- a bot's memory is edited in a multi-line field instead of one line,
- bot settings states the provider and the model it is on, and only that
  provider's models are offered while choosing,
- a whole-app background is chosen once in Settings.

This is a device record, not a `control-omb` recipe: every screen below lives in
the Android app, and the only control surface is the harness `adb` reaches on
the phone. Nothing here writes to the desktop app or to the person's bots.

## Build and regression checks

From `android/`:

```sh
./gradlew :core:test :app:testDebugUnitTest :app:assemblePreview
```

1051 app unit tests across 127 classes passed, with no failures, errors or
skips, on the tree that produced the screenshots below — including
`ModelSelectorTest` (the models of the chosen provider, and only those),
`RosterHeroTest` (the greeting and the fleet line) and `ProfileRulesTest`. The
`:core` suite was unchanged and up to date.

The installed label is checked from the artifact rather than from the source
string it comes from:

```sh
/home/abhay/android-sdk/build-tools/37.0.0/aapt2 dump badging \
  app/build/outputs/apk/preview/app-arm64-v8a-preview.apk | grep application-label
application-label:'MOBOT Preview'
```

The Preview flavor appends its own suffix, so the released build's label is
`MOBOT`; both come from `app/src/main/res/values/strings.xml`.

## Device checks

Preview APK installed on a physical arm64 phone, paired to a disposable
workspace. Every capture asserts the resumed activity is the preview build
first — the phone also carries the released app, paired to the same desktop
and drawing the same bots, so a screenshot of the wrong app looks like a valid
result. Screenshots and the accessibility-tree dumps they were read against are
in `.omb-scratch/verify/` (scratch, not committed).

1. **Roster opening line.** The hero is `Good evening` → `New bot` → `7 bots ·
   all quiet`, with no date row between them. The released build installed on
   the same phone still shows `08.10 THU` in that position, which is the
   before-state: the change is only on the new build until it is installed.
   The roster rows keep their own relative stamps (`17:19`, `Tuesday`); those
   are the rows' timestamps, not the page's.
2. **Memory.** `Bot settings → Memory` shows `6/200 lines loaded`, the
   explanatory copy, and a field 396 px tall carrying six wrapped lines of
   `MEMORY.md`, with `Save` disabled until the draft differs. The same screen
   used to draw the whole file inside one line's height.
3. **Provider marks, second pass — who has earned one.** The first pass drew a
   mark wherever a provider's name or driver mentioned a brand, which put
   OpenRouter's mark on an endpoint someone had named
   `OpenAI-compatible (OpenRouter / Groq)` and OpenAI's on a gateway named
   `Test gateway`: both are a URL and a key, and the covers implied an
   integration this host does not have. The rule is now the driver alone —
   `claudeAgent`, `codex`, `grokAgent`, `cursorAgent`, `qwenAgent`,
   `antigravityAgent` name a company's own engine, while `openai-compat` and
   `anthropic-compat` name a protocol every gateway speaks and earn nothing.
   On the phone, Model providers now shows `O` and `T` on the two API
   endpoints, `Grok` keeps xAI's mark, and `Kimi` — a real engine with no
   bundled mark — keeps its letter, which is the honest split. Pinned by
   `ProviderLogoTest` (4 cases) rather than by eye.
4. **Bot settings, provider and model.** The `Model` section states the engine
   (`OpenAI-compatible (OpenRouter / Groq)`) with the caption `Select provider`
   and, under it, the model with `Select model`; the dropdown that listed every
   engine is gone. `Apply model` stays disabled until the draft differs.
5. **Model scope.** `Select model` reads `The model that answers for Ziggy on
   OpenAI-compatible (OpenRouter / Groq)` and lists one flat catalog — this
   router's own models, including the vendor-named ones it carries — with no
   "Other models" section and no provider named on any row.
6. **Backgrounds.** Settings → Background shows a scrollable strip of portrait
   swatches: None plus Spring, Waves, Garden, Dreamscape, Lavender, Sakura.
   Choosing Waves repainted Settings immediately, and the roster, a chat and
   the memory screen all drew the same picture edge to edge behind the status
   bar. Choosing None gave back the app's own page: the screenshot's own pixels
   are a uniform `(18, 19, 17)` at the top-right corner and mid-page, against
   `(83, 78, 75)` with Sakura chosen, so nothing of the removed picture is left
   behind and no screen falls through to black. Choosing Sakura again restored
   the previous choice, which is what the phone was left on. The choice
   persists in `openmaus.appearance`/`background` and is read at the root of the
   composition, so no screen can be on a different background.

7. **Dark theme contrast.** Text that states no colour of its own inherits
   Compose's `LocalContentColor`, whose default is black; the app's own
   grounds — a speech bubble, a transcript chip, the page itself — are not
   Material surfaces, so nothing had replaced it. On the light theme that read
   as the design (black type on a white bubble); after dark it was black type
   on a near-black bubble. `CompanionTheme` now states the page's ink once, and
   the same chat measured from the screenshots before and after:

   | element | ground | text before | text now |
   |---|---|---|---|
   | bot message bubble | `(27,28,25)` | `(0,0,0)` — 1.05:1 | `(241,242,237)` — 15.6:1 |
   | my message bubble | `(43,55,48)` | `(233,242,236)` — correct | unchanged |
   | `Ran 2 steps` chip | `(92,88,85)` | `(0,0,0)` | `(241,242,237)` |
   | quick-reply chip | `(37,39,32)` | `(37,39,32)` — invisible | `(165,168,161)` |

   Ratios are WCAG relative luminance of the sampled pixels, not a design
   tool's numbers: they are here because "barely visible" was the report and
   one of these lines measured as no contrast at all. The light theme was then
   walked for the same screen — bubble ground `(255,255,255)`, ink
   `(23,24,26)`, which is the token the theme states rather than Compose's
   black and reads the same — and the phone was left on the dark theme and the
   Sakura wallpaper it was found with (`openmaus.appearance.xml`:
   `theme=dark`, `background=sakura`).

## What this does not establish

- The letter fallback was not exercised on the device: every provider in this
  workspace matched a bundled mark. It is covered by reading the code path, not
  by a screenshot.
- Matching is by substring over a provider's display name, instance id and
  driver, so a gateway on the generic `openai-compatible` driver takes OpenAI's
  mark unless its own name says otherwise. On this phone "Test gateway" did.
  That is the deliberate trade-off in `ProviderLogo`: a named brand is worth
  guessing, and the alternative is the letter the person complained about.
- The wallpaper scrim's own values (`WALLPAPER_SCRIM`,
  `WALLPAPER_SCRIM_DARK`) were not compared across themes beyond the flat-page
  measurement above; the contrast fix was measured on one chat screen per
  theme, not on every screen that draws its own ground.
- No pairing, reconnection, notification or provider sign-in flow was
  re-tested here; those have their own records.
- The desktop app is still named OpenMausBot (installer, package name, README).
  Only the Android app was renamed.
