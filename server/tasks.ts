import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { snapshot, restore } from "./checkpoints.ts";

/**
 * Official Roadmap Phase 21 Formal Data Contract: Persistent Agent Jobs
 * (mobot_54_phases_prompt.md:1230-1255)
 */
export type JobState =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED_FOR_USER"
  | "BLOCKED_DEPENDENCY"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface PersistentAgentJob {
  jobId: string;
  botId: string;
  threadId: string;
  title: string;
  objective: string;
  state: JobState;
  progressPercent: number;
  currentMilestoneIndex: number;
  checkpointPayloadPath: string;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs?: number;
  failureReason?: string;
  fencingGeneration?: number;
}

export const ERR_CORRUPT_JOB_CHECKPOINT = "ERR_CORRUPT_JOB_CHECKPOINT";
export const ERR_INVALID_JOB_TRANSITION = "ERR_INVALID_JOB_TRANSITION";
export const ERR_JOB_ALREADY_CLAIMED = "ERR_JOB_ALREADY_CLAIMED";
export const ERR_JOB_VALIDATION_FAILED = "ERR_JOB_VALIDATION_FAILED";
export const ERR_STALE_WORKER_FENCE = "ERR_STALE_WORKER_FENCE";

export class CorruptJobCheckpointError extends Error {
  readonly code = ERR_CORRUPT_JOB_CHECKPOINT;
  readonly details?: Record<string, unknown>;
  constructor(message = "Job checkpoint file corrupted or inconsistent", details?: Record<string, unknown>) {
    super(message);
    this.name = "CorruptJobCheckpointError";
    this.details = details;
  }
}

export class InvalidJobTransitionError extends Error {
  readonly code = ERR_INVALID_JOB_TRANSITION;
  readonly fromState: JobState;
  readonly toState: JobState;
  constructor(
    fromState: JobState,
    toState: JobState,
    message = `Invalid job state transition from ${fromState} to ${toState}`
  ) {
    super(message);
    this.name = "InvalidJobTransitionError";
    this.fromState = fromState;
    this.toState = toState;
  }
}

export class JobAlreadyClaimedError extends Error {
  readonly code = ERR_JOB_ALREADY_CLAIMED;
  readonly jobId: string;
  readonly workerId: string;
  constructor(jobId: string, workerId: string, message = `Job ${jobId} is already claimed by active worker ${workerId}`) {
    super(message);
    this.name = "JobAlreadyClaimedError";
    this.jobId = jobId;
    this.workerId = workerId;
  }
}

export class StaleWorkerFenceError extends Error {
  readonly code = ERR_STALE_WORKER_FENCE;
  readonly jobId: string;
  readonly expectedGeneration: number;
  readonly receivedGeneration: number;
  constructor(jobId: string, expectedGeneration: number, receivedGeneration: number) {
    super(`Stale worker fencing error for job ${jobId}: active generation is ${expectedGeneration}, but write attempt used ${receivedGeneration}`);
    this.name = "StaleWorkerFenceError";
    this.jobId = jobId;
    this.expectedGeneration = expectedGeneration;
    this.receivedGeneration = receivedGeneration;
  }
}

export class JobValidationError extends Error {
  readonly code = ERR_JOB_VALIDATION_FAILED;
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "JobValidationError";
    this.field = field;
  }
}

/**
 * Journal entry recorded synchronously for every state change
 */
export interface JobJournalEntry {
  id: string;
  jobId: string;
  fromState: JobState;
  toState: JobState;
  timestampMs: number;
  milestoneIndex: number;
  progressPercent: number;
  checkpointHash?: string;
  reason?: string;
  workerId?: string;
  fencingGeneration?: number;
  jobSnapshot?: PersistentAgentJob;
}

/**
 * Serializable payload persisted at each milestone checkpoint
 */
export interface JobCheckpointPayload {
  jobId: string;
  botId: string;
  milestoneIndex: number;
  milestoneTitle: string;
  progressPercent: number;
  gitCheckpointHash?: string;
  state: JobState;
  timestampMs: number;
  checksum: string;
  data: Record<string, unknown>;
}

export interface CreateJobInput {
  jobId?: string;
  botId: string;
  threadId: string;
  title: string;
  objective: string;
  milestones?: Array<{ title: string; data?: Record<string, unknown> }>;
  initialData?: Record<string, unknown>;
}

export interface WorkerClaim {
  workerId: string;
  claimedAtMs: number;
  leaseExpiresAtMs: number;
  fencingGeneration: number;
}

const DEFAULT_LEASE_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const CHECKPOINTS_BASE_DIR = () => join(DATA_DIR, "checkpoints", "jobs");

