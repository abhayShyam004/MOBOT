# Voluntary structured questions on Android (`ask_user`)

The agent may stop mid-task at a real decision point, put a structured
question on the phone, and continue the **same** task with the answer. The
task genuinely enters `waiting-on-you`; no work is dispatched while the
question is open; the question survives the app being backgrounded, rotated
and recreated; and the answer resumes the turn that asked it, exactly once.

This is a device-verification record, not a `control-omb` recipe: the feature
lives in the Android app and its only control surface is the host the harness
`adb` already reaches on `127.0.0.1:18799`. The phone is the fixture. Nothing
here pairs to the person's desktop, and the driver never writes the person's
own provider settings (it adds and removes a provider instance of its own).

## Build and install

```sh
pnpm build:server                              # compile the host bundle
node scripts/prepare-android-host.mjs          # prints the bundle sha256
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.openmausbot.companion/.MainActivity
adb forward tcp:28799 tcp:18799 && curl -s http://127.0.0.1:28799/api/health
```

The app re-extracts the server bundle when the packaged asset's SHA-256
changes (`HostFiles.serverAssetStamp`), so a reinstall with a new bundle is
enough — no data wipe, and no chance of testing yesterday's server.

## Automated checks

```sh
npx tsc -p tsconfig.server.json
npx oxlint --deny-warnings shared/ask-question.ts server/index.ts server/permission-proxy.ts \
  server/system-prompt.ts server/drivers/openai-chat.ts server/drivers/anthropic-compat.ts \
  server/drivers/codex-native-runtime.ts server/drivers/claude.ts
npx vitest run --no-file-parallelism shared/ask-question.test.ts \
  server/drivers/openai-chat-tools.test.ts server/permission-proxy.test.ts \
  server/auto-approve.test.ts server/system-prompt.test.ts server/index.test.ts
cd android && ./gradlew :app:testDebugUnitTest :core:test
```

`shared/ask-question.test.ts` is the source of truth for the schema and the
rules: v1 payloads parse byte-for-byte as they always did, v2 adds the typed
fields, and `validateQuestionAnswer` / `answerIdsByQuestion` cover the answer
side. `server/drivers/openai-chat-tools.test.ts` drives a typed ask through the
real runtime and asserts the card the person would see, then that the answer
resumes the *same* turn. The Android suites pin the Kotlin mirror of those
rules and the card's own decisions.

## Device driver

```sh
node scripts/test-android-ask-user.mjs android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk --mock
```

`scripts/omb-openai-mock.cjs` gains four ask cues (`cue-ask-single`,
`cue-ask-multi`, `cue-ask-confirm`, `cue-ask-free`); each scripts one typed
`ask_user` call from the deterministic mock the phone runs itself. The driver
sends the cue, waits for the card, answers it over `POST
/api/threads/:id/respond` — the exact route the Compose card calls — and the
mock then replies `DONE <answer text>`, which only happens if the same turn
resumed with the answer in hand.

It also taps the real screen: it finds the bot's row in the roster, opens the
thread, reads the card out of `uiautomator dump`, taps **Confirm**, taps
**Submit answer**, and asserts the tap's choice comes back on the resumed turn.

The fixture provider is created with `POST /api/instances` and removed with
`DELETE /api/instances/:id`, so the person's own `openaiCompat` endpoint and
key are only ever read. The driver asserts that URL is unchanged at the end.

## Protocol and schema

`shared/ask-question.ts` owns the wire shape; the Kotlin (`AskQuestionRules`)
and Swift twins mirror it.

- Types: `single_choice`, `multiple_choice`, `confirmation`, `free_text`.
  Absent means derive, so a v1 payload keeps meaning exactly what it meant.
- Stable ids: every option carries an `id`. The model's own id is slugged and
  kept; when it sends none the id is derived from the label, and a collision is
  suffixed (`apple`, `apple_2`). `other` is reserved for the card's built-in
  free-text row and can never be claimed by an option; a confirmation's pair is
  `confirmed` / `declined`.
- Bounds: `minSelections` / `maxSelections` are kept only when the model
  actually sent them (clamped to 0–12 and 1–12, `min ≤ max`), so an absent
  bound keeps meaning the rule's default rather than being quoted back as a
  decision the model never made.
- `required: false` lets the task continue without an answer; it is the
  stronger signal and overrides an explicit `minSelections`.
- `allowOther: false` removes the free-text row from a choice question.
- A confirmation carries its own two rows, so an answer cites the same ids
  everywhere and no `Other` row appears over a yes/no.
- A question with no options is still answerable and parses to `free_text`.

The answer that reaches the model is text (`Q: … A: …` blocks under "The user
answered your questions."), and `answerIdsByQuestion` decodes it back to the
ids. Nothing raw is ever shown to the person: the card renders question,
options, descriptions and tabs.

## Server and harness changes

- `server/index.ts` builds `turnTools = [...turnFileTools, askUserTool]`. The
  `ask_user` tool's `inputSchema` is the v2 one (question, type enum, option
  objects with `id`/`label`/`description`, bounds, `required`, `allowOther`)
  and its description carries the voluntary-use grounds and the anti-abuse
  list. Its `execute` is a canned error: the real path is the driver's.
