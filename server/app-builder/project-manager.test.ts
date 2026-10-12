import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectManager } from "./project-manager.ts";

describe("ProjectManager (Phase C Full-Stack App Builder)", () => {
  let tempDir: string;
  let manager: ProjectManager;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mobot-test-projects-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    manager = new ProjectManager(tempDir);
  });

  afterEach(() => {
    try {
      // Ensure any running previews are killed
      for (const p of manager.listProjects()) {
        manager.deleteProject(p.id);
      }
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Project Creation & Templates", () => {
    it("creates a default HTML project with working starter files", () => {
      const project = manager.createProject({
        name: "Job Tracker",
        framework: "html",
      });

      expect(project.id).toBe("job-tracker");
      expect(project.name).toBe("Job Tracker");
      expect(project.framework).toBe("html");
      expect(project.state).toBe("draft");
      expect(project.git.initialized).toBe(true);

      const files = manager.listProjectFiles(project.id);
      const filePaths = files.map((f) => f.path);
      expect(filePaths).toContain("index.html");
      expect(filePaths).toContain("style.css");
      expect(filePaths).toContain("app.js");
      expect(filePaths).toContain("server.js");
      expect(filePaths).toContain("package.json");
    });

    it("creates projects for all supported framework targets", () => {
      const frameworks = ["html", "nodejs", "react", "nextjs", "fullstack"] as const;

      for (const fw of frameworks) {
        const p = manager.createProject({
          name: `App ${fw}`,
          id: `app-${fw}`,
          framework: fw,
        });
        expect(p.framework).toBe(fw);
        expect(manager.getProject(p.id)).not.toBeNull();
      }

      const list = manager.listProjects();
      expect(list.length).toBe(frameworks.length);
    });

    it("refuses duplicate project IDs", () => {
      manager.createProject({ name: "Same Name", id: "unique-slug" });
      expect(() => {
        manager.createProject({ name: "Same Name", id: "unique-slug" });
      }).toThrow(/already exists/);
    });

    it("renames and deletes projects cleanly", () => {
      manager.createProject({ name: "Old Name", id: "rename-test" });
      const renamed = manager.renameProject("rename-test", "New Name");
      expect(renamed.name).toBe("New Name");

      const deleted = manager.deleteProject("rename-test");
      expect(deleted).toBe(true);
      expect(manager.getProject("rename-test")).toBeNull();
    });
  });

  describe("Contained File Operations & Path Traversal Guard", () => {
    it("reads, writes, and patches files inside the project workspace", () => {
      manager.createProject({ name: "File Test", id: "file-test" });

      const writeRes = manager.writeFile("file-test", "src/hello.txt", "Hello World");
      expect(writeRes.bytesWritten).toBe(11);

      const readRes = manager.readFile("file-test", "src/hello.txt");
      expect(readRes.content).toBe("Hello World");

      const patchRes = manager.patchFile("file-test", "src/hello.txt", "World", "Antigravity");
      expect(patchRes.replacedCount).toBe(1);

      const readAfter = manager.readFile("file-test", "src/hello.txt");
      expect(readAfter.content).toBe("Hello Antigravity");
    });

    it("blocks directory traversal attempts (.. escapes)", () => {
      manager.createProject({ name: "Escape Test", id: "escape-test" });

      expect(() => {
        manager.readFile("escape-test", "../../etc/passwd");
      }).toThrow();

      expect(() => {
        manager.writeFile("escape-test", "../sibling.txt", "malicious");
      }).toThrow();
    });
  });

  describe("Environment Variables & Secrets Masking", () => {
    it("stores safe variables in .env and secret values in mode 0600 .env.local", () => {
      manager.createProject({ name: "Env Test", id: "env-test" });

      manager.setEnvVar("env-test", "APP_ENV", "production", false, "Environment name");
      manager.setEnvVar("env-test", "DB_SECRET", "super-secret-pw-123", true, "Database password");

      const list = manager.listEnvVars("env-test");
      expect(list.length).toBe(2);

      const dbMeta = list.find((e) => e.key === "DB_SECRET");
      expect(dbMeta).toBeDefined();
      expect(dbMeta?.isSecret).toBe(true);
      // Ensure the metadata record NEVER contains the secret value!
      expect((dbMeta as any).value).toBeUndefined();

      // Check filesystem storage
      const projectDir = manager.getProjectDir("env-test");
      const publicEnv = readFileSync(join(projectDir, ".env"), "utf8");
      expect(publicEnv).toContain('APP_ENV="production"');
      expect(publicEnv).not.toContain("super-secret-pw-123");

      const secretEnvPath = join(projectDir, ".env.local");
      const secretEnv = readFileSync(secretEnvPath, "utf8");
      expect(secretEnv).toContain('DB_SECRET="super-secret-pw-123"');

      // Verify restricted permissions on secret file
      if (process.platform !== "win32") {
        const mode = statSync(secretEnvPath).mode & 0o777;
        expect(mode).toBe(0o600);
      }

      // Removing environment variable
      manager.removeEnvVar("env-test", "APP_ENV");
      const afterList = manager.listEnvVars("env-test");
      expect(afterList.length).toBe(1);
    });
  });

  describe("Git Operations", () => {
    it("tracks commits, status, and history", () => {
      manager.createProject({ name: "Git App", id: "git-app", initGit: true });

      const status = manager.gitStatus("git-app");
      expect(status.initialized).toBe(true);
      expect(status.branch).toBe("main");

      const commit = manager.gitCommit("git-app", "feat: initial commit of job tracker");
      expect(commit.commitHash).toBeDefined();
      expect(commit.commitHash.length).toBe(40);

      const statusAfter = manager.gitStatus("git-app");
      expect(statusAfter.commitHash).toBe(commit.commitHash);
      expect(statusAfter.lastCommitMessage).toBe("feat: initial commit of job tracker");
    });
  });

  describe("Build & Test Execution", () => {
    it("executes build commands and records logs and status", async () => {
      manager.createProject({ name: "Build App", id: "build-app", framework: "html" });

      const result = await manager.runBuild("build-app", "node -e \"console.log('Testing build step'); process.exit(0);\"");
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("Testing build step");

      const status = manager.getBuildStatus("build-app");
      expect(status.state).toBe("ready");
      expect(status.hasLogs).toBe(true);

      const logs = manager.getBuildLogs("build-app");
      expect(logs).toContain("Testing build step");
    });

    it("executes test commands and records test logs", async () => {
      manager.createProject({ name: "Test App", id: "test-app", framework: "html" });

      const result = await manager.runTest("test-app", "node test.js");
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("All static app tests passed");

      const status = manager.getTestStatus("test-app");
      expect(status.hasLogs).toBe(true);
      expect(status.lastTestSuccess).toBe(true);
    });
  });

  describe("Localhost Preview Lifecycle", () => {
    it("starts, inspects, and stops a local preview development server", async () => {
      manager.createProject({ name: "Preview App", id: "preview-app", framework: "html" });

      const preview = await manager.startPreview("preview-app");
      expect(preview.status).toBe("running");
      expect(preview.detailedState).toBe("Running");
      expect(preview.port).toBeGreaterThanOrEqual(3000);
      expect(preview.url).toContain("http://127.0.0.1:");
      expect(preview.pid).toBeDefined();
      expect(preview.health?.ok).toBe(true);
      expect(preview.health?.consecutiveChecks).toBe(2);

      const currentStatus = manager.getPreviewStatus("preview-app");
      expect(currentStatus.status).toBe("running");

      // Verify server is actually listening and answering HTTP GET
      const res = await fetch(`${preview.url}/api/health`);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);

      const stopped = await manager.stopPreview("preview-app");
      expect(stopped.status).toBe("stopped");
      expect(stopped.detailedState).toBe("Stopped");
    });

    it("detects immediate process crashes and captures stderr/stdout without falsely claiming running", async () => {
      manager.createProject({ name: "Crashing App", id: "crashing-app", framework: "html" });

      // Override startCommand to a command that crashes immediately with an exit code and error message
      await expect(
        manager.startPreview(
          "crashing-app",
          'node -e "console.error(\\"FATAL: simulated startup failure\\"); process.exit(1);"',
        ),
      ).rejects.toThrow(/startup failed|crashed/i);

      const status = manager.getPreviewStatus("crashing-app");
      expect(["crashed", "startup_failed"]).toContain(status.status);
      expect(status.error).toContain("startup failure");

      const logs = manager.getPreviewLogs("crashing-app");
      expect(logs).toContain("FATAL: simulated startup failure");
    });

    it("allocates an alternate port when the default port is already occupied", async () => {
      manager.createProject({ name: "App One", id: "app-one", framework: "html" });
      manager.createProject({ name: "App Two", id: "app-two", framework: "html" });

      const p1 = await manager.startPreview("app-one");
      expect(p1.status).toBe("running");

      // App Two should auto-allocate a different port
      const p2 = await manager.startPreview("app-two");
      expect(p2.status).toBe("running");
      expect(p2.port).not.toBe(p1.port);

      await manager.stopPreview("app-one");
      await manager.stopPreview("app-two");
    });
  });
});
