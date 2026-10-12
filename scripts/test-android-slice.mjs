#!/usr/bin/env node
// Phase 3/4 vertical-slice device test — one Node driver for the whole slice.
//
//   scripts/test-android-slice.mjs <apk> [--key SK-...] [--url BASE]
//                                  [--stored-key] [--mock]
//
// Modes:
//   (default)     config-layer proof: bot create + provider URL write/read-back.
//   --key         real provider: streamed reply, tool-call approval, workspace file.
//   --stored-key  same as --key, reusing the credential already on the device
//                 (nothing is written; the key never appears on a command line).
//   --mock        deterministic OpenAI-compatible mock provider running ON the
//                 device (app-private, port 28798) scripting the agent through
//                 workspace_write, run_command, http_fetch and web_search —
//                 the full tool loop with zero external dependencies.
//
// Evidence chain (exit 0 only if all pass):
//   1. install + launch + host health
//   2. bot created through POST /api/bots on the DEVICE host
//   3. provider configured; model options fetched (top-level models.options)
//   4. chat turn accepted; SSE stream alive (data: frames)
//   5. deep modes: assistant reply through the stream
//   6. deep modes: every approval card answered via /respond exactly once
//      ({behavior:"allow", requestId:<card requestId>} — a stale requestId
//      now returns a diagnostic `reason` instead of a bare unavailable)
//   7. deep modes: workspace artifact created by the approved tool call
//   8. exactly one host process before AND after (no duplicate hosts)
//   9. force-stop → relaunch → same bot still served; workspace survived
//
// All requests ride an adb forward — loopback on the device, the same trust
// path the app's own UI uses. This driver is the ONLY protocol consumer in
// the repo outside android/core: the approval contract, the models.options
// location and the SSE frame shape live here in code, not in docs.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const APK = args.find((a, i) => i === 0 || !a.startsWith("--"));
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const OPENAI_KEY = typeof flagValue("--key") === "string" ? flagValue("--key") : "";
const PROVIDER_URL_ARG = typeof flagValue("--url") === "string" ? flagValue("--url") : "";
const STORED_KEY = args.includes("--stored-key");
const MOCK = args.includes("--mock");

const PKG = "com.openmausbot.companion";
const PORT_DEVICE = 18799;
const PORT_HOST = 28799;
const BASE = `http://127.0.0.1:${PORT_HOST}`;
const MOCK_PORT_DEVICE = 28798;
const MOCK_PORT_HOST = 28797;
const STAMP = Date.now();
const BOT_NAME = `Slice Bot ${STAMP}`;
const failures = [];
const DEEP = Boolean(OPENAI_KEY || STORED_KEY || MOCK);

const adb = (cmd, opts = {}) => execFileSync("adb", cmd.split(" "), { encoding: "utf8", timeout: opts.timeout ?? 60_000, ...opts });
const shell = (cmd, opts = {}) => adb(`shell ${cmd}`, opts).replace(/\r/g, "");

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function api(method, path, body, { timeoutMs = 15_000, raw = false } = {}) {
  const hasBody = body !== undefined && method !== "GET";
  const init = { method, signal: AbortSignal.timeout(timeoutMs) };
  if (hasBody) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, json, text: raw ? text : undefined };
}

const step = (label) => console.log(`\n== ${label} ==`);

