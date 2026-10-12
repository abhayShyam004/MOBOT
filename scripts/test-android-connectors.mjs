#!/usr/bin/env node
// Phase 6 connectors device test — everything about the connected-apps
// wiring that is provable WITHOUT a live Composio account, driven against the
// host on a real phone through the same adb-forward path the app's own UI
// uses:
//
//   scripts/test-android-connectors.mjs <apk> [--abi arm64-v8a|armeabi-v7a]
//                                        [--serial <adb-serial>]
//
// Evidence chain (exit 0 only if all checks pass):
//   1. install + launch + host health + exactly one host process
//   2. project key: the host verifies it against the live Composio API at
//      save time — a wrong key is refused with the provider's own message,
//      never stored, and never echoed. (Two layers: the local format check
//      and the provider check.)
//   3. unconfigured state is honest: catalog still lists apps (curated
//      fallback) with configured:false; inventory answers the unconfigured
//      shape, not a fake empty success
//   4. per-bot assignment: a fresh test bot's composio grant round-trips
//      through PATCH /api/bots/:id and survives a host restart; with no
//      connected-apps service configured, ordinary turns are unaffected
//      either way — the mount is gated on `configured`, so the grant's
//      turn-level effect needs a live key and is NOT PROVEN here
//   5. cleanup: test bot removed, provider restored AND verified, mock
//      killed, no fixture or key material left, one host process
//
// What this driver does NOT prove (no credentials — stated, not implied):
// the provider sign-in finishing in the browser, a connected account, real
// Composio tool discovery/execution through the agent, and the in-chat
// connection card's live lifecycle (an agent cannot enumerate connector
// tools without a valid session).
//
// Secret hygiene: the test key is generated per run, never printed, and
// asserted absent from config reads and from the device's stored config.
// Shared machinery comes from lib/driver-common.mjs; this file is only
// connectors orchestration.
import {
  PKG, parseArgs, check, step, finish, shell, api, countHosts, setHostPid,
  requireApk, requireDeviceAbi, launchAndAwaitHost, dumpThreadTail,
  ensureDeviceMock, pointAtMock, restoreProvider, deviceCleanup, selectDevice,
} from "./lib/driver-common.mjs";

const { APK, flagValue } = parseArgs();
const ABI = flagValue("--abi") ?? "";
selectDevice(flagValue("--serial"));

const BOT_NAME = `Connectors Bot ${Date.now() % 100000}`;
// Composio-shaped on purpose, wrong on purpose. Sent once; never printed.
const TEST_KEY = `ak_driver${Date.now()}0000000000000000`;
const TEST_MARK = TEST_KEY.slice(0, 18);

let botId = "";
let threadId = "";

/** The mock runs as the host's own child, so hostNode() needs the CURRENT
 * host pid — captured after every launch/restart. */
