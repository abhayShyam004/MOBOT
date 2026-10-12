#!/usr/bin/env node
// PHASE A acceptance test: what actually reaches the notification shade.
//
//   node scripts/test-android-notifications.mjs <apk>
//
// The requirement, on a real phone, with the real app and the real host:
//
//   VISIBLE BOT            → 0 notifications, however many messages arrive
//   BACKGROUND BOT         → 1 notification
//   TEN MORE MESSAGES      → still 1 notification, updated with the count
//   SECOND BOT             → 1 notification of its own
//   OPEN THE BOT           → its notification is gone, the other stays
//   ROTATION / RESTART     → no duplicate row, the same notification id
//
// The shade is read the way a person's would be: `dumpsys notification` is the
// system's own record of the rows it is holding, so a poster that claimed to
// coalesce would fail here exactly like one that did not. The bot's replies come
// from the deterministic mock provider the other device suites use
// (`scripts/omb-openai-mock.cjs`), run on the phone itself — this is about
// notification behaviour, not about a model's judgement, and a real provider
// would make the burst slow and unrepeatable.
//
// The background half of this needs the connection to still be open. A
// backgrounded app keeps its stream for the linger window only (25s, matching
// iOS — `SessionLingerController.WINDOW_MILLIS`), after which a bot's answer
// arrives with the app's next foreground; the app's own answer to that is its
// opt-in **always-on connection**, whose foreground service exists for exactly
// this ("a notify frame that arrives with the app fully closed still reaches
// `LocalNotificationPoster`"). The driver turns that switch on the way the
// person's toggle would — by writing the same preference and then letting the
// app's own start-up path launch the service — and puts the setting back
// exactly as it found it before it exits. That is what makes "ten messages
// behind the launcher" mean ten frames, and so "10 new messages": without it
// this driver would be measuring the linger window, not the policy.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const APK = args.find((a, i) => i === 0 || !a.startsWith("--"));
const SKIP_INSTALL = args.includes("--skip-install");

const PKG = "com.openmausbot.companion";
const PORT_DEVICE = 18799;
const PORT_HOST = 28799;
const MOCK_PORT_DEVICE = 18787;
const MOCK_PORT_HOST = 28787;
const BASE = `http://127.0.0.1:${PORT_HOST}`;
const STAMP = Date.now();
const BOT_A = `Notify probe A ${STAMP}`;
const BOT_B = `Notify probe B ${STAMP}`;
const failures = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const adb = (cmd, opts = {}) => execFileSync("adb", cmd.split(" "), { encoding: "utf8", timeout: opts.timeout ?? 60_000, ...opts });
const shell = (cmd, opts = {}) => adb(`shell ${cmd}`, opts).replace(/\r/g, "");
const step = (label) => console.log(`\n== ${label} ==`);
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
  return ok;
}

async function api(method, path, body, { timeoutMs = 20_000 } = {}) {
  const init = { method, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined && method !== "GET") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, json, text };
}

async function botTexts(threadId) {
  const list = (await api("GET", `/api/threads/${threadId}/messages?limit=60`)).json?.messages ?? [];
  return list.filter((m) => m.kind === "text" && (m.role === "bot" || m.role === "assistant")).map((m) => m.text ?? "");
}

// ── the shade, as the system reports it ─────────────────────────────────────

/**
 * Every notification the system is holding for this app, with the fields the
 * assertions are about. `dumpsys notification --noredact` prints one
 * `NotificationRecord(...)` block per row — its own `id`, the `number` the row
 * carries, the channel it was posted on, and the title/text the shade would
 * draw. Nothing here is inferred from the app's own logs.
 */
/** The channels this app posts *conversation* notifications on. */
const CONVERSATION_CHANNELS = new Set(["bot_messages", "approval_question", "routine_failed"]);

/** The app's own always-there rows: "hosting" and, while it is on, "always on". */
const RUNNING_NOTICE_CHANNELS = new Set(["host_status", "always_on_status"]);

