// Durable Task Execution Engine (Phase 3: Long-Running Autonomous Tasks)
//
// Provides persistent task lifecycle management independent of a single
// model turn or chat session:
// - Explicit states: CREATED, PLANNING, RUNNING, WAITING, RECOVERING,
//   AWAITING_APPROVAL, COMPLETED, FAILED, CANCELLED, PAUSED
// - Durable disk persistence in .mobot/tasks/ and .mobot/durable_tasks.json
// - Background supervision, process monitoring, crash detection, timeouts
// - Interruption recovery, milestone preservation, clean cancellation
// - Empirical completion verification gate

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defaultProcessManager, GeneralProcessManager } from "./process-manager.ts";
import type {
  DurableTaskRecord,
  TaskCreationParams,
  TaskProgressUpdate,
  TaskWaitOptions,
  TaskApprovalRequest,
  TaskVerificationItem,
  TaskMilestone,
} from "./types.ts";

function defaultWorkspace(): string {
  if (process.env.AC_WORKSPACE) return process.env.AC_WORKSPACE;
  const androidWs = "/data/user/0/com.openmausbot.companion/files/host/workspace";
  if (existsSync(androidWs)) return androidWs;
  return process.cwd();
}

export class DurableTaskEngine {
  private readonly tasks = new Map<string, DurableTaskRecord>();
  private readonly baseWorkspace: string;
  private readonly processManager: GeneralProcessManager;
  private supervisorInterval: NodeJS.Timeout | null = null;
  private notificationSink?: (notification: {
    kind: "approval" | "done" | "turn-failed" | "incident";
    botId: string;
    botName?: string;
    threadId: string;
    title: string;
    body: string;
  }) => void;

  constructor(workspacePath?: string, processManager?: GeneralProcessManager) {
    this.baseWorkspace = workspacePath || defaultWorkspace();
    this.processManager = processManager || defaultProcessManager;
    this.ensureDirs(this.baseWorkspace);
    this.loadAllTasksFromDisk(this.baseWorkspace);
  }

  public setNotificationSink(sink: (n: any) => void): void {
    this.notificationSink = sink;
  }

  private resolveWorkspace(wsPath?: string): string {
    return wsPath || this.baseWorkspace;
  }

  private ensureDirs(ws: string): void {
    const mobotDir = join(ws, ".mobot");
    const tasksDir = join(mobotDir, "tasks");
    try {
      mkdirSync(tasksDir, { recursive: true });
    } catch {}
  }

  private getRegistryPath(ws: string): string {
    return join(ws, ".mobot", "durable_tasks.json");
  }

  private getTaskFilePath(taskId: string, ws: string): string {
    return join(ws, ".mobot", "tasks", `${taskId}.json`);
  }

  private saveTaskToDisk(task: DurableTaskRecord, ws: string): void {
    this.ensureDirs(ws);
    try {
      // Save individual task file
      writeFileSync(this.getTaskFilePath(task.id, ws), JSON.stringify(task, null, 2), "utf8");

      // Save registry index
      const registryPath = this.getRegistryPath(ws);
      const allTasks = Array.from(this.tasks.values()).filter((t) => t.workspacePath === ws);
      writeFileSync(registryPath, JSON.stringify(allTasks, null, 2), "utf8");
    } catch {
      // Best-effort disk persistence
    }
  }

  private loadAllTasksFromDisk(ws: string): void {
    this.ensureDirs(ws);
    const tasksDir = join(ws, ".mobot", "tasks");
    try {
      if (existsSync(tasksDir)) {
        const files = readdirSync(tasksDir).filter((f) => f.endsWith(".json"));
        for (const f of files) {
          try {
            const raw = readFileSync(join(tasksDir, f), "utf8");
            const task: DurableTaskRecord = JSON.parse(raw);
            if (task && task.id) {
              this.tasks.set(task.id, task);
            }
          } catch {}
        }
      }
    } catch {}
  }