if (!APK || !existsSync(APK)) {
  console.error(`APK not found: ${APK ?? "(none)"}`);
  process.exit(2);
}
if (execFileSync("adb", ["get-state"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() !== "device") {
  console.error("No device attached. Connect the phone (USB debugging on).");
  process.exit(2);
}
console.log(`device: ${shell("getprop ro.product.model").trim()}  abi=${shell("getprop ro.product.cpu.abi").trim()}  api=${shell("getprop ro.build.version.sdk").trim()}`);

// ── 1. install + launch + health ────────────────────────────────────────────
step("install + launch");
// One retry: streamed installs over flaky USB occasionally fail mid-transfer.
try {
  adb(`install -r -g ${APK}`, { timeout: 180_000 });
} catch {
  console.log("install retry after transient failure…");
  adb(`install -r -g ${APK}`, { timeout: 180_000 });
}
adb("logcat -c");
adb(`shell am start -n ${PKG}/.MainActivity`);
adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);

let health = null;
for (let i = 0; i < 40; i += 1) {
  try { health = (await api("GET", "/api/health", undefined, { timeoutMs: 3_000 })).json; } catch { /* not up yet */ }
  if (health) break;
  await new Promise((r) => setTimeout(r, 1_000));
}
if (!health) {
  console.error("host never answered /api/health");
  console.error(adb("logcat -d").split("\n").filter((l) => /HarnessHost|HostFiles/.test(l)).slice(-30).join("\n"));
  process.exit(4);
}
console.log(`health: ${JSON.stringify(health)}`);
const hostPid = String(health.pid);
check("host healthy on device", Boolean(hostPid));

// Host-process count — the no-duplicate-hosts assertion (TEST 17). Scans
// /proc cmdlines directly (same mechanism as driver-common's countHosts):
// OEM `ps -A -o ARGS` truncates command lines on some builds and reports 0
// for a live host. The `[-]` pattern keeps grep and its sh -c wrapper from
// matching themselves.
const countHosts = async () => shell(`run-as ${PKG} sh -c 'grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null | wc -l'`).trim();
const hostsBefore = await countHosts();
check("exactly one host process", hostsBefore === "1", `count=${hostsBefore}`);

// ── 2. bot creation ─────────────────────────────────────────────────────────
step("1. local bot creation");
const created = await api("POST", "/api/bots", { name: BOT_NAME });
const bot = created.json?.bot;
check("bot created on device host", Boolean(bot?.id), `id=${bot?.id ?? "?"}`);
const botId = bot?.id;
const threadId = bot?.threadId;

// Snapshot the REAL provider config before the driver touches anything —
// every mock/override branch must restore this (incident 2026-09-19: a run
// left the phone's openaiCompat pointing at the on-device mock, so the user
// saw scripted "DONE file written" replies for every real message).
const savedConfigJson = ((await api("GET", "/api/config")).json)?.openaiCompat ?? {};
const savedProviderUrl = savedConfigJson.url ?? "";
// /api/config never returns the key itself; `configured` is the only signal.
const savedKeyConfigured = Boolean(savedConfigJson.configured);

// ── mock provider lifecycle (on-device, app-private) ───────────────────────
async function ensureDeviceMock() {
  adb(`forward tcp:${MOCK_PORT_HOST} tcp:${MOCK_PORT_DEVICE}`);
  try {
    // Identity check, not just liveness: a leftover process on this port
    // that is NOT our current mock (stale code, another app) must fail the
    // run loudly instead of being silently blessed as the provider.
    const probe = await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(3_000) });
    const body = await probe.json().catch(() => null);
    if (probe.ok && body?.data?.some?.((m) => m?.id === "mock-1")) return true;
    throw new Error(`port ${MOCK_PORT_DEVICE} held by a non-mock or stale mock (status ${probe.status})`);
  } catch (e) {
    if (String(e).includes("non-mock or stale mock")) throw e;
    /* not running — start it */
  }
  const nodeExe = shell(`run-as ${PKG} sh -c 'readlink /proc/${hostPid}/exe'`).trim();
  if (!nodeExe) return false;
  const libDir = nodeExe.replace(/\/[^/]+$/, "");
  const stage = mkdtempSync(join(tmpdir(), "omb-mock-"));
  const pushPath = `${stage}/ombmock.cjs`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(pushPath, readFileSync(new URL("./omb-openai-mock.cjs", import.meta.url)));
  adb(`push ${pushPath} /data/local/tmp/ombmock.cjs`, { timeout: 120_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/ombmock.cjs files/ombmock.cjs`);
  const filesDir = shell(`run-as ${PKG} sh -c 'pwd'`).trim();
  shell(`run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 nohup ${nodeExe} files/ombmock.cjs ${MOCK_PORT_DEVICE} >/dev/null 2>&1 &'`);
  await new Promise((r) => setTimeout(r, 2_000));
  try {
    const probe = await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(5_000) });
    return probe.ok;
  } catch { return false; }
}

