#!/usr/bin/env node
// Phase 6 live connector driver — the real-credential round.
//
//   scripts/test-android-connectors-live.mjs <apk> [--abi arm64-v8a|armeabi-v7a]
//       [--serial X] [--model id] [--no-install] [--skip-resume]
//
// Everything the credential-free driver (test-android-connectors.mjs) proves
// stands on its own; this script adds the only things it cannot:
//   A. a REAL turn through the mounted Composio session against a REAL
//      connected service (GitHub), and
//   B. the agent-initiated connection flow: against a toolkit this project
//      has NO connection for, the agent's COMPOSIO_MANAGE_CONNECTIONS call
//      becomes a kind:"connector" chat card; the driver drives the real
//      authorize → status → resume machinery to completion.
//
// Prerequisites (the script fails loudly, naming the remedy):
//   - a Composio project key stored on the host (Connected Apps → Set up)
//   - at least one connected service (GitHub when present) for part A
//   - for part B, at least one toolkit WITHOUT a connection (no-auth
//     toolkits like hackernews connect instantly with no user interaction)
//
// Evidence chain (exit 0 only if every check passes):
//   1. host healthy, composio.configured true, live catalog reachable
//   2. a connected service exists and reports ACTIVE
//   3. fresh test bot + a real model from the live provider catalog
//   4. real turn: COMPOSIO_* tools mounted → approval cards → allow →
//      ok:true execution with non-empty provider output → reply
//   5. agent-initiated connection flow: (a) a no-auth toolkit is discovered
//      and executed with NO connection at all; (b) an auth-requiring
//      toolkit makes the agent emit a kind:"connector" card carrying
//      slug/label/status:"required"/resumeKey, whose authorize action
//      retires the card. With --oauth, leg 6 keeps the card parked: a real
//      provider OAuth completes in a browser, the host observes the account
//      go ACTIVE, and the card's resume action continues the parked turn.
//   6. cleanup: the test bot is deleted and verified gone; exactly one host
//      process remains
//
// Secret hygiene: this script never reads, prints, or stores the key — it
// only checks the host's boolean `configured` state.
import {
  PKG, selectDevice, parseArgs, check, step, finish, shell, setHostPid,
  countHosts, requireApk, requireDeviceAbi, launchAndAwaitHost, api,
  pollTurn, waitIdle, waitFor, dumpThreadTail,
} from "./lib/driver-common.mjs";

const { APK, flagValue, args } = parseArgs("scripts/test-android-connectors-live.mjs <apk> [--abi abi] [--serial serial] [--model id] [--no-install] [--oauth]");
requireApk(APK);
selectDevice(flagValue("--serial"));
const MODEL_OVERRIDE = flagValue("--model");
const NO_INSTALL = args.includes("--no-install");
const RUN_OAUTH = args.includes("--oauth");
const DEAD_REPLY = /provider settings changed|turn was interrupted|no activity for \d+ minutes/i;

const deviceAbi = requireDeviceAbi(flagValue("--abi"));

step("1. host up, Composio configured");
const health = await launchAndAwaitHost({ install: !NO_INSTALL, APK });
check("host healthy after install + launch", Boolean(health), JSON.stringify(health ?? {}));
setHostPid(String(health?.pid ?? ""));
const version = shell(`dumpsys package ${PKG} | grep -m1 versionName`).replace("versionName=", "").trim();
console.log(`  installed versionName=${version}`);

const cfg = (await api("GET", "/api/config")).json ?? {};
if (!cfg.composio?.configured) {
  console.error("FATAL: no Composio key on this host — open the app → Settings → Connected Apps → Set up, then rerun.");
  process.exit(2);
}
check("Composio configured on the host", true, `mode=${cfg.composio.mode}`);