  /**
   * Create a new durable task.
   */
  public createTask(params: TaskCreationParams): DurableTaskRecord {
    const ws = this.resolveWorkspace(params.workspacePath);
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const task: DurableTaskRecord = {
      id,
      botId: params.botId || "default_bot",
      threadId: params.threadId || "default_thread",
      goal: params.goal,
      status: "CREATED",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      currentStepId: null,
      completedMilestones: [],
      pendingWork: params.initialMilestones || [],
      observations: [
        {
          timestamp: now,
          source: "engine",
          summary: `Task created with goal: "${params.goal}"`,
        },
      ],
      failures: [],
      processIds: [],
      artifactIds: [],
      approvals: [],
      progressPercent: 0,
      progressMessage: "Task initialized, ready for planning.",
      workspacePath: ws,
    };

    this.tasks.set(id, task);
    this.saveTaskToDisk(task, ws);
    return task;
  }

  /**
   * Get task by ID.
   */
  public getTask(taskId: string, wsPath?: string): DurableTaskRecord | null {
    const task = this.tasks.get(taskId);
    if (task) return task;
    // Fallback load from disk
    const ws = this.resolveWorkspace(wsPath);
    const taskPath = this.getTaskFilePath(taskId, ws);
    if (existsSync(taskPath)) {
      try {
        const loaded: DurableTaskRecord = JSON.parse(readFileSync(taskPath, "utf8"));
        this.tasks.set(loaded.id, loaded);
        return loaded;
      } catch {}
    }
    return null;
  }

