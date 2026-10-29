# MOBOT — Automatic Browser Search Fallback with Screenshot Delivery

**Report date:** 2026-10-29 (revised session)
**Base revision reviewed:** `cc3dbc53`
**Working revision:** local `main` with the changes described in §2

---

## 1. What was verified, and what was not

| Claim | Evidence level |
|---|---|
| Normal retrieval runs first; the browser fallback only runs when it produced nothing | Source: `server/index.ts` (`startTurn`, web_search branch) |
| The first search query is the user's question, verbatim, URL-encoded | Unit test 2 + 3 (`buildVerbatimSearchUrl`); source |
| Source selection is relevance + authority scoring, not "first result" | Unit test 4 (`selectCredibleSource`) |
| Answers are only asserted when the captured page states the value | Unit tests 5, 6, 17 (`findMetricEvidence`, `synthesizeVerifiedAnswer`) |
| Screenshots are structurally validated before storage | Unit test 8 (`verifyScreenshotBuffer`) |
| Bytes are stored and read back identically through the attachment store | Unit tests 9, 12 |
| The attachment is bound to the correct assistant turn | Unit test 10; source (`storeInstance.patchMessage`, `attachArtifactsToTurn`) |
| Driver failure envelopes are surfaced, not treated as success | Unit test 18 |
| A repeated frame for a new question is re-captured and disclosed | Unit test 19 |
| TypeScript build is clean | `tsc -p tsconfig.server.build.json` → 0 errors |
| **Physical-device acceptance (this session)** | **NOT RUN — no Android device was attached (`adb devices` empty)** |
| Prior-session device evidence (§6) | Inherited from `cc3dbc53` session, not re-executed here |

Nothing in this report treats a mocked `fetch`, a synthetic fixture, or a stored file as proof
that the preview app rendered a real capture. The prior session's device run is the only
physical evidence that exists, and it is labelled as inherited.

---

## 2. Changes made in this session

The base revision shipped a working pipeline whose *answer synthesis* and *failure handling*
were not general-purpose or honest enough. This session changed three files
(`server/browser-search-fallback.ts`, `server/index.ts`, `server/browser-search-fallback.test.ts`).

1. **Removed subject-specific answer fabrication.** The old `synthesizeVerifiedAnswer` contained a
   Sanju-Samson/cricket branch that emitted hardcoded facts ("14 fours … 121 off 51 balls",
   "7 fours … 107 off 50") whenever a regex matched the page text. That both violated the
   "no Sanju- or cricket-specific implementation" requirement and could state numbers the page
   never contained. It is replaced by `queryMetric` + `findMetricEvidence`, which derive the
   counted noun from the user's own question (`how many <metric> …`), locate `"<n> <metric>"` in
   the captured page text, require the question's subject words to appear in the source, and quote
   the surrounding passage. A test asserts the module contains no `sanju`/`kerala` strings.
2. **`selectCredibleSource` no longer boosts a hardcoded name.** It scores domain authority,
   question terms, those same subject terms, and the presence of a value for the asked metric.
3. **Driver envelope failures are handled.** The Android driver returns HTTP 200 with
   `{ ok: false, error }` for failures. Every JSON route now rejects that envelope, and the
   screenshot route detects a JSON body instead of storing it as an image.
4. **Timeouts.** Every driver request carries `AbortSignal.timeout` (default 30 s, `timeoutMs`
   override), so a hung WebView cannot hold a turn open indefinitely.
5. **Real screenshot validation.** `verifyScreenshotBuffer` now requires magic bytes, a parseable
   frame header (JPEG SOFn / PNG IHDR), at least 120×120 px, a 2 000-byte floor, a 24 MiB ceiling,
   and a complete trailer (JPEG `FFD9`, PNG `IEND`). Truncated, tiny, or fabricated bodies are
   rejected instead of attached.
6. **Stale-frame detection.** Captures are recorded per thread with their query. When a new
   question yields a byte-identical frame within 10 minutes, the page is re-opened and captured
   once more; if it is still identical, `staleFrame` is set and the uncertainty note says so.
7. **Retrieval ordering.** `startTurn` now calls the registry search capability first and only
   escalates to the browser when it returned no results or threw. Previously the browser ran
   first for every `web_search` modality turn, and the scraper only ran when the browser was
   missing.
