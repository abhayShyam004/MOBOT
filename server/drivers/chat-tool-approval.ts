// Per-turn permission gate, adapted from the approval lifecycle in #780.
// Register before publishing: a harness listener may answer synchronously.
import { newId, type RequestOutcome } from "../contracts.ts";
import type { AskQuestion } from "../../shared/ask-question.ts";

interface Ask { id: string; tool: string; summary: string }
/** A model's own question: structured, flat choices, or free text only. */
interface QuestionAsk extends Ask { questions?: AskQuestion[]; choices?: string[] }
type Source = "user" | "timeout" | "system";

export function createChatToolApproval(options: {
  signal: AbortSignal;
  open(ask: Ask): void;
  /** A model's structured ask: the card carries its own questions. */
  openQuestions?(ask: QuestionAsk): void;
  resolved(ask: Ask, allowed: boolean, source: Source): void;
  resolvedQuestions?(ask: QuestionAsk, answer: string, source: Source): void;
  timeoutMs?: number;
}) {
  const pending = new Map<string, (outcome: { allowed: boolean; answer?: string }, source: Source) => void>();
  let closed = false;
  return {
    ask(tool: string, summary: string): Promise<boolean> {
      if (closed || options.signal.aborted) return Promise.resolve(false);
      const ask = { id: newId(), tool, summary };
      return new Promise((resolve) => {
        const finish = (outcome: { allowed: boolean; answer?: string }, source: Source) => {
          if (!pending.delete(ask.id)) return;
          clearTimeout(timer);
          options.signal.removeEventListener("abort", abort);
          options.resolved(ask, outcome.allowed, source);
          resolve(outcome.allowed);
        };
        const abort = () => finish({ allowed: false }, "system");
        const timer = setTimeout(() => finish({ allowed: false }, "timeout"), options.timeoutMs ?? 15 * 60_000);
        timer.unref?.();
        pending.set(ask.id, finish);
        options.signal.addEventListener("abort", abort, { once: true });
        options.open(ask);
      });
    },
    /**
     * A model's own question (ask_user): resolves with the person's words
     * instead of an allow/deny, and those words become the tool result. There
     * is deliberately no timeout — the turn is allowed to wait on a human for
     * as long as the card is open; only closing the turn (interrupt, session
     * end) resolves it unanswered.
     */
    askQuestion(tool: string, summary: string, spec: { questions?: AskQuestion[]; choices?: string[] }): Promise<string | null> {
      if (closed || options.signal.aborted) return Promise.resolve(null);
      const ask: QuestionAsk = { id: newId(), tool, summary, ...spec };
      return new Promise((resolve) => {
        // Same outcome shape every finisher in the map takes: the answer, if
        // any, rides in `answer` and is the tool result the model receives.
        const finish = (outcome: { allowed: boolean; answer?: string }, source: Source) => {
          if (!pending.delete(ask.id)) return;
          options.signal.removeEventListener("abort", abort);
          const answer = typeof outcome.answer === "string" && outcome.answer.trim() ? outcome.answer : null;
          if (answer === null) options.resolved(ask, false, source);
          else options.resolvedQuestions?.(ask, answer, source);
          resolve(answer);
        };
        const abort = () => finish({ allowed: false }, "system");
        options.signal.addEventListener("abort", abort, { once: true });
        pending.set(ask.id, finish);
        if (options.openQuestions) options.openQuestions(ask);
        else options.open(ask);
      });
    },
    answer(id: string, behavior: "allow" | "deny" | "answer", message?: string): RequestOutcome {
      const finish = pending.get(id);
      if (!finish || options.signal.aborted) return "unavailable";
      if (behavior === "answer") {
        // A text answer only fits a question ask; a permission ask has no
        // question to answer, so nothing here consumes it.
        if (typeof message !== "string" || !message.trim()) return "unavailable";
        finish({ allowed: false, answer: message }, "user");
        return "answered";
      }
      finish({ allowed: behavior === "allow" }, "user");
      return behavior === "allow" ? "allowed-once" : "rejected";
    },
    close() {
      closed = true;
      for (const finish of pending.values()) finish({ allowed: false }, "system");
    },
  };
}
