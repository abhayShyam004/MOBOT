import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateUserLocation } from "./location-context.ts";

export const CURRENT_SCHEMA_VERSION = 2;
export const DEFAULT_GITHUB_REPO = "abhayShyam004/MOBOT";
export const MAX_RETAINED_SNAPSHOTS = 2;

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  raw: string;
}

export function parseSemVer(version: string): SemVer | null {
  if (!version || typeof version !== "string") return null;
  const clean = version.trim().replace(/^[vV]/, "");
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || undefined,
    raw: version.trim(),
  };
}

export function compareSemVer(aStr: string, bStr: string): number {
  const a = parseSemVer(aStr);
  const b = parseSemVer(bStr);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return 0;
}

export function deriveVersionCode(version: string): number {
  const semver = parseSemVer(version);
  if (!semver) return 0;
  return semver.major * 10000 + semver.minor * 100 + semver.patch;
}

export interface UpdateAvailabilityOptions {
  currentVersionCode?: number;
  remoteVersionCode?: number;
  currentPackageName?: string;
  targetPackageName?: string;
}

export function isUpdateAvailable(
  currentVersion: string,
  remoteVersion: string,
  options?: UpdateAvailabilityOptions
): boolean {
  const currentPkg = options?.currentPackageName;
  const targetPkg = options?.targetPackageName;

  // Package identity boundary: Never advertise a production package as an in-place
  // update for a preview package (or vice versa), which would create duplicate
  // launcher icons or installation collisions.
  if (currentPkg && targetPkg && currentPkg !== targetPkg) {
    if (currentPkg.endsWith(".preview") && !targetPkg.endsWith(".preview")) {
      return false;
    }
  }

  const curCode = options?.currentVersionCode ?? deriveVersionCode(currentVersion);
  const remCode = options?.remoteVersionCode ?? deriveVersionCode(remoteVersion);

  // Monotonic integer versionCode comparison is the primary authority in Android package management.
  if (curCode > 0 && remCode > 0) {
    return remCode > curCode;
  }

  // Base SemVer comparison without prerelease penalty when base versions match.
  const curSem = parseSemVer(currentVersion);
  const remSem = parseSemVer(remoteVersion);
  if (curSem && remSem) {
    if (curSem.major !== remSem.major) return remSem.major > curSem.major;
    if (curSem.minor !== remSem.minor) return remSem.minor > curSem.minor;
    if (curSem.patch !== remSem.patch) return remSem.patch > curSem.patch;
    // Same major.minor.patch means the release is not newer.
    return false;
  }

  return compareSemVer(remoteVersion, currentVersion) > 0;
}

export interface ReleaseManifest {
  version: string;
  releaseTag: string;
  name?: string;
  downloadUrl: string;
  fileName: string;
  fileSizeBytes: number;
  checksumSha256: string;
  releaseNotes: string;
  publishedAt: string;
  channel: "stable" | "beta";
  versionCode: number;
  packageName: string;
}

export interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  content_type?: string;
}

export interface GitHubRelease {
  tag_name: string;
  name?: string;
  body?: string;
  published_at: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: GitHubAsset[];
}

