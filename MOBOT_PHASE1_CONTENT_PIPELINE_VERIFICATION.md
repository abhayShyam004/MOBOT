# Phase 1 content pipeline — final gap verification (physical device)

**Date:** 2026-10-15
**Device:** Samsung Galaxy SM-A075F (`arm64-v8a`, Android 16 / API 36, serial `R8YY90VT4EM`)
**Host:** embedded Node host on the device, reached through `adb forward tcp:28799 tcp:18799`
**Conversation under test:** Scout thread `416917b2-a958-41ed-a9ad-4d96eac7b5cf` (bot `88e58acd-0aa1-4685-976b-de844da48923`)
**Method:** live turns driven through the host REST API, then inspected in the app UI via `uiautomator` dumps and screenshots; every attachment compared byte-for-byte against the stored file.

## Verdict per acceptance case

| # | Case | Verdict |
|---|------|---------|
| 1 | Exactly one image, once, no `[Image attached]`, no fabricated filename, no internal metadata | **PASS** (with the corrupt-image gate fix below) |
| 2 | Multiple images: exact count, no duplicates, correct order | **PASS** |
| 3 | `TEXT → IMAGE → TEXT` ordering preserved | **PASS for ordering**; the image bytes in that turn were corrupt (defect D1) |
| 4 | Open an image attachment: native in-app viewing, fullscreen/zoom | **PASS** for native viewing + fullscreen; pinch zoom is implemented but not gesture-injectable on this retail device (see limits) |
| 5 | Document types: native preview where implemented, external fallback only when unsupported | **PASS** |
| 6 | Tool failure: no internal tool/debug output in normal chat | **PASS** |
| 7 | Multiple artifacts in one turn: correct message association, internal files hidden | **PASS** |
| 8 | Restart app, reopen conversations: artifacts resolve, no duplicates | **PASS** |

One real defect was found (**D1**) and fixed at its root cause. **Phase 1 is now VERIFIED**, and the fix has since been built, installed and re-verified on the phone — see “Ship + re-verify on the physical device” at the end of this document.

---

## Case 1 — exactly one image

Live turn (19:47), assistant text:

> Created exactly one verified 512×512 PNG: a square red card with "MOBOT" in white.

- Transcript payload carries exactly **one** attachment for that message: `mobot-card.png` (`image/png`, `/api/attachments/912ad7de-e0b8-45ff-bb69-36ae793b1197.png`, 4206 B).
- The app renders exactly **one** clickable image card (`ImageView`, 528×512, content-desc `mobot-card.png`) under that reply.
- Prose checks: no `[Image attached]` marker, no file name, no dimensions/mime/path/SHA/metadata in the reply text.
- Evidence: `docs/verification/phase1-case1-single-image-card.png`.

## Case 2 — multiple images

Live turn, requested order green → blue → amber. Assistant text lists `1. Green square 2. Blue square 3. Amber square` and the payload carries exactly three attachments in that order:

| order | name | bytes | sha256 (short) |
|---|---|---|---|
| 1 | `01-green-square.png` | 1811 | distinct |
| 2 | `02-blue-square.png` | 1811 | distinct |
| 3 | `03-amber-square.png` | 1819 | distinct |

- No duplicate bytes (three different SHA-256 digests, verified against the stored files).
- UI shows three image cards in the same order (measured card tops: y=445, y=972, y=1366).
- Evidence: `docs/verification/phase1-case2-three-image-order.png`.

## Case 3 — `TEXT → IMAGE → TEXT`

Turn sequence (message indices in the thread payload, times local):

| idx | time | role | content |
|---|---|---|---|
| 24 | 19:49:33 | bot | “I’ll create one PNG image of a yellow circle, then confirm when it’s finished.” — **TEXT** |
| 26 | 19:49:39 | bot | “I’ll generate one yellow-circle image now.” + attachment `yellow_circle.png` — **IMAGE** |
| 30 | 19:49:50 | bot | “Here is the yellow circle image.The yellow circle image has been generated and verified.” — **TEXT** |

