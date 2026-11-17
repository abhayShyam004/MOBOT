// Per-turn MCP transport for the shared Chat Completions runtime. Approval is
// owned by the caller; only registered, schema-validated calls reach this file.
import { Ajv, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import type { SendTurnInput } from "../contracts.ts";
import { mcpChildEnvironment } from "../mcp-env.ts";
import { checkToolPermission, loadDiskPermissions } from "../permission-policy.ts";
import { RemoteMcpClient } from "../mcp-http.ts";
import { killCliTree, spawnCli } from "../procs.ts";
import { redactSecretsInText } from "../redact.ts";
import type { ToolReadinessServer } from "../../shared/runtime-events.ts";
import { KNOWN_SURFACES } from "../tool-exposure.ts";
import { logHopTiming } from "../timing-log.ts";

export interface ChatToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ChatToolResult { text: string; ok: boolean }
/** The transport cannot safely continue this turn. A dispatched operation may
 * already have taken effect, so callers must not retry it through a new round. */
export class ChatToolSessionError extends Error {}
export type ChatToolMountStage = "startup" | "initialize" | "tools/list" | "schema";
export type ChatToolServerReadiness = ToolReadinessServer;
export interface ChatToolReadiness {
  /** One row per configured server, in configuration order, whether it
   * succeeded or not. A failed optional integration is reported here and
   * excluded from [ChatToolSession.definitions]; it no longer stops the turn. */
  servers: ChatToolServerReadiness[];
  toolCount: number;
}
export interface ChatToolSession {
  /** Tools advertised on the first provider request. Only servers the turn's
   * exposure decision selected (or every ready server when it selected all). */
  definitions: ChatToolDefinition[];
  /** Which verified servers are advertised now, and which are mounted but
   * deferred. Deferred servers are loadable with `enableServers`. */
  exposure: { advertised: string[]; deferred: string[] };
  /** Advertise a verified-but-deferred server's tools. Returns the definitions
   * that were not already advertised; never mounts or trusts anything new. */
  enableServers(names: readonly string[]): ChatToolDefinition[];
  /** Retire standard integration tools that are no longer needed for the current
   * task stage, moving them to deferred so they can be re-enabled if needed.
   * Invariant: Never retires custom user MCP servers. */
  retireServers(names: readonly string[]): { retiredServers: string[]; retiredToolNames: string[] };
  /** This turn's mount outcome, for the driver's `tool.readiness` event and
   * the model's availability notice. */
  readiness: ChatToolReadiness;
  validate(name: string, args: unknown): void;
  execute(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ChatToolResult>;
  close(): Promise<void>;
}

type StdioServer = { command: string; args: string[]; env: Record<string, string> };
type RemoteServer = { type: "http" | "sse"; url: string; headers: Record<string, string> };
type Server = StdioServer | RemoteServer;
const STARTUP_MS = 30_000;
const CALL_MS = 10 * 60_000;
const FRAME_BYTES = 2 * 1024 * 1024;
const OUTPUT_BYTES = 50 * 1024;
const IMAGE_OUTPUT_BYTES = 16 * 1024 * 1024;
const TOOL_COUNT = 256;
const MAX_PAGES = 100;
const SCHEMA_BYTES = 64 * 1024;
const CATALOG_BYTES = 1024 * 1024;
const MAX_FRAMES = 10_000;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function abortError(): Error { return coded(new Error("MCP operation cancelled"), "cancelled"); }
function aborted(): Error { return abortError(); }

/** Attach a stable diagnostic code without changing the message a person or
 * an existing test already reads. The code is harness-owned; untrusted server
 * text is never used as a code. */
function coded<T extends Error>(error: T, code: string): T {
  (error as T & { code?: string }).code = code;
  return error;
}

function boundedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message
    : typeof error === "string" ? error : "MCP server failed to start";
  const printable = Array.from(redactSecretsInText(message), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  const safe = printable.replace(/\s+/g, " ").trim();
  return safe.slice(0, 200) || "MCP server failed to start";
}

/** A JSON-RPC error's numeric code is safe to keep: it is protocol metadata,
 * not server prose. The error message is deliberately discarded because a
 * remote integration can put a credential or an HTML body inside it. */
function rpcError(error: unknown): Error {
  const code = object(error) && typeof error.code === "number" && Number.isFinite(error.code)
    ? `rpc_${error.code}`
    : object(error) && typeof error.code === "string" && /^[-\w.]{1,40}$/.test(error.code)
      ? `rpc_${error.code}`
      : "rpc_error";
  return coded(new Error("MCP request failed; inspect the configured integration"), code);
}

/** Classify a mount failure for the readiness row. Explicit transport codes
 * win; the message fallbacks only cover errors raised by dependencies
 * (RemoteMcpClient, the child-process helpers) that do not carry one. */
function mountFailureCode(error: unknown): string {
  if (object(error) && typeof error.code === "string" && error.code) return error.code.slice(0, 64);
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel/i.test(message)) return "cancelled";
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (/could not start|spawn/i.test(message)) return "spawn_failed";
  if (/exited/i.test(message)) return "exited";
  if (/invalid JSON|invalid RPC|no result|invalid response ID|invalid envelope/i.test(message)) return "protocol_error";
  if (/frame limit|frame count|pagination|tool count|catalog|64KB|1MB/i.test(message)) return "limit_exceeded";
  if (/schema/i.test(message)) return "schema_invalid";
  if (/initialize|initialization/i.test(message)) return "initialize_failed";
  if (/tool name|tools\/list|advertised/i.test(message)) return "tools_invalid";
  if (/closed/i.test(message)) return "closed";
  return "mount_failed";
}

/** The one surface mountChatTools needs from either transport. `onStage` is
 * called immediately before each handshake phase so a failure can be named
 * without trusting text from the server. */
interface ChatClient {
  tools(signal: AbortSignal, onStage: (stage: ChatToolMountStage) => void): Promise<unknown[]>;
  call(method: string, params: unknown, signal: AbortSignal, timeout: number): Promise<unknown>;
  close(): Promise<void>;
}

/** The tools/list pagination rules (page cap, cursor validation, tool-count
 * ceiling) shared by both transports; each client does its own handshake. */
async function paginateTools(
  call: ChatClient["call"], signal: AbortSignal, deadline: number,
): Promise<unknown[]> {
  const remaining = () => {
    if (Date.now() >= deadline) throw coded(new Error("MCP startup timed out"), "timeout");
    return deadline - Date.now();
  };
  const tools: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await call("tools/list", cursor ? { cursor } : {}, signal, remaining());
    if (!object(result) || !Array.isArray(result.tools)) throw coded(new Error("MCP tools/list returned an invalid result"), "tools_invalid");
    tools.push(...result.tools);
    if (tools.length > TOOL_COUNT) throw coded(new Error("MCP tool count exceeds the 256-tool limit"), "limit_exceeded");
    if (result.nextCursor === undefined) return tools;
    if (typeof result.nextCursor !== "string" || !result.nextCursor || cursors.has(result.nextCursor)) throw coded(new Error("MCP tools/list returned an invalid pagination cursor"), "paginate_error");
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw coded(new Error("MCP tools/list exceeded the pagination limit"), "limit_exceeded");
}

class ChatMcpClient implements ChatClient {
  private child: ReturnType<typeof spawnCli>;
  private buffer = "";
  private nextId = 1;
  private frames = 0;
  private closed = false;
  private closing?: Promise<void>;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(server: Server) {
    // Only the stdio shape reaches this constructor; the remote one has its
    // own class below. Narrowing keeps the strict union honest.
    if (!("command" in server)) throw new Error("Remote MCP servers do not run as local commands");
    const { command, args, env } = server;
    try {
      // mcpChildEnvironment strips the harness's credential env (provider
      // keys etc.) before the server's own env block is applied — a custom
      // MCP server configures itself, it never inherits foreign secrets.
      this.child = spawnCli(command, args, {
        stdio: ["pipe", "pipe", "pipe"], env: mcpChildEnvironment(env),
      });
    } catch { throw coded(new Error("MCP server could not start; check its command and installation"), "spawn_failed"); }
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    // Stderr may contain credentials; drain without recording or returning it.
    this.child.stderr.on("data", () => {});
    this.child.on("error", () => this.fail(coded(new Error("MCP server could not start; check its command and installation"), "spawn_failed")));
    this.child.on("exit", () => this.fail(coded(new Error("MCP server exited before the session closed"), "exited")));
    this.child.stdin.on("error", () => this.fail(coded(new Error("MCP server input closed"), "closed")));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    // Capture rejection here; mount/execute finally await close and surface it.
    void this.close().catch(() => {});
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const entry of this.pending.values()) entry.reject(coded(new Error("MCP session closed"), "closed"));
    this.pending.clear();
    this.buffer = "";
    this.closing = killCliTree(this.child, 500).then((stopped) => {
      if (!stopped) throw coded(new Error("MCP server shutdown could not be confirmed; execution outcome may be uncertain"), "shutdown_unconfirmed");
    });
    return this.closing;
  }

  private write(frame: unknown): void {
    if (this.closed || !this.child.stdin.writable || this.child.stdin.destroyed) throw coded(new Error("MCP session closed"), "closed");
    const encoded = JSON.stringify(frame) + "\n";
    if (Buffer.byteLength(encoded) > FRAME_BYTES) throw coded(new Error("MCP request exceeds the frame limit"), "limit_exceeded");
    this.child.stdin.write(encoded);
  }

  private onData(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (++this.frames > MAX_FRAMES) return this.fail(coded(new Error("MCP session exceeded the response frame count limit"), "limit_exceeded"));
      if (Buffer.byteLength(line) > FRAME_BYTES) return this.fail(coded(new Error("MCP response exceeds the frame limit"), "limit_exceeded"));
      if (!line.trim()) continue;
      let message: unknown;
      try { message = JSON.parse(line); }
      catch { return this.fail(coded(new Error("MCP server returned invalid JSON"), "protocol_error")); }
      if (!object(message) || message.jsonrpc !== "2.0") return this.fail(coded(new Error("MCP server returned an invalid RPC envelope"), "protocol_error"));
      if (typeof message.method === "string") {
        if (typeof message.id === "number" || typeof message.id === "string") {
          try { this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client method not supported" } }); }
          catch { return this.fail(coded(new Error("MCP server input closed"), "closed")); }
        }
        continue;
      }
      if (typeof message.id !== "number") return this.fail(coded(new Error("MCP server returned an invalid response ID"), "protocol_error"));
      const entry = this.pending.get(message.id);
      if (!entry) continue;
      this.pending.delete(message.id);
      if ("error" in message) entry.reject(rpcError(message.error));
      else if (!("result" in message)) entry.reject(coded(new Error("MCP response has no result"), "protocol_error"));
      else entry.resolve(message.result);
    }
    if (Buffer.byteLength(this.buffer) > FRAME_BYTES) this.fail(coded(new Error("MCP response exceeds the frame limit"), "limit_exceeded"));
  }

  async call(method: string, params: unknown, signal: AbortSignal, timeout: number): Promise<unknown> {
    if (signal.aborted) { await this.close(); throw aborted(); }
    if (this.closed) throw new Error("MCP session closed");
    const id = this.nextId++;
    try {
      return await new Promise((resolve, reject) => {
        const finish = (error?: Error, value?: unknown) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          this.pending.delete(id);
          if (error) reject(error); else resolve(value);
        };
        const cancel = () => {
          try { this.write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "Cancelled" } }); }
          catch { /* cleanup owns transport failure */ }
          finish(aborted());
        };
        const timer = setTimeout(() => finish(coded(new Error("MCP request timed out; execution outcome may be uncertain"), "timeout")), timeout);
        timer.unref();
        signal.addEventListener("abort", cancel, { once: true });
        this.pending.set(id, { resolve: (value) => finish(undefined, value), reject: (error) => finish(error) });
        try { this.write({ jsonrpc: "2.0", id, method, params }); }
        catch { finish(coded(new Error("MCP request could not be sent"), "write_failed")); }
      });
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async tools(signal: AbortSignal, onStage: (stage: ChatToolMountStage) => void): Promise<unknown[]> {
    const deadline = Date.now() + STARTUP_MS;
    onStage("initialize");
    const initialized = await this.call("initialize", {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "openmausbot-chat", version: "1" },
    }, signal, deadline - Date.now());
    if (!object(initialized)) throw coded(new Error("MCP initialization returned an invalid result"), "initialize_failed");
    if (signal.aborted) throw aborted();
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
    onStage("tools/list");
    return paginateTools((method, params, inner, timeout) => this.call(method, params, inner, timeout), signal, deadline);
  }
}

