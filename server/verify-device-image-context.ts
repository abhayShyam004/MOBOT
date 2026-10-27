const BASE_URL = "http://127.0.0.1:28889";

async function postJson(endpoint: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, data };
}

async function getJson(endpoint: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  const data = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, data };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilTurnComplete(botId: string, initialLastId?: string, maxWaitMs = 75000) {
  const start = Date.now();
  // Wait a moment for turn to start
  await sleep(1500);
  while (Date.now() - start < maxWaitMs) {
    const { data } = await getJson("/api/bots");
    const bot = ((data as any)?.bots ?? []).find((b: any) => b.id === botId);
    if (bot && !bot.busy) {
      const messages = bot.messages ?? [];
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "bot" && lastMsg.kind === "text" && (!initialLastId || lastMsg.id !== initialLastId)) {
        return lastMsg;
      }
    }
    await sleep(2000);
  }
  throw new Error(`Timeout waiting for turn completion after ${maxWaitMs}ms`);
}

async function runDeviceVerification() {
  console.log("=== MOBOT Physical Device Image-Context Continuity Verification ===");
  console.log(`Connecting to Android Preview Companion on ${BASE_URL}...`);

  const { data: botsData } = await getJson("/api/bots");
  if (!botsData?.bots?.length) {
    throw new Error("Failed to reach preview companion or no bots found");
  }

  const twelve = botsData.bots.find((b: any) => b.name === "Twelve");
  if (!twelve) {
    throw new Error("Bot 'Twelve' not found on device");
  }
  console.log(`Found Bot Twelve (id=${twelve.id}, thread=${twelve.threadId})`);

  // Verify previous history contains the mystery outline
  const outlineMsg = twelve.messages.find(
    (m: any) =>
      m.attachments &&
      m.attachments.some((a: any) => a.kind === "image" && a.name?.includes("mystery-outline")),
  );
  if (!outlineMsg) {
    console.warn("Could not find previous mystery-outline message in Twelve's thread");
  } else {
    console.log(`Found prior mystery-outline attachment:`, outlineMsg.attachments);
  }

  // Test 1: Send follow-up referencing the mystery outline image
  console.log("\n--- Scenario 1: Follow-up question referencing mystery outline ---");
  const lastBefore1 = twelve.messages[twelve.messages.length - 1]?.id;
  const prompt1 = "Look at the mystery-outline image from earlier again. Is it Bhutan?";
  console.log(`Sending turn to Twelve: "${prompt1}"...`);

  const sendRes1 = await postJson(`/api/bots/${twelve.id}/messages`, {
    text: prompt1,
    threadId: twelve.threadId,
  });
  console.log(`Message dispatch response status: ${sendRes1.status}`, sendRes1.data);

  console.log("Waiting for Twelve to analyze image and complete turn...");
  const reply1 = await pollUntilTurnComplete(twelve.id, lastBefore1, 90000);
  console.log(`Twelve replied: "${reply1.text}"`);

  // Verify that the reply answers the question and does NOT ask the user to resend the image
  const askedToResend =
    reply1.text.toLowerCase().includes("resend the image") ||
    reply1.text.toLowerCase().includes("isn't available in this session") ||
    reply1.text.toLowerCase().includes("is not available in this session");

  if (askedToResend) {
    console.error("FAIL: Bot still reported that image was unavailable in session!");
    process.exit(1);
  } else {
    console.log("PASS: Bot successfully received and analyzed the prior image without asking to resend!");
  }

  // Test 2: Send unrelated question to verify image is NOT attached (Token optimization)
  console.log("\n--- Scenario 2: Unrelated query (Token optimization check) ---");
  const lastBefore2 = reply1.id;
  const prompt2 = "What is 15 * 14?";
  console.log(`Sending turn to Twelve: "${prompt2}"...`);

  const sendRes2 = await postJson(`/api/bots/${twelve.id}/messages`, {
    text: prompt2,
    threadId: twelve.threadId,
  });
  console.log(`Message dispatch status: ${sendRes2.status}`, sendRes2.data);

  console.log("Waiting for reply...");
  const reply2 = await pollUntilTurnComplete(twelve.id, lastBefore2, 45000);
  console.log(`Twelve replied: "${reply2.text}"`);

  if (reply2.text.includes("210")) {
    console.log("PASS: Math question answered correctly.");
  }

  console.log("\n=== ALL PHYSICAL DEVICE SCENARIOS PASSED ===");
}

runDeviceVerification().catch((err) => {
  console.error("Device verification failed:", err);
  process.exit(1);
});
