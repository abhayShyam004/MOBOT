// App Builder MCP Tools for Phase C — Full-Stack App Builder.
//
// Exposes the complete suite of project workspaces, file manipulation, build/test,
// local preview, environment variable secrets, and version control tools to AI models
// running on the phone.

import { ProjectManager } from "./project-manager.ts";
import { AutonomousRepairLoop } from "./repair-loop.ts";
import { DeploymentManager } from "../deploy/deployment-manager.ts";
import type { DeploymentProviderId, ProjectFramework } from "./types.ts";
import { sharedObservability } from "../capabilities/observability.ts";

export interface ToolSpec {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> | unknown;
}

let sharedManager: ProjectManager | null = null;
let sharedRepairLoop: AutonomousRepairLoop | null = null;
let sharedDeploymentManager: DeploymentManager | null = null;

export function getProjectManager(): ProjectManager {
  if (!sharedManager) {
    sharedManager = new ProjectManager();
  }
  return sharedManager;
}

export function setProjectManager(manager: ProjectManager): void {
  sharedManager = manager;
  sharedRepairLoop = new AutonomousRepairLoop(manager);
  sharedDeploymentManager = new DeploymentManager(undefined, undefined, manager);
}

export function getRepairLoop(): AutonomousRepairLoop {
  if (!sharedRepairLoop) {
    sharedRepairLoop = new AutonomousRepairLoop(getProjectManager());
  }
  return sharedRepairLoop;
}

export function getDeploymentManager(): DeploymentManager {
  if (!sharedDeploymentManager) {
    sharedDeploymentManager = new DeploymentManager(undefined, undefined, getProjectManager());
  }
  return sharedDeploymentManager;
}

export function setDeploymentManager(manager: DeploymentManager): void {
  sharedDeploymentManager = manager;
}

