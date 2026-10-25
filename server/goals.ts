import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export type GoalStatus = "active" | "paused" | "completed" | "blocked";

/**
 * Phase 8: Canonical Goal Record (mobot_54_phases_prompt.md:592-640)
 *
 * Persists the canonical objective across all turns, replanning cycles, and restarts.
 */
export interface CanonicalGoalMilestone {
  id: string;
  title: string;
  status: "pending" | "active" | "completed" | "failed";
  verifiedAt?: number;
}

export interface CanonicalGoalRecord {
  id: string;
  botId: string;
  originatingPrompt: string;
  formalObjective: string;
  constraints: string[];
  successCriteria: string[];
  milestones: Array<{
    id: string;
    title: string;
    status: "pending" | "active" | "completed" | "failed";
    verifiedAt?: number;
  }>;
  activeMilestoneIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCanonicalGoalInput {
  id?: string;
  botId: string;
  originatingPrompt: string;
  formalObjective: string;
  constraints?: string[];
  successCriteria?: string[];
  milestones?: Array<{
    id?: string;
    title: string;
    status?: "pending" | "active" | "completed" | "failed";
    verifiedAt?: number;
  }>;
}

export interface UpdateCanonicalGoalInput {
  constraints?: string[];
  successCriteria?: string[];
  activeMilestoneIndex?: number;
  // Mutating originatingPrompt or formalObjective is strictly prohibited by runtime invariant
  originatingPrompt?: never;
  formalObjective?: never;
}

export const ERR_GOAL_DRIFT_DETECTED = "ERR_GOAL_DRIFT_DETECTED";
export const GOAL_DRIFT_THRESHOLD = 0.60;
export const GOAL_DRIFT_WARNING = "Current action deviates from primary goal. Re-align or justify.";

export interface GoalDriftResult {
  drifted: boolean;
  similarity: number;
  warning?: string;
  threshold: number;
}

export function computeSemanticSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;
  const a = textA.toLowerCase().trim();
  const b = textB.toLowerCase().trim();
  if (a === b) return 1.0;

  const tokenize = (s: string) => s.split(/[^a-z0-9_]+/i).filter((w) => w.length >= 2);
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);

  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  let wordMatches = 0;
  for (const w of setA) {
    if (setB.has(w)) wordMatches++;
  }
  const minWords = Math.min(setA.size, setB.size);
  const wordOverlap = minWords > 0 ? wordMatches / minWords : 0;

  const getBigrams = (s: string) => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    return bigrams;
  };
  const bgA = getBigrams(a);
  const bgB = getBigrams(b);
  let bgOverlap = 0;
  let countATotal = 0;
  let countBTotal = 0;
  for (const count of bgA.values()) countATotal += count;
  for (const count of bgB.values()) countBTotal += count;
  for (const [bg, countA] of bgA.entries()) {
    const countB = bgB.get(bg) || 0;
    bgOverlap += Math.min(countA, countB);
  }
  const minBigrams = Math.min(countATotal, countBTotal);
  const charOverlap = minBigrams > 0 ? bgOverlap / minBigrams : 0;

  return 0.6 * wordOverlap + 0.4 * charOverlap;
}

export function checkGoalDrift(
  formalObjective: string,
  proposedAction: string,
  threshold: number = GOAL_DRIFT_THRESHOLD
): GoalDriftResult {
  const similarity = computeSemanticSimilarity(formalObjective, proposedAction);
  const rounded = Math.round(similarity * 1000) / 1000;
  const drifted = rounded < threshold;
  return {
    drifted,
    similarity: rounded,
    warning: drifted ? GOAL_DRIFT_WARNING : undefined,
    threshold,
  };
}

