# Phase 6 security hardening — shared-memory poisoning

Status: **ACCEPTED** for the direct `workspaces/shared/MEMORY.md` poisoning
defect. One residual, explicitly-scoped limitation is recorded at the end.

## 1. Reproduction of the original defect

Fixture: fresh temporary workspace roots in `server/memory-partition.test.ts`
(`root()` / `botName()`), plus the isolated `com.openmausbot.companion.preview`
fixture on the attached Galaxy A07 (serial `R8YY90VT4EM`).

1. A shared preference was approved through `putSharedMemoryRecord`
   (`User prefers Kotlin for Android development`, confidence 0.96).
2. Bot A and Bot B each received a private record.
3. Baseline: both bots returned the Kotlin preference; each returned only its
   own private note.
4. `PHASE6_UNTRUSTED_SHARED_PROBE` was appended directly to
   `shared/MEMORY.md` with `appendFileSync` (device: `adb shell run-as … >>
   …/shared/MEMORY.md`), bypassing every memory API.
5. Before the fix, both bots’ partition results and
   `assembleMemoryForContext` output contained the probe. On restart, the boot
   ingest promoted it again.

Before/after evidence (same tests, same fixture):

| Run | Command | Result |
| --- | --- | --- |
| Vulnerable source restored temporarily | `npx vitest run server/memory-partition.test.ts -t "raw shared-file append"` | **FAIL** — 4 failed, 54 skipped |
| Vulnerable source restored temporarily | `… -t "cannot write the shared document"` | **FAIL** — 1 failed, 1 passed, 56 skipped |
| Fixed source (`sha256 f8e6b929…`) | same two filters | **PASS** — 4 passed / 2 passed |
| Fixed source | `npx vitest run server/memory-partition.test.ts` | **PASS** — 58/58 |

The temporary vulnerable patch removed the shared raw-write refusal and put the
old markdown scans back into both readers. It was restored immediately and the
file’s SHA-256 was re-checked against the saved fixed copy.

## 2. Root cause

Two readers treated the shared **document** as a trust source:

- `queryPartitionedMemory` collected bullet lines from
  `shared/MEMORY.md` into `sharedSnippets`.
- `assembleMemoryForContext` scanned the same file into the shared partition
  used by the prompt.
- The server also re-ingested the document into records at every boot, so an
  appended line would eventually be promoted through the shared gate without
  ever being evaluated as a candidate.

A line’s presence in a file writable by agent shell/file tools was therefore
treated as evidence of approval. No confidence, relevance, provenance, or
lifecycle check stood between the file and model context.

## 3. The fix

Trust now flows only through canonical records and the authorized save path.

### Reader boundary

- `server/memory-store.ts` `queryPartitionedMemory`: only
  `loadMemoryRecords("shared")` with `lifecycle === "active"` feeds shared
  snippets. The markdown scan is gone.
- `server/memory-store.ts` `assembleMemoryForContext`: the shared partition is
  built only from active shared records. The specialized partition is still
  this bot’s workspace only.
- Shared records are hash-verified, retain `sourceTurnId`, `lifecycle`, and
  journal history; the raw document contributes none of these.

### Writer boundary

- `writeMemoryDoc("shared", …, { requestingBotId })` refuses any bot-originated
  raw markdown write with `ERR_SHARED_MEMORY_WRITE_GATE` (403), records a
  `permission_denied` audit row under the acting bot, and leaves the file
  untouched. `writePartitionedMemoryDoc` inherits the same refusal.
- `memory_update` reaches only `/api/internal/memory`, which is bound to the
  sending bot’s own id, so it cannot address the shared partition.
- The person’s save route (`PUT /api/memory/shared`) is unchanged: it carries
  no `requestingBotId`, journals the write, then
  `ingestSharedMarkdown` validates each line through the existing gates
  (confidence > 0.90, universal relevance, secret redaction, duplicate and
  archived-line suppression). Rejected lines remain in the document for the
  person to read but never become records.
- `migrateSharedMarkdownOnce` replaces the old boot re-read: it runs once,
  writes a ledger, stands down when a records file already exists, and ingests
  any pre-Phase-6 text through the same gate.

### What did not change

Atomic 0600 writes, SHA-256 record integrity, the memory journal and security
audit journal, lifecycle/archive semantics, Phase 4 redaction, Phase 5
reconciliation, private partition isolation, and the Android memory UI’s
authoritative reads.

## 4. Tests

New adversarial coverage in `server/memory-partition.test.ts`:

- `Phase 6 AE. a raw shared-file append cannot become trusted context`
  - keeps the probe out of both bots’ partition results and memory context
  - rejects mirror-shaped lines, headings, and imitation metadata
  - does not promote the probe on restart, even through the migration path
  - keeps the probe out of the formatted dynamic context frame for both bots
- `Phase 6 AF. authorized shared editing still reaches both bots`
  - ingests a person’s save through the gate and keeps it available
  - does not resurrect an archived shared belief from its own mirror line