function toolError(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export const APP_BUILDER_TOOLS: Record<string, ToolSpec> = {
  project_create: {
    description:
      "Create a new full-stack application project workspace. Generates an isolated environment with starter files, git repository, and configuration.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name of the application (e.g. 'Job Application Tracker')" },
        id: { type: "string", description: "Optional project slug (defaults to name slugified)" },
        description: { type: "string", description: "Short description of the application and its purpose" },
        framework: {
          type: "string",
          enum: ["html", "nodejs", "react", "nextjs", "fullstack"],
          description: "Framework stack. 'html' is zero-dependency instant startup, 'nodejs' is REST API + SQLite, 'react' is Vite+TS",
        },
        template: { type: "string", enum: ["html", "nodejs", "react", "nextjs", "fullstack"] },
        initGit: { type: "boolean", description: "Initialize git repository (default true)" },
      },
      required: ["name"],
    },
    handler: (args) => {
      try {
        const mgr = getProjectManager();
        const name = String(args.name || "").trim();
        if (!name) return toolError("name is required");
        const record = mgr.createProject({
          name,
          id: args.id ? String(args.id).trim() : undefined,
          description: args.description ? String(args.description).trim() : undefined,
          framework: (args.framework || args.template || "html") as ProjectFramework,
          template: (args.template || args.framework || "html") as ProjectFramework,
          initGit: args.initGit !== false,
        });
        sharedObservability.emit("APP_PROJECT_CREATED", {
          projectId: record.id,
          projectName: record.name,
          framework: record.framework,
          gitInitialized: record.git.initialized,
        });
        return {
          ok: true,
          project: record,
          message: `Created project "${record.name}" (${record.id}) with framework ${record.framework}`,
        };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_list: {
    description: "List all existing application projects on this device, along with their status, framework, and preview state.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: () => {
      try {
        const mgr = getProjectManager();
        const projects = mgr.listProjects();
        return {
          ok: true,
          count: projects.length,
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            framework: p.framework,
            state: p.state,
            preview: p.preview,
            updatedAt: p.updatedAt,
          })),
        };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_open: {
    description: "Retrieve complete details, file listing, and state of an existing project by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project ID" },
      },
      required: ["id"],
    },
    handler: (args) => {
      try {
        const id = String(args.id || "").trim();
        if (!id) return toolError("id is required");
        const mgr = getProjectManager();
        const project = mgr.getProject(id);
        if (!project) return toolError(`Project "${id}" not found`);
        const files = mgr.listProjectFiles(id);
        return {
          ok: true,
          project,
          files,
        };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_read: {
    description: "Read the contents of a file within a project workspace. Bounded and protected against path traversal.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        path: { type: "string", description: "Relative file path within project" },
        encoding: { type: "string", enum: ["utf8", "base64"], description: "Encoding (default utf8)" },
      },
      required: ["projectId", "path"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        const path = String(args.path || "").trim();
        if (!projectId || !path) return toolError("projectId and path are required");
        const mgr = getProjectManager();
        const res = mgr.readFile(projectId, path, args.encoding === "base64" ? "base64" : "utf8");
        return { ok: true, projectId, path, bytes: res.bytes, content: res.content };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_write: {
    description: "Write (create or overwrite) a file inside a project workspace. Performs atomic write and containment validation.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        path: { type: "string", description: "Relative file path within project" },
        content: { type: "string", description: "File content to write" },
        encoding: { type: "string", enum: ["utf8", "base64"] },
      },
      required: ["projectId", "path", "content"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        const path = String(args.path || "").trim();
        const content = typeof args.content === "string" ? args.content : "";
        if (!projectId || !path) return toolError("projectId and path are required");
        const mgr = getProjectManager();
        const res = mgr.writeFile(projectId, path, content, args.encoding === "base64" ? "base64" : "utf8");
        return { ok: true, projectId, path, bytesWritten: res.bytesWritten };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_patch: {
    description: "Patch an existing file inside a project by finding a specific search string and replacing it.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        path: { type: "string", description: "Relative file path within project" },
        search: { type: "string", description: "Exact text substring to search for" },
        replace: { type: "string", description: "Replacement text" },
      },
      required: ["projectId", "path", "search", "replace"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        const path = String(args.path || "").trim();
        const search = String(args.search ?? "");
        const replace = String(args.replace ?? "");
        if (!projectId || !path || !search) return toolError("projectId, path, and search string are required");
        const mgr = getProjectManager();
        const res = mgr.patchFile(projectId, path, search, replace);
        return { ok: true, projectId, path, replacedCount: res.replacedCount };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_delete: {
    description: "Delete an entire project workspace and all its files. Stops any running preview first.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project ID to delete" },
        confirm: { type: "boolean", description: "Explicit confirmation flag" },
      },
      required: ["id", "confirm"],
    },
    handler: (args) => {
      try {
        const id = String(args.id || "").trim();
        if (!id) return toolError("id is required");
        if (args.confirm !== true) return toolError("Explicit confirm: true is required to delete a project");
        const mgr = getProjectManager();
        const ok = mgr.deleteProject(id);
        if (ok) {
          sharedObservability.emit("APP_PROJECT_DELETED", { projectId: id });
        }
        return { ok, id, message: ok ? `Project "${id}" deleted.` : `Project "${id}" did not exist.` };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_rename: {
    description: "Rename a project's display name.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project ID" },
        newName: { type: "string", description: "New display name" },
      },
      required: ["id", "newName"],
    },
    handler: (args) => {
      try {
        const id = String(args.id || "").trim();
        const newName = String(args.newName || "").trim();
        if (!id || !newName) return toolError("id and newName are required");
        const mgr = getProjectManager();
        const res = mgr.renameProject(id, newName);
        return { ok: true, id, name: res.name };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  build_run: {
    description: "Execute a project build command within the project workspace. Records stdout, stderr, exit code and duration.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        command: { type: "string", description: "Optional custom build command override" },
        timeoutMs: { type: "integer", description: "Timeout in milliseconds (default 60000)" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        sharedObservability.emit("APP_BUILD_STARTED", { projectId, command: args.command });
        const mgr = getProjectManager();
        const res = await mgr.runBuild(
          projectId,
          args.command ? String(args.command) : undefined,
          typeof args.timeoutMs === "number" ? args.timeoutMs : 60_000,
        );
        if (res.ok) {
          sharedObservability.emit("APP_BUILD_SUCCEEDED", { projectId, durationMs: res.durationMs });
        } else {
          sharedObservability.emit("APP_BUILD_FAILED", { projectId, exitCode: res.exitCode, error: res.error || res.stderr });
        }
        return { projectId, ...res };
      } catch (err: any) {
        sharedObservability.emit("APP_BUILD_FAILED", { projectId: String(args.projectId || ""), error: err.message });
        return toolError(err.message);
      }
    },
  },

  build_status: {
    description: "Get the latest build status, last build timestamp, and logs availability for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const status = mgr.getBuildStatus(projectId);
        return { ok: true, projectId, ...status };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  build_logs: {
    description: "Retrieve build logs for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        lines: { type: "integer", description: "Max lines to return (default 100)" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const logs = mgr.getBuildLogs(projectId, typeof args.lines === "number" ? args.lines : 100);
        return { ok: true, projectId, logs };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  test_run: {
    description: "Run automated tests for a project workspace. Captures results and test output.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        command: { type: "string", description: "Optional test command override" },
        timeoutMs: { type: "integer", description: "Timeout in milliseconds" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        sharedObservability.emit("APP_TEST_STARTED", { projectId, command: args.command });
        const mgr = getProjectManager();
        const res = await mgr.runTest(
          projectId,
          args.command ? String(args.command) : undefined,
          typeof args.timeoutMs === "number" ? args.timeoutMs : 60_000,
        );
        if (res.ok) {
          sharedObservability.emit("APP_TEST_SUCCEEDED", { projectId, durationMs: res.durationMs, passed: res.passed, failed: res.failed });
        } else {
          sharedObservability.emit("APP_TEST_FAILED", { projectId, exitCode: res.exitCode, error: res.error || res.stderr });
        }
        return { projectId, ...res };
      } catch (err: any) {
        sharedObservability.emit("APP_TEST_FAILED", { projectId: String(args.projectId || ""), error: err.message });
        return toolError(err.message);
      }
    },
  },

  test_status: {
    description: "Get the latest test execution status and timestamp for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const status = mgr.getTestStatus(projectId);
        return { ok: true, projectId, ...status };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  test_logs: {
    description: "Retrieve test execution output logs for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        lines: { type: "integer", description: "Max lines to return (default 100)" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const logs = mgr.getTestLogs(projectId, typeof args.lines === "number" ? args.lines : 100);
        return { ok: true, projectId, logs };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  preview_start: {
    description:
      "Start a local development server for the project on an allocated loopback port. Returns the live preview URL (e.g. http://127.0.0.1:3000).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        command: { type: "string", description: "Optional start command override" },
        port: { type: "integer", description: "Requested port (optional, auto-allocated if omitted)" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const preview = await mgr.startPreview(
          projectId,
          args.command ? String(args.command) : undefined,
          typeof args.port === "number" ? args.port : undefined,
        );
        if (preview.status === "running") {
          sharedObservability.emit("APP_PREVIEW_STARTED", { projectId, port: preview.port, url: preview.url });
          return {
            ok: true,
            projectId,
            preview,
            message: `Preview verified and running at ${preview.url} (Port: ${preview.port}, PID: ${preview.pid})`,
          };
        } else {
          sharedObservability.emit("APP_PREVIEW_FAILED", { projectId, error: preview.error });
          return {
            ok: false,
            projectId,
            preview,
            error: preview.error || `Preview server failed to start (status: ${preview.status})`,
          };
        }
      } catch (err: any) {
        sharedObservability.emit("APP_PREVIEW_FAILED", { projectId: String(args.projectId || ""), error: err.message });
        return toolError(err.message);
      }
    },
  },

  preview_status: {
    description: "Inspect the status of a project's local preview server (running, stopped, crashed, listening port, and URL).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const preview = mgr.getPreviewStatus(projectId);
        return { ok: true, projectId, preview };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  preview_logs: {
    description: "Read console stdout/stderr logs from the running or crashed local preview server.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        lines: { type: "integer", description: "Max lines to return (default 100)" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const logs = mgr.getPreviewLogs(projectId, typeof args.lines === "number" ? args.lines : 100);
        return { ok: true, projectId, logs };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  preview_stop: {
    description: "Stop a project's running local preview server.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const preview = await mgr.stopPreview(projectId);
        sharedObservability.emit("APP_PREVIEW_STOPPED", { projectId });
        return { ok: true, projectId, preview };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  preview_restart: {
    description: "Restart a project's local preview server.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const preview = await mgr.restartPreview(projectId);
        return { ok: true, projectId, preview };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  deployment_create: {
    description: "Initiate deployment of a project to a hosting provider (Vercel, Render).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        provider: { type: "string", enum: ["vercel", "render", "custom"], description: "Deployment provider" },
        environment: { type: "string", enum: ["preview", "production"], description: "Target environment" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const provider = ((args.provider as string) || "vercel") as DeploymentProviderId;
        const environment = args.environment === "production" ? "production" : "preview";
        const mgr = getProjectManager();
        const project = mgr.getProject(projectId);
        if (!project) return toolError(`Project "${projectId}" not found.`);

        sharedObservability.emit("APP_DEPLOYMENT_STARTED", { projectId, provider, environment });
        const deployMgr = getDeploymentManager();
        if ((provider === "vercel" || provider === "render") && deployMgr.credentialStore.getRawToken(provider)) {
          const record = await deployMgr.deploy(provider, {
            projectId: project.id,
            projectName: project.name,
            target: environment,
          });
          if (record.status !== "error") {
            sharedObservability.emit("APP_DEPLOYMENT_SUCCEEDED", { projectId, provider, environment, url: record.url, deploymentId: record.id });
          } else {
            sharedObservability.emit("APP_DEPLOYMENT_FAILED", { projectId, provider, environment, error: record.error });
          }
          return { ok: record.status !== "error", projectId, deployment: project.deployment, error: record.error };
        } else {
          const deployment = await mgr.createDeployment(projectId, provider, environment);
          sharedObservability.emit("APP_DEPLOYMENT_SUCCEEDED", { projectId, provider, environment, deploymentId: deployment.deploymentId });
          return { ok: true, projectId, deployment };
        }
      } catch (err: any) {
        sharedObservability.emit("APP_DEPLOYMENT_FAILED", { projectId: String(args.projectId || ""), error: err.message });
        return toolError(err.message);
      }
    },
  },

  deployment_status: {
    description: "Check the status of an ongoing or completed deployment.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const project = mgr.getProject(projectId);
        if (!project) return toolError(`Project "${projectId}" not found.`);

        const deployMgr = getDeploymentManager();
        if (
          project.deployment.deploymentId &&
          (project.deployment.provider === "vercel" || project.deployment.provider === "render")
        ) {
          try {
            const status = await deployMgr.getStatus(project.deployment.provider, project.deployment.deploymentId);
            project.deployment.status = status.status;
            if (status.url) project.deployment.url = status.url;
            if (status.error) project.deployment.error = status.error;
            mgr.saveProjectRecord(project);
          } catch {
            // retain existing status if provider polling fails temporarily
          }
        }
        return { ok: true, projectId, deployment: project.deployment };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  deployment_logs: {
    description: "Read deployment logs from the deployment provider.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        maxLines: { type: "number", description: "Maximum lines of logs to retrieve (default 50)" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const project = mgr.getProject(projectId);
        if (!project) return toolError(`Project "${projectId}" not found.`);

        const deployMgr = getDeploymentManager();
        let logs: string;
        const maxLines = typeof args.maxLines === "number" ? Math.min(args.maxLines, 100) : 50;
        if (
          project.deployment.deploymentId &&
          (project.deployment.provider === "vercel" || project.deployment.provider === "render")
        ) {
          try {
            logs = await deployMgr.getLogs(project.deployment.provider, project.deployment.deploymentId, maxLines);
          } catch (err: any) {
            logs = `Failed to retrieve provider logs: ${err.message}`;
          }
        } else {
          logs = mgr.getDeploymentLogs(projectId);
        }
        return { ok: true, projectId, logs };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  deployment_cancel: {
    description: "Cancel an in-progress deployment.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const project = mgr.getProject(projectId);
        if (!project) return toolError(`Project "${projectId}" not found.`);

        const deployMgr = getDeploymentManager();
        if (
          project.deployment.deploymentId &&
          (project.deployment.provider === "vercel" || project.deployment.provider === "render")
        ) {
          try {
            await deployMgr.cancel(project.deployment.provider, project.deployment.deploymentId);
          } catch {}
        }
        project.deployment.status = "cancelled";
        mgr.saveProjectRecord(project);
        return { ok: true, projectId, deployment: project.deployment };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  deployment_redeploy: {
    description: "Trigger a redeploy of the latest project code.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const project = mgr.getProject(projectId);
        if (!project) return toolError(`Project "${projectId}" not found.`);

        const deployMgr = getDeploymentManager();
        const provider = project.deployment.provider || "vercel";
        if (provider === "vercel" || provider === "render") {
          const record = await deployMgr.deploy(provider, {
            projectId: project.id,
            projectName: project.name,
            target: "preview",
          });
          return { ok: record.status !== "error", projectId, deployment: project.deployment, error: record.error };
        } else {
          const deployment = await mgr.createDeployment(projectId);
          return { ok: true, projectId, deployment };
        }
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  environment_list: {
    description: "List environment variables metadata for a project. Values marked as secrets are never exposed in plaintext.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const env = mgr.listEnvVars(projectId);
        return { ok: true, projectId, variables: env };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  environment_set: {
    description: "Set an environment variable for a project. Distinguishes safe public variables from secret keys/tokens.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        key: { type: "string", description: "Variable key (e.g. DATABASE_URL, API_KEY)" },
        value: { type: "string", description: "Variable value" },
        isSecret: { type: "boolean", description: "True if this is a sensitive credential (stored with restricted mode 0600)" },
        description: { type: "string", description: "Optional description of variable usage" },
      },
      required: ["projectId", "key", "value"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        const key = String(args.key || "").trim();
        const value = String(args.value ?? "");
        if (!projectId || !key) return toolError("projectId and key are required");
        const mgr = getProjectManager();
        const meta = mgr.setEnvVar(
          projectId,
          key,
          value,
          args.isSecret === true,
          args.description ? String(args.description) : undefined,
        );
        return {
          ok: true,
          projectId,
          key: meta.key,
          isSecret: meta.isSecret,
          message: `Environment variable "${meta.key}" configured successfully.`,
        };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  environment_remove: {
    description: "Remove an environment variable from a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        key: { type: "string", description: "Variable key to remove" },
      },
      required: ["projectId", "key"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        const key = String(args.key || "").trim();
        if (!projectId || !key) return toolError("projectId and key are required");
        const mgr = getProjectManager();
        const ok = mgr.removeEnvVar(projectId, key);
        return { ok, projectId, key };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_git_status: {
    description: "Check the git repository status for a project workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const status = mgr.gitStatus(projectId);
        return { ok: true, projectId, ...status };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_git_init: {
    description: "Initialize a git repository in a project workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const state = mgr.gitInit(projectId);
        return { ok: true, projectId, ...state };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_git_diff: {
    description: "Show working tree diffs in a project workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const mgr = getProjectManager();
        const diff = mgr.gitDiff(projectId);
        return { ok: true, projectId, diff };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  project_git_commit: {
    description: "Create a git commit with a message documenting changes made to the project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        message: { type: "string", description: "Commit message explaining what was implemented or fixed" },
      },
      required: ["projectId", "message"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        const message = String(args.message || "").trim();
        if (!projectId || !message) return toolError("projectId and message are required");
        const mgr = getProjectManager();
        const res = mgr.gitCommit(projectId, message);
        return { ok: true, projectId, ...res };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  repair_analyze_failure: {
    description: "Analyze build, test, or runtime failure output to classify the failure type and suggest automated or user-assisted remediation.",
    inputSchema: {
      type: "object",
      properties: {
        stdout: { type: "string", description: "Standard output from failed command" },
        stderr: { type: "string", description: "Standard error from failed command" },
        error: { type: "string", description: "Optional error message or exception summary" },
      },
      required: ["stderr"],
    },
    handler: (args) => {
      try {
        const stdout = String(args.stdout || "");
        const stderr = String(args.stderr || "");
        const error = typeof args.error === "string" ? args.error : undefined;
        const loop = getRepairLoop();
        const analysis = loop.classifyFailure(stdout, stderr, error);
        return { ok: true, analysis };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  repair_run_cycle: {
    description: "Execute the autonomous build -> test -> analyze -> fix -> retest loop for a project with bounded retries.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Target project ID" },
      },
      required: ["projectId"],
    },
    handler: async (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const loop = getRepairLoop();
        const result = await loop.runAutonomousCycle(projectId);
        return { ok: true, ...result };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },

  repair_status: {
    description: "Inspect the current state, attempt count, failure history, and next action of the autonomous repair loop.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Target project ID" },
      },
      required: ["projectId"],
    },
    handler: (args) => {
      try {
        const projectId = String(args.projectId || "").trim();
        if (!projectId) return toolError("projectId is required");
        const loop = getRepairLoop();
        const state = loop.getLoopState(projectId);
        return { ok: true, state };
      } catch (err: any) {
        return toolError(err.message);
      }
    },
  },
};