export function parseReleaseManifest(release: GitHubRelease, options?: { preferredArch?: string }): ReleaseManifest | null {
  if (!release || release.draft) return null;
  const version = release.tag_name ? release.tag_name.replace(/^[vV]/, "") : "";
  if (!parseSemVer(version)) return null;

  const assets = release.assets || [];
  const apkAssets = assets.filter(a => a.name.toLowerCase().endsWith(".apk"));
  if (apkAssets.length === 0) return null;

  const preferredArch = options?.preferredArch || "arm64-v8a";
  const archMatch = apkAssets.find(a => a.name.toLowerCase().includes(preferredArch));
  const universalMatch = apkAssets.find(a => a.name.toLowerCase().includes("universal"));
  const apkAsset = archMatch || universalMatch || apkAssets[0];

  let checksum = "";
  const bodyText = release.body || "";
  const hashMatch = bodyText.match(/(?:sha256|SHA256|sha-256|SHA-256)[:\s=]+([a-fA-F0-9]{64})/);
  if (hashMatch) {
    checksum = hashMatch[1].toLowerCase();
  } else {
    const shaAsset = assets.find(a => a.name.toLowerCase().endsWith(".sha256") || a.name.toLowerCase().endsWith("checksums.txt"));
    if (shaAsset) {
      checksum = `url:${shaAsset.browser_download_url}`;
    }
  }

  let versionCode = deriveVersionCode(version);
  const vcMatch = bodyText.match(/versionCode[:\s=]+(\d+)/i);
  if (vcMatch) {
    versionCode = parseInt(vcMatch[1], 10);
  }

  let packageName = "com.openmausbot.companion";
  const pkgMatch = bodyText.match(/package[:\s=]+([a-zA-Z0-9._]+)/i);
  if (pkgMatch) {
    packageName = pkgMatch[1].trim();
  }

  return {
    version,
    releaseTag: release.tag_name,
    name: release.name || release.tag_name,
    downloadUrl: apkAsset.browser_download_url,
    fileName: apkAsset.name,
    fileSizeBytes: apkAsset.size,
    checksumSha256: checksum,
    releaseNotes: release.body || "No release notes provided.",
    publishedAt: release.published_at,
    channel: release.prerelease ? "beta" : "stable",
    versionCode,
    packageName,
  };
}

export function normalizeReleaseManifest(m: any): ReleaseManifest {
  const version = m.version || (m.tag_name ? m.tag_name.replace(/^[vV]/, "") : (m.tag ? m.tag.replace(/^[vV]/, "") : (m.releaseTag ? m.releaseTag.replace(/^[vV]/, "") : "1.0.0")));
  const releaseTag = m.releaseTag || m.tag_name || m.tag || `v${version}`;
  const downloadUrl = m.downloadUrl || m.apkDownloadUrl || (m.assets?.[0]?.browser_download_url) || "";
  const fileName = m.fileName || m.apkName || (m.assets?.[0]?.name) || `mobot-${releaseTag}.apk`;
  const fileSizeBytes = m.fileSizeBytes || m.apkSize || (m.assets?.[0]?.size) || 0;
  const checksumSha256 = m.checksumSha256 || m.sha256 || "";
  const releaseNotes = m.releaseNotes || m.body || m.notes || "";
  const publishedAt = m.publishedAt || m.published_at || new Date().toISOString();
  const channel = m.channel || "stable";
  const versionCode = typeof m.versionCode === "number" ? m.versionCode : deriveVersionCode(version);
  const packageName = m.packageName || "com.openmausbot.companion";
  return {
    version,
    releaseTag,
    name: m.name || `MOBOT ${releaseTag}`,
    downloadUrl,
    fileName,
    fileSizeBytes,
    checksumSha256,
    releaseNotes,
    publishedAt,
    channel,
    versionCode,
    packageName,
  };
}

export async function fetchGitHubRelease(repo: string = DEFAULT_GITHUB_REPO): Promise<GitHubRelease | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        "User-Agent": "MOBOT-Updater/1.0",
        Accept: "application/vnd.github.v3+json",
      },
    };

    httpsGet(options, (res) => {
      if (res.statusCode === 404 || res.statusCode === 403) {
        resolve(null);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API request failed with status ${res.statusCode}`));
        return;
      }
      let rawData = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { rawData += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Failed to parse GitHub release JSON: ${(err as Error).message}`));
        }
      });
    }).on("error", err => {
      reject(err);
    });
  });
}

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!existsSync(filePath)) {
      reject(new Error(`File not found for checksum: ${filePath}`));
      return;
    }
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
    stream.on("error", err => reject(err));
  });
}

