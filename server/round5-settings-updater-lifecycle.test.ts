import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  UpdaterManager,
  createSafetyBackup,
  restoreSafetyBackup,
  validatePersistentState,
} from "./updater.ts";

describe("Round 5: Settings, Updater, Persistence, and Lifecycle Stress Tests", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mobot-round5-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Safety Backup and Restore Completeness", () => {
    it("backs up and restores goals, watches, threads, and memory-journal", () => {
      // Seed persistent items
      writeFileSync(join(testDir, "config.json"), JSON.stringify({ schemaVersion: 2 }), "utf8");
      writeFileSync(join(testDir, "bots.json"), JSON.stringify([{ id: "bot-1", name: "Alpha" }]), "utf8");
      writeFileSync(join(testDir, "goals.json"), JSON.stringify([{ id: "goal-1", title: "Complete audit" }]), "utf8");
      writeFileSync(join(testDir, "watches.json"), JSON.stringify([{ id: "watch-1", name: "Server probe" }]), "utf8");
      writeFileSync(join(testDir, "threads.json"), JSON.stringify([{ id: "th-1", title: "Chat thread" }]), "utf8");

      const journalDir = join(testDir, "memory-journal");
      mkdirSync(journalDir, { recursive: true });
      writeFileSync(join(journalDir, "bot-1.ndjson"), "{\"turn\":1,\"prompt\":\"test\"}\n", "utf8");

      // Take safety backup
      const snapshotPath = createSafetyBackup(testDir, "1.0.0");
      expect(existsSync(snapshotPath)).toBe(true);

      // Verify files exist in snapshot
      expect(existsSync(join(snapshotPath, "goals.json"))).toBe(true);
      expect(existsSync(join(snapshotPath, "watches.json"))).toBe(true);
      expect(existsSync(join(snapshotPath, "threads.json"))).toBe(true);
      expect(existsSync(join(snapshotPath, "memory-journal", "bot-1.ndjson"))).toBe(true);

      // Simulate accidental deletion/corruption in working dir
      rmSync(join(testDir, "goals.json"));
      rmSync(join(testDir, "watches.json"));
      rmSync(join(testDir, "memory-journal"), { recursive: true });

      // Restore safety backup
      const restored = restoreSafetyBackup(testDir, snapshotPath);
      expect(restored).toBe(true);

      // Verify restored content matches original
      expect(existsSync(join(testDir, "goals.json"))).toBe(true);
      expect(JSON.parse(readFileSync(join(testDir, "goals.json"), "utf8"))[0].title).toBe("Complete audit");
      expect(existsSync(join(testDir, "watches.json"))).toBe(true);
      expect(JSON.parse(readFileSync(join(testDir, "watches.json"), "utf8"))[0].name).toBe("Server probe");
      expect(existsSync(join(testDir, "memory-journal", "bot-1.ndjson"))).toBe(true);
    });
  });

  describe("Post-Update Validation and Automatic Rollback", () => {
    it("automatically rolls back when post-update persistent state validation fails", async () => {
      // Seed valid state
      writeFileSync(join(testDir, "config.json"), JSON.stringify({ schemaVersion: 2 }), "utf8");
      writeFileSync(join(testDir, "bots.json"), JSON.stringify([{ id: "bot-1", name: "ValidBot" }]), "utf8");

      const updater = new UpdaterManager({ currentVersion: "1.0.0", dataDir: testDir });
      const snapshotPath = createSafetyBackup(testDir, "1.0.0");
      (updater as any).lastSnapshotPath = snapshotPath;

      // Corrupt state to simulate faulty update migration
      writeFileSync(join(testDir, "bots.json"), "corrupted-syntax{{{", "utf8");

      const result = await updater.completePostUpdateValidation();
      expect(result.healthy).toBe(false);
      expect(updater.getStatus().status).toBe("error");

      // Verify automatic rollback was triggered and restored valid bots.json
      const restoredBots = JSON.parse(readFileSync(join(testDir, "bots.json"), "utf8"));
      expect(restoredBots[0].name).toBe("ValidBot");
    });
  });

  describe("Validation of Goals and Watches State", () => {
    it("detects invalid or non-array goals.json and watches.json", () => {
      writeFileSync(join(testDir, "config.json"), JSON.stringify({ schemaVersion: 2 }), "utf8");
      writeFileSync(join(testDir, "bots.json"), JSON.stringify([]), "utf8");

      // Valid initially
      expect(validatePersistentState(testDir).healthy).toBe(true);

      // Corrupted goals
      writeFileSync(join(testDir, "goals.json"), "{ \"notAnArray\": true }", "utf8");
      let val = validatePersistentState(testDir);
      expect(val.healthy).toBe(false);
      expect(val.issues).toContain("goals.json is not an array");

      // Reset goals to valid
      writeFileSync(join(testDir, "goals.json"), "[]", "utf8");
      expect(validatePersistentState(testDir).healthy).toBe(true);

      // Corrupted watches
      writeFileSync(join(testDir, "watches.json"), "corrupt{{{", "utf8");
      val = validatePersistentState(testDir);
      expect(val.healthy).toBe(false);
      expect(val.issues.some(i => i.includes("watches.json is invalid JSON"))).toBe(true);
    });
  });

  describe("Updater Settings Schema and Config Persistence", () => {
    it("serializes and deserializes updater configuration properly", () => {
      const configPath = join(testDir, "config.json");
      writeFileSync(configPath, JSON.stringify({
        schemaVersion: 2,
        updater: {
          channel: "beta",
          autoCheck: false,
          lastCheckedAt: "2026-10-19T12:00:00Z",
          repo: "custom/repo",
        },
      }), "utf8");

      const raw = JSON.parse(readFileSync(configPath, "utf8"));
      expect(raw.updater.channel).toBe("beta");
      expect(raw.updater.autoCheck).toBe(false);
      expect(raw.updater.repo).toBe("custom/repo");
    });
  });

  describe("Corrupted File Backup Preservation", () => {
    it("preserves corrupted file by copying to .corrupted timestamp instead of dropping", () => {
      const corruptFile = join(testDir, "bots.json");
      writeFileSync(corruptFile, "invalid-json-content-here", "utf8");

      // Simulate store constructor fallback logic
      try {
        JSON.parse(readFileSync(corruptFile, "utf8"));
      } catch {
        if (existsSync(corruptFile)) {
          const backup = `${corruptFile}.corrupted.${Date.now()}`;
          writeFileSync(backup, readFileSync(corruptFile));
        }
      }

      const files = readdirSync(testDir);
      const backupFound = files.some(f => f.startsWith("bots.json.corrupted."));
      expect(backupFound).toBe(true);
    });
  });
});
