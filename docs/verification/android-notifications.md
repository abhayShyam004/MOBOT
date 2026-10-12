# One notification per conversation (Android)

A chatty bot used to fill the shade: one notify frame per settled reply, each
posted under its own id (`openmaus.{threadId}.{seq}`, which is still what iOS
keys its banners on), so fifty messages meant fifty rows and a single sign-off
could ring the phone fifty times. This record is the phase that replaced that
with **one standing notification per conversation**, silent while the person is
reading that conversation, and the device evidence that it does.

The policy is not spread through the poster. It lives in one pure object,
`NotificationAggregator`, whose input is a frame plus two facts — which
conversation is on screen, and whether this app is in front of the person — and
whose output is one of three effects: nothing, post-or-update this
conversation's notification, or take it out of the shade.

| Rule | Where it is decided | Why it is the rule |
| --- | --- | --- |
| The conversation on screen is silent | `onFrame`, `foreground && visibleThreadId == frame.threadId` | A banner for the thing you are looking at is noise. Foreground is part of the test: the same thread behind the launcher is not being read. |
| One chat, one notification | `notices` is keyed by `threadId` | An update is a visible `number` change, not a repost the person cannot tell apart. |
| The first frame keeps the bot's words | `count == 1` branch | One reply should still say what the bot said; from the second on it reads `Vega` / `4 new messages`. |
| A question is never spoken over | `!frame.isBlocking && standing?.blocking == true` | The count moves, the content does not: what the person has to act on stays until they act on it. |
| Ids are per conversation and stable | `NotificationMapping.notificationId(threadId)` (FNV-1a, 31-bit, collision-probed) | A restarted process updates the notification the previous one posted instead of adding a twin. |
| Opening the chat ends it | `showing(threadId)` → `forget` + `manager.cancel` | Opening a chat is what "read" means for a banner. |

The glue that feeds it is `LocalNotificationPoster`: channels (`bot_messages`,
`approval_question`, `routine_failed`), the builder, `.setNumber(notice.count)`,
blocking → `PRIORITY_HIGH`/`CATEGORY_ALARM`, and the cancel that opening a chat
has to perform. Where the person *is* comes from `ChatVisibility` (plain
`@Volatile` fields) written by two producers: `RootScreen` maps the current
destination to `showing(threadId)`/`hidden()`, and `ForegroundObserver` — a
`DefaultLifecycleObserver` installed by `OpenMausApp`, because the process
lifecycle is what "the app is in front" means, not the Activity's — maps
`onStart`/`onStop` to `setForeground`. Neither producer reads a Compose state
flow on the way to the poster, so a frame is judged against the moment it
arrived.

## Automated checks

```
npx oxlint --deny-warnings scripts/test-android-notifications.mjs   # 0 warnings, 0 errors
cd android && ./gradlew :app:testDebugUnitTest :core:test --offline  # BUILD SUCCESSFUL
```

- `notifications/NotificationAggregatorTest.kt` — 10 tests, no Android types at
  all: the visible chat, the burst that becomes one aggregated notice, the
  blocking frame that is not repainted, count continuity, id stability, and id
  collision probing.
- `notifications/NotificationCoalescingTest.kt` — 9 Robolectric tests that read
  the real `NotificationManager` (`shadowOf(...).allNotifications`): row counts,
  `number`, title/text, channel, blocking priority, the no-permission case, and
  the same id across a simulated restart.
