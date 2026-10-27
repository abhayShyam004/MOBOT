import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  UpdaterManager,
  compareSemVer,
  createSafetyBackup,
  deriveVersionCode,
  isUpdateAvailable,
  listSnapshots,
  parseReleaseManifest,
  parseSemVer,
  restoreSafetyBackup,
  runMigrations,
  validatePersistentState,
  verifyApkFormat,
  verifyFileSha256,
  registeredMigrations,
  type GitHubRelease,
  type ReleaseManifest,
} from "./updater.ts";

describe("SemVer comparison", () => {
  it("parses standard versions correctly", () => {
    expect(parseSemVer("1.0.0")).toEqual({ major: 1, minor: 0, patch: 0, prerelease: undefined, raw: "1.0.0" });
    expect(parseSemVer("v1.10.2")).toEqual({ major: 1, minor: 10, patch: 2, prerelease: undefined, raw: "v1.10.2" });
    expect(parseSemVer("2.3.4-beta.1")).toEqual({ major: 2, minor: 3, patch: 4, prerelease: "beta.1", raw: "2.3.4-beta.1" });
    expect(parseSemVer("invalid")).toBeNull();
  });

  it("handles 1.9.0 vs 1.10.0 numeric comparison properly", () => {
    expect(compareSemVer("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareSemVer("1.9.0", "1.10.0")).toBeLessThan(0);
    expect(compareSemVer("1.10.0", "1.10.0")).toBe(0);
    expect(compareSemVer("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("evaluates update availability", () => {
    expect(isUpdateAvailable("1.0.0", "1.0.1")).toBe(true);
    expect(isUpdateAvailable("1.0.0", "1.1.0")).toBe(true);
    expect(isUpdateAvailable("1.9.0", "1.10.0")).toBe(true);
    expect(isUpdateAvailable("1.10.0", "1.9.0")).toBe(false);
    expect(isUpdateAvailable("1.0.0", "1.0.0")).toBe(false);
  });

  it("derives deterministic integer versionCode monotonically", () => {
    expect(deriveVersionCode("1.0.0")).toBe(10000);
    expect(deriveVersionCode("1.1.0")).toBe(10100);
    expect(deriveVersionCode("1.1.1")).toBe(10101);
    expect(deriveVersionCode("1.1.2")).toBe(10102);
    expect(deriveVersionCode("2.0.0")).toBe(20000);
    expect(deriveVersionCode("1.1.1-threads-preview")).toBe(10101);
    expect(deriveVersionCode("invalid")).toBe(0);
  });

  it("prioritizes numeric versionCode over version string comparison", () => {
    // 10101 -> 10102 is an update
    expect(isUpdateAvailable("1.1.1", "1.1.2", { currentVersionCode: 10101, remoteVersionCode: 10102 })).toBe(true);
    // 10102 -> 10102 is NOT an update
    expect(isUpdateAvailable("1.1.2", "1.1.2", { currentVersionCode: 10102, remoteVersionCode: 10102 })).toBe(false);
    // 10103 -> 10102 (installed newer than remote) is NOT an update
    expect(isUpdateAvailable("1.1.3", "1.1.2", { currentVersionCode: 10103, remoteVersionCode: 10102 })).toBe(false);
    // 10100 -> 10102 is an update
    expect(isUpdateAvailable("1.1.0", "1.1.2", { currentVersionCode: 10100, remoteVersionCode: 10102 })).toBe(true);
  });

  it("prevents preview packages from being prompted with production package updates", () => {
    const previewToStable = isUpdateAvailable("1.1.1-threads-preview", "1.1.1", {
      currentVersionCode: 10101,
      remoteVersionCode: 10101,
      currentPackageName: "com.openmausbot.companion.preview",
      targetPackageName: "com.openmausbot.companion",
    });
    expect(previewToStable).toBe(false);

    const previewToNewerStable = isUpdateAvailable("1.1.1-threads-preview", "1.1.2", {
      currentVersionCode: 10101,
      remoteVersionCode: 10102,
      currentPackageName: "com.openmausbot.companion.preview",
      targetPackageName: "com.openmausbot.companion",
    });
    expect(previewToNewerStable).toBe(false);

    // Same package name upgrades normally
    const productionToNewerProduction = isUpdateAvailable("1.1.1", "1.1.2", {
      currentVersionCode: 10101,
      remoteVersionCode: 10102,
      currentPackageName: "com.openmausbot.companion",
      targetPackageName: "com.openmausbot.companion",
    });
    expect(productionToNewerProduction).toBe(true);
  });
});

describe("Release manifest parser", () => {
  it("extracts APK asset and sha256 checksum from release metadata", () => {
    const fakeRelease: GitHubRelease = {
      tag_name: "v1.1.0",
      name: "MOBOT Release 1.1.0",
      published_at: "2026-10-18T12:00:00Z",
      body: "Security update and bugfixes.\n\nSHA256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      assets: [
        {
          name: "mobot-v1.1.0.apk",
          size: 15420000,
          browser_download_url: "https://github.com/abhayShyam004/MOBOT/releases/download/v1.1.0/mobot-v1.1.0.apk",
        },
      ],
    };

    const manifest = parseReleaseManifest(fakeRelease);
    expect(manifest).not.toBeNull();
    expect(manifest?.version).toBe("1.1.0");
    expect(manifest?.fileName).toBe("mobot-v1.1.0.apk");
    expect(manifest?.checksumSha256).toBe("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(manifest?.channel).toBe("stable");
  });

  it("returns null if release has no APK asset", () => {
    const fakeRelease: GitHubRelease = {
      tag_name: "v1.1.0",
      published_at: "2026-10-18T12:00:00Z",
      assets: [{ name: "source.tar.gz", size: 1000, browser_download_url: "https://example.com" }],
    };
    expect(parseReleaseManifest(fakeRelease)).toBeNull();
  });
});

describe("Artifact verification and integrity", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mobot-update-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("computes and verifies SHA256 matches and mismatches", async () => {
    const sampleFile = join(testDir, "test.apk");
    const content = Buffer.from("504b0304sampleapkcontent1234567890", "utf8");
    writeFileSync(sampleFile, content);

    const expectedHash = createHash("sha256").update(content).digest("hex");
    const result = await verifyFileSha256(sampleFile, expectedHash);
    expect(result.valid).toBe(true);
    expect(result.actual).toBe(expectedHash);

    const badResult = await verifyFileSha256(sampleFile, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(badResult.valid).toBe(false);
  });

  it("verifies APK magic bytes header", () => {
    const validZipHeader = join(testDir, "valid.apk");
    // Standard zip magic header: 0x50 0x4b 0x03 0x04
    const validHeader = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(120, 0)]);
    writeFileSync(validZipHeader, validHeader);
    expect(verifyApkFormat(validZipHeader).valid).toBe(true);

    const invalidHeader = join(testDir, "invalid.apk");
    writeFileSync(invalidHeader, Buffer.alloc(120, 0));
    expect(verifyApkFormat(invalidHeader).valid).toBe(false);
  });
});

describe("Safety snapshots and backup retention", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mobot-data-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Seed test data directory
    writeFileSync(join(testDir, "config.json"), JSON.stringify({ theme: "dark", schemaVersion: 1 }));
    writeFileSync(join(testDir, "bots.json"), JSON.stringify([{ id: "bot-1", name: "Primary Agent" }]));
    mkdirSync(join(testDir, "memory"), { recursive: true });
    writeFileSync(join(testDir, "memory", "user.md"), "User prefers dark mode.");
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("creates safety snapshot and prunes older ones keeping max 2", async () => {
    // Snapshot 1
    const snap1 = createSafetyBackup(testDir, "1.0.0");
    expect(existsSync(snap1)).toBe(true);
    expect(existsSync(join(snap1, "config.json"))).toBe(true);
    expect(existsSync(join(snap1, "memory", "user.md"))).toBe(true);

    await new Promise(r => setTimeout(r, 20));

    // Snapshot 2
    const snap2 = createSafetyBackup(testDir, "1.0.1");
    expect(existsSync(snap2)).toBe(true);

    let list = listSnapshots(testDir);
    expect(list.length).toBe(2);

    await new Promise(r => setTimeout(r, 20));

    // Snapshot 3 - should trigger pruning to max 2
    const snap3 = createSafetyBackup(testDir, "1.0.2");
    list = listSnapshots(testDir);
    expect(list.length).toBe(2);
    // snap1 should have been pruned
    expect(existsSync(snap1)).toBe(false);
    expect(existsSync(snap2)).toBe(true);
    expect(existsSync(snap3)).toBe(true);
  });

  it("restores safety backup accurately", () => {
    const snap = createSafetyBackup(testDir, "1.0.0");

    // Modify active files
    writeFileSync(join(testDir, "config.json"), JSON.stringify({ corrupted: true }));
    rmSync(join(testDir, "memory", "user.md"));

    const restored = restoreSafetyBackup(testDir, snap);
    expect(restored).toBe(true);

    const configContent = JSON.parse(readFileSync(join(testDir, "config.json"), "utf8"));
    expect(configContent.theme).toBe("dark");
    expect(existsSync(join(testDir, "memory", "user.md"))).toBe(true);
  });
});

describe("Schema migration and persistent state validation", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mobot-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, "config.json"), JSON.stringify({ schemaVersion: 1 }));
    writeFileSync(join(testDir, "bots.json"), JSON.stringify([{ id: "bot-1", name: "Agent 1" }]));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("migrates schema to target version and initializes updater and permissions", async () => {
    const res = await runMigrations(testDir, CURRENT_SCHEMA_VERSION);
    expect(res.finalVersion).toBe(CURRENT_SCHEMA_VERSION);

    const updatedConfig = JSON.parse(readFileSync(join(testDir, "config.json"), "utf8"));
    expect(updatedConfig.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(updatedConfig.updater).toBeDefined();
    expect(updatedConfig.agentPermissions).toBeDefined();

    const validation = validatePersistentState(testDir);
    expect(validation.healthy).toBe(true);
    expect(validation.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(validation.botCount).toBe(1);
  });
});