8. **Removed a thread-global attachment staging call.** The fallback result is bound with the
   dispatch-claim turn id only (plus the store patch inside the fallback when the assistant
   message already exists), instead of also being parked on a thread-wide key.
9. **Grounded instructions follow verification.** The grounding text handed to the model now
   distinguishes "verified by the captured page" from "page captured but the answer was not
   established", and only the first permits asserting a figure.

---

## 3. Call path

```
POST /api/bots/:id/messages
  └─ startTurn()                                        server/index.ts
       └─ defaultCapabilityRegistry.matchCapability()   → chosenModality / primaryCapabilityId
       └─ if chosenModality === "web_search" || shouldTriggerBrowserFallback(userTurnText)
            ├─ 1. registry.invoke("web.scraper", "search")      ← normal retrieval first
            │      results.length > 0 → retrievalAnswered = true (grounding = those results)
            ├─ 2. if (!retrievalAnswered && (device.browser || isBrowserFallbackAvailable()))
            │        executeBrowserSearchFallback()              server/browser-search-fallback.ts
            │          ├─ POST /session/<omb-sha256-32>/open        { url: verbatim search URL }
            │          ├─ POST /session/<omb-sha256-32>/text        { maxChars: 30000 }
            │          ├─ parseSearchResults() → selectCredibleSource()
            │          ├─ POST /session/<...>/navigate              { url: chosen source }
            │          ├─ POST /session/<...>/text                  (inspect the real page)
            │          ├─ POST /session/<...>/eval                  (scroll the passage into view)
            │          ├─ POST /session/<...>/screenshot            → JPEG bytes
            │          ├─ verifyScreenshotBuffer()                  (structure, size, trailer)
            │          └─ saveImage(bytes, mime)                    server/attachments.ts
            ├─ attachArtifactsToTurn(threadId, dispatchClaimId, [attachment])
            │     + directFollowupSettlers post-settle patch        (assistant message may not exist yet)
            └─ else if (!retrievalAnswered) → honest "[Browser Research Unavailable]" grounding
```

Screenshot bytes are served back to the Android client by the existing
`GET /api/attachments/<name>` route, the same path every other image attachment uses.

---

## 4. Trigger conditions and bounds

- **Trigger:** `chosenModality === "web_search"`, or the question matches a factual shape
  (`how many/much`, `who won/scored/…`, `what was the score/price/revenue/…`, `when did … release`,
  `scorecard`/`standings`/`latest version`, `search …`). Greetings and acknowledgements never
  qualify. `shouldTriggerBrowserFallback(..., { retrievalFailed: true })` forces it after a failure.
- **Not triggered:** ordinary conversation, and any turn where normal retrieval returned results.
- **Concurrency:** one fallback per thread. A second request during the same lookup returns the
  in-flight promise rather than starting a competing browser task.
- **Retries:** one source navigation per lookup (failure leaves the browser on the results page),
  one re-capture when a frame repeats, and one 1.5 s settle wait after a non-settled navigation.
  There is no unbounded loop.
- **Timeouts:** 30 s per driver request by default.
- **Availability:** `AB_DRIVER_PORT` + `AB_DRIVER_TOKEN` must both be present (injected by
  `HarnessHost.kt` on device). Locally the fallback correctly reports "Browser driver is offline"
  instead of pretending to search.

---

## 5. Screenshot and attachment receipts (contract)

The fallback returns, and `startTurn` records in the `browser.search_fallback` action receipt:

- `verbatimQuery`, `searchUrl`
- `sourceUrl`, `sourceTitle`
- `extractedAnswer`, `uncertaintyNotice`
- `screenshotHash` (SHA-256 of the exact bytes stored)
- `capturedAt`, `browserSession` (the per-bot `omb-<digest>` profile)
- `attachment.path` (`/api/attachments/<uuid>.jpg`), `attachment.mime`, `attachment.name`
- `verified` (whether the captured page actually stated the answer)
- on failure: `deliveryFailed` (capture succeeded, storage failed) or `error` — both of which set
  grounding text that forbids claiming a delivered screenshot

`verified` is forced to `false` when the source page could not be opened, so a search-results
capture can never be presented as proof of a fact.

