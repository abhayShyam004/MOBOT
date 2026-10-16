import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableTaskEngine } from "./durable-task-engine.ts";
import { GeneralProcessManager } from "./process-manager.ts";

describe("Phase 3: Durable Task Engine & Lifecycle Suite", () => {
  let tempDir: string;
  let procMgr: GeneralProcessManager;
  let engine: DurableTaskEngine;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omb-durable-test-"));
    procMgr = new GeneralProcessManager(tempDir);
    engine = new DurableTaskEngine(tempDir, procMgr);
  });

  afterEach(() => {
    engine.stopSupervisor();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. Task persistence: creates task and persists atomically to disk", () => {
    const task = engine.createTask({
      goal: "Analyze long-term telemetry metrics",
      botId: "bot_123",
      threadId: "thread_456",
      initialMilestones: ["Gather raw metrics", "Generate digest"],
    });

    expect(task.id).toMatch(/^task_\d+_/);
    expect(task.status).toBe("CREATED");
    expect(task.goal).toBe("Analyze long-term telemetry metrics");
    expect(task.pendingWork).toHaveLength(2);

    const taskFile = join(tempDir, ".mobot", "tasks", `${task.id}.json`);
    expect(existsSync(taskFile)).toBe(true);

    const raw = JSON.parse(readFileSync(taskFile, "utf8"));
    expect(raw.id).toBe(task.id);
    expect(raw.status).toBe("CREATED");

    // Fresh engine instance reloads from disk
    const freshEngine = new DurableTaskEngine(tempDir);
    const loaded = freshEngine.getTask(task.id);
    expect(loaded).toBeDefined();
    expect(loaded?.goal).toBe(task.goal);
  });

  it("2. Lifecycle transitions: follows strict explicit states", () => {
    const task = engine.createTask({ goal: "Multi-phase pipeline" });
    expect(task.status).toBe("CREATED");

    engine.startPlanning(task.id, "plan_alpha");
    expect(engine.getTask(task.id)?.status).toBe("PLANNING");
    expect(engine.getTask(task.id)?.planId).toBe("plan_alpha");

    engine.startRunning(task.id, "step_1");
    expect(engine.getTask(task.id)?.status).toBe("RUNNING");
    expect(engine.getTask(task.id)?.currentStepId).toBe("step_1");

    engine.updateProgress(task.id, {
      progressPercent: 30,
      milestoneCompleted: {
        id: "ms_1",
        title: "Step 1 complete",
        description: "Verified step 1 output",
        evidence: "SHA256: abcdef123456",
      },
    });
    expect(engine.getTask(task.id)?.completedMilestones).toHaveLength(1);
    expect(engine.getTask(task.id)?.progressPercent).toBe(30);

    engine.pauseTask(task.id);
    expect(engine.getTask(task.id)?.status).toBe("PAUSED");

    engine.resumeTask(task.id);
    expect(engine.getTask(task.id)?.status).toBe("RUNNING");
  });

  it("3. Task wait & timeout: enters WAITING state and supervisor resumes after timer expires", async () => {
    const task = engine.createTask({ goal: "Wait for deployment" });
    engine.startRunning(task.id, "deploy_step");

    engine.setWaiting(task.id, {
      durationSeconds: 1, // 1s wait
      reason: "Waiting for container warmup",
      nextAction: "probe_endpoint",
    });

    const waitingTask = engine.getTask(task.id);
    expect(waitingTask?.status).toBe("WAITING");
    expect(waitingTask?.waitState?.reason).toBe("Waiting for container warmup");
    expect(waitingTask?.waitState?.nextAction).toBe("probe_endpoint");

    // Fast-forward or trigger supervisor tick after delay
    await new Promise((r) => setTimeout(r, 1100));
    await engine.supervisorTick();

    const resumedTask = engine.getTask(task.id);
    expect(resumedTask?.status).toBe("RUNNING");
    expect(resumedTask?.waitState).toBeUndefined();
    expect(resumedTask?.progressMessage).toContain("Ready to execute: probe_endpoint");
  });

  it("4. Approval checkpoints: preserves state in AWAITING_APPROVAL and handles human decision", () => {
    const task = engine.createTask({ goal: "Modify database schema" });
    engine.startRunning(task.id, "migration_step");

    const approval = engine.requestApproval(task.id, {
      action: "DROP TABLE legacy_users",
      reason: "Table deprecated",
      impact: "Irreversible data deletion",
      stepId: "migration_step",
    });

    expect(approval.status).toBe("pending");
    expect(engine.getTask(task.id)?.status).toBe("AWAITING_APPROVAL");

    // Test rejection branch on a second task
    const task2 = engine.createTask({ goal: "Dangerous action" });
    engine.startRunning(task2.id);
    const appr2 = engine.requestApproval(task2.id, {
      action: "rm -rf /",
      reason: "Cleanup",
      impact: "Severe",
    });
    engine.decideApproval(task2.id, appr2.id, false, "Security risk");
    expect(engine.getTask(task2.id)?.status).toBe("FAILED");

    // Test approval branch
    engine.decideApproval(task.id, approval.id, true, "Approved by admin");
    const approvedTask = engine.getTask(task.id);
    expect(approvedTask?.status).toBe("RUNNING");
    expect(approvedTask?.approvals[0].status).toBe("approved");
  });

  it("5. Cancellation: cleanly terminates associated background processes and marks CANCELLED", async () => {
    const proc = await procMgr.startProcess({
      command: "sleep",
      args: ["10"],
      cwd: tempDir,
      tag: "test_daemon",
    });

    const task = engine.createTask({ goal: "Run daemon task" });
    engine.startRunning(task.id);
    engine.updateProgress(task.id, {
      addedProcessId: proc.id,
      progressPercent: 50,
      milestoneCompleted: {
        id: "ms_start",
        title: "Started daemon",
        description: "Daemon running in background",
      },
    });

    await engine.cancelTask(task.id, "User requested cancellation");

    const cancelledTask = engine.getTask(task.id);
    expect(cancelledTask?.status).toBe("CANCELLED");
    expect(cancelledTask?.completedMilestones).toHaveLength(1);
    expect(cancelledTask?.finalResult?.success).toBe(false);

    // Process should be stopped
    const inspected = await procMgr.inspectProcess(proc.id);
    expect(inspected?.state).toBe("STOPPED");
  });

  it("6. Restart recovery: recovers running tasks after host restart without discarding milestones", async () => {
    const task = engine.createTask({ goal: "Long-running multi-day computation" });
    engine.startRunning(task.id, "chunk_4");
    engine.updateProgress(task.id, {
      progressPercent: 40,
      milestoneCompleted: {
        id: "chunk_1",
        title: "Processed chunk 1",
        description: "Verified checksum",
      },
    });
    engine.updateProgress(task.id, {
      milestoneCompleted: {
        id: "chunk_2",
        title: "Processed chunk 2",
        description: "Verified checksum",
      },
    });

    // Simulate host crash and restart with a fresh engine instance
    const restartedEngine = new DurableTaskEngine(tempDir, procMgr);
    const result = await restartedEngine.reconcileTasksOnStartup(tempDir);

    expect(result.reconciledCount).toBe(1);
    expect(result.activeTasks).toHaveLength(1);

    const recovered = restartedEngine.getTask(task.id);
    expect(recovered?.status).toBe("RUNNING");
    expect(recovered?.completedMilestones).toHaveLength(2);
    expect(recovered?.observations.some((o) => o.source === "reconciler")).toBe(true);
  });

  it("7. Process crash detection: supervisor detects crashed background process and enters RECOVERING", async () => {
    // Start a process that exits immediately with non-zero code
    const proc = await procMgr.startProcess({
      command: "sh",
      args: ["-c", "exit 2"],
      cwd: tempDir,
      tag: "failing_worker",
    });

    const task = engine.createTask({ goal: "Worker pipeline" });
    engine.startRunning(task.id, "run_worker");
    engine.updateProgress(task.id, {
      addedProcessId: proc.id,
    });

    // Allow process to exit
    await new Promise((r) => setTimeout(r, 300));
    await engine.supervisorTick();

    const recoveringTask = engine.getTask(task.id);
    expect(recoveringTask?.status).toBe("RECOVERING");
    expect(recoveringTask?.failures).toHaveLength(1);
    expect(recoveringTask?.failures[0].error).toContain(proc.id);
  });

  it("8. Completion verification gate: rejects completion if criteria unverified, succeeds with empirical proof", () => {
    const task = engine.createTask({ goal: "Synthesize report and deliver" });
    engine.startRunning(task.id);

    // Attempt completion with an unverified criterion
    const rejected = engine.completeTask(
      task.id,
      [
        { id: "crit_1", description: "File exists", verified: true },
        { id: "crit_2", description: "SHA-256 matches", verified: false },
      ],
      "Partial completion"
    );

    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain("verification criteria failed");
    expect(engine.getTask(task.id)?.status).toBe("RUNNING");

    // Proper empirical verification with all criteria satisfied
    const accepted = engine.completeTask(
      task.id,
      [
        { id: "crit_1", description: "File exists", verified: true, evidence: "files/data.csv (240 bytes)" },
        { id: "crit_2", description: "SHA-256 matches", verified: true, evidence: "SHA256: 6a8f... verified" },
      ],
      "All criteria verified",
      ["art_report_123"]
    );

    expect(accepted.ok).toBe(true);
    expect(accepted.task.status).toBe("COMPLETED");
    expect(accepted.task.progressPercent).toBe(100);
    expect(accepted.task.finalVerification?.verified).toBe(true);
    expect(accepted.task.finalResult?.deliveredArtifacts).toEqual(["art_report_123"]);
  });

  it("9. Notification triggers: dispatches appropriate notifications for milestone, approval, and completion", () => {
    const notifications: Array<{ kind: string; title: string }> = [];
    engine.setNotificationSink((n) => notifications.push(n));

    const task = engine.createTask({ goal: "Monitored build" });
    engine.startRunning(task.id);

    // 1. Approval notification
    engine.requestApproval(task.id, {
      action: "Deploy to production",
      reason: "Ready for release",
      impact: "Live user traffic",
    });
    expect(notifications.some((n) => n.kind === "approval")).toBe(true);

    // 2. Failure notification
    engine.setRecovering(task.id, {
      error: "Port collision 8080",
      diagnosis: "Port in use by other process",
    });
    expect(notifications.some((n) => n.kind === "turn-failed")).toBe(true);

    // 3. Completion notification
    engine.completeTask(
      task.id,
      [{ id: "crit_done", description: "Done", verified: true }],
      "Successfully built and verified"
    );
    expect(notifications.some((n) => n.kind === "done")).toBe(true);
  });
});
