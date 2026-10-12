// Build the two native artifacts OpenMausBot's Android terminal needs, with the
// NDK, straight into `app/src/main/jniLibs/<abi>/`.
//
// Why a script and not `externalNativeBuild`: the rest of this build ships its
// native runtime as prebuilt files in `jniLibs` (`libnode_host.so` and the
// patched Termux libraries). Two more files built the same way keeps one story
// — "native artifacts live in jniLibs and are produced by a script" — instead
// of two, and it keeps the Gradle build working on a machine with no NDK at
// all, which is how the desktop-side contributors and CI build it today.
//
//   libombpty.so   JNI: openpty/forkpty, read/write/resize/wait/close
//   libombexec.so  a PIE executable named like a library (the only file name
//                  the package manager extracts from lib/<abi>/) that gives
//                  npm/npx a real ELF to be a symlink to, so Android's
//                  "no exec from app data" rule stops applying to them.
//
// Usage: node scripts/build-android-pty.mjs [--abi arm64-v8a] [--check]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = join(root, "android");
const jni = join(androidRoot, "app", "src", "main", "jni");
const jniLibs = join(androidRoot, "app", "src", "main", "jniLibs");

/** minSdk (Android 8) — forkpty is bionic libc API, present well before it. */
const API = 26;

const ABIS = {
  "arm64-v8a": "aarch64-linux-android",
  "armeabi-v7a": "armv7a-linux-androideabi",
  "x86_64": "x86_64-linux-android",
};

const args = process.argv.slice(2);
const wantAbi = args.includes("--abi") ? args[args.indexOf("--abi") + 1] : null;
const checkOnly = args.includes("--check");
const hostMode = args.includes("--host");
if (wantAbi && !ABIS[wantAbi]) throw new Error(`unknown ABI: ${wantAbi}`);

// The launcher is the one piece of native code whose logic (which name means
// which script, and where the runtime is) can be verified on the development
// machine as well as on a phone. `--host` builds it for this machine into
// .omb-native-host/ so the test suite can execute the real binary instead of
// reasoning about it. It is a build artifact, not a shipped one.
if (hostMode) {
  const outDir = join(root, ".omb-native-host");
  mkdirSync(outDir, { recursive: true });
  const cc = process.env.CC || "cc";
  const out = join(outDir, "libombexec.so");
  execFileSync(cc, ["-fPIE", "-pie", "-O2", "-Wall", "-Wextra", "-o", out, join(jni, "ombexec.c")], {
    stdio: "inherit",
  });
  console.log(`host launcher: ${resolve(out)} (${(statSync(out).size / 1024).toFixed(1)} KB)`);
  process.exit(0);
}

/** The NDK, from the environment first, then the SDK the Android build uses. */
function findNdk() {
  const explicit = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT;
  if (explicit && existsSync(explicit)) return explicit;
  const sdkRoot = process.env.ANDROID_HOME
    || process.env.ANDROID_SDK_ROOT
    || (() => {
      const local = join(androidRoot, "local.properties");
      if (!existsSync(local)) return null;
      const line = readFileSync(local, "utf8").split("\n").find((l) => l.startsWith("sdk.dir="));
      return line ? line.slice("sdk.dir=".length).trim() : null;
    })();
  if (!sdkRoot) return null;
  const ndkDir = join(sdkRoot, "ndk");
  if (!existsSync(ndkDir)) return null;
  // Highest installed version wins; the NDK's own layout is the contract, not
  // a pinned number this script would have to be edited to follow.
  const versions = readdirNames(ndkDir).sort(compareVersions);
  return versions.length ? join(ndkDir, versions[versions.length - 1]) : null;
}

function readdirNames(dir) {
  return execFileSync("ls", ["-1", dir], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 26.1.10909125 → [26,1,10909125] so 28.2 sorts above 26.3. */
function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.localeCompare(b);
}

const ndk = findNdk();
if (!ndk) {
  console.error(
    "No Android NDK found. Install one with:\n" +
      "  $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --install 'ndk;28.2.13676358'\n" +
      "or point ANDROID_NDK_HOME at an existing NDK.",
  );
  process.exit(1);
}
const bin = join(ndk, "toolchains", "llvm", "prebuilt", process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64", "bin");
if (!existsSync(bin)) {
  console.error(`The NDK at ${ndk} has no LLVM toolchain at ${bin}`);
  process.exit(1);
}

console.log(`NDK: ${ndk}`);

const missing = [];
for (const [abi, triple] of Object.entries(ABIS)) {
  if (wantAbi && abi !== wantAbi) continue;
  const outDir = join(jniLibs, abi);
  mkdirSync(outDir, { recursive: true });
  const cc = join(bin, `${triple}${API}-clang`);
  const out = {
    pty: join(outDir, "libombpty.so"),
    exec: join(outDir, "libombexec.so"),
  };

  if (checkOnly) {
    for (const [kind, file] of Object.entries(out)) {
      const present = existsSync(file);
      console.log(`${present ? "ok  " : "MISS"} ${abi}/${kind === "pty" ? "libombpty.so" : "libombexec.so"}`);
      if (!present) missing.push(file);
    }
    continue;
  }

  // JNI library: a normal shared object, loaded with System.loadLibrary.
  execFileSync(cc, [
    "--target=" + `${triple}${API}`,
    "-shared", "-fPIC", "-O2", "-Wall", "-Wextra", "-D_GNU_SOURCE=1",
    "-o", out.pty,
    join(jni, "ombpty.c"),
  ], { stdio: "inherit" });

  // The launcher: a PIE *executable* that is named like a library because that
  // is the only shape the package manager will extract into nativeLibraryDir.
  execFileSync(cc, [
    "--target=" + `${triple}${API}`,
    "-fPIE", "-pie", "-O2", "-Wall", "-Wextra",
    "-o", out.exec,
    join(jni, "ombexec.c"),
  ], { stdio: "inherit" });

  for (const [kind, file] of Object.entries(out)) {
    const size = statSync(file).size;
    console.log(`${abi}: ${resolve(file)} (${(size / 1024).toFixed(1)} KB, ${kind})`);
  }
}

if (missing.length) {
  console.error(`missing native artifacts: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("native terminal artifacts are in place");