step("2. connected service");
const connected = (await api("GET", "/api/connectors/connected", undefined, { timeoutMs: 60_000 })).json ?? {};
const services = Object.entries(connected.services ?? {}).filter(([, s]) => s.connected && !s.pending);
check("at least one connected service", services.length > 0,
  services.length ? services.map(([slug, s]) => `${slug}:${s.status}`).join(",") : "none — authorize an app in Connected Apps first");
if (!services.length) process.exit(2);
const [serviceSlug, serviceState] = services.find(([slug]) => slug === "github") ?? services[0];
check("service ACTIVE", serviceState.status === "ACTIVE", `${serviceSlug} accounts=${serviceState.accounts?.length ?? 0}`);

const catalog = (await api("GET", "/api/connectors/catalog", undefined, { timeoutMs: 60_000 })).json ?? {};
check("live toolkit catalog reachable", catalog.source === "api", `source=${catalog.source} cards=${catalog.cards?.length ?? 0}`);

step("3. fresh test bot + real model");
// Resolve a model the host's own gateway actually serves — never a hardcoded
// id, which silently 404s the turn (`model_not_found`). Prefer a known
// tool-capable muse model on this gateway; --model overrides; empty catalog
// is a loud failure naming the ids the host returned.
const refreshed = await api("POST", "/api/instances/openaiCompat/refresh-models", {}, { timeoutMs: 60_000 });
const options = refreshed.json?.instances?.find((i) => i.instanceId === "openaiCompat")?.models?.options ?? [];
const MODEL = MODEL_OVERRIDE ?? (options.find((o) => /muse/i.test(o.id))?.id ?? options[0]?.id ?? "");
check("host serves a live model catalog", options.length > 0 && MODEL !== "",
  options.length ? `picked ${MODEL} of ${options.length}` : `empty catalog (http ${refreshed.status})`);
if (!MODEL) process.exit(2);
const BOT = "connector-live-smoke";
await api("DELETE", `/api/bots?name=${BOT}`).catch(() => {});
const created = await api("POST", "/api/bots", {
  name: BOT,
  soul: "For any external service (Slack, Gmail, GitHub, websites, anything), always use the connected-apps (Composio) tools. When a service is not connected, always call COMPOSIO_MANAGE_CONNECTIONS to request the connection — never claim a service is unavailable without checking the tools first.",
});
const botId = created.json?.bot?.id ?? created.json?.id ?? "";
const threadId = created.json?.bot?.threadId ?? created.json?.threadId ?? "";
check("test bot created", Boolean(botId && threadId), `http ${created.status}`);
const patched = await api("PATCH", `/api/bots/${botId}`, {
  modelSelection: { instanceId: "openaiCompat", model: MODEL },
  composio: true,
});
check("real model set + connectors enabled for the bot", [200, 201].includes(patched.status),
  `${MODEL} http ${patched.status} ${patched.text.slice(0, 120)}`);

step("4. real turn through the connector bridge");
const sentA = await api("POST", `/api/bots/${botId}/messages`, {
  text: `Use the connected-apps (Composio) tools to list my ${serviceSlug} repositories, newest first. Then reply with the repository names you found.`,
  threadId,
});
const sinceA = sentA.json?.message?.id ?? sentA.json?.id ?? "";
const result = await pollTurn(420, (text) => text.length > 0, "allow", threadId, botId, {
  sinceId: sinceA,
  settle: { toolRegex: /EXECUTE/i, quiet: 4 },
});
for (const t of result.tools) {
  console.log(`  connector tool: ${t.name} ok=${t.ok} output=${String(t.output).slice(0, 160).replace(/\n/g, " ")}`);
}
check("connector tools were mounted into the turn", result.tools.length > 0, `${result.tools.length} COMPOSIO_* event(s)`);
const executed = result.tools.find((t) => /EXECUTE/i.test(t.name) && t.ok);
check("a real connector execution returned ok with provider output",
  Boolean(executed) && executed.output.length > 0,
  executed ? `output bytes=${executed.output.length}` : `events=${result.tools.map((t) => `${t.name}:${t.ok}`).join(",") || "none"}`);
