// Unit tests for the Android npx shim's pure helpers (no child processes):
// argument parsing must mirror the npx forms the bot terminal is told about,
// bin resolution must follow npm's package.json `bin` shapes, and the
// script-vs-native check decides the honest refusal for compiled CLIs.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  looksLikeScript,
  packageNameOf,
  parseNpxArgs,
  resolvePackageBin,
} from "./android-npx-shim.ts";

describe("npx shim: argument parsing", () => {
  it("treats the first bare token as the package and command", () => {
    const parsed = parseNpxArgs(["torlnk", "--help"]);
    expect(parsed).toEqual({
      packages: ["torlnk"],
      command: "torlnk",
      args: ["--help"],
      noInstall: false,
    });
  });

  it("supports pkg@version and passes through args after the command", () => {
    const parsed = parseNpxArgs(["--yes", "cowsay@1.6.0", "moo", "-e", "Tux"]);
    expect(parsed.packages).toEqual(["cowsay@1.6.0"]);
    expect(parsed.command).toBe("cowsay");
    expect(parsed.args).toEqual(["moo", "-e", "Tux"]);
  });

  it("handles -p/--package (separate and = forms) and --", () => {
    expect(parseNpxArgs(["-p", "@scope/cli@2", "other", "run"]).packages).toEqual(["@scope/cli@2"]);
    expect(parseNpxArgs(["-p", "@scope/cli", "other", "run"]).command).toBe("other");
    expect(parseNpxArgs(["--package=@scope/cli", "other"]).packages).toEqual(["@scope/cli"]);
    // `--` ends npx's own flags; real npx still treats the first token after
    // it as the spec/command, so this pathological form mirrors that exactly.
    const dashDash = parseNpxArgs(["--", "-y", "thing"]);
    expect(dashDash.packages).toEqual(["-y"]);
    expect(dashDash.command).toBe("-y");
    expect(dashDash.args).toEqual(["thing"]);
    expect(parseNpxArgs(["--", "thing", "-y"]).command).toBe("thing");
    expect(parseNpxArgs(["--", "thing", "-y"]).args).toEqual(["-y"]);
  });

  it("accepts the flags npm users type without breaking", () => {
    for (const flag of ["-y", "--yes", "-q", "--quiet"]) {
      expect(parseNpxArgs([flag, "torlnk"]).command).toBe("torlnk");
    }
    expect(parseNpxArgs(["--no-install", "torlnk"]).noInstall).toBe(true);
  });

  it("rejects a missing command", () => {
    expect(() => parseNpxArgs(["-y"])).toThrow(/needs a command/);
  });

  it("rejects unknown flags instead of eating them silently", () => {
    expect(() => parseNpxArgs(["--shell", "torlnk"])).toThrow(/unsupported npx flag/);
    expect(() => parseNpxArgs(["-p"])).toThrow(/needs a package spec/);
  });
});

describe("npx shim: package names and bin resolution", () => {
  it("extracts package names from specs", () => {
    expect(packageNameOf("foo@1.2.3")).toBe("foo");
    expect(packageNameOf("foo")).toBe("foo");
    expect(packageNameOf("@scope/pkg@1.0.0")).toBe("@scope/pkg");
    expect(packageNameOf("@scope/pkg")).toBe("@scope/pkg");
  });

  let root: string;
  beforeEach(() => {
    root = join(tmpdir(), `omb-npx-shim-${process.pid}-${Math.random().toString(36).slice(2)}`);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function install(name: string, bin: string | Record<string, string> | undefined, files: Record<string, string> = {}) {
    const dir = join(root, "node_modules", ...name.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, bin: bin ?? undefined }));
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
  }

  it("resolves a string bin for the default command", () => {
    install("torlnk", "cli.mjs", { "cli.mjs": "console.log(1)" });
    expect(resolvePackageBin(root, "torlnk", "torlnk")).toBe(join(root, "node_modules", "torlnk", "cli.mjs"));
  });

  it("resolves named bins and falls back to a sole named bin", () => {
    install("multi", { one: "./dist/one.js", two: "./dist/two.js" }, { "dist/one.js": "", "dist/two.js": "" });
    expect(resolvePackageBin(root, "multi", "two")).toBe(join(root, "node_modules", "multi", "dist/two.js"));
    expect(resolvePackageBin(root, "multi", "one")).toBe(join(root, "node_modules", "multi", "dist/one.js"));
    expect(resolvePackageBin(root, "multi", "three")).toBeNull();

    install("solo", { only: "./run.js" }, { "run.js": "" });
    expect(resolvePackageBin(root, "solo", "anything")).toBe(join(root, "node_modules", "solo", "run.js"));
  });

  it("returns null for missing packages, missing bins, and unusable manifests", () => {
    expect(resolvePackageBin(root, "ghost", "ghost")).toBeNull();
    install("nobin", undefined);
    expect(resolvePackageBin(root, "nobin", "nobin")).toBeNull();
    const dir = join(root, "node_modules", "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{not json");
    expect(resolvePackageBin(root, "broken", "broken")).toBeNull();
  });

  it("accepts JS CLIs and refuses native binaries", () => {
    expect(looksLikeScript("/x/cli.js")).toBe(true);
    expect(looksLikeScript("/x/cli.mjs")).toBe(true);
    expect(looksLikeScript("/x/cli.cjs")).toBe(true);
    expect(looksLikeScript("/x/bin/torlnk")).toBe(false);
    expect(looksLikeScript("/x/main.native")).toBe(false);
  });
});
