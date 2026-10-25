# Phase 14 — host identity, crash-injection closure and memory performance

Closes the three gaps left open by
[`phase13-signer-anchor-antirollback-report.md`](phase13-signer-anchor-antirollback-report.md):

1. crash injection had never run on a physical device;
2. after a restart the preview adopted a healthy host that belonged to the **official**
   application, so post-restart rollback verification could not be performed;
3. a 200-record read took ≈1.3 s and a write ≈5.8 s.

All measurements below are from the isolated preview package
(`com.openmausbot.companion.preview`, UID 10286) on the Galaxy A07 (SM-A075F, Android 16). The
official package (UID 10039) was never stopped, cleared, replaced or written to.

---

## 1. Summary

| Gap | Result on the final build |
| --- | --- |
| Physical-device crash injection | **PASS** — all 7 commit transitions, 3 iterations each; every state recovered to exactly one of the two legal outcomes, no data loss, no false rejection, and the store kept accepting writes after each point |
| Ambiguous host adoption | **Fixed** — per-package loopback ports plus a token-bound identity; adoption is removed entirely. Measured on device: a healthy foreign responder is refused, the real official-app host is refused, and a preview restart while the official app is running no longer collides or adopts |
| Post-restart rollback verification | **PASS** — N−1 rejected after a host-only restart *and* after a full app restart; N+1 accepted again |
| 200-record write | **1.55 s** median (was 5.84 s) — only the records that changed are re-sealed |
| 200-record read | **1.37–1.40 s** median — unchanged, and not caused by the anchor (§8) |

No memory format, signing key, MAC scheme, anchor rule or verification path was weakened. The
crash protocol and the anchor ledger are byte-for-byte the same logic as Phase 13; the only
production behaviour added is an identity route and per-package ports on Android.

---

## 2. The adoption failure and the fix

### 2.1 Measured failure (Phase 13 §10.1)

Both packages trusted loopback and both used port `18799`. After the preview was restarted, the
official app's host already owned the port. The supervisor's pre-spawn check was "does
`/api/health` answer 200?", so the preview adopted another application's runtime:

```
E HarnessHost: host-output| Error: listen EADDRINUSE: address already in use 127.0.0.1:18799
I HarnessHost: adopting healthy host already serving 127.0.0.1:18799
```

Every subsequent request was answered by UID 10039's data. That is the ambiguity: a port and a
health status are not an identity.

### 2.2 What replaced it

* **A port per package.** `HarnessHostPort` asks `StandalonePairing.portFor(packageName)`: the
  official app keeps 18799, the preview uses 18789 (`.preview` suffix). Two installations can run
  at once; neither can take the other's port.
* **A per-installation identity token.** `HostIdentity.token()` creates 32 random bytes (64 hex
  characters) once, in `files/host/data/host-instance.token`, mode 0600, and passes it to the
  spawned child as `OMB_HOST_INSTANCE`. No other UID can read the file, so no other package can
  answer with it.
* **A route that requires it.** `GET /api/host/identity` (server/index.ts) compares the
  `x-omb-host-instance` header with `timingSafeEqual`; wrong or missing → 401. A correct answer
  reports `app`, `pid`, `port`, `startedAt`, `version`.
* **Decisions instead of adoption.** `HostIdentity.probe` returns `Absent`, `OwnOrphan`,
  `Foreign` or `Unreachable`. `OwnOrphan` is this installation's leftover host from an earlier
  launch; it has no integrity bridge (the socketpair died with its creator), so it is killed and
  replaced. `Foreign` is a startup failure. `Adopt` no longer exists: a foreign responder never
  receives an application request, and an unknown listener never gets a second host spawned
  against it.
* **The watchdog uses the same identity**, so a different package taking the port mid-run is no
  longer "healthy".

`HostIdentityTest` (8 tests) pins: absent → spawn; own token → own orphan; wrong token → foreign;
no identity route → foreign, never adopted; 200 naming a different app → foreign; 200 naming a
different port → foreign; token creation (64 hex, stable, 0600 file); per-package ports.

