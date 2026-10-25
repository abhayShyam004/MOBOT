import { describe, expect, it } from "vitest";

import {
  ERR_REPEATED_ACTION_LOOP,
  RepeatDetector,
  callKey,
  normalizeActionKey,
} from "./repeat-detector.ts";

describe("callKey", () => {
  it("keys on tool plus arguments, normalizing whitespace, and ignores a bare tool name", () => {
    expect(callKey("Bash", "git   status\n")).toBe("Bash:git status");
    expect(callKey("Bash", "  git status ")).toBe("Bash:git status");
    expect(callKey("Bash", undefined)).toBeNull();
    expect(callKey("Bash", "")).toBeNull();
    // ACP titles that are just the tool name again carry no arguments
    expect(callKey("Bash", "Bash")).toBeNull();
    expect(callKey("Read", "Read src/index.ts")).toBe("Read:Read src/index.ts");
  });
});

describe("normalizeActionKey & Repeated Action Audit (Gate A2)", () => {
  it("normalizes action, capability, operation, and whitespace", () => {
    const key1 = normalizeActionKey("  SEARCH FILES  ", " Device.Files ", "FindFiles");
    const key2 = normalizeActionKey("search files", "device.files", "findfiles");
    expect(key1).toBe("device.files:findfiles:");
    expect(key2).toBe(key1);
  });

  it("recognizes same failing action against same resource with different requestId or timestamp as repeated action", () => {
    const key1 = normalizeActionKey("fetch", "network", "get", {
      url: "https://api.example.com/data",
      resourceId: "resource-12345",
      timestamp: 1729780000000,
      requestId: "req-1234-abcd",
      nonce: "987654",
      correlationId: "corr-1111",
    });

    const key2 = normalizeActionKey("fetch", "network", "get", {
      requestId: "req-9999-zyxw",
      url: "https://api.example.com/data",
      resourceId: "resource-12345",
      ts: 1729780005000,
      nonce: "112233",
      cacheBuster: "xyz789",
      clientTimestamp: 1729780006000,
    });

    expect(key1).toBe("network:get:resourceid=resource-12345&url=https://api.example.com/data");
    expect(key2).toBe(key1);
  });

  it("ensures actions against different files, bot IDs, calendar events, or other meaningful resource IDs remain distinguishable", () => {
    // Meaningful resource IDs must NEVER be stripped
    const keyFileA = normalizeActionKey("read", "device.files", "read", {
      path: "/sdcard/Download/budget.xlsx",
      id: "file-alpha-1",
    });
    const keyFileB = normalizeActionKey("read", "device.files", "read", {
      path: "/sdcard/Download/contacts.vcf",
      id: "file-beta-2",
    });
    expect(keyFileA).not.toBe(keyFileB);
    expect(keyFileA).toContain("file-alpha-1");
    expect(keyFileB).toContain("file-beta-2");

    // Bot IDs
    const botA = normalizeActionKey("get_memory", "bot", "read", { botId: "bot-alpha-uuid" });
    const botB = normalizeActionKey("get_memory", "bot", "read", { botId: "bot-beta-uuid" });
    expect(botA).not.toBe(botB);

    // Calendar event IDs
    const event1 = normalizeActionKey("delete_event", "device.calendar", "delete", { eventId: "evt-001" });
    const event2 = normalizeActionKey("delete_event", "device.calendar", "delete", { eventId: "evt-002" });
    expect(event1).not.toBe(event2);
  });

  it("ensures same operation names with materially different parameters are not mistakenly classified as duplicate actions", () => {
    const queryA = normalizeActionKey("search", "web", "query", { q: "node.js replan", limit: 5 });
    const queryB = normalizeActionKey("search", "web", "query", { q: "node.js backoff", limit: 10 });
    expect(queryA).not.toBe(queryB);
    expect(queryA).toBe("web:query:limit=5&q=node.js replan");
    expect(queryB).toBe("web:query:limit=10&q=node.js backoff");
  });

  it("guarantees a harmless parameter reorder does not defeat detection", () => {
    const keyOrder1 = normalizeActionKey("search", "web", "query", {
      limit: 10,
      q: "agentic systems",
      safeSearch: true,
    });
    const keyOrder2 = normalizeActionKey("search", "web", "query", {
      safeSearch: true,
      q: "agentic systems",
      limit: 10,
    });
    expect(keyOrder1).toBe(keyOrder2);
  });

  it("handles nested parameters and absent optional parameters predictably", () => {
    const nested1 = normalizeActionKey("query", "db", "find", {
      filter: { status: "active", tier: "premium" },
      options: { sort: "asc" },
      optionalParam: undefined,
    });

    const nested2 = normalizeActionKey("query", "db", "find", {
      filter: { tier: "premium", status: "active" },
      options: { sort: "asc" },
    });

    expect(nested1).toBe(nested2);
    expect(nested1).toContain('filter={"status":"active","tier":"premium"}');
  });

  it("proves normalization does not expose private parameter values through telemetry", () => {
    const secretKey = normalizeActionKey("authenticate", "service", "login", {
      username: "alice@example.com",
      password: "SuperSecretPassword123!",
      apiKey: "sk-or-v1-abcdef0123456789abcdef0123456789",
      token: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID",
      customSecret: "my-sensitive-token",
    }, {
      sensitiveKeys: ["customSecret"],
    });

    // Zero secret leaks
    expect(secretKey).not.toContain("SuperSecretPassword123!");
    expect(secretKey).not.toContain("sk-or-v1");
    expect(secretKey).not.toContain("eyJhbGci");
    expect(secretKey).not.toContain("my-sensitive-token");

    // Masked safely
    expect(secretKey).toContain("password=[REDACTED]");
    expect(secretKey).toContain("apikey=[REDACTED]");
    expect(secretKey).toContain("token=[REDACTED]");
    expect(secretKey).toContain("customsecret=[REDACTED]");
    expect(secretKey).toContain("username=alice@example.com");
  });
});

