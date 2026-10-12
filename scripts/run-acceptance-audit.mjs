#!/usr/bin/env node
// run-acceptance-audit.mjs
// Full end-to-end acceptance audit runner executing the 4 acceptance tests
// for master_prompt_02 on physical Samsung SM-A075F.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT_HOST = 28799;
const BASE = `http://127.0.0.1:${PORT_HOST}`;
const PKG = "com.openmausbot.companion";

function adb(args, opts = {}) {
  return execFileSync("adb", args, { encoding: "utf8", timeout: opts.timeout || 60_000, ...opts });
}

function adbShell(cmd) {
  return adb(["shell", cmd]).replace(/\r/g, "");
}

function runAs(cmd, { ignoreError = false } = {}) {
  try {
    return adbShell(`run-as ${PKG} sh -c '${cmd.replace(/'/g, "'\\''")}'`);
  } catch (e) {
    if (ignoreError) return e.stdout || "";
    throw e;
  }
}

function pushWorkspaceFile(subDir, fileName, content) {
  const tmpStage = fs.mkdtempSync(path.join(os.tmpdir(), "omb-audit-"));
  const localFile = path.join(tmpStage, fileName);
  fs.writeFileSync(localFile, content, "utf8");
  adb(["push", localFile, `/data/local/tmp/${fileName}`]);
  fs.rmSync(tmpStage, { recursive: true, force: true });
  runAs(`mkdir -p files/host/workspace/${subDir} && cp /data/local/tmp/${fileName} files/host/workspace/${subDir}/${fileName}`);
  adbShell(`rm -f /data/local/tmp/${fileName}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureForward() {
  try {
    adb(["forward", `tcp:${PORT_HOST}`, "tcp:18799"]);
  } catch (e) {
    console.warn("adb forward failed:", e.message);
  }
}

async function api(method, endpoint, body) {
  ensureForward();
  const init = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined && method !== "GET") {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${endpoint}`, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

async function createBot(name) {
  const res = await api("POST", "/api/bots", { name });
  if (!res.ok || !res.json?.bot?.id) {
    throw new Error(`Failed to create bot: ${res.status} ${res.text}`);
  }
  const bot = res.json.bot;
  await api("PATCH", `/api/bots/${bot.id}`, {
    modelSelection: { instanceId: "codex", model: "gpt-5.6-luna" },
  });
  return bot;
}

async function deleteBot(botId) {
  try {
    await api("DELETE", `/api/bots/${botId}`);
  } catch (e) {
    console.warn(`Failed to delete bot ${botId}:`, e.message);
  }
}

async function executeTurn(botId, threadId, userPrompt, { timeoutMs = 240_000 } = {}) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`>>> USER REQUEST:\n${userPrompt}`);
  console.log(`------------------------------------------------------------`);

  const initMsgRes = await api("GET", `/api/threads/${threadId}/messages`);
  const seenIds = new Set((initMsgRes.json?.messages || []).map((m) => m.id));

  const sendRes = await api("POST", `/api/bots/${botId}/messages`, {
    text: userPrompt,
    threadId,
  });
  if (!sendRes.ok) throw new Error(`Send message failed: ${sendRes.status} ${sendRes.text}`);

  const startTime = Date.now();
  const deadline = startTime + timeoutMs;
  const sequence = [];
  const allowedRequests = new Set();
  let finalReply = "";

  while (Date.now() < deadline) {
    await sleep(2000);

    const mRes = await api("GET", `/api/threads/${threadId}/messages`);
    const msgs = mRes.json?.messages || [];

    for (const m of msgs) {
      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);

      if (m.kind === "options" && m.card?.requestId && !allowedRequests.has(m.card.requestId)) {
        allowedRequests.add(m.card.requestId);
        const toolName = m.card.tool || "unknown_tool";
        console.log(`[APPROVAL REQUEST] Tool "${toolName}" (requestId: ${m.card.requestId}) -> ALLOWING`);
        sequence.push({
          type: "APPROVAL_REQUEST",
          tool: toolName,
          timestamp: new Date().toISOString(),
        });

        await api("POST", `/api/threads/${threadId}/respond`, {
          requestId: m.card.requestId,
          behavior: "allow",
        });
        sequence.push({
          type: "APPROVAL_GRANTED",
          tool: toolName,
          timestamp: new Date().toISOString(),
        });
      } else if (m.kind === "activity") {
        const toolName = m.tool?.name || m.card?.tool || "tool";
        const ok = m.tool?.ok;
        console.log(`[TOOL EXECUTION] ${toolName} (ok: ${ok})`);
        sequence.push({
          type: "TOOL_EXECUTION",
          tool: toolName,
          ok,
          spoken: m.tool?.spoken,
          timestamp: new Date().toISOString(),
        });
      } else if (m.kind === "text" && (m.role === "bot" || m.role === "assistant")) {
        console.log(`[AGENT RESPONSE / REASONING]\n${m.text}`);
        finalReply = m.text;
        sequence.push({
          type: "BOT_TEXT",
          text: m.text,
          timestamp: new Date().toISOString(),
        });
      } else if (m.kind === "structured") {
        console.log(`[STRUCTURED CARD] ${m.text}`);
        sequence.push({
          type: "STRUCTURED_RESPONSE",
          text: m.text,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const botsRes = await api("GET", "/api/bots");
    const currentBot = (botsRes.json?.bots || []).find((b) => b.id === botId);
    if (currentBot && currentBot.busy === false && finalReply) {
      console.log(`\n[TURN COMPLETED] Bot is idle. Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      break;
    }
  }

  return { finalReply, sequence, durationMs: Date.now() - startTime };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function runTest1(auditResults) {
  console.log(`\n============================================================`);
  console.log(`ACCEPTANCE TEST 1: UNFAMILIAR DEVELOPMENT TASK`);
  console.log(`============================================================`);

  const bot = await createBot("Audit Test 1 Bot");
  const testDir = "audit_test1_sqlite_cli";

  try {
    runAs(`rm -rf files/host/workspace/${testDir} && mkdir -p files/host/workspace/${testDir}`);

    const prompt = [
      `You are being tested on a novel, non-templated development task.`,
      `In workspace directory '${testDir}', create a small SQLite-backed command-line application that:`,
      `1. Accepts a CSV file containing records (create a sample CSV with at least 3 rows: id, name, score).`,
      `2. Stores the records in an SQLite database file.`,
      `3. Provides command-line functionality to query and list records from SQLite.`,
      `4. Executes the application to import the CSV and run a query.`,
      `5. Verifies the query output and validates the database file.`,
      `Do not use any special app-builder wizard; compose your generic execution, filesystem, and runtime capabilities.`,
      `Leave the completed application and verified database in '${testDir}'.`,
    ].join("\n");

    const turn = await executeTurn(bot.id, bot.threadId, prompt, { timeoutMs: 300_000 });

    console.log(`\nVerifying on-device artifacts in files/host/workspace/${testDir}:`);
    const lsOut = runAs(`ls -la files/host/workspace/${testDir}`);
    console.log(lsOut);

    const hasDb = lsOut.includes(".db") || lsOut.includes(".sqlite");
    const hasScript = lsOut.includes(".js") || lsOut.includes(".sh");
    const hasCsv = lsOut.includes(".csv");

    let dbContents = "";
    if (hasDb) {
      const dbFile = (lsOut.match(/[a-zA-Z0-9_\-.]+\.(?:db|sqlite|sqlite3)/) || [])[0];
      if (dbFile) {
        dbContents = runAs(`LD_LIBRARY_PATH=/data/app/~~0CfFGUqo-8kmW1r0IDhUJw==/com.openmausbot.companion-qwZxQAeO7HsgnA54Sl1l8g==/lib/arm64 /data/app/~~0CfFGUqo-8kmW1r0IDhUJw==/com.openmausbot.companion-qwZxQAeO7HsgnA54Sl1l8g==/lib/arm64/libnode_host.so -e '
          const { DatabaseSync } = require("node:sqlite");
          try {
            const db = new DatabaseSync("files/host/workspace/${testDir}/${dbFile}");
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = \\x27table\\x27").all();
            console.log("Tables:", JSON.stringify(tables));
            if (tables.length > 0) {
              const rows = db.prepare(\`SELECT * FROM \${tables[0].name}\`).all();
              console.log("Rows:", JSON.stringify(rows));
            }
          } catch(e) { console.error("DB probe err:", e.message); }
        '`);
        console.log(`Database Probe:\n${dbContents}`);
      }
    }

    const passed = Boolean(hasDb && hasScript && hasCsv && dbContents.includes("Rows:"));
    auditResults.test1 = {
      passed,
      turn,
      lsOut,
      dbContents,
      toolCalls: turn.sequence.filter((s) => s.type === "TOOL_EXECUTION"),
    };
    console.log(`\nTEST 1 RESULT: ${passed ? "PASS" : "FAIL"}`);
  } finally {
    await deleteBot(bot.id);
    runAs(`rm -rf files/host/workspace/${testDir}`);
  }
}

export async function runTest2(auditResults) {
  console.log(`\n============================================================`);
  console.log(`ACCEPTANCE TEST 2: NON-DEVELOPMENT TASK`);
  console.log(`============================================================`);

  const bot = await createBot("Audit Test 2 Bot");
  const testDir = "audit_test2_data";

  try {
    runAs(`rm -rf files/host/workspace/${testDir} && mkdir -p files/host/workspace/${testDir}`);

    pushWorkspaceFile(testDir, "users.json", JSON.stringify([
      { id: 1, name: "Alice", status: "PENDING" },
      { id: 2, name: "Bob", status: "ACTIVE" },
      { id: 3, name: "Carol", status: "PENDING" },
    ], null, 2));

    pushWorkspaceFile(testDir, "transactions.csv", "tx_id,amount,status\ntx1001,45.50,PENDING\ntx1002,12.00,COMPLETED\ntx1003,89.90,PENDING\n");

    pushWorkspaceFile(testDir, "audit_log.txt", "2026-10-12 10:00:00 system initialized\n2026-10-12 10:05:00 queue batch A status PENDING review\n2026-10-12 10:10:00 queue batch B status PENDING review\n2026-10-12 10:15:00 queue batch C status COMPLETED\n");

    pushWorkspaceFile(testDir, "unrelated.json", JSON.stringify({ version: 1, status: "READY" }, null, 2));

    const prompt = [
      `You are being tested on an unrelated non-development data/filesystem task.`,
      `In workspace directory '${testDir}':`,
      `1. Find all text/JSON/CSV files that contain the value 'PENDING'.`,
      `2. Inspect the matching files.`,
      `3. Transform the matching records according to this rule: change 'PENDING' to 'PROCESSED'.`,
      `4. Create a summary report 'summary_report.json' in '${testDir}' containing:`,
      `   - matchingFiles: list of modified file paths`,
      `   - filesChangedCount: total count of changed files`,
      `   - recordsChangedCount: total count of records/occurrences changed`,
      `5. Save the transformed files and the summary report in '${testDir}'.`,
      `6. Verify the modified files' contents and sha256 checksums before finishing.`,
    ].join("\n");

    const turn = await executeTurn(bot.id, bot.threadId, prompt, { timeoutMs: 300_000 });

    console.log(`\nVerifying on-device artifacts in files/host/workspace/${testDir}:`);
    const lsOut = runAs(`ls -la files/host/workspace/${testDir}`);
    console.log(lsOut);

    const reportContent = runAs(`cat files/host/workspace/${testDir}/summary_report.json 2>/dev/null || echo "MISSING"`);
    console.log(`Summary Report:\n${reportContent}`);

    const usersContent = runAs(`cat files/host/workspace/${testDir}/users.json 2>/dev/null`);
    const txContent = runAs(`cat files/host/workspace/${testDir}/transactions.csv 2>/dev/null`);
    const logContent = runAs(`cat files/host/workspace/${testDir}/audit_log.txt 2>/dev/null`);

    const pendingLeft = usersContent.includes("PENDING") || txContent.includes("PENDING") || logContent.includes("PENDING");
    const processedPresent = usersContent.includes("PROCESSED") && txContent.includes("PROCESSED") && logContent.includes("PROCESSED");
    const hasValidReport = !reportContent.includes("MISSING") && (reportContent.includes("filesChangedCount") || reportContent.includes("filesChanged"));

    const passed = Boolean(!pendingLeft && processedPresent && hasValidReport);
    auditResults.test2 = {
      passed,
      turn,
      lsOut,
      reportContent,
      pendingLeft,
      processedPresent,
      toolCalls: turn.sequence.filter((s) => s.type === "TOOL_EXECUTION"),
    };
    console.log(`\nTEST 2 RESULT: ${passed ? "PASS" : "FAIL"}`);
  } finally {
    await deleteBot(bot.id);
    runAs(`rm -rf files/host/workspace/${testDir}`);
  }
}

export async function runTest3(auditResults) {
  console.log(`\n============================================================`);
  console.log(`ACCEPTANCE TEST 3: INTENTIONAL FAILURE AND AUTONOMOUS RECOVERY`);
  console.log(`============================================================`);

  const bot = await createBot("Audit Test 3 Bot");
  const testDir = "audit_test3_recovery";

  try {
    runAs(`rm -rf files/host/workspace/${testDir} && mkdir -p files/host/workspace/${testDir}`);

    pushWorkspaceFile(testDir, "config.json", JSON.stringify({
      serviceName: "AutonomousHealthWorker",
      port: 99999,
    }, null, 2));

    pushWorkspaceFile(testDir, "server.js", `
const http = require('http');
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) {
  console.error("CONFIG_READ_ERROR: " + e.message);
  process.exit(1);
}

const port = Number(config.port);
if (!port || port < 1024 || port > 65535) {
  console.error("FATAL_PORT_ERROR: Configured port '" + config.port + "' is invalid! Port must be a valid number between 1024 and 65535.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'HEALTHY', service: config.serviceName, port: port }));
});

server.listen(port, '127.0.0.1', () => {
  console.log("SERVER_LISTENING_ON_PORT_" + port);
});
`);

    const prompt = [
      `You are being tested on autonomous failure observation and recovery.`,
      `In workspace directory '${testDir}', there is a Node.js microservice in 'server.js' and its configuration in 'config.json'.`,
      `Your task is to run the service and verify that it is listening and healthy on loopback.`,
      `If the service fails to start or crashes:`,
      `1. Observe and inspect the actual error output/logs.`,
      `2. Identify the root cause of the failure.`,
      `3. Choose and apply the corrective fix.`,
      `4. Retry execution.`,
      `5. Verify that the service is running and returns an HTTP 200 response with status 'HEALTHY'.`,
      `Do not ask for human help; recover autonomously and report the final verified state.`,
    ].join("\n");

    const turn = await executeTurn(bot.id, bot.threadId, prompt, { timeoutMs: 300_000 });

    console.log(`\nVerifying on-device artifacts in files/host/workspace/${testDir}:`);
    const cfgOut = runAs(`cat files/host/workspace/${testDir}/config.json 2>/dev/null`);
    console.log(`Modified config.json:\n${cfgOut}`);

    let parsedPort = 0;
    try {
      parsedPort = Number(JSON.parse(cfgOut).port);
    } catch {}

    const portFixed = parsedPort >= 1024 && parsedPort <= 65535;
    console.log(`Port fixed: ${portFixed} (port: ${parsedPort})`);

    const botMentionedSuccess = turn.finalReply.toLowerCase().includes("healthy") || turn.finalReply.toLowerCase().includes("200") || turn.finalReply.toLowerCase().includes("listening");
    const passed = Boolean(portFixed && botMentionedSuccess);

    auditResults.test3 = {
      passed,
      turn,
      cfgOut,
      parsedPort,
      portFixed,
      toolCalls: turn.sequence.filter((s) => s.type === "TOOL_EXECUTION"),
    };
    console.log(`\nTEST 3 RESULT: ${passed ? "PASS" : "FAIL"}`);
  } finally {
    runAs(`pkill -f "audit_test3_recovery" 2>/dev/null || true`, { ignoreError: true });
    await deleteBot(bot.id);
    runAs(`rm -rf files/host/workspace/${testDir}`, { ignoreError: true });
  }
}

export async function runTest4(auditResults) {
  console.log(`\n============================================================`);
  console.log(`ACCEPTANCE TEST 4: CAPABILITY DISCOVERY`);
  console.log(`============================================================`);

  const bot = await createBot("Audit Test 4 Bot");
  const testDir = "audit_test4_discovery";

  try {
    runAs(`rm -rf files/host/workspace/${testDir} && mkdir -p files/host/workspace/${testDir}`);
    pushWorkspaceFile(testDir, "input.dat", "SAMPLE_BINARY_PAYLOAD_FOR_HASH_VERIFICATION_2026_TEST\n");

    const prompt = [
      `You are being tested on dynamic capability discovery without hardcoded hints.`,
      `We need to compute the cryptographic SHA-512 checksum of '${testDir}/input.dat' and save the hex digest to '${testDir}/sha512.txt'.`,
      `Your task:`,
      `1. Determine what capability is required for this operation.`,
      `2. Dynamically discover whether this device has a standalone binary or command for this capability, OR whether an alternative available runtime/module (such as Node.js or a shell script) can accomplish it.`,
      `3. Execute the operation using the discovered capability.`,
      `4. Verify that the output file '${testDir}/sha512.txt' exists and contains the valid 128-character hex digest.`,
      `5. In your final response, explain exactly what capability was needed, whether a dedicated binary was present or absent, what capability or runtime was used instead, and how you verified the final outcome.`,
    ].join("\n");

    const turn = await executeTurn(bot.id, bot.threadId, prompt, { timeoutMs: 300_000 });

    console.log(`\nVerifying on-device artifacts in files/host/workspace/${testDir}:`);
    const shaContent = runAs(`cat files/host/workspace/${testDir}/sha512.txt 2>/dev/null || echo "MISSING"`).trim();
    console.log(`SHA-512 content:\n${shaContent}`);

    const expectedHash = runAs(`LD_LIBRARY_PATH=/data/app/~~0CfFGUqo-8kmW1r0IDhUJw==/com.openmausbot.companion-qwZxQAeO7HsgnA54Sl1l8g==/lib/arm64 /data/app/~~0CfFGUqo-8kmW1r0IDhUJw==/com.openmausbot.companion-qwZxQAeO7HsgnA54Sl1l8g==/lib/arm64/libnode_host.so -e '
      const fs = require("fs");
      const crypto = require("crypto");
      const data = fs.readFileSync("files/host/workspace/${testDir}/input.dat");
      console.log(crypto.createHash("sha512").update(data).digest("hex"));
    '`).trim();
    console.log(`Expected Hash: ${expectedHash}`);

    const hashMatches = shaContent.toLowerCase().includes(expectedHash.toLowerCase());
    const validLength = shaContent.length >= 128;
    const passed = Boolean(hashMatches && validLength);

    auditResults.test4 = {
      passed,
      turn,
      shaContent,
      expectedHash,
      hashMatches,
      toolCalls: turn.sequence.filter((s) => s.type === "TOOL_EXECUTION"),
    };
    console.log(`\nTEST 4 RESULT: ${passed ? "PASS" : "FAIL"}`);
  } finally {
    await deleteBot(bot.id);
    runAs(`rm -rf files/host/workspace/${testDir}`);
  }
}

async function main() {
  console.log(`############################################################`);
  console.log(`  MOBOT MASTER_PROMPT_02 FULL ACCEPTANCE AUDIT`);
  console.log(`  Executing 4 Real Acceptance Tests on Physical Samsung SM-A075F`);
  console.log(`############################################################\n`);

  const auditResults = {
    startedAt: new Date().toISOString(),
    device: {
      serial: adbShell("getprop ro.serialno").trim(),
      model: adbShell("getprop ro.product.model").trim(),
      androidRelease: adbShell("getprop ro.build.version.release").trim(),
      cpuAbi: adbShell("getprop ro.product.cpu.abi").trim(),
    },
  };

  console.log(`Device: ${auditResults.device.model} (${auditResults.device.serial})`);
  console.log(`Android Version: ${auditResults.device.androidRelease}, ABI: ${auditResults.device.cpuAbi}`);

  const targetTest = process.argv.find((a, i) => i > 1 && !a.startsWith("-")) ||
    (process.argv.indexOf("--test") !== -1 ? process.argv[process.argv.indexOf("--test") + 1] : undefined);

  if (!targetTest || targetTest === "1" || targetTest === "all") {
    await runTest1(auditResults);
  }
  if (!targetTest || targetTest === "2" || targetTest === "all") {
    await runTest2(auditResults);
  }
  if (!targetTest || targetTest === "3" || targetTest === "all") {
    await runTest3(auditResults);
  }
  if (!targetTest || targetTest === "4" || targetTest === "all") {
    await runTest4(auditResults);
  }

  auditResults.completedAt = new Date().toISOString();

  const outPath = path.join(process.cwd(), "acceptance_audit_results.json");
  fs.writeFileSync(outPath, JSON.stringify(auditResults, null, 2), "utf8");
  console.log(`\n============================================================`);
  console.log(`Audit run complete. Results saved to ${outPath}`);
  console.log(`Summary:`);
  console.log(`  Test 1 (Unfamiliar Dev Task):      ${auditResults.test1?.passed ? "PASS" : "FAIL"}`);
  console.log(`  Test 2 (Non-Dev Filesystem Task):   ${auditResults.test2?.passed ? "PASS" : "FAIL"}`);
  console.log(`  Test 3 (Failure & Auto-Recovery):   ${auditResults.test3?.passed ? "PASS" : "FAIL"}`);
  console.log(`  Test 4 (Capability Discovery):      ${auditResults.test4?.passed ? "PASS" : "FAIL"}`);
  console.log(`============================================================\n`);
}

main().catch((err) => {
  console.error("Audit runner fatal error:", err);
  process.exit(1);
});
