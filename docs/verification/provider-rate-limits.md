# Provider rate limits, and which drivers wait them out

A turn on the phone ended with this as its last word in the conversation:

```
error: upstream HTTP 429: {"error":{"message":"Provider returned error",…
```

That is the OpenAI-compatible driver's own error text (`httpErrorLabel:
"upstream"` in `server/drivers/openai-compat.ts`), so it was this codebase
answering, not the router's page. The endpoint is the one a person adds with a
URL and a key — on that phone, a router in front of a free model — and the
question the report raised was whether the app waits out a rate limit or gives
up on the first response. It gave up.

## The defect

`server/drivers/openai-chat.ts` holds the shared runtime for the three
providers that speak OpenAI chat completions, and it retries only when the
caller supplies `retryScale`:

```ts
if (options.retryScale === undefined || abort.signal.aborted || streamed || …) throw error;
```

`grok.ts` supplied it; `openai-compat.ts` and `minimax.ts` did not. Passing the
option is also the opt-in for the shared policy in `retry.ts` — three attempts,
1s/3s/8s capped backoff with ±25% jitter, never replaying a turn that already
streamed text or handled a tool call — so those two drivers had no retry at
all, while Claude, Codex and the Anthropic-compatible driver all did. For an
endpoint in front of someone else's quota, rate limiting is the ordinary
failure, not an exotic one: the first 429 became the turn's answer.

## The fix

Both drivers now supply a scale, with the same environment hook the other
drivers use so tests can compress the backoff:

```ts
retryScale: Number(process.env.FAKE_OPENAI_COMPAT_RETRY_SCALE ?? "1"),
retryScale: Number(process.env.FAKE_MINIMAX_RETRY_SCALE ?? "1"),
```

## Evidence

`server/drivers/openai-compat-retry.test.ts` drives the real driver against a
stubbed `globalThis.fetch` — the shape `server/drivers/grok.test.ts` already uses for this
runtime — and scripts the responses:

```sh
pnpm exec vitest run server/drivers/openai-compat-retry.test.ts
```

Before the fix, on the same test file: `Tests 2 failed | 1 passed`. The
transient cases recorded **zero** `turn.retrying` events and one request, which
is exactly what the phone's transcript showed. After:

- `waits out a 429 and completes the turn` — one `turn.retrying` with reason
  `rate_limited`, two requests, one answer in the transcript.
- `settles as failed after the attempt cap, keeping the endpoint's own error` —
  attempts `[1, 2]`, three requests, the terminal error still says
  `upstream HTTP 429`, because the status is what tells a person whether to
  wait or to go and fix a key.
- `never retries a terminal auth failure` — a 401 is still one request.

The neighbouring suites are unchanged and green:

```sh
pnpm exec vitest run server/drivers/openai-compat.test.ts server/drivers/openai-compat-idle.test.ts \
  server/drivers/openai-chat.test.ts server/drivers/openai-chat-tools.test.ts \
  server/drivers/grok.test.ts server/drivers/retry.test.ts
```

114 tests passed, 6 files.

## Getting it onto the phone

The phone runs its own copy of the server: `android/app/src/main/assets/host/server.zip`
is extracted into app-private storage at first launch, so a Gradle build alone
does not carry a server-side fix. The order is:

```sh
pnpm build:server                     # dist-server/
node scripts/prepare-android-host.mjs # → assets/host/server.zip, prints its sha256
cd android && ./gradlew :app:testDebugUnitTest :app:assemblePreview
adb install -r app/build/outputs/apk/preview/app-arm64-v8a-preview.apk
```

The zip the APK carries and the zip in the workspace were checked to be the
same artifact by sha256 (`d9df80e4c62c9efed3f7ae255f632e746f257a40c5ab5ea6e2661ab209229e3b`),
and after the update the extracted bundle on the device contains the new
marker:

```sh
adb shell "run-as com.openmausbot.companion.preview grep -c FAKE_OPENAI_COMPAT_RETRY_SCALE \
  /data/data/com.openmausbot.companion.preview/files/host-server/index-android.js"
1
```

## What this does not establish

- No live 429 was reproduced against a real provider: the retry is proven
  against the driver's own fetch boundary, which is where the decision lives,
  not against a router's quota.
- The backoff is seconds (1s/3s/8s), which covers a momentary rate limit, not a
  spent daily quota — a free model that is out of capacity for the hour still
  fails, now after three attempts instead of one.
- The released desktop app and any APK the person already has installed keep
  the old behaviour until they are rebuilt from this tree.
