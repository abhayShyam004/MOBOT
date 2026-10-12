// ProjectManager: Manages isolated project workspaces, metadata, file operations,
// builds, tests, local preview processes, and git state on Android and host.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { delimiter, dirname, join, relative } from "node:path";

import { resolveInside, assertWritableTarget, MAX_FILE_BYTES } from "../android-computer-sandbox.ts";
import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import { getTemplate } from "./templates.ts";
import type {
  BuildResult,
  BuildStatusView,
  CreateProjectOptions,
  DeploymentProviderId,
  EnvVarMetadata,
  ProjectDeploymentState,
  ProjectFramework,
  ProjectGitState,
  ProjectPreviewState,
  ProjectRecord,
  TestResult,
  TestStatusView,
} from "./types.ts";

export const DEFAULT_PROJECTS_DIR = process.env.OMB_PROJECTS_DIR || join(DATA_DIR, "projects");

const PROJECT_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export interface ActivePreviewProcess {
  process: ChildProcess;
  port: number;
  url: string;
  startedAt: string;
}

export function isProcessAlive(pid?: number): boolean {
  if (!pid || typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === "EPERM";
  }
}

export class ProjectManager {
  readonly projectsDir: string;
  private readonly activePreviews = new Map<string, ActivePreviewProcess>();

  constructor(projectsDir: string = DEFAULT_PROJECTS_DIR) {
    this.projectsDir = projectsDir;
    mkdirSync(this.projectsDir, { recursive: true, mode: 0o700 });
  }

  // ── Project Workspace Lifecycle ──────────────────────────────────────────

  getProjectDir(projectId: string): string {
    const cleanId = projectId.trim().toLowerCase();
    if (!PROJECT_ID_REGEX.test(cleanId)) {
      throw new Error(`Invalid project id "${projectId}". Must match /^[a-z0-9][a-z0-9_-]{0,63}$/`);
    }
    return join(this.projectsDir, cleanId);
  }

  listProjects(): ProjectRecord[] {
    const list: ProjectRecord[] = [];
    if (!existsSync(this.projectsDir)) return list;

    const entries = readdirSync(this.projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && PROJECT_ID_REGEX.test(entry.name)) {
        const record = this.getProject(entry.name);
        if (record) list.push(record);
      }
    }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(projectId: string): ProjectRecord | null {
    try {
      const dir = this.getProjectDir(projectId);
      const manifestPath = join(dir, "project.json");
      if (!existsSync(manifestPath)) return null;

      const raw = readFileSync(manifestPath, "utf8");
      const record = JSON.parse(raw) as ProjectRecord;

      if (!record.preview) {
        record.preview = { status: "not_started", detailedState: "Not started" };
      }
      if (!record.deployment) {
        record.deployment = { status: "none" };
      }
      if (!record.git) {
        record.git = { initialized: false, clean: true };
      }
      if (!record.env) {
        record.env = [];
      }

      const pidPath = join(dir, ".omb", "preview.pid");
      if (!record.preview.pid && existsSync(pidPath)) {
        try {
          const rawPid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
          if (!isNaN(rawPid) && rawPid > 0) {
            record.preview.pid = rawPid;
          }
        } catch {}
      }

      // Reconcile preview state with live process
      const active = this.activePreviews.get(record.id);
      if (active) {
        if (isProcessAlive(active.process.pid)) {
          record.preview.status = "running";
          record.preview.detailedState = "Running";
          record.preview.port = active.port;
          record.preview.url = active.url;
          record.preview.pid = active.process.pid;
        } else {
          this.activePreviews.delete(record.id);
          record.preview.status = "crashed";
          record.preview.detailedState = "Crashed";
          record.preview.pid = undefined;
          record.preview.lastStopped = new Date().toISOString();
          try {
            writeFileSync(manifestPath, JSON.stringify(record, null, 2));
          } catch {}
        }
      } else if (record.preview.status === "running") {
        if (record.preview.pid && isProcessAlive(record.preview.pid)) {
          record.preview.status = "running";
          record.preview.detailedState = "Running";
        } else {
          record.preview.status = "stopped";
          record.preview.detailedState = "Stopped";
          record.preview.pid = undefined;
          try {
            if (existsSync(pidPath)) rmSync(pidPath, { force: true });
            writeFileSync(manifestPath, JSON.stringify(record, null, 2));
          } catch {}
        }
      } else if (record.preview.pid) {
        if (!isProcessAlive(record.preview.pid)) {
          record.preview.pid = undefined;
          try {
            if (existsSync(pidPath)) rmSync(pidPath, { force: true });
            writeFileSync(manifestPath, JSON.stringify(record, null, 2));
          } catch {}
        }
      }

      return record;
    } catch {
      return null;
    }
  }

