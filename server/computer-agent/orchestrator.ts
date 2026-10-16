// Agent Orchestration Layer Engine
// Manages structured task state, multi-step planning, observation, replanning, and completion criteria.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  TaskPlan,
  PlanStep,
  CompletionCriterion,
  ReplanRecord,
  ApprovalCheckpoint,
  PlanCreationParams,
  ReplanParams,
  CompletionVerificationItem,
  CompletionVerificationResult,
} from "./types.ts";

export class TaskOrchestrator {
  private baseDir: string;
  private activePlans: Map<string, TaskPlan> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.AC_WORKSPACE || process.cwd();
  }

  private resolveWorkspace(workspacePath?: string): string {
    return workspacePath || this.baseDir;
  }

  private planFilePath(workspacePath?: string): string {
    const ws = this.resolveWorkspace(workspacePath);
    return join(ws, ".mobot", "task_plan.json");
  }

  /**
   * Save task plan atomically to persistent workspace storage.
   */
  public saveToDisk(plan: TaskPlan, workspacePath?: string): void {
    const ws = this.resolveWorkspace(workspacePath);
    const filePath = this.planFilePath(ws);
    const dir = dirname(filePath);
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, JSON.stringify(plan, null, 2), "utf8");
      this.activePlans.set(ws, plan);
    } catch (err: any) {
      console.error(`[TaskOrchestrator] Failed to persist task plan to ${filePath}:`, err.message);
    }
  }

  /**
   * Load active task plan from workspace storage or in-memory cache.
   */
  public loadFromDisk(workspacePath?: string): TaskPlan | null {
    const ws = this.resolveWorkspace(workspacePath);
    const cached = this.activePlans.get(ws);
    if (cached) return cached;

    const filePath = this.planFilePath(ws);
    if (!existsSync(filePath)) return null;

    try {
      const data = readFileSync(filePath, "utf8");
      const plan = JSON.parse(data) as TaskPlan;
      this.activePlans.set(ws, plan);
      return plan;
    } catch (err: any) {
      console.error(`[TaskOrchestrator] Failed to load task plan from ${filePath}:`, err.message);
      return null;
    }
  }

  /**
   * Retrieve active plan for workspace or thread.
   */
  public getActivePlan(workspacePath?: string): TaskPlan | null {
    return this.loadFromDisk(workspacePath);
  }

  /**
   * Construct a structured multi-step plan for an unfamiliar user goal.
   */
  public createPlan(params: PlanCreationParams): TaskPlan {
    const ws = this.resolveWorkspace(params.workspacePath);
    const now = new Date().toISOString();

    const steps: PlanStep[] = (params.steps || []).map((s, idx) => ({
      id: `step_${idx + 1}`,
      title: s.title,
      description: s.description,
      status: "pending",
      toolsRequired: s.toolsRequired || [],
      expectedOutcome: s.expectedOutcome,
      requiresApproval: Boolean(s.requiresApproval),
      approvalStatus: s.requiresApproval ? "none" : undefined,
    }));

    const criteria: CompletionCriterion[] = (params.completionCriteria || []).map((c, idx) => ({
      id: `crit_${idx + 1}`,
      description: c.description,
      verified: false,
    }));

    const plan: TaskPlan = {
      id: `plan_${randomUUID().slice(0, 12)}`,
      threadId: params.threadId,
      goal: params.goal,
      status: "executing",
      steps,
      completionCriteria: criteria,
      currentStepId: steps.length > 0 ? steps[0].id : null,
      revision: 1,
      replanHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    this.saveToDisk(plan, ws);
    return plan;
  }

  /**
   * Mark a planned step as active (in-progress) before calling its execution tools.
   */
  public startStep(
    stepId: string,
    workspacePath?: string,
  ): { ok: boolean; plan: TaskPlan; step?: PlanStep; error?: string } {
    const ws = this.resolveWorkspace(workspacePath);
    const plan = this.getActivePlan(ws);
    if (!plan) {
      return { ok: false, plan: null as any, error: "No active plan found. Call plan_create first." };
    }

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) {
      return { ok: false, plan, error: `Step with id '${stepId}' not found in current plan.` };
    }

    // Check approval requirement
    if (step.requiresApproval && step.approvalStatus !== "approved") {
      step.status = "blocked";
      if (!step.approvalStatus || step.approvalStatus === "none") {
        step.approvalStatus = "requested";
      }
      plan.status = "paused";
      plan.updatedAt = new Date().toISOString();
      this.saveToDisk(plan, ws);
      return {
        ok: false,
        plan,
        step,
        error: `Step '${stepId}' requires human approval before execution. Approval status is '${step.approvalStatus}'.`,
      };
    }

    step.status = "in_progress";
    step.startedAt = new Date().toISOString();
    plan.currentStepId = stepId;
    plan.status = "executing";
    plan.updatedAt = new Date().toISOString();

    this.saveToDisk(plan, ws);
    return { ok: true, plan, step };
  }

  /**
   * Mark an in-progress step as successfully completed after observing empirical outcome.
   */
  public completeStep(
    stepId: string,
    observation: string,
    evidence?: string,
    workspacePath?: string,
  ): { ok: boolean; plan: TaskPlan; step?: PlanStep; error?: string } {
    const ws = this.resolveWorkspace(workspacePath);
    const plan = this.getActivePlan(ws);
    if (!plan) {
      return { ok: false, plan: null as any, error: "No active plan found. Call plan_create first." };
    }

    const stepIndex = plan.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      return { ok: false, plan, error: `Step with id '${stepId}' not found.` };
    }

    const step = plan.steps[stepIndex];
    step.status = "completed";
    step.actualObservation = observation;
    step.completedAt = new Date().toISOString();
    if (evidence) {
      step.description = `${step.description}\n[Evidence: ${evidence}]`;
    }

    // Find next pending step
    const nextPending = plan.steps.slice(stepIndex + 1).find((s) => s.status === "pending");
    plan.currentStepId = nextPending ? nextPending.id : null;
    plan.updatedAt = new Date().toISOString();

    this.saveToDisk(plan, ws);
    return { ok: true, plan, step };
  }

  /**
   * Mark a step as failed with observed error and root cause diagnosis.
   */
  public failStep(
    stepId: string,
    observation: string,
    error: string,
    workspacePath?: string,
  ): { ok: boolean; plan: TaskPlan; step?: PlanStep; error?: string } {
    const ws = this.resolveWorkspace(workspacePath);
    const plan = this.getActivePlan(ws);
    if (!plan) {
      return { ok: false, plan: null as any, error: "No active plan found. Call plan_create first." };
    }

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) {
      return { ok: false, plan, error: `Step with id '${stepId}' not found.` };
    }

    step.status = "failed";
    step.actualObservation = observation;
    step.error = error;
    plan.status = "paused";
    plan.updatedAt = new Date().toISOString();

    this.saveToDisk(plan, ws);
    return { ok: true, plan, step };
  }

  /**
   * Dynamically replan remaining steps while preserving all completed work.
   */
  public replan(params: ReplanParams): { ok: boolean; plan: TaskPlan; error?: string } {
    const ws = this.resolveWorkspace(params.workspacePath);
    const plan = this.getActivePlan(ws);
    if (!plan) {
      return { ok: false, plan: null as any, error: "No active plan found. Call plan_create first." };
    }

    const failedStepIndex = plan.steps.findIndex((s) => s.id === params.failedStepId);
    if (failedStepIndex === -1) {
      return { ok: false, plan, error: `Failed step '${params.failedStepId}' not found in current plan.` };
    }

    // Ensure failed step is marked as failed
    const failedStep = plan.steps[failedStepIndex];
    if (failedStep.status !== "failed") {
      failedStep.status = "failed";
      failedStep.error = params.diagnosis;
    }

    // Preserve all steps up to and including completed steps
    const preservedSteps: PlanStep[] = [];
    const removedStepIds: string[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      if (s.status === "completed" || s.id === params.failedStepId) {
        preservedSteps.push(s);
      } else {
        removedStepIds.push(s.id);
      }
    }

    const newRevision = plan.revision + 1;
    const addedStepIds: string[] = [];
    const newSteps: PlanStep[] = (params.updatedRemainingSteps || []).map((s, idx) => {
      const newId = `step_r${newRevision}_${idx + 1}`;
      addedStepIds.push(newId);
      return {
        id: newId,
        title: s.title,
        description: s.description,
        status: "pending",
        toolsRequired: s.toolsRequired || [],
        expectedOutcome: s.expectedOutcome,
        requiresApproval: Boolean(s.requiresApproval),
        approvalStatus: s.requiresApproval ? "none" : undefined,
      };
    });

    const combinedSteps = [...preservedSteps, ...newSteps];

    // Record replan history
    const record: ReplanRecord = {
      revision: newRevision,
      timestamp: new Date().toISOString(),
      failedStepId: params.failedStepId,
      reason: failedStep.error || "Step execution failed",
      diagnosis: params.diagnosis,
      actionsTaken: `Replaced ${removedStepIds.length} pending steps with ${newSteps.length} revised steps.`,
      preservedCompletedSteps: preservedSteps.filter((s) => s.status === "completed").map((s) => s.id),
      addedSteps: addedStepIds,
      removedSteps: removedStepIds,
    };

    plan.steps = combinedSteps;
    plan.revision = newRevision;
    plan.replanHistory.push(record);
    plan.status = "executing";
    plan.currentStepId = newSteps.length > 0 ? newSteps[0].id : null;
    plan.updatedAt = new Date().toISOString();

    this.saveToDisk(plan, ws);
    return { ok: true, plan };
  }

  /**
   * Request human approval checkpoint for a high-impact step.
   */
  public requestApprovalCheckpoint(
    stepId: string,
    action: string,
    impact: string,
    parameters?: Record<string, unknown>,
    workspacePath?: string,
  ): { ok: boolean; plan: TaskPlan; checkpoint?: ApprovalCheckpoint; error?: string } {
    const ws = this.resolveWorkspace(workspacePath);
    const plan = this.getActivePlan(ws);
    if (!plan) {
      return { ok: false, plan: null as any, error: "No active plan found." };
    }

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) {
      return { ok: false, plan, error: `Step with id '${stepId}' not found.` };
    }

    const checkpoint: ApprovalCheckpoint = {
      stepId,
      action,
      impact,
      parameters,
      requestedAt: new Date().toISOString(),
    };

    step.requiresApproval = true;
    step.approvalStatus = "requested";
    step.checkpoint = checkpoint;
    step.status = "blocked";
    plan.status = "paused";
    plan.updatedAt = new Date().toISOString();

    this.saveToDisk(plan, ws);
    return { ok: true, plan, checkpoint };
  }

  /**
   * Record human decision (approval or rejection) for a checkpoint.
   */
  public recordApprovalDecision(
    stepId: string,
    approved: boolean,
    reason?: string,
    workspacePath?: string,
  ): { ok: boolean; plan: TaskPlan; error?: string } {
    const ws = this.resolveWorkspace(workspacePath);
    const plan = this.getActivePlan(ws);
    if (!plan) {
      return { ok: false, plan: null as any, error: "No active plan found." };
    }

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) {
      return { ok: false, plan, error: `Step with id '${stepId}' not found.` };
    }

    step.approvalStatus = approved ? "approved" : "rejected";
    if (step.checkpoint) {
      step.checkpoint.decision = {
        approved,
        reason,
        timestamp: new Date().toISOString(),
      };
    }

    if (approved) {
      step.status = "pending";
      plan.status = "executing";
      plan.currentStepId = stepId;
    } else {
      step.status = "failed";
      step.error = reason || "Action rejected by user";
      plan.status = "paused";
    }

    plan.updatedAt = new Date().toISOString();
    this.saveToDisk(plan, ws);
    return { ok: true, plan };
  }

  /**
   * Verify all completion criteria against explicit empirical evidence.
   */
  public verifyCompletion(
    evaluations: CompletionVerificationItem[],
    workspacePath?: string,
  ): CompletionVerificationResult & { ok: boolean; plan: TaskPlan } {
    const ws = this.resolveWorkspace(workspacePath);
    const plan = this.getActivePlan(ws);
    if (!plan) {
      return {
        ok: false,
        allVerified: false,
        planCompleted: false,
        criteria: [],
        pendingCriteria: ["No active plan found"],
        summary: "Cannot verify completion without an active plan.",
        plan: null as any,
      };
    }

    const evalMap = new Map<string, CompletionVerificationItem>();
    for (const item of evaluations || []) {
      evalMap.set(item.id, item);
    }

    const now = new Date().toISOString();
    const pendingCriteria: string[] = [];

    for (const crit of plan.completionCriteria) {
      const evaluation = evalMap.get(crit.id);
      if (evaluation) {
        crit.verified = Boolean(evaluation.verified);
        crit.evidence = evaluation.evidence;
        crit.verifiedAt = now;
      }
      if (!crit.verified) {
        pendingCriteria.push(`${crit.id}: ${crit.description}`);
      }
    }

    const allVerified = plan.completionCriteria.length > 0 && pendingCriteria.length === 0;

    // Check that all steps are completed (or skipped)
    const activeUncompletedSteps = plan.steps.filter(
      (s) => s.status !== "completed" && s.status !== "skipped",
    );

    if (allVerified) {
      for (const step of activeUncompletedSteps) {
        if (
          /verif|criteria|completion|evaluate/i.test(step.title) ||
          /verif|criteria|completion/i.test(step.description)
        ) {
          step.status = "completed";
          step.completedAt = now;
          step.actualObservation = "Empirically verified all completion criteria via plan_verify_completion.";
        }
      }
    }

    const remainingActive = plan.steps.filter(
      (s) => s.status !== "completed" && s.status !== "skipped",
    );

    const planCompleted = allVerified && remainingActive.length === 0;

    if (planCompleted) {
      plan.status = "completed";
      plan.currentStepId = null;
    } else if (allVerified && remainingActive.length > 0) {
      // Criteria verified but some steps remain
      plan.status = "executing";
    }

    plan.updatedAt = now;
    this.saveToDisk(plan, ws);

    const summary = planCompleted
      ? `Task goal successfully completed! All ${plan.completionCriteria.length} completion criteria empirically verified.`
      : `Completion verification incomplete: ${pendingCriteria.length} criteria unverified, ${remainingActive.length} steps remaining.`;

    return {
      ok: true,
      allVerified,
      planCompleted,
      criteria: plan.completionCriteria,
      pendingCriteria,
      summary,
      plan,
    };
  }

  /**
   * Reset / clear current plan in workspace.
   */
  public resetPlan(workspacePath?: string): void {
    const ws = this.resolveWorkspace(workspacePath);
    this.activePlans.delete(ws);
    const filePath = this.planFilePath(ws);
    try {
      if (existsSync(filePath)) {
        writeFileSync(filePath, JSON.stringify({ reset: true, timestamp: new Date().toISOString() }), "utf8");
      }
    } catch {}
  }
}

export const defaultTaskOrchestrator = new TaskOrchestrator();
