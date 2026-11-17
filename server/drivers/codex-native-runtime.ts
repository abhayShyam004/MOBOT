// Native Codex runtime — a signed-in ChatGPT account without the Codex CLI.
//
// On a host where the Codex CLI cannot be installed (the Android harness),
// the account sign-in still works, and this runtime is what makes it usable:
// it speaks the same ChatGPT backend Responses protocol the CLI speaks, over
// the same OAuth tokens the CLI stored in its own auth.json. Requests carry
// the account's own access token (refreshed from its refresh token when it
// expires) and the account id header; a renewal is written back to auth.json
// so the CLI and this runtime always read one credential.
//
// The wire shape mirrors codex-rs core/src/client.rs: POST /backend-api/codex
// /responses with store:false, include:["reasoning.encrypted_content"], the
// originator header the backend recognizes, and the response's own output
// items (reasoning included) fed back as input for the next tool round — the
// round-trip a store-less reasoning model requires.
import type { McpServerSpec, ModelCatalog, ProviderAdapter, RuntimeEvent, RuntimeEventListener, SendTurnInput, TurnImageInput } from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { readFileSync } from "node:fs";
import { logHopTiming } from "../timing-log.ts";
import { redactSecretsInText } from "../redact.ts";
import { askQuestionSummary, normalizeAskUserInput } from "../../shared/ask-question.ts";
import { toolDetailPreview } from "../tool-summary.ts";
import {
  ChatToolSessionError,
  capabilityEnableDefinition,
  capabilityRetireDefinition,
  chatToolAvailabilityNotice,
  deferredCapabilityNotice,
  loadCapabilities,
  retireCapabilities,
  mountChatTools,
  type ChatToolDefinition,
  type ChatToolSession,
} from "./chat-mcp-tools.ts";
import {
  AuthoritativeToolStore,
  artifactReadDefinition,
  ARTIFACT_READ_TOOL_NAME,
  classifySideEffect,
  compactFunctionCallArguments,
  compactToolOutputs,
  createStructuredExecutionMemory,
  formatStructuredContinuation,
  type StructuredExecutionMemory,
} from "../execution-memory.ts";
export { compactFunctionCallArguments, compactToolOutputs };
import { checkToolPermission, loadDiskPermissions } from "../permission-policy.ts";
import { KNOWN_SURFACES } from "../tool-exposure.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { appendNative } from "./native.ts";
import { readCodexCredential, codexCredentialExpired, refreshCodexCredential, type CodexCredential } from "./codex-native-auth.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "./retry.ts";
import { measureRequest, type RequestMetrics } from "./request-metrics.ts";
import {
  createProviderRetryBudget,
  ProviderRetryBudgetError,
  resolveProviderRetryBudget,
} from "../provider-retry-budget.ts";
import { isMassDeletionCommand } from "../capabilities/safety-policy.ts";
import { approvalSummary, assessToolCall, needsApproval } from "../tool-approval.ts";
import {
  createProviderCallDeadline,
  ProviderTimeoutError,
  raceWithSignal,
  resolveProviderTimeouts,
  type ProviderTimeoutPolicy,
} from "../provider-deadline.ts";

/** The ChatGPT/Codex backend endpoint the CLI calls. */
export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
/** The originator the backend gates Codex-protocol traffic on. OpenMausBot
 * speaks the CLI's own protocol on the person's own sign-in; this marks the
 * request as one from that protocol family rather than an unknown client. */
const CODEX_ORIGINATOR = "codex_cli_rs";
const USER_AGENT = "openmausbot-codex-native";
const MAX_TOOL_CALLS = 128;
const MAX_ROUNDS = 64;
/** How many times one turn may resume after a request that ended with nothing
 *  generated. Bounded: a backend that keeps aborting must still settle. */
const MAX_RECOVERY_ROUNDS = 3;
/** One executed tool call in this turn, kept as state a resumption can be
 * handed: identity, outcome and a bounded summary — never the full output. */
interface StepRecord {
  callId: string;
  name: string;
  ok: boolean;
  summary: string;
}

/**
 * The message appended before resuming a turn whose request produced nothing.
 *
 * It states what already ran, because the alternative — re-sending the task as
 * if nothing happened — is how an agent repeats a side effect. It carries no
 * tool payloads: those are already in the request, or compacted there.
 */
function continuationMessage(steps: ReadonlyArray<StepRecord>, memory?: StructuredExecutionMemory): string {
  if (memory) {
    return formatStructuredContinuation(memory, steps);
  }
  const done = steps.filter((step) => step.ok);
  const failed = steps.filter((step) => !step.ok);
  const line = (step: StepRecord) => `${step.name} [${step.callId}] ${step.summary}`;
  return [
    "[Recovery] The previous model response ended before producing anything. This is a transport interruption in the middle of the task, not a verdict on it.",
    "The operations below already ran in this turn and their results are in this conversation. Do not repeat them; continue with the next unfinished step.",
    done.length ? `Completed: ${done.map(line).join(" | ")}` : "Completed: none",
    failed.length ? `Failed (fix the cause; assume no effect unless its result says otherwise): ${failed.map(line).join(" | ")}` : "Failed: none",
    "Continue the task from here, verify anything you are unsure of, and do not start over.",
  ].join("\n");
}

/** A failure in the ChatGPT backend protocol itself; never retried blindly. */
export class CodexResponsesError extends Error {}

/** A transient early termination before any tokens were generated. */
export class ProviderEarlyIncompleteError extends CodexResponsesError {}

/** The answer reached the model's output-token ceiling. Deterministic, so it
 *  settles the turn instead of being retried; any text that streamed before
 *  the ceiling is preserved by the caller. */
export class ProviderOutputLimitError extends CodexResponsesError {
  readonly reason: string;

