// Shared infrastructure for the Phase 5 MCP device drivers
// (test-android-mcp.mjs = stdio leg, test-android-mcp-remote.mjs = remote
// HTTP/SSE leg). Everything here talks to the same installed app the same
// way: adb for device control, the adb-forwarded :28799 for the host API.
// Transport-specific orchestration lives in the drivers, not here.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PKG = "com.openmausbot.companion";
export const PORT_DEVICE = 18799;
export const PORT_HOST = 28799;
export const BASE = `http://127.0.0.1:${PORT_HOST}`;
export const MOCK_PORT_DEVICE = 28798;
export const MOCK_PORT_HOST = 28797;

/**
 * Target one physical phone when several are attached — the two-ABI phases
 * run with both phones plugged in. Every adb() call already honors adb's own
 * ANDROID_SERIAL, so this is the whole mechanism; with no serial the
 * single-device case keeps working unchanged.
 */
export function selectDevice(serial) {
  if (serial) process.env.ANDROID_SERIAL = serial;
}

/** Parse the drivers' one argv shape: <apk> then --flag value pairs. */
export function parseArgs(usage) {
  const args = process.argv.slice(2);
  const APK = args.find((a, i) => i === 0 || !a.startsWith("--"));
  const flagValue = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  return { APK, flagValue, args, usage };
}

// ── check ledger ─────────────────────────────────────────────────────────────
export const failures = [];
export function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
export function step(label) {
  console.log(`\n== ${label} ==`);
}
export function finish(label, deviceAbi) {
  console.log(`\n${label}: ${failures.length === 0 ? `ALL CHECKS PASSED on ${deviceAbi}` : `${failures.length} check(s) failed`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

// ── device access ────────────────────────────────────────────────────────────
export function adb(cmd, opts = {}) {
  return execFileSync("adb", cmd.split(" ").filter(Boolean), {
    encoding: "utf8", timeout: opts.timeout ?? 60_000, input: opts.input,
  });
}
export function shell(cmd, opts = {}) {
  return adb(`shell ${cmd}`, opts).replace(/\r/g, "");
}
// The host PID is discovered by each driver after launch and published here
// so hostNode() can read /proc/<pid>/exe. Set via setHostPid().
let hostPid = "";
export function setHostPid(pid) { hostPid = pid; }

/** Absolute on-device path of the app's embedded node + its lib dir. */
export function hostNode() {
  const exe = shell(`run-as ${PKG} sh -c 'readlink /proc/${hostPid}/exe'`).trim();
  return { exe, libDir: exe.replace(/\/[^/]+$/, "") };
}
/** The app files dir (`pwd` under run-as), the base for pushed fixtures. */
export const appFilesDir = () => shell(`run-as ${PKG} sh -c 'pwd'`).trim();
/** Host-process count — no-duplicate assertion. Scans /proc cmdlines directly
 * (the exact mechanism the fixture reaper proved reliable on-device): OEM `ps
 * -A -o ARGS` truncates command lines on some builds, which once reported 0
 * hosts for a live host and produced a false "leak" verdict. The `[h]` bracket
 * keeps the sh -c wrapper's own cmdline from matching. */
export const countHosts = () => {
  // The retry loop runs on-device (sync API for the callers): a transient
  // run-as/adb outage right after the cleanup kills resolves within seconds,
  // and the on-device sleep keeps the repeat attempts out of that window.
  const scan =
    "n=0; for i in 1 2 3 4; do n=$(grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null | wc -l); [ \"$n\" -ge 1 ] && break; sleep 2; done; echo \"$n\"";
  try {
    const n = shell(`run-as ${PKG} sh -c '${scan}'`).trim();
    if (n !== "") return n;
  } catch { /* adb-wide blip: fall through */ }
  // One paced re-attempt after the device side settles.
  return shell(`sleep 3; run-as ${PKG} sh -c '${scan}'`).trim();
};

/** Push a generated fixture into the app's files/ dir. */
export function pushFixture(name, content) {
  const stage = mkdtempSync(join(tmpdir(), "omb-mcp-"));
  const host = `${stage}/${name}`;
  writeFileSync(host, content);
  adb(`push ${host} /data/local/tmp/${name}`, { timeout: 120_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/${name} files/${name}`);
}