- `Phase 6 AG. a bot cannot write the shared document at all`
  - refuses bot-originated shared markdown through both document APIs and audits it
  - refuses traversal and encoded paths aimed at another bot’s workspace
- `Phase 6 AH. isolation and authorized editing still hold after the fix`
  - keeps private partitions private and shared memory available across a bot switch
  - rejects promotion attempts made through the shared document
  - redacts secrets before a person’s shared save reaches disk or context

## 5. Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | **PASS** (exit 0) |
| Lint | `npm run lint` | **PASS** (0 warnings, 0 errors) |
| Focused memory/security suites | `npx vitest run server/memory-partition.test.ts server/memory-store.test.ts server/memory-routes.test.ts server/memory-reconciliation.test.ts server/memory-room-prompt.e2e.test.ts server/permission-policy.test.ts server/capabilities/context-pipeline.test.ts` | **PASS** — 7 files, 226 tests |
| Journal + thread isolation | `npx vitest run server/memory-journal.test.ts server/thread-aware-bots.e2e.test.ts` | **PASS** — 32 tests |
| Bot memory API | `npx vitest run server/index.test.ts -t "bot memory API"` | **PASS** — 18 tests |
| Post-restore memory suites | 6 files incl. Phase 4 and Phase 5 | **PASS** — 190 tests |
| Server build | `npm run build:server` | **PASS** (exit 0) |
| Android host bundle | `node scripts/prepare-android-host.mjs` | **PASS** — `server.zip` sha256 `e482e3ba…` |
| Android unit tests | `cd android && ./gradlew :core:test :app:testDebugUnitTest` | **PASS** (BUILD SUCCESSFUL) |
| Preview APK | `cd android && ./gradlew :app:assemblePreview` | **PASS** (BUILD SUCCESSFUL) |

## 6. Bundle and device evidence

- `dist-server/index.js` sha256 `7e29026717da22aff1fd0213bee43ba8ca4ac677b3b2cf45b379c6d94fc2ba43`
  contains `shared-document-save`, `markdown-migration`, and the raw-write
  refusal.
- The arm64 preview APK’s `assets/host/server.zip` hashes to the exact
  `e482e3ba…` bundle produced by the host-bundle step.
- The installed preview app’s extracted
  `files/host-server/index.js` hashes to the exact `7e290267…` server build.
- On-device raw append (`adb shell run-as … >> shared/MEMORY.md`) then queries
  through `/api/memory/partitioned/query`:
  **10 PASS, 0 failures** — probe absent from both bots before and after a
  restart, approved Kotlin preference still present, no record fabricated, and
  the person’s document still shows the rejected line.
- On-device authorized save: `PUT /api/memory/shared` returned 200 with a new
  hash; a stale `expectedHash` returned 409.
- UI screenshots:
  `docs/verification/phase6-hardening-final-coder-shared.png` and
  `docs/verification/phase6-hardening-final-researcher-shared.png` show the
  same shared memory on both bots and each bot’s own core memory.

## 7. Pre-existing full-suite failures

A pristine worktree at `b945d727` (detached, no working-tree changes) was used
as the baseline. All 18 non-memory files that failed in the Phase 6 sweep also
fail at HEAD with the same counts:

- 14 files / 30 failures in the first baseline batch (attachments-startup,
  legacy-migration, mcp-gate ×5, notification-wiring, paired-thread-targets,
  peer-allowlist ×8, routine-results, steer-queue ×4, steer-unattended,
  turn-files, vps-routing, workspace-backup, companion proxy ×3,
  openai-chat).
- `openai-chat-tools` 24, `chat-mcp-tools` 16, `comms` 4 at HEAD; identical
  counts in the Phase 6 rerun (44/44).
- `openai-tools.e2e` 1 at HEAD; identical in the rerun.

The earlier `memory-store` (2) and `index` (1) failures did not reproduce:
`memory-store` passes 76/76, and the bot-memory API tests pass 18/18.

## 8. Limitations

- The file-tool/shell boundary is **not** an OS sandbox. A process with the
  data directory can still append to `shared/MEMORY.md`; the fix guarantees
  that such text cannot enter any bot’s model context. It remains visible to
  the person in the document, where they can delete it.
- A local process that rewrites the canonical records file itself is outside
  this boundary; the project does not authenticate its data directory with
  keys. This defect specifically closes the document-to-context promotion.
- The person’s save route is localhost-only and unauthenticated in this
  architecture. Content written through it still has to clear the shared gate
  to become context; a caller that can reach the route cannot bypass the gate.

## 9. Git state

- HEAD: `b945d72756199f004624a980127fdec5c56be6ce` (unchanged; no commit, push,
  reset, clean, or checkout).
- The Phase 1–6 working tree is preserved. Files touched for this hardening:
  `server/memory-store.ts`, `server/index.ts`,
  `server/memory-partition.test.ts`,
  `android/app/src/main/assets/host/server.zip` (rebuilt),
  `docs/verification/phase6-hardening-final-*.png` (new screenshots).
