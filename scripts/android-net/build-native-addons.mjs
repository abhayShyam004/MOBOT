#!/usr/bin/env node
// Android native addons for the embedded Node runtime: the WebRTC
// data-channel addon (node-datachannel → libdatachannel) and the uTP addon
// (utp-native → libutp). Neither publishes an Android prebuilt, and Android
// will not run a downloaded binary, so both are compiled here from pinned
// sources with the Android NDK and packaged into the app by
// prepare-android-host.mjs.
//
//   node scripts/android-net/build-native-addons.mjs [--abi arm64-v8a]
//                                                    [--only webrtc|utp]
//                                                    [--check]
//
// Sources are cached under .omb-scratch/webrtc/third_party/ (gitignored) and
// verified against the sha256/commit recorded below before use. Outputs:
//
//   .omb-scratch/webrtc/out/<abi>/node_datachannel.node
//   .omb-scratch/webrtc/out/<abi>/utp_native.node
//   .omb-scratch/webrtc/out/<abi>/manifest.json   provenance + hashes
//
// OpenSSL: DTLS is mandatory for WebRTC data channels. The app already ships
// the runtime's own OpenSSL 3.6.3 (libssl_3.so/libcrypto_3.so beside
// libnode_host.so, already loaded in the process), so the addon links against
// THAT instead of bundling a second copy — zero extra bytes, one DTLS stack in
// the process. Only headers have to come from outside: they are taken from the
// build host's OpenSSL development headers, or from OMB_OPENSSL_INCLUDE. That
// is a supported pairing — OpenSSL guarantees ABI compatibility within a major
// series, so a 3.x header set builds against a newer 3.x library, which is
// precisely the library here. The reverse (headers newer than the library) is
// refused below, and both versions are recorded in the manifest.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRATCH = join(ROOT, ".omb-scratch", "webrtc");
const THIRD = join(SCRATCH, "third_party");
const OUT_ROOT = join(SCRATCH, "out");
const JNI_LIBS = join(ROOT, "android", "app", "src", "main", "jniLibs");

// ── pinned sources ─────────────────────────────────────────────────────────
// Version, where it comes from, and the hash it must have. A tarball is
// checked against its sha256; libdatachannel is a git checkout checked against
// its commit (it carries the vendored submodules we build: libjuice, usrsctp,
// libsrtp, plog, json).
const TARBALLS = {
  "node-datachannel": {
    version: "0.32.3",
    url: "https://registry.npmjs.org/node-datachannel/-/node-datachannel-0.32.3.tgz",
    sha256: "718461d530d67aaba163812f2773867100533628ebc09f26189e7fa40a3b4a44",
  },
  "utp-native": {
    version: "2.5.3",
    url: "https://registry.npmjs.org/utp-native/-/utp-native-2.5.3.tgz",
    sha256: "e1a534fdb46784e8f121af45aac3dce30b5328d5e0a82b819b9f4bd02ccb0166",
  },
  "node-addon-api": {
    version: "7.1.1",
    url: "https://registry.npmjs.org/node-addon-api/-/node-addon-api-7.1.1.tgz",
    sha256: "b10455d15a977c0cd17a1cb0eb679e03d939f8ef8d4302eb33e1f78dacc71f82",
  },
  "napi-macros": {
    version: "2.2.2",
    url: "https://registry.npmjs.org/napi-macros/-/napi-macros-2.2.2.tgz",
    sha256: "38d89034a07786f39b0d4ddc505ae8aaeb1b1c319e14fcff8f5bd116c63d631a",
  },
};

const LIBDATACHANNEL = {
  version: "v0.24.2",
  commit: "4e4f4892dccb2a57fe3a490d0c9d958de4244e74",
  url: "https://github.com/paullouisageneau/libdatachannel.git",
};

// What the build produces, and where each file has to live inside the
// package's own tree for its loader to find it. node-datachannel compiles
// `require("../../../build/Release/node_datachannel.node")` into its dist
// (dist/cjs/lib → package root); utp-native asks node-gyp-build, whose first
// candidate is build/Release/<anything>.node.
const ADDONS = [
  {
    kind: "webrtc",
    package: "node-datachannel",
    version: TARBALLS["node-datachannel"].version,
    file: "node_datachannel.node",
    target: "build/Release/node_datachannel.node",
  },
  {
    kind: "utp",
    package: "utp-native",
    version: TARBALLS["utp-native"].version,
    file: "utp_native.node",
    target: "build/Release/utp_native.node",
  },
];

