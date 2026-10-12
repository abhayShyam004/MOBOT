// Unit tests for the Android native addon placement.
//
// The interesting failures here are the quiet ones: an addon of the wrong
// architecture, a half-written file, or a stale one left from an older build
// would all end as "the capability is missing" on a phone under test, with the
// real reason buried in a dlopen error nobody reads. So the tests pin the ABI
// gate, the atomic replace, and the idempotent fast path.
//
// Nothing here needs a compiler or a device: the addons in these fixtures are
// synthetic ELF headers, which is exactly what the gate inspects.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANDROID_ADDONS,
  androidAbiForArch,
  bundledAddonDir,
  elfMachine,
  matchesArch,
  placeAddonsIn,
  placeAddonsForPrefix,
} from "./android-native-addons.ts";

/** A 20-byte ELF header with the given e_machine: all the gate reads. */
function fakeElf(machine: number): Buffer {
  const header = Buffer.alloc(64, 0);
  header.write("\x7fELF", 0, "latin1");
  header[4] = 2; // 64-bit
  header[5] = 1; // little endian
  header[6] = 1; // version
  header.writeUInt16LE(machine, 18);
  return header;
}

const AARCH64 = 0xb7;
const X86_64 = 0x3e;

let root: string;
let sourceDir: string;
let nodeModules: string;

/** A fixture package tree, with only the addons asked for. */
function installPackage(name: string): string {
  const dir = join(nodeModules, ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  return dir;
}

function buildShippedAddon(file: string, machine: number, filler = "addon"): string {
  mkdirSync(sourceDir, { recursive: true });
  const path = join(sourceDir, file);
  writeFileSync(path, Buffer.concat([fakeElf(machine), Buffer.from(filler.repeat(64))]));
  return path;
}

beforeEach(() => {
  root = join(tmpdir(), `omb-addons-${process.pid}-${Math.random().toString(36).slice(2)}`);
  sourceDir = join(root, "native", "x86_64");
  nodeModules = join(root, "prefix", "node_modules");
  mkdirSync(nodeModules, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("android native addons: ABI naming", () => {
  it("maps the runtime's arch to the Android ABI the bundle is keyed by", () => {
    expect(androidAbiForArch("arm64")).toBe("arm64-v8a");
    expect(androidAbiForArch("arm")).toBe("armeabi-v7a");
    expect(androidAbiForArch("x64")).toBe("x86_64");
    expect(androidAbiForArch("ia32")).toBe("x86");
    expect(androidAbiForArch("riscv64")).toBeNull();
  });

  it("resolves the shipped directory beside the module, per ABI", () => {
    const dir = bundledAddonDir("arm64");
    expect(dir).not.toBeNull();
    expect(dir!.endsWith(join("native", "arm64-v8a"))).toBe(true);
    expect(bundledAddonDir("riscv64")).toBeNull();
  });

  it("knows the exact path each package's own loader looks in", () => {
    // node-datachannel's dist requires ../../../build/Release/node_datachannel.node
    // and node-gyp-build asks for build/Release/<name>.node first, so these two
    // targets are the contract, not a preference.
    expect(ANDROID_ADDONS).toEqual([
      { package: "node-datachannel", file: "node_datachannel.node", target: "build/Release/node_datachannel.node" },
      { package: "utp-native", file: "utp_native.node", target: "build/Release/utp_native.node" },
    ]);
  });
});

describe("android native addons: ELF gate", () => {
  it("reads the machine type out of a header", () => {
    mkdirSync(sourceDir, { recursive: true });
    const file = join(sourceDir, "probe.node");
    writeFileSync(file, fakeElf(AARCH64));
    expect(elfMachine(file)).toBe(AARCH64);
    expect(matchesArch(file, "arm64")).toBe(true);
    expect(matchesArch(file, "x64")).toBe(false);
  });

  it("answers null for something that is not an ELF object", () => {
    mkdirSync(sourceDir, { recursive: true });
    const file = join(sourceDir, "not-an-object.node");
    writeFileSync(file, "plain text, exactly the sort of thing a broken build leaves");
    expect(elfMachine(file)).toBeNull();
    expect(matchesArch(file, "arm64")).toBe(false);
    expect(elfMachine(join(sourceDir, "does-not-exist.node"))).toBeNull();
  });
});

describe("android native addons: placement", () => {
  it("copies each addon into the package's own build/Release", () => {
    const pkgDir = installPackage("node-datachannel");
    const shipped = buildShippedAddon("node_datachannel.node", X86_64);

    const result = placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });

    expect(result.placed).toEqual(["node-datachannel"]);
    const target = join(pkgDir, "build", "Release", "node_datachannel.node");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target)).toEqual(readFileSync(shipped));
    // A loader that cannot read it would fail for a reason that has nothing to
    // do with the transport, so the mode has to be readable at least.
    expect(statSync(target).mode & 0o400).toBeTruthy();
  });

  it("reports packages that are not installed instead of inventing them", () => {
    installPackage("node-datachannel");
    buildShippedAddon("node_datachannel.node", X86_64);
    buildShippedAddon("utp_native.node", X86_64);

    const result = placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });

    expect(result.placed).toEqual(["node-datachannel"]);
    expect(result.missing).toEqual(["utp-native"]);
    expect(existsSync(join(nodeModules, "utp-native"))).toBe(false);
  });

  it("is idempotent: an addon that already matches is not rewritten", () => {
    installPackage("utp-native");
    buildShippedAddon("utp_native.node", X86_64);
    placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });
    const target = join(nodeModules, "utp-native", "build", "Release", "utp_native.node");
    const before = statSync(target).mtimeMs;

    const second = placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });

    expect(second.placed).toEqual([]);
    expect(second.current).toEqual(["utp-native"]);
    expect(statSync(target).mtimeMs).toBe(before);
  });

  it("replaces a stale addon from an older build", () => {
    const pkgDir = installPackage("node-datachannel");
    const target = join(pkgDir, "build", "Release", "node_datachannel.node");
    mkdirSync(join(pkgDir, "build", "Release"), { recursive: true });
    writeFileSync(target, fakeElf(AARCH64));
    buildShippedAddon("node_datachannel.node", X86_64, "newer-build");

    const result = placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });

    expect(result.placed).toEqual(["node-datachannel"]);
    expect(elfMachine(target)).toBe(X86_64);
  });

  it("refuses a wrong-architecture addon rather than copying it", () => {
    const pkgDir = installPackage("node-datachannel");
    buildShippedAddon("node_datachannel.node", AARCH64);

    const result = placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });

    expect(result.placed).toEqual([]);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]).toContain("node-datachannel");
    expect(result.refused[0]).toContain("x64");
    expect(existsSync(join(pkgDir, "build"))).toBe(false);
  });

  it("refuses a shipped file that is not an ELF object", () => {
    installPackage("utp-native");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "utp_native.node"), "corrupt");

    const result = placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });

    expect(result.placed).toEqual([]);
    expect(result.refused[0]).toContain("not an ELF");
  });

  it("does nothing when the bundle has no addons for this ABI", () => {
    installPackage("node-datachannel");
    const result = placeAddonsIn(nodeModules, { sourceDir: join(root, "absent"), arch: "x64" });
    expect(result).toEqual({ placed: [], current: [], refused: [], missing: [] });
  });

  it("creates nothing outside the package it is given", () => {
    const pkgDir = installPackage("node-datachannel");
    buildShippedAddon("node_datachannel.node", X86_64);
    placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });
    // The staging file used for the atomic replace must not survive.
    const leftovers = readdirNames(join(pkgDir, "build", "Release"));
    expect(leftovers).toEqual(["node_datachannel.node"]);
  });

  it("takes the prefix form the npx shim calls with", () => {
    installPackage("node-datachannel");
    buildShippedAddon("node_datachannel.node", X86_64);
    const result = placeAddonsForPrefix(join(root, "prefix"), { sourceDir, arch: "x64" });
    expect(result.placed).toEqual(["node-datachannel"]);
  });
});

