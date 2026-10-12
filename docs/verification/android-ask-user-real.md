# Does the model ask on its own? (real models, Android)

[android-ask-user.md](android-ask-user.md) proves the **mechanism**: a typed
question card, all four types, stable option ids, bounds validation, the answer
resuming the same task exactly once, and a card that survives backgrounding,
rotation and its own process. Every one of those passes runs against
`scripts/omb-openai-mock.cjs`, whose `cue-ask-*` cues make the call
deterministic — so that record proves the harness, the card and the resume, and
says so in its own "What this does not prove".

This record measures the remaining question: **does a real, configured model
voluntarily reach for `ask_user` when a decision materially changes the work,
and leave it alone when it does not?** No mock, no cue, no hardcoded trigger.
The tasks are ordinary sentences; the model decides.

## Where the evidence comes from

Two real authenticated provider instances on the phone, both the person's own,
plus a throwaway bot per leg that the driver creates and deletes. No provider
configuration is written — the driver reads the catalog and points *its own*
bot at the instance.

| Leg | Instance | Driver | Model driven | Catalog |
| --- | --- | --- | --- | --- |
| `openrouter` | `openaiCompat` | `openai-compat` | `meta-llama/llama-3.3-70b-instruct` | 465 options after `refresh-models` |
| `codex` | `codex` | `codex` | `gpt-5.6-luna` | 7 options |

## The driver

```sh
node scripts/test-android-ask-user-real.mjs \
  android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk \
  --model meta-llama/llama-3.3-70b-instruct --codex-model gpt-5.6-luna \
  --out /tmp/omb-real-ask3.json
```

The driver installs the build, refreshes the instance catalog, **refuses to run
if the requested model is not the one it asked for** (an earlier version silently
ran the instance default), then for each case:

- sends one plain sentence and watches the real turn;
- auto-allows *permission* cards (`tool` set) so real work can proceed, and
  leaves *question* cards (`questionRequest` set) untouched — that distinction
  is itself checked (`the card is a typed question, not a permission`);
- checks the turn is **paused** while the question is open: 12 s with no new
  transcript row of any kind and the card still open;
- answers the question over `POST /api/threads/:id/respond` — the same route the
  Compose card calls — or by tapping the card on the phone's screen for one case;
- reads everything the bot says after the card until it stops growing, and asks
  whether that work used the answer: verbatim for a choice, and for a written
  answer the distinctive words of what was typed (a paraphrase still counts);
- asserts exactly one resume: the card keeps its `answeredText` and is not
  dismissed.

A `SHOULD NOT ASK` case only counts when the model **actually produced work**.
A silent turn is a stalled provider, not restraint, and fails the check — the
first version of this driver scored empty turns as restraint and had to be
fixed when a leg turned out to be answering nothing at all.

It also reads the live server's own assembled prompt for its bot
(`GET /api/bots/:id/system-prompt`) and records only the section `id`, `label`
and byte count: the native driver log deliberately records no prompt text, so a
structural check is the honest one.

## Recorded pass — 2026-10-07, SM-A075F (arm64-v8a, API 36)

Bundle `android/app/src/main/assets/host/server.zip` sha256
`d808f45ef691e89237cc2bba4582ddac1c5295e5313f48b77dc7df6530308cbb` (10,173,145
bytes); debug APK `app-arm64-v8a-debug.apk` 72,611,144 bytes sha256
`9b9ec609dfe86b398fab13ebe75c0852980cfb56422579ce2e4efe19bde8acb0`. Device
serial `R8YY90VT4EM`.

The evidence below comes from these runs against that one build on that one
device — **run A**, the first pass over both legs (its OpenRouter model,
`google/gemini-2.5-flash`, turned out to stall on every case); **run B**, both
legs again with `meta-llama/llama-3.3-70b-instruct` in that slot; and **run C**,
a targeted repeat (`--legs openrouter --only should-ask-ux,multi
--skip-install`) of the case the earlier runs disagreed on. Every run used the
same bundle and APK.

Both legs read back the same prompt shape: **10 sections, the `ask` section
("Questions") 867 bytes**. That is the strengthened instruction set — the
previous bundle's section was 707 bytes — so the clause the model is judged on
is provably in the prompt it received.

### SHOULD ASK — the model called `ask_user` on its own

**1. run B — `openrouter` / `meta-llama/llama-3.3-70b-instruct`.** Task: *"Design the
settings screen for provider authentication."* The model stopped and asked a
typed `single_choice`:

> **What kind of authentication providers would you like to add?**
>
> ○ Google  ○ Facebook  ○ Other

The person answered **Google**. The turn had been paused with nothing else
dispatched, and the SAME task resumed and used it:

