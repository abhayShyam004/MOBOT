import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

/**
 * Official Roadmap Phase 20 Formal Data Contract: Background Execution State
 */
export interface BackgroundExecutionState {
  sessionId: string;
  activeTaskId: string;
  foregroundServicePid: number;
  wakelockHeld: boolean;
  batteryOptimizationWhitelisted: boolean;
  executionHeartbeatMs: number;
}

export const ERR_PROCESS_KILLED_BY_OS = "ERR_PROCESS_KILLED_BY_OS";
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000; // 60 seconds

export class ProcessKilledByOsError extends Error {
  readonly code = ERR_PROCESS_KILLED_BY_OS;
  readonly details?: Record<string, unknown>;
  constructor(message = "Host process was terminated by Android OS / LMK", details?: Record<string, unknown>) {
    super(message);
    this.name = "ProcessKilledByOsError";
    this.details = details;
  }
}

export interface ExecutionCheckpoint {
  taskId: string;
  sessionId: string;
  threadId: string;
  botId: string;
  status: "running" | "completed" | "paused" | "failed" | "interrupted" | "cancelled";
  stepIndex: number;
  totalSteps?: number;
  stepDescription?: string;
  pid: number;
  executionHeartbeatMs: number;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface BackgroundExecutionFile {
  version: 1;
  activeTaskId: string | null;
  activeSessionId: string | null;
  checkpoints: Record<string, ExecutionCheckpoint>; // taskId -> Checkpoint
}

export function validateBackgroundExecutionState(val: unknown): val is BackgroundExecutionState {
  if (!val || typeof val !== "object") return false;
  const s = val as Record<string, unknown>;
  if (typeof s.sessionId !== "string") return false;
  if (typeof s.activeTaskId !== "string") return false;
  if (typeof s.foregroundServicePid !== "number" || isNaN(s.foregroundServicePid)) return false;
  if (typeof s.wakelockHeld !== "boolean") return false;
  if (typeof s.batteryOptimizationWhitelisted !== "boolean") return false;
  if (typeof s.executionHeartbeatMs !== "number" || isNaN(s.executionHeartbeatMs)) return false;
  return true;
}

export class BackgroundExecutionManager {
  private readonly file: string;
  private readonly clock: () => number;
  private state: BackgroundExecutionFile;
  private localWakelockHeld = false;
  private localBatteryOptimizationWhitelisted = false;

  constructor(file = join(DATA_DIR, "background-execution.json"), clock: () => number = Date.now) {
    this.file = file;
    this.clock = clock;
    this.state = this.load();
  }

  private load(): BackgroundExecutionFile {
    if (!existsSync(this.file)) {
      return {
        version: 1,
        activeTaskId: null,
        activeSessionId: null,
        checkpoints: {},
      };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as BackgroundExecutionFile;
      return {
        version: 1,
        activeTaskId: typeof parsed.activeTaskId === "string" ? parsed.activeTaskId : null,
        activeSessionId: typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : null,
        checkpoints: parsed.checkpoints && typeof parsed.checkpoints === "object" ? parsed.checkpoints : {},
      };
    } catch {
      return {
        version: 1,
        activeTaskId: null,
        activeSessionId: null,
        checkpoints: {},
      };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(this.state, null, 2) + "\n", { mode: 0o600 });
  }