// ── host install / health ────────────────────────────────────────────────────────
export function requireApk(APK) {
  if (!APK || !APK.endsWith(".apk")) {
    console.error("usage: <script>.mjs <apk> [flags] — pass the APK path as the first positional argument");
    process.exit(2);
  }
}

/** Hard abort on a wrong-ABI install — a misleading native-lib error later is
 * worse than an obvious mismatch now. Returns the device ABI for the report. */
export function requireDeviceAbi(requested) {
  const deviceAbi = shell("getprop ro.product.cpu.abi").trim();
  if (requested && deviceAbi !== requested) {
    console.error(`FATAL: device ABI is ${deviceAbi}, requested ${requested} — wrong phone attached`);
    process.exit(2);
  }
  check(`device ABI is ${requested || "(any)"}`, true, deviceAbi);
  return deviceAbi;
}

export async function launchAndAwaitHost({ install = true, APK } = {}) {
  if (install) adb(`install -r -d ${APK}`, { timeout: 300_000 });
  adb("shell input keyevent KEYCODE_WAKEUP");
  adb("shell wm dismiss-keyguard");
  adb(`shell am force-stop ${PKG}`);
  adb(`shell am start -n ${PKG}/.MainActivity`);
  adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);
  let health = null;
  for (let i = 0; i < 45; i += 1) {
    try { health = (await api("GET", "/api/health", undefined, { timeoutMs: 3_000 })).json; } catch { /* not up yet */ }
    if (health) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return health;
}