export async function verifyFileSha256(filePath: string, expectedSha256: string): Promise<{ valid: boolean; actual: string; expected: string }> {
  const actual = await computeFileSha256(filePath);
  const normalizedExpected = expectedSha256.trim().toLowerCase();
  return {
    valid: actual === normalizedExpected,
    actual,
    expected: normalizedExpected,
  };
}

export function verifyApkFormat(filePath: string): { valid: boolean; error?: string } {
  if (!existsSync(filePath)) {
    return { valid: false, error: "APK file does not exist" };
  }
  const stat = statSync(filePath);
  if (stat.size < 100) {
    return { valid: false, error: "APK file is empty or too small" };
  }
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(4);
    readSync(fd, buffer, 0, 4, 0);
    const magic = buffer.toString("hex");
    if (magic !== "504b0304") {
      return { valid: false, error: "File lacks valid ZIP/APK signature header" };
    }
    return { valid: true };
  } finally {
    closeSync(fd);
  }
}

export function createSafetyBackup(dataDir: string, currentVersion: string): string {
  const backupsDir = join(dataDir, "backups");
  mkdirSync(backupsDir, { recursive: true });

  const timestamp = Date.now();
  const snapshotName = `snapshot-${timestamp}-v${currentVersion.replace(/[^0-9A-Za-z.-]/g, "_")}`;
  const snapshotDir = join(backupsDir, snapshotName);
  mkdirSync(snapshotDir, { recursive: true });

  const persistentItems = [
    "config.json",
    "bots.json",
    "groups.json",
    "sections.json",
    "goals.json",
    "watches.json",
    "threads.json",
    "messages.db",
    "messages.db-wal",
    "messages.db-shm",
    "user-location.json",
    "memory",
    "memory-journal",
    "workspaces",
    "artifacts",
  ];

  for (const item of persistentItems) {
    const srcPath = join(dataDir, item);
    if (!existsSync(srcPath)) continue;

    if (item === "user-location.json") {
      try {
        const raw = JSON.parse(readFileSync(srcPath, "utf8"));
        const validated = validateUserLocation(raw);
        if (!validated || validated.provenance !== "SAVED_USER") {
          continue; // Do not snapshot unverified or contaminated locations
        }
      } catch {
        continue;
      }
    }

    const destPath = join(snapshotDir, item);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      cpSync(srcPath, destPath, { recursive: true });
    } else {
      copyFileSync(srcPath, destPath);
    }
  }

  const manifest = {
    snapshotName,
    createdAt: new Date(timestamp).toISOString(),
    version: currentVersion,
    schemaVersion: getSchemaVersion(dataDir),
    backedUpItems: persistentItems.filter(item => existsSync(join(snapshotDir, item))),
  };
  writeFileSync(join(snapshotDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  pruneSnapshots(dataDir, MAX_RETAINED_SNAPSHOTS);
  return snapshotDir;
}

export function listSnapshots(dataDir: string): Array<{ name: string; path: string; timestamp: number; version?: string }> {
  const backupsDir = join(dataDir, "backups");
  if (!existsSync(backupsDir)) return [];

  const entries = readdirSync(backupsDir);
  const snapshots: Array<{ name: string; path: string; timestamp: number; version?: string }> = [];

  for (const entry of entries) {
    if (!entry.startsWith("snapshot-")) continue;
    const fullPath = join(backupsDir, entry);
    const stat = statSync(fullPath);
    if (!stat.isDirectory()) continue;

    let version: string | undefined;
    const manifestPath = join(fullPath, "manifest.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        version = manifest.version;
      } catch {}
    }

    const match = entry.match(/^snapshot-(\d+)/);
    const timestamp = match ? parseInt(match[1], 10) : stat.mtimeMs;
    snapshots.push({ name: entry, path: fullPath, timestamp, version });
  }

  return snapshots.sort((a, b) => b.timestamp - a.timestamp);
}

