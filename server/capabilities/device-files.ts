// Device Files & Storage Intelligence (Phase K)
//
// Implements controlled Android-native device file capabilities:
// - file listing, searching, reading, writing, organizing downloads, storage insights
// - Bounded to accessible paths, preventing path traversal attacks.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import { isProtectedMemoryPath } from "../memory-integrity.ts";

export interface FileMetadata {
  name: string;
  path: string;
  size: number;
  category: "pdf" | "image" | "video" | "document" | "installer" | "archive" | "other";
  mtime: string;
  isDirectory: boolean;
}

export interface StorageInsights {
  totalFiles: number;
  totalBytes: number;
  categories: Record<string, { count: number; bytes: number }>;
  largestFiles: FileMetadata[];
}

export interface OrganizeReport {
  movedCount: number;
  categoriesCreated: string[];
  files: Array<{ original: string; newPath: string; category: string }>;
}

export class DeviceFileManager {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    const raw = resolve(rootDir || process.env.DATA_DIR || process.cwd());
    try {
      this.rootDir = realpathSync(raw);
    } catch {
      this.rootDir = raw;
    }
  }

  private safePath(relPath: string): string {
    const full = resolve(this.rootDir, relPath.replace(/^[/\\]+/, ""));
    if (!full.startsWith(this.rootDir)) {
      throw new Error("Access denied: path traversal attempt outside allowed boundary.");
    }
    // This generic file surface is for documents and downloads, not for the
    // server's canonical memory store. The memory API is the only writer of
    // records.json and its manifest; hiding them here keeps an agent from
    // using “organize downloads” as an alternative mutation path. Resolve
    // symlinks too: a link planted in a writable folder must not become a
    // readable alias for the key or the record store.
    let real = full;
    try {
      real = realpathSync(full);
    } catch {
      // A path that does not exist yet is judged by its literal name below;
      // its parent must already be inside the root.
    }
    if (!real.startsWith(this.rootDir)) {
      throw new Error("Access denied: path traversal attempt outside allowed boundary.");
    }
    if (isProtectedMemoryPath(full) || isProtectedMemoryPath(real)) {
      throw new Error("Access denied: canonical memory records are managed by the memory store.");
    }
    return full;
  }

  private categorize(name: string): FileMetadata["category"] {
    const ext = extname(name).toLowerCase();
    switch (ext) {
      case ".pdf":
        return "pdf";
      case ".png":
      case ".jpg":
      case ".jpeg":
      case ".webp":
      case ".gif":
      case ".svg":
        return "image";
      case ".mp4":
      case ".mkv":
      case ".webm":
      case ".mov":
        return "video";
      case ".doc":
      case ".docx":
      case ".txt":
      case ".md":
      case ".csv":
      case ".xlsx":
      case ".json":
        return "document";
      case ".apk":
      case ".deb":
      case ".rpm":
        return "installer";
      case ".zip":
      case ".tar":
      case ".gz":
      case ".7z":
        return "archive";
      default:
        return "other";
    }
  }

  /**
   * List files within a directory.
   */
  listFiles(subDir = ""): FileMetadata[] {
    const dir = this.safePath(subDir);
    if (!existsSync(dir)) return [];

    const entries = readdirSync(dir, { withFileTypes: true }).filter(
      (e) => !isProtectedMemoryPath(join(dir, e.name)),
    );
    return entries.map((e) => {
      const full = join(dir, e.name);
      try {
        const s = statSync(full);
        return {
          name: e.name,
          path: full.slice(this.rootDir.length).replace(/^[/\\]+/, ""),
          size: s.size,
          category: this.categorize(e.name),
          mtime: s.mtime.toISOString(),
          isDirectory: e.isDirectory(),
        };
      } catch {
        return {
          name: e.name,
          path: full.slice(this.rootDir.length).replace(/^[/\\]+/, ""),
          size: 0,
          category: this.categorize(e.name),
          mtime: new Date().toISOString(),
          isDirectory: e.isDirectory(),
        };
      }
    });
  }

  /**
   * Search files using natural language query matching filename, category, or extension.
   */
  searchFiles(query: string, maxResults = 25): FileMetadata[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: FileMetadata[] = [];

    const walk = (currentDir: string) => {
      if (results.length >= maxResults) return;
      try {
        const entries = readdirSync(currentDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const full = join(currentDir, e.name);
          const rel = full.slice(this.rootDir.length).replace(/^[/\\]+/, "");
          const cat = this.categorize(e.name);

          // Check query terms
          const match = terms.some(
            (t) =>
              e.name.toLowerCase().includes(t) ||
              cat.toLowerCase().includes(t) ||
              rel.toLowerCase().includes(t)
          );

          if (isProtectedMemoryPath(full)) continue;

          if (match && !e.isDirectory()) {
            const s = statSync(full);
            results.push({
              name: e.name,
              path: rel,
              size: s.size,
              category: cat,
              mtime: s.mtime.toISOString(),
              isDirectory: false,
            });
            if (results.length >= maxResults) return;
          }

          if (e.isDirectory() && !e.name.includes("node_modules")) {
            walk(full);
          }
        }
      } catch {}
    };

    walk(this.rootDir);
    return results;
  }

  /**
   * Compute storage insights: breakdown by category, large files, total bytes.
   */
  getStorageInsights(): StorageInsights {
    let totalFiles = 0;
    let totalBytes = 0;
    const categories: Record<string, { count: number; bytes: number }> = {};
    const allFiles: FileMetadata[] = [];

    const walk = (currentDir: string) => {
      try {
        const entries = readdirSync(currentDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const full = join(currentDir, e.name);
          if (isProtectedMemoryPath(full)) continue;
          if (e.isDirectory()) {
            if (!e.name.includes("node_modules")) walk(full);
          } else {
            const s = statSync(full);
            const cat = this.categorize(e.name);
            totalFiles++;
            totalBytes += s.size;

            if (!categories[cat]) categories[cat] = { count: 0, bytes: 0 };
            categories[cat].count++;
            categories[cat].bytes += s.size;

            allFiles.push({
              name: e.name,
              path: full.slice(this.rootDir.length).replace(/^[/\\]+/, ""),
              size: s.size,
              category: cat,
              mtime: s.mtime.toISOString(),
              isDirectory: false,
            });
          }
        }
      } catch {}
    };

    walk(this.rootDir);

    // Top 10 largest files
    const largestFiles = allFiles.sort((a, b) => b.size - a.size).slice(0, 10);

    return {
      totalFiles,
      totalBytes,
      categories,
      largestFiles,
    };
  }

  /**
   * Downloads organizer: inspects a folder and organizes files into categorized subfolders.
   */
  organizeDownloads(targetSubDir = "downloads"): OrganizeReport {
    const dir = this.safePath(targetSubDir);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const entries = readdirSync(dir, { withFileTypes: true });
    const moved: OrganizeReport["files"] = [];
    const categoriesCreated = new Set<string>();

    for (const e of entries) {
      if (e.isDirectory() || e.name.startsWith(".")) continue;
      if (isProtectedMemoryPath(join(dir, e.name))) continue;
      const cat = this.categorize(e.name);
      if (cat === "other") continue;

      const folderName = cat.toUpperCase() + "s";
      const catDir = join(dir, folderName);
      if (!existsSync(catDir)) {
        mkdirSync(catDir, { recursive: true });
        categoriesCreated.add(folderName);
      }

      const oldPath = join(dir, e.name);
      const newPath = join(catDir, e.name);
      renameSync(oldPath, newPath);

      moved.push({
        original: e.name,
        newPath: join(targetSubDir, folderName, e.name),
        category: cat,
      });
    }

    return {
      movedCount: moved.length,
      categoriesCreated: Array.from(categoriesCreated),
      files: moved,
    };
  }

  /**
   * Create a subfolder within the safe root.
   */
  createFolder(folderName: string): string {
    const full = this.safePath(folderName);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
    }
    return full;
  }

  /**
   * Write text content to a file within the safe root.
   */
  writeFile(filePath: string, content: string): void {
    const full = this.safePath(filePath);
    const parent = dirname(full);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(full, content, "utf8");
  }
}
