#!/usr/bin/env node
// Device test: the voluntary structured ask_user (typed v2) on a real phone.
//
//   scripts/test-android-ask-user.mjs <apk> --mock
//
// The phone runs its OWN host server; this driver talks to it over an adb
// forward, on the same loopback trust path the app's UI uses. A cue in the
// last user message makes the on-device mock provider emit one typed
// `ask_user` tool call, the real harness blocks the turn on the question
// card, the driver answers over `POST /api/threads/:id/respond` — the exact
// route the Compose card calls — and the mock then replies `DONE <answer
// text>`, which only happens if the SAME turn resumed with the answer.
//
// What it proves, on real hardware:
//   1. install + launch + health, one host process
//   2. a typed ask reaches the transcript as a questionRequest card, with
//      the type, option ids and selection bounds the model sent
//   3. answering resumes the SAME task once with the answer (the mock echoes
//      it back from the tool result)
//   4. all four types: single_choice, multiple_choice, confirmation, free_text
//   5. an ordinary task raises NO card
//   6. the card survives a force-stop + relaunch and is still answerable
//   7. a second answer to the same requestId is refused, not replayed
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const APK = args.find((a, i) => i === 0 || !a.startsWith("--"));
const MOCK = args.includes("--mock");
if (!MOCK) {
  console.error("This driver needs --mock (the deterministic on-device provider).");
  process.exit(2);
}

const PKG = "com.openmausbot.companion";
const PORT_DEVICE = 18799;
const PORT_HOST = 28799;
const MOCK_PORT_DEVICE = 28798;
const MOCK_PORT_HOST = 28797;
const BASE = `http://127.0.0.1:${PORT_HOST}`;
const STAMP = Date.now();
const BOT_NAME = `Ask User Bot ${STAMP}`;
// The fixture provider is a hand-added custom API instance, created here and
// deleted at the end. The person's own openaiCompat endpoint and key are only
// READ, for an assertion: an earlier version of this driver pointed that
// shared setting at the mock, and a crash before its restore left the phone's
// real provider broken.
let fixtureInstanceId = "";
const PREAMBLE = "The user answered your questions.";
const failures = [];

const adb = (cmd, opts = {}) => execFileSync("adb", cmd.split(" "), { encoding: "utf8", timeout: opts.timeout ?? 60_000, ...opts });
const shell = (cmd, opts = {}) => adb(`shell ${cmd}`, opts).replace(/\r/g, "");
const step = (label) => console.log(`\n== ${label} ==`);
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function api(method, path, body, { timeoutMs = 15_000 } = {}) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function messages(threadId, limit = 14) {
  const state = await api("GET", `/api/threads/${threadId}/messages?limit=${limit}`, undefined, { timeoutMs: 8_000 });
  return state.json?.messages ?? [];
}

/** Poll the transcript until a question card matching `want` appears. */
async function waitForCard(threadId, want, seconds = 60) {
  for (let i = 0; i < seconds; i += 1) {
    let list = [];
    try { list = await messages(threadId); } catch { /* retry */ }
    const card = list.find((m) => m.kind === "options" && m.card?.questionRequest?.questions?.length && (!want || want(m.card)));
    if (card) return card;
    await sleep(1_000);
  }
  return null;
}

/** Poll for the newest bot text; the mock's resumed reply starts with DONE. */
async function waitForReply(threadId, matcher, seconds = 75) {
  for (let i = 0; i < seconds; i += 1) {
    let list = [];
    try { list = await messages(threadId); } catch { /* retry */ }
    const reply = [...list].reverse().find((m) => m.kind === "text" && (m.role === "bot" || m.role === "assistant"))?.text ?? "";
    if (reply && matcher(reply)) return reply;
    await sleep(1_000);
  }
  return "";
}

const answerText = (question, picks) => `${PREAMBLE}\n\nQ: ${question}\nA: ${picks.join(", ")}`;

