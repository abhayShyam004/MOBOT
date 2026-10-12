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
import { redactSecretsInText } from "../redact.ts";
import { askQuestionSummary, normalizeAskUserInput } from "../../shared/ask-question.ts";
import { toolDetailPreview } from "../tool-summary.ts";
import { ChatToolSessionError, mountChatTools, type ChatToolDefinition, type ChatToolSession } from "./chat-mcp-tools.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { appendNative } from "./native.ts";
import { readCodexCredential, codexCredentialExpired, refreshCodexCredential, type CodexCredential } from "./codex-native-auth.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "./retry.ts";

/** The ChatGPT/Codex backend endpoint the CLI calls. */
export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
/** The originator the backend gates Codex-protocol traffic on. OpenMausBot
 * speaks the CLI's own protocol on the person's own sign-in; this marks the
 * request as one from that protocol family rather than an unknown client. */
const CODEX_ORIGINATOR = "codex_cli_rs";
const USER_AGENT = "openmausbot-codex-native";
const MAX_TOOL_CALLS = 128;
const MAX_ROUNDS = 16;

/** A failure in the ChatGPT backend protocol itself; never retried blindly. */
export class CodexResponsesError extends Error {}

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
  usage: { input: number; output: number } | null;
  /** The response's own output items, for the next round's input. */
  items: JsonRecord[];
  toolCalls: FunctionCall[];
  status: string | null;
}

interface RequestOptions {
  input: JsonRecord[];
  model: string;
  instructions: string;
  effort: string | null;
  tools: ChatToolDefinition[];
  cacheKey: string;
  sessionId: string;
  signal: AbortSignal;
  onDelta?: (delta: string, kind: "assistant_text" | "reasoning_text") => void;
  timeoutMs: number;
}

export interface CodexNativeRuntimeOptions {
  environment: () => Record<string, string | undefined>;
  models: () => ModelCatalog;
  /** Injectable for tests; defaults to the global fetch. */
  transport?: typeof fetch;
  responsesUrl?: string;
  tokenUrl?: string;
  requestTimeoutMs?: number;
  retryScale?: number;
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

function usageFrom(usage: unknown): { input: number; output: number } | null {
  if (!object(usage)) return null;
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  return { input, output };
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
  const timeoutMs = options.requestTimeoutMs ?? 120_000;
  const retryScale = options.retryScale ?? Number(process.env.FAKE_CODEX_RETRY_SCALE ?? "1");

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
      reasoning: { ...(request.effort ? { effort: request.effort } : {}), summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: request.cacheKey,
    });

