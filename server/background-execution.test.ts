import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  BackgroundExecutionManager,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  ERR_PROCESS_KILLED_BY_OS,
  ProcessKilledByOsError,
  validateBackgroundExecutionState,
  type BackgroundExecutionState,
} from "./background-execution.ts";

describe("BackgroundExecutionState contract and validation", () => {
  it("validates compliant BackgroundExecutionState objects", () => {
    const err = new ProcessKilledByOsError("Simulated OS kill", { code: 137 });
    expect(err.code).toBe(ERR_PROCESS_KILLED_BY_OS);
    expect(err.details?.code).toBe(137);

    const valid: BackgroundExecutionState = {
      sessionId: "session-123",
      activeTaskId: "task-abc",
      foregroundServicePid: 12345,
      wakelockHeld: true,
      batteryOptimizationWhitelisted: true,
      executionHeartbeatMs: 1772000000000,
    };
    expect(validateBackgroundExecutionState(valid)).toBe(true);
  });

  it("rejects non-compliant or partial objects", () => {
    expect(validateBackgroundExecutionState(null)).toBe(false);
    expect(validateBackgroundExecutionState(undefined)).toBe(false);
    expect(validateBackgroundExecutionState("string")).toBe(false);
    expect(validateBackgroundExecutionState({})).toBe(false);
    expect(
      validateBackgroundExecutionState({
        sessionId: "session-1",
        activeTaskId: "task-1",
        foregroundServicePid: "12345", // string instead of number
        wakelockHeld: true,
        batteryOptimizationWhitelisted: false,
        executionHeartbeatMs: 1000,
      })
    ).toBe(false);
    expect(
      validateBackgroundExecutionState({
        sessionId: "session-1",
        activeTaskId: "task-1",
        foregroundServicePid: 12345,
        wakelockHeld: "true", // string instead of boolean
        batteryOptimizationWhitelisted: false,
        executionHeartbeatMs: 1000,
      })
    ).toBe(false);
  });
});

