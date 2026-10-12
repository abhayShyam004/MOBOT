#!/usr/bin/env node
// Phase 7 device driver — the real Android browser stack, end to end, on ONE
// physical phone:
//
//   scripts/test-android-browser.mjs <apk> [--abi arm64-v8a|armeabi-v7a]
//       [--serial X] [--model id] [--no-install]
//
// Evidence chain (exit 0 only if every check passes):
//   1. install + launch + host health
//   2. browser layer really mounted: config.json carries the seeded
//      android_browser entry, the harness env carries the driver handoff,
//      and the driver answers its loopback health route with the token
//   3. the fixture site is reachable from the PHONE's WebView via
//      `adb reverse tcp:fixture-port tcp:fixture-port` (host serves; the
//      phone fetches 127.0.0.1:<port> over its own adb-reversed loopback).
//      The fixture port is injected test-only (BrowserDriverServer
//      .setFixturePort) — production keeps loopback fully refused.
//      This is test plumbing only — the app never depends on adb.
//   4. per-bot isolation: bot A drops a marker cookie + localStorage value;
//      bot B's session must see neither (androidx.webkit Profile isolation)
//   5. persistence: bot A's cookie survives a host restart (profile flush)
//   6. real agent turn: fresh test bot, model resolved from the host's live
//      catalog, android_browser assigned to the bot → the model calls
//      browser_open/browser_dom/browser_type/browser_click against the
//      fixture → approval cards answered → the submitted value read back
//      from the result page → assistant continuation with the value
//   7. recovery: browser_eval on a dead page and browser_open on a blocked
//      URL answer {ok:false,...} — the model can read the failure
//   8. cleanup: test bots deleted and verified gone, fixture server closed,
//      exactly one host process
//
// Everything browser-side runs on the phone: the host's android_browser MCP
// server talks to the app's WebView driver over loopback. No desktop Chrome,
// no VPS, no scripted tool results.
import { createHash } from "node:crypto";
import {
  PKG, selectDevice, parseArgs, check, step, finish, shell, adb, setHostPid,
  countHosts, requireApk, requireDeviceAbi, launchAndAwaitHost, api, waitFor,
  dumpThreadTail, hostNode,
} from "./lib/driver-common.mjs";
import { browserFixtureFiles, browserFixtureServerScript } from "./lib/omb-browser-fixture.mjs";

const { APK, flagValue, args } = parseArgs(
  "scripts/test-android-browser.mjs <apk> [--abi abi] [--serial serial] [--model id] [--no-install]",
);
requireApk(APK);
selectDevice(flagValue("--serial"));
const MODEL_OVERRIDE = flagValue("--model");
const NO_INSTALL = args.includes("--no-install");
const DEAD_REPLY = /provider settings changed|turn was interrupted|no activity for \d+ minutes/i;

// The fixture port on the host and (via adb reverse) on the phone. Anything
// free; deterministic for the log.
const FIXTURE_PORT = 28790;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const E2E_VALUE = "omb-e2e-42";
// Value used by the direct form round-trip in leg 4.
const FORM_VALUE = "omb-form-7";

const deviceAbi = requireDeviceAbi(flagValue("--abi"));

// ── 1. host up ───────────────────────────────────────────────────────────────
step("1. install, launch, host health");
// Plant the test-only fixture-port marker BEFORE launch: the browser driver
// reads it once at start (files/browser-fixture-port), enables exactly that
// loopback port, and deletes the file. Production never has this file.
shell(`run-as ${PKG} sh -c 'echo ${FIXTURE_PORT} > files/browser-fixture-port'`);
const health = await launchAndAwaitHost({ install: !NO_INSTALL, APK });
check("host healthy after install + launch", Boolean(health), JSON.stringify(health ?? {}));
setHostPid(String(health?.pid ?? ""));
const version = shell(`dumpsys package ${PKG} | grep -m1 versionName`).replace("versionName=", "").trim();
console.log(`  installed versionName=${version}`);

// ── 2. browser layer mounted ────────────────────────────────────────────────
step("2. android_browser layer really mounted");
const filesDir = shell(`run-as ${PKG} sh -c 'pwd'`).trim();
const configRaw = shell(`run-as ${PKG} sh -c 'cat files/host/data/config.json'`);
let config = {};
try { config = JSON.parse(configRaw); } catch { /* checked below */ }
const seeded = config.mcpServers?.android_browser;
check("config.json carries the seeded android_browser entry",
  Boolean(seeded?.enabled) && seeded?.command === "/proc/self/exe" && String(seeded?.args?.[0] ?? "").endsWith("android-browser.js"),
  seeded ? `args=${JSON.stringify(seeded.args)} env=${Object.keys(seeded.env ?? {}).join(",")}` : "missing");