// A schema is a contract, so conversion that drops constraints is not safe.
// Ajv validates the same schema sent to the provider without coercing values,
// applying defaults, removing fields, or fetching external references.
const validatorOptions = {
  strict: true, allErrors: false, coerceTypes: false, useDefaults: false,
  removeAdditional: false, validateFormats: true, ownProperties: true, logger: false as const,
  // These are style diagnostics, not unsupported validation keywords. Valid
  // schemas may require undeclared names, use untyped composition branches,
  // or describe an open tuple. Ajv still enforces every constraint.
  strictRequired: false, strictTypes: false, strictTuples: false,
};
function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  const dialect = schema.$schema;
  if (dialect !== undefined && dialect !== "http://json-schema.org/draft-07/schema#" && dialect !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error("MCP tool schema uses an unsupported dialect; use JSON Schema draft-07 or 2020-12");
  }
  // One compiler per schema also prevents external IDs from resolving against
  // unrelated tools or retaining schemas after the turn has closed.
  const compiler = dialect === "https://json-schema.org/draft/2020-12/schema"
    ? new Ajv2020(validatorOptions) : new Ajv(validatorOptions);
  // ajv-formats is CommonJS and exports the plugin as both module.exports
  // and .default; the latter also matches its NodeNext declaration.
  formats.default(compiler);
  try { return compiler.compile(schema); }
  catch { throw new Error("MCP tool schema could not be validated; check its constraints, formats, and references"); }
}

