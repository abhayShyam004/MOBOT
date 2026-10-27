import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RoutineMemoryRegistry,
  RoutineExecutionPromptBuilder,
  RoutinePostExecutionProcessor,
  RoutineSetupCoordinator,
  detectCalendarConflict,
  detectApproachingDeadline,
  detectStaleDependency,
  detectWeatherAlert,
  publishSuggestionToAttention,
  type ProactiveSuggestion,
  FOUR_HOURS_MS,
  RELEVANCE_THRESHOLD,
} from "./routine-engine.ts";
import type { Routine, RoutineRun } from "../../shared/routines.ts";
import { sharedObservability } from "./observability.ts";

describe("Routine Engine Upgrades", () => {
  let tempDir: string;
  let registry: RoutineMemoryRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "routine-engine-test-"));
    registry = new RoutineMemoryRegistry(tempDir);
    sharedObservability.clear();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("RoutineMemoryRegistry", () => {
    it("computes deterministic fingerprints from canonical URLs or metadata", () => {
      const fp1 = registry.computeFingerprint({
        title: "Senior Python Engineer",
        company: "Acme Corp",
        url: "https://jobs.acme.com/p/123?utm_source=feed",
      });
      const fp2 = registry.computeFingerprint({
        title: "Senior Python Engineer",
        company: "Acme Corp",
        url: "https://jobs.acme.com/p/123", // stripped utm
      });
      expect(fp1).toBe(fp2);
      expect(fp1).toHaveLength(64); // sha256 hex
    });

    it("saves and reloads state memory bounded to 500 items", () => {
      const routineId = "rot-mem-1";
      const fakeFingerprints = Array.from({ length: 550 }, (_, i) => `fp-${i}`);
      registry.saveMemory(routineId, {
        deliveredFingerprints: fakeFingerprints,
        lastSnapshotHash: "abc123hash",
        totalItemsFound: 550,
        totalItemsDelivered: 500,
        totalRunsCompleted: 5,
      });

      const loaded = registry.loadMemory(routineId);
      expect(loaded.totalRunsCompleted).toBe(5);
      expect(loaded.lastSnapshotHash).toBe("abc123hash");
      // Bounded to 500
      expect(loaded.deliveredFingerprints).toHaveLength(500);
      expect(loaded.deliveredFingerprints?.[499]).toBe("fp-549");
    });

    it("filters novel items accurately and flags seen ones", () => {
      const routineId = "rot-novel-1";
      const item1Fp = registry.computeFingerprint({ title: "Job A", url: "https://example.com/a" });
      registry.saveMemory(routineId, {
        deliveredFingerprints: [item1Fp],
        totalRunsCompleted: 1,
      });

      const items = [
        { title: "Job A", url: "https://example.com/a" },
        { title: "Job B", url: "https://example.com/b" },
      ];

      const filtered = registry.filterNovelItems(routineId, items);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].isNew).toBe(false);
      expect(filtered[1].isNew).toBe(true);
    });

    it("detects content changes via sha256 hash", () => {
      const routineId = "rot-diff-1";
      const initial = registry.detectChange(routineId, "Initial content state");
      expect(initial.changed).toBe(true);

      registry.saveMemory(routineId, {
        lastSnapshotHash: initial.newHash,
        totalRunsCompleted: 1,
      });

      const same = registry.detectChange(routineId, "Initial content state");
      expect(same.changed).toBe(false);

      const modified = registry.detectChange(routineId, "Updated content state");
      expect(modified.changed).toBe(true);
    });
  });

  describe("RoutineExecutionPromptBuilder", () => {
    const mockRoutine: Routine = {
      id: "rot-exec-1",
      name: "Daily AI Research Brief",
      prompt: "Find new papers on multimodal agents",
      botId: "bot-1",
      runOn: "maus",
      target: "bot",
      enabled: true,
      schedule: { type: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] },
      durationMinutes: 30,
      createdAt: 1000,
      updatedAt: 1000,
      nextRunAt: 2000,
      taskObjective: "Monitor and summarize breakthrough multimodal papers",
      workflowConfig: {
        sourceStrategy: "primary_first",
        freshnessWindowHours: 24,
        verificationRequired: true,
      },
      deliveryConfig: {
        notificationMode: "normal",
        resultSurface: "cards",
      },
    };

    it("builds a comprehensive prompt with tier mandates and active verification", () => {
      const prompt = RoutineExecutionPromptBuilder.buildPrompt(mockRoutine, {
        now: 1770000000000,
        manualRun: false,
      });

      expect(prompt).toContain("[ROUTINE EXECUTION RUN]");
      expect(prompt).toContain('Routine Name: "Daily AI Research Brief"');
      expect(prompt).toContain("Trigger: Scheduled Recurrence");
      expect(prompt).toContain("[PRIMARY OBJECTIVE]");
      expect(prompt).toContain("Monitor and summarize breakthrough multimodal papers");
      expect(prompt).toContain("[SOURCE HIERARCHY & QUALITY MANDATE]");
      expect(prompt).toContain("TIER 1 (Preferred / Authoritative)");
      expect(prompt).toContain("TIER 2 (Secondary)");
      expect(prompt).toContain("TIER 3 (Discovery Only)");
      expect(prompt).toContain("[ACTIVE VERIFICATION & TRUTHFULNESS]");
      expect(prompt).toContain("Never fabricate or assume an item is active");
    });

    it("incorporates state memory when previous runs exist", () => {
      const memory = {
        deliveredFingerprints: ["fp1", "fp2"],
        totalRunsCompleted: 3,
        lastSnapshotHash: "hash999",
        previousRunOutputSnippet: "Found paper on reasoning models yesterday.",
      };

      const prompt = RoutineExecutionPromptBuilder.buildPrompt(mockRoutine, {
        now: 1770000000000,
        manualRun: true,
        memory,
      });

      expect(prompt).toContain("Trigger: Manual (User Triggered Run Now)");
      expect(prompt).toContain("[ROUTINE STATE MEMORY — PREVIOUS RUN CONTEXT]");
      expect(prompt).toContain("This routine has completed 3 previous runs");
      expect(prompt).toContain("Previous content snapshot hash: hash999");
      expect(prompt).toContain("Found paper on reasoning models yesterday.");
    });
  });

  describe("RoutinePostExecutionProcessor", () => {
    const mockRoutine: Routine = {
      id: "rot-post-1",
      name: "Job Monitor",
      prompt: "Find remote typescript jobs",
      botId: "bot-1",
      runOn: "maus",
      target: "bot",
      enabled: true,
      schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] },
      durationMinutes: 30,
      createdAt: 1000,
      updatedAt: 1000,
      nextRunAt: 2000,
      workflowConfig: {
        notifyIfEmpty: false,
      },
      deliveryConfig: {
        notificationMode: "normal",
      },
    };

    it("suppresses notification when no items found and notifyIfEmpty is false", () => {
      const run: RoutineRun = {
        id: "run-empty-1",
        routineId: mockRoutine.id,
        routineName: mockRoutine.name,
        prompt: mockRoutine.prompt,
        botId: mockRoutine.botId,
        runOn: "maus",
        target: "bot",
        status: "completed",
        scheduledFor: 1000,
        createdAt: 1000,
        manual: false,
        output: "Searched career portals. No new job openings found matching the criteria today.",
      };

      const result = RoutinePostExecutionProcessor.processCompletedRun(mockRoutine, run, registry);
      expect(result.itemsFound).toBe(0);
      expect(result.suppressNotification).toBe(true);

      const events = sharedObservability.getEvents();
      const suppressed = events.find((e: { type: string; payload?: any }) => e.type === "ROUTINE_NOTIFICATION_SUPPRESSED");
      expect(suppressed).toBeDefined();
      expect(suppressed?.payload.reason).toBe("empty_result");
    });

    it("extracts and delivers verified items and does not suppress notification", () => {
      const run: RoutineRun = {
        id: "run-items-1",
        routineId: mockRoutine.id,
        routineName: mockRoutine.name,
        prompt: mockRoutine.prompt,
        botId: mockRoutine.botId,
        runOn: "maus",
        target: "bot",
        status: "completed",
        scheduledFor: 1000,
        createdAt: 1000,
        manual: false,
        output: `### Found Opportunities:
1. Senior TypeScript Engineer
- Company: Acme Corp
- Location: Remote
- Link: https://jobs.acme.com/senior-ts
- Verification: Verified Active

2. Backend Lead
- Company: Zeta Systems
- Location: Remote
- Link: https://zeta.io/careers/backend-lead
- Verification: Verified Active`,
      };

      const result = RoutinePostExecutionProcessor.processCompletedRun(mockRoutine, run, registry);
      expect(result.itemsFound).toBeGreaterThanOrEqual(1);
      expect(result.suppressNotification).toBe(false);
      expect(result.verificationStatus).toBe("verified");

      const events = sharedObservability.getEvents();
      const discovered = events.find((e: { type: string; payload?: any }) => e.type === "ROUTINE_ITEMS_DISCOVERED");
      expect(discovered).toBeDefined();
      expect(discovered?.payload.itemsFound).toBeGreaterThanOrEqual(1);
    });
  });

  describe("RoutineSetupCoordinator (Conversational Sequential Discovery)", () => {
    it("generates sequential step-by-step questions without overwhelming the user", () => {
      // Step 1: Initial user intent
      const q1 = RoutineSetupCoordinator.getNextStep({});
      expect(q1.step).toBe("topic_or_role");
      expect(q1.question?.options.length).toBeGreaterThanOrEqual(4);

      // Step 2: Topic answered
      const q2 = RoutineSetupCoordinator.getNextStep({ topicOrRole: "AI and Machine Learning" });
      expect(q2.step).toBe("filters");
      expect(q2.question?.options.length).toBeGreaterThanOrEqual(4);

      // Step 3: Filters answered
      const q3 = RoutineSetupCoordinator.getNextStep({
        topicOrRole: "AI and Machine Learning",
        filters: "Research papers and breakthrough models",
      });
      expect(q3.step).toBe("frequency");
      expect(q3.question?.options.map((o: any) => o.id)).toContain("daily");

      // Step 4: Frequency answered
      const q4 = RoutineSetupCoordinator.getNextStep({
        topicOrRole: "AI and Machine Learning",
        filters: "Research papers and breakthrough models",
        frequency: "daily",
      });
      expect(q4.step).toBe("time");
      expect(q4.question?.options.some((o: any) => o.id?.includes(":00"))).toBe(true);

      // Step 5: Time answered
      const q5 = RoutineSetupCoordinator.getNextStep({
        topicOrRole: "AI and Machine Learning",
        filters: "Research papers and breakthrough models",
        frequency: "daily",
        time: "08:00",
      });
      expect(q5.step).toBe("end_condition");

      // Step 6: End condition answered
      const q6 = RoutineSetupCoordinator.getNextStep({
        topicOrRole: "AI and Machine Learning",
        filters: "Research papers and breakthrough models",
        frequency: "daily",
        time: "08:00",
        endCondition: "indefinite",
      });
      expect(q6.step).toBe("delivery_mode");

      // Step 7: Delivery mode answered -> complete!
      const q7 = RoutineSetupCoordinator.getNextStep({
        topicOrRole: "AI and Machine Learning",
        filters: "Research papers and breakthrough models",
        frequency: "daily",
        time: "08:00",
        endCondition: "indefinite",
        deliveryMode: "on_new_items",
      });
      expect(q7.step).toBe("confirm");
      expect(q7.preview?.schedule?.type).toBe("daily");
      expect(q7.preview?.deliveryConfig?.notificationMode).toBe("normal");
      expect(q7.preview?.workflowConfig?.notifyIfEmpty).toBe(false);
    });
  });

  describe("Official Roadmap Phase 19: Proactive Intelligence Detectors & Attention Integration", () => {
    const fixedNow = 1710000000000;

    it("detects imminent calendar conflict 15 minutes before meeting with high relevance (> 0.85)", () => {
      // Meeting A starts in 15 minutes (fixedNow + 15m), lasts 45 minutes
      const meetingA = {
        id: "event-a-standup",
        title: "Sprint Planning",
        start: fixedNow + 15 * 60 * 1000,
        end: fixedNow + 60 * 60 * 1000,
      };

      // Meeting B starts in 30 minutes (overlaps with Meeting A)
      const meetingB = {
        id: "event-b-client",
        title: "Client Sync",
        start: fixedNow + 30 * 60 * 1000,
        end: fixedNow + 75 * 60 * 1000,
      };

      const suggestion = detectCalendarConflict([meetingA, meetingB], fixedNow);
      expect(suggestion).not.toBeNull();
      if (!suggestion) return;

      expect(suggestion.triggerEvent).toBe("calendar_conflict");
      expect(suggestion.relevanceScore).toBeGreaterThan(RELEVANCE_THRESHOLD); // strictly > 0.85
      expect(suggestion.relevanceScore).toBe(0.92);
      expect(suggestion.headline).toContain("Sprint Planning");
      expect(suggestion.headline).toContain("Client Sync");
      expect(suggestion.suggestedActionTitle).toContain("reschedule");
      expect(suggestion.suggestedActionPayload.meetingA).toBeDefined();
      expect(suggestion.suggestedActionPayload.meetingB).toBeDefined();
    });

    it("returns null for non-overlapping calendar events", () => {
      const event1 = {
        id: "ev1",
        title: "Morning Review",
        start: fixedNow + 10 * 60 * 1000,
        end: fixedNow + 30 * 60 * 1000,
      };
      const event2 = {
        id: "ev2",
        title: "Afternoon Sync",
        start: fixedNow + 60 * 60 * 1000,
        end: fixedNow + 90 * 60 * 1000,
      };

      const suggestion = detectCalendarConflict([event1, event2], fixedNow);
      expect(suggestion).toBeNull();
    });

    it("detects approaching task deadline within 24 hours with high relevance", () => {
      const tasks = [
        { id: "t1", title: "Quarterly Taxes", deadline: fixedNow + 2 * 3600 * 1000, completed: false },
        { id: "t2", title: "Next Month Planning", deadline: fixedNow + 120 * 3600 * 1000, completed: false },
      ];

      const suggestion = detectApproachingDeadline(tasks, fixedNow);
      expect(suggestion).not.toBeNull();
      if (!suggestion) return;

      expect(suggestion.triggerEvent).toBe("approaching_deadline");
      expect(suggestion.relevanceScore).toBeGreaterThan(RELEVANCE_THRESHOLD);
      expect(suggestion.headline).toContain("Quarterly Taxes");
      expect(suggestion.suggestedActionPayload.taskId).toBe("t1");
    });

    it("differentiates stale dependency security advisory from routine minor updates", () => {
      // Security vulnerability: exceeds 0.85
      const secPkg = [
        {
          name: "jsonwebtoken",
          current: "8.5.1",
          latest: "9.0.0",
          isSecurityVulnerability: true,
          severity: "high" as const,
        },
      ];
      const secSug = detectStaleDependency(secPkg);
      expect(secSug).not.toBeNull();
      expect(secSug?.relevanceScore).toBeGreaterThan(RELEVANCE_THRESHOLD);
      expect(secSug?.headline).toContain("Security Advisory");

      // Routine minor bump: stays below 0.85 (0.60)
      const minorPkg = [
        {
          name: "prettier",
          current: "3.1.0",
          latest: "3.1.1",
          isSecurityVulnerability: false,
        },
      ];
      const minorSug = detectStaleDependency(minorPkg);
      expect(minorSug).not.toBeNull();
      expect(minorSug?.relevanceScore).toBeLessThanOrEqual(RELEVANCE_THRESHOLD); // 0.60 <= 0.85
    });

    it("detects severe weather alerts above 0.85 and routine advisories below 0.85", () => {
      const severeAlert = detectWeatherAlert({
        event: "Severe Thunderstorm Warning",
        severity: "warning",
        headline: "High winds and hail expected",
        effectiveUntil: fixedNow + 4 * 3600 * 1000,
      });
      expect(severeAlert.relevanceScore).toBeGreaterThan(RELEVANCE_THRESHOLD); // 0.90 > 0.85

      const routineAdvisory = detectWeatherAlert({
        event: "Light Rain Advisory",
        severity: "advisory",
        headline: "Intermittent drizzle",
        effectiveUntil: fixedNow + 4 * 3600 * 1000,
      });
      expect(routineAdvisory.relevanceScore).toBeLessThanOrEqual(RELEVANCE_THRESHOLD); // 0.70 <= 0.85
    });

    it("publishes proactive suggestion to store with activity: 'waiting-on-you' for AttentionInbox.kt", () => {
      const mockTasks: any[] = [];
      let recordedActivity: string | undefined;
      let recordedUnread: boolean | undefined;

      const mockStore = {
        tasks: () => mockTasks,
        createTask: (_botId: string, input: any) => {
          const t = { id: input.threadId, threadId: input.threadId, title: input.title };
          mockTasks.push(t);
          return t;
        },
        setTaskActivity: (_botId: string, _threadId: string, activity: string) => {
          recordedActivity = activity;
        },
        setTaskUnread: (_botId: string, _threadId: string, unread: boolean) => {
          recordedUnread = unread;
        },
        setActivity: (_botId: string, _activity: string) => {},
      };

      const suggestion: ProactiveSuggestion = {
        id: "sug-inbox-test",
        triggerEvent: "calendar_conflict",
        relevanceScore: 0.92,
        headline: 'Conflict: "Sprint Sync" overlaps with "Design Review" in 15m',
        suggestedActionTitle: "Reschedule one of the meetings",
        suggestedActionPayload: { meetingId: "sync-1" },
        cooldownPeriodMs: FOUR_HOURS_MS,
      };

      const res = publishSuggestionToAttention(mockStore, "bot-12", suggestion);
      expect(res.threadId).toBeDefined();
      expect(mockTasks.length).toBe(1);
      expect(mockTasks[0].title).toBe('[Suggestion] Conflict: "Sprint Sync" overlaps with "Design Review" in 15m');
      expect(recordedActivity).toBe("waiting-on-you");
      expect(recordedUnread).toBe(true);

      // Verify Phase 14 Security Gate: The suggested action payload is NOT automatically executed
      expect(suggestion.suggestedActionPayload.meetingId).toBe("sync-1");
      // The store does not execute any mutation without explicit user confirmation
    });
  });
});