---

## 3. Host identity on the device

Raw evidence: `.omb-scratch/p14-identity-device.log`, `.omb-scratch/p14-foreign-listener.log`.

| Check | Result |
| --- | --- |
| Preview host, its own token | `200 {"app":"openmausbot","pid":24148,"port":18789,"version":"1.1.1-threads-preview"}` |
| Preview host, wrong token | `401 {"error":"host identity is not established"}` |
| Preview host, no token | `401` |
| Token file | 65 bytes (64 + newline), `-rw-------`, owner `u0_a286` |
| Official 1.1.1 host, `/api/health` (the old criterion) | `200` — it *is* healthy |
| Official 1.1.1 host, `/api/host/identity` with the preview token | `404 {"error":"no route: GET /api/host/identity"}` → `Foreign("no host-identity endpoint")` |
| Preview restart while the official host is serving 18799 | back on its own port, its own pid (24148 → 24715), its own 11 fixtures; `EADDRINUSE` 0; `FATAL` 0 |

### 3.1 The original failure, replayed on the device

A foreign process (the `adb shell` UID, its own SELinux domain) held `127.0.0.1:18789` and answered
`200` to the identity probe — the exact shape that used to be adopted. The preview presented its
token and refused:

```
E HarnessHost: HOST FAILED: another application is serving 127.0.0.1:18789
  (the responder is not an OpenMausBot host); refusing to adopt it — memory integrity
  fails closed rather than trusting a foreign host
```

No host was spawned against the listener (`10:10:11`–`10:10:30` contains no `process started`).
After the listener was removed, the next launch served normally (`200`, identity pid 28320). The
responder never received an `/api/...` request, only the identity probe, and the probe's token is
redacted here and in the harness log.

**NOT RUN on device:** the `OwnOrphan` reclaim path end-to-end. No orphan survived a restart in
this fixture (`am force-stop` takes the child with it), and manufacturing one would mean killing
the supervisor mid-boot; the decision and the wait-for-port loop are unit-tested, the kill is
`Process.killProcess` on a UID-verified pid.

---

## 4. Crash injection on the final build

Raw evidence: `.omb-scratch/p14-crash-final.log` (script `p14-crash-final.sh`).

Method: for each of the seven transitions, arm `settings put global omb_crash_point <point>`,
force-stop and relaunch so the spawned host inherits it, `POST` one record, let the supervisor
respawn the host, read the store back, then clear the point and prove the same store still accepts
an ordinary write. The point stays armed during the recovery boot, so recovery runs under the same
injection. Three iterations per point, on a fresh fixture (`Crash final`).

| Point | Write | After recovery | Verdict |
| --- | --- | --- | --- |
| `before-prepare` | no response (killed before any durable step) | 0 records, no manifest, no anchor — nothing happened ×3 | PASS |
| `after-prepare` | no response | records and manifest unchanged; anchor holds `pending=2`; read 200 ×3; a normal write then commits it | PASS |
| `after-records` | no response | recovery completes the prepare: new record present, generation committed (2→3, 3→4, 4→5) ×3 | PASS |
| `after-manifest` | no response | manifest is durable, anchor pending; next read commits it (6→7, 7→8, 8→9) ×3 | PASS |
| `before-commit` | no response | same state as `after-manifest`, same recovery (10→11, 11→12, 12→13) ×3 | PASS |
| `after-commit` | no response | generation already official; next read 200 (14→15, 15→16, 16→17) ×3 | PASS |
| `after-response` | `200` | client saw success, process died after the response; next read 200 (18→19, 19→20, 20→21) ×3 | PASS |

After every point, a write issued once the injection was cleared succeeded (`0→1`, `1→2`, …,
`21→22`). Final state: `seq=22 count=22 anchor gen=22`, `FATAL` lines 0. The injected death is a
real `SIGKILL` of the writer; the arming lines ("crash injection armed at '…'") are in logcat for
every iteration.

This is on the **final** build (§10): the earlier crash logs at 23:00 predate the MAC-reuse change
and are superseded by this matrix, not relied upon.