function boundedText(value: string, limit: number = OUTPUT_BYTES): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= limit) return value;
  let end = limit;
  while ((bytes[end] & 0xc0) === 0x80) end -= 1;
  if (limit === OUTPUT_BYTES) {
    return `${bytes.subarray(0, end).toString()}\n[MCP result truncated at 50KB; request less output.]`;
  }
  const limitKb = Math.round(limit / 1024);
  const label = limitKb >= 1024 ? `${Math.round(limitKb / 1024)}MB` : `${limitKb}KB`;
  return `${bytes.subarray(0, end).toString()}\n[MCP result truncated at ${label}; request less output.]`;
}

/** Per-turn client for a remote ({type,url,headers}) MCP server. Delegates
 * the wire to the same RemoteMcpClient the connection probe and desktop CLI
 * paths use (streamable HTTP with sessions, or legacy SSE), and follows the
 * identical per-call timeout/abort rules as the stdio client above.
 * Nothing here trusts the server: results face the same validation and
 * bounded-text rules, so a remote server can return exactly as much into a
 * conversation as a local one. */
class RemoteChatMcpClient implements ChatClient {
  private readonly inner: RemoteMcpClient;
  private closed = false;

  constructor(server: RemoteServer) {
    this.inner = new RemoteMcpClient(server);
  }

