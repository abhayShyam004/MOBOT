import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Spawns the android-computer adapter exactly the way the harness does —
 * a stdio MCP server driven over newline-delimited JSON-RPC — and exercises
 * the real tool implementations. web_search/http_fetch hit the live network;
 * they are skipped (not failed) when the sandbox has no internet, so the
 * suite stays deterministic offline and honest online.
 */
describe("android-computer MCP server (stdio contract)", () => {
  let child: ChildProcess;
  let workspace: string;
  let buffer: string;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  let nextId = 1;

  /**
   * Spawn the adapter the way the harness does. `extraEnv` is how a test hands
   * it the app-side terminal driver handoff (AT_DRIVER_PORT/AT_DRIVER_TOKEN) or
   * withholds it: without those variables the adapter is a build that hosts no
   * terminals, which is a state the suite must keep covering.
   */
  function spawnAdapter(extraEnv: Record<string, string> = {}): void {
    buffer = "";
    const runtime = join(workspace, "fake-runtime");
    child = spawn(process.execPath, ["--experimental-strip-types", join(import.meta.dirname, "android-computer.ts")], {
      env: {
        ...process.env,
        AC_WORKSPACE: workspace,
        AC_SYSTEM_BIN: "/usr/bin",
        OMB_NPM_CLI: join(runtime, "npm-cli.js"),
        OMB_NPX_SHIM: join(runtime, "npx-shim.js"),
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        const entry = pending.get(message.id);
        if (entry) {
          pending.delete(message.id);
          if (message.error) entry.reject(new Error(message.error.message));
          else entry.resolve(message.result);
        }
      }
    });
    child.stderr!.on("data", (chunk: string) => process.stderr.write(`[adapter] ${chunk}`));
  }

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "omb-adapter-"));
    // Stand-ins for the bundled npm tree and the npx shim, so the suite never
    // depends on the machine's own npm or on the network. The adapter reads
    // these paths on every shell call, so they are written before it spawns.
    const runtime = join(workspace, "fake-runtime");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, "npm-cli.js"), "console.log('npm-cli', process.argv.slice(2).join(' '));\n");
    writeFileSync(join(runtime, "npx-shim.js"), "console.log('npx-shim', process.argv.slice(2).join(' '));\n");
    spawnAdapter();
  });

  afterEach(async () => {
    child.kill("SIGKILL");
    rmSync(workspace, { recursive: true, force: true });
  });

  function rpc(method: string, params?: unknown): Promise<any> {
    const id = nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      child.stdin!.write(frame);
    });
  }

  async function initialize(): Promise<void> {
    await rpc("initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }

  async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const result = await rpc("tools/call", { name, arguments: args });
    expect(result.isError ?? false).toBe(false);
    expect(Array.isArray(result.content)).toBe(true);
    return JSON.parse(result.content[0].text);
  }

  async function callErr(name: string, args: Record<string, unknown>): Promise<any> {
    const result = await rpc("tools/call", { name, arguments: args });
    expect(result.isError).toBe(true);
    return JSON.parse(result.content[0].text);
  }

  it("initializes and lists the full tool catalog", async () => {
    await initialize();
    const { tools } = await rpc("tools/list");
    const names = tools.map((tool: any) => tool.name);
    for (const expected of [
      "workspace_list", "workspace_read", "workspace_write", "workspace_append",
      "workspace_mkdir", "workspace_move", "workspace_copy", "workspace_delete",
      "workspace_stat", "workspace_exists", "run_command", "run_shell", "http_fetch", "web_search",
      "package_status", "open_interactive",
      "terminal_start", "terminal_write", "terminal_read", "terminal_resize", "terminal_close", "terminal_list",
    ]) expect(names).toContain(expected);
  });

  it("publishes the runtime wrappers, and reaches npx from a subprocess through the shim path", async () => {
    await initialize();
    // A plain shell call is enough to publish the runtime binaries.
    const shell = await call("run_shell", { command: "node --version" });
    expect(shell.ok).toBe(true);
    for (const name of ["node", "npm", "npx"]) {
      const path = join(workspace, ".omb-bin", name);
      // Executable, not a shell function: the bit is what lets a subprocess
      // resolve it through PATH. node is the one symlink; npm and npx are
      // scripts that exec the embedded runtime against the real CLIs.
      if (name === "node") expect(statSync(path).isSymbolicLink() || (statSync(path).mode & 0o111) !== 0).toBe(true);
      else expect(statSync(path).mode & 0o111).not.toBe(0);
    }
    for (const name of ["npm", "npx"]) {
      // The shebang is what makes it an executable at all: without it execve
      // answers ENOEXEC and the caller's shell reads the script's first line
      // as a command instead — on device that opened a shell and hung.
      expect(readFileSync(join(workspace, ".omb-bin", name), "utf8")).toMatch(/^#!\S*\/sh\n/);
      // And it really execs: the kernel resolves the interpreter here, in this
      // process, with no shell fallback to hide a malformed script.
      expect(execFileSync(join(workspace, ".omb-bin", name), ["--probe"], { encoding: "utf8" }).trim()).toBe(`${name === "npm" ? "npm-cli" : "npx-shim"} --probe`);
    }
    // The same command resolves in this shell, in a spawned child process,
    // and in a background job — the defect this replaces was npx existing
    // only as a shell function, which `sh -c` and `nohup` could not see.
    expect((await call("run_shell", { command: "npx --version" })).stdout.trim()).toBe("npx-shim --version");
    expect((await call("run_shell", { command: "sh -c 'npm run build -- --watch'" })).stdout.trim()).toBe("npm-cli run build -- --watch");
    const background = await call("run_shell", { command: "nohup npx --yes torlnk check-output 2>&1" });
    expect(background.stdout.trim()).toContain("npx-shim --yes torlnk check-output");
    // Android refuses exec of an app-data file from the app's own domain
    // (measured on the phone: EACCES for `nohup npx`, while the same file runs
    // when a shell reads it). The supported subprocess route is the shim path
    // the harness exports, and it is the one a bot must be told to use.
    const shimPath = join(workspace, "fake-runtime", "npx-shim.js");
    const spawned = await call("run_shell", {
      command: `SHIM=${JSON.stringify(shimPath)} node -e 'const r=require("node:child_process").spawnSync(process.execPath,[process.env.SHIM,"--version"],{encoding:"utf8"});console.log(r.stdout.trim())'`,
    });
    expect(spawned.stdout.trim()).toBe("npx-shim --version");
  });

  it("answers what a package is and what this build can open, without exposing internals", async () => {
    await initialize();
    const missing = await call("package_status", { name: "torlnk-not-here" });
    expect(missing).toMatchObject({ ok: true, state: "not_present", running: false });
    // The shim's cache holds an installed tree per spec: the package's own
    // manifest is under node_modules/<name>, which is where the version comes
    // from — "available through npx (1.9.0)", not "available through npx".
    const cache = join(workspace, ".npm", "_npx-shim", "torlnk", "node_modules", "torlnk");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "package.json"), JSON.stringify({ name: "torlnk", version: "1.9.0" }));
    const cached = await call("package_status", { name: "torlnk" });
    expect(cached).toMatchObject({ state: "available_through_npx", version: "1.9.0", running: false });
    expect(missing.interactiveSession).toBe("unavailable");
    // The refusal a launch gets: structured, honest, and free of the jargon a
    // person should never read (tool names, paths, nohup, shell mechanics).
    const refused = await call("open_interactive", { command: "npx --yes torlnk" });
    // A successful tool call reporting an unmet capability: the model must be
    // able to answer honestly without the turn being marked as a tool failure.
    expect(refused).toMatchObject({ ok: true, success: false, reason: "interactive_session_unavailable", classification: "interactive" });
    expect(refused.guidance).toContain("do not tell them to run the command themselves");
    const said = `${refused.say} ${refused.detail}`;
    for (const leak of [".omb-bin", "nohup", "shell", "/data/", "workspace", "stopReason"]) expect(said).not.toContain(leak);
  });

  it("writes, lists, reads, stats, moves, copies, appends, and deletes", async () => {
    await initialize();
    const write = await call("workspace_write", { path: "notes/phase4.txt", content: "maus on device" });
    expect(write.bytesWritten).toBe(14);
    const list = await call("workspace_list", { path: "notes" });
    expect(list.entries.map((entry: any) => entry.name)).toContain("phase4.txt");
    const read = await call("workspace_read", { path: "notes/phase4.txt" });
    expect(read.text).toBe("maus on device");
    const stat = await call("workspace_stat", { path: "notes/phase4.txt" });
    expect(stat.isFile).toBe(true);
    expect(stat.size).toBe(14);
    await call("workspace_move", { from: "notes/phase4.txt", to: "notes/renamed.txt" });
    expect((await call("workspace_exists", { path: "notes/phase4.txt" })).exists).toBe(false);
    await call("workspace_copy", { from: "notes/renamed.txt", to: "notes/copy.txt" });
    const append = await call("workspace_append", { path: "notes/copy.txt", content: "\nline2" });
    expect(append.sizeAfter).toBe(20);
    const double = await call("workspace_read", { path: "notes/copy.txt" });
    expect(double.text).toContain("line2");
    await call("workspace_delete", { path: "notes/copy.txt" });
    expect((await call("workspace_exists", { path: "notes/copy.txt" })).exists).toBe(false);
  });

  it("answers a missing path with a structured error, never a raw tool crash (#workspace_stat)", async () => {
    await initialize();
    // The recurring chat row `android_computer_workspace_stat` was a raw ENOENT
    // from an unguarded statSync escaping as a JSON-RPC tool error. Every
    // read-shaped tool must answer a bounded, structured refusal instead.
    const stat = await callErr("workspace_stat", { path: "nope/ghost.txt" });
    expect(stat.ok).toBe(false);
    expect(stat.error).toContain("ghost.txt");
    expect(stat.error).toContain("workspace");
    const read = await callErr("workspace_read", { path: "nope/ghost.txt" });
    expect(read.ok).toBe(false);
    expect(read.error).toContain("ghost.txt");
    const list = await callErr("workspace_list", { path: "nope" });
    expect(list.ok).toBe(false);
    const move = await callErr("workspace_move", { from: "nope/ghost.txt", to: "elsewhere.txt" });
    expect(move.ok).toBe(false);
    const copy = await callErr("workspace_copy", { from: "nope/ghost.txt", to: "elsewhere.txt" });
    expect(copy.ok).toBe(false);
    const del = await callErr("workspace_delete", { path: "nope/ghost.txt" });
    expect(del.ok).toBe(false);
    // Sanity: a path that exists still stats normally.
    await call("workspace_write", { path: "real.txt", content: "here" });
    const good = await call("workspace_stat", { path: "real.txt" });
    expect(good.ok).toBe(true);
    expect(good.isFile).toBe(true);
  });

  it("refuses traversal and workspace-root deletion from the tool surface", async () => {
    await initialize();
    const escaped = await callErr("workspace_write", { path: "../escape.txt", content: "no" });
    expect(escaped.error).toMatch(/escapes the workspace/);
    const rootDelete = await callErr("workspace_delete", { path: "." });
    expect(rootDelete.error).toMatch(/refusing to delete the workspace root/);
  });

  it("runs an allowlisted command with stdout, stderr and exit codes", async () => {
    await initialize();
    await call("workspace_write", { path: "greet.txt", content: "device shell" });
    const ok = await call("run_command", { command: "cat", args: ["greet.txt"] });
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toBe("device shell");
    // A non-zero exit is a *result* (the model reads stderr/exitCode); only
    // refusals are MCP-level errors.
    const missing = await call("run_command", { command: "cat", args: ["no-such-file.txt"] });
    expect(missing.ok).toBe(false);
    expect(missing.exitCode).not.toBe(0);
    expect(String(missing.stderr)).toMatch(/no such|No such/i);
    const refused = await callErr("run_command", { command: "sh", args: ["-c", "echo pwned"] });
    expect(refused.error).toMatch(/not allowed/);
  });

  it("runs a full shell: pipes, redirects, exit codes and stderr", async () => {
    await initialize();
    // run_command refuses a shell; run_shell IS the shell — the person asked
    // for a complete terminal, so pipes and redirection must work.
    const piped = await call("run_shell", { command: "printf 'device shell\\n' | tr a-z A-Z" });
    expect(piped.exitCode).toBe(0);
    expect(piped.stdout.trim()).toBe("DEVICE SHELL");
    const redirected = await call("run_shell", { command: "echo line > shell-out.txt && cat shell-out.txt && wc -l < shell-out.txt" });
    expect(redirected.stdout).toContain("line");
    expect(redirected.stdout.trim().endsWith("1")).toBe(true);
    const failed = await call("run_shell", { command: "echo to-stderr >&2; exit 3" });
    expect(failed.ok).toBe(false);
    expect(failed.exitCode).toBe(3);
    expect(String(failed.stderr)).toContain("to-stderr");
    const empty = await callErr("run_shell", { command: "   " });
    expect(empty.error).toMatch(/command is required/);
  });

  it("kills a command at its timeout", async () => {
    await initialize();
    // toybox sleep exists on Android; the shortest legal timeout is 100ms.
    const started = Date.now();
    const result = await call("run_command", { command: "sleep", args: ["30"], timeoutMs: 500 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("caps oversized tool output while keeping the frame valid JSON", async () => {
    await initialize();
    // 300KB of NUL bytes over the 256KB output cap; the shrink path must cut
    // the RAW string (never the serialized JSON) so the caller can parse it.
    const result = await call("run_command", { command: "head", args: ["-c", String(300 * 1024), "/dev/zero"] });
    expect(result.truncated).toBe(true);
    expect(typeof result.stdout).toBe("string");
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(256 * 1024 + 64);
  }, 20_000);

  it("performs a real HTTPS request through http_fetch", async () => {
    await initialize();
    let payload: any;
    try {
      payload = await call("http_fetch", { url: "https://api.github.com/zen", headers: { "user-agent": "openmausbot-phase4-test" } });
    } catch {
      console.log("network unavailable — skipping live fetch assertions");
      return;
    }
    expect(payload.status).toBe(200);
    expect(typeof payload.body).toBe("string");
    expect(payload.body.length).toBeGreaterThan(4);
    const refused = await callErr("http_fetch", { url: "http://127.0.0.1:18799/api/health" });
    // Literal-IP loopback is refused by the URL validator itself (the DNS
    // path's "resolves only to private/loopback" wording is a different hop),
    // so match the literal-IP refusal the guard is documented to throw.
    expect(refused.error).toMatch(/private, loopback/);
  }, 45_000);

  it("returns real results from live web search", async () => {
    await initialize();
    let payload: any;
    try {
      payload = await call("web_search", { query: "Android toybox command documentation", limit: 4 });
    } catch {
      console.log("network unavailable — skipping live search assertions");
      return;
    }
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results.length).toBeGreaterThan(0);
    for (const hit of payload.results) {
      expect(typeof hit.title).toBe("string");
      expect(hit.url).toMatch(/^https?:\/\//);
    }
  }, 45_000);

  // ── persistent terminals ──────────────────────────────────────────────────
  // The app owns the PTYs and the adapter is only a client — so these tests
  // drive a real HTTP driver with the same request and response shapes the app
  // answers. What that buys: the tool layer, the exact request bodies, the
  // cursor bookkeeping, and the turn boundary are all exercised for real. The
  // only thing faked is the kernel's side of a PTY, which the device
  // acceptance run covers.
  describe("persistent terminals", () => {
    let driver: FakeTerminalDriver;

    beforeEach(async () => {
      // A turn is a process. The tests that matter kill one and start another.
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      driver = new FakeTerminalDriver();
      await driver.start();
      spawnAdapter({ AT_DRIVER_PORT: String(driver.port), AT_DRIVER_TOKEN: driver.token });
      await initialize();
    });

    afterEach(async () => {
      await driver.stop();
    });

    it("starts a program in a terminal the app owns, on the person's screen", async () => {
      const started = await call("terminal_start", { command: "npx --yes torlnk", label: "torlnk" });
      expect(started.ok).toBe(true);
      expect(started.sessionId).toBe("t-1");
      expect(started.label).toBe("torlnk");
      expect(started.running).toBe(true);
      expect(started.terminal).toBe(true);
      // What the phone was actually asked to run: the embedded runtime against
      // the npx shim — the same route a run_shell call takes, which is what
      // makes this generic rather than a torlnk special case.
      const launch = driver.starts[0];
      expect(launch.program).toBe(process.execPath);
      expect(launch.args).toEqual([join(workspace, "fake-runtime", "npx-shim.js"), "--yes", "torlnk"]);
      const env = launch.env as Record<string, string>;
      expect(env.HOME).toBe(workspace);
      expect(env.PATH.split(":")).toContain(join(workspace, ".omb-bin"));
      expect(env.OMB_NPX_SHIM).toBe(join(workspace, "fake-runtime", "npx-shim.js"));
      expect(launch.cwd).toBe(workspace);
      expect(launch.rows).toBe(30);
      expect(launch.cols).toBe(80);
      expect(launch.show).toBe(true);
      // The app, not the adapter, names the terminal: nothing about how the
      // runtime works reaches the person's screen.
      expect(String(launch.program)).not.toContain("torlnk");
    });

    it("types into it, and reads only what is new", async () => {
      const started = await call("terminal_start", { command: "npx --yes torlnk" });
      const id = started.sessionId;

      await call("terminal_write", { sessionId: id, text: "hello", enter: true });
      expect(driver.writes.at(-1)).toMatchObject({ id, body: { text: "hello", enter: true } });

      driver.print(id, "welcome\n");
      const first = await call("terminal_read", { sessionId: id });
      expect(first.output).toBe("welcome\n");
      expect(first.newOutput).toBe(true);
      expect(first.running).toBe(true);

      // Nothing new is an answer, not an empty re-read of the whole session.
      const second = await call("terminal_read", { sessionId: id });
      expect(second.output).toBe("");
      expect(second.newOutput).toBe(false);

      driver.print(id, "second\n");
      expect((await call("terminal_read", { sessionId: id })).output).toBe("second\n");
      // A reader starting over still gets everything the session retained.
      expect((await call("terminal_read", { sessionId: id, fromStart: true })).output).toBe("welcome\nsecond\n");
    });

    it("sends named keys and matches the terminal to the screen", async () => {
      const started = await call("terminal_start", { command: "node" });
      const id = started.sessionId;

      await call("terminal_write", { sessionId: id, keys: ["up", "ctrl-c"] });
      expect(driver.writes.at(-1)?.body.keys).toEqual(["up", "ctrl-c"]);

      const resized = await call("terminal_resize", { sessionId: id, rows: 40, cols: 120 });
      expect(resized).toMatchObject({ rows: 40, cols: 120 });
      expect(driver.resizes).toEqual([{ rows: 40, cols: 120 }]);
    });

    it("reports a program that exited, and refuses one the phone does not have", async () => {
      const started = await call("terminal_start", { command: "npx --yes torlnk" });
      driver.exit(started.sessionId, 0);
      const read = await call("terminal_read", { sessionId: started.sessionId });
      expect(read.state).toBe("exited");
      expect(read.running).toBe(false);
      expect(read.exitCode).toBe(0);

      const refused = await callErr("terminal_start", { command: "definitely-not-a-program" });
      expect(refused.error).toMatch(/no program called/);
      // A refusal starts nothing, and the phone is not left with a session
      // nobody asked for.
      expect((await call("terminal_list", {})).count).toBe(1);
    });

    it("closes a terminal for real, and lists what the phone is hosting", async () => {
      const started = await call("terminal_start", { command: "npx --yes torlnk", label: "torlnk" });
      const listed = await call("terminal_list", {});
      expect(listed.count).toBe(1);
      expect(listed.sessions[0]).toMatchObject({
        sessionId: started.sessionId,
        label: "torlnk",
        state: "running",
        running: true,
        terminal: true,
      });
      // No internals reach the model: a session is an id, a label and a state.
      expect(Object.keys(listed.sessions[0])).not.toContain("pid");

      const closed = await call("terminal_close", { sessionId: started.sessionId });
      expect(closed).toMatchObject({ ok: true, closed: true, stillRunning: false });
      expect(driver.closes).toEqual([started.sessionId]);
      expect((await call("terminal_list", {})).count).toBe(0);
      expect((await call("terminal_list", {})).note).toContain("No terminals");
    });

    it("open_interactive opens a real session and answers the person without internals", async () => {
      const opened = await call("open_interactive", { command: "npx --yes torlnk", name: "torlnk" });
      expect(opened.ok).toBe(true);
      expect(opened.success).toBe(true);
      expect(opened.reason).toBe("interactive_session_started");
      expect(opened.sessionId).toBe("t-1");
      expect(opened.say).toBe("Opening torlnk…");
      expect(opened.guidance).toContain("Never mention tool names");
      // What the person reads never describes how any of it works.
      for (const leak of [".omb-bin", "sessionId", "t-1", "pid", "/data/", "AT_DRIVER", "nohup", "PORT"]) {
        expect(opened.say).not.toContain(leak);
      }
      expect(driver.starts).toHaveLength(1);
    });

    it("open_interactive says plainly when a real launch fails", async () => {
      driver.failStarts = true;
      const opened = await call("open_interactive", { command: "npx --yes torlnk", name: "torlnk" });
      expect(opened).toMatchObject({
        ok: true,
        success: false,
        reason: "terminal_start_failed",
        say: "I couldn't start the interactive terminal.",
      });
      expect(opened.guidance).toContain("never claim it opened");
      for (const leak of [".omb-bin", "refused to start", "pid", "errno"]) {
        expect(opened.say).not.toContain(leak);
      }
    });

    it("a package running in a terminal is reported as running, not installed", async () => {
      await call("terminal_start", { command: "npx --yes torlnk", label: "torlnk" });
      const status = await call("package_status", { name: "torlnk" });
      expect(status.interactiveSession).toBe("available");
      expect(status.running).toBe(true);
      expect(status.terminals).toEqual([
        expect.objectContaining({ label: "torlnk", state: "running", running: true }),
      ]);
      // Running it through npx is still not installing it.
      expect(status.state).toBe("not_present");
    });

    it("a terminal outlives the turn that opened it", async () => {
      const opened = await call("open_interactive", { command: "npx --yes torlnk", name: "torlnk" });
      const id = opened.sessionId;

      // The turn ends. The adapter process is the turn, and nothing about the
      // session belongs to it.
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      expect(driver.closes).toEqual([]);

      // The next turn: a brand-new adapter that has never heard of this
      // session, asking the phone what it is hosting.
      spawnAdapter({ AT_DRIVER_PORT: String(driver.port), AT_DRIVER_TOKEN: driver.token });
      await initialize();

      const listed = await call("terminal_list", {});
      expect(listed.count).toBe(1);
      expect(listed.sessions[0]).toMatchObject({ sessionId: id, state: "running", running: true });

      // Output it produced while nobody was looking is still there, and the
      // program is still there to answer.
      driver.print(id, "prints while nobody was looking\n");
      const read = await call("terminal_read", { sessionId: id, fromStart: true });
      expect(read.output).toContain("prints while nobody was looking");
      expect(read.running).toBe(true);
      await call("terminal_write", { sessionId: id, text: "hi", enter: true });
      expect(driver.writes.at(-1)?.body.text).toBe("hi");
      expect(driver.closes).toEqual([]);
    });
  });

  // ── the runtime launcher ─────────────────────────────────────────────────
  describe("native launcher publication", () => {
    it("publishes npm and npx as symlinks to the build's launcher, and says so", async () => {
      const hostLauncher = join(import.meta.dirname, "..", ".omb-native-host", "libombexec.so");
      if (!existsSync(hostLauncher)) {
        console.log("host launcher not built — skipping (see scripts/build-android-pty.mjs --host)");
        return;
      }
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      spawnAdapter({ OMB_EXEC_LAUNCHER: hostLauncher });
      await initialize();
      // Any shell call publishes the runtime.
      await call("run_shell", { command: "true" });
      for (const name of ["npm", "npx"]) {
        const path = join(workspace, ".omb-bin", name);
        // A symlink to a real executable, not a script: that is the whole
        // difference between "a shell can run it" and "anything can".
        expect(lstatSync(path).isSymbolicLink()).toBe(true);
        expect(readlinkSync(path)).toBe(hostLauncher);
        expect(statSync(path).mode & 0o111).not.toBe(0);
      }
      expect(readlinkSync(join(workspace, ".omb-bin", "node"))).toBe(process.execPath);
      // And the tool description the model reads states the reach it really
      // has, so no bot has to discover the difference by failing.
      const { tools } = await rpc("tools/list");
      const runShell = tools.find((tool: any) => tool.name === "run_shell");
      expect(runShell.description).toContain("every kind of caller finds them");
    });
  });
});

/**
 * The app-side terminal driver, as far as the adapter can tell: the same routes,
 * the same `{ok, …}` envelope, the same cursor-based read. Sessions live here,
 * outside the adapter, which is what makes the turn-boundary test meaningful
 * rather than circular.
 */
class FakeTerminalDriver {
  readonly starts: Array<Record<string, unknown>> = [];
  readonly writes: Array<{ id: string; body: Record<string, unknown> }> = [];
  readonly resizes: Array<{ rows: number; cols: number }> = [];
  readonly closes: string[] = [];
  readonly token = "test-driver-token";
  failStarts = false;

  private readonly sessions = new Map<string, Record<string, unknown>>();
  private readonly output = new Map<string, string>();
  private readonly server = createServer((request, response) => {
    void this.handle(request, response);
  });
  private counter = 0;

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** The program prints something. */
  print(id: string, text: string): void {
    this.output.set(id, (this.output.get(id) ?? "") + text);
  }

  /** The program ends. */
  exit(id: string, code: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    (session.state as Record<string, unknown>).running = false;
    (session.state as Record<string, unknown>).exitCode = code;
  }

  private view(id: string): Record<string, unknown> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`no such terminal session: ${id}`);
    return { ...session, cursor: (this.output.get(id) ?? "").length };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request);
    const url = request.url ?? "";
    const parts = url.split("/").filter(Boolean);
    const send = (payload: Record<string, unknown>): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    try {
      if (parts[0] === "start") {
        if (this.failStarts) {
          send({ ok: false, error: "the terminal refused to start the program" });
          return;
        }
        this.starts.push(body);
        const id = `t-${++this.counter}`;
        this.sessions.set(id, {
          id,
          label: String(body.label ?? ""),
          command: String(body.command ?? ""),
          botId: (body.botId as string) || null,
          rows: Number(body.rows ?? 30),
          cols: Number(body.cols ?? 80),
          terminal: true,
          state: { running: true, exitCode: null, signal: null, closed: false },
        });
        send({ ok: true, session: this.view(id) });
        return;
      }
      if (parts[0] === "sessions") {
        send({ ok: true, sessions: [...this.sessions.keys()].map((id) => this.view(id)) });
        return;
      }
      if (parts[0] === "session" && parts[2] === "write") {
        this.writes.push({ id: parts[1], body });
        send({ ok: true, written: 1, session: this.view(parts[1]) });
        return;
      }
      if (parts[0] === "session" && parts[2] === "read") {
        const produced = this.output.get(parts[1]) ?? "";
        const cursor = typeof body.cursor === "number" ? body.cursor : 0;
        const data = produced.slice(cursor);
        send({
          ok: true,
          data,
          bytes: data.length,
          cursor: produced.length,
          total: produced.length,
          missed: false,
          waited: data.length > 0,
          session: this.view(parts[1]),
        });
        return;
      }
      if (parts[0] === "session" && parts[2] === "resize") {
        const session = this.sessions.get(parts[1]);
        this.resizes.push({ rows: Number(body.rows), cols: Number(body.cols) });
        if (session) {
          session.rows = Number(body.rows);
          session.cols = Number(body.cols);
        }
        send({ ok: true, rows: Number(body.rows), cols: Number(body.cols), session: this.view(parts[1]) });
        return;
      }
      if (parts[0] === "session" && parts[2] === "close") {
        this.closes.push(parts[1]);
        const session = this.sessions.get(parts[1]);
        if (session) {
          (session.state as Record<string, unknown>).running = false;
          (session.state as Record<string, unknown>).closed = true;
          (session.state as Record<string, unknown>).exitCode = 0;
        }
        const view = this.view(parts[1]);
        this.sessions.delete(parts[1]);
        this.output.delete(parts[1]);
        send({ ok: true, closed: parts[1], session: view });
        return;
      }
      send({ ok: false, error: `unknown route ${url}` });
    } catch (error) {
      send({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}