  /**
   * Transition to PLANNING state.
   */
  public startPlanning(taskId: string, planId?: string): DurableTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "PLANNING";
    task.planId = planId || task.planId;
    task.updatedAt = new Date().toISOString();
    task.progressMessage = "Constructing structured execution plan.";
    this.saveTaskToDisk(task, task.workspacePath);
    return task;
  }

  /**
   * Transition to RUNNING state.
   */
  public startRunning(taskId: string, stepId?: string): DurableTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "RUNNING";
    if (!task.startedAt) task.startedAt = new Date().toISOString();
    if (stepId) task.currentStepId = stepId;
    task.updatedAt = new Date().toISOString();
    task.progressMessage = stepId ? `Executing step ${stepId}.` : "Task running in background.";
    task.waitState = undefined;
    this.saveTaskToDisk(task, task.workspacePath);
    return task;
  }

  /**
   * Transition to WAITING state (autonomous pause until timer or condition).
   */
  public setWaiting(taskId: string, options: TaskWaitOptions): DurableTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "WAITING";
    const until = Date.now() + Math.max(1, options.durationSeconds) * 1000;
    task.waitState = {
      untilTimestamp: until,
      reason: options.reason,
      nextAction: options.nextAction,
    };
    task.updatedAt = new Date().toISOString();
    task.progressMessage = `Waiting ${options.durationSeconds}s (${options.reason}). Next: ${options.nextAction}`;
    task.observations.push({
      timestamp: task.updatedAt,
      source: "engine",
      summary: `Entered WAITING state: ${options.reason}`,
      details: { untilTimestamp: until, nextAction: options.nextAction },
    });
    this.saveTaskToDisk(task, task.workspacePath);
    return task;
  }

  /**
   * Transition to RECOVERING state upon failure.
   */
  public setRecovering(
    taskId: string,
    failure: { error: string; diagnosis?: string; stepId?: string; recoveryAction?: string },
  ): DurableTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "RECOVERING";
    task.updatedAt = new Date().toISOString();
    task.progressMessage = `Recovering from failure: ${failure.error}${failure.diagnosis ? ` (${failure.diagnosis})` : ""}`;
    task.failures.push({
      timestamp: task.updatedAt,
      stepId: failure.stepId || task.currentStepId || undefined,
      error: failure.error,
      diagnosis: failure.diagnosis,
      recovered: false,
      recoveryAction: failure.recoveryAction,
    });
    this.saveTaskToDisk(task, task.workspacePath);

    if (this.notificationSink) {
      this.notificationSink({
        kind: "turn-failed",
        botId: task.botId,
        threadId: task.threadId,
        title: "Task Recovery In Progress",
        body: `Task "${task.goal}" encountered an error and is recovering: ${failure.error}`,
      });
    }

    return task;
  }

  /**
   * Request human approval checkpoint. Transitions to AWAITING_APPROVAL.
   */
  public requestApproval(
    taskId: string,
    params: { action: string; reason: string; impact: string; stepId?: string },
  ): TaskApprovalRequest {
    const task = this.requireTask(taskId);
    task.status = "AWAITING_APPROVAL";
    task.updatedAt = new Date().toISOString();

    const approvalId = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const request: TaskApprovalRequest = {
      id: approvalId,
      stepId: params.stepId || task.currentStepId || undefined,
      action: params.action,
      reason: params.reason,
      impact: params.impact,
      requestedAt: task.updatedAt,
      status: "pending",
    };

    task.approvals.push(request);
    task.progressMessage = `Paused for approval: ${params.action} (${params.reason})`;
    this.saveTaskToDisk(task, task.workspacePath);

    if (this.notificationSink) {
      this.notificationSink({
        kind: "approval",
        botId: task.botId,
        threadId: task.threadId,
        title: "Approval Required",
        body: `Task "${task.goal}" requires decision for: ${params.action}`,
      });
    }

    return request;
  }

  /**
   * Record human decision on approval request.
   */
  public decideApproval(
    taskId: string,
    approvalId: string,
    approved: boolean,
    reason?: string,
  ): DurableTaskRecord {
    const task = this.requireTask(taskId);
    const approval = task.approvals.find((a) => a.id === approvalId);
    if (!approval) {
      throw new Error(`Approval request '${approvalId}' not found on task '${taskId}'.`);
    }

    const now = new Date().toISOString();
    approval.status = approved ? "approved" : "rejected";
    approval.decisionAt = now;
    approval.decisionReason = reason;

    task.updatedAt = now;
    if (approved) {
      task.status = "RUNNING";
      task.progressMessage = `Approval granted for ${approval.action}. Resuming execution.`;
      task.observations.push({
        timestamp: now,
        source: "user",
        summary: `User approved: ${approval.action}${reason ? ` (${reason})` : ""}`,
      });
    } else {
      task.status = "FAILED";
      task.progressMessage = `Approval rejected for ${approval.action}: ${reason || "User rejected action"}`;
      task.failures.push({
        timestamp: now,
        stepId: approval.stepId,
        error: reason || "Action rejected by user at approval checkpoint",
        recovered: false,
      });
    }

    this.saveTaskToDisk(task, task.workspacePath);
    return task;
  }

  /**
   * Update task progress, observations, and milestones.
   */
  public updateProgress(taskId: string, update: TaskProgressUpdate): DurableTaskRecord {
    const task = this.requireTask(taskId);
    const now = new Date().toISOString();
    task.updatedAt = now;

    if (update.progressPercent !== undefined) {
      task.progressPercent = Math.min(100, Math.max(0, update.progressPercent));
    }
    if (update.progressMessage) {
      task.progressMessage = update.progressMessage;
    }
    if (update.currentStepId) {
      task.currentStepId = update.currentStepId;
    }
    if (update.addedProcessId && !task.processIds.includes(update.addedProcessId)) {
      task.processIds.push(update.addedProcessId);
    }
    if (update.addedArtifactId && !task.artifactIds.includes(update.addedArtifactId)) {
      task.artifactIds.push(update.addedArtifactId);
    }
    if (update.observation) {
      task.observations.push({
        timestamp: now,
        source: "agent",
        summary: update.observation,
      });
    }
    if (update.milestoneCompleted) {
      const ms = update.milestoneCompleted;
      const milestone: TaskMilestone = {
        id: ms.id,
        title: ms.title,
        description: ms.description,
        completedAt: now,
        evidence: ms.evidence,
      };
      task.completedMilestones.push(milestone);
      task.pendingWork = task.pendingWork.filter((item) => item !== ms.title && item !== ms.id);
    }

    this.saveTaskToDisk(task, task.workspacePath);
    return task;
  }

  /**
   * Finalize task to COMPLETED with empirical verification evidence.
   */
  public completeTask(
    taskId: string,
    verificationItems: TaskVerificationItem[],
    summary: string,
    deliveredArtifacts?: string[],
  ): { ok: boolean; task: DurableTaskRecord; error?: string } {
    const task = this.requireTask(taskId);
    const now = new Date().toISOString();

    if (!verificationItems || verificationItems.length === 0) {
      return {
        ok: false,
        task,
        error: "Cannot complete task without explicit empirical verification criteria.",
      };
    }

    const unverified = verificationItems.filter((item) => !item.verified);
    if (unverified.length > 0) {
      return {
        ok: false,
        task,
        error: `Cannot complete task: ${unverified.length} verification criteria failed (${unverified.map((u) => u.description).join(", ")}).`,
      };
    }

    task.status = "COMPLETED";
    task.completedAt = now;
    task.updatedAt = now;
    task.progressPercent = 100;
    task.progressMessage = `Task completed successfully: ${summary}`;
    task.finalVerification = {
      verified: true,
      timestamp: now,
      criteria: verificationItems,
      summary,
    };
    task.finalResult = {
      success: true,
      summary,
      deliveredArtifacts: deliveredArtifacts || task.artifactIds,
    };

    this.saveTaskToDisk(task, task.workspacePath);

    if (this.notificationSink) {
      this.notificationSink({
        kind: "done",
        botId: task.botId,
        threadId: task.threadId,
        title: "Task Complete",
        body: `Task "${task.goal}" has completed successfully. All verification criteria confirmed.`,
      });
    }

    return { ok: true, task };
  }

  /**
   * Mark task as FAILED.
   */
  public failTask(taskId: string, error: string, diagnosis?: string): DurableTaskRecord {
    const task = this.requireTask(taskId);
    const now = new Date().toISOString();
    task.status = "FAILED";
    task.completedAt = now;
    task.updatedAt = now;
    task.progressMessage = `Task failed: ${error}`;
    task.failures.push({
      timestamp: now,
      error,
      diagnosis,
      recovered: false,
    });
    task.finalResult = {
      success: false,
      summary: `Task failed: ${error}${diagnosis ? ` (${diagnosis})` : ""}`,
      deliveredArtifacts: task.artifactIds,
    };

    this.saveTaskToDisk(task, task.workspacePath);

    if (this.notificationSink) {
      this.notificationSink({
        kind: "turn-failed",
        botId: task.botId,
        threadId: task.threadId,
        title: "Task Failed",
        body: `Task "${task.goal}" failed: ${error}`,
      });
    }

    return task;
  }

  /**
   * Explicitly cancel task. Stops associated managed processes.
   */
  public async cancelTask(taskId: string, reason = "Cancelled by user"): Promise<DurableTaskRecord> {
    const task = this.requireTask(taskId);
    const now = new Date().toISOString();

    task.status = "CANCELLED";
    task.completedAt = now;
    task.updatedAt = now;
    task.progressMessage = `Task cancelled: ${reason}`;
    task.finalResult = {
      success: false,
      summary: `Task was cancelled before completion: ${reason}. Preserved ${task.completedMilestones.length} milestones.`,
      deliveredArtifacts: task.artifactIds,
    };

    // Cleanly stop all associated background processes
    for (const procId of task.processIds) {
      try {
        await this.processManager.stopProcess(procId, true);
      } catch {}
    }

    this.saveTaskToDisk(task, task.workspacePath);
    return task;
  }

  /**
   * Pause task execution.
   */
  public pauseTask(taskId: string): DurableTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "PAUSED";
    task.updatedAt = new Date().toISOString();
    task.progressMessage = "Task paused by user.";
    this.saveTaskToDisk(task, task.workspacePath);
    return task;
  }

  /**
   * Resume a paused or recovering task.
   */
  public resumeTask(taskId: string): DurableTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "RUNNING";
    task.updatedAt = new Date().toISOString();
    task.progressMessage = "Task resumed from persistent state.";
    task.waitState = undefined;
    this.saveTaskToDisk(task, task.workspacePath);
    return task;
  }

  /**
   * Interruption recovery on server startup:
   * Inspects all active tasks and running processes, reconciles crashed states,
   * and prepares tasks for resumption without restarting completed work.
   */
  public async reconcileTasksOnStartup(wsPath?: string): Promise<{
    reconciledCount: number;
    activeTasks: DurableTaskRecord[];
  }> {
    const ws = this.resolveWorkspace(wsPath);
    this.loadAllTasksFromDisk(ws);

    const activeTasks: DurableTaskRecord[] = [];
    let reconciledCount = 0;

    for (const task of this.tasks.values()) {
      if (wsPath && task.workspacePath !== ws) continue;

      if (task.status === "RUNNING" || task.status === "WAITING" || task.status === "RECOVERING") {
        reconciledCount++;
        // Check managed processes
        for (const procId of task.processIds) {
          const inspected = await this.processManager.inspectProcess(procId);
          if (inspected && (inspected.state === "CRASHED" || inspected.state === "STOPPED")) {
            task.observations.push({
              timestamp: new Date().toISOString(),
              source: "reconciler",
              summary: `Process ${procId} found in ${inspected.state} state during startup reconciliation.`,
            });
          }
        }

        task.observations.push({
          timestamp: new Date().toISOString(),
          source: "reconciler",
          summary: `Task recovered from disk after host startup. Retaining ${task.completedMilestones.length} completed milestones.`,
        });

        task.updatedAt = new Date().toISOString();
        this.saveTaskToDisk(task, task.workspacePath);
        activeTasks.push(task);
      }
    }

    return { reconciledCount, activeTasks };
  }

  /**
   * Start the background supervisor tick.
   */
  public startSupervisor(intervalMs = 2000): void {
    if (this.supervisorInterval) return;

    this.supervisorInterval = setInterval(async () => {
      await this.supervisorTick();
    }, intervalMs);

    if (this.supervisorInterval.unref) {
      this.supervisorInterval.unref();
    }
  }

  /**
   * Stop background supervisor.
   */
  public stopSupervisor(): void {
    if (this.supervisorInterval) {
      clearInterval(this.supervisorInterval);
      this.supervisorInterval = null;
    }
  }

  /**
   * Single supervisor tick examining active tasks.
   */
  public async supervisorTick(): Promise<void> {
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if (task.status === "WAITING" && task.waitState) {
        if (now >= task.waitState.untilTimestamp) {
          const action = task.waitState.nextAction;
          task.status = "RUNNING";
          task.waitState = undefined;
          task.updatedAt = new Date().toISOString();
          task.progressMessage = `Wait timer expired. Ready to execute: ${action}`;
          task.observations.push({
            timestamp: task.updatedAt,
            source: "supervisor",
            summary: `Wait timer expired. Resumed to RUNNING state for action: ${action}`,
          });
          this.saveTaskToDisk(task, task.workspacePath);
        }
      } else if (task.status === "RUNNING") {
        // Monitor running processes
        for (const procId of task.processIds) {
          const proc = await this.processManager.inspectProcess(procId);
          if (proc && proc.state === "CRASHED") {
            const alreadyRecorded = task.failures.some(
              (f) => f.error.includes(procId) && !f.recovered
            );
            if (!alreadyRecorded) {
              task.status = "RECOVERING";
              task.updatedAt = new Date().toISOString();
              task.progressMessage = `Background process ${procId} crashed. Entering RECOVERING state.`;
              task.failures.push({
                timestamp: task.updatedAt,
                stepId: task.currentStepId || undefined,
                error: `Process ${procId} exited unexpectedly (state: CRASHED).`,
                diagnosis: proc.lastError || `Exit code ${proc.exitCode}`,
                recovered: false,
                recoveryAction: "Restart process or replan step",
              });
              this.saveTaskToDisk(task, task.workspacePath);
            }
          }
        }
      }
    }
  }

  /**
   * List all tasks in engine.
   */
  public listTasks(wsPath?: string): DurableTaskRecord[] {
    if (!wsPath) {
      return Array.from(this.tasks.values());
    }
    const ws = this.resolveWorkspace(wsPath);
    return Array.from(this.tasks.values()).filter((t) => t.workspacePath === ws);
  }

  private requireTask(taskId: string): DurableTaskRecord {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Durable task with id '${taskId}' not found.`);
    }
    return task;
  }
}

export const defaultTaskEngine = new DurableTaskEngine();
