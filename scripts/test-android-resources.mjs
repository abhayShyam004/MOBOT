#!/usr/bin/env node
// Phase: internet resource tools — device driver (ARM64 first, per plan).
//
// Proves, on a physical phone, that the resource_* tools in android_computer
// genuinely acquire internet resources on the device:
//
//   1-2. install + health + seeded android_computer entry (Phase-7 contract)
//   3.   on-device deterministic probe — a probe script runs ON THE PHONE
//        (run-as + the app's own node), spawns the BUNDLED android-computer
//        adapter exactly as the harness does, and drives inspect/fetch/
//        download/extract against a fixture served on-device. ~20 checks.
//   4.   model-driven leg: a real model downloads a real public PDF through
//        the approval flow and extracts its text; the artifact is verified
//        on the device's filesystem. (Discovery by the model is covered by
//        the probe's link extraction; the URL is supplied here so the leg
//        stays deterministic against live-web layout churn.)
//   5.   cleanup + no-leak host count.
//
// Usage:
//   node scripts/test-android-resources.mjs <apk> --abi arm64-v8a --serial R8YY90VT4EM [--no-install] [--model <id>] [--no-model]
import {
  PKG, check, step, finish, parseArgs, selectDevice, requireApk,
  requireDeviceAbi, launchAndAwaitHost, api, adb, shell, countHosts,
  waitFor,
} from "./lib/driver-common.mjs";
import { join } from "node:path";

const { APK, flagValue, args } = parseArgs("test-android-resources.mjs <apk> [--abi arm64-v8a] [--serial X] [--no-install] [--model <id>] [--no-model]");
const ABI = flagValue("--abi");
const SERIAL = flagValue("--serial");
const NO_INSTALL = args.includes("--no-install");
const MODEL_OVERRIDE = flagValue("--model");
const NO_MODEL = args.includes("--no-model");
requireApk(APK);
selectDevice(SERIAL);