describe("UpdaterManager end-to-end lifecycle", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mobot-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    writeFileSync(join(testDir, "config.json"), JSON.stringify({ schemaVersion: 1 }));
    writeFileSync(join(testDir, "bots.json"), JSON.stringify([{ id: "bot-1", name: "Primary" }]));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("checks, downloads, prepares install, and validates update", async () => {
    const manager = new UpdaterManager({
      currentVersion: "1.0.0",
      dataDir: testDir,
    });

    const mockApkContent = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(150, 42)]);
    const sha = createHash("sha256").update(mockApkContent).digest("hex");

    const mockRelease: ReleaseManifest = {
      version: "1.1.0",
      releaseTag: "v1.1.0",
      name: "MOBOT v1.1.0",
      downloadUrl: "https://example.com/mock.apk",
      fileName: "mobot-1.1.0.apk",
      fileSizeBytes: mockApkContent.length,
      checksumSha256: sha,
      releaseNotes: "Feature update and performance optimizations.",
      publishedAt: "2026-10-18T10:00:00Z",
      channel: "stable",
      versionCode: 10100,
      packageName: "com.openmausbot.companion",
    };

    // Check
    const checkState = await manager.checkForUpdates(false, mockRelease);
    expect(checkState.status).toBe("available");
    expect(checkState.targetVersion).toBe("1.1.0");

    // Download with mock
    const downloadState = await manager.downloadUpdate(async dest => {
      writeFileSync(dest, mockApkContent);
    });
    expect(downloadState.status).toBe("ready_to_install");
    expect(downloadState.stagedApkPath).toBeDefined();

    // Prepare install (triggers safety snapshot)
    const installPrep = await manager.prepareInstall();
    expect(installPrep.stagedApkPath).toBe(downloadState.stagedApkPath);
    expect(existsSync(installPrep.snapshotPath)).toBe(true);

    // Complete post-update validation and migration
    const validation = await manager.completePostUpdateValidation();
    expect(validation.healthy).toBe(true);
    expect(manager.getStatus().status).toBe("complete");
  });

  it("rejects download with checksum mismatch and clears corrupt file", async () => {
    const manager = new UpdaterManager({
      currentVersion: "1.0.0",
      dataDir: testDir,
    });

    const mockApkContent = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(150, 42)]);

    const mockRelease: ReleaseManifest = {
      version: "1.1.0",
      releaseTag: "v1.1.0",
      downloadUrl: "https://example.com/mock.apk",
      fileName: "corrupt.apk",
      fileSizeBytes: mockApkContent.length,
      checksumSha256: "0000000000000000000000000000000000000000000000000000000000000000",
      releaseNotes: "Test release",
      publishedAt: "2026-10-18T10:00:00Z",
      channel: "stable",
      versionCode: 10100,
      packageName: "com.openmausbot.companion",
    };

    await manager.checkForUpdates(false, mockRelease);
    const downloadState = await manager.downloadUpdate(async dest => {
      writeFileSync(dest, mockApkContent);
    });

    expect(downloadState.status).toBe("error");
    expect(downloadState.lastError).toContain("Checksum mismatch");
    // Verify corrupt file was deleted
    expect(existsSync(join(testDir, "updates", "corrupt.apk"))).toBe(false);
  });

  it("handles rollback cleanly when requested", async () => {
    const manager = new UpdaterManager({
      currentVersion: "1.0.0",
      dataDir: testDir,
    });

    // Create a known good state
    writeFileSync(join(testDir, "config.json"), JSON.stringify({ state: "initial_good", schemaVersion: 1 }));
    createSafetyBackup(testDir, "1.0.0");

    // Corrupt active state
    writeFileSync(join(testDir, "config.json"), JSON.stringify({ state: "broken" }));

    // Execute rollback
    const rollbackRes = await manager.rollback();
    expect(rollbackRes.restored).toBe(true);

    const restoredConfig = JSON.parse(readFileSync(join(testDir, "config.json"), "utf8"));
    expect(restoredConfig.state).toBe("initial_good");
  });

  it("detects migration failure, sets error state, and restores from safety backup without false completion", async () => {
    const manager = new UpdaterManager({
      currentVersion: "1.0.0",
      dataDir: testDir,
    });

    writeFileSync(join(testDir, "config.json"), JSON.stringify({ state: "initial_v1", schemaVersion: 1 }));
    writeFileSync(join(testDir, "bots.json"), JSON.stringify([{ id: "bot-keep", name: "Keep Me" }]));

    const mockApk = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(150, 42)]);
    const mockHash = createHash("sha256").update(mockApk).digest("hex");
    await manager.checkForUpdates(false, {
      version: "1.1.0",
      versionCode: 10100,
      packageName: "com.openmausbot.companion",
      releaseTag: "v1.1.0",
      downloadUrl: "https://example.com/update.apk",
      fileName: "update.apk",
      fileSizeBytes: mockApk.length,
      checksumSha256: mockHash,
      releaseNotes: "Test release",
      publishedAt: new Date().toISOString(),
      channel: "stable",
    });
    await manager.downloadUpdate(async dest => {
      writeFileSync(dest, mockApk);
    });

    const prep = await manager.prepareInstall();
    expect(existsSync(prep.snapshotPath)).toBe(true);

    // Insert a failing migration at the front of v1 -> v2
    registeredMigrations.unshift({
      fromVersion: 1,
      toVersion: 2,
      description: "Deliberately failing migration",
      apply: () => {
        throw new Error("Controlled migration error: disk corruption simulated");
      },
    });

    try {
      await manager.completePostUpdateValidation();
      const status = manager.getStatus();
      expect(status.status).toBe("error");
      expect(status.lastError).toContain("Post-update migration failed");
      expect(status.lastError).toContain("Controlled migration error");

      // Verify bots and state were restored from snapshot
      const configAfter = JSON.parse(readFileSync(join(testDir, "config.json"), "utf8"));
      expect(configAfter.state).toBe("initial_v1");
      const botsAfter = JSON.parse(readFileSync(join(testDir, "bots.json"), "utf8"));
      expect(botsAfter[0].name).toBe("Keep Me");
    } finally {
      registeredMigrations.shift();
    }
  });

  it("handles non-existent release gracefully", async () => {
    const manager = new UpdaterManager({
      currentVersion: "1.0.0",
      dataDir: testDir,
      githubRepo: "abhayShyam004/nonexistent-repo-for-testing",
    });

    const status = await manager.checkForUpdates();
    // GitHub API will return 404 which resolves to up_to_date (no updates found) or error
    expect(["up_to_date", "error"]).toContain(status.status);
  });

  it("invalidates staged package and returns up_to_date when installed version matches or exceeds target", async () => {
    const manager = new UpdaterManager({
      currentVersion: "1.1.1",
      currentVersionCode: 10101,
      packageName: "com.openmausbot.companion",
      dataDir: testDir,
    });

    const mockApk = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(150, 42)]);
    const mockHash = createHash("sha256").update(mockApk).digest("hex");
    const mockRelease: ReleaseManifest = {
      version: "1.1.2",
      releaseTag: "v1.1.2",
      name: "MOBOT v1.1.2",
      downloadUrl: "https://example.com/update-1.1.2.apk",
      fileName: "update-1.1.2.apk",
      fileSizeBytes: mockApk.length,
      checksumSha256: mockHash,
      releaseNotes: "Fix repeating update prompt",
      publishedAt: new Date().toISOString(),
      channel: "stable",
      versionCode: 10102,
      packageName: "com.openmausbot.companion",
    };

    // 1. Initial check sees update available
    const checkState = await manager.checkForUpdates(false, mockRelease);
    expect(checkState.status).toBe("available");

    // 2. Download stages the APK
    const downloadState = await manager.downloadUpdate(async dest => {
      writeFileSync(dest, mockApk);
    });
    expect(downloadState.status).toBe("ready_to_install");
    expect(existsSync(downloadState.stagedApkPath!)).toBe(true);

    // 3. User installs update: app restarts with version 1.1.2 / versionCode 10102
    manager.updateInstalledVersion("1.1.2", 10102);

    // 4. getStatus() must automatically invalidate staged package and report up_to_date
    const postInstallStatus = manager.getStatus();
    expect(postInstallStatus.status).toBe("up_to_date");
    expect(postInstallStatus.stagedApkPath).toBeUndefined();
    expect(postInstallStatus.release).toBeUndefined();
    // Staged file was cleanly pruned
    expect(existsSync(join(testDir, "updates", "update-1.1.2.apk"))).toBe(false);

    // 5. Subsequent checkForUpdates() also reports up_to_date without prompt loop
    const recheckStatus = await manager.checkForUpdates(false, mockRelease);
    expect(recheckStatus.status).toBe("up_to_date");
    expect(recheckStatus.stagedApkPath).toBeUndefined();
  });
});
