// Android npx shim — a small, dependency-free replacement for `npx` on a
// phone where downloaded binaries cannot be exec'd (Android blocks execve of
// files in app data; only the APK's nativeLibraryDir is executable). npm's
// own npx runs package bins by spawning the .bin script, which the kernel
// denies — this shim resolves the package's bin JS file and runs it with the
// embedded Node runtime instead: `node <bin.js> <args>`. Pure-JS CLIs (the
// common case, e.g. torlnk) work; native binaries are reported clearly.
//
// Usage (mirrors the common npx forms):
//   npx [--yes] [-p|--package <spec>] <command> [args...]
//   npx [--yes] <package[@version]> [args...]
//
// Exits with the child's exit code. Only the main guard below runs a child;
// parseNpxArgs/resolvePackageBin are exported for tests.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { placeAddonsForPrefix } from "./android-native-addons.ts";

export type NpxInvocation = {
  /** Package specs to ensure installed ("name" or "name@version"). */
  packages: string[];
  /** The command (bin name) to run. */
  command: string;
  /** Arguments passed to the command. */
  args: string[];
  /** --no-install: fail instead of installing a missing package. */
  noInstall: boolean;
};

const FLAGS_WITH_VALUE = new Set(["-p", "--package"]);

/** Parse the subset of npx's CLI this shim supports. Throws on misuse.
 *  Flags before the command belong to npx; everything from the command (or
 *  `--`) onward is passed to the child untouched, so package CLIs keep
 *  their own flags (`npx torlnk --help`, `npx cowsay -e Tux`). */
export function parseNpxArgs(argv: readonly string[]): NpxInvocation {
  const packages: string[] = [];
  const rest: string[] = [];
  let noInstall = false;
  let parsingNpxFlags = true;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (parsingNpxFlags && token === "--") {
      parsingNpxFlags = false;
      continue;
    }
    if (parsingNpxFlags && token.startsWith("-") && token !== "-") {
      if (token === "-y" || token === "--yes" || token === "-q" || token === "--quiet") continue;
      if (token === "--no-install") {
        noInstall = true;
        continue;
      }
      if (FLAGS_WITH_VALUE.has(token)) {
        const value = argv[index + 1];
        if (!value) throw new Error(`${token} needs a package spec`);
        packages.push(value);
        index += 1;
        continue;
      }
      if (token.startsWith("--package=")) {
        packages.push(token.slice("--package=".length));
        continue;
      }
      throw new Error(`unsupported npx flag: ${token}`);
    }
    parsingNpxFlags = false;
    rest.push(token);
  }
  const command = rest.shift();
  if (!command) throw new Error("npx needs a command, e.g. npx --yes torlnk");
  // Without -p the first positional IS the package spec (`npx cowsay@1.6 moo`
  // runs the cowsay bin); with -p the command token names the bin itself.
  const binName = packages.length ? command : defaultBinName(command);
  return { packages: packages.length ? packages : [command], command: binName, args: rest, noInstall };
}

