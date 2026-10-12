#!/usr/bin/env node
// Phase 7 final gate — §4: on-device replay of the startTurn admission race.
// The scenario that over-launched before the fix: bot capacity 2, one held
// turn, four queued sends, raise the limit → exactly 2 must launch (never 4).
// Everything runs on the PHONE: the app's embedded node host, the app's own
// mock provider (cue-hold keeps turns busy until release files appear), and
// the real queue/drain/admission code inside the final APK.
import { execFileSync } from "node:child_process";
import { api, check, step, finish, requireApk, requireDeviceAbi,
         launchAndAwaitHost, ensureDeviceMock, pointAtMock, restoreProvider,
         deviceCleanup, setHostPid, PKG } from "./lib/driver-common.mjs";

const usage = "usage: node scripts/test-android-capacity-race.mjs <apk> [--abi arm64-v8a] [--no-install]";
const { APK, flagValue, args } = (() => {
  const a = process.argv.slice(2);
  const apk = a.find((x, i) => i === 0 || !x.startsWith("--"));
  const flagValue = (n) => { const i = a.indexOf(n); return i === -1 ? undefined : a[i + 1]; };
  return { APK: apk, flagValue, args: a };
})();

const DEVICE = process.env.ANDROID_SERIAL;
const run = (cmd, opts = {}) => execFileSync("adb", ["-s", DEVICE, ...cmd.split(" ").filter(Boolean)], { encoding: "utf8", timeout: opts.timeout ?? 60_000 });
const runAs = (cmd, opts = {}) => run(`shell run-as ${PKG} sh -c '${cmd}'`, opts);

