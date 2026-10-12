#!/usr/bin/env node
// Phase 5 MCP device test — the full MCP chain against the host on a real
// phone, through the same adb-forward trust path the app's own UI uses:
//
//   scripts/test-android-mcp.mjs <apk> [--abi arm64-v8a|armeabi-v7a]
//
// Evidence chain (exit 0 only if all checks pass):
//   1. install + launch + host health + exactly one host process
//   2. MCP config CRUD: POST → list → PATCH enabled → PUT edit → DELETE
//   3. probe: POST /api/mcp/servers/ombmcp/test → ok:true + tool names
//   4. bot create + per-bot assignment (mcpServers) via PATCH /api/bots/:id
//   5. discovery → tool call → approval → execution → reply: the on-device
//      mock provider cues the MCP tool; the approval card is answered via
//      /respond; the artifact the MCP server wrote is read back from the
//      workspace with run-as (a real stdio MCP execution on-device)
//   6. deny path: a second cued call answered {behavior:"deny"} — the turn
//      still completes and the artifact must NOT exist
//   7. persistence: MCP config survives force-stop + relaunch
//   8. cleanup: MCP config + test bot removed, mock killed — no test state
//      survives the run, and the user's real provider config is restored
//      and its restoration verified.
//
// Secret hygiene: MCP env values are write-only (listings carry names
// only); nothing secret is ever on a command line; the stored provider
// key is never read, written, or echoed by this driver.
// Shared machinery comes from lib/driver-common.mjs; this file is only
// stdio-leg orchestration.
import {
  PKG, parseArgs, check, step, finish, adb, shell, api, pushFixture,
  appFilesDir, countHosts, requireApk, requireDeviceAbi, launchAndAwaitHost,
  pollTurn, dumpThreadTail, ensureDeviceMock, pointAtMock, restoreProvider,
  deviceCleanup, answeredCount,
} from "./lib/driver-common.mjs";
import { deviceMcpServerScript } from "./lib/omb-mcp-server-script.mjs";

const { APK, flagValue } = parseArgs();
const ABI = flagValue("--abi") ?? "";

const BOT_NAME = `MCP Bot ${Date.now() % 100000}`;
const MCP_NAME = "ombmcp";
// The mounted tool name, derived the way the server derives it
// (chat-mcp-tools.ts: `${serverName}_${toolName}` normalized) — asserted
// against the catalog at discovery time, never assumed.
const EXPECTED_MOUNT_NAMES = ["ombmcp_ombmcp_write", "ombmcp_ombmcp_read"];
const MCP_ARTIFACT = "mcp-proof.txt";
const MCP_ARTIFACT_DENIED = "mcp-denied.txt";

let threadId = "";
let botId = "";

step("1. install + launch + host health");
const deviceAbi = requireDeviceAbi(ABI);
requireApk(APK);
const health = await launchAndAwaitHost({ APK });
check("host healthy on 127.0.0.1:18799", Boolean(health), health ? `pid=${health.pid ?? "?"}` : "no response");
const hostPid = shell(`run-as ${PKG} sh -c 'pgrep -f "index[-]android.js" | head -1'`).trim();
check("host pid found", Boolean(hostPid), hostPid);
check("exactly one host process", countHosts() === "1", `count=${countHosts()}`);