function adoptHostPid() {
  const pid = shell(`run-as ${PKG} sh -c 'pgrep -f "index[-]android.js" | head -1'`).trim();
  setHostPid(pid);
  return pid;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Send into the test bot's own thread and wait for a NEW bot reply. The
 * fresh bot keeps this simple and repeatable; requiring the transcript to
 * GROW is what keeps arm two from reading arm one's reply as its own. */
async function sendAndAwaitReply() {
  const count = async () =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=100`, undefined, { timeoutMs: 8_000 })).json?.messages?.length ?? 0;
  const before = await count();
  await api("POST", `/api/bots/${botId}/messages`, { text: "Reply DONE if you can hear me.", threadId });
  for (let i = 0; i < 120; i += 1) {
    const messages = (await api("GET", `/api/threads/${threadId}/messages?limit=100`, undefined, { timeoutMs: 8_000 })).json?.messages ?? [];
    const reply = [...messages].reverse().find((m) => m.kind === "text" && m.role === "bot")?.text ?? "";
    if (messages.length > before && /DONE/i.test(reply)) return { ok: true, reply };
    await sleep(1_000);
  }
  return { ok: false, reply: "" };
}

step("1. install + launch + host health");
const deviceAbi = requireDeviceAbi(ABI);
requireApk(APK);
const health = await launchAndAwaitHost({ APK });
check("host healthy on 127.0.0.1:18799", Boolean(health), health ? `pid=${health.pid ?? "?"}` : "no response");
check("host pid found", Boolean(adoptHostPid()));
check("exactly one host process", countHosts() === "1", `count=${countHosts()}`);

step("2. project key: verified at save, never stored");
const before = (await api("GET", "/api/config")).json?.composio;
check("GET /api/config reports composio state", before !== undefined, JSON.stringify(before));
const hadRealKey = before?.configured === true;
if (hadRealKey) {
  console.log("SKIP: a Composio key is already configured on this device — never touching it");
  console.log("SKIP: key validation checks need a device with no key configured");
} else {
  const wrongPrefix = await api("PUT", "/api/config", { composio: { apiKey: "notak_short" } });
  check("a key that is not a Composio project key is refused locally", wrongPrefix.status === 400, `http ${wrongPrefix.status} ${wrongPrefix.text.slice(0, 120)}`);
  check("the local refusal explains the format", /ak_/.test(wrongPrefix.text), wrongPrefix.text.slice(0, 120));

  const badKey = await api("PUT", "/api/config", { composio: { apiKey: TEST_KEY } }, { timeoutMs: 30_000 });
  check("a well-formed but invalid key is refused by the live provider check", badKey.status === 400, `http ${badKey.status} ${badKey.text.slice(0, 140)}`);
  check("the provider's own wording is what comes back", /invalid api key/i.test(badKey.text), badKey.text.slice(0, 140));
  check("the refusal carries no full key material", !badKey.text.includes(TEST_KEY));

  const afterAttempt = (await api("GET", "/api/config")).json?.composio;
  check("a refused key is not stored", afterAttempt?.configured === false, JSON.stringify(afterAttempt));

  // The strongest storage claim: the exact bytes are nowhere in the host's
  // config file (config.json lives in the app's private files dir).
  const inConfig = shell(`run-as ${PKG} sh -c 'grep -c "${TEST_MARK}" files/host/data/config.json 2>/dev/null; true'`).trim();
  check("no trace of the key in the host's stored config", inConfig === "0" || inConfig === "", `grep=${inConfig || "empty"}`);

  // A refused save must also survive a host restart as refused.
  const revive = await launchAndAwaitHost({ install: false, APK });
  adoptHostPid();
  const afterRestart = (await api("GET", "/api/config")).json?.composio;
  check("host came back after restart", Boolean(revive), revive ? "healthy" : "unhealthy");
  check("still unconfigured after restart", afterRestart?.configured === false, JSON.stringify(afterRestart));
}

step("3. unconfigured states are honest");
if (hadRealKey) {
  // With a real key the catalog/inventory report the configured truth
  // instead; the unconfigured shapes were proven on keyless devices.
  const configuredCatalog = await api("GET", "/api/connectors/catalog", undefined, { timeoutMs: 30_000 });
  check("configured catalog answers live", configuredCatalog.json?.configured === true && (configuredCatalog.json?.cards?.length ?? 0) > 0,
    `cards=${configuredCatalog.json?.cards?.length} source=${configuredCatalog.json?.source}`);
  const configuredInventory = await api("GET", "/api/connectors/connected", undefined, { timeoutMs: 30_000 });
  check("configured inventory answers with services", configuredInventory.json?.configured === true && typeof configuredInventory.json?.services === "object",
    `http ${configuredInventory.status}`);
  check("inventory carries no key material", !configuredInventory.text.includes(TEST_MARK));
} else {
const catalog = await api("GET", "/api/connectors/catalog", undefined, { timeoutMs: 30_000 });
check("catalog answers", catalog.status === 200, `http ${catalog.status}`);
check("apps are still listed before setup", (catalog.json?.cards?.length ?? 0) > 0, `cards=${catalog.json?.cards?.length} source=${catalog.json?.source}`);
check("catalog reports unconfigured", catalog.json?.configured === false, JSON.stringify(catalog.json?.configured));
check("catalog carries no key material", !catalog.text.includes(TEST_MARK));

const inventory = await api("GET", "/api/connectors/connected", undefined, { timeoutMs: 30_000 });
check("inventory answers the unconfigured shape", inventory.status === 200 && inventory.json?.configured === false, `http ${inventory.status} ${inventory.text.slice(0, 120)}`);
check("unconfigured inventory is empty — not a fake success list", JSON.stringify(inventory.json?.services ?? {}) === "{}", inventory.text.slice(0, 120));
check("inventory carries no key material", !inventory.text.includes(TEST_MARK));
}

step("4. per-bot assignment persists");
const created = await api("POST", "/api/bots", { name: BOT_NAME });
botId = created.json?.bot?.id ?? created.json?.id ?? "";
threadId = created.json?.bot?.threadId ?? created.json?.threadId ?? "";
check("test bot created through the device host", Boolean(botId && threadId), `http ${created.status}`);

const setFlag = async (value) => {
  const patched = await api("PATCH", `/api/bots/${botId}`, { composio: value });
  const stored = (await api("GET", "/api/bots")).json?.bots?.find((b) => b.id === botId)?.composio;
  return { status: patched.status, stored };
};
const closed = await setFlag(false);
check("PATCH composio:false accepted and stored", closed.status === 200 && closed.stored === false, `http ${closed.status} stored=${closed.stored}`);
const opened = await setFlag(true);
check("PATCH composio:true accepted and stored", opened.status === 200 && opened.stored === true, `http ${opened.status} stored=${opened.stored}`);

const restarted = await launchAndAwaitHost({ install: false, APK });
adoptHostPid();
const storedAfterRestart = (await api("GET", "/api/bots")).json?.bots?.find((b) => b.id === botId)?.composio;
check("host came back after restart", Boolean(restarted), restarted ? "healthy" : "unhealthy");
check("the grant survives a host restart", storedAfterRestart === true, `stored=${storedAfterRestart}`);
check("exactly one host process after restart", countHosts() === "1", `count=${countHosts()}`);

if (hadRealKey) {
  console.log("SKIP: turn-level checks need a device with no real key — not risking the user's account");
} else {
  step("5. ordinary turns with and without the grant (no service configured)");
  const mockUp = await ensureDeviceMock();
  check("deterministic on-device mock is up", mockUp === true);
  const pointed = await pointAtMock();
  check("mock catalog is live (mock-1 present)", pointed.mockCatalogOk === true, pointed.catalog.slice(0, 80));
  await api("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId: "openaiCompat", model: "mock-1" } });

  const closedTurn = await sendAndAwaitReply();
  check("granted OFF, an ordinary turn answers", closedTurn.ok, JSON.stringify(closedTurn.reply).slice(0, 120));
  if (!closedTurn.ok) await dumpThreadTail(threadId);

  const openedTurn = await sendAndAwaitReply();
  check("granted ON with no service configured, the turn is unaffected (the mount is gated on configured)", openedTurn.ok, JSON.stringify(openedTurn.reply).slice(0, 120));
  if (!openedTurn.ok) await dumpThreadTail(threadId);

  const restored = await restoreProvider(pointed.snapshot);
  check("provider config restored", Boolean(restored), JSON.stringify(restored));
  const refreshed = await api("POST", "/api/instances/openaiCompat/refresh-models", {}, { timeoutMs: 60_000 });
  const catalogIds = (refreshed.json?.instances?.find((i) => i.instanceId === "openaiCompat")?.models?.options ?? []).map((o) => o.id);
  check("mock catalog is gone after restore", !catalogIds.includes("mock-1"), `options=${catalogIds.length}`);
}

step("6. cleanup");
const removed = await api("DELETE", `/api/bots/${botId}`, undefined, { timeoutMs: 15_000 });
check("test bot removed", removed.status === 200 || removed.status === 204, `http ${removed.status} ${removed.text.slice(0, 100)}`);
const fleetAfter = await api("GET", "/api/bots");
check("test bot is gone from the fleet", !JSON.stringify(fleetAfter.json?.bots ?? []).includes(BOT_NAME));
const finalConfig = await api("GET", "/api/config");
check("no test key anywhere after the run", !finalConfig.text.includes(TEST_MARK));
deviceCleanup(["ombmoc[k].cjs"], []);
check("exactly one host process after cleanup", countHosts() === "1", `count=${countHosts()}`);

finish("CONNECTORS RESULT", deviceAbi);