check("assistant replied after the execution", result.reply.length > 0 && !DEAD_REPLY.test(result.reply),
  result.reply.slice(0, 140).replace(/\n/g, " "));
check("no connection card was needed (service already authorized)", !result.connector);
const idleA = await waitIdle(botId);
check("part A turn completed (bot idle)", idleA);

step("5. agent-initiated connection flow (card lifecycle)");
const idle = await waitIdle(botId);
check("part A turn fully settled before part B", idle);

// 5a. A no-auth toolkit needs NO connection: the agent discovers and
// executes it straight away — connection-less execution is itself part of
// the connector contract.
const sentN = await api("POST", `/api/bots/${botId}/messages`, {
  text: "Show me the front page of Hacker News using the connected-apps tools.",
  threadId,
});
const sinceN = sentN.json?.message?.id ?? sentN.json?.id ?? "";
const noauth = await pollTurn(240, (text) => text.length > 0, "allow", threadId, botId, {
  sinceId: sinceN,
  settle: { toolRegex: /EXECUTE|SEARCH/i, quiet: 4 },
});
check("no-auth toolkit executed with no connection", noauth.tools.some((t) => /EXECUTE|SEARCH/i.test(t.name) && t.ok) && noauth.reply.length > 0,
  `${noauth.tools.length} COMPOSIO_* event(s), reply=${noauth.reply.slice(0, 80).replace(/\n/g, " ")}`);
check("no connection card for a no-auth toolkit", !noauth.connector);
check("no-auth turn fully settled", await waitIdle(botId));

// 5b. An auth-requiring toolkit makes the agent emit a connector card; the
// driver asserts the card contract and the dismiss lifecycle. The turn
// pauses waiting for the connection (by design) and the bot is deleted in
// cleanup, which retires the parked turn.
// The toolkit must be auth-requiring AND have zero existing accounts —
// an INITIALIZING leftover from an earlier run would make authorize demand
// an account alias (correct behavior) and this leg would 400. Today's
// leftover comes from THIS run's parked card, so exclude leg 5b's pick too.
const knownSlugs = new Set(Object.keys(connected.services ?? {}));
const cardTarget = (catalog.cards ?? []).find((c) => !c.noAuth && !knownSlugs.has(c.slug)) ?? null;
check("an unconnected auth-requiring toolkit exists for the card leg", Boolean(cardTarget),
  cardTarget ? `picked ${cardTarget.slug}` : "all catalog toolkits already have accounts — disconnect one first");