// ── host API ─────────────────────────────────────────────────────────────────
export async function api(method, path, body, { timeoutMs = 15_000 } = {}) {
  // The host is reached through an adb forward, which occasionally drops a
  // connection mid-run (USB hiccup, host restart). A transport-level failure
  // is not a product verdict: re-assert the forward and retry a couple of
  // times before letting the error escape. HTTP status codes are never
  // retried — only the socket-level failures that never reached the server.
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      try { adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`); } catch { /* device may be mid-restart */ }
      await new Promise((r) => setTimeout(r, 800));
    }
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text().catch(() => "");
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
      return { status: res.status, json, text };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Poll an async predicate until it holds — the one generic condition
 * waiter every driver wait is built on. */
export async function waitFor(predicate, seconds, everyMs = 1_000) {
  for (let i = 0; i < seconds; i += 1) {
    try { if (await predicate()) return true; } catch { /* transient network/adb errors: keep polling */ }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

/** Wait until the bot reports busy:false on GET /api/bots — the reliable
 * signal that a turn (including its trailing event folds) has finished.
 * A settle-based poll can return while the model is mid-reasoning pause. */
export async function waitIdle(botId, seconds = 120) {
  return waitFor(async () => {
    const bot = ((await api("GET", "/api/bots", undefined, { timeoutMs: 8_000 })).json?.bots ?? []).find((b) => b.id === botId);
    return bot ? bot.busy === false : false;
  }, seconds);
}

// ── approval polling ─────────────────────────────────────────────────────────
const answered = new Set();
export const answeredCount = () => answered.size;

/** Poll a thread until its turn is done, auto-answering approval cards.
 * ONE loop with two completion modes:
 *  - matcher mode (default): finish when the newest bot text matches — a
 *    deterministic mock's reply is a final statement.
 *  - settle mode (opts.settle): finish only after a tool matching
 *    opts.settle.toolRegex returned ok AND the bot reports busy:false —
 *    a real model narrates between tool calls and reasons for long stretches,
 *    so neither interstitial prose nor quiet-counting alone can mean done.
 * opts.onMessages(messages) observes every poll (tool events, connector
 * cards). opts.sinceId scopes the poll to messages appended AFTER that id —
 * a second turn on an existing thread must not see the previous turn's tool
 * events. Returns { answered, reply, tools, connector }. */
export async function pollTurn(seconds, matcher, behavior = "allow", threadId, botId, opts = {}) {
  const settle = opts.settle;
  const tools = [];
  let connector;
  let lastText = "";
  let lastSnapshot = "";
  let quietFor = 0;
  for (let i = 0; i < seconds; i += 1) {
    let messages = [];
    try {
      const state = (await api("GET", `/api/threads/${threadId}/messages?limit=40`, undefined, { timeoutMs: 8_000 })).json;
      messages = state?.messages ?? [];
      if (opts.sinceId) {
        const at = messages.findIndex((m) => m.id === opts.sinceId);
        if (at >= 0) messages = messages.slice(at + 1);
      }
    } catch { await new Promise((r) => setTimeout(r, 1_000)); continue; }
    for (const message of messages) {
      const requestId = message?.card?.requestId;
      if (message.kind === "options" && requestId && !answered.has(requestId)) {
        answered.add(requestId);
        console.log(`approval card (tool=${message.card?.tool ?? "?"}) → ${behavior}`);
        const respond = await api("POST", `/api/bots/${botId}/respond`, { behavior, requestId });
        console.log(`respond: ${respond.text ?? JSON.stringify(respond.json)}`.slice(0, 160));
      }
      if (message.kind === "activity" && /COMPOSIO/i.test(String(message.tool?.name ?? ""))) {
        const event = { name: message.tool.name, ok: message.tool.ok, output: message.tool.output ?? "" };
        if (!tools.some((t) => t.name === event.name && t.ok === event.ok && t.output === event.output)) tools.push(event);
      }
      if (message.kind === "connector") connector = message.connector;
    }
    await opts.onMessages?.(messages);
    const text = [...messages].reverse().find((m) => m.kind === "text" && (m.role === "bot" || m.role === "assistant"))?.text ?? "";
    if (text) lastText = text;
    const snapshot = JSON.stringify(messages.map((m) => [m.id, m.kind, m.tool?.ok ?? "", m.connector?.status ?? "", (m.text ?? "").length]));
    quietFor = snapshot === lastSnapshot ? quietFor + 1 : 0;
    lastSnapshot = snapshot;
    let done = true;
    if (settle) {
      let botIdle = true;
      try {
        const bot = ((await api("GET", "/api/bots", undefined, { timeoutMs: 8_000 })).json?.bots ?? []).find((b) => b.id === botId);
        botIdle = bot ? bot.busy === false : true;
      } catch { botIdle = false; }
      done = tools.some((t) => settle.toolRegex.test(t.name) && t.ok) && botIdle && quietFor >= 1;
    }
    if (done && lastText && (!matcher || matcher(lastText))) {
      return { answered: answered.size > 0, reply: lastText, tools, connector };
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { answered: answered.size > 0, reply: lastText, tools, connector };
}

/** On a timed-out turn, print the thread tail so the failure is
 * self-explaining: which events arrived, which never did. */
export async function dumpThreadTail(threadId) {
  try {
    const state = (await api("GET", `/api/threads/${threadId}/messages?limit=15`, undefined, { timeoutMs: 8_000 })).json;
    console.log("  thread tail at timeout:");
    for (const m of (state?.messages ?? []).slice(-8)) {
      console.log(`    ${m.kind}/${m.role} ${JSON.stringify((m.text ?? m.card?.tool ?? "")).slice(0, 100)}`);
    }
  } catch (error) {
    console.log(`  thread tail unavailable — adb forward likely dead: ${String(error).slice(0, 120)}`);
  }
}

// ── on-device deterministic mock provider ────────────────────────────────────
// A real LLM cannot be scripted, and the approval chain must be driven
// deterministically. The mock runs inside the app's data directory with the
// app's own embedded node. Identity-checked before use: a port held by any
// other process fails the run loudly.
export async function ensureDeviceMock() {
  adb(`forward tcp:${MOCK_PORT_HOST} tcp:${MOCK_PORT_DEVICE}`);
  try {
    const probe = await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(3_000) });
    const body = await probe.json().catch(() => null);
    if (probe.ok && body?.data?.some?.((m) => m?.id === "mock-1")) return true;
    throw new Error(`port ${MOCK_PORT_DEVICE} held by a non-mock or stale mock (status ${probe.status})`);
  } catch (e) {
    if (String(e).includes("non-mock or stale mock")) throw e;
  }
  const { exe, libDir } = hostNode();
  if (!exe) return false;
  const stage = mkdtempSync(join(tmpdir(), "omb-mock-"));
  writeFileSync(`${stage}/ombmock.cjs`, readFileSync(new URL("../omb-openai-mock.cjs", import.meta.url)));
  adb(`push ${stage}/ombmock.cjs /data/local/tmp/ombmock.cjs`, { timeout: 120_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/ombmock.cjs files/ombmock.cjs`);
  const filesDir = appFilesDir();
  shell(`run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 nohup ${exe} files/ombmock.cjs ${MOCK_PORT_DEVICE} >files/ombmock.log 2>&1 &'`);
  await new Promise((r) => setTimeout(r, 2_000));
  try {
    const probe = await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(5_000) });
    return probe.ok;
  } catch { return false; }
}

