import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export type ProactiveTriggerEvent =
  | "calendar_conflict"
  | "approaching_deadline"
  | "stale_dependency"
  | "weather_alert";

export interface ProactiveSuggestion {
  id: string;
  triggerEvent: ProactiveTriggerEvent;
  relevanceScore: number; // Must exceed 0.85 to surface
  headline: string;
  suggestedActionTitle: string;
  suggestedActionPayload: Record<string, unknown>;
  cooldownPeriodMs: number;
}

export const RELEVANCE_THRESHOLD = 0.85;
export const FOUR_HOURS_MS = 14_400_000; // 4 * 60 * 60 * 1000
export const FORTY_EIGHT_HOURS_MS = 172_800_000; // 48 * 60 * 60 * 1000

export const ERR_SUGGESTION_SPAM_DETECTED = "ERR_SUGGESTION_SPAM_DETECTED";

export class SuggestionSpamError extends Error {
  readonly code = ERR_SUGGESTION_SPAM_DETECTED;
  constructor(message = "Multiple proactive suggestions generated within cooldown window", readonly suggestionId?: string) {
    super(message);
    this.name = "SuggestionSpamError";
  }
}

export function validateProactiveSuggestion(val: unknown): val is ProactiveSuggestion {
  if (!val || typeof val !== "object") return false;
  const s = val as Record<string, unknown>;
  if (typeof s.id !== "string" || !s.id.trim()) return false;
  if (
    s.triggerEvent !== "calendar_conflict" &&
    s.triggerEvent !== "approaching_deadline" &&
    s.triggerEvent !== "stale_dependency" &&
    s.triggerEvent !== "weather_alert"
  ) {
    return false;
  }
  if (typeof s.relevanceScore !== "number" || isNaN(s.relevanceScore)) return false;
  if (typeof s.headline !== "string" || !s.headline.trim()) return false;
  if (typeof s.suggestedActionTitle !== "string" || !s.suggestedActionTitle.trim()) return false;
  if (!s.suggestedActionPayload || typeof s.suggestedActionPayload !== "object") return false;
  if (typeof s.cooldownPeriodMs !== "number" || isNaN(s.cooldownPeriodMs)) return false;
  return true;
}

/**
 * Computes a deterministic deduplication key grounded in the underlying event
 * attributes (meeting IDs, task IDs, package name, etc.) rather than volatile random UUIDs.
 */
export function computeDeduplicationKey(suggestion: {
  triggerEvent: ProactiveTriggerEvent;
  suggestedActionPayload?: Record<string, unknown>;
  headline?: string;
}): string {
  const payload = suggestion.suggestedActionPayload ?? {};

  switch (suggestion.triggerEvent) {
    case "calendar_conflict": {
      const ids: string[] = [];
      if (payload.meetingA && typeof payload.meetingA === "object") {
        ids.push(String((payload.meetingA as any).id ?? "a"));
      }
      if (payload.meetingB && typeof payload.meetingB === "object") {
        ids.push(String((payload.meetingB as any).id ?? "b"));
      }
      if (Array.isArray(payload.eventIds)) {
        ids.push(...payload.eventIds.map(String));
      }
      if (ids.length > 0) {
        return `calendar_conflict::${ids.sort().join("::")}`;
      }
      const startTime = payload.conflictTime ?? payload.startTime ?? "";
      return `calendar_conflict::${startTime}::${(suggestion.headline || "").trim().toLowerCase()}`;
    }

    case "approaching_deadline": {
      const taskId = payload.taskId ?? payload.id ?? "";
      if (taskId) {
        return `approaching_deadline::${taskId}`;
      }
      return `approaching_deadline::${(suggestion.headline || "").trim().toLowerCase()}`;
    }

    case "stale_dependency": {
      const pkg = payload.packageName ?? payload.name ?? "";
      const targetVersion = payload.latestVersion ?? payload.latest ?? "";
      if (pkg) {
        return `stale_dependency::${pkg}::${targetVersion}`;
      }
      return `stale_dependency::${(suggestion.headline || "").trim().toLowerCase()}`;
    }

    case "weather_alert": {
      const alertEvent = payload.event ?? payload.alertType ?? "";
      const date = payload.effectiveUntil ? new Date(Number(payload.effectiveUntil)).toISOString().slice(0, 10) : "";
      if (alertEvent) {
        return `weather_alert::${alertEvent}::${date}`;
      }
      return `weather_alert::${(suggestion.headline || "").trim().toLowerCase()}`;
    }

    default: {
      const canonical = JSON.stringify(payload, Object.keys(payload).sort());
      const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
      return `${suggestion.triggerEvent}::${hash}`;
    }
  }
}