function allRows() {
  const dump = shell("dumpsys notification --noredact", { timeout: 60_000 });
  const blocks = dump.split(/^\s{4}NotificationRecord\(/m).slice(1);
  return blocks
    .map((block) => {
      const head = block.slice(0, 400);
      const pkg = /pkg=([\w.]+)/.exec(head)?.[1] ?? "";
      const id = /id=(-?\d+)/.exec(head)?.[1];
      const tag = /tag=(\S+)/.exec(head)?.[1] ?? "null";
      const number = /number=(-?\d+)/.exec(block)?.[1];
      const title = /android\.title=String \((.*)\)/.exec(block)?.[1] ?? "";
      const text = /android\.text=String \((.*)\)/.exec(block)?.[1] ?? "";
      const channel = /channel=([\w.-]+)/.exec(block)?.[1] ?? /channelId=([\w.-]+)/.exec(block)?.[1] ?? "";
      return { pkg, id, tag, number: number === undefined ? null : Number(number), title, text, channel };
    })
    .filter((row) => row.pkg === PKG);
}

/**
 * The rows this driver is about: one per conversation, on the channels the
 * poster owns.
 *
 * Two kinds of row are deliberately not counted, and neither is a notification
 * the app posted:
 *
 *  - `host_status` (and, with the always-on switch on, `always_on_status`): the
 *    app saying it is running. The first is always there (the phone is hosting),
 *    and counting either would make "zero notifications" unobservable.
 *  - the **auto-group summary**. Android invents one for an app that posts
 *    without declaring groups — `tag=0|pkg|g:Aggregate_NormalNotificationSection`,
 *    `flags=GROUP_SUMMARY|AUTOGROUP_SUMMARY` — and it is a platform artifact of
 *    the row below it, not a second message. Counting it makes one notification
 *    read as two, which is exactly how the first run of this driver mis-reported
 *    coalescing as broken; the app's own row is the one with `tag=null`.
 */
function shade() {
  return allRows().filter((row) => row.tag === "null" && CONVERSATION_CHANNELS.has(row.channel));
}

const ours = () => shade();
async function shadeSettles(predicate, timeoutMs = 60_000, everyMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  let rows = ours();
  while (Date.now() < deadline) {
    rows = ours();
    if (predicate(rows)) return rows;
    await wait(everyMs);
  }
  return rows;
}

// ── the screen, so "the person is reading this chat" is real ────────────────

function uiDump(tag) {
  const path = `/sdcard/omb-notify-${tag}.xml`;
  shell(`rm -f ${path}`);
  const out = shell(`uiautomator dump ${path}`, { timeout: 40_000 });
  if (!/dumped to/i.test(out)) return null;
  return shell(`cat ${path}`);
}

function nodeFor(xml, label) {
  if (!xml) return null;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const node = new RegExp(`<node[^>]*?(?:text|content-desc)=["']${esc}["'][^>]*>`).exec(xml)?.[0];
  if (!node) return null;
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
  if (!bounds) return null;
  return { x: (Number(bounds[1]) + Number(bounds[3])) / 2, y: (Number(bounds[2]) + Number(bounds[4])) / 2 };
}

const tap = (node) => shell(`input tap ${Math.round(node.x)} ${Math.round(node.y)}`);

function focusLine() {
  return shell("dumpsys window 2>/dev/null | grep -m1 mCurrentFocus", { timeout: 30_000 }).trim();
}

const appInFront = () => /mCurrentFocus.*com\.openmausbot/.test(focusLine());

/**
 * A note for when the app is in front, which during a background burst is not
 * this driver's doing.
 *
 * The phone is a phone in a room: a tap on the notification's banner (or on the
 * notification in the shade) delivers its content intent — SystemUI is the
 * caller — and the app then opens that exact conversation. That is the feature
 * working: opening the conversation withdraws its row and the next message
 * counts from one again. So the count assertions have to say when it happened
 * rather than read it as an update that never arrived.
 */
const interruption = () => (appInFront() ? ` — the app is in the front (${focusLine()}), so a tap opened the conversation mid-burst` : "");

/**
 * The roster's own chrome. A bot's row, an open conversation and a bot's own
 * page all draw the bot's name; only the roster carries the button that makes
 * another bot, so that is what "the roster is in front" means here.
 */
const rosterInFront = (xml) => Boolean(xml) && /content-desc="New bot"/.test(xml);

/** The composer, which only a conversation has. */
const inConversation = (xml) => Boolean(xml) && /content-desc="Send"/.test(xml);

/** Open the bot's conversation by tapping its row in the roster. */
async function openChat(name, threadId, expectText) {
  shell("input keyevent KEYCODE_HOME");
  await wait(1_200);
  adb(`shell am start -n ${PKG}/.MainActivity`);
  await wait(3_000);
  // The app comes forward on whatever screen it was left on, and the bot's
  // name is drawn on every one of them — in an open conversation it is the
  // header, and tapping *that* opens the bot's page, not the conversation. So
  // the roster is reached first (bounded), and only then is the row tapped.
  let screen = uiDump("open");
  for (let i = 0; i < 5 && !rosterInFront(screen); i += 1) {
    shell("input keyevent KEYCODE_BACK");
    await wait(1_600);
    if (!appInFront()) {
      // Backing out of the roster itself finishes the activity; bring the app
      // back in rather than tapping whatever is in front instead.
      adb(`shell am start -n ${PKG}/.MainActivity`);
      await wait(2_500);
    }
    screen = uiDump(`open${i}`);
  }
  // A long name is drawn in one node and matched whole; the shorter prefix is
  // the fallback for a row that truncates it.
  const find = (xml) => nodeFor(xml, name) ?? nodeFor(xml, name.split(" ").slice(0, 3).join(" "));
  if (!find(screen)) {
    // The roster may be scrolled; the bots this driver creates are new, so they
    // sit near the top, but the list is a LazyColumn and a row below the fold
    // is not composed at all.
    for (let i = 0; i < 3 && !find(screen); i += 1) {
      shell(`input swipe ${540} ${1800} ${540} ${700} 200`);
      await wait(800);
      screen = uiDump(`open-swipe${i}`);
    }
  }
  const row = find(screen);
  if (!row) return { ok: false, stage: `no roster row for "${name}"` };
  tap(row);
  // The conversation is open when the app draws the newest reply it holds —
  // a string only this thread can contain — *and* its composer, so a roster
  // row preview of that same reply cannot be mistaken for the open chat.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const now = uiDump("thread");
    if (inConversation(now) && expectText && now?.includes(expectText)) {
      return { ok: true, stage: `showing "${expectText.slice(0, 40)}"` };
    }
    await wait(2_000);
  }
  // What the screen actually held, so a failure here says whether the roster
  // tap missed, the app was still catching up, or the chat opened somewhere
  // else — rather than just naming the string that never appeared.
  const drawn = (uiDump("missed")?.match(/text="[^"]+"/g) ?? []).slice(0, 12).join(" ");
  return { ok: false, stage: `thread never drew "${String(expectText).slice(0, 40)}" (drawn: ${drawn || "nothing"})` };
}

// ── send a burst and wait for the bot to answer every turn ──────────────────

/**
 * One message, one turn, `count` times.
 *
 * Deliberately sequential: the harness *queues* sends that arrive while a turn
 * is running and can deliver several of them as a single turn, which is right
 * for a person typing ahead and wrong for counting. Waiting for each reply is
 * what makes "ten messages" mean ten settled turns — and therefore ten notify
 * frames — rather than however many turns the queue happened to make of them.
 *
 * @return how many of the sends were actually answered
 */
async function burst(threadId, botId, label, count, perTurnMs = 45_000) {
  let turns = 0;
  for (let i = 0; i < count; i += 1) {
    const before = (await botTexts(threadId)).length;
    await api("POST", `/api/bots/${botId}/messages`, { text: `${label} ${i + 1}`, threadId });
    const deadline = Date.now() + perTurnMs;
    while (Date.now() < deadline) {
      if ((await botTexts(threadId)).length > before) { turns += 1; break; }
      await wait(1_000);
    }
  }
  return turns;
}

async function countHosts() {
  return shell(`run-as ${PKG} sh -c 'grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null | wc -l'`).trim();
}

// ── the app's own "keep the connection open" switch ─────────────────────────
//
// Read and written through the app's real preference (`AlwaysOnPreferences`:
// file `openmaus.always_on.xml`, key `enabled`), not through a side channel of
// this driver's own: turning it on and restarting the process is precisely what
// the settings toggle plus the next launch does, and `OpenMausApp` then starts
// `AlwaysOnConnectionService` on its own. The original value is captured before
// anything is changed and restored at the end — an absent file means the setting
// was never touched, and is restored by removing the file again.
const ALWAYS_ON_PREF = "shared_prefs/openmaus.always_on.xml";

/** @return true/false as the app has it, or null when it was never set. */
function readAlwaysOn() {
  // Absent has to read as "never set", not "off": the two are restored
  // differently, so a missing file is an answer of its own. (`run-as cat` of a
  // missing path exits non-zero, which is that answer; its stderr is noise
  // here, and is dropped rather than written to the run's log.)
  try {
    const xml = shell(`run-as ${PKG} cat ${ALWAYS_ON_PREF}`, {
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /name="enabled" value="true"/.test(xml);
  } catch {
    return null;
  }
}

function writeAlwaysOnXml(value) {
  const stage = mkdtempSync(join(tmpdir(), "omb-always-on-"));
  const file = join(stage, "openmaus.always_on.xml");
  writeFileSync(
    file,
    `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <boolean name="enabled" value="${value}" />\n</map>\n`,
  );
  adb(`push ${file} /data/local/tmp/openmaus.always_on.xml`, { timeout: 60_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/openmaus.always_on.xml ${ALWAYS_ON_PREF}`);
  shell("rm -f /data/local/tmp/openmaus.always_on.xml");
}

function removeAlwaysOn() {
  try { shell(`run-as ${PKG} rm -f ${ALWAYS_ON_PREF}`); } catch { /* retried below */ }
  if (readAlwaysOn() !== null) writeAlwaysOnXml(false);
}

async function waitForHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const body = (await api("GET", "/api/health", undefined, { timeoutMs: 3_000 })).json;
      if (body?.pid) return body;
    } catch { /* not up yet */ }
    await wait(1_500);
  }
  return null;
}

/**
 * Put the app into the state the toggle would leave it in, and prove it took:
 * the process is stopped first (a running process never re-reads the file), the
 * preference is written, and the app is launched again so its own start-up path
 * brings the service up.
 */
async function setAlwaysOn(enabled) {
  shell(`am force-stop ${PKG}`);
  await wait(1_500);
  if (enabled) writeAlwaysOnXml(true); else removeAlwaysOn();
  adb(`shell am start -n ${PKG}/.MainActivity`);
  return waitForHealth();
}

/** Whether the foreground service that holds the stream open is running. */
function alwaysOnServiceRunning() {
  return /AlwaysOnConnectionService/.test(shell(`dumpsys activity services ${PKG}`, { timeout: 40_000 }));
}

/**
 * How many rows of the app's usage ledger name a bot this driver created.
 *
 * Every settled turn is written there by the host itself, and the ledger is an
 * append-only record of turns that really ran — there is no API to prune it, and
 * rewriting the file behind a running app is not this driver's business. The
 * rows are all zero-cost (the mock charges nothing), so they are counted and
 * reported rather than quietly deleted.
 */
function probeLedgerRows() {
  const counted = shell(`run-as ${PKG} sh -c 'cat files/host/data/usage/*.jsonl 2>/dev/null | grep -c "Notify probe"'`);
  return Number(counted.trim()) || 0;
}

// ── 1. install + launch + health ────────────────────────────────────────────
if (!APK || !existsSync(APK)) {
  console.error(`APK not found: ${APK ?? "(none)"}`);
  process.exit(2);
}
step("install + launch");
if (SKIP_INSTALL) {
  console.log("skipping install (--skip-install)");
} else {
  try { adb(`install -r -g ${APK}`, { timeout: 420_000 }); }
  catch { console.log("install retry after transient failure…"); adb(`install -r -g ${APK}`, { timeout: 420_000 }); }
}
adb("logcat -c");
adb(`shell am start -n ${PKG}/.MainActivity`);
adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);
console.log(`device: ${shell("getprop ro.product.model").trim()}  abi=${shell("getprop ro.product.cpu.abi").trim()}  api=${shell("getprop ro.build.version.sdk").trim()}`);
let health = await waitForHealth();
if (!check("host healthy on device", Boolean(health))) process.exit(4);
let hostPid = String(health.pid);
check("exactly one host process", (await countHosts()) === "1");

// ── 1b. the connection is held open for the background half ─────────────────
const alwaysOnOriginally = readAlwaysOn();
step("holding the connection open (the app's own always-on switch)");
const restarted = await setAlwaysOn(true);
check("the app is hosting again after the setting took", Boolean(restarted));
hostPid = String(restarted?.pid ?? hostPid);
adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);
check("the setting reads back on, as the app persists it", readAlwaysOn() === true, `was ${JSON.stringify(alwaysOnOriginally)}`);
check("the foreground service holding the stream open is running", alwaysOnServiceRunning());

// ── 2. two bots and the deterministic provider ──────────────────────────────
step("two bots on the device's own host");
const created = [];
for (const name of [BOT_A, BOT_B]) {
  const bot = (await api("POST", "/api/bots", { name })).json?.bot;
  if (!bot?.id) { console.error(`could not create ${name}`); process.exit(4); }
  created.push(bot);
}
const [a, b] = created;
check("two bots created", created.length === 2, created.map((x) => x.threadId.slice(0, 8)).join(", "));

let fixtureInstanceId = "";
async function ensureDeviceMock() {
  adb(`forward tcp:${MOCK_PORT_HOST} tcp:${MOCK_PORT_DEVICE}`);
  try {
    const probe = await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(3_000) });
    const body = await probe.json().catch(() => null);
    if (probe.ok && body?.data?.some?.((m) => m?.id === "mock-1")) return true;
    throw new Error("port held by a non-mock or stale mock");
  } catch (e) {
    if (String(e).includes("non-mock or stale mock")) throw e;
  }
  const nodeExe = shell(`run-as ${PKG} sh -c 'readlink /proc/${hostPid}/exe'`).trim();
  if (!nodeExe) return false;
  const libDir = nodeExe.replace(/\/[^/]+$/, "");
  const stage = mkdtempSync(join(tmpdir(), "omb-notify-mock-"));
  const pushPath = join(stage, "ombmock.cjs");
  writeFileSync(pushPath, readFileSync(new URL("./omb-openai-mock.cjs", import.meta.url)));
  adb(`push ${pushPath} /data/local/tmp/ombmock.cjs`, { timeout: 120_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/ombmock.cjs files/ombmock.cjs`);
  const filesDir = shell(`run-as ${PKG} sh -c 'pwd'`).trim();
  shell(`run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 nohup ${nodeExe} files/ombmock.cjs ${MOCK_PORT_DEVICE} >/dev/null 2>&1 &'`);
  await wait(2_000);
  try {
    return (await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(5_000) })).ok;
  } catch { return false; }
}

check("deterministic mock provider running on device", await ensureDeviceMock());
const fixture = await api("POST", "/api/instances", {
  driver: "openai-compat",
  name: "Notify device fixture",
  url: `http://127.0.0.1:${MOCK_PORT_DEVICE}/v1`,
  key: "mock-not-a-secret",
  model: "mock-1",
});
fixtureInstanceId = fixture.json?.instanceId ?? "";
check("fixture provider instance created", fixture.status === 201 && Boolean(fixtureInstanceId), `http ${fixture.status}`);
const refreshed = await api("POST", `/api/instances/${fixtureInstanceId}/refresh-models`, {}, { timeoutMs: 60_000 });
check(
  "refreshed catalog is the mock's",
  (refreshed.json?.instances?.find((i) => i.instanceId === fixtureInstanceId)?.models?.options ?? []).some((o) => o.id === "mock-1"),
);
for (const bot of created) {
  await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: fixtureInstanceId, model: "mock-1" } });
}
const ledgerRowsBefore = probeLedgerRows();