  async tools(signal: AbortSignal, onStage: (stage: ChatToolMountStage) => void): Promise<unknown[]> {
    const budget = (ms: number) => AbortSignal.any([signal, AbortSignal.timeout(Math.max(ms, 1))]);
    onStage("initialize");
    await this.inner.initialize("openmausbot-chat", budget(STARTUP_MS));
    // paginateTools' deadline arithmetic is shared with the stdio client; the
    // per-request timeout is applied here where the request is actually made.
    const deadline = Date.now() + STARTUP_MS;
    onStage("tools/list");
    return paginateTools(
      (method, params, _inner, timeout) => this.inner.request(method, params, budget(Math.min(timeout, deadline - Date.now() + STARTUP_MS))),
      signal, deadline,
    );
  }

  async call(method: string, params: unknown, signal: AbortSignal, timeout: number): Promise<unknown> {
    if (this.closed || signal.aborted) { await this.close(); throw aborted(); }
    return this.inner.request(method, params, AbortSignal.any([signal, AbortSignal.timeout(timeout)]));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.inner.close().catch(() => {});
  }
}

export async function mountChatTools(
  integrations: SendTurnInput["integrations"],
  signal: AbortSignal,
  options: { expose?: readonly string[] } = {},
): Promise<ChatToolSession> {
  const servers: Array<[string, Server]> = [];
  if (integrations?.agents) servers.push(["agents", integrations.agents]);
  if (integrations?.composio) servers.push(["composio", integrations.composio]);
  // Both transports mount here: a local command runs as a child of this
  // process, a remote entry is reached over streamable HTTP or SSE — the
  // phone talks to the endpoint directly, exactly like a desktop host would.
  for (const [name, server] of Object.entries(integrations?.custom ?? {})) {
    servers.push([name, server]);
  }
  if (servers.length > 32) throw new Error("MCP server count exceeds the 32-server limit");
  const clients: ChatClient[] = [];
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    signal.removeEventListener("abort", cancel);
    closing = Promise.allSettled(clients.map((client) => client.close())).then((results) => {
      if (results.some((result) => result.status === "rejected")) throw new ChatToolSessionError("MCP server shutdown could not be confirmed; execution outcome may be uncertain");
    });
    return closing;
  };
  const cancel = () => { void close().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const exposeSet = options.expose === undefined ? null : new Set(options.expose);
  const serversToMount = exposeSet
    ? servers.filter(([name]) => exposeSet.has(name) || !KNOWN_SURFACES.has(name))
    : servers;
  const deferredServerNames = exposeSet
    ? servers.filter(([name]) => !exposeSet.has(name) && KNOWN_SURFACES.has(name)).map(([name]) => name)
    : [];

  const definitions: ChatToolDefinition[] = [];
  const registered = new Map<string, { client: ChatClient; name: string; schema: ValidateFunction; server: string; description?: string }>();
  const reports: ChatToolServerReadiness[] = [];
  for (const name of deferredServerNames) {
    reports.push({
      server: name,
      ok: true,
      stage: "ready",
      durationMs: 0,
      timeoutMs: STARTUP_MS,
      toolCount: 0,
    });
  }
  try {
    if (signal.aborted) throw aborted();
    // Start independent servers concurrently; consume results in config order
    // so names and collision suffixes remain stable across startup timings.
    // One server's handshake failure is its own row, not the turn's death.
    const mounts = await Promise.all(serversToMount.map(async ([server, descriptor]) => {
      const startedAt = Date.now();
      let stage: ChatToolMountStage = "startup";
      let client: ChatClient | undefined;
      try {
        if (signal.aborted || closed) throw aborted();
        // "command" marks a local stdio server; a url-bearing entry is remote.
        client = "command" in descriptor
          ? new ChatMcpClient(descriptor)
          : new RemoteChatMcpClient(descriptor);
        clients.push(client);
        const tools = await client.tools(signal, (next) => { stage = next; });
        if (signal.aborted || closed) throw aborted();
        const durationMs = Date.now() - startedAt;
        logHopTiming("MCP_MOUNT_SERVER", durationMs, { server, ok: true, toolCount: tools.length });
        return { ok: true as const, server, client, tools, startedAt };
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        logHopTiming("MCP_MOUNT_SERVER", durationMs, { server, ok: false, stage, error: boundedFailure(error) });
        // A server that never became ready owns no dispatched operation. Close
        // it here and stop tracking it: a later shutdown failure must not turn
        // an unrelated tool call into "outcome may be uncertain".
        if (client) {
          await client.close().catch(() => {});
          const index = clients.indexOf(client);
          if (index >= 0) clients.splice(index, 1);
        }
        return {
          ok: false as const, server, stage, startedAt,
          code: mountFailureCode(error), error: boundedFailure(error),
        };
      }
    }));
    if (signal.aborted || closed) throw aborted();
    for (const mount of mounts) {
      if (!mount.ok) {
        reports.push({
          server: mount.server, ok: false, stage: mount.stage,
          durationMs: Date.now() - mount.startedAt, timeoutMs: STARTUP_MS,
          toolCount: 0, code: mount.code, error: mount.error,
        });
        continue;
      }
      try {
        // Stage a whole server before touching the shared catalog. A server
        // with one invalid tool is excluded completely: half its tools would
        // be a surface the user never configured.
        const prepared: Array<{ name: string; original: string; schema: ValidateFunction; definition: ChatToolDefinition }> = [];
        const batchNames = new Set<string>();
        const originalNames = new Set<string>();
        for (const tool of mount.tools) {
          if (!object(tool) || typeof tool.name !== "string" || !tool.name.trim() || originalNames.has(tool.name)) throw coded(new Error("MCP server advertised an invalid or duplicate tool name"), "tools_invalid");
          originalNames.add(tool.name);
          if (definitions.length + prepared.length >= TOOL_COUNT) throw coded(new Error("MCP tool count exceeds the 256-tool limit"), "limit_exceeded");
          if (!object(tool.inputSchema) || tool.inputSchema.type !== "object") throw coded(new Error("MCP tools require an object input schema"), "schema_invalid");
          if (Buffer.byteLength(JSON.stringify(tool.inputSchema)) > SCHEMA_BYTES) throw coded(new Error("MCP tool schema exceeds the 64KB limit"), "limit_exceeded");
          let compiled: ValidateFunction | undefined;
          const schema = ((args: unknown) => {
            if (!compiled) compiled = compileSchema(tool.inputSchema as Record<string, unknown>);
            return compiled(args);
          }) as ValidateFunction;
          const base = `${mount.server}_${tool.name}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "mcp_tool";
          let name = base;
          for (let index = 2; registered.has(name) || batchNames.has(name); index += 1) { const suffix = `_${index}`; name = base.slice(0, 64 - suffix.length) + suffix; }
          batchNames.add(name);
          prepared.push({
            name, original: tool.name, schema,
            definition: { type: "function", function: { name, description: typeof tool.description === "string" ? tool.description : "Configured MCP tool", parameters: tool.inputSchema } },
          });
          if (Buffer.byteLength(JSON.stringify(definitions.concat(prepared.map((item) => item.definition)))) > CATALOG_BYTES) throw coded(new Error("MCP tool catalog exceeds the 1MB limit"), "limit_exceeded");
        }
        for (const item of prepared) {
          registered.set(item.name, {
            client: mount.client,
            name: item.original,
            schema: item.schema,
            server: mount.server,
            description: item.definition.function.description,
          });
          definitions.push(item.definition);
        }
        reports.push({
          server: mount.server, ok: true, stage: "ready",
          durationMs: Date.now() - mount.startedAt, timeoutMs: STARTUP_MS,
          toolCount: prepared.length,
        });
      } catch (error) {
        await mount.client.close().catch(() => {});
        const index = clients.indexOf(mount.client);
        if (index >= 0) clients.splice(index, 1);
        reports.push({
          server: mount.server, ok: false, stage: "schema",
          durationMs: Date.now() - mount.startedAt, timeoutMs: STARTUP_MS,
          toolCount: 0, code: mountFailureCode(error), error: boundedFailure(error),
        });
      }
    }
    if (signal.aborted || closed) throw aborted();
  } catch (error) { await close(); throw error; }
  // Every verified server stays mounted and callable; only this first-request
  // subset is advertised. `enableServers` widens it inside the turn, so a
  // narrow request never permanently loses a capability it turns out to need.
  const advertised: ChatToolDefinition[] = [];
  const advertisedNames = new Set<string>();
  const advertisedServers = new Set<string>();
  for (const definition of definitions) {
    const meta = registered.get(definition.function.name);
    if (!meta) continue;
    if (exposeSet && !exposeSet.has(meta.server)) continue;
    advertised.push(definition);
    advertisedNames.add(definition.function.name);
    advertisedServers.add(meta.server);
  }
  const readyServers = [...new Set(Array.from(registered.values(), (meta) => meta.server))];
  const enableServers = (names: readonly string[]): ChatToolDefinition[] => {
    const wanted = new Set(names);
    const added: ChatToolDefinition[] = [];
    for (const definition of definitions) {
      const meta = registered.get(definition.function.name);
      if (!meta || !wanted.has(meta.server) || advertisedNames.has(definition.function.name)) continue;
      advertised.push(definition);
      advertisedNames.add(definition.function.name);
      advertisedServers.add(meta.server);
      added.push(definition);
    }
    return added;
  };
  const retireServers = (names: readonly string[]): { retiredServers: string[]; retiredToolNames: string[] } => {
    const wanted = new Set(names);
    const retiredServers: string[] = [];
    const retiredToolNames: string[] = [];
    for (const server of wanted) {
      // Invariant: Never retire custom user MCP servers
      if (!KNOWN_SURFACES.has(server)) continue;
      if (!advertisedServers.has(server)) continue;
      advertisedServers.delete(server);
      retiredServers.push(server);
    }
    if (retiredServers.length) {
      const retiredSet = new Set(retiredServers);
      for (let i = advertised.length - 1; i >= 0; i--) {
        const def = advertised[i];
        const meta = registered.get(def.function.name);
        if (meta && retiredSet.has(meta.server)) {
          retiredToolNames.push(def.function.name);
          advertisedNames.delete(def.function.name);
          advertised.splice(i, 1);
        }
      }
    }
    return { retiredServers, retiredToolNames };
  };
  const validate = (name: string, args: unknown) => {
    if (closed || signal.aborted) throw new ChatToolSessionError("MCP session closed");
    const tool = registered.get(name);
    if (!tool || !advertisedNames.has(name)) throw new Error("The requested tool was not advertised for this turn");
    if (!object(args) || !tool.schema(args)) throw new Error("Tool arguments do not match the advertised input schema; use its required fields and types");
  };
  const readiness: ChatToolReadiness = { servers: reports, toolCount: advertised.length };
  return {
    definitions: advertised,
    get exposure() {
      return {
        advertised: [...advertisedServers],
        deferred: deferredServerNames.concat(readyServers.filter((server) => !advertisedServers.has(server))),
      };
    },
    readiness, validate, close, enableServers, retireServers,
    async execute(name, args, callSignal) {
      validate(name, args);
      if (callSignal.aborted) { await close(); throw aborted(); }
      const tool = registered.get(name)!;
      const diskPerms = loadDiskPermissions();
      // `validate` above proved this name was advertised by a server configured
      // for this turn, so an unrecognised name is the custom server's own naming
      // rather than an invented tool.
      const permCheck = checkToolPermission(tool.name, diskPerms, object(args) ? (args as Record<string, unknown>) : undefined, { mountedTool: true });
      if (!permCheck.allowed) {
        return { text: permCheck.reason || "Permission Denied", ok: false };
      }
      if (name !== tool.name) {
        const aliasCheck = checkToolPermission(name, diskPerms, object(args) ? (args as Record<string, unknown>) : undefined, { mountedTool: true });
        if (!aliasCheck.allowed) {
          return { text: aliasCheck.reason || "Permission Denied", ok: false };
        }
      }
      try {
        const result = await tool.client.call("tools/call", { name: tool.name, arguments: args }, AbortSignal.any([signal, callSignal]), CALL_MS);
        if (signal.aborted || callSignal.aborted) throw aborted();
        if (!object(result) || !Array.isArray(result.content) || (result.isError !== undefined && typeof result.isError !== "boolean")) throw new Error("MCP tool returned an invalid result; execution outcome may be uncertain");
        const parts: string[] = [];
        let unsupported = 0;
        let hasImage = false;
        const isImageOrScreenshotTool =
          /screenshot|screen_capture|browser_screenshot|take_screenshot|read_screen|capture_page|page_screenshot|capture_screen|image/i.test(name) ||
          /screenshot|screen_capture|browser_screenshot|take_screenshot|read_screen|capture_page|page_screenshot|capture_screen|image/i.test(tool.name) ||
          (typeof tool.description === "string" && /screenshot|image|capture/i.test(tool.description));
        for (const item of result.content) {
          if (!object(item) || typeof item.type !== "string" || (item.type === "text" && typeof item.text !== "string") || (item.type === "image" && typeof item.data !== "string")) throw new Error("MCP tool returned invalid content; execution outcome may be uncertain");
          if (item.type === "text") {
            parts.push(item.text as string);
          } else if (item.type === "image") {
            if (isImageOrScreenshotTool) {
              hasImage = true;
              parts.push(JSON.stringify(item));
            } else {
              unsupported += 1;
            }
          } else {
            unsupported += 1;
          }
        }
        if (result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
        if (unsupported) parts.unshift(`[${unsupported} unsupported MCP content item(s) omitted. The operation may have taken effect, but its full result cannot be represented; inspect its state before retrying.]`);
        const maxBytes = hasImage ? IMAGE_OUTPUT_BYTES : OUTPUT_BYTES;
        return { text: boundedText(parts.join("\n") || "(empty result)", maxBytes), ok: result.isError !== true && unsupported === 0 };
      } catch (error) {
        await close();
        throw new ChatToolSessionError(error instanceof Error ? error.message : "MCP transport failed; execution outcome may be uncertain");
      }
    },
  };
}

/**
 * The system-prompt notice for a partially ready turn. It names only servers
 * the turn did not advertise, so the model does not promise a capability the
 * provider cannot see. The text is harness-authored; the server name is
 * bounded and stripped of prompt-shaped punctuation, and the failure text is
 * never included (only the stage and a stable code).
 */
export function chatToolAvailabilityNotice(readiness: ChatToolReadiness): string {
  const failed = readiness.servers.filter((server) => !server.ok);
  if (!failed.length) return "";
  const names = failed.slice(0, 8).map((server) => {
    const name = server.server.replace(/[^\w .:@/-]/g, "").replace(/\s+/g, " ").trim().slice(0, 64) || "integration";
    return `${name} (${server.stage}; ${server.code ?? "mount_failed"})`;
  }).join(", ");
  const rest = failed.length > 8 ? `, plus ${failed.length - 8} more` : "";
  const plural = failed.length === 1 ? "it" : "them";    return `[Tool Availability Notice]: ${names}${rest} did not start for this turn, so ${plural === "it" ? "its" : "their"} tools are not available. Continue with the tools that are available and do not claim to have used ${plural}. If the task cannot be completed without ${plural}, say which integration is unavailable and what the person should check.`;
}

/** The system-prompt notice for servers that are mounted and verified but
 * deliberately left out of the first request. It is harness-authored and
 * names only integrations the person configured. */
export function deferredCapabilityNotice(deferred: readonly string[]): string {
  if (!deferred.length) return "";
  const names = deferred.slice(0, 16).join(", ");
  return `[Deferred Capabilities]: ${names} ${deferred.length === 1 ? "is" : "are"} installed and verified but not loaded into your tool list yet. When the task needs one, call capability_enable with its name; its tools appear from your next step. Do not claim to have used a deferred integration before loading it.`;
}

/** The one harness tool that widens this turn's advertised set. It never
 * mounts anything: every name it can load was already handshaken and schema
 * validated during this turn's mount. */
export function capabilityEnableDefinition(deferred: readonly string[]): ChatToolDefinition {
  return {
    type: "function",
    function: {
      name: "capability_enable",
      description: "Load additional integrations that are installed and verified but not in your tool list yet. Their tools become available on your next step.",
      parameters: {
        type: "object",
        properties: {
          servers: {
            type: "array",
            items: { type: "string", enum: deferred.slice(0, 32) },
            description: "Integration names to load.",
          },
        },
        required: ["servers"],
        additionalProperties: false,
      },
    },
  };
}

/** Handle a `capability_enable` call. Shared by every chat driver so the
 * expansion semantics cannot drift between engines. */
export function loadCapabilities(
  session: Pick<ChatToolSession, "exposure" | "enableServers">,
  requested: unknown,
  definitions: ChatToolDefinition[],
): { ok: boolean; text: string } {
  const names = (Array.isArray(requested) ? requested : typeof requested === "string" ? requested.split(",") : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  const deferred = session.exposure.deferred;
  if (!names.length) {
    return { ok: false, text: `Name at least one integration. Not loaded yet: ${deferred.join(", ") || "none"}.` };
  }
  const before = new Set(deferred);
  const added = session.enableServers(names);
  const known = new Set(definitions.map((definition) => definition.function.name));
  for (const definition of added) {
    if (known.has(definition.function.name)) continue;
    definitions.push(definition);
    known.add(definition.function.name);
  }
  if (!added.length) {
    return { ok: false, text: `No unloaded integration by that name. Not loaded yet: ${deferred.join(", ") || "none"}.` };
  }
  const loaded = names.filter((name) => before.has(name) && !session.exposure.deferred.includes(name));
  const remaining = session.exposure.deferred;
  return {
    ok: true,
    text: `Loaded ${added.length} tool(s) from ${loaded.join(", ")}. Use them from your next step.${remaining.length ? ` Still not loaded: ${remaining.join(", ")}.` : ""}`,
  };
}

/** The harness tool that narrows this turn's advertised set when a capability
 * is no longer needed. Retired integrations remain verified and mounted; their
 * tools can be re-enabled at any future step with capability_enable. */
export function capabilityRetireDefinition(advertised: readonly string[]): ChatToolDefinition {
  const retireable = advertised.filter((s) => KNOWN_SURFACES.has(s));
  return {
    type: "function",
    function: {
      name: "capability_retire",
      description: "Retire standard capabilities that are no longer needed for the current stage of the task. Their tools are removed from your active tool list to conserve context, and can be re-enabled later via capability_enable if needed.",
      parameters: {
        type: "object",
        properties: {
          servers: {
            type: "array",
            items: { type: "string", enum: retireable.slice(0, 32) },
            description: "Integration names to retire from the active tool set.",
          },
        },
        required: ["servers"],
        additionalProperties: false,
      },
    },
  };
}

/** Handle a `capability_retire` call. Shared by every chat driver so retirement
 * semantics remain uniform across engines. */
export function retireCapabilities(
  session: Pick<ChatToolSession, "exposure" | "retireServers">,
  requested: unknown,
  definitions: ChatToolDefinition[],
): { ok: boolean; text: string } {
  const names = (Array.isArray(requested) ? requested : typeof requested === "string" ? requested.split(",") : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!names.length) {
    return { ok: false, text: `Name at least one integration to retire. Currently active: ${session.exposure.advertised.join(", ") || "none"}.` };
  }
  const { retiredServers, retiredToolNames } = session.retireServers(names);
  if (!retiredServers.length) {
    return { ok: false, text: `No active standard integrations matched: ${names.join(", ")}. Note: custom user MCP servers cannot be retired.` };
  }
  const retiredToolSet = new Set(retiredToolNames);
  for (let i = definitions.length - 1; i >= 0; i--) {
    if (retiredToolSet.has(definitions[i].function.name)) {
      definitions.splice(i, 1);
    }
  }
  const remaining = session.exposure.advertised;
  return {
    ok: true,
    text: `Retired ${retiredServers.length} integration(s): ${retiredServers.join(", ")}. Their tools were removed from your active tool list to conserve context. They remain installed and can be re-enabled with capability_enable. Remaining active integrations: ${remaining.join(", ") || "none"}.`,
  };
}
