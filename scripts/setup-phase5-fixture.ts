import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ADB = "adb";

function runAdb(cmd: string): string {
  return execSync(`${ADB} ${cmd}`, { encoding: "utf8" });
}

function runAdbSh(shCmd: string): string {
  const escaped = shCmd.replace(/'/g, "'\\''");
  return execSync(`${ADB} shell 'run-as com.openmausbot.companion sh -c "${escaped}"'`, { encoding: "utf8" });
}

async function main() {
  console.log("Setting up Phase 5 Persistence Fixture on Samsung Galaxy A07...");

  // 1. Prepare Bot 2 and Bot 1 data in bots.json
  const bot1Id = "3b2c1b10-48d9-4a6a-ae1c-5fcf9731623a";
  const bot2Id = "7c3f8921-99ab-4c3d-8e4a-91bf2847d012";
  const conv1ThreadId = "68442bd4-f584-4dc7-87ee-b22e804fd048";
  const conv2ThreadId = "8d4e9231-11ba-4f2e-9d3b-02ca3958e123";

  // Check current bots.json
  const currentBotsRaw = runAdbSh("cat files/host/data/bots.json");
  const parsedBots = JSON.parse(currentBotsRaw);
  const botsList = Array.isArray(parsedBots) ? parsedBots : (parsedBots.bots || []);

  let bot1 = botsList.find((b: any) => b.id === bot1Id);
  if (!bot1) {
    bot1 = {
      id: bot1Id,
      threadId: conv1ThreadId,
      name: "Olive",
      title: "Core Companion",
      description: "Default persistent companion bot",
      soul: "Helpful, concise, disciplined AI assistant",
      soulHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      notifications: true,
      color: "green",
      unread: false,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      createdAt: 1792267918880,
      busy: false,
      activity: "idle",
      avatarUrl: null,
      tasks: [],
      messages: [],
      activeLeafId: null
    };
    botsData.bots.push(bot1);
  }

  // Ensure Bot 1 has messages and task
  if (!bot1.tasks || bot1.tasks.length === 0) {
    bot1.tasks = [{
      threadId: conv1ThreadId,
      title: "System Initialization & Status",
      createdAt: 1792267918880,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      unread: false,
      titleFromFirstMessage: true,
      cwd: `/data/user/0/com.openmausbot.companion/files/host/data/task-workspaces/${bot1Id}/${conv1ThreadId}`,
      busy: false,
      activity: "idle",
      lastMessageAt: 1792319780633
    }];
  }

  // Ensure Bot 2 (Atlas) exists
  let bot2 = botsList.find((b: any) => b.id === bot2Id);
  if (!bot2) {
    bot2 = {
      id: bot2Id,
      threadId: conv2ThreadId,
      name: "Atlas",
      title: "Senior Systems Architect",
      description: "Specialist in distributed systems, offline verification, and state migration",
      soul: "Rigorous systems architect focusing on zero data loss and deterministic updates",
      soulHash: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
      notifications: true,
      color: "indigo",
      unread: false,
      modelSelection: { instanceId: "openaiCompat", model: "meta-llama/llama-3.3-70b-instruct" },
      createdAt: 1792340000000,
      busy: false,
      activity: "idle",
      avatarUrl: null,
      tasks: [
        {
          threadId: conv2ThreadId,
          title: "Architecture Specification Review",
          createdAt: 1792340000000,
          modelSelection: { instanceId: "openaiCompat", model: "meta-llama/llama-3.3-70b-instruct" },
          unread: false,
          titleFromFirstMessage: true,
          cwd: `/data/user/0/com.openmausbot.companion/files/host/data/task-workspaces/${bot2Id}/${conv2ThreadId}`,
          busy: false,
          activity: "idle",
          lastMessageAt: 1792340100000
        }
      ]
    };
    botsList.push(bot2);
  }

  // Push updated bots.json to device
  writeFileSync("/tmp/bots_fixture.json", JSON.stringify(botsList, null, 2));
  runAdb("push /tmp/bots_fixture.json /data/local/tmp/bots_fixture.json");
  runAdbSh("cp /data/local/tmp/bots_fixture.json files/host/data/bots.json && chmod 600 files/host/data/bots.json");

  // 2. Setup Bot Workspaces and Memory Files
  runAdbSh(`mkdir -p files/host/data/workspaces/${bot1Id}/memory files/host/data/workspaces/${bot2Id}/memory`);

  const bot1Memory = "# Memory for Olive\n\n- User preferred theme: Dark OLED Minimalist\n- Communication policy: Zero emojis strictly enforced\n- Update policy: Verified in-place updates with automated snapshots\n";
  const bot2Memory = "# Memory for Atlas\n\n- Role: Senior Systems Architect\n- Focus: State preservation across Android PackageInstaller handoff\n- Invariant: UI State == Persisted State == Runtime Execution\n";

  writeFileSync("/tmp/mem1.md", bot1Memory);
  writeFileSync("/tmp/mem2.md", bot2Memory);
  runAdb("push /tmp/mem1.md /data/local/tmp/mem1.md");
  runAdb("push /tmp/mem2.md /data/local/tmp/mem2.md");
  runAdbSh(`cp /data/local/tmp/mem1.md files/host/data/workspaces/${bot1Id}/MEMORY.md`);
  runAdbSh(`cp /data/local/tmp/mem2.md files/host/data/workspaces/${bot2Id}/MEMORY.md`);

  // 3. Create Artifacts and Attachments
  const artifactContent = JSON.stringify({
    artifact: "phase5_system_baseline",
    version: "1.0.0",
    schemaVersion: 1,
    verifiedAt: 1792340500000,
    metrics: { storageEngine: "SQLite + Atomic JSON", concurrency: "single-threaded-host" }
  }, null, 2);
  const artifactHash = createHash("sha256").update(artifactContent).digest("hex");

  const pdfPlaceholder = "%PDF-1.4\n%MOBOT Architecture Spec v1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\nxref\n0 2\n0000000000 65535 f\n0000000010 00000 n\ntrailer<</Size 2/Root 1 0 R>>\nstartxref\n60\n%%EOF\n";
  const pdfHash = createHash("sha256").update(pdfPlaceholder).digest("hex");

  writeFileSync("/tmp/artifact.json", artifactContent);
  writeFileSync("/tmp/arch.pdf", pdfPlaceholder);
  runAdb("push /tmp/artifact.json /data/local/tmp/artifact.json");
  runAdb("push /tmp/arch.pdf /data/local/tmp/arch.pdf");
  runAdbSh(`cp /data/local/tmp/artifact.json files/host/data/workspaces/${bot1Id}/verification-report.json`);
  runAdbSh(`cp /data/local/tmp/arch.pdf files/host/data/workspaces/${bot2Id}/architecture_spec_v1.pdf`);

  // 4. Update config.json with Mixed Permissions, Provider Config, App Settings, Schema v1 (prior to v2 update test)
  const currentConfigRaw = runAdbSh("cat files/host/data/config.json");
  const configData = JSON.parse(currentConfigRaw);

  configData.profile = {
    name: "Technical Verification User",
    email: "verification@mobot.internal"
  };
  configData.defaultModelSelection = {
    instanceId: "codex",
    model: "gpt-5.6-sol"
  };
  configData.agentPermissions = {
    terminal: "granted",
    filesystem: "granted",
    browser: "denied",
    composio: "granted"
  };
  // Ensure schemaVersion is 1 before test update migration to 2
  configData.schemaVersion = 1;
  configData.neverAskPermissions = true;
  configData.updater = {
    channel: "stable",
    autoCheck: true,
    lastCheckedAt: new Date().toISOString(),
    repo: "abhayShyam004/MOBOT"
  };

  writeFileSync("/tmp/config_fixture.json", JSON.stringify(configData, null, 2));
  runAdb("push /tmp/config_fixture.json /data/local/tmp/config_fixture.json");
  runAdbSh("cp /data/local/tmp/config_fixture.json files/host/data/config.json && chmod 600 files/host/data/config.json");

  // 5. Update goals.json
  const goalsData = {
    version: 1,
    goals: [
      {
        id: "goal-phase5-verification",
        botId: bot1Id,
        title: "Phase 5 Self-Updating Release Acceptance",
        objective: "Execute safe in-place APK upgrade with complete state preservation",
        motivation: "Ensure 100% data integrity and zero data loss on real hardware",
        status: "active",
        progress: 75,
        milestones: [
          {
            id: "ms-1",
            title: "Persistence Fixture Setup",
            completed: true,
            tasks: [{ id: "t-1", title: "Generate snapshot", status: "completed" }]
          },
          {
            id: "ms-2",
            title: "Physical Package Installation",
            completed: false,
            tasks: [{ id: "t-2", title: "Verify Android PackageInstaller", status: "pending" }]
          }
        ],
        blockers: [],
        relevantMemories: ["Zero emojis strictly enforced", "Automated snapshots before update"],
        relevantDocuments: ["files/host/data/workspaces/" + bot1Id + "/verification-report.json"],
        associatedSpecialists: [bot2Id],
        createdAt: 1792340000000,
        updatedAt: 1792340600000
      }
    ]
  };
  writeFileSync("/tmp/goals_fixture.json", JSON.stringify(goalsData, null, 2));
  runAdb("push /tmp/goals_fixture.json /data/local/tmp/goals_fixture.json");
  runAdbSh("cp /data/local/tmp/goals_fixture.json files/host/data/goals.json && chmod 600 files/host/data/goals.json");

  // 6. Update watches.json
  const watchesData = {
    version: 1,
    watches: [
      {
        id: "watch-github-releases",
        botId: bot1Id,
        target: "https://github.com/abhayShyam004/MOBOT/releases",
        condition: "New official version release available",
        source: "web",
        cadenceMinutes: 60,
        status: "active",
        lastChecked: 1792340000000,
        lastKnownState: "tag:v1.0.0",
        currentState: "tag:v1.0.0",
        notificationPolicy: "on_change",
        history: [
          {
            at: 1792340000000,
            state: "tag:v1.0.0",
            triggered: false,
            note: "Stable release v1.0.0 active"
          }
        ],
        createdAt: 1792340000000,
        updatedAt: 1792340000000
      }
    ]
  };
  writeFileSync("/tmp/watches_fixture.json", JSON.stringify(watchesData, null, 2));
  runAdb("push /tmp/watches_fixture.json /data/local/tmp/watches_fixture.json");
  runAdbSh("cp /data/local/tmp/watches_fixture.json files/host/data/watches.json && chmod 600 files/host/data/watches.json");

  // 7. Update routines.json (Automations)
  const routinesRaw = runAdbSh("cat files/host/data/routines.json");
  const routinesData = JSON.parse(routinesRaw);
  const testRoutineId = "routine-daily-health";
  let existing = routinesData.routines.find((r: any) => r.id === testRoutineId);
  if (!existing) {
    routinesData.routines.push({
      id: testRoutineId,
      routineId: "routine-daily-health-def",
      routineName: "System Health and Backup Verification",
      prompt: "Check disk integrity and verify recent safety backups.",
      durationMinutes: 15,
      attachments: [],
      target: "bot",
      botId: bot1Id,
      runOn: "maus",
      scheduledFor: 1792340000000,
      status: "completed",
      manual: false,
      triggerSource: "schedule",
      resultsThreadId: conv1ThreadId,
      createdAt: 1792340000000,
      threadId: conv1ThreadId,
      startedAt: 1792340001000,
      output: "Health check OK: persistent storage nominal, safety snapshots online.",
      finishedAt: 1792340005000,
      itemsFound: 1,
      itemsDelivered: 1,
      suppressedNotification: false,
      verificationStatus: "verified",
      deliveredFingerprints: ["sha256-verified-health-fingerprint"]
    });
    writeFileSync("/tmp/routines_fixture.json", JSON.stringify(routinesData, null, 2));
    runAdb("push /tmp/routines_fixture.json /data/local/tmp/routines_fixture.json");
    runAdbSh("cp /data/local/tmp/routines_fixture.json files/host/data/routines.json && chmod 600 files/host/data/routines.json");
  }

  console.log("Fixture creation completed successfully!");
  console.log(`Bot 1: ${bot1.name} (${bot1Id})`);
  console.log(`Bot 2: ${bot2.name} (${bot2Id})`);
  console.log(`Artifact 1 Hash: ${artifactHash}`);
  console.log(`PDF Attachment Hash: ${pdfHash}`);
}

main().catch(err => {
  console.error("Setup failed:", err);
  process.exit(1);
});