// ── 3. provider configuration ───────────────────────────────────────────────
step("2. local provider configuration");
let providerUrl = PROVIDER_URL_ARG;
let model = "";
if (MOCK) {
  const mockUp = await ensureDeviceMock();
  check("deterministic mock provider running on device", mockUp);
  // URL-ONLY patch: config sections merge per-field (config.ts writeConfig),
  // so this preserves the stored real key. Writing a placeholder key here
  // destroyed the user's real key (incident 2026-09-19) — never do that.
  // A placeholder key is written ONLY when the device had none (the driver's
  // /models refresh no-ops keyless); it is cleared again during restore.
  const mockNeedsKey = !savedKeyConfigured;
  const mockPut = await api("PUT", "/api/config", { openaiCompat: { url: `http://127.0.0.1:${MOCK_PORT_DEVICE}/v1`, ...(mockNeedsKey ? { key: "mock-not-a-secret" } : {}) } });
  check("mock provider accepted by config", mockPut.status === 200, `http ${mockPut.status}`);
  providerUrl = `http://127.0.0.1:${MOCK_PORT_DEVICE}/v1`;
} else if (STORED_KEY) {
  const config = (await api("GET", "/api/config")).json;
  providerUrl = config?.openaiCompat?.url ?? "";
  check("stored provider configuration present", Boolean(providerUrl), providerUrl);
} else {
  await api("PUT", "/api/config", { openaiCompat: { url: providerUrl || "https://api.openai.com/v1", ...(OPENAI_KEY ? { key: OPENAI_KEY } : {}) } });
}

if (DEEP) {
  // Point THIS bot at the provider explicitly before any turn: a new bot's
  // default selection can resolve to a different stored instance (e.g. a
  // leftover OpenRouter account), which would fail turns through no fault
  // of the code under test.
  const put = await api("PUT", "/api/config", { openaiCompat: { url: providerUrl } });
  check("provider URL accepted by config", put.status === 200, `http ${put.status} ${JSON.stringify(put.json ?? {}).slice(0, 120)}`);
  const refreshed = await api("POST", "/api/instances/openaiCompat/refresh-models", {}, { timeoutMs: 60_000 });
  // The catalog lives at the instance's TOP-LEVEL models.options (registry.describe).
  const instance = refreshed.json?.instances?.find((i) => i.instanceId === "openaiCompat");
  const options = instance?.models?.options ?? [];
  console.log(`model options: ${options.map((o) => o.id).join(", ") || "(none)"}`);
  // options[0] is NOT guaranteed to be a chat model (e.g. meta.ai's catalog
  // starts with sam-3.1, which 400s on plain text and surfaces as "provider
  // returned an empty response"). --model pins a real chat model explicitly.
  model = flagValue("--model") ?? options[0]?.id ?? "";
  check("provider refresh succeeded", refreshed.status === 200, `http ${refreshed.status}`);
  // A stale catalog (from a previous provider config, or a keyless no-op
  // refresh) must not pass silently. In MOCK mode a key is always present
  // (stored, or the placeholder written above), so the mock's catalog must
  // arrive; without a key the driver's /models fetch is a documented no-op.
  if (MOCK) {
    check("refreshed catalog is the mock's, not stale", options.some((o) => o.id === "mock-1"), options.map((o) => o.id).join(",") || "(none)");
  } else {
    check("catalog refreshed", Boolean(model), options.map((o) => o.id).join(",") || "(none)");
  }
  check("provider refresh returned model options", Boolean(model), `url=${providerUrl}`);
  if (model) {
    await api("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId: "openaiCompat", model } });
  }
}

// ── 4/5. chat turn + SSE ────────────────────────────────────────────────────
step("3. chat turn through the device host");
// The mock is cue-driven: with it, the first turn demonstrates a plain chat
// completion AND carries the workspace-write cue (→ approval card → file).
const firstTurnText = MOCK
  ? "Say pong. Then cue-write so the tool creates agent-proof.txt."
  : "Reply with exactly: pong";
const send = await api("POST", `/api/bots/${botId}/messages`, { text: firstTurnText, threadId });
check("message accepted by host", [200, 201, 202].includes(send.status), `http ${send.status}`);

step("4. stream events");
let sseFrames = 0;
try {
  const stream = await fetch(`${BASE}/api/events`, { signal: AbortSignal.timeout(8_000) });
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + 6_000;
  let acc = "";
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    sseFrames += (acc.match(/^data:/gm) ?? []).length;
    if (sseFrames > 0 && Date.now() > deadline - 5_500) break;
  }
  reader.cancel().catch(() => {});
} catch { /* stream ended */ }
check("event stream is alive", sseFrames > 0, `${sseFrames} data frames`);

