/** Routine wire shapes — the routine and run records as they ride the REST
 * snapshot and the `routine` / `routine.run` live frames. Moved verbatim
 * from the client's hand-maintained mirrors (src/lib/routines.ts) so the
 * frame union and every client consumer share one home; the client file
 * re-exports these under the same names. */
import type { RoutineCronSchedule } from "./routine-schedule.ts";

export interface RoutineIntervalWindow {
  start: string;
  end: string;
}

export type RoutineSchedule =
  | RoutineCronSchedule
  | { type: "once"; at: number }
  | { type: "daily"; time: string; weekdays: number[] }
  | {
    type: "interval";
    everyMinutes: number;
    anchorAt: number;
    /** Local weekdays (Sunday = 0). Missing means every day. */
    weekdays?: number[];
    /** Local wall-clock window. Missing means all day. */
    window?: RoutineIntervalWindow;
    /** Inclusive epoch-millisecond cutoff. Missing means never. */
    endsAt?: number;
  };

export type RoutineScheduleInput =
  | Extract<RoutineSchedule, { type: "once" | "daily" | "cron" }>
  | {
    type: "interval";
    everyMinutes: number;
    anchorAt: number;
    /** `null` explicitly restores the every-day default on updates. */
    weekdays?: number[] | null;
    /** `null` explicitly restores the all-day default on updates. */
    window?: RoutineIntervalWindow | null;
    /** `null` explicitly removes an existing end date on updates. */
    endsAt?: number | null;
  };

export type RoutineRunOn = "maus" | "cloud";

export type RoutineTarget = "bot" | "room-goal";
export type RoutineGoalStatus =
  | "completed"
  | "needs-input"
  | "blocked"
  | "limit-reached"
  | "paused"
  | "stopped"
  | "failed";

export interface RoutineContextAttachment {
  id: string;
  kind: "file" | "image";
  name: string;
  path: string;
  size: number;
}

export type RoutineRunTrigger = "schedule" | "manual" | "webhook";

export type RoutineRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "missed";

export type RoutineNotificationMode =
  | "normal"
  | "sound"
  | "vibrate"
  | "sound_vibrate"
  | "important"
  | "silent";

export type RoutineMissedRunPolicy = "run_next" | "skip" | "catch_up" | "ask";

export interface RoutineTriggerConfig {
  frequency: "once" | "daily" | "weekdays" | "weekends" | "weekly" | "interval" | "cron" | "custom";
  timeOfDay?: string;
  weekdays?: number[];
  timezone?: string;
  startDate?: number;
  endDate?: number;
  runCountLimit?: number;
  runCount?: number;
  missedRunPolicy?: RoutineMissedRunPolicy;
}

export interface RoutineWorkflowConfig {
  userIntent?: string;
  taskObjective?: string;
  requirements?: Record<string, unknown>;
  instructions?: string;
  capabilitiesRequired?: string[];
  sourceStrategy?: "primary_first" | "reputable" | "aggregators_for_discovery" | "any";
  filters?: Record<string, unknown>;
  rankingCriteria?: string[];
  verificationRequired?: boolean;
  freshnessWindowHours?: number;
  deduplicationPolicy?: "strict" | "canonical_url_or_id" | "none";
  changeDetectionOnly?: boolean;
  minResultsThreshold?: number;
  notifyIfEmpty?: boolean;
}

export interface RoutineDeliveryConfig {
  notificationMode?: RoutineNotificationMode;
  soundPreference?: string;
  vibrationPreference?: boolean;
  visualFlashPreference?: boolean;
  resultSurface?: "auto" | "cards" | "table" | "summary" | "notification";
  notificationPriority?: "normal" | "high" | "urgent";
  quietHours?: { start: string; end: string };
}

export interface RoutineExecutionConfig {
  model?: string;
  provider?: string;
  timeoutMinutes?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  failurePolicy?: "record_and_alert" | "silent_retry" | "pause_routine";
  partialResultPolicy?: "deliver_partial" | "fail_run";
}