// N-API version the addons are compiled for. Node 18+ (and this runtime)
// support 8; it is a stable ABI, which is why one build works across node
// releases instead of one per ABI number.
const NAPI_VERSION = "8";

// The app's minSdk; the NDK refuses to target anything lower for the sysroot.
const ANDROID_API = "26";

// ── helpers ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const wantAbi = valueOf("--abi") ?? "arm64-v8a";
const only = valueOf("--only");

function valueOf(flag) {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function run(cmd, argv, options = {}) {
  const result = spawnSync(cmd, argv, { stdio: "inherit", cwd: options.cwd ?? ROOT });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${argv.slice(0, 3).join(" ")} … failed with status ${result.status}`);
  }
}

function capture(cmd, argv, options = {}) {
  return execFileSync(cmd, argv, { encoding: "utf8", cwd: options.cwd ?? ROOT }).trim();
}

function safeCapture(cmd, argv, options = {}) {
  try {
    return capture(cmd, argv, options);
  } catch {
    return "";
  }
}

/** The NDK, from the environment first, then the SDK the Android build uses. */
function findNdk() {
  const explicit = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT;
  if (explicit && existsSync(explicit)) return explicit;
  const local = join(ROOT, "android", "local.properties");
  let sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot && existsSync(local)) {
    const line = readFileSync(local, "utf8").split("\n").find((l) => l.startsWith("sdk.dir="));
    if (line) sdkRoot = line.slice("sdk.dir=".length).trim();
  }
  if (!sdkRoot) return null;
  const ndkDir = join(sdkRoot, "ndk");
  if (!existsSync(ndkDir)) return null;
  const versions = readdirSync(ndkDir).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }));
  return versions.length ? join(ndkDir, versions[versions.length - 1]) : null;
}

/** Fetch + verify + unpack one pinned tarball. Idempotent. */
function ensureTarball(name) {
  const pin = TARBALLS[name];
  const archive = join(THIRD, `${name}-${pin.version}.tgz`);
  const marker = join(THIRD, `src-${name}`, "package.json");
  const extracted = join(THIRD, `src-${name}`);
  if (existsSync(marker)) return extracted;
  if (!existsSync(archive)) {
    console.log(`fetching ${name} ${pin.version} …`);
    run("curl", ["-sSL", "--fail", "-o", archive, pin.url]);
  }
  const got = sha256(archive);
  if (got !== pin.sha256) {
    throw new Error(`${name} tarball hash mismatch: ${got} != ${pin.sha256}`);
  }
  rmSync(extracted, { recursive: true, force: true });
  mkdirSync(extracted, { recursive: true });
  run("tar", ["xzf", archive, "-C", extracted, "--strip-components=1"]);
  return extracted;
}

/** libdatachannel v0.24.2 with its vendored dependency submodules. */
function ensureLibdatachannel() {
  const dir = join(THIRD, "libdatachannel");
  if (existsSync(join(dir, "CMakeLists.txt"))) {
    const commit = capture("git", ["rev-parse", "HEAD"], { cwd: dir });
    if (commit !== LIBDATACHANNEL.commit) {
      throw new Error(`libdatachannel is at ${commit}, expected ${LIBDATACHANNEL.commit} (${LIBDATACHANNEL.version})`);
    }
    return dir;
  }
  console.log(`cloning libdatachannel ${LIBDATACHANNEL.version} with submodules …`);
  run("git", [
    "clone", "--depth", "1", "--branch", LIBDATACHANNEL.version,
    "--recurse-submodules", "--shallow-submodules", LIBDATACHANNEL.url, dir,
  ]);
  const commit = capture("git", ["rev-parse", "HEAD"], { cwd: dir });
  if (commit !== LIBDATACHANNEL.commit) {
    throw new Error(`libdatachannel checkout is ${commit}, expected ${LIBDATACHANNEL.commit}`);
  }
  return dir;
}

/** Compare "3.6.3" style versions numerically. */
function versionAtLeast(candidate, floor) {
  const a = candidate.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/**
 * The link-time view of OpenSSL for the addon. The libraries are the app's
 * own (the runtime's libssl_3.so/libcrypto_3.so, copied under their real
 * sonames so DT_NEEDED matches what is already loaded in the process); the
 * headers come from the build host, or from OMB_OPENSSL_INCLUDE.
 *
 * The pairing is checked in the one direction that matters: a library older
 * than the headers would let code reference symbols that are not there, and
 * is refused. A newer library with older headers is the supported direction
 * (OpenSSL keeps ABI compatibility within a major series).
 */
function opensslPrefix(abi) {
  const prefix = join(SCRATCH, "build", `openssl-${abi}`);
  const libDir = join(prefix, "lib");
  mkdirSync(libDir, { recursive: true });
  for (const lib of ["libssl_3.so", "libcrypto_3.so"]) {
    const from = join(JNI_LIBS, abi, lib);
    if (!existsSync(from)) throw new Error(`the runtime's ${lib} is missing from ${dirname(from)}`);
    copyFileSync(from, join(libDir, lib));
  }
  const libraryBanner = /OpenSSL [0-9]+\.[0-9]+\.[0-9]+[a-z]?/.exec(readFileSync(join(libDir, "libcrypto_3.so"), "latin1"))?.[0] ?? "";
  if (!libraryBanner) throw new Error("the runtime's libcrypto_3.so has no OpenSSL version banner");
  const libraryVersion = libraryBanner.slice("OpenSSL ".length);

  const includeDir = opensslIncludeDir();
  const headerVersion = readOpensslHeaderVersion(includeDir);
  const headerMajor = headerVersion.split(".")[0];
  const libraryMajor = libraryVersion.split(".")[0];
  if (headerMajor !== libraryMajor) {
    throw new Error(`OpenSSL headers are ${headerVersion} but the runtime library is ${libraryVersion}`);
  }
  if (!versionAtLeast(libraryVersion, headerVersion)) {
    throw new Error(`the runtime's OpenSSL ${libraryVersion} is older than the ${headerVersion} headers — refusing to build against a library that may be missing symbols`);
  }
  console.log(`OpenSSL: headers ${headerVersion} (${includeDir}) against the runtime's ${libraryVersion}`);
  return { prefix, includeDir, headerVersion, libraryVersion };
}