describe("android native addons: the loader contract", () => {
  // The addon is useless if the loader cannot find it, and each library finds
  // it through its own hard-coded relative path. These two tests pin the paths
  // in a fixture shaped like the installed package, so a rename in either
  // package would fail here rather than on a phone.
  it("node-datachannel's dist loader resolves the placed addon", () => {
    const pkgDir = installPackage("node-datachannel");
    mkdirSync(join(pkgDir, "build", "Release"), { recursive: true });
    mkdirSync(join(pkgDir, "dist", "cjs", "lib"), { recursive: true });
    writeFileSync(
      join(pkgDir, "dist", "cjs", "lib", "node-datachannel.cjs"),
      'module.exports = require("../../../build/Release/node_datachannel.node");\n',
    );
    // A non-ELF file is enough to prove resolution: require() must reach the
    // addon (and fail inside it), not fail with MODULE_NOT_FOUND.
    writeFileSync(join(pkgDir, "build", "Release", "node_datachannel.node"), fakeElf(AARCH64));

    expect(() => require(join(pkgDir, "dist", "cjs", "lib", "node-datachannel.cjs"))).toThrow();
    expect(() => require(join(pkgDir, "dist", "cjs", "lib", "node-datachannel.cjs")))
      .not.toThrow(/Cannot find module/);
  });

  it("node-gyp-build's first candidate is the placed addon", () => {
    const pkgDir = installPackage("utp-native");
    const target = join(pkgDir, "build", "Release", "utp_native.node");
    expect(existsSync(target)).toBe(false);
    buildShippedAddon("utp_native.node", X86_64);
    placeAddonsIn(nodeModules, { sourceDir, arch: "x64" });
    // node-gyp-build globs build/Release/*.node; the file name is not part of
    // its contract, so what matters is that exactly one candidate exists.
    expect(readdirNames(join(pkgDir, "build", "Release")).filter((n) => n.endsWith(".node"))).toEqual([
      "utp_native.node",
    ]);
  });
});

function readdirNames(dir: string): string[] {
  return readdirSync(dir);
}