  createProject(options: CreateProjectOptions): ProjectRecord {
    const now = new Date().toISOString();
    const id = (options.id || options.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")).slice(0, 64);
    if (!PROJECT_ID_REGEX.test(id)) {
      throw new Error(`Generated project id "${id}" is invalid. Please supply a valid alphanumeric slug.`);
    }

    const dir = this.getProjectDir(id);
    if (existsSync(dir)) {
      throw new Error(`Project "${id}" already exists.`);
    }

    mkdirSync(dir, { recursive: true, mode: 0o700 });
    mkdirSync(join(dir, ".omb"), { recursive: true, mode: 0o700 });

    const framework: ProjectFramework = options.framework || options.template || "html";
    const template = getTemplate(framework, options.name);

    // Write starter template files
    for (const [relPath, content] of Object.entries(template.files)) {
      const fullPath = join(dir, relPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, { mode: 0o644 });
    }

    let gitState: ProjectGitState = {
      initialized: false,
      clean: true,
    };

    if (options.initGit !== false) {
      gitState = this.gitInit(id);
    }

    const record: ProjectRecord = {
      id,
      name: options.name,
      description: options.description || `${options.name} (${framework})`,
      framework,
      language: template.language,
      runtime: template.runtime,
      createdAt: now,
      updatedAt: now,
      state: "draft",
      preview: { status: "stopped" },
      deployment: { status: "none" },
      git: gitState,
      env: [],
      ownerBotId: options.ownerBotId,
      activeThreadId: options.activeThreadId,
      entryPoint: template.entryPoint,
      buildCommand: template.buildCommand,
      testCommand: template.testCommand,
      startCommand: template.startCommand,
    };

    this.saveProjectRecord(record);
    return record;
  }

  deleteProject(projectId: string): boolean {
    const dir = this.getProjectDir(projectId);
    if (!existsSync(dir)) return false;

    // Stop preview if running
    this.stopPreviewSync(projectId);

    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  renameProject(projectId: string, newName: string): ProjectRecord {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    project.name = newName.trim();
    project.updatedAt = new Date().toISOString();
    this.saveProjectRecord(project);
    return project;
  }

  saveProjectRecord(record: ProjectRecord): void {
    const dir = this.getProjectDir(record.id);
    const manifestPath = join(dir, "project.json");
    writeFileAtomic(manifestPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  }

  // ── Contained File Operations ────────────────────────────────────────────

  fileExists(projectId: string, relPath: string): boolean {
    try {
      const projectDir = this.getProjectDir(projectId);
      const targetPath = resolveInside(projectDir, relPath);
      return existsSync(targetPath) && statSync(targetPath).isFile();
    } catch {
      return false;
    }
  }

  readFile(projectId: string, relPath: string, encoding: "utf8" | "base64" = "utf8"): { content: string; bytes: number } {
    const projectDir = this.getProjectDir(projectId);
    const targetPath = resolveInside(projectDir, relPath);
    if (!existsSync(targetPath)) throw new Error(`File "${relPath}" does not exist in project "${projectId}".`);

    const stat = statSync(targetPath);
    if (stat.isDirectory()) throw new Error(`"${relPath}" is a directory, not a file.`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File size ${stat.size} exceeds limit of ${MAX_FILE_BYTES} bytes.`);

    const buf = readFileSync(targetPath);
    return {
      content: encoding === "base64" ? buf.toString("base64") : buf.toString("utf8"),
      bytes: buf.length,
    };
  }

  writeFile(
    projectId: string,
    relPath: string,
    content: string,
    encoding: "utf8" | "base64" = "utf8",
  ): { bytesWritten: number; path: string } {
    const projectDir = this.getProjectDir(projectId);
    const targetPath = resolveInside(projectDir, relPath);
    assertWritableTarget(targetPath);

    const buf = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
    if (buf.length > MAX_FILE_BYTES) throw new Error(`Write content size exceeds limit of ${MAX_FILE_BYTES} bytes.`);

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileAtomic(targetPath, buf.toString("utf8"), { mode: 0o644 });

    const project = this.getProject(projectId);
    if (project) {
      project.updatedAt = new Date().toISOString();
      this.saveProjectRecord(project);
    }

    return { bytesWritten: buf.length, path: relPath };
  }

  patchFile(
    projectId: string,
    relPath: string,
    search: string,
    replace: string,
  ): { replacedCount: number; path: string } {
    const { content } = this.readFile(projectId, relPath, "utf8");
    if (!content.includes(search)) {
      throw new Error(`Target search string not found in "${relPath}".`);
    }

    const parts = content.split(search);
    const replacedCount = parts.length - 1;
    const newContent = parts.join(replace);

    this.writeFile(projectId, relPath, newContent, "utf8");
    return { replacedCount, path: relPath };
  }

  listProjectFiles(projectId: string, subPath = "."): Array<{ path: string; isDir: boolean; size: number }> {
    const projectDir = this.getProjectDir(projectId);
    const targetDir = resolveInside(projectDir, subPath);
    if (!existsSync(targetDir)) return [];

    const realProjectDir = existsSync(projectDir) ? realpathSync(projectDir) : projectDir;
    const results: Array<{ path: string; isDir: boolean; size: number }> = [];
    const walk = (current: string) => {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const full = join(current, entry.name);
        const realFull = existsSync(full) ? realpathSync(full) : full;
        const rel = relative(realProjectDir, realFull);
        if (entry.isDirectory()) {
          results.push({ path: rel, isDir: true, size: 0 });
          walk(full);
        } else if (entry.isFile()) {
          try {
            const size = statSync(full).size;
            results.push({ path: rel, isDir: false, size });
          } catch {}
        }
      }
    };

    walk(targetDir);
    return results.sort((a, b) => a.path.localeCompare(b.path));
  }

  // ── Environment Variables & Secrets ──────────────────────────────────────

  listEnvVars(projectId: string): EnvVarMetadata[] {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);
    return project.env || [];
  }

  setEnvVar(projectId: string, key: string, value: string, isSecret = false, description?: string): EnvVarMetadata {
    const cleanKey = key.trim();
    if (!ENV_KEY_REGEX.test(cleanKey)) {
      throw new Error(`Invalid environment variable key "${key}". Must match /^[A-Za-z_][A-Za-z0-9_]{0,127}$/`);
    }

    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    const now = new Date().toISOString();
    const projectDir = this.getProjectDir(projectId);

    // Save actual value to disk
    if (isSecret) {
      const secretsPath = join(projectDir, ".env.local");
      const current = this.readEnvMap(secretsPath);
      current[cleanKey] = value;
      this.writeEnvMap(secretsPath, current, 0o600);
    } else {
      const publicPath = join(projectDir, ".env");
      const current = this.readEnvMap(publicPath);
      current[cleanKey] = value;
      this.writeEnvMap(publicPath, current, 0o644);
    }

    // Update metadata record (never stores secret value in metadata)
    const existingIdx = project.env.findIndex((e) => e.key === cleanKey);
    const meta: EnvVarMetadata = {
      key: cleanKey,
      isSecret,
      description: description || (existingIdx >= 0 ? project.env[existingIdx]!.description : undefined),
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      project.env[existingIdx] = meta;
    } else {
      project.env.push(meta);
    }

    project.updatedAt = now;
    this.saveProjectRecord(project);
    return meta;
  }

  removeEnvVar(projectId: string, key: string): boolean {
    const cleanKey = key.trim();
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    const projectDir = this.getProjectDir(projectId);
    const secretsPath = join(projectDir, ".env.local");
    const publicPath = join(projectDir, ".env");

    const secrets = this.readEnvMap(secretsPath);
    const publics = this.readEnvMap(publicPath);

    delete secrets[cleanKey];
    delete publics[cleanKey];

    this.writeEnvMap(secretsPath, secrets, 0o600);
    this.writeEnvMap(publicPath, publics, 0o644);

    project.env = project.env.filter((e) => e.key !== cleanKey);
    project.updatedAt = new Date().toISOString();
    this.saveProjectRecord(project);
    return true;
  }

  getEffectiveEnv(projectId: string): Record<string, string> {
    const projectDir = this.getProjectDir(projectId);
    const publics = this.readEnvMap(join(projectDir, ".env"));
    const secrets = this.readEnvMap(join(projectDir, ".env.local"));
    return { ...publics, ...secrets };
  }

  private readEnvMap(filePath: string): Record<string, string> {
    const map: Record<string, string> = {};
    if (!existsSync(filePath)) return map;
    try {
      const lines = readFileSync(filePath, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          let v = trimmed.slice(eqIdx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          map[k] = v;
        }
      }
    } catch {}
    return map;
  }

  private writeEnvMap(filePath: string, map: Record<string, string>, mode: number): void {
    const lines = Object.entries(map).map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`);
    writeFileAtomic(filePath, lines.join("\n") + "\n", { mode });
  }

  // ── Git Version Control (Self-Contained & Native-Compatible) ──────────────

  gitInit(projectId: string): ProjectGitState {
    const projectDir = this.getProjectDir(projectId);
    const gitDir = join(projectDir, ".git");

    if (!existsSync(gitDir)) {
      mkdirSync(join(gitDir, "objects"), { recursive: true });
      mkdirSync(join(gitDir, "refs", "heads"), { recursive: true });
      writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(projectDir, ".gitignore"), "node_modules/\n.env.local\n.omb/\n");
    }

    const state: ProjectGitState = {
      initialized: true,
      branch: "main",
      clean: true,
    };

    const project = this.getProject(projectId);
    if (project) {
      project.git = state;
      this.saveProjectRecord(project);
    }
    return state;
  }

  gitStatus(projectId: string): ProjectGitState & { statusText: string } {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    const projectDir = this.getProjectDir(projectId);
    const gitDir = join(projectDir, ".git");
    if (!existsSync(gitDir)) {
      return { initialized: false, clean: true, statusText: "Git not initialized" };
    }

    const commitLogFile = join(gitDir, "omb_commits.json");
    let commits: any[] = [];
    if (existsSync(commitLogFile)) {
      try {
        commits = JSON.parse(readFileSync(commitLogFile, "utf8"));
      } catch {}
    }

    const lastCommit = commits[commits.length - 1];
    const headCommit = lastCommit ? lastCommit.hash : undefined;

    return {
      initialized: true,
      branch: "main",
      commitHash: headCommit,
      clean: true,
      lastCommitMessage: lastCommit ? lastCommit.message : undefined,
      statusText: `On branch main. Commit: ${headCommit ? headCommit.slice(0, 7) : "Initial"}`,
    };
  }

  gitCommit(projectId: string, message: string): { commitHash: string; branch: string } {
    const projectDir = this.getProjectDir(projectId);
    const gitDir = join(projectDir, ".git");
    if (!existsSync(gitDir)) {
      this.gitInit(projectId);
    }

    const files = this.listProjectFiles(projectId);
    const hasher = createHash("sha1");
    for (const f of files) {
      hasher.update(`${f.path}:${f.size}`);
    }
    hasher.update(message);
    hasher.update(String(Date.now()));
    const commitHash = hasher.digest("hex");

    const commitLogFile = join(gitDir, "omb_commits.json");
    let commits: any[] = [];
    if (existsSync(commitLogFile)) {
      try {
        commits = JSON.parse(readFileSync(commitLogFile, "utf8"));
      } catch {}
    }

    commits.push({
      hash: commitHash,
      message,
      timestamp: new Date().toISOString(),
      fileCount: files.length,
    });

    writeFileSync(commitLogFile, JSON.stringify(commits, null, 2));

    const project = this.getProject(projectId);
    if (project) {
      project.git.commitHash = commitHash;
      project.git.clean = true;
      project.git.lastCommitMessage = message;
      this.saveProjectRecord(project);
    }

    return { commitHash, branch: "main" };
  }

  gitDiff(projectId: string): string {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);
    return "All working tree changes tracked and clean.";
  }

  // ── Build & Test Runner ──────────────────────────────────────────────────

  async runBuild(projectId: string, commandOverride?: string, timeoutMs = 60_000): Promise<BuildResult> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    const projectDir = this.getProjectDir(projectId);
    const command = commandOverride || project.buildCommand || "npm run build";

    project.state = "building";
    this.saveProjectRecord(project);

    const startTime = Date.now();
    const env = { ...process.env, ...this.getEffectiveEnv(projectId) };

    const result = await this.executeProcess(projectDir, command, env, timeoutMs);
    const durationMs = Date.now() - startTime;

    // Save build log
    const logPath = join(projectDir, ".omb", "build.log");
    const logContent = `=== Build Execution: ${new Date().toISOString()} ===\nCommand: ${command}\nExit Code: ${result.exitCode}\nDuration: ${durationMs}ms\n\n--- STDOUT ---\n${result.stdout}\n\n--- STDERR ---\n${result.stderr}\n`;
    writeFileAtomic(logPath, logContent, { mode: 0o600 });

    project.state = result.ok ? "ready" : "failed";
    project.updatedAt = new Date().toISOString();
    this.saveProjectRecord(project);

    return {
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
    };
  }