function answerCard(threadId, requestId, message) {
  return api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "answer", message }, { timeoutMs: 20_000 });
}

/** One typed ask: send the cue, assert the card, answer it, assert resumption. */
async function askOnce({ cue, label, want, question, picks, contains, answerViaBotsRoute = false }) {
  step(`typed ask — ${label}`);
  await api("POST", `/api/bots/${botId}/messages`, { text: `${cue} — carry out the task.`, threadId });
  const card = await waitForCard(threadId, want);
  check(`${label}: a question card reached the transcript`, Boolean(card));
  if (!card) return;
  const requestId = card.card.requestId;
  const q = card.card.questionRequest.questions[0];
  check(`${label}: the card is typed, not the approval shape`, q.type === wantType(label, q), `type=${q.type}`);
  console.log(`     card: type=${q.type} options=${JSON.stringify(q.options.map((o) => ({ id: o.id, label: o.label })))} min=${q.minSelections} max=${q.maxSelections} allowOther=${q.allowOther}`);
  check(`${label}: the bot is visibly waiting on the person`, true); // transcript has an unanswered card
  const message = answerText(question, picks);
  const respond = answerViaBotsRoute
    ? await api("POST", `/api/bots/${botId}/respond`, { requestId, behavior: "answer", message }, { timeoutMs: 20_000 })
    : await answerCard(threadId, requestId, message);
  check(`${label}: answer accepted`, respond.status === 200 && respond.json?.outcome !== "unavailable", JSON.stringify(respond.json ?? {}).slice(0, 160));
  const reply = await waitForReply(threadId, (t) => t.includes("DONE") && t.includes(contains));
  check(`${label}: the SAME task resumed with the answer`, reply.includes(contains), reply.split("\n").slice(-1)[0]?.slice(0, 140) ?? "");
  const settled = (await messages(threadId)).find((m) => m.card?.requestId === requestId);
  check(`${label}: the card keeps what was answered`, Boolean(settled?.card?.answeredText || settled?.card?.answered), `answeredText=${(settled?.card?.answeredText ?? "").slice(0, 40)}`);
  return { requestId, card };
}

const wantType = (label) => ({ "single_choice": "single_choice", "multiple_choice": "multiple_choice", "confirmation": "confirmation", "free_text": "free_text" }[label]);

async function countHosts() {
  return shell(`run-as ${PKG} sh -c 'grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null | wc -l'`).trim();
}

// ── 1. install + launch + health ────────────────────────────────────────────
if (!APK || !existsSync(APK)) {
  console.error(`APK not found: ${APK ?? "(none)"}`);
  process.exit(2);
}
step("install + launch");
// A 72 MB streamed install over this USB link has taken over three minutes;
// the retry exists for the flaky transfer, not for a short deadline.
try {
  adb(`install -r -g ${APK}`, { timeout: 420_000 });
} catch {
  console.log("install retry after transient failure…");
  adb(`install -r -g ${APK}`, { timeout: 420_000 });
}
adb("logcat -c");
adb(`shell am start -n ${PKG}/.MainActivity`);
adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);
console.log(`device: ${shell("getprop ro.product.model").trim()}  abi=${shell("getprop ro.product.cpu.abi").trim()}  api=${shell("getprop ro.build.version.sdk").trim()}`);

let health = null;
for (let i = 0; i < 40; i += 1) {
  try { health = (await api("GET", "/api/health", undefined, { timeoutMs: 3_000 })).json; } catch { /* not up yet */ }
  if (health) break;
  await sleep(1_000);
}
if (!health) {
  console.error("host never answered /api/health");
  console.error(adb("logcat -d").split("\n").filter((l) => /HarnessHost|HostFiles/.test(l)).slice(-30).join("\n"));
  process.exit(4);
}
const hostPid = String(health.pid);
check("host healthy on device", Boolean(hostPid), `pid=${hostPid}`);
check("exactly one host process", (await countHosts()) === "1");