/** Package name of a spec ("foo@1.2.3" → "foo", "@s/n@1" → "@s/n"). */
export function packageNameOf(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/** Bin name npm would run for a bare package spec: the package name's last
 *  path segment, version stripped ("cowsay@1.6.0" → "cowsay", "@s/cli" →
 *  "cli"). */
export function defaultBinName(spec: string): string {
  const last = spec.slice(spec.lastIndexOf("/") + 1);
  const at = last.lastIndexOf("@");
  return at > 0 ? last.slice(0, at) : last;
}

/**
 * Resolve the JS file to run for a bin name inside an installed package.
 * Returns null when the package has no matching bin.
 */
export function resolvePackageBin(prefixDir: string, packageName: string, command: string): string | null {
  const packageDir = join(prefixDir, "node_modules", ...packageName.split("/"));
  const manifestPath = join(packageDir, "package.json");
  if (!existsSync(manifestPath)) return null;
  let manifest: { bin?: string | Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
  } catch {
    return null;
  }
  const bin = manifest.bin;
  let relative: string | undefined;
  if (typeof bin === "string") {
    if (command === packageName.split("/").pop()) relative = bin;
  } else if (bin && typeof bin === "object") {
    relative = bin[command] ?? (Object.keys(bin).length === 1 ? Object.values(bin)[0] : undefined);
  }
  if (!relative) return null;
  return resolve(packageDir, relative);
}

/** True for files Node can run as a script (as opposed to native binaries). */
export function looksLikeScript(path: string): boolean {
  return /\.(c|m)?js$/.test(path);
}

function cacheDirFor(spec: string): string {
  const home = process.env.HOME || process.cwd();
  const safe = spec.replace(/[^A-Za-z0-9._@-]/g, "_");
  return join(home, ".npm", "_npx-shim", safe);
}

/**
 * Put the prebuilt native addons where the packages about to run look for
 * them. npm installed with --ignore-scripts (Android cannot run a build step),
 * so the two addons this chain needs — node-datachannel for WebRTC and
 * utp-native for uTP — come from the APK and are copied into each installed
 * package's own build/Release directory here.
 *
 * Runs on every npx invocation, not only after an install, so a package that
 * was already on the phone before this build gains its addon too. Placement
 * costs a couple of stats when the addon is already correct.
 */
function ensureNativeAddons(prefixDir: string): void {
  try {
    const outcome = placeAddonsForPrefix(prefixDir, {
      onPlace: (what) => console.error(`npx: native addon ${what}`),
    });
    for (const refusal of outcome.refused) console.error(`npx: native addon not placed — ${refusal}`);
  } catch (error) {
    // Never reject a command because an optional capability could not be
    // placed: the libraries probe for themselves and report what is missing.
    console.error(`npx: native addon placement failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runNode(scriptPath: string, args: readonly string[]): number {
  const child = spawnSync(process.execPath, [scriptPath, ...args], { stdio: "inherit", env: runEnv() });
  if (child.error) {
    console.error(`npx: could not run ${scriptPath}: ${child.error.message}`);
    return 1;
  }
  return child.status ?? 1;
}

/** Env for the installed CLI and for npm itself. Two Android realities:
 *  the dynamic linker does not search the embedded runtime's directory on
 *  fresh exec, so LD_LIBRARY_PATH must point at it; and packages whose
 *  scripts spawn `node` (task runners, compile steps) need an exec-allowed
 *  node on PATH — the adapter publishes one in <workspace>/.omb-bin. */
function runEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const nativeDir = dirname(process.execPath);
  env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH ? `${env.LD_LIBRARY_PATH}:${nativeDir}` : nativeDir;
  const botBin = join(process.env.HOME || process.cwd(), ".omb-bin");
  if (existsSync(join(botBin, "node"))) {
    env.PATH = env.PATH ? `${botBin}:${env.PATH}` : botBin;
  }
  return env;
}

function main(): number {
  const invocation = parseNpxArgs(process.argv.slice(2));
  const npmCli = process.env.OMB_NPM_CLI;
  const prefixDir = cacheDirFor(invocation.packages.join("+"));
  const packageName = packageNameOf(invocation.command);

  let binPath = resolvePackageBin(prefixDir, packageName, invocation.command);
  if (!binPath) {
    if (invocation.noInstall) {
      console.error(`npx: ${packageName} is not installed here and --no-install was given`);
      return 1;
    }
    if (!npmCli || !existsSync(npmCli)) {
      console.error("npx: no npm installation found to fetch packages with");
      return 1;
    }
    mkdirSync(dirname(prefixDir), { recursive: true });
    // --ignore-scripts is a correctness fix on Android, not a hardening
    // choice: lifecycle scripts run through `sh`, whose child processes
    // cannot see shell functions, so even a `npx only-allow pnpm` guard
    // dies with "npx: not found". Build steps that need compiled binaries
    // cannot work under Android's exec block either; pure-JS postinstalls
    // that matter are rerun manually by the person with node.
    const install = spawnSync(process.execPath, [
      npmCli, "install", "--prefix", prefixDir, "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel", "error",
      ...invocation.packages,
    ], { stdio: "inherit", env: runEnv() });
    if (install.error || install.status !== 0) {
      console.error(`npx: installing ${invocation.packages.join(", ")} failed`);
      return install.status ?? 1;
    }
    binPath = resolvePackageBin(prefixDir, packageName, invocation.command);
  }
  if (!binPath || !existsSync(binPath)) {
    console.error(`npx: ${packageName} has no bin named "${invocation.command}"`);
    return 1;
  }
  if (!looksLikeScript(binPath)) {
    console.error(`npx: ${packageName}'s "${invocation.command}" is not a JavaScript CLI (Android cannot run downloaded binaries)`);
    return 1;
  }
  ensureNativeAddons(prefixDir);
  return runNode(binPath, invocation.args);
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === new URL(`file://${resolve(entry)}`).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`npx: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
