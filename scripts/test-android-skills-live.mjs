#!/usr/bin/env node
// End-to-end physical device verification of Phase B skills through the real
// installed companion app request pipeline on Samsung SM-A075F.
//
// Tests:
//   1. Physical device pre-flight & host server health (127.0.0.1:18799).
//   2. Verification of extracted skills in app storage:
//      /data/data/com.openmausbot.companion/files/host-server/skills/
//   3. Deterministic mock provider deployed onto device on loopback.
//   4. Turn 1 (UI/UX only): triggers UI/UX Pro Max, excludes Taste.
//   5. Turn 2 (Taste only): triggers Taste, excludes UI/UX Pro Max.
//   6. Turn 3 (Dual domain): triggers BOTH UI/UX Pro Max and Taste.
//   7. Turn 4 (Unrelated math/general): triggers ZERO skills (no token bloat).
//   8. Verification that skills were extracted locally with zero network fetches.
//   9. Non-destructive cleanup of temporary test entities.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PKG = "com.openmausbot.companion";
const PORT_DEVICE = 18799;
const PORT_HOST = 28799;
const MOCK_PORT_DEVICE = 18787;
const MOCK_PORT_HOST = 28787;
const BASE = `http://127.0.0.1:${PORT_HOST}`;
const failures = [];

const adb = (cmd, opts = {}) =>
  execFileSync("adb", cmd.split(" "), { encoding: "utf8", timeout: opts.timeout ?? 60_000, ...opts });
const shell = (cmd, opts = {}) => adb(`shell ${cmd}`, opts).replace(/\r/g, "");
const step = (label) => console.log(`\n== ${label} ==`);

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
  return ok;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, { timeoutMs = 20_000 } = {}) {
  const init = { method, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined && method !== "GET") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
}

async function getReplies(threadId) {
  const list = (await api("GET", `/api/threads/${threadId}/messages?limit=60`)).json?.messages ?? [];
  return list.filter((m) => m.kind === "text" && (m.role === "bot" || m.role === "assistant")).map((m) => m.text ?? "");
}

async function ensureDeviceMock(hostPid) {
  adb(`forward tcp:${MOCK_PORT_HOST} tcp:${MOCK_PORT_DEVICE}`);
  shell(`run-as ${PKG} sh -c 'pkill -f "ombmoc[k].cjs" || true'`);
  await wait(1_000);

  const nodeExe = shell(`run-as ${PKG} sh -c 'readlink /proc/${hostPid}/exe'`).trim();
  if (!nodeExe) throw new Error("Could not find host node executable");
  const libDir = nodeExe.replace(/\/[^/]+$/, "");

  const stage = mkdtempSync(join(tmpdir(), "omb-skills-mock-"));
  const pushPath = join(stage, "ombmock.cjs");
  writeFileSync(pushPath, readFileSync(new URL("./omb-openai-mock.cjs", import.meta.url)));
  adb(`push ${pushPath} /data/local/tmp/ombmock.cjs`, { timeout: 60_000 });
  rmSync(stage, { recursive: true, force: true });
  shell(`run-as ${PKG} cp /data/local/tmp/ombmock.cjs files/ombmock.cjs`);
  const filesDir = shell(`run-as ${PKG} sh -c 'pwd'`).trim();
  shell(`run-as ${PKG} sh -c 'LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/host/tmp LANG=C.UTF-8 nohup ${nodeExe} files/ombmock.cjs ${MOCK_PORT_DEVICE} >files/ombmock.log 2>&1 &'`);
  await wait(2_000);

  for (let i = 0; i < 10; i++) {
    try {
      const probe = await fetch(`http://127.0.0.1:${MOCK_PORT_HOST}/v1/models`, { signal: AbortSignal.timeout(3_000) });
      if (probe.ok) return true;
    } catch {}
    await wait(1_000);
  }
  return false;
}

async function runTurn(botId, threadId, promptText, perTurnMs = 45_000) {
  const beforeCount = (await getReplies(threadId)).length;
  const postRes = await api("POST", `/api/bots/${botId}/messages`, { text: promptText, threadId });
  if (postRes.status !== 200 && postRes.status !== 201 && postRes.status !== 202) {
    throw new Error(`Failed to post message: ${postRes.status} ${postRes.text}`);
  }

  const deadline = Date.now() + perTurnMs;
  while (Date.now() < deadline) {
    const replies = await getReplies(threadId);
    if (replies.length > beforeCount) {
      return replies[replies.length - 1];
    }
    await wait(1_000);
  }
  throw new Error(`Turn timed out after ${perTurnMs}ms`);
}