- User-facing order is preserved: intro text, then the message carrying the image, then the closing text. The UI shows the same order.
- ⚠️ The image itself never rendered: its bytes are undecodable (defect **D1**). The UI shows the two surrounding text bubbles with no card between them.
- Text nit: `image.The` is missing a space in message 30.
- Evidence: `docs/verification/phase1-case3-text-image-text.png`.

## Case 4 — open an image attachment

Tapping the case-1 image card (`mobot-card.png`) opened the app's own viewer:

- Header: `Done` (close), `mobot-card.png`, `Share`, `Open`.
- Body: the image rendered edge-to-edge (720×1401 on a 720×1600 screen) on a black full-screen surface.
- Foreground activity stayed `com.openmausbot.companion/.MainActivity` — no external app involved.
- Evidence: `docs/verification/phase1-case4-native-image-viewer.png`.

Zoom: `ZoomableImage` (FilePreview.kt) implements pinch-zoom (`transformable`, scale clamped 1–5×), clamped panning while zoomed, and a `Reset` control that appears once scale > 1.01. The pinch gesture itself could not be synthesised on this retail device (see Limits) — it is code-verified, not gesture-verified.

## Case 5 — document types

| file | type | native rendering | evidence |
|---|---|---|---|
| `summary.pdf` | PDF | **Native in-app** viewer: `1 page` badge, rendered page image (644×833), `Page 1 of 1`, in-app `Done`/`Share`/`Open` | `phase1-case5-pdf-native.png` |
| `summary.md` | Markdown | **Native in-app** preview rendering the Markdown (heading “MOBOT File Summary” + bullet list) | `phase1-case5-markdown-native.png` |
| `release-pack-data.csv` | CSV | `FilePreviewKind.CSV` structured tabular view | `phase1-case5-*` + earlier `content-pipeline-csv-viewer.png` |
| `single_text.zip` | ZIP | **Not natively previewable** → in-app file preview with an explicit hand-off: ZIP badge, `144 bytes · application/octet-stream`, and “Use Open to view this file in a compatible app.” | `phase1-case5-zip-unsupported-fallback.png` |

So native preview is used wherever a kind exists (image, Markdown, text, PDF, CSV, code) and the external path is offered only for genuinely unsupported types.

## Case 6 — tool failure

Fresh turn (21:05) asked to run `cat /data/user/0/com.openmausbot.companion/definitely-missing-file-xyz.txt`. The command failed (exit code 1). The complete user-visible reply was:

> The command failed: the file does not exist, and it exited with code 1.

No tool names (`android_computer_*`), no JSON tool envelope, no `exitCode`/`stderr` fields, no stack trace, no workspace paths in the assistant text. The only occurrences of `/data/user/0` and `cat /data` in the thread text come from the user's own prompt.

## Case 7 — multiple artifacts in one turn

| assistant message | attachments | rendered |
|---|---|---|
| “Done.” (19:51) | `summary.pdf`, `summary.md` | both cards under that message |
| “Done — all three files are shared…” (19:52) | `release-pack-graphic.png`, `release-pack-summary.pdf`, `release-pack-data.csv` | PDF + CSV cards under that message; the PNG is corrupt (**D1**) and silently dropped |
| “Done. The ZIP archive contains exactly one small text file.” (19:58) | `single_text.zip` | ZIP card under that message |

- Each artifact is associated with the assistant message of its own turn — no cross-message bleed.
- Internal/intermediate files stay hidden: `.mobot` internals, generator scripts, and workspace scripts never appear as cards (`artifactsFromToolOutput` + `isInternalFilename` restrict delivery to `user_visible`/`final` attachments, and no internal name appears in the payload).

## Case 8 — restart and reopen

1. `adb shell am force-stop com.openmausbot.companion` → host server unreachable (`RemoteDisconnected`, i.e. the embedded server really went down).
2. Relaunch → host healthy again with a **new PID** (`8485` → `2544`), proving a genuine restart.
3. Attachment resolution after restart: all **11** attachments referenced by the transcript returned HTTP `200`, the expected content type, and a SHA-256 identical to the stored file (including the two corrupt PNGs, so their problem is decoding, not fetching):

