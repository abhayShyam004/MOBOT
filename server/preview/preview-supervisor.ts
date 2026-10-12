// PreviewSupervisor: Centralized port allocator and multi-process supervisor
// for Phase D — Localhost App Preview.
//
// Manages local development servers on Android loopback, preventing collisions
// with OpenMausBot harness services (port 18799) and browser/terminal drivers.
// Tracks frontend and backend processes independently and provides honest state.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer, Socket } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export type ServiceKind = "frontend" | "backend" | "standalone";
export type ServiceStatus = "stopped" | "starting" | "running" | "crashed" | "error";

export interface ManagedServiceState {
  name: string;
  kind: ServiceKind;
  status: ServiceStatus;
  port?: number;
  url?: string;
  pid?: number;
  exitCode?: number | null;
  error?: string;
  startedAt?: string;
  stoppedAt?: string;
}

export interface ProjectPreviewEnvironmentState {
  projectId: string;
  overall: ServiceStatus;
  primaryUrl?: string;
  services: Record<string, ManagedServiceState>;
}

export interface StartServiceOptions {
  projectId: string;
  serviceName?: string;
  kind?: ServiceKind;
  command: string;
  cwd: string;
  requestedPort?: number;
  env?: Record<string, string>;
  healthPath?: string;
  timeoutMs?: number;
}

const RESERVED_PORTS = new Set([18799, 28799, 18787, 28787, 5037]);

export class PortAllocator {
  private readonly allocated = new Map<string, number>();

  async allocate(key: string, minPort = 3000, maxPort = 4999): Promise<number> {
    if (this.allocated.has(key)) {
      const existing = this.allocated.get(key)!;
      if (await this.isPortAvailable(existing)) {
        return existing;
      }
      this.allocated.delete(key);
    }

    for (let port = minPort; port <= maxPort; port++) {
      if (RESERVED_PORTS.has(port)) continue;
      if (Array.from(this.allocated.values()).includes(port)) continue;
      if (await this.isPortAvailable(port)) {
        this.allocated.set(key, port);
        return port;
      }
    }
    throw new Error(`No available ports found in range ${minPort}-${maxPort}`);
  }

  release(key: string): void {
    this.allocated.delete(key);
  }

  isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const srv = createServer();
      srv.unref();
      srv.on("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => {
        srv.close(() => resolve(true));
      });
    });
  }
}

export class PreviewSupervisor {
  readonly portAllocator: PortAllocator;
  private readonly environments = new Map<string, ProjectPreviewEnvironmentState>();
  private readonly activeChildren = new Map<string, { child: ChildProcess; logPath: string; port: number }>();

  constructor(portAllocator = new PortAllocator()) {
    this.portAllocator = portAllocator;
  }

  getEnvironmentState(projectId: string): ProjectPreviewEnvironmentState {
    const env = this.environments.get(projectId);
    if (!env) {
      return {
        projectId,
        overall: "stopped",
        services: {},
      };
    }
    return env;
  }

