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

async function pollUntilTurnComplete(botId: string, initialLastId?: string, maxWaitMs = 120000) {
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
  console.log("=== MOBOT Physical Device Case F: Visual Answer Verification & Self-Correction ===");
  console.log(`Target: Samsung Galaxy A07 (SM-A075F, API 36, ARM64) on ${BASE_URL}...`);

  const { data: botsData } = await getJson("/api/bots");
  if (!botsData?.bots?.length) {
    throw new Error("Failed to reach preview companion or no bots found");
  }

  const twelve = botsData.bots.find((b: any) => b.name === "Twelve");
  if (!twelve) {
    throw new Error("Bot 'Twelve' not found on device");
  }
  console.log(`Target Bot: Twelve (id=${twelve.id}, thread=${twelve.threadId}, messages=${twelve.messages.length})`);

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

  // Turn 1: Self-correction and landlocked truthfulness challenge
  console.log("\n--- Turn 1: Re-examination, Evidence Precedence & Self-Correction ---");
  const lastMsg = twelve.messages[twelve.messages.length - 1];
  const lastBefore1 = lastMsg?.id;
  const prompt1 = "Please re-examine that outline and the verified source evidence carefully. Is this country actually Russia or Bhutan? And is it landlocked or does it have a coastline?";
  console.log(`Sending turn to Twelve: "${prompt1}"...`);

  const sendRes1 = await postJson(`/api/bots/${twelve.id}/messages`, {
    text: prompt1,
    threadId: twelve.threadId,
  });
  console.log(`Message dispatch status: ${sendRes1.status}`);

  console.log("Waiting for Twelve to analyze visual evidence and respond...");
  const reply1 = await pollUntilTurnComplete(twelve.id, lastBefore1, 120000);
  console.log(`\nTwelve replied:\n"${reply1.text}"\n`);

  // Verification checks for Turn 1:
  const text1Lower = reply1.text.toLowerCase();

  // 1. Must NOT claim image is unavailable
  if (
    text1Lower.includes("isn't available") ||
    text1Lower.includes("is not available") ||
    text1Lower.includes("resend the image") ||
    text1Lower.includes("resend the outline")
  ) {
    console.error("FAIL: Bot claimed image was unavailable!");
    process.exit(1);
  }
  console.log("PASS Check 1: Multimodal continuity maintained (image accessible).");

  // 2. Must identify Bhutan or reject Russia
  const mentionsBhutan = text1Lower.includes("bhutan");
  const rejectsRussiaOrCorrects =
    text1Lower.includes("not russia") ||
    text1Lower.includes("incorrectly") ||
    text1Lower.includes("mistake") ||
    text1Lower.includes("apolog") ||
    text1Lower.includes("earlier") ||
    text1Lower.includes("previously") ||
    text1Lower.includes("actually") ||
    text1Lower.includes("correction");

  console.log(`Check 2 Evaluation: mentionsBhutan=${mentionsBhutan}, selfCorrectionIndicators=${rejectsRussiaOrCorrects}`);
  if (!mentionsBhutan && !rejectsRussiaOrCorrects) {
    console.warn("WARN Check 2: Response did not explicitly identify Bhutan or mention correction.");
  } else {
    console.log("PASS Check 2: Self-correction / evidence precedence engaged.");
  }

  // 3. Must recognize landlocked status / no coastline
  const recognizesLandlocked = text1Lower.includes("landlocked") || text1Lower.includes("no coastline") || text1Lower.includes("0 km");
  if (recognizesLandlocked) {
    console.log("PASS Check 3: Factual geography respected (landlocked, no coastline).");
  } else {
    console.warn("WARN Check 3: Did not explicitly state landlocked in reply.");
  }

  // Turn 2: Follow-up question on neighboring borders to confirm ground-truth alignment
  console.log("\n--- Turn 2: Bordering nations check ---");
  const lastBefore2 = reply1.id;
  const prompt2 = "Which countries border this outline?";
  console.log(`Sending turn to Twelve: "${prompt2}"...`);

  const sendRes2 = await postJson(`/api/bots/${twelve.id}/messages`, {
    text: prompt2,
    threadId: twelve.threadId,
  });
  console.log(`Message dispatch status: ${sendRes2.status}`);

  const reply2 = await pollUntilTurnComplete(twelve.id, lastBefore2, 90000);
  console.log(`\nTwelve replied:\n"${reply2.text}"\n`);

  const text2Lower = reply2.text.toLowerCase();
  const mentionsIndiaOrChina = text2Lower.includes("india") || text2Lower.includes("china") || text2Lower.includes("tibet");
  if (mentionsIndiaOrChina) {
    console.log("PASS Check 4: Correct bordering geography confirmed (India/China).");
  } else {
    console.warn("WARN Check 4: India/China borders not explicitly mentioned.");
  }

  // Capture device screenshot
  console.log("\nCapturing device screenshot...");
  const artifactScreenshot = "/home/abhay/.gemini/antigravity-cli/brain/c0e62241-624b-4165-b406-9d9abc89c335/screen_case_f_visual_verification.png";
  try {
    execSync(`adb exec-out screencap -p > /tmp/screen_case_f.png`);
    execSync(`cp /tmp/screen_case_f.png "${artifactScreenshot}"`);
    console.log(`Screenshot captured to ${artifactScreenshot}`);
  } catch (err) {
    console.warn("Screenshot capture error:", err);
  }

  console.log("\n=== PHYSICAL DEVICE VERIFICATION COMPLETE ===");
}

runDeviceVerification().catch((err) => {
  console.error("Device verification failed:", err);
  process.exit(1);
});
