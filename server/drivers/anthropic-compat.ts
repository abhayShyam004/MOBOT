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
import { ChatToolSessionError, mountChatTools, type ChatToolDefinition, type ChatToolSession } from "./chat-mcp-tools.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { appendNative } from "./native.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "./retry.ts";

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
  usage: { input: number; output: number } | null;
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
    ): Promise<Completion> => {
      if (!key) throw new AnthropicProtocolError(`No API key configured for this provider — set ${config.apiKeyEnv ?? "ANTHROPIC_COMPAT_API_KEY"} or add one in Model providers.`);
      const wireTools = config.tools === false || !tools.length
        ? undefined
        : tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters,
        }));
      const response = await fetch(`${config.url}/v1/messages`, {
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
        signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AnthropicProtocolError(`The Anthropic-compatible provider refused the turn (HTTP ${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
      }
      if (!response.body) throw new AnthropicProtocolError("The provider returned an empty event stream.");

      const blocks = new Map<number, ContentBlock>();
      let usage: { input: number; output: number } = { input: 0, output: 0 };
      let sawUsage = false;
      let stopReason: string | null = null;
      let failure: string | null = null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
        switch (kind) {
          case "message_start": {
            const message = object(event.message) ? event.message : null;
            const reported = message && object(message.usage) ? message.usage : null;
            if (reported && typeof reported.input_tokens === "number") {
              usage.input = reported.input_tokens;
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
          const { done, value } = await reader.read();
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
        await reader.cancel().catch(() => {});
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
        const usage = { input: 0, output: 0 };
        let hasUsage = false;
        let ok = false;
        let stopReason: string | null = null;
        let failure: string | undefined;
        let toolFailed = false;
        const denials: string[] = [];
        const seenCalls = new Set<string>();
        const messages = messagesFor(turn);
        const system = turn.system ?? "";
        try {
          tools = await mountChatTools(turn.integrations, abort.signal);
          const harnessDefinitions: ChatToolDefinition[] = (turn.turnTools ?? []).map((tool) => ({
            type: "function" as const,
            function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
          }));
          const definitions = tools.definitions.concat(harnessDefinitions);
          for (let round = 0; round < 16; round++) {
            abort.signal.throwIfAborted();
            native("out", { model, system, messages, tools: definitions.map((tool) => tool.function.name) });
            let attempt = 0;
            let completion: Completion;
            for (;;) {
              let streamed = false;
              try {
                completion = await complete(messages, model, system, definitions, abort.signal, (text, kind) => {
                  streamed = true;
                  const visible = safeText(text);
                  if (visible) emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind: kind, delta: visible });
                });
                break;
              } catch (value) {
                const error = asError(value);
                const verdict = classifyError(error);
                if (abort.signal.aborted || streamed || seenCalls.size ||
                    error instanceof AnthropicProtocolError || !verdict.transient || attempt >= RETRY_MAX_ATTEMPTS - 1) throw error;
                const delayMs = computeBackoff(attempt++);
                emit({ ...base(turn.threadId, turnId), type: "turn.retrying", attempt, delayMs, reason: verdict.reason });
                await interruptibleDelay(delayMs, abort.signal).promise;
                abort.signal.throwIfAborted();
              }
            }
            native("in", { text: completion.text, stopReason: completion.stopReason, toolCalls: completion.toolCalls.map((call) => call.name) });
            if (completion.usage) {
              usage.input += completion.usage.input;
              usage.output += completion.usage.output;
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
              try {
                let args: unknown;
                try { args = JSON.parse(call.arguments); }
                catch { throw new AnthropicProtocolError("Tool arguments are not complete JSON."); }
                if (!object(args)) throw new AnthropicProtocolError("Tool arguments must be a JSON object.");
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
                } else if (harnessTool) {
                  startItem();
                  const output = await harnessTool.execute(args as Record<string, unknown>);
                  result = { text: output, ok: !/^Error:/m.test(output.slice(0, 200)) };
                  handled = true;
                } else {
                  tools.validate(call.name, args);
                }
                if (!handled) {
                  const allowed = turn.approvalMode === "full"
                    || await approval.ask(call.name, inputPreview ?? "This tool has no arguments.");
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
              emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "tool", itemId: call.id, ok: settled.ok, output });
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
          stopReason = abort.signal.aborted ? "interrupted" : stopReason ?? "error";
          failure = safeText(asError(value).message).slice(0, 2_000);
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
          if (abort.signal.aborted) { ok = false; stopReason = "interrupted"; }
          if (failure && (!abort.signal.aborted || cleanupFailed)) {
            emit({ ...base(turn.threadId, turnId), type: "runtime.error", message: failure, terminal: !abort.signal.aborted });
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
