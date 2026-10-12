// Android native addons for the embedded runtime.
//
// Two packages in the torlnk/WebTorrent chain load a native `.node` addon:
//
//   node-datachannel  WebRTC data channels, backed by libdatachannel. Its dist
//                     does `require("../../../build/Release/node_datachannel.node")`,
//                     so the addon has exactly one home inside the package.
//   utp-native        uTP over UDP, backed by libutp. lib/binding.js asks
//                     node-gyp-build, whose first candidate is
//                     build/Release/<anything>.node.
//
// Neither publishes an Android prebuilt, and the phone cannot compile one: the
// npx shim installs with --ignore-scripts precisely because Android denies
// exec of anything in app data, so a lifecycle build step could not run there.
// The APK therefore ships addons compiled by
// scripts/android-net/build-native-addons.mjs, and this module copies the right
// one into each installed package's own build/Release.
//
// Nothing here decides whether the capability is "available". torlnk decides by
// doing `require('node-datachannel')`, and WebTorrent by requiring utp-native
// and checking that the result is a non-empty object. So a copy that is
// missing, of the wrong architecture, or unloadable produces exactly the
// missing-capability report a desktop without the addon produces — there is no
// flag, stub, or environment variable anywhere in this path.

import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One shipped addon, and where its package's loader looks for it. */
export type AddonSpec = {
  /** npm package the addon belongs to (its node_modules entry name). */
  package: string;
  /** File name of the compiled addon in the shipped bundle. */
  file: string;
  /** Path inside the installed package, relative to the package root. */
  target: string;
};

export const ANDROID_ADDONS: readonly AddonSpec[] = [
  { package: "node-datachannel", file: "node_datachannel.node", target: "build/Release/node_datachannel.node" },
  { package: "utp-native", file: "utp_native.node", target: "build/Release/utp_native.node" },
];

/** The Android ABI name for the architecture this process is running as. */
export function androidAbiForArch(arch: string): string | null {
  switch (arch) {
    case "arm64": return "arm64-v8a";
    case "arm": return "armeabi-v7a";
    case "x64": return "x86_64";
    case "ia32": return "x86";
    default: return null;
  }
}

/** e_machine values for the architectures the app builds for. */
const ELF_MACHINES: Record<string, number> = { arm64: 0xb7, arm: 0x28, x64: 0x3e, ia32: 0x03 };

/** Where the addons shipped by the APK live: beside this module, per ABI. */
export function bundledAddonDir(arch: string = process.arch): string | null {
  const abi = androidAbiForArch(arch);
  if (!abi) return null;
  return join(dirname(fileURLToPath(import.meta.url)), "native", abi);
}

/**
 * The ELF machine of a file, or null when it is not an ELF object at all.
 * Only the header is read: this runs on a phone the moment a CLI launches.
 */
export function elfMachine(file: string): number | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    const header = Buffer.alloc(20);
    const read = readSync(fd, header, 0, 20, 0);
    if (read < 20) return null;
    if (header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) return null;
    return header.readUInt16LE(18);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/** True when [file] is an ELF object for [arch] and nothing else. */
export function matchesArch(file: string, arch: string): boolean {
  const expected = ELF_MACHINES[arch];
  if (expected === undefined) return false;
  return elfMachine(file) === expected;
}

export type PlaceResult = {
  /** Targets written this call. */
  placed: string[];
  /** Targets already correct, so nothing was written. */
  current: string[];
  /** Targets intentionally left alone, with the reason. */
  refused: string[];
  /** Packages that are not installed under this root. */
  missing: string[];
};

export type PlaceOptions = {
  /** Directory holding the compiled addons. Defaults to the bundled one. */
  sourceDir?: string;
  /** Architecture to gate on. Defaults to the running one. */
  arch?: string;
  /** Called once per package that was actually written to. */
  onPlace?: (message: string) => void;
};

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Copy the shipped addons into the packages installed under [nodeModulesDir].
 *
 * This is deliberately boring and total: a package that is not installed is
 * skipped, an addon that is already the shipped bytes is left untouched, and
 * an addon whose architecture does not match this process is refused rather
 * than copied. Every outcome is reported instead of logged deep inside, so a
 * caller can summarise it and a test can assert on it.
 */
export function placeAddonsIn(nodeModulesDir: string, options: PlaceOptions = {}): PlaceResult {
  const arch = options.arch ?? process.arch;
  const sourceDir = options.sourceDir ?? bundledAddonDir(arch);
  const result: PlaceResult = { placed: [], current: [], refused: [], missing: [] };
  if (!sourceDir || !existsSync(sourceDir)) return result;

  const expectedMachine = ELF_MACHINES[arch];
  for (const addon of ANDROID_ADDONS) {
    const packageDir = join(nodeModulesDir, ...addon.package.split("/"));
    if (!existsSync(join(packageDir, "package.json"))) {
      result.missing.push(addon.package);
      continue;
    }
    const source = join(sourceDir, addon.file);
    const target = join(packageDir, addon.target);
    if (!existsSync(source)) {
      result.refused.push(`${addon.package}: ${addon.file} is not in the shipped bundle`);
      continue;
    }
    // The architecture gate: a wrong-ABI addon would fail at dlopen on the
    // phone with a confusing "invalid ELF header" — far better to refuse it
    // here, where the capability then reports itself missing exactly as a
    // desktop without the addon does.
    const machine = elfMachine(source);
    if (machine !== expectedMachine) {
      result.refused.push(`${addon.package}: shipped ${addon.file} is not ${arch} (e_machine ${machine ?? "not an ELF"})`);
      continue;
    }
    if (existsSync(target) && statSync(target).size === statSync(source).size && sha256(target) === sha256(source)) {
      result.current.push(addon.package);
      continue;
    }
    try {
      mkdirSync(dirname(target), { recursive: true });
      // Written beside the target and renamed over it: a half-copied addon
      // that the loader would try to dlopen is not a state this can leave.
      const staging = `${target}.omb-${process.pid}`;
      rmSync(staging, { force: true });
      copyFileSync(source, staging);
      chmodSync(staging, 0o755);
      renameSync(staging, target);
      result.placed.push(addon.package);
      options.onPlace?.(`${addon.package} → ${addon.target}`);
    } catch (error) {
      result.refused.push(`${addon.package}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

/** The node_modules root of an npx-shim install prefix. */
export function placeAddonsForPrefix(prefixDir: string, options: PlaceOptions = {}): PlaceResult {
  return placeAddonsIn(join(prefixDir, "node_modules"), options);
}
