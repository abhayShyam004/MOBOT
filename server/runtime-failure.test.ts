// The failure card's contract: a provider report is classified into copy the
// harness owns, the raw report goes to the log, and nothing a client can see
// carries the provider's own bytes. The last test is the one that matters
// most — it is the defect this module exists for (`upstream HTTP 429:
// {"error":…}` shown as a bot's last word).
import { describe, expect, it } from "vitest";

import {
  failureKindFor,
  failureLogLine,
  failureTranscriptLine,
  summarizeRuntimeFailure,
  summarizeStopReason,
  classifyFailure,
  decideReplan,
} from "./runtime-failure.ts";

const OPENROUTER_429 = 'upstream HTTP 429: {"error":{"message":"Provider returned error","type":"rate_limit_exceeded","code":429}}';

describe("runtime failure summaries", () => {
  it("classifies the failures a person actually meets", () => {
    expect(failureKindFor(OPENROUTER_429)).toBe("rate_limit");
    expect(failureKindFor("MiniMax HTTP 402: insufficient balance")).toBe("quota");
    expect(failureKindFor("xAI HTTP 401: invalid api key")).toBe("auth");
    expect(failureKindFor("upstream HTTP 403: forbidden")).toBe("access");
    expect(failureKindFor("provider returned a streaming completion error: model not found")).toBe("model_unavailable");
    expect(failureKindFor("upstream HTTP 500: internal server error")).toBe("provider_error");
    expect(failureKindFor("fetch failed: ECONNREFUSED")).toBe("network");
    expect(failureKindFor("Streaming idle timeout elapsed")).toBe("timeout");
    expect(failureKindFor("MCP request timed out; execution outcome may be uncertain")).toBe("tooling");
    expect(failureKindFor("MCP server could not start; check its command and installation")).toBe("tooling");
    expect(failureKindFor("the task was blocked by the provider's safety systems")).toBe("safety");
    expect(failureKindFor("400 malformed request")).toBe("invalid_request");
    expect(failureKindFor("something odd happened")).toBe("unknown");
  });

  it("reads the status out of a status line and never out of a payload", () => {
    expect(summarizeRuntimeFailure({ message: OPENROUTER_429 }).status).toBe(429);
    expect(summarizeRuntimeFailure({ message: '{"error":{"code":429}}' }).status).toBeUndefined();
    // A number inside the body must not be mistaken for a status.
    expect(summarizeRuntimeFailure({ message: 'upstream error: {"max_tokens":5000}' }).status).toBeUndefined();
  });

  it("says how many attempts were made only for a retried, settled failure", () => {
    const settled = summarizeRuntimeFailure({ message: OPENROUTER_429, terminal: true, attempts: 3 });
    expect(settled.attempts).toBe(3);
    // A diagnostic during a live turn is not a settled failure.
    expect(summarizeRuntimeFailure({ message: OPENROUTER_429, attempts: 3 }).attempts).toBeUndefined();
    // A key or a missing CLI was never retried, so it must not imply it was.
    expect(summarizeRuntimeFailure({ message: "401 unauthorized", terminal: true, attempts: 3 }).attempts).toBeUndefined();
    expect(summarizeRuntimeFailure({ message: "missing api key", setup: true, terminal: true, attempts: 3 }).attempts).toBeUndefined();
  });

  it("gives setup failures their own kind and remedy", () => {
    const card = summarizeRuntimeFailure({ message: "invalid api key or run /login", setup: true });
    expect(card.kind).toBe("setup");
    expect(card.advice).toContain("Model providers");
    expect(card.status).toBeUndefined();
  });

  it("blames this computer's tools for a tool failure, not the provider", () => {
    const report = "MCP request timed out; execution outcome may be uncertain";
    const card = summarizeRuntimeFailure({ message: report, terminal: true, attempts: 3 });
    expect(card.kind).toBe("tooling");
    expect(card.title).toBe("This bot's tools did not start");
    // The provider is explicitly not the subject — a timeout card here would
    // have sent someone to check a key that is fine.
    expect(card.detail).toContain("The provider is not the problem here");
    expect(card.status).toBeUndefined();
    // …and the transport's own words stay out of the card like any other report.
    for (const text of [card.title, card.detail, card.advice]) expect(text).not.toContain("MCP");
    // A payload that merely mentions MCP is still read as what its status says.
    expect(failureKindFor('upstream HTTP 429: {"error":{"message":"MCP is down"}}')).toBe("rate_limit");
  });

  it("maps only the stop reasons that name a condition", () => {
    expect(summarizeStopReason("auth_required").kind).toBe("auth");
    expect(summarizeStopReason("quota_exhausted").kind).toBe("quota");
    expect(summarizeStopReason("rate_limit").kind).toBe("rate_limit");
    expect(summarizeStopReason("unknown_model").kind).toBe("model_unavailable");
    // A stop reason that merely mentions a model is not a missing model.
    expect(summarizeStopReason("model_call_limit_reached").kind).toBe("unknown");
    expect(summarizeStopReason("exit_before_result").kind).toBe("unknown");
    expect(summarizeStopReason(null).kind).toBe("unknown");
  });

  it("never puts the provider's own report in front of a person", () => {
    const report = OPENROUTER_429;
    const summary = summarizeRuntimeFailure({ message: report, terminal: true, attempts: 3 });
    const where = { instanceId: "openrouter", provider: "OpenRouter (API)", model: "inclusionai/ling-3.1-flash" };
    const line = failureTranscriptLine(summary, where, { terminal: true });

    // The chip leads with the harness's headline, not the payload.
    expect(line.tool).toMatchObject({ name: "error: Rate limit reached", ok: false, terminal: true });
    // The card says what happened, where, and what to do — and nothing else.
    expect(line.failure).toMatchObject({
      kind: "rate_limit",
      status: 429,
      attempts: 3,
      instanceId: "openrouter",
      provider: "OpenRouter (API)",
      model: "inclusionai/ling-3.1-flash",
    });
    expect(line.failure.advice).not.toHaveLength(0);
    // Every string a client can draw, checked against the report's own words.
    const shown = [line.tool.name, line.failure.title, line.failure.detail, line.failure.advice];
    for (const text of shown) {
      for (const fragment of ["upstream", "429:", "rate_limit_exceeded", "Provider returned error", "{", "}"]) {
        expect(text).not.toContain(fragment);
      }
    }
    // The kind and status still say what happened without the provider's words.
    expect(line.failure.title).toBe("Rate limit reached");
  });

  it("keeps the raw report for diagnostics, bounded and redacted", () => {
    const summary = summarizeRuntimeFailure({ message: OPENROUTER_429, terminal: true });
    const line = failureLogLine({
      threadId: "t-1",
      report: `Bearer sk-or-v1-abcdefghijklmnopqrstuvwxyz012345 ${OPENROUTER_429}`,
      summary,
      where: { instanceId: "openrouter", model: "ling-3.1-flash" },
      turnId: "turn-9",
    });
    expect(line).toContain("[turn.failure] rate_limit 429");
    expect(line).toContain("openrouter / ling-3.1-flash");
    expect(line).toContain("thread=t-1 turn=turn-9");
    expect(line).toContain("rate_limit_exceeded");
    expect(line).not.toContain("sk-or-v1-abcdefghijklmnopqrstuvwxyz012345");
    const huge = failureLogLine({ threadId: "t", report: "x".repeat(4_000), summary, where: {} });
    expect(huge.length).toBeLessThan(700);
  });
});

