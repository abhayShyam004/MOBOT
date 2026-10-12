// Types and contracts for Phase C — Full-Stack App Builder.
//
// Every generated app lives in an isolated project workspace under
// $DATA_DIR/projects/<projectId>/, tracked by a first-class ProjectRecord.
// This metadata coordinates local editing, build/test execution, localhost
// previewing, and deployment providers (Vercel, Render).

export type ProjectFramework = "react" | "nextjs" | "nodejs" | "html" | "typescript" | "fullstack" | "custom";
export type ProjectLanguage = "typescript" | "javascript" | "html";
export type ProjectRuntime = "node" | "static";

export type ProjectState =
  | "draft"
  | "building"
  | "ready"
  | "previewing"
  | "failed"
  | "deploying"
  | "live";

export type PreviewStatus =
  | "not_started"
  | "starting"
  | "running"
  | "crashed"
  | "startup_failed"
  | "stopped"
  | "restarting"
  | "unavailable"
  | "error";

export interface PreviewHealthState {
  ok: boolean;
  statusCode?: number;
  verifiedAt?: string;
  consecutiveChecks?: number;
  projectIdentityVerified?: boolean;
  endpoint?: string;
  bodyPreview?: string;
}

export type DeploymentProviderId = "vercel" | "render" | "custom";

export type DeploymentStatus =
  | "none"
  | "pending"
  | "queued"
  | "building"
  | "ready"
  | "error"
  | "cancelled";

export interface EnvVarMetadata {
  key: string;
  isSecret: boolean;
  description?: string;
  updatedAt: string;
}

export interface ProjectPreviewState {
  status: PreviewStatus;
  detailedState?: string;
  port?: number;
  url?: string;
  pid?: number;
  error?: string;
  lastStarted?: string;
  lastStopped?: string;
  health?: PreviewHealthState;
}

export interface ProjectDeploymentState {
  status: DeploymentStatus;
  provider?: DeploymentProviderId;
  deploymentId?: string;
  url?: string;
  error?: string;
  lastDeployed?: string;
}

export interface ProjectGitState {
  initialized: boolean;
  branch?: string;
  commitHash?: string;
  clean: boolean;
  lastCommitMessage?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  framework: ProjectFramework;
  language: ProjectLanguage;
  runtime: ProjectRuntime;
  createdAt: string;
  updatedAt: string;
  state: ProjectState;
  preview: ProjectPreviewState;
  deployment: ProjectDeploymentState;
  git: ProjectGitState;
  env: EnvVarMetadata[];
  ownerBotId?: string;
  activeThreadId?: string;
  entryPoint?: string;
  buildCommand?: string;
  testCommand?: string;
  startCommand?: string;
}

export interface CreateProjectOptions {
  id?: string;
  name: string;
  description?: string;
  framework?: ProjectFramework;
  language?: ProjectLanguage;
  template?: ProjectFramework;
  ownerBotId?: string;
  activeThreadId?: string;
  initGit?: boolean;
}

export interface BuildResult {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface TestResult {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  passed?: number;
  failed?: number;
  error?: string;
}

export interface BuildStatusView {
  state: ProjectState;
  lastBuildTime?: string;
  lastBuildSuccess?: boolean;
  hasLogs: boolean;
}

export interface TestStatusView {
  lastTestTime?: string;
  lastTestSuccess?: boolean;
  hasLogs: boolean;
}
