#!/usr/bin/env node
// Watchdog for Phase 7 device runs: waits (up to --timeout minutes) for a
// phone with the given ABI to enumerate, wakes it, unlocks what it can, and
// launches scripts/test-android-browser.mjs detached. Exit 0 once the driver
// is running; exit 1 on timeout.
//   node scripts/await-phone.mjs <abi> <serial|auto> <logfile> [--timeout 45]
// With --chain-resources, after the browser driver EXITS the resources
// driver runs to <logfile-prefix>-res.log (same APK, sequential — two
// drivers must never install/spawn concurrently).
import { execFileSync, spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";

const argv = process.argv.slice(2);
const abi = argv[0];
const serialArg = argv[1] ?? "auto";
const logFile = argv[2];
const timeoutIdx = argv.indexOf("--timeout");
const timeoutMin = timeoutIdx >= 0 ? Number(argv[timeoutIdx + 1]) : 45;
const CHAIN_RESOURCES = argv.includes("--chain-resources");
if (!abi || !logFile) {
  console.error("usage: await-phone.mjs <abi> <serial|auto> <logfile> [--timeout 45]");
  process.exit(2);
}

const sh = (cmd, opts = {}) =>
  execFileSync("bash", ["-c", cmd], { encoding: "utf8", timeout: 60_000, ...opts }).trim();

const deadline = Date.now() + timeoutMin * 60_000;
console.log(`[${new Date().toISOString()}] watching for ${abi} phone (serial ${serialArg}) every 20s, deadline ${new Date(deadline).toISOString()}${CHAIN_RESOURCES ? ", chain-resources armed" : ""}`);
let polls = 0;
while (Date.now() < deadline) {
  if (++polls % 15 === 0) console.log(`[${new Date().toISOString()}] still watching (poll ${polls})`);
  let out = "";
  try { out = sh("adb devices 2>/dev/null", { timeout: 30_000 }); } catch { await new Promise((r) => setTimeout(r, 10_000)); continue; }
  const serials = out.split("\n").slice(1).map((l) => l.trim()).filter((l) => l.endsWith("\tdevice") || l.endsWith(" device")).map((l) => l.split("\t")[0]);
  for (const s of serials) {
    if (serialArg !== "auto" && s !== serialArg) continue;
    let devAbi = "";
    try { devAbi = sh(`adb -s ${s} shell getprop ro.product.cpu.abi`, { timeout: 30_000 }); } catch { continue; }
    if (devAbi !== abi) continue;
    console.log(`[${new Date().toISOString()}] ${abi} phone ${s} attached — waking and launching driver`);
    try {
      sh(`adb -s ${s} shell input keyevent KEYCODE_WAKEUP; adb -s ${s} shell svc power stayon true; adb -s ${s} shell settings put global stay_on_while_plugged_in 7`);
      sh(`adb -s ${s} shell wm dismiss-keyguard || true`);
    } catch { /* best effort */ }
    // The driver logs to stdout/stderr; the log file is the run's evidence,
    // so hand the child real fds pointing at it ("the driver writes the log
    // itself" was never true — stdio:ignore here used to swallow it).
    const apk = "android/app/build/outputs/apk/debug/" +
      (abi === "arm64-v8a" ? "app-arm64-v8a-debug.apk" : "app-armeabi-v7a-debug.apk");
    const browserCmd = `node scripts/test-android-browser.mjs ${apk} --abi ${abi} --serial ${s} > ${logFile} 2>&1`;
    const resourcesCmd = CHAIN_RESOURCES
      ? `node scripts/test-android-resources.mjs ${apk} --abi ${abi} --serial ${s} > ${logFile.replace(/\.log$/, "")}-res.log 2>&1`
      : null;
    // One detached sh runs the battery sequentially; this watcher exits.
    const script = resourcesCmd ? `${browserCmd}; ${resourcesCmd}` : browserCmd;
    const logFd = openSync(logFile, "a");
    const proc = spawn("bash", ["-c", script],
      { cwd: process.cwd(), detached: true, stdio: ["ignore", logFd, logFd], env: process.env });
    proc.unref();
    closeSync(logFd); // child holds its own dup of the fd
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20_000));
}
console.error(`timeout: no ${abi} phone attached within ${timeoutMin} minutes`);
process.exit(1);
