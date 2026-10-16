// General-Purpose Process Lifecycle Manager (master_prompt_02.md Phase 5)
//
// Manages detached background child processes, supervises execution,
// logs stdout/stderr, detects crashes, tracks listening ports,
// and enforces genuine lifecycle states:
// CREATED, STARTING, RUNNING, HEALTHY, UNHEALTHY, CRASHED, STOPPING, STOPPED.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import type { ManagedProcessRecord, ProcessLifecycleState, ProcessStartOptions } from "./types.ts";

export class GeneralProcessManager {
  private readonly processes = new Map<string, ManagedProcessRecord>();
  private readonly childHandles = new Map<string, ChildProcess>();
  private readonly logDir: string;
  private readonly registryFile: string;

  constructor(workspacePath?: string) {
    const root = workspacePath || process.env.AC_WORKSPACE || process.cwd();
    this.logDir = join(root, ".omb-proc-logs");
    this.registryFile = join(this.logDir, "processes.json");
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch {
      // Ignore directory creation failure if already exists
    }
    this.loadFromDisk();
  }

  private saveToDisk(): void {
    try {
      const records = Array.from(this.processes.values());
      writeFileSync(this.registryFile, JSON.stringify(records, null, 2), "utf8");
    } catch {
      // Best-effort persistence
    }
  }

  private loadFromDisk(): void {
    try {
      if (existsSync(this.registryFile)) {
        const raw = readFileSync(this.registryFile, "utf8");
        const list: ManagedProcessRecord[] = JSON.parse(raw);
        for (const item of list) {
          if (item && item.id) {
            this.processes.set(item.id, item);
          }
        }
      }
    } catch {
      // Best-effort load
    }
  }

