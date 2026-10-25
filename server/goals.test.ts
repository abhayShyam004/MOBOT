import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GoalManager,
  checkGoalDrift,
  ERR_GOAL_DRIFT_DETECTED,
  GOAL_DRIFT_THRESHOLD,
  GOAL_DRIFT_WARNING,
} from "./goals.ts";
import { AgentExecutionLoop } from "./capabilities/orchestration.ts";
import { ObservabilityBus } from "./capabilities/observability.ts";

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

  describe("Official Roadmap Phase 8: Persist Original Goal (mobot_54_phases_prompt.md:592-640)", () => {
    describe("1. Formal Data Contract & Schema Specifications", () => {
      it("creates a CanonicalGoalRecord adhering to the exact Phase 8 schema", () => {
        const goal = manager.createCanonicalGoal({
          botId: "bot-alpha",
          originatingPrompt: "Analyze battery consumption logs from Android device",
          formalObjective: "Extract and summarize battery drain metrics from system logs",
          constraints: ["Do not delete raw logs", "Spend cap $0.50"],
          successCriteria: [
            "Battery statistics extracted",
            "Top 3 draining processes identified",
            "Summary report written",
          ],
          milestones: [
            { title: "Read system battery log" },
            { title: "Calculate per-app consumption" },
            { title: "Generate summary markdown" },
          ],
        });

        expect(goal.id).toBeDefined();
        expect(goal.botId).toBe("bot-alpha");
        expect(goal.originatingPrompt).toBe("Analyze battery consumption logs from Android device");
        expect(goal.formalObjective).toBe("Extract and summarize battery drain metrics from system logs");
        expect(goal.constraints).toEqual(["Do not delete raw logs", "Spend cap $0.50"]);
        expect(goal.successCriteria.length).toBe(3);
        expect(goal.milestones.length).toBe(3);
        expect(goal.milestones[0].status).toBe("active");
        expect(goal.milestones[1].status).toBe("pending");
        expect(goal.milestones[2].status).toBe("pending");
        expect(goal.activeMilestoneIndex).toBe(0);
        expect(typeof goal.createdAt).toBe("number");
        expect(typeof goal.updatedAt).toBe("number");
      });

      it("enforces immutability of originatingPrompt and formalObjective", () => {
        const goal = manager.createCanonicalGoal({
          botId: "bot-immutable",
          originatingPrompt: "Original prompt from user",
          formalObjective: "Primary formal objective",
          milestones: [{ title: "Step 1" }],
        });

        // Mutating originatingPrompt throws invariant violation
        expect(() => {
          manager.updateCanonicalGoal(goal.id, {
            originatingPrompt: "Tampered user prompt",
          } as any);
        }).toThrow("Invariant violation: originatingPrompt is immutable once initialized.");

        // Mutating formalObjective throws invariant violation
        expect(() => {
          manager.updateCanonicalGoal(goal.id, {
            formalObjective: "Diverged sub-task objective",
          } as any);
        }).toThrow("Invariant violation: formalObjective is immutable once initialized.");

        // Allowed updates (e.g. constraints) succeed without violating immutability
        const updated = manager.updateCanonicalGoal(goal.id, {
          constraints: ["New constraint added"],
        });
        expect(updated.constraints).toEqual(["New constraint added"]);
        expect(updated.originatingPrompt).toBe("Original prompt from user");
        expect(updated.formalObjective).toBe("Primary formal objective");
      });
    });

    describe("2. Milestone Progression & Invariants", () => {
      it("manages milestone transitions and advances activeMilestoneIndex", () => {
        const goal = manager.createCanonicalGoal({
          botId: "bot-milestones",
          originatingPrompt: "Multi-stage pipeline",
          formalObjective: "Execute 3-stage data processing pipeline",
          milestones: [
            { title: "Stage 1: Fetch raw records" },
            { title: "Stage 2: Filter and transform" },
            { title: "Stage 3: Persist results" },
          ],
        });

        expect(goal.activeMilestoneIndex).toBe(0);
        expect(goal.milestones[0].status).toBe("active");

        // Complete milestone 0
        const m0Id = goal.milestones[0].id;
        const afterM0 = manager.updateCanonicalMilestone(goal.id, m0Id, "completed");
        expect(afterM0).not.toBeNull();
        expect(afterM0?.milestones[0].status).toBe("completed");
        expect(afterM0?.milestones[0].verifiedAt).toBeDefined();
        // Milestone 1 is now active and index advanced to 1
        expect(afterM0?.activeMilestoneIndex).toBe(1);
        expect(afterM0?.milestones[1].status).toBe("active");

        // Complete milestone 1
        const m1Id = goal.milestones[1].id;
        const afterM1 = manager.updateCanonicalMilestone(goal.id, m1Id, "completed");
        expect(afterM1?.activeMilestoneIndex).toBe(2);
        expect(afterM1?.milestones[2].status).toBe("active");

        // Complete milestone 2
        const m2Id = goal.milestones[2].id;
        const afterM2 = manager.updateCanonicalMilestone(goal.id, m2Id, "completed");
        expect(afterM2?.activeMilestoneIndex).toBe(3); // All complete
        expect(afterM2?.milestones.every((m) => m.status === "completed")).toBe(true);
      });
    });

    describe("3. Durable Persistence & Restart Resilience", () => {
      it("persists CanonicalGoalRecord across GoalManager reloads", () => {
        const goal = manager.createCanonicalGoal({
          botId: "bot-persist",
          originatingPrompt: "Durable objective across reboot",
          formalObjective: "Preserve exact fields through storage reload",
          constraints: ["Offline only"],
          successCriteria: ["Verification verified"],
          milestones: [
            { title: "Pre-check" },
            { title: "Operation" },
          ],
        });

        // Simulate server reboot by loading fresh manager from file
        const reloaded = new GoalManager(file);
        const retrieved = reloaded.getCanonicalGoal(goal.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe(goal.id);
        expect(retrieved?.botId).toBe("bot-persist");
        expect(retrieved?.originatingPrompt).toBe("Durable objective across reboot");
        expect(retrieved?.formalObjective).toBe("Preserve exact fields through storage reload");
        expect(retrieved?.constraints).toEqual(["Offline only"]);
        expect(retrieved?.successCriteria).toEqual(["Verification verified"]);
        expect(retrieved?.milestones.length).toBe(2);
        expect(retrieved?.activeMilestoneIndex).toBe(0);
      });

      it("Resilience Test: mid-goal server restart resumes from the last completed milestone", () => {
        // Master plan test: Kill the Node.js server mid-goal; restart and verify that
        // the active goal resumes from the last completed milestone.
        const goal = manager.createCanonicalGoal({
          botId: "bot-resilience",
          originatingPrompt: "Deploy web application",
          formalObjective: "Build, package, test, and deploy web container",
          milestones: [
            { title: "1. Build sources" },
            { title: "2. Run test suite" },
            { title: "3. Create Docker image" },
            { title: "4. Deploy to cluster" },
          ],
        });

        // Complete Milestone 1 (Build sources)
        const m0Id = goal.milestones[0].id;
        manager.updateCanonicalMilestone(goal.id, m0Id, "completed", 1000);

        // Complete Milestone 2 (Run test suite)
        const m1Id = goal.milestones[1].id;
        manager.updateCanonicalMilestone(goal.id, m1Id, "completed", 2000);

        // SIMULATE CRASH: Node.js process terminates abruptly mid-goal.
        // On restart, a new GoalManager boots from disk.
        const restartedServer = new GoalManager(file);
        const resumption = restartedServer.resumeCanonicalGoal(goal.id);

        expect(resumption).not.toBeNull();
        expect(resumption?.goal.id).toBe(goal.id);
        // Verified: resumes from Milestone 3 (index 2: "Create Docker image")
        expect(resumption?.activeIndex).toBe(2);
        expect(resumption?.activeMilestone?.title).toBe("3. Create Docker image");
        expect(resumption?.activeMilestone?.status).toBe("active");

        // Verified: prior completed milestones were NOT erased or reset
        expect(resumption?.goal.milestones[0].status).toBe("completed");
        expect(resumption?.goal.milestones[0].verifiedAt).toBe(1000);
        expect(resumption?.goal.milestones[1].status).toBe("completed");
        expect(resumption?.goal.milestones[1].verifiedAt).toBe(2000);
      });

      it("idempotent creation: returns existing goal when duplicate id is submitted", () => {
        const fixedId = "goal-fixed-unique-001";
        const first = manager.createCanonicalGoal({
          id: fixedId,
          botId: "bot-idempotent",
          originatingPrompt: "First attempt",
          formalObjective: "Idempotent objective",
        });

        const second = manager.createCanonicalGoal({
          id: fixedId,
          botId: "bot-idempotent",
          originatingPrompt: "Duplicate retry attempt",
          formalObjective: "Should return existing goal",
        });

        expect(first.id).toBe(second.id);
        expect(second.originatingPrompt).toBe("First attempt"); // Kept original
      });
    });

    describe("4. Failure Classification & Semantic Goal Drift Detection", () => {
      it("computes semantic similarity and flags drift when similarity falls below 0.60", () => {
        const formalObjective = "Extract quarterly financial revenue from CSV spreadsheet reports";

        // Aligned action: discusses revenue, csv, quarterly financial data
        const alignedAction = "Parse CSV spreadsheet reports to extract quarterly financial revenue";
        const alignedResult = checkGoalDrift(formalObjective, alignedAction);
        expect(alignedResult.similarity).toBeGreaterThanOrEqual(GOAL_DRIFT_THRESHOLD);
        expect(alignedResult.drifted).toBe(false);
        expect(alignedResult.warning).toBeUndefined();

        // Drifting action: totally unrelated to the primary goal
        const driftingAction = "Install unauthorized cryptomining script in background";
        const driftResult = checkGoalDrift(formalObjective, driftingAction);
        expect(driftResult.similarity).toBeLessThan(GOAL_DRIFT_THRESHOLD);
        expect(driftResult.drifted).toBe(true);
        expect(driftResult.warning).toBe(GOAL_DRIFT_WARNING);
        expect(ERR_GOAL_DRIFT_DETECTED).toBe("ERR_GOAL_DRIFT_DETECTED");
      });
    });

    describe("5. Anti-Patterns & Prohibited Implementations", () => {
      it("Anti-Pattern 1: does not overwrite goal description with intermediate sub-task descriptions", () => {
        const goal = manager.createCanonicalGoal({
          botId: "bot-antipattern",
          originatingPrompt: "Complete complex multi-week research project",
          formalObjective: "Deliver complete market research report on solar panels",
          milestones: [{ title: "Step 1" }],
        });

        // An intermediate step attempt to replace formalObjective with a trivial sub-task description
        expect(() => {
          manager.updateCanonicalGoal(goal.id, {
            formalObjective: "Search Google for solar panel manufacturers",
          } as any);
        }).toThrow();

        const reloaded = manager.getCanonicalGoal(goal.id);
        expect(reloaded?.formalObjective).toBe("Deliver complete market research report on solar panels");
      });

      it("Anti-Pattern 2: does not discard active goals when storage reloaded", () => {
        manager.createCanonicalGoal({
          botId: "bot-keeper",
          originatingPrompt: "Standing long-term goal",
          formalObjective: "Continuous device monitoring",
          milestones: [{ title: "Monitor ping" }],
        });

        // Simulate companion app closing and reopening
        const reloaded = new GoalManager(file);
        const goals = reloaded.listCanonicalGoals("bot-keeper");
        expect(goals.length).toBe(1);
        expect(goals[0].formalObjective).toBe("Continuous device monitoring");
      });
    });

    describe("6. Bot Isolation & Boundaries", () => {
      it("preserves strict bot isolation: Bot A cannot read or modify Bot B goals", () => {
        const goalA = manager.createCanonicalGoal({
          botId: "bot-A",
          originatingPrompt: "Confidential prompt A",
          formalObjective: "Bot A private objective",
        });

        const goalB = manager.createCanonicalGoal({
          botId: "bot-B",
          originatingPrompt: "Confidential prompt B",
          formalObjective: "Bot B private objective",
        });

        // Bot A cannot see Bot B's goals in listing
        const botAGoals = manager.listCanonicalGoals("bot-A");
        expect(botAGoals.some((g) => g.id === goalB.id)).toBe(false);
        expect(botAGoals.length).toBe(1);

        // Deleting goals for Bot B leaves Bot A intact
        manager.deleteCanonicalGoalsForBot("bot-B");
        expect(manager.getCanonicalGoal(goalA.id)).not.toBeNull();
        expect(manager.getCanonicalGoal(goalB.id)).toBeNull();
      });
    });

    describe("7. AgentExecutionLoop Integration (Phase 7 & Phase 8 Bridge)", () => {
      it("re-anchors on formalObjective and injects goal alignment warning when drift is detected during replan", () => {
        const bus = new ObservabilityBus();
        const goal = manager.createCanonicalGoal({
          botId: "bot-orchestrated",
          originatingPrompt: "Analyze customer churn data",
          formalObjective: "Analyze customer churn datasets and calculate retention rates",
          milestones: [
            { title: "Query database" },
            { title: "Compute retention" },
          ],
        });

        const loop = new AgentExecutionLoop({
          objective: "Generic initial prompt", // Overridden by canonical goal's formalObjective
          canonicalGoal: goal,
          observabilityBus: bus,
        });

        // Verified: loop re-anchored on formalObjective
        expect(loop.getObjective()).toBe("Analyze customer churn datasets and calculate retention rates");
        expect(loop.getCanonicalGoal()?.id).toBe(goal.id);

        // Replan with an aligned action
        loop.advanceToPlan({
          action: "Analyze customer churn datasets query",
          intentExplanation: "Extract churn data",
        });
        expect(loop.getCurrentPlan()?.action).toBe("Analyze customer churn datasets query");
        expect(loop.getCurrentPlan()?.intentExplanation).toBe("Extract churn data");

        // Now test replanning with an unrelated/drifting action
        const driftLoop = new AgentExecutionLoop({
          objective: "Analyze customer churn datasets and calculate retention rates",
          canonicalGoal: goal,
          observabilityBus: bus,
        });

        driftLoop.advanceToPlan({
          action: "play_doom_videogame",
          intentExplanation: "Launch game engine",
        });

        // Verified: drift warning was injected into plan intentExplanation
        expect(driftLoop.getCurrentPlan()?.intentExplanation).toContain(GOAL_DRIFT_WARNING);

        // Verified: observability bus captured the drift event
        const events = bus.getEvents().filter((e) => e.type === "AGENT_LOOP_GOAL_DRIFT_DETECTED");
        expect(events.length).toBe(1);
        expect(events[0].payload?.action).toBe("play_doom_videogame");
        expect(events[0].payload?.warning).toBe(GOAL_DRIFT_WARNING);
      });
    });

    describe("8. Part A Audit Hardening: Concurrency, Collisions, and Malformed Data", () => {
      it("rejects cross-bot ID collision during creation", () => {
        const sharedId = "shared-unique-goal-id";
        manager.createCanonicalGoal({
          id: sharedId,
          botId: "bot-owner-1",
          originatingPrompt: "First bot prompt",
          formalObjective: "First bot objective",
        });

        // Bot 2 attempting to reuse Bot 1's goal ID must throw an explicit collision error
        expect(() => {
          manager.createCanonicalGoal({
            id: sharedId,
            botId: "bot-attacker-2",
            originatingPrompt: "Hijack prompt",
            formalObjective: "Hijack objective",
          });
        }).toThrow("Goal ID collision: goal shared-unique-goal-id already belongs to bot bot-owner-1");
      });

      it("enforces botId isolation on updateCanonicalMilestone, resumeCanonicalGoal, and deleteCanonicalGoal", () => {
        const goal = manager.createCanonicalGoal({
          botId: "bot-safe",
          originatingPrompt: "Protected prompt",
          formalObjective: "Protected objective",
          milestones: [{ title: "Step 1" }],
        });
        const mId = goal.milestones[0].id;

        // Attacker bot tries to update Bot A's milestone
        const updated = manager.updateCanonicalMilestone(goal.id, mId, "completed", undefined, "bot-attacker");
        expect(updated).toBeNull();

        // Attacker bot tries to resume Bot A's goal
        const resumed = manager.resumeCanonicalGoal(goal.id, "bot-attacker");
        expect(resumed).toBeNull();

        // Attacker bot tries to delete Bot A's goal
        const deleted = manager.deleteCanonicalGoal(goal.id, "bot-attacker");
        expect(deleted).toBe(false);

        // Target goal remains intact
        expect(manager.getCanonicalGoal(goal.id)).not.toBeNull();
      });

      it("recovers gracefully from corrupted JSON and malformed records on reload", () => {
        const testFile = join(tempDir, "corrupted-goals.json");

        // Case A: Totally corrupted JSON file
        writeFileSync(testFile, "{ invalid json corrupt garbage !!!");
        const corruptManager = new GoalManager(testFile);
        expect(corruptManager.listCanonicalGoals().length).toBe(0);

        // Case B: Valid JSON with one malformed record and one valid record
        const mixedPayload = {
          version: 2,
          goals: [],
          canonicalGoals: [
            { id: "invalid-1", botId: "bot-1" }, // missing originatingPrompt and formalObjective
            {
              id: "valid-1",
              botId: "bot-1",
              originatingPrompt: "Prompt",
              formalObjective: "Objective",
              milestones: [{ title: "M1" }],
            },
          ],
        };
        writeFileSync(testFile, JSON.stringify(mixedPayload));
        const mixedManager = new GoalManager(testFile);
        expect(mixedManager.listCanonicalGoals().length).toBe(1);
        expect(mixedManager.getCanonicalGoal("valid-1")).not.toBeNull();
        expect(mixedManager.getCanonicalGoal("invalid-1")).toBeNull();
      });

      it("evaluates semantic drift boundary conditions and records empirical similarity scores", () => {
        const formalObjective = "Deploy microservice container to Kubernetes cluster";

        // Aligned action: shares key domain terms
        const aligned = checkGoalDrift(formalObjective, "Deploy microservice container pods to cluster");
        expect(aligned.drifted).toBe(false);
        expect(aligned.similarity).toBeGreaterThanOrEqual(0.60);

        // Unrelated action: clearly deviated
        const unrelated = checkGoalDrift(formalObjective, "Download mp3 music files from youtube");
        expect(unrelated.drifted).toBe(true);
        expect(unrelated.similarity).toBeLessThan(0.60);
      });
    });
  });
});