// ── 2. bot + on-device mock provider ────────────────────────────────────────
step("bot + on-device mock provider");
const created = await api("POST", "/api/bots", { name: BOT_NAME });
const bot = created.json?.bot;
check("bot created on device host", Boolean(bot?.id), `id=${bot?.id ?? "?"}`);
const botId = bot?.id;
const threadId = bot?.threadId;
const realUrlBefore = ((await api("GET", "/api/config")).json)?.openaiCompat?.url ?? "";
console.log(`the person's own provider URL (read-only): ${realUrlBefore || "(none)"}`);

async function ensureDeviceMock() {
  adb(`forward tcp:${MOCK_PORT_HOST} tcp:${MOCK_PORT_DEVICE}`);
  try {
    const probe = await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(3_000) });
    const body = await probe.json().catch(() => null);
    if (probe.ok && body?.data?.some?.((m) => m?.id === "mock-1")) return true;
    throw new Error(`port ${MOCK_PORT_DEVICE} held by a non-mock or stale mock`);
  } catch (e) {
    if (String(e).includes("non-mock or stale mock")) throw e;
  }
  const nodeExe = shell(`run-as ${PKG} sh -c 'readlink /proc/${hostPid}/exe'`).trim();
  if (!nodeExe) return false;
  const libDir = nodeExe.replace(/\/[^/]+$/, "");
  const stage = mkdtempSync(join(tmpdir(), "omb-ask-mock-"));
  const pushPath = join(stage, "ombmock.cjs");
  writeFileSync(pushPath, readFileSync(new URL("./omb-openai-mock.cjs", import.meta.url)));
  adb(`push ${pushPath} /data/local/tmp/ombmock.cjs`, { timeout: 120_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/ombmock.cjs files/ombmock.cjs`);
  const filesDir = shell(`run-as ${PKG} sh -c 'pwd'`).trim();
  shell(`run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 nohup ${nodeExe} files/ombmock.cjs ${MOCK_PORT_DEVICE} >/dev/null 2>&1 &'`);
  await sleep(2_000);
  try {
    const probe = await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(5_000) });
    return probe.ok;
  } catch { return false; }
}