```
OK 200 image/png       mobot-card.png            4206B  hash_match=True
OK 200 image/png       01-green-square.png       1811B  hash_match=True
OK 200 image/png       02-blue-square.png        1811B  hash_match=True
OK 200 image/png       03-amber-square.png       1819B  hash_match=True
OK 200 image/png       yellow_circle.png         3930B  hash_match=True
OK 200 application/pdf summary.pdf                773B  hash_match=True
OK 200 text/markdown   summary.md                 149B  hash_match=True
OK 200 image/png       release-pack-graphic.png  1882B  hash_match=True
OK 200 application/pdf release-pack-summary.pdf   833B  hash_match=True
OK 200 text/csv        release-pack-data.csv      100B  hash_match=True
OK 200 application/zip single_text.zip            144B  hash_match=True
```

4. Reopened the conversation after the restart; older messages hydrate through the `Load earlier messages` pager. Cards seen, in transcript order:

```
mobot-card.png (1×)                                   case 1 image
01-green-square.png, 02-blue-square.png, 03-amber-square.png (in order)   case 2 images
summary.pdf, summary.md                               case 5 documents
release-pack-summary.pdf, release-pack-data.csv        case 7 documents
single_text.zip                                       case 5b archive
```

- No duplicate card in any single view (`Load earlier messages` pages inspected one by one).
- The four valid images still decode and render after a full app + server restart; the two corrupt PNGs remain absent, exactly as before the restart.
- Evidence: `docs/verification/phase1-case8-after-restart.png`.

---

## Defect D1 — corrupt image artifacts were verified as valid and silently lost

**What was wrong.** Two images delivered into the transcript are structurally invalid PNGs:

| artifact | name | bytes | ICD |
|---|---|---|---|
| `8da2d8e4-f2d0-4c34-902e-c3ce7f37bf32.png` | `yellow_circle.png` | 3930 | IHDR checksum field written as `00000000`, real CRC 4 bytes later (chunk buffer over-allocated by the chunk-type length); the next chunk length reads as `0xF478D4FA` |
| `94d3a7b3-3a71-4065-84c3-ea98e7781d3b.png` | `release-pack-graphic.png` | 1882 | every chunk framed as `[length][checksum][type][data]`; the first chunk “type” is `0x7b1a43ad`, not `IHDR` |

`identify` (libpng/ImageMagick) rejects both: `IHDR: CRC error` and `[7B][1A]C[AD]: bad header (invalid type)`. The bytes were produced inside the sandbox by the agent's own hand-rolled Node encoders (the exact `android_computer_run_shell` commands are in the turn event log for that thread); the encoders compute the CRC offset/order wrongly.

**Why it reached the user.** `android_computer_verify_image` — the tool the pipeline uses to prove an image is real — reported both files as verified:

```json
{ "verified": true, "format": "png", "width": 1229472850, "height": 512 }   // release-pack-graphic.png
{ "verified": true, "format": "png", "width": 512, "height": 512 }          // yellow_circle.png
```

`width = 1229472850` is the ASCII bytes `IHDR` read as a 32-bit integer. Root cause in `server/computer-agent/artifact-manager.ts`: `sniffMagic()` accepted any file whose first four bytes were the PNG signature and then read width/height from fixed offsets 16/20 without validating the container (chunk framing, chunk types, lengths, CRCs, IHDR-first, IDAT/IEND presence).

**User-visible effect.** `BotImageAttachment` (MessageRow.kt) does `val decoded = bitmap ?: return`, so an undecodable image is dropped with no card and no message. Concretely: the case-3 turn shows text, then nothing where the image should be, then text; and the case-7 message declares three attachments but only two cards render. The agent's own closing text even claimed “generated and verified”.

**Fix (root cause, no redesign).** `server/computer-agent/artifact-manager.ts`:

1. New `inspectPngContainer(buffer)` validates the whole container: signature; every chunk's type is four ASCII letters; no impossible or past-EOF chunk lengths; per-chunk CRC verified; first chunk must be a 13-byte `IHDR` with non-zero dimensions; at least one `IDAT`; terminated by `IEND`.
2. `sniffMagic()` now uses it. A PNG signature with a broken container is reported as `kind: "file"` with `error: "invalid PNG image: <reason>"` instead of `kind: "image"`.
3. `validateArtifact()` surfaces that reason in its `expectedKind` mismatch error, so `verify_image` returns `verified: false` with the specific corruption (e.g. “invalid PNG image: IHDR chunk at byte 8 has an invalid checksum”) and no bogus dimensions.
4. `registerArtifact()` refuses to register a file whose extension claims an image (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) but whose contents are not a readable image, with an actionable error: *“Regenerate or repair the file and pass verify_image before registering it.”* The workspace auto-scan path already swallows validation errors, so a bad file simply is not auto-delivered.

