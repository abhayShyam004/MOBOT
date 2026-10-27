// Tasks: a bot's separate contexts.
//
// The load-bearing property is isolation — each task keeps its own
// transcript AND its own provider session. If resume cursors leaked
// between tasks, a "fresh" task would silently resume the previous
// conversation, which is the exact thing tasks exist to prevent.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;

async function freshStore() {
  home = mkdtempSync(join(tmpdir(), "omb-tasks-"));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  const { Store, UNTITLED_TASK, UNTITLED_THREAD, titleFromMessage } = await import("./store.ts");
  return { store: new Store(() => ({ instanceId: "claude", model: "m" })), UNTITLED_TASK, UNTITLED_THREAD, titleFromMessage };
}

afterEach(async () => {
  // freshStore resets the module graph, so this closes the same SQLite
  // module instance that the freshly imported Store used.
  const { closeMessageDb } = await import("./message-db.ts");
  closeMessageDb();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("tasks", () => {
  it("gives every new bot one task pointing at its thread", async () => {
    const { store, UNTITLED_THREAD } = await freshStore();
    const bot = store.createBot();
    expect(store.tasks(bot.id)).toHaveLength(1);
    expect(store.activeTask(bot.id)).toMatchObject({ threadId: bot.threadId, title: UNTITLED_THREAD });
  });

  it("starts a new task on a fresh thread and makes it active", async () => {
    const { store } = await freshStore();
    const bot = store.createBot();
    const firstThread = bot.threadId;
    const task = store.createTask(bot.id)!;

    expect(task.threadId).not.toBe(firstThread);
    expect(store.bot(bot.id)!.threadId).toBe(task.threadId);
    expect(store.tasks(bot.id).map((t) => t.threadId)).toEqual([task.threadId, firstThread]);
    // a brand new context: nothing carried over from the greeting thread
    expect(store.messagesFor(task.threadId)).toHaveLength(0);
    expect(store.messagesFor(firstThread).length).toBeGreaterThan(0);
  });

  it("can create a detached routine task without changing the visible conversation", async () => {
    const { store } = await freshStore();
    const bot = store.createBot();
    const visibleThread = bot.threadId;
    const routineTask = store.createTask(bot.id, "Morning brief", false)!;

    expect(routineTask.threadId).not.toBe(visibleThread);
    expect(store.bot(bot.id)!.threadId).toBe(visibleThread);
    expect(store.botByThread(routineTask.threadId)?.id).toBe(bot.id);

    store.setResumeCursor(bot.id, "claude", "routine-session", routineTask.threadId);
    expect(store.taskByThread(bot.id, routineTask.threadId)?.resumeCursors.claude).toBe("routine-session");
    expect(store.activeTask(bot.id)?.resumeCursors.claude).toBeUndefined();
  });

  it("keeps provider sessions apart — the whole point of a task", async () => {
    const { store } = await freshStore();
    const bot = store.createBot();
    const first = bot.threadId;
    store.setResumeCursor(bot.id, "claude", "session-one");

    const second = store.createTask(bot.id)!;
    // the new task must NOT inherit the old session
    expect(store.activeTask(bot.id)!.resumeCursors.claude).toBeUndefined();
    store.setResumeCursor(bot.id, "claude", "session-two");

    store.switchTask(bot.id, first);
    expect(store.activeTask(bot.id)!.resumeCursors.claude).toBe("session-one");
    store.switchTask(bot.id, second.threadId);
    expect(store.activeTask(bot.id)!.resumeCursors.claude).toBe("session-two");
  });

  it("names a task after the first thing you asked it", async () => {
    const { store, UNTITLED_THREAD, titleFromMessage } = await freshStore();
    const bot = store.createBot();
    store.createTask(bot.id);
    expect(store.activeTask(bot.id)!.title).toBe(UNTITLED_THREAD);

    store.titleTaskFromFirstMessage(bot.id, "Audit the payroll spreadsheet\nand flag anything odd");
    expect(store.activeTask(bot.id)!.title).toBe("Audit the payroll spreadsheet");

    // only the first message names it
    store.titleTaskFromFirstMessage(bot.id, "something else entirely");
    expect(store.activeTask(bot.id)!.title).toBe("Audit the payroll spreadsheet");
    expect(titleFromMessage("x".repeat(80))).toHaveLength(48);
  });

  it("returns the task it named, so a caller knows which title it may replace", async () => {
    const { store } = await freshStore();
    const bot = store.createBot();
    const task = store.createTask(bot.id)!;
    const titled = store.titleTaskFromFirstMessage(bot.id, "Audit the payroll", task.threadId);
    expect(titled?.threadId).toBe(task.threadId);
    expect(titled?.title).toBe("Audit the payroll");
    // nothing more to name once the row carries a title
    expect(store.titleTaskFromFirstMessage(bot.id, "a second message", task.threadId)).toBeNull();
  });

  it("cannot be re-armed by restoring the sentinel title after the first attempt", async () => {
    const { store } = await freshStore();
    const bot = store.createBot();
    const task = store.createTask(bot.id)!;
    store.titleTaskFromFirstMessage(bot.id, "Audit the payroll", task.threadId);
    // a person renames the row back to a sentinel: the first message
    // already had its naming attempt, so a later message cannot retitle it
    store.renameTask(bot.id, task.threadId, "New thread");
    expect(store.titleTaskFromFirstMessage(bot.id, "a follow-up message", task.threadId)).toBeNull();
    expect(store.activeTask(bot.id)!.title).toBe("New thread");
  });

  it("swaps a machine-made title for a generated one, exactly once", async () => {
    const { store } = await freshStore();
    const bot = store.createBot();
    const task = store.createTask(bot.id)!;
    const snippet = store.titleTaskFromFirstMessage(bot.id, "Audit the payroll", task.threadId)!.title;
    // a person's rename wins over anything generated later
    store.renameTask(bot.id, task.threadId, "Payroll audit");
    expect(store.retitleTask(bot.id, task.threadId, snippet, "Payroll checks")).toBeNull();
    expect(store.activeTask(bot.id)!.title).toBe("Payroll audit");
    // and where nothing intervened, the generated title lands once — a
    // second answer aimed at the same snippet finds nothing to replace
    const other = store.createTask(bot.id)!;
    const otherSnippet = store.titleTaskFromFirstMessage(bot.id, "Draft the announcement", other.threadId)!.title;
    expect(store.retitleTask(bot.id, other.threadId, otherSnippet, "Draft announcement")).toMatchObject({ threadId: other.threadId });
    expect(store.retitleTask(bot.id, other.threadId, otherSnippet, "A second opinion")).toBeNull();
    expect(store.taskByThread(bot.id, other.threadId)!.title).toBe("Draft announcement");
  });

  it("reads a usable title out of a model reply", async () => {
    const { titleFromLlm } = await import("./store.ts");
    expect(titleFromLlm('"Fix login timeout."\n')).toBe("Fix login timeout");
    expect(titleFromLlm("Fix the login\nthat is the whole answer")).toBe("Fix the login");
    expect(titleFromLlm("Fix   the\tlogin")).toBe("Fix the login");
    expect(titleFromLlm("\u201CFix login timeout\u201D")).toBe("Fix login timeout");
    expect(titleFromLlm("## Fix login")).toBe("Fix login");
    expect(titleFromLlm('"## Deploy app"')).toBe("Deploy app");
    expect(titleFromLlm("# Room deploy plan")).toBe("Room deploy plan");
    expect(titleFromLlm("- Fix the login flow")).toBe("Fix the login flow");
    expect(titleFromLlm("**Deploy the app**")).toBe("Deploy the app");
    expect(titleFromLlm("")).toBeNull();
    expect(titleFromLlm("   \n  ")).toBeNull();
    expect(titleFromLlm(`${"word".repeat(13)}`)).toBeNull();
  });

  it("deletes a task with its transcript and replaces the last one with fresh context", async () => {
    const { store, UNTITLED_THREAD } = await freshStore();
    const bot = store.createBot();
    const first = bot.threadId;
    const second = store.createTask(bot.id)!;
    store.appendMessage(second.threadId, { role: "user", kind: "text", text: "secret" });

    expect(store.deleteTask(bot.id, second.threadId)).toBeTruthy();
    expect(store.tasks(bot.id)).toHaveLength(1);
    // deleting the ACTIVE task falls back to one that still exists
    expect(store.bot(bot.id)!.threadId).toBe(first);
    expect(store.messagesFor(second.threadId)).toHaveLength(0);

    store.appendMessage(first, { role: "user", kind: "text", text: "Finished work" });
    store.setResumeCursor(bot.id, "claude", "old-session");
    store.patchTask(bot.id, first, {
      title: "Finished work", rewound: true, pinnedMessageId: "old-pin", unread: true,
      modelSelection: { instanceId: "codex", model: "thread-only-override" },
    });
    expect(store.deleteTask(bot.id, first)).toBeTruthy();
    expect(store.tasks(bot.id)).toHaveLength(1);
    const replacement = store.activeTask(bot.id)!;
    expect(replacement.threadId).not.toBe(first);
    expect(replacement).toMatchObject({
      title: UNTITLED_THREAD, resumeCursors: {}, modelSelection: bot.modelSelection,
      busy: false, unread: false, activity: "idle",
    });
    expect(replacement.pinnedMessageId).toBeUndefined();
    expect(replacement.rewound).toBeUndefined();
    expect(bot.resumeCursors).toEqual({});
    expect(bot.pinnedMessageId).toBeUndefined();
    expect(bot.unread).toBe(false);
    expect(store.messagesFor(first)).toHaveLength(0);
    expect(store.messagesFor(replacement.threadId)).toHaveLength(0);
    expect(store.deleteTask(bot.id, first)).toBeNull();
    const { Store } = await import("./store.ts");
    const reloaded = new Store(() => ({ instanceId: "claude", model: "m" }));
    expect(reloaded.bot(bot.id)?.threadId).toBe(replacement.threadId);
    expect(reloaded.tasks(bot.id)).toHaveLength(1);
    expect(reloaded.messagesFor(replacement.threadId)).toHaveLength(0);
  });

  it("deletes a task's event logs along with its transcript", async () => {
    const { store } = await freshStore();
    const bot = store.createBot();
    const first = bot.threadId;
    const second = store.createTask(bot.id)!;
    const { EVENTS_DIR, NATIVE_DIR } = await import("./config.ts");
    for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${first}.ndjson`), "{}\n");
      writeFileSync(join(dir, `${second.threadId}.ndjson`), "{}\n");
    }

    expect(store.deleteTask(bot.id, second.threadId)).toBeTruthy();

    for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
      expect(existsSync(join(dir, `${second.threadId}.ndjson`))).toBe(false);
      // the surviving task keeps its logs
      expect(existsSync(join(dir, `${first}.ndjson`))).toBe(true);
    }
  });

  it("deleting a bot removes every member thread's event logs", async () => {
    const { store } = await freshStore();
    const bot = store.createBot();
    const original = bot.threadId;
    const extra = store.createTask(bot.id)!;
    const { EVENTS_DIR, NATIVE_DIR } = await import("./config.ts");
    for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${original}.ndjson`), "{}\n");
      writeFileSync(join(dir, `${extra.threadId}.ndjson`), "{}\n");
    }

    expect(store.deleteBot(bot.id)).toBe(true);

    for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
      for (const threadId of [original, extra.threadId]) {
        expect(existsSync(join(dir, `${threadId}.ndjson`))).toBe(false);
      }
    }
  });

  it("adopts a pre-tasks bot's endless thread as its first task", async () => {
    const { store, UNTITLED_TASK } = await freshStore();
    const bot = store.createBot();
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Plan the offsite" });
    // simulate a record saved before tasks existed
    const legacy = store.bot(bot.id)!;
    delete (legacy as { tasks?: unknown }).tasks;
    // patchBot persists, so what lands on disk is the pre-tasks shape
    store.patchBot(bot.id, { resumeCursors: { claude: "old-session" } });

    const { Store } = await import("./store.ts");
    const reloaded = new Store(() => ({ instanceId: "claude", model: "m" }));
    const migrated = reloaded.tasks(bot.id);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ threadId: bot.threadId, resumeCursors: { claude: "old-session" } });
    // and it is named from the conversation rather than left blank
    expect(migrated[0]!.title).not.toBe(UNTITLED_TASK);
  });
});