  async startService(options: StartServiceOptions): Promise<ManagedServiceState> {
    const projectId = options.projectId;
    const serviceName = options.serviceName || "default";
    const kind = options.kind || "standalone";
    const childKey = `${projectId}:${serviceName}`;

    // Stop existing process for this service if running
    await this.stopService(projectId, serviceName);

    const port = options.requestedPort || (await this.portAllocator.allocate(childKey));
    const url = `http://127.0.0.1:${port}`;
    const now = new Date().toISOString();

    const logDir = join(options.cwd, ".omb");
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${serviceName}-preview.log`);

    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "/bin/sh";

    const nodeBin = process.execPath;
    const nativeLibDir = dirname(nodeBin);
    const existingPath = options.env?.PATH || (process.env.PATH as string) || "/system/bin";
    const existingLd = options.env?.LD_LIBRARY_PATH || (process.env.LD_LIBRARY_PATH as string) || "";

    const pathParts = [dirname(nodeBin), existingPath].filter(Boolean);
    const ldParts = [nativeLibDir, existingLd].filter(Boolean);

    const spawnEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...options.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      PATH: pathParts.join(delimiter),
      LD_LIBRARY_PATH: ldParts.join(":"),
    };

    let effectiveCmd = options.command;
    if (/^node(\s|$)/.test(effectiveCmd)) {
      effectiveCmd = `"${nodeBin}"` + effectiveCmd.slice(4);
    }
    const args = isWin ? ["/c", effectiveCmd] : ["-c", effectiveCmd];

    const child = spawn(shell, args, {
      cwd: options.cwd,
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let logBuffer = "";
    const appendLog = (chunk: Buffer) => {
      logBuffer += chunk.toString("utf8");
      if (logBuffer.length > 64 * 1024) logBuffer = logBuffer.slice(-32 * 1024);
      writeFileSync(logPath, logBuffer, { mode: 0o600 });
    };

    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);

    this.activeChildren.set(childKey, { child, logPath, port });

    const serviceState: ManagedServiceState = {
      name: serviceName,
      kind,
      status: "starting",
      port,
      url,
      pid: child.pid,
      startedAt: now,
    };

    this.updateServiceState(projectId, serviceName, serviceState);

    child.on("close", (code) => {
      this.activeChildren.delete(childKey);
      this.portAllocator.release(childKey);

      const latest = this.getServiceState(projectId, serviceName);
      if (latest) {
        latest.status = code === 0 ? "stopped" : "crashed";
        latest.exitCode = code;
        latest.stoppedAt = new Date().toISOString();
        if (code !== 0) latest.error = `Service process exited with code ${code}`;
        this.updateServiceState(projectId, serviceName, latest);
      }
    });

    // Probe port readiness
    const isReady = await this.waitForPort(port, options.timeoutMs || 4000);
    if (!isReady && !this.activeChildren.has(childKey)) {
      throw new Error(`Service "${serviceName}" crashed before listening on port ${port}.`);
    }

    serviceState.status = "running";
    this.updateServiceState(projectId, serviceName, serviceState);

    return serviceState;
  }

  async stopService(projectId: string, serviceName = "default"): Promise<ManagedServiceState> {
    const childKey = `${projectId}:${serviceName}`;
    const active = this.activeChildren.get(childKey);

    if (active) {
      try {
        active.child.kill("SIGTERM");
        setTimeout(() => {
          try {
            active.child.kill("SIGKILL");
          } catch {}
        }, 1000);
      } catch {}
      this.activeChildren.delete(childKey);
      this.portAllocator.release(childKey);
    }

    const state = this.getServiceState(projectId, serviceName) || {
      name: serviceName,
      kind: "standalone",
      status: "stopped",
    };

    state.status = "stopped";
    state.pid = undefined;
    state.stoppedAt = new Date().toISOString();
    this.updateServiceState(projectId, serviceName, state);

    return state;
  }

  async stopAll(projectId: string): Promise<ProjectPreviewEnvironmentState> {
    const env = this.getEnvironmentState(projectId);
    for (const serviceName of Object.keys(env.services)) {
      await this.stopService(projectId, serviceName);
    }
    return this.getEnvironmentState(projectId);
  }

  getServiceState(projectId: string, serviceName = "default"): ManagedServiceState | null {
    const env = this.environments.get(projectId);
    return env?.services[serviceName] || null;
  }

  getServiceLogs(projectId: string, serviceName = "default", maxLines = 100): string {
    const childKey = `${projectId}:${serviceName}`;
    const active = this.activeChildren.get(childKey);
    const logPath = active?.logPath;

    if (logPath && existsSync(logPath)) {
      const content = readFileSync(logPath, "utf8");
      return content.split("\n").slice(-maxLines).join("\n");
    }
    return "No logs available for service.";
  }

  private updateServiceState(projectId: string, serviceName: string, state: ManagedServiceState): void {
    let env = this.environments.get(projectId);
    if (!env) {
      env = {
        projectId,
        overall: "stopped",
        services: {},
      };
      this.environments.set(projectId, env);
    }

    env.services[serviceName] = state;

    // Calculate overall status
    const list = Object.values(env.services);
    if (list.some((s) => s.status === "crashed")) {
      env.overall = "crashed";
    } else if (list.some((s) => s.status === "running")) {
      env.overall = "running";
      // Primary URL is frontend or first running service
      const primary = list.find((s) => s.kind === "frontend" && s.status === "running") || list.find((s) => s.status === "running");
      env.primaryUrl = primary?.url;
    } else if (list.some((s) => s.status === "starting")) {
      env.overall = "starting";
    } else {
      env.overall = "stopped";
      env.primaryUrl = undefined;
    }
  }

  private waitForPort(port: number, timeoutMs = 4000): Promise<boolean> {
    const start = Date.now();
    return new Promise((resolve) => {
      const probe = () => {
        if (Date.now() - start > timeoutMs) {
          resolve(false);
          return;
        }
        const socket = new Socket();
        socket.setTimeout(200);
        socket.on("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.on("error", () => {
          socket.destroy();
          setTimeout(probe, 50);
        });
        socket.on("timeout", () => {
          socket.destroy();
          setTimeout(probe, 50);
        });
        socket.connect(port, "127.0.0.1");
      };
      probe();
    });
  }
}
