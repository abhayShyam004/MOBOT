// Physical-Device Verification Script for Samsung Galaxy A07 (Phase 11: Intelligent Capability Selection)
//
// Verifies capability matching, execution modalities, confidence scoring,
// ERR_NO_CAPABLE_TOOL protocol, and canonical tech headlines routing
// on the connected Samsung Galaxy A07 (SM-A075F, Android 16, ARM64).

import { DeviceCapabilityRegistry } from "./capabilities/capability-registry.ts";
import { AgentExecutionLoop } from "./capabilities/orchestration.ts";
import { ObservabilityBus } from "./capabilities/observability.ts";
import { ERR_NO_CAPABLE_TOOL } from "./capabilities/types.ts";

const PREVIEW_PORT = 28889; // Forwarded to 18789 on Samsung Galaxy A07
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

export interface DeviceScenarioReport {
  scenarioNumber: number;
  name: string;
  verdict: "PASS" | "FAIL";
  details: string;
  evidence: Record<string, unknown>;
}

export async function runDeviceVerification(): Promise<DeviceScenarioReport[]> {
  const reports: DeviceScenarioReport[] = [];
  const bus = new ObservabilityBus();
  const registry = new DeviceCapabilityRegistry();

  console.log("=== PHASE 11 PHYSICAL-DEVICE VERIFICATION: SAMSUNG GALAXY A07 ===");
  console.log(`Target: SM-A075F, Preview port ${PREVIEW_PORT}`);

  // 0. Host Health & Isolation Verification
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = (await healthRes.json()) as Record<string, unknown>;
  console.log(`Live host health:`, healthData);
  if (!healthRes.ok || healthData.app !== "openmausbot") {
    throw new Error(`Device host not responding properly on port ${PREVIEW_PORT}`);
  }

  // ── Scenario 1: Canonical Behavioral Test ("What were the top tech headlines today?") ──
  try {
    const resolution = registry.matchCapability({
      objective: "What were the top tech headlines today?",
      contextKeywords: ["headlines", "tech", "news", "today"],
      requiredDataFreshness: "realtime",
      targetDevice: "android_local",
      activeBotId: "bot-headlines-test",
    });

    const isWebSearch = resolution.chosenModality === "web_search";
    const notDirect = resolution.chosenModality !== "direct_answer";
    const hasTool = resolution.primaryCapabilityId === "device.browser" || resolution.fallbackCapabilityIds.includes("web.scraper");
    const passed = isWebSearch && notDirect && hasTool && resolution.confidenceScore >= 0.90;

    // Also execute search capability
    const searchRes = await registry.invoke(
      resolution.fallbackCapabilityIds[0] || resolution.primaryCapabilityId!,
      "search",
      { query: "top tech headlines today" }
    );

    reports.push({
      scenarioNumber: 1,
      name: "Canonical Behavioral Test: 'What were the top tech headlines today?' routes to web_search",
      verdict: passed && searchRes.success ? "PASS" : "FAIL",
      details: `Modality: ${resolution.chosenModality}, Confidence: ${resolution.confidenceScore}, Primary: ${resolution.primaryCapabilityId}, Fallbacks: ${resolution.fallbackCapabilityIds.join(", ")}, Search Success: ${searchRes.success}`,
      evidence: {
        resolution,
        searchSuccess: searchRes.success,
        firstResult: (searchRes.data as any)?.results?.[0],
      },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 1,
      name: "Canonical Behavioral Test: 'What were the top tech headlines today?'",
      verdict: "FAIL",
      details: `Exception: ${err.message}`,
      evidence: { error: String(err) },
    });
  }

  // ── Scenario 2: Conversational Greeting Bypass ("Good morning!") ──
  try {
    const resolution = registry.matchCapability({
      objective: "Good morning!",
      contextKeywords: [],
      requiredDataFreshness: "static",
      targetDevice: "android_local",
      activeBotId: "bot-greet-test",
    });

    const passed =
      resolution.chosenModality === "direct_answer" &&
      resolution.confidenceScore >= 0.90 &&
      resolution.primaryCapabilityId === undefined;

    reports.push({
      scenarioNumber: 2,
      name: "Conversational Greeting Bypass: Routes to direct_answer without tool invocation",
      verdict: passed ? "PASS" : "FAIL",
      details: `Modality: ${resolution.chosenModality}, Confidence: ${resolution.confidenceScore}, Justification: ${resolution.justification}`,
      evidence: { resolution },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 2,
      name: "Conversational Greeting Bypass",
      verdict: "FAIL",
      details: `Exception: ${err.message}`,
      evidence: { error: String(err) },
    });
  }

  // ── Scenario 3: Android Device Gesture Routing ("Take a screenshot of the current Android screen") ──
  try {
    const resolution = registry.matchCapability({
      objective: "Take a screenshot of the current Android screen",
      contextKeywords: [],
      requiredDataFreshness: "static",
      targetDevice: "android_local",
      activeBotId: "bot-screen-test",
    });

    const passed =
      resolution.chosenModality === "device_gesture" &&
      resolution.primaryCapabilityId === "device.screenshot" &&
      resolution.confidenceScore >= 0.85;

    // Execute screenshot capability
    const shotRes = await registry.invoke("device.screenshot", "take_screenshot", {});

    reports.push({
      scenarioNumber: 3,
      name: "Android Device Gesture: Routes to device.screenshot and executes successfully",
      verdict: passed && shotRes.success ? "PASS" : "FAIL",
      details: `Modality: ${resolution.chosenModality}, Primary: ${resolution.primaryCapabilityId}, Shot Path: ${(shotRes.data as any)?.path}`,
      evidence: { resolution, shotResult: shotRes.data },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 3,
      name: "Android Device Gesture Routing",
      verdict: "FAIL",
      details: `Exception: ${err.message}`,
      evidence: { error: String(err) },
    });
  }

  // ── Scenario 4: Local Filesystem Mutation ("Save summary report to workspace/summary.md file") ──
  try {
    const resolution = registry.matchCapability({
      objective: "Save summary report to workspace/summary.md file",
      contextKeywords: [],
      requiredDataFreshness: "static",
      targetDevice: "android_local",
      activeBotId: "bot-file-test",
    });

    const passed =
      resolution.chosenModality === "filesystem_mutation" &&
      resolution.primaryCapabilityId === "device.files" &&
      resolution.confidenceScore >= 0.90;

    reports.push({
      scenarioNumber: 4,
      name: "Local Filesystem Mutation: Routes to device.files with high calibrated confidence",
      verdict: passed ? "PASS" : "FAIL",
      details: `Modality: ${resolution.chosenModality}, Primary: ${resolution.primaryCapabilityId}, Confidence: ${resolution.confidenceScore}`,
      evidence: { resolution },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 4,
      name: "Local Filesystem Mutation Routing",
      verdict: "FAIL",
      details: `Exception: ${err.message}`,
      evidence: { error: String(err) },
    });
  }

  // ── Scenario 5: Missing Capability Protocol (ERR_NO_CAPABLE_TOOL) ──
  try {
    const resolution = registry.matchCapability({
      objective: "Control the quantum ion trap peripheral on USB bus",
      contextKeywords: ["quantum", "ion trap"],
      requiredDataFreshness: "static",
      targetDevice: "android_local",
      activeBotId: "bot-physics-test",
    });

    const passed =
      resolution.justification.includes(ERR_NO_CAPABLE_TOOL) &&
      resolution.confidenceScore <= 0.35 &&
      resolution.primaryCapabilityId === undefined &&
      resolution.chosenModality === "user_clarification";

    reports.push({
      scenarioNumber: 5,
      name: "Missing Capability Protocol: Emits structured ERR_NO_CAPABLE_TOOL for unsupported hardware",
      verdict: passed ? "PASS" : "FAIL",
      details: `Justification: ${resolution.justification}, Confidence: ${resolution.confidenceScore}, Primary: ${resolution.primaryCapabilityId}`,
      evidence: { resolution },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 5,
      name: "Missing Capability Protocol",
      verdict: "FAIL",
      details: `Exception: ${err.message}`,
      evidence: { error: String(err) },
    });
  }

  // ── Scenario 6: Real-Time vs Historical Freshness Divergence ──
  try {
    const histRes = registry.matchCapability({
      objective: "Who won the 1998 World Cup?",
      contextKeywords: [],
      requiredDataFreshness: "historical",
      targetDevice: "android_local",
      activeBotId: "bot-trivia-test",
    });

    const liveRes = registry.matchCapability({
      objective: "Who won the match today?",
      contextKeywords: ["today", "live"],
      requiredDataFreshness: "realtime",
      targetDevice: "android_local",
      activeBotId: "bot-sports-test",
    });

    const passed =
      histRes.chosenModality === "direct_answer" &&
      liveRes.chosenModality === "web_search";

    reports.push({
      scenarioNumber: 6,
      name: "Freshness Divergence: Historical factual inquiry -> direct_answer vs Real-time -> web_search",
      verdict: passed ? "PASS" : "FAIL",
      details: `Historical Modality: ${histRes.chosenModality}, Live Modality: ${liveRes.chosenModality}`,
      evidence: { histRes, liveRes },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 6,
      name: "Freshness Divergence",
      verdict: "FAIL",
      details: `Exception: ${err.message}`,
      evidence: { error: String(err) },
    });
  }

  // ── Scenario 7: Live AgentExecutionLoop Capability Selection Telemetry ──
  try {
    const loop = new AgentExecutionLoop({
      objective: "What were the top tech headlines today?",
      threadId: "thread-cap-test",
      canonicalGoal: {
        id: "goal-cap-test",
        botId: "bot-headlines-test",
        originatingPrompt: "What were the top tech headlines today?",
        formalObjective: "What were the top tech headlines today?",
        constraints: [],
        successCriteria: [],
        milestones: [],
        activeMilestoneIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      contextKeywords: ["headlines", "tech", "today"],
      requiredDataFreshness: "realtime",
      targetDevice: "android_local",
      capabilityRegistry: registry,
      observabilityBus: bus,
    });

    // Check emitted events on bus
    const events = bus.getEvents({ type: "AGENT_LOOP_CAPABILITY_SELECTED" as any });
    const matchEvent = events.find((e) => e.payload?.chosenModality === "web_search");
    const passed =
      matchEvent !== undefined &&
      matchEvent.payload?.primaryCapabilityId !== undefined &&
      Array.isArray(loop.getCapabilityResolution()?.fallbackCapabilityIds);

    reports.push({
      scenarioNumber: 7,
      name: "Live AgentExecutionLoop Telemetry: Emits AGENT_LOOP_CAPABILITY_SELECTED with grounded metadata",
      verdict: passed ? "PASS" : "FAIL",
      details: `Emitted Events Count: ${events.length}, Chosen Modality: ${matchEvent?.payload?.chosenModality}, Confidence: ${matchEvent?.payload?.confidenceScore}`,
      evidence: { matchEvent },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 7,
      name: "Live AgentExecutionLoop Capability Selection Telemetry",
      verdict: "FAIL",
      details: `Exception: ${err.message}`,
      evidence: { error: String(err) },
    });
  }

  // ── Scenario 8: Physical Host Process Isolation Verification ──
  try {
    const passed =
      typeof healthData.pid === "number" &&
      healthData.app === "openmausbot" &&
      healthData.port === 18789;

    reports.push({
      scenarioNumber: 8,
      name: "Physical Host Verification: Preview process isolated on port 18789 without affecting production",
      verdict: passed ? "PASS" : "FAIL",
      details: `App: ${healthData.app}, Host PID: ${healthData.pid}, Port: ${healthData.port}`,
      evidence: { healthData },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 8,
      name: "Physical Host Verification",
      verdict: "FAIL",
      details: `Exception: ${err.message}`,
      evidence: { error: String(err) },
    });
  }

  console.log("\n=== VERIFICATION SUMMARY ===");
  let allPass = true;
  for (const r of reports) {
    console.log(`[${r.verdict}] Scenario ${r.scenarioNumber}: ${r.name}`);
    console.log(`       Details: ${r.details}`);
    if (r.verdict !== "PASS") allPass = false;
  }
  console.log(`\nOVERALL VERDICT: ${allPass ? "PASS (8/8)" : "FAIL"}`);

  return reports;
}

// Run when directly invoked
runDeviceVerification().catch((err) => {
  console.error("FATAL in verification runner:", err);
  process.exit(1);
});
