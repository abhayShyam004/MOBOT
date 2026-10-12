# A failed turn, as a card a person can act on

A bot's turn that ran out of retries ended with its provider's own bytes as the
last word in the conversation:

```
error: upstream HTTP 429: {"error":{"message":"Provider returned error",…
```

That is machine output where an answer was expected: no name for what happened,
no model, and nothing to do about it. On the phone it was a single truncated red
line. The retry policy is covered in
[provider-rate-limits.md](provider-rate-limits.md); this is the other half — what
the person is told when the retries are exhausted, and where the provider's
report goes instead.

## The fix

`server/runtime-failure.ts` is now the only door between a provider's report and
a conversation:

- it classifies the report with the retry loop's own vocabulary
  (`server/drivers/retry.ts` `classifyError`), so "which failures are retryable" and
  "which failure is this" cannot drift apart;
- it writes every user-facing string itself, from a closed set
  (`FailureKind` in `shared/wire.ts`): a rate limit, an exhausted balance, a
  rejected sign-in, a model the account may not use, a model the provider no
  longer serves, a refused request, a provider-side error, an overloaded
  provider, a network we could not cross, a provider that stopped answering;
- it returns the report to the caller for logging and relays nothing from it.
  The log line is `[turn.failure] <kind> <status> (instance / model)
  thread=… turn=… :: <redacted report>` — bounded, secret-redacted, and the only
  place the provider's bytes appear.

`server/index.ts` folds both halves of a broken turn — a terminal `runtime.error`
and a failed `turn.completed` with nothing to say — into one activity message
carrying the card, once per turn. The chip that rides beside it is the card's own
headline (`error: Rate limit reached`), so a client that predates the card still
reads a sentence instead of a payload. *Once* is literal: a diagnostic that
already named the turn in a quiet chip counts as that turn's explanation, so the
settle path cannot append a second, terminal copy of the same error row — which
is both the duplicate a person would see twice and the signal the control
surface reads as `failed` rather than `settled` for a turn that had answered.

The actions are per kind, not a fixed row: a rate limit offers **Retry** and
**Change model** (editing a key that is fine would send someone to the wrong
screen), a rejected sign-in offers **Retry** and **Provider settings**, a missing
engine offers **Provider settings** only — retrying that one hits the same wall.
The rules live in one place per client (`FailureActions` on the phone,
`ErrorRow` on the desktop).

### The mislabel this work found

While testing the exhausted path, the e2e turn kept settling with a card that
said *the provider stopped responding* — for a failure that was the harness's own
tool transport (`MCP request timed out; execution outcome may be uncertain`,
`server/drivers/chat-mcp-tools.ts`). The classifier's `timeout` arm was catching the word
"timeout" in a report about this computer's MCP servers. A new `tooling` kind
now answers that one: *"This bot's tools did not start … The provider is not the
problem here."* — with Retry only, because neither a model nor the provider's
settings can fix a local integration that never answered.

## Evidence

The classification, the copy and the log line, against the real shapes providers
send:

```sh
npx vitest run server/runtime-failure.test.ts server/drivers/retry.test.ts \
  server/drivers/openai-compat-retry.test.ts server/drivers/grok.test.ts
```

`31 passed`, including `failureKindFor('upstream HTTP 429: {"error":…}')` →
`rate_limit` with `status 429`, the same report's card carrying no fragment of
it in any client-drawable string, and the new tooling attribution.

The whole path, end to end, with a real 429 on the wire and the real retry loop:
`server/index.test.ts` stands up a router whose every completion is a 429
carrying a gateway's JSON body, and asserts the card, the chip, the attempt
count the router actually observed, and that no transcript field contains the
payload. The file's full run: `230 passed`. The harness's own stderr in that run
shows both sides of the split:

```
[turn.failure] rate_limit 429 (openaiCompat / inclusionai/ling-3.1-flash)
  thread=7ad80ffe… turn=54310f9c… :: upstream HTTP 429: {"error":{"message":
  "Provider returned error","type":"rate_limit_exceeded","code":429}}
```

The card on a real phone, through the phone's own embedded host — its driver, its
retry loop, its classification, its UI:

```sh
pnpm build:server && node scripts/prepare-android-host.mjs
cd android && ./gradlew :app:assembleDebug
node scripts/test-android-provider-failure.mjs \
  android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk --abi arm64-v8a
```

`PROVIDER-FAILURE: ALL CHECKS PASSED on arm64-v8a` (R8YY90VT4EM). The mock's own
log lines show the provider was asked exactly three times, the transcript carries
`kind: rate_limit`, `status: 429`, the engine and the model, exactly one card for
the turn, and none of `Provider returned error`, `rate_limit_exceeded` or
`{"error"`. The accessibility tree of the phone, after opening the thread the way
its own notification does:

```
Rate limit reached                        (title)
429                                       (status tag)
OpenAI-compatible (OpenRouter / Groq) · mock-1
The provider asked this turn to slow down. The automatic retries did not get
  through, so nothing was answered.
What to do
Wait a few seconds and retry — a shared or free model usually clears straight
  away. Another model works immediately.
[Retry]  [Change model]
```