export interface RoutineStateMemory {
  deliveredFingerprints?: string[];
  previousRunOutputSnippet?: string;
  lastSnapshotHash?: string;
  lastSnapshotContent?: string;
  totalItemsFound?: number;
  totalItemsDelivered?: number;
  totalRunsCompleted?: number;
  lastVerifiedAt?: number;
}

export interface RoutineHistorySummary {
  lastRunAt?: number;
  lastSuccessfulRunAt?: number;
  lastFailureAt?: number;
  lastDurationMs?: number;
  lastResultSummary?: string;
  itemsFound?: number;
  itemsDelivered?: number;
  lastError?: string;
  verificationStatus?: "verified" | "unverified" | "partial";
}

export interface RoutineItemRecord {
  id?: string;
  title: string;
  subtitle?: string;
  url?: string;
  applicationUrl?: string;
  company?: string;
  location?: string;
  sourceTier?: 1 | 2 | 3;
  sourceName?: string;
  verified?: boolean;
  verifiedAt?: number;
  verificationNote?: string;
  snippet?: string;
  fingerprint: string;
  isNew?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  taskObjective?: string;
  prompt: string;
  target: RoutineTarget;
  botId: string;
  groupId?: string;
  runOn: RoutineRunOn;
  enabled: boolean;
  schedule: RoutineSchedule;
  durationMinutes: number;
  /** Optional wall-clock safety limit. Missing means the run is unlimited. */
  timeoutMinutes?: number;
  attachments?: RoutineContextAttachment[];
  sourceThreadId?: string;
  resultsThreadId?: string;
  nextRunAt: number | null;
  triggerConfig?: RoutineTriggerConfig;
  workflowConfig?: RoutineWorkflowConfig;
  deliveryConfig?: RoutineDeliveryConfig;
  executionConfig?: RoutineExecutionConfig;
  stateMemory?: RoutineStateMemory;
  historySummary?: RoutineHistorySummary;
  createdAt: number;
  updatedAt: number;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  prompt?: string;
  durationMinutes?: number;
  timeoutMinutes?: number;
  attachments?: RoutineContextAttachment[];
  target: RoutineTarget;
  goalStatus?: RoutineGoalStatus;
  botId: string;
  groupId?: string;
  runOn: RoutineRunOn;
  scheduledFor: number;
  status: RoutineRunStatus;
  manual: boolean;
  triggerSource?: RoutineRunTrigger;
  webhookId?: string;
  deliveryId?: string;
  /** Room task created for a team-goal run. */
  executionThreadId?: string;
  sourceThreadId?: string;
  resultsThreadId?: string;
  threadId?: string;
  startedAt?: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  /** Concise, redacted question or approval reason while status is waiting. */
  attention?: string;
  cost?: number | null;
  denials?: string[];
  itemsFound?: number;
  itemsDelivered?: number;
  deliveredFingerprints?: string[];
  verificationStatus?: "verified" | "unverified" | "partial";
  changeDetected?: boolean;
  suppressedNotification?: boolean;
  structuredResults?: RoutineItemRecord[];
  createdAt: number;
  seenAt?: number;
}

export interface RoutineInput {
  name: string;
  description?: string;
  taskObjective?: string;
  prompt: string;
  target?: RoutineTarget;
  botId: string;
  groupId?: string | null;
  runOn?: RoutineRunOn;
  enabled?: boolean;
  schedule: RoutineScheduleInput;
  durationMinutes?: number;
  /** `null` explicitly removes the limit; omission preserves it on updates. */
  timeoutMinutes?: number | null;
  attachments?: RoutineContextAttachment[];
  /** Omission preserves routing; null creates a new dedicated results task. */
  resultsThreadId?: string | null;
  triggerConfig?: RoutineTriggerConfig;
  workflowConfig?: RoutineWorkflowConfig;
  deliveryConfig?: RoutineDeliveryConfig;
  executionConfig?: RoutineExecutionConfig;
  stateMemory?: RoutineStateMemory;
}


