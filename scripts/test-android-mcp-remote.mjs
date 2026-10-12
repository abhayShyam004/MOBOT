#!/usr/bin/env node
// Phase 5 device driver — remote MCP leg (ARM32/ARM64):
//
//   scripts/test-android-mcp-remote.mjs <apk> --abi <abi> [--transport http|sse]
//
// Registers a url-type MCP server pointed at the canonical remote fixture
// (scripts/lib/omb-mcp-remote-fixture.mjs: streamable HTTP or legacy SSE —
// the same script openai-chat-tools.test.ts runs through the real
// RemoteMcpClient in CI), mounts it on a bot, and proves the full chain:
// registration → probe → discovery → approval → REAL remote execution (the
// effect file lands on the PHONE) → provider continuation → restore+cleanup.
// The stdio leg lives in test-android-mcp.mjs. Shared machinery comes from
// lib/driver-common.mjs; this file is only remote-transport orchestration.
import {
  PKG, parseArgs, check, step, finish, failures, adb, shell, api, pushFixture,
  appFilesDir, hostNode, setHostPid, countHosts, requireApk, requireDeviceAbi,
  launchAndAwaitHost, pollTurn, dumpThreadTail, ensureDeviceMock,
  pointAtMock, restoreProvider, deviceCleanup,
} from "./lib/driver-common.mjs";
import { remoteMcpFixtureScript } from "./lib/omb-mcp-remote-fixture.mjs";

const { APK, flagValue } = parseArgs();
const ABI = flagValue("--abi") ?? "";
const TRANSPORT = flagValue("--transport") ?? "http";
if (TRANSPORT !== "http" && TRANSPORT !== "sse") {
  console.error("usage: scripts/test-android-mcp-remote.mjs <apk> --abi <abi> --transport http|sse");
  process.exit(2);
}

const BOT_NAME = `MCP Remote ${Date.now() % 100000}`;
const MCP_NAME = "ombremote";
const HTTP_PORT = 18791;
const EFFECT = "mcp-remote-effect.txt";

let threadId = "";
let botId = "";

step("1. install + launch + host health");
const deviceAbi = requireDeviceAbi(ABI);
requireApk(APK);
adb(`install -r -d ${APK}`, { timeout: 300_000 });
const health = await launchAndAwaitHost({ install: false });
check("host healthy on 127.0.0.1:18799", Boolean(health));
const hostPid = shell(`run-as ${PKG} sh -c 'pgrep -f "index[-]android.js" | head -1'`).trim();
setHostPid(hostPid);
check("host pid found", Boolean(hostPid), hostPid);
check("exactly one host process", countHosts() === "1", `count=${countHosts()}`);

step("2. start the remote fixture on the phone");
// Kill any stale fixture from a previous failed run first — a leftover
// process holding :18791 makes the fresh fixture die with EADDRINUSE and
// the run then probes a corpse speaking the old protocol.
shell(`run-as ${PKG} sh -c 'pkill -f "omb-mcp-remote-fixtur[e]" || true'`);
await new Promise((r) => setTimeout(r, 1_000));
pushFixture("omb-mcp-remote-fixture.mjs", remoteMcpFixtureScript(HTTP_PORT, TRANSPORT, EFFECT));
const filesDir = appFilesDir();
const fixturePath = `${filesDir}/files/omb-mcp-remote-fixture.mjs`;
const { exe, libDir } = hostNode();
shell(`run-as ${PKG} sh -c 'mkdir -p files/host/workspace; LD_LIBRARY_PATH=${libDir} OPENSSL_CONF=/dev/null HOME=${filesDir} TMPDIR=${filesDir}/files/host/tmp AC_WORKSPACE=${filesDir}/files/host/workspace LANG=C.UTF-8 nohup ${exe} ${fixturePath} ${HTTP_PORT} >files/omb-remote-fixture.log 2>&1 &'`);
await new Promise((r) => setTimeout(r, 2_000));

