// Agent Tool Specifications for Computer Agent Layer (master_prompt_02.md)

import { EnvironmentDiscovery } from "./environment-discovery.ts";
import { defaultProcessManager } from "./process-manager.ts";
import { defaultSystemVerifier } from "./verification.ts";

export interface ToolSpec {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> | unknown;
}

export const COMPUTER_AGENT_TOOLS: Record<string, ToolSpec> = {
  environment_discover: {
    description:
      "Inspect the current operating environment: device OS, architecture (arm64), CPU & memory, available storage, installed interpreters (Node, Python, Java), package managers (npm, pip), shell, network connectivity, and browser driver. Call this to truthfully know what tools exist rather than guessing.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const disco = new EnvironmentDiscovery();
      const report = await disco.discover();
      return { ok: true, environment: report };
    },
  },

  process_start: {
    description:
      "Start a long-running process in the background on this device (e.g. server, worker, database engine, watcher). The process survives your turn and runs detached while logging stdout/stderr. Returns a process id to inspect, monitor, or stop.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Executable or binary to run (e.g. 'node', 'sh', 'python3')" },
        args: { type: "array", items: { type: "string" }, description: "Arguments array (e.g. ['server.js', '--port', '8080'])" },
        cwd: { type: "string", description: "Working directory relative to workspace or absolute path" },
        env: { type: "object", additionalProperties: { type: "string" }, description: "Environment variables" },
        ports: { type: "array", items: { type: "integer" }, description: "Expected listening ports" },
        healthEndpoint: { type: "string", description: "Optional HTTP health endpoint to probe (e.g. 'http://127.0.0.1:8080/health')" },
        tag: { type: "string", description: "Human-readable label for this service" },
      },
      required: ["command"],
    },
    handler: async (args) => {
      const command = String(args.command || "").trim();
      if (!command) return { ok: false, error: "command is required" };
      const proc = await defaultProcessManager.startProcess({
        command,
        args: Array.isArray(args.args) ? (args.args as string[]) : [],
        cwd: args.cwd ? String(args.cwd) : undefined,
        env: (args.env as Record<string, string>) || undefined,
        ports: Array.isArray(args.ports) ? (args.ports as number[]) : undefined,
        healthEndpoint: args.healthEndpoint ? String(args.healthEndpoint) : undefined,
        tag: args.tag ? String(args.tag) : undefined,
      });
      return { ok: true, process: proc };
    },
  },

  process_inspect: {
    description:
      "Inspect the live state of a managed background process: PID, lifecycle state (STARTING, RUNNING, HEALTHY, UNHEALTHY, CRASHED, STOPPED), exit code, uptime, and health.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process ID returned by process_start" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id || "").trim();
      const proc = await defaultProcessManager.inspectProcess(id);
      if (!proc) return { ok: false, error: `Process ${id} not found` };
      return { ok: true, process: proc };
    },
  },

  process_logs: {
    description: "Read stdout and stderr logs captured from a managed background process.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process ID returned by process_start" },
        maxBytes: { type: "integer", description: "Max bytes to retrieve from tail of log (default 32768)" },
      },
      required: ["id"],
    },
    handler: (args) => {
      const id = String(args.id || "").trim();
      const logs = defaultProcessManager.getLogs(id, typeof args.maxBytes === "number" ? args.maxBytes : undefined);
      return { ok: true, id, logs };
    },
  },

  process_stop: {
    description: "Stop a managed background process with graceful SIGTERM (or SIGKILL if force=true).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process ID to stop" },
        force: { type: "boolean", description: "Force kill with SIGKILL immediately" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id || "").trim();
      const res = await defaultProcessManager.stopProcess(id, Boolean(args.force));
      return { ok: res.ok, id, state: res.state };
    },
  },

  process_restart: {
    description: "Restart a managed background process with its original command, arguments, and environment.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process ID to restart" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id || "").trim();
      try {
        const proc = await defaultProcessManager.restartProcess(id);
        return { ok: true, process: proc };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
  },

  process_list: {
    description: "List all background processes managed on this device with their current lifecycle states.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const processes = await defaultProcessManager.listProcesses();
      return { ok: true, processes };
    },
  },

  verify_service: {
    description:
      "Empirically verify that a local service or HTTP port is listening and responsive. Performs multiple consecutive HTTP probes to prove it stays alive, checking status codes, latency, and process PID.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Port number (e.g. '3000' or 3000) or URL (e.g. 'http://127.0.0.1:3000/api/health')" },
        expectedStatus: { type: "array", items: { type: "integer" }, description: "Acceptable HTTP status codes (default 200..399)" },
        expectedPattern: { type: "string", description: "Substring pattern expected in the response body" },
        processId: { type: "string", description: "Optional process ID to verify that the owning PID remains alive" },
        minChecks: { type: "integer", description: "Number of consecutive successful checks required (default 2)" },
      },
      required: ["target"],
    },
    handler: async (args) => {
      const rawTarget = args.target;
      const portOrUrl = typeof rawTarget === "number" ? rawTarget : String(rawTarget);
      const res = await defaultSystemVerifier.verifyService(portOrUrl, {
        portOrUrl,
        expectedStatus: Array.isArray(args.expectedStatus) ? (args.expectedStatus as number[]) : undefined,
        expectedContentPattern: args.expectedPattern ? String(args.expectedPattern) : undefined,
        processId: args.processId ? String(args.processId) : undefined,
        minConsecutiveChecks: typeof args.minChecks === "number" ? args.minChecks : 2,
      });
      return { ok: res.verified, result: res };
    },
  },

  verify_file: {
    description:
      "Empirically verify a file exists, has non-zero size, line count, sha256 checksum, and valid syntax (json or js). Use this before claiming a file was written correctly.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to file in workspace or absolute path" },
        validateSyntax: { type: "string", enum: ["json", "js", "none"], description: "Syntax parser validation" },
        minBytes: { type: "integer", description: "Expected minimum size in bytes" },
      },
      required: ["path"],
    },
    handler: (args) => {
      const path = String(args.path || "").trim();
      const res = defaultSystemVerifier.verifyFile(path, {
        path,
        validateSyntax: (args.validateSyntax as any) || "none",
        expectedMinBytes: typeof args.minBytes === "number" ? args.minBytes : undefined,
      });
      return { ok: res.verified, result: res };
    },
  },
};