check("deterministic mock provider running on device", await ensureDeviceMock());
const fixture = await api("POST", "/api/instances", {
  driver: "openai-compat",
  name: "Ask-user device fixture",
  url: `http://127.0.0.1:${MOCK_PORT_DEVICE}/v1`,
  key: "mock-not-a-secret",
  model: "mock-1",
});
fixtureInstanceId = fixture.json?.instanceId ?? "";
check("fixture provider instance created", fixture.status === 201 && Boolean(fixtureInstanceId), `http ${fixture.status} id=${fixtureInstanceId || JSON.stringify(fixture.json?.error ?? "")}`);
const refreshed = await api("POST", `/api/instances/${fixtureInstanceId}/refresh-models`, {}, { timeoutMs: 60_000 });
const options = refreshed.json?.instances?.find((i) => i.instanceId === fixtureInstanceId)?.models?.options ?? [];
check("refreshed catalog is the mock's", options.some((o) => o.id === "mock-1"), options.map((o) => o.id).join(",") || "(none)");
await api("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId: fixtureInstanceId, model: "mock-1" } });

// ── 3. an ordinary task raises NO card ──────────────────────────────────────
step("an ordinary task asks nothing");
await api("POST", `/api/bots/${botId}/messages`, { text: "Reply with exactly: pong", threadId });
const plainReply = await waitForReply(threadId, (t) => t.includes("DONE") || /pong/i.test(t), 30);
const plainCards = (await messages(threadId)).filter((m) => m.kind === "options" && m.card?.questionRequest);
check("an ordinary turn settles with no question card", plainReply.length > 0 && plainCards.length === 0, `cards=${plainCards.length}`);

// ── 4. the four types ───────────────────────────────────────────────────────
const single = await askOnce({
  cue: "cue-ask-single",
  label: "single_choice",
  question: "Which local cache should the new index use?",
  want: (card) => card.questionRequest.questions[0]?.type === "single_choice",
  picks: ["SQLite"],
  contains: "SQLite",
});
check("single_choice: stable ids and an Other row arrive",
  single?.card.card.questionRequest.questions[0].options.map((o) => o.id).join(",") === "sqlite,leveldb",
  single?.card.card.questionRequest.questions[0].options.map((o) => `${o.id}=${o.label}`).join(" "));
check("single_choice: free text stays open by default",
  single?.card.card.questionRequest.questions[0].allowOther !== false);

const multi = await askOnce({
  cue: "cue-ask-multi",
  label: "multiple_choice",
  question: "Which providers should this bot enable?",
  want: (card) => card.questionRequest.questions[0]?.type === "multiple_choice",
  picks: ["OpenAI", "Qwen"],
  contains: "OpenAI, Qwen",
  answerViaBotsRoute: true,
});
const mq = multi?.card.card.questionRequest.questions[0];
check("multiple_choice: bounds and ids survive the wire",
  mq?.multiSelect === true && mq?.minSelections === 1 && mq?.maxSelections === 2 && mq?.allowOther === false,
  `min=${mq?.minSelections} max=${mq?.maxSelections} allowOther=${mq?.allowOther}`);

await askOnce({
  cue: "cue-ask-confirm",
  label: "confirmation",
  question: "Delete the staging database and all of its local backups?",
  want: (card) => card.questionRequest.questions[0]?.type === "confirmation",
  picks: ["The user confirmed."],
  contains: "confirmed",
});

await askOnce({
  cue: "cue-ask-free",
  label: "free_text",
  question: "How should the retry loop behave when the provider returns 429?",
  want: (card) => card.questionRequest.questions[0]?.type === "free_text",
  picks: ["Retry with exponential backoff and jitter."],
  contains: "backoff",
});

// ── 5. persistence across backgrounding and rotation ────────────────────────
// Backgrounding (HOME) and rotation leave the host process running — that is
// precisely what the card must survive, and the turn behind it stays alive to
// resume. A force-stop is a process kill and is checked separately below.
step("a card survives backgrounding and rotation, and still resumes the task");
await api("POST", `/api/bots/${botId}/messages`, { text: "cue-ask-single — carry out the task.", threadId });
const beforePark = await waitForCard(threadId, (card) => !card.answered && !card.answeredText);
check("a card is open before the app is backgrounded", Boolean(beforePark));
const parkedRequestId = beforePark?.card.requestId;
const parkedQuestion = beforePark?.card.questionRequest.questions[0].question ?? "";
shell("input keyevent KEYCODE_HOME");
await sleep(2_000);
check("the host keeps running while the app is in the background", Boolean((await api("GET", "/api/health", undefined, { timeoutMs: 4_000 })).json));
// Rotate with the card open, then rotate back. Accelerometer override so the
// setting actually takes effect on a physical handset.
shell("settings put system accelerometer_rotation 0");
shell("settings put system user_rotation 1");
await sleep(2_000);
shell("settings put system user_rotation 0");
await sleep(2_000);
shell("settings put system accelerometer_rotation 1");
adb(`shell am start -n ${PKG}/.MainActivity`);
await sleep(2_500);
if (parkedRequestId) {
  const after = (await messages(threadId)).find((m) => m.card?.requestId === parkedRequestId);
  check("the open card is still in the transcript after backgrounding and rotation", Boolean(after), `requestId=${parkedRequestId}`);
  const answer = await answerCard(threadId, parkedRequestId, answerText(parkedQuestion, ["LevelDB"]));
  check("the survived card is still answerable", answer.status === 200 && answer.json?.outcome !== "unavailable", JSON.stringify(answer.json ?? {}).slice(0, 140));
  const resumed = await waitForReply(threadId, (t) => t.includes("DONE") && t.includes("LevelDB"), 75);
  check("the SAME task resumed with the post-rotation answer", resumed.includes("LevelDB"));
  // answering the same requestId again must be refused, not replayed
  const again = await answerCard(threadId, parkedRequestId, answerText(parkedQuestion, ["SQLite"]));
  check("a second answer to the same request is refused", again.json?.outcome === "unavailable", JSON.stringify(again.json ?? {}).slice(0, 180));
}

// ── 5b. a card that outlives its process ────────────────────────────────────
// A force-stop kills the host: the turn behind the card is gone for good. The
// durable card must still be SHOWN, and a late answer must say why it cannot
// resume rather than pretending it did.
step("a card outliving its process is shown, and says so when answered");
await api("POST", `/api/bots/${botId}/messages`, { text: "cue-ask-free — carry out the task.", threadId });
const doomed = await waitForCard(threadId, (card) => !card.answered && !card.answeredText && card.questionRequest.questions[0].type === "free_text");
check("a card is open before the force-stop", Boolean(doomed));
adb(`shell am force-stop ${PKG}`);
await sleep(2_000);
adb(`shell am start -n ${PKG}/.MainActivity`);
adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);
let revived = null;
for (let i = 0; i < 40; i += 1) {
  try { revived = (await api("GET", "/api/health", undefined, { timeoutMs: 3_000 })).json; } catch { /* not up */ }
  if (revived) break;
  await sleep(1_000);
}
check("host healthy after force-stop + relaunch", Boolean(revived));
if (doomed?.card.requestId) {
  const after = (await messages(threadId)).find((m) => m.card?.requestId === doomed.card.requestId);
  check("the card outlives the process that raised it", Boolean(after), `requestId=${doomed.card.requestId}`);
  const late = await answerCard(threadId, doomed.card.requestId, answerText(doomed.card.questionRequest.questions[0].question, ["Too late."]));
  check("a late answer reports why it cannot resume", late.json?.outcome === "unavailable" && Boolean(late.json?.reason), JSON.stringify(late.json ?? {}).slice(0, 170));
  const settled = (await messages(threadId)).find((m) => m.card?.requestId === doomed.card.requestId);
  check("the late answer settles the card instead of leaving it live", Boolean(settled?.card?.answered || settled?.card?.dismissed), `answered=${settled?.card?.answered}`);
}
check("exactly one host process after restart", (await countHosts()) === "1");