- The driver special-case in `openai-chat.ts`, `anthropic-compat.ts` and
  `codex-native-runtime.ts` matches `ask_user` **by name first**, normalizes
  the arguments with `normalizeAskUserInput` (structured, flat v1, or flat with
  v2 fields), then blocks on `approval.askQuestion(...)`. The person's words
  become the tool result, so the same turn continues. Each branch marks the
  call handled, so a question can never fall through to a permission card —
  including when `ask_user` is not in the turn's harness tools.
- `server/permission-proxy.ts` (Claude CLI) normalizes once and forwards the
  structured questions beside the flat fields, for `ask_user` and for the
  CLI's own `AskUserQuestion` via the `approve` tool.
- `server/system-prompt.ts` gains `ASK_PROMPT`: when to ask, that the answer
  continues the same task, and the line that asking for permission is the
  separate permission system. It is wired into the preview, a dispatched turn
  and a room turn, so "what the model sees" stays the same bytes as what it
  receives.
- `server/auto-approve.ts` keeps `ask_user` / `AskUserQuestion` in
  `ASKS_A_PERSON`, so Full access never answers a question.
- The fold turns `request.opened` with `questions` into a card carrying
  `questionRequest` (`{version: 1, questions}`); the answered card keeps
  `answeredText`, and an answer that cannot be delivered closes the card with
  `answered: "unavailable"` and a reason instead of silently reporting success.

## Android and Compose

- `android/core/.../AskQuestion.kt` mirrors the schema (option `id`, `type`,
  bounds, `required`, `allowOther`) and adds `AskQuestionRules`: `type`,
  `allowsOther`, `maxSelections`, `minSelections`, `resolvedOptionIds`,
  `optionIds` and `validate`. The card reads its whole shape from these, never
  from the raw optional fields.
- `android/app/.../ui/QuestionCard.kt` draws a tab per question, a radio group
  for `single_choice`, checkboxes with the model's min/max for
  `multiple_choice`, the Confirm/Cancel pair for `confirmation`, a field for
  `free_text`, and an `Other` row that reveals its own field. Picks are tracked
  by option **id**; the card renders the labels the person saw and builds the
  answer with `AskQuestionAnswer.format`, so an answer given here is the same
  bytes the Mac would send. Submit stays disabled until every question passes
  the same validation the server applies.
- `Session.answer` sends `behavior: "answer"` with the text; the server never
  treats it as authorization, and no decision row is written for it.

## Persistence and the state machine

- Opening the card sets the task to `waiting-on-you` and notifies; the turn is
  blocked on the approval contract with no timeout, so it resumes when answered
  or settles unanswered when the turn is stopped or closed.
- The card is a durable transcript message: backgrounding the app, rotating the
  device and recreating the activity leave it in place and still answerable,
  and the resumed turn carries the answer.
- Answering the same request twice is refused (`the approval card was already
  answered`) rather than replayed, so a task resumes exactly once.
- A force-stop is a process kill: the card is still shown afterwards, and a
  late answer reports `the request is no longer open on its provider turn` and
  settles the card, rather than pretending the turn resumed.

## Prompt and model instructions

The voluntary-use grounds live where the model actually reads them: the
`ask_user` tool description (harness and permission proxy) and `ASK_PROMPT` in
the system prompt. Both say the same thing — ask only when different answers
would materially change the work; never ask what you can find out yourself,
never ask for permission to act, never ask trivia; prefer one well-formed typed
question; and the answer continues the same task.

## What a voluntary ask looks like, and what must not be one

**A voluntary ask.** "Set up a local index for my project notes" — the notes
do not say whether the person wants one file they can grep or a store they can
query, and the choice shapes every later step, so the bot stops mid-task and
asks one typed question:

> Which local cache should the new index use?
>
> ◉ **SQLite** — One file, no server; matches the rest of the app.
> ○ **LevelDB** — Key-value store; faster writes, less queryable.
> ○ Other — type your own answer

The task is now `waiting-on-you`; nothing is dispatched while the card is
open. Picking SQLite sends `Q: Which local cache should the new index use?\nA:
SQLite` as the tool's own result, and the SAME task continues — which on the
device read back as the resumed reply ending in `A: SQLite`.

**A correct non-ask.** The same bot, told "Reply with exactly: pong", settles
with no card at all: an ordinary turn that needed no decision raised zero
question cards, and the driver asserts that (`an ordinary turn settles with no
question card — cards=0`). So did every one of the fixture's tool turns, which
execute without stopping to ask whether they may.

**What must not be one.** "May I create the index file?" is not a question for
this tool — that is a permission, and it belongs to the permission system,
never to `ask_user`. The same for anything the bot could find out itself (what
a file is named, what a command returned) and for trivia. The tool
description and `ASK_PROMPT` both draw that line; the device pass proves the
mechanism does not put a permission card behind a question, not that a live
model's judgement is good.

## Recorded pass — 2026-10-07, SM-A075F (arm64-v8a, API 36)

