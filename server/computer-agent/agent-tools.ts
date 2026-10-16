import { EnvironmentDiscovery } from "./environment-discovery.ts";
import { defaultProcessManager } from "./process-manager.ts";
import { defaultSystemVerifier } from "./verification.ts";
import { defaultArtifactManager, type ArtifactKind } from "./artifact-manager.ts";
import { defaultTaskOrchestrator } from "./orchestrator.ts";
import { defaultTaskEngine } from "./durable-task-engine.ts";

export interface ToolSpec {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> | unknown;
}

export const COMPUTER_AGENT_TOOLS: Record<string, ToolSpec> = {
  environment_discover: {
    description:
      "Inspect the current operating environment: device OS, architecture (arm64), CPU & memory, available storage, installed interpreters (Node, Python, Java), package managers (npm, pip), shell, network connectivity, and browser driver. Call this to truthfully know what tools exist rather than guessing.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const disco = new EnvironmentDiscovery();
      const report = await disco.discover();
      return { ok: true, environment: report };
    },
  },

  process_start: {
    description:
      "Start a long-running process in the background on this device (e.g. server, worker, database engine, watcher). The process survives your turn and runs detached while logging stdout/stderr. Returns a process id to inspect, monitor, or stop.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Executable or binary to run (e.g. 'node', 'sh', 'python3')" },
        args: { type: "array", items: { type: "string" }, description: "Arguments array (e.g. ['server.js', '--port', '8080'])" },
        cwd: { type: "string", description: "Working directory relative to workspace or absolute path" },
        env: { type: "object", additionalProperties: { type: "string" }, description: "Environment variables" },
        ports: { type: "array", items: { type: "integer" }, description: "Expected listening ports" },
        healthEndpoint: { type: "string", description: "Optional HTTP health endpoint to probe (e.g. 'http://127.0.0.1:8080/health')" },
        tag: { type: "string", description: "Human-readable label for this service" },
      },
      required: ["command"],
    },
    handler: async (args) => {
      const command = String(args.command || "").trim();
      if (!command) return { ok: false, error: "command is required" };
      const proc = await defaultProcessManager.startProcess({
        command,
        args: Array.isArray(args.args) ? (args.args as string[]) : [],
        cwd: args.cwd ? String(args.cwd) : undefined,
        env: (args.env as Record<string, string>) || undefined,
        ports: Array.isArray(args.ports) ? (args.ports as number[]) : undefined,
        healthEndpoint: args.healthEndpoint ? String(args.healthEndpoint) : undefined,
        tag: args.tag ? String(args.tag) : undefined,
      });
      return { ok: true, process: proc };
    },
  },

  process_inspect: {
    description:
      "Inspect the live state of a managed background process: PID, lifecycle state (STARTING, RUNNING, HEALTHY, UNHEALTHY, CRASHED, STOPPED), exit code, uptime, and health.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process ID returned by process_start" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id || "").trim();
      const proc = await defaultProcessManager.inspectProcess(id);
      if (!proc) return { ok: false, error: `Process ${id} not found` };
      return { ok: true, process: proc };
    },
  },

  process_logs: {
    description: "Read stdout and stderr logs captured from a managed background process.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process ID returned by process_start" },
        maxBytes: { type: "integer", description: "Max bytes to retrieve from tail of log (default 32768)" },
      },
      required: ["id"],
    },
    handler: (args) => {
      const id = String(args.id || "").trim();
      const logs = defaultProcessManager.getLogs(id, typeof args.maxBytes === "number" ? args.maxBytes : undefined);
      return { ok: true, id, logs };
    },
  },

  process_stop: {
    description: "Stop a managed background process with graceful SIGTERM (or SIGKILL if force=true).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process ID to stop" },
        force: { type: "boolean", description: "Force kill with SIGKILL immediately" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id || "").trim();
      const res = await defaultProcessManager.stopProcess(id, Boolean(args.force));
      return { ok: res.ok, id, state: res.state };
    },
  },

  process_restart: {
    description: "Restart a managed background process with its original command, arguments, and environment.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process ID to restart" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id || "").trim();
      try {
        const proc = await defaultProcessManager.restartProcess(id);
        return { ok: true, process: proc };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
  },

  process_list: {
    description: "List all background processes managed on this device with their current lifecycle states.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const processes = await defaultProcessManager.listProcesses();
      return { ok: true, processes };
    },
  },

  verify_service: {
    description:
      "Empirically verify that a local service or HTTP port is listening and responsive. Performs multiple consecutive HTTP probes to prove it stays alive, checking status codes, latency, and process PID.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Port number (e.g. '3000' or 3000) or URL (e.g. 'http://127.0.0.1:3000/api/health')" },
        expectedStatus: { type: "array", items: { type: "integer" }, description: "Acceptable HTTP status codes (default 200..399)" },
        expectedPattern: { type: "string", description: "Substring pattern expected in the response body" },
        processId: { type: "string", description: "Optional process ID to verify that the owning PID remains alive" },
        minChecks: { type: "integer", description: "Number of consecutive successful checks required (default 2)" },
      },
      required: ["target"],
    },
    handler: async (args) => {
      const rawTarget = args.target;
      const portOrUrl = typeof rawTarget === "number" ? rawTarget : String(rawTarget);
      const res = await defaultSystemVerifier.verifyService(portOrUrl, {
        portOrUrl,
        expectedStatus: Array.isArray(args.expectedStatus) ? (args.expectedStatus as number[]) : undefined,
        expectedContentPattern: args.expectedPattern ? String(args.expectedPattern) : undefined,
        processId: args.processId ? String(args.processId) : undefined,
        minConsecutiveChecks: typeof args.minChecks === "number" ? args.minChecks : 2,
      });
      return { ok: res.verified, result: res };
    },
  },

  verify_file: {
    description:
      "Empirically verify a file exists, has non-zero size, line count, sha256 checksum, and valid syntax (json or js). Use this before claiming a file was written correctly.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to file in workspace or absolute path" },
        validateSyntax: { type: "string", enum: ["json", "js", "none"], description: "Syntax parser validation" },
        minBytes: { type: "integer", description: "Expected minimum size in bytes" },
      },
      required: ["path"],
    },
    handler: (args) => {
      const path = String(args.path || "").trim();
      const res = defaultSystemVerifier.verifyFile(path, {
        path,
        validateSyntax: (args.validateSyntax as any) || "none",
        expectedMinBytes: typeof args.minBytes === "number" ? args.minBytes : undefined,
      });
      return { ok: res.verified, result: res };
    },
  },

  verify_image: {
    description:
      "Empirically verify that a downloaded or generated image is a valid, readable, uncorrupted image file (PNG, JPEG, WebP, GIF) with non-zero dimensions and size. Never assume a downloaded URL or file path is a valid image without verifying.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to image file in workspace or absolute path" },
        minBytes: { type: "integer", description: "Minimum expected size in bytes (default 100)" },
        minWidth: { type: "integer", description: "Minimum expected image width in pixels" },
        minHeight: { type: "integer", description: "Minimum expected image height in pixels" },
      },
      required: ["path"],
    },
    handler: (args) => {
      const path = String(args.path || "").trim();
      const res = defaultSystemVerifier.verifyImage(path, {
        minBytes: typeof args.minBytes === "number" ? args.minBytes : undefined,
        minWidth: typeof args.minWidth === "number" ? args.minWidth : undefined,
        minHeight: typeof args.minHeight === "number" ? args.minHeight : undefined,
      });
      return { ok: res.verified, result: res };
    },
  },

  verify_artifact: {
    description:
      "Empirically verify any artifact file (image, PDF, document, dataset, code, archive) in the workspace before presenting it to the user. Checks file existence, non-zero byte size, magic bytes/format integrity, and SHA-256 hash.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to artifact file in workspace or absolute path" },
        expectedKind: {
          type: "string",
          enum: ["image", "pdf", "document", "code", "archive", "dataset", "file"],
          description: "Expected artifact category",
        },
        minBytes: { type: "integer", description: "Minimum expected size in bytes" },
      },
      required: ["path"],
    },
    handler: (args) => {
      const path = String(args.path || "").trim();
      const res = defaultSystemVerifier.verifyArtifact(path, {
        expectedKind: args.expectedKind as ArtifactKind | undefined,
        minBytes: typeof args.minBytes === "number" ? args.minBytes : undefined,
      });
      return { ok: res.valid, result: res };
    },
  },

  artifact_register: {
    description:
      "Register a file created or downloaded into the workspace as a durable user-facing artifact (image, document, PDF, code, dataset, archive, etc.). Validates file existence and integrity, extracts metadata, copies it to durable attachments storage, and registers it to be automatically delivered to the user chat. The chat UI automatically renders this artifact natively as an interactive card/viewer; do NOT output download links or '[Image attached]' in your reply text.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file in the workspace" },
        name: { type: "string", description: "Optional display name for the artifact" },
        title: { type: "string", description: "Optional human-readable title" },
        description: { type: "string", description: "Optional description of what this artifact is" },
        visibility: {
          type: "string",
          enum: ["user_visible", "final", "internal", "intermediate"],
          description: "Artifact visibility (default 'user_visible')",
        },
        threadId: { type: "string", description: "Optional thread id" },
        turnId: { type: "string", description: "Optional turn id" },
      },
      required: ["path"],
    },
    handler: (args) => {
      const path = String(args.path || "").trim();
      try {
        const artifact = defaultArtifactManager.registerArtifact(path, {
          name: args.name ? String(args.name) : undefined,
          visibility: (args.visibility as any) || "user_visible",
          metadata: {
            title: args.title ? String(args.title) : undefined,
            description: args.description ? String(args.description) : undefined,
            threadId: args.threadId ? String(args.threadId) : undefined,
            turnId: args.turnId ? String(args.turnId) : undefined,
          },
        });
        return {
          ok: true,
          registered: true,
          artifact,
          name: artifact.name,
          kind: artifact.kind,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
          note: "Artifact registered and will be rendered natively in user chat. Do NOT emit download links in response.",
        };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
  },

  artifact_list: {
    description:
      "List all registered artifacts for this session or thread, optionally filtered by kind.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["image", "pdf", "document", "code", "archive", "dataset", "file"],
          description: "Optional filter by artifact kind",
        },
        threadId: { type: "string", description: "Optional filter by thread ID" },
      },
    },
    handler: (args) => {
      const artifacts = defaultArtifactManager.listArtifacts({
        kind: args.kind as ArtifactKind | undefined,
        threadId: args.threadId ? String(args.threadId) : undefined,
      });
      return { ok: true, artifacts };
    },
  },

  // ── Agent Orchestration Layer Tools ──

  plan_create: {
    description:
      "Create a structured, multi-step execution plan for an unfamiliar user goal. Defines the goal, ordered steps with expected outcomes, required tools, approval checkpoints, and verifiable completion criteria. Persists plan state across turns.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The high-level user goal to accomplish" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Concise step title" },
              description: { type: "string", description: "What this step executes" },
              expectedOutcome: { type: "string", description: "Concrete observable outcome proving success" },
              toolsRequired: { type: "array", items: { type: "string" }, description: "Tools anticipated for this step" },
              requiresApproval: { type: "boolean", description: "Whether human checkpoint is required before executing" },
            },
            required: ["title", "description", "expectedOutcome"],
          },
          description: "Ordered array of execution steps",
        },
        completionCriteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "Specific verifiable condition that must hold for total success" },
            },
            required: ["description"],
          },
          description: "Explicit verification criteria that define overall completion",
        },
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
      required: ["goal", "steps", "completionCriteria"],
    },
    handler: (args) => {
      const goal = String(args.goal || "").trim();
      if (!goal) return { ok: false, error: "goal is required" };
      const steps = Array.isArray(args.steps) ? (args.steps as any[]) : [];
      if (steps.length === 0) return { ok: false, error: "at least one step is required" };
      const completionCriteria = Array.isArray(args.completionCriteria) ? (args.completionCriteria as any[]) : [];
      if (completionCriteria.length === 0) return { ok: false, error: "at least one completion criterion is required" };

      const plan = defaultTaskOrchestrator.createPlan({
        goal,
        steps,
        completionCriteria,
        workspacePath: args.workspacePath ? String(args.workspacePath) : undefined,
      });
      return { ok: true, plan };
    },
  },

  plan_status: {
    description:
      "Inspect the current structured task plan, showing all steps (pending, in_progress, completed, failed, blocked), active step, replan history, and completion criteria status.",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
    },
    handler: (args) => {
      const plan = defaultTaskOrchestrator.getActivePlan(
        args.workspacePath ? String(args.workspacePath) : undefined,
      );
      if (!plan) return { ok: false, error: "No active plan found. Call plan_create first." };
      return { ok: true, plan };
    },
  },

  plan_step_start: {
    description:
      "Mark a planned step as active (in_progress) before executing its tools.",
    inputSchema: {
      type: "object",
      properties: {
        stepId: { type: "string", description: "Step ID to start (e.g. 'step_1')" },
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
      required: ["stepId"],
    },
    handler: (args) => {
      const stepId = String(args.stepId || "").trim();
      return defaultTaskOrchestrator.startStep(
        stepId,
        args.workspacePath ? String(args.workspacePath) : undefined,
      );
    },
  },

  plan_step_complete: {
    description:
      "Mark an in-progress step as successfully completed after observing empirical tool results. Records actual observation and verification evidence.",
    inputSchema: {
      type: "object",
      properties: {
        stepId: { type: "string", description: "Step ID that was completed (e.g. 'step_1')" },
        observation: { type: "string", description: "Empirical outcome observed from real tool execution" },
        evidence: { type: "string", description: "Optional file path, hash, or status confirming the outcome" },
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
      required: ["stepId", "observation"],
    },
    handler: (args) => {
      const stepId = String(args.stepId || "").trim();
      const observation = String(args.observation || "").trim();
      return defaultTaskOrchestrator.completeStep(
        stepId,
        observation,
        args.evidence ? String(args.evidence) : undefined,
        args.workspacePath ? String(args.workspacePath) : undefined,
      );
    },
  },

  plan_step_fail: {
    description:
      "Record that a step failed due to an observed tool failure or unexpected environment state. Records failure observation and root cause diagnosis, preparing the plan for dynamic replanning.",
    inputSchema: {
      type: "object",
      properties: {
        stepId: { type: "string", description: "Step ID that failed (e.g. 'step_2')" },
        observation: { type: "string", description: "Empirical failure observed from tool execution" },
        error: { type: "string", description: "Root cause diagnosis explaining why it failed" },
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
      required: ["stepId", "observation", "error"],
    },
    handler: (args) => {
      const stepId = String(args.stepId || "").trim();
      const observation = String(args.observation || "").trim();
      const error = String(args.error || "").trim();
      return defaultTaskOrchestrator.failStep(
        stepId,
        observation,
        error,
        args.workspacePath ? String(args.workspacePath) : undefined,
      );
    },
  },

  plan_replan: {
    description:
      "Dynamically replan remaining steps when a step fails or new information requires changing course. Preserves all previously completed steps and work, records the failure diagnosis, and replaces remaining pending steps with a revised execution path.",
    inputSchema: {
      type: "object",
      properties: {
        failedStepId: { type: "string", description: "The ID of the step that failed" },
        diagnosis: { type: "string", description: "Why the previous plan failed and how the new plan overcomes it" },
        updatedRemainingSteps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Concise step title" },
              description: { type: "string", description: "What this step executes" },
              expectedOutcome: { type: "string", description: "Concrete observable outcome proving success" },
              toolsRequired: { type: "array", items: { type: "string" }, description: "Tools anticipated for this step" },
              requiresApproval: { type: "boolean", description: "Whether human checkpoint is required before executing" },
            },
            required: ["title", "description", "expectedOutcome"],
          },
          description: "New remaining steps replacing the failed and subsequent pending steps",
        },
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
      required: ["failedStepId", "diagnosis", "updatedRemainingSteps"],
    },
    handler: (args) => {
      const failedStepId = String(args.failedStepId || "").trim();
      const diagnosis = String(args.diagnosis || "").trim();
      const updatedRemainingSteps = Array.isArray(args.updatedRemainingSteps)
        ? (args.updatedRemainingSteps as any[])
        : [];
      return defaultTaskOrchestrator.replan({
        failedStepId,
        diagnosis,
        updatedRemainingSteps,
        workspacePath: args.workspacePath ? String(args.workspacePath) : undefined,
      });
    },
  },

  plan_approval_checkpoint: {
    description:
      "Request an explicit human approval checkpoint before executing a high-impact, state-mutating, or irreversible step. Outlines the planned action, expected impact, and parameters for user sign-off.",
    inputSchema: {
      type: "object",
      properties: {
        stepId: { type: "string", description: "Step ID requiring approval" },
        action: { type: "string", description: "The high-impact action to be performed" },
        impact: { type: "string", description: "Potential impact or side effects of this action" },
        parameters: { type: "object", description: "Parameters for the proposed action" },
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
      required: ["stepId", "action", "impact"],
    },
    handler: (args) => {
      const stepId = String(args.stepId || "").trim();
      const action = String(args.action || "").trim();
      const impact = String(args.impact || "").trim();
      return defaultTaskOrchestrator.requestApprovalCheckpoint(
        stepId,
        action,
        impact,
        args.parameters as Record<string, unknown> | undefined,
        args.workspacePath ? String(args.workspacePath) : undefined,
      );
    },
  },

  plan_approval_respond: {
    description:
      "Record human decision (approved or rejected) for an approval checkpoint.",
    inputSchema: {
      type: "object",
      properties: {
        stepId: { type: "string", description: "Step ID that was checkpointed" },
        approved: { type: "boolean", description: "Whether the action was approved" },
        reason: { type: "string", description: "Optional reason or feedback" },
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
      required: ["stepId", "approved"],
    },
    handler: (args) => {
      const stepId = String(args.stepId || "").trim();
      const approved = Boolean(args.approved);
      return defaultTaskOrchestrator.recordApprovalDecision(
        stepId,
        approved,
        args.reason ? String(args.reason) : undefined,
        args.workspacePath ? String(args.workspacePath) : undefined,
      );
    },
  },

  plan_verify_completion: {
    description:
      "Empirically evaluate all completion criteria against actual verified artifacts, services, or outcomes before declaring the overall task complete. Every criterion must have concrete verification evidence. If any criterion is unmet, completion is rejected.",
    inputSchema: {
      type: "object",
      properties: {
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Completion criterion ID (e.g. 'crit_1')" },
              verified: { type: "boolean", description: "Whether the criterion has been empirically verified" },
              evidence: { type: "string", description: "Concrete evidence (e.g. artifact path, SHA-256, HTTP 200 probe)" },
            },
            required: ["id", "verified", "evidence"],
          },
          description: "Evaluations for all completion criteria",
        },
        workspacePath: { type: "string", description: "Optional workspace root directory" },
      },
      required: ["criteria"],
    },
    handler: (args) => {
      const criteria = Array.isArray(args.criteria) ? (args.criteria as any[]) : [];
      return defaultTaskOrchestrator.verifyCompletion(
        criteria,
        args.workspacePath ? String(args.workspacePath) : undefined,
      );
    },
  },

  // ── Phase 3: Long-Running Autonomous Tasks Tools ──

  task_create: {
    description:
      "Create a durable, long-running agent task that survives across chat turns, server restarts, and process crashes. Initial status is CREATED.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The overarching user goal" },
        botId: { type: "string", description: "Bot ID owning this task" },
        threadId: { type: "string", description: "Conversation thread ID" },
        workspacePath: { type: "string", description: "Workspace directory" },
        initialMilestones: {
          type: "array",
          items: { type: "string" },
          description: "Initial planned milestones or deliverables",
        },
      },
      required: ["goal"],
    },
    handler: (args) => {
      const task = defaultTaskEngine.createTask({
        goal: String(args.goal || "").trim(),
        botId: args.botId ? String(args.botId) : undefined,
        threadId: args.threadId ? String(args.threadId) : undefined,
        workspacePath: args.workspacePath ? String(args.workspacePath) : undefined,
        initialMilestones: Array.isArray(args.initialMilestones) ? (args.initialMilestones as string[]) : undefined,
      });
      return { ok: true, task };
    },
  },

  task_status: {
    description:
      "Inspect the persistent lifecycle state, progress, milestones, observations, and failures of a durable task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Durable task ID" },
        workspacePath: { type: "string", description: "Optional workspace directory" },
      },
      required: ["taskId"],
    },
    handler: (args) => {
      const taskId = String(args.taskId || "").trim();
      const task = defaultTaskEngine.getTask(taskId, args.workspacePath ? String(args.workspacePath) : undefined);
      if (!task) return { ok: false, error: `Task '${taskId}' not found.` };
      return { ok: true, task };
    },
  },

  task_progress: {
    description:
      "Update progress, record observations, log completed milestones, or attach background processes and artifacts to a durable task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Durable task ID" },
        progressPercent: { type: "integer", description: "Completion percentage (0 - 100)" },
        progressMessage: { type: "string", description: "Human-facing progress description" },
        currentStepId: { type: "string", description: "Current step ID being executed" },
        observation: { type: "string", description: "Empirical observation or tool outcome" },
        milestoneCompleted: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["id", "title", "description"],
          description: "Milestone that completed with empirical evidence",
        },
        addedProcessId: { type: "string", description: "ID of background process associated with this task" },
        addedArtifactId: { type: "string", description: "ID of registered artifact produced by this task" },
      },
      required: ["taskId"],
    },
    handler: (args) => {
      const taskId = String(args.taskId || "").trim();
      const task = defaultTaskEngine.updateProgress(taskId, {
        progressPercent: args.progressPercent !== undefined ? Number(args.progressPercent) : undefined,
        progressMessage: args.progressMessage ? String(args.progressMessage) : undefined,
        currentStepId: args.currentStepId ? String(args.currentStepId) : undefined,
        observation: args.observation ? String(args.observation) : undefined,
        milestoneCompleted: args.milestoneCompleted as any,
        addedProcessId: args.addedProcessId ? String(args.addedProcessId) : undefined,
        addedArtifactId: args.addedArtifactId ? String(args.addedArtifactId) : undefined,
      });
      return { ok: true, task };
    },
  },

  task_wait: {
    description:
      "Transition task into WAITING state for a given duration without blocking the model or locking execution. Background supervisor monitors the timer and resumes when expired.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Durable task ID" },
        durationSeconds: { type: "integer", description: "Duration to wait in seconds" },
        reason: { type: "string", description: "Why the task is waiting" },
        nextAction: { type: "string", description: "Action to perform when wait period expires" },
      },
      required: ["taskId", "durationSeconds", "reason", "nextAction"],
    },
    handler: (args) => {
      const taskId = String(args.taskId || "").trim();
      const task = defaultTaskEngine.setWaiting(taskId, {
        durationSeconds: Number(args.durationSeconds),
        reason: String(args.reason),
        nextAction: String(args.nextAction),
      });
      return { ok: true, task };
    },
  },

  task_approval_request: {
    description:
      "Request explicit human approval before executing a high-impact operation. Transitions task to AWAITING_APPROVAL and persists state until decision is made.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Durable task ID" },
        action: { type: "string", description: "The sensitive operation requiring human review" },
        reason: { type: "string", description: "Why approval is necessary" },
        impact: { type: "string", description: "Expected consequences or risks" },
        stepId: { type: "string", description: "Optional step ID" },
      },
      required: ["taskId", "action", "reason", "impact"],
    },
    handler: (args) => {
      const taskId = String(args.taskId || "").trim();
      const approval = defaultTaskEngine.requestApproval(taskId, {
        action: String(args.action),
        reason: String(args.reason),
        impact: String(args.impact),
        stepId: args.stepId ? String(args.stepId) : undefined,
      });
      return { ok: true, approval };
    },
  },

  task_approval_decide: {
    description:
      "Record human decision (approved or rejected) for a task approval request. If approved, resumes task to RUNNING; if rejected, marks FAILED.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Durable task ID" },
        approvalId: { type: "string", description: "Approval request ID" },
        approved: { type: "boolean", description: "Whether the action was approved" },
        reason: { type: "string", description: "Optional feedback or reason" },
      },
      required: ["taskId", "approvalId", "approved"],
    },
    handler: (args) => {
      const taskId = String(args.taskId || "").trim();
      const approvalId = String(args.approvalId || "").trim();
      const approved = Boolean(args.approved);
      const task = defaultTaskEngine.decideApproval(taskId, approvalId, approved, args.reason ? String(args.reason) : undefined);
      return { ok: true, task };
    },
  },

  task_cancel: {
    description:
      "Explicitly cancel a running task. Terminates any associated background processes and marks task state as CANCELLED.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Durable task ID" },
        reason: { type: "string", description: "Reason for cancellation" },
      },
      required: ["taskId"],
    },
    handler: async (args) => {
      const taskId = String(args.taskId || "").trim();
      const task = await defaultTaskEngine.cancelTask(taskId, args.reason ? String(args.reason) : undefined);
      return { ok: true, task };
    },
  },

  task_complete: {
    description:
      "Declare the task COMPLETED with explicit empirical verification criteria. All verification items must pass before the task enters COMPLETED.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Durable task ID" },
        summary: { type: "string", description: "Final verified outcome summary" },
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              description: { type: "string" },
              verified: { type: "boolean" },
              evidence: { type: "string" },
            },
            required: ["id", "description", "verified"],
          },
          description: "All empirical verification items",
        },
        deliveredArtifacts: {
          type: "array",
          items: { type: "string" },
          description: "IDs of artifacts delivered to user",
        },
      },
      required: ["taskId", "summary", "criteria"],
    },
    handler: (args) => {
      const taskId = String(args.taskId || "").trim();
      const summary = String(args.summary || "").trim();
      const criteria = Array.isArray(args.criteria) ? (args.criteria as any[]) : [];
      return defaultTaskEngine.completeTask(
        taskId,
        criteria,
        summary,
        Array.isArray(args.deliveredArtifacts) ? (args.deliveredArtifacts as string[]) : undefined,
      );
    },
  },

  task_resume: {
    description:
      "Resume a paused, waiting, or recovering task from persistent disk state.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Durable task ID" },
      },
      required: ["taskId"],
    },
    handler: (args) => {
      const taskId = String(args.taskId || "").trim();
      const task = defaultTaskEngine.resumeTask(taskId);
      return { ok: true, task };
    },
  },
};

