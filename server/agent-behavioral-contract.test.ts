import { describe, expect, it } from "vitest";
import {
  JOKE_TELLER_PRESET,
  STUDY_BUDDY_PRESET,
  IDEA_GENERATOR_PRESET,
  PERSONAL_RESEARCHER_PRESET,
  PROBLEM_SOLVER_PRESET,
  compileAgentContractPrompt,
  rankToolsByAffinity,
  resolveAgentContract,
} from "../shared/agent-contract.ts";

describe("Behavioral Role Differentiation", () => {
  it("generates distinct cognitive stances between Joke Teller and Problem Solver", () => {
    const jokePrompt = compileAgentContractPrompt(JOKE_TELLER_PRESET);
    const solverPrompt = compileAgentContractPrompt(PROBLEM_SOLVER_PRESET);

    // Joke Teller has divergent creativity and relaxed verification
    expect(jokePrompt).toContain("Creativity Bias: DIVERGENT");
    expect(jokePrompt).toContain("Reasoning Depth: CONCISE");
    expect(jokePrompt).toContain("Rigor Level: RELAXED");
    expect(jokePrompt).toContain("Tone Profile: humorous, upbeat, punchy");

    // Problem Solver has conservative creativity, adversarial skepticism, and strict verification
    expect(solverPrompt).toContain("Creativity Bias: CONSERVATIVE");
    expect(solverPrompt).toContain("Skepticism Level: ADVERSARIAL");
    expect(solverPrompt).toContain("Reasoning Depth: EXHAUSTIVE");
    expect(solverPrompt).toContain("Rigor Level: STRICT");
    expect(solverPrompt).toContain("Tone Profile: sharp, technical, precise, diagnostic");

    // Clear observable divergence
    expect(jokePrompt).not.toEqual(solverPrompt);
  });

  it("generates distinct stances between Study Buddy and Idea Generator", () => {
    const studyPrompt = compileAgentContractPrompt(STUDY_BUDDY_PRESET);
    const ideaPrompt = compileAgentContractPrompt(IDEA_GENERATOR_PRESET);

    // Study Buddy emphasizes pedagogical rigor and recall
    expect(studyPrompt).toContain("Reasoning Depth: DEEP");
    expect(studyPrompt).toContain("Persistent Memory: HIGH");
    expect(studyPrompt).toContain("Rigor Level: STANDARD");
    expect(studyPrompt).toContain("Socratic dialogue");

    // Idea Generator emphasizes breakthrough brainstorming and expansive thinking
    expect(ideaPrompt).toContain("Creativity Bias: HIGH");
    expect(ideaPrompt).toContain("Preferred Format: BULLETED");
    expect(ideaPrompt).toContain("brainstorm");

    expect(studyPrompt).not.toEqual(ideaPrompt);
  });

  it("Personal Researcher prioritizes verified sources and strict empirical checks", () => {
    const researcherPrompt = compileAgentContractPrompt(PERSONAL_RESEARCHER_PRESET);

    expect(researcherPrompt).toContain("Skepticism Level: CRITICAL");
    expect(researcherPrompt).toContain("Rigor Level: STRICT");
    expect(researcherPrompt).toContain("Artifact Validation: ENABLED");
    expect(researcherPrompt).toContain("Preferred Tool Categories: web_search, browser, resource, network");
  });

  it("shows observable tool ranking divergence between roles on identical toolset", () => {
    const fullToolset = [
      "run_shell",
      "terminal_write",
      "web_search",
      "browser_open",
      "verify_service",
      "delight_joke",
      "process_start",
      "resource_fetch",
    ];

    const solverRanking = rankToolsByAffinity(PROBLEM_SOLVER_PRESET, fullToolset);
    const researcherRanking = rankToolsByAffinity(PERSONAL_RESEARCHER_PRESET, fullToolset);
    const jokeRanking = rankToolsByAffinity(JOKE_TELLER_PRESET, fullToolset);

    // Problem Solver prioritizes shell & verification tools
    expect(solverRanking.prioritized).toContain("run_shell");
    expect(solverRanking.prioritized).toContain("verify_service");
    expect(solverRanking.prioritized).toContain("process_start");

    // Researcher prioritizes web search, browser, and resource fetch
    expect(researcherRanking.prioritized).toContain("web_search");
    expect(researcherRanking.prioritized).toContain("browser_open");
    expect(researcherRanking.prioritized).toContain("resource_fetch");

    // Joke Teller prioritizes delight and web search, deprioritizes shell and process
    expect(jokeRanking.prioritized).toContain("delight_joke");
    expect(jokeRanking.deprioritized).toContain("run_shell");
    expect(jokeRanking.deprioritized).toContain("process_start");
  });

  it("INVARIANT 15: Contract preserves bot identity when resolving starter bots", () => {
    const starterTogepi = resolveAgentContract({
      name: "Togepi",
      title: "Joke Teller",
      description: "A playful, funny friend that tells jokes.",
    });

    expect(starterTogepi.role).toBe("joke_teller");
    expect(starterTogepi.identity.name).toBe("Togepi");
    expect(starterTogepi.roleTitle).toBe("Joke Teller");
    expect(starterTogepi.cognitiveStance.creativityBias).toBe("divergent");
  });
});

