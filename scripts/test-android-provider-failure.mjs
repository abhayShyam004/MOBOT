#!/usr/bin/env node
// Provider-failure card on the phone — the device half of the
// `upstream HTTP 429: {"error":…}` defect.
//
//   scripts/test-android-provider-failure.mjs <apk> [--abi arm64-v8a] [--no-install] [--no-ui]
//
// One bot, one provider that refuses EVERY attempt with a 429 carrying the JSON
// body a real gateway sends (the mock's `cue-rate-limit`), and the card the
// phone's own embedded host puts in the transcript after the retry policy is
// exhausted. Everything runs on the PHONE: the app's embedded node host, its
// real openai-compat driver and retry loop, its real classification — only the
// paid provider is a fixture.
//
// Evidence the run has to produce, or it exits non-zero:
//   1. the provider really was asked three times (the mock's own log lines);
//   2. the transcript carries a rate_limit card naming the engine, the model
//      and the 429, and NO fragment of the gateway's payload anywhere;
//   3. the host's log holds the raw report (diagnostics kept, not shown);
//   4. the phone's UI draws the card, with its title, advice and actions, and
//      no payload on screen — dumped from the accessibility tree, and captured
//      as a screenshot next to this repo's verification notes.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  api, adb, shell, check, step, finish, requireApk, requireDeviceAbi, launchAndAwaitHost,
  ensureDeviceMock, pointAtMock, restoreProvider, deviceCleanup, setHostPid, selectDevice, PKG,
} from "./lib/driver-common.mjs";

const args = process.argv.slice(2);
const APK = args.find((a, i) => i === 0 || !a.startsWith("--"));
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
// adb/shell honor ANDROID_SERIAL, which selectDevice pins from --serial: this
// repo's device drivers run with two phones attached during the ABI phases.
selectDevice(flagValue("--serial"));
const run = (cmd, opts = {}) => adb(cmd, opts);
const runAs = (cmd, opts = {}) => shell(`run-as ${PKG} sh -c '${cmd}'`, opts);
const install = !args.includes("--no-install");
const wantUi = !args.includes("--no-ui");

/** The payload a gateway answers a 429 with. Not one byte of this may reach a
 *  transcript or a screen — that is the whole point of the check. */
const PAYLOAD_FRAGMENTS = ["Provider returned error", "rate_limit_exceeded", '{"error"'];

const messages = async (threadId) =>
  (await api("GET", `/api/threads/${threadId}/messages?limit=30`, undefined, { timeoutMs: 8_000 })).json?.messages ?? [];

