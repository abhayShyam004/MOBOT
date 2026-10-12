// What a failed turn says to a person.
//
// A provider answers a failed request with a status line and, very often, its
// own JSON body: `upstream HTTP 429: {"error":{"message":"…","type":"…"}}`.
// That report is diagnostics. It goes to the log, where an engineer can read
// it, and it deliberately never reaches the transcript — a conversation that
// ends in a truncated payload is not an explanation, it is a leak of the
// provider's wire format into someone's chat.
//
// So this module is the only door between the two. It reads the provider's
// report, classifies it with the same policy the retry loop used
// (drivers/retry.ts `classifyError`, one source of truth for "what kind of
// failure is this"), and returns copy the harness owns. Nothing it returns is
// provider text, and the raw report is passed back to the caller for logging.
//
// The classification is closed ([FailureKind]): every kind has its own title,
// explanation and advice, so an unrecognised failure is still a sentence a
// person can act on, and a new provider cannot invent a new user-facing case
// by wording its errors differently.
import { isProviderSafetyBlock } from "../shared/provider-safety.ts";
import type { FailureCardData, FailureKind } from "../shared/wire.ts";
import { classifyError } from "./drivers/retry.ts";
import { redactSecretsInText } from "./redact.ts";

export interface RuntimeFailureInput {
  /** The provider's, the engine's, or the driver's own report. Read here,
   * classified here, and never relayed. */
  message: string;
  /** The engine never started — a missing CLI or a missing sign-in. */
  setup?: boolean;
  /** The complete turn failed, rather than a diagnostic during a live one. */
  terminal?: boolean;
  /** Attempts the turn already made before it gave up. */
  attempts?: number;
}

interface FailureCopy {
  title: string;
  detail: string;
  advice: string;
}

/**
 * The copy, one entry per kind. Written for someone holding a phone: what
 * happened, then the single most useful next move. A kind whose remedy lives
 * in settings says so; a kind a retry actually fixes says retry, because an
 * advice line that is wrong is worse than no advice at all.
 */
const COPY: Record<FailureKind, FailureCopy> = {
  rate_limit: {
    title: "Rate limit reached",
    detail: "The provider asked this turn to slow down. The automatic retries did not get through, so nothing was answered.",
    advice: "Wait a few seconds and retry — a shared or free model usually clears straight away. Another model works immediately.",
  },
  quota: {
    title: "Out of credits",
    detail: "The account behind this model has no budget left, so the provider refused the request before it ran.",
    advice: "Add credits with the provider, or switch this task to another model.",
  },
  auth: {
    title: "Sign-in rejected",
    detail: "The provider refused this turn's credentials — the saved key or sign-in is missing, expired, or no longer valid.",
    advice: "Update this provider's key or sign in again, then retry.",
  },
  access: {
    title: "Not allowed to use that model",
    detail: "The account behind this provider's key is not allowed to use the model this task chose.",
    advice: "Switch to a model this account can use, or fix the provider's access.",
  },
  model_unavailable: {
    title: "Model unavailable",
    detail: "The provider does not serve the model this task chose — it may have been renamed or retired since it was picked.",
    advice: "Pick another model for this task.",
  },
  invalid_request: {
    title: "The provider refused the request",
    detail: "The provider read this turn's request as malformed and would not run it. A model that does not accept the tools or the fields this turn sends is the usual cause.",
    advice: "Switch to another model and retry.",
  },
  provider_error: {
    title: "Provider error",
    detail: "The provider failed on its own side, and the automatic retries did not get through.",
    advice: "Retry in a moment — a provider's own outage usually clears quickly.",
  },
  overloaded: {
    title: "The provider is overloaded",
    detail: "The provider is at capacity right now and turned this turn away after the automatic retries.",
    advice: "Retry in a moment, or use another model while it is busy.",
  },
  network: {
    title: "Could not reach the provider",
    detail: "The computer running this bot could not open a connection to the provider. The endpoint may be wrong, or the network may be down.",
    advice: "Check the provider's address and this computer's connection, then retry.",
  },
  timeout: {
    title: "The provider stopped responding",
    detail: "The provider took the request and then sent nothing for too long, so the turn was given up on.",
    advice: "Retry — a long task can outlast the provider's patience.",
  },
  tooling: {
    title: "This bot's tools did not start",
    detail: "The tools a turn mounts — the harness's own coordinator and this bot's integrations — did not finish their handshake, so the turn stopped before the provider was asked. The provider is not the problem here.",
    advice: "Retry. If it keeps happening, check this bot's integrations and how loaded the computer running it is.",
  },
  safety: {
    title: "The provider stopped this task",
    detail: "The provider's own safety checks ended this turn. Full access controls tool approvals, not the provider's review.",
    advice: "Review the provider's findings, then retry with a different approach. OpenMausBot cannot override this block.",
  },
  setup: {
    title: "The engine needs setup",
    detail: "This engine could not start on the computer that runs it — its command-line tool is missing, or it is not signed in.",
    advice: "Finish this engine's setup in Model providers, then retry.",
  },
  aborted: {
    title: "Turn stopped",
    detail: "This turn was stopped before it answered.",
    advice: "Send it again when you are ready.",
  },
  unknown: {
    title: "The turn ended with an error",
    detail: "The engine stopped before it could answer, and it did not report a cause the harness recognises.",
    advice: "Retry — if it fails again, switch this task to another model.",
  },
};

