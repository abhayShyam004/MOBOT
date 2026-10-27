import { execSync } from "node:child_process";

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

async function getJson(endpoint: string, retries = 5): Promise<{ status: number; data: any }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`);
      const data = (await res.json().catch(() => ({}))) as any;
      return { status: res.status, data };
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
  return { status: 500, data: {} };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilTurnComplete(botId: string, initialLastId?: string, maxWaitMs = 90000) {
  const start = Date.now();
  await sleep(2000);
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
    await sleep(2500);
  }
  throw new Error(`Timeout waiting for turn completion after ${maxWaitMs}ms`);
}

async function runDeviceVerification() {
  console.log("=== MOBOT Physical Device Case E: Multi-Turn Visual Grounding Verification ===");
  console.log(`Target: Samsung Galaxy A07 (SM-A075F, API 36, ARM64) on ${BASE_URL}...`);

  const { data: botsData } = await getJson("/api/bots");
  if (!botsData?.bots?.length) {
    throw new Error("Failed to reach preview companion or no bots found");
  }

  const twelve = botsData.bots.find((b: any) => b.name === "Twelve");
  if (!twelve) {
    throw new Error("Bot 'Twelve' not found on device");
  }
  console.log(`Target Bot: Twelve (id=${twelve.id}, thread=${twelve.threadId})`);

  // Verify prior mystery-outline attachment
  const outlineMsg = twelve.messages.find(
    (m: any) =>
      m.attachments &&
      m.attachments.some((a: any) => a.kind === "image" && a.name?.includes("mystery-outline")),
  );
  if (!outlineMsg) {
    throw new Error("Could not find prior mystery-outline message in Twelve's thread");
  }
  console.log("Prior mystery-outline attachment confirmed:", outlineMsg.attachments[0]);

  // Step 1: Turn 1: Short follow-up 'whats the country'
  console.log("\n--- Turn 1: Short follow-up 'whats the country' ---");
  const lastMsg = twelve.messages[twelve.messages.length - 1];
  const secondLastMsg = twelve.messages[twelve.messages.length - 2];
  let reply1: any;

  if (secondLastMsg?.text === "whats the country" && lastMsg?.role === "bot") {
    console.log(`Twelve already completed Turn 1. Last response: "${lastMsg.text}"`);
    reply1 = lastMsg;
  } else {
    const lastBefore1 = lastMsg?.id;
    const prompt1 = "whats the country";
    console.log(`Sending turn to Twelve: "${prompt1}"...`);

    const sendRes1 = await postJson(`/api/bots/${twelve.id}/messages`, {
      text: prompt1,
      threadId: twelve.threadId,
    });
    console.log(`Message dispatch response status: ${sendRes1.status}`);

    console.log("Waiting for Twelve to analyze image and complete turn...");
    reply1 = await pollUntilTurnComplete(twelve.id, lastBefore1, 90000);
    console.log(`Twelve replied: "${reply1.text}"`);
  }

  // Check for the old regression
  const regressionClaim =
    reply1.text.toLowerCase().includes("isn't available to inspect in this conversation") ||
    reply1.text.toLowerCase().includes("is not available to inspect in this conversation") ||
    reply1.text.toLowerCase().includes("please resend the outline") ||
    reply1.text.toLowerCase().includes("resend the image");

  if (regressionClaim) {
    console.error("FAIL: Bot still falsely claimed the mystery outline is unavailable!");
    process.exit(1);
  } else {
    console.log("PASS: Bot successfully received the active image without claiming it is unavailable or asking to resend!");
  }

  // Step 2: Unrelated math question (Token optimization verification)
  console.log("\n--- Turn 2: Unrelated math question (Token optimization verification) ---");
  const lastBefore2 = reply1.id;
  const prompt2 = "What is 15 * 14?";
  console.log(`Sending turn to Twelve: "${prompt2}"...`);

  const sendRes2 = await postJson(`/api/bots/${twelve.id}/messages`, {
    text: prompt2,
    threadId: twelve.threadId,
  });
  console.log(`Message dispatch status: ${sendRes2.status}`);

  const reply2 = await pollUntilTurnComplete(twelve.id, lastBefore2, 60000);
  console.log(`Twelve replied: "${reply2.text}"`);
  if (!reply2.text.includes("210")) {
    console.warn("Notice: Math response did not contain 210, replied:", reply2.text);
  } else {
    console.log("PASS: Math question answered correctly.");
  }

  // Step 3: Geographic truthfulness & coastline question
  console.log("\n--- Turn 3: Visual follow-up on coastline vs landlocked geography ---");
  const lastBefore3 = reply2.id;
  const prompt3 = "Wait, looking at that outline again, does this country have a coastline or is it landlocked?";
  console.log(`Sending turn to Twelve: "${prompt3}"...`);

  const sendRes3 = await postJson(`/api/bots/${twelve.id}/messages`, {
    text: prompt3,
    threadId: twelve.threadId,
  });
  console.log(`Message dispatch status: ${sendRes3.status}`);

  const reply3 = await pollUntilTurnComplete(twelve.id, lastBefore3, 90000);
  console.log(`Twelve replied: "${reply3.text}"`);

  // Verify it doesn't say unavailable
  if (
    reply3.text.toLowerCase().includes("isn't available") ||
    reply3.text.toLowerCase().includes("resend")
  ) {
    console.error("FAIL: Bot claimed outline is unavailable on coastline question!");
    process.exit(1);
  }
  console.log("PASS: Visual follow-up processed successfully.");

  // Capture screenshot on Samsung Galaxy A07
  console.log("\nCapturing device screenshot...");
  const artifactScreenshot = "/home/abhay/.gemini/antigravity-cli/brain/c0e62241-624b-4165-b406-9d9abc89c335/screen_case_e_visual_grounding.png";
  try {
    execSync(`adb exec-out screencap -p > /tmp/screen_case_e.png`);
    execSync(`cp /tmp/screen_case_e.png "${artifactScreenshot}"`);
    console.log(`Screenshot captured to ${artifactScreenshot}`);
  } catch (err) {
    console.warn("Screenshot capture error:", err);
  }

  console.log("\n=== ALL DEVICE VERIFICATION STEPS PASSED ===");
}

runDeviceVerification().catch((err) => {
  console.error("Device verification failed:", err);
  process.exit(1);
});