export function pruneSnapshots(dataDir: string, maxRetained: number = MAX_RETAINED_SNAPSHOTS): string[] {
  const snapshots = listSnapshots(dataDir);
  if (snapshots.length <= maxRetained) return [];

  const pruned: string[] = [];
  const toRemove = snapshots.slice(maxRetained);
  for (const snap of toRemove) {
    try {
      rmSync(snap.path, { recursive: true, force: true });
      pruned.push(snap.name);
    } catch {}
  }
  return pruned;
}

export function restoreSafetyBackup(dataDir: string, targetSnapshotDir?: string): boolean {
  let restoreSrc = targetSnapshotDir;
  if (!restoreSrc) {
    const snapshots = listSnapshots(dataDir);
    if (snapshots.length === 0) return false;
    restoreSrc = snapshots[0].path;
  }
  if (!existsSync(restoreSrc)) return false;

  const entries = readdirSync(restoreSrc);
  for (const entry of entries) {
    if (entry === "manifest.json") continue;
    const srcPath = join(restoreSrc, entry);

    if (entry === "user-location.json") {
      try {
        const raw = JSON.parse(readFileSync(srcPath, "utf8"));
        const validated = validateUserLocation(raw);
        if (!validated || validated.provenance !== "SAVED_USER") {
          continue; // Discard unverified or contaminated location snapshot
        }
      } catch {
        continue;
      }
    }

    const destPath = join(dataDir, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      rmSync(destPath, { recursive: true, force: true });
      cpSync(srcPath, destPath, { recursive: true });
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
  return true;
}

export function getSchemaVersion(dataDir: string): number {
  const configFile = join(dataDir, "config.json");
  if (!existsSync(configFile)) return 1;
  try {
    const raw = JSON.parse(readFileSync(configFile, "utf8"));
    return typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
  } catch {
    return 1;
  }
}

export function setSchemaVersion(dataDir: string, version: number): void {
  const configFile = join(dataDir, "config.json");
  let cfg: Record<string, unknown> = {};
  if (existsSync(configFile)) {
    try {
      cfg = JSON.parse(readFileSync(configFile, "utf8"));
    } catch {
      cfg = {};
    }
  }
  cfg.schemaVersion = version;
  writeFileSync(configFile, JSON.stringify(cfg, null, 2), "utf8");
}

export interface Migration {
  fromVersion: number;
  toVersion: number;
  description: string;
  apply: (dataDir: string) => Promise<void> | void;
}

export const registeredMigrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    description: "Initialize updater configuration, ensure agent permissions structure, and verify database integrity",
    apply: (dataDir: string) => {
      const configFile = join(dataDir, "config.json");
      let cfg: Record<string, unknown> = {};
      if (existsSync(configFile)) {
        try {
          cfg = JSON.parse(readFileSync(configFile, "utf8"));
        } catch {
          cfg = {};
        }
      }

      if (!cfg.updater || typeof cfg.updater !== "object") {
        cfg.updater = {
          channel: "stable",
          autoCheck: true,
          lastCheckedAt: new Date().toISOString(),
          repo: DEFAULT_GITHUB_REPO,
        };
      }

      if (!cfg.agentPermissions || typeof cfg.agentPermissions !== "object") {
        cfg.agentPermissions = {
          version: 1,
          terminal: { enabled: true, autoConfirm: false },
          filesystem: { enabled: true, autoConfirm: false },
          browser: { enabled: true, autoConfirm: false },
          composio: { enabled: true, autoConfirm: false },
        };
      }

      cfg.schemaVersion = 2;
      writeFileSync(configFile, JSON.stringify(cfg, null, 2), "utf8");

      const dbFile = join(dataDir, "messages.db");
      if (existsSync(dbFile)) {
        try {
          const db = new DatabaseSync(dbFile);
          db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT);");
          db.exec("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, datetime('now'));");
        } catch {}
      }

      const memoryDir = join(dataDir, "memory");
      if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
      }
    },
  },
];

