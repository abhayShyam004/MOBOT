import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalManager } from "./goals.ts";

describe("GoalManager", () => {
  let tempDir: string;
  let file: string;
  let manager: GoalManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "goal-test-"));
    file = join(tempDir, "goals.json");
    manager = new GoalManager(file);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a persistent goal with milestones and calculates initial progress", () => {
    const goal = manager.createGoal({
      botId: "bot-123",
      title: "Get a software engineer job",
      objective: "Secure a full-time software engineering role",
      motivation: "Career transition",
      milestones: [
        {
          title: "Update resume & portfolio",
          tasks: [{ title: "Revise resume" }, { title: "Deploy portfolio site" }],
        },
        {
          title: "Apply to 30 companies",
          tasks: [{ title: "Research target companies" }, { title: "Submit applications" }],
        },
      ],
    });

    expect(goal.id).toBeDefined();
    expect(goal.status).toBe("active");
    expect(goal.progress).toBe(0);
    expect(goal.milestones.length).toBe(2);
    expect(goal.milestones[0].tasks.length).toBe(2);

    // Verify persistence across new manager instance
    const reloaded = new GoalManager(file);
    const fetched = reloaded.getGoal(goal.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe("Get a software engineer job");
  });

  it("updates progress when completing milestones and tasks", () => {
    const goal = manager.createGoal({
      botId: "bot-123",
      title: "Learn Rust",
      objective: "Master systems programming",
      milestones: [
        {
          title: "Read the Rust book",
          tasks: [{ title: "Chapters 1-10" }, { title: "Chapters 11-20" }],
        },
        {
          title: "Build a CLI project",
          tasks: [{ title: "Implement parser" }, { title: "Add tests" }],
        },
      ],
    });

    const m1Id = goal.milestones[0].id;
    const t1Id = goal.milestones[0].tasks[0].id;

    // Complete 1 task out of 4 tasks across 2 milestones
    const afterTask = manager.completeTask(goal.id, m1Id, t1Id);
    expect(afterTask?.progress).toBe(25);

    // Complete the second milestone completely
    const m2Id = goal.milestones[1].id;
    const afterMilestone = manager.completeMilestone(goal.id, m2Id);
    expect(afterMilestone?.progress).toBe(75);

    // Complete the first milestone completely
    const afterAll = manager.completeMilestone(goal.id, m1Id);
    expect(afterAll?.progress).toBe(100);
    expect(afterAll?.status).toBe("completed");
  });

  it("updates blockers, nextAction, and deletes goals properly", () => {
    const goal = manager.createGoal({
      botId: "bot-456",
      title: "Run a marathon",
      objective: "Finish 42km under 4 hours",
    });

    const updated = manager.updateGoal(goal.id, {
      blockers: ["Knee injury"],
      status: "blocked",
      nextAction: "Rest and consult physiotherapist",
    });

    expect(updated?.status).toBe("blocked");
    expect(updated?.blockers).toContain("Knee injury");
    expect(updated?.nextAction).toBe("Rest and consult physiotherapist");

    const deleted = manager.deleteGoal(goal.id);
    expect(deleted).toBe(true);
    expect(manager.getGoal(goal.id)).toBeNull();
  });
});
