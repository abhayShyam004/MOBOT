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
