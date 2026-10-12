// Empirical Verification Primitives (master_prompt_02.md Phase 8)
//
// Verifies services, ports, HTTP endpoints, files, and artifacts
// without trusting blind execution output.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { defaultProcessManager, GeneralProcessManager } from "./process-manager.ts";
import type {
  ServiceVerificationOptions,
  ServiceVerificationResult,
  FileVerificationOptions,
  FileVerificationResult,
} from "./types.ts";

export class SystemVerifier {
  private readonly processManager: GeneralProcessManager;

  constructor(processManager: GeneralProcessManager = defaultProcessManager) {
    this.processManager = processManager;
  }

  /**
   * Verify an HTTP service or listening port with consecutive health checks.
   */
  async verifyService(
    portOrUrl: number | string,
    options: ServiceVerificationOptions = { portOrUrl }
  ): Promise<ServiceVerificationResult> {
    const minConsecutive = options.minConsecutiveChecks ?? 2;
    const timeoutMs = options.timeoutMs ?? 2000;
    const targetUrl =
      typeof portOrUrl === "number"
        ? `http://127.0.0.1:${portOrUrl}/`
        : portOrUrl.startsWith("http")
        ? portOrUrl
        : `http://127.0.0.1:${portOrUrl}`;

    let consecutiveSuccesses = 0;
    let lastStatus: number | undefined;
    let lastLatency: number | undefined;
    let lastBodyPreview: string | undefined;
    let lastError: string | undefined;

    // Check associated process state if provided
    let processPid: number | undefined;
    let processState: any;
    if (options.processId) {
      const proc = await this.processManager.inspectProcess(options.processId);
      if (proc) {
        processPid = proc.pid;
        processState = proc.state;
        if (proc.state === "CRASHED" || proc.state === "STOPPED") {
          return {
            verified: false,
            target: targetUrl,
            processPid,
            processState,
            consecutiveSuccesses: 0,
            error: `Associated process ${options.processId} is ${proc.state}`,
            diagnosis: `The server process terminated unexpectedly. Check process logs.`,
          };
        }
      }
    }

    // Allow startup grace period for service to start listening
    const startupTimeoutMs = options.startupTimeoutMs ?? Math.min(options.timeoutMs ?? 2000, 3000);
    const startDeadline = Date.now() + startupTimeoutMs;

    let probe = await this.probeHttp(targetUrl, timeoutMs);
    while (!probe.ok && Date.now() < startDeadline) {
      if (options.processId) {
        const proc = await this.processManager.inspectProcess(options.processId);
        if (proc && (proc.state === "CRASHED" || proc.state === "STOPPED")) {
          return {
            verified: false,
            target: targetUrl,
            processPid: proc.pid,
            processState: proc.state,
            consecutiveSuccesses: 0,
            error: `Associated process ${options.processId} is ${proc.state}`,
            diagnosis: `The server process terminated unexpectedly. Check process logs.`,
          };
        }
      }
      await new Promise((r) => setTimeout(r, 100));
      probe = await this.probeHttp(targetUrl, timeoutMs);
    }

    if (!probe.ok) {
      return {
        verified: false,
        target: targetUrl,
        processPid,
        processState,
        consecutiveSuccesses: 0,
        error: probe.error,
        diagnosis: `Service at ${targetUrl} did not respond or connection was refused.`,
      };
    }

    lastStatus = probe.status;
    lastLatency = probe.latencyMs;
    lastBodyPreview = probe.bodyPreview;
    if (options.expectedContentPattern && !probe.bodyPreview.includes(options.expectedContentPattern)) {
      return {
        verified: false,
        target: targetUrl,
        processPid,
        processState,
        consecutiveSuccesses: 0,
        httpStatus: lastStatus,
        latencyMs: lastLatency,
        bodyPreview: lastBodyPreview,
        error: `Content missing required pattern: "${options.expectedContentPattern}"`,
        diagnosis: `Service responded but response content did not match expected pattern.`,
      };
    }
    consecutiveSuccesses = 1;

    for (let i = 1; i < minConsecutive; i++) {
      await new Promise((r) => setTimeout(r, 250));

      const nextProbe = await this.probeHttp(targetUrl, timeoutMs);
      if (nextProbe.ok) {
        lastStatus = nextProbe.status;
        lastLatency = nextProbe.latencyMs;
        lastBodyPreview = nextProbe.bodyPreview;

        if (options.expectedContentPattern && !nextProbe.bodyPreview.includes(options.expectedContentPattern)) {
          lastError = `Content missing required pattern: "${options.expectedContentPattern}"`;
          break;
        }

        consecutiveSuccesses++;
      } else {
        lastError = nextProbe.error;
        break;
      }
    }

    const verified = consecutiveSuccesses >= minConsecutive;

    return {
      verified,
      target: targetUrl,
      httpStatus: lastStatus,
      latencyMs: lastLatency,
      processState,
      processPid,
      bodyPreview: lastBodyPreview,
      consecutiveSuccesses,
      error: verified ? undefined : lastError || "Verification checks failed",
      diagnosis: verified
        ? `Service verified healthy (${consecutiveSuccesses}/${minConsecutive} successful probes).`
        : `Service unreachable or returned errors: ${lastError || "Failed"}`,
    };
  }