`server/computer-agent/computer-agent.test.ts`:

- The two 33-byte pseudo-PNG fixtures (`magic + IHDR` only, no IDAT/IEND) were replaced by a real PNG builder (correct chunk framing, real CRC-32, deflate-compressed scanlines) — they never were valid images.
- Three regression tests added: both observed corruption shapes are rejected by `validateArtifact`; `registerArtifact` throws for a corrupt `.png` while a real PNG still registers with true dimensions; `verifyImage` returns `verified: false` (no width/height) for a corrupt 512×512 PNG.

**Post-fix results.**

- `pnpm exec vitest run server/computer-agent/computer-agent.test.ts server/attachments.test.ts` → **74/74 PASS** (37 + 37).
- `pnpm typecheck` → only the pre-existing baseline errors remain (`server/capabilities/routine-engine.test.ts` ×6 and two unused-variable errors in `computer-agent.test.ts` that predate this change); no new error from this fix.
- At the time of this section the fix was source-only. It has since been shipped: see “Ship + re-verify on the physical device” at the end of this document for the build hashes, install receipt and device-side gate results.

## Limits and open items

- **Pinch zoom (case 4)** could not be synthesised: the device is not rooted and `/dev/input/event*` is not writable by `adb shell` (`Permission denied`), and `input` only injects single-pointer gestures. Pinch is therefore code-verified only.
- **Already-delivered corrupt artifacts** (`8da2d8e4`, `94d3a7b3`) remain in the transcript as historical data. They were not rewritten, hidden, or deleted; with the new gate no such artifact can be registered again.
- **Android-side silent drop**: `val decoded = bitmap ?: return` in `MessageRow.kt` still renders nothing for an undecodable image. A visible “This image couldn't be displayed.” card (the wording already used by the full-screen viewer) would turn a silent loss into an honest failure state. Recommended follow-up, not part of this fix.
- **Incidental observation, other thread**: while navigating by preview text the wrong bot's conversation was opened, and in that thread one image card exposed two `ImageView` nodes with the same `content-desc` (`isle-of-man-flag.png`) plus a bare `Flag` description in a single view. Not reproduced or explained; worth a separate look as a possible duplicate-node/label issue in that conversation's rendering.
- **Legacy broken attachment**: `files/host/data/attachments/` still contains an old (2026-10-13) 33-byte `.png` payload that no decoder can read; it is not referenced by this thread.

## Reproduction commands

```sh
# live turn
curl -s -X POST http://127.0.0.1:28799/api/bots/88e58acd-0aa1-4685-976b-de844da48923/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"CASE-6: Run this exact shell command and report what happened: cat /data/user/0/com.openmausbot.companion/definitely-missing-file-xyz.txt","threadId":"416917b2-a958-41ed-a9ad-4d96eac7b5cf"}'

# transcript + attachment resolution
curl -s "http://127.0.0.1:28799/api/threads/416917b2-a958-41ed-a9ad-4d96eac7b5cf/messages?limit=400"
curl -s -o /tmp/yellow_circle.png -w '%{http_code}\n' \
  http://127.0.0.1:28799/api/attachments/8da2d8e4-f2d0-4c34-902e-c3ce7f37bf32.png
identify /tmp/yellow_circle.png    # -> IHDR: CRC error

# restart
adb -s R8YY90VT4EM shell am force-stop com.openmausbot.companion
adb -s R8YY90VT4EM shell am start -n com.openmausbot.companion/.MainActivity
curl -s http://127.0.0.1:28799/api/health     # new pid

# fixed pipeline tests
pnpm exec vitest run server/computer-agent/computer-agent.test.ts server/attachments.test.ts
```

---

# Ship + re-verify on the physical device (2026-10-15, after fix D1)

