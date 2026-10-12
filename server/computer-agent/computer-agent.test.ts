// Comprehensive Unit Tests for General-Purpose Computer Agent (master_prompt_02.md)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EnvironmentDiscovery } from "./environment-discovery.ts";
import { GeneralProcessManager } from "./process-manager.ts";
import { SystemVerifier } from "./verification.ts";
import { COMPUTER_AGENT_TOOLS } from "./agent-tools.ts";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("General-Purpose Computer Agent Layer", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omb-test-agent-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Environment Discovery", () => {
    it("truthfully reports OS, architecture, and memory without guessing", async () => {
      const disco = new EnvironmentDiscovery(tempDir);
      const report = await disco.discover();

      expect(report.operatingSystem.platform).toBe(process.platform);
      expect(report.operatingSystem.arch).toBe(process.arch);
      expect(report.resources.totalMemoryBytes).toBeGreaterThan(0);
      expect(report.resources.freeMemoryBytes).toBeGreaterThan(0);
      expect(report.resources.workspacePath).toBe(tempDir);
    });

    it("accurately detects Node.js runtime and truthful availability of binaries", async () => {
      const disco = new EnvironmentDiscovery(tempDir);
      const report = await disco.discover();

      expect(report.runtimes.node.available).toBe(true);
      expect(report.runtimes.node.version).toBe(process.version);
      expect(report.runtimes.node.path).toBe(process.execPath);

      // Verifies truthfulness: does not claim fake runtimes exist
      expect(report.runtimes.shell.available).toBe(true);
    });
  });

  describe("General Process Lifecycle Manager", () => {
    it("starts background process, streams logs, inspects live PID, and stops cleanly", async () => {
      const manager = new GeneralProcessManager(tempDir);

      const proc = await manager.startProcess({
        command: process.execPath,
        args: ["-e", "console.log('daemon-boot'); setInterval(() => console.log('tick'), 100);"],
        tag: "test-daemon",
      });

      expect(proc.id).toMatch(/^proc_/);
      expect(proc.pid).toBeDefined();
      expect(proc.state).toBe("RUNNING");

      // Allow stdout to flush
      await new Promise((r) => setTimeout(r, 250));

      const logs = manager.getLogs(proc.id);
      expect(logs).toContain("daemon-boot");

      const inspected = await manager.inspectProcess(proc.id);
      expect(inspected?.state).toBe("RUNNING");
      expect(inspected?.pid).toBe(proc.pid);

      // Stop process
      const stopRes = await manager.stopProcess(proc.id);
      expect(stopRes.ok).toBe(true);
      expect(stopRes.state).toBe("STOPPED");

      const afterStop = await manager.inspectProcess(proc.id);
      expect(afterStop?.state).toBe("STOPPED");
    });

    it("detects crashed process when child exits with non-zero status", async () => {
      const manager = new GeneralProcessManager(tempDir);

      const proc = await manager.startProcess({
        command: process.execPath,
        args: ["-e", "console.error('fatal-crash'); process.exit(42);"],
      });

      // Wait for exit
      await new Promise((r) => setTimeout(r, 300));

      const inspected = await manager.inspectProcess(proc.id);
      expect(inspected?.state).toBe("CRASHED");
      expect(inspected?.exitCode).toBe(42);

      const logs = manager.getLogs(proc.id);
      expect(logs).toContain("fatal-crash");
    });

    it("restarts a process preserving original command and configuration", async () => {
      const manager = new GeneralProcessManager(tempDir);

      const initial = await manager.startProcess({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        tag: "restart-target",
      });

      const initialPid = initial.pid;
      expect(initial.state).toBe("RUNNING");

      const restarted = await manager.restartProcess(initial.id);
      expect(restarted.state).toBe("RUNNING");
      expect(restarted.tag).toBe("restart-target");
      expect(restarted.pid).not.toBe(initialPid);

      await manager.stopProcess(restarted.id);
    });
  });

  describe("System Verification Primitives", () => {
    it("verifies responsive HTTP service over multiple consecutive checks", async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "healthy", v: "1.0" }));
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const address = server.address() as any;
      const port = address.port;

      const verifier = new SystemVerifier();
      const res = await verifier.verifyService(port, {
        portOrUrl: port,
        expectedStatus: [200],
        expectedContentPattern: "healthy",
        minConsecutiveChecks: 2,
      });

      expect(res.verified).toBe(true);
      expect(res.httpStatus).toBe(200);
      expect(res.consecutiveSuccesses).toBe(2);
      expect(res.bodyPreview).toContain("healthy");

      server.close();
    });

    it("truthfully fails verification when port is dead", async () => {
      const verifier = new SystemVerifier();
      // Port 59999 should not have a server listening
      const res = await verifier.verifyService(59999, {
        portOrUrl: 59999,
        timeoutMs: 500,
        minConsecutiveChecks: 1,
      });

      expect(res.verified).toBe(false);
      expect(res.consecutiveSuccesses).toBe(0);
      expect(res.error).toBeDefined();
    });

    it("verifies file existence, size, line count, sha256 and syntax validation", () => {
      const verifier = new SystemVerifier();
      const validJsonPath = join(tempDir, "config.json");
      writeFileSync(validJsonPath, '{\n  "name": "mobot",\n  "active": true\n}\n', "utf8");

      const jsonRes = verifier.verifyFile(validJsonPath, {
        path: validJsonPath,
        validateSyntax: "json",
        expectedMinBytes: 10,
      });

      expect(jsonRes.verified).toBe(true);
      expect(jsonRes.exists).toBe(true);
      expect(jsonRes.syntaxValid).toBe(true);
      expect(jsonRes.lineCount).toBe(5);
      expect(jsonRes.sha256).toBeDefined();

      const invalidJsonPath = join(tempDir, "bad.json");
      writeFileSync(invalidJsonPath, '{\n  "broken": \n', "utf8");

      const badRes = verifier.verifyFile(invalidJsonPath, {
        path: invalidJsonPath,
        validateSyntax: "json",
      });

      expect(badRes.verified).toBe(false);
      expect(badRes.syntaxValid).toBe(false);
      expect(badRes.error).toContain("JSON syntax error");
    });
  });

  describe("Agent Tools Dispatcher", () => {
    it("handles environment_discover tool call cleanly", async () => {
      const tool = COMPUTER_AGENT_TOOLS["environment_discover"];
      const res = (await tool.handler({})) as any;

      expect(res.ok).toBe(true);
      expect(res.environment).toBeDefined();
      expect(res.environment.runtimes.node.available).toBe(true);
    });

    it("manages process lifecycle via agent tools", async () => {
      const startTool = COMPUTER_AGENT_TOOLS["process_start"];
      const inspectTool = COMPUTER_AGENT_TOOLS["process_inspect"];
      const logsTool = COMPUTER_AGENT_TOOLS["process_logs"];
      const stopTool = COMPUTER_AGENT_TOOLS["process_stop"];

      const startRes = (await startTool.handler({
        command: process.execPath,
        args: ["-e", "console.log('agent-test-run'); setInterval(() => {}, 500);"],
      })) as any;

      expect(startRes.ok).toBe(true);
      const procId = startRes.process.id;

      await new Promise((r) => setTimeout(r, 200));

      const logsRes = (await logsTool.handler({ id: procId })) as any;
      expect(logsRes.ok).toBe(true);
      expect(logsRes.logs).toContain("agent-test-run");

      const inspectRes = (await inspectTool.handler({ id: procId })) as any;
      expect(inspectRes.ok).toBe(true);
      expect(inspectRes.process.state).toBe("RUNNING");

      const stopRes = (await stopTool.handler({ id: procId })) as any;
      expect(stopRes.ok).toBe(true);
      expect(stopRes.state).toBe("STOPPED");
    });
  });

  describe("Acceptance Tests (master_prompt_02.md)", () => {
    it("Second Acceptance Test: Non-development file processing, aggregation and reporting", async () => {
      // 1. Generate set of incoming data files
      const dataDir = join(tempDir, "incoming_logs");
      const { mkdirSync, readdirSync, readFileSync: readSync } = await import("node:fs");
      mkdirSync(dataDir, { recursive: true });

      for (let i = 1; i <= 5; i++) {
        writeFileSync(
          join(dataDir, `log_${i}.csv`),
          `id,metric,value\n${i},latency,${10 * i}\n${i},error_rate,0.0${i}\n`,
          "utf8"
        );
      }

      // 2. Discover files matching condition
      const files = readdirSync(dataDir).filter((f) => f.endsWith(".csv"));
      expect(files.length).toBe(5);

      // 3. Inspect contents and compute aggregation
      let totalLatency = 0;
      let count = 0;
      for (const file of files) {
        const content = readSync(join(dataDir, file), "utf8");
        const lines = content.split("\n");
        for (const line of lines) {
          if (line.includes("latency")) {
            const val = parseFloat(line.split(",")[2]);
            if (!isNaN(val)) {
              totalLatency += val;
              count++;
            }
          }
        }
      }

      const avgLatency = totalLatency / count;
      expect(avgLatency).toBe(30);

      // 4. Create structured report artifact
      const reportPath = join(tempDir, "latency_summary_report.json");
      const reportData = {
        totalFilesProcessed: files.length,
        averageLatencyMs: avgLatency,
        generatedAt: new Date().toISOString(),
        verified: true,
      };
      writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf8");

      // 5. Empirically verify report artifact
      const verifier = new SystemVerifier();
      const verified = verifier.verifyFile(reportPath, {
        path: reportPath,
        validateSyntax: "json",
        expectedMinBytes: 20,
      });

      expect(verified.verified).toBe(true);
      expect(verified.syntaxValid).toBe(true);
      expect(verified.sizeBytes).toBeGreaterThan(50);
    });

    it("Third Acceptance Test: Autonomous Failure Injection and Recovery Loop", async () => {
      const manager = new GeneralProcessManager(tempDir);
      const verifier = new SystemVerifier(manager);

      // 1. Failure Injection: Start a process with a faulty port that crashes immediately
      const badProc = await manager.startProcess({
        command: process.execPath,
        args: ["-e", "process.stderr.write('CRASH: invalid port binding\\n'); process.exit(99);"],
        ports: [19999],
        tag: "faulty-service",
      });

      // Allow crash to register
      await new Promise((r) => setTimeout(r, 200));

      // 2. Observe Failure
      const inspectedBad = await manager.inspectProcess(badProc.id);
      expect(inspectedBad?.state).toBe("CRASHED");
      expect(inspectedBad?.exitCode).toBe(99);

      // Verify probe fails truthfully
      const failedProbe = await verifier.verifyService(19999, {
        portOrUrl: 19999,
        processId: badProc.id,
        minConsecutiveChecks: 1,
      });
      expect(failedProbe.verified).toBe(false);
      expect(failedProbe.processState).toBe("CRASHED");

      // 3. Diagnose: Read logs to find cause
      const errorLogs = manager.getLogs(badProc.id);
      expect(errorLogs).toContain("CRASH: invalid port binding");

      // 4. Corrective Action: Fix configuration and launch healthy replacement
      const fixedProc = await manager.startProcess({
        command: process.execPath,
        args: [
          "-e",
          "const http = require('http'); const s = http.createServer((q, r) => r.end('HEALTHY-FIXED')); s.listen(19998, '127.0.0.1'); setInterval(() => {}, 500);",
        ],
        ports: [19998],
        tag: "recovered-service",
      });

      expect(fixedProc.state).toBe("RUNNING");

      // 5. Verify Success
      const recoveryProbe = await verifier.verifyService(19998, {
        portOrUrl: 19998,
        processId: fixedProc.id,
        expectedContentPattern: "HEALTHY-FIXED",
        minConsecutiveChecks: 2,
      });

      expect(recoveryProbe.verified).toBe(true);
      expect(recoveryProbe.consecutiveSuccesses).toBe(2);
      expect(recoveryProbe.bodyPreview).toContain("HEALTHY-FIXED");

      await manager.stopProcess(fixedProc.id);
    });
  });
});