  /**
   * Verify file existence, integrity, and syntax.
   */
  verifyFile(path: string, options: FileVerificationOptions = { path }): FileVerificationResult {
    if (!existsSync(path)) {
      return {
        verified: false,
        path,
        exists: false,
        sizeBytes: 0,
        lineCount: 0,
        error: `File does not exist: ${path}`,
      };
    }

    try {
      const stat = statSync(path);
      const content = readFileSync(path);
      const sizeBytes = stat.size;
      const sha256 = createHash("sha256").update(content).digest("hex");
      const lineCount = content.toString("utf8").split("\n").length;

      if (options.expectedMinBytes && sizeBytes < options.expectedMinBytes) {
        return {
          verified: false,
          path,
          exists: true,
          sizeBytes,
          lineCount,
          sha256,
          error: `File size ${sizeBytes} bytes is less than expected minimum ${options.expectedMinBytes} bytes`,
        };
      }

      let syntaxValid: boolean | undefined;
      let error: string | undefined;

      if (options.validateSyntax === "json") {
        try {
          JSON.parse(content.toString("utf8"));
          syntaxValid = true;
        } catch (e: any) {
          syntaxValid = false;
          error = `JSON syntax error: ${e.message}`;
        }
      } else if (options.validateSyntax === "js") {
        try {
          new Function(content.toString("utf8"));
          syntaxValid = true;
        } catch (e: any) {
          syntaxValid = false;
          error = `JavaScript syntax error: ${e.message}`;
        }
      }

      return {
        verified: syntaxValid === false ? false : true,
        path,
        exists: true,
        sizeBytes,
        lineCount,
        sha256,
        syntaxValid,
        error,
      };
    } catch (err: any) {
      return {
        verified: false,
        path,
        exists: true,
        sizeBytes: 0,
        lineCount: 0,
        error: `Failed to read file: ${err.message}`,
      };
    }
  }

  private probeHttp(
    urlStr: string,
    timeoutMs: number
  ): Promise<{ ok: boolean; status?: number; latencyMs?: number; bodyPreview: string; error?: string }> {
    return new Promise((resolve) => {
      try {
        const u = new URL(urlStr);
        const isHttps = u.protocol === "https:";
        const transport = isHttps ? https : http;
        const start = Date.now();

        const req = transport.request(
          {
            hostname: u.hostname,
            port: u.port || (isHttps ? 443 : 80),
            path: u.pathname + u.search,
            method: "GET",
            headers: { "User-Agent": "MOBOT-Verifier/1.0" },
            timeout: timeoutMs,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              const body = Buffer.concat(chunks).toString("utf8");
              const latencyMs = Date.now() - start;
              const status = res.statusCode || 0;
              const ok = status >= 200 && status < 400;
              resolve({
                ok,
                status,
                latencyMs,
                bodyPreview: body.slice(0, 500),
                error: ok ? undefined : `HTTP error status ${status}`,
              });
            });
          }
        );

        req.on("error", (err) => {
          resolve({ ok: false, bodyPreview: "", error: `Connection failed: ${err.message}` });
        });

        req.on("timeout", () => {
          req.destroy();
          resolve({ ok: false, bodyPreview: "", error: `Connection timed out after ${timeoutMs}ms` });
        });

        req.end();
      } catch (err: any) {
        resolve({ ok: false, bodyPreview: "", error: err.message });
      }
    });
  }
}

export const defaultSystemVerifier = new SystemVerifier();