// ── 3. the chat is on screen: a burst says nothing ──────────────────────────
step("a burst in the chat being read");
// Two turns first, so there is text only this conversation contains — the app
// drawing that text is what proves the thread, not just the app, is on screen.
check("the mock answered two turns", (await burst(a.threadId, a.id, "warm", 2)) === 2);
const lastReply = (await botTexts(a.threadId)).slice(-1)[0] ?? "";
const visible = await openChat(BOT_A, a.threadId, lastReply.slice(0, 24));
check("bot A's conversation is on screen, showing its newest reply", visible.ok && appInFront(), `${visible.stage} — ${focusLine()}`);
check("three more turns settle while that chat is open", (await burst(a.threadId, a.id, "visible", 3)) === 3);
const whileVisible = await shadeSettles((rows) => rows.length === 0, 20_000);
check(
  "reading the chat produces no notification at all",
  whileVisible.length === 0,
  whileVisible.length ? whileVisible.map((r) => `${r.id}:${r.text}`).join(" | ") : "0 rows in the shade",
);
check("the app is still the foreground app", appInFront(), focusLine());

// ── 4. background: one notification, updated, for ten messages ─────────────
step("ten messages behind the launcher");
shell("input keyevent KEYCODE_HOME");
await wait(2_000);
check("the app is backgrounded", !appInFront(), focusLine());
const background = await burst(a.threadId, a.id, "behind", 10);
check("ten turns settle in the background", background === 10, `${background} of 10 answered`);
check("the app stayed behind the launcher throughout", !appInFront(), focusLine());
// Exact, not ">= 1": the connection is held open for the whole burst, so every
// one of the ten frames reaches the poster while the app is behind the
// launcher and every one of them counts. A number below ten here means frames
// stopped arriving (delivery), not that the policy coalesced (it still shows
// exactly one row either way).
const oneRow = await shadeSettles((rows) => rows.some((r) => r.number === 10), 90_000);
check(
  "exactly one notification for the conversation",
  oneRow.length === 1,
  `${oneRow.length} row(s): ${oneRow.map((r) => `${r.id}/${r.number}`).join(", ")}`,
);
const row = oneRow[0] ?? {};
check("it carries the whole burst", row.number === 10, `number=${row.number}${interruption()}`);
check("and says so", /10 new messages/.test(row.text ?? ""), `text="${row.text}"`);
check("on the bot-message channel", row.channel === "bot_messages", `channel=${row.channel}`);
const otherChannels = allRows().map((r) => r.channel).filter((c) => !CONVERSATION_CHANNELS.has(c));
check(
  "nothing else of the app's is in the shade but its own running notices",
  otherChannels.every((c) => RUNNING_NOTICE_CHANNELS.has(c)),
  otherChannels.join(", ") || "(none)",
);