function validateAndSanitizeCanonicalGoal(raw: unknown): CanonicalGoalRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Partial<CanonicalGoalRecord>;
  if (typeof g.id !== "string" || !g.id) return null;
  if (typeof g.botId !== "string" || !g.botId) return null;
  if (typeof g.originatingPrompt !== "string" || !g.originatingPrompt) return null;
  if (typeof g.formalObjective !== "string" || !g.formalObjective) return null;

  const constraints = Array.isArray(g.constraints)
    ? g.constraints.filter((c): c is string => typeof c === "string")
    : [];
  const successCriteria = Array.isArray(g.successCriteria)
    ? g.successCriteria.filter((c): c is string => typeof c === "string")
    : [];

  const rawMilestones = Array.isArray(g.milestones) ? g.milestones : [];
  const milestones: CanonicalGoalMilestone[] = rawMilestones.map((m, idx) => {
    const rawM = (m && typeof m === "object" ? m : {}) as Partial<CanonicalGoalMilestone>;
    const status: "pending" | "active" | "completed" | "failed" =
      rawM.status === "completed" || rawM.status === "failed" || rawM.status === "active"
        ? rawM.status
        : (idx === 0 ? "active" : "pending");
    return {
      id: typeof rawM.id === "string" && rawM.id ? rawM.id : randomUUID(),
      title: typeof rawM.title === "string" && rawM.title ? rawM.title : `Milestone ${idx + 1}`,
      status,
      ...(typeof rawM.verifiedAt === "number" ? { verifiedAt: rawM.verifiedAt } : {}),
    };
  });

  const activeMilestoneIndex = typeof g.activeMilestoneIndex === "number" && g.activeMilestoneIndex >= 0 && g.activeMilestoneIndex <= milestones.length
    ? Math.floor(g.activeMilestoneIndex)
    : Math.max(0, milestones.findIndex((m) => m.status !== "completed"));

  const now = Date.now();
  return {
    id: g.id,
    botId: g.botId,
    originatingPrompt: g.originatingPrompt,
    formalObjective: g.formalObjective,
    constraints,
    successCriteria,
    milestones,
    activeMilestoneIndex: activeMilestoneIndex >= 0 ? activeMilestoneIndex : 0,
    createdAt: typeof g.createdAt === "number" ? g.createdAt : now,
    updatedAt: typeof g.updatedAt === "number" ? g.updatedAt : now,
  };
}

export interface GoalTask {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  automated?: boolean;
  routineId?: string;
  completedAt?: number;
}

export interface GoalMilestone {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  dueDate?: number;
  tasks: GoalTask[];
  completedAt?: number;
}

export interface Goal {
  id: string;
  botId: string;
  title: string;
  objective: string;
  motivation?: string;
  status: GoalStatus;
  progress: number; // 0 - 100
  milestones: GoalMilestone[];
  blockers: string[];
  nextAction?: string;
  relevantMemories: string[];
  relevantDocuments: string[];
  associatedSpecialists: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateGoalInput {
  botId: string;
  title: string;
  objective: string;
  motivation?: string;
  milestones?: Array<{
    title: string;
    description?: string;
    dueDate?: number;
    tasks?: Array<{ title: string; automated?: boolean }>;
  }>;
  nextAction?: string;
  blockers?: string[];
  relevantMemories?: string[];
  relevantDocuments?: string[];
  associatedSpecialists?: string[];
}

export interface UpdateGoalInput {
  title?: string;
  objective?: string;
  motivation?: string;
  status?: GoalStatus;
  progress?: number;
  milestones?: GoalMilestone[];
  blockers?: string[];
  nextAction?: string;
  relevantMemories?: string[];
  relevantDocuments?: string[];
  associatedSpecialists?: string[];
}

interface GoalFile {
  version: 1 | 2;
  goals: Goal[];
  canonicalGoals?: CanonicalGoalRecord[];
}

export class GoalManager {
  private readonly file: string;
  private goals: Goal[] = [];
  private canonicalGoals: CanonicalGoalRecord[] = [];

