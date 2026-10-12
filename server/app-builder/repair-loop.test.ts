import { describe, expect, it } from "vitest";
import { AutonomousRepairLoop } from "./repair-loop.ts";
import { ProjectManager } from "./project-manager.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AutonomousRepairLoop (Phase E Build/Test/Fix Loop)", () => {
  const createTempManager = () => {
    const dir = mkdtempSync(join(tmpdir(), "moblot-repair-test-"));
    const mgr = new ProjectManager(dir);
    return { dir, mgr };
  };

  describe("Failure Classification", () => {
    it("classifies syntax errors and extracts target file and line number", () => {
      const { dir, mgr } = createTempManager();
      try {
        const loop = new AutonomousRepairLoop(mgr);
        const stderr = "/app/routes/api.js:42\n  const x = ;\n            ^\nSyntaxError: Unexpected token ';'";
        const analysis = loop.classifyFailure("", stderr);

        expect(analysis.failureClass).toBe("syntax_error");
        expect(analysis.isAutoFixable).toBe(true);
        expect(analysis.targetFile).toBe("/app/routes/api.js");
        expect(analysis.lineNumber).toBe(42);
        expect(analysis.summary).toContain("Syntax error");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("classifies TypeScript typecheck errors with error codes", () => {
      const { dir, mgr } = createTempManager();
      try {
        const loop = new AutonomousRepairLoop(mgr);
        const stdout = "src/components/Card.tsx:15:3 - error TS2322: Type 'string' is not assignable to type 'number'.";
        const analysis = loop.classifyFailure(stdout, "");

        expect(analysis.failureClass).toBe("typecheck_error");
        expect(analysis.isAutoFixable).toBe(true);
        expect(analysis.targetFile).toBe("src/components/Card.tsx");
        expect(analysis.lineNumber).toBe(15);
        expect(analysis.summary).toContain("TS2322");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("classifies missing module import errors", () => {
      const { dir, mgr } = createTempManager();
      try {
        const loop = new AutonomousRepairLoop(mgr);
        const stderr = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './utils/helper' imported from /app/index.js";
        const analysis = loop.classifyFailure("", stderr);

        expect(analysis.failureClass).toBe("missing_module");
        expect(analysis.isAutoFixable).toBe(true);
        expect(analysis.summary).toContain("./utils/helper");
        expect(analysis.recommendedAction).toContain("./utils/helper");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("classifies test assertion failures", () => {
      const { dir, mgr } = createTempManager();
      try {
        const loop = new AutonomousRepairLoop(mgr);
        const stdout = "FAIL tests/api.test.js\n  AssertionError: Expected 200 to equal 404";
        const analysis = loop.classifyFailure(stdout, "");

        expect(analysis.failureClass).toBe("test_assertion");
        expect(analysis.isAutoFixable).toBe(true);
        expect(analysis.summary).toContain("AssertionError");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("identifies ambiguous requirements and missing credentials as requiring user escalation", () => {
      const { dir, mgr } = createTempManager();
      try {
        const loop = new AutonomousRepairLoop(mgr);
        const stderr = "Error: Missing API_KEY environment variable. Authentication required to connect to OpenAI.";
        const analysis = loop.classifyFailure("", stderr);

        expect(analysis.failureClass).toBe("ambiguous_or_product_decision");
        expect(analysis.isAutoFixable).toBe(false);
        expect(analysis.userDecisionPrompt).toBeDefined();
        expect(analysis.userDecisionOptions).toBeInstanceOf(Array);
        expect(analysis.userDecisionOptions?.length).toBeGreaterThan(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("Bounded Autonomous Cycles", () => {
    it("completes cleanly when build and test pass on first attempt", async () => {
      const { dir, mgr } = createTempManager();
      try {
        const project = mgr.createProject({ name: "Happy App", framework: "html" });
        const loop = new AutonomousRepairLoop(mgr, 3);

        const result = await loop.runAutonomousCycle(project.id);
        expect(result.success).toBe(true);
        expect(result.attemptsUsed).toBe(1);
        expect(result.finalStage).toBe("user_review");
        expect(result.lastSuccessfulStage).toBe("preview");
        expect(result.requiresUser).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("stops and escalates to user when maximum retries (3) are exceeded", async () => {
      const { dir, mgr } = createTempManager();
      try {
        const project = mgr.createProject({
          name: "Broken App",
          framework: "nodejs",
        });
        // Intentionally introduce broken build command
        project.buildCommand = "node -e 'process.exit(1)'";
        mgr.saveProjectRecord(project);

        const loop = new AutonomousRepairLoop(mgr, 3);
        const result = await loop.runAutonomousCycle(project.id);

        expect(result.success).toBe(false);
        expect(result.attemptsUsed).toBe(3);
        expect(result.maxAttempts).toBe(3);
        expect(result.requiresUser).toBe(true);
        expect(result.history.length).toBe(3);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("recovers and advances to success when auto-fix resolves the error", async () => {
      const { dir, mgr } = createTempManager();
      try {
        const project = mgr.createProject({
          name: "Recoverable App",
          framework: "nodejs",
        });
        // Set broken build command initially
        project.buildCommand = "node -e 'process.exit(1)'";
        mgr.saveProjectRecord(project);

        const loop = new AutonomousRepairLoop(mgr, 3);
        let fixed = false;

        const result = await loop.runAutonomousCycle(project.id, async (_analysis, _state) => {
          if (!fixed) {
            fixed = true;
            // Fix the broken command
            project.buildCommand = "node -e 'console.log(\"Build fixed!\")'";
            mgr.saveProjectRecord(project);
            return true;
          }
          return false;
        });

        expect(result.success).toBe(true);
        expect(result.attemptsUsed).toBe(2);
        expect(result.finalStage).toBe("user_review");
        expect(result.lastSuccessfulStage).toBe("preview");
        expect(result.requiresUser).toBe(false);
        expect(result.history.some((h) => h.stage === "fix" && h.successful)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