    let refreshed = false;
    for (;;) {
      request.signal.throwIfAborted();
      const auth = await credential(refreshed);
      const headers: Record<string, string> = {
        authorization: `Bearer ${auth.accessToken}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        originator: CODEX_ORIGINATOR,
        "session-id": request.sessionId,
        "user-agent": USER_AGENT,
      };
      if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;

      const timeoutController = new AbortController();
      let idleTimer: NodeJS.Timeout | null = null;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          timeoutController.abort(new DOMException("Streaming idle timeout elapsed", "AbortError"));
        }, request.timeoutMs);
      };
      resetIdleTimer();
      try {
        const signal = AbortSignal.any([request.signal, timeoutController.signal]);
        const response = await transport(responsesUrl, { method: "POST", headers, body, signal });
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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const doneItems: JsonRecord[] = [];
        let completedResponse: JsonRecord | null = null;
        let failure: string | null = null;
        let streamedText = "";
        let reasoning = "";
        let sawEvent = false;
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
                streamedText += event.delta;
                request.onDelta?.(event.delta, "assistant_text");
              }
              break;
            }
            case "response.reasoning_summary_text.delta": {
              if (typeof event.delta === "string" && event.delta) {
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
                failure = `The ChatGPT backend ended the response early (${reason}).`;
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
            const { done, value } = await reader.read();
            if (done) {
              buffer += decoder.decode();
              const tail = buffer.trim();
              if (tail) consume(tail);
              break;
            }
            resetIdleTimer();
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
          await reader.cancel().catch(() => {});
        }
        request.signal.throwIfAborted();
        if (failure) throw new CodexResponsesError(failure);
        if (!completedResponse) {
          throw new CodexResponsesError(sawEvent
            ? "The ChatGPT backend stream ended before the response completed."
            : "The ChatGPT backend returned an unrecognized event stream.");
        }
        const completed = completedResponse as JsonRecord;
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
        };
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
    }
  };

  /** Mount this turn's MCP surface. The chat runtime's own mount is reused;
   * the phone, browser and computer descriptors are stdio MCP servers too, so
   * they ride the same transport the CLI-side driver hands to codex. */
  const mountTools = (turn: SendTurnInput, signal: AbortSignal): Promise<ChatToolSession> => {
    const integrations: SendTurnInput["integrations"] = { ...turn.integrations };
    const custom: Record<string, McpServerSpec> = { ...integrations?.custom };
    if (integrations?.phone) custom.phone = integrations.phone;
    if (integrations?.browser) custom.browser = integrations.browser;
    if (integrations?.localComputer) {
      const { command, args, env } = integrations.localComputer;
      custom.computer = { command, args, env };
    }
    return mountChatTools({ ...integrations, custom }, signal);
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
      const usage = { input: 0, output: 0 };
      let hasUsage = false;
      let ok = false;
      let stopReason: string | null = null;
      let failure: string | undefined;
      let toolFailed = false;
      const denials: string[] = [];
      const seenCalls = new Set<string>();
      const input: JsonRecord[] = [
        ...(turn.transcript ?? []).map((message) => message.role === "assistant"
          ? { type: "message", role: "assistant", content: [{ type: "output_text", text: message.text }] }
          : { type: "message", role: "user", content: [{ type: "input_text", text: message.text }] }),
        { type: "message", role: "user", content: [
          { type: "input_text", text: turn.text },
          ...imageContentParts(turn.images),
        ] },
      ];
      const instructions = turn.system ?? "";
      try {
        tools = await mountTools(turn, abort.signal);
        const harnessDefinitions: ChatToolDefinition[] = (turn.turnTools ?? []).map((tool) => ({
          type: "function" as const,
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
        }));
        const definitions = tools.definitions.concat(harnessDefinitions);
        for (let round = 0; round < MAX_ROUNDS; round++) {
          abort.signal.throwIfAborted();
          native("out", { model, instructions, input, tools: definitions.map((tool) => tool.function.name) });
          let attempt = 0;
          let completion: Completion;
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
              completion = await complete({
                input,
                model,
                instructions,
                effort: turn.effort ?? null,
                tools: definitions,
                cacheKey: turn.threadId,
                sessionId: turn.threadId,
                signal: abort.signal,
                timeoutMs,
                onDelta: (text, streamKind) => {
                  streamed = true;
                  delta(text, streamKind);
                },
              });
              delta("", "assistant_text", true);
              delta("", "reasoning_text", true);
              break;
            } catch (value) {
              const error = asError(value);
              const verdict = classifyError(error);
              if (abort.signal.aborted || streamed || seenCalls.size ||
                  error instanceof CodexResponsesError || !verdict.transient || attempt >= RETRY_MAX_ATTEMPTS - 1) throw error;
              const delayMs = computeBackoff(attempt++);
              emit({ ...base(turn.threadId, turnId), type: "turn.retrying", attempt, delayMs, reason: verdict.reason });
              await interruptibleDelay(delayMs * retryScale, abort.signal).promise;
              abort.signal.throwIfAborted();
            }
          }
          native("in", { text: completion.text, reasoning: completion.reasoning, status: completion.status, toolCalls: completion.toolCalls.map((call) => call.name) });
          if (completion.usage) {
            usage.input += completion.usage.input;
            usage.output += completion.usage.output;
            hasUsage = true;
            emit({ ...base(turn.threadId, turnId), type: "thread.token-usage.updated", ...usage });
          }
          const reply = completion.text.trim() ? completion.text : completion.toolCalls.length ? "" : completion.reasoning;
          if (reply.trim()) emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text: safeText(reply) });
          abort.signal.throwIfAborted();
          if (!completion.toolCalls.length) {
            if (!reply.trim()) throw new CodexResponsesError("The ChatGPT backend returned an empty response.");
            if (toolFailed) {
              stopReason = "tool_error";
              // Plain words for a real condition: steps failed, so the answer
              // may claim more than happened. The names, codes and recovery
              // steps of those failures are diagnostics — they stay in the
              // turn's own records, never in the person's chat.
              throw new CodexResponsesError("Some steps in this turn did not succeed, so the reply above may be incomplete.");
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
            try {
              let args: unknown;
              try { args = JSON.parse(call.arguments); }
              catch { throw new CodexResponsesError("Tool arguments are not complete JSON."); }
              if (!object(args)) throw new CodexResponsesError("Tool arguments must be a JSON object.");
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
            if (!started) emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId: call.callId, title: call.name });
            const settled = result ?? { ok: false, text: "The tool produced no result." };
            const text = safeText(settled.text);
            const output = preview({ ok: settled.ok, result: text });
            emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "tool", itemId: call.callId, ok: settled.ok, output });
            if (!settled.ok) toolFailed = true;
            input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: settled.ok, result: text }) });
            abort.signal.throwIfAborted();
            if (fatal) throw fatal;
          }
        }
        if (!ok) throw new CodexResponsesError("Model-call limit reached before a final response.");
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
          ...(hasUsage && seenCalls.size ? { usage } : {}),
          ...(denials.length ? { denials } : {}),
        });
        resolveDone();
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
        cacheKey: "openmausbot-generate",
        sessionId: newId(),
        signal: signal ?? new AbortController().signal,
        timeoutMs,
      });
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