/** Where a usable `openssl/opensslv.h` lives on this host. */
function opensslIncludeDir() {
  const candidates = [
    process.env.OMB_OPENSSL_INCLUDE,
    ...safeCapture("pkg-config", ["--variable=includedir", "openssl"]).split("\n").map((line) => line.trim()),
    "/usr/include",
    "/usr/local/include",
    "/opt/homebrew/include",
    "/opt/local/include",
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(join(dir, "openssl", "opensslv.h"))) return dir;
  }
  throw new Error(
    "No OpenSSL headers found. Install OpenSSL development headers " +
    "(Fedora: openssl-devel, Debian/Ubuntu: libssl-dev, macOS: brew install openssl) " +
    "or point OMB_OPENSSL_INCLUDE at an include directory.",
  );
}

function readOpensslHeaderVersion(includeDir) {
  const header = readFileSync(join(includeDir, "openssl", "opensslv.h"), "utf8");
  const version = /OPENSSL_VERSION_STR\s+"([0-9.]+[a-z]?)"/.exec(header)?.[1];
  if (!version) throw new Error(`could not read the OpenSSL version from ${join(includeDir, "openssl", "opensslv.h")}`);
  return version;
}

/** The LLVM bin/ of the NDK, plus its per-API clang wrappers. */
function ndkTools(ndk) {
  const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  const bin = join(ndk, "toolchains", "llvm", "prebuilt", host, "bin");
  if (!existsSync(bin)) throw new Error(`the NDK at ${ndk} has no LLVM toolchain at ${bin}`);
  return {
    bin,
    clangxx: join(bin, "clang++"),
    readelf: join(bin, "llvm-readelf"),
    nm: join(bin, "llvm-nm"),
    strip: join(bin, "llvm-strip"),
    toolchainFile: join(ndk, "build", "cmake", "android.toolchain.cmake"),
  };
}

