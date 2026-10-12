#!/usr/bin/env node
// Real-model behavioural test: the agent asks only when the answer materially
// changes the work.
//
//   scripts/test-android-ask-user-real.mjs <apk> [--model ID] [--codex-model ID]
//
// Unlike scripts/test-android-ask-user.mjs there is NO mock and NO cue: the
// tasks are described in words, the model decides on its own whether to ask,
// and the person's own configured providers are used as they are. Nothing is
// written to provider config — the driver only reads the catalog and points
// its own throwaway bot at an instance.
//
// Proven here, on real hardware, with a real model:
//   SHOULD ASK     → the model calls ask_user on its own, the Compose card
//                    renders, the person answers (tapped on the screen for one
//                    case), and the same task resumes using that answer.
//   SHOULD NOT ASK → the model proceeds autonomously.
//   PAUSE          → while a question is open nothing else executes.
//   MULTI          → two independent decisions reach the person.
//   PROMPT         → the live server's own assembled prompt for this bot
//                    carries the ask section (id + byte count only; the
//                    native log deliberately records no prompt text, so a
//                    structural check is the honest one).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const APK = args.find((a, i) => i === 0 || !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const OPENAI_MODEL = flag("--model") ?? "meta-llama/llama-3.3-70b-instruct";
const CODEX_MODEL = flag("--codex-model") ?? "gpt-5.6-luna";
const ONLY = (flag("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const LEGS = (flag("--legs") ?? "openrouter,codex").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = flag("--out");
const SKIP_INSTALL = args.includes("--skip-install");

const PKG = "com.openmausbot.companion";
const PORT_DEVICE = 18799;
const PORT_HOST = 28799;
const BASE = `http://127.0.0.1:${PORT_HOST}`;
const STAMP = Date.now();
const PREAMBLE = "The user answered your questions.";
const FREE_FALLBACK = "Use your best judgment here — I don't have a preference.";
const ASK_WINDOW_MS = 240_000; // a real model may inspect the workspace before asking
const SETTLE_MS = 150_000;
const failures = [];
const transcript = [];
const record = { device: {}, promptSections: {}, legs: {}, cases: {}, failures };

/** The task rows seen since the last message, for diagnosing a stalled turn. */
const kindsOf = (list) => list.map((m) => `${m.kind}${m.card?.tool ? `:${m.card.tool}` : m.card?.questionRequest ? ":question" : ""}`).join(",") || "(none)";

const adb = (cmd, opts = {}) => execFileSync("adb", cmd.split(" "), { encoding: "utf8", timeout: opts.timeout ?? 60_000, ...opts });
const shell = (cmd, opts = {}) => adb(`shell ${cmd}`, opts).replace(/\r/g, "");
const step = (label) => console.log(`\n== ${label} ==`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
  return ok;
}
function note(line) {
  console.log(`   ${line}`);
  transcript.push(line);
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

async function messages(threadId, limit = 40) {
  const state = await api("GET", `/api/threads/${threadId}/messages?limit=${limit}`, undefined, { timeoutMs: 10_000 });
  return state.json?.messages ?? [];
}

const isQuestion = (m) => m.kind === "options" && Boolean(m.card?.questionRequest?.questions?.length);
const isPermission = (m) => m.kind === "options" && Boolean(m.card?.requestId) && !m.card?.questionRequest;
const botTexts = (list) => list.filter((m) => m.kind === "text" && (m.role === "bot" || m.role === "assistant")).map((m) => m.text ?? "");

/**
 * Send one task and watch the turn. Permission cards (tool approvals) are
 * allowed so real work can proceed; a QUESTION card is the thing under test
 * and is returned unanswered.
 */
async function observe(threadId, text, { windowMs = ASK_WINDOW_MS } = {}) {
  const before = new Set((await messages(threadId)).map((m) => m.id));
  await api("POST", `/api/bots/${state.botId}/messages`, { text, threadId });
  const deadline = Date.now() + windowMs;
  const allowed = new Set();
  while (Date.now() < deadline) {
    let list = [];
    try { list = await messages(threadId); } catch { await sleep(2_000); continue; }
    for (const m of list) {
      if (isPermission(m) && m.card.requestId && !allowed.has(m.card.requestId)) {
        allowed.add(m.card.requestId);
        note(`tool approval card answered allow (tool=${m.card.tool ?? "?"}) so real work could proceed`);
        await api("POST", `/api/threads/${threadId}/respond`, { requestId: m.card.requestId, behavior: "allow" }, { timeoutMs: 20_000 });
      }
    }
    const question = list.find((m) => isQuestion(m) && !m.card.answered && !before.has(m.id));
    if (question) return { asked: true, card: question, list };
    const reply = botTexts(list.filter((m) => !before.has(m.id)));
    if (reply.length) return { asked: false, reply: reply[reply.length - 1], list };
    await sleep(3_000);
  }
  const list = await messages(threadId);
  return { asked: false, reply: "", timeout: true, kinds: kindsOf(list.filter((m) => !before.has(m.id))), list };
}

/** The answer text the card would send, given the person's actual choice. */
function answerFor(card, pick) {
  const q = card.card.questionRequest.questions[0];
  const rows = q.options ?? [];
  let words;
  if (q.type === "confirmation") words = pick === "decline" ? "The user declined." : "The user confirmed.";
  else if (q.type === "free_text") words = pick && pick !== "confirm" ? pick : FREE_FALLBACK;
  else {
    const option = rows.find((o) => o.label.toLowerCase().includes(String(pick).toLowerCase())) ?? rows[0];
    words = option?.label ?? pick;
  }
  return { words, question: q.question, label: words };
}

function sendAnswer(threadId, card, words) {
  const message = `${PREAMBLE}\n\nQ: ${card.card.questionRequest.questions[0].question}\nA: ${words}`;
  return api("POST", `/api/threads/${threadId}/respond`, { requestId: card.card.requestId, behavior: "answer", message }, { timeoutMs: 25_000 });
}

/** While a question is open nothing else may execute: no new rows at all. */
async function assertPaused(threadId, card) {
  const snapshot = (await messages(threadId)).map((m) => m.id);
  await sleep(12_000);
  const after = await messages(threadId);
  const grew = after.filter((m) => !snapshot.includes(m.id));
  const stillOpen = after.some((m) => m.card?.requestId === card.card.requestId && !m.card.answered);
  check("the turn is paused while the question is open", grew.length === 0 && stillOpen,
    grew.length ? `new rows while waiting: ${grew.map((m) => m.kind).join(",")}` : "no activity, card still open");
}

/** Did the resumed work actually use the answer? Reads everything after the
 * card until the bot's text stops growing or the budget runs out.
 *
 * A choice answer is looked for verbatim; a written answer usually comes back
 * paraphrased, so for that the check is whether the distinctive words of what
 * was typed reappear in the work. */
async function usedAnswer(threadId, cardId, label, verbatim = true, needed = 2) {
  const deadline = Date.now() + SETTLE_MS;
  let reply = "";
  let stable = 0;
  while (Date.now() < deadline) {
    const list = await messages(threadId);
    const index = list.findIndex((m) => m.id === cardId);
    const fresh = index === -1 ? list : list.slice(index + 1);
    const next = botTexts(fresh).join("\n");
    if (next === reply && reply) stable += 1; else stable = 0;
    reply = next;
    if (stable >= 2) break;
    await sleep(6_000);
  }
  const haystack = reply.toLowerCase();
  const hit = verbatim
    ? haystack.includes(String(label).toLowerCase())
    : String(label).split(/\s+/).map((w) => w.replace(/[^\w-]/g, "").toLowerCase())
        .filter((w) => w.length > 3)
        .filter((w) => !["your", "with", "that", "this", "them", "next", "keep", "have"].includes(w))
        .filter((w, i, all) => all.indexOf(w) === i)
        .filter((w) => haystack.includes(w)).length >= needed;
  return { reply, hit };
}

/** Wait for a further question card after one was answered, so a task that
 * reaches the person one decision at a time is observed end to end. */
async function nextQuestion(threadId, answeredRequestId, windowMs = 150_000) {
  const deadline = Date.now() + windowMs;
  const allowed = new Set();
  while (Date.now() < deadline) {
    let list = [];
    try { list = await messages(threadId); } catch { await sleep(3_000); continue; }
    for (const m of list) {
      if (isPermission(m) && m.card.requestId && !allowed.has(m.card.requestId)) {
        allowed.add(m.card.requestId);
        await api("POST", `/api/threads/${threadId}/respond`, { requestId: m.card.requestId, behavior: "allow" }, { timeoutMs: 20_000 });
      }
    }
    const q = list.find((m) => isQuestion(m) && !m.card.answered && m.card.requestId !== answeredRequestId);
    if (q) return q;
    await sleep(4_000);
  }
  return null;
}

// ── the cases ───────────────────────────────────────────────────────────────
const CASES = [
  {
    key: "should-ask-ux",
    label: "SHOULD ASK — design decision left to the person",
    text: "Design the settings screen for provider authentication.",
    expectAsk: true,
  },
  {
    key: "should-ask-policy",
    label: "SHOULD ASK — destructive-action policy",
    text: "Implement a feature where destructive actions can either require confirmation or proceed automatically.",
    expectAsk: true,
  },
  {
    key: "should-not-ask-obvious",
    label: "SHOULD NOT ASK — the answer is obvious",
    text: "Write one paragraph explaining what an MQTT broker does.",
    expectAsk: false,
  },
  {
    key: "should-not-ask-inspect",
    label: "SHOULD NOT ASK — the model can inspect and decide",
    text: "Organize the files in your workspace the way you think is best, then tell me what you did.",
    expectAsk: false,
  },
  {
    key: "multi",
    label: "MULTI — two independent decisions that belong to the person",
    text: "Set up my note-taking workflow. Two decisions are yours to get from me rather than guess: how notes should be named, and where drafts should live.",
    expectAsk: true,
    maxAsks: 2,
    freeAnswer: "Prefix each note with the date as YYYY-MM-DD, and keep drafts in a drafts folder next to them.",
  },
];

// ── 1. device ───────────────────────────────────────────────────────────────
if (!APK || !existsSync(APK)) {
  console.error(`APK not found: ${APK ?? "(none)"}`);
  process.exit(2);
}
step("device");
const deviceInfo = {
  model: shell("getprop ro.product.model").trim(),
  abi: shell("getprop ro.product.cpu.abi").trim(),
  api: shell("getprop ro.build.version.sdk").trim(),
  serial: shell("getprop ro.serialno").trim(),
  apk: APK,
};
record.device = { ...deviceInfo, startedAt: new Date().toISOString() };
console.log(`device: ${deviceInfo.model}  abi=${deviceInfo.abi}  api=${deviceInfo.api}`);
if (SKIP_INSTALL) {
  console.log("skipping install (--skip-install): the already-installed build is used");
} else {
  try { adb(`install -r -g ${APK}`, { timeout: 420_000 }); }
  catch { console.log("install retry after transient failure…"); adb(`install -r -g ${APK}`, { timeout: 420_000 }); }
}
adb("logcat -c");
adb(`shell am start -n ${PKG}/.MainActivity`);
adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);
let health = null;
for (let i = 0; i < 60; i += 1) {
  try { health = (await api("GET", "/api/health", undefined, { timeoutMs: 3_000 })).json; } catch { /* not up */ }
  if (health) break;
  await sleep(1_500);
}
if (!check("host healthy on device", Boolean(health))) process.exit(4);
const state = { botId: "" };

/** One provider leg: a throwaway bot pointed at an existing, real instance. */
async function leg({ name, instanceId, model }) {
  step(`${name}: real model ${model} on ${instanceId}`);
  const created = await api("POST", "/api/bots", { name: `Real Ask ${name} ${STAMP}` });
  const bot = created.json?.bot;
  if (!check(`${name}: bot created`, Boolean(bot?.id))) return;
  const botId = bot.id;
  const threadId = bot.threadId;
  state.botId = botId;
  // Installing restarts the host, which re-syncs the provider catalog; read it
  // only after an explicit refresh, and refuse to run a model that is not the
  // one asked for rather than silently substituting the instance default.
  let options = [];
  for (let attempt = 0; attempt < 3 && !options.length; attempt += 1) {
    await api("POST", `/api/instances/${instanceId}/refresh-models`, {}, { timeoutMs: 90_000 });
    const catalog = (await api("GET", "/api/instances")).json?.instances?.find((i) => i.instanceId === instanceId);
    options = catalog?.models?.options ?? [];
    if (!options.length) await sleep(3_000);
  }
  const chosen = options.some((o) => o.id === model) ? model : "";
  if (!check(`${name}: the requested model is in the refreshed catalog`, Boolean(chosen),
    `${options.length} options; "${model}" ${options.some((o) => o.id === model) ? "present" : "absent"}`)) {
    await api("DELETE", `/api/bots/${botId}`, undefined, { timeoutMs: 20_000 });
    return;
  }
  await api("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId, model: chosen } });
  record.legs[name] = { instanceId, model: chosen };

  // Structural prompt check against the live server's own assembly for THIS
  // bot. Only the id, label and byte count are logged — never the text.
  const prompt = (await api("GET", `/api/bots/${botId}/system-prompt`, undefined, { timeoutMs: 25_000 })).json;
  const askSection = (prompt?.sections ?? []).find((s) => s.id === "ask");
  check(`${name}: the assembled prompt carries the ask section`, Boolean(askSection?.bytes),
    askSection ? `section id=${askSection.id} label="${askSection.label}" bytes=${askSection.bytes}` : "no ask section");
  note(`${name}: prompt section ask = ${askSection?.bytes ?? 0} bytes (${askSection?.label ?? "missing"})`);
  record.promptSections[name] = { id: askSection?.id ?? null, label: askSection?.label ?? null, bytes: askSection?.bytes ?? 0,
    totalSections: (prompt?.sections ?? []).length, totalBytes: (prompt?.sections ?? []).reduce((n, s) => n + (s.bytes ?? 0), 0) };

  const results = {};
  const cases = ONLY.length ? CASES.filter((c) => ONLY.includes(c.key)) : CASES;
  if (ONLY.length) note(`${name}: running only ${cases.map((c) => c.key).join(", ")}`);
  try {
  for (const testCase of cases) {
    step(`${name}: ${testCase.label}`);
    const seen = await observe(threadId, testCase.text, { windowMs: testCase.expectAsk ? ASK_WINDOW_MS : SETTLE_MS });
    if (!seen.asked) {
      if (testCase.expectAsk) {
        check(`${name}: ${testCase.key} — the model asked on its own`, false,
          seen.timeout ? `no question within the window and no reply (rows: ${seen.kinds})` : `it just answered: ${(seen.reply || "").replace(/\s+/g, " ").slice(0, 110)}`);
        note(`${name}/${testCase.key}: DID NOT ASK, though the decision belonged to the person`);
      } else {
        // Restraint only counts when the model actually did the work: an empty
        // turn is a stalled model, not good judgement, so it fails here.
        const settled = (seen.reply || "").trim();
        check(`${name}: ${testCase.key} — the model proceeded without asking`, Boolean(settled),
          settled ? `settled: ${settled.replace(/\s+/g, " ").slice(0, 110)}`
            : `no reply at all (rows: ${seen.kinds}) — nothing ran, so restraint cannot be judged`);
        note(`${name}/${testCase.key}: ${settled ? "did NOT ask (correct restraint)" : "did NOT ask and did NOT proceed"}`);
        results[testCase.key] = { asked: false, proceeded: Boolean(settled), reply: settled };
      }
      continue;
    }
    check(`${name}: ${testCase.key} — the model asked on its own`, testCase.expectAsk);
    const q = seen.card.card.questionRequest.questions[0];
    const allQuestions = seen.card.card.questionRequest.questions;
    note(`${name}/${testCase.key}: ASKED (${allQuestions.length} question${allQuestions.length > 1 ? "s" : ""}, type=${q.type})`);
    note(`${name}/${testCase.key}: question shown: "${q.question}"`);
    note(`${name}/${testCase.key}: options shown: ${(q.options ?? []).map((o) => o.label).join(" | ") || "(free text)"}`);
    check(`${name}: ${testCase.key} — the card is a typed question, not a permission`, Boolean(q.type) && !seen.card.card.tool);
    await assertPaused(threadId, seen.card);

    // Several independent decisions may reach the person in one card or one
    // at a time; which is the model's call, so both are observed.
    const maxAsks = testCase.maxAsks ?? 1;
    const rounds = [];
    let current = seen.card;
    for (let round = 0; current && round < maxAsks; round += 1) {
      const cq = current.card.questionRequest.questions[0];
      const { words, label } = answerFor(current, testCase.freeAnswer ?? "confirm");
      note(`${name}/${testCase.key}: answered: "${words}"`);
      if (testCase.key === "should-ask-ux" && round === 0) {
        const tapped = await tapAnswer(threadId, current, words);
        note(`${name}/${testCase.key}: answer given by tapping the card on the phone's screen: ${tapped.ok}${tapped.ok ? "" : ` (stage: ${tapped.stage})`}`);
        if (!tapped.ok) await sendAnswer(threadId, current, words);
      } else {
        await sendAnswer(threadId, current, words);
      }
      rounds.push({ cardId: current.id, requestId: current.card.requestId, type: cq.type, label, words,
        question: cq.question, options: (cq.options ?? []).map((o) => o.label) });
      if (round + 1 < maxAsks) current = await nextQuestion(threadId, current.card.requestId);
    }
    if (rounds.length > 1) note(`${name}/${testCase.key}: the model asked ${rounds.length} times, one decision at a time`);
    const labels = rounds.map((r) => r.label).join(" ");
    const verbatim = rounds.every((r) => r.type !== "free_text");
    const used = await usedAnswer(threadId, rounds[0].cardId, labels, verbatim, rounds.length > 1 ? 3 : 2);
    check(`${name}: ${testCase.key} — the SAME task resumed and used the answer`, used.hit,
      used.hit ? `the work reflects "${labels.slice(0, 80)}"` : `reply: ${used.reply.replace(/\s+/g, " ").slice(0, 140)}`);
    note(`${name}/${testCase.key}: resumed reply: ${used.reply.replace(/\s+/g, " ").slice(0, 180)}`);
    const settled = (await messages(threadId)).find((m) => m.card?.requestId === rounds[0].requestId);
    check(`${name}: ${testCase.key} — exactly one resume, the card keeps the answer`, Boolean(settled?.card?.answeredText) && !settled?.card?.dismissed);
    results[testCase.key] = { task: testCase.text, asked: true, rounds, used: used.hit, reply: used.reply.replace(/\s+/g, " ").slice(0, 400) };
  }
  } finally {
    // never leave a real-model bot behind, even when a leg throws
    await api("DELETE", `/api/bots/${botId}`, undefined, { timeoutMs: 20_000 });
  }
  record.cases[name] = results;
  return results;
}

/** Tap the answer on the phone's screen for one case. */
function uiDump(tag) {
  const path = `/sdcard/omb-real-ask-${tag}.xml`;
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

/** What was actually on the screen, for a diagnosable failure. */
function describeScreen(xml) {
  if (!xml) return "(no dump)";
  const texts = [...xml.matchAll(/(?:text|content-desc)="([^"]{2,})"/g)].map((m) => m[1]);
  const unique = texts.filter((t, i) => texts.indexOf(t) === i).slice(0, 12);
  return unique.length ? `visible: ${unique.join(" | ").slice(0, 220)}` : "(no readable text)";
}

async function tapAnswer(threadId, card, words) {
  const q = card.card.questionRequest.questions[0];
  const optionLabel = (q.options ?? []).find((o) => o.label.toLowerCase() === String(words).toLowerCase())?.label ?? null;
  const botName = (await api("GET", "/api/bots")).json?.bots?.find((b) => b.id === state.botId)?.name ?? "";
  const read = async (tag) => {
    const xml = uiDump(tag);
    return { xml, onCard: Boolean(nodeFor(xml, q.question)), option: optionLabel ? nodeFor(xml, optionLabel) : null };
  };
  shell("input keyevent KEYCODE_HOME");
  await sleep(1_500);
  adb(`shell am start -n ${PKG}/.MainActivity`);
  await sleep(3_000);

  let seen = await read("tap0");
  // The card is on screen when its question text is. If it is not, open this
  // bot's thread from the roster and give Compose a moment to compose the card.
  for (let attempt = 0; attempt < 3 && !seen.option; attempt += 1) {
    if (!seen.onCard) {
      const roster = seen.xml ?? uiDump("roster");
      const row = nodeFor(roster, botName) ?? nodeFor(roster, botName.split(" ").slice(0, 3).join(" "));
      if (!row) return { ok: false, stage: `bot row "${botName}" not on the roster — ${describeScreen(roster)}` };
      tap(row);
      await sleep(3_000);
    } else {
      await sleep(1_500);
    }
    seen = await read(`tap${attempt + 1}`);
  }
  // Last resort: the card may be off the fold of the lazy transcript. Nudge it
  // both ways; rows below the fold are not composed until they scroll in.
  if (!seen.option) {
    const size = /(\d+)x(\d+)/.exec(shell("wm size"));
    const [width, height] = size ? [Number(size[1]), Number(size[2])] : [1080, 2340];
    const up = Math.round(height * 0.72);
    const down = Math.round(height * 0.34);
    for (const [from, to] of [[up, down], [down, up]]) {
      for (let i = 0; i < 4 && !seen.option; i += 1) {
        shell(`input swipe ${Math.round(width / 2)} ${from} ${Math.round(width / 2)} ${to} 200`);
        await sleep(1_000);
        seen = await read(`scroll${from}_${i}`);
      }
      if (seen.option) break;
    }
  }
  if (!seen.option) return { ok: false, stage: `option "${optionLabel ?? "(none)"}" not tappable — ${describeScreen(seen.xml)}` };
  tap(seen.option);
  await sleep(900);
  const ready = uiDump("ready");
  const submit = nodeFor(ready, "Submit answer");
  if (!submit) return { ok: false, stage: `option tapped but no Submit answer button — ${describeScreen(ready)}` };
  tap(submit);
  return { ok: true, stage: "tapped the option and Submit answer" };
}

// ── 2. run both real provider legs ──────────────────────────────────────────
const legs = {
  openrouter: () => leg({ name: "openrouter", instanceId: "openaiCompat", model: OPENAI_MODEL }),
  codex: () => leg({ name: "codex", instanceId: "codex", model: CODEX_MODEL }),
};
const legResults = {};
for (const name of LEGS) {
  if (!legs[name]) { console.log(`unknown leg "${name}"`); continue; }
  legResults[name] = await legs[name]();
}
const openaiResults = legResults.openrouter;
const codexResults = legResults.codex;

step("real-model summary");
for (const [name, results] of [["openrouter", openaiResults], ["codex", codexResults]]) {
  if (!results) continue;
  for (const [key, value] of Object.entries(results)) {
    const answers = (value.rounds ?? []).map((r) => r.words).join(" | ");
    note(`${name}/${key}: asked=${value.asked} answers="${answers}" used=${value.used}`);
  }
}
record.finishedAt = new Date().toISOString();
if (OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nwrote evidence record: ${OUT}`);
}
console.log(`\nREAL-MODEL RESULT: ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} check(s) failed: ${failures.join("; ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