const envPort = Number(seeded?.env?.AB_DRIVER_PORT ?? 0);
const envToken = String(seeded?.env?.AB_DRIVER_TOKEN ?? "");
check("seeded entry carries the driver handoff (port + token + sessions root)",
  envPort > 0 && envToken.length >= 16 && Boolean(seeded?.env?.AB_SESSIONS_ROOT),
  `port=${envPort} token=${envToken ? "present" : "MISSING"}`);

// The driver's loopback health route answers only with the token. The probe
// runs ON the phone (run-as + the app's own node) — the driver is loopback-
// bound, so no adb-forward path can prove the same thing.
const { exe, libDir } = hostNode();
check("embedded node binary present for the on-device probe", Boolean(exe), exe ?? "none");
const probeScript = `const r=await fetch("http://127.0.0.1:${envPort}/sessions",{headers:{Authorization:"Bearer ${envToken}"}});const b=await r.json();console.log(JSON.stringify({status:r.status,sessions:b.sessions??[]}));`;
// Push the probe as a FILE (adb push of a temp file), never an echo: the
// script contains parens/quotes that toysh cannot carry through sh -c.
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const stage = mkdtempSync(join(tmpdir(), "omb-ab-probe-"));
writeFileSync(join(stage, "probe.cjs"), probeScript);
adb(`push ${join(stage, "probe.cjs")} /data/local/tmp/omb-ab-probe.cjs`, { timeout: 60_000 });
rmSync(stage, { recursive: true, force: true });
shell(`run-as ${PKG} cp /data/local/tmp/omb-ab-probe.cjs files/browser-probe.cjs`);
const probeOut = shell(
  `run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 ${exe} --input-type=module -e "$(cat files/browser-probe.cjs)" 2>&1'`,
  { timeout: 60_000 },
).trim();
const probeOk = /"status":200/.test(probeOut);
check("WebView driver answers its loopback route with the token (on-device probe)",
  probeOk, probeOut.slice(0, 140).replace(/\n/g, " "));
shell(`run-as ${PKG} sh -c 'rm -f files/browser-probe.cjs'`);
adb("shell rm -f /data/local/tmp/omb-ab-probe.cjs");