---

## 6. Physical-device results (inherited from the `cc3dbc53` session)

Device: Samsung Galaxy A07 (`SM-A075F`, serial `R8YY90VT4EM`), preview package
`com.openmausbot.companion.preview` (port 18789). Production `com.openmausbot.companion`
(18799) was not touched.

| # | Query | Outcome recorded then |
|---|---|---|
| 1 | `how many fours did sanju hit in last game` | Screenshot delivered; attachment `16d192ae-21ff-4c51-9db3-27b0a1dd8e8b.jpg`, 152 289 bytes, served `200 image/jpeg`; UIAutomator node carried `content-desc` of the file name; visible after restart |
| 2 | `who won the 2024 Nobel Prize in Chemistry` | Screenshot delivered |
| 3 | `what was the opening weekend box office for Inside Out 2` | Screenshot delivered |
| 4 | `how many goals did Zorblax 9 score in the 1922 Martian derby` | Honest limitation + search-results capture, no fabricated figure |

**Caveats on that evidence, stated plainly:**

- The answer text in test 1 ("7 fours … 107 off 50") came from the hardcoded cricket branch that
  this session removed. It is therefore **not** independent evidence that the page text was read;
  the next device run must re-establish that with the generic extractor.
- Tests 2 and 3 recorded the *same* SHA-256 (`23c8bde0…`) for different questions, which is what
  prompted the stale-frame check added in §2.6. Whether the driver replays frames is still
  unproven on hardware.
- Test 4's capture was a DuckDuckGo error page, i.e. the long-query failure mode below.

**Not run in this session:** physical-device acceptance, Android unit tests, and the preview
build. `adb devices` was empty; only JDK 25 is installed here while the Android build expects
JDK 17; and no Kotlin source was changed by this session.

---

## 7. Automated checks run in this session

```
npx vitest run server/browser-search-fallback.test.ts
  → 19 passed (was 16; added generic-extraction, driver-envelope, stale-frame tests)

npx tsc -p tsconfig.server.build.json --noEmit
  → 0 errors

npx vitest run server/capabilities/capability-registry.test.ts \
               server/capabilities/real-path-routing.test.ts \
               server/agent-loop.test.ts \
               server/generated-image.test.ts
  → 52 passed
```

**Known failure, not caused by this change:**
`npx vitest run server/index.test.ts` cannot start the server on this machine. The child process
(`node server/index.ts`, strip-only type stripping under Node v22.22.2) aborts on
`server/proactive-intelligence.ts:31` — `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter
property is not supported in strip-only mode`. Reproduced directly:

```
node -e "import('./server/proactive-intelligence.ts')"
→ ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
```

That file is untouched by this session, so every e2e suite that boots `server/index.ts` fails here
for the same pre-existing reason. The `startTurn` integration is therefore covered by the type
check and by the module-level tests, not by a live server run.

---

## 8. Failure modes and remaining limitations

1. **Long queries.** DuckDuckGo's HTML endpoint rejects very long questions. The fallback then
   captures the error page and reports the limitation; it does not retry with a trimmed query.
2. **Search page parsing is textual.** The WebView text view has no link graph, so result blocks
   are recovered from title/URL/snippet line shapes. A results page with an unusual layout yields
   no candidates, and the run is reported unverified with a search-results capture.
3. **Subject matching is lexical.** `querySubjectTerms` treats the question's non-stopword terms
   as the subject. A scorecard that never names the player in its title, snippet, or visible text
   is reported as "does not mention what was asked" rather than guessed at. This errs toward
   refusing rather than attributing a number to the wrong person.
4. **Structural, not entropy, image validation.** No image decoder is available in this
   dependency set, so validation confirms a real frame header, sane dimensions, and an intact
   trailer. A crafted file with a valid header and trailer would pass; a truncated or empty
   capture does not.
5. **Device acceptance is outstanding.** The feature's final criterion — a visible, persistent
   image in the preview app's conversation, driven by the generic extractor — still needs one
   run on the A07.
6. **No source of truth for "last game".** The verbatim query is sent as-is, as required; if the
   search results are ambiguous about which match is "last", the answer reflects whatever the
   chosen source says, and the uncertainty note carries that.
