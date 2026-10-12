import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PortAllocator, PreviewSupervisor } from "./preview-supervisor.ts";

describe("PreviewSupervisor (Phase D Localhost App Preview)", () => {
  let tempDir: string;
  let supervisor: PreviewSupervisor;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mobot-preview-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    supervisor = new PreviewSupervisor();
  });

  afterEach(async () => {
    try {
      await supervisor.stopAll("test-proj");
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("PortAllocator", () => {
    it("allocates unreserved ports and prevents collisions", async () => {
      const allocator = new PortAllocator();
      const p1 = await allocator.allocate("service-1");
      const p2 = await allocator.allocate("service-2");

      expect(p1).toBeGreaterThanOrEqual(3000);
      expect(p2).toBeGreaterThanOrEqual(3000);
      expect(p1).not.toBe(p2);
      expect(p1).not.toBe(18799); // never collide with OMB server
      expect(p2).not.toBe(18799);

      allocator.release("service-1");
      allocator.release("service-2");
    });
  });

  describe("Single & Multi-Service Lifecycle", () => {
    it("starts a server, verifies listening port, and stops it cleanly", async () => {
      // Create minimal server script
      const serverScript = `
        const http = require("http");
        const port = parseInt(process.env.PORT, 10);
        const server = http.createServer((req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, status: "live" }));
        });
        server.listen(port, "127.0.0.1", () => console.log("Ready on " + port));
      `;
      writeFileSync(join(tempDir, "server.js"), serverScript);

      const state = await supervisor.startService({
        projectId: "test-proj",
        serviceName: "web",
        kind: "frontend",
        command: "node server.js",
        cwd: tempDir,
      });

      expect(state.status).toBe("running");
      expect(state.port).toBeDefined();
      expect(state.url).toContain("http://127.0.0.1:");
      expect(state.pid).toBeDefined();

      // Probe live endpoint
      const res = await fetch(`${state.url}/`);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.status).toBe("live");

      // Verify environment state
      const env = supervisor.getEnvironmentState("test-proj");
      expect(env.overall).toBe("running");
      expect(env.primaryUrl).toBe(state.url);

      // Stop service
      const stopped = await supervisor.stopService("test-proj", "web");
      expect(stopped.status).toBe("stopped");

      const envAfter = supervisor.getEnvironmentState("test-proj");
      expect(envAfter.overall).toBe("stopped");
    });

    it("tracks multiple processes independently (frontend + backend)", async () => {
      // Frontend server
      writeFileSync(
        join(tempDir, "frontend.js"),
        `
        const http = require("http");
        http.createServer((req, res) => res.end("Frontend")).listen(process.env.PORT, "127.0.0.1");
      `,
      );

      // Backend server
      writeFileSync(
        join(tempDir, "backend.js"),
        `
        const http = require("http");
        http.createServer((req, res) => res.end("Backend API")).listen(process.env.PORT, "127.0.0.1");
      `,
      );

      const frontend = await supervisor.startService({
        projectId: "test-proj",
        serviceName: "frontend",
        kind: "frontend",
        command: "node frontend.js",
        cwd: tempDir,
      });

      const backend = await supervisor.startService({
        projectId: "test-proj",
        serviceName: "backend",
        kind: "backend",
        command: "node backend.js",
        cwd: tempDir,
      });

      expect(frontend.status).toBe("running");
      expect(backend.status).toBe("running");
      expect(frontend.port).not.toBe(backend.port);

      const env = supervisor.getEnvironmentState("test-proj");
      expect(env.overall).toBe("running");
      expect(env.services.frontend.status).toBe("running");
      expect(env.services.backend.status).toBe("running");
      expect(env.primaryUrl).toBe(frontend.url);

      await supervisor.stopAll("test-proj");
    });

    it("detects process crashes honestly and updates status without hanging", async () => {
      // Crashing script
      writeFileSync(
        join(tempDir, "crash.js"),
        `
        const http = require("http");
        const s = http.createServer().listen(process.env.PORT, "127.0.0.1", () => {
          setTimeout(() => process.exit(42), 200);
        });
      `,
      );

      const state = await supervisor.startService({
        projectId: "test-proj",
        serviceName: "flaky",
        command: "node crash.js",
        cwd: tempDir,
      });

      expect(state.status).toBe("running");

      // Wait for process to exit
      await new Promise((r) => setTimeout(r, 600));

      const updated = supervisor.getServiceState("test-proj", "flaky");
      expect(updated?.status).toBe("crashed");
      expect(updated?.exitCode).toBe(42);
      expect(updated?.error).toContain("42");

      const env = supervisor.getEnvironmentState("test-proj");
      expect(env.overall).toBe("crashed");
    });
  });
});