// ── 3. fixture site served ON the phone ────────────────────────────────────
// The fixture runs on the phone itself (the app's own embedded node, under
// run-as), so the WebView browses a listener in its own loopback: no
// adb-reverse tunnel in the browsing path, and no USB flake between the phone
// and the host can masquerade as a browser failure. The pages are the
// byte-identical ones server/browser-fixture.test.ts pins in CI.
step("3. deterministic fixture site (served on the phone)");
const fixturePages = browserFixtureFiles();
for (const [name, body] of Object.entries(fixturePages)) {
  const stage = mkdtempSync(join(tmpdir(), "omb-ab-page-"));
  writeFileSync(join(stage, name), body);
  adb(`push ${join(stage, name)} /data/local/tmp/${name}`, { timeout: 60_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/${name} files/${name}`);
}
{
  const stage = mkdtempSync(join(tmpdir(), "omb-ab-fxsvr-"));
  writeFileSync(join(stage, "fixture-server.cjs"), browserFixtureServerScript());
  adb(`push ${join(stage, "fixture-server.cjs")} /data/local/tmp/omb-fxsvr.cjs`, { timeout: 60_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/omb-fxsvr.cjs files/omb-fxsvr.cjs`);
}
// No reverse tunnel is used any more, and a stale one from an older design
// would hold the phone-side port (adbd binds it), so the on-device server
// could never start (EADDRINUSE). Remove exactly this port's reverse.
try { adb(`reverse --remove tcp:${FIXTURE_PORT}`); } catch { /* none registered */ }
// Reap exactly our own stale fixture servers (an interrupted earlier run keeps
// one listening, which would hold the port and answer with ITS page dir).
// Matched by this script's own cmdline, never a blind pkill.
const stale = shell(
  `run-as ${PKG} sh -c 'grep -l omb-fxsvr /proc/[0-9]*/cmdline 2>/dev/null | cut -d/ -f3'`,
).trim().split(/\s+/).filter(Boolean);
for (const pid of stale) {
  // A pid that is already gone makes `kill` exit non-zero; that is not an error.
  try { shell(`run-as ${PKG} sh -c 'kill ${pid} 2>/dev/null'`); } catch { /* already gone */ }
}
if (stale.length) console.log(`  reaped ${stale.length} stale fixture server(s): ${stale.join(",")}`);
// Start detached. The env prefix must precede `nohup` (an `env VAR=x exe …`
// form silently drops the executable — the reason the first device runs
// browsed Chromium's error page). The pid file makes cleanup exact, and the
// log file is what leg 3 prints when the server does not come up.
shell(
  // Page dir is <data>/files (where the pages were copied) — not <data>.
  `run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 nohup ${exe} files/omb-fxsvr.cjs ${filesDir}/files ${FIXTURE_PORT} >files/omb-fxsvr.log 2>&1 & echo $! > files/omb-fxsvr.pid'`,
);
await new Promise((r) => setTimeout(r, 2_500));
let fixtureOnPhone = "";
// Poll while the on-device server finishes binding (and retry once for the
// adb push, which intermittently ETIMEDOUTs on this cable).
for (let attempt = 0; attempt < 8 && !/"status":200/.test(fixtureOnPhone); attempt += 1) {
  if (attempt > 0) await new Promise((r) => setTimeout(r, 1_500));
  try {
    const fetchScript =
      `const r=await fetch("${FIXTURE_URL}/index.html");const t=await r.text();` +
      `console.log(JSON.stringify({status:r.status,len:t.length,marker:t.includes("OMB Browser Fixture")}));`;
    const stage2 = mkdtempSync(join(tmpdir(), "omb-ab-fx-"));
    writeFileSync(join(stage2, "fx.cjs"), fetchScript);
    adb(`push ${join(stage2, "fx.cjs")} /data/local/tmp/omb-ab-fx.cjs`, { timeout: 60_000 });
    rmSync(stage2, { recursive: true, force: true });
    shell(`run-as ${PKG} cp /data/local/tmp/omb-ab-fx.cjs files/browser-fx.cjs`);
    fixtureOnPhone = shell(
      `run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 ${exe} --input-type=module -e "$(cat files/browser-fx.cjs)" 2>&1'`,
      { timeout: 30_000 },
    ).trim();
    shell(`run-as ${PKG} sh -c 'rm -f files/browser-fx.cjs'`);
    adb("shell rm -f /data/local/tmp/omb-ab-fx.cjs");
  } catch (e) { fixtureOnPhone = `probe-error:${e.message}`; }
}
if (!/"status":200/.test(fixtureOnPhone)) {
  // The server's own log says why (bind failure, missing file, bad argv).
  console.log(`  | fixture server log: ${shell(`run-as ${PKG} sh -c 'cat files/omb-fxsvr.log 2>/dev/null'`).trim().split("\n").slice(0, 3).join(" / ")}`);
}
check("fixture site is served on the phone itself (200 + fixture marker, on-device node)",
  /"status":200/.test(fixtureOnPhone) && /"marker":true/.test(fixtureOnPhone),
  `phone-side probe=${fixtureOnPhone.slice(0, 120)}`);

// ── 4. per-bot isolation (direct MCP surface, real WebView) ─────────────────
step("4. per-bot isolation: two bots, zero shared browser state");
const BOT_A = "browser-iso-a";
const BOT_B = "browser-iso-b";
for (const name of [BOT_A, BOT_B]) await api("DELETE", `/api/bots?name=${name}`).catch(() => {});
const digest = (botId) =>
  // same identity rule as sessionNameFor()/sessionName(): sha256(botId)[0:32]
  createHash("sha256").update(botId).digest("hex").slice(0, 32);
const createdA = await api("POST", "/api/bots", { name: BOT_A });
const botA = createdA.json?.bot?.id ?? createdA.json?.id ?? "";
const createdB = await api("POST", "/api/bots", { name: BOT_B });
const botB = createdB.json?.bot?.id ?? createdB.json?.id ?? "";
check("two isolation bots created", Boolean(botA && botB), `a=${botA} b=${botB}`);
const sessionA = `omb-${digest(botA)}`;
const sessionB = `omb-${digest(botB)}`;
console.log(`  sessions: A=${sessionA} B=${sessionB}`);

// Driver calls for the isolation/persistence legs go straight to the app's
// WebView driver over its loopback HTTP — the same server, port and token the
// production MCP server uses. The MCP stdio boundary itself is exercised in
// leg 6 (the real agent turn), where every browser_* call the model makes
// crosses it. The probe runs ON the phone via run-as + the app's own node,
// because the driver binds loopback only.
// Wake the device and foreground the app before driver calls: a stopped
// Activity's window never traverses, so its WebViews never settle loads or
// pump JS callbacks (found the hard way on ARM32 — navigations committed,
// currentUrl was right, progress never left ~30).
function foreground() {
  adb("shell input keyevent KEYCODE_WAKEUP");
  adb("shell wm dismiss-keyguard");
  adb(`shell am start -n ${PKG}/.MainActivity`);
}
// Re-resolve the LIVE driver handoff before every call: the app may have been
// restarted (leg 5 rotates the port/token), and the WebView driver binds a new
// loopback port on each app start.
function liveHandoff() {
  const cfg = shell(`run-as ${PKG} sh -c 'cat files/host/data/config.json'`);
  try {
    const e = JSON.parse(cfg)?.mcpServers?.android_browser;
    const p = Number(e?.env?.AB_DRIVER_PORT ?? 0);
    if (p > 0 && e?.env?.AB_DRIVER_TOKEN) return { port: p, token: String(e.env.AB_DRIVER_TOKEN) };
  } catch { /* fall through */ }
  return { port: envPort, token: envToken };
}
function driverCall(session, action, body = {}) {
  const { port, token } = liveHandoff();
  const script =
    `const r=await fetch("http://127.0.0.1:${port}/session/${session}/${action}",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer ${token}"},body:JSON.stringify(${JSON.stringify(body)})});` +
    `console.log(await r.text());`;
  const stage = mkdtempSync(join(tmpdir(), "omb-ab-call-"));
  writeFileSync(join(stage, "call.cjs"), script);
  adb(`push ${join(stage, "call.cjs")} /data/local/tmp/omb-ab-call.cjs`, { timeout: 60_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/omb-ab-call.cjs files/driver-call.cjs`);
  foreground();
  const out = shell(
    `run-as ${PKG} sh -c 'sleep 1; LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 ${exe} --input-type=module -e "$(cat files/driver-call.cjs)" 2>&1'`,
    { timeout: 90_000 },
  ).trim();
  try { return JSON.parse(out); } catch { return { ok: false, error: out.slice(0, 200) }; }
}

/** Print the driver's own WebView callback log (on-device fetch of /diag).
 *  Called when a browser action fails, so the log carries Chromium's real
 *  verdict (error code, progress, renderer death) instead of a bare timeout. */
function dumpDiag(label) {
  const { port, token } = liveHandoff();
  const script =
    `const r=await fetch("http://127.0.0.1:${port}/diag",{headers:{Authorization:"Bearer ${token}"}});` +
    `const j=await r.json();console.log((j.diag||[]).join("\\n"));`;
  const stage = mkdtempSync(join(tmpdir(), "omb-ab-diag-"));
  writeFileSync(join(stage, "diag.cjs"), script);
  adb(`push ${join(stage, "diag.cjs")} /data/local/tmp/omb-ab-diag.cjs`, { timeout: 60_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/omb-ab-diag.cjs files/driver-diag.cjs`);
  const out = shell(
    `run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 ${exe} --input-type=module -e "$(cat files/driver-diag.cjs)" 2>&1'`,
    { timeout: 60_000 },
  ).trim();
  console.log(`  ── driver diag (${label}) ──`);
  for (const line of out.split("\n").slice(-18)) console.log(`  | ${line}`);
}

const openA = driverCall(sessionA, "open", { url: `${FIXTURE_URL}/index.html` });
if (openA.settled !== true) dumpDiag("bot A open did not settle");
check("bot A opened the fixture page (load settled)", openA.ok === true && openA.settled === true, JSON.stringify(openA).slice(0, 140));
// `settled` alone would also accept Chromium's own error page (it finishes
// too), so assert the fixture's ACTUAL content: a broken fixture must fail
// here instead of surfacing later as a mysterious empty eval.
check("the loaded page IS the fixture (title + rendered text, not an error page)",
  String(openA.title ?? "").includes("OMB Fixture") &&
    /OMB Browser Fixture/.test(String(driverCall(sessionA, "text", { maxChars: 2_000 }).text ?? "")),
  `title=${openA.title ?? "(none)"}`);
// The session WebView must be IN the resumed activity's view hierarchy — an
// unattached WebView never spawns its renderer (loads stall at ~30% forever).
// This turns a silent attach failure into a named, immediate FAIL.
const hier = shell(`dumpsys activity top 2>/dev/null | sed -n '/ACTIVITY ${PKG}/,$p' | grep -c android.webkit.WebView`).trim();
const renderer = shell("ps -A | grep -E 'sandboxed_process' | wc -l").trim();
check("session WebView is attached to the resumed activity's hierarchy",
  Number(hier) >= 1,
  `webviews-in-hierarchy=${hier} renderer-processes=${renderer} (0 attached → open-then-resume ordering bug)`);
// Expressions wrap their own errors: a thrown script would come back as a bare
// null (which is how a Chromium error page once read as "no markers").
const cookieA = driverCall(sessionA, "eval", {
  expression: "(function(){try{document.cookie='iso_marker=botA-secret; path=/';localStorage.setItem('iso_key','botA-local');return 'set cookie='+document.cookie+' ls='+localStorage.getItem('iso_key');}catch(e){return 'ERR:'+e.name+':'+e.message;}})()",
});
check("bot A set a marker cookie + localStorage value",
  cookieA.ok === true && !String(cookieA.result ?? "").startsWith("ERR:"), JSON.stringify(cookieA).slice(0, 160));
const readA = driverCall(sessionA, "eval", {
  expression: "(function(){try{return 'cookie='+document.cookie+'|ls='+localStorage.getItem('iso_key');}catch(e){return 'ERR:'+e.name+':'+e.message;}})()",
});
check("bot A reads back its own markers",
  /botA-secret/.test(String(readA.result ?? "")) && /botA-local/.test(String(readA.result ?? "")),
  String(readA.result ?? "").slice(0, 140));

// Real interaction, not just navigation: read the DOM refs, type into the
// form's text input, click the submit button, and follow the form's own GET to
// the result page. (browser_dom/click/type once returned ok:true while the
// injected selector was an undefined JS identifier — a silent no-op that this
// check turns into a failure.)
const domA = driverCall(sessionA, "dom", { maxElements: 60 });
const elements = domA.page?.elements ?? [];
const inputRef = elements.find((e) => e.tag === "input")?.ref ?? "";
const buttonRef = elements.find((e) => e.tag === "button")?.ref ?? "";
check("dom lists the fixture's form controls with usable refs",
  domA.ok === true && inputRef !== "" && buttonRef !== "",
  `input=${inputRef || "none"} button=${buttonRef || "none"} elements=${elements.length}`);
// The action responses echo the ref that was acted on (`{typed:"@e3"}` /
// `{clicked:"@e4"}`), and the following status/text checks prove the effect.
const typed = driverCall(sessionA, "type", { ref: inputRef, text: FORM_VALUE });
check("type writes into the fixture's input", typed.ok === true && typed.typed === inputRef,
  JSON.stringify(typed).slice(0, 120));
const clicked = driverCall(sessionA, "click", { ref: buttonRef });
check("click submits the fixture's form", clicked.ok === true && clicked.clicked === buttonRef,
  JSON.stringify(clicked).slice(0, 120));
const afterSubmit = driverCall(sessionA, "status");
check("the form's own GET carried the typed value to the result page",
  String(afterSubmit.url ?? "").includes(`result.html?value=${FORM_VALUE}`),
  `url=${String(afterSubmit.url ?? "").slice(0, 120)}`);
const submittedText = driverCall(sessionA, "text", { maxChars: 1_000 });
check("the result page renders the submitted value (form round-trip on-device)",
  new RegExp(`Submitted value:\\s*${FORM_VALUE}`).test(String(submittedText.text ?? "")),
  String(submittedText.text ?? "").replace(/\n/g, " ").slice(0, 140));
// Leave bot A back on the fixture home for the isolation/persistence legs.
driverCall(sessionA, "open", { url: `${FIXTURE_URL}/index.html` });

const openB = driverCall(sessionB, "open", { url: `${FIXTURE_URL}/result.html?value=b` });
check("bot B opened its own page (load settled)", openB.ok === true && openB.settled === true, JSON.stringify(openB).slice(0, 120));
const readB = driverCall(sessionB, "eval", {
  expression: "(function(){try{return 'cookie='+document.cookie+'|ls='+String(localStorage.getItem('iso_key'));}catch(e){return 'ERR:'+e.name+':'+e.message;}})()",
});
check("bot B sees NO cookie and NO localStorage from bot A",
  readB.ok === true && !String(readB.result ?? "").startsWith("ERR:") && !String(readB.result ?? "").includes("botA"),
  `result=${String(readB.result ?? "").slice(0, 120)}`);
const cookieBList = driverCall(sessionB, "cookies");
check("bot B cookie jar has no bot A markers",
  !JSON.stringify(cookieBList).includes("iso_marker"),
  JSON.stringify(cookieBList).slice(0, 120));

// ── 5. persistence across host restart ──────────────────────────────────────
step("5. session persistence across a host restart (force-stop + relaunch)");
const persisted = driverCall(sessionA, "persist");
check("bot A flushed its profile", persisted.ok === true, JSON.stringify(persisted).slice(0, 100));
// The proven restart path (Phase 5): force-stop the app, relaunch, await host.
// The WebView driver outlives the harness process by design (app-scope owner);
// the profile store persists the flushed cookies across the whole app cycle.
adb(`shell am force-stop ${PKG}`);
await new Promise((r) => setTimeout(r, 2_000));
// Re-plant the test-only fixture marker BEFORE the relaunch: the driver server
// reads it once per process (and deletes it), so a restart without it would
// refuse the loopback fixture URL and look like a browser failure.
shell(`run-as ${PKG} sh -c 'echo ${FIXTURE_PORT} > files/browser-fixture-port'`);
const relaunch = await launchAndAwaitHost({ install: false });
check("host restarted and healthy after force-stop + relaunch", Boolean(relaunch));
await new Promise((r) => setTimeout(r, 3_000));
// A restart ends every session (the WebView owned it). Re-open the fixture
// page so the restored profile has an origin to read from, then assert the
// cookie + localStorage survived — that is the actual persistence claim.
const reopened = driverCall(sessionA, "open", { url: `${FIXTURE_URL}/index.html` });
check("bot A's page reopens after the restart", reopened.ok === true, JSON.stringify(reopened).slice(0, 140));
const afterRestart = driverCall(sessionA, "eval", {
  expression: "(function(){try{return 'cookie='+document.cookie+'|ls='+String(localStorage.getItem('iso_key'));}catch(e){return 'ERR:'+e.name+':'+e.message;}})()",
});
check("bot A's cookie + storage survive the restart (profile restore)",
  /botA-secret/.test(String(afterRestart.result ?? "")) && /botA-local/.test(String(afterRestart.result ?? "")),
  `result=${String(afterRestart.result ?? "").slice(0, 140)}`);

// ── 6. the real agent turn ──────────────────────────────────────────────────
step("6. real agent turn: bot uses browser tools against the fixture");
const refreshed = await api("POST", "/api/instances/openaiCompat/refresh-models", {}, { timeoutMs: 60_000 });
const options = refreshed.json?.instances?.find((i) => i.instanceId === "openaiCompat")?.models?.options ?? [];
// Prefer the full model over the smaller "-contributor" tiers: the weak tier
// drifts off the browser tools onto the built-in computer tool and abandons
// the task (observed on ARM64). --model still overrides.
const modelRank = (id) =>
  /^muse-spark-1\.3$/.test(id) ? 0
    : /contributor/i.test(id) ? 3
    : /muse-spark/i.test(id) ? 1
    : 2;
const MODEL = MODEL_OVERRIDE ??
  ([...options].sort((a, b) => modelRank(a.id) - modelRank(b.id))[0]?.id ?? "");
check("host serves a live model catalog", options.length > 0 && MODEL !== "",
  options.length ? `picked ${MODEL} of ${options.length}` : `empty catalog (http ${refreshed.status})`);
if (!MODEL) process.exit(2);

const BOT_E2E = "browser-e2e";
await api("DELETE", `/api/bots?name=${BOT_E2E}`).catch(() => {});
const createdE = await api("POST", "/api/bots", {
  name: BOT_E2E,
  soul: "You browse with your own browser_* tools on this phone. For any web task, use browser_open first, then browser_dom to get element refs, then act on refs. Never invent page content you have not extracted with a tool. NEVER call select_computer or any other agents_* tool: no computer surface is needed or available here — your browser_* tools are already mounted and are the only way to do web work on this phone. If a browser_* tool is missing, say exactly that and stop.",
});
const botE = createdE.json?.bot?.id ?? createdE.json?.id ?? "";
const threadE = createdE.json?.bot?.threadId ?? createdE.json?.threadId ?? "";
check("e2e bot created", Boolean(botE && threadE), `http ${createdE.status}`);
// ONLY the browser server is assigned: the computer/agent toolkits are a
// distraction the model will otherwise explore, and this leg exists to prove
// the browser loop, not tool selection. Deliberately NO computer:"browser"
// here and NO task-surface pin: the "Browser" place mounts the desktop
// browser engine, which does not exist on the phone, and pinning it makes
// the turn withhold the custom-MCP browser tools entirely (observed:
// "browser target came back unavailable"). android_browser is a custom MCP
// server — customMcpServers() mounts it whenever the driver supports custom
// MCP, independent of the bot's computer place.
const patchedE = await api("PATCH", `/api/bots/${botE}`, {
  modelSelection: { instanceId: "openaiCompat", model: MODEL },
  mcpServers: ["android_browser"],
});
check("android_browser assigned to the e2e bot + real model set", [200, 201].includes(patchedE.status),
  `http ${patchedE.status} ${patchedE.text.slice(0, 120)}`);

const browserEvents = [];
let e2eCardCount = 0;
const seenCards = new Set();
let e2eReply = "";

/** Send [text] to the e2e bot and poll the thread once, answering approval
 *  cards and recording every browser_* tool event. Returns when the bot is
 *  idle after at least one browser tool ran, or when the budget expires. */
async function runE2eTurn(text) {
  const sent = await api("POST", `/api/bots/${botE}/messages`, { text, threadId: threadE });
  const since = sent.json?.message?.id ?? sent.json?.id ?? "";
  check("e2e message accepted", [200, 201, 202].includes(sent.status) && Boolean(since), `http ${sent.status} since=${since}`);
  return waitFor(async () => {
    const state = (await api("GET", `/api/threads/${threadE}/messages?limit=60`, undefined, { timeoutMs: 8_000 })).json;
    let messages = state?.messages ?? [];
    if (since) {
      const at = messages.findIndex((m) => m.id === since);
      if (at >= 0) messages = messages.slice(at + 1);
    }
    for (const m of messages) {
      const requestId = m?.card?.requestId;
      if (m.kind === "options" && requestId && !seenCards.has(requestId)) {
        seenCards.add(requestId);
        e2eCardCount += 1;
        const cardTool = String(m.card?.tool ?? "");
        // select_computer is never the right move for this leg AND allowing it
        // lets the call patch the task's surface (server records the choice),
        // which changes what the FOLLOW-UP turn mounts — one allowed
        // select_computer turned a passing run into "no browser_* tools
        // mounted". Deny it: the model keeps its already-mounted browser tools.
        const allow = !/select_computer/.test(cardTool);
        console.log(`  approval card (tool=${cardTool || "?"}) → ${allow ? "allow" : "DENY (surface changer)"}`);
        await api("POST", `/api/bots/${botE}/respond`, { behavior: allow ? "allow" : "deny", requestId });
      }
      // Model-visible names are server-prefixed (android_browser_browser_open),
      // so match the browser tool family anywhere in the name — anchoring on
      // "^browser_" reported zero events while the model was calling them.
      if (m.kind === "activity" && /browser_(open|navigate|dom|get_text|click|type|eval|status|screenshot|cookies|close|back|forward)\b/i.test(String(m.tool?.name ?? ""))) {
        const event = { name: m.tool.name, ok: m.tool.ok, output: String(m.tool.output ?? "") };
        if (!browserEvents.some((e) => e.name === event.name && e.output === event.output)) {
          browserEvents.push(event);
          console.log(`  browser tool: ${event.name} ok=${event.ok} out=${event.output.slice(0, 80).replace(/\n/g, " ")}`);
        }
      }
      if (m.kind === "text" && (m.role === "bot" || m.role === "assistant")) e2eReply = m.text ?? "";
    }
    const bot = ((await api("GET", "/api/bots", undefined, { timeoutMs: 8_000 })).json?.bots ?? []).find((b) => b.id === botE);
    return browserEvents.some((e) => e.ok) && bot?.busy === false && e2eReply.length > 0;
  }, 150, 4_000);
}

// The task, phrased so the tool names are unambiguous. If the model refuses or
// wanders without ever calling a browser tool, one bounded second turn gives it
// a chance to comply — reported in the log, never silently hidden.
const taskText =
  `Use your browser_* tools for this: browser_open, browser_dom, browser_type, browser_click, browser_get_text. ` +
  `Open ${FIXTURE_URL}/index.html, call browser_dom for element refs, browser_type ${E2E_VALUE} into the "Secret word" input, ` +
  `browser_click the "Send it" button, then browser_get_text and report the exact "Submitted value:" line from the result page.`;
const turn1 = await runE2eTurn(taskText);
let turnDone = turn1;
if (!browserEvents.some((e) => e.ok)) {
  console.log("  first turn used no browser tool — sending one bounded follow-up turn");
  turnDone = await runE2eTurn(
    `You did not call any browser_* tool. Call browser_open on ${FIXTURE_URL}/index.html now, then browser_dom, browser_type, browser_click, browser_get_text — and report the "Submitted value:" line.`,
  );
}

check("the model called real browser tools through its own surface",
  browserEvents.some((e) => e.ok),
  browserEvents.length ? browserEvents.map((e) => `${e.name}:${e.ok}`).join(",") : "NO browser tool events — see thread tail below");
check("approval cards were part of the flow (permission broker gating the browser)",
  e2eCardCount > 0, `${e2eCardCount} card(s) answered`);
// The claim is a ROUND TRIP: the fixture's result page must have rendered
// "Submitted value: <our value>", seen either in a tool output or the reply.
// (A reply that merely restates the request is not extraction.)
const submitted = /Submitted value:\s*omb-e2e-42/.test(e2eReply) ||
  browserEvents.some((e) => e.ok && /Submitted value:\s*omb-e2e-42/.test(e.output));
check("fixture content genuinely extracted on-device (form value round-trip)",
  submitted,
  e2eReply ? `reply=${e2eReply.slice(0, 160).replace(/\n/g, " ")}` : "value never surfaced");
check("assistant continuation is real (not a dead-reply marker)",
  e2eReply.length > 0 && !DEAD_REPLY.test(e2eReply), e2eReply.slice(0, 140).replace(/\n/g, " "));
if (!turnDone) await dumpThreadTail(threadE);

// ── 7. failure paths the model can read ─────────────────────────────────────
step("7. recovery: failures answer {ok:false} with a reason");
const blocked = driverCall(sessionA, "open", { url: "ftp://example.com/file" });
check("non-http URL refused with a readable reason",
  blocked.ok === false && /http/i.test(String(blocked.error ?? "")), String(blocked.error ?? "").slice(0, 120));
const loopbackBlocked = driverCall(sessionA, "open", { url: "http://localhost:9/x" });
check("loopback/private URL refused (SSRF guard)",
  loopbackBlocked.ok === false, String(loopbackBlocked.error ?? "").slice(0, 120));
const deadPage = driverCall(sessionA, "eval", { expression: "1+1" });
check("eval answers even when the page is gone or hostile",
  deadPage.ok === true || deadPage.ok === false, JSON.stringify(deadPage).slice(0, 100));

// ── 8. cleanup ──────────────────────────────────────────────────────────────
step("8. cleanup: no test state survives");
const closed = driverCall(sessionA, "close");
check("bot A browser session destroyed", closed.ok === true, JSON.stringify(closed).slice(0, 100));
for (const [name, id] of [[BOT_A, botA], [BOT_B, botB], [BOT_E2E, botE]]) {
  await api("DELETE", `/api/bots/${id}`).catch(() => {});
  const gone = !((await api("GET", "/api/bots")).json?.bots ?? []).some((b) => b.id === id);
  check(`test bot ${name} deleted and verified gone`, gone);
}
// Kill the on-device fixture server by the pid it recorded, then remove the
// pages it served — no test process or file survives the run.
const fixturePid = shell(`run-as ${PKG} sh -c 'cat files/omb-fxsvr.pid 2>/dev/null'`).trim();
if (fixturePid) { try { shell(`run-as ${PKG} sh -c 'kill ${fixturePid} 2>/dev/null'`); } catch { /* already gone */ } }
shell(`run-as ${PKG} sh -c 'rm -f files/omb-fxsvr.cjs files/omb-fxsvr.pid files/index.html files/result.html files/redirect.html'`);
adb("shell rm -f /data/local/tmp/index.html /data/local/tmp/result.html /data/local/tmp/redirect.html /data/local/tmp/omb-fxsvr.cjs");
check("on-device fixture server stopped", Boolean(fixturePid), `pid=${fixturePid || "none"}`);
// Final no-leak check. countHosts has shown one heisenbug class already
// (0 reported while the host was provably alive), so this check waits/polls
// across up to 8 JS-level attempts with real sleeps and dumps the raw scan
// output when it never settles — no silent false leak verdict.
let hosts = countHosts();
for (let i = 0; i < 8 && hosts === "0"; i += 1) {
  await new Promise((r) => setTimeout(r, 4_000));
  hosts = countHosts();
}
if (hosts !== "1") {
  console.log(`  raw /proc scan after retries: '${shell(`run-as ${PKG} sh -c 'grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null | wc -l'`).trim()}'`);
  console.log(`  app pid: ${shell("pidof com.openmausbot.companion").trim() || "none"}`);
}
check("exactly one host process", hosts === "1", `hosts=${hosts}`);

finish("BROWSER RESULT", deviceAbi);