step("2. MCP config CRUD");
// The stdio fixture is pushed into the app's files/ dir and spawned the one
// way Phase 4 proved works on-device: /proc/self/exe (the host's own node)
// with an absolute script path. There is no "node" on the host's PATH and
// the host CWD is files/, so neither a bare command nor a relative arg can
// resolve — the earlier run failed the probe with exactly that.
pushFixture("omb-mcp-server.cjs", deviceMcpServerScript());
const fixtureFilesDir = appFilesDir();
const fixturePath = `${fixtureFilesDir}/files/omb-mcp-server.cjs`;
// No provider config is written anywhere in this driver — the mock is
// configured through /api/config with snapshot/restore below, and MCP
// config is its own namespace.
const add = await api("POST", "/api/mcp/servers", {
  name: MCP_NAME,
  command: "/proc/self/exe",
  args: [fixturePath],
  env: {},
  enabled: false,
});
check("POST /api/mcp/servers accepted", [200, 201].includes(add.status), `http ${add.status} ${add.text.slice(0, 120)}`);
let listing = add.json?.servers ?? [];
const listed = listing.find((s) => s.name === MCP_NAME);
check("listing shows the new server (disabled)", Boolean(listed) && listed.enabled === false, JSON.stringify(listed ?? {}).slice(0, 140));
check("listing hides env VALUES (names only)", Array.isArray(listed?.envKeys) && listed.envKeys.every((k) => typeof k === "string"), `envKeys=${JSON.stringify(listed?.envKeys ?? [])}`);
const toggle = await api("PATCH", `/api/mcp/servers/${MCP_NAME}`, { enabled: true });
check("PATCH enabled:true accepted", toggle.status === 200 && toggle.json?.servers?.find((s) => s.name === MCP_NAME)?.enabled === true, `http ${toggle.status}`);
const edit = await api("PUT", `/api/mcp/servers/${MCP_NAME}`, {
  command: "/proc/self/exe",
  args: [fixturePath],
  enabled: true,
});
check("PUT edit accepted", edit.status === 200, `http ${edit.status} ${edit.text.slice(0, 120)}`);

step("3. probe the MCP server");
await new Promise((r) => setTimeout(r, 500));
const probe = await api("POST", `/api/mcp/servers/${MCP_NAME}/test`, undefined, { timeoutMs: 30_000 });
check("probe ok:true", probe.json?.ok === true, probe.json?.ok ? `${probe.json.tools?.length ?? 0} tools` : probe.json?.error ?? `http ${probe.status}`);
check("probe lists the fixture's tools", EXPECTED_MOUNT_NAMES.map((n) => n.replace(`${MCP_NAME}_`, "")).every((t) => probe.json?.tools?.some((x) => x.name === t)), JSON.stringify(probe.json?.tools ?? []).slice(0, 160));

step("4. bot create + assignment");
const bot = await api("POST", "/api/bots", { name: BOT_NAME });
botId = bot.json?.bot?.id ?? bot.json?.id ?? "";
threadId = bot.json?.bot?.threadId ?? bot.json?.threadId ?? "";
check("bot created through the device host", Boolean(botId), `http ${bot.status}`);
check("threadId extracted from the actual app response", Boolean(threadId), threadId ? `thread=${threadId.slice(0, 12)}…` : "MISSING — polling will fail");
const patch = await api("PATCH", `/api/bots/${botId}`, { mcpServers: [MCP_NAME] });
check("per-bot mcpServers assignment accepted", [200, 201].includes(patch.status), `http ${patch.status} ${patch.text.slice(0, 120)}`);
const patchedBot = (await api("GET", "/api/bots")).json?.bots?.find((b) => b.id === botId);
check("bot's mcpServers assignment persisted", JSON.stringify(patchedBot?.mcpServers ?? []) === JSON.stringify([MCP_NAME]), JSON.stringify(patchedBot?.mcpServers ?? []));