describe("RepeatDetector", () => {
  it("fires once at each threshold for the same call in one thread", () => {
    const d = new RepeatDetector({ thresholds: [5, 10, 20] });
    const hits: number[] = [];
    for (let i = 0; i < 25; i++) {
      const r = d.record("t1", "Bash:git status");
      if (r.threshold) hits.push(r.threshold);
    }
    expect(hits).toEqual([5, 10, 20]);
    expect(d.record("t1", "Bash:git status").count).toBe(26);
  });

  it("keeps threads and calls apart without cross-thread contamination", () => {
    const d = new RepeatDetector({ thresholds: [3] });
    for (let i = 0; i < 2; i++) d.record("t1", "Bash:a");
    for (let i = 0; i < 2; i++) d.record("t2", "Bash:a");
    expect(d.record("t1", "Bash:b").threshold).toBeUndefined();
    expect(d.record("t1", "Bash:a").threshold).toBe(3);
    expect(d.record("t2", "Bash:a").threshold).toBe(3);
  });

  it("forgets a thread on settle", () => {
    const d = new RepeatDetector({ thresholds: [3] });
    for (let i = 0; i < 2; i++) d.record("t1", "Bash:a");
    d.settle("t1");
    expect(d.record("t1", "Bash:a").count).toBe(1);
  });

  it("bounds distinct calls per thread and evicts the least recently seen", () => {
    const d = new RepeatDetector({ thresholds: [2], maxKeysPerThread: 2 });
    d.record("t1", "Bash:a");
    d.record("t1", "Bash:b");
    // Refresh a, so b is the least-recently-seen entry.
    expect(d.record("t1", "Bash:a").threshold).toBe(2);
    d.record("t1", "Bash:c");
    expect(d.record("t1", "Bash:a").count).toBe(3);
    expect(d.record("t1", "Bash:b").count).toBe(1);
  });

  it("rejects an invalid memory bound", () => {
    expect(() => new RepeatDetector({ thresholds: [2], maxKeysPerThread: 0 })).toThrow(/positive integer/);
  });

  describe("recordFailingAction", () => {
    it("flags ERR_REPEATED_ACTION_LOOP upon two duplicate failing invocations", () => {
      const detector = new RepeatDetector();
      const actionKey = normalizeActionKey("query", "web", "search", { q: "error 500 test" });

      const res1 = detector.recordFailingAction("thread-1", actionKey);
      expect(res1.count).toBe(1);
      expect(res1.repeatedLoopDetected).toBe(false);
      expect(res1.error).toBeUndefined();

      const res2 = detector.recordFailingAction("thread-1", actionKey);
      expect(res2.count).toBe(2);
      expect(res2.repeatedLoopDetected).toBe(true);
      expect(res2.error).toContain(ERR_REPEATED_ACTION_LOOP);
      expect(res2.error).toContain("attempted the exact same failing action twice");

      // Third attempt continues to flag repeated loop
      const res3 = detector.recordFailingAction("thread-1", actionKey);
      expect(res3.count).toBe(3);
      expect(res3.repeatedLoopDetected).toBe(true);
    });

    it("resets failing count when thread settles", () => {
      const detector = new RepeatDetector();
      const actionKey = "test:failing:action";
      detector.recordFailingAction("thread-1", actionKey);
      expect(detector.recordFailingAction("thread-1", actionKey).repeatedLoopDetected).toBe(true);

      detector.settle("thread-1");
      const fresh = detector.recordFailingAction("thread-1", actionKey);
      expect(fresh.count).toBe(1);
      expect(fresh.repeatedLoopDetected).toBe(false);
    });

    it("isolates failing action counts between distinct actions and threads", () => {
      const detector = new RepeatDetector();
      const action1 = "cap:op:arg=1";
      const action2 = "cap:op:arg=2";

      detector.recordFailingAction("t1", action1);
      const diffAction = detector.recordFailingAction("t1", action2);
      expect(diffAction.count).toBe(1);
      expect(diffAction.repeatedLoopDetected).toBe(false);

      const diffThread = detector.recordFailingAction("t2", action1);
      expect(diffThread.count).toBe(1);
      expect(diffThread.repeatedLoopDetected).toBe(false);
    });
  });
});