> Based on the user's answer, I will design a settings screen for provider
> authentication that includes Google authentication. The settings screen will
> have the following features: * A list of available authentication providers,
> including Google * A button to add a new authentication provider * A section
> to configure the Google authentication settings, including client ID, client
> secret, and redis…

**2. run B — `codex` / `gpt-5.6-luna`.** Task: *"Set up my note-taking workflow. Two
decisions are yours to get from me rather than guess: how notes should be named,
and where drafts should live."* The model asked a `free_text` question carrying
both decisions:

> **What naming convention should notes use, and which folder should hold
> drafts (for example, `YYYY-MM-DD — Title` and `drafts/`)?**

The person answered *"Prefix each note with the date as YYYY-MM-DD, and keep
drafts in a drafts folder next to them."* The resumed turn used it:

> Your note-taking workflow is already set up and matches your choices: -
> **Naming:** `YYYY-MM-DD-title.md`, using a date prefix and a
> short hyphen-separated title. - **Finalized notes:** … - **Drafts:** …

**3. run C — `openrouter` / `meta-llama/llama-3.3-70b-instruct`, same case text
as #2.** The same model asked a narrower question —
*"How would you like your notes to be named?"* — and the resumed turn began
*"I'll name each note with the date as YYYY-MM-DD, and keep drafts in a drafts
folder next to them."*

**4. run A — `codex` / `gpt-5.6-luna`, same case text as #1.** The model asked a
typed `single_choice` instead:

> **What format should I design the provider-authentication settings screen in?**
>
> ○ Visual mockup  ○ Implemented UI  ○ UX specification

Answered **Visual mockup**, and the resumed turn began *"Created a polished
visual mockup for a **Provider Authentication** settings screen. **Included:**
- Workspace navigation sidebar - Connected provider list for Google Workspace,
Git…"*

So two different providers, two different models, both voluntarily asked, and
each resumed the same task with the person's answer in hand. In every case the
card was a typed question rather than a permission, the turn was verifiably
paused while it was open, and exactly one resume happened.

### SHOULD NOT ASK — the model proceeded on its own

Both legs were also given two tasks whose answers the model could settle itself.

- *"Write one paragraph explaining what an MQTT broker does."* — no card on
  either leg; `openrouter` settled with *"An MQTT broker is a central server that
  manages communication between devices in an MQTT (Message Queuing Telemetry
  Transport) network…"* and `codex` with *"An MQTT broker is a central server
  that receives messages from devices or applications, organized by topics…"*.
- *"Organize the files in your workspace the way you think is best, then tell me
  what you did."* — no card on either leg; `codex` settled with *"Organized the
  workspace without changing the provider-authentication mockups: - Moved all
  image and logo assets into `downloads/images/`. - Moved Node.js archives into
  `downloads/node-runtimes/`. - Updated `artifacts.json`…"*, and `openrouter`
  reported the folder structure it created.

Neither model asked for permission to act, asked what a file was called, or
asked to have work done for it on these turns.

## Where the judgement was wrong, and what that exposed

These are reported as they happened, not as passes.

**An anti-abuse violation, and the fix.** On the pre-`d808f45e` bundle,
`openrouter`/llama answered *"Write one paragraph explaining what an MQTT broker
does"* by asking the person a `free_text` question — *"What is the role of an
MQTT broker?"* — i.e. it asked the person to supply the content it was told to
write. On the same tasks it also *announced* that it needed decisions instead of
calling the tool. Both are instruction gaps rather than protocol bugs, so the
tool description (`server/index.ts`), the Claude CLI bridge
(`server/permission-proxy.ts`) and `ASK_PROMPT` (`server/system-prompt.ts`)
gained the same two sentences: never ask the person to do part of the work or to
supply content you should produce yourself, and when input is genuinely needed,
**call the tool — do not end the turn by announcing what you need**. On the
current bundle the same case settles with a written paragraph on both legs, and
the ask section grew 707 → 867 bytes.

**A case the model kept resolving by itself.** *"Implement a feature where
destructive actions can either require confirmation or proceed automatically."*
Neither model ever asked, on any run: each implemented **both** behaviours behind
a setting. That is a defensible reading of the sentence — it names the two
behaviours — so the expectation in the driver is arguably wrong for this wording
rather than the model being wrong. It stays in the run as a failed expectation.