/**
 * Debug info dwarfs the code here: the WebRTC addon is 44 MB fresh out of the
 * linker and 2.9 MB once stripped, because the NDK toolchain compiles with
 * -g by default. These are shipped binaries, not build outputs anyone will
 * step through on the phone, so they are stripped — which keeps the dynamic
 * symbol table (and therefore the N-API entry point node needs) intact while
 * removing the line tables and DWARF that nothing on device can use.
 *
 * verify() re-checks the entry point and the machine type afterwards, so a
 * strip that broke the addon would fail the build rather than the phone.
 */
function stripAddon(file, tools) {
  const before = statSync(file).size;
  const trimmed = `${file}.stripped`;
  rmSync(trimmed, { force: true });
  run(tools.strip, ["--strip-unneeded", "-o", trimmed, file]);
  if (!existsSync(trimmed)) throw new Error(`llvm-strip produced no ${trimmed}`);
  renameSync(trimmed, file);
  const after = statSync(file).size;
  console.log(`stripped ${file.split("/").pop()}: ${(before / 1048576).toFixed(1)} MB → ${(after / 1024).toFixed(0)} KB`);
}

/** utp-native: binding.cc + libutp, the same sources its binding.gyp builds. */
function buildUtp(abi, tools) {
  const pkg = ensureTarball("utp-native");
  const napiMacros = ensureTarball("napi-macros");
  const libutp = join(pkg, "deps", "libutp");
  const sources = [
    join(pkg, "binding.cc"),
    ...["utp_internal", "utp_utils", "utp_hash", "utp_callbacks", "utp_api", "utp_packedsockaddr"]
      .map((name) => join(libutp, `${name}.cpp`)),
  ];
  const outDir = join(OUT_ROOT, abi);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "utp_native.node");
  console.log(`building utp-native ${TARBALLS["utp-native"].version} for ${abi} …`);
  run(tools.clangxx, [
    `--target=${targetTriple(abi)}${ANDROID_API}`,
    "-shared", "-fPIC", "-O3", "-std=c++17",
    "-D_GNU_SOURCE=1", "-DPOSIX=1", `-DNAPI_VERSION=${NAPI_VERSION}`,
    "-Wno-unused-parameter", "-Wno-deprecated-declarations",
    "-I", join(pkg, "deps", "libutp"),
    // uv.h and the N-API declarations come from the runtime's own headers.
    "-I", join(THIRD, "node-headers", "include", "node"),
    "-I", napiMacros,
    ...sources,
    "-o", out,
    "-llog",
  ]);
  stripAddon(out, tools);
  return out;
}

/**
 * node-datachannel 0.32.3 → its own CMakeLists, which builds libdatachannel
 * (plus libjuice, usrsctp, libsrtp, plog) from the checkout we point it at and
 * produces a single self-contained .node. Media and WebSocket support stay ON:
 * the JS wrapper imports Video/Audio at module load, so a media-less build
 * would fail the very import torlnk performs.
 */