**Not run:** crash injection at 200 records. The transitions are record-count independent (the
durable sequence is prepare → records → manifest → commit, once per write); the 200-record cost is
covered by §8 instead.

---

## 5. Rollback after restarts (the Phase 13 steps 10–11)

Raw evidence: `.omb-scratch/p14-restart-rollback.log`.

| Step | Result |
| --- | --- |
| Baseline, fixture D | `seq=4 count=4 anchor=gen=4 http=200` |
| Legitimate write (N → N+1) | `200`, `seq=5 count=4 anchor=gen=5` |
| Host-only restart (`SIGKILL` the host, supervisor respawns) | new pid in 7 polls; identity names the preview; state still `seq=5 gen=5`; read 200 |
| Restore N under the moved anchor | **500** `ERR_MEMORY_INTEGRITY: records.json is generation 4 but generation 5 was committed: this store was rolled back`; anchor still `gen=5` |
| Restore N+1 | 200 (`a legitimate state is still accepted`) |
| Full app restart (`am force-stop` + launch) | new pid, identity OK, state `seq=5`, read 200 |
| Restore N again | **500** on the store route **and** on `POST /memory/partitioned/query`; anchor `gen=5` |
| Restore N+1 | 200; final `seq=5 count=4 anchor=gen=5`; `FATAL` 0 |

Unlike Phase 13, no `EADDRINUSE` appears and the preview never talks to the official host: it
restarts on 18789 with its own identity and its own store.

---

## 6. Anchor corruption and absence (re-confirmed on this build)

Raw evidence: `.omb-scratch/p14-anchor-tamper.log`.

| Case | Result |
| --- | --- |
| One character of the anchor's MAC changed, signer restarted | read **500** `… the signer refused an anchor read: rollback anchor failed its own MAC check`; the file is not re-baselined |
| Anchor deleted (the "fresh signer" state), signer restarted | read **500** `… no rollback anchor is recorded for this store and this boot is not authorized to establish one; memory sealed before anchoring …` |
| Exact backup restored, signer restarted | read **200**, count 4, anchor `ba85f7b9cc38c7b8` |

The anchor is not repairable by the app, only by an authorized baseline; hand-editing fails closed
because the file's own MAC covers it.

---

## 7. Two bots, one device: context stays partitioned

Phase 13 could not run a two-bot context window. This phase exercises the memory slice that feeds
it, on the device, for two live stores:

| Bot | Query | Specialized snippets | Shared | Snippets from another bot |
| --- | --- | --- | --- | --- |
| `ea88e4c2` (206 records) | "Perf" | 5 | 0 | 0 (5/5 paths under `bots/ea88e4c2…`) |
| `42f1dc68` (22 records) | "Crash probe" | 5 | 0 | 0 (5/5 paths under `bots/42f1dc68…`) |

A full model turn with two bots' context windows was **NOT RUN**; the partitioned-query boundary
is the part that decides which records a turn may see, and `memory-partition.test.ts` covers the
same rule at unit level.

---

## 8. Performance

Raw evidence: `.omb-scratch/p14-perf3.log` (final build), plus fresh samples taken for this report.
Conditions: SM-A075F, Android 16, every number over `adb forward` loopback HTTP
(`curl -w %{time_total}`), preview package, signer in a separate UID with a software-backed
Keystore key (`level=1`).

| Case | Phase 13 | Phase 14 (final build) |
| --- | --- | --- |
| `GET /memory/records`, 0-record store | 8 ms (n=10) | **12–13 ms** (n=5/6) |
| `GET /memory/records`, 22-record store | — | **331 ms** (n=5; re-sampled at 25 records: 230 ms) |
| `GET /memory/records`, 200(+)-record store | 1311 ms (n=10) | **1373 ms** (n=6) / **1404 ms** (n=5, fresh) |
| `POST /memory/records`, one record, 22-record store | — | **363 ms** (n=3) |
| `POST /memory/records`, one record, 200(+)-record store | 5835 ms (n=5) | **1549 ms** (n=5) |
| `POST /memory/partitioned/query`, 200(+)-record store | 2684 ms (n=10) | **2708 ms** (n=4) |
| App restart → HTTP ready | 9771 ms (n=1, migration boot) | **5926 / 6475 ms** (n=2) |