Bundle `android/app/src/main/assets/host/server.zip` sha256
`c019f8362059a110d383434d666d65c437dc9c3ee888b774d7612291bea9ae95`; debug APK
`app-arm64-v8a-debug.apk` 72,610,627 bytes.

Automated: `tsc -p tsconfig.server.json` clean; `oxlint --deny-warnings` 0
warnings and 0 errors over the edited TypeScript files. TypeScript 385 tests
across the ask-user suites — shared 45, openai-chat-tools 57,
anthropic-compat 4, codex-native-runtime 7, permission-proxy 11, auto-approve
17, system-prompt 15, and index 229 with the new prompt section. Android:
`:app` 1015 tests over 122 files and `:core` 563 over 52, with 0 failures, 0
errors and 0 skipped.

On the phone, `scripts/test-android-ask-user.mjs` finished **53 checks, 0
failures**:

- A bot created on the device's own host, with a fixture provider instance of
  the driver's own (`api-ask-user-device-fixture`, created `201`, removed
  `200`); the person's own `openaiCompat` URL read back unchanged.
- An ordinary turn settled with **no** question card.
- All four types reached the transcript as typed cards with stable ids:

  ```
  type=single_choice    options=[{id:sqlite,label:SQLite},{id:leveldb,label:LevelDB}]
  type=multiple_choice  options=[{id:openai…},{id:qwen…},{id:google…}] min=1 max=2 allowOther=false
  type=confirmation     options=[{id:confirmed,label:Confirm},{id:declined,label:Cancel}]
  type=free_text        options=[]
  ```

  The server synthesised the confirmation pair and the bounds survived the
  wire exactly as the model sent them; `allowOther` is absent where it was
  never set, so the card's default (a free-text row) is what applied.
- Each ask was answered over `POST /api/threads/:id/respond`, and the mock's
  next reply was `DONE <answer text>` — `A: SQLite`, `A: OpenAI, Qwen`,
  `A: The user confirmed.`, `A: Retry with exponential backoff and jitter.` —
  which only happens if the SAME turn resumed with the answer in hand. Every
  settled card kept its `answeredText`.
- With a card open, the app was sent HOME, rotated to landscape and back, and
  brought to the front: the card was still in the transcript, still answerable,
  and the same task resumed with the post-rotation answer. A second answer to
  the same request was refused — `the approval card was already answered` —
  rather than replayed.
- After `am force-stop` and a relaunch the durable card was still shown; a
  late answer reported `the request is no longer open on its provider turn`
  and the card settled as `answered=unavailable` instead of staying live.
- The Compose card was driven on the phone's screen: the bot's row was tapped
  in the roster, the question text and the Confirm/Cancel rows were read out of
  `uiautomator dump`, **Confirm** and then **Submit answer** were tapped, and
  the tap's own choice came back on the resumed turn.
- Exactly one host process before and after the restart.
- The device was left clean: no test bot, no fixture instance, no mock file,
  and the person's provider settings untouched.

## Defects this pass found and fixed

- `item.started` was emitted **twice** for every `ask_user` and harness-tool
  call in `openai-chat.ts` (the branch emitted it, then the permission path
  emitted it again). All three chat drivers now settle the call in one branch
  with a single, guarded emit.
- A question could become a permission card: the branch only avoided the
  permission path because `ask_user` happened to be listed in `turnTools`.
  Matching by name first, and marking the call handled, removes that coupling.
- A required `confirmation` validated as complete with nothing picked, so the
  submit button was live while `send()` silently did nothing. A required yes/no
  now demands one of its two answers.
- The device mock matched a cue anywhere in the last user message. A turn whose
  provider session was not resumed arrives as a whole-thread replay ending in
  the new request, so an *earlier* cue's words were still in the text and the
  mock answered the wrong question. The latest mention now wins.
- The driver itself: a predicate read `card.card.answered` on an already-unwrapped
  card, and it pointed the person's shared `openaiCompat` setting at the mock.
  It now uses its own provider instance and asserts the person's URL is
  untouched.

## What this does not prove

- Only `arm64-v8a` was installed; `armeabi-v7a` and `x86_64` are built but
  never run.
- The device driver answers over the HTTP route the card calls, and taps the
  real screen for one confirmation question. The other three types were driven
  through the route, not by a finger; their Compose rendering is pinned by
  `QuestionCardRulesTest` and shares the same components.
- Rotation was applied with `settings put system user_rotation` and the
  accelerometer override, not by physically turning the phone.
- The mock stands in for the paid provider. It proves the harness, the card,
  the answer round trip and the resume; it does not prove that a particular
  live model chooses to ask well. That judgement is the prompt's and the tool
  description's, and is measured separately against real, configured models in
  [android-ask-user-real.md](android-ask-user-real.md).
- The desktop (`src/components/QuestionCard.tsx`) and iOS
  (`ios/App/Cards/QuestionCardView.swift`) cards still render the v1 shape:
  they show the model's rows and a free-text field, but do not enforce v2
  selection bounds or confirmations. The server always sends v2 rows
  (a confirmation arrives with its Confirm/Cancel pair), so nothing is
  unanswerable there — it is less strict, not broken.