step("3. register the remote MCP server (url-type)");
// A prior failed run may have left the test server behind (failure-preserving
// cleanup keeps it for inspection) — remove it so this run starts clean.
await api("DELETE", `/api/mcp/servers/${MCP_NAME}`).catch(() => {});
const add = await api("POST", "/api/mcp/servers", {
  name: MCP_NAME,
  type: TRANSPORT,
  url: `http://127.0.0.1:${HTTP_PORT}/mcp${TRANSPORT === "sse" ? "-sse" : ""}`,
  headers: {},
  // The registry contract: a server added through the app is created
  // DISABLED and must be enabled explicitly (same flow as the UI's switch
  // and the stdio driver). `enabled: true` on POST is ignored by design.
  enabled: false,
});
check("POST url-type server accepted", [200, 201].includes(add.status), `http ${add.status} ${add.text.slice(0, 120)}`);
const listedNew = add.json?.servers?.find((s) => s.name === MCP_NAME);
check("listing shows the new server (disabled)", Boolean(listedNew) && listedNew.enabled === false, JSON.stringify(listedNew ?? {}).slice(0, 140));
const enable = await api("PATCH", `/api/mcp/servers/${MCP_NAME}`, { enabled: true });
check("PATCH enabled:true accepted", enable.status === 200 && enable.json?.servers?.find((s) => s.name === MCP_NAME)?.enabled === true, `http ${enable.status}`);
await new Promise((r) => setTimeout(r, 500));
const probe = await api("POST", `/api/mcp/servers/${MCP_NAME}/test`, undefined, { timeoutMs: 30_000 });
check(`probe ok:true over ${TRANSPORT === "sse" ? "legacy SSE" : "streamable HTTP"}`, probe.json?.ok === true, probe.json?.ok ? `${probe.json.tools?.length ?? 0} tools` : probe.json?.error ?? `http ${probe.status}`);

step("4. bot + assignment");
const bot = await api("POST", "/api/bots", { name: BOT_NAME });
botId = bot.json?.bot?.id ?? bot.json?.id ?? "";
threadId = bot.json?.bot?.threadId ?? bot.json?.threadId ?? "";
check("bot created", Boolean(botId));
check("threadId extracted from the actual app response", Boolean(threadId), threadId ? `thread=${threadId.slice(0, 12)}…` : "MISSING — polling will fail");
const patch = await api("PATCH", `/api/bots/${botId}`, { mcpServers: [MCP_NAME] });
check("mcpServers assignment accepted", [200, 201].includes(patch.status), `http ${patch.status}`);
const patchedBot = (await api("GET", "/api/bots")).json?.bots?.find((b) => b.id === botId);
check("bot's mcpServers assignment persisted", JSON.stringify(patchedBot?.mcpServers ?? []) === JSON.stringify([MCP_NAME]), JSON.stringify(patchedBot?.mcpServers ?? []));

step("5. mock provider + remote tool turn");
const mockUp = await ensureDeviceMock();
check("deterministic mock provider running on device", mockUp);
if (mockUp) {
  const { snapshot, mockCatalogOk, catalog } = await pointAtMock();
  check("refreshed catalog is the mock's", mockCatalogOk, catalog);
  await api("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId: "openaiCompat", model: "mock-1" } });

  await api("POST", `/api/bots/${botId}/messages`, {
    text: `Cue-remotewrite ${EFFECT}. Reply DONE when complete.`,
    threadId,
  });
  const turn = await pollTurn(150, (text) => /DONE|MCPERROR/i.test(text), "allow", threadId, botId);
  if (!turn.reply) await dumpThreadTail(threadId);
  check("remote MCP tool turn reached a reply", /DONE|MCPERROR/i.test(turn.reply), turn.reply.slice(0, 140));
  check("approval card was answered", turn.answered);
  const effect = shell(`run-as ${PKG} sh -c 'cat files/host/workspace/${EFFECT} 2>/dev/null || true'`).trim();
  check("remote-executed effect file exists in the workspace", effect.includes("receipt=done"), effect || "absent");

  step("6. restore real provider config");
  const restore = await restoreProvider(snapshot);
  if (restore) check("real provider URL restored", restore.status === 200, `http ${restore.status}`);
}

step("7. cleanup");
if (failures.length === 0) {
  await api("DELETE", `/api/mcp/servers/${MCP_NAME}`).catch(() => {});
  await api("DELETE", `/api/bots/${botId}`, undefined, { timeoutMs: 15_000 }).catch(() => {});
  deviceCleanup(["omb-mcp-remote-fixtur[e]"], [`files/omb-mcp-remote-fixture.mjs`, `files/omb-remote-fixture.log`, `files/host/workspace/${EFFECT}`]);
  const afterDelete = (await api("GET", "/api/mcp/servers")).json?.servers ?? [];
  check("test remote server removed", !afterDelete.some((s) => s.name === MCP_NAME), JSON.stringify(afterDelete.map((s) => s.name)));
} else {
  // A failed run must leave its evidence: the bot/thread, the MCP server,
  // both fixture logs, and the processes stay on the device for inspection.
  console.log("  FAILURES present — state left on device for inspection:");
  console.log(`    bot=${botId} thread=${threadId} mcpServer=${MCP_NAME}`);
  console.log("    logs: run-as com.openmausbot.companion cat files/omb-remote-fixture.log files/ombmock.log");
}

finish("MCP REMOTE RESULT", deviceAbi);
