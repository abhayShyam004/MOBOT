import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import { openSse } from "./sse.ts";

describe("SSE recorder", () => {
  it("rejects pending waits as soon as the remote stream ends", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": connected\n\n");
      setTimeout(() => res.end(), 10);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");

    try {
      const recorder = await openSse(`http://127.0.0.1:${address.port}`);
      await expect(recorder.until(() => false, 5_000)).rejects.toThrow(/stream closed/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("streams and parses Phase 22 workspace_telemetry frames accurately", async () => {
    let activeRes: any = null;
    const server = createServer((_req, res) => {
      activeRes = res;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      });
      res.flushHeaders();
      const telemetry = {
        kind: "workspace_telemetry",
        eventId: "wste_test_1",
        botId: "bot_1",
        surface: "browser",
        timestampMs: 1729000000000,
        isLiveExecution: true,
        frameBase64: "iVBORw0KGgoAAAANSUhEUg==",
        frameHash: "test_hash_123",
        statusCapsuleText: "Browsing: https://github.com/vitejs/vite",
      };
      res.write(`: connected\n\nid: s1:1\ndata: ${JSON.stringify(telemetry)}\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");

    try {
      const recorder = await openSse(`http://127.0.0.1:${address.port}`);
      const frame = await recorder.until((f) => f.kind === "workspace_telemetry", 3_000);
      expect(frame.surface).toBe("browser");
      expect(frame.isLiveExecution).toBe(true);
      expect(frame.frameHash).toBe("test_hash_123");
      expect(frame.statusCapsuleText).toContain("vite");
      recorder.close();
      activeRes?.end();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