describe("Official Roadmap Phase 9: Self-Evaluation Behavioral Contract (mobot_54_phases_prompt.md:641-690)", () => {
  it("Unit Test: Mock a search tool returning 'No results found'; verify self-evaluation rejects completion and triggers an alternative query", async () => {
    const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");
    const { ObservabilityBus } = await import("./capabilities/observability.ts");
    const { ERR_EMPTY_OR_JUNK_PAYLOAD } = await import("./capabilities/safety-policy.ts");

    const bus = new ObservabilityBus();
    let turn = 0;

    const loop = new AgentExecutionLoop({
      objective: "Find contact information for Alice",
      observabilityBus: bus,
      stepHandler: async (plan) => {
        turn++;
        if (turn === 1) {
          // Turn 1: Search returns empty match (No results found)
          return {
            action: plan.action,
            success: true,
            rawOutput: { results: [] },
            resultSummary: "No results found for query 'Alice'",
          };
        }
        // Turn 2: Alternative query returns real contact info
        return {
          action: plan.action,
          success: true,
          rawOutput: { results: [{ name: "Alice Smith", email: "alice.smith@example.com" }] },
          resultSummary: "Found 1 contact: Alice Smith (alice.smith@example.com)",
        };
      },
    });

    // Step 1: Search returns "No results found"
    await loop.step();

    const state1 = loop.getState();
    const eval1 = loop.getLastSelfEvaluation();

    // Verify self-evaluation rejects completion
    expect(state1.phase).toBe("act");
    expect(eval1).toBeDefined();
    expect(eval1?.semanticSuccess).toBe(false);
    expect(eval1?.objectiveCompleted).toBe(false);
    expect(eval1?.criticism).toContain(ERR_EMPTY_OR_JUNK_PAYLOAD);
    expect(eval1?.recommendedAction).toBe("retry_with_variation");

    // Verify replan action formulated with self-correction guidance
    const nextPlan = loop.getCurrentPlan();
    expect(nextPlan).toBeDefined();
    expect(nextPlan?.action).toContain("replan_query");
    expect(nextPlan?.intentExplanation).toContain("Self-correcting after semantic failure");

    // Observability telemetry was emitted
    const failureEvents = bus.getEvents({ type: "AGENT_LOOP_SEMANTIC_FAILURE" });
    expect(failureEvents.length).toBe(1);
    expect(failureEvents[0].payload.criticism).toContain(ERR_EMPTY_OR_JUNK_PAYLOAD);

    // Step 2: Alternative query succeeds with real findings
    await loop.step();

    const state2 = loop.getState();
    const eval2 = loop.getLastSelfEvaluation();

    expect(state2.phase).toBe("complete");
    expect(state2.terminationReason).toBe("goal_achieved");
    expect(eval2?.semanticSuccess).toBe(true);
    expect(eval2?.objectiveCompleted).toBe(true);
    expect(eval2?.usefulnessScore).toBeGreaterThanOrEqual(8);
    expect(eval2?.recommendedAction).toBe("finalize");
  });

  it("Behavioral Test: Request the agent to produce a structured JSON summary; verify invalid JSON outputs trigger self-correction rather than immediate user delivery", async () => {
    const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");
    const { ObservabilityBus } = await import("./capabilities/observability.ts");

    const bus = new ObservabilityBus();
    let turn = 0;

    const loop = new AgentExecutionLoop({
      objective: "Generate a structured JSON summary of system diagnostics",
      observabilityBus: bus,
      stepHandler: async (plan) => {
        turn++;
        if (turn === 1) {
          // Turn 1: Corrupted / invalid JSON payload (unclosed bracket, syntax error)
          return {
            action: plan.action,
            success: true,
            rawOutput: '{\n  "status": "warning",\n  "cpuUsage": 45,\n  "issues": ["disk_low",',
            resultSummary: "Generated diagnostic summary",
          };
        }
        // Turn 2: Repaired / valid JSON payload
        return {
          action: plan.action,
          success: true,
          rawOutput: '{\n  "status": "warning",\n  "cpuUsage": 45,\n  "issues": ["disk_low"]\n}',
          resultSummary: '{\n  "status": "warning",\n  "cpuUsage": 45,\n  "issues": ["disk_low"]\n}',
        };
      },
    });

    // Step 1: Invalid JSON produced
    await loop.step();

    const state1 = loop.getState();
    const eval1 = loop.getLastSelfEvaluation();

    // Verify invalid JSON triggers self-correction rather than user delivery
    expect(state1.phase).toBe("act");
    expect(eval1?.semanticSuccess).toBe(false);
    expect(eval1?.objectiveCompleted).toBe(false);
    expect(eval1?.criticism).toContain("Corrupted payload: Invalid JSON structure generated");
    expect(eval1?.recommendedAction).toBe("retry_with_variation");

    // Step 2: Valid JSON produced
    await loop.step();

    const state2 = loop.getState();
    const eval2 = loop.getLastSelfEvaluation();

    expect(state2.phase).toBe("complete");
    expect(state2.terminationReason).toBe("goal_achieved");
    expect(eval2?.semanticSuccess).toBe(true);
    expect(eval2?.objectiveCompleted).toBe(true);
    expect(eval2?.usefulnessScore).toBeGreaterThanOrEqual(8);
  });

  it("Anti-Pattern: blocks completion when a tool generates an empty file (0-byte artifact)", async () => {
    const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");
    const { ERR_EMPTY_OR_JUNK_PAYLOAD } = await import("./capabilities/safety-policy.ts");

    const loop = new AgentExecutionLoop({
      objective: "Save monthly expenditure report to PDF",
      stepHandler: async () => ({
        action: "write_pdf_report",
        success: true,
        rawOutput: { path: "/storage/reports/monthly.pdf", size: 0, bytesWritten: 0 },
        resultSummary: "Wrote report to /storage/reports/monthly.pdf",
      }),
      // Custom evaluation handler attempts to claim completion despite empty file
      evaluationHandler: () => ({
        phase: "complete",
        terminationReason: "goal_achieved",
        reason: "File write completed",
      }),
    });

    await loop.step();

    const state = loop.getState();
    const evalResult = loop.getLastSelfEvaluation();

    // Invariant guard blocked completion!
    expect(state.phase).toBe("act");
    expect(evalResult?.semanticSuccess).toBe(false);
    expect(evalResult?.criticism).toContain(ERR_EMPTY_OR_JUNK_PAYLOAD);
    expect(evalResult?.criticism).toContain("empty (0-byte) file or artifact");
  });

  it("Anti-Pattern: strictly enforces self-evaluation when a turn involves destructive state mutations", async () => {
    const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");
    const { isConsequentialAction } = await import("./capabilities/safety-policy.ts");

    // 1. Policy confirms file deletion is consequential
    expect(isConsequentialAction("device.files", "delete", { path: "important.db" })).toBe(true);

    // 2. Destructive action without state verification is rejected
    const loop = new AgentExecutionLoop({
      objective: "Clean up temporary cache files",
      initialPlan: {
        action: "delete_cache",
        capabilityId: "device.files",
        operation: "delete",
        params: { path: "temp.cache" },
      },
      stepHandler: async () => ({
        action: "delete_cache",
        success: true,
        rawOutput: {}, // no evidence of file deletion
        resultSummary: "Operation completed",
      }),
    });

    await loop.step();

    const evalResult = loop.getLastSelfEvaluation();
    expect(evalResult?.semanticSuccess).toBe(false);
    expect(evalResult?.criticism).toContain("Consequential operation did not produce verifiable state mutation confirmation");
    expect(loop.getState().phase).toBe("act");

    // 3. When deletion confirms state mutation, evaluation succeeds
    const loop2 = new AgentExecutionLoop({
      objective: "Clean up temporary cache files",
      initialPlan: {
        action: "delete_cache",
        capabilityId: "device.files",
        operation: "delete",
        params: { path: "temp.cache" },
      },
      stepHandler: async () => ({
        action: "delete_cache",
        success: true,
        rawOutput: { deleted: true, path: "temp.cache" },
        resultSummary: "Successfully deleted temporary file temp.cache",
      }),
    });

    await loop2.step();

    const evalResult2 = loop2.getLastSelfEvaluation();
    expect(evalResult2?.semanticSuccess).toBe(true);
    expect(evalResult2?.objectiveCompleted).toBe(true);
    expect(loop2.getState().phase).toBe("complete");
  });

  it("Classification & Protocol: detects error payloads disguised inside HTTP 200", async () => {
    const { evaluateActionOutcome, ERR_EMPTY_OR_JUNK_PAYLOAD } = await import("./capabilities/safety-policy.ts");

    const evalRes = evaluateActionOutcome({
      actionId: "test_disguised_err",
      action: "fetch_exchange_rates",
      technicalSuccess: true, // HTTP 200 technically
      rawOutput: {
        error: "Rate limit exceeded (429)",
        status: "error",
      },
      resultSummary: "HTTP 200 OK",
      objective: "Get latest EUR/USD conversion rates",
    });

    expect(evalRes.semanticSuccess).toBe(false);
    expect(evalRes.usefulnessScore).toBe(0);
    expect(evalRes.criticism).toContain(ERR_EMPTY_OR_JUNK_PAYLOAD);
    expect(evalRes.criticism).toContain("Rate limit exceeded");
    expect(evalRes.recommendedAction).toBe("switch_strategy");
  });

  it("Milestone Progression: valid intermediate payload advances milestone without prematurely completing objective", async () => {
    const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");
    const { GoalManager } = await import("./goals.ts");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const gm = new GoalManager(join(tmpdir(), `goals_eval_${Date.now()}.json`));
    const canonicalGoal = gm.createCanonicalGoal({
      botId: "bot_eval_tester",
      originatingPrompt: "Compile user activity and generate security audit report",
      formalObjective: "Audit user activity and produce security audit report",
      successCriteria: [
        "Extracted 50 user login records",
        "Generated security audit report",
      ],
    });

    let stepCount = 0;
    const loop = new AgentExecutionLoop({
      canonicalGoal,
      objective: canonicalGoal.formalObjective,
      stepHandler: async (plan) => {
        stepCount++;
        if (stepCount === 1) {
          return {
            action: plan.action,
            success: true,
            rawOutput: { recordCount: 50, records: [{ user: "bob", ip: "10.0.0.1" }] },
            resultSummary: "Extracted 50 user login records from database",
          };
        }
        return {
          action: plan.action,
          success: true,
          rawOutput: { reportPath: "/reports/security_audit.pdf", hash: "a1b2c3" },
          resultSummary: "Generated security audit report successfully",
        };
      },
    });

    // Step 1: First criterion met (partial progress)
    await loop.step();

    const state1 = loop.getState();
    const eval1 = loop.getLastSelfEvaluation();

    expect(state1.phase).toBe("act"); // Progress Valid -> advance milestone!
    expect(eval1?.semanticSuccess).toBe(true);
    expect(eval1?.objectiveCompleted).toBe(false);
    expect(eval1?.usefulnessScore).toBeGreaterThanOrEqual(4);
    expect(eval1?.usefulnessScore).toBeLessThanOrEqual(7);
    expect(eval1?.criticism).toContain("Partial progress: 1/2 success criteria satisfied");

    // Step 2: Second criterion met (all criteria fulfilled)
    await loop.step();

    const state2 = loop.getState();
    const eval2 = loop.getLastSelfEvaluation();

    expect(state2.phase).toBe("complete");
    expect(state2.terminationReason).toBe("goal_achieved");
    expect(eval2?.semanticSuccess).toBe(true);
    expect(eval2?.objectiveCompleted).toBe(true);
    expect(eval2?.usefulnessScore).toBe(10);
    expect(eval2?.criticism).toContain("All 2 success criteria verified");
  });

  describe("Gate B Closure: Hardened Completion Invariants & False Success/Failure Guards", () => {
    it("Gate B 1: completion guard blocks faulty custom evaluator when semanticSuccess=true but objectiveCompleted=false", async () => {
      const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");
      const { GoalManager } = await import("./goals.ts");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const gm = new GoalManager(join(tmpdir(), `goals_gateb_${Date.now()}.json`));
      const canonicalGoal = gm.createCanonicalGoal({
        botId: "bot_gateb_tester",
        originatingPrompt: "Analyze customer churn and write retention proposal",
        formalObjective: "Analyze churn data and author retention proposal",
        successCriteria: [
          "Calculated monthly churn rate",
          "Authored retention proposal document",
        ],
      });

      // Step 1 only calculates churn rate (1/2 criteria met)
      const loop = new AgentExecutionLoop({
        canonicalGoal,
        objective: canonicalGoal.formalObjective,
        stepHandler: async (plan) => ({
          action: plan.action,
          success: true,
          rawOutput: { churnRate: "4.2%" },
          resultSummary: "Calculated monthly churn rate: 4.2%",
        }),
        // Faulty custom evaluator attempts to claim completion despite objective being incomplete
        evaluationHandler: () => ({
          phase: "complete",
          terminationReason: "goal_achieved",
          reason: "Premature completion claim by faulty evaluator",
        }),
      });

      await loop.step();

      const state = loop.getState();
      const evalResult = loop.getLastSelfEvaluation();

      // Invariant verified: semanticSuccess=true but objectiveCompleted=false cannot bypass completion guard!
      expect(evalResult?.semanticSuccess).toBe(true);
      expect(evalResult?.objectiveCompleted).toBe(false);
      expect(state.phase).toBe("act");
      expect(state.terminationReason).toBeUndefined();
      expect(loop.getCurrentPlan()?.action).toContain("advance_milestone_2");
    });

    it("Gate B 2: completion guard blocks custom evaluator when technicalSuccess=false", async () => {
      const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");

      const loop = new AgentExecutionLoop({
        objective: "Sync workspace files",
        stepHandler: async () => ({
          action: "sync_files",
          success: false,
          error: "Connection timed out",
          resultSummary: "Failed to connect to sync endpoint",
        }),
        // Contradictory custom evaluator attempts to complete failed step
        evaluationHandler: () => ({
          phase: "complete",
          terminationReason: "goal_achieved",
        }),
      });

      await loop.step();

      // Verified: technical failure cannot be completed by evaluator
      expect(loop.getState().phase).toBe("act");
      expect(loop.getCurrentPlan()?.action).toContain("replan_query");
    });

    it("Gate B 3: permits empty results when emptiness is the expected functional outcome", async () => {
      const { evaluateActionOutcome } = await import("./capabilities/safety-policy.ts");

      const evalRes = evaluateActionOutcome({
        actionId: "verify_no_errors",
        action: "scan_error_log",
        technicalSuccess: true,
        rawOutput: { results: [] },
        resultSummary: "0 results matching error criteria",
        objective: "Assert no errors found in diagnostic log",
      });

      expect(evalRes.semanticSuccess).toBe(true);
      expect(evalRes.objectiveCompleted).toBe(true);
      expect(evalRes.usefulnessScore).toBe(10);
      expect(evalRes.recommendedAction).toBe("finalize");
      expect(evalRes.criticism).toContain("Verified empty result array");
    });

    it("Gate B 4: traps non-empty error strings returned under technical success", async () => {
      const { evaluateActionOutcome, ERR_EMPTY_OR_JUNK_PAYLOAD } = await import("./capabilities/safety-policy.ts");

      const evalRes = evaluateActionOutcome({
        actionId: "test_explicit_err_string",
        action: "execute_remote_rpc",
        technicalSuccess: true, // HTTP 200 technically from proxy
        rawOutput: "Error: connect ECONNREFUSED 127.0.0.1:8080",
        resultSummary: "Error: connect ECONNREFUSED 127.0.0.1:8080",
        objective: "Query remote service health status",
      });

      expect(evalRes.semanticSuccess).toBe(false);
      expect(evalRes.usefulnessScore).toBe(0);
      expect(evalRes.criticism).toContain(ERR_EMPTY_OR_JUNK_PAYLOAD);
      expect(evalRes.criticism).toContain("Tool returned error text despite technical success");
      expect(evalRes.recommendedAction).toBe("switch_strategy");
    });

    it("Gate B 5: rejects bare tool assertion of success on consequential mutations without verified state change", async () => {
      const { evaluateActionOutcome } = await import("./capabilities/safety-policy.ts");

      // Bare tool claim without mutation confirmation
      const evalRes = evaluateActionOutcome({
        actionId: "delete_test",
        action: "delete_record",
        capabilityId: "device.files",
        operation: "delete",
        params: { path: "sensitive.dat" },
        technicalSuccess: true,
        rawOutput: { success: true }, // bare assertion
        resultSummary: "ok",
        objective: "Delete sensitive.dat file",
      });

      expect(evalRes.semanticSuccess).toBe(false);
      expect(evalRes.criticism).toContain("bare tool claim rejected");
      expect(evalRes.recommendedAction).toBe("switch_strategy");
    });
  });
});