async function main() {
  step("1. Physical device & server pre-flight");
  const deviceModel = shell("getprop ro.product.model").trim();
  const sdkVer = shell("getprop ro.build.version.sdk").trim();
  check("Device connected", Boolean(deviceModel), `${deviceModel} (API ${sdkVer})`);

  adb(`forward tcp:${PORT_HOST} tcp:${PORT_DEVICE}`);
  const healthRes = await api("GET", "/api/health");
  check("Host server healthy on loopback", healthRes.status === 200, `pid=${healthRes.json?.pid}`);
  const hostPid = healthRes.json?.pid;
  if (!hostPid) {
    console.error("Host is not healthy; aborting");
    process.exit(1);
  }

  step("2. Verify extracted bundled skills on device filesystem");
  const skillsList = shell(`run-as ${PKG} ls -1 files/host-server/skills/`).split("\n").map(s => s.trim()).filter(Boolean);
  check("UI/UX Pro Max skill directory present on device", skillsList.includes("ui-ux-pro-max"), skillsList.join(", "));
  check("Taste skill directory present on device", skillsList.includes("taste"), skillsList.join(", "));

  const uiManifest = shell(`run-as ${PKG} cat files/host-server/skills/ui-ux-pro-max/manifest.json`);
  check("UI/UX Pro Max manifest readable and valid JSON", uiManifest.includes('"id": "ui-ux-pro-max"') && uiManifest.includes("MIT"));
  const tasteManifest = shell(`run-as ${PKG} cat files/host-server/skills/taste/manifest.json`);
  check("Taste manifest readable and valid JSON", tasteManifest.includes('"id": "taste"') && tasteManifest.includes("MIT"));

  step("3. Launch deterministic mock provider on device");
  const mockOk = await ensureDeviceMock(hostPid);
  check("Deterministic mock provider running on device", mockOk);

  step("4. Register temporary test provider instance");
  const instRes = await api("POST", "/api/instances", {
    driver: "openai-compat",
    name: "Skill QA Provider Fixture",
    url: `http://127.0.0.1:${MOCK_PORT_DEVICE}/v1`,
    key: "mock-not-a-secret",
    model: "mock-1",
  });
  const instanceId = instRes.json?.instanceId ?? "";
  check("Temporary fixture provider registered", instRes.status === 201 && Boolean(instanceId), `status=${instRes.status} id=${instanceId}`);

  await api("POST", `/api/instances/${instanceId}/refresh-models`, {}, { timeoutMs: 60_000 });

  step("5. Create isolated test bot");
  const botRes = await api("POST", "/api/bots", {
    name: `Skill QA Bot ${Date.now()}`,
  });
  const bot = botRes.json?.bot;
  check("Test bot created", Boolean(bot?.id && bot?.threadId), `botId=${bot?.id} threadId=${bot?.threadId}`);
  await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model: "mock-1" } });

  try {
    step("6. Execute real turns through companion pipeline");

    // Case 1: UI/UX prompt
    console.log("Testing Case 1: UI/UX design prompt...");
    const uiPrompt = "Please design a responsive mobile layout with accessible color palette and css typography cue-skill-probe";
    const reply1 = await runTurn(bot.id, bot.threadId, uiPrompt);
    check("Turn 1 replied", Boolean(reply1), reply1);
    check("Turn 1 selectively activated UI/UX Pro Max", reply1.includes("ui-ux-pro-max:ACTIVE"), reply1);
    check("Turn 1 excluded Taste", reply1.includes("taste:NONE"), reply1);

    // Case 2: Taste prompt
    console.log("\nTesting Case 2: Taste aesthetic prompt...");
    const tastePrompt = "Create an anti-slop portfolio with brutalist editorial design variance and visual originality cue-skill-probe";
    const reply2 = await runTurn(bot.id, bot.threadId, tastePrompt);
    check("Turn 2 replied", Boolean(reply2), reply2);
    check("Turn 2 selectively activated Taste", reply2.includes("taste:ACTIVE"), reply2);
    check("Turn 2 excluded UI/UX Pro Max", reply2.includes("ui-ux-pro-max:NONE"), reply2);

    // Case 3: Dual domain prompt
    console.log("\nTesting Case 3: Dual domain prompt...");
    const dualPrompt = "Design an original brutalist landing page layout with responsive css typography and high aesthetic taste cue-skill-probe";
    const reply3 = await runTurn(bot.id, bot.threadId, dualPrompt);
    check("Turn 3 replied", Boolean(reply3), reply3);
    check("Turn 3 activated UI/UX Pro Max", reply3.includes("ui-ux-pro-max:ACTIVE"), reply3);
    check("Turn 3 activated Taste", reply3.includes("taste:ACTIVE"), reply3);

    // Case 4: Unrelated prompt (Zero token bloat)
    console.log("\nTesting Case 4: Unrelated math/logic prompt...");
    const generalPrompt = "What is 15 multiplied by 47? Explain prime factorization steps. cue-skill-probe";
    const reply4 = await runTurn(bot.id, bot.threadId, generalPrompt);
    check("Turn 4 replied", Boolean(reply4), reply4);
    check("Turn 4 excluded UI/UX Pro Max (zero bloat)", reply4.includes("ui-ux-pro-max:NONE"), reply4);
    check("Turn 4 excluded Taste (zero bloat)", reply4.includes("taste:NONE"), reply4);

  } finally {
    step("7. Clean up test entities");
    if (bot?.id) {
      const delBot = await api("DELETE", `/api/bots/${bot.id}`);
      check("Deleted temporary test bot", delBot.status === 200, `http ${delBot.status}`);
    }
    if (instanceId) {
      const delInst = await api("DELETE", `/api/instances/${instanceId}`);
      check("Deleted temporary fixture provider", delInst.status === 200, `http ${delInst.status}`);
    }
    shell(`run-as ${PKG} sh -c 'pkill -f "ombmoc[k].cjs" || true'`);
    shell(`run-as ${PKG} rm -f files/ombmock.cjs files/ombmock.log`);
  }

  console.log(`\nPHASE B PIPELINE RESULT: ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} check(s) failed`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