step("another burst updates that one notification");
const more = await burst(a.threadId, a.id, "behind-more", 3);
check("three more turns settle", more === 3, `${more} of 3 answered`);
check("the app stayed behind the launcher throughout", !appInFront(), focusLine());
const updated = await shadeSettles((rows) => rows.some((r) => r.number === 13), 90_000);
check("still one notification", updated.length === 1, `${updated.length} row(s)`);
check("updated to thirteen", updated[0]?.number === 13, `number=${updated[0]?.number}${interruption()}`);
check("under the same id", updated[0]?.id === row.id, `${row.id} → ${updated[0]?.id}`);

// ── 5. a second bot is its own notification ────────────────────────────────
step("a second conversation");
const secondBurst = await burst(b.threadId, b.id, "second", 2);
check("bot B answers twice", secondBurst === 2, `${secondBurst} of 2 answered`);
const twoRows = await shadeSettles((rows) => rows.length === 2, 60_000);
check("two conversations, two notifications", twoRows.length === 2, twoRows.map((r) => `${r.id}`).join(", "));
const rowB = twoRows.find((r) => r.id !== row.id) ?? {};
check("bot B's row is a different id", Boolean(rowB.id) && rowB.id !== row.id);
check("and bot B's row is not bot A's", /Notify probe B/.test(`${rowB.title} ${rowB.text}`) || rowB.number === 2, `title="${rowB.title}" number=${rowB.number}`);

