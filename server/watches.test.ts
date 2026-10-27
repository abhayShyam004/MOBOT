import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WatchManager,
  ProactiveIntelligenceManager,
  type ProactiveSuggestion,
  FOUR_HOURS_MS,
  ERR_SUGGESTION_SPAM_DETECTED,
  computeDeduplicationKey,
  validateProactiveSuggestion,
} from "./watches.ts";

describe("WatchManager", () => {
  let tempDir: string;
  let file: string;
  let manager: WatchManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "watch-test-"));
    file = join(tempDir, "watches.json");
    manager = new WatchManager(file);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates, retrieves, and persists a watch condition", () => {
    const watch = manager.createWatch({
      botId: "bot-eval",
      target: "https://example.com/laptop",
      condition: "drops below ₹70,000",
      cadenceMinutes: 30,
      notificationPolicy: "on_change",
    });

    expect(watch.id).toBeDefined();
    expect(watch.status).toBe("active");
    expect(watch.cadenceMinutes).toBe(30);
    expect(watch.source).toBe("web");

    // Check persistence
    const reloaded = new WatchManager(file);
    const fetched = reloaded.getWatch(watch.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.condition).toBe("drops below ₹70,000");
  });

  it("checks a file watch and detects state change", async () => {
    const monitoredFile = join(tempDir, "monitored.txt");
    writeFileSync(monitoredFile, "initial content", "utf8");

    const watch = manager.createWatch({
      botId: "bot-eval",
      target: monitoredFile,
      condition: "content changed",
    });

    const check1 = await manager.checkWatch(watch.id);
    expect(check1?.changed).toBe(false);
    expect(check1?.currentState).toContain("sha256:");

    // Change file content
    writeFileSync(monitoredFile, "updated content with new data", "utf8");

    const check2 = await manager.checkWatch(watch.id);
    expect(check2?.changed).toBe(true);
    expect(check2?.previousState).toBe(check1?.currentState);

    // Verify history recorded
    const updated = manager.getWatch(watch.id);
    expect(updated?.history.length).toBe(2);
  });

  it("triggers condition when threshold is satisfied", async () => {
    const monitoredFile = join(tempDir, "price.txt");
    writeFileSync(monitoredFile, "Current Price: ₹65,000 in stock", "utf8");

    const watch = manager.createWatch({
      botId: "bot-eval",
      target: monitoredFile,
      condition: "price below ₹70,000",
    });

    const res = await manager.checkWatch(watch.id);
    expect(res?.triggered).toBe(true);
    const updated = manager.getWatch(watch.id);
    expect(updated?.status).toBe("triggered");
  });

  it("pauses, resumes, and deletes watches cleanly", () => {
    const watch = manager.createWatch({
      botId: "bot-eval",
      target: "https://example.com/item",
      condition: "in stock",
    });

    const paused = manager.pauseWatch(watch.id);
    expect(paused?.status).toBe("paused");

    const resumed = manager.resumeWatch(watch.id);
    expect(resumed?.status).toBe("active");

    const deleted = manager.deleteWatch(watch.id);
    expect(deleted).toBe(true);
    expect(manager.getWatch(watch.id)).toBeNull();
  });

  describe("Official Roadmap Phase 19: Proactive Intelligence Invariants", () => {
    let proactiveFile: string;
    let proactiveManager: ProactiveIntelligenceManager;
    let mockTime: number;

    beforeEach(() => {
      mockTime = 1700000000000;
      proactiveFile = join(tempDir, "proactive.json");
      proactiveManager = new ProactiveIntelligenceManager(proactiveFile, () => mockTime);
    });

    it("validates data contract schema correctly", () => {
      const valid: ProactiveSuggestion = {
        id: "sug-1",
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.92,
        headline: "Calendar Conflict Detected",
        suggestedActionTitle: "Reschedule meeting",
        suggestedActionPayload: { meetingId: "m123" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      expect(validateProactiveSuggestion(valid)).toBe(true);

      expect(validateProactiveSuggestion({ ...valid, relevanceScore: "high" })).toBe(false);
      expect(validateProactiveSuggestion({ ...valid, triggerEvent: "unknown_event" })).toBe(false);
      expect(validateProactiveSuggestion({ ...valid, headline: "" })).toBe(false);
      expect(validateProactiveSuggestion(null)).toBe(false);
    });

    it("computes deterministic deduplication keys across random UUID regenerations", () => {
      const suggestionA: ProactiveSuggestion = {
        id: "random-uuid-1",
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.92,
        headline: "Meeting Conflict",
        suggestedActionTitle: "Reschedule",
        suggestedActionPayload: {
          meetingA: { id: "meeting-alpha" },
          meetingB: { id: "meeting-beta" },
        },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };

      const suggestionB: ProactiveSuggestion = {
        id: "random-uuid-2", // different id
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.95,
        headline: "Different Headline but same meetings",
        suggestedActionTitle: "Reschedule",
        suggestedActionPayload: {
          meetingB: { id: "meeting-beta" },
          meetingA: { id: "meeting-alpha" }, // reversed order in payload
        },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };

      expect(computeDeduplicationKey(suggestionA)).toBe(computeDeduplicationKey(suggestionB));
      expect(computeDeduplicationKey(suggestionA)).toBe("calendar_conflict::meeting-alpha::meeting-beta");
    });

    it("enforces strict relevance threshold (> 0.85): 0.86 surfaces, 0.85 and 0.60 are suppressed", () => {
      // 0.85 must be suppressed (must strictly exceed 0.85)
      const borderline: ProactiveSuggestion = {
        id: "sug-borderline",
        triggerEvent: "approaching_deadline",
        relevanceScore: 0.85,
        headline: "Deadline Soon",
        suggestedActionTitle: "Review",
        suggestedActionPayload: { taskId: "task-1" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const resBorderline = proactiveManager.evaluateSuggestion(borderline, { now: mockTime });
      expect(resBorderline.surfaced).toBe(false);
      expect(resBorderline.reason).toBe("suppressed_low_relevance");

      // 0.60 (trivial observation) must be suppressed
      const trivial: ProactiveSuggestion = {
        id: "sug-trivial",
        triggerEvent: "stale_dependency",
        relevanceScore: 0.60,
        headline: "Minor patch bump available",
        suggestedActionTitle: "Bump version",
        suggestedActionPayload: { packageName: "lodash" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const resTrivial = proactiveManager.evaluateSuggestion(trivial, { now: mockTime });
      expect(resTrivial.surfaced).toBe(false);
      expect(resTrivial.reason).toBe("suppressed_low_relevance");

      // 0.86 strictly exceeds 0.85 and surfaces
      const highRelevance: ProactiveSuggestion = {
        id: "sug-high",
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.86,
        headline: "Imminent Overlap",
        suggestedActionTitle: "Fix overlap",
        suggestedActionPayload: { meetingA: { id: "m1" }, meetingB: { id: "m2" } },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const resHigh = proactiveManager.evaluateSuggestion(highRelevance, { now: mockTime });
      expect(resHigh.surfaced).toBe(true);
      expect(resHigh.reason).toBe("surfaced");
    });

    it("enforces 4-hour global cooldown and classifies violations as ERR_SUGGESTION_SPAM_DETECTED", () => {
      const sug1: ProactiveSuggestion = {
        id: "sug-1",
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.90,
        headline: "Conflict 1",
        suggestedActionTitle: "Action 1",
        suggestedActionPayload: { meetingA: { id: "m1" }, meetingB: { id: "m2" } },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const res1 = proactiveManager.evaluateSuggestion(sug1, { now: mockTime });
      expect(res1.surfaced).toBe(true);

      // Attempt 2: 1 hour later (mockTime + 3,600,000 ms) within the 4-hour cooldown
      mockTime += 3_600_000;
      const sug2: ProactiveSuggestion = {
        id: "sug-2",
        triggerEvent: "approaching_deadline",
        relevanceScore: 0.92,
        headline: "Deadline in 2 hours",
        suggestedActionTitle: "Action 2",
        suggestedActionPayload: { taskId: "task-urgent" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const res2 = proactiveManager.evaluateSuggestion(sug2, { now: mockTime });
      expect(res2.surfaced).toBe(false);
      expect(res2.reason).toBe("suppressed_cooldown");
      expect(res2.error).toBe(ERR_SUGGESTION_SPAM_DETECTED);

      // Verify event was safely logged to silent attention queue
      const silentQueue = proactiveManager.getSilentAttentionQueue();
      expect(silentQueue.some((e) => e.errorCode === ERR_SUGGESTION_SPAM_DETECTED)).toBe(true);

      // Attempt 3: Validated critical alert bypasses the 4-hour cooldown
      const sugCritical: ProactiveSuggestion = {
        id: "sug-critical",
        triggerEvent: "weather_alert",
        relevanceScore: 0.95,
        headline: "Tornado Warning",
        suggestedActionTitle: "Seek Shelter",
        suggestedActionPayload: { alertType: "tornado", severity: "critical", effectiveUntil: mockTime + 3600000 },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const resCritical = proactiveManager.evaluateSuggestion(sugCritical, { now: mockTime, isCritical: true });
      expect(resCritical.surfaced).toBe(true);

      // Attempt 4: 4 hours and 1 minute after last surface (mockTime + 4h 1m)
      mockTime += FOUR_HOURS_MS + 60_000;
      const sug4: ProactiveSuggestion = {
        id: "sug-4",
        triggerEvent: "stale_dependency",
        relevanceScore: 0.89,
        headline: "Security Advisory in Dependency",
        suggestedActionTitle: "Patch now",
        suggestedActionPayload: { packageName: "express", latestVersion: "5.0.0" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const res4 = proactiveManager.evaluateSuggestion(sug4, { now: mockTime });
      expect(res4.surfaced).toBe(true);
    });

    it("enforces 48-hour dismissal invariant across process restarts", () => {
      const suggestion: ProactiveSuggestion = {
        id: "sug-dismissable",
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.91,
        headline: "Conflict Alert",
        suggestedActionTitle: "Reschedule",
        suggestedActionPayload: { meetingA: { id: "meet-1" }, meetingB: { id: "meet-2" } },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };

      // Surface initial alert
      const res1 = proactiveManager.evaluateSuggestion(suggestion, { now: mockTime });
      expect(res1.surfaced).toBe(true);

      // User dismisses suggestion
      proactiveManager.dismissSuggestion(suggestion.id, mockTime);
      expect(proactiveManager.isDismissed("calendar_conflict::meet-1::meet-2", mockTime)).toBe(true);

      // Advance time by 24 hours (less than 48 hours)
      mockTime += 24 * 3_600_000;

      // Re-trigger candidate with new UUID for the same underlying meetings
      const candidateAgain: ProactiveSuggestion = {
        id: "brand-new-uuid-for-same-conflict",
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.94,
        headline: "Conflict Alert Repeated",
        suggestedActionTitle: "Reschedule",
        suggestedActionPayload: { meetingA: { id: "meet-1" }, meetingB: { id: "meet-2" } },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };

      // Reload manager from disk to verify persistence across restarts
      const reloadedManager = new ProactiveIntelligenceManager(proactiveFile, () => mockTime);
      const resSuppressed = reloadedManager.evaluateSuggestion(candidateAgain, { now: mockTime });
      expect(resSuppressed.surfaced).toBe(false);
      expect(resSuppressed.reason).toBe("suppressed_dismissed");

      // Advance past 48 hours (49 hours from dismissal)
      mockTime += 25 * 3_600_000;
      const resAllowed = reloadedManager.evaluateSuggestion(candidateAgain, { now: mockTime });
      expect(resAllowed.surfaced).toBe(true);
    });

    it("defers delivery during active user turns to protect conversational flow", () => {
      const suggestion: ProactiveSuggestion = {
        id: "sug-during-turn",
        triggerEvent: "weather_alert",
        relevanceScore: 0.90,
        headline: "Severe Weather Warning",
        suggestedActionTitle: "Check Advisory",
        suggestedActionPayload: { alertType: "flood" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };

      // Active user turn is ongoing: must defer
      const resDeferred = proactiveManager.evaluateSuggestion(suggestion, {
        now: mockTime,
        userTurnActive: true,
      });
      expect(resDeferred.surfaced).toBe(false);
      expect(resDeferred.reason).toBe("deferred_active_turn");

      // Once active turn finishes: surfaces cleanly
      const resDelivered = proactiveManager.evaluateSuggestion(suggestion, {
        now: mockTime,
        userTurnActive: false,
      });
      expect(resDelivered.surfaced).toBe(true);
    });

    it("integrates with WatchManager to evaluate proactive triggers", () => {
      const customWatchManager = new WatchManager(join(tempDir, "custom-watches.json"), proactiveManager);

      const suggestion: ProactiveSuggestion = {
        id: "watch-sug-1",
        triggerEvent: "stale_dependency",
        relevanceScore: 0.89,
        headline: "Critical Security Patch",
        suggestedActionTitle: "Update",
        suggestedActionPayload: { packageName: "openssl" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };

      const evalRes = customWatchManager.evaluateProactiveSuggestion(suggestion, { now: mockTime });
      expect(evalRes.surfaced).toBe(true);
      expect(evalRes.reason).toBe("surfaced");
    });

    it("adjudicates critical-alert exceptions with defensible severity classification", () => {
      const freshManager = new ProactiveIntelligenceManager(join(tempDir, "severity-test.json"), () => mockTime);

      // Baseline: Surface an initial non-critical suggestion to enter the 4-hour cooldown
      const baseSug: ProactiveSuggestion = {
        id: "base-1",
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.90,
        headline: "Team Sync Conflict",
        suggestedActionTitle: "Reschedule",
        suggestedActionPayload: { meetingA: { id: "sync-1" }, meetingB: { id: "sync-2" } },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const baseRes = freshManager.evaluateSuggestion(baseSug, { now: mockTime });
      expect(baseRes.surfaced).toBe(true);

      // 1. High relevance (0.91) but ordinary severity (warning) does NOT bypass 4-hour cooldown
      mockTime += 1_800_000; // 30 minutes into cooldown
      const ordinaryWarning: ProactiveSuggestion = {
        id: "warn-1",
        triggerEvent: "weather_alert",
        relevanceScore: 0.91,
        headline: "High Wind Warning",
        suggestedActionTitle: "Secure patio items",
        suggestedActionPayload: { event: "High Wind", severity: "warning", effectiveUntil: mockTime + 7200000 },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const warnRes = freshManager.evaluateSuggestion(ordinaryWarning, { now: mockTime, isCritical: true });
      expect(warnRes.surfaced).toBe(false);
      expect(warnRes.reason).toBe("suppressed_cooldown");

      // 2. weather_alert alone with advisory is NOT sufficient to bypass cooldown
      const advisory: ProactiveSuggestion = {
        id: "adv-1",
        triggerEvent: "weather_alert",
        relevanceScore: 0.88,
        headline: "Frost Advisory",
        suggestedActionTitle: "Protect plants",
        suggestedActionPayload: { event: "Frost", severity: "advisory", effectiveUntil: mockTime + 7200000 },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const advRes = freshManager.evaluateSuggestion(advisory, { now: mockTime, isCritical: true });
      expect(advRes.surfaced).toBe(false);
      expect(advRes.reason).toBe("suppressed_cooldown");

      // 3. Expired critical alert cannot bypass cooldown
      const expiredAlert: ProactiveSuggestion = {
        id: "crit-expired",
        triggerEvent: "weather_alert",
        relevanceScore: 0.96,
        headline: "Expired Tornado Warning",
        suggestedActionTitle: "Check status",
        suggestedActionPayload: { event: "Tornado Warning", severity: "critical", effectiveUntil: mockTime - 60000 },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const expRes = freshManager.evaluateSuggestion(expiredAlert, { now: mockTime, isCritical: true });
      expect(expRes.surfaced).toBe(false);
      expect(expRes.reason).toBe("suppressed_cooldown");

      // 4. Missing or contradictory severity evidence cannot bypass cooldown
      const contradictory: ProactiveSuggestion = {
        id: "contra-1",
        triggerEvent: "weather_alert",
        relevanceScore: 0.92,
        headline: "Unclear alert",
        suggestedActionTitle: "Review",
        suggestedActionPayload: { event: "Rain", severity: "minor" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const contraRes = freshManager.evaluateSuggestion(contradictory, { now: mockTime, isCritical: true });
      expect(contraRes.surfaced).toBe(false);
      expect(contraRes.reason).toBe("suppressed_cooldown");

      // 5. Validated critical alert (critical severity + future expiration) DOES bypass 4-hour cooldown
      const validCritical: ProactiveSuggestion = {
        id: "crit-valid",
        triggerEvent: "weather_alert",
        relevanceScore: 0.97,
        headline: "Severe Tornado Warning: Immediate Shelter Required",
        suggestedActionTitle: "Take shelter in basement",
        suggestedActionPayload: { event: "Tornado Warning", severity: "critical", effectiveUntil: mockTime + 3600000 },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const critRes = freshManager.evaluateSuggestion(validCritical, { now: mockTime });
      expect(critRes.surfaced).toBe(true);
      expect(critRes.reason).toBe("surfaced");

      // 6. Duplicate critical alerts are still deduplicated if dismissed
      freshManager.dismissSuggestion(validCritical.id, mockTime);
      const duplicateCritical: ProactiveSuggestion = {
        id: "crit-dup-new-uuid",
        triggerEvent: "weather_alert",
        relevanceScore: 0.97,
        headline: "Severe Tornado Warning: Immediate Shelter Required",
        suggestedActionTitle: "Take shelter in basement",
        suggestedActionPayload: validCritical.suggestedActionPayload,
        cooldownPeriodMs: FOUR_HOURS_MS,
      };
      const dupRes = freshManager.evaluateSuggestion(duplicateCritical, { now: mockTime + 1000 });
      expect(dupRes.surfaced).toBe(false);
      expect(dupRes.reason).toBe("suppressed_dismissed");
    });
  });
});