**Judgement is a distribution, not a constant.** With the same model, the same
prompt and the same task text, `codex` asked a typed question in one run (case
#4 above) and produced a full settings specification without asking in the next.
The bot workspace persists between runs, so the mockups and designs written by
the earlier run were already on disk, and the later run said so — *"Organized the
workspace without changing the provider-authentication mockups"*. A single
non-ask is not evidence of bad judgement and a single ask is not evidence of
good judgement; both directions are recorded here.

**Provider stalls.** `google/gemini-2.5-flash` on the person's OpenRouter
endpoint accepted a turn and never replied (240 s, only an `activity` row), on
every case of that run; `meta-llama/llama-3.3-70b-instruct` stalled the same way
on one case. One llama turn on the settings-screen task emitted a raw
`<|python_tag|>agents_request_credential({...})` token as text instead of a
reply. These are provider/model behaviour, not the ask path — and they are the
reason a silent turn must fail the driver rather than count as restraint.

## Automated checks

```
npx tsc -p tsconfig.server.json --noEmit          # clean
npx oxlint --deny-warnings <edited files>         # 0 warnings, 0 errors over 9 files
npx vitest run --no-file-parallelism <ask suites> # 385 tests in 8 files, 0 failed
cd android && ./gradlew :app:testDebugUnitTest :core:test --offline
                                                  # BUILD SUCCESSFUL
```

The TypeScript total is `shared/ask-question` 45, `openai-chat-tools` 57,
`anthropic-compat` 4, `codex-native-runtime` 7, `permission-proxy` 11,
`auto-approve` 17, `system-prompt` 15 and `server/index` 229. The Android
suites report 1015 tests over 122 files (`:app`) and 563 over 52 (`:core`), 0
failures and 0 errors; `:core:test` was up-to-date this round, so Gradle
reused its previous green result rather than re-running it.

The instruction wording this record depends on is pinned by
`server/system-prompt.test.ts` (the two new clauses) and by the `ask_user`
description tests; `shared/ask-question.test.ts` and
`server/drivers/openai-chat-tools.test.ts` pin the schema and the resume.

## Left clean

- The driver created and deleted one throwaway bot per leg
  (`DELETE /api/bots/:id`). `/api/bots` afterwards lists exactly the person's
  six bots — Vega, Poppy, Fig, Hazel, Fix panel test, Quill.
- `openaiCompat` still reads back `state: available`, `authenticated: true`,
  default model `google/gemini-nano-banana-2.1` — the one thing the driver
  writes is its own throwaway bot's model selection.
- No fixture instance (`api-ask-user-…`) is present, and the device has neither
  the mock file nor a mock process: this pass never used one.
- One residue the driver did **not** clean: two task threads opened by its
  throwaway bots on the person's **Vega** bot, titled `@Real Ask codex …` and
  `@Real Ask openrouter …`, outlived their bot's deletion — deleting a bot does
  not remove threads it opened elsewhere. They were removed explicitly
  (`DELETE /api/bots/:botId/tasks/:threadId`, both 200) and Vega's task list is
  back to its own threads. The fixture should clean these itself.

## What this does not prove

- **Judgement is model- and sample-specific.** Four asks and four non-asks with
  two models is evidence that a real configured model *will* call the tool on
  its own and *can* leave it alone; it is not a rate, and it does not generalise
  to models that were not run. The deterministic mock pass remains the proof
  that the mechanism itself is correct.
- **The resume check is a text matcher.** A choice answer is looked for
  verbatim; a written answer is matched on its distinctive words. A correctly
  reworded continuation could score as not-using the answer, and a coincidence
  could score the other way.
- **The on-screen tap was not reproduced with a real model's card in the final
  runs.** One earlier real-model pass answered a `Google | Microsoft | Amazon`
  question by tapping the card on the screen, and the mock pass taps
  **Confirm** + **Submit answer** on the phone 53/53. That earlier tap happened
  on the frame before this pass's instruction changes (`c019f836`). In the runs
  above the only real-model ask on the tap case ended
  `answer given by tapping the card on the phone's screen: false (stage: option
  "Google" never appeared after 4 swipes)`, and the case fell back to the answer
  route the card calls. The tap path has since been hardened to retry, to search
  the lazy transcript in both directions, and to report what was actually on
  screen when it gives up — but no later run produced a real-model ask on that
  case, so that diagnostic is untested. The question → pause → answer → resume
  chain is therefore device-proven with a real model; the finger-on-card step is
  proven for the mock's card and for one earlier real-model pass, not for the
  card in the final runs.
- **One device, one ABI.** `arm64-v8a` only; `armeabi-v7a` and `x86_64` are
  built but never run. Rotation and backgrounding are covered by the mechanism
  record, not repeated here.
- **Two providers of the person's own** were used, with the person's own keys,
  and no provider setting was written by the driver. A model that stalls (as
  `google/gemini-2.5-flash` did on this endpoint) cannot be measured at all, and
  a task whose expectation is wrong for its wording (the destructive-action
  sentence above) reads as a model failure when it is a case failure.
- **iOS and desktop are still v1-shaped** (`ios/App/Cards/QuestionCardView.swift`,
  `src/components/QuestionCard.tsx`): they render the model's rows and a
  free-text field, and enforce no v2 bounds. Nothing is unanswerable there; it is
  less strict, not broken.