// ── deep: real turn with tool calls + approvals ─────────────────────────────
const answeredRequestIds = new Set();
async function pollTurn(seconds, matcher) {
  // Answer every new approval card, then KEEP polling: the turn continues
  // after the tool runs, and the matcher decides when the reply has landed.
  // Transient adb-forward resets are survived: a failed poll just retries.
  for (let i = 0; i < seconds; i += 1) {
    let messages = [];
    try {
      const state = (await api("GET", `/api/threads/${threadId}/messages?limit=8`, undefined, { timeoutMs: 8_000 })).json;
      messages = state?.messages ?? [];
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    for (const message of messages) {
      const requestId = message?.card?.requestId;
      if (message.kind === "options" && requestId && !answeredRequestIds.has(requestId)) {
        answeredRequestIds.add(requestId);
        console.log(`approval card pending (requestId=${requestId}, tool=${message.card?.tool ?? "?"}); answering allow`);
        const respond = await api("POST", `/api/bots/${botId}/respond`, { behavior: "allow", requestId });
        console.log(`respond: ${respond.text ?? JSON.stringify(respond.json)}`.slice(0, 200));
        if (respond.json?.reason && respond.json.outcome === "unavailable") console.log(`respond reason: ${respond.json.reason}`);
      }
    }
    // The LAST bot text is the turn's reply — the window always contains
    // the greeting, so a first-match search would never see the reply.
    const reply = [...messages].reverse().find((m) => m.kind === "text" && (m.role === "bot" || m.role === "assistant"))?.text ?? "";
    if (reply && matcher(reply)) return { approved: answeredRequestIds.size > 0, reply };
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { approved: answeredRequestIds.size > 0, reply: "" };
}

if (DEEP && model) {
  step("5. streamed turn: model → tools → approval → reply");
  const turn = await pollTurn(75, (text) => /pong|DONE/i.test(text));
  check("assistant reply arrived through the stream", /pong|DONE/i.test(turn.reply), turn.reply.slice(0, 120));
  if (answeredRequestIds.size === 0) {
    // Direct-reply provider: force the tool path explicitly.
    await api("POST", `/api/bots/${botId}/messages`, {
      text: `Use the file tool to create agent-proof.txt containing "phase4 proof". Then reply DONE. Also run the command tool with uname -m and fetch https://api.github.com/zen and search the web for "OpenMausBot". Reply DONE when all four are complete.`,
      threadId,
    });
    const deep = await pollTurn(120, (text) => /DONE/i.test(text));
    check("tool-turn reply arrived (fs+cmd+net+search)", /DONE/i.test(deep.reply), deep.reply.slice(0, 160));
  }
  check("tool-call approval card answered via /respond", answeredRequestIds.size > 0, `cards=${answeredRequestIds.size}`);
  const artifact = shell(`run-as ${PKG} find files/host/workspace -maxdepth 2 -name 'agent-proof.txt' 2>/dev/null | head -1`).trim();
  if (artifact) {
    console.log(`workspace artifact: ${artifact}`);
    console.log(shell(`run-as ${PKG} cat ${artifact}`).trim().slice(0, 120));
  }
  check("workspace artifact written by approved tool call", Boolean(artifact));
}

// ── restore the REAL provider before the persistence step ──────────────────
// The driver must never leave test config behind (see snapshot comment).
if (MOCK || OPENAI_KEY || providerUrl !== savedProviderUrl) {
  step("restore real provider config");
  if (!savedProviderUrl) {
    console.log("WARN: device had no prior openaiCompat URL; leaving mock config in place — wipe it manually");
  } else {
    const restore = await api("PUT", "/api/config", { openaiCompat: { url: savedProviderUrl, ...(savedKeyConfigured ? {} : { key: "" }) } });
    check("real provider URL restored", restore.status === 200, `http ${restore.status}`);
    if (savedKeyConfigured) {
      // Only with a stored key does /models refresh actually fetch; on a
      // keyless device the refresh is a documented no-op and there is
      // nothing meaningful to assert about the catalog.
      const refreshed = await api("POST", "/api/instances/openaiCompat/refresh-models", {}, { timeoutMs: 60_000 });
      const options = refreshed.json?.instances?.find((i) => i.instanceId === "openaiCompat")?.models?.options ?? [];
      check("restored provider catalog is not the mock's", !options.some((o) => o.id === "mock-1"), options.map((o) => o.id).slice(0, 3).join(","));
    }
  }
}

// ── 8. persistence across force-stop ────────────────────────────────────────
step("7. kill → reopen → persistence");
adb(`shell am force-stop ${PKG}`);
await new Promise((r) => setTimeout(r, 2_000));
adb(`shell am start -n ${PKG}/.MainActivity`);
adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);
let persist = null;
for (let i = 0; i < 40; i += 1) {
  try { persist = (await api("GET", "/api/health", undefined, { timeoutMs: 3_000 })).json; } catch { /* not up yet */ }
  if (persist) break;
  await new Promise((r) => setTimeout(r, 1_000));
}
check("host healthy after force-stop + relaunch", Boolean(persist));
const fleet = (await api("GET", "/api/bots")).json;
check("created bot still served after force-stop + relaunch", JSON.stringify(fleet?.bots ?? []).includes(BOT_NAME));
console.log(`host pid after restart: ${persist?.pid ?? "?"} (different pid = clean re-lease)`);
if (DEEP) {
  const survived = shell(`run-as ${PKG} find files/host/workspace -maxdepth 2 -name 'agent-proof.txt' 2>/dev/null | head -1`).trim();
  check("workspace persisted across force-stop + relaunch", Boolean(survived));
}
const hostsAfter = await countHosts();
check("exactly one host process after restart", hostsAfter === "1", `count=${hostsAfter}`);

// Fleet hygiene: remove this run's test bot so repeated runs don't litter
// the user's device fleet (previous runs left "Slice Bot …" entries).
try { await api("DELETE", `/api/bots/${botId}`, undefined, { timeoutMs: 15_000 }); } catch { /* best-effort */ }

// Kill the on-device mock so no leftover process can answer later turns.
if (MOCK) {
  // Bracket in the pattern keeps pkill from matching its own sh -c wrapper.
  shell(`run-as ${PKG} sh -c 'pkill -f "ombmoc[k].cjs" || true'`);
  adb(`forward --remove tcp:${MOCK_PORT_HOST}`);
}

console.log(`\nSLICE RESULT: ${failures.length === 0 ? `ALL CHECKS PASSED on ${shell("getprop ro.product.cpu.abi").trim()}` : `${failures.length} check(s) failed`}`);
process.exit(failures.length === 0 ? 0 : 1);
