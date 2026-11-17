// Native Anthropic Messages API runtime — the second protocol the custom
// provider manager can add, beside openai-compat.
//
// The Claude *agent* driver is a different thing entirely: it drives the
// Claude Code CLI, its own login and its own tools. This driver is for an
// endpoint that speaks the plain Anthropic Messages wire contract
// (`POST {url}/v1/messages`, `x-api-key`, server-sent events) with an API key
// of the person's own — a proxy, a gateway, or api.anthropic.com itself.
//
// Tools are the same MCP surface every chat runtime mounts: the model's
// `tool_use` blocks run through the shared approval channel, their
// `tool_result` blocks go back as the next user turn, and the transcript the
// phones send is replayed each round like the other HTTP runtimes.
import type { DriverCreateInput, ModelCatalog, ProviderDriver, ProviderInstance, RuntimeEvent, RuntimeEventListener, SendTurnInput } from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
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
  compactAnthropicMessages,
  createStructuredExecutionMemory,
} from "../execution-memory.ts";
import { KNOWN_SURFACES } from "../tool-exposure.ts";
import { checkToolPermission, loadDiskPermissions } from "../permission-policy.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { appendNative } from "./native.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "./retry.ts";
import {
  createProviderCallDeadline,
  ProviderTimeoutError,
  raceWithSignal,
  resolveProviderTimeouts,
  type ProviderTimeoutPolicy,
} from "../provider-deadline.ts";
import {
  createProviderRetryBudget,
  ProviderRetryBudgetError,
  resolveProviderRetryBudget,
} from "../provider-retry-budget.ts";
import { resolveProviderTestEnvelope } from "../provider-test-envelope.ts";
import { isMassDeletionCommand } from "../capabilities/safety-policy.ts";
import { approvalSummary, assessToolCall, needsApproval } from "../tool-approval.ts";

const DRIVER_KIND = "anthropic-compat";
const DEFAULT_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 8192;
const DEFAULT_MODEL = "claude-sonnet-4-5";

export interface AnthropicCompatConfig {
  url: string;
  apiKeyEnv?: string;
  key?: string;
  model?: string;
  /** Explicit text-only mode: a gateway that rejects tools. */
  tools?: boolean;
}

/** A failure in the Messages protocol itself; never retried blindly. */
export class AnthropicProtocolError extends Error {}

type JsonRecord = Record<string, unknown>;

const object = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

interface ContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  /** Partial JSON of a streaming tool_use block. */
  json?: string;
}

interface Completion {
  text: string;
  reasoning: string;
  usage: { input: number; output: number; cachedInput?: number } | null;
  /** The assistant turn's own content blocks, for the next request. */
  blocks: ContentBlock[];
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  stopReason: string | null;
}

function decodeConfig(raw: unknown): AnthropicCompatConfig {
  const config = (raw ?? {}) as Record<string, unknown>;
  if (config.tools !== undefined && typeof config.tools !== "boolean") throw new Error("tools must be a boolean");
  const envUrl = process.env.ANTHROPIC_COMPAT_URL;
  return {
    ...(config.tools !== undefined ? { tools: config.tools as boolean } : {}),
    url: (typeof config.url === "string" && config.url ? config.url : envUrl || DEFAULT_URL).replace(/\/+$/, ""),
    apiKeyEnv: typeof config.apiKeyEnv === "string" && config.apiKeyEnv ? config.apiKeyEnv : "ANTHROPIC_COMPAT_API_KEY",
    key: typeof config.key === "string" && config.key ? config.key : undefined,
    model: typeof config.model === "string" && config.model
      ? config.model
      : process.env.ANTHROPIC_COMPAT_MODEL || undefined,
  };
}

function catalogFor(config: AnthropicCompatConfig): ModelCatalog {
  const model = config.model ?? DEFAULT_MODEL;
  return {
    default: model,
    options: [{ id: model, label: model, custom: true }],
  };
}

