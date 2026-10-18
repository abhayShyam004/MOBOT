// Comprehensive Unit Tests for General-Purpose Computer Agent (master_prompt_02.md)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EnvironmentDiscovery } from "./environment-discovery.ts";
import { GeneralProcessManager } from "./process-manager.ts";
import { SystemVerifier } from "./verification.ts";
import { TaskOrchestrator } from "./orchestrator.ts";
import { COMPUTER_AGENT_TOOLS } from "./agent-tools.ts";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

function testCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "latin1");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return out;
}

function testPngIhdr(width: number, height: number, colorType = 2): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, colorType, 0, 0, 0], 8);
  return ihdr;
}

/** A real, decodable PNG (RGB, filter type 0 on every scanline). */
function createTestPng(width = 120, height = 90): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) raw.set([40, 90, 200], row + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", testPngIhdr(width, height)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Corrupt PNG #1 — the IHDR chunk is over-allocated by the chunk-type length, so
 * its checksum field stays zeroed and the real checksum lands four bytes later.
 * Mirrors a hand-rolled encoder that offset the CRC by the type length.
 */
function createPngWithShiftedChecksum(width = 64, height = 64): Buffer {
  const ihdrData = testPngIhdr(width, height, 6);
  const ihdr = Buffer.alloc(12 + 4 + ihdrData.length);
  ihdr.writeUInt32BE(ihdrData.length, 0);
  Buffer.from("IHDR", "latin1").copy(ihdr, 4);
  ihdrData.copy(ihdr, 8);
  ihdr.writeUInt32BE(testCrc32(Buffer.concat([Buffer.from("IHDR", "latin1"), ihdrData])), 8 + 4 + ihdrData.length);

  const raw = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Corrupt PNG #2 — every chunk is framed as [length][checksum][type][data] with
 * the checksum placed before the chunk type. Mirrors another hand-rolled encoder.
 */
function createPngWithChecksumBeforeType(width = 64, height = 64): Buffer {
  const badChunk = (type: string, data: Buffer): Buffer => {
    const typeBytes = Buffer.from(type, "latin1");
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])), 4);
    return Buffer.concat([header, typeBytes, data]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    badChunk("IHDR", testPngIhdr(width, height, 2)),
    badChunk("IDAT", deflateSync(Buffer.alloc(height * (1 + width * 3)))),
    badChunk("IEND", Buffer.alloc(0)),
  ]);
}

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

  describe("ArtifactManager & Universal Artifact Pipeline", () => {
    function createTestPdf(): Buffer {
      return Buffer.from("%PDF-1.4\n1 0 obj\n<< /Title (Test Document) >>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    }

    it("empirically validates image artifacts (magic bytes, dimensions)", () => {
      const { ArtifactManager } = require("./artifact-manager.ts");
      const manager = new ArtifactManager();

      const png = createTestPng(200, 150);
      const res = manager.validateArtifact(png, { expectedKind: "image" });
      expect(res.valid).toBe(true);
      expect(res.kind).toBe("image");
      expect(res.mime).toBe("image/png");
      expect(res.metadata?.width).toBe(200);
      expect(res.metadata?.height).toBe(150);
    });

    it("empirically validates PDF and dataset artifacts", () => {
      const { ArtifactManager } = require("./artifact-manager.ts");
      const manager = new ArtifactManager();

      const pdf = createTestPdf();
      const pdfRes = manager.validateArtifact(pdf, { expectedKind: "pdf" });
      expect(pdfRes.valid).toBe(true);
      expect(pdfRes.kind).toBe("pdf");
      expect(pdfRes.mime).toBe("application/pdf");

      const jsonBuf = Buffer.from(JSON.stringify({ test: "data", count: 42 }));
      const jsonRes = manager.validateArtifact(jsonBuf, { originalName: "data.json", expectedKind: "dataset" });
      expect(jsonRes.valid).toBe(true);
      expect(jsonRes.kind).toBe("dataset");
    });

    it("rejects empty, corrupted, or mismatched artifacts", () => {
      const { ArtifactManager } = require("./artifact-manager.ts");
      const manager = new ArtifactManager();

      const emptyRes = manager.validateArtifact(Buffer.alloc(0));
      expect(emptyRes.valid).toBe(false);
      expect(emptyRes.error).toContain("empty");

      const textAsImage = manager.validateArtifact(Buffer.from("not a real image"), { expectedKind: "image" });
      expect(textAsImage.valid).toBe(false);
      expect(textAsImage.error).toContain("Expected artifact kind image");
    });

    it("rejects PNGs that carry the signature but have broken container framing", () => {
      const { ArtifactManager } = require("./artifact-manager.ts");
      const manager = new ArtifactManager();

      const shapes: Array<[string, Buffer]> = [
        ["checksum shifted past the chunk type", createPngWithShiftedChecksum()],
        ["checksum written before the chunk type", createPngWithChecksumBeforeType()],
      ];

      for (const [label, bytes] of shapes) {
        expect(bytes.subarray(0, 4).toString("latin1"), label).toBe("\u0089PNG");
        const res = manager.validateArtifact(bytes, { expectedKind: "image" });
        expect(res.valid, label).toBe(false);
        expect(res.kind, label).toBe("file");
        expect(res.error, label).toContain("invalid PNG image");
      }

      // the healthy fixture still validates with real dimensions
      const ok = manager.validateArtifact(createTestPng(200, 150), { expectedKind: "image" });
      expect(ok.valid).toBe(true);
      expect(ok.metadata?.width).toBe(200);
      expect(ok.metadata?.height).toBe(150);
    });

    it("refuses to register a file named like an image whose contents are not readable", () => {
      const { ArtifactManager } = require("./artifact-manager.ts");
      const manager = new ArtifactManager();

      const brokenPath = join(tempDir, "broken.png");
      writeFileSync(brokenPath, createPngWithChecksumBeforeType());
      expect(() => manager.registerArtifact(brokenPath, { name: "broken.png" })).toThrow(/Refusing to register/);

      const goodPath = join(tempDir, "good.png");
      writeFileSync(goodPath, createTestPng(120, 90));
      const record = manager.registerArtifact(goodPath, { name: "good.png" });
      expect(record.kind).toBe("image");
      expect(record.mime).toBe("image/png");
      expect(record.metadata?.width).toBe(120);
    });

    it("registers and delivers artifacts with durability and turn scoping", () => {
      const { ArtifactManager } = require("./artifact-manager.ts");
      const manager = new ArtifactManager();

      const png = createTestPng(64, 64);
      const filePath = join(tempDir, "sample.png");
      writeFileSync(filePath, png);

      const record = manager.registerArtifact(filePath, {
        name: "sample.png",
        metadata: { turnId: "turn-123", threadId: "thread-abc", title: "Test Sample" },
      });

      expect(record.id).toBeTruthy();
      expect(record.kind).toBe("image");
      expect(record.urlPath).toMatch(/^\/api\/attachments\/[a-f0-9-]+\.png$/);
      expect(record.sha256).toBeTruthy();

      const turnArtifacts = manager.getArtifactsForTurn("turn-123");
      expect(turnArtifacts.length).toBe(1);
      expect(turnArtifacts[0].id).toBe(record.id);
    });

    it("scans workspace folders for newly created artifacts across all kinds", () => {
      const { ArtifactManager } = require("./artifact-manager.ts");
      const { mkdirSync } = require("node:fs");
      const manager = new ArtifactManager();

      const downloadsDir = join(tempDir, "downloads");
      mkdirSync(downloadsDir, { recursive: true });

      const imgPath = join(downloadsDir, "chart.png");
      writeFileSync(imgPath, createTestPng(300, 200));

      const docPath = join(downloadsDir, "report.pdf");
      writeFileSync(docPath, createTestPdf());

      const discovered = manager.scanAndRegisterWorkspaceArtifacts([tempDir], {
        turnId: "turn-scan-1",
        threadId: "thread-scan-1",
      });

      expect(discovered.length).toBe(2);
      expect(discovered.some((d: any) => d.kind === "image")).toBe(true);
      expect(discovered.some((d: any) => d.kind === "pdf")).toBe(true);
    });

    it("never rediscovers already delivered artifacts on subsequent turns", () => {
      const tempDir = join(tmpdir(), `omb-artifact-turn-isolation-${Date.now()}-${Math.random()}`);
      mkdirSync(tempDir, { recursive: true });
      const { ArtifactManager } = require("./artifact-manager.ts");
      const manager = new ArtifactManager();

      const downloadsDir = join(tempDir, "downloads");
      mkdirSync(downloadsDir, { recursive: true });

      const imgPath = join(downloadsDir, "guess.png");
      writeFileSync(imgPath, createTestPng(320, 240));

      // Turn 1 discovers the file
      const turn1Discovered = manager.scanAndRegisterWorkspaceArtifacts([tempDir], {
        turnId: "turn-1",
        threadId: "thread-1",
      });
      expect(turn1Discovered.length).toBe(1);

      // Turn 2 (e.g. user says "hello" or another turn with no new files)
      const turn2Discovered = manager.scanAndRegisterWorkspaceArtifacts([tempDir], {
        turnId: "turn-2",
        threadId: "thread-1",
      });
      expect(turn2Discovered.length).toBe(0);
      expect(manager.getArtifactsForTurn("turn-2")).toEqual([]);
    });

    it("binds artifact_register results to the turn that produced them", () => {
      const { artifactsFromToolOutput } = require("./artifact-manager.ts");

      // The exact envelope the android_computer MCP tool returns: the model
      // never supplies this turn's ids, so the harness reads them back out.
      const output = JSON.stringify({
        ok: true,
        result: {
          ok: true,
          registered: true,
          artifact: {
            id: "977b36a0-2fe3-41e4-b77f-9cd2d2a6d607",
            name: "mobot-red-card.svg",
            kind: "image",
            mime: "image/svg+xml",
            urlPath: "/api/attachments/977b36a0-2fe3-41e4-b77f-9cd2d2a6d607.svg",
            localPath: "/data/user/0/com.openmausbot.companion/files/host/data/attachments/977b36a0-2fe3-41e4-b77f-9cd2d2a6d607.svg",
            visibility: "user_visible",
          },
        },
      });

      expect(artifactsFromToolOutput(output)).toEqual([
        {
          kind: "image",
          path: "/api/attachments/977b36a0-2fe3-41e4-b77f-9cd2d2a6d607.svg",
          mime: "image/svg+xml",
          name: "mobot-red-card.svg",
        },
      ]);
    });

    it("never publishes internal artifacts or non-artifact tool output", () => {
      const { artifactsFromToolOutput } = require("./artifact-manager.ts");

      const internal = JSON.stringify({
        artifact: {
          name: "make_pdf.js",
          kind: "code",
          urlPath: "/api/attachments/2b0a0000-0000-4000-8000-000000000000.js",
          visibility: "internal",
        },
      });
      expect(artifactsFromToolOutput(internal)).toEqual([]);

      const hiddenByName = JSON.stringify({
        artifact: {
          name: "pretty_pdf.js",
          kind: "code",
          urlPath: "/api/attachments/3b0a0000-0000-4000-8000-000000000000.js",
        },
      });
      expect(artifactsFromToolOutput(hiddenByName)).toEqual([]);

      expect(artifactsFromToolOutput("{\n  \"ok\": true,\n  \"bytesWritten\": 407\n}")).toEqual([]);
      expect(artifactsFromToolOutput(undefined)).toEqual([]);
      expect(artifactsFromToolOutput("not json")).toEqual([]);
    });
  });

  describe("SystemVerifier Image & Universal Verification", () => {
    it("verifyImage verifies valid images and enforces minimum dimensions", () => {
      const verifier = new SystemVerifier();
      const imgPath = join(tempDir, "test.png");
      writeFileSync(imgPath, createTestPng(160, 120));

      const ok = verifier.verifyImage(imgPath, { minBytes: 20, minWidth: 100, minHeight: 100 });
      expect(ok.verified).toBe(true);
      expect(ok.format).toBe("png");
      expect(ok.width).toBe(160);
      expect(ok.height).toBe(120);

      // Dimension failure
      const tooSmall = verifier.verifyImage(imgPath, { minWidth: 200 });
      expect(tooSmall.verified).toBe(false);
      expect(tooSmall.error).toContain("less than required minimum 200");
    });

    it("verifyImage rejects a structurally corrupt PNG instead of reporting it verified", () => {
      const verifier = new SystemVerifier();
      const imgPath = join(tempDir, "corrupt.png");
      writeFileSync(imgPath, createPngWithShiftedChecksum(512, 512));

      const res = verifier.verifyImage(imgPath, { minBytes: 20, minWidth: 512, minHeight: 512 });
      expect(res.verified).toBe(false);
      expect(res.error).toContain("invalid PNG image");
      expect(res.width).toBeUndefined();
      expect(res.height).toBeUndefined();
    });

    it("verifyArtifact verifies general files against expected kinds", () => {
      const verifier = new SystemVerifier();
      const txtPath = join(tempDir, "notes.txt");
      writeFileSync(txtPath, "Hello world, empirical notes.");

      const res = verifier.verifyArtifact(txtPath, { expectedKind: "document" });
      expect(res.valid).toBe(true);
      expect(res.kind).toBe("document");
      expect(res.mime).toBe("text/plain");
    });
  });

  describe("Computer Agent Tools Exposure", () => {
    it("exposes verify_image, verify_artifact, artifact_register, and artifact_list", async () => {
      expect(COMPUTER_AGENT_TOOLS.verify_image).toBeDefined();
      expect(COMPUTER_AGENT_TOOLS.verify_artifact).toBeDefined();
      expect(COMPUTER_AGENT_TOOLS.artifact_register).toBeDefined();
      expect(COMPUTER_AGENT_TOOLS.artifact_list).toBeDefined();

      const testFile = join(tempDir, "data.json");
      writeFileSync(testFile, JSON.stringify({ ok: true, count: 10 }));

      const registerRes = (await COMPUTER_AGENT_TOOLS.artifact_register.handler({
        path: testFile,
        name: "data.json",
        title: "Metrics Dataset",
      })) as any;

      expect(registerRes.ok).toBe(true);
      expect(registerRes.artifact.kind).toBe("dataset");

      const listRes = (await COMPUTER_AGENT_TOOLS.artifact_list.handler({ kind: "dataset" })) as any;
      expect(listRes.ok).toBe(true);
      expect(listRes.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe("General Agent Reliability Invariants", () => {
    it("system prompt enforces information boundaries (no spoilers) for guessing requests", () => {
      const { GENERAL_AGENT_RELIABILITY_PROMPT } = require("../system-prompt.ts");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("INFORMATION BOUNDARIES & GUESSING CONSTRAINTS");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("Do NOT reveal the answer, name, subject, or internal label anywhere in your reply text");
    });

    it("system prompt enforces conversational state and real tool re-execution upon rejection", () => {
      const { GENERAL_AGENT_RELIABILITY_PROMPT } = require("../system-prompt.ts");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("CONVERSATIONAL STATE & REAL RE-EXECUTION");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("NEVER just generate conversational text saying you will try again");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("You MUST immediately execute real tools with a modified query");
    });

    it("system prompt enforces clean user presentation without leaking internal tool names or paths", () => {
      const { GENERAL_AGENT_RELIABILITY_PROMPT } = require("../system-prompt.ts");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("TRUTHFUL RECOVERY & CLEAN USER PRESENTATION");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("never leak internal tool names");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("/data/data/");
    });

    it("system prompt enforces agent orchestration, structured planning, replanning, and completion criteria", () => {
      const { GENERAL_AGENT_RELIABILITY_PROMPT } = require("../system-prompt.ts");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("AGENT ORCHESTRATION & MULTI-STEP PLANNING");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("plan_create");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("plan_step_start");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("plan_step_fail");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("plan_replan");
      expect(GENERAL_AGENT_RELIABILITY_PROMPT).toContain("plan_verify_completion");
    });
  });

  describe("Agent Orchestration Layer (Multi-Step Planning, Observation, Replanning, Checkpoints, Verification)", () => {
    it("creates structured task plan with goal, ordered steps, and completion criteria", () => {
      const orchestrator = new TaskOrchestrator(tempDir);
      const plan = orchestrator.createPlan({
        goal: "Aggregate multi-source telemetry and compile verified executive report",
        steps: [
          {
            title: "Discover Environment",
            description: "Check available interpreters and disk space",
            expectedOutcome: "JSON environment report obtained",
            toolsRequired: ["environment_discover"],
          },
          {
            title: "Fetch Telemetry",
            description: "Download sensor dataset from remote endpoint",
            expectedOutcome: "Sensor dataset file saved to workspace",
            toolsRequired: ["resource_download"],
          },
          {
            title: "Compile Report",
            description: "Process records and write markdown report",
            expectedOutcome: "telemetry_summary.md created",
            toolsRequired: ["workspace_write"],
          },
        ],
        completionCriteria: [
          { description: "Dataset file exists and is valid JSON" },
          { description: "Report markdown file exists and has minimum 500 bytes" },
        ],
      });

      expect(plan.id).toMatch(/^plan_/);
      expect(plan.goal).toContain("Aggregate multi-source telemetry");
      expect(plan.status).toBe("executing");
      expect(plan.steps.length).toBe(3);
      expect(plan.steps[0].id).toBe("step_1");
      expect(plan.steps[0].status).toBe("pending");
      expect(plan.currentStepId).toBe("step_1");
      expect(plan.completionCriteria.length).toBe(2);
      expect(plan.completionCriteria[0].id).toBe("crit_1");
      expect(plan.completionCriteria[0].verified).toBe(false);
      expect(plan.revision).toBe(1);
    });

    it("transitions steps through pending -> in_progress -> completed with empirical observations", () => {
      const orchestrator = new TaskOrchestrator(tempDir);
      const plan = orchestrator.createPlan({
        goal: "Deploy microservice and verify health",
        steps: [
          {
            title: "Write Service Code",
            description: "Create server.js file",
            expectedOutcome: "server.js written to disk",
          },
          {
            title: "Start Process",
            description: "Start node background daemon",
            expectedOutcome: "Process running on port 4000",
          },
        ],
        completionCriteria: [{ description: "Service verified listening on port 4000" }],
      });
      expect(plan.id).toBeDefined();

      // Start step 1
      const startRes = orchestrator.startStep("step_1");
      expect(startRes.ok).toBe(true);
      expect(startRes.step?.status).toBe("in_progress");
      expect(startRes.step?.startedAt).toBeDefined();

      // Complete step 1 with empirical observation
      const completeRes = orchestrator.completeStep(
        "step_1",
        "Empirically observed server.js created with 482 bytes (SHA-256 abc123)",
        "server.js",
      );
      expect(completeRes.ok).toBe(true);
      expect(completeRes.step?.status).toBe("completed");
      expect(completeRes.step?.actualObservation).toContain("server.js created");
      expect(orchestrator.getActivePlan()?.currentStepId).toBe("step_2");
    });

    it("observes step failure, records error diagnosis, and pauses plan", () => {
      const orchestrator = new TaskOrchestrator(tempDir);
      orchestrator.createPlan({
        goal: "Download remote dataset",
        steps: [
          {
            title: "Download Primary Mirror",
            description: "Fetch primary mirror tarball",
            expectedOutcome: "Tarball downloaded",
          },
        ],
        completionCriteria: [{ description: "Tarball verified" }],
      });

      orchestrator.startStep("step_1");
      const failRes = orchestrator.failStep(
        "step_1",
        "HTTP request failed with status 404 Not Found from primary CDN",
        "Primary mirror is deprecated or offline",
      );

      expect(failRes.ok).toBe(true);
      expect(failRes.step?.status).toBe("failed");
      expect(failRes.step?.error).toContain("Primary mirror is deprecated");
      expect(orchestrator.getActivePlan()?.status).toBe("paused");
    });

    it("dynamically replans after failure, preserving completed steps while revising remaining steps", () => {
      const orchestrator = new TaskOrchestrator(tempDir);
      orchestrator.createPlan({
        goal: "Multi-stage data aggregation",
        steps: [
          {
            title: "Step 1: Parse Config",
            description: "Read configuration JSON",
            expectedOutcome: "Config loaded",
          },
          {
            title: "Step 2: Connect External DB",
            description: "Direct connection to PostgreSQL on port 5432",
            expectedOutcome: "Connection established",
          },
          {
            title: "Step 3: Query Records",
            description: "Fetch monthly rows",
            expectedOutcome: "Rows fetched",
          },
        ],
        completionCriteria: [{ description: "Rows aggregated" }],
      });

      // Complete step 1
      orchestrator.startStep("step_1");
      orchestrator.completeStep("step_1", "Config successfully parsed: { region: 'us-east' }");

      // Step 2 fails
      orchestrator.startStep("step_2");
      orchestrator.failStep(
        "step_2",
        "Connection refused to 127.0.0.1:5432 (ECONNREFUSED)",
        "PostgreSQL daemon not installed on this Android environment",
      );

      // Replan: replace step 2 and 3 with SQLite fallback
      const replanRes = orchestrator.replan({
        failedStepId: "step_2",
        diagnosis:
          "Target environment is Android without PostgreSQL service. Revising plan to use embedded SQLite engine.",
        updatedRemainingSteps: [
          {
            title: "Step 2-Alt: Initialize SQLite Store",
            description: "Create local SQLite database with node:sqlite",
            expectedOutcome: "SQLite db initialized",
          },
          {
            title: "Step 3-Alt: Populate & Query SQLite",
            description: "Execute SQL queries against local SQLite database",
            expectedOutcome: "Records returned successfully",
          },
        ],
      });

      expect(replanRes.ok).toBe(true);
      const updatedPlan = replanRes.plan;
      expect(updatedPlan.revision).toBe(2);
      expect(updatedPlan.replanHistory.length).toBe(1);
      expect(updatedPlan.replanHistory[0].failedStepId).toBe("step_2");
      expect(updatedPlan.replanHistory[0].reason).toContain("PostgreSQL daemon not installed");
      expect(updatedPlan.replanHistory[0].diagnosis).toContain("Target environment is Android without PostgreSQL service");
      expect(updatedPlan.replanHistory[0].preservedCompletedSteps).toEqual(["step_1"]);

      // Verify that step 1 is still completed!
      const step1 = updatedPlan.steps.find((s) => s.id === "step_1");
      expect(step1?.status).toBe("completed");

      // Verify new steps are present and active
      const altStep = updatedPlan.steps.find((s) => s.title.includes("Step 2-Alt"));
      expect(altStep).toBeDefined();
      expect(altStep?.status).toBe("pending");
      expect(updatedPlan.status).toBe("executing");
      expect(updatedPlan.currentStepId).toBe(altStep?.id);
    });

    it("enforces human approval checkpoints before executing high-impact steps", () => {
      const orchestrator = new TaskOrchestrator(tempDir);
      orchestrator.createPlan({
        goal: "Database Migration & Cleanup",
        steps: [
          {
            title: "Backup Existing Data",
            description: "Dump tables to JSON",
            expectedOutcome: "Backup file exists",
          },
          {
            title: "Drop Deprecated Tables",
            description: "DROP TABLE legacy_users",
            expectedOutcome: "Table dropped",
            requiresApproval: true,
          },
        ],
        completionCriteria: [{ description: "Migration complete and clean" }],
      });

      // Complete step 1
      orchestrator.startStep("step_1");
      orchestrator.completeStep("step_1", "Backup stored in backup.json (1,048 bytes)");

      // Attempt to start step 2 without approval: must be blocked!
      const startBlocked = orchestrator.startStep("step_2");
      expect(startBlocked.ok).toBe(false);
      expect(startBlocked.error).toContain("requires human approval");
      expect(startBlocked.step?.status).toBe("blocked");

      // Request explicit checkpoint
      const cpRes = orchestrator.requestApprovalCheckpoint(
        "step_2",
        "Execute DROP TABLE on legacy_users table",
        "Irreversible schema mutation; drops 1,500 legacy records",
        { table: "legacy_users", rowCount: 1500 },
      );
      expect(cpRes.ok).toBe(true);
      expect(cpRes.checkpoint?.action).toContain("DROP TABLE");

      // Human grants approval
      const decisionRes = orchestrator.recordApprovalDecision("step_2", true, "User confirmed backup is valid");
      expect(decisionRes.ok).toBe(true);
      expect(orchestrator.getActivePlan()?.steps.find((s) => s.id === "step_2")?.approvalStatus).toBe("approved");

      // Now start step 2 succeeds!
      const startApproved = orchestrator.startStep("step_2");
      expect(startApproved.ok).toBe(true);
      expect(startApproved.step?.status).toBe("in_progress");
    });

    it("empirically verifies completion criteria, rejecting completion until all criteria are satisfied", () => {
      const orchestrator = new TaskOrchestrator(tempDir);
      orchestrator.createPlan({
        goal: "Generate Report and Start Metrics Server",
        steps: [
          {
            title: "Generate Report",
            description: "Write executive report",
            expectedOutcome: "Report written",
          },
          {
            title: "Start Metrics Server",
            description: "Launch HTTP server",
            expectedOutcome: "Server up on port 8080",
          },
        ],
        completionCriteria: [
          { description: "Report file generated with SHA-256 and size > 100 bytes" },
          { description: "Metrics endpoint responds HTTP 200 on port 8080" },
        ],
      });

      orchestrator.startStep("step_1");
      orchestrator.completeStep("step_1", "Report created at report.md");

      // Incomplete verification: only criterion 1 evaluated, criterion 2 missing
      const partialVerify = orchestrator.verifyCompletion([
        {
          id: "crit_1",
          verified: true,
          evidence: "report.md verified: 840 bytes, SHA-256 7f9a8b...",
        },
        {
          id: "crit_2",
          verified: false,
          evidence: "Port 8080 not listening yet",
        },
      ]);

      expect(partialVerify.allVerified).toBe(false);
      expect(partialVerify.planCompleted).toBe(false);
      expect(partialVerify.pendingCriteria.length).toBe(1);
      expect(partialVerify.summary).toContain("incomplete");

      // Complete step 2
      orchestrator.startStep("step_2");
      orchestrator.completeStep("step_2", "HTTP server started on port 8080");

      // Full empirical verification: all criteria satisfied!
      const fullVerify = orchestrator.verifyCompletion([
        {
          id: "crit_1",
          verified: true,
          evidence: "report.md verified: 840 bytes, SHA-256 7f9a8b...",
        },
        {
          id: "crit_2",
          verified: true,
          evidence: "Port 8080 verified: HTTP 200 OK across 2 consecutive probes",
        },
      ]);

      expect(fullVerify.allVerified).toBe(true);
      expect(fullVerify.planCompleted).toBe(true);
      expect(fullVerify.plan.status).toBe("completed");
      expect(fullVerify.summary).toContain("successfully completed");
    });

    it("persists structured task state to disk (.mobot/task_plan.json) and reloads across restarts", () => {
      const orchestrator1 = new TaskOrchestrator(tempDir);
      orchestrator1.createPlan({
        goal: "Multi-session durable task",
        steps: [
          {
            title: "Step 1",
            description: "Initial preparation",
            expectedOutcome: "Ready",
          },
          {
            title: "Step 2",
            description: "Second stage",
            expectedOutcome: "Done",
          },
        ],
        completionCriteria: [{ description: "Durable outcome verified" }],
      });

      orchestrator1.startStep("step_1");
      orchestrator1.completeStep("step_1", "Preparation verified empirically");

      // Create new orchestrator instance pointing to same directory (simulating server reload)
      const orchestrator2 = new TaskOrchestrator(tempDir);
      const reloadedPlan = orchestrator2.getActivePlan();

      expect(reloadedPlan).toBeDefined();
      expect(reloadedPlan?.goal).toBe("Multi-session durable task");
      expect(reloadedPlan?.steps[0].status).toBe("completed");
      expect(reloadedPlan?.steps[0].actualObservation).toContain("Preparation verified");
      expect(reloadedPlan?.currentStepId).toBe("step_2");
    });

    it("executes all orchestration agent tools via COMPUTER_AGENT_TOOLS registry", async () => {
      const tools = COMPUTER_AGENT_TOOLS;

      // 1. plan_create
      const createRes = (await tools.plan_create.handler({
        goal: "Tool integration test",
        steps: [
          {
            title: "Tool Step 1",
            description: "Execute test action",
            expectedOutcome: "Action succeeded",
          },
        ],
        completionCriteria: [{ description: "Action verified" }],
        workspacePath: tempDir,
      })) as any;
      expect(createRes.ok).toBe(true);
      expect(createRes.plan.id).toBeDefined();

      // 2. plan_status
      const statusRes = (await tools.plan_status.handler({ workspacePath: tempDir })) as any;
      expect(statusRes.ok).toBe(true);
      expect(statusRes.plan.goal).toBe("Tool integration test");

      // 3. plan_step_start
      const startRes = (await tools.plan_step_start.handler({
        stepId: "step_1",
        workspacePath: tempDir,
      })) as any;
      expect(startRes.ok).toBe(true);

      // 4. plan_step_complete
      const completeRes = (await tools.plan_step_complete.handler({
        stepId: "step_1",
        observation: "Tool execution empirically confirmed",
        workspacePath: tempDir,
      })) as any;
      expect(completeRes.ok).toBe(true);

      // 5. plan_verify_completion
      const verifyRes = (await tools.plan_verify_completion.handler({
        criteria: [
          {
            id: "crit_1",
            verified: true,
            evidence: "Tool execution verified via status output",
          },
        ],
        workspacePath: tempDir,
      })) as any;
      expect(verifyRes.ok).toBe(true);
      expect(verifyRes.planCompleted).toBe(true);
    });
  });
});

