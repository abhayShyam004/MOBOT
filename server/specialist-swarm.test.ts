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
});