**Status: the fixed build IS installed on the phone and the new validation is confirmed running there.**

## Build (host machine, project pipeline)

| step | command | result |
|---|---|---|
| server bundle | `pnpm build:server` | exit 0, 21:29 — `dist-server/` rebuilt (`.../computer-agent/artifact-manager.js` contains `inspectPngContainer`) |
| android host asset | `node scripts/prepare-android-host.mjs` | exit 0, 21:30 — `android/app/src/main/assets/host/server.zip`, **10,656,243 B**, sha256 `43ad92d95af30c063393c9004be85ce620a93754318623715b8d8175ab39d975` (2037 files, 38.0 MB raw; enterprise layer excluded; 2 native addons) |
| ARM64 APK | `./gradlew :app:assembleDebug` | exit 0, 21:30 — `app-arm64-v8a-debug.apk` **90,291,467 B**, sha256 `360e3d0433f599f78a251bef885baf27aafe93fc94fdaed19befd7e89d90bae8` |

**Proof the fix is inside the artifact (not assumed):**

- `server.zip` extracted from the APK has sha256 `43ad92d9…` — identical to the freshly built asset.
- `server/computer-agent/artifact-manager.js` inside that APK zip is **byte-identical** (`diff -q`) to the freshly built bundle, and contains `inspectPngContainer` (×2), `Refusing to register`, and `invalid PNG image`.
- Old asset sha256 was `33873e68…`; the new one differs, so the rebuild was not a no-op.

## Install and clean restart

```
adb -s R8YY90VT4EM install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk   -> Success (exit 0)
dumpsys package com.openmausbot.companion:
    versionName=1.0.0  versionCode=10000  minSdk=26  targetSdk=37
    lastUpdateTime=2026-10-15 21:31:38        <- new build installed
```

- Clean restart (`am force-stop` → `am start …/.MainActivity`); embedded server came up and `GET /api/health` returned `{"app":"openmausbot","pid":17856,"static":false}`; device shows exactly one listener on 18799.
- **Device-side bundle check** (what the running server actually executes): `files/host-server/server/computer-agent/artifact-manager.js`, 22,647 B, mtime 2026-10-15 21:31, contains `inspectPngContainer` (×2), `Refusing to register`, `invalid PNG image`.

## Gate test through the real production tools (21:34–21:36)

Four files placed in the device workspace (`…/task-workspaces/88e58acd…/416917b2…/d1-gate/`) and passed through the actual MOBOT artifact path over a live turn
(`android_computer_verify_image` then `android_computer_artifact_register`). Results read from the turn's tool results, not from the agent's prose:

| file | bytes | sha256 (16) | `verify_image` | `artifact_register` |
|---|---|---|---|---|
| `A-valid.png` | 136 | `9879e218a247411c` | `ok:true, verified:true, width:64, height:64` | `ok:true, registered:true, kind:image, mime:image/png` → `/api/attachments/d001f2c0-102b-4c9d-b3ae-a6c7167937fc.png` |
| `B-malformed-framing.png` | 136 | `552b978578a8df60` | `ok:false, verified:false`, **no width/height**, `invalid PNG image: chunk at byte 8 has an invalid type` | `ok:false` — `Refusing to register "B-malformed-framing.png" as an image artifact: … Regenerate or repair the file and pass verify_image before registering it.` |
| `C-bad-crc.png` | 136 | `7f17a410fd133041` | `ok:false, verified:false`, **no width/height**, `invalid PNG image: IHDR chunk at byte 8 has an invalid checksum` | `ok:false` — refused (same wording) |
| `D-missing-chunks.png` | 33 | `ae9edc207aafecb6` | `ok:false, verified:false`, **no width/height**, `invalid PNG image: contains no IDAT image data` | `ok:false` — refused (same wording) |

- **Only the valid file reached the user-facing pipeline**: the turn's assistant message carries exactly one attachment, `HTTP 200 image/png`, 136 B, byte-identical to the local `A-valid.png`, and `identify` reads it as `PNG 64x64`. No attachment was created for B, C or D.
- Cross-check with an independent decoder agrees with the new validator: ImageMagick rejects B (`bad header (invalid type)`), C (`IHDR: CRC error`), D (`insufficient image data`).