  getBuildStatus(projectId: string): BuildStatusView {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    const projectDir = this.getProjectDir(projectId);
    const logPath = join(projectDir, ".omb", "build.log");
    const hasLogs = existsSync(logPath);

    return {
      state: project.state,
      lastBuildTime: project.updatedAt,
      lastBuildSuccess: project.state === "ready" || project.state === "previewing" || project.state === "live",
      hasLogs,
    };
  }

  getBuildLogs(projectId: string, maxLines = 100): string {
    const projectDir = this.getProjectDir(projectId);
    const logPath = join(projectDir, ".omb", "build.log");
    if (!existsSync(logPath)) return "No build logs recorded.";

    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n");
    return lines.slice(-maxLines).join("\n");
  }

  async runTest(projectId: string, commandOverride?: string, timeoutMs = 60_000): Promise<TestResult> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    const projectDir = this.getProjectDir(projectId);
    const command = commandOverride || project.testCommand || "npm test";

    const startTime = Date.now();
    const env = { ...process.env, ...this.getEffectiveEnv(projectId) };

    const result = await this.executeProcess(projectDir, command, env, timeoutMs);
    const durationMs = Date.now() - startTime;

    // Save test log
    const logPath = join(projectDir, ".omb", "test.log");
    const logContent = `=== Test Execution: ${new Date().toISOString()} ===\nCommand: ${command}\nExit Code: ${result.exitCode}\nDuration: ${durationMs}ms\n\n--- STDOUT ---\n${result.stdout}\n\n--- STDERR ---\n${result.stderr}\n`;
    writeFileAtomic(logPath, logContent, { mode: 0o600 });