A screen-reader announcement merges the same three sentences, and the raw payload
is on no screen either. The run captured
[provider-failure-card.png](provider-failure-card.png) (720×1600). The APK built
for it carries the new server bundle — the extracted `files/host-server/` on the
device greps positive for the new kind and its copy.

The phone's own rules, as JVM unit tests:

```sh
cd android && ./gradlew :app:testDebugUnitTest \
  --tests "*TurnFailureCardTest*" --tests "*ApiErrorRulesTest*"
```

`22 passed` across `TurnFailureCardTest` (which actions each kind offers, and that
a Retry only ever re-runs the request the failure belongs to) and
`ApiErrorRulesTest` (the API-error dialog's own classification, including that a
JSON report is described, never quoted).

## Trying the phone leg itself

The device driver installs the APK, stops the sibling preview build (two
OpenMausBot packages on one phone both host the same loopback port, so a preview
left running would answer the forward instead), starts the repo's deterministic
provider mock inside the app's own data directory, points the built-in
OpenAI-compatible instance at it, and puts the provider URL back in a `finally`.
The mock grows one request-level cue for this (`cue-rate-limit`): every
completion whose conversation carries that text is refused with a 429 and a real
gateway's body — for every attempt, so the exhausted path is what gets exercised.

## The whole suite, run after this work

```sh
npx vitest run
```

First pass: `8 failed | 581 passed | 15 skipped (604)`. Three of those eight were
in this work's blast radius and are fixed here:

- `scripts/testing/verification-docs.test.ts` (3) — recipes cited files that no
  longer exist and two recipes were unreachable from the README. Fixed by the
  README entries, one test citation that named a file without its path, and
  `server-settings.md`'s Codex steps, which described an offline sign-in recipe
  whose fixture was removed alongside it; those steps now point at
  `server/drivers/codex-native-auth.test.ts`.
- `server/engine-install.test.ts` (6) and `server/harness/registry.test.ts` (1) —
  the stand-in npm is itself a `#!/usr/bin/env node` script, and the fixture
  reduced PATH to the fixture directory alone. On a host whose node is
  `/usr/bin/node` (a distro install) the shebang then could not resolve. The
  fixture PATH now also carries node's own directory, *after* the fixture's, so
  `npm` still resolves to the stand-in and no real npm is ever reached.
- `server/independent-threads-api.test.ts` and `server/cli-stop.e2e.test.ts` —
  see the duplicate-error-row paragraph above: one failure drew two error rows,
  the second marked `terminal`, which is the signal `control wait` reads as
  `failed`. One explanation per turn turns both green again.

After that change: `server/independent-threads-api.test.ts` (1) and
`server/cli-stop.e2e.test.ts` (2) pass, and `server/index.test.ts` passes whole —
230 tests, including the exhausted-429 card, run against the edited
`server/index.ts`. The phone leg was then repeated on a bundle rebuilt from the
same tree — `server.zip` sha256
`429640475a76f3ef5f1aa44993254e6b9fe2257f5aff0858102eb26b2c3d1b00` — so the
device ran the code the suite ran.

Still failing — three files, four tests — in files this work does not touch:

- `server/bot-continuity.e2e.test.ts` — a room turn reported
  `claude-fable-5-1` where the test expects `claude-fable-5`: model selection,
  not failure reporting.
- `server/model-variant-return.e2e.test.ts` — the group turn never reaches the
  variant guard because the bot is still marked busy from the direct send the
  API had just rejected with 409; the transcript shows only the
  "finishing another conversation" chip.
- `server/delta-context.e2e.test.ts` (2) — a recovered queued follow-up waits as
  `failed` (its transcript still carries a terminal error row after this change),
  and a soul change still resumes a session the test expects to be fresh.
  Session replay, not the card; both were failing before these edits.

## What this does not establish

- No live provider 429 was reproduced: the paid provider is a fixture. The
  driver, the retry policy, the classification, the transcript and the UI are the
  real ones.
- The harness's `[turn.failure]` line could not be read back over `adb`: the host
  process's console is drained into the app's in-memory output ring and reaches
  logcat only if the host dies. That half is held by the server suites above,
  where the raw report is observed reaching the log and nowhere else.
- The `tooling` card is covered by unit and server tests; no failing MCP mount
  was staged on the device.
- The desktop renders the same card data as a compact inline error row with
  **Retry** (its model picker is always in the composer, so it needs no
  "Change model" button). That row was read in `src/components/ChatView.tsx`,
  not driven through a headless renderer this time, and it has no renderer test
  of its own; the phone's full card is what the screenshot above shows.
- The installed APKs the person already has keep the old behaviour until they are
  rebuilt from this tree.

## One test-only correction worth recording

The e2e rate-limit test used to fail whenever the whole file ran together: every
tool-bearing turn also mounts the harness's own agents MCP server, which has its
own 8-second startup budget, and on a loaded machine it can outrun it — the turn
then failed at mount, before the provider was ever asked, and the card under
assertion was the MCP one. The test now drives the built-in OpenAI-compatible
instance with `tools: false`, so it measures the provider call and the retry loop
and nothing else.