const waitFor = async (predicate, seconds, everyMs = 1_000) => {
  for (let i = 0; i < seconds; i += 1) {
    try { if (await predicate()) return true; } catch { /* transient adb/api blip */ }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
};

requireApk(APK);
const deviceAbi = requireDeviceAbi(flagValue("--abi"));

step("1. install + launch + host health");
// One phone, two OpenMausBot builds installed: the debug APK under test and a
// preview build both host the same loopback port, so a preview left running
// answers the forward while this package sits idle — every check below would
// then be about the wrong binary. Stop the sibling first.
const SIBLING = `${PKG}.preview`;
if (shell(`pm list packages ${SIBLING}`).includes(SIBLING)) run(`shell am force-stop ${SIBLING}`);
const health = await launchAndAwaitHost({ install, APK });
check("host healthy on device", Boolean(health?.pid), `pid=${health?.pid ?? "?"}`);
setHostPid(health?.pid);
const hostCount = runAs("grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null | wc -l").trim();
check("exactly one host process", hostCount === "1", `count=${hostCount}`);
// The health pid must be THIS package's host, not a sibling build's.
const pidCmdline = (() => { try { return runAs(`cat /proc/${health?.pid}/cmdline`, { timeout: 20_000 }); } catch { return ""; } })();
check("the answering host is this package's", pidCmdline.includes("host-server/index-android"), `pid=${health?.pid ?? "?"}`);

step("2. deterministic provider on the phone");
check("mock provider running on device", await ensureDeviceMock(), "port 28798");
const pointed = await pointAtMock();
check("mock catalog reached the instance", pointed.mockCatalogOk === true, `catalog: ${pointed.catalog}`);

let bot;
let threadId;
let card = null;
try {
  step("3. a bot on the mock, and a turn the provider refuses");
  bot = (await api("POST", "/api/bots", { name: `429 Bot ${Date.now()}` })).json?.bot;
  check("bot created on the device host", Boolean(bot?.id), `id=${bot?.id ?? "?"}`);
  threadId = bot?.threadId;
  const pinned = await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "openaiCompat", model: "mock-1" } });
  check("bot pinned to the mock's model", pinned.status === 200, `http ${pinned.status}`);

  // Attempts are counted by the mock itself, so the count below is the
  // provider's, not the card's own claim.
  const before = (runAs("cat files/ombmock.log 2>/dev/null || true").match(/rate-limited completion attempt/g) ?? []).length;
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { threadId, text: "Summarize the logs. cue-rate-limit" });
  check("message accepted by the host", [200, 201, 202].includes(sent.status), `http ${sent.status}`);

  const landed = await waitFor(async () => {
    card = (await messages(threadId)).find((m) => m.failure?.kind === "rate_limit") ?? null;
    return Boolean(card);
  }, 45);
  check("the turn settled as a rate-limit failure card", landed);

  const after = (runAs("cat files/ombmock.log 2>/dev/null || true").match(/rate-limited completion attempt/g) ?? []).length;
  check("the provider was asked exactly three times (exhausted retry)", after - before === 3, `attempts=${after - before}`);

  const failure = card?.failure ?? {};
  check("the card is a 429 rate limit", failure.kind === "rate_limit" && failure.status === 429, JSON.stringify({ kind: failure.kind, status: failure.status }));
  check("the card names the engine and the model", Boolean(failure.provider) && failure.model === "mock-1", `${failure.provider ?? "?"} · ${failure.model ?? "?"}`);
  check("the card says what to do", typeof failure.advice === "string" && failure.advice.length > 0, String(failure.advice ?? "").slice(0, 80));
  check("the chip is the card's own headline", card?.tool?.name === "error: Rate limit reached", String(card?.tool?.name ?? "?"));

  const transcript = JSON.stringify(await messages(threadId));
  for (const fragment of PAYLOAD_FRAGMENTS) {
    check(`the transcript never carries ${fragment}`, !transcript.includes(fragment));
  }
  const cards = (await messages(threadId)).filter((m) => m.failure).length;
  check("one card for the failed turn, not one per attempt", cards === 1, `cards=${cards}`);

  step("4. diagnostics");
  // The host's console is drained into the app's in-memory output ring, and
  // reaches logcat only if the host dies (HarnessHost.handleExit) — so a device
  // run cannot read the `[turn.failure] rate_limit 429 …` line back while the
  // host is healthy. That half is held by the server suites instead
  // (server/runtime-failure.test.ts, and the harness's own stderr in
  // server/index.test.ts, where the raw report is observed reaching the log and
  // nowhere else). What this run holds is the other, user-visible direction:
  // the payload is in no transcript field and on no screen, asserted above.
  console.log("NOTE  the harness log line is verified by the server suites, not readable over adb");

  if (wantUi) {
    step("5. the phone draws the card");
    // A notification tap is the app's own way into one thread: the same extras
    // LocalNotificationPoster puts on its content Intent.
    run(`shell am start -n ${PKG}/.MainActivity --es openmaus.botId ${bot.id} --es openmaus.threadId ${threadId} --es openmaus.kind message`, { timeout: 30_000 });
    const shown = async () => {
      try {
        run("shell uiautomator dump /sdcard/omb-failure.xml", { timeout: 30_000 });
        return run("shell cat /sdcard/omb-failure.xml", { timeout: 30_000 });
      } catch { return ""; }
    };
    let dump = "";
    const visible = await waitFor(async () => {
      dump = await shown();
      return dump.includes(failure.title ?? "\u0000");
    }, 30, 2_000);
    check("the card's headline is on screen", visible);
    for (const text of [failure.detail, failure.advice, "What to do", "Retry", "Change model"]) {
      check(`on screen: ${String(text).split("\n")[0].slice(0, 54)}`, Boolean(text) && dump.includes(text));
    }
    // The screen shows the harness's words, never the provider's payload.
    for (const fragment of PAYLOAD_FRAGMENTS) {
      check(`nothing on screen shows ${fragment}`, !dump.includes(fragment));
    }
    try {
      // Binary, so it cannot ride adb()'s utf8 pipe.
      const png = execFileSync("adb", ["exec-out", "screencap", "-p"], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
      mkdirSync("docs/verification", { recursive: true });
      writeFileSync("docs/verification/provider-failure-card.png", png);
      check("screenshot captured", png.length > 10_000, `docs/verification/provider-failure-card.png (${png.length} bytes)`);
    } catch (error) {
      check("screenshot captured", false, String(error).slice(0, 120));
    }
  } else {
    console.log("\n(skipping the UI leg: --no-ui)");
  }
} finally {
  step("cleanup");
  await restoreProvider(pointed.snapshot).catch(() => {});
  if (bot?.id) await api("DELETE", `/api/bots/${bot.id}`, undefined, { timeoutMs: 20_000 }).catch(() => {});
  deviceCleanup(["ombmoc[k].cjs"]);
}
finish("PROVIDER-FAILURE", deviceAbi);
