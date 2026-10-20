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