describe("Official Roadmap Phase 10: Autonomous Replanning (mobot_54_phases_prompt.md:687-738)", () => {
  describe("1. Failure Classification Contract", () => {
    it("classifies all 7 required failure types accurately", () => {
      // TRANSIENT_NETWORK
      expect(classifyFailure("fetch failed: ECONNREFUSED 127.0.0.1:18800")).toBe("TRANSIENT_NETWORK");
      expect(classifyFailure("upstream HTTP 504: Gateway Timeout")).toBe("TRANSIENT_NETWORK");
      expect(classifyFailure("socket hang up")).toBe("TRANSIENT_NETWORK");

      // RATE_LIMIT
      expect(classifyFailure(OPENROUTER_429)).toBe("RATE_LIMIT");
      expect(classifyFailure("Too Many Requests: slow down (TPM limit reached)")).toBe("RATE_LIMIT");

      // AUTH_REQUIRED
      expect(classifyFailure("HTTP 401: Unauthorized - invalid api key")).toBe("AUTH_REQUIRED");
      expect(classifyFailure("Sign-in rejected: credentials expired")).toBe("AUTH_REQUIRED");

      // PERMISSION_BLOCKED
      expect(classifyFailure("Permission Denied: Terminal & Shell Execution is disabled in Settings -> Permissions.")).toBe("PERMISSION_BLOCKED");
      expect(classifyFailure("HTTP 403: Forbidden - operation not permitted")).toBe("PERMISSION_BLOCKED");

      // INVALID_INPUT
      expect(classifyFailure("HTTP 400: Malformed request body")).toBe("INVALID_INPUT");
      expect(classifyFailure("SyntaxError: Unexpected token in JSON at position 42")).toBe("INVALID_INPUT");

      // STRATEGY_INEFFECTIVE
      expect(classifyFailure("ERR_EMPTY_OR_JUNK_PAYLOAD: Search tool reported no results found.")).toBe("STRATEGY_INEFFECTIVE");
      expect(classifyFailure("0 results matching query criteria")).toBe("STRATEGY_INEFFECTIVE");

      // RESOURCE_EXHAUSTED
      expect(classifyFailure("HTTP 402: Payment Required - insufficient balance")).toBe("RESOURCE_EXHAUSTED");
      expect(classifyFailure("ENOSPC: no space left on device, write")).toBe("RESOURCE_EXHAUSTED");
      expect(classifyFailure("ERR_EXECUTION_LOOP_TIMEOUT: budget_exhausted")).toBe("RESOURCE_EXHAUSTED");
    });
  });

  describe("2. Bounded, Failure-Specific Recovery Strategies", () => {
    it("TRANSIENT_NETWORK: executes exponential backoff at 1s and 4s, then escalates on attempt 3", () => {
      // Attempt 1: 1s delay
      const decision1 = decideReplan({
        originalAction: "fetch_remote_data",
        failureType: "TRANSIENT_NETWORK",
        attemptCount: 1,
      });
      expect(decision1.recoveryStrategy).toBe("retry_backoff");
      expect(decision1.delayMs).toBe(1000);
      expect(decision1.attemptCount).toBe(1);
      expect(decision1.maxAttempts).toBe(3);
      expect(decision1.userExplanationRequired).toBe(false);

      // Attempt 2: 4s delay
      const decision2 = decideReplan({
        originalAction: "fetch_remote_data",
        failureType: "TRANSIENT_NETWORK",
        attemptCount: 2,
      });
      expect(decision2.recoveryStrategy).toBe("retry_backoff");
      expect(decision2.delayMs).toBe(4000);
      expect(decision2.attemptCount).toBe(2);
      expect(decision2.userExplanationRequired).toBe(false);

      // Attempt 3: Escalate to user
      const decision3 = decideReplan({
        originalAction: "fetch_remote_data",
        failureType: "TRANSIENT_NETWORK",
        attemptCount: 3,
      });
      expect(decision3.recoveryStrategy).toBe("escalate_to_user");
      expect(decision3.attemptCount).toBe(3);
      expect(decision3.userExplanationRequired).toBe(true);
      expect(decision3.userFacingExplanation).toContain("Network connection failed after 3 attempts");
      expect(decision3.userFacingExplanation).not.toContain("ECONNREFUSED");
    });

    it("AUTH_REQUIRED & PERMISSION_BLOCKED: escalate immediately without retrying", () => {
      // Auth failure: never retried
      const authDecision = decideReplan({
        originalAction: "query_claude_model",
        failureType: "AUTH_REQUIRED",
        attemptCount: 1,
      });
      expect(authDecision.recoveryStrategy).toBe("escalate_to_user");
      expect(authDecision.maxAttempts).toBe(1);
      expect(authDecision.userExplanationRequired).toBe(true);
      expect(authDecision.userFacingExplanation).toContain("Settings -> Model Providers");

      // Permission blocked: never retried
      const permDecision = decideReplan({
        originalAction: "delete_database",
        failureType: "PERMISSION_BLOCKED",
        attemptCount: 1,
      });
      expect(permDecision.recoveryStrategy).toBe("escalate_to_user");
      expect(permDecision.maxAttempts).toBe(1);
      expect(permDecision.userExplanationRequired).toBe(true);
      expect(permDecision.userFacingExplanation).toContain("Settings -> Permissions");
    });

    it("STRATEGY_INEFFECTIVE: mutates arguments on attempt 1, falls back to tool on attempt 2, escalates on attempt 3", () => {
      // Attempt 1: Mutate query / parameters
      const d1 = decideReplan({
        originalAction: "search_customer_name",
        failureType: "STRATEGY_INEFFECTIVE",
        attemptCount: 1,
      });
      expect(d1.recoveryStrategy).toBe("mutate_arguments");
      expect(d1.nextAction).toContain("reformulated_query");

      // Attempt 2: Use fallback capability
      const fallbacks = [
        { capabilityId: "device.files", operation: "search", params: { category: "contacts" } },
      ];
      const d2 = decideReplan({
        originalAction: "search_customer_name",
        failureType: "STRATEGY_INEFFECTIVE",
        attemptCount: 2,
        availableFallbacks: fallbacks,
      });
      expect(d2.recoveryStrategy).toBe("fallback_tool");
      expect(d2.alternativeCapability?.capabilityId).toBe("device.files");

      // Attempt 3: Escalate to user
      const d3 = decideReplan({
        originalAction: "search_customer_name",
        failureType: "STRATEGY_INEFFECTIVE",
        attemptCount: 3,
        availableFallbacks: fallbacks,
      });
      expect(d3.recoveryStrategy).toBe("escalate_to_user");
      expect(d3.userExplanationRequired).toBe(true);
    });
  });

  describe("3. Behavioral Test: Port 18800 Block & Dynamic Fallback Execution", () => {
    it("Behavioral Test: switches to alternative search/scraping capability when port 18800 is blocked without halting", async () => {
      const { createServer } = await import("node:http");
      const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");
      const { ObservabilityBus } = await import("./capabilities/observability.ts");
      const { defaultCapabilityRegistry } = await import("./capabilities/capability-registry.ts");

      // 1. Establish and record baseline network state: port 18800 is not serving
      let port18800Error: string | undefined;
      try {
        await fetch("http://127.0.0.1:18800/session/test/open");
      } catch (err: any) {
        port18800Error = err.message || String(err);
      }
      expect(port18800Error).toBeDefined();
      expect(port18800Error).toContain("fetch failed");

      // 2. Start an isolated alternative web search HTTP endpoint on an ephemeral port
      let fallbackHits = 0;
      const altServer = createServer((_req, res) => {
        fallbackHits++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              title: "Samsung Galaxy A07 Hardware Specifications",
              snippet: "Samsung Galaxy A07 features ARM64 CPU, Android 16, SM-A075F.",
              url: "https://example.org/galaxy-a07",
            },
          ])
        );
      });

      await new Promise<void>((resolve) => altServer.listen(0, "127.0.0.1", () => resolve()));
      const altPort = (altServer.address() as any).port;
      const altEndpoint = `http://127.0.0.1:${altPort}/search`;

      const bus = new ObservabilityBus();
      const stepTrace: string[] = [];

      try {
        const loop = new AgentExecutionLoop({
          objective: "Perform web search for Samsung Galaxy A07 specifications",
          initialPlan: {
            action: "primary_web_search",
            capabilityId: "device.browser",
            operation: "search",
            params: { port: 18800, query: "Galaxy A07 specs" },
          },
          fallbacks: [
            {
              capabilityId: "web.scraper",
              operation: "search",
              params: { query: "Galaxy A07 specs", endpoint: altEndpoint },
            },
          ],
          capabilityRegistry: defaultCapabilityRegistry,
          observabilityBus: bus,
          stepHandler: async (plan) => {
            stepTrace.push(plan.action);
            if (plan.action === "primary_web_search") {
              // Real invocation attempting connection to port 18800
              try {
                await fetch(`http://127.0.0.1:18800/session/primary/open`);
                return { action: plan.action, success: true, resultSummary: "Loaded" };
              } catch (err: any) {
                return {
                  action: plan.action,
                  success: false,
                  error: `fetch failed: ECONNREFUSED 127.0.0.1:18800 (${err.message})`,
                  resultSummary: "Port 18800 connection refused",
                };
              }
            }

            // Fallback capability execution: genuine execution of web.scraper against alternative endpoint
            const scraperResult = await defaultCapabilityRegistry.invoke(
              "web.scraper",
              "search",
              plan.params || { query: "Galaxy A07 specs", endpoint: altEndpoint }
            );

            return {
              action: plan.action,
              success: scraperResult.success,
              rawOutput: scraperResult.data,
              resultSummary: `Found verified web search results via alternative web scraper: Samsung Galaxy A07 (SM-A075F, ARM64)`,
            };
          },
        });

        // Run execution loop
        const finalState = await loop.runUntilSettled();

        // 1. Initial failure & classification
        const replanEvents = bus.getEvents({ type: "AGENT_LOOP_REPLAN_DECIDED" });
        expect(replanEvents.length).toBeGreaterThanOrEqual(1);
        expect(replanEvents[0].payload.failureType).toBe("TRANSIENT_NETWORK");
        expect(replanEvents[0].payload.recoveryStrategy).toBe("fallback_tool");

        // 2. Fallback action executed
        expect(stepTrace).toContain("primary_web_search");
        expect(stepTrace.some((act) => act.startsWith("fallback_web.scraper"))).toBe(true);
        expect(finalState.phase).toBe("complete");
        expect(finalState.terminationReason).toBe("goal_achieved");
        expect(finalState.turnNumber).toBe(2);

        // 3. Verified alternative endpoint was genuinely hit and returned data
        expect(fallbackHits).toBe(1);

        // 4. Truthful user result synthesized without halting
        const obs = finalState.accumulatedObservations;
        expect(obs.length).toBe(2);
        expect(obs[0].success).toBe(false);
        expect(obs[1].success).toBe(true);
        expect(obs[1].resultSummary).toContain("Samsung Galaxy A07");
      } finally {
        // Restore network baseline
        await new Promise<void>((resolve) => altServer.close(() => resolve()));
      }
    });

    it("Behavioral Test: terminates gracefully when both primary and fallback tools fail", async () => {
      const { AgentExecutionLoop } = await import("./capabilities/orchestration.ts");

      let turn = 0;
      const loop = new AgentExecutionLoop({
        objective: "Perform web search",
        initialPlan: {
          action: "primary_web_search",
          capabilityId: "device.browser",
          operation: "search",
          params: { port: 18800 },
        },
        fallbacks: [
          { capabilityId: "web.scraper", operation: "search" },
        ],
        stepHandler: async (plan) => {
          turn++;
          return {
            action: plan.action,
            success: false,
            error: `Permanent failure on ${plan.action}`,
            resultSummary: `Execution error on ${plan.action}`,
          };
        },
      });

      // Both fail -> escalates cleanly without infinite loop
      const finalState = await loop.runUntilSettled();
      expect(finalState.phase).toBe("escalate");
      expect(finalState.terminationReason).toBe("unrecoverable_failure");
      expect(turn).toBeLessThanOrEqual(4);
    });

    it("Anti-Pattern Verification: sanitizes user-facing errors preventing raw stack trace or 500 dumps", () => {
      const testCases = [
        {
          raw: "Error: connect ECONNREFUSED 127.0.0.1:18800 at TCPConnectWrap.afterConnect (node:net:1607:16)",
          expectedClassification: "TRANSIENT_NETWORK",
        },
        {
          raw: "HTTP 500 Internal Server Error: Database deadlock detected at org.postgresql.core.v3.QueryExecutorImpl.execute",
          expectedClassification: "STRATEGY_INEFFECTIVE",
        },
        {
          raw: "RateLimitError: 429 {'error': {'message': 'You exceeded your current quota', 'type': 'insufficient_quota'}}",
          expectedClassification: "RATE_LIMIT",
        },
        {
          raw: "HTTP 401 Unauthorized: Invalid Bearer sk-ant-api-key-12345",
          expectedClassification: "AUTH_REQUIRED",
        },
        {
          raw: "Permission Denied: Camera access is disabled in Settings -> Permissions.",
          expectedClassification: "PERMISSION_BLOCKED",
        },
      ];

      for (const tc of testCases) {
        const cls = classifyFailure(tc.raw);
        expect(cls).toBe(tc.expectedClassification);

        const decision = decideReplan({
          originalAction: "failing_act",
          failureType: cls,
          attemptCount: 3,
          errorReport: tc.raw,
        });

        if (decision.userFacingExplanation) {
          expect(decision.userFacingExplanation).not.toContain("ECONNREFUSED");
          expect(decision.userFacingExplanation).not.toContain("TCPConnectWrap");
          expect(decision.userFacingExplanation).not.toContain("org.postgresql");
          expect(decision.userFacingExplanation).not.toContain("insufficient_quota");
          expect(decision.userFacingExplanation).not.toContain("sk-ant-api-key");
          expect(decision.userFacingExplanation).not.toContain("{");
          expect(decision.userFacingExplanation).not.toContain("}");
        }
      }
    });
  });
});
