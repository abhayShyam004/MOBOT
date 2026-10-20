import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export type GoalStatus = "active" | "paused" | "completed" | "blocked";

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
  version: 1;
  goals: Goal[];
}

export class GoalManager {
  private readonly file: string;
  private goals: Goal[] = [];

  constructor(file = join(DATA_DIR, "goals.json")) {
    this.file = file;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.goals = [];
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as GoalFile;
      if (parsed && Array.isArray(parsed.goals)) {
        this.goals = parsed.goals;
      }
    } catch {
      this.goals = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload: GoalFile = {
      version: 1,
      goals: this.goals,
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
    if (removed > 0) {
      this.save();
    }
    return removed;
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
