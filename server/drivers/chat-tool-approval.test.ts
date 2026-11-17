import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatToolApproval } from "./chat-tool-approval.ts";

afterEach(() => vi.useRealTimers());

describe("chat tool approval lifecycle", () => {
  it("denies an unanswered request when its deadline expires and rejects late approval", async () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const resolved = vi.fn();
    const gate = createChatToolApproval({ signal: new AbortController().signal, open, resolved, timeoutMs: 100 });
    const answer = gate.ask("audit_write", "Write the fixture receipt");
    const request = open.mock.calls[0][0];

    await vi.advanceTimersByTimeAsync(100);

    await expect(answer).resolves.toBe(false);
    expect(resolved).toHaveBeenCalledExactlyOnceWith(request, false, "timeout");
    expect(gate.answer(request.id, "allow")).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("denies a cancelled ask and never opens another one for the cancelled turn", async () => {
    const abort = new AbortController();
    const open = vi.fn();
    const resolved = vi.fn();
    const gate = createChatToolApproval({ signal: abort.signal, open, resolved });
    const answer = gate.ask("audit_write", "Write the fixture receipt");
    const request = open.mock.calls[0][0];

    abort.abort();

    await expect(answer).resolves.toBe(false);
    expect(resolved).toHaveBeenCalledExactlyOnceWith(request, false, "system");
    expect(gate.answer(request.id, "allow")).toBe("unavailable");
    await expect(gate.ask("audit_write", "A later request")).resolves.toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("closes every outstanding ask and permanently refuses future requests", async () => {
    const open = vi.fn();
    const resolved = vi.fn();
    const gate = createChatToolApproval({ signal: new AbortController().signal, open, resolved });
    const first = gate.ask("audit_write", "First fixture receipt");
    const second = gate.ask("audit_write", "Second fixture receipt");
    const requests = open.mock.calls.map(([request]) => request);

    gate.close();
    gate.close();

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(resolved).toHaveBeenCalledTimes(2);
    for (const request of requests) {
      expect(resolved).toHaveBeenCalledWith(request, false, "system");
      expect(gate.answer(request.id, "allow")).toBe("unavailable");
    }
    await expect(gate.ask("audit_write", "Request after close")).resolves.toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("reports a denial to the model and never reopens the same ask", async () => {
    const opens: Array<{ id: string; tool: string }> = [];
    const resolved = vi.fn();
    const gate = createChatToolApproval({
      signal: new AbortController().signal,
      open: (ask) => opens.push(ask),
      resolved,
    });
    const answer = gate.ask("mcp__composio__GOOGLEDRIVE_UPLOAD_FILE", "Send data to Google Drive");
    expect(opens).toHaveLength(1);
    expect(gate.answer(opens[0].id, "deny")).toBe("rejected");
    await expect(answer).resolves.toBe(false);
    expect(resolved).toHaveBeenCalledExactlyOnceWith(opens[0], false, "user");
    expect(gate.answer(opens[0].id, "allow")).toBe("unavailable");
  });

  it("will not let one request's id settle a different pending request", async () => {
    const opens: Array<{ id: string; tool: string }> = [];
    const resolved = vi.fn();
    const gate = createChatToolApproval({
      signal: new AbortController().signal,
      open: (ask) => opens.push(ask),
      resolved,
    });
    const first = gate.ask("workspace_write", "Write a.ipynb");
    const second = gate.ask("workspace_write", "Write b.ipynb");

    expect(opens).toHaveLength(2);
    expect(opens[0].id).not.toBe(opens[1].id);
    expect(gate.answer(opens[0].id, "deny")).toBe("rejected");
    await expect(first).resolves.toBe(false);
    // The second call is still waiting, and the spent id cannot answer it.
    expect(gate.answer(opens[0].id, "allow")).toBe("unavailable");
    expect(gate.answer(opens[1].id, "allow")).toBe("allowed-once");
    await expect(second).resolves.toBe(true);
  });

  it("registers the request before publishing it so a synchronous harness approval works", async () => {
    const resolved = vi.fn();
    const answered = vi.fn();
    const gate = createChatToolApproval({
      signal: new AbortController().signal,
      open: (request) => answered(gate.answer(request.id, "allow")),
      resolved,
    });

    await expect(gate.ask("audit_write", "Write the fixture receipt")).resolves.toBe(true);

    expect(answered).toHaveBeenCalledExactlyOnceWith("allowed-once");
    expect(resolved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tool: "audit_write" }), true, "user");
    const request = resolved.mock.calls[0][0];
    expect(gate.answer(request.id, "allow")).toBe("unavailable");
  });
});