/**
 * Canonical path resolver and sanitizer for checkpoint files.
 * Rejects path traversals, escapes, and unexpected root paths.
 */
export function getSafeCheckpointPath(jobId: string, milestoneIndex: number, baseDir = CHECKPOINTS_BASE_DIR()): string {
  const sanitizedJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `milestone-${milestoneIndex}.json`;
  const resolvedBase = resolve(baseDir);
  const targetPath = resolve(join(resolvedBase, sanitizedJobId, filename));
  if (!targetPath.startsWith(resolvedBase)) {
    throw new JobValidationError("Checkpoint path traversal detected", "checkpointPayloadPath");
  }
  return targetPath;
}

/**
 * Validates persistent agent job schema and invariants
 */
export function validatePersistentAgentJob(val: unknown, baseDir = CHECKPOINTS_BASE_DIR()): val is PersistentAgentJob {
  if (!val || typeof val !== "object") return false;
  const j = val as Record<string, unknown>;

  // Identifiers
  if (typeof j.jobId !== "string" || !j.jobId.trim() || j.jobId.includes("/") || j.jobId.includes("\\")) return false;
  if (typeof j.botId !== "string" || !j.botId.trim() || j.botId.includes("/") || j.botId.includes("\\")) return false;
  if (typeof j.threadId !== "string" || !j.threadId.trim() || j.threadId.includes("/") || j.threadId.includes("\\")) return false;

  // Content bounds
  if (typeof j.title !== "string" || !j.title.trim() || j.title.length > 256) return false;
  if (typeof j.objective !== "string" || !j.objective.trim() || j.objective.length > 4096) return false;

  // State union
  const validStates: JobState[] = ["QUEUED", "RUNNING", "PAUSED_FOR_USER", "BLOCKED_DEPENDENCY", "COMPLETED", "FAILED", "CANCELLED"];
  if (!validStates.includes(j.state as JobState)) return false;

  // Numeric bounds
  if (typeof j.progressPercent !== "number" || !Number.isFinite(j.progressPercent) || j.progressPercent < 0 || j.progressPercent > 100) {
    return false;
  }
  if (typeof j.currentMilestoneIndex !== "number" || !Number.isInteger(j.currentMilestoneIndex) || j.currentMilestoneIndex < 0) {
    return false;
  }

  // Timestamps
  if (typeof j.createdAtMs !== "number" || !Number.isInteger(j.createdAtMs) || j.createdAtMs <= 0) return false;
  if (typeof j.updatedAtMs !== "number" || !Number.isInteger(j.updatedAtMs) || j.updatedAtMs < j.createdAtMs) return false;

  // Terminal invariant checks
  if (j.state === "COMPLETED") {
    if (typeof j.completedAtMs !== "number" || j.completedAtMs < j.createdAtMs) return false;
  } else if (j.state === "QUEUED" || j.state === "RUNNING") {
    if (j.completedAtMs !== undefined) return false;
  }

  // Failure reason sanitization check
  if (j.state === "FAILED") {
    if (typeof j.failureReason !== "string" || !j.failureReason.trim()) return false;
  }

  // Fencing generation validation
  if (j.fencingGeneration !== undefined) {
    if (typeof j.fencingGeneration !== "number" || !Number.isInteger(j.fencingGeneration) || j.fencingGeneration < 0) {
      return false;
    }
  }

  // Checkpoint path validation: must not traverse outside allowed directory
  if (typeof j.checkpointPayloadPath !== "string" || !j.checkpointPayloadPath.trim()) return false;
  try {
    const resolvedPath = resolve(j.checkpointPayloadPath);
    const resolvedBase = resolve(baseDir);
    // Path must either be within baseDir or within DATA_DIR
    const allowedDir = resolve(DATA_DIR);
    if (!resolvedPath.startsWith(resolvedBase) && !resolvedPath.startsWith(allowedDir)) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Valid transitions table defining permitted state changes
 */
const PERMITTED_TRANSITIONS: Record<JobState, readonly JobState[]> = {
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED_FOR_USER", "BLOCKED_DEPENDENCY", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED_FOR_USER: ["RUNNING", "FAILED", "CANCELLED"],
  BLOCKED_DEPENDENCY: ["RUNNING", "FAILED", "CANCELLED"],
  COMPLETED: [], // Terminal
  FAILED: [], // Terminal
  CANCELLED: [], // Terminal
};

export function isPermittedTransition(from: JobState, to: JobState): boolean {
  return PERMITTED_TRANSITIONS[from]?.includes(to) ?? false;
}

interface JobsStorageFile {
  version: 1;
  jobs: Record<string, PersistentAgentJob>;
}

/**
 * Authoritative Persistent Agent Job Manager
 */
export class PersistentJobManager {
  private readonly file: string;
  private readonly journalFile: string;
  private readonly checkpointsDir: string;
  private readonly leasesFile: string;
  private readonly clock: () => number;
  private jobs: Map<string, PersistentAgentJob> = new Map();
  private workerClaims: Map<string, WorkerClaim> = new Map();

  constructor(options?: {
    file?: string;
    journalFile?: string;
    checkpointsDir?: string;
    leasesFile?: string;
    clock?: () => number;
  }) {
    this.file = options?.file ?? join(DATA_DIR, "jobs.json");
    this.journalFile = options?.journalFile ?? join(DATA_DIR, "job-journal.jsonl");
    this.checkpointsDir = options?.checkpointsDir ?? CHECKPOINTS_BASE_DIR();
    this.leasesFile = options?.leasesFile ?? join(dirname(this.file), "worker-leases.json");
    this.clock = options?.clock ?? Date.now;
    this.load();
    this.loadLeases();
    this.syncStateWithJournal();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const content = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(content) as JobsStorageFile;
      if (parsed && typeof parsed.jobs === "object") {
        for (const [id, job] of Object.entries(parsed.jobs)) {
          if (validatePersistentAgentJob(job, this.checkpointsDir)) {
            this.jobs.set(id, { ...job });
          }
        }
      }
    } catch (err) {
      console.warn("PersistentJobManager: Failed to parse jobs.json, attempting journal recovery", err);
      this.recoverFromJournal();
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload: JobsStorageFile = {
      version: 1,
      jobs: Object.fromEntries(this.jobs.entries()),
    };
    writeFileAtomic(this.file, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  }

  private saveLeases(): void {
    try {
      mkdirSync(dirname(this.leasesFile), { recursive: true });
      writeFileAtomic(this.leasesFile, JSON.stringify(Object.fromEntries(this.workerClaims.entries()), null, 2) + "\n", { mode: 0o600 });
    } catch {}
  }

  private loadLeases(): void {
    if (!existsSync(this.leasesFile)) return;
    try {
      const content = readFileSync(this.leasesFile, "utf8");
      const parsed = JSON.parse(content) as Record<string, WorkerClaim>;
      if (parsed && typeof parsed === "object") {
        for (const [id, claim] of Object.entries(parsed)) {
          if (claim && typeof claim.workerId === "string" && typeof claim.leaseExpiresAtMs === "number") {
            this.workerClaims.set(id, claim);
          }
        }
      }
    } catch {}
  }

  private appendJournal(entry: Omit<JobJournalEntry, "id">): JobJournalEntry {
    mkdirSync(dirname(this.journalFile), { recursive: true });
    const fullEntry: JobJournalEntry = {
      id: randomUUID(),
      ...entry,
    };
    const line = JSON.stringify(fullEntry) + "\n";
    const fd = openSync(this.journalFile, "a", 0o600);
    try {
      writeSync(fd, line, null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return fullEntry;
  }

  public reload(): void {
    this.jobs.clear();
    this.workerClaims.clear();
    this.load();
    this.loadLeases();
    this.syncStateWithJournal();
  }

  public reconstructFromJournal(): number {
    return this.recoverFromJournal();
  }

  private recoverFromJournal(): number {
    if (!existsSync(this.journalFile)) return 0;
    let recoveredCount = 0;
    try {
      const lines = readFileSync(this.journalFile, "utf8").split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as JobJournalEntry;
          if (entry.jobSnapshot && validatePersistentAgentJob(entry.jobSnapshot, this.checkpointsDir)) {
            this.jobs.set(entry.jobId, { ...entry.jobSnapshot });
            recoveredCount++;
          } else {
            const existing = this.jobs.get(entry.jobId);
            if (existing) {
              existing.state = entry.toState;
              existing.currentMilestoneIndex = entry.milestoneIndex;
              existing.progressPercent = entry.progressPercent;
              existing.updatedAtMs = entry.timestampMs;
              if (entry.fencingGeneration) existing.fencingGeneration = entry.fencingGeneration;
              if (entry.toState === "COMPLETED") existing.completedAtMs = entry.timestampMs;
              if (entry.toState === "FAILED" && entry.reason) existing.failureReason = entry.reason;
            } else {
              const recoveredJob: PersistentAgentJob = {
                jobId: entry.jobId,
                botId: "worker",
                threadId: entry.jobId,
                title: `Recovered Job ${entry.jobId}`,
                objective: "Reconstructed from transaction journal",
                state: entry.toState,
                progressPercent: entry.progressPercent,
                currentMilestoneIndex: entry.milestoneIndex,
                checkpointPayloadPath: getSafeCheckpointPath(entry.jobId, entry.milestoneIndex, this.checkpointsDir),
                createdAtMs: entry.timestampMs,
                updatedAtMs: entry.timestampMs,
                completedAtMs: entry.toState === "COMPLETED" ? entry.timestampMs : undefined,
                failureReason: entry.toState === "FAILED" ? entry.reason : undefined,
                fencingGeneration: entry.fencingGeneration ?? 1,
              };
              this.jobs.set(entry.jobId, recoveredJob);
              recoveredCount++;
            }
          }
        } catch {
          // Skip torn final line or corrupted trailing entry safely
        }
      }
      if (this.jobs.size > 0) {
        this.save();
      }
    } catch (err) {
      console.warn("PersistentJobManager: Failed recovering from journal", err);
    }
    return recoveredCount;
  }

  private syncStateWithJournal(): void {
    if (this.jobs.size === 0 && existsSync(this.journalFile)) {
      this.recoverFromJournal();
    }
  }

  renewLease(jobId: string, workerId: string, fencingGeneration: number, extensionMs = DEFAULT_LEASE_DURATION_MS): void {
    this.load();
    this.loadLeases();
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");
    const activeClaim = this.workerClaims.get(jobId);
    if (!activeClaim || activeClaim.workerId !== workerId || activeClaim.fencingGeneration !== fencingGeneration) {
      throw new StaleWorkerFenceError(jobId, activeClaim?.fencingGeneration ?? job.fencingGeneration ?? 1, fencingGeneration);
    }
    activeClaim.leaseExpiresAtMs = this.clock() + extensionMs;
    this.saveLeases();
  }

  releaseLease(jobId: string, workerId?: string): void {
    if (workerId) {
      const claim = this.workerClaims.get(jobId);
      if (claim && claim.workerId === workerId) {
        this.workerClaims.delete(jobId);
        this.saveLeases();
      }
    } else {
      this.workerClaims.delete(jobId);
      this.saveLeases();
    }
  }

  private computeChecksum(data: Record<string, unknown>): string {
    return createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  // ───────────────────────────────────────────────
  // Public Lifecycle & State Machine Operations
  // ───────────────────────────────────────────────

  createJob(input: CreateJobInput): PersistentAgentJob {
    const now = this.clock();
    const jobId = input.jobId ?? randomUUID();

    if (this.jobs.has(jobId)) {
      throw new JobValidationError(`Job with ID ${jobId} already exists`, "jobId");
    }

    const checkpointPayloadPath = getSafeCheckpointPath(jobId, 0, this.checkpointsDir);

    const job: PersistentAgentJob = {
      jobId,
      botId: input.botId,
      threadId: input.threadId,
      title: input.title.trim(),
      objective: input.objective.trim(),
      state: "QUEUED",
      progressPercent: 0,
      currentMilestoneIndex: 0,
      checkpointPayloadPath,
      createdAtMs: now,
      updatedAtMs: now,
      fencingGeneration: 1,
    };

    if (!validatePersistentAgentJob(job, this.checkpointsDir)) {
      throw new JobValidationError("Created job violates canonical schema", "job");
    }

    // Persist initial milestone checkpoint
    this.writeCheckpointPayload(jobId, 0, {
      jobId,
      botId: input.botId,
      milestoneIndex: 0,
      milestoneTitle: input.milestones?.[0]?.title ?? "Initial Goal Setup",
      progressPercent: 0,
      state: "QUEUED",
      timestampMs: now,
      checksum: this.computeChecksum(input.initialData ?? {}),
      data: input.initialData ?? {},
    });

    this.jobs.set(jobId, job);

    // WAL: append journal and flush to disk FIRST
    this.appendJournal({
      jobId,
      fromState: "QUEUED",
      toState: "QUEUED",
      timestampMs: now,
      milestoneIndex: 0,
      progressPercent: 0,
      fencingGeneration: 1,
      reason: "Job initialized",
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  claimJob(jobId: string, workerId: string, leaseDurationMs = DEFAULT_LEASE_DURATION_MS): PersistentAgentJob {
    this.load();
    this.loadLeases();
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");

    const now = this.clock();
    const activeClaim = this.workerClaims.get(jobId);
    if (activeClaim && activeClaim.workerId !== workerId && activeClaim.leaseExpiresAtMs > now && job.state === "RUNNING") {
      throw new JobAlreadyClaimedError(jobId, activeClaim.workerId);
    }

    const isLeaseTakeover = job.state === "RUNNING" && Boolean(activeClaim && activeClaim.leaseExpiresAtMs <= now);
    if (!isLeaseTakeover && !isPermittedTransition(job.state, "RUNNING")) {
      throw new InvalidJobTransitionError(job.state, "RUNNING");
    }

    const prevState = job.state;
    job.state = "RUNNING";
    job.updatedAtMs = now;
    job.fencingGeneration = (job.fencingGeneration ?? 0) + 1;

    this.workerClaims.set(jobId, {
      workerId,
      claimedAtMs: now,
      leaseExpiresAtMs: now + leaseDurationMs,
      fencingGeneration: job.fencingGeneration,
    });
    this.saveLeases();

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId,
      fromState: prevState,
      toState: "RUNNING",
      timestampMs: now,
      milestoneIndex: job.currentMilestoneIndex,
      progressPercent: job.progressPercent,
      workerId,
      fencingGeneration: job.fencingGeneration,
      reason: "Worker claimed job",
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  async pauseForUser(jobId: string, reason: string, cwd?: string, workerId?: string, fencingGeneration?: number): Promise<PersistentAgentJob> {
    this.load();
    this.loadLeases();
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");

    if (fencingGeneration !== undefined && job.fencingGeneration !== undefined && fencingGeneration !== job.fencingGeneration) {
      throw new StaleWorkerFenceError(jobId, job.fencingGeneration, fencingGeneration);
    }

    if (!isPermittedTransition(job.state, "PAUSED_FOR_USER")) {
      throw new InvalidJobTransitionError(job.state, "PAUSED_FOR_USER");
    }

    const now = this.clock();
    let gitHash: string | undefined;

    // Flush current safe workspace checkpoint if cwd provided
    if (cwd && existsSync(cwd)) {
      try {
        const hash = await snapshot(job.botId, cwd, `Paused for user authorization: ${reason}`);
        if (hash) gitHash = hash;
      } catch {}
    }

    const checkpointData = { reason, pausedAt: now };

    // Flush safe checkpoint payload to disk
    this.writeCheckpointPayload(jobId, job.currentMilestoneIndex, {
      jobId,
      botId: job.botId,
      milestoneIndex: job.currentMilestoneIndex,
      milestoneTitle: `Milestone ${job.currentMilestoneIndex} (Paused)`,
      progressPercent: job.progressPercent,
      gitCheckpointHash: gitHash,
      state: "PAUSED_FOR_USER",
      timestampMs: now,
      checksum: this.computeChecksum(checkpointData),
      data: checkpointData,
    });

    const prevState = job.state;
    job.state = "PAUSED_FOR_USER";
    job.updatedAtMs = now;

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId,
      fromState: prevState,
      toState: "PAUSED_FOR_USER",
      timestampMs: now,
      milestoneIndex: job.currentMilestoneIndex,
      progressPercent: job.progressPercent,
      checkpointHash: gitHash,
      workerId,
      fencingGeneration: job.fencingGeneration,
      reason,
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  resumeFromUser(jobId: string, userActionConfirmed: boolean): PersistentAgentJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");

    if (!userActionConfirmed) {
      throw new JobValidationError("Cannot resume job without confirmed user authorization", "userActionConfirmed");
    }

    if (!isPermittedTransition(job.state, "RUNNING")) {
      throw new InvalidJobTransitionError(job.state, "RUNNING");
    }

    // Reload and validate checkpoint
    const checkpoint = this.readCheckpointPayload(job.checkpointPayloadPath);
    if (!checkpoint || checkpoint.jobId !== jobId) {
      throw new CorruptJobCheckpointError("Checkpoint validation failed upon user resume", { jobId, path: job.checkpointPayloadPath });
    }

    const now = this.clock();
    const prevState = job.state;
    job.state = "RUNNING";
    job.updatedAtMs = now;

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId,
      fromState: prevState,
      toState: "RUNNING",
      timestampMs: now,
      milestoneIndex: job.currentMilestoneIndex,
      progressPercent: job.progressPercent,
      fencingGeneration: job.fencingGeneration,
      reason: "User authorization confirmed, resumed from safe checkpoint",
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  blockDependency(jobId: string, reason: string): PersistentAgentJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");

    if (!isPermittedTransition(job.state, "BLOCKED_DEPENDENCY")) {
      throw new InvalidJobTransitionError(job.state, "BLOCKED_DEPENDENCY");
    }

    const now = this.clock();
    const prevState = job.state;
    job.state = "BLOCKED_DEPENDENCY";
    job.updatedAtMs = now;

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId,
      fromState: prevState,
      toState: "BLOCKED_DEPENDENCY",
      timestampMs: now,
      milestoneIndex: job.currentMilestoneIndex,
      progressPercent: job.progressPercent,
      fencingGeneration: job.fencingGeneration,
      reason,
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  unblockDependency(jobId: string): PersistentAgentJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");

    if (!isPermittedTransition(job.state, "RUNNING")) {
      throw new InvalidJobTransitionError(job.state, "RUNNING");
    }

    const now = this.clock();
    const prevState = job.state;
    job.state = "RUNNING";
    job.updatedAtMs = now;

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId,
      fromState: prevState,
      toState: "RUNNING",
      timestampMs: now,
      milestoneIndex: job.currentMilestoneIndex,
      progressPercent: job.progressPercent,
      fencingGeneration: job.fencingGeneration,
      reason: "Dependency unblocked",
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  async advanceMilestone(input: {
    jobId: string;
    milestoneIndex: number;
    milestoneTitle: string;
    progressPercent: number;
    data?: Record<string, unknown>;
    cwd?: string;
    workerId?: string;
    fencingGeneration?: number;
  }): Promise<PersistentAgentJob> {
    this.load();
    this.loadLeases();
    const job = this.jobs.get(input.jobId);
    if (!job) throw new JobValidationError(`Job not found: ${input.jobId}`, "jobId");

    if (job.state !== "RUNNING") {
      throw new JobValidationError(`Cannot advance milestone while job is in ${job.state} state`, "state");
    }

    // Fencing check
    if (input.fencingGeneration !== undefined && job.fencingGeneration !== undefined && input.fencingGeneration !== job.fencingGeneration) {
      throw new StaleWorkerFenceError(input.jobId, job.fencingGeneration, input.fencingGeneration);
    }

    const now = this.clock();
    if (input.workerId) {
      const claim = this.workerClaims.get(input.jobId);
      if (claim && (claim.workerId !== input.workerId || claim.leaseExpiresAtMs < now)) {
        throw new StaleWorkerFenceError(input.jobId, claim?.fencingGeneration ?? job.fencingGeneration ?? 1, input.fencingGeneration ?? 0);
      }
    }

    if (input.milestoneIndex < job.currentMilestoneIndex) {
      throw new JobValidationError(
        `Cannot move milestone index backwards from ${job.currentMilestoneIndex} to ${input.milestoneIndex}`,
        "milestoneIndex"
      );
    }

    let gitHash: string | undefined;

    if (input.cwd && existsSync(input.cwd)) {
      try {
        const hash = await snapshot(job.botId, input.cwd, `Milestone ${input.milestoneIndex}: ${input.milestoneTitle}`);
        if (hash) gitHash = hash;
      } catch {}
    }

    const newCheckpointPath = getSafeCheckpointPath(input.jobId, input.milestoneIndex, this.checkpointsDir);

    const payload: JobCheckpointPayload = {
      jobId: input.jobId,
      botId: job.botId,
      milestoneIndex: input.milestoneIndex,
      milestoneTitle: input.milestoneTitle,
      progressPercent: input.progressPercent,
      gitCheckpointHash: gitHash,
      state: "RUNNING",
      timestampMs: now,
      checksum: this.computeChecksum(input.data ?? {}),
      data: input.data ?? {},
    };

    this.writeCheckpointPayload(input.jobId, input.milestoneIndex, payload);

    const prevState = job.state;
    job.currentMilestoneIndex = input.milestoneIndex;
    job.progressPercent = Math.min(100, Math.max(0, input.progressPercent));
    job.checkpointPayloadPath = newCheckpointPath;
    job.updatedAtMs = now;

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId: input.jobId,
      fromState: prevState,
      toState: "RUNNING",
      timestampMs: now,
      milestoneIndex: input.milestoneIndex,
      progressPercent: job.progressPercent,
      checkpointHash: gitHash,
      workerId: input.workerId,
      fencingGeneration: job.fencingGeneration,
      reason: `Committed milestone ${input.milestoneIndex}: ${input.milestoneTitle}`,
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  completeJob(jobId: string, resultData?: Record<string, unknown>, workerId?: string, fencingGeneration?: number): PersistentAgentJob {
    this.load();
    this.loadLeases();
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");

    if (fencingGeneration !== undefined && job.fencingGeneration !== undefined && fencingGeneration !== job.fencingGeneration) {
      throw new StaleWorkerFenceError(jobId, job.fencingGeneration, fencingGeneration);
    }

    if (!isPermittedTransition(job.state, "COMPLETED")) {
      throw new InvalidJobTransitionError(job.state, "COMPLETED");
    }

    const now = this.clock();
    const prevState = job.state;
    job.state = "COMPLETED";
    job.progressPercent = 100;
    job.completedAtMs = now;
    job.updatedAtMs = now;

    if (resultData) {
      this.writeCheckpointPayload(jobId, job.currentMilestoneIndex, {
        jobId,
        botId: job.botId,
        milestoneIndex: job.currentMilestoneIndex,
        milestoneTitle: `Milestone ${job.currentMilestoneIndex} (Completed)`,
        progressPercent: 100,
        state: "COMPLETED",
        timestampMs: now,
        checksum: this.computeChecksum(resultData),
        data: resultData,
      });
    }

    this.workerClaims.delete(jobId);
    this.saveLeases();

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId,
      fromState: prevState,
      toState: "COMPLETED",
      timestampMs: now,
      milestoneIndex: job.currentMilestoneIndex,
      progressPercent: 100,
      workerId,
      fencingGeneration: job.fencingGeneration,
      reason: "Success verified, job completed and archived",
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  failJob(jobId: string, failureReason: string, workerId?: string, fencingGeneration?: number): PersistentAgentJob {
    this.load();
    this.loadLeases();
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");

    if (fencingGeneration !== undefined && job.fencingGeneration !== undefined && fencingGeneration !== job.fencingGeneration) {
      throw new StaleWorkerFenceError(jobId, job.fencingGeneration, fencingGeneration);
    }

    if (!isPermittedTransition(job.state, "FAILED")) {
      throw new InvalidJobTransitionError(job.state, "FAILED");
    }

    // Sanitize failure reason: strip bearer tokens or API keys
    const sanitizedReason = failureReason
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      .replace(/sk-[A-Za-z0-9_-]+/gi, "sk-[REDACTED]");

    const now = this.clock();
    const prevState = job.state;
    job.state = "FAILED";
    job.failureReason = sanitizedReason;
    job.updatedAtMs = now;

    this.workerClaims.delete(jobId);
    this.saveLeases();

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId,
      fromState: prevState,
      toState: "FAILED",
      timestampMs: now,
      milestoneIndex: job.currentMilestoneIndex,
      progressPercent: job.progressPercent,
      workerId,
      fencingGeneration: job.fencingGeneration,
      reason: sanitizedReason,
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  cancelJob(jobId: string, reason = "User cancelled job"): PersistentAgentJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobValidationError(`Job not found: ${jobId}`, "jobId");

    if (!isPermittedTransition(job.state, "CANCELLED")) {
      throw new InvalidJobTransitionError(job.state, "CANCELLED");
    }

    const now = this.clock();
    const prevState = job.state;
    job.state = "CANCELLED";
    job.updatedAtMs = now;

    this.workerClaims.delete(jobId);
    this.saveLeases();

    // WAL: append journal and flush FIRST
    this.appendJournal({
      jobId,
      fromState: prevState,
      toState: "CANCELLED",
      timestampMs: now,
      milestoneIndex: job.currentMilestoneIndex,
      progressPercent: job.progressPercent,
      fencingGeneration: job.fencingGeneration,
      reason,
      jobSnapshot: { ...job },
    });

    this.save();
    return { ...job };
  }

  // ───────────────────────────────────────────────
  // Checkpoint Storage, Integrity, and Recovery
  // ───────────────────────────────────────────────

  writeCheckpointPayload(jobId: string, milestoneIndex: number, payload: JobCheckpointPayload): string {
    const filePath = getSafeCheckpointPath(jobId, milestoneIndex, this.checkpointsDir);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileAtomic(filePath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
    return filePath;
  }

  readCheckpointPayload(filePath: string): JobCheckpointPayload | null {
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content) as JobCheckpointPayload;
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.jobId !== "string" || typeof parsed.milestoneIndex !== "number") return null;
      // Validate checksum if data is present
      if (parsed.checksum && parsed.data) {
        const expected = this.computeChecksum(parsed.data);
        if (expected !== parsed.checksum) {
          throw new CorruptJobCheckpointError("Checksum mismatch in checkpoint payload", { filePath });
        }
      }
      return parsed;
    } catch (err) {
      if (err instanceof CorruptJobCheckpointError) throw err;
      throw new CorruptJobCheckpointError(`Failed to parse checkpoint payload: ${(err as Error).message}`, { filePath });
    }
  }

  /**
   * Deterministic recovery protocol:
   * Inspects job state after a process restart or crash.
   * If current checkpoint is corrupt, rolls back to previous valid milestone snapshot in server/checkpoints.ts.
   */
  async recoverJob(jobId: string, cwd?: string): Promise<{
    recovered: boolean;
    job?: PersistentAgentJob;
    rolledBack?: boolean;
    error?: string;
  }> {
    const job = this.jobs.get(jobId);
    if (!job) return { recovered: false, error: "Job not found" };

    // Terminal jobs remain terminal: cannot be revived
    if (job.state === "COMPLETED" || job.state === "FAILED" || job.state === "CANCELLED") {
      return { recovered: true, job: { ...job }, rolledBack: false };
    }

    try {
      // Validate current checkpoint
      const cp = this.readCheckpointPayload(job.checkpointPayloadPath);
      if (!cp) {
        throw new CorruptJobCheckpointError("Checkpoint file missing on disk", { path: job.checkpointPayloadPath });
      }

      // Checkpoint is healthy
      return { recovered: true, job: { ...job }, rolledBack: false };
    } catch (err) {
      // Detected corruption -> classify as ERR_CORRUPT_JOB_CHECKPOINT
      console.warn(`PersistentJobManager: Detected corrupted checkpoint for job ${jobId}, initiating rollback`, err);

      const rollback = await this.rollbackToPreviousMilestone(jobId, cwd);
      if (rollback.ok && rollback.job) {
        return {
          recovered: true,
          job: rollback.job,
          rolledBack: true,
        };
      }

      // Rollback failed -> transition safely to FAILED with ERR_CORRUPT_JOB_CHECKPOINT
      const failedJob = this.failJob(jobId, `${ERR_CORRUPT_JOB_CHECKPOINT}: Checkpoint corrupted and no valid previous snapshot available`);
      return {
        recovered: false,
        job: failedJob,
        error: ERR_CORRUPT_JOB_CHECKPOINT,
      };
    }
  }

  /**
   * Roll back corrupt checkpoint to the previous valid milestone snapshot.
   * Leverages server/checkpoints.ts restore() for workspace files when applicable.
   */
  async rollbackToPreviousMilestone(jobId: string, cwd?: string): Promise<{
    ok: boolean;
    job?: PersistentAgentJob;
    restoredMilestoneIndex?: number;
    error?: string;
  }> {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, error: "Job not found" };

    const currentIndex = job.currentMilestoneIndex;
    if (currentIndex <= 0) {
      return { ok: false, error: "No previous milestone available for rollback" };
    }

    // Search backwards for the most recent valid milestone checkpoint
    for (let idx = currentIndex - 1; idx >= 0; idx--) {
      const prevPath = getSafeCheckpointPath(jobId, idx, this.checkpointsDir);
      try {
        const prevPayload = this.readCheckpointPayload(prevPath);
        if (prevPayload && prevPayload.jobId === jobId) {
          // Found valid previous milestone!
          // If git checkpoint hash exists and cwd is provided, restore workspace files
          if (cwd && prevPayload.gitCheckpointHash) {
            try {
              const res = await restore(job.botId, cwd, prevPayload.gitCheckpointHash);
              if (!res.ok) {
                console.warn("PersistentJobManager: git restore reported issue during rollback", (res as { ok: false; error: string }).error);
              }
            } catch (gitErr) {
              console.warn("PersistentJobManager: Failed to restore git checkpoint", gitErr);
            }
          }

          const now = this.clock();
          job.currentMilestoneIndex = idx;
          job.progressPercent = prevPayload.progressPercent;
          job.checkpointPayloadPath = prevPath;
          job.state = "PAUSED_FOR_USER"; // Safe pause so user can inspect restored milestone
          job.updatedAtMs = now;
          this.save();

          this.appendJournal({
            jobId,
            fromState: "RUNNING",
            toState: "PAUSED_FOR_USER",
            timestampMs: now,
            milestoneIndex: idx,
            progressPercent: prevPayload.progressPercent,
            checkpointHash: prevPayload.gitCheckpointHash,
            reason: `Rolled back from corrupt milestone ${currentIndex} to safe milestone ${idx} (${prevPayload.milestoneTitle})`,
          });

          return {
            ok: true,
            job: { ...job },
            restoredMilestoneIndex: idx,
          };
        }
      } catch {
        // Continue searching earlier snapshots
      }
    }

    return { ok: false, error: "No valid previous snapshot found" };
  }

  getJob(jobId: string): PersistentAgentJob | null {
    const j = this.jobs.get(jobId);
    return j ? { ...j } : null;
  }

  listJobs(botId?: string): PersistentAgentJob[] {
    const all = Array.from(this.jobs.values()).map((j) => ({ ...j }));
    if (!botId) return all;
    return all.filter((j) => j.botId === botId);
  }

  deleteJob(jobId: string): boolean {
    const existed = this.jobs.delete(jobId);
    this.workerClaims.delete(jobId);
    if (existed) this.save();
    return existed;
  }

  clear(): void {
    this.jobs.clear();
    this.workerClaims.clear();
    this.save();
  }
}

export const sharedPersistentJobManager = new PersistentJobManager();