export interface SurfaceSuggestionOptions {
  isCritical?: boolean;
  userTurnActive?: boolean;
  now?: number;
}

export type AlertSeverityLevel = "critical" | "warning" | "advisory" | "minor" | "unknown";

export interface AlertSeverityClassification {
  isCritical: boolean;
  severityLevel: AlertSeverityLevel;
  reason: string;
}

/**
 * Authoritative severity policy for proactive intelligence.
 * Distinguishes genuinely critical alerts (e.g. active life-safety emergencies,
 * severe active weather with future expiration, critical CVE vulnerabilities)
 * from routine advisories or ordinary warnings.
 *
 * Roadmap Invariant: An alert cannot bypass the 4-hour cooldown merely by claiming
 * triggerEvent === "weather_alert" or passing a raw unverified boolean flag.
 */
export function classifyAlertSeverity(
  suggestion: ProactiveSuggestion,
  options?: { now?: number }
): AlertSeverityClassification {
  const now = options?.now ?? Date.now();
  const payload = suggestion.suggestedActionPayload ?? {};

  switch (suggestion.triggerEvent) {
    case "weather_alert": {
      const rawSeverity = typeof payload.severity === "string" ? payload.severity.toLowerCase().trim() : "";
      const effectiveUntil = typeof payload.effectiveUntil === "number" ? payload.effectiveUntil : undefined;
      const eventName = typeof payload.event === "string" ? payload.event.toLowerCase() : "";
      const alertType = typeof payload.alertType === "string" ? payload.alertType.toLowerCase() : "";
      const headline = typeof payload.headline === "string" ? payload.headline.toLowerCase() : "";
      const sHeadline = (suggestion.headline || "").toLowerCase();

      // Check expiration: expired weather alert cannot be critical
      if (effectiveUntil !== undefined && effectiveUntil <= now) {
        return {
          isCritical: false,
          severityLevel: "advisory",
          reason: `Weather alert has expired (effectiveUntil ${effectiveUntil} <= now ${now})`,
        };
      }

      // Explicit contradictory/non-critical severity in payload:
      if (rawSeverity === "advisory" || rawSeverity === "minor") {
        return {
          isCritical: false,
          severityLevel: rawSeverity,
          reason: `Routine weather ${rawSeverity} is not a critical emergency`,
        };
      }
      if (rawSeverity === "warning") {
        return {
          isCritical: false,
          severityLevel: "warning",
          reason: "Weather warning is elevated priority but does not qualify as immediate critical emergency",
        };
      }

      // Validated critical severity:
      const hasCriticalSeverity = rawSeverity === "critical";
      const hasEmergencyKeyword =
        eventName.includes("tornado") ||
        eventName.includes("flash flood") ||
        eventName.includes("hurricane") ||
        alertType.includes("tornado") ||
        alertType.includes("flash_flood") ||
        headline.includes("tornado") ||
        headline.includes("flash flood") ||
        sHeadline.includes("tornado") ||
        sHeadline.includes("flash flood");

      if (hasCriticalSeverity || (hasEmergencyKeyword && rawSeverity !== "warning")) {
        return {
          isCritical: true,
          severityLevel: "critical",
          reason: `Validated critical weather emergency (${eventName || alertType || "severe emergency"})`,
        };
      }

      return {
        isCritical: false,
        severityLevel: "unknown",
        reason: "Missing or unverified weather alert severity evidence",
      };
    }

    case "stale_dependency": {
      const rawSeverity = typeof payload.severity === "string" ? payload.severity.toLowerCase().trim() : "";
      if (rawSeverity === "critical") {
        return {
          isCritical: true,
          severityLevel: "critical",
          reason: "Critical security vulnerability advisory",
        };
      }
      return {
        isCritical: false,
        severityLevel: (rawSeverity as AlertSeverityLevel) || "advisory",
        reason: `Non-critical dependency advisory (${rawSeverity || "routine"})`,
      };
    }

    case "calendar_conflict":
    case "approaching_deadline":
    default: {
      return {
        isCritical: false,
        severityLevel: "advisory",
        reason: `Standard workflow suggestion (${suggestion.triggerEvent})`,
      };
    }
  }
}