  private async callNativeDriver(endpoint: string, method = "GET", body?: Record<string, unknown>): Promise<any | null> {
    const port = process.env.PH_DRIVER_PORT;
    const token = process.env.PH_DRIVER_TOKEN || "";
    if (!port) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const resp = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  /**
   * Retrieves the current BackgroundExecutionState.
   * If running on device with PhoneDriverServer, queries actual OS state;
   * otherwise reflects the authoritative local manager state.
   */
  async getExecutionState(): Promise<BackgroundExecutionState> {
    const nativeState = await this.callNativeDriver("/background/state");
    const now = this.clock();

    if (nativeState && typeof nativeState.foregroundServicePid === "number") {
      return {
        sessionId: nativeState.sessionId || this.state.activeSessionId || "",
        activeTaskId: nativeState.activeTaskId || this.state.activeTaskId || "",
        foregroundServicePid: nativeState.foregroundServicePid,
        wakelockHeld: Boolean(nativeState.wakelockHeld),
        batteryOptimizationWhitelisted: Boolean(nativeState.batteryOptimizationWhitelisted),
        executionHeartbeatMs: typeof nativeState.executionHeartbeatMs === "number" ? nativeState.executionHeartbeatMs : now,
      };
    }

    return {
      sessionId: this.state.activeSessionId || "",
      activeTaskId: this.state.activeTaskId || "",
      foregroundServicePid: process.pid,
      wakelockHeld: this.localWakelockHeld,
      batteryOptimizationWhitelisted: this.localBatteryOptimizationWhitelisted,
      executionHeartbeatMs: now,
    };
  }

  /**
   * Starts a background execution session for a long-running task.
   * Acquires native wake-lock and persists checkpoint to disk.
   */
  async startExecution(input: {
    taskId: string;
    sessionId: string;
    threadId: string;
    botId: string;
    stepDescription?: string;
    initialData?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<BackgroundExecutionState> {
    const now = this.clock();
    const pid = process.pid;

    this.state.activeTaskId = input.taskId;
    this.state.activeSessionId = input.sessionId;

    const checkpoint: ExecutionCheckpoint = {
      taskId: input.taskId,
      sessionId: input.sessionId,
      threadId: input.threadId,
      botId: input.botId,
      status: "running",
      stepIndex: 0,
      stepDescription: input.stepDescription ?? "Initiated task execution",
      pid,
      executionHeartbeatMs: now,
      data: input.initialData ?? {},
      createdAt: now,
      updatedAt: now,
    };

    this.state.checkpoints[input.taskId] = checkpoint;
    this.localWakelockHeld = true;
    this.save();

    // Call native driver if available on Android
    const nativeResult = await this.callNativeDriver("/background/acquire_wakelock", "POST", {
      taskId: input.taskId,
      sessionId: input.sessionId,
      timeoutMs: input.timeoutMs ?? 10 * 60 * 1000,
    });

    if (nativeResult && typeof nativeResult.foregroundServicePid === "number") {
      return {
        sessionId: input.sessionId,
        activeTaskId: input.taskId,
        foregroundServicePid: nativeResult.foregroundServicePid,
        wakelockHeld: Boolean(nativeResult.wakelockHeld),
        batteryOptimizationWhitelisted: Boolean(nativeResult.batteryOptimizationWhitelisted),
        executionHeartbeatMs: nativeResult.executionHeartbeatMs ?? now,
      };
    }

    return {
      sessionId: input.sessionId,
      activeTaskId: input.taskId,
      foregroundServicePid: pid,
      wakelockHeld: true,
      batteryOptimizationWhitelisted: this.localBatteryOptimizationWhitelisted,
      executionHeartbeatMs: now,
    };
  }

  /**
   * Advances execution progress and updates heartbeat.
   */
  async recordHeartbeat(
    taskId: string,
    progress?: {
      stepIndex?: number;
      totalSteps?: number;
      stepDescription?: string;
      data?: Record<string, unknown>;
    }
  ): Promise<BackgroundExecutionState | null> {
    const checkpoint = this.state.checkpoints[taskId];
    if (!checkpoint || checkpoint.status !== "running") return null;

    const now = this.clock();
    checkpoint.executionHeartbeatMs = now;
    checkpoint.updatedAt = now;
    if (progress?.stepIndex !== undefined) checkpoint.stepIndex = progress.stepIndex;
    if (progress?.totalSteps !== undefined) checkpoint.totalSteps = progress.totalSteps;
    if (progress?.stepDescription) checkpoint.stepDescription = progress.stepDescription;
    if (progress?.data) checkpoint.data = { ...checkpoint.data, ...progress.data };

    this.save();

    const nativeResult = await this.callNativeDriver("/background/heartbeat", "POST", { taskId });
    if (nativeResult && typeof nativeResult.foregroundServicePid === "number") {
      return {
        sessionId: checkpoint.sessionId,
        activeTaskId: taskId,
        foregroundServicePid: nativeResult.foregroundServicePid,
        wakelockHeld: Boolean(nativeResult.wakelockHeld),
        batteryOptimizationWhitelisted: Boolean(nativeResult.batteryOptimizationWhitelisted),
        executionHeartbeatMs: nativeResult.executionHeartbeatMs ?? now,
      };
    }

    return {
      sessionId: checkpoint.sessionId,
      activeTaskId: taskId,
      foregroundServicePid: process.pid,
      wakelockHeld: this.localWakelockHeld,
      batteryOptimizationWhitelisted: this.localBatteryOptimizationWhitelisted,
      executionHeartbeatMs: now,
    };
  }

  /**
   * Terminal state: task successfully completed.
   * Releases wake-lock and updates persisted checkpoint.
   */
  async completeExecution(taskId: string, resultData?: Record<string, unknown>): Promise<BackgroundExecutionState> {
    const now = this.clock();
    const checkpoint = this.state.checkpoints[taskId];

    if (checkpoint) {
      checkpoint.status = "completed";
      checkpoint.updatedAt = now;
      checkpoint.executionHeartbeatMs = now;
      if (resultData) checkpoint.data = { ...checkpoint.data, ...resultData };
    }

    if (this.state.activeTaskId === taskId) {
      this.state.activeTaskId = null;
    }
    this.localWakelockHeld = false;
    this.save();

    const nativeResult = await this.callNativeDriver("/background/release_wakelock", "POST", { taskId });
    const pid = nativeResult?.foregroundServicePid ?? process.pid;

    return {
      sessionId: checkpoint?.sessionId || this.state.activeSessionId || "",
      activeTaskId: "",
      foregroundServicePid: pid,
      wakelockHeld: false,
      batteryOptimizationWhitelisted: nativeResult?.batteryOptimizationWhitelisted ?? this.localBatteryOptimizationWhitelisted,
      executionHeartbeatMs: now,
    };
  }

  /**
   * Terminal or paused state on error, cancellation, or user pause.
   * Invariant: immediately releases partial wake-lock to prevent leaks.
   */
  async pauseOrCancelExecution(
    taskId: string,
    terminalStatus: "paused" | "failed" | "interrupted" | "cancelled" = "paused",
    details?: Record<string, unknown>
  ): Promise<BackgroundExecutionState> {
    const now = this.clock();
    const checkpoint = this.state.checkpoints[taskId];

    if (checkpoint) {
      checkpoint.status = terminalStatus;
      checkpoint.updatedAt = now;
      checkpoint.executionHeartbeatMs = now;
      if (details) checkpoint.data = { ...checkpoint.data, ...details };
    }

    if (this.state.activeTaskId === taskId) {
      this.state.activeTaskId = null;
    }
    this.localWakelockHeld = false;
    this.save();

    const nativeResult = await this.callNativeDriver("/background/release_wakelock", "POST", { taskId });
    const pid = nativeResult?.foregroundServicePid ?? process.pid;

    return {
      sessionId: checkpoint?.sessionId || this.state.activeSessionId || "",
      activeTaskId: "",
      foregroundServicePid: pid,
      wakelockHeld: false,
      batteryOptimizationWhitelisted: nativeResult?.batteryOptimizationWhitelisted ?? this.localBatteryOptimizationWhitelisted,
      executionHeartbeatMs: now,
    };
  }

  /**
   * Process-Death Recovery Protocol (ERR_PROCESS_KILLED_BY_OS):
   * Upon app relaunch or host restart, inspects persisted checkpoints.
   * If a task was marked "running" but its process died or its heartbeat lapsed,
   * classifies failure as ERR_PROCESS_KILLED_BY_OS and resumes from last safe checkpoint.
   */
  async detectAndRecoverProcessDeath(options?: {
    heartbeatTimeoutMs?: number;
    currentPid?: number;
    now?: number;
  }): Promise<{ recovered: boolean; checkpoint?: ExecutionCheckpoint; error?: string }> {
    const now = options?.now ?? this.clock();
    const timeout = options?.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    const currentPid = options?.currentPid ?? process.pid;

    for (const cp of Object.values(this.state.checkpoints)) {
      if (cp.status === "running") {
        const isProcessDead = cp.pid !== currentPid;
        const isHeartbeatStale = now - cp.executionHeartbeatMs > timeout;

        if (isProcessDead || isHeartbeatStale) {
          // Failure classified as ERR_PROCESS_KILLED_BY_OS
          cp.status = "interrupted";
          cp.updatedAt = now;
          this.state.activeTaskId = null;
          this.localWakelockHeld = false;
          this.save();

          return {
            recovered: true,
            checkpoint: { ...cp },
            error: ERR_PROCESS_KILLED_BY_OS,
          };
        }
      }
    }

    return { recovered: false };
  }

  getCheckpoint(taskId: string): ExecutionCheckpoint | null {
    return this.state.checkpoints[taskId] ? { ...this.state.checkpoints[taskId] } : null;
  }

  listCheckpoints(): ExecutionCheckpoint[] {
    return Object.values(this.state.checkpoints).map((cp) => ({ ...cp }));
  }

  setBatteryOptimizationWhitelisted(whitelisted: boolean): void {
    this.localBatteryOptimizationWhitelisted = whitelisted;
  }

  clear(): void {
    this.state = {
      version: 1,
      activeTaskId: null,
      activeSessionId: null,
      checkpoints: {},
    };
    this.localWakelockHeld = false;
    this.save();
  }
}

export const sharedBackgroundExecutionManager = new BackgroundExecutionManager();
