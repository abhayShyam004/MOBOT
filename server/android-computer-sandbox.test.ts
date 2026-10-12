import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMMAND_ALLOWLIST, SandboxError, assertWritableTarget, commandEnv,
  prepareCommand, resolveInside,
} from "./android-computer-sandbox.ts";

describe("resolveInside (workspace path sandbox)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "omb-sandbox-"));
    mkdirSync(join(root, "dir"));
    writeFileSync(join(root, "file.txt"), "hello");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves normal relative paths into the workspace", () => {
    expect(resolveInside(root, "dir")).toBe(join(root, "dir"));
    expect(resolveInside(root, "dir/../file.txt")).toBe(join(root, "file.txt"));
    expect(resolveInside(root, "./file.txt")).toBe(join(root, "file.txt"));
    expect(resolveInside(root, ".")).toBe(root);
  });

  it("treats a leading slash as workspace-absolute, not an escape", () => {
    expect(resolveInside(root, "/file.txt")).toBe(join(root, "file.txt"));
  });

  it("rejects ..-style escapes", () => {
    expect(() => resolveInside(root, "../outside")).toThrow(SandboxError);
    expect(() => resolveInside(root, "..")).toThrow(SandboxError);
    expect(() => resolveInside(root, "dir/../../etc/passwd")).toThrow(SandboxError);
  });

  it("rejects NUL bytes and oversized paths", () => {
    expect(() => resolveInside(root, "bad\0name")).toThrow(/NUL/);
    expect(() => resolveInside(root, "a".repeat(2_000))).toThrow(/exceeds/);
    expect(() => resolveInside(root, "")).toThrow();
  });

  it("rejects symlinked paths that resolve outside the workspace", () => {
    const outside = mkdtempSync(join(tmpdir(), "omb-outside-"));
    try {
      symlinkSync(outside, join(root, "escape"));
      expect(() => resolveInside(root, "escape/file.txt")).toThrow(/symlink/);
      // workspace-internal symlinks are fine
      symlinkSync(join(root, "file.txt"), join(root, "alias"));
      expect(resolveInside(root, "alias")).toBe(join(root, "file.txt"));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects creating a path whose nearest existing ancestor escapes via symlink", () => {
    const outside = mkdtempSync(join(tmpdir(), "omb-outside-"));
    try {
      symlinkSync(outside, join(root, "escape"));
      // `escape/newfile` does not exist yet; the write must still be refused
      // because the nearest existing ancestor (escape) resolves outside.
      expect(() => resolveInside(root, "escape/newfile.txt")).toThrow(/symlink/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("URL-encoded traversal is just a name, not an escape", () => {
    // %2e%2e is a literal filename here; if it could be created it would be
    // contained. The resolver must not decode it.
    expect(resolveInside(root, "%2e%2e")).toBe(join(root, "%2e%2e"));
  });

  it("allows creating files one level under a not-yet-existing directory", () => {
    const target = resolveInside(root, "newdir/inner/file.txt");
    expect(target).toBe(join(root, "newdir", "inner", "file.txt"));
  });
});

describe("assertWritableTarget", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "omb-sandbox-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("allows missing targets and refuses directories", () => {
    expect(() => assertWritableTarget(join(root, "fresh.txt"))).not.toThrow();
    writeFileSync(join(root, "f.txt"), "x");
    expect(() => assertWritableTarget(join(root, "f.txt"))).not.toThrow();
    mkdirSync(join(root, "d"));
    expect(() => assertWritableTarget(join(root, "d"))).toThrow(/directory/);
  });
});

describe("prepareCommand", () => {
  const workspace = "/data/workspace";

  it("spawns allowlisted toybox applets directly, without a shell", () => {
    const prepared = prepareCommand(workspace, "ls", ["-la", "sub dir"], undefined);
    expect(prepared.file).toBe("/system/bin/ls");
    expect(prepared.args).toEqual(["-la", "sub dir"]);
  });

  it("rejects non-allowlisted commands, paths, and injection attempts", () => {
    expect(() => prepareCommand(workspace, "sh", ["-c", "rm -rf /"], undefined)).toThrow(/not allowed/);
    expect(() => prepareCommand(workspace, "/system/bin/ls", [], undefined)).toThrow(/bare name/);
    expect(() => prepareCommand(workspace, "am", ["start", "-n", "com.android.settings"], undefined)).toThrow(/not allowed/);
    expect(() => prepareCommand(workspace, "ls\u0000rm", [], undefined)).toThrow();
  });

  it("enforces argument and timeout bounds", () => {
    expect(() => prepareCommand(workspace, "ls", [Array(5_000).fill("a").join("")], undefined)).toThrow();
    expect(() => prepareCommand(workspace, "ls", Array(100).fill("x"), undefined)).toThrow(/too many arguments/);
    expect(() => prepareCommand(workspace, "ls", [], 60_000)).toThrow(/30s limit/);
    expect(() => prepareCommand(workspace, "ls", [], 99)).toThrow();
    expect(prepareCommand(workspace, "ls", [], 30_000).timeoutMs).toBe(30_000);
    expect(prepareCommand(workspace, "ls", [], undefined).timeoutMs).toBe(10_000);
  });

  it("builds a minimal, credential-free environment", () => {
    const env = commandEnv(workspace);
    const values = Object.values(env).join(" ");
    expect(values).not.toMatch(/key|token|password|secret/i);
    expect(env.PATH).toBe("/system/bin:/system/xbin");
    expect(env.HOME).toBe(workspace);
  });

  it("allowlist documents exactly what is available", () => {
    expect(COMMAND_ALLOWLIST.has("ls")).toBe(true);
    expect(COMMAND_ALLOWLIST.has("ping")).toBe(true);
    expect(COMMAND_ALLOWLIST.has("sh")).toBe(false);
    expect(COMMAND_ALLOWLIST.has("mount")).toBe(false);
    expect(COMMAND_ALLOWLIST.has("settings")).toBe(false);
    expect(COMMAND_ALLOWLIST.has("pm")).toBe(false);
    expect(COMMAND_ALLOWLIST.has("am")).toBe(false);
    expect(COMMAND_ALLOWLIST.has("su")).toBe(false);
  });
});
