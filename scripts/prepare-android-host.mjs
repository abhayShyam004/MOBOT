#!/usr/bin/env node
// Packages the self-contained OpenMausBot server bundle into the Android app's
// assets, for first-run extraction onto app-private storage.
//
//   node scripts/prepare-android-host.mjs
//
// Reads  dist-server/            (built by `pnpm build:server`)
// Writes android/app/src/main/assets/host/server.zip
//
// `dist-server/enterprise/` is the compiled enterprise layer (separate
// LICENSE, see LICENSING.md) and MUST NOT ship inside the OSS APK: the
// Apache-2.0 tree is built as if the layer were absent, which is exactly what
// a source build without it produces. server/enterprise.ts's hook point stays;
// with no layer present the server runs the OSS edition, fail-closed.

import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, copyFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.env.OMB_DIST_SERVER ?? join(ROOT, "dist-server");
const OUT_DIR = join(ROOT, "android", "app", "src", "main", "assets", "host");
const OUT = join(OUT_DIR, "server.zip");

// Staged under a temp dir so the zip contains only the bundle files at their
// clean, relative paths (no `./`, no OS junk, no enterprise/).
const STAGE = join(os.tmpdir(), `omb-android-host-${process.pid}`);

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function stageTree(from, to) {
  const entries = await readdir(from, { withFileTypes: true });
  await mkdir(to, { recursive: true });
  for (const entry of entries) {
    if (entry.name === "enterprise") continue; // license carve-out (see header)
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      await stageTree(src, dst);
    } else if (entry.isFile()) {
      await copyFile(src, dst);
    }
  }
}

// The bot terminal runs npm from inside the extracted server directory
// (server/android-computer.ts wires npm()/npx() shell functions to
// <server>/npm/bin/npm-cli.js). npm is data to node, so shipping the plain
// package tree is enough — app data cannot exec binaries and none of this
// needs to. The tree is taken from the machine running this script
// (overridable with OMB_NPM_DIR); when it is missing, the build still
// succeeds and the bot terminal simply has no npm/npx.
async function stageNpm(stage) {
  const npmDir = await findNpmDir();
  if (!npmDir) {
    console.warn("npm tree not found — the bot terminal will have no npm/npx (set OMB_NPM_DIR)");
    return;
  }
  const dest = join(stage, "npm");
  let copied = 0;
  let total = 0;
  await copyNpmTree(npmDir, dest, (bytes) => {
    copied += 1;
    total += bytes;
  });
  console.log(`bundled npm from ${npmDir} (${copied} files, ${(total / 1024 / 1024).toFixed(1)} MB)`);
}

async function findNpmDir() {
  const candidates = [
    process.env.OMB_NPM_DIR,
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm"),
    "/usr/local/lib/node_modules/npm",
    "/usr/lib/node_modules/npm",
  ];
  try {
    for (const entry of await readdir("/usr/lib")) {
      if (entry.startsWith("node_modules")) candidates.push(join("/usr/lib", entry, "npm"));
    }
  } catch {
    // No /usr/lib (macOS/Windows dev) — the other candidates still apply.
  }
  for (const candidate of candidates) {
    if (candidate && (await exists(join(candidate, "bin", "npm-cli.js")))) return candidate;
  }
  return null;
}

async function copyNpmTree(from, to, onFile) {
  // docs/man are pure APK weight; symlinks are never load-bearing here.
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name === "docs" || entry.name === "man") continue;
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyNpmTree(src, dst, onFile);
    } else if (entry.isFile()) {
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
      onFile((await stat(src)).size);
    }
  }
}

// The two native addons the networking stack needs: node-datachannel (WebRTC
// data channels, backed by libdatachannel) and utp-native (uTP over UDP,
// backed by libutp). Neither publishes an Android prebuilt and the phone
// cannot compile one — npm installs with --ignore-scripts there because
// Android denies exec of anything in app data — so the addons built by
// scripts/android-net/build-native-addons.mjs ride along inside the bundle and
// server/android-native-addons.ts copies the right one into each installed
// package's build/Release at run time.
//
// One directory per ABI, because the runtime picks by its own process.arch; the
// copy refuses an addon whose ELF machine does not match the running process,
// so a split APK that carries the wrong ABI loses the capability instead of
// loading the wrong code.
const ADDON_SRC = join(ROOT, ".omb-scratch", "webrtc", "out");

async function stageNativeAddons(stage) {
  let abiDirs = [];
  try {
    abiDirs = (await readdir(ADDON_SRC, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    abiDirs = [];
  }

  const staged = [];
  let total = 0;
  for (const abi of abiDirs) {
    const from = join(ADDON_SRC, abi);
    const names = (await readdir(from)).filter((name) => name.endsWith(".node") || name === "manifest.json");
    const addons = names.filter((name) => name.endsWith(".node"));
    if (!addons.length) continue;
    const to = join(stage, "native", abi);
    await mkdir(to, { recursive: true });
    for (const name of names) {
      const src = join(from, name);
      await copyFile(src, join(to, name));
      total += (await stat(src)).size;
      staged.push(`${abi}/${name}`);
    }
  }

  if (!staged.length) {
    console.warn("native addons not found — this bundle will report WebRTC and uTP as unavailable");
    console.warn("build them first:  node scripts/android-net/build-native-addons.mjs");
    return 0;
  }
  console.log(`bundled native addons: ${staged.join(", ")} (${(total / 1024 / 1024).toFixed(1)} MB)`);
  return staged.filter((name) => name.endsWith(".node")).length;
}

async function walk(dir) {
  const out = [];
  async function rec(d) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await rec(p);
      else if (entry.isFile()) out.push(p);
    }
  }
  await rec(dir);
  return out.sort();
}

async function main() {
  if (!(await exists(join(SRC, "index.js")))) {
    console.error(`dist-server/index.js not found under ${SRC}`);
    console.error("Build it first:  pnpm build:server");
    process.exit(1);
  }

  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });
  await stageTree(SRC, STAGE);
  await stageNpm(STAGE);
  const addons = await stageNativeAddons(STAGE);
  const skillsSrc = join(ROOT, "skills");
  if (await exists(skillsSrc)) {
    await stageTree(skillsSrc, join(STAGE, "skills"));
    console.log(`bundled skills from ${skillsSrc}`);
  }

  const files = await walk(STAGE);
  let total = 0;
  for (const f of files) total += (await stat(f)).size;

  await mkdir(OUT_DIR, { recursive: true });
  await rm(OUT, { force: true });

  const result = spawnSync(
    "zip",
    ["-q", "-r", "-X", "-9", OUT, "."],
    { cwd: STAGE, stdio: "inherit" },
  );
  if (result.error || result.status !== 0) {
    console.error("zip failed:", result.error ?? `exit ${result.status}`);
    console.error("(the `zip` binary is required by this script)");
    process.exit(1);
  }

  const { readFile } = await import("node:fs/promises");
  const hash = createHash("sha256").update(await readFile(OUT)).digest("hex");
  const outSize = (await stat(OUT)).size;
  console.log(`packaged ${files.length} files (${(total / 1024 / 1024).toFixed(1)} MB raw)`);
  console.log(`→ ${relative(ROOT, OUT)} (${(outSize / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  sha256 ${hash}`);
  console.log("enterprise layer excluded: yes");
  console.log(`native addons bundled: ${addons === 0 ? "none (WebRTC and uTP will report unavailable)" : `${addons}`}`);

  await rm(STAGE, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
