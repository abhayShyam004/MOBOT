// Autonomous Build / Test / Fix Loop (Phase E)
//
// Implements the authoritative lifecycle from MOBOT_MASTER_PROMPT.md:
//   PLAN -> IMPLEMENT -> BUILD -> TEST -> (FAIL?) -> ANALYZE -> FIX -> RETEST -> LOCAL PREVIEW -> USER REVIEW -> ITERATE
//
// Enforces:
// 1. Hard retry limits (default 3) to prevent endless loops.
// 2. Structured failure classification (syntax, typecheck, missing module, runtime, assertion, product ambiguity).
// 3. Clear bifurcation: ordinary coding errors auto-fixed; ambiguous decisions escalated to ask_user.
// 4. State tracking: attempt count, failure class, last successful stage.

import type { ProjectManager } from "./project-manager.ts";

export type LoopStage =
  | "plan"
  | "implement"
  | "build"
  | "test"
  | "analyze"
  | "fix"
  | "retest"
  | "preview"
  | "user_review"
  | "complete";

export type FailureClass =
  | "syntax_error"
  | "typecheck_error"
  | "missing_module"
  | "runtime_exception"
  | "test_assertion"
  | "port_collision"
  | "ambiguous_or_product_decision"
  | "unknown_failure";

export interface FailureAnalysis {
  failureClass: FailureClass;
  isAutoFixable: boolean;
  summary: string;
  targetFile?: string;
  lineNumber?: number;
  extractedError?: string;
  recommendedAction: string;
  userDecisionPrompt?: string;
  userDecisionOptions?: string[];
}

export interface LoopAttemptRecord {
  attempt: number;
  stage: LoopStage;
  timestamp: string;
  failureClass?: FailureClass;
  error?: string;
  fixDescription?: string;
  successful: boolean;
}

export interface LoopState {
  projectId: string;
  stage: LoopStage;
  attemptCount: number;
  maxAttempts: number;
  lastSuccessfulStage: LoopStage | null;
  history: LoopAttemptRecord[];
  requiresUserDecision: boolean;
  userDecisionPrompt?: string;
  userDecisionOptions?: string[];
  resolved: boolean;
}

export interface AutonomousCycleResult {
  success: boolean;
  projectId: string;
  finalStage: LoopStage;
  lastSuccessfulStage: LoopStage | null;
  attemptsUsed: number;
  maxAttempts: number;
  failureAnalysis?: FailureAnalysis;
  requiresUser: boolean;
  userPrompt?: string;
  userOptions?: string[];
  history: LoopAttemptRecord[];
}

export class AutonomousRepairLoop {
  private readonly projectManager: ProjectManager;
  private readonly maxAttempts: number;
  private readonly states = new Map<string, LoopState>();

  constructor(projectManager: ProjectManager, maxAttempts = 3) {
    this.projectManager = projectManager;
    this.maxAttempts = maxAttempts;
  }

  getLoopState(projectId: string): LoopState {
    let state = this.states.get(projectId);
    if (!state) {
      state = {
        projectId,
        stage: "plan",
        attemptCount: 0,
        maxAttempts: this.maxAttempts,
        lastSuccessfulStage: null,
        history: [],
        requiresUserDecision: false,
        resolved: false,
      };
      this.states.set(projectId, state);
    }
    return state;
  }

  resetLoop(projectId: string): void {
    this.states.delete(projectId);
  }