## Content-pipeline cases re-run on the shipped bundle (21:36–21:47)

| case | result |
|---|---|
| one valid image | exactly **1** attachment `purple-circle.png`, 3950 B, `PNG 512x512`; reply: “Created, verified, and shared the requested 512×512 PNG.” |
| multiple valid images | exactly **3** in the requested order — `01-teal-square.png` (2002 B), `02-orange-square.png` (2004 B), `03-violet-square.png` (1881 B), all valid 512×512, three distinct sha256 |
| `TEXT → IMAGE → TEXT` | intro text → text carrying `blue-circle.png` (4486 B, valid 512×512) → “The 512×512 blue-circle PNG was created, verified, and shared.” — order preserved, image now really present |
| multiple artifacts in one turn | one message “Created, verified, and shared all three requested files.” owning `green-graphic.png` (image, 128×128), `summary.csv` (dataset), `summary.md` (document) — correct association, no internal files |

Hygiene on every re-run reply: no `[Image attached]`, no fabricated file names, no paths, no raw JSON, no checksums. Six re-run images, six distinct sha256 (no duplicates).

## Restart, reopen, and viewer (21:47–21:54)

- `force-stop` → server unreachable → relaunch → `{"app":"openmausbot","pid":23066}` (pid changed from 17856).
- All **20/20** attachments referenced by the transcript resolve `HTTP 200` after the restart.
- UI walk of the newest region: `IMG green-graphic.png`, `FILE summary.csv`, `FILE summary.md`, `IMG blue-circle.png`, `IMG 01-teal-square.png`, `IMG 02-orange-square.png`, `IMG 03-violet-square.png`, `IMG purple-circle.png` — **no duplicate card in any single view**.
- Tapping `purple-circle.png` opened the app's own viewer (`Done` / `purple-circle.png` / `Share` / `Open`) with the foreground still `com.openmausbot.companion/.MainActivity` — **no external app launched**.
- Evidence: `docs/verification/phase1-rerun-after-ship-cards.png` (three squares visible together), `docs/verification/phase1-rerun-after-ship-viewer.png`.

## Tests and build after the change

| check | command | result |
|---|---|---|
| host tests | `pnpm exec vitest run server/computer-agent/computer-agent.test.ts server/attachments.test.ts` | **74/74 pass** (2 files), exit 0, 21:50 |
| android unit tests | `./gradlew :app:testDebugUnitTest -q` | exit 0, 21:51 — **138 suites, 1123 tests, 0 failures, 0 errors, 0 skipped** (incl. `AttachmentRulesTest` 13/13, `InlineMarkdownTest` 69/69) |
| android build | `./gradlew :app:assembleDebug` | exit 0, 21:30 — all four per-ABI APKs produced |

## Remaining limitations (after shipping)

- **Pinch zoom** is still code-verified only: the device is not rooted, `/dev/input/event*` is not writable by `adb shell`, and `input` injects single-pointer gestures only.
- **Historical corrupt artifacts** (`8da2d8e4` yellow_circle.png, `94d3a7b3` release-pack-graphic.png) remain in the transcript as evidence; they still fetch 200 but never decode. New corrupt images can no longer be registered, which is the acceptance criterion.
- **Android silent drop is unchanged** (`val decoded = bitmap ?: return`). The fix makes it unreachable through the production path (a corrupt image is now refused at verification/registration), so no honest "couldn't be displayed" card was added — that remains the recommended follow-up, not a requirement for this gate.
- **Pre-existing anomaly, unrelated to D1**: a turn's terminal activity can record `failure.kind: "unknown"` / “The turn ended with an error” *after* a successful reply and successful artifact delivery. Observed at 19:58 (ZIP turn) and again after the RERUN-4 turn at 21:43; the bot roster preview then reads “The turn ended with an error” even though all three artifacts were delivered and openable. Out of scope here; worth a separate investigation.
- Two different turns produced a file both named `summary.md`; the transcript holds two distinct artifacts (different ids and paths) sharing a display name. Not a duplicate delivery, but display-name collisions are possible.
- This verification is for the debug ARM64 APK built from this working tree; a release build would need the same `prepare-android-host.mjs` step to pick up any future server change.
