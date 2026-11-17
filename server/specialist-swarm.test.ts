import { describe, it, expect } from "vitest";
import { SpecialistSwarmCoordinator } from "./specialist-swarm.ts";

describe("SpecialistSwarmCoordinator", () => {
  it("dispatches multiple specialists in parallel and aggregates results with provenance", async () => {
    const coordinator = new SpecialistSwarmCoordinator();

    const result = await coordinator.dispatch({
      botId: "bot-eval",
      mainTask: "Evaluate laptop options under ₹80,000",
      specialists: [
        {
          role: "research",
          focus: "Candidate models",
          prompt: "Find programming laptops on https://example.com/laptops",
        },
        {
          role: "specification",
          focus: "RAM & CPU requirements",
          prompt: "Verify 16GB RAM and multicore processor suitability",
        },
        {
          role: "price",
          focus: "Retailer pricing",
          prompt: "Check official retail prices under ₹80,000",
        },
      ],
    });

    expect(result.specialistCount).toBe(3);
    expect(result.results.length).toBe(3);
    expect(result.results.every((r) => r.status === "succeeded")).toBe(true);
    expect(result.synthesis.sources).toContain("https://example.com/laptops");
    expect(result.synthesis.summary).toContain("3 specialist evaluations");
  });

  it("handles specialist failures gracefully without failing the entire swarm", async () => {
    const coordinator = new SpecialistSwarmCoordinator(async (task) => {
      if (task.role === "failing-role") {
        throw new Error("Network timeout during fetch");
      }
      return {
        output: `Data for ${task.focus}`,
        provenance: {
          verifiedFacts: [`Fact for ${task.focus}`],
          sourceUrls: ["https://example.com/source"],
          inferences: [],
          recommendations: [],
        },
      };
    });

    const result = await coordinator.dispatch({
      botId: "bot-eval",
      mainTask: "Test fault tolerance",
      specialists: [
        { role: "good-role", focus: "Component A", prompt: "Inspect A" },
        { role: "failing-role", focus: "Component B", prompt: "Inspect B" },
      ],
    });

    expect(result.specialistCount).toBe(2);
    const good = result.results.find((r) => r.role === "good-role");
    const bad = result.results.find((r) => r.role === "failing-role");

    expect(good?.status).toBe("succeeded");
    expect(bad?.status).toBe("failed");
    expect(bad?.error).toContain("Network timeout during fetch");

    // Synthesis still produced for successful specialists
    expect(result.synthesis.verifiedFacts).toContain("Fact for Component A");
  });

  it("Phase 31: preserves role specialization and enforces individual heuristics across swarm", async () => {
    const coordinator = new SpecialistSwarmCoordinator();

    const result = await coordinator.dispatch({
      botId: "bot-team",
      mainTask: "Implement resilient API client with automated tests and dependency-ordered rollout",
      specialists: [
        {
          role: "researcher",
          focus: "HTTP Retry RFC Standards",
          prompt: "Investigate exponential backoff in RFC 9110 on https://www.rfc-editor.org/rfc/rfc9110",
          specialization: {
            roleId: "researcher",
            heuristics: {
              defaultSearchDepth: "exhaustive",
              minimumSourceCitations: 2,
            },
            customPromptInjections: ["Focus on jitter algorithms"],
          },
        },
        {
          role: "coder",
          focus: "Retry Middleware Implementation",
          prompt: "Write TypeScript retry middleware with test suite",
          specialization: {
            roleId: "coder",
            heuristics: {
              defaultSearchDepth: "shallow",
              requireAutomatedTestRun: true,
            },
            customPromptInjections: ["Use vitest assertions"],
          },
        },
        {
          role: "planner",
          focus: "Migration Milestones",
          prompt: "Define sequenced rollout dependencies",
          specialization: {
            roleId: "planner",
            heuristics: {
              defaultSearchDepth: "shallow",
              requireDependencyOrdering: true,
            },
            customPromptInjections: ["Strict dependency trees only"],
          },
        },
      ],
    });

    expect(result.specialistCount).toBe(3);
    expect(result.results.length).toBe(3);

    const researcher = result.results.find((r) => r.role === "researcher");
    const coder = result.results.find((r) => r.role === "coder");
    const planner = result.results.find((r) => r.role === "planner");

    // Researcher provenance checks
    expect(researcher?.status).toBe("succeeded");
    expect(researcher?.specialization?.heuristics.defaultSearchDepth).toBe("exhaustive");
    expect(researcher?.specialization?.heuristics.minimumSourceCitations).toBe(2);
    expect(researcher?.provenance.sourceUrls.length).toBeGreaterThanOrEqual(2);
    expect(researcher?.output).toContain("Research & Evidence Evaluation");

    // Coder provenance checks
    expect(coder?.status).toBe("succeeded");
    expect(coder?.specialization?.heuristics.requireAutomatedTestRun).toBe(true);
    expect(coder?.provenance.testResults?.[0]?.passed).toBe(true);
    expect(coder?.output).toContain("Implementation & Verification");

    // Planner provenance checks
    expect(planner?.status).toBe("succeeded");
    expect(planner?.specialization?.heuristics.requireDependencyOrdering).toBe(true);
    expect(planner?.provenance.dependencyPlan?.executionOrder.length).toBeGreaterThanOrEqual(3);
    expect(planner?.output).toContain("Structured Dependency Plan");

    // Synthesis aggregates all sources and verified facts with provenance
    expect(result.synthesis.sources).toContain("https://www.rfc-editor.org/rfc/rfc9110");
    expect(result.synthesis.verifiedFacts.length).toBeGreaterThanOrEqual(3);
  });

  it("Phase 31: isolates specialist execution context and traps boundary overstep without crashing swarm", async () => {
    const { checkSpecialistToolBoundary } = await import("./specialization.ts");

    const coordinator = new SpecialistSwarmCoordinator(async (task) => {
      // Check tool boundary for the task
      const roleId = task.specialization?.roleId ?? (task.role as any);
      if (task.focus === "prohibited-shell-attempt") {
        const boundary = checkSpecialistToolBoundary(roleId, "bash_exec");
        if (!boundary.allowed && boundary.error) {
          throw boundary.error;
        }
      }
      return {
        output: `Analysis for ${task.focus}`,
        provenance: {
          verifiedFacts: [`Fact for ${task.focus}`],
          sourceUrls: ["https://example.com/valid"],
          inferences: [],
          recommendations: [],
        },
      };
    });

    const result = await coordinator.dispatch({
      botId: "bot-boundary-test",
      mainTask: "Adversarial swarm boundary test",
      specialists: [
        {
          role: "researcher",
          focus: "prohibited-shell-attempt",
          prompt: "Run shell command to check directory",
          specialization: {
            roleId: "researcher",
            heuristics: { defaultSearchDepth: "deep" },
            customPromptInjections: [],
          },
        },
        {
          role: "coder",
          focus: "allowed-coding-task",
          prompt: "Write unit test",
          specialization: {
            roleId: "coder",
            heuristics: { defaultSearchDepth: "shallow", requireAutomatedTestRun: true },
            customPromptInjections: [],
          },
        },
      ],
    });

    const bad = result.results.find((r) => r.focus === "prohibited-shell-attempt");
    const good = result.results.find((r) => r.focus === "allowed-coding-task");

    expect(bad?.status).toBe("failed");
    expect(bad?.boundaryViolation?.code).toBe("ERR_SPECIALIST_BOUNDARY_OVERSTEP");
    expect(bad?.boundaryViolation?.attemptedCapability).toContain("Shell/Terminal");
    expect(bad?.boundaryViolation?.recoverySuggestion).toContain("Coder specialist");

    // Good specialist succeeded
    expect(good?.status).toBe("succeeded");
    expect(good?.output).toContain("Analysis for allowed-coding-task");
    expect(result.synthesis.verifiedFacts).toContain("Fact for allowed-coding-task");
  });
});