describe("PersistentAgentJobs (Phase 21)", () => {
  let tempDir: string;
  let jobsFile: string;
  let journalFile: string;
  let checkpointsDir: string;
  let clockTime = 1715000000000;
  const mockClock = () => clockTime;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    tempDir = mkdtempSync(join(tmpdir(), "p21-jobs-test-"));
    jobsFile = join(tempDir, "jobs.json");
    journalFile = join(tempDir, "job-journal.jsonl");
    checkpointsDir = join(tempDir, "checkpoints");
    clockTime = 1715000000000;
  });

  afterEach(async () => {
    const { rmSync } = await import("node:fs");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("validates compliant and non-compliant PersistentAgentJob schemas", async () => {
    const { validatePersistentAgentJob } = await import("./tasks.ts");

    const valid = {
      jobId: "job-001",
      botId: "bot-alpha",
      threadId: "thread-xyz",
      title: "Deploy API Cluster",
      objective: "Set up and verify high-availability k8s API nodes",
      state: "QUEUED" as const,
      progressPercent: 0,
      currentMilestoneIndex: 0,
      checkpointPayloadPath: join(checkpointsDir, "job-001", "milestone-0.json"),
      createdAtMs: 1715000000000,
      updatedAtMs: 1715000000000,
    };
    expect(validatePersistentAgentJob(valid, checkpointsDir)).toBe(true);

    // Rejects non-object
    expect(validatePersistentAgentJob(null, checkpointsDir)).toBe(false);
    expect(validatePersistentAgentJob("not-a-job", checkpointsDir)).toBe(false);

    // Rejects invalid progress bounds
    expect(validatePersistentAgentJob({ ...valid, progressPercent: 120 }, checkpointsDir)).toBe(false);
    expect(validatePersistentAgentJob({ ...valid, progressPercent: -5 }, checkpointsDir)).toBe(false);

    // Rejects invalid milestone index
    expect(validatePersistentAgentJob({ ...valid, currentMilestoneIndex: -1 }, checkpointsDir)).toBe(false);

    // Rejects path traversal attempt in checkpointPayloadPath
    expect(
      validatePersistentAgentJob(
        { ...valid, checkpointPayloadPath: "/etc/passwd" },
        checkpointsDir
      )
    ).toBe(false);

    // Rejects completedAtMs on QUEUED/RUNNING job
    expect(validatePersistentAgentJob({ ...valid, completedAtMs: 1715000001000 }, checkpointsDir)).toBe(false);

    // Requires completedAtMs on COMPLETED job
    const completedWithoutTimestamp = { ...valid, state: "COMPLETED" as const };
    expect(validatePersistentAgentJob(completedWithoutTimestamp, checkpointsDir)).toBe(false);

    const completedValid = { ...valid, state: "COMPLETED" as const, progressPercent: 100, completedAtMs: 1715000050000 };
    expect(validatePersistentAgentJob(completedValid, checkpointsDir)).toBe(true);

    // Requires failureReason on FAILED job
    const failedWithoutReason = { ...valid, state: "FAILED" as const };
    expect(validatePersistentAgentJob(failedWithoutReason, checkpointsDir)).toBe(false);

    const failedValid = { ...valid, state: "FAILED" as const, failureReason: "Network partition timeout" };
    expect(validatePersistentAgentJob(failedValid, checkpointsDir)).toBe(true);
  });

  it("executes canonical state machine lifecycle: QUEUED -> RUNNING -> PAUSED_FOR_USER -> RUNNING -> COMPLETED", async () => {
    const { PersistentJobManager } = await import("./tasks.ts");
    const manager = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    // 1. QUEUED
    const job = manager.createJob({
      jobId: "job-lifecycle-1",
      botId: "bot-alpha",
      threadId: "thread-lifecycle",
      title: "Deploy database migration",
      objective: "Safely execute schema changes and verify data consistency",
      milestones: [{ title: "Backup" }, { title: "Apply schema" }, { title: "Verify" }],
    });

    expect(job.state).toBe("QUEUED");
    expect(job.progressPercent).toBe(0);

    // 2. Worker claims job -> RUNNING
    clockTime += 5000;
    const running = manager.claimJob("job-lifecycle-1", "worker-node-1");
    expect(running.state).toBe("RUNNING");

    // Advance milestone 0 -> 1
    clockTime += 10000;
    await manager.advanceMilestone({
      jobId: "job-lifecycle-1",
      milestoneIndex: 1,
      milestoneTitle: "Backup completed",
      progressPercent: 33,
      data: { backupFile: "db-backup-2026.sql" },
    });

    // 3. Authorization required -> PAUSED_FOR_USER
    clockTime += 5000;
    const paused = await manager.pauseForUser("job-lifecycle-1", "Confirmation required to run destructive schema change");
    expect(paused.state).toBe("PAUSED_FOR_USER");
    expect(paused.currentMilestoneIndex).toBe(1);

    // 4. User confirms authorization -> RUNNING
    clockTime += 15000;
    const resumed = manager.resumeFromUser("job-lifecycle-1", true);
    expect(resumed.state).toBe("RUNNING");

    // Advance milestone 1 -> 2
    clockTime += 10000;
    await manager.advanceMilestone({
      jobId: "job-lifecycle-1",
      milestoneIndex: 2,
      milestoneTitle: "Schema applied and verified",
      progressPercent: 80,
      data: { tablesUpdated: 12 },
    });

    // 5. Success verified -> COMPLETED
    clockTime += 5000;
    const completed = manager.completeJob("job-lifecycle-1", { summary: "Migration finished successfully" });
    expect(completed.state).toBe("COMPLETED");
    expect(completed.progressPercent).toBe(100);
    expect(completed.completedAtMs).toBe(clockTime);
  });

  it("strictly rejects invalid state transitions with typed error", async () => {
    const { PersistentJobManager, ERR_INVALID_JOB_TRANSITION } = await import("./tasks.ts");
    const manager = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager.createJob({
      jobId: "job-transition-guard",
      botId: "bot-alpha",
      threadId: "thread-trans",
      title: "Task with transition guards",
      objective: "Test illegal transition rejections",
    });

    // QUEUED cannot jump directly to COMPLETED or PAUSED_FOR_USER
    expect(() => manager.completeJob(job.jobId)).toThrowError(
      expect.objectContaining({ code: ERR_INVALID_JOB_TRANSITION })
    );

    manager.claimJob(job.jobId, "worker-1");
    manager.completeJob(job.jobId);

    // Terminal COMPLETED cannot transition to RUNNING or CANCELLED
    expect(() => manager.claimJob(job.jobId, "worker-2")).toThrowError(
      expect.objectContaining({ code: ERR_INVALID_JOB_TRANSITION })
    );
    expect(() => manager.cancelJob(job.jobId)).toThrowError(
      expect.objectContaining({ code: ERR_INVALID_JOB_TRANSITION })
    );
  });

  it("handles BLOCKED_DEPENDENCY, FAILED, and CANCELLED states", async () => {
    const { PersistentJobManager } = await import("./tasks.ts");
    const manager = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager.createJob({
      jobId: "job-deps-test",
      botId: "bot-alpha",
      threadId: "thread-deps",
      title: "Job with external dependency",
      objective: "Sync data from external CRM API",
    });

    manager.claimJob(job.jobId, "worker-1");

    // Dependency blocks execution
    const blocked = manager.blockDependency(job.jobId, "CRM API rate limit exhausted");
    expect(blocked.state).toBe("BLOCKED_DEPENDENCY");

    // Dependency unblocks -> resumes RUNNING
    const unblocked = manager.unblockDependency(job.jobId);
    expect(unblocked.state).toBe("RUNNING");

    // Terminal failure with credential sanitization
    const failed = manager.failJob(job.jobId, "Fatal 401 with secret key sk-123456789 and Bearer token-xyz");
    expect(failed.state).toBe("FAILED");
    expect(failed.failureReason).not.toContain("sk-123456789");
    expect(failed.failureReason).toContain("sk-[REDACTED]");
    expect(failed.failureReason).toContain("Bearer [REDACTED]");
  });

  it("enforces worker concurrency control and prevents double claims", async () => {
    const { PersistentJobManager, ERR_JOB_ALREADY_CLAIMED } = await import("./tasks.ts");
    const manager = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager.createJob({
      jobId: "job-concurrency-test",
      botId: "bot-beta",
      threadId: "thread-conc",
      title: "High concurrency job",
      objective: "Verify exclusive worker lease",
    });

    manager.claimJob(job.jobId, "worker-primary");

    // Second worker attempting to claim while lease is active is rejected
    expect(() => manager.claimJob(job.jobId, "worker-secondary")).toThrowError(
      expect.objectContaining({ code: ERR_JOB_ALREADY_CLAIMED })
    );
  });

  it("detects ERR_CORRUPT_JOB_CHECKPOINT and deterministically rolls back to previous valid milestone", async () => {
    const { writeFileSync } = await import("node:fs");
    const { PersistentJobManager, ERR_CORRUPT_JOB_CHECKPOINT } = await import("./tasks.ts");
    const manager = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager.createJob({
      jobId: "job-rollback-test",
      botId: "bot-alpha",
      threadId: "thread-rb",
      title: "Multi-milestone critical task",
      objective: "Demonstrate safe rollback on checkpoint corruption",
    });

    manager.claimJob(job.jobId, "worker-1");

    // Milestone 1 (Safe snapshot)
    clockTime += 10000;
    await manager.advanceMilestone({
      jobId: job.jobId,
      milestoneIndex: 1,
      milestoneTitle: "Milestone 1: Database initialized",
      progressPercent: 30,
      data: { step: 1, status: "safe" },
    });

    // Milestone 2 (In-progress snapshot)
    clockTime += 10000;
    await manager.advanceMilestone({
      jobId: job.jobId,
      milestoneIndex: 2,
      milestoneTitle: "Milestone 2: Data populated",
      progressPercent: 65,
      data: { step: 2, rowsInserted: 1500 },
    });

    // Simulate power failure corruption on Milestone 2 checkpoint file
    const m2Path = manager.getJob(job.jobId)!.checkpointPayloadPath;
    writeFileSync(m2Path, "Corrupted truncated JSON garbage { !@#$");

    // Recovery procedure detects corruption and rolls back to Milestone 1
    const recoveryResult = await manager.recoverJob(job.jobId);
    expect(recoveryResult.recovered).toBe(true);
    expect(recoveryResult.rolledBack).toBe(true);
    expect(recoveryResult.job?.currentMilestoneIndex).toBe(1);
    expect(recoveryResult.job?.progressPercent).toBe(30);
    expect(recoveryResult.job?.state).toBe("PAUSED_FOR_USER");

    // If milestone 1 is also corrupted and no earlier snapshot exists
    const m1Path = manager.getJob(job.jobId)!.checkpointPayloadPath;
    const m0Path = manager.writeCheckpointPayload(job.jobId, 0, {
      jobId: job.jobId,
      botId: "bot-alpha",
      milestoneIndex: 0,
      milestoneTitle: "Setup",
      progressPercent: 0,
      state: "QUEUED",
      timestampMs: clockTime,
      checksum: "invalid-checksum",
      data: {},
    });
    writeFileSync(m1Path, "Garbage");
    writeFileSync(m0Path, "Garbage");

    // Corrupted with no valid snapshot -> moves safely to FAILED with ERR_CORRUPT_JOB_CHECKPOINT
    const finalRecovery = await manager.recoverJob(job.jobId);
    expect(finalRecovery.recovered).toBe(false);
    expect(finalRecovery.error).toBe(ERR_CORRUPT_JOB_CHECKPOINT);
    expect(finalRecovery.job?.state).toBe("FAILED");
  });

  it("persists jobs atomically across manager reboots and replays journals", async () => {
    const { PersistentJobManager } = await import("./tasks.ts");
    const manager1 = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager1.createJob({
      jobId: "job-durability-1",
      botId: "bot-durability",
      threadId: "thread-dur",
      title: "Durable Job across reboots",
      objective: "Verify complete state survival",
    });

    manager1.claimJob(job.jobId, "worker-1");
    await manager1.advanceMilestone({
      jobId: job.jobId,
      milestoneIndex: 1,
      milestoneTitle: "Milestone 1 complete",
      progressPercent: 50,
      data: { processedItems: 100 },
    });

    // Simulate process death and reboot: new manager instance loads same files
    const manager2 = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const reloaded = manager2.getJob("job-durability-1");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.jobId).toBe("job-durability-1");
    expect(reloaded?.state).toBe("RUNNING");
    expect(reloaded?.currentMilestoneIndex).toBe(1);
    expect(reloaded?.progressPercent).toBe(50);
  });

  it("reconstructs complete job with identity, objective, and timestamps from journal when jobs.json is deleted or corrupt", async () => {
    const { PersistentJobManager } = await import("./tasks.ts");
    const manager1 = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager1.createJob({
      jobId: "job-journal-reconstruction",
      botId: "bot-recon",
      threadId: "thread-recon-42",
      title: "Full Journal Reconstruction Objective",
      objective: "Verify that deletion of jobs.json causes zero data loss because the transaction journal is authoritative",
    });

    manager1.claimJob(job.jobId, "worker-primary");
    await manager1.advanceMilestone({
      jobId: job.jobId,
      milestoneIndex: 1,
      milestoneTitle: "Analysis Complete",
      progressPercent: 35,
      data: { verifiedFacts: ["Fact 1", "Fact 2"] },
    });

    // Verify jobs.json exists
    const { existsSync, unlinkSync, writeFileSync } = await import("node:fs");
    expect(existsSync(jobsFile)).toBe(true);

    // Corrupt jobs.json completely
    writeFileSync(jobsFile, "{ CORRUPTED INVALID JSON ");

    // New manager instance attempts to start up
    const manager2 = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const recovered = manager2.getJob("job-journal-reconstruction");
    expect(recovered).not.toBeNull();
    expect(recovered?.jobId).toBe("job-journal-reconstruction");
    expect(recovered?.title).toBe("Full Journal Reconstruction Objective");
    expect(recovered?.objective).toContain("transaction journal is authoritative");
    expect(recovered?.threadId).toBe("thread-recon-42");
    expect(recovered?.state).toBe("RUNNING");
    expect(recovered?.currentMilestoneIndex).toBe(1);
    expect(recovered?.progressPercent).toBe(35);

    // Also test when jobs.json is completely deleted
    unlinkSync(jobsFile);
    expect(existsSync(jobsFile)).toBe(false);

    const manager3 = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const recoveredFromScratch = manager3.getJob("job-journal-reconstruction");
    expect(recoveredFromScratch).not.toBeNull();
    expect(recoveredFromScratch?.title).toBe("Full Journal Reconstruction Objective");
    expect(recoveredFromScratch?.progressPercent).toBe(35);
  });

  it("enforces worker fencing generation, rejecting stale worker writes across lease expiration and reassignment", async () => {
    const { PersistentJobManager, StaleWorkerFenceError } = await import("./tasks.ts");
    const manager = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager.createJob({
      jobId: "job-fencing-test",
      botId: "bot-worker",
      threadId: "thread-fence",
      title: "Fenced Job",
      objective: "Demonstrate stale worker write rejection",
    });

    // Worker A claims job at t = 0
    const jobA = manager.claimJob(job.jobId, "worker-A", 10_000); // 10s lease
    expect(jobA.fencingGeneration).toBe(2); // 1 on create, 2 on claim
    const fenceA = jobA.fencingGeneration!;

    // Worker A advances milestone 1 with generation 2 -> succeeds
    await manager.advanceMilestone({
      jobId: job.jobId,
      milestoneIndex: 1,
      milestoneTitle: "Step 1",
      progressPercent: 20,
      fencingGeneration: fenceA,
      workerId: "worker-A",
    });

    // Time elapses: 15 seconds later, lease expires
    clockTime += 15_000;

    // Worker B claims the expired job
    const jobB = manager.claimJob(job.jobId, "worker-B", 10_000);
    expect(jobB.fencingGeneration).toBe(3); // increments to 3
    const fenceB = jobB.fencingGeneration!;

    // Stale Worker A wakes up and attempts to write milestone 2 using its old generation (2)
    await expect(
      manager.advanceMilestone({
        jobId: job.jobId,
        milestoneIndex: 2,
        milestoneTitle: "Step 2 by Stale Worker A",
        progressPercent: 40,
        fencingGeneration: fenceA, // stale!
        workerId: "worker-A",
      })
    ).rejects.toThrow(StaleWorkerFenceError);

    // Stale Worker A attempts to complete the job
    expect(() => manager.completeJob(job.jobId, {}, "worker-A", fenceA)).toThrow(StaleWorkerFenceError);

    // Valid Worker B advances milestone 2 with active generation 3 -> succeeds
    const advancedB = await manager.advanceMilestone({
      jobId: job.jobId,
      milestoneIndex: 2,
      milestoneTitle: "Step 2 by Active Worker B",
      progressPercent: 50,
      fencingGeneration: fenceB,
      workerId: "worker-B",
    });
    expect(advancedB.currentMilestoneIndex).toBe(2);
    expect(advancedB.progressPercent).toBe(50);
  });

  it("supports lease renewal for long-running worker tasks and rejects writes after lease lapse", async () => {
    const { PersistentJobManager, StaleWorkerFenceError } = await import("./tasks.ts");
    const manager = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager.createJob({
      jobId: "job-lease-renewal",
      botId: "bot-lease",
      threadId: "thread-lease",
      title: "Long Running Task",
      objective: "Test lease renewal protocol",
    });

    const claimed = manager.claimJob(job.jobId, "worker-long", 5_000); // 5s lease
    const fence = claimed.fencingGeneration!;

    // At 3s, renew lease for another 10s
    clockTime += 3_000;
    manager.renewLease(job.jobId, "worker-long", fence, 10_000);

    // At 8s (past original 5s, but within renewed 13s): write succeeds
    clockTime += 5_000;
    const res = await manager.advanceMilestone({
      jobId: job.jobId,
      milestoneIndex: 1,
      milestoneTitle: "Still Alive",
      progressPercent: 50,
      workerId: "worker-long",
      fencingGeneration: fence,
    });
    expect(res.currentMilestoneIndex).toBe(1);

    // At 20s (past the extended lease of 13s): write is rejected because lease expired
    clockTime += 12_000;
    await expect(
      manager.advanceMilestone({
        jobId: job.jobId,
        milestoneIndex: 2,
        milestoneTitle: "Too Late",
        progressPercent: 75,
        workerId: "worker-long",
        fencingGeneration: fence,
      })
    ).rejects.toThrow(StaleWorkerFenceError);
  });

  it("recovers gracefully from torn trailing line in transaction journal without losing committed state", async () => {
    const { PersistentJobManager } = await import("./tasks.ts");
    const { appendFileSync } = await import("node:fs");

    const manager1 = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const job = manager1.createJob({
      jobId: "job-torn-journal",
      botId: "bot-torn",
      threadId: "thread-torn",
      title: "Torn Journal Recovery",
      objective: "Simulate power loss mid-append to journal",
    });

    manager1.claimJob(job.jobId, "worker-1");
    await manager1.advanceMilestone({
      jobId: job.jobId,
      milestoneIndex: 1,
      milestoneTitle: "Committed Milestone 1",
      progressPercent: 40,
    });

    // Simulate crash mid-write appending a torn half-line to job-journal.jsonl
    appendFileSync(journalFile, '{"id":"torn-entry-half-written","jobId":"job-torn-jour', "utf8");

    // Manager restart reads journal with torn trailing line
    const manager2 = new PersistentJobManager({
      file: jobsFile,
      journalFile,
      checkpointsDir,
      clock: mockClock,
    });

    const recovered = manager2.getJob("job-torn-journal");
    expect(recovered).not.toBeNull();
    // Safely kept the last valid committed milestone 1
    expect(recovered?.currentMilestoneIndex).toBe(1);
    expect(recovered?.progressPercent).toBe(40);
  });

  it("enforces cross-process worker fencing, rejecting stale worker writes across distinct OS child processes", async () => {
    const { runCrossProcessWorkerFencingTest } = await import("./verify-cross-process-worker-fencing.ts");
    const report = await runCrossProcessWorkerFencingTest();
    expect(report.verdict).toBe("PASS");
    expect(report.staleWriteRejectedErrorCode).toBe("ERR_STALE_WORKER_FENCE");
    expect(report.staleCompleteRejectedErrorCode).toBe("ERR_STALE_WORKER_FENCE");
    expect(report.reconstructedState).toBe("COMPLETED");
    expect(report.reconstructedProgress).toBe(100);
    expect(report.workerAPid).not.toBe(report.coordinatorPid);
    expect(report.workerBPid).not.toBe(report.coordinatorPid);
    expect(report.workerAPid).not.toBe(report.workerBPid);
  }, 30000);
});

