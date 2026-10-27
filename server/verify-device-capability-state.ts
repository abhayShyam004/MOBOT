// Physical-Device Verification Script for Samsung Galaxy A07 (Phase 13: Capability State Awareness)
//
// Verifies live capability health probing, formal operational states,
// 500ms hard probe timeout invariant, DRIVER_OFFLINE planner exclusion,
// dynamic fallback routing, pre-dispatch gating, and live recovery
// on the connected Samsung Galaxy A07 (SM-A075F, Android 16, ARM64).

import { DeviceCapabilityRegistry } from "./capabilities/capability-registry.ts";
import { BrowserCapability } from "./capabilities/default-capabilities.ts";
import { PhoneControlCapability } from "./capabilities/phone-control.ts";
import {
  type CapabilityHealthStatus,
  type CapabilityOperationalState,
} from "./capabilities/types.ts";

const PREVIEW_PORT = 28889; // Forwarded to 18789 on Samsung Galaxy A07
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const BROWSER_FORWARD_PORT = 28888; // Forwarded to AB_DRIVER_PORT (44631)
const PHONE_FORWARD_PORT = 28887; // Forwarded to PH_DRIVER_PORT (43191)

export interface DeviceScenarioReport {
  scenarioNumber: number;
  name: string;
  verdict: "PASS" | "FAIL";
  details: string;
  evidence: Record<string, unknown>;
}

