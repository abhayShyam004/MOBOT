// Phase 7 unit tests: the android-browser MCP boundary. The driver is stubbed
// (the real one is Android WebView, exercised on-device by
// scripts/test-android-browser.mjs); these tests pin the contract the harness
// and the driver depend on: env fail-closed, tool schema, session identity,
// and result shaping.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const dirs: string[] = [];
const procs: ChildProcess[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const p of procs) { try { p.kill("SIGKILL"); } catch { /* already dead */ } }
  procs.length = 0;
  for (const s of servers) { try { s.close(); } catch { /* already closed */ } }
  servers.length = 0;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

/** Compile the TS server to a temp file and run it with the given env. */
function startServer(env: Record<string, string>, entry = join(import.meta.dirname, "android-browser.ts")): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", entry],
    { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] },
  );
  procs.push(child);
  return child;
}

function rpc(child: ChildProcess, message: Record<string, unknown>, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`rpc timeout: ${JSON.stringify(message).slice(0, 80)}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.id === message.id) {
            clearTimeout(timer);
            child.stdout!.off("data", onData);
            resolve(parsed);
          }
        } catch { /* partial line */ }
      }
    };
    child.stdout!.on("data", onData);
    child.stdin!.write(JSON.stringify(message) + "\n");
  });
}

/** Stub driver: records requests, answers with a canned ok payload. */
function stubDriver(status = 200, payload: Record<string, unknown> = { ok: true }): {
  port: () => number; requests: Array<{ path: string; auth: string | undefined; body: unknown }>;
} {
  const requests: Array<{ path: string; auth: string | undefined; body: unknown }> = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString("utf8"); });
    req.on("end", () => {
      requests.push({ path: req.url ?? "", auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  return {
    port: () => (server.listening ? (server.address() as { port: number }).port : 0),
    requests,
  };
}

describe("android-browser MCP server", () => {
  let port: number;
  let token: string;
  let sessionsRoot: string;
  let driverRequests: Array<{ path: string; auth: string | undefined; body: unknown }>;

  beforeEach(async () => {
    token = "test-token-123";
    sessionsRoot = mkdtempSync(join(tmpdir(), "omb-ab-"));
    dirs.push(sessionsRoot);
    const stub = stubDriver();
    driverRequests = stub.requests;
    // The stub listens lazily; wait for the port to be assigned.
    await new Promise<void>((resolve) => {
      const tick = () => (stub.port() > 0 ? resolve() : setTimeout(tick, 5));
      tick();
    });
    port = stub.port();
  });

  async function start(): Promise<ChildProcess> {
    const child = startServer({
      AB_DRIVER_PORT: String(port),
      AB_DRIVER_TOKEN: token,
      AB_SESSIONS_ROOT: sessionsRoot,
    });
    await rpc(child, { jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    return child;
  }

  it("refuses to start without the driver handoff env", async () => {
    const child = startServer({ AB_SESSIONS_ROOT: sessionsRoot });
    let stderr = "";
    child.stderr!.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    const code: number | null = await new Promise((r) => child.on("exit", (c) => r(c)));
    expect(code).toBe(2);
    expect(stderr).toContain("AB_DRIVER_PORT");
  });

  it("refuses to start without a session root", async () => {
    const child = startServer({ AB_DRIVER_PORT: String(port), AB_DRIVER_TOKEN: token });
    let stderr = "";
    child.stderr!.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    const code: number | null = await new Promise((r) => child.on("exit", (c) => r(c)));
    expect(code).toBe(2);
    expect(stderr).toContain("AB_SESSIONS_ROOT");
  });

  it("announces android_browser with the browser_* tool list", async () => {
    const child = await start();
    const listed = await rpc(child, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (listed.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining([
      "browser_open", "browser_navigate", "browser_status", "browser_back", "browser_forward",
      "browser_get_text", "browser_dom", "browser_click", "browser_type", "browser_eval",
      "browser_screenshot", "browser_cookies", "browser_clear", "browser_close", "browser_persist",
    ]));
    const names = (listed.result as { serverInfo?: { name?: string } }).serverInfo;
    void names;
  });

  it("maps the bot id to the digest session name and forwards driver calls", async () => {
    const child = await start();
    const result = await rpc(child, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "browser_status", arguments: { botId: "bot-alpha" } },
    });
    const text = (result.result as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text).ok).toBe(true);
    const expectedSession = `omb-${createHash("sha256").update("bot-alpha").digest("hex").slice(0, 32)}`;
    expect(driverRequests[0].path).toBe(`/session/${expectedSession}/status`);
    expect(driverRequests[0].auth).toBe(`Bearer ${token}`);
  });

  it("rejects an invalid botId without touching the driver", async () => {
    const child = await start();
    const result = await rpc(child, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "browser_open", arguments: { botId: "../etc", url: "https://example.com" } },
    });
    const text = (result.result as { content: Array<{ text: string }>; isError?: boolean }).content[0].text;
    expect(JSON.parse(text).ok).toBe(false);
    expect(text).toContain("botId");
    expect(driverRequests).toHaveLength(0);
  });

  it("surfaces driver failures as isError tool results with the driver's message", async () => {
    const stub = stubDriver(200, { ok: false, error: "URL blocked by policy: http://127.0.0.1/x" });
    await new Promise<void>((resolve) => {
      const tick = () => (stub.port() > 0 ? resolve() : setTimeout(tick, 5));
      tick();
    });
    driverRequests = stub.requests;
    port = stub.port();
    const child = await start();
    const result = await rpc(child, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "browser_open", arguments: { botId: "b", url: "http://127.0.0.1/x" } },
    });
    const text = (result.result as { content: Array<{ text: string }>; isError?: boolean }).content[0].text;
    expect((result.result as { isError?: boolean }).isError).toBe(true);
    expect(text).toContain("URL blocked by policy");
  });

  it("surfaces transport-level failures (driver down) as isError results", async () => {
    // Point the server at a port with nothing listening.
    const dead = stubDriver();
    await new Promise<void>((resolve) => {
      const tick = () => (dead.port() > 0 ? resolve() : setTimeout(tick, 5));
      tick();
    });
    const deadPort = dead.port();
    servers[servers.length - 1].close();
    const child = startServer({
      AB_DRIVER_PORT: String(deadPort),
      AB_DRIVER_TOKEN: token,
      AB_SESSIONS_ROOT: sessionsRoot,
    });
    await rpc(child, { jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    const result = await rpc(child, {
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "browser_status", arguments: { botId: "b" } },
    }, 70_000);
    const text = (result.result as { content: Array<{ text: string }>; isError?: boolean }).content[0].text;
    expect((result.result as { isError?: boolean }).isError).toBe(true);
    expect(JSON.parse(text).ok).toBe(false);
  }, 80_000);

  it("answers unknown tools with a protocol error", async () => {
    const child = await start();
    const result = await rpc(child, {
      jsonrpc: "2.0", id: 6, method: "tools/call",
      params: { name: "browser_hover", arguments: { botId: "b" } },
    });
    expect((result.error as { code: number }).code).toBe(-32602);
  });

  it("tolerates malformed frames without dying", async () => {
    const child = await start();
    child.stdin!.write("this is not json\n\n");
    const ping = await rpc(child, { jsonrpc: "2.0", id: 7, method: "ping" });
    expect(ping.id).toBe(7);
  });
});

// Unused-import guard for writeFileSync (kept: used by on-device debugging variant).
void writeFileSync;
