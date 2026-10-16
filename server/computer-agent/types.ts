// Types and contracts for General-Purpose Computer Agent (master_prompt_02.md)

export type ProcessLifecycleState =
  | "CREATED"
  | "STARTING"
  | "RUNNING"
  | "HEALTHY"
  | "UNHEALTHY"
  | "CRASHED"
  | "STOPPING"
  | "STOPPED";

export interface ManagedProcessRecord {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  pid?: number;
  state: ProcessLifecycleState;
  startTime: string;
  endTime?: string;
  exitCode?: number | null;
  signal?: string | null;
  ports: number[];
  tag?: string;
  healthEndpoint?: string;
  logFile: string;
  lastError?: string;
}

export interface ProcessStartOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  ports?: number[];
  tag?: string;
  healthEndpoint?: string;
}

export interface RuntimeInfo {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  details?: string;
}

export interface EnvironmentReport {
  operatingSystem: {
    platform: string;
    arch: string;
    release: string;
    isAndroid: boolean;
    androidVersion?: string;
    deviceModel?: string;
  };
  resources: {
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    workspacePath: string;
    workspaceFreeBytes?: number;
    workspaceTotalBytes?: number;
  };
  runtimes: Record<string, RuntimeInfo>;
  network: {
    online: boolean;
    latencyMs?: number;
    details?: string;
  };
  browserDriver: {
    available: boolean;
    driverPort?: number;
  };
  terminalCapabilities: {
    hasPty: boolean;
    hasNativeLauncher: boolean;
    shellPath: string;
  };
}

export interface ServiceVerificationOptions {
  portOrUrl: number | string;
  expectedStatus?: number[];
  timeoutMs?: number;
  expectedContentPattern?: string;
  processId?: string;
  minConsecutiveChecks?: number;
  startupTimeoutMs?: number;
}

export interface ServiceVerificationResult {
  verified: boolean;
  target: string;
  port?: number;
  httpStatus?: number;
  latencyMs?: number;
  processState?: ProcessLifecycleState;
  processPid?: number;
  bodyPreview?: string;
  consecutiveSuccesses: number;
  error?: string;
  diagnosis?: string;
}

export interface FileVerificationOptions {
  path: string;
  validateSyntax?: "json" | "js" | "yaml" | "none";
  expectedMinBytes?: number;
}

export interface FileVerificationResult {
  verified: boolean;
  path: string;
  exists: boolean;
  sizeBytes: number;
  lineCount: number;
  sha256?: string;
  syntaxValid?: boolean;
  error?: string;
}

// ── Agent Orchestration Layer Types ──

export type PlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export type PlanStatus =
  | "planning"
  | "executing"
  | "paused"
  | "completed"
  | "failed";

export type ApprovalStatus =
  | "none"
  | "requested"
  | "approved"
  | "rejected";

export interface ApprovalCheckpoint {
  stepId: string;
  action: string;
  impact: string;
  parameters?: Record<string, unknown>;
  requestedAt: string;
  decision?: {
    approved: boolean;
    reason?: string;
    timestamp: string;
  };
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  status: PlanStepStatus;
  toolsRequired?: string[];
  expectedOutcome: string;
  actualObservation?: string;
  error?: string;
  requiresApproval?: boolean;
  approvalStatus?: ApprovalStatus;
  checkpoint?: ApprovalCheckpoint;
  startedAt?: string;
  completedAt?: string;
}

export interface CompletionCriterion {
  id: string;
  description: string;
  verified: boolean;
  evidence?: string;
  verifiedAt?: string;
}

export interface ReplanRecord {
  revision: number;
  timestamp: string;
  failedStepId: string;
  reason: string;
  diagnosis: string;
  actionsTaken: string;
  preservedCompletedSteps: string[];
  addedSteps: string[];
  removedSteps: string[];
}

export interface TaskPlan {
  id: string;
  threadId?: string;
  goal: string;
  status: PlanStatus;
  steps: PlanStep[];
  completionCriteria: CompletionCriterion[];
  currentStepId: string | null;
  revision: number;
  replanHistory: ReplanRecord[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PlanCreationParams {
  goal: string;
  steps: Array<{
    title: string;
    description: string;
    expectedOutcome: string;
    toolsRequired?: string[];
    requiresApproval?: boolean;
  }>;
  completionCriteria: Array<{
    description: string;
  }>;
  threadId?: string;
  workspacePath?: string;
}

export interface ReplanParams {
  failedStepId: string;
  diagnosis: string;
  updatedRemainingSteps: Array<{
    title: string;
    description: string;
    expectedOutcome: string;
    toolsRequired?: string[];
    requiresApproval?: boolean;
  }>;
  threadId?: string;
  workspacePath?: string;
}

export interface CompletionVerificationItem {
  id: string;
  verified: boolean;
  evidence: string;
}

export interface CompletionVerificationResult {
  allVerified: boolean;
  planCompleted: boolean;
  criteria: CompletionCriterion[];
  pendingCriteria: string[];
  summary: string;
}

// ── Phase 3: Long-Running Autonomous Tasks Types ──

export type DurableTaskStatus =
  | "CREATED"
  | "PLANNING"
  | "RUNNING"
  | "WAITING"
  | "RECOVERING"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "PAUSED";

export interface TaskMilestone {
  id: string;
  title: string;
  description: string;
  completedAt: string;
  observation?: string;
  evidence?: string;
}

export interface TaskObservation {
  timestamp: string;
  source: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface TaskFailureRecord {
  timestamp: string;
  stepId?: string;
  error: string;
  diagnosis?: string;
  recovered: boolean;
  recoveryAction?: string;
}

export interface TaskApprovalRequest {
  id: string;
  stepId?: string;
  action: string;
  reason: string;
  impact: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  decisionAt?: string;
  decisionReason?: string;
}

export interface TaskVerificationItem {
  id: string;
  description: string;
  verified: boolean;
  evidence?: string;
}

export interface DurableTaskRecord {
  id: string;
  botId: string;
  threadId: string;
  goal: string;
  status: DurableTaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  revision: number;
  currentStepId?: string | null;
  completedMilestones: TaskMilestone[];
  pendingWork: string[];
  observations: TaskObservation[];
  failures: TaskFailureRecord[];
  processIds: string[];
  artifactIds: string[];
  approvals: TaskApprovalRequest[];
  progressPercent: number;
  progressMessage: string;
  workspacePath: string;
  planId?: string;
  waitState?: {
    untilTimestamp: number;
    reason: string;
    nextAction: string;
  };
  finalVerification?: {
    verified: boolean;
    timestamp: string;
    criteria: TaskVerificationItem[];
    summary: string;
  };
  finalResult?: {
    success: boolean;
    summary: string;
    deliveredArtifacts: string[];
  };
}

export interface TaskCreationParams {
  goal: string;
  botId?: string;
  threadId?: string;
  workspacePath?: string;
  initialMilestones?: string[];
}

export interface TaskProgressUpdate {
  progressPercent?: number;
  progressMessage?: string;
  currentStepId?: string;
  observation?: string;
  milestoneCompleted?: {
    id: string;
    title: string;
    description: string;
    evidence?: string;
  };
  addedProcessId?: string;
  addedArtifactId?: string;
}

export interface TaskWaitOptions {
  durationSeconds: number;
  reason: string;
  nextAction: string;
}