  constructor(reason: string) {
    super(`The ChatGPT backend ended the response early (${reason}).`);
    this.reason = reason;
  }
}

type JsonRecord = Record<string, unknown>;

const object = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The person's photos on the Responses wire: app-attachment paths become
 * `input_image` parts with a data URL — the shape the Codex CLI sends for
 * its own image flag, and the only way the model can actually SEE what was
 * attached. The caller (extractTurnImages) has already admitted at most four
 * images inside its byte cap, so reading them here is bounded. One unreadable
 * file never fails the turn; the rest of the prompt still goes. */
function imageContentParts(images: TurnImageInput[] | undefined): JsonRecord[] {
  if (!images?.length) return [];
  const parts: JsonRecord[] = [];
  for (const image of images) {
    try {
      const base64 = readFileSync(image.path).toString("base64");
      if (base64) parts.push({ type: "input_image", image_url: `data:${image.mime};base64,${base64}` });
    } catch {
      // skipped: a vanished or unreadable attachment must not kill the turn
    }
  }
  return parts;
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

interface FunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

interface Completion {
  text: string;
  reasoning: string;
  /** `cachedInput` is the provider's own cache-read count for this request — a
   *  subset of `input`, reported apart because it prices differently. */
  usage: { input: number; output: number; cachedInput?: number } | null;
  /** The response's own output items, for the next round's input. */
  items: JsonRecord[];
  toolCalls: FunctionCall[];
  status: string | null;
  /** Set when the provider reported `response.incomplete`. An output-ceiling
   *  stop is not a successful completion even when partial text arrived. */
  incompleteReason: string | null;
}

interface RequestOptions {
  input: JsonRecord[];
  model: string;
  instructions: string;
  effort: string | null;
  tools: ChatToolDefinition[];
  cacheKey: string;
  signal: AbortSignal;
  /** The deadline policy for this attempt: the shipped one on the first try,
   *  clamped to what is left of the retry budget on later ones. */
  deadlinePolicy?: ProviderTimeoutPolicy;
  onDelta?: (delta: string, kind: "assistant_text" | "reasoning_text") => void;
  /** What this exact request contains, measured from the body being posted. */
  onMetrics?: (metrics: RequestMetrics) => void;
}

export interface CodexNativeRuntimeOptions {
  environment: () => Record<string, string | undefined>;
  models: () => ModelCatalog;
  /** Injectable for tests; defaults to the global fetch. */
  transport?: typeof fetch;
  responsesUrl?: string;
  tokenUrl?: string;
  requestTimeoutMs?: number;
  timeoutPolicy?: Partial<ProviderTimeoutPolicy>;
  retryScale?: number;
  /** One clock for a whole retry sequence; defaults to the shipped budget. */
  retryBudgetMs?: number;
  /** Monotonic millisecond clock, injectable so a test can spend the budget
   *  without sleeping. */
  clock?: () => number;
}

export interface CodexNativeRuntime {
  adapter: ProviderAdapter;
  generateText: (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;
  dispose: () => Promise<void>;
}

/** The output-text of a completed assistant message item. */
function messageText(item: JsonRecord): string {
  if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) return "";
  return item.content
    .map((part) => (object(part) && part.type === "output_text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function toolCallsIn(items: JsonRecord[]): FunctionCall[] {
  const calls: FunctionCall[] = [];
  for (const item of items) {
    if (item.type !== "function_call") continue;
    const name = typeof item.name === "string" ? item.name : "";
    const callId = typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : "";
    if (!name || !callId) continue;
    calls.push({ callId, name, arguments: typeof item.arguments === "string" ? item.arguments : "{}" });
  }
  return calls;
}

function failureMessage(response: JsonRecord | null): string {
  const error = response && object(response.error) ? response.error : response;
  if (error) {
    if (typeof error.message === "string" && error.message) {
      const code = typeof error.code === "string" && error.code ? ` (${error.code})` : "";
      return `The ChatGPT backend rejected the turn${code}: ${error.message}`;
    }
    if (typeof error.error === "string" && error.error) return `The ChatGPT backend rejected the turn: ${error.error}`;
  }
  return "The ChatGPT backend reported the response as failed.";
}

function usageFrom(usage: unknown): { input: number; output: number; cachedInput?: number } | null {
  if (!object(usage)) return null;
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  // The Responses protocol reports the cache-read part of `input` in a nested
  // details object. Reading it is what makes cached vs uncached usage
  // measurable at all; dropping it made every ledger row look fully uncached.
  const details = object(usage.input_tokens_details) ? usage.input_tokens_details : null;
  const cached = details && typeof details.cached_tokens === "number" ? details.cached_tokens : undefined;
  return { input, output, ...(cached !== undefined ? { cachedInput: cached } : {}) };
}

export function createCodexNativeRuntime(options: CodexNativeRuntimeOptions): CodexNativeRuntime {
  const listeners = new Set<RuntimeEventListener>();
  const active = new Map<string, {
    abort: AbortController;
    turnId: string;
    done: Promise<void>;
    approval: ReturnType<typeof createChatToolApproval>;
  }>();
  const transport = options.transport ?? fetch;
  const responsesUrl = options.responsesUrl ?? CODEX_RESPONSES_URL;
  const timeoutPolicy = resolveProviderTimeouts({
    ...(options.requestTimeoutMs ? { idleTimeoutMs: options.requestTimeoutMs, firstTokenTimeoutMs: options.requestTimeoutMs } : {}),
    ...options.timeoutPolicy,
  });
  const retryScale = options.retryScale ?? Number(process.env.FAKE_CODEX_RETRY_SCALE ?? "1");
  const retryBudgetMs = options.retryBudgetMs ?? resolveProviderRetryBudget();
  const clock = options.clock ?? (() => performance.now());

  const emit = (event: RuntimeEvent) => {
    for (const listener of Array.from(listeners)) listener(event);
  };
  const base = (threadId: string, turnId: string) => ({
    eventId: newEventId(),
    provider: "codex",
    threadId,
    turnId,
    createdAt: new Date().toISOString(),
  });

  /** The live credential for a request: refreshed when it is expired or the
   * backend has just rejected it. */
  const credential = async (force: boolean): Promise<CodexCredential> => {
    const environment = options.environment();
    let current = readCodexCredential(environment);
    if (!current) {
      throw new CodexResponsesError("Sign in to ChatGPT for Codex in Settings → Model providers, then try again.");
    }
    if (force || codexCredentialExpired(current)) {
      const refreshed = await refreshCodexCredential(environment, {
        transport: options.transport,
        ...(options.tokenUrl ? { endpoint: options.tokenUrl } : {}),
      });
      if (refreshed) current = refreshed;
      else if (codexCredentialExpired(current)) {
        throw new CodexResponsesError("The ChatGPT sign-in for Codex has expired and could not be renewed. Sign in again in Settings → Model providers.");
      }
    }
    return current;
  };

  const complete = async (request: RequestOptions): Promise<Completion> => {
    const wireTools = request.tools.map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
    const body = JSON.stringify({
      model: request.model,
      ...(request.instructions ? { instructions: request.instructions } : {}),
      input: request.input,
      ...(wireTools.length ? { tools: wireTools, tool_choice: "auto", parallel_tool_calls: true } : {}),
      // The summary parameter is what makes reasoning visible as it streams;
      // the effort knob rides the same object when the bot set one.
      reasoning: { ...(request.effort ? { effort: request.effort } : { effort: "low" }), summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: request.cacheKey,
      max_output_tokens: 16384,
    });

    request.onMetrics?.(measureRequest({
      instructions: request.instructions,
      items: request.input,
      wireTools,
      body,
    }));

    let refreshed = false;
    for (;;) {
      request.signal.throwIfAborted();
      const auth = await credential(refreshed);
      const headers: Record<string, string> = {
        authorization: `Bearer ${auth.accessToken}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        originator: CODEX_ORIGINATOR,
        "session-id": newId(),
        "user-agent": USER_AGENT,
      };
      if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;

      const deadline = createProviderCallDeadline(request.signal, request.deadlinePolicy ?? timeoutPolicy);
      const llmStart = performance.now();
      try {
        const signal = deadline.signal;
        // Raced, not merely signalled: a transport that ignores its abort
        // signal must still leave the turn bounded.
        const response = await raceWithSignal(transport(responsesUrl, { method: "POST", headers, body, signal }), signal);
        const tHeaders = performance.now();
        logHopTiming("LLM_HTTP_HANDSHAKE", tHeaders - llmStart);
        if (response.status === 401 && !refreshed) {
          // One forced renewal on an authentication rejection; a rejected
          // grant is reported as the expired sign-in it is.
          refreshed = true;
          continue;
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new CodexResponsesError(
            `The ChatGPT backend refused the turn (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
          );
        }
        if (!response.body) throw new CodexResponsesError("The ChatGPT backend returned an empty event stream.");
        deadline.onConnected();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const doneItems: JsonRecord[] = [];
        let completedResponse: JsonRecord | null = null;
        let incompleteReason: string | null = null;
        let failure: string | null = null;
        let streamedText = "";
        let reasoning = "";
        let sawEvent = false;
        let firstTokenTime: number | null = null;
        const consume = (line: string): void => {
          if (!line.startsWith("data:")) return;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") return;
          let event: JsonRecord;
          try {
            const parsed: unknown = JSON.parse(data);
            if (!object(parsed)) return;
            event = parsed;
          } catch {
            return;
          }
          sawEvent = true;
          const kind = typeof event.type === "string" ? event.type : "";
          switch (kind) {
            case "response.output_item.done": {
              if (object(event.item)) doneItems.push(event.item);
              break;
            }
            case "response.output_text.delta": {
              if (typeof event.delta === "string" && event.delta) {
                if (firstTokenTime === null) {
                  firstTokenTime = performance.now();
                  logHopTiming("LLM_FIRST_TOKEN", firstTokenTime - tHeaders);
                }
                streamedText += event.delta;
                request.onDelta?.(event.delta, "assistant_text");
              }
              break;
            }
            case "response.reasoning_summary_text.delta": {
              if (typeof event.delta === "string" && event.delta) {
                if (firstTokenTime === null) {
                  firstTokenTime = performance.now();
                  logHopTiming("LLM_FIRST_TOKEN", firstTokenTime - tHeaders);
                }
                reasoning += event.delta;
                request.onDelta?.(event.delta, "reasoning_text");
              }
              break;
            }
            case "response.completed":
            case "response.incomplete": {
              const responseRecord = object(event.response) ? event.response : null;
              if (kind === "response.incomplete") {
                const details = responseRecord && object(responseRecord.incomplete_details) ? responseRecord.incomplete_details : null;
                const reason = details && typeof details.reason === "string" ? details.reason : "unknown";
                const hasRealOutput =
                  doneItems.length > 0 ||
                  (responseRecord !== null && Array.isArray(responseRecord.output) && responseRecord.output.length > 0 &&
                   responseRecord.output.some((it: any) => it?.type === "function_call" || (Array.isArray(it?.content) && it.content.length > 0))) ||
                  streamedText.length > 0;
                const hasOutput = hasRealOutput || reasoning.length > 0;
                const usageRecord = responseRecord && object(responseRecord.usage) ? responseRecord.usage : null;
                const reportedOutput = usageRecord && typeof usageRecord.output_tokens === "number" ? usageRecord.output_tokens : null;
                // A ceiling spends its budget. A response that says
                // `max_output_tokens` while producing no real text, no function calls and zero
                // reported output tokens did not reach a ceiling — the backend aborted before it
                // generated anything and reported this reason anyway (observed
                // on Android: four events, in=0 out=0, empty output). Retrying
                // sends a fresh request and normally answers, so describing it
                // as a token limit would strand the person behind a card that
                // says to ask for less, when there was nothing to shorten.
                const emptyCeiling = (reportedOutput === 0 || reportedOutput === null) && !hasRealOutput;
                if (reason === "max_output_tokens" && emptyCeiling) {
                  failure = "The ChatGPT backend ended the response early with no output or usage.";
                } else if (reason === "max_output_tokens") {
                  // Preserve whatever arrived, but never present the ceiling as
                  // a finished answer. The caller settles it as output_limit and
                  // refuses to execute function_call items from a response the
                  // provider itself marked incomplete.
                  completedResponse = responseRecord || { output: doneItems };
                  incompleteReason = reason;
                } else if (hasOutput) {
                  completedResponse = responseRecord || { output: doneItems };
                } else {
                  failure = `The ChatGPT backend ended the response early (${reason}).`;
                }
              } else if (responseRecord) {
                completedResponse = responseRecord;
              }
              break;
            }
            case "response.failed": {
              failure = failureMessage(object(event.response) ? event.response : null);
              break;
            }
            case "error": {
              failure = failureMessage(object(event.error) ? { error: event.error } : object(event.response) ? event.response : null);
              break;
            }
          }
        };
        try {
          for (;;) {
            const { done, value } = await raceWithSignal(reader.read(), signal);
            if (done) {
              buffer += decoder.decode();
              const tail = buffer.trim();
              if (tail) consume(tail);
              break;
            }
            deadline.onChunkReceived();
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 4_000_000) throw new CodexResponsesError("The provider event stream exceeded the size limit.");
            let newline: number;
            while ((newline = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              consume(line);
            }
          }
        } finally {
          // Released, not awaited: a body whose cancel() never settles would
          // otherwise hold the turn open after its deadline has already fired,
          // which is the wedge this cleanup exists to prevent. The abort has
          // already torn the socket down; this only asks the stream to stop.
          void reader.cancel().catch(() => {});
          deadline.cleanup();
        }
        request.signal.throwIfAborted();
        const errFailure = failure as unknown as string | null;
        if (errFailure) {
          if (errFailure.includes("ended the response early") && !streamedText && !reasoning && !doneItems.length) {
            throw new ProviderEarlyIncompleteError(errFailure);
          }
          throw new CodexResponsesError(errFailure);
        }
        if (!completedResponse) {
          const message = sawEvent
            ? "The ChatGPT backend stream ended before the response completed."
            : "The ChatGPT backend returned an unrecognized event stream.";
          // Nothing was generated for THIS request, so a retry costs one request
          // and cannot duplicate text, work or a side effect.
          if (!streamedText && !reasoning && !doneItems.length) throw new ProviderEarlyIncompleteError(message);
          throw new CodexResponsesError(message);
        }
        const completed = completedResponse as JsonRecord;
        const llmDuration = Math.round(performance.now() - llmStart);
        if (firstTokenTime !== null) {
          logHopTiming("RESPONSE_STREAMING", performance.now() - firstTokenTime);
        }
        logHopTiming("LLM_LATENCY", llmDuration, {
          status: response.status,
          outputTokens: completed.usage && typeof (completed.usage as any).output_tokens === "number" ? (completed.usage as any).output_tokens : undefined,
        });
        const reportedItems = Array.isArray(completed.output) ? completed.output.filter(object) : [];
        const items = doneItems.length ? doneItems : reportedItems;
        const text = items.map(messageText).join("") || streamedText;
        return {
          text,
          reasoning,
          usage: usageFrom(completed.usage),
          items,
          toolCalls: toolCallsIn(items),
          status: typeof completed.status === "string" ? completed.status : null,
          incompleteReason,
        };
      } finally {
        deadline.cleanup();
      }
    }
  };

  /** Mount this turn's MCP surface. The chat runtime's own mount is reused;
   * the phone, browser and computer descriptors are stdio MCP servers too, so
   * they ride the same transport the CLI-side driver hands to codex. */
  const mountTools = async (turn: SendTurnInput, signal: AbortSignal): Promise<ChatToolSession> => {
    const integrations: SendTurnInput["integrations"] = { ...turn.integrations };
    const custom: Record<string, McpServerSpec> = { ...integrations?.custom };
    if (integrations?.phone) custom.phone = integrations.phone;
    if (integrations?.browser) custom.browser = integrations.browser;
    if (integrations?.localComputer) {
      const { command, args, env } = integrations.localComputer;
      custom.computer = { command, args, env };
    }
    const mountStart = performance.now();
    const session = await mountChatTools({ ...integrations, custom }, signal, { expose: turn.toolExposure });
    logHopTiming("MCP_MOUNT_TOTAL", performance.now() - mountStart, {
      servers: Object.keys(custom),
      toolCount: session.definitions.length,
    });
    return session;
  };

  const sendTurn = async (turn: SendTurnInput) => {
    if (active.has(turn.threadId)) throw new Error("a turn is already running on this thread");

    const turnId = newId();
    const abort = new AbortController();
    const model = turn.model || options.models().default;
    const secrets: string[] = [];
    const current = readCodexCredential(options.environment());
    if (current?.accessToken) secrets.push(current.accessToken);
    if (current?.refreshToken) secrets.push(current.refreshToken);
    for (const integration of Object.values(turn.integrations ?? {})) {
      if (integration === null || typeof integration !== "object" || Array.isArray(integration)) continue;
      const entries = integration as JsonRecord;
      const specs: JsonRecord[] = typeof entries.command === "string"
        ? [entries]
        : Object.values(entries).flatMap((value) =>
          value !== null && typeof value === "object" && !Array.isArray(value) ? [value as JsonRecord] : []);
      for (const spec of specs) {
        if (spec.env === null || typeof spec.env !== "object" || Array.isArray(spec.env)) continue;
        for (const [key, value] of Object.entries(spec.env as JsonRecord)) {
          if (/key|token|password|secret|authorization/i.test(key) && typeof value === "string" && value) secrets.push(value);
        }
      }
    }
    const safeText = (text: string) => {
      let safe = text;
      for (const secret of secrets) if (secret) safe = safe.split(secret).join("[redacted]");
      return redactSecretsInText(safe);
    };
    const preview = (value: unknown) => toolDetailPreview(JSON.parse(JSON.stringify(value, (_key, part) =>
      typeof part === "string" ? safeText(part) : part)));
    const native = (dir: "out" | "in", msg: unknown) => appendNative(turn.threadId, {
      dir,
      source: "codex-native",
      msg: JSON.parse(JSON.stringify(msg, (_key, part) => typeof part === "string" ? safeText(part) : part)),
    });
    const approval = createChatToolApproval({
      signal: abort.signal,
      open: (ask) => emit({
        ...base(turn.threadId, turnId), type: "request.opened", requestType: "permission",
        requestId: ask.id, tool: ask.tool, summary: ask.summary, allowSession: false,
      }),
      openQuestions: (ask) => emit({
        ...base(turn.threadId, turnId), type: "request.opened", requestType: "question",
        requestId: ask.id, tool: ask.tool, summary: ask.summary,
        ...(ask.questions?.length ? { questions: ask.questions } : {}),
        ...(ask.choices?.length ? { choices: ask.choices } : {}),
      }),
      resolved: (ask, allowed, source) => emit({
        ...base(turn.threadId, turnId), type: "request.resolved", requestId: ask.id,
        behavior: allowed ? "allow" : "deny", source,
      }),
      resolvedQuestions: (ask, answer, source) => emit({
        ...base(turn.threadId, turnId), type: "request.resolved", requestId: ask.id,
        behavior: "answer", source, ...(answer ? { answer } : {}),
      }),
    });
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    active.set(turn.threadId, { abort, turnId, done, approval });
    emit({ ...base(turn.threadId, turnId), type: "turn.started" });
    emit({ ...base(turn.threadId, turnId), type: "session.started", sessionId: null, model });

    void (async () => {
      let tools: ChatToolSession | undefined;
      const usage: { input: number; output: number; cachedInput?: number } = { input: 0, output: 0 };
      let hasUsage = false;
      let ok = false;
      let stopReason: string | null = null;
      let failure: string | undefined;
      let toolFailed = false;
      const denials: string[] = [];
      const seenCalls = new Set<string>();
      /** What this turn already did, so a resumption never repeats it. */
      const steps: StepRecord[] = [];
      let recoveries = 0;
      // Attempts made by the request sequence that actually failed, counted
      // where they are made: the card must not report the turn's total.
      let attemptsThisRound = 0;
      const input: JsonRecord[] = [
        ...(turn.transcript ?? []).map((message) => message.role === "assistant"
          ? { type: "message", role: "assistant", content: [{ type: "output_text", text: message.text }] }
          : { type: "message", role: "user", content: [{ type: "input_text", text: message.text }] }),
        { type: "message", role: "user", content: [
          { type: "input_text", text: turn.text },
          ...imageContentParts(turn.images),
        ] },
      ];
      let instructions = turn.system ?? "";
      try {
        tools = await mountTools(turn, abort.signal);
        const harnessDefinitions: ChatToolDefinition[] = (turn.turnTools ?? []).map((tool) => ({
          type: "function" as const,
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
        }));
        const definitions = tools.definitions.concat(harnessDefinitions);
        const hasMountedIntegrations = tools.exposure.advertised.length > 0 || tools.exposure.deferred.length > 0;
        if (hasMountedIntegrations) {
          definitions.push(artifactReadDefinition());
        }
        const availability = chatToolAvailabilityNotice(tools.readiness);
        if (availability) instructions = instructions ? `${instructions}\n\n${availability}` : availability;
        // Verified servers this turn deliberately did not advertise up front.
        // They stay one call away, so a narrow request keeps every capability.
        if (tools.exposure.deferred.length) {
          definitions.push(capabilityEnableDefinition(tools.exposure.deferred));
          const deferredNotice = deferredCapabilityNotice(tools.exposure.deferred);
          if (deferredNotice) instructions = instructions ? `${instructions}\n\n${deferredNotice}` : deferredNotice;
        }
        if (tools.exposure.advertised.some((s) => KNOWN_SURFACES.has(s))) {
          definitions.push(capabilityRetireDefinition(tools.exposure.advertised));
        }
        const authoritativeStore = new AuthoritativeToolStore();
        const executionMemory = createStructuredExecutionMemory({
          objective: turn.text,
          currentStage: turn.stage,
        });
        // Emitted at the last point before the first provider request; a
        // pre-provider cancellation never reaches this line.
        emit({
          ...base(turn.threadId, turnId), type: "tool.readiness",
          servers: tools.readiness.servers, toolCount: definitions.length, providerStarted: true,
        });
        for (let round = 0; round < MAX_ROUNDS; round++) {
          abort.signal.throwIfAborted();
          attemptsThisRound = 0;
          // Old tool results and large arguments are what makes a long turn's request grow without
          // bound; recent ones stay verbatim, the rest become bounded summaries.
          compactToolOutputs(input, { store: authoritativeStore, threadId: turn.threadId });
          compactFunctionCallArguments(input, { store: authoritativeStore, threadId: turn.threadId });
          let attempt = 0;
          let completion: Completion;
          // One clock for this round's attempts, started with the first one.
          // A retry may only spend what is left of it, so a provider that
          // never answers costs one budget rather than one per attempt.
          let budget = createProviderRetryBudget(retryBudgetMs, clock);
          // A request that ended with nothing at all is resumable: everything
          // already executed lives in `input`, and none of THIS request's calls
          // ran, so continuing preserves the work instead of losing it.
          const resume = (error: Error): boolean => {
            if (abort.signal.aborted || !(error instanceof ProviderEarlyIncompleteError)) return false;
            if (!steps.length || recoveries >= MAX_RECOVERY_ROUNDS) return false;
            recoveries++;
            attempt = 0;
            budget = createProviderRetryBudget(retryBudgetMs, clock);
            input.push({
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: continuationMessage(steps, executionMemory) }],
            });
            emit({ ...base(turn.threadId, turnId), type: "turn.retrying", attempt: recoveries, delayMs: 0, reason: "early_termination_resume" });
            return true;
          };
          for (;;) {
            let streamed = false;
            const pending = { assistant_text: "", reasoning_text: "" };
            const delta = (text: string, streamKind: keyof typeof pending, flush = false) => {
              let combined = pending[streamKind] + text;
              for (const secret of secrets) if (secret) combined = combined.split(secret).join("[redacted]");
              let hold = 0;
              if (!flush) for (const secret of secrets) {
                for (let length = Math.min(secret.length - 1, combined.length); length > hold; length--) {
                  if (combined.endsWith(secret.slice(0, length))) { hold = length; break; }
                }
              }
              pending[streamKind] = hold ? combined.slice(-hold) : "";
              const visible = safeText(hold ? combined.slice(0, -hold) : combined);
              if (visible) emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind, delta: visible });
            };
            try {
              attemptsThisRound++;
              completion = await complete({
                input,
                model,
                instructions,
                effort: turn.effort ?? null,
                tools: definitions,
                cacheKey: `${turn.threadId}:${turnId}`,
                signal: abort.signal,
                // The first attempt keeps its shipped deadlines; only retries
                // are squeezed into what is left of the sequence's budget.
                deadlinePolicy: attempt === 0 ? timeoutPolicy : budget.policyForAttempt(timeoutPolicy),
                onDelta: (text, streamKind) => {
                  streamed = true;
                  delta(text, streamKind);
                },
                // The tee now carries the measurement of the body it records,
                // so "what was re-sent" is a fact in the trace rather than a
                // reconstruction from a body whose schemas were stripped.
                onMetrics: (metrics) => native("out", {
                  model, instructions, input,
                  tools: definitions.map((tool) => tool.function.name),
                  metrics,
                }),
              });
              delta("", "assistant_text", true);
              delta("", "reasoning_text", true);
              break;
            } catch (value) {
              const error = asError(value);
              const verdict = classifyError(error);
              const nonRetryableTimeout = error instanceof ProviderTimeoutError && (error.phase === "call_total" || error.phase === "idle");
              // A CodexResponsesError is only non-retryable if the retry classifier
              // determines the failure is terminal (e.g. HTTP 400, auth, quota, output ceiling).
              // Transient HTTP 5xx (500, 502, 503, 504) and 429 rate limits must enter
              // bounded retries rather than immediately aborting the turn.
              const nonRetryableCodexError = error instanceof CodexResponsesError &&
                !(error instanceof ProviderEarlyIncompleteError) &&
                !verdict.transient;
              // `seenCalls` deliberately does NOT block this: a retry is issued
              // inside `complete`, before any of this round's calls run, and
              // every call that already ran has its output in `input`. So a
              // retry resumes the task rather than replaying it — refusing it
              // threw away a turn that had already done real work.
              if (abort.signal.aborted || streamed || nonRetryableTimeout ||
                  nonRetryableCodexError || !verdict.transient || attempt >= RETRY_MAX_ATTEMPTS - 1) {
                if (resume(error)) continue;
                throw error;
              }
              // No budget left for another attempt: the sequence ends now, with
              // the phase that actually failed and the total that stopped it.
              if (!budget.allowsAnotherAttempt()) {
                if (resume(error)) continue;
                throw new ProviderRetryBudgetError(error, budget.limitMs, attempt + 1);
              }
              const delayMs = computeBackoff(attempt++);
              emit({ ...base(turn.threadId, turnId), type: "turn.retrying", attempt, delayMs, reason: verdict.reason });
              await interruptibleDelay(delayMs * retryScale, abort.signal).promise;
              abort.signal.throwIfAborted();
              // The wait is part of the budget too: a sequence can run out
              // during backoff, not only during an attempt.
              if (!budget.allowsAnotherAttempt()) {
                if (resume(error)) continue;
                throw new ProviderRetryBudgetError(error, budget.limitMs, attempt + 1);
              }
            }
          }
          native("in", { text: completion.text, reasoning: completion.reasoning, status: completion.status, toolCalls: completion.toolCalls.map((call) => call.name) });
          if (completion.usage) {
            usage.input += completion.usage.input;
            usage.output += completion.usage.output;
            if (typeof completion.usage.cachedInput === "number") {
              usage.cachedInput = (usage.cachedInput ?? 0) + completion.usage.cachedInput;
            }
            hasUsage = true;
            emit({ ...base(turn.threadId, turnId), type: "thread.token-usage.updated", ...usage });
          }
          const incomplete = completion.incompleteReason !== null;
          const reply = completion.text.trim()
            ? completion.text
            : completion.toolCalls.length || incomplete
              ? ""
              : completion.reasoning;
          if (reply.trim()) emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text: safeText(reply) });
          abort.signal.throwIfAborted();
          if (completion.incompleteReason) {
            // The provider stopped at the model's output ceiling. Text emitted
            // above is real and stays in the transcript, but the turn is not a
            // success: a second identical request would reach the same ceiling,
            // and function_call items from an incomplete response must never be
            // executed as if their arguments were final.
            stopReason = "output_limit";
            throw new ProviderOutputLimitError(completion.incompleteReason);
          }
          if (!completion.toolCalls.length) {
            if (!reply.trim()) throw new CodexResponsesError("The ChatGPT backend returned an empty response.");
            if (toolFailed && !reply.trim()) {
              stopReason = "tool_error";
              // Plain words for a real condition: steps failed, so the answer
              // may claim more than happened. The names, codes and recovery
              // steps of those failures are diagnostics — they stay in the
              // turn's own records, never in the person's chat.
              throw new CodexResponsesError("Some steps in this turn did not succeed, so the reply above may be incomplete.");
            }
            if (toolFailed) {
              stopReason = "tool_error";
            }
            ok = true;
            break;
          }
          if (!definitions.length) throw new CodexResponsesError("The model returned tool calls, but no tools are available for this turn.");
          for (const call of completion.toolCalls) {
            if (seenCalls.has(call.callId)) throw new CodexResponsesError("The model reused a tool-call ID; refusing to repeat an operation.");
            seenCalls.add(call.callId);
          }
          if (seenCalls.size > MAX_TOOL_CALLS) throw new CodexResponsesError("Tool-call limit reached.");
          // Everything the response produced returns as input: reasoning items
          // carry the encrypted content a store-less reasoning model needs to
          // continue, and function_call items are what the outputs answer.
          for (const item of completion.items) {
            if (item.type === "reasoning" || item.type === "function_call") input.push(item);
          }
          for (const call of completion.toolCalls) {
            abort.signal.throwIfAborted();
            let result: { text: string; ok: boolean } | undefined;
            let started = false;
            let fatal: Error | undefined;
            let callArgs: Record<string, unknown> = {};
            try {
              let args: unknown;
              try { args = JSON.parse(call.arguments); }
              catch { throw new CodexResponsesError("Tool arguments are not complete JSON."); }
              if (!object(args)) throw new CodexResponsesError("Tool arguments must be a JSON object.");
              callArgs = args;
              const inputPreview = preview(args);
              const harnessTool = (turn.turnTools ?? []).find((tool) => tool.name === call.name);
              const startItem = () => {
                if (started) return;
                started = true;
                emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId: call.callId,
                  title: call.name, ...(inputPreview ? { input: inputPreview } : {}) });
              };
              // Each branch below settles the call on its own — no MCP session,
              // no permission card — and marks it handled so the permission
              // path is skipped. ask_user is matched by name first, so a
              // question can never become a permission ask.
              let handled = false;
              if (call.name === "ask_user") {
                // Structured, flat, and v2-typed shapes all normalize into
                // the one card every client renders, free text included.
                const questions = normalizeAskUserInput(args);
                if (!questions) throw new CodexResponsesError("ask_user needs a question.");
                startItem();
                const answer = await approval.askQuestion("ask_user", askQuestionSummary(questions), { questions });
                abort.signal.throwIfAborted();
                result = answer === null
                  ? { ok: false, text: "The question was left unanswered because the turn was stopped or closed. Wrap up the task without the answer, or say what is still needed." }
                  : { ok: true, text: answer };
                handled = true;
              } else if (call.name === "capability_enable") {
                startItem();
                result = loadCapabilities(tools, (args as { servers?: unknown }).servers, definitions);
                handled = true;
              } else if (call.name === "capability_retire") {
                startItem();
                result = retireCapabilities(tools, (args as { servers?: unknown }).servers, definitions);
                handled = true;
              } else if (call.name === ARTIFACT_READ_TOOL_NAME) {
                startItem();
                result = authoritativeStore.readArtifact((args as { ref?: string }).ref ?? "", args as Record<string, unknown>);
                handled = true;
              } else if (harnessTool) {
                startItem();
                const output = await harnessTool.execute(args as Record<string, unknown>);
                result = { text: output, ok: !/^Error:/m.test(output.slice(0, 200)) };
                handled = true;
              } else {
                tools.validate(call.name, args);
              }
              if (!handled) {
                const diskPerms = loadDiskPermissions();
                // Already advertised for this turn (`tools.validate` ran above).
                const perm = checkToolPermission(call.name, diskPerms, args as Record<string, unknown>, { mountedTool: true });
                if (!perm.allowed) {
                  denials.push(call.name);
                  startItem();
                  result = { ok: false, text: perm.reason || "Permission Denied" };
                  handled = true;
                }
              }
              if (!handled) {
                const cmdStr = String((args as any)?.command || (args as any)?.cmd || "");
                const isMassDel = (Boolean(cmdStr) && isMassDeletionCommand(cmdStr)) || isMassDeletionCommand(inputPreview ?? "")
                  || ((args as any)?.recursive === true && ((args as any)?.path === "/" || (args as any)?.target === "/"));
                // Routine workspace work is what the person asked for by
                // sending the task; only elevated and consequential calls stop
                // for a card. server/tool-approval.ts owns the categories and
                // the words the card shows.
                const assessment = assessToolCall(call.name, args as Record<string, unknown>, { workspaceRoots: turn.cwd ? [turn.cwd] : undefined });
                const allowed = needsApproval(turn.approvalMode ?? "ask", assessment, { massDeletion: isMassDel })
                  ? await approval.ask(call.name, approvalSummary(assessment, inputPreview))
                  : true;
                abort.signal.throwIfAborted();
                startItem();
                if (allowed) {
                  result = await tools.execute(call.name, args as Record<string, unknown>, abort.signal);
                } else {
                  denials.push(call.name);
                  result = { ok: false, text: "Permission denied or expired; the tool was not executed." };
                }
              }
            } catch (error) {
              if (error instanceof ChatToolSessionError) fatal = error;
              result = { ok: false, text: abort.signal.aborted
                ? "Tool interrupted; an operation already dispatched may have taken effect. Verify its state before retrying."
                : safeText(asError(error).message).slice(0, 2_000) };
            }
            if (!started) emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId: call.callId, title: call.name });
            const settled = result ?? { ok: false, text: "The tool produced no result." };
            const text = safeText(settled.text);
            const output = preview({ ok: settled.ok, result: text });
            emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "tool", itemId: call.callId, title: call.name, ok: settled.ok, output, rawOutput: text });
            const summary = text.replace(/\s+/g, " ").trim().slice(0, 160);
            steps.push({ callId: call.callId, name: call.name, ok: settled.ok, summary });
            const callCompletedAt = Date.now();
            authoritativeStore.recordExecution({
              callId: call.callId,
              name: call.name,
              args: callArgs,
              startedAt: callCompletedAt,
              completedAt: callCompletedAt,
              ok: settled.ok,
              rawOutput: text,
              threadId: turn.threadId,
              botId: turn.botId,
            });
            const sideEffect = classifySideEffect(call.name, callArgs);
            if (settled.ok) {
              executionMemory.completedSteps.push({
                callId: call.callId,
                name: call.name,
                summary,
                sideEffect,
                timestamp: callCompletedAt,
              });
              if (callArgs && typeof callArgs.path === "string") {
                const p = callArgs.path;
                if (!executionMemory.touchedFiles.includes(p)) executionMemory.touchedFiles.push(p);
              }
            } else {
              executionMemory.failedSteps.push({
                callId: call.callId,
                name: call.name,
                errorSummary: text.replace(/\s+/g, " ").trim().slice(0, 200),
                timestamp: callCompletedAt,
              });
            }
            if (!settled.ok) toolFailed = true;
            input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: settled.ok, result: text }) });
            abort.signal.throwIfAborted();
            if (fatal) throw fatal;
          }
        }
        if (!ok) throw new CodexResponsesError("Model-call limit reached before a final response.");
      } catch (value) {
        const error = asError(value);
        const verdict = classifyError(error);
        const isTimeout = error instanceof ProviderTimeoutError || verdict.reason === "timeout" || /timeout/i.test(error.message);
        if (error instanceof ProviderOutputLimitError || verdict.reason === "output_limit") {
          stopReason = "output_limit";
        } else if (isTimeout) {
          stopReason = "timeout";
        } else if (abort.signal.aborted) {
          stopReason = "interrupted";
        } else {
          stopReason = stopReason ?? "error";
        }
        failure = safeText(error.message).slice(0, 2_000);
      } finally {
        const tFinalStart = performance.now();
        approval.close();
        let cleanupFailed = false;
        try { await tools?.close(); }
        catch {
          ok = false;
          stopReason = "error";
          cleanupFailed = true;
          failure = "Tool processes could not be stopped; their execution state is uncertain.";
        }
        if (abort.signal.aborted && stopReason !== "timeout") { ok = false; stopReason = "interrupted"; }
        if (failure && (!abort.signal.aborted || stopReason === "timeout" || cleanupFailed)) {
          emit({ ...base(turn.threadId, turnId), type: "runtime.error", message: failure, terminal: !abort.signal.aborted || stopReason === "timeout",
            ...(attemptsThisRound > 0 ? { attempts: attemptsThisRound } : {}) });
        }
        active.delete(turn.threadId);
        emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok, stopReason, cost: null,
          ...(hasUsage && seenCalls.size ? { usage } : {}),
          ...(denials.length ? { denials } : {}),
        });
        resolveDone();
        logHopTiming("FINAL_ANSWER_TURN", performance.now() - tFinalStart);
      }
    })();
    return { turnId };
  };

  const adapter: ProviderAdapter = {
    provider: "codex",
    capabilities: {
      sessionModelSwitch: "in-session",
      agentsMcp: true,
      composioMcp: true,
      customMcp: true,
      computerMcp: true,
      localComputerMcp: true,
      phoneMcp: true,
      browserMcp: true,
      images: true,
      nativeImageInput: true,
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      queueing: false,
      strictResume: false,
    },
    sendTurn,
    interruptTurn: async (threadId, turnId) => {
      const turn = active.get(threadId);
      if (!turn || (turnId && turn.turnId !== turnId)) return;
      turn.abort.abort();
      await turn.done;
    },
    respondToRequest: async (threadId, requestId, decision) =>
      active.get(threadId)?.approval.answer(requestId, decision.behavior, decision.message) ?? "unavailable",
    hasSession: (threadId) => active.has(threadId),
    stopAll: async () => {
      const turns = [...active.values()];
      for (const turn of turns) turn.abort.abort();
      await Promise.all(turns.map((turn) => turn.done));
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    adapter,
    generateText: async (prompt, { signal } = {}) => {
      const completion = await complete({
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }],
        model: options.models().default,
        instructions: "",
        effort: null,
        tools: [],
        cacheKey: `openmausbot-generate-${newId()}`,
        signal: signal ?? new AbortController().signal,
      });
      if (completion.incompleteReason) throw new ProviderOutputLimitError(completion.incompleteReason);
      if (completion.toolCalls.length) throw new CodexResponsesError("The model returned tool calls to a text-only helper.");
      return completion.text.trim() ? completion.text : completion.reasoning;
    },
    dispose: async () => {
      const turns = [...active.values()];
      for (const turn of turns) turn.abort.abort();
      await Promise.all(turns.map((turn) => turn.done));
      listeners.clear();
    },
  };
}