function buildWebrtc(abi, tools) {
  const pkg = ensureTarball("node-datachannel");
  const datachannel = ensureLibdatachannel();
  const addonApi = ensureTarball("node-addon-api");
  const headers = join(THIRD, "node-headers");
  if (!existsSync(join(headers, "include", "node", "node_api.h"))) {
    throw new Error(`node headers are missing at ${headers} (see build-android-pty.mjs for how they are fetched)`);
  }
  // node-datachannel's CMakeLists includes node-addon-api from its own
  // node_modules; satisfy that from the pinned tarball instead of running npm.
  const addonApiTarget = join(pkg, "node_modules", "node-addon-api");
  mkdirSync(dirname(addonApiTarget), { recursive: true });
  rmSync(addonApiTarget, { recursive: true, force: true });
  mkdirSync(addonApiTarget, { recursive: true });
  for (const entry of readdirSync(addonApi)) {
    copyTree(join(addonApi, entry), join(addonApiTarget, entry));
  }

  const openssl = opensslPrefix(abi);
  const buildDir = join(SCRATCH, "build", `node-datachannel-${abi}`);
  const outDir = join(OUT_ROOT, abi);
  mkdirSync(outDir, { recursive: true });

  console.log(`configuring node-datachannel ${TARBALLS["node-datachannel"].version} for ${abi} …`);
  run("cmake", [
    "-S", pkg,
    "-B", buildDir,
    "-G", "Unix Makefiles",
    "-DCMAKE_BUILD_TYPE=Release",
    `-DCMAKE_TOOLCHAIN_FILE=${tools.toolchainFile}`,
    `-DANDROID_ABI=${abi}`,
    `-DANDROID_PLATFORM=android-${ANDROID_API}`,
    // submodules here (plog, usrsctp) predate CMake 3.5 and CMake 4 removed
    // compatibility with them; this restores it without touching any source.
    "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
    // cmake-js normally supplies these three; the source list wants them.
    `-DCMAKE_JS_INC=${join(headers, "include", "node")}`,
    "-DCMAKE_JS_SRC=",
    "-DCMAKE_JS_LIB=",
    "-DCMAKE_CXX_STANDARD=17",
    // libc++_shared.so is the STL the rest of the app already links against.
    "-DANDROID_STL=c++_shared",
    // A Node addon resolves napi_* and the uv_*/node:: symbols out of the
    // host process at dlopen, so it is *supposed* to be linked with undefined
    // symbols. The NDK toolchain would otherwise append -Wl,--no-undefined and
    // reject the link; this is the supported way to say "shared library here
    // is a plugin, not a standalone .so".
    "-DANDROID_ALLOW_UNDEFINED_SYMBOLS=ON",
    // The dependency sources, already on disk: no network during a build.
    `-DFETCHCONTENT_SOURCE_DIR_LIBDATACHANNEL=${datachannel}`,
    "-DFETCHCONTENT_FULLY_DISCONNECTED=ON",
    "-DNO_EXAMPLES=ON",
    "-DNO_TESTS=ON",
    "-DNO_MEDIA=OFF",
    "-DNO_WEBSOCKET=OFF",
    // OpenSSL: the runtime's own DTLS libraries, with the host's headers.
    "-DOPENSSL_USE_STATIC_LIBS=FALSE",
    `-DOPENSSL_INCLUDE_DIR=${openssl.includeDir}`,
    `-DOPENSSL_SSL_LIBRARY=${join(openssl.prefix, "lib", "libssl_3.so")}`,
    `-DOPENSSL_CRYPTO_LIBRARY=${join(openssl.prefix, "lib", "libcrypto_3.so")}`,
    `-DOPENSSL_ROOT_DIR=${openssl.prefix}`,
  ]);
  console.log(`compiling node-datachannel for ${abi} … (this takes a few minutes)`);
  run("cmake", ["--build", buildDir, "--parallel", String(cpus())]);
  const built = join(buildDir, "node_datachannel.node");
  if (!existsSync(built)) throw new Error(`the build produced no ${built}`);
  copyFileSync(built, join(outDir, "node_datachannel.node"));
  stripAddon(join(outDir, "node_datachannel.node"), tools);
  return {
    file: join(outDir, "node_datachannel.node"),
    openssl: { headers: openssl.headerVersion, library: openssl.libraryVersion },
  };
}

function cpus() {
  const requested = Number(process.env.OMB_BUILD_JOBS ?? 0);
  if (requested > 0) return requested;
  try {
    return Math.max(1, Number(capture("nproc")) || 4);
  } catch {
    return 4;
  }
}

function copyTree(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) copyTree(join(from, entry), join(to, entry));
  } else {
    copyFileSync(from, to);
  }
}

function targetTriple(abi) {
  switch (abi) {
    case "arm64-v8a": return "aarch64-linux-android";
    case "armeabi-v7a": return "armv7a-linux-androideabi";
    case "x86_64": return "x86_64-linux-android";
    default: throw new Error(`unknown ABI ${abi}`);
  }
}

/** Machine type the loader will see. arm64-v8a is AArch64, and only that. */
function expectedMachine(abi) {
  switch (abi) {
    case "arm64-v8a": return "AArch64";
    case "armeabi-v7a": return "ARM";
    case "x86_64": return "X86-64";
    default: throw new Error(`unknown ABI ${abi}`);
  }
}

/**
 * The gate §13 asks for: every artifact is checked for the ABI it claims,
 * the N-API entry point node needs to dlopen it, and the shared libraries it
 * expects to find in the process. Anything that fails never reaches the APK.
 */