  constructor(file = join(DATA_DIR, "goals.json")) {
    this.file = file;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.goals = [];
      this.canonicalGoals = [];
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as GoalFile;
      if (parsed && Array.isArray(parsed.goals)) {
        this.goals = parsed.goals;
      }
      if (parsed && Array.isArray(parsed.canonicalGoals)) {
        this.canonicalGoals = parsed.canonicalGoals
          .map(validateAndSanitizeCanonicalGoal)
          .filter((g): g is CanonicalGoalRecord => g !== null);
      }
    } catch {
      this.goals = [];
      this.canonicalGoals = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload: GoalFile = {
      version: 2,
      goals: this.goals,
      canonicalGoals: this.canonicalGoals,
    };
    writeFileAtomic(this.file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  listGoals(botId?: string): Goal[] {
    if (botId) {
      return this.goals.filter((g) => g.botId === botId);
    }
    return [...this.goals];
  }

  getGoal(id: string): Goal | null {
    return this.goals.find((g) => g.id === id) ?? null;
  }

  createGoal(input: CreateGoalInput): Goal {
    const now = Date.now();
    const milestones: GoalMilestone[] = (input.milestones ?? []).map((m) => ({
      id: randomUUID(),
      title: m.title,
      description: m.description,
      completed: false,
      dueDate: m.dueDate,
      tasks: (m.tasks ?? []).map((t) => ({
        id: randomUUID(),
        title: t.title,
        status: "pending",
        automated: t.automated ?? false,
      })),
    }));

    const progress = this.calculateProgress(milestones);

    const goal: Goal = {
      id: randomUUID(),
      botId: input.botId,
      title: input.title,
      objective: input.objective,
      motivation: input.motivation,
      status: "active",
      progress,
      milestones,
      blockers: input.blockers ?? [],
      nextAction: input.nextAction ?? (milestones[0]?.title ? `Start: ${milestones[0].title}` : undefined),
      relevantMemories: input.relevantMemories ?? [],
      relevantDocuments: input.relevantDocuments ?? [],
      associatedSpecialists: input.associatedSpecialists ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.goals.push(goal);
    this.save();
    return goal;
  }

  updateGoal(id: string, patch: UpdateGoalInput): Goal | null {
    const goal = this.goals.find((g) => g.id === id);
    if (!goal) return null;

    if (patch.title !== undefined) goal.title = patch.title;
    if (patch.objective !== undefined) goal.objective = patch.objective;
    if (patch.motivation !== undefined) goal.motivation = patch.motivation;
    if (patch.status !== undefined) goal.status = patch.status;
    if (patch.blockers !== undefined) goal.blockers = patch.blockers;
    if (patch.nextAction !== undefined) goal.nextAction = patch.nextAction;
    if (patch.relevantMemories !== undefined) goal.relevantMemories = patch.relevantMemories;
    if (patch.relevantDocuments !== undefined) goal.relevantDocuments = patch.relevantDocuments;
    if (patch.associatedSpecialists !== undefined) goal.associatedSpecialists = patch.associatedSpecialists;

    if (patch.milestones !== undefined) {
      goal.milestones = patch.milestones;
      goal.progress = this.calculateProgress(goal.milestones);
    } else if (patch.progress !== undefined) {
      goal.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
    }

    if (goal.progress >= 100 && goal.status === "active") {
      goal.status = "completed";
    }

    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  deleteGoal(id: string): boolean {
    const idx = this.goals.findIndex((g) => g.id === id);
    if (idx === -1) return false;
    this.goals.splice(idx, 1);
    this.save();
    return true;
  }

  completeMilestone(goalId: string, milestoneId: string): Goal | null {
    const goal = this.goals.find((g) => g.id === goalId);
    if (!goal) return null;
    const milestone = goal.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return null;

    milestone.completed = true;
    milestone.completedAt = Date.now();
    for (const task of milestone.tasks) {
      task.status = "completed";
      task.completedAt = Date.now();
    }

    goal.progress = this.calculateProgress(goal.milestones);
    if (goal.progress >= 100) {
      goal.status = "completed";
      goal.nextAction = "Goal fully achieved!";
    } else {
      const nextPending = goal.milestones.find((m) => !m.completed);
      if (nextPending) {
        goal.nextAction = `Next: ${nextPending.title}`;
      }
    }

    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  completeTask(goalId: string, milestoneId: string, taskId: string): Goal | null {
    const goal = this.goals.find((g) => g.id === goalId);
    if (!goal) return null;
    const milestone = goal.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return null;
    const task = milestone.tasks.find((t) => t.id === taskId);
    if (!task) return null;

    task.status = "completed";
    task.completedAt = Date.now();

    if (milestone.tasks.length > 0 && milestone.tasks.every((t) => t.status === "completed")) {
      milestone.completed = true;
      milestone.completedAt = Date.now();
    }

    goal.progress = this.calculateProgress(goal.milestones);
    if (goal.progress >= 100) {
      goal.status = "completed";
      goal.nextAction = "Goal fully achieved!";
    } else {
      const nextPending = goal.milestones.find((m) => !m.completed);
      if (nextPending) {
        goal.nextAction = `Next: ${nextPending.title}`;
      }
    }
    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  deleteGoalsForBot(botId: string): number {
    const initialCount = this.goals.length;
    this.goals = this.goals.filter((g) => g.botId !== botId);
    const removed = initialCount - this.goals.length;
    const removedCanonical = this.deleteCanonicalGoalsForBot(botId);
    if (removed > 0) {
      this.save();
    }
    return removed + removedCanonical;
  }

  // ── Canonical Goal Operations (Phase 8: mobot_54_phases_prompt.md:592-640) ──

  listCanonicalGoals(botId?: string): CanonicalGoalRecord[] {
    if (botId) {
      return this.canonicalGoals
        .filter((g) => g.botId === botId)
        .map((g) => JSON.parse(JSON.stringify(g)));
    }
    return this.canonicalGoals.map((g) => JSON.parse(JSON.stringify(g)));
  }

  getCanonicalGoal(id: string): CanonicalGoalRecord | null {
    const goal = this.canonicalGoals.find((g) => g.id === id);
    return goal ? JSON.parse(JSON.stringify(goal)) : null;
  }

  createCanonicalGoal(input: CreateCanonicalGoalInput): CanonicalGoalRecord {
    if (!input.botId || typeof input.botId !== "string") {
      throw new Error("botId is required for canonical goal");
    }
    if (!input.originatingPrompt || typeof input.originatingPrompt !== "string") {
      throw new Error("originatingPrompt is required for canonical goal");
    }
    if (!input.formalObjective || typeof input.formalObjective !== "string") {
      throw new Error("formalObjective is required for canonical goal");
    }

    // Idempotency: if id provided and goal already exists for this bot, return existing
    if (input.id) {
      const existing = this.canonicalGoals.find((g) => g.id === input.id);
      if (existing) {
        if (existing.botId === input.botId) {
          return JSON.parse(JSON.stringify(existing));
        }
        throw new Error(`Goal ID collision: goal ${input.id} already belongs to bot ${existing.botId}`);
      }
    }

    const now = Date.now();
    const rawMilestones = input.milestones && input.milestones.length > 0 ? input.milestones : [];
    const milestones: CanonicalGoalMilestone[] = rawMilestones.length > 0
      ? rawMilestones.map((m, idx) => ({
          id: m.id || randomUUID(),
          title: m.title.trim(),
          status: m.status || (idx === 0 ? "active" : "pending"),
          ...(m.verifiedAt ? { verifiedAt: m.verifiedAt } : {}),
        }))
      : [
          {
            id: randomUUID(),
            title: `Execute objective: ${input.formalObjective.trim()}`,
            status: "active",
          },
        ];

    const activeIndex = milestones.findIndex((m) => m.status !== "completed");
    const activeMilestoneIndex = activeIndex >= 0 ? activeIndex : 0;

    const record: CanonicalGoalRecord = {
      id: input.id || randomUUID(),
      botId: input.botId,
      originatingPrompt: input.originatingPrompt.trim(),
      formalObjective: input.formalObjective.trim(),
      constraints: (input.constraints || []).map((c) => c.trim()),
      successCriteria: (input.successCriteria || []).map((s) => s.trim()),
      milestones,
      activeMilestoneIndex,
      createdAt: now,
      updatedAt: now,
    };

    this.canonicalGoals.push(record);
    this.save();
    return JSON.parse(JSON.stringify(record));
  }

  updateCanonicalGoal(id: string, patch: Record<string, unknown>): CanonicalGoalRecord {
    const goal = this.canonicalGoals.find((g) => g.id === id);
    if (!goal) {
      throw new Error(`Canonical goal not found: ${id}`);
    }

    // Invariant: originatingPrompt and formalObjective are immutable once initialized
    if ("originatingPrompt" in patch && patch.originatingPrompt !== goal.originatingPrompt) {
      throw new Error("Invariant violation: originatingPrompt is immutable once initialized.");
    }
    if ("formalObjective" in patch && patch.formalObjective !== goal.formalObjective) {
      throw new Error("Invariant violation: formalObjective is immutable once initialized.");
    }

    if (Array.isArray(patch.constraints)) {
      goal.constraints = patch.constraints.filter((c): c is string => typeof c === "string").map((c) => c.trim());
    }
    if (Array.isArray(patch.successCriteria)) {
      goal.successCriteria = patch.successCriteria.filter((s): s is string => typeof s === "string").map((s) => s.trim());
    }
    if (typeof patch.activeMilestoneIndex === "number" && patch.activeMilestoneIndex >= 0) {
      goal.activeMilestoneIndex = Math.min(goal.milestones.length, Math.floor(patch.activeMilestoneIndex));
    }

    goal.updatedAt = Date.now();
    this.save();
    return JSON.parse(JSON.stringify(goal));
  }

  updateCanonicalMilestone(
    goalId: string,
    milestoneId: string,
    status: "pending" | "active" | "completed" | "failed",
    verifiedAt?: number,
    botId?: string
  ): CanonicalGoalRecord | null {
    const goal = this.canonicalGoals.find((g) => g.id === goalId && (!botId || g.botId === botId));
    if (!goal) return null;

    const milestoneIndex = goal.milestones.findIndex((m) => m.id === milestoneId);
    if (milestoneIndex === -1) return null;

    const milestone = goal.milestones[milestoneIndex];
    milestone.status = status;
    if (status === "completed") {
      milestone.verifiedAt = verifiedAt ?? Date.now();
      const nextPending = goal.milestones.find((m, idx) => idx > milestoneIndex && m.status !== "completed");
      if (nextPending && nextPending.status === "pending") {
        nextPending.status = "active";
      }
      const firstIncomplete = goal.milestones.findIndex((m) => m.status !== "completed");
      goal.activeMilestoneIndex = firstIncomplete >= 0 ? firstIncomplete : goal.milestones.length;
    } else {
      milestone.verifiedAt = undefined;
    }

    goal.updatedAt = Date.now();
    this.save();
    return JSON.parse(JSON.stringify(goal));
  }

  resumeCanonicalGoal(id: string, botId?: string): {
    goal: CanonicalGoalRecord;
    activeMilestone: CanonicalGoalMilestone | null;
    activeIndex: number;
  } | null {
    const goal = this.canonicalGoals.find((g) => g.id === id && (!botId || g.botId === botId));
    if (!goal) return null;

    const firstIncomplete = goal.milestones.findIndex((m) => m.status !== "completed");
    const activeIndex = firstIncomplete >= 0 ? firstIncomplete : goal.milestones.length;
    goal.activeMilestoneIndex = activeIndex;

    const activeMilestone = activeIndex < goal.milestones.length ? goal.milestones[activeIndex] : null;
    if (activeMilestone && activeMilestone.status === "pending") {
      activeMilestone.status = "active";
      this.save();
    }

    return {
      goal: JSON.parse(JSON.stringify(goal)),
      activeMilestone: activeMilestone ? JSON.parse(JSON.stringify(activeMilestone)) : null,
      activeIndex,
    };
  }

  deleteCanonicalGoal(id: string, botId?: string): boolean {
    const idx = this.canonicalGoals.findIndex((g) => g.id === id && (!botId || g.botId === botId));
    if (idx === -1) return false;
    this.canonicalGoals.splice(idx, 1);
    this.save();
    return true;
  }

  deleteCanonicalGoalsForBot(botId: string): number {
    const initial = this.canonicalGoals.length;
    this.canonicalGoals = this.canonicalGoals.filter((g) => g.botId !== botId);
    const removed = initial - this.canonicalGoals.length;
    if (removed > 0) {
      this.save();
    }
    return removed;
  }

  checkDrift(goalId: string, proposedAction: string): GoalDriftResult {
    const goal = this.canonicalGoals.find((g) => g.id === goalId);
    if (!goal) {
      return { drifted: false, similarity: 1.0, threshold: GOAL_DRIFT_THRESHOLD };
    }
    return checkGoalDrift(goal.formalObjective, proposedAction);
  }

  private calculateProgress(milestones: GoalMilestone[]): number {
    if (!milestones.length) return 0;
    const totalMilestones = milestones.length;
    let completedPoints = 0;
    for (const m of milestones) {
      if (m.completed) {
        completedPoints += 1;
      } else if (m.tasks.length > 0) {
        const completedTasks = m.tasks.filter((t) => t.status === "completed").length;
        completedPoints += completedTasks / m.tasks.length;
      }
    }
    return Math.round((completedPoints / totalMilestones) * 100);
  }
}

export const sharedGoalManager = new GoalManager();