/** Kinds whose copy already talks about the automatic retries. */
const RETRIED: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "rate_limit",
  "provider_error",
  "overloaded",
  "network",
  "timeout",
]);

/** 403 is its own answer: the key is fine, this account or model is not. */
const ACCESS_PATTERN = /\b403\b|\bforbidden\b/i;

/** The harness's own tool transport, which is not a provider. A turn mounts
 * the agents MCP server and whatever integrations the bot has, and each of
 * those can fail to answer on its own schedule; the reports name MCP. They used
 * to reach the switch below, whose timeout arm said "the provider stopped
 * responding" — telling someone their provider was slow when a local
 * integration was broken. */
const TOOLING_PATTERN = /\bMCP\b/;

/** Statuses worth printing on the card. A bare number that is not in a status
 * line is not read at all — a payload full of numbers must never become one,
 * and guessing here would be exactly the kind of invention this module exists
 * to prevent. */
function statusOf(report: string): number | undefined {
  const match = /\bHTTP[ /](\d{3})\b/i.exec(report) ?? /"status"\s*:\s*(\d{3})\b/.exec(report);
  if (!match) return undefined;
  const status = Number(match[1]);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

/**
 * Which kind of failure a report is, in the same vocabulary the retry loop
 * used to decide whether to retry it. A stopped turn is [FailureKind] "aborted"
 * rather than "unknown": the person did that, and the card must not read as a
 * defect.
 */
export function failureKindFor(report: string, options: { setup?: boolean } = {}): FailureKind {
  if (options.setup) return "setup";
  const text = report.trim();
  if (!text) return "unknown";
  if (isProviderSafetyBlock(text)) return "safety";
  if (ACCESS_PATTERN.test(text)) return "access";
  if (TOOLING_PATTERN.test(text) && statusOf(text) === undefined) return "tooling";
  switch (classifyError({ text }).reason) {
    case "rate_limited":
      return "rate_limit";
    case "quota":
      return "quota";
    case "auth":
      return "auth";
    case "unknown_model":
      return "model_unavailable";
    case "invalid_request":
    case "not_found":
      return "invalid_request";
    case "overloaded":
      return "overloaded";
    case "server_error":
      return "provider_error";
    case "connection_reset":
      return "network";
    case "timeout":
      return "timeout";
    case "provider_safety":
      return "safety";
    case "interrupted":
    case "terminal_exit":
      return "aborted";
    default:
      return "unknown";
  }
}

/**
 * The card for a report. Every string is this module's; [RuntimeFailureInput.message]
 * is only read. [RuntimeFailureInput.attempts] rides along as a number so a
 * client can say "3 attempts" without being handed the failure text that
 * produced it.
 */
export function summarizeRuntimeFailure(input: RuntimeFailureInput): FailureCardData {
  const kind = failureKindFor(input.message, { setup: input.setup });
  const copy = COPY[kind];
  const attempts = input.attempts !== undefined && input.attempts > 1 ? input.attempts : undefined;
  // Only the kinds whose copy does not already account for the retries get the
  // count; a setup error or a bad key was never retried and must not imply it
  // was. `terminal` gates it: a diagnostic during a live turn is not a settled
  // failure, whatever count the caller holds.
  const tried = input.terminal && RETRIED.has(kind) && attempts !== undefined
    ? { attempts }
    : {};
  const status = statusOf(input.message);
  return {
    kind,
    title: copy.title,
    detail: copy.detail,
    advice: copy.advice,
    ...tried,
    ...(status === undefined ? {} : { status }),
  };
}

/** Everything a client may be told about which engine failed. */
export interface FailureWhere {
  instanceId?: string;
  provider?: string;
  model?: string;
}

/**
 * The transcript line a failure becomes: a short chip for clients that do not
 * know the card yet, and the card itself.
 *
 * Written as one function so the two can never disagree, and so a test can
 * hold the guarantee that matters: the report that produced it is in neither
 * the chip nor the card.
 */
export function failureTranscriptLine(
  summary: FailureCardData,
  where: FailureWhere,
  options: { setup?: boolean; terminal?: boolean } = {},
): {
  tool: { name: string; ok: false; setup?: boolean; terminal?: true };
  failure: FailureCardData;
} {
  const failure: FailureCardData = {
    ...summary,
    ...(where.instanceId ? { instanceId: where.instanceId } : {}),
    ...(where.provider ? { provider: where.provider } : {}),
    ...(where.model ? { model: where.model } : {}),
  };
  return {
    tool: {
      // The chip is the card's own headline. A client that predates the card
      // still reads a sentence instead of a payload.
      name: `error: ${summary.title}`,
      ok: false,
      ...(options.setup ? { setup: true } : {}),
      ...(options.terminal ? { terminal: true } : {}),
    },
    failure,
  };
}

/**
 * The line a maintainer reads. This is where the provider's own report lives:
 * one bounded, secret-redacted line per failure, tagged with the thread, the
 * engine and the model so it can be found again.
 */
export function failureLogLine(input: {
  threadId: string;
  report: string;
  summary: FailureCardData;
  where: FailureWhere;
  turnId?: string;
}): string {
  const where = [input.where.instanceId, input.where.model].filter(Boolean).join(" / ");
  const report = redactSecretsInText(input.report.replace(/\s+/g, " ").trim()).slice(0, 500);
  return `[turn.failure] ${input.summary.kind}${input.summary.status ? ` ${input.summary.status}` : ""}` +
    `${where ? ` (${where})` : ""} thread=${input.threadId}${input.turnId ? ` turn=${input.turnId}` : ""} :: ${report}`;
}

/**
 * A settlement that failed without saying why — a turn that stopped before its
 * first item, an engine that exited, a driver that reported completion and
 * nothing else. The card is honest about the gap rather than inventing a
 * cause, and it is still actionable.
 *
 * `stopReason` is the provider's or driver's own word for how the turn ended;
 * the few that name a known condition are mapped, everything else is
 * [FailureKind] "unknown".
 */
export function summarizeStopReason(stopReason: string | null | undefined): FailureCardData {
  const reason = (stopReason ?? "").trim();
  if (!reason) return summarizeRuntimeFailure({ message: "", terminal: true });
  const normalized = reason.replace(/[_-]+/g, " ").toLowerCase();
  // Only the reasons that name a condition. A loose word match here would
  // invent a cause for a stop reason that merely mentions one of these words,
  // and an invented cause on a card is worse than an honest "it did not say".
  if (/^auth(entication)?\b|\b(?:login|credential)/.test(normalized)) {
    return summarizeRuntimeFailure({ message: "401 unauthorized" });
  }
  if (/^(?:quota|billing|credits?|insufficient)/.test(normalized)) {
    return summarizeRuntimeFailure({ message: "402 quota" });
  }
  if (/^rate.?limit/.test(normalized)) return summarizeRuntimeFailure({ message: "429 rate limit" });
  if (/^(?:unknown|missing|invalid).?model|^model.?not.?found/.test(normalized)) {
    return summarizeRuntimeFailure({ message: "model not found" });
  }
  return summarizeRuntimeFailure({ message: "", terminal: true });
}
