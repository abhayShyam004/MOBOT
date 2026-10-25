import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GoalManager } from "./goals.ts";
import { WatchManager } from "./watches.ts";
import {
  loadUserLocation,
  saveUserLocation,
  clearUserLocation,
  resolveEffectiveLocation,
  type UserLocation,
} from "./location-context.ts";
import {
  ERR_MEMORY_HASH_MISMATCH,
  MemoryStoreError,
  createMemoryRecord,
  loadMemoryRecords,
  reconcileMemoryRecord,
  retrieveMemoryRecords,
  saveMemoryRecords,
  verifyMemoryRecordHash,
  type StoredMemoryRecord,
} from "./memory-store.ts";
import { flushMemoryJournal, readMemoryReconciliationJournal } from "./memory-journal.ts";
import { parseMemoryPath } from "./memory-store.ts";

describe("Round 4: Bots, Memory, Goals, Watches, Automations and Cross-Context State", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omb-round4-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Goals Lifecycle and Integrity", () => {
    it("creates, edits, completes milestones and tasks, and calculates progress correctly", () => {
      const goalsFile = join(tempDir, "goals.json");
      const manager = new GoalManager(goalsFile);

      const goal = manager.createGoal({
        botId: "bot-alpha",
        title: "Launch Mobile App",
        objective: "Ship v1 to testers",
        milestones: [
          {
            title: "Milestone 1: UI Implementation",
            tasks: [{ title: "Design screens" }, { title: "Wire navigation" }],
          },
          {
            title: "Milestone 2: Release Build",
            tasks: [{ title: "Build APK" }, { title: "Test on device" }],
          },
        ],
      });

      expect(goal.progress).toBe(0);
      expect(goal.status).toBe("active");
      expect(goal.nextAction).toBe("Start: Milestone 1: UI Implementation");

      // Complete task 1 in milestone 1
      const m1 = goal.milestones[0];
      const t1 = m1.tasks[0];
      const afterTask1 = manager.completeTask(goal.id, m1.id, t1.id);
      expect(afterTask1).not.toBeNull();
      // Milestone 1 is half done (1 of 2 tasks), total milestones 2 -> 25% progress
      expect(afterTask1!.progress).toBe(25);

      // Complete task 2 in milestone 1 -> Milestone 1 completes
      const t2 = m1.tasks[1];
      const afterTask2 = manager.completeTask(goal.id, m1.id, t2.id);
      expect(afterTask2!.progress).toBe(50);
      expect(afterTask2!.milestones[0].completed).toBe(true);
      // nextAction should advance to next pending milestone
      expect(afterTask2!.nextAction).toBe("Next: Milestone 2: Release Build");

      // Complete entire milestone 2
      const m2 = goal.milestones[1];
      const afterM2 = manager.completeMilestone(goal.id, m2.id);
      expect(afterM2!.progress).toBe(100);
      expect(afterM2!.status).toBe("completed");
      expect(afterM2!.nextAction).toBe("Goal fully achieved!");
    });

    it("survives manager reload and persists on disk", () => {
      const goalsFile = join(tempDir, "goals.json");
      const manager1 = new GoalManager(goalsFile);
      const created = manager1.createGoal({
        botId: "bot-beta",
        title: "Persistent Goal",
        objective: "Persist across reboots",
      });

      const manager2 = new GoalManager(goalsFile);
      const loaded = manager2.getGoal(created.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe("Persistent Goal");
      expect(loaded!.botId).toBe("bot-beta");
    });

    it("cleans up all goals for a bot when deleteGoalsForBot is called", () => {
      const goalsFile = join(tempDir, "goals.json");
      const manager = new GoalManager(goalsFile);

      manager.createGoal({ botId: "bot-doomed", title: "Goal 1", objective: "Obj 1" });
      manager.createGoal({ botId: "bot-doomed", title: "Goal 2", objective: "Obj 2" });
      manager.createGoal({ botId: "bot-survivor", title: "Survivor Goal", objective: "Obj S" });

      expect(manager.listGoals("bot-doomed")).toHaveLength(2);
      expect(manager.listGoals("bot-survivor")).toHaveLength(1);

      // Calling deleteGoalsForBot should remove all goals belonging to bot-doomed
      const removed = manager.deleteGoalsForBot("bot-doomed");
      expect(removed).toBe(2);

      expect(manager.listGoals("bot-doomed")).toHaveLength(0);
      expect(manager.listGoals("bot-survivor")).toHaveLength(1);

      // Verify persistence across reload
      const reloaded = new GoalManager(goalsFile);
      expect(reloaded.listGoals("bot-doomed")).toHaveLength(0);
      expect(reloaded.listGoals("bot-survivor")).toHaveLength(1);
    });
  });

  describe("Watches Lifecycle, Probing, and Integrity", () => {
    it("creates, updates, pauses, and resumes watches", () => {
      const watchesFile = join(tempDir, "watches.json");
      const manager = new WatchManager(watchesFile);

      const watch = manager.createWatch({
        botId: "bot-gamma",
        target: "https://example.com/api/status",
        condition: "status != 200",
        cadenceMinutes: 10,
      });

      expect(watch.status).toBe("active");
      expect(watch.cadenceMinutes).toBe(10);
      expect(watch.source).toBe("web");

      manager.pauseWatch(watch.id);
      expect(manager.getWatch(watch.id)?.status).toBe("paused");

      manager.resumeWatch(watch.id);
      expect(manager.getWatch(watch.id)?.status).toBe("active");
    });

    it("does not trigger or execute a paused watch during checkWatch", async () => {
      const watchesFile = join(tempDir, "watches.json");
      const manager = new WatchManager(watchesFile);

      let probeCalled = false;
      manager.setCheckHandler(async () => {
        probeCalled = true;
        return { state: "down", triggered: true, note: "simulated failure" };
      });

      const watch = manager.createWatch({
        botId: "bot-gamma",
        target: "https://example.com/api/health",
        condition: "down",
      });

      manager.pauseWatch(watch.id);
      expect(manager.getWatch(watch.id)?.status).toBe("paused");

      // Checking a paused watch should not trigger or overwrite paused status
      const checkResult = await manager.checkWatch(watch.id);
      expect(probeCalled).toBe(false);
      expect(checkResult).not.toBeNull();
      expect(checkResult!.triggered).toBe(false);
      expect(manager.getWatch(watch.id)?.status).toBe("paused");
    });

    it("cleans up all watches for a bot when deleteWatchesForBot is called", () => {
      const watchesFile = join(tempDir, "watches.json");
      const manager = new WatchManager(watchesFile);

      manager.createWatch({ botId: "bot-dead", target: "https://a.com", condition: "down" });
      manager.createWatch({ botId: "bot-dead", target: "https://b.com", condition: "error" });
      manager.createWatch({ botId: "bot-alive", target: "https://c.com", condition: "ok" });

      expect(manager.listWatches("bot-dead")).toHaveLength(2);
      expect(manager.listWatches("bot-alive")).toHaveLength(1);

      const removed = manager.deleteWatchesForBot("bot-dead");
      expect(removed).toBe(2);

      expect(manager.listWatches("bot-dead")).toHaveLength(0);
      expect(manager.listWatches("bot-alive")).toHaveLength(1);

      const reloaded = new WatchManager(watchesFile);
      expect(reloaded.listWatches("bot-dead")).toHaveLength(0);
      expect(reloaded.listWatches("bot-alive")).toHaveLength(1);
    });
  });

  describe("Location Provenance Across Bot/Conversation Contexts", () => {
    it("never persists conversation location into durable storage", () => {
      clearUserLocation(tempDir);
      expect(loadUserLocation(tempDir)).toBeNull();

      const convLocation: UserLocation = {
        city: "Kyoto",
        country: "Japan",
        provenance: "CONVERSATION_CONTEXT",
      };

      const resolved = resolveEffectiveLocation({
        userText: "what is the weather here?",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: convLocation,
      });

      expect(resolved.effectiveLocation?.city).toBe("Kyoto");
      expect(resolved.effectiveLocation?.provenance).toBe("CONVERSATION_CONTEXT");

      // Verify that durable storage remains completely empty
      expect(loadUserLocation(tempDir)).toBeNull();
    });

    it("does not leak conversation location into a different bot or conversation", () => {
      clearUserLocation(tempDir);

      // Bot A has conversationLocation "Kyoto" in thread 1
      const botAConvLocation: UserLocation = {
        city: "Kyoto",
        country: "Japan",
        provenance: "CONVERSATION_CONTEXT",
      };

      const botAResolved = resolveEffectiveLocation({
        userText: "what is my location?",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: botAConvLocation,
      });
      expect(botAResolved.effectiveLocation?.city).toBe("Kyoto");

      // Bot B in thread 2 has no conversation location
      const botBResolved = resolveEffectiveLocation({
        userText: "what is my location?",
        liveDeviceLocation: null,
        savedUserLocation: null,
        conversationLocation: null, // different conversation has null
      });

      expect(botBResolved.effectiveLocation).toBeNull();
      expect(botBResolved.reason).toContain("unavailable");
    });

    it("clearing saved user location leaves no lingering cache or fallback", () => {
      saveUserLocation(
        {
          city: "Berlin",
          country: "Germany",
          provenance: "SAVED_USER",
        },
        tempDir,
      );

      expect(loadUserLocation(tempDir)?.city).toBe("Berlin");

      clearUserLocation(tempDir);
      expect(loadUserLocation(tempDir)).toBeNull();

      const resolved = resolveEffectiveLocation({
        userText: "what is my location?",
        liveDeviceLocation: null,
        savedUserLocation: loadUserLocation(tempDir),
      });

      expect(resolved.effectiveLocation).toBeNull();
    });
  });

  describe("Cross-Bot Memory Isolation", () => {
    it("prevents traversal or access across bot workspace boundaries", () => {
      expect(() => parseMemoryPath("../other-bot/MEMORY.md")).toThrow();
      expect(() => parseMemoryPath("memory/../../etc/passwd")).toThrow();
      expect(() => parseMemoryPath("/absolute/path.md")).toThrow();
      expect(() => parseMemoryPath("")).toThrow();
    });
  });

  describe("Persistence Corruption & Error Recovery", () => {
    it("recovers gracefully from corrupted goals.json file", () => {
      const goalsFile = join(tempDir, "corrupt_goals.json");
      writeFileSync(goalsFile, "{ invalid json content !!!");

      const manager = new GoalManager(goalsFile);
      expect(manager.listGoals()).toEqual([]);

      // Writing a new goal heals the file
      const healed = manager.createGoal({
        botId: "bot-healed",
        title: "Healed Goal",
        objective: "Restore valid JSON",
      });
      expect(healed.title).toBe("Healed Goal");
      expect(JSON.parse(readFileSync(goalsFile, "utf8")).goals).toHaveLength(1);
    });

    it("recovers gracefully from corrupted watches.json file", () => {
      const watchesFile = join(tempDir, "corrupt_watches.json");
      writeFileSync(watchesFile, ">>> bad syntax <<<");

      const manager = new WatchManager(watchesFile);
      expect(manager.listWatches()).toEqual([]);

      const healed = manager.createWatch({
        botId: "bot-healed",
        target: "https://example.com",
        condition: "status != 200",
      });
      expect(healed.condition).toBe("status != 200");
      expect(JSON.parse(readFileSync(watchesFile, "utf8")).watches).toHaveLength(1);
    });

    it("handles non-existent or invalid entity IDs cleanly without throwing", async () => {
      const goalsFile = join(tempDir, "goals.json");
      const gManager = new GoalManager(goalsFile);
      expect(gManager.getGoal("non-existent-id")).toBeNull();
      expect(gManager.updateGoal("non-existent-id", { title: "New" })).toBeNull();
      expect(gManager.deleteGoal("non-existent-id")).toBe(false);
      expect(gManager.completeMilestone("non-existent-id", "non-existent-m")).toBeNull();
      expect(gManager.completeTask("non-existent-id", "non-existent-m", "non-existent-t")).toBeNull();

      const watchesFile = join(tempDir, "watches.json");
      const wManager = new WatchManager(watchesFile);
      expect(wManager.getWatch("non-existent-id")).toBeNull();
      expect(wManager.updateWatch("non-existent-id", { condition: "none" })).toBeNull();
      expect(wManager.deleteWatch("non-existent-id")).toBe(false);
      expect(wManager.pauseWatch("non-existent-id")).toBeNull();
      expect(wManager.resumeWatch("non-existent-id")).toBeNull();
      expect(await wManager.checkWatch("non-existent-id")).toBeNull();
    });
  });
});

