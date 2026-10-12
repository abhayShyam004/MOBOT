import { execFileSync } from "node:child_process";

const PORT_HOST = 28799;
const BASE = `http://127.0.0.1:${PORT_HOST}`;

async function main() {
  console.log("Setting up adb forward...");
  execFileSync("adb", ["forward", `tcp:${PORT_HOST}`, "tcp:18799"]);

  // 1. Create bot
  const botRes = await fetch(`${BASE}/api/bots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Probe Kernel Bot" }),
  });
  const botData = await botRes.json();
  const botId = botData.bot.id;
  const threadId = botData.bot.threadId;
  console.log(`Created bot: ${botId}, thread: ${threadId}`);

  // 2. Set model
  await fetch(`${BASE}/api/bots/${botId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelSelection: { instanceId: "codex", model: "gpt-5.6-luna" } }),
  });

  // 3. Snapshot initial messages
  const initMsgRes = await fetch(`${BASE}/api/threads/${threadId}/messages`);
  const initMsgs = await initMsgRes.json();
  const seenIds = new Set((initMsgs.messages || []).map((m) => m.id));

  // 4. Send instruction
  console.log("Sending instruction to bot: 'Inspect the system with run_command (uname) and tell me the kernel release.'");
  await fetch(`${BASE}/api/bots/${botId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: "Please inspect the operating system using run_command (uname -a) and tell me what the kernel version/architecture is.",
      threadId,
    }),
  });

  // 5. Watch loop
  const deadline = Date.now() + 60_000;
  let finalReply = "";
  const allowedRequests = new Set();

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));

    // Check messages
    const mRes = await fetch(`${BASE}/api/threads/${threadId}/messages`);
    const mData = await mRes.json();
    const msgs = mData.messages || [];

    for (const m of msgs) {
      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);

      if (m.kind === "options" && m.card?.requestId && !allowedRequests.has(m.card.requestId)) {
        allowedRequests.add(m.card.requestId);
        console.log(`[APPROVAL REQUEST] tool: ${m.card.tool} -> AUTO-ALLOWING`);
        await fetch(`${BASE}/api/threads/${threadId}/respond`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: m.card.requestId, behavior: "allow" }),
        });
      } else if (m.kind === "activity") {
        console.log(`[TOOL ACTIVITY] ${m.tool?.name || m.card?.tool} (ok: ${m.tool?.ok})`);
      } else if (m.kind === "text" && (m.role === "bot" || m.role === "assistant")) {
        console.log(`[BOT TEXT] ${m.text}`);
        finalReply = m.text;
      }
    }

    // Check if bot is done
    const botsRes = await fetch(`${BASE}/api/bots`);
    const botsData = await botsRes.json();
    const curBot = (botsData.bots || []).find((b) => b.id === botId);
    if (curBot && curBot.busy === false && finalReply) {
      console.log("Bot has finished its turn.");
      break;
    }
  }

  // 6. Cleanup
  console.log("Cleaning up probe bot...");
  await fetch(`${BASE}/api/bots/${botId}`, { method: "DELETE" });
  console.log("Probe complete.");
}

main().catch(console.error);