  /**
   * Classify failures from build/test stdout and stderr.
   */
  classifyFailure(stdout: string, stderr: string, error?: string): FailureAnalysis {
    const combined = `${stderr}\n${stdout}\n${error || ""}`.trim();

    // 1. Ambiguous requirements or external credential / business logic
    if (
      /missing (api[_-]?key|secret|token|credentials)|environment variable .* required|authentication failed|auth required/i.test(
        combined
      )
    ) {
      return {
        failureClass: "ambiguous_or_product_decision",
        isAutoFixable: false,
        summary: "External credential or environment configuration required.",
        extractedError: combined.slice(0, 300),
        recommendedAction: "Prompt user for required environment variable or service credentials.",
        userDecisionPrompt: "An external API key or credential is required to proceed. How would you like to configure it?",
        userDecisionOptions: ["Provide API Key / Secret now", "Mock external API for local testing", "Skip this integration"],
      };
    }

    if (
      /ambiguous requirement|choose between|product decision|business logic conflict/i.test(
        combined
      )
    ) {
      return {
        failureClass: "ambiguous_or_product_decision",
        isAutoFixable: false,
        summary: "Product or architecture ambiguity detected.",
        extractedError: combined.slice(0, 300),
        recommendedAction: "Escalate to user via ask_user.",
        userDecisionPrompt: "A product decision is required to proceed with this implementation.",
        userDecisionOptions: ["Proceed with Option A", "Proceed with Option B", "Cancel change"],
      };
    }

    // 2. Syntax Errors
    const syntaxMatch = combined.match(/(SyntaxError|Unexpected token|Unexpected identifier|Parsing error):?\s*([^\n]+)/i);
    if (syntaxMatch) {
      const fileMatch = combined.match(/([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+):(\d+):?(\d+)?/);
      return {
        failureClass: "syntax_error",
        isAutoFixable: true,
        summary: `Syntax error: ${syntaxMatch[2] || syntaxMatch[1]}`,
        targetFile: fileMatch ? fileMatch[1] : undefined,
        lineNumber: fileMatch ? parseInt(fileMatch[2], 10) : undefined,
        extractedError: syntaxMatch[0],
        recommendedAction: "Inspect syntax around indicated line and correct syntax error.",
      };
    }

    // 3. TypeScript Typecheck Errors
    const tsMatch = combined.match(/error TS(\d+):\s*([^\n]+)/i);
    if (tsMatch) {
      const fileMatch = combined.match(/([a-zA-Z0-9_\-./]+\.tsx?):(\d+):?(\d+)?/);
      return {
        failureClass: "typecheck_error",
        isAutoFixable: true,
        summary: `TypeScript type error (TS${tsMatch[1]}): ${tsMatch[2]}`,
        targetFile: fileMatch ? fileMatch[1] : undefined,
        lineNumber: fileMatch ? parseInt(fileMatch[2], 10) : undefined,
        extractedError: tsMatch[0],
        recommendedAction: "Align type definitions and function signatures to satisfy typechecker.",
      };
    }

    // 4. Missing Module / Import Error
    const moduleMatch = combined.match(/(Cannot find module|MODULE_NOT_FOUND|Failed to resolve import|Could not resolve)\s*['"]([^'"]+)['"]/i);
    if (moduleMatch) {
      return {
        failureClass: "missing_module",
        isAutoFixable: true,
        summary: `Missing module dependency: ${moduleMatch[2]}`,
        extractedError: moduleMatch[0],
        recommendedAction: `Provide local replacement, vendor module, or install dependency "${moduleMatch[2]}".`,
      };
    }

    // 5. Port collision
    if (/EADDRINUSE|address already in use/i.test(combined)) {
      return {
        failureClass: "port_collision",
        isAutoFixable: true,
        summary: "Target port is currently in use by another process.",
        extractedError: "EADDRINUSE",
        recommendedAction: "Allocate an alternate port or terminate orphaned process.",
      };
    }

    // 6. Test Assertion Failure
    const specificAssertMatch = combined.match(/(AssertionError[^\n]*|Expected:[^\n]*)/i);
    const genericAssertMatch = combined.match(/(failed test|FAIL\s+[^\n]+)/i);
    const assertMatch = specificAssertMatch || genericAssertMatch;
    if (assertMatch) {
      return {
        failureClass: "test_assertion",
        isAutoFixable: true,
        summary: `Test assertion failed: ${assertMatch[0].trim()}`,
        extractedError: combined.slice(0, 300),
        recommendedAction: "Update application code to satisfy the asserted expectation or adjust outdated test assertion.",
      };
    }

    // 7. General Runtime Exception
    const runtimeMatch = combined.match(/(ReferenceError|TypeError|RangeError|URIError):?\s*([^\n]+)/i);
    if (runtimeMatch) {
      return {
        failureClass: "runtime_exception",
        isAutoFixable: true,
        summary: `Runtime exception: ${runtimeMatch[1]} - ${runtimeMatch[2]}`,
        extractedError: runtimeMatch[0],
        recommendedAction: "Fix variable scope, undefined reference, or null property access.",
      };
    }

    return {
      failureClass: "unknown_failure",
      isAutoFixable: true,
      summary: "Build or test command exited with non-zero exit code.",
      extractedError: combined.slice(0, 300),
      recommendedAction: "Review full stderr/stdout logs and resolve root cause.",
    };
  }

  /**
   * Run an autonomous cycle with bounded retry limits.
   */
  async runAutonomousCycle(
    projectId: string,
    autoFixHandler?: (analysis: FailureAnalysis, state: LoopState) => Promise<boolean>
  ): Promise<AutonomousCycleResult> {
    const state = this.getLoopState(projectId);
    const now = () => new Date().toISOString();

    while (state.attemptCount < state.maxAttempts) {
      state.attemptCount += 1;
      const attemptNum = state.attemptCount;

      // ── Step 1: BUILD ──────────────────────────────────────────────────────
      state.stage = "build";
      const buildResult = await this.projectManager.runBuild(projectId);
      if (!buildResult.ok) {
        const analysis = this.classifyFailure(buildResult.stdout, buildResult.stderr, buildResult.error);
        state.history.push({
          attempt: attemptNum,
          stage: "build",
          timestamp: now(),
          failureClass: analysis.failureClass,
          error: analysis.summary,
          successful: false,
        });

        if (!analysis.isAutoFixable || state.attemptCount >= state.maxAttempts) {
          state.requiresUserDecision = true;
          state.userDecisionPrompt = analysis.userDecisionPrompt || `Build failed: ${analysis.summary}. Maximum automated retries reached.`;
          state.userDecisionOptions = analysis.userDecisionOptions;
          return {
            success: false,
            projectId,
            finalStage: "build",
            lastSuccessfulStage: state.lastSuccessfulStage,
            attemptsUsed: state.attemptCount,
            maxAttempts: state.maxAttempts,
            failureAnalysis: analysis,
            requiresUser: true,
            userPrompt: state.userDecisionPrompt,
            userOptions: state.userDecisionOptions,
            history: state.history,
          };
        }

        // Attempt automated fix if handler provided
        if (autoFixHandler) {
          state.stage = "fix";
          const fixed = await autoFixHandler(analysis, state);
          state.history.push({
            attempt: attemptNum,
            stage: "fix",
            timestamp: now(),
            successful: fixed,
            fixDescription: fixed ? "Applied automated correction" : "Fix attempt failed",
          });
          if (!fixed) {
            state.requiresUserDecision = true;
            return {
              success: false,
              projectId,
              finalStage: "fix",
              lastSuccessfulStage: state.lastSuccessfulStage,
              attemptsUsed: state.attemptCount,
              maxAttempts: state.maxAttempts,
              failureAnalysis: analysis,
              requiresUser: true,
              userPrompt: `Automated repair could not resolve: ${analysis.summary}`,
              history: state.history,
            };
          }
        }
        // Loop around to retry build
        continue;
      }

      state.lastSuccessfulStage = "build";
      state.history.push({
        attempt: attemptNum,
        stage: "build",
        timestamp: now(),
        successful: true,
      });

      // ── Step 2: TEST ───────────────────────────────────────────────────────
      state.stage = "test";
      const testResult = await this.projectManager.runTest(projectId);
      if (!testResult.ok) {
        const analysis = this.classifyFailure(testResult.stdout, testResult.stderr, testResult.error);
        state.history.push({
          attempt: attemptNum,
          stage: "test",
          timestamp: now(),
          failureClass: analysis.failureClass,
          error: analysis.summary,
          successful: false,
        });

        if (!analysis.isAutoFixable || state.attemptCount >= state.maxAttempts) {
          state.requiresUserDecision = true;
          state.userDecisionPrompt = analysis.userDecisionPrompt || `Test failed: ${analysis.summary}. Maximum automated retries reached.`;
          state.userDecisionOptions = analysis.userDecisionOptions;
          return {
            success: false,
            projectId,
            finalStage: "test",
            lastSuccessfulStage: state.lastSuccessfulStage,
            attemptsUsed: state.attemptCount,
            maxAttempts: state.maxAttempts,
            failureAnalysis: analysis,
            requiresUser: true,
            userPrompt: state.userDecisionPrompt,
            userOptions: state.userDecisionOptions,
            history: state.history,
          };
        }

        if (autoFixHandler) {
          state.stage = "fix";
          const fixed = await autoFixHandler(analysis, state);
          state.history.push({
            attempt: attemptNum,
            stage: "fix",
            timestamp: now(),
            successful: fixed,
            fixDescription: fixed ? "Applied automated test fix" : "Fix attempt failed",
          });
          if (!fixed) {
            state.requiresUserDecision = true;
            return {
              success: false,
              projectId,
              finalStage: "fix",
              lastSuccessfulStage: state.lastSuccessfulStage,
              attemptsUsed: state.attemptCount,
              maxAttempts: state.maxAttempts,
              failureAnalysis: analysis,
              requiresUser: true,
              userPrompt: `Automated test repair could not resolve: ${analysis.summary}`,
              history: state.history,
            };
          }
        }
        // Loop around to retest
        continue;
      }

      state.lastSuccessfulStage = "test";
      state.history.push({
        attempt: attemptNum,
        stage: "test",
        timestamp: now(),
        successful: true,
      });

      // ── Step 3: PREVIEW & USER REVIEW ──────────────────────────────────────
      state.stage = "preview";
      state.lastSuccessfulStage = "preview";
      state.stage = "user_review";
      state.resolved = true;

      return {
        success: true,
        projectId,
        finalStage: "user_review",
        lastSuccessfulStage: "preview",
        attemptsUsed: state.attemptCount,
        maxAttempts: state.maxAttempts,
        requiresUser: false,
        history: state.history,
      };
    }

    // Exhausted retries without success
    state.requiresUserDecision = true;
    return {
      success: false,
      projectId,
      finalStage: state.stage,
      lastSuccessfulStage: state.lastSuccessfulStage,
      attemptsUsed: state.attemptCount,
      maxAttempts: state.maxAttempts,
      requiresUser: true,
      userPrompt: `Autonomous repair loop reached maximum limit of ${state.maxAttempts} attempts. User input required.`,
      history: state.history,
    };
  }
}