export async function runMigrations(dataDir: string, targetVersion: number = CURRENT_SCHEMA_VERSION): Promise<{ initialVersion: number; finalVersion: number; appliedCount: number }> {
  const initialVersion = getSchemaVersion(dataDir);
  let current = initialVersion;
  let appliedCount = 0;

  while (current < targetVersion) {
    const nextMigration = registeredMigrations.find(m => m.fromVersion === current);
    if (!nextMigration) {
      setSchemaVersion(dataDir, current + 1);
      current += 1;
      appliedCount += 1;
      continue;
    }

    try {
      await nextMigration.apply(dataDir);
      current = nextMigration.toVersion;
      setSchemaVersion(dataDir, current);
      appliedCount += 1;
    } catch (err) {
      throw new Error(`Schema migration from v${nextMigration.fromVersion} to v${nextMigration.toVersion} failed: ${(err as Error).message}`);
    }
  }

  return { initialVersion, finalVersion: current, appliedCount };
}

export interface StateValidationResult {
  healthy: boolean;
  issues: string[];
  schemaVersion: number;
  botCount: number;
  configValid: boolean;
  messagesDbValid: boolean;
  memoryDirectoryPresent: boolean;
}

export function validatePersistentState(dataDir: string): StateValidationResult {
  const issues: string[] = [];
  let configValid = false;
  let schemaVersion = 1;
  let botCount = 0;
  let messagesDbValid = false;

  const configFile = join(dataDir, "config.json");
  if (!existsSync(configFile)) {
    issues.push("config.json is missing");
  } else {
    try {
      const cfg = JSON.parse(readFileSync(configFile, "utf8"));
      if (typeof cfg === "object" && cfg !== null) {
        configValid = true;
        schemaVersion = typeof cfg.schemaVersion === "number" ? cfg.schemaVersion : 1;
      } else {
        issues.push("config.json is not an object");
      }
    } catch (err) {
      issues.push(`config.json is invalid JSON: ${(err as Error).message}`);
    }
  }

  const botsFile = join(dataDir, "bots.json");
  if (existsSync(botsFile)) {
    try {
      const bots = JSON.parse(readFileSync(botsFile, "utf8"));
      if (Array.isArray(bots)) {
        botCount = bots.length;
      } else {
        issues.push("bots.json is not an array");
      }
    } catch (err) {
      issues.push(`bots.json is invalid JSON: ${(err as Error).message}`);
    }
  }

  const goalsFile = join(dataDir, "goals.json");
  if (existsSync(goalsFile)) {
    try {
      const goals = JSON.parse(readFileSync(goalsFile, "utf8"));
      if (!Array.isArray(goals)) {
        issues.push("goals.json is not an array");
      }
    } catch (err) {
      issues.push(`goals.json is invalid JSON: ${(err as Error).message}`);
    }
  }

  const watchesFile = join(dataDir, "watches.json");
  if (existsSync(watchesFile)) {
    try {
      const watches = JSON.parse(readFileSync(watchesFile, "utf8"));
      if (!Array.isArray(watches)) {
        issues.push("watches.json is not an array");
      }
    } catch (err) {
      issues.push(`watches.json is invalid JSON: ${(err as Error).message}`);
    }
  }

  const dbFile = join(dataDir, "messages.db");
  if (existsSync(dbFile)) {
    try {
      const db = new DatabaseSync(dbFile);
      const res = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
      if (res && res.integrity_check === "ok") {
        messagesDbValid = true;
      } else {
        messagesDbValid = true;
      }
    } catch (err) {
      issues.push(`messages.db integrity check failed: ${(err as Error).message}`);
    }
  } else {
    messagesDbValid = true;
  }

  const memoryDir = join(dataDir, "memory");
  const memoryDirectoryPresent = existsSync(memoryDir);

  const healthy = issues.length === 0 && configValid && messagesDbValid;

  return {
    healthy,
    issues,
    schemaVersion,
    botCount,
    configValid,
    messagesDbValid,
    memoryDirectoryPresent,
  };
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up_to_date"
  | "downloading"
  | "ready_to_install"
  | "installing"
  | "migrating"
  | "complete"
  | "error";

export interface UpdaterState {
  status: UpdateStatus;
  currentVersion: string;
  currentVersionCode?: number;
  targetVersion?: string;
  targetVersionCode?: number;
  targetPackageName?: string;
  release?: ReleaseManifest;
  downloadProgress?: {
    downloadedBytes: number;
    totalBytes: number;
    percent: number;
  };
  lastCheckedAt?: string;
  lastError?: string;
  lastSnapshotPath?: string;
  stagedApkPath?: string;
  validation?: StateValidationResult;
}

export class UpdaterManager {
  private status: UpdateStatus = "idle";
  private currentVersion: string;
  private currentVersionCode: number;
  private packageName: string;
  private dataDir: string;
  private githubRepo: string;
  private activeRelease: ReleaseManifest | null = null;
  private downloadProgress = { downloadedBytes: 0, totalBytes: 0, percent: 0 };
  private lastCheckedAt?: string;
  private lastError?: string;
  private lastSnapshotPath?: string;
  private stagedApkPath?: string;
  private isLocked = false;

  constructor(options: {
    currentVersion: string;
    currentVersionCode?: number;
    packageName?: string;
    dataDir: string;
    githubRepo?: string;
  }) {
    this.currentVersion = options.currentVersion;
    this.currentVersionCode = options.currentVersionCode ?? deriveVersionCode(options.currentVersion);
    this.packageName = options.packageName ?? (options.currentVersion.includes("preview") ? "com.openmausbot.companion.preview" : "com.openmausbot.companion");
    this.dataDir = options.dataDir;
    this.githubRepo = options.githubRepo || DEFAULT_GITHUB_REPO;
  }

  updateInstalledVersion(version: string, versionCode?: number, packageName?: string): void {
    this.currentVersion = version;
    this.currentVersionCode = versionCode ?? deriveVersionCode(version);
    if (packageName) this.packageName = packageName;
    this.invalidateIfUpToDate();
  }

  private invalidateIfUpToDate(): void {
    if (!this.activeRelease && !this.stagedApkPath) return;

    const targetVer = this.activeRelease?.version;
    const targetCode = this.activeRelease?.versionCode ?? (targetVer ? deriveVersionCode(targetVer) : 0);
    const targetPkg = this.activeRelease?.packageName ?? "com.openmausbot.companion";

    const isStillNewer = targetVer
      ? isUpdateAvailable(this.currentVersion, targetVer, {
          currentVersionCode: this.currentVersionCode,
          remoteVersionCode: targetCode,
          currentPackageName: this.packageName,
          targetPackageName: targetPkg,
        })
      : false;

    if (!isStillNewer) {
      if (this.stagedApkPath && existsSync(this.stagedApkPath)) {
        try { rmSync(this.stagedApkPath, { force: true }); } catch {}
      }
      this.stagedApkPath = undefined;
      this.activeRelease = null;
      if (this.status === "available" || this.status === "ready_to_install" || this.status === "installing") {
        this.status = "up_to_date";
      }
    }
  }

  getStatus(): UpdaterState {
    this.invalidateIfUpToDate();
    return {
      status: this.status,
      currentVersion: this.currentVersion,
      currentVersionCode: this.currentVersionCode,
      targetVersion: this.activeRelease?.version,
      targetVersionCode: this.activeRelease?.versionCode,
      targetPackageName: this.activeRelease?.packageName,
      release: this.activeRelease || undefined,
      downloadProgress: this.status === "downloading" ? { ...this.downloadProgress } : undefined,
      lastCheckedAt: this.lastCheckedAt,
      lastError: this.lastError,
      lastSnapshotPath: this.lastSnapshotPath,
      stagedApkPath: this.stagedApkPath,
      validation: validatePersistentState(this.dataDir),
    };
  }

  async checkForUpdates(force = false, mockRelease?: ReleaseManifest): Promise<UpdaterState> {
    if (this.isLocked) {
      throw new Error("Another update operation is currently in progress");
    }
    this.isLocked = true;
    this.status = "checking";
    this.lastError = undefined;

    try {
      let release: ReleaseManifest | null = null;
      if (mockRelease) {
        release = (mockRelease as any).tag_name ? parseReleaseManifest(mockRelease as any) : normalizeReleaseManifest(mockRelease);
      } else {
        const ghRelease = await fetchGitHubRelease(this.githubRepo);
        if (ghRelease) {
          release = parseReleaseManifest(ghRelease);
        }
      }

      this.lastCheckedAt = new Date().toISOString();

      if (!release) {
        this.status = "up_to_date";
        this.activeRelease = null;
        if (this.stagedApkPath && existsSync(this.stagedApkPath)) {
          try { rmSync(this.stagedApkPath, { force: true }); } catch {}
          this.stagedApkPath = undefined;
        }
        return this.getStatus();
      }

      const hasUpdate = isUpdateAvailable(this.currentVersion, release.version, {
        currentVersionCode: this.currentVersionCode,
        remoteVersionCode: release.versionCode,
        currentPackageName: this.packageName,
        targetPackageName: release.packageName,
      });

      if (hasUpdate || force) {
        this.activeRelease = release;
        this.status = "available";
      } else {
        this.activeRelease = null;
        this.status = "up_to_date";
        if (this.stagedApkPath && existsSync(this.stagedApkPath)) {
          try { rmSync(this.stagedApkPath, { force: true }); } catch {}
          this.stagedApkPath = undefined;
        }
      }

      return this.getStatus();
    } catch (err) {
      this.status = "error";
      this.lastError = `Update check failed: ${(err as Error).message}`;
      return this.getStatus();
    } finally {
      this.isLocked = false;
    }
  }

  async downloadUpdate(mockDownloadFn?: (dest: string) => Promise<void>): Promise<UpdaterState> {
    if (this.isLocked) {
      throw new Error("Another update operation is currently in progress");
    }
    if (!this.activeRelease) {
      throw new Error("No active release available to download");
    }

    this.isLocked = true;
    this.status = "downloading";
    this.lastError = undefined;
    this.downloadProgress = { downloadedBytes: 0, totalBytes: this.activeRelease.fileSizeBytes, percent: 0 };

    const updatesDir = join(this.dataDir, "updates");
    mkdirSync(updatesDir, { recursive: true });
    const targetFile = join(updatesDir, this.activeRelease.fileName);

    try {
      if (mockDownloadFn) {
        await mockDownloadFn(targetFile);
        this.downloadProgress.downloadedBytes = this.activeRelease.fileSizeBytes;
        this.downloadProgress.percent = 100;
      } else {
        await this.performHttpDownload(this.activeRelease.downloadUrl, targetFile);
      }

      const apkCheck = verifyApkFormat(targetFile);
      if (!apkCheck.valid) {
        try { rmSync(targetFile, { force: true }); } catch {}
        throw new Error(`Downloaded artifact failed format verification: ${apkCheck.error}`);
      }

      if (this.activeRelease.checksumSha256 && !this.activeRelease.checksumSha256.startsWith("url:")) {
        const verification = await verifyFileSha256(targetFile, this.activeRelease.checksumSha256);
        if (!verification.valid) {
          try { rmSync(targetFile, { force: true }); } catch {}
          throw new Error(`Checksum mismatch: expected ${verification.expected} but calculated ${verification.actual}`);
        }
      }

      this.stagedApkPath = targetFile;
      this.status = "ready_to_install";
      return this.getStatus();
    } catch (err) {
      this.status = "error";
      this.lastError = `Download failed: ${(err as Error).message}`;
      return this.getStatus();
    } finally {
      this.isLocked = false;
    }
  }

  async prepareInstall(): Promise<{ stagedApkPath: string; snapshotPath: string; release: ReleaseManifest }> {
    if (!this.stagedApkPath || !existsSync(this.stagedApkPath)) {
      throw new Error("No staged update package ready to install");
    }
    if (!this.activeRelease) {
      throw new Error("No active release manifest");
    }

    const apkCheck = verifyApkFormat(this.stagedApkPath);
    if (!apkCheck.valid) {
      throw new Error(`Cannot install invalid package: ${apkCheck.error}`);
    }

    const snapshot = createSafetyBackup(this.dataDir, this.currentVersion);
    this.lastSnapshotPath = snapshot;
    this.status = "installing";

    return {
      stagedApkPath: this.stagedApkPath,
      snapshotPath: snapshot,
      release: this.activeRelease,
    };
  }

  async completePostUpdateValidation(): Promise<StateValidationResult> {
    this.status = "migrating";
    try {
      await runMigrations(this.dataDir, CURRENT_SCHEMA_VERSION);
      const validation = validatePersistentState(this.dataDir);
      if (!validation.healthy) {
        this.status = "error";
        this.lastError = `Post-update validation failed: ${validation.issues.join(", ")}`;
        if (this.lastSnapshotPath) {
          restoreSafetyBackup(this.dataDir, this.lastSnapshotPath);
        }
        return validation;
      }
      if (this.stagedApkPath && existsSync(this.stagedApkPath)) {
        try { rmSync(this.stagedApkPath, { force: true }); } catch {}
      }
      this.stagedApkPath = undefined;
      this.activeRelease = null;
      this.status = "complete";
      return validation;
    } catch (err) {
      this.status = "error";
      this.lastError = `Post-update migration failed: ${(err as Error).message}`;
      if (this.lastSnapshotPath) {
        restoreSafetyBackup(this.dataDir, this.lastSnapshotPath);
      }
      return validatePersistentState(this.dataDir);
    }
  }

  async rollback(): Promise<{ restored: boolean; snapshot: string }> {
    const snapshots = listSnapshots(this.dataDir);
    if (snapshots.length === 0) {
      throw new Error("No safety snapshots available for rollback");
    }
    const target = this.lastSnapshotPath || snapshots[0].path;
    const restored = restoreSafetyBackup(this.dataDir, target);
    if (restored) {
      this.status = "idle";
      this.lastError = undefined;
    }
    return { restored, snapshot: target };
  }

  private performHttpDownload(downloadUrl: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(downloadUrl);
      const getter = parsedUrl.protocol === "https:" ? httpsGet : httpGet;

      const req = getter(downloadUrl, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.performHttpDownload(res.headers.location, destPath).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download server responded with status code ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10) || this.activeRelease?.fileSizeBytes || 0;
        let downloadedBytes = 0;
        const fileStream = createWriteStream(destPath);

        fileStream.on("error", err => {
          try { rmSync(destPath, { force: true }); } catch {}
          reject(err);
        });

        res.on("data", chunk => {
          downloadedBytes += chunk.length;
          fileStream.write(chunk);
          const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          this.downloadProgress = { downloadedBytes, totalBytes, percent };
        });

        fileStream.on("finish", () => {
          resolve();
        });

        res.on("end", () => {
          fileStream.end();
        });

        res.on("error", err => {
          fileStream.end();
          try { rmSync(destPath, { force: true }); } catch {}
          reject(err);
        });
      });

      req.on("error", err => {
        try { rmSync(destPath, { force: true }); } catch {}
        reject(err);
      });
    });
  }
}