describe("Round 4 x Phase 5: reconciliation state stress", () => {
  // This block is a sibling of the Round 4 suite, so it brings its own
  // throwaway workspace rather than borrowing one it cannot see. Each test
  // also gets its own bot id: the audit journal is per bot and lives under
  // the shared test home, so a fixed id would see the previous test's rows.
  let tempDir: string;
  let bot: string;
  let bots = 0;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omb-round4-recon-"));
    bot = `bot-recon-stress-${process.pid}-${bots++}`;
  });
  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function seed(dir: string): StoredMemoryRecord {
    const record = createMemoryRecord({
      botId: bot,
      category: "user_preference",
      headline: "User prefers TypeScript",
      detail: "The user prefers TypeScript for all projects.",
      confidence: 0.95,
      sourceTurnId: "turn-1",
    });
    saveMemoryRecords(bot, [record], { customWorkspaceDir: dir });
    return record;
  }

  function change(dir: string, recordId: string, detail: string, confidence = 0.96) {
    return reconcileMemoryRecord(
      bot,
      {
        actionType: "update",
        existingRecordId: recordId,
        replacementDetail: detail,
        justification: "explicit permanent change",
        contradictionEvidence: detail,
        confidenceScore: confidence,
      },
      { customWorkspaceDir: dir },
    );
  }

  it("survives rapid contradictory preference changes with one active answer", () => {
    const record = seed(tempDir);
    let current = change(tempDir, record.id, "The user prefers Python.");
    for (const detail of ["The user prefers Rust.", "The user prefers Go.", "The user prefers Kotlin."]) {
      current = change(tempDir, current.record!.id, detail);
    }
    const active = loadMemoryRecords(bot, { customWorkspaceDir: tempDir });
    expect(active).toHaveLength(1);
    expect(active[0].detail).toBe("The user prefers Kotlin.");
    expect(verifyMemoryRecordHash(active[0])).toBe(true);
    const all = loadMemoryRecords(bot, { customWorkspaceDir: tempDir, includeArchived: true });
    expect(all).toHaveLength(5);
    expect(all.filter((row) => row.lifecycle === "archived")).toHaveLength(4);
  });

  it("keeps a concurrent unrelated write when a reconciliation re-reads a changed store", () => {
    const record = seed(tempDir);
    const other = createMemoryRecord({
      botId: bot,
      category: "stable_identity",
      headline: "User name",
      detail: "The user is Abhay.",
      confidence: 0.99,
      sourceTurnId: "turn-2",
    });
    // a stale snapshot, then another writer appends
    const snapshot = loadMemoryRecords(bot, { customWorkspaceDir: tempDir, includeArchived: true, includeDeleted: true });
    saveMemoryRecords(bot, [...snapshot, other], { customWorkspaceDir: tempDir });

    const outcome = reconcileMemoryRecord(
      bot,
      {
        actionType: "update",
        existingRecordId: record.id,
        replacementDetail: "The user prefers Python.",
        justification: "explicit",
        contradictionEvidence: "switched permanently",
        confidenceScore: 0.96,
      },
      { customWorkspaceDir: tempDir, expectedFileHash: "0".repeat(64) },
    );
    expect(outcome.record?.detail).toContain("Python");
    const active = loadMemoryRecords(bot, { customWorkspaceDir: tempDir });
    expect(active.some((row) => row.id === other.id)).toBe(true);
  });

  it("refuses to resurrect a retired belief but keeps retain available on it", () => {
    const record = seed(tempDir);
    reconcileMemoryRecord(bot, {
      actionType: "archive",
      existingRecordId: record.id,
      justification: "retired",
      contradictionEvidence: "new preference",
      confidenceScore: 0.9,
    }, { customWorkspaceDir: tempDir });

    expect(() =>
      change(tempDir, record.id, "The user prefers Python."),
    ).toThrow(/already archived/);

    const retained = reconcileMemoryRecord(bot, {
      actionType: "retain",
      existingRecordId: record.id,
      justification: "history is unchanged",
      contradictionEvidence: "no new claim",
      confidenceScore: 0.6,
    }, { customWorkspaceDir: tempDir });
    expect(retained.record?.lifecycle).toBe("archived");
    expect(retrieveMemoryRecords(bot, "typescript", { customWorkspaceDir: tempDir })).toHaveLength(0);
  });

  it("surfaces a corrupted store instead of overwriting it", () => {
    seed(tempDir);
    writeFileSync(join(tempDir, "memory", "records.json"), "{ torn write");
    expect(() => loadMemoryRecords(bot, { customWorkspaceDir: tempDir })).toThrowError(MemoryStoreError);
    try {
      loadMemoryRecords(bot, { customWorkspaceDir: tempDir });
    } catch (error) {
      expect((error as MemoryStoreError).message).toContain(ERR_MEMORY_HASH_MISMATCH);
    }
    expect(readFileSync(join(tempDir, "memory", "records.json"), "utf8")).toBe("{ torn write");
  });

  it("restores reconciled state from disk after a restart", () => {
    const record = seed(tempDir);
    change(tempDir, record.id, "The user prefers Python.");
    // a fresh load is what a restarted process does
    const active = loadMemoryRecords(bot, { customWorkspaceDir: tempDir });
    expect(active).toHaveLength(1);
    expect(active[0].detail).toContain("Python");
    const archived = loadMemoryRecords(bot, { customWorkspaceDir: tempDir, includeArchived: true })
      .filter((row) => row.lifecycle === "archived");
    expect(archived).toHaveLength(1);
    expect(archived[0].detail).toContain("TypeScript");
    expect(verifyMemoryRecordHash(archived[0])).toBe(true);
  });

  it("keeps one audit row per reconciliation across concurrent decisions", async () => {
    const record = seed(tempDir);
    change(tempDir, record.id, "The user prefers Python.");
    const python = loadMemoryRecords(bot, { customWorkspaceDir: tempDir })[0];
    change(tempDir, python.id, "The user prefers Rust.");

    await flushMemoryJournal(bot);
    for (let attempt = 0; attempt < 100 && readMemoryReconciliationJournal(bot, 50).length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await flushMemoryJournal(bot);
    }
    const rows = readMemoryReconciliationJournal(bot, 50);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.action === "reconcile" && row.actionType === "update")).toBe(true);
    expect(rows[0].priorDetail).toContain("Python");
    expect(rows[1].priorDetail).toContain("TypeScript");
  });

  it("leaves no reconcilable state behind when a bot's workspace is removed", () => {
    seed(tempDir);
    const workspace = join(tempDir);
    rmSync(join(workspace, "memory"), { recursive: true, force: true });
    expect(loadMemoryRecords(bot, { customWorkspaceDir: workspace })).toEqual([]);
    // a reconciliation for the gone record is a clear 404, not a crash
    expect(() =>
      reconcileMemoryRecord(bot, {
        actionType: "retain",
        existingRecordId: "gone",
        justification: "j",
        contradictionEvidence: "e",
        confidenceScore: 0.5,
      }, { customWorkspaceDir: workspace }),
    ).toThrow(/no such memory record/);
  });
});