// ── 6. rotation does not duplicate a row ───────────────────────────────────
step("rotation");
const before = shade().map((r) => `${r.id}/${r.number}`).join(",");
shell("settings put system accelerometer_rotation 0");
shell("settings put system user_rotation 1");
await wait(3_000);
shell("settings put system user_rotation 0");
await wait(3_000);
const after = shade().map((r) => `${r.id}/${r.number}`).join(",");
check("rotation leaves the shade exactly as it was", before === after, `${before} → ${after}`);

// ── 7. opening the chat clears its notification ────────────────────────────
step("opening the chat");
const newest = (await botTexts(a.threadId)).slice(-1)[0] ?? "";
const reopened = await openChat(BOT_A, a.threadId, newest.slice(0, 24));
check("bot A's conversation is open again", reopened.ok, reopened.stage);
const cleared = await shadeSettles((rows) => !rows.some((r) => r.id === row.id), 30_000);
check("its notification is gone", !cleared.some((r) => r.id === row.id), cleared.map((r) => r.id).join(", ") || "(none)");
check("the other conversation keeps its own", cleared.some((r) => r.id === rowB.id), cleared.map((r) => r.id).join(", ") || "(none)");

// ── 8. a restarted process updates the same notification ───────────────────
step("process restart");
shell("input keyevent KEYCODE_HOME");
await wait(1_500);
check("bot A answers before the restart", (await burst(a.threadId, a.id, "pre-restart", 2)) === 2);
const beforeRestart = (await shadeSettles((rows) => rows.some((r) => r.id === row.id), 60_000)).find((r) => r.id === row.id);
check("bot A has a notification before the restart", Boolean(beforeRestart), `id=${beforeRestart?.id} number=${beforeRestart?.number}`);
shell(`am force-stop ${PKG}`);
await wait(2_000);
adb(`shell am start -n ${PKG}/.MainActivity`);
for (let i = 0; i < 40; i += 1) {
  try { await api("GET", "/api/health", undefined, { timeoutMs: 3_000 }); break; } catch { await wait(1_500); }
}
check("one host after the restart", (await countHosts()) === "1");
check("the always-on service came back with the process", alwaysOnServiceRunning());
// A force-stop takes the app's whole uid with it, and the mock runs under that
// uid — so it may have to be started again before the turn can be answered.
hostPid = String((await api("GET", "/api/health")).json?.pid ?? hostPid);
check("the mock provider is serving again", await ensureDeviceMock());
shell("input keyevent KEYCODE_HOME");
await wait(2_000);
check("bot A answers after the restart", (await burst(a.threadId, a.id, "post-restart", 2)) === 2);
const afterRestart = await shadeSettles((rows) => rows.some((r) => r.id === row.id), 90_000);
check("still exactly one notification for that conversation", afterRestart.filter((r) => r.id === row.id).length === 1, `${afterRestart.length} row(s) total`);
check("under the id the previous process used", afterRestart.some((r) => r.id === row.id), `${afterRestart.map((r) => r.id).join(", ") || "(none)"}`);
const afterRestartRow = afterRestart.find((r) => r.id === row.id);
check("and it counts the new turn", afterRestartRow?.number === 2, `number=${afterRestartRow?.number}`);