// ── 6. the Compose card is really on the phone's screen ─────────────────────
// A fresh, unique dump path each time: a failed dump leaves the previous file
// in place and would report the old screen as the current one.
function uiDump(tag) {
  const path = `/sdcard/omb-ask-${tag}.xml`;
  shell(`rm -f ${path}`);
  const out = shell(`uiautomator dump ${path}`, { timeout: 40_000 });
  if (!/dumped to/i.test(out)) return null;
  return shell(`cat ${path}`);
}

/** The centre of the node whose text is exactly `label`, or null. */
function nodeFor(xml, label) {
  if (!xml) return null;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const node = new RegExp(`<node[^>]*?(?:text|content-desc)=["']${esc}["'][^>]*>`).exec(xml)?.[0];
  if (!node) return null;
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
  if (!bounds) return null;
  return { x: (Number(bounds[1]) + Number(bounds[3])) / 2, y: (Number(bounds[2]) + Number(bounds[4])) / 2 };
}

function tap(node) {
  return shell(`input tap ${Math.round(node.x)} ${Math.round(node.y)}`);
}

step("the Compose card renders and answers on the phone's screen");
try {
  adb(`shell am start -n ${PKG}/.MainActivity`);
  await sleep(3_000);
  await api("POST", `/api/bots/${botId}/messages`, { text: "cue-ask-confirm — carry out the task.", threadId });
  const uiCard = await waitForCard(threadId, (card) => !card.answered && !card.answeredText);
  check("a fresh card is open for the UI step", Boolean(uiCard));
  const question = uiCard?.card.questionRequest.questions[0].question ?? "";
  // The app may already be showing this thread; if not, open it from the
  // roster, whose row carries the bot's name.
  let screen = uiDump("card0");
  if (!nodeFor(screen, question)) {
    const roster = uiDump("roster");
    const row = nodeFor(roster, BOT_NAME) ?? nodeFor(roster, BOT_NAME.split(" ").slice(0, 3).join(" "));
    check("the bot's row is on the app's screen", Boolean(row), row ? `tap ${Math.round(row.x)},${Math.round(row.y)}` : "not in the dump");
    if (row) {
      tap(row);
      await sleep(2_500);
    }
    screen = uiDump("card");
  }
  // Let Compose finish laying the card out before believing a dump: the first
  // dump right after the card appears can predate its rows being placed.
  await sleep(1_500);
  check("the question text is on screen", Boolean(nodeFor(screen, question)), screen ? "" : "dump failed");
  let confirm = nodeFor(screen, "Confirm");
  let cancel = nodeFor(screen, "Cancel");
  // The transcript is a lazy list: rows below the fold are not composed at
  // all, so a dump taken mid-scroll cannot see them. Scroll to the newest
  // rows before believing they are absent.
  const size = /(\d+)x(\d+)/.exec(shell("wm size"));
  const [width, height] = size ? [Number(size[1]), Number(size[2])] : [1080, 2340];
  for (let i = 0; i < 3 && (!confirm || !cancel); i += 1) {
    shell(`input swipe ${Math.round(width / 2)} ${Math.round(height * 0.72)} ${Math.round(width / 2)} ${Math.round(height * 0.34)} 200`);
    await sleep(1_000);
    screen = uiDump(`card${i + 1}`);
    confirm = confirm ?? nodeFor(screen, "Confirm");
    cancel = cancel ?? nodeFor(screen, "Cancel");
  }
  check("the confirmation's own two rows are on screen", Boolean(confirm) && Boolean(cancel));
  if (confirm) {
    tap(confirm);
    await sleep(600);
    const ready = uiDump("picked");
    const submit = nodeFor(ready, "Submit answer");
    check("the submit button is on screen", Boolean(submit));
    if (submit) {
      tap(submit);
      const resumed = await waitForReply(threadId, (t) => t.includes("DONE") && t.includes("confirmed"), 75);
      check("tapping Submit answers the SAME task with the tap's choice", resumed.includes("confirmed"));
    }
  }
} catch (error) {
  check("the Compose card renders and answers on the phone's screen", false, String(error).slice(0, 140));
}

// ── cleanup ─────────────────────────────────────────────────────────────────
step("cleanup");
if (fixtureInstanceId) {
  const removed = await api("DELETE", `/api/instances/${fixtureInstanceId}`, undefined, { timeoutMs: 30_000 });
  check("fixture provider instance removed", removed.status === 200, `http ${removed.status}`);
}
const realNow = ((await api("GET", "/api/config")).json)?.openaiCompat?.url ?? "";
check("the person's own provider URL is untouched", realNow === realUrlBefore, `${realUrlBefore || "(none)"} -> ${realNow || "(none)"}`);
try { await api("DELETE", `/api/bots/${botId}`, undefined, { timeoutMs: 15_000 }); } catch { /* best-effort */ }
shell(`run-as ${PKG} sh -c 'pkill -f "ombmoc[k].cjs" || true'`);
shell(`run-as ${PKG} rm -f files/ombmock.cjs`);
adb(`forward --remove tcp:${MOCK_PORT_HOST}`);

console.log(`\nASK-USER RESULT: ${failures.length === 0 ? `ALL CHECKS PASSED on ${shell("getprop ro.product.cpu.abi").trim()}` : `${failures.length} check(s) failed: ${failures.join("; ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
