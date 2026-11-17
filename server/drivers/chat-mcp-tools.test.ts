import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  ChatToolSessionError,
  capabilityEnableDefinition,
  capabilityRetireDefinition,
  chatToolAvailabilityNotice,
  loadCapabilities,
  retireCapabilities,
  mountChatTools,
  type ChatToolSession,
} from "./chat-mcp-tools.ts";
import { deviceMcpServerScript } from "../../scripts/lib/omb-mcp-server-script.mjs";
import { remoteMcpFixtureScript } from "../../scripts/lib/omb-mcp-remote-fixture.mjs";

const dirs: string[] = [];
const sessions: ChatToolSession[] = [];
const controllers: AbortController[] = [];
const children: ChildProcess[] = [];
const schema = { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false };

function fixture(body = "", toolSchema: Record<string, unknown> = schema) {
  const dir = mkdtempSync(join(tmpdir(), "omb-chat-mcp-"));
  dirs.push(dir);
  const script = join(dir, "fake-mcp.mjs");
  const receipt = join(dir, "receipt.json");
  writeFileSync(script, `#!/usr/bin/env node
    import { writeFileSync } from "node:fs";
    import { spawn } from "node:child_process";
    const receipt = process.env.RECEIPT;
    const schema = ${JSON.stringify(toolSchema)};
    const calls = [];
    const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
    const reply = (message, result) => send({jsonrpc:"2.0",id:message.id,result});
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\\n")) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        const message = JSON.parse(line);
        calls.push(message);
        writeFileSync(receipt, JSON.stringify({pid:process.pid,calls}));
        ${body}
        if (message.method === "initialize") reply(message, {protocolVersion:"2024-11-05",capabilities:{tools:{}}});
        else if (message.method === "tools/list") reply(message, {tools:[{name:"write",description:"Fixture write",inputSchema:schema}]});
        else if (message.method === "tools/call") reply(message, {content:[{type:"text",text:"recorded:" + message.params.arguments.value}]});
      }
    });
  `);
  chmodSync(script, 0o755);
  const controller = new AbortController();
  controllers.push(controller);
  const server = { command: script, args: [], env: { RECEIPT: receipt } };
  return {
    dir, receipt, controller, server,
    read: () => JSON.parse(readFileSync(receipt, "utf8")) as { pid: number; calls: Array<{ method: string; params?: { name?: string; arguments?: unknown } }> },
    async mount() {
      const session = await mountChatTools({ custom: { audit: server } }, controller.signal);
      sessions.push(session);
      return session;
    },
  };
}