// ── 9. cleanup ─────────────────────────────────────────────────────────────
step("cleanup");
for (const bot of created) await api("DELETE", `/api/bots/${bot.id}`, undefined, { timeoutMs: 20_000 });
if (fixtureInstanceId) {
  const removed = await api("DELETE", `/api/instances/${fixtureInstanceId}`, undefined, { timeoutMs: 30_000 });
  check("fixture provider instance removed", removed.status === 200, `http ${removed.status}`);
}
// The switch this run turned on goes back exactly as it was found — absent
// stays absent, and a value the person had chosen is written back unchanged —
// before the shade is read, so what is left in it is what the phone was left
// with rather than what this run made.
if (alwaysOnOriginally === null) removeAlwaysOn(); else writeAlwaysOnXml(alwaysOnOriginally);
shell(`run-as ${PKG} sh -c 'pkill -f "ombmoc[k].cjs" || true'`);
shell(`run-as ${PKG} rm -f files/ombmock.cjs`);
// The platform has no "clear this app's notifications" verb; a force-stop is
// what actually withdraws them, and the app is launched again behind it so the
// phone is left as it was found.
shell(`am force-stop ${PKG}`);
await wait(2_000);
adb(`shell am start -n ${PKG}/.MainActivity`);
// Without this wait the health check below is a race against the host booting —
// the first run of this driver died on exactly that socket.
await waitForHealth(60_000);
check("the shade holds nothing of the app's afterwards", shade().length === 0, `${shade().length} row(s) left`);
check(
  "the always-on setting is back as it was found",
  readAlwaysOn() === alwaysOnOriginally,
  `${JSON.stringify(alwaysOnOriginally)} → ${JSON.stringify(readAlwaysOn())}`,
);
check("no service is running for a setting that is off", alwaysOnOriginally === true || !alwaysOnServiceRunning());
const botsLeft = ((await api("GET", "/api/bots")).json?.bots ?? []).map((x) => x.name);
check("no probe bot left behind", !botsLeft.some((n) => n.startsWith("Notify probe")), botsLeft.join(", "));
const instancesLeft = (((await api("GET", "/api/instances")).json?.instances) ?? []).map((i) => i.instanceId);
check(
  "no fixture provider left in the catalog",
  !instancesLeft.includes(fixtureInstanceId),
  instancesLeft.join(", "),
);
const ledgerRowsAfter = probeLedgerRows();
console.log(
  `NOTE: this run added ${ledgerRowsAfter - ledgerRowsBefore} rows to the app's usage ledger; ` +
    `${ledgerRowsAfter} rows there name a bot this driver made. The ledger is the app's own ` +
    "append-only record of turns that really ran, all of them at zero cost, and nothing prunes it.",
);

console.log(`\nNOTIFICATION RESULT: ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} check(s) failed: ${failures.join("; ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
