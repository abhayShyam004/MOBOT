import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectManager } from "./project-manager.ts";
import { APP_BUILDER_TOOLS, setProjectManager } from "./app-builder-tools.ts";

describe("App Builder Tools (Phase C MCP Tools Suite)", () => {
  let tempDir: string;
  let manager: ProjectManager;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mobot-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    manager = new ProjectManager(tempDir);
    setProjectManager(manager);
  });

  afterEach(() => {
    try {
      for (const p of manager.listProjects()) {
        manager.deleteProject(p.id);
      }
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("exposes all 28+ required tools with valid schemas", () => {
    const requiredTools = [
      "project_create",
      "project_list",
      "project_open",
      "project_read",
      "project_write",
      "project_patch",
      "project_delete",
      "project_rename",
      "build_run",
      "build_status",
      "build_logs",
      "test_run",
      "test_status",
      "test_logs",
      "preview_start",
      "preview_status",
      "preview_logs",
      "preview_stop",
      "preview_restart",
      "deployment_create",
      "deployment_status",
      "deployment_logs",
      "deployment_cancel",
      "deployment_redeploy",
      "environment_list",
      "environment_set",
      "environment_remove",
      "project_git_status",
      "project_git_init",
      "project_git_diff",
      "project_git_commit",
    ];

    for (const toolName of requiredTools) {
      expect(APP_BUILDER_TOOLS[toolName], `Tool ${toolName} must be defined`).toBeDefined();
      expect(typeof APP_BUILDER_TOOLS[toolName]?.description).toBe("string");
      expect(typeof APP_BUILDER_TOOLS[toolName]?.inputSchema).toBe("object");
      expect(typeof APP_BUILDER_TOOLS[toolName]?.handler).toBe("function");
    }
  });

  it("handles project lifecycle via tool calls", async () => {
    // 1. project_create
    const createRes = (await APP_BUILDER_TOOLS.project_create.handler({
      name: "Todo App",
      framework: "html",
    })) as any;
    expect(createRes.ok).toBe(true);
    expect(createRes.project.id).toBe("todo-app");

    // 2. project_list
    const listRes = (await APP_BUILDER_TOOLS.project_list.handler({})) as any;
    expect(listRes.ok).toBe(true);
    expect(listRes.count).toBe(1);

    // 3. project_open
    const openRes = (await APP_BUILDER_TOOLS.project_open.handler({ id: "todo-app" })) as any;
    expect(openRes.ok).toBe(true);
    expect(openRes.project.id).toBe("todo-app");
    expect(openRes.files.length).toBeGreaterThan(0);

    // 4. project_read
    const readRes = (await APP_BUILDER_TOOLS.project_read.handler({ projectId: "todo-app", path: "index.html" })) as any;
    expect(readRes.ok).toBe(true);
    expect(readRes.content).toContain("Todo App");

    // 5. project_write
    const writeRes = (await APP_BUILDER_TOOLS.project_write.handler({
      projectId: "todo-app",
      path: "notes.txt",
      content: "Task notes",
    })) as any;
    expect(writeRes.ok).toBe(true);

    // 6. project_patch
    const patchRes = (await APP_BUILDER_TOOLS.project_patch.handler({
      projectId: "todo-app",
      path: "notes.txt",
      search: "notes",
      replace: "items",
    })) as any;
    expect(patchRes.ok).toBe(true);
    expect(patchRes.replacedCount).toBe(1);

    // 7. project_git_commit
    const commitRes = (await APP_BUILDER_TOOLS.project_git_commit.handler({
      projectId: "todo-app",
      message: "feat: add notes file",
    })) as any;
    expect(commitRes.ok).toBe(true);
    expect(commitRes.commitHash).toBeDefined();

    // 8. project_git_status
    const gitStatusRes = (await APP_BUILDER_TOOLS.project_git_status.handler({
      projectId: "todo-app",
    })) as any;
    expect(gitStatusRes.ok).toBe(true);
    expect(gitStatusRes.commitHash).toBe(commitRes.commitHash);

    // 9. environment_set & environment_list
    const envSetRes = (await APP_BUILDER_TOOLS.environment_set.handler({
      projectId: "todo-app",
      key: "SECRET_KEY",
      value: "top-secret-token",
      isSecret: true,
    })) as any;
    expect(envSetRes.ok).toBe(true);

    const envListRes = (await APP_BUILDER_TOOLS.environment_list.handler({
      projectId: "todo-app",
    })) as any;
    expect(envListRes.ok).toBe(true);
    expect(envListRes.variables.length).toBe(1);
    expect(envListRes.variables[0].isSecret).toBe(true);
    expect(envListRes.variables[0].value).toBeUndefined();

    // 10. build_run & build_status
    const buildRes = (await APP_BUILDER_TOOLS.build_run.handler({
      projectId: "todo-app",
    })) as any;
    expect(buildRes.ok).toBe(true);

    const buildStatusRes = (await APP_BUILDER_TOOLS.build_status.handler({
      projectId: "todo-app",
    })) as any;
    expect(buildStatusRes.ok).toBe(true);

    // 11. test_run & test_status
    const testRes = (await APP_BUILDER_TOOLS.test_run.handler({
      projectId: "todo-app",
    })) as any;
    expect(testRes.ok).toBe(true);

    // 12. preview_start, preview_status, preview_stop
    const previewStartRes = (await APP_BUILDER_TOOLS.preview_start.handler({
      projectId: "todo-app",
    })) as any;
    expect(previewStartRes.ok).toBe(true);
    expect(previewStartRes.preview.status).toBe("running");

    const previewStatusRes = (await APP_BUILDER_TOOLS.preview_status.handler({
      projectId: "todo-app",
    })) as any;
    expect(previewStatusRes.ok).toBe(true);
    expect(previewStatusRes.preview.status).toBe("running");

    const previewStopRes = (await APP_BUILDER_TOOLS.preview_stop.handler({
      projectId: "todo-app",
    })) as any;
    expect(previewStopRes.ok).toBe(true);
    expect(previewStopRes.preview.status).toBe("stopped");

    // 13. deployment_create & deployment_status
    const deployRes = (await APP_BUILDER_TOOLS.deployment_create.handler({
      projectId: "todo-app",
      provider: "vercel",
    })) as any;
    expect(deployRes.ok).toBe(true);
    expect(deployRes.deployment.status).toBe("building");

    const deployStatusRes = (await APP_BUILDER_TOOLS.deployment_status.handler({
      projectId: "todo-app",
    })) as any;
    expect(deployStatusRes.ok).toBe(true);

    // 14. project_rename
    const renameRes = (await APP_BUILDER_TOOLS.project_rename.handler({
      id: "todo-app",
      newName: "Todo Master",
    })) as any;
    expect(renameRes.ok).toBe(true);
    expect(renameRes.name).toBe("Todo Master");

    // 15. project_delete
    const deleteRes = (await APP_BUILDER_TOOLS.project_delete.handler({
      id: "todo-app",
      confirm: true,
    })) as any;
    expect(deleteRes.ok).toBe(true);
  });
});