describe("BackgroundExecutionManager lifecycle and wake-lock discipline", () => {
  let tempFilePath: string;
  let testClockTime = 1000000;
  const mockClock = () => testClockTime;

  beforeEach(() => {
    tempFilePath = join(tmpdir(), `bg-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    testClockTime = 1000000;
  });

  afterEach(() => {
    if (existsSync(tempFilePath)) {
      try {
        unlinkSync(tempFilePath);
      } catch {}
    }
  });

  it("starts long-running background execution, holds wake-lock and persists checkpoint", async () => {
    const manager = new BackgroundExecutionManager(tempFilePath, mockClock);

    const state = await manager.startExecution({
      taskId: "task-long-run-1",
      sessionId: "session-main-1",
      threadId: "thread-xyz",
      botId: "chief",
      stepDescription: "Starting long analysis",
      initialData: { totalSteps: 10 },
    });

    expect(state.activeTaskId).toBe("task-long-run-1");
    expect(state.sessionId).toBe("session-main-1");
    expect(state.wakelockHeld).toBe(true);
    expect(state.executionHeartbeatMs).toBe(1000000);
    expect(validateBackgroundExecutionState(state)).toBe(true);

    const cp = manager.getCheckpoint("task-long-run-1");
    expect(cp).not.toBeNull();
    expect(cp?.status).toBe("running");
    expect(cp?.stepIndex).toBe(0);
    expect(cp?.data).toEqual({ totalSteps: 10 });
  });

  it("records progress and updates heartbeat timestamp", async () => {
    const manager = new BackgroundExecutionManager(tempFilePath, mockClock);
    await manager.startExecution({
      taskId: "task-heartbeat-test",
      sessionId: "session-hb",
      threadId: "thread-hb",
      botId: "worker",
    });

    testClockTime = 1050000; // +50s
    const state = await manager.recordHeartbeat("task-heartbeat-test", {
      stepIndex: 3,
      totalSteps: 10,
      stepDescription: "Processed item 3",
      data: { processedCount: 3 },
    });

    expect(state).not.toBeNull();
    expect(state?.executionHeartbeatMs).toBe(1050000);
    expect(state?.wakelockHeld).toBe(true);

    const cp = manager.getCheckpoint("task-heartbeat-test");
    expect(cp?.stepIndex).toBe(3);
    expect(cp?.executionHeartbeatMs).toBe(1050000);
    expect(cp?.stepDescription).toBe("Processed item 3");
    expect(cp?.data.processedCount).toBe(3);
  });

  it("releases wake-lock immediately upon task completion (zero orphaned wake locks)", async () => {
    const manager = new BackgroundExecutionManager(tempFilePath, mockClock);
    await manager.startExecution({
      taskId: "task-complete-test",
      sessionId: "session-comp",
      threadId: "thread-comp",
      botId: "chief",
    });

    testClockTime = 1100000;
    const finalState = await manager.completeExecution("task-complete-test", { summary: "All tasks done" });

    expect(finalState.activeTaskId).toBe("");
    expect(finalState.wakelockHeld).toBe(false);
    expect(validateBackgroundExecutionState(finalState)).toBe(true);

    const cp = manager.getCheckpoint("task-complete-test");
    expect(cp?.status).toBe("completed");
    expect(cp?.data.summary).toBe("All tasks done");

    // Persisted file should show no active task and completed status
    const reloaded = new BackgroundExecutionManager(tempFilePath, mockClock);
    const reloadedState = await reloaded.getExecutionState();
    expect(reloadedState.activeTaskId).toBe("");
    expect(reloadedState.wakelockHeld).toBe(false);
  });

  it("releases wake-lock immediately upon pause or cancellation", async () => {
    const manager = new BackgroundExecutionManager(tempFilePath, mockClock);
    await manager.startExecution({
      taskId: "task-cancel-test",
      sessionId: "session-cancel",
      threadId: "thread-cancel",
      botId: "chief",
    });

    const state = await manager.pauseOrCancelExecution("task-cancel-test", "paused", { reason: "User paused" });
    expect(state.activeTaskId).toBe("");
    expect(state.wakelockHeld).toBe(false);

    const cp = manager.getCheckpoint("task-cancel-test");
    expect(cp?.status).toBe("paused");
    expect(cp?.data.reason).toBe("User paused");
  });
});

describe("Process-death recovery protocol and ERR_PROCESS_KILLED_BY_OS", () => {
  let tempFilePath: string;
  let testClockTime = 2000000;
  const mockClock = () => testClockTime;

  beforeEach(() => {
    tempFilePath = join(tmpdir(), `bg-recovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    testClockTime = 2000000;
  });

  afterEach(() => {
    if (existsSync(tempFilePath)) {
      try {
        unlinkSync(tempFilePath);
      } catch {}
    }
  });

  it("detects process termination by Android OS / LMK when PID changes", async () => {
    const manager = new BackgroundExecutionManager(tempFilePath, mockClock);
    await manager.startExecution({
      taskId: "task-lmk-died",
      sessionId: "session-lmk",
      threadId: "thread-lmk",
      botId: "worker",
      stepDescription: "Step 4 in progress",
      initialData: { checkpointedRecord: 42 },
    });

    // Simulate process death: app was killed by OS (LMK) and restarts with a new PID
    const previousPid = process.pid;
    const newProcessPid = previousPid + 999; // Simulating new PID on relaunch

    // Manager in new process inspects state
    const recoveryResult = await manager.detectAndRecoverProcessDeath({
      currentPid: newProcessPid,
      now: testClockTime + 10000,
    });

    expect(recoveryResult.recovered).toBe(true);
    expect(recoveryResult.error).toBe(ERR_PROCESS_KILLED_BY_OS);
    expect(recoveryResult.checkpoint?.taskId).toBe("task-lmk-died");
    expect(recoveryResult.checkpoint?.status).toBe("interrupted");
    expect(recoveryResult.checkpoint?.data.checkpointedRecord).toBe(42);

    // Verify wake-lock was not leaked
    const state = await manager.getExecutionState();
    expect(state.wakelockHeld).toBe(false);
    expect(state.activeTaskId).toBe("");
  });

  it("detects stale heartbeat timeout as process death", async () => {
    const manager = new BackgroundExecutionManager(tempFilePath, mockClock);
    await manager.startExecution({
      taskId: "task-stale-heartbeat",
      sessionId: "session-stale",
      threadId: "thread-stale",
      botId: "worker",
    });

    // Jump time past DEFAULT_HEARTBEAT_TIMEOUT_MS
    const recoveryResult = await manager.detectAndRecoverProcessDeath({
      currentPid: process.pid,
      now: testClockTime + DEFAULT_HEARTBEAT_TIMEOUT_MS + 5000,
      heartbeatTimeoutMs: DEFAULT_HEARTBEAT_TIMEOUT_MS,
    });

    expect(recoveryResult.recovered).toBe(true);
    expect(recoveryResult.error).toBe(ERR_PROCESS_KILLED_BY_OS);
    expect(recoveryResult.checkpoint?.taskId).toBe("task-stale-heartbeat");
    expect(recoveryResult.checkpoint?.status).toBe("interrupted");
  });

  it("does not report death for an actively running task within heartbeat window with matching PID", async () => {
    const manager = new BackgroundExecutionManager(tempFilePath, mockClock);
    await manager.startExecution({
      taskId: "task-active-healthy",
      sessionId: "session-healthy",
      threadId: "thread-healthy",
      botId: "worker",
    });

    const recoveryResult = await manager.detectAndRecoverProcessDeath({
      currentPid: process.pid,
      now: testClockTime + 5000, // only 5s elapsed
      heartbeatTimeoutMs: DEFAULT_HEARTBEAT_TIMEOUT_MS,
    });

    expect(recoveryResult.recovered).toBe(false);
    expect(recoveryResult.checkpoint).toBeUndefined();
  });
});
