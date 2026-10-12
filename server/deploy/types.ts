// Common Deployment Abstraction (Phase F & Phase G)
//
// Supports Vercel and Render deployment providers over pure HTTPS APIs without CLI dependencies.

export type DeploymentProviderId = "vercel" | "render";
export type DeploymentTarget = "production" | "preview";
export type DeploymentLifecycleStatus =
  | "none"
  | "pending"
  | "queued"
  | "building"
  | "ready"
  | "error"
  | "cancelled";

export interface DeploymentFile {
  file: string; // relative path in project
  data: string; // utf-8 content or base64
  encoding?: "utf-8" | "base64";
  sha?: string;
  size?: number;
}

export interface DeploymentOptions {
  projectId: string;
  projectName: string;
  target?: DeploymentTarget;
  env?: Record<string, string>;
  files?: DeploymentFile[];
  repoUrl?: string;
  branch?: string;
}

export interface DeploymentRecord {
  id: string;
  provider: DeploymentProviderId;
  projectId: string;
  projectName: string;
  target: DeploymentTarget;
  status: DeploymentLifecycleStatus;
  url?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  buildDurationMs?: number;
}

export interface ProviderAccountInfo {
  provider: DeploymentProviderId;
  connected: boolean;
  username?: string;
  email?: string;
  teamId?: string;
  teamName?: string;
  maskedToken?: string;
  lastTestedAt?: string;
}

export interface DeploymentProvider {
  readonly id: DeploymentProviderId;
  readonly name: string;

  /**
   * Verify credentials and return account metadata.
   */
  testConnection(token: string): Promise<{ ok: boolean; account?: ProviderAccountInfo; error?: string }>;

  /**
   * Create or trigger a new deployment.
   */
  createDeployment(token: string, options: DeploymentOptions): Promise<DeploymentRecord>;

  /**
   * Check status and URL of an active or past deployment.
   */
  getDeploymentStatus(token: string, deploymentId: string): Promise<DeploymentRecord>;

  /**
   * Retrieve build / deployment logs.
   */
  getDeploymentLogs(token: string, deploymentId: string, maxLines?: number): Promise<string>;

  /**
   * Redeploy an existing project / deployment.
   */
  redeploy(token: string, deploymentId: string): Promise<DeploymentRecord>;

  /**
   * Cancel an in-flight deployment.
   */
  cancelDeployment(token: string, deploymentId: string): Promise<boolean>;
}