/** Point the openaiCompat instance at the on-device mock (snapshotting the
 * real URL first). Returns the snapshot for the restore step. */
export async function pointAtMock() {
  const saved = ((await api("GET", "/api/config")).json)?.openaiCompat ?? {};
  const snapshot = { url: saved.url ?? "", keyConfigured: Boolean(saved.configured) };
  const mockNeedsKey = !snapshot.keyConfigured;
  await api("PUT", "/api/config", { openaiCompat: { url: `http://127.0.0.1:${MOCK_PORT_DEVICE}/v1`, ...(mockNeedsKey ? { key: "mock-not-a-secret" } : {}) } });
  const refreshed = await api("POST", "/api/instances/openaiCompat/refresh-models", {}, { timeoutMs: 60_000 });
  const options = refreshed.json?.instances?.find((i) => i.instanceId === "openaiCompat")?.models?.options ?? [];
  return { snapshot, mockCatalogOk: options.some((o) => o.id === "mock-1"), catalog: options.map((o) => o.id).join(",") };
}

/** Restore the real provider URL and verify the mock's catalog is gone. */
export async function restoreProvider(snapshot) {
  if (!snapshot.url) {
    console.log("WARN: device had no prior provider URL; leaving mock URL — remove it in Settings");
    return null;
  }
  const restore = await api("PUT", "/api/config", { openaiCompat: { url: snapshot.url, ...(snapshot.keyConfigured ? {} : { key: "" }) } });
  return { status: restore.status, keyConfigured: snapshot.keyConfigured };
}

/** Kill test processes and remove pushed fixtures/logs from the device.
 * Patterns are literal-ish substrings already bracketed by the caller
 * (e.g. "omb-mcp-serve[r].cjs") so pgrep cannot match this command itself. */
export function deviceCleanup(processPatterns, extraFiles = []) {
  for (const pattern of processPatterns) {
    shell(`run-as ${PKG} sh -c 'pkill -f "${pattern}" || true'`);
  }
  if (extraFiles.length) {
    shell(`run-as ${PKG} sh -c 'rm -f ${extraFiles.join(" ")}'`);
  }
  // The mock provider process itself — ensureDeviceMock may not have started
  // it this run, and a surviving one holds the port for the next run.
  shell(`run-as ${PKG} sh -c 'pkill -f "ombmoc[k].cjs" || true'`);
  shell(`run-as ${PKG} sh -c 'rm -f files/ombmock.cjs files/ombmock.log'`);
  try { adb(`forward --remove tcp:${MOCK_PORT_HOST}`); } catch { /* already gone */ }
}
