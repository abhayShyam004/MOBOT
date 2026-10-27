import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  CURRENT_SCHEMA_VERSION,
  UpdaterManager,
  deriveVersionCode,
  isUpdateAvailable,
  runMigrations,
  validatePersistentState,
  type ReleaseManifest,
} from "./updater.ts";

describe("In-Place Upgrade & State Preservation Verification", () => {
  let testDataDir: string;

  beforeEach(() => {
    testDataDir = join(
      tmpdir(),
      `mobot-upgrade-preservation-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDataDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  it("proves monotonic versionCode ordering across 1.1.0, 1.1.1, and 1.1.2", () => {
    const code110 = deriveVersionCode("1.1.0");
    const code111 = deriveVersionCode("1.1.1");
    const code112 = deriveVersionCode("1.1.2");

    expect(code110).toBe(10100);
    expect(code111).toBe(10101);
    expect(code112).toBe(10102);

    expect(code111).toBeGreaterThan(code110);
    expect(code112).toBeGreaterThan(code111);

    // Prior version 1.1.0 detects 1.1.2 as available
    expect(
      isUpdateAvailable("1.1.0", "1.1.2", {
        currentVersionCode: code110,
        remoteVersionCode: code112,
        currentPackageName: "com.openmausbot.companion",
        targetPackageName: "com.openmausbot.companion",
      })
    ).toBe(true);

    // Prior version 1.1.1 detects 1.1.2 as available
    expect(
      isUpdateAvailable("1.1.1", "1.1.2", {
        currentVersionCode: code111,
        remoteVersionCode: code112,
        currentPackageName: "com.openmausbot.companion",
        targetPackageName: "com.openmausbot.companion",
      })
    ).toBe(true);

    // Installed version 1.1.2 detects 1.1.2 as up_to_date (no repeating prompt!)
    expect(
      isUpdateAvailable("1.1.2", "1.1.2", {
        currentVersionCode: code112,
        remoteVersionCode: code112,
        currentPackageName: "com.openmausbot.companion",
        targetPackageName: "com.openmausbot.companion",
      })
    ).toBe(false);

    // Installed version 1.1.3 detects remote 1.1.2 as up_to_date
    expect(
      isUpdateAvailable("1.1.3", "1.1.2", {
        currentVersionCode: 10103,
        remoteVersionCode: code112,
        currentPackageName: "com.openmausbot.companion",
        targetPackageName: "com.openmausbot.companion",
      })
    ).toBe(false);
  });

  it("strictly enforces package identity isolation so preview is never prompted to install production APK", () => {
    const previewToProduction = isUpdateAvailable("1.1.1-threads-preview", "1.1.2", {
      currentVersionCode: 10101,
      remoteVersionCode: 10102,
      currentPackageName: "com.openmausbot.companion.preview",
      targetPackageName: "com.openmausbot.companion",
    });
    expect(previewToProduction).toBe(false);

    const previewToSameBaseProduction = isUpdateAvailable("1.1.2-threads-preview", "1.1.2", {
      currentVersionCode: 10102,
      remoteVersionCode: 10102,
      currentPackageName: "com.openmausbot.companion.preview",
      targetPackageName: "com.openmausbot.companion",
    });
    expect(previewToSameBaseProduction).toBe(false);
  });

  it("preserves realistic v1.1.0 / v1.1.1 state (SQLite db, config, bots, memory, threads) across upgrade to v1.1.2", async () => {
    // 1. Seed realistic prior-version (v1.1.1) state
    const initialConfig = {
      theme: "dark",
      schemaVersion: 1,
      updater: { channel: "stable", autoCheck: true },
      agentPermissions: {
        version: 1,
        terminal: { enabled: true, autoConfirm: false },
        filesystem: { enabled: true, autoConfirm: false },
        browser: { enabled: true, autoConfirm: false },
        composio: { enabled: true, autoConfirm: false },
      },
    };
    writeFileSync(join(testDataDir, "config.json"), JSON.stringify(initialConfig, null, 2), "utf8");

    const botsData = [
      { id: "bot-chief", name: "Chief Assistant", role: "coordinator", model: "claude-3-7-sonnet" },
      { id: "bot-researcher", name: "Researcher", role: "analyst", model: "gpt-4o" },
    ];
    writeFileSync(join(testDataDir, "bots.json"), JSON.stringify(botsData, null, 2), "utf8");

    const goalsData = [
      { id: "goal-1", title: "Audit update pipeline", completed: false },
      { id: "goal-2", title: "Release v1.1.2", completed: true },
    ];
    writeFileSync(join(testDataDir, "goals.json"), JSON.stringify(goalsData, null, 2), "utf8");

    const watchesData = [{ id: "watch-net", name: "Network connectivity probe" }];
    writeFileSync(join(testDataDir, "watches.json"), JSON.stringify(watchesData, null, 2), "utf8");

    const threadsData = [
      { id: "thread-abc", title: "Release verification", botId: "bot-chief", createdAt: "2026-10-27T10:00:00Z" },
    ];
    writeFileSync(join(testDataDir, "threads.json"), JSON.stringify(threadsData, null, 2), "utf8");

    // Memory journal and files
    const memoryDir = join(testDataDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "user_preferences.md"), "# Preferences\nUser prefers dark OLED theme and fast updates.\n", "utf8");

    const memoryJournalDir = join(testDataDir, "memory-journal");
    mkdirSync(memoryJournalDir, { recursive: true });
    writeFileSync(join(memoryJournalDir, "bot-chief.ndjson"), JSON.stringify({ turn: 1, text: "Conversation history" }) + "\n", "utf8");

    // Real SQLite messages.db with conversation rows
    const dbPath = join(testDataDir, "messages.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        bot_id TEXT,
        role TEXT,
        content TEXT,
        created_at TEXT
      );
    `);
    db.exec(`
      INSERT INTO messages (id, thread_id, bot_id, role, content, created_at)
      VALUES
        ('msg-1', 'thread-abc', 'bot-chief', 'user', 'Check for updates', '2026-10-27T10:01:00Z'),
        ('msg-2', 'thread-abc', 'bot-chief', 'assistant', 'Checking GitHub releases...', '2026-10-27T10:01:05Z');
    `);
    db.close();

    // 2. Run post-upgrade migration from 1.1.1 to target schema version
    const migrationResult = await runMigrations(testDataDir, CURRENT_SCHEMA_VERSION);
    expect(migrationResult.finalVersion).toBe(CURRENT_SCHEMA_VERSION);

    // 3. Verify persistent state after upgrade
    const stateValidation = validatePersistentState(testDataDir);
    expect(stateValidation.healthy).toBe(true);
    expect(stateValidation.botCount).toBe(2);
    expect(stateValidation.configValid).toBe(true);
    expect(stateValidation.messagesDbValid).toBe(true);
    expect(stateValidation.memoryDirectoryPresent).toBe(true);

    // 4. Verify SQLite database data survived completely intact
    const verifyDb = new DatabaseSync(dbPath);
    const rows = verifyDb.prepare("SELECT * FROM messages ORDER BY id ASC").all() as any[];
    expect(rows.length).toBe(2);
    expect(rows[0].id).toBe("msg-1");
    expect(rows[0].content).toBe("Check for updates");
    expect(rows[1].id).toBe("msg-2");
    expect(rows[1].content).toBe("Checking GitHub releases...");

    // Check schema_migrations table
    const schemaRows = verifyDb.prepare("SELECT * FROM schema_migrations").all() as any[];
    expect(schemaRows.length).toBeGreaterThanOrEqual(1);
    expect(schemaRows.some((r: any) => r.version === 2)).toBe(true);
    verifyDb.close();

    // 5. Verify JSON configs and memory survived intact
    const afterBots = JSON.parse(readFileSync(join(testDataDir, "bots.json"), "utf8"));
    expect(afterBots.length).toBe(2);
    expect(afterBots[0].name).toBe("Chief Assistant");

    const afterGoals = JSON.parse(readFileSync(join(testDataDir, "goals.json"), "utf8"));
    expect(afterGoals.length).toBe(2);

    const afterMemory = readFileSync(join(memoryDir, "user_preferences.md"), "utf8");
    expect(afterMemory).toContain("User prefers dark OLED theme");

    const afterJournal = readFileSync(join(memoryJournalDir, "bot-chief.ndjson"), "utf8");
    expect(afterJournal).toContain("Conversation history");
  });

  it("eliminates repeating update prompts: stages APK for 1.1.1, invalidates upon 1.1.2 install, stays up_to_date", async () => {
    // Start with 1.1.1 installed
    const manager = new UpdaterManager({
      currentVersion: "1.1.1",
      currentVersionCode: 10101,
      packageName: "com.openmausbot.companion",
      dataDir: testDataDir,
    });

    writeFileSync(join(testDataDir, "config.json"), JSON.stringify({ schemaVersion: 2 }), "utf8");
    writeFileSync(join(testDataDir, "bots.json"), JSON.stringify([{ id: "b1", name: "Bot 1" }]), "utf8");

    const mockApk = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(150, 42)]);
    const mockHash = createHash("sha256").update(mockApk).digest("hex");
    const release112: ReleaseManifest = {
      version: "1.1.2",
      releaseTag: "v1.1.2",
      name: "MOBOT v1.1.2",
      downloadUrl: "https://example.com/MOBOT-1.1.2-arm64-v8a.apk",
      fileName: "MOBOT-1.1.2-arm64-v8a.apk",
      fileSizeBytes: mockApk.length,
      checksumSha256: mockHash,
      releaseNotes: "Version 1.1.2 in-place upgrade release.",
      publishedAt: new Date().toISOString(),
      channel: "stable",
      versionCode: 10102,
      packageName: "com.openmausbot.companion",
    };

    // 1. Initial check on 1.1.1 shows update available
    const st1 = await manager.checkForUpdates(false, release112);
    expect(st1.status).toBe("available");
    expect(st1.targetVersionCode).toBe(10102);

    // 2. Download stages package
    const st2 = await manager.downloadUpdate(async dest => {
      writeFileSync(dest, mockApk);
    });
    expect(st2.status).toBe("ready_to_install");
    expect(st2.stagedApkPath).toBeDefined();
    expect(existsSync(st2.stagedApkPath!)).toBe(true);

    // 3. User installs update. Companion app restarts running 1.1.2 (versionCode 10102)
    manager.updateInstalledVersion("1.1.2", 10102);

    // 4. getStatus() MUST automatically invalidate staged package and report up_to_date
    const st3 = manager.getStatus();
    expect(st3.status).toBe("up_to_date");
    expect(st3.stagedApkPath).toBeUndefined();
    expect(st3.release).toBeUndefined();
    // Staged APK was deleted from disk
    expect(existsSync(join(testDataDir, "updates", "MOBOT-1.1.2-arm64-v8a.apk"))).toBe(false);

    // 5. Repeated periodic checks (e.g. 60s loop) MUST report up_to_date
    const st4 = await manager.checkForUpdates(false, release112);
    expect(st4.status).toBe("up_to_date");
    expect(st4.stagedApkPath).toBeUndefined();

    // 6. Another periodic check: remains up_to_date, zero prompt loops
    const st5 = await manager.checkForUpdates(false, release112);
    expect(st5.status).toBe("up_to_date");
  });
});