if (!cardTarget) process.exit(2);
const targetName = cardTarget.label ?? cardTarget.slug;
let cardHandled = false;
let cardId = "";
let authLink = "";
const sentB = await api("POST", `/api/bots/${botId}/messages`, {
  text: `Send a ${targetName} message saying hi. First check the connected-apps tools: if ${targetName} is not connected, call the connection-management tool (COMPOSIO_MANAGE_CONNECTIONS) to request the ${targetName} connection — do not just say it is unavailable.`,
  threadId,
});
const sinceB = sentB.json?.message?.id ?? sentB.json?.id ?? "";
if (!sinceB) console.error(`WARN: message POST returned no id (http ${sentB.status}) — sinceId filtering disabled`);
let dismissed = false;
const answeredB = new Set();
const cardSeen = await waitFor(async () => {
  const state = (await api("GET", `/api/threads/${threadId}/messages?limit=40`, undefined, { timeoutMs: 8_000 })).json;
  const messages = sinceB ? state?.messages?.slice(state.messages.findIndex((m) => m.id === sinceB) + 1) ?? [] : state?.messages ?? [];
  // this waiter owns the turn until the card appears: approval cards must
  // be answered or the agent stalls before ever reaching MANAGE_CONNECTIONS
  for (const m of messages) {
    const requestId = m?.card?.requestId;
    if (m.kind === "options" && requestId && !answeredB.has(requestId)) {
      answeredB.add(requestId);
      console.log(`  approval card (tool=${m.card?.tool ?? "?"}) → allow`);
      await api("POST", `/api/bots/${botId}/respond`, { behavior: "allow", requestId });
    }
  }
  const card = messages.find((m) => m.kind === "connector");
  if (!card || cardHandled) return false;
  cardHandled = true;
  cardId = card.id;
  const c = card.connector ?? {};
  check("connector card carries slug/label/required/resumeKey",
    Boolean(c.slug) && Boolean(c.label) && c.status === "required" && /^[\w-]{8,100}$/.test(c.resumeKey ?? ""),
    `slug=${c.slug} status=${c.status} resumeKey=${(c.resumeKey ?? "").slice(0, 8)}…`);
  const auth = await api("POST", `/api/bots/${botId}/connector-cards/${card.id}/authorize`, { threadId });
  const link = auth.json?.url ?? "";
  check("card authorize returns a real Composio connect link", auth.status === 200 && link.startsWith("https://"),
    `http ${auth.status} ${String(link).slice(0, 60)}`);
  authLink = link;
  if (RUN_OAUTH) return true; // leg 6 keeps the card parked and resumes it after a real OAuth
  const dismissedResult = await api("POST", `/api/bots/${botId}/connector-cards/${card.id}/dismiss`, { threadId });
  dismissed = dismissedResult.json?.dismissed === true;
  return true;
}, 240);
check("connection-required card emitted for an unconnected auth toolkit", cardSeen);
if (!cardSeen) await dumpThreadTail(threadId);
check("card dismiss lifecycle works", dismissed || RUN_OAUTH);

// 6. Opt-in (--oauth) user-assisted OAuth round: the card stays parked, the
// user completes the provider's hosted OAuth in a browser, the host observes
// the account become ACTIVE, and the card's resume action continues the
// parked turn. This is the real callback->resume machinery; the consent
// click itself is human by design. Slack is used here, never the user's
// GitHub connection.
if (RUN_OAUTH && cardSeen) {
  step("6. OAuth resume round (user-assisted, real provider)");
  console.log("  ACTION NEEDED: open this link in any browser and complete the Slack sign-in:");
  console.log(`    ${authLink}`);
  const active = await waitFor(async () => {
    const st = (await api("GET", "/api/connectors/connected", undefined, { timeoutMs: 30_000 })).json?.services?.slack;
    return Boolean(st?.connected && st?.status === "ACTIVE");
  }, 600, 10_000);
  check("slack becomes ACTIVE after the user completes OAuth", active === true);
  const resumed = await api("POST", `/api/bots/${botId}/connector-cards/${cardId}/resume`, { threadId });
  check("parked turn resumes via the card resume action", resumed.status === 200, `http ${resumed.status}`);
  const outcome = await pollTurn(300, (text) => text.length > 0, "allow", threadId, botId, {
    sinceId: sinceB,
    settle: { toolRegex: /EXECUTE|SEARCH/i, quiet: 4 },
  });
  check("assistant continuation after OAuth completion", outcome.reply.length > 0 && outcome.tools.some((t) => t.ok),
    `reply=${outcome.reply.slice(0, 80).replace(/\n/g, " ")}`);
}

step("7. cleanup (no test state survives)");
const removed = await api("DELETE", `/api/bots/${botId}`, undefined, { timeoutMs: 30_000 });
const gone = !((await api("GET", "/api/bots")).json?.bots ?? []).some((b) => b.id === botId);
check("test bot deleted and verified gone", [200, 201, 204, 404].includes(removed.status) && gone, `http ${removed.status}`);
const hosts = countHosts();
check("exactly one host process", hosts === "1", `hosts=${hosts}`);

finish("CONNECTORS LIVE RESULT", deviceAbi);
