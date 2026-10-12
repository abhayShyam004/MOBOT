// Environment Discovery (master_prompt_02.md Phase 4 & 5)
//
// Inspects real device hardware, OS, storage, runtimes, binaries, network,
// and browser availability without hardcoding or faking facts.

import { execFileSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import os from "node:os";
import https from "node:https";
import type { EnvironmentReport, RuntimeInfo } from "./types.ts";

function runQuiet(cmd: string, args: string[], timeoutMs = 2000): string | null {
  try {
    const out = execFileSync(cmd, args, {
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });
    return out.trim();
  } catch {
    return null;
  }
}

function findBinary(name: string): string | null {
  const pathEnv = process.env.PATH || "/system/bin:/system/xbin";
  const dirs = pathEnv.split(":");
  for (const dir of dirs) {
    if (!dir) continue;
    const full = `${dir}/${name}`;
    if (existsSync(full)) {
      return full;
    }
  }
  return null;
}

export class EnvironmentDiscovery {
  private readonly workspacePath: string;

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath || process.env.AC_WORKSPACE || process.cwd();
  }

  /**
   * Perform comprehensive environment inspection.
   */
  async discover(): Promise<EnvironmentReport> {
    const isAndroid = process.platform === "android" || existsSync("/system/bin/getprop");
    let androidVersion: string | undefined;
    let deviceModel: string | undefined;

    if (isAndroid) {
      const getprop = findBinary("getprop") || "/system/bin/getprop";
      if (existsSync(getprop)) {
        androidVersion = runQuiet(getprop, ["ro.build.version.release"]) || undefined;
        deviceModel = runQuiet(getprop, ["ro.product.model"]) || undefined;
      }
    }

    // Disk storage calculation
    let workspaceFreeBytes: number | undefined;
    let workspaceTotalBytes: number | undefined;
    try {
      if (typeof statfsSync === "function" && existsSync(this.workspacePath)) {
        const stats = statfsSync(this.workspacePath);
        workspaceFreeBytes = Number(stats.bavail) * Number(stats.bsize);
        workspaceTotalBytes = Number(stats.blocks) * Number(stats.bsize);
      }
    } catch {
      // Fallback
    }

    // Detect runtimes
    const runtimes: Record<string, RuntimeInfo> = {};

    // 1. Node.js
    runtimes["node"] = {
      name: "Node.js",
      available: true,
      version: process.version,
      path: process.execPath,
      details: "Built-in mobile runtime execution engine",
    };

    // 2. npm
    const npmPath = findBinary("npm");
    const npmVer = npmPath ? runQuiet(npmPath, ["--version"]) : null;
    runtimes["npm"] = {
      name: "npm",
      available: Boolean(npmVer || process.env.OMB_NPM_CLI),
      version: npmVer || undefined,
      path: npmPath || process.env.OMB_NPM_CLI || undefined,
      details: npmVer ? "Executable package manager on PATH" : "CLI bundled via launcher",
    };

    // 3. npx
    const npxPath = findBinary("npx");
    runtimes["npx"] = {
      name: "npx",
      available: Boolean(npxPath || process.env.OMB_NPX_SHIM),
      path: npxPath || process.env.OMB_NPX_SHIM || undefined,
      details: "Package executor shim",
    };

    // 4. Python
    const python3Path = findBinary("python3") || findBinary("python");
    const pythonVer = python3Path ? runQuiet(python3Path, ["--version"]) : null;
    runtimes["python"] = {
      name: "Python",
      available: Boolean(python3Path && pythonVer),
      version: pythonVer || undefined,
      path: python3Path || undefined,
      details: pythonVer ? `Installed: ${pythonVer}` : "Not present in device PATH",
    };

    // 5. Git
    const gitPath = findBinary("git");
    const gitVer = gitPath ? runQuiet(gitPath, ["--version"]) : null;
    runtimes["git"] = {
      name: "Git",
      available: Boolean(gitPath && gitVer),
      version: gitVer || undefined,
      path: gitPath || undefined,
      details: gitVer ? `Installed: ${gitVer}` : "Not present in device PATH",
    };

    // 6. SQLite
    const sqlitePath = findBinary("sqlite3");
    const sqliteVer = sqlitePath ? runQuiet(sqlitePath, ["-version"]) : null;
    runtimes["sqlite3"] = {
      name: "SQLite CLI",
      available: Boolean(sqlitePath && sqliteVer),
      version: sqliteVer || undefined,
      path: sqlitePath || undefined,
      details: sqliteVer ? `Installed: ${sqliteVer}` : "Not present as standalone CLI binary (Node sqlite module available)",
    };

    // 7. Shell / Toybox
    const shPath = findBinary("sh") || "/system/bin/sh";
    const toyboxPath = findBinary("toybox") || "/system/bin/toybox";
    runtimes["shell"] = {
      name: "Shell",
      available: existsSync(shPath),
      path: shPath,
      details: existsSync(toyboxPath) ? `Toybox available at ${toyboxPath}` : "POSIX shell available",
    };

    // 8. Curl / Wget
    const curlPath = findBinary("curl");
    const wgetPath = findBinary("wget");
    runtimes["network_tools"] = {
      name: "HTTP CLI Utilities",
      available: Boolean(curlPath || wgetPath),
      details: curlPath ? `curl at ${curlPath}` : wgetPath ? `wget at ${wgetPath}` : "Built-in http_fetch and Node fetch active",
    };

    // Network check
    const network = await this.probeNetwork();

    // Browser check
    const driverPort = Number(process.env.AB_DRIVER_PORT || 0);
    const browserAvailable = driverPort > 0;

    return {
      operatingSystem: {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        isAndroid,
        androidVersion,
        deviceModel,
      },
      resources: {
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
        workspacePath: this.workspacePath,
        workspaceFreeBytes,
        workspaceTotalBytes,
      },
      runtimes,
      network,
      browserDriver: {
        available: browserAvailable,
        driverPort: browserAvailable ? driverPort : undefined,
      },
      terminalCapabilities: {
        hasPty: Number(process.env.AT_DRIVER_PORT || 0) > 0,
        hasNativeLauncher: existsSync(process.env.OMB_EXEC_LAUNCHER || ""),
        shellPath: shPath,
      },
    };
  }

  /**
   * Probe network connectivity without leaking sensitive data.
   */
  private probeNetwork(): Promise<{ online: boolean; latencyMs?: number; details?: string }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const req = https.get("https://1.1.1.1", { timeout: 2000 }, (res) => {
        res.resume();
        resolve({
          online: true,
          latencyMs: Date.now() - start,
          details: `Connected (HTTP ${res.statusCode || 200})`,
        });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ online: false, details: "Timeout checking network connection" });
      });

      req.on("error", (err) => {
        resolve({ online: false, details: `Network probe error: ${err.message}` });
      });
    });
  }
}