function apiKey(config: AnthropicCompatConfig, environment: Record<string, string | undefined>): string {
  return (config.key ?? (config.apiKeyEnv ? environment[config.apiKeyEnv] : undefined) ?? "").trim();
}

type WireMessage = { role: "user" | "assistant"; content: Array<JsonRecord> };

export const AnthropicCompatDriver: ProviderDriver<AnthropicCompatConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Anthropic-compatible (API)", supportsMultipleInstances: true, access: "custom" },
  models: catalogFor({ url: DEFAULT_URL }),
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<AnthropicCompatConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const listeners = new Set<RuntimeEventListener>();
    const active = new Map<string, {
      abort: AbortController;
      turnId: string;
      done: Promise<void>;
      approval: ReturnType<typeof createChatToolApproval>;
    }>();
    const models = catalogFor(config);
    const key = apiKey(config, input.environment);
    // A preview build can shorten the budgets through the same adb-only
    // envelope the native Codex runtime uses (server/provider-test-envelope.ts):
    // it is validated server-side and can only make a wait shorter. The
    // endpoint itself is NOT taken from the envelope here — this driver's URL is
    // the person's own provider setting, and redirecting model traffic is what
    // the envelope's host check exists to prevent.
    const providerTest = resolveProviderTestEnvelope();
    const timeoutPolicy = resolveProviderTimeouts(providerTest.timeoutPolicy ?? {});
    const retryBudgetMs = providerTest.retryBudgetMs ?? resolveProviderRetryBudget();

    const emit = (event: RuntimeEvent) => {
      for (const listener of Array.from(listeners)) listener(event);
    };
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    const complete = async (
      messages: WireMessage[],
      model: string,
      system: string,
      tools: ChatToolDefinition[],
      signal: AbortSignal,
      onDelta?: (delta: string, kind: "assistant_text" | "reasoning_text") => void,
      /** The deadlines for this attempt: shipped on the first try, clamped to
       *  what is left of the retry budget on later ones. */
      deadlinePolicy: ProviderTimeoutPolicy = timeoutPolicy,
    ): Promise<Completion> => {
      if (!key) throw new AnthropicProtocolError(`No API key configured for this provider — set ${config.apiKeyEnv ?? "ANTHROPIC_COMPAT_API_KEY"} or add one in Model providers.`);
      const wireTools = config.tools === false || !tools.length
        ? undefined
        : tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters,
        }));
      // One bounded lifetime per attempt. Before this existed, an endpoint that
      // accepted the request and never answered held the turn until the
      // 20-minute activity watchdog — the failure mode the person reads as
      // "the app is broken".
      const deadline = createProviderCallDeadline(signal, deadlinePolicy);
      try {
        // Raced, not merely signalled: a transport that ignores its abort
        // signal must still leave the turn bounded.
        const response = await raceWithSignal(fetch(`${config.url}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({
            model,
            max_tokens: MAX_TOKENS,
            ...(system ? { system } : {}),
            messages,
            ...(wireTools ? { tools: wireTools } : {}),
            stream: true,
          }),
          signal: deadline.signal,
        }), deadline.signal);
        if (!response.ok) {
          // Bounded too: an error body that never ends must not outlive the turn.
          const body = await raceWithSignal(response.text().catch(() => ""), deadline.signal);
          throw new AnthropicProtocolError(`The Anthropic-compatible provider refused the turn (HTTP ${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
        }
        if (!response.body) throw new AnthropicProtocolError("The provider returned an empty event stream.");
        // Headers arrived: connection established, now the model owes an answer.
        deadline.onConnected();

        const blocks = new Map<number, ContentBlock>();
        let usage: { input: number; output: number; cachedInput?: number } = { input: 0, output: 0 };
        let sawUsage = false;
        let stopReason: string | null = null;
        let failure: string | null = null;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // The Messages protocol's own notion of progress. `ping` proves the
        // connection is alive but NOT that the model has begun answering, so
        // it keeps the idle budget honest after the response started without
        // postponing the first-token deadline for a provider that never
        // answers. That difference is what the person is told: "never began"
        // and "went quiet" are different problems with different next steps.
        let responseBegan = false;
        const noteEvent = (kind: string): void => {
          if (kind === "ping") {
            if (responseBegan) deadline.onChunkReceived();
            return;
          }
          responseBegan = true;
          deadline.onChunkReceived();
        };
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
          const kind = typeof event.type === "string" ? event.type : "";
          noteEvent(kind);
          switch (kind) {
            case "message_start": {
              const message = object(event.message) ? event.message : null;
              const reported = message && object(message.usage) ? message.usage : null;
              if (reported && typeof reported.input_tokens === "number") {
                usage.input = reported.input_tokens;
                const cached = typeof reported.cache_read_input_tokens === "number" ? reported.cache_read_input_tokens : undefined;
                if (typeof cached === "number") {
                  usage.cachedInput = cached;
                }
                sawUsage = true;
              }
              break;
            }
            case "content_block_start": {
              const index = typeof event.index === "number" ? event.index : -1;
              const block = object(event.content_block) ? event.content_block : null;
              if (index < 0 || !block) break;
              if (block.type === "tool_use") {
                blocks.set(index, {
                  type: "tool_use",
                  id: typeof block.id === "string" ? block.id : "",
                  name: typeof block.name === "string" ? block.name : "",
                  json: "",
                });
              } else if (block.type === "text") {
                blocks.set(index, { type: "text", text: "" });
              }
              break;
            }
            case "content_block_delta": {
              const index = typeof event.index === "number" ? event.index : -1;
              const delta = object(event.delta) ? event.delta : null;
              const block = blocks.get(index);
              if (!delta || !block) break;
              if (delta.type === "text_delta" && typeof delta.text === "string") {
                block.text = (block.text ?? "") + delta.text;
                if (delta.text) onDelta?.(delta.text, "assistant_text");
              } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
                block.json = (block.json ?? "") + delta.partial_json;
              }
              break;
            }
            case "message_delta": {
              const delta = object(event.delta) ? event.delta : null;
              if (delta && typeof delta.stop_reason === "string") stopReason = delta.stop_reason;
              const reported = object(event.usage) ? event.usage : null;
              if (reported && typeof reported.output_tokens === "number") {
                usage.output = reported.output_tokens;
                sawUsage = true;
              }
              break;
            }
            case "error": {
              const error = object(event.error) ? event.error : null;
              failure = error && typeof error.message === "string" ? `The provider reported an error: ${error.message}` : "The provider reported an error.";
              break;
            }
          }
        };
        try {
          for (;;) {
            // A reader that never pulls must not outlive the deadline either.
            const { done, value } = await raceWithSignal(reader.read(), deadline.signal);
            if (done) {
              buffer += decoder.decode();
              const tail = buffer.trim();
              if (tail) consume(tail);
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 4_000_000) throw new AnthropicProtocolError("The provider event stream exceeded the size limit.");
            let newline: number;
            while ((newline = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              consume(line);
            }
          }
        } finally {
          // Released, not awaited: a body whose cancel() never settles would
          // otherwise hold the turn open after its deadline has already fired.
          void reader.cancel().catch(() => {});
        }
        signal.throwIfAborted();
        if (failure) throw new AnthropicProtocolError(failure);
        const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
        const text = ordered.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
        const toolCalls = ordered
          .filter((block) => block.type === "tool_use")
          .map((block) => ({
            id: block.id ?? "",
            name: block.name ?? "",
            arguments: block.json?.trim() ? block.json : JSON.stringify(block.input ?? {}),
          }))
          .filter((call) => call.id && call.name);
      return { text, reasoning: "", usage: sawUsage ? usage : null, blocks: ordered, toolCalls, stopReason };
      } finally {
        deadline.cleanup();
      }
    };

    const messagesFor = (turn: SendTurnInput): WireMessage[] => [
      ...(turn.transcript ?? []).map((message) => message.role === "assistant"
        ? { role: "assistant" as const, content: [{ type: "text", text: message.text }] }
        : { role: "user" as const, content: [{ type: "text", text: message.text }] }),
      { role: "user", content: [{ type: "text", text: turn.text }] },
    ];

    const sendTurn = async (turn: SendTurnInput) => {
      if (!key) throw new AnthropicProtocolError(`No API key configured for this provider — set ${config.apiKeyEnv ?? "ANTHROPIC_COMPAT_API_KEY"} or add one in Model providers.`);
      if (active.has(turn.threadId)) throw new Error("a turn is already running on this thread");

      const turnId = newId();
      const abort = new AbortController();
      const model = turn.model || models.default;
      const secrets = [key];
      const safeText = (text: string) => {
        let safe = text;
        for (const secret of secrets) if (secret) safe = safe.split(secret).join("[redacted]");
        return redactSecretsInText(safe);
      };
      const preview = (value: unknown) => toolDetailPreview(JSON.parse(JSON.stringify(value, (_key, part) =>
        typeof part === "string" ? safeText(part) : part)));
      const native = (dir: "out" | "in", msg: unknown) => appendNative(turn.threadId, {
        dir,
        source: DRIVER_KIND,
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
        // Counted where the request is made, not assumed: a card that says
        // "3 attempts" after two is a lie the person cannot check.
        let attemptsMade = 0;
        const messages = messagesFor(turn);
        let system = turn.system ?? "";
        try {
          tools = await mountChatTools(turn.integrations, abort.signal, { expose: turn.toolExposure });
          const harnessDefinitions: ChatToolDefinition[] = (turn.turnTools ?? []).map((tool) => ({
            type: "function" as const,
            function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
          }));
          const definitions = tools.definitions.concat(harnessDefinitions);
          if (tools.exposure.advertised.length > 0) {
            definitions.push(artifactReadDefinition());
          }
          const availability = chatToolAvailabilityNotice(tools.readiness);
          if (availability) system = system ? `${system}\n\n${availability}` : availability;
          if (tools.exposure.deferred.length) {
            definitions.push(capabilityEnableDefinition(tools.exposure.deferred));
            const deferredNotice = deferredCapabilityNotice(tools.exposure.deferred);
            if (deferredNotice) system = system ? `${system}\n\n${deferredNotice}` : deferredNotice;
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
          for (let round = 0; round < 64; round++) {
            abort.signal.throwIfAborted();
            compactAnthropicMessages(messages, { store: authoritativeStore, threadId: turn.threadId });
            native("out", { model, system, messages, tools: definitions.map((tool) => tool.function.name) });
            let attempt = 0;
            let completion: Completion;
            // One clock for this round's attempts, started with the first one.
            // A retry may only spend what is left of it, so a provider that
            // never answers costs one budget rather than one per attempt.
            const budget = createProviderRetryBudget(retryBudgetMs);
            for (;;) {
              let streamed = false;
              try {
                attemptsMade++;
                completion = await complete(messages, model, system, definitions, abort.signal, (text, kind) => {
                  streamed = true;
                  const visible = safeText(text);
                  if (visible) emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind: kind, delta: visible });
                }, attempt === 0 ? timeoutPolicy : budget.policyForAttempt(timeoutPolicy));
                break;
              } catch (value) {
                const error = asError(value);
                const verdict = classifyError(error);
                // A response that stalls or overruns has already delivered
                // something or been given its own full budget; retrying it
                // only makes the person wait twice for the same answer.
                const nonRetryableTimeout = error instanceof ProviderTimeoutError &&
                  (error.phase === "call_total" || error.phase === "idle");
                if (abort.signal.aborted || streamed || seenCalls.size || nonRetryableTimeout ||
                    error instanceof AnthropicProtocolError || !verdict.transient || attempt >= RETRY_MAX_ATTEMPTS - 1) throw error;
                // No budget left for another attempt: the sequence ends now,
                // with the phase that actually failed and the total that
                // stopped it.
                if (!budget.allowsAnotherAttempt()) {
                  throw new ProviderRetryBudgetError(error, budget.limitMs, attempt + 1);
                }
                const delayMs = computeBackoff(attempt++);
                emit({ ...base(turn.threadId, turnId), type: "turn.retrying", attempt, delayMs, reason: verdict.reason });
                await interruptibleDelay(delayMs, abort.signal).promise;
                abort.signal.throwIfAborted();
                // The wait is part of the budget too: a sequence can run out
                // during backoff, not only during an attempt.
                if (!budget.allowsAnotherAttempt()) {
                  throw new ProviderRetryBudgetError(error, budget.limitMs, attempt + 1);
                }
              }
            }
            native("in", { text: completion.text, stopReason: completion.stopReason, toolCalls: completion.toolCalls.map((call) => call.name) });
            if (completion.usage) {
              usage.input += completion.usage.input;
              usage.output += completion.usage.output;
              if (typeof completion.usage.cachedInput === "number") {
                usage.cachedInput = (usage.cachedInput ?? 0) + completion.usage.cachedInput;
              }
              hasUsage = true;
              emit({ ...base(turn.threadId, turnId), type: "thread.token-usage.updated", ...usage });
            }
            const reply = completion.text.trim() ? completion.text : completion.toolCalls.length ? "" : "";
            if (reply.trim()) emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text: safeText(reply) });
            abort.signal.throwIfAborted();
            if (!completion.toolCalls.length) {
              if (!reply.trim()) throw new AnthropicProtocolError("The provider returned an empty response.");
              if (toolFailed) {
                stopReason = "tool_error";
                // Plain words for a real condition: steps failed, so the answer
                // may claim more than happened. The names, codes and recovery
                // steps of those failures are diagnostics — they stay in the
                // turn's own records, never in the person's chat.
                throw new AnthropicProtocolError("Some steps in this turn did not succeed, so the reply above may be incomplete.");
              }
              ok = true;
              break;
            }
            if (!definitions.length) throw new AnthropicProtocolError("The model returned tool calls, but no tools are available for this turn.");
            for (const call of completion.toolCalls) {
              if (seenCalls.has(call.id)) throw new AnthropicProtocolError("The model reused a tool-call ID; refusing to repeat an operation.");
              seenCalls.add(call.id);
            }
            messages.push({
              role: "assistant",
              content: completion.blocks.map((block) => block.type === "tool_use"
                ? { type: "tool_use", id: block.id, name: block.name, input: parseToolInput(block) }
                : { type: "text", text: block.text ?? "" }),
            });
            const results: JsonRecord[] = [];
            for (const call of completion.toolCalls) {
              abort.signal.throwIfAborted();
              let result: { text: string; ok: boolean } | undefined;
              let started = false;
              let fatal: Error | undefined;
              let callArgs: Record<string, unknown> = {};
              try {
                let args: unknown;
                try { args = JSON.parse(call.arguments); }
                catch { throw new AnthropicProtocolError("Tool arguments are not complete JSON."); }
                if (!object(args)) throw new AnthropicProtocolError("Tool arguments must be a JSON object.");
                callArgs = args;
                const inputPreview = preview(args);
                const harnessTool = (turn.turnTools ?? []).find((tool) => tool.name === call.name);
                const startItem = () => {
                  if (started) return;
                  started = true;
                  emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId: call.id,
                    title: call.name, ...(inputPreview ? { input: inputPreview } : {}) });
                };
                // Each branch below settles the call on its own — no MCP
                // session, no permission card — and marks it handled so the
                // permission path is skipped. ask_user is matched by name
                // first, so a question can never become a permission ask.
                let handled = false;
                if (call.name === "ask_user") {
                  // Structured, flat, and v2-typed shapes all normalize into
                  // the one card every client renders, free text included.
                  const questions = normalizeAskUserInput(args);
                  if (!questions) throw new AnthropicProtocolError("ask_user needs a question.");
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
                  // Routine workspace work runs without a card; elevated and
                  // consequential calls still stop for one. See
                  // server/tool-approval.ts.
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
              if (!started) emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId: call.id, title: call.name });
              const settled = result ?? { ok: false, text: "The tool produced no result." };
              const text = safeText(settled.text);
              const output = preview({ ok: settled.ok, result: text });
              emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "tool", itemId: call.id, title: call.name, ok: settled.ok, output, rawOutput: text });
              const callCompletedAt = Date.now();
              authoritativeStore.recordExecution({
                callId: call.id,
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
                  callId: call.id,
                  name: call.name,
                  summary: text.replace(/\s+/g, " ").trim().slice(0, 160),
                  sideEffect,
                  timestamp: callCompletedAt,
                });
                if (callArgs && typeof callArgs.path === "string") {
                  const p = callArgs.path;
                  if (!executionMemory.touchedFiles.includes(p)) executionMemory.touchedFiles.push(p);
                }
              } else {
                executionMemory.failedSteps.push({
                  callId: call.id,
                  name: call.name,
                  errorSummary: text.replace(/\s+/g, " ").trim().slice(0, 200),
                  timestamp: callCompletedAt,
                });
              }
              if (!settled.ok) toolFailed = true;
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: JSON.stringify({ ok: settled.ok, result: text }),
                ...(settled.ok ? {} : { is_error: true }),
              });
              abort.signal.throwIfAborted();
              if (fatal) throw fatal;
            }
            messages.push({ role: "user", content: results });
          }
          if (!ok) throw new AnthropicProtocolError("Model-call limit reached before a final response.");
        } catch (value) {
          const error = asError(value);
          const verdict = classifyError(error);
          // A deadline is a timeout, not a generic error: the card's own words
          // for each phase hang off this classification.
          const isTimeout = error instanceof ProviderTimeoutError || verdict.reason === "timeout" || /timeout/i.test(error.message);
          stopReason = isTimeout ? "timeout" : abort.signal.aborted ? "interrupted" : stopReason ?? "error";
          failure = safeText(error.message).slice(0, 2_000);
        } finally {
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
            emit({ ...base(turn.threadId, turnId), type: "runtime.error", message: failure,
              terminal: !abort.signal.aborted || stopReason === "timeout",
              ...(attemptsMade > 0 ? { attempts: attemptsMade } : {}) });
          }
          active.delete(turn.threadId);
          emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok, stopReason, cost: null,
            ...(hasUsage ? { usage } : {}),
            ...(denials.length ? { denials } : {}),
          });
          resolveDone();
        }
      })();
      return { turnId };
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: input.displayName,
      enabled: input.enabled,
      get models() {
        return models;
      },
      snapshot: async () => key
        ? { state: "available", authenticated: true, version: null }
        : { state: "unavailable", reason: `no API key — set ${config.apiKeyEnv ?? "ANTHROPIC_COMPAT_API_KEY"} or add one to this provider` },
      adapter: {
        provider: DRIVER_KIND,
        capabilities: {
          sessionModelSwitch: "in-session",
          customMcp: true,
          agentsMcp: true,
          composioMcp: true,
          computerMcp: true,
          localComputerMcp: true,
          phoneMcp: true,
          browserMcp: true,
          images: false,
          nativeImageInput: false,
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
      },
      generateText: async (prompt, { signal } = {}) => {
        const completion = await complete(
          [{ role: "user", content: [{ type: "text", text: prompt }] }],
          models.default,
          "",
          [],
          signal ?? new AbortController().signal,
        );
        if (completion.toolCalls.length) throw new AnthropicProtocolError("The model returned tool calls to a text-only helper.");
        return completion.text;
      },
      dispose: async () => {
        const turns = [...active.values()];
        for (const turn of turns) turn.abort.abort();
        await Promise.all(turns.map((turn) => turn.done));
        listeners.clear();
      },
    };
  },
};

/** A streaming tool_use block may arrive as partial JSON; an unparsable body
 * is handed over as an empty object so the call is answered honestly rather
 * than executed with garbage. */
function parseToolInput(block: ContentBlock): unknown {
  if (block.input !== undefined) return block.input;
  const raw = block.json?.trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return object(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