- `lifecycle/SessionLingerWiringTest.kt` — the wiring guard: `OpenMausApp` may
  hold no inline `DefaultLifecycleObserver` (that is the linger's job) and must
  install `ForegroundObserver`.

`:app:testDebugUnitTest` reports **1034 tests over 124 files, 0 failures, 0
errors** (1015 before this phase) and `:core:test` **563 over 52**, read from the
JUnit XML under `android/app/build/test-results/`. The last actual execution was
that phase's run; the verification invocation after it reports `BUILD SUCCESSFUL`
with every task `UP-TO-DATE`, i.e. Gradle reusing those results because the
Kotlin sources have not changed since. What the device driver changed after it
is JavaScript only.

## The device driver

```sh
node scripts/test-android-notifications.mjs \
  android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

Two throwaway bots on the phone's own host, pointed at the deterministic mock
provider the other device suites use (`scripts/omb-openai-mock.cjs`, run on the
phone), and the shade read the way the system reports it:
`dumpsys notification --noredact`, one `NotificationRecord(...)` block per row,
taking its own `id`, `number`, channel, title and text. A poster that only
*claimed* to coalesce would fail here exactly like one that did not.

Two rows are deliberately not counted, and neither is a notification the app
posted:

- `host_status` — the app saying it is hosting (`HarnessService`). It is always
  there, and counting it would make "zero notifications" unobservable.
- the **auto-group summary** Android invents for an app that posts without
  declaring groups (`tag=0|pkg|g:Aggregate_NormalNotificationSection`,
  `flags=GROUP_SUMMARY|AUTOGROUP_SUMMARY`). It is a platform artifact of the row
  below it, not a second message: the first version of this driver counted it as
  one, which is how one notification read as two and coalescing first looked
  broken. The app's own rows are the ones with `tag=null`.

While the always-on connection is on, the app also holds its own
`always_on_status` row ("MausBot is staying connected"); it is excluded for the
same reason as `host_status`.

### The connection has to be open, and the driver opens it the app's way

Notify frames arrive over the app's own stream, and a backgrounded app keeps
that stream for the linger window only — `SessionLingerController.WINDOW_MILLIS`
= 25 s, matching iOS — after which it disconnects and a bot's later answer is
announced when the app is next opened rather than while the person is away. The
app's own answer to that is its opt-in **always-on connection**, whose service
was written for exactly this ("Notifications will reach you even with the app
closed", `always_on_notification_text`).

So the driver turns that switch **on** for the run — by writing the app's own
preference (`openmaus.always_on.xml`, `enabled`) and letting `OpenMausApp`
launch `AlwaysOnConnectionService` on its next start, then reading both back —
and **restores it exactly as it found it** before it exits (absent stays absent).
That is what makes "ten messages behind the launcher" mean ten frames, and
therefore `10 new messages`; without it this driver would be measuring the
linger window instead of the policy. The run that showed it had no switch at
all: ten background turns produced one row that said **6** — exactly the turns
whose frames landed inside the 25 s window — and the second bot's row did not
appear until the app was next brought forward, when the frames missed in
between were replayed from the client's cursor. (`/tmp/omb-notify-final.log`;
the runs after it, `/tmp/omb-notify-run4.log` … `run6.log`, hold the switch on
for the run and restore it at the end.)

## Recorded pass — 2026-10-07, SM-A075F (arm64-v8a, API 36)

Bundle `android/app/src/main/assets/host/server.zip` sha256
`d808f45ef691e89237cc2bba4582ddac1c5295e5313f48b77dc7df6530308cbb` (10,173,145
bytes); debug APK `app-arm64-v8a-debug.apk` 72,611,144 bytes sha256
`e3045936303104090841019ad714f47bec496d0f72f4c1ac2a0ab8ddd68c46bd`. Device
serial `R8YY90VT4EM`. The install itself was done by an earlier run of the same
build (`adb install -r -g`); the pass below ran `--skip-install`, so what it
exercised is the APK just named.

What that run asserted, in order — every check line from
`/tmp/omb-notify-run7.log`, with the runs' `mCurrentFocus` window dumps trimmed
for reading (the file has them in full):

```
PASS: host healthy on device
PASS: exactly one host process
PASS: the app is hosting again after the setting took
PASS: the setting reads back on, as the app persists it — was null
PASS: the foreground service holding the stream open is running

== two bots on the device's own host ==
PASS: two bots created — fa8eed77, d414c128
PASS: deterministic mock provider running on device
PASS: fixture provider instance created — http 201
PASS: refreshed catalog is the mock's

== a burst in the chat being read ==
PASS: the mock answered two turns
PASS: bot A's conversation is on screen, showing its newest reply — showing "DONE"
PASS: three more turns settle while that chat is open
PASS: reading the chat produces no notification at all — 0 rows in the shade
PASS: the app is still the foreground app

== ten messages behind the launcher ==
PASS: the app is backgrounded
PASS: ten turns settle in the background — 10 of 10 answered
PASS: the app stayed behind the launcher throughout
PASS: exactly one notification for the conversation — 1 row(s): 459657539/10
PASS: it carries the whole burst — number=10
PASS: and says so — text="10 new messages"
PASS: on the bot-message channel — channel=bot_messages
PASS: nothing else of the app's is in the shade but its own running notices

== another burst updates that one notification ==
PASS: three more turns settle — 3 of 3 answered
PASS: the app stayed behind the launcher throughout
PASS: still one notification — 1 row(s)
PASS: updated to thirteen — number=13
PASS: under the same id — 459657539 → 459657539

== a second conversation ==
PASS: bot B answers twice — 2 of 2 answered
PASS: two conversations, two notifications — 1075420006, 459657539
PASS: bot B's row is a different id
PASS: and bot B's row is not bot A's

== rotation ==
PASS: rotation leaves the shade exactly as it was — 1075420006/2,459657539/13 → 1075420006/2,459657539/13

== opening the chat ==
PASS: bot A's conversation is open again — showing "DONE"
PASS: its notification is gone — 1075420006
PASS: the other conversation keeps its own — 1075420006

== process restart ==
PASS: bot A answers before the restart
PASS: bot A has a notification before the restart — id=459657539 number=2
PASS: one host after the restart
PASS: the always-on service came back with the process
PASS: the mock provider is serving again
PASS: bot A answers after the restart
PASS: still exactly one notification for that conversation — 1 row(s) total
PASS: under the id the previous process used — 459657539
PASS: and it counts the new turn — number=2

== cleanup ==
PASS: fixture provider instance removed — http 200
PASS: the shade holds nothing of the app's afterwards — 0 row(s) left
PASS: the always-on setting is back as it was found — null → null
PASS: no service is running for a setting that is off
PASS: no probe bot left behind — Vega, Poppy, Fig, Hazel, Fix panel test, Quill
PASS: no fixture provider left in the catalog — grok, kimi, … , api-test-gateway

NOTE: this run added 24 rows to the app's usage ledger; 168 rows there name a
bot this driver made. The ledger is the app's own append-only record of turns
that really ran, all of them at zero cost, and nothing prunes it.
```

Reading the log: the twenty-five seconds of the linger window are what the
always-on switch buys, the id is the same one across a burst, a rotation and a
whole process restart, and the count restarts at one for a fresh process
(its `number` is frames *this* process has announced, which is why the
restarted one says 2 after two more replies rather than 15).

Each burst is deliberately sequential — one message, wait for its reply, next —
because the harness *queues* sends that arrive mid-turn and can fold several
into one turn, which is right for a person typing ahead and wrong for counting.

## What the platform did on its own, and what that proved

Two behaviours worth noting came out of the runs rather than out of the code.

**A tap mid-run is the feature, not a flake.** Run 5 (`/tmp/omb-notify-run5.log`)
failed `updated to thirteen` with `number=1`, while the rest of it passed. The
logcat for that minute shows why:
`NotificationManager(30491): notify(157572404, …)` thirteen times, then
`startActivity … act=com.openmausbot.companion.OPEN_NOTIFICATION
dat=openmaus://notification/… (realCallingUid=10052)` — SystemUI, i.e. a tap on
the banner by a person in the room. Opening that conversation withdrew the row
(`No notification with key … 157572404`, because `setAutoCancel` had already
taken it) and the next message counted from one again. That is the policy
working end to end, through the notification's own content intent, on the first
tap. The driver now says so: it checks that the app stayed behind the launcher
through each background burst, and every count assertion appends the front-most
window when it did not.

**Android's own grouping is visible in the shade and is not ours.** The
auto-group summary above was found by reading one run's failure carefully; it is
excluded by `tag`, never by assuming the count.

## Left clean

- Both throwaway bots deleted (`DELETE /api/bots/:id`); `/api/bots` afterwards
  lists exactly the person's six — Vega, Poppy, Fig, Hazel, Fix panel test,
  Quill.
- The fixture provider instance (`Notify device fixture`) is removed, the mock
  process is stopped and its file (`files/ombmock.cjs`) deleted.
- The always-on preference is back as it was found (it had never been set; the
  file is gone and the service is not running), and the shade holds no row of
  the app's but its own running notice.
- The phone's own bots were never messaged, and no provider, channel or system
  setting was written by the driver.
- **One residue the driver reports instead of removing:** the host writes every
  settled turn into the person's own usage ledger
  (`files/host/data/usage/<month>.jsonl`), and a deleted bot's rows stay — this
  run contributed 24 of them, and the ledger as a whole holds 168 rows naming a
  bot this phase made (all `input: 0`, `output: 0`, `costUsd: null`: the mock
  charges nothing, so no spend figure is affected). The ledger is the app's
  append-only record of turns that really ran and there is no API that prunes
  it; rewriting the file under a running app is a worse idea than saying so.
  The driver prints the count on every run, so it can never be silent.

## What this does not prove

- **The count counts frames, not transcript rows.** `NotificationAggregator`
  says so in its own kdoc, and the shade's `number` is the number of notify
  frames that conversation contributed since its notification was last cleared.
  A turn that answers several queued messages is one frame and so counts once,
  and a process restart starts at one again — the notification, not a promise
  about the unread list. This is deliberate (the frame is what the shade was
  told about), and it is why the driver counts settled turns rather than
  messages when it asserts an exact number.
- **Without the always-on switch, background delivery stops at the linger
  window.** That is the pre-existing behaviour of the connection, not of the
  policy: a bot that answers ten minutes after the person leaves the app is
  announced when the app is next opened. The app's answer to that is the
  opt-in switch, and this record proves the policy holds while it is on; it does
  not prove that a person who leaves it off will be told while they are away.
- **Blocking frames were not driven on the device in this pass.** A question or
  approval taking the row and keeping it, and later messages not repainting it,
  is proven by `NotificationCoalescingTest` (`an approval keeps the row and
  later replies do not repaint it`) rather than by the phone.
- **The tap path is evidenced, not asserted.** The mid-run tap above shows one
  real SystemUI tap doing the right thing; the driver's own "open the chat"
  step navigates the UI (roster → row), so a run that passes does not by itself
  re-prove the content-intent path. `ui/NotificationOpenTest.kt` covers the
  intent handling in the unit suite.
- **One device, one ABI.** `arm64-v8a` only, on the person's own phone, with the
  person's own data next to it; `armeabi-v7a` and `x86_64` are built but never
  run. Channel importance and the heads-up look are the phone's Samsung-SystemUI
  reading of `IMPORTANCE_HIGH`, not a guarantee on other skins.
- **The always-on switch is a foreground service.** It shows its own persistent
  notification, and the driver turns it on by writing the preference and
  restarting the process — not by tapping the settings toggle, so the toggle's
  own UI (and the battery-optimisation prompt it raises) is not covered here.