export type ProactiveSuppressionReason =
  | "surfaced"
  | "suppressed_low_relevance"
  | "suppressed_cooldown"
  | "suppressed_dismissed"
  | "deferred_active_turn";

export interface SuggestionEvaluationResult {
  surfaced: boolean;
  reason: ProactiveSuppressionReason;
  suggestion: ProactiveSuggestion;
  error?: string;
  dedupKey: string;
}

interface SilentAttentionEntry {
  suggestion: ProactiveSuggestion;
  reason: string;
  timestamp: number;
  errorCode?: string;
  dedupKey: string;
}

interface ProactiveStateFile {
  version: 1;
  lastSurfacedTimestamp: number | null;
  activeSuggestions: ProactiveSuggestion[];
  dismissedEvents: Record<string, number>; // dedupKey -> dismissedAt
  silentAttentionQueue: SilentAttentionEntry[];
}

export class ProactiveIntelligenceManager {
  private readonly file: string;
  private readonly clock: () => number;
  private state: ProactiveStateFile;

  constructor(file?: string, clock?: () => number) {
    this.file = file ?? join(DATA_DIR, "proactive-intelligence.json");
    this.clock = clock ?? (() => Date.now());
    this.state = this.load();
  }

  private load(): ProactiveStateFile {
    if (!existsSync(this.file)) {
      return {
        version: 1,
        lastSurfacedTimestamp: null,
        activeSuggestions: [],
        dismissedEvents: {},
        silentAttentionQueue: [],
      };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as ProactiveStateFile;
      return {
        version: 1,
        lastSurfacedTimestamp: typeof parsed.lastSurfacedTimestamp === "number" ? parsed.lastSurfacedTimestamp : null,
        activeSuggestions: Array.isArray(parsed.activeSuggestions) ? parsed.activeSuggestions : [],
        dismissedEvents: parsed.dismissedEvents && typeof parsed.dismissedEvents === "object" ? parsed.dismissedEvents : {},
        silentAttentionQueue: Array.isArray(parsed.silentAttentionQueue) ? parsed.silentAttentionQueue : [],
      };
    } catch {
      return {
        version: 1,
        lastSurfacedTimestamp: null,
        activeSuggestions: [],
        dismissedEvents: {},
        silentAttentionQueue: [],
      };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  /**
   * Evaluate a candidate suggestion against relevance, cooldown, active turn, and dismissal gates.
   */
  evaluateSuggestion(
    suggestion: ProactiveSuggestion,
    options?: SurfaceSuggestionOptions
  ): SuggestionEvaluationResult {
    if (!validateProactiveSuggestion(suggestion)) {
      throw new Error("Invalid ProactiveSuggestion payload");
    }

    const now = options?.now ?? this.clock();
    const dedupKey = computeDeduplicationKey(suggestion);

    // Gate 1: Relevance Score Threshold
    // Roadmap Invariant: Must strictly exceed 0.85
    if (suggestion.relevanceScore <= RELEVANCE_THRESHOLD) {
      this.state.silentAttentionQueue.push({
        suggestion,
        reason: `Relevance score ${suggestion.relevanceScore} does not exceed threshold ${RELEVANCE_THRESHOLD}`,
        timestamp: now,
        dedupKey,
      });
      this.save();
      return {
        surfaced: false,
        reason: "suppressed_low_relevance",
        suggestion,
        dedupKey,
      };
    }

    // Gate 2: 48-Hour Dismissal Suppression
    // Roadmap Invariant: Dismissed suggestions must not re-trigger within 48 hours
    const dismissedAt = this.state.dismissedEvents[dedupKey];
    if (dismissedAt && now - dismissedAt < FORTY_EIGHT_HOURS_MS) {
      this.state.silentAttentionQueue.push({
        suggestion,
        reason: `Dismissed suggestion suppressed within 48-hour window (dismissed ${Math.round((now - dismissedAt) / 3600000)}h ago)`,
        timestamp: now,
        dedupKey,
      });
      this.save();
      return {
        surfaced: false,
        reason: "suppressed_dismissed",
        suggestion,
        dedupKey,
      };
    }

    // Gate 3: Active User Turn Protection
    // Roadmap Anti-Pattern: Never interrupt an active user turn with an unrelated proactive suggestion
    if (options?.userTurnActive) {
      this.state.silentAttentionQueue.push({
        suggestion,
        reason: "Deferred proactive suggestion during active user turn",
        timestamp: now,
        dedupKey,
      });
      this.save();
      return {
        surfaced: false,
        reason: "deferred_active_turn",
        suggestion,
        dedupKey,
      };
    }

    // Gate 4: 4-Hour Cooldown Window & Rate Limiting
    // Roadmap Invariant: Maximum of one proactive suggestion every 4 hours unless classified as critical
    const severityClassification = classifyAlertSeverity(suggestion, { now });
    // Defensible severity policy: Only a validated critical alert can bypass the 4-hour cooldown.
    // If caller specifies options?.isCritical = true, but classifyAlertSeverity classifies it as non-critical
    // (e.g. routine advisory, expired alert, ordinary warning, or missing evidence), the critical bypass is rejected.
    const isCritical = severityClassification.isCritical;
    if (!isCritical && this.state.lastSurfacedTimestamp !== null) {
      const elapsed = now - this.state.lastSurfacedTimestamp;
      if (elapsed < FOUR_HOURS_MS) {
        // Failure classification: ERR_SUGGESTION_SPAM_DETECTED
        // Recovery: Rate limiter suppresses notification, logs event to silent attention queue
        this.state.silentAttentionQueue.push({
          suggestion,
          reason: `Spam rate limit: Last suggestion was surfaced ${Math.round(elapsed / 60000)} minutes ago (cooldown is 4h)`,
          timestamp: now,
          errorCode: ERR_SUGGESTION_SPAM_DETECTED,
          dedupKey,
        });
        this.save();
        return {
          surfaced: false,
          reason: "suppressed_cooldown",
          error: ERR_SUGGESTION_SPAM_DETECTED,
          suggestion,
          dedupKey,
        };
      }
    }

    // All gates passed: surface the suggestion
    this.state.lastSurfacedTimestamp = now;
    this.state.activeSuggestions.unshift(suggestion);
    if (this.state.activeSuggestions.length > 50) {
      this.state.activeSuggestions.splice(50);
    }
    this.save();

    return {
      surfaced: true,
      reason: "surfaced",
      suggestion,
      dedupKey,
    };
  }

  /**
   * Mark a suggestion or dedupKey as dismissed. Suppresses recurrence for 48 hours.
   */
  dismissSuggestion(idOrDedupKey: string, now?: number): boolean {
    const timestamp = now ?? this.clock();
    let targetDedupKey = idOrDedupKey;

    const matched = this.state.activeSuggestions.find((s) => s.id === idOrDedupKey);
    if (matched) {
      targetDedupKey = computeDeduplicationKey(matched);
      this.state.activeSuggestions = this.state.activeSuggestions.filter((s) => s.id !== idOrDedupKey);
    }

    this.state.dismissedEvents[targetDedupKey] = timestamp;
    this.save();
    return true;
  }

  isDismissed(dedupKey: string, now?: number): boolean {
    const timestamp = now ?? this.clock();
    const dismissedAt = this.state.dismissedEvents[dedupKey];
    return Boolean(dismissedAt && timestamp - dismissedAt < FORTY_EIGHT_HOURS_MS);
  }

  isInCooldown(now?: number, suggestionOrIsCritical: boolean | ProactiveSuggestion = false): boolean {
    let isCritical = false;
    if (typeof suggestionOrIsCritical === "boolean") {
      isCritical = suggestionOrIsCritical;
    } else if (suggestionOrIsCritical) {
      isCritical = classifyAlertSeverity(suggestionOrIsCritical, { now }).isCritical;
    }
    if (isCritical) return false;
    if (this.state.lastSurfacedTimestamp === null) return false;
    const timestamp = now ?? this.clock();
    return timestamp - this.state.lastSurfacedTimestamp < FOUR_HOURS_MS;
  }

  getLastSurfacedTimestamp(): number | null {
    return this.state.lastSurfacedTimestamp;
  }

  getActiveSuggestions(): ProactiveSuggestion[] {
    return [...this.state.activeSuggestions];
  }

  getSilentAttentionQueue(): SilentAttentionEntry[] {
    return [...this.state.silentAttentionQueue];
  }

  clear(): void {
    this.state = {
      version: 1,
      lastSurfacedTimestamp: null,
      activeSuggestions: [],
      dismissedEvents: {},
      silentAttentionQueue: [],
    };
    this.save();
  }
}

export const sharedProactiveManager = new ProactiveIntelligenceManager();

/**
 * Detects calendar conflicts, specifically flagging upcoming overlaps
 * (e.g., 15 minutes before meeting) with a high relevance score.
 */
export function detectCalendarConflict(
  events: Array<{ id: string; title: string; start: number; end: number }>,
  now = Date.now()
): ProactiveSuggestion | null {
  if (!events || events.length < 2) return null;

  const sorted = [...events].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length - 1; i++) {
    const ev1 = sorted[i];
    const ev2 = sorted[i + 1];

    // Check overlap: ev1 ends after ev2 starts
    if (ev1.end > ev2.start) {
      const minutesUntilMeeting = Math.round((ev1.start - now) / 60000);
      // High urgency if meeting is in 15 minutes (or 0-30 minutes window)
      const isImminent = minutesUntilMeeting >= 0 && minutesUntilMeeting <= 30;
      const score = isImminent ? 0.92 : 0.86;

      return {
        id: randomUUID(),
        triggerEvent: "calendar_conflict",
        relevanceScore: score,
        headline: `Calendar Conflict: "${ev1.title}" overlaps with "${ev2.title}" in ${Math.max(1, minutesUntilMeeting)}m`,
        suggestedActionTitle: "Review meeting schedule and reschedule or notify attendees",
        suggestedActionPayload: {
          meetingA: { id: ev1.id, title: ev1.title, start: ev1.start, end: ev1.end },
          meetingB: { id: ev2.id, title: ev2.title, start: ev2.start, end: ev2.end },
          conflictStart: ev2.start,
          conflictEnd: Math.min(ev1.end, ev2.end),
        },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
    }
  }

  return null;
}

/**
 * Detects approaching task deadlines within the next 24 hours.
 */
export function detectApproachingDeadline(
  tasks: Array<{ id: string; title: string; deadline: number; completed?: boolean }>,
  now = Date.now()
): ProactiveSuggestion | null {
  const pending = tasks.filter((t) => !t.completed && t.deadline > now);
  if (pending.length === 0) return null;

  pending.sort((a, b) => a.deadline - b.deadline);
  const mostUrgent = pending[0];

  const hoursRemaining = (mostUrgent.deadline - now) / 3600000;
  if (hoursRemaining <= 24) {
    const score = hoursRemaining <= 4 ? 0.93 : 0.88;
    return {
      id: randomUUID(),
      triggerEvent: "approaching_deadline",
      relevanceScore: score,
      headline: `Approaching Deadline: "${mostUrgent.title}" is due in ${Math.max(1, Math.round(hoursRemaining))} hours`,
      suggestedActionTitle: "Prioritize remaining checklist items",
      suggestedActionPayload: {
        taskId: mostUrgent.id,
        title: mostUrgent.title,
        deadline: mostUrgent.deadline,
        hoursRemaining: Math.round(hoursRemaining * 10) / 10,
      },
      cooldownPeriodMs: FOUR_HOURS_MS,
    };
  }

  return null;
}

/**
 * Detects stale or vulnerable dependencies.
 * Critical/vulnerable packages exceed 0.85; non-urgent minor updates stay below 0.85.
 */
export function detectStaleDependency(
  packages: Array<{
    name: string;
    current: string;
    latest: string;
    isSecurityVulnerability?: boolean;
    severity?: "critical" | "high" | "moderate" | "low";
  }>
): ProactiveSuggestion | null {
  for (const pkg of packages) {
    if (pkg.isSecurityVulnerability) {
      const score = pkg.severity === "critical" ? 0.94 : 0.89;
      return {
        id: randomUUID(),
        triggerEvent: "stale_dependency",
        relevanceScore: score,
        headline: `Security Advisory: Package "${pkg.name}" has ${pkg.severity ?? "high"} vulnerability (current: ${pkg.current}, latest: ${pkg.latest})`,
        suggestedActionTitle: `Upgrade ${pkg.name} to version ${pkg.latest}`,
        suggestedActionPayload: {
          packageName: pkg.name,
          currentVersion: pkg.current,
          latestVersion: pkg.latest,
          severity: pkg.severity ?? "high",
        },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
    }
  }

  // Non-security minor upgrade: suppressed by relevance score (0.60 <= 0.85)
  if (packages.length > 0) {
    const pkg = packages[0];
    return {
      id: randomUUID(),
      triggerEvent: "stale_dependency",
      relevanceScore: 0.60,
      headline: `Package "${pkg.name}" has minor update available (${pkg.current} -> ${pkg.latest})`,
      suggestedActionTitle: `Update ${pkg.name}`,
      suggestedActionPayload: {
        packageName: pkg.name,
        currentVersion: pkg.current,
        latestVersion: pkg.latest,
      },
      cooldownPeriodMs: FOUR_HOURS_MS,
    };
  }

  return null;
}

/**
 * Detects severe weather alerts.
 * Severe/Warning events exceed 0.85; routine advisories stay below 0.85.
 */
export function detectWeatherAlert(
  alert: {
    event: string;
    severity: "critical" | "warning" | "advisory" | "minor";
    headline: string;
    effectiveUntil: number;
  }
): ProactiveSuggestion {
  const isSevere = alert.severity === "critical" || alert.severity === "warning";
  const score = alert.severity === "critical" ? 0.95 : alert.severity === "warning" ? 0.90 : 0.70;

  return {
    id: randomUUID(),
    triggerEvent: "weather_alert",
    relevanceScore: score,
    headline: `${isSevere ? "Severe " : ""}Weather Alert: ${alert.event} — ${alert.headline}`,
    suggestedActionTitle: "Review safety precautions and travel advisories",
    suggestedActionPayload: {
      event: alert.event,
      severity: alert.severity,
      headline: alert.headline,
      effectiveUntil: alert.effectiveUntil,
    },
    cooldownPeriodMs: FOUR_HOURS_MS,
  };
}

/**
 * Bridges a surfaced ProactiveSuggestion into the Store so it manifests in
 * Android's AttentionInbox.kt as an actionable item with activity: "waiting-on-you".
 *
 * Adheres strictly to Phase 14 Security: The suggested action is surfaced as a recommendation
 * requiring explicit user review/confirmation before state-changing execution occurs.
 */
export function publishSuggestionToAttention(
  store: any,
  botId: string,
  suggestion: ProactiveSuggestion
): { taskId: string; threadId: string } {
  const existingTasks = store.tasks?.(botId) ?? [];
  const alertTitle = `[Suggestion] ${suggestion.headline}`;

  let matchedTask = existingTasks.find((t: any) => t.title === alertTitle);
  let threadId = matchedTask?.threadId;

  if (!matchedTask) {
    // Create new dedicated task for the proactive suggestion
    threadId = randomUUID();
    if (typeof store.createTask === "function") {
      matchedTask = store.createTask(botId, {
        title: alertTitle,
        threadId,
      });
    }
  }

  if (threadId) {
    // Mark activity as "waiting-on-you" so AttentionInbox.kt displays ACTION NEEDED
    if (typeof store.setTaskActivity === "function") {
      store.setTaskActivity(botId, threadId, "waiting-on-you");
    }
    if (typeof store.setTaskUnread === "function") {
      store.setTaskUnread(botId, threadId, true);
    }
    // Also patch bot activity if appropriate
    if (typeof store.setActivity === "function") {
      store.setActivity(botId, "waiting-on-you");
    }
  }

  return {
    taskId: matchedTask?.id ?? threadId ?? "task-suggestion",
    threadId: threadId ?? "thread-suggestion",
  };
}