### 8.1 Why the write got 3.8× faster without weakening anything

`sealMemoryIntegrity` now keeps the prior MAC for a record whose canonical payload is
byte-identical to what the prior manifest already covers. HMAC over the same bytes under the same
key *is* the same value; the only thing skipped is recomputation. Soundness comes from three
bounds:

1. reuse only when the prior manifest has the same authority and version (the v2→v3 migration
   still re-signs everything);
2. only for records whose bytes are unchanged, which the prior manifest authenticated on load;
3. the save path refuses to reuse against bytes that changed after the verified load — if
   `records.json` no longer hashes to the hash the load verified, the store is verified again
   before sealing, and a tampered store throws (`memory-integrity.test.ts`, "signs only the
   records a write actually changed…", including the plant-after-load case).

The crash-recovery path is the opposite and disables reuse (`reusePriorMacs: false`): the
interrupted write already replaced `records.json`, so comparing it with the prior manifest would be
self-satisfying and could carry an old MAC onto new bytes. Recovery signs every record.

The anchor adds one Binder transaction per load (`head`) and two per mutation
(`prepare`, `commit`); it is not the cost. A 0-record store answers in 12 ms, below the ≈17 ms
Phase 13 measured for serving `MEMORY.md`.

### 8.2 Why the read is still ≈1.4 s — and what that means

Every load still verifies every record MAC through the signer; that is the guarantee, and there is
no cache that could survive an external mutation, a signer restart or an integrity failure. MACs
are already batched into one bridge call, so what remains is O(records) Keystore HMAC
verifications: 0 records = 12 ms, 22 = 331 ms, 200 = ≈1.4 s. A write pays the same load
verification plus one HMAC for the changed record, which is why a 200-record write is 1.55 s
rather than 5.8 s, and a 22-record write is 0.36 s.

So the honest answer to "can memory stay responsive without weakening integrity": **writes are now
interactive (0.36 s at 22 records, 1.55 s at 200); reads are still linear in record count
(≈7–10 ms/record on this device)**. Making reads sub-second at 200 records would need a different
verification shape — e.g. a signed Merkle root so a load checks one MAC and hashes locally — which
changes the manifest format and was not done here. No verification was skipped, cached or made
sampling in this phase.

The cold-start numbers are not comparable to Phase 13's single sample: that boot also ran the
v2→v3 migration and the anchor roster pass, while these two boots had nothing to migrate.

---

## 9. Checks

All commands run on the final source state. The installed bundle is newer than every server source
it embeds, and the installed `index-android.js` hash equals the zip entry (§10).

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` (`tsc -b && tsc -p tsconfig.server.json`) | exit 0 |
| Lint | `npm run lint` (`oxlint --deny-warnings .`) | exit 0, 0 warnings / 0 errors, 1583 files |
| Memory suites | `npx vitest run server/memory-integrity.test.ts server/memory-store.test.ts server/memory-partition.test.ts server/memory-reconciliation.test.ts server/memory-routes.test.ts` | 5 files, **269 tests passed** |
| API surface | `npx vitest run server/index.test.ts` | 1 file, **231 tests passed** (538 s) |
| `:app` unit tests | `./gradlew :app:testDebugUnitTest` | 147 suites, **1173 tests, 0 failures** (includes `HostIdentityTest`, 8 tests) |
| `:signer` unit tests | `./gradlew :signer:testDebugUnitTest` | **23 tests, 0 failures** |
| `:core` unit tests | `./gradlew :core:test` | 57 suites, **608 tests, 0 failures** (up-to-date results; no core source changed in this phase) |
| Preview APK | built 00:58:15, 4 ABIs | installed 00:58:22 |
| Android host bundle | `server.zip` built 00:52:05 | newer than every embedded source |

**NOT RUN:** the complete repository suite (885 detected test files); this phase ran the memory
suites and the API file, as Phase 13 did. Also not run: UI-level flows for identity failures, and a
full model turn for the two-bot context.

---

## 10. Final artifact identity

| Artifact | Identity |
| --- | --- |
| HEAD | `b945d72756199f004624a980127fdec5c56be6ce` (unchanged) |
| `server.zip` | sha256 `8d28f4ac7dd5d61d40642b8bdf78a4f7234ed64b06f4ac5bd7adf5cfe35275c4`, 10 986 627 bytes, built 00:52:05 |
| Installed extraction stamp `files/host-server/server.version` | `8d28f4ac…75c4` — identical |
| `index-android.js` inside the zip | sha256 `0f3703964c296dd96839a8aed5091f9b360fd43d5bd3e001c94d2ff044c1548a` |
| Installed `files/host-server/index-android.js` | same sha256 |
| Installed bundle contains | `reusePriorMacs` (2×) and `/api/host/identity` token header |
| Preview APK (arm64) | sha256 `4304a332a801881ccdc15f7291869c2d7428c94e6d148b2438c929437d12aeec`, 85 234 090 bytes |
| Signer APK | sha256 `716a33c478f2f2c896fc23d6d8622e75758ba10d9a57c2226182f582df23a35b`, 920 894 bytes |
| Preview / signer / official UIDs | 10286 / 10280 / 10039 |
| Versions | preview `1.1.1-threads-preview`, signer `1.0.0`, official `1.1.1` |
| Keystore capability | `key level=1` (software-backed), `identity=starttime` |
| Anchor | 10 stores; fixture F `gen=206`, crash fixture `gen=22`; file MAC-verified on every read |

No source file in the app module is newer than the 00:58:15 APK, and no server source is newer
than the 00:52:05 bundle.

---

## 11. Files changed in this phase

**New**

* `android/app/.../host/HostIdentity.kt` — token, probe decisions, reclaim
* `android/app/.../host/HarnessHostPort.kt` — the port this package owns
* `android/app/src/test/.../host/HostIdentityTest.kt` — 8 tests
* `docs/verification/phase14-host-identity-crash-and-performance-report.md` — this file

**Edited**

* `android/app/.../host/HarnessHost.kt` — identity probe replacing the health-only adoption;
  token in the spawn environment (redacted in the log); watchdog liveness via identity
* `android/app/.../host/StandalonePairing.kt` — 18799 official / 18789 preview, `portFor`, self
  endpoint/connection helpers
* `server/index.ts` — `GET /api/host/identity`, constant-time token compare, 401 otherwise
* `server/memory-integrity.ts` — unchanged-record MAC reuse in `sealMemoryIntegrity`; recovery
  explicitly disables reuse
* `server/memory-store.ts` — save-path check that the bytes still match what the load verified
  before any reuse
* `server/memory-integrity.test.ts` — "signs only the records a write actually changed, and keeps
  every other MAC", plus the plant-after-load rejection
* `android/app/src/main/assets/host/server.zip` — rebuilt bundle

**Not touched:** `memory-crash-point.ts`, the anchor AIDL/service/ledger, the node setup, and every
verification rule from Phase 13.

**Generated, not committed:** preview/signer APKs, `.omb-scratch/` evidence (ignored). No commit,
push, stage, reset or checkout; the rest of `git status` is the pre-existing Phase 1–13 working
tree.

---

## 12. Limitations, stated plainly

* The own-orphan **reclaim** path is unit-tested but not exercised end-to-end on device (§3.1).
* Crash injection used a 0→22-record store, not 200 records (§4).
* The full 885-file repository suite was not run; the memory suites and `index.test.ts` were.
* Two-bot isolation is verified at the partitioned-query level, not through a model turn (§7).
* The official 1.1.1 build has no identity route, so its refusal is measured as 404; a build with
  the route would answer 401. Both are `Foreign` and both are pinned by unit tests.
* Read latency is still linear in record count; no cache or weaker verification was introduced to
  hide it (§8.2).