function verify(abi, tools) {
  const dir = join(OUT_ROOT, abi);
  const problems = [];
  for (const addon of ADDONS) {
    const file = join(dir, addon.file);
    if (!existsSync(file)) {
      problems.push(`${abi}/${addon.file} is missing`);
      continue;
    }
    const header = capture(tools.readelf, ["-h", file]);
    const machine = /Machine:\s+(.+)/.exec(header)?.[1]?.trim() ?? "?";
    if (!machine.includes(expectedMachine(abi))) {
      problems.push(`${addon.file} is ${machine}, expected ${expectedMachine(abi)}`);
    }
    const symbols = capture(tools.nm, ["-D", "--defined-only", file]);
    if (!symbols.includes("napi_register_module_v1")) {
      problems.push(`${addon.file} has no N-API entry point (not loadable by node)`);
    }
    const needed = capture(tools.readelf, ["-d", file])
      .split("\n").filter((line) => line.includes("NEEDED"))
      .map((line) => line.replace(/.*\[(.*)\]/, "$1"));
    const forbidden = needed.filter((name) => !/^lib(c|m|dl|log|z|stdc\+\+|c\+\+_shared|ssl_3|crypto_3|android|nativewindow)\.so/.test(name));
    if (forbidden.length) problems.push(`${addon.file} needs unexpected libraries: ${forbidden.join(", ")}`);
    const size = statSync(file).size;
    console.log(`ok   ${abi}/${addon.file} ${(size / 1024).toFixed(0)} KB  needs: ${needed.join(" ")}`);
  }
  if (problems.length) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    process.exit(1);
  }
}

function writeManifest(abi, openssl) {
  const dir = join(OUT_ROOT, abi);
  const previous = existsSync(join(dir, "manifest.json"))
    ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
    : null;
  const manifest = {
    abi,
    arch: abi === "arm64-v8a" ? "arm64" : abi === "armeabi-v7a" ? "arm" : "x64",
    napi: Number(NAPI_VERSION),
    androidApi: Number(ANDROID_API),
    sources: {
      "node-datachannel": TARBALLS["node-datachannel"].version,
      "utp-native": TARBALLS["utp-native"].version,
      libdatachannel: `${LIBDATACHANNEL.version} (${LIBDATACHANNEL.commit})`,
      "node-addon-api": TARBALLS["node-addon-api"].version,
      "napi-macros": TARBALLS["napi-macros"].version,
      openssl: openssl ?? previous?.sources?.openssl ?? null,
    },
    addons: ADDONS.map((addon) => {
      const file = join(dir, addon.file);
      return {
        kind: addon.kind,
        package: addon.package,
        version: addon.version,
        file: addon.file,
        target: addon.target,
        bytes: existsSync(file) ? statSync(file).size : 0,
        sha256: existsSync(file) ? sha256(file) : null,
      };
    }),
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// ── main ───────────────────────────────────────────────────────────────────

const ndk = findNdk();
if (!ndk) {
  console.error(
    "No Android NDK found. Install one with:\n" +
    "  $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --install 'ndk;28.2.13676358'\n" +
    "or point ANDROID_NDK_HOME at an existing NDK.",
  );
  process.exit(1);
}
const tools = ndkTools(ndk);
console.log(`NDK: ${ndk}`);

if (checkOnly) {
  verify(wantAbi, tools);
  console.log("native addons are in place and match the declared ABI");
  process.exit(0);
}

if (!only || only === "utp") {
  buildUtp(wantAbi, tools);
  console.log(`utp-native ${TARBALLS["utp-native"].version}: ${resolve(join(OUT_ROOT, wantAbi, "utp_native.node"))}`);
}
let openssl = null;
if (!only || only === "webrtc") {
  const built = buildWebrtc(wantAbi, tools);
  console.log(`node-datachannel ${TARBALLS["node-datachannel"].version}: ${resolve(built.file)}`);
  openssl = `${built.openssl.headers} headers, ${built.openssl.library} runtime library`;
}

verify(wantAbi, tools);
const manifest = writeManifest(wantAbi, openssl);
for (const addon of manifest.addons) {
  console.log(`${addon.kind.padEnd(6)} ${addon.package}@${addon.version} → ${addon.target} (${(addon.bytes / 1024).toFixed(0)} KB, ${addon.sha256.slice(0, 12)}…)`);
}
console.log(join(OUT_ROOT, wantAbi, "manifest.json"));