const PROBE_FILE = "omb-resprobe.cjs";
const TMP_PROBE = `/data/local/tmp/${PROBE_FILE}`;
const MARKER = "files/res-e2e-marker";
// A real, stable, public PDF for the model leg (W3C pronouncement).
const PUBLIC_PDF_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
const DEAD_REPLY = /i (?:cannot|can't|am unable)|as an ai language model/i;

// ── 1. install + health ─────────────────────────────────────────────────────
step("1. install + harness health");
const deviceAbi = requireDeviceAbi(ABI);
const health = await launchAndAwaitHost({ install: !NO_INSTALL, APK });
// The health contract is `{app:"openmausbot", pid, static}` (server/index.ts);
// this check once demanded a `version` field the API never returned, which
// read as a device failure on ARM64 when the server was demonstrably up.
check("harness healthy after launch", health?.app === "openmausbot" && typeof health?.pid === "number",
  JSON.stringify(health ?? {}).slice(0, 100));

// ── 2. android_computer seeded ──────────────────────────────────────────────
step("2. android_computer entry present in the harness config");
const configRaw = shell(`run-as ${PKG} sh -c 'cat files/host/data/config.json'`);
let mcpServers = {};
try { mcpServers = JSON.parse(configRaw).mcpServers ?? {}; } catch { /* mid-boot */ }
check("android_computer seeded in config.json", Boolean(mcpServers.android_computer?.enabled === true),
  JSON.stringify(mcpServers.android_computer ?? {}).slice(0, 120));
// The probe runs the EXACT adapter the harness spawns — its absolute path
// is right there in the seeded entry's args[0]. No guessing.
const ADAPTER_PATH = String(mcpServers.android_computer?.args?.[0] ?? "");

// ── 3. on-device deterministic probe ────────────────────────────────────────
step("3. on-device probe: bundled adapter drives the resource tools");
check("seeded adapter path resolvable", ADAPTER_PATH.startsWith('/'), ADAPTER_PATH || "missing args[0] in the seeded entry");
adb(`push ${join("scripts", "lib", "omb-resource-probe.cjs")} ${TMP_PROBE}`, { timeout: 120_000 });
shell(`run-as ${PKG} cp ${TMP_PROBE} files/${PROBE_FILE}`);
const { exe, libDir } = (() => {
  // The harness host PID gives us the embedded node's path (same trick as
  // the Phase-5/7 drivers).
  const pid = shell(`run-as ${PKG} sh -c 'grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null | cut -d/ -f3'`).trim();
  const exe = shell(`run-as ${PKG} sh -c 'readlink /proc/${pid}/exe'`).trim();
  return { exe, libDir: exe.replace(/\/[^/]+$/, "") };
})();
check("embedded node located for the probe", /^\/.+\//.test(exe), exe);
const filesDir = shell(`run-as ${PKG} sh -c 'pwd'`).trim();
const probeOut = shell(
  `run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/files/host/tmp LANG=C.UTF-8 ` +
  `${exe} files/${PROBE_FILE} ${ADAPTER_PATH} ${filesDir}/files/probe-ws 28791 2>&1'`,
  { timeout: 240_000 },
);
console.log(probeOut.split("\n").filter((l) => l.startsWith("probe:")).join("\n"));
const resultLine = probeOut.split("\n").find((l) => l.startsWith("RESULTJSON:"));
let probeResults = [];
try { probeResults = resultLine ? JSON.parse(resultLine.slice("RESULTJSON:".length)) : []; } catch { probeResults = []; }
check("probe ran to completion", probeResults.length > 0, probeResults.length ? "" : "no RESULTJSON line — see probe output above");
for (const r of probeResults) check(`probe: ${r.name}`, r.ok, r.detail);

// ── 4. model-driven leg ─────────────────────────────────────────────────────
step("4. model leg: a real model acquires a real public PDF through the approval flow");
if (NO_MODEL) {
  console.log("skipped (--no-model)");
} else {
  const refreshed = await api("POST", "/api/instances/openaiCompat/refresh-models", {}, { timeoutMs: 60_000 });
  const options = refreshed.json?.instances?.find((i) => i.instanceId === "openaiCompat")?.models?.options ?? [];
  const modelRank = (id) => /contributor|mini|small|lite|free|nano/i.test(id) ? 1 : 0;
  const MODEL = MODEL_OVERRIDE ?? [...options].sort((a, b) => modelRank(a.id) - modelRank(b.id))[0]?.id ?? "";
  check("live model catalog available", Boolean(MODEL), options.length ? `picked ${MODEL} of ${options.length}` : "empty catalog");
  if (MODEL) {
    const BOT = "resource-e2e";
    await api("DELETE", `/api/bots?name=${BOT}`).catch(() => {});
    const created = await api("POST", "/api/bots", {
      name: BOT,
      soul: "You acquire internet resources with your resource_* tools on this phone. Download files with resource_download, read PDFs with resource_extract_pdf_text. Never invent page or file contents you have not extracted with a tool. NEVER call select_computer or any other agents_* tool: your resource_* tools are already mounted.",
    });
    const botId = created.json?.bot?.id ?? created.json?.id ?? "";
    const threadId = created.json?.bot?.threadId ?? created.json?.threadId ?? "";
    check("model-leg bot created", Boolean(botId && threadId), `http ${created.status}`);
    if (botId && threadId) {
      const patched = await api("PATCH", `/api/bots/${botId}`, {
        modelSelection: { instanceId: "openaiCompat", model: MODEL },
        mcpServers: ["android_computer"],
      });
      check("android_computer assigned + real model set", [200, 201].includes(patched.status), `http ${patched.status}`);
      // mtime marker: anything under files/ newer than this that ends .pdf
      // is this run's artifact (the workspace lives under files/host/...).
      shell(`run-as ${PKG} sh -c 'rm -f ${MARKER}; touch ${MARKER}'`);

      const events = [];
      const seenCards = new Set();
      let cardCount = 0;
      let reply = "";
      const runTurn = async (text, budgetSeconds) => {
        const sent = await api("POST", `/api/bots/${botId}/messages`, { text, threadId });
        const since = sent.json?.message?.id ?? sent.json?.id ?? "";
        return waitFor(async () => {
          const state = (await api("GET", `/api/threads/${threadId}/messages?limit=60`, undefined, { timeoutMs: 8_000 })).json;
          let messages = state?.messages ?? [];
          if (since) {
            const at = messages.findIndex((m) => m.id === since);
            if (at >= 0) messages = messages.slice(at + 1);
          }
          for (const m of messages) {
            const requestId = m?.card?.requestId;
            if (m.kind === "options" && requestId && !seenCards.has(requestId)) {
              seenCards.add(requestId);
              cardCount += 1;
              const cardTool = String(m.card?.tool ?? "");
              // select_computer patches the task surface and withholds the
              // custom-MCP tools next turn (Phase-7 lesson) — deny it.
              const allow = !/select_computer/.test(cardTool);
              console.log(`  approval card (tool=${cardTool || "?"}) → ${allow ? "allow" : "DENY (surface changer)"}`);
              await api("POST", `/api/bots/${botId}/respond`, { behavior: allow ? "allow" : "deny", requestId });
            }
            if (m.kind === "activity" && /resource_(download|extract_pdf_text|fetch|inspect|list|extract_links)|workspace_/i.test(String(m.tool?.name ?? ""))) {
              const event = { name: m.tool.name, ok: m.tool.ok, output: String(m.tool.output ?? "") };
              if (!events.some((e) => e.name === event.name && e.output === event.output)) {
                events.push(event);
                console.log(`  tool: ${event.name} ok=${event.ok} out=${event.output.slice(0, 90).replace(/\n/g, " ")}`);
              }
            }
            if (m.kind === "text" && (m.role === "bot" || m.role === "assistant")) reply = m.text ?? "";
          }
          const bot = ((await api("GET", "/api/bots", undefined, { timeoutMs: 8_000 })).json?.bots ?? []).find((b) => b.id === botId);
          return events.some((e) => e.ok && /resource_download/i.test(e.name)) && bot?.busy === false && reply.length > 0;
        }, budgetSeconds, 4_000);
      };

      const task = `Use your resource_* tools: resource_download this PDF — ${PUBLIC_PDF_URL} — then resource_extract_pdf_text on the stored file, and tell me the path it was saved to.`;
      await runTurn(task, 480);
      if (!events.some((e) => e.ok && /resource_download/i.test(e.name))) {
        console.log("  first turn downloaded nothing — one bounded follow-up");
        await runTurn(`You did not call resource_download. Call resource_download on ${PUBLIC_PDF_URL}, then resource_extract_pdf_text on the stored path, and report the saved path.`, 480);
      }

      check("the model called resource_download through the approval flow",
        events.some((e) => e.ok && /resource_download/i.test(e.name)),
        events.length ? events.map((e) => `${e.name}:${e.ok}`).join(",") : "no resource tool events");
      check("approval cards gated the download (permission broker active)", cardCount > 0, `${cardCount} card(s)`);
      check("the model ran PDF extraction on-device",
        events.some((e) => e.ok && /resource_extract_pdf_text/i.test(e.name)),
        events.filter((e) => /extract_pdf_text/i.test(e.name)).map((e) => `ok=${e.ok}`).join(",") || "no extraction event");
      const artifactsOnDevice = shell(
        `run-as ${PKG} sh -c 'find files -type f -name "*.pdf" -newer ${MARKER} 2>/dev/null | head -3'`,
      ).trim();
      check("downloaded artifact genuinely exists on the device filesystem",
        artifactsOnDevice.length > 0, artifactsOnDevice.split("\n")[0] || "no new .pdf under the app files tree");
      check("assistant reply is real (path reported, not a refusal)",
        reply.length > 0 && !DEAD_REPLY.test(reply) && /downloads\//.test(reply),
        reply.slice(0, 160).replace(/\n/g, " "));
      await api("DELETE", `/api/bots/${botId}`).catch(() => {});
    }
  }
}

// ── 5. cleanup ──────────────────────────────────────────────────────────────
step("5. cleanup: no test state survives");
shell(`run-as ${PKG} sh -c 'rm -f files/${PROBE_FILE} ${MARKER}'`);
adb(`shell rm -f ${TMP_PROBE}`);
shell(`run-as ${PKG} sh -c 'rm -rf files/probe-ws'`);
check("probe workspace and scripts removed", true);
let hosts = countHosts();
for (let i = 0; i < 8 && hosts === "0"; i += 1) {
  console.log(`  hosts=0 on attempt ${i + 1} — retrying (known /proc heisenbug)`);
  await new Promise((r) => setTimeout(r, 4_000));
  hosts = countHosts();
}
check("exactly one harness host process", hosts === "1", `hosts=${hosts}`);
if (hosts !== "1") {
  console.log(shell(`run-as ${PKG} sh -c 'grep -l host-server/index[-]android /proc/[0-9]*/cmdline 2>/dev/null'`));
}

finish("android-resources", deviceAbi);