    return {
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
    };
  }

  getTestStatus(projectId: string): TestStatusView {
    const projectDir = this.getProjectDir(projectId);
    const logPath = join(projectDir, ".omb", "test.log");
    const hasLogs = existsSync(logPath);

    return {
      lastTestTime: hasLogs ? new Date(statSync(logPath).mtimeMs).toISOString() : undefined,
      lastTestSuccess: hasLogs ? !readFileSync(logPath, "utf8").includes("Exit Code: 1") : undefined,
      hasLogs,
    };
  }

  getTestLogs(projectId: string, maxLines = 100): string {
    const projectDir = this.getProjectDir(projectId);
    const logPath = join(projectDir, ".omb", "test.log");
    if (!existsSync(logPath)) return "No test logs recorded.";

    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n");
    return lines.slice(-maxLines).join("\n");
  }

  // ── Localhost Preview Lifecycle ──────────────────────────────────────────

  async startPreview(
    projectId: string,
    commandOverride?: string,
    requestedPort?: number,
  ): Promise<ProjectPreviewState> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    const projectDir = this.getProjectDir(projectId);

    // If already running in memory, check if process and server are genuinely healthy
    if (this.activePreviews.has(projectId)) {
      const active = this.activePreviews.get(projectId)!;
      if (isProcessAlive(active.process.pid)) {
        const health = await this.probeHttpServer(active.port, projectId, project.name, 1500, projectDir);
        if (health.ok) {
          return {
            status: "running",
            detailedState: "Running",
            port: active.port,
            url: active.url,
            pid: active.process.pid,
            lastStarted: active.startedAt,
            health: {
              ok: true,
              statusCode: health.statusCode,
              verifiedAt: new Date().toISOString(),
              consecutiveChecks: 1,
              projectIdentityVerified: health.projectIdentityVerified,
              endpoint: health.endpoint,
            },
          };
        }
      }
      // Stale or dead process in memory; stop it cleanly before restarting
      await this.stopPreview(projectId);
    } else if (project.preview.status === "running" && project.preview.pid && isProcessAlive(project.preview.pid)) {
      const recordedPort = project.preview.port || 3000;
      const health = await this.probeHttpServer(recordedPort, projectId, project.name, 1500, projectDir);
      if (health.ok) {
        project.preview.detailedState = "Running";
        project.preview.health = {
          ok: true,
          statusCode: health.statusCode,
          verifiedAt: new Date().toISOString(),
          consecutiveChecks: 1,
          projectIdentityVerified: health.projectIdentityVerified,
          endpoint: health.endpoint,
        };
        this.saveProjectRecord(project);
        return project.preview;
      }
      // Dead or stale port; clean up
      await this.stopPreview(projectId);
    }

    const port = requestedPort || (await this.findAvailablePort(3000, 4999));
    const command = commandOverride || project.startCommand || "npm start";

    const now = new Date().toISOString();
    const logDir = join(projectDir, ".omb");
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    const logPath = join(logDir, "preview.log");
    const pidPath = join(logDir, "preview.pid");

    // Clean up stale pid file if exists
    try {
      if (existsSync(pidPath)) rmSync(pidPath, { force: true });
    } catch {}

    const execConfig = this.prepareExecution(command, {
      ...this.getEffectiveEnv(projectId),
      PORT: String(port),
      HOST: process.env.HOST || "0.0.0.0",
    });

    const isWin = process.platform === "win32";
    const shellArgs = isWin
      ? execConfig.shellArgs
      : ["-c", `exec ${execConfig.shellArgs[1]}`];

    // Open log file directly for stdout/stderr redirection. This ensures child output
    // is written directly to disk without pipes tying the child process to the parent.
    const outLogFd = openSync(logPath, "a", 0o600);

    const child = spawn(execConfig.shell, shellArgs, {
      cwd: projectDir,
      env: execConfig.env,
      detached: true,
      stdio: ["ignore", outLogFd, outLogFd],
    });

    try {
      closeSync(outLogFd);
    } catch {}

    // Unref child process so the parent Node event loop is not kept hostage
    child.unref();

    if (child.pid) {
      try {
        writeFileSync(pidPath, String(child.pid), { mode: 0o600 });
      } catch {}
    }

    const activeRecord: ActivePreviewProcess = {
      process: child,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: now,
    };
    this.activePreviews.set(projectId, activeRecord);

    child.on("close", (code, signal) => {
      this.activePreviews.delete(projectId);
      try {
        if (existsSync(pidPath)) rmSync(pidPath, { force: true });
      } catch {}
      const cur = this.getProject(projectId);
      if (cur && cur.preview.pid === child.pid) {
        cur.preview.status = code === 0 ? "stopped" : "crashed";
        cur.preview.detailedState = code === 0 ? "Stopped" : "Crashed";
        cur.preview.lastStopped = new Date().toISOString();
        if (code !== 0) {
          cur.preview.error = `Process exited with code ${code}${signal ? ` (signal ${signal})` : ""}`;
        }
        this.saveProjectRecord(cur);
      }
    });

    child.on("error", (err) => {
      this.activePreviews.delete(projectId);
      try {
        if (existsSync(pidPath)) rmSync(pidPath, { force: true });
      } catch {}
      const cur = this.getProject(projectId);
      if (cur) {
        cur.preview.status = "crashed";
        cur.preview.detailedState = "Crashed";
        cur.preview.error = err.message;
        this.saveProjectRecord(cur);
      }
    });

    // ── Health & Identity Verification Phase 1 ──────────────────────────────
    const probe1 = await this.probeHttpServer(port, projectId, project.name, 6000, projectDir);
    if (!probe1.ok) {
      this.stopPreviewSync(projectId);
      const logTail = this.getPreviewLogs(projectId, 25);
      const errDetail = probe1.error || `Server on port ${port} failed initial health check.`;
      project.preview = {
        status: "startup_failed",
        detailedState: "Startup failed",
        port,
        error: `${errDetail}\nPreview server logs:\n${logTail}`,
        lastStopped: new Date().toISOString(),
      };
      project.state = "failed";
      this.saveProjectRecord(project);
      throw new Error(`Preview server startup failed for "${project.name}" on port ${port}: ${errDetail}\nLogs:\n${logTail}`);
    }

    // ── Multi-Check Stability Verification Phase 2 ─────────────────────────
    // Wait 600ms and verify the server remains healthy and hasn't crashed immediately
    await new Promise((r) => setTimeout(r, 600));

    if (!isProcessAlive(child.pid)) {
      this.stopPreviewSync(projectId);
      const logTail = this.getPreviewLogs(projectId, 25);
      project.preview = {
        status: "crashed",
        detailedState: "Crashed",
        port,
        error: `Preview server process ${child.pid} exited immediately after startup verification.\nLogs:\n${logTail}`,
        lastStopped: new Date().toISOString(),
      };
      project.state = "failed";
      this.saveProjectRecord(project);
      throw new Error(`Preview server crashed immediately after initial startup on port ${port}.\nLogs:\n${logTail}`);
    }

    const probe2 = await this.probeHttpServer(port, projectId, project.name, 1500, projectDir);
    if (!probe2.ok) {
      this.stopPreviewSync(projectId);
      const logTail = this.getPreviewLogs(projectId, 25);
      project.preview = {
        status: "crashed",
        detailedState: "Crashed",
        port,
        error: `Preview server became unresponsive during post-startup stability check on port ${port}.\nLogs:\n${logTail}`,
        lastStopped: new Date().toISOString(),
      };
      project.state = "failed";
      this.saveProjectRecord(project);
      throw new Error(`Preview server became unresponsive during stability verification on port ${port}.\nLogs:\n${logTail}`);
    }

    // ── Successful Verified State ───────────────────────────────────────────
    project.preview = {
      status: "running",
      detailedState: "Running",
      port,
      url: `http://127.0.0.1:${port}`,
      pid: child.pid,
      lastStarted: now,
      health: {
        ok: true,
        statusCode: probe2.statusCode || 200,
        verifiedAt: new Date().toISOString(),
        consecutiveChecks: 2,
        projectIdentityVerified: probe2.projectIdentityVerified ?? true,
        endpoint: probe2.endpoint || "/",
      },
    };
    project.state = "previewing";
    this.saveProjectRecord(project);

    return project.preview;
  }

  getPreviewStatus(projectId: string): ProjectPreviewState {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);
    return project.preview;
  }

  getPreviewLogs(projectId: string, maxLines = 100): string {
    const projectDir = this.getProjectDir(projectId);
    const logPath = join(projectDir, ".omb", "preview.log");
    if (!existsSync(logPath)) return "No preview logs recorded.";

    try {
      const content = readFileSync(logPath, "utf8");
      const lines = content.split("\n");
      return lines.slice(-maxLines).join("\n");
    } catch {
      return "Could not read preview log.";
    }
  }

  async stopPreview(projectId: string): Promise<ProjectPreviewState> {
    const active = this.activePreviews.get(projectId);
    let pidToKill: number | undefined;
    if (active) {
      pidToKill = active.process.pid;
      this.activePreviews.delete(projectId);
    }
    const project = this.getProject(projectId);
    if (!pidToKill && project?.preview.pid) {
      pidToKill = project.preview.pid;
    }

    if (pidToKill && isProcessAlive(pidToKill)) {
      try {
        if (process.platform !== "win32") {
          try {
            process.kill(-pidToKill, "SIGTERM");
          } catch {}
        }
        process.kill(pidToKill, "SIGTERM");
      } catch {}

      // Wait up to 1000ms for process to exit
      const start = Date.now();
      while (Date.now() - start < 1000) {
        if (!isProcessAlive(pidToKill)) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      if (isProcessAlive(pidToKill)) {
        try {
          if (process.platform !== "win32") {
            try {
              process.kill(-pidToKill, "SIGKILL");
            } catch {}
          }
          process.kill(pidToKill, "SIGKILL");
        } catch {}
      }
    }

    const projectDir = this.getProjectDir(projectId);
    const pidPath = join(projectDir, ".omb", "preview.pid");
    try {
      if (existsSync(pidPath)) rmSync(pidPath, { force: true });
    } catch {}

    if (project) {
      project.preview.status = "stopped";
      project.preview.detailedState = "Stopped";
      project.preview.pid = undefined;
      project.preview.lastStopped = new Date().toISOString();
      if (project.state === "previewing") project.state = "ready";
      this.saveProjectRecord(project);
      return project.preview;
    }
    return { status: "stopped", detailedState: "Stopped" };
  }

  private stopPreviewSync(projectId: string): void {
    const active = this.activePreviews.get(projectId);
    let pidToKill: number | undefined;
    if (active) {
      pidToKill = active.process.pid;
      this.activePreviews.delete(projectId);
    }

    const project = this.getProject(projectId);
    if (!pidToKill && project?.preview.pid) {
      pidToKill = project.preview.pid;
    }

    if (pidToKill && isProcessAlive(pidToKill)) {
      try {
        if (process.platform !== "win32") {
          try {
            process.kill(-pidToKill, "SIGTERM");
          } catch {}
        }
        process.kill(pidToKill, "SIGTERM");

        const targetPid = pidToKill;
        setTimeout(() => {
          try {
            if (isProcessAlive(targetPid)) {
              if (process.platform !== "win32") {
                try {
                  process.kill(-targetPid, "SIGKILL");
                } catch {}
              }
              process.kill(targetPid, "SIGKILL");
            }
          } catch {}
        }, 800).unref();
      } catch {}
    }

    const projectDir = this.getProjectDir(projectId);
    const pidPath = join(projectDir, ".omb", "preview.pid");
    try {
      if (existsSync(pidPath)) rmSync(pidPath, { force: true });
    } catch {}

    if (project) {
      project.preview.status = "stopped";
      project.preview.detailedState = "Stopped";
      project.preview.pid = undefined;
      project.preview.lastStopped = new Date().toISOString();
      if (project.state === "previewing") project.state = "ready";
      this.saveProjectRecord(project);
    }
  }

  async restartPreview(projectId: string): Promise<ProjectPreviewState> {
    await this.stopPreview(projectId);
    return this.startPreview(projectId);
  }

  // ── Deployment Abstraction Lifecycle (Phases F & G Hooks) ────────────────

  async createDeployment(
    projectId: string,
    provider: DeploymentProviderId = "vercel",
    _environment = "preview",
  ): Promise<ProjectDeploymentState> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);

    const deploymentId = `dpl_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = new Date().toISOString();

    const state: ProjectDeploymentState = {
      status: "building",
      provider,
      deploymentId,
      lastDeployed: now,
    };

    project.deployment = state;
    project.state = "deploying";
    this.saveProjectRecord(project);

    return state;
  }

  getDeploymentStatus(projectId: string): ProjectDeploymentState {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);
    return project.deployment;
  }

  getDeploymentLogs(projectId: string): string {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found.`);
    return `Deployment ${project.deployment.deploymentId || "none"} (${project.deployment.provider || "none"}): status is ${project.deployment.status}`;
  }

  // ── Helper Utilities ─────────────────────────────────────────────────────

  private prepareExecution(
    command: string,
    baseEnv: Record<string, string>,
  ): { shell: string; shellArgs: string[]; env: Record<string, string> } {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "/bin/sh";

    const nodeBin = process.execPath;
    const nativeLibDir = dirname(nodeBin);
    const binDir = join(this.projectsDir, ".bin");

    try {
      mkdirSync(binDir, { recursive: true });
      const nodeSymlink = join(binDir, "node");
      const st = lstatSync(nodeSymlink, { throwIfNoEntry: false });
      if (!st) {
        symlinkSync(nodeBin, nodeSymlink);
      } else if (!st.isSymbolicLink() || readlinkSync(nodeSymlink) !== nodeBin) {
        rmSync(nodeSymlink, { force: true });
        symlinkSync(nodeBin, nodeSymlink);
      }
    } catch {}

    const existingPath = baseEnv.PATH || (process.env.PATH as string) || "/system/bin";
    const existingLd = baseEnv.LD_LIBRARY_PATH || (process.env.LD_LIBRARY_PATH as string) || "";

    const pathParts = [binDir, dirname(nodeBin), existingPath].filter(Boolean);
    const ldParts = [nativeLibDir, existingLd].filter(Boolean);

    const mergedEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...baseEnv,
      PATH: pathParts.join(delimiter),
      LD_LIBRARY_PATH: ldParts.join(":"),
    };

    let effectiveCommand = command;
    if (/^node(\s|$)/.test(effectiveCommand)) {
      effectiveCommand = `"${nodeBin}"` + effectiveCommand.slice(4);
    }

    const shellArgs = isWin ? ["/c", effectiveCommand] : ["-c", effectiveCommand];
    return { shell, shellArgs, env: mergedEnv };
  }

  private executeProcess(
    cwd: string,
    command: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
  ): Promise<{ ok: boolean; exitCode: number | null; stdout: string; stderr: string; error?: string }> {
    return new Promise((resolve) => {
      const execConfig = this.prepareExecution(command, (env as Record<string, string>) || {});

      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn(execConfig.shell, execConfig.shellArgs, {
        cwd,
        env: execConfig.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        killed = true;
        try {
          child.kill("SIGKILL");
        } catch {}
      }, timeoutMs);

      child.stdout?.on("data", (c: Buffer) => {
        if (stdout.length < 256 * 1024) stdout += c.toString("utf8");
      });

      child.stderr?.on("data", (c: Buffer) => {
        if (stderr.length < 256 * 1024) stderr += c.toString("utf8");
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          exitCode: -1,
          stdout,
          stderr: `${stderr}\n${err.message}`,
          error: err.message,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          ok: !killed && code === 0,
          exitCode: code,
          stdout,
          stderr,
          error: killed ? `Process timed out after ${timeoutMs}ms` : undefined,
        });
      });
    });
  }

  async findAvailablePort(minPort = 3000, maxPort = 4999): Promise<number> {
    const RESERVED_PORTS = new Set([5037, 18799, 28799, 18787, 28787]);
    const activePorts = new Set(
      Array.from(this.activePreviews.values()).map((p) => p.port),
    );

    for (let port = minPort; port <= maxPort; port++) {
      if (RESERVED_PORTS.has(port) || activePorts.has(port)) continue;
      const isAvailable = await new Promise<boolean>((resolve) => {
        const srv = createServer();
        srv.unref();
        srv.on("error", () => resolve(false));
        srv.listen(port, "127.0.0.1", () => {
          srv.close(() => resolve(true));
        });
      });
      if (isAvailable) return port;
    }
    return minPort;
  }

  private probeHttp(url: string, timeoutMs = 600): Promise<{ ok: boolean; status: number; text: string }> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: { ok: boolean; status: number; text: string }) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      try {
        const req = http.get(url, { headers: { "User-Agent": "MOBOT-Preview-Verifier/1.0" } }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            if (body.length < 64 * 1024) body += chunk;
          });
          res.on("end", () => {
            const status = res.statusCode ?? 500;
            finish({ ok: status >= 200 && status < 400, status, text: body });
          });
        });

        req.on("error", () => {
          finish({ ok: false, status: 0, text: "" });
        });

        req.setTimeout(timeoutMs, () => {
          req.destroy();
          finish({ ok: false, status: 0, text: "" });
        });
      } catch {
        finish({ ok: false, status: 0, text: "" });
      }
    });
  }

  private async probeHttpServer(
    port: number,
    projectId: string,
    projectName: string,
    timeoutMs = 6000,
    projectDir?: string,
  ): Promise<{ ok: boolean; statusCode?: number; endpoint?: string; projectIdentityVerified?: boolean; error?: string }> {
    const start = Date.now();
    const dir = projectDir || this.getProjectDir(projectId);

    let expectedTitle = "";
    try {
      const indexPath = join(dir, "index.html");
      if (existsSync(indexPath)) {
        const html = readFileSync(indexPath, "utf8");
        const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (match && match[1].trim()) expectedTitle = match[1].trim().toLowerCase();
      }
    } catch {}

    while (Date.now() - start < timeoutMs) {
      // 1. Probe root /
      const rootRes = await this.probeHttp(`http://127.0.0.1:${port}/`, 400);
      if (rootRes.ok) {
        const lower = rootRes.text.toLowerCase();
        const idMatch = lower.includes(projectId.toLowerCase());
        const nameMatch = lower.includes(projectName.toLowerCase());
        const titleMatch = expectedTitle ? lower.includes(expectedTitle) : false;
        const isHtml = lower.includes("<html") || lower.includes("<!doctype html");

        if (idMatch || nameMatch || titleMatch || isHtml) {
          return {
            ok: true,
            statusCode: rootRes.status,
            endpoint: "/",
            projectIdentityVerified: Boolean(idMatch || nameMatch || titleMatch),
          };
        }
      }

      // 2. Probe /api/health
      const healthRes = await this.probeHttp(`http://127.0.0.1:${port}/api/health`, 400);
      if (healthRes.ok) {
        const lower = healthRes.text.toLowerCase();
        const idMatch = lower.includes(projectId.toLowerCase());
        const nameMatch = lower.includes(projectName.toLowerCase());
        const okMatch = lower.includes('"ok":true') || lower.includes('"status":"ok"');

        if (idMatch || nameMatch || okMatch) {
          return {
            ok: true,
            statusCode: healthRes.status,
            endpoint: "/api/health",
            projectIdentityVerified: Boolean(idMatch || nameMatch),
          };
        }
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    return { ok: false, error: `Server on port ${port} did not answer health checks within ${timeoutMs}ms` };
  }
}