  /**
   * Start a new managed process.
   */
  async startProcess(options: ProcessStartOptions): Promise<ManagedProcessRecord> {
    const id = `proc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const logFile = join(this.logDir, `${id}.log`);

    try {
      writeFileSync(logFile, `=== Process ${id} (${options.command} ${(options.args || []).join(" ")}) started at ${new Date().toISOString()} ===\n`, "utf8");
    } catch {
      // Safe fallback
    }

    const record: ManagedProcessRecord = {
      id,
      command: options.command,
      args: options.args || [],
      cwd: options.cwd || process.env.AC_WORKSPACE || process.cwd(),
      env: options.env,
      state: "STARTING",
      startTime: new Date().toISOString(),
      ports: options.ports || [],
      tag: options.tag,
      healthEndpoint: options.healthEndpoint,
      logFile,
    };

    this.processes.set(id, record);

    try {
      const child = spawn(options.command, options.args || [], {
        cwd: record.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      record.pid = child.pid;
      record.state = "RUNNING";
      this.childHandles.set(id, child);

      child.stdout?.on("data", (chunk: Buffer) => {
        try {
          appendFileSync(logFile, chunk);
        } catch {}
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        try {
          appendFileSync(logFile, chunk);
        } catch {}
      });

      child.on("error", (err) => {
        record.state = "CRASHED";
        record.lastError = err.message;
        record.endTime = new Date().toISOString();
        this.saveToDisk();
        try {
          appendFileSync(logFile, `\n[process.error] ${err.message}\n`);
        } catch {}
      });

      child.on("exit", (code, signal) => {
        record.exitCode = code;
        record.signal = signal;
        record.endTime = new Date().toISOString();
        if (record.state === "STOPPING") {
          record.state = "STOPPED";
        } else {
          record.state = code === 0 ? "STOPPED" : "CRASHED";
        }
        this.saveToDisk();
        try {
          appendFileSync(logFile, `\n[process.exit] Code: ${code}, Signal: ${signal}\n`);
        } catch {}
      });

      // Detach from Node parent so turn completion does not kill the process
      child.unref();

      // Give process 200ms grace period to catch immediate failure on launch
      await new Promise((r) => setTimeout(r, 200));
      await this.inspectProcess(id);
      this.saveToDisk();

      return record;
    } catch (err: any) {
      record.state = "CRASHED";
      record.lastError = err.message;
      record.endTime = new Date().toISOString();
      this.saveToDisk();
      return record;
    }
  }

  /**
   * Inspect a process by ID and update state dynamically.
   */
  async inspectProcess(id: string): Promise<ManagedProcessRecord | null> {
    const record = this.processes.get(id);
    if (!record) return null;

    if (record.pid && record.state !== "STOPPED" && record.state !== "CRASHED") {
      let isAlive = false;
      try {
        process.kill(record.pid, 0);
        isAlive = true;
      } catch (e: any) {
        if (e.code === "ESRCH") {
          isAlive = false;
        } else {
          isAlive = true; // EPERM means exists but not permitted to kill
        }
      }

      if (!isAlive) {
        record.state = "CRASHED";
        if (!record.endTime) record.endTime = new Date().toISOString();
        this.saveToDisk();
      } else {
        // If healthEndpoint is set, probe it
        if (record.healthEndpoint) {
          const healthy = await this.probeHealth(record.healthEndpoint);
          record.state = healthy ? "HEALTHY" : "UNHEALTHY";
        } else {
          record.state = "RUNNING";
        }
      }
    }

    return record;
  }

  /**
   * Stop a running process.
   */
  async stopProcess(id: string, force = false): Promise<{ ok: boolean; state: ProcessLifecycleState }> {
    const record = this.processes.get(id);
    if (!record) return { ok: false, state: "STOPPED" };

    if (!record.pid || record.state === "STOPPED" || record.state === "CRASHED") {
      return { ok: true, state: record.state };
    }

    record.state = "STOPPING";
    try {
      const sig = force ? "SIGKILL" : "SIGTERM";
      process.kill(record.pid, sig);
    } catch (err: any) {
      if (err.code === "ESRCH") {
        record.state = "STOPPED";
        this.saveToDisk();
        return { ok: true, state: "STOPPED" };
      }
    }

    // Wait up to 1 second for graceful exit
    const start = Date.now();
    while (Date.now() - start < 1000) {
      try {
        process.kill(record.pid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        record.state = "STOPPED";
        record.endTime = new Date().toISOString();
        this.saveToDisk();
        return { ok: true, state: "STOPPED" };
      }
    }

    // Force kill if still lingering
    try {
      process.kill(record.pid, "SIGKILL");
    } catch {}

    record.state = "STOPPED";
    record.endTime = new Date().toISOString();
    this.saveToDisk();
    return { ok: true, state: "STOPPED" };
  }

  /**
   * Restart a process.
   */
  async restartProcess(id: string): Promise<ManagedProcessRecord> {
    const old = this.processes.get(id);
    if (!old) {
      throw new Error(`Process ${id} not found.`);
    }

    await this.stopProcess(id, true);

    return this.startProcess({
      command: old.command,
      args: old.args,
      cwd: old.cwd,
      env: old.env,
      ports: old.ports,
      tag: old.tag,
      healthEndpoint: old.healthEndpoint,
    });
  }

  /**
   * Read retained stdout/stderr logs.
   */
  getLogs(id: string, maxBytes = 32768): string {
    const record = this.processes.get(id);
    if (!record || !existsSync(record.logFile)) {
      return "";
    }

    try {
      const bytes = readFileSync(record.logFile);
      if (bytes.length <= maxBytes) {
        return bytes.toString("utf8");
      }
      return bytes.subarray(bytes.length - maxBytes).toString("utf8");
    } catch {
      return "";
    }
  }

  /**
   * List all managed processes.
   */
  async listProcesses(): Promise<ManagedProcessRecord[]> {
    const list = Array.from(this.processes.values());
    for (const p of list) {
      await this.inspectProcess(p.id);
    }
    return list;
  }

  private probeHealth(urlStr: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const u = new URL(urlStr);
        const req = http.request(
          {
            hostname: u.hostname,
            port: u.port || 80,
            path: u.pathname + u.search,
            method: "GET",
            timeout: 1000,
          },
          (res) => {
            res.resume();
            resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400);
          }
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
        req.end();
      } catch {
        resolve(false);
      }
    });
  }
}

export const defaultProcessManager = new GeneralProcessManager();
