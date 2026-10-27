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
import {
  resolveAmbiguity,
  validateAmbiguityResolution,
  resumeTaskWithClarification,
  ERR_PARALYSIS_BY_UNCERTAINTY,
  DeviceSafetyPolicy,
  defaultActionAuthorizationManager,
  type AmbiguityResolution,
  type PendingAmbiguityTask,
} from "./capabilities/safety-policy.ts";
import {
  ERR_EXCESSIVE_HEDGING,
  classifyRecommendationRequest,
  detectExcessiveHedging,
  validateRecommendationPayload,
  evaluateRecommendation,
  recoverFromExcessiveHedging,
} from "./recommendation.ts";
import {
  ERR_UNNATURAL_VERBOSITY,
  UnnaturalVerbosityError,
  isGreeting,
  isAcknowledgement,
  isCrisisPrompt,
  determineConversationalCadencePolicy,
  detectUnnaturalVerbosity,
  recoverFromUnnaturalVerbosity,
} from "./conversational-cadence.ts";

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

  // ───────────────────────────────────────────────────────────────────────────
  // OFFICIAL ROADMAP PHASE 15: NATURAL UNCERTAINTY BEHAVIORAL CONTRACT
  // (mobot_54_phases_prompt.md:965-1030)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Official Roadmap Phase 15: Natural Uncertainty Mandatory Behavioral Tests (Scenarios 1-18)", () => {
    it("Scenario 1: 'Summarize the project' identifies active workspace project and proceeds without asking 'Which project do you mean?'", () => {
      const res = resolveAmbiguity({
        userPrompt: "Summarize the project.",
        context: {
          activeWorkspaceProject: "moblot",
        },
      });

      expect(res.strategy).toBe("proceed_with_assumption");
      expect(res.ambiguityType).toBe("minor_preference");
      expect(res.consequenceLevel).toBe("negligible");
      expect(res.clarificationQuestion).toBeUndefined();
      expect(res.statedAssumption).toContain("Summarizing active workspace project: moblot");
    });

    it("Scenario 2: 'Make this document cleaner' selects a sensible, reversible formatting approach without prompting", () => {
      const res = resolveAmbiguity({
        userPrompt: "Make this document cleaner.",
      });

      expect(res.strategy).toBe("proceed_with_assumption");
      expect(res.ambiguityType).toBe("minor_preference");
      expect(res.consequenceLevel).toBe("negligible");
      expect(res.clarificationQuestion).toBeUndefined();
      expect(res.statedAssumption).toBeDefined();
    });

    it("Scenario 3: Harmless ambiguity with an obvious default report in context proceeds autonomously", () => {
      const res = resolveAmbiguity({
        userPrompt: "Summarize this report.",
        context: {
          knownTarget: "annual_financial_audit_2026.pdf",
        },
      });

      expect(res.strategy).toBe("proceed_with_assumption");
      expect(res.ambiguityType).toBe("minor_preference");
      expect(res.consequenceLevel).toBe("negligible");
      expect(res.clarificationQuestion).toBeUndefined();
      expect(res.statedAssumption).toContain("annual_financial_audit_2026.pdf");
    });

    it("Scenario 4: 'Delete the database' with multiple candidates halts, classifies as irreversible_fork, and asks a focused question with 2-4 options", () => {
      const res = resolveAmbiguity({
        userPrompt: "Delete the database.",
        context: {
          availableCandidates: ["production_db", "staging_db", "dev_db"],
          isDestructive: true,
        },
      });

      expect(res.strategy).toBe("ask_focused_question");
      expect(res.ambiguityType).toBe("irreversible_fork");
      expect(res.consequenceLevel).toBe("critical");
      expect(res.clarificationQuestion).toBeDefined();
      expect(res.clarificationQuestion?.options.length).toBeGreaterThanOrEqual(2);
      expect(res.clarificationQuestion?.options.length).toBeLessThanOrEqual(4);
      expect(res.clarificationQuestion?.allowCustomInput).toBe(true);
      expect(res.clarificationQuestion?.options).toEqual(["production_db", "staging_db", "dev_db"]);
    });

    it("Scenario 5: One database is known; ambiguity layer proceeds with target, but Phase 14 confirmation gate still rigorously enforces approval", () => {
      const res = resolveAmbiguity({
        userPrompt: "Delete the database.",
        context: {
          knownTarget: "staging_db",
          isDestructive: true,
          targetCapability: "database",
          operation: "delete",
        },
      });

      // Target is unambiguous so no clarification question is asked
      expect(res.strategy).toBe("proceed_with_assumption");
      expect(res.clarificationQuestion).toBeUndefined();
      expect(res.statedAssumption).toContain("staging_db");

      // Critical Phase 14 gate: Target certainty does NOT bypass action confirmation
      const risk = DeviceSafetyPolicy.assessRisk("database", "delete", { database: "staging_db" });
      expect(risk.risk).toBe("high");
      expect(risk.requiresPrompt).toBe(true);
      expect(risk.consequential).toBe(true);
    });

    it("Scenario 6: Ambiguous recipient asks a focused question and does not guess an arbitrary contact", () => {
      const res = resolveAmbiguity({
        userPrompt: "Send the report to Alex.",
        context: {
          availableCandidates: ["Alex Rivera (Engineering)", "Alex Morgan (Marketing)"],
        },
      });

      expect(res.strategy).toBe("ask_focused_question");
      expect(res.ambiguityType).toBe("critical_intent");
      expect(res.consequenceLevel).toBe("moderate");
      expect(res.clarificationQuestion).toBeDefined();
      expect(res.clarificationQuestion?.options).toEqual([
        "Alex Rivera (Engineering)",
        "Alex Morgan (Marketing)",
      ]);
      expect(res.clarificationQuestion?.allowCustomInput).toBe(true);
    });

    it("Scenario 7: Clear single recipient proceeds without asking an unnecessary question", () => {
      const res = resolveAmbiguity({
        userPrompt: "Send the report to Alex Rivera.",
        context: {
          availableCandidates: ["Alex Rivera"],
        },
      });

      expect(res.strategy).toBe("proceed_with_assumption");
      expect(res.clarificationQuestion).toBeUndefined();
      expect(res.statedAssumption).toContain("Alex Rivera");
    });

    it("Scenario 8: Existing answer present in conversation history is reused without re-asking", () => {
      const res = resolveAmbiguity({
        userPrompt: "Run the data migration script.",
        context: {
          availableCandidates: ["production_db", "staging_db"],
          conversationHistory: [
            { role: "assistant", content: "Which database would you like to run the migration against?" },
            { role: "user", content: "Please use staging_db for this run." },
          ],
        },
      });

      expect(res.strategy).toBe("proceed_with_assumption");
      expect(res.clarificationQuestion).toBeUndefined();
      expect(res.statedAssumption).toContain("staging_db");
    });

    it("Scenario 9: Clarification response resumes the original task with the selected option without losing constraints", () => {
      const pendingTask: PendingAmbiguityTask = {
        taskId: "task_ambig_101",
        conversationId: "conv_main",
        originalPrompt: "Drop database and re-seed with mock fixtures",
        clarificationQuestion: {
          prompt: "Which database do you want to re-seed?",
          options: ["staging_db", "dev_db"],
          allowCustomInput: true,
        },
        targetCapability: "database",
        operation: "reseed",
        parameters: { environment: "test", fixtures: "mock_users.json" },
        createdAtMs: Date.now(),
        resolved: false,
      };

      const resumed = resumeTaskWithClarification(pendingTask, {
        taskId: "task_ambig_101",
        conversationId: "conv_main",
        selectedOptionLabel: "staging_db",
      });

      expect(resumed.success).toBe(true);
      expect(resumed.resolvedTarget).toBe("staging_db");
      expect(resumed.updatedParameters.database).toBe("staging_db");
      expect(resumed.updatedParameters.fixtures).toBe("mock_users.json"); // preserves original constraint
      expect(resumed.updatedParameters.environment).toBe("test");
    });

    it("Scenario 10: Open-text clarification response accepts custom target and validates correctly", () => {
      const pendingTask: PendingAmbiguityTask = {
        taskId: "task_ambig_102",
        conversationId: "conv_main",
        originalPrompt: "Purge temporary cache bucket",
        clarificationQuestion: {
          prompt: "Which cache bucket should be purged?",
          options: ["cache_v1", "cache_v2"],
          allowCustomInput: true,
        },
        targetCapability: "cache",
        operation: "purge",
        createdAtMs: Date.now(),
        resolved: false,
      };

      const resumed = resumeTaskWithClarification(pendingTask, {
        taskId: "task_ambig_102",
        conversationId: "conv_main",
        customText: "ephemeral_redis_replica",
      });

      expect(resumed.success).toBe(true);
      expect(resumed.resolvedTarget).toBe("ephemeral_redis_replica");
      expect(resumed.updatedParameters.target).toBe("ephemeral_redis_replica");
    });

    it("Scenario 11: Prevent nested clarifications; returns exactly one focused question", () => {
      const res = resolveAmbiguity({
        userPrompt: "Update my calendar and move meeting",
        context: {
          availableCandidates: ["Sprint Review", "Design Sync", "1:1 with Lead"],
        },
      });

      expect(res.strategy).toBe("ask_focused_question");
      expect(res.clarificationQuestion).toBeDefined();
      expect(typeof res.clarificationQuestion?.prompt).toBe("string");
      // Exactly 1 question, not an array of nested questions
      expect(Array.isArray(res.clarificationQuestion?.prompt)).toBe(false);
    });

    it("Scenario 12: Low-risk uncertainty-loop recovery triggers ERR_PARALYSIS_BY_UNCERTAINTY recovery with sensible default", () => {
      const res = resolveAmbiguity({
        userPrompt: "Format the notes",
        context: {
          clarificationLoopCount: 2, // Repeated clarification on minor detail
          activeWorkspaceProject: "moblot",
        },
      });

      expect(res.strategy).toBe("proceed_with_assumption");
      expect(res.ambiguityType).toBe("minor_preference");
      expect(res.consequenceLevel).toBe("negligible");
      expect(res.clarificationQuestion).toBeUndefined();
      expect(res.statedAssumption).toContain(ERR_PARALYSIS_BY_UNCERTAINTY);
    });

    it("Scenario 13: High-risk uncertainty-loop recovery NEVER guesses destructive target or bypasses safety decision", () => {
      const res = resolveAmbiguity({
        userPrompt: "Delete the database",
        context: {
          clarificationLoopCount: 2, // Repeated clarification attempt
          isDestructive: true,
          availableCandidates: ["production_db", "staging_db"],
        },
      });

      // Must NOT guess or proceed with assumption!
      expect(res.strategy).toBe("ask_focused_question");
      expect(res.ambiguityType).toBe("irreversible_fork");
      expect(res.consequenceLevel).toBe("critical");
      expect(res.clarificationQuestion).toBeDefined();
    });

    it("Scenario 14: Explicit user correction supersedes initial assumption and updates execution target", () => {
      const res = resolveAmbiguity({
        userPrompt: "Summarize the project",
        context: {
          activeWorkspaceProject: "moblot",
          userCorrections: ["No, summarize project-companion instead"],
        },
      });

      expect(res.strategy).toBe("proceed_with_assumption");
      expect(res.statedAssumption).toContain("Applying explicit user correction: No, summarize project-companion instead");
    });

    it("Scenario 15: Conflicting context asks focused question rather than arbitrarily guessing", () => {
      const res = resolveAmbiguity({
        userPrompt: "Cancel alarm",
        context: {
          availableCandidates: ["Morning 07:00 AM", "Workout 08:30 AM", "Standup 09:30 AM"],
        },
      });

      expect(res.strategy).toBe("ask_focused_question");
      expect(res.ambiguityType).toBe("critical_intent");
      expect(res.consequenceLevel).toBe("moderate");
      expect(res.clarificationQuestion?.options.length).toBe(3);
    });

    it("Scenario 16: Context isolation prevents answers in Conversation A from resolving pending tasks in Conversation B", () => {
      const pendingTask: PendingAmbiguityTask = {
        taskId: "task_convA_1",
        conversationId: "conv_alpha",
        originalPrompt: "Wipe staging cache",
        clarificationQuestion: {
          prompt: "Confirm target?",
          options: ["opt1", "opt2"],
          allowCustomInput: true,
        },
        createdAtMs: Date.now(),
        resolved: false,
      };

      const result = resumeTaskWithClarification(pendingTask, {
        taskId: "task_convA_1",
        conversationId: "conv_beta", // Mismatched conversation
        selectedOptionLabel: "opt1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Conversation ID mismatch");
    });

    it("Scenario 17: Explicitly rejected Phase 14 action cannot be executed by claiming ambiguity resolution", () => {
      const auth = defaultActionAuthorizationManager;
      const deniedTarget = "critical_records_db";

      // Register explicit user denial in Phase 14
      auth.recordDenial("database", "delete", { target: deniedTarget });
      expect(auth.isActionDenied("database", "delete", { target: deniedTarget })).toBe(true);

      // Attempt to resolve ambiguity towards the denied target
      const res = resolveAmbiguity({
        userPrompt: `Delete database ${deniedTarget}`,
        context: {
          knownTarget: deniedTarget,
          isDestructive: true,
        },
      });
      expect(res.strategy).toBe("proceed_with_assumption");

      // Even if target is identified, Phase 14 denial tracking rejects execution
      expect(auth.isActionDenied("database", "delete", { target: deniedTarget })).toBe(true);
      const consumeRes = auth.validateAndConsumeGrant({
        grantId: "non_existent_token",
        capabilityId: "database",
        operation: "delete",
        parameters: { target: deniedTarget },
      });
      expect(consumeRes.valid).toBe(false);
    });

    it("Scenario 18: Zero regression on normal capability paths (read, search, clipboard, summary)", () => {
      const clipboardRes = DeviceSafetyPolicy.evaluateRisk({
        capabilityId: "device.clipboard",
        operation: "get",
        parameters: {},
        approvalMode: "auto",
      });
      expect(clipboardRes.tier).toBe("low");
      expect(clipboardRes.requiresExplicitConfirmation).toBe(false);

      const searchRes = resolveAmbiguity({
        userPrompt: "Search for documentation on Kotlin Coroutines",
      });
      expect(searchRes.strategy).toBe("proceed_with_assumption");
      expect(searchRes.ambiguityType).toBe("minor_preference");
      expect(searchRes.consequenceLevel).toBe("negligible");
    });
  });

  describe("Official Roadmap Phase 15: Adversarial Uncertainty Tests", () => {
    it("Adv 1: rejects empty clarification question prompt", () => {
      const invalid: AmbiguityResolution = {
        ambiguityType: "critical_intent",
        consequenceLevel: "moderate",
        strategy: "ask_focused_question",
        clarificationQuestion: {
          prompt: "   ",
          options: ["Option A", "Option B"],
          allowCustomInput: true,
        },
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("prompt must be a non-empty string"))).toBe(true);
    });

    it("Adv 2: rejects more than four options (>4 options invariant)", () => {
      const invalid: AmbiguityResolution = {
        ambiguityType: "critical_intent",
        consequenceLevel: "moderate",
        strategy: "ask_focused_question",
        clarificationQuestion: {
          prompt: "Which database?",
          options: ["opt1", "opt2", "opt3", "opt4", "opt5"], // 5 options
          allowCustomInput: true,
        },
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("between 2 and 4 choices"))).toBe(true);
    });

    it("Adv 3: rejects fewer than two options (<2 options invariant)", () => {
      const invalid: AmbiguityResolution = {
        ambiguityType: "critical_intent",
        consequenceLevel: "moderate",
        strategy: "ask_focused_question",
        clarificationQuestion: {
          prompt: "Which database?",
          options: ["sole_option"], // 1 option
          allowCustomInput: true,
        },
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("between 2 and 4 choices"))).toBe(true);
    });

    it("Adv 4: rejects duplicate options in clarification question", () => {
      const invalid: AmbiguityResolution = {
        ambiguityType: "critical_intent",
        consequenceLevel: "moderate",
        strategy: "ask_focused_question",
        clarificationQuestion: {
          prompt: "Which database?",
          options: ["production_db", "Production_DB"], // Duplicate case-insensitive
          allowCustomInput: true,
        },
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("Duplicate option detected"))).toBe(true);
    });

    it("Adv 5: rejects invalid ambiguity categories", () => {
      const invalid = {
        ambiguityType: "random_hallucination",
        consequenceLevel: "negligible",
        strategy: "proceed_with_assumption",
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("Invalid ambiguityType"))).toBe(true);
    });

    it("Adv 6: rejects invalid consequence levels", () => {
      const invalid = {
        ambiguityType: "minor_preference",
        consequenceLevel: "apocalyptic",
        strategy: "proceed_with_assumption",
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("Invalid consequenceLevel"))).toBe(true);
    });

    it("Adv 7: rejects invalid strategy values", () => {
      const invalid = {
        ambiguityType: "minor_preference",
        consequenceLevel: "negligible",
        strategy: "guess_silently",
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("Invalid strategy"))).toBe(true);
    });

    it("Adv 8: rejects irreversible_fork with proceed_with_assumption", () => {
      const invalid: AmbiguityResolution = {
        ambiguityType: "irreversible_fork",
        consequenceLevel: "moderate",
        strategy: "proceed_with_assumption",
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("Cannot proceed with assumption for an irreversible_fork"))).toBe(true);
    });

    it("Adv 9: rejects critical consequence level with proceed_with_assumption", () => {
      const invalid: AmbiguityResolution = {
        ambiguityType: "critical_intent",
        consequenceLevel: "critical",
        strategy: "proceed_with_assumption",
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("Cannot proceed with assumption when consequenceLevel is critical"))).toBe(true);
    });

    it("Adv 10: rejects minor_preference with negligible consequence attempting to ask focused question", () => {
      const invalid: AmbiguityResolution = {
        ambiguityType: "minor_preference",
        consequenceLevel: "negligible",
        strategy: "ask_focused_question",
        clarificationQuestion: {
          prompt: "Which font size?",
          options: ["12pt", "14pt"],
          allowCustomInput: true,
        },
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("Cannot ask clarification question for a minor_preference"))).toBe(true);
    });

    it("Adv 11: rejects conflicting fields where proceed_with_assumption provides clarificationQuestion", () => {
      const invalid: AmbiguityResolution = {
        ambiguityType: "minor_preference",
        consequenceLevel: "negligible",
        strategy: "proceed_with_assumption",
        clarificationQuestion: {
          prompt: "Unnecessary question",
          options: ["A", "B"],
          allowCustomInput: true,
        },
      };

      const v = validateAmbiguityResolution(invalid);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("Clarification question must not be provided"))).toBe(true);
    });

    it("Adv 12: clarification answer on high-risk task still requires Phase 14 confirmation grant", () => {
      const pendingTask: PendingAmbiguityTask = {
        taskId: "task_destructive_del",
        conversationId: "conv_1",
        originalPrompt: "Wipe all records in the database",
        clarificationQuestion: {
          prompt: "Which database?",
          options: ["prod_db", "test_db"],
          allowCustomInput: true,
        },
        targetCapability: "device.storage",
        operation: "delete",
        parameters: { wipe: true },
        createdAtMs: Date.now(),
        resolved: false,
      };

      const res = resumeTaskWithClarification(pendingTask, {
        taskId: "task_destructive_del",
        conversationId: "conv_1",
        selectedOptionLabel: "test_db",
      });

      expect(res.success).toBe(true);
      expect(res.resolvedTarget).toBe("test_db");
      // Enforces that clarification is NOT authorization!
      expect(res.requiresPhase14Confirmation).toBe(true);
    });

    it("Adv 13: replaying clarification answer on already settled task is rejected", () => {
      const alreadyResolvedTask: PendingAmbiguityTask = {
        taskId: "task_resolved_1",
        conversationId: "conv_1",
        originalPrompt: "Delete database",
        clarificationQuestion: {
          prompt: "Which db?",
          options: ["a", "b"],
          allowCustomInput: true,
        },
        createdAtMs: Date.now(),
        resolved: true, // Already resolved
      };

      const res = resumeTaskWithClarification(alreadyResolvedTask, {
        taskId: "task_resolved_1",
        conversationId: "conv_1",
        selectedOptionLabel: "a",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("already resolved");
    });

    it("Adv 14: mismatched task ID in answer is rejected", () => {
      const task: PendingAmbiguityTask = {
        taskId: "task_expected_id",
        conversationId: "conv_1",
        originalPrompt: "Move meeting",
        clarificationQuestion: {
          prompt: "Which meeting?",
          options: ["A", "B"],
          allowCustomInput: true,
        },
        createdAtMs: Date.now(),
        resolved: false,
      };

      const res = resumeTaskWithClarification(task, {
        taskId: "wrong_task_id",
        conversationId: "conv_1",
        selectedOptionLabel: "A",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Task ID mismatch");
    });

    it("Adv 15: empty clarification response with no option and no text is rejected", () => {
      const task: PendingAmbiguityTask = {
        taskId: "task_empty_ans",
        conversationId: "conv_1",
        originalPrompt: "Move meeting",
        clarificationQuestion: {
          prompt: "Which meeting?",
          options: ["A", "B"],
          allowCustomInput: true,
        },
        createdAtMs: Date.now(),
        resolved: false,
      };

      const res = resumeTaskWithClarification(task, {
        taskId: "task_empty_ans",
        conversationId: "conv_1",
        customText: "   ",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("did not provide an option or custom text");
    });
  });

  describe("Official Roadmap Phase 17: Judgment and Recommendations Mandatory Behavioral Tests (Scenarios 1-20)", () => {
    it("Scenario 1: Canonical SQLite versus PostgreSQL decision unequivocally recommends SQLite", () => {
      const prompt = "Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?";
      const rec = evaluateRecommendation({ userPrompt: prompt });

      // Unequivocal recommendation for SQLite
      expect(rec.recommendedOption).toBe("SQLite");
      expect(rec.optionsEvaluated.map((o) => o.name)).toContain("SQLite");
      expect(rec.optionsEvaluated.map((o) => o.name)).toContain("PostgreSQL");

      // Connects to embedded, in-process local architecture
      expect(rec.rationale.toLowerCase()).toContain("embedded");
      expect(rec.rationale.toLowerCase()).toContain("mobile");
      expect(rec.rationale.toLowerCase()).toContain("local");

      // Identifies PostgreSQL's strengths for centralized server workloads
      const pgOption = rec.optionsEvaluated.find((o) => o.name === "PostgreSQL");
      expect(pgOption?.pros.join(" ").toLowerCase()).toContain("enterprise");
      expect(pgOption?.pros.join(" ").toLowerCase()).toContain("concurrent");

      // Identifies critical trade-off (lacks native network listener / centralized shared backend requirement)
      expect(rec.criticalTradeoff.toLowerCase()).toContain("centralized");

      // Separates technical facts from judgment
      expect(rec.distinctionBetweenFactAndOpinion).toContain("Fact:");
      expect(rec.distinctionBetweenFactAndOpinion).toContain("Judgment:");
      expect(rec.distinctionBetweenFactAndOpinion.toLowerCase()).toContain("in-process");

      // Does not contain fake benchmark numbers or fabricated ms measurements
      expect(rec.rationale).not.toMatch(/\b\d+ms\b|\b\d+%\s+faster\b/);
    });

    it("Scenario 2: Explicit request for a recommendation makes a clear decision", () => {
      const prompt = "What should I do? I need a simple local database for my mobile app.";
      const reqClass = classifyRecommendationRequest(prompt);
      expect(reqClass).toBe("explicit_advice");

      const rec = evaluateRecommendation({ userPrompt: prompt });
      expect(rec.recommendedOption).toBe("SQLite");
      expect(rec.recommendedOption).not.toBe("");
      expect(rec.recommendedOption.toLowerCase()).not.toContain("it depends");
    });

    it("Scenario 3: Explicit comparison evaluates differences and recommends SQLite for Android app", () => {
      const prompt = "Compare SQLite and PostgreSQL for an Android application.";
      const reqClass = classifyRecommendationRequest(prompt);
      expect(reqClass).toBe("explicit_comparison");

      const rec = evaluateRecommendation({ userPrompt: prompt });
      expect(rec.optionsEvaluated.length).toBeGreaterThanOrEqual(2);
      expect(rec.recommendedOption).toBe("SQLite");
      expect(rec.primaryDecisionCriterion).toBeDefined();
    });

    it("Scenario 4: Preference for maintainability prioritizes clean modular design over micro-benchmarks", () => {
      const prompt = "Which implementation should I choose if maintainability matters more than maximum performance?";
      const rec = evaluateRecommendation({ userPrompt: prompt });

      expect(rec.primaryDecisionCriterion?.toLowerCase()).toContain("maintainability");
      expect(rec.recommendedOption.toLowerCase()).toContain("maintainable");
      expect(rec.criticalTradeoff.toLowerCase()).toContain("overhead");
    });

    it("Scenario 5: Preference for implementation speed balances delivery and regression prevention", () => {
      const prompt = "Which approach gets this small feature working fastest without making the code fragile?";
      const rec = evaluateRecommendation({ userPrompt: prompt });

      expect(rec.primaryDecisionCriterion?.toLowerCase()).toContain("delivery");
      expect(rec.recommendedOption.toLowerCase()).toContain("pragmatic direct implementation");
      expect(rec.rationale.toLowerCase()).toContain("fastest");
    });

    it("Scenario 6: Purely factual question produces factual classification without unsolicited recommendation", () => {
      const prompt = "What is PostgreSQL?";
      const reqClass = classifyRecommendationRequest(prompt);
      expect(reqClass).toBe("purely_factual");
    });

    it("Scenario 7: User asks for pros and cons only classifies as explicit comparison with structured options", () => {
      const prompt = "List the pros and cons of SQLite and PostgreSQL.";
      const reqClass = classifyRecommendationRequest(prompt);
      expect(reqClass).toBe("explicit_comparison");

      const rec = evaluateRecommendation({ userPrompt: prompt });
      expect(rec.optionsEvaluated.length).toBe(2);
      for (const opt of rec.optionsEvaluated) {
        expect(opt.pros.length).toBeGreaterThanOrEqual(1);
        expect(opt.cons.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("Scenario 8: User explicitly asks 'What should I do?' mandates a clear recommendation", () => {
      const prompt = "What should I do? Should I choose SQLite or PostgreSQL for a lightweight mobile app?";
      const reqClass = classifyRecommendationRequest(prompt);
      expect(reqClass).toBe("explicit_advice");

      const rec = evaluateRecommendation({ userPrompt: prompt });
      expect(rec.recommendedOption).toBeTruthy();
      expect(rec.recommendedOption).not.toBe("both have merit");
    });

    it("Scenario 9: One option is clearly a better fit directly selects that option", () => {
      const prompt = "Which database should I use for an offline embedded mobile catalog: SQLite or PostgreSQL?";
      const rec = evaluateRecommendation({ userPrompt: prompt });
      expect(rec.recommendedOption).toBe("SQLite");
    });

    it("Scenario 10: Materially changed requirements switch the recommendation to PostgreSQL", () => {
      const prompt = "Which database should I use for a centralized multi-user backend with heavy concurrent writes: SQLite or PostgreSQL?";
      const rec = evaluateRecommendation({ userPrompt: prompt });

      // Changed requirement switches decision to PostgreSQL!
      expect(rec.recommendedOption).toBe("PostgreSQL");
      expect(rec.primaryDecisionCriterion?.toLowerCase()).toContain("centralized");
      expect(rec.rationale.toLowerCase()).toContain("centralized multi-user backend");
      expect(rec.criticalTradeoff.toLowerCase()).toContain("server infrastructure");
    });

    it("Scenario 11: Insufficient evidence produces calibrated provisional recommendation", () => {
      const prompt = "Which database should I use?";
      const rec = evaluateRecommendation({ userPrompt: prompt });
      expect(rec.recommendedOption).toBeTruthy();
      expect(rec.distinctionBetweenFactAndOpinion).toContain("Fact:");
      expect(rec.distinctionBetweenFactAndOpinion).toContain("Judgment:");
    });

    it("Scenario 12: Conflicting constraints are explicitly recognized and compromise recommended", () => {
      const prompt = "I need zero latency, zero server overhead, and unlimited remote concurrent writes for 1000 users. Which database?";
      const rec = evaluateRecommendation({ userPrompt: prompt });
      expect(rec.criticalTradeoff).toBeDefined();
      expect(rec.distinctionBetweenFactAndOpinion).toBeDefined();
    });

    it("Scenario 13: Dangerous or unverified option is strictly rejected by validation", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Safe Option", pros: ["safe"], cons: ["slow"] },
            { name: "Dangerous Option", pros: ["fast"], cons: ["rm -rf /"] },
          ],
          recommendedOption: "Dangerous Option with rm -rf /",
          rationale: "Quickest wipe via rm -rf /",
          criticalTradeoff: "Deletes everything",
          distinctionBetweenFactAndOpinion: "Fact: Deletes system. Judgment: Fast.",
        });
      }).toThrow(/Prohibited: Cannot recommend dangerous/i);
    });

    it("Scenario 14: High-consequence ambiguous request classifies as high_impact_ambiguous", () => {
      const prompt = "Which production database should I delete?";
      const reqClass = classifyRecommendationRequest(prompt);
      expect(reqClass).toBe("high_impact_ambiguous");
    });

    it("Scenario 15: Excessive hedging recovery replaces indecisive evasion with direct recommendation", () => {
      const hedgedText = "Well, it depends. Both have merit. There is no right answer, and it really comes down to your needs. Whichever works for you is fine.";
      const detection = detectExcessiveHedging(hedgedText, {
        userPrompt: "Which database should I use for a lightweight mobile app?",
        isAdviceRequest: true,
      });

      expect(detection.hasExcessiveHedging).toBe(true);
      expect(detection.disclaimerCount).toBeGreaterThan(3);
      expect(detection.hasConclusion).toBe(false);

      const recovered = recoverFromExcessiveHedging(hedgedText, {
        userPrompt: "Which database should I use for a lightweight mobile app: SQLite or PostgreSQL?",
      });

      expect(recovered).toContain("Recommendation:");
      expect(recovered).toContain("SQLite");
      expect(recovered).toContain("Primary Decision Criterion:");
      expect(recovered).toContain("Decisive Rationale:");
      expect(recovered).toContain("Critical Trade-Off:");
    });

    it("Scenario 16: Legitimate uncertainty acknowledges constraints without generic noncommittal phrases", () => {
      const text = "SQLite is embedded while PostgreSQL is client-server. Given your lightweight mobile requirement, I recommend SQLite.";
      const detection = detectExcessiveHedging(text, { isAdviceRequest: true });
      expect(detection.hasExcessiveHedging).toBe(false);
    });

    it("Scenario 17: Recommendation consistency catches mismatched recommendedOption", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "SQLite", pros: ["embedded"], cons: ["locking"] },
            { name: "PostgreSQL", pros: ["concurrency"], cons: ["overhead"] },
          ],
          recommendedOption: "MongoDB", // Not evaluated!
          rationale: "Good for documents",
          criticalTradeoff: "No relational schema",
          distinctionBetweenFactAndOpinion: "Fact: Document store. Judgment: Flexible.",
        });
      }).toThrow(/not present in optionsEvaluated/i);
    });

    it("Scenario 18: Facts versus judgment clearly articulated in payload", () => {
      const rec = evaluateRecommendation({
        userPrompt: "Which database should I use for a lightweight mobile app: SQLite or PostgreSQL?",
      });
      expect(rec.distinctionBetweenFactAndOpinion).toContain("Fact:");
      expect(rec.distinctionBetweenFactAndOpinion).toContain("Judgment:");
    });

    it("Scenario 19: Phase 16 response formatting integrates cleanly with recommendation", async () => {
      const { determineResponseFormattingPlan } = await import("./screen-frame-gate.ts");
      const plan = determineResponseFormattingPlan({
        userPrompt: "Which database should I use for a lightweight mobile app: SQLite or PostgreSQL?",
      });
      // Advice / comparison uses tabular_comparison or short_conversational, without generic templates
      expect(["short_conversational", "tabular_comparison"]).toContain(plan.shape);
      expect(plan.includeVisualAttachment).toBe(false);
    });

    it("Scenario 20: Existing regression behavior verifies Phase 13, 14, 15, and 16 invariants", () => {
      expect(ERR_EXCESSIVE_HEDGING).toBe("ERR_EXCESSIVE_HEDGING");
      expect(ERR_PARALYSIS_BY_UNCERTAINTY).toBe("ERR_PARALYSIS_BY_UNCERTAINTY");
    });
  });

  describe("Official Roadmap Phase 17: Adversarial Recommendation & Anti-Hedging Tests (1-15)", () => {
    it("Adv 1: Rejects empty recommendedOption", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "A", pros: ["p1"], cons: ["c1"] },
            { name: "B", pros: ["p2"], cons: ["c2"] },
          ],
          recommendedOption: "   ",
          rationale: "Valid rationale here",
          criticalTradeoff: "Valid tradeoff here",
          distinctionBetweenFactAndOpinion: "Fact vs opinion",
        });
      }).toThrow(/recommendedOption must be a non-empty string/i);
    });

    it("Adv 2: Rejects recommendation not represented in evaluated choices", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Alpha", pros: ["fast"], cons: ["cost"] },
            { name: "Beta", pros: ["cheap"], cons: ["slow"] },
          ],
          recommendedOption: "Gamma",
          rationale: "Valid rationale here",
          criticalTradeoff: "Valid tradeoff here",
          distinctionBetweenFactAndOpinion: "Fact vs opinion",
        });
      }).toThrow(/not present in optionsEvaluated/i);
    });

    it("Adv 3: Rejects evasion phrases in recommendedOption ('all options have merits', 'it depends')", () => {
      for (const evasion of ["all options have merits", "it depends on your preference", "both have merit", "it depends", "up to you"]) {
        expect(() => {
          validateRecommendationPayload({
            optionsEvaluated: [
              { name: "Alpha", pros: ["fast"], cons: ["cost"] },
              { name: "Beta", pros: ["cheap"], cons: ["slow"] },
            ],
            recommendedOption: evasion,
            rationale: "Valid rationale here",
            criticalTradeoff: "Valid tradeoff here",
            distinctionBetweenFactAndOpinion: "Fact vs opinion",
          });
        }).toThrow(/cannot be a generic evasion phrase/i);
      }
    });

    it("Adv 4: Rejects empty rationale", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Alpha", pros: ["fast"], cons: ["cost"] },
            { name: "Beta", pros: ["cheap"], cons: ["slow"] },
          ],
          recommendedOption: "Alpha",
          rationale: "   ",
          criticalTradeoff: "Valid tradeoff here",
          distinctionBetweenFactAndOpinion: "Fact vs opinion",
        });
      }).toThrow(/rationale must be a non-empty explanation/i);
    });

    it("Adv 5: Rejects empty critical trade-off", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Alpha", pros: ["fast"], cons: ["cost"] },
            { name: "Beta", pros: ["cheap"], cons: ["slow"] },
          ],
          recommendedOption: "Alpha",
          rationale: "Valid rationale here",
          criticalTradeoff: "   ",
          distinctionBetweenFactAndOpinion: "Fact vs opinion",
        });
      }).toThrow(/criticalTradeoff must be a concrete disadvantage/i);
    });

    it("Adv 6: Rejects generic trade-off ('every option has pros and cons')", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Alpha", pros: ["fast"], cons: ["cost"] },
            { name: "Beta", pros: ["cheap"], cons: ["slow"] },
          ],
          recommendedOption: "Alpha",
          rationale: "Valid rationale here",
          criticalTradeoff: "Every option has pros and cons",
          distinctionBetweenFactAndOpinion: "Fact vs opinion",
        });
      }).toThrow(/cannot be an empty generalization/i);
    });

    it("Adv 7: Rejects empty distinction between fact and opinion", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Alpha", pros: ["fast"], cons: ["cost"] },
            { name: "Beta", pros: ["cheap"], cons: ["slow"] },
          ],
          recommendedOption: "Alpha",
          rationale: "Valid rationale here",
          criticalTradeoff: "Concrete tradeoff here",
          distinctionBetweenFactAndOpinion: "   ",
        });
      }).toThrow(/distinctionBetweenFactAndOpinion must clearly articulate/i);
    });

    it("Adv 8: Rejects fewer than two evaluated options", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Only One", pros: ["fast"], cons: ["cost"] },
          ],
          recommendedOption: "Only One",
          rationale: "Valid rationale here",
          criticalTradeoff: "Concrete tradeoff here",
          distinctionBetweenFactAndOpinion: "Fact vs opinion",
        });
      }).toThrow(/must be an array of at least 2 evaluated options/i);
    });

    it("Adv 9: Rejects option with empty pros or empty cons", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Alpha", pros: [], cons: ["cost"] },
            { name: "Beta", pros: ["cheap"], cons: ["slow"] },
          ],
          recommendedOption: "Beta",
          rationale: "Valid rationale here",
          criticalTradeoff: "Concrete tradeoff here",
          distinctionBetweenFactAndOpinion: "Fact vs opinion",
        });
      }).toThrow(/must have at least one valid pro/i);
    });

    it("Adv 10: Rejects duplicate option names", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Alpha", pros: ["fast"], cons: ["cost"] },
            { name: "alpha", pros: ["cheap"], cons: ["slow"] },
          ],
          recommendedOption: "Alpha",
          rationale: "Valid rationale here",
          criticalTradeoff: "Concrete tradeoff here",
          distinctionBetweenFactAndOpinion: "Fact vs opinion",
        });
      }).toThrow(/Duplicate option evaluated/i);
    });

    it("Adv 11: Rejects dangerous keyword in recommendation ('kill -9 1', 'bypass security')", () => {
      expect(() => {
        validateRecommendationPayload({
          optionsEvaluated: [
            { name: "Safe", pros: ["reliable"], cons: ["slow"] },
            { name: "Bypass", pros: ["fast"], cons: ["risky"] },
          ],
          recommendedOption: "Bypass security",
          rationale: "Bypasses all safety checks to run fast",
          criticalTradeoff: "No security",
          distinctionBetweenFactAndOpinion: "Fact: Insecure. Judgment: Fast.",
        });
      }).toThrow(/Prohibited: Cannot recommend dangerous/i);
    });

    it("Adv 12: Hedging detection ignores purely factual queries", () => {
      const factualQuery = "What is a database index?";
      const text = "A database index is a data structure that improves retrieval speed.";
      const res = detectExcessiveHedging(text, { userPrompt: factualQuery });
      expect(res.hasExcessiveHedging).toBe(false);
    });

    it("Adv 13: Hedging detection triggers when >3 disclaimer phrases without conclusion", () => {
      const text = "It depends. Both have merit. There is no right answer, and whichever works for you is fine.";
      const res = detectExcessiveHedging(text, {
        userPrompt: "Which framework should I pick?",
        isAdviceRequest: true,
      });
      expect(res.hasExcessiveHedging).toBe(true);
      expect(res.disclaimerCount).toBeGreaterThan(3);
    });

    it("Adv 14: Hedging detection does NOT trigger when a clear conclusion is present", () => {
      const text = "It depends on your scale. Both have merit, but ultimately I recommend PostgreSQL because your app needs central concurrency.";
      const res = detectExcessiveHedging(text, {
        userPrompt: "Which database should I use?",
        isAdviceRequest: true,
      });
      expect(res.hasExcessiveHedging).toBe(false);
      expect(res.hasConclusion).toBe(true);
    });

    it("Adv 15: Single qualification with strong recommendation does not trigger hedging error", () => {
      const text = "While both are good options, you should choose SQLite for its lightweight embedded design.";
      const res = detectExcessiveHedging(text, {
        userPrompt: "Which database should I use?",
        isAdviceRequest: true,
      });
      expect(res.hasExcessiveHedging).toBe(false);
    });
  });

  describe("Official Roadmap Phase 18: Natural Conversation Mandatory Behavioral Tests (Scenarios 1-15)", () => {
    it("Scenario 1: One-word greeting ('Hey') receives a 1-sentence warm reply, not a feature menu", () => {
      const prompt = "Hey";
      expect(isGreeting(prompt)).toBe(true);
      const policy = determineConversationalCadencePolicy(prompt);
      expect(policy.conversationalMode).toBe("casual");
      expect(policy.targetSentenceCount).toBe(1);
      expect(policy.suppressBulletPoints).toBe(true);

      const naturalReply = "Hey! What are you working on today?";
      const check = detectUnnaturalVerbosity(naturalReply, { userPrompt: prompt });
      expect(check.hasUnnaturalVerbosity).toBe(false);
      expect(check.isGreeting).toBe(true);
    });

    it("Scenario 2: Canonical acknowledgement test: 'Thanks, that worked!' receives a brief natural acknowledgement", () => {
      const userPrompt = "Thanks, that worked!";
      expect(isAcknowledgement(userPrompt)).toBe(true);
      const policy = determineConversationalCadencePolicy(userPrompt);
      expect(policy.conversationalMode).toBe("casual");
      expect(policy.targetSentenceCount).toBe(1);

      const naturalAck = "Glad to hear that. Let me know when you're ready for the next step.";
      const check = detectUnnaturalVerbosity(naturalAck, { userPrompt });
      expect(check.hasUnnaturalVerbosity).toBe(false);
      expect(check.isAcknowledgement).toBe(true);
    });

    it("Scenario 3: Morning greeting ('Morning') receives a warm single-sentence reply", () => {
      const prompt = "Morning";
      expect(isGreeting(prompt)).toBe(true);
      const reply = recoverFromUnnaturalVerbosity("", { userPrompt: prompt });
      expect(reply).toBe("Good morning! What are you working on today?");
      expect(reply.split(/[.!?]+/).filter(Boolean).length).toBe(2); // Two short clauses/sentences
    });

    it("Scenario 4: Casual mode policy enforces bullet point suppression and casual cadence", () => {
      const policy = determineConversationalCadencePolicy("How's it going?");
      expect(policy.conversationalMode).toBe("casual");
      expect(policy.allowSlangOrColloquialism).toBe(true);
      expect(policy.suppressBulletPoints).toBe(true);
      expect(policy.targetSentenceCount).toBe(1);
    });

    it("Scenario 5: Work mode policy permits technical depth and structured presentation", () => {
      const policy = determineConversationalCadencePolicy("Refactor the auth middleware to handle JWT rotation");
      expect(policy.conversationalMode).toBe("work");
      expect(policy.allowSlangOrColloquialism).toBe(false);
      expect(policy.suppressBulletPoints).toBe(false);
      expect(policy.targetSentenceCount).toBe(4);
    });

    it("Scenario 6: Crisis mode policy prioritizes immediate direct action without slang", () => {
      const policy = determineConversationalCadencePolicy("Production is down! Database crashed!");
      expect(policy.conversationalMode).toBe("crisis");
      expect(policy.allowSlangOrColloquialism).toBe(false);
      expect(policy.suppressBulletPoints).toBe(false);
      expect(policy.targetSentenceCount).toBe(2);
    });

    it("Scenario 7: Retains conversational context across rapid back-and-forth dialogue", () => {
      const history = [
        { role: "user", text: "Compare SQLite and PostgreSQL." },
        { role: "bot", text: "SQLite is embedded; PostgreSQL is a central server. SQLite is better for local apps." },
        { role: "user", text: "What about the second one?" },
      ];
      const lastUser = history[history.length - 1]!.text;
      // Should not treat "What about the second one?" as an isolated mystery or ask "What do you mean?"
      expect(lastUser).toContain("second one");
      const policy = determineConversationalCadencePolicy(lastUser, history);
      expect(policy.conversationalMode).toBe("work");
    });

    it("Scenario 8: Conversational greeting yielding >100 words triggers ERR_UNNATURAL_VERBOSITY", () => {
      const longGreetingReply = Array.from({ length: 110 }, (_, i) => `word${i + 1}`).join(" ") + ".";
      const check = detectUnnaturalVerbosity(longGreetingReply, { userPrompt: "Hey" });
      expect(check.hasUnnaturalVerbosity).toBe(true);
      expect(check.wordCount).toBeGreaterThan(100);
      expect(check.reasons[0]).toContain(ERR_UNNATURAL_VERBOSITY);
    });

    it("Scenario 9: Dynamic prompt guard truncates canned pleasantries and feature catalogues", () => {
      const bloatedReply =
        "Hello! I am delighted to help you today. Here is what I can do for you:\n" +
        "- Software engineering\n" +
        "- Natural language processing\n" +
        "- Research analysis\n" +
        "- Multi-agent coordination\n" +
        "Please let me know how I can be of assistance today!";

      const check = detectUnnaturalVerbosity(bloatedReply, { userPrompt: "Hey" });
      expect(check.hasUnnaturalVerbosity).toBe(true);
      expect(check.containsUnsolicitedCatalogue).toBe(true);

      const recovered = recoverFromUnnaturalVerbosity(bloatedReply, { userPrompt: "Hey" });
      expect(recovered).toBe("Hey! What are you working on today?");
    });

    it("Scenario 10: Acknowledgement yielding >100 words triggers ERR_UNNATURAL_VERBOSITY", () => {
      const bloatedAck =
        "You are very welcome! In this task, we successfully reviewed the entire codebase, inspected all forty modules, " +
        "compiled the native Android packages, verified the accessibility services, tested the audio focus gates, " +
        "ran the test suite across three hundred assertions, verified the background services, and confirmed that " +
        "the local SQLite database file is synchronized properly. Furthermore, we audited the speech dictation pipeline, " +
        "ensured that audio routing operates independently of the alarm clock, verified that all automated test scenarios pass, " +
        "checked each conversational cadence policy, and validated the device logs. Please let me know if you would like me to conduct " +
        "further analysis or if there are other tasks you would like to initiate today.";

      const check = detectUnnaturalVerbosity(bloatedAck, { userPrompt: "Thanks, that worked!" });
      expect(check.hasUnnaturalVerbosity).toBe(true);
      expect(check.wordCount).toBeGreaterThan(100);
      expect(check.reasons[0]).toContain(ERR_UNNATURAL_VERBOSITY);
    });

    it("Scenario 11: Acknowledgement recovery restores concise natural acknowledgement", () => {
      const recovered = recoverFromUnnaturalVerbosity("Bloated multi-paragraph explanation...", {
        userPrompt: "Thanks, that worked!",
      });
      expect(recovered).toBe("Glad to hear that. Let me know when you're ready for the next step.");
    });

    it("Scenario 12: Prohibited canned introduction is strictly caught and rejected", () => {
      const prohibited =
        "Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals?";
      const check = detectUnnaturalVerbosity(prohibited, { userPrompt: "Hello" });
      expect(check.hasUnnaturalVerbosity).toBe(true);
      expect(check.containsProhibitedGreeting).toBe(true);

      const recovered = recoverFromUnnaturalVerbosity(prohibited, { userPrompt: "Hello" });
      expect(recovered).toBe("Hey! What are you working on today?");
    });

    it("Scenario 13: Substantive technical question maintains technical precision and is not falsely flagged", () => {
      const technicalQuery = "How do I configure WAL mode in SQLite?";
      const technicalAnswer =
        "To enable Write-Ahead Logging in SQLite, execute `PRAGMA journal_mode=WAL;`. " +
        "This allows concurrent readers while a write is occurring and significantly improves write performance for mobile applications.";

      expect(isGreeting(technicalQuery)).toBe(false);
      expect(isAcknowledgement(technicalQuery)).toBe(false);

      const check = detectUnnaturalVerbosity(technicalAnswer, { userPrompt: technicalQuery });
      expect(check.hasUnnaturalVerbosity).toBe(false);
    });

    it("Scenario 14: Integrates cleanly with Phase 17 recommendation behavior", () => {
      const adviceQuery = "Which database should I use for a lightweight local mobile app: SQLite or PostgreSQL?";
      const policy = determineConversationalCadencePolicy(adviceQuery);
      expect(policy.conversationalMode).toBe("work");
      expect(policy.suppressBulletPoints).toBe(false);

      const rec = evaluateRecommendation({ userPrompt: adviceQuery });
      expect(rec.recommendedOption).toBe("SQLite");
    });

    it("Scenario 15: Integrates cleanly with Phase 15 natural uncertainty without paralysis", () => {
      const ambiguityQuery = "Summarize the project";
      const resolution = resolveAmbiguity({ userPrompt: ambiguityQuery });
      expect(resolution.strategy).toBe("proceed_with_assumption");
      expect(resolution.consequenceLevel).toBe("negligible");
    });
  });

  describe("Official Roadmap Phase 18: Adversarial Conversational Cadence & Verbosity Tests (1-10)", () => {
    it("Adv 1: Rejects canned greeting embedded in multi-paragraph text", () => {
      const text =
        "Good morning! Hello! I am MOBOT, your AI assistant. How may I assist you today with your coding, research, or productivity goals? Here are my instructions.";
      const check = detectUnnaturalVerbosity(text, { userPrompt: "Hi" });
      expect(check.hasUnnaturalVerbosity).toBe(true);
      expect(check.containsProhibitedGreeting).toBe(true);
    });

    it("Adv 2: Rejects unsolicited feature list on one-word greeting", () => {
      const text = "Hi there! I can help you with:\n1. Coding\n2. Documentation\n3. Automation";
      const check = detectUnnaturalVerbosity(text, { userPrompt: "Hi" });
      expect(check.hasUnnaturalVerbosity).toBe(true);
      expect(check.containsUnsolicitedCatalogue).toBe(true);
    });

    it("Adv 3: Greeting with varied punctuation correctly recognized as greeting", () => {
      expect(isGreeting("Hey!")).toBe(true);
      expect(isGreeting("Morning.")).toBe(true);
      expect(isGreeting("Yo!!")).toBe(true);
      expect(isGreeting("Good morning :)")).toBe(true);
      expect(isGreeting("Hey MOBOT")).toBe(true);
    });

    it("Adv 4: Variations of gratitude correctly recognized as acknowledgements", () => {
      expect(isAcknowledgement("Appreciate it!")).toBe(true);
      expect(isAcknowledgement("Cheers")).toBe(true);
      expect(isAcknowledgement("Awesome thanks")).toBe(true);
      expect(isAcknowledgement("Thanks, that worked!")).toBe(true);
      expect(isAcknowledgement("Thank you MOBOT")).toBe(true);
    });

    it("Adv 5: Crisis expressions correctly classified as crisis mode", () => {
      expect(isCrisisPrompt("The server crashed with kernel panic!")).toBe(true);
      expect(isCrisisPrompt("Site is down, 503 service unavailable")).toBe(true);
      expect(isCrisisPrompt("Production outage in region us-east")).toBe(true);
      expect(isCrisisPrompt("Security breach detected in auth service")).toBe(true);
    });

    it("Adv 6: Technical coding requests classified as work mode, not casual", () => {
      const policy = determineConversationalCadencePolicy("Write a binary search tree in Kotlin");
      expect(policy.conversationalMode).toBe("work");
      expect(policy.allowSlangOrColloquialism).toBe(false);
      expect(policy.suppressBulletPoints).toBe(false);
    });

    it("Adv 7: Mixed prompt ('Hey MOBOT, production is down') prioritizes crisis over greeting", () => {
      const policy = determineConversationalCadencePolicy("Hey MOBOT, production is down!");
      expect(policy.conversationalMode).toBe("crisis");
    });

    it("Adv 8: Mixed prompt ('Hi, which database should I pick?') prioritizes work/advice over pure greeting", () => {
      const prompt = "Hi, which database should I pick?";
      expect(isGreeting(prompt)).toBe(false); // Not a pure one-word greeting
      const policy = determineConversationalCadencePolicy(prompt);
      expect(policy.conversationalMode).toBe("work");
    });

    it("Adv 9: UnnaturalVerbosityError contains ERR_UNNATURAL_VERBOSITY code", () => {
      const err = new UnnaturalVerbosityError();
      expect(err.code).toBe(ERR_UNNATURAL_VERBOSITY);
      expect(err.name).toBe("UnnaturalVerbosityError");
      expect(err.message).toContain("ERR_UNNATURAL_VERBOSITY");
    });

    it("Adv 10: Dynamic recovery generates polite time-of-day appropriate greetings", () => {
      expect(recoverFromUnnaturalVerbosity("Bloated intro", { userPrompt: "Morning" })).toContain("Good morning");
      expect(recoverFromUnnaturalVerbosity("Bloated intro", { userPrompt: "Good evening" })).toContain("Good evening");
      expect(recoverFromUnnaturalVerbosity("Bloated intro", { userPrompt: "Afternoon" })).toContain("Good afternoon");
      expect(recoverFromUnnaturalVerbosity("Bloated intro", { userPrompt: "Hey" })).toContain("Hey!");
    });
  });
});