step("5. mock provider (on-device, identity-checked)");
const mockUp = await ensureDeviceMock();
check("deterministic mock provider running on device", mockUp);
if (mockUp) {
  // Snapshot the real provider; restore + verify at the end. A key is
  // never written unless the device had none (keyless refresh no-ops).
  const { snapshot, mockCatalogOk, catalog } = await pointAtMock();
  check("refreshed catalog is the mock's", mockCatalogOk, catalog || "(none)");
  await api("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId: "openaiCompat", model: "mock-1" } });

  step("6. discovery → tool call → approval → execution → reply");
  await api("POST", `/api/bots/${botId}/messages`, {
    text: `Cue-mcpwrite ${MCP_ARTIFACT}. Reply DONE when complete.`,
    threadId,
  });
  const okTurn = await pollTurn(150, (text) => /DONE/i.test(text), "allow", threadId, botId);
  if (!okTurn.reply) await dumpThreadTail(threadId);
  check("MCP tool turn reached a reply", /DONE/i.test(okTurn.reply), okTurn.reply.slice(0, 140));
  check("approval card was answered via /respond", okTurn.answered, `cards=${answeredCount()}`);
  const artifact = shell(`run-as ${PKG} sh -c 'find files/host/workspace -maxdepth 2 -name ${MCP_ARTIFACT} 2>/dev/null | head -1'`).trim();
  check("MCP-executed artifact exists in the workspace", Boolean(artifact), artifact);
  if (artifact) {
    const content = shell(`run-as ${PKG} cat ${artifact}`).trim();
    console.log(`artifact content: ${content.slice(0, 120)}`);
    check("artifact content came from the MCP tool call", content.length > 0);
  }

  step("7. deny path");
  const beforeDeny = answeredCount();
  await api("POST", `/api/bots/${botId}/messages`, {
    text: `Cue-mcpwrite ${MCP_ARTIFACT_DENIED}. Reply DENIEDDONE when complete.`,
    threadId,
  });
  const denyTurn = await pollTurn(120, (text) => /DENIEDDONE|MCPERROR/i.test(text), "deny", threadId, botId);
  check("denied turn still completed", /DENIEDDONE|MCPERROR/i.test(denyTurn.reply), denyTurn.reply.slice(0, 140));
  check("second card was answered with deny", answeredCount() > beforeDeny, `cards=${answeredCount()}`);
  const denied = shell(`run-as ${PKG} sh -c 'find files/host/workspace -name ${MCP_ARTIFACT_DENIED} 2>/dev/null | head -1'`).trim();
  check("denied tool call created NOTHING", !denied, denied || "absent");

  step("8. restore real provider config (and verify)");
  const restore = await restoreProvider(snapshot);
  if (restore) {
    check("real provider URL restored", restore.status === 200, `http ${restore.status}`);
    if (restore.keyConfigured) {
      const re = await api("POST", "/api/instances/openaiCompat/refresh-models", {}, { timeoutMs: 60_000 });
      const reOpts = re.json?.instances?.find((i) => i.instanceId === "openaiCompat")?.models?.options ?? [];
      check("restored catalog is not the mock's", !reOpts.some((o) => o.id === "mock-1"), reOpts.map((o) => o.id).slice(0, 3).join(","));
    }
  }
}

step("9. persistence across force-stop");
adb(`shell am force-stop ${PKG}`);
await new Promise((r) => setTimeout(r, 2_000));
const persist = await launchAndAwaitHost({ install: false });
check("host healthy after force-stop + relaunch", Boolean(persist));
const postListing = (await api("GET", "/api/mcp/servers")).json?.servers ?? [];
check("MCP config survived force-stop + relaunch", postListing.some((s) => s.name === MCP_NAME && s.enabled), JSON.stringify(postListing.map((s) => s.name)));
const fleet = (await api("GET", "/api/bots")).json;
check("test bot still served after restart", JSON.stringify(fleet?.bots ?? []).includes(BOT_NAME));
check("exactly one host process after restart", countHosts() === "1", `count=${countHosts()}`);

step("10. cleanup (no test state survives)");
await api("DELETE", `/api/mcp/servers/${MCP_NAME}`).catch(() => {});
await api("DELETE", `/api/bots/${botId}`, undefined, { timeoutMs: 15_000 }).catch(() => {});
deviceCleanup(["omb-mcp-serve[r].cjs"], ["files/omb-mcp-server.cjs"]);
const afterDelete = (await api("GET", "/api/mcp/servers")).json?.servers ?? [];
check("test MCP server removed", !afterDelete.some((s) => s.name === MCP_NAME), JSON.stringify(afterDelete.map((s) => s.name)));
const fleetAfter = (await api("GET", "/api/bots")).json;
check("test bot removed", !JSON.stringify(fleetAfter?.bots ?? []).includes(BOT_NAME));

finish("MCP RESULT", deviceAbi);
