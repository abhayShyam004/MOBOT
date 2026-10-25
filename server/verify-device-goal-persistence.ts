// Physical-device verification script for Samsung Galaxy A07 (Phase 8)
// Tests durable goal persistence, recovery across host restarts, milestone progression,
// drift prevention, and bot isolation on real Android hardware.

import { execSync } from "node:child_process";

const PREVIEW_PORT = 28889; // Forwarded to 18789 on Samsung Galaxy A07
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

interface DeviceScenarioReport {
  scenarioNumber: number;
  name: string;
  verdict: "PASS" | "FAIL";
  details: string;
  evidence: Record<string, unknown>;
}

async function runDeviceVerification(): Promise<void> {
  const reports: DeviceScenarioReport[] = [];
  console.log("=== PHASE 8 PHYSICAL-DEVICE VERIFICATION: SAMSUNG GALAXY A07 ===");

  // 0. Verify device connectivity and host health
  const healthRes = await fetch(`${BASE_URL}/api/health`, {
    headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
  });
  const healthData = (await healthRes.json()) as Record<string, unknown>;
  console.log(`Live host health:`, healthData);
  if (!healthRes.ok || healthData.app !== "openmausbot") {
    throw new Error(`Device host not responding properly on port ${PREVIEW_PORT}`);
  }

  // Get active bots
  const botsRes = await fetch(`${BASE_URL}/api/bots`, {
    headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
  });
  const botsData = (await botsRes.json()) as { bots: Array<{ id: string; name: string }> };
  if (!botsData.bots || botsData.bots.length < 2) {
    throw new Error("Need at least 2 bots on device for isolation testing");
  }
  const botA = botsData.bots[0];
  const botB = botsData.bots[1];
  console.log(`Using Bot A: ${botA.name} (${botA.id})`);
  console.log(`Using Bot B: ${botB.name} (${botB.id})`);

  let createdGoalId = "";
  let milestone0Id = "";
  let milestone1Id = "";

  // Scenario 1: Create an original goal through the intended execution path
  try {
    const createRes = await fetch(`${BASE_URL}/api/bots/${botA.id}/canonical-goals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: `127.0.0.1:${PREVIEW_PORT}`,
      },
      body: JSON.stringify({
        originatingPrompt: "Perform battery and memory profile on Samsung Galaxy A07",
        formalObjective: "Collect system battery and heap metrics under load",
        constraints: ["Do not reboot physical device", "Spend cap $0.00"],
        successCriteria: [
          "Battery level recorded",
          "Heap memory sampled",
          "Report synthesized",
        ],
        milestones: [
          { title: "Sample battery state" },
          { title: "Query heap stats" },
          { title: "Generate benchmark summary" },
        ],
      }),
    });

    const createData = (await createRes.json()) as { canonicalGoal?: any; error?: string };
    if (!createRes.ok || !createData.canonicalGoal) {
      throw new Error(`Failed to create canonical goal: ${createData.error || createRes.statusText}`);
    }

    const g = createData.canonicalGoal;
    createdGoalId = g.id;
    milestone0Id = g.milestones[0].id;
    milestone1Id = g.milestones[1].id;

    const pass =
      g.botId === botA.id &&
      g.formalObjective === "Collect system battery and heap metrics under load" &&
      g.milestones.length === 3 &&
      g.activeMilestoneIndex === 0 &&
      g.milestones[0].status === "active";

    reports.push({
      scenarioNumber: 1,
      name: "Create original canonical goal on device",
      verdict: pass ? "PASS" : "FAIL",
      details: `Created CanonicalGoalRecord ${g.id} with 3 milestones; milestone 0 active`,
      evidence: { id: g.id, activeMilestoneIndex: g.activeMilestoneIndex, milestonesCount: g.milestones.length },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 1,
      name: "Create original canonical goal on device",
      verdict: "FAIL",
      details: err.message,
      evidence: {},
    });
  }

  // Scenario 2: Verify stable identity and persisted representation
  try {
    const getRes = await fetch(`${BASE_URL}/api/bots/${botA.id}/canonical-goals/${createdGoalId}`, {
      headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
    });
    const getData = (await getRes.json()) as { canonicalGoal?: any };
    const g = getData.canonicalGoal;

    const pass =
      getRes.ok &&
      g &&
      g.id === createdGoalId &&
      g.botId === botA.id &&
      g.originatingPrompt === "Perform battery and memory profile on Samsung Galaxy A07" &&
      g.constraints.length === 2 &&
      g.successCriteria.length === 3;

    reports.push({
      scenarioNumber: 2,
      name: "Verify stable identity and persisted representation",
      verdict: pass ? "PASS" : "FAIL",
      details: `Retrieved goal matches all persisted fields without drift`,
      evidence: { id: g?.id, formalObjective: g?.formalObjective },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 2,
      name: "Verify stable identity and persisted representation",
      verdict: "FAIL",
      details: err.message,
      evidence: {},
    });
  }

  // Scenario 3: Milestone progression and replanning retention
  try {
    const updateRes = await fetch(
      `${BASE_URL}/api/bots/${botA.id}/canonical-goals/${createdGoalId}/milestones/${milestone0Id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Host: `127.0.0.1:${PREVIEW_PORT}`,
        },
        body: JSON.stringify({ status: "completed" }),
      }
    );

    const updateData = (await updateRes.json()) as { canonicalGoal?: any };
    const g = updateData.canonicalGoal;

    const pass =
      updateRes.ok &&
      g &&
      g.milestones[0].status === "completed" &&
      typeof g.milestones[0].verifiedAt === "number" &&
      g.activeMilestoneIndex === 1 &&
      g.milestones[1].status === "active" &&
      g.formalObjective === "Collect system battery and heap metrics under load"; // Retained!

    reports.push({
      scenarioNumber: 3,
      name: "Milestone progression & replanning retention",
      verdict: pass ? "PASS" : "FAIL",
      details: `Milestone 0 completed, activeMilestoneIndex advanced to 1, formalObjective preserved`,
      evidence: { activeMilestoneIndex: g?.activeMilestoneIndex, verifiedAt: g?.milestones[0]?.verifiedAt },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 3,
      name: "Milestone progression & replanning retention",
      verdict: "FAIL",
      details: err.message,
      evidence: {},
    });
  }

  // Scenario 4: Non-destructive preview host process restart
  let newPid = 0;
  try {
    const oldPid = Number(healthData.pid);
    console.log(`Current preview host PID: ${oldPid}. Triggering non-destructive process restart...`);
    execSync(`adb shell "run-as com.openmausbot.companion.preview kill ${oldPid}"`);

    // Wait for HarnessHost to respawn the Node.js process
    let attempts = 0;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 1000));
      attempts++;
      try {
        const checkRes = await fetch(`${BASE_URL}/api/health`, {
          headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
        });
        if (checkRes.ok) {
          const checkData = (await checkRes.json()) as Record<string, unknown>;
          if (checkData.pid && checkData.pid !== oldPid) {
            newPid = Number(checkData.pid);
            console.log(`Preview host respawned with new PID: ${newPid} in ${attempts}s`);
            break;
          }
        }
      } catch {}
    }

    const pass = newPid > 0 && newPid !== oldPid;
    reports.push({
      scenarioNumber: 4,
      name: "Non-destructive preview host process restart",
      verdict: pass ? "PASS" : "FAIL",
      details: `Preview host restarted successfully: PID ${oldPid} -> PID ${newPid}`,
      evidence: { oldPid, newPid, respawnSeconds: attempts },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 4,
      name: "Non-destructive preview host process restart",
      verdict: "FAIL",
      details: err.message,
      evidence: {},
    });
  }

  // Scenario 5: Post-restart goal retrieval and resumption from active milestone
  try {
    const resumeRes = await fetch(`${BASE_URL}/api/bots/${botA.id}/canonical-goals/${createdGoalId}/resume`, {
      headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
    });
    const resumeData = (await resumeRes.json()) as {
      goal?: any;
      activeMilestone?: any;
      activeIndex?: number;
    };

    const g = resumeData.goal;
    const m = resumeData.activeMilestone;

    const pass =
      resumeRes.ok &&
      g &&
      g.id === createdGoalId &&
      resumeData.activeIndex === 1 &&
      m &&
      m.id === milestone1Id &&
      m.status === "active" &&
      g.milestones[0].status === "completed"; // Completed milestone 0 was preserved across crash!

    reports.push({
      scenarioNumber: 5,
      name: "Post-restart recovery from active milestone",
      verdict: pass ? "PASS" : "FAIL",
      details: `Retrieved goal from disk on new process PID ${newPid}; resumed from milestone index 1 without loss`,
      evidence: {
        activeIndex: resumeData.activeIndex,
        activeMilestoneTitle: m?.title,
        milestone0Status: g?.milestones[0]?.status,
      },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 5,
      name: "Post-restart recovery from active milestone",
      verdict: "FAIL",
      details: err.message,
      evidence: {},
    });
  }

  // Scenario 6: Strict bot isolation across separate bots
  try {
    // Bot B should have empty canonical goals (or at least not contain Bot A's goal)
    const botBRes = await fetch(`${BASE_URL}/api/bots/${botB.id}/canonical-goals`, {
      headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
    });
    const botBData = (await botBRes.json()) as { canonicalGoals?: any[] };

    const botBHasA = (botBData.canonicalGoals || []).some((g) => g.id === createdGoalId);

    // Cross-bot fetch: accessing Bot A's goal using Bot B's route must return 404
    const crossFetchRes = await fetch(`${BASE_URL}/api/bots/${botB.id}/canonical-goals/${createdGoalId}`, {
      headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
    });

    const pass = !botBHasA && crossFetchRes.status === 404;
    reports.push({
      scenarioNumber: 6,
      name: "Strict bot isolation across separate bots",
      verdict: pass ? "PASS" : "FAIL",
      details: `Bot B cannot see Bot A's goal in listing; cross-bot GET returned HTTP 404`,
      evidence: { botBGoalCount: botBData.canonicalGoals?.length, crossFetchStatus: crossFetchRes.status },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 6,
      name: "Strict bot isolation across separate bots",
      verdict: "FAIL",
      details: err.message,
      evidence: {},
    });
  }

  // Scenario 7: Invariant protection & mutation rejection
  try {
    const tamperRes = await fetch(`${BASE_URL}/api/bots/${botA.id}/canonical-goals/${createdGoalId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Host: `127.0.0.1:${PREVIEW_PORT}`,
      },
      body: JSON.stringify({
        formalObjective: "Tampered intermediate sub-task objective",
      }),
    });

    const tamperData = (await tamperRes.json()) as { error?: string };
    const pass =
      tamperRes.status === 400 &&
      tamperData.error &&
      tamperData.error.includes("formalObjective is immutable");

    reports.push({
      scenarioNumber: 7,
      name: "Invariant protection against goal drift overwrites",
      verdict: pass ? "PASS" : "FAIL",
      details: `Server rejected formalObjective mutation with HTTP 400: ${tamperData.error}`,
      evidence: { httpStatus: tamperRes.status, error: tamperData.error },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 7,
      name: "Invariant protection against goal drift overwrites",
      verdict: "FAIL",
      details: err.message,
      evidence: {},
    });
  }

  // Scenario 8: Process stability & official app preservation
  try {
    const finalHealthRes = await fetch(`${BASE_URL}/api/health`, {
      headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
    });
    const finalHealthData = (await finalHealthRes.json()) as Record<string, unknown>;

    // Verify official app process in ADB
    const psOutput = execSync(`adb shell "ps -ef | grep openmausbot"`).toString();
    const officialAppAlive = psOutput.includes("com.openmausbot.companion") && psOutput.includes("25192");

    const pass = finalHealthRes.ok && finalHealthData.pid === newPid && officialAppAlive;
    reports.push({
      scenarioNumber: 8,
      name: "Process stability & official app preservation",
      verdict: pass ? "PASS" : "FAIL",
      details: `Preview host responsive on PID ${newPid}; Official app PID 25192 untouched and running`,
      evidence: { previewPid: finalHealthData.pid, officialAppPreserved: officialAppAlive },
    });
  } catch (err: any) {
    reports.push({
      scenarioNumber: 8,
      name: "Process stability & official app preservation",
      verdict: "FAIL",
      details: err.message,
      evidence: {},
    });
  }

  // Cleanup created test goal
  try {
    await fetch(`${BASE_URL}/api/bots/${botA.id}/canonical-goals/${createdGoalId}`, {
      method: "DELETE",
      headers: { Host: `127.0.0.1:${PREVIEW_PORT}` },
    });
    console.log(`Cleaned up test canonical goal: ${createdGoalId}`);
  } catch {}

  console.log("\n=== PHYSICAL-DEVICE VERIFICATION RESULTS ===");
  let passedCount = 0;
  for (const r of reports) {
    console.log(`[Scenario ${r.scenarioNumber}] ${r.verdict}: ${r.name} - ${r.details}`);
    if (r.verdict === "PASS") passedCount++;
  }
  console.log(`\nOverall Physical-Device Acceptance: ${passedCount === reports.length ? "PASS" : "FAIL"} (${passedCount}/${reports.length})`);
}

runDeviceVerification().catch((err) => {
  console.error("Fatal error during device verification:", err);
  process.exit(1);
});