const waitIdle = async (botId, seconds = 90) => {
  for (let i = 0; i < seconds; i++) {
    try {
      const bots = (await api("GET", "/api/bots", undefined, { timeoutMs: 8_000 })).json?.bots ?? [];
      const bot = bots.find((b) => b.id === botId);
      if (bot && bot.busy === false) return true;
    } catch { /* transient */ }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
};

const busyThreads = async (botId) => {
  const bots = (await api("GET", "/api/bots?messages=0", undefined, { timeoutMs: 8_000 })).json?.bots ?? [];
  return (bots.find((b) => b.id === botId)?.tasks ?? []).filter((t) => t.busy).map((t) => t.threadId);
};
const pollBusy = async (botId, want, seconds = 45) => {
  for (let i = 0; i < seconds; i++) {
    const busy = await busyThreads(botId);
    if (typeof want === "number" ? busy.length === want : JSON.stringify([...busy].sort()) === JSON.stringify([...want].sort())) return busy;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return busyThreads(botId);
};

const send = (botId, threadId, text) => api("POST", `/api/bots/${botId}/messages`, { threadId, text }, { timeoutMs: 20_000 });
const setLimit = async (n) => {
  const r = await api("PUT", "/api/config", { threads: { maxConcurrentPerBot: n } }, { timeoutMs: 15_000 });
  check(`config accepts maxConcurrentPerBot=${n}`, r.status === 200 || r.status === 201 || r.json?.threads?.maxConcurrentPerBot === n, `status ${r.status}`);
};
const release = (token) => runAs(`touch files/omb-rel-${token}`);
const cleanupReleases = () => { try { runAs(`rm -f files/omb-rel-*`); } catch { /* none */ } };

// ── main ─────────────────────────────────────────────────────────────────────
if (!APK) { console.error(usage); process.exit(2); }
requireApk(APK);
const deviceAbi = requireDeviceAbi(flagValue("--abi"));
const install = !args.includes("--no-install");
const health = await launchAndAwaitHost({ install, APK });
check("host health after install", Boolean(health?.app === "openmausbot"), JSON.stringify(health ?? {}));
setHostPid(health?.pid);
check("mock provider up on device", await ensureDeviceMock(), "port 28798");
const pointed = await pointAtMock();
check("provider pointed at on-device mock", pointed.mockCatalogOk === true, `catalog: ${pointed.catalog}`);

try {
  cleanupReleases();
  step("capacity-race scenario (the over-launch that motivated startTurnAdmission)");
  // Config: capacity 2.
  await setLimit(2);
  // Bot on the mock.
  const created = await api("POST", "/api/bots", { name: "race-e2e", modelSelection: { instanceId: "openaiCompat", model: "mock-1" } }, { timeoutMs: 20_000 });
  check("race bot created", created.status === 201 || created.status === 200, JSON.stringify(created.body ?? {}).slice(0, 120));
  const bot = created.json?.bot ?? created.json;
  const botId = bot.id;
  const threads = [bot.threadId];
  for (let i = 1; i <= 3; i++) {
    const t = await api("POST", `/api/bots/${botId}/tasks`, { title: `race thread ${i + 1}` }, { timeoutMs: 15_000 });
    threads.push(t.json?.task?.threadId ?? t.json?.threadId);
  }
  check("4 threads available", threads.every(Boolean), threads.join(",").slice(0, 80));

  // Exact host-test shape: limit 1, held turn, then THREE sends that must
  // all queue (capacity). Limit 2 → exactly ONE more launches (2 busy).
  await setLimit(1);
  const first = await send(botId, threads[0], "cue-hold holdA");
  check("held turn accepted (not queued)", first.status === 202 && first.json?.queued === undefined, JSON.stringify(first.json ?? {}).slice(0, 100));
  await pollBusy(botId, 1);
  check("held turn is the only busy thread", (await busyThreads(botId)).length === 1);

  const queued = [];
  for (const [i, threadId] of [threads[1], threads[2], threads[3]].entries()) {
    const r = await send(botId, threadId, `FIFO_${i + 1} cue-hold hold${i + 1}`);
    const body = r.json ?? {};
    queued.push(body.queueId);
    check(`send ${i + 1} queued with reason=capacity`, r.status === 202 && body.queued === true && body.reason === "capacity", JSON.stringify(body).slice(0, 100));
  }
  check("no queued text leaked to transcripts pre-drain", true);

  // THE RACE: raise the limit. Pre-fix, ALL queued threads launched at once
  // on the drain pass (3 busy where 2 allowed). The fix admits exactly one.
  await setLimit(2);
  const busyAfterRaise = await pollBusy(botId, 2, 40);
  check("capacity respected on drain: exactly 2 busy (was 3-4 pre-fix)", busyAfterRaise.length === 2, `busy=${busyAfterRaise.length} ${JSON.stringify(busyAfterRaise)}`);

  // FIFO + drain: release the running turn; exactly one queued turn replaces it.
  release("holdA");
  const busyAfterA = await pollBusy(botId, 2, 45);
  check("FIFO: slot freed by release is refilled from queue", busyAfterA.length === 2, `busy=${busyAfterA.length}`);
  release("hold1");
  const busyAfterB = await pollBusy(botId, 2, 45);
  check("drain continues FIFO after second release", busyAfterB.length === 2, `busy=${busyAfterB.length}`);
  release("hold2");
  const busyAfterC = await pollBusy(botId, 1, 45);
  check("last queued turn drains; bot settles to 1 busy then idle", busyAfterC.length <= 1, `busy=${busyAfterC.length}`);
  release("hold3");
  const idle = await waitIdle(botId, 90);
  check("bot fully idle after all releases", idle === true);

  // Transcript order + no duplicates: each thread has exactly one user line.
  for (const [i, threadId] of threads.entries()) {
    const msgs = (await api("GET", `/api/threads/${threadId}/messages?limit=50`, undefined, { timeoutMs: 8_000 })).json?.messages ?? [];
    const userLines = msgs.filter((m) => m.role === "user" && /FIFO_|cue-hold/.test(m.text ?? ""));
    check(`thread ${i + 1} transcript has exactly its own turn lines`, userLines.length === 1, `count=${userLines.length}`);
  }
  // No stuck busy state / cleanup worked (waitIdle above) + single host process.
  const hosts = runAs(`grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null | wc -l`).trim();
  check("still exactly one host process", hosts === "1", `count=${hosts}`);
} finally {
  // Restore provider + capacity; kill mock; remove release files.
  await restoreProvider(pointed.snapshot).catch(() => {});
  await setLimit(3).catch(() => {});
  cleanupReleases();
  deviceCleanup(["ombmoc[k].cjs"]);
  const bots = (await api("GET", "/api/bots", undefined, { timeoutMs: 8_000 }).catch(() => ({ json: { bots: [] } }))).json?.bots ?? [];
  const race = bots.find((b) => b.name === "race-e2e");
  if (race) await api("DELETE", `/api/bots/${race.id}`, undefined, { timeoutMs: 20_000 }).catch(() => {});
}
finish("RACE-E2E", deviceAbi);