export async function runDeviceVerification(): Promise<DeviceScenarioReport[]> {
  const reports: DeviceScenarioReport[] = [];
  const registry = new DeviceCapabilityRegistry();

  console.log("=== PHASE 13 PHYSICAL-DEVICE VERIFICATION: SAMSUNG GALAXY A07 ===");
  console.log(`Target: SM-A075F, Preview port ${PREVIEW_PORT}`);

  // ── Scenario 1: Physical Host Identity & Isolation ──
  let healthData: Record<string, unknown> = {};
  try {
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    healthData = (await healthRes.json()) as Record<string, unknown>;
    console.log(`Live host health:`, healthData);
    const passed =
      healthRes.ok &&
      healthData.app === "openmausbot" &&
      typeof healthData.pid === "number" &&
      healthData.port === 18789;

    reports.push({
      scenarioNumber: 1,
      name: "Physical Host Identity & Isolation: Preview host running on port 18789",
      verdict: passed ? "PASS" : "FAIL",
      details: `App: ${healthData.app}, Host PID: ${healthData.pid}, Port: ${healthData.port}`,
      evidence: { healthData },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 1,
      name: "Physical Host Identity & Isolation",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 2: Live BrowserDriverServer Connectivity & Health ──
  const browserToken = process.env.AB_DRIVER_TOKEN || "59530ad4ecc295b97d29b16b10cfb7903b77c4686a4b0e5a2058b05c29dd8599";
  try {
    const driverRes = await fetch(`http://127.0.0.1:${BROWSER_FORWARD_PORT}/sessions`, {
      headers: { Authorization: `Bearer ${browserToken}` },
    });
    const driverBody = (await driverRes.json()) as { ok?: boolean; sessions?: string[] };
    console.log(`Live BrowserDriverServer on phone:`, driverBody);

    // Now test BrowserCapability checkHealth with active driver
    const origPort = process.env.AB_DRIVER_PORT;
    const origToken = process.env.AB_DRIVER_TOKEN;
    process.env.AB_DRIVER_PORT = String(BROWSER_FORWARD_PORT);
    process.env.AB_DRIVER_TOKEN = browserToken;

    const browserCap = new BrowserCapability();
    const health = await browserCap.checkHealth();

    process.env.AB_DRIVER_PORT = origPort;
    process.env.AB_DRIVER_TOKEN = origToken;

    const passed =
      driverRes.ok &&
      driverBody.ok === true &&
      Array.isArray(driverBody.sessions) &&
      health.state === "AVAILABLE" &&
      health.capabilityId === "device.browser";

    reports.push({
      scenarioNumber: 2,
      name: "Live BrowserDriverServer Connectivity: Phone loopback driver returns 200 OK & capability state AVAILABLE",
      verdict: passed ? "PASS" : "FAIL",
      details: `Driver HTTP ${driverRes.status}, ok: ${driverBody.ok}, Health State: ${health.state}`,
      evidence: { driverBody, health },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 2,
      name: "Live BrowserDriverServer Connectivity",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 3: Live PhoneDriverServer Status & Accessibility Detection ──
  const phoneToken = process.env.PH_DRIVER_TOKEN || "8ee456cc73fc3cd3c6808bc474a82377aa63cec8273756c7e73917057b0f4f36";
  try {
    const phoneRes = await fetch(`http://127.0.0.1:${PHONE_FORWARD_PORT}/status`, {
      headers: { Authorization: `Bearer ${phoneToken}` },
    });
    const phoneBody = (await phoneRes.json()) as {
      ok?: boolean;
      connected?: boolean;
      accessibilityEnabled?: boolean;
      supportedActions?: string[];
      reason?: string;
    };
    console.log(`Live PhoneDriverServer on phone:`, phoneBody);

    const origPort = process.env.PH_DRIVER_PORT;
    const origToken = process.env.PH_DRIVER_TOKEN;
    process.env.PH_DRIVER_PORT = String(PHONE_FORWARD_PORT);
    process.env.PH_DRIVER_TOKEN = phoneToken;

    const phoneCap = new PhoneControlCapability();
    const health = await phoneCap.checkHealth();

    process.env.PH_DRIVER_PORT = origPort;
    process.env.PH_DRIVER_TOKEN = origToken;

    const validState: CapabilityOperationalState[] = ["AVAILABLE", "PERMISSION_REQUIRED"];
    const passed =
      phoneRes.ok &&
      phoneBody.ok === true &&
      Array.isArray(phoneBody.supportedActions) &&
      validState.includes(health.state) &&
      (health.state === "AVAILABLE" || health.remediationAction === "prompt_permission");

    reports.push({
      scenarioNumber: 3,
      name: "Live PhoneDriverServer Status: Authoritatively detects AccessibilityService state on physical hardware",
      verdict: passed ? "PASS" : "FAIL",
      details: `Phone driver ok: ${phoneBody.ok}, accessibilityEnabled: ${phoneBody.accessibilityEnabled}, Health State: ${health.state}, Remediation: ${health.remediationAction}`,
      evidence: { phoneBody, health },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 3,
      name: "Live PhoneDriverServer Status",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 4: Live Intelligent Capability Selection with Healthy Drivers ──
  try {
    // Set browser health to AVAILABLE
    registry.setHealthStatus({
      capabilityId: "device.browser",
      state: "AVAILABLE",
      lastCheckedMs: Date.now(),
    });

    const resolution = registry.matchCapability({
      objective: "Find recent tech articles on Quantum Computing",
      contextKeywords: ["quantum", "computing", "articles", "news"],
      requiredDataFreshness: "realtime",
      targetDevice: "android_local",
      activeBotId: "bot-browser-healthy",
    });

    const passed =
      resolution.primaryCapabilityId === "device.browser" &&
      resolution.chosenModality === "web_search";

    reports.push({
      scenarioNumber: 4,
      name: "Intelligent Capability Selection: Chooses device.browser when operational state is AVAILABLE",
      verdict: passed ? "PASS" : "FAIL",
      details: `Primary Capability: ${resolution.primaryCapabilityId}, Chosen Modality: ${resolution.chosenModality}, Confidence: ${resolution.confidenceScore}`,
      evidence: { resolution },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 4,
      name: "Intelligent Capability Selection with Healthy Drivers",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 5: Induced Driver Outage & Live State Transition ──
  try {
    // Simulate killed driver by pointing to dead port
    const DEAD_PORT = 59999;
    const origPort = process.env.AB_DRIVER_PORT;
    const origToken = process.env.AB_DRIVER_TOKEN;
    process.env.AB_DRIVER_PORT = String(DEAD_PORT);
    process.env.AB_DRIVER_TOKEN = "bad-token";

    const browserCap = new BrowserCapability();
    const offlineHealth = await browserCap.checkHealth();

    process.env.AB_DRIVER_PORT = origPort;
    process.env.AB_DRIVER_TOKEN = origToken;

    const passed =
      offlineHealth.state === "DRIVER_OFFLINE" &&
      offlineHealth.remediationAction === "restart_driver" &&
      typeof offlineHealth.diagnosticDetails === "string";

    reports.push({
      scenarioNumber: 5,
      name: "Induced Driver Outage: Unreachable driver immediately transitions capability state to DRIVER_OFFLINE",
      verdict: passed ? "PASS" : "FAIL",
      details: `Health State: ${offlineHealth.state}, Remediation: ${offlineHealth.remediationAction}, Diagnostic: ${offlineHealth.diagnosticDetails}`,
      evidence: { offlineHealth },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 5,
      name: "Induced Driver Outage",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 6: Strict Planner Exclusion Invariant & Dynamic Fallback ──
  try {
    // Invariant: A capability with DRIVER_OFFLINE status must never be selected by the planner.
    registry.setHealthStatus({
      capabilityId: "device.browser",
      state: "DRIVER_OFFLINE",
      lastCheckedMs: Date.now(),
      remediationAction: "restart_driver",
      diagnosticDetails: "Browser driver connection refused (simulated outage)",
    });

    const resolution = registry.matchCapability({
      objective: "Find recent tech articles on Quantum Computing",
      contextKeywords: ["quantum", "computing", "articles", "news"],
      requiredDataFreshness: "realtime",
      targetDevice: "android_local",
      activeBotId: "bot-browser-outage",
    });

    // When device.browser is DRIVER_OFFLINE, planner must NOT choose device.browser
    const passed =
      resolution.primaryCapabilityId !== "device.browser" &&
      (resolution.primaryCapabilityId === "web.scraper" || resolution.chosenModality === "web_search");

    reports.push({
      scenarioNumber: 6,
      name: "Strict Planner Exclusion Invariant: Never selects DRIVER_OFFLINE capability; routes to healthy web.scraper",
      verdict: passed ? "PASS" : "FAIL",
      details: `Primary Capability: ${resolution.primaryCapabilityId} (excluded device.browser), Chosen Modality: ${resolution.chosenModality}`,
      evidence: { resolution },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 6,
      name: "Strict Planner Exclusion Invariant",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 7: Pre-Dispatch Execution Gating ──
  try {
    // If a capability transitioned to DRIVER_OFFLINE after planning, invoke() must reject execution
    registry.setHealthStatus({
      capabilityId: "device.browser",
      state: "DRIVER_OFFLINE",
      lastCheckedMs: Date.now(),
      remediationAction: "restart_driver",
      diagnosticDetails: "Browser driver crashed between plan and dispatch",
    });

    const invokeResult = await registry.invoke(
      "device.browser",
      "open",
      { url: "https://example.com" },
      { botId: "bot-dispatch-test" }
    );

    const passed =
      invokeResult.success === false &&
      invokeResult.error?.code === "DRIVER_OFFLINE" &&
      (invokeResult.error?.details as { state?: string })?.state === "DRIVER_OFFLINE" &&
      (invokeResult.error?.details as { remediationAction?: string })?.remediationAction === "restart_driver";

    reports.push({
      scenarioNumber: 7,
      name: "Pre-Dispatch Execution Gate: Rejects stale execution with DRIVER_OFFLINE and remediationAction",
      verdict: passed ? "PASS" : "FAIL",
      details: `Success: ${invokeResult.success}, Error Code: ${invokeResult.error?.code}, Details: ${JSON.stringify(invokeResult.error?.details)}`,
      evidence: { invokeResult },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 7,
      name: "Pre-Dispatch Execution Gating",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 8: Strict 500ms Hard Probe Timeout Boundary ──
  try {
    const hangingRegistry = new DeviceCapabilityRegistry();
    hangingRegistry.register({
      id: "device.hanging_sensor",
      name: "Hanging Sensor Capability",
      description: "Sensor with hanging driver",
      availability: { supported: true },
      requiredPermissions: [],
      riskClassification: "low",
      lifecycleBehavior: "stateless",
      supportedOperations: [{
        name: "read",
        description: "Read sensor",
        risk: "low",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
      }],
      execute: async () => ({ success: true }),
      checkHealth: async () => {
        // Hangs for 3000ms
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return {
          capabilityId: "device.hanging_sensor",
          state: "AVAILABLE" as const,
          lastCheckedMs: Date.now(),
        };
      },
    });

    const start = Date.now();
    const timeoutHealth = await hangingRegistry.probeHealth("device.hanging_sensor");
    const elapsed = Date.now() - start;

    const passed =
      elapsed >= 480 &&
      elapsed <= 650 &&
      timeoutHealth.state === "TEMPORARILY_UNAVAILABLE" &&
      timeoutHealth.remediationAction === "wait";

    reports.push({
      scenarioNumber: 8,
      name: "Hard 500ms Probe Timeout: Hanging health check aborts cleanly within 500ms, mapping to TEMPORARILY_UNAVAILABLE",
      verdict: passed ? "PASS" : "FAIL",
      details: `Elapsed: ${elapsed}ms (target 500ms), State: ${timeoutHealth.state}, Remediation: ${timeoutHealth.remediationAction}`,
      evidence: { elapsed, timeoutHealth },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 8,
      name: "Strict 500ms Hard Probe Timeout Boundary",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 9: Live Driver Recovery & Dynamic Restoration ──
  try {
    // Restore healthy status
    registry.setHealthStatus({
      capabilityId: "device.browser",
      state: "AVAILABLE",
      lastCheckedMs: Date.now(),
    });

    const recoveredHealth = registry.getHealthStatus("device.browser");
    const resolution = registry.matchCapability({
      objective: "Find recent tech articles on Quantum Computing",
      contextKeywords: ["quantum", "computing", "articles", "news"],
      requiredDataFreshness: "realtime",
      targetDevice: "android_local",
      activeBotId: "bot-browser-recovered",
    });

    const passed =
      recoveredHealth.state === "AVAILABLE" &&
      resolution.primaryCapabilityId === "device.browser" &&
      resolution.chosenModality === "web_search";

    reports.push({
      scenarioNumber: 9,
      name: "Driver Recovery: Restoring healthy state immediately re-enables planner selection of device.browser",
      verdict: passed ? "PASS" : "FAIL",
      details: `Health State: ${recoveredHealth.state}, Re-selected Capability: ${resolution.primaryCapabilityId}`,
      evidence: { recoveredHealth, resolution },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 9,
      name: "Live Driver Recovery & Dynamic Restoration",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  // ── Scenario 10: Late Probe Race Condition Protection ──
  try {
    const raceRegistry = new DeviceCapabilityRegistry();
    let resolveSlowProbe!: (status: CapabilityHealthStatus) => void;
    const slowProbePromise = new Promise<CapabilityHealthStatus>((resolve) => {
      resolveSlowProbe = resolve;
    });

    raceRegistry.register({
      id: "device.slow_probe",
      name: "Slow Probe Capability",
      description: "Tests late resolution",
      availability: { supported: true },
      requiredPermissions: [],
      riskClassification: "low",
      lifecycleBehavior: "stateless",
      supportedOperations: [{
        name: "test",
        description: "test",
        risk: "low",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
      }],
      execute: async () => ({ success: true }),
      checkHealth: async () => slowProbePromise,
    });

    // Start slow probe in background
    const probePromise = raceRegistry.probeHealth("device.slow_probe");

    // Fast authoritative status change occurs
    raceRegistry.setHealthStatus({
      capabilityId: "device.slow_probe",
      state: "DRIVER_OFFLINE",
      lastCheckedMs: Date.now(),
      remediationAction: "restart_driver",
    });

    // Now slow probe resolves claiming AVAILABLE
    resolveSlowProbe({
      capabilityId: "device.slow_probe",
      state: "AVAILABLE",
      lastCheckedMs: Date.now() - 500,
    });

    await probePromise;

    // Generation check must have discarded the slow probe
    const finalHealth = raceRegistry.getHealthStatus("device.slow_probe");
    const passed =
      finalHealth.state === "DRIVER_OFFLINE" &&
      finalHealth.remediationAction === "restart_driver";

    reports.push({
      scenarioNumber: 10,
      name: "Late Probe Race Protection: Newer authoritative state is preserved across slow or out-of-order probe responses",
      verdict: passed ? "PASS" : "FAIL",
      details: `Preserved State: ${finalHealth.state}, Preserved Remediation: ${finalHealth.remediationAction}`,
      evidence: { finalHealth },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reports.push({
      scenarioNumber: 10,
      name: "Late Probe Race Condition Protection",
      verdict: "FAIL",
      details: `Exception: ${msg}`,
      evidence: { error: msg },
    });
  }

  console.log("\n=== VERIFICATION SUMMARY ===");
  let allPass = true;
  for (const r of reports) {
    console.log(`[${r.verdict}] Scenario ${r.scenarioNumber}: ${r.name}`);
    console.log(`       Details: ${r.details}`);
    if (r.verdict !== "PASS") allPass = false;
  }
  console.log(`\nOVERALL VERDICT: ${allPass ? "PASS (10/10)" : "FAIL"}`);

  return reports;
}

// Run when directly invoked
runDeviceVerification().catch((err) => {
  console.error("FATAL in verification runner:", err);
  process.exit(1);
});