// The Phase 5 device fixture, byte-for-byte: the same script the phones run
// (scripts/test-android-mcp.mjs generates it). Executed here through the real
// ChatMcpClient spawn so the on-device transport is exercised in CI before a
// phone is ever attached — any protocol drift fails here first.
function deviceFixture(workspace: string) {
  const dir = mkdtempSync(join(tmpdir(), "omb-chat-mcp-device-"));
  dirs.push(dir);
  const script = join(dir, "omb-mcp-server.cjs");
  writeFileSync(script, deviceMcpServerScript());
  chmodSync(script, 0o755);
  const controller = new AbortController();
  controllers.push(controller);
  const server = { command: script, args: [], env: { AC_WORKSPACE: workspace } };
  return {
    dir, controller, server,
    async mount() {
      const session = await mountChatTools({ custom: { ombmcp: server } }, controller.signal);
      sessions.push(session);
      return session;
    },
  };
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.abort();
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const child of children.splice(0)) child.kill();
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("Chat MCP session", () => {
  it("discovers without executing, preserves schemas and validates before forwarding original arguments", async () => {
    const f = fixture();
    const session = await f.mount();
    expect(session.definitions).toEqual([{ type: "function", function: { name: "audit_write", description: "Fixture write", parameters: schema } }]);
    expect(f.read().calls.map((call) => call.method)).not.toContain("tools/call");
    expect(() => session.validate("audit_write", { value: 42 })).toThrow("input schema");
    await expect(session.execute("not_registered", {}, f.controller.signal)).rejects.toThrow("not advertised");
    expect(f.read().calls.map((call) => call.method)).not.toContain("tools/call");
    await expect(session.execute("audit_write", { value: "receipt" }, f.controller.signal)).resolves.toEqual({ text: "recorded:receipt", ok: true });
    expect(f.read().calls.at(-1)).toMatchObject({ method: "tools/call", params: { name: "write", arguments: { value: "receipt" } } });
    const pid = f.read().pid;
    await session.close();
    expect(alive(pid)).toBe(false);
    await expect(session.execute("audit_write", { value: "again" }, f.controller.signal)).rejects.toThrow("closed");
  });

  it("mounts only supported descriptors and preserves conversations with no tools", async () => {
    const controller = new AbortController();
    controllers.push(controller);
    const session = await mountChatTools({ phone: { command: "must-not-launch", args: [], env: {} } }, controller.signal);
    sessions.push(session);
    expect(session.definitions).toEqual([]);
    await session.close();
  });

  it("paginates deterministically and keeps colliding names within 64 characters", async () => {
    const long = "x".repeat(100);
    const f = fixture(`
      if (message.method === "tools/list") {
        reply(message, message.params.cursor
          ? {tools:[{name:${JSON.stringify(long + "-second")},inputSchema:schema}]}
          : {tools:[{name:${JSON.stringify(long)},inputSchema:schema}],nextCursor:"second"});
        continue;
      }
    `);
    const session = await f.mount();
    const names = session.definitions.map((tool) => tool.function.name);
    expect(new Set(names).size).toBe(2);
    expect(names.every((name) => name.length <= 64)).toBe(true);
    expect(names[1]).toMatch(/_2$/);
    expect(f.read().calls.filter((call) => call.method === "tools/list")).toHaveLength(2);
  });

  it.each([
    ["repeated cursor", `reply(message, {tools:[],nextCursor:"same"});`, "tools/list"],
    ["too many tools", `reply(message, {tools:Array.from({length:257},(_,i)=>({name:"tool"+i,inputSchema:schema}))});`, "tools/list"],
    ["duplicate tool", `reply(message, {tools:[{name:"same",inputSchema:schema},{name:"same",inputSchema:schema}]});`, "schema"],
    ["invalid RPC", `process.stdout.write('{"result":1}\\n');`, "tools/list"],
    ["oversized incomplete frame", `process.stdout.write("x".repeat(2*1024*1024+1));`, "tools/list"],
    ["oversized complete frame", `process.stdout.write("x".repeat(2*1024*1024+1) + "\\n");`, "tools/list"],
    ["too many response frames", `process.stdout.write("\\n".repeat(10001));`, "tools/list"],
    ["oversized tool catalog", `reply(message, {tools:[{name:"write",inputSchema:schema,description:"x".repeat(1024*1024)}]});`, "schema"],
  ])("excludes a server that fails %s and awaits its child cleanup", async (_label, response, stage) => {
    const f = fixture(`if (message.method === "tools/list") { ${response} continue; }`);
    const session = await f.mount();
    expect(session.definitions).toEqual([]);
    expect(session.readiness).toMatchObject({
      toolCount: 0,
      servers: [expect.objectContaining({ server: "audit", ok: false, stage })],
    });
    expect(session.readiness.servers[0].code).toEqual(expect.any(String));
    expect(session.readiness.servers[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(alive(f.read().pid)).toBe(false);
  });

  it("rejects untrusted transport error text without leaking it", async () => {
    const f = fixture(`if (message.method === "tools/call") { send({jsonrpc:"2.0",id:message.id,error:{code:-1,message:"secret-fixture-key"}}); continue; }`);
    const session = await f.mount();
    const result = await session.execute("audit_write", { value: "test" }, f.controller.signal).catch((error: Error) => error);
    expect(result).toBeInstanceOf(ChatToolSessionError);
    expect(String(result)).toContain("MCP request failed");
    expect(String(result)).not.toContain("secret-fixture-key");
    expect(alive(f.read().pid)).toBe(false);
  });

  it("rejects malformed tool content instead of accepting an empty successful result", async () => {
    const f = fixture(`if (message.method === "tools/call") { reply(message,{content:[{type:"text",text:42}]}); continue; }`);
    const session = await f.mount();
    const pending = session.execute("audit_write", {value:"test"}, f.controller.signal);
    await expect(pending).rejects.toBeInstanceOf(ChatToolSessionError);
    await expect(pending).rejects.toThrow("invalid content");
    expect(alive(f.read().pid)).toBe(false);
    expect(() => session.validate("audit_write", {value:"test"})).toThrow(ChatToolSessionError);
  });

  it("keeps schema errors recoverable without dispatching or closing the transport", async () => {
    const f = fixture();
    const session = await f.mount();
    const result = await session.execute("audit_write", {value:42}, f.controller.signal).catch((error: Error) => error);
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBeInstanceOf(ChatToolSessionError);
    expect(f.read().calls.some((call) => call.method === "tools/call")).toBe(false);
    await expect(session.execute("audit_write", {value:"valid"}, f.controller.signal)).resolves.toMatchObject({ok:true});
  });

  it("returns ordinary MCP tool errors while keeping the session available", async () => {
    const f = fixture(`if(message.method === "tools/call" && message.params.arguments.value === "fail") { reply(message,{isError:true,content:[{type:"text",text:"fixture operation refused"}]}); continue; }`);
    const session = await f.mount();
    await expect(session.execute("audit_write", {value:"fail"}, f.controller.signal)).resolves.toEqual({ok:false,text:"fixture operation refused"});
    await expect(session.execute("audit_write", {value:"valid"}, f.controller.signal)).resolves.toMatchObject({ok:true});
  });

  it.each([false, true])("does not claim success for an unsupported result (has text: %s)", async (hasText) => {
    const f = fixture(`if(message.method === "tools/call") { reply(message,{content:[${hasText ? '{type:"text",text:"partial result"},' : ''}{type:"image",data:"fixture",mimeType:"image/png"}]}); continue; }`);
    const session = await f.mount();
    const result = await session.execute("audit_write", {value:"valid"}, f.controller.signal);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("unsupported MCP content");
    expect(result.text).toContain("inspect its state before retrying");
    if (hasText) expect(result.text).toContain("partial result");
  });

  it("keeps ready peers mounted when another server fails startup", async () => {
    const ready = fixture();
    const failed = fixture(`if(message.method === "tools/list") { reply(message,{tools:"invalid"}); continue; }`);
    const session = await mountChatTools({custom:{ready:ready.server,failed:failed.server}},ready.controller.signal);
    sessions.push(session);
    expect(session.definitions.map((tool) => tool.function.name)).toEqual(["ready_write"]);
    expect(session.readiness.servers).toEqual([
      expect.objectContaining({ server: "ready", ok: true, stage: "ready", toolCount: 1 }),
      expect.objectContaining({ server: "failed", ok: false, stage: "tools/list", toolCount: 0 }),
    ]);
    expect(alive(ready.read().pid)).toBe(true);
    expect(alive(failed.read().pid)).toBe(false);
    await expect(session.execute("ready_write", { value: "still-works" }, ready.controller.signal))
      .resolves.toEqual({ text: "recorded:still-works", ok: true });
    await session.close();
    expect(alive(ready.read().pid)).toBe(false);
  });

  it("reports a JSON-RPC error code without leaking the server's error text", async () => {
    const f = fixture(`if (message.method === "tools/list") {
      send({jsonrpc:"2.0",id:message.id,error:{code:-32000,message:"secret-fixture-key"}});
      continue;
    }`);
    const session = await f.mount();
    expect(session.readiness.servers[0]).toMatchObject({
      server: "audit", ok: false, stage: "tools/list", code: "rpc_-32000",
    });
    expect(JSON.stringify(session.readiness)).not.toContain("secret-fixture-key");
    const notice = chatToolAvailabilityNotice(session.readiness);
    expect(notice).toContain("audit");
    expect(notice).toContain("rpc_-32000");
    expect(notice).not.toContain("secret-fixture-key");
  });

  it("drops a server's whole catalog when one of its schemas is invalid", async () => {
    const good = fixture();
    const partial = fixture(`if (message.method === "tools/list") {
      reply(message,{tools:[
        {name:"write",inputSchema:schema},
        {name:"broken",inputSchema:{type:"object",properties:{value:{$ref:"https://example.invalid/private"}}}},
      ]});
      continue;
    }`);
    const session = await mountChatTools(
      { custom: { good: good.server, partial: partial.server } },
      good.controller.signal,
    );
    sessions.push(session);
    expect(session.definitions.map((tool) => tool.function.name)).toEqual(["good_write"]);
    expect(session.readiness.servers).toEqual([
      expect.objectContaining({ server: "good", ok: true, stage: "ready", toolCount: 1 }),
      expect.objectContaining({ server: "partial", ok: false, stage: "schema", toolCount: 0 }),
    ]);
    await expect(session.execute("partial_write", { value: "must-not-exist" }, good.controller.signal))
      .rejects.toThrow("not advertised");
    expect(alive(partial.read().pid)).toBe(false);
  });

  it("proceeds with zero tools and names every unavailable integration", async () => {
    const first = fixture(`if (message.method === "initialize") {
      send({jsonrpc:"2.0",id:message.id,error:{code:-32603,message:"first down"}});
      continue;
    }`);
    const second = fixture(`if (message.method === "tools/list") {
      send({jsonrpc:"2.0",id:message.id,error:{code:-32603,message:"second down"}});
      continue;
    }`);
    const session = await mountChatTools(
      { custom: { first: first.server, second: second.server } },
      first.controller.signal,
    );
    sessions.push(session);
    expect(session.definitions).toEqual([]);
    expect(session.readiness.servers).toEqual([
      expect.objectContaining({ server: "first", ok: false, stage: "initialize", code: "rpc_-32603" }),
      expect.objectContaining({ server: "second", ok: false, stage: "tools/list", code: "rpc_-32603" }),
    ]);
    const notice = chatToolAvailabilityNotice(session.readiness);
    expect(notice).toContain("first (initialize; rpc_-32603)");
    expect(notice).toContain("second (tools/list; rpc_-32603)");
    expect(notice).toContain("not available");
  });

  it("mounts a slow but successful server instead of treating latency as a failure", async () => {
    // The contract this pins: a handshake inside the startup budget is a
    // success no matter how long it took. The old mount code had no notion of
    // a slow-but-fine server — a turn only had "all mounted" or "turn dead".
    const slow = fixture(`if (message.method === "initialize") {
      setTimeout(() => reply(message,{protocolVersion:"2024-11-05",capabilities:{tools:{}}}), 800);
      continue;
    }`);
    const session = await slow.mount();
    expect(session.definitions.map((tool) => tool.function.name)).toEqual(["audit_write"]);
    expect(session.readiness.servers).toEqual([
      expect.objectContaining({ server: "audit", ok: true, stage: "ready", toolCount: 1, timeoutMs: 30_000 }),
    ]);
    expect(session.readiness.servers[0]!.durationMs).toBeGreaterThanOrEqual(700);
  });

  it("mounts independent servers concurrently instead of serially", async () => {
    // Two 800ms handshakes finish in about one budget, not two: a phone that
    // mounts four integrations must not pay their latencies in sequence.
    const delayed = `if (message.method === "initialize") {
      setTimeout(() => reply(message,{protocolVersion:"2024-11-05",capabilities:{tools:{}}}), 800);
      continue;
    }`;
    const one = fixture(delayed);
    const two = fixture(delayed);
    const started = Date.now();
    const session = await mountChatTools({ custom: { one: one.server, two: two.server } }, one.controller.signal);
    sessions.push(session);
    const elapsed = Date.now() - started;
    expect(session.definitions.map((tool) => tool.function.name)).toEqual(["one_write", "two_write"]);
    expect(session.readiness.servers.map((server) => server.ok)).toEqual([true, true]);
    expect(elapsed).toBeLessThan(1500);
  });

  it("advertises only the selected server and loads the rest on demand", async () => {
    const one = fixture();
    const two = fixture();
    const session = await mountChatTools(
      { custom: { one: one.server, two: two.server } },
      one.controller.signal,
      { expose: ["one"] },
    );
    sessions.push(session);
    expect(session.definitions.map((tool) => tool.function.name)).toEqual(["one_write"]);
    expect(session.readiness.servers.map((server) => [server.server, server.ok])).toEqual([["one", true], ["two", true]]);
    expect(session.exposure).toEqual({ advertised: ["one"], deferred: ["two"] });
    expect(() => session.validate("two_write", { value: "x" })).toThrow(/not advertised/);

    const added = session.enableServers(["two"]);
    expect(added.map((definition) => definition.function.name)).toEqual(["two_write"]);
    expect(session.exposure).toEqual({ advertised: ["one", "two"], deferred: [] });
    await expect(session.execute("two_write", { value: "now" }, two.controller.signal))
      .resolves.toEqual({ text: "recorded:now", ok: true });
    // Enabling a server cannot advertise a name that was never verified.
    expect(() => session.validate("three_write", {})).toThrow(/not advertised/);
  });

  it("loads a deferred capability through the shared helper", async () => {
    const one = fixture();
    const two = fixture();
    const session = await mountChatTools(
      { custom: { one: one.server, two: two.server } },
      one.controller.signal,
      { expose: ["one"] },
    );
    sessions.push(session);
    const combined = session.definitions.concat([capabilityEnableDefinition(session.exposure.deferred)]);
    expect(combined.map((tool) => tool.function.name)).toEqual(["one_write", "capability_enable"]);

    const loaded = loadCapabilities(session, ["two"], combined);
    expect(loaded.ok).toBe(true);
    expect(loaded.text).toContain("two");
    expect(combined.map((tool) => tool.function.name)).toEqual(["one_write", "capability_enable", "two_write"]);

    const missing = loadCapabilities(session, ["nope"], combined);
    expect(missing.ok).toBe(false);
    expect(missing.text).toContain("Not loaded yet");
  });

  it("retires standard capabilities to conserve context and allows re-enabling them later", async () => {
    const browser = fixture();
    const customTool = fixture();
    const session = await mountChatTools(
      {
        custom: {
          browser: browser.server,
          my_custom_mcp: customTool.server,
        },
      },
      browser.controller.signal,
    );
    sessions.push(session);

    // Initial state: both are advertised
    expect(session.exposure.advertised).toEqual(["browser", "my_custom_mcp"]);
    const retireDef = capabilityRetireDefinition(session.exposure.advertised);
    expect(retireDef.function.name).toBe("capability_retire");
    const activeDefs = [...session.definitions];

    // Attempting to retire a custom MCP server is blocked (invariant: custom user tools are never retired)
    const customRetire = retireCapabilities(session, ["my_custom_mcp"], activeDefs);
    expect(customRetire.ok).toBe(false);
    expect(session.exposure.advertised).toContain("my_custom_mcp");

    // Retiring a known standard surface (browser) succeeds
    const retireResult = retireCapabilities(session, ["browser"], activeDefs);
    expect(retireResult.ok).toBe(true);
    expect(session.exposure.advertised).toEqual(["my_custom_mcp"]);
    expect(session.exposure.deferred).toEqual(["browser"]);
    expect(activeDefs.map((d) => d.function.name)).toEqual(["my_custom_mcp_write"]);

    // Re-enabling browser capability restores it immediately without remounting
    const reloaded = loadCapabilities(session, ["browser"], activeDefs);
    expect(reloaded.ok).toBe(true);
    expect(session.exposure.advertised).toEqual(["my_custom_mcp", "browser"]);
    expect(session.exposure.deferred).toEqual([]);
    expect(activeDefs.map((d) => d.function.name)).toContain("browser_write");
  });

  it("returns declared tool errors and bounds aggregate text without splitting UTF-8", async () => {
    const f = fixture(`if (message.method === "tools/call") { reply(message,{isError:true,content:[{type:"text",text:"á".repeat(30000)},{type:"image",data:"ignored",mimeType:"image/png"}],structuredContent:{status:"failed"}}); continue; }`);
    const session = await f.mount();
    const result = await session.execute("audit_write", { value: "test" }, f.controller.signal);
    expect(result.ok).toBe(false);
    expect(Buffer.byteLength(result.text)).toBeLessThan(52_000);
    expect(result.text).toContain("truncated");
    expect(result.text).not.toContain("�");
  });

  it.each(["initialize", "tools/list", "tools/call"])("cancels %s and awaits its owned process tree", async (method) => {
    const f = fixture(`if (message.method === ${JSON.stringify(method)}) {
      const helper = spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
      helper.on("spawn",()=>writeFileSync(receipt,JSON.stringify({pid:process.pid,helper:helper.pid,calls})));
      continue;
    }`);
    const pending = method === "tools/call"
      ? f.mount().then((session) => session.execute("audit_write", { value: "test" }, f.controller.signal))
      : f.mount();
    const rejected = expect(pending).rejects.toThrow(/cancelled|closed/);
    let receipt!: { pid: number; helper: number };
    await vi.waitFor(() => {
      receipt = JSON.parse(readFileSync(f.receipt, "utf8"));
      expect(receipt.helper).toBeGreaterThan(0);
    });
    f.controller.abort();
    await rejected;
    expect(alive(receipt.pid)).toBe(false);
    expect(alive(receipt.helper)).toBe(false);
  });
});

describe("Chat MCP schema validation", () => {
  it.each([
    { type: "object", properties: { value: { type: "string", minLength: 2 } }, required: ["value"] },
    { type: "object", properties: { value: { type: "string", enum: ["a"], minLength: 2 } }, required: ["value"] },
    { type: "object", properties: { value: { type: "array", minItems: 2 } }, required: ["value"] },
    { type: "object", properties: { value: { type: "string", default: "fallback" } }, required: ["value"] },
    { type: "object", required: ["value"] },
    { type: "object", properties: { value: { type: "array", items: {type:"string"}, uniqueItems: true } }, required: ["value"] },
  ])("enforces original constraints without defaults or coercion %#", async (toolSchema) => {
    const f = fixture("", toolSchema);
    const session = await f.mount();
    const invalid = "enum" in (toolSchema.properties?.value ?? {}) ? {value:"a"}
      : "uniqueItems" in (toolSchema.properties?.value ?? {}) ? {value:["a","a"]}
        : toolSchema.properties?.value.type === "array" ? {value:[]}
          : "minLength" in (toolSchema.properties?.value ?? {}) ? {value:"😀"} : {};
    expect(() => session.validate("audit_write", invalid)).toThrow("input schema");
    expect(f.read().calls.some((call) => call.method === "tools/call")).toBe(false);
    expect(session.definitions[0].function.parameters).toEqual(toolSchema);
  });

  it("retains composition and draft 2020-12 constraints", async () => {
    const toolSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
      properties: { value: {type:"array",items:{type:"number"},contains:{const:2},minContains:1} },
      required: ["value"], additionalProperties: false,
    };
    const f = fixture("", toolSchema);
    const session = await f.mount();
    expect(() => session.validate("audit_write", {value:[1]})).toThrow("input schema");
    expect(() => session.validate("audit_write", {value:[2]})).not.toThrow();
  });

  it.each([
    ["email", "user@example.com", "invalid"],
    ["uri", "https://example.com/path", "not a uri"],
    ["date-time", "2026-09-13T12:00:00Z", "2026-13-41"],
  ])("enforces the standard %s format", async (format, valid, invalid) => {
    const f = fixture("", {type:"object",properties:{value:{type:"string",format}},required:["value"]});
    const session = await f.mount();
    expect(() => session.validate("audit_write", {value:valid})).not.toThrow();
    expect(() => session.validate("audit_write", {value:invalid})).toThrow("input schema");
  });

  it.each([
    { type: "object", properties: {value:{type:"string",format:"unregistered-format"}} },
    { type: "object", properties: {value:{$ref:"https://example.invalid/private-schema"}} },
    { type: "object", properties: {value:{type:"string",unrecognizedAssertion: true}} },
  ])("excludes a server whose schema it cannot validate instead of weakening it %#", async (toolSchema) => {
    const f = fixture("", toolSchema);
    const session = await f.mount();
    expect(session.definitions).toEqual([]);
    expect(session.readiness.servers[0]).toMatchObject({
      server: "audit", ok: false, stage: "schema", code: "schema_invalid",
    });
    expect(session.readiness.servers[0].error).toContain("schema could not be validated");
    expect(alive(f.read().pid)).toBe(false);
  });

  // Lifecycle: the mount path is per-turn by design (the driver remounts for
  // every send), so "restart" here means: after a server crash mid-session,
  // a freshly mounted session against the same config must work, and the
  // crashed session must not have leaked its process.
  it("recovers with a fresh mount after a server crash and leaves no orphaned process", async () => {
    const f = fixture("");
    const session = await f.mount();
    expect(session.definitions.map((t) => t.function.name)).toEqual(["audit_write"]);
    const firstPid = f.read().pid;
    // Crash the server exactly as a misbehaving integration would.
    process.kill(firstPid, "SIGKILL");
    await expect(session.execute("audit_write", { value: "x" }, new AbortController().signal))
      .rejects.toThrow(/exited|MCP/);
    await expect(session.close()).resolves.toBeUndefined();
    expect(alive(firstPid)).toBe(false);
    // Recovery: a new mount from the same server config gets a new process
    // and completes a full discovery + execution round.
    const second = await f.mount();
    const secondPid = f.read().pid;
    expect(secondPid).not.toBe(firstPid);
    const result = await second.execute("audit_write", { value: "again" }, new AbortController().signal);
    expect(result.ok).toBe(true);
    await expect(second.close()).resolves.toBeUndefined();
    expect(alive(secondPid)).toBe(false);
  });

  it("excludes a server that emits a malformed JSON frame instead of accepting it", async () => {
    // Emit garbage on stdout immediately after the first inbound frame —
    // the strict parser must fail that server rather than skip a corrupt
    // line, and the spawned process must not survive the failure.
    const f = fixture("if (calls.length === 1) process.stdout.write('@@not-json@@\\n');");
    const session = await f.mount();
    expect(session.definitions).toEqual([]);
    expect(session.readiness.servers[0]).toMatchObject({
      server: "audit", ok: false, stage: "initialize", code: "protocol_error",
    });
    expect(session.readiness.servers[0].error).toMatch(/invalid JSON|invalid RPC/);
    expect(alive(f.read().pid)).toBe(false);
  });

  // ── the Phase 5 device fixture, run through the identical spawn the phones use ──
  describe("device MCP fixture (scripts/lib/omb-mcp-server-script.mjs)", () => {
    it("discovers ombmcp tools, executes writes inside the workspace, and reads them back", async () => {
      const ws = mkdtempSync(join(tmpdir(), "omb-mcp-ws-"));
      dirs.push(ws);
      const f = deviceFixture(ws);
      const session = await f.mount();
      // Dynamic check: the names the device driver cues are derived from the
      // mount, not hardcoded assumptions about them.
      const names = session.definitions.map((t) => t.function.name);
      expect(names).toEqual(["ombmcp_ombmcp_write", "ombmcp_ombmcp_read"]);
      const written = await session.execute("ombmcp_ombmcp_write", { path: "nested/mcp-proof.txt", text: "device fixture payload" }, new AbortController().signal);
      expect(written.ok).toBe(true);
      expect(written.text).toBe("MCP wrote nested/mcp-proof.txt");
      expect(readFileSync(join(ws, "nested/mcp-proof.txt"), "utf8")).toBe("device fixture payload");
      const read = await session.execute("ombmcp_ombmcp_read", { path: "nested/mcp-proof.txt" }, new AbortController().signal);
      expect(read.ok).toBe(true);
      expect(read.text).toBe("device fixture payload");
      await expect(session.close()).resolves.toBeUndefined();
    });

    it.each([
      { path: "../escape.txt", label: "a ../ traversal" },
      { path: "/etc/passwd", label: "an absolute path" },
      { path: "a/../../b.txt", label: "a nested traversal" },
    ])("refuses $label with an isError result and writes nothing", async ({ path }) => {
      const ws = mkdtempSync(join(tmpdir(), "omb-mcp-ws-"));
      dirs.push(ws);
      const f = deviceFixture(ws);
      const session = await f.mount();
      const result = await session.execute("ombmcp_ombmcp_write", { path, text: "nope" }, new AbortController().signal);
      expect(result.ok).toBe(false);
      expect(result.text).toContain("escapes the workspace");
      await expect(session.close()).resolves.toBeUndefined();
      expect(existsSync(join(ws, "escape.txt"))).toBe(false);
    });
  });

  // ── the Phase 5 REMOTE device fixture (scripts/lib/omb-mcp-remote-fixture.mjs):
  // spawned standalone exactly as the phones run it, mounted through the same
  // url-transport client — CI and device share one fixture implementation ──
  describe.each(["http", "sse"] as const)("remote MCP device fixture (%s transport)", (transport) => {
    function remoteDeviceFixture(workspace: string) {
      const dir = mkdtempSync(join(tmpdir(), "omb-mcp-remote-"));
      dirs.push(dir);
      const script = join(dir, "omb-mcp-remote-fixture.mjs");
      writeFileSync(script, remoteMcpFixtureScript(18_791, transport, "mcp-remote-effect.txt"));
      const controller = new AbortController();
      controllers.push(controller);
      const child = spawn(process.execPath, [script], {
        env: { ...process.env, AC_WORKSPACE: workspace }, stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      const url = transport === "sse" ? "http://127.0.0.1:18791/mcp-sse" : "http://127.0.0.1:18791/mcp";
      return {
        controller, server: { type: transport, url, headers: {} } as const,
        async up() {
          for (let i = 0; i < 30; i += 1) {
            try { await fetch(url, { signal: AbortSignal.timeout(500) }); return true; } catch {
              await new Promise((r) => setTimeout(r, 100));
            }
          }
          return false;
        },
      };
    }

    it("discovers the write tool and executes it inside the workspace", async () => {
      const ws = mkdtempSync(join(tmpdir(), "omb-mcp-rws-"));
      dirs.push(ws);
      const f = remoteDeviceFixture(ws);
      expect(await f.up()).toBe(true);
      const session = await mountChatTools({ custom: { ombremote: f.server } }, f.controller.signal);
      sessions.push(session);
      const names = session.definitions.map((t) => t.function.name);
      expect(names).toEqual(["ombremote_write"]);
      const written = await session.execute("ombremote_write", { name: "receipt", value: "done" }, new AbortController().signal);
      expect(written.ok).toBe(true);
      expect(written.text).toBe("Stored receipt=done");
      expect(readFileSync(join(ws, "mcp-remote-effect.txt"), "utf8")).toBe("receipt=done");
      await expect(session.close()).resolves.toBeUndefined();
    });
  });
});
